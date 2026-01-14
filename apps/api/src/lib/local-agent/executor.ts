/**
 * Agent Executor
 *
 * Main execution loop for the local agent. Orchestrates:
 * 1. Initial planning with LLM
 * 2. Page navigation and interaction via Playwright service
 * 3. DOM distillation and screenshot annotation
 * 4. LLM analysis to decide next action
 * 5. Data extraction when goal is achieved
 * 6. Retry logic with max retries per step
 * 7. Async job execution with progress updates
 */

import { z } from "zod";
import {
  AgentState,
  AgentAction,
  AgentStepResult,
  LocalAgentRequest,
  LocalAgentResponse,
  DOMDistillation,
  NumberedElement,
} from "./types";
import { createPlan } from "./llm-planner";
import { analyzePageState, extractData } from "./llm-analyzer";
import { DOM_DISTILL_SCRIPT, parseDOMDistillation } from "./dom-distiller";
import {
  getAnnotationScript,
  REMOVE_ANNOTATIONS_SCRIPT,
  filterVisibleElements,
  limitAnnotations,
} from "./screenshot-annotator";
import {
  updateJobProgress,
  completeJob,
  failJob,
  isJobCancelled,
  LocalAgentJob,
} from "./job-store";
import { logger as rootLogger } from "../../lib/logger";
import { config } from "../../config";

const logger = rootLogger.child({ module: "local-agent" });

const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_TIMEOUT = 120000; // 2 minutes
const DEFAULT_MAX_RETRIES = 3;
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;

interface PlaywrightResponse {
  content: string;
  pageStatusCode: number;
  pageError?: string;
  screenshot?: string;
  actions?: {
    screenshots: string[];
    scrapes: { url: string; html: string }[];
    javascriptReturns: { type: string; value: unknown }[];
  };
}

interface RetryState {
  currentAction: AgentAction | null;
  retryCount: number;
  lastError: string | null;
}

/**
 * Execute the local agent asynchronously (for background job execution)
 * Updates job state as it progresses
 */
export async function executeLocalAgentAsync(
  job: LocalAgentJob,
): Promise<void> {
  const { request } = job;
  const maxIterations = request.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const timeout = request.timeout ?? DEFAULT_TIMEOUT;
  const startTime = Date.now();

  logger.info("Starting async local agent execution", {
    jobId: job.id,
    prompt: request.prompt,
    urls: request.urls,
    maxIterations,
  });

  // Initialize state
  const state: AgentState = {
    plan: { goal: request.prompt, steps: [], currentStepIndex: 0 },
    history: [],
    currentUrl: request.urls?.[0] ?? "",
    iteration: 0,
    maxIterations,
    status: "running",
  };

  // Track retry state for current action
  const retryState: RetryState = {
    currentAction: null,
    retryCount: 0,
    lastError: null,
  };

  try {
    // Check for cancellation
    if (isJobCancelled(job.id)) {
      return;
    }

    // Step 1: Create initial plan
    logger.info("Creating initial plan", { jobId: job.id });
    updateJobProgress(job.id, { currentStep: "Creating plan..." });

    state.plan = await createPlan(request);

    // Step 2: Execute the plan
    while (state.status === "running" && state.iteration < maxIterations) {
      // Check for cancellation
      if (isJobCancelled(job.id)) {
        logger.info("Job cancelled, stopping execution", { jobId: job.id });
        return;
      }

      // Check timeout
      if (Date.now() - startTime > timeout) {
        state.status = "failed";
        state.error = "Agent execution timed out";
        break;
      }

      state.iteration++;
      logger.info(`Agent iteration ${state.iteration}/${maxIterations}`, {
        jobId: job.id,
      });

      // Update job progress
      updateJobProgress(job.id, {
        currentIteration: state.iteration,
        currentStep: `Iteration ${state.iteration}/${maxIterations}`,
        steps: state.history,
      });

      // Get current page state
      const pageState = await getPageState(state.currentUrl);

      if (!pageState.success) {
        state.status = "failed";
        state.error = pageState.error;
        break;
      }

      // Build context for analyzer including retry information
      const previousActions = state.history.map(h => h.action);
      let additionalContext = "";

      if (retryState.currentAction && retryState.retryCount > 0) {
        additionalContext = `\n\nRETRY CONTEXT: The previous action "${retryState.currentAction.type}" failed ${retryState.retryCount} time(s). Last error: "${retryState.lastError}". Please try a different approach or element.`;
      }

      // Analyze page and decide next action
      const analysis = await analyzePageState({
        screenshot: pageState.screenshot!,
        domDistillation: pageState.domDistillation!,
        currentUrl: state.currentUrl,
        goal: state.plan.goal + additionalContext,
        previousActions,
        schema: request.schema,
      });

      // Check if goal is achieved
      if (analysis.isComplete) {
        logger.info("Agent goal achieved", { jobId: job.id });
        state.status = "completed";

        // Extract data if schema provided
        if (request.schema && !analysis.extractedData) {
          state.extractedData = await extractData(
            pageState.domDistillation!,
            pageState.screenshot!,
            request.schema,
            state.plan.goal,
          );
        } else {
          state.extractedData = analysis.extractedData;
        }

        state.history.push({
          action: analysis.action,
          success: true,
          screenshot: pageState.screenshot,
          domDistillation: pageState.domDistillation,
          timestamp: Date.now(),
          retryCount: 0,
        });

        break;
      }

      // Check if this is a new action or a retry of the same action
      const isSameAction =
        retryState.currentAction &&
        isSameActionType(retryState.currentAction, analysis.action);

      if (!isSameAction) {
        // New action - reset retry state
        retryState.currentAction = analysis.action;
        retryState.retryCount = 0;
        retryState.lastError = null;
      }

      // Get max retries for this action
      const maxRetries = analysis.action.maxRetries ?? DEFAULT_MAX_RETRIES;

      // Execute the action
      const actionResult = await executeAction(
        analysis.action,
        state.currentUrl,
        pageState.domDistillation!,
      );

      if (!actionResult.success) {
        retryState.retryCount++;
        retryState.lastError = actionResult.error || "Unknown error";

        logger.warn("Action failed", {
          action: analysis.action.type,
          error: actionResult.error,
          retryCount: retryState.retryCount,
          maxRetries,
        });

        // Check if we've exceeded max retries
        if (retryState.retryCount >= maxRetries) {
          logger.warn("Max retries reached, skipping step", {
            action: analysis.action.type,
            retryCount: retryState.retryCount,
          });

          // Record the skipped step
          state.history.push({
            action: analysis.action,
            success: false,
            error: `Skipped after ${retryState.retryCount} failed attempts. Last error: ${retryState.lastError}`,
            screenshot: pageState.screenshot,
            domDistillation: pageState.domDistillation,
            timestamp: Date.now(),
            retryCount: retryState.retryCount,
            skipped: true,
          });

          // Reset retry state for next action
          retryState.currentAction = null;
          retryState.retryCount = 0;
          retryState.lastError = null;

          // Continue to next iteration - LLM will see the skip and adapt
          await sleep(500);
          continue;
        }

        // Record the failed attempt
        state.history.push({
          action: analysis.action,
          success: false,
          error: actionResult.error,
          screenshot: pageState.screenshot,
          domDistillation: pageState.domDistillation,
          timestamp: Date.now(),
          retryCount: retryState.retryCount,
        });
      } else {
        // Success - record and reset retry state
        state.history.push({
          action: analysis.action,
          success: true,
          screenshot: pageState.screenshot,
          domDistillation: pageState.domDistillation,
          timestamp: Date.now(),
          retryCount: retryState.retryCount,
        });

        // Reset retry state
        retryState.currentAction = null;
        retryState.retryCount = 0;
        retryState.lastError = null;

        // Update current URL if navigation occurred
        if (actionResult.newUrl) {
          state.currentUrl = actionResult.newUrl;
        }
      }

      // Small delay between iterations
      await sleep(500);
    }

    // Check if we hit max iterations
    if (state.iteration >= maxIterations && state.status === "running") {
      state.status = "failed";
      state.error = `Max iterations (${maxIterations}) reached without completing goal`;
    }

    // Build result
    const result: LocalAgentResponse = {
      success: state.status === "completed",
      data: state.extractedData,
      steps: state.history,
      totalIterations: state.iteration,
      error: state.error,
    };

    // Update job with final result
    if (state.status === "completed") {
      completeJob(job.id, result);
    } else {
      failJob(job.id, state.error || "Unknown error", result);
    }
  } catch (error) {
    logger.error("Agent execution failed", { error, jobId: job.id });

    const result: LocalAgentResponse = {
      success: false,
      steps: state.history,
      totalIterations: state.iteration,
      error: error instanceof Error ? error.message : String(error),
    };

    failJob(job.id, result.error!, result);
  }
}

/**
 * Check if two actions are the same type (for retry tracking)
 */
function isSameActionType(a: AgentAction, b: AgentAction): boolean {
  if (a.type !== b.type) return false;

  // For click/type, also check if targeting same element
  if (a.type === "click" || a.type === "type") {
    return a.elementId === b.elementId || a.selector === b.selector;
  }

  // For navigate, check URL
  if (a.type === "navigate") {
    return a.url === b.url;
  }

  return true;
}

/**
 * Get current page state: navigate, extract DOM, take annotated screenshot
 */
async function getPageState(url: string): Promise<{
  success: boolean;
  error?: string;
  screenshot?: string;
  domDistillation?: DOMDistillation;
}> {
  if (!url) {
    return { success: false, error: "No URL provided" };
  }

  try {
    // First request: navigate and extract DOM
    const domResponse = await callPlaywright({
      url,
      wait_after_load: 2000,
      timeout: 30000,
      actions: [
        {
          type: "executeJavascript",
          script: DOM_DISTILL_SCRIPT,
        },
      ],
    });

    if (domResponse.pageError) {
      return { success: false, error: domResponse.pageError };
    }

    // Parse DOM distillation from JavaScript result
    const jsResult = domResponse.actions?.javascriptReturns?.[0];
    if (!jsResult || jsResult.type !== "object") {
      return { success: false, error: "Failed to extract DOM distillation" };
    }

    const domDistillation = parseDOMDistillation(jsResult.value);

    // Filter and limit elements for annotation
    const visibleElements = filterVisibleElements(
      domDistillation.numberedElements,
      VIEWPORT_WIDTH,
      VIEWPORT_HEIGHT,
    );
    const annotationElements = limitAnnotations(visibleElements, 50);

    // Second request: add annotations and take screenshot
    const screenshotResponse = await callPlaywright({
      url,
      wait_after_load: 500,
      timeout: 15000,
      screenshot: true,
      actions: [
        {
          type: "executeJavascript",
          script: getAnnotationScript(annotationElements),
        },
        {
          type: "wait",
          milliseconds: 200,
        },
        {
          type: "screenshot",
        },
        {
          type: "executeJavascript",
          script: REMOVE_ANNOTATIONS_SCRIPT,
        },
      ],
    });

    // Get screenshot from actions result
    const screenshot =
      screenshotResponse.actions?.screenshots?.[0] ||
      screenshotResponse.screenshot;

    if (!screenshot) {
      return { success: false, error: "Failed to capture screenshot" };
    }

    return {
      success: true,
      screenshot,
      domDistillation,
    };
  } catch (error) {
    logger.error("Failed to get page state", { error, url });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute a single action via Playwright
 */
async function executeAction(
  action: AgentAction,
  currentUrl: string,
  dom: DOMDistillation,
): Promise<{ success: boolean; error?: string; newUrl?: string }> {
  try {
    let playwrightActions: any[] = [];
    let targetUrl = currentUrl;

    switch (action.type) {
      case "navigate":
        if (!action.url) {
          return { success: false, error: "Navigate action requires URL" };
        }
        targetUrl = action.url;
        break;

      case "click":
        const clickSelector = getSelector(action, dom);
        if (!clickSelector) {
          return { success: false, error: "Could not find element to click" };
        }
        playwrightActions.push({
          type: "click",
          selector: clickSelector,
        });
        break;

      case "type":
        const typeSelector = getSelector(action, dom);
        if (!typeSelector) {
          return {
            success: false,
            error: "Could not find element to type into",
          };
        }
        // Click first to focus, then type
        playwrightActions.push({
          type: "click",
          selector: typeSelector,
        });
        playwrightActions.push({
          type: "write",
          text: action.value ?? "",
        });
        break;

      case "scroll":
        playwrightActions.push({
          type: "scroll",
          direction: action.direction ?? "down",
          amount: action.amount ?? 500,
        });
        break;

      case "wait":
        playwrightActions.push({
          type: "wait",
          milliseconds: action.amount ?? 1000,
        });
        break;

      case "extract":
      case "done":
        // These don't require Playwright actions
        return { success: true };

      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }

    // Execute via Playwright
    const response = await callPlaywright({
      url: targetUrl,
      wait_after_load: 1000,
      timeout: 30000,
      actions: playwrightActions,
    });

    if (response.pageError) {
      return { success: false, error: response.pageError };
    }

    // Check for navigation
    const scrapeResult = response.actions?.scrapes?.[0];
    const newUrl =
      scrapeResult?.url || (action.type === "navigate" ? targetUrl : undefined);

    return { success: true, newUrl };
  } catch (error) {
    logger.error("Failed to execute action", { error, action });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get CSS selector for an action
 */
function getSelector(action: AgentAction, dom: DOMDistillation): string | null {
  // First try elementId
  if (action.elementId !== undefined) {
    const element = dom.numberedElements.find(el => el.id === action.elementId);
    if (element) {
      return element.selector;
    }
  }

  // Fall back to direct selector
  if (action.selector) {
    return action.selector;
  }

  return null;
}

/**
 * Call the Playwright microservice
 */
async function callPlaywright(params: {
  url: string;
  wait_after_load?: number;
  timeout?: number;
  screenshot?: boolean;
  full_page_screenshot?: boolean;
  actions?: any[];
}): Promise<PlaywrightResponse> {
  const playwrightUrl = config.PLAYWRIGHT_MICROSERVICE_URL;

  if (!playwrightUrl) {
    throw new Error("PLAYWRIGHT_MICROSERVICE_URL not configured");
  }

  const response = await fetch(playwrightUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Playwright service error: ${response.status} ${text}`);
  }

  return response.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

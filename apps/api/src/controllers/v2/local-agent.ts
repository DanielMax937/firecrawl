/**
 * Local Agent Controller
 *
 * Handles the /v2/local-agent endpoints for running the local agent
 * that uses LLM for planning and browser automation for execution.
 *
 * Async API matching the cloud agent pattern:
 * - POST /v2/local-agent - Start a job, returns job ID immediately
 * - GET /v2/local-agent/:jobId - Get job status and results
 * - DELETE /v2/local-agent/:jobId - Cancel a running job
 */

import { Request, Response } from "express";
import { z } from "zod";
import {
  executeLocalAgentAsync,
  LocalAgentRequest,
  createJob,
  getJob,
  cancelJob,
} from "../../lib/local-agent";
import { logger } from "../../lib/logger";
import { config } from "../../config";

/**
 * Request schema for local agent
 */
const localAgentRequestSchema = z.object({
  prompt: z.string().min(1),
  urls: z.array(z.string().url()).optional(),
  schema: z.record(z.string(), z.any()).optional(),
  maxIterations: z.number().int().min(1).max(50).optional().default(20),
  timeout: z.number().int().min(5000).max(300000).optional().default(120000),
});

type LocalAgentRequestBody = z.infer<typeof localAgentRequestSchema>;

/**
 * Local Agent Controller - Start Job
 *
 * POST /v2/local-agent
 *
 * Starts a local agent job and returns the job ID immediately.
 * The job runs in the background - poll GET /v2/local-agent/:jobId for status.
 */
export async function localAgentController(
  req: Request,
  res: Response,
): Promise<void> {
  logger.info("Local agent request received", {
    prompt: req.body?.prompt?.substring(0, 100),
    urls: req.body?.urls,
  });

  // Check for OpenAI API key (or other configured provider)
  if (!config.OPENAI_API_KEY && !config.OLLAMA_BASE_URL) {
    res.status(500).json({
      success: false,
      error:
        "No LLM provider configured. Set OPENAI_API_KEY or OLLAMA_BASE_URL.",
    });
    return;
  }

  // Check for Playwright service
  if (!config.PLAYWRIGHT_MICROSERVICE_URL) {
    res.status(500).json({
      success: false,
      error:
        "PLAYWRIGHT_MICROSERVICE_URL is not configured. Local agent requires Playwright service.",
    });
    return;
  }

  // Validate request
  const parseResult = localAgentRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: "Invalid request",
      details: parseResult.error.issues,
    });
    return;
  }

  const request: LocalAgentRequest = parseResult.data;

  // Ensure we have a starting URL
  if (!request.urls || request.urls.length === 0) {
    // Try to extract URL from prompt if not provided
    const urlMatch = request.prompt.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      request.urls = [urlMatch[0]];
    } else {
      res.status(400).json({
        success: false,
        error:
          'No URL provided. Please provide a URL in the "urls" array or include one in the prompt.',
      });
      return;
    }
  }

  // Create job
  const job = createJob(request, request.maxIterations ?? 20);

  // Start execution in background (don't await)
  executeLocalAgentAsync(job).catch(error => {
    logger.error("Background agent execution error", { jobId: job.id, error });
  });

  // Return job ID immediately
  res.status(200).json({
    success: true,
    id: job.id,
  });
}

/**
 * Local Agent Status Controller
 *
 * GET /v2/local-agent/:jobId
 *
 * Returns the current status and results of a local agent job.
 */
export async function localAgentStatusController(
  req: Request,
  res: Response,
): Promise<void> {
  const { jobId } = req.params;

  if (!jobId) {
    res.status(400).json({
      success: false,
      error: "Job ID is required",
    });
    return;
  }

  const job = getJob(jobId);

  if (!job) {
    res.status(404).json({
      success: false,
      error: "Job not found or expired",
    });
    return;
  }

  // Build response based on job status
  const response: any = {
    success: true,
    id: job.id,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt.toISOString(),
  };

  // Add progress info for processing jobs
  if (job.status === "processing") {
    response.progress = {
      currentIteration: job.currentIteration,
      maxIterations: job.maxIterations,
      currentStep: job.currentStep,
      stepsCompleted: job.steps.length,
    };
  }

  // Add results for completed/failed jobs
  if (job.status === "completed" || job.status === "failed") {
    response.data = job.result?.data;
    response.error = job.error;
    response.steps = job.result?.steps?.map(step => ({
      action: {
        type: step.action.type,
        elementId: step.action.elementId,
        value: step.action.value,
        url: step.action.url,
        reasoning: step.action.reasoning,
        maxRetries: step.action.maxRetries,
      },
      success: step.success,
      error: step.error,
      timestamp: step.timestamp,
      retryCount: step.retryCount,
      skipped: step.skipped,
      pageUrl: step.domDistillation?.pageUrl,
      pageTitle: step.domDistillation?.pageTitle,
    }));
    response.totalIterations = job.result?.totalIterations;
  }

  res.status(200).json(response);
}

/**
 * Local Agent Cancel Controller
 *
 * DELETE /v2/local-agent/:jobId
 *
 * Cancels a running local agent job.
 */
export async function localAgentCancelController(
  req: Request,
  res: Response,
): Promise<void> {
  const { jobId } = req.params;

  if (!jobId) {
    res.status(400).json({
      success: false,
      error: "Job ID is required",
    });
    return;
  }

  const job = getJob(jobId);

  if (!job) {
    res.status(404).json({
      success: false,
      error: "Job not found or expired",
    });
    return;
  }

  if (job.status !== "processing") {
    res.status(409).json({
      success: false,
      error: `Cannot cancel job with status: ${job.status}`,
    });
    return;
  }

  const cancelled = cancelJob(jobId);

  if (cancelled) {
    res.status(200).json({
      success: true,
      message: "Job cancellation requested",
    });
  } else {
    res.status(500).json({
      success: false,
      error: "Failed to cancel job",
    });
  }
}

/**
 * Health check for local agent dependencies
 */
export async function localAgentHealthController(
  req: Request,
  res: Response,
): Promise<void> {
  const checks = {
    llmConfigured: !!(config.OPENAI_API_KEY || config.OLLAMA_BASE_URL),
    playwrightConfigured: !!config.PLAYWRIGHT_MICROSERVICE_URL,
    playwrightReachable: false,
  };

  // Check if Playwright service is reachable
  if (config.PLAYWRIGHT_MICROSERVICE_URL) {
    try {
      const response = await fetch(config.PLAYWRIGHT_MICROSERVICE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "about:blank", timeout: 5000 }),
      });
      checks.playwrightReachable = response.ok;
    } catch {
      checks.playwrightReachable = false;
    }
  }

  const allHealthy =
    checks.llmConfigured &&
    checks.playwrightConfigured &&
    checks.playwrightReachable;

  res.status(allHealthy ? 200 : 503).json({
    healthy: allHealthy,
    checks,
    message: allHealthy
      ? "Local agent is ready"
      : "Local agent dependencies not fully configured",
  });
}

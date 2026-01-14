/**
 * LLM Planner
 *
 * Uses the configured LLM provider to generate an initial action plan based on the user's prompt.
 * The plan is a high-level outline that guides the agent's execution.
 */

import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "../../lib/generic-ai";
import { AgentPlan, AgentAction, LocalAgentRequest } from "./types";
import { logger } from "../../lib/logger";
import { config } from "../../config";

const PLANNER_SYSTEM_PROMPT = `You are a web automation planner. Given a user's goal, create a step-by-step plan to achieve it using browser actions.

Available actions:
- navigate: Go to a URL
- click: Click on an element (you'll specify which element after seeing the page)
- type: Type text into an input field
- scroll: Scroll up or down on the page
- wait: Wait for a specified time
- extract: Extract data from the page (use when goal is achieved)
- done: Mark the task as complete

Guidelines:
1. Start with a navigate action if URLs are provided
2. Keep plans concise - 3-10 steps typically
3. Each step should have clear reasoning
4. Don't specify element IDs yet - those will be determined when viewing the page
5. End with extract or done when the goal is achieved
6. Consider common web patterns (search boxes, navigation menus, forms)
7. Set maxRetries for each step (default: 3). Use lower values (1-2) for critical steps that shouldn't be skipped, higher values (3-5) for steps that might need multiple attempts`;

// Schema for the plan response
const planSchema = z.object({
  goal: z
    .string()
    .describe("Clear description of what we are trying to achieve"),
  steps: z.array(
    z.object({
      type: z.enum([
        "navigate",
        "click",
        "type",
        "scroll",
        "wait",
        "extract",
        "done",
      ]),
      url: z.string().optional().describe("URL for navigate action"),
      value: z.string().optional().describe("Text for type action"),
      direction: z
        .enum(["up", "down"])
        .optional()
        .describe("Direction for scroll action"),
      amount: z
        .number()
        .optional()
        .describe("Amount in pixels for scroll or ms for wait"),
      reasoning: z.string().describe("Explanation for this action"),
      maxRetries: z
        .number()
        .optional()
        .default(3)
        .describe("Max retry count for this step"),
    }),
  ),
});

export async function createPlan(
  request: LocalAgentRequest,
  _openaiApiKey?: string, // Kept for backward compatibility, but we use config
): Promise<AgentPlan> {
  const userMessage = buildPlannerPrompt(request);

  // Get model from config, fallback to gpt-4o-mini
  const modelName = config.MODEL_NAME || "gpt-4o-mini";

  try {
    logger.info("Creating agent plan", { modelName });

    const result = await generateObject({
      model: getModel(modelName),
      schema: planSchema,
      system: PLANNER_SYSTEM_PROMPT,
      prompt: userMessage,
      temperature: 0.2,
    });

    const plan = result.object;

    logger.info("Agent plan created", {
      goal: plan.goal,
      stepCount: plan.steps.length,
      model: modelName,
    });

    return {
      goal: plan.goal,
      steps: plan.steps.map(step => ({
        type: step.type,
        url: step.url,
        value: step.value,
        direction: step.direction,
        amount: step.amount,
        reasoning: step.reasoning,
        maxRetries: step.maxRetries ?? 3,
      })),
      currentStepIndex: 0,
    };
  } catch (error) {
    logger.error("Failed to create agent plan", { error, modelName });
    throw new Error(`Failed to create plan: ${error}`);
  }
}

function buildPlannerPrompt(request: LocalAgentRequest): string {
  const parts: string[] = [];

  parts.push(`User's Goal: ${request.prompt}`);

  if (request.urls && request.urls.length > 0) {
    parts.push(`\nStarting URL(s): ${request.urls.join(", ")}`);
  }

  if (request.schema) {
    parts.push(`\nData to extract (JSON schema):`);
    parts.push("```json");
    parts.push(JSON.stringify(request.schema, null, 2));
    parts.push("```");
    parts.push("\nThe final step should extract data matching this schema.");
  }

  parts.push("\nCreate a plan to achieve this goal.");

  return parts.join("\n");
}

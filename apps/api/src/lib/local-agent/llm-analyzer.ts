/**
 * LLM Analyzer
 *
 * Uses the configured LLM provider with vision to analyze the current page state
 * (screenshot + DOM distillation) and decide the next action.
 */

import { generateObject, generateText } from "ai";
import { z } from "zod";
import { getModel } from "../../lib/generic-ai";
import {
  AnalyzerInput,
  AnalyzerOutput,
  AgentAction,
  DOMDistillation,
} from "./types";
import { formatDOMForLLM } from "./dom-distiller";
import { logger } from "../../lib/logger";
import { config } from "../../config";

const ANALYZER_SYSTEM_PROMPT = `You are a web automation agent analyzing a webpage to complete a task.

You will receive:
1. A screenshot of the current page with numbered red badges on interactive elements
2. A text description of the page's interactive elements with their numbers
3. The goal you're trying to achieve
4. Previous actions taken

Your job is to:
1. Analyze the current page state
2. Decide the next action to take
3. If the goal is achieved, extract the required data

Available actions:
- click: Click on element by number. Use: {"type": "click", "elementId": 5, "reasoning": "..."}
- type: Type text into focused/clicked input. Use: {"type": "type", "elementId": 3, "value": "search text", "reasoning": "..."}
- scroll: Scroll the page. Use: {"type": "scroll", "direction": "down", "amount": 500, "reasoning": "..."}
- wait: Wait for page to load. Use: {"type": "wait", "amount": 2000, "reasoning": "..."}
- navigate: Go to URL. Use: {"type": "navigate", "url": "https://...", "reasoning": "..."}
- extract: Extract data (when goal achieved). Use: {"type": "extract", "reasoning": "..."}
- done: Task complete. Use: {"type": "done", "reasoning": "..."}

Guidelines:
1. Reference elements by their [number] shown in the screenshot
2. Be precise - click the exact element needed
3. After typing, you may need to click a submit button or press Enter
4. If you don't see what you need, try scrolling
5. If stuck, try a different approach
6. Extract data only when you can see the information needed`;

// Schema for analyzer response
const analyzerSchema = z.object({
  thought: z
    .string()
    .describe("Your analysis of the current page and what you see"),
  action: z.object({
    type: z.enum([
      "click",
      "type",
      "scroll",
      "wait",
      "navigate",
      "extract",
      "done",
    ]),
    elementId: z
      .number()
      .optional()
      .describe("Element number to interact with"),
    selector: z
      .string()
      .optional()
      .describe("CSS selector if elementId not available"),
    value: z.string().optional().describe("Text to type"),
    url: z.string().optional().describe("URL to navigate to"),
    direction: z.enum(["up", "down"]).optional().describe("Scroll direction"),
    amount: z
      .number()
      .optional()
      .describe("Scroll pixels or wait milliseconds"),
    reasoning: z.string().describe("Why this action is needed"),
  }),
  isComplete: z.boolean().describe("Whether the goal has been achieved"),
  extractedData: z
    .any()
    .optional()
    .describe("Extracted data if goal is complete"),
});

export async function analyzePageState(
  input: AnalyzerInput,
  _openaiApiKey?: string,
): Promise<AnalyzerOutput> {
  const userMessage = buildAnalyzerPrompt(input);

  // Get model from config - need a vision-capable model
  // Default to gpt-4o-mini which supports vision
  const modelName = config.MODEL_NAME || "gpt-4o-mini";

  try {
    logger.info("Analyzing page state", { modelName, url: input.currentUrl });

    // Prepare the image data
    const imageData = input.screenshot.startsWith("data:")
      ? input.screenshot
      : `data:image/png;base64,${input.screenshot}`;

    // Use generateObject with messages that include the image
    const result = await generateObject({
      model: getModel(modelName),
      schema: analyzerSchema,
      system: ANALYZER_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: userMessage },
            { type: "image", image: imageData },
          ],
        },
      ],
      temperature: 0.1,
    });

    const analysis = result.object;

    logger.info("Agent analyzer result", {
      thought: analysis.thought?.substring(0, 100),
      actionType: analysis.action?.type,
      isComplete: analysis.isComplete,
    });

    // Build the action object
    const action: AgentAction = {
      type: analysis.action.type as any,
      elementId: analysis.action.elementId,
      selector: analysis.action.selector,
      value: analysis.action.value,
      url: analysis.action.url,
      direction: analysis.action.direction,
      amount: analysis.action.amount,
      reasoning: analysis.action.reasoning,
    };

    // Validate the action
    validateAction(action, input.domDistillation);

    return {
      thought: analysis.thought,
      action,
      isComplete: analysis.isComplete,
      extractedData: analysis.extractedData,
    };
  } catch (error) {
    logger.error("Failed to analyze page state", { error, modelName });
    throw new Error(`Failed to analyze page: ${error}`);
  }
}

function buildAnalyzerPrompt(input: AnalyzerInput): string {
  const parts: string[] = [];

  parts.push(`## Goal`);
  parts.push(input.goal);
  parts.push("");

  parts.push(`## Current URL`);
  parts.push(input.currentUrl);
  parts.push("");

  if (input.previousActions.length > 0) {
    parts.push(`## Previous Actions`);
    input.previousActions.forEach((action, i) => {
      parts.push(`${i + 1}. ${action.type}: ${action.reasoning}`);
    });
    parts.push("");
  }

  parts.push(`## Page Elements`);
  parts.push(formatDOMForLLM(input.domDistillation));
  parts.push("");

  if (input.schema) {
    parts.push(`## Data Schema to Extract`);
    parts.push("When the goal is achieved, extract data matching this schema:");
    parts.push("```json");
    parts.push(JSON.stringify(input.schema, null, 2));
    parts.push("```");
    parts.push("");
  }

  parts.push(`## Instructions`);
  parts.push(
    "Look at the screenshot with numbered elements and decide the next action.",
  );
  parts.push(
    "The red numbered badges correspond to the [numbers] in the element list above.",
  );

  return parts.join("\n");
}

function validateAction(action: AgentAction, dom: DOMDistillation): void {
  if (!action || !action.type) {
    throw new Error("Invalid action: missing type");
  }

  // Validate elementId references exist
  if (action.elementId !== undefined) {
    const element = dom.numberedElements.find(el => el.id === action.elementId);
    if (!element) {
      logger.warn("Action references non-existent element", {
        elementId: action.elementId,
        availableIds: dom.numberedElements.map(el => el.id),
      });
      // Don't throw - the LLM might be referencing an element that scrolled out of view
    } else {
      // Add selector to action for execution
      action.selector = element.selector;
    }
  }

  // Validate required fields for each action type
  switch (action.type) {
    case "navigate":
      if (!action.url) {
        throw new Error("Navigate action requires url");
      }
      break;
    case "type":
      if (action.value === undefined) {
        throw new Error("Type action requires value");
      }
      break;
    case "scroll":
      if (!action.direction) {
        action.direction = "down";
      }
      if (!action.amount) {
        action.amount = 500;
      }
      break;
    case "wait":
      if (!action.amount) {
        action.amount = 1000;
      }
      break;
  }
}

/**
 * Extract data from the page using LLM
 */
export async function extractData(
  dom: DOMDistillation,
  screenshot: string,
  schema: Record<string, any> | undefined,
  goal: string,
  _openaiApiKey?: string,
): Promise<any> {
  const modelName = config.MODEL_NAME || "gpt-4o-mini";
  const prompt = buildExtractionPrompt(dom, schema, goal);

  // Prepare the image data
  const imageData = screenshot.startsWith("data:")
    ? screenshot
    : `data:image/png;base64,${screenshot}`;

  try {
    if (schema) {
      // Use generateObject with schema
      const result = await generateObject({
        model: getModel(modelName),
        schema: z.any(), // Use the provided schema
        system: `You are a data extraction agent. Extract the requested information from the webpage.
Be precise and only include information visible on the page.`,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image", image: imageData },
            ],
          },
        ],
        temperature: 0,
      });

      return result.object;
    } else {
      // Use generateText for free-form extraction
      const result = await generateText({
        model: getModel(modelName),
        system: `You are a data extraction agent. Extract the requested information from the webpage.
Output valid JSON. Be precise and only include information visible on the page.`,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image", image: imageData },
            ],
          },
        ],
        temperature: 0,
      });

      try {
        return JSON.parse(result.text);
      } catch {
        return { rawText: result.text };
      }
    }
  } catch (error) {
    logger.error("Failed to extract data", { error });
    throw new Error(`Failed to extract data: ${error}`);
  }
}

function buildExtractionPrompt(
  dom: DOMDistillation,
  schema: Record<string, any> | undefined,
  goal: string,
): string {
  const parts: string[] = [];

  parts.push(`## Extraction Goal`);
  parts.push(goal);
  parts.push("");

  parts.push(`## Page Content`);
  parts.push(formatDOMForLLM(dom));
  parts.push("");

  if (schema) {
    parts.push(`## Output Schema`);
    parts.push("Extract data matching this JSON schema:");
    parts.push("```json");
    parts.push(JSON.stringify(schema, null, 2));
    parts.push("```");
  } else {
    parts.push(`## Output Format`);
    parts.push("Extract the relevant information as a JSON object.");
  }

  parts.push("");
  parts.push(
    "Look at both the screenshot and the page content to extract the data.",
  );

  return parts.join("\n");
}

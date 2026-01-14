/**
 * Local Agent Types
 *
 * Types for the local agent implementation that uses LLM for planning
 * and browser automation for execution.
 */

export interface NumberedElement {
  id: number;
  tag: string;
  text: string;
  selector: string;
  role?: string;
  attributes?: Record<string, string>;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface A11yNode {
  role: string;
  name: string;
  id?: number;
  value?: string;
  description?: string;
  children?: A11yNode[];
}

export interface DOMDistillation {
  a11yTree: A11yNode;
  numberedElements: NumberedElement[];
  simplifiedHtml: string;
  pageTitle: string;
  pageUrl: string;
}

export interface AgentAction {
  type:
    | "navigate"
    | "click"
    | "type"
    | "scroll"
    | "wait"
    | "extract"
    | "screenshot"
    | "done";
  elementId?: number; // For click, type actions - references numbered element
  selector?: string; // Direct selector if elementId not used
  value?: string; // For type action - text to type
  url?: string; // For navigate action
  direction?: "up" | "down"; // For scroll action
  amount?: number; // For scroll (pixels) or wait (ms)
  reasoning: string; // LLM's explanation for this action
  maxRetries?: number; // Max retry count for this step (default: 3)
}

export interface AgentPlan {
  goal: string;
  steps: AgentAction[];
  currentStepIndex: number;
}

export interface AgentState {
  plan: AgentPlan;
  history: AgentStepResult[];
  currentUrl: string;
  iteration: number;
  maxIterations: number;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string;
  extractedData?: any;
}

export interface AgentStepResult {
  action: AgentAction;
  success: boolean;
  error?: string;
  screenshot?: string; // Base64 encoded
  domDistillation?: DOMDistillation;
  timestamp: number;
  retryCount?: number; // Number of retries attempted
  skipped?: boolean; // Whether step was skipped after max retries
}

export interface LocalAgentRequest {
  prompt: string;
  urls?: string[];
  schema?: Record<string, any>;
  maxIterations?: number;
  timeout?: number;
}

export interface LocalAgentResponse {
  success: boolean;
  data?: any;
  steps: AgentStepResult[];
  totalIterations: number;
  error?: string;
}

export interface AnalyzerInput {
  screenshot: string; // Base64 encoded with number overlays
  domDistillation: DOMDistillation;
  currentUrl: string;
  goal: string;
  previousActions: AgentAction[];
  schema?: Record<string, any>;
}

export interface AnalyzerOutput {
  thought: string; // LLM's reasoning about current state
  action: AgentAction; // Next action to take
  isComplete: boolean; // Whether the goal is achieved
  extractedData?: any; // Data extracted if complete
}

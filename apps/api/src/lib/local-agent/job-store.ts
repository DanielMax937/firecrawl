/**
 * Local Agent Job Store
 *
 * In-memory storage for local agent jobs. Provides async job execution
 * matching the cloud agent API pattern.
 *
 * For production/cloud use, this would be replaced with Supabase + GCS.
 * For local/self-hosted, in-memory is simpler and has no external dependencies.
 */

import { v7 as uuidv7 } from "uuid";
import {
  AgentStepResult,
  LocalAgentRequest,
  LocalAgentResponse,
} from "./types";
import { logger } from "../../lib/logger";

export interface LocalAgentJob {
  id: string;
  status: "processing" | "completed" | "failed" | "cancelled";
  request: LocalAgentRequest;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  // Results (populated when completed/failed)
  result?: LocalAgentResponse;
  error?: string;
  // Progress tracking
  currentIteration: number;
  maxIterations: number;
  currentStep?: string;
  steps: AgentStepResult[];
}

// In-memory job storage
const jobs = new Map<string, LocalAgentJob>();

// Job expiration time (24 hours)
const JOB_EXPIRATION_MS = 24 * 60 * 60 * 1000;

// Cleanup interval (1 hour)
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Create a new job
 */
export function createJob(
  request: LocalAgentRequest,
  maxIterations: number,
): LocalAgentJob {
  const id = uuidv7();
  const now = new Date();

  const job: LocalAgentJob = {
    id,
    status: "processing",
    request,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + JOB_EXPIRATION_MS),
    currentIteration: 0,
    maxIterations,
    steps: [],
  };

  jobs.set(id, job);

  logger.info("Local agent job created", { jobId: id });

  return job;
}

/**
 * Get a job by ID
 */
export function getJob(id: string): LocalAgentJob | undefined {
  const job = jobs.get(id);

  // Check if expired
  if (job && new Date() > job.expiresAt) {
    jobs.delete(id);
    return undefined;
  }

  return job;
}

/**
 * Update job progress
 */
export function updateJobProgress(
  id: string,
  update: {
    currentIteration?: number;
    currentStep?: string;
    steps?: AgentStepResult[];
  },
): void {
  const job = jobs.get(id);
  if (!job) return;

  if (update.currentIteration !== undefined) {
    job.currentIteration = update.currentIteration;
  }
  if (update.currentStep !== undefined) {
    job.currentStep = update.currentStep;
  }
  if (update.steps !== undefined) {
    job.steps = update.steps;
  }
  job.updatedAt = new Date();
}

/**
 * Complete a job successfully
 */
export function completeJob(id: string, result: LocalAgentResponse): void {
  const job = jobs.get(id);
  if (!job) return;

  job.status = "completed";
  job.result = result;
  job.updatedAt = new Date();

  logger.info("Local agent job completed", {
    jobId: id,
    iterations: result.totalIterations,
    success: result.success,
  });
}

/**
 * Fail a job
 */
export function failJob(
  id: string,
  error: string,
  partialResult?: LocalAgentResponse,
): void {
  const job = jobs.get(id);
  if (!job) return;

  job.status = "failed";
  job.error = error;
  job.result = partialResult;
  job.updatedAt = new Date();

  logger.info("Local agent job failed", { jobId: id, error });
}

/**
 * Cancel a job
 */
export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;

  if (job.status !== "processing") {
    return false; // Can only cancel processing jobs
  }

  job.status = "cancelled";
  job.error = "Job cancelled by user";
  job.updatedAt = new Date();

  logger.info("Local agent job cancelled", { jobId: id });

  return true;
}

/**
 * Check if a job is cancelled (for executor to check)
 */
export function isJobCancelled(id: string): boolean {
  const job = jobs.get(id);
  return job?.status === "cancelled";
}

/**
 * Cleanup expired jobs
 */
function cleanupExpiredJobs(): void {
  const now = new Date();
  let cleaned = 0;

  for (const [id, job] of jobs.entries()) {
    if (now > job.expiresAt) {
      jobs.delete(id);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info("Cleaned up expired local agent jobs", { count: cleaned });
  }
}

// Start cleanup interval
setInterval(cleanupExpiredJobs, CLEANUP_INTERVAL_MS);

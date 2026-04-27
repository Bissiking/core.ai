import {
  dequeueAgentJob,
  getQueueMetrics,
  hydrateQueueState,
  markDone,
  markError
} from "../queue/inMemoryQueue.js";
import { fetchAgentInput, getResultTarget, pushAgentResult } from "./orionClient.js";
import { runDeepseekAnalysis } from "./deepseekService.js";

const MAX_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 2);
const MAX_RETRIES = Number(process.env.WORKER_MAX_RETRIES ?? 3);
const IDLE_SLEEP_MS = Number(process.env.WORKER_IDLE_SLEEP_MS ?? 200);

let started = false;
let inFlight = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(level, msg, meta = {}) {
  console[level](`[${new Date().toISOString()}] [worker] ${msg}`, meta);
}

function getRetryDelay(attempt) {
  return Math.min(1000 * 2 ** attempt, 30000);
}

async function handleJob(job) {
  const { agentId } = job;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      log("log", "job-start", { agentId, attempt });

      const input = await fetchAgentInput(agentId);
      const aiResult = await runDeepseekAnalysis(input);
      await pushAgentResult(agentId, aiResult);

      markDone(agentId, {
        attempt,
        delivery: {
          target: getResultTarget(),
          pushedAt: new Date().toISOString()
        }
      });
      log("log", "job-done", { agentId, attempt });
      return;
    } catch (error) {
      const hasRetry = attempt < MAX_RETRIES;
      if (!hasRetry) {
        markError(agentId, error, attempt);
        log("error", "job-error", { agentId, attempt, error: error.message });
        return;
      }

      const delay = getRetryDelay(attempt);
      log("warn", "job-retry-scheduled", {
        agentId,
        attempt,
        delayMs: delay,
        error: error.message
      });
      await sleep(delay);
    }
  }
}

async function loop() {
  while (true) {
    if (inFlight >= MAX_CONCURRENCY) {
      await sleep(IDLE_SLEEP_MS);
      continue;
    }

    const job = dequeueAgentJob();
    if (!job) {
      await sleep(IDLE_SLEEP_MS);
      continue;
    }

    inFlight += 1;
    void handleJob(job)
      .catch((error) => {
        log("error", "job-unhandled", { error: error.message });
      })
      .finally(() => {
        inFlight -= 1;
      });
  }
}

export function startAgentWorker() {
  if (started) return;
  started = true;

  void hydrateQueueState()
    .catch((error) => {
      log("warn", "queue-hydration-failed", { error: error.message });
    })
    .finally(() => {
      log("log", "worker-started", { MAX_CONCURRENCY, MAX_RETRIES });
      void loop();
    });
}

export function getWorkerStatus() {
  return {
    inFlight,
    maxConcurrency: MAX_CONCURRENCY,
    maxRetries: MAX_RETRIES,
    ...getQueueMetrics()
  };
}

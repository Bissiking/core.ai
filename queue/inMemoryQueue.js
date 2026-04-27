import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORE_DIR = path.join(__dirname, "../.data");
const STORE_FILE = path.join(STORE_DIR, "agent-jobs.json");
const STATUS_TTL_MS = Number(process.env.JOB_STATUS_TTL_MS ?? 5 * 60 * 1000);

const waiting = [];
const waitingSet = new Set();
const processingSet = new Set();
const statusByAgentId = new Map();

let hydrationPromise = null;
let persistPromise = Promise.resolve();

function nowMs() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function mapPublicStatus(status) {
  if (status === "queued") return "pending";
  if (status === "processing") return "running";
  if (status === "done") return "completed";
  if (status === "error") return "failed";
  return "unknown";
}

function schedulePersist() {
  const payload = {
    waiting,
    statuses: Array.from(statusByAgentId.values())
  };

  persistPromise = persistPromise
    .then(async () => {
      await mkdir(STORE_DIR, { recursive: true });
      await writeFile(STORE_FILE, JSON.stringify(payload), "utf8");
    })
    .catch((error) => {
      console.error(`[${nowIso()}] [queue] persist-error`, { error: error.message });
    });
}

function pruneExpiredStatuses() {
  const threshold = nowMs() - STATUS_TTL_MS;
  for (const [agentId, status] of statusByAgentId.entries()) {
    const keepActive = status.status === "queued" || status.status === "processing";
    if (keepActive) continue;

    if ((status.updatedAtMs ?? 0) < threshold) {
      statusByAgentId.delete(agentId);
    }
  }
}

function setStatus(agentId, status, extra = {}) {
  statusByAgentId.set(agentId, {
    agentId,
    status,
    publicStatus: mapPublicStatus(status),
    updatedAt: nowIso(),
    updatedAtMs: nowMs(),
    ...extra
  });

  pruneExpiredStatuses();
  schedulePersist();
}

function restoreState(payload) {
  const statuses = Array.isArray(payload?.statuses) ? payload.statuses : [];
  const queuedJobs = Array.isArray(payload?.waiting) ? payload.waiting : [];

  for (const item of statuses) {
    if (!item?.agentId || !item?.status) continue;

    if (item.status === "processing") {
      statusByAgentId.set(item.agentId, {
        ...item,
        status: "queued",
        publicStatus: "pending",
        updatedAt: nowIso(),
        updatedAtMs: nowMs(),
        restoredAfterRestart: true
      });
      if (!waitingSet.has(item.agentId)) {
        waiting.push({ agentId: item.agentId, enqueuedAt: nowIso(), restoredAfterRestart: true });
        waitingSet.add(item.agentId);
      }
      continue;
    }

    statusByAgentId.set(item.agentId, item);
  }

  for (const job of queuedJobs) {
    if (!job?.agentId) continue;
    if (waitingSet.has(job.agentId) || processingSet.has(job.agentId)) continue;

    waiting.push({ agentId: job.agentId, enqueuedAt: job.enqueuedAt ?? nowIso() });
    waitingSet.add(job.agentId);
    if (!statusByAgentId.has(job.agentId)) {
      setStatus(job.agentId, "queued");
    }
  }

  pruneExpiredStatuses();
}

export function hydrateQueueState() {
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    try {
      const raw = await readFile(STORE_FILE, "utf8");
      restoreState(JSON.parse(raw));
      console.log(`[${nowIso()}] [queue] state-restored`, {
        waiting: waiting.length,
        tracked: statusByAgentId.size
      });
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn(`[${nowIso()}] [queue] state-restore-failed`, { error: error.message });
      }
    }
  })();

  return hydrationPromise;
}

export function enqueueAgentJob(agentId) {
  pruneExpiredStatuses();

  if (!agentId) {
    return { accepted: false, reason: "missing-agent-id" };
  }

  if (waitingSet.has(agentId) || processingSet.has(agentId)) {
    const existing = statusByAgentId.get(agentId);
    return {
      accepted: false,
      reason: "duplicate",
      status: existing?.publicStatus ?? "pending"
    };
  }

  waiting.push({ agentId, enqueuedAt: nowIso() });
  waitingSet.add(agentId);
  setStatus(agentId, "queued");

  return { accepted: true, status: "pending" };
}

export function dequeueAgentJob() {
  pruneExpiredStatuses();

  const job = waiting.shift();
  if (!job) return null;

  waitingSet.delete(job.agentId);
  processingSet.add(job.agentId);
  setStatus(job.agentId, "processing");

  schedulePersist();
  return job;
}

export function markDone(agentId, resultMeta = {}) {
  processingSet.delete(agentId);
  setStatus(agentId, "done", {
    doneAt: nowIso(),
    ...resultMeta
  });
}

export function markError(agentId, error, retries = 0) {
  processingSet.delete(agentId);
  setStatus(agentId, "error", {
    retries,
    error: error instanceof Error ? error.message : String(error)
  });
}

export function getStatus(agentId) {
  pruneExpiredStatuses();
  return statusByAgentId.get(agentId) ?? null;
}

export function getQueueMetrics() {
  pruneExpiredStatuses();
  return {
    waiting: waiting.length,
    processing: processingSet.size,
    tracked: statusByAgentId.size,
    statusTtlMs: STATUS_TTL_MS,
    persistentStore: STORE_FILE
  };
}

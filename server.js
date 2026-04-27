import express from "express";
import { enqueueAgentJob, getStatus } from "./queue/inMemoryQueue.js";
import { getWorkerStatus, startAgentWorker } from "./worker/agentWorker.js";
import { getResultTarget } from "./worker/orionClient.js";

const app = express();
app.use(express.json());

startAgentWorker();

app.post("/job/agent-ai", (req, res) => {
  const { agentId } = req.body ?? {};

  if (!agentId || typeof agentId !== "string") {
    return res.status(400).json({
      status: "error",
      message: "agentId is required"
    });
  }

  const result = enqueueAgentJob(agentId);

  if (!result.accepted && result.reason === "duplicate") {
    return res.status(202).json({
      status: "accepted",
      deduplicated: true,
      agentId,
      jobStatus: result.status,
      resultDelivery: {
        method: "POST",
        endpoint: getResultTarget()
      }
    });
  }

  if (!result.accepted) {
    return res.status(400).json({
      status: "error",
      message: result.reason
    });
  }

  return res.status(202).json({
    status: "accepted",
    agentId,
    jobStatus: "pending",
    resultDelivery: {
      method: "POST",
      endpoint: getResultTarget()
    }
  });
});

app.get("/job/agent-ai/:agentId", (req, res) => {
  const status = getStatus(req.params.agentId);

  if (!status) {
    return res.status(404).json({
      status: "not_found"
    });
  }

  return res.json({
    agentId: status.agentId,
    jobStatus: status.publicStatus,
    internalStatus: status.status,
    updatedAt: status.updatedAt,
    retries: status.retries ?? 0,
    error: status.error,
    doneAt: status.doneAt,
    delivery: status.delivery
  });
});

app.get("/health", (_req, res) => {
  return res.json({
    status: "ok",
    worker: getWorkerStatus()
  });
});

const port = Number(process.env.PORT ?? 3002);
app.listen(port, () => {
  console.log(`[${new Date().toISOString()}] core.ai worker running on :${port}`);
});

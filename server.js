// Auteur : M. HEMERY
// Fichier : server.js

import express from "express";
import { addJob } from "./queue.js";
import { startWorker } from "./worker.js";

const app = express();
app.use(express.json());

startWorker();

app.post("/ai/ask", async (req, res) => {
  const { prompt, priority } = req.body;

  const response = await addJob({
    prompt,
    priority
  });

  res.json({ response });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(3002, () => {
  console.log("core.ai running on :3002");
});

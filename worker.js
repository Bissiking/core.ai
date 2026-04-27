// Auteur : M. HEMERY
// Fichier : worker.js

import fetch from "node-fetch";
import { getNextJob } from "./queue.js";

let running = false;

export function startWorker() {
  if (running) return;
  running = true;

  loop();
}

async function loop() {
  while (true) {
    const job = getNextJob();

    if (!job) {
      await sleep(200);
      continue;
    }

    try {
      console.log("CALLING OLLAMA...");
      const res = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          model: "deepseek-r1:7b",
          prompt: job.prompt,
          stream: false
        })
      });

      const data = await res.json();
      job.resolve(data.response);

    } catch (err) {
      job.resolve("Erreur IA");
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

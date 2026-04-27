// Auteur : M. HEMERY
// Fichier : queue.js

const queues = {
  high: [],
  normal: [],
  low: []
};

export function addJob(job) {
  return new Promise((resolve) => {
    queues[job.priority || "normal"].push({ ...job, resolve });
  });
}

export function getNextJob() {
  if (queues.high.length) return queues.high.shift();
  if (queues.normal.length) return queues.normal.shift();
  if (queues.low.length) return queues.low.shift();
  return null;
}

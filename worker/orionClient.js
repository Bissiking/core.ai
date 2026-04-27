const BASE_URL = process.env.LUMA_API_BASE_URL ?? "https://mhemery.fr";
const RESULT_ENDPOINT = process.env.LUMA_RESULT_ENDPOINT ?? "/api/orion/ai/result";

function endpoint(path) {
  return `${BASE_URL}${path}`;
}

export async function fetchAgentInput(agentId) {
  const res = await fetch(endpoint(`/api/orion/ai/input/${encodeURIComponent(agentId)}`));

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`input-http-${res.status}:${text.slice(0, 300)}`);
  }

  return res.json();
}

export async function pushAgentResult(agentId, payload) {
  const res = await fetch(endpoint(RESULT_ENDPOINT), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId,
      analysis: payload.analysis,
      aiRaw: payload.raw,
      generatedAt: new Date().toISOString()
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`result-http-${res.status}:${text.slice(0, 300)}`);
  }

  return res.json().catch(() => ({ status: "ok" }));
}

export function getResultTarget() {
  return endpoint(RESULT_ENDPOINT);
}

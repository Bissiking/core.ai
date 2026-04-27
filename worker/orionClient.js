const BASE_URL = process.env.LUMA_API_BASE_URL ?? "https://mhemery.fr";
const RESULT_ENDPOINT = process.env.LUMA_RESULT_ENDPOINT ?? "/api/orion/ai/result";
const LUMA_API_TOKEN = process.env.LUMA_API_TOKEN ?? "";

class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

function endpoint(path) {
  return `${BASE_URL}${path}`;
}

function buildHeaders(extra = {}) {
  const headers = { ...extra };

  if (LUMA_API_TOKEN) {
    headers.Authorization = `Bearer ${LUMA_API_TOKEN}`;
  }

  return headers;
}

export async function fetchAgentInput(agentId) {
  const res = await fetch(
    endpoint(`/api/orion/ai/input/${encodeURIComponent(agentId)}`),
    { headers: buildHeaders() }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(
      `input-http-${res.status}:${text.slice(0, 300)}`,
      res.status,
      text
    );
  }

  return res.json();
}

export async function pushAgentResult(agentId, payload) {
  const res = await fetch(endpoint(RESULT_ENDPOINT), {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      agentId,
      analysis: payload.analysis,
      aiRaw: payload.raw,
      generatedAt: new Date().toISOString()
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(
      `result-http-${res.status}:${text.slice(0, 300)}`,
      res.status,
      text
    );
  }

  return res.json().catch(() => ({ status: "ok" }));
}

export function getResultTarget() {
  return endpoint(RESULT_ENDPOINT);
}

export function isRetryableError(error) {
  if (!(error instanceof HttpError)) return true;

  // erreurs client → inutile de retry
  if ([400, 401, 403, 404].includes(error.status)) {
    return false;
  }

  return true;
}

export function hasApiTokenConfigured() {
  return Boolean(LUMA_API_TOKEN);
}
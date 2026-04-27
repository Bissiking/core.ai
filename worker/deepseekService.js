const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434/api/generate";
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-r1:7b";
const DEEPSEEK_TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 15000);

function log(level, msg, meta = {}) {
  console[level](`[${new Date().toISOString()}] [deepseek] ${msg}`, meta);
}

function extractJsonObject(text) {
  if (!text) return null;

  const direct = safeJsonParse(text);
  if (direct && isValidAiOutput(direct)) return direct;

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const sliced = text.slice(start, end + 1);
  const parsed = safeJsonParse(sliced);
  if (parsed && isValidAiOutput(parsed)) return parsed;

  return null;
}

function safeJsonParse(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function isValidAiOutput(value) {
  return (
    value &&
    typeof value.summary === "string" &&
    Array.isArray(value.issues) &&
    Array.isArray(value.actions)
  );
}

function fallbackOutput(rawText) {
  return {
    summary: "Analyse générée avec format partiel.",
    issues: ["Sortie DeepSeek non strictement conforme au JSON attendu."],
    actions: ["Vérifier le prompt système et la stabilité du modèle."],
    raw: rawText?.slice(0, 800)
  };
}

export async function runDeepseekAnalysis(inputPayload) {
  const prompt = [
    "Tu es un moteur d'analyse opérationnelle.",
    "Retourne STRICTEMENT du JSON valide sans markdown.",
    'Format exact: {"summary":"string","issues":["..."],"actions":["..."]}.',
    "Contexte à analyser:",
    JSON.stringify(inputPayload)
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        format: "json",
        prompt
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`deepseek-timeout-${DEEPSEEK_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    log("error", "DeepSeek call failed", { status: response.status, errorBody });
    throw new Error(`deepseek-http-${response.status}`);
  }

  const body = await response.json();
  const rawResponse = typeof body?.response === "string" ? body.response : JSON.stringify(body?.response ?? "");
  const output = extractJsonObject(rawResponse);

  if (output) {
    return {
      analysis: output,
      raw: rawResponse
    };
  }

  log("warn", "DeepSeek response fallback used");
  return {
    analysis: fallbackOutput(rawResponse),
    raw: rawResponse
  };
}

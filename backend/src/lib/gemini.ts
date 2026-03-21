import { GoogleGenAI } from "@google/genai";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required");
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const orchestratorModel = genAI.models;
export const ORCHESTRATOR_MODEL =
  process.env.GEMINI_ORCHESTRATOR_MODEL ?? "gemini-2.5-pro";
export const FLASH_MODEL =
  process.env.GEMINI_FLASH_MODEL ?? "gemini-2.5-flash";
export const EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";

const TEXT_MODEL_FALLBACKS = (
  process.env.GEMINI_TEXT_MODEL_FALLBACKS ??
  "gemini-2.5-flash,gemini-2.5-pro"
)
  .split(",")
  .map((m) => m.trim())
  .filter((m) => m.length > 0);

const TEXT_REQUEST_RETRIES = Number(process.env.GEMINI_TEXT_RETRIES ?? "3");
const TEXT_RETRY_DELAY_MS = Number(process.env.GEMINI_TEXT_RETRY_DELAY_MS ?? "1500");

function normalizeModelName(model: string): string {
  return model.replace(/^models\//, "");
}

function isModelUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("no longer available") ||
    message.includes("is not found") ||
    message.includes("not supported") ||
    message.includes("status: 404") ||
    message.includes("code\":404")
  );
}

function isTransientTextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("sending request") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("socket hang up") ||
    message.includes("status: 429") ||
    message.includes("status: 500") ||
    message.includes("status: 502") ||
    message.includes("status: 503") ||
    message.includes("status: 504")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateText(
  model: string,
  prompt: string,
  systemInstruction?: string
): Promise<string> {
  const modelsToTry = [
    normalizeModelName(model),
    ...TEXT_MODEL_FALLBACKS.map(normalizeModelName),
  ].filter((candidate, index, arr) => arr.indexOf(candidate) === index);

  let lastError: unknown;

  for (const candidateModel of modelsToTry) {
    for (let attempt = 1; attempt <= Math.max(1, TEXT_REQUEST_RETRIES); attempt++) {
      try {
        const response = await genAI.models.generateContent({
          model: candidateModel,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: systemInstruction
            ? { systemInstruction }
            : undefined,
        });

        const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error("No text in Gemini response");
        }

        return text;
      } catch (error) {
        lastError = error;

        if (isModelUnavailableError(error)) {
          console.warn(
            `[Gemini] Model '${candidateModel}' unavailable. Trying next fallback model.`
          );
          break;
        }

        const canRetry =
          attempt < Math.max(1, TEXT_REQUEST_RETRIES) && isTransientTextError(error);

        if (!canRetry) {
          throw error;
        }

        const delayMs = TEXT_RETRY_DELAY_MS * attempt;
        console.warn(
          `[Gemini] Transient error on '${candidateModel}' attempt ${attempt}/${TEXT_REQUEST_RETRIES}. Retrying in ${delayMs}ms.`
        );
        await sleep(delayMs);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to generate text with available Gemini models");
}

export async function generateEmbedding(
  text: string,
  outputDimensionality?: number
): Promise<number[]> {
  const response = await genAI.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: [{ role: "user", parts: [{ text }] }],
    ...(outputDimensionality ? { config: { outputDimensionality } } : {}),
  });

  const embedding = response.embeddings?.[0]?.values;
  if (!embedding) {
    throw new Error("No embedding values in Gemini response");
  }
  return embedding;
}

export { genAI };

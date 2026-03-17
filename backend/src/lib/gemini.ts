import { GoogleGenAI } from "@google/genai";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required");
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const orchestratorModel = genAI.models;
export const ORCHESTRATOR_MODEL = "gemini-2.5-pro";
export const FLASH_MODEL = "gemini-2.0-flash";

export async function generateText(
  model: string,
  prompt: string,
  systemInstruction?: string
): Promise<string> {
  const response = await genAI.models.generateContent({
    model,
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
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await genAI.models.embedContent({
    model: "text-embedding-004",
    contents: [{ role: "user", parts: [{ text }] }],
  });

  const embedding = response.embeddings?.[0]?.values;
  if (!embedding) {
    throw new Error("No embedding values in Gemini response");
  }
  return embedding;
}

export { genAI };

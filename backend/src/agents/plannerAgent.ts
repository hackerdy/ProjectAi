import { generateText, generateEmbedding, ORCHESTRATOR_MODEL } from "../lib/gemini.js";
import { queryByStyleId } from "../lib/pinecone.js";
import { updateJob } from "../lib/appwrite.js";
import { AgentState, OutlineSchema } from "./types.js";

export async function plannerAgent(state: AgentState): Promise<Partial<AgentState>> {
  console.log(`[Planner] Starting for job ${state.job_id}, topic: "${state.topic}"`);

  await updateJob(state.job_id, {
    status: "planning",
    current_agent: "planner",
  });

  // Query Pinecone for style-specific guidelines
  const queryEmbedding = await generateEmbedding(
    `style guidelines formatting rules ${state.style_id} ${state.topic}`
  );

  const styleChunks = await queryByStyleId(queryEmbedding, state.style_id, 15);
  const styleGuidelines = styleChunks
    .map((c) => c.metadata.text)
    .join("\n\n---\n\n");

  console.log(
    `[Planner] Retrieved ${styleChunks.length} style guideline chunks for style_id: ${state.style_id}`
  );

  const plannerPrompt = `You are an expert academic project planner.

TASK: Create a comprehensive, structured outline for a ${state.style_id} academic project on the topic: "${state.topic}"

STYLE GUIDELINES FROM KNOWLEDGE BASE:
${styleGuidelines || "No specific style guidelines found. Use standard academic conventions."}

OUTPUT REQUIREMENTS:
Return a valid JSON object matching this exact schema:
{
  "project_title": "Full project title",
  "style_id": "${state.style_id}",
  "abstract": "150-word abstract preview",
  "chapters": [
    {
      "number": 1,
      "title": "Chapter title",
      "description": "What this chapter covers",
      "key_points": ["point 1", "point 2"],
      "expected_length": "2000-3000 words"
    }
  ],
  "research_queries": ["query 1", "query 2", "query 3", "query 4", "query 5"],
  "formatting_notes": "Specific formatting instructions",
  "citation_style": "APA/MLA/IEEE/Chicago/etc"
}

Return ONLY the JSON object, no markdown code fences.`;

  const rawOutline = await generateText(
    ORCHESTRATOR_MODEL,
    plannerPrompt,
    "You are a precise academic project planner. Always respond with valid JSON only."
  );

  let outline;
  try {
    const jsonStr = rawOutline.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(jsonStr);
    outline = OutlineSchema.parse(parsed);
  } catch (err) {
    console.error("[Planner] Failed to parse outline JSON:", err);
    throw new Error(`Failed to parse planner output: ${err}`);
  }

  console.log(
    `[Planner] Generated outline with ${outline.chapters.length} chapters`
  );

  await updateJob(state.job_id, {
    outline: JSON.stringify(outline),
  });

  return {
    style_guidelines: styleGuidelines,
    outline,
    status: "researching",
    current_agent: "researcher",
  };
}

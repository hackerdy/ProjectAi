import { generateText, FLASH_MODEL } from "../lib/gemini.js";
import { updateJob } from "../lib/appwrite.js";
import { AgentState, Chapter } from "./types.js";

// ── Per-chapter research extractor ───────────────────────────────────────────
// Calls Gemini Flash to filter the full research corpus down to only the
// passages relevant to the chapter being written. This dramatically reduces
// context size and hallucination risk compared to feeding every chapter the
// same truncated blob.

async function extractChapterResearch(
  chapter: Chapter,
  styleId: string,
  fullResearch: string
): Promise<string> {
  // Nothing to filter if research is already small
  if (!fullResearch || fullResearch.trim().length < 800) return fullResearch;

  const MAX_INPUT = 20_000; // chars fed to the extractor
  const researchInput = fullResearch.slice(0, MAX_INPUT);

  const prompt = `You are a research curator preparing material for an academic writer.

CHAPTER TO BE WRITTEN:
  Title:       ${chapter.title}
  Description: ${chapter.description}
  Key points:  ${chapter.key_points.join(" | ")}
  Style:       ${styleId}

FULL RESEARCH CORPUS:
${researchInput}

YOUR TASK:
Extract ONLY the facts, statistics, quotes, and source excerpts that are directly
relevant to the chapter above.

STRICT RULES:
1. Return ONLY relevant excerpts — no commentary, no preamble.
2. Preserve every source URL and author citation exactly as written.
3. Output between 800 and 2 500 words.
4. Discard anything unrelated to this chapter's topic and key points.
5. If a passage is only partially relevant, include only the relevant portion.

Relevant research for this chapter:`;

  try {
    const filtered = await generateText(
      FLASH_MODEL,
      prompt,
      "You are a precise research curator. Return only relevant research excerpts."
    );
    console.log(
      `[Writer] Extracted ${filtered.length} chars of focused research for chapter ${chapter.number} "${chapter.title}"`
    );
    return filtered;
  } catch (err) {
    console.warn(
      `[Writer] Research extraction failed for chapter ${chapter.number} — falling back to raw slice. Error: ${err instanceof Error ? err.message : String(err)}`
    );
    return fullResearch.slice(0, 5_000);
  }
}

// ── Chapter writer ────────────────────────────────────────────────────────────

export async function writerAgent(
  state: AgentState
): Promise<Partial<AgentState>> {
  console.log(`[Writer] Starting for job ${state.job_id}`);

  if (!state.outline) {
    throw new Error("[Writer] No outline available to write");
  }

  await updateJob(state.job_id, {
    status: "writing",
    progress_percent: Math.max(60, state.progress_percent ?? 0),
    current_agent: "writer",
  });

  const chapterIndex = state.current_chapter_index;
  const outline      = state.outline;
  const chapter      = outline.chapters[chapterIndex];

  // ── All chapters done → assemble final document and hand off to reviewer ───
  if (!chapter) {
    console.log("[Writer] All chapters written. Assembling final document.");
    const finalDocument = assembleFinalDocument(state, state.chapter_drafts);
    await updateJob(state.job_id, { draft: finalDocument, progress_percent: 85 });
    return {
      final_document:  finalDocument,
      progress_percent: 85,
      status:          "reviewing",
      current_agent:   "reviewer",
    };
  }

  console.log(`[Writer] Writing chapter ${chapter.number}: "${chapter.title}"`);

  // ── Step 1: Extract chapter-specific research ─────────────────────────────
  // Each chapter only sees the research relevant to its own topic.
  // This keeps the prompt small, focused, and far less prone to hallucination.
  const chapterResearch = await extractChapterResearch(
    chapter,
    state.style_id,
    state.research_results
  );

  // ── Step 2: Build writing prompt ──────────────────────────────────────────
  const buildPrompt = (research: string) =>
    `You are an expert academic writer producing a single chapter for a larger project.

PROJECT TITLE:   ${outline.project_title}
CHAPTER NUMBER:  ${chapter.number} of ${outline.chapters.length}
CHAPTER TITLE:   ${chapter.title}
DESCRIPTION:     ${chapter.description}
KEY POINTS:      ${chapter.key_points.join(", ")}
EXPECTED LENGTH: ${chapter.expected_length}

STYLE PROFILE:        ${state.style_id}
CITATION STYLE:       ${outline.citation_style}
FORMATTING NOTES:     ${outline.formatting_notes}

STYLE GUIDELINES FROM KNOWLEDGE BASE:
${state.style_guidelines || "Use standard academic writing conventions."}

${
  state.revision_count > 0
    ? `REVISION CONTEXT:\nThis is revision ${state.revision_count}. Apply the following instructions carefully:\n${state.style_guidelines.split("REVISION INSTRUCTIONS:")[1]?.split("\n\n")[0] ?? ""}\n`
    : ""
}

RESEARCH FOR THIS CHAPTER ONLY:
${research}

WRITING INSTRUCTIONS:
1. Write ONLY this chapter — do NOT write other chapters, an introduction, or conclusion for the whole paper.
2. Use full academic prose matching the ${state.style_id} style profile.
3. Structure the chapter with appropriate sub-headings (## and ###).
4. Cite sources inline using ${outline.citation_style} format — only cite what is in the research material above.
5. Do NOT invent statistics, quotes, or claims not present in the research material.
6. Match the expected length: ${chapter.expected_length}.
7. End with a brief transitional sentence pointing toward the next chapter.

Write Chapter ${chapter.number} now:`;

  // ── Step 3: Generate chapter with graceful context-window fallback ─────────
  // If the extracted research is still too large, shrink it progressively.
  const researchSlices = [
    chapterResearch,
    chapterResearch.slice(0, 6_000),
    chapterResearch.slice(0, 3_500),
  ];

  let chapterContent  = "";
  let lastError: unknown;

  for (const researchSlice of researchSlices) {
    try {
      chapterContent = await generateText(
        FLASH_MODEL,
        buildPrompt(researchSlice),
        `You are a professional academic writer specialising in ${state.style_id} style. ` +
          `Write accurate, well-cited prose. Never invent facts.`
      );
      break;
    } catch (err) {
      lastError = err;
      console.warn(
        `[Writer] Chapter ${chapter.number} generation attempt failed (research slice: ${researchSlice.length} chars). Retrying with smaller context.`
      );
    }
  }

  if (!chapterContent) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`[Writer] Failed to generate chapter ${chapter.number}`);
  }

  console.log(
    `[Writer] Chapter ${chapter.number} done (${chapterContent.length} chars).`
  );

  // ── Step 4: Accumulate draft and decide next step ─────────────────────────
  const newDrafts       = [...state.chapter_drafts, chapterContent];
  const nextChapterIndex = chapterIndex + 1;
  const hasMoreChapters  = nextChapterIndex < outline.chapters.length;

  // Calculate smooth progress: chapters occupy the 60–85 % band
  const chapterProgress = 60 + Math.round(
    (nextChapterIndex / Math.max(outline.chapters.length, 1)) * 25
  );

  if (!hasMoreChapters) {
    // All chapters complete — assemble and move to review
    const finalDocument = assembleFinalDocument(state, newDrafts);
    await updateJob(state.job_id, { draft: finalDocument, progress_percent: 85 });
    return {
      chapter_drafts:       newDrafts,
      current_chapter_index: nextChapterIndex,
      final_document:       finalDocument,
      progress_percent:     85,
      status:               "reviewing",
      current_agent:        "reviewer",
    };
  }

  await updateJob(state.job_id, { progress_percent: chapterProgress });

  return {
    chapter_drafts:       newDrafts,
    current_chapter_index: nextChapterIndex,
    progress_percent:     chapterProgress,
    status:               "writing",     // stay in writing loop
    current_agent:        "writer",
  };
}

// ── Document assembler ────────────────────────────────────────────────────────

function assembleFinalDocument(state: AgentState, drafts: string[]): string {
  const outline = state.outline!;
  return [
    `# ${outline.project_title}`,
    ``,
    `## Abstract`,
    ``,
    outline.abstract,
    ``,
    `---`,
    ``,
    ...drafts.map((draft) => `${draft.trim()}\n`),
    ``,
    `---`,
    `*Generated using ProjectAi — ${outline.citation_style} citation style*`,
  ].join("\n");
}

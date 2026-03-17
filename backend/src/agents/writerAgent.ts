import { generateText, FLASH_MODEL } from "../lib/gemini.js";
import { updateJob } from "../lib/appwrite.js";
import { AgentState } from "./types.js";

export async function writerAgent(
  state: AgentState
): Promise<Partial<AgentState>> {
  console.log(`[Writer] Starting for job ${state.job_id}`);

  if (!state.outline) {
    throw new Error("[Writer] No outline available to write");
  }

  await updateJob(state.job_id, {
    status: "writing",
    current_agent: "writer",
  });

  const chapterIndex = state.current_chapter_index;
  const chapter = state.outline.chapters[chapterIndex];

  if (!chapter) {
    // All chapters written, assemble final document
    console.log("[Writer] All chapters written. Assembling final document.");
    const finalDocument = assembleFinalDocument(state);
    await updateJob(state.job_id, { draft: finalDocument });
    return {
      final_document: finalDocument,
      status: "reviewing",
      current_agent: "reviewer",
    };
  }

  console.log(
    `[Writer] Writing chapter ${chapter.number}: "${chapter.title}"`
  );

  const writerPrompt = `You are an expert academic writer. Write a comprehensive chapter for an academic project.

PROJECT TITLE: ${state.outline.project_title}
CHAPTER NUMBER: ${chapter.number}
CHAPTER TITLE: ${chapter.title}
CHAPTER DESCRIPTION: ${chapter.description}
KEY POINTS TO COVER: ${chapter.key_points.join(", ")}
EXPECTED LENGTH: ${chapter.expected_length}

STYLE GUIDELINES:
${state.style_guidelines || "Use standard academic writing conventions."}

CITATION STYLE: ${state.outline.citation_style}
FORMATTING NOTES: ${state.outline.formatting_notes}

RESEARCH MATERIAL:
${state.research_results.slice(0, 8000)}

INSTRUCTIONS:
1. Write the chapter in full academic prose matching the ${state.style_id} style.
2. Include proper inline citations (Author, Year) or numbered references as required.
3. Structure with appropriate headings and subheadings.
4. Ensure factual accuracy based solely on the provided research material.
5. Use the exact terminology and tone expected for ${state.style_id} style.
6. End with a brief transition to the next chapter.

Write the complete chapter now:`;

  const chapterContent = await generateText(
    FLASH_MODEL,
    writerPrompt,
    `You are a professional academic writer specializing in ${state.style_id} style projects.`
  );

  const newDrafts = [...state.chapter_drafts, chapterContent];
  const nextChapterIndex = chapterIndex + 1;
  const hasMoreChapters =
    nextChapterIndex < state.outline.chapters.length;

  console.log(
    `[Writer] Chapter ${chapter.number} written (${chapterContent.length} chars). ${hasMoreChapters ? "Continuing..." : "All done."}`
  );

  if (!hasMoreChapters) {
    const finalDocument = assembleFinalDocumentFromDrafts(state, newDrafts);
    await updateJob(state.job_id, { draft: finalDocument });
    return {
      chapter_drafts: newDrafts,
      current_chapter_index: nextChapterIndex,
      final_document: finalDocument,
      status: "reviewing",
      current_agent: "reviewer",
    };
  }

  return {
    chapter_drafts: newDrafts,
    current_chapter_index: nextChapterIndex,
    // Remain in writing status to continue writing next chapter
    status: "writing",
    current_agent: "writer",
  };
}

function assembleFinalDocument(state: AgentState): string {
  return assembleFinalDocumentFromDrafts(state, state.chapter_drafts);
}

function assembleFinalDocumentFromDrafts(
  state: AgentState,
  drafts: string[]
): string {
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
    ...drafts.map((draft, i) => `${draft}\n`),
    ``,
    `---`,
    `*Generated using ProjectAi — ${outline.citation_style} citation style*`,
  ].join("\n");
}

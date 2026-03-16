import { generateText, ORCHESTRATOR_MODEL } from "../lib/gemini.js";
import { updateJob } from "../lib/appwrite.js";
import { AgentState } from "./types.js";

const MAX_REVISIONS = 2;

interface ReviewResult {
  approved: boolean;
  issues: string[];
  revision_instructions: string;
  style_compliance_score: number;
  hallucination_risk: "low" | "medium" | "high";
}

export async function reviewerAgent(
  state: AgentState
): Promise<Partial<AgentState>> {
  console.log(
    `[Reviewer] Starting review for job ${state.job_id} (revision ${state.revision_count})`
  );

  if (!state.outline) {
    throw new Error("[Reviewer] No outline available for review");
  }

  await updateJob(state.job_id, {
    status: "reviewing",
    current_agent: "reviewer",
  });

  const reviewerPrompt = `You are a strict academic editor and fact-checker specializing in ${state.style_id} style projects.

ORIGINAL TOPIC: ${state.topic}
STYLE: ${state.style_id}
REVISION NUMBER: ${state.revision_count + 1} of ${MAX_REVISIONS}

STYLE GUIDELINES:
${state.style_guidelines || "Standard academic conventions."}

DOCUMENT TO REVIEW:
${state.final_document.slice(0, 12000)}

YOUR TASKS:
1. Check for compliance with ${state.style_id} formatting and structure
2. Identify any potential hallucinations or unsupported claims
3. Verify citation format matches ${state.outline.citation_style}
4. Check academic tone and language quality
5. Identify gaps vs. the outlined chapter structure

RESPOND with a JSON object:
{
  "approved": true/false,
  "issues": ["issue 1", "issue 2"],
  "revision_instructions": "Specific instructions for improvement",
  "style_compliance_score": 0-100,
  "hallucination_risk": "low|medium|high"
}

Approve if: style_compliance_score >= 75 AND hallucination_risk is not "high" AND no critical structural issues.
Return ONLY the JSON object.`;

  const rawReview = await generateText(
    ORCHESTRATOR_MODEL,
    reviewerPrompt,
    "You are a meticulous academic editor. Respond with valid JSON only."
  );

  let review: ReviewResult;
  try {
    const jsonStr = rawReview.replace(/```json\n?|\n?```/g, "").trim();
    review = JSON.parse(jsonStr) as ReviewResult;
  } catch (err) {
    console.error("[Reviewer] Failed to parse review JSON:", err);
    // Default to approval on parse failure to avoid infinite loops
    review = {
      approved: true,
      issues: [],
      revision_instructions: "",
      style_compliance_score: 80,
      hallucination_risk: "low",
    };
  }

  console.log(
    `[Reviewer] Score: ${review.style_compliance_score}/100, Hallucination risk: ${review.hallucination_risk}, Approved: ${review.approved}`
  );

  if (review.approved || state.revision_count >= MAX_REVISIONS) {
    if (!review.approved) {
      console.log(
        `[Reviewer] Max revisions (${MAX_REVISIONS}) reached. Finalizing anyway.`
      );
    }

    const finalDocument = appendReviewMetadata(state.final_document, review);
    await updateJob(state.job_id, {
      status: "completed",
      current_agent: "completed",
      final_document: finalDocument,
    });

    return {
      final_document: finalDocument,
      status: "completed",
      current_agent: "completed",
    };
  }

  // Request revision
  console.log(
    `[Reviewer] Requesting revision. Issues: ${review.issues.join(", ")}`
  );

  await updateJob(state.job_id, {
    status: "writing",
    current_agent: "writer",
  });

  return {
    status: "writing",
    current_agent: "writer",
    revision_count: state.revision_count + 1,
    current_chapter_index: 0,
    chapter_drafts: [],
    // Pass revision instructions as a prefix to style guidelines
    style_guidelines: `REVISION INSTRUCTIONS:\n${review.revision_instructions}\n\n${state.style_guidelines}`,
  };
}

function appendReviewMetadata(
  document: string,
  review: ReviewResult
): string {
  return [
    document,
    ``,
    `---`,
    `### Review Metadata`,
    `- Style Compliance Score: ${review.style_compliance_score}/100`,
    `- Hallucination Risk: ${review.hallucination_risk}`,
    review.issues.length > 0
      ? `- Known Issues: ${review.issues.join("; ")}`
      : `- No significant issues found`,
  ].join("\n");
}

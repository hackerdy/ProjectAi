import { z } from "zod";

export const ChapterSchema = z.object({
  number: z.number(),
  title: z.string(),
  description: z.string(),
  key_points: z.array(z.string()),
  expected_length: z.string(),
});

export const OutlineSchema = z.object({
  project_title: z.string(),
  style_id: z.string(),
  abstract: z.string(),
  chapters: z.array(ChapterSchema),
  research_queries: z.array(z.string()),
  formatting_notes: z.string(),
  citation_style: z.string(),
});

export type Chapter = z.infer<typeof ChapterSchema>;
export type Outline = z.infer<typeof OutlineSchema>;

export interface AgentState {
  job_id: string;
  topic: string;
  style_id: string;
  style_guidelines: string;
  outline: Outline | null;
  research_results: string;
  current_chapter_index: number;
  chapter_drafts: string[];
  final_document: string;
  revision_count: number;
  status:
    | "planning"
    | "researching"
    | "writing"
    | "reviewing"
    | "completed"
    | "failed";
  current_agent: string;
  error_message: string;
}

export const initialAgentState = (
  jobId: string,
  topic: string,
  styleId: string
): AgentState => ({
  job_id: jobId,
  topic,
  style_id: styleId,
  style_guidelines: "",
  outline: null,
  research_results: "",
  current_chapter_index: 0,
  chapter_drafts: [],
  final_document: "",
  revision_count: 0,
  status: "planning",
  current_agent: "planner",
  error_message: "",
});

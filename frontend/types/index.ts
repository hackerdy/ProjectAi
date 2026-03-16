export type JobStatus =
  | "queued"
  | "planning"
  | "researching"
  | "writing"
  | "reviewing"
  | "completed"
  | "failed";

export interface Job {
  $id: string;
  topic: string;
  style_id: string;
  status: JobStatus;
  current_agent: string;
  outline: string;
  research: string;
  draft: string;
  final_document: string;
  error_message: string;
  created_at: string;
  updated_at: string;
}

export interface Style {
  $id: string;
  name: string;
  style_id: string;
  description: string;
  created_at: string;
}

export interface CreateJobResponse {
  job_id: string;
  status: JobStatus;
  topic: string;
  style_id: string;
  created_at: string;
  message: string;
}

export interface WebSocketMessage {
  type:
    | "connected"
    | "status_update"
    | "job_completed"
    | "job_failed"
    | "agent_progress";
  job_id?: string;
  status?: JobStatus;
  current_agent?: string;
  message?: string;
  final_document?: string;
  error_message?: string;
}

export type AgentStep = {
  id: string;
  label: string;
  icon: string;
  statuses: JobStatus[];
};

export const AGENT_STEPS: AgentStep[] = [
  {
    id: "planner",
    label: "Planning",
    icon: "📋",
    statuses: ["planning"],
  },
  {
    id: "researcher",
    label: "Researching",
    icon: "🔍",
    statuses: ["researching"],
  },
  {
    id: "writer",
    label: "Writing",
    icon: "✍️",
    statuses: ["writing"],
  },
  {
    id: "reviewer",
    label: "Reviewing",
    icon: "🔎",
    statuses: ["reviewing"],
  },
  {
    id: "completed",
    label: "Completed",
    icon: "✅",
    statuses: ["completed"],
  },
];

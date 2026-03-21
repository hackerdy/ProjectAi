const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export async function downloadJobDocx(jobId: string, filename?: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/jobs/${jobId}/download`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Download failed" }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? "research_paper.docx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

import { JobHistoryItem } from "@/types";

export async function createJob(
  topic: string,
  styleId: string
): Promise<{ job_id: string; status: string; progress_percent: number }> {
  const res = await fetch(`${BACKEND_URL}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, style_id: styleId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  return res.json();
}

export async function getJob(jobId: string) {
  const res = await fetch(`${BACKEND_URL}/api/jobs/${jobId}`);
  if (!res.ok) throw new Error(`Job not found: ${jobId}`);
  return res.json();
}

export async function listJobHistory(limit = 30): Promise<JobHistoryItem[]> {
  const res = await fetch(`${BACKEND_URL}/api/jobs/history?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch job history");
  const data = await res.json();
  return data.history ?? data.jobs ?? [];
}

export async function getFinalDocument(jobId: string): Promise<{
  job_id: string;
  topic: string;
  style_id: string;
  status: string;
  progress_percent: number;
  final_document: string;
  updated_at: string;
}> {
  const res = await fetch(`${BACKEND_URL}/api/jobs/${jobId}/final`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to fetch final document" }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function listStyles(): Promise<
  Array<{ $id: string; name: string; style_id: string; description: string }>
> {
  const res = await fetch(`${BACKEND_URL}/api/jobs/styles/list`);
  if (!res.ok) throw new Error("Failed to fetch styles");
  const data = await res.json();
  return data.styles ?? [];
}

export async function uploadDocument(
  file: File,
  styleId: string,
  styleName: string,
  description?: string
): Promise<{ success: boolean; chunks_processed: number; message: string }> {
  const formData = new FormData();
  formData.append("document", file);
  formData.append("style_id", styleId);
  formData.append("style_name", styleName);
  if (description) formData.append("description", description);

  const res = await fetch(`${BACKEND_URL}/api/admin/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  return res.json();
}

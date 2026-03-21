import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  createJob,
  getAppwriteErrorInfo,
  getJob,
  listJobs,
  listStyles,
} from "../lib/appwrite.js";
import { runAgentPipeline } from "../agents/graph.js";
import { generateDocx, DocxInput } from "../lib/docxGenerator.js";

const router = Router();

const CreateJobSchema = z.object({
  topic: z.string().min(10, "Topic must be at least 10 characters").max(500),
  style_id: z.string().min(1, "style_id is required"),
});

const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// POST /api/jobs — Create and start a new research job
router.post("/", async (req: Request, res: Response) => {
  const parsed = CreateJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parsed.error.flatten(),
    });
  }

  const { topic, style_id } = parsed.data;

  try {
    const job = await createJob(topic, style_id);

    // Run the agent pipeline asynchronously (non-blocking)
    setImmediate(() => {
      runAgentPipeline(job.$id, topic, style_id).catch((err) => {
        console.error(`[Jobs Route] Pipeline error for job ${job.$id}:`, err);
      });
    });

    return res.status(201).json({
      job_id: job.$id,
      status: job.status,
      progress_percent: job.progress_percent,
      topic: job.topic,
      style_id: job.style_id,
      created_at: job.created_at,
      message: "Job started. Connect to WebSocket for real-time updates.",
    });
  } catch (err) {
    console.error("[Jobs Route] Failed to create job:", err);
    const appwriteErr = getAppwriteErrorInfo(err);

    if (appwriteErr.type === "collection_not_found" || appwriteErr.code === 404) {
      return res.status(500).json({
        error: "Appwrite collection is missing. Create the jobs collection and verify APPWRITE_JOBS_COLLECTION_ID.",
      });
    }

    if (appwriteErr.type === "user_unauthorized" || appwriteErr.code === 401) {
      return res.status(500).json({
        error:
          "Appwrite write access failed. Ensure APPWRITE_API_KEY is set and has database document create permissions.",
      });
    }

    return res.status(500).json({ error: appwriteErr.message || "Failed to create job" });
  }
});

// GET /api/jobs/history — List recent jobs for history panel
router.get("/history", async (req: Request, res: Response) => {
  const parsed = HistoryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid query parameters",
      details: parsed.error.flatten(),
    });
  }

  try {
    const jobs = await listJobs(parsed.data.limit ?? 30);
    const history = jobs.map((job) => ({
      job_id: job.$id,
      topic: job.topic,
      style_id: job.style_id,
      status: job.status,
      progress_percent: job.progress_percent,
      current_agent: job.current_agent,
      has_final_document: job.final_document.trim().length > 0,
      created_at: job.created_at,
      updated_at: job.updated_at,
      error_message: job.error_message,
    }));

    return res.json({ history });
  } catch (err) {
    console.error("[Jobs Route] Failed to list history:", err);
    const appwriteErr = getAppwriteErrorInfo(err);
    return res.status(500).json({ error: appwriteErr.message || "Failed to list history" });
  }
});

// GET /api/jobs/:jobId/final — Get final document for completed jobs
router.get("/:jobId/final", async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.jobId);
    if (!job.final_document || job.final_document.trim().length === 0) {
      return res.status(409).json({
        error: "Final document is not ready yet",
        status: job.status,
        progress_percent: job.progress_percent,
      });
    }

    return res.json({
      job_id: job.$id,
      topic: job.topic,
      style_id: job.style_id,
      status: job.status,
      progress_percent: job.progress_percent,
      final_document: job.final_document,
      updated_at: job.updated_at,
    });
  } catch (err) {
    console.error("[Jobs Route] Failed to get final document:", err);
    const appwriteErr = getAppwriteErrorInfo(err);
    if (appwriteErr.code === 404 || appwriteErr.type === "document_not_found") {
      return res.status(404).json({ error: "Job not found" });
    }
    return res.status(500).json({ error: appwriteErr.message || "Failed to get final document" });
  }
});

// GET /api/jobs/:jobId/download — Generate and download a .docx Word document
router.get("/:jobId/download", async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.jobId);

    if (!job.final_document || job.final_document.trim().length === 0) {
      return res.status(409).json({
        error: "Document not ready yet — job has not completed.",
        status: job.status,
        progress_percent: job.progress_percent,
      });
    }

    // Parse the stored outline to recover title and citation style
    let projectTitle  = job.topic;
    let citationStyle = "APA";

    if (job.outline) {
      try {
        const outline = JSON.parse(job.outline);
        if (outline.project_title) projectTitle  = outline.project_title;
        if (outline.citation_style) citationStyle = outline.citation_style;
      } catch {
        // outline JSON malformed — fall back to topic / APA
      }
    }

    const input: DocxInput = {
      title:         projectTitle,
      topic:         job.topic,
      styleId:       job.style_id,
      citationStyle,
      finalDocument: job.final_document,
    };

    console.log(`[Download] Generating .docx for job ${job.$id} — "${projectTitle}"`);
    const docxBuffer = await generateDocx(input);

    // Build a safe filename from the topic
    const safeName = job.topic
      .slice(0, 60)
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_");

    const filename = `${safeName || "research_paper"}.docx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", docxBuffer.length);
    res.setHeader("Cache-Control", "no-store");
    return res.send(docxBuffer);
  } catch (err) {
    console.error("[Download] Failed to generate docx:", err);
    const appwriteErr = getAppwriteErrorInfo(err);
    if (appwriteErr.code === 404 || appwriteErr.type === "document_not_found") {
      return res.status(404).json({ error: "Job not found" });
    }
    return res.status(500).json({
      error: "Failed to generate Word document",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// GET /api/jobs/:jobId — Get job status
router.get("/:jobId", async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.jobId);
    return res.json({
      ...job,
      job_id: job.$id,
    });
  } catch (err) {
    console.error("[Jobs Route] Failed to get job:", err);
    const appwriteErr = getAppwriteErrorInfo(err);
    if (appwriteErr.code === 404 || appwriteErr.type === "document_not_found") {
      return res.status(404).json({ error: "Job not found" });
    }
    return res.status(500).json({ error: appwriteErr.message || "Failed to get job" });
  }
});

// GET /api/jobs/styles/list — List available styles
router.get("/styles/list", async (_req: Request, res: Response) => {
  try {
    const styles = await listStyles();
    return res.json({ styles });
  } catch (err) {
    console.error("[Jobs Route] Failed to list styles:", err);
    const appwriteErr = getAppwriteErrorInfo(err);
    return res.status(500).json({ error: appwriteErr.message || "Failed to list styles" });
  }
});

export default router;

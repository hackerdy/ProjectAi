import { Router, Request, Response } from "express";
import { z } from "zod";
import { createJob, getJob, listStyles } from "../lib/appwrite.js";
import { runAgentPipeline } from "../agents/graph.js";

const router = Router();

const CreateJobSchema = z.object({
  topic: z.string().min(10, "Topic must be at least 10 characters").max(500),
  style_id: z.string().min(1, "style_id is required"),
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
      topic: job.topic,
      style_id: job.style_id,
      created_at: job.created_at,
      message: "Job started. Connect to WebSocket for real-time updates.",
    });
  } catch (err) {
    console.error("[Jobs Route] Failed to create job:", err);
    return res.status(500).json({ error: "Failed to create job" });
  }
});

// GET /api/jobs/:jobId — Get job status
router.get("/:jobId", async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.jobId);
    return res.json(job);
  } catch (err) {
    console.error("[Jobs Route] Failed to get job:", err);
    return res.status(404).json({ error: "Job not found" });
  }
});

// GET /api/jobs/styles/list — List available styles
router.get("/styles/list", async (_req: Request, res: Response) => {
  try {
    const styles = await listStyles();
    return res.json({ styles });
  } catch (err) {
    console.error("[Jobs Route] Failed to list styles:", err);
    return res.status(500).json({ error: "Failed to list styles" });
  }
});

export default router;

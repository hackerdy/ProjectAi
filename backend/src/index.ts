import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { wsManager } from "./routes/websocket.js";
import { initializeAppwriteSchema } from "./lib/appwrite.js";
import jobsRouter from "./routes/jobs.js";
import adminRouter from "./routes/admin.js";

const app = express();
const PORT = parseInt(process.env.PORT ?? "4000", 10);
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

// CORS
app.use(
  cors({
    origin: [FRONTEND_URL, "http://localhost:3000"],
    credentials: true,
  })
);

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API routes
app.use("/api/jobs", jobsRouter);
app.use("/api/admin", adminRouter);

// Create HTTP server and attach WebSocket
const server = http.createServer(app);
wsManager.initialize(server);

// Handle unhandled promise rejections to keep daemon alive
process.on("unhandledRejection", (reason, promise) => {
  console.error("[Server] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught Exception:", err);
});

async function startServer(): Promise<void> {
  await initializeAppwriteSchema();

  server.listen(PORT, () => {
    console.log(`[Server] ProjectAi backend running on port ${PORT}`);
    console.log(`[Server] WebSocket endpoint: ws://localhost:${PORT}/ws`);
    console.log(`[Server] API endpoint: http://localhost:${PORT}/api`);
    console.log(`[Server] Health check: http://localhost:${PORT}/health`);
  });
}

startServer().catch((error) => {
  console.error("[Server] Failed to initialize:", error);
  process.exit(1);
});

export default app;

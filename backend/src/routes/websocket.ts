import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";

interface WebSocketMessage {
  type: string;
  job_id?: string;
  [key: string]: unknown;
}

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, Set<WebSocket>>();

  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws: WebSocket, req) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const jobId = url.searchParams.get("job_id");

      if (!jobId) {
        ws.close(1008, "job_id parameter required");
        return;
      }

      if (!this.clients.has(jobId)) {
        this.clients.set(jobId, new Set());
      }
      this.clients.get(jobId)!.add(ws);

      console.log(`[WS] Client connected for job ${jobId}`);

      ws.on("close", () => {
        const jobClients = this.clients.get(jobId);
        if (jobClients) {
          jobClients.delete(ws);
          if (jobClients.size === 0) {
            this.clients.delete(jobId);
          }
        }
        console.log(`[WS] Client disconnected from job ${jobId}`);
      });

      ws.on("error", (err) => {
        console.error(`[WS] Error for job ${jobId}:`, err);
      });

      // Send initial connection confirmation
      ws.send(
        JSON.stringify({
          type: "connected",
          job_id: jobId,
          message: "Connected to job status stream",
        })
      );
    });

    console.log("[WS] WebSocket server initialized on /ws");
  }

  broadcast(jobId: string, message: WebSocketMessage): void {
    const jobClients = this.clients.get(jobId);
    if (!jobClients || jobClients.size === 0) return;

    const payload = JSON.stringify(message);
    for (const client of jobClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  broadcastAll(message: WebSocketMessage): void {
    const payload = JSON.stringify(message);
    for (const [, clients] of this.clients) {
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    }
  }
}

export const wsManager = new WebSocketManager();

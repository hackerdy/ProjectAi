"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { WebSocketMessage, JobStatus } from "@/types";

interface UseJobStatusOptions {
  jobId: string | null;
  onCompleted?: (document: string) => void;
  onFailed?: (error: string) => void;
  pollInterval?: number;
}

interface UseJobStatusReturn {
  status: JobStatus | null;
  currentAgent: string;
  isConnected: boolean;
  messages: WebSocketMessage[];
}

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";

export function useJobStatus({
  jobId,
  onCompleted,
  onFailed,
  pollInterval = 3000,
}: UseJobStatusOptions): UseJobStatusReturn {
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [currentAgent, setCurrentAgent] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleMessage = useCallback(
    (msg: WebSocketMessage) => {
      setMessages((prev) => [...prev.slice(-49), msg]);

      if (msg.status) {
        setStatus(msg.status);
      }
      if (msg.current_agent) {
        setCurrentAgent(msg.current_agent);
      }
      if (msg.type === "job_completed" && msg.final_document) {
        onCompleted?.(msg.final_document);
      }
      if (msg.type === "job_failed" && msg.error_message) {
        onFailed?.(msg.error_message);
      }
    },
    [onCompleted, onFailed]
  );

  // WebSocket connection
  useEffect(() => {
    if (!jobId) return;

    const ws = new WebSocket(`${WS_URL}/ws?job_id=${jobId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg: WebSocketMessage = JSON.parse(event.data as string);
        handleMessage(msg);
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      setIsConnected(false);
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [jobId, handleMessage]);

  // Fallback polling for when WebSocket is not connected
  useEffect(() => {
    if (!jobId || isConnected) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    pollTimerRef.current = setInterval(async () => {
      try {
        const BACKEND_URL =
          process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
        const res = await fetch(`${BACKEND_URL}/api/jobs/${jobId}`);
        if (!res.ok) return;
        const job = await res.json();
        setStatus(job.status);
        setCurrentAgent(job.current_agent ?? "");

        if (job.status === "completed" && job.final_document) {
          onCompleted?.(job.final_document);
          clearInterval(pollTimerRef.current!);
        } else if (job.status === "failed") {
          onFailed?.(job.error_message ?? "Job failed");
          clearInterval(pollTimerRef.current!);
        }
      } catch {
        // ignore polling errors
      }
    }, pollInterval);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [jobId, isConnected, pollInterval, onCompleted, onFailed]);

  return { status, currentAgent, isConnected, messages };
}

import { StateGraph, Annotation, END } from "@langchain/langgraph";
import { plannerAgent } from "./plannerAgent.js";
import { researcherAgent } from "./researcherAgent.js";
import { writerAgent } from "./writerAgent.js";
import { reviewerAgent } from "./reviewerAgent.js";
import { AgentState, Outline, initialAgentState } from "./types.js";
import { updateJob } from "../lib/appwrite.js";
import { wsManager } from "../routes/websocket.js";

// Define the LangGraph state using Annotation.Root (v0.2 API)
const AgentStateAnnotation = Annotation.Root({
  job_id: Annotation<string>,
  topic: Annotation<string>,
  style_id: Annotation<string>,
  style_guidelines: Annotation<string>,
  outline: Annotation<Outline | null>,
  research_results: Annotation<string>,
  current_chapter_index: Annotation<number>,
  chapter_drafts: Annotation<string[]>,
  final_document: Annotation<string>,
  revision_count: Annotation<number>,
  progress_percent: Annotation<number>,
  status: Annotation<
    | "planning"
    | "researching"
    | "writing"
    | "reviewing"
    | "completed"
    | "failed"
  >,
  current_agent: Annotation<string>,
  error_message: Annotation<string>,
});

type GraphState = typeof AgentStateAnnotation.State;
type GraphNodeHandler = (state: GraphState) => Promise<Partial<GraphState>>;

function isTransientAgentError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econn") ||
    message.includes("enotfound") ||
    message.includes("socket") ||
    message.includes("503") ||
    message.includes("429")
  );
}

async function runNodeWithRetries(
  nodeName: string,
  handler: GraphNodeHandler,
  state: GraphState
): Promise<Partial<GraphState>> {
  const maxRetries = Math.max(0, Number(process.env.AGENT_NODE_MAX_RETRIES ?? 2));
  const baseDelayMs = Math.max(250, Number(process.env.AGENT_NODE_RETRY_BASE_MS ?? 1500));

  let attempt = 0;
  while (true) {
    try {
      return await handler(state);
    } catch (error) {
      if (!isTransientAgentError(error) || attempt >= maxRetries) {
        throw error;
      }

      const waitMs = baseDelayMs * Math.pow(2, attempt);
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[Pipeline] ${nodeName} attempt ${attempt + 1} failed with transient error: ${message}. Retrying in ${waitMs}ms.`
      );

      await new Promise((resolve) => setTimeout(resolve, waitMs));
      attempt += 1;
    }
  }
}

function routeFromWriter(
  state: GraphState
): "writer" | "reviewer" | typeof END {
  if (state.status === "reviewing") return "reviewer";
  if (state.status === "writing") return "writer";
  return END;
}

function routeFromReviewer(
  state: GraphState
): "writer" | typeof END {
  if (state.status === "writing") return "writer";
  return END;
}

export function buildGraph() {
  const graph = new StateGraph(AgentStateAnnotation);

  graph
    .addNode("planner", (state: GraphState) =>
      runNodeWithRetries("planner", plannerAgent as GraphNodeHandler, state)
    )
    .addNode("researcher", (state: GraphState) =>
      runNodeWithRetries("researcher", researcherAgent as GraphNodeHandler, state)
    )
    .addNode("writer", (state: GraphState) =>
      runNodeWithRetries("writer", writerAgent as GraphNodeHandler, state)
    )
    .addNode("reviewer", (state: GraphState) =>
      runNodeWithRetries("reviewer", reviewerAgent as GraphNodeHandler, state)
    )
    .addEdge("__start__", "planner")
    .addEdge("planner", "researcher")
    .addEdge("researcher", "writer")
    .addConditionalEdges("writer", routeFromWriter, {
      writer: "writer",
      reviewer: "reviewer",
      [END]: END,
    })
    .addConditionalEdges("reviewer", routeFromReviewer, {
      writer: "writer",
      [END]: END,
    });

  return graph.compile();
}

export async function runAgentPipeline(
  jobId: string,
  topic: string,
  styleId: string
): Promise<void> {
  const state: AgentState = initialAgentState(jobId, topic, styleId);
  const graph = buildGraph();

  console.log(
    `[Pipeline] Starting job ${jobId} for topic "${topic}" with style "${styleId}"`
  );

  try {
    const recursionLimit = Number(process.env.GRAPH_RECURSION_LIMIT ?? 120);
    const finalState = await graph.invoke(state as GraphState, {
      recursionLimit: Number.isFinite(recursionLimit)
        ? Math.max(30, Math.floor(recursionLimit))
        : 120,
    });

    console.log(`[Pipeline] Job ${jobId} completed successfully`);
    wsManager.broadcast(jobId, {
      type: "job_completed",
      job_id: jobId,
      status: "completed",
      final_document: (finalState as AgentState).final_document,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error occurred";
    console.error(`[Pipeline] Job ${jobId} failed:`, errorMessage);

    await updateJob(jobId, {
      status: "failed",
      progress_percent: 100,
      current_agent: "failed",
      error_message: errorMessage,
    });

    wsManager.broadcast(jobId, {
      type: "job_failed",
      job_id: jobId,
      status: "failed",
      error_message: errorMessage,
    });
  }
}


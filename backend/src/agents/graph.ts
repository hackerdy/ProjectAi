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
    .addNode("planner", plannerAgent as (state: GraphState) => Promise<Partial<GraphState>>)
    .addNode("researcher", researcherAgent as (state: GraphState) => Promise<Partial<GraphState>>)
    .addNode("writer", writerAgent as (state: GraphState) => Promise<Partial<GraphState>>)
    .addNode("reviewer", reviewerAgent as (state: GraphState) => Promise<Partial<GraphState>>)
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
    const finalState = await graph.invoke(state as GraphState);

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


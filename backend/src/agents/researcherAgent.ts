import { updateJob } from "../lib/appwrite.js";
import { AgentState } from "./types.js";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface ZyteResult {
  url: string;
  text: string;
}

async function searchTavily(query: string): Promise<TavilyResult[]> {
  if (!process.env.TAVILY_API_KEY) {
    console.warn("[Researcher] TAVILY_API_KEY not set, skipping Tavily search");
    return [];
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "advanced",
      max_results: 5,
      include_answer: true,
    }),
  });

  if (!response.ok) {
    console.error(
      `[Researcher] Tavily search failed: ${response.status} ${response.statusText}`
    );
    return [];
  }

  const data = await response.json() as { results: TavilyResult[] };
  return data.results ?? [];
}

async function scrapeWithZyte(url: string): Promise<ZyteResult | null> {
  if (!process.env.ZYTE_API_KEY) {
    console.warn("[Researcher] ZYTE_API_KEY not set, skipping Zyte scrape");
    return null;
  }

  const response = await fetch("https://api.zyte.com/v1/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${process.env.ZYTE_API_KEY}:`).toString("base64")}`,
    },
    body: JSON.stringify({
      url,
      article: true,
      articleOptions: { extractFrom: "article" },
    }),
  });

  if (!response.ok) {
    console.error(
      `[Researcher] Zyte scrape failed for ${url}: ${response.status}`
    );
    return null;
  }

  const data = await response.json() as { article?: { bodyText?: string } };
  const text = data.article?.bodyText;
  if (!text) return null;

  return { url, text };
}

export async function researcherAgent(
  state: AgentState
): Promise<Partial<AgentState>> {
  console.log(`[Researcher] Starting for job ${state.job_id}`);

  if (!state.outline) {
    throw new Error("[Researcher] No outline available to research");
  }

  await updateJob(state.job_id, {
    status: "researching",
    current_agent: "researcher",
  });

  const queries = state.outline.research_queries;
  const allResults: string[] = [];

  for (const query of queries) {
    console.log(`[Researcher] Searching: "${query}"`);

    const tavilyResults = await searchTavily(query);

    for (const result of tavilyResults.slice(0, 3)) {
      allResults.push(
        `## Source: ${result.title}\nURL: ${result.url}\n\n${result.content}`
      );

      // Attempt deep scrape for top result
      if (result.score > 0.7) {
        const scraped = await scrapeWithZyte(result.url);
        if (scraped) {
          allResults.push(
            `### Deep Scrape of ${scraped.url}\n\n${scraped.text.slice(0, 3000)}`
          );
        }
      }
    }
  }

  const compiledResearch = [
    `# Research Compilation`,
    `## Topic: ${state.topic}`,
    `## Style: ${state.style_id}`,
    `## Queries Executed: ${queries.length}`,
    `---`,
    allResults.join("\n\n---\n\n"),
  ].join("\n\n");

  console.log(
    `[Researcher] Compiled ${allResults.length} research sources, total length: ${compiledResearch.length} chars`
  );

  await updateJob(state.job_id, {
    research: compiledResearch,
  });

  return {
    research_results: compiledResearch,
    status: "writing",
    current_agent: "writer",
  };
}

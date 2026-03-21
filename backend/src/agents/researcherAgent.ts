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

let zyteAuthUnavailable = false;

function getZyteApiKey(): string {
  return (process.env.ZYTE_API_KEY ?? "").trim().replace(/^['\"]|['\"]$/g, "");
}

class ZyteAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZyteAuthError";
  }
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
  if (zyteAuthUnavailable) {
    return null;
  }

  const apiKey = getZyteApiKey();
  if (!apiKey) {
    throw new ZyteAuthError(
      "ZYTE_API_KEY is missing. Set a valid Zyte API key from https://app.zyte.com (API section)."
    );
  }

  const response = await fetch("https://api.zyte.com/v1/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    },
    body: JSON.stringify({
      url,
      article: true,
    }),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      zyteAuthUnavailable = true;
      const body = await response.text();
      throw new ZyteAuthError(
        `Zyte authentication failed (${response.status}). Response: ${body.slice(0, 300)}`
      );
    }

    console.error(
      `[Researcher] Zyte scrape failed for ${url}: ${response.status}`
    );
    return null;
  }

  const data = await response.json() as { article?: { bodyText?: string } };
  const text = data.article?.bodyText;
  if (!text) {
    return null;
  }

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
    progress_percent: 35,
    current_agent: "researcher",
  });

  const queries = state.outline.research_queries;
  const allResults: string[] = [];

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
    const query = queries[queryIndex];
    console.log(`[Researcher] Searching: "${query}"`);

    const queryProgress = 35 + Math.round(((queryIndex + 1) / Math.max(queries.length, 1)) * 20);
    await updateJob(state.job_id, {
      progress_percent: queryProgress,
    });

    const tavilyResults = await searchTavily(query);

    for (const result of tavilyResults.slice(0, 3)) {
      allResults.push(
        `## Source: ${result.title}\nURL: ${result.url}\n\n${result.content}`
      );

      // Attempt deep scrape for top result
      if (result.score > 0.7) {
        try {
          const scraped = await scrapeWithZyte(result.url);
          if (scraped) {
            allResults.push(
              `### Deep Scrape of ${scraped.url}\n\n${scraped.text.slice(0, 3000)}`
            );
          }
        } catch (error) {
          if (error instanceof ZyteAuthError) {
            throw new Error(
              `[Researcher] ${error.message} Verify that ZYTE_API_KEY is a Zyte API key (not Scrapy Cloud project credentials) and regenerate it if needed.`
            );
          }
          throw error;
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
    progress_percent: 55,
  });

  return {
    research_results: compiledResearch,
    progress_percent: 55,
    status: "writing",
    current_agent: "writer",
  };
}

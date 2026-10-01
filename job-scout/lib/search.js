// Tavily (web search) and Firecrawl (page -> clean text / structured data) clients.

import { postJSON } from "./http.js";

export const hasTavily = () => Boolean(process.env.TAVILY_API_KEY);
export const hasFirecrawl = () => Boolean(process.env.FIRECRAWL_API_KEY);

export async function tavilySearch(query, { maxResults = 8, includeDomains } = {}) {
  if (!hasTavily()) return [];
  const data = await postJSON(
    "https://api.tavily.com/search",
    {
      query,
      max_results: maxResults,
      search_depth: "basic",
      ...(includeDomains ? { include_domains: includeDomains } : {}),
    },
    { headers: { authorization: `Bearer ${process.env.TAVILY_API_KEY}` }, timeoutMs: 15000 },
  );
  return (data.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
}

async function firecrawlScrape(body, timeoutMs) {
  const data = await postJSON(
    "https://api.firecrawl.dev/v1/scrape",
    { timeout: timeoutMs - 2000, ...body },
    { headers: { authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}` }, timeoutMs },
  );
  if (!data.success) throw new Error(`Firecrawl failed for ${body.url}`);
  return data.data || {};
}

// Every link on a page (used to spot an embedded ATS board on a company careers page).
export async function firecrawlLinks(url) {
  if (!hasFirecrawl()) return [];
  const data = await firecrawlScrape({ url, formats: ["links"] }, 25000);
  return data.links || [];
}

const JOBS_SCHEMA = {
  type: "object",
  properties: {
    jobs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          location: { type: "string" },
          pay: { type: "string" },
          url: { type: "string" },
        },
        required: ["title"],
      },
    },
  },
  required: ["jobs"],
};

// Open a careers page and pull out the job listings as structured data.
export async function firecrawlJobs(url, roleQuery) {
  if (!hasFirecrawl()) return [];
  const data = await firecrawlScrape(
    {
      url,
      formats: ["json"],
      onlyMainContent: true,
      jsonOptions: {
        schema: JOBS_SCHEMA,
        prompt: `List every open job posting on this page${roleQuery ? `, especially roles related to "${roleQuery}"` : ""}. For each: exact job title, location, pay range if shown (else empty), and the absolute URL of the posting.`,
      },
    },
    45000,
  );
  return data.json?.jobs || [];
}

// Adapters for public applicant-tracking-system (ATS) job board APIs.
// Each adapter can: detect itself from a URL, probe a slug guess, and list every posting
// as a normalized { title, location, remote, payText, payMin, payMax, url } record.

import { getJSON, postJSON, tryJSON } from "./http.js";
import { parsePay, payFromRange } from "./pay.js";

const stripHtml = (s = "") =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

const looksRemote = (...parts) => /remote|anywhere|distributed/i.test(parts.filter(Boolean).join(" "));

export const ADAPTERS = {
  greenhouse: {
    label: "Greenhouse",
    detect(url) {
      const m =
        url.match(/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i) ||
        url.match(/greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([a-z0-9_-]+)/i);
      return m && !["embed", "v1"].includes(m[1].toLowerCase()) ? { slug: m[1].toLowerCase() } : null;
    },
    async probe({ slug }) {
      const board = await tryJSON(() => getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}`, { timeoutMs: 6000 }));
      if (!board?.name) return null;
      const jobs = await tryJSON(() => getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, { timeoutMs: 8000 }));
      return { boardName: board.name, jobCount: jobs?.jobs?.length ?? 0, boardUrl: `https://job-boards.greenhouse.io/${slug}` };
    },
    async list({ slug }) {
      const data = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`, { timeoutMs: 15000 });
      return (data.jobs || []).map((j) => {
        const text = stripHtml(j.content);
        const pay = parsePay(text);
        return {
          title: j.title,
          location: j.location?.name || "",
          remote: looksRemote(j.location?.name, j.title),
          ...pay,
          url: j.absolute_url,
        };
      });
    },
  },

  lever: {
    label: "Lever",
    detect(url) {
      const m = url.match(/jobs(?:\.eu)?\.lever\.co\/([a-z0-9_.-]+)/i);
      return m ? { slug: m[1].toLowerCase() } : null;
    },
    async probe({ slug }) {
      const jobs = await tryJSON(() => getJSON(`https://api.lever.co/v0/postings/${slug}?mode=json`, { timeoutMs: 8000 }));
      if (!Array.isArray(jobs)) return null;
      return { jobCount: jobs.length, boardUrl: `https://jobs.lever.co/${slug}` };
    },
    async list({ slug }) {
      const jobs = await getJSON(`https://api.lever.co/v0/postings/${slug}?mode=json`, { timeoutMs: 15000 });
      return jobs.map((j) => {
        const pay = j.salaryRange ? payFromRange(j.salaryRange.min, j.salaryRange.max, j.salaryRange.currency, j.salaryRange.interval) : parsePay(j.descriptionPlain || "");
        const location = j.categories?.allLocations?.join(" / ") || j.categories?.location || "";
        return {
          title: j.text,
          location,
          remote: j.workplaceType === "remote" || looksRemote(location),
          ...pay,
          url: j.hostedUrl,
        };
      });
    },
  },

  ashby: {
    label: "Ashby",
    detect(url) {
      const m = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/i);
      return m ? { slug: decodeURIComponent(m[1]) } : null;
    },
    async probe({ slug }) {
      const data = await tryJSON(() => getJSON(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`, { timeoutMs: 8000 }));
      if (!data?.jobs) return null;
      return { jobCount: data.jobs.length, boardUrl: `https://jobs.ashbyhq.com/${encodeURIComponent(slug)}` };
    },
    async list({ slug }) {
      const data = await getJSON(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`,
        { timeoutMs: 15000 },
      );
      return (data.jobs || [])
        .filter((j) => j.isListed !== false)
        .map((j) => {
          const comp = j.compensation;
          const salary = comp?.summaryComponents?.find((c) => /salary/i.test(c.compensationType || ""));
          let pay = salary
            ? payFromRange(salary.minValue, salary.maxValue, salary.currencyCode, salary.interval)
            : parsePay(comp?.compensationTierSummary || "");
          if (!pay.payText && comp?.compensationTierSummary) pay = { ...pay, payText: comp.compensationTierSummary };
          const location = [j.location, ...(j.secondaryLocations || []).map((l) => l.location)].filter(Boolean).join(" / ");
          return {
            title: j.title,
            location,
            remote: j.isRemote === true || j.workplaceType === "Remote" || looksRemote(location),
            ...pay,
            url: j.jobUrl,
          };
        });
    },
  },

  workday: {
    label: "Workday",
    // Workday boards look like https://{tenant}.wd5.myworkdayjobs.com/en-US/{site}/...
    detect(url) {
      const m = url.match(/https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/);
      if (!m || ["wday", "job", "details"].includes(m[3])) return null;
      return { tenant: m[1], dc: m[2], site: m[3] };
    },
    async probe(ref) {
      const data = await tryJSON(() => workdaySearch(ref, "", 0, 1));
      if (!data) return null;
      return { jobCount: data.total ?? 0, boardUrl: workdayBase(ref) };
    },
    // Workday has no "list everything" endpoint, so this adapter searches by keyword.
    async list(ref, { keywords = [] } = {}) {
      const terms = keywords.length ? keywords.slice(0, 4) : [""];
      const seen = new Map();
      for (const term of terms) {
        for (let offset = 0; offset < 60; offset += 20) {
          const data = await tryJSON(() => workdaySearch(ref, term, offset, 20));
          const posts = data?.jobPostings || [];
          for (const p of posts) {
            const url = `${workdayBase(ref)}${p.externalPath}`;
            if (!seen.has(url)) {
              seen.set(url, {
                title: p.title,
                location: p.locationsText || "",
                remote: looksRemote(p.locationsText, p.remoteType),
                payText: "",
                payMin: null,
                payMax: null,
                url,
              });
            }
          }
          if (posts.length < 20) break;
        }
      }
      return [...seen.values()];
    },
  },

  smartrecruiters: {
    label: "SmartRecruiters",
    detect(url) {
      const m = url.match(/(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/);
      return m ? { slug: m[1] } : null;
    },
    async probe({ slug }) {
      const data = await tryJSON(() => getJSON(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`, { timeoutMs: 8000 }));
      if (!data || !data.totalFound) return null;
      return { jobCount: data.totalFound, boardUrl: `https://jobs.smartrecruiters.com/${slug}` };
    },
    async list({ slug }) {
      const out = [];
      for (let offset = 0; offset < 500; offset += 100) {
        const data = await getJSON(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&offset=${offset}`, { timeoutMs: 15000 });
        for (const p of data.content || []) {
          const loc = p.location || {};
          const location = loc.fullLocation || [loc.city, loc.region, loc.country?.toUpperCase()].filter(Boolean).join(", ");
          out.push({
            title: p.name,
            location,
            remote: loc.remote === true || looksRemote(location),
            payText: "",
            payMin: null,
            payMax: null,
            url: `https://jobs.smartrecruiters.com/${slug}/${p.id}`,
          });
        }
        if (!data.content || data.content.length < 100) break;
      }
      return out;
    },
  },

  workable: {
    label: "Workable",
    detect(url) {
      const m = url.match(/apply\.workable\.com\/([a-z0-9_-]+)/i);
      return m && m[1] !== "api" ? { slug: m[1].toLowerCase() } : null;
    },
    async probe({ slug }) {
      const data = await tryJSON(() => getJSON(`https://apply.workable.com/api/v1/widget/accounts/${slug}`, { timeoutMs: 8000 }));
      if (!data?.jobs) return null;
      return { boardName: data.name, jobCount: data.jobs.length, boardUrl: `https://apply.workable.com/${slug}` };
    },
    async list({ slug }) {
      const data = await getJSON(`https://apply.workable.com/api/v1/widget/accounts/${slug}`, { timeoutMs: 15000 });
      return (data.jobs || []).map((j) => {
        const location = [j.city, j.state, j.country].filter(Boolean).join(", ");
        return {
          title: j.title,
          location: j.telecommuting ? `Remote${location ? ` (${location})` : ""}` : location,
          remote: j.telecommuting === true || looksRemote(location),
          payText: "",
          payMin: null,
          payMax: null,
          url: j.url || j.shortlink,
        };
      });
    },
  },

  recruitee: {
    label: "Recruitee",
    detect(url) {
      const m = url.match(/https?:\/\/([a-z0-9-]+)\.recruitee\.com/i);
      return m ? { slug: m[1].toLowerCase() } : null;
    },
    async probe({ slug }) {
      const data = await tryJSON(() => getJSON(`https://${slug}.recruitee.com/api/offers/`, { timeoutMs: 8000 }));
      if (!data?.offers) return null;
      return { jobCount: data.offers.length, boardUrl: `https://${slug}.recruitee.com` };
    },
    async list({ slug }) {
      const data = await getJSON(`https://${slug}.recruitee.com/api/offers/`, { timeoutMs: 15000 });
      return (data.offers || []).map((o) => {
        const pay = o.salary?.min ? payFromRange(o.salary.min, o.salary.max, o.salary.currency, o.salary.period) : { payText: "", payMin: null, payMax: null };
        return {
          title: o.title,
          location: o.location || "",
          remote: o.remote === true || looksRemote(o.location),
          ...pay,
          url: o.careers_url,
        };
      });
    },
  },
};

function workdayBase({ tenant, dc, site }) {
  return `https://${tenant}.${dc}.myworkdayjobs.com/${site}`;
}

function workdaySearch({ tenant, dc, site }, searchText, offset, limit) {
  return postJSON(
    `https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`,
    { appliedFacets: {}, limit, offset, searchText },
    { timeoutMs: 10000 },
  );
}

// Look through a list of URLs for anything that points at a known ATS board.
export function detectBoard(urls) {
  for (const url of urls) {
    for (const [ats, adapter] of Object.entries(ADAPTERS)) {
      const ref = adapter.detect(url);
      if (ref) return { ats, ref };
    }
  }
  return null;
}

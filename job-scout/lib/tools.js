// The two agent tools: update_employer_list and find_open_roles.

import { ADAPTERS, detectBoard } from "./boards.js";
import { tavilySearch, firecrawlLinks, firecrawlJobs, hasTavily } from "./search.js";
import { parsePay } from "./pay.js";

export const MAX_EMPLOYERS = 12;
const ROLES_PER_COMPANY_FOR_MODEL = 25;
const ROLES_PER_COMPANY_FOR_UI = 150;

// ---------- Tool definitions (sent to Claude) ----------

export const TOOL_DEFINITIONS = [
  {
    name: "update_employer_list",
    description:
      "Save, remove, or replace the companies on the user's target-employer list. Call this whenever the user names companies they want to work at or want to stop tracking. " +
      "Pass company names exactly as the user said them; the tool finds each company's official job board on its own (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee, or the company careers page) and reports what it found. " +
      "Returns the full saved list afterwards, including any company whose job board could not be located.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        companies: {
          type: "array",
          items: { type: "string" },
          description: "Company names, e.g. [\"Stripe\", \"Airbnb\"].",
        },
        action: {
          type: "string",
          enum: ["add", "remove", "replace"],
          description: "add = append to the list (default), remove = drop these companies, replace = the list becomes exactly these companies.",
        },
      },
      required: ["companies", "action"],
      additionalProperties: false,
    },
  },
  {
    name: "find_open_roles",
    description:
      "Search the job boards of every company on the saved employer list for open roles matching a job type. Returns, per company, the matching postings with job title, location, pay (when the posting lists it) and a direct link, plus how many postings were scanned. " +
      "Use this whenever the user asks what jobs are open, asks about a type of role, or wants a comparison. Requires at least one saved company - if the list is empty, ask the user which companies to track first.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        role_query: {
          type: "string",
          description: "The job type in the user's words, e.g. \"product manager\".",
        },
        title_keywords: {
          type: "array",
          items: { type: "string" },
          description:
            "2-6 title phrases that should count as a match, including common synonyms and abbreviations, e.g. [\"product manager\", \"product owner\", \"PM\", \"product lead\"]. A posting matches if its title contains every word of any one phrase.",
        },
        location: {
          type: "string",
          description: "City, state, or country to filter by, e.g. \"New York\" or \"Remote\". Empty string for any location.",
        },
        remote_only: {
          type: "boolean",
          description: "true to keep only remote postings.",
        },
      },
      required: ["role_query", "title_keywords", "location", "remote_only"],
      additionalProperties: false,
    },
  },
];

// ---------- update_employer_list ----------

const SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|llc|ltd|limited|plc|gmbh|technologies|technology|labs|group|holdings)\b\.?/gi;

export function slugCandidates(name) {
  const base = name.toLowerCase().replace(/&/g, "and").replace(SUFFIXES, "").trim();
  const words = base.split(/[^a-z0-9]+/).filter(Boolean);
  return [...new Set([words.join(""), words.join("-"), words[0]].filter(Boolean))];
}

const sameCompany = (a = "", b = "") => {
  const n = (s) => s.toLowerCase().replace(SUFFIXES, "").replace(/[^a-z0-9]/g, "");
  return n(a).includes(n(b)) || n(b).includes(n(a));
};

const AGGREGATORS = /linkedin\.|indeed\.|glassdoor\.|ziprecruiter\.|monster\.|builtin|wellfound|simplyhired|levels\.fyi|teamblind|wikipedia|crunchbase|reddit\./i;

async function probeSlugs(name) {
  const attempts = [];
  for (const slug of slugCandidates(name)) {
    for (const ats of ["greenhouse", "lever", "ashby", "workable"]) {
      attempts.push(
        ADAPTERS[ats].probe({ slug }).then((r) => (r ? { ats, ref: { slug }, ...r } : null)),
      );
    }
  }
  const hits = (await Promise.all(attempts)).filter(Boolean);
  // Only trust a guessed slug if the board has live postings, and (when the ATS reports a
  // board name) the name matches the company. Prefer the board with the most postings.
  return hits
    .filter((h) => h.jobCount > 0 && (!h.boardName || sameCompany(h.boardName, name)))
    .sort((a, b) => b.jobCount - a.jobCount)[0] || null;
}

async function searchForBoard(name) {
  const results = await tavilySearch(`${name} careers open jobs`, { maxResults: 8 });
  const urls = results.map((r) => r.url);
  const found = detectBoard(urls);
  if (found) {
    const probe = await ADAPTERS[found.ats].probe(found.ref);
    if (probe) return { ...found, ...probe, via: "web search" };
  }
  const careersUrl = urls.find((u) => /career|jobs|join|work-with-us|opportunities/i.test(u) && !AGGREGATORS.test(u));
  if (!careersUrl) return null;
  // The careers page often embeds an ATS board; look at its links.
  const links = await firecrawlLinks(careersUrl).catch(() => []);
  const embedded = detectBoard(links);
  if (embedded) {
    const probe = await ADAPTERS[embedded.ats].probe(embedded.ref);
    if (probe) return { ...embedded, ...probe, via: "careers page" };
  }
  return { ats: "careers_page", ref: { url: careersUrl }, boardUrl: careersUrl, jobCount: null, via: "web search" };
}

export async function resolveEmployer(name) {
  const started = Date.now();
  try {
    // Search and slug probing run in parallel; a board found via web search wins
    // because a guessed slug can belong to a different company with the same name.
    const [searched, probed] = await Promise.all([
      hasTavily() ? searchForBoard(name).catch(() => null) : null,
      probeSlugs(name).catch(() => null),
    ]);
    const pick = searched && searched.ats !== "careers_page" ? searched : probed ? { ...probed, via: "slug match" } : searched;
    if (!pick) {
      return { name, ats: "not_found", boardUrl: null, jobCount: null, note: "No job board found. Try the company's full legal name or paste its careers URL.", ms: Date.now() - started };
    }
    return {
      name,
      ats: pick.ats,
      ref: pick.ref,
      boardUrl: pick.boardUrl,
      jobCount: pick.jobCount,
      via: pick.via,
      ms: Date.now() - started,
    };
  } catch (err) {
    return { name, ats: "not_found", boardUrl: null, jobCount: null, note: `Lookup failed: ${err.message}`, ms: Date.now() - started };
  }
}

export async function updateEmployerList(input, employers) {
  const names = (input.companies || []).map((c) => String(c).trim()).filter(Boolean);
  const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  let list = [...employers];

  if (input.action === "remove") {
    const drop = new Set(names.map(key));
    list = list.filter((e) => !drop.has(key(e.name)));
    return { employers: list, result: { action: "remove", removed: names, saved: summarize(list) } };
  }
  if (input.action === "replace") list = [];

  const existing = new Set(list.map((e) => key(e.name)));
  const toResolve = names.filter((n) => !existing.has(key(n)));
  const room = MAX_EMPLOYERS - list.length;
  const skipped = toResolve.slice(Math.max(room, 0));
  const resolved = await Promise.all(toResolve.slice(0, Math.max(room, 0)).map(resolveEmployer));
  list = [...list, ...resolved];

  return {
    employers: list,
    result: {
      action: input.action,
      added: resolved.map((r) => ({ name: r.name, job_board: r.ats, board_url: r.boardUrl, open_postings: r.jobCount, note: r.note })),
      already_saved: names.filter((n) => existing.has(key(n))),
      skipped_list_full: skipped,
      saved: summarize(list),
    },
  };
}

const summarize = (list) => list.map((e) => ({ name: e.name, job_board: e.ats, board_url: e.boardUrl }));

// ---------- find_open_roles ----------

const words = (s) => s.toLowerCase().split(/[^a-z0-9+#]+/).filter(Boolean);

export function titleMatches(title, keywords) {
  const t = new Set(words(title));
  return keywords.some((k) => {
    const kw = words(k);
    return kw.length > 0 && kw.every((w) => t.has(w));
  });
}

export function locationMatches(role, location, remoteOnly) {
  if (remoteOnly && !role.remote) return false;
  const loc = (location || "").trim().toLowerCase();
  if (!loc || loc === "any") return true;
  if (/remote/.test(loc)) return role.remote;
  const hay = (role.location || "").toLowerCase();
  return loc.split(/[,/]| or /).map((s) => s.trim()).filter(Boolean).some((part) => hay.includes(part));
}

async function listRoles(employer, input) {
  if (employer.ats === "careers_page") {
    const jobs = await firecrawlJobs(employer.ref.url, input.role_query);
    return jobs.map((j) => {
      const pay = parsePay(j.pay || "");
      return {
        title: j.title,
        location: j.location || "",
        remote: /remote/i.test(j.location || ""),
        payText: pay.payText || j.pay || "",
        payMin: pay.payMin,
        payMax: pay.payMax,
        url: j.url ? new URL(j.url, employer.ref.url).href : employer.ref.url,
      };
    });
  }
  return ADAPTERS[employer.ats].list(employer.ref, { keywords: input.title_keywords });
}

async function searchOne(employer, input) {
  const started = Date.now();
  const base = { company: employer.name, job_board: employer.ats, board_url: employer.boardUrl };
  if (employer.ats === "not_found") {
    return { ...base, scanned: 0, matched: 0, roles: [], error: "No job board on file for this company.", ms: 0 };
  }
  try {
    const all = await listRoles(employer, input);
    const byTitle = all.filter((r) => r.title && titleMatches(r.title, input.title_keywords));
    const matched = byTitle.filter((r) => locationMatches(r, input.location, input.remote_only));
    return {
      ...base,
      scanned: all.length,
      title_matches: byTitle.length,
      matched: matched.length,
      roles: matched.map((r) => ({ ...r, company: employer.name })),
      ms: Date.now() - started,
    };
  } catch (err) {
    return { ...base, scanned: 0, matched: 0, roles: [], error: `Could not read job board: ${err.message}`, ms: Date.now() - started };
  }
}

export async function findOpenRoles(input, employers) {
  if (!employers.length) {
    return { forModel: { error: "The employer list is empty. Ask the user which companies to track, then call update_employer_list." }, forUI: null };
  }
  const keywords = input.title_keywords?.length ? input.title_keywords : [input.role_query];
  const query = { ...input, title_keywords: keywords };
  const companies = await Promise.all(employers.map((e) => searchOne(e, query)));

  const forModel = {
    query: { role: input.role_query, keywords, location: input.location || "any", remote_only: input.remote_only },
    total_matches: companies.reduce((n, c) => n + c.matched, 0),
    companies: companies.map((c) => ({
      company: c.company,
      job_board: c.job_board,
      board_url: c.board_url,
      postings_scanned: c.scanned,
      matches: c.matched,
      ...(c.error ? { error: c.error } : {}),
      ...(c.matched > ROLES_PER_COMPANY_FOR_MODEL ? { note: `Showing first ${ROLES_PER_COMPANY_FOR_MODEL} of ${c.matched}; the full list is in the user's Role Explorer panel.` } : {}),
      roles: c.roles.slice(0, ROLES_PER_COMPANY_FOR_MODEL).map((r) => ({
        title: r.title,
        location: r.location || "Not listed",
        pay: r.payText || "Not listed",
        url: r.url,
      })),
    })),
  };

  const forUI = {
    query: forModel.query,
    ranAt: new Date().toISOString(),
    companies: companies.map(({ roles, ...meta }) => ({ ...meta, shown: Math.min(roles.length, ROLES_PER_COMPANY_FOR_UI) })),
    roles: companies.flatMap((c) => c.roles.slice(0, ROLES_PER_COMPANY_FOR_UI)),
  };
  return { forModel, forUI };
}

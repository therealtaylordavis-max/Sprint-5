import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePay, payFromRange } from "../lib/pay.js";
import { detectBoard } from "../lib/boards.js";
import { titleMatches, locationMatches, slugCandidates, updateEmployerList, findOpenRoles } from "../lib/tools.js";

test("parsePay handles common pay-transparency formats", () => {
  assert.deepEqual(parsePay("The base salary range is $150,000 - $200,000 per year."), { payText: "$150,000 - $200,000 per year", payMin: 150000, payMax: 200000 });
  assert.equal(parsePay("Pay: $150K–$210K + equity").payMax, 210000);
  assert.equal(parsePay("USD 120,000 to 140,000").payMin, 120000);
  const hourly = parsePay("$45 - $60 per hour");
  assert.equal(hourly.payMin, 45 * 2080);
  assert.equal(parsePay("We raised $5 - $10 million").payText, "");
  assert.equal(parsePay("No pay info here").payText, "");
});

test("payFromRange formats structured salary fields", () => {
  assert.deepEqual(payFromRange(140000, 180000, "USD", "per-year-salary"), { payText: "$140K – $180K", payMin: 140000, payMax: 180000 });
  assert.equal(payFromRange(50, 70, "USD", "1 HOUR").payText, "$50 – $70/hr");
});

test("detectBoard recognizes ATS URLs", () => {
  assert.deepEqual(detectBoard(["https://www.linkedin.com/x", "https://job-boards.greenhouse.io/stripe/jobs/123"]), { ats: "greenhouse", ref: { slug: "stripe" } });
  assert.deepEqual(detectBoard(["https://jobs.lever.co/spotify/abc"]), { ats: "lever", ref: { slug: "spotify" } });
  assert.deepEqual(detectBoard(["https://jobs.ashbyhq.com/notion"]), { ats: "ashby", ref: { slug: "notion" } });
  assert.deepEqual(detectBoard(["https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x"]), { ats: "workday", ref: { tenant: "nvidia", dc: "wd5", site: "NVIDIAExternalCareerSite" } });
  assert.equal(detectBoard(["https://example.com/careers"]), null);
});

test("title and location matching", () => {
  assert.ok(titleMatches("Senior Product Manager, Payments", ["product manager"]));
  assert.ok(titleMatches("Manager, Product (Growth)", ["product manager"]));
  assert.ok(!titleMatches("Product Designer", ["product manager", "PM"]));
  assert.ok(titleMatches("PM - Platform", ["PM"]));
  assert.ok(locationMatches({ location: "New York, NY", remote: false }, "New York", false));
  assert.ok(!locationMatches({ location: "Seattle, WA", remote: false }, "New York", false));
  assert.ok(locationMatches({ location: "Remote - US", remote: true }, "remote", false));
  assert.ok(!locationMatches({ location: "Austin", remote: false }, "", true));
  assert.deepEqual(slugCandidates("Acme Labs Inc."), ["acme"]);
  assert.deepEqual(slugCandidates("Scale AI"), ["scaleai", "scale-ai", "scale"]);
});

// ---- end-to-end tool runs against mocked board APIs ----

function mockFetch(routes) {
  globalThis.fetch = async (url, opts = {}) => {
    for (const [pattern, body] of routes) {
      if (url.includes(pattern)) {
        const data = typeof body === "function" ? body(url, opts) : body;
        if (data === 404) return new Response("not found", { status: 404 });
        return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return new Response("not found", { status: 404 });
  };
}

test("update_employer_list finds boards by slug and find_open_roles returns grouped roles", async () => {
  delete process.env.TAVILY_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  mockFetch([
    ["boards-api.greenhouse.io/v1/boards/acme/jobs", {
      jobs: [
        { title: "Senior Product Manager", location: { name: "New York, NY" }, absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1", content: "&lt;p&gt;Salary: $160,000 - $190,000&lt;/p&gt;" },
        { title: "Software Engineer", location: { name: "Remote" }, absolute_url: "https://job-boards.greenhouse.io/acme/jobs/2", content: "" },
      ],
    }],
    ["boards-api.greenhouse.io/v1/boards/acme", { name: "Acme" }],
    ["api.lever.co/v0/postings/globex", [
      { text: "Product Manager, Growth", categories: { location: "Remote - US" }, workplaceType: "remote", hostedUrl: "https://jobs.lever.co/globex/1", salaryRange: { min: 140000, max: 170000, currency: "USD", interval: "per-year-salary" } },
    ]],
  ]);

  const { employers, result } = await updateEmployerList({ companies: ["Acme", "Globex", "Nowhere Co"], action: "add" }, []);
  assert.equal(employers.length, 3);
  assert.equal(employers[0].ats, "greenhouse");
  assert.equal(employers[1].ats, "lever");
  assert.equal(employers[2].ats, "not_found");
  assert.equal(result.saved.length, 3);

  const { forModel, forUI } = await findOpenRoles({ role_query: "product manager", title_keywords: ["product manager"], location: "", remote_only: false }, employers);
  assert.equal(forModel.total_matches, 2);
  const acme = forModel.companies.find((c) => c.company === "Acme");
  assert.equal(acme.postings_scanned, 2);
  assert.equal(acme.roles[0].pay, "$160,000 - $190,000");
  assert.equal(forModel.companies.find((c) => c.company === "Globex").roles[0].pay, "$140K – $170K");
  assert.ok(forModel.companies.find((c) => c.company === "Nowhere Co").error);
  assert.equal(forUI.roles.length, 2);
  assert.equal(forUI.roles[1].payMin, 140000);

  const removed = await updateEmployerList({ companies: ["nowhere co"], action: "remove" }, employers);
  assert.equal(removed.employers.length, 2);

  const empty = await findOpenRoles({ role_query: "pm", title_keywords: ["pm"], location: "", remote_only: false }, []);
  assert.ok(empty.forModel.error);
});

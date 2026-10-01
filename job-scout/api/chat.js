// POST /api/chat
// Body: { message: string, messages: MessageParam[], employers: Employer[] }
// The browser holds the conversation and employer list and sends them back each turn,
// so the function stays stateless. History is returned unchanged plus the new turn
// (append-only), which keeps Claude's thinking blocks valid and the prompt cache warm.

import Anthropic from "@anthropic-ai/sdk";
import { runAgent } from "../lib/agent.js";
import { MAX_EMPLOYERS } from "../lib/tools.js";

const MAX_BODY_CHARS = 1_500_000;
const MAX_MESSAGE_CHARS = 4000;

function sanitizeEmployers(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e.name === "string" && typeof e.ats === "string")
    .slice(0, MAX_EMPLOYERS)
    .map(({ name, ats, ref, boardUrl, jobCount, via, note }) => ({ name, ats, ref, boardUrl, jobCount, via, note }));
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      keys: {
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        tavily: Boolean(process.env.TAVILY_API_KEY),
        firecrawl: Boolean(process.env.FIRECRAWL_API_KEY),
      },
      passcodeRequired: Boolean(process.env.APP_PASSCODE),
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  // Optional shared passcode so strangers can't spend your API credits.
  if (process.env.APP_PASSCODE && req.headers["x-app-passcode"] !== process.env.APP_PASSCODE) {
    return res.status(401).json({ error: "Passcode required." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server. Add it in Vercel > Project > Settings > Environment Variables, then redeploy." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (JSON.stringify(body).length > MAX_BODY_CHARS) {
    return res.status(413).json({ error: "Conversation is too long. Start a new chat (your employer list is kept)." });
  }
  const text = String(body.message || "").trim().slice(0, MAX_MESSAGE_CHARS);
  if (!text) return res.status(400).json({ error: "Empty message." });

  // Only user/assistant turns from the client; the operator channel stays server-side.
  const messages = (Array.isArray(body.messages) ? body.messages : []).filter(
    (m) => m && (m.role === "user" || m.role === "assistant") && Array.isArray(m.content),
  );
  const last = messages[messages.length - 1];
  if (last?.role === "user") {
    messages[messages.length - 1] = { role: "user", content: [...last.content, { type: "text", text }] };
  } else {
    messages.push({ role: "user", content: [{ type: "text", text }] });
  }

  try {
    const out = await runAgent({ messages, employers: sanitizeEmployers(body.employers) });
    return res.status(200).json(out);
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "Claude is rate limited right now. Try again in a minute." });
    if (err instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: "The server's ANTHROPIC_API_KEY was rejected." });
    if (err instanceof Anthropic.BadRequestError) return res.status(400).json({ error: `Claude rejected the request: ${err.message}. Try starting a new chat.` });
    if (err instanceof Anthropic.APIError) return res.status(502).json({ error: `Claude API error (${err.status ?? "network"}). Try again.` });
    return res.status(500).json({ error: "Something broke on the server. Try again." });
  }
}

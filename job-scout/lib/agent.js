// The agent loop: Claude + the two tools, run until Claude gives a final answer.

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompt.js";
import { cleanKey } from "./keys.js";
import { TOOL_DEFINITIONS, updateEmployerList, findOpenRoles } from "./tools.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const MAX_STEPS = 8;

let client;
const getClient = () => (client ??= new Anthropic({ apiKey: cleanKey(process.env.ANTHROPIC_API_KEY) }));

// After a mid-output safety fallback, model-internal blocks that came before the
// final `fallback` marker must not be echoed back on the next request.
function cleanFallbackContent(content) {
  const last = content.map((b) => b.type).lastIndexOf("fallback");
  if (last === -1) return content;
  const internal = new Set(["thinking", "redacted_thinking", "tool_use", "server_tool_use"]);
  return content.filter((b, i) => i >= last || !internal.has(b.type));
}

export async function runAgent({ messages, employers }) {
  let list = employers;
  let results = null;
  const events = [];
  const history = [...messages];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOL_DEFINITIONS,
      messages: history,
      // If a safety classifier declines, the API retries on a fallback model instead of failing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      history.push({
        role: "assistant",
        content: [{ type: "text", text: "I can't help with that one. Ask me about companies to track or roles to find." }],
      });
      break;
    }

    const content = cleanFallbackContent(response.content);
    history.push({ role: "assistant", content });

    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason !== "tool_use") break;

    const toolUses = content.filter((b) => b.type === "tool_use");
    const toolResults = [];
    // Run tools in order: an employer-list update must land before a search in the same turn.
    for (const tu of toolUses) {
      try {
        if (tu.name === "update_employer_list") {
          const out = await updateEmployerList(tu.input, list);
          list = out.employers;
          events.push({ tool: tu.name, input: tu.input, ok: true });
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out.result) });
        } else if (tu.name === "find_open_roles") {
          const out = await findOpenRoles(tu.input, list);
          if (out.forUI) results = out.forUI;
          events.push({ tool: tu.name, input: tu.input, ok: !out.forModel.error });
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out.forModel) });
        } else {
          toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Unknown tool ${tu.name}`, is_error: true });
        }
      } catch (err) {
        events.push({ tool: tu.name, input: tu.input, ok: false });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Tool failed: ${err.message}`, is_error: true });
      }
    }
    history.push({ role: "user", content: toolResults });
  }

  return { messages: history, employers: list, results, events };
}

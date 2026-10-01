// API keys pasted into a dashboard often pick up quotes, spaces, or a "KEY=" prefix.
// Clean those up, and describe (without revealing) what's wrong with a key that won't work.

export function cleanKey(raw = "") {
  return raw
    .trim()
    .replace(/^[A-Z_]+=/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

export function anthropicKeyProblem(raw) {
  if (!raw) return "missing";
  const key = cleanKey(raw);
  if (key.startsWith("sk-ant-admin")) return "This is an Admin API key. Chat needs a regular API key (starts with sk-ant-api).";
  if (key.startsWith("sk-ant-oat")) return "This is a Claude subscription (OAuth) token, not an API key. Create one at console.anthropic.com > API keys.";
  if (!key.startsWith("sk-ant-")) return "This doesn't look like an Anthropic API key (they start with sk-ant-api).";
  if (/\s/.test(key)) return "The key contains spaces or line breaks. Paste it again as one line.";
  if (key.length < 80) return "The key looks cut off. Copy the whole key again.";
  return null;
}

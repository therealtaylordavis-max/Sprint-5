// Small fetch helpers with timeouts. Every external call in the agent goes through here.

const UA = "JobScout/1.0 (+https://vercel.com)";

export async function getJSON(url, { timeoutMs = 12000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = new Error(`GET ${url} -> ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function postJSON(url, body, { timeoutMs = 20000, headers = {} } = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": UA,
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`POST ${url} -> ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Returns the value or null instead of throwing; used for "probe" calls where a 404 is expected.
export async function tryJSON(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

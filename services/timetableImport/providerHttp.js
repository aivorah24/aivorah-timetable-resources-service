// Shared POST-with-timeout for the AI providers. Errors carry the HTTP status.
const TIMEOUT_MS = Number(process.env.IMPORT_AI_TIMEOUT_MS || process.env.GEMINI_TIMEOUT_MS) || 45000;
const KEY_FAILURE = new Set([401, 402]);

class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function fetchJson(url, { label, headers, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError(`${label}: ${res.status} ${data?.error?.message || ''}`.trim(), res.status);
    return data;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(`${label}: ${err.name === 'AbortError' ? 'timed out' : err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchJson, ProviderError, KEY_FAILURE };

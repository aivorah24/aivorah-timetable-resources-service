// Sends a PDF to Gemini and returns its JSON answer. Tries each model in
// GEMINI_MODELS in order; a busy, missing or rate-limited model moves to the next.
const DEFAULT_MODELS = 'gemini-flash-latest,gemini-flash-lite-latest,gemini-3-flash-preview';
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 120000;
const NEXT_MODEL = new Set([404, 429, 500, 503]);

class ExtractionUnavailableError extends Error {}

async function readPdfAsJson(pdfBuffer, prompt, responseSchema) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ExtractionUnavailableError('PDF reading is not configured on this server');
  const models = (process.env.GEMINI_MODELS || DEFAULT_MODELS).split(',').map((m) => m.trim()).filter(Boolean);
  const body = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: 'application/pdf', data: pdfBuffer.toString('base64') } }, { text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0 },
  });
  let lastError;
  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = new Error(`${model}: ${res.status} ${data?.error?.message || ''}`.trim());
        if (NEXT_MODEL.has(res.status)) continue;
        throw lastError;
      }
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      if (err.name === 'AbortError' || err instanceof SyntaxError) continue;
      if (!String(err.message).startsWith(model)) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ExtractionUnavailableError(`Couldn't read the PDF right now (${lastError?.message || 'no model available'})`);
}

module.exports = { readPdfAsJson, ExtractionUnavailableError };

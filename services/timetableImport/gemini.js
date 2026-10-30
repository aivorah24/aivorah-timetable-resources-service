// Sends a PDF to Gemini and returns its JSON answer. Tries each model in
// GEMINI_MODELS in order; a key-level failure (bad key, no credits) skips the rest.
const { fetchJson, ProviderError, KEY_FAILURE } = require('./providerHttp');

const DEFAULT_MODELS = 'gemini-flash-latest,gemini-flash-lite-latest,gemini-3-flash-preview';

async function readWithGemini(pdfBuffer, prompt, responseSchema) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ProviderError('gemini: not configured');
  const models = (process.env.GEMINI_MODELS || DEFAULT_MODELS).split(',').map((m) => m.trim()).filter(Boolean);
  const body = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: 'application/pdf', data: pdfBuffer.toString('base64') } }, { text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0 },
  });
  let lastError;
  for (const model of models) {
    try {
      const data = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        label: model,
        headers: { 'x-goog-api-key': key },
        body,
      });
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      if (KEY_FAILURE.has(err.status)) break;
    }
  }
  throw new ProviderError(lastError?.message || 'gemini: no model available');
}

module.exports = { readWithGemini };

// OpenAI-style chat vision call (Groq, OpenRouter): page images in, JSON out.
// Pages go in batches; each batch's "classes" are merged.
const { fetchJson, ProviderError, KEY_FAILURE } = require('./providerHttp');

const PAGES_PER_REQUEST = 5;

function parseJson(text) {
  const cleaned = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new SyntaxError('no JSON in reply');
  return JSON.parse(cleaned.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1'));
}

async function askModel({ name, url, key, model, extraBody, timeoutMs }, images, prompt) {
  const content = [
    { type: 'text', text: prompt },
    ...images.map((jpg) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpg.toString('base64')}` } })),
  ];
  const data = await fetchJson(url, {
    label: `${name}/${model}`,
    headers: { Authorization: `Bearer ${key}` },
    timeoutMs,
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'user', content }], ...extraBody }),
  });
  try {
    return parseJson(data.choices?.[0]?.message?.content);
  } catch (err) {
    throw new ProviderError(`${name}/${model}: unreadable reply (${err.message})`);
  }
}

async function readWithVisionChat(provider, pages, prompt) {
  const { name, key, models } = provider;
  if (!key) throw new ProviderError(`${name}: not configured`);
  let lastError;
  for (const model of models) {
    try {
      const classes = [];
      for (let i = 0; i < pages.length; i += PAGES_PER_REQUEST) {
        const out = await askModel({ extraBody: {}, ...provider, model }, pages.slice(i, i + PAGES_PER_REQUEST), prompt);
        classes.push(...(out?.classes || []));
      }
      console.info(`[timetable-import] read by ${name}/${model}`);
      return { classes };
    } catch (err) {
      lastError = err;
      if (KEY_FAILURE.has(err.status)) break;
    }
  }
  throw new ProviderError(lastError?.message || `${name}: no model available`);
}

module.exports = { readWithVisionChat, parseJson };

// Reads a PDF into JSON: Gemini (whole PDF) -> Groq -> OpenRouter (page images).
const { readWithGemini } = require('./gemini');
const { readWithVisionChat } = require('./visionChat');
const { pdfToJpegs } = require('./pdfImages');

class ExtractionUnavailableError extends Error {}

const list = (v, fallback) => (v || fallback).split(',').map((m) => m.trim()).filter(Boolean);

function visionProviders() {
  return [
    {
      name: 'groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      key: process.env.GROQ_API_KEY,
      models: list(process.env.GROQ_VISION_MODELS, 'qwen/qwen3.8-27b'),
      extraBody: { response_format: { type: 'json_object' } },
    },
    {
      name: 'openrouter',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      key: process.env.OPENROUTER_API_KEY,
      models: list(process.env.OPENROUTER_VISION_MODELS, 'nvidia/nemotron-3.5-super-vl:free,google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free'),
    },
  ];
}

const imagePrompt = (prompt, schema) => `${prompt.replace(/^This PDF contains/, 'These images are the pages of a PDF that contains')}
Reply with JSON only, no other text, matching this JSON schema: ${JSON.stringify(schema)}`;

async function readPdfAsJson(pdfBuffer, prompt, schema) {
  const errors = [];
  try {
    return await readWithGemini(pdfBuffer, prompt, schema);
  } catch (err) {
    errors.push(err.message);
  }
  let pages;
  for (const provider of visionProviders()) {
    if (!provider.key) {
      errors.push(`${provider.name}: not configured`);
      continue;
    }
    try {
      pages = pages || (await pdfToJpegs(pdfBuffer));
      return await readWithVisionChat(provider, pages, imagePrompt(prompt, schema));
    } catch (err) {
      errors.push(err.message);
    }
  }
  console.warn('[timetable-import] all providers failed:', errors.join(' | '));
  throw new ExtractionUnavailableError("Couldn't read the PDF right now. Please try again in a few minutes.");
}

module.exports = { readPdfAsJson, ExtractionUnavailableError };

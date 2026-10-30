jest.mock('../../services/timetableImport/pdfImages', () => ({ pdfToJpegs: jest.fn(async () => [Buffer.from('page1')]) }));
const { readPdfAsJson, ExtractionUnavailableError } = require('../../services/timetableImport/pdfReader');
const { parseJson } = require('../../services/timetableImport/visionChat');

const OUT = { classes: [{ label: '8A', periods: [], cells: [] }] };
const geminiOk = { candidates: [{ content: { parts: [{ text: JSON.stringify(OUT) }] } }] };
const chatOk = { choices: [{ message: { content: JSON.stringify(OUT) } }] };
const reply = (status, body = {}) => ({ ok: status < 400, status, json: async () => body });

let calls;
function mockFetch(handler) {
  calls = [];
  global.fetch = jest.fn(async (url, opts) => {
    const host = new URL(url).host;
    calls.push(host.includes('google') ? `gemini:${url.split('/models/')[1].split(':')[0]}` : `${host.includes('groq') ? 'groq' : 'openrouter'}:${JSON.parse(opts.body).model}`);
    return handler(host, calls[calls.length - 1]);
  });
}

beforeEach(() => {
  Object.assign(process.env, { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', OPENROUTER_API_KEY: 'o' });
  process.env.GEMINI_MODELS = 'gm1,gm2';
  process.env.GROQ_VISION_MODELS = 'qm1';
  process.env.OPENROUTER_VISION_MODELS = 'om1,om2';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

test('uses Gemini when it answers', async () => {
  mockFetch(() => reply(200, geminiOk));
  await expect(readPdfAsJson(Buffer.from('pdf'), 'p', {})).resolves.toEqual(OUT);
  expect(calls).toEqual(['gemini:gm1']);
});

test('out of Gemini credits (402) skips remaining Gemini models and goes to Groq', async () => {
  mockFetch((host) => (host.includes('google') ? reply(402, { error: { message: 'credits depleted' } }) : reply(200, chatOk)));
  await expect(readPdfAsJson(Buffer.from('pdf'), 'p', {})).resolves.toEqual(OUT);
  expect(calls).toEqual(['gemini:gm1', 'groq:qm1']);
});

test('busy Gemini model (429) tries the next Gemini model first', async () => {
  mockFetch((host, call) => (call === 'gemini:gm1' ? reply(429) : reply(200, geminiOk)));
  await readPdfAsJson(Buffer.from('pdf'), 'p', {});
  expect(calls).toEqual(['gemini:gm1', 'gemini:gm2']);
});

test('Groq failing falls through to OpenRouter, next model on 429/403', async () => {
  mockFetch((host, call) => {
    if (host.includes('google')) return reply(402);
    if (call === 'groq:qm1') return reply(429);
    if (call === 'openrouter:om1') return reply(403);
    return reply(200, chatOk);
  });
  await expect(readPdfAsJson(Buffer.from('pdf'), 'p', {})).resolves.toEqual(OUT);
  expect(calls).toEqual(['gemini:gm1', 'groq:qm1', 'openrouter:om1', 'openrouter:om2']);
});

test('missing keys are skipped', async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
  mockFetch(() => reply(200, chatOk));
  await readPdfAsJson(Buffer.from('pdf'), 'p', {});
  expect(calls).toEqual(['openrouter:om1']);
});

test('all providers failing gives a friendly ExtractionUnavailableError', async () => {
  mockFetch(() => reply(500));
  await expect(readPdfAsJson(Buffer.from('pdf'), 'p', {})).rejects.toThrow(ExtractionUnavailableError);
  await expect(readPdfAsJson(Buffer.from('pdf'), 'p', {})).rejects.toThrow(/try again in a few minutes/);
});

test('parseJson strips think blocks, code fences and trailing commas', () => {
  expect(parseJson('<think>hmm</think>```json\n{"classes":[1,2,],}\n```')).toEqual({ classes: [1, 2] });
  expect(() => parseJson('no json here')).toThrow(SyntaxError);
});

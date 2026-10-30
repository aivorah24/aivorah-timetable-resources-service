// Renders PDF pages to JPEGs for vision models that can't take a PDF directly.
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const FONTS = `${path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts').replace(/\\/g, '/')}/`;
const MAX_PAGES = Number(process.env.IMPORT_MAX_PAGES) || 20;
const MAX_SIDE = 2000;

async function toJpeg(png) {
  const img = await loadImage(png);
  const ratio = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const canvas = createCanvas(Math.round(img.width * ratio), Math.round(img.height * ratio));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.encode('jpeg', 80);
}

async function pdfToJpegs(pdfBuffer) {
  const { pdf } = await import('pdf-to-img');
  const doc = await pdf(pdfBuffer, { scale: 2, docInitParams: { standardFontDataUrl: FONTS } });
  if (doc.length > MAX_PAGES) throw new Error(`PDF has ${doc.length} pages; the limit is ${MAX_PAGES}`);
  const pages = [];
  for await (const png of doc) pages.push(await toJpeg(png));
  return pages;
}

module.exports = { pdfToJpegs };

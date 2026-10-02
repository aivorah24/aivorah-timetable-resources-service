// POST /uploads (multipart "file") — a PDF or picture for Resources or a
// timetable slot. Teachers and school admins only.
const express = require('express');
const multer = require('multer');
const path = require('path');
const { isManager } = require('../services/classAccess');
const { uploadDocument } = require('../services/storage');

const router = express.Router();
const MAX_BYTES = 25 * 1024 * 1024;
const TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

router.post('/', (req, res, next) => {
  if (!isManager(req.user)) return res.status(403).json({ error: 'Only teachers and school admins can upload' });
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Files must be under 25 MB.' });
    if (err) return next(err);
    next();
  });
}, async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });
  if (!TYPES.has(file.mimetype)) return res.status(400).json({ error: 'Only PDF or image files' });
  try {
    const url = await uploadDocument(file.buffer, { fileName: file.originalname, mimeType: file.mimetype });
    res.json({
      url, name: file.originalname, size: file.size,
      type: path.extname(file.originalname).toLowerCase().replace('.', ''),
    });
  } catch (err) {
    console.error('[POST /uploads]', err.message);
    res.status(500).json({ error: 'Could not upload the file. Please try again.' });
  }
});

module.exports = router;

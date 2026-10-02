/**
 * Timetable PDF import. POST /preview reads a PDF and returns every class
 * timetable it found, matched to the school's classes; nothing is saved.
 * POST /commit saves the classes the user confirmed (replacing their periods
 * and subjects). School admins can save any class, teachers only their homeroom.
 */
const express = require('express');
const multer = require('multer');
const { buildGradesSectionsView } = require('../services/academicStructure');
const store = require('../services/timetableStore');
const access = require('../services/classAccess');
const { cleanPeriodDefs } = require('../services/periodDefs');
const { extractTimetables } = require('../services/timetableImport/extract');
const { ExtractionUnavailableError } = require('../services/timetableImport/gemini');

const router = express.Router();
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MAX_CLASSES = 80;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function requireImporter(req, res, next) {
  if (!req.user.school_id) return res.status(403).json({ error: 'Your account is not linked to a school' });
  if (!access.isManager(req.user)) return res.status(403).json({ error: 'Only school admins and teachers can import timetables' });
  next();
}

const activeGrades = (grades) => grades.filter((g) => !g.archived).map((g) => ({
  name: g.name, sections: (g.sections || []).filter((s) => !s.archived).map((s) => s.name), raw: g,
}));

// POST /timetable/import/preview (multipart "file", PDF up to 10 MB)
router.post('/preview', requireImporter, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'The PDF must be under 10 MB.' });
    if (err) return next(err);
    next();
  });
}, async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });
  if (file.mimetype !== 'application/pdf' && !/\.pdf$/i.test(file.originalname)) {
    return res.status(400).json({ error: 'Please upload a PDF' });
  }
  try {
    const user = req.user;
    const [grades, teachers] = await Promise.all([buildGradesSectionsView(user.school_id), store.schoolTeachers(user.school_id)]);
    const classes = await extractTimetables(file.buffer, {
      grades: activeGrades(grades),
      teachers,
      canSave: (m) => access.canManageTemplate(user, grades, m.grade, m.section),
    });
    if (!classes.length) return res.status(422).json({ error: 'No class timetable was found in this PDF.' });
    res.json({ fileName: file.originalname, classes });
  } catch (err) {
    if (err instanceof ExtractionUnavailableError) return res.status(503).json({ error: err.message });
    console.error('[POST /timetable/import/preview]', err.message);
    res.status(500).json({ error: 'Could not read the timetable PDF' });
  }
});

// Keeps only slots on a real day and teaching period; drops teacher ids from other schools.
function cleanSlots(slots, periods, teacherIds) {
  const teaching = new Set(periods.filter((p) => !p.isBreak).map((p) => p.code));
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(slots) ? slots : []) {
    const day = String(s?.day || '');
    const periodCode = String(s?.periodCode || '');
    const subject = String(s?.subject || '').trim();
    if (!DAYS.includes(day) || !teaching.has(periodCode) || !subject || seen.has(`${day}|${periodCode}`)) continue;
    seen.add(`${day}|${periodCode}`);
    out.push({
      day, periodCode, subject: subject.slice(0, 120),
      room: String(s?.room || '').trim().slice(0, 80),
      teacherId: teacherIds.has(s?.teacherId) ? s.teacherId : null,
    });
  }
  return out;
}

// POST /timetable/import/commit { timetables: [{ grade, section, title?, periodDefs, slots }] }
router.post('/commit', requireImporter, async (req, res) => {
  const list = req.body?.timetables;
  if (!Array.isArray(list) || !list.length) return res.status(400).json({ error: 'timetables is required' });
  if (list.length > MAX_CLASSES) return res.status(400).json({ error: `At most ${MAX_CLASSES} classes at once` });
  const user = req.user;
  try {
    const [grades, teachers] = await Promise.all([buildGradesSectionsView(user.school_id), store.schoolTeachers(user.school_id)]);
    const teacherIds = new Set(teachers.map((t) => t.id));
    const results = [];
    for (const t of list) {
      const grade = String(t?.grade || '').trim();
      const section = String(t?.section || '').trim();
      const label = `${grade}${section ? ' ' + section : ''}`;
      if (!grade) { results.push({ grade, section, ok: false, error: 'grade is required' }); continue; }
      if (!access.findSection(grades, grade, section) && !(grades.find((g) => g.name === grade) && !section)) {
        results.push({ grade, section, ok: false, error: `${label} is not a class in this school` }); continue;
      }
      if (!access.canManageTemplate(user, grades, grade, section)) {
        results.push({ grade, section, ok: false, error: `Only a school admin or the homeroom teacher can replace ${label}` }); continue;
      }
      const { periods, error } = cleanPeriodDefs(t.periodDefs);
      if (error || !periods.length) { results.push({ grade, section, ok: false, error: error || 'No periods' }); continue; }
      try {
        const timetableId = await store.saveTemplate({
          schoolId: user.school_id, grade, section, title: t.title || `${label} Timetable`, periodDefs: periods, updatedBy: user.email,
        });
        const slots = cleanSlots(t.slots, periods, teacherIds);
        await store.replaceSlots(timetableId, slots, user.email);
        results.push({ grade, section, ok: true, periods: periods.length, slots: slots.length });
      } catch (err) {
        console.error('[POST /timetable/import/commit]', label, err.message);
        results.push({ grade, section, ok: false, error: 'Failed to save' });
      }
    }
    res.json({ results, saved: results.filter((r) => r.ok).length });
  } catch (err) {
    console.error('[POST /timetable/import/commit]', err.message);
    res.status(500).json({ error: 'Failed to save the timetables' });
  }
});

module.exports = router;
module.exports.cleanSlots = cleanSlots;

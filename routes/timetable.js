/**
 * Class Timetable — the weekly bell schedule of a grade + section.
 * The school always comes from the signed-in user; permissions are in
 * services/classAccess.js.
 */
const express = require('express');
const { buildGradesSectionsView } = require('../services/academicStructure');
const store = require('../services/timetableStore');
const access = require('../services/classAccess');
const { cleanPeriodDefs } = require('../services/periodDefs');

const router = express.Router();
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const classParams = (src) => ({ grade: String(src?.grade || '').trim(), section: String(src?.section || '').trim() });

// GET /timetable/classes — the classes this user can open, plus the school's
// grades (for the admin Programme → Grade → Section picker).
router.get('/classes', async (req, res) => {
  const user = req.user;
  if (!user.school_id) return res.json({ classes: [], grades: [], curriculum: null });
  try {
    const [grades, children, curriculum] = await Promise.all([
      buildGradesSectionsView(user.school_id),
      user.role === 'parent' ? store.childrenOf(user.email) : [],
      store.schoolCurriculum(user.school_id),
    ]);
    const visibleGrades = access.isAdmin(user)
      ? grades.filter((g) => !g.archived).map((g) => ({
        name: g.name, sections: (g.sections || []).filter((s) => !s.archived).map((s) => s.name),
      }))
      : [];
    res.json({ classes: access.classesFor(user, grades, children), grades: visibleGrades, curriculum });
  } catch (err) {
    console.error('[GET /timetable/classes]', err.message);
    res.status(500).json({ error: 'Failed to load classes' });
  }
});

// GET /timetable?grade=&section=
router.get('/', async (req, res) => {
  const user = req.user;
  const { grade, section } = classParams(req.query);
  if (!grade) return res.status(400).json({ error: 'grade is required' });
  try {
    const children = user.role === 'parent' ? await store.childrenOf(user.email) : [];
    if (!access.canViewClass(user, children, grade, section)) {
      return res.status(403).json({ error: 'Not allowed to view this timetable' });
    }
    const grades = await buildGradesSectionsView(user.school_id);
    const tt = await store.findTimetable(user.school_id, grade, section);
    const slots = tt ? await store.loadSlots(tt.id) : [];
    const names = await store.namesById([...new Set(slots.map((s) => s.teacher_id).filter(Boolean))]);

    res.json({
      grade, section,
      title: tt?.title || `${grade}${section ? ' ' + section : ''} Timetable`,
      periodDefs: tt?.period_defs || [],
      days: DAYS,
      slots: slots.map((s) => ({
        id: s.id, day: s.day_of_week, periodCode: s.period_code,
        subject: s.subject_name, room: s.room_name,
        teacherId: s.teacher_id, teacherName: s.teacher_id ? (names.get(s.teacher_id) || null) : null,
        materialUrl: s.material_url, materialName: s.material_name, color: s.color || null,
      })),
      permissions: {
        canManageTemplate: access.canManageTemplate(user, grades, grade, section),
        canEditSlot: access.canEditSlot(user, grades, grade, section),
      },
    });
  } catch (err) {
    console.error('[GET /timetable]', err.message);
    res.status(500).json({ error: 'Failed to load timetable' });
  }
});

// PUT /timetable/template { grade, section, title?, periodDefs: [{ code, start, end, isBreak }] }
router.put('/template', async (req, res) => {
  const user = req.user;
  const { grade, section } = classParams(req.body);
  const { title, periodDefs } = req.body || {};
  if (!grade) return res.status(400).json({ error: 'grade is required' });
  const { periods: clean, error } = cleanPeriodDefs(periodDefs);
  if (error) return res.status(400).json({ error });

  try {
    const grades = await buildGradesSectionsView(user.school_id);
    if (!access.canManageTemplate(user, grades, grade, section)) {
      return res.status(403).json({ error: 'Only a school admin or the homeroom teacher can edit the bell schedule' });
    }
    const timetableId = await store.saveTemplate({
      schoolId: user.school_id, grade, section, title, periodDefs: clean, updatedBy: user.email,
    });
    res.json({ ok: true, timetableId });
  } catch (err) {
    console.error('[PUT /timetable/template]', err.message);
    res.status(500).json({ error: 'Failed to save the bell schedule' });
  }
});

// PUT /timetable/slot { grade, section, day, periodCode, subject?, room?, materialUrl?, materialName?, color? }
// An empty subject clears the cell.
router.put('/slot', async (req, res) => {
  const user = req.user;
  const { grade, section } = classParams(req.body);
  const { day, periodCode } = req.body || {};
  if (!grade || !day || !periodCode) return res.status(400).json({ error: 'grade, day and periodCode are required' });
  if (!DAYS.includes(day)) return res.status(400).json({ error: 'Invalid day' });

  try {
    const grades = await buildGradesSectionsView(user.school_id);
    if (!access.canEditSlot(user, grades, grade, section)) {
      return res.status(403).json({ error: 'Not allowed to edit this timetable' });
    }
    const tt = await store.findTimetable(user.school_id, grade, section);
    if (!tt) return res.status(409).json({ error: 'Set up the bell schedule for this class first.' });
    const period = (tt.period_defs || []).find((p) => p.code === periodCode);
    if (!period || period.isBreak) return res.status(400).json({ error: 'Unknown period' });

    const subject = String(req.body?.subject || '').trim();
    if (!subject) {
      await store.deleteSlot(tt.id, day, periodCode);
      return res.json({ ok: true, cleared: true });
    }
    await store.upsertSlot(tt.id, day, periodCode, {
      subject_name: subject,
      room_name: String(req.body?.room || '').trim() || null,
      material_url: req.body?.materialUrl || null,
      material_name: req.body?.materialName || null,
      color: String(req.body?.color || '').trim() || null,
    }, user.email);
    res.json({ ok: true });
  } catch (err) {
    console.error('[PUT /timetable/slot]', err.message);
    res.status(500).json({ error: 'Failed to save the slot' });
  }
});

module.exports = router;

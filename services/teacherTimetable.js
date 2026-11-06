/**
 * A teacher's own weekly timetable: every period they teach, across all the
 * classes of their school, merged into one grid (pure function, no I/O).
 *
 * Rows are the bell-schedule periods of the classes the teacher teaches in.
 * Periods with the same start–end time are one row even if the classes call
 * them differently (P1 / 1); without times, the period code is the key. Free
 * periods stay as empty rows and breaks as break rows, so the teacher sees
 * their whole day, not just the busy periods.
 */

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const classLabel = (grade, section) => `${grade}${section ? ' ' + section : ''}`;
const rowKey = (p) => (p.start && p.end ? `T:${p.start}-${p.end}` : `C:${String(p.code).toUpperCase()}`);
const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/**
 * @param timetables [{ id, grade, section, period_defs }] — the school's class timetables
 * @param slots      [{ id, timetable_id, day_of_week, period_code, subject_name, room_name, color, material_url, material_name }]
 *                   — only the slots taught by this teacher
 * @param teacher    { id, name }
 * @returns {{ periodDefs, slots, clashes }}
 */
function buildTeacherTimetable(timetables, slots, teacher) {
  const byId = new Map((timetables || []).map((t) => [t.id, t]));
  const taught = [...new Set((slots || []).map((s) => s.timetable_id))]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => classLabel(a.grade, a.section).localeCompare(classLabel(b.grade, b.section), undefined, { numeric: true }));

  // One row per distinct period across the taught classes (first class wins the label).
  const rows = new Map();
  for (const t of taught) {
    for (const p of Array.isArray(t.period_defs) ? t.period_defs : []) {
      if (!p || !p.code) continue;
      const key = rowKey(p);
      if (!rows.has(key)) rows.set(key, { code: p.code, start: p.start || '', end: p.end || '', isBreak: !!p.isBreak });
      else if (!p.isBreak) rows.get(key).isBreak = false; // a teaching period in any class is not a break
    }
  }
  let periodDefs = [...rows.entries()];
  if (periodDefs.length && periodDefs.every(([, p]) => p.start)) {
    periodDefs.sort(([, a], [, b]) => minutes(a.start) - minutes(b.start) || minutes(a.end || a.start) - minutes(b.end || b.start));
  }
  // Codes must be unique in the grid: same code at different times gets its time added.
  const seen = new Map();
  for (const [, p] of periodDefs) seen.set(p.code, (seen.get(p.code) || 0) + 1);
  const codeOf = new Map();
  periodDefs = periodDefs.map(([key, p]) => {
    const code = seen.get(p.code) > 1 && p.start ? `${p.code} (${p.start})` : p.code;
    codeOf.set(key, code);
    return { code, start: p.start, end: p.end, isBreak: p.isBreak };
  });

  const out = [];
  for (const s of slots || []) {
    const t = byId.get(s.timetable_id);
    if (!t || !DAYS.includes(s.day_of_week)) continue;
    const def = (t.period_defs || []).find((p) => p && p.code === s.period_code);
    if (!def || def.isBreak) continue;
    out.push({
      id: s.id,
      day: s.day_of_week,
      periodCode: codeOf.get(rowKey(def)),
      subject: s.subject_name,
      room: s.room_name || null,
      color: s.color || null,
      materialUrl: s.material_url || null,
      materialName: s.material_name || null,
      teacherId: teacher?.id || null,
      teacherName: teacher?.name || null,
      grade: t.grade,
      section: t.section || '',
      classLabel: classLabel(t.grade, t.section),
    });
  }
  out.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.classLabel.localeCompare(b.classLabel));

  // Two classes in the same period on the same day: the school timetable double-books the teacher.
  const perCell = new Map();
  for (const s of out) perCell.set(`${s.day}|${s.periodCode}`, (perCell.get(`${s.day}|${s.periodCode}`) || 0) + 1);
  const clashes = [...perCell.entries()].filter(([, n]) => n > 1).map(([k]) => {
    const [day, periodCode] = k.split('|');
    return { day, periodCode, classes: out.filter((s) => s.day === day && s.periodCode === periodCode).map((s) => s.classLabel) };
  });

  return { periodDefs, slots: out, clashes };
}

module.exports = { buildTeacherTimetable, DAYS };

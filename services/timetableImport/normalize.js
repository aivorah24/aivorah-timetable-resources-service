// Turns what the model read from a timetable PDF into clean periods/slots and
// matches its class and teacher names to the school's real classes and staff.

const DAY_MAP = {
  mon: 'MON', monday: 'MON', tue: 'TUE', tues: 'TUE', tuesday: 'TUE', wed: 'WED', wednesday: 'WED',
  thu: 'THU', thur: 'THU', thurs: 'THU', thursday: 'THU', fri: 'FRI', friday: 'FRI', sat: 'SAT', saturday: 'SAT',
};
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
const PROGRAMMES = ['PYP', 'MYP', 'DP'];
const BREAK_RE = /\b(break|lunch|recess|snack|assembly)\b/i;

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

function normalizeDay(day) {
  return DAY_MAP[clean(day).toLowerCase().replace(/[^a-z]/g, '')] || null;
}

// '8:30', '1:00 pm', '13.05', '0830' -> 'HH:MM' (24h). Without am/pm, 1-6 o'clock is afternoon (school day).
function normalizeTime(raw) {
  const s = clean(raw).toLowerCase();
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2})|(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2] ?? m[3] ?? 0);
  const ampm = m[4] ? m[4][0] : null;
  if (ampm === 'p' && h < 12) h += 12;
  else if (ampm === 'a' && h === 12) h = 0;
  else if (!ampm && h >= 1 && h <= 6) h += 12;
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Model periods [{label,start,end,isBreak}] -> periodDefs with unique teaching codes (P1, P2…) and a label->code map.
function normalizePeriods(periods) {
  const periodDefs = [];
  const codeByLabel = new Map();
  const used = new Set();
  let n = 0;
  for (const p of periods || []) {
    const label = clean(p?.label);
    const isBreak = !!p?.isBreak || BREAK_RE.test(label);
    let code;
    if (isBreak) {
      code = /lunch/i.test(label) ? 'LUNCH' : 'BRK';
    } else {
      n += 1;
      const digits = label.match(/^(?:p(?:eriod)?\s*)?(\d{1,2})$/i);
      code = digits ? `P${Number(digits[1])}` : `P${n}`;
      for (let k = n; used.has(code); k++) code = `P${k}`;
      used.add(code);
    }
    periodDefs.push({ code, start: normalizeTime(p?.start), end: normalizeTime(p?.end), isBreak });
    if (label) codeByLabel.set(label.toLowerCase(), code);
  }
  return { periodDefs, codeByLabel };
}

function periodCodeFor(rawPeriod, codeByLabel, periodDefs) {
  const label = clean(rawPeriod).toLowerCase();
  if (codeByLabel.has(label)) return codeByLabel.get(label);
  const digits = label.match(/(\d{1,2})/);
  if (digits && periodDefs.some((p) => p.code === `P${Number(digits[1])}`)) return `P${Number(digits[1])}`;
  return null;
}

// Model cells -> slots on known days/teaching periods; reports what was dropped.
function normalizeCells(cells, codeByLabel, periodDefs) {
  const slots = [];
  const warnings = [];
  const seen = new Set();
  for (const c of cells || []) {
    const subject = clean(c?.subject);
    if (!subject || (BREAK_RE.test(subject) && subject.split(' ').length <= 2)) continue;
    const day = normalizeDay(c?.day);
    const periodCode = periodCodeFor(c?.period, codeByLabel, periodDefs);
    const period = periodDefs.find((p) => p.code === periodCode);
    if (!day || !period || period.isBreak) {
      warnings.push(`Skipped "${subject}" (${clean(c?.day) || '?'} / ${clean(c?.period) || '?'}): unknown day or period`);
      continue;
    }
    const key = `${day}|${periodCode}`;
    if (seen.has(key)) { warnings.push(`Two subjects for ${day} ${periodCode}; kept the first`); continue; }
    seen.add(key);
    slots.push({ day, periodCode, subject, room: clean(c?.room), teacherName: clean(c?.teacher) });
  }
  return { slots, warnings };
}

// 'Class VII - A', '7A', 'Grade 7 Section B', 'PYP 4 B' -> { programme, number, section }.
function parseClassLabel(label) {
  const s = clean(label).toUpperCase();
  const programme = PROGRAMMES.find((p) => new RegExp(`\\b${p}\\b`).test(s)) || null;
  const body = s.replace(/\b(CLASS|GRADE|STD|STANDARD|YEAR|SECTION|SEC|DIV|DIVISION)\b\.?/g, ' ')
    .replace(new RegExp(`\\b(${PROGRAMMES.join('|')})\\b`), ' ');
  let number = null;
  let rest = body;
  const arabic = body.match(/(\d{1,2})/);
  if (arabic) {
    number = Number(arabic[1]);
    rest = body.slice(body.indexOf(arabic[1]) + arabic[1].length);
  } else {
    const roman = body.match(/\b(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)(?=\b|[-\s]?[A-H]\b)/);
    if (roman) { number = ROMAN[roman[1].toLowerCase()]; rest = body.slice(body.indexOf(roman[1]) + roman[1].length); }
  }
  const sec = rest.match(/^[\s\-–/:(]*([A-H])\b/);
  return { programme, number, section: sec ? sec[1] : null };
}

function gradeKey(name) {
  const p = parseClassLabel(name);
  return { programme: p.programme, number: p.number };
}

// grades: [{ name, sections: [names] }] (active only). Returns { grade, section } or null + reason.
function matchClass(label, grades) {
  const want = parseClassLabel(label);
  if (want.number == null) return { match: null, reason: `Couldn't read a grade number from "${clean(label)}"` };
  const candidates = (grades || []).filter((g) => {
    const k = gradeKey(g.name);
    return k.number === want.number && (want.programme ? k.programme === want.programme : !k.programme);
  });
  if (!candidates.length) return { match: null, reason: `No grade ${want.programme ? want.programme + ' ' : ''}${want.number} in this school` };
  if (candidates.length > 1) return { match: null, reason: `More than one grade matches "${clean(label)}"` };
  const g = candidates[0];
  const sections = g.sections || [];
  if (!sections.length) return { match: { grade: g.name, section: '' } };
  if (want.section) {
    const s = sections.find((x) => x.toUpperCase() === want.section);
    return s ? { match: { grade: g.name, section: s } } : { match: null, reason: `${g.name} has no section ${want.section}` };
  }
  if (sections.length === 1) return { match: { grade: g.name, section: sections[0] } };
  return { match: null, reason: `Which section of ${g.name}? The PDF doesn't say` };
}

const TITLES = /\b(mr|mrs|ms|miss|dr|prof|sir|madam|teacher)\b\.?/gi;
const nameTokens = (n) => clean(n).replace(TITLES, ' ').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

// teachers: [{ id, name }]. Full-name match, else a unique surname/first-name match.
function matchTeacher(rawName, teachers) {
  const want = nameTokens(rawName);
  if (!want.length) return null;
  const full = want.join(' ');
  const exact = (teachers || []).filter((t) => nameTokens(t.name).join(' ') === full);
  if (exact.length === 1) return exact[0].id;
  if (want.length === 1) {
    const partial = (teachers || []).filter((t) => nameTokens(t.name).includes(want[0]));
    if (partial.length === 1) return partial[0].id;
  }
  return null;
}

module.exports = {
  normalizeDay, normalizeTime, normalizePeriods, normalizeCells, parseClassLabel, matchClass, matchTeacher,
};

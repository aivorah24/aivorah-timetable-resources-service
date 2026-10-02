jest.mock('../../services/supabase', () => ({}));
const n = require('../../services/timetableImport/normalize');
const { buildPreview } = require('../../services/timetableImport/extract');
const { cleanSlots } = require('../../routes/timetableImport');

const grades = [
  { name: 'Grade 6', sections: ['A'] },
  { name: 'Grade 7', sections: ['A', 'B'] },
  { name: 'PYP 4', sections: ['A', 'B'] },
  { name: 'Sunflower', sections: ['A'] },
];

describe('normalizeTime', () => {
  test.each([
    ['8:30', '08:30'], ['08:30', '08:30'], ['1:00', '13:00'], ['12:15', '12:15'], ['1:00 pm', '13:00'],
    ['7 am', '07:00'], ['13.05', '13:05'], ['0830', '08:30'], ['12 am', '00:00'], ['', ''], ['noon', ''], ['25:00', ''],
  ])('%s -> %s', (raw, want) => expect(n.normalizeTime(raw)).toBe(want));
});

test('normalizeDay', () => {
  expect(['Monday', 'tue', 'WED.', 'Thurs', 'fri', 'Saturday', 'Sunday', ''].map(n.normalizeDay))
    .toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', null, null]);
});

describe('parseClassLabel / matchClass', () => {
  test.each([
    ['Class VII - A', { grade: 'Grade 7', section: 'A' }],
    ['Grade 7 B', { grade: 'Grade 7', section: 'B' }],
    ['7B', { grade: 'Grade 7', section: 'B' }],
    ['Std VI', { grade: 'Grade 6', section: 'A' }],
    ['Grade 7 Section b', { grade: 'Grade 7', section: 'B' }],
    ['PYP 4 B', { grade: 'PYP 4', section: 'B' }],
  ])('%s matches', (label, want) => expect(n.matchClass(label, grades).match).toEqual(want));

  test('unmatched classes explain why', () => {
    expect(n.matchClass('Class 7', grades)).toEqual({ match: null, reason: "Which section of Grade 7? The PDF doesn't say" });
    expect(n.matchClass('Class 7 - C', grades).reason).toBe('Grade 7 has no section C');
    expect(n.matchClass('Class X - A', grades).reason).toBe('No grade 10 in this school');
    expect(n.matchClass('Sunflower', grades).reason).toMatch(/Couldn't read a grade number/);
    expect(n.matchClass('Grade 4', grades).reason).toBe('No grade 4 in this school');
  });
});

test('matchTeacher: full name, unique surname, ignores titles; ambiguous or unknown -> null', () => {
  const t = [{ id: 1, name: 'Anita Rao' }, { id: 2, name: 'Ravi Iyer' }, { id: 3, name: 'Meena Iyer' }];
  expect(n.matchTeacher('Ms. Anita Rao', t)).toBe(1);
  expect(n.matchTeacher('Mrs. Rao', t)).toBe(1);
  expect(n.matchTeacher('Mr. Iyer', t)).toBeNull();
  expect(n.matchTeacher('Mr. Khan', t)).toBeNull();
  expect(n.matchTeacher('', t)).toBeNull();
});

test('normalizePeriods: numbered and break rows, unique teaching codes', () => {
  const { periodDefs } = n.normalizePeriods([
    { label: '1', start: '8:30', end: '9:15' },
    { label: 'Short Break', start: '9:15', end: '9:30', isBreak: true },
    { label: 'P2', start: '9:30', end: '10:15' },
    { label: 'Lunch', start: '12:00', end: '12:30' },
    { label: 'Period 2', start: '1:00', end: '1:45' },
  ]);
  expect(periodDefs).toEqual([
    { code: 'P1', start: '08:30', end: '09:15', isBreak: false },
    { code: 'BRK', start: '09:15', end: '09:30', isBreak: true },
    { code: 'P2', start: '09:30', end: '10:15', isBreak: false },
    { code: 'LUNCH', start: '12:00', end: '12:30', isBreak: true },
    { code: 'P3', start: '13:00', end: '13:45', isBreak: false },
  ]);
});

test('buildPreview: matches class and teachers, drops bad cells with warnings, respects canSave', () => {
  const raw = {
    classes: [{
      label: 'Class VII - B',
      homeroomTeacher: 'Mr. Iyer',
      periods: [{ label: '1', start: '8:00', end: '8:45' }, { label: 'Break', start: '8:45', end: '9:00', isBreak: true }, { label: '2', start: '9:00', end: '9:45' }],
      cells: [
        { day: 'Monday', period: '1', subject: 'Maths', teacher: 'Ms. Rao', room: '' },
        { day: 'Monday', period: 'Break', subject: 'Science', teacher: '' },
        { day: 'Sunday', period: '2', subject: 'Art', teacher: '' },
        { day: 'Monday', period: '1', subject: 'English', teacher: '' },
        { day: 'Tue', period: '2', subject: 'Hindi', teacher: 'Mr. Unknown' },
      ],
    }, { label: 'Class 12 A', periods: [], cells: [] }],
  };
  const [c, missing] = buildPreview(raw, { grades, teachers: [{ id: 't1', name: 'Anita Rao' }], canSave: (m) => m.section === 'B' });
  expect(c.match).toEqual({ grade: 'Grade 7', section: 'B' });
  expect(c.canSave).toBe(true);
  expect(c.slots).toEqual([
    { day: 'MON', periodCode: 'P1', subject: 'Maths', room: '', teacherName: 'Ms. Rao', teacherId: 't1' },
    { day: 'TUE', periodCode: 'P2', subject: 'Hindi', room: '', teacherName: 'Mr. Unknown', teacherId: null },
  ]);
  expect(c.warnings).toHaveLength(4);
  expect(c.warnings.join(' ')).toMatch(/Mr\. Unknown/);
  expect(missing.match).toBeNull();
  expect(missing.canSave).toBe(false);
  expect(missing.warnings).toContain('No periods found');
});

test('cleanSlots keeps real days/teaching periods and only this school\'s teachers', () => {
  const periods = [{ code: 'P1', isBreak: false }, { code: 'BRK', isBreak: true }];
  const out = cleanSlots([
    { day: 'MON', periodCode: 'P1', subject: ' Maths ', teacherId: 't1' },
    { day: 'MON', periodCode: 'P1', subject: 'Dup' },
    { day: 'TUE', periodCode: 'BRK', subject: 'X' },
    { day: 'SUN', periodCode: 'P1', subject: 'X' },
    { day: 'WED', periodCode: 'P1', subject: 'Art', teacherId: 'other-school' },
    { day: 'THU', periodCode: 'P1', subject: '' },
  ], periods, new Set(['t1']));
  expect(out).toEqual([
    { day: 'MON', periodCode: 'P1', subject: 'Maths', room: '', teacherId: 't1' },
    { day: 'WED', periodCode: 'P1', subject: 'Art', room: '', teacherId: null },
  ]);
});

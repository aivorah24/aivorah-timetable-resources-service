const { buildTeacherTimetable } = require('../../services/teacherTimetable');

const STD = [
  { code: 'P1', start: '08:50', end: '09:35', isBreak: false },
  { code: 'P2', start: '09:35', end: '10:20', isBreak: false },
  { code: 'BRK', start: '10:20', end: '10:40', isBreak: true },
  { code: 'P3', start: '10:40', end: '11:25', isBreak: false },
];
const TEACHER = { id: 't1', name: 'Ms Rao' };
const slot = (id, timetable_id, day, period_code, subject, extra = {}) =>
  ({ id, timetable_id, day_of_week: day, period_code, subject_name: subject, room_name: null, ...extra });

describe('buildTeacherTimetable', () => {
  test('collects the teacher\'s periods from several classes into one week, each with its class', () => {
    const tts = [
      { id: 'a', grade: 'Grade 4', section: 'A', period_defs: STD },
      { id: 'b', grade: 'Grade 5', section: 'B', period_defs: STD },
    ];
    const r = buildTeacherTimetable(tts, [
      slot('1', 'a', 'MON', 'P1', 'Maths', { room_name: 'R4' }),
      slot('2', 'b', 'MON', 'P2', 'Maths'),
      slot('3', 'a', 'TUE', 'P3', 'Science'),
    ], TEACHER);

    expect(r.periodDefs.map((p) => p.code)).toEqual(['P1', 'P2', 'BRK', 'P3']);
    expect(r.periodDefs.find((p) => p.code === 'BRK').isBreak).toBe(true);
    expect(r.slots.map((s) => [s.day, s.periodCode, s.subject, s.classLabel])).toEqual([
      ['MON', 'P1', 'Maths', 'Grade 4 A'],
      ['MON', 'P2', 'Maths', 'Grade 5 B'],
      ['TUE', 'P3', 'Science', 'Grade 4 A'],
    ]);
    expect(r.slots[0]).toMatchObject({ room: 'R4', teacherId: 't1', teacherName: 'Ms Rao', grade: 'Grade 4', section: 'A' });
    expect(r.clashes).toEqual([]);
  });

  test('the same time under a different period name is one row', () => {
    const other = [{ code: '1', start: '08:50', end: '09:35', isBreak: false }];
    const r = buildTeacherTimetable(
      [{ id: 'a', grade: 'Grade 4', section: 'A', period_defs: STD }, { id: 'b', grade: 'Grade 6', section: '', period_defs: other }],
      [slot('1', 'a', 'MON', 'P1', 'Maths'), slot('2', 'b', 'WED', '1', 'Maths')],
      TEACHER,
    );
    expect(r.periodDefs.filter((p) => p.start === '08:50')).toHaveLength(1);
    expect(r.slots.map((s) => [s.day, s.periodCode, s.classLabel])).toEqual([['MON', 'P1', 'Grade 4 A'], ['WED', 'P1', 'Grade 6']]);
  });

  test('rows are in time order across classes with different bells', () => {
    const late = [{ code: 'P1', start: '09:00', end: '09:45', isBreak: false }, { code: 'P0', start: '08:00', end: '08:45', isBreak: false }];
    const r = buildTeacherTimetable(
      [{ id: 'a', grade: 'Grade 4', section: 'A', period_defs: STD }, { id: 'b', grade: 'Grade 9', section: 'A', period_defs: late }],
      [slot('1', 'a', 'MON', 'P1', 'Maths'), slot('2', 'b', 'MON', 'P1', 'Physics')],
      TEACHER,
    );
    expect(r.periodDefs.map((p) => p.start)).toEqual(['08:00', '08:50', '09:00', '09:35', '10:20', '10:40']);
    // two different "P1"s get their time added so each row is distinct
    expect(r.slots.map((s) => s.periodCode)).toEqual(['P1 (08:50)', 'P1 (09:00)']);
  });

  test('periods without times are matched by their code and keep the class order', () => {
    const noTimes = [{ code: 'P0' }, { code: 'P1' }, { code: 'BRK', isBreak: true }, { code: 'P2' }];
    const r = buildTeacherTimetable(
      [{ id: 'a', grade: 'Grade 2', section: 'A', period_defs: noTimes }, { id: 'b', grade: 'Grade 3', section: 'A', period_defs: noTimes }],
      [slot('1', 'b', 'MON', 'P2', 'Art'), slot('2', 'a', 'FRI', 'p0', 'Art'), slot('3', 'a', 'FRI', 'P0', 'Art')],
      TEACHER,
    );
    expect(r.periodDefs.map((p) => p.code)).toEqual(['P0', 'P1', 'BRK', 'P2']);
    // 'p0' isn't a period of that class -> dropped rather than guessed
    expect(r.slots.map((s) => [s.day, s.periodCode, s.classLabel])).toEqual([['MON', 'P2', 'Grade 3 A'], ['FRI', 'P0', 'Grade 2 A']]);
  });

  test('a double-booked period is reported as a clash', () => {
    const tts = [
      { id: 'a', grade: 'Grade 4', section: 'A', period_defs: STD },
      { id: 'b', grade: 'Grade 4', section: 'B', period_defs: STD },
    ];
    const r = buildTeacherTimetable(tts, [slot('1', 'a', 'THU', 'P2', 'Maths'), slot('2', 'b', 'THU', 'P2', 'Maths')], TEACHER);
    expect(r.clashes).toEqual([{ day: 'THU', periodCode: 'P2', classes: ['Grade 4 A', 'Grade 4 B'] }]);
  });

  test('no periods assigned -> empty grid, not an error', () => {
    expect(buildTeacherTimetable([{ id: 'a', grade: 'Grade 4', section: 'A', period_defs: STD }], [], TEACHER))
      .toEqual({ periodDefs: [], slots: [], clashes: [] });
  });

  test('slots on a break, an unknown day or a missing timetable are skipped', () => {
    const r = buildTeacherTimetable(
      [{ id: 'a', grade: 'Grade 4', section: 'A', period_defs: STD }],
      [slot('1', 'a', 'MON', 'BRK', 'Duty'), slot('2', 'a', 'SUN', 'P1', 'Maths'), slot('3', 'gone', 'MON', 'P1', 'Maths')],
      TEACHER,
    );
    expect(r.slots).toEqual([]);
  });
});

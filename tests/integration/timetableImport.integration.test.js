// PDF import routes through Supertest; Firebase, Supabase, the store and the PDF reader are mocked.

const USERS = {
  admin: { id: 'u1', role: 'school_admin', school_id: 's1', email: 'admin@s1.org' },
  homeroom: { id: 'u2', role: 'teacher', school_id: 's1', email: 'home@s1.org' },
  parent: { id: 'u4', role: 'parent', school_id: 's1', email: 'parent@s1.org' },
};

jest.mock('../../services/firebaseAdmin', () => ({
  auth: () => ({ verifyIdToken: jest.fn(async (token) => ({ email: `${token}@token` })) }),
}));
jest.mock('../../services/supabase', () => {
  const chain = { select: jest.fn().mockReturnThis(), eq: jest.fn(function (c, v) { this._email = v; return this; }), maybeSingle: jest.fn() };
  return { from: jest.fn(() => chain), _chain: chain };
});
jest.mock('../../services/academicStructure', () => ({
  buildGradesSectionsView: jest.fn(async () => [
    { name: 'Grade 7', sections: [{ name: 'A', classTeacherEmail: 'home@s1.org' }, { name: 'B', classTeacherEmail: null }] },
  ]),
}));
jest.mock('../../services/timetableStore', () => ({
  schoolTeachers: jest.fn(async () => [{ id: 't1', name: 'Anita Rao' }]),
  saveTemplate: jest.fn(async () => 'tt1'),
  replaceSlots: jest.fn(),
}));
jest.mock('../../services/timetableImport/pdfReader', () => {
  class ExtractionUnavailableError extends Error {}
  return { readPdfAsJson: jest.fn(), ExtractionUnavailableError };
});

const request = require('supertest');
const supabase = require('../../services/supabase');
const store = require('../../services/timetableStore');
const gemini = require('../../services/timetableImport/pdfReader');
const app = require('../../index');

const as = (key) => ({ Authorization: `Bearer ${key}` });
const PDF = Buffer.from('%PDF-1.4 test');
const MODEL_OUTPUT = {
  classes: [
    { label: 'Class VII - A', homeroomTeacher: '', periods: [{ label: '1', start: '8:00', end: '8:45' }], cells: [{ day: 'Monday', period: '1', subject: 'Maths', teacher: 'Ms. Rao' }] },
    { label: 'Class VII - B', homeroomTeacher: '', periods: [{ label: '1', start: '8:00', end: '8:45' }], cells: [] },
  ],
};
const PERIODS = [{ code: 'P1', start: '08:00', end: '08:45', isBreak: false }];

beforeEach(() => {
  jest.clearAllMocks();
  supabase._chain.maybeSingle.mockImplementation(async () => ({ data: USERS[String(supabase._chain._email).replace('@token', '')] || null, error: null }));
  gemini.readPdfAsJson.mockResolvedValue(MODEL_OUTPUT);
});

describe('POST /timetable/import/preview', () => {
  test('no sign-in -> 401; parent -> 403', async () => {
    expect((await request(app).post('/timetable/import/preview')).status).toBe(401);
    const r = await request(app).post('/timetable/import/preview').set(as('parent')).attach('file', PDF, 'tt.pdf');
    expect(r.status).toBe(403);
  });

  test('non-PDF -> 400, no file -> 400', async () => {
    expect((await request(app).post('/timetable/import/preview').set(as('admin')).attach('file', Buffer.from('x'), { filename: 'a.png', contentType: 'image/png' })).status).toBe(400);
    expect((await request(app).post('/timetable/import/preview').set(as('admin'))).status).toBe(400);
  });

  test('homeroom teacher: both classes matched, only their own class can be saved; nothing written', async () => {
    const r = await request(app).post('/timetable/import/preview').set(as('homeroom')).attach('file', PDF, { filename: 'tt.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(200);
    expect(r.body.classes.map((c) => [c.label, c.match, c.canSave])).toEqual([
      ['Class VII - A', { grade: 'Grade 7', section: 'A' }, true],
      ['Class VII - B', { grade: 'Grade 7', section: 'B' }, false],
    ]);
    expect(r.body.classes[0].slots[0]).toMatchObject({ day: 'MON', periodCode: 'P1', subject: 'Maths', teacherId: 't1' });
    expect(store.saveTemplate).not.toHaveBeenCalled();
  });

  test('PDF with no timetable -> 422; model unavailable -> 503', async () => {
    gemini.readPdfAsJson.mockResolvedValueOnce({ classes: [] });
    expect((await request(app).post('/timetable/import/preview').set(as('admin')).attach('file', PDF, 'tt.pdf')).status).toBe(422);
    gemini.readPdfAsJson.mockRejectedValueOnce(new gemini.ExtractionUnavailableError('busy'));
    expect((await request(app).post('/timetable/import/preview').set(as('admin')).attach('file', PDF, 'tt.pdf')).status).toBe(503);
  });
});

describe('POST /timetable/import/commit', () => {
  const body = (grade, section, slots = [{ day: 'MON', periodCode: 'P1', subject: 'Maths', teacherId: 't1' }]) => ({ grade, section, periodDefs: PERIODS, slots });

  test('admin saves every class in its school, always in its own school', async () => {
    const r = await request(app).post('/timetable/import/commit').set(as('admin')).send({ timetables: [body('Grade 7', 'A'), body('Grade 7', 'B')] });
    expect(r.status).toBe(200);
    expect(r.body.saved).toBe(2);
    expect(store.saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ schoolId: 's1', grade: 'Grade 7', section: 'A', updatedBy: 'admin@s1.org' }));
    expect(store.replaceSlots).toHaveBeenCalledWith('tt1', [{ day: 'MON', periodCode: 'P1', subject: 'Maths', room: '', teacherId: 't1' }], 'admin@s1.org');
  });

  test('homeroom teacher: own class saved, other class refused', async () => {
    const r = await request(app).post('/timetable/import/commit').set(as('homeroom')).send({ timetables: [body('Grade 7', 'A'), body('Grade 7', 'B')] });
    expect(r.body.results.map((x) => x.ok)).toEqual([true, false]);
    expect(r.body.results[1].error).toMatch(/homeroom teacher/);
  });

  test('unknown class and bad periods are refused per class', async () => {
    const r = await request(app).post('/timetable/import/commit').set(as('admin')).send({
      timetables: [body('Grade 9', 'A'), { grade: 'Grade 7', section: 'A', periodDefs: [{ code: 'P1', start: '8.00' }], slots: [] }],
    });
    expect(r.body.results.map((x) => x.ok)).toEqual([false, false]);
    expect(r.body.results[0].error).toMatch(/not a class in this school/);
    expect(store.saveTemplate).not.toHaveBeenCalled();
  });

  test('empty list -> 400; parent -> 403', async () => {
    expect((await request(app).post('/timetable/import/commit').set(as('admin')).send({ timetables: [] })).status).toBe(400);
    expect((await request(app).post('/timetable/import/commit').set(as('parent')).send({ timetables: [body('Grade 7', 'A')] })).status).toBe(403);
  });
});

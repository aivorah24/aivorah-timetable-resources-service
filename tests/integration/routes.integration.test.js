// Real routes + auth middleware through Supertest; Firebase, Supabase, the
// stores and Cloudinary are mocked at the module boundary.

const USERS = {
  admin: { id: 'u1', role: 'school_admin', school_id: 's1', email: 'admin@s1.org' },
  homeroom: { id: 'u2', role: 'teacher', school_id: 's1', email: 'home@s1.org' },
  teacher: { id: 'u3', role: 'teacher', school_id: 's1', email: 'other@s1.org' },
  parent: { id: 'u4', role: 'parent', school_id: 's1', email: 'parent@s1.org' },
  student: { id: 'u5', role: 'student', school_id: 's1', email: 'kid@s1.org', grade: 'Grade 7', section: 'A' },
};

jest.mock('../../services/firebaseAdmin', () => ({
  auth: () => ({
    verifyIdToken: jest.fn(async (token) => {
      if (token === 'bad') throw new Error('invalid');
      if (token === 'stranger') return { email: 'nobody@x.org' };
      return { email: `${token}@token` };
    }),
  }),
}));

jest.mock('../../services/supabase', () => {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn(function (col, val) { this._email = val; return this; }),
    maybeSingle: jest.fn(),
  };
  return { from: jest.fn(() => chain), _chain: chain };
});

jest.mock('../../services/academicStructure', () => ({
  buildGradesSectionsView: jest.fn(async () => [
    { name: 'Grade 7', sections: [{ name: 'A', classTeacherEmail: 'home@s1.org' }, { name: 'B', classTeacherEmail: null }] },
  ]),
}));
jest.mock('../../services/timetableStore', () => ({
  childrenOf: jest.fn(async () => [{ name: 'Kid', grade: 'Grade 7', section: 'B' }]),
  schoolCurriculum: jest.fn(async () => 'CBSE'),
  findTimetable: jest.fn(),
  loadSlots: jest.fn(async () => []),
  namesById: jest.fn(async () => new Map()),
  saveTemplate: jest.fn(async () => 'tt1'),
  upsertSlot: jest.fn(),
  deleteSlot: jest.fn(),
}));
jest.mock('../../services/resourcesStore', () => ({
  childrenScopes: jest.fn(async () => [{ grade: 'Grade 7' }]),
  listFolders: jest.fn(async () => []),
  listFiles: jest.fn(async () => []),
  getFolder: jest.fn(),
  namesByEmail: jest.fn(async () => new Map()),
  createFolder: jest.fn(async () => 'f1'),
  createFile: jest.fn(async () => 'file1'),
  remove: jest.fn(async () => 1),
}));
jest.mock('../../services/storage', () => ({ uploadDocument: jest.fn(async () => 'https://cdn.test/doc.pdf') }));

const request = require('supertest');
const supabase = require('../../services/supabase');
const tt = require('../../services/timetableStore');
const res = require('../../services/resourcesStore');
const app = require('../../index');

// Token "<key>" signs in as USERS[key].
const as = (key) => ({ Authorization: `Bearer ${key}` });
const PERIODS = [{ code: 'P1', start: '08:50', end: '09:40', isBreak: false }, { code: 'BRK', start: '09:40', end: '10:00', isBreak: true }];

beforeEach(() => {
  jest.clearAllMocks();
  supabase._chain.maybeSingle.mockImplementation(async function () {
    const key = String(supabase._chain._email || '').replace('@token', '');
    return { data: USERS[key] || null, error: null };
  });
  tt.findTimetable.mockResolvedValue({ id: 'tt1', title: 'Grade 7 A Timetable', period_defs: PERIODS });
  res.getFolder.mockResolvedValue(null);
});

describe('sign-in', () => {
  test('no token -> 401', async () => {
    expect((await request(app).get('/timetable/classes')).status).toBe(401);
    expect((await request(app).get('/resources')).status).toBe(401);
  });
  test('invalid token -> 401', async () => {
    expect((await request(app).get('/resources').set(as('bad'))).status).toBe(401);
  });
  test('valid token but no Aivorah account -> 403', async () => {
    expect((await request(app).get('/resources').set(as('stranger'))).status).toBe(403);
  });
  test('an email in the query is ignored; the token decides', async () => {
    const r = await request(app).put('/timetable/template').set(as('teacher'))
      .send({ email: 'admin@s1.org', grade: 'Grade 7', section: 'A', periodDefs: PERIODS });
    expect(r.status).toBe(403);
  });
  test('health needs no token', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
  });
});

describe('timetable', () => {
  test('classes: teacher gets homeroom first', async () => {
    const r = await request(app).get('/timetable/classes').set(as('homeroom'));
    expect(r.status).toBe(200);
    expect(r.body.classes[0]).toMatchObject({ label: 'Grade 7 A', homeroom: true });
    expect(r.body.grades).toEqual([]);
  });
  test('classes: admin also gets the grade picker', async () => {
    const r = await request(app).get('/timetable/classes').set(as('admin'));
    expect(r.body.grades).toEqual([{ name: 'Grade 7', sections: ['A', 'B'] }]);
    expect(r.body.curriculum).toBe('CBSE');
  });
  test('view: homeroom teacher can manage, other teacher only edit slots', async () => {
    const a = await request(app).get('/timetable').query({ grade: 'Grade 7', section: 'A' }).set(as('homeroom'));
    expect(a.body.permissions).toEqual({ canManageTemplate: true, canEditSlot: true });
    const b = await request(app).get('/timetable').query({ grade: 'Grade 7', section: 'A' }).set(as('teacher'));
    expect(b.body.permissions).toEqual({ canManageTemplate: false, canEditSlot: true });
  });
  test('view: always reads the signed-in user\'s school, not a schoolId param', async () => {
    await request(app).get('/timetable').query({ grade: 'Grade 7', section: 'A', schoolId: 'other' }).set(as('admin'));
    expect(tt.findTimetable).toHaveBeenCalledWith('s1', 'Grade 7', 'A');
  });
  test('view: parent of another class -> 403; own child\'s class -> read-only', async () => {
    expect((await request(app).get('/timetable').query({ grade: 'Grade 7', section: 'A' }).set(as('parent'))).status).toBe(403);
    const ok = await request(app).get('/timetable').query({ grade: 'Grade 7', section: 'B' }).set(as('parent'));
    expect(ok.body.permissions).toEqual({ canManageTemplate: false, canEditSlot: false });
  });
  test('template: homeroom saves; validation rejects bad time and duplicate labels', async () => {
    const ok = await request(app).put('/timetable/template').set(as('homeroom')).send({ grade: 'Grade 7', section: 'A', periodDefs: PERIODS });
    expect(ok.status).toBe(200);
    expect(tt.saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ schoolId: 's1', updatedBy: 'home@s1.org' }));
    const badTime = await request(app).put('/timetable/template').set(as('homeroom'))
      .send({ grade: 'Grade 7', section: 'A', periodDefs: [{ code: 'P1', start: '8.50' }] });
    expect(badTime.status).toBe(400);
    const dup = await request(app).put('/timetable/template').set(as('admin'))
      .send({ grade: 'Grade 7', section: 'A', periodDefs: [{ code: 'P1' }, { code: 'p1' }] });
    expect(dup.status).toBe(400);
  });
  test('slot: student -> 403, teacher saves, empty subject clears, break or unknown period -> 400', async () => {
    const body = { grade: 'Grade 7', section: 'A', day: 'MON', periodCode: 'P1', subject: 'Maths' };
    expect((await request(app).put('/timetable/slot').set(as('student')).send(body)).status).toBe(403);
    expect((await request(app).put('/timetable/slot').set(as('teacher')).send(body)).status).toBe(200);
    expect(tt.upsertSlot).toHaveBeenCalledWith('tt1', 'MON', 'P1', expect.objectContaining({ subject_name: 'Maths' }), 'other@s1.org');
    const clear = await request(app).put('/timetable/slot').set(as('teacher')).send({ ...body, subject: ' ' });
    expect(clear.body.cleared).toBe(true);
    expect((await request(app).put('/timetable/slot').set(as('teacher')).send({ ...body, periodCode: 'BRK' })).status).toBe(400);
    expect((await request(app).put('/timetable/slot').set(as('teacher')).send({ ...body, day: 'SUN' })).status).toBe(400);
  });
  test('slot: no bell schedule yet -> 409', async () => {
    tt.findTimetable.mockResolvedValueOnce(null);
    const r = await request(app).put('/timetable/slot').set(as('teacher')).send({ grade: 'Grade 7', section: 'A', day: 'MON', periodCode: 'P1', subject: 'X' });
    expect(r.status).toBe(409);
  });
});

describe('resources', () => {
  test('parent can read but not manage', async () => {
    const r = await request(app).get('/resources').set(as('parent'));
    expect(r.status).toBe(200);
    expect(r.body.canManage).toBe(false);
    expect((await request(app).post('/resources/folder').set(as('parent')).send({ name: 'X' })).status).toBe(403);
    expect((await request(app).delete('/resources/file/f1').set(as('parent'))).status).toBe(403);
  });
  test('parent only sees school + child-grade scoped items', async () => {
    res.listFolders.mockResolvedValueOnce([
      { id: 'a', name: 'All', scope: 'school' }, { id: 'b', name: 'G7', scope: 'Grade 7' }, { id: 'c', name: 'G9', scope: 'Grade 9' },
    ]);
    const r = await request(app).get('/resources').set(as('parent'));
    expect(r.body.folders.map((f) => f.name)).toEqual(['All', 'G7']);
  });
  test('teacher creates a folder in their own school', async () => {
    const r = await request(app).post('/resources/folder').set(as('teacher')).send({ name: ' Policies ', email: 'admin@s1.org' });
    expect(r.status).toBe(201);
    expect(res.createFolder).toHaveBeenCalledWith(expect.objectContaining({ school_id: 's1', name: 'Policies', created_by: 'other@s1.org' }));
  });
  test('a parent folder from another school -> 404', async () => {
    const r = await request(app).post('/resources/folder').set(as('teacher')).send({ name: 'X', parentFolderId: 'elsewhere' });
    expect(r.status).toBe(404);
    expect(res.createFolder).not.toHaveBeenCalled();
  });
  test('file must be an https url', async () => {
    const r = await request(app).post('/resources/file').set(as('admin')).send({ title: 'T', fileUrl: 'javascript:alert(1)' });
    expect(r.status).toBe(400);
  });
  test('delete of an item not in this school -> 404', async () => {
    res.remove.mockResolvedValueOnce(0);
    expect((await request(app).delete('/resources/folder/zzz').set(as('admin'))).status).toBe(404);
  });
});

describe('uploads', () => {
  test('teacher uploads a PDF', async () => {
    const r = await request(app).post('/uploads').set(as('teacher')).attach('file', Buffer.from('%PDF-1.4'), { filename: 'Handbook.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ url: 'https://cdn.test/doc.pdf', name: 'Handbook.pdf', type: 'pdf' });
  });
  test('parent -> 403; other file types -> 400', async () => {
    expect((await request(app).post('/uploads').set(as('parent')).attach('file', Buffer.from('x'), 'a.pdf')).status).toBe(403);
    const r = await request(app).post('/uploads').set(as('teacher')).attach('file', Buffer.from('x'), { filename: 'a.exe', contentType: 'application/octet-stream' });
    expect(r.status).toBe(400);
  });
});

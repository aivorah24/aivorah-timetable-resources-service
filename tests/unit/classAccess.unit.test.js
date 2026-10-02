const access = require('../../services/classAccess');

const grades = [
  { name: 'Grade 7', sections: [{ name: 'A', classTeacherEmail: 'Home@School.org' }, { name: 'B', classTeacherEmail: null }] },
  { name: 'Grade 8', sections: [] },
  { name: 'Old', archived: true, sections: [{ name: 'A' }] },
];
const school = 's1';
const admin = { role: 'school_admin', school_id: school, email: 'admin@school.org' };
const homeroom = { role: 'teacher', school_id: school, email: 'home@school.org' };
const teacher = { role: 'teacher', school_id: school, email: 'other@school.org' };
const student = { role: 'student', school_id: school, grade: 'Grade 7', section: 'A' };
const parent = { role: 'parent', school_id: school, email: 'p@x.org' };

describe('canManageTemplate', () => {
  test('school admin: any class', () => expect(access.canManageTemplate(admin, grades, 'Grade 8', '')).toBe(true));
  test('homeroom teacher: own class, email case-insensitive', () => expect(access.canManageTemplate(homeroom, grades, 'Grade 7', 'A')).toBe(true));
  test('homeroom teacher: not another class', () => expect(access.canManageTemplate(homeroom, grades, 'Grade 7', 'B')).toBe(false));
  test('other teacher: no', () => expect(access.canManageTemplate(teacher, grades, 'Grade 7', 'A')).toBe(false));
  test('no school: no', () => expect(access.canManageTemplate({ ...admin, school_id: null }, grades, 'Grade 7', 'A')).toBe(false));
});

describe('canEditSlot', () => {
  test('any teacher in the school', () => expect(access.canEditSlot(teacher, grades, 'Grade 7', 'B')).toBe(true));
  test('student and parent never', () => {
    expect(access.canEditSlot(student, grades, 'Grade 7', 'A')).toBe(false);
    expect(access.canEditSlot(parent, grades, 'Grade 7', 'A')).toBe(false);
  });
});

describe('canViewClass', () => {
  test('student: own class only', () => {
    expect(access.canViewClass(student, [], 'Grade 7', 'A')).toBe(true);
    expect(access.canViewClass(student, [], 'Grade 7', 'B')).toBe(false);
  });
  test('parent: a child\'s class only', () => {
    const kids = [{ grade: 'Grade 7', section: 'B' }];
    expect(access.canViewClass(parent, kids, 'Grade 7', 'B')).toBe(true);
    expect(access.canViewClass(parent, kids, 'Grade 7', 'A')).toBe(false);
  });
  test('teacher and admin: any class', () => {
    expect(access.canViewClass(teacher, [], 'Grade 8', '')).toBe(true);
    expect(access.canViewClass(admin, [], 'Grade 7', 'A')).toBe(true);
  });
});

describe('classesFor', () => {
  test('admin: every active class, no archived grades', () => {
    expect(access.classesFor(admin, grades, []).map((c) => c.label)).toEqual(['Grade 7 A', 'Grade 7 B', 'Grade 8']);
  });
  test('teacher: homeroom classes first', () => {
    const cs = access.classesFor(homeroom, grades, []);
    expect(cs[0]).toMatchObject({ label: 'Grade 7 A', homeroom: true });
    expect(cs).toHaveLength(3);
  });
  test('student: own class', () => {
    expect(access.classesFor(student, grades, [])).toEqual([{ grade: 'Grade 7', section: 'A', label: 'Grade 7 A', homeroom: false }]);
  });
  test('parent: each child\'s class once, with the child name', () => {
    const kids = [{ name: 'Asha', grade: 'Grade 7', section: 'A' }, { name: 'Ravi', grade: 'Grade 7', section: 'A' }, { name: 'X', grade: '' }];
    const cs = access.classesFor(parent, grades, kids);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ label: 'Grade 7 A', studentName: 'Asha' });
  });
});

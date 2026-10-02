/**
 * Who may see or change a class timetable. Pure functions over the verified
 * user (middleware/auth.js) and the school's grades view
 * (services/academicStructure.buildGradesSectionsView).
 *
 *   VIEW     students of the class, parents of a child in it, any teacher/admin in the school
 *   TEMPLATE school admin, or the class's homeroom teacher
 *   SLOT     template managers, or any teacher in the school
 */

const ADMIN_ROLES = ['school_admin', 'super_admin'];
const MANAGER_ROLES = ['teacher', ...ADMIN_ROLES];

const norm = (v) => String(v || '').trim();
const isAdmin = (user) => !!user && ADMIN_ROLES.includes(user.role);
const isManager = (user) => !!user && MANAGER_ROLES.includes(user.role);

function findSection(grades, grade, section) {
  const g = (grades || []).find((x) => norm(x.name) === norm(grade));
  return g ? (g.sections || []).find((s) => norm(s.name) === norm(section)) || null : null;
}

function isHomeroomTeacher(user, grades, grade, section) {
  if (!user || user.role !== 'teacher') return false;
  const s = findSection(grades, grade, section);
  return !!s && norm(s.classTeacherEmail).toLowerCase() === norm(user.email).toLowerCase();
}

function canManageTemplate(user, grades, grade, section) {
  if (!user || !user.school_id) return false;
  return isAdmin(user) || isHomeroomTeacher(user, grades, grade, section);
}

function canEditSlot(user, grades, grade, section) {
  if (!user || !user.school_id) return false;
  return canManageTemplate(user, grades, grade, section) || user.role === 'teacher';
}

// children: [{ grade, section }] of a parent's linked children.
function canViewClass(user, children, grade, section) {
  if (!user || !user.school_id) return false;
  if (isManager(user)) return true;
  const same = (c) => norm(c.grade) === norm(grade) && norm(c.section) === norm(section);
  if (user.role === 'student') return same(user);
  if (user.role === 'parent') return (children || []).some(same);
  return false;
}

const classOf = (grade, section, extra = {}) => ({
  grade, section, label: `${grade}${section ? ' ' + section : ''}`, ...extra,
});

// The classes a user can pick on the Timetable screen.
function classesFor(user, grades, children) {
  if (!user || !user.school_id) return [];
  const active = (grades || []).filter((g) => !g.archived);
  if (isManager(user)) {
    const all = [];
    for (const g of active) {
      const secs = (g.sections || []).filter((s) => !s.archived);
      if (!secs.length) all.push(classOf(g.name, '', { homeroom: false }));
      for (const s of secs) all.push(classOf(g.name, s.name, { homeroom: isHomeroomTeacher(user, grades, g.name, s.name) }));
    }
    return user.role === 'teacher' ? [...all.filter((c) => c.homeroom), ...all.filter((c) => !c.homeroom)] : all;
  }
  const own = user.role === 'student' ? [user] : (children || []);
  const seen = new Set();
  return own
    .filter((c) => norm(c.grade))
    .map((c) => classOf(norm(c.grade), norm(c.section), { homeroom: false, ...(c.name ? { studentName: c.name } : {}) }))
    .filter((c) => (seen.has(c.label) ? false : seen.add(c.label)));
}

module.exports = {
  MANAGER_ROLES, isAdmin, isManager, findSection, isHomeroomTeacher,
  canManageTemplate, canEditSlot, canViewClass, classesFor,
};

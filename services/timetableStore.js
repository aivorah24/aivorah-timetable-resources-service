// Data access for class_timetables / timetable_slots and the lookups the
// timetable routes need.
const supabase = require('./supabase');

async function childrenOf(parentEmail) {
  const { data, error } = await supabase
    .from('parent_children')
    .select('users!parent_children_child_id_fkey(name, grade, section)')
    .eq('parent_email', parentEmail);
  if (error) throw error;
  return (data || []).map((r) => r.users).filter(Boolean);
}

async function schoolCurriculum(schoolId) {
  const { data } = await supabase.from('schools').select('curriculum').eq('id', schoolId).maybeSingle();
  return data?.curriculum || null;
}

async function findTimetable(schoolId, grade, section) {
  const { data, error } = await supabase
    .from('class_timetables')
    .select('id, title, period_defs')
    .eq('school_id', schoolId).eq('grade', grade).eq('section', section)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadSlots(timetableId) {
  const { data, error } = await supabase
    .from('timetable_slots')
    .select('id, day_of_week, period_code, subject_name, room_name, teacher_id, material_url, material_name, color')
    .eq('timetable_id', timetableId);
  if (error) throw error;
  return data || [];
}

async function namesById(ids) {
  const map = new Map();
  if (!ids.length) return map;
  const { data } = await supabase.from('users').select('id, name').in('id', ids);
  for (const u of data || []) map.set(u.id, u.name);
  return map;
}

async function saveTemplate({ schoolId, grade, section, title, periodDefs, updatedBy }) {
  const { data, error } = await supabase
    .from('class_timetables')
    .upsert({
      school_id: schoolId, grade, section, title: title || null, period_defs: periodDefs,
      updated_by: updatedBy, updated_at: new Date().toISOString(),
    }, { onConflict: 'school_id,grade,section' })
    .select('id').single();
  if (error) throw error;
  return data.id;
}

async function upsertSlot(timetableId, day, periodCode, fields, updatedBy) {
  const { error } = await supabase.from('timetable_slots').upsert({
    timetable_id: timetableId, day_of_week: day, period_code: periodCode, ...fields,
    updated_by: updatedBy, updated_at: new Date().toISOString(),
  }, { onConflict: 'timetable_id,day_of_week,period_code' });
  if (error) throw error;
}

async function deleteSlot(timetableId, day, periodCode) {
  const { error } = await supabase.from('timetable_slots')
    .delete().eq('timetable_id', timetableId).eq('day_of_week', day).eq('period_code', periodCode);
  if (error) throw error;
}

module.exports = {
  childrenOf, schoolCurriculum, findTimetable, loadSlots, namesById, saveTemplate, upsertSlot, deleteSlot,
};

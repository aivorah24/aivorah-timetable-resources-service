// Data access for resource_folders / resource_files, always within one school.
const supabase = require('./supabase');

async function childrenScopes(parentEmail) {
  const { data } = await supabase
    .from('parent_children')
    .select('users!parent_children_child_id_fkey(grade, curriculum)')
    .eq('parent_email', parentEmail);
  return (data || []).map((r) => r.users).filter(Boolean);
}

async function listFolders(schoolId, parentId) {
  let q = supabase.from('resource_folders')
    .select('id, name, scope, created_by, updated_at').eq('school_id', schoolId).order('name');
  q = parentId ? q.eq('parent_folder_id', parentId) : q.is('parent_folder_id', null);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function listFiles(schoolId, folderId) {
  let q = supabase.from('resource_files')
    .select('id, title, file_url, file_type, file_size, scope, uploaded_by, updated_at').eq('school_id', schoolId).order('title');
  q = folderId ? q.eq('folder_id', folderId) : q.is('folder_id', null);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function getFolder(schoolId, id) {
  const { data } = await supabase
    .from('resource_folders').select('id, name, scope, parent_folder_id')
    .eq('id', id).eq('school_id', schoolId).maybeSingle();
  return data || null;
}

async function namesByEmail(emails) {
  const distinct = [...new Set(emails.filter(Boolean))];
  const map = new Map();
  if (!distinct.length) return map;
  const { data } = await supabase.from('users').select('email, name').in('email', distinct);
  for (const u of data || []) map.set(u.email, u.name);
  return map;
}

async function createFolder(row) {
  const { data, error } = await supabase.from('resource_folders').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

async function createFile(row) {
  const { data, error } = await supabase.from('resource_files').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

// Returns the number of rows removed (0 = not found in this school).
async function remove(table, schoolId, id) {
  const { data, error } = await supabase.from(table)
    .delete().eq('id', id).eq('school_id', schoolId).select('id');
  if (error) throw error;
  return (data || []).length;
}

module.exports = { childrenScopes, listFolders, listFiles, getFolder, namesByEmail, createFolder, createFile, remove };

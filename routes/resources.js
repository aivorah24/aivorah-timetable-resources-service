/**
 * School Policies & Resources — a folder/file library per school.
 * Teachers and school admins manage it; students and parents read items
 * scoped to the school, their (children's) grade or curriculum.
 */
const express = require('express');
const store = require('../services/resourcesStore');
const { isManager } = require('../services/classAccess');

const router = express.Router();
const ALLOWED_URL = /^https:\/\//i;

async function visibleScopes(user) {
  if (isManager(user)) return null;
  const scopes = new Set(['school']);
  const own = user.role === 'parent' ? await store.childrenScopes(user.email) : [user];
  for (const p of own) {
    if (p.grade) scopes.add(p.grade);
    if (p.curriculum) scopes.add(p.curriculum);
  }
  return scopes;
}

const inScope = (scope, allowed) => allowed === null || scope === 'school' || allowed.has(scope);

async function breadcrumb(schoolId, folderId) {
  const trail = [];
  let id = folderId;
  for (let i = 0; id && i < 20; i++) {
    const f = await store.getFolder(schoolId, id);
    if (!f) break;
    trail.unshift({ id: f.id, name: f.name });
    id = f.parent_folder_id;
  }
  return trail;
}

function requireManager(req, res, next) {
  if (!req.user.school_id) return res.status(403).json({ error: 'Your account is not linked to a school' });
  if (!isManager(req.user)) return res.status(403).json({ error: 'Only teachers and school admins can manage resources' });
  next();
}

// The folder must exist in the user's school (null = library root).
async function checkFolder(schoolId, folderId) {
  if (!folderId) return true;
  return !!(await store.getFolder(schoolId, folderId));
}

// GET /resources?folderId=
router.get('/', async (req, res) => {
  const user = req.user;
  if (!user.school_id) return res.json({ canManage: false, scopeLabel: null, breadcrumb: [], folders: [], files: [] });
  const schoolId = user.school_id;
  const folderId = req.query.folderId || null;
  try {
    const allowed = await visibleScopes(user);
    if (folderId) {
      const folder = await store.getFolder(schoolId, folderId);
      if (!folder || !inScope(folder.scope, allowed)) return res.status(404).json({ error: 'Folder not found' });
    }
    const [folders, files] = await Promise.all([store.listFolders(schoolId, folderId), store.listFiles(schoolId, folderId)]);
    const visFolders = folders.filter((f) => inScope(f.scope, allowed));
    const visFiles = files.filter((f) => inScope(f.scope, allowed));
    const names = await store.namesByEmail([...visFolders.map((f) => f.created_by), ...visFiles.map((f) => f.uploaded_by)]);

    res.json({
      canManage: isManager(user),
      scopeLabel: user.curriculum || null,
      breadcrumb: await breadcrumb(schoolId, folderId),
      folders: visFolders.map((f) => ({
        id: f.id, name: f.name, scope: f.scope, author: names.get(f.created_by) || f.created_by, updatedAt: f.updated_at,
      })),
      files: visFiles.map((f) => ({
        id: f.id, title: f.title, fileUrl: f.file_url, fileType: f.file_type, fileSize: f.file_size,
        scope: f.scope, author: names.get(f.uploaded_by) || f.uploaded_by, updatedAt: f.updated_at,
      })),
    });
  } catch (err) {
    console.error('[GET /resources]', err.message);
    res.status(500).json({ error: 'Failed to load resources' });
  }
});

// POST /resources/folder { name, parentFolderId?, scope? }
router.post('/folder', requireManager, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const parentId = req.body?.parentFolderId || null;
  try {
    if (!(await checkFolder(req.user.school_id, parentId))) return res.status(404).json({ error: 'Folder not found' });
    const id = await store.createFolder({
      school_id: req.user.school_id, parent_folder_id: parentId, name,
      scope: String(req.body?.scope || '').trim() || 'school', created_by: req.user.email,
    });
    res.status(201).json({ ok: true, id });
  } catch (err) {
    console.error('[POST /resources/folder]', err.message);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// POST /resources/file { folderId?, title, fileUrl, fileType?, fileSize?, scope? }
router.post('/file', requireManager, async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const fileUrl = String(req.body?.fileUrl || '').trim();
  if (!title || !fileUrl) return res.status(400).json({ error: 'title and fileUrl are required' });
  if (!ALLOWED_URL.test(fileUrl)) return res.status(400).json({ error: 'fileUrl must be https' });
  const folderId = req.body?.folderId || null;
  try {
    if (!(await checkFolder(req.user.school_id, folderId))) return res.status(404).json({ error: 'Folder not found' });
    const id = await store.createFile({
      school_id: req.user.school_id, folder_id: folderId, title, file_url: fileUrl,
      file_type: req.body?.fileType || null, file_size: Number(req.body?.fileSize) || 0,
      scope: String(req.body?.scope || '').trim() || 'school', uploaded_by: req.user.email,
    });
    res.status(201).json({ ok: true, id });
  } catch (err) {
    console.error('[POST /resources/file]', err.message);
    res.status(500).json({ error: 'Failed to add file' });
  }
});

// DELETE /resources/folder/:id — the folder's contents go with it (FK cascade).
router.delete('/folder/:id', requireManager, async (req, res) => {
  try {
    const n = await store.remove('resource_folders', req.user.school_id, req.params.id);
    if (!n) return res.status(404).json({ error: 'Folder not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /resources/folder]', err.message);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// DELETE /resources/file/:id
router.delete('/file/:id', requireManager, async (req, res) => {
  try {
    const n = await store.remove('resource_files', req.user.school_id, req.params.id);
    if (!n) return res.status(404).json({ error: 'File not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /resources/file]', err.message);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

module.exports = router;

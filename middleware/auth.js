// Every route needs a Firebase ID token; the user (role, school, class) is
// loaded from the users table by the token's email, never from the request.
const firebaseAdmin = require('../services/firebaseAdmin');
const supabase = require('../services/supabase');

async function requireUser(req, res, next) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!match) return res.status(401).json({ error: 'Sign in required' });
  if (!firebaseAdmin) return res.status(500).json({ error: 'Auth is not configured on this server' });

  let decoded;
  try {
    decoded = await firebaseAdmin.auth().verifyIdToken(match[1]);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired sign-in' });
  }
  if (!decoded.email) return res.status(401).json({ error: 'Sign-in has no email' });

  const { data: user, error } = await supabase
    .from('users')
    .select('id, role, school_id, email, name, grade, section, curriculum')
    .eq('email', decoded.email.toLowerCase())
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'Could not load your account' });
  if (!user) return res.status(403).json({ error: 'No Aivorah account for this sign-in' });

  req.user = user;
  next();
}

module.exports = { requireUser };

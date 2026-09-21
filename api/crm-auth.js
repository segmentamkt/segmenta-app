const crypto = require('crypto');
const { verifySession, setSession, clearSession, isPlatformAdmin } = require('./_crm-session');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejhfersvmjhxzatsobae.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const EXPECTED_EMAIL = 'host@segmenta.co';
const PASSWORD_SALT = 'segmenta-crm-2026';
const EXPECTED_PASSWORD_HASH = 'f8633368f2a74090275ac51a1da38a7efc477c916804ac394665689b0f4fcbff';

function safeEqualHex(a, b) {
  try {
    const aa = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
  } catch (_) {
    return false;
  }
}

function passwordHash(password) {
  return crypto.createHash('sha256').update(`${PASSWORD_SALT}:${password}`).digest('hex');
}

async function sb(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase service key not configured');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

async function getOrgBySlug(slug) {
  const rows = await sb(`crm_organizations?slug=eq.${encodeURIComponent(slug)}&status=eq.active&select=id,name,slug,status&limit=1`);
  return rows?.[0] || null;
}

async function getMemberships(userId) {
  return sb(`crm_memberships?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=role,is_default,organization:crm_organizations(id,name,slug,status)&order=is_default.desc,created_at.asc`);
}

async function organizationsForSession(session) {
  if (isPlatformAdmin(session)) {
    return sb('crm_organizations?status=eq.active&select=id,name,slug,status&order=name.asc');
  }
  if (!session?.sub) return [];
  const memberships = await getMemberships(session.sub);
  return (memberships || [])
    .filter(x => x.organization?.status === 'active')
    .map(x => ({ ...x.organization, role: x.role, is_default: x.is_default }));
}

async function signInSupabase(email, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  if (!response.ok || !data?.user?.id) return null;
  return data.user;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const session = verifySession(req);
      if (!session) return res.status(200).json({ ok: true, authenticated: false, organizations: [] });
      const organizations = await organizationsForSession(session);
      return res.status(200).json({
        ok: true,
        authenticated: true,
        email: session.email,
        role: session.role || 'viewer',
        platform_admin: isPlatformAdmin(session),
        organization: session.organization_id ? {
          id: session.organization_id,
          slug: session.organization_slug,
          name: session.organization_name
        } : null,
        organizations
      });
    }

    if (req.method === 'DELETE') {
      clearSession(res);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const session = verifySession(req);
      if (!session) return res.status(401).json({ ok: false, error: 'CRM session required' });
      const orgSlug = String(req.body?.org_slug || '').trim().toLowerCase();
      if (!orgSlug) return res.status(400).json({ ok: false, error: 'org_slug requerido' });

      let org = null;
      let role = session.role || 'viewer';
      if (isPlatformAdmin(session)) {
        org = await getOrgBySlug(orgSlug);
        role = 'admin';
      } else {
        const memberships = await getMemberships(session.sub);
        const match = (memberships || []).find(x => x.organization?.slug === orgSlug && x.organization?.status === 'active');
        if (match) {
          org = match.organization;
          role = match.role;
        }
      }
      if (!org) return res.status(403).json({ ok: false, error: 'No tienes acceso a esa empresa' });

      setSession(res, {
        sub: session.sub,
        email: session.email,
        platform_role: session.platform_role || null,
        role,
        organization_id: org.id,
        organization_slug: org.slug,
        organization_name: org.name
      });
      return res.status(200).json({ ok: true, organization: org, role });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({ ok: false, error: 'Server session key not configured' });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (email === EXPECTED_EMAIL && safeEqualHex(passwordHash(password), EXPECTED_PASSWORD_HASH)) {
      const org = await getOrgBySlug('segmenta');
      if (!org) return res.status(503).json({ ok: false, error: 'Organización Segmenta no configurada' });
      setSession(res, {
        sub: 'legacy-superadmin',
        email,
        platform_role: 'super_admin',
        role: 'admin',
        organization_id: org.id,
        organization_slug: org.slug,
        organization_name: org.name
      });
      return res.status(200).json({ ok: true, authenticated: true, platform_admin: true, organization: org });
    }

    const user = await signInSupabase(email, password);
    if (!user) return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });

    const memberships = await getMemberships(user.id);
    const available = (memberships || []).filter(x => x.organization?.status === 'active');
    if (!available.length) return res.status(403).json({ ok: false, error: 'Tu usuario no tiene una empresa activa asignada' });

    const selected = available.find(x => x.is_default) || available[0];
    const org = selected.organization;
    setSession(res, {
      sub: user.id,
      email: user.email || email,
      platform_role: null,
      role: selected.role,
      organization_id: org.id,
      organization_slug: org.slug,
      organization_name: org.name
    });

    return res.status(200).json({
      ok: true,
      authenticated: true,
      platform_admin: false,
      role: selected.role,
      organization: org
    });
  } catch (error) {
    console.error('CRM_AUTH_ERROR', error.message);
    return res.status(500).json({ ok: false, error: 'No fue posible iniciar sesión' });
  }
};

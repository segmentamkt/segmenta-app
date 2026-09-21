const { verifySession, isPlatformAdmin, canManageUsers } = require('./_crm-session');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejhfersvmjhxzatsobae.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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

async function authAdmin(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, {
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
  if (!response.ok) {
    const err = new Error(data?.msg || data?.message || data?.error_description || `Auth admin ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return data;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function canManageOrg(session, organizationId) {
  if (isPlatformAdmin(session)) return true;
  return canManageUsers(session) && session?.organization_id === organizationId;
}

const ALLOWED_ROLES = ['owner','admin','sales','inventory','editor','viewer','agent'];

async function audit(session, organizationId, action, entityType, entityId, beforeData = null, afterData = null, metadata = {}) {
  try {
    await sb('crm_audit_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        organization_id: organizationId || null,
        actor_user_id: session?.sub && session.sub !== 'legacy-superadmin' ? session.sub : null,
        actor_email: session?.email || null,
        action,
        entity_type: entityType,
        entity_id: entityId ? String(entityId) : null,
        before_data: beforeData,
        after_data: afterData,
        metadata
      })
    });
  } catch (e) {
    console.warn('CRM_ADMIN_AUDIT_ERROR', e.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const session = verifySession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'CRM session required' });

  try {
    if (req.method === 'GET') {
      if (!canManageUsers(session)) return res.status(403).json({ ok: false, error: 'No tienes permiso para administrar usuarios' });
      const orgFilter = isPlatformAdmin(session) ? '' : `&id=eq.${encodeURIComponent(session.organization_id || '')}`;
      const organizations = await sb(`crm_organizations?status=eq.active${orgFilter}&select=id,name,slug,status,created_at&order=name.asc`);
      const allowedIds = (organizations || []).map(x => x.id);
      let memberships = [];
      if (allowedIds.length) {
        memberships = await sb(`crm_memberships?organization_id=in.(${allowedIds.join(',')})&select=id,organization_id,user_id,email,display_name,role,status,is_default,permissions,created_at&order=created_at.asc`);
      }
      return res.status(200).json({ ok: true, organizations: organizations || [], memberships: memberships || [], platform_admin: isPlatformAdmin(session) });
    }

    if (req.method !== 'POST' && req.method !== 'PATCH') {
      res.setHeader('Allow', 'GET, POST, PATCH');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const action = String(req.body?.action || '').trim();

    if (req.method === 'POST' && action === 'create_org') {
      if (!isPlatformAdmin(session)) return res.status(403).json({ ok: false, error: 'Solo Segmenta puede crear empresas' });
      const name = String(req.body?.name || '').trim();
      const slug = slugify(req.body?.slug || name);
      if (!name || !slug) return res.status(400).json({ ok: false, error: 'Nombre de empresa requerido' });
      const rows = await sb('crm_organizations', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ name, slug, status: 'active' })
      });
      const organization = rows?.[0] || null;
      if (organization) await audit(session, organization.id, 'organization.created', 'organization', organization.id, null, organization);
      return res.status(201).json({ ok: true, organization });
    }

    if (req.method === 'POST' && action === 'create_user') {
      const organizationId = String(req.body?.organization_id || '').trim();
      if (!organizationId || !canManageOrg(session, organizationId)) return res.status(403).json({ ok: false, error: 'No autorizado para esa empresa' });

      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const displayName = String(req.body?.display_name || '').trim();
      const role = ALLOWED_ROLES.includes(req.body?.role) ? req.body.role : 'sales';
      if (role === 'owner' && !isPlatformAdmin(session)) return res.status(403).json({ ok: false, error: 'Solo el Host puede asignar el dueño de una empresa' });
      const permissions = req.body?.permissions && typeof req.body.permissions === 'object' ? req.body.permissions : {};
      if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Correo inválido' });
      if (password.length < 8) return res.status(400).json({ ok: false, error: 'La contraseña debe tener mínimo 8 caracteres' });

      let createdUser = null;
      try {
        createdUser = await authAdmin('users', {
          method: 'POST',
          body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: displayName || email.split('@')[0] }
          })
        });

        const rows = await sb('crm_memberships', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            organization_id: organizationId,
            user_id: createdUser.id,
            email,
            display_name: displayName || null,
            role,
            status: 'active',
            is_default: true,
            permissions
          })
        });
        const membership = rows?.[0] || null;
        if (membership) await audit(session, organizationId, 'user.created', 'membership', membership.id, null, membership, { user_id: createdUser.id });
        return res.status(201).json({ ok: true, membership });
      } catch (error) {
        if (createdUser?.id) {
          try { await authAdmin(`users/${createdUser.id}`, { method: 'DELETE' }); } catch (_) {}
        }
        throw error;
      }
    }

    if (req.method === 'PATCH' && action === 'update_membership') {
      if (!canManageUsers(session)) return res.status(403).json({ ok: false, error: 'No tienes permiso para administrar usuarios' });
      const membershipId = String(req.body?.membership_id || '').trim();
      if (!membershipId) return res.status(400).json({ ok: false, error: 'membership_id requerido' });
      const found = await sb(`crm_memberships?id=eq.${encodeURIComponent(membershipId)}&select=*&limit=1`);
      const membership = found?.[0];
      if (!membership || !canManageOrg(session, membership.organization_id)) return res.status(403).json({ ok: false, error: 'No autorizado' });
      const patch = { updated_at: new Date().toISOString() };
      if (ALLOWED_ROLES.includes(req.body?.role)) {
        if (req.body.role === 'owner' && !isPlatformAdmin(session)) return res.status(403).json({ ok: false, error: 'Solo el Host puede asignar el dueño de una empresa' });
        patch.role = req.body.role;
      }
      if (['active','disabled'].includes(req.body?.status)) patch.status = req.body.status;
      if (req.body?.permissions && typeof req.body.permissions === 'object') patch.permissions = req.body.permissions;
      const rows = await sb(`crm_memberships?id=eq.${encodeURIComponent(membershipId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch)
      });
      const updated = rows?.[0] || null;
      if (updated) await audit(session, membership.organization_id, 'user.permissions_updated', 'membership', membership.id, membership, updated);
      return res.status(200).json({ ok: true, membership: updated });
    }

    return res.status(400).json({ ok: false, error: 'Acción no válida' });
  } catch (error) {
    console.error('CRM_ADMIN_ERROR', error.message);
    const duplicate = /duplicate key|already been registered|already exists/i.test(error.message || '');
    return res.status(duplicate ? 409 : 500).json({ ok: false, error: duplicate ? 'La empresa o el usuario ya existe' : 'No fue posible completar la operación' });
  }
};

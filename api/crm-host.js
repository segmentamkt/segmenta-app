const { verifySession, setSession, isPlatformAdmin } = require('./_crm-session');

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

function countByOrg(rows = []) {
  return rows.reduce((acc, row) => {
    acc[row.organization_id] = (acc[row.organization_id] || 0) + 1;
    return acc;
  }, {});
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const session = verifySession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'Host session required' });
  if (!isPlatformAdmin(session)) return res.status(403).json({ ok: false, error: 'Solo el Host de Segmenta puede acceder a este panel' });

  try {
    if (req.method === 'GET') {
      const [organizations, memberships, channels, integrations, conversations, opportunities] = await Promise.all([
        sb('crm_organizations?status=eq.active&select=id,name,slug,status,crm_path,created_at&order=name.asc'),
        sb('crm_memberships?status=eq.active&select=id,organization_id,email,display_name,role,status,permissions'),
        sb('crm_channels?select=id,organization_id,channel_type,status'),
        sb('crm_integrations?select=id,organization_id,provider,status'),
        sb('crm_conversations?select=id,organization_id,status'),
        sb('crm_opportunities?select=id,organization_id,status')
      ]);

      const usersByOrg = countByOrg(memberships);
      const channelsByOrg = countByOrg(channels);
      const integrationsByOrg = countByOrg((integrations || []).filter(x => x.status === 'connected'));
      const conversationsByOrg = countByOrg((conversations || []).filter(x => x.status !== 'closed'));
      const opportunitiesByOrg = countByOrg((opportunities || []).filter(x => x.status === 'open'));

      const owners = {};
      for (const m of memberships || []) {
        if (m.role === 'owner') owners[m.organization_id] = {
          email: m.email,
          display_name: m.display_name
        };
      }

      return res.status(200).json({
        ok: true,
        organizations: (organizations || []).map(org => ({
          ...org,
          owner: owners[org.id] || null,
          stats: {
            users: usersByOrg[org.id] || 0,
            channels: channelsByOrg[org.id] || 0,
            integrations: integrationsByOrg[org.id] || 0,
            conversations: conversationsByOrg[org.id] || 0,
            opportunities: opportunitiesByOrg[org.id] || 0
          }
        }))
      });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '').trim();
      if (action !== 'enter_org') return res.status(400).json({ ok: false, error: 'Acción no válida' });

      const orgSlug = String(req.body?.org_slug || '').trim().toLowerCase();
      const rows = await sb(`crm_organizations?slug=eq.${encodeURIComponent(orgSlug)}&status=eq.active&select=id,name,slug,crm_path&limit=1`);
      const org = rows?.[0];
      if (!org) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });

      setSession(res, {
        sub: session.sub,
        email: session.email,
        platform_role: 'super_admin',
        role: 'owner',
        permissions: {},
        organization_id: org.id,
        organization_slug: org.slug,
        organization_name: org.name
      });

      await sb('crm_host_activity', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          organization_id: org.id,
          host_email: session.email,
          action: 'enter_crm',
          metadata: { organization_slug: org.slug }
        })
      });

      return res.status(200).json({
        ok: true,
        organization: org,
        crm_url: `/crm?workspace=${encodeURIComponent(org.slug)}&host=1`
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('CRM_HOST_ERROR', error.message);
    return res.status(500).json({ ok: false, error: 'No fue posible cargar el panel Host' });
  }
};
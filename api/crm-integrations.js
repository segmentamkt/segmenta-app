const crypto = require('crypto');
const { verifySession, canManageIntegrations } = require('./_crm-session');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejhfersvmjhxzatsobae.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const META_APP_ID = process.env.META_APP_ID || '1069309302411448';
const META_LOGIN_CONFIG_ID = process.env.META_LOGIN_CONFIG_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_GRAPH_VERSION = 'v26.0';
const APP_ORIGIN = process.env.CRM_PUBLIC_ORIGIN || 'https://www.segmenta.online';

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

async function orgForSession(session) {
  if (!session?.organization_id) return null;
  const rows = await sb(`crm_organizations?id=eq.${encodeURIComponent(session.organization_id)}&status=eq.active&select=id,name,slug&limit=1`);
  return rows?.[0] || null;
}

function signState(data) {
  const raw = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto.createHmac('sha256', SUPABASE_SERVICE_ROLE_KEY).update(raw).digest('hex');
  return `${raw}.${sig}`;
}

async function audit(session, orgId, action, entityType, entityId, afterData = null, metadata = {}) {
  try {
    await sb('crm_audit_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        organization_id: orgId,
        actor_user_id: session?.sub && session.sub !== 'legacy-superadmin' ? session.sub : null,
        actor_email: session?.email || null,
        action,
        entity_type: entityType,
        entity_id: entityId ? String(entityId) : null,
        after_data: afterData,
        metadata
      })
    });
  } catch (_) {}
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const session = verifySession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'CRM session required' });

  try {
    const org = await orgForSession(session);
    if (!org) return res.status(403).json({ ok: false, error: 'No active organization in session' });
    if (!canManageIntegrations(session)) return res.status(403).json({ ok: false, error: 'Solo el dueño de la empresa o el Host pueden gestionar integraciones' });

    if (req.method === 'GET') {
      const [integrations, channels] = await Promise.all([
        sb(`crm_integrations?organization_id=eq.${org.id}&select=id,provider,integration_type,display_name,external_account_id,status,metadata,connected_at,last_sync_at,last_error,created_at,updated_at&order=provider.asc,created_at.desc`),
        sb(`crm_channels?organization_id=eq.${org.id}&select=id,channel_type,external_account_id,external_account_name,status,integration_id,metadata,updated_at&order=channel_type.asc`)
      ]);
      return res.status(200).json({
        ok: true,
        organization: org,
        integrations: integrations || [],
        channels: channels || [],
        capabilities: {
          meta_business_login: {
            app_id: META_APP_ID,
            config_id_configured: Boolean(META_LOGIN_CONFIG_ID),
            app_secret_configured: Boolean(META_APP_SECRET),
            ready: Boolean(META_APP_ID && META_LOGIN_CONFIG_ID && META_APP_SECRET)
          }
        }
      });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '').trim();

      if (action === 'begin_meta_business') {
        if (!META_LOGIN_CONFIG_ID || !META_APP_SECRET) {
          return res.status(409).json({
            ok: false,
            code: 'META_LOGIN_NOT_READY',
            error: 'Falta configurar Facebook Login for Business en la app de Meta.'
          });
        }

        const pendingRows = await sb('crm_integrations?on_conflict=organization_id,provider,integration_type,external_account_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify({
            organization_id: org.id,
            provider: 'meta',
            integration_type: 'business_portfolio',
            display_name: 'Meta Business Portfolio',
            external_account_id: `pending-${org.id}`,
            status: 'pending',
            metadata: {
              phase: 'awaiting_oauth',
              requested_by: session.email,
              requested_at: new Date().toISOString()
            },
            connected_by: session.sub !== 'legacy-superadmin' ? session.sub : null,
            updated_at: new Date().toISOString()
          })
        });
        const integration = pendingRows?.[0] || null;
        const state = signState({
          integration_id: integration?.id,
          organization_id: org.id,
          organization_slug: org.slug,
          exp: Date.now() + 10 * 60 * 1000
        });
        const redirectUri = `${APP_ORIGIN}/api/meta-business-callback`;
        const url = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
        url.searchParams.set('client_id', META_APP_ID);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('config_id', META_LOGIN_CONFIG_ID);
        url.searchParams.set('state', state);
        await audit(session, org.id, 'integration.meta_oauth_started', 'integration', integration?.id, integration);
        return res.status(200).json({ ok: true, authorization_url: url.toString(), integration });
      }

      if (action === 'disconnect') {
        const id = String(req.body?.integration_id || '');
        const rows = await sb(`crm_integrations?id=eq.${encodeURIComponent(id)}&organization_id=eq.${org.id}&select=*&limit=1`);
        const integration = rows?.[0];
        if (!integration) return res.status(404).json({ ok: false, error: 'Integración no encontrada' });

        try {
          await sb('rpc/crm_delete_integration_secret', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ p_integration_id: integration.id })
          });
        } catch (_) {}

        await sb(`crm_integrations?id=eq.${integration.id}&organization_id=eq.${org.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            status: 'disconnected',
            last_error: null,
            metadata: { ...(integration.metadata || {}), disconnected_at: new Date().toISOString() },
            updated_at: new Date().toISOString()
          })
        });
        await audit(session, org.id, 'integration.disconnected', 'integration', integration.id, null, { provider: integration.provider });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ ok: false, error: 'Acción no válida' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('CRM_INTEGRATIONS_ERROR', error.message);
    return res.status(500).json({ ok: false, error: 'No fue posible gestionar la integración' });
  }
};

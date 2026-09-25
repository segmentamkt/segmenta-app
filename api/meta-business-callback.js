const crypto = require('crypto');
const { encryptCredential } = require('./_crm-crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejhfersvmjhxzatsobae.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const META_APP_ID = process.env.META_APP_ID || '1069309302411448';
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

function verifyState(state) {
  if (!state || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Invalid OAuth state');
  const [raw, signature] = String(state).split('.');
  if (!raw || !signature) throw new Error('Invalid OAuth state');
  const expected = crypto.createHmac('sha256', SUPABASE_SERVICE_ROLE_KEY).update(raw).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Invalid OAuth state');
  const payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!payload?.integration_id || !payload?.organization_id || Number(payload.exp || 0) <= Date.now()) {
    throw new Error('OAuth state expired');
  }
  return payload;
}

async function patchIntegration(id, orgId, values) {
  return sb(`crm_integrations?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(orgId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
}

function crmRedirect(res, slug, params = {}) {
  const url = new URL('/crm', APP_ORIGIN);
  if (slug) url.searchParams.set('workspace', slug);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  res.statusCode = 302;
  res.setHeader('Location', url.toString());
  return res.end();
}

async function graphGet(path, accessToken) {
  const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Meta Graph ${response.status}`);
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }

  let stateData = null;

  try {
    stateData = verifyState(req.query?.state);

    const rows = await sb(
      `crm_integrations?id=eq.${encodeURIComponent(stateData.integration_id)}&organization_id=eq.${encodeURIComponent(stateData.organization_id)}&select=id,organization_id,status,external_account_id,metadata&limit=1`
    );
    const integration = rows?.[0];
    if (!integration) throw new Error('Integration not found');

    if (req.query?.error) {
      const message = String(req.query.error_description || req.query.error || 'Meta authorization cancelled');
      await patchIntegration(integration.id, integration.organization_id, {
        status: 'pending',
        last_error: message,
        metadata: { ...(integration.metadata || {}), phase: 'oauth_cancelled', oauth_error: message }
      });
      return crmRedirect(res, stateData.organization_slug, { meta: 'cancelled' });
    }

    const code = String(req.query?.code || '');
    if (!code) throw new Error('Missing authorization code');
    if (!META_APP_ID || !META_APP_SECRET) throw new Error('Meta app credentials not configured');

    const redirectUri = `${APP_ORIGIN}/api/meta-business-callback`;
    const tokenUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', META_APP_ID);
    tokenUrl.searchParams.set('client_secret', META_APP_SECRET);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenResponse = await fetch(tokenUrl.toString(), { headers: { Accept: 'application/json' } });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData?.access_token) {
      throw new Error(tokenData?.error?.message || `Meta token exchange failed (${tokenResponse.status})`);
    }

    const accessToken = tokenData.access_token;

    let identity = null;
    let businesses = [];
    try {
      identity = await graphGet('/me?fields=id,name', accessToken);
    } catch (_) {}
    try {
      const businessData = await graphGet('/me/businesses?fields=id,name&limit=50', accessToken);
      businesses = Array.isArray(businessData?.data) ? businessData.data : [];
    } catch (_) {}

    const business = businesses[0] || null;
    const externalId = business?.id || identity?.id || integration.external_account_id;
    const displayName = business?.name || identity?.name || 'Meta Business Portfolio';

    const encryptedCredential = encryptCredential(accessToken);
    const now = new Date().toISOString();

    const existingRows = await sb(
      `crm_integrations?organization_id=eq.${encodeURIComponent(integration.organization_id)}&provider=eq.meta&integration_type=eq.business_portfolio&external_account_id=eq.${encodeURIComponent(externalId)}&id=neq.${encodeURIComponent(integration.id)}&select=id,metadata&limit=1`
    );
    const existing = existingRows?.[0] || null;
    const targetId = existing?.id || integration.id;
    const baseMetadata = existing?.metadata || integration.metadata || {};

    await patchIntegration(targetId, integration.organization_id, {
      credential_encrypted: encryptedCredential,
      status: 'connected',
      display_name: displayName,
      external_account_id: externalId,
      connected_at: now,
      last_error: null,
      metadata: {
        ...baseMetadata,
        phase: 'connected',
        token_type: tokenData.token_type || null,
        expires_in: tokenData.expires_in || null,
        meta_identity: identity,
        businesses,
        connected_at: now
      }
    });

    if (existing) {
      await patchIntegration(integration.id, integration.organization_id, {
        status: 'disconnected',
        last_error: null,
        metadata: {
          ...(integration.metadata || {}),
          phase: 'superseded',
          superseded_by: existing.id,
          superseded_at: now
        }
      });
    }

    return crmRedirect(res, stateData.organization_slug, { meta: 'connected' });
  } catch (error) {
    console.error('META_BUSINESS_CALLBACK_ERROR', error.message);

    if (stateData?.integration_id && stateData?.organization_id) {
      try {
        const rows = await sb(
          `crm_integrations?id=eq.${encodeURIComponent(stateData.integration_id)}&organization_id=eq.${encodeURIComponent(stateData.organization_id)}&select=id,metadata&limit=1`
        );
        const integration = rows?.[0];
        if (integration) {
          await patchIntegration(integration.id, stateData.organization_id, {
            status: 'pending',
            last_error: error.message,
            metadata: { ...(integration.metadata || {}), phase: 'oauth_error' }
          });
        }
      } catch (_) {}
    }

    return crmRedirect(res, stateData?.organization_slug, { meta: 'error' });
  }
};

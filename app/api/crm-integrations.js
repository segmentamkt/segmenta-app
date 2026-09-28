const crypto = require('crypto');
const { verifySession, canManageIntegrations } = require('./_crm-session');
const { encryptCredential, decryptCredential } = require('./_crm-crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejhfersvmjhxzatsobae.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const META_APP_ID = process.env.META_APP_ID || '1069309302411448';
const META_LOGIN_CONFIG_ID = process.env.META_LOGIN_CONFIG_ID || '';
const META_WHATSAPP_CONFIG_ID = process.env.META_WHATSAPP_CONFIG_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_GRAPH_VERSION = 'v26.0';
const APP_ORIGIN = process.env.CRM_PUBLIC_ORIGIN || 'https://app.segmenta.online';

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

async function graphRequest(path, accessToken, options = {}) {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${String(path).replace(/^\//,'')}`);
  const response = await fetch(url.toString(), {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Meta Graph ${response.status}`);
  return data;
}

async function safeGraph(path, accessToken) {
  try { return await graphRequest(path, accessToken); }
  catch (_) { return null; }
}

const AI_PROVIDERS = {
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/models',
    headers: key => ({ Authorization: `Bearer ${key}`, Accept: 'application/json' })
  },
  anthropic: {
    label: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/models?limit=1',
    headers: key => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', Accept: 'application/json' })
  },
  gemini: {
    label: 'Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    headers: key => ({ 'x-goog-api-key': key, Accept: 'application/json' })
  }
};

function cleanProvider(value) {
  const p = String(value || '').trim().toLowerCase();
  return AI_PROVIDERS[p] ? p : null;
}

function maskKey(key) {
  const value = String(key || '').trim();
  if (!value) return null;
  const suffix = value.slice(-4);
  return `••••••••${suffix}`;
}

async function validateAiCredential(provider, key) {
  const cfg = AI_PROVIDERS[provider];
  if (!cfg) throw new Error('Proveedor IA no soportado');
  const value = String(key || '').trim();
  if (value.length < 10) throw new Error('La llave parece incompleta');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(cfg.endpoint, {
      method: 'GET',
      headers: cfg.headers(value),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerMessage =
        data?.error?.message ||
        data?.error?.details?.[0]?.reason ||
        data?.message ||
        `${cfg.label} respondió ${response.status}`;
      const err = new Error(String(providerMessage).slice(0, 300));
      err.status = response.status;
      throw err;
    }

    const models = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : [];

    return {
      ok: true,
      provider,
      provider_label: cfg.label,
      model_count_sampled: models.length,
      sample_models: models.slice(0, 5).map(x => x?.id || x?.name).filter(Boolean),
      validated_at: new Date().toISOString()
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${cfg.label} no respondió a tiempo`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverWhatsAppAssets(accessToken) {
  const businessesResp = await safeGraph('me/businesses?fields=id,name&limit=50', accessToken);
  const businesses = Array.isArray(businessesResp?.data) ? businessesResp.data : [];
  const candidates = [];
  const seenPhones = new Set();

  for (const business of businesses) {
    if (!business?.id) continue;
    for (const edge of ['owned_whatsapp_business_accounts','client_whatsapp_business_accounts']) {
      const wabasResp = await safeGraph(`${business.id}/${edge}?fields=id,name&limit=100`, accessToken);
      for (const waba of (wabasResp?.data || [])) {
        if (!waba?.id) continue;
        const phonesResp = await safeGraph(`${waba.id}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,status&limit=100`, accessToken);
        for (const phone of (phonesResp?.data || [])) {
          if (!phone?.id || seenPhones.has(String(phone.id))) continue;
          seenPhones.add(String(phone.id));
          candidates.push({
            business_id:String(business.id),
            business_name:business.name || null,
            waba_id:String(waba.id),
            waba_name:waba.name || null,
            phone_number_id:String(phone.id),
            display_phone_number:phone.display_phone_number || null,
            verified_name:phone.verified_name || null,
            quality_rating:phone.quality_rating || null,
            status:phone.status || null
          });
        }
      }
    }
  }
  return candidates;
}

async function debugToken(accessToken) {
  try {
    const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/debug_token`);
    url.searchParams.set('input_token', accessToken);
    const appToken = `${META_APP_ID}|${META_APP_SECRET}`;
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${appToken}`, Accept: 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    return response.ok ? data?.data || null : null;
  } catch (_) { return null; }
}

async function subscribeAsset(assetId, accessToken, fields) {
  try {
    const body = new URLSearchParams();
    body.set('subscribed_fields', fields);
    const data = await graphRequest(`${assetId}/subscribed_apps`, accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    return { ok: data?.success !== false, data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function discoverMetaAssets(accessToken) {
  const pages = new Map();
  const instagram = new Map();

  const accounts = await safeGraph('me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}&limit=100', accessToken);
  for (const page of (accounts?.data || [])) {
    if (!page?.id) continue;
    pages.set(String(page.id), {
      id: String(page.id),
      name: page.name || 'Facebook Page',
      page_access_token: page.access_token || null
    });
    if (page.instagram_business_account?.id) {
      const ig = page.instagram_business_account;
      instagram.set(String(ig.id), {
        id: String(ig.id),
        name: ig.username || ig.name || 'Instagram',
        parent_page_id: String(page.id),
        page_access_token: page.access_token || null
      });
    }
  }

  const assigned = await safeGraph('me/assigned_pages?fields=id,name,access_token,instagram_business_account{id,username,name}&limit=100', accessToken);
  for (const page of (assigned?.data || [])) {
    if (!page?.id) continue;
    const existing = pages.get(String(page.id)) || {};
    pages.set(String(page.id), {
      ...existing,
      id: String(page.id),
      name: page.name || existing.name || 'Facebook Page',
      page_access_token: page.access_token || existing.page_access_token || null
    });
    if (page.instagram_business_account?.id) {
      const ig = page.instagram_business_account;
      instagram.set(String(ig.id), {
        id: String(ig.id),
        name: ig.username || ig.name || 'Instagram',
        parent_page_id: String(page.id),
        page_access_token: page.access_token || existing.page_access_token || null
      });
    }
  }

  const debug = await debugToken(accessToken);
  const granular = Array.isArray(debug?.granular_scopes) ? debug.granular_scopes : [];
  const pageTargets = new Set();
  const igTargets = new Set();

  for (const scope of granular) {
    const name = String(scope?.scope || '');
    for (const id of (scope?.target_ids || [])) {
      if (name.startsWith('pages_') || ['pages_show_list','pages_messaging'].includes(name)) pageTargets.add(String(id));
      if (name.startsWith('instagram_')) igTargets.add(String(id));
    }
  }

  for (const id of pageTargets) {
    if (pages.has(id)) continue;
    const data = await safeGraph(`${id}?fields=id,name,access_token,instagram_business_account{id,username,name}`, accessToken);
    if (!data?.id) continue;
    pages.set(id, {
      id,
      name: data.name || 'Facebook Page',
      page_access_token: data.access_token || null
    });
    if (data.instagram_business_account?.id) {
      const ig = data.instagram_business_account;
      instagram.set(String(ig.id), {
        id: String(ig.id),
        name: ig.username || ig.name || 'Instagram',
        parent_page_id: id,
        page_access_token: data.access_token || null
      });
    }
  }

  for (const id of igTargets) {
    if (instagram.has(id)) continue;
    const data = await safeGraph(`${id}?fields=id,username,name`, accessToken);
    if (!data?.id) continue;
    instagram.set(id, {
      id,
      name: data.username || data.name || 'Instagram',
      parent_page_id: null,
      page_access_token: null
    });
  }

  return {
    pages: [...pages.values()],
    instagram: [...instagram.values()],
    debug: debug ? {
      user_id: debug.user_id || null,
      type: debug.type || null,
      scopes: debug.scopes || [],
      granular_scopes: granular.map(x => ({ scope: x.scope, target_ids: x.target_ids || [] }))
    } : null
  };
}

async function upsertChannel(orgId, integrationId, channelType, asset, subscription) {
  const rows = await sb('crm_channels?on_conflict=organization_id,channel_type,external_account_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      organization_id: orgId,
      channel_type: channelType,
      external_account_id: asset.id,
      external_account_name: asset.name,
      status: subscription?.ok ? 'connected' : 'pending',
      integration_id: integrationId,
      metadata: {
        source: 'meta_business_login',
        messages: Boolean(subscription?.ok),
        auto_provisioned: true,
        parent_page_id: asset.parent_page_id || null,
        subscription_ok: Boolean(subscription?.ok),
        subscription_error: subscription?.error || null,
        synced_at: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    })
  });
  return rows?.[0] || null;
}

async function syncMetaAssets(org, integration, accessToken) {
  const assets = await discoverMetaAssets(accessToken);
  const channels = [];
  const subscriptions = [];

  for (const page of assets.pages) {
    let sub = await subscribeAsset(page.id, page.page_access_token || accessToken, 'messages,messaging_postbacks,message_deliveries,message_reads');
    if (!sub.ok && page.page_access_token) sub = await subscribeAsset(page.id, accessToken, 'messages,messaging_postbacks,message_deliveries,message_reads');
    subscriptions.push({ type: 'facebook_messenger', id: page.id, ok: sub.ok, error: sub.error || null });
    channels.push(await upsertChannel(org.id, integration.id, 'facebook_messenger', page, sub));
  }

  for (const ig of assets.instagram) {
    let sub = await subscribeAsset(ig.id, ig.page_access_token || accessToken, 'messages');
    if (!sub.ok && ig.page_access_token) sub = await subscribeAsset(ig.id, accessToken, 'messages');
    subscriptions.push({ type: 'instagram', id: ig.id, ok: sub.ok, error: sub.error || null });
    channels.push(await upsertChannel(org.id, integration.id, 'instagram', ig, sub));
  }

  await sb(`crm_integrations?id=eq.${integration.id}&organization_id=eq.${org.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      last_sync_at: new Date().toISOString(),
      last_error: null,
      metadata: {
        ...(integration.metadata || {}),
        assets_synced_at: new Date().toISOString(),
        discovered_pages: assets.pages.map(x => ({ id: x.id, name: x.name })),
        discovered_instagram: assets.instagram.map(x => ({ id: x.id, name: x.name, parent_page_id: x.parent_page_id || null })),
        subscriptions
      },
      updated_at: new Date().toISOString()
    })
  });

  return {
    pages: assets.pages.map(x => ({ id: x.id, name: x.name })),
    instagram: assets.instagram.map(x => ({ id: x.id, name: x.name, parent_page_id: x.parent_page_id || null })),
    channels: channels.filter(Boolean),
    subscriptions,
    debug: assets.debug
  };
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
      const [integrations, channels, webhookReceipts] = await Promise.all([
        sb(`crm_integrations?organization_id=eq.${org.id}&select=id,provider,integration_type,display_name,external_account_id,status,metadata,connected_at,last_sync_at,last_error,created_at,updated_at&order=provider.asc,created_at.desc`),
        sb(`crm_channels?organization_id=eq.${org.id}&select=id,channel_type,external_account_id,external_account_name,status,integration_id,metadata,updated_at&order=channel_type.asc`),
        sb('meta_webhook_receipts?object_type=eq.page&select=received_at,result,signature_valid,event_count&order=received_at.desc&limit=1')
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
          },
          whatsapp_embedded_signup: {
            app_id: META_APP_ID,
            config_id: META_WHATSAPP_CONFIG_ID || null,
            ready: Boolean(META_APP_ID && META_WHATSAPP_CONFIG_ID && META_APP_SECRET)
          },
          meta_webhook: {
            delivery_detected: Boolean(webhookReceipts?.[0]?.received_at),
            last_delivery_at: webhookReceipts?.[0]?.received_at || null,
            last_result: webhookReceipts?.[0]?.result || null,
            signature_valid: webhookReceipts?.[0]?.signature_valid ?? null,
            event_count: webhookReceipts?.[0]?.event_count || 0
          }
        }
      });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '').trim();

      if (action === 'test_ai_key') {
        const provider = cleanProvider(req.body?.provider);
        if (!provider) return res.status(400).json({ ok:false, error:'Proveedor IA no soportado' });
        const apiKey = String(req.body?.api_key || '').trim();
        if (!apiKey) return res.status(400).json({ ok:false, error:'Escribe una API key' });

        try {
          const validation = await validateAiCredential(provider, apiKey);
          return res.status(200).json({ ok:true, validation });
        } catch (error) {
          return res.status(400).json({
            ok:false,
            code:'AI_KEY_INVALID',
            error:`No fue posible validar ${AI_PROVIDERS[provider].label}: ${String(error.message || 'credencial rechazada').slice(0, 300)}`
          });
        }
      }

      if (action === 'save_ai_key') {
        const provider = cleanProvider(req.body?.provider);
        if (!provider) return res.status(400).json({ ok:false, error:'Proveedor IA no soportado' });
        const apiKey = String(req.body?.api_key || '').trim();
        if (!apiKey) return res.status(400).json({ ok:false, error:'Escribe una API key' });

        let validation;
        try {
          validation = await validateAiCredential(provider, apiKey);
        } catch (error) {
          return res.status(400).json({
            ok:false,
            code:'AI_KEY_INVALID',
            error:`No fue posible validar ${AI_PROVIDERS[provider].label}: ${String(error.message || 'credencial rechazada').slice(0, 300)}`
          });
        }

        const now = new Date().toISOString();
        const encrypted = encryptCredential(apiKey);
        const rows = await sb('crm_integrations?on_conflict=organization_id,provider,integration_type,external_account_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify({
            organization_id: org.id,
            provider,
            integration_type: 'api_key',
            display_name: AI_PROVIDERS[provider].label,
            external_account_id: 'default',
            status: 'connected',
            credential_encrypted: encrypted,
            connected_by: session.sub !== 'legacy-superadmin' ? session.sub : null,
            connected_at: now,
            last_sync_at: now,
            last_error: null,
            metadata: {
              auth_type: 'api_key',
              key_masked: maskKey(apiKey),
              key_last4: apiKey.slice(-4),
              validated_at: validation.validated_at,
              sample_models: validation.sample_models,
              validation_source: 'provider_models_endpoint'
            },
            updated_at: now
          })
        });
        const integration = rows?.[0] || null;
        await audit(session, org.id, 'integration.ai_key_connected', 'integration', integration?.id, {
          id: integration?.id,
          provider,
          status: 'connected',
          metadata: integration?.metadata || {}
        }, { provider });

        return res.status(200).json({
          ok:true,
          integration: integration ? {
            id: integration.id,
            provider: integration.provider,
            integration_type: integration.integration_type,
            display_name: integration.display_name,
            status: integration.status,
            metadata: integration.metadata,
            connected_at: integration.connected_at,
            last_sync_at: integration.last_sync_at,
            last_error: integration.last_error
          } : null,
          validation
        });
      }

      if (action === 'test_saved_ai_key') {
        const provider = cleanProvider(req.body?.provider);
        if (!provider) return res.status(400).json({ ok:false, error:'Proveedor IA no soportado' });
        const rows = await sb(`crm_integrations?organization_id=eq.${org.id}&provider=eq.${encodeURIComponent(provider)}&integration_type=eq.api_key&external_account_id=eq.default&status=eq.connected&select=id,credential_encrypted,metadata&limit=1`);
        const integration = rows?.[0];
        if (!integration?.credential_encrypted) return res.status(404).json({ ok:false, error:'No hay una llave guardada para este proveedor' });

        try {
          const key = decryptCredential(integration.credential_encrypted);
          const validation = await validateAiCredential(provider, key);
          await sb(`crm_integrations?id=eq.${integration.id}&organization_id=eq.${org.id}`, {
            method:'PATCH',
            headers:{ Prefer:'return=minimal' },
            body:JSON.stringify({
              last_sync_at: validation.validated_at,
              last_error: null,
              metadata: {
                ...(integration.metadata || {}),
                validated_at: validation.validated_at,
                sample_models: validation.sample_models
              },
              updated_at: validation.validated_at
            })
          });
          return res.status(200).json({ ok:true, validation });
        } catch (error) {
          await sb(`crm_integrations?id=eq.${integration.id}&organization_id=eq.${org.id}`, {
            method:'PATCH',
            headers:{ Prefer:'return=minimal' },
            body:JSON.stringify({
              last_error: String(error.message || 'Validación fallida').slice(0, 300),
              updated_at: new Date().toISOString()
            })
          });
          return res.status(400).json({ ok:false, error:String(error.message || 'Validación fallida').slice(0, 300) });
        }
      }

      if (action === 'complete_whatsapp_embedded_signup') {
        await audit(session, org.id, 'integration.whatsapp_signup_started', 'integration', null, null, {
          has_code:Boolean(req.body?.code),
          has_waba:Boolean(req.body?.waba_id || req.body?.waba_ids?.[0]),
          has_phone:Boolean(req.body?.phone_number_id),
          has_business:Boolean(req.body?.business_id)
        });
        if (!META_APP_ID || !META_APP_SECRET || !META_WHATSAPP_CONFIG_ID) {
          return res.status(409).json({ ok:false, code:'WHATSAPP_SIGNUP_NOT_READY', error:'Falta configurar WhatsApp Embedded Signup en Meta.' });
        }
        const code = String(req.body?.code || '').trim();
        let wabaId = String(req.body?.waba_id || req.body?.waba_ids?.[0] || '').trim();
        let phoneNumberId = String(req.body?.phone_number_id || '').trim();
        let businessId = String(req.body?.business_id || '').trim() || null;
        if (!code) {
          return res.status(400).json({ ok:false, error:'Meta no devolvió el código de autorización.' });
        }

        const tokenUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
        tokenUrl.searchParams.set('client_id', META_APP_ID);
        tokenUrl.searchParams.set('client_secret', META_APP_SECRET);
        tokenUrl.searchParams.set('code', code);
        tokenUrl.searchParams.set('redirect_uri', '');
        const tokenResponse = await fetch(tokenUrl.toString(), { headers:{ Accept:'application/json' } });
        const tokenData = await tokenResponse.json().catch(()=>({}));
        if (!tokenResponse.ok || !tokenData?.access_token) {
          return res.status(400).json({ ok:false, error:tokenData?.error?.message || 'Meta no permitió completar WhatsApp Embedded Signup.' });
        }
        const accessToken = tokenData.access_token;

        let discoveredCandidates = [];
        if (!wabaId || !phoneNumberId) {
          discoveredCandidates = await discoverWhatsAppAssets(accessToken);
          if (wabaId && !phoneNumberId) {
            const sameWaba = discoveredCandidates.filter(x => x.waba_id === wabaId);
            if (sameWaba.length === 1) {
              phoneNumberId = sameWaba[0].phone_number_id;
              businessId = businessId || sameWaba[0].business_id;
            }
          }
          if ((!wabaId || !phoneNumberId) && discoveredCandidates.length === 1) {
            wabaId = discoveredCandidates[0].waba_id;
            phoneNumberId = discoveredCandidates[0].phone_number_id;
            businessId = businessId || discoveredCandidates[0].business_id;
          }
          if (!wabaId || !phoneNumberId) {
            await audit(session, org.id, 'integration.whatsapp_signup_incomplete', 'integration', null, null, {
              candidates: discoveredCandidates.map(x => ({
                business_id:x.business_id,waba_id:x.waba_id,phone_number_id:x.phone_number_id,
                display_phone_number:x.display_phone_number,verified_name:x.verified_name
              }))
            });
            return res.status(409).json({
              ok:false,
              code:discoveredCandidates.length ? 'WHATSAPP_ASSET_AMBIGUOUS' : 'WHATSAPP_ASSETS_NOT_FOUND',
              error:discoveredCandidates.length
                ? 'Meta autorizó WhatsApp, pero devolvió más de un número y no indicó cuál seleccionaste.'
                : 'Meta autorizó el acceso, pero el token no permite descubrir ningún número de WhatsApp Business.',
              candidates:discoveredCandidates
            });
          }
        }

        let phone = null;
        try {
          phone = await graphRequest(`${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,status`, accessToken);
        } catch (_) {}

        let subscribed = false, subscriptionError = null;
        try {
          const sub = await graphRequest(`${wabaId}/subscribed_apps`, accessToken, { method:'POST' });
          subscribed = sub?.success !== false;
        } catch (error) {
          subscriptionError = String(error.message || error).slice(0,500);
        }

        const now = new Date().toISOString();
        const integrations = await sb('crm_integrations?on_conflict=organization_id,provider,integration_type,external_account_id', {
          method:'POST',
          headers:{ Prefer:'resolution=merge-duplicates,return=representation' },
          body:JSON.stringify({
            organization_id:org.id,
            provider:'meta',
            integration_type:'whatsapp_cloud',
            display_name:phone?.verified_name || phone?.display_phone_number || 'WhatsApp Business',
            external_account_id:wabaId,
            status:'connected',
            credential_encrypted:encryptCredential(accessToken),
            connected_by:session.sub !== 'legacy-superadmin' ? session.sub : null,
            connected_at:now,
            last_sync_at:now,
            last_error:subscriptionError,
            metadata:{
              source:'whatsapp_embedded_signup',
              business_id:businessId,
              waba_id:wabaId,
              phone_number_id:phoneNumberId,
              display_phone_number:phone?.display_phone_number || null,
              verified_name:phone?.verified_name || null,
              phone_status:phone?.status || null,
              quality_rating:phone?.quality_rating || null,
              webhook_subscribed:subscribed,
              token_type:tokenData.token_type || null
            },
            updated_at:now
          })
        });
        const integration = integrations?.[0] || null;

        const channels = await sb('crm_channels?on_conflict=organization_id,channel_type,external_account_id', {
          method:'POST',
          headers:{ Prefer:'resolution=merge-duplicates,return=representation' },
          body:JSON.stringify({
            organization_id:org.id,
            channel_type:'whatsapp',
            external_account_id:phoneNumberId,
            external_account_name:phone?.display_phone_number || phone?.verified_name || 'WhatsApp',
            status:'connected',
            integration_id:integration?.id || null,
            metadata:{
              source:'whatsapp_embedded_signup',
              messages:true,
              routing_active:true,
              waba_id:wabaId,
              business_id:businessId,
              display_phone_number:phone?.display_phone_number || null,
              verified_name:phone?.verified_name || null,
              subscription_ok:subscribed,
              subscription_error:subscriptionError,
              connected_at:now
            },
            updated_at:now
          })
        });
        const channel = channels?.[0] || null;

        await audit(session, org.id, 'integration.whatsapp_connected', 'integration', integration?.id, null, {
          waba_id:wabaId, phone_number_id:phoneNumberId, business_id:businessId, webhook_subscribed:subscribed
        });

        return res.status(200).json({ ok:true, integration, channel, webhook_subscribed:subscribed });
      }

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

      if (action === 'sync_meta_assets') {
        const rows = await sb(`crm_integrations?organization_id=eq.${org.id}&provider=eq.meta&integration_type=eq.business_portfolio&status=eq.connected&select=id,organization_id,status,metadata,credential_encrypted&order=connected_at.desc&limit=1`);
        const integration = rows?.[0];
        if (!integration) return res.status(404).json({ ok:false, error:'No hay una integración Meta conectada para esta empresa' });
        if (!integration.credential_encrypted) return res.status(409).json({ ok:false, error:'La conexión Meta no tiene credencial activa. Vuelve a conectarla.' });

        const accessToken = decryptCredential(integration.credential_encrypted);
        const result = await syncMetaAssets(org, integration, accessToken);
        await audit(session, org.id, 'integration.meta_assets_synced', 'integration', integration.id, null, {
          pages: result.pages.length,
          instagram: result.instagram.length,
          subscriptions: result.subscriptions
        });
        return res.status(200).json({ ok:true, ...result });
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
            credential_encrypted: null,
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

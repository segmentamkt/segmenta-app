const crypto = require('crypto');
const { decryptCredential } = require('./_crm-crypto');

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'segmenta_meta_verify_2026';
const WEBHOOK_VERSION = 'social-inbox-2026-09-17-1';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function verifySignature(req) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return true;
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !signature.startsWith('sha256=')) return false;
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}


async function sb(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase storage not configured');
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

async function createWebhookReceipt(req, payload, signatureValid) {
  try {
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    const entryIds = entries.map(x => x?.id).filter(Boolean).slice(0, 25);
    const eventCount = entries.reduce((sum, entry) =>
      sum + (Array.isArray(entry?.messaging) ? entry.messaging.length : 0)
          + (Array.isArray(entry?.changes) ? entry.changes.length : 0), 0);
    const rows = await sb('meta_webhook_receipts', {
      method:'POST',
      headers:{ Prefer:'return=representation' },
      body:JSON.stringify({
        object_type:String(payload?.object || '').toLowerCase() || null,
        entry_ids:entryIds,
        signature_present:Boolean(req.headers['x-hub-signature-256']),
        signature_valid:signatureValid,
        event_count:eventCount,
        result:signatureValid ? 'accepted' : 'rejected_signature'
      })
    });
    return rows?.[0]?.id || null;
  } catch (_) {
    return null;
  }
}

async function finishWebhookReceipt(id, result, error = null) {
  if (!id) return;
  try {
    await sb(`meta_webhook_receipts?id=eq.${encodeURIComponent(id)}`, {
      method:'PATCH',
      headers:{ Prefer:'return=minimal' },
      body:JSON.stringify({ result, error:error ? String(error).slice(0,500) : null })
    });
  } catch (_) {}
}

async function graphGet(path, token) {
  const url = new URL(`https://graph.facebook.com/v26.0/${String(path).replace(/^\//,'')}`);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Meta Graph ${response.status}`);
  return data;
}

async function getPageAccessToken(pageId, integrationToken) {
  try {
    const page = await graphGet(`${pageId}?fields=access_token`, integrationToken);
    if (page?.access_token) return page.access_token;
  } catch (_) {}

  try {
    const accounts = await graphGet('me/accounts?fields=id,access_token&limit=100', integrationToken);
    const page = (accounts?.data || []).find(x => String(x.id) === String(pageId));
    if (page?.access_token) return page.access_token;
  } catch (_) {}

  return null;
}

async function enrichMetaContact(event, stored) {
  if (!stored?.contact_id || event.is_echo || !['facebook_messenger','instagram'].includes(event.channel_type)) return null;

  const contacts = await sb(`crm_contacts?id=eq.${encodeURIComponent(stored.contact_id)}&select=id,display_name,metadata&limit=1`);
  const current = contacts?.[0];
  if (!current || current.display_name) return current || null;

  const channels = await sb(`crm_channels?id=eq.${encodeURIComponent(stored.channel_id)}&select=id,external_account_id,integration_id,metadata&limit=1`);
  const channel = channels?.[0];
  if (!channel?.integration_id) return null;

  const integrations = await sb(`crm_integrations?id=eq.${encodeURIComponent(channel.integration_id)}&status=eq.connected&select=id,credential_encrypted&limit=1`);
  const integration = integrations?.[0];
  if (!integration?.credential_encrypted) return null;

  const integrationToken = decryptCredential(integration.credential_encrypted);
  let accessToken = integrationToken;

  if (event.channel_type === 'facebook_messenger') {
    accessToken = await getPageAccessToken(channel.external_account_id, integrationToken) || integrationToken;
  } else {
    const parentPageId = channel?.metadata?.parent_page_id || null;
    if (parentPageId) {
      accessToken = await getPageAccessToken(parentPageId, integrationToken) || integrationToken;
    } else {
      try {
        const accounts = await graphGet('me/accounts?fields=id,access_token,instagram_business_account{id}&limit=100', integrationToken);
        const page = (accounts?.data || []).find(x =>
          String(x?.instagram_business_account?.id || '') === String(channel.external_account_id || '')
        );
        if (page?.access_token) accessToken = page.access_token;
      } catch (_) {}
    }
  }

  const attemptedAt = new Date().toISOString();
  const profile = event.channel_type === 'instagram'
    ? await graphGet(`${event.sender_id}?fields=id,name,username,profile_pic`, accessToken)
    : await graphGet(`${event.sender_id}?fields=id,first_name,last_name,profile_pic`, accessToken);

  const displayName = event.channel_type === 'instagram'
    ? String(profile?.name || profile?.username || '').trim() || null
    : [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() || null;
  if (!displayName) return null;

  const metaProfile = event.channel_type === 'instagram'
    ? {
        platform: 'instagram',
        id: profile?.id || event.sender_id,
        name: profile?.name || null,
        username: profile?.username || null,
        profile_pic: profile?.profile_pic || null,
        synced_at: attemptedAt
      }
    : {
        platform: 'facebook_messenger',
        id: profile?.id || event.sender_id,
        first_name: profile?.first_name || null,
        last_name: profile?.last_name || null,
        profile_pic: profile?.profile_pic || null,
        synced_at: attemptedAt
      };

  const metadata = {
    ...(current.metadata || {}),
    meta_profile: metaProfile,
    meta_profile_pic: profile?.profile_pic || null,
    meta_profile_enriched_at: attemptedAt,
    meta_profile_sync: {
      ok: true,
      platform: event.channel_type,
      code: 'OK',
      attempted_at: attemptedAt,
      token_configured: true
    }
  };

  const updated = await sb(`crm_contacts?id=eq.${encodeURIComponent(stored.contact_id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      display_name: displayName,
      metadata,
      updated_at: attemptedAt
    })
  });

  return updated?.[0] || null;
}

async function persistSocialEvent(event) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, skipped: 'storage not configured' };
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/crm_ingest_social_message`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_channel_type: event.channel_type,
      p_account_id: event.account_id,
      p_sender_id: event.sender_id,
      p_recipient_id: event.recipient_id,
      p_timestamp: event.timestamp,
      p_mid: event.mid,
      p_text: event.text,
      p_attachments: event.attachments || [],
      p_raw_payload: event.raw_event || {},
      p_is_echo: Boolean(event.is_echo)
    })
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) throw new Error(`Storage ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data || { ok: true };
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    if (req.query.health === '1') {
      return res.status(200).json({
        ok: true,
        version: WEBHOOK_VERSION,
        social_storage_configured: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
        verify_token_configured: Boolean(VERIFY_TOKEN)
      });
    }
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).json({ ok: false, error: 'Verification failed' });
  }

  if (req.method === 'POST') {
    const payload = req.body || {};
    const signatureValid = verifySignature(req);
    const receiptId = await createWebhookReceipt(req, payload, signatureValid);
    if (!signatureValid) {
      await finishWebhookReceipt(receiptId, 'rejected_signature', 'Invalid signature');
      return res.status(401).json({ ok: false, error: 'Invalid signature' });
    }
    const objectType = String(payload.object || '').toLowerCase();
    const channelType = objectType === 'instagram' ? 'instagram' : 'facebook_messenger';
    const leadEvents = [];
    const messageEvents = [];

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === 'leadgen') {
          leadEvents.push({ page_id: entry.id || null, time: entry.time || null, ...change.value });
        }
      }
      for (const event of entry.messaging || []) {
        const message = event.message || {};
        messageEvents.push({
          channel_type: channelType,
          account_id: entry.id || event.recipient?.id || null,
          sender_id: event.sender?.id || null,
          recipient_id: event.recipient?.id || null,
          timestamp: event.timestamp || entry.time || null,
          mid: message.mid || null,
          text: message.text || null,
          attachments: message.attachments || [],
          is_echo: Boolean(message.is_echo),
          raw_event: event
        });
      }
    }

    if (leadEvents.length) console.log('META_LEADGEN_EVENTS', JSON.stringify(leadEvents));

    let storedMessages = 0;
    for (const event of messageEvents) {
      console.log('META_SOCIAL_MESSAGE', event.channel_type, event.sender_id || '-', event.text || '[sin texto]');
      try {
        const stored = await persistSocialEvent(event);
        if (stored?.ok) storedMessages += stored.duplicate ? 0 : 1;
        console.log('META_SOCIAL_STORED', JSON.stringify(stored));
        try {
          const enriched = await enrichMetaContact(event, stored);
          if (enriched?.display_name) console.log('META_CONTACT_ENRICHED', enriched.id, enriched.display_name);
        } catch (profileError) {
          console.warn('META_CONTACT_ENRICH_ERROR', event.channel_type, profileError.message);
          try {
            if (stored?.contact_id) {
              const rows = await sb(`crm_contacts?id=eq.${encodeURIComponent(stored.contact_id)}&select=id,metadata&limit=1`);
              const contact = rows?.[0];
              if (contact) {
                await sb(`crm_contacts?id=eq.${encodeURIComponent(stored.contact_id)}`, {
                  method: 'PATCH',
                  headers: { Prefer: 'return=minimal' },
                  body: JSON.stringify({
                    metadata: {
                      ...(contact.metadata || {}),
                      meta_profile_enrich_error: profileError.message,
                      meta_profile_enrich_error_at: new Date().toISOString()
                    },
                    updated_at: new Date().toISOString()
                  })
                });
              }
            }
          } catch (_) {}
        }
      } catch (error) {
        console.error('META_SOCIAL_STORE_ERROR', event.channel_type, error.message);
      }
    }

    await finishWebhookReceipt(receiptId, 'processed:' + storedMessages + '/' + messageEvents.length);
    return res.status(200).json({
      ok: true,
      version: WEBHOOK_VERSION,
      object: objectType || null,
      received_leads: leadEvents.length,
      received_messages: messageEvents.length,
      stored_messages: storedMessages,
      social_storage_configured: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
    });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};

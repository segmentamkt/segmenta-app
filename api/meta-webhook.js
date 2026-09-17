const crypto = require('crypto');

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
    if (!verifySignature(req)) return res.status(401).json({ ok: false, error: 'Invalid signature' });

    const payload = req.body || {};
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
      } catch (error) {
        console.error('META_SOCIAL_STORE_ERROR', event.channel_type, error.message);
      }
    }

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

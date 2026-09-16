const crypto = require('crypto');

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'segmenta_meta_verify_2026';
const WEBHOOK_VERSION = 'messenger-storage-2026-09-16-1';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejhfersvmjhxzatsobae.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function verifySignature(req) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return true; // Test mode until the secret is configured in Vercel.

  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !signature.startsWith('sha256=')) return false;

  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function persistMessengerEvent(event) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, skipped: 'SUPABASE_SERVICE_ROLE_KEY not configured' };
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/crm_ingest_messenger_message`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_page_id: event.page_id,
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

  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }

  return data || { ok: true };
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    if (req.query.health === '1') {
      return res.status(200).json({
        ok: true,
        version: WEBHOOK_VERSION,
        messenger_storage_configured: Boolean(SUPABASE_SERVICE_ROLE_KEY)
      });
    }

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.status(403).json({ ok: false, error: 'Verification failed' });
  }

  if (req.method === 'POST') {
    if (!verifySignature(req)) {
      return res.status(401).json({ ok: false, error: 'Invalid signature' });
    }

    const payload = req.body || {};
    const leadEvents = [];
    const messengerEvents = [];

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === 'leadgen') {
          leadEvents.push({
            page_id: entry.id || null,
            time: entry.time || null,
            ...change.value
          });
        }
      }

      for (const event of entry.messaging || []) {
        const message = event.message || {};
        messengerEvents.push({
          page_id: entry.id || event.recipient?.id || null,
          sender_id: event.sender?.id || null,
          recipient_id: event.recipient?.id || null,
          timestamp: event.timestamp || entry.time || null,
          mid: message.mid || null,
          text: message.text || null,
          attachments: message.attachments || [],
          is_echo: Boolean(message.is_echo),
          quick_reply: message.quick_reply || null,
          reply_to: message.reply_to || null,
          raw_event: event
        });
      }
    }

    if (leadEvents.length) {
      console.log('META_LEADGEN_EVENTS', JSON.stringify(leadEvents));
    }

    let storedMessages = 0;
    if (messengerEvents.length) {
      console.log('META_MESSENGER_EVENTS', JSON.stringify(messengerEvents.map(({ raw_event, ...event }) => event)));

      for (const event of messengerEvents) {
        console.log('META_MESSENGER_TEXT', event.sender_id || '-', event.text || '[sin texto]');
        try {
          const stored = await persistMessengerEvent(event);
          if (stored?.ok) storedMessages += stored.duplicate ? 0 : 1;
          console.log('META_MESSENGER_STORED', JSON.stringify(stored));
        } catch (error) {
          console.error('META_MESSENGER_STORE_ERROR', error.message);
        }
      }
    }

    return res.status(200).json({
      ok: true,
      version: WEBHOOK_VERSION,
      received_leads: leadEvents.length,
      received_messages: messengerEvents.length,
      stored_messages: storedMessages,
      messenger_storage_configured: Boolean(SUPABASE_SERVICE_ROLE_KEY)
    });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};

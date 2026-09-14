const crypto = require('crypto');

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'segmenta_meta_verify_2026';

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

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
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
    }

    console.log('META_LEADGEN_EVENTS', JSON.stringify(leadEvents));
    return res.status(200).json({ ok: true, received: leadEvents.length });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};

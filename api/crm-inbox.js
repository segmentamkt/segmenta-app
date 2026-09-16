const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejhfersvmjhxzatsobae.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const COOKIE_NAME = 'segmenta_crm_session';
const EXPECTED_EMAIL = 'host@segmenta.co';

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function verifySession(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token || !SUPABASE_SERVICE_ROLE_KEY) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', SUPABASE_SERVICE_ROLE_KEY).update(payload).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  let decoded;
  try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (_) { return false; }
  return decoded?.email === EXPECTED_EMAIL && Number(decoded?.exp || 0) > Date.now();
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

async function getOrganization(slug) {
  const rows = await sb(`crm_organizations?slug=eq.${encodeURIComponent(slug)}&select=id,name,slug&limit=1`);
  return rows?.[0] || null;
}

function channelName(type) {
  if (type === 'facebook_messenger') return 'Facebook Messenger';
  if (type === 'instagram') return 'Instagram';
  if (type === 'whatsapp') return 'WhatsApp';
  if (type === 'webchat') return 'Chat Web';
  if (type === 'tiktok') return 'TikTok';
  return type || 'Canal';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!verifySession(req)) {
    return res.status(401).json({ ok: false, error: 'CRM session required' });
  }

  try {
    if (req.method === 'POST') {
      const conversationId = String(req.body?.conversation_id || '').trim();
      if (!conversationId) return res.status(400).json({ ok: false, error: 'conversation_id required' });
      await sb(`crm_conversations?id=eq.${encodeURIComponent(conversationId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ unread_count: 0, updated_at: new Date().toISOString() })
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const orgSlug = String(req.query.org || 'segmenta').trim().toLowerCase();
    const organization = await getOrganization(orgSlug);
    if (!organization) return res.status(404).json({ ok: false, error: 'Organization not found' });

    const conversationId = String(req.query.conversation_id || '').trim();
    if (conversationId) {
      const convRows = await sb(`crm_conversations?id=eq.${encodeURIComponent(conversationId)}&organization_id=eq.${organization.id}&select=id,status,unread_count,last_message_at,contact:crm_contacts(id,external_user_id,display_name,phone,email),channel:crm_channels(id,channel_type,external_account_name)&limit=1`);
      const conversation = convRows?.[0];
      if (!conversation) return res.status(404).json({ ok: false, error: 'Conversation not found' });

      const messages = await sb(`crm_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&organization_id=eq.${organization.id}&select=id,direction,message_type,text,attachments,sent_at,created_at,external_message_id&order=sent_at.asc&limit=300`);
      return res.status(200).json({
        ok: true,
        organization,
        conversation: {
          ...conversation,
          channel_label: channelName(conversation.channel?.channel_type)
        },
        messages: messages || []
      });
    }

    const conversations = await sb(`crm_conversations?organization_id=eq.${organization.id}&select=id,status,unread_count,last_message_at,created_at,contact:crm_contacts(id,external_user_id,display_name,phone,email),channel:crm_channels(id,channel_type,external_account_name)&order=last_message_at.desc.nullslast&limit=100`);
    const ids = (conversations || []).map(x => x.id);
    const latestByConversation = {};

    if (ids.length) {
      const inFilter = ids.join(',');
      const messages = await sb(`crm_messages?organization_id=eq.${organization.id}&conversation_id=in.(${encodeURIComponent(inFilter)})&select=conversation_id,direction,message_type,text,attachments,sent_at&order=sent_at.desc&limit=500`);
      for (const message of messages || []) {
        if (!latestByConversation[message.conversation_id]) latestByConversation[message.conversation_id] = message;
      }
    }

    const data = (conversations || []).map(conversation => ({
      ...conversation,
      channel_label: channelName(conversation.channel?.channel_type),
      latest_message: latestByConversation[conversation.id] || null
    }));

    return res.status(200).json({
      ok: true,
      organization,
      conversations: data,
      unread_total: data.reduce((sum, x) => sum + Number(x.unread_count || 0), 0)
    });
  } catch (error) {
    console.error('CRM_INBOX_ERROR', error.message);
    return res.status(500).json({ ok: false, error: 'Inbox request failed' });
  }
};

const { verifySession, isPlatformAdmin } = require('./_crm-session');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejhfersvmjhxzatsobae.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || '';
const META_INSTAGRAM_ACCESS_TOKEN = process.env.META_INSTAGRAM_ACCESS_TOKEN || '';
const META_GRAPH_VERSION = 'v26.0';

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

function profileTokenFor(type) {
  return type === 'instagram' ? META_INSTAGRAM_ACCESS_TOKEN : META_PAGE_ACCESS_TOKEN;
}

async function fetchGraphProfile(id, fields, accessToken) {
  if (!accessToken || !id) return null;
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(id)}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  if (!response.ok || data?.error) {
    const error = new Error(data?.error?.message || `Meta profile lookup failed (${response.status})`);
    error.metaCode = data?.error?.code ?? null;
    error.metaSubcode = data?.error?.error_subcode ?? null;
    error.metaType = data?.error?.type ?? null;
    error.httpStatus = response.status;
    throw error;
  }
  return data;
}

async function persistMetaProfileSync(contact, sync, extra = {}) {
  const metadata = {
    ...(contact.metadata || {}),
    ...extra,
    meta_profile_sync: sync
  };
  try {
    const updated = await sb(`crm_contacts?id=eq.${encodeURIComponent(contact.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ metadata, updated_at: new Date().toISOString() })
    });
    return updated?.[0] || { ...contact, metadata };
  } catch (error) {
    console.warn('CRM_META_PROFILE_SYNC_STORE_ERROR', contact.external_user_id || '-', error.message);
    return { ...contact, metadata };
  }
}

async function enrichContactFromMeta(contact, channel) {
  if (!contact || contact.display_name) return contact;
  const type = channel?.channel_type;
  if (!['facebook_messenger', 'instagram'].includes(type)) return contact;

  const attemptedAt = new Date().toISOString();
  const accessToken = profileTokenFor(type);
  const tokenEnvName = type === 'instagram' ? 'META_INSTAGRAM_ACCESS_TOKEN' : 'META_PAGE_ACCESS_TOKEN';

  if (!accessToken) {
    return persistMetaProfileSync(contact, {
      ok: false,
      platform: type,
      code: 'TOKEN_NOT_CONFIGURED',
      message: `${tokenEnvName} no está disponible en este deployment de Production.`,
      token_configured: false,
      attempted_at: attemptedAt
    });
  }

  try {
    const fields = type === 'instagram'
      ? 'id,name,username,profile_pic'
      : 'id,first_name,last_name,profile_pic';
    const profile = await fetchGraphProfile(contact.external_user_id, fields, accessToken);

    if (!profile) {
      return persistMetaProfileSync(contact, {
        ok: false,
        platform: type,
        code: 'NO_PROFILE_RESPONSE',
        message: 'Meta no devolvió un perfil para este contacto.',
        token_configured: true,
        attempted_at: attemptedAt
      });
    }

    const displayName = type === 'instagram'
      ? String(profile.name || profile.username || '').trim()
      : [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();

    const metadata = {
      ...(contact.metadata || {}),
      meta_profile: type === 'instagram' ? {
        platform: 'instagram',
        id: profile.id || contact.external_user_id,
        name: profile.name || null,
        username: profile.username || null,
        profile_pic: profile.profile_pic || null,
        synced_at: attemptedAt
      } : {
        platform: 'facebook_messenger',
        id: profile.id || contact.external_user_id,
        first_name: profile.first_name || null,
        last_name: profile.last_name || null,
        profile_pic: profile.profile_pic || null,
        synced_at: attemptedAt
      },
      meta_profile_sync: {
        ok: Boolean(displayName),
        platform: type,
        code: displayName ? 'OK' : 'PROFILE_WITHOUT_NAME',
        message: displayName ? null : 'Meta respondió, pero no incluyó un nombre o usuario.',
        token_configured: true,
        attempted_at: attemptedAt
      }
    };

    const updated = await sb(`crm_contacts?id=eq.${encodeURIComponent(contact.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ display_name: displayName || null, metadata, updated_at: attemptedAt })
    });
    return updated?.[0] || { ...contact, display_name: displayName || null, metadata };
  } catch (error) {
    console.warn('CRM_META_PROFILE_ERROR', type || '-', contact.external_user_id || '-', error.message);
    return persistMetaProfileSync(contact, {
      ok: false,
      platform: type,
      code: error.metaCode ?? 'META_REQUEST_ERROR',
      subcode: error.metaSubcode ?? null,
      type: error.metaType ?? null,
      http_status: error.httpStatus ?? null,
      message: String(error.message || 'Meta profile lookup failed').slice(0, 500),
      token_configured: true,
      attempted_at: attemptedAt
    });
  }
}

async function enrichConversation(conversation) {
  if (!conversation?.contact) return conversation;
  const contact = await enrichContactFromMeta(conversation.contact, conversation.channel);
  return { ...conversation, contact };
}

async function getScopedConversation(conversationId, organizationId) {
  const rows = await sb(`crm_conversations?id=eq.${encodeURIComponent(conversationId)}&organization_id=eq.${organizationId}&select=id,contact_id,channel_id,status,unread_count,last_message_at,created_at,updated_at,contact:crm_contacts(id,external_user_id,display_name,phone,email,metadata,created_at,updated_at),channel:crm_channels(id,channel_type,external_account_name,external_account_id)&limit=1`);
  return rows?.[0] || null;
}

function cleanText(value, max = 500) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function safeMetadataPatch(input) {
  const allowed = ['business', 'city', 'source', 'interest', 'lead_status', 'responsible', 'notes'];
  const out = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(input || {}, key)) out[key] = cleanText(input[key], key === 'notes' ? 4000 : 500);
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const session = verifySession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'CRM session required' });

  try {
    const requestedOrg = String(req.query?.org || req.body?.org || '').trim().toLowerCase();
    const orgSlug = isPlatformAdmin(session)
      ? (requestedOrg || session.organization_slug || 'segmenta')
      : session.organization_slug;

    if (!orgSlug) return res.status(403).json({ ok: false, error: 'No active organization in session' });
    if (!isPlatformAdmin(session) && requestedOrg && requestedOrg !== orgSlug) {
      return res.status(403).json({ ok: false, error: 'No tienes acceso a esa empresa' });
    }

    const organization = await getOrganization(orgSlug);
    if (!organization) return res.status(404).json({ ok: false, error: 'Organization not found' });

    if (req.method === 'POST') {
      const conversationId = String(req.body?.conversation_id || '').trim();
      if (!conversationId) return res.status(400).json({ ok: false, error: 'conversation_id required' });
      const conversation = await getScopedConversation(conversationId, organization.id);
      if (!conversation) return res.status(404).json({ ok: false, error: 'Conversation not found' });
      await sb(`crm_conversations?id=eq.${encodeURIComponent(conversationId)}&organization_id=eq.${organization.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ unread_count: 0, updated_at: new Date().toISOString() })
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      if (session.role === 'viewer') return res.status(403).json({ ok: false, error: 'Acceso de solo lectura' });
      const conversationId = String(req.body?.conversation_id || '').trim();
      if (!conversationId) return res.status(400).json({ ok: false, error: 'conversation_id required' });
      const conversation = await getScopedConversation(conversationId, organization.id);
      if (!conversation?.contact?.id) return res.status(404).json({ ok: false, error: 'Contact not found' });

      const metadata = {
        ...(conversation.contact.metadata || {}),
        ...safeMetadataPatch(req.body?.metadata || {})
      };
      const patch = {
        display_name: cleanText(req.body?.display_name, 300),
        phone: cleanText(req.body?.phone, 100),
        email: cleanText(req.body?.email, 320),
        metadata,
        updated_at: new Date().toISOString()
      };
      const updated = await sb(`crm_contacts?id=eq.${conversation.contact.id}&organization_id=eq.${organization.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch)
      });
      return res.status(200).json({ ok: true, contact: updated?.[0] || { ...conversation.contact, ...patch } });
    }

    if (req.method === 'DELETE') {
      if (session.role === 'viewer') return res.status(403).json({ ok: false, error: 'Acceso de solo lectura' });
      const conversationId = String(req.query?.conversation_id || '').trim();
      if (!conversationId) return res.status(400).json({ ok: false, error: 'conversation_id required' });
      const conversation = await getScopedConversation(conversationId, organization.id);
      if (!conversation) return res.status(404).json({ ok: false, error: 'Conversation not found' });

      const deleteContact = String(req.query?.delete_contact || '1') !== '0';
      if (deleteContact && conversation.contact?.id) {
        await sb(`crm_contacts?id=eq.${conversation.contact.id}&organization_id=eq.${organization.id}`, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' }
        });
      } else {
        await sb(`crm_conversations?id=eq.${conversation.id}&organization_id=eq.${organization.id}`, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' }
        });
      }
      return res.status(200).json({ ok: true, deleted_contact: deleteContact });
    }

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const conversationId = String(req.query?.conversation_id || '').trim();
    if (conversationId) {
      let conversation = await getScopedConversation(conversationId, organization.id);
      if (!conversation) return res.status(404).json({ ok: false, error: 'Conversation not found' });
      conversation = await enrichConversation(conversation);
      const messages = await sb(`crm_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&organization_id=eq.${organization.id}&select=id,direction,message_type,text,attachments,sent_at,created_at,external_message_id&order=sent_at.asc&limit=300`);
      return res.status(200).json({
        ok: true,
        organization,
        meta_profile_configured: Boolean(META_PAGE_ACCESS_TOKEN),
        instagram_profile_configured: Boolean(META_INSTAGRAM_ACCESS_TOKEN),
        conversation: { ...conversation, channel_label: channelName(conversation.channel?.channel_type) },
        messages: messages || []
      });
    }

    let conversations = await sb(`crm_conversations?organization_id=eq.${organization.id}&select=id,contact_id,channel_id,status,unread_count,last_message_at,created_at,updated_at,contact:crm_contacts(id,external_user_id,display_name,phone,email,metadata,created_at,updated_at),channel:crm_channels(id,channel_type,external_account_name,external_account_id)&order=last_message_at.desc.nullslast&limit=100`);
    conversations = await Promise.all((conversations || []).map(enrichConversation));
    const ids = conversations.map(x => x.id);
    const latestByConversation = {};
    if (ids.length) {
      const inFilter = ids.join(',');
      const messages = await sb(`crm_messages?organization_id=eq.${organization.id}&conversation_id=in.(${encodeURIComponent(inFilter)})&select=conversation_id,direction,message_type,text,attachments,sent_at&order=sent_at.desc&limit=500`);
      for (const message of messages || []) if (!latestByConversation[message.conversation_id]) latestByConversation[message.conversation_id] = message;
    }
    const data = conversations.map(conversation => ({
      ...conversation,
      channel_label: channelName(conversation.channel?.channel_type),
      latest_message: latestByConversation[conversation.id] || null
    }));
    return res.status(200).json({
      ok: true,
      organization,
      meta_profile_configured: Boolean(META_PAGE_ACCESS_TOKEN),
      instagram_profile_configured: Boolean(META_INSTAGRAM_ACCESS_TOKEN),
      conversations: data,
      unread_total: data.reduce((sum, x) => sum + Number(x.unread_count || 0), 0)
    });
  } catch (error) {
    console.error('CRM_INBOX_ERROR', error.message);
    return res.status(500).json({ ok: false, error: 'Inbox request failed' });
  }
};

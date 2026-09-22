const { verifySession, isPlatformAdmin, hasModuleAccess } = require('./_crm-session');
const { decryptCredential } = require('./_crm-crypto');

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

async function graphGet(path, accessToken) {
  if (!accessToken) return null;
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${String(path).replace(/^\\//,'')}`);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    const error = new Error(data?.error?.message || `Meta Graph ${response.status}`);
    error.metaCode = data?.error?.code ?? null;
    error.metaSubcode = data?.error?.error_subcode ?? null;
    error.metaType = data?.error?.type ?? null;
    error.httpStatus = response.status;
    throw error;
  }
  return data;
}

async function integrationTokenForChannel(channel, organizationId) {
  let integrationId = channel?.integration_id || null;

  if (!integrationId && organizationId && channel?.external_account_id) {
    const sibling = await sb(
      `crm_channels?organization_id=eq.${organizationId}&channel_type=eq.${encodeURIComponent(channel.channel_type)}&external_account_id=eq.${encodeURIComponent(channel.external_account_id)}&integration_id=not.is.null&select=integration_id,metadata&limit=1`
    );
    integrationId = sibling?.[0]?.integration_id || null;
    if (sibling?.[0]?.metadata && !channel.metadata) channel.metadata = sibling[0].metadata;
  }

  if (!integrationId) return null;
  const rows = await sb(
    `crm_integrations?id=eq.${encodeURIComponent(integrationId)}&organization_id=eq.${organizationId}&status=eq.connected&select=id,credential_encrypted&limit=1`
  );
  const integration = rows?.[0];
  if (!integration?.credential_encrypted) return null;
  return decryptCredential(integration.credential_encrypted);
}

async function getPageAccessToken(pageId, integrationToken) {
  if (!pageId || !integrationToken) return null;
  try {
    const page = await graphGet(`${pageId}?fields=access_token`, integrationToken);
    if (page?.access_token) return page.access_token;
  } catch (_) {}
  try {
    const accounts = await graphGet('me/accounts?fields=id,access_token&limit=100', integrationToken);
    const page = (accounts?.data || []).find(x => String(x.id) === String(pageId));
    return page?.access_token || null;
  } catch (_) {}
  return null;
}

async function resolveMetaAccessToken(channel, organizationId) {
  const integrationToken = await integrationTokenForChannel(channel, organizationId);
  if (integrationToken) {
    if (channel?.channel_type === 'facebook_messenger') {
      return await getPageAccessToken(channel.external_account_id, integrationToken) || integrationToken;
    }
    if (channel?.channel_type === 'instagram') {
      const parentPageId = channel?.metadata?.parent_page_id || null;
      if (parentPageId) {
        const pageToken = await getPageAccessToken(parentPageId, integrationToken);
        if (pageToken) return pageToken;
      }
      try {
        const accounts = await graphGet('me/accounts?fields=id,access_token,instagram_business_account{id}&limit=100', integrationToken);
        const page = (accounts?.data || []).find(x =>
          String(x?.instagram_business_account?.id || '') === String(channel.external_account_id || '')
        );
        if (page?.access_token) return page.access_token;
      } catch (_) {}
      return integrationToken;
    }
  }
  return profileTokenFor(channel?.channel_type);
}

async function sendMetaText(conversation, organizationId, text) {
  const channel = conversation?.channel;
  const contact = conversation?.contact;
  if (!channel || !contact?.external_user_id) throw new Error('La conversación no tiene destinatario válido.');
  if (!['facebook_messenger','instagram'].includes(channel.channel_type)) {
    throw new Error('Este canal todavía no admite respuestas desde el CRM.');
  }

  const accessToken = await resolveMetaAccessToken(channel, organizationId);
  if (!accessToken) throw new Error('No hay una credencial activa de Meta para responder desde este canal.');

  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(channel.external_account_id)}/messages`);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      recipient: { id: contact.external_user_id },
      message: { text }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    const message = data?.error?.message || `Meta no pudo enviar el mensaje (${response.status})`;
    const error = new Error(message);
    error.metaCode = data?.error?.code ?? null;
    throw error;
  }
  return data || {};
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

async function enrichContactFromMeta(contact, channel, organizationId) {
  if (!contact || contact.display_name) return contact;
  const type = channel?.channel_type;
  if (!['facebook_messenger', 'instagram'].includes(type)) return contact;

  const attemptedAt = new Date().toISOString();
  const accessToken = await resolveMetaAccessToken(channel, organizationId);
  const tokenEnvName = type === 'instagram' ? 'Meta Business / Instagram' : 'Meta Business / Facebook';

  if (!accessToken) {
    return persistMetaProfileSync(contact, {
      ok: false,
      platform: type,
      code: 'TOKEN_NOT_CONFIGURED',
      message: `${tokenEnvName} no tiene una credencial disponible para este canal.`,
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

async function enrichConversation(conversation, organizationId) {
  if (!conversation?.contact) return conversation;
  const contact = await enrichContactFromMeta(conversation.contact, conversation.channel, organizationId);
  return { ...conversation, contact };
}

async function getScopedConversation(conversationId, organizationId) {
  const rows = await sb(`crm_conversations?id=eq.${encodeURIComponent(conversationId)}&organization_id=eq.${organizationId}&select=id,organization_id,contact_id,channel_id,status,unread_count,last_message_at,created_at,updated_at,contact:crm_contacts(id,external_user_id,display_name,phone,email,metadata,created_at,updated_at),channel:crm_channels(id,channel_type,external_account_name,external_account_id,integration_id,status,metadata)&limit=1`);
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
  if (!hasModuleAccess(session, 'inbox', 'read')) return res.status(403).json({ ok: false, error: 'No tienes acceso a la Bandeja' });

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
      const action = String(req.body?.action || 'mark_read').trim();
      const conversationId = String(req.body?.conversation_id || '').trim();
      if (!conversationId) return res.status(400).json({ ok: false, error: 'conversation_id required' });
      const conversation = await getScopedConversation(conversationId, organization.id);
      if (!conversation) return res.status(404).json({ ok: false, error: 'Conversation not found' });

      if (action === 'send_message') {
        if (!hasModuleAccess(session, 'inbox', 'edit')) {
          return res.status(403).json({ ok: false, error: 'No tienes permiso para responder conversaciones' });
        }
        const text = cleanText(req.body?.text, 2000);
        if (!text) return res.status(400).json({ ok: false, error: 'Escribe un mensaje antes de enviar.' });

        const sent = await sendMetaText(conversation, organization.id, text);
        const now = new Date().toISOString();
        const externalMessageId = String(sent.message_id || sent.id || `crm-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);

        await sb('crm_messages', {
          method: 'POST',
          headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
          body: JSON.stringify({
            organization_id: organization.id,
            channel_id: conversation.channel_id,
            conversation_id: conversation.id,
            contact_id: conversation.contact_id,
            external_message_id: externalMessageId,
            direction: 'outbound',
            message_type: 'text',
            text,
            attachments: [],
            sent_at: now,
            raw_payload: { source: 'crm_inbox', meta_response: sent }
          })
        });

        await sb(`crm_conversations?id=eq.${encodeURIComponent(conversation.id)}&organization_id=eq.${organization.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ unread_count: 0, last_message_at: now, updated_at: now })
        });

        return res.status(200).json({ ok: true, message_id: externalMessageId, meta: sent });
      }

      await sb(`crm_conversations?id=eq.${encodeURIComponent(conversationId)}&organization_id=eq.${organization.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ unread_count: 0, updated_at: new Date().toISOString() })
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      if (!hasModuleAccess(session, 'contacts', 'edit')) return res.status(403).json({ ok: false, error: 'No tienes permiso para editar contactos' });
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
      if (!hasModuleAccess(session, 'contacts', 'delete')) return res.status(403).json({ ok: false, error: 'No tienes permiso para eliminar contactos' });
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
      conversation = await enrichConversation(conversation, organization.id);
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
    conversations = await Promise.all((conversations || []).map(x => enrichConversation(x, organization.id)));
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

const { verifySession, isPlatformAdmin } = require('./_crm-session');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ejhfersvmjhxzatsobae.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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

async function orgById(id) {
  const rows = await sb(`crm_organizations?id=eq.${encodeURIComponent(id)}&status=eq.active&select=id,name,slug&limit=1`);
  return rows?.[0] || null;
}

async function clientForOrg(orgId) {
  const rows = await sb(`clients?organization_id=eq.${encodeURIComponent(orgId)}&select=*&limit=1`);
  return rows?.[0] || null;
}

const SERVICE_CATALOG = [
  { key:'meta_ads', name:'Meta Ads' },
  { key:'google_ads', name:'Google Ads' },
  { key:'tiktok_ads', name:'TikTok Ads' },
  { key:'organic_strategy', name:'Estrategia Orgánica' },
  { key:'content_recording', name:'Grabación de contenido' },
  { key:'editing', name:'Edición' },
  { key:'crm', name:'CRM' },
  { key:'tasks', name:'Tareas' },
  { key:'integrations', name:'Integraciones / Automatización' },
  { key:'web', name:'Página web' },
  { key:'landing', name:'Landing Page' },
  { key:'reports', name:'Reportes' },
  { key:'payments', name:'Pagos' }
];

function defaultServices() {
  return SERVICE_CATALOG.map(x => ({
    service_key:x.key,
    service_name:x.name,
    active_in_plan:false,
    client_visible:false,
    status:'inactive',
    plan_label:null,
    notes:null,
    metadata:{}
  }));
}

function resolveOrgId(session, body) {
  return isPlatformAdmin(session)
    ? String(body?.organization_id || session.organization_id || '').trim()
    : String(session.organization_id || '').trim();
}

async function portalPermission(orgId, key) {
  const client = await clientForOrg(orgId);
  if (!client?.id) return { client:null, allowed:false };
  const p = client.portal_settings || {};
  const allowed = key === 'crm' ? p.crm === true : p[key] !== false;
  return { client, allowed };
}

async function entityBelongsToClient(entityType, entityId, client, orgId) {
  if (!entityId || !client?.id) return false;
  if (entityType === 'task') {
    const rows = await sb(`crm_tasks?id=eq.${encodeURIComponent(entityId)}&organization_id=eq.${encodeURIComponent(orgId)}&select=id,metadata&limit=1`);
    const row = rows?.[0];
    return !!row && (row.metadata?.portal_visible === true || row.metadata?.client_id === client.id);
  }
  const table = entityType === 'request' ? 'client_requests' : entityType === 'announcement' ? 'client_announcements' : '';
  if (!table) return false;
  const rows = await sb(`${table}?id=eq.${encodeURIComponent(entityId)}&client_id=eq.${encodeURIComponent(client.id)}&select=id&limit=1`);
  return !!rows?.[0];
}

async function portalPayload(orgId) {
  const org = await orgById(orgId);
  if (!org) throw new Error('Workspace no encontrado');
  const client = await clientForOrg(orgId);

  const [opps, orders, allTasks] = await Promise.all([
    sb(`crm_opportunities?organization_id=eq.${encodeURIComponent(orgId)}&is_test=eq.false&select=id,title,stage,status,value,product,city,source,created_at,updated_at&order=updated_at.desc&limit=100`),
    sb(`crm_orders?organization_id=eq.${encodeURIComponent(orgId)}&is_test=eq.false&select=id,order_number,total,payment_status,status,created_at&order=created_at.desc&limit=100`),
    sb(`crm_tasks?organization_id=eq.${encodeURIComponent(orgId)}&is_test=eq.false&select=id,title,description,task_type,status,priority,due_at,created_at,updated_at,metadata&order=created_at.desc&limit=250`)
  ]);

  let reports=[],analyses=[],documents=[],services=[],requests=[],announcements=[],files=[],comments=[];
  if (client?.id) {
    [reports, analyses, documents, services, requests, announcements, files, comments] = await Promise.all([
      sb(`weekly_reports?client_id=eq.${client.id}&select=*&order=created_at.desc&limit=24`),
      sb(`client_analyses?client_id=eq.${client.id}&select=*&order=published_at.desc&limit=50`),
      sb(`client_documents?client_id=eq.${client.id}&select=*&order=document_date.desc.nullslast,created_at.desc&limit=100`),
      sb(`client_services?client_id=eq.${client.id}&select=*&order=service_name.asc`),
      sb(`client_requests?client_id=eq.${client.id}&select=*&order=created_at.desc&limit=150`),
      sb(`client_announcements?client_id=eq.${client.id}&visible_to_client=eq.true&select=*&order=created_at.desc&limit=150`),
      sb(`client_files?client_id=eq.${client.id}&select=*&order=created_at.desc&limit=150`),
      sb(`client_comments?client_id=eq.${client.id}&select=*&order=created_at.asc&limit=500`)
    ]);
  }

  const portalSettings = client?.portal_settings || {};
  const canPortal = key => key === 'crm' ? portalSettings.crm === true : portalSettings[key] !== false;

  const serviceMap = Object.fromEntries((services || []).map(x => [x.service_key, x]));
  services = defaultServices().map(x => ({ ...x, ...(serviceMap[x.service_key] || {}) }));

  const portalTasks = (allTasks || []).filter(t => {
    const m = t.metadata || {};
    return m.portal_visible === true || (client?.id && m.client_id === client.id);
  });

  const open = (opps || []).filter(x => x.status === 'open');
  const won = (opps || []).filter(x => x.status === 'won' || x.stage === 'won');
  const paidOrders = (orders || []).filter(x => x.payment_status === 'paid');
  const openPortalTasks = portalTasks.filter(x => !['completed','done','cancelled'].includes(x.status));

  return {
    ok: true,
    organization: org,
    client,
    portal_settings: portalSettings,
    services: canPortal('services') ? services : [],
    summary: {
      opportunities_open: open.length,
      pipeline_value: open.reduce((s,x)=>s+Number(x.value||0),0),
      opportunities_won: won.length,
      won_value: won.reduce((s,x)=>s+Number(x.value||0),0),
      orders_paid: paidOrders.length,
      paid_value: paidOrders.reduce((s,x)=>s+Number(x.total||0),0),
      tasks_open: openPortalTasks.length,
      tasks_waiting_client: openPortalTasks.filter(x=>x.status==='waiting_client').length,
      tasks_overdue: openPortalTasks.filter(x=>x.due_at && new Date(x.due_at)<new Date()).length,
      requests_open: (requests || []).filter(x=>!['completed','closed'].includes(x.status)).length
    },
    opportunities: (canPortal('results') || canPortal('crm')) ? (opps || []) : [],
    tasks: canPortal('tasks') ? portalTasks : [],
    weekly_reports: canPortal('results') ? (reports || []) : [],
    analyses: canPortal('results') ? (analyses || []) : [],
    documents: (canPortal('results') || canPortal('payments')) ? (documents || []) : [],
    requests: canPortal('requests') ? (requests || []) : [],
    announcements: canPortal('announcements') ? (announcements || []) : [],
    files: canPortal('files') || canPortal('tasks') || canPortal('requests') ? (files || []) : [],
    comments: comments || []
  };
}

module.exports = async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const session = verifySession(req);
  if (!session) return res.status(401).json({ok:false,error:'Sesión requerida'});

  try {
    if (req.method === 'GET') {
      const requestedOrg = String(req.query?.organization_id || '').trim();
      const orgId = isPlatformAdmin(session) && requestedOrg ? requestedOrg : session.organization_id;
      if (!orgId) return res.status(403).json({ok:false,error:'Workspace no disponible'});
      if (!isPlatformAdmin(session) && !['client','owner','admin'].includes(session.role)) {
        return res.status(403).json({ok:false,error:'Este usuario no tiene acceso al portal de cliente'});
      }
      return res.status(200).json(await portalPayload(orgId));
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '').trim();

      if (action === 'create_request') {
        const orgId = resolveOrgId(session, req.body);
        if (!orgId) return res.status(403).json({ok:false,error:'Workspace no disponible'});
        const perm = await portalPermission(orgId,'requests');
        const client = perm.client;
        if (!client?.id) return res.status(404).json({ok:false,error:'Perfil de cliente no configurado'});
        if (!isPlatformAdmin(session) && !perm.allowed) return res.status(403).json({ok:false,error:'Solicitudes no habilitadas para esta cuenta'});
        const rows = await sb('client_requests',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
          client_id:client.id,organization_id:orgId,
          created_by_role:isPlatformAdmin(session)?'host':(session.role||'client'),
          created_by_name:session.email||null,
          request_type:['error','change','request','content','campaign','other'].includes(req.body?.request_type)?req.body.request_type:'other',
          title:String(req.body?.title||'').trim()||'Nueva solicitud',
          description:String(req.body?.description||'').trim()||null,
          priority:['low','normal','high','urgent'].includes(req.body?.priority)?req.body.priority:'normal',
          status:'pending'
        })});
        return res.status(200).json({ok:true,request:rows?.[0]||null});
      }

      if (action === 'create_task') {
        const orgId = resolveOrgId(session, req.body);
        if (!orgId) return res.status(403).json({ok:false,error:'Workspace no disponible'});
        const perm = await portalPermission(orgId,'tasks');
        const client = perm.client;
        if (!client?.id) return res.status(404).json({ok:false,error:'Perfil de cliente no configurado'});
        if (!isPlatformAdmin(session) && !perm.allowed) return res.status(403).json({ok:false,error:'Tareas no habilitadas para esta cuenta'});
        const title=String(req.body?.title||'').trim();
        if(!title) return res.status(400).json({ok:false,error:'Título requerido'});
        const role=isPlatformAdmin(session)?'host':(session.role||'client');
        const rows=await sb('crm_tasks',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
          organization_id:orgId,
          title,
          description:String(req.body?.description||'').trim()||null,
          due_at:req.body?.due_at||null,
          status:'pending',
          priority:['low','normal','high','urgent'].includes(req.body?.priority)?req.body.priority:'normal',
          task_type:'client_portal',
          auto_generated:false,
          is_test:false,
          metadata:{
            portal_visible:true,
            client_id:client.id,
            service_key:String(req.body?.service_key||'').trim()||null,
            created_by_role:role,
            created_by_name:session.email||null
          }
        })});
        return res.status(200).json({ok:true,task:rows?.[0]||null});
      }

      if (action === 'set_task_status') {
        const orgId = resolveOrgId(session, req.body);
        const client = await clientForOrg(orgId);
        const taskId=String(req.body?.task_id||'').trim();
        if(!taskId || !await entityBelongsToClient('task',taskId,client,orgId)) return res.status(404).json({ok:false,error:'Tarea no encontrada'});
        const status=['pending','in_progress','waiting_client','review','completed'].includes(req.body?.status)?req.body.status:null;
        if(!status) return res.status(400).json({ok:false,error:'Estado no válido'});
        const body={status,updated_at:new Date().toISOString()};
        if(status==='completed') body.completed_at=new Date().toISOString();
        const rows=await sb(`crm_tasks?id=eq.${encodeURIComponent(taskId)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(body)});
        return res.status(200).json({ok:true,task:rows?.[0]||null});
      }

      if (action === 'add_comment') {
        const orgId = resolveOrgId(session, req.body);
        const client = await clientForOrg(orgId);
        const entityType=['task','request','announcement'].includes(req.body?.entity_type)?req.body.entity_type:'';
        const entityId=String(req.body?.entity_id||'').trim();
        const body=String(req.body?.body||'').trim();
        const moduleKey=entityType==='task'?'tasks':entityType==='request'?'requests':'announcements';
        const perm=await portalPermission(orgId,moduleKey);
        if (!isPlatformAdmin(session) && !perm.allowed) return res.status(403).json({ok:false,error:'Módulo no habilitado para esta cuenta'});
        if(!entityType||!entityId||!body) return res.status(400).json({ok:false,error:'Comentario incompleto'});
        if(!await entityBelongsToClient(entityType,entityId,client,orgId)) return res.status(404).json({ok:false,error:'Elemento no encontrado'});
        const rows=await sb('client_comments',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
          client_id:client.id,organization_id:orgId,entity_type:entityType,entity_id:entityId,body,
          created_by_role:isPlatformAdmin(session)?'host':(session.role||'client'),
          created_by_name:session.email||null
        })});
        return res.status(200).json({ok:true,comment:rows?.[0]||null});
      }

      if (action === 'upload_file') {
        const orgId = resolveOrgId(session, req.body);
        if (!orgId) return res.status(403).json({ok:false,error:'Workspace no disponible'});
        const client = await clientForOrg(orgId);
        if (!client?.id) return res.status(404).json({ok:false,error:'Perfil de cliente no configurado'});
        if (!isPlatformAdmin(session)) {
          const p=client.portal_settings||{};
          const allowed = p.files !== false || (req.body?.task_id && p.tasks !== false) || (req.body?.request_id && p.requests !== false);
          if(!allowed) return res.status(403).json({ok:false,error:'Carga de archivos no habilitada para esta cuenta'});
        }
        const fileName=String(req.body?.file_name||'archivo').replace(/[^a-zA-Z0-9._-]/g,'_');
        const mime=String(req.body?.mime_type||'application/octet-stream');
        const raw=String(req.body?.file_base64||'');
        if(!raw) return res.status(400).json({ok:false,error:'Archivo requerido'});
        const buffer=Buffer.from(raw,'base64');
        if(buffer.length>10485760) return res.status(400).json({ok:false,error:'El archivo supera 10 MB'});
        const path=`${client.id}/${Date.now()}-${fileName}`;
        const up=await fetch(`${SUPABASE_URL}/storage/v1/object/client-files/${path}`,{
          method:'POST',
          headers:{apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':mime,'x-upsert':'false'},
          body:buffer
        });
        if(!up.ok) throw new Error('No fue posible cargar el archivo');
        const fileUrl=`${SUPABASE_URL}/storage/v1/object/public/client-files/${path}`;
        const rows=await sb('client_files',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
          client_id:client.id,organization_id:orgId,
          request_id:req.body?.request_id||null,
          task_id:req.body?.task_id||null,
          file_name:fileName,file_url:fileUrl,file_type:mime,
          uploaded_by_role:isPlatformAdmin(session)?'host':(session.role||'client'),
          uploaded_by_name:session.email||null
        })});
        return res.status(200).json({ok:true,file:rows?.[0]||null});
      }

      if (!isPlatformAdmin(session)) return res.status(403).json({ok:false,error:'Solo el Host puede configurar el portal del cliente'});

      if (action === 'create_announcement') {
        const orgId=String(req.body?.organization_id||'').trim();
        const client=await clientForOrg(orgId);
        if(!client?.id) return res.status(404).json({ok:false,error:'Perfil de cliente no configurado'});
        const title=String(req.body?.title||'').trim(),body=String(req.body?.body||'').trim();
        if(!title||!body) return res.status(400).json({ok:false,error:'Título y mensaje requeridos'});
        const rows=await sb('client_announcements',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
          client_id:client.id,organization_id:orgId,title,body,visible_to_client:true,created_by:session.email||'Segmenta'
        })});
        return res.status(200).json({ok:true,announcement:rows?.[0]||null});
      }

      if (action === 'upsert_profile') {
        const organizationId = String(req.body?.organization_id || '').trim();
        const org = await orgById(organizationId);
        if (!org) return res.status(404).json({ok:false,error:'Empresa no encontrada'});
        const existing = await clientForOrg(organizationId);
        const body = {
          organization_id: organizationId,
          name: String(req.body?.name || org.name).trim() || org.name,
          sector: String(req.body?.sector || '').trim() || null,
          plan: ['basico','estandar','premium'].includes(req.body?.plan) ? req.body.plan : 'estandar',
          monthly_fee: Number(req.body?.monthly_fee || 0),
          status: ['active','expiring','inactive'].includes(req.body?.status) ? req.body.status : 'active',
          contact_name: String(req.body?.contact_name || '').trim() || null,
          contact_email: String(req.body?.contact_email || '').trim() || null,
          contact_phone: String(req.body?.contact_phone || '').trim() || null,
          next_payment_date: req.body?.next_payment_date || null,
          dashboard_url: String(req.body?.dashboard_url || '').trim() || null,
          payment_status: ['current','due_soon','overdue','courtesy','tbd','paid'].includes(req.body?.payment_status) ? req.body.payment_status : 'current',
          payment_method_label: String(req.body?.payment_method_label || '').trim() || null,
          portal_settings: {
            services: req.body?.portal_settings?.services !== false,
            results: req.body?.portal_settings?.results !== false,
            tasks: req.body?.portal_settings?.tasks !== false,
            requests: req.body?.portal_settings?.requests !== false,
            files: req.body?.portal_settings?.files !== false,
            announcements: req.body?.portal_settings?.announcements !== false,
            payments: req.body?.portal_settings?.payments !== false,
            crm: req.body?.portal_settings?.crm === true,
            reports: req.body?.portal_settings?.reports !== false
          },
          updated_at: new Date().toISOString()
        };
        let rows;
        if (existing?.id) {
          rows = await sb(`clients?id=eq.${existing.id}`, {method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(body)});
        } else {
          rows = await sb('clients', {method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body)});
        }
        return res.status(200).json({ok:true,client:rows?.[0]||null});
      }

      if (action === 'save_services') {
        const clientId = String(req.body?.client_id || '').trim();
        if (!clientId) return res.status(400).json({ok:false,error:'Cliente requerido'});
        const requested = Array.isArray(req.body?.services) ? req.body.services : [];
        const allowedKeys = new Set(SERVICE_CATALOG.map(x => x.key));
        const existingRows = await sb(`client_services?client_id=eq.${encodeURIComponent(clientId)}&select=service_key,metadata`);
        const existingMetadata = Object.fromEntries((existingRows || []).map(x => [x.service_key, x.metadata || {}]));
        const now = new Date().toISOString();
        const rows = [];
        for (const item of requested) {
          const key = String(item?.service_key || '').trim();
          if (!allowedKeys.has(key)) continue;
          const catalog = SERVICE_CATALOG.find(x => x.key === key);
          rows.push({
            client_id: clientId,
            service_key: key,
            service_name: catalog.name,
            active_in_plan: !!item.active_in_plan,
            client_visible: !!item.client_visible,
            status: ['inactive','setup','active','paused','waiting_client','under_construction','review','published','completed'].includes(item.status) ? item.status : 'inactive',
            plan_label: String(item.plan_label || '').trim() || null,
            notes: String(item.notes || '').trim() || null,
            metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : (existingMetadata[key] || {}),
            updated_at: now
          });
        }
        if (rows.length) {
          await sb('client_services?on_conflict=client_id,service_key', {
            method:'POST',
            headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
            body:JSON.stringify(rows)
          });
        }
        return res.status(200).json({ok:true,services:rows});
      }

      if (action === 'publish_analysis') {
        const clientId=String(req.body?.client_id||'');
        const rows=await sb('client_analyses',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
          client_id:clientId,title:String(req.body?.title||'').trim(),body:String(req.body?.body||'').trim(),published_at:new Date().toISOString()
        })});
        return res.status(200).json({ok:true,analysis:rows?.[0]||null});
      }

      if (action === 'add_document') {
        const rows=await sb('client_documents',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
          client_id:String(req.body?.client_id||''),
          document_type:['report','invoice','receipt','other'].includes(req.body?.document_type)?req.body.document_type:'report',
          name:String(req.body?.name||'').trim(),
          document_date:req.body?.document_date||null,
          url:String(req.body?.url||'').trim()||null
        })});
        return res.status(200).json({ok:true,document:rows?.[0]||null});
      }

      return res.status(400).json({ok:false,error:'Acción no válida'});
    }

    res.setHeader('Allow','GET, POST');
    return res.status(405).json({ok:false,error:'Method not allowed'});
  } catch(error) {
    console.error('CLIENT_PORTAL_ERROR',error.message);
    return res.status(500).json({ok:false,error:'No fue posible cargar el portal del cliente'});
  }
};

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
  { key:'crm', name:'CRM' },
  { key:'tasks', name:'Tareas' },
  { key:'integrations', name:'Integraciones / Automatización' },
  { key:'web_landing', name:'Web / Landing Pages' },
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

async function portalPayload(orgId) {
  const org = await orgById(orgId);
  if (!org) throw new Error('Workspace no encontrado');
  const client = await clientForOrg(orgId);

  const [opps, orders] = await Promise.all([
    sb(`crm_opportunities?organization_id=eq.${orgId}&is_test=eq.false&select=id,title,stage,status,value,product,city,source,created_at,updated_at&order=updated_at.desc&limit=100`),
    sb(`crm_orders?organization_id=eq.${orgId}&is_test=eq.false&select=id,order_number,total,payment_status,status,created_at&order=created_at.desc&limit=100`)
  ]);

  let reports=[],analyses=[],documents=[],services=[];
  if (client?.id) {
    [reports, analyses, documents, services] = await Promise.all([
      sb(`weekly_reports?client_id=eq.${client.id}&select=*&order=created_at.desc&limit=24`),
      sb(`client_analyses?client_id=eq.${client.id}&select=*&order=published_at.desc&limit=50`),
      sb(`client_documents?client_id=eq.${client.id}&select=*&order=document_date.desc.nullslast,created_at.desc&limit=100`),
      sb(`client_services?client_id=eq.${client.id}&select=*&order=service_name.asc`)
    ]);
  }
  const serviceMap = Object.fromEntries((services || []).map(x => [x.service_key, x]));
  services = defaultServices().map(x => ({ ...x, ...(serviceMap[x.service_key] || {}) }));

  const open = (opps || []).filter(x => x.status === 'open');
  const won = (opps || []).filter(x => x.status === 'won' || x.stage === 'won');
  const paidOrders = (orders || []).filter(x => x.payment_status === 'paid');
  return {
    ok: true,
    organization: org,
    client,
    portal_settings: client?.portal_settings || {},
    services,
    summary: {
      opportunities_open: open.length,
      pipeline_value: open.reduce((s,x)=>s+Number(x.value||0),0),
      opportunities_won: won.length,
      won_value: won.reduce((s,x)=>s+Number(x.value||0),0),
      orders_paid: paidOrders.length,
      paid_value: paidOrders.reduce((s,x)=>s+Number(x.total||0),0)
    },
    opportunities: opps || [],
    weekly_reports: reports || [],
    analyses: analyses || [],
    documents: documents || []
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
      if (!isPlatformAdmin(session)) return res.status(403).json({ok:false,error:'Solo el Host puede configurar el portal del cliente'});
      const action = String(req.body?.action || '').trim();

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
          payment_status: ['current','due_soon','overdue'].includes(req.body?.payment_status) ? req.body.payment_status : 'current',
          payment_method_label: String(req.body?.payment_method_label || '').trim() || null,
          portal_settings: {
            results: req.body?.portal_settings?.results !== false,
            crm: req.body?.portal_settings?.crm !== false,
            payments: req.body?.portal_settings?.payments !== false,
            reports: req.body?.portal_settings?.reports !== false
          },
          updated_at: new Date().toISOString()
        };
        let rows;
        if (existing?.id) {
          rows = await sb(`clients?id=eq.${existing.id}`, {
            method:'PATCH',
            headers:{Prefer:'return=representation'},
            body:JSON.stringify(body)
          });
        } else {
          rows = await sb('clients', {
            method:'POST',
            headers:{Prefer:'return=representation'},
            body:JSON.stringify(body)
          });
        }
        return res.status(200).json({ok:true,client:rows?.[0]||null});
      }

      if (action === 'save_services') {
        const clientId = String(req.body?.client_id || '').trim();
        if (!clientId) return res.status(400).json({ok:false,error:'Cliente requerido'});
        const requested = Array.isArray(req.body?.services) ? req.body.services : [];
        const allowedKeys = new Set(SERVICE_CATALOG.map(x => x.key));
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
            status: ['inactive','setup','active','paused','waiting_client'].includes(item.status) ? item.status : 'inactive',
            plan_label: String(item.plan_label || '').trim() || null,
            notes: String(item.notes || '').trim() || null,
            metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
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
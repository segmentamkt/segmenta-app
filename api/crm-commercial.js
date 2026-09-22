const { verifySession, isPlatformAdmin, isOrgOwner, hasModuleAccess } = require('./_crm-session');

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

function clean(value, max = 1000) {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, max) : null;
}
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}
async function resolveOwner(orgId, session, requestedOwner) {
  if (requestedOwner && isUuid(requestedOwner)) return requestedOwner;
  if (isUuid(session?.sub) && !isPlatformAdmin(session)) return session.sub;
  const rows = await sb(`crm_memberships?organization_id=eq.${orgId}&status=eq.active&role=in.(owner,sales,agent,admin)&select=user_id,role&order=is_default.desc,created_at.asc&limit=1`);
  return rows?.[0]?.user_id || null;
}
function canManageOrders(session) {
  return isPlatformAdmin(session) || isOrgOwner(session) || ['admin','inventory'].includes(session?.role);
}
function canDeleteSensitive(session) {
  return isPlatformAdmin(session) || isOrgOwner(session) || session?.role === 'admin';
}
async function organizationForSession(session) {
  if (!session?.organization_id) return null;
  const rows = await sb(`crm_organizations?id=eq.${encodeURIComponent(session.organization_id)}&status=eq.active&select=id,name,slug&limit=1`);
  return rows?.[0] || null;
}
async function audit(session, orgId, action, entityType, entityId, beforeData = null, afterData = null, metadata = {}) {
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
        before_data: beforeData,
        after_data: afterData,
        metadata
      })
    });
  } catch (e) {
    console.warn('CRM_AUDIT_ERROR', e.message);
  }
}
function sequenceCode(prefix) {
  const d = new Date();
  const stamp = d.toISOString().slice(0,10).replaceAll('-','');
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
}

async function scopedOne(table, id, orgId, select='*') {
  const rows = await sb(`${table}?id=eq.${encodeURIComponent(id)}&organization_id=eq.${orgId}&select=${encodeURIComponent(select)}&limit=1`);
  return rows?.[0] || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const session = verifySession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'CRM session required' });

  try {
    const org = await organizationForSession(session);
    if (!org) return res.status(403).json({ ok: false, error: 'No active organization in session' });
    const orgId = org.id;

    if (req.method === 'GET') {
      const type = String(req.query?.type || 'dashboard');
      const moduleByType = {
        dashboard: 'dashboard',
        contacts: 'contacts',
        opportunities: 'crm',
        quotes: 'quotes',
        orders: 'orders',
        tasks: 'tasks',
        audit: 'settings'
      };
      const requestedModule = moduleByType[type];
      if (requestedModule && !hasModuleAccess(session, requestedModule, 'read')) {
        return res.status(403).json({ ok: false, error: 'No tienes acceso a este módulo' });
      }

      if (type === 'dashboard') {
        const [opps, quotes, orders, tasks] = await Promise.all([
          sb(`crm_opportunities?organization_id=eq.${orgId}&select=id,status,stage,value,cap_status,owner_user_id,created_at`),
          sb(`crm_quotes?organization_id=eq.${orgId}&select=id,status,total,created_at`),
          sb(`crm_orders?organization_id=eq.${orgId}&status=neq.deleted&select=id,status,total,payment_status,fulfillment_status,created_at`),
          sb(`crm_tasks?organization_id=eq.${orgId}&status=in.(pending,in_progress)&select=id,status,priority,due_at`)
        ]);
        const openOpps = (opps || []).filter(x => x.status === 'open');
        return res.status(200).json({
          ok: true,
          organization: org,
          metrics: {
            opportunities: openOpps.length,
            pipeline_value: openOpps.reduce((s,x)=>s+num(x.value),0),
            quotes_open: (quotes || []).filter(x=>!['rejected','expired','converted'].includes(x.status)).length,
            orders_active: (orders || []).filter(x=>x.status==='active').length,
            tasks_open: (tasks || []).length,
            won_value: (opps || []).filter(x=>x.status==='won').reduce((s,x)=>s+num(x.value),0)
          },
          stage_counts: Object.entries((opps || []).reduce((a,x)=>{a[x.stage]=(a[x.stage]||0)+1;return a},{})).map(([stage,count])=>({stage,count}))
        });
      }

      if (type === 'contacts') {
        const rows = await sb(`crm_contacts?organization_id=eq.${orgId}&select=id,display_name,phone,email,metadata,created_at,updated_at,channel:crm_channels(id,channel_type,external_account_name)&order=updated_at.desc`);
        return res.status(200).json({ ok: true, contacts: rows || [] });
      }

      if (type === 'opportunities') {
        const rows = await sb(`crm_opportunities?organization_id=eq.${orgId}&select=*,contact:crm_contacts(id,display_name,phone,email,metadata),conversation:crm_conversations(id),cap:crm_cap(*)&order=updated_at.desc`);
        return res.status(200).json({ ok: true, opportunities: rows || [] });
      }
      if (type === 'quotes') {
        const rows = await sb(`crm_quotes?organization_id=eq.${orgId}&select=*,contact:crm_contacts(id,display_name,phone,email),items:crm_quote_items(*)&order=created_at.desc`);
        return res.status(200).json({ ok: true, quotes: rows || [] });
      }
      if (type === 'orders') {
        const rows = await sb(`crm_orders?organization_id=eq.${orgId}&status=neq.deleted&select=*,contact:crm_contacts(id,display_name,phone,email),items:crm_order_items(*)&order=created_at.desc`);
        return res.status(200).json({ ok: true, orders: rows || [] });
      }
      if (type === 'tasks') {
        const rows = await sb(`crm_tasks?organization_id=eq.${orgId}&select=*,contact:crm_contacts(id,display_name),opportunity:crm_opportunities(id,title)&order=due_at.asc.nullslast,created_at.desc`);
        return res.status(200).json({ ok: true, tasks: rows || [] });
      }
      if (type === 'audit') {
        if (!canDeleteSensitive(session)) return res.status(403).json({ ok: false, error: 'Solo administradores' });
        const rows = await sb(`crm_audit_log?organization_id=eq.${orgId}&select=*&order=created_at.desc&limit=200`);
        return res.status(200).json({ ok: true, audit: rows || [] });
      }
      return res.status(400).json({ ok: false, error: 'Unknown type' });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '');
      const postAccess = {
        create_opportunity: ['crm','create'],
        create_quote: ['quotes','create'],
        convert_quote_to_order: ['orders','create'],
        create_task: ['tasks','create'],
        reset_cap: ['cap','edit']
      }[action];
      if (postAccess && !hasModuleAccess(session, postAccess[0], postAccess[1])) {
        return res.status(403).json({ ok: false, error: 'No tienes permiso para realizar esta acción' });
      }

      if (action === 'create_opportunity') {
        const title = clean(req.body?.title, 300);
        if (!title) return res.status(400).json({ ok:false, error:'Título requerido' });

        const ownerUserId = await resolveOwner(orgId, session, req.body?.owner_user_id);
        if (!ownerUserId) return res.status(409).json({ok:false,error:'Todo lead activo debe tener un vendedor responsable.'});

        const priority = ['P1','P2','P3'].includes(String(req.body?.priority || '').toUpperCase())
          ? String(req.body.priority).toUpperCase()
          : 'P3';
        const dueAt = req.body?.next_follow_up_at || new Date(Date.now() + 15 * 60000).toISOString();

        const rows = await sb('crm_opportunities', {
          method:'POST', headers:{Prefer:'return=representation'},
          body:JSON.stringify({
            organization_id:orgId,
            contact_id:req.body?.contact_id || null,
            conversation_id:req.body?.conversation_id || null,
            owner_user_id:ownerUserId,
            title,
            stage:'new',
            priority,
            value:num(req.body?.value),
            currency:clean(req.body?.currency,10) || 'COP',
            product:clean(req.body?.product,300),
            quantity:req.body?.quantity !== undefined && req.body?.quantity !== '' ? num(req.body.quantity) : null,
            city:clean(req.body?.city,200),
            usage_type:clean(req.body?.usage_type,80),
            urgency:clean(req.body?.urgency,80),
            budget:req.body?.budget !== undefined && req.body?.budget !== '' ? num(req.body.budget) : null,
            address:clean(req.body?.address,500),
            notes:clean(req.body?.notes,5000),
            next_follow_up_at:dueAt,
            source:clean(req.body?.source,200),
            campaign:clean(req.body?.campaign,300),
            adset:clean(req.body?.adset,300),
            ad:clean(req.body?.ad,300),
            cap_status:'active',
            status:'open',
            created_by:isUuid(session.sub) ? session.sub : null
          })
        });
        const opp = rows?.[0];
        if (opp) {
          await sb('crm_cap',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
            organization_id:orgId, opportunity_id:opp.id, contact_id:opp.contact_id,
            status:'active', step:'contact_client', next_action:'Contactar cliente', next_action_at:dueAt, sequence:0
          })});
          await sb('crm_tasks',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
            organization_id:orgId,
            contact_id:opp.contact_id,
            opportunity_id:opp.id,
            assigned_user_id:ownerUserId,
            title:'Contactar cliente',
            description:'Primera acción obligatoria del motor comercial.',
            due_at:dueAt,
            status:'pending',
            priority:priority==='P1'?'high':priority==='P2'?'normal':'low',
            task_type:'contact_client',
            sla_minutes:15,
            sequence:0,
            auto_generated:true,
            automation_key:`execution:${opp.id}:contact_client:0`,
            created_by:isUuid(session.sub) ? session.sub : null,
            metadata:{source:'execution_engine_v1'}
          })});
          await audit(session,orgId,'opportunity.created','opportunity',opp.id,null,opp,{rule_of_gold:true});
        }
        return res.status(201).json({ok:true,opportunity:opp});
      }

      if (action === 'create_quote') {
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        if (!items.length) return res.status(400).json({ok:false,error:'Agrega al menos un producto'});
        const subtotal = items.reduce((s,i)=>s+Math.max(0,num(i.quantity))*Math.max(0,num(i.unit_price)),0);
        const discount = Math.max(0,num(req.body?.discount));
        const shipping = Math.max(0,num(req.body?.shipping_cost));
        const total = Math.max(0,subtotal-discount+shipping);
        const quoteRows = await sb('crm_quotes',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
          organization_id:orgId,contact_id:req.body?.contact_id||null,opportunity_id:req.body?.opportunity_id||null,
          quote_number:sequenceCode('COT'),status:'draft',currency:clean(req.body?.currency,10)||'COP',
          subtotal,discount,shipping_cost:shipping,total,observations:clean(req.body?.observations,5000),
          valid_until:req.body?.valid_until||null,created_by:session.sub!=='legacy-superadmin'?session.sub:null
        })});
        const quote=quoteRows?.[0];
        if (quote) {
          const payload=items.map(i=>({
            organization_id:orgId,quote_id:quote.id,product_id:clean(i.product_id,200),
            description:clean(i.description,500)||'Producto',quantity:Math.max(.001,num(i.quantity)||1),
            unit_price:Math.max(0,num(i.unit_price)),discount:Math.max(0,num(i.discount)),
            line_total:Math.max(0,(num(i.quantity)||1)*num(i.unit_price)-num(i.discount)),metadata:i.metadata||{}
          }));
          await sb('crm_quote_items',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(payload)});
          await audit(session,orgId,'quote.created','quote',quote.id,null,quote);
        }
        return res.status(201).json({ok:true,quote});
      }

      if (action === 'convert_quote_to_order') {
        if (!canManageOrders(session)) return res.status(403).json({ok:false,error:'Rol sin permiso para pedidos'});
        const quote = await scopedOne('crm_quotes',req.body?.quote_id,orgId,'*,items:crm_quote_items(*)');
        if (!quote) return res.status(404).json({ok:false,error:'Cotización no encontrada'});
        const orderRows=await sb('crm_orders',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
          organization_id:orgId,contact_id:quote.contact_id,opportunity_id:quote.opportunity_id,quote_id:quote.id,
          order_number:sequenceCode('PED'),currency:quote.currency,subtotal:quote.subtotal,shipping_cost:quote.shipping_cost,total:quote.total,
          payment_status:'pending',fulfillment_status:'pending',status:'active',
          created_by:session.sub!=='legacy-superadmin'?session.sub:null
        })});
        const order=orderRows?.[0];
        if(order && quote.items?.length){
          await sb('crm_order_items',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(quote.items.map(i=>({
            organization_id:orgId,order_id:order.id,product_id:i.product_id,description:i.description,quantity:i.quantity,unit_price:i.unit_price,line_total:i.line_total,metadata:i.metadata||{}
          })))});
          await sb(`crm_quotes?id=eq.${quote.id}&organization_id=eq.${orgId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'converted',converted_order_id:order.id,updated_at:new Date().toISOString()})});
          await audit(session,orgId,'quote.converted_to_order','quote',quote.id,quote,{order_id:order.id});
          await audit(session,orgId,'order.created','order',order.id,null,order,{source_quote_id:quote.id});
        }
        return res.status(201).json({ok:true,order});
      }

      if(action === 'create_task'){
        const title=clean(req.body?.title,500);
        if(!title)return res.status(400).json({ok:false,error:'Título requerido'});
        const rows=await sb('crm_tasks',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
          organization_id:orgId,contact_id:req.body?.contact_id||null,opportunity_id:req.body?.opportunity_id||null,
          assigned_user_id:req.body?.assigned_user_id||null,title,description:clean(req.body?.description,5000),
          due_at:req.body?.due_at||null,status:'pending',priority:clean(req.body?.priority,20)||'normal',
          created_by:session.sub!=='legacy-superadmin'?session.sub:null
        })});
        const task=rows?.[0]; if(task)await audit(session,orgId,'task.created','task',task.id,null,task);
        return res.status(201).json({ok:true,task});
      }

      if(action === 'reset_cap'){
        const opp=await scopedOne('crm_opportunities',req.body?.opportunity_id,orgId);
        if(!opp)return res.status(404).json({ok:false,error:'Oportunidad no encontrada'});
        const capRows=await sb(`crm_cap?opportunity_id=eq.${opp.id}&organization_id=eq.${orgId}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({
          status:'active',step:'inicio',decision:null,label:null,next_action:null,next_action_at:null,sequence:0,closed_at:null,
          reset_count:num(req.body?.reset_count)+1,last_reset_reason:clean(req.body?.reason,300)||'manual',updated_at:new Date().toISOString()
        })});
        await audit(session,orgId,'cap.reset','opportunity',opp.id,null,capRows?.[0]||null,{reason:req.body?.reason||'manual'});
        return res.status(200).json({ok:true,cap:capRows?.[0]||null});
      }

      return res.status(400).json({ok:false,error:'Acción no válida'});
    }

    if (req.method === 'PATCH') {
      const action=String(req.body?.action||'');
      const patchAccess = {
        update_opportunity: ['crm','edit'],
        update_cap: ['cap','edit'],
        update_order: ['orders','edit'],
        cancel_order: ['orders','cancel'],
        update_task: ['tasks','edit']
      }[action];
      if (patchAccess && !hasModuleAccess(session, patchAccess[0], patchAccess[1])) {
        return res.status(403).json({ ok: false, error: 'No tienes permiso para realizar esta acción' });
      }

      if(action==='update_opportunity'){
        const id=String(req.body?.id||'');
        const before=await scopedOne('crm_opportunities',id,orgId);
        if(!before)return res.status(404).json({ok:false,error:'Oportunidad no encontrada'});
        if(req.body?.stage!==undefined && clean(req.body.stage,80)!==before.stage){
          return res.status(409).json({ok:false,error:'La etapa se mueve al completar la tarea comercial obligatoria, no manualmente.'});
        }
        if(req.body?.status!==undefined && clean(req.body.status,80)!==before.status){
          return res.status(409).json({ok:false,error:'El cierre debe realizarse mediante la tarea de cierre correspondiente.'});
        }
        const patch={updated_at:new Date().toISOString()};
        for(const k of ['title','product','city','address','notes','source','usage_type','urgency','lost_reason','lost_reason_note','payment_method','campaign','adset','ad']) if(req.body?.[k]!==undefined) patch[k]=clean(req.body[k],k==='notes'?5000:500);
        if(req.body?.value!==undefined)patch.value=num(req.body.value);
        if(req.body?.quantity!==undefined)patch.quantity=req.body.quantity===''?null:num(req.body.quantity);
        if(req.body?.budget!==undefined)patch.budget=req.body.budget===''?null:num(req.body.budget);
        if(req.body?.priority!==undefined){
          const p=String(req.body.priority||'').toUpperCase();
          if(!['P1','P2','P3'].includes(p))return res.status(400).json({ok:false,error:'Prioridad inválida'});
          patch.priority=p;
        }
        if(req.body?.next_follow_up_at!==undefined && !req.body.next_follow_up_at){
          return res.status(409).json({ok:false,error:'Un lead activo no puede quedar sin fecha de próxima acción.'});
        }
        if(req.body?.next_follow_up_at!==undefined)patch.next_follow_up_at=req.body.next_follow_up_at;
        if(req.body?.owner_user_id!==undefined){
          if(!req.body.owner_user_id)return res.status(409).json({ok:false,error:'Un lead activo no puede quedar sin vendedor responsable.'});
          patch.owner_user_id=req.body.owner_user_id;
        }
        const rows=await sb(`crm_opportunities?id=eq.${id}&organization_id=eq.${orgId}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
        await audit(session,orgId,'opportunity.updated','opportunity',id,before,rows?.[0]||null);
        return res.status(200).json({ok:true,opportunity:rows?.[0]||null});
      }

      if(action==='update_cap'){
        const oppId=String(req.body?.opportunity_id||'');
        const opp=await scopedOne('crm_opportunities',oppId,orgId);
        if(!opp)return res.status(404).json({ok:false,error:'Oportunidad no encontrada'});
        const beforeRows=await sb(`crm_cap?opportunity_id=eq.${oppId}&organization_id=eq.${orgId}&select=*&limit=1`);
        const patch={updated_at:new Date().toISOString()};
        for(const k of ['status','step','decision','label','next_action','last_reset_reason']) if(req.body?.[k]!==undefined)patch[k]=clean(req.body[k],500);
        if(req.body?.next_action_at!==undefined)patch.next_action_at=req.body.next_action_at||null;
        if(req.body?.sequence!==undefined)patch.sequence=Math.max(0,parseInt(req.body.sequence)||0);
        if(req.body?.closed_at!==undefined)patch.closed_at=req.body.closed_at||null;
        const rows=await sb(`crm_cap?opportunity_id=eq.${oppId}&organization_id=eq.${orgId}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
        if(patch.status)await sb(`crm_opportunities?id=eq.${oppId}&organization_id=eq.${orgId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({cap_status:patch.status,updated_at:new Date().toISOString()})});
        await audit(session,orgId,'cap.updated','opportunity',oppId,beforeRows?.[0]||null,rows?.[0]||null);
        return res.status(200).json({ok:true,cap:rows?.[0]||null});
      }

      if(action==='update_order'){
        if(!canManageOrders(session))return res.status(403).json({ok:false,error:'Rol sin permiso para pedidos'});
        const id=String(req.body?.id||'');
        const before=await scopedOne('crm_orders',id,orgId);
        if(!before)return res.status(404).json({ok:false,error:'Pedido no encontrado'});
        const patch={updated_at:new Date().toISOString()};
        for(const k of ['payment_status','fulfillment_status','tracking_number','shipping_provider','shipping_status','notes'])if(req.body?.[k]!==undefined)patch[k]=clean(req.body[k],k==='notes'?5000:500);
        const rows=await sb(`crm_orders?id=eq.${id}&organization_id=eq.${orgId}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
        await audit(session,orgId,'order.updated','order',id,before,rows?.[0]||null);
        return res.status(200).json({ok:true,order:rows?.[0]||null});
      }

      if(action==='cancel_order'){
        if(!canDeleteSensitive(session))return res.status(403).json({ok:false,error:'Solo administradores pueden anular pedidos'});
        const id=String(req.body?.id||'');
        const before=await scopedOne('crm_orders',id,orgId);
        if(!before)return res.status(404).json({ok:false,error:'Pedido no encontrado'});
        const patch={status:'cancelled',cancelled_at:new Date().toISOString(),cancelled_by:session.sub!=='legacy-superadmin'?session.sub:null,updated_at:new Date().toISOString()};
        const rows=await sb(`crm_orders?id=eq.${id}&organization_id=eq.${orgId}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
        await audit(session,orgId,'order.cancelled','order',id,before,rows?.[0]||null,{reason:clean(req.body?.reason,1000)});
        return res.status(200).json({ok:true,order:rows?.[0]||null});
      }

      if(action==='update_task'){
        const id=String(req.body?.id||'');
        const before=await scopedOne('crm_tasks',id,orgId);
        if(!before)return res.status(404).json({ok:false,error:'Tarea no encontrada'});
        const requestedStatus=clean(req.body?.status,50);
        if(['done','completed'].includes(requestedStatus)){
          return res.status(409).json({ok:false,error:'Las tareas comerciales se completan desde “Ejecutar tarea” para validar evidencia y generar la siguiente acción.'});
        }
        const patch={updated_at:new Date().toISOString()};
        for(const k of ['title','description','status','priority'])if(req.body?.[k]!==undefined)patch[k]=clean(req.body[k],k==='description'?5000:500);
        if(req.body?.due_at!==undefined)patch.due_at=req.body.due_at||null;
        const rows=await sb(`crm_tasks?id=eq.${id}&organization_id=eq.${orgId}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
        await audit(session,orgId,'task.updated','task',id,before,rows?.[0]||null);
        return res.status(200).json({ok:true,task:rows?.[0]||null});
      }

      return res.status(400).json({ok:false,error:'Acción no válida'});
    }

    if(req.method==='DELETE'){
      const type=String(req.query?.type||'');
      const id=String(req.query?.id||'');
      if(type==='order'){
        if(!hasModuleAccess(session,'orders','delete') || !canDeleteSensitive(session))return res.status(403).json({ok:false,error:'No tienes permiso para eliminar pedidos'});
        const before=await scopedOne('crm_orders',id,orgId);
        if(!before)return res.status(404).json({ok:false,error:'Pedido no encontrado'});
        if(before.tracking_number || !['pending','unpaid',''].includes(String(before.payment_status||''))){
          return res.status(409).json({ok:false,error:'Este pedido tiene guía o trazabilidad de pago. Debe anularse o archivarse, no borrarse.'});
        }
        const patch={status:'deleted',deleted_at:new Date().toISOString(),deleted_by:session.sub!=='legacy-superadmin'?session.sub:null,updated_at:new Date().toISOString()};
        await sb(`crm_orders?id=eq.${id}&organization_id=eq.${orgId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
        await audit(session,orgId,'order.deleted','order',id,before,patch);
        return res.status(200).json({ok:true});
      }
      return res.status(400).json({ok:false,error:'Tipo no válido'});
    }

    res.setHeader('Allow','GET, POST, PATCH, DELETE');
    return res.status(405).json({ok:false,error:'Method not allowed'});
  } catch (error) {
    console.error('CRM_COMMERCIAL_ERROR', error.message);
    return res.status(500).json({ok:false,error:'No fue posible completar la operación'});
  }
};

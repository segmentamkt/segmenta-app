const { verifySession, isPlatformAdmin, isOrgOwner } = require('./_crm-session');

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

function clean(v,max=1000){
  const s=String(v??'').trim();
  return s?s.slice(0,max):null;
}
function num(v){
  const n=Number(v);
  return Number.isFinite(n)?n:0;
}
function isUuid(v){
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));
}
function uid(){
  return crypto.randomUUID();
}
const crypto=require('crypto');

async function orgForSession(session){
  if(!session?.organization_id)return null;
  const rows=await sb(`crm_organizations?id=eq.${session.organization_id}&status=eq.active&select=id,name,slug&limit=1`);
  return rows?.[0]||null;
}
async function defaultOwner(orgId,session){
  if(isUuid(session?.sub) && !isPlatformAdmin(session))return session.sub;
  const rows=await sb(`crm_memberships?organization_id=eq.${orgId}&status=eq.active&role=in.(owner,sales,agent,admin)&select=user_id,role&order=is_default.desc,created_at.asc&limit=1`);
  return rows?.[0]?.user_id||null;
}
async function ensureQaChannel(orgId){
  const external='segmenta-qa-simulator';
  const rows=await sb('crm_channels?on_conflict=organization_id,channel_type,external_account_id',{
    method:'POST',
    headers:{Prefer:'resolution=merge-duplicates,return=representation'},
    body:JSON.stringify({
      organization_id:orgId,
      channel_type:'webchat',
      external_account_id:external,
      external_account_name:'Simulador QA',
      status:'connected',
      metadata:{source:'qa_simulator',test_mode:true},
      updated_at:new Date().toISOString()
    })
  });
  return rows?.[0]||null;
}
async function getRun(orgId,id){
  const rows=await sb(`crm_qa_runs?id=eq.${encodeURIComponent(id)}&organization_id=eq.${orgId}&select=*&limit=1`);
  return rows?.[0]||null;
}
async function loadRunBundle(orgId,run){
  if(!run)return null;
  const [contactRows,convRows,oppRows,tasks,messages,quotes,orders]=await Promise.all([
    run.contact_id?sb(`crm_contacts?id=eq.${run.contact_id}&organization_id=eq.${orgId}&select=*&limit=1`):[],
    run.conversation_id?sb(`crm_conversations?id=eq.${run.conversation_id}&organization_id=eq.${orgId}&select=*&limit=1`):[],
    run.opportunity_id?sb(`crm_opportunities?id=eq.${run.opportunity_id}&organization_id=eq.${orgId}&select=*,cap:crm_cap(*)&limit=1`):[],
    run.opportunity_id?sb(`crm_tasks?opportunity_id=eq.${run.opportunity_id}&organization_id=eq.${orgId}&select=*&order=created_at.asc`):[],
    run.conversation_id?sb(`crm_messages?conversation_id=eq.${run.conversation_id}&organization_id=eq.${orgId}&select=*&order=sent_at.asc`):[],
    run.opportunity_id?sb(`crm_quotes?opportunity_id=eq.${run.opportunity_id}&organization_id=eq.${orgId}&select=*&order=created_at.asc`):[],
    run.opportunity_id?sb(`crm_orders?opportunity_id=eq.${run.opportunity_id}&organization_id=eq.${orgId}&select=*&order=created_at.asc`):[]
  ]);
  const contact=contactRows?.[0]||null;
  const conversation=convRows?.[0]||null;
  const opportunity=oppRows?.[0]||null;
  const activeTask=(tasks||[]).find(x=>['pending','in_progress'].includes(x.status))||null;
  const checks={
    contact:Boolean(contact),
    conversation:Boolean(conversation),
    opportunity:Boolean(opportunity),
    owner:Boolean(opportunity?.owner_user_id),
    stage:Boolean(opportunity?.stage),
    priority:['P1','P2','P3'].includes(opportunity?.priority),
    cap:Boolean(Array.isArray(opportunity?.cap)?opportunity.cap[0]:opportunity?.cap),
    active_task:Boolean(activeTask),
    next_action:Boolean(activeTask?.due_at),
    messages:(messages||[]).length>0
  };
  return {run,contact,conversation,opportunity,tasks:tasks||[],active_task:activeTask,messages:messages||[],quotes:quotes||[],orders:orders||[],checks};
}
async function createRun(org,session,body){
  const owner=await defaultOwner(org.id,session);
  if(!owner)throw new Error('No hay un vendedor activo para asignar el lead de prueba.');
  const channel=await ensureQaChannel(org.id);
  if(!channel)throw new Error('No fue posible preparar el canal de simulación.');

  const runId=uid();
  const externalUserId=`qa-${runId}`;
  const name=clean(body?.name,200)||'Lead QA';
  const phone=clean(body?.phone,80)||'3000000000';
  const city=clean(body?.city,120)||'Bogotá';
  const product=clean(body?.product,240)||'Producto de prueba';
  const usage=clean(body?.usage_type,80)||'uso_propio';
  const urgency=clean(body?.urgency,80)||'esta_semana';
  const source='Simulador QA';
  const priority=['P1','P2','P3'].includes(String(body?.priority||'').toUpperCase())?String(body.priority).toUpperCase():'P1';
  const quantity=Math.max(1,num(body?.quantity)||1);
  const value=Math.max(0,num(body?.value));
  const initialMessage=clean(body?.initial_message,2000)||`Hola, estoy interesado en ${product}. ¿Me puedes ayudar?`;
  const now=new Date().toISOString();
  const due=new Date(Date.now()+15*60000).toISOString();

  const contacts=await sb('crm_contacts',{
    method:'POST',headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      organization_id:org.id,channel_id:channel.id,external_user_id:externalUserId,
      display_name:name,phone,email:clean(body?.email,320),is_test:true,
      metadata:{test_mode:true,qa_run_id:runId,business:'Lead simulado',city,source,interest:product,lead_status:'nuevo',notes:'Generado por el simulador QA'},
      updated_at:now
    })
  });
  const contact=contacts?.[0];

  const convs=await sb('crm_conversations',{
    method:'POST',headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      organization_id:org.id,channel_id:channel.id,contact_id:contact.id,
      external_thread_id:`qa-thread-${runId}`,status:'open',unread_count:1,last_message_at:now,is_test:true,updated_at:now
    })
  });
  const conversation=convs?.[0];

  await sb('crm_messages',{
    method:'POST',headers:{Prefer:'return=minimal'},
    body:JSON.stringify({
      organization_id:org.id,channel_id:channel.id,conversation_id:conversation.id,contact_id:contact.id,
      external_message_id:`qa-msg-${uid()}`,direction:'inbound',message_type:'text',text:initialMessage,
      attachments:[],sent_at:now,raw_payload:{test_mode:true,qa_run_id:runId},is_test:true
    })
  });

  const oppRows=await sb('crm_opportunities',{
    method:'POST',headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      organization_id:org.id,contact_id:contact.id,conversation_id:conversation.id,owner_user_id:owner,
      title:`${name} · ${product}`,stage:'new',priority,value,currency:'COP',product,quantity,city,usage_type:usage,urgency,
      notes:'Oportunidad creada por Simulador QA',next_follow_up_at:due,source,cap_status:'active',status:'open',
      created_by:isUuid(session.sub)?session.sub:null,is_test:true,updated_at:now
    })
  });
  const opportunity=oppRows?.[0];

  await sb('crm_cap',{
    method:'POST',headers:{Prefer:'return=minimal'},
    body:JSON.stringify({
      organization_id:org.id,opportunity_id:opportunity.id,contact_id:contact.id,status:'active',
      step:'contact_client',next_action:'Contactar cliente',next_action_at:due,sequence:0,is_test:true,
      metadata:{test_mode:true,qa_run_id:runId}
    })
  });

  const taskRows=await sb('crm_tasks',{
    method:'POST',headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      organization_id:org.id,contact_id:contact.id,opportunity_id:opportunity.id,assigned_user_id:owner,
      title:'Contactar cliente',description:'Primera acción obligatoria · Simulador QA',due_at:due,status:'pending',
      priority:priority==='P1'?'high':priority==='P2'?'normal':'low',task_type:'contact_client',sla_minutes:15,
      sequence:0,auto_generated:true,automation_key:`qa:${runId}:contact_client:0`,
      created_by:isUuid(session.sub)?session.sub:null,is_test:true,metadata:{test_mode:true,qa_run_id:runId}
    })
  });

  await sb('crm_stage_history',{
    method:'POST',headers:{Prefer:'return=minimal'},
    body:JSON.stringify({
      organization_id:org.id,opportunity_id:opportunity.id,from_stage:null,to_stage:'new',
      task_id:taskRows?.[0]?.id||null,actor_user_id:isUuid(session.sub)?session.sub:null,
      transition_key:'qa_created',is_test:true,metadata:{qa_run_id:runId}
    })
  });

  const runRows=await sb('crm_qa_runs',{
    method:'POST',headers:{Prefer:'return=representation'},
    body:JSON.stringify({
      id:runId,organization_id:org.id,created_by:isUuid(session.sub)?session.sub:null,status:'active',
      persona:{name,phone,city,product,quantity,usage_type:usage,urgency,priority,value,initial_message:initialMessage},
      contact_id:contact.id,conversation_id:conversation.id,opportunity_id:opportunity.id,
      checks:{created:true},updated_at:now
    })
  });
  return loadRunBundle(org.id,runRows?.[0]);
}
async function addMessage(orgId,run,body){
  const direction=body?.direction==='outbound'?'outbound':'inbound';
  const text=clean(body?.text,3000);
  if(!text)throw new Error('Escribe un mensaje.');
  const contactRows=await sb(`crm_contacts?id=eq.${run.contact_id}&organization_id=eq.${orgId}&select=*&limit=1`);
  const convRows=await sb(`crm_conversations?id=eq.${run.conversation_id}&organization_id=eq.${orgId}&select=*&limit=1`);
  const contact=contactRows?.[0],conv=convRows?.[0];
  if(!contact||!conv)throw new Error('La conversación de prueba ya no existe.');
  const now=new Date().toISOString();
  await sb('crm_messages',{
    method:'POST',headers:{Prefer:'return=minimal'},
    body:JSON.stringify({
      organization_id:orgId,channel_id:conv.channel_id,conversation_id:conv.id,contact_id:contact.id,
      external_message_id:`qa-msg-${uid()}`,direction,message_type:'text',text,attachments:[],sent_at:now,
      raw_payload:{test_mode:true,qa_run_id:run.id,simulated_role:direction==='inbound'?'lead':'agent'},is_test:true
    })
  });
  await sb(`crm_conversations?id=eq.${conv.id}&organization_id=eq.${orgId}`,{
    method:'PATCH',headers:{Prefer:'return=minimal'},
    body:JSON.stringify({
      unread_count:direction==='inbound'?Number(conv.unread_count||0)+1:conv.unread_count,
      last_message_at:now,updated_at:now
    })
  });
}
async function deleteRun(orgId,run){
  if(!run)return;
  if(run.opportunity_id){
    await sb(`crm_orders?organization_id=eq.${orgId}&opportunity_id=eq.${run.opportunity_id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
    await sb(`crm_quotes?organization_id=eq.${orgId}&opportunity_id=eq.${run.opportunity_id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
    await sb(`crm_tasks?organization_id=eq.${orgId}&opportunity_id=eq.${run.opportunity_id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
    await sb(`crm_stage_history?organization_id=eq.${orgId}&opportunity_id=eq.${run.opportunity_id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
    await sb(`crm_cap?organization_id=eq.${orgId}&opportunity_id=eq.${run.opportunity_id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
    await sb(`crm_opportunities?id=eq.${run.opportunity_id}&organization_id=eq.${orgId}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
  }
  if(run.conversation_id){
    await sb(`crm_messages?organization_id=eq.${orgId}&conversation_id=eq.${run.conversation_id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
    await sb(`crm_conversations?id=eq.${run.conversation_id}&organization_id=eq.${orgId}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
  }
  if(run.contact_id)await sb(`crm_contacts?id=eq.${run.contact_id}&organization_id=eq.${orgId}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
  await sb(`crm_qa_runs?id=eq.${run.id}&organization_id=eq.${orgId}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const session=verifySession(req);
  if(!session)return res.status(401).json({ok:false,error:'CRM session required'});
  if(!(isPlatformAdmin(session)||isOrgOwner(session)||session.role==='admin')){
    return res.status(403).json({ok:false,error:'El simulador QA solo está disponible para Host, Dueño o Administrador.'});
  }

  try{
    const org=await orgForSession(session);
    if(!org)return res.status(403).json({ok:false,error:'No active organization in session'});

    if(req.method==='GET'){
      const id=String(req.query?.run_id||'');
      if(id){
        const run=await getRun(org.id,id);
        if(!run)return res.status(404).json({ok:false,error:'Prueba no encontrada'});
        return res.status(200).json({ok:true,...await loadRunBundle(org.id,run)});
      }
      const runs=await sb(`crm_qa_runs?organization_id=eq.${org.id}&select=*&order=created_at.desc&limit=20`);
      return res.status(200).json({ok:true,runs:runs||[]});
    }

    if(req.method==='POST'){
      const action=String(req.body?.action||'');
      if(action==='create_run'){
        const bundle=await createRun(org,session,req.body||{});
        return res.status(201).json({ok:true,...bundle});
      }
      if(action==='message'){
        const run=await getRun(org.id,String(req.body?.run_id||''));
        if(!run)return res.status(404).json({ok:false,error:'Prueba no encontrada'});
        await addMessage(org.id,run,req.body||{});
        return res.status(200).json({ok:true,...await loadRunBundle(org.id,run)});
      }
      if(action==='refresh'){
        const run=await getRun(org.id,String(req.body?.run_id||''));
        if(!run)return res.status(404).json({ok:false,error:'Prueba no encontrada'});
        return res.status(200).json({ok:true,...await loadRunBundle(org.id,run)});
      }
      return res.status(400).json({ok:false,error:'Acción no válida'});
    }

    if(req.method==='DELETE'){
      const run=await getRun(org.id,String(req.query?.run_id||''));
      if(!run)return res.status(404).json({ok:false,error:'Prueba no encontrada'});
      await deleteRun(org.id,run);
      return res.status(200).json({ok:true});
    }

    res.setHeader('Allow','GET, POST, DELETE');
    return res.status(405).json({ok:false,error:'Method not allowed'});
  }catch(error){
    console.error('CRM_QA_SIMULATOR_ERROR',error.message);
    return res.status(500).json({ok:false,error:error.message||'No fue posible ejecutar el simulador'});
  }
};

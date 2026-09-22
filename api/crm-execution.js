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
        actor_user_id: isUuid(session?.sub) ? session.sub : null,
        actor_email: session?.email || null,
        action,
        entity_type: entityType,
        entity_id: entityId ? String(entityId) : null,
        before_data: beforeData,
        after_data: afterData,
        metadata
      })
    });
  } catch (_) {}
}

const TASK_RULES = {
  contact_client: { title: 'Contactar cliente', minutes: 15, stage: 'contacting', default_next: 'qualify' },
  qualify: { title: 'Calificar lead', minutes: 120, stage: 'opportunity', default_next: 'quote' },
  quote: { title: 'Crear y enviar cotización', minutes: 240, stage: 'quote', default_next: 'follow_up_24h' },
  follow_up_24h: { title: 'Seguimiento de cotización · 24h', minutes: 1440, stage: 'follow_up' },
  follow_up_48h: { title: 'Seguimiento · 48h', minutes: 2880, stage: 'follow_up' },
  follow_up_72h: { title: 'Seguimiento · 72h', minutes: 4320, stage: 'follow_up' },
  negotiation: { title: 'Negociar y definir cierre', minutes: 240, stage: 'negotiation' },
  future_follow_up: { title: 'Seguimiento futuro', minutes: 10080, stage: 'future_follow_up' },
  call: { title: 'Realizar llamada', minutes: 60, stage: null },
  send_message: { title: 'Enviar información solicitada', minutes: 60, stage: null },
  close_won: { title: 'Registrar venta ganada', minutes: 60, stage: 'won' },
  close_lost: { title: 'Cerrar oportunidad perdida', minutes: 60, stage: 'lost' },
  manual: { title: 'Tarea comercial', minutes: 240, stage: null }
};

const STAGE_TASK = {
  new: 'contact_client',
  lead_new: 'contact_client',
  contacting: 'contact_client',
  contacted: 'qualify',
  qualification: 'qualify',
  qualified: 'quote',
  opportunity: 'quote',
  proposal: 'follow_up_24h',
  quote: 'follow_up_24h',
  follow_up: 'follow_up_48h',
  negotiation: 'negotiation',
  future_follow_up: 'future_follow_up'
};

const FOLLOWUP_NEXT = {
  follow_up_24h: 'follow_up_48h',
  follow_up_48h: 'follow_up_72h',
  follow_up_72h: 'future_follow_up'
};

function dueFromNow(minutes) {
  return new Date(Date.now() + Math.max(1, Number(minutes) || 1) * 60000).toISOString();
}
function priorityToTask(priority) {
  return priority === 'P1' ? 'high' : priority === 'P2' ? 'normal' : 'low';
}
function nextRuleForStage(stage) {
  return STAGE_TASK[String(stage || '').toLowerCase()] || 'contact_client';
}
async function defaultOwner(orgId, session) {
  if (isUuid(session?.sub) && !isPlatformAdmin(session)) return session.sub;
  const rows = await sb(`crm_memberships?organization_id=eq.${orgId}&status=eq.active&role=in.(owner,sales,agent,admin)&select=user_id,role&order=is_default.desc,created_at.asc&limit=1`);
  return rows?.[0]?.user_id || null;
}
async function createAutoTask({ orgId, opportunity, type, session, sequence = 0, dueAt = null }) {
  const rule = TASK_RULES[type] || TASK_RULES.manual;
  const assigned = opportunity.owner_user_id || await defaultOwner(orgId, session);
  if (!assigned) throw new Error('La oportunidad no tiene vendedor responsable');
  const rows = await sb('crm_tasks', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      organization_id: orgId,
      contact_id: opportunity.contact_id || null,
      opportunity_id: opportunity.id,
      assigned_user_id: assigned,
      title: rule.title,
      description: `Acción obligatoria del motor comercial: ${rule.title}`,
      due_at: dueAt || dueFromNow(rule.minutes),
      status: 'pending',
      priority: priorityToTask(opportunity.priority),
      task_type: type,
      sla_minutes: rule.minutes,
      sequence,
      auto_generated: true,
      automation_key: `execution:${opportunity.id}:${type}:${sequence}`,
      created_by: isUuid(session?.sub) ? session.sub : null,
      is_test: Boolean(opportunity.is_test),
      metadata: { source: 'execution_engine_v2', locked_workflow: true }
    })
  });
  return rows?.[0] || null;
}
async function activeTaskForOpportunity(orgId, opportunityId) {
  const rows = await sb(`crm_tasks?organization_id=eq.${orgId}&opportunity_id=eq.${encodeURIComponent(opportunityId)}&auto_generated=eq.true&status=in.(pending,in_progress)&select=*&order=due_at.asc.nullslast,created_at.asc&limit=1`);
  return rows?.[0] || null;
}
async function ensureRuleOfGold(orgId, session, testMode = false) {
  const testFilter = testMode ? '&is_test=eq.true' : '&is_test=eq.false';
  const opps = await sb(`crm_opportunities?organization_id=eq.${orgId}&status=eq.open${testFilter}&select=id,contact_id,conversation_id,owner_user_id,title,stage,priority,product,city,quantity,usage_type,urgency,source,value,is_test,created_at&order=created_at.asc`);
  for (const opp of (opps || [])) {
    let patch = null;
    if (!opp.owner_user_id) {
      const owner = await defaultOwner(orgId, session);
      if (owner) patch = { ...(patch || {}), owner_user_id: owner };
    }
    if (!opp.priority) patch = { ...(patch || {}), priority: 'P3' };
    if (patch) {
      patch.updated_at = new Date().toISOString();
      const updated = await sb(`crm_opportunities?id=eq.${opp.id}&organization_id=eq.${orgId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch)
      });
      Object.assign(opp, updated?.[0] || patch);
    }
    if (!opp.owner_user_id) continue;

    const task = await activeTaskForOpportunity(orgId, opp.id);
    if (!task) {
      const type = nextRuleForStage(opp.stage);
      const created = await createAutoTask({ orgId, opportunity: opp, type, session, sequence: 0 });
      await sb(`crm_cap?organization_id=eq.${orgId}&opportunity_id=eq.${opp.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'active',
          step: type,
          next_action: created?.title || TASK_RULES[type]?.title || 'Próxima tarea',
          next_action_at: created?.due_at || null,
          updated_at: new Date().toISOString()
        })
      });
    }
  }
}

function scoreTask(task) {
  const now = Date.now();
  const due = task.due_at ? new Date(task.due_at).getTime() : now + 86400000;
  const overdueMinutes = Math.max(0, (now - due) / 60000);
  const untilDue = (due - now) / 60000;
  const oppPriority = task.opportunity?.priority || 'P3';
  const priorityScore = oppPriority === 'P1' ? 3200 : oppPriority === 'P2' ? 1700 : 700;
  const unreadScore = Number(task.opportunity?.conversation?.unread_count || 0) > 0 ? 5000 : 0;
  const overdueScore = overdueMinutes > 0 ? 2600 + Math.min(1800, overdueMinutes) : 0;
  const soonScore = untilDue >= 0 && untilDue <= 60 ? 900 - Math.max(0, untilDue) : 0;
  const typeScore = {
    contact_client: 1400, follow_up_24h: 1300, follow_up_48h: 1200, follow_up_72h: 1100,
    negotiation: 1050, quote: 950, qualify: 900, call: 800, send_message: 760, future_follow_up: 100
  }[task.task_type] || 500;
  const valueScore = Math.min(700, Math.max(0, num(task.opportunity?.value)) / 100000);
  return unreadScore + overdueScore + soonScore + priorityScore + typeScore + valueScore;
}
function enrichTask(task) {
  const due = task.due_at ? new Date(task.due_at).getTime() : null;
  const now = Date.now();
  let timing_state = 'pending';
  if (due && due < now) timing_state = 'overdue';
  else if (due && due - now <= 60 * 60000) timing_state = 'due_soon';
  return { ...task, timing_state, execution_score: scoreTask(task) };
}
async function getContact(orgId, contactId) {
  if (!contactId) return null;
  const rows = await sb(`crm_contacts?id=eq.${contactId}&organization_id=eq.${orgId}&select=*&limit=1`);
  return rows?.[0] || null;
}
async function patchQualificationContact(orgId, opp, body) {
  if (!opp.contact_id) return null;
  const current = await getContact(orgId, opp.contact_id);
  if (!current) return null;
  const patch = { updated_at: new Date().toISOString() };
  if (body?.contact_name !== undefined) patch.display_name = clean(body.contact_name, 300);
  if (body?.contact_phone !== undefined) patch.phone = clean(body.contact_phone, 100);
  if (body?.contact_email !== undefined) patch.email = clean(body.contact_email, 320);
  if (Object.keys(patch).length === 1) return current;
  const rows = await sb(`crm_contacts?id=eq.${opp.contact_id}&organization_id=eq.${orgId}`, {
    method:'PATCH', headers:{Prefer:'return=representation'}, body:JSON.stringify(patch)
  });
  return rows?.[0] || { ...current, ...patch };
}
async function patchQualificationOpportunity(orgId, opp, body) {
  const patch = { updated_at:new Date().toISOString() };
  const textFields = ['product','city','usage_type','urgency','source'];
  for (const key of textFields) if (body?.[key] !== undefined) patch[key] = clean(body[key], 400);
  if (body?.quantity !== undefined) patch.quantity = body.quantity === '' ? null : num(body.quantity);
  if (body?.budget !== undefined) patch.budget = body.budget === '' ? null : num(body.budget);
  if (body?.priority !== undefined) {
    const p = String(body.priority || '').toUpperCase();
    if (!['P1','P2','P3'].includes(p)) throw new Error('Prioridad inválida');
    patch.priority = p;
  }
  const rows=await sb(`crm_opportunities?id=eq.${opp.id}&organization_id=eq.${orgId}`,{
    method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)
  });
  return rows?.[0] || { ...opp, ...patch };
}
async function qualificationGaps(orgId, opp) {
  const contact = await getContact(orgId, opp.contact_id);
  const gaps = [];
  if (!contact?.display_name) gaps.push('nombre');
  if (!contact?.phone) gaps.push('teléfono');
  if (!opp.product) gaps.push('producto/servicio');
  if (!(num(opp.quantity) > 0)) gaps.push('cantidad');
  if (!opp.city) gaps.push('ciudad');
  if (!opp.usage_type) gaps.push('uso propio o reventa');
  if (!opp.urgency) gaps.push('urgencia');
  if (!opp.source) gaps.push('canal/origen');
  if (!opp.owner_user_id) gaps.push('vendedor responsable');
  return gaps;
}
async function outboundEvidence(orgId, opp, since) {
  if (!opp.conversation_id) return null;
  const rows = await sb(`crm_messages?organization_id=eq.${orgId}&conversation_id=eq.${opp.conversation_id}&direction=eq.outbound&sent_at=gte.${encodeURIComponent(since)}&select=id,sent_at&order=sent_at.desc&limit=1`);
  return rows?.[0] || null;
}
function requireOutcome(body, allowed) {
  const outcome = clean(body?.outcome, 80);
  if (!outcome || !allowed.includes(outcome)) throw new Error('Selecciona el resultado de la acción antes de continuar.');
  return outcome;
}
async function validateCompletion(orgId, task, opp, body) {
  const note = clean(body?.completion_note, 3000);

  if (task.task_type === 'qualify') {
    const gaps = await qualificationGaps(orgId, opp);
    if (gaps.length) throw new Error(`No se puede completar la calificación. Falta: ${gaps.join(', ')}.`);
    return { evidence_type:'qualification', evidence_ref_id:opp.id, completion_note:note, outcome:'qualified' };
  }

  if (task.task_type === 'quote') {
    const rows = await sb(`crm_quotes?organization_id=eq.${orgId}&opportunity_id=eq.${opp.id}&created_at=gte.${encodeURIComponent(task.created_at)}&select=id,quote_number,status&order=created_at.desc&limit=1`);
    const quote = rows?.[0];
    if (!quote) throw new Error('Primero crea una cotización vinculada a esta oportunidad.');
    return { evidence_type:'quote', evidence_ref_id:quote.id, completion_note:note, outcome:'quoted' };
  }

  if (['contact_client','send_message'].includes(task.task_type)) {
    const message = await outboundEvidence(orgId, opp, task.created_at);
    if (opp.conversation_id && !message) throw new Error('Falta evidencia: debe existir un mensaje saliente posterior a la creación de la tarea.');
    if (!opp.conversation_id && !note) throw new Error('Registra una nota de evidencia para completar esta acción.');
    return { evidence_type:message?'outbound_message':'manual_note', evidence_ref_id:message?.id||null, completion_note:note, outcome:'executed' };
  }

  if (['follow_up_24h','follow_up_48h','follow_up_72h','future_follow_up'].includes(task.task_type)) {
    const message = await outboundEvidence(orgId, opp, task.created_at);
    if (opp.conversation_id && !message) throw new Error('Falta evidencia: realiza el seguimiento antes de completar la tarea.');
    if (!opp.conversation_id && !note) throw new Error('Registra una nota del seguimiento.');
    const outcome=requireOutcome(body,['interested','no_response','lost','needs_info']);
    if (task.task_type==='future_follow_up' && outcome==='no_response' && !body?.future_due_at) {
      throw new Error('Define la nueva fecha de seguimiento futuro.');
    }
    return { evidence_type:message?'outbound_message':'manual_note', evidence_ref_id:message?.id||null, completion_note:note, outcome, future_due_at:body?.future_due_at||null };
  }

  if (task.task_type === 'negotiation') {
    if (!note) throw new Error('Registra el resultado de la negociación.');
    const outcome=requireOutcome(body,['won','lost','follow_up']);
    return { evidence_type:'negotiation_note', evidence_ref_id:null, completion_note:note, outcome };
  }

  if (task.task_type === 'call') {
    if (!note) throw new Error('Registra el resultado de la llamada.');
    return { evidence_type:'call_log', evidence_ref_id:null, completion_note:note, outcome:'executed' };
  }

  if (task.task_type === 'close_lost') {
    const reason = clean(body?.lost_reason, 100);
    const detail = clean(body?.lost_reason_note, 1000);
    if (!reason) throw new Error('Selecciona el motivo de pérdida.');
    if (reason === 'otro' && !detail) throw new Error('Escribe el motivo cuando seleccionas “otro”.');
    return { evidence_type:'lost_reason', evidence_ref_id:null, completion_note:detail||reason, outcome:'lost', lost_reason:reason, lost_reason_note:detail };
  }

  if (task.task_type === 'close_won') {
    const required=[];
    if(!opp.product)required.push('producto');
    if(!(num(opp.quantity)>0))required.push('cantidad');
    if(!(num(opp.value)>0))required.push('valor de venta');
    if(!opp.city)required.push('ciudad');
    if(!opp.source)required.push('origen');
    if(!opp.owner_user_id)required.push('vendedor');
    const payment=clean(body?.payment_method,120)||opp.payment_method;
    if(!payment)required.push('método de pago');
    if(required.length)throw new Error(`No se puede cerrar como ganado. Falta: ${required.join(', ')}.`);
    return { evidence_type:'sale_data', evidence_ref_id:null, completion_note:note, outcome:'won', payment_method:payment };
  }

  if (!note) throw new Error('Registra el resultado de la tarea.');
  return { evidence_type:'manual_note', evidence_ref_id:null, completion_note:note, outcome:'executed' };
}
function decideNext(taskType,evidence){
  if(taskType==='contact_client')return 'qualify';
  if(taskType==='qualify')return 'quote';
  if(taskType==='quote')return 'follow_up_24h';
  if(['follow_up_24h','follow_up_48h','follow_up_72h','future_follow_up'].includes(taskType)){
    if(evidence.outcome==='interested')return 'negotiation';
    if(evidence.outcome==='lost')return 'close_lost';
    if(evidence.outcome==='needs_info')return 'send_message';
    if(evidence.outcome==='no_response'){
      if(taskType==='future_follow_up')return 'future_follow_up';
      return FOLLOWUP_NEXT[taskType]||'future_follow_up';
    }
  }
  if(taskType==='negotiation'){
    if(evidence.outcome==='won')return 'close_won';
    if(evidence.outcome==='lost')return 'close_lost';
    if(evidence.outcome==='follow_up')return 'follow_up_24h';
  }
  if(taskType==='send_message')return 'follow_up_24h';
  return null;
}
async function recordStageTransition(orgId,session,opp,fromStage,toStage,task,transitionKey){
  if(!toStage || fromStage===toStage)return;
  try{
    await sb('crm_stage_history',{
      method:'POST',headers:{Prefer:'return=minimal'},
      body:JSON.stringify({
        organization_id:orgId,opportunity_id:opp.id,from_stage:fromStage||null,to_stage:toStage,
        task_id:task?.id||null,actor_user_id:isUuid(session?.sub)?session.sub:null,
        transition_key:transitionKey||task?.task_type||null,is_test:Boolean(opp.is_test),
        metadata:{task_type:task?.task_type||null}
      })
    });
  }catch(_){}
}
async function completeTask(orgId, session, body) {
  const id = String(body?.task_id || '');
  const rows = await sb(`crm_tasks?id=eq.${encodeURIComponent(id)}&organization_id=eq.${orgId}&select=*&limit=1`);
  const task = rows?.[0];
  if (!task) throw new Error('Tarea no encontrada');
  if (!['pending','in_progress'].includes(task.status)) throw new Error('La tarea ya no está pendiente');

  if (!isPlatformAdmin(session) && !isOrgOwner(session) && ['sales','agent'].includes(session?.role) && task.assigned_user_id !== session.sub) {
    throw new Error('Esta tarea está asignada a otro vendedor');
  }

  const oppRows = await sb(`crm_opportunities?id=eq.${task.opportunity_id}&organization_id=eq.${orgId}&select=*&limit=1`);
  let opp = oppRows?.[0];
  if (!opp) throw new Error('Oportunidad no encontrada');

  if(task.task_type==='qualify'){
    await patchQualificationContact(orgId,opp,body);
    opp=await patchQualificationOpportunity(orgId,opp,body);
  }
  if(task.task_type==='close_won' && body?.payment_method){
    const rows2=await sb(`crm_opportunities?id=eq.${opp.id}&organization_id=eq.${orgId}`,{
      method:'PATCH',headers:{Prefer:'return=representation'},
      body:JSON.stringify({payment_method:clean(body.payment_method,120),updated_at:new Date().toISOString()})
    });
    opp=rows2?.[0]||opp;
  }

  const evidence = await validateCompletion(orgId, task, opp, body);
  const now = new Date().toISOString();

  const completedRows = await sb(`crm_tasks?id=eq.${task.id}&organization_id=eq.${orgId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'completed',
      completed_at: now,
      completed_by: isUuid(session?.sub) ? session.sub : null,
      evidence_type: evidence.evidence_type || null,
      evidence_ref_id: evidence.evidence_ref_id || null,
      completion_note: evidence.completion_note || null,
      metadata:{...(task.metadata||{}),outcome:evidence.outcome||null},
      updated_at: now
    })
  });
  const completed = completedRows?.[0] || task;

  const rule = TASK_RULES[task.task_type] || TASK_RULES.manual;
  const nextType = decideNext(task.task_type,evidence);
  const fromStage=opp.stage;
  const oppPatch = { updated_at: now };

  if (rule.stage) oppPatch.stage = rule.stage;
  if (task.task_type === 'contact_client' && !opp.first_contact_at) oppPatch.first_contact_at = now;
  if (task.task_type === 'qualify') oppPatch.qualified_at = now;
  if (task.task_type === 'close_won') {
    oppPatch.stage = 'won'; oppPatch.status = 'won'; oppPatch.closed_at = now; oppPatch.payment_method=evidence.payment_method;
  }
  if (task.task_type === 'close_lost') {
    oppPatch.stage = 'lost'; oppPatch.status = 'lost'; oppPatch.closed_at = now;
    oppPatch.lost_reason = evidence.lost_reason; oppPatch.lost_reason_note = evidence.lost_reason_note || null;
  }
  if (nextType==='negotiation') oppPatch.stage='negotiation';
  if (nextType==='future_follow_up') oppPatch.stage='future_follow_up';

  const updatedOppRows = await sb(`crm_opportunities?id=eq.${opp.id}&organization_id=eq.${orgId}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(oppPatch)
  });
  const updatedOpp = updatedOppRows?.[0] || { ...opp, ...oppPatch };
  await recordStageTransition(orgId,session,updatedOpp,fromStage,updatedOpp.stage,task,`task:${task.task_type}:${evidence.outcome||'complete'}`);

  let nextTask = null;
  if (nextType && updatedOpp.status === 'open') {
    let dueAt=null;
    if(task.task_type==='future_follow_up' && nextType==='future_follow_up' && evidence.future_due_at)dueAt=evidence.future_due_at;
    nextTask = await createAutoTask({
      orgId, opportunity: updatedOpp, type: nextType, session,
      sequence: Number(task.sequence || 0) + 1, dueAt
    });
  }

  await sb(`crm_cap?organization_id=eq.${orgId}&opportunity_id=eq.${opp.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: updatedOpp.status === 'open' ? 'active' : 'closed',
      step: nextTask?.task_type || task.task_type,
      decision: evidence.outcome || null,
      next_action: nextTask?.title || null,
      next_action_at: nextTask?.due_at || null,
      sequence: Number(task.sequence || 0) + 1,
      closed_at: updatedOpp.status === 'open' ? null : now,
      updated_at: now
    })
  });

  await audit(session, orgId, 'task.completed', 'task', task.id, task, completed, {
    opportunity_id: opp.id, evidence_type: evidence.evidence_type || null,
    outcome:evidence.outcome||null,next_task_id:nextTask?.id||null
  });

  return { task: completed, opportunity: updatedOpp, next_task: nextTask, next_action: nextTask?.title || null };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const session = verifySession(req);
  if (!session) return res.status(401).json({ ok:false, error:'CRM session required' });

  try {
    const org = await organizationForSession(session);
    if (!org) return res.status(403).json({ ok:false, error:'No active organization in session' });
    const orgId = org.id;

    if (!hasModuleAccess(session, 'tasks', req.method === 'GET' ? 'read' : 'edit')) {
      return res.status(403).json({ ok:false, error:'No tienes acceso al motor de ejecución' });
    }

    if (req.method === 'GET') {
      const testMode=String(req.query?.test||'0')==='1';
      const opportunityId=String(req.query?.opportunity_id||'');
      await ensureRuleOfGold(orgId, session, testMode);
      const scope = (!isPlatformAdmin(session) && !isOrgOwner(session) && ['sales','agent'].includes(session.role))
        ? `&assigned_user_id=eq.${encodeURIComponent(session.sub)}` : '';
      const testFilter=testMode?'&is_test=eq.true':'&is_test=eq.false';
      const oppFilter=opportunityId?`&opportunity_id=eq.${encodeURIComponent(opportunityId)}`:'';
      const rows = await sb(
        `crm_tasks?organization_id=eq.${orgId}&status=in.(pending,in_progress)&auto_generated=eq.true${scope}${testFilter}${oppFilter}&select=*,contact:crm_contacts(id,display_name,phone,email,metadata,is_test),opportunity:crm_opportunities(id,contact_id,title,stage,status,value,priority,product,city,quantity,usage_type,urgency,source,owner_user_id,conversation_id,is_test,conversation:crm_conversations(id,unread_count,last_message_at),cap:crm_cap(step,next_action,next_action_at,sequence))&order=due_at.asc.nullslast,created_at.asc&limit=250`
      );
      const queue = (rows || []).map(enrichTask).sort((a,b) => b.execution_score - a.execution_score);
      return res.status(200).json({
        ok:true,organization:org,next_task:queue[0]||null,queue,
        summary:{
          total:queue.length,overdue:queue.filter(x=>x.timing_state==='overdue').length,
          due_soon:queue.filter(x=>x.timing_state==='due_soon').length,
          p1:queue.filter(x=>x.opportunity?.priority==='P1').length
        }
      });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '');
      if (action === 'complete_task') {
        const result = await completeTask(orgId, session, req.body);
        return res.status(200).json({ ok:true, ...result });
      }
      if (action === 'start_task') {
        const id = String(req.body?.task_id || '');
        const rows = await sb(`crm_tasks?id=eq.${encodeURIComponent(id)}&organization_id=eq.${orgId}&status=eq.pending&select=*&limit=1`);
        const task = rows?.[0];
        if (!task) return res.status(404).json({ok:false,error:'Tarea no encontrada o ya iniciada'});
        if (!isPlatformAdmin(session) && !isOrgOwner(session) && ['sales','agent'].includes(session?.role) && task.assigned_user_id !== session.sub) {
          return res.status(403).json({ok:false,error:'Esta tarea está asignada a otro vendedor'});
        }
        const started = await sb(`crm_tasks?id=eq.${task.id}&organization_id=eq.${orgId}`, {
          method:'PATCH', headers:{Prefer:'return=representation'},
          body:JSON.stringify({status:'in_progress',started_at:new Date().toISOString(),updated_at:new Date().toISOString()})
        });
        await audit(session,orgId,'task.started','task',task.id,task,started?.[0]||null);
        return res.status(200).json({ok:true,task:started?.[0]||task});
      }
      return res.status(400).json({ok:false,error:'Acción no válida'});
    }

    res.setHeader('Allow','GET, POST');
    return res.status(405).json({ok:false,error:'Method not allowed'});
  } catch (error) {
    console.error('CRM_EXECUTION_ERROR', error.message);
    return res.status(500).json({ok:false,error:error.message || 'No fue posible ejecutar el motor comercial'});
  }
};
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
  contact_client: { title: 'Contactar cliente', minutes: 15, next: 'qualify', stage: 'qualification', action: 'Calificar lead' },
  qualify: { title: 'Calificar lead', minutes: 120, next: 'quote', stage: 'opportunity', action: 'Crear cotización' },
  quote: { title: 'Crear y enviar cotización', minutes: 240, next: 'follow_up_24h', stage: 'quote', action: 'Seguimiento de cotización 24h' },
  follow_up_24h: { title: 'Seguimiento de cotización · 24h', minutes: 1440, next: 'follow_up_48h', stage: 'follow_up', action: 'Seguimiento 48h' },
  follow_up_48h: { title: 'Seguimiento · 48h', minutes: 2880, next: 'follow_up_72h', stage: 'follow_up', action: 'Seguimiento 72h' },
  follow_up_72h: { title: 'Seguimiento · 72h', minutes: 4320, next: 'future_follow_up', stage: 'follow_up', action: 'Seguimiento futuro' },
  future_follow_up: { title: 'Seguimiento futuro', minutes: 10080, next: null, stage: 'future_follow_up', action: 'Definir nueva acción comercial' },
  call: { title: 'Realizar llamada', minutes: 60, next: null, stage: null, action: 'Definir próxima acción' },
  send_message: { title: 'Enviar mensaje', minutes: 60, next: null, stage: null, action: 'Definir próxima acción' },
  close_won: { title: 'Cerrar como ganado', minutes: 60, next: null, stage: 'won', action: null },
  close_lost: { title: 'Cerrar como perdido', minutes: 60, next: null, stage: 'lost', action: null },
  manual: { title: 'Tarea comercial', minutes: 240, next: null, stage: null, action: 'Definir próxima acción' }
};

function dueFromNow(minutes) {
  return new Date(Date.now() + Math.max(1, Number(minutes) || 1) * 60000).toISOString();
}
function priorityToTask(priority) {
  return priority === 'P1' ? 'high' : priority === 'P2' ? 'normal' : 'low';
}
function nextRuleForStage(stage) {
  const map = {
    new: 'contact_client',
    contacting: 'contact_client',
    contacted: 'qualify',
    qualification: 'qualify',
    qualified: 'quote',
    opportunity: 'quote',
    proposal: 'follow_up_24h',
    quote: 'follow_up_24h',
    follow_up: 'follow_up_48h',
    negotiation: 'follow_up_24h',
    future_follow_up: 'future_follow_up'
  };
  return map[stage] || 'contact_client';
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
      metadata: { source: 'execution_engine_v1' }
    })
  });
  return rows?.[0] || null;
}

async function activeTaskForOpportunity(orgId, opportunityId) {
  const rows = await sb(`crm_tasks?organization_id=eq.${orgId}&opportunity_id=eq.${encodeURIComponent(opportunityId)}&status=in.(pending,in_progress)&select=*&order=due_at.asc.nullslast,created_at.asc&limit=1`);
  return rows?.[0] || null;
}

async function ensureRuleOfGold(orgId, session) {
  const opps = await sb(`crm_opportunities?organization_id=eq.${orgId}&status=eq.open&select=id,contact_id,conversation_id,owner_user_id,title,stage,priority,product,city,quantity,usage_type,urgency,source,created_at&order=created_at.asc`);
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
      const rule = TASK_RULES[type] || TASK_RULES.manual;
      await sb(`crm_cap?organization_id=eq.${orgId}&opportunity_id=eq.${opp.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'active',
          step: type,
          next_action: rule.title,
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
    send_message: 1400,
    contact_client: 1250,
    follow_up_24h: 1150,
    follow_up_48h: 1050,
    follow_up_72h: 950,
    quote: 900,
    qualify: 850,
    call: 800,
    future_follow_up: 100
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

async function qualificationGaps(orgId, opp) {
  let contact = null;
  if (opp.contact_id) {
    const rows = await sb(`crm_contacts?id=eq.${opp.contact_id}&organization_id=eq.${orgId}&select=id,display_name,phone&limit=1`);
    contact = rows?.[0] || null;
  }
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

async function validateCompletion(orgId, task, opp, body) {
  const note = clean(body?.completion_note, 3000);

  if (task.task_type === 'qualify') {
    const gaps = await qualificationGaps(orgId, opp);
    if (gaps.length) throw new Error(`No se puede completar la calificación. Falta: ${gaps.join(', ')}.`);
    return { evidence_type: 'qualification', evidence_ref_id: opp.id, completion_note: note };
  }

  if (task.task_type === 'quote') {
    const rows = await sb(`crm_quotes?organization_id=eq.${orgId}&opportunity_id=eq.${opp.id}&created_at=gte.${encodeURIComponent(task.created_at)}&select=id,quote_number,status&order=created_at.desc&limit=1`);
    const quote = rows?.[0];
    if (!quote) throw new Error('No se puede completar esta tarea: primero crea una cotización vinculada a la oportunidad.');
    return { evidence_type: 'quote', evidence_ref_id: quote.id, completion_note: note };
  }

  if (['contact_client','send_message','follow_up_24h','follow_up_48h','follow_up_72h'].includes(task.task_type)) {
    const message = await outboundEvidence(orgId, opp, task.created_at);
    if (opp.conversation_id && !message) {
      throw new Error('No se puede completar esta tarea: no existe un mensaje saliente posterior a la creación de la tarea.');
    }
    if (!opp.conversation_id && !note) {
      throw new Error('Registra una nota de evidencia para completar esta acción.');
    }
    return {
      evidence_type: message ? 'outbound_message' : 'manual_note',
      evidence_ref_id: message?.id || null,
      completion_note: note
    };
  }

  if (task.task_type === 'call' && !note) {
    throw new Error('Registra el resultado de la llamada para completar la tarea.');
  }

  if (task.task_type === 'close_lost') {
    const reason = clean(body?.lost_reason, 100);
    const detail = clean(body?.lost_reason_note, 1000);
    if (!reason) throw new Error('Selecciona el motivo de pérdida.');
    if (reason === 'otro' && !detail) throw new Error('Escribe el motivo cuando seleccionas "otro".');
    return { evidence_type: 'lost_reason', evidence_ref_id: null, completion_note: detail || reason, lost_reason: reason, lost_reason_note: detail };
  }

  return { evidence_type: note ? 'manual_note' : null, evidence_ref_id: null, completion_note: note };
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
  const opp = oppRows?.[0];
  if (!opp) throw new Error('Oportunidad no encontrada');

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
      updated_at: now
    })
  });
  const completed = completedRows?.[0] || task;

  const rule = TASK_RULES[task.task_type] || TASK_RULES.manual;
  const oppPatch = { updated_at: now };
  if (rule.stage) oppPatch.stage = rule.stage;
  if (task.task_type === 'contact_client' && !opp.first_contact_at) oppPatch.first_contact_at = now;
  if (task.task_type === 'qualify') oppPatch.qualified_at = now;
  if (task.task_type === 'close_won') {
    oppPatch.stage = 'won';
    oppPatch.status = 'won';
    oppPatch.closed_at = now;
  }
  if (task.task_type === 'close_lost') {
    oppPatch.stage = 'lost';
    oppPatch.status = 'lost';
    oppPatch.closed_at = now;
    oppPatch.lost_reason = evidence.lost_reason;
    oppPatch.lost_reason_note = evidence.lost_reason_note || null;
  }

  const updatedOppRows = await sb(`crm_opportunities?id=eq.${opp.id}&organization_id=eq.${orgId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(oppPatch)
  });
  const updatedOpp = updatedOppRows?.[0] || { ...opp, ...oppPatch };

  let nextTask = null;
  if (rule.next && updatedOpp.status === 'open') {
    nextTask = await createAutoTask({
      orgId,
      opportunity: updatedOpp,
      type: rule.next,
      session,
      sequence: Number(task.sequence || 0) + 1
    });
  }

  const nextRule = nextTask ? TASK_RULES[nextTask.task_type] : null;
  await sb(`crm_cap?organization_id=eq.${orgId}&opportunity_id=eq.${opp.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: updatedOpp.status === 'open' ? 'active' : 'closed',
      step: nextTask?.task_type || task.task_type,
      decision: updatedOpp.status === 'won' ? 'ganado' : updatedOpp.status === 'lost' ? 'perdido' : null,
      next_action: nextTask?.title || null,
      next_action_at: nextTask?.due_at || null,
      sequence: Number(task.sequence || 0) + 1,
      closed_at: updatedOpp.status === 'open' ? null : now,
      updated_at: now
    })
  });

  await audit(session, orgId, 'task.completed', 'task', task.id, task, completed, {
    opportunity_id: opp.id,
    evidence_type: evidence.evidence_type || null,
    next_task_id: nextTask?.id || null
  });

  return { task: completed, opportunity: updatedOpp, next_task: nextTask, next_action: nextRule?.title || null };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const session = verifySession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'CRM session required' });

  try {
    const org = await organizationForSession(session);
    if (!org) return res.status(403).json({ ok: false, error: 'No active organization in session' });
    const orgId = org.id;

    if (!hasModuleAccess(session, 'tasks', req.method === 'GET' ? 'read' : 'edit')) {
      return res.status(403).json({ ok: false, error: 'No tienes acceso al motor de ejecución' });
    }

    if (req.method === 'GET') {
      await ensureRuleOfGold(orgId, session);
      const scope = (!isPlatformAdmin(session) && !isOrgOwner(session) && ['sales','agent'].includes(session.role))
        ? `&assigned_user_id=eq.${encodeURIComponent(session.sub)}`
        : '';
      const rows = await sb(
        `crm_tasks?organization_id=eq.${orgId}&status=in.(pending,in_progress)${scope}&select=*,contact:crm_contacts(id,display_name,phone,email,metadata),opportunity:crm_opportunities(id,title,stage,status,value,priority,product,city,quantity,usage_type,urgency,source,owner_user_id,conversation_id,conversation:crm_conversations(id,unread_count,last_message_at),cap:crm_cap(step,next_action,next_action_at,sequence))&order=due_at.asc.nullslast,created_at.asc&limit=250`
      );
      const queue = (rows || []).map(enrichTask).sort((a,b) => b.execution_score - a.execution_score);
      return res.status(200).json({
        ok: true,
        organization: org,
        next_task: queue[0] || null,
        queue,
        summary: {
          total: queue.length,
          overdue: queue.filter(x=>x.timing_state==='overdue').length,
          due_soon: queue.filter(x=>x.timing_state==='due_soon').length,
          p1: queue.filter(x=>x.opportunity?.priority==='P1').length
        }
      });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '');
      if (action === 'complete_task') {
        const result = await completeTask(orgId, session, req.body);
        return res.status(200).json({ ok: true, ...result });
      }
      if (action === 'start_task') {
        const id = String(req.body?.task_id || '');
        const rows = await sb(`crm_tasks?id=eq.${encodeURIComponent(id)}&organization_id=eq.${orgId}&status=eq.pending&select=*&limit=1`);
        const task = rows?.[0];
        if (!task) return res.status(404).json({ ok:false, error:'Tarea no encontrada o ya iniciada' });
        const started = await sb(`crm_tasks?id=eq.${task.id}&organization_id=eq.${orgId}`, {
          method:'PATCH', headers:{Prefer:'return=representation'},
          body:JSON.stringify({status:'in_progress',started_at:new Date().toISOString(),updated_at:new Date().toISOString()})
        });
        await audit(session,orgId,'task.started','task',task.id,task,started?.[0]||null);
        return res.status(200).json({ok:true,task:started?.[0]||task});
      }
      return res.status(400).json({ ok:false, error:'Acción no válida' });
    }

    res.setHeader('Allow','GET, POST');
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  } catch (error) {
    console.error('CRM_EXECUTION_ERROR', error.message);
    return res.status(500).json({ ok:false, error:error.message || 'No fue posible ejecutar el motor comercial' });
  }
};
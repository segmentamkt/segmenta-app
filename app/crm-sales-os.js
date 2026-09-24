(() => {
  const STAGES=['new','contacting','opportunity','quote','follow_up','negotiation','won'];
  const STAGE_LABEL={new:'Nuevo',contacting:'Contacto',opportunity:'Calificado',quote:'Oferta',follow_up:'Seguimiento',negotiation:'Negociación',won:'Cierre'};
  const GUIDES={
    contact_client:{title:'Contactar ahora',objective:'Conseguir una respuesta útil antes de entregar información de más.',script:'Haz una sola pregunta clara para entender qué quiere lograr el lead. No envíes catálogo, precios o una explicación larga sin contexto.'},
    qualify:{title:'Calificar necesidad',objective:'Completar los datos mínimos que determinan el siguiente paso.',script:'Pregunta por necesidad, cantidad, ciudad, uso, urgencia y origen. Completa los campos a medida que el cliente responde.'},
    quote:{title:'Preparar oferta',objective:'Crear una cotización vinculada antes de avanzar.',script:'Confirma que lo ofrecido corresponde a la necesidad ya calificada. El sistema no permitirá avanzar sin cotización.'},
    follow_up_24h:{title:'Seguimiento 1',objective:'Retomar sin repetir el mensaje anterior.',script:'Haz seguimiento breve y con contexto. Registra si hay interés, falta información, no responde o se pierde.'},
    follow_up_48h:{title:'Seguimiento 2',objective:'Recuperar la conversación o definir siguiente tratamiento.',script:'Pregunta si sigue siendo prioridad. No abras una conversación nueva desde cero.'},
    follow_up_72h:{title:'Seguimiento final',objective:'Cerrar el ciclo de seguimiento actual.',script:'Busca una decisión concreta: continuar, pausar o cerrar.'},
    future_follow_up:{title:'Seguimiento futuro',objective:'Retomar en la fecha acordada.',script:'Recuerda el contexto que dejó el cliente y evita volver a calificar desde cero.'},
    send_message:{title:'Enviar información',objective:'Responder exactamente lo que falta para que el lead pueda decidir.',script:'Entrega la información pendiente y termina con una pregunta que mantenga la conversación avanzando.'},
    negotiation:{title:'Negociar / cerrar',objective:'Convertir interés en una decisión concreta.',script:'Registra el resultado de la negociación. Si hay objeción, escríbela antes de decidir el siguiente paso.'},
    close_won:{title:'Registrar venta',objective:'Cerrar con datos operativos completos.',script:'Confirma producto, cantidad, valor, ciudad, origen y método de pago.'},
    close_lost:{title:'Cerrar perdido',objective:'Registrar por qué se perdió para aprender y no perseguir leads muertos.',script:'Selecciona un motivo real. Si eliges otro, explica brevemente qué ocurrió.'},
    call:{title:'Realizar llamada',objective:'Resolver por llamada lo que no avanza por chat.',script:'Haz la llamada y registra un resumen accionable.'}
  };
  let state={data:null,task:null,chat:null,outcome:null,busy:false,quoteCreated:false};

  function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function money(v){try{return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0)}catch(_){return '$'+Number(v||0)}}
  function rel(v){
    if(!v)return 'sin fecha';
    const d=new Date(v),diff=d-Date.now(),m=Math.round(Math.abs(diff)/60000);
    if(diff<0)return m<60?`vencida hace ${m} min`:`vencida`;
    if(m<60)return `en ${m} min`;
    if(m<1440)return `en ${Math.round(m/60)} h`;
    return d.toLocaleDateString('es-CO',{day:'2-digit',month:'short'});
  }
  function orgSlug(){return window.crmSession?.organization?.slug||'segmenta'}
  function guide(t){return GUIDES[t?.task_type]||{title:t?.title||'Siguiente acción',objective:t?.description||'Completa la acción indicada.',script:'Ejecuta la acción, registra evidencia y deja definido el siguiente paso.'}}
  function stageNorm(s){const m={lead_new:'new',contacted:'contacting',qualified:'opportunity',proposal:'quote'};return m[s]||s||'new'}
  function ensure(){
    const page=document.getElementById('page-dashboard');if(!page)return null;
    let root=document.getElementById('salesOS');
    if(!root){root=document.createElement('div');root.id='salesOS';page.appendChild(root)}
    return root;
  }
  function taskName(t){return t?.contact?.display_name||t?.opportunity?.title||'Lead'}
  function source(t){return t?.opportunity?.source||t?.opportunity?.conversation?.channel_type||'CRM'}
  function queueHtml(){
    const q=state.data?.queue||[];
    if(!q.length)return '<div class="so-loading">No hay acciones obligatorias pendientes.</div>';
    return q.slice(0,40).map((t,i)=>`<button class="so-item ${state.task?.id===t.id?'active':''}" type="button" data-task="${esc(t.id)}"><span class="so-num">${i+1}</span><span><b>${esc(taskName(t))}</b><small>${esc(t.title||guide(t).title)} · ${esc(source(t))}<br><span class="so-due">${esc(rel(t.due_at))}</span></small></span></button>`).join('');
  }
  function stageHtml(){
    const current=stageNorm(state.task?.opportunity?.stage),idx=Math.max(0,STAGES.indexOf(current));
    return STAGES.map((s,i)=>`<span class="so-stage-dot ${i<idx?'done':i===idx?'current':''}" title="${esc(STAGE_LABEL[s])}">${i<idx?'✓':i+1}</span>${i<STAGES.length-1?'<span class="so-stage-line"></span>':''}`).join('');
  }
  function evidenceChecks(){
    const t=state.task,o=t?.opportunity||{},c=t?.contact||{},msgs=state.chat?.messages||[];
    const outbound=msgs.some(m=>m.direction==='outbound'&&new Date(m.sent_at)>=new Date(t?.created_at||0));
    const rows=[];
    const add=(label,ok,detail)=>rows.push({label,ok,detail});
    if(['contact_client','send_message','follow_up_24h','follow_up_48h','follow_up_72h','future_follow_up'].includes(t?.task_type))add('Mensaje ejecutado',outbound,outbound?'Evidencia encontrada':'Escribe al cliente desde el chat');
    if(t?.task_type==='qualify'){
      add('Nombre',!!c.display_name);add('Teléfono',!!c.phone);add('Servicio',!!o.product);add('Cantidad',Number(o.quantity)>0);add('Ciudad',!!o.city);add('Uso',!!o.usage_type);add('Urgencia',!!o.urgency);add('Origen',!!o.source);
    }
    if(t?.task_type==='quote')add('Cotización vinculada',false,'Se valida al completar');
    if(t?.task_type==='negotiation')add('Resultado documentado',!!document.getElementById('soNote')?.value);
    if(t?.task_type==='close_won'){add('Producto',!!o.product);add('Cantidad',Number(o.quantity)>0);add('Valor',Number(o.value)>0);add('Ciudad',!!o.city);add('Origen',!!o.source)}
    if(!rows.length)add('Resultado registrado',!!document.getElementById('soNote')?.value,'Escribe una nota breve');
    return rows;
  }
  function outcomesHtml(t){
    let options=[];
    if(['follow_up_24h','follow_up_48h','follow_up_72h','future_follow_up'].includes(t?.task_type))options=[['interested','Interesado'],['needs_info','Necesita info'],['no_response','No responde'],['lost','Perdido']];
    if(t?.task_type==='negotiation')options=[['won','Ganado'],['follow_up','Seguimiento'],['lost','Perdido']];
    if(!options.length)return '';
    return `<div class="so-field"><label>Resultado obligatorio</label><div class="so-results">${options.map(([v,l])=>`<button type="button" class="so-choice ${state.outcome===v?'active':''}" data-outcome="${v}">${l}</button>`).join('')}</div></div>`;
  }
  function qualificationHtml(t){
    if(t?.task_type!=='qualify')return '';
    const o=t.opportunity||{},c=t.contact||{};
    return `<div class="so-row"><div class="so-field"><label>Nombre</label><input id="soName" value="${esc(c.display_name||'')}"></div><div class="so-field"><label>Teléfono</label><input id="soPhone" value="${esc(c.phone||'')}"></div></div>
      <div class="so-field"><label>Producto / servicio</label><input id="soProduct" value="${esc(o.product||'')}"></div>
      <div class="so-row"><div class="so-field"><label>Cantidad</label><input id="soQty" type="number" min="1" value="${esc(o.quantity||'')}"></div><div class="so-field"><label>Ciudad</label><input id="soCity" value="${esc(o.city||'')}"></div></div>
      <div class="so-row"><div class="so-field"><label>Uso</label><select id="soUsage"><option value="">Seleccionar</option><option value="uso_propio" ${o.usage_type==='uso_propio'?'selected':''}>Uso propio</option><option value="reventa" ${o.usage_type==='reventa'?'selected':''}>Reventa</option><option value="empresa" ${o.usage_type==='empresa'?'selected':''}>Empresa</option></select></div><div class="so-field"><label>Urgencia</label><select id="soUrgency"><option value="">Seleccionar</option><option value="hoy" ${o.urgency==='hoy'?'selected':''}>Hoy</option><option value="esta_semana" ${o.urgency==='esta_semana'?'selected':''}>Esta semana</option><option value="este_mes" ${o.urgency==='este_mes'?'selected':''}>Este mes</option><option value="sin_urgencia" ${o.urgency==='sin_urgencia'?'selected':''}>Sin urgencia</option></select></div></div>
      <div class="so-field"><label>Origen</label><input id="soSource" value="${esc(o.source||'')}"></div>
      <button type="button" class="so-secondary" id="soSaveQualification">Guardar datos de calificación</button>`;
  }
  function closingHtml(t){
    if(t?.task_type==='close_won')return `<div class="so-field"><label>Método de pago</label><input id="soPayment" placeholder="Transferencia, efectivo, tarjeta..."></div>`;
    if(t?.task_type==='close_lost')return `<div class="so-field"><label>Motivo de pérdida</label><select id="soLost"><option value="">Seleccionar</option><option value="precio">Precio</option><option value="sin_respuesta">Sin respuesta</option><option value="no_prioridad">No es prioridad</option><option value="competencia">Competencia</option><option value="otro">Otro</option></select></div><div class="so-field"><label>Detalle</label><textarea id="soLostNote"></textarea></div>`;
    if(t?.task_type==='future_follow_up'&&state.outcome==='no_response')return `<div class="so-field"><label>Nueva fecha de seguimiento</label><input id="soFuture" type="datetime-local"></div>`;
    return '';
  }
  function actionHelper(t){
    if(t?.task_type==='quote'){
      const o=t.opportunity||{},qty=Math.max(1,Number(o.quantity)||1),total=Math.max(0,Number(o.value)||0),unit=total?Math.round(total/qty):0;
      return `<div class="so-row"><div class="so-field"><label>Cantidad</label><input id="soQuoteQty" type="number" min="1" value="${qty}"></div><div class="so-field"><label>Valor unitario</label><input id="soQuoteUnit" type="number" min="0" value="${unit}"></div></div><button type="button" class="so-secondary" id="soCreateQuote">${state.quoteCreated?'✓ Cotización creada':'Crear cotización vinculada'}</button>`;
    }
    return '';
  }
  function render(){
    const root=ensure();if(!root)return;
    const d=state.data||{},t=state.task,sum=d.summary||{},g=guide(t),o=t?.opportunity||{};
    root.innerHTML=`<div class="so-shell">
      <aside class="so-queue">
        <div class="so-queue-head"><div class="so-eyebrow">Cola automática</div><h2>Qué sigue</h2><p>No eliges el lead. El sistema prioriza por SLA, etapa y urgencia.</p><div class="so-queue-stats"><span class="so-pill"><b>${Number(sum.total||0)}</b> pendientes</span><span class="so-pill"><b>${Number(sum.overdue||0)}</b> vencidas</span><span class="so-pill"><b>${Number(sum.p1||0)}</b> P1</span></div></div>
        <div class="so-list">${queueHtml()}</div>
      </aside>
      <main class="so-main">
        <div class="so-main-head"><div><div class="so-eyebrow">${t?'Tarea actual · '+esc(source(t)):'Sistema comercial'}</div><h1>${t?esc(taskName(t)):'Cola al día'}</h1><div class="so-contact-meta">${t?esc(o.product||'Servicio por definir')+' · '+esc(o.city||'Sin ciudad'):'Cuando entre un lead, aparecerá aquí.'}</div></div><span class="so-badge">● EJECUCIÓN CONTROLADA</span></div>
        <div class="so-messages" id="soMessages">${chatHtml()}</div>
        <div class="so-compose"><div class="so-compose-row"><textarea id="soComposer" placeholder="${t?.opportunity?.conversation_id?'Escribe al cliente...':'Esta tarea no tiene conversación conectada. Usa la nota del panel.'}" ${t?.opportunity?.conversation_id?'':'disabled'}></textarea><button class="so-send" id="soSend" type="button" ${t?.opportunity?.conversation_id?'':'disabled'}>Enviar</button></div><div class="so-compose-note"><span>Enter envía · Shift+Enter hace salto</span><span>${t?.opportunity?.conversation_id?'Conversación real':'Sin canal conectado'}</span></div></div>
      </main>
      <aside class="so-panel">
        <div class="so-panel-head"><div class="so-eyebrow">Control de ejecución</div><h2>${t?esc(g.title):'Sin tarea'}</h2><p>${t?'No puedes avanzar hasta cumplir lo obligatorio.':'No hay tareas pendientes.'}</p></div>
        ${t?`<div class="so-stage"><div class="so-stage-track">${stageHtml()}</div></div>
        <div class="so-playbook"><div class="so-task-title">${esc(t.title||g.title)}</div><div class="so-block"><div class="k">Objetivo</div><p>${esc(g.objective)}</p></div><div class="so-block so-script"><div class="k">Qué hacer / decir</div><p>${esc(g.script)}</p></div></div>
        <div class="so-checks" id="soChecks">${checksHtml()}</div>
        <div class="so-form">${qualificationHtml(t)}${outcomesHtml(t)}${closingHtml(t)}${actionHelper(t)}<div class="so-field"><label>Nota de ejecución</label><textarea id="soNote" placeholder="Qué pasó, objeción o contexto relevante..."></textarea></div><div class="so-error" id="soError"></div><button type="button" class="so-primary" id="soComplete">Completar paso y generar siguiente →</button></div>`:'<div class="so-loading">Todo al día.</div>'}
      </aside>
    </div>`;
    bind();
  }
  function chatHtml(){
    if(!state.task)return '<div class="so-empty-chat"><b>No hay tareas pendientes</b>El sistema mostrará aquí la conversación del siguiente lead que requiera atención.</div>';
    if(state.chat===null)return '<div class="so-empty-chat"><b>Cargando conversación…</b>Buscando el historial del lead.</div>';
    const msgs=state.chat?.messages||[];
    if(!state.task?.opportunity?.conversation_id)return '<div class="so-empty-chat"><b>Esta acción no tiene chat conectado</b>Ejecuta la tarea usando el panel de la derecha y registra la evidencia requerida.</div>';
    if(!msgs.length)return '<div class="so-empty-chat"><b>Conversación lista</b>Aún no hay mensajes guardados. Puedes iniciar desde el cuadro inferior.</div>';
    return msgs.map(m=>`<div class="so-msg ${m.direction==='outbound'?'out':'in'}"><div class="txt">${esc(m.text||'[Adjunto]')}</div><div class="time">${m.direction==='outbound'?'Tú':'Cliente'} · ${new Date(m.sent_at||m.created_at).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}</div></div>`).join('');
  }
  function checksHtml(){return evidenceChecks().map(x=>`<div class="so-check ${x.ok?'ok':''}"><span class="i">${x.ok?'✓':'○'}</span><div><b>${esc(x.label)}</b>${x.detail?`<span>${esc(x.detail)}</span>`:''}</div></div>`).join('')}
  function bind(){
    document.querySelectorAll('#salesOS [data-task]').forEach(b=>b.addEventListener('click',()=>selectTask(b.dataset.task)));
    document.querySelectorAll('#salesOS [data-outcome]').forEach(b=>b.addEventListener('click',()=>{state.outcome=b.dataset.outcome;render()}));
    const send=document.getElementById('soSend'),comp=document.getElementById('soComposer');
    send?.addEventListener('click',sendMessage);comp?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}});
    document.getElementById('soComplete')?.addEventListener('click',complete);
    document.getElementById('soSaveQualification')?.addEventListener('click',saveQualification);
    document.getElementById('soCreateQuote')?.addEventListener('click',createQuote);
    setTimeout(()=>{const m=document.getElementById('soMessages');if(m)m.scrollTop=m.scrollHeight},0);
  }
  async function selectTask(id){
    state.task=(state.data?.queue||[]).find(x=>x.id===id)||state.task;state.chat=null;state.outcome=null;state.quoteCreated=false;render();await loadChat();
  }
  async function loadChat(){
    const id=state.task?.opportunity?.conversation_id;
    if(!id){state.chat={messages:[]};render();return}
    try{
      const r=await fetch('/api/crm-inbox?org='+encodeURIComponent(orgSlug())+'&conversation_id='+encodeURIComponent(id),{cache:'no-store'}),j=await r.json();
      if(!r.ok)throw new Error(j.error||'No fue posible cargar la conversación');
      state.chat=j;
    }catch(e){state.chat={messages:[],error:e.message}}
    render();
  }
  async function sendMessage(){
    if(state.busy)return;
    const input=document.getElementById('soComposer'),text=input?.value.trim(),id=state.task?.opportunity?.conversation_id;if(!text||!id)return;
    const btn=document.getElementById('soSend');state.busy=true;if(btn){btn.disabled=true;btn.textContent='Enviando…'}
    try{
      const r=await fetch('/api/crm-inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send_message',conversation_id:id,text})}),j=await r.json();
      if(!r.ok)throw new Error(j.error||'No fue posible enviar');
      if(input)input.value='';await loadChat();
    }catch(e){const er=document.getElementById('soError');if(er)er.textContent=e.message}
    finally{state.busy=false;if(btn){btn.disabled=false;btn.textContent='Enviar'}}
  }
  async function saveQualification(){
    const t=state.task;if(!t)return;
    const btn=document.getElementById('soSaveQualification');if(btn){btn.disabled=true;btn.textContent='Guardando…'}
    try{
      const oppBody={action:'update_opportunity',id:t.opportunity.id,product:document.getElementById('soProduct')?.value,quantity:document.getElementById('soQty')?.value,city:document.getElementById('soCity')?.value,usage_type:document.getElementById('soUsage')?.value,urgency:document.getElementById('soUrgency')?.value,source:document.getElementById('soSource')?.value};
      let r=await fetch('/api/crm-commercial',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(oppBody)}),j=await r.json();if(!r.ok)throw new Error(j.error||'No fue posible guardar la oportunidad');
      if(t.opportunity.conversation_id){
        r=await fetch('/api/crm-inbox',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversation_id:t.opportunity.conversation_id,display_name:document.getElementById('soName')?.value,phone:document.getElementById('soPhone')?.value})});j=await r.json();if(!r.ok)throw new Error(j.error||'No fue posible guardar el contacto');
      }
      await load(t.id);
    }catch(e){const er=document.getElementById('soError');if(er)er.textContent=e.message}
    finally{if(btn){btn.disabled=false;btn.textContent='Guardar datos de calificación'}}
  }
  async function createQuote(){
    if(state.busy||!state.task?.opportunity?.id)return;
    const o=state.task.opportunity,qty=Math.max(1,Number(document.getElementById('soQuoteQty')?.value)||1),unit=Math.max(0,Number(document.getElementById('soQuoteUnit')?.value)||0);
    const er=document.getElementById('soError');if(er)er.textContent='';state.busy=true;
    try{
      const r=await fetch('/api/crm-commercial',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create_quote',opportunity_id:o.id,items:[{description:o.product||'Servicio',quantity:qty,unit_price:unit}],observations:'Creada desde Ejecución guiada'})}),j=await r.json();
      if(!r.ok)throw new Error(j.error||'No fue posible crear la cotización');
      state.quoteCreated=true;window.toast?.('Cotización vinculada creada');render();
    }catch(e){if(er)er.textContent=e.message}
    finally{state.busy=false}
  }
  async function complete(){
    if(state.busy||!state.task)return;
    const t=state.task,body={action:'complete_task',task_id:t.id,completion_note:document.getElementById('soNote')?.value||''};
    if(state.outcome)body.outcome=state.outcome;
    if(t.task_type==='close_won')body.payment_method=document.getElementById('soPayment')?.value||'';
    if(t.task_type==='close_lost'){body.lost_reason=document.getElementById('soLost')?.value||'';body.lost_reason_note=document.getElementById('soLostNote')?.value||''}
    if(t.task_type==='future_follow_up'&&state.outcome==='no_response')body.future_due_at=document.getElementById('soFuture')?.value||'';
    const btn=document.getElementById('soComplete'),er=document.getElementById('soError');if(er)er.textContent='';state.busy=true;if(btn){btn.disabled=true;btn.textContent='Validando…'}
    try{
      const r=await fetch('/api/crm-execution',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json();
      if(!r.ok)throw new Error(j.error||'No se pudo completar la tarea');
      window.toast?.('Paso completado · siguiente acción generada');await load();
    }catch(e){if(er)er.textContent=e.message}
    finally{state.busy=false;if(btn){btn.disabled=false;btn.textContent='Completar paso y generar siguiente →'}}
  }
  async function load(preferId){
    if(window.crmSession?.role==='client'||new URLSearchParams(location.search).get('client_preview')==='1')return;
    const root=ensure();if(root&&!root.innerHTML)root.innerHTML='<div class="so-loading">Preparando tu cola comercial…</div>';
    try{
      const r=await fetch('/api/crm-execution',{cache:'no-store'}),j=await r.json();if(!r.ok)throw new Error(j.error||'No fue posible cargar ejecución');
      state.data=j;
      state.task=preferId?(j.queue||[]).find(x=>x.id===preferId)||j.next_task:j.next_task;
      state.outcome=null;state.chat=null;state.quoteCreated=false;render();await loadChat();
    }catch(e){if(root)root.innerHTML='<div class="so-loading">'+esc(e.message)+'</div>'}
  }
  function applyRole(){
    const role=window.crmSession?.role;if(role==='client'||new URLSearchParams(location.search).get('client_preview')==='1')return;
    const agent=['sales','agent'].includes(role)&&!window.crmSession?.platform_admin;
    document.body.classList.toggle('sales-os-agent',agent);
    const host=document.getElementById('hostBackLink');if(host)host.classList.add('hidden');
    const org=document.getElementById('orgContextName');if(org&&window.crmSession?.organization?.name)org.textContent=window.crmSession.organization.name;
  }
  window.loadSalesOS=load;
  const oldDash=window.loadDashboard;
  if(oldDash)window.loadDashboard=async function(){try{await oldDash.apply(this,arguments)}catch(_){};applyRole();await load()};
  const oldSession=window.renderCrmSession;
  if(oldSession)window.renderCrmSession=function(){const out=oldSession.apply(this,arguments);applyRole();setTimeout(()=>load(),0);return out};
  function init(){ensure();applyRole();if(window.crmSession)load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
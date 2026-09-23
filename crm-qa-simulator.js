(() => {
  let qa=null,execution=null,outcome=null,busy=false;
  const STAGES=['new','contacting','opportunity','quote','follow_up','negotiation','won'];
  const LABELS={new:'Nuevo',contacting:'Contacto',opportunity:'Calificado',quote:'Oferta',follow_up:'Seguimiento',negotiation:'Negociación',won:'Cierre'};
  const GUIDES={
    contact_client:['Contactar lead','Conseguir una respuesta útil.','Haz una pregunta clara y evita soltar toda la información de una vez.'],
    qualify:['Calificar','Completar datos mínimos de decisión.','Confirma necesidad, cantidad, ciudad, uso, urgencia y origen.'],
    quote:['Preparar oferta','Crear una cotización vinculada.','El sistema debe bloquear el avance hasta que exista una oferta.'],
    follow_up_24h:['Seguimiento 1','Retomar la conversación con contexto.','No repitas el primer mensaje. Busca una señal concreta de interés.'],
    follow_up_48h:['Seguimiento 2','Definir si continúa o se enfría.','Pregunta si sigue siendo prioridad y registra el resultado.'],
    follow_up_72h:['Seguimiento final','Cerrar el ciclo de seguimiento.','Busca una decisión: continuar, pausar o cerrar.'],
    future_follow_up:['Seguimiento futuro','Retomar en la fecha acordada.','Usa el contexto anterior; no empieces de cero.'],
    send_message:['Enviar información','Resolver lo que falta.','Responde la duda puntual y termina con una pregunta.'],
    negotiation:['Negociar / cerrar','Obtener una decisión concreta.','Registra objeción, acuerdo y siguiente paso.'],
    close_won:['Registrar venta','Cerrar con datos operativos completos.','Confirma método de pago y registra el cierre.'],
    close_lost:['Cerrar perdido','Documentar por qué se perdió.','El motivo alimenta aprendizaje comercial.']
  };
  function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function allowed(){return !!(window.crmSession?.platform_admin||['owner','admin'].includes(window.crmSession?.role))}
  async function api(method,path,body){
    const r=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'No fue posible completar la prueba');return j;
  }
  function ensureNav(){
    const btn=document.querySelector('.nav-item[data-page="qa"]');if(btn)btn.classList.toggle('hidden',!allowed());
  }
  function ensurePage(){
    const main=document.querySelector('main.main');if(!main)return null;
    let page=document.getElementById('page-qa');if(page)return page;
    page=document.createElement('section');page.id='page-qa';page.className='content hidden qa-page';main.appendChild(page);return page;
  }
  function currentTask(){return execution?.next_task||execution?.queue?.[0]||null}
  function stageNorm(s){const m={lead_new:'new',contacted:'contacting',qualified:'opportunity',proposal:'quote'};return m[s]||s||'new'}
  function stageHtml(){
    const st=stageNorm(qa?.opportunity?.stage),idx=Math.max(0,STAGES.indexOf(st));
    return STAGES.map((s,i)=>`<span class="qa-dot ${i<idx?'done':i===idx?'current':''}" title="${LABELS[s]}">${i<idx?'✓':i+1}</span>${i<STAGES.length-1?'<span class="qa-line"></span>':''}`).join('');
  }
  function guide(t){const x=GUIDES[t?.task_type]||[t?.title||'Siguiente tarea',t?.description||'Completa el paso indicado.','Ejecuta, registra y deja evidencia.'];return {title:x[0],objective:x[1],script:x[2]}}
  function messagesHtml(){
    if(!qa?.run)return '<div class="qa-empty"><b>Prueba el proceso como vendedor</b>Inicia la simulación. Tendrás un lead de prueba, una conversación y un panel de ejecución al lado.</div>';
    const msgs=qa.messages||[];
    if(!msgs.length)return '<div class="qa-empty"><b>Conversación preparada</b>Escribe como vendedor y el lead responderá automáticamente.</div>';
    return msgs.map(m=>`<div class="qa-msg ${m.direction==='outbound'?'out':'in'}"><div>${esc(m.text||'[Adjunto]')}</div><div class="time">${m.direction==='outbound'?'Tú':'Lead'} · ${new Date(m.sent_at).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}</div></div>`).join('');
  }
  function taskChecks(){
    const t=currentTask(),checks=[];
    const hasOut=(qa?.messages||[]).some(m=>m.direction==='outbound'&&(!t?.created_at||new Date(m.sent_at)>=new Date(t.created_at)));
    if(['contact_client','send_message','follow_up_24h','follow_up_48h','follow_up_72h','future_follow_up'].includes(t?.task_type))checks.push(['Mensaje del vendedor',hasOut,hasOut?'Evidencia registrada':'Escribe en el chat antes de avanzar']);
    if(t?.task_type==='qualify'){
      const o=qa?.opportunity||{},c=qa?.contact||{};
      checks.push(['Nombre',!!c.display_name],['Teléfono',!!c.phone],['Producto',!!o.product],['Cantidad',Number(o.quantity)>0],['Ciudad',!!o.city],['Uso',!!o.usage_type],['Urgencia',!!o.urgency],['Origen',!!o.source]);
    }
    if(t?.task_type==='quote')checks.push(['Cotización creada',(qa?.quotes||[]).length>0,(qa?.quotes||[]).length?'Lista para avanzar':'Genera la cotización de prueba']);
    if(t?.task_type==='negotiation')checks.push(['Resultado seleccionado',!!outcome]);
    if(t?.task_type==='close_won')checks.push(['Método de pago',!!document.getElementById('qaPayment')?.value]);
    if(!checks.length)checks.push(['Tarea activa',!!t]);
    return checks;
  }
  function checksHtml(){return taskChecks().map(([l,ok,d])=>`<div class="qa-check ${ok?'ok':''}"><i>${ok?'✓':'○'}</i><div><b>${esc(l)}</b>${d?`<small>${esc(d)}</small>`:''}</div></div>`).join('')}
  function outcomeHtml(t){
    let opts=[];
    if(['follow_up_24h','follow_up_48h','follow_up_72h','future_follow_up'].includes(t?.task_type))opts=[['interested','Interesado'],['needs_info','Necesita info'],['no_response','No responde'],['lost','Perdido']];
    if(t?.task_type==='negotiation')opts=[['won','Ganado'],['follow_up','Seguimiento'],['lost','Perdido']];
    if(!opts.length)return '';
    return `<div class="qa-results">${opts.map(([v,l])=>`<button type="button" class="qa-choice ${outcome===v?'active':''}" data-qa-outcome="${v}">${l}</button>`).join('')}</div>`;
  }
  function extraHtml(t){
    if(t?.task_type==='quote')return '<button type="button" class="qa-secondary" id="qaCreateQuote">Generar cotización de prueba</button>';
    if(t?.task_type==='close_won')return '<input id="qaPayment" placeholder="Método de pago (ej. transferencia)">';
    if(t?.task_type==='close_lost')return '<select id="qaLost"><option value="">Motivo de pérdida</option><option value="precio">Precio</option><option value="sin_respuesta">Sin respuesta</option><option value="no_prioridad">No prioridad</option><option value="competencia">Competencia</option><option value="otro">Otro</option></select><textarea id="qaLostNote" placeholder="Detalle"></textarea>';
    if(t?.task_type==='future_follow_up'&&outcome==='no_response')return '<input id="qaFuture" type="datetime-local">';
    return '';
  }
  function render(){
    ensureNav();const page=ensurePage();if(!page)return;
    const t=currentTask(),g=guide(t),active=!!qa?.run;
    page.innerHTML=`<div class="qa-hero"><div><div class="eyebrow">Control de calidad · flujo real</div><h1>Lead automático de prueba</h1><p>Tú eres el vendedor. Hablas con el lead a la izquierda y controlas, al mismo tiempo, el paso obligatorio a la derecha.</p></div><span class="qa-badge">QA AISLADO · no afecta métricas</span></div>
      <div class="qa-os">
        <section class="qa-chat">
          <div class="qa-chat-head"><div class="qa-person"><div class="qa-avatar">Q</div><div><div class="qa-name">${active?esc(qa.contact?.display_name||'Lead QA'):'Lead de prueba'}</div><div class="qa-sub">${active?esc((qa.opportunity?.product||'Producto')+' · '+(qa.opportunity?.city||'Sin ciudad')):'Aún no iniciado'}</div></div></div><span class="qa-live">${active?'● LEAD AUTOMÁTICO':'MODO PRUEBA'}</span></div>
          <div class="qa-messages" id="qaMessages">${messagesHtml()}</div>
          <div class="qa-compose"><div class="qa-compose-row"><textarea id="qaInput" placeholder="Responde como vendedor..." ${active?'':'disabled'}></textarea><button type="button" id="qaSend" class="qa-send" ${active?'':'disabled'}>Enviar</button></div><div class="qa-compose-note">Tú escribes como vendedor. El lead responde solo según lo que preguntes.</div></div>
        </section>
        <aside class="qa-control">
          <div class="qa-control-head"><div class="k">Ejecución comercial</div><h2>${active&&t?esc(g.title):'Iniciar recorrido'}</h2><p>${active&&t?'El sistema valida el paso antes de permitir avanzar.':'Crea un escenario y recorre todo el flujo desde el primer contacto hasta el cierre.'}</p></div>
          ${!active?`<div class="qa-start"><div class="qa-start-card"><h3>Escenario listo</h3><p>Lead interesado en pauta Meta, con datos suficientes para probar contacto, calificación, oferta, seguimiento, negociación y cierre.</p><button type="button" class="qa-primary" id="qaStart">Iniciar prueba conversacional</button></div></div>`:
          `<div class="qa-stage"><div class="qa-stage-track">${stageHtml()}</div></div>
           <div class="qa-task"><div class="eyebrow">Tarea obligatoria actual</div><div class="title">${esc(t?.title||g.title)}</div><div class="qa-block"><div class="k">Objetivo</div><p>${esc(g.objective)}</p></div><div class="qa-block qa-script"><div class="k">Qué hacer / decir</div><p>${esc(g.script)}</p></div></div>
           <div class="qa-checks" id="qaChecks">${checksHtml()}</div>
           <div class="qa-actions">${outcomeHtml(t)}${extraHtml(t)}<textarea id="qaNote" placeholder="Nota de ejecución / objeción / contexto..."></textarea><div class="qa-error" id="qaError"></div><button type="button" class="qa-primary" id="qaComplete" ${t?'':'disabled'}>Completar paso →</button><button type="button" class="qa-danger" id="qaDelete">Eliminar prueba y empezar de nuevo</button></div>`}
        </aside>
      </div>`;
    bind();setTimeout(()=>{const m=document.getElementById('qaMessages');if(m)m.scrollTop=m.scrollHeight},0);
  }
  function bind(){
    document.getElementById('qaStart')?.addEventListener('click',start);
    document.getElementById('qaSend')?.addEventListener('click',send);
    document.getElementById('qaInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
    document.querySelectorAll('[data-qa-outcome]').forEach(b=>b.addEventListener('click',()=>{outcome=b.dataset.qaOutcome;render()}));
    document.getElementById('qaCreateQuote')?.addEventListener('click',createQuote);
    document.getElementById('qaComplete')?.addEventListener('click',complete);
    document.getElementById('qaDelete')?.addEventListener('click',remove);
  }
  async function start(){
    if(busy)return;busy=true;const btn=document.getElementById('qaStart');if(btn){btn.disabled=true;btn.textContent='Creando escenario…'}
    try{
      qa=await api('POST','/api/crm-simulator',{action:'create_run',name:'Laura Prueba',phone:'3000000000',product:'Pauta Meta',quantity:1,city:'Bogotá',usage_type:'empresa',urgency:'esta_semana',priority:'P1',value:1500000,initial_message:'Hola, quiero conseguir más clientes con pauta. ¿Me pueden ayudar?'});
      sessionStorage.setItem('segmenta_qa_run',qa.run.id);await refreshExecution();render();
    }catch(e){window.toast?.(e.message)}finally{busy=false}
  }
  function automaticReply(text){
    const q=String(text||'').toLowerCase(),o=qa?.opportunity||{};
    if(/objetivo|ventas|leads/.test(q))return 'Quiero generar ventas. Hoy dependemos casi todo de Instagram y WhatsApp.';
    if(/presupuesto/.test(q))return 'Puedo invertir alrededor de $1.500.000 al mes en pauta.';
    if(/ciudad|ubicaci/.test(q))return 'Estoy en '+(o.city||'Bogotá')+'.';
    if(/urgencia|cuándo|fecha/.test(q))return 'Quiero arrancar esta semana si tiene sentido.';
    if(/reuni|llamada|agenda/.test(q))return 'Sí, puedo mañana en la tarde.';
    if(/precio|cotiza|propuesta|total/.test(q))return 'Perfecto, envíame la propuesta y el valor final para revisarlo.';
    if(/pago|cerr|avanz/.test(q))return 'Sí, si todo queda como hablamos puedo avanzar con transferencia.';
    return 'Sí, me interesa. ¿Qué necesitas saber para decirme cuál sería el siguiente paso?';
  }
  async function send(){
    if(busy||!qa?.run?.id)return;const inp=document.getElementById('qaInput'),text=inp?.value.trim();if(!text)return;busy=true;const b=document.getElementById('qaSend');if(b){b.disabled=true;b.textContent='Enviando…'}
    try{
      qa=await api('POST','/api/crm-simulator',{action:'message',run_id:qa.run.id,direction:'outbound',text});if(inp)inp.value='';render();
      await new Promise(r=>setTimeout(r,350));
      qa=await api('POST','/api/crm-simulator',{action:'message',run_id:qa.run.id,direction:'inbound',text:automaticReply(text)});await refreshExecution();render();
    }catch(e){window.toast?.(e.message)}finally{busy=false}
  }
  async function refreshExecution(){
    if(!qa?.opportunity?.id){execution=null;return}
    execution=await api('GET','/api/crm-execution?test=1&opportunity_id='+encodeURIComponent(qa.opportunity.id));
  }
  async function refresh(){
    if(!qa?.run?.id)return;
    qa=await api('GET','/api/crm-simulator?run_id='+encodeURIComponent(qa.run.id));await refreshExecution();
  }
  async function createQuote(){
    if(busy||!qa?.opportunity?.id)return;busy=true;
    try{
      const value=Math.max(1,Number(qa.opportunity.value)||1500000),qty=Math.max(1,Number(qa.opportunity.quantity)||1);
      await api('POST','/api/crm-commercial',{action:'create_quote',opportunity_id:qa.opportunity.id,items:[{description:qa.opportunity.product||'Servicio de prueba',quantity:qty,unit_price:value/qty}],observations:'Cotización sintética generada por QA'});
      await refresh();render();window.toast?.('Cotización QA creada');
    }catch(e){const er=document.getElementById('qaError');if(er)er.textContent=e.message}finally{busy=false}
  }
  async function complete(){
    if(busy||!currentTask())return;busy=true;const t=currentTask(),er=document.getElementById('qaError');if(er)er.textContent='';
    const body={action:'complete_task',task_id:t.id,completion_note:document.getElementById('qaNote')?.value||'Ejecutado durante simulación QA'};
    if(outcome)body.outcome=outcome;
    if(t.task_type==='close_won')body.payment_method=document.getElementById('qaPayment')?.value||'';
    if(t.task_type==='close_lost'){body.lost_reason=document.getElementById('qaLost')?.value||'';body.lost_reason_note=document.getElementById('qaLostNote')?.value||''}
    if(t.task_type==='future_follow_up'&&outcome==='no_response')body.future_due_at=document.getElementById('qaFuture')?.value||'';
    const btn=document.getElementById('qaComplete');if(btn){btn.disabled=true;btn.textContent='Validando…'}
    try{
      await api('POST','/api/crm-execution',body);outcome=null;await refresh();render();
    }catch(e){if(er)er.textContent=e.message}
    finally{busy=false;if(btn){btn.disabled=false;btn.textContent='Completar paso →'}}
  }
  async function remove(){
    if(!qa?.run?.id)return;
    if(!confirm('¿Eliminar esta prueba QA?'))return;
    try{await api('DELETE','/api/crm-simulator?run_id='+encodeURIComponent(qa.run.id));sessionStorage.removeItem('segmenta_qa_run');qa=null;execution=null;outcome=null;render()}catch(e){window.toast?.(e.message)}
  }
  async function load(){
    ensureNav();ensurePage();if(!allowed())return;
    const saved=sessionStorage.getItem('segmenta_qa_run');
    if(saved&&!qa){
      try{qa=await api('GET','/api/crm-simulator?run_id='+encodeURIComponent(saved));await refreshExecution()}catch(_){sessionStorage.removeItem('segmenta_qa_run');qa=null}
    }
    render();
  }
  window.refreshQaSimulator=load;
  const oldShow=window.showPage;
  if(oldShow)window.showPage=function(page,...rest){const out=oldShow.call(this,page,...rest);if(page==='qa')setTimeout(load,0);return out};
  const oldSession=window.renderCrmSession;
  if(oldSession)window.renderCrmSession=function(...args){const out=oldSession.apply(this,args);ensureNav();return out};
  function init(){ensurePage();ensureNav();render()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
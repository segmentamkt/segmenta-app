(() => {
  let qaRun=null;
  let qaDirection='inbound';
  const STAGES=[
    ['new','Lead nuevo'],['contacting','Contactando'],['qualification','Calificación'],['opportunity','Oportunidad'],
    ['quote','Cotización'],['follow_up','Seguimiento'],['negotiation','Negociación'],['won','Ganado'],['lost','Perdido'],['future_follow_up','Seguimiento futuro']
  ];
  function escq(s){return String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
  function fmt(v){try{return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0)}catch(_){return '$'+Number(v||0)}}
  function norm(s){const m={lead_new:'new',contacted:'contacting',qualified:'opportunity',proposal:'quote'};return m[s]||s||'new'}
  async function api(method,path,body){
    const r=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||'No fue posible completar la prueba');
    return j;
  }
  function allowed(){
    return !!(window.crmSession?.platform_admin||['owner','admin'].includes(window.crmSession?.role));
  }
  function ensureNav(){
    const tasks=document.querySelector('.nav-item[data-page="tasks"]');
    if(!tasks)return;
    let btn=document.querySelector('.nav-item[data-page="qa"]');
    if(!btn){
      btn=document.createElement('button');
      btn.className='nav-item';btn.dataset.page='qa';btn.innerHTML='<span class="ico">◈</span>Simulador QA';
      btn.onclick=()=>window.showPage('qa',btn);
      tasks.insertAdjacentElement('afterend',btn);
    }
    btn.classList.toggle('hidden',!allowed());
  }
  function ensurePage(){
    const main=document.querySelector('main.main');if(!main)return null;
    let page=document.getElementById('page-qa');
    if(page)return page;
    page=document.createElement('section');
    page.id='page-qa';page.className='content hidden qa-page';
    page.innerHTML=`
      <div class="qa-hero">
        <div><div class="eyebrow">Control de calidad</div><h1>Lead automático de prueba</h1><p>Escribe como vendedor. El cliente simulado responde solo y el CRM debe obligarte a completar cada paso en orden.</p></div>
        <span class="qa-badge">◈ MODO QA · no afecta métricas reales</span>
      </div>
      <div class="qa-grid">
        <section class="qa-card">
          <h3>Crear escenario</h3><p>Genera un lead sintético totalmente aislado de los reportes comerciales reales.</p>
          <form id="qaCreateForm" class="qa-form">
            <div class="qa-field"><label>Nombre</label><input id="qaName" value="Laura Prueba"></div>
            <div class="qa-field"><label>Teléfono</label><input id="qaPhone" value="3000000000"></div>
            <div class="qa-field full"><label>Producto / servicio</label><input id="qaProduct" value="Producto de prueba"></div>
            <div class="qa-field"><label>Cantidad</label><input id="qaQty" type="number" min="1" value="2"></div>
            <div class="qa-field"><label>Ciudad</label><input id="qaCity" value="Bogotá"></div>
            <div class="qa-field"><label>Uso</label><select id="qaUsage"><option value="uso_propio">Uso propio</option><option value="reventa">Reventa</option><option value="empresa">Empresa</option></select></div>
            <div class="qa-field"><label>Urgencia</label><select id="qaUrgency"><option value="hoy">Hoy</option><option value="esta_semana" selected>Esta semana</option><option value="este_mes">Este mes</option><option value="sin_urgencia">Sin urgencia</option></select></div>
            <div class="qa-field"><label>Prioridad</label><select id="qaPriority"><option value="P1">P1 · Alta</option><option value="P2">P2 · Media</option><option value="P3">P3 · Baja</option></select></div>
            <div class="qa-field"><label>Valor potencial</label><input id="qaValue" type="number" min="0" step="1000" value="500000"></div>
            <div class="qa-field full"><label>Primer mensaje del lead</label><textarea id="qaInitial">Hola, necesito precio y disponibilidad. Quiero comprar esta semana.</textarea></div>
            <div class="qa-field full"><button class="btn primary full" type="submit">＋ Crear lead de prueba</button></div>
          </form>
          <div id="qaRunControls" class="hidden">
            <div class="qa-workflow">
              <div class="qa-workflow-title"><b>Validación automática</b><span class="state ok">QA activo</span></div>
              <div id="qaChecks" class="qa-checks"></div>
              <div id="qaStageTrack" class="qa-stage-track"></div>
              <div id="qaTaskBox" class="qa-taskbox" style="margin-top:10px"></div>
              <div class="qa-runbar"><button class="btn primary" id="qaExecuteBtn" type="button">Ejecutar tarea actual</button><button class="btn" id="qaGuardBtn" type="button">Probar bloqueo</button><button class="btn danger" id="qaDeleteBtn" type="button">Eliminar prueba</button></div>
              <div class="qa-note">La prueba crea contactos, conversación, oportunidad, CAP y tareas marcadas como QA. Se excluyen del Dashboard, Pipeline y reportes reales.</div>
            </div>
          </div>
        </section>
        <section class="qa-card qa-chat">
          <div class="qa-chat-head"><div class="qa-chat-title"><div class="qa-avatar">Q</div><div><div class="qa-chat-name" id="qaChatName">Lead simulado</div><div class="qa-chat-sub" id="qaChatSub">Crea un escenario para comenzar</div></div></div><div style="display:flex;gap:6px"><button class="btn" id="qaAutoReplyBtn" type="button">✦ Lead automático</button><button class="btn" id="qaRefreshBtn" type="button">↻</button></div></div>
          <div class="qa-messages" id="qaMessages"><div class="qa-empty"><b>Conversa como un lead real</b>Podrás escribir como cliente o como agente y comprobar que el motor exige evidencia antes de avanzar.</div></div>
          <div class="qa-compose">
            <div class="qa-role-toggle"><button type="button" class="qa-role active" data-dir="inbound">Escribir como lead</button><button type="button" class="qa-role" data-dir="outbound">Responder como agente</button></div>
            <div class="qa-compose-row"><textarea id="qaMessageInput" placeholder="Escribe un mensaje de prueba..." disabled></textarea><button id="qaSendBtn" class="qa-send" type="button" disabled>Enviar</button></div>
          </div>
        </section>
      </div>`;
    main.appendChild(page);
    bindPage();
    return page;
  }
  function bindPage(){
    document.getElementById('qaCreateForm')?.addEventListener('submit',createRun);
    document.getElementById('qaSendBtn')?.addEventListener('click',sendMessage);
    document.getElementById('qaRefreshBtn')?.addEventListener('click',()=>window.refreshQaSimulator());
    document.getElementById('qaDeleteBtn')?.addEventListener('click',deleteRun);
    document.getElementById('qaGuardBtn')?.addEventListener('click',testGuard);
    document.getElementById('qaAutoReplyBtn')?.addEventListener('click',autoLeadReply);
    document.getElementById('qaExecuteBtn')?.addEventListener('click',()=>{if(qaRun?.active_task)window.openExecutionTask?.(qaRun.active_task.id)});
    document.querySelectorAll('.qa-role').forEach(btn=>btn.addEventListener('click',()=>{
      qaDirection=btn.dataset.dir;
      document.querySelectorAll('.qa-role').forEach(x=>x.classList.toggle('active',x===btn));
      document.getElementById('qaMessageInput').placeholder=qaDirection==='inbound'?'Escribe como el cliente...':'Escribe como el agente...';
    }));
  }
  async function createRun(e){
    e.preventDefault();
    try{
      const j=await api('POST','/api/crm-simulator',{
        action:'create_run',
        name:document.getElementById('qaName').value,
        phone:document.getElementById('qaPhone').value,
        product:document.getElementById('qaProduct').value,
        quantity:document.getElementById('qaQty').value,
        city:document.getElementById('qaCity').value,
        usage_type:document.getElementById('qaUsage').value,
        urgency:document.getElementById('qaUrgency').value,
        priority:document.getElementById('qaPriority').value,
        value:document.getElementById('qaValue').value,
        initial_message:document.getElementById('qaInitial').value
      });
      qaRun=j;
      sessionStorage.setItem('segmenta_qa_run',j.run.id);
      render();
      window.toast?.('Lead QA creado · flujo obligatorio iniciado');
    }catch(err){window.toast?.(err.message)}
  }
  async function sendMessage(){
    if(!qaRun?.run?.id)return;
    const input=document.getElementById('qaMessageInput'),text=input.value.trim();if(!text)return;
    const btn=document.getElementById('qaSendBtn');
    try{
      if(btn){btn.disabled=true;btn.textContent='Enviando…'}
      const j=await api('POST','/api/crm-simulator',{action:'message',run_id:qaRun.run.id,direction:'outbound',text});
      qaRun=j;input.value='';render();
      await autoLeadReply(true);
      window.toast?.('Lead automático respondió · continúa el flujo');
    }catch(err){window.toast?.(err.message)}
    finally{if(btn){btn.disabled=false;btn.textContent='Enviar'}}
  }
  function automaticLeadText(){
    const task=qaRun?.active_task?.task_type;
    const op=qaRun?.opportunity||{};
    const persona=qaRun?.run?.persona||{};
    const product=op.product||persona.product||'el producto';
    const latest=[...(qaRun?.messages||[])].reverse().find(m=>m.direction==='outbound');
    const asked=String(latest?.text||'').toLowerCase();
    if(/ciudad|dónde|ubicaci/.test(asked))return 'Estoy en '+(op.city||persona.city||'Bogotá')+'.';
    if(/cantidad|cuánt/.test(asked))return 'Necesito '+(op.quantity||persona.quantity||2)+' unidades.';
    if(/uso|reventa|empresa|propio/.test(asked))return op.usage_type==='reventa'?'Es para reventa.':op.usage_type==='empresa'?'Es para mi empresa.':'Es para uso propio.';
    if(/urgencia|cuándo|para cuándo|fecha/.test(asked))return persona.urgency==='hoy'?'Lo necesito hoy.':persona.urgency==='este_mes'?'Lo necesito este mes.':'Lo necesito esta semana.';
    if(/presupuesto/.test(asked))return 'Tengo un presupuesto aproximado de '+fmt(persona.value||op.value||500000)+'.';
    if(/reuni|llamada|agenda|horario/.test(asked))return 'Sí, puedo agendar. Prefiero mañana en la tarde.';
    if(/precio|cotiza|propuesta|total/.test(asked))return 'Perfecto. Envíame el total final y el tiempo de entrega para revisarlo.';
    const byTask={
      contact_client:`Sí, gracias. Estoy interesado en ${product}. Lo necesito pronto y quisiera conocer precio y disponibilidad.`,
      qualify:`Serían ${op.quantity||2} unidades para ${op.usage_type==='reventa'?'reventa':'uso propio'}. Estoy en ${op.city||'Bogotá'}.`,
      quote:'Ya vi la información. ¿Cuál sería el total y cuánto tarda la entrega?',
      follow_up_24h:'Sí, sigo interesado. Si todo está disponible podemos avanzar.',
      follow_up_48h:'Todavía lo estoy revisando, pero me interesa. ¿Me confirmas disponibilidad?',
      follow_up_72h:'Podemos hablar de precio final y forma de pago.',
      negotiation:'Estoy de acuerdo. Si me confirmas el pago y la entrega, cerramos.',
      future_follow_up:'Hola, retomemos esto. Ya estoy listo para revisarlo otra vez.',
      close_won:'Confirmo la compra.',
      close_lost:'Por ahora no voy a comprar.'
    };
    return byTask[task]||`Hola, sigo interesado en ${product}. ¿Cuál es el siguiente paso?`;
  }
  async function autoLeadReply(silent=false){
    if(!qaRun?.run?.id)return;
    try{
      const j=await api('POST','/api/crm-simulator',{action:'message',run_id:qaRun.run.id,direction:'inbound',text:automaticLeadText()});
      qaRun=j;render();if(!silent)window.toast?.('El lead simulado respondió automáticamente');
    }catch(err){window.toast?.(err.message)}
  }
  async function testGuard(){
    const op=qaRun?.opportunity;
    if(!op?.id)return;
    try{
      const r=await fetch('/api/crm-commercial',{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'update_opportunity',id:op.id,stage:'won'})
      });
      const j=await r.json().catch(()=>({}));
      if(r.ok){
        window.toast?.('⚠ El bloqueo falló: la etapa pudo cambiarse manualmente');
      }else{
        window.toast?.('✓ Bloqueo verificado: '+(j.error||'el agente no puede saltar etapas'));
      }
      await window.refreshQaSimulator?.();
    }catch(err){window.toast?.(err.message)}
  }

  async function deleteRun(){
    if(!qaRun?.run?.id)return;
    if(!confirm('¿Eliminar por completo este escenario QA? Se borrarán sus datos sintéticos.'))return;
    try{
      await api('DELETE','/api/crm-simulator?run_id='+encodeURIComponent(qaRun.run.id));
      qaRun=null;sessionStorage.removeItem('segmenta_qa_run');render();window.toast?.('Prueba QA eliminada');
    }catch(err){window.toast?.(err.message)}
  }
  function openInbox(){
    if(!qaRun?.conversation?.id)return;
    window.showPage?.('inbox');
    setTimeout(()=>window.openConversation?.(qaRun.conversation.id),250);
  }
  function render(){
    ensurePage();
    const active=!!qaRun?.run;
    document.getElementById('qaRunControls')?.classList.toggle('hidden',!active);
    const input=document.getElementById('qaMessageInput'),send=document.getElementById('qaSendBtn');
    if(input)input.disabled=!active;if(send)send.disabled=!active;
    if(!active){
      document.getElementById('qaChatName').textContent='Lead simulado';
      document.getElementById('qaChatSub').textContent='Crea un escenario para comenzar';
      document.getElementById('qaMessages').innerHTML='<div class="qa-empty"><b>Prueba como vendedor real</b>Crea un escenario, escribe tu respuesta y el lead simulado contestará automáticamente.</div>';
      return;
    }
    const run=qaRun.run,ct=qaRun.contact||{},op=qaRun.opportunity||{},task=qaRun.active_task;
    document.getElementById('qaChatName').textContent=ct.display_name||'Lead QA';
    document.getElementById('qaChatSub').textContent=(op.product||'Producto')+' · '+(op.city||'Sin ciudad')+' · '+(op.priority||'P3');
    const msgs=document.getElementById('qaMessages');
    msgs.innerHTML=(qaRun.messages||[]).map(m=>`<div class="qa-msg ${m.direction==='outbound'?'out':'in'}"><div>${escq(m.text||'[Adjunto]')}</div><div class="time">${m.direction==='outbound'?'Agente':'Lead'} · ${new Date(m.sent_at).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}</div></div>`).join('');
    msgs.scrollTop=msgs.scrollHeight;

    const checks=qaRun.checks||{};
    const labels={contact:'Contacto',conversation:'Conversación',opportunity:'Oportunidad',owner:'Responsable',stage:'Etapa',priority:'Prioridad',cap:'CAP',active_task:'Próxima tarea',next_action:'Fecha/SLA',messages:'Historial'};
    document.getElementById('qaChecks').innerHTML=Object.entries(labels).map(([k,l])=>`<div class="qa-check ${checks[k]?'ok':'bad'}">${checks[k]?'✓':'!'} ${escq(l)}</div>`).join('');

    const current=norm(op.stage);
    document.getElementById('qaStageTrack').innerHTML=STAGES.map(([k,l])=>`<span class="qa-stage-dot ${current===k?'current':''}">${escq(l)}</span>`).join('');
    document.getElementById('qaTaskBox').innerHTML=task
      ? `<div class="k">TAREA OBLIGATORIA ACTUAL</div><div class="t">${escq(task.title)}</div><div class="m">Estado: ${escq(task.status)} · límite: ${task.due_at?new Date(task.due_at).toLocaleString('es-CO'):'sin fecha'}<br>La oportunidad no puede avanzar hasta validar esta acción.</div>`
      : `<div class="k">ESTADO</div><div class="t">${['won','lost'].includes(op.status||op.stage)?'Flujo cerrado':'Sin tarea activa'}</div><div class="m">Actualiza la prueba para validar el estado.</div>`;
    const ex=document.getElementById('qaExecuteBtn');if(ex)ex.disabled=!task;
  }
  window.refreshQaSimulator=async function(){
    if(!qaRun?.run?.id){
      const saved=sessionStorage.getItem('segmenta_qa_run');
      if(!saved)return;
      try{qaRun=await api('GET','/api/crm-simulator?run_id='+encodeURIComponent(saved));render()}catch(_){sessionStorage.removeItem('segmenta_qa_run')}
      return;
    }
    try{qaRun=await api('GET','/api/crm-simulator?run_id='+encodeURIComponent(qaRun.run.id));render()}catch(err){window.toast?.(err.message)}
  };
  async function loadPage(){
    ensureNav();ensurePage();
    if(!allowed())return;
    await window.refreshQaSimulator();
  }

  const originalShow=window.showPage;
  if(originalShow){
    window.showPage=function(page,...rest){
      const out=originalShow.call(this,page,...rest);
      if(page==='qa')setTimeout(loadPage,0);
      return out;
    };
  }
  const originalRender=window.renderCrmSession;
  if(originalRender){
    window.renderCrmSession=function(...args){
      const out=originalRender.apply(this,args);
      ensureNav();
      return out;
    };
  }

  function init(){ensurePage();ensureNav();if(window.currentPage==='qa')loadPage()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
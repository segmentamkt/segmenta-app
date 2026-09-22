(() => {
  let executionQueue = [];
  let executionCurrent = null;
  let executionQuoteContext = null;

  function escx(s){
    return String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  }
  function moneyx(v){
    try{return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0)}
    catch(_){return '$'+Number(v||0).toLocaleString('es-CO')}
  }
  function relativeDue(v){
    if(!v)return 'Sin fecha';
    const diff=new Date(v).getTime()-Date.now();
    const mins=Math.round(Math.abs(diff)/60000);
    if(diff<0){
      if(mins<60)return 'Vencida hace '+mins+' min';
      const h=Math.round(mins/60);
      if(h<48)return 'Vencida hace '+h+' h';
      return 'Vencida hace '+Math.round(h/24)+' días';
    }
    if(mins<60)return 'Vence en '+mins+' min';
    const h=Math.round(mins/60);
    if(h<48)return 'Vence en '+h+' h';
    return 'Vence en '+Math.round(h/24)+' días';
  }
  function stageLabel(s){
    return ({
      new:'Lead nuevo',contacting:'Contactando',contacted:'Contactando',
      qualification:'Calificación',qualified:'Oportunidad',opportunity:'Oportunidad',
      proposal:'Cotización',quote:'Cotización',follow_up:'Seguimiento',
      negotiation:'Negociación',won:'Ganado',lost:'Perdido',future_follow_up:'Seguimiento futuro'
    })[s]||s||'—';
  }
  function typeHelp(type){
    return ({
      contact_client:'Contacta al cliente. Si existe conversación en la Bandeja, el CRM comprobará que hayas enviado un mensaje antes de permitir completar la tarea.',
      qualify:'Completa los datos obligatorios de calificación. El CRM no avanzará la oportunidad si falta información.',
      quote:'Crea la cotización desde el módulo Cotizaciones. Debe quedar vinculada a esta oportunidad para validar la tarea.',
      follow_up_24h:'Realiza el seguimiento. Si existe conversación, debe haber un mensaje saliente posterior a la creación de esta tarea.',
      follow_up_48h:'Realiza el segundo seguimiento. El sistema validará evidencia antes de avanzar.',
      follow_up_72h:'Realiza el tercer seguimiento. Después se programará seguimiento futuro.',
      future_follow_up:'Define y registra el contacto de seguimiento futuro.',
      call:'Registra el resultado de la llamada.',
      close_lost:'Selecciona obligatoriamente el motivo de pérdida.',
      close_won:'Confirma los datos de cierre antes de marcar la venta como ganada.'
    })[type]||'Ejecuta la acción comercial y registra evidencia antes de completarla.';
  }

  function ensureHero(){
    const page=document.getElementById('page-dashboard');
    if(!page)return null;
    let hero=document.getElementById('executionHero');
    if(hero)return hero;
    hero=document.createElement('section');
    hero.id='executionHero';
    hero.className='execution-hero';
    const head=page.querySelector('.page-head');
    if(head) head.insertAdjacentElement('afterend',hero);
    else page.prepend(hero);
    return hero;
  }

  function renderHero(data){
    const hero=ensureHero();
    if(!hero)return;
    const task=data?.next_task;
    const sum=data?.summary||{};
    const supervisor=!!(window.crmSession?.platform_admin || ['owner','admin'].includes(window.crmSession?.role));
    if(!task){
      hero.innerHTML=`
        <div class="execution-hero-top">
          <div><div class="execution-kicker">Ejecución comercial</div><div class="execution-title">${supervisor?'Cola comercial':'MI PRÓXIMA TAREA'}</div></div>
          <div class="execution-summary"><span class="execution-chip">0 pendientes</span></div>
        </div>
        <div class="execution-empty"><b>Cola al día</b>No hay tareas comerciales pendientes en este momento.</div>`;
      return;
    }
    const opp=task.opportunity||{};
    const contact=task.contact||{};
    const p=String(opp.priority||'P3').toLowerCase();
    hero.innerHTML=`
      <div class="execution-hero-top">
        <div>
          <div class="execution-kicker">Ejecución comercial</div>
          <div class="execution-title">${supervisor?'PRÓXIMA TAREA DE LA EMPRESA':'MI PRÓXIMA TAREA'}</div>
          <div class="execution-sub">El CRM prioriza automáticamente la acción que debe ejecutarse ahora.</div>
        </div>
        <div class="execution-summary">
          <span class="execution-chip">${Number(sum.total||0)} pendientes</span>
          <span class="execution-chip danger">${Number(sum.overdue||0)} vencidas</span>
          <span class="execution-chip warn">${Number(sum.due_soon||0)} próximas</span>
          <span class="execution-chip hot">${Number(sum.p1||0)} P1</span>
        </div>
      </div>
      <div class="execution-body">
        <div class="execution-main">
          <div class="execution-task-line">
            <span class="execution-priority ${p}">${escx(opp.priority||'P3')}</span>
            <span class="execution-task-name">${escx(task.title||'Tarea comercial')}</span>
            ${task.timing_state==='overdue'?'<span class="state off" style="background:#fff0ed;color:#b64d3d">Vencida</span>':task.timing_state==='due_soon'?'<span class="state wait">Próxima a vencer</span>':''}
          </div>
          <div class="execution-client">${escx(contact.display_name||opp.title||'Cliente')}</div>
          <div class="execution-meta-grid">
            <div class="execution-meta"><span>Producto</span><b>${escx(opp.product||'Por definir')}</b></div>
            <div class="execution-meta"><span>Ciudad</span><b>${escx(opp.city||'Por definir')}</b></div>
            <div class="execution-meta"><span>Valor potencial</span><b>${moneyx(opp.value)}</b></div>
            <div class="execution-meta"><span>Etapa</span><b>${escx(stageLabel(opp.stage))}</b></div>
            <div class="execution-meta"><span>Último contacto</span><b>${opp.conversation?.last_message_at?escx(relativeDue(opp.conversation.last_message_at).replace('Vence en','Hace').replace('Vencida hace','Hace')):'Sin registro'}</b></div>
            <div class="execution-meta"><span>Secuencia</span><b>#${Number(task.sequence||0)+1}</b></div>
          </div>
        </div>
        <div class="execution-side">
          <div>
            <div class="execution-next-label">Fecha límite</div>
            <div class="execution-due">${escx(relativeDue(task.due_at))}</div>
            <div class="execution-timing">${task.due_at?escx(new Date(task.due_at).toLocaleString('es-CO')):'Sin fecha límite'}</div>
          </div>
          <button class="execution-primary" onclick="openExecutionTask('${escx(task.id)}')">EJECUTAR TAREA</button>
          <button class="execution-secondary" onclick="showPage('tasks')">Ver cola completa</button>
        </div>
      </div>`;
  }

  async function getExecutionQueue(){
    const r=await fetch('/api/crm-execution',{cache:'no-store'});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'No fue posible cargar la cola comercial');
    executionQueue=j.queue||[];
    executionCurrent=j.next_task||null;
    return j;
  }

  async function loadExecutionQueue(){
    try{
      const data=await getExecutionQueue();
      renderHero(data);
      return data;
    }catch(err){
      const hero=ensureHero();
      if(hero)hero.innerHTML='<div class="execution-empty"><b>Motor comercial no disponible</b>'+escx(err.message)+'</div>';
      return null;
    }
  }
  window.loadExecutionQueue=loadExecutionQueue;

  function ensureModal(){
    let bg=document.getElementById('executionModalBg');
    if(bg)return bg;
    bg=document.createElement('div');
    bg.id='executionModalBg';
    bg.className='execution-modal-bg hidden';
    bg.innerHTML=`
      <div class="execution-modal" onclick="event.stopPropagation()">
        <div class="execution-modal-head">
          <div><div class="execution-kicker">Ejecución obligatoria</div><h3 id="executionModalTitle">Tarea</h3></div>
          <button class="execution-close" onclick="closeExecutionModal()">×</button>
        </div>
        <div class="execution-modal-body" id="executionModalBody"></div>
      </div>`;
    bg.addEventListener('click',()=>window.closeExecutionModal());
    document.body.appendChild(bg);
    return bg;
  }
  window.closeExecutionModal=function(){
    const bg=document.getElementById('executionModalBg');
    if(bg)bg.classList.add('hidden');
  };

  async function startTask(task){
    if(task.status==='pending'){
      const r=await fetch('/api/crm-execution',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'start_task',task_id:task.id})
      });
      const j=await r.json();
      if(!r.ok)throw new Error(j.error||'No fue posible iniciar la tarea');
      task.status='in_progress';
      task.started_at=j.task?.started_at||new Date().toISOString();
    }
  }

  function qualificationFields(task){
    const o=task.opportunity||{};
    return `
      <div class="execution-form-grid">
        <div class="execution-field full"><label>Producto o servicio *</label><input id="execProduct" value="${escx(o.product||'')}"></div>
        <div class="execution-field"><label>Cantidad *</label><input id="execQuantity" type="number" min="0.001" step="0.001" value="${escx(o.quantity||'')}"></div>
        <div class="execution-field"><label>Ciudad *</label><input id="execCity" value="${escx(o.city||'')}"></div>
        <div class="execution-field"><label>Uso *</label><select id="execUsage"><option value="">Seleccionar</option><option value="uso_propio" ${o.usage_type==='uso_propio'?'selected':''}>Uso propio</option><option value="reventa" ${o.usage_type==='reventa'?'selected':''}>Reventa</option><option value="empresa" ${o.usage_type==='empresa'?'selected':''}>Uso empresarial</option></select></div>
        <div class="execution-field"><label>Urgencia *</label><select id="execUrgency"><option value="">Seleccionar</option><option value="hoy" ${o.urgency==='hoy'?'selected':''}>Hoy</option><option value="esta_semana" ${o.urgency==='esta_semana'?'selected':''}>Esta semana</option><option value="este_mes" ${o.urgency==='este_mes'?'selected':''}>Este mes</option><option value="sin_urgencia" ${o.urgency==='sin_urgencia'?'selected':''}>Sin urgencia</option></select></div>
        <div class="execution-field"><label>Origen / canal *</label><input id="execSource" value="${escx(o.source||'')}"></div>
        <div class="execution-field"><label>Prioridad</label><select id="execPriority"><option value="P1" ${o.priority==='P1'?'selected':''}>P1 · Alta</option><option value="P2" ${o.priority==='P2'?'selected':''}>P2 · Media</option><option value="P3" ${!o.priority||o.priority==='P3'?'selected':''}>P3 · Baja</option></select></div>
      </div>`;
  }

  function modalBody(task){
    const opp=task.opportunity||{};
    const contact=task.contact||{};
    let special='';
    if(task.task_type==='qualify') special=qualificationFields(task);
    if(task.task_type==='close_lost'){
      special=`
        <div class="execution-form-grid">
          <div class="execution-field full"><label>Motivo de pérdida *</label>
            <select id="execLostReason">
              <option value="">Seleccionar</option><option value="precio">Precio</option><option value="no_respondio">No respondió</option>
              <option value="sin_inventario">Sin inventario</option><option value="competencia">Compró a competencia</option>
              <option value="envio">Envío</option><option value="tiempo_entrega">Tiempo de entrega</option>
              <option value="informacion_falsa">Información falsa</option><option value="no_potencial">No era cliente potencial</option>
              <option value="no_comprar">Decidió no comprar</option><option value="otro">Otro</option>
            </select>
          </div>
          <div class="execution-field full"><label>Detalle</label><textarea id="execLostNote"></textarea></div>
        </div>`;
    }

    const inboxButton = ['contact_client','send_message','follow_up_24h','follow_up_48h','follow_up_72h'].includes(task.task_type)
      ? '<button class="btn" type="button" onclick="executionOpenInbox()">Abrir Bandeja</button>' : '';
    const quoteButton = task.task_type==='quote'
      ? '<button class="btn primary" type="button" onclick="executionOpenQuotes()">Ir a Cotizaciones</button>' : '';

    return `
      <div class="execution-help"><b>${escx(contact.display_name||opp.title||'Cliente')}</b><br>${escx(typeHelp(task.task_type))}</div>
      ${special}
      <div class="execution-field full" style="margin-top:10px"><label>Nota / resultado de la acción</label><textarea id="execCompletionNote" placeholder="Registra contexto útil de la ejecución..."></textarea></div>
      <div class="execution-modal-actions">
        ${inboxButton}
        ${quoteButton}
        <button class="btn primary" type="button" onclick="completeCurrentExecutionTask()">Completar tarea</button>
      </div>`;
  }

  window.openExecutionTask=async function(id){
    try{
      let task=executionQueue.find(x=>x.id===id);
      if(!task){
        await getExecutionQueue();
        task=executionQueue.find(x=>x.id===id);
      }
      if(!task)throw new Error('La tarea ya no está disponible');
      await startTask(task);
      executionCurrent=task;
      const bg=ensureModal();
      document.getElementById('executionModalTitle').textContent=task.title||'Tarea comercial';
      document.getElementById('executionModalBody').innerHTML=modalBody(task);
      bg.classList.remove('hidden');
    }catch(err){
      if(typeof window.toast==='function')window.toast(err.message); else alert(err.message);
    }
  };

  window.executionOpenInbox=function(){
    window.closeExecutionModal();
    if(typeof window.showPage==='function')window.showPage('inbox');
  };

  window.executionOpenQuotes=function(){
    if(!executionCurrent)return;
    executionQuoteContext=executionCurrent;
    window.__executionQuoteContext=executionCurrent;
    window.closeExecutionModal();
    if(typeof window.showPage==='function')window.showPage('quotes');
    setTimeout(renderQuoteContext,60);
  };

  function renderQuoteContext(){
    const page=document.getElementById('page-quotes');
    if(!page)return;
    let banner=document.getElementById('executionQuoteBanner');
    if(!executionQuoteContext){
      if(banner)banner.remove();
      return;
    }
    if(!banner){
      banner=document.createElement('div');
      banner.id='executionQuoteBanner';
      banner.className='execution-quote-context';
      const head=page.querySelector('.page-head');
      if(head)head.insertAdjacentElement('afterend',banner);
    }
    const t=executionQuoteContext;
    banner.innerHTML='<b>Cotización vinculada a tarea:</b> '+escx(t.contact?.display_name||t.opportunity?.title||'Cliente')+' · '+escx(t.opportunity?.product||'Producto por definir')+'. Al crearla, el CRM completará la tarea y programará el seguimiento de 24 horas.';
  }

  async function saveQualification(task){
    const body={
      action:'update_opportunity',
      id:task.opportunity?.id,
      product:document.getElementById('execProduct')?.value||'',
      quantity:document.getElementById('execQuantity')?.value||'',
      city:document.getElementById('execCity')?.value||'',
      usage_type:document.getElementById('execUsage')?.value||'',
      urgency:document.getElementById('execUrgency')?.value||'',
      source:document.getElementById('execSource')?.value||'',
      priority:document.getElementById('execPriority')?.value||'P3'
    };
    const r=await fetch('/api/crm-commercial',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'No fue posible guardar la calificación');
    task.opportunity={...(task.opportunity||{}),...(j.opportunity||body)};
  }

  async function sendComplete(task,extra={}){
    const note=document.getElementById('execCompletionNote')?.value||'';
    const payload={action:'complete_task',task_id:task.id,completion_note:note,...extra};
    const r=await fetch('/api/crm-execution',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'No fue posible completar la tarea');
    return j;
  }

  window.completeCurrentExecutionTask=async function(){
    if(!executionCurrent)return;
    try{
      const t=executionCurrent;
      if(t.task_type==='qualify')await saveQualification(t);
      const extra={};
      if(t.task_type==='close_lost'){
        extra.lost_reason=document.getElementById('execLostReason')?.value||'';
        extra.lost_reason_note=document.getElementById('execLostNote')?.value||'';
      }
      const result=await sendComplete(t,extra);
      window.closeExecutionModal();
      executionCurrent=null;
      if(typeof window.toast==='function')window.toast(result.next_task?'Tarea completada · siguiente acción creada':'Tarea completada');
      await loadExecutionQueue();
      if(typeof window.loadTasks==='function' && window.currentPage==='tasks')await window.loadTasks();
      if(typeof window.loadDashboard==='function' && window.currentPage==='dashboard')await window.loadDashboard();
    }catch(err){
      if(typeof window.toast==='function')window.toast(err.message); else alert(err.message);
    }
  };

  const originalCreateQuote=window.createQuote;
  window.createQuote=async function(e){
    if(!executionQuoteContext){
      return originalCreateQuote ? originalCreateQuote(e) : undefined;
    }
    e.preventDefault();
    const ctx=executionQuoteContext;
    try{
      const body={
        action:'create_quote',
        contact_id:ctx.contact?.id||ctx.opportunity?.contact_id||null,
        opportunity_id:ctx.opportunity?.id||null,
        discount:document.getElementById('quoteDiscount').value,
        shipping_cost:document.getElementById('quoteShipping').value,
        valid_until:document.getElementById('quoteValidUntil').value||null,
        observations:document.getElementById('quoteObservations').value,
        items:[{
          description:document.getElementById('quoteDescription').value,
          quantity:document.getElementById('quoteQty').value,
          unit_price:document.getElementById('quoteUnitPrice').value
        }]
      };
      const r=await fetch('/api/crm-commercial',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const j=await r.json();
      if(!r.ok)throw new Error(j.error||'No fue posible crear la cotización');
      e.target.reset();
      document.getElementById('quoteQty').value=1;
      document.getElementById('quoteDiscount').value=0;
      document.getElementById('quoteShipping').value=0;
      const cr=await fetch('/api/crm-execution',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        action:'complete_task',task_id:ctx.id,completion_note:'Cotización creada desde la tarea comercial'
      })});
      const cj=await cr.json();
      if(!cr.ok)throw new Error(cj.error||'La cotización se creó, pero no fue posible completar la tarea');
      executionQuoteContext=null;
      window.__executionQuoteContext=null;
      renderQuoteContext();
      if(typeof window.toast==='function')window.toast('Cotización creada · seguimiento 24h programado');
      if(typeof window.loadQuotes==='function')await window.loadQuotes();
      await loadExecutionQueue();
    }catch(err){
      if(typeof window.toast==='function')window.toast(err.message); else alert(err.message);
    }
  };

  window.completeTask=async function(id){
    try{
      if(!executionQueue.length)await getExecutionQueue();
      const task=executionQueue.find(x=>x.id===id);
      if(task)return window.openExecutionTask(id);
      if(typeof window.toast==='function')window.toast('Esta tarea ya no está activa o no pertenece a tu cola.');
    }catch(err){
      if(typeof window.toast==='function')window.toast(err.message);
    }
  };

  const originalLoadTasks=window.loadTasks;
  window.loadTasks=async function(){
    try{
      const j=await window.commercialGet('tasks'),rows=j.tasks||[],b=document.getElementById('tasksBody');
      if(!b)return;
      b.innerHTML=rows.length?rows.map(t=>{
        const completed=['completed','done','cancelled'].includes(t.status);
        const state=completed
          ? '<span class="status-pill">'+(t.status==='cancelled'?'Cancelada':'Hecha')+'</span>'
          : '<button class="btn primary" onclick="openExecutionTask(\''+t.id+'\')">Ejecutar</button>';
        const timing=t.due_at&&new Date(t.due_at).getTime()<Date.now()&& !completed
          ? '<br><span style="color:var(--red);font-size:.65rem;font-weight:800">Vencida</span>' : '';
        return '<tr><td><b>'+escx(t.title)+'</b><br><span style="color:var(--muted)">'+escx(t.description||'')+'</span></td><td>'+escx(t.priority)+'</td><td>'+ (t.due_at?escx(new Date(t.due_at).toLocaleString('es-CO')):'—') +timing+'</td><td>'+escx(t.status)+'</td><td>'+state+'</td></tr>';
      }).join(''):'<tr><td colspan="5" class="empty-state">Sin tareas.</td></tr>';
    }catch(_){
      if(originalLoadTasks)return originalLoadTasks();
    }
  };

  const originalLoadDashboard=window.loadDashboard;
  if(originalLoadDashboard){
    window.loadDashboard=async function(){
      await originalLoadDashboard();
      await loadExecutionQueue();
    };
  }

  function init(){
    ensureHero();
    ensureModal();
    loadExecutionQueue();
    renderQuoteContext();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
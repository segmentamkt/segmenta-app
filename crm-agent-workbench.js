(() => {
  const FLOW=[
    {key:'new',label:'Nuevo',aliases:['new','lead_new']},
    {key:'contacting',label:'Contacto',aliases:['contacting','contacted']},
    {key:'qualification',label:'Calificar',aliases:['qualification']},
    {key:'opportunity',label:'Oportunidad',aliases:['opportunity','qualified']},
    {key:'quote',label:'Oferta',aliases:['quote','proposal']},
    {key:'follow_up',label:'Seguimiento',aliases:['follow_up','future_follow_up']},
    {key:'negotiation',label:'Negociación',aliases:['negotiation']},
    {key:'close',label:'Cierre',aliases:['won','lost']}
  ];

  function esc(s){return String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
  function money(v){try{return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0)}catch(_){return '$'+Number(v||0).toLocaleString('es-CO')}}
  function relative(v){
    if(!v)return 'Sin vencimiento';
    const d=new Date(v).getTime()-Date.now(),m=Math.round(Math.abs(d)/60000);
    if(d<0)return m<60?'Vencida hace '+m+' min':m<2880?'Vencida hace '+Math.round(m/60)+' h':'Vencida hace '+Math.round(m/1440)+' d';
    return m<60?'Vence en '+m+' min':m<2880?'Vence en '+Math.round(m/60)+' h':'Vence en '+Math.round(m/1440)+' d';
  }
  function norm(stage){
    const s=String(stage||'new').toLowerCase();
    return FLOW.find(x=>x.aliases.includes(s))?.key||s;
  }
  function flowIndex(stage){
    const key=norm(stage);
    let i=FLOW.findIndex(x=>x.key===key);
    if(i<0&&key==='won')i=FLOW.length-1;
    if(i<0&&key==='lost')i=FLOW.length-1;
    return Math.max(0,i);
  }
  function sourceLabel(task){
    return task?.opportunity?.source||task?.contact?.metadata?.source||'Sin origen';
  }

  function scriptFor(task){
    const o=task.opportunity||{}, c=task.contact||{};
    const name=c.display_name||'el cliente', product=o.product||'lo que consultó';
    const scripts={
      contact_client:{
        title:'Rompe el hielo y consigue contexto',
        objective:'Lograr una respuesta útil y obtener los primeros datos sin convertir la conversación en un interrogatorio.',
        text:`Hola ${name}. Vi que nos escribiste por ${product}. Para ayudarte bien, cuéntame: ¿lo necesitas para uso propio, reventa o empresa? ¿En qué ciudad estás y para cuándo lo necesitas?`,
        tip:'Haz una pregunta por mensaje si el cliente responde corto. No envíes catálogo ni precio sin entender qué necesita.'
      },
      qualify:{
        title:'Califica antes de cotizar',
        objective:'Salir de esta etapa con información suficiente para saber qué ofrecer, cuándo y con qué prioridad.',
        text:'Confirma en conversación: producto o servicio, cantidad, ciudad, uso, urgencia y cualquier restricción importante. Si algo ya está claro, no lo vuelvas a preguntar.',
        tip:'El sistema no permitirá avanzar mientras falte un dato obligatorio.'
      },
      quote:{
        title:'Construye una oferta con contexto',
        objective:'Enviar una oferta que responda exactamente a lo que el cliente confirmó.',
        text:`Antes de enviar: confirma que la oferta corresponde a ${product}, cantidad ${o.quantity||'por definir'} y ciudad ${o.city||'por definir'}. Luego crea la cotización vinculada a este lead.`,
        tip:'No cierres la tarea hasta que exista una cotización vinculada; el CRM lo valida.'
      },
      follow_up_24h:{
        title:'Seguimiento 24 h',
        objective:'Reactivar la conversación sin repetir la cotización.',
        text:`Hola ${name}. Quería confirmar si pudiste revisar la propuesta que te enviamos. ¿Hay algo puntual que necesites ajustar para poder avanzar?`,
        tip:'Busca identificar el bloqueo: precio, tiempo, información, decisión de otra persona o falta de urgencia.'
      },
      follow_up_48h:{
        title:'Segundo seguimiento',
        objective:'Conseguir una decisión o identificar qué falta para tomarla.',
        text:`Hola ${name}. Te escribo para no dejar esto en el aire. ¿Sigues evaluando ${product} o prefieres que lo retomemos más adelante?`,
        tip:'Una respuesta negativa también es información útil. Regístrala; no mantengas leads eternamente abiertos.'
      },
      follow_up_72h:{
        title:'Último seguimiento corto',
        objective:'Cerrar el ciclo inmediato o moverlo a seguimiento futuro.',
        text:`Hola ${name}. Cierro seguimiento por ahora para no llenarte de mensajes. Si todavía quieres avanzar con ${product}, dime y lo retomamos desde aquí.`,
        tip:'Si no responde, el sistema moverá el caso a seguimiento futuro.'
      },
      future_follow_up:{
        title:'Recupera el lead en el momento correcto',
        objective:'Retomar la conversación con contexto y nueva fecha definida.',
        text:`Hola ${name}. Retomo lo que habíamos hablado sobre ${product}. ¿Sigue siendo una prioridad para ti en este momento?`,
        tip:'Si todavía no es momento, define una nueva fecha concreta; no lo dejes abierto sin próxima acción.'
      },
      negotiation:{
        title:'Encuentra el bloqueo real',
        objective:'Convertir “lo estoy pensando” en una decisión concreta.',
        text:'Pregunta qué impide avanzar hoy. Si es precio, entiende contra qué compara. Si es tiempo, confirma fecha real. Si es confianza, resuelve la duda específica antes de ofrecer descuentos.',
        tip:'No regales extras ni cambies precio sin autorización. Registra el resultado de la negociación.'
      },
      send_message:{
        title:'Entrega la información solicitada',
        objective:'Responder exactamente lo que pidió el cliente y volver a dejar una siguiente acción.',
        text:'Envía únicamente la información que el cliente pidió, con una pregunta de cierre para confirmar si quedó claro o si puede avanzar.',
        tip:'El sistema valida que exista evidencia del mensaje antes de completar.'
      },
      close_won:{
        title:'Registra la venta completa',
        objective:'Cerrar con datos suficientes para que operación pueda continuar sin perseguir información.',
        text:'Confirma producto, cantidad, valor, ciudad, origen, responsable y método de pago.',
        tip:'La venta no queda ganada hasta que los datos obligatorios estén completos.'
      },
      close_lost:{
        title:'Cierra y aprende',
        objective:'Registrar por qué se perdió para que el sistema aprenda dónde se rompen las ventas.',
        text:'Selecciona el motivo real de pérdida. Si eliges “otro”, explica brevemente qué pasó.',
        tip:'Perder con información sirve. Mantener un lead falso abierto no.'
      }
    };
    return scripts[task.task_type]||{
      title:'Ejecuta la siguiente acción',
      objective:'Completar la acción indicada y registrar evidencia suficiente.',
      text:'Sigue la tarea actual, registra el resultado y deja que el CRM genere el siguiente paso.',
      tip:'No cambies la etapa manualmente.'
    };
  }

  function checklist(task){
    const o=task.opportunity||{},c=task.contact||{};
    const rows=[];
    const add=(label,ok,detail='')=>rows.push({label,ok,detail});
    if(task.task_type==='contact_client'||task.task_type==='send_message'){
      add('Enviar mensaje al cliente',false,'Se valida con evidencia real al completar');
      add('Responsable asignado',!!o.owner_user_id);
      add('Próxima acción definida',!!task.due_at);
    } else if(task.task_type==='qualify'){
      add('Nombre',!!c.display_name);
      add('Teléfono',!!c.phone);
      add('Producto / servicio',!!o.product);
      add('Cantidad',Number(o.quantity)>0);
      add('Ciudad',!!o.city);
      add('Uso',!!o.usage_type);
      add('Urgencia',!!o.urgency);
      add('Origen',!!o.source);
    } else if(task.task_type==='quote'){
      add('Datos de necesidad confirmados',!!o.product&&Number(o.quantity)>0&&!!o.city);
      add('Cotización vinculada',false,'El sistema la verifica al completar');
    } else if(['follow_up_24h','follow_up_48h','follow_up_72h','future_follow_up'].includes(task.task_type)){
      add('Seguimiento enviado',false,'Se valida con mensaje saliente');
      add('Resultado seleccionado',false,'Interesado / sin respuesta / información / perdido');
    } else if(task.task_type==='negotiation'){
      add('Bloqueo identificado',false,'Debe quedar registrado en la nota');
      add('Resultado de negociación',false,'Ganado / seguimiento / perdido');
    } else if(task.task_type==='close_won'){
      add('Producto',!!o.product);add('Cantidad',Number(o.quantity)>0);add('Valor',Number(o.value)>0);add('Ciudad',!!o.city);add('Origen',!!o.source);add('Método de pago',false);
    } else if(task.task_type==='close_lost'){
      add('Motivo de pérdida',false);add('Detalle si aplica',false);
    } else {
      add('Ejecutar acción',false);add('Registrar resultado',false);
    }
    return rows;
  }

  function progressHtml(task){
    const idx=flowIndex(task?.opportunity?.stage);
    return FLOW.map((s,i)=>{
      const cls=i<idx?'done':i===idx?'current':'future';
      return `<div class="aw-step ${cls}"><div class="aw-step-dot">${i<idx?'✓':i+1}</div><div><b>${esc(s.label)}</b><span>${i<idx?'Completado':i===idx?'Ahora':'Después'}</span></div></div>`;
    }).join('');
  }

  function queueHtml(queue,currentId){
    const rows=(queue||[]).filter(x=>x.id!==currentId).slice(0,5);
    if(!rows.length)return '<div class="aw-empty">Cuando termines esta tarea, el sistema pondrá aquí la siguiente.</div>';
    return rows.map((t,i)=>{
      const o=t.opportunity||{},c=t.contact||{};
      return `<button class="aw-queue-row" type="button" onclick="openExecutionTask('${esc(t.id)}')">
        <span class="aw-queue-index">${i+2}</span>
        <span class="aw-queue-main"><b>${esc(c.display_name||o.title||'Lead')}</b><small>${esc(t.title||'Tarea')} · ${esc(o.product||sourceLabel(t))}</small></span>
        <span class="aw-queue-time">${esc(relative(t.due_at))}</span>
      </button>`;
    }).join('');
  }

  function ensure(){
    const page=document.getElementById('page-dashboard');if(!page)return null;
    let root=document.getElementById('agentWorkbench');
    if(root)return root;
    root=document.createElement('section');root.id='agentWorkbench';root.className='agent-workbench';
    const head=page.querySelector('.page-head');
    if(head)head.insertAdjacentElement('afterend',root);else page.prepend(root);
    return root;
  }

  function setDashboardMode(){
    const page=document.getElementById('page-dashboard');if(!page)return;
    const role=window.crmSession?.role;
    const agent=['sales','agent'].includes(role)&&!window.crmSession?.platform_admin;
    page.classList.toggle('agent-mode',agent);
    const head=page.querySelector('.page-head');
    if(head){
      const eyebrow=head.querySelector('.eyebrow'),h1=head.querySelector('h1'),p=head.querySelector('p');
      if(eyebrow)eyebrow.textContent=agent?'Sistema comercial':'Operación comercial';
      if(h1)h1.textContent=agent?'Mi trabajo ahora':'Centro de ejecución';
      if(p)p.textContent=agent?'No necesitas decidir qué sigue. Ejecuta la tarea actual y el sistema mueve el proceso.':'Supervisa la operación y ejecuta el siguiente paso sin saltarse el método.';
    }
    const nav=[...document.querySelectorAll('.nav-item[data-page="dashboard"]')][0];
    if(nav&&agent){
      const ico=nav.querySelector('.ico')?.outerHTML||'<span class="ico">▶</span>';
      nav.innerHTML=ico+'Mi trabajo';
    }
  }

  function render(data){
    const root=ensure();if(!root)return;
    const task=data?.next_task,sum=data?.summary||{},queue=data?.queue||[];
    if(!task){
      root.innerHTML=`<div class="aw-clear"><div class="aw-clear-icon">✓</div><div><div class="aw-kicker">Sistema comercial</div><h2>Cola al día</h2><p>No hay acciones obligatorias pendientes. Cuando entre un lead o venza un seguimiento, aparecerá aquí.</p></div></div>`;
      return;
    }
    const o=task.opportunity||{},c=task.contact||{},play=scriptFor(task),checks=checklist(task);
    const done=checks.filter(x=>x.ok).length,total=checks.length;
    const conversationId=o.conversation_id||'';
    root.innerHTML=`
      <div class="aw-topline">
        <div><div class="aw-kicker">Playbook Segmenta · ejecución guiada</div><h2>Haz esto ahora</h2><p>El sistema decide la siguiente acción. Tú ejecutas, registras el resultado y continúas.</p></div>
        <div class="aw-health"><span><b>${Number(sum.total||0)}</b> pendientes</span><span class="${Number(sum.overdue||0)?'danger':''}"><b>${Number(sum.overdue||0)}</b> vencidas</span><span><b>${Number(sum.p1||0)}</b> prioridad alta</span></div>
      </div>
      <div class="aw-progress">${progressHtml(task)}</div>
      <div class="aw-grid">
        <article class="aw-current">
          <div class="aw-current-head">
            <div>
              <div class="aw-task-label">TAREA ACTUAL · ${esc(sourceLabel(task))}</div>
              <h3>${esc(task.title||'Acción comercial')}</h3>
              <div class="aw-client">${esc(c.display_name||o.title||'Cliente')}</div>
            </div>
            <div class="aw-deadline ${task.timing_state==='overdue'?'danger':''}"><span>Fecha límite</span><b>${esc(relative(task.due_at))}</b></div>
          </div>
          <div class="aw-context">
            <span><small>Producto</small><b>${esc(o.product||'Por definir')}</b></span>
            <span><small>Ciudad</small><b>${esc(o.city||'Por definir')}</b></span>
            <span><small>Valor</small><b>${money(o.value)}</b></span>
            <span><small>Prioridad</small><b>${esc(o.priority||'P3')}</b></span>
          </div>
          <div class="aw-playbook">
            <div class="aw-playbook-head"><div><span>GUION / PLAYBOOK</span><h4>${esc(play.title)}</h4></div><span class="aw-lock">🔒 Obligatorio</span></div>
            <div class="aw-objective"><b>Objetivo</b><p>${esc(play.objective)}</p></div>
            <div class="aw-script"><b>Qué decir / hacer</b><p>${esc(play.text)}</p></div>
            <div class="aw-tip">💡 ${esc(play.tip)}</div>
          </div>
          <div class="aw-actions">
            ${conversationId?`<button class="aw-btn ghost" type="button" onclick="agentWorkbenchOpenConversation('${esc(conversationId)}')">Abrir conversación</button>`:''}
            <button class="aw-btn primary" type="button" onclick="openExecutionTask('${esc(task.id)}')">Ejecutar paso</button>
          </div>
        </article>
        <aside class="aw-guard">
          <div class="aw-guard-head"><div><span>CONTROL DE AVANCE</span><h3>No puedes saltarte esto</h3></div><div class="aw-ring">${done}/${total}</div></div>
          <p>Para avanzar de etapa, estas condiciones deben quedar cumplidas o validadas por el sistema.</p>
          <div class="aw-checks">${checks.map(x=>`<div class="aw-check ${x.ok?'ok':'pending'}"><span class="aw-check-icon">${x.ok?'✓':'○'}</span><div><b>${esc(x.label)}</b>${x.detail?`<small>${esc(x.detail)}</small>`:''}</div></div>`).join('')}</div>
          <div class="aw-rule"><b>Regla del sistema</b><span>Completar tarea → validar evidencia → mover etapa → crear siguiente tarea.</span></div>
        </aside>
      </div>
      <div class="aw-queue">
        <div class="aw-section-head"><div><span>DESPUÉS DE ESTO</span><h3>Tu cola ya está ordenada</h3></div><button class="aw-link" type="button" onclick="showPage('tasks')">Ver toda la cola →</button></div>
        <div class="aw-queue-list">${queueHtml(queue,task.id)}</div>
      </div>`;
  }

  async function load(){
    setDashboardMode();
    try{
      const r=await fetch('/api/crm-execution',{cache:'no-store'}),j=await r.json();
      if(!r.ok)throw new Error(j.error||'No fue posible cargar el sistema comercial');
      render(j);
    }catch(err){
      const root=ensure();if(root)root.innerHTML='<div class="aw-empty">'+esc(err.message)+'</div>';
    }
  }

  window.agentWorkbenchOpenConversation=function(id){
    if(typeof window.showPage==='function')window.showPage('inbox');
    setTimeout(()=>{try{if(typeof window.openConversation==='function')window.openConversation(id)}catch(_){}},120);
  };
  window.loadAgentWorkbench=load;

  const oldSession=window.renderCrmSession;
  if(oldSession){
    window.renderCrmSession=function(){
      const out=oldSession.apply(this,arguments);
      setTimeout(()=>{setDashboardMode();load()},40);
      return out;
    };
  }
  const oldDashboard=window.loadDashboard;
  if(oldDashboard){
    window.loadDashboard=async function(){
      const out=await oldDashboard.apply(this,arguments);
      await load();
      return out;
    };
  }
  function init(){ensure();setDashboardMode();load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
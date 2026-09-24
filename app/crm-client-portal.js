(() => {
  let portalData=null, portalPage='summary';

  const SERVICE_UI={
    meta_ads:{label:'Meta Ads',icon:'M',group:'Pauta'},
    google_ads:{label:'Google Ads',icon:'G',group:'Pauta'},
    tiktok_ads:{label:'TikTok Ads',icon:'T',group:'Pauta'},
    organic_strategy:{label:'Estrategia Orgánica',icon:'O',group:'Contenido'},
    content_recording:{label:'Grabación de contenido',icon:'●',group:'Contenido'},
    editing:{label:'Edición',icon:'E',group:'Contenido'},
    crm:{label:'CRM',icon:'C',group:'Operación'},
    tasks:{label:'Tareas',icon:'✓',group:'Operación'},
    integrations:{label:'Integraciones',icon:'↔',group:'Operación'},
    web:{label:'Página web',icon:'W',group:'Activos'},
    landing:{label:'Landing Page',icon:'L',group:'Activos'},
    reports:{label:'Reportes',icon:'R',group:'Cuenta'},
    payments:{label:'Pagos',icon:'$',group:'Cuenta'}
  };

  function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function money(v){try{return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0)}catch(_){return '$'+Number(v||0)}}
  function number(v){return Number(v||0).toLocaleString('es-CO')}
  function date(v){if(!v)return '—';try{return new Date(v).toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'})}catch(_){return String(v)}}
  function clientMode(){return window.crmSession?.role==='client'||new URLSearchParams(location.search).get('client_preview')==='1'}
  function services(){return portalData?.services||[]}
  function service(key){return services().find(x=>x.service_key===key)||{service_key:key,service_name:SERVICE_UI[key]?.label||key,active_in_plan:false,client_visible:false,status:'inactive',metadata:{}}}
  function visibleServices(){return services().filter(x=>x.client_visible&&SERVICE_UI[x.service_key])}
  function portalAccess(key){const p=portalData?.portal_settings||{};return key==='crm'?p.crm===true:p[key]!==false}
  function crmEnabled(){const s=service('crm');return portalAccess('crm')&&s.active_in_plan&&s.client_visible&&s.status!=='inactive'}
  function statusLabel(v){return ({inactive:'Inactivo',setup:'En configuración',active:'Activo',paused:'Pausado',waiting_client:'Esperando información',under_construction:'En construcción',review:'En revisión',published:'Publicado',completed:'Completado'})[v]||v||'Inactivo'}
  function statusClass(v){return ['active','published','completed'].includes(v)?'active':['setup','waiting_client','under_construction','review'].includes(v)?'waiting':v==='paused'?'paused':'inactive'}

  function ensureShell(){
    const sidebar=document.getElementById('sidebar');if(!sidebar)return;
    if(!document.getElementById('clientNav')){
      const wrap=document.createElement('div');wrap.id='clientNav';
      const org=sidebar.querySelector('.org-context');org?.after(wrap);
    }
    if(!document.getElementById('clientHostReturn')){
      const a=document.createElement('a');a.id='clientHostReturn';a.className='client-host-return';a.href='/host';a.textContent='← Volver al Panel Host';
      document.getElementById('clientNav')?.before(a);
    }
    const main=document.querySelector('main.main');if(!main)return;
    const ids=['summary','services','results','tasks','requests','files','announcements','payments'];
    ids.forEach(p=>{
      if(document.getElementById('page-client-'+p))return;
      const s=document.createElement('section');s.className='client-portal-page hidden';s.id='page-client-'+p;main.appendChild(s);
    });
  }

  function renderNav(){
    const nav=document.getElementById('clientNav');if(!nav)return;
    const rows=[
      {id:'summary',label:'Inicio',icon:'⌂',always:true},
      {id:'services',label:'Servicios',icon:'▦'},
      {id:'results',label:'Resultados',icon:'↗'},
      {id:'tasks',label:'Tareas',icon:'✓'},
      {id:'requests',label:'Solicitudes',icon:'!'},
      {id:'files',label:'Archivos',icon:'▧'},
      {id:'announcements',label:'Anuncios',icon:'◉'},
      {id:'payments',label:'Pagos',icon:'$'}
    ].filter(x=>x.always||portalAccess(x.id));
    const slug=portalData?.organization?.slug||'';
    nav.innerHTML=rows.map(x=>'<button class="client-nav-item '+(portalPage===x.id?'active':'')+'" data-client-page="'+x.id+'"><span class="ico">'+x.icon+'</span>'+esc(x.label)+'</button>').join('')
      +(crmEnabled()?'<a class="client-nav-item client-nav-link" href="/crm?workspace='+encodeURIComponent(slug)+'&client_crm=1"><span class="ico">C</span>Abrir CRM</a>':'');
    nav.querySelectorAll('[data-client-page]').forEach(b=>b.addEventListener('click',()=>showClientPage(b.dataset.clientPage)));
  }

  function hideInternal(){
    document.body.classList.add('client-portal-mode');
    document.body.classList.toggle('client-preview-mode',new URLSearchParams(location.search).get('client_preview')==='1');
    document.querySelectorAll('section.content').forEach(x=>x.classList.add('hidden'));
    const badge=document.querySelector('.topbar>span');if(badge)badge.classList.add('hidden');
    const orgLabel=document.querySelector('.org-context label');if(orgLabel)orgLabel.textContent='Cliente';
    const logoSmall=document.querySelector('.logo small');if(logoSmall)logoSmall.textContent='PORTAL CLIENTE';
    const crumb=document.querySelector('.crumb');if(crumb)crumb.innerHTML='Portal / <b id="crumbTitle">Inicio</b>';
  }

  function metric(serviceKey,key,label,format='number'){
    const m=service(serviceKey).metadata?.metrics||{};
    if(m[key]===undefined||m[key]===null||m[key]==='')return null;
    const value=format==='money'?money(m[key]):format==='percent'?m[key]+'%':format==='roas'?m[key]+'x':number(m[key]);
    return {label,value};
  }

  function serviceMetrics(key){
    const s=portalData?.summary||{},c=portalData?.client||{},docs=portalData?.documents||[],reports=portalData?.weekly_reports||[];
    if(key==='meta_ads'||key==='google_ads'||key==='tiktok_ads'){
      return [
        metric(key,'spend','Inversión','money'),metric(key,'leads','Leads'),metric(key,'sales','Ventas'),metric(key,'cpl','CPL / CPA','money'),metric(key,'roas','ROAS','roas')
      ].filter(Boolean);
    }
    if(key==='organic_strategy'){
      return [metric(key,'reach','Alcance'),metric(key,'engagement','Interacción','percent'),metric(key,'followers','Nuevos seguidores'),metric(key,'pieces','Piezas publicadas')].filter(Boolean);
    }
    if(key==='crm')return [{label:'Oportunidades activas',value:number(s.opportunities_open)},{label:'Valor pipeline',value:money(s.pipeline_value)},{label:'Ventas ganadas',value:number(s.opportunities_won)},{label:'Valor ganado',value:money(s.won_value)}];
    if(key==='tasks')return [{label:'Pendientes',value:number(s.tasks_open)},{label:'Vencidas',value:number(s.tasks_overdue)}];
    if(key==='reports')return [{label:'Reportes semanales',value:number(reports.length)},{label:'Documentos',value:number(docs.filter(x=>!['invoice','receipt'].includes(x.document_type)).length)}];
    if(key==='payments')return [{label:'Mensualidad',value:money(c.monthly_fee)},{label:'Próximo pago',value:date(c.next_payment_date)}];
    return [
      metric(key,'primary','Indicador principal'),
      metric(key,'secondary','Indicador secundario')
    ].filter(Boolean);
  }

  function payState(){
    const st=portalData?.client?.payment_status||'current';
    const labels={overdue:'Pago pendiente',due_soon:'Pago próximo a vencer',courtesy:'Cortesía activa',tbd:'Pago por definir',paid:'Pagado',current:'Suscripción al día'};
    return {cls:st==='overdue'?'overdue':st==='due_soon'?'due':'',label:labels[st]||'Estado administrativo'};
  }

  function summaryHtml(){
    const d=portalData||{},c=d.client||{},s=d.summary||{},active=visibleServices().filter(x=>x.active_in_plan),pay=payState();
    const recent=[
      ...(portalAccess('announcements')?(d.announcements||[]).map(x=>({at:x.created_at,icon:'◉',title:x.title,meta:'Anuncio'})):[]),
      ...(portalAccess('requests')?(d.requests||[]).map(x=>({at:x.created_at,icon:'!',title:x.title,meta:'Solicitud · '+statusLabel(x.status)})):[]),
      ...(portalAccess('files')?(d.files||[]).map(x=>({at:x.created_at,icon:'▧',title:x.file_name,meta:'Archivo'})):[]),
      ...(portalAccess('tasks')?(d.tasks||[]).map(x=>({at:x.updated_at||x.created_at,icon:'✓',title:x.title,meta:'Tarea · '+statusLabel(x.status)})):[])
    ].sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,7);
    const metrics=[
      portalAccess('services')?'<div class="client-metric"><div class="k">Servicios activos</div><div class="v">'+active.length+'</div><div class="s">'+visibleServices().length+' visibles</div></div>':'',
      portalAccess('tasks')?'<div class="client-metric"><div class="k">Tareas pendientes</div><div class="v">'+number(s.tasks_open||0)+'</div><div class="s">'+number(s.tasks_waiting_client||0)+' esperando cliente</div></div>':'',
      portalAccess('requests')?'<div class="client-metric"><div class="k">Solicitudes abiertas</div><div class="v">'+number(s.requests_open||0)+'</div><div class="s">Cambios y reportes</div></div>':'',
      portalAccess('payments')?'<div class="client-metric"><div class="k">Próximo pago</div><div class="v">'+esc(date(c.next_payment_date))+'</div><div class="s">'+esc(pay.label)+'</div></div>':''
    ].filter(Boolean).join('');
    const quick=[
      portalAccess('requests')?'<button class="client-action" onclick="showClientPortalPage(\'requests\')">Reportar problema</button>':'',
      portalAccess('files')?'<button class="client-action secondary" onclick="showClientPortalPage(\'files\')">Subir archivo</button>':'',
      crmEnabled()?'<a class="client-action crm-action" href="/crm?workspace='+encodeURIComponent(d.organization?.slug||'')+'&client_crm=1">Entrar al CRM</a>':''
    ].filter(Boolean).join('');
    return '<div class="client-welcome"><div><div class="eyebrow">Portal de cliente</div><h1>'+esc(d.organization?.name||c.name||'Cliente')+'</h1><p>Tu operación con Segmenta, organizada según los accesos habilitados para tu cuenta.</p></div><span class="client-badge">'+active.length+' servicio(s) activo(s)</span></div>'+
      (metrics?'<div class="client-metrics">'+metrics+'</div>':'')+
      '<div class="client-home-grid">'+
      (portalAccess('services')?'<section class="client-card"><h3>Servicios</h3><p>Lo que Segmenta gestiona actualmente.</p><div class="client-service-grid">'+(visibleServices().length?visibleServices().slice(0,4).map(serviceOverviewCard).join(''):'<div class="client-empty">No hay servicios visibles todavía.</div>')+'</div></section>':'')+
      '<aside class="client-card"><h3>Acciones disponibles</h3><p>Solo aparecen las herramientas habilitadas para tu cuenta.</p><div class="portal-quick-actions">'+(quick||'<div class="client-empty">No hay acciones disponibles.</div>')+'</div>'+(portalAccess('payments')?'<div class="client-payment '+pay.cls+'" style="margin-top:12px"><span class="client-payment-dot"></span><div><b>'+esc(pay.label)+'</b><span>Próximo pago: '+date(c.next_payment_date)+'</span></div></div>':'')+'</aside></div>'+
      ((portalAccess('tasks')||portalAccess('requests')||portalAccess('files')||portalAccess('announcements'))?'<div class="client-card" style="margin-top:14px"><h3>Actividad reciente</h3><p>Últimos movimientos visibles de tu cuenta.</p><div class="client-list">'+(recent.length?recent.map(x=>'<div class="client-list-item"><div><b>'+esc(x.icon+' '+x.title)+'</b><p>'+esc(x.meta)+'</p></div><div class="right">'+date(x.at)+'</div></div>').join(''):'<div class="client-empty">Todavía no hay actividad registrada.</div>')+'</div></div>':'');
  }

  function serviceOverviewCard(s){
    const ui=SERVICE_UI[s.service_key]||{label:s.service_name||s.service_key,icon:'•',group:'Servicio'},metrics=serviceMetrics(s.service_key);
    const crmAction=s.service_key==='crm'&&crmEnabled()?'<a class="client-service-open" href="/crm?workspace='+encodeURIComponent(portalData?.organization?.slug||'')+'&client_crm=1">Abrir CRM →</a>':'';
    return '<article class="client-service-card"><div class="client-service-head"><span class="client-service-icon">'+esc(ui.icon)+'</span><div><b>'+esc(ui.label)+'</b><small>'+esc(ui.group)+'</small></div><span class="client-service-status '+statusClass(s.status)+'">'+esc(statusLabel(s.status))+'</span></div><div class="client-service-plan">'+(s.active_in_plan?'✓ Activo en tu plan':'No activo en tu plan')+'</div><div class="client-service-mini">'+(metrics.length?metrics.slice(0,2).map(m=>'<span><b>'+esc(m.value)+'</b><small>'+esc(m.label)+'</small></span>').join(''):'<span class="no-data">Sin métricas conectadas</span>')+'</div>'+crmAction+'</article>';
  }

  function serviceHeader(key){
    const s=service(key),ui=SERVICE_UI[key];
    return `<div class="client-welcome"><div><div class="eyebrow">${esc(ui.group)}</div><h1>${esc(ui.label)}</h1><p>${esc(s.notes||'Información y resultados del servicio.')}</p></div><div class="client-service-header-state"><span class="client-service-status ${statusClass(s.status)}">${esc(statusLabel(s.status))}</span><span class="client-plan-state ${s.active_in_plan?'on':'off'}">${s.active_in_plan?'Activo en tu plan':'No activo en tu plan'}</span></div></div>`;
  }

  function inactiveServiceHtml(key){
    const s=service(key),ui=SERVICE_UI[key];
    return serviceHeader(key)+`<div class="client-card"><div class="client-empty"><b>${esc(ui.label)} no está activo en tu plan.</b><br>Segmenta puede mantener esta pestaña visible para información o preparación, pero no hay ejecución activa del servicio.</div></div>`;
  }

  function adsHtml(key){
    const s=service(key),metrics=serviceMetrics(key),m=s.metadata?.metrics||{};
    if(!s.active_in_plan)return inactiveServiceHtml(key);
    return serviceHeader(key)+`
      <div class="client-metrics">${metrics.length?metrics.slice(0,4).map(x=>metricCard(x)).join(''):'<div class="client-empty" style="grid-column:1/-1">El servicio está activo, pero todavía no hay una fuente de métricas conectada.</div>'}</div>
      <div class="client-grid">
        <div class="client-card"><h3>Rendimiento</h3><p>Indicadores del periodo sincronizado para esta plataforma.</p>
          ${metrics.length?'<div class="client-kpi-list">'+metrics.map(x=>`<div><span>${esc(x.label)}</span><b>${esc(x.value)}</b></div>`).join('')+'</div>':'<div class="client-empty">Sin datos de campaña todavía.</div>'}
        </div>
        <div class="client-card"><h3>Estado del servicio</h3><p>Seguimiento operativo de la cuenta.</p>
          <div class="client-account-line"><span>Estado</span><b>${esc(statusLabel(s.status))}</b></div>
          <div class="client-account-line"><span>Alcance contratado</span><b>${esc(s.plan_label||'Según acuerdo')}</b></div>
          <div class="client-account-line"><span>Última actualización</span><b>${esc(s.metadata?.metrics_updated_at?date(s.metadata.metrics_updated_at):'Sin sincronización')}</b></div>
        </div>
      </div>`;
  }

  function organicHtml(){
    const key='organic_strategy',s=service(key),metrics=serviceMetrics(key);
    if(!s.active_in_plan)return inactiveServiceHtml(key);
    return serviceHeader(key)+`<div class="client-metrics">${metrics.length?metrics.map(metricCard).join(''):'<div class="client-empty" style="grid-column:1/-1">Estrategia activa. Todavía no hay métricas orgánicas conectadas.</div>'}</div>
      <div class="client-card"><h3>Estrategia y próximos pasos</h3><p>Lectura del equipo sobre contenido y crecimiento.</p>${analysisList()}</div>`;
  }

  function metricCard(x){return `<div class="client-metric"><div class="k">${esc(x.label)}</div><div class="v">${esc(x.value)}</div></div>`}

  function crmHtml(){
    const key='crm',s=service(key),rows=portalData?.opportunities||[];
    if(!s.active_in_plan)return inactiveServiceHtml(key);
    return serviceHeader(key)+`
      <div class="client-metrics">${serviceMetrics(key).map(metricCard).join('')}</div>
      <div class="client-table-wrap"><table class="client-table"><thead><tr><th>Oportunidad</th><th>Etapa</th><th>Valor</th><th>Producto</th><th>Ciudad</th><th>Origen</th><th>Actualizado</th></tr></thead><tbody>${rows.length?rows.map(o=>`<tr><td><b>${esc(o.title||'Oportunidad')}</b></td><td>${esc(o.stage||'—')}</td><td>${money(o.value)}</td><td>${esc(o.product||'—')}</td><td>${esc(o.city||'—')}</td><td>${esc(o.source||'—')}</td><td>${date(o.updated_at)}</td></tr>`).join(''):'<tr><td colspan="7">Aún no hay oportunidades.</td></tr>'}</tbody></table></div>`;
  }

  function tasksHtml(){
    const rows=portalData?.tasks||[];
    return '<div class="client-welcome"><div><div class="eyebrow">Pendientes</div><h1>Tareas</h1><p>Responsabilidades compartidas entre tu equipo y Segmenta.</p></div><button class="client-action" onclick="document.getElementById(\'taskFormWrap\').classList.toggle(\'hidden\')">＋ Nueva tarea</button></div><div id="taskFormWrap" class="client-card hidden"><h3>Crear tarea</h3><div class="client-form-grid"><label class="wide">Título<input id="taskTitle" placeholder="Ej. Enviar fotografías del producto"></label><label>Servicio<select id="taskService"><option value="">General</option>'+visibleServices().map(s=>'<option value="'+esc(s.service_key)+'">'+esc(SERVICE_UI[s.service_key]?.label||s.service_name)+'</option>').join('')+'</select></label><label>Prioridad<select id="taskPriority"><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option><option value="low">Baja</option></select></label><label>Fecha límite<input id="taskDue" type="datetime-local"></label><label>Adjunto<input id="taskFile" type="file" accept="image/*,application/pdf,video/*"></label><label class="wide">Descripción<textarea id="taskDescription" rows="3"></textarea></label></div><button class="client-action" onclick="submitPortalTask()">Crear tarea</button></div><div class="portal-stack">'+(rows.length?rows.map(t=>'<article class="client-card portal-work-item"><div class="portal-work-head"><div><b>'+esc(t.title)+'</b><p>'+esc(t.description||'')+'</p></div><span class="portal-status '+statusClass(t.status)+'">'+esc(statusLabel(t.status))+'</span></div><div class="portal-work-meta"><span>Prioridad: '+esc(t.priority||'normal')+'</span><span>Vence: '+date(t.due_at)+'</span><span>Creada por: '+esc(t.metadata?.created_by_role==='client'?'Cliente':'Segmenta')+'</span></div>'+attachments('task',t.id)+(!['completed','done'].includes(t.status)?'<div class="portal-work-actions"><button onclick="setPortalTaskStatus(\''+t.id+'\',\'review\')">Enviar a revisión</button><button onclick="setPortalTaskStatus(\''+t.id+'\',\'completed\')">Completar</button></div>':'')+commentThread('task',t.id)+'</article>').join(''):'<div class="client-card client-empty">No hay tareas visibles todavía.</div>')+'</div>';
  }

  function genericServiceHtml(key){
    const s=service(key),metrics=serviceMetrics(key);
    if(!s.active_in_plan)return inactiveServiceHtml(key);
    return serviceHeader(key)+`<div class="client-metrics">${metrics.length?metrics.map(metricCard).join(''):'<div class="client-empty" style="grid-column:1/-1">Servicio activo. Todavía no hay métricas conectadas para este módulo.</div>'}</div>
      <div class="client-card"><h3>Estado operativo</h3><p>${esc(s.notes||'Segmenta está gestionando este servicio según el alcance acordado.')}</p><div class="client-account-line"><span>Estado</span><b>${esc(statusLabel(s.status))}</b></div><div class="client-account-line"><span>Alcance</span><b>${esc(s.plan_label||'Según acuerdo')}</b></div></div>`;
  }

  function paymentsHtml(){
    const c=portalData?.client||{},pay=payState(),docs=(portalData?.documents||[]).filter(x=>['invoice','receipt'].includes(x.document_type));
    return '<div class="client-welcome"><div><div class="eyebrow">Administración</div><h1>Pagos</h1><p>Estado de cuenta, próxima fecha y documentos publicados.</p></div></div><div class="client-grid"><div class="client-card"><h3>Estado de cuenta</h3><div class="client-payment '+pay.cls+'"><span class="client-payment-dot"></span><div><b>'+esc(pay.label)+'</b><span>Próximo pago: '+date(c.next_payment_date)+'</span></div></div><div class="client-account-line"><span>Mensualidad</span><b>'+money(c.monthly_fee||0)+'</b></div><div class="client-account-line"><span>Método / referencia</span><b>'+esc(c.payment_method_label||'Por definir')+'</b></div></div><div class="client-card"><h3>Facturas y recibos</h3><div class="client-list">'+(docs.length?docs.map(docHtml).join(''):'<div class="client-empty">No hay documentos de pago publicados.</div>')+'</div></div></div>';
  }

  function reportsHtml(){
    const key='reports',s=service(key),docs=(portalData?.documents||[]).filter(x=>!['invoice','receipt'].includes(x.document_type)),reports=portalData?.weekly_reports||[];
    if(!s.active_in_plan)return inactiveServiceHtml(key);
    return serviceHeader(key)+`
      <div class="client-report-grid">${reports.length?reports.map(r=>`<div class="client-report"><div class="week">${esc(r.week_label||date(r.created_at))}</div><div class="big">${number(r.total_reach)}</div><div class="meta">Alcance · ${number(r.total_engagements)} interacciones · ${number(r.new_followers)} seguidores<br>${esc(r.summary||'')}</div></div>`).join(''):'<div class="client-empty">Aún no hay reportes semanales.</div>'}</div>
      <div class="client-card" style="margin-top:12px"><h3>Análisis del equipo</h3><p>Lectura estratégica y próximos pasos.</p>${analysisList()}</div>
      <div class="client-card" style="margin-top:12px"><h3>Documentos</h3><div class="client-list">${docs.length?docs.map(docHtml).join(''):'<div class="client-empty">Aún no hay documentos publicados.</div>'}</div></div>`;
  }

  function analysisList(){
    const analyses=portalData?.analyses||[];
    return '<div class="client-list">'+(analyses.length?analyses.map(a=>`<div class="client-analysis"><b>${esc(a.title)}</b><div class="date">${date(a.published_at)}</div><p>${esc(a.body)}</p></div>`).join(''):'<div class="client-empty">Aún no hay análisis publicados.</div>')+'</div>';
  }

  function docHtml(d){
    return `<div class="client-doc"><div class="client-doc-icon">▧</div><div class="client-doc-main"><b>${esc(d.name)}</b><span>${esc(d.document_type)} · ${date(d.document_date||d.created_at)}</span></div>${d.url?`<a href="${esc(d.url)}" target="_blank" rel="noopener">Abrir ↗</a>`:''}</div>`;
  }


  function servicesHubHtml(){
    return '<div class="client-welcome"><div><div class="eyebrow">Tu plan</div><h1>Servicios</h1><p>Solo ves los servicios que Segmenta habilitó para tu cuenta.</p></div></div><div class="client-service-grid">'+(visibleServices().length?visibleServices().map(serviceOverviewCard).join(''):'<div class="client-card client-empty">Aún no hay servicios habilitados.</div>')+'</div>';
  }

  function resultsHubHtml(){
    const cards=visibleServices().filter(x=>x.active_in_plan).map(s=>{
      const ui=SERVICE_UI[s.service_key]||{label:s.service_name||s.service_key},metrics=serviceMetrics(s.service_key);
      return '<div class="client-card"><h3>'+esc(ui.label)+'</h3><p>'+esc(statusLabel(s.status))+'</p>'+(metrics.length?'<div class="client-kpi-list">'+metrics.slice(0,6).map(m=>'<div><span>'+esc(m.label)+'</span><b>'+esc(m.value)+'</b></div>').join('')+'</div>':'<div class="client-empty">Servicio activo, todavía sin métricas conectadas.</div>')+'</div>';
    });
    const reports=portalData?.weekly_reports||[];
    return '<div class="client-welcome"><div><div class="eyebrow">Rendimiento</div><h1>Resultados</h1><p>Métricas, reportes y aprendizajes publicados para tu cuenta.</p></div></div><div class="client-grid">'+
      (cards.length?'<div style="display:grid;gap:12px">'+cards.join('')+'</div>':'<div class="client-card client-empty">Aún no hay resultados visibles.</div>')+
      '<div class="client-card"><h3>Reportes recientes</h3><p>Lectura del equipo y próximos pasos.</p><div class="client-list">'+
      (reports.length?reports.slice(0,8).map(r=>'<div class="client-list-item"><div><b>'+esc(r.week_label||date(r.created_at))+'</b><p>'+number(r.total_reach)+' alcance · '+number(r.total_engagements)+' interacciones</p><small>'+esc(r.summary||'')+'</small></div></div>').join(''):'<div class="client-empty">Sin reportes publicados.</div>')+
      '</div><div style="margin-top:12px">'+analysisList()+'</div></div></div>';
  }

  function commentsFor(type,id){return (portalData?.comments||[]).filter(x=>x.entity_type===type&&x.entity_id===id)}
  function linkedFiles(kind,id){return (portalData?.files||[]).filter(x=>kind==='task'?x.task_id===id:x.request_id===id)}
  function commentThread(type,id){
    const rows=commentsFor(type,id);
    return '<div class="portal-comments">'+(rows.length?rows.map(c=>'<div class="portal-comment '+(c.created_by_role==='client'?'client':'segmenta')+'"><b>'+esc(c.created_by_role==='client'?'Cliente':'Segmenta')+'</b><span>'+date(c.created_at)+'</span><p>'+esc(c.body)+'</p></div>').join(''):'<div class="portal-no-comments">Sin comentarios.</div>')+'<div class="portal-comment-form"><input id="comment_'+type+'_'+id+'" placeholder="Escribe un comentario..."><button onclick="addPortalComment(\''+type+'\',\''+id+'\')">Enviar</button></div></div>';
  }
  function attachments(kind,id){
    const rows=linkedFiles(kind,id);
    return rows.length?'<div class="portal-attachments">'+rows.map(f=>'<a href="'+esc(f.file_url)+'" target="_blank" rel="noopener">▧ '+esc(f.file_name)+'</a>').join('')+'</div>':'';
  }


  async function portalPost(body){
    const r=await fetch('/api/client-portal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||'No fue posible completar la acción');
    return j;
  }

  function requestsHtml(){
    const rows=portalData?.requests||[];
    return '<div class="client-welcome"><div><div class="eyebrow">Soporte y cambios</div><h1>Solicitudes</h1><p>Reporta errores, cambios, campañas o necesidades de contenido.</p></div><button class="client-action" onclick="document.getElementById(\'requestFormWrap\').classList.toggle(\'hidden\')">＋ Nueva solicitud</button></div><div id="requestFormWrap" class="client-card hidden"><h3>Reportar problema o solicitud</h3><div class="client-form-grid"><label>Tipo<select id="reqType"><option value="error">Error</option><option value="change">Cambio</option><option value="request">Solicitud</option><option value="content">Contenido</option><option value="campaign">Campaña</option><option value="other">Otro</option></select></label><label>Prioridad<select id="reqPriority"><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option><option value="low">Baja</option></select></label><label class="wide">Título<input id="reqTitle" placeholder="Ej. Cambiar precio del producto"></label><label class="wide">Descripción<textarea id="reqDescription" rows="4" placeholder="Describe lo que necesitas..."></textarea></label><label class="wide">Adjuntar captura o archivo<input id="reqFile" type="file" accept="image/*,application/pdf,video/*"></label></div><button class="client-action" onclick="submitClientRequest()">Enviar solicitud</button></div><div class="portal-stack">'+(rows.length?rows.map(x=>'<article class="client-card portal-work-item"><div class="portal-work-head"><div><b>'+esc(x.title)+'</b><p>'+esc(x.description||'')+'</p></div><span class="portal-status '+statusClass(x.status)+'">'+esc(statusLabel(x.status))+'</span></div><div class="portal-work-meta"><span>'+esc(x.request_type)+'</span><span>Prioridad: '+esc(x.priority)+'</span><span>'+date(x.created_at)+'</span></div>'+attachments('request',x.id)+commentThread('request',x.id)+'</article>').join(''):'<div class="client-card client-empty">No hay solicitudes registradas.</div>')+'</div>';
  }

  window.submitPortalTask=async function(){
    try{
      const created=await portalPost({action:'create_task',title:document.getElementById('taskTitle').value,description:document.getElementById('taskDescription').value,service_key:document.getElementById('taskService').value,priority:document.getElementById('taskPriority').value,due_at:document.getElementById('taskDue').value||null});
      const file=document.getElementById('taskFile').files?.[0];
      if(file){
        const base64=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(String(fr.result).split(',')[1]);fr.onerror=reject;fr.readAsDataURL(file)});
        await portalPost({action:'upload_file',task_id:created.task?.id||null,file_name:file.name,mime_type:file.type,file_base64:base64});
      }
      await load();showClientPage('tasks');
    }catch(e){alert(e.message)}
  };

  window.addPortalComment=async function(type,id){
    try{
      const input=document.getElementById('comment_'+type+'_'+id),body=input?.value?.trim();if(!body)return;
      await portalPost({action:'add_comment',entity_type:type,entity_id:id,body});await load();showClientPage(portalPage);
    }catch(e){alert(e.message)}
  };

  window.setPortalTaskStatus=async function(id,status){
    try{await portalPost({action:'set_task_status',task_id:id,status});await load();showClientPage('tasks')}catch(e){alert(e.message)}
  };

  window.uploadGeneralPortalFile=async function(){
    try{
      const file=document.getElementById('generalFile').files?.[0];if(!file)throw new Error('Selecciona un archivo');
      const base64=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(String(fr.result).split(',')[1]);fr.onerror=reject;fr.readAsDataURL(file)});
      await portalPost({action:'upload_file',file_name:file.name,mime_type:file.type,file_base64:base64});await load();showClientPage('files');
    }catch(e){alert(e.message)}
  };

  window.submitClientRequest=async function(){
    try{
      const created=await portalPost({action:'create_request',request_type:document.getElementById('reqType').value,priority:document.getElementById('reqPriority').value,title:document.getElementById('reqTitle').value,description:document.getElementById('reqDescription').value});
      const file=document.getElementById('reqFile').files?.[0];
      if(file){
        const base64=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(String(fr.result).split(',')[1]);fr.onerror=reject;fr.readAsDataURL(file)});
        await portalPost({action:'upload_file',request_id:created.request?.id||null,file_name:file.name,mime_type:file.type,file_base64:base64});
      }
      await load(); showClientPage('requests');
    }catch(e){alert(e.message)}
  };

  function filesHtml(){
    const rows=portalData?.files||[];
    return '<div class="client-welcome"><div><div class="eyebrow">Material compartido</div><h1>Archivos</h1><p>Fotos, videos, logos, catálogos, capturas y documentos.</p></div></div><div class="client-card" style="margin-bottom:12px"><h3>Subir archivo</h3><p>El archivo quedará asociado a tu cuenta y disponible para Segmenta.</p><div class="portal-upload-row"><input id="generalFile" type="file" accept="image/*,application/pdf,video/*,.csv,.xlsx,.doc,.docx"><button class="client-action" onclick="uploadGeneralPortalFile()">Subir</button></div></div><div class="client-card"><div class="client-list">'+(rows.length?rows.map(f=>'<div class="client-doc"><div class="client-doc-icon">▧</div><div class="client-doc-main"><b>'+esc(f.file_name)+'</b><span>'+date(f.created_at)+' · '+esc(f.uploaded_by_role==='client'?'Cliente':'Segmenta')+'</span></div><a href="'+esc(f.file_url)+'" target="_blank" rel="noopener">Abrir ↗</a></div>').join(''):'<div class="client-empty">Aún no hay archivos compartidos.</div>')+'</div></div>';
  }

  function announcementsHtml(){
    const rows=portalData?.announcements||[];
    return '<div class="client-welcome"><div><div class="eyebrow">Novedades</div><h1>Anuncios</h1><p>Actualizaciones sobre campañas, entregables, bloqueos y próximos pasos.</p></div></div><div class="portal-stack">'+(rows.length?rows.map(a=>'<article class="client-card portal-announcement"><div class="portal-work-head"><div><b>'+esc(a.title)+'</b><p>'+date(a.created_at)+'</p></div><span>Segmenta</span></div><p>'+esc(a.body)+'</p>'+commentThread('announcement',a.id)+'</article>').join(''):'<div class="client-card client-empty">Aún no hay anuncios.</div>')+'</div>';
  }

  function renderPage(){
    if(!portalData)return;
    const page=document.getElementById('page-client-'+portalPage);if(!page)return;
    const renderers={summary:summaryHtml,services:servicesHubHtml,results:resultsHubHtml,tasks:tasksHtml,requests:requestsHtml,files:filesHtml,announcements:announcementsHtml,payments:paymentsHtml};
    page.innerHTML=(renderers[portalPage]||summaryHtml)();
  }

  function showClientPage(page){
    const allowed=['summary','services','results','tasks','requests','files','announcements','payments'];
    if(!allowed.includes(page))page='summary';
    if(page!=='summary'&&!portalAccess(page))page='summary';
    portalPage=page;
    document.querySelectorAll('.client-portal-page').forEach(x=>x.classList.add('hidden'));
    const el=document.getElementById('page-client-'+page);if(el)el.classList.remove('hidden');
    renderNav();renderPage();
    const labels={summary:'Inicio',services:'Servicios',results:'Resultados',tasks:'Tareas',requests:'Solicitudes',files:'Archivos',announcements:'Anuncios',payments:'Pagos'};
    const crumb=document.getElementById('crumbTitle');if(crumb)crumb.textContent=labels[page]||'Inicio';
  }
  window.showClientPortalPage=showClientPage;

  async function load(){
    if(!clientMode())return;
    ensureShell();hideInternal();
    try{
      const r=await fetch('/api/client-portal',{cache:'no-store'}),j=await r.json();
      if(!r.ok)throw new Error(j.error||'No fue posible cargar el portal');
      portalData=j;renderNav();showClientPage('summary');
    }catch(err){
      const p=document.getElementById('page-client-summary');if(p){p.classList.remove('hidden');p.innerHTML='<div class="client-empty">'+esc(err.message)+'</div>'}
    }
  }
  window.loadClientPortal=load;

  const originalRender=window.renderCrmSession;
  if(originalRender)window.renderCrmSession=function(...args){const out=originalRender.apply(this,args);if(clientMode())setTimeout(load,0);return out};

  function init(){ensureShell();if(clientMode())load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
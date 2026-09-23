(() => {
  let portalData=null, portalPage='summary';

  const SERVICE_UI={
    meta_ads:{label:'Meta Ads',icon:'M',group:'Pauta'},
    google_ads:{label:'Google Ads',icon:'G',group:'Pauta'},
    tiktok_ads:{label:'TikTok Ads',icon:'T',group:'Pauta'},
    organic_strategy:{label:'Estrategia Orgánica',icon:'O',group:'Contenido'},
    crm:{label:'CRM',icon:'C',group:'Operación'},
    tasks:{label:'Tareas',icon:'✓',group:'Operación'},
    integrations:{label:'Integraciones',icon:'↔',group:'Operación'},
    web_landing:{label:'Web / Landing',icon:'W',group:'Activos'},
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
  function statusLabel(v){return ({inactive:'Inactivo',setup:'En configuración',active:'Activo',paused:'Pausado',waiting_client:'Esperando información'})[v]||v||'Inactivo'}
  function statusClass(v){return v==='active'?'active':v==='setup'||v==='waiting_client'?'waiting':v==='paused'?'paused':'inactive'}

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
    const ids=['summary',...Object.keys(SERVICE_UI)];
    ids.forEach(p=>{
      if(document.getElementById('page-client-'+p))return;
      const s=document.createElement('section');s.className='client-portal-page hidden';s.id='page-client-'+p;main.appendChild(s);
    });
  }

  function renderNav(){
    const nav=document.getElementById('clientNav');if(!nav)return;
    const rows=[{id:'summary',label:'Inicio',icon:'⌂'},...visibleServices().map(s=>({id:s.service_key,label:SERVICE_UI[s.service_key].label,icon:SERVICE_UI[s.service_key].icon}))];
    nav.innerHTML='<div class="client-nav-label">Tu cuenta</div>'+rows.map(x=>`<button class="client-nav-item ${portalPage===x.id?'active':''}" data-client-page="${x.id}"><span class="ico">${x.icon}</span>${esc(x.label)}</button>`).join('');
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
    return {cls:st==='overdue'?'overdue':st==='due_soon'?'due':'',label:st==='overdue'?'Pago pendiente':st==='due_soon'?'Pago próximo a vencer':'Suscripción al día'};
  }

  function summaryHtml(){
    const d=portalData||{},c=d.client||{},active=services().filter(x=>x.active_in_plan),visible=visibleServices(),pay=payState();
    return `<div class="client-welcome"><div><div class="eyebrow">Portal Segmenta</div><h1>${esc(d.organization?.name||c.name||'Cliente')}</h1><p>Consulta únicamente los servicios, resultados y entregables habilitados para tu cuenta.</p></div><span class="client-badge">${active.length} servicio(s) activo(s)</span></div>
      <div class="client-home-grid">
        <section class="client-card client-services-overview"><h3>Servicios de tu cuenta</h3><p>Estado actual de lo que Segmenta gestiona contigo.</p>
          <div class="client-service-grid">${visible.length?visible.map(serviceOverviewCard).join(''):'<div class="client-empty">Todavía no hay servicios visibles en tu portal.</div>'}</div>
        </section>
        <aside class="client-card"><h3>Cuenta</h3><p>Información administrativa.</p>
          <div class="client-payment ${pay.cls}"><span class="client-payment-dot"></span><div><b>${pay.label}</b><span>Próximo pago: ${date(c.next_payment_date)}</span></div></div>
          <div class="client-account-line"><span>Plan</span><b>${esc(c.plan||'—')}</b></div>
          <div class="client-account-line"><span>Mensualidad</span><b>${money(c.monthly_fee||0)}</b></div>
        </aside>
      </div>`;
  }

  function serviceOverviewCard(s){
    const ui=SERVICE_UI[s.service_key],metrics=serviceMetrics(s.service_key);
    return `<button type="button" class="client-service-card" onclick="showClientPortalPage('${s.service_key}')">
      <div class="client-service-head"><span class="client-service-icon">${ui.icon}</span><div><b>${esc(ui.label)}</b><small>${esc(ui.group)}</small></div><span class="client-service-status ${statusClass(s.status)}">${esc(statusLabel(s.status))}</span></div>
      <div class="client-service-plan">${s.active_in_plan?'✓ Activo en tu plan':'No activo en tu plan'}</div>
      <div class="client-service-mini">${metrics.length?metrics.slice(0,2).map(m=>`<span><b>${esc(m.value)}</b><small>${esc(m.label)}</small></span>`).join(''):'<span class="no-data">Sin métricas conectadas</span>'}</div>
    </button>`;
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
    const key='tasks',s=service(key),rows=portalData?.tasks||[];
    if(!s.active_in_plan)return inactiveServiceHtml(key);
    return serviceHeader(key)+`<div class="client-metrics">${serviceMetrics(key).map(metricCard).join('')}</div>
      <div class="client-card"><h3>Tareas activas</h3><p>Seguimiento visible de pendientes del proceso.</p><div class="client-list">${rows.length?rows.map(t=>`<div class="client-list-item"><div><b>${esc(t.title||t.task_type)}</b><p>${esc(t.priority||'P3')} · ${esc(t.status)}</p></div><div class="right">${date(t.due_at)}</div></div>`).join(''):'<div class="client-empty">No hay tareas pendientes.</div>'}</div></div>`;
  }

  function genericServiceHtml(key){
    const s=service(key),metrics=serviceMetrics(key);
    if(!s.active_in_plan)return inactiveServiceHtml(key);
    return serviceHeader(key)+`<div class="client-metrics">${metrics.length?metrics.map(metricCard).join(''):'<div class="client-empty" style="grid-column:1/-1">Servicio activo. Todavía no hay métricas conectadas para este módulo.</div>'}</div>
      <div class="client-card"><h3>Estado operativo</h3><p>${esc(s.notes||'Segmenta está gestionando este servicio según el alcance acordado.')}</p><div class="client-account-line"><span>Estado</span><b>${esc(statusLabel(s.status))}</b></div><div class="client-account-line"><span>Alcance</span><b>${esc(s.plan_label||'Según acuerdo')}</b></div></div>`;
  }

  function paymentsHtml(){
    const key='payments',s=service(key),c=portalData?.client||{},pay=payState(),docs=(portalData?.documents||[]).filter(x=>['invoice','receipt'].includes(x.document_type));
    if(!s.active_in_plan)return inactiveServiceHtml(key);
    return serviceHeader(key)+`<div class="client-grid"><div class="client-card"><h3>Tu servicio</h3><p>Información administrativa de la cuenta.</p>
      <div class="client-payment ${pay.cls}"><span class="client-payment-dot"></span><div><b>${pay.label}</b><span>${money(c.monthly_fee||0)} / mes · próximo pago ${date(c.next_payment_date)}</span></div></div>
      <div class="client-account-line"><span>Plan</span><b>${esc(c.plan||'—')}</b></div><div class="client-account-line"><span>Método</span><b>${esc(c.payment_method_label||'No registrado')}</b></div>
      </div><div class="client-card"><h3>Facturas y recibos</h3><p>Documentos administrativos disponibles.</p><div class="client-list">${docs.length?docs.map(docHtml).join(''):'<div class="client-empty">No hay documentos de pago publicados.</div>'}</div></div></div>`;
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

  function renderPage(){
    if(!portalData)return;
    const page=document.getElementById('page-client-'+portalPage);if(!page)return;
    const renderers={
      summary:summaryHtml,meta_ads:()=>adsHtml('meta_ads'),google_ads:()=>adsHtml('google_ads'),tiktok_ads:()=>adsHtml('tiktok_ads'),
      organic_strategy:organicHtml,crm:crmHtml,tasks:tasksHtml,integrations:()=>genericServiceHtml('integrations'),
      web_landing:()=>genericServiceHtml('web_landing'),reports:reportsHtml,payments:paymentsHtml
    };
    page.innerHTML=(renderers[portalPage]||summaryHtml)();
  }

  function showClientPage(page){
    if(page!=='summary'&&!service(page).client_visible){page='summary'}
    portalPage=page;
    document.querySelectorAll('.client-portal-page').forEach(x=>x.classList.add('hidden'));
    const el=document.getElementById('page-client-'+page);if(el)el.classList.remove('hidden');
    renderNav();renderPage();
    const crumb=document.getElementById('crumbTitle');if(crumb)crumb.textContent=page==='summary'?'Inicio':(SERVICE_UI[page]?.label||page);
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
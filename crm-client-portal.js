(() => {
  let portalData=null, portalPage='summary';

  function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function money(v){try{return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0)}catch(_){return '$'+Number(v||0)}}
  function date(v){if(!v)return '—';try{return new Date(v).toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'})}catch(_){return String(v)}}
  function clientMode(){return window.crmSession?.role==='client'||new URLSearchParams(location.search).get('client_preview')==='1'}
  function setting(key){return portalData?.portal_settings?.[key]!==false}

  function ensureShell(){
    const sidebar=document.getElementById('sidebar');if(!sidebar)return;
    if(!document.getElementById('clientNav')){
      const wrap=document.createElement('div');wrap.id='clientNav';
      const org=sidebar.querySelector('.org-context');
      org?.after(wrap);
    }
    if(!document.getElementById('clientHostReturn')){
      const a=document.createElement('a');a.id='clientHostReturn';a.className='client-host-return';a.href='/host';a.textContent='← Volver al Panel Host';
      document.getElementById('clientNav')?.before(a);
    }
    const main=document.querySelector('main.main');if(!main)return;
    ['summary','results','crm','payments','reports'].forEach(p=>{
      if(document.getElementById('page-client-'+p))return;
      const s=document.createElement('section');s.className='client-portal-page hidden';s.id='page-client-'+p;main.appendChild(s);
    });
  }

  function renderNav(){
    const nav=document.getElementById('clientNav');if(!nav)return;
    const items=[
      ['summary','⌂','Resumen',true],
      ['results','▤','Resultados',setting('results')],
      ['crm','◫','CRM',setting('crm')],
      ['payments','●','Pagos',setting('payments')],
      ['reports','▧','Reportes',setting('reports')]
    ].filter(x=>x[3]);
    nav.innerHTML='<div class="client-nav-label">Portal del cliente</div>'+items.map(([id,ico,label])=>`<button class="client-nav-item ${portalPage===id?'active':''}" data-client-page="${id}"><span class="ico">${ico}</span>${label}</button>`).join('');
    nav.querySelectorAll('[data-client-page]').forEach(b=>b.addEventListener('click',()=>showClientPage(b.dataset.clientPage)));
  }

  function hideInternal(){
    document.body.classList.add('client-portal-mode');
    document.body.classList.toggle('client-preview-mode',new URLSearchParams(location.search).get('client_preview')==='1');
    document.querySelectorAll('section.content').forEach(x=>x.classList.add('hidden'));
    const badge=document.querySelector('.topbar>span');if(badge)badge.classList.add('hidden');
    const orgLabel=document.querySelector('.org-context label');if(orgLabel)orgLabel.textContent='Cliente';
    const logoSmall=document.querySelector('.logo small');if(logoSmall)logoSmall.textContent='PORTAL CLIENTE';
    const crumb=document.querySelector('.crumb');if(crumb)crumb.innerHTML='Portal / <b id="crumbTitle">Resumen</b>';
  }

  function payState(){
    const st=portalData?.client?.payment_status||'current';
    return {
      cls:st==='overdue'?'overdue':st==='due_soon'?'due':'',
      label:st==='overdue'?'Pago pendiente':st==='due_soon'?'Pago próximo a vencer':'Suscripción al día'
    };
  }

  function summaryHtml(){
    const d=portalData||{},c=d.client||{},s=d.summary||{},latest=(d.weekly_reports||[])[0],pay=payState();
    return `<div class="client-welcome"><div><div class="eyebrow">Portal Segmenta</div><h1>${esc(d.organization?.name||c.name||'Cliente')}</h1><p>Resultados, CRM, pagos e informes en un solo lugar.</p></div><span class="client-badge">${esc(c.plan||'estandar')} · ${money(c.monthly_fee||0)}/mes</span></div>
      <div class="client-metrics">
        <div class="client-metric"><div class="k">Oportunidades activas</div><div class="v">${Number(s.opportunities_open||0)}</div><div class="s">CRM actual</div></div>
        <div class="client-metric"><div class="k">Valor en pipeline</div><div class="v">${money(s.pipeline_value)}</div><div class="s">Estimado</div></div>
        <div class="client-metric"><div class="k">Ventas ganadas</div><div class="v">${Number(s.opportunities_won||0)}</div><div class="s">${money(s.won_value)}</div></div>
        <div class="client-metric"><div class="k">Último alcance</div><div class="v">${Number(latest?.total_reach||0).toLocaleString('es-CO')}</div><div class="s">${esc(latest?.week_label||'Sin reporte aún')}</div></div>
      </div>
      <div class="client-grid">
        <div class="client-card"><h3>Últimos resultados</h3><p>Resumen del reporte más reciente.</p>
          ${latest?`<div class="client-report-grid">
            <div class="client-report"><div class="week">Alcance</div><div class="big">${Number(latest.total_reach||0).toLocaleString('es-CO')}</div><div class="meta">${esc(latest.week_label||'')}</div></div>
            <div class="client-report"><div class="week">Interacciones</div><div class="big">${Number(latest.total_engagements||0).toLocaleString('es-CO')}</div><div class="meta">Engagement ${Number(latest.engagement_rate||0)}%</div></div>
            <div class="client-report"><div class="week">Nuevos seguidores</div><div class="big">${Number(latest.new_followers||0).toLocaleString('es-CO')}</div><div class="meta">${Number(latest.pieces_published||0)} piezas publicadas</div></div>
          </div>${c.dashboard_url?`<a class="client-dashboard-link" href="${esc(c.dashboard_url)}" target="_blank" rel="noopener">Abrir tablero completo ↗</a>`:''}`:'<div class="client-empty">Todavía no hay reportes publicados.</div>'}
        </div>
        <div class="client-card"><h3>Estado de pago</h3><p>Estado administrativo de tu servicio.</p>
          <div class="client-payment ${pay.cls}"><span class="client-payment-dot"></span><div><b>${pay.label}</b><span>Próximo pago: ${date(c.next_payment_date)} · ${esc(c.payment_method_label||'Método no registrado')}</span></div></div>
        </div>
      </div>`;
  }

  function resultsHtml(){
    const d=portalData||{},reports=d.weekly_reports||[],analyses=d.analyses||[];
    return `<div class="client-welcome"><div><div class="eyebrow">Resultados</div><h1>Rendimiento</h1><p>Reportes publicados por el equipo de Segmenta.</p></div>${d.client?.dashboard_url?`<a class="client-dashboard-link" href="${esc(d.client.dashboard_url)}" target="_blank" rel="noopener">Abrir tablero completo ↗</a>`:''}</div>
      <div class="client-report-grid">${reports.length?reports.map(r=>`<div class="client-report"><div class="week">${esc(r.week_label||date(r.created_at))}</div><div class="big">${Number(r.total_reach||0).toLocaleString('es-CO')}</div><div class="meta">Alcance · ${Number(r.total_engagements||0).toLocaleString('es-CO')} interacciones · ${Number(r.new_followers||0)} seguidores<br>${esc(r.summary||'')}</div></div>`).join(''):'<div class="client-empty">Aún no hay reportes semanales.</div>'}</div>
      <div class="client-card" style="margin-top:12px"><h3>Análisis del equipo</h3><p>Lectura estratégica y próximos pasos.</p><div class="client-list">${analyses.length?analyses.map(a=>`<div class="client-analysis"><b>${esc(a.title)}</b><div class="date">${date(a.published_at)}</div><p>${esc(a.body)}</p></div>`).join(''):'<div class="client-empty">Aún no hay análisis publicados.</div>'}</div></div>`;
  }

  function crmHtml(){
    const rows=portalData?.opportunities||[];
    return `<div class="client-welcome"><div><div class="eyebrow">CRM</div><h1>Oportunidades</h1><p>Consulta el estado comercial de tus oportunidades. Vista solo lectura.</p></div></div>
      <div class="client-table-wrap"><table class="client-table"><thead><tr><th>Oportunidad</th><th>Etapa</th><th>Valor</th><th>Producto</th><th>Ciudad</th><th>Origen</th><th>Actualizado</th></tr></thead><tbody>${rows.length?rows.map(o=>`<tr><td><b>${esc(o.title||'Oportunidad')}</b></td><td>${esc(o.stage||'—')}</td><td>${money(o.value)}</td><td>${esc(o.product||'—')}</td><td>${esc(o.city||'—')}</td><td>${esc(o.source||'—')}</td><td>${date(o.updated_at)}</td></tr>`).join(''):'<tr><td colspan="7">Aún no hay oportunidades.</td></tr>'}</tbody></table></div>`;
  }

  function paymentsHtml(){
    const c=portalData?.client||{},pay=payState();
    const docs=(portalData?.documents||[]).filter(x=>['invoice','receipt'].includes(x.document_type));
    return `<div class="client-welcome"><div><div class="eyebrow">Pagos</div><h1>Estado administrativo</h1><p>Mensualidad, próximo vencimiento y comprobantes.</p></div></div>
      <div class="client-grid"><div class="client-card"><h3>Tu servicio</h3><p>Información del plan vigente.</p>
        <div class="client-payment ${pay.cls}"><span class="client-payment-dot"></span><div><b>${pay.label}</b><span>${money(c.monthly_fee||0)} / mes · próximo pago ${date(c.next_payment_date)}</span></div></div>
        <div class="info-row"><span>Plan</span><span>${esc(c.plan||'—')}</span></div><div class="info-row"><span>Método</span><span>${esc(c.payment_method_label||'No registrado')}</span></div>
      </div><div class="client-card"><h3>Facturas y recibos</h3><p>Documentos administrativos disponibles.</p><div class="client-list">${docs.length?docs.map(d=>docHtml(d)).join(''):'<div class="client-empty">No hay documentos de pago publicados.</div>'}</div></div></div>`;
  }

  function docHtml(d){
    return `<div class="client-doc"><div class="client-doc-icon">▧</div><div class="client-doc-main"><b>${esc(d.name)}</b><span>${esc(d.document_type)} · ${date(d.document_date||d.created_at)}</span></div>${d.url?`<a href="${esc(d.url)}" target="_blank" rel="noopener">Abrir ↗</a>`:''}</div>`;
  }

  function reportsHtml(){
    const docs=(portalData?.documents||[]).filter(x=>!['invoice','receipt'].includes(x.document_type));
    return `<div class="client-welcome"><div><div class="eyebrow">Reportes</div><h1>Informes y entregables</h1><p>Documentos publicados por Segmenta para este workspace.</p></div></div><div class="client-card"><div class="client-list">${docs.length?docs.map(docHtml).join(''):'<div class="client-empty">Aún no hay documentos publicados.</div>'}</div></div>`;
  }

  function renderPage(){
    if(!portalData)return;
    const page=document.getElementById('page-client-'+portalPage);if(!page)return;
    page.innerHTML=portalPage==='summary'?summaryHtml():portalPage==='results'?resultsHtml():portalPage==='crm'?crmHtml():portalPage==='payments'?paymentsHtml():reportsHtml();
  }

  function showClientPage(page){
    portalPage=page;
    document.querySelectorAll('.client-portal-page').forEach(x=>x.classList.add('hidden'));
    const el=document.getElementById('page-client-'+page);if(el)el.classList.remove('hidden');
    renderNav();renderPage();
    const crumb=document.getElementById('crumbTitle');if(crumb)crumb.textContent={summary:'Resumen',results:'Resultados',crm:'CRM',payments:'Pagos',reports:'Reportes'}[page]||page;
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
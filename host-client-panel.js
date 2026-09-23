(() => {
  let hostTab='crm', selectedClientOrg=null;

  const SERVICES=[
    {key:'meta_ads',name:'Meta Ads',group:'Pauta',icon:'M',desc:'Campañas, inversión, leads/ventas y eficiencia.'},
    {key:'google_ads',name:'Google Ads',group:'Pauta',icon:'G',desc:'Search, Performance Max, YouTube y conversiones.'},
    {key:'tiktok_ads',name:'TikTok Ads',group:'Pauta',icon:'T',desc:'Campañas, inversión y conversiones de TikTok.'},
    {key:'organic_strategy',name:'Estrategia Orgánica',group:'Contenido',icon:'O',desc:'Contenido, alcance, interacción y crecimiento orgánico.'},
    {key:'content_recording',name:'Grabación de contenido',group:'Contenido',icon:'●',desc:'Jornadas de grabación y material producido.'},
    {key:'editing',name:'Edición',group:'Contenido',icon:'E',desc:'Edición y entrega de piezas audiovisuales.'},
    {key:'crm',name:'CRM',group:'Operación',icon:'C',desc:'Oportunidades, pipeline y seguimiento comercial.'},
    {key:'tasks',name:'Tareas',group:'Operación',icon:'✓',desc:'Pendientes, responsables, vencimientos y ejecución.'},
    {key:'integrations',name:'Integraciones / Automatización',group:'Operación',icon:'↔',desc:'Flujos, agentes y automatizaciones implementadas.'},
    {key:'web',name:'Página web',group:'Activos',icon:'W',desc:'Sitio web, avances, revisión y publicación.'},
    {key:'landing',name:'Landing Page',group:'Activos',icon:'L',desc:'Landing pages, avances, revisión y publicación.'},
    {key:'reports',name:'Reportes',group:'Cuenta',icon:'R',desc:'Informes, análisis y documentos publicados.'},
    {key:'payments',name:'Pagos',group:'Cuenta',icon:'
  ];

  function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function money(v){try{return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0)}catch(_){return '$'+Number(v||0)}}
  function currentOrg(){return (window.hostData||[]).find(x=>x.id===selectedClientOrg)||null}
  function serviceMap(client){return Object.fromEntries((client?.services||[]).map(x=>[x.service_key,x]))}
  function serviceRow(client,key){
    const map=serviceMap(client),cat=SERVICES.find(x=>x.key===key);
    return map[key]||{service_key:key,service_name:cat?.name||key,active_in_plan:false,client_visible:false,status:'inactive',plan_label:'',notes:'',metadata:{}};
  }
  function statusLabel(v){return ({inactive:'Inactivo',setup:'Setup',active:'Activo',paused:'Pausado',waiting_client:'Esperando cliente',under_construction:'En construcción',review:'En revisión',published:'Publicado',completed:'Completado'})[v]||v||'Inactivo'}
  function statusClass(v){return v==='active'?'good':v==='setup'||v==='waiting_client'?'wait':v==='paused'?'pause':'off'}

  function ensureTabs(){
    const content=document.querySelector('section.content');if(!content)return;
    let tabs=document.getElementById('hostTabs');
    if(!tabs){
      tabs=document.createElement('div');tabs.id='hostTabs';tabs.className='host-tabs';
      tabs.innerHTML=[['crm','CRM interno'],['clients','Clientes'],['users','Usuarios'],['plans','Planes']].map(([id,l])=>`<button class="host-tab ${id==='crm'?'active':''}" data-host-tab="${id}">${l}</button>`).join('');
      const stats=content.querySelector('.stats');content.insertBefore(tabs,stats);
      tabs.querySelectorAll('[data-host-tab]').forEach(b=>b.addEventListener('click',()=>setHostTab(b.dataset.hostTab)));
    }
    if(!document.getElementById('hostClientsPanel')){
      const panels=document.createElement('div');
      panels.innerHTML=`<section id="hostClientsPanel" class="host-tab-panel hidden"></section>
        <section id="hostUsersPanel" class="host-tab-panel hidden"></section>
        <section id="hostPlansPanel" class="host-tab-panel hidden"></section>`;
      content.append(...panels.children);
    }
    ensureModal();
  }

  function setHostTab(tab){
    hostTab=tab;
    document.querySelectorAll('.host-tab').forEach(x=>x.classList.toggle('active',x.dataset.hostTab===tab));
    const stats=document.querySelector('section.content>.stats'),workspace=document.querySelector('section.content>.workspace');
    if(stats)stats.classList.toggle('hidden',tab!=='crm');
    if(workspace)workspace.classList.toggle('hidden',tab!=='crm');
    document.getElementById('hostClientsPanel')?.classList.toggle('hidden',tab!=='clients');
    document.getElementById('hostUsersPanel')?.classList.toggle('hidden',tab!=='users');
    document.getElementById('hostPlansPanel')?.classList.toggle('hidden',tab!=='plans');
    renderPanels();
  }
  window.setHostTab=setHostTab;

  function serviceEditorHtml(){
    return SERVICES.map(s=>`<div class="host-service-edit" data-service-editor="${s.key}">
      <div class="host-service-edit-head"><span class="host-service-icon">${s.icon}</span><div><b>${esc(s.name)}</b><small>${esc(s.group)} · ${esc(s.desc)}</small></div></div>
      <div class="host-service-controls">
        <label class="host-toggle"><input type="checkbox" id="svcPlan_${s.key}"><span>Activo en el plan</span></label>
        <label class="host-toggle"><input type="checkbox" id="svcVisible_${s.key}"><span>Visible al cliente</span></label>
        <select id="svcStatus_${s.key}">
          <option value="inactive">Inactivo</option><option value="setup">Setup</option><option value="active">Activo</option><option value="paused">Pausado</option><option value="waiting_client">Esperando cliente</option><option value="under_construction">En construcción</option><option value="review">En revisión</option><option value="published">Publicado</option><option value="completed">Completado</option>
        </select>
      </div>
      <input id="svcPlanLabel_${s.key}" placeholder="Nombre interno / alcance (opcional)">
      <textarea id="svcNotes_${s.key}" placeholder="Notas del servicio (opcional)"></textarea>
    </div>`).join('');
  }

  function ensureModal(){
    if(document.getElementById('clientPortalModal'))return;
    const modal=document.createElement('div');modal.id='clientPortalModal';modal.className='modal hidden';
    modal.innerHTML=`<form class="card host-modal-wide host-client-config" id="clientPortalForm">
      <div class="host-config-head"><div><h2 id="clientPortalModalTitle">Configurar cliente</h2><p>Define cuenta, servicios contratados y qué ve el cliente.</p></div><button type="button" class="icon-btn" onclick="closeClientPortalModal()">×</button></div>
      <input type="hidden" id="cpOrgId">
      <div class="host-config-scroll">
        <div class="host-subsection first"><h4>Cuenta y facturación</h4>
          <div class="host-portal-form">
            <div class="field"><label>Empresa</label><input id="cpName" required></div>
            <div class="field"><label>Sector</label><input id="cpSector"></div>
            <div class="field"><label>Plan / clasificación</label><select id="cpPlan"><option value="basico">Básico</option><option value="estandar">Estándar</option><option value="premium">Premium</option></select></div>
            <div class="field"><label>Mensualidad COP</label><input id="cpFee" type="number" min="0" step="1000"></div>
            <div class="field"><label>Estado de pago</label><select id="cpPaymentStatus"><option value="current">Al día</option><option value="paid">Pagado</option><option value="due_soon">Próximo a vencer</option><option value="overdue">Pendiente / vencido</option><option value="courtesy">Cortesía</option><option value="tbd">Por definir</option></select></div>
            <div class="field"><label>Próximo pago</label><input id="cpNextPayment" type="date"></div>
            <div class="field"><label>Método / referencia</label><input id="cpPaymentMethod" placeholder="Transferencia, tarjeta..."></div>
            <div class="field"><label>URL tablero externo</label><input id="cpDashboard" placeholder="https://..."></div>
            <div class="field"><label>Contacto</label><input id="cpContactName"></div>
            <div class="field"><label>Correo contacto</label><input id="cpContactEmail" type="email"></div>
          </div>
        </div>
        <div class="host-subsection"><h4>Servicios y accesos</h4><p class="host-help">“Activo en el plan” indica que el cliente lo tiene contratado. “Visible al cliente” controla si aparece como pestaña en su portal.</p>
          <div class="host-service-editor-grid">${serviceEditorHtml()}</div>
        </div>
        <div class="host-subsection" id="clientAccessSection"><h4>Acceso del cliente</h4>
          <div class="host-portal-form">
            <div class="field"><label>Nombre de usuario</label><input id="cpUserName"></div>
            <div class="field"><label>Correo de acceso</label><input id="cpUserEmail" type="email"></div>
            <div class="field"><label>Contraseña inicial</label><input id="cpUserPassword" type="password" minlength="8" placeholder="Mínimo 8 caracteres"></div>
            <div class="field"><label>Estado</label><input id="cpUserState" readonly value="Solo se crea si diligencias correo y contraseña"></div>
          </div>
        </div>
      </div>
      <div class="form-actions host-config-actions"><button type="button" class="btn" onclick="closeClientPortalModal()">Cancelar</button><button class="btn primary" type="submit">Guardar cliente</button></div>
    </form>`;
    document.body.appendChild(modal);
    modal.querySelector('form').addEventListener('submit',saveClientProfile);
  }

  function renderClients(){
    const panel=document.getElementById('hostClientsPanel');if(!panel)return;
    const rows=window.hostData||[];
    if(!selectedClientOrg&&rows[0])selectedClientOrg=rows[0].id;
    const selected=currentOrg();
    panel.innerHTML=`<div class="head"><div><div class="eyebrow">Gestión de cuentas</div><h1>Clientes</h1><p>Qué tiene contratado cada cliente, qué está activo y qué puede consultar en su portal.</p></div><button class="btn primary" onclick="openNewClient()">＋ Nuevo cliente</button></div>
      <div class="host-client-grid">
        <aside class="host-client-list"><div class="host-client-list-head"><span>Clientes (${rows.length})</span></div>
          ${rows.length?rows.map(o=>{
            const active=(o.client?.services||[]).filter(s=>s.active_in_plan).length;
            return `<button class="host-client-item ${o.id===selectedClientOrg?'active':''}" onclick="selectHostClient('${o.id}')"><b>${esc(o.name)}</b><small>${active} servicio(s) · ${Number(o.stats?.tasks||0)} tarea(s) · ${Number(o.stats?.requests||0)} solicitud(es)</small></button>`;
          }).join(''):'<div class="empty">No hay clientes.</div>'}
        </aside>
        <div class="host-client-main">${selected?clientMain(selected):'<div class="host-card">Selecciona un cliente.</div>'}</div>
      </div>`;
  }

  function serviceMetrics(o,s){
    const row=serviceRow(o.client,s.key),m=row.metadata?.metrics||{};
    if(s.key==='crm')return [`${o.stats?.opportunities||0} oportunidades`,`${o.stats?.conversations||0} conversaciones`];
    if(s.key==='tasks')return [`${o.stats?.tasks||0} pendientes`,`${o.stats?.overdue_tasks||0} vencidas`];
    if(s.key==='integrations')return [`${o.stats?.integrations||0} integraciones`,`${o.stats?.channels||0} canales`];
    if(['meta_ads','google_ads','tiktok_ads'].includes(s.key)){
      const out=[];if(m.spend!=null)out.push('Inversión '+money(m.spend));if(m.leads!=null)out.push(m.leads+' leads');if(m.roas!=null)out.push('ROAS '+m.roas);return out.length?out:['Sin métricas conectadas'];
    }
    if(s.key==='organic_strategy'){
      const out=[];if(m.reach!=null)out.push(Number(m.reach).toLocaleString('es-CO')+' alcance');if(m.engagement!=null)out.push(m.engagement+'% interacción');return out.length?out:['Sin métricas conectadas'];
    }
    return row.notes?[row.notes]:['Sin métricas conectadas'];
  }

  function clientMain(o){
    const c=o.client||{},clientUser=(o.memberships||[]).find(m=>m.role==='client'),active=SERVICES.filter(s=>serviceRow(c,s.key).active_in_plan).length,visible=SERVICES.filter(s=>serviceRow(c,s.key).client_visible).length;
    return `<div class="host-card"><h3>${esc(o.name)}</h3><p>${c?'Cuenta configurada':'El workspace existe, pero todavía no tiene perfil de cliente.'}</p>
      <div class="host-profile-grid">
        <div class="host-profile-metric"><span>Servicios activos</span><b>${active}</b></div>
        <div class="host-profile-metric"><span>Visibles al cliente</span><b>${visible}</b></div>
        <div class="host-profile-metric"><span>Pago</span><b>${esc({current:'Al día',paid:'Pagado',due_soon:'Por vencer',overdue:'Pendiente',courtesy:'Cortesía',tbd:'Por definir'}[c.payment_status]||'—')}</b></div>
        <div class="host-profile-metric"><span>Acceso portal</span><b>${clientUser?'Activo':'Sin usuario'}</b></div>
      </div>
      <div class="host-ops-strip">
        <span><b>${Number(o.stats?.tasks||0)}</b> tareas pendientes</span>
        <span><b>${Number(o.stats?.overdue_tasks||0)}</b> vencidas</span>
        <span><b>${Number(o.stats?.requests||0)}</b> solicitudes nuevas</span>
        <span><b>${c.next_payment_date?esc(c.next_payment_date):'—'}</b> próximo pago</span>
      </div>
      <div class="host-card-actions">
        <button class="btn" onclick="openClientConfig('${o.id}')">Configurar cliente</button>
        <button class="btn" onclick="previewClient('${esc(o.slug)}')">Vista cliente</button>
        <button class="btn primary" onclick="enterOrg('${esc(o.slug)}')">Abrir CRM interno</button>
      </div>
    </div>
    <div class="host-card"><div class="host-card-title-row"><div><h3>Servicios del cliente</h3><p>Contrato, visibilidad y estado operativo por servicio.</p></div><button class="btn" onclick="openClientConfig('${o.id}')">Editar servicios</button></div>
      <div class="host-service-grid">${SERVICES.map(s=>serviceCard(o,s)).join('')}</div>
    </div>
    <div class="host-card"><h3>Contenido y documentos</h3><p>Publica análisis, informes y facturas visibles para el cliente.</p>
      <div class="host-card-actions">
        <button class="btn" onclick="publishClientAnalysis('${o.id}')">＋ Publicar análisis</button>
        <button class="btn" onclick="addClientDocument('${o.id}','report')">＋ Agregar informe</button>
        <button class="btn" onclick="addClientDocument('${o.id}','invoice')">＋ Agregar factura</button>
      </div>
    </div>`;
  }

  function serviceCard(o,s){
    const row=serviceRow(o.client,s.key),metrics=serviceMetrics(o,s);
    return `<article class="host-service-card ${row.active_in_plan?'active':'inactive'}">
      <div class="host-service-top"><span class="host-service-icon">${s.icon}</span><div><b>${esc(s.name)}</b><small>${esc(s.group)}</small></div><span class="host-status ${statusClass(row.status)}">${esc(statusLabel(row.status))}</span></div>
      <p>${esc(s.desc)}</p>
      <div class="host-service-flags"><span class="${row.active_in_plan?'on':'off'}">${row.active_in_plan?'✓ Activo en plan':'○ No contratado'}</span><span class="${row.client_visible?'on':'off'}">${row.client_visible?'✓ Visible':'○ Oculto'}</span></div>
      <div class="host-service-metrics">${metrics.slice(0,3).map(x=>`<span>${esc(x)}</span>`).join('')}</div>
    </article>`;
  }

  window.selectHostClient=function(id){selectedClientOrg=id;renderClients()};

  function renderUsers(){
    const panel=document.getElementById('hostUsersPanel');if(!panel)return;
    const memberships=(window.hostData||[]).flatMap(o=>(o.memberships||[]).map(m=>({...m,org_name:o.name})));
    panel.innerHTML=`<div class="head"><div><div class="eyebrow">Accesos</div><h1>Usuarios</h1><p>Usuarios de todos los workspaces y su rol actual.</p></div></div>
      <div class="workspace"><div class="table-wrap"><table class="host-users-table"><thead><tr><th>Usuario</th><th>Empresa</th><th>Rol</th><th>Estado</th></tr></thead><tbody>
      ${memberships.length?memberships.map(m=>`<tr><td><b>${esc(m.display_name||m.email)}</b><div class="owner">${esc(m.email)}</div></td><td>${esc(m.org_name)}</td><td><span class="host-role ${m.role==='client'?'client':''}">${esc(m.role)}</span></td><td>${esc(m.status)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">Sin usuarios.</td></tr>'}
      </tbody></table></div></div>`;
  }

  function renderPlans(){
    const panel=document.getElementById('hostPlansPanel');if(!panel)return;
    const all=(window.hostData||[]).map(x=>x.client).filter(Boolean);
    const plans=[['basico','Básico'],['estandar','Estándar'],['premium','Premium']];
    panel.innerHTML=`<div class="head"><div><div class="eyebrow">Clasificación</div><h1>Planes</h1><p>No cambia precios automáticamente; solo clasifica cuentas. Los servicios se activan cliente por cliente.</p></div></div>
      <div class="host-plan-grid">${plans.map(([id,l])=>`<div class="host-plan"><h3>${l}</h3><div class="used">${all.filter(c=>c.plan===id).length} cliente(s)</div></div>`).join('')}</div>`;
  }

  function renderPanels(){if(hostTab==='clients')renderClients();if(hostTab==='users')renderUsers();if(hostTab==='plans')renderPlans()}

  function fillModal(o,newMode=false){
    const c=o?.client||{};
    document.getElementById('cpOrgId').value=o?.id||'';
    document.getElementById('cpName').value=o?.name||'';
    document.getElementById('cpSector').value=c.sector||'';
    document.getElementById('cpPlan').value=c.plan||'estandar';
    document.getElementById('cpFee').value=c.monthly_fee||0;
    document.getElementById('cpPaymentStatus').value=c.payment_status||'current';
    document.getElementById('cpNextPayment').value=c.next_payment_date||'';
    document.getElementById('cpPaymentMethod').value=c.payment_method_label||'';
    document.getElementById('cpDashboard').value=c.dashboard_url||'';
    document.getElementById('cpContactName').value=c.contact_name||'';
    document.getElementById('cpContactEmail').value=c.contact_email||'';
    for(const s of SERVICES){
      const row=serviceRow(c,s.key);
      document.getElementById('svcPlan_'+s.key).checked=!!row.active_in_plan;
      document.getElementById('svcVisible_'+s.key).checked=!!row.client_visible;
      document.getElementById('svcStatus_'+s.key).value=row.status||'inactive';
      document.getElementById('svcPlanLabel_'+s.key).value=row.plan_label||'';
      document.getElementById('svcNotes_'+s.key).value=row.notes||'';
    }
    document.getElementById('cpUserName').value='';
    document.getElementById('cpUserEmail').value='';
    document.getElementById('cpUserPassword').value='';
    document.getElementById('clientPortalModalTitle').textContent=newMode?'Nuevo cliente':'Configurar '+(o?.name||'cliente');
    document.getElementById('clientPortalModal').classList.remove('hidden');
  }

  window.openNewClient=function(){fillModal(null,true)};
  window.openClientConfig=function(id){const o=(window.hostData||[]).find(x=>x.id===id);if(o)fillModal(o,false)};
  window.closeClientPortalModal=function(){document.getElementById('clientPortalModal').classList.add('hidden')};

  async function req(url,body){
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||'No fue posible guardar');return j;
  }

  function servicePayload(){
    return SERVICES.map(s=>({
      service_key:s.key,
      active_in_plan:document.getElementById('svcPlan_'+s.key).checked,
      client_visible:document.getElementById('svcVisible_'+s.key).checked,
      status:document.getElementById('svcStatus_'+s.key).value,
      plan_label:document.getElementById('svcPlanLabel_'+s.key).value.trim(),
      notes:document.getElementById('svcNotes_'+s.key).value.trim()
    }));
  }

  async function saveClientProfile(e){
    e.preventDefault();
    try{
      let orgId=document.getElementById('cpOrgId').value;
      if(!orgId){
        const created=await req('/api/crm-admin',{action:'create_org',name:document.getElementById('cpName').value.trim()});
        orgId=created.organization.id;document.getElementById('cpOrgId').value=orgId;
      }
      const profile=await req('/api/client-portal',{
        action:'upsert_profile',organization_id:orgId,name:document.getElementById('cpName').value.trim(),sector:document.getElementById('cpSector').value.trim(),
        plan:document.getElementById('cpPlan').value,monthly_fee:document.getElementById('cpFee').value,payment_status:document.getElementById('cpPaymentStatus').value,
        next_payment_date:document.getElementById('cpNextPayment').value||null,payment_method_label:document.getElementById('cpPaymentMethod').value.trim(),
        dashboard_url:document.getElementById('cpDashboard').value.trim(),contact_name:document.getElementById('cpContactName').value.trim(),contact_email:document.getElementById('cpContactEmail').value.trim(),
        portal_settings:{}
      });
      if(profile.client?.id)await req('/api/client-portal',{action:'save_services',client_id:profile.client.id,services:servicePayload()});
      const email=document.getElementById('cpUserEmail').value.trim(),password=document.getElementById('cpUserPassword').value;
      if(email||password){
        if(!email||password.length<8)throw new Error('Para crear acceso, completa correo y contraseña de mínimo 8 caracteres');
        await req('/api/crm-admin',{action:'create_user',organization_id:orgId,display_name:document.getElementById('cpUserName').value.trim()||document.getElementById('cpContactName').value.trim(),email,password,role:'client',permissions:{}});
      }
      closeClientPortalModal();await window.loadHost();selectedClientOrg=orgId;setHostTab('clients');
    }catch(err){alert(err.message)}
  }

  window.publishClientAnalysis=async function(orgId){
    const o=(window.hostData||[]).find(x=>x.id===orgId),client=o?.client;
    if(!client?.id){alert('Configura primero el perfil del cliente.');return}
    const title=prompt('Título del análisis:','Resultados y próximos pasos');if(title===null||!title.trim())return;
    const body=prompt('Escribe el análisis para el cliente:','');if(body===null||!body.trim())return;
    try{await req('/api/client-portal',{action:'publish_analysis',client_id:client.id,title:title.trim(),body:body.trim()});alert('Análisis publicado.')}catch(err){alert(err.message)}
  };

  window.addClientDocument=async function(orgId,type){
    const o=(window.hostData||[]).find(x=>x.id===orgId),client=o?.client;
    if(!client?.id){alert('Configura primero el perfil del cliente.');return}
    const name=prompt(type==='invoice'?'Nombre de la factura:':'Nombre del informe:','');if(name===null||!name.trim())return;
    const url=prompt('URL del documento (opcional):','');if(url===null)return;
    try{await req('/api/client-portal',{action:'add_document',client_id:client.id,document_type:type,name:name.trim(),document_date:new Date().toISOString().slice(0,10),url:url.trim()});alert('Documento publicado.')}catch(err){alert(err.message)}
  };

  window.previewClient=async function(slug){
    const j=await req('/api/crm-host',{action:'preview_client',org_slug:slug});location.href=j.crm_url;
  };

  window.renderHostClientPanels=function(){ensureTabs();renderPanels()};
  const oldLoad=window.loadHost;
  if(oldLoad)window.loadHost=async function(...args){const out=await oldLoad.apply(this,args);ensureTabs();renderPanels();return out};

  function init(){
    ensureTabs();
    const btn=document.querySelector('.head .btn.primary');if(btn){btn.textContent='＋ Nuevo cliente';btn.onclick=()=>{setHostTab('clients');openNewClient()}}
    renderPanels();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();,desc:'Mensualidad, vencimientos, facturas y recibos.'}
  ];

  function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function money(v){try{return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0)}catch(_){return '$'+Number(v||0)}}
  function currentOrg(){return (window.hostData||[]).find(x=>x.id===selectedClientOrg)||null}
  function serviceMap(client){return Object.fromEntries((client?.services||[]).map(x=>[x.service_key,x]))}
  function serviceRow(client,key){
    const map=serviceMap(client),cat=SERVICES.find(x=>x.key===key);
    return map[key]||{service_key:key,service_name:cat?.name||key,active_in_plan:false,client_visible:false,status:'inactive',plan_label:'',notes:'',metadata:{}};
  }
  function statusLabel(v){return ({inactive:'Inactivo',setup:'Setup',active:'Activo',paused:'Pausado',waiting_client:'Esperando cliente'})[v]||v||'Inactivo'}
  function statusClass(v){return v==='active'?'good':v==='setup'||v==='waiting_client'?'wait':v==='paused'?'pause':'off'}

  function ensureTabs(){
    const content=document.querySelector('section.content');if(!content)return;
    let tabs=document.getElementById('hostTabs');
    if(!tabs){
      tabs=document.createElement('div');tabs.id='hostTabs';tabs.className='host-tabs';
      tabs.innerHTML=[['crm','CRM interno'],['clients','Clientes'],['users','Usuarios'],['plans','Planes']].map(([id,l])=>`<button class="host-tab ${id==='crm'?'active':''}" data-host-tab="${id}">${l}</button>`).join('');
      const stats=content.querySelector('.stats');content.insertBefore(tabs,stats);
      tabs.querySelectorAll('[data-host-tab]').forEach(b=>b.addEventListener('click',()=>setHostTab(b.dataset.hostTab)));
    }
    if(!document.getElementById('hostClientsPanel')){
      const panels=document.createElement('div');
      panels.innerHTML=`<section id="hostClientsPanel" class="host-tab-panel hidden"></section>
        <section id="hostUsersPanel" class="host-tab-panel hidden"></section>
        <section id="hostPlansPanel" class="host-tab-panel hidden"></section>`;
      content.append(...panels.children);
    }
    ensureModal();
  }

  function setHostTab(tab){
    hostTab=tab;
    document.querySelectorAll('.host-tab').forEach(x=>x.classList.toggle('active',x.dataset.hostTab===tab));
    const stats=document.querySelector('section.content>.stats'),workspace=document.querySelector('section.content>.workspace');
    if(stats)stats.classList.toggle('hidden',tab!=='crm');
    if(workspace)workspace.classList.toggle('hidden',tab!=='crm');
    document.getElementById('hostClientsPanel')?.classList.toggle('hidden',tab!=='clients');
    document.getElementById('hostUsersPanel')?.classList.toggle('hidden',tab!=='users');
    document.getElementById('hostPlansPanel')?.classList.toggle('hidden',tab!=='plans');
    renderPanels();
  }
  window.setHostTab=setHostTab;

  function serviceEditorHtml(){
    return SERVICES.map(s=>`<div class="host-service-edit" data-service-editor="${s.key}">
      <div class="host-service-edit-head"><span class="host-service-icon">${s.icon}</span><div><b>${esc(s.name)}</b><small>${esc(s.group)} · ${esc(s.desc)}</small></div></div>
      <div class="host-service-controls">
        <label class="host-toggle"><input type="checkbox" id="svcPlan_${s.key}"><span>Activo en el plan</span></label>
        <label class="host-toggle"><input type="checkbox" id="svcVisible_${s.key}"><span>Visible al cliente</span></label>
        <select id="svcStatus_${s.key}">
          <option value="inactive">Inactivo</option><option value="setup">Setup</option><option value="active">Activo</option><option value="paused">Pausado</option><option value="waiting_client">Esperando cliente</option>
        </select>
      </div>
      <input id="svcPlanLabel_${s.key}" placeholder="Nombre interno / alcance (opcional)">
      <textarea id="svcNotes_${s.key}" placeholder="Notas del servicio (opcional)"></textarea>
    </div>`).join('');
  }

  function ensureModal(){
    if(document.getElementById('clientPortalModal'))return;
    const modal=document.createElement('div');modal.id='clientPortalModal';modal.className='modal hidden';
    modal.innerHTML=`<form class="card host-modal-wide host-client-config" id="clientPortalForm">
      <div class="host-config-head"><div><h2 id="clientPortalModalTitle">Configurar cliente</h2><p>Define cuenta, servicios contratados y qué ve el cliente.</p></div><button type="button" class="icon-btn" onclick="closeClientPortalModal()">×</button></div>
      <input type="hidden" id="cpOrgId">
      <div class="host-config-scroll">
        <div class="host-subsection first"><h4>Cuenta y facturación</h4>
          <div class="host-portal-form">
            <div class="field"><label>Empresa</label><input id="cpName" required></div>
            <div class="field"><label>Sector</label><input id="cpSector"></div>
            <div class="field"><label>Plan / clasificación</label><select id="cpPlan"><option value="basico">Básico</option><option value="estandar">Estándar</option><option value="premium">Premium</option></select></div>
            <div class="field"><label>Mensualidad COP</label><input id="cpFee" type="number" min="0" step="1000"></div>
            <div class="field"><label>Estado de pago</label><select id="cpPaymentStatus"><option value="current">Al día</option><option value="due_soon">Próximo a vencer</option><option value="overdue">Pendiente</option></select></div>
            <div class="field"><label>Próximo pago</label><input id="cpNextPayment" type="date"></div>
            <div class="field"><label>Método / referencia</label><input id="cpPaymentMethod" placeholder="Transferencia, tarjeta..."></div>
            <div class="field"><label>URL tablero externo</label><input id="cpDashboard" placeholder="https://..."></div>
            <div class="field"><label>Contacto</label><input id="cpContactName"></div>
            <div class="field"><label>Correo contacto</label><input id="cpContactEmail" type="email"></div>
          </div>
        </div>
        <div class="host-subsection"><h4>Servicios y accesos</h4><p class="host-help">“Activo en el plan” indica que el cliente lo tiene contratado. “Visible al cliente” controla si aparece como pestaña en su portal.</p>
          <div class="host-service-editor-grid">${serviceEditorHtml()}</div>
        </div>
        <div class="host-subsection" id="clientAccessSection"><h4>Acceso del cliente</h4>
          <div class="host-portal-form">
            <div class="field"><label>Nombre de usuario</label><input id="cpUserName"></div>
            <div class="field"><label>Correo de acceso</label><input id="cpUserEmail" type="email"></div>
            <div class="field"><label>Contraseña inicial</label><input id="cpUserPassword" type="password" minlength="8" placeholder="Mínimo 8 caracteres"></div>
            <div class="field"><label>Estado</label><input id="cpUserState" readonly value="Solo se crea si diligencias correo y contraseña"></div>
          </div>
        </div>
      </div>
      <div class="form-actions host-config-actions"><button type="button" class="btn" onclick="closeClientPortalModal()">Cancelar</button><button class="btn primary" type="submit">Guardar cliente</button></div>
    </form>`;
    document.body.appendChild(modal);
    modal.querySelector('form').addEventListener('submit',saveClientProfile);
  }

  function renderClients(){
    const panel=document.getElementById('hostClientsPanel');if(!panel)return;
    const rows=window.hostData||[];
    if(!selectedClientOrg&&rows[0])selectedClientOrg=rows[0].id;
    const selected=currentOrg();
    panel.innerHTML=`<div class="head"><div><div class="eyebrow">Gestión de cuentas</div><h1>Clientes</h1><p>Qué tiene contratado cada cliente, qué está activo y qué puede consultar en su portal.</p></div><button class="btn primary" onclick="openNewClient()">＋ Nuevo cliente</button></div>
      <div class="host-client-grid">
        <aside class="host-client-list"><div class="host-client-list-head"><span>Clientes (${rows.length})</span></div>
          ${rows.length?rows.map(o=>{
            const active=(o.client?.services||[]).filter(s=>s.active_in_plan).length;
            return `<button class="host-client-item ${o.id===selectedClientOrg?'active':''}" onclick="selectHostClient('${o.id}')"><b>${esc(o.name)}</b><small>${active} servicio(s) · ${o.client?money(o.client.monthly_fee):'Sin configurar'}</small></button>`;
          }).join(''):'<div class="empty">No hay clientes.</div>'}
        </aside>
        <div class="host-client-main">${selected?clientMain(selected):'<div class="host-card">Selecciona un cliente.</div>'}</div>
      </div>`;
  }

  function serviceMetrics(o,s){
    const row=serviceRow(o.client,s.key),m=row.metadata?.metrics||{};
    if(s.key==='crm')return [`${o.stats?.opportunities||0} oportunidades`,`${o.stats?.conversations||0} conversaciones`];
    if(s.key==='tasks')return [`${o.stats?.tasks||0} pendientes`,`${o.stats?.overdue_tasks||0} vencidas`];
    if(s.key==='integrations')return [`${o.stats?.integrations||0} integraciones`,`${o.stats?.channels||0} canales`];
    if(['meta_ads','google_ads','tiktok_ads'].includes(s.key)){
      const out=[];if(m.spend!=null)out.push('Inversión '+money(m.spend));if(m.leads!=null)out.push(m.leads+' leads');if(m.roas!=null)out.push('ROAS '+m.roas);return out.length?out:['Sin métricas conectadas'];
    }
    if(s.key==='organic_strategy'){
      const out=[];if(m.reach!=null)out.push(Number(m.reach).toLocaleString('es-CO')+' alcance');if(m.engagement!=null)out.push(m.engagement+'% interacción');return out.length?out:['Sin métricas conectadas'];
    }
    return row.notes?[row.notes]:['Sin métricas conectadas'];
  }

  function clientMain(o){
    const c=o.client||{},clientUser=(o.memberships||[]).find(m=>m.role==='client'),active=SERVICES.filter(s=>serviceRow(c,s.key).active_in_plan).length,visible=SERVICES.filter(s=>serviceRow(c,s.key).client_visible).length;
    return `<div class="host-card"><h3>${esc(o.name)}</h3><p>${c?'Cuenta configurada':'El workspace existe, pero todavía no tiene perfil de cliente.'}</p>
      <div class="host-profile-grid">
        <div class="host-profile-metric"><span>Servicios activos</span><b>${active}</b></div>
        <div class="host-profile-metric"><span>Visibles al cliente</span><b>${visible}</b></div>
        <div class="host-profile-metric"><span>Pago</span><b>${esc({current:'Al día',due_soon:'Por vencer',overdue:'Pendiente'}[c.payment_status]||'—')}</b></div>
        <div class="host-profile-metric"><span>Acceso portal</span><b>${clientUser?'Activo':'Sin usuario'}</b></div>
      </div>
      <div class="host-card-actions">
        <button class="btn" onclick="openClientConfig('${o.id}')">Configurar cliente</button>
        <button class="btn" onclick="previewClient('${esc(o.slug)}')">Vista cliente</button>
        <button class="btn primary" onclick="enterOrg('${esc(o.slug)}')">Abrir CRM interno</button>
      </div>
    </div>
    <div class="host-card"><div class="host-card-title-row"><div><h3>Servicios del cliente</h3><p>Contrato, visibilidad y estado operativo por servicio.</p></div><button class="btn" onclick="openClientConfig('${o.id}')">Editar servicios</button></div>
      <div class="host-service-grid">${SERVICES.map(s=>serviceCard(o,s)).join('')}</div>
    </div>
    <div class="host-card"><h3>Contenido y documentos</h3><p>Publica análisis, informes y facturas visibles para el cliente.</p>
      <div class="host-card-actions">
        <button class="btn" onclick="publishClientAnalysis('${o.id}')">＋ Publicar análisis</button>
        <button class="btn" onclick="addClientDocument('${o.id}','report')">＋ Agregar informe</button>
        <button class="btn" onclick="addClientDocument('${o.id}','invoice')">＋ Agregar factura</button>
      </div>
    </div>`;
  }

  function serviceCard(o,s){
    const row=serviceRow(o.client,s.key),metrics=serviceMetrics(o,s);
    return `<article class="host-service-card ${row.active_in_plan?'active':'inactive'}">
      <div class="host-service-top"><span class="host-service-icon">${s.icon}</span><div><b>${esc(s.name)}</b><small>${esc(s.group)}</small></div><span class="host-status ${statusClass(row.status)}">${esc(statusLabel(row.status))}</span></div>
      <p>${esc(s.desc)}</p>
      <div class="host-service-flags"><span class="${row.active_in_plan?'on':'off'}">${row.active_in_plan?'✓ Activo en plan':'○ No contratado'}</span><span class="${row.client_visible?'on':'off'}">${row.client_visible?'✓ Visible':'○ Oculto'}</span></div>
      <div class="host-service-metrics">${metrics.slice(0,3).map(x=>`<span>${esc(x)}</span>`).join('')}</div>
    </article>`;
  }

  window.selectHostClient=function(id){selectedClientOrg=id;renderClients()};

  function renderUsers(){
    const panel=document.getElementById('hostUsersPanel');if(!panel)return;
    const memberships=(window.hostData||[]).flatMap(o=>(o.memberships||[]).map(m=>({...m,org_name:o.name})));
    panel.innerHTML=`<div class="head"><div><div class="eyebrow">Accesos</div><h1>Usuarios</h1><p>Usuarios de todos los workspaces y su rol actual.</p></div></div>
      <div class="workspace"><div class="table-wrap"><table class="host-users-table"><thead><tr><th>Usuario</th><th>Empresa</th><th>Rol</th><th>Estado</th></tr></thead><tbody>
      ${memberships.length?memberships.map(m=>`<tr><td><b>${esc(m.display_name||m.email)}</b><div class="owner">${esc(m.email)}</div></td><td>${esc(m.org_name)}</td><td><span class="host-role ${m.role==='client'?'client':''}">${esc(m.role)}</span></td><td>${esc(m.status)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">Sin usuarios.</td></tr>'}
      </tbody></table></div></div>`;
  }

  function renderPlans(){
    const panel=document.getElementById('hostPlansPanel');if(!panel)return;
    const all=(window.hostData||[]).map(x=>x.client).filter(Boolean);
    const plans=[['basico','Básico'],['estandar','Estándar'],['premium','Premium']];
    panel.innerHTML=`<div class="head"><div><div class="eyebrow">Clasificación</div><h1>Planes</h1><p>No cambia precios automáticamente; solo clasifica cuentas. Los servicios se activan cliente por cliente.</p></div></div>
      <div class="host-plan-grid">${plans.map(([id,l])=>`<div class="host-plan"><h3>${l}</h3><div class="used">${all.filter(c=>c.plan===id).length} cliente(s)</div></div>`).join('')}</div>`;
  }

  function renderPanels(){if(hostTab==='clients')renderClients();if(hostTab==='users')renderUsers();if(hostTab==='plans')renderPlans()}

  function fillModal(o,newMode=false){
    const c=o?.client||{};
    document.getElementById('cpOrgId').value=o?.id||'';
    document.getElementById('cpName').value=o?.name||'';
    document.getElementById('cpSector').value=c.sector||'';
    document.getElementById('cpPlan').value=c.plan||'estandar';
    document.getElementById('cpFee').value=c.monthly_fee||0;
    document.getElementById('cpPaymentStatus').value=c.payment_status||'current';
    document.getElementById('cpNextPayment').value=c.next_payment_date||'';
    document.getElementById('cpPaymentMethod').value=c.payment_method_label||'';
    document.getElementById('cpDashboard').value=c.dashboard_url||'';
    document.getElementById('cpContactName').value=c.contact_name||'';
    document.getElementById('cpContactEmail').value=c.contact_email||'';
    for(const s of SERVICES){
      const row=serviceRow(c,s.key);
      document.getElementById('svcPlan_'+s.key).checked=!!row.active_in_plan;
      document.getElementById('svcVisible_'+s.key).checked=!!row.client_visible;
      document.getElementById('svcStatus_'+s.key).value=row.status||'inactive';
      document.getElementById('svcPlanLabel_'+s.key).value=row.plan_label||'';
      document.getElementById('svcNotes_'+s.key).value=row.notes||'';
    }
    document.getElementById('cpUserName').value='';
    document.getElementById('cpUserEmail').value='';
    document.getElementById('cpUserPassword').value='';
    document.getElementById('clientPortalModalTitle').textContent=newMode?'Nuevo cliente':'Configurar '+(o?.name||'cliente');
    document.getElementById('clientPortalModal').classList.remove('hidden');
  }

  window.openNewClient=function(){fillModal(null,true)};
  window.openClientConfig=function(id){const o=(window.hostData||[]).find(x=>x.id===id);if(o)fillModal(o,false)};
  window.closeClientPortalModal=function(){document.getElementById('clientPortalModal').classList.add('hidden')};

  async function req(url,body){
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||'No fue posible guardar');return j;
  }

  function servicePayload(){
    return SERVICES.map(s=>({
      service_key:s.key,
      active_in_plan:document.getElementById('svcPlan_'+s.key).checked,
      client_visible:document.getElementById('svcVisible_'+s.key).checked,
      status:document.getElementById('svcStatus_'+s.key).value,
      plan_label:document.getElementById('svcPlanLabel_'+s.key).value.trim(),
      notes:document.getElementById('svcNotes_'+s.key).value.trim()
    }));
  }

  async function saveClientProfile(e){
    e.preventDefault();
    try{
      let orgId=document.getElementById('cpOrgId').value;
      if(!orgId){
        const created=await req('/api/crm-admin',{action:'create_org',name:document.getElementById('cpName').value.trim()});
        orgId=created.organization.id;document.getElementById('cpOrgId').value=orgId;
      }
      const profile=await req('/api/client-portal',{
        action:'upsert_profile',organization_id:orgId,name:document.getElementById('cpName').value.trim(),sector:document.getElementById('cpSector').value.trim(),
        plan:document.getElementById('cpPlan').value,monthly_fee:document.getElementById('cpFee').value,payment_status:document.getElementById('cpPaymentStatus').value,
        next_payment_date:document.getElementById('cpNextPayment').value||null,payment_method_label:document.getElementById('cpPaymentMethod').value.trim(),
        dashboard_url:document.getElementById('cpDashboard').value.trim(),contact_name:document.getElementById('cpContactName').value.trim(),contact_email:document.getElementById('cpContactEmail').value.trim(),
        portal_settings:{}
      });
      if(profile.client?.id)await req('/api/client-portal',{action:'save_services',client_id:profile.client.id,services:servicePayload()});
      const email=document.getElementById('cpUserEmail').value.trim(),password=document.getElementById('cpUserPassword').value;
      if(email||password){
        if(!email||password.length<8)throw new Error('Para crear acceso, completa correo y contraseña de mínimo 8 caracteres');
        await req('/api/crm-admin',{action:'create_user',organization_id:orgId,display_name:document.getElementById('cpUserName').value.trim()||document.getElementById('cpContactName').value.trim(),email,password,role:'client',permissions:{}});
      }
      closeClientPortalModal();await window.loadHost();selectedClientOrg=orgId;setHostTab('clients');
    }catch(err){alert(err.message)}
  }

  window.publishClientAnalysis=async function(orgId){
    const o=(window.hostData||[]).find(x=>x.id===orgId),client=o?.client;
    if(!client?.id){alert('Configura primero el perfil del cliente.');return}
    const title=prompt('Título del análisis:','Resultados y próximos pasos');if(title===null||!title.trim())return;
    const body=prompt('Escribe el análisis para el cliente:','');if(body===null||!body.trim())return;
    try{await req('/api/client-portal',{action:'publish_analysis',client_id:client.id,title:title.trim(),body:body.trim()});alert('Análisis publicado.')}catch(err){alert(err.message)}
  };

  window.addClientDocument=async function(orgId,type){
    const o=(window.hostData||[]).find(x=>x.id===orgId),client=o?.client;
    if(!client?.id){alert('Configura primero el perfil del cliente.');return}
    const name=prompt(type==='invoice'?'Nombre de la factura:':'Nombre del informe:','');if(name===null||!name.trim())return;
    const url=prompt('URL del documento (opcional):','');if(url===null)return;
    try{await req('/api/client-portal',{action:'add_document',client_id:client.id,document_type:type,name:name.trim(),document_date:new Date().toISOString().slice(0,10),url:url.trim()});alert('Documento publicado.')}catch(err){alert(err.message)}
  };

  window.previewClient=async function(slug){
    const j=await req('/api/crm-host',{action:'preview_client',org_slug:slug});location.href=j.crm_url;
  };

  window.renderHostClientPanels=function(){ensureTabs();renderPanels()};
  const oldLoad=window.loadHost;
  if(oldLoad)window.loadHost=async function(...args){const out=await oldLoad.apply(this,args);ensureTabs();renderPanels();return out};

  function init(){
    ensureTabs();
    const btn=document.querySelector('.head .btn.primary');if(btn){btn.textContent='＋ Nuevo cliente';btn.onclick=()=>{setHostTab('clients');openNewClient()}}
    renderPanels();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
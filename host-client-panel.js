(() => {
  let hostTab='crm', selectedClientOrg=null;

  function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function money(v){try{return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0)}catch(_){return '$'+Number(v||0)}}
  function currentOrg(){return (window.hostData||[]).find(x=>x.id===selectedClientOrg)||null}

  function ensureTabs(){
    const content=document.querySelector('section.content');if(!content)return;
    let tabs=document.getElementById('hostTabs');
    if(!tabs){
      tabs=document.createElement('div');tabs.id='hostTabs';tabs.className='host-tabs';
      tabs.innerHTML=[
        ['crm','CRM'],['clients','Clientes'],['users','Usuarios'],['plans','Planes']
      ].map(([id,l])=>`<button class="host-tab ${id==='crm'?'active':''}" data-host-tab="${id}">${l}</button>`).join('');
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

  function ensureModal(){
    if(document.getElementById('clientPortalModal'))return;
    const modal=document.createElement('div');modal.id='clientPortalModal';modal.className='modal hidden';
    modal.innerHTML=`<form class="card host-modal-wide" id="clientPortalForm">
      <h2 id="clientPortalModalTitle">Configurar cliente</h2>
      <p>Define el acceso del cliente, plan, pago y módulos visibles.</p>
      <input type="hidden" id="cpOrgId">
      <div class="host-portal-form">
        <div class="field"><label>Empresa</label><input id="cpName" required></div>
        <div class="field"><label>Sector</label><input id="cpSector"></div>
        <div class="field"><label>Plan</label><select id="cpPlan"><option value="basico">Básico</option><option value="estandar">Estándar</option><option value="premium">Premium</option></select></div>
        <div class="field"><label>Mensualidad COP</label><input id="cpFee" type="number" min="0" step="1000"></div>
        <div class="field"><label>Estado de pago</label><select id="cpPaymentStatus"><option value="current">Al día</option><option value="due_soon">Próximo a vencer</option><option value="overdue">Pendiente</option></select></div>
        <div class="field"><label>Próximo pago</label><input id="cpNextPayment" type="date"></div>
        <div class="field"><label>Método / referencia</label><input id="cpPaymentMethod" placeholder="Transferencia, tarjeta..."></div>
        <div class="field"><label>URL tablero externo</label><input id="cpDashboard" placeholder="https://..."></div>
        <div class="field"><label>Contacto</label><input id="cpContactName"></div>
        <div class="field"><label>Correo contacto</label><input id="cpContactEmail" type="email"></div>
        <div class="field full"><label>Módulos visibles</label><div class="host-checks">
          <label><input id="cpResults" type="checkbox" checked> Resultados</label>
          <label><input id="cpCrm" type="checkbox" checked> CRM</label>
          <label><input id="cpPayments" type="checkbox" checked> Pagos</label>
          <label><input id="cpReports" type="checkbox" checked> Reportes</label>
        </div></div>
      </div>
      <div class="host-subsection" id="clientAccessSection">
        <h4>Acceso del cliente</h4>
        <div class="host-portal-form">
          <div class="field"><label>Nombre de usuario</label><input id="cpUserName"></div>
          <div class="field"><label>Correo de acceso</label><input id="cpUserEmail" type="email"></div>
          <div class="field"><label>Contraseña inicial</label><input id="cpUserPassword" type="password" minlength="8" placeholder="Mínimo 8 caracteres"></div>
          <div class="field"><label>Estado</label><input id="cpUserState" readonly value="Se crea solo si diligencias correo y contraseña"></div>
        </div>
      </div>
      <div class="form-actions"><button type="button" class="btn" onclick="closeClientPortalModal()">Cancelar</button><button class="btn primary" type="submit">Guardar cliente</button></div>
    </form>`;
    document.body.appendChild(modal);
    modal.querySelector('form').addEventListener('submit',saveClientProfile);
  }

  function renderClients(){
    const panel=document.getElementById('hostClientsPanel');if(!panel)return;
    const rows=window.hostData||[];
    if(!selectedClientOrg&&rows[0])selectedClientOrg=rows[0].id;
    const selected=currentOrg();
    panel.innerHTML=`<div class="head"><div><div class="eyebrow">Gestión comercial</div><h1>Clientes</h1><p>Administra portal, pagos, resultados y acceso al CRM de cada cliente.</p></div><button class="btn primary" onclick="openNewClient()">＋ Nuevo cliente</button></div>
      <div class="host-client-grid">
        <aside class="host-client-list"><div class="host-client-list-head"><span>Clientes (${rows.length})</span></div>
          ${rows.length?rows.map(o=>`<button class="host-client-item ${o.id===selectedClientOrg?'active':''}" onclick="selectHostClient('${o.id}')"><b>${esc(o.name)}</b><small>${esc(o.client?.plan||'Sin portal configurado')} · ${o.client?money(o.client.monthly_fee):'—'}</small></button>`).join(''):'<div class="empty">No hay clientes.</div>'}
        </aside>
        <div class="host-client-main">${selected?clientMain(selected):'<div class="host-card">Selecciona un cliente.</div>'}</div>
      </div>`;
  }

  function clientMain(o){
    const c=o.client||{},clientUser=(o.memberships||[]).find(m=>m.role==='client');
    return `<div class="host-card"><h3>${esc(o.name)}</h3><p>${c?'Portal configurado':'El workspace existe, pero todavía no tiene perfil de cliente.'}</p>
      <div class="host-profile-grid">
        <div class="host-profile-metric"><span>Plan</span><b>${esc(c.plan||'—')}</b></div>
        <div class="host-profile-metric"><span>Mensualidad</span><b>${c?money(c.monthly_fee):'—'}</b></div>
        <div class="host-profile-metric"><span>Pago</span><b>${esc({current:'Al día',due_soon:'Por vencer',overdue:'Pendiente'}[c.payment_status]||'—')}</b></div>
        <div class="host-profile-metric"><span>Acceso</span><b>${clientUser?'Activo':'Sin usuario cliente'}</b></div>
      </div>
      <div class="host-card-actions">
        <button class="btn" onclick="openClientConfig('${o.id}')">Configurar portal</button>
        <button class="btn" onclick="previewClient('${esc(o.slug)}')">Vista cliente</button>
        <button class="btn primary" onclick="enterOrg('${esc(o.slug)}')">Abrir CRM interno</button>
      </div>
    </div>
    <div class="host-card"><h3>Módulos del cliente</h3><p>Control independiente del CRM interno de Segmenta.</p>
      <div class="host-profile-grid">
        ${[['results','Resultados'],['crm','CRM'],['payments','Pagos'],['reports','Reportes']].map(([k,l])=>`<div class="host-profile-metric"><span>${l}</span><b>${c.portal_settings?.[k]===false?'Oculto':'Visible'}</b></div>`).join('')}
      </div>
    </div>`;
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
    panel.innerHTML=`<div class="head"><div><div class="eyebrow">Oferta</div><h1>Planes</h1><p>La mensualidad real se define por cliente; el plan funciona como clasificación.</p></div></div>
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
    document.getElementById('cpResults').checked=c.portal_settings?.results!==false;
    document.getElementById('cpCrm').checked=c.portal_settings?.crm!==false;
    document.getElementById('cpPayments').checked=c.portal_settings?.payments!==false;
    document.getElementById('cpReports').checked=c.portal_settings?.reports!==false;
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

  async function saveClientProfile(e){
    e.preventDefault();
    try{
      let orgId=document.getElementById('cpOrgId').value;
      let org=(window.hostData||[]).find(x=>x.id===orgId);
      if(!orgId){
        const created=await req('/api/crm-admin',{action:'create_org',name:document.getElementById('cpName').value.trim()});
        org=created.organization;orgId=org.id;
      }
      const profile=await req('/api/client-portal',{
        action:'upsert_profile',organization_id:orgId,name:document.getElementById('cpName').value.trim(),sector:document.getElementById('cpSector').value.trim(),
        plan:document.getElementById('cpPlan').value,monthly_fee:document.getElementById('cpFee').value,payment_status:document.getElementById('cpPaymentStatus').value,
        next_payment_date:document.getElementById('cpNextPayment').value||null,payment_method_label:document.getElementById('cpPaymentMethod').value.trim(),
        dashboard_url:document.getElementById('cpDashboard').value.trim(),contact_name:document.getElementById('cpContactName').value.trim(),contact_email:document.getElementById('cpContactEmail').value.trim(),
        portal_settings:{results:document.getElementById('cpResults').checked,crm:document.getElementById('cpCrm').checked,payments:document.getElementById('cpPayments').checked,reports:document.getElementById('cpReports').checked}
      });
      const email=document.getElementById('cpUserEmail').value.trim(),password=document.getElementById('cpUserPassword').value;
      if(email||password){
        if(!email||password.length<8)throw new Error('Para crear acceso, completa correo y contraseña de mínimo 8 caracteres');
        await req('/api/crm-admin',{action:'create_user',organization_id:orgId,display_name:document.getElementById('cpUserName').value.trim()||document.getElementById('cpContactName').value.trim(),email,password,role:'client',permissions:{}});
      }
      closeClientPortalModal();await window.loadHost();selectedClientOrg=orgId;setHostTab('clients');
    }catch(err){alert(err.message)}
  }

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
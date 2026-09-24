(() => {
  let hubState={integrations:[],channels:[],capabilities:{}};
  let activeCategory='channels';

  const CATEGORIES=[
    {id:'channels',label:'Canales',icon:'◉'},
    {id:'email',label:'Correo',icon:'✉'},
    {id:'commerce',label:'Comercio',icon:'▣'},
    {id:'ai',label:'IA',icon:'✦'},
    {id:'system',label:'Sistema',icon:'⌁'}
  ];

  const CATALOG=[
    {id:'instagram',category:'channels',name:'Instagram',icon:'◎',iconClass:'ig',desc:'Mensajería de Instagram conectada a la Bandeja.'},
    {id:'messenger',category:'channels',name:'Messenger',icon:'◆',iconClass:'ms',desc:'Mensajes de Facebook Messenger desde tus páginas.'},
    {id:'whatsapp',category:'channels',name:'WhatsApp Cloud API',icon:'◔',iconClass:'wa',desc:'Mensajería oficial de Meta para WhatsApp Business.'},
    {id:'tiktok',category:'channels',name:'TikTok DM',icon:'♪',iconClass:'tt',desc:'Mensajería directa de cuentas TikTok for Business.'},
    {id:'telegram',category:'channels',name:'Telegram Bot',icon:'➤',iconClass:'tg',desc:'Bot oficial mediante BotFather.'},
    {id:'smtp',category:'email',name:'Correo (SMTP)',icon:'✉',iconClass:'mail',desc:'Envía correos con las credenciales de tu proveedor.'},
    {id:'gmail',category:'email',name:'Gmail',icon:'M',iconClass:'gmail',desc:'Recibe y responde correos desde la bandeja.'},
    {id:'outlook',category:'email',name:'Outlook',icon:'O',iconClass:'outlook',desc:'Recibe y responde correos de Microsoft 365.'},
    {id:'wired',category:'commerce',name:'Tienda externa / Wired',icon:'W',iconClass:'wired',desc:'Contactos, pedidos, clientes y eventos de tienda.'},
    {id:'skydropx',category:'commerce',name:'Skydropx',icon:'S',iconClass:'sky',desc:'Tarifas, guías y seguimiento logístico por empresa.'},
    {id:'openai',category:'ai',name:'OpenAI',icon:'✦',iconClass:'openai',desc:'Proveedor IA para agentes y automatizaciones.'},
    {id:'anthropic',category:'ai',name:'Anthropic',icon:'A',iconClass:'anthropic',desc:'Proveedor IA alternativo con credencial propia.'},
    {id:'gemini',category:'ai',name:'Gemini',icon:'✧',iconClass:'gemini',desc:'Proveedor IA de Google para agentes y flujos.'},
    {id:'meta',category:'system',name:'Meta Business',icon:'∞',iconClass:'meta',desc:'Portafolio, permisos, páginas y activos autorizados.'},
    {id:'webchat',category:'system',name:'Webchat / QA',icon:'Q',iconClass:'qa',desc:'Canal interno para pruebas controladas del CRM.'}
  ];

  function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function fmtDate(v){if(!v)return 'Sin sincronización';try{return new Date(v).toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}catch(_){return String(v)}}
  function groupChannels(type){return (hubState.channels||[]).filter(x=>x.channel_type===type)}
  function metaIntegration(){return (hubState.integrations||[]).find(x=>x.provider==='meta'&&x.integration_type==='business_portfolio'&&x.status!=='disconnected')||null}
  function aiIntegration(provider){return (hubState.integrations||[]).find(x=>x.provider===provider&&x.integration_type==='api_key'&&x.external_account_id==='default'&&x.status!=='disconnected')||null}
  function connected(rows){return rows.some(x=>x.status==='connected')}

  function connectorState(item){
    if(item.id==='instagram'){
      const rows=groupChannels('instagram'),active=rows.filter(x=>String(x.metadata?.routing_active)==='true');
      return {
        status:connected(rows)?'connected':'off',
        badge:connected(rows)?'CONECTADO':'NO CONECTADO',
        subtitle:rows.length?(rows.map(x=>x.external_account_name||x.external_account_id).join(' · ')):'Sin cuenta conectada',
        note:rows.length?rows.length+' canal'+(rows.length===1?'':'es')+' detectado'+(rows.length===1?'':'s')+(active.length?' · '+active.length+' ruta activa':''):'Conecta tu cuenta profesional de Instagram.',
        rows
      };
    }
    if(item.id==='messenger'){
      const rows=groupChannels('facebook_messenger');
      return {
        status:connected(rows)?'connected':'off',
        badge:connected(rows)?'CONECTADO':'NO CONECTADO',
        subtitle:rows.length?(rows.map(x=>x.external_account_name||x.external_account_id).join(' · ')):'Sin página conectada',
        note:rows.length?rows.length+' página'+(rows.length===1?'':'s')+' detectada'+(rows.length===1?'':'s'):'Conecta una página de Facebook.',
        rows
      };
    }
    if(item.id==='whatsapp'){
      const rows=groupChannels('whatsapp');
      return {status:connected(rows)?'connected':'off',badge:connected(rows)?'CONECTADO':'PENDIENTE',subtitle:rows.length?(rows.map(x=>x.external_account_name||x.external_account_id).join(' · ')):'Meta WhatsApp Business',note:rows.length?'Mensajería activa':'Onboarding oficial pendiente.',rows};
    }
    if(item.id==='webchat'){
      const rows=groupChannels('webchat');
      return {status:connected(rows)?'connected':'off',badge:connected(rows)?'CONECTADO':'NO ACTIVO',subtitle:rows[0]?.external_account_name||'Simulador interno',note:rows.length?'Canal de prueba listo':'Aún no se ha inicializado QA.',rows};
    }
    if(['openai','anthropic','gemini'].includes(item.id)){
      const ai=aiIntegration(item.id);
      return {
        status:ai?.status==='connected'?'connected':ai?.status==='error'?'pending':'off',
        badge:ai?.status==='connected'?'CONECTADO':ai?.status==='error'?'ERROR':'NO CONECTADO',
        subtitle:ai?.metadata?.key_masked||'BYO API Key',
        note:ai?.status==='connected'
          ? ('Llave validada'+(ai.metadata?.validated_at?' · '+fmtDate(ai.metadata.validated_at):''))
          : ai?.last_error||'Conecta una llave propia de este workspace.',
        integration:ai
      };
    }
    if(['openai','anthropic','gemini'].includes(item.id)){
      if(state.status==='connected'){
        return `<button class="integration-action" type="button" onclick="openIntegrationConfig('${item.id}')">Configurar</button>
          <button class="integration-action" type="button" onclick="testSavedAIKey('${item.id}')">Probar conexión</button>
          <button class="integration-action danger" type="button" onclick="disconnectAIProvider('${item.id}')">Desconectar</button>`;
      }
      return `<button class="integration-action primary" type="button" onclick="openIntegrationConfig('${item.id}')">Conectar API key</button>`;
    }
    if(item.id==='meta'){
      const meta=metaIntegration();
      return {
        status:meta?.status==='connected'?'connected':meta?.status==='pending'?'pending':'off',
        badge:meta?.status==='connected'?'CONECTADO':meta?.status==='pending'?'PERMISOS PENDIENTES':'NO CONECTADO',
        subtitle:meta?.display_name||'Meta Business Portfolio',
        note:meta?.status==='pending'?(meta.last_error||'Autorización pendiente'):meta?.status==='connected'?'Portafolio autorizado':'Conecta el portafolio de esta empresa.',
        integration:meta
      };
    }
    const future={
      tiktok:['TikTok for Business','Requiere vincular una cuenta empresarial.'],
      telegram:['BotFather','Conecta un bot oficial de Telegram.'],
      smtp:['Servidor SMTP','Credenciales por empresa.'],
      gmail:['Google Workspace','OAuth de Gmail por empresa.'],
      outlook:['Microsoft 365','OAuth de Microsoft por empresa.'],
      wired:['Tienda / ecommerce','Webhooks y API de la tienda.'],
      skydropx:['Logística','Credenciales y guías por empresa.']
    }[item.id]||['Disponible','Conector por configurar'];
    return {status:'future',badge:'PRÓXIMAMENTE',subtitle:future[0],note:future[1],rows:[]};
  }

  function statusClass(status){return status==='connected'?'connected':status==='pending'?'pending':status==='future'?'future':'off'}

  function categoryCounts(){
    const out={};
    for(const c of CATEGORIES)out[c.id]=CATALOG.filter(x=>x.category===c.id).length;
    return out;
  }

  function renderTabs(){
    const root=document.getElementById('integrationCategoryTabs');if(!root)return;
    const counts=categoryCounts();
    root.innerHTML=CATEGORIES.map(c=>`<button type="button" class="integration-tab ${activeCategory===c.id?'active':''}" data-cat="${c.id}"><span>${c.icon}</span>${c.label}<em>${counts[c.id]||0}</em></button>`).join('');
    root.querySelectorAll('[data-cat]').forEach(b=>b.addEventListener('click',()=>{activeCategory=b.dataset.cat;render()}));
  }

  function actionsFor(item,state){
    if(['instagram','messenger'].includes(item.id)){
      if(state.status==='connected'){
        return `<button class="integration-action" type="button" onclick="openIntegrationConfig('${item.id}')">Configurar</button>
          <button class="integration-action" type="button" onclick="addMetaChannel()">＋ Agregar otro canal</button>`;
      }
      return `<button class="integration-action primary" type="button" onclick="addMetaChannel()">Conectar cuenta</button>`;
    }
    if(item.id==='meta'){
      const m=state.integration;
      if(state.status==='connected'){
        return `<button class="integration-action" type="button" onclick="openIntegrationConfig('meta')">Configurar</button>
          <button class="integration-action" type="button" onclick="syncMetaChannels(false)">↻ Sincronizar activos</button>
          <button class="integration-action danger" type="button" onclick="disconnectMetaBusiness()">Desconectar</button>`;
      }
      return `<button class="integration-action primary" type="button" onclick="addMetaChannel()">${state.status==='pending'?'Continuar conexión':'Conectar Meta Business'}</button>`;
    }
    if(item.id==='webchat'){
      return `<button class="integration-action" type="button" onclick="openIntegrationConfig('webchat')">Configurar</button>`;
    }
    if(item.id==='whatsapp'&&state.status==='connected'){
      return `<button class="integration-action" type="button" onclick="openIntegrationConfig('whatsapp')">Configurar</button>`;
    }
    return `<button class="integration-action primary" type="button" disabled>Disponible próximamente</button>`;
  }

  function renderCard(item){
    const st=connectorState(item);
    return `<article class="integration-card" data-connector="${item.id}">
      <div class="integration-card-top">
        <div class="integration-icon ${item.iconClass}">${item.icon}</div>
        <div class="integration-title-wrap"><h3>${esc(item.name)}</h3><p>${esc(st.subtitle)}</p></div>
        <span class="integration-status ${statusClass(st.status)}">${esc(st.badge)}</span>
      </div>
      <div class="integration-desc">${esc(item.desc)}</div>
      <div class="integration-note ${st.status==='pending'?'warn':''}">${esc(st.note)}</div>
      <div class="integration-actions">${actionsFor(item,st)}</div>
    </article>`;
  }

  function renderCards(){
    const root=document.getElementById('integrationCards');if(!root)return;
    root.innerHTML=CATALOG.filter(x=>x.category===activeCategory).map(renderCard).join('');
  }

  function renderSummary(){
    const meta=metaIntegration(),channels=hubState.channels||[];
    const connectedCount=channels.filter(x=>x.status==='connected'&&!x.metadata?.test_mode).length;
    const root=document.getElementById('integrationSummary');if(root){
      root.innerHTML=`<span><b>${connectedCount}</b> canales conectados</span><span><b>${CATALOG.length}</b> conectores disponibles</span><span class="${meta?.status==='pending'?'warn':''}">${meta?.status==='connected'?'Meta Business conectado':meta?.status==='pending'?'Meta requiere permisos':'Meta Business sin conectar'}</span>`;
    }
  }

  function render(){
    renderTabs();renderSummary();renderCards();
  }

  function detailsFor(id){
    const item=CATALOG.find(x=>x.id===id),st=item?connectorState(item):null;
    if(!item||!st)return null;
    const rows=st.rows||[];
    return {item,st,rows};
  }

  window.openIntegrationConfig=function(id){
    const data=detailsFor(id);if(!data)return;
    const {item,st,rows}=data;
    const modal=document.getElementById('integrationConfigModal'),title=document.getElementById('integrationConfigTitle'),body=document.getElementById('integrationConfigBody');
    if(!modal||!title||!body)return;
    title.textContent=item.name;
    let html=`<div class="integration-config-status"><span class="integration-status ${statusClass(st.status)}">${esc(st.badge)}</span><p>${esc(st.note)}</p></div>`;
    if(['openai','anthropic','gemini'].includes(id)){
      const labels={openai:'OpenAI API key',anthropic:'Anthropic API key',gemini:'Gemini API / authorization key'};
      const hints={openai:'La llave se valida contra la API de OpenAI y se cifra antes de guardarse.',anthropic:'La llave se valida contra Claude API y se cifra antes de guardarse.',gemini:'Usa una llave vigente de Gemini API. La llave se valida y se cifra antes de guardarse.'};
      html+=`<div class="ai-key-form">
        <label>${esc(labels[id])}</label>
        <div class="ai-key-input-row">
          <input id="aiKeyInput" type="password" autocomplete="new-password" spellcheck="false" placeholder="${id==='openai'?'sk-...':id==='anthropic'?'sk-ant-...':'Pega tu llave aquí'}">
          <button type="button" class="ai-key-eye" onclick="toggleAIKeyVisibility()">Mostrar</button>
        </div>
        <p>${esc(hints[id])}</p>
        <div class="ai-key-feedback" id="aiKeyFeedback"></div>
        <div class="ai-key-actions">
          <button type="button" class="integration-action" onclick="testAIKey('${id}')">Probar llave</button>
          <button type="button" class="integration-action primary" onclick="saveAIKey('${id}')">Probar y guardar</button>
        </div>
        ${st.integration?`<div class="ai-key-current"><span>Llave actual</span><b>${esc(st.integration.metadata?.key_masked||'Guardada')}</b><small>Última validación: ${esc(fmtDate(st.integration.metadata?.validated_at||st.integration.last_sync_at))}</small></div>`:''}
      </div>`;
    }else if(id==='meta'&&st.integration){
      const m=st.integration;
      html+=`<div class="integration-config-grid">
        <div><span>Estado</span><b>${esc(m.status||'—')}</b></div>
        <div><span>ID externo</span><b>${esc(m.external_account_id||'—')}</b></div>
        <div><span>Última sincronización</span><b>${esc(fmtDate(m.last_sync_at))}</b></div>
        <div><span>Último error</span><b>${esc(m.last_error||'Ninguno')}</b></div>
      </div>`;
    }else if(rows.length){
      html+=rows.map((x,i)=>`<div class="integration-channel-detail">
        <div class="integration-channel-head"><b>${esc(x.external_account_name||item.name+' '+(i+1))}</b><span class="integration-status ${statusClass(x.status==='connected'?'connected':'off')}">${esc(x.status||'—')}</span></div>
        <div class="integration-config-grid">
          <div><span>ID de cuenta</span><b>${esc(x.external_account_id||'—')}</b></div>
          <div><span>Mensajería</span><b>${x.metadata?.messages===false?'No':'Sí'}</b></div>
          <div><span>Ruta activa</span><b>${String(x.metadata?.routing_active)==='true'?'Sí':'No'}</b></div>
          <div><span>Actualizado</span><b>${esc(fmtDate(x.updated_at))}</b></div>
        </div>
      </div>`).join('');
    }else{
      html+='<div class="integration-empty-config">Este conector todavía no tiene una cuenta configurada.</div>';
    }
    body.innerHTML=html;
    modal.classList.remove('hidden');
  };

  window.closeIntegrationConfig=function(){document.getElementById('integrationConfigModal')?.classList.add('hidden')};
  window.addMetaChannel=function(){
    if(typeof window.beginMetaBusinessConnection==='function')window.beginMetaBusinessConnection();
  };

  window.toggleAIKeyVisibility=function(){
    const input=document.getElementById('aiKeyInput'),btn=document.querySelector('.ai-key-eye');
    if(!input)return;
    const show=input.type==='password';input.type=show?'text':'password';if(btn)btn.textContent=show?'Ocultar':'Mostrar';
  };

  async function aiKeyRequest(action,provider,apiKey){
    const body={action,provider};
    if(apiKey!==undefined)body.api_key=apiKey;
    const r=await fetch('/api/crm-integrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||'No fue posible validar la llave');
    return j;
  }

  window.testAIKey=async function(provider){
    const input=document.getElementById('aiKeyInput'),feedback=document.getElementById('aiKeyFeedback');
    const key=input?.value.trim();if(!key){if(feedback)feedback.innerHTML='<span class="bad">Escribe la llave primero.</span>';return}
    if(feedback)feedback.innerHTML='<span>Validando con el proveedor…</span>';
    try{
      const j=await aiKeyRequest('test_ai_key',provider,key);
      const models=j.validation?.sample_models||[];
      if(feedback)feedback.innerHTML='<span class="ok">✓ Llave válida'+(models.length?' · '+esc(models.slice(0,2).join(', ')):'')+'</span>';
    }catch(err){if(feedback)feedback.innerHTML='<span class="bad">'+esc(err.message)+'</span>'}
  };

  window.saveAIKey=async function(provider){
    const input=document.getElementById('aiKeyInput'),feedback=document.getElementById('aiKeyFeedback');
    const key=input?.value.trim();if(!key){if(feedback)feedback.innerHTML='<span class="bad">Escribe la llave primero.</span>';return}
    if(feedback)feedback.innerHTML='<span>Validando y cifrando…</span>';
    try{
      await aiKeyRequest('save_ai_key',provider,key);
      if(input)input.value='';
      if(feedback)feedback.innerHTML='<span class="ok">✓ Llave validada y guardada de forma cifrada.</span>';
      window.toast?.('Llave IA conectada correctamente');
      await loadHub();
      setTimeout(()=>openIntegrationConfig(provider),60);
    }catch(err){if(feedback)feedback.innerHTML='<span class="bad">'+esc(err.message)+'</span>'}
  };

  window.testSavedAIKey=async function(provider){
    try{
      const j=await aiKeyRequest('test_saved_ai_key',provider);
      const models=j.validation?.sample_models||[];
      window.toast?.('Conexión válida'+(models.length?' · '+models[0]:''));
      await loadHub();
    }catch(err){window.toast?.(err.message||'La llave guardada no pasó la prueba')}
  };

  window.disconnectAIProvider=async function(provider){
    const integration=aiIntegration(provider);
    if(!integration?.id)return;
    if(!confirm('¿Desconectar la llave de '+provider+' de este workspace?'))return;
    try{
      const r=await fetch('/api/crm-integrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'disconnect',integration_id:integration.id})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error||'No fue posible desconectar');
      closeIntegrationConfig();window.toast?.('Llave desconectada');await loadHub();
    }catch(err){window.toast?.(err.message||'No fue posible desconectar')}
  };

  async function loadHub(){
    const cards=document.getElementById('integrationCards');if(cards)cards.innerHTML='<div class="integration-loading">Cargando conectores…</div>';
    try{
      const r=await fetch('/api/crm-integrations',{cache:'no-store'}),j=await r.json();
      if(r.status===401){await window.ensureCrmAuth?.(false);return}
      if(!r.ok)throw new Error(j.error||'No fue posible cargar integraciones');
      hubState=j;window.integrationState=j;render();
    }catch(err){
      if(cards)cards.innerHTML='<div class="integration-loading error">'+esc(err.message||'No fue posible cargar integraciones')+'</div>';
      window.toast?.(err.message||'No fue posible cargar integraciones');
    }
  }

  window.loadIntegrationHub=loadHub;
  window.loadIntegrations=loadHub;

  window.disconnectMetaBusiness=async function(){
    const meta=metaIntegration();
    if(!meta?.id){window.toast?.('No hay un portafolio Meta conectado para desconectar');return}
    if(!confirm('¿Desconectar el portafolio Meta de este workspace?'))return;
    try{
      const r=await fetch('/api/crm-integrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'disconnect',integration_id:meta.id})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error||'No fue posible desconectar Meta');
      closeIntegrationConfig();
      window.toast?.('Portafolio Meta desconectado');
      await loadHub();
    }catch(err){window.toast?.(err.message||'No fue posible desconectar Meta')}
  };

  function init(){
    const page=document.getElementById('page-integrations');if(!page)return;
    render();
    if(window.currentPage==='integrations')loadHub();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
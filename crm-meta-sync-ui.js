(() => {
  let syncing=false;

  async function api(method,body){
    const r=await fetch('/api/crm-integrations',{
      method,
      headers: body?{'Content-Type':'application/json'}:undefined,
      body: body?JSON.stringify(body):undefined,
      cache:'no-store'
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||'No fue posible sincronizar Meta');
    return j;
  }

  function ensureButton(){
    const connect=document.getElementById('metaConnectBtn');
    if(!connect)return null;
    let btn=document.getElementById('metaSyncChannelsBtn');
    if(btn)return btn;
    btn=document.createElement('button');
    btn.id='metaSyncChannelsBtn';
    btn.className='btn';
    btn.type='button';
    btn.textContent='↻ Sincronizar canales';
    btn.onclick=()=>syncMetaChannels(false);
    connect.parentElement?.appendChild(btn);
    return btn;
  }

  async function refreshSyncUi(auto=false){
    try{
      const j=await api('GET');
      const meta=(j.integrations||[]).find(x=>x.provider==='meta'&&x.integration_type==='business_portfolio'&&x.status==='connected');
      const channels=(j.channels||[]).filter(x=>x.integration_id===meta?.id || ['facebook_messenger','instagram'].includes(x.channel_type));
      const btn=ensureButton();
      if(!btn)return;
      btn.classList.toggle('hidden',!meta);
      if(meta){
        const connected=channels.filter(x=>x.status==='connected').length;
        btn.textContent=connected?('↻ Sincronizar canales · '+connected):'↻ Sincronizar canales';
        if(auto && channels.length===0 && !sessionStorage.getItem('meta_auto_sync_attempted')){
          sessionStorage.setItem('meta_auto_sync_attempted','1');
          await syncMetaChannels(true);
        }
      }
    }catch(_){}
  }

  async function syncMetaChannels(auto){
    if(syncing)return;
    syncing=true;
    const btn=ensureButton();
    const previous=btn?.textContent;
    if(btn){btn.disabled=true;btn.textContent='Sincronizando…'}
    try{
      const j=await api('POST',{action:'sync_meta_assets'});
      const count=(j.channels||[]).filter(Boolean).length;
      if(typeof window.toast==='function'){
        window.toast(count?('Meta sincronizado · '+count+' canal'+(count===1?'':'es')):'Meta conectado, pero no se detectaron canales autorizados');
      }
      if(typeof window.loadIntegrations==='function')await window.loadIntegrations();
    }catch(err){
      if(typeof window.toast==='function')window.toast(err.message);
      else if(!auto)alert(err.message);
    }finally{
      syncing=false;
      if(btn){btn.disabled=false;btn.textContent=previous||'↻ Sincronizar canales'}
      setTimeout(()=>refreshSyncUi(false),300);
    }
  }

  window.syncMetaChannels=syncMetaChannels;

  const original=window.loadIntegrations;
  if(original){
    window.loadIntegrations=async function(...args){
      const out=await original.apply(this,args);
      await refreshSyncUi(false);
      return out;
    };
  }

  function init(){
    ensureButton();
    refreshSyncUi(true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
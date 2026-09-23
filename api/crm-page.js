module.exports=async function handler(req,res){
  try{
    const proto=(req.headers['x-forwarded-proto']||'https').split(',')[0];
    const host=req.headers.host;
    const r=await fetch(`${proto}://${host}/crm-v3.html`);
    if(!r.ok)return res.status(r.status).send('CRM unavailable');
    let html=await r.text();
    html=html.replace('</head>','<link rel="stylesheet" href="/integrations-ui.css?v=20260922-2">\n<link rel="stylesheet" href="/crm-execution-ui.css?v=20260922-2">\n<link rel="stylesheet" href="/crm-visual-refresh.css?v=20260923-1">\n<link rel="stylesheet" href="/crm-pipeline-ui.css?v=20260922-1">\n<link rel="stylesheet" href="/crm-qa-simulator.css?v=20260922-1">\n</head>');
    html=html.replace('</body>',`
<style id="segmenta-inbox-reply-inline-style">
#chatPane{position:relative!important}
#segmentaReplyBox{position:absolute;left:14px;right:14px;bottom:34px;z-index:999;background:#fff;border:1px solid #ded6cd;border-radius:14px;padding:10px 12px;box-shadow:0 10px 30px rgba(45,36,29,.13)}
#segmentaReplyRow{display:flex;gap:8px;align-items:flex-end}
#segmentaReplyText{flex:1;min-height:48px;max-height:110px;resize:vertical;border:1px solid #ded5cb;border-radius:11px;padding:11px 12px;font:inherit;outline:none;background:#fff;color:#2d241d}
#segmentaReplyText:focus{border-color:#d39048;box-shadow:0 0 0 3px rgba(232,127,0,.09)}
#segmentaReplySend{height:48px;min-width:94px;border:0;border-radius:11px;background:#e87f00;color:#fff;font-weight:800;cursor:pointer}
#segmentaReplySend:disabled{opacity:.55;cursor:not-allowed}
#segmentaReplyHelp{font-size:11px;color:#7e746b;margin-top:5px}
#messages{padding-bottom:122px!important}
</style>
<script id="segmenta-inbox-reply-inline-script">
(()=>{
  let sending=false;
  function activeConversation(){
    const active=document.querySelector('.conversation-item.active');
    const attr=active?.getAttribute('onclick')||'';
    const m=attr.match(/openConversation\(['"]([^'"]+)['"]\)/);
    return m?.[1]||null;
  }
  function mount(){
    const pane=document.getElementById('chatPane');
    const content=document.getElementById('chatContent');
    if(!pane||!content||content.classList.contains('hidden')) {
      const old=document.getElementById('segmentaReplyBox');
      if(old) old.style.display='none';
      return;
    }
    let box=document.getElementById('segmentaReplyBox');
    if(!box){
      box=document.createElement('div');
      box.id='segmentaReplyBox';
      box.innerHTML='<div id="segmentaReplyRow"><textarea id="segmentaReplyText" maxlength="2000" placeholder="Escribe una respuesta..."></textarea><button id="segmentaReplySend" type="button">Enviar</button></div><div id="segmentaReplyHelp">Enter para enviar · Shift+Enter para salto de línea</div>';
      pane.appendChild(box);
      document.getElementById('segmentaReplySend').addEventListener('click',send);
      document.getElementById('segmentaReplyText').addEventListener('keydown',e=>{
        if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}
      });
    }
    box.style.display='block';
  }
  async function send(){
    if(sending)return;
    const id=activeConversation();
    const input=document.getElementById('segmentaReplyText');
    const btn=document.getElementById('segmentaReplySend');
    const help=document.getElementById('segmentaReplyHelp');
    const text=(input?.value||'').trim();
    if(!id){if(help){help.textContent='Selecciona una conversación.';help.style.color='#c74c3b'};return}
    if(!text){input?.focus();return}
    sending=true;
    if(btn){btn.disabled=true;btn.textContent='Enviando…'}
    if(help){help.textContent='Enviando mensaje…';help.style.color='#7e746b'}
    try{
      const r=await fetch('/api/crm-inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send_message',conversation_id:id,text})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error||'No fue posible enviar el mensaje');
      if(input)input.value='';
      if(help){help.textContent='Mensaje enviado';help.style.color='#2e9e6b'}
      try{if(typeof loadConversation==='function')await loadConversation(id,false)}catch(_){}
      try{if(typeof loadInbox==='function')await loadInbox(true)}catch(_){}
      input?.focus();
    }catch(err){
      if(help){help.textContent=err.message||'No fue posible enviar el mensaje';help.style.color='#c74c3b'}
      try{if(typeof toast==='function')toast(err.message||'No fue posible enviar el mensaje')}catch(_){}
    }finally{
      sending=false;
      if(btn){btn.disabled=false;btn.textContent='Enviar'}
      setTimeout(mount,50);
    }
  }
  const observer=new MutationObserver(()=>setTimeout(mount,0));
  function init(){
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
    mount();
    setInterval(mount,1000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
</script>`+'\n</body>');
    html=html.replace('</body>','<script src="/crm-execution-ui.js?v=20260922-3"></script>\n<script src="/crm-pipeline-ui.js?v=20260922-1"></script>\n<script src="/crm-guided-ui.js?v=20260922-1"></script>\n<script src="/crm-qa-simulator.js?v=20260922-2"></script>\n<script src="/crm-meta-sync-ui.js?v=20260922-1"></script>\n<script src="/crm-inbox-reply-fix.js?v=20260923-2"></script>\n</body>');
    html=html.replace('</body>',`
<style id="segmenta-inbox-reply-inline-style">
#chatPane{position:relative!important}
#segmentaReplyBox{position:absolute;left:14px;right:14px;bottom:34px;z-index:999;background:#fff;border:1px solid #ded6cd;border-radius:14px;padding:10px 12px;box-shadow:0 10px 30px rgba(45,36,29,.13)}
#segmentaReplyRow{display:flex;gap:8px;align-items:flex-end}
#segmentaReplyText{flex:1;min-height:48px;max-height:110px;resize:vertical;border:1px solid #ded5cb;border-radius:11px;padding:11px 12px;font:inherit;outline:none;background:#fff;color:#2d241d}
#segmentaReplyText:focus{border-color:#d39048;box-shadow:0 0 0 3px rgba(232,127,0,.09)}
#segmentaReplySend{height:48px;min-width:94px;border:0;border-radius:11px;background:#e87f00;color:#fff;font-weight:800;cursor:pointer}
#segmentaReplySend:disabled{opacity:.55;cursor:not-allowed}
#segmentaReplyHelp{font-size:11px;color:#7e746b;margin-top:5px}
#messages{padding-bottom:122px!important}
</style>
<script id="segmenta-inbox-reply-inline-script">
(()=>{
  let sending=false;
  function activeConversation(){
    const active=document.querySelector('.conversation-item.active');
    const attr=active?.getAttribute('onclick')||'';
    const m=attr.match(/openConversation\(['"]([^'"]+)['"]\)/);
    return m?.[1]||null;
  }
  function mount(){
    const pane=document.getElementById('chatPane');
    const content=document.getElementById('chatContent');
    if(!pane||!content||content.classList.contains('hidden')) {
      const old=document.getElementById('segmentaReplyBox');
      if(old) old.style.display='none';
      return;
    }
    let box=document.getElementById('segmentaReplyBox');
    if(!box){
      box=document.createElement('div');
      box.id='segmentaReplyBox';
      box.innerHTML='<div id="segmentaReplyRow"><textarea id="segmentaReplyText" maxlength="2000" placeholder="Escribe una respuesta..."></textarea><button id="segmentaReplySend" type="button">Enviar</button></div><div id="segmentaReplyHelp">Enter para enviar · Shift+Enter para salto de línea</div>';
      pane.appendChild(box);
      document.getElementById('segmentaReplySend').addEventListener('click',send);
      document.getElementById('segmentaReplyText').addEventListener('keydown',e=>{
        if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}
      });
    }
    box.style.display='block';
  }
  async function send(){
    if(sending)return;
    const id=activeConversation();
    const input=document.getElementById('segmentaReplyText');
    const btn=document.getElementById('segmentaReplySend');
    const help=document.getElementById('segmentaReplyHelp');
    const text=(input?.value||'').trim();
    if(!id){if(help){help.textContent='Selecciona una conversación.';help.style.color='#c74c3b'};return}
    if(!text){input?.focus();return}
    sending=true;
    if(btn){btn.disabled=true;btn.textContent='Enviando…'}
    if(help){help.textContent='Enviando mensaje…';help.style.color='#7e746b'}
    try{
      const r=await fetch('/api/crm-inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send_message',conversation_id:id,text})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error||'No fue posible enviar el mensaje');
      if(input)input.value='';
      if(help){help.textContent='Mensaje enviado';help.style.color='#2e9e6b'}
      try{if(typeof loadConversation==='function')await loadConversation(id,false)}catch(_){}
      try{if(typeof loadInbox==='function')await loadInbox(true)}catch(_){}
      input?.focus();
    }catch(err){
      if(help){help.textContent=err.message||'No fue posible enviar el mensaje';help.style.color='#c74c3b'}
      try{if(typeof toast==='function')toast(err.message||'No fue posible enviar el mensaje')}catch(_){}
    }finally{
      sending=false;
      if(btn){btn.disabled=false;btn.textContent='Enviar'}
      setTimeout(mount,50);
    }
  }
  const observer=new MutationObserver(()=>setTimeout(mount,0));
  function init(){
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
    mount();
    setInterval(mount,1000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
</script>
</body>`);
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    return res.status(200).send(html);
  }catch(e){
    console.error('CRM_PAGE_ERROR',e.message);
    return res.status(500).send('CRM unavailable');
  }
};
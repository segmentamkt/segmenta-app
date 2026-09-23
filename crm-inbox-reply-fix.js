(() => {
  let busy=false;

  function currentConversationId(){
    try{
      if(typeof activeConversationId!=='undefined' && activeConversationId) return activeConversationId;
    }catch(_){}
    return null;
  }

  function ensureComposer(){
    const pane=document.getElementById('chatPane');
    const content=document.getElementById('chatContent');
    if(!pane||!content||content.classList.contains('hidden')) return null;

    let box=document.getElementById('inboxReplyDock') || document.getElementById('chatCompose');
    if(!box){
      box=document.createElement('div');
      box.id='inboxReplyDock';
      box.innerHTML=
        '<div style="display:flex;gap:8px;align-items:flex-end">'+
          '<textarea id="inboxReplyText" maxlength="2000" placeholder="Escribe una respuesta..." style="flex:1;min-height:48px;max-height:110px;resize:vertical;border:1px solid #ded5cb;border-radius:11px;padding:11px 12px;font:inherit;outline:none"></textarea>'+
          '<button id="inboxReplyBtn" type="button" style="height:48px;min-width:92px;border:0;border-radius:11px;background:#e87f00;color:#fff;font-weight:800;cursor:pointer">Enviar</button>'+
        '</div>'+
        '<div id="inboxReplyFeedback" style="font-size:11px;color:#7e746b;margin-top:5px">Enter para enviar · Shift+Enter para salto de línea</div>';
      document.body.appendChild(box);
    }else if(box.parentElement!==document.body){
      box.parentElement.removeChild(box);
      document.body.appendChild(box);
    }

    Object.assign(box.style,{
      position:'fixed',
      zIndex:'999',
      background:'#fff',
      border:'1px solid #e8e2da',
      borderRadius:'14px',
      padding:'10px 12px',
      boxShadow:'0 12px 32px rgba(45,36,29,.14)'
    });

    const btn=document.getElementById('inboxReplyBtn');
    const input=document.getElementById('inboxReplyText');
    if(btn && !btn.dataset.bound){
      btn.dataset.bound='1';
      btn.addEventListener('click',send);
    }
    if(input && !input.dataset.bound){
      input.dataset.bound='1';
      input.addEventListener('keydown',e=>{
        if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}
      });
    }

    positionComposer();
    return box;
  }

  function positionComposer(){
    const box=document.getElementById('inboxReplyDock') || document.getElementById('chatCompose');
    const pane=document.getElementById('chatPane');
    const content=document.getElementById('chatContent');
    if(!box||!pane||!content||content.classList.contains('hidden')){
      if(box) box.style.display='none';
      return;
    }
    const r=pane.getBoundingClientRect();
    if(r.width<120 || r.height<120){
      box.style.display='none';
      return;
    }
    box.style.display='block';
    box.style.left=Math.round(r.left+12)+'px';
    box.style.width=Math.max(220,Math.round(r.width-24))+'px';
    box.style.bottom='12px';

    const messages=document.getElementById('messages');
    if(messages) messages.style.paddingBottom='112px';
  }

  async function send(){
    if(busy)return;
    const id=currentConversationId();
    const input=document.getElementById('inboxReplyText');
    const btn=document.getElementById('inboxReplyBtn');
    const feedback=document.getElementById('inboxReplyFeedback');
    const text=(input?.value||'').trim();
    if(!id){ if(feedback){feedback.textContent='Selecciona una conversación.';feedback.style.color='#c74c3b';} return; }
    if(!text){ input?.focus(); return; }

    busy=true;
    if(btn){btn.disabled=true;btn.textContent='Enviando…';}
    if(feedback){feedback.textContent='Enviando mensaje…';feedback.style.color='#7e746b';}
    try{
      const r=await fetch('/api/crm-inbox',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'send_message',conversation_id:id,text})
      });
      const j=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(j.error||'No fue posible enviar el mensaje');
      if(input) input.value='';
      if(feedback){feedback.textContent='Mensaje enviado';feedback.style.color='#2e9e6b';}
      try{
        if(typeof loadConversation==='function') await loadConversation(id,false);
        if(typeof loadInbox==='function') await loadInbox(true);
      }catch(_){}
      input?.focus();
    }catch(err){
      if(feedback){feedback.textContent=err.message||'No fue posible enviar el mensaje';feedback.style.color='#c74c3b';}
      try{ if(typeof toast==='function') toast(err.message||'No fue posible enviar el mensaje'); }catch(_){}
    }finally{
      busy=false;
      if(btn){btn.disabled=false;btn.textContent='Enviar';}
      setTimeout(positionComposer,50);
    }
  }

  function refresh(){
    ensureComposer();
    positionComposer();
  }

  const observer=new MutationObserver(()=>setTimeout(refresh,0));
  document.addEventListener('DOMContentLoaded',()=>{
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});
    refresh();
  });
  if(document.readyState!=='loading'){
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});
    refresh();
  }

  window.addEventListener('resize',positionComposer);
  window.addEventListener('scroll',positionComposer,true);
  setInterval(refresh,1200);

  const oldShow=window.showPage;
  if(oldShow){
    window.showPage=function(){
      const out=oldShow.apply(this,arguments);
      setTimeout(refresh,80);
      return out;
    };
  }

  const oldLoad=window.loadConversation;
  if(oldLoad){
    window.loadConversation=async function(){
      const out=await oldLoad.apply(this,arguments);
      setTimeout(refresh,0);
      return out;
    };
  }
})();
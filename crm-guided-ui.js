(() => {
  function enhanceOpportunityForm(){
    const form=document.querySelector('#page-crm form[onsubmit*="createOpportunity"]');
    if(!form||form.dataset.guided==='1')return;
    form.dataset.guided='1';
    const title=document.getElementById('oppTitle')?.closest('.field');
    if(title)title.insertAdjacentHTML('afterend','<div class="field"><label>Nombre del cliente *</label><input id="oppContactName" required placeholder="Ej. Laura Gómez"></div><div class="field"><label>Teléfono *</label><input id="oppContactPhone" required placeholder="Ej. 3001234567"></div><div class="field full"><label>Correo</label><input id="oppContactEmail" type="email" placeholder="Opcional"></div>');
    const value=document.getElementById('oppValue')?.closest('.field');
    if(value)value.insertAdjacentHTML('afterend','<div class="field"><label>Prioridad inicial</label><select id="oppPriority"><option value="P1">P1 · Alta</option><option value="P2" selected>P2 · Media</option><option value="P3">P3 · Baja</option></select></div><div class="field"><label>Cantidad</label><input id="oppQuantity" type="number" min="0.001" step="0.001"></div>');
    const city=document.getElementById('oppCity')?.closest('.field');
    if(city)city.insertAdjacentHTML('afterend','<div class="field"><label>Uso</label><select id="oppUsage"><option value="">Por definir</option><option value="uso_propio">Uso propio</option><option value="reventa">Reventa</option><option value="empresa">Empresa</option></select></div><div class="field"><label>Urgencia</label><select id="oppUrgency"><option value="">Por definir</option><option value="hoy">Hoy</option><option value="esta_semana">Esta semana</option><option value="este_mes">Este mes</option><option value="sin_urgencia">Sin urgencia</option></select></div>');
    const stage=document.getElementById('oppStage')?.closest('.field');
    const follow=document.getElementById('oppFollowup')?.closest('.field');
    if(stage)stage.style.display='none';
    if(follow)follow.style.display='none';
    const submit=form.querySelector('button[type="submit"]');
    if(submit){
      submit.insertAdjacentHTML('beforebegin','<div class="full" style="background:#fff8eb;border:1px solid #ecd9bb;border-radius:10px;padding:9px 11px;font-size:.67rem;color:#765f43"><b>Flujo automático:</b> el lead siempre inicia en “Lead nuevo”, se asigna a un responsable y genera la tarea obligatoria “Contactar cliente”. La etapa no se puede escoger manualmente.</div>');
      submit.textContent='＋ Crear lead e iniciar flujo';
    }
  }

  window.createOpportunity=async function(e){
    e.preventDefault();
    try{
      await window.commercialSend('POST',{
        action:'create_opportunity',
        title:document.getElementById('oppTitle').value,
        contact_name:document.getElementById('oppContactName')?.value||'',
        contact_phone:document.getElementById('oppContactPhone')?.value||'',
        contact_email:document.getElementById('oppContactEmail')?.value||'',
        value:document.getElementById('oppValue').value,
        priority:document.getElementById('oppPriority')?.value||'P2',
        product:document.getElementById('oppProduct').value,
        quantity:document.getElementById('oppQuantity')?.value||'',
        city:document.getElementById('oppCity').value,
        usage_type:document.getElementById('oppUsage')?.value||'',
        urgency:document.getElementById('oppUrgency')?.value||'',
        source:document.getElementById('oppSource').value||'Ingreso manual CRM',
        notes:document.getElementById('oppNotes').value
      });
      e.target.reset();
      if(document.getElementById('oppPriority'))document.getElementById('oppPriority').value='P2';
      window.toast?.('Lead creado · tarea obligatoria generada');
      await window.loadOpportunities?.();
      await window.loadDashboard?.();
    }catch(err){window.toast?.(err.message)}
  };

  function lockManualTaskForm(){
    const page=document.getElementById('page-tasks');
    if(!page)return;
    const form=page.querySelector('form[onsubmit*="createTask"]');
    const card=form?.closest('.module-card');
    const role=window.crmSession?.role;
    const locked=['sales','agent'].includes(role)&&!window.crmSession?.platform_admin;
    if(card){
      card.style.display=locked?'none':'';
      if(!locked&&form&&!card.querySelector('.manual-task-note')){
        const note=document.createElement('p');note.className='manual-task-note';note.textContent='Las tareas manuales son complementarias. Nunca reemplazan la tarea obligatoria del motor comercial.';
        form.before(note);
      }
    }
  }

  function init(){enhanceOpportunityForm();lockManualTaskForm()}
  const oldRender=window.renderCrmSession;
  if(oldRender){
    window.renderCrmSession=function(){
      const out=oldRender.apply(this,arguments);
      setTimeout(()=>{enhanceOpportunityForm();lockManualTaskForm()},0);
      return out;
    };
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
(() => {
  const STAGES=[
    {key:'new',label:'Lead nuevo',aliases:['new','lead_new']},
    {key:'contacting',label:'Contactando',aliases:['contacting','contacted']},
    {key:'qualification',label:'Calificación',aliases:['qualification']},
    {key:'opportunity',label:'Oportunidad',aliases:['opportunity','qualified']},
    {key:'quote',label:'Cotización',aliases:['quote','proposal']},
    {key:'follow_up',label:'Seguimiento',aliases:['follow_up']},
    {key:'negotiation',label:'Negociación',aliases:['negotiation']},
    {key:'won',label:'Ganado',aliases:['won']},
    {key:'lost',label:'Perdido',aliases:['lost']},
    {key:'future_follow_up',label:'Seguimiento futuro',aliases:['future_follow_up']}
  ];
  let opportunities=[];
  let selectedStage='new';
  let view='funnel';
  let search='';
  let priority='all';
  let queueByOpp={};

  function escp(s){return String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
  function money(v){try{return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0)}catch(_){return '$'+Number(v||0).toLocaleString('es-CO')}}
  function norm(stage){
    const s=String(stage||'new').toLowerCase();
    return STAGES.find(x=>x.aliases.includes(s))?.key||s;
  }
  function label(stage){return STAGES.find(x=>x.key===norm(stage))?.label||stage||'—'}
  function stageItems(key){
    return opportunities.filter(o=>norm(o.stage)===key)
      .filter(o=>priority==='all'||o.priority===priority)
      .filter(o=>{
        if(!search)return true;
        const q=search.toLowerCase();
        return [o.title,o.product,o.city,o.source,o.contact?.display_name].some(v=>String(v||'').toLowerCase().includes(q));
      });
  }
  function allFiltered(){
    return opportunities.filter(o=>priority==='all'||o.priority===priority).filter(o=>{
      if(!search)return true; const q=search.toLowerCase();
      return [o.title,o.product,o.city,o.source,o.contact?.display_name].some(v=>String(v||'').toLowerCase().includes(q));
    });
  }
  function widthFor(i){return Math.max(42,100-(i*6.3))}
  function stageStats(key){
    const items=stageItems(key);
    return {count:items.length,value:items.reduce((s,o)=>s+Number(o.value||0),0),items};
  }
  async function fetchQueue(){
    try{
      const r=await fetch('/api/crm-execution',{cache:'no-store'}),j=await r.json();
      if(!r.ok)return;
      queueByOpp={};
      for(const t of (j.queue||[]))if(t.opportunity_id&&!queueByOpp[t.opportunity_id])queueByOpp[t.opportunity_id]=t;
    }catch(_){}
  }

  function ensureShell(){
    const page=document.getElementById('page-cap');
    if(!page)return null;
    let shell=document.getElementById('pipelineVisualShell');
    if(shell)return shell;
    const table=page.querySelector(':scope > section.workspace');
    shell=document.createElement('div');
    shell.id='pipelineVisualShell';
    shell.className='pipeline-shell';
    shell.innerHTML=`
      <div class="pipeline-lock-note">🔒 <span><b>Flujo protegido:</b> los agentes no pueden arrastrar oportunidades ni saltar etapas. El pipeline avanza únicamente al completar la tarea obligatoria y su evidencia.</span></div>
      <div class="pipeline-tabs">
        <button class="pipeline-tab active" data-view="funnel">Embudo</button>
        <button class="pipeline-tab" data-view="kanban">Kanban</button>
        <button class="pipeline-tab" data-view="table">Tabla / CAP</button>
      </div>
      <div class="pipeline-filterbar">
        <input id="pipelineSearch" placeholder="Buscar oportunidad, producto, ciudad..." style="min-width:240px">
        <select id="pipelinePriority"><option value="all">Todas las prioridades</option><option value="P1">P1 · Alta</option><option value="P2">P2 · Media</option><option value="P3">P3 · Baja</option></select>
        <span class="pipeline-test-toggle">Los datos QA están excluidos de métricas reales</span>
      </div>
      <div class="pipeline-view active" id="pipelineViewFunnel">
        <div class="funnel-layout">
          <section class="funnel-card">
            <div class="funnel-card-head"><div><h3>Embudo comercial</h3><p>Volumen, valor y conversión por etapa.</p></div><span class="state ok">En vivo</span></div>
            <div class="funnel-stack" id="literalFunnel"></div>
          </section>
          <section class="pipeline-detail">
            <h3 id="pipelineDetailTitle">Lead nuevo</h3>
            <p id="pipelineDetailSubtitle">Oportunidades en esta etapa.</p>
            <div class="pipeline-kpis" id="pipelineDetailKpis"></div>
            <div class="pipeline-stage-list" id="pipelineStageList"></div>
          </section>
        </div>
      </div>
      <div class="pipeline-view" id="pipelineViewKanban">
        <section class="kanban-wrap"><div class="funnel-card-head"><div><h3>Kanban operativo</h3><p>Vista de consulta. Para avanzar una oportunidad, ejecuta su tarea obligatoria.</p></div></div><div class="kanban-board" id="pipelineKanban"></div></section>
      </div>
    `;
    if(table)table.before(shell);else page.appendChild(shell);

    shell.querySelectorAll('.pipeline-tab').forEach(btn=>btn.addEventListener('click',()=>setView(btn.dataset.view)));
    shell.querySelector('#pipelineSearch').addEventListener('input',e=>{search=e.target.value.trim();renderAll()});
    shell.querySelector('#pipelinePriority').addEventListener('change',e=>{priority=e.target.value;renderAll()});
    return shell;
  }

  function setView(next){
    view=next;
    const shell=ensureShell(),page=document.getElementById('page-cap'),table=page?.querySelector(':scope > section.workspace');
    shell?.querySelectorAll('.pipeline-tab').forEach(x=>x.classList.toggle('active',x.dataset.view===next));
    document.getElementById('pipelineViewFunnel')?.classList.toggle('active',next==='funnel');
    document.getElementById('pipelineViewKanban')?.classList.toggle('active',next==='kanban');
    if(table)table.style.display=next==='table'?'block':'none';
    if(next==='table')decorateCapTable();
  }

  function renderFunnel(){
    const root=document.getElementById('literalFunnel');if(!root)return;
    let prev=null;
    root.innerHTML=STAGES.map((s,i)=>{
      const stats=stageStats(s.key);
      const conversion=prev===null?100:(prev>0?Math.round((stats.count/prev)*100):0);
      const sub=(s.key==='lost'?'Salida del proceso':s.key==='future_follow_up'?'Recuperación / maduración':(i===0?'Entrada':'Conv. '+conversion+'%'));
      if(!['lost','future_follow_up'].includes(s.key))prev=stats.count;
      return `<div class="funnel-segment ${selectedStage===s.key?'active':''}" data-stage="${s.key}" style="width:${widthFor(i)}%" onclick="pipelineSelectStage('${s.key}')">
        <div><div class="stage-name">${escp(s.label)}</div><div class="stage-sub">${escp(sub)} · ${money(stats.value)}</div></div>
        <div class="stage-count"><b>${stats.count}</b><span>oportunidades</span></div>
      </div>`;
    }).join('');
  }

  function renderDetail(){
    const s=STAGES.find(x=>x.key===selectedStage)||STAGES[0],stats=stageStats(s.key),all=allFiltered();
    const totalValue=stats.value;
    const avg=stats.count?Math.round(totalValue/stats.count):0;
    document.getElementById('pipelineDetailTitle').textContent=s.label;
    document.getElementById('pipelineDetailSubtitle').textContent=stats.count+' oportunidades visibles en esta etapa.';
    document.getElementById('pipelineDetailKpis').innerHTML=`
      <div class="pipeline-kpi"><span>Oportunidades</span><b>${stats.count}</b></div>
      <div class="pipeline-kpi"><span>Valor</span><b>${money(totalValue)}</b></div>
      <div class="pipeline-kpi"><span>Ticket prom.</span><b>${money(avg)}</b></div>`;
    const list=document.getElementById('pipelineStageList');
    list.innerHTML=stats.items.length?stats.items.map(o=>{
      const task=queueByOpp[o.id];
      return `<div class="pipeline-op-card">
        <div><div class="title">${escp(o.contact?.display_name||o.title)}</div><div class="meta">${escp(o.product||'Producto por definir')} · ${escp(o.city||'Sin ciudad')}<br>${task?'Siguiente: '+escp(task.title):'Sin tarea activa'}</div></div>
        <div class="right"><div class="value">${money(o.value)}</div><span class="pipeline-priority ${String(o.priority||'P3').toLowerCase()}">${escp(o.priority||'P3')}</span>${task?`<div style="margin-top:6px"><button class="btn" onclick="openExecutionTask('${task.id}')">Ejecutar</button></div>`:''}</div>
      </div>`;
    }).join(''):'<div class="pipeline-empty">No hay oportunidades en esta etapa con los filtros actuales.</div>';
  }

  function renderKanban(){
    const root=document.getElementById('pipelineKanban');if(!root)return;
    root.innerHTML=STAGES.map(s=>{
      const items=stageItems(s.key);
      return `<div class="kanban-col"><div class="kanban-head"><span>${escp(s.label)}</span><span class="kanban-count">${items.length}</span></div>
        ${items.map(o=>{
          const task=queueByOpp[o.id];
          return `<div class="kanban-card"><div class="t">${escp(o.contact?.display_name||o.title)}</div><div class="m">${escp(o.product||'Producto por definir')}<br>${money(o.value)} · ${escp(o.priority||'P3')}${task?'<br>→ '+escp(task.title):''}</div>${task?`<button class="btn" style="width:100%;margin-top:8px" onclick="openExecutionTask('${task.id}')">Ejecutar tarea</button>`:''}</div>`;
        }).join('')||'<div class="pipeline-empty" style="padding:14px">Vacío</div>'}
      </div>`;
    }).join('');
  }

  function decorateCapTable(){
    const body=document.getElementById('capBody');if(!body)return;
    const rows=[...body.querySelectorAll('tr')];
    rows.forEach((tr,i)=>{
      const opp=opportunities[i];if(!opp)return;
      const task=queueByOpp[opp.id];
      const last=tr.lastElementChild;if(!last)return;
      const admin=window.crmSession?.platform_admin||['owner','admin'].includes(window.crmSession?.role);
      if(task){
        last.innerHTML=`<div class="inline-actions"><button class="btn primary" onclick="openExecutionTask('${task.id}')">Ejecutar siguiente</button>${admin?'<button class="btn" onclick="editCap(\''+opp.id+'\')">Corregir CAP</button>':''}</div>`;
      }else if(!admin){
        last.innerHTML='<span class="state off">Sin acción manual</span>';
      }
    });
  }

  function renderAll(){
    renderFunnel();renderDetail();renderKanban();if(view==='table')decorateCapTable();
  }

  window.pipelineSelectStage=function(stage){selectedStage=stage;renderAll()};

  async function loadPipelineVisual(){
    ensureShell();
    try{
      const [j]=await Promise.all([
        window.commercialGet?window.commercialGet('opportunities'):fetch('/api/crm-commercial?type=opportunities',{cache:'no-store'}).then(r=>r.json()),
        fetchQueue()
      ]);
      opportunities=j.opportunities||[];
      if(!stageItems(selectedStage).length){
        const first=STAGES.find(s=>stageItems(s.key).length);
        if(first)selectedStage=first.key;
      }
      renderAll();
      setView(view);
    }catch(err){
      const root=document.getElementById('literalFunnel');if(root)root.innerHTML='<div class="pipeline-empty">No fue posible cargar el embudo.</div>';
    }
  }
  window.loadPipelineVisual=loadPipelineVisual;

  const originalLoadCap=window.loadCap;
  if(originalLoadCap){
    window.loadCap=async function(...args){
      await originalLoadCap.apply(this,args);
      await loadPipelineVisual();
    };
  }
  const originalLoadOpp=window.loadOpportunities;
  if(originalLoadOpp){
    window.loadOpportunities=async function(...args){
      const out=await originalLoadOpp.apply(this,args);
      if(window.currentPage==='cap')await loadPipelineVisual();
      return out;
    };
  }

  function init(){
    ensureShell();
    const page=document.getElementById('page-cap');
    const table=page?.querySelector(':scope > section.workspace');
    if(table)table.style.display='none';
    if(window.currentPage==='cap')loadPipelineVisual();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
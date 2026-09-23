(() => {
  const STAGES=[
    {key:'new',label:'Nuevo',aliases:['new','lead_new']},
    {key:'contacting',label:'Contacto',aliases:['contacting','contacted']},
    {key:'opportunity',label:'Calificado',aliases:['qualification','opportunity','qualified']},
    {key:'quote',label:'Oferta',aliases:['quote','proposal']},
    {key:'follow_up',label:'Seguimiento',aliases:['follow_up','future_follow_up']},
    {key:'negotiation',label:'Negociación',aliases:['negotiation']},
    {key:'won',label:'Ganado',aliases:['won']}
  ];
  let opportunities=[],history=[],tasks=[],taskByOpp={};
  let selectedStage='new',selectedOppId=null,view='funnel';
  let filters={period:'30',priority:'all',source:'all',product:'all',search:''};

  function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function money(v){try{return new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)||0)}catch(_){return '$'+Number(v||0).toLocaleString('es-CO')}}
  function norm(stage){
    const s=String(stage||'new').toLowerCase();
    if(s==='lost')return 'lost';
    return STAGES.find(x=>x.aliases.includes(s))?.key||s;
  }
  function stageIndex(stage){return STAGES.findIndex(x=>x.key===norm(stage))}
  function stageLabel(key){return STAGES.find(x=>x.key===key)?.label||key||'—'}
  function capOf(o){return Array.isArray(o?.cap)?o.cap[0]:(o?.cap||{})}
  function daysBetween(a,b){const ms=new Date(b)-new Date(a);return Number.isFinite(ms)?Math.max(0,ms/86400000):0}
  function humanDuration(days){
    if(!Number.isFinite(days)||days<=0)return '—';
    if(days<1)return Math.max(1,Math.round(days*24))+' h';
    if(days<7)return days.toFixed(days<2?1:0)+' d';
    return Math.round(days/7)+' sem';
  }
  function rel(v){
    if(!v)return 'Sin fecha';
    const d=new Date(v),diff=d-Date.now(),mins=Math.round(Math.abs(diff)/60000);
    if(diff<0)return mins<60?'Vencida hace '+mins+' min':'Vencida';
    if(mins<60)return 'En '+mins+' min';
    if(mins<1440)return 'En '+Math.round(mins/60)+' h';
    return d.toLocaleDateString('es-CO',{day:'2-digit',month:'short'});
  }
  function isOverdue(task){return !!(task?.due_at&&new Date(task.due_at)<new Date())}

  function historyFor(id){return history.filter(h=>h.opportunity_id===id)}
  function maxReachedIndex(o){
    let max=stageIndex(o.stage);
    for(const h of historyFor(o.id)){
      max=Math.max(max,stageIndex(h.from_stage),stageIndex(h.to_stage));
    }
    if(norm(o.stage)==='won'||o.status==='won')max=STAGES.length-1;
    return Math.max(0,max);
  }
  function enteredAt(o,key){
    const rows=historyFor(o.id).filter(h=>norm(h.to_stage)===key).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    if(rows[0])return rows[0].created_at;
    if(key==='new')return o.created_at;
    if(norm(o.stage)===key)return o.updated_at||o.created_at;
    return null;
  }

  function periodStart(){
    const n=Number(filters.period);
    if(!n)return null;
    return new Date(Date.now()-n*86400000);
  }
  function cohort(){
    const start=periodStart();
    return opportunities.filter(o=>{
      if(start&&new Date(o.created_at)<start)return false;
      if(filters.priority!=='all'&&o.priority!==filters.priority)return false;
      if(filters.source!=='all'&&String(o.source||'')!==filters.source)return false;
      if(filters.product!=='all'&&String(o.product||'')!==filters.product)return false;
      if(filters.search){
        const q=filters.search.toLowerCase();
        if(![o.title,o.product,o.city,o.source,o.contact?.display_name,o.contact?.phone].some(v=>String(v||'').toLowerCase().includes(q)))return false;
      }
      return true;
    });
  }
  function currentItems(key){
    return cohort().filter(o=>norm(o.stage)===key);
  }
  function reachedCount(key){
    const idx=STAGES.findIndex(s=>s.key===key);
    return cohort().filter(o=>maxReachedIndex(o)>=idx).length;
  }
  function conversionFor(key){
    const idx=STAGES.findIndex(s=>s.key===key);
    if(idx<=0)return 100;
    const prev=reachedCount(STAGES[idx-1].key),cur=reachedCount(key);
    return prev?Math.round((cur/prev)*100):0;
  }
  function stageAge(key){
    const items=currentItems(key),now=new Date();
    const vals=items.map(o=>enteredAt(o,key)).filter(Boolean).map(v=>daysBetween(v,now));
    return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
  }
  function stageStats(key){
    const items=currentItems(key),ids=new Set(items.map(o=>o.id));
    const stageTasks=tasks.filter(t=>ids.has(t.opportunity_id));
    return {
      items,
      count:items.length,
      value:items.reduce((s,o)=>s+Number(o.value||0),0),
      reached:reachedCount(key),
      conversion:conversionFor(key),
      avgAge:stageAge(key),
      overdue:stageTasks.filter(isOverdue).length,
      tasks:stageTasks
    };
  }
  function overallMetrics(){
    const rows=cohort(),open=rows.filter(o=>o.status==='open'&&!['won','lost'].includes(norm(o.stage)));
    const won=rows.filter(o=>o.status==='won'||norm(o.stage)==='won');
    const lost=rows.filter(o=>o.status==='lost'||norm(o.stage)==='lost');
    const closeDays=won.map(o=>{
      const wonHist=historyFor(o.id).filter(h=>norm(h.to_stage)==='won').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
      const end=o.closed_at||wonHist?.created_at||o.updated_at;
      return o.created_at&&end?daysBetween(o.created_at,end):0;
    }).filter(x=>x>0);
    const avgClose=closeDays.length?closeDays.reduce((a,b)=>a+b,0)/closeDays.length:0;
    const denom=won.length+lost.length;
    const closeRate=denom?Math.round(won.length/denom*100):(rows.length?Math.round(won.length/rows.length*100):0);
    const ids=new Set(open.map(o=>o.id));
    const overdue=tasks.filter(t=>ids.has(t.opportunity_id)&&isOverdue(t)).length;
    return {rows,open,won,lost,pipelineValue:open.reduce((s,o)=>s+Number(o.value||0),0),avgClose,closeRate,overdue};
  }
  function taskMap(){
    taskByOpp={};
    for(const t of tasks){
      if(!t.opportunity_id)continue;
      if(!taskByOpp[t.opportunity_id]||new Date(t.due_at||'9999-01-01')<new Date(taskByOpp[t.opportunity_id].due_at||'9999-01-01'))taskByOpp[t.opportunity_id]=t;
    }
  }

  function ensureShell(){
    const page=document.getElementById('page-cap');if(!page)return null;
    let shell=document.getElementById('pipelineVisualShell');if(shell)return shell;
    const table=page.querySelector(':scope > section.workspace');
    shell=document.createElement('div');shell.id='pipelineVisualShell';shell.className='pipeline-shell';
    shell.innerHTML=`
      <div class="pipeline-lock-note">🔒 <span><b>Embudo protegido:</b> las etapas no se arrastran manualmente. El avance ocurre al completar la acción obligatoria y dejar evidencia.</span></div>
      <div class="pipeline-toolbar">
        <div class="pipeline-tabs">
          <button class="pipeline-tab active" data-view="funnel">Infografía</button>
          <button class="pipeline-tab" data-view="kanban">Kanban</button>
          <button class="pipeline-tab" data-view="table">Tabla / CAP</button>
        </div>
        <div class="pipeline-filterbar">
          <select id="pipelinePeriod"><option value="7">7 días</option><option value="30" selected>30 días</option><option value="90">90 días</option><option value="0">Todo</option></select>
          <select id="pipelineSource"><option value="all">Todos los orígenes</option></select>
          <select id="pipelineProduct"><option value="all">Todos los productos</option></select>
          <select id="pipelinePriority"><option value="all">Todas las prioridades</option><option value="P1">P1 · Alta</option><option value="P2">P2 · Media</option><option value="P3">P3 · Baja</option></select>
          <input id="pipelineSearch" placeholder="Buscar lead...">
          <span class="pipeline-qa-note">QA excluido</span>
        </div>
      </div>

      <div class="pipeline-view active" id="pipelineViewFunnel">
        <div class="pipeline-kpi-strip" id="pipelineKpis"></div>
        <div class="pipeline-hero-grid">
          <section class="pipeline-card">
            <div class="pipeline-card-head"><div><h3>Recorrido del embudo</h3><p>Volumen actual + retención histórica del periodo seleccionado.</p></div><span class="pipeline-live">● EN VIVO</span></div>
            <div class="pipeline-funnel" id="pipelineFunnel"></div>
            <div class="pipeline-funnel-foot" id="pipelineFunnelFoot"></div>
          </section>
          <section class="pipeline-card">
            <div class="pipeline-card-head"><div><h3>Lo que necesita atención</h3><p>El sistema prioriza bloqueos y fugas visibles.</p></div></div>
            <div class="pipeline-insights" id="pipelineInsights"></div>
          </section>
        </div>
        <div class="pipeline-stage-grid" id="pipelineStageGrid"></div>
        <div class="pipeline-detail">
          <section class="pipeline-detail-main">
            <div class="pipeline-detail-head"><div><h3 id="pipelineDetailTitle">Nuevo</h3><p id="pipelineDetailSubtitle"></p></div></div>
            <div class="pipeline-detail-kpis" id="pipelineDetailKpis"></div>
            <div class="pipeline-stage-list" id="pipelineStageList"></div>
          </section>
          <aside class="pipeline-cap-panel" id="pipelineCapPanel"></aside>
        </div>
      </div>

      <div class="pipeline-view" id="pipelineViewKanban">
        <section class="kanban-wrap"><div class="pipeline-card-head"><div><h3>Kanban operativo</h3><p>Consulta por etapa. Para mover un lead debes ejecutar su siguiente acción.</p></div></div><div class="kanban-board" id="pipelineKanban"></div></section>
      </div>
    `;
    if(table)table.before(shell);else page.appendChild(shell);

    shell.querySelectorAll('.pipeline-tab').forEach(btn=>btn.addEventListener('click',()=>setView(btn.dataset.view)));
    shell.querySelector('#pipelinePeriod').addEventListener('change',e=>{filters.period=e.target.value;renderAll()});
    shell.querySelector('#pipelineSource').addEventListener('change',e=>{filters.source=e.target.value;renderAll()});
    shell.querySelector('#pipelineProduct').addEventListener('change',e=>{filters.product=e.target.value;renderAll()});
    shell.querySelector('#pipelinePriority').addEventListener('change',e=>{filters.priority=e.target.value;renderAll()});
    shell.querySelector('#pipelineSearch').addEventListener('input',e=>{filters.search=e.target.value.trim();renderAll()});
    return shell;
  }

  function populateFilters(){
    const source=document.getElementById('pipelineSource'),product=document.getElementById('pipelineProduct');if(!source||!product)return;
    const sources=[...new Set(opportunities.map(o=>String(o.source||'').trim()).filter(Boolean))].sort();
    const products=[...new Set(opportunities.map(o=>String(o.product||'').trim()).filter(Boolean))].sort();
    const sv=filters.source,pv=filters.product;
    source.innerHTML='<option value="all">Todos los orígenes</option>'+sources.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
    product.innerHTML='<option value="all">Todos los productos</option>'+products.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
    source.value=sources.includes(sv)?sv:'all';product.value=products.includes(pv)?pv:'all';filters.source=source.value;filters.product=product.value;
  }

  function setView(next){
    view=next;const shell=ensureShell(),page=document.getElementById('page-cap'),table=page?.querySelector(':scope > section.workspace');
    shell?.querySelectorAll('.pipeline-tab').forEach(x=>x.classList.toggle('active',x.dataset.view===next));
    document.getElementById('pipelineViewFunnel')?.classList.toggle('active',next==='funnel');
    document.getElementById('pipelineViewKanban')?.classList.toggle('active',next==='kanban');
    if(table)table.style.display=next==='table'?'block':'none';
    if(next==='table')decorateCapTable();
  }

  function renderKpis(){
    const m=overallMetrics(),root=document.getElementById('pipelineKpis');if(!root)return;
    root.innerHTML=`
      <div class="pipeline-kpi-card"><div class="k">Oportunidades activas</div><div class="v">${m.open.length}</div><div class="s">${m.rows.length} oportunidades en el periodo</div></div>
      <div class="pipeline-kpi-card"><div class="k">Valor en pipeline</div><div class="v">${money(m.pipelineValue)}</div><div class="s">Valor abierto estimado</div></div>
      <div class="pipeline-kpi-card good"><div class="k">Conversión a venta</div><div class="v">${m.closeRate}%</div><div class="s">Ganados sobre cierres registrados</div></div>
      <div class="pipeline-kpi-card ${m.overdue?'warn':''}"><div class="k">Tiempo / alertas</div><div class="v">${humanDuration(m.avgClose)}</div><div class="s">${m.overdue} tareas vencidas · promedio de cierre</div></div>`;
  }

  function funnelWidth(key){
    const base=reachedCount('new'),cur=reachedCount(key);
    const idx=STAGES.findIndex(s=>s.key===key);
    if(!base)return Math.max(42,100-idx*8);
    return Math.max(38,Math.round((cur/base)*100));
  }
  function renderFunnel(){
    const root=document.getElementById('pipelineFunnel');if(!root)return;
    const chunks=[];
    STAGES.forEach((s,i)=>{
      const st=stageStats(s.key),width=funnelWidth(s.key);
      chunks.push(`<div class="pipeline-funnel-stage ${selectedStage===s.key?'active':''}" data-stage="${s.key}" style="width:${width}%" onclick="pipelineSelectStage('${s.key}')">
        <div><div class="stage-k">Etapa ${i+1}</div><div class="stage-name">${esc(s.label)}</div><div class="stage-sub">${money(st.value)} · ${humanDuration(st.avgAge)} promedio actual</div></div>
        <div class="stage-right"><b>${st.count}</b><span>${st.reached} llegaron · ${st.conversion}% avance</span></div>
      </div>`);
      if(i<STAGES.length-1){
        const next=STAGES[i+1],conv=conversionFor(next.key);
        chunks.push(`<div class="pipeline-funnel-connector"><span>↓ ${conv}% llegó a ${esc(next.label)}</span></div>`);
      }
    });
    root.innerHTML=chunks.join('');
    const m=overallMetrics(),foot=document.getElementById('pipelineFunnelFoot');
    if(foot)foot.innerHTML=`<span><b>${m.lost.length}</b> oportunidades cerradas como perdidas</span><span><b>${m.won.length}</b> ventas ganadas</span><span>Retención calculada con historial real de etapas</span>`;
  }

  function bottleneck(){
    const candidates=STAGES.filter(s=>!['new','won'].includes(s.key)).map(s=>{
      const st=stageStats(s.key);return {stage:s,stats:st,score:st.count+(st.overdue*2)+(st.avgAge>3?2:0)};
    }).sort((a,b)=>b.score-a.score);
    return candidates[0]||null;
  }
  function biggestDrop(){
    let best=null;
    for(let i=1;i<STAGES.length;i++){
      const prev=reachedCount(STAGES[i-1].key),cur=reachedCount(STAGES[i].key);
      if(prev<2)continue;
      const conv=Math.round(cur/prev*100),drop=100-conv;
      if(!best||drop>best.drop)best={stage:STAGES[i],conv,drop};
    }
    return best;
  }
  function renderInsights(){
    const root=document.getElementById('pipelineInsights');if(!root)return;
    const m=overallMetrics(),ids=new Set(m.open.map(o=>o.id)),noTask=m.open.filter(o=>!taskByOpp[o.id]),p1=m.open.filter(o=>o.priority==='P1');
    const bn=bottleneck(),drop=biggestDrop(),items=[];
    if(m.overdue)items.push({type:'bad',icon:'!',title:m.overdue+' tareas vencidas',text:'Hay acciones comerciales fuera de SLA que necesitan ejecución.',stage:bn?.stage?.key||'contacting'});
    if(drop&&drop.drop>=25)items.push({type:'warn',icon:'↘',title:'Mayor fuga: '+drop.stage.label,text:'Solo '+drop.conv+'% de quienes alcanzaron la etapa anterior llegaron aquí.',stage:drop.stage.key});
    if(bn&&bn.stats.count)items.push({type:'warn',icon:'≈',title:'Acumulación en '+bn.stage.label,text:bn.stats.count+' oportunidades · '+humanDuration(bn.stats.avgAge)+' de permanencia promedio.',stage:bn.stage.key});
    if(noTask.length)items.push({type:'bad',icon:'○',title:noTask.length+' oportunidades sin tarea activa',text:'Un lead abierto no debería quedar sin próxima acción.',stage:norm(noTask[0]?.stage)||'new'});
    if(p1.length)items.push({type:'warn',icon:'↑',title:p1.length+' oportunidades P1 activas',text:'Prioridad alta dentro del pipeline actual.',stage:norm(p1[0]?.stage)||'new'});
    if(!items.length)items.push({type:'good',icon:'✓',title:'Sin bloqueos críticos visibles',text:'No hay vencidos ni oportunidades abiertas sin siguiente acción.',stage:selectedStage});
    root.innerHTML=items.slice(0,4).map(x=>`<div class="pipeline-insight ${x.type}"><span class="icon">${x.icon}</span><div><b>${esc(x.title)}</b><p>${esc(x.text)}</p></div><button type="button" onclick="pipelineSelectStage('${x.stage}')">Ver →</button></div>`).join('');
  }

  function stageFlag(st,key){
    if(st.overdue)return {label:st.overdue+' vencidas',cls:'bad'};
    if(st.avgAge>3&&key!=='won')return {label:'Demora '+humanDuration(st.avgAge),cls:'warn'};
    if(key==='won'&&st.count)return {label:'Cierres',cls:'good'};
    return {label:st.count?'Operando':'Sin acumulación',cls:st.count?'':'good'};
  }
  function renderStageGrid(){
    const root=document.getElementById('pipelineStageGrid');if(!root)return;
    const base=Math.max(1,reachedCount('new'));
    root.innerHTML=STAGES.map(s=>{
      const st=stageStats(s.key),flag=stageFlag(st,s.key),pct=Math.min(100,Math.round(st.reached/base*100));
      return `<div class="pipeline-stage-card ${selectedStage===s.key?'active':''}" onclick="pipelineSelectStage('${s.key}')">
        <div class="top"><div class="name">${esc(s.label)}</div><div class="count">${st.count}</div></div>
        <div class="metric"><b>${money(st.value)}</b><br>${st.conversion}% avance · ${humanDuration(st.avgAge)} prom.</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <span class="flag ${flag.cls}">${esc(flag.label)}</span>
      </div>`;
    }).join('');
  }

  function openExecution(taskId){
    if(!taskId)return;
    window.showPage?.('dashboard');
    setTimeout(()=>window.loadSalesOS?.(taskId),80);
  }
  window.openPipelineExecution=openExecution;

  function selectOpportunity(id){selectedOppId=id;renderDetail();renderCapPanel()}
  window.pipelineSelectOpportunity=selectOpportunity;

  function renderDetail(){
    const s=STAGES.find(x=>x.key===selectedStage)||STAGES[0],st=stageStats(s.key);
    if(!st.items.some(o=>o.id===selectedOppId))selectedOppId=st.items[0]?.id||null;
    const title=document.getElementById('pipelineDetailTitle'),sub=document.getElementById('pipelineDetailSubtitle'),k=document.getElementById('pipelineDetailKpis'),list=document.getElementById('pipelineStageList');
    if(title)title.textContent=s.label;
    if(sub)sub.textContent=st.count+' oportunidades actualmente en esta etapa.';
    if(k)k.innerHTML=`
      <div class="pipeline-mini-kpi"><span>Oportunidades</span><b>${st.count}</b></div>
      <div class="pipeline-mini-kpi"><span>Valor</span><b>${money(st.value)}</b></div>
      <div class="pipeline-mini-kpi"><span>Avance</span><b>${st.conversion}%</b></div>
      <div class="pipeline-mini-kpi"><span>Permanencia</span><b>${humanDuration(st.avgAge)}</b></div>`;
    if(!list)return;
    list.innerHTML=st.items.length?st.items.map(o=>{
      const t=taskByOpp[o.id],over=isOverdue(t),name=o.contact?.display_name||o.title||'Oportunidad';
      return `<div class="pipeline-op-card ${over?'overdue':''}" onclick="pipelineSelectOpportunity('${o.id}')">
        <div><div class="title">${esc(name)}</div><div class="meta">${esc(o.product||'Producto por definir')} · ${esc(o.city||'Sin ciudad')} · ${esc(o.source||'Sin origen')}<br>${t?'Próxima: '+esc(t.title)+' · '+esc(rel(t.due_at)):'Sin tarea activa'}</div></div>
        <div class="right"><div class="value">${money(o.value)}</div><span class="pipeline-priority ${String(o.priority||'P3').toLowerCase()}">${esc(o.priority||'P3')}</span>${t?`<br><button class="action" onclick="event.stopPropagation();openPipelineExecution('${t.id}')">▶ Ejecutar</button>`:''}</div>
      </div>`;
    }).join(''):'<div class="pipeline-empty">No hay oportunidades en esta etapa con los filtros actuales.</div>';
  }

  function renderCapPanel(){
    const root=document.getElementById('pipelineCapPanel');if(!root)return;
    const o=cohort().find(x=>x.id===selectedOppId);
    if(!o){root.innerHTML='<h3>Detalle CAP</h3><p>Selecciona una oportunidad para ver su estado operativo.</p><div class="pipeline-empty">Sin oportunidad seleccionada.</div>';return}
    const cap=capOf(o),idx=maxReachedIndex(o),task=taskByOpp[o.id];
    root.innerHTML=`<h3>Estado operativo CAP</h3><p>${esc(o.contact?.display_name||o.title||'Oportunidad')} · recorrido protegido</p>
      <div class="cap-timeline">${STAGES.map((s,i)=>`<span class="cap-node ${i<idx?'done':i===idx?'current':''}" title="${esc(s.label)}">${i<idx?'✓':i+1}</span>${i<STAGES.length-1?'<span class="cap-line"></span>':''}`).join('')}</div>
      <div class="cap-info">
        <div class="cap-info-row"><span>Decisión actual</span><b>${esc(cap.decision||cap.label||'Sin decisión registrada')}</b></div>
        <div class="cap-info-row"><span>Próxima acción</span><b>${esc(task?.title||cap.next_action||'Sin tarea activa')}</b></div>
        <div class="cap-info-row"><span>Fecha / SLA</span><b>${esc(task?.due_at?rel(task.due_at):(cap.next_action_at?rel(cap.next_action_at):'Sin fecha'))}</b></div>
        <div class="cap-info-row"><span>Secuencia</span><b>${Number(cap.sequence||task?.sequence||0)}</b></div>
        <div class="cap-info-row"><span>Prioridad</span><b>${esc(o.priority||'P3')}</b></div>
      </div>
      ${task?`<button class="action" style="width:100%;margin-top:10px" onclick="openPipelineExecution('${task.id}')">▶ Abrir en Ejecución</button>`:''}`;
  }

  function renderKanban(){
    const root=document.getElementById('pipelineKanban');if(!root)return;
    root.innerHTML=STAGES.map(s=>{
      const items=currentItems(s.key);
      return `<div class="kanban-col"><div class="kanban-head"><span>${esc(s.label)}</span><span class="kanban-count">${items.length}</span></div>
        ${items.map(o=>{const t=taskByOpp[o.id];return `<div class="kanban-card"><div class="t">${esc(o.contact?.display_name||o.title)}</div><div class="m">${esc(o.product||'Producto por definir')}<br>${money(o.value)} · ${esc(o.priority||'P3')}${t?'<br>→ '+esc(t.title)+' · '+esc(rel(t.due_at)):''}</div>${t?`<button class="action" style="width:100%;margin-top:7px" onclick="openPipelineExecution('${t.id}')">Ejecutar</button>`:''}</div>`}).join('')||'<div class="pipeline-empty" style="padding:13px">Vacío</div>'}
      </div>`;
    }).join('');
  }

  function decorateCapTable(){
    const body=document.getElementById('capBody');if(!body)return;
    [...body.querySelectorAll('tr')].forEach((tr,i)=>{
      const opp=opportunities[i];if(!opp)return;
      const task=taskByOpp[opp.id],last=tr.lastElementChild;if(!last)return;
      const admin=window.crmSession?.platform_admin||['owner','admin'].includes(window.crmSession?.role);
      if(task)last.innerHTML=`<div class="inline-actions"><button class="btn primary" onclick="openPipelineExecution('${task.id}')">Ejecutar siguiente</button>${admin?'<button class="btn" onclick="editCap(\''+opp.id+'\')">Corregir CAP</button>':''}</div>`;
      else if(!admin)last.innerHTML='<span class="state off">Sin acción manual</span>';
    });
  }

  function renderAll(){
    taskMap();
    const available=STAGES.find(s=>currentItems(s.key).length);
    if(!currentItems(selectedStage).length&&available)selectedStage=available.key;
    renderKpis();renderFunnel();renderInsights();renderStageGrid();renderDetail();renderCapPanel();renderKanban();
    if(view==='table')decorateCapTable();
  }
  window.pipelineSelectStage=function(stage){selectedStage=stage;selectedOppId=null;renderAll()};

  async function loadPipelineVisual(){
    ensureShell();
    try{
      const [opps,insights]=await Promise.all([
        window.commercialGet?window.commercialGet('opportunities'):fetch('/api/crm-commercial?type=opportunities',{cache:'no-store'}).then(r=>r.json()),
        window.commercialGet?window.commercialGet('pipeline_insights'):fetch('/api/crm-commercial?type=pipeline_insights',{cache:'no-store'}).then(r=>r.json())
      ]);
      opportunities=opps.opportunities||[];
      history=insights.stage_history||[];
      tasks=insights.open_tasks||[];
      populateFilters();renderAll();setView(view);
    }catch(err){
      const root=document.getElementById('pipelineFunnel');if(root)root.innerHTML='<div class="pipeline-empty">No fue posible cargar la analítica del embudo.</div>';
    }
  }
  window.loadPipelineVisual=loadPipelineVisual;

  const originalLoadCap=window.loadCap;
  if(originalLoadCap)window.loadCap=async function(...args){await originalLoadCap.apply(this,args);await loadPipelineVisual()};
  const originalLoadOpp=window.loadOpportunities;
  if(originalLoadOpp)window.loadOpportunities=async function(...args){const out=await originalLoadOpp.apply(this,args);if(window.currentPage==='cap')await loadPipelineVisual();return out};

  function init(){
    const page=document.getElementById('page-cap');
    if(page){
      const head=page.querySelector('.page-head');
      const eye=head?.querySelector('.eyebrow'),h=head?.querySelector('h1'),p=head?.querySelector('p');
      if(eye)eye.textContent='Inteligencia comercial';
      if(h)h.textContent='Embudo comercial';
      if(p)p.textContent='Visualiza cómo avanzan las oportunidades, detecta fugas y abre la siguiente acción desde el mismo flujo.';
      const table=page.querySelector(':scope > section.workspace');if(table)table.style.display='none';
    }
    ensureShell();
    if(window.currentPage==='cap')loadPipelineVisual();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
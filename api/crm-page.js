module.exports=async function handler(req,res){
  try{
    const proto=(req.headers['x-forwarded-proto']||'https').split(',')[0];
    const host=req.headers.host;
    const r=await fetch(`${proto}://${host}/crm-v3.html`);
    if(!r.ok)return res.status(r.status).send('CRM unavailable');
    let html=await r.text();
    html=html.replace('</head>','<link rel="stylesheet" href="/integrations-ui.css?v=20260922-2">\n<link rel="stylesheet" href="/crm-execution-ui.css?v=20260922-2">\n<link rel="stylesheet" href="/crm-visual-refresh.css?v=20260922-1">\n<link rel="stylesheet" href="/crm-pipeline-ui.css?v=20260922-1">\n<link rel="stylesheet" href="/crm-qa-simulator.css?v=20260922-1">\n</head>');
    html=html.replace('</body>','<script src="/crm-execution-ui.js?v=20260922-3"></script>\n<script src="/crm-pipeline-ui.js?v=20260922-1"></script>\n<script src="/crm-guided-ui.js?v=20260922-1"></script>\n<script src="/crm-qa-simulator.js?v=20260922-2"></script>\n<script src="/crm-meta-sync-ui.js?v=20260922-1"></script>\n</body>');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    return res.status(200).send(html);
  }catch(e){
    console.error('CRM_PAGE_ERROR',e.message);
    return res.status(500).send('CRM unavailable');
  }
};
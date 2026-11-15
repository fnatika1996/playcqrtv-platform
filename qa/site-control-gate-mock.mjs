import http from "node:http";

const settings = {
  mode: "coming_soon",
  heading: "CQRTV скоро откроется",
  subtitle: "Новая платформа для игроков Counter-Strike 2",
  description: "Игроки, команды, матчи, турниры, статистика и развитие esports-сцены.",
  statusLabel: "ПЛАТФОРМА ГОТОВИТСЯ",
  maintenanceHeading: "CQRTV на обслуживании",
  maintenanceSubtitle: "Скоро вернёмся",
  maintenanceDescription: "Выполняются плановые технические работы.",
  maintenanceStatusLabel: "ТЕХНИЧЕСКИЕ РАБОТЫ",
  launchAt: "2026-12-01T18:00:00.000Z",
  countdownEnabled: true,
  aboutButtonLabel: "Что такое CQRTV?",
  aboutTitle: "Играй. Объединяйся. Развивайся.",
  aboutBody: "CQRTV — будущая платформа Counter-Strike 2 для игроков и команд.",
  animationEnabled: true,
  backgroundAssetId: null,
  socialLinks: [{id:"qa",label:"Telegram QA",url:"https://t.me/cqrtv",iconKey:"chat",iconAssetId:null}]
};
http.createServer((req,res)=>{
  if(req.url==="/api/site-control/gate"){
    const uri=String(req.headers["x-forwarded-uri"]||"");
    const adminPath=["/admin","/admin.html","/admin/site-control","/site-control-admin.html"].includes(uri);
    const admin=adminPath||req.headers["x-qa-admin-preview"]==="yes";
    const mode=["coming_soon","maintenance"].includes(req.headers["x-qa-site-mode"])?req.headers["x-qa-site-mode"]:"open";
    res.writeHead(204,{"Cache-Control":"no-store","X-CQRTV-Site-Mode":admin?"admin-preview":mode});return res.end();
  }
  if(req.url==="/api/site-control/public"){
    const mode=["coming_soon","maintenance"].includes(req.headers["x-qa-site-mode"])?req.headers["x-qa-site-mode"]:"coming_soon";
    res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
    return res.end(JSON.stringify({...settings,mode}));
  }
  if(req.url?.startsWith("/api/site-control/media/")){res.writeHead(404);return res.end();}
  res.writeHead(404,{"Content-Type":"application/json"});res.end('{"error":"QA mock only"}');
}).listen(3000,"0.0.0.0");

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
const modeFor=req=>["coming_soon","maintenance"].includes(req.headers["x-qa-site-mode"])?req.headers["x-qa-site-mode"]:"open";
const validAdmin=req=>(req.headers.cookie||"").split(";").some(cookie=>cookie.trim()==="cqrtv_qa_admin=valid");
const json=(res,status,value)=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(value));};
http.createServer((req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if(url.pathname==="/api/site-control/gate"){
    const uri=String(req.headers["x-forwarded-uri"]||"").split("?")[0];
    const adminPath=["/admin","/admin.html","/admin/site-control","/site-control-admin.html"].includes(uri);
    const admin=validAdmin(req);
    if(adminPath&&!admin){res.writeHead(401,{"Cache-Control":"no-store"});return res.end('{"error":"admin session required"}');}
    const mode=modeFor(req);
    res.writeHead(204,{"Cache-Control":"no-store","X-CQRTV-Site-Mode":admin?"admin-preview":mode});return res.end();
  }
  if(url.pathname==="/api/site-control/public"){
    const mode=modeFor(req)||"coming_soon";
    return json(res,200,{...settings,mode});
  }
  if(url.pathname.startsWith("/api/site-control/media/")){
    const pixel=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZcAAAAASUVORK5CYII=","base64");
    res.writeHead(200,{"Content-Type":"image/png","Content-Length":pixel.length,"Cache-Control":"no-store"});return res.end(pixel);
  }
  if(url.pathname==="/api/auth/me"||url.pathname==="/api/auth/register"){
    const mode=modeFor(req);
    if(mode!=="open")return json(res,503,{error:"platform closed"});
    return json(res,200,{user:null});
  }
  if(url.pathname==="/api/admin/login"){
    if(req.headers["x-qa-db-down"]==="yes")return json(res,503,{error:"database unavailable"});
    let body="";for await(const chunk of req)body+=chunk;
    let credentials={};try{credentials=JSON.parse(body)}catch{}
    if(credentials.email==="qa-admin@example.test"&&credentials.password==="qa-only-password"){
      res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Set-Cookie":"cqrtv_qa_admin=valid; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600"});
      return res.end(JSON.stringify({message:"QA login succeeded"}));
    }
    return json(res,401,{error:"Неверный email или пароль."});
  }
  res.writeHead(404,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end('{"error":"QA mock only"}');
}).listen(3000,"0.0.0.0");

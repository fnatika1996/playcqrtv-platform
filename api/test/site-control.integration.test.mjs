import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";

const connectionString = process.env.ADMIN_TEST_DATABASE_URL;
if (connectionString && !decodeURIComponent(new URL(connectionString).pathname).toLowerCase().includes("test")) {
  throw new Error("ADMIN_TEST_DATABASE_URL must point to a database whose name includes 'test'.");
}

test("site control protects public routes, persists settings and allows authenticated admin preview", { skip: !connectionString }, async t => {
  const { Pool } = await import("pg");
  const basePool = new Pool({ connectionString, max: 2 });
  const schema = "site_control_test_" + crypto.randomBytes(6).toString("hex");
  await basePool.query(`CREATE SCHEMA ${schema}`);
  const scopedUrl = new URL(connectionString);
  scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = scopedUrl.toString();
  process.env.APP_ORIGIN = "http://site-control.test";
  process.env.NODE_ENV = "test";
  const app = await import("../server.mjs");
  await app.init();
  const server = app.createHttpServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await basePool.query(`DROP SCHEMA ${schema} CASCADE`);await basePool.end()});
  const origin = process.env.APP_ORIGIN;
  const password = "AdminPass123!";
  const salt = crypto.randomBytes(16);
  const key = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, { N:32768,r:8,p:1,maxmem:64*1024*1024 }, (e,v)=>e?reject(e):resolve(v)));
  const encoded = `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
  await app.pool.query("INSERT INTO users(nickname,email,password_hash,country,primary_role,email_verified,is_admin) VALUES('site-admin','site-admin@example.test',$1,'US','igl',true,true)", [encoded]);

  async function request(path, { method="GET", body, cookie="", csrf="", headers={} }={}) {
    const requestHeaders = { Origin:origin, ...headers };
    if(cookie) requestHeaders.Cookie = cookie;
    if(csrf) requestHeaders["X-CSRF-Token"] = csrf;
    if(body!==undefined) requestHeaders["Content-Type"]="application/json";
    const response=await fetch(base+path,{method,headers:requestHeaders,body:body===undefined?undefined:JSON.stringify(body)});
    let data={};try{data=await response.json()}catch{}
    return {response,data};
  }

  const login=await request("/api/admin/login",{method:"POST",body:{email:"site-admin@example.test",password}});
  assert.equal(login.response.status,200);
  const cookie=login.response.headers.get("set-cookie").split(";")[0];
  const csrf=login.data.csrfToken;

  let result=await request("/api/admin/site-control");
  assert.equal(result.response.status,401);
  result=await request("/api/admin/site-control",{cookie});
  assert.equal(result.response.status,200);
  assert.equal(result.data.settings.mode,"open");
  assert.match(result.data.settings.aboutBody,/Counter-Strike 2/);

  result=await request("/api/admin/site-control/settings",{method:"POST",cookie,csrf,body:{
    mode:"coming_soon",heading:"CQRTV is coming",subtitle:"CS2 players and teams",description:"Closed for launch.",
    statusLabel:"COMING SOON",maintenanceHeading:"Maintenance",maintenanceSubtitle:"Back soon",
    maintenanceDescription:"Routine service work.",maintenanceStatusLabel:"MAINTENANCE",launchAt:null,
    countdownEnabled:false,aboutButtonLabel:"About CQRTV",aboutTitle:"CQRTV platform",
    aboutBody:"Players, teams, matches, tournaments, stats and esports.",animationEnabled:false,backgroundAssetId:null
  }});
  assert.equal(result.response.status,200);
  assert.equal(result.data.settings.mode,"coming_soon");

  result=await request("/api/auth/me");
  assert.equal(result.response.status,503);
  result=await request("/api/auth/register",{method:"POST",body:{}});
  assert.equal(result.response.status,503);
  result=await request("/api/site-control/public");
  assert.equal(result.response.status,200);
  assert.equal(result.data.heading,"CQRTV is coming");

  result=await request("/api/site-control/gate",{headers:{"X-Forwarded-Uri":"/admin/site-control"}});
  assert.equal(result.response.status,401);
  result=await request("/api/site-control/gate",{cookie,headers:{"X-Forwarded-Uri":"/admin/site-control"}});
  assert.equal(result.response.status,204);
  assert.equal(result.response.headers.get("x-cqrtv-site-mode"),"admin-preview");
  result=await request("/api/auth/me",{cookie});
  assert.equal(result.response.status,200);

  const png=Buffer.from([137,80,78,71,13,10,26,10,1]).toString("base64");
  result=await request("/api/admin/site-control/assets",{method:"POST",cookie,csrf,body:{kind:"background",mimeType:"image/png",base64:png}});
  assert.equal(result.response.status,201);
  const assetId=result.data.id;
  result=await request("/api/site-control/media/"+assetId);
  assert.equal(result.response.status,200);
  assert.equal(result.response.headers.get("content-type"),"image/png");
  result=await request("/api/admin/site-control/assets",{method:"POST",cookie,csrf,body:{kind:"social",mimeType:"image/svg+xml",base64:"PHN2Zy8+"}});
  assert.equal(result.response.status,400);

  result=await request("/api/admin/site-control/social-links",{method:"POST",cookie,csrf,body:{label:"Telegram",url:"https://t.me/cqrtv",iconKey:"chat",iconAssetId:null,enabled:true,sortOrder:0}});
  assert.equal(result.response.status,200);
  result=await request("/api/admin/site-control/social-links",{method:"POST",cookie,csrf,body:{label:"Bad",url:"javascript:alert(1)",iconKey:"chat",enabled:true,sortOrder:0}});
  assert.equal(result.response.status,400);
  result=await request("/api/site-control/public");
  assert.equal(result.data.socialLinks.length,1);
  assert.equal(result.data.socialLinks[0].label,"Telegram");

  const rejected=await request("/api/admin/site-control/settings",{method:"POST",cookie,body:{mode:"open"}});
  assert.equal(rejected.response.status,403);

  await app.pool.query("DELETE FROM site_control_settings WHERE id=1");
  result=await request("/api/site-control/gate",{cookie,headers:{"X-Forwarded-Uri":"/admin/site-control"}});
  assert.equal(result.response.status,204,"admin settings route remains available for recovery");
  result=await request("/api/admin/site-control",{cookie});
  assert.equal(result.response.status,200);
  assert.equal(result.data.settings.mode,"open","missing settings display a safe default to an authenticated admin");
  result=await request("/api/site-control/gate",{headers:{"X-Forwarded-Uri":"/"}});
  assert.equal(result.response.status,500,"public gate fails closed when settings are missing");
  result=await request("/api/admin/site-control/settings",{method:"POST",cookie,csrf,body:{
    mode:"open",heading:"CQRTV is open",subtitle:"CS2 players and teams",description:"Open.",
    statusLabel:"OPEN",maintenanceHeading:"Maintenance",maintenanceSubtitle:"Back soon",
    maintenanceDescription:"Routine service work.",maintenanceStatusLabel:"MAINTENANCE",launchAt:null,
    countdownEnabled:false,aboutButtonLabel:"About CQRTV",aboutTitle:"CQRTV platform",
    aboutBody:"Players, teams, matches, tournaments, stats and esports.",animationEnabled:false,backgroundAssetId:null
  }});
  assert.equal(result.response.status,200,"settings UPSERT restores the missing singleton row");

});

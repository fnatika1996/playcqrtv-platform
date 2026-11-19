import assert from "node:assert/strict";
import fs from "node:fs";
import {test} from "node:test";
import {classifyHomepage,verifyPublicSurface} from "./deployment-v2-smoke.mjs";

const currentMain=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const closedGate=fs.readFileSync(new URL("../site-closed.html",import.meta.url),"utf8");
const phase1='<html><main id="home"><h1 id="home-title">CQRTV — твоя платформа для CS2</h1></main></html>';
const homeV31='<html><main><h1 id="home-title">Твой путь в соревновательный <span>CS2</span></h1></main></html>';
const approvedHome='<html><main id="home"><h1 id="home-title"><span>ТВОЯ ИГРА.</span><span>ТВОЙ РЕЙТИНГ.</span></h1><div class="home-feature-grid"></div></main></html>';

test("smoke accepts current main, Phase 1 and closed gate",()=>{
  assert.ok(["current-main-public","phase1-public","home-v3.1-public","approved-home-desktop-mobile"].includes(classifyHomepage(currentMain)));
  assert.equal(classifyHomepage(phase1),"phase1-public");
  assert.equal(classifyHomepage(homeV31),"home-v3.1-public");\n  assert.equal(classifyHomepage(approvedHome),"approved-home-desktop-mobile");
  assert.equal(classifyHomepage(closedGate),"closed-gate");
});

test("smoke rejects corrupted or unexpected homepage content",()=>{
  assert.throws(()=>classifyHomepage("<html>�</html>"),/Invalid or corrupted/);
  assert.throws(()=>classifyHomepage("<html>private data</html>"),/Unexpected or private/);
});

test("read-only public checks validate API, auth/admin routes and SVG MIME",async()=>{
  const headers=type=>new Headers({"content-type":type});
  const fetchImpl=async url=>{
    if(url.endsWith("/"))return new Response(currentMain,{status:200,headers:headers("text/html")});
    if(url.endsWith("/api/health"))return new Response('{"status":"ok"}',{status:200,headers:headers("application/json")});
    if(url.endsWith("/auth.html")||url.endsWith("/admin/login"))return new Response("<html></html>",{status:200,headers:headers("text/html")});
    if(url.endsWith("/home.svg"))return new Response("<svg></svg>",{status:200,headers:headers("image/svg+xml")});
    throw new Error("unexpected network call");
  };
  assert.deepEqual(await verifyPublicSurface("https://example.invalid",fetchImpl),{homepageMode:classifyHomepage(currentMain),authStatus:200,adminLoginStatus:200,iconMime:"image/svg+xml"});
});

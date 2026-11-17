import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate as nextTurn } from "node:timers/promises";
import { test } from "node:test";
import vm from "node:vm";

const html=await readFile(new URL("../../auth.html",import.meta.url),"utf8");
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,"auth page contains its flow script");
function node(initial={}){const listeners=new Map();return Object.assign({hidden:false,value:"",textContent:"",required:false,disabled:false,href:"",classList:{add(){}},addEventListener(type,listener){listeners.set(type,listener)},setCustomValidity(){},reportValidity(){return true}},initial)}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
function makeVerify(fetchImpl,mode="verify"){
  const elements={email:node({value:"player@example.test",required:true}),password:node({value:"LoginPassword123!",required:true}),newPassword:node()};
  const form=node({elements,addEventListener(type,listener){this.listeners??={};this.listeners[type]=listener}});
  const nodes={"#form":form,"#status":node(),"#title":node({textContent:"Вход в аккаунт"}),"#desc":node({textContent:"Войдите."}),"#submit":node(),"#emailrow":node(),"#passwordrow":node(),"#tokenrow":node({hidden:true}),"#signup":node({href:"/#signup"}),"#auth-back":node({classList:{add(){}},setAttribute(){}}),".links":node({before(){}}),".login-hero":node({hidden:true}),"#verify-loading":node({hidden:true}),"#verify-success":node({hidden:true}),"#verify-failure":node({hidden:true}),"#verify-error-message":node(),"#verify-login-link":node({href:"/auth.html"}),"#verify-home-link":node({href:"/"}),"#verify-failure-login-link":node({href:"/auth.html"}),"#verify-failure-home-link":node({href:"/"})};
  const document={title:"",body:node({classList:{add(name){this[name]=true}}}),querySelector(sel){return nodes[sel]??node()},getElementById(id){return nodes["#"+id]??node()},createElement(){return node({style:{}})}};
  const calls=[];const context=vm.createContext({document,location:{search:"?mode="+mode+"&token=local-test-token",href:""},URLSearchParams,fetch:async(url,options)=>{calls.push({url,options});return fetchImpl(url,options)},setTimeout,console});
  vm.runInContext(script,context);return {nodes,form,calls,document};
}
function response(ok,body){return {ok,async json(){return body}}}

test("verify mode keeps loading UI visible until the API responds",async()=>{
  const pending=deferred(),page=makeVerify(()=>pending.promise);assert.equal(page.form.hidden,true);assert.equal(page.nodes["#verify-loading"].hidden,false);assert.equal(page.nodes["#verify-success"].hidden,true);assert.equal(page.calls[0].url,"/api/auth/verify");assert.equal(JSON.parse(page.calls[0].options.body).token,"local-test-token");
  pending.resolve(response(true,{message:"Email подтверждён."}));await nextTurn();await nextTurn();assert.equal(page.nodes["#verify-loading"].hidden,true);assert.equal(page.nodes["#verify-success"].hidden,false);assert.equal(page.nodes["#verify-failure"].hidden,true);assert.equal(page.nodes["#verify-login-link"].href,"/auth.html");assert.equal(page.document.title,"Email подтверждён — CQRTV");
});
test("verification failure shows an error and never displays the success CTA",async()=>{
  const page=makeVerify(async()=>response(false,{error:"Ссылка недействительна или уже использована."}));await nextTurn();await nextTurn();assert.equal(page.nodes["#verify-failure"].hidden,false);assert.equal(page.nodes["#verify-success"].hidden,true);assert.equal(page.nodes["#verify-error-message"].textContent,"Ссылка недействительна или уже использована.");assert.equal(page.nodes["#verify-failure-login-link"].href,"/auth.html");assert.equal(page.nodes["#verify-failure-home-link"].href,"/");
});
test("verification network errors remain a failure state with safe navigation",async()=>{
  const page=makeVerify(async()=>{throw new Error("offline")});await nextTurn();await nextTurn();assert.equal(page.nodes["#verify-failure"].hidden,false);assert.equal(page.nodes["#verify-success"].hidden,true);assert.match(page.nodes["#verify-error-message"].textContent,/Проверьте соединение/);assert.equal(page.nodes["#verify-failure-home-link"].href,"/");
});

test("login screen includes its branded layout, labelled fields and responsive CQRTV styling",()=>{
  assert.match(html,/class="login-hero"/);
  assert.match(html,/login-page #auth-card\{width:min\(700px,100%\)/);
  assert.match(html,/<label for="email-input"(?: data-i18n="common.email.label")?>Email<\/label>/);
  assert.match(html,/<label for="password-input">Пароль<\/label>/);
  assert.match(html,/l.className="login-forgot"/);
  assert.match(html,/id="signup"/);
  assert.match(html,/prefers-reduced-motion:reduce/);
});

test("login hero is visible only in login mode",()=>{
  const login=makeVerify(async()=>response(true,{}),"login");
  assert.equal(login.nodes[".login-hero"].hidden,false);
  assert.equal(login.document.body.classList["login-page"],true);
  for(const mode of ["forgot","reset","verify"]){
    const page=makeVerify(async()=>response(true,{}),mode);
    assert.equal(page.nodes[".login-hero"].hidden,true,mode+" keeps login hero hidden");
    assert.equal(page.document.body.classList["login-page"],undefined);
  }
});

test("login art is a local optimized raster and stays decorative",async()=>{
  const art=await readFile(new URL("../../assets/auth/login-hero.jpg",import.meta.url));
  assert.deepEqual([...art.subarray(0,3)],[0xff,0xd8,0xff]);
  assert.ok(art.length<150_000,"hero asset stays lightweight");
  assert.match(html,/src="\/assets\/auth\/login-hero\.jpg" alt="" aria-hidden="true"/);
  assert.match(html,/class="login-hero" hidden/);
});

test("login hero layers use a controlled banner layout at desktop and mobile sizes",()=>{
  const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||"";
  assert.match(css,/\.login-page \.login-hero:not\(\[hidden\]\)\{position:relative;display:block;width:100%;max-width:100%;min-width:0;height:200px/);
  assert.match(css,/\.login-page \.login-hero:not\(\[hidden\]\)\{[^}]*overflow:hidden/);
  assert.match(css,/\.login-page \.login-art\{display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:right center/);
  assert.match(css,/\.login-page \.login-hero-shade\{position:absolute;inset:0;pointer-events:none;background:linear-gradient/);
  assert.match(css,/\.login-page \.login-hero-copy\{position:absolute;left:0;top:50%;z-index:1/);
  assert.ok(css.includes("@media(max-width:540px)")&&css.includes(".login-page .login-hero:not([hidden]){height:126px"),"tablet/phone hero height is controlled");
  assert.ok(css.includes("@media(max-width:360px)")&&css.includes(".login-page .login-hero:not([hidden]){height:116px"),"small phone hero height is controlled");
  assert.match(css,/object-position:68% center/);
});


function makeLoginControls(){
  const listeners=new Map();
  const node=(initial={})=>Object.assign({hidden:false,value:"",type:"",textContent:"",innerHTML:"",required:false,disabled:false,href:"",attributes:{},classList:{add(name){this[name]=true}},addEventListener(type,listener){this.listeners??=new Map();this.listeners.set(type,listener)},setAttribute(name,value){this.attributes[name]=value},getAttribute(name){return this.attributes[name]??null}},initial);
  const email=node({value:"",type:"email"}),password=node({value:"SafePass123!",type:"password"});
  const elements={email,password,newPassword:node({value:""})};
  const form=node({elements,addEventListener(type,listener){listeners.set(type,listener)}});
  const signup=node({href:"/#signup-dialog"}),back=node({href:"/"});
  const links=node({before(element){this.inserted=element}});
  const visibilityIcon=node({dataset:{src:"/assets/icons/cqrtv/ui/eye.svg"}});
  const visibility=node({type:"button",attributes:{"aria-label":"Показать пароль","aria-pressed":"false"},querySelector(selector){return selector===".admin-icon"?null:visibilityIcon}});
  const hero=node({hidden:true});
  const nodes={"#form":form,"#status":node(),"#title":node(),"#desc":node(),"#submit":node({type:"submit"}),"#emailrow":node(),"#passwordrow":node(),"#tokenrow":node({hidden:true}),"#signup":signup,"#auth-back":back,".links":links,".login-hero":hero,"#password-visibility":visibility,"#password-input":password};
  const document={title:"",body:node({classList:{add(name){this[name]=true}}}),querySelector(selector){return nodes[selector]??node()},getElementById(id){return nodes["#"+id]??node()},createElement(){return node()}};
  const context=vm.createContext({document,location:{search:"?mode=login",href:""},URLSearchParams,fetch:async()=>{throw Error("login UI test must not call API")},setTimeout,console});
  vm.runInContext(script,context);
  return {nodes,document,password,visibility,visibilityIcon,form,links,back,formListeners:listeners};
}
test("login micro-UX keeps auth semantics and provides approved controls",()=>{
  assert.match(html,/<a id="auth-back" href="\/" aria-label="Вернуться на сайт" data-i18n-aria-label="common.nav.back" data-i18n="common.nav.back">← Назад<\/a>/);
  assert.match(html,/back\.classList\.add\("login-back"\)/);
  assert.match(html,/<input id="email-input" name="email" type="email" autocomplete="email" placeholder="player@example.com" data-i18n-placeholder="common.email.placeholder" required>/);
  assert.match(html,/<input id="password-input" name="password" type="password" minlength="12" maxlength="128" autocomplete="current-password" placeholder="Введите пароль" data-i18n-placeholder="auth.password.placeholder" required>/);
  assert.match(html,/<button id="submit" type="submit"><span class="pack-icon" data-src="\/assets\/icons\/cqrtv\/ui\/login\.svg"/);
  assert.match(html,/<script type="module" src="\/assets\/admin\/admin-icons\.mjs"><\/script>/);
  assert.match(html,/data-src="\/assets\/icons\/cqrtv\/ui\/mail\.svg"/);
  assert.match(html,/data-src="\/assets\/icons\/cqrtv\/ui\/lock\.svg"/);
  assert.match(html,/href="\/rules\.html"/);
  assert.match(html,/href="\/privacy\.html"/);
  assert.match(html,/signup\.href="\/#signup-dialog"/);
  assert.match(html,/l\.href="\/auth\.html\?mode=forgot"/);
  assert.match(html,/l\.className="login-forgot"/);
  assert.match(html,/\.login-page #auth-card>a\.login-back\{/);
  assert.match(html,/\.login-page #auth-card>\.login-forgot\{[^}]*min-height:42px/);
  assert.match(html,/\.login-page \.links a:not\(#signup\)\{min-height:40px/);
});
test("password visibility toggles without submitting or losing its value",()=>{
  const page=makeLoginControls();
  assert.equal(page.password.type,"password");
  assert.equal(page.visibility.type,"button");
  assert.equal(page.visibility.getAttribute("aria-label"),"Показать пароль");
  assert.equal(page.visibility.getAttribute("aria-pressed"),"false");
  page.visibility.listeners.get("click")();
  assert.equal(page.password.type,"text");
  assert.equal(page.password.value,"SafePass123!");
  assert.equal(page.visibility.getAttribute("aria-label"),"Скрыть пароль");
  assert.equal(page.visibility.getAttribute("aria-pressed"),"true");
  assert.equal(page.visibilityIcon.dataset.src,"/assets/icons/cqrtv/ui/eye-closed.svg");
  page.visibility.listeners.get("click")();
  assert.equal(page.password.type,"password");
  assert.equal(page.password.value,"SafePass123!");
  assert.equal(page.visibility.getAttribute("aria-label"),"Показать пароль");
  assert.equal(page.visibility.getAttribute("aria-pressed"),"false");
  assert.equal(page.visibilityIcon.dataset.src,"/assets/icons/cqrtv/ui/eye.svg");
  assert.equal(page.formListeners.size,1,"the existing auth submit handler stays attached and eye clicks do not dispatch it");
});
test("login-only links are inserted with safe routes and no API side effects",()=>{
  const page=makeLoginControls();
  assert.equal(page.links.inserted.href,"/auth.html?mode=forgot");
  assert.equal(page.links.inserted.className,"login-forgot");
  assert.match(page.links.inserted.innerHTML,/Забыли пароль\?/);
  assert.equal(page.nodes["#signup"].href,"/#signup-dialog");
  assert.equal(page.back.classList["login-back"],true);
  assert.equal(page.back.getAttribute("aria-label"),"На главную");
  assert.match(page.back.innerHTML,/На главную/);
  assert.match(page.nodes["#signup"].innerHTML,/Нет аккаунта\?/);
  assert.equal(page.nodes[".login-hero"].hidden,false);
});


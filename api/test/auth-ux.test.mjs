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
function makeVerify(fetchImpl){
  const elements={email:node({value:"player@example.test",required:true}),password:node({value:"LoginPassword123!",required:true}),newPassword:node()};
  const form=node({elements,addEventListener(type,listener){this.listeners??={};this.listeners[type]=listener}});
  const nodes={"#form":form,"#status":node(),"#title":node({textContent:"Вход в аккаунт"}),"#desc":node({textContent:"Войдите."}),"#submit":node(),"#emailrow":node(),"#passwordrow":node(),"#tokenrow":node({hidden:true}),"#signup":node({href:"/#signup"}),".links":node(),"#verify-loading":node({hidden:true}),"#verify-success":node({hidden:true}),"#verify-failure":node({hidden:true}),"#verify-error-message":node(),"#verify-login-link":node({href:"/auth.html"}),"#verify-home-link":node({href:"/"}),"#verify-failure-login-link":node({href:"/auth.html"}),"#verify-failure-home-link":node({href:"/"})};
  const document={title:"",body:node({classList:{add(name){this[name]=true}}}),querySelector(sel){return nodes[sel]??node()},getElementById(id){return nodes["#"+id]??node()}};
  const calls=[];const context=vm.createContext({document,location:{search:"?mode=verify&token=local-test-token",href:""},URLSearchParams,fetch:async(url,options)=>{calls.push({url,options});return fetchImpl(url,options)},setTimeout,console});
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
  assert.match(html,/login-page #auth-card\{width:min\(600px,100%\)/);
  assert.match(html,/<label for="email-input">Email<\/label>/);
  assert.match(html,/<label for="password-input">Пароль<\/label>/);
  assert.match(html,/l.className="login-forgot"/);
  assert.match(html,/id="signup"/);
  assert.match(html,/prefers-reduced-motion:reduce/);
});

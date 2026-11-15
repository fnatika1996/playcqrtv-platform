import assert from "node:assert/strict";
import { test } from "node:test";
import { bindAuthHeader } from "../../assets/auth-header.mjs";

function makeNode(initial={}) {
  const listeners=new Map();
  const node=Object.assign({hidden:false,textContent:"",disabled:false,addEventListener(type,listener){listeners.set(type,listener)},async emit(type){await listeners.get(type)?.({target:this})}},initial);
  node.emit=async type=>{await listeners.get(type)?.({target:node})};
  return node;
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
function createHeader(fetchImpl){
  const ids={"signup-open":makeNode({hidden:true}),"login-link":makeNode({hidden:true}),"auth-header-status":makeNode({textContent:"Проверяем аккаунт…"}),"auth-user-menu":makeNode({hidden:true}),"header-avatar-initial":makeNode(),"header-user-nickname":makeNode(),"logout-btn":makeNode(),"profile-nickname":makeNode({textContent:"Демо игрок"}),"profile-avatar-letter":makeNode({textContent:"Д"}),"profile-country-flag":makeNode({textContent:"—"}),"profile-role":makeNode({textContent:"Демонстрационный профиль"}),"profile-email-verified":makeNode({hidden:true})};
  const document={getElementById(id){assert.ok(ids[id],`expected #${id}`);return ids[id]}};
  const header=bindAuthHeader(document,fetchImpl);return {ids,header};
}
function response(ok,body){return {ok,async json(){return body}}}
const player={nickname:"ClutchAce",country:"MD",primary_role:"awper",secondary_roles:["rifler"]};

test("header stays neutral while session loads and shows guest CTAs for a guest",async()=>{
  const pending=deferred(),calls=[];const {ids,header}=createHeader(async(url,options)=>{calls.push({url,options});return pending.promise});
  assert.equal(ids["auth-header-status"].textContent,"Проверяем аккаунт…");assert.equal(ids["signup-open"].hidden,true);assert.equal(ids["login-link"].hidden,true);assert.equal(ids["auth-user-menu"].hidden,true);
  pending.resolve(response(true,{user:null}));await header.ready;
  assert.deepEqual(calls.map(call=>call.url),["/api/auth/me"]);assert.equal(calls[0].options.cache,"no-store");assert.equal(ids["signup-open"].hidden,false);assert.equal(ids["login-link"].hidden,false);assert.equal(ids["auth-user-menu"].hidden,true);assert.equal(ids["auth-header-status"].textContent,"");assert.equal(ids["profile-nickname"].textContent,"Демо игрок");assert.equal(ids["profile-email-verified"].hidden,true);
});
test("session hydration after login redirect shows real identity and hides guest CTAs",async()=>{
  const calls=[];const {ids,header}=createHeader(async(url,options)=>{calls.push({url,options});return response(true,{user:player})});await header.ready;
  assert.deepEqual(calls.map(call=>call.url),["/api/auth/me"]);assert.equal(calls[0].options.credentials,"same-origin");assert.equal(ids["signup-open"].hidden,true);assert.equal(ids["login-link"].hidden,true);assert.equal(ids["auth-user-menu"].hidden,false);assert.equal(ids["header-user-nickname"].textContent,"ClutchAce");assert.equal(ids["header-avatar-initial"].textContent,"C");assert.equal(ids["profile-nickname"].textContent,"ClutchAce");assert.equal(ids["profile-avatar-letter"].textContent,"C");assert.equal(ids["profile-country-flag"].textContent,"🇲🇩");assert.equal(ids["profile-role"].textContent,"AWPer");assert.equal(ids["profile-email-verified"].hidden,false);assert.equal(header.user.nickname,"ClutchAce");
});
test("logout uses the existing POST route and returns header to guest state",async()=>{
  const calls=[];const {ids,header}=createHeader(async(url,options)=>{calls.push({url,options});return response(true,url==="/api/auth/me"?{user:player}:{message:"Вы вышли."})});await header.ready;await ids["logout-btn"].emit("click");
  assert.equal(calls[1].url,"/api/auth/logout");assert.equal(calls[1].options.method,"POST");assert.equal(calls[1].options.credentials,"same-origin");assert.equal(ids["auth-user-menu"].hidden,true);assert.equal(ids["signup-open"].hidden,false);assert.equal(ids["login-link"].hidden,false);assert.equal(ids["auth-header-status"].textContent,"Вы вышли.");assert.equal(ids["profile-nickname"].textContent,"Демо игрок");assert.equal(ids["profile-email-verified"].hidden,true);
});
test("session lookup failure fails closed and never shows a demo identity as authenticated",async()=>{
  const {ids,header}=createHeader(async()=>{throw new Error("offline")});await header.ready;assert.equal(ids["auth-user-menu"].hidden,true);assert.equal(ids["signup-open"].hidden,false);assert.equal(ids["login-link"].hidden,false);assert.equal(ids["header-user-nickname"].textContent,"");assert.equal(ids["auth-header-status"].textContent,"Не удалось проверить аккаунт.");
});
test("API error response fails closed and never exposes stale account identity",async()=>{
  const {ids,header}=createHeader(async()=>response(false,{error:"temporary server failure"}));await header.ready;assert.equal(ids["auth-user-menu"].hidden,true);assert.equal(ids["signup-open"].hidden,false);assert.equal(ids["login-link"].hidden,false);assert.equal(ids["header-user-nickname"].textContent,"");assert.equal(ids["auth-header-status"].textContent,"Не удалось проверить аккаунт.");
});
test("logout failure keeps real session UI and exposes an error",async()=>{
  const {ids,header}=createHeader(async(url)=>url==="/api/auth/me"?response(true,{user:player}):response(false,{error:"failed"}));await header.ready;await ids["logout-btn"].emit("click");assert.equal(ids["auth-user-menu"].hidden,false);assert.equal(ids["header-user-nickname"].textContent,"ClutchAce");assert.equal(ids["auth-header-status"].textContent,"Не удалось выйти. Попробуйте ещё раз.");
});

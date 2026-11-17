import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { bindPlayerExperience } from "../../assets/player-experience.mjs";

function node(initial={}) {
  const listeners=new Map();
  const attrs=new Map();
  return Object.assign({
    hidden:false,
    textContent:"",
    dataset:{},
    addEventListener(type,listener){listeners.set(type,listener)},
    setAttribute(name,value){attrs.set(name,value)},
    getAttribute(name){return attrs.get(name)||null},
    async emit(type,event={}){await listeners.get(type)?.({target:this,key:"",...event})},
    focus(){this.focused=true}
  },initial);
}

test("approved home v3.1 avoids fabricated activity and preserves compact private account data",async()=>{
  const html=await readFile(new URL("../../index.html",import.meta.url),"utf8");
  for(const fake of ["Демо игрок","Демонстрационный профиль","1 246","Золотой ранг I","vlad.exe","M0ld0van","62.5% win rate","+24 ELO","#284","12 мин","CQRTV Open #1","Игроков онлайн","Матчей сегодня"]){
    assert.equal(html.includes(fake),false,`public page must not ship fabricated data: ${fake}`);
  }
  assert.match(html,/<h1 id="home-title">Твой путь в соревновательный <span>CS2<\/span><\/h1>/);
  assert.match(html,/Матчмейкинг 5×5, собственный ELO, турниры и статистика — в одной платформе/);
  assert.equal((html.match(/class="v31-benefit(?: is-primary)?"/g)||[]).length,4);
  assert.equal((html.match(/class="v31-step"/g)||[]).length,3);
  assert.match(html,/id="tournament-title">Турниры — скоро/);
  assert.match(html,/Следите за анонсами/);
  assert.match(html,/id="player-profile"[^>]*hidden/);
  assert.match(html,/id="profile-nickname"/);
  assert.match(html,/id="profile-country-flag"/);
  assert.match(html,/id="profile-role"/);
  assert.match(html,/id="profile-secondary-roles"/);
  assert.match(html,/Матчмейкинг 5×5<\/h3>[\s\S]*?В разработке/);
});

test("public navigation links resolve to real sections and mobile controls are labelled",async()=>{
  const html=await readFile(new URL("../../index.html",import.meta.url),"utf8");
  const targets=[...html.matchAll(/href="#([a-z-]+)"/g)].map(match=>match[1]);
  const ids=new Set([...html.matchAll(/id="([a-z-]+)"/g)].map(match=>match[1]));
  for(const target of targets)assert.ok(ids.has(target),`navigation target #${target} should exist`);
  assert.match(html,/aria-controls="mobile-navigation"/);
  assert.match(html,/aria-expanded="false"/);
  assert.match(html,/aria-label="Мобильная навигация"/);
});

test("approved home v3.1 uses current CQRTV hero art and responsive breakpoints",async()=>{
  const [html,css]=await Promise.all([
    readFile(new URL("../../index.html",import.meta.url),"utf8"),
    readFile(new URL("../../assets/public-site.css",import.meta.url),"utf8")
  ]);
  assert.match(html,/\/assets\/public-site\.css/);
  assert.match(css,/\/assets\/auth\/login-hero\.jpg/);
  assert.match(html,/class="v31-benefit-grid"/);
  assert.match(html,/class="v31-step-list"/);
  assert.match(html,/class="v31-tournament"/);
  assert.match(html,/id="mobile-menu-toggle"/);
  assert.match(html,/aria-label="Мобильная навигация"/);
  for(const width of ["1180px","1120px","1024px","760px","390px","340px"])assert.ok(css.includes(`max-width:${width}`),`missing responsive rule at ${width}`);
  assert.match(css,/prefers-reduced-motion/);
});

test("player profile is private until a valid session exists and clears on logout",()=>{
  const ids={
    "player-profile":node({hidden:true}),"guest-actions":node({hidden:false}),"member-actions":node({hidden:true}),
    "player-welcome":node({hidden:true}),"mobile-menu-toggle":node(),
    "sidebar-profile-link":node({href:"#guest-actions"}),"mobile-menu-profile-link":node({href:"#guest-actions"}),"mobile-profile-link":node({href:"#guest-actions"}),
    "mobile-navigation":node({hidden:true,querySelector(){return firstLink},querySelectorAll(){return [firstLink,secondLink]}})
  };
  const firstLink=node(),secondLink=node();
  const documentListeners=new Map(),windowListeners=new Map();
  const document={body:{dataset:{}},defaultView:{addEventListener(type,listener){windowListeners.set(type,listener)}},getElementById(id){assert.ok(ids[id],`missing #${id}`);return ids[id]},addEventListener(type,listener){documentListeners.set(type,listener)}};
  let notifySession;
  const session={onSessionChange(listener){notifySession=listener;listener(null)}};
  bindPlayerExperience(document,session);
  assert.equal(ids["player-profile"].hidden,true);
  assert.equal(ids["guest-actions"].hidden,false);
  assert.equal(ids["member-actions"].hidden,true);
  assert.equal(document.body.dataset.accountState,"guest");

  notifySession({nickname:"ClutchAce"});
  assert.equal(ids["player-profile"].hidden,false);
  assert.equal(ids["guest-actions"].hidden,true);
  assert.equal(ids["member-actions"].hidden,false);
  assert.equal(ids["player-welcome"].hidden,false);
  assert.equal(ids["player-welcome"].textContent,"С возвращением, ClutchAce");
  assert.equal(ids["sidebar-profile-link"].href,"#player-profile");
  assert.equal(ids["mobile-menu-profile-link"].href,"#player-profile");
  assert.equal(ids["mobile-profile-link"].href,"#player-profile");
  assert.equal(document.body.dataset.accountState,"authenticated");

  notifySession(null);
  assert.equal(ids["player-profile"].hidden,true);
  assert.equal(ids["guest-actions"].hidden,false);
  assert.equal(ids["player-welcome"].hidden,true);
  assert.equal(ids["sidebar-profile-link"].href,"#guest-actions");
  assert.equal(ids["mobile-menu-profile-link"].href,"#guest-actions");
  assert.equal(ids["mobile-profile-link"].href,"#guest-actions");
  assert.equal(document.body.dataset.accountState,"guest");

  ids["mobile-menu-toggle"].emit("click");
  assert.equal(ids["mobile-navigation"].hidden,false);
  assert.equal(ids["mobile-menu-toggle"].getAttribute("aria-expanded"),"true");
  assert.equal(firstLink.focused,true);
  documentListeners.get("keydown")({key:"Escape"});
  assert.equal(ids["mobile-navigation"].hidden,true);
  assert.equal(ids["mobile-menu-toggle"].getAttribute("aria-expanded"),"false");
  assert.equal(ids["mobile-menu-toggle"].focused,true);
  assert.equal(typeof windowListeners.get("hashchange"),"function");
});

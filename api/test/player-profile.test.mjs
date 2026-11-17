import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
const read=path=>readFile(new URL(path,import.meta.url),"utf8");
test("player profile uses private account fields and honest empty states",async()=>{
  const html=await read("../../profile.html"),module=await read("../../assets/player-profile.mjs");
  for(const text of ["Рейтинг появится после запуска матчмейкинга","Статистика появится после первых матчей","Матчей пока нет","country","primary_role","secondary_roles"])assert.ok(html.includes(text)||module.includes(text),"profile should contain "+text);
  for(const fake of ["+24 ELO","1 246","Золотой ранг I","CQRTV Open #1","Игроков онлайн","62.5% win rate","player_id","admin_status","joined_at"])assert.equal((html+module).includes(fake),false,"profile must not expose fabricated or unsupported data: "+fake);
  assert.match(module,/\/api\/auth\/me/);assert.match(module,/\/api\/account\/nickname/);
  assert.match(html,/id="profile-email-verified"[^>]*hidden/);
});
test("profile navigation targets real sections and feature shell is responsive",async()=>{
  const html=await read("../../profile.html"),css=await read("../../assets/player-profile.css");
  const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1]));
  for(const [,target] of html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.has(target),"profile navigation target #"+target+" should exist");
  for(const width of ["1024px","760px","390px","340px"])assert.ok(css.includes("max-width:"+width),"missing profile breakpoint "+width);
  assert.match(css,/prefers-reduced-motion/);assert.match(html,/aria-controls="profile-mobile-navigation"/);
});

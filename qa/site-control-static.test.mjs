import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const root=new URL("../",import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),"utf8");

test("site control landing implements safe editable copy, modal accessibility and responsive reduced motion",()=>{
 const page=read("site-closed.html");
 assert.match(page,/aria-modal="true"/);
 assert.match(page,/aria-labelledby="about-title"/);
 assert.match(page,/e.key==='Escape'/);
 assert.match(page,/prefers-reduced-motion:reduce/);
 assert.match(page,/@media\(max-width:600px\)/);
 assert.match(page,/textContent/);
 assert.doesNotMatch(page,/innerHTML\s*=/);
 assert.match(page,/maintenanceHeading/);
 assert.match(page,/countdownEnabled/);
});

test("admin site control is session API-based, responsive, and uses existing CQRTV icon assets",()=>{
 const page=read("site-control-admin.html");
 assert.match(page,/\/api\/admin\/site-control/);
 assert.match(page,/X-CSRF-Token/);
 assert.match(page,/accept="image\/png,image\/jpeg,image\/webp"/);
 assert.match(page,/\/assets\/icons\/cqrtv\/ui\/dashboard\.svg/);
 assert.match(page,/@media\(max-width:760px\)/);
 assert.match(page,/https:\/\//);
});

test("Caddy preserves health/API, login recovery and authenticated admin preview while gating public files",()=>{
 const caddy=read("Caddyfile");
 assert.match(caddy,/@api path \/api\/\*/);
 assert.match(caddy,/@admin_login path \/admin\/login \/admin-login\.html/);
 assert.match(caddy,/forward_auth api:3000/);
 assert.match(caddy,/X-Forwarded-Uri \{uri\}/);
 assert.match(caddy,/copy_headers X-CQRTV-Site-Mode/);
 assert.match(caddy,/@site_closed header X-CQRTV-Site-Mode coming_soon maintenance/);
 assert.ok(caddy.includes("rewrite @site_closed /site-closed.html"));
});

test("site control migration defaults to open and stores only raster upload types",()=>{
 const sql=read("api/migrations/002_site_control.sql");
 assert.match(sql,/'open'/);
 assert.match(sql,/image\/png', 'image\/jpeg', 'image\/webp/);
 assert.match(sql,/ON CONFLICT \(id\) DO NOTHING/);
});

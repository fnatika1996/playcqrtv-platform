import assert from "node:assert/strict";
import { test } from "node:test";
import { createSiteControlRoutes, decodeImageUpload, safeHttpsUrl, validateSiteSettings } from "../site-control.mjs";

const sample = {
  mode: "coming_soon", heading: "CQRTV", subtitle: "CS2", description: "Players and teams",
  statusLabel: "SOON", maintenanceHeading: "Maintenance", maintenanceSubtitle: "Back soon",
  maintenanceDescription: "We are updating the platform.", maintenanceStatusLabel: "MAINTENANCE",
  launchAt: null, countdownEnabled: false, aboutButtonLabel: "About CQRTV",
  aboutTitle: "The platform", aboutBody: "Players, teams, matches and tournaments.",
  animationEnabled: false, backgroundAssetId: null
};

test("site settings validate both modes, bounded copy and explicit toggles", () => {
  assert.equal(validateSiteSettings(sample).mode, "coming_soon");
  assert.equal(validateSiteSettings({ ...sample, mode: "maintenance" }).maintenanceHeading, "Maintenance");
  assert.throws(() => validateSiteSettings({ ...sample, mode: "unknown" }), /режим/i);
  assert.throws(() => validateSiteSettings({ ...sample, heading: " " }), /полей/i);
  assert.throws(() => validateSiteSettings({ ...sample, description: "x".repeat(1201) }), /полей/i);
  assert.throws(() => validateSiteSettings({ ...sample, countdownEnabled: "yes" }), /переключателей/i);
  assert.throws(() => validateSiteSettings({ ...sample, launchAt: "not a date" }), /дату и время/i);
});

test("social URLs accept only credential-free HTTPS addresses", () => {
  assert.equal(safeHttpsUrl("https://t.me/cqrtv"), "https://t.me/cqrtv");
  for (const value of ["http://example.com", "javascript:alert(1)", "https://user:pass@example.com", "https://", "x".repeat(2049)]) {
    assert.equal(safeHttpsUrl(value), null);
  }
});

test("uploads require raster signature, exact MIME and a 2 MB limit", () => {
  const tinyPng = Buffer.from([137,80,78,71,13,10,26,10,0]).toString("base64");
  assert.equal(decodeImageUpload({ mimeType: "image/png", base64: tinyPng, kind: "background" }).length, 9);
  assert.throws(() => decodeImageUpload({ mimeType: "image/svg+xml", base64: "PHN2Zy8+", kind: "social" }), /Unsupported/);
  assert.throws(() => decodeImageUpload({ mimeType: "image/png", base64: Buffer.from("not png").toString("base64"), kind: "social" }), /signature/i);
  assert.throws(() => decodeImageUpload({ mimeType: "image/png", base64: "%%%", kind: "social" }), /Invalid image/);
  assert.throws(() => decodeImageUpload({ mimeType: "image/png", base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"), kind: "social" }), /2 MB/);
});

function responseRecorder() {
  return {
    status: 0, headers: {}, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
}

test("edge gate fails closed for public pages and grants preview only to active admin sessions", async () => {
  let mode = "coming_soon", admin = false, unavailable = false;
  const pool = {
    async query(sql) {
      if (sql.includes("admin_sessions")) return { rowCount: admin ? 1 : 0, rows: [] };
      if (unavailable) throw new Error("database unavailable");
      if (sql.includes("site_control_settings")) return { rowCount: 1, rows: [{ mode }] };
      throw new Error("unexpected query");
    }
  };
  const routes = createSiteControlRoutes({ pool, json: (res,status,data,headers={}) => {res.writeHead(status,headers);res.end(JSON.stringify(data));}, body: async()=>({}), tokenHash:x=>x });
  const denied = responseRecorder();
  await routes.handle({ method: "GET", url: "/api/site-control/gate", headers: { "x-forwarded-uri": "/admin" } }, denied);
  assert.equal(denied.status, 401);
  const closed = responseRecorder();
  await routes.handle({ method: "GET", url: "/api/site-control/gate", headers: { "x-forwarded-uri": "/" } }, closed);
  assert.equal(closed.status, 204);
  assert.equal(closed.headers["X-CQRTV-Site-Mode"], "coming_soon");
  assert.equal(await routes.blocked({ headers: {} }), true);
  admin = true;
  const preview = responseRecorder();
  await routes.handle({ method: "GET", url: "/api/site-control/gate", headers: { cookie: "cqrtv_admin_session=opaque", "x-forwarded-uri": "/admin" } }, preview);
  assert.equal(preview.status, 204);
  assert.equal(preview.headers["X-CQRTV-Site-Mode"], "admin-preview");
  assert.equal(await routes.blocked({ headers: { cookie: "cqrtv_admin_session=opaque" } }), false);
  unavailable = true;
  assert.equal(await routes.blocked({ headers: { cookie: "cqrtv_admin_session=opaque" } }), false);
  const recovery = responseRecorder();
  await routes.handle({ method: "GET", url: "/api/site-control/gate", headers: { cookie: "cqrtv_admin_session=opaque", "x-forwarded-uri": "/admin/site-control" } }, recovery);
  assert.equal(recovery.status, 204, "active admin session remains able to reach recovery UI during settings outage");
  await assert.rejects(routes.blocked({ headers: {} }), /database unavailable/);
});

test("Caddy gates public static routes and keeps health/admin login recovery paths", async () => {
  const fs = await import("node:fs");
  const caddy = fs.readFileSync(new URL("../../Caddyfile", import.meta.url), "utf8");
  assert.match(caddy, /forward_auth api:3000/);
  assert.match(caddy, /copy_headers X-CQRTV-Site-Mode/);
  assert.match(caddy, /@site_closed header X-CQRTV-Site-Mode coming_soon maintenance/);
  assert.match(caddy, /@admin_login path \/admin\/login \/admin-login\.html/);
  assert.match(caddy, /@api path \/api\/\*/);
});

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";

const connectionString = process.env.ADMIN_TEST_DATABASE_URL;
if (connectionString) {
  const parsed = new URL(connectionString);
  if (!decodeURIComponent(parsed.pathname).toLowerCase().includes("test")) {
    throw new Error("ADMIN_TEST_DATABASE_URL must point to a database whose name includes 'test'.");
  }
}

test("admin API access control and user management", { skip: !connectionString }, async t => {
  const { Pool } = await import("pg");
  const basePool = new Pool({ connectionString, max: 2 });
  const schema = "admin_test_" + crypto.randomBytes(6).toString("hex");
  await basePool.query(`CREATE SCHEMA ${schema}`);
  const scopedUrl = new URL(connectionString);
  scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = scopedUrl.toString();
  process.env.APP_ORIGIN = "http://admin.test";
  process.env.NODE_ENV = "test";
  const app = await import("../server.mjs");
  await app.init();
  const server = app.createHttpServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const origin = process.env.APP_ORIGIN;
  const hash = value => crypto.createHash("sha256").update(value).digest("hex");
  const passwordHash = async password => {
    const salt = crypto.randomBytes(16);
    const key = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result)));
    return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
  };
  const playerPassword = "PlayerPass123!";
  const adminPassword = "AdminPass123!";
  const [playerHash, adminHash] = await Promise.all([passwordHash(playerPassword), passwordHash(adminPassword)]);
  const player = await app.pool.query("INSERT INTO users(nickname,email,password_hash,country,primary_role,email_verified) VALUES($1,$2,$3,'US','rifler',true) RETURNING id", ["player-test", "player@example.test", playerHash]);
  const admin = await app.pool.query("INSERT INTO users(nickname,email,password_hash,country,primary_role,email_verified,is_admin) VALUES($1,$2,$3,'US','igl',true,true) RETURNING id", ["admin-test", "admin@example.test", adminHash]);
  const admin2 = await app.pool.query("INSERT INTO users(nickname,email,password_hash,country,primary_role,email_verified,is_admin) VALUES($1,$2,$3,'US','support',true,true) RETURNING id", ["admin-two", "admin2@example.test", adminHash]);
  const playerSession = crypto.randomBytes(32).toString("base64url");
  await app.pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [hash(playerSession), player.rows[0].id]);

  async function request(path, { method = "GET", body, cookie = "", csrf = "", requestOrigin = origin } = {}) {
    const headers = { Origin: requestOrigin };
    if (cookie) headers.Cookie = cookie;
    if (csrf) headers["X-CSRF-Token"] = csrf;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = {};
    try { data = await response.json(); } catch {}
    return { response, data };
  }
  async function login(email, password) {
    const { response, data } = await request("/api/admin/login", { method: "POST", body: { email, password } });
    return { response, data, cookie: (response.headers.get("set-cookie") || "").split(";")[0] };
  }

  try {
    await t.test("guest and ordinary player cannot enter admin APIs", async () => {
      assert.equal((await request("/api/admin/stats")).response.status, 401);
      assert.equal((await request("/api/admin/stats", { cookie: `cqrtv_session=${playerSession}` })).response.status, 403);
      const denied = await login("player@example.test", playerPassword);
      assert.equal(denied.response.status, 401);
      assert.match(denied.data.error, /Неверные данные/);
    });

    await t.test("login is generic for invalid credentials and strict about origin", async () => {
      const wrong = await login("admin@example.test", "incorrect");
      const missing = await login("missing@example.test", "incorrect");
      assert.equal(wrong.response.status, 401);
      assert.equal(missing.response.status, 401);
      assert.equal(wrong.data.error, missing.data.error);
      const badOrigin = await request("/api/admin/login", { method: "POST", requestOrigin: "https://attacker.test", body: { email: "admin@example.test", password: adminPassword } });
      assert.equal(badOrigin.response.status, 403);
    });

    const signedIn = await login("admin@example.test", adminPassword);
    const secondAdmin = await login("admin2@example.test", adminPassword);
    assert.equal(signedIn.response.status, 200);
    assert.match(signedIn.cookie, /^cqrtv_admin_session=/);
    assert.match(signedIn.response.headers.get("set-cookie"), /HttpOnly/);
    assert.match(signedIn.response.headers.get("set-cookie"), /Secure/);
    const adminCookie = signedIn.cookie;
    const adminCsrf = signedIn.data.csrfToken;
    const otherCookie = secondAdmin.cookie;
    const otherCsrf = secondAdmin.data.csrfToken;

    await t.test("session is checked on every request and sends only safe user fields", async () => {
      const me = await request("/api/admin/me", { cookie: adminCookie });
      assert.equal(me.response.status, 200);
      assert.match(me.data.user.emailMasked, /•/);
      assert.ok(me.data.csrfToken);
      const noCsrf = await request("/api/admin/users/" + player.rows[0].id + "/suspend", { method: "POST", cookie: adminCookie, body: { reason: "test reason" } });
      assert.equal(noCsrf.response.status, 403);
      const wrongOrigin = await request(`/api/admin/users/${player.rows[0].id}/suspend`, { method: "POST", cookie: adminCookie, csrf: adminCsrf, requestOrigin: "https://attacker.test", body: { reason: "test reason" } });
      assert.equal(wrongOrigin.response.status, 403);
      const users = await request("/api/admin/users?limit=999&offset=0", { cookie: adminCookie });
      assert.equal(users.response.status, 200);
      assert.equal(users.data.pagination.limit, 50);
      assert.ok(users.data.users.every(user => !("password_hash" in user) && !("token_hash" in user)));
      const sql = await request("/api/admin/users?q=%25%27%20OR%201%3D1--", { cookie: adminCookie });
      assert.equal(sql.response.status, 200);
      assert.equal(sql.data.pagination.total, 0);
    });

    await t.test("filters, pagination and real stats work", async () => {
      const filtered = await request("/api/admin/users?limit=1&offset=0&country=US&status=active&email_verified=true", { cookie: adminCookie });
      assert.equal(filtered.response.status, 200);
      assert.equal(filtered.data.pagination.limit, 1);
      assert.ok(filtered.data.pagination.total >= 3);
      const stats = await request("/api/admin/stats", { cookie: adminCookie });
      assert.equal(stats.data.total_users, 3);
      assert.equal(stats.data.verified_users, 3);
      assert.equal(stats.data.suspended_users, 0);
    });

    await t.test("suspend requires a reason, blocks self-lockout and revokes player sessions", async () => {
      const self = await request(`/api/admin/users/${admin.rows[0].id}/suspend`, { method: "POST", cookie: adminCookie, csrf: adminCsrf, body: { reason: "Prevent self lockout" } });
      assert.equal(self.response.status, 409);
      const noReason = await request(`/api/admin/users/${player.rows[0].id}/suspend`, { method: "POST", cookie: adminCookie, csrf: adminCsrf, body: { reason: "" } });
      assert.equal(noReason.response.status, 400);
      const suspended = await request(`/api/admin/users/${player.rows[0].id}/suspend`, { method: "POST", cookie: adminCookie, csrf: adminCsrf, body: { reason: "Test policy violation" } });
      assert.equal(suspended.response.status, 200);
      assert.equal(suspended.data.status, "suspended");
      assert.equal((await request("/api/auth/me", { cookie: `cqrtv_session=${playerSession}` })).data.user, null);
      const loginDenied = await request("/api/auth/login", { method: "POST", body: { email: "player@example.test", password: playerPassword } });
      assert.equal(loginDenied.response.status, 401);
    });

    await t.test("unsuspend restores login access and writes an auditable record", async () => {
      const resumed = await request(`/api/admin/users/${player.rows[0].id}/unsuspend`, { method: "POST", cookie: adminCookie, csrf: adminCsrf, body: { reason: "Appeal reviewed" } });
      assert.equal(resumed.response.status, 200);
      assert.equal(resumed.data.status, "active");
      const restored = await request("/api/auth/login", { method: "POST", body: { email: "player@example.test", password: playerPassword } });
      assert.equal(restored.response.status, 200);
      const audit = await request("/api/admin/audit?limit=10&offset=0", { cookie: adminCookie });
      assert.equal(audit.response.status, 200);
      assert.deepEqual(audit.data.events.map(event => event.action), ["unsuspend", "suspend"]);
      assert.equal(audit.data.events[1].reason, "Test policy violation");
    });

    await t.test("suspending an admin revokes that admin session", async () => {
      const suspended = await request(`/api/admin/users/${admin.rows[0].id}/suspend`, { method: "POST", cookie: otherCookie, csrf: otherCsrf, body: { reason: "Admin access review" } });
      assert.equal(suspended.response.status, 200);
      assert.equal((await request("/api/admin/stats", { cookie: adminCookie })).response.status, 401);
      const restored = await request(`/api/admin/users/${admin.rows[0].id}/unsuspend`, { method: "POST", cookie: otherCookie, csrf: otherCsrf, body: { reason: "Access restored" } });
      assert.equal(restored.response.status, 200);
    });

    await t.test("logout clears separate admin cookie and invalidates session", async () => {
      const logout = await request("/api/admin/logout", { method: "POST", cookie: otherCookie, csrf: otherCsrf, body: {} });
      assert.equal(logout.response.status, 200);
      assert.match(logout.response.headers.get("set-cookie"), /Max-Age=0/);
      assert.equal((await request("/api/admin/stats", { cookie: otherCookie })).response.status, 401);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await app.pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  }
});


import crypto from "node:crypto";

const ADMIN_COOKIE = "cqrtv_admin_session";
const ADMIN_TTL_SECONDS = 8 * 60 * 60;
const ADMIN_LOCK_KEY = 70420261115;

function cookieValue(req, name) {
  const prefix = name + "=";
  return (req.headers.cookie || "").split(";").map(value => value.trim()).find(value => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function csrfFor(sessionToken) {
  return crypto.createHmac("sha256", sessionToken).update("cqrtv-admin-csrf-v1").digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "";
  return local.slice(0, 1) + "•••@" + domain;
}


export function createAdminRoutes(deps) {
  const { pool, json, body, tokenHash, cookie, sessionToken, verifyPassword, dummyPasswordHash, rateLimit, origin } = deps;

  function requireOrigin(req) {
    if (req.headers.origin !== origin) throw Object.assign(new Error("Origin rejected"), { status: 403 });
  }

  async function actorFor(req) {
    const rawAdminToken = cookieValue(req, ADMIN_COOKIE);
    if (rawAdminToken) {
      const result = await pool.query(
        "SELECT u.id,u.nickname,u.email,u.email_verified,u.is_admin,u.account_status FROM admin_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
        [tokenHash(rawAdminToken)]
      );
      if (result.rowCount) {
        const user = result.rows[0];
        if (user.is_admin && user.email_verified && user.account_status === "active") {
          return { user, rawToken: rawAdminToken, csrfToken: csrfFor(rawAdminToken) };
        }
        return { error: 403 };
      }
    }
    const playerToken = sessionToken(req);
    if (playerToken) {
      const result = await pool.query(
        "SELECT u.id,u.is_admin,u.account_status FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
        [tokenHash(playerToken)]
      );
      if (result.rowCount && result.rows[0].account_status === "active") return { error: 403 };
    }
    return { error: 401 };
  }

  async function authorize(req, res, needsCsrf = false) {
    let actor;
    try {
      if (needsCsrf) requireOrigin(req);
      actor = await actorFor(req);
    } catch (error) {
      json(res, error.status || 500, { error: error.status === 403 ? "Доступ запрещён." : "Не удалось проверить доступ." });
      return null;
    }
    if (actor.error) {
      json(res, actor.error, { error: actor.error === 401 ? "Требуется вход администратора." : "Доступ запрещён." });
      return null;
    }
    if (needsCsrf && !safeEqual(req.headers["x-csrf-token"], actor.csrfToken)) {
      json(res, 403, { error: "Проверка запроса не пройдена. Обновите страницу и повторите действие." });
      return null;
    }
    return actor;
  }

  async function listUsers(url, res) {
    const limitValue = Number(url.searchParams.get("limit") || 20);
    const offsetValue = Number(url.searchParams.get("offset") || 0);
    if (!Number.isInteger(limitValue) || limitValue < 1 || !Number.isInteger(offsetValue) || offsetValue < 0 || offsetValue > 1000000) {
      json(res, 400, { error: "Некорректная страница списка." });
      return;
    }
    const limit = Math.min(limitValue, 50);
    const clauses = [];
    const values = [];
    const q = String(url.searchParams.get("q") || "").trim().slice(0, 100).toLocaleLowerCase("en-US");
    if (q) {
      values.push(q);
      const index = values.length;
      clauses.push("(position($" + index + " in lower(nickname))>0 OR position($" + index + " in lower(email))>0)");
    }
    const status = url.searchParams.get("status") || "";
    if (status) {
      if (status !== "active" && status !== "suspended") {
        json(res, 400, { error: "Некорректный фильтр состояния." });
        return;
      }
      values.push(status);
      clauses.push("account_status=$" + values.length);
    }
    const verified = url.searchParams.get("email_verified");
    if (verified !== null && verified !== "") {
      if (verified !== "true" && verified !== "false") {
        json(res, 400, { error: "Некорректный фильтр подтверждения email." });
        return;
      }
      values.push(verified === "true");
      clauses.push("email_verified=$" + values.length);
    }
    const country = url.searchParams.get("country") || "";
    if (country) {
      if (!/^[A-Z]{2}$/.test(country)) {
        json(res, 400, { error: "Укажите двухбуквенный код страны." });
        return;
      }
      values.push(country);
      clauses.push("country=$" + values.length);
    }
    const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
    const counts = await pool.query("SELECT COUNT(*)::int AS total FROM users" + where, values);
    const pageValues = values.concat([limit, offsetValue]);
    const rows = await pool.query(
      "SELECT id,nickname,email,country,primary_role,secondary_roles,email_verified,account_status,created_at FROM users" +
      where + " ORDER BY created_at DESC,id DESC LIMIT $" + (pageValues.length - 1) + " OFFSET $" + pageValues.length,
      pageValues
    );
    json(res, 200, { users: rows.rows, pagination: { limit, offset: offsetValue, total: counts.rows[0].total } });
  }

  async function listAudit(url, res) {
    const limitValue = Number(url.searchParams.get("limit") || 20);
    const offsetValue = Number(url.searchParams.get("offset") || 0);
    if (!Number.isInteger(limitValue) || limitValue < 1 || !Number.isInteger(offsetValue) || offsetValue < 0 || offsetValue > 1000000) {
      json(res, 400, { error: "Некорректная страница журнала." });
      return;
    }
    const limit = Math.min(limitValue, 50);
    const count = await pool.query("SELECT COUNT(*)::int AS total FROM admin_audit_log");
    const rows = await pool.query(
      "SELECT a.id,a.action,a.reason,a.created_at,a.actor_user_id,actor.nickname AS actor_nickname,a.target_user_id,target.nickname AS target_nickname FROM admin_audit_log a JOIN users actor ON actor.id=a.actor_user_id JOIN users target ON target.id=a.target_user_id ORDER BY a.id DESC LIMIT $1 OFFSET $2",
      [limit, offsetValue]
    );
    json(res, 200, { events: rows.rows, pagination: { limit, offset: offsetValue, total: count.rows[0].total } });
  }

  async function changeStatus(req, res, match, actor) {
    const targetId = match[1];
    const action = match[2];
    if (targetId.length > 18 || !/^[1-9][0-9]*$/.test(targetId)) {
      json(res, 400, { error: "Некорректный идентификатор пользователя." });
      return;
    }
    const data = await body(req);
    const reason = String(data.reason || "").trim();
    if (reason.length < 5 || reason.length > 500) {
      json(res, 400, { error: "Укажите причину длиной от 5 до 500 символов." });
      return;
    }
    const desiredStatus = action === "suspend" ? "suspended" : "active";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [ADMIN_LOCK_KEY]);
      const locked = await client.query(
        "SELECT id,is_admin,email_verified,account_status FROM users WHERE id=$1 OR id=$2 ORDER BY id FOR UPDATE",
        [actor.user.id, targetId]
      );
      const currentActor = locked.rows.find(row => String(row.id) === String(actor.user.id));
      const target = locked.rows.find(row => String(row.id) === String(targetId));
      if (!currentActor || !currentActor.is_admin || !currentActor.email_verified || currentActor.account_status !== "active") {
        await client.query("ROLLBACK");
        json(res, 403, { error: "Доступ запрещён." });
        return;
      }
      if (!target) {
        await client.query("ROLLBACK");
        json(res, 404, { error: "Пользователь не найден." });
        return;
      }
      if (action === "suspend" && String(target.id) === String(actor.user.id)) {
        await client.query("ROLLBACK");
        json(res, 409, { error: "Нельзя приостановить собственный аккаунт." });
        return;
      }
      if (action === "suspend" && target.is_admin && target.account_status !== "suspended") {
        const admins = await client.query("SELECT COUNT(*)::int AS total FROM users WHERE is_admin=true AND email_verified=true AND account_status='active'");
        if (admins.rows[0].total <= 1) {
          await client.query("ROLLBACK");
          json(res, 409, { error: "Нельзя заблокировать последнего активного администратора." });
          return;
        }
      }
      if (target.account_status === desiredStatus) {
        await client.query("COMMIT");
        json(res, 200, { message: "Состояние уже установлено.", changed: false, status: desiredStatus });
        return;
      }
      await client.query("UPDATE users SET account_status=$1 WHERE id=$2", [desiredStatus, targetId]);
      if (action === "suspend") {
        await client.query("DELETE FROM sessions WHERE user_id=$1", [targetId]);
        await client.query("DELETE FROM admin_sessions WHERE user_id=$1", [targetId]);
      }
      await client.query(
        "INSERT INTO admin_audit_log(actor_user_id,target_user_id,action,reason) VALUES($1,$2,$3,$4)",
        [actor.user.id, targetId, action, reason]
      );
      await client.query("COMMIT");
      json(res, 200, { message: action === "suspend" ? "Аккаунт приостановлен." : "Аккаунт восстановлен.", changed: true, status: desiredStatus });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return async function handleAdminRoute(req, res) {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    if (!path.startsWith("/api/admin/")) return false;

    if (req.method === "POST" && path === "/api/admin/login") {
      try {
        requireOrigin(req);
      } catch {
        json(res, 403, { error: "Origin rejected." });
        return true;
      }
      if (rateLimit(req, "admin-login", 10, 900000)) {
        json(res, 429, { error: "Слишком много попыток входа. Попробуйте позже." });
        return true;
      }
      const data = await body(req);
      const email = String(data.email || "").trim().toLowerCase();
      const password = String(data.password || "");
      const found = email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ? await pool.query("SELECT id,nickname,email,password_hash,email_verified,is_admin,account_status FROM users WHERE email=$1", [email])
        : { rowCount: 0, rows: [] };
      const encoded = found.rowCount ? found.rows[0].password_hash : dummyPasswordHash;
      let passwordMatches = false;
      try {
        passwordMatches = await verifyPassword(password.slice(0, 128), encoded);
      } catch {
        passwordMatches = false;
      }
      const user = found.rows[0];
      if (!user || password.length > 128 || !passwordMatches || !user.email_verified || !user.is_admin || user.account_status !== "active") {
        json(res, 401, { error: "Неверные данные или нет доступа." });
        return true;
      }
      const raw = crypto.randomBytes(32).toString("base64url");
      const expires = new Date(Date.now() + ADMIN_TTL_SECONDS * 1000);
      await pool.query("INSERT INTO admin_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", [tokenHash(raw), user.id, expires]);
      json(res, 200, {
        user: { id: user.id, nickname: user.nickname, emailMasked: maskEmail(user.email) },
        csrfToken: csrfFor(raw)
      }, { "Set-Cookie": cookie(ADMIN_COOKIE, raw, ADMIN_TTL_SECONDS) });
      return true;
    }

    if (req.method === "POST" && path === "/api/admin/logout") {
      try {
        requireOrigin(req);
      } catch {
        json(res, 403, { error: "Origin rejected." });
        return true;
      }
      const raw = cookieValue(req, ADMIN_COOKIE);
      if (raw) {
        const actor = await actorFor(req);
        if (!actor.error && !safeEqual(req.headers["x-csrf-token"], actor.csrfToken)) {
          json(res, 403, { error: "Проверка запроса не пройдена." });
          return true;
        }
        await pool.query("DELETE FROM admin_sessions WHERE token_hash=$1", [tokenHash(raw)]);
      }
      json(res, 200, { message: "Вы вышли из панели." }, { "Set-Cookie": cookie(ADMIN_COOKIE, "", 0) });
      return true;
    }

    const needsCsrf = req.method === "POST";
    const actor = await authorize(req, res, needsCsrf);
    if (!actor) return true;

    if (req.method === "GET" && path === "/api/admin/me") {
      json(res, 200, { user: { id: actor.user.id, nickname: actor.user.nickname, emailMasked: maskEmail(actor.user.email) }, csrfToken: actor.csrfToken });
      return true;
    }

    if (req.method === "GET" && path === "/api/admin/stats") {
      const result = await pool.query(
        "SELECT COUNT(*)::int AS total_users,COUNT(*) FILTER (WHERE email_verified=true)::int AS verified_users,COUNT(*) FILTER (WHERE account_status='suspended')::int AS suspended_users FROM users"
      );
      json(res, 200, result.rows[0]);
      return true;
    }

    if (req.method === "GET" && path === "/api/admin/users") {
      await listUsers(url, res);
      return true;
    }

    if (req.method === "GET" && path === "/api/admin/audit") {
      await listAudit(url, res);
      return true;
    }

    const mutation = req.method === "POST" && path.match(/^\/api\/admin\/users\/([1-9][0-9]*)\/(suspend|unsuspend)$/);
    if (mutation) {
      await changeStatus(req, res, mutation, actor);
      return true;
    }

    json(res, 404, { error: "Not found." });
    return true;
  };
}


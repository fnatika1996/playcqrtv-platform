import crypto from "node:crypto";

const modes = new Set(["open", "coming_soon", "maintenance"]);
const iconKeys = new Set(["chat", "play", "mail", "home", "users", "gamepad", "ranking"]);
const assetKinds = new Set(["background", "social"]);
const maxAssetBytes = 2 * 1024 * 1024;
const defaultSettings = {
  mode: "open", heading: "CQRTV скоро откроется", subtitle: "Новая платформа для игроков Counter-Strike 2",
  description: "Мы готовим пространство для игроков и команд: подбор матчей, турниры, статистика и развитие esports-сцены.",
  statusLabel: "ПЛАТФОРМА ГОТОВИТСЯ", maintenanceHeading: "CQRTV на техобслуживании",
  maintenanceSubtitle: "Мы настраиваем платформу и скоро вернёмся.", maintenanceDescription: "Проводятся технические работы",
  maintenanceStatusLabel: "ТЕХНИЧЕСКИЕ РАБОТЫ", launchAt: "", countdownEnabled: false,
  aboutButtonLabel: "Что такое CQRTV?", aboutTitle: "Играй. Объединяйся. Развивайся.",
  aboutBody: "CQRTV — будущая платформа Counter-Strike 2 для игроков и команд. Здесь можно будет находить партнёров, собирать составы, играть матчи, участвовать в турнирах, следить за статистикой и вместе развивать esports-сцену.",
  animationEnabled: true, backgroundAssetId: null
};

function cookieValue(req, name) {
  const prefix = name + "=";
  return (req.headers.cookie || "").split(";").map(value => value.trim()).find(value => value.startsWith(prefix))?.slice(prefix.length) || "";
}

export function safeHttpsUrl(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function decodeImageUpload({ mimeType, base64, kind }) {
  if (!assetKinds.has(kind) || !["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
    throw Object.assign(new Error("Unsupported image type."), { status: 400 });
  }
  if (typeof base64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw Object.assign(new Error("Invalid image data."), { status: 400 });
  }
  const data = Buffer.from(base64, "base64");
  if (!data.length || data.length > maxAssetBytes || data.toString("base64") !== base64) {
    throw Object.assign(new Error("Image must be no larger than 2 MB."), { status: 400 });
  }
  const png = data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255;
  const webp = data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
  if ((mimeType === "image/png" && !png) || (mimeType === "image/jpeg" && !jpeg) || (mimeType === "image/webp" && !webp)) {
    throw Object.assign(new Error("Image signature does not match its content type."), { status: 400 });
  }
  return data;
}

function settingsView(row) {
  if (!row) return { ...defaultSettings };
  return {
    mode: row.mode,
    heading: row.heading,
    subtitle: row.subtitle,
    description: row.description,
    statusLabel: row.status_label,
    maintenanceHeading: row.maintenance_heading,
    maintenanceSubtitle: row.maintenance_subtitle,
    maintenanceDescription: row.maintenance_description,
    maintenanceStatusLabel: row.maintenance_status_label,
    launchAt: row.launch_at ? new Date(row.launch_at).toISOString() : "",
    countdownEnabled: row.countdown_enabled,
    aboutButtonLabel: row.about_button_label,
    aboutTitle: row.about_title,
    aboutBody: row.about_body,
    animationEnabled: row.animation_enabled,
    backgroundAssetId: row.background_asset_id
  };
}

export function validateSiteSettings(input) {
  const text = (key, max) => {
    const value = typeof input[key] === "string" ? input[key].trim() : "";
    if (!value || value.length > max) throw Object.assign(new Error("Проверьте заполнение полей настроек."), { status: 400 });
    return value;
  };
  if (!input || !modes.has(input.mode)) throw Object.assign(new Error("Выберите корректный режим сайта."), { status: 400 });
  let launchAt = null;
  if (input.launchAt !== undefined && input.launchAt !== null && input.launchAt !== "") {
    const date = new Date(input.launchAt);
    if (!Number.isFinite(date.getTime())) throw Object.assign(new Error("Укажите корректные дату и время запуска."), { status: 400 });
    launchAt = date.toISOString();
  }
  if (typeof input.countdownEnabled !== "boolean" || typeof input.animationEnabled !== "boolean") {
    throw Object.assign(new Error("Проверьте значения переключателей."), { status: 400 });
  }
  if (input.backgroundAssetId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.backgroundAssetId)) {
    throw Object.assign(new Error("Некорректная фоновая иллюстрация."), { status: 400 });
  }
  return {
    mode: input.mode,
    heading: text("heading", 120),
    subtitle: text("subtitle", 180),
    description: text("description", 1200),
    statusLabel: text("statusLabel", 60),
    maintenanceHeading: text("maintenanceHeading", 120),
    maintenanceSubtitle: text("maintenanceSubtitle", 180),
    maintenanceDescription: text("maintenanceDescription", 1200),
    maintenanceStatusLabel: text("maintenanceStatusLabel", 60),
    launchAt,
    countdownEnabled: input.countdownEnabled,
    aboutButtonLabel: text("aboutButtonLabel", 60),
    aboutTitle: text("aboutTitle", 120),
    aboutBody: text("aboutBody", 4000),
    animationEnabled: input.animationEnabled,
    backgroundAssetId: input.backgroundAssetId || null
  };
}

export function createSiteControlRoutes({ pool, json, body, tokenHash }) {
  async function currentSettings() {
    const result = await pool.query("SELECT * FROM site_control_settings WHERE id=1");
    if (!result.rowCount || !modes.has(result.rows[0].mode)) throw new Error("Site settings are unavailable.");
    return result.rows[0];
  }

  async function isActiveAdmin(req) {
    const raw = cookieValue(req, "cqrtv_admin_session");
    if (!raw) return false;
    const result = await pool.query(
      "SELECT 1 FROM admin_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_admin=true AND u.email_verified=true AND u.account_status='active'",
      [tokenHash(raw)]
    );
    return result.rowCount > 0;
  }

  async function blocked(req) {
    if (await isActiveAdmin(req)) return false;
    const settings = await currentSettings();
    return settings.mode !== "open";
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/api/site-control/gate") {
      const originalUri = String(req.headers["x-forwarded-uri"] || "").split("?")[0];
      const adminPage = originalUri === "/admin" || originalUri === "/admin.html" || originalUri === "/admin/site-control" || originalUri === "/site-control-admin.html";
      const admin = await isActiveAdmin(req);
      if (adminPage && !admin) {
        json(res, 401, { error: "Требуется вход администратора." });
        return true;
      }
      const settings = admin ? null : await currentSettings();
      res.writeHead(204, {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-CQRTV-Site-Mode": admin ? "admin-preview" : settings.mode
      });
      res.end();
      return true;
    }

    if (req.method === "GET" && path === "/api/site-control/public") {
      const settings = settingsView(await currentSettings());
      const links = await pool.query(
        "SELECT id,label,url,icon_key,icon_asset_id,sort_order FROM site_control_social_links WHERE enabled=true ORDER BY sort_order,id"
      );
      json(res, 200, {
        ...settings,
        socialLinks: links.rows.filter(row => safeHttpsUrl(row.url)).map(row => ({
          id: row.id, label: row.label, url: safeHttpsUrl(row.url), iconKey: row.icon_key, iconAssetId: row.icon_asset_id
        }))
      });
      return true;
    }

    const media = req.method === "GET" && path.match(/^\/api\/site-control\/media\/([0-9a-f-]{36})$/i);
    if (media) {
      const result = await pool.query("SELECT mime_type,data FROM site_control_assets WHERE id=$1", [media[1]]);
      if (!result.rowCount) {
        json(res, 404, { error: "Файл не найден." });
        return true;
      }
      res.writeHead(200, {
        "Content-Type": result.rows[0].mime_type,
        "Content-Length": result.rows[0].data.length,
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff"
      });
      res.end(result.rows[0].data);
      return true;
    }

    return false;
  }

  return { handle, blocked, isActiveAdmin };
}

export function createSiteControlAdminRoutes({ pool, json, body }) {
  return async function handleAdminSiteControl(req, res) {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/api/admin/site-control") {
      const [settings, links] = await Promise.all([
        pool.query("SELECT * FROM site_control_settings WHERE id=1"),
        pool.query("SELECT id,label,url,icon_key,icon_asset_id,enabled,sort_order FROM site_control_social_links ORDER BY sort_order,id")
      ]);
      json(res, 200, {
        settings: settingsView(settings.rows[0]),
        socialLinks: links.rows.map(row => ({
          id: row.id, label: row.label, url: row.url, iconKey: row.icon_key,
          iconAssetId: row.icon_asset_id, enabled: row.enabled, sortOrder: row.sort_order
        }))
      });
      return true;
    }

    if (req.method === "POST" && path === "/api/admin/site-control/settings") {
      const settings = validateSiteSettings(await body(req, 16384));
      const previousBackground = await pool.query("SELECT background_asset_id FROM site_control_settings WHERE id=1");
      if (settings.backgroundAssetId) {
        const asset = await pool.query("SELECT 1 FROM site_control_assets WHERE id=$1 AND kind='background'", [settings.backgroundAssetId]);
        if (!asset.rowCount) return json(res, 400, { error: "Фоновый файл не найден." }), true;
      }
      const result = await pool.query(
        "INSERT INTO site_control_settings(id,mode,heading,subtitle,description,status_label,maintenance_heading,maintenance_subtitle,maintenance_description,maintenance_status_label,launch_at,countdown_enabled,about_button_label,about_title,about_body,animation_enabled,background_asset_id) VALUES(1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(id) DO UPDATE SET mode=EXCLUDED.mode,heading=EXCLUDED.heading,subtitle=EXCLUDED.subtitle,description=EXCLUDED.description,status_label=EXCLUDED.status_label,maintenance_heading=EXCLUDED.maintenance_heading,maintenance_subtitle=EXCLUDED.maintenance_subtitle,maintenance_description=EXCLUDED.maintenance_description,maintenance_status_label=EXCLUDED.maintenance_status_label,launch_at=EXCLUDED.launch_at,countdown_enabled=EXCLUDED.countdown_enabled,about_button_label=EXCLUDED.about_button_label,about_body=EXCLUDED.about_body,about_title=EXCLUDED.about_title,animation_enabled=EXCLUDED.animation_enabled,background_asset_id=EXCLUDED.background_asset_id,updated_at=now() RETURNING *",
        [settings.mode,settings.heading,settings.subtitle,settings.description,settings.statusLabel,settings.maintenanceHeading,settings.maintenanceSubtitle,settings.maintenanceDescription,settings.maintenanceStatusLabel,settings.launchAt,settings.countdownEnabled,settings.aboutButtonLabel,settings.aboutTitle,settings.aboutBody,settings.animationEnabled,settings.backgroundAssetId]
      );
      const previousAsset = previousBackground.rows[0]?.background_asset_id;
      if (previousAsset && previousAsset !== settings.backgroundAssetId) await pool.query("DELETE FROM site_control_assets a WHERE a.id=$1 AND NOT EXISTS (SELECT 1 FROM site_control_settings WHERE background_asset_id=a.id) AND NOT EXISTS (SELECT 1 FROM site_control_social_links WHERE icon_asset_id=a.id)", [previousAsset]);
      json(res, 200, { settings: settingsView(result.rows[0]) });
      return true;
    }

    if (req.method === "POST" && path === "/api/admin/site-control/assets") {
      const data = await body(req, 3 * 1024 * 1024);
      const kind = data.kind;
      const bytes = decodeImageUpload({ mimeType: data.mimeType, base64: data.base64, kind });
      const id = crypto.randomUUID();
      await pool.query("INSERT INTO site_control_assets(id,kind,mime_type,data) VALUES($1,$2,$3,$4)", [id,kind,data.mimeType,bytes]);
      json(res, 201, { id, url: "/api/site-control/media/" + id });
      return true;
    }

    if (req.method === "POST" && path === "/api/admin/site-control/social-links") {
      const data = await body(req, 16384);
      const id = data.id || crypto.randomUUID();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        json(res, 400, { error: "Некорректная ссылка." }); return true;
      }
      const label = typeof data.label === "string" ? data.label.trim() : "";
      const href = safeHttpsUrl(data.url);
      const iconKey = data.iconKey;
      const sortOrder = Number(data.sortOrder);
      if (!label || label.length > 40 || !href || !iconKeys.has(iconKey) || typeof data.enabled !== "boolean" || !Number.isInteger(sortOrder) || sortOrder < -1000 || sortOrder > 1000) {
        json(res, 400, { error: "Проверьте название, HTTPS-ссылку и параметры отображения." }); return true;
      }
      const iconAssetId = data.iconAssetId || null;
      if (iconAssetId) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(iconAssetId)) {
          json(res, 400, { error: "Некорректная иконка." }); return true;
        }
        const asset = await pool.query("SELECT 1 FROM site_control_assets WHERE id=$1 AND kind='social'", [iconAssetId]);
        if (!asset.rowCount) { json(res, 400, { error: "Загруженная иконка не найдена." }); return true; }
      }
      const previous = await pool.query("SELECT icon_asset_id FROM site_control_social_links WHERE id=$1", [id]);
      const result = await pool.query(
        "INSERT INTO site_control_social_links(id,label,url,icon_key,icon_asset_id,enabled,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET label=EXCLUDED.label,url=EXCLUDED.url,icon_key=EXCLUDED.icon_key,icon_asset_id=EXCLUDED.icon_asset_id,enabled=EXCLUDED.enabled,sort_order=EXCLUDED.sort_order,updated_at=now() RETURNING id,label,url,icon_key,icon_asset_id,enabled,sort_order",
        [id,label,href,iconKey,iconAssetId,data.enabled,sortOrder]
      );
      const previousAsset = previous.rows[0]?.icon_asset_id;
      if (previousAsset && previousAsset !== iconAssetId) {
        await pool.query("DELETE FROM site_control_assets a WHERE a.id=$1 AND NOT EXISTS (SELECT 1 FROM site_control_settings WHERE background_asset_id=a.id) AND NOT EXISTS (SELECT 1 FROM site_control_social_links WHERE icon_asset_id=a.id)", [previousAsset]);
      }
      const row = result.rows[0];
      json(res, 200, { socialLink: { id:row.id,label:row.label,url:row.url,iconKey:row.icon_key,iconAssetId:row.icon_asset_id,enabled:row.enabled,sortOrder:row.sort_order } });
      return true;
    }

    const removeLink = req.method === "POST" && path.match(/^\/api\/admin\/site-control\/social-links\/([0-9a-f-]{36})\/delete$/i);
    if (removeLink) {
      const existing = await pool.query("SELECT icon_asset_id FROM site_control_social_links WHERE id=$1", [removeLink[1]]);
      await pool.query("DELETE FROM site_control_social_links WHERE id=$1", [removeLink[1]]);
      if (existing.rows[0]?.icon_asset_id) await pool.query("DELETE FROM site_control_assets a WHERE a.id=$1 AND NOT EXISTS (SELECT 1 FROM site_control_settings WHERE background_asset_id=a.id) AND NOT EXISTS (SELECT 1 FROM site_control_social_links WHERE icon_asset_id=a.id)", [existing.rows[0].icon_asset_id]);
      json(res, 200, { ok: true });
      return true;
    }

    const removeAsset = req.method === "POST" && path.match(/^\/api\/admin\/site-control\/assets\/([0-9a-f-]{36})\/delete$/i);
    if (removeAsset) {
      const id = removeAsset[1];
      await pool.query("UPDATE site_control_settings SET background_asset_id=NULL WHERE background_asset_id=$1", [id]);
      await pool.query("UPDATE site_control_social_links SET icon_asset_id=NULL WHERE icon_asset_id=$1", [id]);
      await pool.query("DELETE FROM site_control_assets WHERE id=$1", [id]);
      json(res, 200, { ok: true });
      return true;
    }

    const reorder = req.method === "POST" && path === "/api/admin/site-control/social-links/reorder";
    if (reorder) {
      const data = await body(req, 16384);
      if (!Array.isArray(data.ids) || data.ids.length > 50 || data.ids.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) {
        json(res, 400, { error: "Некорректный порядок ссылок." }); return true;
      }
      const current = await pool.query("SELECT id FROM site_control_social_links");
      const expected = new Set(current.rows.map(row => String(row.id)));
      const supplied = new Set(data.ids);
      if (expected.size !== supplied.size || [...expected].some(id => !supplied.has(id)) || supplied.size !== data.ids.length) {
        json(res, 400, { error: "Список ссылок изменился. Обновите страницу." }); return true;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (let i = 0; i < data.ids.length; i++) await client.query("UPDATE site_control_social_links SET sort_order=$1,updated_at=now() WHERE id=$2", [i, data.ids[i]]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK"); throw error;
      } finally {
        client.release();
      }
      json(res, 200, { ok: true });
      return true;
    }

    return false;
  };
}

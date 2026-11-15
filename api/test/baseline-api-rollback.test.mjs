import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

const { Client } = pg;
const baselineSha = process.env.BASELINE_SHA;
const adminConnectionString = process.env.ADMIN_TEST_DATABASE_URL;

if (!baselineSha || !/^[0-9a-f]{40}$/i.test(baselineSha)) {
  throw new Error("BASELINE_SHA must identify the PR base commit.");
}
if (!adminConnectionString || !new URL(adminConnectionString).pathname.toLowerCase().includes("test")) {
  throw new Error("ADMIN_TEST_DATABASE_URL must point to a disposable test database.");
}

const admin = new Client({ connectionString: adminConnectionString });
const localPassword = "qa-only-cqrtv-password";
const legacyPort = 3000;
let roleCreated = false;
let databaseCreated = false;
let app;
let currentServer;
let legacyProcess;
let tempDir;

async function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, result) => error ? reject(error) : resolve(result));
  });
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function waitForHealth(url, processRef, logs) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) {
      throw new Error(`Baseline API exited early (${processRef.exitCode}): ${logs.join("").slice(-4000)}`);
    }
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Baseline API did not become healthy: ${logs.join("").slice(-4000)}`);
}

try {
  await admin.connect();
  const existingRole = await admin.query("SELECT 1 FROM pg_roles WHERE rolname='cqrtv'");
  const existingDb = await admin.query("SELECT 1 FROM pg_database WHERE datname='cqrtv'");
  if (existingRole.rowCount || existingDb.rowCount) {
    throw new Error("Refusing to reuse an existing role/database in the compatibility test.");
  }

  await admin.query(`CREATE ROLE cqrtv LOGIN PASSWORD '${localPassword}'`);
  roleCreated = true;
  await admin.query("CREATE DATABASE cqrtv OWNER cqrtv");
  databaseCreated = true;

  const testUrl = new URL(adminConnectionString);
  testUrl.username = "cqrtv";
  testUrl.password = localPassword;
  testUrl.pathname = "/cqrtv";
  testUrl.search = "";
  process.env.DATABASE_URL = testUrl.toString();
  process.env.APP_ORIGIN = "https://playcqrtv.com";
  process.env.NODE_ENV = "test";

  app = await import(`../server.mjs?baseline-compat=${Date.now()}`);
  await app.init();

  const password = "SyntheticTestPassword123!";
  const inserted = await app.pool.query(
    "INSERT INTO users(nickname,email,password_hash,country,primary_role,email_verified,account_status) VALUES($1,$2,$3,'US','rifler',true,'suspended') RETURNING id",
    ["rollback-test", "rollback-test@example.test", await passwordHash(password)]
  );
  assert.equal(inserted.rowCount, 1, "synthetic suspended user should be created only in the disposable CI database");

  currentServer = app.createHttpServer();
  await new Promise((resolve, reject) => {
    currentServer.once("error", reject);
    currentServer.listen(0, "127.0.0.1", resolve);
  });
  const currentBase = `http://127.0.0.1:${currentServer.address().port}`;
  const currentLogin = await fetch(`${currentBase}/api/auth/login`, {
    method: "POST",
    headers: { Origin: process.env.APP_ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "rollback-test@example.test", password })
  });
  assert.equal(currentLogin.status, 401, "PR API must reject a suspended synthetic account");

  const root = process.cwd();
  const legacyServerSource = execFileSync("git", ["show", `${baselineSha}:api/server.mjs`], { cwd: root, encoding: "utf8" });
  const legacyPasswordPolicy = execFileSync("git", ["show", `${baselineSha}:api/password-policy.mjs`], { cwd: root, encoding: "utf8" });
  const apiRoot = path.join(root, "api");
  tempDir = fs.mkdtempSync(path.join(apiRoot, ".baseline-compat-"));
  const legacyServerPath = path.join(tempDir, "server.mjs");
  fs.writeFileSync(legacyServerPath, legacyServerSource);
  fs.writeFileSync(path.join(tempDir, "password-policy.mjs"), legacyPasswordPolicy);
  const passwordFile = path.join(tempDir, "db-password");
  fs.writeFileSync(passwordFile, localPassword, { mode: 0o600 });

  const logs = [];
  legacyProcess = spawn(process.execPath, [legacyServerPath], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DB_PASSWORD_FILE: passwordFile,
      DATABASE_URL: "",
      APP_ORIGIN: process.env.APP_ORIGIN
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  legacyProcess.stdout.on("data", chunk => logs.push(chunk.toString()));
  legacyProcess.stderr.on("data", chunk => logs.push(chunk.toString()));

  await waitForHealth(`http://127.0.0.1:${legacyPort}/api/health`, legacyProcess, logs);
  const baselineLogin = await fetch(`http://127.0.0.1:${legacyPort}/api/auth/login`, {
    method: "POST",
    headers: { Origin: process.env.APP_ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "rollback-test@example.test", password })
  });
  assert.equal(baselineLogin.status, 200,
    "characterization: baseline API accepts a suspended account, so it is not a safe API rollback after suspend actions");

  console.log("PASS: baseline API starts on the additive migrated schema.");
  console.log("CONFIRMED LIMITATION: baseline API authenticates the synthetic suspended account; do not API-rollback after suspend actions.");
} finally {
  if (legacyProcess && legacyProcess.exitCode === null) {
    legacyProcess.kill("SIGTERM");
    await Promise.race([
      new Promise(resolve => legacyProcess.once("exit", resolve)),
      delay(5000)
    ]);
    if (legacyProcess.exitCode === null) legacyProcess.kill("SIGKILL");
  }
  if (currentServer?.listening) {
    await new Promise(resolve => currentServer.close(resolve));
  }
  if (app?.pool) await app.pool.end();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (databaseCreated) await admin.query("DROP DATABASE cqrtv");
  if (roleCreated) await admin.query("DROP ROLE cqrtv");
  await admin.end();
}

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessExpectedContainers,
  deployCompose,
  validateSavedCompose,
  waitForHostingerAction
} from "./hostinger-deploy.mjs";

const vmId = "2150572";
const webImageRef = "ghcr.io/fnatika1996/playcqrtv-platform:latest";
const apiImageRef = "ghcr.io/fnatika1996/playcqrtv-api:latest";
const token = "test-only-token";
const savedCompose = [
  "services:",
  "  secret-init:",
  "    image: alpine:3.21",
  "    volumes:",
  "      - db_secret:/run/db-secret",
  "  db:",
  "    image: postgres:17-alpine",
  "    volumes:",
  "      - postgres_data:/var/lib/postgresql/data",
  "      - db_secret:/run/db-secret:ro",
  "  api:",
  "    image: " + apiImageRef,
  "    pull_policy: always",
  "    volumes:",
  "      - db_secret:/run/db-secret:ro",
  "  caddy:",
  "    image: " + webImageRef,
  "    pull_policy: always",
  "    volumes:",
  "      - caddy_data:/data",
  "      - caddy_config:/config",
  "volumes:",
  "  caddy_data:",
  "  caddy_config:",
  "  postgres_data:",
  "  db_secret:"
].join("\n");

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function containers() {
  return [
    { id: "web1", name: "playcqrtv-web", image: webImageRef, state: "running", health: "healthy" },
    { id: "api1", name: "playcqrtv-api", image: apiImageRef, state: "running", health: "none" }
  ];
}

test("saved Compose preflight accepts only current latest refs, pull policy and protected volume bindings", () => {
  assert.doesNotThrow(() => validateSavedCompose(savedCompose, { webImageRef, apiImageRef }));
  assert.throws(
    () => validateSavedCompose(savedCompose.replace(webImageRef, "ghcr.io/fnatika1996/playcqrtv-platform:old"), { webImageRef, apiImageRef }),
    /failed image and volume preflight/
  );
  assert.throws(
    () => validateSavedCompose(savedCompose.replace("caddy_data:/data", "postgres_data:/data"), { webImageRef, apiImageRef }),
    /failed image and volume preflight/
  );
  assert.throws(
    () => validateSavedCompose(savedCompose.replace("pull_policy: always", "pull_policy: missing"), { webImageRef, apiImageRef }),
    /failed image and volume preflight/
  );
});

test("preflight runs before one existing-project UPDATE, action completion and readback of latest refs", async () => {
  const calls = [];
  let actionPolls = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === "GET" && String(url).endsWith("/docker/playcqrtv")) {
      return response({ content: savedCompose, environment: "must not be logged" });
    }
    if (options.method === "POST" && String(url).endsWith("/docker/playcqrtv/update")) {
      return response({ id: 8123712, name: "docker.compose.update", state: "pending" });
    }
    if (String(url).endsWith("/actions/8123712")) {
      actionPolls += 1;
      return response({ id: 8123712, state: actionPolls === 1 ? "running" : "completed" });
    }
    if (String(url).endsWith("/docker/playcqrtv/containers")) return response(containers());
    throw new Error("unexpected mock request");
  };

  const result = await deployCompose({
    fetchImpl, token, vmId, webImageRef, apiImageRef,
    delayMs: 0, sleep: async () => {}
  });

  assert.equal(result.actionId, 8123712);
  assert.equal(calls.length, 5);
  assert.match(calls[0].url, /\/virtual-machines\/2150572\/docker\/playcqrtv$/);
  assert.equal(calls[0].options.method, "GET");
  assert.match(calls[1].url, /\/virtual-machines\/2150572\/docker\/playcqrtv\/update$/);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.body, undefined);
  assert.equal(calls.some(call => call.url.endsWith("/virtual-machines/2150572/docker")), false, "create/replace endpoint must not be called");
  assert.match(calls[2].url, /\/actions\/8123712$/);
  assert.match(calls[4].url, /\/docker\/playcqrtv\/containers$/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer " + token);
});

test("missing or mismatched saved Compose fails before any update mutation", async t => {
  await t.test("wrong image refs", async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ content: savedCompose.replace(apiImageRef, "ghcr.io/fnatika1996/playcqrtv-api:wrong") });
    };
    await assert.rejects(
      deployCompose({ fetchImpl, token, webImageRef, apiImageRef }),
      /failed image and volume preflight/
    );
    assert.equal(calls.length, 1);
  });
  await t.test("wrong volume binding", async () => {
    let posts = 0;
    const fetchImpl = async (url, options) => {
      if (options.method === "POST") posts += 1;
      return response({ content: savedCompose.replace("db_secret:/run/db-secret:ro", "postgres_data:/run/db-secret:ro") });
    };
    await assert.rejects(
      deployCompose({ fetchImpl, token, webImageRef, apiImageRef }),
      /failed image and volume preflight/
    );
    assert.equal(posts, 0);
  });
  await t.test("missing content", async () => {
    const fetchImpl = async () => response({ environment: "not inspected or logged" });
    await assert.rejects(
      deployCompose({ fetchImpl, token, webImageRef, apiImageRef }),
      /saved Compose content is missing/
    );
  });
});

test("a terminal Hostinger UPDATE action failure stops before container readback", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === "GET" && String(url).endsWith("/docker/playcqrtv")) return response({ content: savedCompose });
    if (options.method === "POST") return response({ id: 501, state: "pending" });
    return response({ id: 501, state: "failed" });
  };
  await assert.rejects(
    deployCompose({ fetchImpl, token, webImageRef, apiImageRef, delayMs: 0, sleep: async () => {} }),
    /finished with a failure state/
  );
  assert.equal(calls.length, 3);
  assert.equal(calls.some(call => call.url.endsWith("/containers")), false);
});

test("unknown action states, invalid IDs, and timeouts fail closed without repeating UPDATE", async t => {
  await t.test("unknown state", async () => {
    const fetchImpl = async () => response({ id: 88, state: "mystery-state" });
    await assert.rejects(
      waitForHostingerAction({ fetchImpl, token, vmId, actionId: 88, initialState: "mystery-state" }),
      /unknown state/
    );
  });
  await t.test("invalid action ID", async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url: String(url), options });
      if (options.method === "GET") return response({ content: savedCompose });
      return response({ state: "pending" });
    };
    await assert.rejects(
      deployCompose({ fetchImpl, token, webImageRef, apiImageRef }),
      /valid action ID/
    );
    assert.equal(calls.filter(call => call.options.method === "POST").length, 1);
  });
  await t.test("mismatched polled ID", async () => {
    const fetchImpl = async () => response({ id: 12, state: "completed" });
    await assert.rejects(
      waitForHostingerAction({ fetchImpl, token, vmId, actionId: 11, initialState: "pending" }),
      /did not match/
    );
  });
  await t.test("timeout", async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url: String(url), options });
      if (options.method === "GET" && String(url).endsWith("/docker/playcqrtv")) return response({ content: savedCompose });
      if (options.method === "POST") return response({ id: 77, state: "pending" });
      return response({ id: 77, state: "running" });
    };
    await assert.rejects(
      deployCompose({
        fetchImpl, token, webImageRef, apiImageRef,
        actionAttempts: 2, delayMs: 0, sleep: async () => {}
      }),
      /did not finish before the timeout/
    );
    assert.equal(calls.filter(call => call.options.method === "POST").length, 1);
    assert.equal(calls.some(call => call.url.endsWith("/containers")), false);
  });
});

test("documented container list schema requires expected latest refs and running health", async t => {
  await t.test("running refs with healthy and no-healthcheck states are ready", () => {
    assert.equal(assessExpectedContainers(containers(), { webImageRef, apiImageRef }), true);
  });
  await t.test("starting or stopped containers are not ready", () => {
    assert.equal(assessExpectedContainers([
      { name: "web", image: webImageRef, state: "running", health: "starting" },
      { name: "api", image: apiImageRef, state: "running", health: "healthy" }
    ], { webImageRef, apiImageRef }), false);
    assert.equal(assessExpectedContainers([
      { name: "web", image: webImageRef, state: "running" },
      { name: "api", image: apiImageRef, state: "exited" }
    ], { webImageRef, apiImageRef }), false);
  });
  await t.test("malformed shape and duplicate image refs fail closed", () => {
    assert.throws(() => assessExpectedContainers({ data: containers() }, { webImageRef, apiImageRef }), /documented container list/);
    assert.throws(() => assessExpectedContainers([
      ...containers(), { name: "web duplicate", image: webImageRef, state: "running" }
    ], { webImageRef, apiImageRef }), /duplicate containers/);
    assert.throws(() => assessExpectedContainers([
      { name: "web", image: webImageRef, state: "running" },
      { name: "api", image: apiImageRef, state: 1 }
    ], { webImageRef, apiImageRef }), /non-string state/);
  });
});

test("API failures do not log response bodies or leak token/environment text", async () => {
  const fetchImpl = async () => new Response("production-secret-body", { status: 500 });
  await assert.rejects(
    deployCompose({ fetchImpl, token, webImageRef, apiImageRef }),
    error => {
      assert.doesNotMatch(error.message, /production-secret-body|test-only-token/);
      assert.match(error.message, /HTTP 500/);
      return true;
    }
  );
});

test("transient action and container errors retry only read-only requests", async () => {
  const calls = [];
  let actionPolls = 0;
  let containerPolls = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === "GET" && String(url).endsWith("/docker/playcqrtv")) return response({ content: savedCompose });
    if (options.method === "POST") return response({ id: 61, state: "pending" });
    if (String(url).endsWith("/actions/61")) {
      actionPolls += 1;
      if (actionPolls === 1) return response({ error: "unlogged test body" }, 503);
      return response({ id: 61, state: "success" });
    }
    containerPolls += 1;
    if (containerPolls === 1) return response({ error: "unlogged test body" }, 429);
    return response(containers());
  };
  await deployCompose({
    fetchImpl, token, webImageRef, apiImageRef,
    delayMs: 0, sleep: async () => {}
  });
  assert.equal(calls.filter(call => call.options.method === "POST").length, 1);
  assert.equal(actionPolls, 2);
  assert.equal(containerPolls, 2);
});

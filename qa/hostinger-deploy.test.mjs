import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessExpectedContainers,
  deployCompose,
  waitForHostingerAction
} from "./hostinger-deploy.mjs";

const vmId = "2150572";
const webImageRef = "ghcr.io/fnatika1996/playcqrtv-platform@sha256:" + "a".repeat(64);
const apiImageRef = "ghcr.io/fnatika1996/playcqrtv-api@sha256:" + "b".repeat(64);
const token = "test-only-token";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function containers(overrides = {}) {
  return [
    { id: "web1", name: "playcqrtv-caddy-1", image: webImageRef, state: "running", health: "healthy" },
    { id: "api1", name: "playcqrtv-api-1", image: apiImageRef, state: "running", health: "none" },
    ...overrides.extra || []
  ];
}

test("deploy posts one complete manifest, polls action success, then verifies both running digest refs", async () => {
  const calls = [];
  let actionPolls = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === "POST") return response({ id: 8123712, name: "docker.compose.up", state: "pending" });
    if (String(url).endsWith("/actions/8123712")) {
      actionPolls += 1;
      return response({ id: 8123712, state: actionPolls === 1 ? "running" : "completed" });
    }
    if (String(url).endsWith("/docker/playcqrtv/containers")) return response(containers());
    throw new Error("unexpected test request");
  };

  const result = await deployCompose({
    fetchImpl, token, manifest: "services:\n  api:\n    image: " + apiImageRef,
    vmId, webImageRef, apiImageRef, delayMs: 0, sleep: async () => {}
  });

  assert.equal(result.actionId, 8123712);
  assert.equal(calls.filter(call => call.options.method === "POST").length, 1, "replacement POST must never be retried");
  assert.equal(calls.length, 4);
  assert.match(calls[0].url, /\/virtual-machines\/2150572\/docker$/);
  assert.match(calls[1].url, /\/virtual-machines\/2150572\/actions\/8123712$/);
  assert.match(calls[3].url, /\/virtual-machines\/2150572\/docker\/playcqrtv\/containers$/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer " + token);
  const postBody = JSON.parse(calls[0].options.body);
  assert.equal(postBody.project_name, "playcqrtv");
  assert.match(postBody.content, apiImageRef);
});

test("a terminal Hostinger action failure stops before container verification", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === "POST") return response({ id: 501, state: "pending" });
    return response({ id: 501, state: "failed" });
  };
  await assert.rejects(
    deployCompose({ fetchImpl, token, manifest: "compose", webImageRef, apiImageRef, delayMs: 0, sleep: async () => {} }),
    /finished with a failure state/
  );
  assert.equal(calls.length, 2);
  assert.equal(calls.some(call => call.url.endsWith("/containers")), false);
});

test("unknown action states and malformed action responses fail closed", async t => {
  await t.test("unknown state", async () => {
    const fetchImpl = async () => response({ id: 88, state: "mystery-state" });
    await assert.rejects(
      waitForHostingerAction({ fetchImpl, token, vmId, actionId: 88, initialState: "mystery-state" }),
      /unknown state/
    );
  });
  await t.test("missing or invalid action id", async () => {
    for (const action of [{ state: "pending" }, { id: 0, state: "pending" }, { id: "not-an-id", state: "pending" }]) {
      const fetchImpl = async () => response(action);
      await assert.rejects(
        deployCompose({ fetchImpl, token, manifest: "compose", webImageRef, apiImageRef }),
        /valid action ID/
      );
    }
  });
  await t.test("mismatched polled id", async () => {
    const fetchImpl = async () => response({ id: 12, state: "completed" });
    await assert.rejects(
      waitForHostingerAction({ fetchImpl, token, vmId, actionId: 11, initialState: "pending" }),
      /did not match/
    );
  });
});

test("action timeout stops safely and never resends POST or checks for containers", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return options.method === "POST"
      ? response({ id: 77, state: "pending" })
      : response({ id: 77, state: "running" });
  };
  await assert.rejects(
    deployCompose({
      fetchImpl, token, manifest: "compose", webImageRef, apiImageRef,
      actionAttempts: 2, delayMs: 0, sleep: async () => {}
    }),
    /did not finish before the timeout/
  );
  assert.equal(calls.filter(call => call.options.method === "POST").length, 1);
  assert.equal(calls.some(call => call.url.endsWith("/containers")), false);
});

test("documented container list schema is validated and health is required when provided", async t => {
  await t.test("running refs with healthy and no-healthcheck states are ready", () => {
    assert.equal(assessExpectedContainers(containers(), { webImageRef, apiImageRef }), true);
  });
  await t.test("starting or stopped containers are not ready", () => {
    assert.equal(assessExpectedContainers(containers({
      extra: [{ name: "pending", image: webImageRef, state: "running", health: "starting" }]
    }), { webImageRef, apiImageRef }), false);
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

test("API failures do not log response bodies or leak token text", async () => {
  const fetchImpl = async () => new Response("production-secret-body", { status: 500 });
  let caught;
  try {
    await deployCompose({ fetchImpl, token, manifest: "compose", webImageRef, apiImageRef });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.doesNotMatch(caught.message, /production-secret-body|test-only-token/);
  assert.match(caught.message, /HTTP 500/);
});

test("transient action and container API errors are retried only during read-only polling", async () => {
  const calls = [];
  let actionPolls = 0;
  let containerPolls = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
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
    fetchImpl, token, manifest: "compose", webImageRef, apiImageRef,
    delayMs: 0, sleep: async () => {}
  });
  assert.equal(calls.filter(call => call.options.method === "POST").length, 1);
  assert.equal(actionPolls, 2);
  assert.equal(containerPolls, 2);
});

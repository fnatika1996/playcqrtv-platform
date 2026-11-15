import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_ORIGIN = "https://developers.hostinger.com";
const DEFAULT_VM_ID = "2150572";
const ACTION_SUCCESS = new Set(["success", "succeeded", "completed"]);
const ACTION_FAILURE = new Set(["failed", "failure", "error", "cancelled", "canceled"]);
const ACTION_PENDING = new Set(["pending", "queued", "running", "processing", "inprogress"]);

function normalizeState(value) {
  return typeof value === "string" ? value.toLowerCase().replace(/[\s_-]/g, "") : "";
}

function classifyActionState(value) {
  const state = normalizeState(value);
  if (ACTION_SUCCESS.has(state)) return "success";
  if (ACTION_FAILURE.has(state)) return "failure";
  if (ACTION_PENDING.has(state)) return "pending";
  if (!state) return "missing";
  return "unknown";
}

async function readJsonResponse(response, label) {
  if (!response.ok) {
    const error = new Error(label + " returned HTTP " + response.status + ".");
    error.status = response.status;
    throw error;
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(label + " returned invalid JSON.");
  }
  if (!body || typeof body !== "object") throw new Error(label + " returned an invalid JSON resource.");
  return body;
}

async function requestJson(fetchImpl, url, token, { method = "GET", body, timeoutMs = 10000 } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new Error("Hostinger API network request failed.");
  }
  return readJsonResponse(response, "Hostinger API request");
}

function retryable(error) {
  return error.status === undefined || error.status >= 500 || error.status === 429;
}

function assertActionResource(resource, expectedId) {
  if (expectedId !== undefined && resource.id !== undefined &&
      Number(resource.id) !== Number(expectedId)) {
    throw new Error("Hostinger action response ID did not match the requested action.");
  }
  if (resource.id !== undefined && !Number.isSafeInteger(Number(resource.id))) {
    throw new Error("Hostinger action response contained an invalid ID.");
  }
  if (typeof resource.state !== "undefined" && typeof resource.state !== "string") {
    throw new Error("Hostinger action response contained an invalid state.");
  }
  return classifyActionState(resource.state);
}

export async function waitForHostingerAction({
  fetchImpl = fetch,
  token,
  vmId = DEFAULT_VM_ID,
  actionId,
  initialState,
  maxAttempts = 60,
  delayMs = 5000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  if (!/^\d+$/.test(String(actionId)) || Number(actionId) <= 0) {
    throw new Error("Hostinger deployment action did not provide a valid action ID.");
  }
  let classification = classifyActionState(initialState);
  if (classification === "success") return;
  if (classification === "failure") throw new Error("Hostinger deployment action finished with a failure state.");
  if (classification === "unknown") throw new Error("Hostinger deployment action returned an unknown state; stopping safely.");

  const url = API_ORIGIN + "/api/vps/v1/virtual-machines/" + vmId + "/actions/" + actionId;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let resource;
    try {
      resource = await requestJson(fetchImpl, url, token);
    } catch (error) {
      if (!retryable(error) || attempt === maxAttempts - 1) {
        throw new Error("Could not verify Hostinger deployment action (" +
          (error.status ? "HTTP " + error.status : "network or response error") + "); stopping safely.");
      }
      await sleep(delayMs);
      continue;
    }
    classification = assertActionResource(resource, actionId);
    if (classification === "success") return;
    if (classification === "failure") throw new Error("Hostinger deployment action finished with a failure state.");
    if (classification === "unknown") throw new Error("Hostinger deployment action returned an unknown state; stopping safely.");
    if (attempt < maxAttempts - 1) await sleep(delayMs);
  }
  throw new Error("Hostinger deployment action did not finish before the timeout; no automatic retry or rollback was started.");
}

function assertContainerList(body) {
  if (!Array.isArray(body)) throw new Error("Hostinger container response was not the documented container list.");
  for (const container of body) {
    if (!container || typeof container !== "object" || Array.isArray(container)) {
      throw new Error("Hostinger container response contained an invalid resource.");
    }
    for (const key of ["name", "image", "state", "health"]) {
      if (container[key] !== undefined && container[key] !== null && typeof container[key] !== "string") {
        throw new Error("Hostinger container resource contained a non-string " + key + " field.");
      }
    }
  }
  return body;
}

export function assessExpectedContainers(body, { webImageRef, apiImageRef }) {
  const containers = assertContainerList(body);
  const expected = [webImageRef, apiImageRef];
  const matches = expected.map(image => containers.filter(container => container.image === image));
  if (matches.some(rows => rows.length > 1)) {
    throw new Error("Hostinger reported duplicate containers for an expected image digest.");
  }
  if (matches.some(rows => rows.length === 0)) return false;
  return matches.every(([container]) => {
    if (!container.name || !container.state) {
      throw new Error("Hostinger container resource omitted documented name or state fields.");
    }
    if (normalizeState(container.state) !== "running") return false;
    const health = normalizeState(container.health);
    return !health || health === "healthy" || health === "none";
  });
}

export async function waitForExpectedContainers({
  fetchImpl = fetch,
  token,
  vmId = DEFAULT_VM_ID,
  projectName = "playcqrtv",
  webImageRef,
  apiImageRef,
  maxAttempts = 36,
  delayMs = 5000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  if (!webImageRef || !apiImageRef || webImageRef === apiImageRef) {
    throw new Error("Distinct web and API image refs are required.");
  }
  const url = API_ORIGIN + "/api/vps/v1/virtual-machines/" + vmId +
    "/docker/" + encodeURIComponent(projectName) + "/containers";
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let body;
    try {
      body = await requestJson(fetchImpl, url, token);
    } catch (error) {
      if (!retryable(error) || attempt === maxAttempts - 1) {
        throw new Error("Could not verify Hostinger project containers (" +
          (error.status ? "HTTP " + error.status : "network or response error") + "); stopping safely.");
      }
      await sleep(delayMs);
      continue;
    }
    if (assessExpectedContainers(body, { webImageRef, apiImageRef })) return;
    if (attempt < maxAttempts - 1) await sleep(delayMs);
  }
  throw new Error("Expected digest-pinned containers did not become ready before the timeout; deployment needs operator review.");
}

export function validateSavedCompose(content, { webImageRef, apiImageRef, validatorPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "hostinger-compose-preflight.rb") }) {
  if (typeof content !== "string" || !content.trim() || Buffer.byteLength(content, "utf8") > 256 * 1024) {
    throw new Error("Hostinger saved Compose content is missing or too large; refusing update.");
  }
  const result = spawnSync("ruby", [validatorPath], {
    input: content,
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 64 * 1024,
    env: {
      PATH: process.env.PATH || "",
      EXPECTED_WEB_IMAGE_REF: webImageRef,
      EXPECTED_API_IMAGE_REF: apiImageRef
    }
  });
  if (result.error || result.status !== 0) {
    throw new Error("Hostinger saved Compose failed image and volume preflight; refusing update.");
  }
}

export async function deployCompose({
  fetchImpl = fetch,
  token,
  vmId = DEFAULT_VM_ID,
  projectName = "playcqrtv",
  webImageRef,
  apiImageRef,
  actionAttempts = 60,
  containerAttempts = 36,
  delayMs = 5000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  if (!token) throw new Error("Hostinger API token is required.");
  if (!webImageRef || !apiImageRef || webImageRef === apiImageRef) throw new Error("Distinct web and API image refs are required.");

  const projectUrl = API_ORIGIN + "/api/vps/v1/virtual-machines/" + vmId + "/docker/" + encodeURIComponent(projectName);
  const savedProject = await requestJson(fetchImpl, projectUrl, token);
  validateSavedCompose(savedProject.content, { webImageRef, apiImageRef });

  const updateUrl = projectUrl + "/update";
  // Do not retry UPDATE: a network error can happen after Hostinger accepted the existing-project update.
  const action = await requestJson(fetchImpl, updateUrl, token, {
    method: "POST",
    timeoutMs: 30000
  });
  if (action.id === undefined || !Number.isSafeInteger(Number(action.id)) || Number(action.id) <= 0) {
    throw new Error("Hostinger accepted the request without returning a valid action ID; stopping safely.");
  }

  await waitForHostingerAction({
    fetchImpl, token, vmId, actionId: action.id, initialState: action.state,
    maxAttempts: actionAttempts, delayMs, sleep
  });
  await waitForExpectedContainers({
    fetchImpl, token, vmId, projectName, webImageRef, apiImageRef,
    maxAttempts: containerAttempts, delayMs, sleep
  });
  return { actionId: Number(action.id), projectName, webImageRef, apiImageRef };
}

async function main() {
  const token = process.env.HOSTINGER_API_KEY;
  const result = await deployCompose({
    token,
    vmId: process.env.HOSTINGER_VM_ID || DEFAULT_VM_ID,
    projectName: process.env.HOSTINGER_PROJECT_NAME || "playcqrtv",
    webImageRef: process.env.WEB_IMAGE_REF,
    apiImageRef: process.env.API_IMAGE_REF
  });
  console.log("Hostinger existing-project update " + result.actionId + " completed; both expected image refs are running.");
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      "### Hostinger existing-project update completed and containers are running",
      "- Action ID: " + result.actionId,
      "- Project: " + result.projectName,
      "- Web ref: " + result.webImageRef,
      "- API ref: " + result.apiImageRef,
      ""
    ].join("\n"));
  }
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (scriptPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

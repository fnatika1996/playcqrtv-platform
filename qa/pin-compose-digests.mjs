import fs from "node:fs";
import path from "node:path";

const [sourcePath, outputPath, webDigest, apiDigest] = process.argv.slice(2);
const digestPattern = /^sha256:[a-f0-9]{64}$/i;

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}

if (!sourcePath || !outputPath) fail("Usage: node pin-compose-digests.mjs <source-compose> <output-compose> <web-digest> <api-digest>");
const sourceAbsolute = path.resolve(sourcePath);
const outputAbsolute = path.resolve(outputPath);
if (sourceAbsolute === outputAbsolute) fail("Output path must not overwrite the source Compose file.");
// Remove stale output before validating inputs so a failed render cannot leave an older deployable manifest.
fs.rmSync(outputAbsolute, { force: true });
if (!digestPattern.test(webDigest || "")) fail("A valid web registry digest is required.");
if (!digestPattern.test(apiDigest || "")) fail("A valid API registry digest is required.");

const baseline = {
  web: "ghcr.io/fnatika1996/playcqrtv-platform@sha256:eca2d70ca29e8311b04f00696e95291b8f7ae7a22c28d1b6ec1485f345a5e190",
  api: "ghcr.io/fnatika1996/playcqrtv-api@sha256:80252038a08b731657686703704ce8ee35b8871af64662134633fbd56c11f2fb"
};

function replaceService(content, service, expectedRef, replacementRef) {
  const headers = [...content.matchAll(/^  ([A-Za-z0-9_-]+):[ \t]*\r?$/gm)];
  const index = headers.findIndex(match => match[1] === service);
  if (index < 0) fail(`Compose service ${service} was not found.`);

  const start = headers[index].index;
  const end = headers[index + 1]?.index ?? content.length;
  let block = content.slice(start, end);
  const images = [...block.matchAll(/^    image: (.+)\r?$/gm)];
  if (images.length !== 1 || images[0][1] !== expectedRef) {
    fail(`Compose service ${service} must have exactly one expected baseline image ref.`);
  }
  const policies = [...block.matchAll(/^    pull_policy: (.+)\r?$/gm)];
  if (policies.length !== 1) fail(`Compose service ${service} must have exactly one pull_policy.`);

  block = block.replace(/^    image: .+\r?$/m, `    image: ${replacementRef}`);
  block = block.replace(/^    pull_policy: .+\r?$/m, "    pull_policy: always");
  return content.slice(0, start) + block + content.slice(end);
}

const source = fs.readFileSync(sourcePath, "utf8");
let output = replaceService(source, "api", baseline.api, `ghcr.io/fnatika1996/playcqrtv-api@${apiDigest}`);
output = replaceService(output, "caddy", baseline.web, `ghcr.io/fnatika1996/playcqrtv-platform@${webDigest}`);

if (/^\s*image:.*:latest\s*$/m.test(output)) fail("Rendered Compose must not contain an image tagged latest.");
for (const service of ["api", "caddy"]) {
  const headers = [...output.matchAll(/^  ([A-Za-z0-9_-]+):[ \t]*\r?$/gm)];
  const index = headers.findIndex(match => match[1] === service);
  const start = headers[index].index;
  const end = headers[index + 1]?.index ?? output.length;
  const block = output.slice(start, end);
  if (!/^    pull_policy: always\r?$/m.test(block)) fail(`Pinned service ${service} must use pull_policy: always.`);
}
if (!output.includes(`image: ghcr.io/fnatika1996/playcqrtv-api@${apiDigest}`) ||
    !output.includes(`image: ghcr.io/fnatika1996/playcqrtv-platform@${webDigest}`)) {
  fail("Rendered Compose does not include both exact registry digests.");
}

fs.mkdirSync(path.dirname(outputAbsolute), { recursive: true });
const temporaryPath = `${outputAbsolute}.tmp-${process.pid}`;
try {
  fs.writeFileSync(temporaryPath, output, { flag: "wx", mode: 0o600 });
  fs.renameSync(temporaryPath, outputAbsolute);
} catch (error) {
  fs.rmSync(temporaryPath, { force: true });
  fs.rmSync(outputAbsolute, { force: true });
  throw error;
}
console.log("Rendered digest-pinned Compose manifest for web and API.");

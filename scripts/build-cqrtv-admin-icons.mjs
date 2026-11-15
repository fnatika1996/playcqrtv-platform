import fs from "node:fs";
import path from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith("--")) throw new Error("Expected an option, got " + key);
  const value = process.argv[++i];
  if (!value) throw new Error("Missing value for " + key);
  args.set(key, value);
}
const repoRoot = process.cwd();
const sourceRoot = path.resolve(args.get("--source") || "Icon Play CQRTV");
const outputDir = args.has("--out") ? path.resolve(args.get("--out")) : null;
const manifestPath = path.resolve(args.get("--manifest") || "assets/icons/cqrtv/admin-icon-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest.icons) || !manifest.icons.length) throw new Error("Icon manifest is empty.");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [absolute];
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}
function inside(file, root) {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}
function regexEscape(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}
function safeSvg(xml, source) {
  const unsafe = /<script\b|<foreignObject\b|<iframe\b|<object\b|<embed\b|<!ENTITY\b|<\?xml-stylesheet\b|@import\b|url\(\s*["']?(?:https?:|\/\/)|\bon[a-z]+\s*=|(?:href|xlink:href)\s*=\s*["'](?:https?:|javascript:|data:|\/\/)/i;
  if (unsafe.test(xml)) throw new Error("Unsafe SVG content in " + source);
  if (!/<svg(?:\s|>)/i.test(xml)) throw new Error("Invalid SVG source: " + source);
}
const sourceFiles = walk(sourceRoot);
const svgFiles = sourceFiles.filter(file => file.toLowerCase().endsWith(".svg"));
const codeFiles = walk(repoRoot)
  .filter(file => {
    if (!/\.(?:html|css|mjs|js)$/i.test(file)) return false;
    if (inside(file, sourceRoot) || (outputDir && inside(file, outputDir))) return false;
    const relative = path.relative(repoRoot, file).replaceAll("\\", "/");
    return !/(^|\/)(?:\.git|node_modules|qa|docs)(\/|$)/i.test(relative)
      && !/(^|\/)api\/test(\/|$)/i.test(relative);
  })
  .map(file => fs.readFileSync(file, "utf8"));
const selected = new Set();
const usedByCode = new Set();
for (const icon of manifest.icons) {
  if (!/^[a-z0-9-]+\.svg$/.test(icon.file) || path.basename(icon.file) !== icon.file) throw new Error("Unsafe output alias: " + icon.file);
  if (typeof icon.key !== "string" || !/^[a-z0-9-]+$/.test(icon.key)) throw new Error("Unsafe icon key: " + icon.key);
  const sourceParts = icon.source.replaceAll("\\", "/").split("/");
  if (!icon.source.toLowerCase().endsWith(".svg") || sourceParts.some(part => !part || part === "." || part === "..")) throw new Error("Unsafe source path: " + icon.source);
  const source = path.resolve(sourceRoot, ...sourceParts);
  if (!inside(source, sourceRoot) || !fs.existsSync(source) || !fs.lstatSync(source).isFile()) throw new Error("Missing or non-file icon source: " + icon.source);
  const xml = fs.readFileSync(source, "utf8");
  safeSvg(xml, icon.source);
  if (selected.has(icon.file)) throw new Error("Duplicate output alias: " + icon.file);
  selected.add(icon.file);
  const key = regexEscape(icon.key);
  const file = regexEscape(icon.file);
  if (codeFiles.some(content =>
    new RegExp("/ui/" + file + "(?:[?#\"'\\s]|$)", "i").test(content) ||
    new RegExp("['\"]" + key + "['\"]").test(content)
  )) usedByCode.add(icon.file);
  if (outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.copyFileSync(source, path.join(outputDir, icon.file));
  }
}
if (outputDir) {
  const map = {
    version: manifest.version,
    icons: manifest.icons.map(({ key, file, usedBy }) => ({ key, file, usedBy }))
  };
  fs.writeFileSync(path.join(outputDir, "admin-icon-map.json"), JSON.stringify(map, null, 2) + "\n");
}
const categories = new Set(manifest.icons.map(icon => icon.source.split(/[\\/]/)[0]));
console.log("CQRTV_ICON_AUDIT " + JSON.stringify({
  archiveFiles: sourceFiles.length,
  archiveSvgCount: svgFiles.length,
  selectedSvgCount: manifest.icons.length,
  distinctSvgCount: selected.size,
  mappedForUseCount: usedByCode.size,
  sourceCategoryCount: categories.size,
  output: outputDir ? path.relative(repoRoot, outputDir) : "audit-only"
}));
console.log("CQRTV_ICON_SELECTION " + manifest.icons.map(icon => icon.file + " <= " + icon.source).join("\n"));

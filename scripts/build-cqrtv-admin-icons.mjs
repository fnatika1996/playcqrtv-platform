import fs from "node:fs";
import path from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith("--")) throw new Error("Expected an option, got " + key);
  args.set(key, process.argv[++i] || "");
}
const sourceRoot = path.resolve(args.get("--source") || "Icon Play CQRTV");
const outputDir = args.get("--out") ? path.resolve(args.get("--out")) : null;
const manifestPath = path.resolve(args.get("--manifest") || "assets/icons/cqrtv/admin-icon-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest.icons) || !manifest.icons.length) throw new Error("Icon manifest is empty.");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}
const sourceFiles = walk(sourceRoot);
const svgFiles = sourceFiles.filter(file => file.toLowerCase().endsWith(".svg"));
const selected = new Set();
const used = new Set();
for (const icon of manifest.icons) {
  if (!/^[a-z0-9-]+\.svg$/.test(icon.file) || path.basename(icon.file) !== icon.file) throw new Error("Unsafe output alias: " + icon.file);
  if (!icon.source.toLowerCase().endsWith(".svg") || icon.source.split(/[\\/]/).includes("..")) throw new Error("Unsafe source path: " + icon.source);
  const source = path.resolve(sourceRoot, icon.source);
  if (!source.startsWith(sourceRoot + path.sep) || !fs.existsSync(source)) throw new Error("Missing icon source: " + icon.source);
  const xml = fs.readFileSync(source, "utf8");
  if (/<script\b|<foreignObject\b|\b(?:href|xlink:href)\s*=\s*["'](?:https?:|javascript:|data:)/i.test(xml)) {
    throw new Error("Unsafe SVG content in " + icon.source);
  }
  if (!xml.includes("<svg")) throw new Error("Invalid SVG source: " + icon.source);
  if (selected.has(icon.file)) throw new Error("Duplicate output alias: " + icon.file);
  selected.add(icon.file);
  if (Array.isArray(icon.usedBy) && icon.usedBy.length) used.add(icon.file);
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
const categories = new Set(manifest.icons.map(icon => icon.source.split("/")[0]));
console.log("CQRTV_ICON_AUDIT " + JSON.stringify({
  archiveFiles: sourceFiles.length,
  archiveSvgCount: svgFiles.length,
  selectedSvgCount: manifest.icons.length,
  distinctSvgCount: selected.size,
  mappedForUseCount: used.size,
  sourceCategoryCount: categories.size,
  output: outputDir ? path.relative(process.cwd(), outputDir) : "audit-only"
}));
console.log("CQRTV_ICON_SELECTION " + manifest.icons.map(icon => icon.file + " <= " + icon.source).join("\n"));

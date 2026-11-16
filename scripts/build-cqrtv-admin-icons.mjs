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
function safeSvg(xml, source, key) {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<script\b|<foreignObject\b|<iframe\b|<object\b|<embed\b|<style\b|\bon[a-z]+\s*=|javascript:|data:/i.test(xml)) throw new Error("Unsafe SVG content in " + source);
  const allowedTags = new Set(["svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "title", "desc"]);
  const allowedAttrs = new Set(["xmlns", "viewBox", "fill", "fill-rule", "fill-opacity", "clip-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "opacity", "transform", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "points", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod", "clipPathUnits", "maskUnits", "maskContentUnits", "id", "clip-path", "mask"]);
  const colors = [...new Set([...xml.matchAll(/(?:fill|stroke|stop-color)\s*=\s*["'](#[\da-f]{3,8})["']/gi)].map(match => match[1].toLowerCase()))];
  let clean = xml.replace(/<!--[\s\S]*?-->|<\?xml[^>]*\?>/gi, "").replace(/<\/?[A-Za-z][^>]*>/g, tag => {
    if (/^<\//.test(tag)) return tag;
    const name = /^<([A-Za-z][\w:-]*)/.exec(tag)?.[1];
    if (!name || !allowedTags.has(name)) throw new Error("Unsupported SVG element in " + source + ": " + (name || "unknown"));
    let rest = tag.slice(name.length + 1, -1).replace(/\/\s*$/, "");
    const parsed = [];
    while (rest.trim()) {
      const match = /^\s+([A-Za-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
      if (!match) throw new Error("Malformed or unsupported SVG attribute in " + source);
      const attr = match[1], value = match[2] ?? match[3] ?? "";
      if (!allowedAttrs.has(attr) || /[<>\u0000-\u001f]/.test(value) || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(value)) throw new Error("Unsafe SVG attribute in " + source + ": " + attr);
      parsed.push([attr, value]); rest = rest.slice(match[0].length);
    }
    if (name === "svg") {
      const box = parsed.find(([attr]) => attr === "viewBox");
      if (!box || !/^[-\d.\s]+$/.test(box[1])) throw new Error("SVG must have a numeric viewBox: " + source);
    }
    for (const [attr, value] of parsed) {
      let next = value;
      if (attr === "id") next = key + "-" + value.replace(/[^\w-]/g, "");
      if (attr === "clip-path" || attr === "mask") {
        const ref = /^url\(#([\w-]+)\)$/.exec(value);
        if (!ref) throw new Error("External SVG reference rejected in " + source);
        next = `url(#${key}-${ref[1]})`;
      }
      if (attr === "fill" || attr === "stroke" || attr === "stop-color") {
        if (/^#[\da-f]{3,8}$/i.test(value)) next = colors.indexOf(value.toLowerCase()) === 0
          ? "var(--icon-primary,#ff7629)"
          : "var(--icon-secondary,#f3f3f2)";
        else if (/^url\(#([\w-]+)\)$/.test(value)) next = value.replace(/^url\(#([\w-]+)\)$/, (_, id) => `url(#${key}-${id})`);
        else if (!/^(?:none|currentColor|transparent|inherit)$/i.test(value)) throw new Error("Unsupported SVG paint value in " + source);
      }
      const safeValue = next.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      parsed[parsed.findIndex(item => item[0] === attr)][1] = safeValue;
    }
    return `<${name}${parsed.map(([a, v]) => ` ${a}="${v}"`).join("")}${/\/\s*>$/.test(tag) ? "/>" : ">"}`;
  });
  if (!/^\s*<svg\b/i.test(clean) || !/<\/svg>\s*$/i.test(clean)) throw new Error("Invalid SVG source: " + source);
  return clean;
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
  const sanitized = safeSvg(xml, icon.source, icon.key);
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
    fs.writeFileSync(path.join(outputDir, icon.file), sanitized);
  }
}
if (outputDir) {
  const symbols = manifest.icons.map(icon => {
    const file = path.join(outputDir, icon.file);
    const xml = fs.readFileSync(file, "utf8");
    const viewBox = /\bviewBox="([^"]+)"/i.exec(xml)?.[1];
    if (!viewBox) throw new Error("Sanitized icon missing viewBox: " + icon.file);
    const body = xml.replace(/^\s*<svg\b[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");
    return `<symbol id="${icon.key}" viewBox="${viewBox}">${body}</symbol>`;
  }).join("");
  fs.writeFileSync(path.join(outputDir, "admin-icon-sprite.svg"), `<svg xmlns="http://www.w3.org/2000/svg">${symbols}</svg>\n`);
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

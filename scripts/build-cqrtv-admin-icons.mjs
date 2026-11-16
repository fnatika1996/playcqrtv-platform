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
    if (name === "
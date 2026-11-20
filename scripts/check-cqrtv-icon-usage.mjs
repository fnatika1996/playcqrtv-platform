import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const sourceExtensions = /\.(?:html|css|mjs|js)$/i;
const ignoredDirectories = new Set([".git", "node_modules", "qa", "docs", "qa-artifacts"]);
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : walk(absolute);
    return [absolute];
  });
}

function relativeName(sourcePath) {
  return sourcePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isAllowedInlineSvg(sourcePath, html, start, tag, counts) {
  const attrs = tag.slice(4, -1);
  const cls = attrs.match(/\bclass=["']([^"']+)["']/i)?.[1]?.split(/\s+/) || [];
  if (sourcePath === "index.html") {
    if (cls.includes("feature-illustration")) { counts.featureIllustrations++; return true; }
    if (cls.includes("country-picker-chevron")) { counts.countryChevron++; return true; }
    const labelStart = html.lastIndexOf('<label class="role-option"', start);
    const labelEnd = html.lastIndexOf("</label>", start);
    if (labelStart > labelEnd) {
      const role = html.slice(labelStart, start).match(/data-role=["'](awper|entry|rifler|igl)["']/)?.[1];
      const iconStart = html.lastIndexOf('class="role-icon pack-icon"', start);
      if (role && iconStart > labelStart && !html.slice(iconStart, start).includes("data-src=")) {
        counts.roleGlyphs[role]++;
        return true;
      }
    }
  }
  if (sourcePath === "auth.html" && html.slice(Math.max(0, start - 90), start).match(/<div class="verify-icon"[^>]*>\s*$/)) {
    counts.verificationShield++;
    return true;
  }
  return false;
}

export function auditIconUsage({ sources, icons, generatedFiles, sprite, map, validateAllowlistCounts = true }) {
  const errors = [];
  const manifestFiles = new Set(icons.map(icon => icon.file));
  const keys = new Set(icons.map(icon => icon.key));
  const generated = generatedFiles instanceof Set ? generatedFiles : new Set(generatedFiles);
  for (const icon of icons) {
    if (!generated.has(icon.file)) errors.push(`generated icon missing: ${icon.file}`);
  }
  if (!map) errors.push("generated icon map is missing");
  if (map) {
    const mapped = new Set((map.icons || []).map(icon => icon.file));
    if (mapped.size !== manifestFiles.size || [...manifestFiles].some(file => !mapped.has(file))) errors.push("generated icon map does not match the manifest");
  }
  if (!sprite) errors.push("generated icon sprite is missing");
  if (sprite) {
    const symbols = [...sprite.matchAll(/<symbol\b[^>]*\bid=["']([a-z0-9-]+)["']/gi)].map(match => match[1]);
    if (symbols.length !== keys.size || new Set(symbols).size !== keys.size || [...keys].some(key => !symbols.includes(key))) errors.push("generated icon sprite does not contain exactly the manifest symbols");
  }
  const counts = { featureIllustrations: 0, countryChevron: 0, roleGlyphs: { awper: 0, entry: 0, rifler: 0, igl: 0 }, verificationShield: 0 };
  for (const item of sources) {
    const name = relativeName(item.path);
    const text = item.content;
    for (const match of text.matchAll(/\/assets\/icons\/cqrtv\/ui\/([a-z0-9-]+\.svg)/gi)) {
      const file = match[1];
      if (file === "admin-icon-sprite.svg") continue;
      if (!manifestFiles.has(file)) errors.push(`${name}: unapproved icon reference ${file}`);
      else if (!generated.has(file)) errors.push(`${name}: referenced generated icon missing: ${file}`);
    }
    for (const match of text.matchAll(/\/assets\/icons\/cqrtv\/ui\/admin-icon-sprite\.svg#([a-z0-9-]+)/gi)) {
      if (!keys.has(match[1])) errors.push(`${name}: sprite symbol is not in the manifest: ${match[1]}`);
    }
    if (!name.endsWith(".html")) continue;
    for (const svg of text.matchAll(/<svg\b[^>]*>/gi)) {
      if (!isAllowedInlineSvg(name, text, svg.index, svg[0], counts)) {
        const cls = svg[0].match(/\bclass=["']([^"']+)["']/i)?.[1] || "(no class)";
        errors.push(`${name}: unapproved inline SVG UI glyph ${cls}`);
      }
    }
  }
  if (validateAllowlistCounts) {
    if (counts.featureIllustrations !== 4) errors.push(`expected 4 decorative feature illustrations, found ${counts.featureIllustrations}`);
    if (counts.countryChevron !== 1) errors.push(`expected 1 documented country-picker chevron, found ${counts.countryChevron}`);
    for (const [role, count] of Object.entries(counts.roleGlyphs)) if (count !== 2) errors.push(`expected two documented inline ${role} role glyphs, found ${count}`);
    if (counts.verificationShield !== 1) errors.push(`expected 1 documented verification shield, found ${counts.verificationShield}`);
  }
  return { errors, counts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(fs.readFileSync("assets/icons/cqrtv/admin-icon-manifest.json", "utf8"));
  const iconDir = "assets/icons/cqrtv/ui";
  const generatedFiles = fs.existsSync(iconDir) ? fs.readdirSync(iconDir).filter(file => file.endsWith(".svg") && file !== "admin-icon-sprite.svg") : [];
  const spritePath = path.join(iconDir, "admin-icon-sprite.svg");
  const mapPath = path.join(iconDir, "admin-icon-map.json");
  const sourceFiles = walk(root).filter(file => sourceExtensions.test(file) && !file.split(path.sep).some(part => ignoredDirectories.has(part)) && !file.includes(path.join("assets", "icons", "cqrtv", "ui")));
  const sources = sourceFiles.map(file => ({ path: relativeName(path.relative(root, file)), content: fs.readFileSync(file, "utf8") }));
  const result = auditIconUsage({
    sources,
    icons: manifest.icons,
    generatedFiles,
    sprite: fs.existsSync(spritePath) ? fs.readFileSync(spritePath, "utf8") : "",
    map: fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, "utf8")) : null
  });
  if (result.errors.length) {
    console.error("CQRTV icon usage audit failed:\n" + result.errors.map(error => "- " + error).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("CQRTV_ICON_AUDIT " + JSON.stringify({ manifestIcons: manifest.icons.length, generatedIcons: generatedFiles.length, inlineAllowlist: result.counts }));
  }
}

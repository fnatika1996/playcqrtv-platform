import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.argv[2];
const out = process.argv[3];
if (!root || !out) throw new Error('Usage: node qa/admin-a-plus-icon-audit.mjs <archive-icon-dir> <output.json>');
const semantic = {
  Logout: ['logout','sign out','sign-out','log out'], Exit: ['exit','leave','close'],
  Login: ['login','log in','sign in','sign-in','enter'], Profile: ['user','profile','account','avatar'],
  Settings: ['setting','gear','config','tune'], Search: ['search','magnifer','find'],
  Notifications: ['notification','bell','alert'], Users: ['users','group','people','team'],
  Dashboard: ['dashboard','widget','panel','home'], CS2: ['counter','strike','cs2','bomb','rifle','weapon','target'],
  Messages: ['message','chat','letter','mail','inbox'], Social: ['social','discord','steam','community','share'],
  Edit: ['edit','pen','pencil'], Delete: ['delete','trash','remove','bin'], Save: ['save','disk','floppy'],
  Upload: ['upload','export','import','cloud'], Back: ['back','arrow-left','alt-arrow-left','return']
};
const paths = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.toLowerCase().endsWith('.svg')) paths.push(path);
  }
}
await walk(root);
const icons = [];
for (const path of paths) {
  const source = await readFile(path, 'utf8');
  const colors = [...new Set([...source.matchAll(/(?:fill|stroke|stop-color)\s*=\s*["'](#[0-9a-f]{3,8}|[a-z]+|none|currentColor)/gi)].map(match => match[1].toLowerCase()).filter(color => color !== 'none' && color !== 'currentcolor'))];
  const rel = relative(root, path).replaceAll('\\', '/');
  const searchable = rel.toLowerCase().replace(/[-_]+/g, ' ');
  const candidateGroups = Object.entries(semantic).filter(([, terms]) => terms.some(term => searchable.includes(term))).map(([group]) => group);
  icons.push({ path: rel, bytes: (await stat(path)).size, colors, hasGradient: /<linearGradient|<radialGradient/i.test(source), hasMask: /<mask|<clipPath/i.test(source), candidateGroups });
}
if (!icons.length) throw new Error(`No SVG files found under ${root}`);
const summary = {
  totalSvg: icons.length,
  multicolorSvg: icons.filter(icon => icon.colors.length > 1).length,
  semanticCandidateCounts: Object.fromEntries(Object.keys(semantic).map(group => [group, icons.filter(icon => icon.candidateGroups.includes(group)).length])),
  icons
};
await writeFile(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ totalSvg: summary.totalSvg, multicolorSvg: summary.multicolorSvg, candidates: summary.semanticCandidateCounts, output: out }, null, 2));

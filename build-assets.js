/* Regenerates js/idmap.js and assets/ from the clash-of-clans-data npm package.
   Usage:  npm i clash-of-clans-data && node build-assets.js
   Run this after a game update to refresh names, max levels and icons. */
const fs = require("fs");
const path = require("path");

const PKG = path.join(__dirname, "node_modules", "clash-of-clans-data");
const APP = __dirname;
const OUT_ASSETS = path.join(APP, "assets");

if (!fs.existsSync(PKG)) {
  console.error("clash-of-clans-data not found — run: npm i clash-of-clans-data");
  process.exit(1);
}

const CATEGORIES = [
  "heroes", "hero-equipment", "troops", "spells", "siege-machines", "pets",
  "defenses", "traps", "army-buildings", "resource-buildings", "town-hall",
  "guardians", "crafted-defenses", "walls", "other",
];

const idMap = {};
const iconMap = {};
let copied = 0;

function copyIcon(src, cat, slug) {
  const destDir = path.join(OUT_ASSETS, cat);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, path.join(destDir, slug + ".png"));
  copied++;
  return `assets/${cat}/${slug}.png`;
}

function bestLevelPng(dir) {
  if (!fs.existsSync(dir)) return null;
  const lvls = fs.readdirSync(dir)
    .map(f => /^level-(\d+)\.png$/.exec(f)).filter(Boolean)
    .map(m => Number(m[1])).sort((a, b) => b - a);
  return lvls.length ? path.join(dir, `level-${lvls[0]}.png`) : null;
}

for (const cat of CATEGORIES) {
  const dataDir = path.join(PKG, "data", "home", cat);
  if (!fs.existsSync(dataDir)) continue;
  for (const f of fs.readdirSync(dataDir)) {
    if (!f.endsWith(".json")) continue;
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); }
    catch { continue; }
    const slug = d.id || f.replace(/\.json$/, "");
    const name = d.name || slug;
    const maxLevel = Array.isArray(d.levels) ? d.levels.length : null;

    // preferred: icon.png; fallback: highest normal/level-N.png (buildings/traps);
    // special-case: town-hall images live one directory up (no slug folder)
    let icon = null;
    const iconSrc = path.join(PKG, "images", "home", cat, slug, "icon.png");
    if (fs.existsSync(iconSrc)) icon = copyIcon(iconSrc, cat, slug);
    if (!icon) {
      const lvlPng = bestLevelPng(path.join(PKG, "images", "home", cat, slug, "normal"))
        || (cat === "town-hall" ? bestLevelPng(path.join(PKG, "images", "home", cat, "normal")) : null);
      if (lvlPng) icon = copyIcon(lvlPng, cat, slug);
    }

    const entry = { name, category: cat, slug, maxLevel, icon };
    if (typeof d.dataId === "number") idMap[d.dataId] = entry;
    if (icon) iconMap[name.toLowerCase()] = icon;
  }
}

fs.writeFileSync(path.join(APP, "js", "idmap.js"),
  `/* AUTO-GENERATED from the clash-of-clans-data npm package — do not edit by hand. */
const ID_MAP = ${JSON.stringify(idMap)};
const ICON_MAP = ${JSON.stringify(iconMap)};
function iconFor(name) { return ICON_MAP[String(name || "").toLowerCase()] || null; }
function entityById(id) { return ID_MAP[id] || null; }
`);
console.log(`ids mapped: ${Object.keys(idMap).length}, icons copied: ${copied}`);

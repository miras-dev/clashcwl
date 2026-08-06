/* Village Analyzer — parses official CoC API player JSON */

const SAMPLE_PLAYER = {
  tag: "#2PP0J9YLQ",
  name: "MightyChief",
  townHallLevel: 17,
  townHallWeaponLevel: 1,
  expLevel: 231,
  trophies: 5412,
  bestTrophies: 5620,
  warStars: 1487,
  clan: { name: "Iron Legion", tag: "#2QRPLG0V" },
  league: { name: "Legend League" },
  heroes: [
    { name: "Barbarian King", level: 92, maxLevel: 100, village: "home" },
    { name: "Archer Queen", level: 95, maxLevel: 100, village: "home" },
    { name: "Minion Prince", level: 70, maxLevel: 90, village: "home" },
    { name: "Grand Warden", level: 71, maxLevel: 75, village: "home" },
    { name: "Royal Champion", level: 48, maxLevel: 50, village: "home" },
    { name: "Dragon Duke", level: 10, maxLevel: 20, village: "home" },
    { name: "Battle Machine", level: 35, maxLevel: 35, village: "builderBase" },
  ],
  heroEquipment: [
    { name: "Spiky Ball", level: 18, maxLevel: 27, village: "home" },
    { name: "Giant Gauntlet", level: 21, maxLevel: 27, village: "home" },
    { name: "Rage Vial", level: 15, maxLevel: 18, village: "home" },
    { name: "Action Figure", level: 15, maxLevel: 27, village: "home" },
    { name: "Magic Mirror", level: 18, maxLevel: 27, village: "home" },
    { name: "Giant Arrow", level: 15, maxLevel: 18, village: "home" },
    { name: "Eternal Tome", level: 15, maxLevel: 18, village: "home" },
    { name: "Healing Tome", level: 14, maxLevel: 18, village: "home" },
    { name: "Fireball", level: 20, maxLevel: 27, village: "home" },
    { name: "Electro Boots", level: 16, maxLevel: 27, village: "home" },
    { name: "Rocket Spear", level: 12, maxLevel: 27, village: "home" },
    { name: "Seeking Shield", level: 15, maxLevel: 18, village: "home" },
    { name: "Dark Orb", level: 13, maxLevel: 18, village: "home" },
    { name: "Meteor Staff", level: 9, maxLevel: 27, village: "home" },
    { name: "Fire Heart", level: 8, maxLevel: 18, village: "home" },
    { name: "Stun Blaster", level: 6, maxLevel: 18, village: "home" },
  ],
  troops: [
    { name: "Barbarian", level: 12, maxLevel: 13, village: "home" },
    { name: "Archer", level: 13, maxLevel: 14, village: "home" },
    { name: "Dragon", level: 11, maxLevel: 12, village: "home" },
    { name: "Electro Dragon", level: 8, maxLevel: 9, village: "home" },
    { name: "Root Rider", level: 3, maxLevel: 4, village: "home" },
    { name: "Super Bowler", level: 7, maxLevel: 8, village: "home" },
    { name: "Yeti", level: 6, maxLevel: 7, village: "home" },
    { name: "Balloon", level: 11, maxLevel: 12, village: "home" },
    { name: "Hog Rider", level: 13, maxLevel: 15, village: "home" },
    { name: "Valkyrie", level: 11, maxLevel: 12, village: "home" },
  ],
  spells: [
    { name: "Lightning Spell", level: 12, maxLevel: 13, village: "home" },
    { name: "Healing Spell", level: 11, maxLevel: 12, village: "home" },
    { name: "Rage Spell", level: 7, maxLevel: 8, village: "home" },
    { name: "Freeze Spell", level: 7, maxLevel: 8, village: "home" },
    { name: "Poison Spell", level: 11, maxLevel: 12, village: "home" },
    { name: "Totem Spell", level: 2, maxLevel: 3, village: "home" },
  ],
};

const $ = (id) => document.getElementById(id);

/* ---- normalize the in-game village-export format ----
   That format uses numeric IDs: {"heroes":[{"data":28000000,"lvl":92}], "units":[...],
   "spells":[...], "equipment":[...], "buildings":[{"data":1000008,"lvl":10,"x":..,"y":..}]}.
   We convert it to the official-API shape using ID_MAP (js/idmap.js). */
function isVillageExport(raw) {
  const firstOf = (a) => Array.isArray(a) && a.length ? a[0] : null;
  return [raw.heroes, raw.units, raw.spells, raw.equipment, raw.buildings]
    .some(a => { const f = firstOf(a); return f && f.data != null && f.name == null; });
}

function normalizeInput(raw) {
  if (!isVillageExport(raw)) return raw;

  // Detect 0-indexed levels (game-internal): if any convertible item has lvl 0,
  // the whole file is 0-indexed and we add +1 for display.
  const all = [raw.heroes, raw.units, raw.spells, raw.equipment, raw.buildings, raw.traps, raw.siege_machines, raw.pets]
    .flatMap(a => Array.isArray(a) ? a : []);
  const zeroIndexed = all.some(it => it.lvl === 0);
  const adj = (lvl) => (lvl == null ? 0 : lvl + (zeroIndexed ? 1 : 0));

  const conv = (arr) => (arr || []).map(it => {
    const e = entityById(it.data) || {};
    const level = adj(it.lvl);
    // stale package data can under-report a max — hide it rather than show level > max
    const maxLevel = e.maxLevel && e.maxLevel >= level ? e.maxLevel : null;
    return {
      name: e.name || `Unknown (#${it.data})`,
      level,
      maxLevel,
      count: it.cnt,
      village: "home",
    };
  });
  const bconv = (arr) => (arr || []).map(it => {
    const e = entityById(it.data) || {};
    return { name: e.name || `Unknown (#${it.data})`, level: adj(it.lvl), x: it.x, y: it.y };
  });

  const out = {
    tag: raw.tag,
    name: raw.name || null,
    _source: "village-export",
    _zeroIndexed: zeroIndexed,
    heroes: conv(raw.heroes),
    heroEquipment: conv(raw.equipment),
    troops: [...conv(raw.units), ...conv(raw.siege_machines), ...conv(raw.pets)],
    spells: conv(raw.spells),
    buildings: [...bconv(raw.buildings), ...bconv(raw.traps)],
  };
  const thB = (raw.buildings || []).find(b => b.data === 1000001);
  if (thB) out.townHallLevel = adj(thB.lvl);
  // For export data, per-TH caps aren't included — use the KB's July 2026 game max
  out.heroes.forEach(h => { const kb = kbFindHero(h.name); h.maxLevel = (kb && kb.maxLevel) || h.maxLevel || h.level; });
  return out;
}

function icon(name, size = 30) {
  const src = typeof iconFor === "function" ? iconFor(name) : null;
  return src ? `<img src="${src}" alt="" style="width:${size}px;height:${size}px;object-fit:contain;vertical-align:middle;border-radius:6px" />` : "";
}

$("analyzeBtn").addEventListener("click", () => {
  const raw = $("jsonInput").value.trim();
  if (!raw) return showError("Paste your player JSON first.");
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { return showError("Invalid JSON: " + e.message); }
  if (!data.heroes && !data.heroEquipment && !data.troops && !data.buildings && !data.units) {
    return showError("This doesn't look like player/village JSON — expected at least one of: heroes, heroEquipment, troops, units, buildings.");
  }
  hideError();
  data = normalizeInput(data);
  savePlayerData(data);
  render(data);
});

// One click = full result. Filling the box and making the user press a second
// button was an unnecessary step for someone just evaluating the tool.
$("sampleBtn").addEventListener("click", () => {
  $("jsonInput").value = JSON.stringify(SAMPLE_PLAYER, null, 2);
  hideError();
  const data = normalizeInput(JSON.parse(JSON.stringify(SAMPLE_PLAYER)));
  savePlayerData(data);
  render(data);
});

$("clearBtn").addEventListener("click", () => {
  localStorage.removeItem("cc_player");
  $("jsonInput").value = "";
  $("results").style.display = "none";
});

function showError(msg) {
  const el = $("parseError");
  el.textContent = msg;
  el.style.display = "block";
}
function hideError() { $("parseError").style.display = "none"; }

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function homeOnly(arr) {
  return (arr || []).filter(x => !x.village || x.village === "home");
}

function bar(level, max, extraClass = "") {
  const pct = max ? Math.min(100, Math.round((level / max) * 100)) : 0;
  const maxed = level >= max && max > 0;
  return `<div class="progress ${maxed ? "maxed" : ""} ${extraClass}"><div style="width:${pct}%"></div></div>`;
}

function render(data) {
  $("results").style.display = "block";

  // The coach and the ZapQuake planner share this page and both key off the
  // village that was just saved.
  if (typeof refreshPlayerBadge === "function") refreshPlayerBadge();
  if (typeof renderZapQuake === "function") renderZapQuake();

  // export data has no per-TH caps — always show the KB's current game max
  if (data._source === "village-export") {
    (data.heroes || []).forEach(h => { const kb = kbFindHero(h.name); if (kb) h.maxLevel = kb.maxLevel; });
  }

  /* --- summary --- */
  const th = data.townHallLevel || "?";
  // only show the stats this JSON actually contains (village exports have no
  // trophies / war stars / XP — dashes just look broken)
  const stat = (label, value) =>
    `<div><div class="muted small">${label}</div><div style="font-size:1.4rem;font-weight:800">${value}</div></div>`;
  const stats = [
    `<div style="display:flex;align-items:center;gap:10px">${icon("Town Hall", 44)}${stat("Town Hall", `<span style="color:var(--gold)">TH ${th}</span>`)}</div>`,
  ];
  if (data.trophies != null) stats.push(stat("Trophies", `${data.trophies} 🏆`));
  if (data.warStars != null) stats.push(stat("War Stars", `${data.warStars} ⭐`));
  if (data.expLevel != null) stats.push(stat("XP", data.expLevel));

  const title = data.name || data.tag || "My Village";
  $("playerSummary").innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div>
        <h3 style="font-size:1.25rem">${esc(title)} ${data.name && data.tag ? `<span class="muted">${esc(data.tag)}</span>` : ""}</h3>
        <p class="muted">${data.clan ? esc(data.clan.name) + " · " : ""}${data.league ? esc(data.league.name) : ""}</p>
        ${data._source === "village-export" ? `<p class="muted small">📦 In-game village export — names resolved from numeric IDs${data._zeroIndexed ? ", levels adjusted from 0-indexed" : ""}.</p>` : ""}
      </div>
      <div class="row" style="gap:22px">${stats.join("")}</div>
    </div>`;

  /* --- heroes --- */
  const heroes = homeOnly(data.heroes);
  $("heroCards").innerHTML = heroes.length
    ? heroes.map(h => {
        const kb = kbFindHero(h.name);
        const gameMax = kb ? kb.maxLevel : h.maxLevel;
        return `
        <div class="hero-card">
          <h3 style="display:flex;align-items:center;gap:8px">${icon(h.name, 34)} ${esc(h.name)}</h3>
          <div class="lvl">${h.level} <small>/ ${h.maxLevel}${data._source === "village-export" ? " game max" : ` at your TH${kb ? ` · ${gameMax} game max` : ""}`}</small></div>
          ${bar(h.level, h.maxLevel)}
          ${kb ? `<p class="muted small" style="margin-top:8px">${esc(kb.role)}</p>` : ""}
        </div>`;
      }).join("")
    : `<p class="muted">No home-village heroes found in this JSON.</p>`;

  /* --- equipment --- */
  const equip = homeOnly(data.heroEquipment);
  const tbody = document.querySelector("#equipTable tbody");
  if (equip.length) {
    const rows = equip.map(e => {
      const kb = kbFindEquipment(e.name);
      return { e, kb, tierOrder: kb ? ["SSS","SS","S","A","B","C","F"].indexOf(kb.tier) : 99 };
    }).sort((a, b) => a.tierOrder - b.tierOrder);
    tbody.innerHTML = rows.map(({ e, kb }) => `
      <tr>
        <td><div style="display:flex;align-items:center;gap:10px">${icon(e.name, 32)}<div><strong>${esc(e.name)}</strong>${kb ? `<div class="muted small">${esc(kb.note)}</div>` : ""}</div></div></td>
        <td class="muted">${kb ? esc(kb.hero) : "—"}</td>
        <td>${kb ? `<span class="pill ${kb.rarity.toLowerCase()}">${kb.rarity}</span>` : "—"}</td>
        <td><strong>${e.level}</strong> <span class="muted">${e.maxLevel ? `/ ${e.maxLevel}` : ""}</span></td>
        <td style="min-width:120px">${e.maxLevel ? bar(e.level, e.maxLevel) : ""}</td>
        <td>${kb ? `<span class="tier ${tierClass(kb.tier)}">${kb.tier}</span>` : "—"}</td>
      </tr>`).join("");
  } else {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No hero equipment found in this JSON.</td></tr>`;
  }

  /* --- upgrade priorities --- */
  $("priorities").innerHTML = buildPriorities(heroes, equip);

  /* --- troops & spells --- */
  $("troopsList").innerHTML = levelList(homeOnly(data.troops));
  $("spellsList").innerHTML = levelList(homeOnly(data.spells));

  /* --- buildings (optional, layout exports) --- */
  const buildings = data.buildings || data.defenses;
  if (Array.isArray(buildings) && buildings.length) {
    $("buildingsSection").style.display = "block";
    // group identical buildings: "Cannon ×2 (L10, L9)"
    const groups = {};
    buildings.forEach(b => {
      const key = b.name || String(b.data || "Building");
      (groups[key] = groups[key] || []).push(b.level ?? b.lvl ?? 0);
    });
    $("buildingsList").innerHTML = `<table><thead><tr><th>Building</th><th>Count</th><th>Levels</th></tr></thead><tbody>` +
      Object.entries(groups)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([name, lvls]) => `<tr>
          <td><div style="display:flex;align-items:center;gap:10px">${icon(name, 28)}<span>${esc(name)}</span></div></td>
          <td>×${lvls.length}</td>
          <td class="muted">${lvls.sort((a, b) => b - a).map(l => `L${l}`).join(", ")}</td>
        </tr>`).join("") + `</tbody></table>`;
  } else {
    $("buildingsSection").style.display = "none";
  }

  /* --- army suggestions --- */
  const thNum = Number(data.townHallLevel);
  const armies = KB.armies.filter(a => a.townHall === (thNum >= 18 ? 18 : thNum <= 17 ? 17 : thNum));
  const pool = armies.length ? armies : KB.armies.filter(a => a.townHall === 18);
  $("armySuggestions").innerHTML = pool.map(a => `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <h3>${esc(a.name)} <span class="pill gold">TH${a.townHall}</span> <span class="pill">${esc(a.difficulty)}</span></h3>
      </div>
      <p class="muted" style="margin-top:6px"><strong style="color:var(--text)">Comp:</strong> ${esc(a.comp)}</p>
      <p class="muted"><strong style="color:var(--text)">Heroes:</strong> ${esc(a.heroes)}</p>
      <p class="muted"><strong style="color:var(--text)">Why:</strong> ${esc(a.why)}</p>
    </div>`).join("");

  window.scrollTo({ top: $("results").offsetTop - 80, behavior: "smooth" });
}

function levelList(items) {
  if (!items.length) return `<p class="muted">None found in this JSON.</p>`;
  return `<table><tbody>` + items.map(t => `
    <tr>
      <td><div style="display:flex;align-items:center;gap:10px">${icon(t.name, 28)}<span>${esc(t.name)}${t.count ? ` <span class="muted small">×${t.count}</span>` : ""}</span></div></td>
      <td style="white-space:nowrap"><strong>${t.level}</strong> <span class="muted">${t.maxLevel ? `/ ${t.maxLevel}` : ""}</span></td>
      <td style="min-width:110px">${t.maxLevel ? bar(t.level, t.maxLevel) : ""}</td>
    </tr>`).join("") + `</tbody></table>`;
}

function buildPriorities(heroes, equip) {
  const items = [];

  // Heroes below their TH cap
  heroes.forEach(h => {
    if (h.level < h.maxLevel) {
      const gap = h.maxLevel - h.level;
      items.push({
        score: gap >= 10 ? 3 : 2,
        text: `<strong>${esc(h.name)}</strong> is ${gap} level${gap > 1 ? "s" : ""} below your TH cap (${h.level}/${h.maxLevel}). Hero levels are the single biggest power gain — use the Unlimited Heroes event and July's up-to-40% discounts.`,
      });
    }
  });

  // Top-tier equipment below breakpoints
  equip.forEach(e => {
    const kb = kbFindEquipment(e.name);
    if (!kb) return;
    const bpMatch = /L(\d+)/.exec(kb.breakpoint || "");
    const bp = bpMatch ? Number(bpMatch[1]) : null;
    if (["SSS", "SS"].includes(kb.tier) && bp && e.level < bp) {
      items.push({
        score: 3,
        text: `<strong>${esc(e.name)}</strong> (${kb.tier}-tier, ${esc(kb.hero)}) is level ${e.level} — push it to its breakpoint <strong>${esc(kb.breakpoint)}</strong>. ${kb.rarity === "Epic" ? "Spend your Starry Ore here." : "Cheap Shiny/Glowy Ore investment."}`,
      });
    } else if (kb.tier === "S" && bp && e.level < bp) {
      items.push({
        score: 2,
        text: `<strong>${esc(e.name)}</strong> (S-tier, ${esc(kb.hero)}) at level ${e.level} — worth taking to L${bp} once your SS/SSS pieces hit their breakpoints.`,
      });
    } else if (["F", "C"].includes(kb.tier) && e.level > 9) {
      items.push({
        score: 1,
        text: `You've invested in <strong>${esc(e.name)}</strong> (${kb.tier}-tier) — stop here; that Ore is better spent on ${esc(kb.hero)}'s meta equipment.`,
      });
    }
  });

  // Fireball special case
  const fb = equip.find(e => e.name === "Fireball");
  if (fb && fb.level >= 15 && fb.level < 24) {
    items.push({
      score: 3,
      text: `<strong>Fireball</strong> is level ${fb.level} — it only becomes attack-viable at <strong>L24</strong>. Either commit Starry Ore to reach 24 or don't equip it yet.`,
    });
  }

  if (!items.length) return `<p class="success">Nothing urgent — your heroes and meta equipment are in great shape for your Town Hall. Focus Ore on epic max-outs (L27).</p>`;

  items.sort((a, b) => b.score - a.score);
  const icons = { 3: "🔴", 2: "🟡", 1: "⚪" };
  return `<ol style="padding-left:20px;display:flex;flex-direction:column;gap:10px">` +
    items.slice(0, 10).map(i => `<li class="muted" style="color:var(--text)">${icons[i.score]} ${i.text}</li>`).join("") + `</ol>`;
}

/* restore last session */
const saved = loadPlayerData();
if (saved) {
  $("jsonInput").value = JSON.stringify(saved, null, 2);
  render(saved);
}

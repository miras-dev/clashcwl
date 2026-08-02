/* Clash Companion — knowledge base (researched July 2026)
   Sources: Supercell release notes, Clash Wiki, ClashOS/BaseDrop/Blueprint CoC meta guides. */

const DEFAULT_KB = {
  meta: {
    lastUpdated: "July 2026",
    currentMaxTownHall: 18,
    notes: "TH18 released Nov 2025 ('TOWN HALL 18 Crash Lands'). TH19 teased for late 2026.",
  },

  heroes: [
    {
      name: "Barbarian King",
      unlock: "TH7 (Hero Hall)",
      maxLevel: 110,
      role: "Tanky melee bruiser. With Spiky Ball he clears whole compartments; often used as a solo flank cleaner or in the main push.",
    },
    {
      name: "Archer Queen",
      unlock: "TH9",
      maxLevel: 110,
      role: "Highest single-target DPS hero. Action Figure / Magic Mirror made her the strongest hero in the TH18 meta. Queen charges still work with Healer Puppet or Magic Mirror.",
    },
    {
      name: "Minion Prince",
      unlock: "TH9 (Hero Hall 6)",
      maxLevel: 95,
      role: "Flying hero released Nov 2024. Dark Orb slow aura supports air and ground pushes. June 2026 balance: base HP -1000 but each equipment now grants +500 HP (defensive nerf).",
    },
    {
      name: "Grand Warden",
      unlock: "TH11",
      maxLevel: 85,
      role: "Support hero. Eternal Tome invincibility is the most-used ability in the game; Fireball variants delete key defense clusters at level 24+.",
    },
    {
      name: "Royal Champion",
      unlock: "TH13",
      maxLevel: 55,
      role: "Seeking-shield sniper. Electro Boots RC is 'busted' — chain damage aura ~200 DPS plus passive healing. RC walks open bases for Root Riders / Dragons.",
    },
    {
      name: "Dragon Duke",
      unlock: "TH15 (Hero Hall 9)",
      maxLevel: 25,
      role: "6th hero, released March 1, 2026. Second flying hero. CANNOT be healed by Healers — sustain comes from Fire Heart equipment. Core of the Rocket E-Drag meta at TH18.",
    },
  ],

  // rarity: common max 18 (Shiny+Glowy Ore), epic max 27 (adds Starry Ore)
  equipment: [
    // Barbarian King
    { hero: "Barbarian King", name: "Spiky Ball", rarity: "Epic", maxLevel: 27, tier: "SS", breakpoint: "L18 (7 targets, ~2,500 dmg)", note: "Best BK equipment. Area splash lets the King chunk whole compartments." },
    { hero: "Barbarian King", name: "Giant Gauntlet", rarity: "Epic", maxLevel: 27, tier: "S", breakpoint: "L18", note: "King becomes a giant with splash damage and damage reduction. Great for smash attacks." },
    { hero: "Barbarian King", name: "Stick Horse", rarity: "Epic", maxLevel: 27, tier: "S", breakpoint: "L18", note: "Mobility + damage; strong in the 2026 meta." },
    { hero: "Barbarian King", name: "Snake Bracelet", rarity: "Epic", maxLevel: 27, tier: "S", breakpoint: "L18", note: "Summons snakes that swarm defenses." },
    { hero: "Barbarian King", name: "Earthquake Boots", rarity: "Common", maxLevel: 18, tier: "A", breakpoint: "L15", note: "Wall-break utility — budget option that enables funneling." },
    { hero: "Barbarian King", name: "Rage Vial", rarity: "Common", maxLevel: 18, tier: "C", breakpoint: "L15", note: "Classic ability; outclassed by epics." },
    { hero: "Barbarian King", name: "Vampstache", rarity: "Common", maxLevel: 18, tier: "F", breakpoint: "—", note: "Lifesteal too weak at high THs." },
    { hero: "Barbarian King", name: "Barbarian Puppet", rarity: "Common", maxLevel: 18, tier: "F", breakpoint: "—", note: "Skip." },
    // Archer Queen
    { hero: "Archer Queen", name: "Action Figure", rarity: "Epic", maxLevel: 27, tier: "SSS", breakpoint: "L21 (18,000+ HP giant figure)", note: "Best equipment in the game in 2026 — summons a giant tanking figure." },
    { hero: "Archer Queen", name: "Magic Mirror", rarity: "Epic", maxLevel: 27, tier: "SS", breakpoint: "L18 (optimal clone count)", note: "Clones the Queen; backbone of queen-charge play." },
    { hero: "Archer Queen", name: "Monolith Arrow", rarity: "Epic", maxLevel: 27, tier: "S", breakpoint: "L21", note: "2026 release — arrow that deals percentage-based Monolith damage." },
    { hero: "Archer Queen", name: "Giant Arrow", rarity: "Common", maxLevel: 18, tier: "S", breakpoint: "L15", note: "Cross-map value: snipes Eagle/Monolith lines; enables blimp play." },
    { hero: "Archer Queen", name: "Frozen Arrow", rarity: "Epic", maxLevel: 27, tier: "B", breakpoint: "L18", note: "Slow on hit; fell off the meta." },
    { hero: "Archer Queen", name: "Healer Puppet", rarity: "Common", maxLevel: 18, tier: "B", breakpoint: "L15", note: "Sustain for queen walks." },
    { hero: "Archer Queen", name: "Invisibility Vial", rarity: "Common", maxLevel: 18, tier: "C", breakpoint: "L15", note: "Niche clutch tool." },
    { hero: "Archer Queen", name: "Archer Puppet", rarity: "Common", maxLevel: 18, tier: "F", breakpoint: "—", note: "Skip." },
    // Grand Warden
    { hero: "Grand Warden", name: "Eternal Tome", rarity: "Common", maxLevel: 18, tier: "SS", breakpoint: "L15 (8s invincibility)", note: "The most reliable ability in the game — pairs with every army." },
    { hero: "Grand Warden", name: "Healing Tome", rarity: "Common", maxLevel: 18, tier: "SS", breakpoint: "L15", note: "Mass heal; standard second slot for air armies." },
    { hero: "Grand Warden", name: "Rage Gem", rarity: "Common", maxLevel: 18, tier: "S", breakpoint: "L15", note: "Aura rage for smash pushes." },
    { hero: "Grand Warden", name: "Fireball", rarity: "Epic", maxLevel: 27, tier: "S", breakpoint: "L24 (minimum viable)", note: "Deletes a defense cluster. NOT worth equipping below level 24." },
    { hero: "Grand Warden", name: "Life Gem", rarity: "Common", maxLevel: 18, tier: "A", breakpoint: "L15", note: "Passive HP aura for the army." },
    { hero: "Grand Warden", name: "Heroic Torch", rarity: "Epic", maxLevel: 27, tier: "A", breakpoint: "L18", note: "2025/26 epic; jump-like mobility support." },
    { hero: "Grand Warden", name: "Lavaloon Puppet", rarity: "Epic", maxLevel: 27, tier: "F", breakpoint: "—", note: "Skip — weak summon value." },
    // Royal Champion
    { hero: "Royal Champion", name: "Electro Boots", rarity: "Epic", maxLevel: 27, tier: "SS", breakpoint: "L15 (optimal self-heal)", note: "Chain-lightning aura (~200 DPS), deletes skeleton traps, passive healing. Core of RC walks." },
    { hero: "Royal Champion", name: "Rocket Spear", rarity: "Epic", maxLevel: 27, tier: "S", breakpoint: "L18 (9 spears)", note: "Long-range multi-hit ability." },
    { hero: "Royal Champion", name: "Frost Flake", rarity: "Epic", maxLevel: 27, tier: "S", breakpoint: "L18", note: "2026 epic — freeze utility on ability." },
    { hero: "Royal Champion", name: "Haste Vial", rarity: "Common", maxLevel: 18, tier: "A", breakpoint: "L15", note: "Speed boost; budget RC-walk option." },
    { hero: "Royal Champion", name: "Seeking Shield", rarity: "Common", maxLevel: 18, tier: "B", breakpoint: "L15", note: "Default multi-target shield throw." },
    { hero: "Royal Champion", name: "Hog Rider Puppet", rarity: "Common", maxLevel: 18, tier: "C", breakpoint: "L15", note: "Niche." },
    { hero: "Royal Champion", name: "Royal Gem", rarity: "Common", maxLevel: 18, tier: "F", breakpoint: "—", note: "Skip." },
    // Dragon Duke
    { hero: "Dragon Duke", name: "Fire Heart", rarity: "Common", maxLevel: 18, tier: "SS", breakpoint: "L15 (~140 HPS self-heal)", note: "Essential — the Duke can't be healed by Healers, so this is his sustain." },
    { hero: "Dragon Duke", name: "Stun Blaster", rarity: "Common", maxLevel: 18, tier: "S", breakpoint: "L15", note: "Stuns defenses; strong with Rocket E-Drag pushes." },
    { hero: "Dragon Duke", name: "Rocket Backpack", rarity: "Epic", maxLevel: 27, tier: "A", breakpoint: "L18", note: "Mobility burst / dive tool." },
    { hero: "Dragon Duke", name: "Electro Fangs", rarity: "Common", maxLevel: 18, tier: "A", breakpoint: "L15", note: "Chain damage bite." },
    { hero: "Dragon Duke", name: "Flame Blower", rarity: "Common", maxLevel: 18, tier: "B", breakpoint: "L15", note: "Cone burn damage." },
    // Minion Prince
    { hero: "Minion Prince", name: "Dark Orb", rarity: "Common", maxLevel: 18, tier: "SS", breakpoint: "L15 (50% slow aura)", note: "Best MP equipment — massive slow aura that carries air attacks." },
    { hero: "Minion Prince", name: "Meteor Staff", rarity: "Epic", maxLevel: 27, tier: "S", breakpoint: "L18", note: "Calls meteors on defenses." },
    { hero: "Minion Prince", name: "Dark Crown", rarity: "Epic", maxLevel: 27, tier: "S", breakpoint: "L18", note: "2026 epic — empowered royal aura." },
    { hero: "Minion Prince", name: "Henchmen Puppet", rarity: "Common", maxLevel: 18, tier: "B", breakpoint: "L15", note: "Bodyguard summons." },
    { hero: "Minion Prince", name: "Noble Iron", rarity: "Common", maxLevel: 18, tier: "C", breakpoint: "L15", note: "Niche." },
    { hero: "Minion Prince", name: "Metal Pants", rarity: "Common", maxLevel: 18, tier: "C", breakpoint: "L15", note: "Defensive stat stick." },
  ],

  armies: [
    {
      townHall: 18, name: "Super Bowler Smash", difficulty: "Easy",
      comp: "Super Bowlers + Root Rider tanks, Rage/Heal/Totem spells, Flame Flinger or Battle Drill",
      heroes: "BK Spiky Ball + Giant Gauntlet, AQ Action Figure + Healer Puppet, GW Eternal + Healing Tome, RC Electro Boots, MP Dark Orb",
      why: "Safest default at TH18 — brute-force line push that forgives pathing mistakes.",
    },
    {
      townHall: 18, name: "Hydra + Totem Spells", difficulty: "Medium",
      comp: "Dragons + Dragon Riders + Balloons (Hydra), Totem spells, Minion Prince + Dragon Duke in the air push",
      heroes: "MP Dark Orb + Meteor Staff, Dragon Duke Fire Heart + Stun Blaster, GW Eternal Tome (air mode)",
      why: "Faster air alternative; totems sustain the beatdown. Note: July 2026 balance nerfed Dragon Riders slightly.",
    },
    {
      townHall: 18, name: "Rocket E-Drag + Dragon Duke", difficulty: "Easy",
      comp: "Electro Dragons + Rocket Balloons, Lightning/Rage, Dragon Duke leads the push",
      heroes: "Dragon Duke Fire Heart + Stun Blaster, MP Dark Orb, GW Eternal Tome",
      why: "Massive chain damage with clean pathing and strong recovery. E-Drag was buffed July 2026.",
    },
    {
      townHall: 18, name: "Fireball Meteor Golem", difficulty: "Hard",
      comp: "Meteor Golems core, Warden Fireball opens the core, cleanup troops + siege",
      heroes: "GW Fireball L24+, AQ Action Figure, RC Electro Boots",
      why: "Highest ceiling for skilled players; Meteor Golems buffed in July 2026 balance patch.",
    },
    {
      townHall: 18, name: "RC Walk Root Riders + Throwers", difficulty: "Medium",
      comp: "Root Riders + Throwers main push after an Electro Boots RC walk opens 30-40%",
      heroes: "RC Electro Boots (walk), AQ Action Figure, GW Rage Gem or Eternal Tome",
      why: "Current war/legend meta staple — crushes ring and box bases alike.",
    },
    {
      townHall: 17, name: "Fireball Super Yetis", difficulty: "Medium",
      comp: "Super Yetis core push, Warden Fireball removes the key cluster, siege blimp optional",
      heroes: "GW Fireball L24+, BK Spiky Ball, RC Electro Boots",
      why: "Most consistent TH17 smash in 2026.",
    },
    {
      townHall: 17, name: "RC Walk Dragons", difficulty: "Easy",
      comp: "Dragons + Balloons after an RC walk removes air defenses on one side",
      heroes: "RC Electro Boots, MP Dark Orb, GW Eternal Tome",
      why: "Most forgiving option for newer TH17 players.",
    },
    {
      townHall: 17, name: "Root Riders + RC Walk", difficulty: "Medium",
      comp: "Root Riders + Witches/Valks behind, RC walk opener",
      heroes: "RC Electro Boots, AQ Action Figure or Magic Mirror",
      why: "Strongest TH17 ground strategy when executed well.",
    },
    {
      townHall: 17, name: "Fireball Rocket Loons", difficulty: "Hard",
      comp: "Rocket Loon sniping + hero dives, Warden Fireball setup",
      heroes: "GW Fireball, AQ Magic Mirror, Dragon Duke dive",
      why: "Powerful hybrid air strategy with a high skill ceiling.",
    },
  ],

  townHall18: {
    released: "November 2025",
    guardians: "Two Guardians — a Town Hall weapon 'with legs, hands and eyes'. Only one defends at a time; upgraded by Builders. They defend in Wars and Ranked even while upgrading (not in regular multiplayer during upgrade).",
    superWizardTower: "Merge two Wizard Towers at TH18 → Super Wizard Tower. Its Super Wizard chains attacks to up to 15 nearby enemies.",
    craftables: "4-month season craftables: Hero Bell (buffs defending heroes' HP/DPS — no attack itself; buff dies with the building), Bomb Hive, Light Beam.",
    keyMaxLevels: "King/Queen 110, Warden 85, RC 55, Minion Prince 95, Dragon Duke 25, Hero Hall 12, Pet House 12, Inferno Tower 12, Monolith 5, Spell Tower 4, walls L19 (all 325).",
  },

  ranked: {
    system: "Ranked Battles (reworked April 2026). Weekly pools of 100 players per league; top earners promote, bottom demote. Lower leagues: 6 attacks/week; Legend League: up to 30 attacks/week.",
    legendTiers: "Legend League split into Legend I, II, III — same Star/League bonus, different difficulty and Battle Modifiers per tier.",
    trophies: "Above 5,000, trophies reset to 5,000 at tournament end; the excess converts to permanent Legend Trophies on your profile.",
    inactivity: "4-week grace period with no demotion; afterwards you drop only one rank every 4 weeks.",
    baseTips: "Legend bases in 2026 favour anti-2-star ring/hybrid layouts with split Guardian coverage, spread air defenses vs Hydra, and Monolith+Multi-Inferno cores vs Root Riders.",
  },

  updates2026: [
    "Mar 2026 — Dragon Duke released (6th hero, TH15+, 2nd flying hero, cannot be Healer-healed).",
    "Apr 2026 — Ranked Mode rework: Legend I/II/III tiers, weekly 100-player pools, Migration Week placement (Apr 20).",
    "Jun 2026 — Minion Prince rebalance: -1,000 base HP, +500 HP per equipment (defense nerf).",
    "Jul 2026 — 'Barbarian's Odyssey' Greek-mythology season: Zeus/Poseidon/Medusa skins, Summer Jam (up to 40% upgrade cost/time reductions, 4 themed discount weeks), Unlimited Heroes event.",
    "Jul 2026 — Balance: Dragon Duke & Dragon Rider strategies nerfed; Electro Dragon & Meteor Golem buffed.",
    "Teased — TH19 later in 2026; devs say older troops will become 'interesting again'.",
  ],

  ores: {
    system: "Equipment upgrades cost Ores: Shiny (common levels), Glowy (milestones), Starry (epic milestones). Earned from war stars (main source), Star Bonus, Trader, and events.",
    advice: "Spend Starry Ore only on SS/SSS-tier equipment at breakpoint levels (e.g. Action Figure L21, Spiky Ball L18, Fireball L24). Max hero levels before over-investing in mid-tier equipment.",
  },
};

function loadKB() {
  try {
    const stored = localStorage.getItem("cc_kb");
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("Error loading KB from localStorage:", e);
  }
  saveKB(DEFAULT_KB);
  return DEFAULT_KB;
}

function saveKB(kbObj) {
  try {
    localStorage.setItem("cc_kb", JSON.stringify(kbObj));
  } catch (e) {
    console.error("Error saving KB to localStorage:", e);
  }
}

let KB = loadKB();

/* ---- shared helpers ---- */

function kbFindEquipment(name) {
  return KB.equipment.find(e => e.name.toLowerCase() === String(name).toLowerCase());
}
function kbFindHero(name) {
  return KB.heroes.find(h => h.name.toLowerCase() === String(name).toLowerCase());
}
function tierClass(tier) {
  return "tier-" + tier.toLowerCase().replace("+", "plus");
}

function loadPlayerData() {
  try { return JSON.parse(localStorage.getItem("cc_player") || "null"); }
  catch { return null; }
}
function savePlayerData(obj) {
  localStorage.setItem("cc_player", JSON.stringify(obj));
}

/* Copy each table's column headings onto its body cells as data-label, which
   the mobile stylesheet shows beside the value once rows stack vertically.
   Doing it here keeps every render path from having to hand-write the labels.
   A MutationObserver picks up tables built after load, since most of these
   views re-render into innerHTML on user action. */
function labelTableCells(root = document) {
  root.querySelectorAll("table").forEach(table => {
    const heads = [...table.querySelectorAll("thead th")].map(th => th.textContent.trim());
    if (!heads.length) return;
    table.querySelectorAll("tbody tr").forEach(tr => {
      [...tr.children].forEach((td, i) => {
        const label = heads[i];
        // Skip index/action columns: their heading is decorative and the value
        // speaks for itself, so a label would just add noise.
        if (label && label !== "#" && !td.hasAttribute("data-label")) {
          td.setAttribute("data-label", label);
        }
      });
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  labelTableCells();
  new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === "TABLE" || node.querySelector?.("table")) {
          labelTableCells(node.parentNode || document);
          return;
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
});

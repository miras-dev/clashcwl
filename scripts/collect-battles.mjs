/* Accumulate ranked battle history for a clan.
 *
 * WHY: GET /players/{tag}/battlelog returns a rolling buffer of roughly the last
 * 50 battles of every type mixed together. For an active Legend player that is
 * under four days — one member's window measured 1.9 days. Judging CWL
 * eligibility on that is judging a fortnight of form through a keyhole, and it
 * penalises the most active players hardest, because the busier you are the
 * less of your history survives in the buffer.
 *
 * Running this daily and keeping the union of what it sees turns a ~3-day
 * window into however long collection has been running.
 *
 * This is NOT the trophy-delta polling that bots like ClashPerk do. The endpoint
 * hands us discrete battles with timestamps, so there is nothing to reconstruct:
 * we deduplicate on (playerTag, battleTimestamp) and keep the union. Missing a
 * run costs nothing as long as the gap is shorter than the buffer, and rerunning
 * is idempotent.
 *
 *   COC_API_KEY=... node scripts/collect-battles.mjs '#2L92V9CYP'
 *
 * Writes data/battles-<clanTag>.json, sorted and pruned to RETENTION_DAYS.
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");

const API_KEY = (process.env.COC_API_KEY || readKeyFile()).trim();
const COC_HOST = process.env.COC_API_HOST || "cocproxy.royaleapi.dev";

// Longer than a CWL season, so a roster decision can look back over the whole
// run-up. Older battles say little about who to field next week.
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 45);

function readKeyFile() {
  try { return fs.readFileSync(path.join(ROOT, ".coc-key"), "utf8"); }
  catch { return ""; }
}

function cocGet(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: COC_HOST,
      path: "/v1" + apiPath,
      method: "GET",
      headers: { Authorization: "Bearer " + API_KEY, Accept: "application/json" },
      timeout: 20000,
    }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body || "{}") }); }
        catch { resolve({ status: res.statusCode, json: null }); }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
    req.end();
  });
}

/* One battle, stored compactly — this file is committed and grows daily, so the
   field names are short on purpose. Roughly 73 bytes a row: a 40-member clan
   over a fortnight lands near 320KB. */
const toRow = (playerTag, b) => ({
  t: playerTag,
  d: b.battleTimestamp,
  k: b.battleType === "legend" ? "l" : "r",
  a: b.attack ? 1 : 0,
  s: Number(b.stars) || 0,
  p: Number(b.destructionPercentage) || 0,
});

/* "20260815T032813.000Z" → ms. The API omits the separators ISO 8601 wants. */
function parseStamp(stamp) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(String(stamp || ""));
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
}

async function main() {
  const clanTag = (process.argv[2] || process.env.CLAN_TAG || "").trim();
  if (!clanTag) {
    console.error("usage: node scripts/collect-battles.mjs '#CLANTAG'");
    process.exit(2);
  }
  if (!API_KEY) {
    console.error("COC_API_KEY is not set (and no .coc-key file found)");
    process.exit(2);
  }

  const bare = clanTag.replace(/^#/, "").toUpperCase();
  const outFile = path.join(DATA_DIR, `battles-${bare}.json`);

  const clanRes = await cocGet(`/clans/%23${encodeURIComponent(bare)}`);
  if (clanRes.status !== 200) {
    console.error(`clan fetch failed: HTTP ${clanRes.status}`);
    process.exit(1);
  }
  const members = clanRes.json.memberList || [];
  console.log(`${clanRes.json.name} — ${members.length} members`);

  // Load whatever we already have. A corrupt or absent file starts empty rather
  // than aborting: losing a day of history beats a broken scheduled run.
  let existing = { clanTag: clanRes.json.tag, name: clanRes.json.name, battles: [], runs: [] };
  try {
    const prev = JSON.parse(fs.readFileSync(outFile, "utf8"));
    if (Array.isArray(prev.battles)) existing = prev;
  } catch { /* first run, or unreadable — start fresh */ }

  // (tag, timestamp) identifies a battle. Two battles cannot share both.
  const seen = new Set(existing.battles.map((b) => `${b.t}|${b.d}`));
  const before = seen.size;

  const names = {};
  let fetched = 0, failed = 0, added = 0;

  const WAVE = 8;
  for (let i = 0; i < members.length; i += WAVE) {
    const wave = await Promise.allSettled(members.slice(i, i + WAVE).map(async (m) => {
      const tag = m.tag.replace(/^#/, "");
      // One retry — timeouts here are transient far more often than real.
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await cocGet(`/players/%23${encodeURIComponent(tag)}/battlelog`);
        if (r.status === 200) return { member: m, items: r.json?.items || [] };
        if (attempt === 1) throw new Error(`HTTP ${r.status}`);
      }
    }));

    for (const [j, res] of wave.entries()) {
      const m = members[i + j];
      if (res.status !== "fulfilled") {
        failed++;
        console.warn(`  ${m.name}: ${res.reason?.message || "failed"}`);
        continue;
      }
      fetched++;
      names[m.tag] = m.name;
      for (const b of res.value.items) {
        if (b.battleType !== "ranked" && b.battleType !== "legend") continue;
        const key = `${m.tag}|${b.battleTimestamp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        existing.battles.push(toRow(m.tag, b));
        added++;
      }
    }
  }

  // Prune, then sort oldest-first so the diff of each daily commit is an append
  // rather than a rewrite of the whole file.
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  const kept = existing.battles.filter((b) => {
    const ms = parseStamp(b.d);
    return ms == null || ms >= cutoff;
  });
  const pruned = existing.battles.length - kept.length;
  kept.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.t < b.t ? -1 : 1));

  const out = {
    clanTag: clanRes.json.tag,
    name: clanRes.json.name,
    updatedAt: new Date().toISOString(),
    retentionDays: RETENTION_DAYS,
    // Names change; the tag is the identity. Kept for display so the site does
    // not need a second call just to label rows.
    names: { ...existing.names, ...names },
    battles: kept,
    runs: [...(existing.runs || []), {
      at: new Date().toISOString(), fetched, failed, added, pruned,
    }].slice(-60),
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(out) + "\n");

  const span = kept.length
    ? (parseStamp(kept[kept.length - 1].d) - parseStamp(kept[0].d)) / 86400000
    : 0;
  console.log(`fetched ${fetched}, failed ${failed}`);
  console.log(`added ${added} new battles (${before} → ${seen.size}), pruned ${pruned}`);
  console.log(`history spans ${span.toFixed(1)} days → ${path.relative(ROOT, outFile)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

/* Clash Companion — static server + Clash of Clans API proxy.
 *
 * Why a proxy? The official CoC API blocks direct browser calls (no CORS headers)
 * and requires an IP-locked key that must never be shipped to the client.
 *
 * Setup — get a key at https://developer.clashofclans.com (whitelist your IP),
 * then supply it either way:
 *   • put it in a `.coc-key` file next to this script (gitignored), or
 *   • export COC_API_KEY="eyJ0eXAi..."
 * Then: node server.js      → http://localhost:8642
 *
 * With no key the app still runs — the CWL Helper falls back to manual entry
 * and tells you the proxy is offline.
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8642;
const ROOT = __dirname;

function loadKey() {
  if (process.env.COC_API_KEY) return process.env.COC_API_KEY.trim();
  try { return fs.readFileSync(path.join(ROOT, ".coc-key"), "utf8").trim(); }
  catch { return ""; }
}
const API_KEY = loadKey();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function cocGet(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.clashofclans.com",
        path: "/v1" + apiPath,
        method: "GET",
        headers: { Authorization: "Bearer " + API_KEY, Accept: "application/json" },
        timeout: 15000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(body || "{}") }); }
          catch { resolve({ status: res.statusCode, json: { reason: "badResponse", raw: body.slice(0, 400) } }); }
        });
      }
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("CoC API timeout")); });
    req.on("error", reject);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ---- API proxy ----
  if (url.pathname.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    if (url.pathname === "/api/status") {
      res.end(JSON.stringify({ ok: true, hasKey: !!API_KEY }));
      return;
    }
    if (!API_KEY) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: "no_key", message: "COC_API_KEY is not set on the server. Use manual entry, or set the key and restart." }));
      return;
    }

    // Deep clan profile: clan + every member's war stars / league / war preference.
    // Batched server-side so the browser makes one request instead of ~50.
    if (url.pathname === "/api/clan-deep") {
      const tag = (url.searchParams.get("tag") || "").trim().toUpperCase().replace(/^#/, "");
      if (!tag) { res.writeHead(400); res.end(JSON.stringify({ error: "bad_request" })); return; }
      try {
        const clanRes = await cocGet(`/clans/%23${encodeURIComponent(tag)}`);
        if (clanRes.status !== 200) { res.writeHead(clanRes.status); res.end(JSON.stringify(clanRes.json)); return; }
        const clan = clanRes.json;
        const list = clan.memberList || [];

        // fetch player details in small waves to respect rate limits
        const players = [];
        const WAVE = 8;
        for (let i = 0; i < list.length; i += WAVE) {
          const wave = await Promise.all(list.slice(i, i + WAVE).map(async (m) => {
            try {
              const p = await cocGet(`/players/%23${encodeURIComponent(m.tag.replace(/^#/, ""))}`);
              if (p.status !== 200) return null;
              const d = p.json;
              const heroSum = (d.heroes || [])
                .filter(h => !h.village || h.village === "home")
                .reduce((a, h) => a + (h.level || 0), 0);
              return {
                tag: d.tag, name: d.name, role: m.role,
                thLevel: d.townHallLevel || 0,
                expLevel: d.expLevel || 0,
                warStars: d.warStars || 0,
                warPreference: d.warPreference || "unknown",
                trophies: d.trophies || 0,
                bestTrophies: d.bestTrophies || 0,
                leagueTier: d.leagueTier ? d.leagueTier.name : null,
                heroSum,
                donations: m.donations || 0,
              };
            } catch { return null; }
          }));
          players.push(...wave.filter(Boolean));
        }

        res.end(JSON.stringify({
          tag: clan.tag, name: clan.name, level: clan.clanLevel,
          warWins: clan.warWins || 0, warTies: clan.warTies || 0, warLosses: clan.warLosses || 0,
          winStreak: clan.warWinStreak || 0,
          warLeague: clan.warLeague ? clan.warLeague.name : null,
          isWarLogPublic: !!clan.isWarLogPublic,
          clanPoints: clan.clanPoints || 0,
          requiredTownhallLevel: clan.requiredTownhallLevel || 0,
          location: clan.location ? clan.location.name : null,
          badge: clan.badgeUrls ? clan.badgeUrls.small : null,
          memberCount: clan.members || list.length,
          players,
        }));
      } catch (e) {
        res.writeHead(502);
        res.end(JSON.stringify({ error: "upstream", message: e.message }));
      }
      return;
    }

    try {
      let apiPath = null;
      const tag = (url.searchParams.get("tag") || "").trim().toUpperCase().replace(/^#/, "");
      if (url.pathname === "/api/clan" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}`;
      else if (url.pathname === "/api/clan-members" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/members`;
      else if (url.pathname === "/api/player" && tag) apiPath = `/players/%23${encodeURIComponent(tag)}`;
      else if (url.pathname === "/api/warlog" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/warlog?limit=20`;
      else if (url.pathname === "/api/cwl-group" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/currentwar/leaguegroup`;

      if (!apiPath) { res.writeHead(400); res.end(JSON.stringify({ error: "bad_request", message: "Unknown endpoint or missing ?tag=" })); return; }

      const { status, json } = await cocGet(apiPath);
      res.writeHead(status);
      res.end(JSON.stringify(json));
    } catch (e) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: "upstream", message: e.message }));
    }
    return;
  }

  // ---- static files ----
  let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
  if (url.pathname === "/") filePath = path.join(ROOT, "index.html");
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end("Forbidden"); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Clash Companion → http://localhost:${PORT}`);
  console.log(API_KEY
    ? "CoC API proxy: ENABLED (live clan fetching available)"
    : "CoC API proxy: DISABLED — set COC_API_KEY to enable live fetching (manual entry still works)");
});

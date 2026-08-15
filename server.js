/* Clash Companion — static server + Clash of Clans API proxy.
 *
 * Why a proxy? The official CoC API blocks direct browser calls (no CORS headers)
 * and requires an IP-locked key that must never be shipped to the client.
 *
 * Requests go through the RoyaleAPI proxy rather than api.clashofclans.com, so
 * the key is locked to the proxy's IP (45.79.218.79) instead of this machine's.
 * That keeps the same key working from anywhere — laptop, Lambda, Netlify.
 *
 * Setup — get a key at https://developer.clashofclans.com (whitelist
 * 45.79.218.79, not your own IP), then supply it either way:
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

// Route through RoyaleAPI's proxy so the key is IP-locked to 45.79.218.79
// rather than to whatever host happens to be running this.
const COC_HOST = process.env.COC_API_HOST || "cocproxy.royaleapi.dev";

// Simple in-memory cache
const cache = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Per-IP rate limit. The upstream key is a shared, throttled resource, so one
// scraper hitting /api/* directly would exhaust it for every real user.
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 30); // requests per window
const RATE_WINDOW = 60 * 1000;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.start >= RATE_WINDOW) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

// Drop stale buckets so the map can't grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (now - entry.start >= RATE_WINDOW) hits.delete(ip);
  }
}, RATE_WINDOW).unref();

function getCached(key) {
  const entry = cache[key];
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  return null;
}

function setCached(key, data) {
  cache[key] = {
    timestamp: Date.now(),
    data
  };
}

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
        hostname: COC_HOST,
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

    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
      || req.socket.remoteAddress || "unknown";
    if (rateLimited(ip)) {
      res.writeHead(429, { "Retry-After": "60" });
      res.end(JSON.stringify({ error: "rate_limited", message: "Too many requests. Try again in a minute." }));
      return;
    }
    if (!API_KEY) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: "no_key", message: "COC_API_KEY is not set on the server. Use manual entry, or set the key and restart." }));
      return;
    }

    // Round history lives in the Lambda (lambda/index.mjs). Rather than keep a
    // second copy of that fan-out here, dev proxies to the deployed endpoint —
    // so local and production always agree on this route.
    if (url.pathname === "/api/cwl-rounds") {
      const tag = (url.searchParams.get("tag") || "").trim().toUpperCase().replace(/^#/, "");
      if (!tag) { res.writeHead(400); res.end(JSON.stringify({ error: "bad_request" })); return; }
      try {
        const upstream = await new Promise((resolve, reject) => {
          https.get(`https://api.clashcwl.com/api/cwl-rounds?tag=${encodeURIComponent(tag)}`,
            { timeout: 60000 }, (r) => {
              let b = ""; r.on("data", c => b += c);
              r.on("end", () => resolve({ status: r.statusCode, body: b }));
            }).on("error", reject).on("timeout", function () { this.destroy(); reject(new Error("timeout")); });
        });
        res.writeHead(upstream.status);
        res.end(upstream.body);
      } catch (e) {
        res.writeHead(502);
        res.end(JSON.stringify({ error: "upstream", message: e.message }));
      }
      return;
    }

    // Deep clan profile: clan + every member's war stars / league / war preference.
    // Batched server-side so the browser makes one request instead of ~50.
    if (url.pathname === "/api/clan-deep") {
      const tag = (url.searchParams.get("tag") || "").trim().toUpperCase().replace(/^#/, "");
      if (!tag) { res.writeHead(400); res.end(JSON.stringify({ error: "bad_request" })); return; }

      const cacheKey = `clan-deep-${tag}`;
      const cached = getCached(cacheKey);
      if (cached) {
        res.end(JSON.stringify(cached));
        return;
      }

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

        const responseBody = {
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
        };

        setCached(cacheKey, responseBody);
        res.end(JSON.stringify(responseBody));
      } catch (e) {
        res.writeHead(502);
        res.end(JSON.stringify({ error: "upstream", message: e.message }));
      }
      return;
    }

    // Ranked/Legend battle logs for a whole clan, batched server-side.
    //
    // /players/{tag}/battlelog is one call per player, so a 50-member clan is 50
    // calls. Waves + the shared cache keep that within the rate limit. Individual
    // players legitimately fail (HTTP 500 is reproducible for some accounts), so a
    // failure yields battlelog: null for that member rather than sinking the batch.
    if (url.pathname === "/api/clan-battlelogs") {
      const tag = (url.searchParams.get("tag") || "").trim().toUpperCase().replace(/^#/, "");
      if (!tag) { res.writeHead(400); res.end(JSON.stringify({ error: "bad_request" })); return; }

      const cacheKey = `clan-battlelogs-${tag}`;
      const cached = getCached(cacheKey);
      if (cached) { res.end(JSON.stringify(cached)); return; }

      try {
        const clanRes = await cocGet(`/clans/%23${encodeURIComponent(tag)}`);
        if (clanRes.status !== 200) { res.writeHead(clanRes.status); res.end(JSON.stringify(clanRes.json)); return; }
        const list = clanRes.json.memberList || [];

        // allSettled, not all: a single timeout must not discard the whole clan's
        // work. One retry, because timeouts here are transient far more often
        // than they are a real failure for that player.
        const fetchOne = async (m) => {
          const memberTag = encodeURIComponent(m.tag.replace(/^#/, ""));
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const r = await cocGet(`/players/%23${memberTag}/battlelog`);
              if (r.status === 200) return { tag: m.tag, name: m.name, battlelog: r.json, error: null };
              // A non-200 is the API's verdict, not a transient fault — don't retry it.
              return { tag: m.tag, name: m.name, battlelog: null, error: `HTTP ${r.status}` };
            } catch (e) {
              if (attempt === 1) return { tag: m.tag, name: m.name, battlelog: null, error: e.message };
            }
          }
        };

        const members = [];
        const WAVE = 8;
        for (let i = 0; i < list.length; i += WAVE) {
          const wave = await Promise.allSettled(list.slice(i, i + WAVE).map(fetchOne));
          members.push(...wave.map((r, j) => r.status === "fulfilled" ? r.value : {
            tag: list[i + j].tag, name: list[i + j].name, battlelog: null,
            error: r.reason ? String(r.reason.message || r.reason) : "unknown",
          }));
        }

        const responseBody = {
          tag: clanRes.json.tag, name: clanRes.json.name,
          fetchedAt: new Date().toISOString(),
          members,
        };
        setCached(cacheKey, responseBody);
        res.end(JSON.stringify(responseBody));
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
      // Undocumented but live on the official API — see js/battlelog.js.
      else if (url.pathname === "/api/battlelog" && tag) apiPath = `/players/%23${encodeURIComponent(tag)}/battlelog`;
      else if (url.pathname === "/api/clan-members" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/members`;
      else if (url.pathname === "/api/player" && tag) apiPath = `/players/%23${encodeURIComponent(tag)}`;
      else if (url.pathname === "/api/warlog" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/warlog?limit=20`;
      else if (url.pathname === "/api/cwl-group" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/currentwar/leaguegroup`;

      if (!apiPath) { res.writeHead(400); res.end(JSON.stringify({ error: "bad_request", message: "Unknown endpoint or missing ?tag=" })); return; }

      const cacheKey = `${url.pathname}-${tag}`;
      const cached = getCached(cacheKey);
      if (cached) {
        res.end(JSON.stringify(cached));
        return;
      }

      const { status, json } = await cocGet(apiPath);
      if (status === 200) {
        setCached(cacheKey, json);
      }
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

/* Clash Companion — Clash of Clans API proxy (AWS Lambda).
 *
 * Fronted by API Gateway at https://api.clashcwl.com. The browser never talks
 * to Supercell directly: the official API sends no CORS headers and needs an
 * IP-locked key that must stay server-side.
 *
 * Requests go through the RoyaleAPI proxy, so the key is locked to that
 * service's IP (45.79.218.79) rather than to any host of ours. Lambda has no
 * stable egress IP, so calling api.clashofclans.com directly would fail.
 *
 * Setup — set COC_API_KEY in the function's environment variables.
 */
const https = require("https");

const API_KEY = process.env.COC_API_KEY || "";
const COC_HOST = process.env.COC_API_HOST || "cocproxy.royaleapi.dev";

// Browsers only need this from our own origins; the API Gateway usage plan is
// what actually limits abuse, since a non-browser client ignores CORS entirely.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS
  || "https://clashcwl.com,https://www.clashcwl.com").split(",").map(s => s.trim());

// Cache lives on the warm container. Clan and war data moves slowly, so even a
// short TTL collapses a burst of requests into one upstream call — which is
// what keeps us inside the key's throttling tier.
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  if (entry) cache.delete(key);
  return null;
}

function setCached(key, data) {
  cache.set(key, { timestamp: Date.now(), data });
  // Bound the map: a container that sees many distinct tags would otherwise
  // grow until the sandbox runs out of memory.
  if (cache.size > 500) {
    for (const [k, v] of cache) {
      if (Date.now() - v.timestamp >= CACHE_TTL) cache.delete(k);
    }
    if (cache.size > 500) cache.delete(cache.keys().next().value);
  }
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

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

exports.handler = async (event) => {
  // Works under both the HTTP API (v2) and REST API (v1) payload formats.
  const rawPath = event.rawPath || event.path || "";
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  const query = event.queryStringParameters || {};
  const origin = (event.headers?.origin) || (event.headers?.Origin) || "";
  const headers = corsHeaders(origin);

  const path = rawPath.replace(/^\/api/, "").replace(/\/$/, "") || "/";

  const reply = (statusCode, obj) => ({
    statusCode,
    headers,
    body: JSON.stringify(obj),
  });

  if (method === "OPTIONS") return { statusCode: 204, headers, body: "" };

  if (path === "/status") return reply(200, { ok: true, hasKey: !!API_KEY });

  if (!API_KEY) {
    return reply(503, {
      error: "no_key",
      message: "COC_API_KEY is not set on the function. Add it in the Lambda console under Configuration > Environment variables.",
    });
  }

  const tag = (query.tag || "").trim().toUpperCase().replace(/^#/, "");

  // Deep clan profile: clan plus every member's war stars / league / preference.
  // Batched here so the browser makes one request instead of ~50.
  if (path === "/clan-deep") {
    if (!tag) return reply(400, { error: "bad_request" });

    const cacheKey = `clan-deep-${tag}`;
    const cached = getCached(cacheKey);
    if (cached) return reply(200, cached);

    try {
      const clanRes = await cocGet(`/clans/%23${encodeURIComponent(tag)}`);
      if (clanRes.status !== 200) return reply(clanRes.status, clanRes.json);
      const clan = clanRes.json;
      const list = clan.memberList || [];

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
      return reply(200, responseBody);
    } catch (e) {
      return reply(502, { error: "upstream", message: e.message });
    }
  }

  try {
    let apiPath = null;
    if (path === "/clan" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}`;
    else if (path === "/clan-members" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/members`;
    else if (path === "/player" && tag) apiPath = `/players/%23${encodeURIComponent(tag)}`;
    else if (path === "/warlog" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/warlog?limit=20`;
    else if (path === "/cwl-group" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/currentwar/leaguegroup`;

    if (!apiPath) return reply(400, { error: "bad_request", message: "Unknown endpoint or missing ?tag=" });

    const cacheKey = `${path}-${tag}`;
    const cached = getCached(cacheKey);
    if (cached) return reply(200, cached);

    const { status, json } = await cocGet(apiPath);
    if (status === 200) setCached(cacheKey, json);
    return reply(status, json);
  } catch (e) {
    return reply(502, { error: "upstream", message: e.message });
  }
};

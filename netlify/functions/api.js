const https = require("https");

const API_KEY = process.env.COC_API_KEY || "";

// Route through RoyaleAPI's proxy so the key is IP-locked to 45.79.218.79.
// Serverless egress IPs are not static, so calling api.clashofclans.com
// directly from here would fail the key's IP check.
const COC_HOST = process.env.COC_API_HOST || "cocproxy.royaleapi.dev";

// Simple in-memory cache
const cache = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Per-IP rate limit. Only spans a single warm instance — serverless gives no
// shared state — so it blunts casual scraping but is not a hard guarantee.
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 30); // requests per window
const RATE_WINDOW = 60 * 1000;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  for (const [k, v] of hits) {
    if (now - v.start >= RATE_WINDOW) hits.delete(k);
  }
  const entry = hits.get(ip);
  if (!entry || now - entry.start >= RATE_WINDOW) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

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

exports.handler = async (event, context) => {
  const path = event.path.replace(/^\/api/, "");
  const searchParams = new URLSearchParams(event.queryStringParameters);

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  };

  // Support preflight OPTIONS requests
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: ""
    };
  }

  if (path === "/status") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, hasKey: !!API_KEY })
    };
  }

  const ip = (event.headers["x-nf-client-connection-ip"]
    || (event.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || "unknown");
  if (rateLimited(ip)) {
    return {
      statusCode: 429,
      headers: { ...headers, "Retry-After": "60" },
      body: JSON.stringify({ error: "rate_limited", message: "Too many requests. Try again in a minute." })
    };
  }

  if (!API_KEY) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: "no_key",
        message: "COC_API_KEY is not set on Netlify. Add it to Site Settings > Environment Variables."
      })
    };
  }

  const tag = (searchParams.get("tag") || "").trim().toUpperCase().replace(/^#/, "");

  if (path === "/clan-deep") {
    if (!tag) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "bad_request" }) };
    }

    // Check cache
    const cacheKey = `clan-deep-${tag}`;
    const cachedData = getCached(cacheKey);
    if (cachedData) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(cachedData)
      };
    }

    try {
      const clanRes = await cocGet(`/clans/%23${encodeURIComponent(tag)}`);
      if (clanRes.status !== 200) {
        return { statusCode: clanRes.status, headers, body: JSON.stringify(clanRes.json) };
      }
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

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(responseBody)
      };
    } catch (e) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "upstream", message: e.message }) };
    }
  }

  // Generic fallback endpoints
  const cacheKey = `${path}-${tag}`;
  const cachedData = getCached(cacheKey);
  if (cachedData) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(cachedData)
    };
  }

  try {
    let apiPath = null;
    if (path === "/clan" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}`;
    else if (path === "/clan-members" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/members`;
    else if (path === "/player" && tag) apiPath = `/players/%23${encodeURIComponent(tag)}`;
    else if (path === "/warlog" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/warlog?limit=20`;
    else if (path === "/cwl-group" && tag) apiPath = `/clans/%23${encodeURIComponent(tag)}/currentwar/leaguegroup`;

    if (!apiPath) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "bad_request", message: "Unknown endpoint or missing ?tag=" }) };
    }

    const { status, json } = await cocGet(apiPath);
    if (status === 200) {
      setCached(cacheKey, json);
    }
    return { statusCode: status, headers, body: JSON.stringify(json) };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "upstream", message: e.message }) };
  }
};

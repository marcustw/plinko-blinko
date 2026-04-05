const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const PUBLIC_DIR = path.join(__dirname, "public");
const STARTING_BALANCE_CENTS = 10_000;
const MIN_BET_CENTS = 100;
const MAX_BET_CENTS = 2_500;
const GAME_ROWS = 8;
const HISTORY_LIMIT = 10;
const LEADERBOARD_LIMIT = 5;

const RISK_TABLES = Object.freeze({
  low: [1.8, 1.4, 1.2, 0.9, 0.7, 0.9, 1.2, 1.4, 1.8],
  medium: [4.5, 2.4, 1.4, 0.8, 0.3, 0.8, 1.4, 2.4, 4.5],
  high: [9, 4.5, 2.2, 0.7, 0.1, 0.7, 2.2, 4.5, 9]
});

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png"
};

function createStore() {
  return {
    players: new Map(),
    rounds: []
  };
}

function sanitizeName(name, fallbackSuffix = "0000") {
  if (typeof name !== "string") {
    return `Player ${fallbackSuffix}`;
  }

  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return `Player ${fallbackSuffix}`;
  }

  return trimmed.slice(0, 20);
}

function createPlayerRecord({ name, playerId }) {
  const safeId = typeof playerId === "string" && playerId.trim() ? playerId.trim() : randomUUID();
  const fallbackSuffix = safeId.replace(/[^a-zA-Z0-9]/g, "").slice(-4) || "0000";
  const now = new Date().toISOString();

  return {
    id: safeId,
    name: sanitizeName(name, fallbackSuffix),
    balanceCents: STARTING_BALANCE_CENTS,
    totalWageredCents: 0,
    totalWonCents: 0,
    gamesPlayed: 0,
    biggestWinCents: 0,
    lastRoundAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function getPublicProfile(player) {
  if (!player) {
    return null;
  }

  return {
    id: player.id,
    name: player.name,
    balanceCents: player.balanceCents,
    totalWageredCents: player.totalWageredCents,
    totalWonCents: player.totalWonCents,
    gamesPlayed: player.gamesPlayed,
    biggestWinCents: player.biggestWinCents,
    lastRoundAt: player.lastRoundAt,
    createdAt: player.createdAt,
    updatedAt: player.updatedAt
  };
}

function buildLeaderboard(store) {
  return [...store.players.values()]
    .sort((left, right) => {
      if (right.balanceCents !== left.balanceCents) {
        return right.balanceCents - left.balanceCents;
      }

      if (right.biggestWinCents !== left.biggestWinCents) {
        return right.biggestWinCents - left.biggestWinCents;
      }

      return left.createdAt.localeCompare(right.createdAt);
    })
    .slice(0, LEADERBOARD_LIMIT)
    .map(getPublicProfile);
}

function getHistory(store, playerId) {
  return store.rounds
    .filter((round) => round.playerId === playerId)
    .slice(-HISTORY_LIMIT)
    .reverse();
}

function upsertPlayer(store, payload) {
  const requestedId = typeof payload.playerId === "string" && payload.playerId.trim() ? payload.playerId.trim() : null;
  const existing = requestedId ? store.players.get(requestedId) : null;

  if (existing) {
    const fallbackSuffix = existing.id.replace(/[^a-zA-Z0-9]/g, "").slice(-4) || "0000";
    existing.name = sanitizeName(payload.name, fallbackSuffix);
    existing.updatedAt = new Date().toISOString();
    return existing;
  }

  const player = createPlayerRecord({
    name: payload.name,
    playerId: requestedId || undefined
  });

  store.players.set(player.id, player);
  return player;
}

function simulateDrop(risk) {
  const multipliers = RISK_TABLES[risk];
  if (!multipliers) {
    return null;
  }

  let slotIndex = 0;
  const pathSteps = [];

  for (let row = 0; row < GAME_ROWS; row += 1) {
    const direction = Math.random() < 0.5 ? "L" : "R";
    if (direction === "R") {
      slotIndex += 1;
    }
    pathSteps.push(direction);
  }

  return {
    rows: GAME_ROWS,
    slotIndex,
    path: pathSteps,
    multiplier: multipliers[slotIndex]
  };
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8"
  });
  response.end(message);
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    request.on("error", reject);
  });
}

async function serveStaticAsset(requestPath, response) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const decodedPath = decodeURIComponent(normalizedPath);
  const assetPath = path.join(PUBLIC_DIR, decodedPath);

  if (!assetPath.startsWith(PUBLIC_DIR)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(assetPath);
    const extension = path.extname(assetPath);

    response.writeHead(200, {
      "content-type": MIME_TYPES[extension] || "application/octet-stream",
      "cache-control": extension === ".html" ? "no-cache" : "public, max-age=300"
    });
    response.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(response, 404, "Not found");
      return;
    }

    sendText(response, 500, "Failed to read asset");
  }
}

async function handleApiRequest(request, response, url, store) {
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/api/health") {
    json(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/config") {
    json(response, 200, {
      gameRows: GAME_ROWS,
      minBetCents: MIN_BET_CENTS,
      maxBetCents: MAX_BET_CENTS,
      startingBalanceCents: STARTING_BALANCE_CENTS,
      riskTables: RISK_TABLES,
      leaderboardLimit: LEADERBOARD_LIMIT
    });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/leaderboard") {
    json(response, 200, {
      leaderboard: buildLeaderboard(store)
    });
    return true;
  }

  if (request.method === "GET" && pathname.startsWith("/api/profile/")) {
    const playerId = pathname.slice("/api/profile/".length);
    const player = store.players.get(playerId);

    if (!player) {
      json(response, 404, { error: "Player not found" });
      return true;
    }

    json(response, 200, {
      profile: getPublicProfile(player)
    });
    return true;
  }

  if (request.method === "GET" && pathname.startsWith("/api/history/")) {
    const playerId = pathname.slice("/api/history/".length);
    const player = store.players.get(playerId);

    if (!player) {
      json(response, 404, { error: "Player not found" });
      return true;
    }

    json(response, 200, {
      history: getHistory(store, playerId)
    });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/profile") {
    const payload = await parseBody(request);
    const player = upsertPlayer(store, payload);

    json(response, 200, {
      profile: getPublicProfile(player),
      leaderboard: buildLeaderboard(store)
    });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/drop") {
    const payload = await parseBody(request);
    const playerId = typeof payload.playerId === "string" ? payload.playerId.trim() : "";
    const risk = typeof payload.risk === "string" ? payload.risk.trim() : "";
    const betCents = Number(payload.betCents);
    const player = store.players.get(playerId);

    if (!player) {
      json(response, 404, { error: "Player not found" });
      return true;
    }

    if (!RISK_TABLES[risk]) {
      json(response, 400, { error: "Unknown risk profile" });
      return true;
    }

    if (!Number.isInteger(betCents)) {
      json(response, 400, { error: "Bet must be a whole number of cents" });
      return true;
    }

    if (betCents < MIN_BET_CENTS || betCents > MAX_BET_CENTS) {
      json(response, 400, {
        error: `Bet must be between ${MIN_BET_CENTS} and ${MAX_BET_CENTS} cents`
      });
      return true;
    }

    if (betCents > player.balanceCents) {
      json(response, 400, { error: "Insufficient balance" });
      return true;
    }

    const drop = simulateDrop(risk);
    const payoutCents = Math.round(betCents * drop.multiplier);
    const netCents = payoutCents - betCents;

    player.balanceCents = player.balanceCents - betCents + payoutCents;
    player.totalWageredCents += betCents;
    player.totalWonCents += payoutCents;
    player.gamesPlayed += 1;
    player.biggestWinCents = Math.max(player.biggestWinCents, payoutCents);
    player.lastRoundAt = new Date().toISOString();
    player.updatedAt = player.lastRoundAt;

    const round = {
      id: randomUUID(),
      playerId: player.id,
      playerName: player.name,
      risk,
      betCents,
      payoutCents,
      netCents,
      multiplier: drop.multiplier,
      slotIndex: drop.slotIndex,
      path: drop.path,
      rows: drop.rows,
      createdAt: player.lastRoundAt
    };

    store.rounds.push(round);
    if (store.rounds.length > 200) {
      store.rounds.shift();
    }

    json(response, 200, {
      round,
      profile: getPublicProfile(player),
      history: getHistory(store, player.id),
      leaderboard: buildLeaderboard(store)
    });
    return true;
  }

  return false;
}

function createServer(options = {}) {
  const store = options.store || createStore();

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    try {
      const handled = await handleApiRequest(request, response, url, store);
      if (!handled) {
        await serveStaticAsset(url.pathname, response);
      }
    } catch (error) {
      json(response, 500, {
        error: error.message || "Unexpected server error"
      });
    }
  });

  return { server, store };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createServer();

  server.listen(port, () => {
    console.log(`Plinko Blinko running at http://localhost:${port}`);
  });
}

module.exports = {
  createServer,
  createStore,
  GAME_ROWS,
  LEADERBOARD_LIMIT,
  MAX_BET_CENTS,
  MIN_BET_CENTS,
  RISK_TABLES,
  STARTING_BALANCE_CENTS
};

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer, GAME_ROWS, MIN_BET_CENTS, RISK_TABLES, STARTING_BALANCE_CENTS } = require("../server");

async function startServer(t) {
  const { server } = createServer();

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  t.after(() => {
    server.close();
  });

  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test("health and config endpoints respond with game metadata", async (t) => {
  const baseUrl = await startServer(t);

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  const healthPayload = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(healthPayload, { ok: true });

  const configResponse = await fetch(`${baseUrl}/api/config`);
  const configPayload = await configResponse.json();
  assert.equal(configResponse.status, 200);
  assert.equal(configPayload.gameRows, GAME_ROWS);
  assert.equal(configPayload.minBetCents, MIN_BET_CENTS);
  assert.ok(configPayload.riskTables.medium[0] > configPayload.riskTables.medium[4]);
  assert.ok(configPayload.riskTables.medium.at(-1) > configPayload.riskTables.medium[4]);
});

test("risk tables pay more on the sides than the center", () => {
  for (const multipliers of Object.values(RISK_TABLES)) {
    const centerIndex = Math.floor(multipliers.length / 2);
    assert.ok(multipliers[0] > multipliers[centerIndex]);
    assert.ok(multipliers.at(-1) > multipliers[centerIndex]);
  }
});

test("creating a player and dropping a ball updates balance and history", async (t) => {
  const baseUrl = await startServer(t);

  const createResponse = await fetch(`${baseUrl}/api/profile`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ name: "Marcus" })
  });

  const createPayload = await createResponse.json();
  assert.equal(createResponse.status, 200);
  assert.equal(createPayload.profile.name, "Marcus");
  assert.equal(createPayload.profile.balanceCents, STARTING_BALANCE_CENTS);

  const dropResponse = await fetch(`${baseUrl}/api/drop`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      playerId: createPayload.profile.id,
      risk: "medium",
      betCents: MIN_BET_CENTS
    })
  });

  const dropPayload = await dropResponse.json();
  assert.equal(dropResponse.status, 200);
  assert.equal(dropPayload.round.path.length, GAME_ROWS);
  assert.equal(dropPayload.profile.gamesPlayed, 1);
  assert.equal(dropPayload.history.length, 1);
  assert.equal(dropPayload.leaderboard[0].id, createPayload.profile.id);

  const expectedBalance = STARTING_BALANCE_CENTS - MIN_BET_CENTS + dropPayload.round.payoutCents;
  assert.equal(dropPayload.profile.balanceCents, expectedBalance);
});

test("drop rejects a bet outside the configured range", async (t) => {
  const baseUrl = await startServer(t);

  const createResponse = await fetch(`${baseUrl}/api/profile`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ name: "Risky" })
  });

  const createPayload = await createResponse.json();

  const dropResponse = await fetch(`${baseUrl}/api/drop`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      playerId: createPayload.profile.id,
      risk: "high",
      betCents: STARTING_BALANCE_CENTS + 100
    })
  });

  const dropPayload = await dropResponse.json();
  assert.equal(dropResponse.status, 400);
  assert.equal(dropPayload.error, "Bet must be between 100 and 2500 cents");
});

"use strict";

const defaults = {
  gameRows: 8,
  minBetCents: 100,
  maxBetCents: 2500,
  startingBalanceCents: 10000,
  riskTables: {
    low: [1.8, 1.4, 1.2, 0.9, 0.7, 0.9, 1.2, 1.4, 1.8],
    medium: [4.5, 2.4, 1.4, 0.8, 0.3, 0.8, 1.4, 2.4, 4.5],
    high: [9, 4.5, 2.2, 0.7, 0.1, 0.7, 2.2, 4.5, 9]
  }
};

const storageKey = "plinko-blinko-player-id";
const state = {
  config: defaults,
  profile: null,
  leaderboard: [],
  history: [],
  statusCopy: "Create a player to start dropping.",
  roundCopy: "Waiting for the next round.",
  currentRisk: "medium",
  betDollars: 5,
  pendingDrops: 0,
  reservedCents: 0,
  activeBalls: [],
  particles: []
};

const refs = {
  balanceValue: document.getElementById("balance-value"),
  gamesValue: document.getElementById("games-value"),
  bestWinValue: document.getElementById("best-win-value"),
  riskPreview: document.getElementById("risk-preview"),
  canvas: document.getElementById("plinko-board"),
  statusCopy: document.getElementById("status-copy"),
  roundCopy: document.getElementById("round-copy"),
  profileForm: document.getElementById("profile-form"),
  profileButton: document.getElementById("profile-button"),
  playerName: document.getElementById("player-name"),
  playerSummary: document.getElementById("player-summary"),
  controlsForm: document.getElementById("controls-form"),
  riskSelect: document.getElementById("risk-select"),
  betRange: document.getElementById("bet-range"),
  betAmount: document.getElementById("bet-amount"),
  betHint: document.getElementById("bet-hint"),
  balanceHint: document.getElementById("balance-hint"),
  dropButton: document.getElementById("drop-button"),
  historyList: document.getElementById("history-list"),
  leaderboardList: document.getElementById("leaderboard-list")
};

const context = refs.canvas.getContext("2d");
let boardWidth = 0;
let boardHeight = 0;

function currency(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format((cents || 0) / 100);
}

function getAvailableBalanceCents() {
  if (!state.profile) {
    return 0;
  }

  return Math.max(0, state.profile.balanceCents - state.reservedCents);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function api(path, options = {}) {
  const fetchOptions = {
    method: options.method || "GET",
    headers: {},
    body: options.body
  };

  if (options.body) {
    fetchOptions.headers["content-type"] = "application/json";
  }

  return fetch(path, fetchOptions).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }
    return payload;
  });
}

function syncBetInputs(nextValue) {
  const min = Number(refs.betAmount.min);
  const max = Number(refs.betAmount.max);
  const safeValue = Math.max(min, Math.min(max, Number(nextValue) || min));
  state.betDollars = safeValue;
  refs.betRange.value = safeValue;
  refs.betAmount.value = safeValue;
  renderControlHints();
}

function setStatus(copy, roundCopy) {
  state.statusCopy = copy;
  if (roundCopy) {
    state.roundCopy = roundCopy;
  }
  renderText();
}

function getRiskColor(multiplier) {
  if (multiplier >= 3) {
    return "#ffb347";
  }
  if (multiplier >= 1) {
    return "#62d5ff";
  }
  return "#9fb2d9";
}

function getBoardMetrics() {
  const rows = state.config.gameRows;
  const centerX = boardWidth / 2;
  const marginX = Math.max(36, boardWidth * 0.085);
  const topY = 84;
  const rowGap = (boardHeight - 240) / rows;
  const colGap = (boardWidth - marginX * 2) / rows;
  const bucketY = topY + rows * rowGap + 28;
  const bucketHeight = 58;

  return {
    rows,
    centerX,
    marginX,
    topY,
    rowGap,
    colGap,
    bucketY,
    bucketHeight
  };
}

function pegPosition(row, col) {
  const metrics = getBoardMetrics();
  return {
    x: metrics.centerX + (col - row / 2) * metrics.colGap,
    y: metrics.topY + row * metrics.rowGap
  };
}

function slotCenter(slotIndex) {
  const metrics = getBoardMetrics();
  return metrics.centerX + (slotIndex - metrics.rows / 2) * metrics.colGap;
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const nextWidth = refs.canvas.clientWidth;
  const nextHeight = refs.canvas.clientHeight;

  boardWidth = nextWidth;
  boardHeight = nextHeight;
  refs.canvas.width = Math.floor(nextWidth * ratio);
  refs.canvas.height = Math.floor(nextHeight * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawBuckets() {
  const metrics = getBoardMetrics();
  const multipliers = state.config.riskTables[state.currentRisk];
  const bucketWidth = metrics.colGap;
  const landedSlots = new Set(
    state.activeBalls
      .filter((ball) => ball.landed)
      .map((ball) => ball.round.slotIndex)
  );

  for (let index = 0; index < multipliers.length; index += 1) {
    const x = slotCenter(index) - bucketWidth / 2 + 2;
    const y = metrics.bucketY;
    const multiplier = multipliers[index];

    context.fillStyle = multiplier >= 1 ? "rgba(255, 179, 71, 0.16)" : "rgba(98, 213, 255, 0.14)";
    context.strokeStyle = multiplier >= 1 ? "rgba(255, 179, 71, 0.48)" : "rgba(98, 213, 255, 0.22)";
    context.lineWidth = 1.2;
    roundRectPath(x, y, bucketWidth - 4, metrics.bucketHeight, 14);
    context.fill();
    context.stroke();

    if (landedSlots.has(index)) {
      context.fillStyle = "rgba(126, 242, 154, 0.22)";
      roundRectPath(x - 2, y - 4, bucketWidth, metrics.bucketHeight + 8, 16);
      context.fill();
    }

    context.fillStyle = "#f5f7fb";
    context.font = '700 15px "Avenir Next", "Trebuchet MS", sans-serif';
    context.textAlign = "center";
    context.fillText(`${multiplier.toFixed(multiplier % 1 ? 1 : 0)}x`, slotCenter(index), y + 34);
  }
}

function drawPegs(now) {
  const metrics = getBoardMetrics();

  for (let row = 0; row < metrics.rows; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      const peg = pegPosition(row, col);
      const shimmer = 0.75 + Math.sin((now / 320) + row + col) * 0.08;
      context.beginPath();
      context.fillStyle = `rgba(255, 255, 255, ${0.38 * shimmer})`;
      context.shadowBlur = 18;
      context.shadowColor = "rgba(98, 213, 255, 0.32)";
      context.arc(peg.x, peg.y, 6, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
    }
  }
}

function drawBall() {
  for (const ball of state.activeBalls) {
    context.beginPath();
    context.fillStyle = "#ffb347";
    context.shadowBlur = 20;
    context.shadowColor = "rgba(255, 179, 71, 0.65)";
    context.arc(ball.x, ball.y, 10, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
  }
}

function drawParticles() {
  for (const particle of state.particles) {
    context.beginPath();
    context.fillStyle = particle.color;
    context.globalAlpha = particle.life / particle.maxLife;
    context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
  }
}

function drawBoard(now = performance.now()) {
  context.clearRect(0, 0, boardWidth, boardHeight);

  const gradient = context.createLinearGradient(0, 0, 0, boardHeight);
  gradient.addColorStop(0, "rgba(98, 213, 255, 0.09)");
  gradient.addColorStop(1, "rgba(255, 122, 24, 0.04)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, boardWidth, boardHeight);

  drawBuckets();
  drawPegs(now);
  drawParticles();
  drawBall();
}

function updateAnimation(now) {
  const landedBalls = [];

  state.activeBalls = state.activeBalls
    .map((ball) => {
      const elapsed = now - ball.startTime;
      const totalSegments = ball.points.length - 1;
      const totalDuration = totalSegments * ball.segmentMs;
      const finalPoint = ball.points.at(-1);

      if (elapsed >= totalDuration) {
        const nextBall = {
          ...ball,
          x: finalPoint.x,
          y: finalPoint.y,
          landed: true
        };

        if (!ball.landed) {
          landedBalls.push(nextBall);
        }

        if (elapsed >= totalDuration + ball.landingHoldMs) {
          return null;
        }

        return nextBall;
      }

      const progress = Math.min(elapsed / totalDuration, 1);
      const exactSegment = progress * totalSegments;
      const segmentIndex = Math.min(Math.floor(exactSegment), totalSegments - 1);
      const localProgress = exactSegment - segmentIndex;
      const current = ball.points[segmentIndex];
      const next = ball.points[segmentIndex + 1];

      const nextBall = {
        ...ball,
        landed: false,
        x: current.x + (next.x - current.x) * easeInOut(localProgress),
        y: current.y + (next.y - current.y) * easeInOut(localProgress)
      };

      if (progress >= 1) {
        nextBall.x = finalPoint.x;
        nextBall.y = finalPoint.y;
        nextBall.landed = true;
        landedBalls.push(nextBall);
        return null;
      }

      return nextBall;
    })
    .filter(Boolean);

  for (const ball of landedBalls) {
    const { round } = ball;
    state.reservedCents = Math.max(0, state.reservedCents - round.betCents);

    if (state.profile && state.profile.id === round.playerId) {
      state.profile = {
        ...state.profile,
        balanceCents: state.profile.balanceCents + round.netCents,
        totalWageredCents: state.profile.totalWageredCents + round.betCents,
        totalWonCents: state.profile.totalWonCents + round.payoutCents,
        gamesPlayed: state.profile.gamesPlayed + 1,
        biggestWinCents: Math.max(state.profile.biggestWinCents, round.payoutCents),
        lastRoundAt: round.createdAt,
        updatedAt: round.createdAt
      };
    }

    state.history = [round, ...state.history].slice(0, 10);

    if (round.netCents > 0) {
      createBurst(round.slotIndex);
    }
  }

  if (landedBalls.length > 0) {
    const latestRound = landedBalls.at(-1).round;
    setStatus(
      latestRound.netCents >= 0 ? "Nice hit. The backend settled a winning round." : "Round settled. The board is ready for another drop.",
      `${latestRound.playerName} landed slot ${latestRound.slotIndex + 1} at ${latestRound.multiplier}x`
    );
    loadLeaderboard()
      .then(() => render())
      .catch(() => render());
    render();
  }

  state.particles = state.particles
    .map((particle) => ({
      ...particle,
      x: particle.x + particle.vx,
      y: particle.y + particle.vy,
      vy: particle.vy + 0.04,
      life: particle.life - 1
    }))
    .filter((particle) => particle.life > 0);
}

function createBurst(slotIndex) {
  const metrics = getBoardMetrics();
  const originX = slotCenter(slotIndex);
  const originY = metrics.bucketY + metrics.bucketHeight / 2;

  for (let index = 0; index < 28; index += 1) {
    const angle = (Math.PI * 2 * index) / 28;
    state.particles.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * (1 + Math.random() * 2.4),
      vy: Math.sin(angle) * (1 + Math.random() * 2.1) - 1.4,
      life: 30 + Math.random() * 20,
      maxLife: 50,
      size: 2.4 + Math.random() * 3,
      color: index % 2 === 0 ? "#ffb347" : "#62d5ff"
    });
  }
}

function buildPath(round) {
  const metrics = getBoardMetrics();
  const points = [
    {
      x: metrics.centerX,
      y: metrics.topY - 42
    }
  ];

  let rights = 0;
  round.path.forEach((step, rowIndex) => {
    if (step === "R") {
      rights += 1;
    }

    points.push({
      x: metrics.centerX + (rights - (rowIndex + 1) / 2) * metrics.colGap,
      y: metrics.topY + rowIndex * metrics.rowGap
    });
  });

  points.push({
    x: slotCenter(round.slotIndex),
    y: metrics.bucketY + metrics.bucketHeight * 0.68
  });

  return points;
}

function easeInOut(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function roundRectPath(x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function renderText() {
  refs.statusCopy.textContent = state.statusCopy;
  refs.roundCopy.textContent = state.roundCopy;
}

function renderHeader() {
  refs.balanceValue.textContent = currency(state.profile ? state.profile.balanceCents : 0);
  refs.gamesValue.textContent = state.profile ? String(state.profile.gamesPlayed) : "0";
  refs.bestWinValue.textContent = currency(state.profile ? state.profile.biggestWinCents : 0);
}

function renderRiskPreview() {
  const risk = state.currentRisk;
  const multipliers = state.config.riskTables[risk] || [];

  refs.riskPreview.innerHTML = multipliers
    .map((multiplier) => {
      const style = `style="border-color:${getRiskColor(multiplier)}55;color:${getRiskColor(multiplier)}"`;
      return `<span class="pill" ${style}><strong>${multiplier}x</strong></span>`;
    })
    .join("");
}

function renderProfile() {
  if (!state.profile) {
    refs.profileButton.textContent = "Enter Arcade";
    refs.playerSummary.classList.add("hidden");
    refs.playerSummary.innerHTML = "";
    return;
  }

  refs.profileButton.textContent = "Update Player";
  refs.playerName.value = state.profile.name;
  refs.playerSummary.classList.remove("hidden");
  refs.playerSummary.innerHTML = `
    <div class="list-row">
      <strong>${escapeHtml(state.profile.name)}</strong>
      <span class="list-meta">${currency(state.profile.balanceCents)}</span>
    </div>
    <div class="list-row">
      <span class="list-meta">Total wagered</span>
      <span>${currency(state.profile.totalWageredCents)}</span>
    </div>
    <div class="list-row">
      <span class="list-meta">Total paid back</span>
      <span>${currency(state.profile.totalWonCents)}</span>
    </div>
  `;
}

function renderHistory() {
  if (!state.history.length) {
    refs.historyList.innerHTML = '<p class="empty-copy">No drops yet.</p>';
    return;
  }

  refs.historyList.innerHTML = state.history
    .map((round) => {
      const netClass = round.netCents >= 0 ? "positive" : "negative";
      const netLabel = `${round.netCents >= 0 ? "+" : ""}${currency(round.netCents)}`;
      return `
        <article class="list-item">
          <div class="list-row">
            <strong>${round.risk.toUpperCase()} risk</strong>
            <span class="${netClass}">${netLabel}</span>
          </div>
          <div class="list-row list-meta">
            <span>Bet ${currency(round.betCents)} • ${round.multiplier}x</span>
            <span>Slot ${round.slotIndex + 1}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderLeaderboard() {
  if (!state.leaderboard.length) {
    refs.leaderboardList.innerHTML = '<p class="empty-copy">No players on the board yet.</p>';
    return;
  }

  refs.leaderboardList.innerHTML = state.leaderboard
    .map((player, index) => `
      <article class="list-item">
        <div class="list-row">
          <strong>#${index + 1} ${escapeHtml(player.name)}</strong>
          <span>${currency(player.balanceCents)}</span>
        </div>
        <div class="list-row list-meta">
          <span>${player.gamesPlayed} games</span>
          <span>Best ${currency(player.biggestWinCents)}</span>
        </div>
      </article>
    `)
    .join("");
}

function renderControlHints() {
  const availableBalanceCents = getAvailableBalanceCents();
  const rawMaxBetDollars = state.profile
    ? Math.max(0, Math.min(state.config.maxBetCents / 100, Math.floor(availableBalanceCents / 100)))
    : state.config.maxBetCents / 100;
  const inputMaxBetDollars = Math.max(1, rawMaxBetDollars);

  refs.betAmount.max = String(inputMaxBetDollars);
  refs.betRange.max = String(inputMaxBetDollars);

  if (rawMaxBetDollars > 0 && state.betDollars > rawMaxBetDollars) {
    state.betDollars = rawMaxBetDollars;
    refs.betRange.value = rawMaxBetDollars;
    refs.betAmount.value = rawMaxBetDollars;
  }

  refs.betHint.textContent = `Bet range: ${currency(state.config.minBetCents)} to ${currency(state.config.maxBetCents)}`;
  refs.balanceHint.textContent = `Available now: ${currency(availableBalanceCents)} • Bet: ${currency(state.betDollars * 100)}`;
  refs.dropButton.disabled = !state.profile || availableBalanceCents < state.config.minBetCents;
}

function render() {
  renderText();
  renderHeader();
  renderRiskPreview();
  renderProfile();
  renderHistory();
  renderLeaderboard();
  renderControlHints();
}

async function loadConfig() {
  const data = await api("/api/config");
  state.config = data;
}

async function loadLeaderboard() {
  const data = await api("/api/leaderboard");
  state.leaderboard = data.leaderboard;
}

async function loadHistory(playerId) {
  const data = await api(`/api/history/${playerId}`);
  state.history = data.history;
}

async function restorePlayer() {
  const playerId = window.localStorage.getItem(storageKey);
  if (!playerId) {
    return;
  }

  try {
    const data = await api(`/api/profile/${playerId}`);
    state.profile = data.profile;
    refs.playerName.value = state.profile.name;
    await loadHistory(playerId);
  } catch (error) {
    window.localStorage.removeItem(storageKey);
    state.profile = null;
    state.history = [];
  }
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  refs.profileButton.disabled = true;

  try {
    const payload = {
      name: refs.playerName.value,
      playerId: state.profile ? state.profile.id : window.localStorage.getItem(storageKey)
    };
    const data = await api("/api/profile", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    state.profile = data.profile;
    state.leaderboard = data.leaderboard;
    window.localStorage.setItem(storageKey, state.profile.id);
    await loadHistory(state.profile.id);
    setStatus(`Player ready: ${state.profile.name}.`, "Choose a risk and drop your first ball.");
  } catch (error) {
    setStatus(error.message, state.roundCopy);
  } finally {
    refs.profileButton.disabled = false;
    render();
  }
}

async function handleDrop(event) {
  event.preventDefault();

  if (!state.profile) {
    return;
  }

  const betCents = state.betDollars * 100;
  if (getAvailableBalanceCents() < betCents) {
    setStatus("Not enough available balance for another queued drop.", "Wait for a landing or lower the bet.");
    render();
    return;
  }

  state.pendingDrops += 1;
  state.reservedCents += betCents;
  renderControlHints();
  setStatus("Ball released. Queue another drop if you want.", `Waiting on ${state.pendingDrops} server ${state.pendingDrops === 1 ? "response" : "responses"}.`);

  try {
    const data = await api("/api/drop", {
      method: "POST",
      body: JSON.stringify({
        playerId: state.profile.id,
        risk: state.currentRisk,
        betCents
      })
    });

    state.activeBalls.push({
      round: data.round,
      points: buildPath(data.round),
      startTime: performance.now(),
      segmentMs: 160,
      landingHoldMs: 220,
      landed: false,
      x: getBoardMetrics().centerX,
      y: getBoardMetrics().topY - 42
    });
    setStatus("Ball in flight. Queue another drop if you want.", `${state.activeBalls.length} ${state.activeBalls.length === 1 ? "ball is" : "balls are"} on the board.`);
  } catch (error) {
    state.reservedCents = Math.max(0, state.reservedCents - betCents);
    setStatus(error.message, "Adjust the bet and try again.");
  } finally {
    state.pendingDrops = Math.max(0, state.pendingDrops - 1);
    renderControlHints();
  }

  render();
}

function bindEvents() {
  refs.profileForm.addEventListener("submit", handleProfileSubmit);
  refs.controlsForm.addEventListener("submit", handleDrop);

  refs.riskSelect.addEventListener("change", (event) => {
    state.currentRisk = event.target.value;
    renderRiskPreview();
  });

  refs.betRange.addEventListener("input", (event) => {
    syncBetInputs(event.target.value);
  });

  refs.betAmount.addEventListener("input", (event) => {
    syncBetInputs(event.target.value);
  });

  window.addEventListener("resize", () => {
    resizeCanvas();
    drawBoard();
  });
}

function tick(now) {
  updateAnimation(now);
  drawBoard(now);
  requestAnimationFrame(tick);
}

async function init() {
  bindEvents();
  resizeCanvas();
  render();

  try {
    await loadConfig();
    await Promise.all([loadLeaderboard(), restorePlayer()]);
    render();
    setStatus(
      state.profile ? `Welcome back, ${state.profile.name}.` : "Create a player to start dropping.",
      state.profile ? "The board is live and synced to your balance." : "Waiting for the next round."
    );
  } catch (error) {
    setStatus("Could not load the game server.", "Check that the backend is running and refresh.");
  }

  requestAnimationFrame(tick);
}

init();

# Plinko Blinko

A full-stack Plinko game built with a lightweight Node.js backend and a canvas-based browser client. The server owns the game rules and payouts, while the frontend handles the animated board, player controls, recent drops log, and leaderboard.

## Features

- Server-authoritative Plinko drops and payout calculation
- Animated board rendered with HTML canvas
- Player profiles with saved session ID in `localStorage`
- Recent drops log and live leaderboard
- Rapid-fire drops by pressing `Enter` repeatedly
- Risk profiles with center-lower and side-higher reward curves

## Requirements

- Node.js 20 or newer
- npm

The app has no third-party dependencies.

## Install

Clone the repository, then install the local package metadata:

```bash
npm install
```

`npm install` does not download extra packages for this project, but it prepares the workspace and creates a lockfile if you want one.

## Run

Start the app with:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

You can also set a custom port:

```bash
PORT=4000 npm start
```

## Test

Run the automated test suite with:

```bash
npm test
```

The tests verify the core API routes, the payout curve, and basic game flow.

## How To Play

1. Enter a player name and create a profile.
2. Choose a risk level: `low`, `medium`, or `high`.
3. Set a bet amount.
4. Press `Enter` or click `Drop Ball` to queue a drop.
5. Watch the ball travel through the board and land in a reward slot.

The recent drops log only updates after the ball lands, so the UI stays synchronized with the animation.

## Game Rules

- The center reward box pays the least.
- The outer reward boxes pay the most.
- The server validates every bet before creating a round.
- Drops are queued, so you can spam `Enter` to send multiple balls in succession.
- A queued bet reserves balance until that ball lands.

## Backend

`server.js` provides:

- `GET /api/health` for a basic health check
- `GET /api/config` for game configuration and multiplier tables
- `GET /api/leaderboard` for the top players list
- `GET /api/profile/:playerId` to restore an existing player
- `GET /api/history/:playerId` to fetch recent rounds
- `POST /api/profile` to create or update a player
- `POST /api/drop` to resolve a round

The backend also serves the static frontend from `public/`.

## Frontend

`public/app.js` handles:

- Fetching config and profile data
- Drawing the plinko board
- Animating balls and landing effects
- Updating balance, history, and leaderboard views
- Supporting rapid-fire queued drops

`public/styles.css` contains the visual styling for the arcade-style layout.

## Project Structure

- `server.js` - HTTP server and game API
- `public/index.html` - App shell
- `public/app.js` - Client logic and animation
- `public/styles.css` - UI styling
- `test/server.test.js` - API and rules tests

## Notes

- Player data is stored in memory only. Restarting the server resets profiles, balances, and history.
- The game is designed for local demo use and experimentation, not real-money play.


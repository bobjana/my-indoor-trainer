# Indoor Trainer

A browser-based indoor cycling trainer app that connects to FTMS-enabled smart trainers via Bluetooth and guides you through structured interval workouts. Includes Strava integration for automatic activity upload.

## Quick Start

```bash
npm install
npm run dev
```

Open the URL shown in terminal (usually `http://localhost:5173`) in a **Bluetooth-capable browser** (Chrome or Edge on desktop).

## Running Without a Trainer

A stub trainer simulator is available for development and testing:

1. Start the stub WebSocket server:
   ```bash
   node stub-server/server.js
   ```
2. Start the app:
   ```bash
   npm run dev
   ```
3. On the connect screen, click **"Use Stub Trainer"** instead of "Connect Trainer"

The stub server simulates a real trainer — it sends power, cadence, HR metrics and responds to target power changes. You can interact with it via the terminal (type `help` after starting).

## Using the App

1. **Connect** — Pair your smart trainer via Bluetooth (or use stub)
2. **Select a workout** — Browse available interval workouts
3. **Ride** — Follow the interval targets displayed on screen. The app sends target power to your trainer and tracks your metrics in real time
4. **Finish** — When the workout completes, a summary screen shows your stats. If connected to Strava, the activity uploads automatically

## Screens

| Screen | Description |
|--------|-------------|
| Connect | Pair trainer via BTLE or use stub simulator |
| Selection | Browse and select a workout |
| Workout | Active workout with power targets, timer, interval diagram, and rollerdeck |
| Summary | Post-workout stats with Strava upload and screenshot options |

## Workout Files

Workouts are JSON files in the `workouts/` directory (served via the `vite-plugin-local-sessions` plugin). Sample workouts are in `samples/`:

- `sweet-spot-intervals.json` — Sweet spot training
- `ramp-workout.json` — Ramp test
- `ramp-test-ftp.json` — FTP ramp test

Workout format:
```json
{
  "name": "Workout Name",
  "ftp": 200,
  "intervals": [
    { "name": "Warm Up", "duration": 300, "percentage": 50, "type": "warmup" },
    { "name": "Sweet Spot", "duration": 600, "percentage": 88, "type": "work" },
    { "name": "Cool Down", "duration": 300, "percentage": 40, "type": "cooldown" }
  ]
}
```

## Strava Integration

1. Copy `.env.example` to `.env` and fill in your Strava API credentials:
   ```
   VITE_STRAVA_CLIENT_ID=your_client_id
   VITE_STRAVA_CLIENT_SECRET=your_client_secret
   ```
2. Click **"Upload to Strava"** on the summary screen to authenticate (first time only)
3. On subsequent naturally-completed workouts, the activity uploads automatically

## Project Structure

```
├── index.html          # All screens (connect, selection, workout, summary)
├── main.js             # UI orchestration, event handlers, screen management
├── api.js              # Core API — workout lifecycle, FTMS control, Strava proxy
├── ftms.js             # Bluetooth FTMS trainer communication
├── stub-ftms.js        # Stub FTMS controller (WebSocket-based)
├── hr-zones.js         # Heart rate zone calculations
├── strava.js           # Strava OAuth, TCX generation, activity upload
├── strava-callback.html # OAuth popup callback
├── workout-manager.js  # Workout loading, parsing, session history
├── style.css           # All styles
├── vite.config.js      # Vite config with local sessions plugin
├── stub-server/        # Standalone stub trainer WebSocket server
├── samples/            # Sample workout JSON files
└── sessions/           # Completed workout sessions (gitignored)
```

## Build

```bash
npm run build      # Production build to dist/
npm run preview    # Preview production build locally
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_STRAVA_CLIENT_ID` | No | Strava OAuth client ID |
| `VITE_STRAVA_CLIENT_SECRET` | No | Strava OAuth client secret |

---

## For Agentic Agents

### Setup

```bash
npm install
npm run dev          # Starts Vite dev server on :5173
node stub-server/server.js  # Starts stub trainer on :8080
```

No build step is required during development — Vite serves files directly.

### Key Files to Understand

| File | Role |
|------|------|
| `api.js` | Central API — all state, events, workout lifecycle. Entry point for most changes. |
| `main.js` | UI layer — screen transitions, DOM updates, event wiring. |
| `ftms.js` | Bluetooth FTMS protocol — only touch if changing trainer communication. |
| `stub-ftms.js` | WebSocket-based stub for testing without hardware. |
| `workout-manager.js` | Workout JSON parsing, session persistence, summary calculation. |
| `strava.js` | Strava OAuth flow and TCX upload. |

### Event System (`api.js`)

The API uses a simple custom event emitter. Key events:

| Event | When | Payload |
|-------|------|---------|
| `workoutstart` | Workout begins | workout object |
| `intervalchange` | Current interval changes | `{ index, interval, targetPower }` |
| `workoutcomplete` | Timer reaches end of last interval | none |
| `workoutstop` | Workout stops (natural or manual) | summary object |
| `workoutdiscard` | User discards workout | none |
| `autopause` / `autoresume` | Zero power detected / power returns | none |
| `phasechange` | API phase transitions | phase name |
| `metricsupdate` | New power/cadence/HR data | metrics object |
| `stravaStatus` | Strava connection state changes | connected boolean |

### Conventions

- **No framework** — vanilla JS, no React/Vue. DOM manipulation is direct.
- **Single-page app** — screens toggled via `.active` CSS class on `#*-screen` divs.
- **`$()` helper** — `document.querySelector` shorthand used throughout `main.js`.
- **State lives in `api.state`** — do not create parallel state in UI code.
- **Workout data** is served from the `sessions/` directory via a custom Vite plugin.
- **Shell commands** — always use non-interactive flags (`rm -f`, `cp -f`, `npm -y`) to avoid hangs.
- **Task tracking** — use `bd` for all task tracking (see `AGENTS.md`). Do not use markdown TODO lists.

### Common Tasks

```bash
# Start dev environment
npm install && npm run dev

# Run with stub trainer (no hardware needed)
node stub-server/server.js & npm run dev

# Build for production
npm run build

# Check task tracker
bd ready
bd show <id>
```

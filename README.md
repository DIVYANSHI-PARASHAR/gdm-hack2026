# IRON PULSE // First-Person Motion Boxing

A laptop-first 3D browser boxing game built with **Vite**, **TypeScript**, **Three.js**, **MediaPipe Tasks Vision** (Pose Landmarker), **Web Bluetooth**, and a local **Node/Express** server.

Step into a procedural neon industrial arena against **Kai the Brawler**, an opponent with readable windups and adaptive between-exchange tactics powered by the **Gemini Decisions API (`gemini-decision-1`)** with a zero-credential deterministic local AI fallback.

Every match is **100% playable out of the box with zero credentials and no wearable**.

---

## Quick Start (One Command)

```bash
npm install
npm start
```

Then open **`http://localhost:5173`** in a desktop browser (Chrome or Edge recommended on macOS/Windows/Linux for Web Bluetooth support).

`npm start` (aliased to `npm run dev`) launches the Node API server and Vite frontend together on a single origin (`http://localhost:5173`), automatically staging the local MediaPipe WASM runtime files if needed.

### Fighter Models

Kai uses the [Ready Player Me example avatar](https://threejs.org/examples/webgpu_animation_retargeting_readyplayer.html). The challenger uses [Michelle](https://threejs.org/examples/webgpu_skinning.html), shown as her hands and arms in first person. Both models load from the official Three.js example host. If either request fails, the corresponding procedural fighter stays visible and the match remains playable. The demo GLBs are hosted upstream. Verify model-specific reuse and redistribution terms before publishing or bundling copies.

### Build & Automated Tests

```bash
npm run build   # Strict TypeScript check + Vite production bundle (including Web Worker)
npm test        # Vitest suite: combat state machine, gesture transitions, BLE parser, Gemini & Health fallbacks
```

---

## Controls & Gameplay

### Keyboard Controls (Always Available Fallback & Testing)
| Key | Action |
| --- | --- |
| `A` or `←` (Hold) | Lean Left to slip right/center strikes |
| `D` or `→` (Hold) | Lean Right to slip left/center strikes |
| `J` / `Z` / `Q` | Throw Left Punch |
| `K` / `X` / `E` | Throw Right Punch |
| `Space` | Start Match / Resume from Pause / Rematch |
| `C` | Recalibrate neutral webcam pose |
| `M` | Toggle synthesized Web Audio sound |
| `` ` `` (Backquote) or `F3` | Toggle real-time Debug Telemetry Panel |

### Reading KRONOS-V
- **Windup (Amber / Crimson Core + Expanding Ring):** Committed windup with directional callout (`LEFT SWEEP -> LEAN RIGHT`, `RIGHT SWEEP -> LEAN LEFT`, `HEAVY STRAIGHT -> LEAN EITHER WAY`).
- **Counter Guard (`BAIT & COUNTER` Strategy, Violet Core):** Hold your punches! Punching into active counter guard triggers a fast retaliation strike; waiting it out overloads the guard into an opening.
- **Core Exposed / Recovery (Emerald Core):** Committed recovery window after strikes. KRONOS-V cannot dodge—land counter-hits for bonus damage!

---

## Webcam Motion Controls & Calibration

1. Click **Fight with Webcam Motion** (or **Enable Webcam** in the bottom-right HUD card).
2. **Neutral-Pose Calibration (~0.8s):** Stand or sit centered in front of your laptop webcam with both shoulders visible and hands raised in a comfortable guard. Press `C` or click **Calibrate (C)** anytime you shift seating position.
3. **Gestures:**
   - **Left / Right Punch:** Throw straight punches toward the camera or swing a hook across your body with your elbow raised. Motion is measured relative to your shoulder. Return to guard between punches with the same hand.
   - **Lean Left / Lean Right:** Shift your upper body left or right past the neutral centerline shown on the mirrored preview.
4. **Performance & Privacy:**
   - Pose inference runs inside a dedicated **Web Worker** (`src/vision/pose.worker.ts`) using transferable `ImageBitmap` frames with a strict single-frame in-flight gate (zero stale frame backlog) so 3D rendering stays decoupled from pose inference.
   - Combat pauses automatically if pose tracking is lost and lets you resume once your shoulders are reacquired (or switch to keyboard anytime).
   - Pose detection stays on-device. Disabling the camera or closing the tab stops capture.

### How to Measure Real Motion-to-Screen Latency (< 100 ms Target)
The Debug Panel (`` ` ``) shows software **Detect -> Render** timing (`capturePerfMs` to completed `requestAnimationFrame` WebGL draw). To measure true physical **motion-to-photon** latency:
1. Open the game on your laptop with **Debug (`)** enabled so the gesture readout and Three.js player gloves are visible on screen.
2. Position a smartphone behind/beside your shoulder recording in **240 fps Slow Motion** (`4.17 ms` per frame) so **both your physical fist/shoulders and the laptop screen** are clearly visible in the same shot.
3. From a still guard, snap a sharp punch or lateral lean.
4. Scrub the slow-motion video frame-by-frame:
   - Note frame $F_{\text{onset}}$ where your wrist/shoulder begins unmistakable forward/lateral motion.
   - Note frame $F_{\text{screen}}$ where the first-person 3D cyber-glove / camera lean or HUD gesture badge first updates on the laptop display.
   - Compute $\text{Latency (ms)} = (F_{\text{screen}} - F_{\text{onset}}) \times \frac{1000}{240}$.

---

## Fitbit Air Live BPM (Web Bluetooth)

Match results show **Calories Burnt**, calculated with the male [Keytel exercise equation](https://pubmed.ncbi.nlm.nih.gov/15966347/) for age 25 and 189 lb. The reference profile is 5′9″. The equation uses heart rate, age, sex, and weight. It counts active fight time with a heart-rate reading and shows coverage when readings are missing.

Live heart rate uses the standard Bluetooth Low Energy **Heart Rate Service (`0x180D`)** and **Heart Rate Measurement Characteristic (`0x2A37`)**, parsing both 8-bit (`UINT8`) and 16-bit (`UINT16`) BPM formats via the BLE flags byte.

### Pairing Steps
1. Open **Google Health** on your phone.
2. Go to **Connections** and select your **Fitbit Air**.
3. Choose **Share heart rate** and tap **Get started** *(your phone enables BLE heart-rate broadcast; your laptop runs the game)*.
4. Open `http://localhost:5173` in desktop **Google Chrome** or **Microsoft Edge**, click **Connect Fitbit Air** on the start screen, and select your Fitbit Air in the browser chooser.

- The live pulse animation follows the latest Fitbit BPM. The match report plots recorded BPM readings beneath the average and peak.
- Handles unsupported browsers, pairing cancelation, stale data (> 6.5s without packets), and mid-match disconnects without interrupting gameplay.

---

## Optional External API Setup (`.env`)

Copy `.env.example` to `.env` if you want to enable live Gemini strategy routing or the optional Google Health API endpoints:

```bash
cp .env.example .env
```

### 1. Gemini Decisions API (`GEMINI_API_KEY`)
- Set `GEMINI_API_KEY` in `.env` from Google AI Studio.
- Between exchanges, the server sends compact gameplay summaries (punches, leans, hits, dodges, round, and in-game HP) to `POST https://generativelanguage.googleapis.com/v1beta/decisions` with model **`gemini-decision-1`**, selecting among `pressure`, `delayed_strike`, `bait_and_counter`, and `defensive_reset`.
- Decisions are validated and queued asynchronously to take effect at the next valid boss state transition; stale or failed requests fall back deterministically to the local AI. Check **AI Source** in the Debug Panel (`` ` ``) to verify `Gemini (gemini-decision-1)` vs `Local Deterministic AI`.

### 2. Google Health API Post-Match Synced Calories (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`)
- Create an OAuth 2.0 Web Client in Google Cloud Console with access to the Google Health API (`health.googleapis.com/v4`).
- Add Authorized Redirect URI: `http://localhost:5173/api/health/oauth/callback`.
- Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `.env`.
- Uses the minimum read-only scope: `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`.
- The server retains OAuth and total-calories endpoints for API clients. The game’s match report uses Fitbit heart rate.
- OAuth tokens stay strictly server-side (`HttpOnly` session) and health data is never logged or sent to Gemini.

After a fight, open **Match Recap** for observed punch accuracy by hand, lean direction, and hits taken per resolved attack from each direction. Opening the recap sends aggregate counts to Gemini 4 Hydrogen for a short interpretation. Exact counts and percentages remain available offline.

## Post-match voice shopping

1. Finish a match and raise your right hand overhead with your face and wrist visible, or press **G**. The game reveals Kai’s jacket, checks live Shop MCP listings, and asks for microphone access to start Gemini voice.
2. Ask for a jacket or a size. When the exact Gucci style isn’t available on Shop, the panel and Gemini identify the results as alternatives. If the jacket is unavailable in the size you ask for, Gemini shows similar jackets in that size. The voice panel shows mic activity and what Gemini heard. Select a different microphone if the meter stays flat. Voice replies are detected automatically. Expand **More options** for the transcript, typed replies, and search. You can also search and select options without a microphone.
3. Say “open checkout” or select **Checkout**. The delivery form defaults to The Malin Chelsea, 270 7th Ave, New York, NY 10001, US. Confirm or edit it and add your name and email. Those details stay on the current page until sent to the selected merchant. The game opens the merchant’s payment page in a separate window or continues in the same tab if the browser blocks the window. The merchant handles payment and places the order.

Set `GEMINI_API_KEY` in `.env` with access to Gemini Live, served on localhost or HTTPS for microphone permission. Set `GEMINI_LIVE_MODEL` only if your key requires a different Live model. Shop MCP needs no Shopify account or API key. Catalog search and checkout are configured for US delivery and USD.

Run `npm test` for gesture, catalog matching, variant validation, and checkout URL preservation.

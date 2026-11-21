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
   - **All video frames and landmarks remain strictly on-device** and are stopped immediately when disabling the camera or closing the tab.

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

## Fitbit Air Live BPM (Web Bluetooth) & Demo Mode

Match results show an estimated calorie burn using the male [Keytel exercise equation](https://pubmed.ncbi.nlm.nih.gov/15966347/) for age 25 and 189 lb. The reference profile is 5′9″. The equation uses heart rate, age, sex, and weight. It counts active fight time with a live or simulated reading, shows coverage, and labels estimates that include simulated data.

Live heart rate uses the standard Bluetooth Low Energy **Heart Rate Service (`0x180D`)** and **Heart Rate Measurement Characteristic (`0x2A37`)**, parsing both 8-bit (`UINT8`) and 16-bit (`UINT16`) BPM formats via the BLE flags byte.

### Pairing Steps
1. Open **Google Health** on your phone.
2. Go to **Connections** and select your **Fitbit Air**.
3. Choose **Share heart rate** and tap **Get started** *(your phone enables BLE heart-rate broadcast; your laptop runs the game)*.
4. Open `http://localhost:5173` in desktop **Google Chrome** or **Microsoft Edge**, click **Connect Fitbit Air** in the bottom-left HUD card, and select your Fitbit Air in the browser chooser.

- Shows live BPM during combat and **Average / Peak BPM** on the post-match Result Screen.
- Handles unsupported browsers, pairing cancelation, stale data (> 6.5s without packets), and mid-match disconnects without interrupting gameplay.
- **Testing without hardware:** Click **Simulate HR (Demo data)** to activate a dynamic exertion-linked heart-rate stream explicitly labeled **`Demo data`** everywhere it appears.

---

## Optional External API Setup (`.env`)

Copy `.env.example` to `.env` if you want to enable live Gemini strategy routing or post-match Google Health calorie sync:

```bash
cp .env.example .env
```

### 1. Gemini Decisions API (`GEMINI_API_KEY`)
- Set `GEMINI_API_KEY` in `.env` from Google AI Studio.
- Between exchanges, the server sends compact gameplay-only summaries (recent left/right punch counts, lean counts, hit/dodge counts, round, health percentages—**never** webcam or health data) to `POST https://generativelanguage.googleapis.com/v1beta/decisions` with model **`gemini-decision-1`**, selecting among `pressure`, `delayed_strike`, `bait_and_counter`, and `defensive_reset`.
- Decisions are validated and queued asynchronously to take effect at the next valid boss state transition; stale or failed requests fall back deterministically to the local AI. Check **AI Source** in the Debug Panel (`` ` ``) to verify `Gemini (gemini-decision-1)` vs `Local Deterministic AI`.

### 2. Google Health API Post-Match Synced Calories (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`)
- Create an OAuth 2.0 Web Client in Google Cloud Console with access to the Google Health API (`health.googleapis.com/v4`).
- Add Authorized Redirect URI: `http://localhost:5173/api/health/oauth/callback`.
- Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `.env`.
- Uses the minimum read-only scope: `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`.
- After a match ends, click **Connect Google Health** (or **Retry Sync**) on the Result Screen. The server queries `dataTypes/total-calories/dataPoints:rollUp` at 1-minute (`60s`) storage resolution for the exact match `[startTime, endTime)` window:
  - Displays **Synced total calories** (which includes basal resting burn + active expenditure per Google Health `total-calories` semantics).
  - Shows **Awaiting sync** with a **Retry Sync** button if your Fitbit Air has not yet finished syncing the full match window to Google Health, or **Unavailable** if intervals cannot be isolated reliably.
  - OAuth tokens stay strictly server-side (`HttpOnly` session) and health data is never logged or sent to Gemini.

---

## Post-Match "Shop the Look" & Agentic Commerce (Shopify + Gemini 4 Neon)

Extend the post-match experience into an end-to-end commerce flow: **Fight the robot → Hug it after the match → See the jacket it’s wearing → Ask for it in your size → Open a real Shopify checkout**.

### 1. The Post-Match Hug & Visual Product Link
- **Visual Asset Link**: Kai the Brawler wears the real **Shopify Puffer Jacket** (`gid://shopify/Product/7983594340374`, vendor **Mock.shop**). The Three.js model in `src/scene/KaiBrawlerModel.ts` is visually rendered with tactical Olive quilted down baffles, horizontal baffle stitching seams, segmented chest plates, and collar zipper pull matching the turnaround asset (`public/assets/opponent.jpg`).
- **Effortless Self-Hug Detection (`src/vision/gestureRecognizer.ts`)**:
  - Preserves your calibrated webcam session at match end (no forced recalibration) and detects any natural self-hug across the shoulders, chest, or ribs in **340 ms** (~10 frames), even when wrists partially tuck/occlude around your upper arms.
  - **Guard Immunity**: Verified in `tests/hugGesture.test.ts` that holding a boxing guard or throwing punches **never** triggers the hug.
  - **Keyboard & Click Fallback**: Press **`H`** or click **"Hug Kai & View Outfit 🫂"** on the left-docked prompt card anytime on the result screen.
- **First-Person 3D Approach & Mutual Hug (`src/scene/ArenaScene.ts`)**:
  - As soon as you start crossing your arms, the **first-person camera glides forward across the ring toward Kai** while Kai lowers his guard and opens his arms wide to meet you.
  - When the hug triggers, you step right up chest-to-chest: **both your first-person arms and Kai's arms wrap around each other** in a warm embrace with golden rim lighting, celebration sparks, gentle embrace sway, and a warm G-major 7 chime (`playHugChime()`), settling afterward into a friendly close-up stance so you can admire his outfit.

### 2. Left-Docked Outfit Dialog & Instant 1-Click Shopify Purchase
- **Separated from Game State**:
  - Match stats, Heart Rate, and Synced Calories stay cleanly in the **right** result panel (`#screen-result`), while **Kai's Arena Outfit** opens in its own dedicated **left** dialog (`#outfit-dock`) so the 3D arena center stays clear.
- **Direct "Buy Now?" Prompt & Connected Shopify Purchase (`POST /api/shop/purchase`)**:
  - On the hug, the left dialog immediately shows the live Shopify jacket details (image, merchant, `$90.00 CAD`, size & color pills) and asks: **"Would you like to buy Kai's outfit?"** (**Yes, Buy It Now** / **No, Thanks**).
  - Clicking **Yes, Buy It Now** executes a 1-click purchase using the connected Shopify buyer profile (`Account ⚙` in the dialog or `SHOPIFY_BUYER_*` / `SHOPIFY_STORE_DOMAIN` / `SHOPIFY_ADMIN_TOKEN` in `.env`), displaying an instant **Shopify Order Confirmed** receipt card (`#SP-...`) with a link to view on Shopify.
- **Gemini 4 Neon Shopping Agent (`server/geminiShopping.ts`)**:
  - Expand **"Ask Gemini 4 Neon about sizes or colors"** inside the left dialog to ask natural-language inventory questions (e.g., *"Do you have this in black, medium?"*, *"I'll take Kai's Olive in Medium"*, or *"yes buy it"*).
- **Strict Privacy Separation**:
  - Webcam video frames, pose landmarks, and Fitbit/health data are strictly forbidden from entering commerce endpoints (`sanitizeShoppingInput`).

### 3. Verification & Demo Walkthrough
Run the automated test suite verifying all state machine, gesture, and commerce requirements:
```bash
npm test
```
The test suite verifies:
1. `tests/hugGesture.test.ts`: Holding a boxing guard never triggers a hug; throwing punches never triggers a hug; holding a self-hug triggers hug after 650 ms; releasing early resets hold progress.
2. `tests/shopifyCommerce.test.ts`: Live/fallback product metadata lookup; exact variant matching for Olive Medium; honest handling of unavailable color (Black) and size (XL) with alternative suggestions; ambiguous color clarification; cart creation with hosted checkout URL; rejection of biometric or video payloads.
3. `tests/combatEngine.test.ts` & `tests/gestureRecognizer.test.ts`: Full combat loops, leans, punches, and state machine integrity.


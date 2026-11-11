# Phoenix — Project Status

**Audit date:** 2026-11-11
**Scope:** full repository (`C:\Users\VIN\projects\Phoenix`)
**Method:** source reading, GLB binary parsing, SQLite inspection, Flask import check, live page load.

Everything below marked **Verified** was executed or measured. Anything marked **Unverified** was read but not exercised (usually because a service such as Ollama is not running on this machine).

---

## 1. Existing architecture

```
main.py                      launcher: pre-flight checks, then subprocess src/web_ui.py
└─ src/web_ui.py             Flask server, serves frontend/ and the JSON API
   ├─ src/inference.py       Ollama /api/chat + persona post-processing + fallbacks
   ├─ src/emotion.py         regex emotion detection → temperature + tone hint
   ├─ src/memory.py          SQLite: conversations / facts / sessions
   ├─ src/filters.py         response quality gate + score
   ├─ voice/listen.py        faster-whisper transcription (server-side)
   ├─ voice/speak.py         builds a TTS parameter payload for the browser
   └─ plugins/*.py           /calc, /joke, /remind, /godmode, /nolimits
frontend/
   ├─ index.html             2,354 lines: markup + CSS + one inline ES module
   ├─ voice-helper.js        SpeechRecognition factory
   ├─ script.js, voice.js, animation.js   ~880 lines, NOT loaded by index.html
   └─ assets/3dModel/cyber_samurai.glb    22.9 MB, static mesh
```

### API surface

| Route | Method | Purpose | Status |
|---|---|---|---|
| `/` | GET | UI | works |
| `/chat` | POST | chat turn | works (rule fallback when Ollama is down) |
| `/voice` | POST | upload audio → transcribe → chat | **broken on Windows** (`/tmp` path) |
| `/plugins` | GET | list plugin commands | works |
| `/facts` `/memory` `/stats` `/history` | GET | memory read-out | works |
| `/reset_session` | POST | clear session turns | works, but session identity is unstable (see B5) |
| `/status` | GET | health + model info | works |
| `/save` | POST | stub | returns "no checkpoint to save" |

### Data

`data/phoenix_memory.db` — **verified**: 129 conversation rows, 4 facts, sessions table present. Existing user data is intact and must be preserved.

---

## 2. What actually works

- **Flask app imports and serves.** Verified with the project venv (`.venv`, Flask 3.1.3, Python 3.10.11).
- **SQLite memory layer** (`src/memory.py`): schema creation, turn storage, recent-turn retrieval, fact extraction (name/age/location/job/likes/favourites/crush), profile context injection. Verified by DB contents and code path.
- **Emotion detection** (`src/emotion.py`): confident regex system for sad / angry / anxious / happy / confused / neutral, with temperature and tone-hint mapping.
- **Ollama client code** (`src/inference.py`): correct `/api/chat` call shape, timeout, model-existence check, rule-based fallback when the daemon is unreachable. **Unverified end-to-end**: no Ollama daemon is listening on `localhost:11434` in this environment (curl returned nothing), so all replies currently come from `RULE_RESPONSES`.
- **Plugin loader and the five shipped plugins**: dynamic load from `plugins/`, `/calc` has a real AST-guarded evaluator.
- **Chat UI plumbing**: message rendering, typing indicator, stats bar, session labels, fetch to `/chat`, error bubbles.
- **Three.js scene**: renderer, lighting rig, grid, ground, glow ring, particle field, OrbitControls with clamped angles, resize handling.
- **GLB loads and renders** as a static character.

---

## 3. What is broken (verified)

### B1. The whole frontend module aborts on a DevTools-only call — highest severity

`frontend/index.html`, immediately after `initVoiceInput()`:

```js
document.getElementById("voice-listen-btn").onclick
getEventListeners(document.getElementById("voice-listen-btn"))   // ← ReferenceError
```

`getEventListeners` exists only in the Chrome DevTools console. In a normal page it throws `ReferenceError`, which **terminates the module**. Everything declared or executed after that line never runs:

| Dead because of B1 | Consequence |
|---|---|
| textarea auto-resize | input box does not grow |
| typing → `startThinking()` | no thinking animation on typing |
| `const synth = window.speechSynthesis` | **all TTS is dead** (TDZ on `synth`) |
| `populateVoices()` / voice `<select>` | voice list stays empty |
| TTS slider `linkSlider` wiring | volume/rate/pitch do nothing |
| `#session-meta` fetch | header always shows `SESSION // 0000` |
| gaze/jaw init loop (`waitForAvatar`) | no gaze, no jaw fallback |
| `patchSendMessage` | the second send path never installs |
| visibility handlers | speech is not cancelled when the tab hides |

The "Test Voice Output" button is bound *before* the crash, so it is clickable — and it throws, because `speakReply` touches `synth` in the temporal dead zone.

### B2. Microphone input cannot work as written

`voice-helper.js` accepted `(onResult, onState)` and **ignored both arguments** — no `onresult`, `onerror`, or `onend` handler is attached. Clicking the mic calls `recognition.start()` on the raw object; the browser listens, but no transcript is ever delivered to `sendVoiceMessage`. There is also no toggle guard, so a second click while listening throws `InvalidStateError`.

### B3. `/voice` writes to `/tmp`

```python
tmp_path = f"/tmp/phoenix_voice_{uuid.uuid4().hex}.wav"
```

On Windows this resolves to a `C:\tmp` that usually does not exist, so `audio_file.save()` raises and the endpoint returns 500. `tempfile.NamedTemporaryFile` / `gettempdir()` is required.

### B4. No failure path for the 22.9 MB model

`loader.load(url, onLoad)` has no error callback and no timeout. If the GLB fails to load the loading overlay never clears and the UI looks frozen. There is also no byte-progress feedback during a 23 MB download.

### B5. Session identity is lost on every restart

```python
app.secret_key = os.environ.get("PHOENIX_SECRET", os.urandom(24))
```

`.env` is **empty** (verified), so each restart generates a new key, invalidating the browser cookie → a new `web_xxxx` session id → the visible conversation history resets even though the SQLite rows survive. Documented history is not lost; the *session binding* is.

### B6. Two competing animation loops

`animate()` runs a `requestAnimationFrame` loop; a second `jawGazeLoop()` RAF also runs, and `updateJaw` writes `avatar.rotation.y` while the `AnimationMixer` animates `avatar.quaternion` and `OrbitControls` owns the camera. Three systems write overlapping state, so motion is jittery and non-deterministic.

### B7. Dead and contradictory frontend files

- `script.js`, `voice.js`, `animation.js` (≈880 lines) are **never loaded** by `index.html`; `script.js` targets element ids that do not exist (`#factsPanel`, `#factsList`, `#input`, `#sendBtn`).
- `window.sendMessage` is patched, but the original `sendBtn` click listener still points at the un-patched function. Had B1 not aborted the module, Enter and click could send twice.

### B9. Emoji `print()` aborts startup on Windows (cp1252) — verified

Running `src/web_ui.py` with stdout redirected to a file produced:

```
UnicodeEncodeError: 'charmap' codec can't encode character '\u2705'
  File "src\web_ui.py", line 51, in get_phoenix
    print("✅ inference module loaded.")
```

Consequences:

1. Inside `get_phoenix()` the exception is caught, so `_load_error` is set to a
   `UnicodeEncodeError` string even though `inference` imported fine.
2. Inside `load_plugins()` the failure happens in the `print`, then the
   `except` handler's own `print("⚠️ …")` raises again — **uncaught** — so
   `load_plugins()` aborts the module and the server never binds.

`main.py` launches the server via `subprocess.run(..., inherit console)`, so a
Windows console in cp1252 hits this the moment a plugin loads. Fix: configure
UTF-8 on stdout/stderr (`sys.stdout.reconfigure(encoding="utf-8", errors="replace")`)
and/or replace decorative prints with `logging`.

**Verified server state on this machine:** port 5000 was already held by an
earlier process (PID 21708) that answers `/status` with
`ok:true, ollama_ready:false, voice_available:true` and all five plugins loaded.
That is the instance the browser test below exercised; the newly launched
instance exited on B9.

### B8. Plugin module duplication

`plugins/godmode.py` does `from src import memory` while the rest of the app imports the top-level `memory` module. Both resolve, producing **two module instances** and two SQLite connection paths. No `src/__init__.py` exists (namespace package), so this "works" by accident.

---

## 4. What is incomplete

| Area | Reality |
|---|---|
| `console.log` chatter | dozens of debug logs including `"BUTTON PRESSED"`, `"BUTTON FOUND:"` |
| `brain/` (memory, planner, reasoning) | 4-line docstring stubs |
| `avatar/` (actions, animation, emotions) | 4-line docstring stubs |
| `desktop/` (keyboard, mouse, windows) | 4-line docstring stubs — **no desktop automation exists** |
| `vision/` (detector, screen_capture) | 4-line docstring stubs — **no vision exists** |
| `config/settings.py` | docstring only; all config is scattered `os.environ` reads |
| `app.py` | single comment line |
| `requirements.txt` | lists `ultralytics`, `opencv-python`, `faiss-cpu`, `sentence-transformers`, `ollama` — **none imported by any working code path**. Heavy CPU install for nothing; `ollama` package is unused because `requests` is used directly. |
| `README.md` | feature matrix overstates reality (avatar animations, desktop automation) |
| Emotion vocabulary | 5 emotions; spec calls for 10 |
| Structured response | `/chat` returns `reply, emotion, tone_hint, learned, new_facts, score` — **no `action`, no `state`, no intent** |

---

## 5. The animation problem, precisely

### 5.1 What the GLB actually is — **verified by parsing the binary**

| Property | Result |
|---|---|
| Nodes | 21 (1 root, 1 container, **19 mesh nodes**) |
| Skins | **0** |
| Bones | **0** |
| Animations | **0** |
| Morph targets / blendshapes | **0** |
| Materials | 5 (`LowSet1/2/3`, `Robe`, `Robe2`) |
| Textures | 18 PNG |
| Attributes | POSITION, NORMAL, TANGENT, TEXCOORD_0 (no JOINTS_0/WEIGHTS_0) |
| Extensions | `KHR_materials_transmission` |
| Bounds | X 1.25 · Y 1.15 · **Z 2.43** → authored **Z-up** |
| Source | Sketchfab "Cyber Samurai" by KhoaMinh, CC-BY-4.0 |

This is a **photogrammetry-style static statue**, merged by material, not a rigged character. There is no humanoid skeleton, no jaw, no eyes-as-geometry, no hands, no fingers, and no inverse kinematics target. Nothing about the specification's arm/hand/finger work can run on this asset.

One useful structural fact: the mesh nodes are separable, and the topmost piece (`Object_17`, z 1.66–2.18, 8,091 verts, roughly centred) is the **head/helmet**. That single node can be pivoted at a computed neck point and rotated.

### 5.2 Why every "action" is a wiggle

`buildProceduralClip(emotion)` can only create `KeyframeTrack`s for properties that exist in the scene graph. With no bones and no morphs, the only animatable object is the scene root, so **every track targets `.position` and `.quaternion`** and is played by a mixer bound to that root:

- `happy` → root bounces up/down 4× per cycle
- `sad` → root leans and drops 4 cm
- `angry` → root translates ±2.5 cm on X ten times (`"Sharp tremor shake"`)
- `anxious` → root bobs at ~10 Hz
- `confused` → whole statue rolls left/right ±0.12 rad
- `thinking` / `talking` → whole statue pitches

That is the entire animation vocabulary: **the statue's root transform**. A gesture like *wave*, *point*, *shrug*, *cross arms* has nowhere to be expressed, so the code substitutes a body wiggle — which is exactly what the brief prohibits.

Two further defects compound it:

1. **`updateJaw` fakes a mouth with a body yaw.** With no jaw bone it runs
   `avatar.rotation.y = Math.sin(Date.now()*0.008) * 0.04` — a whole-body twist standing in for lip movement.
2. **`updateGaze` fakes a head turn by moving the camera target.** With no head bone it nudges `controls.target`, so the character does not look at the user; the camera drifts instead.

Both run in the second RAF loop (B6) and write the same nodes the mixer owns.

### 5.3 The honest capability ceiling of this asset

| Capability required by spec | Possible on `cyber_samurai.glb` |
|---|---|
| Natural idle / breathing / weight shift | ✅ (bounded root + head pivot) |
| Head follows cursor | ✅ (head-part pivot, ±~11°) |
| Listening tilt, thinking turn | ✅ |
| Emotion posture (happy/sad/angry/…) | ✅ as attitude only |
| Turn body toward user | ✅ |
| **Eye tracking, blinking** | ❌ no eye geometry or morphs |
| **Jaw / mouth / lip-sync** | ❌ no jaw bone, no blendshapes |
| **Wave, point, shrug, cross arms, celebrate** | ❌ no arm bones |
| **Finger articulation, IK** | ❌ |
| Clip-based state machine | ❌ no clips to mix |

Therefore: either the avatar is re-rigged in Blender (the only path to the full acceptance criteria), or Phoenix ships with rigid-part articulation and states the limitation in the UI.

### 5.4 Smallest reliable architectural change

Not a rewrite — six targeted moves:

1. **Delete the crash and the duplicate loop** (B1, B6): remove `getEventListeners`, fold `jawGazeLoop` into the single `animate()`, remove `window.sendMessage` patching in favour of one send function.
2. **One owner for the model.** `AvatarController` holds the GLB, the head pivot and the single apply step. Nothing else writes `root` or `head` transforms.
3. **Replace root-keyframe "clips" with smoothed scalar channels** (`AnimationManager`). Controllers publish targets (`gazeYaw`, `pose_headPitch`, `speechNod`, …); the controller composes them once per frame with clamps. Exponential damping gives frame-rate-independent blending and removes snapping.
4. **Probe capabilities at load** (`RigInspector`): bones, morphs, clips, and a geometry-based head detection. Every behaviour is gated on the probe, so an unsupported gesture reports *unavailable* instead of wiggling.
5. **One state machine + pose library** (`idle | listening | thinking | speaking`, plus named poses), driven by the backend's structured fields.
6. **Make the backend emit intent.** Add `state` and `action` to the `/chat` contract so the frontend never guesses actions from prose; unsupported actions must be answered with "not available on this model".

Steps 2–5 exist as **unwired groundwork** in `frontend/avatar/` (see below). Step 1 and step 6 are not yet applied.

---

## 6. Prepared but NOT integrated

These files were created during this audit as the Phase 3/4 foundation. **Nothing imports them yet**, so they cannot affect current behaviour:

```
frontend/avatar/RigInspector.js              capability probe + head-part detection + disposal
frontend/avatar/AnimationManager.js          smoothed scalar channels
frontend/avatar/AvatarController.js          load, normalize, pivot, compose, behaviour API
frontend/avatar/PoseManager.js               8 named poses (2 marked partial: no limbs)
frontend/avatar/IdleAnimationController.js   breathing, sway, micro-adjustments
frontend/avatar/GazeController.js            cursor tracking, mode-aware attention
frontend/avatar/EmotionManager.js            9 emotions → pose/palette/light
frontend/avatar/FacialAnimationController.js probes morphs/jaw; reports unsupported, drives nothing
frontend/avatar/LipSyncController.js         boundary-driven, only active between start/end
```

Their correctness is unproven until they are wired and exercised. Treat them as a design artefact, not a delivered feature.

---

## 7. Dependencies and environment

| Item | State |
|---|---|
| Python | 3.10.11 |
| venv | `.venv` present, Flask 3.1.3 + requests installed |
| System `python` | **no Flask** — `python main.py` fails unless the venv is activated |
| Ollama | not running; `qwen2.5` not confirmed pulled |
| faster-whisper | installed (ct2 tools present in `.venv\Scripts`) |
| Torch | CPU-only per project constraint; no CUDA assumed |
| GPU | Three.js WebGL; 18 textures / ~152k vertices is fine, but a 23 MB GLB needs progress + error handling |

---

## 8. Recommended implementation order

| Phase | Work | Blocks |
|---|---|---|
| **1** | ✅ This audit + `AVATAR_ANALYSIS.md` | — |
| **2** | Fix B1–B5, B7, B9 (crash, mic wiring, tempfile, load errors, single send path, session secret, UTF-8 stdout) | everything |
| **3** | Decide rigging: re-rig the GLB **or** ship rigid-part articulation; wire `RigInspector` + capability HUD | actions |
| **4** | Integrate `AvatarController` / `AnimationManager` / pose + state machine; remove root-keyframe clips | behaviour |
| **5** | Backend `state` + `action` contract; action registry with availability gating; confirm unsupported gestures | actions |
| **6** | Idle, gaze, listening/thinking/speaking states | presence |
| **7** | Emotion expansion to 10 + personality config | expression |
| **8** | Voice state machine + lip-sync (gated on a facial rig) | speech |
| **9** | Tool execution pipeline with permission gate (nothing exists today) | actions |
| **10** | Debug panel, memory panel, settings | usability |
| **11** | Test matrix, performance, docs | release |

**Hard dependency:** Phase 5 gestures and Phase 8 lip-sync cannot be completed on the current asset, regardless of frontend work. That decision (re-rig vs. capability-limited) is the single most important project-level choice and should be made before Phase 5.

# Project Context: AMR Digital Twin (frontend-first)

> Snapshot from 2026-10-30, written after reading every file in `viewer/` and the pipeline modules that produce replay data.
> Line numbers refer to that snapshot. Re-check them before relying on them after edits.
> Rules live in [CLAUDE.md](CLAUDE.md). The replay schema example is in [README.md](README.md). This file records **how things actually are** right now.

---

## 0. TL;DR

- **Two halves, no live link.** The Python pipeline (`amr_repair/`) simulates a lifelong multi-robot warehouse, injects disruptions, repairs paths (cache → LLM → solver → validator → fallback) and writes **replay JSON**. The browser viewer (`viewer/`) **only plays those files back** in 3D. It never simulates.
- **Viewer = 3 files:** [viewer/src/main.ts](viewer/src/main.ts) is one 2,007-line `ViewerApp` class, plus a 523-line static [viewer/index.html](viewer/index.html) and a 1,349-line [viewer/src/style.css](viewer/src/style.css).
- **Health:** `tsc --noEmit` reports 0 errors and `pytest -q` passes 32 tests. There are no viewer tests and no FPS measurements.
- **The HTML and the TS have drifted apart.** index.html was redesigned as a "control room" layout, but main.ts still targets the old DOM ids. About half of the visible UI is placeholder text or controls with no handler: the incident list, the incident diagnostics, timeline markers, the timestep readout, the speed selector, all View Controls toggles, the route preview and the callouts. The whole incident diagnostics renderer (`showIncidentPanel`) writes into elements that don't exist. See [§5](#5-ui-layout--wiring-status).
- **Several CLAUDE.md rules aren't met yet:** it uses WebGLRenderer, not `three/webgpu`. It has a hemisphere light, 3 directional lights and 16 point lights. There is no AO or bloom, no turn-before-move, the robot count is hard-coded to 100, fonts are 9–13 px, and goal positions and several numbers are invented. See [§7](#7-claudemd-compliance-viewer).
- **Only `latest_experiment` is real pipeline output** (30 robots, 61 steps, includes `goals`). `demo` and `scenario_*` are synthetic. In those synthetic files the "baseline" replays have **robot motion identical** to the LLM replays; only incident metadata and metrics differ.

---

## 0.1 Update: Phase 1 3D redesign (2026-10-30)

> §4.3–§4.9 below describe the **old** `main.ts` (WebGL, procedural racks inside main.ts). The 3D layer has since been rewritten. This section is the current truth for the scene; the UI wiring in §5 is unchanged.

**Design direction:** stylized industrial, inspired by factory-builder games (original assets, no branding). The environment is neutral: concrete foundation plates, steel-blue racking, cardboard stock. The safety-orange robots are the only saturated actors. Glowing status lights carry state.

**New module layout (`viewer/src/`)**

| File | Role |
|---|---|
| `types.ts` | Replay types matching `models.py` (nullable fields, `frames[].goals`, extended metrics) |
| `palette.ts` | All 3D colors (`PAINT`, `GOODS`, `STATE_LIGHT`) |
| `motion.ts` | Pure pose sampling: `computeHeadings(frames)`, `samplePose(frames, headings, r, t)`. Turn-in-place before moving, speed carried through straight runs (Hermite), lean on accel/brake. Verified in-page: no jumps, exact cell centers at integer t, zero samples translating while turning |
| `world/grid.ts` | Parses `/maps/<meta.map_name>.map` (falls back to `replay.map`). Obstacle ring = wall, other obstacles = racks |
| `world/floor.ts` | One plane, TSL shader reading a per-cell map texture: 4 m plates, 1 m grid (fades with distance), yellow lane lines along racks, hazard band along walls, slab edge |
| `world/racks.ts` | Rack cells = **one InstancedMesh** (2 levels, 1.0 m, tiles seamlessly; stock color and empty slots vary per instance in the shader). Wall ring = one InstancedMesh with hazard cap |
| `world/robots.ts` | `RobotFleet`: chassis / shell / lights / overview-marker InstancedMeshes, capacity = replay robot count. Selection ring, goal pin (real `goals` only). Arrow markers grow in past 30 m camera distance |
| `world/disruptions.ts` | Pooled instanced hazard barriers, red tiles, failure and delay rings, recomputed each frame. Failure markers follow the frame's `failed` state. Blocked-cell lifetime is still an assumption (`ASSUMED_LINGER_STEPS`), because the replay has no unblock time |
| `world/parts.ts` | Shared `part()` box builder and `hazardStripes()` TSL node |
| `world/incidents.ts` | **Phase 2.** `IncidentOverlay` in a holographic "planning mode" style:<br>• repaired routes are cyan floor ribbons with chevrons flowing in the travel direction; the part already driven dims as playback moves (`repaired[r][k]` is occupied at step `executed_at + 1 + k`)<br>• invalidated plans are red dashed rails that fade after execution<br>• every ribbon also draws as a faint x-ray pass that shows through racks, and widens with camera distance<br>• the congestion volume has crisp edges and a scanline<br>• interacting incidents get the partner's volume plus an animated arc<br>• rings under affected robots<br>• `pathAlignment()` measures how far the paths agree with the frames |
| `world/focus.ts` | `environmentBrightness` uniform. Racks, walls and floor drop to 45% while an incident is selected, so the overlays stand out |
| `render/stage.ts` | `WebGPURenderer` from `three/webgpu`, one sun DirectionalLight (shadow frustum fitted to the map, PCF radius 1.25), HDRI environment, ACES, sky gradient + fog. `RenderPipeline`: half-res depth/normal pre-pass → GTAO (indirect light only) + 4× MSAA scene pass + light bloom |
| `main.ts` | ~1,000 lines: app state, scenario loading, camera, render loop, plus the unchanged UI methods. Dev-only `window.viewer` handle for console and screenshot scripting |

**Performance (M1, headless Chrome, 1600×1000 viewport, dpr 2, uncapped):** before ≈ 12 FPS (overview, 100 robots). After: 133 FPS (30 robots), **125 FPS / 7.7 ms median (100 robots)**.

**Resolved from §7/§8:** WebGPURenderer ✅ · lighting rule ✅ (hemisphere, fill, rim, 16 point lights and ceiling fixtures removed) · AO + bloom ✅ · turn-before-move ✅ · robot count from replay ✅ (bug 1) · fake goals removed ✅ (bug 3) · `res.ok` checks ✅ (bug 5) · Line2 resolution ✅ (bug 8, WebGPU `Line2NodeMaterial` uses the viewport) · click-vs-drag picking ✅ (bug 9) · pixel-ratio cap consistent ✅ (bug 15) · frustum culling of moving instances ✅ (bug 16) · per-frame disruption churn ✅ (bug 17) · draw-call and light cost ✅ (bugs 18–20) · `logarithmicDepthBuffer` removed ✅ · `RGBELoader` → `HDRLoader` ✅ · FPS readout restored ✅ · boot loads the replay shown in `#experiment-select` ✅ · camera `.active` button state ✅ · `counter.ts` deleted. `public/models/*.glb` are now all unused.

**Phase 2 (incident overlays), also 2026-10-30:**
- **Disruption beacons:** `DisruptionLayer` adds instanced light columns over every active disruption: red for blocked cells, pink-red for failures while the frame says `failed`, amber for delays. They grow with camera distance, so trouble is visible from the full overview.
- **Selecting an incident now frames it** (`framePose` fits the region, routes and linked incidents). `Esc` clears both the incident and the robot selection. Switching LLM/baseline re-resolves the selected incident by id.
- **The two existing callouts are wired** to their 3D anchors:
  - `#callout-incident` shows type, id, detected/executed steps and robot count. It adds a `#callout-inc-note` warning when under 80% of the repaired-path cells match the frames.
  - `#callout-robot` shows position, recorded goal or "not recorded", state, and next cell. It opens away from the incident badge.
  - Callout text is now ≥14 px.
- **Data finding:** in `latest_experiment` (real pipeline) the repaired paths match the frames 100%. In `demo` and `scenario_*` (synthetic) they match 0%: the paths sit far from the robots listed as affected, and every incident reuses one path shape. The viewer says so via the note instead of hiding it.
- **Performance (same harness):** 145 FPS in the overview with beacons, 124 FPS in an incident view (100 robots).

**Still open:**
- All UI drift in §5 (Phase 3)
- The blocked-cell lifetime assumption
- Scenario/mode selectors pointing at missing data
- Fonts under 14 px outside the callouts
- CSS tokens vs 3D colors (e.g. the legend still says "Repaired path" is green)

---

## 1. What the project is

A warehouse multi-robot path-finding (lifelong MAPF) research project. When a disruption hits (a blocked aisle cell, a robot failure or a robot delay), a repair pipeline decides how to replan the affected robots. A strategy cache is tried first. On a miss, an LLM picks a solver, priority and horizon from a fixed menu. A deterministic validator must approve every plan. The 3D viewer exists to *show* this story: robots, the disruption, the invalidated and repaired routes, and the decision chain for each incident.

```
maps/*.map ──► amr_repair (Python)                               viewer (browser, Vite)
               sim → disrupt → sentinel → cache + dry-run         fetch /replays/<name>.json
               → LLM strategist → solver → validator → fallback   fetch /replays/<name>_baseline.json
               → logger → export                                  → animate in Three.js
                       │
                       └──► runs/<run_id>.json ──(copied by hand)──► viewer/public/replays/
```

---

## 2. Running things

| What | Command | Notes |
|---|---|---|
| Viewer dev server | `cd viewer && npm run dev` → http://localhost:5173 | No `vite.config.*`; `viewer/public/` is served at `/` |
| Viewer typecheck / build | `cd viewer && npx tsc --noEmit` / `npm run build` | build = `tsc && vite build` |
| Python tests | `uv run pytest -q` (or `.venv/bin/python -m pytest -q`) | 32 pass |
| One experiment | `uv run python -m amr_repair.experiments.run --robots 30 --steps 60 --seeds 42 --mode llm` | Writes `runs/llm_s42_r30_same_aisle.json` and appends to `runs/results.csv`. run_id = `{mode}_s{seed}_r{robots}_{overlap}` |
| Benchmark matrix | `uv run python -m amr_repair.experiments.benchmark [--quick]` | Writes `runs/benchmark/*.json` and `runs/benchmark_summary.{csv,md,tex}` |
| Synthetic replays | `uv run python scripts/make_fake_replay.py` | **Overwrites** `demo*` and `scenario_*` in `viewer/public/replays/` and `runs/` |
| GLB models | `uv run python scripts/build_models.py` | robot.glb and shelf.glb are no longer used by the viewer |

- HOW_TO_RUN.md says `python -m amr_repair.loop.controller` runs a demo. That module has no `__main__`, so the command does nothing.
- **To add a replay to the viewer:** copy `runs/X.json` to `viewer/public/replays/<name>.json`, **and** add a `<name>_baseline.json` next to it, because `loadScenario` always fetches both. Then add `<option value="<name>">` to `#experiment-select` in index.html.

---

## 3. Replay data contract

The source of truth is the Pydantic models in [amr_repair/replay/models.py](amr_repair/replay/models.py). README.md holds an annotated example.

### 3.1 Shape

```
meta        { seed, mode: llm | baseline_pibt | baseline_lns | baseline_pbs, map_name, steps (= frames.length) }
map         { width, height, obstacles: [x,y][] }
frames[]    { t, pos: [x,y][] (index = robot id), state: (moving|idle|delayed|failed|replanning)[], goals?: [x,y][] }
incidents[] { id, t_detected, executed_at,
              disruptions[ { type: blocked_cell|robot_failure|robot_delay, cells: [x,y][], robot?, k_steps? } ],
              affected_robots[], congestion { level: low|medium|high, region: [[x0,y0],[x1,y1]], density? },
              interacts_with: incidentId[],
              cache?   { hit, matched?, similarity? },
              dry_run? { ran, valid, violation? },
              llm?     { called, latency_ms?, tokens?, directive? { robots, solver: pibt|lns|windowed_pbs, priority, horizon, rationale? } },
              validator[ { attempt, valid, violation? } ], fallback_used,
              paths { invalidated: { "<robotId>": [x,y][] }, repaired: { "<robotId>": [x,y][] } },
              outcome { recovery_steps, cost_delta } }
metrics     { 6 core fields always; real runs add ~25 more (see 3.2) }
```

Facts checked against the files:
- `frames[0].t == 0`. Every robot moves **at most 1 cell (Manhattan) per step** in every replay, so the data has no teleports.
- `x` is the column (0…width-1) and `y` is the row (0…height-1), read top-down from the `.map` file.
- Optional fields are serialized as **`null`**, not omitted. The TS interfaces use `?:` without `| null`. That only works because the code always reads them with `?.` or `||`.
- `paths.invalidated[id]` is the first 20 cells of the robot's plan at detection time ([controller.py:151](amr_repair/loop/controller.py#L151)). It is **not** a separate "original path". The data has no original-path concept.

### 3.2 TS interfaces vs Python models (drift)

| Field | Python | TS ([main.ts:10-118](viewer/src/main.ts#L10-L118)) |
|---|---|---|
| `frames[].goals` | `Optional[List[(x,y)]]`, filled by real runs | **missing**, so the viewer fakes goals |
| Extended metrics: `sum_of_costs_delta`, `makespan_delta`, `llm_calls_avoided`, `mean_llm_latency_ms`, `cache_lookups/misses/hit_rate_pct`, `dry_run_successes/failures`, `verified_cache_reuse_count`, `verified_reuse_rate_pct`, `cache_insertions/evictions`, `mean_solver/validator/total_repair_latency_ms`, `safety_violations_intercepted`, `executed_safety_violations`, `failed_repair_attempts`, `fallback_invocations`, `emergency_holds`, `incidents_total/by_type/isolated/interacting` | present (defaults 0) | **missing** |
| Nullable fields | `Optional[...] = None` → `null` | `?:` only |
| `Disruption.cells` | always a list (default `[]`) | optional |

### 3.3 Replay files the viewer can load (`viewer/public/replays/`)

| Name | Origin | Robots | Steps | Incidents | `goals` | Notes |
|---|---|---|---|---|---|---|
| `latest_experiment` (+`_baseline`) | **Real pipeline.** Byte-identical to `runs/llm_s42_r30_same_aisle.json` and `runs/baseline_pibt_s42_r30_same_aisle.json` | 30 | 61 | 2 (`inc_001`, `inc_003`, both `robot_delay`, both cache hits) | yes | LLM and baseline motion differ in 14 of 61 frames. Full metrics. `llm: null` on cache hits. **Every state is `moving`** (1,830/1,830). `map.obstacles` has one extra cell `(79,31)` that isn't in the `.map` |
| `demo` (+`_baseline`) | Synthetic (`make_fake_replay.py`, seed 42) | 100 | 300 | 6: blocked, delay, failure, interacting pair 004↔005, cache hit 006 | no | Baseline frames identical to LLM |
| `scenario_isolated` | Synthetic, seed 101 | 100 | 300 | 3 | no | Metrics copied from demo |
| `scenario_interacting` | Synthetic, seed 202 | 100 | 300 | 2 (interacting pair) | no | Metrics copied from demo |
| `scenario_cache` | Synthetic, seed 303 | 100 | 300 | 2 (miss, then hit) | no | Metrics copied from demo |

Each 100-robot file is about 2.2 MB, roughly 20 MB in total. `runs/` also holds replays the viewer doesn't list: benchmark runs (20 robots, 41 steps, modes `llm`, `baseline_pibt` and `baseline_pbs`) and r10/r20 runs.

### 3.4 Data gaps: things the UI wants but the replay doesn't contain

CLAUDE.md says never to invent data fields. These need either a pipeline change or an honest "not recorded" in the UI:

| Wanted by UI | Status in data |
|---|---|
| When a blocked cell clears | **Not recorded.** The viewer guesses `t_detected + recovery_steps + 15` |
| Directive executed on a cache hit (solver, horizon) | **Not recorded.** `llm` is null and `cache` has no directive |
| Robot goals (synthetic replays) | Missing. Present only in real runs (`frames[].goals`) |
| Robot heading | Not recorded. Derive it from motion between frames |
| "Original path" (legend, sidebar) | Not recorded. Only `invalidated` and `repaired` exist |
| "Candidate route" (`--route-candidate` token) | Not recorded |
| Per-frame "emergency hold" | Not a state. Appears only as a validator `violation` string starting `emergency_hold:` and in `metrics.emergency_holds` |
| Per-incident safety violations | Aggregate metric only |
| `delayed` state in real runs | The pipeline loses it: the injector sets `delayed` ([injector.py:190](amr_repair/disrupt/injector.py#L190)), then the repair sets `replanning` ([controller.py:343](amr_repair/loop/controller.py#L343)), and the next step turns that into `moving` |

---

## 4. Frontend architecture

### 4.1 Stack

- **three 0.186.1** (+ `@types/three` 0.186), imported from `'three'` (WebGL). Addons used: `OrbitControls`, `RGBELoader` (deprecated since r180, logs a warning; replace with `HDRLoader`), `GLTFLoader`, `Line2`/`LineMaterial`/`LineGeometry`, and `BufferGeometryUtils.mergeGeometries`.
- **Vite 8.3.4**, **TypeScript 6.0.3**, Node 26 locally. No vite config. The tsconfig uses bundler mode with `noUnusedLocals`, `noUnusedParameters` and `erasableSyntaxOnly`, **without `strict`**.
- Fonts: Inter and JetBrains Mono from Google Fonts (`<link>` in index.html).
- No framework, no state library, no viewer tests.

### 4.2 Files

| File | Role |
|---|---|
| [viewer/index.html](viewer/index.html) | The full static DOM: every panel, with hard-coded placeholder values |
| [viewer/src/main.ts](viewer/src/main.ts) | Everything else: types, scene, loaders, UI wiring, render loop |
| [viewer/src/style.css](viewer/src/style.css) | Design tokens, layout and components |
| `viewer/src/counter.ts`, `viewer/src/assets/*` | Unused Vite template leftovers |
| `viewer/public/maps/warehouse-10-20-10-2-1.map` | The **only** map loaded (path hard-coded at [main.ts:466](viewer/src/main.ts#L466)); `replay.map` is ignored |
| `viewer/public/textures/warehouse.hdr` (1.6 MB), `concrete_floor.jpg` | Environment map and floor texture |
| `viewer/public/models/barrier.glb` | Used: the cone on blocked cells |
| `viewer/public/models/robot.glb`, `shelf.glb`, `public/icons.svg` | **Unused.** Robots and shelves are procedural in main.ts |
| `viewer/public/replays/*.json` | Data |

### 4.3 `ViewerApp` method map ([main.ts](viewer/src/main.ts))

| Lines | Method | What it does |
|---|---|---|
| 10–118 | interfaces | Replay types (see 3.2 for drift) |
| 121–175 | fields | All state lives on the class |
| [177](viewer/src/main.ts#L177) | `init` | Boot sequence (4.4) |
| [207](viewer/src/main.ts#L207) | `setupScene` | Background `#05070a`, `FogExp2(0.0055)`, adds barrier/paths/floor-line groups |
| [216](viewer/src/main.ts#L216) | `setupRenderer` | `WebGLRenderer`, PCFSoft shadows, ACES at 1.05, sRGB, `logarithmicDepthBuffer: true` |
| [234](viewer/src/main.ts#L234) | `setupCamera` | Perspective 45°, near 0.5, far 2000, OrbitControls |
| [254](viewer/src/main.ts#L254) | `setupLighting` | Hemisphere 0.35, key directional 2.0 (4096² shadow), fill 0.4, rim 0.3 |
| [291](viewer/src/main.ts#L291) | `loadTexturesAndHDRI` | HDR goes to `scene.environment`; the floor texture repeats `w/2 × h/2` |
| [313](viewer/src/main.ts#L313) | `createFloor` | Floor plane and a dark exterior pad |
| [343](viewer/src/main.ts#L343) | `createAisleLaneMarkings` | One `THREE.Line` per row (yellow on aisle rows, dim on even rows), border, and amber hatch every 20 columns |
| [399](viewer/src/main.ts#L399) | `createWarehouseWalls` | Empty ("walls removed per user request") |
| [403](viewer/src/main.ts#L403) | `createCeilingLights` | 72 fixtures × 3 individual meshes, plus **16 PointLights** |
| [464](viewer/src/main.ts#L464) | `loadMap` | Parses MovingAI `.map` (`@`, `T`, `O` = obstacle) into `obstacleSet` (`"x,y"` strings) |
| [489](viewer/src/main.ts#L489) / [515](viewer/src/main.ts#L515) | `createGoalMarkers` / `updateGoalMarkers` | Instanced rings. Goal = `pos + (18, 12)`, which is **fake** |
| [549](viewer/src/main.ts#L549) | `loadModels` | Shelves, walls (no-op), ceiling, goals, barrier GLB (cone fallback), robots |
| [581](viewer/src/main.ts#L581) | `buildRackGeometry` | Procedural rack: 4 uprights, 4 beam levels, 3 decks, 6 crates and a brace, merged |
| [644](viewer/src/main.ts#L644) | `mergeGeometries` | Manual merge fallback (normally unused) |
| [688](viewer/src/main.ts#L688) | `createShelves` | **One InstancedMesh** over all 4,444 obstacle cells, with per-instance graphite tint |
| [729](viewer/src/main.ts#L729) | `buildRobotChassisGeometry` | Procedural AMR body. Forward = +Z (chevron, LiDAR at front) |
| [859](viewer/src/main.ts#L859) | `buildRobotLedGeometry` | Halo ring, 2 headlights, taillight |
| [890](viewer/src/main.ts#L890) | `createRobotMeshes` | 3 InstancedMeshes (chassis, LED, blob shadow), **count hard-coded to 100** |
| [930](viewer/src/main.ts#L930) | `loadScenario` | Fetches `<key>.json` and `<key>_baseline.json` (no `res.ok` check), sets slider max, metrics, ticks, toast |
| [959](viewer/src/main.ts#L959) | `updateMetricsUI` | Writes footer and header chips. Many target ids no longer exist |
| [1017](viewer/src/main.ts#L1017) | `buildTimelineTicks` | Creates `.incident-tick` divs in `#track-incidents-viewport`. That class has **no CSS** |
| [1070](viewer/src/main.ts#L1070) | `selectIncident` | Jumps time to `t_detected`, shows the panel, draws overlays, shows a toast |
| [1079](viewer/src/main.ts#L1079) | `showIncidentPanel` | Full Sentinel → Cache → Dry-run → LLM → Solver → Validator text. **Every target id is missing** |
| [1200](viewer/src/main.ts#L1200) | `updatePathsVisualization` | Congestion plane, invalidated paths (red dashed `Line2`, Catmull-Rom), repaired paths (blue `Line2`), magenta link to interacting incidents |
| [1307](viewer/src/main.ts#L1307) | `showRobotCard` | Fills sidebar id/pos/dest/state once. The destination is fake |
| [1338](viewer/src/main.ts#L1338) | `showToast` | 3.2 s toast |
| [1352](viewer/src/main.ts#L1352) | `setupUI` | Button and select wiring (many selectors are stale, see §5) |
| [1537](viewer/src/main.ts#L1537) | `toggleFullscreen` | Fullscreens `.viewport-card` |
| [1554](viewer/src/main.ts#L1554) | `setupEventListeners` | Keyboard, fullscreenchange, pointerdown raycast |
| [1628](viewer/src/main.ts#L1628) | `jumpIncident` | Next/prev with wraparound |
| [1646](viewer/src/main.ts#L1646) | `setCameraPreset` | 1 = overview, 2 = incident, 3 = robot; 0.8 s transition |
| [1688](viewer/src/main.ts#L1688) | `startIntroDolly` | 2 s intro move |
| [1700](viewer/src/main.ts#L1700) | `updateCameraAnimation` | Cubic ease-in-out; follow-robot lerp for preset 3 |
| [1726](viewer/src/main.ts#L1726) | `updateRobots` | Per-frame instance matrices and LED colors (4.6) |
| [1823](viewer/src/main.ts#L1823) | `updateDisruptions` | **Destroys and recreates** barrier meshes every frame |
| [1904](viewer/src/main.ts#L1904) / [1910](viewer/src/main.ts#L1910) | `updateSliderUI` / `updateStepIndicator` | Slider value; the indicator targets missing ids |
| [1925](viewer/src/main.ts#L1925) | `renderLoop` | 4.5 |
| [1995](viewer/src/main.ts#L1995) | `onWindowResize` | Camera aspect, renderer size, pixel ratio capped at **1.5** here (2.0 at startup) |

### 4.4 Boot sequence

`init()` runs: `setupScene` → `setupRenderer` → `setupCamera` → `setupLighting` → `await loadMap()` → `await loadTexturesAndHDRI()` (env map, floor, lane lines) → `await loadModels()` → `await loadScenario('demo')` → `setupUI` → `setupEventListeners` → ResizeObserver plus a window resize listener (both active) → `startIntroDolly` → `requestAnimationFrame(renderLoop)`.

- There's no loading indicator. The canvas stays empty until every await resolves, including about 2 MB of JSON for demo.
- The app boots `demo` (`currentScenario = 'demo'`, [main.ts:132](viewer/src/main.ts#L132)) while `#experiment-select` shows `latest_experiment` as selected.

### 4.5 Per-frame loop (`renderLoop`, [main.ts:1925](viewer/src/main.ts#L1925))

1. `dt` is clamped to 0.1 s. FPS is computed and written to `#fps-counter`, which doesn't exist.
2. While playing: `clockTime += dt × 3.5 × playSpeed` (3.5 steps/s at 1×), wrapping to 0 at the end. Then `updateSliderUI()`, which writes to the DOM every frame.
3. `updateCameraAnimation(dt)`
4. `updateRobots(clockTime)` rewrites every instance matrix and LED color.
5. `updateDisruptions(clockTime)` rebuilds the disruption meshes.
6. `updateGoalMarkers(clockTime)`
7. WASD/QE fly navigation (skipped while focus is in an INPUT or TEXTAREA, but **not** a SELECT)
8. `controls.update()`, then `renderer.render()`

### 4.6 Time, interpolation and scrubbing

- The single time source is `clockTime` (float, in steps): `s0 = floor(t)`, `s1 = min(s0+1, last)`, `alpha = t − s0`.
- **Position:** smoothstep from `frames[s0].pos[r]` to `frames[s1].pos[r]`. **Heading:** `atan2(dx, dy)`, applied instantly at the start of the move and **reset to 0 (+Z) whenever the robot is stationary** ([main.ts:1750-1759](viewer/src/main.ts#L1750-L1759)). No turn phase exists.
- **LED color** comes from `frames[s0].state[r]`: moving is blue `#38bdf8` with a slight pulse, idle green `#10b981`, delayed amber at 1 Hz, replanning magenta at 2 Hz, failed red at 4 Hz. With an incident selected, affected robots turn magenta and others drop to 60%. The selected robot gets a bright cyan pulse.
- **Disruptions** are visible while `t_detected ≤ step ≤ t_detected + recovery_steps + 15`. The `+15` is invented. `blocked_cell` gets a cone, a pulsing red tile and a ring. `robot_failure` gets a grey ring and red glow (it disappears after the window even though failure is permanent). `robot_delay` gets an amber ring that follows the robot.
- Robots and disruptions are recomputed from frames every frame, so **scrubbing backwards is correct**. That part of the rule holds.
- State that doesn't come from the replay: `selectedIncident`, `selectedRobotId`, `activePreset`, `isBaselineMode`, the camera, and `keysPressed`.

### 4.7 Coordinates and layer heights

- Cell `(x, y)` maps to world `(x + 0.5, 0, y + 0.5)`. +X runs along map columns, +Z along map rows (down the `.map` file), +Y is up.
- The robot model faces +Z. The chassis origin is at mid-height and placed at `y = 0.1`.
- Y layers: exterior pad −0.01 · floor 0 · lane lines 0.011–0.015 · blob shadow 0.015 · failure glow 0.017 · blocked tile 0.018 · rings 0.019 · congestion plane and goal rings 0.02 · invalidated path 0.15 · repaired path 0.18 · interacting link 0.25.

### 4.8 Scene inventory and cost

| Object | Built in | Kind | Count | Shadows | Notes |
|---|---|---|---|---|---|
| Floor and exterior pad | `createFloor` | 2 Mesh (Standard) | 2 draws | floor receives | |
| Lane markings | `createAisleLaneMarkings` | `THREE.Line` per row + hatch planes | ~64 lines + 9 planes | – | Could be one `LineSegments` |
| Shelves | `createShelves` | **1 InstancedMesh** | 4,444 × ~264 tris ≈ **1.2 M tris** | cast + receive | Also drawn into the 4096² shadow map |
| Ceiling fixtures | `createCeilingLights` | Individual meshes, each with its own geometry | 72 × 3 = **216 draws** | – | Floating at y ≈ 4.7 |
| Point lights | `createCeilingLights` | `PointLight` ×16 (intensity 8, distance 20) | – | – | Breaks the lighting rule; heavy fragment cost |
| Robots | `createRobotMeshes` | 3 InstancedMeshes (chassis, LED, blob shadow) | **100 each, hard-coded** | chassis cast + receive | Instancing is correct per the rule |
| Goal rings | `createGoalMarkers` | InstancedMesh | 100 | – | Positions are fake |
| Disruption decals and cones | `updateDisruptions` | New Mesh, geometry and material per cell, **every frame** | dynamic | cone casts | Disposes the *shared* barrier geometry each frame; never disposes materials |
| Incident overlays | `updatePathsVisualization` | Plane + `Line2` per path | on selection | – | `LineMaterial.resolution` = window size, set once |

The baseline is roughly 300 draw calls, mostly ceiling fixtures and lane lines.

### 4.9 Camera and input (actual behavior)

- OrbitControls: damping 0.08, distance 3–500, polar angle just under 90°, screen-space panning.
- Presets: **1** = overview `(w/2, 85, h/2+75)`. **2** = frames the selected incident's congestion region (falls back to a mid overview). **3** = selected robot (or robot 0) and then follows it (target lerp 0.08/frame). Transitions use cubic ease-in-out over 0.8 s.

| Input | Does | Issue |
|---|---|---|
| Space | Play/pause | Icon starts as ▶ while already playing |
| ← / → | Step ±1 | Doesn't pause (the step buttons do) |
| 1 / 2 / 3 | Overview / incident / robot | Button tooltips in HTML say 2 = robot and 3 = incident, which is swapped |
| 0 or R | Overview | |
| F | Fullscreen on `.viewport-card` | |
| N / P | Next / previous incident (wraps) | |
| Esc | Exit fullscreen, clear selected incident | Doesn't clear the selected robot |
| WASD / QE | Pan / orbit | Also fires while a `<select>` has focus |
| Click a robot | Raycast on **pointerdown** selects it | Fires at the start of every orbit drag. Clicking empty space never deselects |

---

## 5. UI layout & wiring status

**Layout:** `#app-layout` is a flex column at 100vh: a **60 px header**, then `.main-stage` (a grid of `1fr | 310px`), then a **48 px footer**. The left column holds `.viewport-card` (flex 1: canvas plus floating overlays) above `.middle-controls-row` (grid `240px | 1fr`, fixed **138 px** tall), which contains the incidents card and the playback/timeline panel. The right column is `.sidebar-panel`: the robot details card and the view controls card.

Legend: ✅ works · ⚠️ partial or wrong · ❌ static placeholder or no handler

**Header**

| Element | id | Status |
|---|---|---|
| Experiment select | `#experiment-select` | ✅ Loads `<value>.json` and `_baseline`. The default option doesn't match the booted replay |
| Mode select | `#mode-select` | ⚠️ Every `baseline_*` loads the same `_baseline.json` (PIBT). The LNS and PBS options show PIBT data under an LNS/PBS label |
| Scenario select | `#scenario-select` | ❌ Values `same_aisle`, `multi_incident` and `isolated_aisle` have no files, so the fetch fails, gets logged, and nothing changes |
| Chips (robots, steps, incidents, success) | `#chip-*-count`, `#chip-success-rate` | ✅ |

**Viewport overlays**

| Element | id | Status |
|---|---|---|
| Legend | `#viewport-legend` | ⚠️ Static. The collapse button has no handler. It lists "Original path" and "emergency hold", which have no data |
| Camera bar | `.cam-preset-btn` | ⚠️ Clicks work, but `.active` never moves (TS targets `.camera-preset-bar .cam-btn`) |
| Fullscreen | `#btn-fullscreen` | ✅ |
| Robot callout | `#callout-robot` | ❌ Never shown or positioned |
| Incident callout | `#callout-incident` | ❌ Never shown |
| Nav hint | `#viewport-nav-hint` | ✅ Static text |

**Incidents card and playback panel**

| Element | id | Status |
|---|---|---|
| Incident list | `#incidents-list-container` | ❌ **Never populated.** No code creates `.incident-entry-item` |
| Count badge | `#incidents-badge-count` | ✅ |
| Collapse | `#incidents-collapse-btn` | ❌ (the CSS for `.incidents-collapsed` exists) |
| Play/pause, jump to start/end, step back/forward | `#play-pause-btn` etc. | ✅ (icon inverted at start) |
| Timestep readout | `#timestep-display` | ❌ Stuck at "23 / 60". TS writes `#step-indicator`, `#step-pct` and `#slider-progress-bar` |
| Slider | `#step-slider` | ✅ max = steps − 1 |
| Speed | `#speed-select` | ❌ No listener (TS queries `.speed-pill-group .speed-btn`), so speed is always 1× |
| Previous/next incident | `#prev-inc-btn`, `#next-inc-btn` | ✅ |
| Incidents track | `#track-incidents-viewport` | ⚠️ Ticks are created, but `.incident-tick` has no CSS, so they have zero size and are **invisible**. The tooltip ids are missing |
| Robot States track | `#track-states-viewport` | ❌ Never populated |
| Axis labels | `#timeline-axis-ticks` | ❌ Hard-coded 0–60 (wrong for 300-step replays) |
| Playhead | `#timeline-playhead` | ❌ Never moves |

**Sidebar**

| Element | id | Status |
|---|---|---|
| Robot id, position, destination, state | `#detail-robot-id/-pos/-dest/-state` | ⚠️ Filled on click only, not live during playback. The destination is fake. The state text changes but the badge class stays `moving` (green) |
| Timestep, route status, assigned incident | `#detail-timestep/-route-status/-incident` | ❌ Placeholders |
| Route step counts | `#detail-orig/-inval/-repaired-steps` | ❌ Placeholders |
| Route eye toggles | `.route-vis-btn` | ❌ |
| Focus buttons | `#btn-focus-robot`, `#btn-focus-inc-sidebar` | ❌ |
| Route preview | `#route-preview-canvas` | ❌ Never drawn |
| Close | `#detail-close-btn` | ⚠️ Clears the selection, but there's no generic `.hidden` CSS rule, so the card stays visible |
| View Controls: 7 switches + Reset | `#switch-*`, `#btn-reset-view-sidebar` | ❌ No listeners. Robot ID labels don't exist in the scene at all |

**Footer metrics**

| Element | id | Status |
|---|---|---|
| Repair success | `#metric-success-rate` | ✅ |
| Mean recovery | `#metric-recovery-steps` | ✅ (injects `<span class="unit">`, which has no CSS) |
| Cache hit rate | `#metric-cache-rate` | ⚠️ Computed as hits/(hits+llm_calls) and shows **100.0% when hits = 0** (baseline). Real runs carry `cache_hit_rate_pct` |
| LLM calls | `#metric-llm-calls` | ✅ |
| Safety violations | `#metric-safety-violations` | ❌ Static `0`. Real runs carry `safety_violations_intercepted` and `executed_safety_violations` |
| Cost delta | (TS wants `#metric-cost`) | ❌ No element, never shown |

**Ids and selectors main.ts references that don't exist in index.html:**
`fps-counter`, `metric-success`, `metric-recovery`, `metric-cost`, `metric-llm`, `base-success|recovery|cost|llm`, `badge-success|recovery`, `timeline-ticks`, `incident-tooltip`, `tt-header`, `tt-body`, `incident-counter-chip`, `incident-panel`, `incident-panel-title|subtitle`, `inc-sentinel-text`, `inc-affected-chips`, `inc-cache-badge|text|sim-val|sim-fill`, `inc-dryrun-badge|text`, `inc-llm-badge|text|latency|tokens|solver|directive`, `inc-solver-text`, `inc-validator-badge|text`, `incident-close-btn`, `copy-directive-btn`, `robot-card`, `robot-card-id|state|pos|goal|dist|status-dot|close`, `robot-follow-btn`, `play-icon`, `play-text`, `mode-llm-btn`, `mode-base-btn`, `help-btn`, `help-modal`, `help-modal-close`, `step-indicator`, `step-pct`, `slider-progress-bar`, `.speed-pill-group .speed-btn`, `.camera-preset-bar .cam-btn`.

> **The biggest gap:** the incident decision chain (Sentinel → Cache → Dry-run → LLM → Solver → Validator), which is the core of the research story, has working logic in `showIncidentPanel` ([main.ts:1079-1198](viewer/src/main.ts#L1079-L1198)) but **no DOM to render into**.

---

## 6. CSS design system ([style.css](viewer/src/style.css))

**Tokens** (`:root`, lines 1–36):

| Group | Tokens |
|---|---|
| Surfaces | `--bg-app #07111B` · `--panel-bg #0D1824` · `--surface-elevated #132130` · `--surface-hover #192B3E` · `--border-color #243649` · `--border-subtle rgba(255,255,255,.07)` |
| Text | `--text-primary #E8F0FA` · `--text-secondary #91A4BA` · `--text-muted #5D7289` |
| Accent | `--accent-primary #3185FF` · `--accent-primary-hover #4C97FF` |
| Domain | `--robot-normal #2583F5` · `--robot-selected #46C7FF` · `--route-original #4AB3FF` · `--route-invalidated #FF666B` · `--route-candidate #FFB62E` · `--route-repaired #38D98A` · `--cell-blocked #F04F55` · `--robot-delayed #FFB62E` · `--robot-emergency #FF4F68` · `--goal-marker #36D67D` · `--grid-neutral #26394A` |
| Shape | `--radius-sm 4px` · `--radius-md 8px` · `--radius-lg 12px` · `--shadow-panel` |
| Type | `--font-sans` Inter · `--font-mono` JetBrains Mono |

**Observations**
- Body text is **13 px**, and most labels are **9–12 px**, below the 14 px rule.
- Panels are **opaque** (`--panel-bg`) and **docked around** the canvas. CLAUDE.md asks for translucent panels **over** the canvas. Only the legend, camera bar, nav hint and callouts float.
- Missing rules: a generic `.hidden`, plus `.incident-tick`, `.unit`, `.robot-chip` and `.diag-badge`.
- **CSS colors and 3D colors disagree:** the repaired route is green `#38D98A` in the legend and CSS but blue `0x38bdf8` in the scene. The state badge shows moving as green and idle as grey, but the robot LEDs show moving as blue and idle as green. Affected robots are magenta in 3D, but magenta isn't a token.
- Hard-coded colors in 3D code (`0xef4444`, `0x38bdf8`, `0xd946ef`, `0xf59e0b`, `0x10b981`) aren't shared with the CSS tokens.

---

## 7. CLAUDE.md compliance (viewer)

| Rule | Status | Evidence |
|---|---|---|
| `three/webgpu` + `WebGPURenderer` | ❌ | [main.ts:1](viewer/src/main.ts#L1), [main.ts:217](viewer/src/main.ts#L217) |
| Vite + vanilla TS, no React, no other 3D libs | ✅ | |
| Cell (x,y) → world (x+.5, 0, y+.5) | ✅ | |
| Robots one InstancedMesh per sub-mesh; shelves one InstancedMesh | ✅ (count hard-coded 100) | [main.ts:891](viewer/src/main.ts#L891), [main.ts:705](viewer/src/main.ts#L705) |
| Ease-in-out, **turn before move**, never teleport | ⚠️ Smoothstep ✅; no turn phase; heading snaps and resets | [main.ts:1750-1759](viewer/src/main.ts#L1750-L1759) |
| One DirectionalLight + HDRI, ACES, **no ambient** | ❌ Hemisphere + 3 directional + 16 point lights | [main.ts:254-289](viewer/src/main.ts#L254-L289), [main.ts:454-461](viewer/src/main.ts#L454-L461) |
| Post: AO + light bloom only | ❌ None | |
| Every visual state from the replay at the current step | ⚠️ Robots ✅; disruption end time and goals invented | [main.ts:1835](viewer/src/main.ts#L1835), [main.ts:533](viewer/src/main.ts#L533) |
| UI over canvas, dark translucent panels, 14 px minimum | ⚠️ Docked opaque panels; 9–13 px fonts | style.css |
| 60 fps with 200 robots on an integrated GPU, measured | ❓ Never measured; 100-robot cap; FPS readout element missing | |
| Never invent data fields | ❌ Fake goals ([main.ts:533-534](viewer/src/main.ts#L533-L534), [main.ts:1324-1326](viewer/src/main.ts#L1324-L1326)); defaults `density 0.15` ([1093](viewer/src/main.ts#L1093)), `1120 ms` / `850 tokens` ([1166-1167](viewer/src/main.ts#L1166-L1167)), `horizon 20` and "Produced collision-free trajectories" ([1183](viewer/src/main.ts#L1183)), solver `PIBT` ([1175](viewer/src/main.ts#L1175)); `+15` disruption window ([1835](viewer/src/main.ts#L1835)) | |

---

## 8. Known bugs (prioritized)

**P0: correctness**
1. **Robot count fixed at 100** ([main.ts:491](viewer/src/main.ts#L491), [main.ts:891](viewer/src/main.ts#L891)). three initializes instance matrices to identity, so on the 30-robot `latest_experiment` **70 phantom robots sit stacked at world origin** (the map corner). Robots beyond 100 are silently not drawn. Size from `frames[0].pos.length`: allocate a max and set `mesh.count`, or rebuild on load.
2. **HTML/TS drift** (§5): the incident list, diagnostics panel, timestep readout, speed, playhead, axis and timeline markers.
3. **Fake goals.** Use `frames[s].goals` when present and hide the marker otherwise.
4. Scenario select points at files that don't exist. Mode select offers LNS/PBS with no data behind them. Boot loads `demo` while the selector shows `latest_experiment`.
5. `loadScenario` never checks `res.ok`. A missing baseline file aborts the whole load.

**P1: visual / UX**

6. No turn-before-move, and heading resets to +Z when a robot stops.
7. Disruption lifetime is invented. Failure markers vanish although failures are permanent (the frames still say `failed`, so this can be derived).
8. `LineMaterial.resolution` comes from `window.inner*` once, so line widths are wrong after a resize, in fullscreen, or whenever the canvas isn't the full window.
9. The pointerdown raycast selects on drag start, and there's no deselect.
10. Switching mode keeps the `selectedIncident` object from the other replay and doesn't redraw the overlays.
11. Selected-robot details aren't live (the live update writes to `robot-card-*` ids).
12. Cache hit rate shows 100% for baseline runs.
13. Key hints in tooltips don't match the actual keys (2 and 3 swapped). The play icon starts inverted.
14. There's no generic `.hidden` rule, so close buttons don't hide anything.
15. The pixel ratio cap changes from 2.0 to 1.5 on the first resize.
16. The robot InstancedMesh **bounding sphere is computed once** (first render) and never updated, so robots that move outside it can be frustum-culled or become unpickable. Call `computeBoundingSphere()` after updates, or set `frustumCulled = false` on the robot meshes.

**P2: performance and hygiene**

17. `updateDisruptions` reallocates meshes, geometries and materials every frame, disposes the shared barrier geometry (forcing a re-upload), and leaks materials.
18. 16 point lights, 3 directional lights and a hemisphere light all shade MeshStandard everywhere.
19. 216 separate ceiling meshes and about 64 separate lane lines.
20. `logarithmicDepthBuffer: true` isn't needed at near 0.5 / far 2000.
21. A 4096² shadow map over about 1.2 M shelf triangles.
22. Per-frame allocations (`Object3D`, `Set`, `Vector3`, `performance.now()` per robot) and DOM writes every frame.
23. `RGBELoader` is deprecated and warns in the console. Use `HDRLoader`.
24. Leftover files: `counter.ts`, `src/assets/*`, `robot.glb`, `shelf.glb`, `icons.svg`.

---

## 9. Performance notes

- The repo contains **no measurements**. IMPLEMENTATION_STATUS.txt claims 60 fps on an integrated GPU, but that described an earlier build (2048² shadows, no point lights).
- No 200-robot replay exists. Generate one with `experiments.run --robots 200 --steps 120` or `make_fake_replay.generate_fake_replay(num_robots=200)`.
- **Measure first:** add the missing `#fps-counter` element (the code at [main.ts:1932-1938](viewer/src/main.ts#L1932-L1938) is ready), ideally with frame time too. Then record demo (100 robots) and a 200-robot run before and after each change, as CLAUDE.md requires.
- Likely costs, biggest first: fragment shading with 16 point lights → shelves in the 4096² shadow pass → about 300 draw calls → per-frame disruption churn.

---

## 10. WebGPU migration notes (three 0.186, verified against node_modules)

- `import * as THREE from 'three/webgpu'` and `new THREE.WebGPURenderer({ antialias: true })`. Call `await renderer.init()` (or use `renderer.setAnimationLoop`) before the first render. It falls back to WebGL2 on its own.
- Fat lines: `Line2` from `three/addons/lines/webgpu/Line2.js`, with `THREE.Line2NodeMaterial` instead of `LineMaterial`.
- Post-processing: `THREE.RenderPipeline` (`PostProcessing` still exists but is now a deprecated wrapper), with `pass()` from `three/tsl`, `ao()` from `three/addons/tsl/display/GTAONode.js` and `bloom()` from `three/addons/tsl/display/BloomNode.js`.
- HDR: `HDRLoader` from `three/addons/loaders/HDRLoader.js`.
- `InstancedMesh.setColorAt` and per-instance color work with node materials. Standard materials are converted automatically.

---

## 11. Python pipeline (condensed)

| Stage | Module | Key API |
|---|---|---|
| 1 Simulator | `sim/grid.py`, `sim/agents.py`, `sim/lifelong.py` | `GridMap.from_movingai`, `Robot` dataclass, `World.step()` records `Frame(t, pos, state, goals)` |
| 2 Disruptions | `disrupt/injector.py` | `Injector(rng, schedule \| config, world).apply(world, t)`; overlap modes `none`, `same_aisle`, `same_robot` |
| 3 Sentinel | `sentinel/detect.py`, `sentinel/incident.py` | `IncidentDetector.detect(...)` → `IncidentRecord` (12-dim `features()`), merges interacting incidents |
| 4–5 Cache | `cache/store.py`, `cache/negative.py` | `StrategyCache.lookup` (hard-filter key + cosine ≥ threshold 0.85, LRU, capacity 500), dry-run, `NegativeMemory` |
| 6 LLM | `llm/schema.py`, `llm/prompts.py`, `llm/strategist.py` | `Directive{robots, solver, priority (permutation), horizon 10–40, rationale ≤200}` |
| 7 Solvers | `solvers/pibt.py`, `lns.py`, `windowed_pbs.py`, `space_time_astar.py` | `solve(world, robots, priority, horizon) -> {id: path}` |
| 8 Validator | `validate/validator.py` | `validate(paths, world, t0) -> Verdict` (static, failed robots, vertex, edge swap, deadlock) |
| 9 Loop | `loop/controller.py`, `loop/logger.py` | `SimulationConfig`, `SimulationController.run()` → `Replay`, exported to `runs/<run_id>.json` |
| 10 Experiments | `experiments/run.py`, `benchmark.py`, `ablations.py`, `baselines.py` | CLI runners (§2) |
| Replay | `replay/models.py`, `replay/exporter.py` | Pydantic schema, `export_replay` (`.json` or `.json.gz`) |

**Incident handling** (`_handle_incident`, [controller.py:137](amr_repair/loop/controller.py#L137)):
- **Baseline modes:** fixed solver, then validate. If invalid, an emergency hold (wait 10 steps).
- **LLM mode:**
  1. Cache lookup. On a hit, dry-run the cached directive.
  2. On a miss, or a failed dry-run (which goes to negative memory), call the LLM (attempt 1) and validate.
  3. If invalid, **one** retry with the violation text, then validate.
  4. If still invalid, the fixed fallback: windowed PBS, horizon 30, priority by distance to goal.
  5. If that's invalid too, an emergency hold.
- Valid directives are stored in the cache.

**Gotchas worth knowing**
- **LLM provider:** `Strategist` uses an OpenAI-compatible client with key `GROQ_API_KEY` or `OPENAI_API_KEY`, and the base URL **defaults to Groq** (`https://api.groq.com/openai/v1`). The default model is `qwen/qwen3.8-27b`. The current `.env` sets only `OPENAI_API_KEY`, so that key gets sent to Groq and fails. The cascade then tries local Ollama (`localhost:11434`) and finally a deterministic heuristic. Real runs very likely used the heuristic. Fix with `GROQ_BASE_URL=https://api.openai.com/v1` (the variable name is misleading) or a real `GROQ_API_KEY`.
- `instructor` is a dependency but **isn't imported**. Validation uses JSON mode plus Pydantic. CLAUDE.md says Instructor.
- The cache uses scikit-learn's `cosine_similarity`. CLAUDE.md allows only numpy and networkx for core logic.
- **The strategy cache persists across runs** in `runs/cache/strategy_cache.json` ([store.py:177](amr_repair/cache/store.py#L177), [203](amr_repair/cache/store.py#L203)). Results therefore depend on run history, not only the seed. That's why `latest_experiment` has cache hits matching `inc_002`, which isn't in that replay.
- The `delayed` state is overwritten by repairs (see 3.4), so real replays don't show delays.

---

## 12. Suggested order for frontend work

1. **Measure:** restore the FPS and frame-time readout and record a baseline on `demo` and a 200-robot run.
2. **Data honesty:** dynamic robot count; read `goals`; add `| null` and the extended metrics to the TS types; drop invented defaults and show "not recorded" instead; fix the selectors (scenario and mode) to reflect files that actually exist.
3. **Reconnect the UI:** incident list, incident diagnostics panel (it needs a DOM home), timestep readout, speed, playhead, axis, timeline markers, live robot details, a `.hidden` rule.
4. **Motion:** turn-before-move with a persistent heading (derived only from frames, so scrubbing stays stateless).
5. **Rendering compliance:** WebGPURenderer, a single DirectionalLight + HDRI, `RenderPipeline` with GTAO and a light bloom; remove the point, fill, rim and hemisphere lights; instance or merge the ceiling and lane geometry; make disruption visuals instanced or pooled.
6. **Layout:** decide whether to keep the docked layout or move to the overlay-on-canvas layout from CLAUDE.md; bring all text to 14 px or larger; unify CSS tokens and 3D colors.

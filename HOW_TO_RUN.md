# How to Open & Run This Project

## Project Overview

**Lifelong MAPF Simulator with LLM-Guided Path Repair & 3D Replay Viewer**

This project has two main components:

| Component | Tech Stack | Purpose |
|-----------|-----------|---------|
| **Python Pipeline** | Python 3.11, NumPy, NetworkX, OpenAI, Pydantic | MAPF simulation, disruption injection, LLM-guided repair, benchmarks |
| **3D Replay Viewer** | TypeScript, Three.js, Vite | Interactive 3D warehouse visualization of replay JSON files |

---

## Prerequisites

| Tool | Required Version | Check Command |
|------|-----------------|---------------|
| **Python** | ≥ 3.11 | `python3 --version` |
| **Node.js** | ≥ 18.x | `node --version` |
| **npm** | ≥ 9.x | `npm --version` |
| **uv** (Python package manager) | Latest | `uv --version` |

### Install `uv` (if not already installed)

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Or via pip
pip3 install uv
```

---

## Step 1: Clone / Open the Project

```bash
cd /path/to/MINOR-PROJECT-main
```

---

## Step 2: Install Python Dependencies

From the project root directory:

```bash
uv sync
```

This will:
- Create a `.venv` virtual environment with Python 3.11
- Install all dependencies listed in `pyproject.toml` (NumPy, NetworkX, OpenAI, Pydantic, scikit-learn, Trimesh, Instructor, etc.)

---

## Step 3: Run the Python Tests

Verify everything is working:

```bash
uv run pytest -q
```

Expected output: **32 passed** ✅

---

## Step 4: Install Viewer Dependencies

```bash
cd viewer
npm install
```

---

## Step 5: Start the 3D Replay Viewer

```bash
cd viewer
npm run dev
```

This starts a Vite dev server. Open your browser to:

> **http://localhost:5173/**

You will see the 3D warehouse visualization with:
- Animated AMR (Autonomous Mobile Robot) fleet
- Interactive timeline with incident markers
- Incident diagnostics panel (Sentinel → Cache → Dry-Run → LLM → Solver → Validator)
- Camera presets and playback controls

---

## Quick Start (All-in-One)

Run everything from the project root in two terminal tabs:

**Terminal 1 — Python pipeline (tests / experiments):**
```bash
cd /path/to/MINOR-PROJECT-main
uv sync
uv run pytest -q
```

**Terminal 2 — 3D Viewer:**
```bash
cd /path/to/MINOR-PROJECT-main/viewer
npm install
npm run dev
```

Then open **http://localhost:5173/** in your browser.

---

## Running Experiments & Simulations

### Run the full benchmark suite

```bash
uv run python -m amr_repair.experiments.run
```

### Run a demo simulation

```bash
uv run python -m amr_repair.loop.controller
```

> [!NOTE]
> LLM-guided experiments require an OpenAI API key. Set it via:
> ```bash
> export OPENAI_API_KEY="sk-..."
> ```

### Generated output
All simulation runs are saved as JSON replay files in the `runs/` directory, following the replay schema documented in [README.md](README.md).

---

## Keyboard Shortcuts (3D Viewer)

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` / `→` | Step backward / forward |
| `1` | Full warehouse camera |
| `2` | Incident camera |
| `3` | Robot follow camera |
| `N` / `P` | Next / Previous incident |
| `F` | Toggle fullscreen |
| `R` | Reset camera |
| `Esc` | Close panels |

---

## Project Structure

```
├── amr_repair/           # Python simulation & repair pipeline
│   ├── sim/              # Lifelong MAPF simulator (grid, agents)
│   ├── disrupt/          # Disruption injector
│   ├── sentinel/         # Incident detection & feature extraction
│   ├── cache/            # Strategy cache & negative memory
│   ├── llm/              # LLM strategist (Pydantic + Instructor)
│   ├── solvers/          # PIBT, LNS, Windowed PBS solvers
│   ├── validate/         # Deterministic plan validator
│   ├── loop/             # Closed-loop controller & logger
│   ├── experiments/      # Baselines, ablations, experiment runner
│   └── replay/           # Replay JSON exporter
├── viewer/               # 3D Three.js Replay Viewer (Vite + TypeScript)
│   ├── src/main.ts       # Main viewer application
│   ├── public/replays/   # Replay JSON files served to the viewer
│   └── public/models/    # 3D model assets (.glb)
├── tests/                # Pytest suite (32 tests)
├── maps/                 # MovingAI warehouse .map files
├── runs/                 # Simulation output replays
├── pyproject.toml        # Python project config & dependencies
└── uv.lock               # Locked Python dependency versions
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `uv: command not found` | Install uv: `pip3 install uv` or `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Python version mismatch | `uv sync` auto-downloads Python 3.11 — no manual install needed |
| `npm install` fails | Ensure Node.js ≥ 18: `node --version` |
| Viewer shows black screen | Check browser console for errors; ensure `viewer/public/replays/` has `.json` files |
| OpenAI API errors | Set `export OPENAI_API_KEY="sk-..."` before running LLM experiments |


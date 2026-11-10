# StrongholdCrusader (working repo name)

An original, single-player, browser-based 3D castle-siege RTS with a present-day
military setting. It plays on desktop and phones. It is inspired by the classic
castle-builder RTS genre and adds faster ~20-minute matches, an 8-minute
day/night cycle with stealth, and over-the-shoulder direct control of your
soldiers.

> The final game will ship under its own original name and assets. This repo
> name is a placeholder.

- **Design & technical plan:** [docs/PLAN.md](docs/PLAN.md)
- **Status:** Milestone **M0 (foundations + spikes)** is playable.

## Play locally

```bash
npm install
npm run dev        # http://localhost:5173
```

URL options: `?debug=1` shows FPS and sim timing. `?quality=low|high` forces
the render preset. `?seed=123` picks a different map.

## Controls (M0)

| | Desktop | Phone (landscape) |
|---|---|---|
| Select | Click, or drag a box. Double-click selects the same type. | Tap. Double-tap selects the same type. **▢ Box** toggles drag-select. |
| Move | Right-click the ground | Tap the ground |
| Camera | WASD / screen edges pan, wheel zooms, Q/E or right/middle-drag rotate | Drag pans, pinch zooms, twist rotates |
| Take control | **F** (WASD + mouse, LMB fire, RMB aim, Esc exits) | **Take control**, then left thumb moves, right thumb aims, **Fire**/**Aim** buttons |
| Other | Ctrl+1–9 / 1–9 groups, Space centers, H returns to base, P pauses | **Base**, **All**, **Time** (jump to dawn/day/dusk/night) |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm test` | Simulation unit tests (Vitest), including determinism and perf |
| `npm run preview` | Serve the production build |

## Deploying to Vercel

1. In Vercel: **Add New → Project →** import this GitHub repo.
2. Vercel detects **Vite** from `vercel.json`. Build is `npm run build`, output
   is `dist`.
3. Every push gets a preview URL, and the default branch is production.

## Code layout

```
src/sim/      Pure TypeScript simulation: map gen, flow fields, units, combat, clock (no DOM/three)
src/render/   Three.js renderer: terrain, structures, instanced soldiers, day/night, FX, cameras
src/input/    Mouse / keyboard / touch → camera and commands; virtual joystick
src/ui/       React HUD (zustand store)
src/game/     Game loop wiring sim + render + input + HUD
tests/        Vitest specs
docs/         Plan and design docs
```

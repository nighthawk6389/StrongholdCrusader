# StrongholdCrusader (working repo name)

An original, single-player, browser-based 3D castle-siege RTS with a present-day
military setting. It plays on desktop and phones. It is inspired by the classic
castle-builder RTS genre and adds faster ~20-minute matches, an 8-minute
day/night cycle with stealth, and over-the-shoulder direct control of your
soldiers.

> The final game will ship under its own original name and assets. This repo
> name is a placeholder.

- **Design & technical plan:** [docs/PLAN.md](docs/PLAN.md)
- **Status:** **M0** (foundations), **M1** (economy) and **M2** (fortifications & combat) are playable.
  Next up is **M3** (a skirmish AI opponent that builds its own base).

## Play locally

```bash
npm install
npm run dev        # http://localhost:5173
```

URL options: `?debug=1` shows FPS and sim timing. `?quality=low|high` forces
the render preset. `?seed=123` picks a different map.

## Game modes

- **Hold the Line:** six escalating waves attack from the east over about 15 minutes, two of them at night.
  Waves with combat engineers blow holes in your walls and gates. Lose your HQ or your Commander and it's over.
- **Sandbox:** no waves. Build at your own pace and skirmish with the hostile patrol.

The start screen picks the mode. You can also link straight to a mode with `?mode=hold` or `?mode=sandbox`.

## How to play

Grow your outpost:
- **Arrivals:** civilians arrive while **morale** is above 50 and there's free housing.
- **Production:** build lumber camps (near trees), a quarry (touching rock), orchards (on fertile ground by
  oases) and goat ranches.
- **Hauling:** workers physically carry goods to the nearest depot or ration store, so build stores near your
  producers.
- **Morale:** set **rations** and **taxes** from the morale panel. Food variety boosts morale, and running out
  of food or taxing hard drives people away.
- **Night:** work slows to about a third.
- **Fortify:**
  - Drag to draw **concrete walls**, add **watchtowers** and **gatehouses** (R rotates), and **stairs** so troops
    can climb up.
  - Troops on walls get extra range and take half damage.
  - Gatehouses open for your troops only.
- **Arm:** a **Scrap Yard** makes steel, and an **Arms Factory** turns it into rifles, machine guns, scoped rifles
  or breach kits for the **Armory**. The **Barracks** trains idle civilians with those weapons plus funds.
- **Troop types:**
  - Rifleman: all-rounder.
  - Machine Gunner: suppresses, so targets move and shoot worse.
  - Marksman: long range.
  - Combat Engineer: breach charges for walls and gates.

## Controls

| | Desktop | Phone (landscape) |
|---|---|---|
| Build | **B** or **Build**, pick a building, click to place (repeats), right-click/Esc to stop | **Build**, pick, tap the ground to position, **✓ Place** |
| Buildings | Click one for status, pause/resume, demolish (50% refund) | Tap one (with no soldiers selected) |
| Morale | Click the **Morale** pill: breakdown, rations, taxes | Tap the morale number |
| Walls | Drag along the ground | Tap the start, tap the end, **✓ Place** |
| Orders | Right-click: ground = move, **wall top = man it**, enemy = attack | With soldiers selected, tap the ground, a wall top or an enemy |
| Recruit | Click the **Barracks** | Tap the **Barracks** |
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
| `npm test` | Simulation unit tests (Vitest): economy, fortifications, combat, waves, determinism, perf |
| `HOLD_REPORT=1 npx vitest run tests/hold-report.test.ts --silent=false` | Prints a simulated Hold the Line match for balancing (add `GARRISON=1` to man the walls) |
| `npm run preview` | Serve the production build |

## Deploying to Vercel

1. In Vercel: **Add New → Project →** import this GitHub repo.
2. Vercel detects **Vite** from `vercel.json`. Build is `npm run build`, output
   is `dist`.
3. Every push gets a preview URL, and the default branch is production.

## Code layout

```
src/sim/      Pure TypeScript simulation: map gen, layered flow fields, units, economy, combat, waves (no DOM/three)
src/render/   Three.js renderer: terrain, structures, instanced soldiers, day/night, FX, cameras
src/input/    Mouse / keyboard / touch → camera and commands; virtual joystick
src/ui/       React HUD (zustand store)
src/game/     Game loop wiring sim + render + input + HUD
tests/        Vitest specs
docs/         Plan and design docs
```

# StrongholdCrusader (working repo name)

An original, single-player, browser-based 3D castle-siege RTS with a present-day
military setting. It plays on desktop and phones. It is inspired by the classic
castle-builder RTS genre and adds faster ~20-minute matches, an 8-minute
day/night cycle with stealth, and over-the-shoulder direct control of your
soldiers.

> The final game will ship under its own original name and assets. This repo
> name is a placeholder.

- **Design & technical plan:** [docs/PLAN.md](docs/PLAN.md)
- **Status:** **M0** (foundations), **M1** (economy), **M2** (fortifications & combat), **M3**
  (skirmish vs an AI commander), **M4** (night & stealth), **M5** (full direct control: aimed fire, gun
  towers, drones) and **M6a** (siege depth: vehicles, artillery, mines, ditches, fuel trenches, wire) are
  playable. Next up is **M6b** (AI personalities, maps, Commander's Trail, PMC hires).

## Play locally

```bash
npm install
npm run dev        # http://localhost:5173
```

URL options: `?debug=1` shows FPS and sim timing. `?quality=low|high` forces
the render preset. `?seed=123` picks a different map.

## Game modes

- **Skirmish vs Old Sarge:** a 1v1 against an AI commander who runs a real economy and builds a walled
  fortress. He trains a mixed army, mans his walls and launches assaults with engineers. Destroy his HQ or kill
  his Commander, and protect yours. Easy, Normal and Hard differ in reaction speed, attack timing and size, and
  a small starting bonus. He never cheats on vision.
- **Hold the Line:** six escalating waves attack from the east over about 15 minutes, two of them at night.
  Waves with combat engineers blow holes in your walls and gates, and the night waves bring special forces.
  The later waves bring armor: an armored car, then a tank, and finally two tanks and a howitzer. Lose your HQ
  or your Commander and it's over.
- **Sandbox:** no waves. Build at your own pace and skirmish with the hostile patrol.

The start screen picks the mode. You can also link straight to a mode with `?mode=skirmish&difficulty=normal`,
`?mode=hold` or `?mode=sandbox`.

## Saving

The game saves itself to your browser when you switch away from it (another tab or app, the lock screen, closing
the tab), when you reload the page, and every 30 seconds while you play. Open the same game link again, or press
**Continue** on the start screen, and you're back where you left off, paused. Starting a new game replaces the
save, and a finished match (win or lose) clears it. There's one save slot, kept per browser and device.

## How to play

Grow your outpost:
- **Arrivals:** civilians arrive while **morale** is above 50 and there's free housing.
- **Production:** build lumber camps (near trees), a quarry (touching rock), orchards (on fertile ground by
  oases) and goat ranches.
- **Hauling:** workers physically carry goods to the nearest depot or ration store, so build stores near your
  producers.
- **Morale:** set **rations** and **taxes** from the morale panel. Food variety boosts morale, and running out
  of food or taxing hard drives people away.
- **Night:** work slows to about a third. Turn on **night shifts** in the morale panel to keep working at
  full speed, at a morale cost.
- **Fortify:**
  - Drag to draw **concrete walls**, add **watchtowers** and **gatehouses** (R rotates), and **stairs** so troops
    can climb up.
  - Troops on walls get extra range and take half damage.
  - Gatehouses open for your troops only.
- **Trade:** a **Trade Post** buys anything at full price and sells your surplus for half.
- **Arm:** a **Scrap Yard** makes steel, and an **Arms Factory** turns it into rifles, machine guns, scoped rifles
  or breach kits for the **Armory**. The **Barracks** trains idle civilians with those weapons plus funds.
- **Troop types:**
  - Rifleman: all-rounder.
  - Machine Gunner: suppresses, so targets move and shoot worse.
  - Marksman: long range.
  - Combat Engineer: breach charges for walls and gates. Also finds and clears enemy mines and fills ditches.
  - AT Specialist: anti-tank rockets (launchers from the Arms Factory). The answer to armor; also dents walls
    and gates.
  - SF Operator: needs a night-ops kit. Has night vision, a silenced rifle and one demolition charge, is hard
    to spot in the dark, and climbs walls without stairs.

Fight at night:
- **Vision:** in daylight your lookouts see the whole map. At night you only see enemies near your troops and
  towers, or standing in light. Enemies you can't see aren't drawn and can't be targeted.
- **Light:**
  - **Floodlights** light a cone (R aims them).
  - **Searchlight towers** sweep a long beam.
  - Burning buildings light up their surroundings.
  - **Flares** ($15) light an area for 30 seconds: select soldiers, press **V** or **Flare**, then click.
- **Power:** lights and sensors need power. The HQ gives a little; a staffed **Generator** gives 12. The power
  gauge sits next to the resources.
- **Detection:**
  - **Motion sensors** catch anything that moves nearby, lit or not.
  - **K9 kennels** sniff out everyone close by, even operators lying still.
  - Unsilenced gunfire gives the shooter away for a few seconds.
- **Night vision:** take control of an SF Operator or a Marksman at night to see through their optics.

Siege warfare:
- **Fuel:** an **Oil Derrick** on an oil seep (the dark patches) pumps fuel for vehicles and fuel trenches.
- **Motor Pool:** builds vehicles from steel, fuel and funds, each crewed by an idle civilian.
  - **Armored Car:** fast, armored scout with a machine gun.
  - **Battle Tank:** heavy armor and a main gun that knocks down walls and gates.
  - **Howitzer:** stop it to deploy, then it lobs shells over walls at anything your side can see.
- **Armor:** rifles and machine guns barely scratch vehicles. AT rockets, tank guns, mines, charges and strike
  drones hurt them.
- **Traps and obstacles** (drag a line, like walls):
  - **Minefield:** hidden from the enemy; goes off under the first enemy to step on it.
  - **Anti-Tank Ditch:** nobody crosses it, but shots fly over. Enemy engineers can fill it in.
  - **Fuel Trench:** select it and **Ignite** (or hit it with a flare or an explosion). It burns anyone standing
    in it and lights up the night.
  - **Razor Wire:** slows enemy infantry to a crawl; vehicles flatten it.
- Old Sarge (Normal and up) builds a Motor Pool and brings tanks; on Hard, a howitzer too. He trains AT teams
  once you field armor.

Take direct control:
- **Any soldier:** press **F** (or tap **Take control**) and the rest of your selection follows you as a squad.
  Shots go where the crosshair is. Head hits do double damage (triple through a Marksman's scope), and wall
  parapets cover a defender's body but not their head. Magazines run dry, so reload (**R**). Engineers and
  operators plant charges by hand (**G**), operators climb walls by walking into them, and anyone can take the
  stairs up and down.
- **Gun Tower:** a watchtower with a heavy machine gun. It fires on its own while one of your soldiers is up top.
  Select it and take control to aim it yourself.
- **Searchlight:** take control to sweep the beam by hand.
- **Drone Bay:** launches **recon drones** (thermal camera; fly over walls and spot for your troops) and **strike
  drones** (dive onto a unit, building or wherever you point and explode; they need a breach kit). Drones run on
  batteries: they fly home to recharge when low, and crash if they run flat. Soldiers and gun towers shoot them
  down.
- Old Sarge builds gun towers by his gate and a drone bay. On Normal and Hard he sends strike drones at your gun
  towers and wall defenders.

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
| Take control | **F** on a soldier, drone, gun tower or searchlight: WASD + mouse, LMB fire (drone: dive), RMB aim/scope, R reload, G plant charge, V flare at the crosshair, N night vision, T slow motion, Esc/Tab exits | **Take control**, then left thumb moves, right thumb aims; **Fire**, **Aim**, **Reload**, **Charge** and **NVG** buttons |
| Flare | **V** or **Flare** with soldiers selected, then click (Esc cancels) | **Flare**, then tap |
| Other | Ctrl+1–9 / 1–9 groups, Space centers, H returns to base, P pauses | **Base**, **All**, **Time** (jump to dawn/day/dusk/night) |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm test` | Simulation unit tests (Vitest): economy, fortifications, combat, waves, AI, night & stealth, direct control, drones, determinism, perf |
| `HOLD_REPORT=1 npx vitest run tests/hold-report.test.ts --silent=false` | Prints a simulated Hold the Line match for balancing (add `GARRISON=1` to man the walls) |
| `AI_REPORT=1 DIFF=normal npx vitest run tests/ai-report.test.ts --silent=false` | Prints a 20-minute skirmish timeline of the AI against a passive player |
| `npm run preview` | Serve the production build |

## Deploying to Vercel

1. In Vercel: **Add New → Project →** import this GitHub repo.
2. Vercel detects **Vite** from `vercel.json`. Build is `npm run build`, output
   is `dist`.
3. Every push gets a preview URL, and the default branch is production.

## Code layout

```
src/sim/      Pure TypeScript simulation: map gen, layered flow fields, units, economy, combat, vision, drones, waves, AI (no DOM/three)
src/render/   Three.js renderer: terrain, structures, instanced soldiers, day/night, FX, cameras
src/input/    Mouse / keyboard / touch → camera and commands; virtual joystick
src/ui/       React HUD (zustand store)
src/game/     Game loop wiring sim + render + input + HUD
tests/        Vitest specs
docs/         Plan and design docs
```

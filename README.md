# Garrison Zero

An original, single-player, browser-based 3D castle-siege RTS with a present-day
military setting. It plays on desktop and phones. It is inspired by the classic
castle-builder RTS genre and adds faster ~20-minute matches, an 8-minute
day/night cycle with stealth, and over-the-shoulder direct control of your
soldiers.

> The game is called **Garrison Zero**. The repository keeps its old working name
> (StrongholdCrusader) for now; rename it on GitHub before any public launch.

- **Design & technical plan:** [docs/PLAN.md](docs/PLAN.md)
- **Release checklist (0.9.0 launch candidate):** [docs/RELEASE.md](docs/RELEASE.md)
- **Status:** 0.9.0 launch candidate. Every milestone from M0 (foundations) to M7c (branding, polish,
  release hardening) is done; what's left before going public is on the release checklist (name check,
  repository rename, Vercel and domain).

## Play locally

```bash
npm install
npm run dev        # http://localhost:5173
```

URL options: `?debug=1` shows FPS and sim timing. `?quality=low|high` forces
the render preset, and `?post=0|1` switches the high-quality lighting effects. `?seed=123` reshuffles the map's details.

## Game modes

- **Tutorial:** fourteen short guided steps, from moving the camera to storming an enemy outpost: build an
  economy, wall in, man the walls, train a soldier, take direct control, set rations and taxes, light up for the
  night. Each step completes when you do it (or skip it). A card shows the current step; on small phones it tucks
  away while a panel is open.
- **Commander's Trail:** eight stages against tougher and tougher commanders, each on its own map: Boot Camp
  (Old Sarge, Easy), Open Sands (Jackal), Black Gold (The Broker), The Pass (The Engineer), Lights Out
  (Nightshade), Iron Duchess (Duchess Varga, Hard), The Long Siege (The Quartermaster, Hard) and The Fortress
  (Warden, Hard). Win a stage to unlock the next; progress is kept in your browser.
- **Skirmish:** a 1v1 against an AI commander of your choice, on a map of your choice. Every commander runs a
  real economy, builds a walled fortress, mans the walls and attacks. Destroy their HQ or kill their Commander,
  and protect yours. Easy, Normal and Hard differ in reaction speed, attack timing and size, and a small
  starting bonus. They never cheat on vision.
  - **Old Sarge** (balanced veteran): walls up early, steady infantry pushes, a tank or two.
  - **Jackal** (raider): light walls, armored cars, raiding parties on your farms and work camps from the
    first minutes, early and frequent attacks.
  - **The Engineer** (sapper): razor wire, a minefield, anti-tank ditches and a fuel trench outside the front
    wall (lit when you walk into it), howitzers and a Breacher.
  - **The Broker** (trader): high taxes, sells everything, hires PMC teams when the cash piles up.
  - **Warden** (fortress): gun towers on every wall, extra searchlights, a big garrison, late heavy assaults
    with tanks.
  - **Nightshade** (night raider): special forces. Twice a night they slip over your walls to blow up your
    generators and gun towers, and the main attacks wait for darkness.
  - **Duchess Varga** (iron fist): the motor pool comes first: tanks, armored cars and Breachers, again and
    again. Her first tank is **Rosie**: she announces Rosie when she leads an attack, takes it personally when
    you knock her out, and rolls out Rosie the Second (Third, …) as soon as the next tank is ready.
  - **The Quartermaster** (economic turtle): the biggest economy on the map behind two rings of walls, upgrades
    everything, then a late push with tanks and guns.
  - Every commander talks (opening line, attacks, losses, hits on their HQ, win or lose) and has a few
    signature catchphrases ("Mind the wire, kid.", "Knock knock. It's breakfast.", "Lights out."…). What they
    say never affects how the match plays out.
- **Maps** (skirmish), all mirrored so both sides start alike, with a new layout every game: **Oasis Basin**
  (balanced), **Dune Sea** (open dunes, scarce timber), **Rocky Pass** (two ridges, three passes), **Oil Fields**
  (oil everywhere, little farmland), **Ruined Town** (a bombed-out town in the middle: broken walls block movement
  and bullets, and quarries can salvage their concrete) and **Salt Flats** (dead flat, with water, wood and stone
  out on the north and south edges).
- **How the AI plays** (Normal and up): it scouts your base and sizes up your army from what it has actually
  seen (no map hacks), swings its main force round to the side of your base with the fewest guns while a few
  soldiers feint at the gate, attacks early when it clearly outnumbers you, keeps feeding a winning assault and
  pulls a broken one back to regroup, sends special forces over your walls at night to blow up your generators
  and gun towers, hunts your Commander if it catches it in the open (with strike drones too), answers your
  artillery with mortar pits, puts idle hands to work on more scrap yards and factories, and juggles taxes and
  rations to squeeze the most money out of its people without letting morale crash. Hard attacks earlier, more
  often and harder.
- **Hold the Line:** six escalating waves attack from the east over about 15 minutes, two of them at night.
  Waves with combat engineers blow holes in your walls and gates, and the night waves bring special forces.
  The later waves bring armor: an armored car, then a tank, and finally two tanks and a howitzer. Lose your HQ
  or your Commander and it's over.
- **Sandbox:** no waves. Build at your own pace and skirmish with the hostile patrol.

The start screen picks the mode. You can also link straight to a match: `?mode=skirmish&ai=jackal&map=pass&difficulty=hard`
(`ai`: sarge, jackal, engineer, broker, nightshade, varga, quartermaster, warden; `map`: basin, dunes, pass, oilfields), a trail stage with
`?mode=skirmish&trail=0` (0–7), the tutorial with `?mode=tutorial`, `?mode=hold` or `?mode=sandbox`.

## Sound, settings and offline play

- **Sound:** every sound is synthesized live in the browser (no audio files): gunfire that differs by weapon,
  explosions, incoming shell whistles, mortars, building, fire, radio chatter for enemy taunts, and alerts. Sounds
  are placed in stereo and fade with distance from where the camera is looking (or from the soldier you're
  controlling). Background music shifts from a warm day pad to a darker night one and a pulse rises with the
  fighting. Sound starts on your first click or tap (browsers require it).
- **Settings** (**⚙** on the start screen and in game): master, effects and music volume; graphics quality
  (auto, low, high) and, on high, lighting effects (ambient occlusion, glow, colour grading); camera pan and rotate speed; edge scrolling; look sensitivity and inverted look for direct
  control; and whether the help card shows when a game starts. Settings are saved in your browser.
- **Offline and install:** after one visit the game is cached and loads without a network. On phones, use "Add
  to Home Screen" (or the browser's install option) to get a full-screen app icon.

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
- **Where to build:** farms, work sites (lumber camps, quarries, scrap yards, oil derricks) and stores (depots,
  ration stores) can go anywhere on the map, however far the resources are. Everything else must stay within
  40 tiles of your HQ.
- **Hauling:** workers physically carry goods to the nearest depot or ration store, so build stores near your
  producers. A worker who can't reach a store tries the next nearest one.
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
  - **Flares** ($15) light an area for 30 seconds: select soldiers, press **V** or **Flare**, then click. You
    hold up to 3 and get another one every minute (the count is on the Flare button).
- **Power:** lights and sensors need power. The HQ gives a little; a staffed **Generator** gives 12. The power
  gauge sits next to the resources.
- **Detection:**
  - **Motion sensors** catch anything that moves nearby, lit or not.
  - **K9 kennels** sniff out everyone close by, even operators lying still.
  - Unsilenced gunfire gives the shooter away for a few seconds.
- **Night vision:** take control of an SF Operator or a Marksman at night to see through their optics.

Upgrades: select a building and press **⬆** to improve it (a gold chevron marks each level).
- Housing → Apartment block (+6 housing). Depots, ration stores and the armory store 80% more.
- Lumber camps, quarries, scrap yards, orchards, ranches, arms factories and derricks work 30% faster (some
  have a second level).
- Generators get a turbine (+8 power); floodlights and searchlights reach further.
- Gatehouses get steel doors and gun towers get armor plating; a watchtower can be turned into a gun tower.
- The HQ can be fortified (tougher, more storage, more power).

Siege warfare:
- **Fuel:** an **Oil Derrick** on an oil seep (the dark patches) pumps fuel for vehicles and fuel trenches.
- **Motor Pool:** builds vehicles from steel, fuel and funds, each crewed by an idle civilian.
  - **Armored Car:** fast, armored scout with a machine gun.
  - **Battle Tank:** heavy armor and a main gun that knocks down walls and gates.
  - **Howitzer:** stop it to deploy, then it lobs shells over walls at anything your side can see, from a little
    beyond gun-tower range (30 tiles).
  - **Breacher:** an armored dozer. It plows through minefields (mines in front of the blade are shoved aside),
    fills an anti-tank ditch in a second or two, and pushes an **assault ramp** against an enemy wall (two per
    Breacher). Infantry climb the ramp onto the wall top and down the defenders' own stairs. Order it to attack
    a wall, or drive it there yourself and press **G**. Destroy an enemy ramp to close the way.
- **Mortar Pit:** the answer to artillery. It fires on its own: first at any enemy gun that has shelled within
  its reach (its radar plots the gun from its shells, even in the dark), then at enemies your side can see.
  It outranges a howitzer a little. Upgrade it with a second tube to fire faster.
- **Contracts Office:** hire a ready-made PMC team for cash: a fire team, machine gunners, snipers, sappers,
  an AT team or an armored car. They turn up at once and need no civilians or weapons, but cost two to three
  times as much, and you can sign one contract a minute.
- **Armor:** rifles and machine guns barely scratch vehicles. AT rockets, tank guns, mines, charges and strike
  drones hurt them.
- **Traps and obstacles** (drag a line, like walls):
  - **Minefield:** hidden from the enemy; goes off under the first enemy to step on it.
  - **Anti-Tank Ditch:** nobody crosses it, but shots fly over. Enemy engineers can fill it in.
  - **Fuel Trench:** select it and **Ignite** (or hit it with a flare or an explosion). It burns anyone standing
    in it and lights up the night.
  - **Razor Wire:** slows enemy infantry to a crawl; vehicles flatten it.
- AI commanders (Normal and up) build a Motor Pool and bring armor, and train AT teams once you field yours.

Take direct control:
- **Any soldier:** press **F** (or tap **Take control**) and the rest of your selection follows you as a squad.
  Shots go where the crosshair is. Head hits do double damage (triple through a Marksman's scope), and wall
  parapets cover a defender's body but not their head. Magazines run dry, so reload (**R**). Engineers and
  operators plant charges by hand (**G**), operators climb walls by walking into them, and anyone can take the
  stairs up and down.
- **Gun Tower:** a watchtower with a heavy machine gun. It fires on its own while one of your soldiers is up top.
  Select it and take control to aim it yourself. To crack one: snipe its crew, or hit it with AT rockets, tank
  shells, artillery, charges or strike drones (all do 75% extra damage to gun emplacements).
- **Searchlight:** take control to sweep the beam by hand.
- **Drone Bay** (up to 4 drones): launches **recon drones** (thermal camera that sees through stealth and
  darkness; they fly over walls and spot for your troops) and **strike drones** (dive onto a unit, building or
  wherever you point and explode). Drones run on batteries: they fly home to recharge when low, and crash if
  they run flat. A lone soldier struggles to hit one; a squad or a gun tower will bring it down.
- AI commanders build gun towers by their gate (Warden: on every wall) and a drone bay. On Normal and Hard they
  send strike drones at your gun towers and wall defenders.

## Controls

| | Desktop | Phone (landscape) |
|---|---|---|
| Build | **B** or **Build**, pick a building, click to place (repeats), right-click/Esc to stop | **Build**, pick, tap the ground to position, **✓ Place** |
| Buildings | Click one for status, pause/resume, demolish (50% refund) | Tap one (with no soldiers selected) |
| Morale | Click the **Morale** pill: breakdown, rations, taxes | Tap the morale number |
| Walls | Drag along the ground | Tap the start, tap the end, **✓ Place** |
| Orders | Right-click: ground = move, **wall top = man it**, enemy = attack | With soldiers selected, tap the ground, a wall top or an enemy |
| Recruit | Click the **Barracks** | Tap the **Barracks** |
| Select | Click, or drag a box. Double-click selects the same type. In a mixed selection, click a type chip to keep only those, or its **×** to drop them. | Tap. Double-tap selects the same type. **▢ Box** toggles drag-select. Type chips work the same. |
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
| `npm test` | Simulation unit tests (Vitest): economy, fortifications, combat, waves, AI and its personalities, maps, night & stealth, direct control, drones, vehicles and traps, PMC hires, saves, determinism, perf |
| `HOLD_REPORT=1 npx vitest run tests/hold-report.test.ts --silent=false` | Prints a simulated Hold the Line match for balancing (add `GARRISON=1` to man the walls) |
| `AI_REPORT=1 DIFF=normal npx vitest run tests/ai-report.test.ts --silent=false` | Prints a 20-minute skirmish timeline of the AI against a passive player |
| `PERSONALITY_REPORT=1 [WHO=jackal,warden] [MAPS=basin,pass] [VS=sarge] npx vitest run tests/personality-report.test.ts --silent=false` | Each AI commander on each map against a passive player (or, with `VS`, an AI defender): result, first assault, losses, raids, hires, traps, gun towers, vehicles |
| `npm run preview` | Serve the production build |

## Deploying to Vercel

1. In Vercel: **Add New → Project →** import this GitHub repo.
2. Vercel detects **Vite** from `vercel.json`. Build is `npm run build`, output
   is `dist`.
3. Every push gets a preview URL, and the default branch is production.

## Code layout

```
src/sim/      Pure TypeScript simulation: map gen, layered flow fields, units, economy, combat, vision, drones, waves, AI (no DOM/three)
src/render/   Three.js renderer: shader-blended ground (ground.ts), terrain/water/rocks, structures,
              instanced soldiers, day/night and sky, particles, post-processing (post.ts), cameras
src/input/    Mouse / keyboard / touch → camera and commands; virtual joystick
src/ui/       React HUD (zustand store)
src/game/     Game loop wiring sim + render + input + HUD
tests/        Vitest specs
docs/         Plan and design docs
```

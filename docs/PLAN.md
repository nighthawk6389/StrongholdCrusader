# Modern Castle-Siege RTS: Game Design & Technical Plan

> **Status:** v0.2. Core decisions are locked (see [§0.1](#01-decision-log)).
> Still open: the final name and the asset budget (see [§9](#9-open-questions)).
>
> **Working title:** _TBD_ (see [§2.1](#21-name-ip-and-originality)). This doc
> says "the game" for now.

---

## 0. TL;DR

A **single-player** browser 3D real-time strategy game, playable on **desktop
and phones** and deployed on Vercel. It keeps the core loop of the classic
castle-sim RTS genre: grow a population, keep it happy, run production chains,
arm your troops and build a fortress, then break the enemy's fortress. The
setting is **present-day military**, with fictional factions and places. On
top of that core loop it adds three pillars:

1. **Faster pacing.** Matches target **about 20 minutes**.
2. **Day/night with real stealth.** An **8-minute cycle**. Light, noise and
   sensors decide what each side can see. Night slows the economy unless you
   run powered night shifts.
3. **Take direct control.** Possess a unit and fight it yourself in an
   **over-the-shoulder** third-person view while the rest of your army keeps
   following orders.

**Stack:** TypeScript, Vite, React (HUD only), Three.js (WebGL2), and a
fixed-tick, command-driven simulation in plain TypeScript with flow-field
pathfinding. It's a static site on Vercel with no backend.

### 0.1 Decision log

| # | Topic | Decision |
|---|---|---|
| 1 | Setting | **Present day.** Fictional factions, places and commanders. Generic gear names (no real brands). |
| 2 | Art style | **Stylized low-poly 3D.** Procedural code-built placeholders now. Final asset source still open (Q-A). |
| 3 | Unit control | **Direct control, over-the-shoulder camera, single-player.** |
| 4 | Multiplayer | **None.** Single-player vs AI only. No servers, relay or accounts. |
| 5 | Economy | **Faithful but trimmed.** About 10 resources, workers physically haul, trucks help. |
| 6 | Match length | **About 20 minutes.** |
| 7 | Air | **Drones only.** No helicopters or aircraft. |
| 8 | Day/night | **8-minute full cycle.** Night slows the economy unless buildings are powered with night shifts on. |
| 9 | Platform | **Desktop and phones.** Touch is a first-class input, not an afterthought. |
| 10 | Budget/assets | Open. Free vs paid examples are in §4.1. |
| 11 | Process | **Claude drives end to end.** Each milestone is pushed to the branch, and Vercel preview URLs are used for playtesting. |

---

## 1. What made the original great (the pillars to keep)

| Pillar | Why it mattered | Our version |
|---|---|---|
| **Popularity economy** | Peasants arrive or leave based on popularity (rations, food variety, taxes, ale, religion, "fear factor"). Every decision trades happiness against output. | **Morale** with modern drivers (§3.2) |
| **Physical logistics** | Workers walk goods to the stockpile and processors. Base layout matters, and raiding supply lines works. | Kept, plus **haul trucks** and **forward depots** |
| **Equip-to-recruit** | Troops need produced weapons plus gold plus a peasant. Your industry decides your army. | Kept as is. It is the strategic heart. |
| **Fortifications with height** | Walkable walls and towers give range and protection. Gates, moats, pitch ditches, killing pits. | Concrete walls, towers, checkpoints, AT ditches, minefields, fuel trenches |
| **Siege as a puzzle** | Rams, trebuchets, siege towers, ladders and tunnellers each solve a different problem. | Modern equivalents (§3.4) |
| **The Lord dies, you lose** | Assassinations and last stands | **Commander** unit and HQ |
| **AI personalities** | Memorable rivals with distinct castles and taunts | **Original** characters (§3.8) |
| **Desert / oasis maps** | Scarce fertile land creates map control | Scarce water and fertile land, plus oil fields |

---

## 2. Concept & setting

### 2.1 Name, IP and originality

- The game needs **its own name, characters, art, audio and maps**.
  "Stronghold" is a trademark of its publisher. We share genre mechanics only,
  never its name, AI lords, assets or maps.
- The repo can keep its name while private. Rename it before any public launch.
- Working-title ideas: **Bastion Protocol**, **Nightwall**,
  **Hold the Line: Night Ops**, **Fortline**, **Garrison Zero**,
  **Iron Perimeter**.

### 2.2 Setting (decided: present day)

- Present-day hardware (assault rifles, MBTs, quadcopter drones, NVGs,
  thermal optics) with **generic names**.
- **Fictional region and factions**: rival commanders holding fortified
  enclaves around oases, aquifers and oil fields in a lawless desert
  borderland. No real countries, conflicts or insignia.
- Tone: tense but not gory (T-rated feel), with dry humour in AI commander
  taunts.

---

## 3. Core gameplay design

### 3.1 Match flow & pacing (target ≈20 min)

| Phase | Time | What happens |
|---|---|---|
| Opening | 0–4 min (day 1) | Expand the economy from a pre-built core, claim fertile and oil tiles, first walls |
| Build-up | 4–8 min (night 1 ≈ 4:30–7:30) | First raids. Scouting with drones. Night shifts or rest. |
| Mid-game | 8–14 min (day 2 → night 2) | Armies clash. First real siege attempts. Night stealth raids on power and supply. |
| Climax | 14–20 min (day 3) | Decisive siege, or the Commander is killed |

| Lever | Change vs. the classic formula |
|---|---|
| Start state | A pre-built core: HQ, depot, ration store, 2 housing blocks, 8 civilians and starting stock |
| Population inflow | Civilians arrive in groups of 2–4. The rate scales with morale. |
| Chains | At most 2 steps (ore → steel mill → **steel**; steel → small-arms factory → **rifles**) |
| Hauling | Larger loads. **Haul trucks** for remote producers. Forward depots. |
| Timings | Build and recruit times are about 30–40% of the classic ones. Single-player speed control from 0.5× to 3×. |
| Scale | Smaller maps (≈128×128 tiles for 1v1, up to 192×192 for 4 players). Population caps around 120 per side. |
| QoL | Build queues, rally points, control groups, auto-repair, **wall blueprints** (save and stamp designs), auto-buy missing inputs |

### 3.2 Economy

> **Implemented in M1** (numbers live in `src/sim/structures.ts` and `src/sim/economy.ts`):
> - **Morale:** changes by (sum of factors) / 20 per second.
>   - Rations: −8 / −3 / +2 / +5 / +8.
>   - Food variety: +2 per extra food type.
>   - Taxes: +5 bribe … −9 extortionate.
>   - Overcrowding: −4.
> - **Arrivals:** every 10 s at morale 50, speeding up to every 3 s at 100.
> - **Daytime throughput** with a store nearby (`tests/balance.test.ts`), per building:
>   - Lumber camp: ~10 timber/min.
>   - Quarry: ~8 concrete/min.
>   - Orchard: ~7 produce/min.
>   - Goat ranch: ~4 meat/min.
> - **Consumption:** 24 people on normal rations eat 12 food/min.

**Population & housing.** Civilians arrive at the **Arrivals Hub** (the
campfire analog). Housing blocks raise the cap. Idle civilians become workers
or recruits.

**Morale (0–100).** Above 50, people arrive. Below 50, they leave.

| Driver | Mechanic |
|---|---|
| Rations | None / Half / Normal / Extra / Double. Each step up uses more food and gives more morale. |
| Food variety | +morale per distinct food type in the ration store (bread, meat, produce) |
| Taxes | Bribe … Normal … Extortionate. Funds versus morale. |
| Coffee (ale/inn analog) | Coffee farm → roastery → **canteen** coverage |
| Civic (religion analog) | Community hall and broadcast station coverage |
| **Security posture vs perks** (fear-factor analog) | **Strict** (CCTV, curfews, checkpoints): +productivity, −morale, −troop effectiveness. **Perks** (parks, gyms, memorials): +morale, +troop effectiveness, −productivity. A −5…+5 dial. |
| Night shifts | Powered and lit buildings keep producing at night, at a morale cost |
| Events | Fire, power outage, disease (clinic), raids on housing |

**Resources (≈10):**

| Category | Resources | Chain |
|---|---|---|
| Materials | Timber, Concrete, Steel, Fuel, Components | Lumber camp. Quarry → cement plant. Ore mine → steel mill. Oil derrick → refinery. Salvage yard / market (components). |
| Food | Bread, Meat, Produce | Grain farm → mill → bakery. Ranch. Orchard. Fertile land only near water. |
| Morale goods | Coffee | Coffee farm → roastery → canteen |
| Energy | **Power** (a flow) + batteries | Diesel generator (burns fuel), **solar (daytime only)**, battery bank, substations |
| Currency | Funds | Taxes, market |
| Gear | Rifles, MGs, Launchers, Body armor, NV kits, Explosives | §3.4 |

**Building mapping (classic → ours):** Keep → Command HQ. Campfire → Arrivals
Hub. Hovel → Housing block. Stockpile/Granary → Supply depot / Ration store.
Woodcutter/Quarry/Iron mine/Pitch rig → Lumber camp / Quarry + cement plant /
Ore mine + steel mill / Oil derrick + refinery. Hops/Brewery/Inn → Coffee
farm / Roastery / Canteen. Chapel → Community hall. Apothecary → Clinic.
Weapon workshops → Small-arms factory, Ordnance plant, Armor works,
Electronics lab, Vehicle plant. Armoury/Barracks → Armory/Barracks. Mercenary
post → **PMC Contracts Office**. Siege tent → Motor pool. Dog cage → K9
kennel. New: power plant, solar field, battery bank, substation, radar,
sensor posts, floodlights.

### 3.3 Fortifications

Everything sits on a **tile grid** with **height levels**.

- **Walls:**
  - Sandbag line (low, no walkway).
  - Concrete wall (walkable top).
  - Thick concrete wall.
  - HESCO line.
  - **Stairs / access towers** to reach wall tops.
- **Towers:**
  - Watchtower.
  - Bunker.
  - **Fortified tower** with an HMG, mortar, AT launcher or AA gun emplacement.
- **Gates:** small and large checkpoint gates. They auto-lock when enemies
  are near.
- **Obstacles:**
  - AT ditch (moat analog). Engineers dig it and enemy engineers can fill it.
  - Tank traps.
  - Razor wire.
- **Traps:**
  - Minefields (killing-pit analog). Hidden until detected.
  - **Fuel trench** (pitch-ditch analog). Ignite it with incendiaries or
    flares.
  - Claymores.
- **Detection & light:**
  - Floodlights.
  - **Rotating searchlights**, which reveal anything in the beam.
  - Motion sensors, thermal cameras, CCTV.
  - Radar (detects drones).
  - K9 kennel.
- **Powered defenses:** auto-turrets and counter-drone guns. A blackout
  disables them.

### 3.4 Military roster

Every unit needs **civilian + gear + funds**.

**Infantry (Barracks)**

| Unit | Role | Classic analog | Strong vs | Weak vs |
|---|---|---|---|---|
| Militia | Cheap filler, digs/fills ditches | Spearman / slave | — | Everything |
| Rifleman | Backbone | Archer / maceman | Infantry | MGs, armor |
| Machine gunner | **Suppression** | Archer volleys | Massed infantry | Snipers, mortars |
| Marksman | Long range, high damage | Crossbowman | Wall defenders | Rushes |
| AT specialist | Anti-vehicle, anti-structure | — | Tanks, gates, bunkers | Infantry |
| Grenadier | Area denial, clears wall tops | Fire thrower | Entrenched troops | Range |
| Heavy assault | Armored breacher | Swordsman / pikeman | Close quarters, gates | AT, snipers |
| Combat engineer | Ladders/breach charges, ditches, mines, repair | Engineer + ladderman + tunneller | Obstacles | Combat |
| Medic | Heals infantry | — | — | — |

**Special Forces (SF Compound, capped at about 6)**

The analog of the original's wall-climbing, hidden assassins.

| Unit | Role |
|---|---|
| **SF operator** | NVG, suppressed weapons (no noise ping). **Climbs walls.** Plants C4 on gates, generators and turrets. Stealthed in the dark. |
| **Ghillie sniper** | Invisible when stationary and unlit. Thermal optic. |
| **EW specialist** | Jams sensors, radar, drones and turrets in a radius |
| **K9 handler** | Detects stealth units and mines |
| **Drone operator** | Recon quadcopter (directly flyable) or a one-shot loitering munition. Countered by EW, radar, counter-drone guns and AA. |

**Vehicles (Motor pool, need steel + fuel)**

| Vehicle | Classic analog |
|---|---|
| Haul truck | — (logistics) |
| Armored recon car | Horse archer |
| APC | — (carries a squad) |
| **Breaching vehicle** (wall ramp, mine plow, ditch filler) | Siege tower |
| Main battle tank | Battering ram + knight |
| Mortar carrier | Catapult |
| Towed howitzer (must deploy) | Trebuchet |
| Armored dozer / shield team | Mantlet |
| Counter-drone / AA vehicle | — |

**No helicopters or aircraft.** Drones are the only air units, and they are
fragile and counterable, so walls stay meaningful.

**Commander.** A strong hero unit. If the Commander dies, you lose. Abilities:
rally, a flare barrage, and one off-map strike per match.

**PMC Contracts Office.** Instant hires for funds (the mercenary analog).

### 3.5 Combat model

- **Line of sight** on the grid. Walls block it, and height grants range and
  vision bonuses.
- **Cover:** sandbags, walls and rubble reduce damage. Wall tops give strong
  cover.
- **Suppression:** sustained fire lowers accuracy and speed, and pinned
  infantry can't advance.
- **Projectiles:** small arms resolve as near-instant traces. Mortars and
  howitzers are ballistic with travel time and scatter. Fire spreads on
  flammable tiles.
- **Morale in combat:** the security-posture dial modifies troop
  effectiveness.

### 3.6 Day/night & stealth

**Cycle: 8 minutes.** Day 4:30 → dusk 0:30 → night 2:30 → dawn 0:30. A 20-minute
match therefore sees about 2.5 cycles and two full nights. Per-match options:
cycle on/off, start time, eternal night.

**Visibility model.** Grid-based, and the same rules for player and AI (no
cheating).

- Each tile has a **light level**: the sun plus floodlights, searchlight cones,
  fires, flares, muzzle flashes and headlights.
- Each unit has **sight**: full range by day, about 35% in darkness unless it
  has **NVG** or **thermal**.
- Each unit has **signatures**: visual (lit or unlit, moving or still, camo),
  thermal and noise.
- **Detection** is the observer's capability against the target's signature,
  given the light level and range.
- **Noise pings:** unsuppressed fire and explosions reveal the shooter on the
  enemy minimap for a few seconds.
- **Flares and illumination rounds** light an area for about 30 s.

**Night economy.** Workers rest at night, so production drops to about 30%.
Powered and lit buildings with **night shifts** on keep working at a morale
cost. Solar produces nothing at night.

**Emergent play:**
- Cut the substation, and lights, turrets and sensors die. SF climb the wall
  and open the gate for the tanks.
- Searchlights become sniper priority targets.
- Defenders answer with dogs, flares and thermals.

**Rendering:** the simulation's tile light grid becomes a low-resolution
**light texture** that drives terrain and unit shading and the fog of war.
Only a handful of real dynamic lights are used (searchlights, the nearest
fires, the possessed unit's flashlight), which keeps it cheap on phones.

### 3.7 Direct control (over-the-shoulder)

- Select an eligible unit and press **F** (desktop), or tap **Take control**
  (phone). The camera swoops to an over-the-shoulder view.
- **Eligible units:** riflemen, marksmen, SF operators, **wall gun /
  searchlight emplacements**, tanks, recon drones, and the Commander.
- **Desktop controls:** WASD + mouse (pointer lock), LMB fire, RMB aim/zoom,
  N for night vision, Esc or Tab to return.
- **Phone controls:** left virtual stick to move, drag on the right half to
  aim, on-screen fire, aim, NVG and exit buttons.
- **The rest of the army keeps executing orders.** The possessed unit's
  squad follows you.
- **Hits resolve in the simulation**: a raycast against simplified hitboxes,
  so aim matters (headshots crit). There are no hidden stat buffs.
- Single-player, so time can optionally slow to 50% while you're in control
  (a setting).

### 3.8 AI opponents (original personalities)

The AI is layered:
- **Strategic:** build-order templates plus utility scoring.
- **Base layout:** hand-authored **fortress blueprints** per personality.
- **Tactical:** waves, siege plans, night-timed raids.
- **Unit:** cover, retreat, focus fire.

Difficulty comes from reaction time, efficiency and template quality, never
vision cheats.

| Name | Style |
|---|---|
| **Old Sarge** | Balanced infantry, beginner-friendly |
| **The Quartermaster** | Economic turtle, triple walls, late tank push |
| **Jackal** | Early rushes and raids on farms |
| **Nightshade** | SF night raids, EW, kills your power |
| **The Engineer** | Minefields, fuel trenches, howitzers |
| **Duchess Varga** | Armor-heavy, relentless breaching |
| **The Broker** | Trader who buys PMC armies |
| **Warden** | Searchlight-and-turret fortress |

### 3.9 Game modes (single-player)

1. **Skirmish** vs 1–5 AI commanders (teams, map, start resources, day/night
   options).
2. **Siege scenarios:** attack or defend a pre-built base.
3. **Commander's Trail:** an escalating ladder of AI challenges.
4. **Free build** sandbox.
5. _(later)_ Map editor and blueprint import/export as files.

---

## 4. Art, audio & UX

- **Style:** stylized low-poly 3D with flat-shaded materials and a limited
  palette. It reads well at RTS zoom and in the over-the-shoulder view, and it
  is cheap on phones. Bloom on lights at night.
- **Camera:** a high-angle RTS camera with rotation and zoom.
- **Desktop input:**
  - Classic RTS: left-click or drag to select, right-click to order.
  - WASD/edge pan, wheel zoom, Q/E rotate, middle-drag rotate.
  - Control groups 1–9.
- **Phone input (landscape):**
  - One-finger drag pans.
  - Pinch zooms, two-finger twist rotates.
  - Tap selects or orders.
  - A **Select** toggle turns drag into box-select.
  - Double-tap selects all of a type.
  - Long-press opens a context menu.
  - A bottom sheet holds build menus.
  - Large hit targets.
- **Audio:** positional SFX, a dynamic music layer (calm day → tense night →
  combat), short commander taunts.

### 4.1 Asset options: free vs paid (decision Q-A)

**Free:**

| Source | What you'd get | License notes |
|---|---|---|
| **Procedural, code-built** (what M0 uses now) | Clean minimalist soldiers, vehicles and buildings generated in TypeScript. Perfectly consistent, tiny download, ideal for phones. | Ours |
| **Quaternius:** Toon Shooter Game Kit, Universal Animation Library | Rigged soldiers with ~17 animations, guns, props. A large CC0 animation library. Cartoonier look. | CC0 |
| **Kenney** (City, Car, Tower Defense, Survival kits; audio packs) | Buildings, vehicles, props, UI and SFX. Little dedicated 3D military. | CC0 (optional $19.95 All-in-1 bundle) |
| **KayKit / Poly Pizza** | Misc low-poly props | KayKit CC0. Poly Pizza varies per model (CC0 or CC-BY). |
| **Mixamo** | Hundreds of humanoid animations to retarget onto soldiers | Royalty-free in games. Don't redistribute the raw files. |
| **Sonniss GDC bundle**, Kenney audio | Many GBs of pro SFX (some weapons and vehicles) | Royalty-free; check each year's terms |

**Paid:**

| Source | What you'd get | Typical cost | License notes |
|---|---|---|---|
| **Synty POLYGON Military / War / Battle Royale** | A large, consistent low-poly modern-military set: soldiers, vehicles, bases, walls, props. The best match for our style. | Roughly $50–150 per pack, often discounted (check current price) | Commercial games allowed, per-seat. Editing is OK, reselling assets isn't. **Confirm the EULA permits browser games**, where files are downloadable. |
| CGTrader / itch.io low-poly military packs | Individual soldiers and tanks to fill gaps | $5–50 each | Varies per item |
| Paid SFX libraries (e.g. Sonniss military/vehicle) | Authentic weapons and vehicles | $30–150 | Royalty-free |
| Commissioned artist | Bespoke hero units and a unique identity | Hundreds to thousands | Work-for-hire |

**Important if we go paid:** paid asset files **must not be committed to a
public repo**, because that counts as redistribution. Keep the repo private,
or store paid assets privately and pull them in at build time.

**Recommendation:**
1. Keep **procedural placeholders through M2**. They're free, consistent and
   don't block anything.
2. Then pick one of two looks:
   - **Free path:** procedural buildings plus Quaternius CC0 soldiers and
     Mixamo/UAL animations.
   - **Small-budget path:** about $100–200 one-off for a Synty military pack,
     once its EULA is confirmed for web.

---

## 5. Technical architecture

### 5.1 Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript | One language for everything |
| Build | **Vite** (static output) | Fast dev. Static deploy to Vercel. |
| UI | **React** (HUD/menus only) + a small store | Rich menus. The 3D loop stays outside React. |
| 3D | **Three.js `WebGLRenderer` (WebGL2)** | The most robust choice across phones and desktops today. WebGPU can come later as an optional quality tier. |
| Simulation | Plain TypeScript, **fixed 20 Hz tick**, command-driven, seeded PRNG, typed-array unit store | Testable without a browser. Replays and saves stay deterministic on the same device. |
| Pathfinding | Tile grid + **flow fields** (cached per destination) + separation steering | Many units moving together cheaply. Hierarchical sectors later. |
| Threading | The sim runs on the main thread behind a `SimHost` interface | Simplest start. It can move into a Web Worker if profiling on phones demands it. |
| Animation | Procedural now. **Vertex animation textures** for crowds once skinned assets land. | Phone performance |
| Persistence | IndexedDB saves and settings. Replays = seed + command log. | No backend |
| Hosting | **Vercel static** + PWA manifest (installable, fullscreen, landscape) | No servers needed |
| Tests | Vitest (sim), Playwright (smoke + screenshots) | — |

**Dropped because there's no multiplayer:** lockstep netcode, fixed-point
math, relay servers, accounts and the database. That removes a large
complexity and risk budget.

### 5.2 Data flow

```
 Input (mouse/keys/touch) ──► Commands ──► Sim (fixed 20 Hz tick)
                                              │  map, units, flow fields,
                                              │  economy, AI, light/vision
                                              ▼
 React HUD ◄── UI store ◄── snapshots ──► Three.js renderer (interpolates, 60 fps)
```

- All actions are **commands** (`move`, `place`, `directControl`, …). The same
  path drives the player, the AI, replays and tests.
- The renderer interpolates between ticks and never mutates sim state.

### 5.3 World

- A tile map (≈128²–192²) with tile types (sand, rock, fertile, water, oil).
- A smooth visual heightfield (dunes). Gameplay height comes from structure
  levels.
- Multi-layer nav: ground plus wall-tops linked by stairs, ladders and ramps
  (M2).

### 5.4 Performance budgets

| Device | Target |
|---|---|
| Mid-range laptop (integrated GPU) | 60 fps, ~600 units visible, high preset |
| Mid-range phone (≈3 years old) | 30–60 fps, ~300 units visible, low/medium preset (no shadows, lower resolution scale) |
| Sim tick | < 4 ms at 20 Hz with 600 units and 3 AIs on desktop. < 10 ms on phones. |
| Download | < 8 MB to first playable frame. Assets streamed. |

Techniques: instancing, merged static geometry, LOD, adaptive resolution
scale, quality auto-detect.

### 5.5 Repository layout

```
src/
  sim/        Pure TS simulation (no DOM/three): map, units, pathing, economy, AI, clock
  render/     Three.js scene, terrain, instanced units, lights, cameras (RTS + OTS)
  input/      Mouse/keyboard/touch → commands; virtual joystick
  ui/         React HUD and menus
  content/    Data definitions: units, buildings, chains, AI personalities, maps
  game/       Wires sim + render + input + UI; main loop
tests/        Vitest specs for sim
docs/
```

### 5.6 Engineering practices

- Sim unit tests, including **determinism tests** (same seed + commands ⇒
  same state hash).
- Debug overlays (`?debug=1`): flow fields, tile types, light grid, FPS, sim
  ms.
- Playwright screenshots at desktop and phone-landscape sizes for each
  milestone.
- Vercel Git integration gives every push a preview URL.

---

## 6. Roadmap

| # | Milestone | Playable result |
|---|---|---|
| **M0** | **Foundations + spikes** ✅ | A procedural desert map (dunes, oases, rock ridges, oil) and walled outposts. RTS camera with mouse and touch. Select squads and move them with flow-field pathing and formations. Live 8-minute day/night with floodlights and lit windows. Basic auto-engage combat. Over-the-shoulder take-control with a phone joystick. |
| **M1** | **Economy slice** ✅ | Arrivals hub, housing, depots and ration stores. Lumber camps fell depletable trees. Quarries must touch rock, orchards need fertile ground, plus goat ranches. Civilians physically haul goods to the nearest store. Rations, food variety and taxes drive morale, which drives arrivals and departures. Night slows work to ~35%. Build menu and placement ghost (mouse + touch confirm), building panel (status, pause, demolish), morale panel. |
| **M2** | **Fortifications & combat** ✅ | Wall lines (drag), watchtowers, gatehouses (only your troops pass, rotatable), stairs. Two-layer navigation (ground + wall tops) with a height range bonus and 50% cover. Scrap yard → steel → arms factory (selectable recipes) → armory → barracks recruiting (civilian + weapon + funds). Riflemen, machine gunners (suppression), marksmen, combat engineers (breach charges). Attack orders, building damage and destruction. "Hold the Line": 6 waves with breach-and-raid AI, victory/defeat, start menu. |
| **M3** | **Skirmish AI v1** ✅ | 1v1 on a mirrored map against **Old Sarge**: a personality-driven build order with automatic rebuilding and resource-aware placement. He builds a blueprint fortress (front wall first, then the full ring with towers, gatehouses and stairs). He manages morale (food capacity, moderate taxes) and trades surplus at a new **Trade Post**. He picks weapons to match his army mix, recruits, garrisons the front wall, defends his base and launches growing assaults with engineers. He sends radio taunts. Easy/Normal/Hard. Against a passive player Normal wins in ~12 min; Hard in ~10. |
| **M4** | **Night & stealth** ✅ | Per-team detection with the same rules for the AI. By day lookouts see the whole map. At night sight shrinks unless the target is lit, or the observer has night vision. Unseen enemies are hidden and can't be targeted. A sim light grid (floodlight cones you aim, sweeping searchlights, HQ lamps, burning buildings, $15 flares) drives smooth light pools on the ground. A power grid: the HQ plus staffed generators feed lights and sensors, oldest first, shown in a power gauge. Motion sensors catch movers; K9 kennels catch everyone. Unsilenced fire gives the shooter away for 3 s. Night shifts keep work at full speed for a morale cost. SF operators need a night-ops kit from the arms factory: night vision, stealth (harder still to spot when still), silenced rifles, wall climbing and a fast demolition charge. Night-vision optics when you take control of one. Old Sarge builds a night kit (floodlights, a searchlight, a sensor) and fires flares at intruders, and Hold the Line's night waves bring operators. |
| **M5** | **Direct control, full** ✅ | Aimed fire is a 3D ray from the camera through the crosshair, against body and head hitboxes. Head hits ×2 (×3 through a scope). Walls, rocks and buildings stop rounds by height, so parapets cover bodies but not heads. Magazines and reloads, aim bloom, and a moving penalty. Charges planted by hand; operators climb walls by walking into them; anyone takes stairs both ways. The rest of the selection follows as a squad. **Gun Tower**: a crewed HMG that fires on its own and can be aimed by hand. Searchlights can be swept by hand. **Drone Bay**: recon drones (thermal, fly over walls) and strike drones (dive and explode) on batteries that recharge at the bay. HUD: hit, headshot and kill markers, damage direction, ammo, reload, battery, scope, optional slow motion; phone buttons for every action. Old Sarge builds gun towers and a drone bay and sends strike drones during assaults. |
| **M6a** | **Siege depth** ✅ | Fuel from oil derricks. A Motor Pool builds armored cars, battle tanks and howitzers (crewed by idle civilians). Armor vs armor-piercing damage, splash, and siege guns that knock down walls. Howitzers deploy and lob shells with flight time and scatter. AT specialists. Ground-only flow fields for vehicles. Line-placed minefields (hidden until engineers or dogs find them; engineers defuse them), anti-tank ditches (block everyone, shots pass, engineers fill them), fuel trenches (lit by command, flares or blasts; spread and burn), razor wire (slows infantry, flattened by vehicles). Tank and howitzer direct control. Old Sarge fields armor; Hold the Line's late waves bring a car, tanks and a howitzer. |
| — | **Playtest round 1** ✅ | Crowds no longer jam (formation slots never collide; stalled units near their goal settle; head-on walkers slide past). Mixed selections split by type. Normal and Hard think faster and attack earlier and harder. Recon drones see through stealth; strike drones hit harder and need no breach kit. Gun towers weaker and pricier; heavy weapons do +75% to them. Darker unlit nights. Flares limited to 3 (+1 a minute). Building upgrades (levels; watchtower → gun tower). Generator workers now stay at their post. |
| **M6b** | **Variety** ✅ | Four new AI commanders on a data-driven personality system (tempo, armor wants, build order, upgrade priorities): **Jackal** (farm raids, cars, early attacks), **The Engineer** (wire, mines, ditches and fuel trenches outside the walls, lit under the enemy; howitzers and a Breacher), **The Broker** (taxes, trading, PMC hires), **Warden** (gun towers on every wall, searchlights, big garrison, late tank assaults). Four mirrored skirmish maps (Oasis Basin, Dune Sea, Rocky Pass, Oil Fields) with tinted terrain. Commander's Trail: six stages, progress in localStorage, "Next stage" on victory. Contracts Office (instant PMC teams for cash, one a minute). Breacher vehicle: mine plow, fast ditch filling, assault ramps that let infantry over walls. Skirmish setup menu (opponent, map, difficulty); saves remember the match. Fixes: the AI no longer builds against doorways; workers who can't reach a store try another. |
| — | **Playtest round 2** ✅ | Howitzer range cut to 30 (a little beyond gun towers); new **Mortar Pit** with counter-battery radar (fires back at any gun that shelled within reach, seen or not). Map variety: random layout every skirmish, two new maps (Ruined Town with cover-giving, salvageable ruins; Salt Flats with resources on the edges), guaranteed outcrops and a connectivity guarantee. No build radius for farms, work sites and stores. A crafty, bolder AI: scouting and intel-based army estimates, flank attacks on the weakest side with a feint at the gate, opportunistic attacks when it clearly outnumbers you, reinforcing winning assaults and pulling back broken ones, night sabotage by special forces (generators, gun towers), hunting an exposed Commander (strike drones too), mortar pits when shelled, extra producers for idle hands, and a rations/taxes planner that maximizes income within morale targets. Hard attacks earlier and more often. |
| **M7** | **Polish & launch** | Final art/audio, tutorial, settings, saves, PWA polish, phone tuning, balance, final name |

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Scope | Vertical slices, data-driven content, strict milestone gates |
| **Phone performance** | Low-poly + instancing, a light texture instead of many lights, adaptive resolution, quality presets. Test phone viewports every milestone. |
| **RTS on a touchscreen** | Dedicated touch scheme (§4), larger hit targets, a select-mode toggle, smart double-tap, and generous auto-behaviours (auto-repair, auto-buy) |
| Over-the-shoulder exposes a low-fidelity sim | Higher-detail interpolation and animation for the possessed unit, plus a limited eligible list |
| Art inconsistency | One style family, procedural placeholders until the asset decision |
| IP / trademark | Original name, characters, art, audio and maps |
| Sensitive themes | Fictional factions and places, no gore |

---

## 8. Next steps

1. ~~**M0**: scaffold, map, camera, selection and movement, day/night,
   the take-control spike.~~ Done.
2. ~~**M1** economy slice.~~ Done.
3. **You:** import the repo into Vercel (Add New → Project → pick the repo →
   Framework "Vite" is auto-detected). From then on, every push gets a preview
   URL.
4. ~~**M2** fortifications & combat.~~ Done.
5. ~~**M3** skirmish AI.~~ Done.
6. ~~**M4** night & stealth.~~ Done.
7. ~~**M5** full direct control.~~ Done.
8. ~~**M6a** siege depth.~~ Done.
9. ~~**M6b** variety.~~ Done.
10. **M7** polish and launch: Nightshade, The Quartermaster and Duchess Varga, final art and audio, tutorial,
    settings, PWA polish, phone tuning, balance, final name.

---

## 9. Open questions

- **Q-A, asset budget:** free path or small-budget path (§4.1)? This isn't
  needed until after M2.
- **Q-B, name:** pick from §2.1 or suggest your own. Not needed until M7.

---

## 10. Research sources

- Vercel WebSockets beta & limits (why multiplayer would need another host):
  [Vercel KB](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections),
  [Ably: WebSockets on Vercel](https://ably.com/vercel/websockets-on-vercel)
- Three.js status:
  [What's new in Three.js (2026)](https://www.utsubo.com/blog/threejs-2026-what-changed)
- Original mechanics:
  [Stronghold Wiki: Fear Factor](https://stronghold.fandom.com/wiki/Fear_Factor)
- Flow fields / large-unit RTS:
  [RTS devlog: 1000 units](https://www.construct.net/en/blogs/ashleys-blog-2/rts-devlog-units-bandwidth-1603)
- Assets:
  [Quaternius Toon Shooter (GameWorldObserver)](https://gameworldobserver.com/2023/01/20/free-game-assets-tutorials-quaternius-indie-developers),
  [Toon Shooter on GDevelop (CC0)](https://gdevelop.io/asset-store/free/toon-shooter-3d-toon-shooter),
  [Kenney All-in-1](https://kenney.itch.io/kenney-game-assets),
  [Synty POLYGON Military Pack](https://syntystore.com/products/polygon-military-pack),
  [Synty FAQ](https://syntystore.com/community/faq),
  [Synty one-time purchase licence](https://syntystore.com/pages/one-time-purchase-licence),
  [Mixamo licensing FAQ (Adobe community)](https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/td-p/13234775),
  [Sonniss GDC 2026 bundle](https://rekkerd.org/sonniss-releases-gdc-2026-game-audio-bundle/)

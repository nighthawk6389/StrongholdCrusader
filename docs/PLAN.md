# Modern Castle-Siege RTS: Game Design & Technical Plan

> **Status:** Draft v0.1, for discussion. Nothing here is final. Every open
> decision is listed in [§9 Questions & Options](#9-questions--options-for-you).
>
> **Working title:** _TBD_ (see [§2.1](#21-name-ip-and-originality)). This doc
> says "the game" for now.

---

## 0. TL;DR

A browser-based 3D real-time strategy game deployed on Vercel. It keeps the core
loop of the classic castle-sim RTS genre: grow a population, keep it happy, run
production chains, arm your troops and build a fortress, then break the enemy's
fortress. The setting is **modern / near-future military**, and the game adds
three new pillars:

1. **Faster pacing.** Matches target 25–35 minutes instead of 60+, through
   shorter chains, haul trucks and quality-of-life automation.
2. **Day/night cycle with real stealth.** Light, noise and sensors decide what
   each side can see. Night raids with special forces, searchlights, flares,
   power-grid sabotage.
3. **Jump into first person.** Possess a special-forces operator, sniper,
   wall-mounted gun, tank or drone and fight directly while the rest of your
   army keeps following orders.

**Recommended stack:** TypeScript, Vite, React (HUD only), Three.js
(WebGPU with WebGL2 fallback), a deterministic simulation with an ECS in a Web
Worker, fixed-point math, and flow-field pathfinding. Vercel hosts the client
and a small API. Multiplayer, added later, uses deterministic lockstep relayed
through a Cloudflare Durable Object. The reason for that split is in §5.6.

**Recommended order:** single-player skirmish vs AI first. Prove the core loop
is fun, then add night/stealth, then first person, then online multiplayer.

---

## 1. What made the original great (the pillars to keep)

These carry over. Everything else is up for modernization.

| Pillar | Why it mattered | Keep / adapt |
|---|---|---|
| **Popularity economy** | Peasants arrive or leave based on popularity (rations, food variety, taxes, ale, religion, "fear factor"). Every decision trades happiness against output. | Keep. Rename to **Morale** with modern drivers (§3.2). |
| **Physical logistics** | Workers walk goods from producer to stockpile to processor. Base layout matters, and raiding supply lines works. | Keep, but add **haul trucks** and **depots** to speed it up. |
| **Equip-to-recruit** | Troops need produced weapons plus gold plus a peasant. Your weapon industry decides your army. | Keep as is. It is the strategic heart. |
| **Fortifications with height** | Walls and towers are walkable. Units on top get range and protection. Gates, moats, pitch ditches, killing pits. | Keep. Concrete walls, towers, checkpoints, AT ditches, minefields, fuel trenches. |
| **Siege as a puzzle** | Rams, trebuchets, siege towers, ladders, tunnellers and engineers each solve a different defensive problem. | Keep, with modern equivalents (§3.4). |
| **The Lord dies, you lose** | One vulnerable leader creates dramatic assassinations and last stands. | Keep: **Commander** unit and HQ. |
| **AI personalities** | Memorable AI rivals with distinct castle styles, attack styles and taunts. | Keep, with **original** characters (§3.8). |
| **Desert / oasis maps** | Scarce fertile land creates map control and a reason to expand. | Keep: scarce water and fertile zones, plus oil fields. |

---

## 2. Concept & setting

### 2.1 Name, IP and originality

- The game needs **its own name, characters, art, audio and maps**. "Stronghold"
  is a trademark of its publisher, so we can't use the name, its AI lords, its
  assets or its maps. Genre mechanics (castle building, popularity, siege) are
  fine to share. Every game in the genre does.
- The repo can stay named `StrongholdCrusader` while private. Rename it before
  any public launch.
- Working-title ideas to react to: **Bastion Protocol**, **Nightwall**,
  **Hold the Line: Night Ops**, **Fortline**, **Garrison Zero**,
  **Iron Perimeter**. Availability still needs checking.

### 2.2 Setting options (decision needed: Q1)

| Option | Pros | Cons |
|---|---|---|
| **A. Fictional near-future (≈2040s)** (recommended) | Free to invent factions, gear, drones and EW. Avoids depicting real-world conflicts. Plausible "why are they building walls" story (collapse, resource wars over water and oil). | Less "real". |
| B. Present-day realistic | Instantly recognizable gear. | Real-world conflict sensitivity. Pressure for realism. Walled bases feel less natural. |
| C. Alt-history (e.g., 1980s Cold War gone hot) | Distinct style and fun retro tech. Fewer drones. | Night-vision and drone tech are more limited, which weakens the stealth pillar. |

Proposed premise (option A): water and fuel are scarce. Independent commanders
hold **fortified enclaves** around oases, aquifers and oil fields. Fictional
factions only.

---

## 3. Core gameplay design

### 3.1 Match flow & "slightly faster" pacing

Target **25–35 minute** skirmishes (the original's often ran 60–90).

| Lever | Change vs. the classic formula |
|---|---|
| Start state | Start with a small pre-built core (HQ, depot, 2 housing blocks, a few civilians). No empty-field opening. |
| Population inflow | Civilians arrive in small groups, not one at a time. Rate still scales with morale. |
| Production chains | 2 steps max for most goods (the original had up to 3–4). E.g. ore → steel mill → **steel**. Steel → small-arms factory → **rifles**. |
| Hauling | Workers carry larger loads. **Haul trucks** run between depots and far-off producers. Forward depots shorten walks. |
| Build/recruit times | About 40–60% of classic timings. Global game-speed slider (0.5×–2×) in single-player. |
| QoL automation | Build queues, rally points, control groups, auto-repair toggle, wall/blueprint templates (save and stamp a fortress design), "auto-buy missing input from market" toggle, smart alerts. |
| Day/night rhythm | A natural build-by-day / strike-by-night beat compresses decisions (§3.6). |

### 3.2 Economy

**Population & housing.** Civilians arrive at the **Arrivals Hub** (like the
campfire). Housing blocks raise the cap. Idle civilians become workers or
recruits.

**Morale (popularity), range 0–100.** Above 50, people arrive. Below 50, they
leave.

| Driver | Mechanic |
|---|---|
| Rations | None / Half / Normal / Extra / Double. Each level costs more food and gives more morale. |
| Food variety | Each distinct food type in the ration store adds morale (bread, meat, produce, plus hydroponics later). |
| Taxes | Bribe (negative tax) … Normal … Extortionate. Funds versus morale. |
| Coffee (ale/inn analog) | Coffee farm → roastery → **canteens**. Coverage gives morale. |
| Civic (religion analog) | Community hall and **broadcast station** coverage give morale. A broadcast station later unlocks propaganda. |
| **Security posture vs. perks** (fear-factor analog) | **Strict** (CCTV, curfews, checkpoints, posters): +worker productivity, −morale, −troop combat effectiveness. **Perks** (parks, gyms, memorials): +morale, +troop combat effectiveness, −productivity. Shown as a −5…+5 dial, like the original's fear-factor scale. |
| Night shifts | Toggle. Production continues at night if the building is powered and lit, at a morale cost (§3.6). |
| Events | Fire, power outage, disease (the clinic reduces it), raids on housing. |

**Resources.** About 10 types, down from roughly 20.

| Category | Resources | Chain |
|---|---|---|
| Raw → material | **Timber**, **Concrete**, **Steel**, **Fuel**, **Components** | Lumber camp → timber. Quarry → cement plant → concrete. Ore mine → steel mill → steel. Oil derrick → refinery → fuel. Salvage yard / import → components (rare). |
| Food | Bread, Meat, Produce, (Hydroponic greens) | Grain farm → mill → bakery. Ranch. Orchard. Hydroponics (needs power and water). Fertile land only near water. |
| Morale goods | Coffee | Coffee farm → roastery → canteen. |
| Energy | **Power** (a flow, not a stockpile, plus batteries) | Diesel generator (burns fuel), **solar (daytime only)**, battery bank. Powers lights, sensors, turrets, labs, hydroponics. |
| Currency | **Funds** | Taxes, market sales. |
| Gear | Rifles, MGs, Launchers, Body armor, NV kits, Explosives | §3.4 |

The **Market / trade terminal** buys and sells everything at a spread, the same
way the original's market does.

**Building mapping (classic → modern):**

| Classic | Modern |
|---|---|
| Keep + Lord | Command HQ + **Commander** |
| Campfire | Arrivals Hub |
| Hovel | Housing block (prefab) |
| Stockpile / Granary | Supply depot / Ration store |
| Woodcutter / Quarry / Iron mine / Pitch rig | Lumber camp / Quarry + cement plant / Ore mine + steel mill / Oil derrick + refinery |
| Wheat farm, Mill, Bakery, Dairy, Orchard, Hunter | Grain farm, Mill, Bakery, Ranch, Orchard, Hydroponics |
| Hops farm, Brewery, Inn | Coffee farm, Roastery, Canteen |
| Chapel/Church | Community hall, Broadcast station |
| Apothecary / Well | Clinic / Fire station |
| Fletcher, Poleturner, Blacksmith, Tanner, Armourer | Small-arms factory, Ordnance plant, Armor works, Electronics lab, Vehicle plant |
| Armoury / Barracks | Armory / Barracks |
| Mercenary post | **PMC Contracts Office** (instant hires for funds) |
| Engineer's guild, Tunneller's guild, Siege tent | Engineering corps, Motor pool / Vehicle bay |
| Dog cage | K9 kennel |
| Good / bad things | Perks / Security structures |
| — (new) | Power plant, Solar field, Battery bank, Substation, Radar, Sensor posts, Floodlights |

### 3.3 Fortifications

Everything sits on a **tile grid** with **height levels**, as in the original.

- **Walls:** sandbag line (cheap, low, no walkway), concrete wall (walkable
  top), thick concrete wall, HESCO barrier line. Reaching a wall top needs
  **stairs or an access tower**.
- **Towers:** watchtower, bunker/pillbox, **fortified tower** with a mounted
  emplacement: HMG, mortar, AT launcher or AA gun. These are the
  mangonel/ballista-on-tower analogs.
- **Gates:** checkpoint gates (small and large). They open for friendlies and
  lock when enemies are near.
- **Ground obstacles:**
  - Anti-tank ditch (moat analog). Engineers dig it and enemy engineers can
    fill it.
  - Tank traps.
  - Razor wire (slows infantry).
- **Traps:**
  - Minefields (killing-pit analog). Hidden unless detected by engineers or
    dogs.
  - **Fuel trench** (pitch-ditch analog). Ignite it with an incendiary round or
    flare.
  - Claymore lines.
- **Detection & light (new, for the night pillar):**
  - Floodlights.
  - **Rotating searchlight towers.** Anything caught in the beam is revealed.
  - Motion sensors, thermal cameras, CCTV (also a security-posture item).
  - Radar (detects drones and air).
  - K9 kennel (dogs sniff out stealth units and mines).
- **Defensive automation (powered):** auto-turrets and CIWS. Strong but
  power-hungry, so a blackout disables them.

### 3.4 Military roster

Every unit needs **civilian + gear + funds**, recruited at the barracks or
built at the motor pool. Counters are deliberate (rock-paper-scissors+).

**Infantry (Barracks)**

| Unit | Role | Classic analog | Strong vs. | Weak vs. | Gear |
|---|---|---|---|---|---|
| Militia | Cheap filler, digs/fills ditches | Spearman / slave | Nothing | Everything | none (surplus) |
| Rifleman | Backbone | Archer / maceman | Infantry | MGs, armor | Rifle |
| Machine gunner | **Suppression** (enemy accuracy and speed −) | Archer volleys | Massed infantry | Snipers, mortars | MG |
| Marksman | Long range, high damage, slow | Crossbowman | Wall defenders, officers | Rushes | Rifle + optics (components) |
| AT specialist | Anti-vehicle, anti-structure | — | Tanks, gates, bunkers | Infantry | Launcher |
| Grenadier | Area denial, clears wall tops | Fire thrower-ish | Clumped / entrenched troops | Range | Explosives |
| Heavy assault | Armored breacher, slow | Swordsman / pikeman | Close quarters, gates | AT, snipers | Armor + MG |
| Combat engineer | Ladders/breach charges, dig/fill ditches, clear mines, field repair | Engineer + ladderman + tunneller | Obstacles | Everything in a fight | Explosives |
| Medic | Heals nearby infantry | — (new) | — | — | — |

**Special Forces (SF Compound, expensive, capped at e.g. 6–10)**

The direct analog of the original's assassins, who stayed hidden until close and
scaled walls with grappling hooks.

| Unit | Role |
|---|---|
| **SF operator** | NVG, suppressed weapons (no noise ping). **Climbs walls** with grapnels. Plants C4 on gates, generators and turrets. Stealthed in darkness unless lit or sensed. |
| **Ghillie sniper team** | Invisible when stationary and unlit. Huge range at night with thermals. |
| **EW specialist** | Jams sensors, radar, drones and powered turrets in a radius for a duration. |
| **K9 handler** | Detects stealthed units and mines. Fast pursuit. |
| **Drone operator** | Deploys a recon quadcopter (FPV-flyable) or a one-shot loitering munition. Countered by EW, AA and radar. |

**Vehicles (Motor pool / Vehicle plant, need steel + fuel)**

| Vehicle | Classic analog | Notes |
|---|---|---|
| Haul truck | — | Economy logistics |
| Armored recon car | Horse archer | Fast scouting / raiding |
| APC | — | Carries a squad, protects it |
| **Breaching vehicle** | Siege tower | Deploys an assault ramp onto a wall, plows mines, fills ditches |
| Main battle tank | Battering ram + knight | Smashes gates and walls. Vulnerable to AT, mines and ditches |
| Mortar carrier | Catapult | Mobile indirect fire |
| Towed howitzer | Trebuchet | Must deploy. Very long range. Wall-buster |
| Armored dozer / shield team | Portable shield (mantlet) | Absorbs fire for advancing infantry |
| AA vehicle | — | Counters drones and helicopters |
| _(optional)_ Transport helicopter | — | See Q7: air power can trivialize walls |

**Commander (the Lord analog).** A strong hero unit. If the Commander dies, the
match is lost, which leaves the HQ as a last bastion. Optional limited
abilities: rally (morale burst), call a flare barrage, and one scripted
off-map strike per match.

**PMC Contracts Office (mercenary analog).** Hire a separate roster instantly
for funds. Expensive, with different strengths. An economic shortcut, like
Arabian mercenaries in the original.

### 3.5 Combat model (simulation level)

- **Line of sight** on the grid. Walls and buildings block it, and height gives
  vision and range bonuses.
- **Cover:** units next to sandbags, walls or rubble take reduced damage.
  Units on wall tops get strong cover.
- **Suppression:** sustained fire lowers accuracy and speed. Pinned infantry
  can't advance. This makes MGs the archer-volley equivalent.
- **Projectiles:** small arms are resolved as near-instant traces. Mortars and
  artillery are ballistic with travel time and a scatter radius. Fire spreads
  on flammable tiles (fuel trenches, wooden buildings).
- **Morale in combat:** perks vs. security posture modifies troop
  effectiveness, as in the original.

### 3.6 Day/night & stealth (new pillar)

**Cycle (configurable per match):** e.g. day 6 min → dusk 1 min → night 4 min →
dawn 1 min. Options: no cycle, eternal night, or a map-scripted cycle.

**Visibility model.** Deterministic and grid-based, the same for players and AI.
No cheating.

- Each tile has a **light level**, computed in the simulation from the sun plus
  light sources: floodlights, searchlight cones, fires, flares, muzzle flashes
  and vehicle headlights.
- Each unit has **sight**: daylight range, reduced to about 35% in darkness
  unless it has **NVG** (full range) or **thermal** (full range, sees through
  light smoke, picks up warm vehicles and bodies).
- Each unit has **signatures**: visual (lit or unlit, moving or still, camo),
  thermal and noise.
- **Detection** = observer capability vs. target signature at the target's
  light level and range. Detected units show to that side for a few seconds.
- **Noise pings:** unsuppressed gunfire and explosions reveal the shooter's
  position on the enemy minimap for N seconds. Suppressed SF weapons don't.
- **Flares and illumination mortar rounds** light an area for about 30 s.
  Defenders spend them to break stealth.

**Night and the economy.** By default, workers rest at night and production
drops to about 30%. Powered and lit buildings with **night shifts** on keep
working at a morale cost. Solar produces nothing at night, so you need fuel
generators or batteries.

**Emergent play we want:**
- Cut the enemy's **substation**, and floodlights, turrets and sensors go
  dark. SF operators then climb the wall and open the gate for the tanks.
- Build at night with no lights to hide expansion. Use lights to protect
  production. Lights also make your base visible from afar.
- Searchlight towers become priority sniper targets.
- Defenders respond with dogs, flares and thermal cameras.

**Rendering approach:** the simulation's tile light grid is uploaded as a
low-resolution **light texture** that drives terrain and unit shading and the
fog of war. A handful of **real** dynamic lights (searchlight cones, nearest
fires, the first-person flashlight) add drama. This avoids hundreds of
real-time lights, which would be expensive in WebGL2.

### 3.7 First-person mode (new pillar)

- Select an eligible unit and press **F** (or click "Take control"). The camera
  flies into that unit's head or optic, and the mouse is captured with the
  Pointer Lock API.
- **Eligible units (proposal):** SF operator, marksman, rifleman, **mounted wall
  gun / searchlight tower**, tank (gunner sight), recon/FPV drone.
- **Controls:** WASD + mouse, LMB fire, RMB aim/scope, N toggles NVG/thermal,
  Tab or Esc returns to the RTS view. A compact HUD shows the minimap, alerts
  and morale.
- **The rest of your army keeps executing orders**, and the possessed unit's
  squad follows you.
- **How it stays fair and multiplayer-safe:**
  - The possessed unit sends "direct-control" inputs each tick: a move vector,
    an aim angle and a fire flag.
  - Hits are resolved **in the deterministic simulation**, as a raycast against
    simplified hitboxes, so skill matters (aim, headshots give a crit) without
    a separate shooter netcode.
  - Mouse-look is local and instant. Movement and shots have the lockstep
    input delay (≈100–150 ms online, none offline).
- **Balance knobs:** no hidden stat buffs, plus a small cooldown so you can't
  chain-possess across the map. Single-player can optionally slow time while
  you're in first person.
- **Cheaper alternative:** an **over-the-shoulder third-person** camera reuses
  the RTS unit models and animations, while true first person needs separate
  arms and weapon models. See Q3.

### 3.8 AI opponents (original personalities)

Layered AI:
- **Strategic layer:** build-order templates plus utility scoring (economy vs.
  military vs. defense).
- **Base layout:** hand-authored **fortress blueprints** per personality and
  start slot. This is how the original's AI lords got their iconic castles.
- **Tactical layer:** attack waves, siege planning, timing raids for night.
- **Unit layer:** per-unit behaviors (take cover, retreat when suppressed,
  focus fire on searchlights).

Difficulty comes from reaction time, economy efficiency and template quality,
**not** from vision cheats.

Personality sketches (placeholders):

| Name | Style |
|---|---|
| **Old Sarge** | Balanced infantry, beginner-friendly, honest taunts |
| **The Quartermaster** | Economic turtle, triple walls, late tank push |
| **Jackal** | Early militia rushes and recon-car raids on your farms |
| **Nightshade** | Stealth specialist: SF night raids, EW, kills your power |
| **The Engineer** | Minefields, fuel trenches, howitzers, never attacks first |
| **Duchess Varga** | Armor-heavy, breaching vehicles, relentless |
| **The Broker** | Rich trader who buys PMC armies |
| **Warden** | Fortress of searchlights and turrets, punishes night attacks |

### 3.9 Game modes

1. **Skirmish** vs. AI: up to 6–8 commanders, teams, map choice, start
   resources, day/night settings.
2. **Siege scenarios:** attack or defend a pre-built base. These are great
   showcases for night ops and first person.
3. **Commander's Trail:** a ladder of escalating skirmish challenges against
   AI personalities (our own take on the "trail" format).
4. **Free build** sandbox.
5. **Online multiplayer** (later milestone): 1v1, FFA, teams, co-op vs. AI.
6. _(later)_ Map editor and blueprint sharing.

---

## 4. Art, audio & UX direction

- **Recommended art: stylized low-poly 3D**, a clean, readable,
  "premium-indie" look. It's cheap to render, consistent to source or produce,
  and holds up in both the RTS view and first person. Night scenes look great
  with bloom on lights.
- **Camera:** RTS camera at a classic high angle with rotation (Q/E) and zoom.
  Free rotation is needed anyway because the world is 3D for first person.
- **UI:** a bottom building/unit panel (classic layout), a morale breakdown
  panel, a resource bar and a minimap with night overlay. React DOM over the
  canvas.
- **Audio:** positional SFX through Web Audio, a dynamic music layer (calm day
  → tense night → combat), and short original voice-line taunts for AI
  commanders.
- **Asset sourcing options** (decision: Q11):
  1. CC0 packs (Kenney, Quaternius, KayKit, Poly Pizza CC0 filter) + Mixamo
     animations. Free, but military coverage is thin.
  2. A paid consistent low-poly military pack (tens of dollars). Fast and
     consistent.
  3. AI-assisted 3D generation for gaps, plus manual cleanup.
  4. Commissioned art later for hero assets.
  In every case: one style family, glTF/GLB with meshopt compression and KTX2
  textures, and a licence ledger in the repo.

---

## 5. Technical architecture

### 5.1 Stack (recommended)

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language for sim, client, server and tests |
| Client build | **Vite** + React (HUD/menus only) | Fast dev and a static build that deploys to Vercel trivially. Next.js is optional later for marketing/SEO pages. |
| 3D rendering | **Three.js**, `WebGPURenderer` with automatic WebGL2 fallback | Largest ecosystem. 2026 guidance recommends the WebGPU renderer for new projects, and the fallback covers older browsers. |
| Simulation | Custom deterministic sim in a **Web Worker**, ECS (**bitECS**-style typed arrays) | Keeps the main thread free for rendering. Typed arrays make snapshots, saves and hashing cheap. |
| Math | **Fixed-point** (Q16.16 ints), seeded PRNG, trig lookup tables. No `Math.random` or floats in sim state. | Required for lockstep multiplayer and replays |
| Pathfinding | Tile grid + **hierarchical flow fields** (sector/portal) + local separation steering | Hundreds of units moving together without per-unit A* traffic jams. Walls and gates update only the affected sectors. |
| Animation | **Vertex animation textures** (instanced, GPU) for crowds. Skeletal only for the first-person / close-up unit. | Hundreds to 1,000+ animated soldiers at 60 fps |
| UI state | Zustand | Simple, works with worker messages |
| Audio | Web Audio (Three `PositionalAudio` or Howler) | — |
| Persistence | IndexedDB (saves, settings). Replays = seed + command log. | Free with a deterministic sim |
| Hosting | **Vercel** (static client, preview deploys per PR, small API) | What you asked for |
| Multiplayer relay (later) | **Cloudflare Durable Objects** (PartyServer/PartyKit), one object per match | See §5.6 |
| Accounts / DB (later) | Auth (e.g., Auth.js or Clerk) + Postgres via Vercel Marketplace (e.g., Neon) | Profiles, leaderboards, blueprint sharing |
| Tests | Vitest (sim and determinism), Playwright (smoke and cross-browser determinism), perf benchmarks in CI | — |

**Alternatives considered:** Babylon.js (more batteries included, smaller
ecosystem); PlayCanvas; a Godot 4 web export (great editor, but heavier
downloads and weaker web integration); Unity WebGL (large builds, licensing).
2D options (Phaser, Pixi) are **ruled out** because first person needs a real
3D world.

### 5.2 Process & data flow

```
┌──────────────────────── Browser ────────────────────────┐
│                                                          │
│  Main thread                         Sim Worker          │
│  ┌────────────────────┐   commands   ┌─────────────────┐ │
│  │ Input (RTS / FPV)  │ ───────────▶ │ Deterministic   │ │
│  │ React HUD          │              │ fixed tick 20Hz │ │
│  │ Three.js renderer  │ ◀─────────── │ ECS + fixed pt  │ │
│  │ (interpolates)     │  snapshots / │ flowfields, AI, │ │
│  └────────────────────┘  deltas      │ light grid, LOS │ │
│            │                         └─────────────────┘ │
└────────────┼─────────────────────────────────────────────┘
             │ (multiplayer only: per-tick command bundles)
             ▼
   Relay (Durable Object per match) ◀──▶ other players
   Vercel API: lobby, auth, profiles, leaderboards
```

- The simulation runs at a **fixed 20 Hz** (configurable). The renderer
  interpolates at display rate (60–144 fps).
- **All player actions are commands** (`{tick, playerId, type, payload}`):
  RTS orders, building placement and first-person direct-control inputs. The
  same path serves single-player, replays and multiplayer.
- A **state hash** every N ticks gives desync detection online and
  determinism tests in CI.

### 5.3 World representation

- Map: about 160×160 to 256×256 tiles. Heightmap plus tile types (sand, rock,
  fertile, water, oil, road).
- Structures occupy tiles and carry a height level. Wall tops are walkable
  nav layers connected by stairs, towers, ladders and breach ramps.
- The nav grid has multiple layers (ground, wall-top). Flow fields are
  computed per layer with link edges.
- The light grid and visibility grid live per tile (and per player for
  visibility).

### 5.4 Performance budgets (targets)

| Budget | Target |
|---|---|
| Frame rate | 60 fps on a mid-range laptop (integrated GPU) at 1080p with ~1,000 units on screen |
| Sim tick | < 10 ms at 20 Hz with 1,500 units and 6 AI players |
| Initial download | < 15 MB to the main menu. Stream map and unit assets. |
| Memory | < 1 GB |

Techniques: instancing everywhere, LODs, frustum culling, texture atlases, a
baked terrain lightmap plus a dynamic light texture, and the
rendering-quality presets low/med/high.

### 5.5 Repository layout (proposed)

```
apps/
  web/            Vite + React client (deploys to Vercel; /api for small functions)
  relay/          Cloudflare Durable Object lockstep relay (milestone M7)
packages/
  sim/            Deterministic simulation (pure TS, no DOM): ECS, rules, pathing, light/vision
  ai/             AI commanders (runs inside the sim worker, deterministic)
  render/         Three.js scene, instancing, VAT animation, FX, cameras (RTS/FPV)
  content/        Data-driven definitions: units, buildings, chains, AI personalities, maps (JSON/TS)
  shared/         Fixed-point math, PRNG, command schema, protocol types
tools/
  asset-pipeline/ glTF → optimized GLB/KTX2, VAT baking, licence ledger
docs/
```

Content is **data-driven** (stats, costs, chains in `packages/content`), so
balancing doesn't need code changes.

### 5.6 Multiplayer & the Vercel constraint

- Vercel is ideal for the **client, preview deployments and short API calls**.
  Native **WebSocket support in Vercel Functions is only in public beta (since
  June 2026)**, and connections close when the function hits its maximum
  duration: 300 s on Hobby, up to 800 s on Pro, with an extended beta ceiling
  reported at 1,800 s. Clients must reconnect, and fan-out across instances
  needs an external pub/sub. That's a poor fit for 30-minute matches.
- **Recommendation:** keep everything on Vercel **except** the match relay,
  which runs on **Cloudflare Durable Objects** (one object per match, holding
  WebSockets for the whole match; free tier to about $5/month (Workers paid plan) at
  hobby scale). The relay is simple because of lockstep: it collects each
  tick's commands, stamps them and broadcasts them. It never runs the game.
- **Alternatives:**
  - WebRTC peer-to-peer data channels, with signaling via Vercel and a TURN
    fallback. Cheapest bandwidth, but hits NAT headaches.
  - Colyseus on Fly.io or Railway.
  - Vercel WebSockets beta plus Redis pub/sub, with forced reconnects every
    5–30 minutes.
- **Lockstep details:**
  - Input delay of about 3 ticks (~150 ms).
  - Hash check every 2 s.
  - Reconnect or join-in-progress via snapshot plus command catch-up.
  - Free replays and spectating.
  - AI players run on every client in lockstep, which costs no server CPU.

### 5.7 Engineering practices

- **Determinism tests from day 1:** run the same seed and commands twice, and
  in Chromium, Firefox and WebKit via Playwright, then compare hashes.
- **Headless sim benchmarks** in CI fail the build on perf regressions.
- **Debug overlays:** flow fields, light grid, vision, nav layers, AI intent.
- Vercel Git integration gives every PR a playable **preview URL**.
- Feature flags for in-progress systems.

---

## 6. Roadmap (milestones)

Each milestone ends with a **playable build on a Vercel URL** for you to test.

| # | Milestone | What you can do at the end |
|---|---|---|
| **M0** | **Foundations + tech spikes** | Open the URL, pan, rotate and zoom over a desert map, select a squad and move it around obstacles. Spikes prove (a) 1,000 animated instanced soldiers at 60 fps, (b) the night light-texture look, (c) a prototype first-person possession. |
| **M1** | **Economy slice** | Build HQ, housing, depot, timber, concrete and one food chain. Watch workers haul. Set rations and taxes and see morale respond. |
| **M2** | **Fortifications & combat** | Build walls with walkable tops, towers, gates and stairs. Recruit riflemen, MGs, marksmen and engineers from armory gear. Survive scripted enemy waves in a "Hold the Line" scenario. |
| **M3** | **Skirmish AI v1** | A full 1v1 skirmish against *Old Sarge*, who builds a fortress from a blueprint and attacks. **First "real game" moment.** |
| **M4** | **Day/night & stealth** | The full cycle, power grid, floodlights, searchlights, sensors, dogs, flares, SF operators with NVG and wall climbing, noise pings. A night-raid scenario. |
| **M5** | **First-person mode** | Possess the SF operator, marksman, wall gun, tank and drone, then return to the RTS view seamlessly. |
| **M6** | **Content & siege depth** | Vehicles, breaching vehicle, howitzers, mines, AT ditches, fuel trenches, PMC office, 4–6 AI personalities, 6+ maps, Commander's Trail. |
| **M7** | **Online multiplayer** | Lobby, invite link, 1v1 / FFA / co-op vs. AI over the lockstep relay. Replays. |
| **M8** | **Polish & launch** | Audio and music, VFX, tutorial, settings and accessibility, balance pass, optional accounts and leaderboards, final name and branding. |

The M0 spikes come first deliberately. Night rendering, crowd performance and
first-person feel are the riskiest technical bets, so we de-risk them before
building content on top of them.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Scope.** RTS is among the hardest genres. | Vertical slices, single-player first, data-driven content, a strict milestone gate. |
| **Desyncs** in multiplayer | Fixed-point sim, no floats in state, a hash check, cross-browser determinism tests in CI from M0 |
| **Performance** with many animated units at night | VAT crowds, instancing, a light texture instead of many real-time lights, quality presets |
| **First person exposes a low-fidelity sim** | Higher-detail local interpolation for the possessed unit, a limited eligible-unit list, an over-the-shoulder fallback |
| **Air power trivializes walls** | No fixed-wing aircraft. Drones are fragile and countered by EW, AA and radar. Helicopters are optional and limited (Q7). |
| **Art inconsistency** from mixed asset packs | One style family, an asset pipeline with a shared palette and materials, a licence ledger |
| **IP / trademark** | Original name, characters, art, audio and maps. Rename the repo before public launch. |
| **Sensitive themes** (modern warfare) | Fictional factions and setting, no gore by default |

---

## 8. Immediate next steps (once you answer §9)

1. Lock the decisions from §9 into this doc (v0.2).
2. Scaffold the monorepo: Vite + React + Three.js, the sim worker, Vitest,
   Playwright, lint and format, and the GitHub Actions workflow.
3. Connect the repo to Vercel. Every push gets a preview URL. **Your action:**
   import the repo in the Vercel dashboard, because Vercel can't be connected
   from this environment.
4. Build M0: terrain, RTS camera, unit selection and move with flow fields, and
   the three tech spikes.

---

## 9. Questions & options for you

**Recommended defaults are in bold.** Answering just the first 6 unblocks M0–M2.

1. **Setting & name.** **A) Fictional near-future** / B) present-day / C)
   alt-history Cold War. Any name preference, or shall I propose a shortlist?
2. **Art style.** **Stylized low-poly 3D** / semi-realistic 3D (much costlier) /
   voxel.
3. **First-person depth.** A) Cinematic ride-along (view only) / **B) Direct
   control of selected unit types** / C) Any unit. Also: **true first-person**
   or **over-the-shoulder third person** (cheaper and reuses models)? Does it
   need to work in multiplayer, or is single-player enough at first?
4. **Multiplayer priority.** **Single-player vs. AI first, online later (M7)** /
   online from the start / single-player only.
5. **Economy fidelity.** **Faithful but trimmed** (workers physically haul,
   about 10 resources, trucks) / fully faithful (every chain, about 20
   resources) / streamlined (harvest-and-refine, Command & Conquer style).
6. **Match pace.** 15–20 min / **25–35 min** / 45+ min (closer to the
   original).
7. **Air power.** **Drones only** / plus limited helicopters / full air
   including strikes. More air means walls matter less.
8. **Day/night.** Default cycle length (**≈12 min full cycle**)? Should night
   slow the economy (**yes, unless night shifts are on and buildings are
   powered**)?
9. **Platform.** **Desktop browsers (mouse + keyboard)** / also tablets (touch) /
   also phones.
10. **Tech engine.** **Three.js** / Babylon.js / Godot web export. Happy to
    defer to my recommendation?
11. **Budget.** Strictly free (CC0 assets, free tiers) / **small budget**
    (≈$50–200 one-off for an asset pack plus ≈$5/mo for the relay when
    multiplayer lands) / larger (commissioned art).
12. **Accounts & persistence.** Local saves only / **local now, accounts later
    (leaderboards, blueprint sharing)** / accounts from the start.
13. **Tone.** **No gore, T-rated feel** / grittier. Should AI commanders have
    humorous taunts like the originals (**yes**)?
14. **How you want to work.** Should I drive end-to-end, with you playtesting
    each milestone's Vercel URL? Or do you want to code alongside, in which
    case I'll favor more explanation and smaller PRs? Should each milestone go
    up as a PR for review?

---

## 10. Research sources

- Vercel WebSockets public beta & limits:
  [Vercel KB: Do Vercel Functions support WebSockets?](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections),
  [Ably: WebSockets on Vercel](https://ably.com/vercel/websockets-on-vercel),
  [Vercel function duration docs](https://vercel.com/docs/functions/configuring-functions/duration.md)
- Three.js WebGPU status:
  [What's new in Three.js (2026)](https://www.utsubo.com/blog/threejs-2026-what-changed),
  [WebGPU + Three.js migration guide](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
- Original mechanics reference:
  [Stronghold Wiki: Fear Factor](https://stronghold.fandom.com/wiki/Fear_Factor)
- Durable Objects / PartyKit:
  [How PartyKit works](https://docs.partykit.io/how-partykit-works/),
  [Cloudflare acquires PartyKit](https://blog.cloudflare.com/cloudflare-acquires-partykit/)
- Browser RTS lockstep & flow fields:
  [RTS devlog: 1000 units bandwidth](https://www.construct.net/en/blogs/ashleys-blog-2/rts-devlog-units-bandwidth-1603),
  [OpenFrontIO core simulation](https://www.mintlify.com/openfrontio/OpenFrontIO/technical/core-simulation),
  [Bannermen lockstep RTS (Photon)](https://blog.photonengine.com/?p=3721)

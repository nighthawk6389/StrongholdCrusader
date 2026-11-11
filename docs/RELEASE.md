# Garrison Zero: release checklist

Status of the 0.9.0 launch candidate. Items marked **You** need someone with access to the accounts
(GitHub, Vercel, a domain registrar); everything else is done in the repo.

## Done in the build

| Area | State |
| --- | --- |
| Name and branding | Garrison Zero everywhere players see it: title screen wordmark, browser tab, installed-app name, emblem icon (SVG, 192/512 PNG, maskable, Apple touch icon), loading splash, link-preview image (`public/og-image.jpg`, 1200×630). |
| Modes | Tutorial (14 steps), Commander's Trail (8 stages), Skirmish (8 commanders × 6 maps × 3 difficulties, random layouts), Hold the Line, Sandbox. |
| Saving | Autosave every 30 s and when you leave; resume on return; one slot per browser. Trail, tutorial and settings progress kept locally. |
| Offline / install | Service worker caches the game after the first visit; installable to phone home screens. |
| Settings | Volumes, graphics quality, camera speeds, edge scrolling, look sensitivity and invert, help card. |
| Sound | Procedural effects and adaptive music (no audio files, nothing to license). |
| Errors | Any uncaught error shows a "Something went wrong" screen with Reload / Main menu and the build id, instead of a frozen page. |
| About | Version and build id, privacy note (no accounts, ads or tracking), credits, "Reset all progress". |
| Caching | Hashed assets cached for a year; three.js and React in their own files, so game updates don't re-download them. The service worker is never cached by the CDN. |
| Tests | 220+ automated tests (simulation, AI, maps, saves, tutorial, settings); browser checks on desktop, iPhone SE and iPhone 13 (landscape). |

## Performance (measured)

- Simulation: about 2.4 ms per 50 ms tick on average over a full 20-minute Hard match between two AI
  commanders (120+ units, 200+ structures).
- Pathfinding rebuilds are three times faster than before M7c. Rare ticks still take 40–60 ms when many
  units need fresh paths at once (about 30 times in that 20-minute match): at most a dropped frame or two.
- Download: about 260 KB of JavaScript gzipped in total (three.js 137 KB, React 69 KB, game 107 KB), 6 KB
  of CSS.
- Phones default to the low-quality preset (no shadows, fewer dynamic lights).

## Balance snapshot (Normal, a player who does nothing)

How long each commander takes to win against an idle player on Oasis Basin, which shows tempo:
Jackal about 5 minutes; The Engineer, The Broker, Duchess Varga, Nightshade and Old Sarge 7 to 11; The
Quartermaster and Warden 10 to 11. On Hard, against an AI defender of Old Sarge on Normal, Jackal, Old Sarge
and Duchess Varga break through on most maps; Nightshade, The Broker and The Quartermaster are the softest.

## Before going public: **You**

1. **Name check.** Run a trademark search and an app-store/web search on "Garrison Zero".
2. **Rename the repository** on GitHub (Settings → General → Repository name), e.g. to `garrison-zero`.
   Vercel follows the rename automatically.
3. **Vercel project.** Import the repo if you haven't (framework "Vite" is detected; build `npm run build`,
   output `dist`). Production deploys come from `main`.
4. **Domain (optional).** Add one in Vercel → Project → Domains. Then make the link-preview image URL
   absolute in `index.html` (`og:image` and `twitter:image`, e.g. `https://your-domain/og-image.jpg`): some
   sites (Facebook, LinkedIn) ignore relative image URLs.
5. **Smoke test the live site** on a desktop browser and a phone: start the tutorial, finish one step, reload
   (it should resume), toggle airplane mode and reload (it should still load).
6. **Optional:** add Vercel Web Analytics if you want visitor counts (cookie-free). The About screen says "no
   tracking", so update that text if you turn analytics on.

## Known limitations

- Single player only (by design).
- Art is code-built low-poly; no hand-made models or textures yet (asset budget, plan §4.1, is still open).
- Occasional short hitches when many units re-path at once (see Performance).
- One save slot per browser; saves don't sync between devices.

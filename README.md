# Emoji Autobattler — Defold port

A native Defold port of the React Native/Expo game in the repository root. The
React codebase is the source of truth for behavior; nothing in the parent
directory was modified. No React, HTML, CSS or WebView is embedded — the game
is Lua modules, collections, game objects, GUI scenes and message passing.

## Open and run

1. Open Defold and choose **Open Project** on this `defold-port` directory.
2. Press **F5** to build and run.

Debug builds run the port's test suite at boot and print
`PORT TESTS: N passed, 0 failed` to the console.

## Layout

- `game.project` — 390x844 portrait logical resolution (the phone frame the
  React app derived from its window).
- `game/` — pure Lua logic, one module per React source file:
  - `combat.lua` — combat.tsx: constants, animation timelines (holds/passes/
    order choreography), facing math, wave math, mob spawning.
  - `items.lua` — items.ts: item defs, loot, equipped bonuses.
  - `skills.lua` — skills.tsx: skill catalog/tree, stat curves, cone math.
  - `meta.lua` — menu.tsx: account meta, gold, run saves (sys.save/sys.load
    instead of AsyncStorage).
  - `sim.lua` — App.tsx's game loop: player/mob/ally AI, projectiles+pierce,
    the cone's damage riding its wave, burn chains, push, kick/flinch chain,
    waves/loot/XP, autosave and game-over events.
  - `effects.lua` — effects.tsx: background cover fit, puddle lookup, rain and
    ripple tuning.
  - `session.lua` — shared app state; `audio.lua` — sfx pools and music;
    `ui.lua` — GUI node helpers; `tests.lua` — the boot test suite.
- `main/` — collections, game objects, tilesources and GUI scenes:
  - Sprite sheets from the React app are used unchanged as 15x8 tilesources;
    animation playback is cursor-driven so the ported timeline code decides
    every frame, exactly as `animColumn` did.
  - `world.script` mirrors sim state into sprites (knight, zombies, corpses,
    blood, allies, glow, cone arcs) with painter's-order z by feet position.
  - `gui/` — menu (with intro slideshow), continue, skill tree, and the game
    screen (HUD, quick-cast, field overlays, inventory with drag, mob stats,
    settings, tooltips, game over, rain and ripples).
- `assets/` — copied unchanged from `../assets` (sprites, sounds); music
  decoded from mp3 to wav since Defold does not ship an mp3 decoder.

## Deliberate differences

- Skill buttons show short text labels instead of emoji icons (the default
  Defold font carries no color emoji).
- The menu plaque is a plain image button — the canvas "tear" effect and the
  animated intro-card fx were web-canvas decorations; the native branch of the
  React app also showed a plain image.
- The coin sack is not ported: it is disabled in the source
  (`COINSACK_ENABLED = false`). The sim still emits its coin events.
- The knight's rim-light sheets are copied but not yet drawn (screen-blend
  compositing needs a custom material).

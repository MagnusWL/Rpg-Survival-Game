import { AudioPlayer } from 'expo-audio';
import { Dimensions, Image, ImageSourcePropType, View } from 'react-native';
import type { RimStyle } from './effects';
import { rgb } from './effects';

// Screen/play-area dimensions, recomputed here rather than imported from
// App.tsx: App.tsx imports heavily from this module, so importing SCREEN_W/
// PLAY_H back from App.tsx would create a circular import where this module's
// top-level constants (e.g. makePlayer's use of PLAY_H) could evaluate before
// App.tsx has assigned them. Dimensions.get('window') is deterministic within
// a process, so recomputing it here yields the exact same numbers App.tsx
// uses -- see the same note in skills.ts and items.ts.
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const TOP_BAR_HEIGHT = 50;
const QUICK_CAST_BAR_HEIGHT = 48;
const HUD_HEIGHT = 60;
const PLAY_H = SCREEN_H - TOP_BAR_HEIGHT - QUICK_CAST_BAR_HEIGHT - HUD_HEIGHT;

export const PLAYER_RADIUS = 18;
/**
 * How fast he runs.
 *
 * 170 rather than 220. The run's animation is not tied to this -- it always
 * cycles at 2.13 steps a second -- so the speed is what decides how much ground
 * a step covers, and at 220 that was 103 px against his own height of 76. He
 * was taking strides longer than he is tall. At 170 a step is 80 px, which is
 * about his height, and that is what a run looks like.
 *
 * It only reads well downwards. Faster lengthens the stride until he skates;
 * much below 140 he keeps the same cadence over less ground and starts to
 * scurry. Below that the run would need tying to the speed the way the
 * entrance walk is, which the machinery is already there for.
 */
export const PLAYER_SPEED = 170; // px/sec

// --- Knight sprite sheets -------------------------------------------------
// Built by tools/build-sprites.mjs from the raw art in Grafik/Knight.
// Each sheet is a 15x8 grid: columns are animation frames, rows are facings.
export const SPRITE_CELL = 128; // must match OUT_CELL in tools/build-sprites.mjs
export const SPRITE_COLS = 15;
export const SPRITE_ROWS = 8;

// How big the knight is drawn, independent of the art's resolution. Tune freely:
// at 128 the sheets render pixel-for-pixel, above that they upscale.
export const PLAYER_SPRITE_SIZE = 128;

// How far below pos the sprite's bottom edge sits, i.e. where his feet land.
// Larger moves him down the screen. The art is not centred in its cell, so this
// cannot be derived -- it was eyeballed against the collision circle with a
// temporary slider. Well below the sprite's midpoint, because the knight only
// occupies the lower part of his 128px cell.
export const PLAYER_SPRITE_FOOT_OFFSET = 49;

/**
 * The entrance. He starts this far below the play area -- clear of the bottom
 * edge, since his sprite reaches 122 px above his feet.
 */
export const INTRO_START_BELOW = 140;
/** Where he stops, measured up from the bottom of the play area. */
export const INTRO_STOP_ABOVE_BOTTOM = 160;
/** He walks in rather than running, so the entrance moves at a walk's pace. */
export const INTRO_WALK_SPEED = 80; // px/sec, against PLAYER_SPEED's 170

/**
 * Steps drawn into one turn of a walk or run sheet.
 *
 * Two, in both. Established for the run by comparing every frame against the
 * mirror of the one half a cycle later: the match is best at exactly half,
 * because the far side of the cycle is the same pose on the other leg. The walk
 * moves too little to answer that way -- its frames differ by 2% where the run's
 * differ by 7%, and his shield swamps the rest -- but a cycle containing one
 * step would never swap his legs over, which is a hop rather than a walk.
 */
export const STEPS_PER_CYCLE = 2;

/**
 * The ground one step covers, and so how often his feet have to come round.
 *
 * A distance rather than a playback rate, because that is the thing that has to
 * hold: however fast he is going, his legs have to keep up with the floor. Left
 * as a rate it went wrong immediately -- slowing the entrance while holding the
 * rate steady had him covering 72 px per step, more than his own height of 66,
 * and he moonwalked. His feet reach 36 px apart at full stride, so 40 is a step
 * he could actually be taking.
 */
export const WALK_STRIDE = 40; // px

/**
 * Where in the cycle a foot lands, as a fraction of it.
 *
 * Measured off the run: his body sits lowest at frames 6 and 14 of 15, which is
 * the weight going onto a foot. The walk is assumed to match, being too subtle
 * to measure and by the same hand. One number moves both if it sounds early.
 */
export const FOOTSTEP_PHASE = 0.4;
/**
 * How long he stands before reaching for the sword.
 *
 * A tenth of a second: long enough that arriving and drawing read as two
 * movements rather than one, short enough that nothing is being waited out. It
 * was two seconds, which was a pause with nothing in it.
 */
export const INTRO_SETTLE = 0.1; // seconds
/**
 * The frame he holds while waiting.
 *
 * Not idle, which is the pose that already has the sword out -- dropping into it
 * here would hand him the blade a moment before he draws it. He holds the last
 * frame of the walk instead, which is also as close as that cycle gets to both
 * feet being under him: 41 px between his legs against 48 mid-stride.
 */
export const INTRO_HOLD_FRAME = SPRITE_COLS - 1;

export type AnimName = 'idle' | 'walk' | 'run' | 'attack' | 'hurt' | 'spawn' | 'kick' | 'die' | 'rupture' | 'ancestor';

/**
 * Where each frame of a sheet ended up once the empty space was packed out.
 *
 * A cell is nominally 128x128, but the knight rarely fills it, and padding
 * costs nothing on disk yet full price in memory, where a sheet is width x
 * height x 4 bytes whatever it holds. So the build crops every frame to its
 * own box and packs the 120 of them tight: 150 MB of him becomes 39.
 *
 * Six numbers a frame, in the order the build writes them:
 *   x, y  where the frame sits in the packed sheet
 *   w, h  how big it is
 *   ox,oy where it sat inside the old 128 cell
 *
 * That last pair is the important one. Adding it back when drawing is what
 * keeps every animation on the same anchor, so he does not shift when one
 * hands over to the next -- and a frame's rim shares its box exactly, or the
 * light would wander over him as he moved.
 */
export type SheetAtlas = { w: number; h: number; frames: number[][] };

export type AnimDef = {
  sheet: ImageSourcePropType;
  /** Set from atlas.json below. Absent means a plain 15x8 grid of 128 cells. */
  atlas?: SheetAtlas;
  /**
   * The rim light for this animation, frame for frame: white, with alpha
   * carrying how strongly each pixel is lit. Built by tools/build-sprites.mjs
   * from the sheet's own outline, so it can never reach past it. Only the
   * knight has one; the mobs leave it out and are drawn without.
   */
  rim?: ImageSourcePropType;
  fps: number;
  /** Looping animations repeat forever; one-shots hold their last frame. */
  loop: boolean;
  /**
   * How many rows the sheet has. Characters use one per facing; effects have no
   * facings and spend their rows on variants instead.
   */
  rows?: number;
  /** First column to play. Anything before it is skipped -- see ANIMS.attack. */
  from?: number;
  /**
   * Whether moving is allowed to cut this one-shot short. A swing has to finish;
   * a flourish should get out of the way the moment the player wants to go.
   */
  interruptedByMoving?: boolean;
  /**
   * Frames the animation dwells on: the picture holds for `seconds` on top of
   * its ordinary 1/fps, then playback resumes at full rate. Frames count from
   * 0 within the animation as played (after any skipped opening), and a frame
   * shown by several passes holds every time. Nicolai's tool for giving a
   * cast its beats.
   */
  holds?: { frame: number; seconds: number }[];
  /**
   * The passes the animation plays, in order; default is a single forward
   * run. 'rev' walks the frames backwards. A junction does not repeat the
   * shared frame, so a forward/backward pair turns around rather than
   * stuttering on the endpoint. Nicolai's tool for a cast that swells,
   * recedes and swells again.
   */
  passes?: ('fwd' | 'rev')[];
  /**
   * The exact frames to show, written out one by one, when the broad strokes
   * above cannot say it -- a bounce between two pictures, a repeat, anything.
   * Each entry is a frame index within the animation as played, optionally
   * carrying its own hold. Overrides `passes`, and `holds` does not apply:
   * with the choreography written out, every dwell belongs inline where the
   * eye can see it.
   */
  order?: (number | { frame: number; hold: number })[];
};

/** Frames an animation actually plays, once any skipped opening is taken off. */
export const animSpan = (a: AnimDef) => SPRITE_COLS - (a.from ?? 0);

/**
 * The swing skips its opening. Frames 0-4 of the melee sheet are pure wind-up --
 * the sword drawn back with nothing moving -- and the blade only starts round at
 * frame 5. Playing them made every blow feel like it arrived late. Starting at 5
 * cuts the animation from 0.63 s to 0.42 s and puts the strike a tenth of a
 * second after the button rather than a third.
 */
export const ATTACK_FROM = 5;
/** Absolute frame where the blade is fully round; frames 7-9 read as the strike. */
export const ATTACK_STRIKE_FRAME = 8;

export const ANIMS: Record<AnimName, AnimDef> = {
  idle: {
    sheet: require('./assets/sprites/knight/idle.png'),
    rim: require('./assets/sprites/knight/idle-rim.png'),
    fps: 10,
    loop: true,
  },
  // Only the entrance walks. Ordinary movement is a run, and always has been.
  walk: {
    sheet: require('./assets/sprites/knight/walk.png'),
    rim: require('./assets/sprites/knight/walk-rim.png'),
    fps: 12,
    loop: true,
  },
  run: {
    sheet: require('./assets/sprites/knight/run.png'),
    rim: require('./assets/sprites/knight/run-rim.png'),
    fps: 16,
    loop: true,
  },
  attack: {
    sheet: require('./assets/sprites/knight/melee.png'),
    rim: require('./assets/sprites/knight/melee-rim.png'),
    fps: 24,
    loop: false,
    from: ATTACK_FROM,
  },
  hurt: {
    sheet: require('./assets/sprites/knight/takedamage.png'),
    rim: require('./assets/sprites/knight/takedamage-rim.png'),
    fps: 22,
    loop: false,
  },
  // How a run opens: he arrives empty-handed, reaches back for the hilt around
  // frame 5, sweeps the blade out by 12 and settles into a guard that is nearly
  // the idle pose already, so it hands over without a jump.
  //
  // Movement cuts it short. It is a flourish, not a cutscene, and a player who
  // wants to move should not be made to watch it.
  spawn: {
    sheet: require('./assets/sprites/knight/unsheathsword.png'),
    rim: require('./assets/sprites/knight/unsheathsword-rim.png'),
    fps: 16,
    loop: false,
    interruptedByMoving: true,
  },
  // The answer to being hit mid-rhythm: after the flinch, if the crowd is
  // still on him, he kicks it off. Movement cuts it short on purpose --
  // Nicolai's call: a player who wants out should not be held for a flourish.
  kick: {
    sheet: require('./assets/sprites/knight/kick.png'),
    rim: require('./assets/sprites/knight/kick-rim.png'),
    fps: 22,
    loop: false,
    interruptedByMoving: true,
  },
  // The fall. Nothing interrupts it -- the dying branch sits at the very top
  // of the animation chain -- and being a one-shot it holds its last frame
  // while the field plays on, until the game-over screen takes over.
  die: {
    sheet: require('./assets/sprites/knight/die.png'),
    rim: require('./assets/sprites/knight/die-rim.png'),
    fps: 14,
    loop: false,
  },
  // The two skill casts, named by Nicolai: Special1 answers Cone as
  // "Rupture", Special2 answers Summon as "Ancestor". The skill's effect
  // fires the instant the button is pressed -- these are the pose, not the
  // effect, so cutting them short (or skipping them on the run) costs
  // nothing but the look.
  rupture: {
    sheet: require('./assets/sprites/knight/special1.png'),
    rim: require('./assets/sprites/knight/special1-rim.png'),
    fps: 18,
    loop: false,
    interruptedByMoving: true,
    // Nicolai's choreography, 20 July -- this exact list is his, written in
    // the step notation and handed over verbatim: longer breath, a third
    // swing, longer freeze.
    order: [
      0, 1, 2, 3, 4, 5,
      { frame: 6, hold: 0.3 },
      7, 8, 9, 10,
      11, 12, 11, 12, 11,
      { frame: 12, hold: 0.5 },
      13, 14,
    ],
  },
  ancestor: {
    sheet: require('./assets/sprites/knight/special2.png'),
    rim: require('./assets/sprites/knight/special2-rim.png'),
    fps: 18,
    loop: false,
    interruptedByMoving: true,
    // Nicolai's shape, 20 July: the cast rises, withdraws, and rises again
    // to stay -- forward, backward, forward, ending on the last frame.
    passes: ['fwd', 'rev', 'fwd'],
  },
};

/**
 * The boxes the build trimmed each of his sheets to, keyed by the sheet's own
 * name -- which is also the animation's, so they meet here.
 *
 * Attached after the fact rather than written into all ten entries above: the
 * numbers are the build's to decide, and repeating them by hand is how the art
 * and the drawing would come to disagree. Rebuild with TRIM off and this file
 * says 128x128 everywhere, which is exactly the old behaviour.
 */
const KNIGHT_ATLAS: { sheets: Record<string, SheetAtlas> } = require('./assets/sprites/knight/atlas.json');

/** Animations whose sheet is not named after them. The rest match already. */
const SHEET_FILE: Partial<Record<AnimName, string>> = {
  attack: 'melee',
  hurt: 'takedamage',
  spawn: 'unsheathsword',
  rupture: 'special1',
  ancestor: 'special2',
};
for (const [name, def] of Object.entries(ANIMS) as [AnimName, AnimDef][]) {
  const packed = KNIGHT_ATLAS.sheets[SHEET_FILE[name] ?? name];
  if (packed) def.atlas = packed;
}

/**
 * The kick's reach and where it lands, all Nicolai's choices of 20 July.
 *
 * It follows a flinch only when someone is actually inside this range -- a
 * kick into empty air looks daft -- and only half the time: one coin flip in
 * the frame the flinch ends keeps it a flourish rather than a reflex. It
 * shoves everyone in the arc, not just whoever the invisible swing touched:
 * clearing space is what a kick is for. The shove itself is the same
 * knockback a visible swing deals, moved here from the swing nobody saw --
 * which means on the flips where no kick comes, that blow shoves nobody at
 * all. Nicolai knows and wants it so: the kick deals no damage either way.
 *
 * Contact lands on frame 6 of 15: the leg is out and the shove fires with it
 * rather than on the wind-up.
 */
export const KICK_RANGE = 70;
/** Half-angle of the arc, as a dot-product threshold: cos(60) = a 120 degree fan. */
export const KICK_ARC_COS = 0.5;
export const KICK_CONTACT_FRAME = 6;
/** Chance a flinch is answered with the kick at all. */
export const KICK_CHANCE = 0.5;

/**
 * How long the death animation's last frame holds before the game-over screen
 * takes over. The fall itself takes its length from the sheet; this is the
 * beat of stillness after it, so the screen does not slam in on the final
 * frame of the fall.
 */
export const DIE_HOLD = 0.45;

export type Vec = { x: number; y: number };

/** The screen-space direction a facing row looks in; row 0 is east, clockwise. */
export const facingVector = (facing: number): Vec => {
  const a = (facing * Math.PI) / 4;
  return { x: Math.cos(a), y: Math.sin(a) };
};

/**
 * How fast to run the walk sheet so his feet hold the ground at INTRO_WALK_SPEED.
 *
 * Derived rather than typed in, so it stays right if the entrance is ever asked
 * to speed up or slow down again. At 80 px/sec and a 40 px stride this comes out
 * at 1.25 -- a step every half second, against the 0.9 he was taking.
 */
export const INTRO_WALK_ANIM =
  SPRITE_COLS / ANIMS.walk.fps / ((STEPS_PER_CYCLE * WALK_STRIDE) / INTRO_WALK_SPEED);

// The zombie art arrives as loose frames per direction and is packed into the
// same 15x8 grid by tools/build-sprites.mjs, so it shares everything above.
export type MobAnimName = 'walk' | 'attack' | 'attack2' | 'attack3' | 'hurt';

export const MOB_ANIMS: Record<MobAnimName, AnimDef> = {
  walk: { sheet: require('./assets/sprites/zombie/walk.png'), fps: 12, loop: true },
  attack: { sheet: require('./assets/sprites/zombie/attack.png'), fps: 16, loop: false },
  attack2: { sheet: require('./assets/sprites/zombie/attack2.png'), fps: 16, loop: false },
  attack3: { sheet: require('./assets/sprites/zombie/attack3.png'), fps: 16, loop: false },
  hurt: { sheet: require('./assets/sprites/zombie/hurt.png'), fps: 20, loop: false },
};

// The two falls a melee zombie can take, kept out of MOB_ANIMS on purpose:
// every living mob mounts every sheet in its map, and the living have no use
// for these. Only the corpse layer mounts them, briefly.
export type MobDieAnimName = 'die' | 'die2';
export const MOB_DIE_ANIMS: Record<MobDieAnimName, AnimDef> = {
  die: { sheet: require('./assets/sprites/zombie/die.png'), fps: 14, loop: false },
  die2: { sheet: require('./assets/sprites/zombie/die2.png'), fps: 14, loop: false },
};

/**
 * A fallen zombie, purely visual. It left the mobs array -- and every rule
 * that reads it: loot, gold, wave count, targeting, the kick's fan -- the
 * frame it died, exactly as before. This plays the fall where it happened,
 * lies a moment, fades and is gone.
 */
export type Corpse = { id: number; pos: Vec; facing: number; anim: MobDieAnimName; age: number };
/** Seconds a corpse lies after its fall finishes, and the fade that follows. */
export const CORPSE_LINGER = 1.4;
export const CORPSE_FADE = 0.6;

/**
 * The red instant when a mob is struck.
 *
 * Kept very short. It is a punctuation mark, not a state -- long enough to
 * register that the blow landed, gone before the next one.
 */
export const MOB_FLASH_COLOR = '#ff4a3d';
export const MOB_FLASH_TIME = 0.12; // seconds
export const MOB_FLASH_STRENGTH = 0.75;

/**
 * Shortest gap between two flinches on the same mob.
 *
 * The same discipline the knight needed. The player swings roughly every 0.8 s
 * and a flinch runs 0.75 s, so without this a mob under attack would twitch
 * continuously and never be seen to swing back.
 */
export const MOB_HURT_ANIM_MIN_GAP = 1.4; // seconds

/** Picked at random per swing, so a crowd of zombies does not attack in lockstep. */
export const MOB_ATTACK_ANIMS: MobAnimName[] = ['attack', 'attack2', 'attack3'];

// --- Effects (blood) -------------------------------------------------------
// Blood has no facings; tools/build-sprites.mjs packs its five variants as the
// sheet's rows, so choosing one is the same lookup as choosing a facing.
export const BLOOD_VARIANTS = 5;
export const BLOOD_ANIM: AnimDef = {
  sheet: require('./assets/sprites/effects/blood.png'),
  fps: 20,
  loop: false,
  rows: BLOOD_VARIANTS,
};
export const BLOOD_ANIMS = { blood: BLOOD_ANIM };
export const BLOOD_DURATION = SPRITE_COLS / BLOOD_ANIM.fps; // seconds
export const BLOOD_SIZE = 128;

// Drawn the same size as the knight, both being human-sized. The foot offset is
// smaller because a mob's collision circle is smaller (14 against 18), and it
// comes from measurement rather than taste: the zombie leaves 19 px of empty
// cell below its feet where the knight leaves 17.
export const MOB_SPRITE_SIZE = 128;
export const MOB_SPRITE_FOOT_OFFSET = 44;

/** True when the animation cannot use the plain time-to-frame arithmetic. */
export const hasTimeline = (a: AnimDef) => !!(a.holds?.length || a.passes || a.order);

/** Extra seconds a given frame holds for, on top of its 1/fps. */
export const holdFor = (a: AnimDef, frame: number) =>
  a.holds?.find((h) => h.frame === frame)?.seconds ?? 0;

/**
 * The frames in the order they are shown, one entry per shown frame with how
 * long it stays up, compiled from `order` or `passes`+`holds` and cached per
 * definition -- animColumn runs every render for every mounted sheet, and
 * this list never changes.
 */
export const playStepsCache = new WeakMap<AnimDef, { frame: number; dwell: number }[]>();
export function playSteps(a: AnimDef): { frame: number; dwell: number }[] {
  let steps = playStepsCache.get(a);
  if (!steps) {
    const base = 1 / a.fps;
    if (a.order) {
      steps = a.order.map((s) =>
        typeof s === 'number' ? { frame: s, dwell: base } : { frame: s.frame, dwell: base + s.hold }
      );
    } else {
      const span = animSpan(a);
      const frames: number[] = [];
      for (const p of a.passes ?? ['fwd']) {
        const pass = Array.from({ length: span }, (_, i) => (p === 'fwd' ? i : span - 1 - i));
        // The junction frame is already on screen; showing it twice would
        // freeze the turn for a beat nobody asked for.
        if (frames.length && frames[frames.length - 1] === pass[0]) pass.shift();
        frames.push(...pass);
      }
      steps = frames.map((f) => ({ frame: f, dwell: base + holdFor(a, f) }));
    }
    playStepsCache.set(a, steps);
  }
  return steps;
}

/** Seconds an animation takes to play once, passes and held frames included. */
export const animDuration = (a: AnimDef) => {
  if (!hasTimeline(a)) return animSpan(a) / a.fps;
  let d = 0;
  for (const s of playSteps(a)) d += s.dwell;
  return d;
};

/**
 * Seconds into an animation before a given frame first comes up.
 *
 * For hanging something on a picture rather than on a stopwatch: ask the
 * choreography when it gets there, and the answer follows the choreography
 * if it is ever rewritten.
 */
export function frameStartTime(a: AnimDef, frame: number) {
  let t = 0;
  for (const s of playSteps(a)) {
    if (s.frame === frame) return t;
    t += s.dwell;
  }
  return 0;
}

// --- Sound ---------------------------------------------------------------
// Built by tools/build-sounds.mjs from the raw pack in Lyde/.
//
// Both tone and level are baked into the files rather than set here. Mobile has
// no equaliser, and iOS browsers refuse programmatic volume outright -- Apple
// reserves it for the hardware buttons -- so anything set at runtime either did
// nothing or worked on some platforms only. Balancing one clip against another
// happens in tools/sound-config.mjs, where each can carry its own level.

/**
 * How often a killing blow gets the heavier stab combo instead of the ordinary
 * swing. Kept well below certainty on purpose: a flourish that fires on every
 * kill stops registering as one.
 */
export const KILL_SFX_CHANCE = 0.3;

/**
 * Extra splats thrown when the gore version of a kill sound is the one that
 * plays. The two are bound together at the moment the sound fires, so the
 * bloodier sound never plays without the mess to go with it.
 */
export const GORE_EXTRA_SPLATS = 3;
export const GORE_SPLATTER_SPREAD = 32; // px around where the body fell

/**
 * How long after a swing begins before its sound plays.
 *
 * Derived rather than picked, so it follows the animation instead of having to
 * be re-tuned by hand: the strike is a known frame, and the clips take about
 * 40 ms to reach full level, so they start that much ahead of it.
 */
/** When the blade is round, measured from the moment the swing begins. */
export const SWING_STRIKE_AT = (ATTACK_STRIKE_FRAME - ATTACK_FROM) / ANIMS.attack.fps;

/**
 * How long each clip takes to reach full level, measured by the build.
 *
 * A sound meant to land on a frame has to be started early by exactly this
 * much, and it is not one number: across the swing pool it runs from 29 ms to
 * 129 ms. One value for all of them was 40, which put the gore clips 90 ms
 * behind the blade -- and since the clip is drawn at random, whether a blow
 * sounded like it connected came down to which one came up.
 */
export const CLIP_LEAD: Record<string, number> = require('./assets/sounds/leads.json');
export const leadsFor = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => CLIP_LEAD[`${prefix}-${i + 1}`] ?? 0);
export const ATTACK_LEADS = leadsFor('attack', 3);
export const KILL_LEADS = leadsFor('kill', 3);
export const GORE_LEADS = leadsFor('gore', 3);
export const KICK_LEADS = leadsFor('kick', 2);

/**
 * Shortest gap between two flinch animations.
 *
 * A flinch used to outrank everything and lasts 0.68 s, so under any real
 * pressure the knight never got to finish a swing: simulated against two mobs in
 * contact he landed 25 blows and visibly swung once, spending the rest of the
 * time twitching. With this and the mid-swing guard below, that goes back to
 * about two thirds of blows showing a swing.
 *
 * The hurt sound rides on the flinch, so this also sets how often he can be
 * heard taking a hit. Raise it to hear him less.
 */
export const HURT_ANIM_MIN_GAP = 1.2; // seconds

/**
 * Kill switch for every effect clip, flipped by the debug row in the corner.
 *
 * For hunting the hitches by ear: the readout shows 90 ms spikes tied to
 * movement, and every step plays two clips -- so this lets a minute be played
 * with that suspect removed entirely, on the machine where the lag is real.
 * Module-level rather than state because playSfx is called from the game
 * loop, where state would be a render behind.
 *
 * Held as a property on an object, not a bare `let`, so App.tsx -- which owns
 * the toggle -- can flip it without an ES module import (a read-only binding)
 * standing in the way.
 */
export const SFX_STATE = { killed: false };

/** Fire and forget. Audio is a garnish -- it must never break the game loop. */
export function playSfx(player: AudioPlayer | undefined) {
  if (!player || SFX_STATE.killed) return;
  try {
    // Rewind first: a finished clip will not restart from its own end.
    player.seekTo(0);
    player.play();
  } catch {
    // ignored on purpose
  }
}

/**
 * Column of the sheet to draw. One-shots stop on the last frame rather than
 * wrapping. With `holds` or `passes`, time is walked along the play order --
 * each shown frame spends its 1/fps plus whatever hold it carries -- so a
 * held picture simply lasts longer, and a reverse pass runs the pictures
 * backwards, while everything else plays at the ordinary rate.
 */
export function animColumn(a: AnimDef, animTime: number) {
  const from = a.from ?? 0;
  if (hasTimeline(a)) {
    const steps = playSteps(a);
    let t = a.loop ? animTime % animDuration(a) : animTime;
    let i = 0;
    while (i < steps.length - 1 && t >= steps[i].dwell) {
      t -= steps[i].dwell;
      i++;
    }
    return from + steps[i].frame;
  }
  const span = animSpan(a);
  const frame = Math.floor(animTime * a.fps);
  return from + (a.loop ? frame % span : Math.min(frame, span - 1));
}

// Row order going down each sheet is E, SE, S, SW, W, NW, N, NE -- one 45 degree
// step clockwise per row, starting at east. Established by driving the game and
// watching which way the knight actually ran, which is worth trusting over
// reading the art: the sword and shield extend along the facing direction, so a
// knight in profile has a WIDER silhouette than one seen head-on, and reasoning
// from the shapes gets east and north exactly backwards.
export const SPRITE_ROW_FOR_EAST = 0;

/**
 * Which way to face when swinging, given everything within reach.
 *
 * Picks the nearest target, except that any target already lying in the
 * direction the knight faces wins outright. Without that, two enemies at
 * similar range trade places as "nearest" and he flips between them.
 *
 * Facing is cosmetic here -- the melee swing damages everything in its radius
 * regardless of where he looks -- so this only has to read naturally.
 */
export function facingForTargets(from: Vec, targets: Vec[], current: number) {
  let best: Vec | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    if (facingFromDelta(t.x - from.x, t.y - from.y) === current) return current;
    const d = dist(from, t);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best ? facingFromDelta(best.x - from.x, best.y - from.y) : current;
}

export function facingFromDelta(dx: number, dy: number) {
  // atan2 is 0 at east and grows clockwise on screen, since y points down --
  // the same direction the rows advance, so this adds rather than subtracts.
  const eighths = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return (((SPRITE_ROW_FOR_EAST + eighths) % SPRITE_ROWS) + SPRITE_ROWS) % SPRITE_ROWS;
}

// The inverse: a unit vector pointing the way a given facing row looks. East is
// row 0 and rows advance clockwise, so the angle is simply facing * 45 degrees.
export function directionFromFacing(facing: number): Vec {
  const angle = ((facing - SPRITE_ROW_FOR_EAST) * Math.PI) / 4;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
export const PLAYER_ATTACK_RANGE = 60;
export const RANGED_ATTACK_RANGE = 240;
export const PLAYER_ATTACK_COOLDOWN = 0.8; // sec
export const PLAYER_BASE_DAMAGE = 8;

export const MOB_RADIUS = 14;
export const BOSS_RADIUS = 26;
export const MOB_SPEED = 60; // px/sec
export const MOB_ATTACK_RANGE = 40;
export const MOB_RANGED_FIRE_RANGE = 170;
export const MOB_ATTACK_COOLDOWN = 1.2;
export const MOB_MAX_HP = 20; // wave 1 base
export const MOB_DAMAGE = 5; // wave 1 base
export const MOB_XP_REWARD = 15;
export const BOSS_XP_REWARD = 120;

/**
 * Coins into the sack for a kill.
 *
 * Not an economy: this game has no money, and whether it should have reaches
 * into Magnus's gameplay rather than our animation. The sack needed something
 * to react to, and a kill is the obvious something. It keeps its own count.
 */
export const MOB_COIN_CHANCE = 0.5; // a zombie is worth a coin half the time, nothing the rest
export const BOSS_COINS = 5;

/**
 * The shove a mob takes when it is struck.
 *
 * Speed at the instant of the blow, not a distance: it is fed into the same
 * position that everything else moves, and fades away rather than stopping, so
 * the mob is pushed rather than teleported. Roughly, it travels SPEED x TAU
 * before it settles -- about 22 px as these stand, which reads as a stagger
 * without undoing the ground it has covered.
 *
 * The variation is what stops a row of blows looking mechanical. Weight comes
 * from the body: a boss is nearly twice the radius, so it barely rocks.
 */
export const KNOCKBACK_SPEED = 260; // px/sec
export const KNOCKBACK_VARIATION = 0.45; // +/- this much of it, per blow
export const KNOCKBACK_TAU = 0.085; // sec; how quickly the shove bleeds off
export const KNOCKBACK_STOP = 8; // px/sec below which it is over

export const WAVE_SPAWN_INTERVAL = 0.5; // sec between mob spawns within a wave
export const MANA_REGEN_PER_SEC = 4;
export const MANA_MAX = 100;

export const ALLY_RADIUS = 12;
export const ALLY_SPEED = 90;
export const ALLY_ATTACK_RANGE = 50;
export const ALLY_ENGAGE_RANGE = 200;
export const ALLY_RANGED_ATTACK_RANGE = 160;
export const ALLY_RANGED_ENGAGE_RANGE = 260;
export const ALLY_ATTACK_COOLDOWN = 1.0;

export const PROJECTILE_SPEED = 700; // px/sec
export const HIT_FLASH_DURATION = 150; // ms
export const SKILL_MARK_DURATION = 700; // ms -- how long the lingering skill marks take to fade
export const FLOATING_TEXT_DURATION = 700; // ms
export const FLOATING_TEXT_RISE = 32; // px

export type MobType = 'melee' | 'ranged' | 'boss';

export type Mob = {
  id: number;
  type: MobType;
  /** Which wave spawned this mob, so a wave clears when its own mobs are gone. */
  wave: number;
  pos: Vec;
  hp: number;
  maxHp: number;
  damage: number;
  radius: number;
  attackCooldown: number;
  facing: number; // 0-7, same row order as the player
  anim: MobAnimName;
  animTime: number;
  /** Seconds left of the red flash, and of the wait before another flinch. */
  flashTime: number;
  hurtGap: number;
  /** Speed left in the shove from the last blow, px/sec. Zero when at rest. */
  knock: Vec;
  /** Set by the Burn skill: the mob explodes on death for this fraction of its
   * max HP. Zero/undefined means it is not burning. */
  burnPct?: number;
  /** Burn's damage-over-time to the target itself, HP per second while afire. */
  burnDps?: number;
};

export type Ally = {
  id: number;
  pos: Vec;
  hp: number;
  maxHp: number;
  damage: number;
  attackCooldown: number;
  ranged: boolean;
};

export type Projectile = {
  id: number;
  from: Vec;
  to: Vec;
  createdAt: number;
  duration: number;
  color: string;
  damage: number;
  friendly: boolean; // true = player/ally shooting a mob; false = mob shooting player/ally
  targetKind: 'mob' | 'player' | 'ally';
  targetId: number;
  /** Pierce: extra enemies this shot damages along its line, beyond the target. */
  pierce?: number;
};
export type HitFlash = { id: number; pos: Vec; createdAt: number };
export type BloodSplat = { id: number; pos: Vec; variant: number; createdAt: number };
// A simple fading ring left on the ground where a skill hit -- Cone, Fireball,
// Burn and Push each drop one so their impact lingers a beat after the numbers land.
export type FloatingText = { id: number; text: string; pos: Vec; color: string; createdAt: number };

export const MOB_TYPE_META: Record<MobType, { name: string; color: string; radius: number }> = {
  melee: { name: 'Melee', color: '#e05555', radius: MOB_RADIUS },
  ranged: { name: 'Ranged', color: '#ff9800', radius: MOB_RADIUS },
  boss: { name: 'Boss', color: '#ab47bc', radius: BOSS_RADIUS },
};

export type PlayerState = {
  pos: Vec;
  target: Vec | null;
  hp: number;
  maxHp: number;
  mana: number;
  level: number;
  xp: number;
  xpToNext: number;
  attackCooldown: number;
  hasteTimer: number;
  facing: number; // 0-7, which row of the sprite sheet to draw
  anim: AnimName;
  animTime: number; // seconds spent in the current animation
  /** Playback multiplier for the current animation; 1 is the sheet's own rate. */
  animSpeed: number;
  /**
   * The arrival. He runs in from below the screen, stands a moment, then draws.
   * 'done' from the first tap onwards -- it is an entrance, not something to sit
   * through, so wanting to move ends it.
   */
  introPhase: 'enter' | 'settle' | 'draw' | 'done';
  introTimer: number;
};

export function dist(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalizeAngle(deg: number) {
  let d = deg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

export function xpForLevel(level: number) {
  return 40 + (level - 1) * 25;
}

/**
 * Draws one frame of a sprite sheet: a clipping box with the sheet inside it,
 * shifted so the wanted cell lands in view.
 *
 * `mountAllAnims` keeps every animation mounted and toggles opacity instead of
 * swapping the active one. Swapping a single Image's source makes
 * react-native-web reload it -- it renders the picture as a CSS background and
 * clears that background while the new one loads, even from cache -- and the
 * frames in between draw nothing, so the character blinks each time the
 * animation changes. Worth paying for the knight, who is one sprite mounting
 * five sheets; not worth it for a crowd of mobs, where the same choice is five
 * sheets each, times however many are alive, and a blink lost in a crowd of
 * bodies is not one anybody sees. Mobs and corpses swap the source directly.
 */
export function SpriteSheet({
  anims,
  anim,
  animTime,
  facing,
  size,
  left,
  top,
  flash,
  rim,
  mountAllAnims = false,
}: {
  anims: Record<string, AnimDef>;
  anim: string;
  animTime: number;
  facing: number;
  size: number;
  left: number;
  top: number;
  /**
   * A tint laid over the character for an instant, following its outline
   * exactly, since it is the same frame drawn again in a single colour.
   */
  flash?: { color: string; opacity: number };
  /**
   * The moon on his edge. Only drawn for animations that were built with a rim
   * sheet, which is the knight's and no one else's.
   */
  rim?: RimStyle;
  /** See the doc comment above -- on for the knight, off for everyone else. */
  mountAllAnims?: boolean;
}) {
  const active = anims[anim];
  const activeRows = active ? active.rows ?? SPRITE_ROWS : SPRITE_ROWS;
  // Every anim's entry when mounting them all; otherwise just the one frame
  // actually on screen, keyed on the anim name so swapping still remounts it
  // (the source-reload blink this trades away in exchange for the node count).
  const shownAnims = mountAllAnims ? Object.entries(anims) : active ? [[anim, active] as [string, AnimDef]] : [];
  /**
   * One frame of one sheet, clipped to its own cell and set down where that
   * cell used to sit inside the nominal 128 box.
   *
   * The clipping has to happen here rather than on the outer box, and that is
   * the whole subtlety of trimming: an untrimmed cell is exactly as big as the
   * box, so the box alone hid the neighbours. A trimmed cell is smaller -- idle
   * is 60x79 -- so a 128 box would show the frames on either side of the one
   * wanted. Measured before it was believed: the silhouette filled the box
   * corner to corner instead of standing in it.
   *
   * With the offset added back the frame lands exactly where the untrimmed one
   * did, which is what keeps every animation on a shared anchor. Untrimmed,
   * `trim` is absent and this reduces to what it always was.
   */
  const cell = (def: AnimDef, source: ImageSourcePropType, key: string, opacity: number, tint?: string) => {
    const rows = def.rows ?? SPRITE_ROWS;
    const col = animColumn(def, animTime);
    const row = Math.min(facing, rows - 1);
    // The box is `size` across for one nominal 128 cell, so this is how much
    // the art is scaled by -- 1 while the knight is drawn at his native size.
    const s = size / SPRITE_CELL;

    // Packed: the frame sits wherever the packer put it, and carries the
    // offset it had inside its old 128 cell. Unpacked: a plain grid, which is
    // the same arithmetic with the offsets all zero and the cells all 128.
    const packed = def.atlas?.frames[row * SPRITE_COLS + col];
    const [fx, fy, fw, fh, ox, oy] = packed ?? [
      SPRITE_CELL * col, SPRITE_CELL * row, SPRITE_CELL, SPRITE_CELL, 0, 0,
    ];
    // A frame with nothing drawn in it. None of the knight's are, but a sheet
    // that opens on an empty pose would be, and drawing a zero-sized window
    // is a way to leave a stray pixel on screen.
    if (fw === 0) return null;
    const sheetW = def.atlas ? def.atlas.w : SPRITE_CELL * SPRITE_COLS;
    const sheetH = def.atlas ? def.atlas.h : SPRITE_CELL * rows;

    return (
      <View
        key={key}
        style={{
          position: 'absolute',
          left: ox * s,
          top: oy * s,
          width: fw * s,
          height: fh * s,
          overflow: 'hidden',
          opacity,
        }}
      >
        <Image
          source={source}
          tintColor={tint}
          style={{
            position: 'absolute',
            width: sheetW * s,
            height: sheetH * s,
            left: -fx * s,
            top: -fy * s,
          }}
        />
      </View>
    );
  };
  return (
    <View style={{ position: 'absolute', width: size, height: size, overflow: 'hidden', left, top }}>
      {shownAnims.map(([name, def]) =>
        cell(def, def.sheet, name, mountAllAnims && name !== anim ? 0 : 1)
      )}

      {/* The light on his lit edge: the matching frame of the rim sheet, tinted
          and faded as it is drawn.

          Every rim sheet stays mounted and only the active one is visible --
          the same rule the sheets above follow, and for the same two reasons.
          Swapping one Image's source makes react-native-web reload it and draw
          nothing in between, so the light blinked off at every animation
          change. Worse, an unmounted sheet's decoded pixels are the first
          thing the browser evicts, so each swap back was a fresh 7.5 MB decode
          on the main thread -- measured in play as 90 ms hitches that landed
          exactly on stopping, starting and striking. Only the knight carries a
          rim at all, and he is always mountAllAnims, so this list is never the
          single-frame kind in practice -- written to match anyway, in case a
          rim ever finds its way onto something drawn single-frame.

          The blend goes on a wrapper rather than on the image, the way the
          ground glow does it -- it has to mix with him, and an element that
          blends is the one that has to hold the mode. */}
      {rim && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: size,
            height: size,
            mixBlendMode: rim.blend,
          }}
        >
          {/* The same box as the sheet it lights: the build crops a sheet and
              its rim together for exactly this reason. */}
          {shownAnims.map(([name, def]) =>
            def.rim
              ? cell(def, def.rim, name, mountAllAnims && name !== anim ? 0 : rim.strength, rgb(rim.color))
              : null
          )}
        </View>
      )}

      {/* The same frame again in one colour, laid on top. Only the active sheet
          is drawn twice, and only while a flash is running. */}
      {flash && flash.opacity > 0 && active &&
        cell(active, active.sheet, 'flash', flash.opacity, flash.color)}
    </View>
  );
}

/**
 * Marks a mob as struck: the red instant and the shove always, and a flinch
 * when it is free to take one.
 *
 * The flash and the flinch are deliberately separate. A flash on every blow
 * reads as a hit landing; a flinch on every blow would leave anything under
 * attack twitching without ever swinging back, which is exactly what the knight
 * did before his own flinch was reined in. The shove sides with the flash: it
 * costs the mob no animation, so there is nothing for it to compete with.
 *
 * `from` is wherever the blow came from -- the swinger, or the spot a shot was
 * loosed. The mob goes directly away from it.
 */
/**
 * The shove alone, shared by the two things that deliver one: a swing the
 * player can see, and the kick that answers a flinch. One source of truth so
 * the kick pushes exactly as hard as a blow always has.
 */
export function shoveMob(m: Mob, from: Vec) {
  const dx = m.pos.x - from.x;
  const dy = m.pos.y - from.y;
  const len = Math.hypot(dx, dy);
  // Standing exactly on the attacker leaves no direction to be pushed in.
  if (len > 0.001) {
    const vary = 1 + (Math.random() * 2 - 1) * KNOCKBACK_VARIATION;
    const speed = KNOCKBACK_SPEED * vary * (MOB_RADIUS / m.radius);
    m.knock = { x: (dx / len) * speed, y: (dy / len) * speed };
  }
}

export function hurtMob(m: Mob, from?: Vec) {
  m.flashTime = MOB_FLASH_TIME;

  if (from) shoveMob(m, from);

  const def = MOB_ANIMS[m.anim];
  const busy = !def.loop && m.animTime < animDuration(def);
  if (!busy && m.hurtGap <= 0) {
    m.anim = 'hurt';
    m.animTime = 0;
    m.hurtGap = MOB_HURT_ANIM_MIN_GAP;
  }
}

export function makePlayer(): PlayerState {
  return {
    // Below the bottom edge, out of sight, running for the spot he normally
    // starts on. The ordinary movement code carries him there, which also turns
    // him north on the way -- so he is already looking up the screen when he
    // stops, and draws his sword facing that way.
    pos: { x: SCREEN_W / 2, y: PLAY_H + INTRO_START_BELOW },
    target: { x: SCREEN_W / 2, y: PLAY_H - INTRO_STOP_ABOVE_BOTTOM },
    hp: 100,
    maxHp: 100,
    mana: MANA_MAX,
    level: 1,
    xp: 0,
    xpToNext: xpForLevel(1),
    attackCooldown: 0,
    hasteTimer: 0,
    facing: 6, // north, the way he is about to run
    anim: 'walk',
    animTime: 0,
    // Set here rather than left to the animation code, which only revisits the
    // rate when an animation changes -- and the entrance never changes it. He
    // opens walking and keeps walking, so the walk is never restarted and the
    // rate would stay at the sheet's own while his pace was not.
    animSpeed: INTRO_WALK_ANIM,
    // Every way into a run rebuilds the player from here, so each one opens
    // with the entrance.
    introPhase: 'enter',
    introTimer: 0,
  };
}

let mobIdCounter = 0;
let allyIdCounter = 0;
let floatingTextIdCounter = 0;

export function spawnMob(type: MobType, wave: number): Mob {
  mobIdCounter += 1;
  const meta = MOB_TYPE_META[type];
  const stats = mobTypeStats(type, wave);
  const margin = meta.radius + 4;
  return {
    id: mobIdCounter,
    type,
    wave,
    pos: { x: margin + Math.random() * (SCREEN_W - margin * 2), y: meta.radius },
    hp: stats.hp,
    maxHp: stats.hp,
    damage: stats.damage,
    radius: meta.radius,
    attackCooldown: 0,
    facing: 2, // south -- mobs spawn at the top edge walking down towards the player
    anim: 'walk',
    animTime: 0,
    flashTime: 0,
    hurtGap: 0,
    knock: { x: 0, y: 0 },
  };
}

export function makeAlliesForLevel(level: number, origin: Vec, ability1Stats: (level: number) => { hp: number; damage: number }): Ally[] {
  const count = level;
  const stats = ability1Stats(level);
  const result: Ally[] = [];
  for (let i = 0; i < count; i++) {
    allyIdCounter += 1;
    const offsetX = (i - (count - 1) / 2) * 36;
    const ranged = level === 4 && i >= 2;
    result.push({
      id: allyIdCounter,
      pos: { x: origin.x + offsetX, y: Math.max(ALLY_RADIUS, origin.y - 50) },
      hp: stats.hp,
      maxHp: stats.hp,
      damage: stats.damage,
      attackCooldown: 0,
      ranged,
    });
  }
  return result;
}

export function makeFloatingText(text: string, pos: Vec, color: string, now: number): FloatingText {
  floatingTextIdCounter += 1;
  return { id: floatingTextIdCounter, text, pos: { ...pos }, color, createdAt: now };
}

export const DAMAGE_TEXT_COLOR = '#ffffff';
export const TAKEN_TEXT_COLOR = '#ff5252';
export const XP_TEXT_COLOR = '#ffd54f';

export function mobHpForWave(wave: number) {
  return MOB_MAX_HP + (wave - 1) * 8;
}

export function mobDamageForWave(wave: number) {
  return MOB_DAMAGE + Math.floor((wave - 1) * 1.5);
}

export function mobCountForWave(wave: number) {
  return 4 + wave;
}

export function bossTierForWave(wave: number) {
  return wave >= 10 && wave % 5 === 0 ? Math.floor((wave - 10) / 5) + 1 : 0;
}

export function rangedCountForWave(wave: number) {
  if (wave < 3) return 0;
  return Math.min(Math.floor(mobCountForWave(wave) / 2), wave - 2);
}

export function mobTypeStats(type: MobType, wave: number): { hp: number; damage: number } {
  const meleeHp = mobHpForWave(wave);
  const meleeDmg = mobDamageForWave(wave);
  if (type === 'melee') return { hp: meleeHp, damage: meleeDmg };
  if (type === 'ranged') return { hp: Math.round(meleeHp * 0.7), damage: meleeDmg };
  const tier = Math.max(1, bossTierForWave(wave));
  return { hp: 500 * tier + wave * 10, damage: 15 + tier * 6 };
}

// Composition of a wave, for the Mob Stats overlay
export function waveComposition(wave: number): { type: MobType; count: number }[] {
  const total = mobCountForWave(wave);
  const ranged = rangedCountForWave(wave);
  const melee = total - ranged;
  const rows: { type: MobType; count: number }[] = [];
  if (melee > 0) rows.push({ type: 'melee', count: melee });
  if (ranged > 0) rows.push({ type: 'ranged', count: ranged });
  if (bossTierForWave(wave) > 0) rows.push({ type: 'boss', count: 1 });
  return rows;
}

export function buildWaveQueue(wave: number): MobType[] {
  const total = mobCountForWave(wave);
  const ranged = rangedCountForWave(wave);
  const melee = total - ranged;
  const queue: MobType[] = [];
  for (let i = 0; i < melee; i++) queue.push('melee');
  for (let i = 0; i < ranged; i++) queue.push('ranged');
  // shuffle melee/ranged so ranged are mixed in
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  if (bossTierForWave(wave) > 0) queue.push('boss'); // boss arrives last
  return queue;
}

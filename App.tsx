import AsyncStorage from '@react-native-async-storage/async-storage';
import CoinSackView, { COINSACK_ASSETS, CoinSackHandle, SACK_MIN_W } from './CoinSackView';
import IntroSequence from './IntroSequence';
import MenuTearButton, { TEAR_MS, TearHandle } from './MenuTearButton';
import PerfOverlay, { bumpSimTick } from './PerfOverlay';
import { Asset } from 'expo-asset';
import { AudioPlayer, useAudioPlayer } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import { memo, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  GestureResponderEvent,
  Image,
  ImageSourcePropType,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { BlendMode } from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const TOP_BAR_HEIGHT = 50;
// Sized to what is in them rather than by eye, since every pixel here is one
// the field does not get. The quick-cast buttons rise up out of this strip, so
// it only needs to cover their lower portion. The HUD's label and value now
// share a line, so it needs one row less than before.
const QUICK_CAST_BAR_HEIGHT = 48;
const HUD_HEIGHT = 60;
// The bottom menu bar is gone (Inventory moved up beside the skills), so the
// field takes the height it used to hold and the lower UI sits at the bottom.
const PLAY_H = SCREEN_H - TOP_BAR_HEIGHT - QUICK_CAST_BAR_HEIGHT - HUD_HEIGHT;
const BAR_WIDTH = 80;

const PLAYER_RADIUS = 18;
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
const PLAYER_SPEED = 170; // px/sec

// --- Knight sprite sheets -------------------------------------------------
// Built by tools/build-sprites.mjs from the raw art in Grafik/Knight.
// Each sheet is a 15x8 grid: columns are animation frames, rows are facings.
const SPRITE_CELL = 128; // must match OUT_CELL in tools/build-sprites.mjs
const SPRITE_COLS = 15;
const SPRITE_ROWS = 8;

// How big the knight is drawn, independent of the art's resolution. Tune freely:
// at 128 the sheets render pixel-for-pixel, above that they upscale.
const PLAYER_SPRITE_SIZE = 128;

// How far below pos the sprite's bottom edge sits, i.e. where his feet land.
// Larger moves him down the screen. The art is not centred in its cell, so this
// cannot be derived -- it was eyeballed against the collision circle with a
// temporary slider. Well below the sprite's midpoint, because the knight only
// occupies the lower part of his 128px cell.
const PLAYER_SPRITE_FOOT_OFFSET = 49;

/**
 * The entrance. He starts this far below the play area -- clear of the bottom
 * edge, since his sprite reaches 122 px above his feet.
 */
const INTRO_START_BELOW = 140;
/** Where he stops, measured up from the bottom of the play area. */
const INTRO_STOP_ABOVE_BOTTOM = 160;
/** He walks in rather than running, so the entrance moves at a walk's pace. */
const INTRO_WALK_SPEED = 80; // px/sec, against PLAYER_SPEED's 170

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
const STEPS_PER_CYCLE = 2;

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
const WALK_STRIDE = 40; // px

/**
 * Where in the cycle a foot lands, as a fraction of it.
 *
 * Measured off the run: his body sits lowest at frames 6 and 14 of 15, which is
 * the weight going onto a foot. The walk is assumed to match, being too subtle
 * to measure and by the same hand. One number moves both if it sounds early.
 */
const FOOTSTEP_PHASE = 0.4;
/**
 * How long he stands before reaching for the sword.
 *
 * A tenth of a second: long enough that arriving and drawing read as two
 * movements rather than one, short enough that nothing is being waited out. It
 * was two seconds, which was a pause with nothing in it.
 */
const INTRO_SETTLE = 0.1; // seconds
/**
 * The frame he holds while waiting.
 *
 * Not idle, which is the pose that already has the sword out -- dropping into it
 * here would hand him the blade a moment before he draws it. He holds the last
 * frame of the walk instead, which is also as close as that cycle gets to both
 * feet being under him: 41 px between his legs against 48 mid-stride.
 */
const INTRO_HOLD_FRAME = SPRITE_COLS - 1;

type AnimName = 'idle' | 'walk' | 'run' | 'attack' | 'hurt' | 'spawn' | 'kick' | 'die' | 'rupture' | 'ancestor';

type AnimDef = {
  sheet: ImageSourcePropType;
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
const animSpan = (a: AnimDef) => SPRITE_COLS - (a.from ?? 0);

/**
 * The swing skips its opening. Frames 0-4 of the melee sheet are pure wind-up --
 * the sword drawn back with nothing moving -- and the blade only starts round at
 * frame 5. Playing them made every blow feel like it arrived late. Starting at 5
 * cuts the animation from 0.63 s to 0.42 s and puts the strike a tenth of a
 * second after the button rather than a third.
 */
const ATTACK_FROM = 5;
/** Absolute frame where the blade is fully round; frames 7-9 read as the strike. */
const ATTACK_STRIKE_FRAME = 8;

const ANIMS: Record<AnimName, AnimDef> = {
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
const KICK_RANGE = 70;
/** Half-angle of the arc, as a dot-product threshold: cos(60) = a 120 degree fan. */
const KICK_ARC_COS = 0.5;
const KICK_CONTACT_FRAME = 6;
/** Chance a flinch is answered with the kick at all. */
const KICK_CHANCE = 0.5;

/**
 * How long the death animation's last frame holds before the game-over screen
 * takes over. The fall itself takes its length from the sheet; this is the
 * beat of stillness after it, so the screen does not slam in on the final
 * frame of the fall.
 */
const DIE_HOLD = 0.45;

/** The screen-space direction a facing row looks in; row 0 is east, clockwise. */
const facingVector = (facing: number): Vec => {
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
const INTRO_WALK_ANIM =
  SPRITE_COLS / ANIMS.walk.fps / ((STEPS_PER_CYCLE * WALK_STRIDE) / INTRO_WALK_SPEED);

// The zombie art arrives as loose frames per direction and is packed into the
// same 15x8 grid by tools/build-sprites.mjs, so it shares everything above.
type MobAnimName = 'walk' | 'attack' | 'attack2' | 'attack3' | 'hurt';

const MOB_ANIMS: Record<MobAnimName, AnimDef> = {
  walk: { sheet: require('./assets/sprites/zombie/walk.png'), fps: 12, loop: true },
  attack: { sheet: require('./assets/sprites/zombie/attack.png'), fps: 16, loop: false },
  attack2: { sheet: require('./assets/sprites/zombie/attack2.png'), fps: 16, loop: false },
  attack3: { sheet: require('./assets/sprites/zombie/attack3.png'), fps: 16, loop: false },
  hurt: { sheet: require('./assets/sprites/zombie/hurt.png'), fps: 20, loop: false },
};

// The two falls a melee zombie can take, kept out of MOB_ANIMS on purpose:
// every living mob mounts every sheet in its map, and the living have no use
// for these. Only the corpse layer mounts them, briefly.
type MobDieAnimName = 'die' | 'die2';
const MOB_DIE_ANIMS: Record<MobDieAnimName, AnimDef> = {
  die: { sheet: require('./assets/sprites/zombie/die.png'), fps: 14, loop: false },
  die2: { sheet: require('./assets/sprites/zombie/die2.png'), fps: 14, loop: false },
};

/**
 * A fallen zombie, purely visual. It left the mobs array -- and every rule
 * that reads it: loot, gold, wave count, targeting, the kick's fan -- the
 * frame it died, exactly as before. This plays the fall where it happened,
 * lies a moment, fades and is gone.
 */
type Corpse = { id: number; pos: Vec; facing: number; anim: MobDieAnimName; age: number };
/** Seconds a corpse lies after its fall finishes, and the fade that follows. */
const CORPSE_LINGER = 1.4;
const CORPSE_FADE = 0.6;

/**
 * The red instant when a mob is struck.
 *
 * Kept very short. It is a punctuation mark, not a state -- long enough to
 * register that the blow landed, gone before the next one.
 */
const MOB_FLASH_COLOR = '#ff4a3d';
const MOB_FLASH_TIME = 0.12; // seconds
const MOB_FLASH_STRENGTH = 0.75;

/**
 * Shortest gap between two flinches on the same mob.
 *
 * The same discipline the knight needed. The player swings roughly every 0.8 s
 * and a flinch runs 0.75 s, so without this a mob under attack would twitch
 * continuously and never be seen to swing back.
 */
const MOB_HURT_ANIM_MIN_GAP = 1.4; // seconds

/** Picked at random per swing, so a crowd of zombies does not attack in lockstep. */
const MOB_ATTACK_ANIMS: MobAnimName[] = ['attack', 'attack2', 'attack3'];

// --- Effects -------------------------------------------------------------
// Blood has no facings; tools/build-sprites.mjs packs its five variants as the
// sheet's rows, so choosing one is the same lookup as choosing a facing.
const BLOOD_VARIANTS = 5;
const BLOOD_ANIM: AnimDef = {
  sheet: require('./assets/sprites/effects/blood.png'),
  fps: 20,
  loop: false,
  rows: BLOOD_VARIANTS,
};
const BLOOD_ANIMS = { blood: BLOOD_ANIM };
const BLOOD_DURATION = SPRITE_COLS / BLOOD_ANIM.fps; // seconds
const BLOOD_SIZE = 128;

/**
 * A soft light under the knight, to lift him off a dark floor and keep track of
 * him in a crowd.
 *
 * The image is white and gets its colour from tintColor, which recolours a
 * sprite while leaving its transparency alone. One file, any colour.
 *
 * It breathes slowly rather than sitting still -- a fixed disc reads as a
 * texture stuck to the ground, a moving one as light.
 */
const GLOW = require('./assets/sprites/effects/glow.png');

type GlowStyle = {
  color: string;
  size: number;
  opacity: number;
  /** How far the size swings either side of `size`. */
  pulse: number;
  /** Milliseconds for one breath. */
  period: number;
  /** Down from pos, so it sits at the feet rather than the middle. */
  foot: number;
  /**
   * How it mixes with what is behind -- the same layer modes a paint program
   * offers, supported by React Native since 0.76. 'normal' lays it flat on top;
   * 'plus-lighter' and 'screen' only ever lighten, which is how light behaves
   * and lets the stone show through.
   */
  blend: BlendMode;
};

/**
 * The knight's ordinary light. Grouped rather than left as loose constants
 * because a buff wants to change several of these at once -- a second object of
 * this shape, swapped in while it lasts, is all that would take.
 */
const PLAYER_GLOW: GlowStyle = {
  color: '#ffd27f', // warm, against the cold blue-grey stone
  size: 136,
  opacity: 0.47,
  pulse: 0.19,
  period: 2600,
  foot: 6,
  blend: 'plus-lighter',
};

/**
 * His other light: the moon, caught along the edge that faces it.
 *
 * The shape of it -- which edge, and how far in it reaches -- is baked into the
 * -rim sheets by tools/build-sprites.mjs and needs a rebuild to change. What is
 * here is what the game can decide as it draws, which is why it is these two
 * that the tuning panel offers.
 *
 * Held as three numbers rather than a hex string only so a slider can take hold
 * of each one.
 */
type RimStyle = {
  /** Red, green, blue. The sheet is white, so this is the colour it becomes. */
  color: [number, number, number];
  /** 0 to 1, over and above the falloff already in the sheet's alpha. */
  strength: number;
  blend: BlendMode;
};

const RIM_STYLE: RimStyle = {
  color: [198, 214, 255], // cold, against the warm glow at his feet
  strength: 0.55,
  // Screen only lightens, and reproduces exactly what baking the light into the
  // sheet did: both come out at backdrop + strength x colour x (1 - backdrop).
  blend: 'screen',
};

const rgb = ([r, g, b]: [number, number, number]) => `rgb(${r}, ${g}, ${b})`;

// A frame-time readout in the corner while we work out what is costing what.
// Reports once a second, so watching is nearly free.
const DEBUG_PERF = true;

// On-screen sliders for the rim light, in the same spirit as the coin sack's.
// Off now that the moon looks right -- the panel is not rendered and its state
// costs nothing, so it is one word to bring back when the colour is next in
// question. RIM_STYLE above is what the game uses.
const DEBUG_RIM_TUNING = false;

// --- Rain -----------------------------------------------------------------
// Every drop is worked out from the clock rather than stored and stepped: given
// its speed and where it started, the time says where it is. So the game loop
// carries none of this, nothing accumulates, and there is no state to reset
// between runs.
const RAIN_ENABLED = true;

/**
 * Dialled in by eye with `npm run build:rain`, which writes a page of sliders
 * over this same background. Move them, then paste the block it prints back in
 * here -- the page and the game work the drops out identically.
 *
 * Every drop is dealt a depth at startup, and each pair below is what it is
 * worth at the far end and the near end of that. The near ones fall faster,
 * streak longer and show more strongly, which is what gives the rain depth
 * instead of a flat sheet.
 */
const RAIN = {
  // 270 until the fps hunt: 15% fewer bought frame budget nobody can see
  // missing in the sky. Ours, like stepFps -- a fresh paste from build:rain
  // brings 270 back.
  drops: 230,
  tiltDeg: 2, // off vertical; the wind
  speedFar: 60, // px/sec
  speedNear: 200,
  lengthFar: 1, // px
  lengthNear: 9,
  opacityFar: 0.14,
  opacityNear: 0.26,
  thickFrom: 1, // depth past which a drop is drawn 2 px wide instead of 1
  colour: 'rgba(190, 214, 235, 0.5)',
  /**
   * The rain's own frame rate: each drop falls in little jumps at this many
   * per second instead of gliding at the display's rate. Stop-motion on
   * purpose -- it reads as pixel art -- and cheaper with it: between jumps a
   * drop does not change, so 270 of them recomposite 15 times a second
   * rather than at every refresh of a fast monitor.
   *
   * Time is what is quantised, not the path: every drop keeps its own speed
   * and simply moves in speed/stepFps-sized increments, 4 to 13 px at the
   * current speeds. Cutting the whole fall into a fixed handful of jumps
   * instead would teleport the fast drops 77 px at a time.
   *
   * Ours, not the rain tuner's: paste a fresh block from build:rain over this
   * and stepFps needs putting back.
   */
  stepFps: 15,
};

/** Fixed for the life of the app: the depth each drop was dealt, spelled out. */
const RAIN_STREAKS = Array.from({ length: RAIN.drops }, () => {
  const near = Math.random(); // 0 far away, 1 close to the camera
  return {
    x: Math.random(),
    speed: RAIN.speedFar + near * (RAIN.speedNear - RAIN.speedFar),
    length: RAIN.lengthFar + near * (RAIN.lengthNear - RAIN.lengthFar),
    width: near > RAIN.thickFrom ? 2 : 1,
    opacity: RAIN.opacityFar + near * (RAIN.opacityNear - RAIN.opacityFar),
    offset: Math.random(), // where in its fall it starts
  };
});

const RAIN_TILT_X = Math.tan((RAIN.tiltDeg * Math.PI) / 180);

/**
 * How far the wind carries a drop over a full fall.
 *
 * Drops start spread across the width plus this much to the left of it, so they
 * blow in from off the edge. Without it the bottom-left corner stays dry while
 * drops on the right blow off the screen -- measured at 60 px of empty ground on
 * one side and 155 px of wasted drops on the other.
 */
const RAIN_DRIFT = PLAY_H * RAIN_TILT_X;

// --- Puddles ---------------------------------------------------------------
// Places a ripple may appear, read off a painted mask by the build. Fractions of
// the background image rather than pixels, because the ground is drawn to cover
// and its scale depends on the screen.
//
// Spots, not shapes. Each puddle used to be stored as the ellipse around it,
// which put 27% of the rings on dry grass -- the puddles are irregular and an
// ellipse drawn round one takes in a lot of bank. Sampling inside the water
// instead cannot miss, and there are more spots in the big puddles than the
// small ones, so the rain falls hardest on open water without being told to.
//
// The third number is how far a ring may spread there before it reaches the
// bank, in the source image's own pixels. Carried per spot because the ground
// is drawn to cover: on a phone it is scaled well down, and one size for every
// ring would have them washing over the small puddles entirely.
const PUDDLE_SPOTS: [number, number, number][] = require('./assets/sprites/effects/puddles.json');

/** The height the spots were measured against, to turn that room into screen px. */
const BG_SOURCE_H = 1086;

/** The background's own proportions, needed to place anything on top of it. */
const BG_ASPECT = 1448 / BG_SOURCE_H;

/**
 * The same 'cover' the background is drawn with: scale until it fills, centre
 * the overflow. Anything meant to sit on the ground has to repeat this, or it
 * drifts away from the picture as the screen changes shape.
 */
const bgDrawnW = Math.max(SCREEN_W, PLAY_H * BG_ASPECT);
const bgDrawnH = Math.max(PLAY_H, SCREEN_W / BG_ASPECT);
const bgOffsetX = (SCREEN_W - bgDrawnW) / 2;
const bgOffsetY = (PLAY_H - bgDrawnH) / 2;
const onGroundX = (fx: number) => bgOffsetX + fx * bgDrawnW;
const onGroundY = (fy: number) => bgOffsetY + fy * bgDrawnH;
/** What one pixel of the source image is worth on screen, once it is laid down. */
const groundScale = bgDrawnH / BG_SOURCE_H;

/**
 * Whether someone standing here has their feet in water.
 *
 * The same spots the ripples use, read the other way round: each one carries
 * how far the water reaches around it, so the puddles are the union of those
 * circles. Squashed by half vertically, because the ground is seen at an angle
 * and that is the shape a puddle is drawn as.
 *
 * Only asked when a foot lands -- twice a second at a walk -- so walking the
 * whole list costs nothing worth measuring.
 */
function feetInWater(pos: Vec) {
  for (const [fx, fy, room] of PUDDLE_SPOTS) {
    const dx = pos.x - onGroundX(fx);
    const dy = (pos.y - onGroundY(fy)) * 2;
    const r = room * groundScale;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

// Rings spreading where rain meets standing water. Each slot is one ring with
// its own spot and its own rhythm. Tuned on the same page as the rain.
const RIPPLE = {
  // Ten, dealt only over water the screen can actually see. It was sixty over
  // the whole background image -- cover crops 429 px of that away on a phone,
  // so forty of them rippled in puddles nobody could look at while the three
  // visible ones shared twenty. Ten visible rings is busier than that was.
  slots: 10,
  size: 19, // px across at its widest
  periodFast: 1.5, // sec between one ring and the next
  periodSlow: 3.7,
  opacity: 0.73,
  colour: 'rgba(200, 224, 245, 0.6)',
  /**
   * How many jumps a ring takes from born to gone, instead of gliding. Chunky
   * on purpose -- smooth curves sit oddly on pixel art -- and cheaper with it:
   * between jumps nothing about the ring changes, so the browser recomposites
   * it eight times a cycle rather than at every refresh.
   */
  steps: 8,
};

/** Repeatable stand-in for randomness, so a ripple needs no state to remember. */
const noise = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const RIPPLES = Array.from({ length: RIPPLE.slots }, (_, i) => ({
  seed: i * 37 + 11,
  period: RIPPLE.periodFast + noise(i * 3.1) * (RIPPLE.periodSlow - RIPPLE.periodFast),
  phase: noise(i * 7.7),
}));

/**
 * The weather, looped by the browser instead of driven by React.
 *
 * It used to be worked out in the render: 330 elements, each given a freshly
 * computed style, sixty times a second. The frame readout put the game's
 * stutter on exactly that -- weather off took Nicolai's machine from 90 ms
 * spikes to a flat 244 fps -- and his own diagnosis was the fix: "et
 * gentagende loop". A drop's path never changes, so it is described once as a
 * CSS animation and the browser repeats it forever on its own thread. React
 * builds these elements a single time and, thanks to memo taking no props,
 * provably never reconciles them again.
 *
 * Everything goes through StyleSheet.create, not inline styles, and that is
 * load-bearing: react-native-web only turns animationKeyframes into real CSS
 * on the created path -- its inline compiler documents 'no support' for it,
 * and the first draft of this found that out as 330 elements that stood
 * perfectly still. The animation props are a react-native-web extension
 * (its own spinner uses them), hence the `as never` past React Native's types.
 *
 * Every drop shares one keyframe pair, so the page carries a single
 * @keyframes rule rather than 270: they all travel the same fixed distance --
 * the field plus the longest streak -- and each gets its own speed through
 * animationDuration alone. A short drop overshoots the field by up to 8 px
 * before wrapping, every pixel of it outside the layer's clip, so the loop
 * point cannot be seen. The negative delay is the old random start offset.
 */
const RAIN_SPAN = PLAY_H + RAIN.lengthNear;

// The rotate is minus tilt, turned the other way to the wind: a rotation goes
// clockwise while the drift carries the drop the other way, so at plain +tilt
// the streak leant against its own path by twice the angle -- measured at
// 9.7 px of drift against 9.7 px of lean.
const RAIN_FALL_FRAMES = [
  {
    '0%': { transform: `translate(0px, 0px) rotate(${-RAIN.tiltDeg}deg)` },
    '100%': { transform: `translate(${RAIN_SPAN * RAIN_TILT_X}px, ${RAIN_SPAN}px) rotate(${-RAIN.tiltDeg}deg)` },
  },
];

const dropStyles = StyleSheet.create(
  Object.fromEntries(
    RAIN_STREAKS.map((d, i) => {
      const dur = RAIN_SPAN / d.speed;
      return [
        `d${i}`,
        {
          position: 'absolute',
          left: d.x * (SCREEN_W + RAIN_DRIFT) - RAIN_DRIFT,
          top: -d.length,
          width: d.width,
          height: d.length,
          backgroundColor: RAIN.colour,
          opacity: d.opacity,
          animationKeyframes: RAIN_FALL_FRAMES,
          animationDuration: `${dur.toFixed(3)}s`,
          animationDelay: `${(-d.offset * dur).toFixed(3)}s`,
          // The step count is dealt per drop so they all tick at the same
          // rate: a slow drop falls for longer, so it gets more jumps, never
          // bigger ones. See RAIN.stepFps.
          animationTimingFunction: `steps(${Math.max(1, Math.round(dur * RAIN.stepFps))})`,
          animationIterationCount: 'infinite',
        } as never,
      ];
    })
  )
);

const RainLayer = memo(function RainLayer() {
  return (
    <View style={styles.rain}>
      {RAIN_STREAKS.map((_, i) => (
        <View key={i} style={dropStyles[`d${i}`]} />
      ))}
    </View>
  );
});

/**
 * Rings on the water, on the same terms as the rain above.
 *
 * Two things moved in the translation, both worth knowing. A slot now owns one
 * spot for good, so a given puddle re-ripples on a rhythm instead of the ring
 * hopping elsewhere each time. And the ring's line is scaled along with the
 * ring rather than redrawn at 1 px, so it starts hairline and thickens as it
 * spreads.
 */
const RIPPLE_SPREAD_FRAMES = [
  {
    '0%': { transform: 'scale(0)', opacity: RIPPLE.opacity },
    '100%': { transform: 'scale(1)', opacity: 0 },
  },
];

/**
 * The water the rings are dealt over: what this screen can see, thinned to one
 * spot per patch, in order across the screen.
 *
 * Three steps, each there because leaving it out was tried and counted:
 *
 * - Centre on screen. The spots cover the whole background image and cover
 *   crops it -- 429 px gone sideways on a phone -- and a looser test kept
 *   spots whose ring would stand at the edge showing a 6 px sliver, which
 *   reads as a bug rather than as rain.
 * - One spot per 24 px cell. A big puddle that is almost entirely cropped
 *   away leaves many spots crowded in its thin visible edge, and four rings
 *   ended up inside 35 px of each other. Thinned, the count in each puddle
 *   follows its visible size: on the phone, 43 spots come down to 10 patches.
 * - Sorted across the screen, so the banded deal below spreads the few rings
 *   over all the water rather than over the accidents of the list's order --
 *   drawn plainly from it, seven of ten rings shared one corner.
 *
 * feetInWater stays on the full list on purpose: his feet still splash in a
 * puddle half off the edge. Falls back to everything rather than crash on a
 * screen so odd that no water is visible at all.
 */
const RIPPLE_CELL = 24;
const RIPPLE_POOL = (() => {
  const cells = new Map<string, [number, number, number]>();
  for (const spot of PUDDLE_SPOTS) {
    const x = onGroundX(spot[0]);
    const y = onGroundY(spot[1]);
    if (x < 0 || x > SCREEN_W || y < 0 || y > PLAY_H) continue;
    const key = `${Math.round(x / RIPPLE_CELL)},${Math.round(y / RIPPLE_CELL)}`;
    if (!cells.has(key)) cells.set(key, spot);
  }
  const pool = cells.size > 0 ? [...cells.values()] : [...PUDDLE_SPOTS];
  return pool.sort((a, b) => onGroundX(a[0]) - onGroundX(b[0]));
})();

const ringStyles = StyleSheet.create(
  Object.fromEntries(
    RIPPLES.map((r, i) => {
      // Each ring draws from its own band of the pool rather than the whole:
      // ten independent draws over a list that is in mask-scan order put seven
      // of ten rings on the screen's left edge, counted before it shipped.
      // Banded, they spread over all the visible water and cannot collide.
      const idx = Math.floor(((i + noise(r.seed)) / RIPPLE.slots) * RIPPLE_POOL.length);
      const [fx, fy, room] = RIPPLE_POOL[Math.min(idx, RIPPLE_POOL.length - 1)];
      // Never wider than the water it sits in, however big rings are set.
      const size = Math.min(RIPPLE.size, room * 2 * groundScale);
      return [
        `r${i}`,
        {
          position: 'absolute',
          left: onGroundX(fx) - size / 2,
          top: onGroundY(fy) - size / 4,
          width: size,
          // Squashed, because the ground is seen at an angle.
          height: size / 2,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: RIPPLE.colour,
          animationKeyframes: RIPPLE_SPREAD_FRAMES,
          animationDuration: `${r.period.toFixed(3)}s`,
          animationDelay: `${(-r.phase * r.period).toFixed(3)}s`,
          // In jumps, not a glide -- see RIPPLE.steps. The rain quantises
          // time instead of the path, at RAIN.stepFps.
          animationTimingFunction: `steps(${RIPPLE.steps})`,
          animationIterationCount: 'infinite',
        } as never,
      ];
    })
  )
);

const RippleLayer = memo(function RippleLayer() {
  return (
    <View style={styles.rain}>
      {RIPPLES.map((_, i) => (
        <View key={i} style={ringStyles[`r${i}`]} />
      ))}
    </View>
  );
});

/**
 * The ground the whole play area stands on. Drawn to cover rather than stretch,
 * so it crops instead of distorting when the screen is not its 4:3 shape.
 */
const BACKGROUND = require('./assets/sprites/background.jpg');

// --- Menu ------------------------------------------------------------------
// The title screen. The art carries the game's name, so nothing is drawn over
// it -- only the plaque that starts a run sits on top.
const MENU_BG = require('./assets/sprites/menu/bg.jpg');
const MENU_BUTTON = require('./assets/sprites/menu/button.png');

/**
 * Where the plaque goes, taken from the kit's own layout: a 380x675 stage with
 * the button at x 29, y 474, 322 by 115.
 *
 * Kept as fractions rather than pixels so it holds its place on any screen. The
 * width is measured against the screen rather than against the drawn art on
 * purpose -- a phone is narrower than the picture, so cover crops the sides,
 * and following the art there would hang the plaque's ends off both edges.
 */
const MENU_BUTTON_TOP = 474 / 675;
const MENU_BUTTON_WIDTH = 322 / 380;
const MENU_BUTTON_ASPECT = 322 / 115;

/** Where the plaque ends up, which the tear needs in order to draw it torn. */
const MENU_BUTTON_RECT = {
  x: (SCREEN_W * (1 - MENU_BUTTON_WIDTH)) / 2,
  y: SCREEN_H * MENU_BUTTON_TOP,
  w: SCREEN_W * MENU_BUTTON_WIDTH,
  h: (SCREEN_W * MENU_BUTTON_WIDTH) / MENU_BUTTON_ASPECT,
};

/**
 * Where the title sits, so the sparkles land on it.
 *
 * This one does have to follow the art, since it is lettering painted into the
 * picture -- so it goes through the same cover fit the background is drawn with
 * rather than being measured against the screen like the plaque is.
 */
const MENU_ART_ASPECT = 941 / 1672;
const menuDrawnW = Math.max(SCREEN_W, SCREEN_H * MENU_ART_ASPECT);
const menuDrawnH = Math.max(SCREEN_H, SCREEN_W / MENU_ART_ASPECT);
const onMenuX = (fx: number) => (SCREEN_W - menuDrawnW) / 2 + fx * menuDrawnW;
const onMenuY = (fy: number) => (SCREEN_H - menuDrawnH) / 2 + fy * menuDrawnH;
const MENU_LOGO_RECT = {
  x0: onMenuX(65 / 380),
  y0: onMenuY(60 / 675),
  x1: onMenuX(315 / 380),
  y1: onMenuY(168 / 675),
};

/**
 * The way out of the menu: to black, and back off once the field is behind it.
 *
 * There was a red wash under the black to begin with, on the theory that the
 * screen should go the way the plaque did. Black alone turned out to be the
 * stronger of the two -- the tear has already said what it needs to.
 */
const LEAVE_FADE_MS = 600;
const LEAVE_HOLD_MS = 140;
const RETURN_MS = 560;

/**
 * Every sheet the game can draw, for loading up front.
 *
 * Nothing that draws them exists until a run starts, so without this the first
 * fetch of the knight begins at the same moment he is first needed and he is
 * invisible until it lands. The sounds already load at start-up because their
 * players are created there; the art had no such thing.
 */
const ALL_SHEETS: number[] = [
  ...Object.values(ANIMS).map((a) => a.sheet),
  // His light travels with him: pulled down with the sheet it belongs to, so a
  // frame and its rim never arrive apart.
  ...Object.values(ANIMS).flatMap((a) => (a.rim ? [a.rim] : [])),
  ...Object.values(MOB_ANIMS).map((a) => a.sheet),
  ...Object.values(MOB_DIE_ANIMS).map((a) => a.sheet),
  BLOOD_ANIM.sheet,
  BACKGROUND,
  GLOW,
] as number[];

// Drawn the same size as the knight, both being human-sized. The foot offset is
// smaller because a mob's collision circle is smaller (14 against 18), and it
// comes from measurement rather than taste: the zombie leaves 19 px of empty
// cell below its feet where the knight leaves 17.
const MOB_SPRITE_SIZE = 128;
const MOB_SPRITE_FOOT_OFFSET = 44;

/** True when the animation cannot use the plain time-to-frame arithmetic. */
const hasTimeline = (a: AnimDef) => !!(a.holds?.length || a.passes || a.order);

/** Extra seconds a given frame holds for, on top of its 1/fps. */
const holdFor = (a: AnimDef, frame: number) =>
  a.holds?.find((h) => h.frame === frame)?.seconds ?? 0;

/**
 * The frames in the order they are shown, one entry per shown frame with how
 * long it stays up, compiled from `order` or `passes`+`holds` and cached per
 * definition -- animColumn runs every render for every mounted sheet, and
 * this list never changes.
 */
const playStepsCache = new WeakMap<AnimDef, { frame: number; dwell: number }[]>();
function playSteps(a: AnimDef): { frame: number; dwell: number }[] {
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
const animDuration = (a: AnimDef) => {
  if (!hasTimeline(a)) return animSpan(a) / a.fps;
  let d = 0;
  for (const s of playSteps(a)) d += s.dwell;
  return d;
};

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
const KILL_SFX_CHANCE = 0.3;

/**
 * Extra splats thrown when the gore version of a kill sound is the one that
 * plays. The two are bound together at the moment the sound fires, so the
 * bloodier sound never plays without the mess to go with it.
 */
const GORE_EXTRA_SPLATS = 3;
const GORE_SPLATTER_SPREAD = 32; // px around where the body fell

/**
 * How long after a swing begins before its sound plays.
 *
 * Derived rather than picked, so it follows the animation instead of having to
 * be re-tuned by hand: the strike is a known frame, and the clips take about
 * 40 ms to reach full level, so they start that much ahead of it.
 */
/** When the blade is round, measured from the moment the swing begins. */
const SWING_STRIKE_AT = (ATTACK_STRIKE_FRAME - ATTACK_FROM) / ANIMS.attack.fps;

/**
 * How long each clip takes to reach full level, measured by the build.
 *
 * A sound meant to land on a frame has to be started early by exactly this
 * much, and it is not one number: across the swing pool it runs from 29 ms to
 * 129 ms. One value for all of them was 40, which put the gore clips 90 ms
 * behind the blade -- and since the clip is drawn at random, whether a blow
 * sounded like it connected came down to which one came up.
 */
const CLIP_LEAD: Record<string, number> = require('./assets/sounds/leads.json');
const leadsFor = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => CLIP_LEAD[`${prefix}-${i + 1}`] ?? 0);
const ATTACK_LEADS = leadsFor('attack', 3);
const KILL_LEADS = leadsFor('kill', 3);
const GORE_LEADS = leadsFor('gore', 3);
const KICK_LEADS = leadsFor('kick', 2);

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
const HURT_ANIM_MIN_GAP = 1.2; // seconds

/**
 * Kill switch for every effect clip, flipped by the debug row in the corner.
 *
 * For hunting the hitches by ear: the readout shows 90 ms spikes tied to
 * movement, and every step plays two clips -- so this lets a minute be played
 * with that suspect removed entirely, on the machine where the lag is real.
 * Module-level rather than state because playSfx is called from the game
 * loop, where state would be a render behind.
 */
let SFX_KILLED = false;

/** Fire and forget. Audio is a garnish -- it must never break the game loop. */
function playSfx(player: AudioPlayer | undefined) {
  if (!player || SFX_KILLED) return;
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
function animColumn(a: AnimDef, animTime: number) {
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
const SPRITE_ROW_FOR_EAST = 0;

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
function facingForTargets(from: Vec, targets: Vec[], current: number) {
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

function facingFromDelta(dx: number, dy: number) {
  // atan2 is 0 at east and grows clockwise on screen, since y points down --
  // the same direction the rows advance, so this adds rather than subtracts.
  const eighths = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return (((SPRITE_ROW_FOR_EAST + eighths) % SPRITE_ROWS) + SPRITE_ROWS) % SPRITE_ROWS;
}

// The inverse: a unit vector pointing the way a given facing row looks. East is
// row 0 and rows advance clockwise, so the angle is simply facing * 45 degrees.
function directionFromFacing(facing: number): Vec {
  const angle = ((facing - SPRITE_ROW_FOR_EAST) * Math.PI) / 4;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
const PLAYER_ATTACK_RANGE = 60;
const RANGED_ATTACK_RANGE = 240;
const PLAYER_ATTACK_COOLDOWN = 0.8; // sec
const PLAYER_BASE_DAMAGE = 8;

const MOB_RADIUS = 14;
const BOSS_RADIUS = 26;
const MOB_SPEED = 60; // px/sec
const MOB_ATTACK_RANGE = 40;
const MOB_RANGED_FIRE_RANGE = 170;
const MOB_ATTACK_COOLDOWN = 1.2;
const MOB_MAX_HP = 20; // wave 1 base
const MOB_DAMAGE = 5; // wave 1 base
const MOB_XP_REWARD = 15;
const BOSS_XP_REWARD = 120;

/**
 * Coins into the sack for a kill.
 *
 * Not an economy: this game has no money, and whether it should have reaches
 * into Magnus's gameplay rather than our animation. The sack needed something
 * to react to, and a kill is the obvious something. It keeps its own count.
 */
const MOB_COIN_CHANCE = 0.5; // a zombie is worth a coin half the time, nothing the rest
const BOSS_COINS = 5;

/**
 * Where the sack sits, measured from the bottom left of the screen. Nicolai's
 * numbers, found with the sliders at a phone's width.
 *
 * It floats over the bars rather than sitting in one: the sack is 170 px tall
 * at full size and the tallest bar is 84, and the engine crops rather than
 * squashes when the box is the wrong shape. As placed, its foot is in the
 * quick-cast bar and it reaches about 80 px up into the field.
 *
 * First numbers for the skull, not tuned ones: centred (the kit's 254 px
 * minimum width on a 390 screen leaves 68 a side) and sat on the bottom bars
 * with its crown just under the field. The sack these replaced was placed by
 * Nicolai with the sliders; the skull is landscape and three times as wide,
 * so its spot is his to choose the same way -- DEBUG_COINSACK_TUNING brings
 * the panel back.
 */
const COINSACK_LEFT = (SCREEN_W - 254) / 2;
const COINSACK_BOTTOM = 8;
const COINSACK_WIDTH = 254;

/**
 * The crowned skull, parked. Nicolai's call, 20 July: the design is approved
 * -- "den er flot" -- but it stays off the field until it has a placement
 * that clears Magnus's loadout bar, and until then it should not cost a
 * frame. Off means not rendered at all: no engine, no physics, no canvas,
 * and its seventeen assets are left out of the boot prefetch too.
 *
 * Bringing it back is this word plus DEBUG_COINSACK_TUNING for the sliders.
 */
const COINSACK_ENABLED = false;

// On-screen sliders for placing the sack -- meaningless without the skull, so
// both flags come back together when it is next in question.
const DEBUG_COINSACK_TUNING = false;

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
const KNOCKBACK_SPEED = 260; // px/sec
const KNOCKBACK_VARIATION = 0.45; // +/- this much of it, per blow
const KNOCKBACK_TAU = 0.085; // sec; how quickly the shove bleeds off
const KNOCKBACK_STOP = 8; // px/sec below which it is over

const WAVE_SPAWN_INTERVAL = 0.5; // sec between mob spawns within a wave
const MANA_REGEN_PER_SEC = 4;
const MANA_MAX = 100;

const ALLY_RADIUS = 12;
const ALLY_SPEED = 90;
const ALLY_ATTACK_RANGE = 50;
const ALLY_ENGAGE_RANGE = 200;
const ALLY_RANGED_ATTACK_RANGE = 160;
const ALLY_RANGED_ENGAGE_RANGE = 260;
const ALLY_ATTACK_COOLDOWN = 1.0;

const ABILITY_MAX_LEVEL = 4;
const CONE_RANGE = Math.hypot(SCREEN_W, PLAY_H);
const ABILITY2_HALF_ANGLE_DEG = 21; // ~60% of the original 35deg half-angle

// --- The cone's zone, drawn (ours, Nicolai's ask of 20 July) ----------------
// The skill always fired invisibly. This shows the ground it actually covers:
// the true wedge, laid out as a carpet of small pixels that light up from the
// knight outward, hold, and dissolve. Decoration only -- the damage was
// instant before and stays instant, and these squares are the same cone the
// damage test uses, not an impression of it.
//
// The grid is the FIELD's, not the cast's: cells are picked off a screen-
// aligned lattice and only their membership depends on the angle. A grid
// built in the cone's own frame and rotated into place would draw diamonds
// at every facing but the four square ones.
//
// Built to the weather's lesson: the movement is CSS compiled through
// StyleSheet.create (inline keyframes silently do nothing), the carpet is a
// memo component whose props never change, and nothing ticks in JS -- the
// game loop only drops the entry when its time is up.
const CONE_ZONE = {
  /** Total life on screen, and the two parts of it. */
  ms: 2000,
  fadeMs: 700,
  /** One pixel of the carpet, in screen px. The knight is about 40 across. */
  cell: 8,
  /** px/s the ignition runs outward at, so the zone reads as a sweep. */
  sweepSpeed: 1500,
  /** Ignition is quantised to this, which is the wave's own step size. */
  delayStepMs: 30,
  /**
   * The two straight edges, drawn nearly solid. This is what makes the zone
   * legible: a wedge this large cannot be filled densely without hundreds of
   * pixels, but its outline costs length rather than area, and an outline
   * with a light dither inside reads as a zone where an even scatter reads
   * as dust. `edgeBand` is how far in from the edge counts as the edge.
   */
  edgeBand: 7,
  /** Unbroken on purpose: the edge's whole job is to draw the shape. */
  edgeDensity: 1,
  /**
   * The dither inside: strongest at his feet, thinning with distance but
   * never to nothing, so the zone reaches as far as the damage does.
   */
  fillNear: 0.4,
  fillFar: 0.1,
  fillFalloff: 460,
  /** Never mount more than this, however the wedge happens to fall. */
  maxCells: 430,
  /** The skill's own orange: the edge bright, the fill dithered under it. */
  edgeColors: ['rgba(255,196,107,0.8)', 'rgba(255,138,80,0.75)'],
  fillColors: ['rgba(255,138,80,0.45)', 'rgba(217,83,30,0.4)', 'rgba(255,196,107,0.35)'],
};

/**
 * Ignition delays as a small bank of pre-compiled classes rather than inline
 * values: keyframes only compile through StyleSheet.create here, and keeping
 * the whole animation in one place means a cell carries nothing but its
 * position and colour.
 */
const CONE_DELAY_BUCKETS = Math.ceil(((CONE_RANGE / CONE_ZONE.sweepSpeed) * 1000) / CONE_ZONE.delayStepMs) + 1;

const coneZoneSheet = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: PLAY_H,
    pointerEvents: 'none',
    animationKeyframes: [{ '0%': { opacity: 1 }, '100%': { opacity: 0 } }],
    animationDuration: `${CONE_ZONE.fadeMs}ms`,
    animationDelay: `${CONE_ZONE.ms - CONE_ZONE.fadeMs}ms`,
    animationTimingFunction: 'steps(4)',
    animationFillMode: 'both',
  } as never,
  cell: {
    position: 'absolute',
    width: CONE_ZONE.cell,
    height: CONE_ZONE.cell,
    animationKeyframes: [{ '0%': { opacity: 0 }, '100%': { opacity: 1 } }],
    animationDuration: '120ms',
    animationTimingFunction: 'steps(2)',
    animationFillMode: 'both',
  } as never,
  ...(Object.fromEntries(
    Array.from({ length: CONE_DELAY_BUCKETS }, (_, i) => [
      `d${i}`,
      { animationDelay: `${i * CONE_ZONE.delayStepMs}ms` },
    ])
  ) as Record<string, object>),
} as never) as Record<string, object>;

type ConeZoneCell = { left: number; top: number; color: string; bucket: number; edge: boolean };
/** One cast's zone: the cells are worked out once, at the moment it is cast. */
type ConeZone = { id: number; cells: ConeZoneCell[]; createdAt: number };

/**
 * Which pixels of the field lie inside the cone about to be cast.
 *
 * The test is the cone's own: within range, and within the half-angle of the
 * cast direction -- the same two questions fireCone asks of every mob, so
 * what lights up is what gets hit.
 */
function buildConeZone(ox: number, oy: number, angleDeg: number): ConeZoneCell[] {
  const { cell, edgeColors, fillColors } = CONE_ZONE;
  const halfRad = (ABILITY2_HALF_ANGLE_DEG * Math.PI) / 180;
  const cosHalf = Math.cos(halfRad);
  const tanHalf = Math.tan(halfRad);
  const ang = (angleDeg * Math.PI) / 180;
  const dirX = Math.cos(ang);
  const dirY = Math.sin(ang);
  const cells: ConeZoneCell[] = [];
  for (let top = 0; top < PLAY_H; top += cell) {
    for (let left = 0; left < SCREEN_W; left += cell) {
      const dx = left + cell / 2 - ox;
      const dy = top + cell / 2 - oy;
      const len = Math.hypot(dx, dy);
      if (len < 1 || len > CONE_RANGE) continue;
      if ((dx / len) * dirX + (dy / len) * dirY < cosHalf) continue;
      // How far in from the nearer straight edge this pixel sits, measured
      // across the wedge: zero on the edge itself, growing toward the axis.
      const along = dx * dirX + dy * dirY;
      const lateral = Math.abs(dy * dirX - dx * dirY);
      const inFromEdge = along * tanHalf - lateral;
      const onEdge = inFromEdge <= CONE_ZONE.edgeBand;
      const density = onEdge
        ? CONE_ZONE.edgeDensity
        : Math.max(
            CONE_ZONE.fillFar,
            CONE_ZONE.fillNear - (CONE_ZONE.fillNear - CONE_ZONE.fillFar) * (len / CONE_ZONE.fillFalloff)
          );
      if (Math.random() > density) continue;
      const palette = onEdge ? edgeColors : fillColors;
      cells.push({
        left,
        top,
        edge: onEdge,
        color: palette[Math.floor(Math.random() * palette.length)],
        bucket: Math.min(
          CONE_DELAY_BUCKETS - 1,
          Math.round((len / CONE_ZONE.sweepSpeed) * 1000 / CONE_ZONE.delayStepMs)
        ),
      });
    }
  }
  // A cast along the field's diagonal covers far more ground than one into a
  // corner. Thinning keeps the worst case as cheap as the ordinary one -- and
  // it takes only from the fill, because a gap-toothed edge stops drawing the
  // shape, which is the whole job.
  if (cells.length > CONE_ZONE.maxCells) {
    const edges = cells.filter((c) => c.edge);
    const fill = cells.filter((c) => !c.edge);
    const keep = Math.max(0, (CONE_ZONE.maxCells - edges.length) / fill.length);
    return edges.concat(fill.filter(() => Math.random() < keep));
  }
  return cells;
}

/**
 * The carpet. Its props never change after mount, so React never reconciles
 * it again -- the compositor owns every pixel until the loop drops the entry.
 */
const ConeZoneFx = memo(function ConeZoneFx({ cells }: { cells: ConeZoneCell[] }) {
  return (
    <View style={coneZoneSheet.layer}>
      {cells.map((c, i) => (
        <View
          key={i}
          style={[coneZoneSheet.cell, coneZoneSheet[`d${c.bucket}`], { left: c.left, top: c.top, backgroundColor: c.color }]}
        />
      ))}
    </View>
  );
});
const ABILITY3_HASTE_DURATION = 5;

// ---- Skill catalog ---------------------------------------------------------
// Six skills in a small tree: three roots the player starts owning, and one
// child under each that must be unlocked (parent at level >= 1) before it can
// be bought. Levels 1..4 are paid for from the main menu with gold; reaching
// level L costs SKILL_LEVEL_COST[L].
// Each root has two children: an active and a passive. Active skills go in the
// three quick-cast slots; passive skills go in the single passive slot.
type SkillId =
  | 'summon' | 'cone' | 'ranged'
  | 'fireball' | 'burn' | 'push'
  | 'summonregen' | 'cdreduce' | 'pierce';
const ALL_SKILLS: SkillId[] = [
  'summon', 'cone', 'ranged',
  'fireball', 'burn', 'push',
  'summonregen', 'cdreduce', 'pierce',
];
const ROOT_SKILLS: SkillId[] = ['summon', 'cone', 'ranged'];
const MAX_EQUIPPED = 3; // active skill slots
const MAX_PASSIVE = 1; // passive skill slot

// How a skill behaves when it sits in an equipped slot in a run.
//   'instant' -- tap the button, it fires at once
//   'aim'     -- tap to arm, then tap/drag the field to aim, release to fire
//   'passive' -- no button; its effect is always on while equipped
type SkillCast = 'instant' | 'aim' | 'passive';

const SKILL_PARENT: Record<SkillId, SkillId | null> = {
  summon: null,
  cone: null,
  ranged: null,
  fireball: 'summon',
  summonregen: 'summon',
  burn: 'cone',
  cdreduce: 'cone',
  push: 'ranged',
  pierce: 'ranged',
};

// Colour per root tree: Summon is purple/blue, Cone is orange/red, Ranged is
// green/yellow. Each skill also carries an emoji icon for its button.
const SKILL_META: Record<
  SkillId,
  { label: string; icon: string; color: string; cast: SkillCast; mana: number; cooldown: number }
> = {
  summon: { label: 'Summon', icon: '🧟', color: '#7e57c2', cast: 'instant', mana: 30, cooldown: 12 },
  cone: { label: 'Cone', icon: '🔻', color: '#ff8a50', cast: 'instant', mana: 20, cooldown: 5 },
  ranged: { label: 'Ranged', icon: '🏹', color: '#66bb6a', cast: 'instant', mana: 25, cooldown: 15 },
  fireball: { label: 'Fireball', icon: '☄️', color: '#5c6bc0', cast: 'instant', mana: 25, cooldown: 8 },
  burn: { label: 'Burn', icon: '🔥', color: '#ef5350', cast: 'instant', mana: 20, cooldown: 6 },
  push: { label: 'Push', icon: '💨', color: '#43a047', cast: 'instant', mana: 20, cooldown: 8 },
  summonregen: { label: 'Summon Regen', icon: '💜', color: '#42a5f5', cast: 'passive', mana: 0, cooldown: 0 },
  cdreduce: { label: 'Haste', icon: '⏱️', color: '#e53935', cast: 'passive', mana: 0, cooldown: 0 },
  pierce: { label: 'Pierce', icon: '🎯', color: '#fdd835', cast: 'passive', mana: 0, cooldown: 0 },
};

function isPassiveSkill(skill: SkillId): boolean {
  return SKILL_META[skill].cast === 'passive';
}

// Gold to reach each level. Index by target level (1..4): 5, 10, 15, 20.
const SKILL_LEVEL_COST = [0, 5, 10, 15, 20];
function skillLevelCost(targetLevel: number): number {
  return SKILL_LEVEL_COST[targetLevel] ?? 0;
}

// The fireball off each summon, as a fraction of that summon's attack damage.
function fireballDamagePercent(level: number): number {
  return [0, 1.0, 1.5, 2.0, 2.5][level] ?? 0;
}
const FIREBALL_RADIUS = 95;
// The burning enemy's death blast, as a fraction of its max HP.
function burnExplodePercent(level: number): number {
  return [0, 0.5, 0.6, 0.7, 1.0][level] ?? 0;
}
const BURN_EXPLODE_RADIUS = 90;
// Burn also scorches the target itself for this much per second while it burns.
function burnDamagePerSec(level: number): number {
  return [0, 5, 10, 15, 20][level] ?? 0;
}
// Push: fraction of the player's attack damage dealt as it shoves enemies off.
function pushDamagePercent(level: number): number {
  return [0, 0.5, 1.0, 1.5, 2.0][level] ?? 0;
}
const PUSH_SPEED = 620; // px/sec of outward shove, bled off by the knockback decay
// Passive Summon Regen: HP per second granted to each summon.
function summonRegenPerSec(level: number): number {
  return level * 4;
}
// Passive Haste: fraction cut from every skill cooldown.
function cooldownReducePercent(level: number): number {
  return [0, 0.2, 0.3, 0.4, 0.5][level] ?? 0;
}
// Passive Pierce: how many extra enemies each of the player's shots passes through.
function pierceTargetCount(level: number): number {
  return level > 0 ? level : 0;
}
const PIERCE_WIDTH = 26; // how close to the shot's line an enemy must be to be pierced

const PROJECTILE_SPEED = 700; // px/sec
const HIT_FLASH_DURATION = 150; // ms
const FLOATING_TEXT_DURATION = 700; // ms
const FLOATING_TEXT_RISE = 32; // px

const EQUIP_SLOTS = 3;
const BAG_SLOTS = 9;
const ITEM_SIZE = 24;
const ITEM_DESPAWN_MS = 10000;
const ITEM_PICKUP_RADIUS = PLAYER_RADIUS + 14;
const INV_DRAG_THRESHOLD = 14;

let mobIdCounter = 0;
let allyIdCounter = 0;
let projectileIdCounter = 0;
let hitFlashIdCounter = 0;
let bloodIdCounter = 0;
let corpseIdCounter = 0;
let coneZoneIdCounter = 0;
let itemIdCounter = 0;
let floatingTextIdCounter = 0;

type Vec = { x: number; y: number };

type MobType = 'melee' | 'ranged' | 'boss';

type Mob = {
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

type Ally = {
  id: number;
  pos: Vec;
  hp: number;
  maxHp: number;
  damage: number;
  attackCooldown: number;
  ranged: boolean;
};

type Projectile = {
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
type HitFlash = { id: number; pos: Vec; createdAt: number };
type BloodSplat = { id: number; pos: Vec; variant: number; createdAt: number };
type FloatingText = { id: number; text: string; pos: Vec; color: string; createdAt: number };

// The three in-run quick-cast slots. Each slot holds whichever skill the player
// equipped for it in the main menu (or null if left empty), that skill's level,
// and its live cooldown for the run.
type AbilityId = 1 | 2 | 3;
type Ability = { skill: SkillId | null; level: number; cooldown: number };
type Abilities = Record<AbilityId, Ability>;

type Target = { kind: 'player' | 'ally' | 'mob'; id?: number; pos: Vec };

type ItemKind = 'dmg' | 'atkspd' | 'mana' | 'manaregen' | 'health' | 'healthregen';
type Item = { id: number; kind: ItemKind; level: number };
type GroundItem = { item: Item; pos: Vec; createdAt: number };
type Slot = Item | null;
type TooltipState = { key: string; text: string; x: number; y: number } | null;

const ITEM_DEFS: Record<
  ItemKind,
  { name: string; color: string; perLevel: number; format: (total: number) => string }
> = {
  dmg: { name: 'Blade', color: '#ff7043', perLevel: 2, format: (t) => `+${t} damage` },
  atkspd: { name: 'Gloves', color: '#ffca28', perLevel: 0.03, format: (t) => `+${Math.round(t * 100)}% attack speed` },
  mana: { name: 'Crystal', color: '#42a5f5', perLevel: 6, format: (t) => `+${t} max mana` },
  manaregen: { name: 'Sigil', color: '#26c6da', perLevel: 1, format: (t) => `+${t} mana regen/s` },
  health: { name: 'Armor', color: '#66bb6a', perLevel: 8, format: (t) => `+${t} max health` },
  healthregen: { name: 'Amulet', color: '#9ccc65', perLevel: 1, format: (t) => `+${t} health regen/s` },
};
const ITEM_KINDS: ItemKind[] = ['dmg', 'atkspd', 'mana', 'manaregen', 'health', 'healthregen'];

const MOB_TYPE_META: Record<MobType, { name: string; color: string; radius: number }> = {
  melee: { name: 'Melee', color: '#e05555', radius: MOB_RADIUS },
  ranged: { name: 'Ranged', color: '#ff9800', radius: MOB_RADIUS },
  boss: { name: 'Boss', color: '#ab47bc', radius: BOSS_RADIUS },
};

type PlayerState = {
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

function dist(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeAngle(deg: number) {
  let d = deg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function nearestTarget(from: Vec, targets: Target[], maxRange: number): Target | null {
  let best: Target | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    const d = dist(from, t.pos);
    if (d <= maxRange && d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

function fireCone(
  origin: Vec,
  aimPoint: Vec,
  currentMobs: Mob[],
  baseDamage: number,
  damagePercent: number,
  range: number,
  halfAngleDeg: number
): { mobs: Mob[]; hits: { pos: Vec; amount: number }[] } {
  const dirAngle = (Math.atan2(aimPoint.y - origin.y, aimPoint.x - origin.x) * 180) / Math.PI;
  const hits: { pos: Vec; amount: number }[] = [];
  const mobs = currentMobs.map((m) => {
    const d = dist(origin, m.pos);
    if (d <= range) {
      const mobAngle = (Math.atan2(m.pos.y - origin.y, m.pos.x - origin.x) * 180) / Math.PI;
      if (Math.abs(normalizeAngle(mobAngle - dirAngle)) <= halfAngleDeg) {
        const amount = baseDamage + m.maxHp * damagePercent;
        hits.push({ pos: { ...m.pos }, amount });
        return { ...m, hp: m.hp - amount };
      }
    }
    return m;
  });
  return { mobs, hits };
}

function xpForLevel(level: number) {
  return 40 + (level - 1) * 25;
}

function ability1Stats(level: number) {
  return { hp: 20 + (level - 1) * 15, damage: 4 + (level - 1) * 3 };
}

function ability2BaseDamage(level: number) {
  return 10 * level;
}

function ability2DamagePercent(level: number) {
  return 0.1 + (level - 1) * 0.05;
}

function ability3DamageBonus(level: number) {
  return level * 4;
}

const ALL_LEVELS = [1, 2, 3, 4];

function levelBracket(values: (string | number)[]): string {
  return `(${values.join('/')})`;
}

function skillDescription(skill: SkillId): string {
  if (skill === 'summon') {
    const hps = levelBracket(ALL_LEVELS.map((l) => ability1Stats(l).hp));
    const dmgs = levelBracket(ALL_LEVELS.map((l) => ability1Stats(l).damage));
    return `Summon: calls 1/2/3/4 allied mobs (at level 4: 2 melee, 2 ranged) that fight for you. HP ${hps}, DMG ${dmgs}.`;
  }
  if (skill === 'cone') {
    const bases = levelBracket(ALL_LEVELS.map((l) => ability2BaseDamage(l)));
    const pcts = levelBracket(ALL_LEVELS.map((l) => `${Math.round(ability2DamagePercent(l) * 100)}%`));
    return `Cone: deals ${bases} damage plus ${pcts} of each enemy's max HP in a widening cone toward where you aim.`;
  }
  if (skill === 'ranged') {
    const dmgs = levelBracket(ALL_LEVELS.map((l) => ability3DamageBonus(l)));
    return `Ranged: passively turns your attacks ranged, adding ${dmgs} damage. Tap to gain +50% attack speed for 5s.`;
  }
  if (skill === 'fireball') {
    const pcts = levelBracket(ALL_LEVELS.map((l) => `${Math.round(fireballDamagePercent(l) * 100)}%`));
    return `Fireball: a fireball explodes from every one of your summons, dealing ${pcts} of that summon's attack damage to nearby enemies. Needs Summon.`;
  }
  if (skill === 'burn') {
    const pcts = levelBracket(ALL_LEVELS.map((l) => `${Math.round(burnExplodePercent(l) * 100)}%`));
    return `Burn: set the closest enemy afire. When it dies it explodes, dealing ${pcts} of its max health to nearby enemies. Needs Cone.`;
  }
  if (skill === 'push') {
    const pcts = levelBracket(ALL_LEVELS.map((l) => `${Math.round(pushDamagePercent(l) * 100)}%`));
    return `Push: shove all enemies away from you, dealing ${pcts} of your attack damage. Needs Ranged.`;
  }
  if (skill === 'summonregen') {
    const regens = levelBracket(ALL_LEVELS.map((l) => `${summonRegenPerSec(l)}/s`));
    return `Summon Regen (passive): your summons regenerate ${regens} health. Needs Summon.`;
  }
  if (skill === 'cdreduce') {
    const pcts = levelBracket(ALL_LEVELS.map((l) => `${Math.round(cooldownReducePercent(l) * 100)}%`));
    return `Haste (passive): reduces the cooldown of all your skills by ${pcts}. Needs Cone.`;
  }
  const targets = levelBracket(ALL_LEVELS.map((l) => pierceTargetCount(l)));
  return `Pierce (passive): your shots pierce through ${targets} enemies. Needs Ranged.`;
}

function skillStatsSuffix(skill: SkillId): string {
  const meta = SKILL_META[skill];
  if (meta.cast === 'passive') return `\nPassive · always on while equipped`;
  return `\nCost: ${meta.mana} MP  ·  Cooldown: ${meta.cooldown}s`;
}

function itemBonus(item: Item) {
  return ITEM_DEFS[item.kind].perLevel * item.level;
}

function itemTooltip(item: Item): string {
  const def = ITEM_DEFS[item.kind];
  return `${def.name} · iLvl ${item.level}\n${def.format(Math.round(itemBonus(item) * 100) / 100)}`;
}

function makeItem(kind: ItemKind, level: number): Item {
  itemIdCounter += 1;
  return { id: itemIdCounter, kind, level };
}

function mobHpForWave(wave: number) {
  return MOB_MAX_HP + (wave - 1) * 8;
}

function mobDamageForWave(wave: number) {
  return MOB_DAMAGE + Math.floor((wave - 1) * 1.5);
}

function mobCountForWave(wave: number) {
  return 4 + wave;
}

function bossTierForWave(wave: number) {
  return wave >= 10 && wave % 5 === 0 ? Math.floor((wave - 10) / 5) + 1 : 0;
}

function rangedCountForWave(wave: number) {
  if (wave < 3) return 0;
  return Math.min(Math.floor(mobCountForWave(wave) / 2), wave - 2);
}

function mobTypeStats(type: MobType, wave: number): { hp: number; damage: number } {
  const meleeHp = mobHpForWave(wave);
  const meleeDmg = mobDamageForWave(wave);
  if (type === 'melee') return { hp: meleeHp, damage: meleeDmg };
  if (type === 'ranged') return { hp: Math.round(meleeHp * 0.7), damage: meleeDmg };
  const tier = Math.max(1, bossTierForWave(wave));
  return { hp: 500 * tier + wave * 10, damage: 15 + tier * 6 };
}

// Composition of a wave, for the Mob Stats overlay
function waveComposition(wave: number): { type: MobType; count: number }[] {
  const total = mobCountForWave(wave);
  const ranged = rangedCountForWave(wave);
  const melee = total - ranged;
  const rows: { type: MobType; count: number }[] = [];
  if (melee > 0) rows.push({ type: 'melee', count: melee });
  if (ranged > 0) rows.push({ type: 'ranged', count: ranged });
  if (bossTierForWave(wave) > 0) rows.push({ type: 'boss', count: 1 });
  return rows;
}

function buildWaveQueue(wave: number): MobType[] {
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

/**
 * Draws one frame of a sprite sheet: a clipping box with the sheet inside it,
 * shifted so the wanted cell lands in view.
 *
 * Every animation stays mounted and only the active one is made visible.
 * Swapping a single Image's source instead makes react-native-web reload it --
 * it renders the picture as a CSS background and clears that background while
 * the new one loads, even from cache -- and the frames in between draw nothing,
 * so the character blinks each time the animation changes.
 */
function SpriteSheet({
  anims,
  anim,
  animTime,
  facing,
  size,
  left,
  top,
  flash,
  rim,
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
}) {
  const active = anims[anim];
  const activeRows = active ? active.rows ?? SPRITE_ROWS : SPRITE_ROWS;
  return (
    <View style={{ position: 'absolute', width: size, height: size, overflow: 'hidden', left, top }}>
      {Object.entries(anims).map(([name, def]) => {
        const rows = def.rows ?? SPRITE_ROWS;
        return (
          <Image
            key={name}
            source={def.sheet}
            style={{
              position: 'absolute',
              // Drawn at native size, so one cell lands exactly on the clip box
              // and the art renders pixel-for-pixel.
              width: size * SPRITE_COLS,
              height: size * rows,
              left: -size * animColumn(def, animTime),
              top: -size * Math.min(facing, rows - 1),
              opacity: name === anim ? 1 : 0,
            }}
          />
        );
      })}

      {/* The light on his lit edge: the matching frame of the rim sheet, tinted
          and faded as it is drawn.

          Every rim sheet stays mounted and only the active one is visible --
          the same rule the sheets above follow, and for the same two reasons.
          Swapping one Image's source makes react-native-web reload it and draw
          nothing in between, so the light blinked off at every animation
          change. Worse, an unmounted sheet's decoded pixels are the first
          thing the browser evicts, so each swap back was a fresh 7.5 MB decode
          on the main thread -- measured in play as 90 ms hitches that landed
          exactly on stopping, starting and striking.

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
          {Object.entries(anims).map(([name, def]) => {
            if (!def.rim) return null;
            const rows = def.rows ?? SPRITE_ROWS;
            return (
              <Image
                key={name}
                source={def.rim}
                tintColor={rgb(rim.color)}
                style={{
                  position: 'absolute',
                  width: size * SPRITE_COLS,
                  height: size * rows,
                  left: -size * animColumn(def, animTime),
                  top: -size * Math.min(facing, rows - 1),
                  opacity: name === anim ? rim.strength : 0,
                }}
              />
            );
          })}
        </View>
      )}

      {/* The same frame again in one colour, laid on top. Only the active sheet
          is drawn twice, and only while a flash is running. */}
      {flash && flash.opacity > 0 && active && (
        <Image
          source={active.sheet}
          tintColor={flash.color}
          style={{
            position: 'absolute',
            width: size * SPRITE_COLS,
            height: size * activeRows,
            left: -size * animColumn(active, animTime),
            top: -size * Math.min(facing, activeRows - 1),
            opacity: flash.opacity,
          }}
        />
      )}
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
function shoveMob(m: Mob, from: Vec) {
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

function hurtMob(m: Mob, from?: Vec) {
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

/**
 * Drag-anywhere slider for the temporary tuning panel. Built on the same
 * responder props the play area uses, so it needs no extra dependency, and it
 * lives outside the play area so dragging it does not also order a move.
 */
function DebugSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const trackWidth = useRef(0);
  const setFromX = (x: number) => {
    if (trackWidth.current <= 0) return;
    const t = Math.max(0, Math.min(1, x / trackWidth.current));
    onChange(Math.round(min + t * (max - min)));
  };
  const pct: `${number}%` = `${((value - min) / (max - min)) * 100}%`;
  return (
    <View style={styles.tuneRow}>
      <Text style={styles.tuneLabel}>{label}</Text>
      <View
        style={styles.tuneTrack}
        onLayout={(e) => {
          trackWidth.current = e.nativeEvent.layout.width;
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => setFromX(e.nativeEvent.locationX)}
        onResponderMove={(e) => setFromX(e.nativeEvent.locationX)}
      >
        <View style={[styles.tuneFill, { width: pct }]} />
        <View style={[styles.tuneKnob, { left: pct }]} />
      </View>
      <Text style={styles.tuneValue}>{value}</Text>
    </View>
  );
}

function makePlayer(): PlayerState {
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

// Build the three run slots from the equipped loadout and the skill levels the
// player has bought in the menu. Empty slots carry no skill.
function makeAbilities(loadout: SkillId[], skillLevels: Record<SkillId, number>): Abilities {
  const slotFor = (i: number): Ability => {
    const skill = loadout[i] ?? null;
    return { skill, level: skill ? skillLevels[skill] ?? 0 : 0, cooldown: 0 };
  };
  return { 1: slotFor(0), 2: slotFor(1), 3: slotFor(2) };
}

// The equipped passive skill with its bought level, or null if none is set.
function makePassive(meta: MetaState): PassiveState {
  if (!meta.passive) return null;
  return { skill: meta.passive, level: meta.skillLevels[meta.passive] ?? 0 };
}

function spawnMob(type: MobType, wave: number): Mob {
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

function makeAlliesForLevel(level: number, origin: Vec): Ally[] {
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

function spawnLoot(wave: number): GroundItem {
  const level = Math.max(1, wave + (Math.floor(Math.random() * 5) - 2));
  const kind = ITEM_KINDS[Math.floor(Math.random() * ITEM_KINDS.length)];
  const margin = 30;
  return {
    item: makeItem(kind, level),
    pos: {
      x: margin + Math.random() * (SCREEN_W - margin * 2),
      y: margin + Math.random() * (PLAY_H - margin * 2),
    },
    createdAt: Date.now(),
  };
}

function makeFloatingText(text: string, pos: Vec, color: string, now: number): FloatingText {
  floatingTextIdCounter += 1;
  return { id: floatingTextIdCounter, text, pos: { ...pos }, color, createdAt: now };
}

const DAMAGE_TEXT_COLOR = '#ffffff';
const TAKEN_TEXT_COLOR = '#ff5252';
const XP_TEXT_COLOR = '#ffd54f';

function equippedBonus(equipped: Slot[], kind: ItemKind) {
  let total = 0;
  for (const it of equipped) {
    if (it && it.kind === kind) total += itemBonus(it);
  }
  return total;
}

// ---- Run persistence ----

// A run carries its equipped passive skill (id + level) alongside the three
// active ability slots; passives have no button or cooldown.
type PassiveState = { skill: SkillId; level: number } | null;

type RunSave = {
  id: string;
  savedAt: number;
  wave: number;
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  mana: number;
  abilities: Abilities;
  passive: PassiveState;
  equipped: Slot[];
  bag: Slot[];
  materials: number;
};

type GameState = {
  player: PlayerState;
  abilities: Abilities;
  passive: PassiveState;
  equipped: Slot[];
  bag: Slot[];
  materials: number;
  wave: number;
};

// Persistent account-level progression, kept apart from the per-run saves. Gold
// is the meta-currency earned by clearing waves; skillLevels is what has been
// bought in the menu; loadout is the up-to-three active skills carried into a
// run, and passive is the single equipped passive skill.
type MetaState = {
  gold: number;
  skillLevels: Record<SkillId, number>;
  loadout: SkillId[];
  passive: SkillId | null;
};

// Bumped to v2 when the ability shape gained a per-slot skill id -- old v1 runs
// are not readable under the new shape, so they are dropped rather than migrated.
const RUNS_STORAGE_KEY = 'rpg_runs_v2';
const META_STORAGE_KEY = 'rpg_meta_v1';

function defaultMeta(): MetaState {
  const skillLevels = Object.fromEntries(ALL_SKILLS.map((s) => [s, 0])) as Record<SkillId, number>;
  for (const root of ROOT_SKILLS) skillLevels[root] = 1; // start owning the three roots
  return { gold: 0, skillLevels, loadout: [...ROOT_SKILLS], passive: null };
}

// Fill in any skills a stored meta predates, and drop an equipped entry the
// player no longer owns, so the shape is always complete and valid.
function sanitizeMeta(raw: Partial<MetaState> | null): MetaState {
  const base = defaultMeta();
  if (!raw) return base;
  const skillLevels = { ...base.skillLevels, ...(raw.skillLevels ?? {}) } as Record<SkillId, number>;
  const loadout = (raw.loadout ?? base.loadout)
    .filter((s) => ALL_SKILLS.includes(s) && !isPassiveSkill(s) && (skillLevels[s] ?? 0) > 0)
    .slice(0, MAX_EQUIPPED);
  const passive =
    raw.passive && ALL_SKILLS.includes(raw.passive) && isPassiveSkill(raw.passive) && (skillLevels[raw.passive] ?? 0) > 0
      ? raw.passive
      : null;
  return { gold: raw.gold ?? 0, skillLevels, loadout, passive };
}

async function loadMeta(): Promise<MetaState> {
  try {
    const raw = await AsyncStorage.getItem(META_STORAGE_KEY);
    return sanitizeMeta(raw ? (JSON.parse(raw) as Partial<MetaState>) : null);
  } catch {
    return defaultMeta();
  }
}

async function persistMeta(meta: MetaState) {
  try {
    await AsyncStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // best-effort; ignore storage failures
  }
}

// The gold a run pays out is 1 per wave cleared, banked at the end: clearing
// wave N is worth 1+2+...+N.
function goldForWavesCleared(waves: number): number {
  return waves > 0 ? (waves * (waves + 1)) / 2 : 0;
}

async function loadRuns(): Promise<RunSave[]> {
  try {
    const raw = await AsyncStorage.getItem(RUNS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RunSave[]) : [];
  } catch {
    return [];
  }
}

async function persistRuns(runs: RunSave[]) {
  try {
    await AsyncStorage.setItem(RUNS_STORAGE_KEY, JSON.stringify(runs));
  } catch {
    // best-effort; ignore storage failures
  }
}

function buildFreshState(meta: MetaState): GameState {
  return {
    player: makePlayer(),
    abilities: makeAbilities(meta.loadout, meta.skillLevels),
    passive: makePassive(meta),
    equipped: new Array(EQUIP_SLOTS).fill(null),
    bag: new Array(BAG_SLOTS).fill(null),
    materials: 0,
    wave: 0,
  };
}

function buildTestState(meta: MetaState): GameState {
  const base = makePlayer();
  const targetLevel = 10;
  let maxHp = base.maxHp;
  for (let lvl = 2; lvl <= targetLevel; lvl++) {
    maxHp += 10;
  }
  const player: PlayerState = {
    ...base,
    level: targetLevel,
    xp: 0,
    xpToNext: xpForLevel(targetLevel),
    maxHp,
    hp: maxHp,
  };
  const randomTestItem = () => makeItem(ITEM_KINDS[Math.floor(Math.random() * ITEM_KINDS.length)], Math.max(1, targetLevel + Math.floor(Math.random() * 5) - 2));
  const equipped: Slot[] = [randomTestItem(), randomTestItem(), randomTestItem()];
  const bag: Slot[] = new Array(BAG_SLOTS).fill(null);
  bag[0] = randomTestItem();
  bag[1] = randomTestItem();
  bag[2] = randomTestItem();
  return { player, abilities: makeAbilities(meta.loadout, meta.skillLevels), passive: makePassive(meta), equipped, bag, materials: 0, wave: targetLevel - 1 };
}

function buildStateFromSave(save: RunSave): GameState {
  const base = makePlayer();
  const player: PlayerState = {
    ...base,
    level: save.level,
    xp: save.xp,
    xpToNext: save.xpToNext,
    hp: save.hp,
    maxHp: save.maxHp,
    mana: save.mana,
  };
  return {
    player,
    abilities: save.abilities,
    passive: save.passive ?? null,
    equipped: save.equipped,
    bag: save.bag,
    materials: save.materials,
    wave: save.wave,
  };
}

export default function App() {
  const [screen, setScreen] = useState<'menu' | 'continue' | 'skilltree' | 'game'>('menu');
  /**
   * Whether the story has been through once. It never goes back to false, so
   * the intro plays on the first sight of the menu and not on the way back to
   * it from a run.
   */
  const [introDone, setIntroDone] = useState(false);
  const [savedRuns, setSavedRuns] = useState<RunSave[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [meta, setMeta] = useState<MetaState>(defaultMeta());
  // Gold earned by the run that just ended, shown on the Game Over screen.
  const [lastRunGold, setLastRunGold] = useState(0);
  const [player, setPlayer] = useState<PlayerState>(makePlayer());
  const [mobs, setMobs] = useState<Mob[]>([]);
  const [allies, setAllies] = useState<Ally[]>([]);
  const [abilities, setAbilities] = useState<Abilities>(makeAbilities(defaultMeta().loadout, defaultMeta().skillLevels));
  const [passive, setPassive] = useState<PassiveState>(null);
  const [aimingAbility, setAimingAbility] = useState<AbilityId | null>(null);
  const [aimPreviewPoint, setAimPreviewPoint] = useState<Vec | null>(null);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [hitFlashes, setHitFlashes] = useState<HitFlash[]>([]);
  const [bloodSplats, setBloodSplats] = useState<BloodSplat[]>([]);
  const [corpses, setCorpses] = useState<Corpse[]>([]);
  const [coneZones, setConeZones] = useState<ConeZone[]>([]);

  // The tuning panel drives these while DEBUG_COINSACK_TUNING is on; the
  // constants above take over the moment it is switched off.
  const [tuneSackLeft, setTuneSackLeft] = useState(COINSACK_LEFT);
  const [tuneSackBottom, setTuneSackBottom] = useState(COINSACK_BOTTOM);
  const [tuneSackWidth, setTuneSackWidth] = useState(COINSACK_WIDTH);

  // Same arrangement for the rim light: the panel drives these while
  // DEBUG_RIM_TUNING is on, and RIM_STYLE takes over when it goes off. Strength
  // is held as a whole number because the slider deals in those.
  const [tuneRimR, setTuneRimR] = useState(RIM_STYLE.color[0]);
  const [tuneRimG, setTuneRimG] = useState(RIM_STYLE.color[1]);
  const [tuneRimB, setTuneRimB] = useState(RIM_STYLE.color[2]);
  const [tuneRimStrength, setTuneRimStrength] = useState(Math.round(RIM_STYLE.strength * 100));
  const [tuneRimBlend, setTuneRimBlend] = useState<BlendMode>(RIM_STYLE.blend);

  // The hitch hunt's two kill switches: play a minute with a suspect removed
  // entirely and feel whether the stutter went with it. Weather off means the
  // 330 elements are not built at all -- display:none only stopped the paint.
  const [sfxOff, setSfxOff] = useState(false);
  const [weatherOff, setWeatherOff] = useState(false);
  // Music apart from the clips: it goes through its own players below, not
  // through playSfx, so it needs its own switch.
  const [musicOff, setMusicOff] = useState(false);
  /**
   * The master: everything at once. Clips, both music tracks, the rain
   * ambience and the coin sack's own audio context -- the sack is the one
   * the others cannot reach, since the kit plays through WebAudio of its own
   * rather than through playSfx.
   */
  const [allSoundOff, setAllSoundOff] = useState(false);
  /**
   * The skull, gone entirely: engine, physics and its own animation frame
   * chain all die with the unmount. Nicolai suspects it of hitching the game,
   * and this is the same A/B the weather got -- play half a minute without it
   * and let the readout speak. Toggling it back builds a fresh, empty skull;
   * the coins in it are decoration, so nothing of worth is lost.
   */
  const [sackOff, setSackOff] = useState(false);
  // The module flag follows the state rather than being set beside it, so the
  // two cannot drift apart -- a hot reload keeps module variables and resets
  // state, and setting both in the toggle left the label saying one thing and
  // playSfx doing the other.
  useEffect(() => {
    SFX_KILLED = sfxOff || allSoundOff;
  }, [sfxOff, allSoundOff]);

  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const [wave, setWave] = useState(0);
  const [waveActive, setWaveActive] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [groundItems, setGroundItems] = useState<GroundItem[]>([]);
  const [equipped, setEquipped] = useState<Slot[]>(new Array(EQUIP_SLOTS).fill(null));
  const [bag, setBag] = useState<Slot[]>(new Array(BAG_SLOTS).fill(null));
  const [materials, setMaterials] = useState(0);
  // Three sword variants picked at random, so a swing every 0.8 s does not turn
  // into an audible loop. One player each is enough: a clip runs 0.54 s and the
  // cooldown is longer, so a variant never has to overlap itself.
  const attackSounds = [
    useAudioPlayer(require('./assets/sounds/attack-1.wav')),
    useAudioPlayer(require('./assets/sounds/attack-2.wav')),
    useAudioPlayer(require('./assets/sounds/attack-3.wav')),
  ];
  // The boot behind the kick, two takes so the flinches the coin answers do
  // not all sound alike. One player each is plenty: kicks sit at least a
  // flinch-gap apart, and the clip is over in 0.65 s.
  const kickSounds = [
    useAudioPlayer(require('./assets/sounds/kick-1.wav')),
    useAudioPlayer(require('./assets/sounds/kick-2.wav')),
  ];

  // Heavier stab combos for a killing blow. These run 1.0-2.4 s against the
  // swing's 0.6, so each variant gets its own player and can ring out.
  const killSounds = [
    useAudioPlayer(require('./assets/sounds/kill-1.wav')),
    useAudioPlayer(require('./assets/sounds/kill-2.wav')),
    useAudioPlayer(require('./assets/sounds/kill-3.wav')),
  ];

  // The same takes with gore layered in. Drawn from the same pool as the three
  // above; picking one of these is what triggers the extra blood.
  const goreSounds = [
    useAudioPlayer(require('./assets/sounds/gore-1.wav')),
    useAudioPlayer(require('./assets/sounds/gore-2.wav')),
    useAudioPlayer(require('./assets/sounds/gore-3.wav')),
  ];

  // The knight taking a hit, played with the flinch animation. At 0.63 s the
  // clip runs almost exactly as long as the flinch it accompanies. Add variants
  // here as they arrive; name them in tools/sound-config.mjs first.
  const hurtSounds: (AudioPlayer | undefined)[] = [
    useAudioPlayer(require('./assets/sounds/hurt-1.wav')),
  ];

  // Steel leaving the scabbard, for the entrance. It runs 1.6 s against the
  // animation's 0.94, so the ring carries on past the flourish -- which is what
  // a drawn sword sounds like.
  const drawSound = useAudioPlayer(require('./assets/sounds/draw.wav'));

  // His boots. Eleven takes, because a step lands twice a second and hearing
  // the same one twice inside a few paces is what makes footsteps sound fake.
  //
  // A player each rather than a shared pool: they run 0.4 to 1.1 s, longer than
  // the gap between steps, so their tails overlap. That is what walking sounds
  // like, and a shared player would cut each step off with the next.
  const footstepSounds = [
    useAudioPlayer(require('./assets/sounds/footstep-1.wav')),
    useAudioPlayer(require('./assets/sounds/footstep-2.wav')),
    useAudioPlayer(require('./assets/sounds/footstep-3.wav')),
    useAudioPlayer(require('./assets/sounds/footstep-4.wav')),
    useAudioPlayer(require('./assets/sounds/footstep-5.wav')),
    useAudioPlayer(require('./assets/sounds/footstep-6.wav')),
  ];

  // The same steps taken in water, for the ones that land in a puddle.
  const puddleSounds = [
    useAudioPlayer(require('./assets/sounds/puddle-1.wav')),
    useAudioPlayer(require('./assets/sounds/puddle-2.wav')),
    useAudioPlayer(require('./assets/sounds/puddle-3.wav')),
    useAudioPlayer(require('./assets/sounds/puddle-4.wav')),
    useAudioPlayer(require('./assets/sounds/puddle-5.wav')),
    useAudioPlayer(require('./assets/sounds/puddle-6.wav')),
  ];

  // His armour, over whichever ground he lands on. Kept separate from the steps
  // rather than mixed into them beforehand, so the two vary independently: six
  // grounds against eleven rattles is sixty-six different footfalls.
  const armourSounds = [
    useAudioPlayer(require('./assets/sounds/armour-1.wav')),
    useAudioPlayer(require('./assets/sounds/armour-2.wav')),
    useAudioPlayer(require('./assets/sounds/armour-3.wav')),
    useAudioPlayer(require('./assets/sounds/armour-4.wav')),
    useAudioPlayer(require('./assets/sounds/armour-5.wav')),
    useAudioPlayer(require('./assets/sounds/armour-6.wav')),
    useAudioPlayer(require('./assets/sounds/armour-7.wav')),
    useAudioPlayer(require('./assets/sounds/armour-8.wav')),
    useAudioPlayer(require('./assets/sounds/armour-9.wav')),
    useAudioPlayer(require('./assets/sounds/armour-10.wav')),
    useAudioPlayer(require('./assets/sounds/armour-11.wav')),
  ];

  // Music streams rather than being unpacked into memory, so length costs
  // download size and nothing else. Levels are baked in, like everything else.
  const menuMusic = useAudioPlayer(require('./assets/music/menu.mp3'));
  const gameMusic = useAudioPlayer(require('./assets/music/game.mp3'));

  // The weather, under the music rather than beside it. Built as a seamless
  // 22 s loop out of a 105 s field recording -- see AMBIENCE in sound-config.
  const rainAmbience = useAudioPlayer(require('./assets/music/rain.mp3'));

  // Starting a run. All four sound together rather than one being chosen, which
  // is why each is 6 dB down -- they are one sound in four pieces, not a pool.
  const menuPressSounds = [
    useAudioPlayer(require('./assets/sounds/menu-press-1.wav')),
    useAudioPlayer(require('./assets/sounds/menu-press-2.wav')),
    useAudioPlayer(require('./assets/sounds/menu-press-3.wav')),
    useAudioPlayer(require('./assets/sounds/menu-press-4.wav')),
  ];

  const tearRef = useRef<TearHandle>(null);
  // The way out. Held as a ref so it carries on across the screen changing
  // underneath it -- the fade has to outlive the menu it started in.
  const veilBlack = useRef(new Animated.Value(0)).current;
  const leavingRef = useRef(false);

  /** The whole press, all four pieces struck together. */
  const playMenuPress = () => {
    for (const piece of menuPressSounds) playSfx(piece);
  };

  /**
   * Leaves the menu properly rather than cutting away from it.
   *
   * The plaque is given its full second and a third to come apart before
   * anything else happens -- starting the run on the press meant the tear was
   * ordered and then never seen. Then the screen goes with it, and the run only
   * begins once there is black over the top, so the field never appears mid-fade.
   */
  const leaveMenu = (start: () => void) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    playMenuPress();
    tearRef.current?.fire();

    // Every step is on a clock rather than hung off the previous animation's
    // completion. An animation only finishes if frames are being drawn, and a
    // tab that has been throttled draws almost none -- so gating the run on one
    // meant pressing the button and never arriving, which is exactly what
    // happened. The fades are decoration; the schedule is not.
    const fadeAt = tearRef.current ? TEAR_MS : 0;

    setTimeout(() => {
      Animated.timing(veilBlack, { toValue: 1, duration: LEAVE_FADE_MS, useNativeDriver: true }).start();
    }, fadeAt);

    setTimeout(() => {
      start();
      setTimeout(() => {
        Animated.timing(veilBlack, { toValue: 0, duration: RETURN_MS, useNativeDriver: true }).start();
        leavingRef.current = false;
      }, LEAVE_HOLD_MS);
    }, fadeAt + LEAVE_FADE_MS);
  };

  const leaveVeil = <Animated.View style={[styles.leaveVeil, { opacity: veilBlack }]} />;

  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [skillsMenuOpen, setSkillsMenuOpen] = useState(false);
  const [invMenuOpen, setInvMenuOpen] = useState(false);
  const [mobStatsOpen, setMobStatsOpen] = useState(false);
  const [dragging, setDragging] = useState<{ kind: ItemKind; level: number; x: number; y: number } | null>(null);
  const [, setTick] = useState(0);

  const playerRef = useRef(player);
  const metaRef = useRef(meta);
  const mobsRef = useRef(mobs);
  const alliesRef = useRef(allies);
  const abilitiesRef = useRef(abilities);
  const passiveRef = useRef(passive);
  const projectilesRef = useRef(projectiles);
  const hitFlashesRef = useRef(hitFlashes);
  const bloodSplatsRef = useRef(bloodSplats);
  const corpsesRef = useRef(corpses);
  const coneZonesRef = useRef(coneZones);
  /** The kit's engine, once it has built itself. Null on anything but web. */
  const coinSackRef = useRef<CoinSackHandle>(null);
  const floatingTextsRef = useRef(floatingTexts);
  const waveRef = useRef(wave);
  const waveActiveRef = useRef(waveActive);
  const gameOverRef = useRef(gameOver);
  const groundItemsRef = useRef(groundItems);
  const equippedRef = useRef(equipped);
  const bagRef = useRef(bag);
  const waveQueueRef = useRef<MobType[]>([]);
  // Wave numbers whose clear-reward loot hasn't dropped yet. Starting a new wave
  // before the field is clear leaves the previous wave's loot owed here.
  const lootOwedRef = useRef<number[]>([]);
  const materialsRef = useRef(materials);
  const screenRef = useRef(screen);
  // Any overlay (menu or tooltip) being open pauses the simulation.
  const overlayOpenRef = useRef(false);
  // The game loop is created once, so it reaches the players through a ref like
  // everything else it touches rather than closing over the first render's array.
  const attackSoundsRef = useRef(attackSounds);
  attackSoundsRef.current = attackSounds;
  const killSoundsRef = useRef(killSounds);
  killSoundsRef.current = killSounds;
  const goreSoundsRef = useRef(goreSounds);
  goreSoundsRef.current = goreSounds;
  const kickSoundsRef = useRef(kickSounds);
  kickSoundsRef.current = kickSounds;

  // A swing's sound is held back until the blade comes round. These carry that
  // pending sound between frames. They are refs rather than player state because
  // nothing about them belongs in a saved run.
  const swingSoundTimerRef = useRef(0);
  /** Seconds until the kick's leg is out and the crowd is shoved. 0 = no kick pending. */
  const kickShoveTimerRef = useRef(0);
  const swingSoundPlayerRef = useRef<AudioPlayer | undefined>(undefined);
  /** The boot's pending sound, aimed at the same frame the shove fires on. */
  const kickSoundTimerRef = useRef(0);
  const kickSoundPlayerRef = useRef<AudioPlayer | undefined>(undefined);
  /**
   * Seconds left of the death animation and its hold; null while he lives.
   * While set, the knight takes no orders, swings nothing and regenerates
   * nothing -- but the field keeps simulating around him, which is the whole
   * point: he falls in motion instead of freezing mid-hit.
   */
  const dieTimerRef = useRef<number | null>(null);
  /** A cast pose waiting for the animation chain, set the moment a skill fires. */
  const pendingCastAnimRef = useRef<AnimName | null>(null);
  /** Where to throw extra blood when the pending sound turns out to be a gore one. */
  const swingSoundGorePosRef = useRef<Vec | null>(null);
  const hurtSoundsRef = useRef(hurtSounds);
  hurtSoundsRef.current = hurtSounds;
  const drawSoundRef = useRef(drawSound);
  drawSoundRef.current = drawSound;
  const footstepSoundsRef = useRef(footstepSounds);
  footstepSoundsRef.current = footstepSounds;
  const puddleSoundsRef = useRef(puddleSounds);
  puddleSoundsRef.current = puddleSounds;
  const armourSoundsRef = useRef(armourSounds);
  armourSoundsRef.current = armourSounds;
  /** So the same rattle never lands twice running either. */
  const lastArmourRef = useRef(-1);
  /**
   * Which step of the cycle he is on, or null when he is not on his feet.
   *
   * Null is what stops him stamping the moment he starts moving: the first
   * frame back on foot records where the cycle stands without sounding it, and
   * only a change after that is a step.
   */
  const footstepStepRef = useRef<number | null>(null);
  /** So the same take never lands twice running. */
  const lastFootstepRef = useRef(-1);
  const hurtAnimGapRef = useRef(0);

  playerRef.current = player;
  metaRef.current = meta;
  mobsRef.current = mobs;
  alliesRef.current = allies;
  abilitiesRef.current = abilities;
  passiveRef.current = passive;
  projectilesRef.current = projectiles;
  hitFlashesRef.current = hitFlashes;
  bloodSplatsRef.current = bloodSplats;
  corpsesRef.current = corpses;
  coneZonesRef.current = coneZones;
  floatingTextsRef.current = floatingTexts;
  waveRef.current = wave;
  waveActiveRef.current = waveActive;
  gameOverRef.current = gameOver;
  groundItemsRef.current = groundItems;
  equippedRef.current = equipped;
  bagRef.current = bag;
  materialsRef.current = materials;
  screenRef.current = screen;
  overlayOpenRef.current = skillsMenuOpen || invMenuOpen || mobStatsOpen || tooltip != null;

  // Run bookkeeping: which saved run (if any) is active, and whether this is a
  // throwaway test run that should never be persisted.
  const currentRunIdRef = useRef<string | null>(null);
  const isTestRunRef = useRef(false);
  // Highest wave cleared this run, for the gold banked on death.
  const highestWaveClearedRef = useRef(0);
  // Guards the one-time gold payout when a run ends.
  const goldBankedRef = useRef(false);

  const spawnTimerRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    loadRuns().then((runs) => {
      setSavedRuns(runs);
      setRunsLoaded(true);
    });
    loadMeta().then((m) => {
      metaRef.current = m;
      setMeta(m);
    });
  }, []);

  // Spend gold from the account and persist. Used by the main-menu skill shop.
  const commitMeta = (next: MetaState) => {
    metaRef.current = next;
    setMeta(next);
    persistMeta(next);
  };

  // Buy the next level of a skill (its first level unlocks it), if the tree
  // requirement is met and there is gold for it.
  const buySkillLevel = (skill: SkillId) => {
    const m = metaRef.current;
    const level = m.skillLevels[skill] ?? 0;
    if (level >= ABILITY_MAX_LEVEL) return;
    const parent = SKILL_PARENT[skill];
    if (parent && (m.skillLevels[parent] ?? 0) < 1) return; // locked by the tree
    const cost = skillLevelCost(level + 1);
    if (m.gold < cost) return;
    commitMeta({
      ...m,
      gold: m.gold - cost,
      skillLevels: { ...m.skillLevels, [skill]: level + 1 },
    });
  };

  // Toggle a skill in or out of its slot. Passives share a single slot (so
  // equipping one replaces whatever passive was there); actives fill up to three.
  const toggleEquip = (skill: SkillId) => {
    const m = metaRef.current;
    if ((m.skillLevels[skill] ?? 0) < 1) return; // must own it first
    if (isPassiveSkill(skill)) {
      commitMeta({ ...m, passive: m.passive === skill ? null : skill });
      return;
    }
    const has = m.loadout.includes(skill);
    let loadout: SkillId[];
    if (has) {
      loadout = m.loadout.filter((s) => s !== skill);
    } else {
      if (m.loadout.length >= MAX_EQUIPPED) return;
      loadout = [...m.loadout, skill];
    }
    commitMeta({ ...m, loadout });
  };

  // Pull the art down while the menu is up, so a run starts with everything
  // already in hand. Failures are ignored on purpose: a sheet that misses here
  // simply loads when it is first drawn, which is what used to happen anyway.
  //
  // The coin sack's art and coin sounds go with them. Its engine cannot be
  // built until they have arrived, so leaving them until the run starts meant
  // the sack assembled itself in front of the player.
  useEffect(() => {
    Asset.loadAsync(COINSACK_ENABLED ? [...ALL_SHEETS, ...COINSACK_ASSETS] : ALL_SHEETS).catch(() => {});
  }, []);

  // One track for the menu, another once a run is under way.
  //
  // Browsers refuse to start audio before the page has been interacted with, so
  // the menu track may stay silent on a cold load until the first tap. Nothing
  // to be done about that from here, and by the time anyone reaches the menu a
  // second time they have long since clicked something.
  useEffect(() => {
    const playing = screen === 'game' ? gameMusic : menuMusic;
    const quiet = screen === 'game' ? menuMusic : gameMusic;
    try {
      quiet.pause();
      // The music switch takes the two tracks alone; the master takes those
      // and everything below it too.
      if (musicOff || allSoundOff) {
        playing.pause();
      } else {
        playing.loop = true;
        playing.play();
      }

      // Weather belongs to the field, so it runs with a run and stops with it.
      // Nothing to cross-fade: it is quiet enough to simply start.
      if (screen === 'game' && RAIN_ENABLED && !allSoundOff) {
        rainAmbience.loop = true;
        rainAmbience.play();
      } else {
        rainAmbience.pause();
      }
    } catch {
      // music is decoration; never let it take the game down
    }
  }, [screen, musicOff, allSoundOff, gameMusic, menuMusic, rainAmbience]);

  // ---- Tooltip helpers ----
  const tooltipOpenedAtRef = useRef(0);
  const dismissTooltip = () => setTooltip(null);
  // Ignore the trailing click that immediately follows opening (it would otherwise
  // dismiss the tooltip on the same tap that opened it).
  const handleDismissOverlayPress = () => {
    if (Date.now() - tooltipOpenedAtRef.current > 250) dismissTooltip();
  };

  // Shows the tooltip anchored just above the element registered under `key`
  // (via registerSlot), rather than wherever the tap landed inside it.
  const showTooltipAboveKey = (key: string, text: string) => {
    if (tooltip && tooltip.key === key) {
      setTooltip(null);
      return;
    }
    tooltipOpenedAtRef.current = Date.now();
    const node = slotNodesRef.current[key];
    if (node && node.measureInWindow) {
      node.measureInWindow((x: number, y: number, w: number, h: number) => {
        slotRectsRef.current[key] = { x, y, w, h };
        setTooltip({ key, text, x: x + w / 2, y });
      });
    } else {
      const r = slotRectsRef.current[key];
      setTooltip({ key, text, x: r ? r.x + r.w / 2 : SCREEN_W / 2, y: r ? r.y : SCREEN_H / 2 });
    }
  };

  // ---- Inventory drag between slots ----
  const slotRectsRef = useRef<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const slotNodesRef = useRef<Record<string, any>>({});
  const dragRef = useRef<{ fromKey: string; item: Item; startX: number; startY: number; moved: boolean } | null>(null);

  const registerSlot = (key: string) => ({
    ref: (n: any) => {
      slotNodesRef.current[key] = n;
    },
    onLayout: () => {
      const n = slotNodesRef.current[key];
      if (n && n.measureInWindow) {
        n.measureInWindow((x: number, y: number, w: number, h: number) => {
          slotRectsRef.current[key] = { x, y, w, h };
        });
      }
    },
  });

  const itemAtKey = (key: string): Item | null => {
    if (key.startsWith('equip-')) return equippedRef.current[+key.slice(6)] ?? null;
    if (key.startsWith('bag-')) return bagRef.current[+key.slice(4)] ?? null;
    return null;
  };

  const keyAtPoint = (px: number, py: number): string | null => {
    for (const key of Object.keys(slotRectsRef.current)) {
      const r = slotRectsRef.current[key];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return key;
    }
    return null;
  };

  const commitInventory = (newEquipped: Slot[], newBag: Slot[]) => {
    equippedRef.current = newEquipped;
    bagRef.current = newBag;
    setEquipped(newEquipped);
    setBag(newBag);
  };

  const applyMove = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const newEquipped = equippedRef.current.slice();
    const newBag = bagRef.current.slice();
    const get = (key: string): Item | null =>
      key.startsWith('equip-') ? newEquipped[+key.slice(6)] : newBag[+key.slice(4)];
    const set = (key: string, val: Item | null) => {
      if (key.startsWith('equip-')) newEquipped[+key.slice(6)] = val;
      else newBag[+key.slice(4)] = val;
    };
    const a = get(fromKey);
    const b = get(toKey);
    set(fromKey, b);
    set(toKey, a);
    commitInventory(newEquipped, newBag);
  };

  const handleSlotGrant = (key: string, e: GestureResponderEvent) => {
    const item = itemAtKey(key);
    if (!item) {
      dragRef.current = null;
      return;
    }
    dragRef.current = { fromKey: key, item, startX: e.nativeEvent.pageX, startY: e.nativeEvent.pageY, moved: false };
  };

  const handleSlotMove = (e: GestureResponderEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.nativeEvent.pageX - d.startX;
    const dy = e.nativeEvent.pageY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > INV_DRAG_THRESHOLD) {
      d.moved = true;
      dismissTooltip();
    }
    if (d.moved) {
      setDragging({ kind: d.item.kind, level: d.item.level, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
    }
  };

  const handleSlotRelease = (key: string, e: GestureResponderEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(null);
    if (!d) return;
    const item = itemAtKey(key);
    if (!d.moved) {
      if (item) showTooltipAboveKey(`slot-${key}`, itemTooltip(item));
      return;
    }
    const dropKey = keyAtPoint(e.nativeEvent.pageX, e.nativeEvent.pageY);
    if (dropKey && (dropKey.startsWith('equip-') || dropKey.startsWith('bag-'))) {
      applyMove(d.fromKey, dropKey);
    }
  };

  // ---- Play area input ----
  // aimingAbility, when set, is the slot whose (Cone) skill is being aimed.
  const handlePlayAreaGrant = (e: GestureResponderEvent) => {
    // The die-timer check is ours: a falling knight takes no orders.
    if (gameOverRef.current || dieTimerRef.current != null) return;
    const { locationX, locationY } = e.nativeEvent;
    if (aimingAbility != null) {
      setAimPreviewPoint({ x: locationX, y: locationY });
      return;
    }
    // He takes no orders until the sword is out. Tapping used to cut the
    // entrance short on the reasoning that a flourish should not be waited out
    // -- but it is over in well under two seconds now, and a knight who can be
    // marched off mid-draw never looks like he meant to arrive.
    if (playerRef.current.introPhase !== 'done') return;
    setPlayer((p) => ({ ...p, target: { x: locationX, y: locationY } }));
  };

  const handlePlayAreaMove = (e: GestureResponderEvent) => {
    if (gameOverRef.current || aimingAbility == null) return;
    const { locationX, locationY } = e.nativeEvent;
    setAimPreviewPoint({ x: locationX, y: locationY });
  };

  const handlePlayAreaRelease = (e: GestureResponderEvent) => {
    if (gameOverRef.current || aimingAbility == null) return;
    const slot = aimingAbility;
    const { locationX, locationY } = e.nativeEvent;
    const p = playerRef.current;
    const ab = abilitiesRef.current[slot];
    const cost = SKILL_META.cone.mana;
    setAimingAbility(null);
    setAimPreviewPoint(null);
    if (dieTimerRef.current != null || ab.skill !== 'cone' || p.mana < cost) return;
    // Ours: the cast pose. The skill's own work below stays exactly as it was.
    pendingCastAnimRef.current = 'rupture';
    // Ours too: the zone lit up on the ground, toward the aimed point.
    const zoneCells = buildConeZone(
      p.pos.x,
      p.pos.y,
      (Math.atan2(locationY - p.pos.y, locationX - p.pos.x) * 180) / Math.PI
    );
    setConeZones((prev) => prev.concat({ id: ++coneZoneIdCounter, cells: zoneCells, createdAt: Date.now() }));
    const baseDmg = ability2BaseDamage(ab.level);
    const dmgPercent = ability2DamagePercent(ab.level);
    const result = fireCone(p.pos, { x: locationX, y: locationY }, mobsRef.current, baseDmg, dmgPercent, CONE_RANGE, ABILITY2_HALF_ANGLE_DEG);
    setMobs(result.mobs);
    const now = Date.now();
    setFloatingTexts((prev) => prev.concat(result.hits.map((h) => makeFloatingText(`-${Math.round(h.amount)}`, h.pos, DAMAGE_TEXT_COLOR, now))));
    setPlayer((prev) => ({ ...prev, mana: prev.mana - cost }));
    const pv = passiveRef.current;
    const cdScale = pv && pv.skill === 'cdreduce' ? 1 - cooldownReducePercent(pv.level) : 1;
    setAbilities((prev) => ({ ...prev, [slot]: { ...prev[slot], cooldown: SKILL_META.cone.cooldown * cdScale } }));
  };

  const handleAbilityPress = (id: AbilityId) => {
    // The die-timer check is ours: a falling knight casts nothing.
    if (gameOverRef.current || dieTimerRef.current != null) return;
    const ab = abilitiesRef.current[id];
    const p = playerRef.current;
    const skill = ab.skill;
    if (!skill || ab.level <= 0 || ab.cooldown > 0) return;
    if (SKILL_META[skill].cast === 'passive') return; // passives have no active use
    const cost = SKILL_META[skill].mana;
    if (p.mana < cost) return;
    // The Haste passive shaves a share off every skill's cooldown.
    const pv = passiveRef.current;
    const cdScale = pv && pv.skill === 'cdreduce' ? 1 - cooldownReducePercent(pv.level) : 1;

    if (skill === 'summon') {
      // Ours: the cast pose. The summon itself is untouched.
      pendingCastAnimRef.current = 'ancestor';
      setAllies(makeAlliesForLevel(ab.level, p.pos));
    } else if (skill === 'cone') {
      // Ours: the cast pose. The cone itself is untouched.
      pendingCastAnimRef.current = 'rupture';
      // Fire at once, straight ahead of where the knight is facing.
      const dir = directionFromFacing(p.facing);
      const aim = { x: p.pos.x + dir.x * CONE_RANGE, y: p.pos.y + dir.y * CONE_RANGE };
      // Ours too: the zone lit up on the ground, aimed the same way.
      const zoneCells = buildConeZone(p.pos.x, p.pos.y, (Math.atan2(dir.y, dir.x) * 180) / Math.PI);
      setConeZones((prev) => prev.concat({ id: ++coneZoneIdCounter, cells: zoneCells, createdAt: Date.now() }));
      const result = fireCone(
        p.pos,
        aim,
        mobsRef.current,
        ability2BaseDamage(ab.level),
        ability2DamagePercent(ab.level),
        CONE_RANGE,
        ABILITY2_HALF_ANGLE_DEG
      );
      setMobs(result.mobs);
      const now = Date.now();
      setFloatingTexts((prev) =>
        prev.concat(result.hits.map((h) => makeFloatingText(`-${Math.round(h.amount)}`, h.pos, DAMAGE_TEXT_COLOR, now)))
      );
    } else if (skill === 'ranged') {
      setPlayer((prev) => ({ ...prev, hasteTimer: ABILITY3_HASTE_DURATION }));
    } else if (skill === 'fireball') {
      // A blast off every summon. Nothing to do (and nothing spent) if there
      // are no summons to throw one.
      const allies = alliesRef.current.filter((a) => a.hp > 0);
      if (allies.length === 0) return;
      const pct = fireballDamagePercent(ab.level);
      const now = Date.now();
      const flashes: HitFlash[] = [];
      const texts: FloatingText[] = [];
      const nextMobs = mobsRef.current.map((m) => {
        let dmg = 0;
        for (const a of allies) {
          if (dist(a.pos, m.pos) <= FIREBALL_RADIUS) dmg += pct * a.damage;
        }
        if (dmg > 0) {
          flashes.push({ id: ++hitFlashIdCounter, pos: { ...m.pos }, createdAt: now });
          texts.push(makeFloatingText(`-${Math.round(dmg)}`, m.pos, DAMAGE_TEXT_COLOR, now));
          return { ...m, hp: m.hp - dmg };
        }
        return m;
      });
      setMobs(nextMobs);
      setHitFlashes((prev) => prev.concat(flashes));
      setFloatingTexts((prev) => prev.concat(texts));
    } else if (skill === 'burn') {
      // Set the closest enemy afire; it explodes when it dies.
      const target = nearestTarget(p.pos, mobsRef.current.filter((m) => m.hp > 0).map((m) => ({ kind: 'mob' as const, id: m.id, pos: m.pos })), Infinity);
      if (!target) return;
      const pct = burnExplodePercent(ab.level);
      const dps = burnDamagePerSec(ab.level);
      setMobs(mobsRef.current.map((m) => (m.id === target.id ? { ...m, burnPct: pct, burnDps: dps } : m)));
      setFloatingTexts((prev) => prev.concat(makeFloatingText('afire', target.pos, '#ff7043', Date.now())));
    } else if (skill === 'push') {
      // Shove every enemy outward and deal a share of the player's attack damage.
      const now = Date.now();
      const dmgBonus = equippedBonus(equippedRef.current, 'dmg');
      let rangedLvl = 0;
      for (const k of [1, 2, 3] as AbilityId[]) if (abilitiesRef.current[k].skill === 'ranged') rangedLvl = abilitiesRef.current[k].level;
      const atkDmg = PLAYER_BASE_DAMAGE + ability3DamageBonus(rangedLvl) + dmgBonus;
      const dmg = pushDamagePercent(ab.level) * atkDmg;
      const flashes: HitFlash[] = [];
      const texts: FloatingText[] = [];
      const nextMobs = mobsRef.current.map((m) => {
        const dx = m.pos.x - p.pos.x;
        const dy = m.pos.y - p.pos.y;
        const d = Math.hypot(dx, dy) || 1;
        flashes.push({ id: ++hitFlashIdCounter, pos: { ...m.pos }, createdAt: now });
        texts.push(makeFloatingText(`-${Math.round(dmg)}`, m.pos, DAMAGE_TEXT_COLOR, now));
        return { ...m, hp: m.hp - dmg, knock: { x: (dx / d) * PUSH_SPEED, y: (dy / d) * PUSH_SPEED } };
      });
      setMobs(nextMobs);
      setHitFlashes((prev) => prev.concat(flashes));
      setFloatingTexts((prev) => prev.concat(texts));
    }

    setPlayer((prev) => ({ ...prev, mana: prev.mana - cost }));
    setAbilities((prev) => ({ ...prev, [id]: { ...prev[id], cooldown: SKILL_META[skill].cooldown * cdScale } }));
  };

  const handleStartNextWave = () => {
    if (gameOverRef.current || waveActiveRef.current) return;
    const nextWave = waveRef.current + 1;
    spawnTimerRef.current = 0;
    waveRef.current = nextWave;
    waveQueueRef.current = buildWaveQueue(nextWave);
    waveActiveRef.current = true;
    lootOwedRef.current.push(nextWave);
    setWave(nextWave);
    setWaveActive(true);
  };

  const applyGameState = (s: GameState) => {
    playerRef.current = s.player;
    mobsRef.current = [];
    alliesRef.current = [];
    abilitiesRef.current = s.abilities;
    passiveRef.current = s.passive;
    projectilesRef.current = [];
    hitFlashesRef.current = [];
    bloodSplatsRef.current = [];
    corpsesRef.current = [];
    coneZonesRef.current = [];
    floatingTextsRef.current = [];
    waveRef.current = s.wave;
    waveActiveRef.current = false;
    gameOverRef.current = false;
    groundItemsRef.current = [];
    equippedRef.current = s.equipped;
    bagRef.current = s.bag;
    waveQueueRef.current = [];
    lootOwedRef.current = [];
    materialsRef.current = s.materials;
    spawnTimerRef.current = 0;
    lastTimeRef.current = null;
    dieTimerRef.current = null;
    pendingCastAnimRef.current = null;

    setPlayer(s.player);
    setMobs([]);
    setAllies([]);
    setAbilities(s.abilities);
    setPassive(s.passive);
    setAimingAbility(null);
    setAimPreviewPoint(null);
    setProjectiles([]);
    setHitFlashes([]);
    setBloodSplats([]);
    setCorpses([]);
    setConeZones([]);
    setFloatingTexts([]);
    setWave(s.wave);
    setWaveActive(false);
    setGameOver(false);
    setGroundItems([]);
    setEquipped(s.equipped);
    setBag(s.bag);
    setMaterials(s.materials);
    setTooltip(null);
    setSkillsMenuOpen(false);
    setInvMenuOpen(false);
    setMobStatsOpen(false);
    setDragging(null);
  };

  const handleStartNewRun = () => {
    currentRunIdRef.current = `run-${Date.now()}`;
    isTestRunRef.current = false;
    highestWaveClearedRef.current = 0;
    goldBankedRef.current = false;
    setLastRunGold(0);
    applyGameState(buildFreshState(metaRef.current));
    setScreen('game');
  };

  const handleStartTestRun = () => {
    currentRunIdRef.current = null;
    isTestRunRef.current = true;
    highestWaveClearedRef.current = 0;
    goldBankedRef.current = false;
    setLastRunGold(0);
    // Testing is meant for trying skills out, so top the account up to a
    // comfortable 1000 gold to spend in the shop.
    if (metaRef.current.gold < 1000) commitMeta({ ...metaRef.current, gold: 1000 });
    applyGameState(buildTestState(metaRef.current));
    setScreen('game');
  };

  const handleContinueRun = (save: RunSave) => {
    currentRunIdRef.current = save.id;
    isTestRunRef.current = false;
    highestWaveClearedRef.current = save.wave;
    goldBankedRef.current = false;
    setLastRunGold(0);
    applyGameState(buildStateFromSave(save));
    setScreen('game');
  };

  const handleBackToMenu = () => {
    setScreen('menu');
  };

  // Leave the run early and cash out: bank the gold for the waves cleared so
  // far, end the run (its save is dropped so it can't be banked twice), and
  // return to the menu.
  const handleExitRun = () => {
    if (!isTestRunRef.current && !goldBankedRef.current) {
      goldBankedRef.current = true;
      const earned = goldForWavesCleared(highestWaveClearedRef.current);
      if (earned > 0) {
        commitMeta({ ...metaRef.current, gold: metaRef.current.gold + earned });
        setLastRunGold(earned);
      }
    }
    if (!isTestRunRef.current && currentRunIdRef.current) {
      const id = currentRunIdRef.current;
      setSavedRuns((prev) => {
        const next = prev.filter((r) => r.id !== id);
        persistRuns(next);
        return next;
      });
    }
    currentRunIdRef.current = null;
    gameOverRef.current = true; // stop the loop from advancing the abandoned run
    setScreen('menu');
  };

  useEffect(() => {
    const step = (time: number) => {
      if (screenRef.current !== 'game' || gameOverRef.current || overlayOpenRef.current) {
        lastTimeRef.current = null;
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      // The 60-cap (ours, with Nicolai's go -- easy to lift back out).
      //
      // requestAnimationFrame follows the display, so on his monitor this loop
      // ran 220 times a second: simulating, rebuilding the tree and leaving
      // garbage at 220 Hz for art that plays at 10-24 fps. The residual hitch
      // that came and went at rest was the collector clearing that up. Frames
      // closer together than the budget are skipped whole -- the timestamp
      // below stays put, so dt on the frame that does run is the true elapsed
      // time and the simulation neither hurries nor drifts.
      //
      // 15 ms rather than 16.7 on purpose: a true 60 Hz display jitters around
      // its own interval, and the stricter budget would make it skip real
      // frames. Displays at or under 60 Hz pass through untouched.
      if (lastTimeRef.current != null && time - lastTimeRef.current < 15) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      bumpSimTick();

      if (lastTimeRef.current == null) lastTimeRef.current = time;
      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = time;
      const now = Date.now();

      let p = { ...playerRef.current };
      const currentMobs = mobsRef.current.map((m) => ({ ...m }));
      const currentAllies = alliesRef.current.map((a) => ({ ...a }));
      const newProjectiles: Projectile[] = [];
      const newFlashes: HitFlash[] = [];
      const newBlood: BloodSplat[] = [];
      const newCorpses: Corpse[] = [];
      const newFloatingTexts: FloatingText[] = [];

      const eq = equippedRef.current;
      const dmgBonus = equippedBonus(eq, 'dmg');
      const atkSpdBonusPct = equippedBonus(eq, 'atkspd');
      const manaBonus = equippedBonus(eq, 'mana');
      const manaRegenBonus = equippedBonus(eq, 'manaregen');
      const hpBonus = equippedBonus(eq, 'health');
      const hpRegenBonus = equippedBonus(eq, 'healthregen');
      const effectiveMaxMana = MANA_MAX + manaBonus;

      let damageToPlayer = 0;

      // Resolve in-flight projectiles: damage lands only on arrival
      const stillFlying: Projectile[] = [];
      for (const pr of projectilesRef.current) {
        if (now - pr.createdAt >= pr.duration) {
          if (pr.friendly && pr.targetKind === 'mob') {
            const hitPositions: Vec[] = [];
            const target = currentMobs.find((m) => m.id === pr.targetId);
            if (target && target.hp > 0) {
              target.hp -= pr.damage;
              hurtMob(target, pr.from);
              hitPositions.push({ ...target.pos });
            }
            // Pierce: strike further enemies lying along the shot's line.
            if ((pr.pierce ?? 0) > 0) {
              const dx = pr.to.x - pr.from.x;
              const dy = pr.to.y - pr.from.y;
              const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len;
              const uy = dy / len;
              const extras = currentMobs
                .filter((m) => m.hp > 0 && m.id !== pr.targetId)
                .map((m) => {
                  const rx = m.pos.x - pr.from.x;
                  const ry = m.pos.y - pr.from.y;
                  return { m, along: rx * ux + ry * uy, perp: Math.abs(rx * uy - ry * ux) };
                })
                .filter((e) => e.along > 0 && e.perp <= PIERCE_WIDTH + e.m.radius)
                .sort((a, b) => a.along - b.along)
                .slice(0, pr.pierce);
              for (const e of extras) {
                e.m.hp -= pr.damage;
                hurtMob(e.m, pr.from);
                hitPositions.push({ ...e.m.pos });
              }
            }
            if (hitPositions.length === 0) hitPositions.push({ ...pr.to });
            for (const pos of hitPositions) {
              newFloatingTexts.push(makeFloatingText(`-${Math.round(pr.damage)}`, pos, DAMAGE_TEXT_COLOR, now));
              newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...pos }, createdAt: now });
            }
          } else if (!pr.friendly && pr.targetKind === 'player') {
            damageToPlayer += pr.damage;
            newFloatingTexts.push(makeFloatingText(`-${Math.round(pr.damage)}`, pr.to, TAKEN_TEXT_COLOR, now));
          } else if (!pr.friendly && pr.targetKind === 'ally') {
            const ally = currentAllies.find((a) => a.id === pr.targetId);
            if (ally) ally.hp -= pr.damage;
            newFloatingTexts.push(makeFloatingText(`-${Math.round(pr.damage)}`, pr.to, TAKEN_TEXT_COLOR, now));
          }
          // Mob-hit flashes are placed per pierced target above; other kinds
          // flash at the arrival point here.
          if (!(pr.friendly && pr.targetKind === 'mob')) {
            newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...pr.to }, createdAt: now });
          }
        } else {
          stillFlying.push(pr);
        }
      }

      // Player movement toward target. The die-timer check is ours: a tap
      // landing while he falls must not drag the corpse across the field.
      let moving = false;
      if (p.target && dieTimerRef.current == null) {
        const d = dist(p.pos, p.target);
        if (d < 4) {
          p.target = null;
        } else {
          const dx = p.target.x - p.pos.x;
          const dy = p.target.y - p.pos.y;
          // He walks in and runs everywhere after.
          const speed = p.introPhase === 'enter' ? INTRO_WALK_SPEED : PLAYER_SPEED;
          const step = speed * dt;
          const ratio = Math.min(1, step / d);
          p.pos = { x: p.pos.x + dx * ratio, y: p.pos.y + dy * ratio };
          p.facing = facingFromDelta(dx, dy);
          moving = true;
        }
      }

      // The animation itself is chosen further down, once this frame's attacks
      // and incoming damage are known.
      p.animTime += dt;

      // Not while running in: he starts below the bottom edge on purpose, and
      // this would snap him into view before he has taken a step.
      if (p.introPhase !== 'enter') {
        p.pos.x = Math.max(PLAYER_RADIUS, Math.min(SCREEN_W - PLAYER_RADIUS, p.pos.x));
        p.pos.y = Math.max(PLAYER_RADIUS, Math.min(PLAY_H - PLAYER_RADIUS, p.pos.y));
      }

      p.mana = Math.min(effectiveMaxMana, p.mana + (MANA_REGEN_PER_SEC + manaRegenBonus) * dt);
      // No regeneration once the fall has begun (ours): a corpse that climbed
      // back over zero would call the game over off mid-animation.
      if (dieTimerRef.current == null) p.hp = Math.min(p.maxHp + hpBonus, p.hp + hpRegenBonus * dt);
      p.attackCooldown = Math.max(0, p.attackCooldown - dt);
      p.hasteTimer = Math.max(0, p.hasteTimer - dt);

      // Ground item pickup (walk into it) -> first free equipped slot, else bag
      const unexpiredItems = groundItemsRef.current.filter((it) => now - it.createdAt < ITEM_DESPAWN_MS);
      let newEquipped: Slot[] | null = null;
      let newBag: Slot[] | null = null;
      const remainingItems: GroundItem[] = [];
      for (const it of unexpiredItems) {
        if (dist(p.pos, it.pos) <= ITEM_PICKUP_RADIUS) {
          const eqArr = newEquipped || equippedRef.current;
          const bagArr = newBag || bagRef.current;
          const ei = eqArr.indexOf(null);
          const bi = bagArr.indexOf(null);
          if (ei !== -1 || bi !== -1) {
            if (!newEquipped) {
              newEquipped = equippedRef.current.slice();
              newBag = bagRef.current.slice();
            }
            if (newEquipped.indexOf(null) !== -1) newEquipped[newEquipped.indexOf(null)] = it.item;
            else newBag![newBag!.indexOf(null)] = it.item;
            continue;
          }
        }
        remainingItems.push(it);
      }

      // Ranged may sit in any active slot; Pierce is the equipped passive. Either
      // one turns the basic attack into shots; Pierce lets each volley strike more
      // enemies.
      const equippedLevelOf = (skill: SkillId): number => {
        for (const k of [1, 2, 3] as AbilityId[]) {
          if (abilitiesRef.current[k].skill === skill) return abilitiesRef.current[k].level;
        }
        return 0;
      };
      const passiveNow = passiveRef.current;
      const ability3Level = equippedLevelOf('ranged');
      const pierceLevel = passiveNow?.skill === 'pierce' ? passiveNow.level : 0;
      const allyRegenPerSec = passiveNow?.skill === 'summonregen' ? summonRegenPerSec(passiveNow.level) : 0;
      const isRangedAttack = ability3Level > 0 || pierceLevel > 0;
      const pierceExtra = pierceTargetCount(pierceLevel);
      const playerAttackRange = isRangedAttack ? RANGED_ATTACK_RANGE : PLAYER_ATTACK_RANGE;
      const playerDamage = PLAYER_BASE_DAMAGE + ability3DamageBonus(ability3Level) + dmgBonus;
      const attackCooldownDuration =
        (PLAYER_ATTACK_COOLDOWN * (p.hasteTimer > 0 ? 0.5 : 1)) / (1 + atkSpdBonusPct);

      // Attack speed can outrun the swing animation: haste alone takes the
      // interval to 0.4 s against an animation lasting 0.625 s, and with gear on
      // top it reaches 0.27 s. The animation would then only restart once the
      // previous had finished, so most blows landed with no visible swing at all.
      //
      // Playing the same frames faster keeps every swing whole and reads as what
      // a haste buff should look like. Restarting it mid-swing instead would show
      // the wind-up over and over and never the strike, which sits 60% in.
      const attackAnimSpeed = Math.max(1, animDuration(ANIMS.attack) / attackCooldownDuration);

      let xpGain = 0;

      // Mob AI
      for (const m of currentMobs) {
        m.attackCooldown = Math.max(0, m.attackCooldown - dt);
        m.animTime += dt;
        m.flashTime = Math.max(0, m.flashTime - dt);
        m.hurtGap = Math.max(0, m.hurtGap - dt);
        // Burn's damage-over-time while the mob is afire.
        if ((m.burnDps ?? 0) > 0 && m.hp > 0) m.hp -= m.burnDps! * dt;

        // The shove from the last blow, bleeding off as it goes. Applied before
        // the mob takes its own turn, so one that is chasing spends the moment
        // after a hit walking back in rather than being frozen out of the frame.
        // Held inside the field, or a mob caught at the top edge is punted off
        // the screen and has to walk all the way back.
        if (m.knock.x !== 0 || m.knock.y !== 0) {
          m.pos = {
            x: Math.min(SCREEN_W - m.radius, Math.max(m.radius, m.pos.x + m.knock.x * dt)),
            y: Math.min(PLAY_H - m.radius, Math.max(m.radius, m.pos.y + m.knock.y * dt)),
          };
          const fade = Math.exp(-dt / KNOCKBACK_TAU);
          m.knock = { x: m.knock.x * fade, y: m.knock.y * fade };
          if (Math.hypot(m.knock.x, m.knock.y) < KNOCKBACK_STOP) m.knock = { x: 0, y: 0 };
        }
        // A swing owns the sprite until it finishes, exactly as the player's does.
        const mobBusy = !MOB_ANIMS[m.anim].loop && m.animTime < animDuration(MOB_ANIMS[m.anim]);
        const setMobAnim = (next: MobAnimName) => {
          if (mobBusy) return;
          if (next !== m.anim || !MOB_ANIMS[next].loop) m.animTime = 0;
          m.anim = next;
        };
        const detect = m.type === 'boss' ? 99999 : m.type === 'ranged' ? 260 : RANGED_ATTACK_RANGE;

        let nearest: Target | null = null;
        let nearestDist = Infinity;
        const dToPlayer = dist(m.pos, p.pos);
        if (dToPlayer <= detect) {
          nearest = { kind: 'player', pos: p.pos };
          nearestDist = dToPlayer;
        }
        for (const a of currentAllies) {
          if (a.hp <= 0) continue;
          const dToAlly = dist(m.pos, a.pos);
          if (dToAlly <= detect && dToAlly < nearestDist) {
            nearest = { kind: 'ally', id: a.id, pos: a.pos };
            nearestDist = dToAlly;
          }
        }

        if (!nearest) {
          // Nobody in sight: shamble down the screen, facing that way.
          m.pos = { x: m.pos.x, y: m.pos.y + MOB_SPEED * 0.5 * dt };
          m.facing = facingFromDelta(0, 1);
          setMobAnim('walk');
          continue;
        }

        // Always face whatever it is chasing or hitting. Unlike the player,
        // there is no tap-to-move to conflict with, so this can be unconditional.
        m.facing = facingFromDelta(nearest.pos.x - m.pos.x, nearest.pos.y - m.pos.y);

        if (m.type === 'ranged') {
          if (nearestDist <= MOB_RANGED_FIRE_RANGE) {
            if (m.attackCooldown <= 0) {
              newProjectiles.push({
                id: ++projectileIdCounter,
                from: { ...m.pos },
                to: { ...nearest.pos },
                createdAt: now,
                duration: Math.max(80, (nearestDist / PROJECTILE_SPEED) * 1000),
                color: '#ff8a80',
                damage: m.damage,
                friendly: false,
                targetKind: nearest.kind === 'player' ? 'player' : 'ally',
                targetId: nearest.id ?? -1,
              });
              m.attackCooldown = MOB_ATTACK_COOLDOWN;
            }
          } else {
            const dx = nearest.pos.x - m.pos.x;
            const dy = nearest.pos.y - m.pos.y;
            const step = MOB_SPEED * dt;
            const ratio = Math.min(1, step / nearestDist);
            m.pos = { x: m.pos.x + dx * ratio, y: m.pos.y + dy * ratio };
          }
        } else {
          const contact = MOB_ATTACK_RANGE + (m.radius - MOB_RADIUS);
          if (nearestDist <= contact) {
            if (m.attackCooldown <= 0) {
              if (nearest.kind === 'player') {
                damageToPlayer += m.damage;
                newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...p.pos }, createdAt: now });
                newFloatingTexts.push(makeFloatingText(`-${m.damage}`, p.pos, TAKEN_TEXT_COLOR, now));
              } else {
                const ally = currentAllies.find((a) => a.id === nearest.id);
                if (ally) {
                  ally.hp -= m.damage;
                  newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...ally.pos }, createdAt: now });
                  newFloatingTexts.push(makeFloatingText(`-${m.damage}`, ally.pos, TAKEN_TEXT_COLOR, now));
                }
              }
              m.attackCooldown = MOB_ATTACK_COOLDOWN;
              setMobAnim(MOB_ATTACK_ANIMS[Math.floor(Math.random() * MOB_ATTACK_ANIMS.length)]);
            }
          } else {
            const dx = nearest.pos.x - m.pos.x;
            const dy = nearest.pos.y - m.pos.y;
            const step = MOB_SPEED * dt;
            const ratio = Math.min(1, step / nearestDist);
            m.pos = { x: m.pos.x + dx * ratio, y: m.pos.y + dy * ratio };
            setMobAnim('walk');
          }
        }
      }

      /**
       * Whether a swing fired this frame will actually be seen.
       *
       * The animation chain below gives the flinch right of way, so a swing
       * that fires while he is being hit -- or while a flinch is still
       * playing -- lands with no visible swing behind it. Its damage stands
       * (Nicolai's line: the numbers are not ours to touch), but the shove is
       * withheld and delivered by the kick that follows the flinch instead,
       * so the crowd flies when the leg goes out and not before.
       *
       * This mirrors the chain's own tests, computed early: oneShotBusy the
       * same way, and the flinch gap with this frame's dt already counted
       * off, since the real decrement happens between here and there.
       */
      const preDef = ANIMS[p.anim];
      const preBusy =
        !preDef.loop &&
        p.animTime * p.animSpeed < animDuration(preDef) &&
        !(preDef.interruptedByMoving && moving);
      const flinchWillWin =
        damageToPlayer > 0 &&
        !(p.anim === 'attack' && preBusy) &&
        hurtAnimGapRef.current - dt <= 0;
      const swingHidden = flinchWillWin || (preBusy && p.anim !== 'attack');

      // Player attack: melee hits everything in range instantly, ranged fires
      // projectiles. The die-timer check is ours: a dead man swings no sword.
      let playerAttacked = false;
      const attackTargets: Vec[] = [];
      if (p.attackCooldown <= 0 && dieTimerRef.current == null) {
        if (isRangedAttack) {
          // Always fire a single shot at the nearest enemy. Pierce (if equipped)
          // lets that one shot carry through further enemies along its line.
          const target = currentMobs
            .filter((m) => m.hp > 0 && dist(m.pos, p.pos) <= playerAttackRange)
            .sort((a, b) => dist(a.pos, p.pos) - dist(b.pos, p.pos))[0];
          if (target) {
            attackTargets.push({ ...target.pos });
            newProjectiles.push({
              id: ++projectileIdCounter,
              from: { ...p.pos },
              to: { ...target.pos },
              createdAt: now,
              duration: Math.max(80, (dist(p.pos, target.pos) / PROJECTILE_SPEED) * 1000),
              color: '#e1f5fe',
              damage: playerDamage,
              friendly: true,
              targetKind: 'mob',
              targetId: target.id,
              pierce: pierceExtra,
            });
            p.attackCooldown = attackCooldownDuration;
            playerAttacked = true;
          }
        } else {
          let hitAny = false;
          for (const m of currentMobs) {
            if (m.hp > 0 && dist(m.pos, p.pos) <= playerAttackRange + (m.radius - MOB_RADIUS)) {
              m.hp -= playerDamage;
              // No from-point on a hidden swing: the flash and the flinch
              // still say they were hit, but the shove waits for the kick.
              hurtMob(m, swingHidden ? undefined : p.pos);
              hitAny = true;
              attackTargets.push({ ...m.pos });
              newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...m.pos }, createdAt: now });
              newFloatingTexts.push(makeFloatingText(`-${Math.round(playerDamage)}`, m.pos, DAMAGE_TEXT_COLOR, now));
            }
          }
          if (hitAny) {
            p.attackCooldown = attackCooldownDuration;
            playerAttacked = true;
          }
        }
      }

      // Ally AI
      for (const a of currentAllies) {
        if (a.hp <= 0) continue;
        // Summon Regen passive: heal each summon, capped at its max.
        if (allyRegenPerSec > 0 && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + allyRegenPerSec * dt);
        a.attackCooldown = Math.max(0, a.attackCooldown - dt);
        const engageRange = a.ranged ? ALLY_RANGED_ENGAGE_RANGE : ALLY_ENGAGE_RANGE;
        const atkRange = a.ranged ? ALLY_RANGED_ATTACK_RANGE : ALLY_ATTACK_RANGE;
        const mobTargets: Target[] = currentMobs
          .filter((m) => m.hp > 0)
          .map((m) => ({ kind: 'mob' as const, id: m.id, pos: m.pos }));
        const nearest = nearestTarget(a.pos, mobTargets, engageRange);
        if (nearest) {
          const d = dist(a.pos, nearest.pos);
          if (d <= atkRange) {
            if (a.attackCooldown <= 0) {
              const mob = currentMobs.find((m) => m.id === nearest.id);
              if (mob) {
                if (a.ranged) {
                  newProjectiles.push({
                    id: ++projectileIdCounter,
                    from: { ...a.pos },
                    to: { ...mob.pos },
                    createdAt: now,
                    duration: Math.max(80, (dist(a.pos, mob.pos) / PROJECTILE_SPEED) * 1000),
                    color: '#d1c4e9',
                    damage: a.damage,
                    friendly: true,
                    targetKind: 'mob',
                    targetId: mob.id,
                  });
                } else {
                  mob.hp -= a.damage;
                  hurtMob(mob, a.pos);
                  newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...mob.pos }, createdAt: now });
                  newFloatingTexts.push(makeFloatingText(`-${a.damage}`, mob.pos, DAMAGE_TEXT_COLOR, now));
                }
              }
              a.attackCooldown = ALLY_ATTACK_COOLDOWN;
            }
          } else {
            const dx = nearest.pos.x - a.pos.x;
            const dy = nearest.pos.y - a.pos.y;
            const step = ALLY_SPEED * dt;
            const ratio = Math.min(1, step / d);
            a.pos = { x: a.pos.x + dx * ratio, y: a.pos.y + dy * ratio };
          }
        }
      }

      // Burning enemies (marked by the Burn skill) blow up when they die,
      // spreading a share of their max HP to nearby foes -- which can set off
      // further burning deaths in a chain.
      {
        const pending = currentMobs.filter((m) => m.hp <= 0 && (m.burnPct ?? 0) > 0);
        const exploded = new Set<number>();
        while (pending.length > 0) {
          const src = pending.shift()!;
          if (exploded.has(src.id)) continue;
          exploded.add(src.id);
          const blast = src.maxHp * (src.burnPct ?? 0);
          newFloatingTexts.push(makeFloatingText('boom!', src.pos, '#ff7043', now));
          for (const m of currentMobs) {
            if (m.id === src.id || m.hp <= 0) continue;
            if (dist(m.pos, src.pos) <= BURN_EXPLODE_RADIUS) {
              m.hp -= blast;
              newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...m.pos }, createdAt: now });
              newFloatingTexts.push(makeFloatingText(`-${Math.round(blast)}`, m.pos, DAMAGE_TEXT_COLOR, now));
              if (m.hp <= 0 && (m.burnPct ?? 0) > 0 && !exploded.has(m.id)) pending.push(m);
            }
          }
        }
      }

      const survivorMobs: Mob[] = [];
      let anyMobDied = false;
      let lastDeathPos: Vec | null = null;
      for (const m of currentMobs) {
        if (m.hp > 0) {
          survivorMobs.push(m);
        } else {
          anyMobDied = true;
          lastDeathPos = { ...m.pos };
          // The fall, one of two takes at random so a mown-down crowd does
          // not drop in unison. Only the melee mob has art; the circles
          // still just vanish.
          if (m.type === 'melee') {
            newCorpses.push({
              id: ++corpseIdCounter,
              pos: { ...m.pos },
              facing: m.facing,
              anim: Math.random() < 0.5 ? 'die' : 'die2',
              age: 0,
            });
          }
          newBlood.push({
            id: ++bloodIdCounter,
            pos: { ...m.pos },
            variant: Math.floor(Math.random() * BLOOD_VARIANTS),
            createdAt: now,
          });
          const reward = m.type === 'boss' ? BOSS_XP_REWARD : MOB_XP_REWARD;
          xpGain += reward;
          newFloatingTexts.push(makeFloatingText(`+${reward} XP`, m.pos, XP_TEXT_COLOR, now));
          // One call per coin is the whole integration; the sack keeps its own
          // count and drops them in itself.
          const coins =
            m.type === 'boss' ? BOSS_COINS : Math.random() < MOB_COIN_CHANCE ? 1 : 0;
          for (let i = 0; i < coins; i++) coinSackRef.current?.addCoin();
        }
      }
      const survivorAllies = currentAllies.filter((a) => a.hp > 0);

      if (damageToPlayer > 0) p.hp = Math.max(0, p.hp - damageToPlayer);

      // The fall (ours, for the Die animation). The frame hp reaches zero
      // starts the timer; the field keeps simulating while he goes down, and
      // the game over waits at the bottom of the loop until the animation has
      // played and held a beat. Hp stays the authority on death: should
      // anything lift him back over zero mid-fall (the wave-clear heal can),
      // the fall is called off and the run continues -- the same outcome the
      // old instant game over would have picked.
      if (dieTimerRef.current == null) {
        if (p.hp <= 0) {
          dieTimerRef.current = animDuration(ANIMS.die) + DIE_HOLD;
          p.target = null;
          pendingCastAnimRef.current = null;
          // A swing sound still pending belongs to a blow the fall swallowed.
          swingSoundTimerRef.current = 0;
          swingSoundGorePosRef.current = null;
          // The blow that felled him is still heard. The dying branch outranks
          // the flinch that used to carry this sound, so it plays here instead
          // -- once per run, gap or no gap.
          const pool = hurtSoundsRef.current;
          playSfx(pool[Math.floor(Math.random() * pool.length)]);
        }
      } else if (p.hp > 0) {
        // Revived mid-fall: back on his feet at once, no corpse acting.
        dieTimerRef.current = null;
        p.anim = 'idle';
        p.animTime = 0;
        p.animSpeed = 1;
      } else {
        dieTimerRef.current -= dt;
      }



      // Turn to face what he is hitting, but only from a standstill. While
      // moving, the movement block owns facing -- otherwise he slides one way
      // while looking another, which the 8 fixed directions make very obvious.
      // Nothing is lost by that: tapping towards an enemy already points him at
      // it. This is for the enemy that walks up behind him while he stands.
      if (playerAttacked && !moving) {
        p.facing = facingForTargets(p.pos, attackTargets, p.facing);
      }

      // Pick the animation now that this frame's attacks and damage are known.
      // A one-shot owns the sprite until it finishes, so a swing plays out
      // instead of being cut off the moment the knight starts moving again.
      // Getting hit is the exception -- it interrupts anything, including
      // itself, so repeated blows keep flinching rather than freezing.
      // The entrance, one step at a time. Running in is just the ordinary
      // movement code, so all this has to do is notice he has arrived, hold him
      // still a moment, and then start the draw.
      let startDraw = false;
      if (p.introPhase === 'enter') {
        if (!p.target) {
          p.introPhase = 'settle';
          p.introTimer = INTRO_SETTLE;
        }
      } else if (p.introPhase === 'settle') {
        p.introTimer -= dt;
        if (p.introTimer <= 0) {
          p.introPhase = 'draw';
          startDraw = true;
        }
      } else if (p.introPhase === 'draw' && p.anim !== 'spawn') {
        p.introPhase = 'done';
      }

      const current = ANIMS[p.anim];
      const oneShotBusy =
        !current.loop &&
        p.animTime * p.animSpeed < animDuration(current) &&
        !(current.interruptedByMoving && moving);

      // A flinch no longer barges in on a swing already under way, and cannot
      // follow another too closely. It used to win outright, which left the
      // knight twitching continuously and almost never landing a visible blow.
      hurtAnimGapRef.current = Math.max(0, hurtAnimGapRef.current - dt);
      const midSwing = p.anim === 'attack' && oneShotBusy;
      const mayFlinch = damageToPlayer > 0 && !midSwing && hurtAnimGapRef.current <= 0;

      // Standing between arriving and drawing: hold the walk's last frame rather
      // than falling into idle, which is a pose with the sword already in hand.
      if (p.introPhase === 'settle') {
        p.anim = 'walk';
        p.animSpeed = 1;
        p.animTime = INTRO_HOLD_FRAME / ANIMS.walk.fps;
      }

      // A cast made on the run keeps its effect but skips its pose -- a
      // runner should not be yanked into a stance he did not stop for.
      if (pendingCastAnimRef.current && moving) pendingCastAnimRef.current = null;

      let nextAnim: AnimName = p.anim;
      let restartAnim = false;
      if (dieTimerRef.current != null) {
        // Dying outranks everything -- including the flinch that would
        // otherwise answer the killing blow.
        nextAnim = 'die';
        restartAnim = p.anim !== 'die';
      } else if (p.introPhase === 'settle') {
        // nothing else gets a say while he waits
      } else if (startDraw) {
        // The one moment the entrance overrides everything. Nothing else is
        // happening on the field yet, so there is nothing for it to trample.
        nextAnim = 'spawn';
        restartAnim = true;
        // Heard as the animation begins, the same rule the rest follow.
        playSfx(drawSoundRef.current);
      } else if (mayFlinch) {
        nextAnim = 'hurt';
        restartAnim = true;
        hurtAnimGapRef.current = HURT_ANIM_MIN_GAP;
        // Heard exactly when the flinch is drawn, the same rule the sword
        // follows. No delay: a flinch is the reaction to the blow, so it starts
        // on the hit rather than building up to it like a swing does.
        const pool = hurtSoundsRef.current;
        playSfx(pool[Math.floor(Math.random() * pool.length)]);
      } else if (pendingCastAnimRef.current && !oneShotBusy) {
        // The pose behind a skill press, a frame after its effect: it waits
        // out a busy one-shot (a swing hands over within a tenth of a
        // second), and the clear above has already dropped it if he is on
        // the move by the time it could start.
        nextAnim = pendingCastAnimRef.current;
        pendingCastAnimRef.current = null;
        restartAnim = true;
      } else if (
        // The kick, straight off the back of a flinch -- Nicolai's sequence:
        // hit between swings, he staggers, then boots the crowd off him. Only
        // if someone is actually within reach (a kick into empty air looks
        // daft), and never over the player's own movement -- wanting out
        // outranks the flourish. The coin flip runs once, in the one frame
        // the flinch has just ended; lose it and he simply recovers, and
        // nobody is shoved. The mob scan sits last, after the flip, so the
        // cheap dice spare the walk through the crowd.
        !oneShotBusy &&
        p.anim === 'hurt' &&
        !moving &&
        Math.random() < KICK_CHANCE &&
        currentMobs.some((m) => {
          if (m.hp <= 0) return false;
          const dx = m.pos.x - p.pos.x;
          const dy = m.pos.y - p.pos.y;
          const len = Math.hypot(dx, dy);
          if (len > KICK_RANGE + (m.radius - MOB_RADIUS)) return false;
          if (len <= 0.001) return true; // standing on his feet: kickable
          const dir = facingVector(p.facing);
          return (dx / len) * dir.x + (dy / len) * dir.y >= KICK_ARC_COS;
        })
      ) {
        nextAnim = 'kick';
        restartAnim = true;
        // The shove rides the leg, not the wind-up: it fires when frame 6 is
        // reached, and the timer starts with the animation.
        kickShoveTimerRef.current = KICK_CONTACT_FRAME / ANIMS.kick.fps;
        // The boot is heard where it lands, not where it starts: the clip is
        // begun early by its own measured wind-up so full level falls on the
        // contact frame, the same aim the swings take.
        const boots = kickSoundsRef.current;
        const boot = Math.floor(Math.random() * boots.length);
        kickSoundPlayerRef.current = boots[boot];
        kickSoundTimerRef.current = Math.max(
          0,
          KICK_CONTACT_FRAME / ANIMS.kick.fps - KICK_LEADS[boot]
        );
      } else if (!oneShotBusy) {
        const travelling = p.introPhase === 'enter' ? 'walk' : 'run';
        nextAnim = playerAttacked ? 'attack' : moving ? travelling : 'idle';
        // Any freshly triggered one-shot restarts, including a second swing
        // straight after the first -- without this it would stay parked on the
        // last frame, since the name alone has not changed.
        restartAnim = nextAnim !== p.anim || !ANIMS[nextAnim].loop;
      }
      if (restartAnim) {
        p.animTime = 0;
        // Two animations run at anything but the rate their sheet was drawn
        // for: the swing, rushed to keep up with attack speed, and the entrance
        // walk, slowed to stay in step with the ground he covers.
        p.animSpeed =
          nextAnim === 'attack'
            ? attackAnimSpeed
            : p.introPhase === 'enter' && nextAnim === 'walk'
              ? INTRO_WALK_ANIM
              : 1;

        // The sword is heard only when it is seen. A blow still lands whenever
        // the cooldown is ready, but if the knight is flinching instead of
        // swinging there is no swing to hear -- getting hit outranks attacking
        // in the state machine above, so in a crowd that happens often.
        if (nextAnim === 'attack') {
          // Which clip is decided first, because how early it has to start
          // depends on which one it is. It is also decided now, while it is
          // still known whether this blow killed anything: a killing blow
          // sometimes earns a heavier one, which replaces the swing rather than
          // layering over it -- both at once just muddies, and those clips open
          // on a strike of their own.
          //
          // The heavy clips are one pool of six, half of them gore takes.
          // Landing on a gore one is what calls for the extra blood, so the
          // position is remembered here and used when the sound actually fires.
          swingSoundGorePosRef.current = null;
          let lead: number;
          if (anyMobDied && Math.random() < KILL_SFX_CHANCE) {
            const combo = killSoundsRef.current;
            const gore = goreSoundsRef.current;
            const pick = Math.floor(Math.random() * (combo.length + gore.length));
            const isGore = pick >= combo.length;
            const i = isGore ? pick - combo.length : pick;
            swingSoundPlayerRef.current = isGore ? gore[i] : combo[i];
            lead = isGore ? GORE_LEADS[i] : KILL_LEADS[i];
            if (isGore) swingSoundGorePosRef.current = lastDeathPos;
          } else {
            const swings = attackSoundsRef.current;
            const i = Math.floor(Math.random() * swings.length);
            swingSoundPlayerRef.current = swings[i];
            lead = ATTACK_LEADS[i];
          }

          // Started early enough that its loudest moment falls on the strike,
          // rather than its first sample doing. The animation's speed scales
          // when the blade arrives; the clip's own wind-up does not, since audio
          // plays at the rate it was recorded whatever the sprite is doing.
          swingSoundTimerRef.current = Math.max(0, SWING_STRIKE_AT / attackAnimSpeed - lead);
        } else {
          // Interrupted before the strike, so it never happened as far as the
          // eye is concerned. Drop the pending sound and the blood with it.
          swingSoundTimerRef.current = 0;
          swingSoundGorePosRef.current = null;
        }
      }
      p.anim = nextAnim;

      // Boots. Read off where the animation has got to rather than kept on a
      // timer of its own, so a step is heard on the frame his foot lands at any
      // pace -- the same reason the walk's rate is tied to his stride and not
      // set by hand. Nothing to reset between runs, and nothing to drift.
      if (moving && (p.anim === 'walk' || p.anim === 'run')) {
        const cycles = (p.animTime * p.animSpeed * ANIMS[p.anim].fps) / SPRITE_COLS;
        const step = Math.floor((cycles - FOOTSTEP_PHASE) * STEPS_PER_CYCLE);
        // The first frame of moving sounds too. It used to be swallowed -- the
        // cycle starts at nothing and the first crossing is 40% of the way in,
        // which at a run is 375 ms of silence after the tap that ordered it.
        // A foot goes down when you set off, so it is heard when you set off.
        if (footstepStepRef.current === null || step !== footstepStepRef.current) {
          footstepStepRef.current = step;

          // The ground he lands on. Wet or dry is decided per step rather than
          // per crossing, so he can clip the edge of a puddle on his way past
          // and only that foot splashes.
          const ground = feetInWater(p.pos) ? puddleSoundsRef.current : footstepSoundsRef.current;
          let pick = Math.floor(Math.random() * ground.length);
          if (pick === lastFootstepRef.current) pick = (pick + 1) % ground.length;
          lastFootstepRef.current = pick;
          playSfx(ground[pick]);

          // And his armour over the top of it, drawn separately so the two do
          // not repeat together. A knight in plate does not walk quietly.
          const armour = armourSoundsRef.current;
          let rattle = Math.floor(Math.random() * armour.length);
          if (rattle === lastArmourRef.current) rattle = (rattle + 1) % armour.length;
          lastArmourRef.current = rattle;
          playSfx(armour[rattle]);
        }
      } else {
        footstepStepRef.current = null;
      }

      if (swingSoundTimerRef.current > 0) {
        swingSoundTimerRef.current -= dt;
        if (swingSoundTimerRef.current <= 0) {
          playSfx(swingSoundPlayerRef.current);

          // Bound to the sound rather than to the kill: a gore clip never plays
          // without the mess, and the mess never appears without it.
          const gorePos = swingSoundGorePosRef.current;
          if (gorePos) {
            for (let i = 0; i < GORE_EXTRA_SPLATS; i++) {
              newBlood.push({
                id: ++bloodIdCounter,
                pos: {
                  x: gorePos.x + (Math.random() - 0.5) * GORE_SPLATTER_SPREAD * 2,
                  y: gorePos.y + (Math.random() - 0.5) * GORE_SPLATTER_SPREAD,
                },
                variant: Math.floor(Math.random() * BLOOD_VARIANTS),
                createdAt: now,
              });
            }
            swingSoundGorePosRef.current = null;
          }
        }
      }

      // The boot's sound, on its own clock because it starts earlier than the
      // shove by the clip's wind-up. Same rule as the shove below: if movement
      // cut the kick short, a kick that never landed is not heard either.
      if (kickSoundTimerRef.current > 0) {
        kickSoundTimerRef.current -= dt;
        if (kickSoundTimerRef.current <= 0 && p.anim === 'kick') {
          playSfx(kickSoundPlayerRef.current);
        }
      }

      // The kick lands. Everyone still inside the fan is shoved with the same
      // knockback a visible blow deals -- no damage, no flash, just the space
      // a kick is for. Guarded on the animation still being the kick: if
      // movement cut it short before the leg came out, nobody is shoved by a
      // kick that never happened.
      if (kickShoveTimerRef.current > 0) {
        kickShoveTimerRef.current -= dt;
        if (kickShoveTimerRef.current <= 0 && p.anim === 'kick') {
          const dir = facingVector(p.facing);
          for (const m of currentMobs) {
            if (m.hp <= 0) continue;
            const dx = m.pos.x - p.pos.x;
            const dy = m.pos.y - p.pos.y;
            const len = Math.hypot(dx, dy);
            if (len > KICK_RANGE + (m.radius - MOB_RADIUS)) continue;
            if (len > 0.001 && (dx / len) * dir.x + (dy / len) * dir.y < KICK_ARC_COS) continue;
            shoveMob(m, p.pos);
          }
        }
      }

      if (xpGain > 0) {
        p.xp += xpGain;
        while (p.xp >= p.xpToNext) {
          p.xp -= p.xpToNext;
          p.level += 1;
          p.xpToNext = xpForLevel(p.level);
          // Scale current HP up with the new max instead of fully healing.
          const oldMaxHp = p.maxHp;
          p.maxHp += 10;
          p.hp = p.hp * (p.maxHp / oldMaxHp);
        }
      }

      // Wave spawning from queue
      let newWaveActive = waveActiveRef.current;
      if (waveActiveRef.current && waveQueueRef.current.length > 0) {
        spawnTimerRef.current += dt;
        if (spawnTimerRef.current >= WAVE_SPAWN_INTERVAL) {
          spawnTimerRef.current = 0;
          const type = waveQueueRef.current.shift()!;
          survivorMobs.push(spawnMob(type, waveRef.current));
        }
        if (waveQueueRef.current.length === 0) newWaveActive = false;
      }

      // Each owed wave clears on its own: once a wave is done spawning and none
      // of its own mobs are left alive, it drops its item and counts toward the
      // gold. Rushing several waves together no longer merges their payouts.
      let waveJustCleared = false;
      if (lootOwedRef.current.length > 0) {
        const stillOwed: number[] = [];
        for (const w of lootOwedRef.current) {
          const doneSpawning = w !== waveRef.current || waveQueueRef.current.length === 0;
          const anyAlive = survivorMobs.some((m) => m.wave === w);
          if (doneSpawning && !anyAlive) {
            remainingItems.push(spawnLoot(w));
            waveJustCleared = true;
            highestWaveClearedRef.current = Math.max(highestWaveClearedRef.current, w);
          } else {
            stillOwed.push(w);
          }
        }
        lootOwedRef.current = stillOwed;
        if (waveJustCleared) {
          // Fully restore health and mana each time a wave is fully cleared.
          p.hp = p.maxHp + hpBonus;
          p.mana = effectiveMaxMana;
        }
      }

      const newAbilities: Abilities = {
        1: { ...abilitiesRef.current[1], cooldown: Math.max(0, abilitiesRef.current[1].cooldown - dt) },
        2: { ...abilitiesRef.current[2], cooldown: Math.max(0, abilitiesRef.current[2].cooldown - dt) },
        3: { ...abilitiesRef.current[3], cooldown: Math.max(0, abilitiesRef.current[3].cooldown - dt) },
      };

      const survivorProjectiles = stillFlying.concat(newProjectiles);
      const survivorFlashes = hitFlashesRef.current
        .filter((f) => now - f.createdAt < HIT_FLASH_DURATION)
        .concat(newFlashes);
      const survivorBlood = bloodSplatsRef.current
        .filter((b) => now - b.createdAt < BLOOD_DURATION * 1000)
        .concat(newBlood);
      // Corpses age on the simulation clock, not the wall clock, so a pause
      // freezes them mid-fall along with everything else.
      const survivorCorpses = corpsesRef.current
        .map((c) => ({ ...c, age: c.age + dt }))
        .filter((c) => c.age < animDuration(MOB_DIE_ANIMS[c.anim]) + CORPSE_LINGER + CORPSE_FADE)
        .concat(newCorpses);
      // The zones animate themselves in CSS; the loop only sweeps up the
      // entries whose time is spent.
      const survivorConeZones = coneZonesRef.current.filter((z) => now - z.createdAt < CONE_ZONE.ms);
      const survivorFloatingTexts = floatingTextsRef.current
        .filter((f) => now - f.createdAt < FLOATING_TEXT_DURATION)
        .concat(newFloatingTexts);

      // Ours: the game over waits for the fall. Hp is still the authority on
      // whether he is dead -- the timer only buys the Die animation its stage
      // time before the screen takes over.
      const isGameOver = p.hp <= 0 && dieTimerRef.current != null && dieTimerRef.current <= 0;

      if (isGameOver) {
        // The run has ended: bank its gold (1 per wave cleared, so 1+2+...+N)
        // into the account. Test runs pay nothing.
        if (!isTestRunRef.current && !goldBankedRef.current) {
          goldBankedRef.current = true;
          const earned = goldForWavesCleared(highestWaveClearedRef.current);
          if (earned > 0) {
            const m = metaRef.current;
            commitMeta({ ...m, gold: m.gold + earned });
            setLastRunGold(earned);
          }
        }
        // Delete this run's save on death.
        if (!isTestRunRef.current && currentRunIdRef.current) {
          const idToDelete = currentRunIdRef.current;
          setSavedRuns((prev) => {
            const next = prev.filter((r) => r.id !== idToDelete);
            persistRuns(next);
            return next;
          });
        }
      } else if (waveJustCleared && !isTestRunRef.current && currentRunIdRef.current) {
        // Autosave after each wave clear.
        const id = currentRunIdRef.current;
        const save: RunSave = {
          id,
          savedAt: Date.now(),
          wave: waveRef.current,
          level: p.level,
          xp: p.xp,
          xpToNext: p.xpToNext,
          hp: p.hp,
          maxHp: p.maxHp,
          mana: p.mana,
          abilities: newAbilities,
          passive: passiveRef.current,
          equipped: newEquipped ?? equippedRef.current,
          bag: newBag ?? bagRef.current,
          materials: materialsRef.current,
        };
        setSavedRuns((prev) => {
          const next = prev.filter((r) => r.id !== id);
          next.push(save);
          persistRuns(next);
          return next;
        });
      }

      playerRef.current = p;
      mobsRef.current = survivorMobs;
      alliesRef.current = survivorAllies;
      abilitiesRef.current = newAbilities;
      projectilesRef.current = survivorProjectiles;
      hitFlashesRef.current = survivorFlashes;
      bloodSplatsRef.current = survivorBlood;
      corpsesRef.current = survivorCorpses;
      coneZonesRef.current = survivorConeZones;
      floatingTextsRef.current = survivorFloatingTexts;
      waveActiveRef.current = newWaveActive;
      gameOverRef.current = isGameOver;
      groundItemsRef.current = remainingItems;
      if (newEquipped) {
        equippedRef.current = newEquipped;
        bagRef.current = newBag!;
      }
      setPlayer(p);
      setMobs(survivorMobs);
      setAllies(survivorAllies);
      setAbilities(newAbilities);
      setProjectiles(survivorProjectiles);
      setHitFlashes(survivorFlashes);
      setBloodSplats(survivorBlood);
      setCorpses(survivorCorpses);
      setConeZones(survivorConeZones);
      setFloatingTexts(survivorFloatingTexts);
      setWaveActive(newWaveActive);
      if (isGameOver) setGameOver(true);
      setGroundItems(remainingItems);
      if (newEquipped) {
        setEquipped(newEquipped);
        setBag(newBag!);
      }
      setTick((t) => t + 1);

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Look up an equipped skill's level for the HUD read-outs below.
  const equippedSkillLevel = (skill: SkillId): number => {
    for (const k of [1, 2, 3] as AbilityId[]) if (abilities[k].skill === skill) return abilities[k].level;
    return 0;
  };
  const ability3Level = equippedSkillLevel('ranged');
  const isRangedDisplay = ability3Level > 0 || passive?.skill === 'pierce';
  const playerAttackRange = isRangedDisplay ? RANGED_ATTACK_RANGE : PLAYER_ATTACK_RANGE;
  const dmgBonusDisplay = equippedBonus(equipped, 'dmg');
  const atkSpdBonusPctDisplay = equippedBonus(equipped, 'atkspd');
  const manaBonusDisplay = equippedBonus(equipped, 'mana');
  const hpBonusDisplay = equippedBonus(equipped, 'health');
  const effectiveMaxHp = player.maxHp + hpBonusDisplay;
  const effectiveMaxMana = MANA_MAX + manaBonusDisplay;
  const displayDamage = PLAYER_BASE_DAMAGE + ability3DamageBonus(ability3Level) + dmgBonusDisplay;
  const displayAttackCooldown = (PLAYER_ATTACK_COOLDOWN * (player.hasteTimer > 0 ? 0.5 : 1)) / (1 + atkSpdBonusPctDisplay);
  const displayAtkSpeed = 1 / displayAttackCooldown;


  function tooltipPositionStyle(x: number, y: number) {
    const width = 240;
    const left = Math.max(10, Math.min(SCREEN_W - width - 10, x - width / 2));
    const bottom = Math.max(10, SCREEN_H - y + 14);
    return { left, width, bottom };
  }

  function renderCone(angleDeg: number) {
    const halfRad = (ABILITY2_HALF_ANGLE_DEG * Math.PI) / 180;
    const baseWidth = 2 * CONE_RANGE * Math.tan(halfRad);
    const rotation = angleDeg - 90;
    return (
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: player.pos.x - baseWidth / 2,
          top: player.pos.y - CONE_RANGE,
          width: baseWidth,
          height: CONE_RANGE * 2,
          transform: [{ rotate: `${rotation}deg` }],
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: CONE_RANGE,
            left: 0,
            width: 0,
            height: 0,
            borderLeftWidth: baseWidth / 2,
            borderRightWidth: baseWidth / 2,
            borderBottomWidth: CONE_RANGE,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: 'rgba(255,138,80,0.28)',
          }}
        />
      </View>
    );
  }

  const shownWave = waveActive ? wave : wave + 1;
  const bagCount = bag.filter((s) => s != null).length;

  function renderInvSlot(key: string, item: Item | null, sizeStyle: any) {
    const def = item ? ITEM_DEFS[item.kind] : null;
    return (
      <View
        key={key}
        {...registerSlot(key)}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => handleSlotGrant(key, e)}
        onResponderMove={handleSlotMove}
        onResponderRelease={(e) => handleSlotRelease(key, e)}
        style={[sizeStyle, styles.invSlotEmpty, def && { backgroundColor: def.color, borderColor: 'transparent' }]}
      >
        {item && def && (
          <>
            <Text style={styles.invSlotName}>{def.name}</Text>
            <Text style={styles.invSlotLevel}>{item.level}</Text>
          </>
        )}
      </View>
    );
  }

  if (screen === 'menu') {
    const hasSaves = runsLoaded && savedRuns.length > 0;
    return (
      <View style={styles.root}>
        {/* The art carries the title, so nothing is drawn over it. Cover rather
            than stretch, which crops the sides on a screen narrower than the
            picture instead of squashing the knight. */}
        <Image source={MENU_BG} style={styles.menuBg} resizeMode="cover" />

        {/* On web the canvas draws the plaque itself, and tears it. Anywhere
            else it is a plain image, since there is no canvas to tear it on. */}
        {Platform.OS === 'web' ? (
          <MenuTearButton
            tearRef={tearRef}
            screenW={SCREEN_W}
            screenH={SCREEN_H}
            button={MENU_BUTTON_RECT}
            logo={MENU_LOGO_RECT}
          />
        ) : (
          <Image
            source={MENU_BUTTON}
            style={{
              position: 'absolute',
              left: MENU_BUTTON_RECT.x,
              top: MENU_BUTTON_RECT.y,
              width: MENU_BUTTON_RECT.w,
              height: MENU_BUTTON_RECT.h,
            }}
            resizeMode="contain"
          />
        )}

        <Pressable
          onPress={() => leaveMenu(handleStartNewRun)}
          style={{
            position: 'absolute',
            left: MENU_BUTTON_RECT.x,
            top: MENU_BUTTON_RECT.y,
            width: MENU_BUTTON_RECT.w,
            height: MENU_BUTTON_RECT.h,
          }}
        />

        {/* Temporary, and deliberately out of the way: the design has one
            button and these two have nowhere to go yet. */}
        <View style={styles.menuMinorRow}>
          <Pressable
            onPress={() => {
              if (!hasSaves) return;
              playMenuPress();
              setScreen('continue');
            }}
          >
            <Text style={[styles.menuMinorText, !hasSaves && styles.menuMinorDisabled]}>
              Continue{hasSaves ? ` (${savedRuns.length})` : ''}
            </Text>
          </Pressable>
          <Text style={styles.menuMinorText}>·</Text>
          <Pressable
            onPress={() => {
              playMenuPress();
              setScreen('skilltree');
            }}
          >
            <Text style={styles.menuMinorText}>Skills ({meta.gold}g)</Text>
          </Pressable>
          <Text style={styles.menuMinorText}>·</Text>
          <Pressable onPress={() => leaveMenu(handleStartTestRun)}>
            <Text style={styles.menuMinorText}>Test run</Text>
          </Pressable>
        </View>

        {leaveVeil}

        {/* The story, over the top of a menu that is already built and waiting.
            Once per load: coming back from a run lands on the menu itself. */}
        {!introDone && <IntroSequence onDone={() => setIntroDone(true)} />}

        {/* Here too, and above the story, since the intro's fog is the heaviest
            thing on the screen at any point. Delete with DEBUG_PERF. */}
        {DEBUG_PERF && <PerfOverlay />}

        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === 'continue') {
    const sorted = savedRuns.slice().sort((a, b) => b.savedAt - a.savedAt);
    return (
      <View style={styles.root}>
        <View style={styles.menuScreen}>
          <Text style={styles.menuScreenTitle}>Continue Run</Text>
          {sorted.length === 0 && <Text style={styles.menuEmptyText}>No saved runs.</Text>}
          {sorted.map((run) => (
            <Pressable key={run.id} onPress={() => handleContinueRun(run)} style={styles.runRow}>
              <Text style={styles.runRowTitle}>
                Wave {run.wave} · Lv {run.level}
              </Text>
              <Text style={styles.runRowSub}>{new Date(run.savedAt).toLocaleString()}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setScreen('menu')} style={styles.menuBackButton}>
            <Text style={styles.menuBackButtonText}>Back</Text>
          </Pressable>
        </View>
        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === 'skilltree') {
    return (
      <View style={styles.root}>
        <ScrollView style={styles.skillTreeScroll} contentContainerStyle={styles.skillTreeContent}>
          <Text style={styles.menuScreenTitle}>Skills · {meta.gold} gold</Text>

          {/* The equipped loadout, shown the same way it appears in a run. */}
          <View style={styles.loadoutPreview}>
            {meta.loadout.map((skill) => (
              <View key={skill} style={styles.loadoutSlot}>
                <View style={[styles.quickCastButton, { backgroundColor: SKILL_META[skill].color }]}>
                  <Text style={styles.quickCastIcon}>{SKILL_META[skill].icon}</Text>
                </View>
                <Text style={styles.abilityCostText}>{SKILL_META[skill].label}</Text>
              </View>
            ))}
            {meta.passive && (
              <View style={styles.loadoutSlot}>
                <View style={[styles.passiveChip, { backgroundColor: SKILL_META[meta.passive].color }]}>
                  <Text style={styles.passiveChipIcon}>{SKILL_META[meta.passive].icon}</Text>
                </View>
                <Text style={styles.abilityCostText}>{SKILL_META[meta.passive].label}</Text>
              </View>
            )}
          </View>
          <Text style={styles.skillTreeHint}>
            Active {meta.loadout.length}/{MAX_EQUIPPED} · Passive {meta.passive ? SKILL_META[meta.passive].label : '—'}/{MAX_PASSIVE}
          </Text>

          {ROOT_SKILLS.map((root) => {
            const rows = [root, ...ALL_SKILLS.filter((s) => SKILL_PARENT[s] === root)];
            return (
              <View key={root} style={styles.skillTreeGroup}>
                {rows.map((skill) => {
                  const level = meta.skillLevels[skill] ?? 0;
                  const owned = level > 0;
                  const parent = SKILL_PARENT[skill];
                  const isChild = parent != null;
                  const unlocked = !parent || (meta.skillLevels[parent] ?? 0) >= 1;
                  const atMax = level >= ABILITY_MAX_LEVEL;
                  const nextCost = skillLevelCost(level + 1);
                  const canBuy = unlocked && !atMax && meta.gold >= nextCost;
                  const passiveKind = isPassiveSkill(skill);
                  const equipped = passiveKind ? meta.passive === skill : meta.loadout.includes(skill);
                  const equipFull = !passiveKind && !equipped && meta.loadout.length >= MAX_EQUIPPED;
                  const meta2 = SKILL_META[skill];
                  return (
                    <View key={skill} style={[styles.skillRow, isChild && styles.skillRowChild]}>
                      <View style={[styles.skillSwatch, { backgroundColor: meta2.color }, !unlocked && styles.abilityLocked]}>
                        <Text style={styles.skillSwatchIcon}>{meta2.icon}</Text>
                      </View>
                      <View style={styles.skillRowInfo}>
                        <Text style={styles.skillRowName}>
                          {isChild ? '↳ ' : ''}{meta2.label} · {owned ? `Lv ${level}/${ABILITY_MAX_LEVEL}` : unlocked ? 'not owned' : `needs ${SKILL_META[parent!].label}`}
                        </Text>
                        <Text style={styles.skillRowDesc}>{skillDescription(skill)}</Text>
                      </View>
                      <View style={styles.skillRowButtons}>
                        <Pressable
                          onPress={() => buySkillLevel(skill)}
                          disabled={!canBuy}
                          style={[styles.skillBuyButton, !canBuy && styles.skillButtonDisabled]}
                        >
                          <Text style={styles.skillBuyText}>{atMax ? 'MAX' : `${owned ? 'Level' : 'Buy'} ${nextCost}g`}</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => toggleEquip(skill)}
                          disabled={!owned || equipFull}
                          style={[
                            styles.skillEquipButton,
                            equipped && styles.skillEquipButtonOn,
                            (!owned || equipFull) && styles.skillButtonDisabled,
                          ]}
                        >
                          <Text style={styles.skillEquipText}>
                            {equipped ? 'Equipped' : passiveKind ? 'Passive' : 'Equip'}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })}

          <Pressable onPress={() => setScreen('menu')} style={styles.menuBackButton}>
            <Text style={styles.menuBackButtonText}>Back</Text>
          </Pressable>
        </ScrollView>
        <StatusBar style="auto" />
      </View>
    );
  }

  // Swap this for another GlowStyle to change his light -- while a buff runs,
  // say. Everything below reads from it.
  const glow = PLAYER_GLOW;

  // And his moon edge, from the panel while it is up and from the constant
  // after. Strength at zero simply draws nothing, so the sliders can take it
  // away as well as set it.
  const rim: RimStyle = DEBUG_RIM_TUNING
    ? { color: [tuneRimR, tuneRimG, tuneRimB], strength: tuneRimStrength / 100, blend: tuneRimBlend }
    : RIM_STYLE;

  // Breathes on the wall clock rather than the animation, so it keeps its own
  // slow rhythm whatever the knight happens to be doing.
  const glowSize =
    glow.size * (1 + Math.sin(((Date.now() % glow.period) / glow.period) * Math.PI * 2) * glow.pulse);

  // Everyone standing on the ground is drawn as one list sorted by how far down
  // the screen they are, so whoever is nearer the camera covers whoever is
  // behind them. Drawn separately -- as they were -- a zombie standing behind
  // the knight still painted over him, which 128 px sprites made obvious.
  //
  // Sorting on the feet rather than the centre, since that is where a character
  // actually meets the ground.
  const groundActors = [
    ...allies.map((a) => ({
      key: `ally-${a.id}`,
      y: a.pos.y,
      node: (
        <View key={`ally-${a.id}`}>
          <View
            style={[
              styles.ally,
              { left: a.pos.x - ALLY_RADIUS, top: a.pos.y - ALLY_RADIUS, backgroundColor: a.ranged ? '#b39ddb' : '#9575cd' },
            ]}
          />
          <View style={[styles.mobHpBarBg, { left: a.pos.x - ALLY_RADIUS, top: a.pos.y - ALLY_RADIUS - 8, width: ALLY_RADIUS * 2 }]}>
            <View style={[styles.mobHpBarFill, { width: ALLY_RADIUS * 2 * (a.hp / a.maxHp), backgroundColor: '#7e57c2' }]} />
          </View>
        </View>
      ),
    })),
    {
      // Its own entry rather than sitting inside the knight's, so that it ends
      // up a direct child of the play area alongside the ground.
      //
      // Blending only reaches as far as the nearest stacking context, and
      // react-native-web gives every positioned view a z-index, which creates
      // one. Wrapped with the knight, the glow could only blend against him --
      // the mode changed and nothing looked different. Out here it can reach the
      // ground it is supposed to be lighting.
      //
      // Same y as the knight and listed first, so a stable sort keeps it under
      // him while anyone standing in front still covers it.
      key: 'player-glow',
      y: player.pos.y,
      node: (
        // Deaf to touches, or it would swallow taps in the one spot the player
        // aims at most -- right where their own character is. The wrapper
        // carries that, since neither Image nor ImageStyle takes it.
        <View
          key="player-glow"
          style={{
            position: 'absolute',
            left: player.pos.x - glowSize / 2,
            top: player.pos.y + glow.foot - glowSize / 2,
            width: glowSize,
            height: glowSize,
            pointerEvents: 'none',
            // 'screen' and its kin only lighten, which is how light behaves and
            // lets the stone show through it.
            mixBlendMode: glow.blend,
          }}
        >
          <Image
            source={GLOW}
            tintColor={glow.color}
            style={{
              width: glowSize,
              height: glowSize,
              opacity: glow.opacity,
            }}
          />
        </View>
      ),
    },
    {
      key: 'player',
      y: player.pos.y,
      node: (
        // Anchored on the sprite's feet rather than its centre, so the knight
        // stands on pos instead of hovering over it. Every animation shares the
        // same cell size, so he does not jump when it changes.
        <SpriteSheet
          key="player"
          anims={ANIMS}
          anim={player.anim}
          animTime={player.animTime * player.animSpeed}
          facing={player.facing}
          size={PLAYER_SPRITE_SIZE}
          left={player.pos.x - PLAYER_SPRITE_SIZE / 2}
          top={player.pos.y + PLAYER_SPRITE_FOOT_OFFSET - PLAYER_SPRITE_SIZE}
          rim={rim}
        />
      ),
    },
    // Corpses take part in the same painter's sort as the living: a body on
    // the ground is walked in front of by whoever stands below it. Listed
    // before the mobs so a tie in y keeps the dead underneath.
    ...corpses.map((c) => {
      const fadeStart = animDuration(MOB_DIE_ANIMS[c.anim]) + CORPSE_LINGER;
      return {
        key: `corpse-${c.id}`,
        y: c.pos.y,
        node: (
          <View
            key={`corpse-${c.id}`}
            style={{ opacity: c.age <= fadeStart ? 1 : Math.max(0, 1 - (c.age - fadeStart) / CORPSE_FADE) }}
          >
            <SpriteSheet
              anims={MOB_DIE_ANIMS}
              anim={c.anim}
              animTime={c.age}
              facing={c.facing}
              size={MOB_SPRITE_SIZE}
              left={c.pos.x - MOB_SPRITE_SIZE / 2}
              top={c.pos.y + MOB_SPRITE_FOOT_OFFSET - MOB_SPRITE_SIZE}
            />
          </View>
        ),
      };
    }),
    ...mobs.map((m) => ({
      key: `mob-${m.id}`,
      y: m.pos.y,
      node: (
        <View key={`mob-${m.id}`}>
          {/* Only the plain melee mob has art so far. Ranged and boss stay as
              circles, which also keeps them easy to tell apart at a glance. */}
          {m.type === 'melee' ? (
            <SpriteSheet
              anims={MOB_ANIMS}
              anim={m.anim}
              animTime={m.animTime}
              facing={m.facing}
              size={MOB_SPRITE_SIZE}
              left={m.pos.x - MOB_SPRITE_SIZE / 2}
              top={m.pos.y + MOB_SPRITE_FOOT_OFFSET - MOB_SPRITE_SIZE}
              // Fades over its short life rather than switching off, so a hit
              // reads as a pulse rather than a stutter.
              flash={{
                color: MOB_FLASH_COLOR,
                opacity: (m.flashTime / MOB_FLASH_TIME) * MOB_FLASH_STRENGTH,
              }}
            />
          ) : (
            <View
              style={{
                position: 'absolute',
                left: m.pos.x - m.radius,
                top: m.pos.y - m.radius,
                width: m.radius * 2,
                height: m.radius * 2,
                borderRadius: m.radius,
                backgroundColor: MOB_TYPE_META[m.type].color,
              }}
            />
          )}
          <View style={[styles.mobHpBarBg, { left: m.pos.x - m.radius, top: m.pos.y - m.radius - 8, width: m.radius * 2 }]}>
            <View style={[styles.mobHpBarFill, { width: m.radius * 2 * (m.hp / m.maxHp) }]} />
          </View>
        </View>
      ),
    })),
  ]
    .sort((a, b) => a.y - b.y)
    .map((actor) => actor.node);

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        {!gameOver ? (
          <Pressable onPress={handleExitRun} style={styles.exitRunButton}>
            <Text style={styles.exitRunText}>Exit run</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <View style={styles.topBarRight}>
          <Text style={styles.topBarText}>Wave {shownWave}</Text>
          <Pressable onPress={() => setMobStatsOpen(true)} style={styles.topBarButton}>
            <Text style={styles.topBarButtonText}>Mob Stats</Text>
          </Pressable>
          {!waveActive && !gameOver && (
            <Pressable onPress={handleStartNextWave} style={styles.startWaveButton}>
              <Text style={styles.startWaveText}>Start Wave {wave + 1}</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View
        style={styles.playArea}
        onStartShouldSetResponder={() => true}
        onResponderGrant={handlePlayAreaGrant}
        onResponderMove={handlePlayAreaMove}
        onResponderRelease={handlePlayAreaRelease}
      >
        {/* The ground, behind everything else in the play area. */}
        <Image source={BACKGROUND} style={styles.background} resizeMode="cover" />

        <View
          pointerEvents="none"
          style={[
            styles.rangeRing,
            {
              width: playerAttackRange * 2,
              height: playerAttackRange * 2,
              borderRadius: playerAttackRange,
              left: player.pos.x - playerAttackRange,
              top: player.pos.y - playerAttackRange,
            },
          ]}
        />

        {aimingAbility === 2 &&
          aimPreviewPoint &&
          renderCone((Math.atan2(aimPreviewPoint.y - player.pos.y, aimPreviewPoint.x - player.pos.x) * 180) / Math.PI)}

        {/* The cone's zone, on the ground plane under everyone's feet. */}
        {coneZones.map((z) => (
          <ConeZoneFx key={`czone-${z.id}`} cells={z.cells} />
        ))}

        {groundItems.map((it) => {
          const def = ITEM_DEFS[it.item.kind];
          return (
            <View
              key={it.item.id}
              style={[
                styles.groundItem,
                { left: it.pos.x - ITEM_SIZE / 2, top: it.pos.y - ITEM_SIZE / 2, backgroundColor: def.color },
              ]}
            >
              <Text style={styles.groundItemText}>{it.item.level}</Text>
            </View>
          );
        })}

        {/* Blood lands on the ground, so it goes under everyone standing on it. */}
        {bloodSplats.map((b) => (
          <SpriteSheet
            key={b.id}
            anims={BLOOD_ANIMS}
            anim="blood"
            animTime={(Date.now() - b.createdAt) / 1000}
            facing={b.variant}
            size={BLOOD_SIZE}
            left={b.pos.x - BLOOD_SIZE / 2}
            top={b.pos.y - BLOOD_SIZE / 2}
          />
        ))}

        {/* Rings where the rain lands in standing water. Before the characters,
            since they are on the ground and anyone standing there covers them. */}
        {RAIN_ENABLED && !weatherOff && PUDDLE_SPOTS.length > 0 && <RippleLayer />}

        {groundActors}

        {/* In front of everyone, as weather between the scene and the camera.
            Deaf to touches, or sixty streaks would eat every tap on the field. */}
        {RAIN_ENABLED && !weatherOff && <RainLayer />}

        {projectiles.map((pr) => {
          const progress = Math.min(1, (Date.now() - pr.createdAt) / pr.duration);
          const x = pr.from.x + (pr.to.x - pr.from.x) * progress;
          const y = pr.from.y + (pr.to.y - pr.from.y) * progress;
          return <View key={pr.id} style={[styles.projectile, { left: x - 4, top: y - 4, backgroundColor: pr.color }]} />;
        })}

        {hitFlashes.map((f) => {
          const age = Date.now() - f.createdAt;
          const opacity = Math.max(0, 1 - age / HIT_FLASH_DURATION);
          return <View key={f.id} style={[styles.hitFlash, { left: f.pos.x - 10, top: f.pos.y - 10, opacity }]} />;
        })}

        {floatingTexts.map((f) => {
          const age = Date.now() - f.createdAt;
          const t = Math.min(1, age / FLOATING_TEXT_DURATION);
          const opacity = Math.max(0, 1 - t);
          const y = f.pos.y - t * FLOATING_TEXT_RISE;
          return (
            <Text
              key={f.id}
              pointerEvents="none"
              style={[styles.floatingText, { left: f.pos.x - 25, top: y - 10, color: f.color, opacity }]}
            >
              {f.text}
            </Text>
          );
        })}

      </View>

      <View style={styles.quickCastBar}>
        {/* Inventory, moved out of the old bottom bar: a small bag at the far
            left of the skill row. */}
        <Pressable onPress={() => setInvMenuOpen(true)} style={styles.invBagButton}>
          <Text style={styles.invBagIcon}>🎒</Text>
          {bagCount > 0 && (
            <View style={styles.invBagBadge}>
              <Text style={styles.menuBadgeText}>{bagCount}</Text>
            </View>
          )}
        </Pressable>
        {([1, 2, 3] as AbilityId[])
          .filter((id) => abilities[id].skill != null && abilities[id].level > 0)
          .map((id) => {
            const ab = abilities[id];
            const skill = ab.skill!;
            const meta = SKILL_META[skill];
            const cost = meta.mana;
            const onCooldown = ab.cooldown > 0;
            const canCast = !onCooldown && player.mana >= cost;
            const isAiming = aimingAbility === id;

            return (
              <View key={id} style={styles.quickCastSlot}>
                <Pressable
                  onPress={() => handleAbilityPress(id)}
                  style={[
                    styles.quickCastButton,
                    { backgroundColor: meta.color },
                    !canCast && styles.abilityDim,
                    isAiming && styles.abilityAiming,
                    skill === 'ranged' && player.hasteTimer > 0 && styles.abilityHaste,
                  ]}
                >
                  <Text style={styles.quickCastIcon}>{meta.icon}</Text>
                  <View style={styles.manaBadge}>
                    <Text style={styles.manaBadgeText}>{cost}</Text>
                  </View>
                  {onCooldown && (
                    <View style={styles.quickCastCooldownOverlay}>
                      <Text style={styles.cooldownText}>{Math.ceil(ab.cooldown)}</Text>
                    </View>
                  )}
                </Pressable>
                <Text style={styles.abilityCostText}>{meta.label}</Text>
              </View>
            );
          })}

        {/* The equipped passive, shown smaller beside the active buttons. */}
        {passive && (
          <View style={styles.quickCastSlot}>
            <View style={[styles.passiveChip, { backgroundColor: SKILL_META[passive.skill].color }]}>
              <Text style={styles.passiveChipIcon}>{SKILL_META[passive.skill].icon}</Text>
            </View>
          </View>
        )}
      </View>

      <View style={styles.hud}>
        <View style={styles.hudBarsRow}>
          <View style={styles.hudBarColumn}>
            <View style={styles.hudBarHeader}>
              <Text style={styles.hudBarLabel}>Lv {player.level}</Text>
              <Text style={styles.hudBarValue}>{player.xp}/{player.xpToNext}</Text>
            </View>
            <View style={styles.barBg}>
              <View style={[styles.barFillXp, { width: BAR_WIDTH * (player.xp / player.xpToNext) }]} />
            </View>
          </View>
          <View style={styles.hudBarColumn}>
            <View style={styles.hudBarHeader}>
              <Text style={styles.hudBarLabel}>HP</Text>
              <Text style={styles.hudBarValue}>{Math.round(player.hp)}/{Math.round(effectiveMaxHp)}</Text>
            </View>
            <View style={styles.barBg}>
              <View style={[styles.barFillHp, { width: BAR_WIDTH * (player.hp / effectiveMaxHp) }]} />
            </View>
          </View>
          <View style={styles.hudBarColumn}>
            <View style={styles.hudBarHeader}>
              <Text style={styles.hudBarLabel}>MP</Text>
              <Text style={styles.hudBarValue}>{Math.round(player.mana)}/{Math.round(effectiveMaxMana)}</Text>
            </View>
            <View style={styles.barBg}>
              <View style={[styles.barFillMana, { width: BAR_WIDTH * (player.mana / effectiveMaxMana) }]} />
            </View>
          </View>
        </View>
        <View style={styles.hudStatsRow}>
          <Text style={styles.hudStatText}>DMG {displayDamage}</Text>
          <Text style={styles.hudStatText}>SPD {displayAtkSpeed.toFixed(1)}/s</Text>
        </View>
      </View>

      {/* The kit's own canvas, sitting over the bars rather than inside one --
          the skull stands 172 px against the tallest bar's 84. Measured from
          the bottom of the screen, so it stays put whatever the bars do.

          Two decisions crossed here, kept in this order on purpose: Magnus
          benched the old pouch for sitting over his new skill buttons, and
          Nicolai then asked for the skull in its place (20 July) with a
          switch so it can prove its cost. Its default spot is a first guess
          that still overlaps those buttons -- where it finally sits is
          Nicolai's to settle with the tuning panel, and Magnus's concern is
          the constraint to settle it against. */}
      {COINSACK_ENABLED && !sackOff && (
        <CoinSackView
          sackRef={coinSackRef}
          left={DEBUG_COINSACK_TUNING ? tuneSackLeft : COINSACK_LEFT}
          bottom={DEBUG_COINSACK_TUNING ? tuneSackBottom : COINSACK_BOTTOM}
          width={DEBUG_COINSACK_TUNING ? tuneSackWidth : COINSACK_WIDTH}
          muted={allSoundOff}
        />
      )}

      {/* --- Temporary coin sack tuning panel; delete with DEBUG_COINSACK_TUNING --- */}
      {DEBUG_COINSACK_TUNING && (
        // Swallows stray taps rather than letting them reach the field -- see
        // the rim panel below.
        <View style={styles.tunePanel} onStartShouldSetResponder={() => true}>
          <DebugSlider label="Fra venstre" value={tuneSackLeft} min={0} max={Math.round(SCREEN_W - 40)} onChange={setTuneSackLeft} />
          <DebugSlider label="Fra bunden" value={tuneSackBottom} min={-60} max={Math.round(SCREEN_H / 2)} onChange={setTuneSackBottom} />
          <DebugSlider label="Bredde" value={tuneSackWidth} min={100} max={Math.round(SCREEN_W)} onChange={setTuneSackWidth} />
          <View style={styles.tuneButtons}>
            <Pressable style={styles.tuneButton} onPress={() => coinSackRef.current?.addCoin()}>
              <Text style={styles.tuneButtonText}>Smid en moent</Text>
            </Pressable>
            <Pressable
              style={styles.tuneButton}
              onPress={() => {
                for (let i = 0; i < 5; i++) coinSackRef.current?.addCoin();
              }}
            >
              <Text style={styles.tuneButtonText}>+5</Text>
            </Pressable>
          </View>
          <Text style={styles.tuneCode}>
            {`left: ${tuneSackLeft}, bottom: ${tuneSackBottom}, width: ${tuneSackWidth}` +
              (tuneSackWidth < SACK_MIN_W
                ? `   <- under ${SACK_MIN_W}: hele billedet skaleres ned (${(tuneSackWidth / SACK_MIN_W).toFixed(2)}x)`
                : '')}
          </Text>
        </View>
      )}

      {/* --- Temporary rim light tuning panel; delete with DEBUG_RIM_TUNING ---
          Only colour and strength are here. Which edge the light falls on and
          how far it reaches are the shape of the -rim sheets, and changing
          those means running npm run build:sprites. */}
      {DEBUG_RIM_TUNING && (
        // Swallows anything that lands on it. Without this a tap on a label or
        // on the panel's own background falls through to the field underneath
        // and sends the knight walking off while his light is being set. The
        // sliders inside still win, being deeper: the responder system offers
        // the touch to the innermost view first.
        <View style={styles.tunePanel} onStartShouldSetResponder={() => true}>
          <DebugSlider label="Roed" value={tuneRimR} min={0} max={255} onChange={setTuneRimR} />
          <DebugSlider label="Groen" value={tuneRimG} min={0} max={255} onChange={setTuneRimG} />
          <DebugSlider label="Blaa" value={tuneRimB} min={0} max={255} onChange={setTuneRimB} />
          <DebugSlider label="Styrke" value={tuneRimStrength} min={0} max={100} onChange={setTuneRimStrength} />
          <View style={styles.tuneButtons}>
            {(['screen', 'plus-lighter', 'normal'] as BlendMode[]).map((mode) => (
              <Pressable
                key={mode}
                style={[styles.tuneButton, tuneRimBlend === mode && styles.tuneButtonOn]}
                onPress={() => setTuneRimBlend(mode)}
              >
                <Text style={styles.tuneButtonText}>{mode}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[styles.tuneSwatch, { backgroundColor: rgb([tuneRimR, tuneRimG, tuneRimB]) }]} />
          <Text style={styles.tuneCode}>
            {`color: [${tuneRimR}, ${tuneRimG}, ${tuneRimB}], strength: ${(tuneRimStrength / 100).toFixed(2)}, blend: '${tuneRimBlend}'`}
          </Text>
        </View>
      )}

      {/* ---- Skills menu ---- */}
      {skillsMenuOpen && (
        <View style={styles.menuOverlay}>
          <Pressable
            style={styles.menuBackdrop}
            onPress={() => {
              setSkillsMenuOpen(false);
              dismissTooltip();
            }}
          />
          <View style={styles.menuPanel}>
            <View style={styles.menuHeader}>
              <Text style={styles.menuTitle}>Equipped skills</Text>
              <Pressable
                onPress={() => {
                  setSkillsMenuOpen(false);
                  dismissTooltip();
                }}
                style={styles.menuClose}
              >
                <Text style={styles.menuCloseText}>X</Text>
              </Pressable>
            </View>

            {([1, 2, 3] as AbilityId[])
              .filter((id) => abilities[id].skill != null)
              .map((id) => {
                const ab = abilities[id];
                const skill = ab.skill!;
                const meta = SKILL_META[skill];
                return (
                  <View key={id} style={styles.listRow}>
                    <View style={styles.listIconWrap}>
                      <Pressable
                        {...registerSlot(`skill-${id}`)}
                        onPress={() => showTooltipAboveKey(`skill-${id}`, skillDescription(skill) + skillStatsSuffix(skill))}
                        style={[styles.listIcon, { backgroundColor: meta.color }]}
                      >
                        <View style={styles.pipsRow}>
                          {[1, 2, 3, 4].map((pip) => (
                            <View key={pip} style={[styles.pip, pip <= ab.level && styles.pipFilled]} />
                          ))}
                        </View>
                      </Pressable>
                    </View>
                    <View style={styles.listInfo}>
                      <Text style={styles.listName}>
                        {meta.icon} {meta.label} · Lv {ab.level}/{ABILITY_MAX_LEVEL}
                      </Text>
                      <Text style={styles.listSub}>
                        {meta.cast === 'passive' ? 'Passive' : `${meta.mana} MP · ${meta.cooldown}s CD`}
                      </Text>
                    </View>
                  </View>
                );
              })}
            {passive && (
              <View style={styles.listRow}>
                <View style={styles.listIconWrap}>
                  <View style={[styles.listIcon, { backgroundColor: SKILL_META[passive.skill].color }]}>
                    <View style={styles.pipsRow}>
                      {[1, 2, 3, 4].map((pip) => (
                        <View key={pip} style={[styles.pip, pip <= passive.level && styles.pipFilled]} />
                      ))}
                    </View>
                  </View>
                </View>
                <View style={styles.listInfo}>
                  <Text style={styles.listName}>{SKILL_META[passive.skill].icon} {SKILL_META[passive.skill].label} · Lv {passive.level}/{ABILITY_MAX_LEVEL}</Text>
                  <Text style={styles.listSub}>Passive</Text>
                </View>
              </View>
            )}
            <Text style={styles.listSub}>Buy, level and equip skills from the main menu.</Text>
          </View>
        </View>
      )}

      {/* ---- Inventory menu ---- */}
      {invMenuOpen && (
        <View style={styles.menuOverlay}>
          <Pressable
            style={styles.menuBackdrop}
            onPress={() => {
              setInvMenuOpen(false);
              dismissTooltip();
            }}
          />
          <View style={styles.menuPanel}>
            <View style={styles.menuHeader}>
              <Text style={styles.menuTitle}>Inventory</Text>
              <Pressable
                onPress={() => {
                  setInvMenuOpen(false);
                  dismissTooltip();
                }}
                style={styles.menuClose}
              >
                <Text style={styles.menuCloseText}>X</Text>
              </Pressable>
            </View>

            <Text style={styles.invSectionLabel}>Equipped</Text>
            <View style={styles.equipRow}>
              {equipped.map((item, i) => renderInvSlot(`equip-${i}`, item, styles.equipSlot))}
            </View>

            <View style={styles.invBottomRow}>
              <View>
                <Text style={styles.invSectionLabel}>Bag</Text>
                <View style={styles.bagGrid}>
                  {bag.map((item, i) => renderInvSlot(`bag-${i}`, item, styles.bagSlot))}
                </View>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* ---- Mob Stats overlay ---- */}
      {mobStatsOpen && (
        <View style={styles.menuOverlay}>
          <Pressable style={styles.menuBackdrop} onPress={() => setMobStatsOpen(false)} />
          <View style={styles.menuPanel}>
            <View style={styles.menuHeader}>
              <Text style={styles.menuTitle}>Mob Stats · Wave {shownWave}</Text>
              <Pressable onPress={() => setMobStatsOpen(false)} style={styles.menuClose}>
                <Text style={styles.menuCloseText}>X</Text>
              </Pressable>
            </View>
            {waveComposition(shownWave).map((row) => {
              const meta = MOB_TYPE_META[row.type];
              const stats = mobTypeStats(row.type, shownWave);
              return (
                <View key={row.type} style={styles.listRow}>
                  <View style={[styles.mobSwatch, { backgroundColor: meta.color }]} />
                  <View style={styles.listInfo}>
                    <Text style={styles.listName}>
                      {meta.name} · x{row.count}
                    </Text>
                    <Text style={styles.listSub}>
                      HP {stats.hp} · DMG {stats.damage}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* ---- Dragging item ghost ---- */}
      {dragging && (
        <View
          pointerEvents="none"
          style={[
            styles.dragGhost,
            { left: dragging.x - 20, top: dragging.y - 20, backgroundColor: ITEM_DEFS[dragging.kind].color },
          ]}
        >
          <Text style={styles.invSlotName}>{ITEM_DEFS[dragging.kind].name}</Text>
          <Text style={styles.invSlotLevel}>{dragging.level}</Text>
        </View>
      )}

      {tooltip && (
        <>
          <Pressable style={styles.tooltipDismissOverlay} onPress={handleDismissOverlayPress} />
          <View pointerEvents="none" style={[styles.tooltipBox, tooltipPositionStyle(tooltip.x, tooltip.y)]}>
            <Text style={styles.tooltipText}>{tooltip.text}</Text>
          </View>
        </>
      )}

      {gameOver && (
        <View style={styles.gameOverOverlay}>
          <Text style={styles.gameOverText}>Game Over</Text>
          {!isTestRunRef.current && (
            <Text style={styles.gameOverGold}>+{lastRunGold} gold earned</Text>
          )}
          <Pressable onPress={handleBackToMenu} style={styles.retryButton}>
            <Text style={styles.retryText}>Main Menu</Text>
          </Pressable>
        </View>
      )}

      {/* Over everything, including the veil, so a fade cannot hide the numbers.
          Delete with DEBUG_PERF. */}
      {DEBUG_PERF && <PerfOverlay />}

      {/* The kill switches, beside the numbers. Tap one, play a minute, feel
          whether the stutter left with it. Delete with DEBUG_PERF. */}
      {DEBUG_PERF && (
        <View style={styles.perfSwitchRow}>
          <Pressable
            onPress={() => setAllSoundOff((v) => !v)}
            style={[styles.perfSwitch, allSoundOff && styles.perfSwitchOff]}
          >
            <Text style={styles.perfSwitchText}>{allSoundOff ? 'ALT LYD FRA' : 'alt lyd'}</Text>
          </Pressable>
          <Pressable onPress={() => setSfxOff((v) => !v)} style={[styles.perfSwitch, sfxOff && styles.perfSwitchOff]}>
            <Text style={styles.perfSwitchText}>{sfxOff ? 'lyd FRA' : 'lyd til'}</Text>
          </Pressable>
          <Pressable
            onPress={() => setWeatherOff((v) => !v)}
            style={[styles.perfSwitch, weatherOff && styles.perfSwitchOff]}
          >
            <Text style={styles.perfSwitchText}>{weatherOff ? 'vejr FRA' : 'vejr til'}</Text>
          </Pressable>
          <Pressable
            onPress={() => setMusicOff((v) => !v)}
            style={[styles.perfSwitch, musicOff && styles.perfSwitchOff]}
          >
            <Text style={styles.perfSwitchText}>{musicOff ? 'musik FRA' : 'musik til'}</Text>
          </Pressable>
          {/* A dead switch is a lie -- it only shows while the skull exists. */}
          {COINSACK_ENABLED && (
            <Pressable
              onPress={() => setSackOff((v) => !v)}
              style={[styles.perfSwitch, sackOff && styles.perfSwitchOff]}
            >
              <Text style={styles.perfSwitchText}>{sackOff ? 'sæk FRA' : 'sæk til'}</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* The same two layers the menu put up, coming back off over the field. */}
      {leaveVeil}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1b1b2b',
  },
  topBar: {
    height: TOP_BAR_HEIGHT,
    backgroundColor: '#111122',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topBarText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  topBarButton: {
    backgroundColor: '#37474f',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  topBarButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  exitRunButton: {
    backgroundColor: '#b71c1c',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  exitRunText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  startWaveButton: {
    backgroundColor: '#4caf50',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  startWaveText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  playArea: {
    width: SCREEN_W,
    height: PLAY_H,
    // Kept as the colour behind the ground texture, so a slow load or a failed
    // one leaves the play area looking as it always did rather than blank.
    backgroundColor: '#26263f',
    overflow: 'hidden',
  },
  background: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: PLAY_H,
  },
  rain: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: PLAY_H,
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  rangeRing: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'transparent',
  },
  ally: {
    position: 'absolute',
    width: ALLY_RADIUS * 2,
    height: ALLY_RADIUS * 2,
    borderRadius: ALLY_RADIUS,
    backgroundColor: '#9575cd',
  },
  mobHpBarBg: {
    position: 'absolute',
    height: 4,
    backgroundColor: '#000',
  },
  mobHpBarFill: {
    height: 4,
    backgroundColor: '#4caf50',
  },
  projectile: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  hitFlash: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
  },
  floatingText: {
    position: 'absolute',
    width: 50,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: 'bold',
  },
  groundItem: {
    position: 'absolute',
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groundItemText: {
    color: '#1b1b2b',
    fontSize: 11,
    fontWeight: 'bold',
  },
  quickCastBar: {
    height: QUICK_CAST_BAR_HEIGHT,
    backgroundColor: '#111122',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    // The round buttons poke up out of the top of this black strip, over the
    // gameplay, so nothing here may clip them.
    overflow: 'visible',
    zIndex: 5,
  },
  quickCastSlot: {
    alignItems: 'center',
    // Lift the whole slot so ~60% of the button sits above the strip (over the
    // field) and ~40% stays within the black strip.
    transform: [{ translateY: -22 }],
  },
  quickCastButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickCastIcon: {
    fontSize: 30,
  },
  invBagButton: {
    position: 'absolute',
    left: 8,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#37474f',
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ translateY: -14 }],
  },
  invBagIcon: {
    fontSize: 20,
  },
  invBagBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#90caf9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  manaBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 3,
    backgroundColor: '#2196f3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  manaBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  loadoutPreview: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    marginBottom: 6,
  },
  loadoutSlot: {
    alignItems: 'center',
  },
  passiveChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  passiveChipIcon: {
    fontSize: 15,
  },
  quickCastCooldownOverlay: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  abilityLocked: {
    opacity: 0.3,
  },
  abilityDim: {
    opacity: 0.55,
  },
  abilityAiming: {
    borderWidth: 3,
    borderColor: '#ffeb3b',
  },
  abilityHaste: {
    borderWidth: 3,
    borderColor: '#69f0ae',
  },
  cooldownText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  pipsRow: {
    position: 'absolute',
    bottom: 3,
    flexDirection: 'row',
  },
  pip: {
    width: 6,
    height: 6,
    marginHorizontal: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  pipFilled: {
    backgroundColor: '#fff',
  },
  levelUpButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    backgroundColor: '#4caf50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  levelUpText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  abilityCostText: {
    color: '#888',
    fontSize: 9,
    marginTop: 3,
  },
  hud: {
    height: HUD_HEIGHT,
    backgroundColor: '#111122',
    paddingVertical: 6,
    paddingHorizontal: 10,
    justifyContent: 'center',
    gap: 4,
  },
  hudBarsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: 14,
  },
  hudBarColumn: {
    alignItems: 'center',
    width: BAR_WIDTH,
  },
  hudBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    width: BAR_WIDTH,
    marginBottom: 2,
  },
  hudBarLabel: {
    color: '#fff',
    fontSize: 11,
  },
  hudBarValue: {
    color: '#ccc',
    fontSize: 10,
  },
  hudStatsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  hudStatText: {
    color: '#ffd54f',
    fontSize: 12,
  },
  barBg: {
    width: BAR_WIDTH,
    height: 10,
    backgroundColor: '#333',
  },
  barFillXp: {
    height: 10,
    backgroundColor: '#ffd54f',
  },
  barFillHp: {
    height: 10,
    backgroundColor: '#e05555',
  },
  barFillMana: {
    height: 10,
    backgroundColor: '#4fc3f7',
  },
  menuBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ffd54f',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  menuBadgeText: {
    color: '#1b1b2b',
    fontSize: 11,
    fontWeight: 'bold',
  },
  menuOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: SCREEN_H,
  },
  menuBackdrop: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: SCREEN_H,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  menuPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#141428',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  menuTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  menuClose: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#333',
  },
  menuCloseText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  listIconWrap: {
    width: 56,
    height: 56,
  },
  listIcon: {
    width: 56,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listInfo: {
    flex: 1,
  },
  listName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  listSub: {
    color: '#999',
    fontSize: 11,
    marginTop: 2,
  },
  mobSwatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  invSectionLabel: {
    color: '#bbb',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  equipRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
  },
  invBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bagGrid: {
    width: 3 * 52 + 2 * 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  invSlotEmpty: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  equipSlot: {
    width: 56,
    height: 56,
  },
  bagSlot: {
    width: 52,
    height: 52,
  },
  invSlotName: {
    color: '#1b1b2b',
    fontSize: 8,
    fontWeight: 'bold',
  },
  invSlotLevel: {
    color: '#1b1b2b',
    fontSize: 16,
    fontWeight: 'bold',
  },
  salvageArea: {
    width: 96,
    height: 3 * 52 + 2 * 8,
    borderWidth: 2,
    borderColor: '#ef5350',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(239,83,80,0.08)',
  },
  salvageTitle: {
    color: '#ef9a9a',
    fontSize: 13,
    fontWeight: 'bold',
  },
  salvageSub: {
    color: '#c98',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 4,
  },
  dragGhost: {
    position: 'absolute',
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.9,
  },
  tooltipDismissOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: SCREEN_H,
  },
  tooltipBox: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    padding: 10,
  },
  tooltipText: {
    color: '#fff',
    fontSize: 12,
  },
  menuBg: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: SCREEN_H,
  },
  leaveVeil: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    backgroundColor: '#000',
    pointerEvents: 'none',
  },
  menuButtonArt: { width: '100%', height: '100%' },
  // Temporary: the design has one button, and these two are parked out of the
  // way until it is decided where they belong.
  menuMinorRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  menuMinorText: {
    color: '#8a7f6d',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  menuMinorDisabled: { opacity: 0.4 },
  menuScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  skillTreeScroll: {
    flex: 1,
  },
  skillTreeContent: {
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 48,
  },
  menuScreenTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  menuBigButton: {
    width: 240,
    backgroundColor: '#37474f',
    paddingVertical: 16,
    alignItems: 'center',
  },
  menuBigButtonDisabled: {
    opacity: 0.4,
  },
  menuBigButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  menuEmptyText: {
    color: '#999',
    fontSize: 13,
  },
  runRow: {
    width: 260,
    backgroundColor: '#232338',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  runRowTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  runRowSub: {
    color: '#999',
    fontSize: 11,
    marginTop: 2,
  },
  menuBackButton: {
    marginTop: 10,
    backgroundColor: '#333',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  menuBackButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  gameOverOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: SCREEN_H,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  gameOverText: {
    color: '#fff',
    fontSize: 36,
    fontWeight: 'bold',
  },
  retryButton: {
    backgroundColor: '#e05555',
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  gameOverGold: {
    color: '#ffd54f',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },

  // --- Main-menu skill tree / shop ---
  skillTreeHint: { color: '#b0bec5', fontSize: 12, marginBottom: 12, textAlign: 'center' },
  skillTreeGroup: {
    marginBottom: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 8,
  },
  skillRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  skillRowChild: { paddingLeft: 16, opacity: 0.98 },
  skillSwatch: { width: 26, height: 26, borderRadius: 13, marginRight: 10, justifyContent: 'center', alignItems: 'center' },
  skillSwatchIcon: { fontSize: 15 },
  skillRowInfo: { flex: 1, paddingRight: 8 },
  skillRowName: { color: '#eceff1', fontSize: 13, fontWeight: 'bold' },
  skillRowDesc: { color: '#90a4ae', fontSize: 10, marginTop: 2 },
  skillRowButtons: { flexDirection: 'row', alignItems: 'center' },
  skillBuyButton: {
    backgroundColor: '#5c6bc0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    marginRight: 6,
    minWidth: 62,
    alignItems: 'center',
  },
  skillBuyText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  skillEquipButton: {
    backgroundColor: '#37474f',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    minWidth: 62,
    alignItems: 'center',
  },
  skillEquipButtonOn: { backgroundColor: '#2e7d32' },
  skillEquipText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  skillButtonDisabled: { opacity: 0.35 },

  // --- Temporary coin sack tuning panel; delete with DEBUG_COINSACK_TUNING ---
  tunePanel: {
    position: 'absolute',
    top: TOP_BAR_HEIGHT + 8,
    left: 8,
    right: 8,
    zIndex: 50,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  tuneRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  tuneLabel: { width: 74, color: '#cfd8dc', fontSize: 11 },
  tuneTrack: {
    flex: 1,
    height: 22,
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  tuneFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4, backgroundColor: '#4fc3f7' },
  tuneKnob: {
    position: 'absolute',
    width: 12,
    height: 22,
    marginLeft: -6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  tuneValue: { width: 46, textAlign: 'right', color: '#fff', fontSize: 11, fontWeight: 'bold' },
  tuneButtons: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  tuneButton: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#3949ab' },
  tuneButtonOn: { backgroundColor: '#4fc3f7' },
  // The hitch hunt's switches; delete with DEBUG_PERF.
  perfSwitchRow: {
    position: 'absolute',
    top: 2,
    right: 2,
    zIndex: 300,
    flexDirection: 'row',
    gap: 4,
  },
  perfSwitch: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.66)',
  },
  perfSwitchOff: { backgroundColor: '#b3402a' },
  perfSwitchText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  tuneButtonText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  // The chosen colour on its own, since a rim two pixels wide is hard to read
  // a slider against.
  tuneSwatch: { height: 14, borderRadius: 4, marginTop: 6 },
  tuneCode: { marginTop: 6, color: '#ffe082', fontSize: 10 },
});

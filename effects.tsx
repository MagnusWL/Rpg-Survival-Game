import { memo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import type { BlendMode } from 'react-native';

// Screen/play-area dimensions, recomputed here rather than imported from
// App.tsx -- see the note in combat.ts.
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const TOP_BAR_HEIGHT = 50;
const QUICK_CAST_BAR_HEIGHT = 48;
const HUD_HEIGHT = 60;
const PLAY_H = SCREEN_H - TOP_BAR_HEIGHT - QUICK_CAST_BAR_HEIGHT - HUD_HEIGHT;

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
export const GLOW = require('./assets/sprites/effects/glow.png');

export type GlowStyle = {
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
export const PLAYER_GLOW: GlowStyle = {
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
export type RimStyle = {
  /** Red, green, blue. The sheet is white, so this is the colour it becomes. */
  color: [number, number, number];
  /** 0 to 1, over and above the falloff already in the sheet's alpha. */
  strength: number;
  blend: BlendMode;
};

export const RIM_STYLE: RimStyle = {
  color: [198, 214, 255], // cold, against the warm glow at his feet
  strength: 0.55,
  // Screen only lightens, and reproduces exactly what baking the light into the
  // sheet did: both come out at backdrop + strength x colour x (1 - backdrop).
  blend: 'screen',
};

export const rgb = ([r, g, b]: [number, number, number]) => `rgb(${r}, ${g}, ${b})`;

// --- Rain -----------------------------------------------------------------
// Every drop is worked out from the clock rather than stored and stepped: given
// its speed and where it started, the time says where it is. So the game loop
// carries none of this, nothing accumulates, and there is no state to reset
// between runs.
export const RAIN_ENABLED = true;

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
export const RAIN = {
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
export const RAIN_STREAKS = Array.from({ length: RAIN.drops }, () => {
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

export const RAIN_TILT_X = Math.tan((RAIN.tiltDeg * Math.PI) / 180);

/**
 * How far the wind carries a drop over a full fall.
 *
 * Drops start spread across the width plus this much to the left of it, so they
 * blow in from off the edge. Without it the bottom-left corner stays dry while
 * drops on the right blow off the screen -- measured at 60 px of empty ground on
 * one side and 155 px of wasted drops on the other.
 */
export const RAIN_DRIFT = PLAY_H * RAIN_TILT_X;

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
export const PUDDLE_SPOTS: [number, number, number][] = require('./assets/sprites/effects/puddles.json');

/** The height the spots were measured against, to turn that room into screen px. */
export const BG_SOURCE_H = 1086;

/** The background's own proportions, needed to place anything on top of it. */
export const BG_ASPECT = 1448 / BG_SOURCE_H;

/**
 * The same 'cover' the background is drawn with: scale until it fills, centre
 * the overflow. Anything meant to sit on the ground has to repeat this, or it
 * drifts away from the picture as the screen changes shape.
 */
export const bgDrawnW = Math.max(SCREEN_W, PLAY_H * BG_ASPECT);
export const bgDrawnH = Math.max(PLAY_H, SCREEN_W / BG_ASPECT);
export const bgOffsetX = (SCREEN_W - bgDrawnW) / 2;
export const bgOffsetY = (PLAY_H - bgDrawnH) / 2;
export const onGroundX = (fx: number) => bgOffsetX + fx * bgDrawnW;
export const onGroundY = (fy: number) => bgOffsetY + fy * bgDrawnH;
/** What one pixel of the source image is worth on screen, once it is laid down. */
export const groundScale = bgDrawnH / BG_SOURCE_H;

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
export function feetInWater(pos: { x: number; y: number }) {
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
export const RIPPLE = {
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
export const noise = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export const RIPPLES = Array.from({ length: RIPPLE.slots }, (_, i) => ({
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
export const RAIN_SPAN = PLAY_H + RAIN.lengthNear;

// The rotate is minus tilt, turned the other way to the wind: a rotation goes
// clockwise while the drift carries the drop the other way, so at plain +tilt
// the streak leant against its own path by twice the angle -- measured at
// 9.7 px of drift against 9.7 px of lean.
export const RAIN_FALL_FRAMES = [
  {
    '0%': { transform: `translate(0px, 0px) rotate(${-RAIN.tiltDeg}deg)` },
    '100%': { transform: `translate(${RAIN_SPAN * RAIN_TILT_X}px, ${RAIN_SPAN}px) rotate(${-RAIN.tiltDeg}deg)` },
  },
];

export const dropStyles = StyleSheet.create(
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

const styles = StyleSheet.create({
  rain: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: PLAY_H,
    overflow: 'hidden',
    pointerEvents: 'none',
  },
});

export const RainLayer = memo(function RainLayer() {
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
export const RIPPLE_SPREAD_FRAMES = [
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
export const RIPPLE_CELL = 24;
export const RIPPLE_POOL = (() => {
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

export const ringStyles = StyleSheet.create(
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

export const RippleLayer = memo(function RippleLayer() {
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
export const BACKGROUND = require('./assets/sprites/background.jpg');

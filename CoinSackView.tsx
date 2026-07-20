/**
 * The coin counter: a crowned skull whose open cranium the coins drop into,
 * run by the kit's own engine rather than reproduced.
 *
 * Second design in this spot. The first was the drawstring sack, and the one
 * lesson that survives it is the whole architecture here: an earlier attempt
 * redrew that kit with React Native views and its own physics, and the result
 * was not the same thing -- the pixel treatment and the coin shading are the
 * design. So this runs `vendor/cranium-coin-bag/coin-sack-engine.js`
 * untouched: the same engine one revision on, with the artwork's interior as
 * a parameter (`geometry: 'skull'`). Nothing here alters how it looks or
 * behaves; it hands the engine a canvas and the recipe from the kit's own
 * example -- "Recipe: Nicolai in pixel-lab, 20 July 2026", says the README --
 * and gets out of the way.
 *
 * Which means it is web only. React Native has no canvas, so on a phone this
 * renders nothing at all until it is either given a WebView to live in or the
 * engine is ported, and neither is something to decide quietly.
 *
 * Everything the engine needs:
 *   - `window.Matter`, which it looks up by name (matter-js 0.19, as the kit asks)
 *   - a canvas with a real box, since it reads that to size the skull and coins
 *   - asset URLs it can load and fetch, which is why they go through expo-asset
 *   - a genuine user gesture before any sound, which browsers insist on
 */
import { Asset } from 'expo-asset';
import Matter from 'matter-js';
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';

import { CoinSack } from './vendor/cranium-coin-bag/coin-sack-engine';

/**
 * The shape the skull is drawn at, from the kit's README: designed in 560x380
 * landscape, and the sides are deliberately wide, so coins spilling past the
 * brim stay visible falling beside it before they are culled.
 *
 * Width is not a free choice: at pixelSize 2.2 the buffer is 254 px across,
 * and a box below that scales the pixel look away. The tuning panel warns
 * below this the way it did for the sack.
 */
export const SACK_MIN_W = 254;
const DESIGN_W = 560;
const DESIGN_H = 380;
const SACK_ASPECT = DESIGN_H / DESIGN_W;

const ART = {
  /** The cavity, behind the coins. */
  bg: require('./assets/coinsack/skull/back.png'),
  /** Face and crown, in front of them. */
  fg: require('./assets/coinsack/skull/skull.png'),
};

// The same fourteen takes the sack used -- the kit ships them byte-identical.
// Listed rather than generated because Metro has to see each require().
const COIN_SAMPLES = [
  require('./assets/coinsack/coin/coin-1.wav'),
  require('./assets/coinsack/coin/coin-2.wav'),
  require('./assets/coinsack/coin/coin-3.wav'),
  require('./assets/coinsack/coin/coin-4.wav'),
  require('./assets/coinsack/coin/coin-5.wav'),
  require('./assets/coinsack/coin/coin-6.wav'),
  require('./assets/coinsack/coin/coin-7.wav'),
  require('./assets/coinsack/coin/coin-8.wav'),
  require('./assets/coinsack/coin/coin-9.wav'),
  require('./assets/coinsack/coin/coin-10.wav'),
  require('./assets/coinsack/coin/coin-11.wav'),
  require('./assets/coinsack/coin/coin-12.wav'),
  require('./assets/coinsack/coin/coin-13.wav'),
  require('./assets/coinsack/coin/coin-14.wav'),
];
const FLIP_SAMPLE = require('./assets/coinsack/coin-flip.mp3');

/**
 * Everything the skull needs before it can exist, for pulling down early.
 *
 * The engine cannot be built until these have arrived -- it loads the art as
 * images and fetches the sounds -- so a run that starts with them cold spends
 * its first moments assembling the skull in front of the player. Fetched
 * while the menu is up instead, they are in the browser's hands before the
 * field is.
 */
export const COINSACK_ASSETS: number[] = [...Object.values(ART), ...COIN_SAMPLES, FLIP_SAMPLE];

export type CoinSackHandle = { addCoin(): void } | null;

export default function CoinSackView({
  sackRef,
  left,
  bottom,
  width,
  muted = false,
}: {
  sackRef: { current: CoinSackHandle };
  left: number;
  bottom: number;
  width: number;
  /**
   * Silences the engine outright. Its soundOn flag alone is not enough -- the
   * kit gates the clink, the spend and the chime on it but not the flip and
   * landing samples -- so this also suspends its audio context, which carries
   * every sound it makes.
   */
  muted?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<CoinSack | null>(null);
  /** For the wake listener, which must not resume a deliberately muted skull. */
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const height = Math.round(width * SACK_ASPECT);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let sack: CoinSack | null = null;
    let dropped = false;

    // The engine looks this up by name rather than importing it, so it has to
    // be on the window before the skull is built.
    (window as unknown as { Matter: typeof Matter }).Matter = Matter;

    // Built at once rather than after waiting on the assets. The sack was
    // delayed 1.7 s into a run by awaiting loadAsync here; nothing needs the
    // bytes -- the engine is handed URLs and does its own loading, and on web
    // a URL is known from the bundle without asking.
    const url = (mod: number) => Asset.fromModule(mod).uri;

    try {
      if (!dropped) {
        // The approved configuration, verbatim from the kit's README and
        // example -- "reuse the options() block as-is". The only departures
        // are the ones its own comments instruct: the sounds point at bundled
        // files rather than the example's inlined data URIs, and the
        // onCount/onFull hooks are left out because the number is ours to
        // render and we render none.
        sack = new CoinSack(canvas, {
          style: 'artsack',
          geometry: 'skull',
          art: {
            bg: url(ART.bg),
            fg: url(ART.fg),
          },
          coinTones: ['#fff6d6', '#ffe08a', '#f5be3c', '#c6871f', '#7e5212'],
          pixelate: true,
          pixelSize: 2.2,
          fillCount: 30,
          groundShadow: false,
          coinSamples: COIN_SAMPLES.map(url),
          flipSample: url(FLIP_SAMPLE),
          spendStyle: 1,
          soundOn: true,
          tempo: 0.85,
          glintStyle: 'star',
          soundStyle: 'classic',
          restitution: 0.42,
          friction: 0.58,
          gravity: 1.5,
          bodyScale: 0.72,
          spin: 0.5,
          density: 0.006,
        });
        sackRef.current = sack;
        engineRef.current = sack;
      }
    } catch (err) {
      // A skull that fails to build must not take the game down with it -- but
      // it should say why, rather than leaving a blank corner and no reason.
      console.warn('[coin sack] failed to build:', err);
    }

    /**
     * Browsers refuse sound until the page has been touched, and the engine
     * builds its audio context once, at birth -- long before that. Without
     * this the skull is silent and nothing anywhere says why.
     *
     * Note that scrolling does not count as a touch. It has to be a real click,
     * tap or key, which in this game is the tap that starts a run.
     */
    const wake = () => {
      if (!sack) return;
      // Not while deliberately muted -- this listener fires on every tap, and
      // without the guard the first tap after muting would wake the sound
      // straight back up.
      if (mutedRef.current) return;
      sack._ensureAudio();
      if (sack.audio && sack.audio.state !== 'running') sack.audio.resume();
    };
    const events = ['pointerdown', 'touchend', 'keydown'] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });

    // One more read after layout has definitely settled. The engine sizes
    // itself from the canvas box at construction, and a box measured mid-
    // commit can come back wrong once; the kit's own API offers _resize for
    // exactly this.
    const settle = requestAnimationFrame(() => sack?._resize());

    return () => {
      cancelAnimationFrame(settle);
      dropped = true;
      for (const e of events) window.removeEventListener(e, wake);
      sackRef.current = null;
      engineRef.current = null;
      // Left running, it keeps its own animation frame alive for ever.
      if (sack) sack.destroy();
    };
  }, [sackRef]);

  // The engine sizes the skull and the coins off the canvas box, and only
  // reads it when told to -- so a box that changes has to say so, or the art
  // keeps the shape it was born at while the element around it moves.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    engineRef.current?._resize();
  }, [width, height]);

  // Belt and braces, per the note on the prop: the flag for the sounds that
  // consult it, the suspended context for the ones that do not.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const sack = engineRef.current;
    if (!sack) return;
    sack.soundOn = !muted;
    if (muted) {
      sack.audio?.suspend();
    } else if (sack.audio && sack.audio.state !== 'running') {
      sack.audio.resume();
    }
  }, [muted]);

  if (Platform.OS !== 'web') return null;

  return (
    <View style={{ position: 'absolute', left, bottom, width, height, pointerEvents: 'none' }}>
      {/* The canvas keeps the kit's native 560x380 box and is scaled to the
          spot with a transform, which offsetWidth/Height do not see.

          That blindness is the point. The engine reads those to size itself
          and clamps the height to at least 360 css px -- so a box scaled the
          way the README suggests (254x172, its own minimum) is quietly bumped
          to an internal 360 and the skull paints squashed to half height:
          measured as a 115x164 portrait buffer stretched into this landscape
          spot. Fed the native box instead, the engine lays out exactly as in
          the kit's example, and at 254 wide the buffer lands 1:1 on screen. */}
      {/* Absolute on purpose, and not decoration: the wrapper is a flex
          container (every react-native-web View is), and a canvas left in
          flow gets shrunk as a flex item toward the wrapper's 172 px -- the
          engine then reads the shrunken box and lays out clamped. Measured
          both ways on one screen: in flow it rebuilt at 560x360, absolute it
          holds 560x380. Absolute children are outside flex's reach. */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-theme="skull"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: DESIGN_W,
          height: DESIGN_H,
          display: 'block',
          transform: `scale(${width / DESIGN_W})`,
          transformOrigin: 'top left',
        }}
      />
    </View>
  );
}

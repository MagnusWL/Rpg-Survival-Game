/**
 * The coin sack, run by the kit's own engine rather than reproduced.
 *
 * An earlier attempt redrew all of this with React Native views and its own
 * physics, on the reasoning that a canvas cannot ship to a phone. The result
 * was not the same thing -- the pixel treatment and the coin shading are the
 * design, not decoration -- so this runs `vendor/coin-sack/coin-sack-engine.js`
 * untouched instead. Nothing here alters how it looks or behaves; it hands the
 * engine a canvas and the settings the kit's own example uses, and gets out of
 * the way.
 *
 * Which means it is web only. React Native has no canvas, so on a phone this
 * renders nothing at all until it is either given a WebView to live in or the
 * engine is ported, and neither is something to decide quietly.
 *
 * Everything the engine needs:
 *   - `window.Matter`, which it looks up by name (matter-js 0.19, as the kit asks)
 *   - a canvas with a real box, since it reads that to size the sack and coins
 *   - asset URLs it can load and fetch, which is why they go through expo-asset
 *   - a genuine user gesture before any sound, which browsers insist on
 */
import { Asset } from 'expo-asset';
import Matter from 'matter-js';
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';

import { CoinSack } from './vendor/coin-sack/coin-sack-engine';

/**
 * The shape the sack is drawn at, straight from the kit's example.
 *
 * Width is not a free choice. The engine always works internally at 220x360, so
 * its buffer is 220/pixelSize wide whatever the box says -- and the box decides
 * whether that buffer is then scaled up or down. At the pixelSize this kit now
 * asks for the buffer is 138 across, so the canvas wants to be about that wide
 * or more. The kit's own example uses 150, which lands on 1.09 screen pixels per
 * buffer pixel: near enough 1:1.
 *
 * The height follows the width, because the engine lays the art out from both
 * and a box of the wrong shape crops the sack instead of fitting it.
 */
export const SACK_MIN_W = 138;
const SACK_ASPECT = 265 / 150;

/** Steel. The kit ships brass (14b) and copper (14c) beside it. */
const THEME = '14f';

const ART = {
  bg: require('./assets/coinsack/14f/sack-bg.png'),
  bgB: require('./assets/coinsack/14f/sack-bg-b.png'),
  ringBack: require('./assets/coinsack/14f/ring-back.png'),
  fg: require('./assets/coinsack/14f/sack-fg.png'),
  ringFront: require('./assets/coinsack/14f/ring-front.png'),
  shade: require('./assets/coinsack/shade.png'),
};

// Fourteen takes, one picked at random per coin. Listed rather than generated
// because Metro has to see each require() to bundle the file.
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

export type CoinSackHandle = { addCoin(): void } | null;

export default function CoinSackView({
  sackRef,
  left,
  bottom,
  width,
}: {
  sackRef: { current: CoinSackHandle };
  left: number;
  bottom: number;
  width: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<CoinSack | null>(null);
  const height = Math.round(width * SACK_ASPECT);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let sack: CoinSack | null = null;
    let dropped = false;

    // The engine looks this up by name rather than importing it, so it has to
    // be on the window before the sack is built.
    (window as unknown as { Matter: typeof Matter }).Matter = Matter;

    // Sounds are fetch()ed by the engine and the art is loaded as images, so
    // both need real URLs. Metro hands those out through expo-asset.
    const modules = [...Object.values(ART), ...COIN_SAMPLES, FLIP_SAMPLE];
    Asset.loadAsync(modules)
      .then(() => {
        if (dropped) return;
        const url = (mod: number) => Asset.fromModule(mod).uri;

        // Verbatim from the kit's example, bar the theme and pointing the
        // sounds at bundled files rather than its inlined data URIs -- which
        // its README asks for, being smaller and cacheable.
        sack = new CoinSack(canvas, {
          style: 'artsack',
          art: {
            bg: url(ART.bg),
            bgB: url(ART.bgB),
            ringBack: url(ART.ringBack),
            fg: url(ART.fg),
            ringFront: url(ART.ringFront),
            shade: url(ART.shade),
          },
          coinTones: ['#fff6d6', '#ffe08a', '#f5be3c', '#c6871f', '#7e5212'],
          pixelate: true,
          // 1.6 rather than 2.4, which is the opposite of what it reads like: a
          // smaller number means a larger buffer, 138 across instead of 92, so a
          // coin gets 4.38 blocks where it had 2.92 and comes out sharper. The
          // sack's own chunkiness no longer depends on this at all -- it is
          // baked into art that genuinely has 58 pixels.
          pixelSize: 1.6,
          fillCount: 16,
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
      })
      .catch(() => {
        // A sack that fails to build must not take the game down with it.
      });

    /**
     * Browsers refuse sound until the page has been touched, and the engine
     * builds its audio context once, at birth -- long before that. Without
     * this the sack is silent and nothing anywhere says why.
     *
     * Note that scrolling does not count as a touch. It has to be a real click,
     * tap or key, which in this game is the tap that starts a run.
     */
    const wake = () => {
      if (!sack) return;
      sack._ensureAudio();
      if (sack.audio && sack.audio.state !== 'running') sack.audio.resume();
    };
    const events = ['pointerdown', 'touchend', 'keydown'] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });

    return () => {
      dropped = true;
      for (const e of events) window.removeEventListener(e, wake);
      sackRef.current = null;
      engineRef.current = null;
      // Left running, it keeps its own animation frame alive for ever.
      if (sack) sack.destroy();
    };
  }, [sackRef]);

  // The engine sizes the sack and the coins off the canvas box, and only reads
  // it when told to -- so a box that changes has to say so, or the art keeps
  // the shape it was born at while the element around it moves.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    engineRef.current?._resize();
  }, [width, height]);

  if (Platform.OS !== 'web') return null;

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left, bottom, width, height }}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-theme={THEME}
        style={{ width, height, display: 'block' }}
      />
    </View>
  );
}

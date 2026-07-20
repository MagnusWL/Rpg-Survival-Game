/**
 * The moving half of a story card: the kit's own canvas, laid over the still.
 *
 * Each of the three cards arrived as a drop-in kit -- a background with the
 * animation painted out of it, and a class that draws that part live. They are
 * run rather than reproduced, the same decision the coin sack and the tear
 * button led to: the fire, the eyes and the fog are the design.
 *
 * Which makes them web only. On a phone the card is simply the still, which is
 * a fair degradation -- the picture is whole either way, it just does not move.
 *
 * The one thing that needed thought is where to put the canvas. Every kit works
 * out its own placement from the background's native size, and says so: "lay the
 * canvas so it covers exactly the same rectangle as the background image". Our
 * cards are drawn with cover on a screen narrower than the art, so the picture
 * is wider than the screen and hangs off both sides. Sizing the canvas to the
 * screen would squeeze the fire inward and it would miss the woodpile. So the
 * canvas is given the drawn rectangle instead, overhang and all, and the card
 * clips it -- which is exactly what happens to the picture underneath.
 */
import { Asset } from 'expo-asset';
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';

import { PixelCampfire } from './vendor/intro-campfire/campfire-engine';
import { PixelFog } from './vendor/intro-fog/fog-engine';
import { MonsterEyes } from './vendor/intro-monster/monster-eyes';

/** The story art's own size. Every card is drawn at this shape. */
export const CARD_ART_W = 941;
export const CARD_ART_H = 1672;

export type IntroEffect = 'campfire' | 'monster' | 'fog';

/**
 * Where the card actually lands once cover has had its way with it.
 *
 * Shared with the still underneath, so both sit on the same rectangle and the
 * effect stays put over the thing it belongs to.
 */
export function cardRect(screenW: number, screenH: number) {
  const scale = Math.max(screenW / CARD_ART_W, screenH / CARD_ART_H);
  const width = CARD_ART_W * scale;
  const height = CARD_ART_H * scale;
  return { left: (screenW - width) / 2, top: (screenH - height) / 2, width, height };
}

type Engine = { destroy(): void };

export default function IntroSceneFx({
  effect,
  screenW,
  screenH,
}: {
  effect: IntroEffect;
  screenW: number;
  screenH: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rect = cardRect(screenW, screenH);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let engine: Engine | null = null;
    try {
      // Each reads its canvas box on construction to work out its scale, so the
      // box has to be the right size before this runs -- which it is, being set
      // in the style below rather than measured.
      const shared = { canvas, bgWidth: CARD_ART_W, bgHeight: CARD_ART_H };
      // Constructed with the kit's own settings and nothing else. Every number
      // that decides how these look is already baked into the classes.
      if (effect === 'campfire') engine = new PixelCampfire(shared);
      else if (effect === 'monster') engine = new MonsterEyes(shared);
      else engine = new PixelFog(shared);
    } catch (err) {
      // A card that cannot animate is still a card -- but say why. Swallowing
      // this quietly turned plain failures into long hunts twice already.
      console.warn(`[intro] ${effect} failed to build:`, err);
    }

    return () => {
      // Each keeps its own animation frame chain alive; left alone it outlives
      // the card it belongs to and burns for the rest of the run.
      engine?.destroy();
    };
  }, [effect, screenW, screenH]);

  if (Platform.OS !== 'web') return null;

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: rect.width,
          height: rect.height,
          display: 'block',
          // The fog veils; the other two only add light. Their own pages set
          // this, and getting it wrong washes the scene out or hides the fog.
          mixBlendMode: effect === 'fog' ? 'normal' : 'screen',
        }}
      />
    </View>
  );
}

/**
 * The stills, in story order, each paired with what moves on it.
 *
 * Kept here beside the effects so a card and its animation are named together
 * -- they come from the same kit and are meaningless apart.
 */
export const INTRO_CARDS: { art: number; effect: IntroEffect }[] = [
  { art: require('./assets/sprites/intro/1.jpg'), effect: 'campfire' },
  { art: require('./assets/sprites/intro/2.jpg'), effect: 'monster' },
  { art: require('./assets/sprites/intro/3.jpg'), effect: 'fog' },
];

/** For pulling the first card down before the logo's two seconds are up. */
export const firstCardUri = () => Asset.fromModule(INTRO_CARDS[0].art).uri;

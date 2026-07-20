/**
 * The RESCUE HER plaque, and what happens to it when it is pressed.
 *
 * The kit's own widget, run rather than reproduced -- the same decision the coin
 * sack led to, and for the same reason: the tearing is the design, not a
 * decoration that survives being approximated. `vendor/rescue-tear` holds the
 * class exactly as it arrived.
 *
 * Which makes it web only, since it wants a canvas. On a phone the caller draws
 * the plaque as a plain image instead and the run simply starts; the fade to
 * red still happens, because that part is ours and works everywhere.
 *
 * The canvas covers the whole screen on purpose. The blood is thrown well clear
 * of the button, and a canvas cropped to the plaque would cut it off mid-air.
 */
import { Asset } from 'expo-asset';
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';

import { RescueTearButton } from './vendor/rescue-tear/rescue-tear-button';

const MENU_BUTTON = require('./assets/sprites/menu/button.png');

/**
 * How long the tear takes, in milliseconds.
 *
 * The kit's own phases: press 110, crack 270, strain 580, snap 760, pieces
 * flown apart 1360. With autoReset off it freezes at the last of those, so this
 * is when there is nothing further to watch.
 */
export const TEAR_MS = 1360;

export type TearHandle = { fire(): void } | null;

export default function MenuTearButton({
  tearRef,
  screenW,
  screenH,
  button,
  logo,
}: {
  tearRef: { current: TearHandle };
  screenW: number;
  screenH: number;
  button: { x: number; y: number; w: number; h: number };
  logo: { x0: number; y0: number; x1: number; y1: number } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dropped = false;

    // Built at once. Waiting on loadAsync first only delayed the plaque
    // appearing -- the engine is handed a URL and loads the image itself, and
    // on web a URL is known from the bundle without asking for it.
    try {
      if (!dropped) {
        const tear = new RescueTearButton({
          canvas,
          buttonSrc: Asset.fromModule(MENU_BUTTON).uri,
          mode: 'horizontal',
          grid: 3,
          dense: false,
          width: screenW,
          height: screenH,
          buttonRect: button,
          logoRect: logo,
          // Left torn. It is a door out of the menu, not something to admire
          // twice, and the fade covers it before it could reset anyway.
          autoReset: false,
        });
        tearRef.current = tear;
      }
    } catch (err) {
      // A menu that cannot tear is still a menu -- but say why. Swallowing
      // this silently turned a plain failure into a long hunt once already.
      console.warn('[menu] tear button failed to build:', err);
    }

    return () => {
      dropped = true;
      tearRef.current = null;
    };
  }, [tearRef, screenW, screenH, button, logo]);

  if (Platform.OS !== 'web') return null;

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: screenW, height: screenH }}>
      <canvas ref={canvasRef} style={{ width: screenW, height: screenH, display: 'block' }} />
    </View>
  );
}

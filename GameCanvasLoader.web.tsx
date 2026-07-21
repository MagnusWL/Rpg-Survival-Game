import { WithSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import type { GameCanvasProps } from './GameCanvas';

/**
 * Delay importing the Skia canvas until CanvasKit has loaded. This file is
 * selected only for web, keeping CanvasKit and its Node-oriented helpers out
 * of Android's Metro dependency graph.
 */
export default function GameCanvasLoader(props: GameCanvasProps) {
  return (
    <WithSkiaWeb
      getComponent={() => import('./GameCanvas')}
      componentProps={props}
      fallback={null}
    />
  );
}

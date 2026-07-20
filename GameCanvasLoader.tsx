import { Platform } from 'react-native';
import type { GameCanvasProps } from './GameCanvas';

/**
 * App.tsx must never statically `import` anything from GameCanvas.tsx (which
 * pulls in @shopify/react-native-skia), because on web that module has to
 * finish loading CanvasKit (an async wasm fetch) before Skia's own code is
 * evaluated -- importing it eagerly breaks Skia's internal CanvasKit binding.
 * This loader defers that import until after LoadSkiaWeb() resolves (web) or
 * just renders it directly (native, where this restriction doesn't apply).
 */
export default function GameCanvasLoader(props: GameCanvasProps) {
  if (Platform.OS !== 'web') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const GameCanvas = require('./GameCanvas').default;
    return <GameCanvas {...props} />;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WithSkiaWeb } = require('@shopify/react-native-skia/lib/module/web');
  return (
    <WithSkiaWeb
      getComponent={() => import('./GameCanvas')}
      componentProps={props}
      fallback={null}
    />
  );
}

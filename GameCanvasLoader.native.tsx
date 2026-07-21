import GameCanvas from './GameCanvas';
import type { GameCanvasProps } from './GameCanvas';

/** Native Skia is bundled with the app; CanvasKit is a web-only concern. */
export default function GameCanvasLoader(props: GameCanvasProps) {
  return <GameCanvas {...props} />;
}

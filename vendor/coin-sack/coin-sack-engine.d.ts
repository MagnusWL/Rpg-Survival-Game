/**
 * Types for the kit's engine, which ships as plain JavaScript.
 *
 * Written beside it rather than into it. `coin-sack-engine.js` is a copy of
 * someone else's work and is kept byte-identical to the kit it came in, so
 * anything this project needs from it lives in a file next to it instead.
 *
 * Only the parts the game actually calls are declared. The engine has a good
 * deal more on it -- earlier styles, its own drawing helpers -- none of which
 * is ours to reach into.
 */
export declare class CoinSack {
  constructor(canvas: HTMLCanvasElement, options: Record<string, unknown>);

  /** One coin drops in, with its sound. Call once per coin the player earns. */
  addCoin(): void;
  /** Lifts the top n coins out with a ka-ching. Returns how many it managed. */
  spendCoins(n: number): number;
  /** Clears the sack and puts its own count back to zero. */
  reset(): void;
  /** Stops the animation and releases the physics. Must be called on teardown. */
  destroy(): void;
  /** Call when the canvas box changes size. */
  _resize(): void;
  /**
   * Builds the audio context. Has to happen inside a real user gesture, since
   * the engine otherwise builds it at birth, long before anyone has touched
   * anything, and browsers leave it suspended without saying so.
   */
  _ensureAudio(): void;

  /**
   * The engine's own mute, from its options. It gates the clink, the spend
   * and the chime -- but not the flip and landing samples, so muting for real
   * also means suspending the audio context below.
   */
  soundOn: boolean;

  readonly audio?: { state: string; resume(): Promise<void>; suspend(): Promise<void> };
  readonly _sampleBufs?: unknown[];
}

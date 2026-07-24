/**
 * Types for the Cranium kit's engine, which ships as plain JavaScript.
 *
 * Written beside it rather than into it. `coin-sack-engine.js` is a copy of
 * the kit's file and is kept byte-identical to it, so anything this project
 * needs from it lives in a file next to it instead.
 *
 * The engine is the coin sack's, one revision on: the artwork's interior is a
 * parameter now (`geometry: 'skull'` for the cranium), which is the whole of
 * the difference the game can see. Only the parts the game actually calls are
 * declared.
 */
export declare class CoinSack {
  constructor(canvas: HTMLCanvasElement, options: Record<string, unknown>);

  /** One coin drops in, with its sound. Call once per coin the player earns. */
  addCoin(): void;
  /** Lifts the top n coins out with a ka-ching. Returns how many it managed. */
  spendCoins(n: number): number;
  /** Clears the cranium and puts its own count back to zero. */
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
   * The engine's own mute, from its options. Same three gates as the sack
   * before it -- the clink, the spend and the chime -- and the same two holes:
   * the flip and landing samples ignore it, so muting for real also means
   * suspending the audio context below.
   */
  soundOn: boolean;

  readonly audio?: { state: string; resume(): Promise<void>; suspend(): Promise<void> };
  readonly _sampleBufs?: unknown[];
}

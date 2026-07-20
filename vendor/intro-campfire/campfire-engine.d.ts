/**
 * Types for the campfire kit. Written beside the engine rather than in it, so
 * the engine stays the file that was handed over.
 *
 * The canvas wants `mix-blend-mode: screen` over the background: the class only
 * ever adds light, and screen is what keeps it from washing the scene flat.
 */
export type PixelCampfireOptions = {
  canvas: HTMLCanvasElement;
  /** The background's native size, which the fire uses to find the woodpile. */
  bgWidth?: number;
  bgHeight?: number;
  fireX0?: number;
  fireBaseY0?: number;
  fireW0?: number;
  fireH0?: number;
  baseCELL?: number;
  fireSize?: number;
  fireOffsetX?: number;
  fireOffsetY?: number;
  glowIntensity?: number;
  glowPulse?: number;
  glowPulseSpeed?: number;
};

export class PixelCampfire {
  constructor(opts: PixelCampfireOptions);
  /** Stops the animation frame chain. Without it the fire outlives the card. */
  destroy(): void;
}

/**
 * Types for the monster's eyes. Written beside the engine rather than in it, so
 * the engine stays the file that was handed over.
 *
 * The canvas wants `mix-blend-mode: screen`: this only adds light.
 *
 * The eye positions are in the background's own pixels and are already set for
 * this artwork. A different picture means new positions -- the kit says so.
 */
export type MonsterEyesOptions = {
  canvas: HTMLCanvasElement;
  bgWidth?: number;
  bgHeight?: number;
  eyes?: { x: number; y: number; r: number }[];
  eyesOn?: boolean;
  eyeColor?: string;
  glowIntensity?: number;
  glowSize?: number;
  pulseAmount?: number;
  pulseSpeed?: number;
};

export class MonsterEyes {
  constructor(opts: MonsterEyesOptions);
  /** Stops the animation frame chain. */
  destroy(): void;
}

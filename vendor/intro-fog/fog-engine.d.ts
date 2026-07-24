/**
 * Types for the fog. Written beside the engine rather than in it, so the engine
 * stays the file that was handed over.
 *
 * Unlike the other two intro effects this one takes an ordinary blend, not
 * screen: the fog is meant to veil the valley rather than light it.
 *
 * fogCenterY and fogHeight are in the background's own pixels.
 */
export type PixelFogOptions = {
  canvas: HTMLCanvasElement;
  bgWidth?: number;
  bgHeight?: number;
  fogOn?: boolean;
  fogOpacity?: number;
  fogSpeed?: number;
  fogDensity?: number;
  pixelSize?: number;
  fogColor?: string;
  fogCenterY?: number;
  fogHeight?: number;
};

export class PixelFog {
  constructor(opts: PixelFogOptions);
  /** Stops the animation frame chain. */
  destroy(): void;
}

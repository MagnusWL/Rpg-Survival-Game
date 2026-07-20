/**
 * Types for the kit's tear button, which ships as plain JavaScript inside an
 * HTML page. Written beside the extracted class rather than into it, so that
 * file can stay a verbatim copy.
 *
 * Only what the game calls is declared.
 */
export declare class RescueTearButton {
  constructor(opts: {
    canvas: HTMLCanvasElement;
    /** URL of the plaque PNG. The canvas draws it; nothing else should. */
    buttonSrc: string;
    mode?: 'horizontal' | 'v';
    /** Blood pixel size. 3 is the kit's choice. */
    grid?: number;
    dense?: boolean;
    width: number;
    height: number;
    buttonRect: { x: number; y: number; w: number; h: number };
    /** Where the title twinkles, or null for no sparkles. */
    logoRect?: { x0: number; y0: number; x1: number; y1: number } | null;
    /** False leaves it torn, which is what a real navigation wants. */
    autoReset?: boolean;
    /** Fires the moment the tear STARTS, not when it finishes. */
    onTear?: () => void;
  });

  /** Starts the tear. Does nothing if one is already running. */
  fire(): void;
  reset(): void;
  replay(): void;
}

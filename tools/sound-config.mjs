/**
 * Shared settings for the sound pipeline.
 *
 * Both build-sounds.mjs and build-eq-tool.mjs read from here, so the preview
 * page and the files that ship can never drift apart.
 */

export const RATE = 48000;

/**
 * Low enough to keep the quiet head of a transient and the reverb tail. At
 * -50 dB the very front of the sword strike was being clipped off.
 */
export const SILENCE_THRESHOLD = '-60dB';

/**
 * Peak to normalise to. This is PEAK normalisation -- one constant multiplier
 * per file, which cannot change the shape of the sound.
 *
 * Deliberately not loudnorm. That is EBU R128 broadcast normalisation, built
 * for speech and music over minutes, and it rides gain up and down as it goes.
 * Measured against its source, a loudnorm'd clip correlated at 0.08 with gain
 * wandering without bound, where a fixed gain correlates at 1.0000 and holds to
 * within 0.3 dB. It stopped sounding like the source because it no longer was.
 */
export const PEAK_DB = -3;

/**
 * Tone shaping, in dB, baked into the files. There is no runtime equaliser and
 * there cannot usefully be one: filters like these exist only in the browser,
 * so anything adjustable in-game would do nothing on a phone.
 *
 * Found by ear with `npm run build:eq`. Change here, then re-run build:sounds.
 */
export const EQ = { bass: 0.5, mid: 0, treble: -4 };

const PACK = 'Sword Combat Sound Effects Pack FREE VERSION/Main Sounds';

export const SOUNDS = [
  { out: 'attack-1', src: 'attack/WEAPSwrd_SwordStabwWhoosh_HoveAud_SwordCombat_01.wav' },
  { out: 'attack-2', src: 'attack/WEAPSwrd_SwordStabwWhoosh_HoveAud_SwordCombat_11.wav' },
  { out: 'attack-3', src: 'attack/WEAPSwrd_SwordStabwWhoosh_HoveAud_SwordCombat_17.wav' },
  // Heavier stab combos, saved for the blow that finishes an enemy off.
  { out: 'kill-1', src: `${PACK}/Sword Stabs/Full Stab Combo/WEAPSwrd_SwordStabCombo_HoveAud_SwordCombat_01.wav` },
  { out: 'kill-2', src: `${PACK}/Sword Stabs/Full Stab Combo/WEAPSwrd_SwordStabCombo_HoveAud_SwordCombat_11.wav` },
  { out: 'kill-3', src: `${PACK}/Sword Stabs/Full Stab Combo/WEAPSwrd_SwordStabCombo_HoveAud_SwordCombat_17.wav` },
];

/**
 * Strips leading and trailing quiet. Beyond size, this is a timing fix: the
 * 0.18 s of silence at the front would delay a swing past a fifth of its
 * animation. The tail is only cut once a full 0.1 s stays below the threshold,
 * so reverb survives.
 */
export function trimFilters() {
  return [
    `silenceremove=start_periods=1:start_threshold=${SILENCE_THRESHOLD}:start_silence=0.02`,
    'areverse',
    `silenceremove=start_periods=1:start_threshold=${SILENCE_THRESHOLD}:start_silence=0.1`,
    'areverse',
  ];
}

/**
 * The tone filters. These shapes are mirrored exactly by the Web Audio graph in
 * the preview page, so what you hear there is what gets baked:
 *
 *   bass   -> lowshelf  @ 100 Hz
 *   mid    -> peaking   @ 1200 Hz, 2 octaves wide
 *   treble -> highshelf @ 3000 Hz
 */
export function eqFilters(eq) {
  const out = [];
  if (eq.bass) out.push(`bass=g=${eq.bass}`);
  if (eq.mid) out.push(`equalizer=f=1200:width_type=o:width=2:g=${eq.mid}`);
  if (eq.treble) out.push(`treble=g=${eq.treble}`);
  return out;
}

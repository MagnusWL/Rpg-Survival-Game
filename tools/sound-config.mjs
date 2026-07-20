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
 * Peak every clip is normalised to, in dBFS. This is PEAK normalisation -- one
 * constant multiplier per file, which cannot change the shape of the sound.
 *
 * Deliberately not loudnorm. That is EBU R128 broadcast normalisation, built
 * for speech and music over minutes, and it rides gain up and down as it goes.
 * Measured against its source, a loudnorm'd clip correlated at 0.08 with gain
 * wandering without bound, where a fixed gain correlates at 1.0000 and holds to
 * within 0.3 dB. It stopped sounding like the source because it no longer was.
 *
 * The playing level is baked in here rather than set at runtime. iOS browsers
 * refuse programmatic volume outright -- Apple reserves it for the hardware
 * buttons -- so a runtime setting was silently ignored there and everything
 * played at full blast. Same reasoning as the EQ: what the browser will not let
 * us do while playing, we do beforehand.
 *
 * -7.4 dB is the old -3 dB peak times the 0.6 volume this used to be played at,
 * since 20*log10(0.6) is -4.4 dB.
 */
export const PEAK_DB = -7.4;

/**
 * Tone shaping, in dB, baked into the files. There is no runtime equaliser and
 * there cannot usefully be one: filters like these exist only in the browser,
 * so anything adjustable in-game would do nothing on a phone.
 *
 * Found by ear with `npm run build:eq`. Change here, then re-run build:sounds.
 */
export const EQ = { bass: 0.5, mid: 0, treble: -4 };

const PACK = 'Sword Combat Sound Effects Pack FREE VERSION/Main Sounds';

/**
 * Every clip lands on PEAK_DB unless it carries a `level`, which nudges it in dB
 * from there. That is how sounds get balanced against each other -- a swing that
 * fires constantly wants to sit under a hurt that has to cut through.
 *
 * A clip can also carry its own `eq`, replacing the shared one above. Most want
 * the house treatment; the odd one arrives with a balance of its own.
 *
 * A `group` levels several clips as one. Normalising each file separately makes
 * every clip equally loud, which is right when they are alternatives and wrong
 * when they are a set: footsteps were rendered with their loudness differences
 * deliberately left in, and flattening them would undo that work. Clips in a
 * group share one gain, set by the loudest of them, so the differences survive.
 *
 * Adjust here rather than in the game. There is no runtime volume any more.
 */
export const SOUNDS = [
  { out: 'attack-1', src: 'attack/WEAPSwrd_SwordStabwWhoosh_HoveAud_SwordCombat_01.wav' },
  { out: 'attack-2', src: 'attack/WEAPSwrd_SwordStabwWhoosh_HoveAud_SwordCombat_11.wav' },
  { out: 'attack-3', src: 'attack/WEAPSwrd_SwordStabwWhoosh_HoveAud_SwordCombat_17.wav' },
  // Heavier stab combos, saved for the blow that finishes an enemy off.
  { out: 'kill-1', src: `${PACK}/Sword Stabs/Full Stab Combo/WEAPSwrd_SwordStabCombo_HoveAud_SwordCombat_01.wav` },
  { out: 'kill-2', src: `${PACK}/Sword Stabs/Full Stab Combo/WEAPSwrd_SwordStabCombo_HoveAud_SwordCombat_11.wav` },
  { out: 'kill-3', src: `${PACK}/Sword Stabs/Full Stab Combo/WEAPSwrd_SwordStabCombo_HoveAud_SwordCombat_17.wav` },

  // The same three takes with gore layered in. Drawn from the same pool as the
  // clips above, and whenever one of these is the one that plays, the game
  // throws extra blood to match it.
  { out: 'gore-1', src: `${PACK}/Sword Stabs/w_Gore/GOREStab_SwordStabGore_HoveAud_SwordCombat_01.wav` },
  { out: 'gore-2', src: `${PACK}/Sword Stabs/w_Gore/GOREStab_SwordStabGore_HoveAud_SwordCombat_11.wav` },
  { out: 'gore-3', src: `${PACK}/Sword Stabs/w_Gore/GOREStab_SwordStabGore_HoveAud_SwordCombat_17.wav` },

  // The knight taking a hit: a blade turned by his armour. Add more variants
  // here as hurt-2, hurt-3 and so on, then add a matching useAudioPlayer line
  // to hurtSounds in App.tsx.
  { out: 'hurt-1', src: 'deffend/620355__marb7e__whooshsword_hit-armor.wav' },

  // Steel leaving the scabbard, for the entrance.
  //
  // Its own EQ and a level of its own, because it arrives nothing like the
  // rest: 98% of its energy sits above 3 kHz, against 73% for a sword swing,
  // and it is 30 dB more treble-tilted than anything else in the game. It is a
  // metallic scrape with no body at all, so the house EQ leaves it shrill.
  //
  // The treble can only come down so far -- there is no bass underneath to
  // reveal -- so it also plays quieter than everything else.
  {
    out: 'draw',
    src: 'sword sounds/draw sword.wav',
    eq: { bass: 0, mid: 0, treble: -11 },
    level: -7,
  },

  // His boots. These are not raw recordings like everything else above -- they
  // were cut out of a longer take and balanced against each other by ear in
  // footstep-tuner.html, so they arrive finished. Hence the group, which keeps
  // that balance, and hence no EQ: the tone was decided in the tuner, and the
  // house treatment would talk over it.
  //
  // Quiet on purpose. Two of these land every second for as long as anyone is
  // moving, so they have to sit under the swords rather than beside them.
  // What a footfall is made of: the ground under his boot, and his armour
  // moving on top of it. Two separate sounds played together, which is how the
  // pack ships them and why -- six grounds against eleven rattles make sixty-six
  // different footfalls, where combining them beforehand would make eleven.
  //
  // Dry and wet share one group. The pack levelled them together on a single
  // gain, and levelling them apart would take out the difference it put in.
  //
  // Both the ground and the armour went up a fifteenth on 2026-07-20, which is
  // +1.2 dB -- moved together, so the armour stays exactly 10 dB under the step.
  ...Array.from({ length: 6 }, (_, i) => ({
    out: `footstep-${i + 1}`,
    src: `footsteps sound/Amor walk 1/footsteps/footstep-${i + 1}.wav`,
    group: 'steps',
    level: -8.8,
    eq: { bass: 0, mid: 0, treble: 0 },
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    out: `puddle-${i + 1}`,
    src: `footsteps sound/Amor walk 1/puddles/puddle-${i + 1}.wav`,
    group: 'steps',
    level: -8.8,
    eq: { bass: 0, mid: 0, treble: 0 },
  })),

  /**
   * The armour, which is the point of the whole layer -- a knight in plate does
   * not walk quietly, and it is what tells you it is him rather than anyone.
   *
   * Its own group, and a level of its own. In the recordings it sits about 20 dB
   * under the step, which is where it was buried: 10 dB under is what makes it
   * a sound rather than a suspicion. Raise this number if it should be heavier
   * still -- it is the only place armour loudness is decided.
   *
   * Eleven of the twelve. The twelfth is 3.5 s of sustained wash rather than a
   * rattle, which is not what a footfall wants.
   */
  ...Array.from({ length: 11 }, (_, i) => ({
    out: `armour-${i + 1}`,
    src: `footsteps sound/Amor walk 1/effects/effect-${i + 1}.wav`,
    group: 'armour',
    level: -18.8,
    eq: { bass: 0, mid: 0, treble: 0 },
  })),

  // Pressing RESCUE HER on the menu. All four sound at once, which is why they
  // sit 6 dB down: four uncorrelated sounds together land about 6 dB above any
  // one of them, so this puts the pile where a single clip would have been.
  //
  // Three arrived as long takes with the wanted part at the front, and said so
  // in their filenames rather than their length -- "the first two seconds" on a
  // sixty-nine second file is an instruction. Clipped accordingly. The fourth
  // came ready.
  {
    out: 'menu-press-1',
    src: 'menu/492254__soundflakes__tyrael-sword-slice-flesh-02.wav',
    group: 'menu',
    level: -6,
  },
  {
    out: 'menu-press-2',
    src: 'menu/første 2 sekunder.wav',
    clip: { to: 2 },
    group: 'menu',
    level: -6,
  },
  {
    out: 'menu-press-3',
    src: 'menu/2 sekunder fade ud.wav',
    clip: { to: 2, fade: 0.6 },
    group: 'menu',
    level: -6,
  },
  {
    // Discrete hits with silence between them; the first is all of it that is
    // wanted, and it is over inside a second.
    out: 'menu-press-4',
    src: 'menu/første bid af lyd.wav',
    clip: { to: 1.2 },
    group: 'menu',
    level: -6,
  },
];

// --- Music ---------------------------------------------------------------
// Handled quite differently from the effects. A sword hit is half a second and
// survives being shipped uncompressed; a two-and-a-half minute track does not,
// so music is the one place a lossy codec earns its keep. 128 kbps MP3 plays
// everywhere and is far more than background music needs.
//
// Memory is not a worry here: expo-audio uses an HTML audio element on web and
// the platform players on native, so tracks stream rather than being unpacked
// whole. Decoded in full, these two would have cost about 100 MB.
export const MUSIC_BITRATE = '128k';

/**
 * Average level music is normalised to, in dB.
 *
 * Averages, not peaks. A hit is a spike -- loud peak, quiet average -- while
 * music is dense, so matching their peaks would leave the music sitting on top
 * of everything. Raw, these tracks average -14.7 dB against the effects' -22.9,
 * i.e. already louder. -32 puts them roughly 10 dB under.
 */
export const MUSIC_RMS_DB = -32;

export const MUSIC = [
  { out: 'menu', src: 'Music/01 The Legend of Drakewood Castle.wav' },
  { out: 'game', src: 'Music/04 Dungeon Crawl.wav' },
];

/**
 * Weather, which rides the music pipeline rather than the effects one: it is
 * long, it wants to be quiet, and it has to stream instead of being unpacked
 * whole. Under the music on purpose -- it is the room, not an event.
 */
/**
 * Down from -40 in two steps, both by ear: halved to -46, then another fifth
 * off to -48.
 *
 * It was drowning things. The armour layered into every footstep sits about
 * 10 dB under the step it rides on, and rain running constantly at -40 dB
 * average sat right on top of it -- broadband noise being the most effective
 * masker there is. Percentages are amplitude here, so halving is -6 dB and a
 * fifth off is -1.9.
 */
export const AMBIENCE_RMS_DB = -48;

/**
 * A stretch cut out of the recording and folded back on itself so it loops.
 *
 * `from`/`to` pick the stretch. The rain field recording runs 105 seconds and
 * cannot be used whole: it eases off as it goes -- the last ten seconds average
 * 5 dB below the first -- so a loop of all of it would sink and then jump. It
 * also has a thunderclap at 30-35 s, 23 dB above its own average, which would
 * come round like clockwork. 35-60 s is even to within 2 dB and has neither.
 *
 * `crossfade` folds the last seconds back over the first, so where the loop
 * meets itself there is nothing to hear. Faded with an equal-power curve rather
 * than a straight line, since two uncorrelated stretches of rain summed on a
 * straight fade dip in the middle.
 */
export const AMBIENCE = [
  {
    out: 'rain',
    src: 'Lyde/Weather/316896__alexkandrell__heavy_rain_thunder_uk_cambridge.wav',
    from: 35,
    to: 60,
    crossfade: 3,
  },
];

/**
 * Takes a piece off the front of a recording, optionally fading it out.
 *
 * For sources that are long takes with the wanted sound at the start -- the
 * menu press arrived as three files of 50 to 70 seconds whose names say which
 * part to use. Runs before the silence trim, so "the first two seconds" means
 * two seconds of the file and any quiet inside that still comes off.
 */
export function clipFilters(clip) {
  if (!clip) return [];
  const out = [`atrim=0:${clip.to}`, 'asetpts=PTS-STARTPTS'];
  if (clip.fade) out.push(`afade=t=out:curve=qsin:st=${clip.to - clip.fade}:d=${clip.fade}`);
  return out;
}

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

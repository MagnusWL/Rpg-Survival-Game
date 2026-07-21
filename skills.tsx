import { memo } from 'react';
import { Dimensions, Image, StyleSheet, View } from 'react-native';
import { ANIMS, dist, frameStartTime, Mob, normalizeAngle, Vec } from './combat';

// Screen/play-area dimensions, recomputed here rather than imported from
// App.tsx -- see the note in combat.ts. Only used below to size the cone's
// range and its drawn zone.
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const TOP_BAR_HEIGHT = 50;
const QUICK_CAST_BAR_HEIGHT = 48;
const HUD_HEIGHT = 60;
const PLAY_H = SCREEN_H - TOP_BAR_HEIGHT - QUICK_CAST_BAR_HEIGHT - HUD_HEIGHT;

export const ABILITY_MAX_LEVEL = 4;
export const CONE_RANGE = Math.hypot(SCREEN_W, PLAY_H);
export const ABILITY2_HALF_ANGLE_DEG = 21; // ~60% of the original 35deg half-angle

// --- The cone's zone, drawn (ours, Nicolai's ask of 20 July) ----------------
// The skill always fired invisibly. This shows the ground it actually covers:
// the true wedge, laid out as a carpet of small pixels that light up from the
// knight outward, hold, and dissolve. Decoration only -- the damage was
// instant before and stays instant, and these squares are the same cone the
// damage test uses, not an impression of it.
//
// The grid is the FIELD's, not the cast's: cells are picked off a screen-
// aligned lattice and only their membership depends on the angle. A grid
// built in the cone's own frame and rotated into place would draw diamonds
// at every facing but the four square ones.
//
// Built to the weather's lesson: the movement is CSS compiled through
// StyleSheet.create (inline keyframes silently do nothing), the carpet is a
// memo component whose props never change, and nothing ticks in JS -- the
// game loop only drops the entry when its time is up.
export const CONE_ZONE = {
  /**
   * How long one strike line's whole life lasts, from the front reaching it
   * to it having drifted away. Every line runs this same span, started at its
   * own distance-delay -- which is what makes the zone fade from the tip
   * outward rather than all at once: the near lines began first, so they
   * finish first. Nicolai's ask of 21 July.
   */
  cellLifeMs: 1500,
  /** How far a line drifts up as it dies. Four steps, so four whole pixels. */
  drift: 16,
  /**
   * px/s the wave runs outward at. Slower than the old bare ignition (1500),
   * because it now carries the hop and a wave has to be seen travelling to
   * read as one -- the far end is reached in about seven tenths of a second.
   */
  sweepSpeed: 1100,
  /**
   * The wave front is quantised to this. 15 ms at the speed above puts each
   * step about 16 px apart, so the front advances in something finer than
   * the pixels it moves -- coarser and the wave arrives in visible bands.
   */
  delayStepMs: 15,
  /**
   * The stadium wave, Nicolai's ask of 21 July: as the front reaches each
   * pixel it flares, leaps, and drops back with a second small bounce. One
   * wave, outward, once -- nothing repeats, and it costs nothing extra
   * because every pixel already knew when its turn was.
   *
   * The first attempt read as dead, and the arithmetic says why: a 5 px hop
   * cut into 8 steps moves the pixel 0.6 px at a time, which is less than
   * one pixel and so is no movement at all. The leaps below are whole
   * multiples of the pixel, cut into few enough steps that every step is at
   * least one pixel wide -- see CONE_HOPS.
   */
  hopSteps: 4,
};

/**
 * The cone's strike lines, baked. Eight arcs drawn once by
 * tools/build-cone-fx.mjs and shipped as a sheet -- 7 KB on disk, under a
 * megabyte in memory.
 *
 * This replaced four hundred and twenty separate squares, and the reason is
 * Nicolai's: tailoring every effect by hand until it is cheap enough is not a
 * way of working. The knight and the zombies are sheets so that nobody has to
 * think about what they cost, and an effect should be no different. Eight
 * pictures appearing in turn is the whole wave now.
 *
 * What is baked is the line rather than the whole wedge on purpose: unfolded,
 * the cone is 789 x 650 px, so a film of it is either forty megabytes or so
 * few frames that the wave crawls. A line is thin, there are eight of them,
 * and the travel then costs nothing at all.
 */
export const CONE_ARC_SHEET = require('./assets/sprites/fx/cone-arcs.png');
export const CONE_ARCS: { cellW: number; cellH: number; radii: number[] } = require('./assets/sprites/fx/cone-arcs.json');

/** How wide the whole baked sheet is, for sliding the wanted cell into view. */
export const CONE_ARC_SHEET_W = CONE_ARCS.cellW * CONE_ARCS.radii.length;

/**
 * How long a whole cast stays on the field: the wave's journey to the far
 * corner plus one pixel's life at the end of it, and a little slack. Derived
 * rather than written down, so changing the speed or the life cannot leave
 * the sweep cutting pixels off mid-drift.
 */
export const CONE_ZONE_MS =
  Math.round((CONE_RANGE / CONE_ZONE.sweepSpeed) * 1000) + CONE_ZONE.cellLifeMs + 80;

/**
 * The leaps, dealt out per GROUP of pixels rather than per pixel.
 *
 * This is the whole performance story of the effect. What a browser charges
 * for is not the pixel but the *animated layer*: every element with a
 * running animation is composited separately, every frame. Four hundred of
 * them cost Nicolai about 150 fps. Four hundred pixels arranged into forty
 * animated groups cost forty layers, and the pixels inside ride along for
 * free -- they are painted once and never touched again.
 *
 * A whole strike line therefore leaps as one thing. At 2 px that reads the
 * same, because a group is one arc: the eye was following the line, not the
 * individual squares.
 *
 * Every height is a whole number of pixels, and with 4 steps each one moves
 * at least a pixel per step, which is what makes the leap read at all. The
 * swell is gentle now for the same reason -- a whole arc growing 2.4x would
 * balloon out of the cone, where a single square just looked bright.
 */
export const CONE_HOPS = [
  { lift: 8, pop: 1.1 },
  { lift: 12, pop: 1.15 },
  { lift: 16, pop: 1.2 },
  { lift: 20, pop: 1.25 },
  { lift: 24, pop: 1.2 },
  { lift: 28, pop: 1.3 },
];
export const CONE_EDGE_HOPS = 2; // the first two belong to the scatter, not the lines

/**
 * One style per leap. Each carries its own keyframes because the height is
 * baked into them; the pixel picks a class and inherits its whole life.
 *
 * That life, in one animation: the front arrives and the pixel flares and
 * swells, rises, drops back, bounces once more -- and then, for the two
 * thirds of the time that remain, drifts slowly upward and fades out. The
 * drift and the fade live here rather than on the layer above precisely so
 * they inherit the pixel's own distance-delay: the tip of the cone began
 * first, so the tip dies first, and the fade travels outward exactly as the
 * strike did.
 */
export const coneHopStyles = StyleSheet.create(
  Object.fromEntries(
    CONE_HOPS.map((h, i) => [
      `h${i}`,
      {
        // Transforms inside keyframes must be written as CSS text. React
        // Native's array form -- transform: [{ translateY: -5 }] -- is
        // dropped on the floor here without a word, leaving empty keyframes
        // and a pixel that never moves. The rain writes strings too.
        animationKeyframes: [
          {
            '0%': { opacity: 0, transform: 'translateY(0px) scale(1)' },
            // The blow: brightest and biggest in the instant it lands.
            '3%': { opacity: 1, transform: `translateY(-${Math.round(h.lift * 0.3)}px) scale(${h.pop})` },
            '12%': { opacity: 1, transform: `translateY(-${h.lift}px) scale(${h.pop * 0.85})` },
            '22%': { opacity: 0.5, transform: 'translateY(0px) scale(1)' },
            '28%': { opacity: 0.5, transform: `translateY(-${Math.round(h.lift * 0.3)}px) scale(1.25)` },
            // Landed and dimmed to a trail, so the bright line is the front
            // alone and everything behind it is embers. The timing function
            // set HERE governs the interval that starts here -- the leap
            // above keeps its steps, while the long climb below runs smooth.
            // Stepping the climb read as stutter rather than as pixel art:
            // over a whole second, 4 steps is one jerk every quarter second,
            // which Nicolai saw immediately and took for lag.
            '34%': { opacity: 0.45, transform: 'translateY(0px) scale(1)', animationTimingFunction: 'linear' },
            '100%': { opacity: 0, transform: `translateY(-${CONE_ZONE.drift}px) scale(1)` },
          },
        ],
        animationDuration: `${CONE_ZONE.cellLifeMs}ms`,
        animationTimingFunction: `steps(${CONE_ZONE.hopSteps})`,
        animationFillMode: 'both',
      },
    ])
  ) as never
) as Record<string, object>;

/**
 * Ignition delays as a small bank of pre-compiled classes rather than inline
 * values: keyframes only compile through StyleSheet.create here, and keeping
 * the whole animation in one place means a cell carries nothing but its
 * position and colour.
 */
export const CONE_DELAY_BUCKETS = Math.ceil(((CONE_RANGE / CONE_ZONE.sweepSpeed) * 1000) / CONE_ZONE.delayStepMs) + 1;

export const coneZoneSheet = StyleSheet.create({
  // A plain frame now. The layer used to fade the whole zone out at once,
  // which made it vanish as a sheet; each pixel dies on its own clock
  // instead, so the dying sweeps outward from the tip the way the blow did.
  layer: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: PLAY_H,
    pointerEvents: 'none',
  },
  // One strike line: a window onto its cell of the baked sheet. This is the
  // only thing that animates, and there are eight of them.
  arc: {
    position: 'absolute',
    width: CONE_ARCS.cellW,
    height: CONE_ARCS.cellH,
    overflow: 'hidden',
  },
  // The sheet inside that window, slid so the wanted cell shows.
  arcSheet: {
    position: 'absolute',
    top: 0,
    width: CONE_ARC_SHEET_W,
    height: CONE_ARCS.cellH,
    // Square pixels stay square. The lines are pixel art and the layer is
    // rotated to the cast, which is exactly where a browser would otherwise
    // smooth them into mush.
    imageRendering: 'pixelated',
  },
  ...(Object.fromEntries(
    Array.from({ length: CONE_DELAY_BUCKETS }, (_, i) => [
      `d${i}`,
      { animationDelay: `${i * CONE_ZONE.delayStepMs}ms` },
    ])
  ) as Record<string, object>),
} as never) as Record<string, object>;

/**
 * The picture of the cast the ground answers on -- Nicolai's call: the 13th,
 * where the pose starts rocking before its long freeze. Read off the
 * choreography rather than written as a stopwatch value, so rewriting the
 * order moves the ground with it.
 */
export const RUPTURE_ZONE_FRAME = 12; // his 13th, counted from 0
export const RUPTURE_ZONE_DELAY_MS = Math.round(frameStartTime(ANIMS.rupture, RUPTURE_ZONE_FRAME) * 1000);

/**
 * Whether the cone's damage waits for the wave to reach each enemy, rather
 * than landing everywhere the instant the button is pressed.
 *
 * Nicolai's call of 21 July, and the one gameplay change in this effect: the
 * numbers are Magnus's untouched -- who is hit and for how much is still
 * decided by fireCone at the moment of the cast -- but a far enemy now takes
 * its blow up to 1.7 s later, and keeps swinging until it does. Set this to
 * false and every blow lands at once again, exactly as before.
 */
export const CONE_DAMAGE_RIDES_WAVE = true;

/** A blow the wave is carrying but has not delivered yet. */
export type PendingConeHit = { mobId: number; amount: number; at: number };

/**
 * One cast's zone: where he stood, which way he faced, and when the ground
 * should answer.
 *
 * That is the whole record now. It used to carry four hundred and twenty
 * hand-placed squares; the strike lines are a baked sheet, so all that is
 * left is the geometry. `startAt` holds the lines back until the pose reaches
 * its 13th picture -- a timer rather than a watch on the animation itself, so
 * a cast made on the run, where the pose is skipped entirely, still lights
 * the ground it hit.
 */
export type ConeZone = { id: number; x: number; y: number; angleDeg: number; startAt: number };

/**
 * The wave: eight baked lines laid out along the cast and lit in turn.
 *
 * The container is placed at the knight and turned to face the cast, so each
 * line only has to know how far out it belongs -- and since a line's distance
 * is also what decides when the front reaches it, the delay class and the
 * position come from the same number.
 *
 * Its props never change after mount, so React never reconciles it again, and
 * only eight elements are ever animated.
 */
export const ConeZoneFx = memo(function ConeZoneFx({ zone }: { zone: ConeZone }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: zone.x, top: zone.y, transform: [{ rotate: `${zone.angleDeg}deg` }] }}
    >
      {CONE_ARCS.radii.map((radius, i) => {
        const bucket = Math.min(
          CONE_DELAY_BUCKETS - 1,
          Math.round(((radius / CONE_ZONE.sweepSpeed) * 1000) / CONE_ZONE.delayStepMs)
        );
        // Dealt by distance rather than at random, so the leaps rise as the
        // wave travels instead of jumping about.
        const hop = CONE_EDGE_HOPS + (i % (CONE_HOPS.length - CONE_EDGE_HOPS));
        return (
          <View
            key={i}
            style={[
              coneZoneSheet.arc,
              coneHopStyles[`h${hop}`],
              coneZoneSheet[`d${bucket}`],
              // Right edge on the arc's own radius, centred across the cone.
              { left: radius - CONE_ARCS.cellW, top: -CONE_ARCS.cellH / 2 },
            ]}
          >
            <Image source={CONE_ARC_SHEET} style={[coneZoneSheet.arcSheet, { left: -i * CONE_ARCS.cellW }]} />
          </View>
        );
      })}
    </View>
  );
});
export const ABILITY3_HASTE_DURATION = 5;

// ---- Skill catalog ---------------------------------------------------------
// Six skills in a small tree: three roots the player starts owning, and one
// child under each that must be unlocked (parent at level >= 1) before it can
// be bought. Levels 1..4 are paid for from the main menu with gold; reaching
// level L costs SKILL_LEVEL_COST[L].
// Each root has two children: an active and a passive. Active skills go in the
// three quick-cast slots; passive skills go in the single passive slot.
export type SkillId =
  | 'summon' | 'cone' | 'ranged'
  | 'fireball' | 'burn' | 'push'
  | 'summonregen' | 'cdreduce' | 'pierce';
export const ALL_SKILLS: SkillId[] = [
  'summon', 'cone', 'ranged',
  'fireball', 'burn', 'push',
  'summonregen', 'cdreduce', 'pierce',
];
export const ROOT_SKILLS: SkillId[] = ['summon', 'cone', 'ranged'];
export const MAX_EQUIPPED = 3; // active skill slots
export const MAX_PASSIVE = 1; // passive skill slot

// How a skill behaves when it sits in an equipped slot in a run.
//   'instant' -- tap the button, it fires at once
//   'aim'     -- tap to arm, then tap/drag the field to aim, release to fire
//   'passive' -- no button; its effect is always on while equipped
export type SkillCast = 'instant' | 'aim' | 'passive';

export const SKILL_PARENT: Record<SkillId, SkillId | null> = {
  summon: null,
  cone: null,
  ranged: null,
  fireball: 'summon',
  summonregen: 'summon',
  burn: 'cone',
  cdreduce: 'cone',
  push: 'ranged',
  pierce: 'ranged',
};

// Colour per root tree: Summon is purple/blue, Cone is orange/red, Ranged is
// green/yellow. Each skill also carries an emoji icon for its button.
export const SKILL_META: Record<
  SkillId,
  { label: string; icon: string; color: string; cast: SkillCast; mana: number; cooldown: number }
> = {
  summon: { label: 'Summon', icon: '🧟', color: '#7e57c2', cast: 'instant', mana: 30, cooldown: 12 },
  cone: { label: 'Cone', icon: '🔻', color: '#ff8a50', cast: 'instant', mana: 20, cooldown: 5 },
  ranged: { label: 'Ranged', icon: '🏹', color: '#66bb6a', cast: 'instant', mana: 25, cooldown: 15 },
  fireball: { label: 'Fireball', icon: '☄️', color: '#5c6bc0', cast: 'instant', mana: 25, cooldown: 8 },
  burn: { label: 'Burn', icon: '🔥', color: '#ef5350', cast: 'instant', mana: 20, cooldown: 6 },
  push: { label: 'Push', icon: '💨', color: '#43a047', cast: 'instant', mana: 20, cooldown: 8 },
  summonregen: { label: 'Summon Regen', icon: '💜', color: '#42a5f5', cast: 'passive', mana: 0, cooldown: 0 },
  cdreduce: { label: 'Haste', icon: '⏱️', color: '#e53935', cast: 'passive', mana: 0, cooldown: 0 },
  pierce: { label: 'Pierce', icon: '🎯', color: '#fdd835', cast: 'passive', mana: 0, cooldown: 0 },
};

export function isPassiveSkill(skill: SkillId): boolean {
  return SKILL_META[skill].cast === 'passive';
}

// Gold to reach each level. Index by target level (1..4): 5, 10, 15, 20.
export const SKILL_LEVEL_COST = [0, 5, 10, 15, 20];
export function skillLevelCost(targetLevel: number): number {
  return SKILL_LEVEL_COST[targetLevel] ?? 0;
}

// The fireball off each summon, as a fraction of that summon's attack damage.
export function fireballDamagePercent(level: number): number {
  return [0, 1.0, 1.5, 2.0, 2.5][level] ?? 0;
}
export const FIREBALL_RADIUS = 95;
// The burning enemy's death blast, as a fraction of its max HP.
export function burnExplodePercent(level: number): number {
  return [0, 0.5, 0.6, 0.7, 1.0][level] ?? 0;
}
export const BURN_EXPLODE_RADIUS = 90;
// Burn also scorches the target itself for this much per second while it burns.
export function burnDamagePerSec(level: number): number {
  return [0, 5, 10, 15, 20][level] ?? 0;
}
// Push: fraction of the player's attack damage dealt as it shoves enemies off.
export function pushDamagePercent(level: number): number {
  return [0, 0.5, 1.0, 1.5, 2.0][level] ?? 0;
}
export const PUSH_SPEED = 620; // px/sec of outward shove, bled off by the knockback decay
// Passive Summon Regen: HP per second granted to each summon.
export function summonRegenPerSec(level: number): number {
  return level * 4;
}
// Passive Haste: fraction cut from every skill cooldown.
export function cooldownReducePercent(level: number): number {
  return [0, 0.2, 0.3, 0.4, 0.5][level] ?? 0;
}
// Passive Pierce: how many extra enemies each of the player's shots passes through.
export function pierceTargetCount(level: number): number {
  return level > 0 ? level : 0;
}
export const PIERCE_WIDTH = 26; // how close to the shot's line an enemy must be to be pierced

export type AbilityId = 1 | 2 | 3;
export type Ability = { skill: SkillId | null; level: number; cooldown: number };
export type Abilities = Record<AbilityId, Ability>;

export type Target = { kind: 'player' | 'ally' | 'mob'; id?: number; pos: Vec };

// A run carries its equipped passive skill (id + level) alongside the three
// active ability slots; passives have no button or cooldown.
export type PassiveState = { skill: SkillId; level: number } | null;

export function nearestTarget(from: Vec, targets: Target[], maxRange: number): Target | null {
  let best: Target | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    const d = dist(from, t.pos);
    if (d <= maxRange && d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

export function fireCone(
  origin: Vec,
  aimPoint: Vec,
  currentMobs: Mob[],
  baseDamage: number,
  damagePercent: number,
  range: number,
  halfAngleDeg: number
): { mobs: Mob[]; hits: { id: number; pos: Vec; amount: number }[] } {
  const dirAngle = (Math.atan2(aimPoint.y - origin.y, aimPoint.x - origin.x) * 180) / Math.PI;
  // `id` is ours, added so the wave can deliver each blow to the right mob
  // later. Everything else here is Magnus's, untouched -- who is hit and for
  // how much is still decided entirely by this function.
  const hits: { id: number; pos: Vec; amount: number }[] = [];
  const mobs = currentMobs.map((m) => {
    const d = dist(origin, m.pos);
    if (d <= range) {
      const mobAngle = (Math.atan2(m.pos.y - origin.y, m.pos.x - origin.x) * 180) / Math.PI;
      if (Math.abs(normalizeAngle(mobAngle - dirAngle)) <= halfAngleDeg) {
        const amount = baseDamage + m.maxHp * damagePercent;
        hits.push({ id: m.id, pos: { ...m.pos }, amount });
        return { ...m, hp: m.hp - amount };
      }
    }
    return m;
  });
  return { mobs, hits };
}

export function ability1Stats(level: number) {
  return { hp: 20 + (level - 1) * 15, damage: 4 + (level - 1) * 3 };
}

export function ability2BaseDamage(level: number) {
  return 10 * level;
}

export function ability2DamagePercent(level: number) {
  return 0.1 + (level - 1) * 0.05;
}

export function ability3DamageBonus(level: number) {
  return level * 4;
}

const ALL_LEVELS = [1, 2, 3, 4];

function levelBracket(values: (string | number)[]): string {
  return `(${values.join('/')})`;
}

export function skillDescription(skill: SkillId): string {
  if (skill === 'summon') {
    const hps = levelBracket(ALL_LEVELS.map((l) => ability1Stats(l).hp));
    const dmgs = levelBracket(ALL_LEVELS.map((l) => ability1Stats(l).damage));
    return `Summon: calls 1/2/3/4 allied mobs (at level 4: 2 melee, 2 ranged) that fight for you. HP ${hps}, DMG ${dmgs}.`;
  }
  if (skill === 'cone') {
    const bases = levelBracket(ALL_LEVELS.map((l) => ability2BaseDamage(l)));
    const pcts = levelBracket(ALL_LEVELS.map((l) => `${Math.round(ability2DamagePercent(l) * 100)}%`));
    return `Cone: deals ${bases} damage plus ${pcts} of each enemy's max HP in a widening cone toward where you aim.`;
  }
  if (skill === 'ranged') {
    const dmgs = levelBracket(ALL_LEVELS.map((l) => ability3DamageBonus(l)));
    return `Ranged: passively turns your attacks ranged, adding ${dmgs} damage. Tap to gain +50% attack speed for 5s.`;
  }
  if (skill === 'fireball') {
    const pcts = levelBracket(ALL_LEVELS.map((l) => `${Math.round(fireballDamagePercent(l) * 100)}%`));
    return `Fireball: a fireball explodes from every one of your summons, dealing ${pcts} of that summon's attack damage to nearby enemies. Needs Summon.`;
  }
  if (skill === 'burn') {
    const pcts = levelBracket(ALL_LEVELS.map((l) => `${Math.round(burnExplodePercent(l) * 100)}%`));
    return `Burn: set the closest enemy afire. When it dies it explodes, dealing ${pcts} of its max health to nearby enemies. Needs Cone.`;
  }
  if (skill === 'push') {
    const pcts = levelBracket(ALL_LEVELS.map((l) => `${Math.round(pushDamagePercent(l) * 100)}%`));
    return `Push: shove all enemies away from you, dealing ${pcts} of your attack damage. Needs Ranged.`;
  }
  if (skill === 'summonregen') {
    const regens = levelBracket(ALL_LEVELS.map((l) => `${summonRegenPerSec(l)}/s`));
    return `Summon Regen (passive): your summons regenerate ${regens} health. Needs Summon.`;
  }
  if (skill === 'cdreduce') {
    const pcts = levelBracket(ALL_LEVELS.map((l) => `${Math.round(cooldownReducePercent(l) * 100)}%`));
    return `Haste (passive): reduces the cooldown of all your skills by ${pcts}. Needs Cone.`;
  }
  const targets = levelBracket(ALL_LEVELS.map((l) => pierceTargetCount(l)));
  return `Pierce (passive): your shots pierce through ${targets} enemies. Needs Ranged.`;
}

export function skillStatsSuffix(skill: SkillId): string {
  const meta = SKILL_META[skill];
  if (meta.cast === 'passive') return `\nPassive · always on while equipped`;
  return `\nCost: ${meta.mana} MP  ·  Cooldown: ${meta.cooldown}s`;
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioPlayer, useAudioPlayer } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  GestureResponderEvent,
  Image,
  ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const TOP_BAR_HEIGHT = 50;
const QUICK_CAST_BAR_HEIGHT = 66;
const HUD_HEIGHT = 84;
const MENU_BAR_HEIGHT = 58;
const PLAY_H = SCREEN_H - TOP_BAR_HEIGHT - QUICK_CAST_BAR_HEIGHT - HUD_HEIGHT - MENU_BAR_HEIGHT;
const BAR_WIDTH = 80;

const PLAYER_RADIUS = 18;
const PLAYER_SPEED = 220; // px/sec

// --- Knight sprite sheets -------------------------------------------------
// Built by tools/build-sprites.mjs from the raw art in Grafik/Knight.
// Each sheet is a 15x8 grid: columns are animation frames, rows are facings.
const SPRITE_CELL = 128; // must match OUT_CELL in tools/build-sprites.mjs
const SPRITE_COLS = 15;
const SPRITE_ROWS = 8;

// How big the knight is drawn, independent of the art's resolution. Tune freely:
// at 128 the sheets render pixel-for-pixel, above that they upscale.
const PLAYER_SPRITE_SIZE = 128;

// How far below pos the sprite's bottom edge sits, i.e. where his feet land.
// Larger moves him down the screen. The art is not centred in its cell, so this
// cannot be derived -- it was eyeballed against the collision circle with a
// temporary slider. Well below the sprite's midpoint, because the knight only
// occupies the lower part of his 128px cell.
const PLAYER_SPRITE_FOOT_OFFSET = 49;

type AnimName = 'idle' | 'run' | 'attack' | 'hurt';

type AnimDef = {
  sheet: ImageSourcePropType;
  fps: number;
  /** Looping animations repeat forever; one-shots hold their last frame. */
  loop: boolean;
  /**
   * How many rows the sheet has. Characters use one per facing; effects have no
   * facings and spend their rows on variants instead.
   */
  rows?: number;
};

const ANIMS: Record<AnimName, AnimDef> = {
  idle: { sheet: require('./assets/sprites/knight/idle.png'), fps: 10, loop: true },
  run: { sheet: require('./assets/sprites/knight/run.png'), fps: 16, loop: true },
  attack: { sheet: require('./assets/sprites/knight/melee.png'), fps: 24, loop: false },
  hurt: { sheet: require('./assets/sprites/knight/takedamage.png'), fps: 22, loop: false },
};

// The zombie art arrives as loose frames per direction and is packed into the
// same 15x8 grid by tools/build-sprites.mjs, so it shares everything above.
type MobAnimName = 'walk' | 'attack' | 'attack2' | 'attack3';

const MOB_ANIMS: Record<MobAnimName, AnimDef> = {
  walk: { sheet: require('./assets/sprites/zombie/walk.png'), fps: 12, loop: true },
  attack: { sheet: require('./assets/sprites/zombie/attack.png'), fps: 16, loop: false },
  attack2: { sheet: require('./assets/sprites/zombie/attack2.png'), fps: 16, loop: false },
  attack3: { sheet: require('./assets/sprites/zombie/attack3.png'), fps: 16, loop: false },
};

/** Picked at random per swing, so a crowd of zombies does not attack in lockstep. */
const MOB_ATTACK_ANIMS: MobAnimName[] = ['attack', 'attack2', 'attack3'];

// --- Effects -------------------------------------------------------------
// Blood has no facings; tools/build-sprites.mjs packs its five variants as the
// sheet's rows, so choosing one is the same lookup as choosing a facing.
const BLOOD_VARIANTS = 5;
const BLOOD_ANIM: AnimDef = {
  sheet: require('./assets/sprites/effects/blood.png'),
  fps: 20,
  loop: false,
  rows: BLOOD_VARIANTS,
};
const BLOOD_ANIMS = { blood: BLOOD_ANIM };
const BLOOD_DURATION = SPRITE_COLS / BLOOD_ANIM.fps; // seconds
const BLOOD_SIZE = 128;

// Drawn the same size as the knight, both being human-sized. The foot offset is
// smaller because a mob's collision circle is smaller (14 against 18), and it
// comes from measurement rather than taste: the zombie leaves 19 px of empty
// cell below its feet where the knight leaves 17.
const MOB_SPRITE_SIZE = 128;
const MOB_SPRITE_FOOT_OFFSET = 44;

const animDuration = (a: AnimDef) => SPRITE_COLS / a.fps;

// --- Sound ---------------------------------------------------------------
// Built by tools/build-sounds.mjs from the raw pack in Lyde/. Tone shaping is
// baked into the files rather than applied here: mobile has no equaliser, so
// anything done at runtime would work on web only.
const SFX_VOLUME = 0.6;

/**
 * How often a killing blow gets the heavier stab combo instead of the ordinary
 * swing. Kept well below certainty on purpose: a flourish that fires on every
 * kill stops registering as one.
 */
const KILL_SFX_CHANCE = 0.3;

/**
 * How long after a swing begins before its sound plays.
 *
 * The melee animation spends its first five frames drawing the sword back and
 * only brings the blade round at frames 7-9, around 300 ms in. Firing at frame
 * zero put the sound on the wind-up, well before anything visibly happened.
 * The clips reach full level about 40 ms in, so starting here lands the body of
 * the sound across the visible strike.
 */
const SWING_SOUND_AT = 0.25; // seconds

/**
 * Shortest gap between two flinch animations.
 *
 * A flinch used to outrank everything and lasts 0.68 s, so under any real
 * pressure the knight never got to finish a swing: simulated against two mobs in
 * contact he landed 25 blows and visibly swung once, spending the rest of the
 * time twitching. With this and the mid-swing guard below, that goes back to
 * about two thirds of blows showing a swing.
 *
 * The hurt sound rides on the flinch, so this also sets how often he can be
 * heard taking a hit. Raise it to hear him less.
 */
const HURT_ANIM_MIN_GAP = 1.2; // seconds

/** Fire and forget. Audio is a garnish -- it must never break the game loop. */
function playSfx(player: AudioPlayer | undefined) {
  if (!player) return;
  try {
    // Rewind first: a finished clip will not restart from its own end.
    player.seekTo(0);
    player.play();
  } catch {
    // ignored on purpose
  }
}

/** Column of the sheet to draw. One-shots stop on the last frame rather than wrapping. */
function animColumn(a: AnimDef, animTime: number) {
  const frame = Math.floor(animTime * a.fps);
  return a.loop ? frame % SPRITE_COLS : Math.min(frame, SPRITE_COLS - 1);
}

// Row order going down each sheet is E, SE, S, SW, W, NW, N, NE -- one 45 degree
// step clockwise per row, starting at east. Established by driving the game and
// watching which way the knight actually ran, which is worth trusting over
// reading the art: the sword and shield extend along the facing direction, so a
// knight in profile has a WIDER silhouette than one seen head-on, and reasoning
// from the shapes gets east and north exactly backwards.
const SPRITE_ROW_FOR_EAST = 0;

/**
 * Which way to face when swinging, given everything within reach.
 *
 * Picks the nearest target, except that any target already lying in the
 * direction the knight faces wins outright. Without that, two enemies at
 * similar range trade places as "nearest" and he flips between them.
 *
 * Facing is cosmetic here -- the melee swing damages everything in its radius
 * regardless of where he looks -- so this only has to read naturally.
 */
function facingForTargets(from: Vec, targets: Vec[], current: number) {
  let best: Vec | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    if (facingFromDelta(t.x - from.x, t.y - from.y) === current) return current;
    const d = dist(from, t);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best ? facingFromDelta(best.x - from.x, best.y - from.y) : current;
}

function facingFromDelta(dx: number, dy: number) {
  // atan2 is 0 at east and grows clockwise on screen, since y points down --
  // the same direction the rows advance, so this adds rather than subtracts.
  const eighths = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return (((SPRITE_ROW_FOR_EAST + eighths) % SPRITE_ROWS) + SPRITE_ROWS) % SPRITE_ROWS;
}
const PLAYER_ATTACK_RANGE = 60;
const RANGED_ATTACK_RANGE = 240;
const PLAYER_ATTACK_COOLDOWN = 0.8; // sec
const PLAYER_BASE_DAMAGE = 8;

const MOB_RADIUS = 14;
const BOSS_RADIUS = 26;
const MOB_SPEED = 60; // px/sec
const MOB_ATTACK_RANGE = 40;
const MOB_RANGED_FIRE_RANGE = 170;
const MOB_ATTACK_COOLDOWN = 1.2;
const MOB_MAX_HP = 20; // wave 1 base
const MOB_DAMAGE = 5; // wave 1 base
const MOB_XP_REWARD = 15;
const BOSS_XP_REWARD = 120;

const WAVE_SPAWN_INTERVAL = 0.5; // sec between mob spawns within a wave
const MANA_REGEN_PER_SEC = 4;
const MANA_MAX = 100;

const ALLY_RADIUS = 12;
const ALLY_SPEED = 90;
const ALLY_ATTACK_RANGE = 50;
const ALLY_ENGAGE_RANGE = 200;
const ALLY_RANGED_ATTACK_RANGE = 160;
const ALLY_RANGED_ENGAGE_RANGE = 260;
const ALLY_ATTACK_COOLDOWN = 1.0;

const ABILITY_MAX_LEVEL = 4;
const ABILITY_MANA_COST: Record<1 | 2 | 3, number> = { 1: 30, 2: 20, 3: 25 };
const ABILITY_COOLDOWN_TIME: Record<1 | 2 | 3, number> = { 1: 12, 2: 5, 3: 15 };
const CONE_RANGE = Math.hypot(SCREEN_W, PLAY_H);
const ABILITY2_HALF_ANGLE_DEG = 21; // ~60% of the original 35deg half-angle
const ABILITY3_HASTE_DURATION = 5;

const PROJECTILE_SPEED = 700; // px/sec
const HIT_FLASH_DURATION = 150; // ms
const FLOATING_TEXT_DURATION = 700; // ms
const FLOATING_TEXT_RISE = 32; // px

const EQUIP_SLOTS = 3;
const BAG_SLOTS = 9;
const ITEM_SIZE = 24;
const ITEM_DESPAWN_MS = 10000;
const ITEM_PICKUP_RADIUS = PLAYER_RADIUS + 14;
const INV_DRAG_THRESHOLD = 14;

let mobIdCounter = 0;
let allyIdCounter = 0;
let projectileIdCounter = 0;
let hitFlashIdCounter = 0;
let bloodIdCounter = 0;
let itemIdCounter = 0;
let floatingTextIdCounter = 0;

type Vec = { x: number; y: number };

type MobType = 'melee' | 'ranged' | 'boss';

type Mob = {
  id: number;
  type: MobType;
  pos: Vec;
  hp: number;
  maxHp: number;
  damage: number;
  radius: number;
  attackCooldown: number;
  facing: number; // 0-7, same row order as the player
  anim: MobAnimName;
  animTime: number;
};

type Ally = {
  id: number;
  pos: Vec;
  hp: number;
  maxHp: number;
  damage: number;
  attackCooldown: number;
  ranged: boolean;
};

type Projectile = {
  id: number;
  from: Vec;
  to: Vec;
  createdAt: number;
  duration: number;
  color: string;
  damage: number;
  friendly: boolean; // true = player/ally shooting a mob; false = mob shooting player/ally
  targetKind: 'mob' | 'player' | 'ally';
  targetId: number;
};
type HitFlash = { id: number; pos: Vec; createdAt: number };
type BloodSplat = { id: number; pos: Vec; variant: number; createdAt: number };
type FloatingText = { id: number; text: string; pos: Vec; color: string; createdAt: number };

type AbilityId = 1 | 2 | 3;
type Ability = { level: number; cooldown: number };
type Abilities = Record<AbilityId, Ability>;

type Target = { kind: 'player' | 'ally' | 'mob'; id?: number; pos: Vec };

type ItemKind = 'dmg' | 'atkspd' | 'mana' | 'manaregen' | 'health' | 'healthregen';
type Item = { id: number; kind: ItemKind; level: number };
type GroundItem = { item: Item; pos: Vec; createdAt: number };
type Slot = Item | null;
type TooltipState = { key: string; text: string; x: number; y: number } | null;

const ITEM_DEFS: Record<
  ItemKind,
  { name: string; color: string; perLevel: number; format: (total: number) => string }
> = {
  dmg: { name: 'Blade', color: '#ff7043', perLevel: 2, format: (t) => `+${t} damage` },
  atkspd: { name: 'Gloves', color: '#ffca28', perLevel: 0.03, format: (t) => `+${Math.round(t * 100)}% attack speed` },
  mana: { name: 'Crystal', color: '#42a5f5', perLevel: 6, format: (t) => `+${t} max mana` },
  manaregen: { name: 'Sigil', color: '#26c6da', perLevel: 1, format: (t) => `+${t} mana regen/s` },
  health: { name: 'Armor', color: '#66bb6a', perLevel: 8, format: (t) => `+${t} max health` },
  healthregen: { name: 'Amulet', color: '#9ccc65', perLevel: 1, format: (t) => `+${t} health regen/s` },
};
const ITEM_KINDS: ItemKind[] = ['dmg', 'atkspd', 'mana', 'manaregen', 'health', 'healthregen'];

const MOB_TYPE_META: Record<MobType, { name: string; color: string; radius: number }> = {
  melee: { name: 'Melee', color: '#e05555', radius: MOB_RADIUS },
  ranged: { name: 'Ranged', color: '#ff9800', radius: MOB_RADIUS },
  boss: { name: 'Boss', color: '#ab47bc', radius: BOSS_RADIUS },
};

type PlayerState = {
  pos: Vec;
  target: Vec | null;
  hp: number;
  maxHp: number;
  mana: number;
  level: number;
  xp: number;
  xpToNext: number;
  attackCooldown: number;
  abilityPoints: number;
  hasteTimer: number;
  facing: number; // 0-7, which row of the sprite sheet to draw
  anim: AnimName;
  animTime: number; // seconds spent in the current animation
  /** Playback multiplier for the current animation; 1 is the sheet's own rate. */
  animSpeed: number;
};

function dist(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeAngle(deg: number) {
  let d = deg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function nearestTarget(from: Vec, targets: Target[], maxRange: number): Target | null {
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

function fireCone(
  origin: Vec,
  aimPoint: Vec,
  currentMobs: Mob[],
  baseDamage: number,
  damagePercent: number,
  range: number,
  halfAngleDeg: number
): { mobs: Mob[]; hits: { pos: Vec; amount: number }[] } {
  const dirAngle = (Math.atan2(aimPoint.y - origin.y, aimPoint.x - origin.x) * 180) / Math.PI;
  const hits: { pos: Vec; amount: number }[] = [];
  const mobs = currentMobs.map((m) => {
    const d = dist(origin, m.pos);
    if (d <= range) {
      const mobAngle = (Math.atan2(m.pos.y - origin.y, m.pos.x - origin.x) * 180) / Math.PI;
      if (Math.abs(normalizeAngle(mobAngle - dirAngle)) <= halfAngleDeg) {
        const amount = baseDamage + m.maxHp * damagePercent;
        hits.push({ pos: { ...m.pos }, amount });
        return { ...m, hp: m.hp - amount };
      }
    }
    return m;
  });
  return { mobs, hits };
}

function xpForLevel(level: number) {
  return 40 + (level - 1) * 25;
}

function ability1Stats(level: number) {
  return { hp: 20 + (level - 1) * 15, damage: 4 + (level - 1) * 3 };
}

function ability2BaseDamage(level: number) {
  return 10 * level;
}

function ability2DamagePercent(level: number) {
  return 0.1 + (level - 1) * 0.05;
}

function ability3DamageBonus(level: number) {
  return level * 4;
}

function rangedTargetCount(ability3Level: number) {
  return ability3Level >= 4 ? 2 : 1;
}

const ALL_LEVELS = [1, 2, 3, 4];

function levelBracket(values: (string | number)[]): string {
  return `(${values.join('/')})`;
}

function abilityDescription(id: AbilityId): string {
  if (id === 1) {
    const hps = levelBracket(ALL_LEVELS.map((l) => ability1Stats(l).hp));
    const dmgs = levelBracket(ALL_LEVELS.map((l) => ability1Stats(l).damage));
    return `Summon: calls 1/2/3/4 allied mobs (at level 4: 2 melee, 2 ranged) that fight for you. HP ${hps}, DMG ${dmgs}.`;
  }
  if (id === 2) {
    const bases = levelBracket(ALL_LEVELS.map((l) => ability2BaseDamage(l)));
    const pcts = levelBracket(ALL_LEVELS.map((l) => `${Math.round(ability2DamagePercent(l) * 100)}%`));
    return `Cone: deals ${bases} damage plus ${pcts} of each enemy's max HP in a widening cone toward where you aim.`;
  }
  const dmgs = levelBracket(ALL_LEVELS.map((l) => ability3DamageBonus(l)));
  return `Ranged: passively turns your attacks ranged, adding ${dmgs} damage (at level 4: hits 2 enemies at once). Tap to gain +50% attack speed for 5s.`;
}

function abilityStatsSuffix(id: AbilityId): string {
  return `\nCost: ${ABILITY_MANA_COST[id]} MP  ·  Cooldown: ${ABILITY_COOLDOWN_TIME[id]}s`;
}

function itemBonus(item: Item) {
  return ITEM_DEFS[item.kind].perLevel * item.level;
}

function itemTooltip(item: Item): string {
  const def = ITEM_DEFS[item.kind];
  return `${def.name} · iLvl ${item.level}\n${def.format(Math.round(itemBonus(item) * 100) / 100)}`;
}

function makeItem(kind: ItemKind, level: number): Item {
  itemIdCounter += 1;
  return { id: itemIdCounter, kind, level };
}

function mobHpForWave(wave: number) {
  return MOB_MAX_HP + (wave - 1) * 8;
}

function mobDamageForWave(wave: number) {
  return MOB_DAMAGE + Math.floor((wave - 1) * 1.5);
}

function mobCountForWave(wave: number) {
  return 4 + wave;
}

function bossTierForWave(wave: number) {
  return wave >= 10 && wave % 5 === 0 ? Math.floor((wave - 10) / 5) + 1 : 0;
}

function rangedCountForWave(wave: number) {
  if (wave < 3) return 0;
  return Math.min(Math.floor(mobCountForWave(wave) / 2), wave - 2);
}

function mobTypeStats(type: MobType, wave: number): { hp: number; damage: number } {
  const meleeHp = mobHpForWave(wave);
  const meleeDmg = mobDamageForWave(wave);
  if (type === 'melee') return { hp: meleeHp, damage: meleeDmg };
  if (type === 'ranged') return { hp: Math.round(meleeHp * 0.7), damage: meleeDmg };
  const tier = Math.max(1, bossTierForWave(wave));
  return { hp: 500 * tier + wave * 10, damage: 15 + tier * 6 };
}

// Composition of a wave, for the Mob Stats overlay
function waveComposition(wave: number): { type: MobType; count: number }[] {
  const total = mobCountForWave(wave);
  const ranged = rangedCountForWave(wave);
  const melee = total - ranged;
  const rows: { type: MobType; count: number }[] = [];
  if (melee > 0) rows.push({ type: 'melee', count: melee });
  if (ranged > 0) rows.push({ type: 'ranged', count: ranged });
  if (bossTierForWave(wave) > 0) rows.push({ type: 'boss', count: 1 });
  return rows;
}

function buildWaveQueue(wave: number): MobType[] {
  const total = mobCountForWave(wave);
  const ranged = rangedCountForWave(wave);
  const melee = total - ranged;
  const queue: MobType[] = [];
  for (let i = 0; i < melee; i++) queue.push('melee');
  for (let i = 0; i < ranged; i++) queue.push('ranged');
  // shuffle melee/ranged so ranged are mixed in
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  if (bossTierForWave(wave) > 0) queue.push('boss'); // boss arrives last
  return queue;
}

/**
 * Draws one frame of a sprite sheet: a clipping box with the sheet inside it,
 * shifted so the wanted cell lands in view.
 *
 * Every animation stays mounted and only the active one is made visible.
 * Swapping a single Image's source instead makes react-native-web reload it --
 * it renders the picture as a CSS background and clears that background while
 * the new one loads, even from cache -- and the frames in between draw nothing,
 * so the character blinks each time the animation changes.
 */
function SpriteSheet({
  anims,
  anim,
  animTime,
  facing,
  size,
  left,
  top,
}: {
  anims: Record<string, AnimDef>;
  anim: string;
  animTime: number;
  facing: number;
  size: number;
  left: number;
  top: number;
}) {
  return (
    <View style={{ position: 'absolute', width: size, height: size, overflow: 'hidden', left, top }}>
      {Object.entries(anims).map(([name, def]) => {
        const rows = def.rows ?? SPRITE_ROWS;
        return (
          <Image
            key={name}
            source={def.sheet}
            style={{
              position: 'absolute',
              // Drawn at native size, so one cell lands exactly on the clip box
              // and the art renders pixel-for-pixel.
              width: size * SPRITE_COLS,
              height: size * rows,
              left: -size * animColumn(def, animTime),
              top: -size * Math.min(facing, rows - 1),
              opacity: name === anim ? 1 : 0,
            }}
          />
        );
      })}
    </View>
  );
}

function makePlayer(): PlayerState {
  return {
    pos: { x: SCREEN_W / 2, y: PLAY_H - 80 },
    target: null,
    hp: 100,
    maxHp: 100,
    mana: MANA_MAX,
    level: 1,
    xp: 0,
    xpToNext: xpForLevel(1),
    attackCooldown: 0,
    abilityPoints: 1,
    hasteTimer: 0,
    facing: 4, // south, i.e. facing the camera
    anim: 'idle',
    animTime: 0,
    animSpeed: 1,
  };
}

function makeAbilities(): Abilities {
  return {
    1: { level: 0, cooldown: 0 },
    2: { level: 0, cooldown: 0 },
    3: { level: 0, cooldown: 0 },
  };
}

function spawnMob(type: MobType, wave: number): Mob {
  mobIdCounter += 1;
  const meta = MOB_TYPE_META[type];
  const stats = mobTypeStats(type, wave);
  const margin = meta.radius + 4;
  return {
    id: mobIdCounter,
    type,
    pos: { x: margin + Math.random() * (SCREEN_W - margin * 2), y: meta.radius },
    hp: stats.hp,
    maxHp: stats.hp,
    damage: stats.damage,
    radius: meta.radius,
    attackCooldown: 0,
    facing: 2, // south -- mobs spawn at the top edge walking down towards the player
    anim: 'walk',
    animTime: 0,
  };
}

function makeAlliesForLevel(level: number, origin: Vec): Ally[] {
  const count = level;
  const stats = ability1Stats(level);
  const result: Ally[] = [];
  for (let i = 0; i < count; i++) {
    allyIdCounter += 1;
    const offsetX = (i - (count - 1) / 2) * 36;
    const ranged = level === 4 && i >= 2;
    result.push({
      id: allyIdCounter,
      pos: { x: origin.x + offsetX, y: Math.max(ALLY_RADIUS, origin.y - 50) },
      hp: stats.hp,
      maxHp: stats.hp,
      damage: stats.damage,
      attackCooldown: 0,
      ranged,
    });
  }
  return result;
}

function spawnLoot(wave: number): GroundItem {
  const level = Math.max(1, wave + (Math.floor(Math.random() * 5) - 2));
  const kind = ITEM_KINDS[Math.floor(Math.random() * ITEM_KINDS.length)];
  const margin = 30;
  return {
    item: makeItem(kind, level),
    pos: {
      x: margin + Math.random() * (SCREEN_W - margin * 2),
      y: margin + Math.random() * (PLAY_H - margin * 2),
    },
    createdAt: Date.now(),
  };
}

function makeFloatingText(text: string, pos: Vec, color: string, now: number): FloatingText {
  floatingTextIdCounter += 1;
  return { id: floatingTextIdCounter, text, pos: { ...pos }, color, createdAt: now };
}

const DAMAGE_TEXT_COLOR = '#ffffff';
const TAKEN_TEXT_COLOR = '#ff5252';
const XP_TEXT_COLOR = '#ffd54f';

function equippedBonus(equipped: Slot[], kind: ItemKind) {
  let total = 0;
  for (const it of equipped) {
    if (it && it.kind === kind) total += itemBonus(it);
  }
  return total;
}

// ---- Run persistence ----

type RunSave = {
  id: string;
  savedAt: number;
  wave: number;
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  mana: number;
  abilityPoints: number;
  abilities: Abilities;
  equipped: Slot[];
  bag: Slot[];
  materials: number;
};

type GameState = {
  player: PlayerState;
  abilities: Abilities;
  equipped: Slot[];
  bag: Slot[];
  materials: number;
  wave: number;
};

const RUNS_STORAGE_KEY = 'rpg_runs_v1';

async function loadRuns(): Promise<RunSave[]> {
  try {
    const raw = await AsyncStorage.getItem(RUNS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RunSave[]) : [];
  } catch {
    return [];
  }
}

async function persistRuns(runs: RunSave[]) {
  try {
    await AsyncStorage.setItem(RUNS_STORAGE_KEY, JSON.stringify(runs));
  } catch {
    // best-effort; ignore storage failures
  }
}

function buildFreshState(): GameState {
  return {
    player: makePlayer(),
    abilities: makeAbilities(),
    equipped: new Array(EQUIP_SLOTS).fill(null),
    bag: new Array(BAG_SLOTS).fill(null),
    materials: 0,
    wave: 0,
  };
}

function buildTestState(): GameState {
  const base = makePlayer();
  const targetLevel = 10;
  let maxHp = base.maxHp;
  let abilityPoints = base.abilityPoints;
  for (let lvl = 2; lvl <= targetLevel; lvl++) {
    maxHp += 10;
    abilityPoints += 1;
  }
  const player: PlayerState = {
    ...base,
    level: targetLevel,
    xp: 0,
    xpToNext: xpForLevel(targetLevel),
    maxHp,
    hp: maxHp,
    abilityPoints,
  };
  const randomTestItem = () => makeItem(ITEM_KINDS[Math.floor(Math.random() * ITEM_KINDS.length)], Math.max(1, targetLevel + Math.floor(Math.random() * 5) - 2));
  const equipped: Slot[] = [randomTestItem(), randomTestItem(), randomTestItem()];
  const bag: Slot[] = new Array(BAG_SLOTS).fill(null);
  bag[0] = randomTestItem();
  bag[1] = randomTestItem();
  bag[2] = randomTestItem();
  return { player, abilities: makeAbilities(), equipped, bag, materials: 0, wave: targetLevel - 1 };
}

function buildStateFromSave(save: RunSave): GameState {
  const base = makePlayer();
  const player: PlayerState = {
    ...base,
    level: save.level,
    xp: save.xp,
    xpToNext: save.xpToNext,
    hp: save.hp,
    maxHp: save.maxHp,
    mana: save.mana,
    abilityPoints: save.abilityPoints,
  };
  return {
    player,
    abilities: save.abilities,
    equipped: save.equipped,
    bag: save.bag,
    materials: save.materials,
    wave: save.wave,
  };
}

export default function App() {
  const [screen, setScreen] = useState<'menu' | 'continue' | 'game'>('menu');
  const [savedRuns, setSavedRuns] = useState<RunSave[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [player, setPlayer] = useState<PlayerState>(makePlayer());
  const [mobs, setMobs] = useState<Mob[]>([]);
  const [allies, setAllies] = useState<Ally[]>([]);
  const [abilities, setAbilities] = useState<Abilities>(makeAbilities());
  const [aimingAbility, setAimingAbility] = useState<AbilityId | null>(null);
  const [aimPreviewPoint, setAimPreviewPoint] = useState<Vec | null>(null);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [hitFlashes, setHitFlashes] = useState<HitFlash[]>([]);
  const [bloodSplats, setBloodSplats] = useState<BloodSplat[]>([]);
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const [wave, setWave] = useState(0);
  const [waveActive, setWaveActive] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [groundItems, setGroundItems] = useState<GroundItem[]>([]);
  const [equipped, setEquipped] = useState<Slot[]>(new Array(EQUIP_SLOTS).fill(null));
  const [bag, setBag] = useState<Slot[]>(new Array(BAG_SLOTS).fill(null));
  const [materials, setMaterials] = useState(0);
  // Three sword variants picked at random, so a swing every 0.8 s does not turn
  // into an audible loop. One player each is enough: a clip runs 0.54 s and the
  // cooldown is longer, so a variant never has to overlap itself.
  const attackSounds = [
    useAudioPlayer(require('./assets/sounds/attack-1.wav')),
    useAudioPlayer(require('./assets/sounds/attack-2.wav')),
    useAudioPlayer(require('./assets/sounds/attack-3.wav')),
  ];

  // Heavier stab combos for a killing blow. These run 1.0-2.4 s against the
  // swing's 0.6, so each variant gets its own player and can ring out.
  const killSounds = [
    useAudioPlayer(require('./assets/sounds/kill-1.wav')),
    useAudioPlayer(require('./assets/sounds/kill-2.wav')),
    useAudioPlayer(require('./assets/sounds/kill-3.wav')),
  ];

  // The knight taking a hit, played with the flinch animation. Empty until the
  // clips are chosen -- the trigger is live and simply plays nothing, since
  // playSfx ignores a missing player. Add one useAudioPlayer line per file here
  // and the sound starts working; see the note in tools/sound-config.mjs.
  const hurtSounds: (AudioPlayer | undefined)[] = [];

  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [skillsMenuOpen, setSkillsMenuOpen] = useState(false);
  const [invMenuOpen, setInvMenuOpen] = useState(false);
  const [mobStatsOpen, setMobStatsOpen] = useState(false);
  const [dragging, setDragging] = useState<{ kind: ItemKind; level: number; x: number; y: number } | null>(null);
  const [, setTick] = useState(0);

  const playerRef = useRef(player);
  const mobsRef = useRef(mobs);
  const alliesRef = useRef(allies);
  const abilitiesRef = useRef(abilities);
  const projectilesRef = useRef(projectiles);
  const hitFlashesRef = useRef(hitFlashes);
  const bloodSplatsRef = useRef(bloodSplats);
  const floatingTextsRef = useRef(floatingTexts);
  const waveRef = useRef(wave);
  const waveActiveRef = useRef(waveActive);
  const gameOverRef = useRef(gameOver);
  const groundItemsRef = useRef(groundItems);
  const equippedRef = useRef(equipped);
  const bagRef = useRef(bag);
  const waveQueueRef = useRef<MobType[]>([]);
  // Wave numbers whose clear-reward loot hasn't dropped yet. Starting a new wave
  // before the field is clear leaves the previous wave's loot owed here.
  const lootOwedRef = useRef<number[]>([]);
  const materialsRef = useRef(materials);
  const screenRef = useRef(screen);
  // Any overlay (menu or tooltip) being open pauses the simulation.
  const overlayOpenRef = useRef(false);
  // The game loop is created once, so it reaches the players through a ref like
  // everything else it touches rather than closing over the first render's array.
  const attackSoundsRef = useRef(attackSounds);
  attackSoundsRef.current = attackSounds;
  const killSoundsRef = useRef(killSounds);
  killSoundsRef.current = killSounds;

  // A swing's sound is held back until the blade comes round. These carry that
  // pending sound between frames. They are refs rather than player state because
  // nothing about them belongs in a saved run.
  const swingSoundTimerRef = useRef(0);
  const swingSoundIsKillRef = useRef(false);
  const hurtSoundsRef = useRef(hurtSounds);
  hurtSoundsRef.current = hurtSounds;
  const hurtAnimGapRef = useRef(0);

  playerRef.current = player;
  mobsRef.current = mobs;
  alliesRef.current = allies;
  abilitiesRef.current = abilities;
  projectilesRef.current = projectiles;
  hitFlashesRef.current = hitFlashes;
  bloodSplatsRef.current = bloodSplats;
  floatingTextsRef.current = floatingTexts;
  waveRef.current = wave;
  waveActiveRef.current = waveActive;
  gameOverRef.current = gameOver;
  groundItemsRef.current = groundItems;
  equippedRef.current = equipped;
  bagRef.current = bag;
  materialsRef.current = materials;
  screenRef.current = screen;
  overlayOpenRef.current = skillsMenuOpen || invMenuOpen || mobStatsOpen || tooltip != null;

  // Run bookkeeping: which saved run (if any) is active, and whether this is a
  // throwaway test run that should never be persisted.
  const currentRunIdRef = useRef<string | null>(null);
  const isTestRunRef = useRef(false);

  const spawnTimerRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    loadRuns().then((runs) => {
      setSavedRuns(runs);
      setRunsLoaded(true);
    });
  }, []);

  // ---- Tooltip helpers ----
  const tooltipOpenedAtRef = useRef(0);
  const dismissTooltip = () => setTooltip(null);
  // Ignore the trailing click that immediately follows opening (it would otherwise
  // dismiss the tooltip on the same tap that opened it).
  const handleDismissOverlayPress = () => {
    if (Date.now() - tooltipOpenedAtRef.current > 250) dismissTooltip();
  };

  // Shows the tooltip anchored just above the element registered under `key`
  // (via registerSlot), rather than wherever the tap landed inside it.
  const showTooltipAboveKey = (key: string, text: string) => {
    if (tooltip && tooltip.key === key) {
      setTooltip(null);
      return;
    }
    tooltipOpenedAtRef.current = Date.now();
    const node = slotNodesRef.current[key];
    if (node && node.measureInWindow) {
      node.measureInWindow((x: number, y: number, w: number, h: number) => {
        slotRectsRef.current[key] = { x, y, w, h };
        setTooltip({ key, text, x: x + w / 2, y });
      });
    } else {
      const r = slotRectsRef.current[key];
      setTooltip({ key, text, x: r ? r.x + r.w / 2 : SCREEN_W / 2, y: r ? r.y : SCREEN_H / 2 });
    }
  };

  // ---- Inventory drag between slots ----
  const slotRectsRef = useRef<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const slotNodesRef = useRef<Record<string, any>>({});
  const dragRef = useRef<{ fromKey: string; item: Item; startX: number; startY: number; moved: boolean } | null>(null);

  const registerSlot = (key: string) => ({
    ref: (n: any) => {
      slotNodesRef.current[key] = n;
    },
    onLayout: () => {
      const n = slotNodesRef.current[key];
      if (n && n.measureInWindow) {
        n.measureInWindow((x: number, y: number, w: number, h: number) => {
          slotRectsRef.current[key] = { x, y, w, h };
        });
      }
    },
  });

  const itemAtKey = (key: string): Item | null => {
    if (key.startsWith('equip-')) return equippedRef.current[+key.slice(6)] ?? null;
    if (key.startsWith('bag-')) return bagRef.current[+key.slice(4)] ?? null;
    return null;
  };

  const keyAtPoint = (px: number, py: number): string | null => {
    for (const key of Object.keys(slotRectsRef.current)) {
      const r = slotRectsRef.current[key];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return key;
    }
    return null;
  };

  const commitInventory = (newEquipped: Slot[], newBag: Slot[]) => {
    equippedRef.current = newEquipped;
    bagRef.current = newBag;
    setEquipped(newEquipped);
    setBag(newBag);
  };

  const applyMove = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const newEquipped = equippedRef.current.slice();
    const newBag = bagRef.current.slice();
    const get = (key: string): Item | null =>
      key.startsWith('equip-') ? newEquipped[+key.slice(6)] : newBag[+key.slice(4)];
    const set = (key: string, val: Item | null) => {
      if (key.startsWith('equip-')) newEquipped[+key.slice(6)] = val;
      else newBag[+key.slice(4)] = val;
    };
    const a = get(fromKey);
    const b = get(toKey);
    set(fromKey, b);
    set(toKey, a);
    commitInventory(newEquipped, newBag);
  };

  const applySalvage = (fromKey: string, item: Item) => {
    const newEquipped = equippedRef.current.slice();
    const newBag = bagRef.current.slice();
    if (fromKey.startsWith('equip-')) newEquipped[+fromKey.slice(6)] = null;
    else newBag[+fromKey.slice(4)] = null;
    commitInventory(newEquipped, newBag);
    setMaterials((m) => m + item.level);
  };

  const handleSlotGrant = (key: string, e: GestureResponderEvent) => {
    const item = itemAtKey(key);
    if (!item) {
      dragRef.current = null;
      return;
    }
    dragRef.current = { fromKey: key, item, startX: e.nativeEvent.pageX, startY: e.nativeEvent.pageY, moved: false };
  };

  const handleSlotMove = (e: GestureResponderEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.nativeEvent.pageX - d.startX;
    const dy = e.nativeEvent.pageY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > INV_DRAG_THRESHOLD) {
      d.moved = true;
      dismissTooltip();
    }
    if (d.moved) {
      setDragging({ kind: d.item.kind, level: d.item.level, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
    }
  };

  const handleSlotRelease = (key: string, e: GestureResponderEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(null);
    if (!d) return;
    const item = itemAtKey(key);
    if (!d.moved) {
      if (item) showTooltipAboveKey(`slot-${key}`, itemTooltip(item));
      return;
    }
    const dropKey = keyAtPoint(e.nativeEvent.pageX, e.nativeEvent.pageY);
    if (dropKey === 'salvage') {
      applySalvage(d.fromKey, d.item);
    } else if (dropKey && (dropKey.startsWith('equip-') || dropKey.startsWith('bag-'))) {
      applyMove(d.fromKey, dropKey);
    }
  };

  // ---- Play area input ----
  const handlePlayAreaGrant = (e: GestureResponderEvent) => {
    if (gameOverRef.current) return;
    const { locationX, locationY } = e.nativeEvent;
    if (aimingAbility === 2) {
      setAimPreviewPoint({ x: locationX, y: locationY });
      return;
    }
    setPlayer((p) => ({ ...p, target: { x: locationX, y: locationY } }));
  };

  const handlePlayAreaMove = (e: GestureResponderEvent) => {
    if (gameOverRef.current || aimingAbility !== 2) return;
    const { locationX, locationY } = e.nativeEvent;
    setAimPreviewPoint({ x: locationX, y: locationY });
  };

  const handlePlayAreaRelease = (e: GestureResponderEvent) => {
    if (gameOverRef.current || aimingAbility !== 2) return;
    const { locationX, locationY } = e.nativeEvent;
    const p = playerRef.current;
    const ab = abilitiesRef.current[2];
    const cost = ABILITY_MANA_COST[2];
    setAimingAbility(null);
    setAimPreviewPoint(null);
    if (p.mana < cost) return;
    const baseDmg = ability2BaseDamage(ab.level);
    const dmgPercent = ability2DamagePercent(ab.level);
    const result = fireCone(p.pos, { x: locationX, y: locationY }, mobsRef.current, baseDmg, dmgPercent, CONE_RANGE, ABILITY2_HALF_ANGLE_DEG);
    setMobs(result.mobs);
    const now = Date.now();
    setFloatingTexts((prev) => prev.concat(result.hits.map((h) => makeFloatingText(`-${Math.round(h.amount)}`, h.pos, DAMAGE_TEXT_COLOR, now))));
    setPlayer((prev) => ({ ...prev, mana: prev.mana - cost }));
    setAbilities((prev) => ({ ...prev, 2: { ...prev[2], cooldown: ABILITY_COOLDOWN_TIME[2] } }));
  };

  const handleAbilityPress = (id: AbilityId) => {
    if (gameOverRef.current) return;
    const ab = abilitiesRef.current[id];
    const p = playerRef.current;
    if (ab.level <= 0 || ab.cooldown > 0) return;
    const cost = ABILITY_MANA_COST[id];
    if (p.mana < cost) return;

    if (id === 2) {
      if (aimingAbility === 2) {
        setAimingAbility(null);
        setAimPreviewPoint(null);
      } else {
        setAimingAbility(2);
        setAimPreviewPoint({ x: p.pos.x, y: 0 });
      }
      return;
    }

    if (id === 1) {
      setAllies(makeAlliesForLevel(ab.level, p.pos));
    } else if (id === 3) {
      setPlayer((prev) => ({ ...prev, hasteTimer: ABILITY3_HASTE_DURATION }));
    }

    setPlayer((prev) => ({ ...prev, mana: prev.mana - cost }));
    setAbilities((prev) => ({ ...prev, [id]: { ...prev[id], cooldown: ABILITY_COOLDOWN_TIME[id] } }));
  };

  const handleAbilityLevelUp = (id: AbilityId) => {
    if (gameOverRef.current) return;
    const p = playerRef.current;
    const ab = abilitiesRef.current[id];
    if (p.abilityPoints <= 0 || ab.level >= ABILITY_MAX_LEVEL) return;
    setPlayer((prev) => ({ ...prev, abilityPoints: prev.abilityPoints - 1 }));
    setAbilities((prev) => ({ ...prev, [id]: { ...prev[id], level: prev[id].level + 1 } }));
  };

  const handleStartNextWave = () => {
    if (gameOverRef.current || waveActiveRef.current) return;
    const nextWave = waveRef.current + 1;
    spawnTimerRef.current = 0;
    waveRef.current = nextWave;
    waveQueueRef.current = buildWaveQueue(nextWave);
    waveActiveRef.current = true;
    lootOwedRef.current.push(nextWave);
    setWave(nextWave);
    setWaveActive(true);
  };

  const applyGameState = (s: GameState) => {
    playerRef.current = s.player;
    mobsRef.current = [];
    alliesRef.current = [];
    abilitiesRef.current = s.abilities;
    projectilesRef.current = [];
    hitFlashesRef.current = [];
    bloodSplatsRef.current = [];
    floatingTextsRef.current = [];
    waveRef.current = s.wave;
    waveActiveRef.current = false;
    gameOverRef.current = false;
    groundItemsRef.current = [];
    equippedRef.current = s.equipped;
    bagRef.current = s.bag;
    waveQueueRef.current = [];
    lootOwedRef.current = [];
    materialsRef.current = s.materials;
    spawnTimerRef.current = 0;
    lastTimeRef.current = null;

    setPlayer(s.player);
    setMobs([]);
    setAllies([]);
    setAbilities(s.abilities);
    setAimingAbility(null);
    setAimPreviewPoint(null);
    setProjectiles([]);
    setHitFlashes([]);
    setBloodSplats([]);
    setFloatingTexts([]);
    setWave(s.wave);
    setWaveActive(false);
    setGameOver(false);
    setGroundItems([]);
    setEquipped(s.equipped);
    setBag(s.bag);
    setMaterials(s.materials);
    setTooltip(null);
    setSkillsMenuOpen(false);
    setInvMenuOpen(false);
    setMobStatsOpen(false);
    setDragging(null);
  };

  const handleStartNewRun = () => {
    currentRunIdRef.current = `run-${Date.now()}`;
    isTestRunRef.current = false;
    applyGameState(buildFreshState());
    setScreen('game');
  };

  const handleStartTestRun = () => {
    currentRunIdRef.current = null;
    isTestRunRef.current = true;
    applyGameState(buildTestState());
    setScreen('game');
  };

  const handleContinueRun = (save: RunSave) => {
    currentRunIdRef.current = save.id;
    isTestRunRef.current = false;
    applyGameState(buildStateFromSave(save));
    setScreen('game');
  };

  const handleBackToMenu = () => {
    setScreen('menu');
  };

  useEffect(() => {
    for (const s of [...attackSoundsRef.current, ...killSoundsRef.current, ...hurtSoundsRef.current]) {
      if (s) s.volume = SFX_VOLUME;
    }
  }, []);

  useEffect(() => {
    const step = (time: number) => {
      if (screenRef.current !== 'game' || gameOverRef.current || overlayOpenRef.current) {
        lastTimeRef.current = null;
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      if (lastTimeRef.current == null) lastTimeRef.current = time;
      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = time;
      const now = Date.now();

      let p = { ...playerRef.current };
      const currentMobs = mobsRef.current.map((m) => ({ ...m }));
      const currentAllies = alliesRef.current.map((a) => ({ ...a }));
      const newProjectiles: Projectile[] = [];
      const newFlashes: HitFlash[] = [];
      const newBlood: BloodSplat[] = [];
      const newFloatingTexts: FloatingText[] = [];

      const eq = equippedRef.current;
      const dmgBonus = equippedBonus(eq, 'dmg');
      const atkSpdBonusPct = equippedBonus(eq, 'atkspd');
      const manaBonus = equippedBonus(eq, 'mana');
      const manaRegenBonus = equippedBonus(eq, 'manaregen');
      const hpBonus = equippedBonus(eq, 'health');
      const hpRegenBonus = equippedBonus(eq, 'healthregen');
      const effectiveMaxMana = MANA_MAX + manaBonus;

      let damageToPlayer = 0;

      // Resolve in-flight projectiles: damage lands only on arrival
      const stillFlying: Projectile[] = [];
      for (const pr of projectilesRef.current) {
        if (now - pr.createdAt >= pr.duration) {
          if (pr.friendly && pr.targetKind === 'mob') {
            const target = currentMobs.find((m) => m.id === pr.targetId);
            if (target && target.hp > 0) target.hp -= pr.damage;
            newFloatingTexts.push(makeFloatingText(`-${Math.round(pr.damage)}`, pr.to, DAMAGE_TEXT_COLOR, now));
          } else if (!pr.friendly && pr.targetKind === 'player') {
            damageToPlayer += pr.damage;
            newFloatingTexts.push(makeFloatingText(`-${Math.round(pr.damage)}`, pr.to, TAKEN_TEXT_COLOR, now));
          } else if (!pr.friendly && pr.targetKind === 'ally') {
            const ally = currentAllies.find((a) => a.id === pr.targetId);
            if (ally) ally.hp -= pr.damage;
            newFloatingTexts.push(makeFloatingText(`-${Math.round(pr.damage)}`, pr.to, TAKEN_TEXT_COLOR, now));
          }
          newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...pr.to }, createdAt: now });
        } else {
          stillFlying.push(pr);
        }
      }

      // Player movement toward target
      let moving = false;
      if (p.target) {
        const d = dist(p.pos, p.target);
        if (d < 4) {
          p.target = null;
        } else {
          const dx = p.target.x - p.pos.x;
          const dy = p.target.y - p.pos.y;
          const step = PLAYER_SPEED * dt;
          const ratio = Math.min(1, step / d);
          p.pos = { x: p.pos.x + dx * ratio, y: p.pos.y + dy * ratio };
          p.facing = facingFromDelta(dx, dy);
          moving = true;
        }
      }

      // The animation itself is chosen further down, once this frame's attacks
      // and incoming damage are known.
      p.animTime += dt;

      p.pos.x = Math.max(PLAYER_RADIUS, Math.min(SCREEN_W - PLAYER_RADIUS, p.pos.x));
      p.pos.y = Math.max(PLAYER_RADIUS, Math.min(PLAY_H - PLAYER_RADIUS, p.pos.y));

      p.mana = Math.min(effectiveMaxMana, p.mana + (MANA_REGEN_PER_SEC + manaRegenBonus) * dt);
      p.hp = Math.min(p.maxHp + hpBonus, p.hp + hpRegenBonus * dt);
      p.attackCooldown = Math.max(0, p.attackCooldown - dt);
      p.hasteTimer = Math.max(0, p.hasteTimer - dt);

      // Ground item pickup (walk into it) -> first free equipped slot, else bag
      const unexpiredItems = groundItemsRef.current.filter((it) => now - it.createdAt < ITEM_DESPAWN_MS);
      let newEquipped: Slot[] | null = null;
      let newBag: Slot[] | null = null;
      const remainingItems: GroundItem[] = [];
      for (const it of unexpiredItems) {
        if (dist(p.pos, it.pos) <= ITEM_PICKUP_RADIUS) {
          const eqArr = newEquipped || equippedRef.current;
          const bagArr = newBag || bagRef.current;
          const ei = eqArr.indexOf(null);
          const bi = bagArr.indexOf(null);
          if (ei !== -1 || bi !== -1) {
            if (!newEquipped) {
              newEquipped = equippedRef.current.slice();
              newBag = bagRef.current.slice();
            }
            if (newEquipped.indexOf(null) !== -1) newEquipped[newEquipped.indexOf(null)] = it.item;
            else newBag![newBag!.indexOf(null)] = it.item;
            continue;
          }
        }
        remainingItems.push(it);
      }

      const ability3Level = abilitiesRef.current[3].level;
      const isRangedAttack = ability3Level > 0;
      const playerAttackRange = isRangedAttack ? RANGED_ATTACK_RANGE : PLAYER_ATTACK_RANGE;
      const playerDamage = PLAYER_BASE_DAMAGE + ability3DamageBonus(ability3Level) + dmgBonus;
      const attackCooldownDuration =
        (PLAYER_ATTACK_COOLDOWN * (p.hasteTimer > 0 ? 0.5 : 1)) / (1 + atkSpdBonusPct);

      // Attack speed can outrun the swing animation: haste alone takes the
      // interval to 0.4 s against an animation lasting 0.625 s, and with gear on
      // top it reaches 0.27 s. The animation would then only restart once the
      // previous had finished, so most blows landed with no visible swing at all.
      //
      // Playing the same frames faster keeps every swing whole and reads as what
      // a haste buff should look like. Restarting it mid-swing instead would show
      // the wind-up over and over and never the strike, which sits 60% in.
      const attackAnimSpeed = Math.max(1, animDuration(ANIMS.attack) / attackCooldownDuration);

      let xpGain = 0;

      // Mob AI
      for (const m of currentMobs) {
        m.attackCooldown = Math.max(0, m.attackCooldown - dt);
        m.animTime += dt;
        // A swing owns the sprite until it finishes, exactly as the player's does.
        const mobBusy = !MOB_ANIMS[m.anim].loop && m.animTime < animDuration(MOB_ANIMS[m.anim]);
        const setMobAnim = (next: MobAnimName) => {
          if (mobBusy) return;
          if (next !== m.anim || !MOB_ANIMS[next].loop) m.animTime = 0;
          m.anim = next;
        };
        const detect = m.type === 'boss' ? 99999 : m.type === 'ranged' ? 260 : RANGED_ATTACK_RANGE;

        let nearest: Target | null = null;
        let nearestDist = Infinity;
        const dToPlayer = dist(m.pos, p.pos);
        if (dToPlayer <= detect) {
          nearest = { kind: 'player', pos: p.pos };
          nearestDist = dToPlayer;
        }
        for (const a of currentAllies) {
          if (a.hp <= 0) continue;
          const dToAlly = dist(m.pos, a.pos);
          if (dToAlly <= detect && dToAlly < nearestDist) {
            nearest = { kind: 'ally', id: a.id, pos: a.pos };
            nearestDist = dToAlly;
          }
        }

        if (!nearest) {
          // Nobody in sight: shamble down the screen, facing that way.
          m.pos = { x: m.pos.x, y: m.pos.y + MOB_SPEED * 0.5 * dt };
          m.facing = facingFromDelta(0, 1);
          setMobAnim('walk');
          continue;
        }

        // Always face whatever it is chasing or hitting. Unlike the player,
        // there is no tap-to-move to conflict with, so this can be unconditional.
        m.facing = facingFromDelta(nearest.pos.x - m.pos.x, nearest.pos.y - m.pos.y);

        if (m.type === 'ranged') {
          if (nearestDist <= MOB_RANGED_FIRE_RANGE) {
            if (m.attackCooldown <= 0) {
              newProjectiles.push({
                id: ++projectileIdCounter,
                from: { ...m.pos },
                to: { ...nearest.pos },
                createdAt: now,
                duration: Math.max(80, (nearestDist / PROJECTILE_SPEED) * 1000),
                color: '#ff8a80',
                damage: m.damage,
                friendly: false,
                targetKind: nearest.kind === 'player' ? 'player' : 'ally',
                targetId: nearest.id ?? -1,
              });
              m.attackCooldown = MOB_ATTACK_COOLDOWN;
            }
          } else {
            const dx = nearest.pos.x - m.pos.x;
            const dy = nearest.pos.y - m.pos.y;
            const step = MOB_SPEED * dt;
            const ratio = Math.min(1, step / nearestDist);
            m.pos = { x: m.pos.x + dx * ratio, y: m.pos.y + dy * ratio };
          }
        } else {
          const contact = MOB_ATTACK_RANGE + (m.radius - MOB_RADIUS);
          if (nearestDist <= contact) {
            if (m.attackCooldown <= 0) {
              if (nearest.kind === 'player') {
                damageToPlayer += m.damage;
                newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...p.pos }, createdAt: now });
                newFloatingTexts.push(makeFloatingText(`-${m.damage}`, p.pos, TAKEN_TEXT_COLOR, now));
              } else {
                const ally = currentAllies.find((a) => a.id === nearest.id);
                if (ally) {
                  ally.hp -= m.damage;
                  newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...ally.pos }, createdAt: now });
                  newFloatingTexts.push(makeFloatingText(`-${m.damage}`, ally.pos, TAKEN_TEXT_COLOR, now));
                }
              }
              m.attackCooldown = MOB_ATTACK_COOLDOWN;
              setMobAnim(MOB_ATTACK_ANIMS[Math.floor(Math.random() * MOB_ATTACK_ANIMS.length)]);
            }
          } else {
            const dx = nearest.pos.x - m.pos.x;
            const dy = nearest.pos.y - m.pos.y;
            const step = MOB_SPEED * dt;
            const ratio = Math.min(1, step / nearestDist);
            m.pos = { x: m.pos.x + dx * ratio, y: m.pos.y + dy * ratio };
            setMobAnim('walk');
          }
        }
      }

      // Player attack: melee hits everything in range instantly, ranged fires projectiles
      let playerAttacked = false;
      const attackTargets: Vec[] = [];
      if (p.attackCooldown <= 0) {
        if (isRangedAttack) {
          const candidates = currentMobs
            .filter((m) => m.hp > 0 && dist(m.pos, p.pos) <= playerAttackRange)
            .sort((a, b) => dist(a.pos, p.pos) - dist(b.pos, p.pos))
            .slice(0, rangedTargetCount(ability3Level));
          if (candidates.length > 0) {
            for (const target of candidates) {
              attackTargets.push({ ...target.pos });
              newProjectiles.push({
                id: ++projectileIdCounter,
                from: { ...p.pos },
                to: { ...target.pos },
                createdAt: now,
                duration: Math.max(80, (dist(p.pos, target.pos) / PROJECTILE_SPEED) * 1000),
                color: '#e1f5fe',
                damage: playerDamage,
                friendly: true,
                targetKind: 'mob',
                targetId: target.id,
              });
            }
            p.attackCooldown = attackCooldownDuration;
            playerAttacked = true;
          }
        } else {
          let hitAny = false;
          for (const m of currentMobs) {
            if (m.hp > 0 && dist(m.pos, p.pos) <= playerAttackRange + (m.radius - MOB_RADIUS)) {
              m.hp -= playerDamage;
              hitAny = true;
              attackTargets.push({ ...m.pos });
              newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...m.pos }, createdAt: now });
              newFloatingTexts.push(makeFloatingText(`-${Math.round(playerDamage)}`, m.pos, DAMAGE_TEXT_COLOR, now));
            }
          }
          if (hitAny) {
            p.attackCooldown = attackCooldownDuration;
            playerAttacked = true;
          }
        }
      }

      // Ally AI
      for (const a of currentAllies) {
        if (a.hp <= 0) continue;
        a.attackCooldown = Math.max(0, a.attackCooldown - dt);
        const engageRange = a.ranged ? ALLY_RANGED_ENGAGE_RANGE : ALLY_ENGAGE_RANGE;
        const atkRange = a.ranged ? ALLY_RANGED_ATTACK_RANGE : ALLY_ATTACK_RANGE;
        const mobTargets: Target[] = currentMobs
          .filter((m) => m.hp > 0)
          .map((m) => ({ kind: 'mob' as const, id: m.id, pos: m.pos }));
        const nearest = nearestTarget(a.pos, mobTargets, engageRange);
        if (nearest) {
          const d = dist(a.pos, nearest.pos);
          if (d <= atkRange) {
            if (a.attackCooldown <= 0) {
              const mob = currentMobs.find((m) => m.id === nearest.id);
              if (mob) {
                if (a.ranged) {
                  newProjectiles.push({
                    id: ++projectileIdCounter,
                    from: { ...a.pos },
                    to: { ...mob.pos },
                    createdAt: now,
                    duration: Math.max(80, (dist(a.pos, mob.pos) / PROJECTILE_SPEED) * 1000),
                    color: '#d1c4e9',
                    damage: a.damage,
                    friendly: true,
                    targetKind: 'mob',
                    targetId: mob.id,
                  });
                } else {
                  mob.hp -= a.damage;
                  newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...mob.pos }, createdAt: now });
                  newFloatingTexts.push(makeFloatingText(`-${a.damage}`, mob.pos, DAMAGE_TEXT_COLOR, now));
                }
              }
              a.attackCooldown = ALLY_ATTACK_COOLDOWN;
            }
          } else {
            const dx = nearest.pos.x - a.pos.x;
            const dy = nearest.pos.y - a.pos.y;
            const step = ALLY_SPEED * dt;
            const ratio = Math.min(1, step / d);
            a.pos = { x: a.pos.x + dx * ratio, y: a.pos.y + dy * ratio };
          }
        }
      }

      const survivorMobs: Mob[] = [];
      let anyMobDied = false;
      for (const m of currentMobs) {
        if (m.hp > 0) {
          survivorMobs.push(m);
        } else {
          anyMobDied = true;
          newBlood.push({
            id: ++bloodIdCounter,
            pos: { ...m.pos },
            variant: Math.floor(Math.random() * BLOOD_VARIANTS),
            createdAt: now,
          });
          const reward = m.type === 'boss' ? BOSS_XP_REWARD : MOB_XP_REWARD;
          xpGain += reward;
          newFloatingTexts.push(makeFloatingText(`+${reward} XP`, m.pos, XP_TEXT_COLOR, now));
        }
      }
      const survivorAllies = currentAllies.filter((a) => a.hp > 0);

      if (damageToPlayer > 0) p.hp = Math.max(0, p.hp - damageToPlayer);



      // Turn to face what he is hitting, but only from a standstill. While
      // moving, the movement block owns facing -- otherwise he slides one way
      // while looking another, which the 8 fixed directions make very obvious.
      // Nothing is lost by that: tapping towards an enemy already points him at
      // it. This is for the enemy that walks up behind him while he stands.
      if (playerAttacked && !moving) {
        p.facing = facingForTargets(p.pos, attackTargets, p.facing);
      }

      // Pick the animation now that this frame's attacks and damage are known.
      // A one-shot owns the sprite until it finishes, so a swing plays out
      // instead of being cut off the moment the knight starts moving again.
      // Getting hit is the exception -- it interrupts anything, including
      // itself, so repeated blows keep flinching rather than freezing.
      const oneShotBusy =
        !ANIMS[p.anim].loop && p.animTime * p.animSpeed < animDuration(ANIMS[p.anim]);

      // A flinch no longer barges in on a swing already under way, and cannot
      // follow another too closely. It used to win outright, which left the
      // knight twitching continuously and almost never landing a visible blow.
      hurtAnimGapRef.current = Math.max(0, hurtAnimGapRef.current - dt);
      const midSwing = p.anim === 'attack' && oneShotBusy;
      const mayFlinch = damageToPlayer > 0 && !midSwing && hurtAnimGapRef.current <= 0;

      let nextAnim: AnimName = p.anim;
      let restartAnim = false;
      if (mayFlinch) {
        nextAnim = 'hurt';
        restartAnim = true;
        hurtAnimGapRef.current = HURT_ANIM_MIN_GAP;
        // Heard exactly when the flinch is drawn, the same rule the sword
        // follows. No delay: a flinch is the reaction to the blow, so it starts
        // on the hit rather than building up to it like a swing does.
        const pool = hurtSoundsRef.current;
        playSfx(pool[Math.floor(Math.random() * pool.length)]);
      } else if (!oneShotBusy) {
        nextAnim = playerAttacked ? 'attack' : moving ? 'run' : 'idle';
        // Any freshly triggered one-shot restarts, including a second swing
        // straight after the first -- without this it would stay parked on the
        // last frame, since the name alone has not changed.
        restartAnim = nextAnim !== p.anim || !ANIMS[nextAnim].loop;
      }
      if (restartAnim) {
        p.animTime = 0;
        // Only the swing is rushed to keep up with attack speed. Everything else
        // runs at the rate its sheet was drawn for.
        p.animSpeed = nextAnim === 'attack' ? attackAnimSpeed : 1;

        // The sword is heard only when it is seen. A blow still lands whenever
        // the cooldown is ready, but if the knight is flinching instead of
        // swinging there is no swing to hear -- getting hit outranks attacking
        // in the state machine above, so in a crowd that happens often.
        if (nextAnim === 'attack') {
          // Held back until the blade comes round, and scaled with the
          // animation so it keeps landing on the strike at any attack speed.
          swingSoundTimerRef.current = SWING_SOUND_AT / attackAnimSpeed;
          // Decided now, while it is still known whether this blow killed
          // anything. A killing blow sometimes earns the heavier combo, which
          // replaces the swing rather than layering over it: both at once just
          // muddies, and the combo opens on a strike of its own.
          swingSoundIsKillRef.current = anyMobDied && Math.random() < KILL_SFX_CHANCE;
        } else {
          // Interrupted before the strike, so it never happened as far as the
          // eye is concerned. Drop the pending sound.
          swingSoundTimerRef.current = 0;
        }
      }
      p.anim = nextAnim;

      if (swingSoundTimerRef.current > 0) {
        swingSoundTimerRef.current -= dt;
        if (swingSoundTimerRef.current <= 0) {
          const pool = swingSoundIsKillRef.current ? killSoundsRef.current : attackSoundsRef.current;
          playSfx(pool[Math.floor(Math.random() * pool.length)]);
        }
      }

      if (xpGain > 0) {
        p.xp += xpGain;
        while (p.xp >= p.xpToNext) {
          p.xp -= p.xpToNext;
          p.level += 1;
          p.xpToNext = xpForLevel(p.level);
          // Scale current HP up with the new max instead of fully healing.
          const oldMaxHp = p.maxHp;
          p.maxHp += 10;
          p.hp = p.hp * (p.maxHp / oldMaxHp);
          p.abilityPoints += 1;
        }
      }

      // Wave spawning from queue
      let newWaveActive = waveActiveRef.current;
      if (waveActiveRef.current && waveQueueRef.current.length > 0) {
        spawnTimerRef.current += dt;
        if (spawnTimerRef.current >= WAVE_SPAWN_INTERVAL) {
          spawnTimerRef.current = 0;
          const type = waveQueueRef.current.shift()!;
          survivorMobs.push(spawnMob(type, waveRef.current));
        }
        if (waveQueueRef.current.length === 0) newWaveActive = false;
      }

      // Field cleared and nothing spawning: pay out loot owed for every wave finished
      // so far (waves the player rushed together still each drop their item).
      let waveJustCleared = false;
      if (!newWaveActive && survivorMobs.length === 0 && lootOwedRef.current.length > 0) {
        for (const w of lootOwedRef.current) remainingItems.push(spawnLoot(w));
        lootOwedRef.current = [];
        waveJustCleared = true;
        // Fully restore health and mana once every minion from the wave is cleared.
        p.hp = p.maxHp + hpBonus;
        p.mana = effectiveMaxMana;
      }

      const newAbilities: Abilities = {
        1: { ...abilitiesRef.current[1], cooldown: Math.max(0, abilitiesRef.current[1].cooldown - dt) },
        2: { ...abilitiesRef.current[2], cooldown: Math.max(0, abilitiesRef.current[2].cooldown - dt) },
        3: { ...abilitiesRef.current[3], cooldown: Math.max(0, abilitiesRef.current[3].cooldown - dt) },
      };

      const survivorProjectiles = stillFlying.concat(newProjectiles);
      const survivorFlashes = hitFlashesRef.current
        .filter((f) => now - f.createdAt < HIT_FLASH_DURATION)
        .concat(newFlashes);
      const survivorBlood = bloodSplatsRef.current
        .filter((b) => now - b.createdAt < BLOOD_DURATION * 1000)
        .concat(newBlood);
      const survivorFloatingTexts = floatingTextsRef.current
        .filter((f) => now - f.createdAt < FLOATING_TEXT_DURATION)
        .concat(newFloatingTexts);

      const isGameOver = p.hp <= 0;

      if (isGameOver) {
        // Delete this run's save on death.
        if (!isTestRunRef.current && currentRunIdRef.current) {
          const idToDelete = currentRunIdRef.current;
          setSavedRuns((prev) => {
            const next = prev.filter((r) => r.id !== idToDelete);
            persistRuns(next);
            return next;
          });
        }
      } else if (waveJustCleared && !isTestRunRef.current && currentRunIdRef.current) {
        // Autosave after each wave clear.
        const id = currentRunIdRef.current;
        const save: RunSave = {
          id,
          savedAt: Date.now(),
          wave: waveRef.current,
          level: p.level,
          xp: p.xp,
          xpToNext: p.xpToNext,
          hp: p.hp,
          maxHp: p.maxHp,
          mana: p.mana,
          abilityPoints: p.abilityPoints,
          abilities: newAbilities,
          equipped: newEquipped ?? equippedRef.current,
          bag: newBag ?? bagRef.current,
          materials: materialsRef.current,
        };
        setSavedRuns((prev) => {
          const next = prev.filter((r) => r.id !== id);
          next.push(save);
          persistRuns(next);
          return next;
        });
      }

      playerRef.current = p;
      mobsRef.current = survivorMobs;
      alliesRef.current = survivorAllies;
      abilitiesRef.current = newAbilities;
      projectilesRef.current = survivorProjectiles;
      hitFlashesRef.current = survivorFlashes;
      bloodSplatsRef.current = survivorBlood;
      floatingTextsRef.current = survivorFloatingTexts;
      waveActiveRef.current = newWaveActive;
      gameOverRef.current = isGameOver;
      groundItemsRef.current = remainingItems;
      if (newEquipped) {
        equippedRef.current = newEquipped;
        bagRef.current = newBag!;
      }
      setPlayer(p);
      setMobs(survivorMobs);
      setAllies(survivorAllies);
      setAbilities(newAbilities);
      setProjectiles(survivorProjectiles);
      setHitFlashes(survivorFlashes);
      setBloodSplats(survivorBlood);
      setFloatingTexts(survivorFloatingTexts);
      setWaveActive(newWaveActive);
      if (isGameOver) setGameOver(true);
      setGroundItems(remainingItems);
      if (newEquipped) {
        setEquipped(newEquipped);
        setBag(newBag!);
      }
      setTick((t) => t + 1);

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const ability3Level = abilities[3].level;
  const playerAttackRange = ability3Level > 0 ? RANGED_ATTACK_RANGE : PLAYER_ATTACK_RANGE;
  const dmgBonusDisplay = equippedBonus(equipped, 'dmg');
  const atkSpdBonusPctDisplay = equippedBonus(equipped, 'atkspd');
  const manaBonusDisplay = equippedBonus(equipped, 'mana');
  const hpBonusDisplay = equippedBonus(equipped, 'health');
  const effectiveMaxHp = player.maxHp + hpBonusDisplay;
  const effectiveMaxMana = MANA_MAX + manaBonusDisplay;
  const displayDamage = PLAYER_BASE_DAMAGE + ability3DamageBonus(ability3Level) + dmgBonusDisplay;
  const displayAttackCooldown = (PLAYER_ATTACK_COOLDOWN * (player.hasteTimer > 0 ? 0.5 : 1)) / (1 + atkSpdBonusPctDisplay);
  const displayAtkSpeed = 1 / displayAttackCooldown;

  const abilityMeta: Record<AbilityId, { label: string; color: string }> = {
    1: { label: 'Summon', color: '#7e57c2' },
    2: { label: 'Cone', color: '#ff8a50' },
    3: { label: 'Ranged', color: '#26a69a' },
  };

  function tooltipPositionStyle(x: number, y: number) {
    const width = 240;
    const left = Math.max(10, Math.min(SCREEN_W - width - 10, x - width / 2));
    const bottom = Math.max(10, SCREEN_H - y + 14);
    return { left, width, bottom };
  }

  function renderCone(angleDeg: number) {
    const halfRad = (ABILITY2_HALF_ANGLE_DEG * Math.PI) / 180;
    const baseWidth = 2 * CONE_RANGE * Math.tan(halfRad);
    const rotation = angleDeg - 90;
    return (
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: player.pos.x - baseWidth / 2,
          top: player.pos.y - CONE_RANGE,
          width: baseWidth,
          height: CONE_RANGE * 2,
          transform: [{ rotate: `${rotation}deg` }],
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: CONE_RANGE,
            left: 0,
            width: 0,
            height: 0,
            borderLeftWidth: baseWidth / 2,
            borderRightWidth: baseWidth / 2,
            borderBottomWidth: CONE_RANGE,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: 'rgba(255,138,80,0.28)',
          }}
        />
      </View>
    );
  }

  const shownWave = waveActive ? wave : wave + 1;
  const bagCount = bag.filter((s) => s != null).length;

  function renderInvSlot(key: string, item: Item | null, sizeStyle: any) {
    const def = item ? ITEM_DEFS[item.kind] : null;
    return (
      <View
        key={key}
        {...registerSlot(key)}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => handleSlotGrant(key, e)}
        onResponderMove={handleSlotMove}
        onResponderRelease={(e) => handleSlotRelease(key, e)}
        style={[sizeStyle, styles.invSlotEmpty, def && { backgroundColor: def.color, borderColor: 'transparent' }]}
      >
        {item && def && (
          <>
            <Text style={styles.invSlotName}>{def.name}</Text>
            <Text style={styles.invSlotLevel}>{item.level}</Text>
          </>
        )}
      </View>
    );
  }

  if (screen === 'menu') {
    const hasSaves = runsLoaded && savedRuns.length > 0;
    return (
      <View style={styles.root}>
        <View style={styles.menuScreen}>
          <Text style={styles.menuScreenTitle}>RPG Survival</Text>
          <Pressable
            onPress={() => hasSaves && setScreen('continue')}
            style={[styles.menuBigButton, !hasSaves && styles.menuBigButtonDisabled]}
          >
            <Text style={styles.menuBigButtonText}>Continue Run{hasSaves ? ` (${savedRuns.length})` : ''}</Text>
          </Pressable>
          <Pressable onPress={handleStartNewRun} style={styles.menuBigButton}>
            <Text style={styles.menuBigButtonText}>Start New Run</Text>
          </Pressable>
          <Pressable onPress={handleStartTestRun} style={styles.menuBigButton}>
            <Text style={styles.menuBigButtonText}>Start Test Run</Text>
          </Pressable>
        </View>
        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === 'continue') {
    const sorted = savedRuns.slice().sort((a, b) => b.savedAt - a.savedAt);
    return (
      <View style={styles.root}>
        <View style={styles.menuScreen}>
          <Text style={styles.menuScreenTitle}>Continue Run</Text>
          {sorted.length === 0 && <Text style={styles.menuEmptyText}>No saved runs.</Text>}
          {sorted.map((run) => (
            <Pressable key={run.id} onPress={() => handleContinueRun(run)} style={styles.runRow}>
              <Text style={styles.runRowTitle}>
                Wave {run.wave} · Lv {run.level}
              </Text>
              <Text style={styles.runRowSub}>{new Date(run.savedAt).toLocaleString()}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setScreen('menu')} style={styles.menuBackButton}>
            <Text style={styles.menuBackButtonText}>Back</Text>
          </Pressable>
        </View>
        <StatusBar style="auto" />
      </View>
    );
  }

  // Everyone standing on the ground is drawn as one list sorted by how far down
  // the screen they are, so whoever is nearer the camera covers whoever is
  // behind them. Drawn separately -- as they were -- a zombie standing behind
  // the knight still painted over him, which 128 px sprites made obvious.
  //
  // Sorting on the feet rather than the centre, since that is where a character
  // actually meets the ground.
  const groundActors = [
    ...allies.map((a) => ({
      key: `ally-${a.id}`,
      y: a.pos.y,
      node: (
        <View key={`ally-${a.id}`}>
          <View
            style={[
              styles.ally,
              { left: a.pos.x - ALLY_RADIUS, top: a.pos.y - ALLY_RADIUS, backgroundColor: a.ranged ? '#b39ddb' : '#9575cd' },
            ]}
          />
          <View style={[styles.mobHpBarBg, { left: a.pos.x - ALLY_RADIUS, top: a.pos.y - ALLY_RADIUS - 8, width: ALLY_RADIUS * 2 }]}>
            <View style={[styles.mobHpBarFill, { width: ALLY_RADIUS * 2 * (a.hp / a.maxHp), backgroundColor: '#7e57c2' }]} />
          </View>
        </View>
      ),
    })),
    {
      key: 'player',
      y: player.pos.y,
      node: (
        // Anchored on the sprite's feet rather than its centre, so the knight
        // stands on pos instead of hovering over it. Every animation shares the
        // same cell size, so he does not jump when it changes.
        <SpriteSheet
          key="player"
          anims={ANIMS}
          anim={player.anim}
          animTime={player.animTime * player.animSpeed}
          facing={player.facing}
          size={PLAYER_SPRITE_SIZE}
          left={player.pos.x - PLAYER_SPRITE_SIZE / 2}
          top={player.pos.y + PLAYER_SPRITE_FOOT_OFFSET - PLAYER_SPRITE_SIZE}
        />
      ),
    },
    ...mobs.map((m) => ({
      key: `mob-${m.id}`,
      y: m.pos.y,
      node: (
        <View key={`mob-${m.id}`}>
          {/* Only the plain melee mob has art so far. Ranged and boss stay as
              circles, which also keeps them easy to tell apart at a glance. */}
          {m.type === 'melee' ? (
            <SpriteSheet
              anims={MOB_ANIMS}
              anim={m.anim}
              animTime={m.animTime}
              facing={m.facing}
              size={MOB_SPRITE_SIZE}
              left={m.pos.x - MOB_SPRITE_SIZE / 2}
              top={m.pos.y + MOB_SPRITE_FOOT_OFFSET - MOB_SPRITE_SIZE}
            />
          ) : (
            <View
              style={{
                position: 'absolute',
                left: m.pos.x - m.radius,
                top: m.pos.y - m.radius,
                width: m.radius * 2,
                height: m.radius * 2,
                borderRadius: m.radius,
                backgroundColor: MOB_TYPE_META[m.type].color,
              }}
            />
          )}
          <View style={[styles.mobHpBarBg, { left: m.pos.x - m.radius, top: m.pos.y - m.radius - 8, width: m.radius * 2 }]}>
            <View style={[styles.mobHpBarFill, { width: m.radius * 2 * (m.hp / m.maxHp) }]} />
          </View>
        </View>
      ),
    })),
  ]
    .sort((a, b) => a.y - b.y)
    .map((actor) => actor.node);

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Text style={styles.topBarText}>Wave {shownWave}</Text>
        <Pressable onPress={() => setMobStatsOpen(true)} style={styles.topBarButton}>
          <Text style={styles.topBarButtonText}>Mob Stats</Text>
        </Pressable>
        {!waveActive && !gameOver && (
          <Pressable onPress={handleStartNextWave} style={styles.startWaveButton}>
            <Text style={styles.startWaveText}>Start Wave {wave + 1}</Text>
          </Pressable>
        )}
      </View>

      <View
        style={styles.playArea}
        onStartShouldSetResponder={() => true}
        onResponderGrant={handlePlayAreaGrant}
        onResponderMove={handlePlayAreaMove}
        onResponderRelease={handlePlayAreaRelease}
      >
        <View
          pointerEvents="none"
          style={[
            styles.rangeRing,
            {
              width: playerAttackRange * 2,
              height: playerAttackRange * 2,
              borderRadius: playerAttackRange,
              left: player.pos.x - playerAttackRange,
              top: player.pos.y - playerAttackRange,
            },
          ]}
        />

        {aimingAbility === 2 &&
          aimPreviewPoint &&
          renderCone((Math.atan2(aimPreviewPoint.y - player.pos.y, aimPreviewPoint.x - player.pos.x) * 180) / Math.PI)}

        {groundItems.map((it) => {
          const def = ITEM_DEFS[it.item.kind];
          return (
            <View
              key={it.item.id}
              style={[
                styles.groundItem,
                { left: it.pos.x - ITEM_SIZE / 2, top: it.pos.y - ITEM_SIZE / 2, backgroundColor: def.color },
              ]}
            >
              <Text style={styles.groundItemText}>{it.item.level}</Text>
            </View>
          );
        })}

        {/* Blood lands on the ground, so it goes under everyone standing on it. */}
        {bloodSplats.map((b) => (
          <SpriteSheet
            key={b.id}
            anims={BLOOD_ANIMS}
            anim="blood"
            animTime={(Date.now() - b.createdAt) / 1000}
            facing={b.variant}
            size={BLOOD_SIZE}
            left={b.pos.x - BLOOD_SIZE / 2}
            top={b.pos.y - BLOOD_SIZE / 2}
          />
        ))}

        {groundActors}

        {projectiles.map((pr) => {
          const progress = Math.min(1, (Date.now() - pr.createdAt) / pr.duration);
          const x = pr.from.x + (pr.to.x - pr.from.x) * progress;
          const y = pr.from.y + (pr.to.y - pr.from.y) * progress;
          return <View key={pr.id} style={[styles.projectile, { left: x - 4, top: y - 4, backgroundColor: pr.color }]} />;
        })}

        {hitFlashes.map((f) => {
          const age = Date.now() - f.createdAt;
          const opacity = Math.max(0, 1 - age / HIT_FLASH_DURATION);
          return <View key={f.id} style={[styles.hitFlash, { left: f.pos.x - 10, top: f.pos.y - 10, opacity }]} />;
        })}

        {floatingTexts.map((f) => {
          const age = Date.now() - f.createdAt;
          const t = Math.min(1, age / FLOATING_TEXT_DURATION);
          const opacity = Math.max(0, 1 - t);
          const y = f.pos.y - t * FLOATING_TEXT_RISE;
          return (
            <Text
              key={f.id}
              pointerEvents="none"
              style={[styles.floatingText, { left: f.pos.x - 25, top: y - 10, color: f.color, opacity }]}
            >
              {f.text}
            </Text>
          );
        })}
      </View>

      <View style={styles.quickCastBar}>
        {([1, 2, 3] as AbilityId[])
          .filter((id) => abilities[id].level > 0)
          .map((id) => {
            const ab = abilities[id];
            const meta = abilityMeta[id];
            const cost = ABILITY_MANA_COST[id];
            const onCooldown = ab.cooldown > 0;
            const canCast = !onCooldown && player.mana >= cost;
            const isAiming = aimingAbility === id;

            return (
              <View key={id} style={styles.quickCastSlot}>
                <Pressable
                  onPress={() => handleAbilityPress(id)}
                  style={[
                    styles.quickCastButton,
                    { backgroundColor: meta.color },
                    !canCast && styles.abilityDim,
                    isAiming && styles.abilityAiming,
                    id === 3 && player.hasteTimer > 0 && styles.abilityHaste,
                  ]}
                >
                  {onCooldown && (
                    <View style={styles.quickCastCooldownOverlay}>
                      <Text style={styles.cooldownText}>{Math.ceil(ab.cooldown)}</Text>
                    </View>
                  )}
                </Pressable>
                <Text style={styles.abilityCostText}>
                  {cost} MP · {ABILITY_COOLDOWN_TIME[id]}s
                </Text>
              </View>
            );
          })}
      </View>

      <View style={styles.hud}>
        <View style={styles.hudBarsRow}>
          <View style={styles.hudBarColumn}>
            <Text style={styles.hudBarLabel}>Lv {player.level}</Text>
            <Text style={styles.hudBarValue}>{player.xp}/{player.xpToNext}</Text>
            <View style={styles.barBg}>
              <View style={[styles.barFillXp, { width: BAR_WIDTH * (player.xp / player.xpToNext) }]} />
            </View>
          </View>
          <View style={styles.hudBarColumn}>
            <Text style={styles.hudBarLabel}>HP</Text>
            <Text style={styles.hudBarValue}>{Math.round(player.hp)}/{Math.round(effectiveMaxHp)}</Text>
            <View style={styles.barBg}>
              <View style={[styles.barFillHp, { width: BAR_WIDTH * (player.hp / effectiveMaxHp) }]} />
            </View>
          </View>
          <View style={styles.hudBarColumn}>
            <Text style={styles.hudBarLabel}>MP</Text>
            <Text style={styles.hudBarValue}>{Math.round(player.mana)}/{Math.round(effectiveMaxMana)}</Text>
            <View style={styles.barBg}>
              <View style={[styles.barFillMana, { width: BAR_WIDTH * (player.mana / effectiveMaxMana) }]} />
            </View>
          </View>
        </View>
        <View style={styles.hudStatsRow}>
          <Text style={styles.hudStatText}>DMG {displayDamage}</Text>
          <Text style={styles.hudStatText}>SPD {displayAtkSpeed.toFixed(1)}/s</Text>
        </View>
      </View>

      <View style={styles.menuBar}>
        <Pressable onPress={() => setSkillsMenuOpen(true)} style={styles.menuButton}>
          <Text style={styles.menuButtonText}>Skills</Text>
          {player.abilityPoints > 0 && (
            <View style={styles.menuBadge}>
              <Text style={styles.menuBadgeText}>{player.abilityPoints}</Text>
            </View>
          )}
        </Pressable>
        <Pressable onPress={() => setInvMenuOpen(true)} style={styles.menuButton}>
          <Text style={styles.menuButtonText}>Inventory</Text>
          {bagCount > 0 && (
            <View style={[styles.menuBadge, { backgroundColor: '#90caf9' }]}>
              <Text style={styles.menuBadgeText}>{bagCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* ---- Skills menu ---- */}
      {skillsMenuOpen && (
        <View style={styles.menuOverlay}>
          <Pressable
            style={styles.menuBackdrop}
            onPress={() => {
              setSkillsMenuOpen(false);
              dismissTooltip();
            }}
          />
          <View style={styles.menuPanel}>
            <View style={styles.menuHeader}>
              <Text style={styles.menuTitle}>
                Skills · {player.abilityPoints} point{player.abilityPoints === 1 ? '' : 's'} available
              </Text>
              <Pressable
                onPress={() => {
                  setSkillsMenuOpen(false);
                  dismissTooltip();
                }}
                style={styles.menuClose}
              >
                <Text style={styles.menuCloseText}>X</Text>
              </Pressable>
            </View>

            {([1, 2, 3] as AbilityId[]).map((id) => {
              const ab = abilities[id];
              const meta = abilityMeta[id];
              const locked = ab.level <= 0;
              const canLevelUp = player.abilityPoints > 0 && ab.level < ABILITY_MAX_LEVEL;

              return (
                <View key={id} style={styles.listRow}>
                  <View style={styles.listIconWrap}>
                    <Pressable
                      {...registerSlot(`skill-${id}`)}
                      onPress={() => showTooltipAboveKey(`skill-${id}`, abilityDescription(id) + abilityStatsSuffix(id))}
                      style={[styles.listIcon, { backgroundColor: meta.color }, locked && styles.abilityLocked]}
                    >
                      <View style={styles.pipsRow}>
                        {[1, 2, 3, 4].map((pip) => (
                          <View key={pip} style={[styles.pip, pip <= ab.level && styles.pipFilled]} />
                        ))}
                      </View>
                    </Pressable>
                    {canLevelUp && (
                      <Pressable onPress={() => handleAbilityLevelUp(id)} style={styles.levelUpButton}>
                        <Text style={styles.levelUpText}>+</Text>
                      </Pressable>
                    )}
                  </View>
                  <View style={styles.listInfo}>
                    <Text style={styles.listName}>
                      {meta.label} · Lv {ab.level}/{ABILITY_MAX_LEVEL}
                    </Text>
                    <Text style={styles.listSub}>
                      {ABILITY_MANA_COST[id]} MP · {ABILITY_COOLDOWN_TIME[id]}s CD
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* ---- Inventory menu ---- */}
      {invMenuOpen && (
        <View style={styles.menuOverlay}>
          <Pressable
            style={styles.menuBackdrop}
            onPress={() => {
              setInvMenuOpen(false);
              dismissTooltip();
            }}
          />
          <View style={styles.menuPanel}>
            <View style={styles.menuHeader}>
              <Text style={styles.menuTitle}>Inventory · Materials: {materials}</Text>
              <Pressable
                onPress={() => {
                  setInvMenuOpen(false);
                  dismissTooltip();
                }}
                style={styles.menuClose}
              >
                <Text style={styles.menuCloseText}>X</Text>
              </Pressable>
            </View>

            <Text style={styles.invSectionLabel}>Equipped</Text>
            <View style={styles.equipRow}>
              {equipped.map((item, i) => renderInvSlot(`equip-${i}`, item, styles.equipSlot))}
            </View>

            <View style={styles.invBottomRow}>
              <View>
                <Text style={styles.invSectionLabel}>Bag</Text>
                <View style={styles.bagGrid}>
                  {bag.map((item, i) => renderInvSlot(`bag-${i}`, item, styles.bagSlot))}
                </View>
              </View>

              <View
                {...registerSlot('salvage')}
                style={styles.salvageArea}
              >
                <Text style={styles.salvageTitle}>Salvage</Text>
                <Text style={styles.salvageSub}>drop item →{'\n'}materials = iLvl</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* ---- Mob Stats overlay ---- */}
      {mobStatsOpen && (
        <View style={styles.menuOverlay}>
          <Pressable style={styles.menuBackdrop} onPress={() => setMobStatsOpen(false)} />
          <View style={styles.menuPanel}>
            <View style={styles.menuHeader}>
              <Text style={styles.menuTitle}>Mob Stats · Wave {shownWave}</Text>
              <Pressable onPress={() => setMobStatsOpen(false)} style={styles.menuClose}>
                <Text style={styles.menuCloseText}>X</Text>
              </Pressable>
            </View>
            {waveComposition(shownWave).map((row) => {
              const meta = MOB_TYPE_META[row.type];
              const stats = mobTypeStats(row.type, shownWave);
              return (
                <View key={row.type} style={styles.listRow}>
                  <View style={[styles.mobSwatch, { backgroundColor: meta.color }]} />
                  <View style={styles.listInfo}>
                    <Text style={styles.listName}>
                      {meta.name} · x{row.count}
                    </Text>
                    <Text style={styles.listSub}>
                      HP {stats.hp} · DMG {stats.damage}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* ---- Dragging item ghost ---- */}
      {dragging && (
        <View
          pointerEvents="none"
          style={[
            styles.dragGhost,
            { left: dragging.x - 20, top: dragging.y - 20, backgroundColor: ITEM_DEFS[dragging.kind].color },
          ]}
        >
          <Text style={styles.invSlotName}>{ITEM_DEFS[dragging.kind].name}</Text>
          <Text style={styles.invSlotLevel}>{dragging.level}</Text>
        </View>
      )}

      {tooltip && (
        <>
          <Pressable style={styles.tooltipDismissOverlay} onPress={handleDismissOverlayPress} />
          <View pointerEvents="none" style={[styles.tooltipBox, tooltipPositionStyle(tooltip.x, tooltip.y)]}>
            <Text style={styles.tooltipText}>{tooltip.text}</Text>
          </View>
        </>
      )}

      {gameOver && (
        <View style={styles.gameOverOverlay}>
          <Text style={styles.gameOverText}>Game Over</Text>
          <Pressable onPress={handleBackToMenu} style={styles.retryButton}>
            <Text style={styles.retryText}>Main Menu</Text>
          </Pressable>
        </View>
      )}

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1b1b2b',
  },
  topBar: {
    height: TOP_BAR_HEIGHT,
    backgroundColor: '#111122',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 10,
  },
  topBarText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  topBarButton: {
    backgroundColor: '#37474f',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  topBarButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  startWaveButton: {
    backgroundColor: '#4caf50',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  startWaveText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  playArea: {
    width: SCREEN_W,
    height: PLAY_H,
    backgroundColor: '#26263f',
    overflow: 'hidden',
  },
  rangeRing: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'transparent',
  },
  ally: {
    position: 'absolute',
    width: ALLY_RADIUS * 2,
    height: ALLY_RADIUS * 2,
    borderRadius: ALLY_RADIUS,
    backgroundColor: '#9575cd',
  },
  mobHpBarBg: {
    position: 'absolute',
    height: 4,
    backgroundColor: '#000',
  },
  mobHpBarFill: {
    height: 4,
    backgroundColor: '#4caf50',
  },
  projectile: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  hitFlash: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
  },
  floatingText: {
    position: 'absolute',
    width: 50,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: 'bold',
  },
  groundItem: {
    position: 'absolute',
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groundItemText: {
    color: '#1b1b2b',
    fontSize: 11,
    fontWeight: 'bold',
  },
  quickCastBar: {
    height: QUICK_CAST_BAR_HEIGHT,
    backgroundColor: '#111122',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  quickCastSlot: {
    alignItems: 'center',
  },
  quickCastButton: {
    width: 42,
    height: 42,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickCastCooldownOverlay: {
    position: 'absolute',
    width: 42,
    height: 42,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  abilityLocked: {
    opacity: 0.3,
  },
  abilityDim: {
    opacity: 0.55,
  },
  abilityAiming: {
    borderWidth: 3,
    borderColor: '#ffeb3b',
  },
  abilityHaste: {
    borderWidth: 3,
    borderColor: '#69f0ae',
  },
  cooldownText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  pipsRow: {
    position: 'absolute',
    bottom: 3,
    flexDirection: 'row',
  },
  pip: {
    width: 6,
    height: 6,
    marginHorizontal: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  pipFilled: {
    backgroundColor: '#fff',
  },
  levelUpButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    backgroundColor: '#4caf50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  levelUpText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  abilityCostText: {
    color: '#888',
    fontSize: 9,
    marginTop: 3,
  },
  hud: {
    height: HUD_HEIGHT,
    backgroundColor: '#111122',
    paddingVertical: 6,
    paddingHorizontal: 10,
    justifyContent: 'center',
    gap: 4,
  },
  hudBarsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: 14,
  },
  hudBarColumn: {
    alignItems: 'center',
    width: BAR_WIDTH,
  },
  hudBarLabel: {
    color: '#fff',
    fontSize: 11,
  },
  hudBarValue: {
    color: '#ccc',
    fontSize: 10,
    marginBottom: 2,
  },
  hudStatsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  hudStatText: {
    color: '#ffd54f',
    fontSize: 12,
  },
  barBg: {
    width: BAR_WIDTH,
    height: 10,
    backgroundColor: '#333',
  },
  barFillXp: {
    height: 10,
    backgroundColor: '#ffd54f',
  },
  barFillHp: {
    height: 10,
    backgroundColor: '#e05555',
  },
  barFillMana: {
    height: 10,
    backgroundColor: '#4fc3f7',
  },
  menuBar: {
    height: MENU_BAR_HEIGHT,
    backgroundColor: '#0b0b18',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  menuButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#37474f',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 8,
  },
  menuButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  menuBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ffd54f',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  menuBadgeText: {
    color: '#1b1b2b',
    fontSize: 11,
    fontWeight: 'bold',
  },
  menuOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: SCREEN_H,
  },
  menuBackdrop: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: SCREEN_H,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  menuPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#141428',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  menuTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  menuClose: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#333',
  },
  menuCloseText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  listIconWrap: {
    width: 56,
    height: 56,
  },
  listIcon: {
    width: 56,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listInfo: {
    flex: 1,
  },
  listName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  listSub: {
    color: '#999',
    fontSize: 11,
    marginTop: 2,
  },
  mobSwatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  invSectionLabel: {
    color: '#bbb',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  equipRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
  },
  invBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bagGrid: {
    width: 3 * 52 + 2 * 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  invSlotEmpty: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  equipSlot: {
    width: 56,
    height: 56,
  },
  bagSlot: {
    width: 52,
    height: 52,
  },
  invSlotName: {
    color: '#1b1b2b',
    fontSize: 8,
    fontWeight: 'bold',
  },
  invSlotLevel: {
    color: '#1b1b2b',
    fontSize: 16,
    fontWeight: 'bold',
  },
  salvageArea: {
    width: 96,
    height: 3 * 52 + 2 * 8,
    borderWidth: 2,
    borderColor: '#ef5350',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(239,83,80,0.08)',
  },
  salvageTitle: {
    color: '#ef9a9a',
    fontSize: 13,
    fontWeight: 'bold',
  },
  salvageSub: {
    color: '#c98',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 4,
  },
  dragGhost: {
    position: 'absolute',
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.9,
  },
  tooltipDismissOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: SCREEN_H,
  },
  tooltipBox: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    padding: 10,
  },
  tooltipText: {
    color: '#fff',
    fontSize: 12,
  },
  menuScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  menuScreenTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  menuBigButton: {
    width: 240,
    backgroundColor: '#37474f',
    paddingVertical: 16,
    alignItems: 'center',
  },
  menuBigButtonDisabled: {
    opacity: 0.4,
  },
  menuBigButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  menuEmptyText: {
    color: '#999',
    fontSize: 13,
  },
  runRow: {
    width: 260,
    backgroundColor: '#232338',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  runRowTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  runRowSub: {
    color: '#999',
    fontSize: 11,
    marginTop: 2,
  },
  menuBackButton: {
    marginTop: 10,
    backgroundColor: '#333',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  menuBackButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  gameOverOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: SCREEN_H,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  gameOverText: {
    color: '#fff',
    fontSize: 36,
    fontWeight: 'bold',
  },
  retryButton: {
    backgroundColor: '#e05555',
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

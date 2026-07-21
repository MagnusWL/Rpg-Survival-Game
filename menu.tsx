import AsyncStorage from '@react-native-async-storage/async-storage';
import { BAG_SLOTS, EQUIP_SLOTS, ITEM_KINDS, Slot, makeItem } from './items';
import {
  Ability,
  Abilities,
  AbilityId,
  ALL_SKILLS,
  isPassiveSkill,
  MAX_EQUIPPED,
  PassiveState,
  ROOT_SKILLS,
  SkillId,
} from './skills';
import { makePlayer, PlayerState, xpForLevel } from './combat';

// Build the three run slots from the equipped loadout and the skill levels the
// player has bought in the menu. Empty slots carry no skill.
export function makeAbilities(loadout: SkillId[], skillLevels: Record<SkillId, number>): Abilities {
  const slotFor = (i: number): Ability => {
    const skill = loadout[i] ?? null;
    return { skill, level: skill ? skillLevels[skill] ?? 0 : 0, cooldown: 0 };
  };
  return { 1: slotFor(0), 2: slotFor(1), 3: slotFor(2) } as Record<AbilityId, Ability>;
}

// The equipped passive skill with its bought level, or null if none is set.
function makePassive(meta: MetaState): PassiveState {
  if (!meta.passive) return null;
  return { skill: meta.passive, level: meta.skillLevels[meta.passive] ?? 0 };
}

export type RunSave = {
  id: string;
  savedAt: number;
  wave: number;
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  mana: number;
  abilities: Abilities;
  passive: PassiveState;
  equipped: Slot[];
  bag: Slot[];
  materials: number;
};

export type GameState = {
  player: PlayerState;
  abilities: Abilities;
  passive: PassiveState;
  equipped: Slot[];
  bag: Slot[];
  materials: number;
  wave: number;
};

// Persistent account-level progression, kept apart from the per-run saves. Gold
// is the meta-currency earned by clearing waves; skillLevels is what has been
// bought in the menu; loadout is the up-to-three active skills carried into a
// run, and passive is the single equipped passive skill.
export type MetaState = {
  gold: number;
  skillLevels: Record<SkillId, number>;
  loadout: SkillId[];
  passive: SkillId | null;
};

// Bumped to v2 when the ability shape gained a per-slot skill id -- old v1 runs
// are not readable under the new shape, so they are dropped rather than migrated.
export const RUNS_STORAGE_KEY = 'rpg_runs_v2';
export const META_STORAGE_KEY = 'rpg_meta_v1';

export function defaultMeta(): MetaState {
  const skillLevels = Object.fromEntries(ALL_SKILLS.map((s) => [s, 0])) as Record<SkillId, number>;
  for (const root of ROOT_SKILLS) skillLevels[root] = 1; // start owning the three roots
  return { gold: 0, skillLevels, loadout: [...ROOT_SKILLS], passive: null };
}

// Fill in any skills a stored meta predates, and drop an equipped entry the
// player no longer owns, so the shape is always complete and valid.
export function sanitizeMeta(raw: Partial<MetaState> | null): MetaState {
  const base = defaultMeta();
  if (!raw) return base;
  const skillLevels = { ...base.skillLevels, ...(raw.skillLevels ?? {}) } as Record<SkillId, number>;
  const loadout = (raw.loadout ?? base.loadout)
    .filter((s) => ALL_SKILLS.includes(s) && !isPassiveSkill(s) && (skillLevels[s] ?? 0) > 0)
    .slice(0, MAX_EQUIPPED);
  const passive =
    raw.passive && ALL_SKILLS.includes(raw.passive) && isPassiveSkill(raw.passive) && (skillLevels[raw.passive] ?? 0) > 0
      ? raw.passive
      : null;
  return { gold: raw.gold ?? 0, skillLevels, loadout, passive };
}

export async function loadMeta(): Promise<MetaState> {
  try {
    const raw = await AsyncStorage.getItem(META_STORAGE_KEY);
    return sanitizeMeta(raw ? (JSON.parse(raw) as Partial<MetaState>) : null);
  } catch {
    return defaultMeta();
  }
}

export async function persistMeta(meta: MetaState) {
  try {
    await AsyncStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // best-effort; ignore storage failures
  }
}

// The gold a run pays out is 1 per wave cleared, banked at the end: clearing
// wave N is worth 1+2+...+N.
export function goldForWavesCleared(waves: number): number {
  return waves > 0 ? (waves * (waves + 1)) / 2 : 0;
}

export async function loadRuns(): Promise<RunSave[]> {
  try {
    const raw = await AsyncStorage.getItem(RUNS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RunSave[]) : [];
  } catch {
    return [];
  }
}

export async function persistRuns(runs: RunSave[]) {
  try {
    await AsyncStorage.setItem(RUNS_STORAGE_KEY, JSON.stringify(runs));
  } catch {
    // best-effort; ignore storage failures
  }
}

export function buildFreshState(meta: MetaState): GameState {
  return {
    player: makePlayer(),
    abilities: makeAbilities(meta.loadout, meta.skillLevels),
    passive: makePassive(meta),
    equipped: new Array(EQUIP_SLOTS).fill(null),
    bag: new Array(BAG_SLOTS).fill(null),
    materials: 0,
    wave: 0,
  };
}

export function buildTestState(meta: MetaState): GameState {
  const base = makePlayer();
  const targetLevel = 10;
  let maxHp = base.maxHp;
  for (let lvl = 2; lvl <= targetLevel; lvl++) {
    maxHp += 10;
  }
  const player: PlayerState = {
    ...base,
    level: targetLevel,
    xp: 0,
    xpToNext: xpForLevel(targetLevel),
    maxHp,
    hp: maxHp,
  };
  const randomTestItem = () => makeItem(ITEM_KINDS[Math.floor(Math.random() * ITEM_KINDS.length)], Math.max(1, targetLevel + Math.floor(Math.random() * 5) - 2));
  const equipped: Slot[] = [randomTestItem(), randomTestItem(), randomTestItem()];
  const bag: Slot[] = new Array(BAG_SLOTS).fill(null);
  bag[0] = randomTestItem();
  bag[1] = randomTestItem();
  bag[2] = randomTestItem();
  return { player, abilities: makeAbilities(meta.loadout, meta.skillLevels), passive: makePassive(meta), equipped, bag, materials: 0, wave: targetLevel - 1 };
}

export function buildStateFromSave(save: RunSave): GameState {
  const base = makePlayer();
  const player: PlayerState = {
    ...base,
    level: save.level,
    xp: save.xp,
    xpToNext: save.xpToNext,
    hp: save.hp,
    maxHp: save.maxHp,
    mana: save.mana,
  };
  return {
    player,
    abilities: save.abilities,
    passive: save.passive ?? null,
    equipped: save.equipped,
    bag: save.bag,
    materials: save.materials,
    wave: save.wave,
  };
}

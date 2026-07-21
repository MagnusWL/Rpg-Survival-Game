import { Dimensions } from 'react-native';
import { PLAYER_RADIUS } from './combat';

// Screen/play-area dimensions, recomputed here rather than imported from
// App.tsx -- see the note in combat.ts. Only used below by spawnLoot to
// scatter ground loot across the field.
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const TOP_BAR_HEIGHT = 50;
const QUICK_CAST_BAR_HEIGHT = 48;
const HUD_HEIGHT = 60;
const PLAY_H = SCREEN_H - TOP_BAR_HEIGHT - QUICK_CAST_BAR_HEIGHT - HUD_HEIGHT;

export type ItemKind = 'dmg' | 'atkspd' | 'mana' | 'manaregen' | 'health' | 'healthregen';
export type Item = { id: number; kind: ItemKind; level: number };
export type GroundItem = { item: Item; pos: { x: number; y: number }; createdAt: number };
export type Slot = Item | null;

export const ITEM_DEFS: Record<
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
export const ITEM_KINDS: ItemKind[] = ['dmg', 'atkspd', 'mana', 'manaregen', 'health', 'healthregen'];

export const EQUIP_SLOTS = 3;
export const BAG_SLOTS = 9;
export const ITEM_SIZE = 24;
export const ITEM_DESPAWN_MS = 10000;
export const ITEM_PICKUP_RADIUS = PLAYER_RADIUS + 14;
export const INV_DRAG_THRESHOLD = 14;

export function itemBonus(item: Item) {
  return ITEM_DEFS[item.kind].perLevel * item.level;
}

export function itemTooltip(item: Item): string {
  const def = ITEM_DEFS[item.kind];
  return `${def.name} · iLvl ${item.level}\n${def.format(Math.round(itemBonus(item) * 100) / 100)}`;
}

let itemIdCounter = 0;

export function makeItem(kind: ItemKind, level: number): Item {
  itemIdCounter += 1;
  return { id: itemIdCounter, kind, level };
}

export function spawnLoot(wave: number): GroundItem {
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

export function equippedBonus(equipped: Slot[], kind: ItemKind) {
  let total = 0;
  for (const it of equipped) {
    if (it && it.kind === kind) total += itemBonus(it);
  }
  return total;
}

import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const TOP_BAR_HEIGHT = 56;
const HUD_HEIGHT = 88;
const INVENTORY_BAR_HEIGHT = 46;
const ABILITY_BAR_HEIGHT = 96;
const PLAY_H = SCREEN_H - TOP_BAR_HEIGHT - HUD_HEIGHT - INVENTORY_BAR_HEIGHT - ABILITY_BAR_HEIGHT;
const BAR_WIDTH = 80;

const PLAYER_RADIUS = 18;
const PLAYER_SPEED = 220; // px/sec
const PLAYER_ATTACK_RANGE = 60;
const RANGED_ATTACK_RANGE = 240;
const PLAYER_ATTACK_COOLDOWN = 0.8; // sec
const PLAYER_BASE_DAMAGE = 8;

const MOB_RADIUS = 14;
const MOB_SPEED = 60; // px/sec
const MOB_CHASE_RANGE = 140; // detection range for allies (player uses their attack range instead)
const MOB_ATTACK_RANGE = 40;
const MOB_ATTACK_COOLDOWN = 1.2;
const MOB_MAX_HP = 20; // wave 1 base
const MOB_DAMAGE = 5; // wave 1 base
const MOB_XP_REWARD = 15;

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
const ABILITY2_HALF_ANGLE_DEG = 35;
const ABILITY3_HASTE_DURATION = 5;

const PROJECTILE_SPEED = 700; // px/sec
const HIT_FLASH_DURATION = 150; // ms

const INVENTORY_SIZE = 3;
const ITEM_SIZE = 22;
const ITEM_DESPAWN_MS = 10000;
const ITEM_PICKUP_RADIUS = PLAYER_RADIUS + 14;

let mobIdCounter = 0;
let allyIdCounter = 0;
let projectileIdCounter = 0;
let hitFlashIdCounter = 0;
let groundItemIdCounter = 0;

type Vec = { x: number; y: number };

type Mob = {
  id: number;
  pos: Vec;
  hp: number;
  maxHp: number;
  damage: number;
  attackCooldown: number;
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
  targetId: number;
};
type HitFlash = { id: number; pos: Vec; createdAt: number };

type AbilityId = 1 | 2 | 3;
type Ability = { level: number; cooldown: number };
type Abilities = Record<AbilityId, Ability>;

type Target = { kind: 'player' | 'ally' | 'mob'; id?: number; pos: Vec };

type ItemKind = 'dmg' | 'atkspd' | 'mana' | 'manaregen' | 'health' | 'healthregen';
type GroundItem = { id: number; kind: ItemKind; pos: Vec; createdAt: number };
type InventorySlot = ItemKind | null;

const ITEM_META: Record<ItemKind, { label: string; color: string; bonus: number }> = {
  dmg: { label: 'DMG', color: '#ff7043', bonus: 5 },
  atkspd: { label: 'SPD', color: '#ffca28', bonus: 0.15 },
  mana: { label: 'MP', color: '#42a5f5', bonus: 20 },
  manaregen: { label: 'MPR', color: '#26c6da', bonus: 2 },
  health: { label: 'HP', color: '#66bb6a', bonus: 20 },
  healthregen: { label: 'HPR', color: '#9ccc65', bonus: 2 },
};
const ITEM_KINDS: ItemKind[] = ['dmg', 'atkspd', 'mana', 'manaregen', 'health', 'healthregen'];

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
  damage: number,
  range: number,
  halfAngleDeg: number
): Mob[] {
  const dirAngle = (Math.atan2(aimPoint.y - origin.y, aimPoint.x - origin.x) * 180) / Math.PI;
  return currentMobs.map((m) => {
    const d = dist(origin, m.pos);
    if (d <= range) {
      const mobAngle = (Math.atan2(m.pos.y - origin.y, m.pos.x - origin.x) * 180) / Math.PI;
      if (Math.abs(normalizeAngle(mobAngle - dirAngle)) <= halfAngleDeg) {
        return { ...m, hp: m.hp - damage };
      }
    }
    return m;
  });
}

function xpForLevel(level: number) {
  return 40 + (level - 1) * 25;
}

function ability1Stats(level: number) {
  return { hp: 20 + (level - 1) * 15, damage: 4 + (level - 1) * 3 };
}

function ability2Damage(level: number) {
  return 15 + (level - 1) * 10;
}

function ability3DamageBonus(level: number) {
  return level * 4;
}

function rangedTargetCount(ability3Level: number) {
  return ability3Level >= 4 ? 2 : 1;
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

function sumInventoryBonus(inventory: InventorySlot[], kind: ItemKind) {
  return inventory.filter((k) => k === kind).length * ITEM_META[kind].bonus;
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
  };
}

function makeAbilities(): Abilities {
  return {
    1: { level: 0, cooldown: 0 },
    2: { level: 0, cooldown: 0 },
    3: { level: 0, cooldown: 0 },
  };
}

function makeInventory(): InventorySlot[] {
  return new Array(INVENTORY_SIZE).fill(null);
}

function spawnMob(wave: number): Mob {
  mobIdCounter += 1;
  const margin = MOB_RADIUS + 4;
  const hp = mobHpForWave(wave);
  return {
    id: mobIdCounter,
    pos: { x: margin + Math.random() * (SCREEN_W - margin * 2), y: MOB_RADIUS },
    hp,
    maxHp: hp,
    damage: mobDamageForWave(wave),
    attackCooldown: 0,
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

function spawnRandomGroundItem(): GroundItem {
  groundItemIdCounter += 1;
  const kind = ITEM_KINDS[Math.floor(Math.random() * ITEM_KINDS.length)];
  const margin = 30;
  return {
    id: groundItemIdCounter,
    kind,
    pos: {
      x: margin + Math.random() * (SCREEN_W - margin * 2),
      y: margin + Math.random() * (PLAY_H - margin * 2),
    },
    createdAt: Date.now(),
  };
}

export default function App() {
  const [player, setPlayer] = useState<PlayerState>(makePlayer());
  const [mobs, setMobs] = useState<Mob[]>([]);
  const [allies, setAllies] = useState<Ally[]>([]);
  const [abilities, setAbilities] = useState<Abilities>(makeAbilities());
  const [aimingAbility, setAimingAbility] = useState<AbilityId | null>(null);
  const [aimPreviewPoint, setAimPreviewPoint] = useState<Vec | null>(null);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [hitFlashes, setHitFlashes] = useState<HitFlash[]>([]);
  const [wave, setWave] = useState(1);
  const [waveMobsToSpawn, setWaveMobsToSpawn] = useState(mobCountForWave(1));
  const [waveMobsSpawned, setWaveMobsSpawned] = useState(0);
  const [waveActive, setWaveActive] = useState(true);
  const [gameOver, setGameOver] = useState(false);
  const [groundItems, setGroundItems] = useState<GroundItem[]>([]);
  const [inventory, setInventory] = useState<InventorySlot[]>(makeInventory());
  const [, setTick] = useState(0);

  const playerRef = useRef(player);
  const mobsRef = useRef(mobs);
  const alliesRef = useRef(allies);
  const abilitiesRef = useRef(abilities);
  const projectilesRef = useRef(projectiles);
  const hitFlashesRef = useRef(hitFlashes);
  const waveRef = useRef(wave);
  const waveMobsToSpawnRef = useRef(waveMobsToSpawn);
  const waveMobsSpawnedRef = useRef(waveMobsSpawned);
  const waveActiveRef = useRef(waveActive);
  const gameOverRef = useRef(gameOver);
  const groundItemsRef = useRef(groundItems);
  const inventoryRef = useRef(inventory);
  const waveLootDroppedRef = useRef(false);
  playerRef.current = player;
  mobsRef.current = mobs;
  alliesRef.current = allies;
  abilitiesRef.current = abilities;
  projectilesRef.current = projectiles;
  hitFlashesRef.current = hitFlashes;
  waveRef.current = wave;
  waveMobsToSpawnRef.current = waveMobsToSpawn;
  waveMobsSpawnedRef.current = waveMobsSpawned;
  waveActiveRef.current = waveActive;
  gameOverRef.current = gameOver;
  groundItemsRef.current = groundItems;
  inventoryRef.current = inventory;

  const spawnTimerRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

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
    const dmg = ability2Damage(ab.level);
    setMobs((prev) => fireCone(p.pos, { x: locationX, y: locationY }, prev, dmg, CONE_RANGE, ABILITY2_HALF_ANGLE_DEG));
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
    waveMobsToSpawnRef.current = mobCountForWave(nextWave);
    waveMobsSpawnedRef.current = 0;
    waveActiveRef.current = true;
    waveLootDroppedRef.current = false;
    setWave(nextWave);
    setWaveMobsToSpawn(mobCountForWave(nextWave));
    setWaveMobsSpawned(0);
    setWaveActive(true);
  };

  const handleInventorySlotPress = (index: number) => {
    if (gameOverRef.current) return;
    const kind = inventoryRef.current[index];
    if (!kind) return;
    const p = playerRef.current;

    const newInv = inventoryRef.current.slice();
    newInv[index] = null;
    inventoryRef.current = newInv;
    setInventory(newInv);

    const angle = Math.random() * Math.PI * 2;
    const dropDist = ITEM_PICKUP_RADIUS + 20;
    groundItemIdCounter += 1;
    const dropped: GroundItem = {
      id: groundItemIdCounter,
      kind,
      pos: {
        x: Math.max(20, Math.min(SCREEN_W - 20, p.pos.x + Math.cos(angle) * dropDist)),
        y: Math.max(20, Math.min(PLAY_H - 20, p.pos.y + Math.sin(angle) * dropDist)),
      },
      createdAt: Date.now(),
    };
    const newItems = [...groundItemsRef.current, dropped];
    groundItemsRef.current = newItems;
    setGroundItems(newItems);
  };

  const handleRetry = () => {
    const freshPlayer = makePlayer();
    const freshAbilities = makeAbilities();
    playerRef.current = freshPlayer;
    mobsRef.current = [];
    alliesRef.current = [];
    abilitiesRef.current = freshAbilities;
    projectilesRef.current = [];
    hitFlashesRef.current = [];
    waveRef.current = 1;
    waveMobsToSpawnRef.current = mobCountForWave(1);
    waveMobsSpawnedRef.current = 0;
    waveActiveRef.current = true;
    gameOverRef.current = false;
    groundItemsRef.current = [];
    inventoryRef.current = makeInventory();
    waveLootDroppedRef.current = false;
    spawnTimerRef.current = 0;
    lastTimeRef.current = null;

    setPlayer(freshPlayer);
    setMobs([]);
    setAllies([]);
    setAbilities(freshAbilities);
    setAimingAbility(null);
    setAimPreviewPoint(null);
    setProjectiles([]);
    setHitFlashes([]);
    setWave(1);
    setWaveMobsToSpawn(mobCountForWave(1));
    setWaveMobsSpawned(0);
    setWaveActive(true);
    setGameOver(false);
    setGroundItems([]);
    setInventory(makeInventory());
  };

  useEffect(() => {
    const step = (time: number) => {
      if (gameOverRef.current) {
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

      const inv = inventoryRef.current;
      const dmgBonus = sumInventoryBonus(inv, 'dmg');
      const atkSpdBonusPct = sumInventoryBonus(inv, 'atkspd');
      const manaBonus = sumInventoryBonus(inv, 'mana');
      const manaRegenBonus = sumInventoryBonus(inv, 'manaregen');
      const hpBonus = sumInventoryBonus(inv, 'health');
      const hpRegenBonus = sumInventoryBonus(inv, 'healthregen');
      const effectiveMaxMana = MANA_MAX + manaBonus;

      // Resolve in-flight projectiles: damage lands only on arrival
      const stillFlying: Projectile[] = [];
      for (const pr of projectilesRef.current) {
        if (now - pr.createdAt >= pr.duration) {
          const target = currentMobs.find((m) => m.id === pr.targetId);
          if (target && target.hp > 0) target.hp -= pr.damage;
          newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...pr.to }, createdAt: now });
        } else {
          stillFlying.push(pr);
        }
      }

      // Player movement toward target
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
        }
      }

      p.pos.x = Math.max(PLAYER_RADIUS, Math.min(SCREEN_W - PLAYER_RADIUS, p.pos.x));
      p.pos.y = Math.max(PLAYER_RADIUS, Math.min(PLAY_H - PLAYER_RADIUS, p.pos.y));

      p.mana = Math.min(effectiveMaxMana, p.mana + (MANA_REGEN_PER_SEC + manaRegenBonus) * dt);
      p.hp = Math.min(p.maxHp + hpBonus, p.hp + hpRegenBonus * dt);
      p.attackCooldown = Math.max(0, p.attackCooldown - dt);
      p.hasteTimer = Math.max(0, p.hasteTimer - dt);

      // Ground item pickup (walk into it)
      const unexpiredItems = groundItemsRef.current.filter((it) => now - it.createdAt < ITEM_DESPAWN_MS);
      const newInventory = inventoryRef.current.slice();
      const remainingItems: GroundItem[] = [];
      for (const it of unexpiredItems) {
        if (dist(p.pos, it.pos) <= ITEM_PICKUP_RADIUS) {
          const freeSlot = newInventory.indexOf(null);
          if (freeSlot !== -1) {
            newInventory[freeSlot] = it.kind;
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

      let damageToPlayer = 0;
      let xpGain = 0;

      // Mob AI: chase/attack nearest of player (uses the player's attack range as detection range) or allies
      for (const m of currentMobs) {
        m.attackCooldown = Math.max(0, m.attackCooldown - dt);

        let nearest: Target | null = null;
        let nearestDist = Infinity;
        const dToPlayer = dist(m.pos, p.pos);
        if (dToPlayer <= playerAttackRange) {
          nearest = { kind: 'player', pos: p.pos };
          nearestDist = dToPlayer;
        }
        for (const a of currentAllies) {
          if (a.hp <= 0) continue;
          const dToAlly = dist(m.pos, a.pos);
          if (dToAlly <= MOB_CHASE_RANGE && dToAlly < nearestDist) {
            nearest = { kind: 'ally', id: a.id, pos: a.pos };
            nearestDist = dToAlly;
          }
        }

        if (nearest) {
          const d = nearestDist;
          if (d <= MOB_ATTACK_RANGE) {
            if (m.attackCooldown <= 0) {
              if (nearest.kind === 'player') {
                damageToPlayer += m.damage;
                newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...p.pos }, createdAt: now });
              } else {
                const ally = currentAllies.find((a) => a.id === nearest.id);
                if (ally) {
                  ally.hp -= m.damage;
                  newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...ally.pos }, createdAt: now });
                }
              }
              m.attackCooldown = MOB_ATTACK_COOLDOWN;
            }
          } else {
            const dx = nearest.pos.x - m.pos.x;
            const dy = nearest.pos.y - m.pos.y;
            const step = MOB_SPEED * dt;
            const ratio = Math.min(1, step / d);
            m.pos = { x: m.pos.x + dx * ratio, y: m.pos.y + dy * ratio };
          }
        } else {
          m.pos = { x: m.pos.x, y: m.pos.y + MOB_SPEED * 0.5 * dt };
        }
      }

      // Player attack: melee hits everything in range instantly, ranged fires projectiles
      if (p.attackCooldown <= 0) {
        if (isRangedAttack) {
          const candidates = currentMobs
            .filter((m) => m.hp > 0 && dist(m.pos, p.pos) <= playerAttackRange)
            .sort((a, b) => dist(a.pos, p.pos) - dist(b.pos, p.pos))
            .slice(0, rangedTargetCount(ability3Level));
          if (candidates.length > 0) {
            for (const target of candidates) {
              newProjectiles.push({
                id: ++projectileIdCounter,
                from: { ...p.pos },
                to: { ...target.pos },
                createdAt: now,
                duration: Math.max(80, (dist(p.pos, target.pos) / PROJECTILE_SPEED) * 1000),
                color: '#e1f5fe',
                damage: playerDamage,
                targetId: target.id,
              });
            }
            p.attackCooldown = attackCooldownDuration;
          }
        } else {
          let hitAny = false;
          for (const m of currentMobs) {
            if (m.hp > 0 && dist(m.pos, p.pos) <= playerAttackRange) {
              m.hp -= playerDamage;
              hitAny = true;
              newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...m.pos }, createdAt: now });
            }
          }
          if (hitAny) p.attackCooldown = attackCooldownDuration;
        }
      }

      // Ally AI: chase/attack nearest mob
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
                    targetId: mob.id,
                  });
                } else {
                  mob.hp -= a.damage;
                  newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...mob.pos }, createdAt: now });
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
      for (const m of currentMobs) {
        if (m.hp > 0) survivorMobs.push(m);
        else xpGain += MOB_XP_REWARD;
      }
      const survivorAllies = currentAllies.filter((a) => a.hp > 0);

      if (damageToPlayer > 0) p.hp = Math.max(0, p.hp - damageToPlayer);

      if (xpGain > 0) {
        p.xp += xpGain;
        while (p.xp >= p.xpToNext) {
          p.xp -= p.xpToNext;
          p.level += 1;
          p.xpToNext = xpForLevel(p.level);
          p.maxHp += 10;
          p.hp = p.maxHp + hpBonus;
          p.abilityPoints += 1;
        }
      }

      // Wave spawning: burst of mobs, then a break until the player starts the next wave
      let newWaveMobsSpawned = waveMobsSpawnedRef.current;
      let newWaveActive = waveActiveRef.current;
      if (waveActiveRef.current && newWaveMobsSpawned < waveMobsToSpawnRef.current) {
        spawnTimerRef.current += dt;
        if (spawnTimerRef.current >= WAVE_SPAWN_INTERVAL) {
          spawnTimerRef.current = 0;
          survivorMobs.push(spawnMob(waveRef.current));
          newWaveMobsSpawned += 1;
        }
        if (newWaveMobsSpawned >= waveMobsToSpawnRef.current) {
          newWaveActive = false;
        }
      }

      // Wave cleared: drop a random item once per wave
      if (!newWaveActive && survivorMobs.length === 0 && !waveLootDroppedRef.current) {
        remainingItems.push(spawnRandomGroundItem());
        waveLootDroppedRef.current = true;
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

      const isGameOver = p.hp <= 0;

      playerRef.current = p;
      mobsRef.current = survivorMobs;
      alliesRef.current = survivorAllies;
      abilitiesRef.current = newAbilities;
      projectilesRef.current = survivorProjectiles;
      hitFlashesRef.current = survivorFlashes;
      waveMobsSpawnedRef.current = newWaveMobsSpawned;
      waveActiveRef.current = newWaveActive;
      gameOverRef.current = isGameOver;
      groundItemsRef.current = remainingItems;
      inventoryRef.current = newInventory;
      setPlayer(p);
      setMobs(survivorMobs);
      setAllies(survivorAllies);
      setAbilities(newAbilities);
      setProjectiles(survivorProjectiles);
      setHitFlashes(survivorFlashes);
      setWaveMobsSpawned(newWaveMobsSpawned);
      setWaveActive(newWaveActive);
      if (isGameOver) setGameOver(true);
      setGroundItems(remainingItems);
      setInventory(newInventory);
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
  const dmgBonusDisplay = sumInventoryBonus(inventory, 'dmg');
  const atkSpdBonusPctDisplay = sumInventoryBonus(inventory, 'atkspd');
  const manaBonusDisplay = sumInventoryBonus(inventory, 'mana');
  const hpBonusDisplay = sumInventoryBonus(inventory, 'health');
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

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Text style={styles.topBarText}>Wave {wave}</Text>
        <Text style={styles.topBarText}>Mob HP {mobHpForWave(wave)}</Text>
        <Text style={styles.topBarText}>Mob DMG {mobDamageForWave(wave)}</Text>
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
          const meta = ITEM_META[it.kind];
          return (
            <View
              key={it.id}
              style={[
                styles.groundItem,
                { left: it.pos.x - ITEM_SIZE / 2, top: it.pos.y - ITEM_SIZE / 2, backgroundColor: meta.color },
              ]}
            >
              <Text style={styles.groundItemText}>{meta.label}</Text>
            </View>
          );
        })}

        {allies.map((a) => (
          <View key={a.id}>
            <View
              style={[
                styles.ally,
                { left: a.pos.x - ALLY_RADIUS, top: a.pos.y - ALLY_RADIUS, backgroundColor: a.ranged ? '#b39ddb' : '#9575cd' },
              ]}
            />
            <View style={[styles.mobHpBarBg, { left: a.pos.x - ALLY_RADIUS, top: a.pos.y - ALLY_RADIUS - 8, width: ALLY_RADIUS * 2 }]}>
              <View style={[styles.mobHpBarFill, { width: (ALLY_RADIUS * 2) * (a.hp / a.maxHp), backgroundColor: '#7e57c2' }]} />
            </View>
          </View>
        ))}

        <View style={[styles.player, { left: player.pos.x - PLAYER_RADIUS, top: player.pos.y - PLAYER_RADIUS }]} />

        {mobs.map((m) => (
          <View key={m.id}>
            <View style={[styles.mob, { left: m.pos.x - MOB_RADIUS, top: m.pos.y - MOB_RADIUS }]} />
            <View style={[styles.mobHpBarBg, { left: m.pos.x - MOB_RADIUS, top: m.pos.y - MOB_RADIUS - 8 }]}>
              <View style={[styles.mobHpBarFill, { width: (MOB_RADIUS * 2) * (m.hp / m.maxHp) }]} />
            </View>
          </View>
        ))}

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
          <Text style={styles.hudStatText}>AP {player.abilityPoints}</Text>
          <Text style={styles.hudStatText}>DMG {displayDamage}</Text>
          <Text style={styles.hudStatText}>SPD {displayAtkSpeed.toFixed(1)}/s</Text>
        </View>
      </View>

      <View style={styles.inventoryBar}>
        {inventory.map((slot, index) => (
          <Pressable
            key={index}
            onPress={() => handleInventorySlotPress(index)}
            style={[styles.inventorySlot, slot != null && { backgroundColor: ITEM_META[slot].color, borderColor: 'transparent' }]}
          >
            {slot != null && <Text style={styles.inventorySlotText}>{ITEM_META[slot].label}</Text>}
          </Pressable>
        ))}
      </View>

      <View style={styles.abilityBar}>
        {([1, 2, 3] as AbilityId[]).map((id) => {
          const ab = abilities[id];
          const meta = abilityMeta[id];
          const cost = ABILITY_MANA_COST[id];
          const locked = ab.level <= 0;
          const onCooldown = ab.cooldown > 0;
          const canCast = !locked && !onCooldown && player.mana >= cost;
          const isAiming = aimingAbility === id;
          const canLevelUp = player.abilityPoints > 0 && ab.level < ABILITY_MAX_LEVEL;

          return (
            <View key={id} style={styles.abilitySlot}>
              <Pressable
                onPress={() => handleAbilityPress(id)}
                style={[
                  styles.abilityButton,
                  { backgroundColor: meta.color },
                  locked && styles.abilityLocked,
                  !locked && !canCast && styles.abilityDim,
                  isAiming && styles.abilityAiming,
                  id === 3 && player.hasteTimer > 0 && styles.abilityHaste,
                ]}
              >
                {onCooldown && (
                  <View style={styles.cooldownOverlay}>
                    <Text style={styles.cooldownText}>{Math.ceil(ab.cooldown)}</Text>
                  </View>
                )}
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

              <Text style={styles.abilityLabel}>{meta.label}</Text>
              <Text style={styles.abilityCostText}>{cost} MP</Text>
            </View>
          );
        })}
      </View>

      {gameOver && (
        <View style={styles.gameOverOverlay}>
          <Text style={styles.gameOverText}>Game Over</Text>
          <Pressable onPress={handleRetry} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
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
    fontSize: 13,
    fontWeight: '600',
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
  player: {
    position: 'absolute',
    width: PLAYER_RADIUS * 2,
    height: PLAYER_RADIUS * 2,
    borderRadius: PLAYER_RADIUS,
    backgroundColor: '#4fc3f7',
  },
  mob: {
    position: 'absolute',
    width: MOB_RADIUS * 2,
    height: MOB_RADIUS * 2,
    borderRadius: MOB_RADIUS,
    backgroundColor: '#e05555',
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
    width: MOB_RADIUS * 2,
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
  groundItem: {
    position: 'absolute',
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groundItemText: {
    color: '#1b1b2b',
    fontSize: 8,
    fontWeight: 'bold',
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
  inventoryBar: {
    height: INVENTORY_BAR_HEIGHT,
    backgroundColor: '#0b0b18',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  inventorySlot: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  inventorySlotText: {
    color: '#1b1b2b',
    fontSize: 9,
    fontWeight: 'bold',
  },
  abilityBar: {
    height: ABILITY_BAR_HEIGHT,
    backgroundColor: '#0b0b18',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 22,
  },
  abilitySlot: {
    alignItems: 'center',
  },
  abilityButton: {
    width: 60,
    height: 60,
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
  cooldownOverlay: {
    position: 'absolute',
    width: 60,
    height: 60,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cooldownText: {
    color: '#fff',
    fontSize: 18,
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
  abilityLabel: {
    color: '#ccc',
    fontSize: 11,
    marginTop: 2,
  },
  abilityCostText: {
    color: '#888',
    fontSize: 9,
    marginTop: 1,
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

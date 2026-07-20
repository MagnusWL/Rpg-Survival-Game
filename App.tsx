import AsyncStorage from '@react-native-async-storage/async-storage';
import CoinSackView, { COINSACK_ASSETS, CoinSackHandle, SACK_MIN_W } from './CoinSackView';
import GameCanvasLoader from './GameCanvasLoader';
import GameCanvasTextOverlay from './GameCanvasTextOverlay';
import IntroSequence from './IntroSequence';
import MenuTearButton, { TEAR_MS, TearHandle } from './MenuTearButton';
import PerfOverlay, { bumpSimTick } from './PerfOverlay';
import { Asset } from 'expo-asset';
import { AudioPlayer, useAudioPlayer } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import { memo, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  GestureResponderEvent,
  Image,
  ImageSourcePropType,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { BlendMode } from 'react-native';
import {
  ALLY_ATTACK_COOLDOWN,
  ALLY_ATTACK_RANGE,
  ALLY_ENGAGE_RANGE,
  ALLY_RADIUS,
  ALLY_RANGED_ATTACK_RANGE,
  ALLY_RANGED_ENGAGE_RANGE,
  ALLY_SPEED,
  Ally,
  AnimName,
  ANIMS,
  ATTACK_FROM,
  ATTACK_LEADS,
  ATTACK_STRIKE_FRAME,
  BLOOD_ANIM,
  BLOOD_ANIMS,
  BLOOD_DURATION,
  BLOOD_SIZE,
  BLOOD_VARIANTS,
  BloodSplat,
  BOSS_COINS,
  BOSS_RADIUS,
  BOSS_XP_REWARD,
  buildWaveQueue,
  Corpse,
  CORPSE_FADE,
  CORPSE_LINGER,
  DAMAGE_TEXT_COLOR,
  dist,
  DIE_HOLD,
  directionFromFacing,
  facingForTargets,
  facingFromDelta,
  facingVector,
  FLOATING_TEXT_DURATION,
  FLOATING_TEXT_RISE,
  FloatingText,
  FOOTSTEP_PHASE,
  frameStartTime,
  GORE_EXTRA_SPLATS,
  GORE_LEADS,
  GORE_SPLATTER_SPREAD,
  hasTimeline,
  HIT_FLASH_DURATION,
  HitFlash,
  holdFor,
  HURT_ANIM_MIN_GAP,
  hurtMob,
  INTRO_HOLD_FRAME,
  INTRO_SETTLE,
  INTRO_START_BELOW,
  INTRO_STOP_ABOVE_BOTTOM,
  INTRO_WALK_ANIM,
  INTRO_WALK_SPEED,
  KICK_ARC_COS,
  KICK_CHANCE,
  KICK_CONTACT_FRAME,
  KICK_LEADS,
  KICK_RANGE,
  KILL_LEADS,
  KILL_SFX_CHANCE,
  KNOCKBACK_SPEED,
  KNOCKBACK_STOP,
  KNOCKBACK_TAU,
  KNOCKBACK_VARIATION,
  makeAlliesForLevel,
  makeFloatingText,
  makePlayer,
  MANA_MAX,
  MANA_REGEN_PER_SEC,
  Mob,
  MOB_ANIMS,
  MOB_ATTACK_ANIMS,
  MOB_ATTACK_COOLDOWN,
  MOB_ATTACK_RANGE,
  MOB_COIN_CHANCE,
  MOB_DAMAGE,
  MOB_DIE_ANIMS,
  MOB_FLASH_COLOR,
  MOB_FLASH_STRENGTH,
  MOB_FLASH_TIME,
  MOB_HURT_ANIM_MIN_GAP,
  MOB_MAX_HP,
  MOB_RADIUS,
  MOB_RANGED_FIRE_RANGE,
  MOB_SPEED,
  MOB_SPRITE_FOOT_OFFSET,
  MOB_SPRITE_SIZE,
  MOB_TYPE_META,
  MOB_XP_REWARD,
  MobAnimName,
  MobDieAnimName,
  MobType,
  normalizeAngle,
  PLAYER_ATTACK_COOLDOWN,
  PLAYER_ATTACK_RANGE,
  PLAYER_BASE_DAMAGE,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PLAYER_SPRITE_FOOT_OFFSET,
  PLAYER_SPRITE_SIZE,
  PlayerState,
  playSfx,
  playSteps,
  playStepsCache,
  animColumn,
  animDuration,
  animSpan,
  bossTierForWave,
  mobCountForWave,
  mobDamageForWave,
  mobHpForWave,
  mobTypeStats,
  rangedCountForWave,
  waveComposition,
  Projectile,
  PROJECTILE_SPEED,
  RANGED_ATTACK_RANGE,
  SFX_STATE,
  shoveMob,
  SPRITE_CELL,
  SPRITE_COLS,
  SPRITE_ROW_FOR_EAST,
  SPRITE_ROWS,
  SpriteSheet,
  spawnMob,
  SKILL_MARK_DURATION,
  STEPS_PER_CYCLE,
  SWING_STRIKE_AT,
  TAKEN_TEXT_COLOR,
  Vec,
  WALK_STRIDE,
  WAVE_SPAWN_INTERVAL,
  XP_TEXT_COLOR,
  xpForLevel,
} from './combat';
import type { AnimDef } from './combat';
import {
  BAG_SLOTS,
  equippedBonus,
  EQUIP_SLOTS,
  GroundItem,
  INV_DRAG_THRESHOLD,
  Item,
  ITEM_DEFS,
  ITEM_DESPAWN_MS,
  ITEM_KINDS,
  ITEM_PICKUP_RADIUS,
  ITEM_SIZE,
  itemBonus,
  ItemKind,
  itemTooltip,
  makeItem,
  Slot,
  spawnLoot,
} from './items';
import {
  ABILITY2_HALF_ANGLE_DEG,
  ABILITY3_HASTE_DURATION,
  ABILITY_MAX_LEVEL,
  ability1Stats,
  ability2BaseDamage,
  ability2DamagePercent,
  ability3DamageBonus,
  Abilities,
  Ability,
  AbilityId,
  ALL_SKILLS,
  BURN_EXPLODE_RADIUS,
  burnDamagePerSec,
  burnExplodePercent,
  cooldownReducePercent,
  CONE_ARC_SHEET,
  CONE_ARCS,
  CONE_DAMAGE_RIDES_WAVE,
  CONE_RANGE,
  CONE_ZONE,
  CONE_ZONE_MS,
  ConeZone,
  ConeZoneFx,
  fireballDamagePercent,
  FIREBALL_RADIUS,
  fireCone,
  isPassiveSkill,
  MAX_EQUIPPED,
  MAX_PASSIVE,
  nearestTarget,
  PassiveState,
  pierceTargetCount,
  pushDamagePercent,
  PUSH_SPEED,
  PendingConeHit,
  PIERCE_WIDTH,
  ROOT_SKILLS,
  RUPTURE_ZONE_DELAY_MS,
  RUPTURE_ZONE_FRAME,
  SKILL_LEVEL_COST,
  SKILL_META,
  SKILL_PARENT,
  skillDescription,
  skillLevelCost,
  skillStatsSuffix,
  SkillCast,
  SkillId,
  summonRegenPerSec,
  Target,
} from './skills';
import {
  BACKGROUND,
  bgDrawnH,
  bgDrawnW,
  bgOffsetX,
  bgOffsetY,
  BG_ASPECT,
  BG_SOURCE_H,
  dropStyles,
  feetInWater,
  GLOW,
  GlowStyle,
  groundScale,
  noise,
  onGroundX,
  onGroundY,
  PLAYER_GLOW,
  PUDDLE_SPOTS,
  RAIN,
  RAIN_DRIFT,
  RAIN_ENABLED,
  RAIN_FALL_FRAMES,
  RAIN_SPAN,
  RAIN_STREAKS,
  RAIN_TILT_X,
  RainLayer,
  rgb,
  RIM_STYLE,
  RimStyle,
  ringStyles,
  RIPPLE,
  RIPPLE_CELL,
  RIPPLE_POOL,
  RIPPLE_SPREAD_FRAMES,
  RippleLayer,
  RIPPLES,
} from './effects';
import {
  buildFreshState,
  buildStateFromSave,
  buildTestState,
  defaultMeta,
  GameState,
  goldForWavesCleared,
  loadMeta,
  loadRuns,
  makeAbilities,
  MetaState,
  META_STORAGE_KEY,
  persistMeta,
  persistRuns,
  RunSave,
  RUNS_STORAGE_KEY,
  sanitizeMeta,
} from './menu';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const TOP_BAR_HEIGHT = 50;
// Sized to what is in them rather than by eye, since every pixel here is one
// the field does not get. The quick-cast buttons rise up out of this strip, so
// it only needs to cover their lower portion. The HUD's label and value now
// share a line, so it needs one row less than before.
const QUICK_CAST_BAR_HEIGHT = 48;
const HUD_HEIGHT = 60;
// The bottom menu bar is gone (Inventory moved up beside the skills), so the
// field takes the height it used to hold and the lower UI sits at the bottom.
const PLAY_H = SCREEN_H - TOP_BAR_HEIGHT - QUICK_CAST_BAR_HEIGHT - HUD_HEIGHT;
const BAR_WIDTH = 80;

// A frame-time readout in the corner while we work out what is costing what.
// Reports once a second, so watching is nearly free.
const DEBUG_PERF = true;

// On-screen sliders for the rim light, in the same spirit as the coin sack's.
// Off now that the moon looks right -- the panel is not rendered and its state
// costs nothing, so it is one word to bring back when the colour is next in
// question. RIM_STYLE above is what the game uses.
const DEBUG_RIM_TUNING = false;

// --- Menu ------------------------------------------------------------------
// The title screen. The art carries the game's name, so nothing is drawn over
// it -- only the plaque that starts a run sits on top.
const MENU_BG = require('./assets/sprites/menu/bg.jpg');
const MENU_BUTTON = require('./assets/sprites/menu/button.png');
const ITEM_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(ITEM_DEFS).map(([kind, definition]) => [kind, definition.color])
);

/**
 * Where the plaque goes, taken from the kit's own layout: a 380x675 stage with
 * the button at x 29, y 474, 322 by 115.
 *
 * Kept as fractions rather than pixels so it holds its place on any screen. The
 * width is measured against the screen rather than against the drawn art on
 * purpose -- a phone is narrower than the picture, so cover crops the sides,
 * and following the art there would hang the plaque's ends off both edges.
 */
const MENU_BUTTON_TOP = 474 / 675;
const MENU_BUTTON_WIDTH = 322 / 380;
const MENU_BUTTON_ASPECT = 322 / 115;

/** Where the plaque ends up, which the tear needs in order to draw it torn. */
const MENU_BUTTON_RECT = {
  x: (SCREEN_W * (1 - MENU_BUTTON_WIDTH)) / 2,
  y: SCREEN_H * MENU_BUTTON_TOP,
  w: SCREEN_W * MENU_BUTTON_WIDTH,
  h: (SCREEN_W * MENU_BUTTON_WIDTH) / MENU_BUTTON_ASPECT,
};

/**
 * Where the title sits, so the sparkles land on it.
 *
 * This one does have to follow the art, since it is lettering painted into the
 * picture -- so it goes through the same cover fit the background is drawn with
 * rather than being measured against the screen like the plaque is.
 */
const MENU_ART_ASPECT = 941 / 1672;
const menuDrawnW = Math.max(SCREEN_W, SCREEN_H * MENU_ART_ASPECT);
const menuDrawnH = Math.max(SCREEN_H, SCREEN_W / MENU_ART_ASPECT);
const onMenuX = (fx: number) => (SCREEN_W - menuDrawnW) / 2 + fx * menuDrawnW;
const onMenuY = (fy: number) => (SCREEN_H - menuDrawnH) / 2 + fy * menuDrawnH;
const MENU_LOGO_RECT = {
  x0: onMenuX(65 / 380),
  y0: onMenuY(60 / 675),
  x1: onMenuX(315 / 380),
  y1: onMenuY(168 / 675),
};

/**
 * The way out of the menu: to black, and back off once the field is behind it.
 *
 * There was a red wash under the black to begin with, on the theory that the
 * screen should go the way the plaque did. Black alone turned out to be the
 * stronger of the two -- the tear has already said what it needs to.
 */
const LEAVE_FADE_MS = 600;
const LEAVE_HOLD_MS = 140;
const RETURN_MS = 560;

/**
 * Where the sack sits, measured from the bottom left of the screen. Nicolai's
 * numbers, found with the sliders at a phone's width.
 *
 * It floats over the bars rather than sitting in one: the sack is 170 px tall
 * at full size and the tallest bar is 84, and the engine crops rather than
 * squashes when the box is the wrong shape. As placed, its foot is in the
 * quick-cast bar and it reaches about 80 px up into the field.
 *
 * First numbers for the skull, not tuned ones: centred (the kit's 254 px
 * minimum width on a 390 screen leaves 68 a side) and sat on the bottom bars
 * with its crown just under the field. The sack these replaced was placed by
 * Nicolai with the sliders; the skull is landscape and three times as wide,
 * so its spot is his to choose the same way -- DEBUG_COINSACK_TUNING brings
 * the panel back.
 */
const COINSACK_LEFT = (SCREEN_W - 254) / 2;
const COINSACK_BOTTOM = 8;
const COINSACK_WIDTH = 254;

/**
 * The crowned skull, parked. Nicolai's call, 20 July: the design is approved
 * -- "den er flot" -- but it stays off the field until it has a placement
 * that clears Magnus's loadout bar, and until then it should not cost a
 * frame. Off means not rendered at all: no engine, no physics, no canvas,
 * and its seventeen assets are left out of the boot prefetch too.
 *
 * Bringing it back is this word plus DEBUG_COINSACK_TUNING for the sliders.
 */
const COINSACK_ENABLED = false;

// On-screen sliders for placing the sack -- meaningless without the skull, so
// both flags come back together when it is next in question.
const DEBUG_COINSACK_TUNING = false;

/**
 * Every sheet the game can draw, for loading up front.
 *
 * Nothing that draws them exists until a run starts, so without this the first
 * fetch of the knight begins at the same moment he is first needed and he is
 * invisible until it lands. The sounds already load at start-up because their
 * players are created there; the art had no such thing.
 */
const ALL_SHEETS: number[] = [
  ...Object.values(ANIMS).map((a) => a.sheet),
  // His light travels with him: pulled down with the sheet it belongs to, so a
  // frame and its rim never arrive apart.
  ...Object.values(ANIMS).flatMap((a) => (a.rim ? [a.rim] : [])),
  ...Object.values(MOB_ANIMS).map((a) => a.sheet),
  ...Object.values(MOB_DIE_ANIMS).map((a) => a.sheet),
  BLOOD_ANIM.sheet,
  CONE_ARC_SHEET,
  BACKGROUND,
  GLOW,
] as number[];

type TooltipState = { key: string; text: string; x: number; y: number } | null;

// A simple fading ring left on the ground where a skill hit -- Cone, Fireball,
// Burn and Push each drop one so their impact lingers a beat after the numbers land.
export type SkillMark = { id: number; pos: Vec; radius: number; color: string; createdAt: number };

let projectileIdCounter = 0;
let hitFlashIdCounter = 0;
let skillMarkIdCounter = 0;
let bloodIdCounter = 0;
let corpseIdCounter = 0;
let coneZoneIdCounter = 0;

/**
 * Drag-anywhere slider for the temporary tuning panel. Built on the same
 * responder props the play area uses, so it needs no extra dependency, and it
 * lives outside the play area so dragging it does not also order a move.
 */
function DebugSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const trackWidth = useRef(0);
  const setFromX = (x: number) => {
    if (trackWidth.current <= 0) return;
    const t = Math.max(0, Math.min(1, x / trackWidth.current));
    onChange(Math.round(min + t * (max - min)));
  };
  const pct: `${number}%` = `${((value - min) / (max - min)) * 100}%`;
  return (
    <View style={styles.tuneRow}>
      <Text style={styles.tuneLabel}>{label}</Text>
      <View
        style={styles.tuneTrack}
        onLayout={(e) => {
          trackWidth.current = e.nativeEvent.layout.width;
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => setFromX(e.nativeEvent.locationX)}
        onResponderMove={(e) => setFromX(e.nativeEvent.locationX)}
      >
        <View style={[styles.tuneFill, { width: pct }]} />
        <View style={[styles.tuneKnob, { left: pct }]} />
      </View>
      <Text style={styles.tuneValue}>{value}</Text>
    </View>
  );
}

/**
 * The high-frequency rendering island. The simulation replaces its actor
 * arrays every frame, but the rest of the game screen no longer has to walk
 * this large tree while React reconciles those updates.
 */
const PlayField = memo(function PlayField({
  player,
  mobs,
  corpses,
  allies,
  groundActors,
  playerAttackRange,
  aimingAbility,
  aimPreviewPoint,
  coneZones,
  groundItems,
  bloodSplats,
  projectiles,
  skillMarks,
  hitFlashes,
  floatingTexts,
  weatherOff,
  onGrant,
  onMove,
  onRelease,
  children: _children,
  enabled = true,
}: {
  player: PlayerState;
  mobs: Mob[];
  corpses: Corpse[];
  allies: Ally[];
  groundActors: ReactNode[];
  playerAttackRange: number;
  aimingAbility: AbilityId | null;
  aimPreviewPoint: Vec | null;
  coneZones: ConeZone[];
  groundItems: GroundItem[];
  bloodSplats: BloodSplat[];
  projectiles: Projectile[];
  skillMarks: SkillMark[];
  hitFlashes: HitFlash[];
  floatingTexts: FloatingText[];
  weatherOff: boolean;
  onGrant: (event: GestureResponderEvent) => void;
  onMove: (event: GestureResponderEvent) => void;
  onRelease: (event: GestureResponderEvent) => void;
  children?: ReactNode;
  enabled?: boolean;
}) {
  if (!enabled) return null;
  const renderCone = (angleDeg: number) => {
    const halfRad = (ABILITY2_HALF_ANGLE_DEG * Math.PI) / 180;
    const baseWidth = 2 * CONE_RANGE * Math.tan(halfRad);
    return (
      <View pointerEvents="none" style={{ position: 'absolute', left: player.pos.x - baseWidth / 2, top: player.pos.y - CONE_RANGE, width: baseWidth, height: CONE_RANGE * 2, transform: [{ rotate: `${angleDeg - 90}deg` }] }}>
        <View style={{ position: 'absolute', top: CONE_RANGE, left: 0, width: 0, height: 0, borderLeftWidth: baseWidth / 2, borderRightWidth: baseWidth / 2, borderBottomWidth: CONE_RANGE, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: 'rgba(255,138,80,0.28)' }} />
      </View>
    );
  };

  return (
    <View style={styles.playArea} onStartShouldSetResponder={() => true} onResponderGrant={onGrant} onResponderMove={onMove} onResponderRelease={onRelease}>
      <Image source={BACKGROUND} style={styles.background} resizeMode="cover" />
      <View pointerEvents="none" style={[styles.rangeRing, { width: playerAttackRange * 2, height: playerAttackRange * 2, borderRadius: playerAttackRange, left: player.pos.x - playerAttackRange, top: player.pos.y - playerAttackRange }]} />
      {aimingAbility === 2 && aimPreviewPoint && renderCone((Math.atan2(aimPreviewPoint.y - player.pos.y, aimPreviewPoint.x - player.pos.x) * 180) / Math.PI)}
      {coneZones.map((z) => z.startAt <= Date.now() ? <ConeZoneFx key={`czone-${z.id}`} zone={z} /> : null)}
      {groundItems.map((it) => {
        const def = ITEM_DEFS[it.item.kind];
        return <View key={it.item.id} style={[styles.groundItem, { left: it.pos.x - ITEM_SIZE / 2, top: it.pos.y - ITEM_SIZE / 2, backgroundColor: def.color }]}><Text style={styles.groundItemText}>{it.item.level}</Text></View>;
      })}
      {bloodSplats.map((b) => <SpriteSheet key={b.id} anims={BLOOD_ANIMS} anim="blood" animTime={(Date.now() - b.createdAt) / 1000} facing={b.variant} size={BLOOD_SIZE} left={b.pos.x - BLOOD_SIZE / 2} top={b.pos.y - BLOOD_SIZE / 2} />)}
      {RAIN_ENABLED && !weatherOff && PUDDLE_SPOTS.length > 0 && <RippleLayer />}
      {groundActors}
      {RAIN_ENABLED && !weatherOff && <RainLayer />}
      {projectiles.map((pr) => {
        const progress = Math.min(1, (Date.now() - pr.createdAt) / pr.duration);
        return <View key={pr.id} style={[styles.projectile, { left: pr.from.x + (pr.to.x - pr.from.x) * progress - 4, top: pr.from.y + (pr.to.y - pr.from.y) * progress - 4, backgroundColor: pr.color }]} />;
      })}
      {skillMarks.map((m) => {
        const age = Date.now() - m.createdAt;
        if (age < 0) return null;
        const t = Math.min(1, age / SKILL_MARK_DURATION);
        const size = m.radius * 2 * (1 + t * 0.15);
        return <View key={m.id} style={[styles.skillMark, { left: m.pos.x - size / 2, top: m.pos.y - size / 2, width: size, height: size, borderRadius: size / 2, borderColor: m.color, opacity: 0.55 * (1 - t) }]} />;
      })}
      {hitFlashes.map((f) => <View key={f.id} style={[styles.hitFlash, { left: f.pos.x - 10, top: f.pos.y - 10, opacity: Math.max(0, 1 - (Date.now() - f.createdAt) / HIT_FLASH_DURATION) }]} />)}
      {floatingTexts.map((f) => {
        const t = Math.min(1, (Date.now() - f.createdAt) / FLOATING_TEXT_DURATION);
        return <Text key={f.id} pointerEvents="none" style={[styles.floatingText, { left: f.pos.x - 25, top: f.pos.y - t * FLOATING_TEXT_RISE - 10, color: f.color, opacity: Math.max(0, 1 - t) }]}>{f.text}</Text>;
      })}
    </View>
  );
});

export default function App() {
  const [screen, setScreen] = useState<'menu' | 'continue' | 'skilltree' | 'game'>('menu');
  /**
   * Whether the story has been through once. It never goes back to false, so
   * the intro plays on the first sight of the menu and not on the way back to
   * it from a run.
   */
  const [introDone, setIntroDone] = useState(false);
  const [savedRuns, setSavedRuns] = useState<RunSave[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [meta, setMeta] = useState<MetaState>(defaultMeta());
  // Gold earned by the run that just ended, shown on the Game Over screen.
  const [lastRunGold, setLastRunGold] = useState(0);
  const [player, setPlayer] = useState<PlayerState>(makePlayer());
  const [mobs, setMobs] = useState<Mob[]>([]);
  const [allies, setAllies] = useState<Ally[]>([]);
  const [abilities, setAbilities] = useState<Abilities>(makeAbilities(defaultMeta().loadout, defaultMeta().skillLevels));
  const [passive, setPassive] = useState<PassiveState>(null);
  const [aimingAbility, setAimingAbility] = useState<AbilityId | null>(null);
  const [aimPreviewPoint, setAimPreviewPoint] = useState<Vec | null>(null);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [hitFlashes, setHitFlashes] = useState<HitFlash[]>([]);
  const [skillMarks, setSkillMarks] = useState<SkillMark[]>([]);
  const [bloodSplats, setBloodSplats] = useState<BloodSplat[]>([]);
  const [corpses, setCorpses] = useState<Corpse[]>([]);
  const [coneZones, setConeZones] = useState<ConeZone[]>([]);

  // The tuning panel drives these while DEBUG_COINSACK_TUNING is on; the
  // constants above take over the moment it is switched off.
  const [tuneSackLeft, setTuneSackLeft] = useState(COINSACK_LEFT);
  const [tuneSackBottom, setTuneSackBottom] = useState(COINSACK_BOTTOM);
  const [tuneSackWidth, setTuneSackWidth] = useState(COINSACK_WIDTH);

  // Same arrangement for the rim light: the panel drives these while
  // DEBUG_RIM_TUNING is on, and RIM_STYLE takes over when it goes off. Strength
  // is held as a whole number because the slider deals in those.
  const [tuneRimR, setTuneRimR] = useState(RIM_STYLE.color[0]);
  const [tuneRimG, setTuneRimG] = useState(RIM_STYLE.color[1]);
  const [tuneRimB, setTuneRimB] = useState(RIM_STYLE.color[2]);
  const [tuneRimStrength, setTuneRimStrength] = useState(Math.round(RIM_STYLE.strength * 100));
  const [tuneRimBlend, setTuneRimBlend] = useState<BlendMode>(RIM_STYLE.blend);

  // The hitch hunt's two kill switches: play a minute with a suspect removed
  // entirely and feel whether the stutter went with it. Weather off means the
  // 330 elements are not built at all -- display:none only stopped the paint.
  const [sfxOff, setSfxOff] = useState(false);
  const [weatherOff, setWeatherOff] = useState(false);
  // Music apart from the clips: it goes through its own players below, not
  // through playSfx, so it needs its own switch.
  const [musicOff, setMusicOff] = useState(false);
  /**
   * The master: everything at once. Clips, both music tracks, the rain
   * ambience and the coin sack's own audio context -- the sack is the one
   * the others cannot reach, since the kit plays through WebAudio of its own
   * rather than through playSfx.
   */
  const [allSoundOff, setAllSoundOff] = useState(false);
  /**
   * The skull, gone entirely: engine, physics and its own animation frame
   * chain all die with the unmount. Nicolai suspects it of hitching the game,
   * and this is the same A/B the weather got -- play half a minute without it
   * and let the readout speak. Toggling it back builds a fresh, empty skull;
   * the coins in it are decoration, so nothing of worth is lost.
   */
  const [sackOff, setSackOff] = useState(false);
  // Whether the technical readout (fps/sim/dom counters) is shown at all.
  // Starts on DEBUG_PERF's say-so but is a real runtime toggle from here on,
  // reachable from the settings overlay instead of only a build flag.
  const [techAreaOn, setTechAreaOn] = useState(DEBUG_PERF);
  // The module flag follows the state rather than being set beside it, so the
  // two cannot drift apart -- a hot reload keeps module variables and resets
  // state, and setting both in the toggle left the label saying one thing and
  // playSfx doing the other.
  useEffect(() => {
    SFX_STATE.killed = sfxOff || allSoundOff;
  }, [sfxOff, allSoundOff]);

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
  // The boot behind the kick, two takes so the flinches the coin answers do
  // not all sound alike. One player each is plenty: kicks sit at least a
  // flinch-gap apart, and the clip is over in 0.65 s.
  const kickSounds = [
    useAudioPlayer(require('./assets/sounds/kick-1.wav')),
    useAudioPlayer(require('./assets/sounds/kick-2.wav')),
  ];

  // Heavier stab combos for a killing blow. These run 1.0-2.4 s against the
  // swing's 0.6, so each variant gets its own player and can ring out.
  const killSounds = [
    useAudioPlayer(require('./assets/sounds/kill-1.wav')),
    useAudioPlayer(require('./assets/sounds/kill-2.wav')),
    useAudioPlayer(require('./assets/sounds/kill-3.wav')),
  ];

  // The same takes with gore layered in. Drawn from the same pool as the three
  // above; picking one of these is what triggers the extra blood.
  const goreSounds = [
    useAudioPlayer(require('./assets/sounds/gore-1.wav')),
    useAudioPlayer(require('./assets/sounds/gore-2.wav')),
    useAudioPlayer(require('./assets/sounds/gore-3.wav')),
  ];

  // The knight taking a hit, played with the flinch animation. At 0.63 s the
  // clip runs almost exactly as long as the flinch it accompanies. Add variants
  // here as they arrive; name them in tools/sound-config.mjs first.
  const hurtSounds: (AudioPlayer | undefined)[] = [
    useAudioPlayer(require('./assets/sounds/hurt-1.wav')),
  ];

  // Steel leaving the scabbard, for the entrance. It runs 1.6 s against the
  // animation's 0.94, so the ring carries on past the flourish -- which is what
  // a drawn sword sounds like.
  const drawSound = useAudioPlayer(require('./assets/sounds/draw.wav'));

  // His boots. Eleven takes, because a step lands twice a second and hearing
  // the same one twice inside a few paces is what makes footsteps sound fake.
  //
  // A player each rather than a shared pool: they run 0.4 to 1.1 s, longer than
  // the gap between steps, so their tails overlap. That is what walking sounds
  // like, and a shared player would cut each step off with the next.
  const footstepSounds = [
    useAudioPlayer(require('./assets/sounds/footstep-1.wav')),
    useAudioPlayer(require('./assets/sounds/footstep-2.wav')),
    useAudioPlayer(require('./assets/sounds/footstep-3.wav')),
    useAudioPlayer(require('./assets/sounds/footstep-4.wav')),
    useAudioPlayer(require('./assets/sounds/footstep-5.wav')),
    useAudioPlayer(require('./assets/sounds/footstep-6.wav')),
  ];

  // The same steps taken in water, for the ones that land in a puddle.
  const puddleSounds = [
    useAudioPlayer(require('./assets/sounds/puddle-1.wav')),
    useAudioPlayer(require('./assets/sounds/puddle-2.wav')),
    useAudioPlayer(require('./assets/sounds/puddle-3.wav')),
    useAudioPlayer(require('./assets/sounds/puddle-4.wav')),
    useAudioPlayer(require('./assets/sounds/puddle-5.wav')),
    useAudioPlayer(require('./assets/sounds/puddle-6.wav')),
  ];

  // His armour, over whichever ground he lands on. Kept separate from the steps
  // rather than mixed into them beforehand, so the two vary independently: six
  // grounds against eleven rattles is sixty-six different footfalls.
  const armourSounds = [
    useAudioPlayer(require('./assets/sounds/armour-1.wav')),
    useAudioPlayer(require('./assets/sounds/armour-2.wav')),
    useAudioPlayer(require('./assets/sounds/armour-3.wav')),
    useAudioPlayer(require('./assets/sounds/armour-4.wav')),
    useAudioPlayer(require('./assets/sounds/armour-5.wav')),
    useAudioPlayer(require('./assets/sounds/armour-6.wav')),
    useAudioPlayer(require('./assets/sounds/armour-7.wav')),
    useAudioPlayer(require('./assets/sounds/armour-8.wav')),
    useAudioPlayer(require('./assets/sounds/armour-9.wav')),
    useAudioPlayer(require('./assets/sounds/armour-10.wav')),
    useAudioPlayer(require('./assets/sounds/armour-11.wav')),
  ];

  // Music streams rather than being unpacked into memory, so length costs
  // download size and nothing else. Levels are baked in, like everything else.
  const menuMusic = useAudioPlayer(require('./assets/music/menu.mp3'));
  const gameMusic = useAudioPlayer(require('./assets/music/game.mp3'));

  // The weather, under the music rather than beside it. Built as a seamless
  // 22 s loop out of a 105 s field recording -- see AMBIENCE in sound-config.
  const rainAmbience = useAudioPlayer(require('./assets/music/rain.mp3'));

  // Starting a run. All four sound together rather than one being chosen, which
  // is why each is 6 dB down -- they are one sound in four pieces, not a pool.
  const menuPressSounds = [
    useAudioPlayer(require('./assets/sounds/menu-press-1.wav')),
    useAudioPlayer(require('./assets/sounds/menu-press-2.wav')),
    useAudioPlayer(require('./assets/sounds/menu-press-3.wav')),
    useAudioPlayer(require('./assets/sounds/menu-press-4.wav')),
  ];

  const tearRef = useRef<TearHandle>(null);
  // The way out. Held as a ref so it carries on across the screen changing
  // underneath it -- the fade has to outlive the menu it started in.
  const veilBlack = useRef(new Animated.Value(0)).current;
  const leavingRef = useRef(false);

  /** The whole press, all four pieces struck together. */
  const playMenuPress = () => {
    for (const piece of menuPressSounds) playSfx(piece);
  };

  /**
   * Leaves the menu properly rather than cutting away from it.
   *
   * The plaque is given its full second and a third to come apart before
   * anything else happens -- starting the run on the press meant the tear was
   * ordered and then never seen. Then the screen goes with it, and the run only
   * begins once there is black over the top, so the field never appears mid-fade.
   */
  const leaveMenu = (start: () => void) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    playMenuPress();
    tearRef.current?.fire();

    // Every step is on a clock rather than hung off the previous animation's
    // completion. An animation only finishes if frames are being drawn, and a
    // tab that has been throttled draws almost none -- so gating the run on one
    // meant pressing the button and never arriving, which is exactly what
    // happened. The fades are decoration; the schedule is not.
    const fadeAt = tearRef.current ? TEAR_MS : 0;

    setTimeout(() => {
      Animated.timing(veilBlack, { toValue: 1, duration: LEAVE_FADE_MS, useNativeDriver: true }).start();
    }, fadeAt);

    setTimeout(() => {
      start();
      setTimeout(() => {
        Animated.timing(veilBlack, { toValue: 0, duration: RETURN_MS, useNativeDriver: true }).start();
        leavingRef.current = false;
      }, LEAVE_HOLD_MS);
    }, fadeAt + LEAVE_FADE_MS);
  };

  const leaveVeil = <Animated.View style={[styles.leaveVeil, { opacity: veilBlack }]} />;

  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [skillsMenuOpen, setSkillsMenuOpen] = useState(false);
  const [invMenuOpen, setInvMenuOpen] = useState(false);
  const [mobStatsOpen, setMobStatsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState<{ kind: ItemKind; level: number; x: number; y: number } | null>(null);
  const [, setTick] = useState(0);

  const playerRef = useRef(player);
  const metaRef = useRef(meta);
  const mobsRef = useRef(mobs);
  const alliesRef = useRef(allies);
  const abilitiesRef = useRef(abilities);
  const passiveRef = useRef(passive);
  const projectilesRef = useRef(projectiles);
  const hitFlashesRef = useRef(hitFlashes);
  const skillMarksRef = useRef(skillMarks);
  const bloodSplatsRef = useRef(bloodSplats);
  const corpsesRef = useRef(corpses);
  const coneZonesRef = useRef(coneZones);
  /**
   * Blows the wave is still carrying. A ref rather than state because the
   * loop owns them and nothing about them belongs in a saved run.
   */
  const coneHitsRef = useRef<PendingConeHit[]>([]);
  /** The kit's engine, once it has built itself. Null on anything but web. */
  const coinSackRef = useRef<CoinSackHandle>(null);
  const floatingTextsRef = useRef(floatingTexts);
  const waveRef = useRef(wave);
  const waveActiveRef = useRef(waveActive);
  const gameOverRef = useRef(gameOver);
  const groundItemsRef = useRef(groundItems);
  // The canvas reads these directly on its own animation clock.
  const playerAttackRangeRef = useRef(0);
  const aimAngleRef = useRef<number | null>(null);
  const equippedRef = useRef(equipped);
  const bagRef = useRef(bag);
  // One entry per wave that is still spawning, each with its own queue and its
  // own timer -- so several waves spawn side by side (one mob per wave per
  // interval) instead of sharing a single spawn slot and trickling out serially.
  const waveQueueRef = useRef<{ wave: number; types: MobType[]; timer: number }[]>([]);
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
  const goreSoundsRef = useRef(goreSounds);
  goreSoundsRef.current = goreSounds;
  const kickSoundsRef = useRef(kickSounds);
  kickSoundsRef.current = kickSounds;

  // A swing's sound is held back until the blade comes round. These carry that
  // pending sound between frames. They are refs rather than player state because
  // nothing about them belongs in a saved run.
  const swingSoundTimerRef = useRef(0);
  /** Seconds until the kick's leg is out and the crowd is shoved. 0 = no kick pending. */
  const kickShoveTimerRef = useRef(0);
  const swingSoundPlayerRef = useRef<AudioPlayer | undefined>(undefined);
  /** The boot's pending sound, aimed at the same frame the shove fires on. */
  const kickSoundTimerRef = useRef(0);
  const kickSoundPlayerRef = useRef<AudioPlayer | undefined>(undefined);
  /**
   * Seconds left of the death animation and its hold; null while he lives.
   * While set, the knight takes no orders, swings nothing and regenerates
   * nothing -- but the field keeps simulating around him, which is the whole
   * point: he falls in motion instead of freezing mid-hit.
   */
  const dieTimerRef = useRef<number | null>(null);
  /** A cast pose waiting for the animation chain, set the moment a skill fires. */
  const pendingCastAnimRef = useRef<AnimName | null>(null);
  /** Where to throw extra blood when the pending sound turns out to be a gore one. */
  const swingSoundGorePosRef = useRef<Vec | null>(null);
  const hurtSoundsRef = useRef(hurtSounds);
  hurtSoundsRef.current = hurtSounds;
  const drawSoundRef = useRef(drawSound);
  drawSoundRef.current = drawSound;
  const footstepSoundsRef = useRef(footstepSounds);
  footstepSoundsRef.current = footstepSounds;
  const puddleSoundsRef = useRef(puddleSounds);
  puddleSoundsRef.current = puddleSounds;
  const armourSoundsRef = useRef(armourSounds);
  armourSoundsRef.current = armourSounds;
  /** So the same rattle never lands twice running either. */
  const lastArmourRef = useRef(-1);
  /**
   * Which step of the cycle he is on, or null when he is not on his feet.
   *
   * Null is what stops him stamping the moment he starts moving: the first
   * frame back on foot records where the cycle stands without sounding it, and
   * only a change after that is a step.
   */
  const footstepStepRef = useRef<number | null>(null);
  /** So the same take never lands twice running. */
  const lastFootstepRef = useRef(-1);
  const hurtAnimGapRef = useRef(0);

  playerRef.current = player;
  metaRef.current = meta;
  mobsRef.current = mobs;
  alliesRef.current = allies;
  abilitiesRef.current = abilities;
  passiveRef.current = passive;
  projectilesRef.current = projectiles;
  hitFlashesRef.current = hitFlashes;
  skillMarksRef.current = skillMarks;
  bloodSplatsRef.current = bloodSplats;
  corpsesRef.current = corpses;
  coneZonesRef.current = coneZones;
  floatingTextsRef.current = floatingTexts;
  waveRef.current = wave;
  waveActiveRef.current = waveActive;
  gameOverRef.current = gameOver;
  groundItemsRef.current = groundItems;
  equippedRef.current = equipped;
  bagRef.current = bag;
  materialsRef.current = materials;
  screenRef.current = screen;
  overlayOpenRef.current = skillsMenuOpen || invMenuOpen || mobStatsOpen || settingsOpen || tooltip != null;

  // Run bookkeeping: which saved run (if any) is active, and whether this is a
  // throwaway test run that should never be persisted.
  const currentRunIdRef = useRef<string | null>(null);
  const isTestRunRef = useRef(false);
  // Highest wave cleared this run, for the gold banked on death.
  const highestWaveClearedRef = useRef(0);
  // Guards the one-time gold payout when a run ends.
  const goldBankedRef = useRef(false);

  const lastTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    loadRuns().then((runs) => {
      setSavedRuns(runs);
      setRunsLoaded(true);
    });
    loadMeta().then((m) => {
      metaRef.current = m;
      setMeta(m);
    });
  }, []);

  // Spend gold from the account and persist. Used by the main-menu skill shop.
  const commitMeta = (next: MetaState) => {
    metaRef.current = next;
    setMeta(next);
    persistMeta(next);
  };

  // Buy the next level of a skill (its first level unlocks it), if the tree
  // requirement is met and there is gold for it.
  const buySkillLevel = (skill: SkillId) => {
    const m = metaRef.current;
    const level = m.skillLevels[skill] ?? 0;
    if (level >= ABILITY_MAX_LEVEL) return;
    const parent = SKILL_PARENT[skill];
    if (parent && (m.skillLevels[parent] ?? 0) < 1) return; // locked by the tree
    const cost = skillLevelCost(level + 1);
    if (m.gold < cost) return;
    commitMeta({
      ...m,
      gold: m.gold - cost,
      skillLevels: { ...m.skillLevels, [skill]: level + 1 },
    });
  };

  // Toggle a skill in or out of its slot. Passives share a single slot (so
  // equipping one replaces whatever passive was there); actives fill up to three.
  const toggleEquip = (skill: SkillId) => {
    const m = metaRef.current;
    if ((m.skillLevels[skill] ?? 0) < 1) return; // must own it first
    if (isPassiveSkill(skill)) {
      commitMeta({ ...m, passive: m.passive === skill ? null : skill });
      return;
    }
    const has = m.loadout.includes(skill);
    let loadout: SkillId[];
    if (has) {
      loadout = m.loadout.filter((s) => s !== skill);
    } else {
      if (m.loadout.length >= MAX_EQUIPPED) return;
      loadout = [...m.loadout, skill];
    }
    commitMeta({ ...m, loadout });
  };

  // Pull the art down while the menu is up, so a run starts with everything
  // already in hand. Failures are ignored on purpose: a sheet that misses here
  // simply loads when it is first drawn, which is what used to happen anyway.
  //
  // The coin sack's art and coin sounds go with them. Its engine cannot be
  // built until they have arrived, so leaving them until the run starts meant
  // the sack assembled itself in front of the player.
  useEffect(() => {
    Asset.loadAsync(COINSACK_ENABLED ? [...ALL_SHEETS, ...COINSACK_ASSETS] : ALL_SHEETS).catch(() => {});
  }, []);

  // One track for the menu, another once a run is under way.
  //
  // Browsers refuse to start audio before the page has been interacted with, so
  // the menu track may stay silent on a cold load until the first tap. Nothing
  // to be done about that from here, and by the time anyone reaches the menu a
  // second time they have long since clicked something.
  useEffect(() => {
    const playing = screen === 'game' ? gameMusic : menuMusic;
    const quiet = screen === 'game' ? menuMusic : gameMusic;
    try {
      quiet.pause();
      // The music switch takes the two tracks alone; the master takes those
      // and everything below it too.
      if (musicOff || allSoundOff) {
        playing.pause();
      } else {
        playing.loop = true;
        playing.play();
      }

      // Weather belongs to the field, so it runs with a run and stops with it.
      // Nothing to cross-fade: it is quiet enough to simply start.
      if (screen === 'game' && RAIN_ENABLED && !allSoundOff) {
        rainAmbience.loop = true;
        rainAmbience.play();
      } else {
        rainAmbience.pause();
      }
    } catch {
      // music is decoration; never let it take the game down
    }
  }, [screen, musicOff, allSoundOff, gameMusic, menuMusic, rainAmbience]);

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
    if (dropKey && (dropKey.startsWith('equip-') || dropKey.startsWith('bag-'))) {
      applyMove(d.fromKey, dropKey);
    }
  };

  // ---- Play area input ----
  // aimingAbility, when set, is the slot whose (Cone) skill is being aimed.
  const handlePlayAreaGrant = (e: GestureResponderEvent) => {
    // The die-timer check is ours: a falling knight takes no orders.
    if (gameOverRef.current || dieTimerRef.current != null) return;
    const { locationX, locationY } = e.nativeEvent;
    if (aimingAbility != null) {
      setAimPreviewPoint({ x: locationX, y: locationY });
      return;
    }
    // He takes no orders until the sword is out. Tapping used to cut the
    // entrance short on the reasoning that a flourish should not be waited out
    // -- but it is over in well under two seconds now, and a knight who can be
    // marched off mid-draw never looks like he meant to arrive.
    if (playerRef.current.introPhase !== 'done') return;
    setPlayer((p) => ({ ...p, target: { x: locationX, y: locationY } }));
  };

  const handlePlayAreaMove = (e: GestureResponderEvent) => {
    if (gameOverRef.current || aimingAbility == null) return;
    const { locationX, locationY } = e.nativeEvent;
    setAimPreviewPoint({ x: locationX, y: locationY });
  };

  /**
   * Hand the cone's blows to the wave instead of landing them at once.
   *
   * Who is hit and for how much was settled by fireCone at the moment of the
   * cast and is not revisited: the target list is locked, so an enemy that
   * wanders out of the wedge is still struck -- you aimed there. Each blow
   * waits for the front to reach where that enemy stood, which is the same
   * arithmetic the pixels use, so the flash and the line arrive together.
   */
  const queueConeHits = (hits: { id: number; pos: Vec; amount: number }[], origin: Vec) => {
    const now = Date.now();
    const marks: SkillMark[] = [];
    for (const h of hits) {
      const travel = CONE_DAMAGE_RIDES_WAVE
        ? RUPTURE_ZONE_DELAY_MS + (dist(origin, h.pos) / CONE_ZONE.sweepSpeed) * 1000
        : 0;
      coneHitsRef.current.push({ mobId: h.id, amount: h.amount, at: now + travel });
      marks.push({ id: ++skillMarkIdCounter, pos: h.pos, radius: 22, color: SKILL_META.cone.color, createdAt: now + travel });
    }
    if (marks.length > 0) setSkillMarks((prev) => prev.concat(marks));
  };

  const handlePlayAreaRelease = (e: GestureResponderEvent) => {
    if (gameOverRef.current || aimingAbility == null) return;
    const slot = aimingAbility;
    const { locationX, locationY } = e.nativeEvent;
    const p = playerRef.current;
    const ab = abilitiesRef.current[slot];
    const cost = SKILL_META.cone.mana;
    setAimingAbility(null);
    setAimPreviewPoint(null);
    if (dieTimerRef.current != null || ab.skill !== 'cone' || p.mana < cost) return;
    // Ours: the cast pose. The skill's own work below stays exactly as it was.
    pendingCastAnimRef.current = 'rupture';
    // Ours too: the zone lit up on the ground, toward the aimed point.
    setConeZones((prev) =>
      prev.concat({
        id: ++coneZoneIdCounter,
        x: p.pos.x,
        y: p.pos.y,
        angleDeg: (Math.atan2(locationY - p.pos.y, locationX - p.pos.x) * 180) / Math.PI,
        startAt: Date.now() + RUPTURE_ZONE_DELAY_MS,
      })
    );
    const baseDmg = ability2BaseDamage(ab.level);
    const dmgPercent = ability2DamagePercent(ab.level);
    const result = fireCone(p.pos, { x: locationX, y: locationY }, mobsRef.current, baseDmg, dmgPercent, CONE_RANGE, ABILITY2_HALF_ANGLE_DEG);
    // Ours: the blows ride the wave now, so fireCone is called for its aim and
    // its arithmetic only -- result.mobs, which has the damage already taken
    // off, is deliberately not used. The numbers it worked out are delivered
    // untouched, just later.
    queueConeHits(result.hits, p.pos);
    setPlayer((prev) => ({ ...prev, mana: prev.mana - cost }));
    const pv = passiveRef.current;
    const cdScale = pv && pv.skill === 'cdreduce' ? 1 - cooldownReducePercent(pv.level) : 1;
    setAbilities((prev) => ({ ...prev, [slot]: { ...prev[slot], cooldown: SKILL_META.cone.cooldown * cdScale } }));
  };

  const handleAbilityPress = (id: AbilityId) => {
    // The die-timer check is ours: a falling knight casts nothing.
    if (gameOverRef.current || dieTimerRef.current != null) return;
    const ab = abilitiesRef.current[id];
    const p = playerRef.current;
    const skill = ab.skill;
    if (!skill || ab.level <= 0 || ab.cooldown > 0) return;
    if (SKILL_META[skill].cast === 'passive') return; // passives have no active use
    const cost = SKILL_META[skill].mana;
    if (p.mana < cost) return;
    // The Haste passive shaves a share off every skill's cooldown.
    const pv = passiveRef.current;
    const cdScale = pv && pv.skill === 'cdreduce' ? 1 - cooldownReducePercent(pv.level) : 1;

    if (skill === 'summon') {
      // Ours: the cast pose. The summon itself is untouched.
      pendingCastAnimRef.current = 'ancestor';
      setAllies(makeAlliesForLevel(ab.level, p.pos, ability1Stats));
    } else if (skill === 'cone') {
      // Ours: the cast pose. The cone itself is untouched.
      pendingCastAnimRef.current = 'rupture';
      // Fire at once, straight ahead of where the knight is facing.
      const dir = directionFromFacing(p.facing);
      const aim = { x: p.pos.x + dir.x * CONE_RANGE, y: p.pos.y + dir.y * CONE_RANGE };
      // Ours too: the zone lit up on the ground, aimed the same way.
      setConeZones((prev) =>
        prev.concat({
          id: ++coneZoneIdCounter,
          x: p.pos.x,
          y: p.pos.y,
          angleDeg: (Math.atan2(dir.y, dir.x) * 180) / Math.PI,
          startAt: Date.now() + RUPTURE_ZONE_DELAY_MS,
        })
      );
      const result = fireCone(
        p.pos,
        aim,
        mobsRef.current,
        ability2BaseDamage(ab.level),
        ability2DamagePercent(ab.level),
        CONE_RANGE,
        ABILITY2_HALF_ANGLE_DEG
      );
      // Ours: the blows ride the wave, so result.mobs -- which already has
      // the damage taken off -- is deliberately not used. See queueConeHits.
      queueConeHits(result.hits, p.pos);
    } else if (skill === 'ranged') {
      setPlayer((prev) => ({ ...prev, hasteTimer: ABILITY3_HASTE_DURATION }));
    } else if (skill === 'fireball') {
      // A blast off every summon. Nothing to do (and nothing spent) if there
      // are no summons to throw one.
      const allies = alliesRef.current.filter((a) => a.hp > 0);
      if (allies.length === 0) return;
      const pct = fireballDamagePercent(ab.level);
      const now = Date.now();
      const flashes: HitFlash[] = [];
      const texts: FloatingText[] = [];
      const marks: SkillMark[] = allies.map((a) => ({
        id: ++skillMarkIdCounter,
        pos: { ...a.pos },
        radius: FIREBALL_RADIUS,
        color: SKILL_META.fireball.color,
        createdAt: now,
      }));
      const nextMobs = mobsRef.current.map((m) => {
        let dmg = 0;
        for (const a of allies) {
          if (dist(a.pos, m.pos) <= FIREBALL_RADIUS) dmg += pct * a.damage;
        }
        if (dmg > 0) {
          flashes.push({ id: ++hitFlashIdCounter, pos: { ...m.pos }, createdAt: now });
          texts.push(makeFloatingText(`-${Math.round(dmg)}`, m.pos, DAMAGE_TEXT_COLOR, now));
          return { ...m, hp: m.hp - dmg };
        }
        return m;
      });
      setMobs(nextMobs);
      setHitFlashes((prev) => prev.concat(flashes));
      setFloatingTexts((prev) => prev.concat(texts));
      setSkillMarks((prev) => prev.concat(marks));
    } else if (skill === 'burn') {
      // Set the closest enemy afire; it explodes when it dies.
      const target = nearestTarget(p.pos, mobsRef.current.filter((m) => m.hp > 0).map((m) => ({ kind: 'mob' as const, id: m.id, pos: m.pos })), Infinity);
      if (!target) return;
      const pct = burnExplodePercent(ab.level);
      const dps = burnDamagePerSec(ab.level);
      setMobs(mobsRef.current.map((m) => (m.id === target.id ? { ...m, burnPct: pct, burnDps: dps } : m)));
      setFloatingTexts((prev) => prev.concat(makeFloatingText('afire', target.pos, '#ff7043', Date.now())));
      setSkillMarks((prev) =>
        prev.concat({ id: ++skillMarkIdCounter, pos: { ...target.pos }, radius: 18, color: SKILL_META.burn.color, createdAt: Date.now() })
      );
    } else if (skill === 'push') {
      // Shove every enemy outward and deal a share of the player's attack damage.
      const now = Date.now();
      const dmgBonus = equippedBonus(equippedRef.current, 'dmg');
      let rangedLvl = 0;
      for (const k of [1, 2, 3] as AbilityId[]) if (abilitiesRef.current[k].skill === 'ranged') rangedLvl = abilitiesRef.current[k].level;
      const atkDmg = PLAYER_BASE_DAMAGE + ability3DamageBonus(rangedLvl) + dmgBonus;
      const dmg = pushDamagePercent(ab.level) * atkDmg;
      const flashes: HitFlash[] = [];
      const texts: FloatingText[] = [];
      const nextMobs = mobsRef.current.map((m) => {
        const dx = m.pos.x - p.pos.x;
        const dy = m.pos.y - p.pos.y;
        const d = Math.hypot(dx, dy) || 1;
        flashes.push({ id: ++hitFlashIdCounter, pos: { ...m.pos }, createdAt: now });
        texts.push(makeFloatingText(`-${Math.round(dmg)}`, m.pos, DAMAGE_TEXT_COLOR, now));
        return { ...m, hp: m.hp - dmg, knock: { x: (dx / d) * PUSH_SPEED, y: (dy / d) * PUSH_SPEED } };
      });
      setMobs(nextMobs);
      setHitFlashes((prev) => prev.concat(flashes));
      setFloatingTexts((prev) => prev.concat(texts));
      setSkillMarks((prev) =>
        prev.concat({ id: ++skillMarkIdCounter, pos: { ...p.pos }, radius: 46, color: SKILL_META.push.color, createdAt: now })
      );
    }

    setPlayer((prev) => ({ ...prev, mana: prev.mana - cost }));
    setAbilities((prev) => ({ ...prev, [id]: { ...prev[id], cooldown: SKILL_META[skill].cooldown * cdScale } }));
  };

  const handleStartNextWave = () => {
    // No longer gated on waveActiveRef: the button stays clickable at all
    // times, so several waves can be queued and spawning simultaneously.
    if (gameOverRef.current) return;
    const nextWave = waveRef.current + 1;
    waveRef.current = nextWave;
    // Starts on its own timer at 0, so its first mob lands a full interval from
    // now -- the same cadence every other active wave's queue is keeping, just
    // out of phase with them.
    waveQueueRef.current = waveQueueRef.current.concat({ wave: nextWave, types: buildWaveQueue(nextWave), timer: 0 });
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
    passiveRef.current = s.passive;
    projectilesRef.current = [];
    hitFlashesRef.current = [];
    bloodSplatsRef.current = [];
    corpsesRef.current = [];
    coneZonesRef.current = [];
    skillMarksRef.current = [];
    coneHitsRef.current = [];
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
    lastTimeRef.current = null;
    dieTimerRef.current = null;
    pendingCastAnimRef.current = null;

    setPlayer(s.player);
    setMobs([]);
    setAllies([]);
    setAbilities(s.abilities);
    setPassive(s.passive);
    setAimingAbility(null);
    setAimPreviewPoint(null);
    setProjectiles([]);
    setHitFlashes([]);
    setBloodSplats([]);
    setCorpses([]);
    setConeZones([]);
    setSkillMarks([]);
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
    highestWaveClearedRef.current = 0;
    goldBankedRef.current = false;
    setLastRunGold(0);
    applyGameState(buildFreshState(metaRef.current));
    setScreen('game');
  };

  const handleStartTestRun = () => {
    currentRunIdRef.current = null;
    isTestRunRef.current = true;
    highestWaveClearedRef.current = 0;
    goldBankedRef.current = false;
    setLastRunGold(0);
    // Testing is meant for trying skills out, so top the account up to a
    // comfortable 1000 gold to spend in the shop.
    if (metaRef.current.gold < 1000) commitMeta({ ...metaRef.current, gold: 1000 });
    applyGameState(buildTestState(metaRef.current));
    setScreen('game');
  };

  const handleContinueRun = (save: RunSave) => {
    currentRunIdRef.current = save.id;
    isTestRunRef.current = false;
    highestWaveClearedRef.current = save.wave;
    goldBankedRef.current = false;
    setLastRunGold(0);
    applyGameState(buildStateFromSave(save));
    setScreen('game');
  };

  const handleBackToMenu = () => {
    setScreen('menu');
  };

  // Leave the run early and cash out: bank the gold for the waves cleared so
  // far, end the run (its save is dropped so it can't be banked twice), and
  // return to the menu.
  const handleExitRun = () => {
    if (!isTestRunRef.current && !goldBankedRef.current) {
      goldBankedRef.current = true;
      const earned = goldForWavesCleared(highestWaveClearedRef.current);
      if (earned > 0) {
        commitMeta({ ...metaRef.current, gold: metaRef.current.gold + earned });
        setLastRunGold(earned);
      }
    }
    if (!isTestRunRef.current && currentRunIdRef.current) {
      const id = currentRunIdRef.current;
      setSavedRuns((prev) => {
        const next = prev.filter((r) => r.id !== id);
        persistRuns(next);
        return next;
      });
    }
    currentRunIdRef.current = null;
    gameOverRef.current = true; // stop the loop from advancing the abandoned run
    setScreen('menu');
  };

  useEffect(() => {
    const step = (time: number) => {
      if (screenRef.current !== 'game' || gameOverRef.current || overlayOpenRef.current) {
        lastTimeRef.current = null;
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      // The 60-cap (ours, with Nicolai's go -- easy to lift back out).
      //
      // requestAnimationFrame follows the display, so on his monitor this loop
      // ran 220 times a second: simulating, rebuilding the tree and leaving
      // garbage at 220 Hz for art that plays at 10-24 fps. The residual hitch
      // that came and went at rest was the collector clearing that up. Frames
      // closer together than the budget are skipped whole -- the timestamp
      // below stays put, so dt on the frame that does run is the true elapsed
      // time and the simulation neither hurries nor drifts.
      //
      // 15 ms rather than 16.7 on purpose: a true 60 Hz display jitters around
      // its own interval, and the stricter budget would make it skip real
      // frames. Displays at or under 60 Hz pass through untouched.
      if (lastTimeRef.current != null && time - lastTimeRef.current < 15) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      bumpSimTick();

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
      const newCorpses: Corpse[] = [];
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
            const hitPositions: Vec[] = [];
            const target = currentMobs.find((m) => m.id === pr.targetId);
            if (target && target.hp > 0) {
              target.hp -= pr.damage;
              hurtMob(target, pr.from);
              hitPositions.push({ ...target.pos });
            }
            // Pierce: strike further enemies lying along the shot's line.
            if ((pr.pierce ?? 0) > 0) {
              const dx = pr.to.x - pr.from.x;
              const dy = pr.to.y - pr.from.y;
              const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len;
              const uy = dy / len;
              const extras = currentMobs
                .filter((m) => m.hp > 0 && m.id !== pr.targetId)
                .map((m) => {
                  const rx = m.pos.x - pr.from.x;
                  const ry = m.pos.y - pr.from.y;
                  return { m, along: rx * ux + ry * uy, perp: Math.abs(rx * uy - ry * ux) };
                })
                .filter((e) => e.along > 0 && e.perp <= PIERCE_WIDTH + e.m.radius)
                .sort((a, b) => a.along - b.along)
                .slice(0, pr.pierce);
              for (const e of extras) {
                e.m.hp -= pr.damage;
                hurtMob(e.m, pr.from);
                hitPositions.push({ ...e.m.pos });
              }
            }
            if (hitPositions.length === 0) hitPositions.push({ ...pr.to });
            for (const pos of hitPositions) {
              newFloatingTexts.push(makeFloatingText(`-${Math.round(pr.damage)}`, pos, DAMAGE_TEXT_COLOR, now));
              newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...pos }, createdAt: now });
            }
          } else if (!pr.friendly && pr.targetKind === 'player') {
            damageToPlayer += pr.damage;
            newFloatingTexts.push(makeFloatingText(`-${Math.round(pr.damage)}`, pr.to, TAKEN_TEXT_COLOR, now));
          } else if (!pr.friendly && pr.targetKind === 'ally') {
            const ally = currentAllies.find((a) => a.id === pr.targetId);
            if (ally) ally.hp -= pr.damage;
            newFloatingTexts.push(makeFloatingText(`-${Math.round(pr.damage)}`, pr.to, TAKEN_TEXT_COLOR, now));
          }
          // Mob-hit flashes are placed per pierced target above; other kinds
          // flash at the arrival point here.
          if (!(pr.friendly && pr.targetKind === 'mob')) {
            newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...pr.to }, createdAt: now });
          }
        } else {
          stillFlying.push(pr);
        }
      }

      // Player movement toward target. The die-timer check is ours: a tap
      // landing while he falls must not drag the corpse across the field.
      let moving = false;
      if (p.target && dieTimerRef.current == null) {
        const d = dist(p.pos, p.target);
        if (d < 4) {
          p.target = null;
        } else {
          const dx = p.target.x - p.pos.x;
          const dy = p.target.y - p.pos.y;
          // He walks in and runs everywhere after.
          const speed = p.introPhase === 'enter' ? INTRO_WALK_SPEED : PLAYER_SPEED;
          const step = speed * dt;
          const ratio = Math.min(1, step / d);
          p.pos = { x: p.pos.x + dx * ratio, y: p.pos.y + dy * ratio };
          p.facing = facingFromDelta(dx, dy);
          moving = true;
        }
      }

      // The animation itself is chosen further down, once this frame's attacks
      // and incoming damage are known.
      p.animTime += dt;

      // Not while running in: he starts below the bottom edge on purpose, and
      // this would snap him into view before he has taken a step.
      if (p.introPhase !== 'enter') {
        p.pos.x = Math.max(PLAYER_RADIUS, Math.min(SCREEN_W - PLAYER_RADIUS, p.pos.x));
        p.pos.y = Math.max(PLAYER_RADIUS, Math.min(PLAY_H - PLAYER_RADIUS, p.pos.y));
      }

      p.mana = Math.min(effectiveMaxMana, p.mana + (MANA_REGEN_PER_SEC + manaRegenBonus) * dt);
      // No regeneration once the fall has begun (ours): a corpse that climbed
      // back over zero would call the game over off mid-animation.
      if (dieTimerRef.current == null) p.hp = Math.min(p.maxHp + hpBonus, p.hp + hpRegenBonus * dt);
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

      // Ranged may sit in any active slot; Pierce is the equipped passive. Either
      // one turns the basic attack into shots; Pierce lets each volley strike more
      // enemies.
      const equippedLevelOf = (skill: SkillId): number => {
        for (const k of [1, 2, 3] as AbilityId[]) {
          if (abilitiesRef.current[k].skill === skill) return abilitiesRef.current[k].level;
        }
        return 0;
      };
      const passiveNow = passiveRef.current;
      const ability3Level = equippedLevelOf('ranged');
      const pierceLevel = passiveNow?.skill === 'pierce' ? passiveNow.level : 0;
      const allyRegenPerSec = passiveNow?.skill === 'summonregen' ? summonRegenPerSec(passiveNow.level) : 0;
      const isRangedAttack = ability3Level > 0 || pierceLevel > 0;
      const pierceExtra = pierceTargetCount(pierceLevel);
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
        m.flashTime = Math.max(0, m.flashTime - dt);
        m.hurtGap = Math.max(0, m.hurtGap - dt);
        // Burn's damage-over-time while the mob is afire.
        if ((m.burnDps ?? 0) > 0 && m.hp > 0) m.hp -= m.burnDps! * dt;

        // The shove from the last blow, bleeding off as it goes. Applied before
        // the mob takes its own turn, so one that is chasing spends the moment
        // after a hit walking back in rather than being frozen out of the frame.
        // Held inside the field, or a mob caught at the top edge is punted off
        // the screen and has to walk all the way back.
        if (m.knock.x !== 0 || m.knock.y !== 0) {
          m.pos = {
            x: Math.min(SCREEN_W - m.radius, Math.max(m.radius, m.pos.x + m.knock.x * dt)),
            y: Math.min(PLAY_H - m.radius, Math.max(m.radius, m.pos.y + m.knock.y * dt)),
          };
          const fade = Math.exp(-dt / KNOCKBACK_TAU);
          m.knock = { x: m.knock.x * fade, y: m.knock.y * fade };
          if (Math.hypot(m.knock.x, m.knock.y) < KNOCKBACK_STOP) m.knock = { x: 0, y: 0 };
        }
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

      /**
       * Whether a swing fired this frame will actually be seen.
       *
       * The animation chain below gives the flinch right of way, so a swing
       * that fires while he is being hit -- or while a flinch is still
       * playing -- lands with no visible swing behind it. Its damage stands
       * (Nicolai's line: the numbers are not ours to touch), but the shove is
       * withheld and delivered by the kick that follows the flinch instead,
       * so the crowd flies when the leg goes out and not before.
       *
       * This mirrors the chain's own tests, computed early: oneShotBusy the
       * same way, and the flinch gap with this frame's dt already counted
       * off, since the real decrement happens between here and there.
       */
      const preDef = ANIMS[p.anim];
      const preBusy =
        !preDef.loop &&
        p.animTime * p.animSpeed < animDuration(preDef) &&
        !(preDef.interruptedByMoving && moving);
      const flinchWillWin =
        damageToPlayer > 0 &&
        !(p.anim === 'attack' && preBusy) &&
        hurtAnimGapRef.current - dt <= 0;
      const swingHidden = flinchWillWin || (preBusy && p.anim !== 'attack');

      // Player attack: melee hits everything in range instantly, ranged fires
      // projectiles. The die-timer check is ours: a dead man swings no sword.
      let playerAttacked = false;
      const attackTargets: Vec[] = [];
      if (p.attackCooldown <= 0 && dieTimerRef.current == null) {
        if (isRangedAttack) {
          // Always fire a single shot at the nearest enemy. Pierce (if equipped)
          // lets that one shot carry through further enemies along its line.
          const target = currentMobs
            .filter((m) => m.hp > 0 && dist(m.pos, p.pos) <= playerAttackRange)
            .sort((a, b) => dist(a.pos, p.pos) - dist(b.pos, p.pos))[0];
          if (target) {
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
              pierce: pierceExtra,
            });
            p.attackCooldown = attackCooldownDuration;
            playerAttacked = true;
          }
        } else {
          let hitAny = false;
          for (const m of currentMobs) {
            if (m.hp > 0 && dist(m.pos, p.pos) <= playerAttackRange + (m.radius - MOB_RADIUS)) {
              m.hp -= playerDamage;
              // No from-point on a hidden swing: the flash and the flinch
              // still say they were hit, but the shove waits for the kick.
              hurtMob(m, swingHidden ? undefined : p.pos);
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
        // Summon Regen passive: heal each summon, capped at its max.
        if (allyRegenPerSec > 0 && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + allyRegenPerSec * dt);
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
                  hurtMob(mob, a.pos);
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

      // Ours: the wave delivers the cone's blows as it reaches each enemy --
      // the red flash, the number and the white marker all land together with
      // the line passing through, which is the whole point of the effect.
      //
      // Placed above the burn chain and the death pass on purpose, so a kill
      // made here starts its explosion and drops its corpse in the same frame
      // any other kill would.
      if (coneHitsRef.current.length > 0) {
        const stillCarried: PendingConeHit[] = [];
        for (const h of coneHitsRef.current) {
          if (h.at > now) {
            stillCarried.push(h);
            continue;
          }
          const m = currentMobs.find((x) => x.id === h.mobId);
          // Already dead, or gone with its wave: the blow is simply dropped.
          // Nothing strikes a corpse.
          if (!m || m.hp <= 0) continue;
          m.hp -= h.amount;
          // No from-point: the cone never shoved anyone, and it still does not.
          hurtMob(m);
          newFloatingTexts.push(makeFloatingText(`-${Math.round(h.amount)}`, m.pos, DAMAGE_TEXT_COLOR, now));
          newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...m.pos }, createdAt: now });
        }
        coneHitsRef.current = stillCarried;
      }

      // Burning enemies (marked by the Burn skill) blow up when they die,
      // spreading a share of their max HP to nearby foes -- which can set off
      // further burning deaths in a chain.
      {
        const pending = currentMobs.filter((m) => m.hp <= 0 && (m.burnPct ?? 0) > 0);
        const exploded = new Set<number>();
        while (pending.length > 0) {
          const src = pending.shift()!;
          if (exploded.has(src.id)) continue;
          exploded.add(src.id);
          const blast = src.maxHp * (src.burnPct ?? 0);
          newFloatingTexts.push(makeFloatingText('boom!', src.pos, '#ff7043', now));
          for (const m of currentMobs) {
            if (m.id === src.id || m.hp <= 0) continue;
            if (dist(m.pos, src.pos) <= BURN_EXPLODE_RADIUS) {
              m.hp -= blast;
              newFlashes.push({ id: ++hitFlashIdCounter, pos: { ...m.pos }, createdAt: now });
              newFloatingTexts.push(makeFloatingText(`-${Math.round(blast)}`, m.pos, DAMAGE_TEXT_COLOR, now));
              if (m.hp <= 0 && (m.burnPct ?? 0) > 0 && !exploded.has(m.id)) pending.push(m);
            }
          }
        }
      }

      const survivorMobs: Mob[] = [];
      let anyMobDied = false;
      let lastDeathPos: Vec | null = null;
      for (const m of currentMobs) {
        if (m.hp > 0) {
          survivorMobs.push(m);
        } else {
          anyMobDied = true;
          lastDeathPos = { ...m.pos };
          // The fall, one of two takes at random so a mown-down crowd does
          // not drop in unison. Only the melee mob has art; the circles
          // still just vanish.
          if (m.type === 'melee') {
            newCorpses.push({
              id: ++corpseIdCounter,
              pos: { ...m.pos },
              facing: m.facing,
              anim: Math.random() < 0.5 ? 'die' : 'die2',
              age: 0,
            });
          }
          newBlood.push({
            id: ++bloodIdCounter,
            pos: { ...m.pos },
            variant: Math.floor(Math.random() * BLOOD_VARIANTS),
            createdAt: now,
          });
          const reward = m.type === 'boss' ? BOSS_XP_REWARD : MOB_XP_REWARD;
          xpGain += reward;
          newFloatingTexts.push(makeFloatingText(`+${reward} XP`, m.pos, XP_TEXT_COLOR, now));
          // One call per coin is the whole integration; the sack keeps its own
          // count and drops them in itself.
          const coins =
            m.type === 'boss' ? BOSS_COINS : Math.random() < MOB_COIN_CHANCE ? 1 : 0;
          for (let i = 0; i < coins; i++) coinSackRef.current?.addCoin();
        }
      }
      const survivorAllies = currentAllies.filter((a) => a.hp > 0);

      if (damageToPlayer > 0) p.hp = Math.max(0, p.hp - damageToPlayer);

      // The fall (ours, for the Die animation). The frame hp reaches zero
      // starts the timer; the field keeps simulating while he goes down, and
      // the game over waits at the bottom of the loop until the animation has
      // played and held a beat. Hp stays the authority on death: should
      // anything lift him back over zero mid-fall (the wave-clear heal can),
      // the fall is called off and the run continues -- the same outcome the
      // old instant game over would have picked.
      if (dieTimerRef.current == null) {
        if (p.hp <= 0) {
          dieTimerRef.current = animDuration(ANIMS.die) + DIE_HOLD;
          p.target = null;
          pendingCastAnimRef.current = null;
          // A swing sound still pending belongs to a blow the fall swallowed.
          swingSoundTimerRef.current = 0;
          swingSoundGorePosRef.current = null;
          // The blow that felled him is still heard. The dying branch outranks
          // the flinch that used to carry this sound, so it plays here instead
          // -- once per run, gap or no gap.
          const pool = hurtSoundsRef.current;
          playSfx(pool[Math.floor(Math.random() * pool.length)]);
        }
      } else if (p.hp > 0) {
        // Revived mid-fall: back on his feet at once, no corpse acting.
        dieTimerRef.current = null;
        p.anim = 'idle';
        p.animTime = 0;
        p.animSpeed = 1;
      } else {
        dieTimerRef.current -= dt;
      }



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
      // The entrance, one step at a time. Running in is just the ordinary
      // movement code, so all this has to do is notice he has arrived, hold him
      // still a moment, and then start the draw.
      let startDraw = false;
      if (p.introPhase === 'enter') {
        if (!p.target) {
          p.introPhase = 'settle';
          p.introTimer = INTRO_SETTLE;
        }
      } else if (p.introPhase === 'settle') {
        p.introTimer -= dt;
        if (p.introTimer <= 0) {
          p.introPhase = 'draw';
          startDraw = true;
        }
      } else if (p.introPhase === 'draw' && p.anim !== 'spawn') {
        p.introPhase = 'done';
      }

      const current = ANIMS[p.anim];
      const oneShotBusy =
        !current.loop &&
        p.animTime * p.animSpeed < animDuration(current) &&
        !(current.interruptedByMoving && moving);

      // A flinch no longer barges in on a swing already under way, and cannot
      // follow another too closely. It used to win outright, which left the
      // knight twitching continuously and almost never landing a visible blow.
      hurtAnimGapRef.current = Math.max(0, hurtAnimGapRef.current - dt);
      const midSwing = p.anim === 'attack' && oneShotBusy;
      const mayFlinch = damageToPlayer > 0 && !midSwing && hurtAnimGapRef.current <= 0;

      // Standing between arriving and drawing: hold the walk's last frame rather
      // than falling into idle, which is a pose with the sword already in hand.
      if (p.introPhase === 'settle') {
        p.anim = 'walk';
        p.animSpeed = 1;
        p.animTime = INTRO_HOLD_FRAME / ANIMS.walk.fps;
      }

      // A cast made on the run keeps its effect but skips its pose -- a
      // runner should not be yanked into a stance he did not stop for.
      if (pendingCastAnimRef.current && moving) pendingCastAnimRef.current = null;

      let nextAnim: AnimName = p.anim;
      let restartAnim = false;
      if (dieTimerRef.current != null) {
        // Dying outranks everything -- including the flinch that would
        // otherwise answer the killing blow.
        nextAnim = 'die';
        restartAnim = p.anim !== 'die';
      } else if (p.introPhase === 'settle') {
        // nothing else gets a say while he waits
      } else if (startDraw) {
        // The one moment the entrance overrides everything. Nothing else is
        // happening on the field yet, so there is nothing for it to trample.
        nextAnim = 'spawn';
        restartAnim = true;
        // Heard as the animation begins, the same rule the rest follow.
        playSfx(drawSoundRef.current);
      } else if (mayFlinch) {
        nextAnim = 'hurt';
        restartAnim = true;
        hurtAnimGapRef.current = HURT_ANIM_MIN_GAP;
        // Heard exactly when the flinch is drawn, the same rule the sword
        // follows. No delay: a flinch is the reaction to the blow, so it starts
        // on the hit rather than building up to it like a swing does.
        const pool = hurtSoundsRef.current;
        playSfx(pool[Math.floor(Math.random() * pool.length)]);
      } else if (pendingCastAnimRef.current && !oneShotBusy) {
        // The pose behind a skill press, a frame after its effect: it waits
        // out a busy one-shot (a swing hands over within a tenth of a
        // second), and the clear above has already dropped it if he is on
        // the move by the time it could start.
        nextAnim = pendingCastAnimRef.current;
        pendingCastAnimRef.current = null;
        restartAnim = true;
      } else if (
        // The kick, straight off the back of a flinch -- Nicolai's sequence:
        // hit between swings, he staggers, then boots the crowd off him. Only
        // if someone is actually within reach (a kick into empty air looks
        // daft), and never over the player's own movement -- wanting out
        // outranks the flourish. The coin flip runs once, in the one frame
        // the flinch has just ended; lose it and he simply recovers, and
        // nobody is shoved. The mob scan sits last, after the flip, so the
        // cheap dice spare the walk through the crowd.
        !oneShotBusy &&
        p.anim === 'hurt' &&
        !moving &&
        Math.random() < KICK_CHANCE &&
        currentMobs.some((m) => {
          if (m.hp <= 0) return false;
          const dx = m.pos.x - p.pos.x;
          const dy = m.pos.y - p.pos.y;
          const len = Math.hypot(dx, dy);
          if (len > KICK_RANGE + (m.radius - MOB_RADIUS)) return false;
          if (len <= 0.001) return true; // standing on his feet: kickable
          const dir = facingVector(p.facing);
          return (dx / len) * dir.x + (dy / len) * dir.y >= KICK_ARC_COS;
        })
      ) {
        nextAnim = 'kick';
        restartAnim = true;
        // The shove rides the leg, not the wind-up: it fires when frame 6 is
        // reached, and the timer starts with the animation.
        kickShoveTimerRef.current = KICK_CONTACT_FRAME / ANIMS.kick.fps;
        // The boot is heard where it lands, not where it starts: the clip is
        // begun early by its own measured wind-up so full level falls on the
        // contact frame, the same aim the swings take.
        const boots = kickSoundsRef.current;
        const boot = Math.floor(Math.random() * boots.length);
        kickSoundPlayerRef.current = boots[boot];
        kickSoundTimerRef.current = Math.max(
          0,
          KICK_CONTACT_FRAME / ANIMS.kick.fps - KICK_LEADS[boot]
        );
      } else if (!oneShotBusy) {
        const travelling = p.introPhase === 'enter' ? 'walk' : 'run';
        nextAnim = playerAttacked ? 'attack' : moving ? travelling : 'idle';
        // Any freshly triggered one-shot restarts, including a second swing
        // straight after the first -- without this it would stay parked on the
        // last frame, since the name alone has not changed.
        restartAnim = nextAnim !== p.anim || !ANIMS[nextAnim].loop;
      }
      if (restartAnim) {
        p.animTime = 0;
        // Two animations run at anything but the rate their sheet was drawn
        // for: the swing, rushed to keep up with attack speed, and the entrance
        // walk, slowed to stay in step with the ground he covers.
        p.animSpeed =
          nextAnim === 'attack'
            ? attackAnimSpeed
            : p.introPhase === 'enter' && nextAnim === 'walk'
              ? INTRO_WALK_ANIM
              : 1;

        // The sword is heard only when it is seen. A blow still lands whenever
        // the cooldown is ready, but if the knight is flinching instead of
        // swinging there is no swing to hear -- getting hit outranks attacking
        // in the state machine above, so in a crowd that happens often.
        if (nextAnim === 'attack') {
          // Which clip is decided first, because how early it has to start
          // depends on which one it is. It is also decided now, while it is
          // still known whether this blow killed anything: a killing blow
          // sometimes earns a heavier one, which replaces the swing rather than
          // layering over it -- both at once just muddies, and those clips open
          // on a strike of their own.
          //
          // The heavy clips are one pool of six, half of them gore takes.
          // Landing on a gore one is what calls for the extra blood, so the
          // position is remembered here and used when the sound actually fires.
          swingSoundGorePosRef.current = null;
          let lead: number;
          if (anyMobDied && Math.random() < KILL_SFX_CHANCE) {
            const combo = killSoundsRef.current;
            const gore = goreSoundsRef.current;
            const pick = Math.floor(Math.random() * (combo.length + gore.length));
            const isGore = pick >= combo.length;
            const i = isGore ? pick - combo.length : pick;
            swingSoundPlayerRef.current = isGore ? gore[i] : combo[i];
            lead = isGore ? GORE_LEADS[i] : KILL_LEADS[i];
            if (isGore) swingSoundGorePosRef.current = lastDeathPos;
          } else {
            const swings = attackSoundsRef.current;
            const i = Math.floor(Math.random() * swings.length);
            swingSoundPlayerRef.current = swings[i];
            lead = ATTACK_LEADS[i];
          }

          // Started early enough that its loudest moment falls on the strike,
          // rather than its first sample doing. The animation's speed scales
          // when the blade arrives; the clip's own wind-up does not, since audio
          // plays at the rate it was recorded whatever the sprite is doing.
          swingSoundTimerRef.current = Math.max(0, SWING_STRIKE_AT / attackAnimSpeed - lead);
        } else {
          // Interrupted before the strike, so it never happened as far as the
          // eye is concerned. Drop the pending sound and the blood with it.
          swingSoundTimerRef.current = 0;
          swingSoundGorePosRef.current = null;
        }
      }
      p.anim = nextAnim;

      // Boots. Read off where the animation has got to rather than kept on a
      // timer of its own, so a step is heard on the frame his foot lands at any
      // pace -- the same reason the walk's rate is tied to his stride and not
      // set by hand. Nothing to reset between runs, and nothing to drift.
      if (moving && (p.anim === 'walk' || p.anim === 'run')) {
        const cycles = (p.animTime * p.animSpeed * ANIMS[p.anim].fps) / SPRITE_COLS;
        const step = Math.floor((cycles - FOOTSTEP_PHASE) * STEPS_PER_CYCLE);
        // The first frame of moving sounds too. It used to be swallowed -- the
        // cycle starts at nothing and the first crossing is 40% of the way in,
        // which at a run is 375 ms of silence after the tap that ordered it.
        // A foot goes down when you set off, so it is heard when you set off.
        if (footstepStepRef.current === null || step !== footstepStepRef.current) {
          footstepStepRef.current = step;

          // The ground he lands on. Wet or dry is decided per step rather than
          // per crossing, so he can clip the edge of a puddle on his way past
          // and only that foot splashes.
          const ground = feetInWater(p.pos) ? puddleSoundsRef.current : footstepSoundsRef.current;
          let pick = Math.floor(Math.random() * ground.length);
          if (pick === lastFootstepRef.current) pick = (pick + 1) % ground.length;
          lastFootstepRef.current = pick;
          playSfx(ground[pick]);

          // And his armour over the top of it, drawn separately so the two do
          // not repeat together. A knight in plate does not walk quietly.
          const armour = armourSoundsRef.current;
          let rattle = Math.floor(Math.random() * armour.length);
          if (rattle === lastArmourRef.current) rattle = (rattle + 1) % armour.length;
          lastArmourRef.current = rattle;
          playSfx(armour[rattle]);
        }
      } else {
        footstepStepRef.current = null;
      }

      if (swingSoundTimerRef.current > 0) {
        swingSoundTimerRef.current -= dt;
        if (swingSoundTimerRef.current <= 0) {
          playSfx(swingSoundPlayerRef.current);

          // Bound to the sound rather than to the kill: a gore clip never plays
          // without the mess, and the mess never appears without it.
          const gorePos = swingSoundGorePosRef.current;
          if (gorePos) {
            for (let i = 0; i < GORE_EXTRA_SPLATS; i++) {
              newBlood.push({
                id: ++bloodIdCounter,
                pos: {
                  x: gorePos.x + (Math.random() - 0.5) * GORE_SPLATTER_SPREAD * 2,
                  y: gorePos.y + (Math.random() - 0.5) * GORE_SPLATTER_SPREAD,
                },
                variant: Math.floor(Math.random() * BLOOD_VARIANTS),
                createdAt: now,
              });
            }
            swingSoundGorePosRef.current = null;
          }
        }
      }

      // The boot's sound, on its own clock because it starts earlier than the
      // shove by the clip's wind-up. Same rule as the shove below: if movement
      // cut the kick short, a kick that never landed is not heard either.
      if (kickSoundTimerRef.current > 0) {
        kickSoundTimerRef.current -= dt;
        if (kickSoundTimerRef.current <= 0 && p.anim === 'kick') {
          playSfx(kickSoundPlayerRef.current);
        }
      }

      // The kick lands. Everyone still inside the fan is shoved with the same
      // knockback a visible blow deals -- no damage, no flash, just the space
      // a kick is for. Guarded on the animation still being the kick: if
      // movement cut it short before the leg came out, nobody is shoved by a
      // kick that never happened.
      if (kickShoveTimerRef.current > 0) {
        kickShoveTimerRef.current -= dt;
        if (kickShoveTimerRef.current <= 0 && p.anim === 'kick') {
          const dir = facingVector(p.facing);
          for (const m of currentMobs) {
            if (m.hp <= 0) continue;
            const dx = m.pos.x - p.pos.x;
            const dy = m.pos.y - p.pos.y;
            const len = Math.hypot(dx, dy);
            if (len > KICK_RANGE + (m.radius - MOB_RADIUS)) continue;
            if (len > 0.001 && (dx / len) * dir.x + (dy / len) * dir.y < KICK_ARC_COS) continue;
            shoveMob(m, p.pos);
          }
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
        }
      }

      // Wave spawning from queue. Every wave still spawning keeps its own timer,
      // so a board with several waves queued drops one mob per wave per tick --
      // ten waves started at once flood in ten at a time, not one at a time.
      let newWaveActive = waveActiveRef.current;
      if (waveActiveRef.current && waveQueueRef.current.length > 0) {
        const stillSpawning: typeof waveQueueRef.current = [];
        for (const entry of waveQueueRef.current) {
          entry.timer += dt;
          if (entry.timer >= WAVE_SPAWN_INTERVAL) {
            entry.timer -= WAVE_SPAWN_INTERVAL;
            const type = entry.types.shift();
            if (type) survivorMobs.push(spawnMob(type, entry.wave));
          }
          if (entry.types.length > 0) stillSpawning.push(entry);
        }
        waveQueueRef.current = stillSpawning;
        if (waveQueueRef.current.length === 0) newWaveActive = false;
      }

      // Each owed wave clears on its own: once a wave is done spawning and none
      // of its own mobs are left alive, it drops its item and counts toward the
      // gold. Rushing several waves together no longer merges their payouts.
      let waveJustCleared = false;
      if (lootOwedRef.current.length > 0) {
        const stillOwed: number[] = [];
        for (const w of lootOwedRef.current) {
          const doneSpawning = !waveQueueRef.current.some((e) => e.wave === w);
          const anyAlive = survivorMobs.some((m) => m.wave === w);
          if (doneSpawning && !anyAlive) {
            remainingItems.push(spawnLoot(w));
            waveJustCleared = true;
            highestWaveClearedRef.current = Math.max(highestWaveClearedRef.current, w);
          } else {
            stillOwed.push(w);
          }
        }
        lootOwedRef.current = stillOwed;
        if (waveJustCleared) {
          // Fully restore health and mana each time a wave is fully cleared.
          p.hp = p.maxHp + hpBonus;
          p.mana = effectiveMaxMana;
        }
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
      // Corpses age on the simulation clock, not the wall clock, so a pause
      // freezes them mid-fall along with everything else.
      const survivorCorpses = corpsesRef.current
        .map((c) => ({ ...c, age: c.age + dt }))
        .filter((c) => c.age < animDuration(MOB_DIE_ANIMS[c.anim]) + CORPSE_LINGER + CORPSE_FADE)
        .concat(newCorpses);
      // The zones animate themselves in CSS; the loop only sweeps up the
      // entries whose time is spent -- counted from when they come up, not
      // from the cast that ordered them.
      const survivorConeZones = coneZonesRef.current.filter((z) => now < z.startAt + CONE_ZONE_MS);
      const survivorSkillMarks = skillMarksRef.current.filter((m) => now - m.createdAt < SKILL_MARK_DURATION);
      const survivorFloatingTexts = floatingTextsRef.current
        .filter((f) => now - f.createdAt < FLOATING_TEXT_DURATION)
        .concat(newFloatingTexts);

      // Ours: the game over waits for the fall. Hp is still the authority on
      // whether he is dead -- the timer only buys the Die animation its stage
      // time before the screen takes over.
      const isGameOver = p.hp <= 0 && dieTimerRef.current != null && dieTimerRef.current <= 0;

      if (isGameOver) {
        // The run has ended: bank its gold (1 per wave cleared, so 1+2+...+N)
        // into the account. Test runs pay nothing.
        if (!isTestRunRef.current && !goldBankedRef.current) {
          goldBankedRef.current = true;
          const earned = goldForWavesCleared(highestWaveClearedRef.current);
          if (earned > 0) {
            const m = metaRef.current;
            commitMeta({ ...m, gold: m.gold + earned });
            setLastRunGold(earned);
          }
        }
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
          abilities: newAbilities,
          passive: passiveRef.current,
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
      corpsesRef.current = survivorCorpses;
      coneZonesRef.current = survivorConeZones;
      skillMarksRef.current = survivorSkillMarks;
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
      setCorpses(survivorCorpses);
      setConeZones(survivorConeZones);
      setSkillMarks(survivorSkillMarks);
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

  // Look up an equipped skill's level for the HUD read-outs below.
  const equippedSkillLevel = (skill: SkillId): number => {
    for (const k of [1, 2, 3] as AbilityId[]) if (abilities[k].skill === skill) return abilities[k].level;
    return 0;
  };
  const ability3Level = equippedSkillLevel('ranged');
  const isRangedDisplay = ability3Level > 0 || passive?.skill === 'pierce';
  const playerAttackRange = isRangedDisplay ? RANGED_ATTACK_RANGE : PLAYER_ATTACK_RANGE;
  playerAttackRangeRef.current = playerAttackRange;
  aimAngleRef.current =
    aimingAbility === 2 && aimPreviewPoint
      ? (Math.atan2(aimPreviewPoint.y - player.pos.y, aimPreviewPoint.x - player.pos.x) * 180) / Math.PI
      : null;
  const dmgBonusDisplay = equippedBonus(equipped, 'dmg');
  const atkSpdBonusPctDisplay = equippedBonus(equipped, 'atkspd');
  const manaBonusDisplay = equippedBonus(equipped, 'mana');
  const hpBonusDisplay = equippedBonus(equipped, 'health');
  const effectiveMaxHp = player.maxHp + hpBonusDisplay;
  const effectiveMaxMana = MANA_MAX + manaBonusDisplay;
  const displayDamage = PLAYER_BASE_DAMAGE + ability3DamageBonus(ability3Level) + dmgBonusDisplay;
  const displayAttackCooldown = (PLAYER_ATTACK_COOLDOWN * (player.hasteTimer > 0 ? 0.5 : 1)) / (1 + atkSpdBonusPctDisplay);
  const displayAtkSpeed = 1 / displayAttackCooldown;


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

  // A single toggle row: label on the left, ON/OFF pill on the right. Shared
  // by every switch in the settings overlay so they read as one list.
  function renderSettingRow(label: string, on: boolean, onToggle: () => void) {
    return (
      <Pressable onPress={onToggle} style={styles.settingsRow}>
        <Text style={styles.settingsRowLabel}>{label}</Text>
        <View style={[styles.settingsPill, !on && styles.settingsPillOff]}>
          <Text style={styles.settingsPillText}>{on ? 'ON' : 'OFF'}</Text>
        </View>
      </Pressable>
    );
  }

  // Every sound/weather/music toggle, plus the technical readout's own switch,
  // gathered behind the cogwheel instead of scattered as loose buttons. Shared
  // between the menu and the game screen, since both mount their own overlays.
  function renderSettingsOverlay() {
    if (!settingsOpen) return null;
    return (
      <View style={styles.menuOverlay}>
        <Pressable style={styles.menuBackdrop} onPress={() => setSettingsOpen(false)} />
        <View style={styles.menuPanel}>
          <View style={styles.menuHeader}>
            <Text style={styles.menuTitle}>Settings</Text>
            <Pressable onPress={() => setSettingsOpen(false)} style={styles.menuClose}>
              <Text style={styles.menuCloseText}>X</Text>
            </Pressable>
          </View>
          {renderSettingRow('Sound', !allSoundOff, () => setAllSoundOff((v) => !v))}
          {renderSettingRow('Sound effects', !sfxOff, () => setSfxOff((v) => !v))}
          {renderSettingRow('Music', !musicOff, () => setMusicOff((v) => !v))}
          {renderSettingRow('Weather', !weatherOff, () => setWeatherOff((v) => !v))}
          {COINSACK_ENABLED && renderSettingRow('Coin sack', !sackOff, () => setSackOff((v) => !v))}
          {DEBUG_PERF && renderSettingRow('Technical info', techAreaOn, () => setTechAreaOn((v) => !v))}
        </View>
      </View>
    );
  }

  if (screen === 'menu') {
    const hasSaves = runsLoaded && savedRuns.length > 0;
    return (
      <View style={styles.root}>
        {/* The art carries the title, so nothing is drawn over it. Cover rather
            than stretch, which crops the sides on a screen narrower than the
            picture instead of squashing the knight. */}
        <Image source={MENU_BG} style={styles.menuBg} resizeMode="cover" />

        {/* On web the canvas draws the plaque itself, and tears it. Anywhere
            else it is a plain image, since there is no canvas to tear it on. */}
        {Platform.OS === 'web' ? (
          <MenuTearButton
            tearRef={tearRef}
            screenW={SCREEN_W}
            screenH={SCREEN_H}
            button={MENU_BUTTON_RECT}
            logo={MENU_LOGO_RECT}
          />
        ) : (
          <Image
            source={MENU_BUTTON}
            style={{
              position: 'absolute',
              left: MENU_BUTTON_RECT.x,
              top: MENU_BUTTON_RECT.y,
              width: MENU_BUTTON_RECT.w,
              height: MENU_BUTTON_RECT.h,
            }}
            resizeMode="contain"
          />
        )}

        <Pressable
          onPress={() => leaveMenu(handleStartNewRun)}
          style={{
            position: 'absolute',
            left: MENU_BUTTON_RECT.x,
            top: MENU_BUTTON_RECT.y,
            width: MENU_BUTTON_RECT.w,
            height: MENU_BUTTON_RECT.h,
          }}
        />

        {/* Temporary, and deliberately out of the way: the design has one
            button and these two have nowhere to go yet. */}
        <View style={styles.menuMinorRow}>
          <Pressable
            onPress={() => {
              if (!hasSaves) return;
              playMenuPress();
              setScreen('continue');
            }}
          >
            <Text style={[styles.menuMinorText, !hasSaves && styles.menuMinorDisabled]}>
              Continue{hasSaves ? ` (${savedRuns.length})` : ''}
            </Text>
          </Pressable>
          <Text style={styles.menuMinorText}>·</Text>
          <Pressable
            onPress={() => {
              playMenuPress();
              setScreen('skilltree');
            }}
          >
            <Text style={styles.menuMinorText}>Skills ({meta.gold}g)</Text>
          </Pressable>
          <Text style={styles.menuMinorText}>·</Text>
          <Pressable onPress={() => leaveMenu(handleStartTestRun)}>
            <Text style={styles.menuMinorText}>Test run</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => setSettingsOpen(true)} style={styles.menuSettingsButton}>
          <Text style={styles.topBarIconText}>⚙️</Text>
        </Pressable>

        {leaveVeil}

        {/* The story, over the top of a menu that is already built and waiting.
            Once per load: coming back from a run lands on the menu itself. */}
        {!introDone && <IntroSequence onDone={() => setIntroDone(true)} />}

        {/* Here too, and above the story, since the intro's fog is the heaviest
            thing on the screen at any point. Its own toggle now lives in the
            settings overlay; DEBUG_PERF still strips it from the build. */}
        {DEBUG_PERF && techAreaOn && <PerfOverlay />}

        {renderSettingsOverlay()}

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

  if (screen === 'skilltree') {
    return (
      <View style={styles.root}>
        <ScrollView style={styles.skillTreeScroll} contentContainerStyle={styles.skillTreeContent}>
          <Text style={styles.menuScreenTitle}>Skills · {meta.gold} gold</Text>

          {/* The equipped loadout, shown the same way it appears in a run. */}
          <View style={styles.loadoutPreview}>
            {meta.loadout.map((skill) => (
              <View key={skill} style={styles.loadoutSlot}>
                <View style={[styles.quickCastButton, { backgroundColor: SKILL_META[skill].color }]}>
                  <Text style={styles.quickCastIcon}>{SKILL_META[skill].icon}</Text>
                </View>
                <Text style={styles.abilityCostText}>{SKILL_META[skill].label}</Text>
              </View>
            ))}
            {meta.passive && (
              <View style={styles.loadoutSlot}>
                <View style={[styles.passiveChip, { backgroundColor: SKILL_META[meta.passive].color }]}>
                  <Text style={styles.passiveChipIcon}>{SKILL_META[meta.passive].icon}</Text>
                </View>
                <Text style={styles.abilityCostText}>{SKILL_META[meta.passive].label}</Text>
              </View>
            )}
          </View>
          <Text style={styles.skillTreeHint}>
            Active {meta.loadout.length}/{MAX_EQUIPPED} · Passive {meta.passive ? SKILL_META[meta.passive].label : '—'}/{MAX_PASSIVE}
          </Text>

          {ROOT_SKILLS.map((root) => {
            const rows = [root, ...ALL_SKILLS.filter((s) => SKILL_PARENT[s] === root)];
            return (
              <View key={root} style={styles.skillTreeGroup}>
                {rows.map((skill) => {
                  const level = meta.skillLevels[skill] ?? 0;
                  const owned = level > 0;
                  const parent = SKILL_PARENT[skill];
                  const isChild = parent != null;
                  const unlocked = !parent || (meta.skillLevels[parent] ?? 0) >= 1;
                  const atMax = level >= ABILITY_MAX_LEVEL;
                  const nextCost = skillLevelCost(level + 1);
                  const canBuy = unlocked && !atMax && meta.gold >= nextCost;
                  const passiveKind = isPassiveSkill(skill);
                  const equipped = passiveKind ? meta.passive === skill : meta.loadout.includes(skill);
                  const equipFull = !passiveKind && !equipped && meta.loadout.length >= MAX_EQUIPPED;
                  const meta2 = SKILL_META[skill];
                  return (
                    <View key={skill} style={[styles.skillRow, isChild && styles.skillRowChild]}>
                      <View style={[styles.skillSwatch, { backgroundColor: meta2.color }, !unlocked && styles.abilityLocked]}>
                        <Text style={styles.skillSwatchIcon}>{meta2.icon}</Text>
                      </View>
                      <View style={styles.skillRowInfo}>
                        <Text style={styles.skillRowName}>
                          {isChild ? '↳ ' : ''}{meta2.label} · {owned ? `Lv ${level}/${ABILITY_MAX_LEVEL}` : unlocked ? 'not owned' : `needs ${SKILL_META[parent!].label}`}
                        </Text>
                        <Text style={styles.skillRowDesc}>{skillDescription(skill)}</Text>
                      </View>
                      <View style={styles.skillRowButtons}>
                        <Pressable
                          onPress={() => buySkillLevel(skill)}
                          disabled={!canBuy}
                          style={[styles.skillBuyButton, !canBuy && styles.skillButtonDisabled]}
                        >
                          <Text style={styles.skillBuyText}>{atMax ? 'MAX' : `${owned ? 'Level' : 'Buy'} ${nextCost}g`}</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => toggleEquip(skill)}
                          disabled={!owned || equipFull}
                          style={[
                            styles.skillEquipButton,
                            equipped && styles.skillEquipButtonOn,
                            (!owned || equipFull) && styles.skillButtonDisabled,
                          ]}
                        >
                          <Text style={styles.skillEquipText}>
                            {equipped ? 'Equipped' : passiveKind ? 'Passive' : 'Equip'}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })}

          <Pressable onPress={() => setScreen('menu')} style={styles.menuBackButton}>
            <Text style={styles.menuBackButtonText}>Back</Text>
          </Pressable>
        </ScrollView>
        <StatusBar style="auto" />
      </View>
    );
  }

  // Swap this for another GlowStyle to change his light -- while a buff runs,
  // say. Everything below reads from it.
  const glow = PLAYER_GLOW;

  // And his moon edge, from the panel while it is up and from the constant
  // after. Strength at zero simply draws nothing, so the sliders can take it
  // away as well as set it.
  const rim: RimStyle = DEBUG_RIM_TUNING
    ? { color: [tuneRimR, tuneRimG, tuneRimB], strength: tuneRimStrength / 100, blend: tuneRimBlend }
    : RIM_STYLE;

  // Breathes on the wall clock rather than the animation, so it keeps its own
  // slow rhythm whatever the knight happens to be doing.
  const glowSize =
    glow.size * (1 + Math.sin(((Date.now() % glow.period) / glow.period) * Math.PI * 2) * glow.pulse);

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
      // Its own entry rather than sitting inside the knight's, so that it ends
      // up a direct child of the play area alongside the ground.
      //
      // Blending only reaches as far as the nearest stacking context, and
      // react-native-web gives every positioned view a z-index, which creates
      // one. Wrapped with the knight, the glow could only blend against him --
      // the mode changed and nothing looked different. Out here it can reach the
      // ground it is supposed to be lighting.
      //
      // Same y as the knight and listed first, so a stable sort keeps it under
      // him while anyone standing in front still covers it.
      key: 'player-glow',
      y: player.pos.y,
      node: (
        // Deaf to touches, or it would swallow taps in the one spot the player
        // aims at most -- right where their own character is. The wrapper
        // carries that, since neither Image nor ImageStyle takes it.
        <View
          key="player-glow"
          style={{
            position: 'absolute',
            left: player.pos.x - glowSize / 2,
            top: player.pos.y + glow.foot - glowSize / 2,
            width: glowSize,
            height: glowSize,
            pointerEvents: 'none',
            // 'screen' and its kin only lighten, which is how light behaves and
            // lets the stone show through it.
            mixBlendMode: glow.blend,
          }}
        >
          <Image
            source={GLOW}
            tintColor={glow.color}
            style={{
              width: glowSize,
              height: glowSize,
              opacity: glow.opacity,
            }}
          />
        </View>
      ),
    },
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
          rim={rim}
          mountAllAnims
        />
      ),
    },
    // Corpses take part in the same painter's sort as the living: a body on
    // the ground is walked in front of by whoever stands below it. Listed
    // before the mobs so a tie in y keeps the dead underneath.
    ...corpses.map((c) => {
      const fadeStart = animDuration(MOB_DIE_ANIMS[c.anim]) + CORPSE_LINGER;
      return {
        key: `corpse-${c.id}`,
        y: c.pos.y,
        node: (
          <View
            key={`corpse-${c.id}`}
            style={{ opacity: c.age <= fadeStart ? 1 : Math.max(0, 1 - (c.age - fadeStart) / CORPSE_FADE) }}
          >
            <SpriteSheet
              anims={MOB_DIE_ANIMS}
              anim={c.anim}
              animTime={c.age}
              facing={c.facing}
              size={MOB_SPRITE_SIZE}
              left={c.pos.x - MOB_SPRITE_SIZE / 2}
              top={c.pos.y + MOB_SPRITE_FOOT_OFFSET - MOB_SPRITE_SIZE}
            />
          </View>
        ),
      };
    }),
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
              // Fades over its short life rather than switching off, so a hit
              // reads as a pulse rather than a stutter.
              flash={{
                color: MOB_FLASH_COLOR,
                opacity: (m.flashTime / MOB_FLASH_TIME) * MOB_FLASH_STRENGTH,
              }}
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
        {!gameOver ? (
          <Pressable onPress={handleExitRun} style={styles.exitRunButton}>
            <Text style={styles.exitRunText}>Exit run</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <View style={styles.topBarRight}>
          <Text style={styles.topBarText}>Wave {shownWave}</Text>
          <Pressable onPress={() => setSettingsOpen(true)} style={styles.topBarIconButton}>
            <Text style={styles.topBarIconText}>⚙️</Text>
          </Pressable>
          <Pressable onPress={() => setMobStatsOpen(true)} style={styles.topBarButton}>
            <Text style={styles.topBarButtonText}>Mob Stats</Text>
          </Pressable>
          {!gameOver && (
            <Pressable onPress={handleStartNextWave} style={styles.startWaveButton}>
              <Text style={styles.startWaveText}>Start Wave {wave + 1}</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View
        style={styles.playArea}
        onStartShouldSetResponder={() => true}
        onResponderGrant={handlePlayAreaGrant}
        onResponderMove={handlePlayAreaMove}
        onResponderRelease={handlePlayAreaRelease}
      >
        <Image source={BACKGROUND} style={styles.background} resizeMode="cover" />
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
        {RAIN_ENABLED && !weatherOff && PUDDLE_SPOTS.length > 0 && <RippleLayer />}
        <GameCanvasLoader
          width={SCREEN_W}
          height={PLAY_H}
          playerRef={playerRef}
          mobsRef={mobsRef}
          alliesRef={alliesRef}
          projectilesRef={projectilesRef}
          hitFlashesRef={hitFlashesRef}
          floatingTextsRef={floatingTextsRef}
          groundItemsRef={groundItemsRef}
          itemColors={ITEM_COLORS}
          playerAttackRangeRef={playerAttackRangeRef}
          aimAngleRef={aimAngleRef}
          playerAnims={ANIMS}
          mobAnims={MOB_ANIMS}
          glowSource={GLOW}
          mobTypeColor={{ melee: MOB_TYPE_META.melee.color, ranged: MOB_TYPE_META.ranged.color, boss: MOB_TYPE_META.boss.color }}
          spriteCell={SPRITE_CELL}
          spriteCols={SPRITE_COLS}
          spriteRows={SPRITE_ROWS}
          playerSpriteSize={PLAYER_SPRITE_SIZE}
          playerSpriteFootOffset={PLAYER_SPRITE_FOOT_OFFSET}
          mobSpriteSize={MOB_SPRITE_SIZE}
          mobSpriteFootOffset={MOB_SPRITE_FOOT_OFFSET}
          allyRadius={ALLY_RADIUS}
          coneRange={CONE_RANGE}
          coneHalfAngleDeg={ABILITY2_HALF_ANGLE_DEG}
          hitFlashDurationMs={HIT_FLASH_DURATION}
          floatingTextDurationMs={FLOATING_TEXT_DURATION}
          floatingTextRisePx={FLOATING_TEXT_RISE}
          mobFlashColor={MOB_FLASH_COLOR}
          mobFlashTime={MOB_FLASH_TIME}
          mobFlashStrength={MOB_FLASH_STRENGTH}
          rimColor={rim.color}
          rimStrength={rim.strength}
          glowColor={glow.color}
          glowSize={glow.size}
          glowOpacity={glow.opacity}
          glowPulse={glow.pulse}
          glowPeriodMs={glow.period}
          glowFoot={glow.foot}
        />
        <GameCanvasTextOverlay
          width={SCREEN_W}
          height={PLAY_H}
          groundItemsRef={groundItemsRef}
          floatingTextsRef={floatingTextsRef}
          floatingTextDurationMs={FLOATING_TEXT_DURATION}
          floatingTextRisePx={FLOATING_TEXT_RISE}
        />
        {RAIN_ENABLED && !weatherOff && <RainLayer />}
      </View>

      <PlayField
        enabled={false}
        player={player}
        mobs={mobs}
        corpses={corpses}
        allies={allies}
        groundActors={groundActors}
        playerAttackRange={playerAttackRange}
        aimingAbility={aimingAbility}
        aimPreviewPoint={aimPreviewPoint}
        coneZones={coneZones}
        groundItems={groundItems}
        bloodSplats={bloodSplats}
        projectiles={projectiles}
        skillMarks={skillMarks}
        hitFlashes={hitFlashes}
        floatingTexts={floatingTexts}
        weatherOff={weatherOff}
        onGrant={handlePlayAreaGrant}
        onMove={handlePlayAreaMove}
        onRelease={handlePlayAreaRelease}
      >
        {false && <>
        {/* The ground, behind everything else in the play area. */}
        <Image source={BACKGROUND} style={styles.background} resizeMode="cover" />

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
          renderCone((Math.atan2(aimPreviewPoint!.y - player.pos.y, aimPreviewPoint!.x - player.pos.x) * 180) / Math.PI)}

        {/* The cone's zone, on the ground plane under everyone's feet. It
            mounts when the pose reaches its 13th picture, and mounting is
            what starts its animation -- so the wait costs nothing until it
            is due. */}
        {coneZones.map((z) =>
          z.startAt <= Date.now() ? <ConeZoneFx key={`czone-${z.id}`} zone={z} /> : null
        )}

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

        {/* Rings where the rain lands in standing water. Before the characters,
            since they are on the ground and anyone standing there covers them. */}
        {RAIN_ENABLED && !weatherOff && PUDDLE_SPOTS.length > 0 && <RippleLayer />}

        {groundActors}

        {/* In front of everyone, as weather between the scene and the camera.
            Deaf to touches, or sixty streaks would eat every tap on the field. */}
        {RAIN_ENABLED && !weatherOff && <RainLayer />}

        {projectiles.map((pr) => {
          const progress = Math.min(1, (Date.now() - pr.createdAt) / pr.duration);
          const x = pr.from.x + (pr.to.x - pr.from.x) * progress;
          const y = pr.from.y + (pr.to.y - pr.from.y) * progress;
          return <View key={pr.id} style={[styles.projectile, { left: x - 4, top: y - 4, backgroundColor: pr.color }]} />;
        })}

        {skillMarks.map((m) => {
          const age = Date.now() - m.createdAt;
          if (age < 0) return null;
          const t = Math.min(1, age / SKILL_MARK_DURATION);
          const opacity = 0.55 * (1 - t);
          const size = m.radius * 2 * (1 + t * 0.15);
          return (
            <View
              key={m.id}
              style={[
                styles.skillMark,
                { left: m.pos.x - size / 2, top: m.pos.y - size / 2, width: size, height: size, borderRadius: size / 2, borderColor: m.color, opacity },
              ]}
            />
          );
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

        </>}
      </PlayField>

      <View style={styles.quickCastBar}>
        {/* Inventory, moved out of the old bottom bar: a small bag at the far
            left of the skill row. */}
        <Pressable onPress={() => setInvMenuOpen(true)} style={styles.invBagButton}>
          <Text style={styles.invBagIcon}>🎒</Text>
          {bagCount > 0 && (
            <View style={styles.invBagBadge}>
              <Text style={styles.menuBadgeText}>{bagCount}</Text>
            </View>
          )}
        </Pressable>
        {([1, 2, 3] as AbilityId[])
          .filter((id) => abilities[id].skill != null && abilities[id].level > 0)
          .map((id) => {
            const ab = abilities[id];
            const skill = ab.skill!;
            const meta = SKILL_META[skill];
            const cost = meta.mana;
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
                    skill === 'ranged' && player.hasteTimer > 0 && styles.abilityHaste,
                  ]}
                >
                  <Text style={styles.quickCastIcon}>{meta.icon}</Text>
                  <View style={styles.manaBadge}>
                    <Text style={styles.manaBadgeText}>{cost}</Text>
                  </View>
                  {onCooldown && (
                    <View style={styles.quickCastCooldownOverlay}>
                      <Text style={styles.cooldownText}>{Math.ceil(ab.cooldown)}</Text>
                    </View>
                  )}
                </Pressable>
                <Text style={styles.abilityCostText}>{meta.label}</Text>
              </View>
            );
          })}

        {/* The equipped passive, shown smaller beside the active buttons. */}
        {passive && (
          <View style={styles.quickCastSlot}>
            <View style={[styles.passiveChip, { backgroundColor: SKILL_META[passive.skill].color }]}>
              <Text style={styles.passiveChipIcon}>{SKILL_META[passive.skill].icon}</Text>
            </View>
          </View>
        )}
      </View>

      <View style={styles.hud}>
        <View style={styles.hudBarsRow}>
          <View style={styles.hudBarColumn}>
            <View style={styles.hudBarHeader}>
              <Text style={styles.hudBarLabel}>Lv {player.level}</Text>
              <Text style={styles.hudBarValue}>{player.xp}/{player.xpToNext}</Text>
            </View>
            <View style={styles.barBg}>
              <View style={[styles.barFillXp, { width: BAR_WIDTH * (player.xp / player.xpToNext) }]} />
            </View>
          </View>
          <View style={styles.hudBarColumn}>
            <View style={styles.hudBarHeader}>
              <Text style={styles.hudBarLabel}>HP</Text>
              <Text style={styles.hudBarValue}>{Math.round(player.hp)}/{Math.round(effectiveMaxHp)}</Text>
            </View>
            <View style={styles.barBg}>
              <View style={[styles.barFillHp, { width: BAR_WIDTH * (player.hp / effectiveMaxHp) }]} />
            </View>
          </View>
          <View style={styles.hudBarColumn}>
            <View style={styles.hudBarHeader}>
              <Text style={styles.hudBarLabel}>MP</Text>
              <Text style={styles.hudBarValue}>{Math.round(player.mana)}/{Math.round(effectiveMaxMana)}</Text>
            </View>
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

      {/* The kit's own canvas, sitting over the bars rather than inside one --
          the skull stands 172 px against the tallest bar's 84. Measured from
          the bottom of the screen, so it stays put whatever the bars do.

          Two decisions crossed here, kept in this order on purpose: Magnus
          benched the old pouch for sitting over his new skill buttons, and
          Nicolai then asked for the skull in its place (20 July) with a
          switch so it can prove its cost. Its default spot is a first guess
          that still overlaps those buttons -- where it finally sits is
          Nicolai's to settle with the tuning panel, and Magnus's concern is
          the constraint to settle it against. */}
      {COINSACK_ENABLED && !sackOff && (
        <CoinSackView
          sackRef={coinSackRef}
          left={DEBUG_COINSACK_TUNING ? tuneSackLeft : COINSACK_LEFT}
          bottom={DEBUG_COINSACK_TUNING ? tuneSackBottom : COINSACK_BOTTOM}
          width={DEBUG_COINSACK_TUNING ? tuneSackWidth : COINSACK_WIDTH}
          muted={allSoundOff}
        />
      )}

      {/* --- Temporary coin sack tuning panel; delete with DEBUG_COINSACK_TUNING --- */}
      {DEBUG_COINSACK_TUNING && (
        // Swallows stray taps rather than letting them reach the field -- see
        // the rim panel below.
        <View style={styles.tunePanel} onStartShouldSetResponder={() => true}>
          <DebugSlider label="Fra venstre" value={tuneSackLeft} min={0} max={Math.round(SCREEN_W - 40)} onChange={setTuneSackLeft} />
          <DebugSlider label="Fra bunden" value={tuneSackBottom} min={-60} max={Math.round(SCREEN_H / 2)} onChange={setTuneSackBottom} />
          <DebugSlider label="Bredde" value={tuneSackWidth} min={100} max={Math.round(SCREEN_W)} onChange={setTuneSackWidth} />
          <View style={styles.tuneButtons}>
            <Pressable style={styles.tuneButton} onPress={() => coinSackRef.current?.addCoin()}>
              <Text style={styles.tuneButtonText}>Smid en moent</Text>
            </Pressable>
            <Pressable
              style={styles.tuneButton}
              onPress={() => {
                for (let i = 0; i < 5; i++) coinSackRef.current?.addCoin();
              }}
            >
              <Text style={styles.tuneButtonText}>+5</Text>
            </Pressable>
          </View>
          <Text style={styles.tuneCode}>
            {`left: ${tuneSackLeft}, bottom: ${tuneSackBottom}, width: ${tuneSackWidth}` +
              (tuneSackWidth < SACK_MIN_W
                ? `   <- under ${SACK_MIN_W}: hele billedet skaleres ned (${(tuneSackWidth / SACK_MIN_W).toFixed(2)}x)`
                : '')}
          </Text>
        </View>
      )}

      {/* --- Temporary rim light tuning panel; delete with DEBUG_RIM_TUNING ---
          Only colour and strength are here. Which edge the light falls on and
          how far it reaches are the shape of the -rim sheets, and changing
          those means running npm run build:sprites. */}
      {DEBUG_RIM_TUNING && (
        // Swallows anything that lands on it. Without this a tap on a label or
        // on the panel's own background falls through to the field underneath
        // and sends the knight walking off while his light is being set. The
        // sliders inside still win, being deeper: the responder system offers
        // the touch to the innermost view first.
        <View style={styles.tunePanel} onStartShouldSetResponder={() => true}>
          <DebugSlider label="Roed" value={tuneRimR} min={0} max={255} onChange={setTuneRimR} />
          <DebugSlider label="Groen" value={tuneRimG} min={0} max={255} onChange={setTuneRimG} />
          <DebugSlider label="Blaa" value={tuneRimB} min={0} max={255} onChange={setTuneRimB} />
          <DebugSlider label="Styrke" value={tuneRimStrength} min={0} max={100} onChange={setTuneRimStrength} />
          <View style={styles.tuneButtons}>
            {(['screen', 'plus-lighter', 'normal'] as BlendMode[]).map((mode) => (
              <Pressable
                key={mode}
                style={[styles.tuneButton, tuneRimBlend === mode && styles.tuneButtonOn]}
                onPress={() => setTuneRimBlend(mode)}
              >
                <Text style={styles.tuneButtonText}>{mode}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[styles.tuneSwatch, { backgroundColor: rgb([tuneRimR, tuneRimG, tuneRimB]) }]} />
          <Text style={styles.tuneCode}>
            {`color: [${tuneRimR}, ${tuneRimG}, ${tuneRimB}], strength: ${(tuneRimStrength / 100).toFixed(2)}, blend: '${tuneRimBlend}'`}
          </Text>
        </View>
      )}

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
              <Text style={styles.menuTitle}>Equipped skills</Text>
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

            {([1, 2, 3] as AbilityId[])
              .filter((id) => abilities[id].skill != null)
              .map((id) => {
                const ab = abilities[id];
                const skill = ab.skill!;
                const meta = SKILL_META[skill];
                return (
                  <View key={id} style={styles.listRow}>
                    <View style={styles.listIconWrap}>
                      <Pressable
                        {...registerSlot(`skill-${id}`)}
                        onPress={() => showTooltipAboveKey(`skill-${id}`, skillDescription(skill) + skillStatsSuffix(skill))}
                        style={[styles.listIcon, { backgroundColor: meta.color }]}
                      >
                        <View style={styles.pipsRow}>
                          {[1, 2, 3, 4].map((pip) => (
                            <View key={pip} style={[styles.pip, pip <= ab.level && styles.pipFilled]} />
                          ))}
                        </View>
                      </Pressable>
                    </View>
                    <View style={styles.listInfo}>
                      <Text style={styles.listName}>
                        {meta.icon} {meta.label} · Lv {ab.level}/{ABILITY_MAX_LEVEL}
                      </Text>
                      <Text style={styles.listSub}>
                        {meta.cast === 'passive' ? 'Passive' : `${meta.mana} MP · ${meta.cooldown}s CD`}
                      </Text>
                    </View>
                  </View>
                );
              })}
            {passive && (
              <View style={styles.listRow}>
                <View style={styles.listIconWrap}>
                  <View style={[styles.listIcon, { backgroundColor: SKILL_META[passive.skill].color }]}>
                    <View style={styles.pipsRow}>
                      {[1, 2, 3, 4].map((pip) => (
                        <View key={pip} style={[styles.pip, pip <= passive.level && styles.pipFilled]} />
                      ))}
                    </View>
                  </View>
                </View>
                <View style={styles.listInfo}>
                  <Text style={styles.listName}>{SKILL_META[passive.skill].icon} {SKILL_META[passive.skill].label} · Lv {passive.level}/{ABILITY_MAX_LEVEL}</Text>
                  <Text style={styles.listSub}>Passive</Text>
                </View>
              </View>
            )}
            <Text style={styles.listSub}>Buy, level and equip skills from the main menu.</Text>
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
              <Text style={styles.menuTitle}>Inventory</Text>
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
          {!isTestRunRef.current && (
            <Text style={styles.gameOverGold}>+{lastRunGold} gold earned</Text>
          )}
          <Pressable onPress={handleBackToMenu} style={styles.retryButton}>
            <Text style={styles.retryText}>Main Menu</Text>
          </Pressable>
        </View>
      )}

      {/* Over everything, including the veil, so a fade cannot hide the numbers.
          Pushed down below the top bar so it reads inside the play field
          instead of overlapping the run controls. Its own toggle now lives in
          the settings overlay; DEBUG_PERF still strips it from the build. */}
      {DEBUG_PERF && techAreaOn && <PerfOverlay style={styles.perfOverlayInGame} />}

      {renderSettingsOverlay()}

      {/* The same two layers the menu put up, coming back off over the field. */}
      {leaveVeil}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  topBarIconButton: {
    backgroundColor: '#37474f',
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBarIconText: {
    fontSize: 15,
  },
  // The menu screen has no top bar to hang the gear off, so it gets its own
  // corner instead -- clear of the plaque and the minor-links row beneath it.
  menuSettingsButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(17,17,34,0.7)',
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBarButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  exitRunButton: {
    backgroundColor: '#b71c1c',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  exitRunText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
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
    // Kept as the colour behind the ground texture, so a slow load or a failed
    // one leaves the play area looking as it always did rather than blank.
    backgroundColor: '#26263f',
    overflow: 'hidden',
  },
  background: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: PLAY_H,
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
  skillMark: {
    position: 'absolute',
    borderWidth: 3,
    backgroundColor: 'transparent',
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
    // The round buttons poke up out of the top of this black strip, over the
    // gameplay, so nothing here may clip them.
    overflow: 'visible',
    zIndex: 5,
  },
  quickCastSlot: {
    alignItems: 'center',
    // Lift the whole slot so ~60% of the button sits above the strip (over the
    // field) and ~40% stays within the black strip.
    transform: [{ translateY: -22 }],
  },
  quickCastButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickCastIcon: {
    fontSize: 30,
  },
  invBagButton: {
    position: 'absolute',
    left: 8,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#37474f',
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ translateY: -14 }],
  },
  invBagIcon: {
    fontSize: 20,
  },
  invBagBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#90caf9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  manaBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 3,
    backgroundColor: '#2196f3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  manaBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  loadoutPreview: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    marginBottom: 6,
  },
  loadoutSlot: {
    alignItems: 'center',
  },
  passiveChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  passiveChipIcon: {
    fontSize: 15,
  },
  quickCastCooldownOverlay: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
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
  hudBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    width: BAR_WIDTH,
    marginBottom: 2,
  },
  hudBarLabel: {
    color: '#fff',
    fontSize: 11,
  },
  hudBarValue: {
    color: '#ccc',
    fontSize: 10,
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
    // Above the quick-cast bar's own zIndex: 5 -- its round buttons poke up
    // over the field and must not float over a menu meant to cover them.
    zIndex: 10,
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
  menuBg: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: SCREEN_H,
  },
  leaveVeil: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    backgroundColor: '#000',
    pointerEvents: 'none',
  },
  menuButtonArt: { width: '100%', height: '100%' },
  // Temporary: the design has one button, and these two are parked out of the
  // way until it is decided where they belong.
  menuMinorRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  menuMinorText: {
    color: '#8a7f6d',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  menuMinorDisabled: { opacity: 0.4 },
  menuScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  skillTreeScroll: {
    flex: 1,
  },
  skillTreeContent: {
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 48,
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
    // Above the quick-cast bar (zIndex: 5) and any open menu (zIndex: 10) --
    // the run has ended, nothing beneath it should still be reachable.
    zIndex: 20,
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
  gameOverGold: {
    color: '#ffd54f',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },

  // --- Main-menu skill tree / shop ---
  skillTreeHint: { color: '#b0bec5', fontSize: 12, marginBottom: 12, textAlign: 'center' },
  skillTreeGroup: {
    marginBottom: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 8,
  },
  skillRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  skillRowChild: { paddingLeft: 16, opacity: 0.98 },
  skillSwatch: { width: 26, height: 26, borderRadius: 13, marginRight: 10, justifyContent: 'center', alignItems: 'center' },
  skillSwatchIcon: { fontSize: 15 },
  skillRowInfo: { flex: 1, paddingRight: 8 },
  skillRowName: { color: '#eceff1', fontSize: 13, fontWeight: 'bold' },
  skillRowDesc: { color: '#90a4ae', fontSize: 10, marginTop: 2 },
  skillRowButtons: { flexDirection: 'row', alignItems: 'center' },
  skillBuyButton: {
    backgroundColor: '#5c6bc0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    marginRight: 6,
    minWidth: 62,
    alignItems: 'center',
  },
  skillBuyText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  skillEquipButton: {
    backgroundColor: '#37474f',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    minWidth: 62,
    alignItems: 'center',
  },
  skillEquipButtonOn: { backgroundColor: '#2e7d32' },
  skillEquipText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  skillButtonDisabled: { opacity: 0.35 },

  // --- Temporary coin sack tuning panel; delete with DEBUG_COINSACK_TUNING ---
  tunePanel: {
    position: 'absolute',
    top: TOP_BAR_HEIGHT + 8,
    left: 8,
    right: 8,
    zIndex: 50,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  tuneRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  tuneLabel: { width: 74, color: '#cfd8dc', fontSize: 11 },
  tuneTrack: {
    flex: 1,
    height: 22,
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  tuneFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4, backgroundColor: '#4fc3f7' },
  tuneKnob: {
    position: 'absolute',
    width: 12,
    height: 22,
    marginLeft: -6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  tuneValue: { width: 46, textAlign: 'right', color: '#fff', fontSize: 11, fontWeight: 'bold' },
  tuneButtons: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  tuneButton: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#3949ab' },
  tuneButtonOn: { backgroundColor: '#4fc3f7' },
  // Overrides PerfOverlay's own top-left corner so it sits under the top bar,
  // inside the play field, on the game screen. Delete with DEBUG_PERF.
  perfOverlayInGame: {
    top: TOP_BAR_HEIGHT + 4,
  },
  // Settings overlay: one row per toggle, gathered behind the cogwheel.
  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  settingsRowLabel: {
    color: '#e0e0e0',
    fontSize: 14,
  },
  settingsPill: {
    backgroundColor: '#2e7d32',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 44,
    alignItems: 'center',
  },
  settingsPillOff: { backgroundColor: '#b3402a' },
  settingsPillText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  tuneButtonText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  // The chosen colour on its own, since a rim two pixels wide is hard to read
  // a slider against.
  tuneSwatch: { height: 14, borderRadius: 4, marginTop: 6 },
  tuneCode: { marginTop: 6, color: '#ffe082', fontSize: 10 },
});

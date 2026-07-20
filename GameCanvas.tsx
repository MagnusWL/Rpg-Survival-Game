import {
  Circle,
  Group,
  Image as SkiaImage,
  Paint,
  Path,
  Rect,
  Skia,
  useImage,
} from '@shopify/react-native-skia';
import type { ImageSourcePropType } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import SkiaCanvas from './SkiaCanvas';

// --- Shapes this canvas needs from the game state. Structural (duck-typed) on
// purpose, so App.tsx's real Player/Mob/Ally/etc. objects satisfy these
// without GameCanvas importing (and coupling to) App.tsx's internals. -------

type Vec = { x: number; y: number };

export type CanvasAnimDef = {
  sheet: ImageSourcePropType;
  rim?: ImageSourcePropType;
  fps: number;
  loop: boolean;
  rows?: number;
  from?: number;
};

export type CanvasPlayer = {
  pos: Vec;
  anim: string;
  animTime: number;
  animSpeed: number;
  facing: number;
};

export type CanvasMob = {
  id: number;
  type: 'melee' | 'ranged' | 'boss';
  pos: Vec;
  hp: number;
  maxHp: number;
  radius: number;
  facing: number;
  anim: string;
  animTime: number;
  flashTime: number;
};

export type CanvasAlly = {
  id: number;
  pos: Vec;
  hp: number;
  maxHp: number;
  ranged: boolean;
};

export type CanvasProjectile = { id: number; from: Vec; to: Vec; createdAt: number; duration: number; color: string };
export type CanvasHitFlash = { id: number; pos: Vec; createdAt: number };
export type CanvasFloatingText = { id: number; text: string; pos: Vec; color: string; createdAt: number };
export type CanvasGroundItem = { item: { id: number; kind: string; level: number }; pos: Vec };

export type GameCanvasProps = {
  width: number;
  height: number;
  playerRef: React.RefObject<CanvasPlayer>;
  mobsRef: React.RefObject<CanvasMob[]>;
  alliesRef: React.RefObject<CanvasAlly[]>;
  projectilesRef: React.RefObject<CanvasProjectile[]>;
  hitFlashesRef: React.RefObject<CanvasHitFlash[]>;
  floatingTextsRef: React.RefObject<CanvasFloatingText[]>;
  groundItemsRef: React.RefObject<CanvasGroundItem[]>;
  itemColors: Record<string, string>;
  playerAttackRangeRef: React.RefObject<number>;
  aimAngleRef: React.RefObject<number | null>;

  playerAnims: Record<string, CanvasAnimDef>;
  mobAnims: Record<string, CanvasAnimDef>;
  glowSource: ImageSourcePropType;

  mobTypeColor: Record<'melee' | 'ranged' | 'boss', string>;

  // Sizing/appearance, mirroring App.tsx's constants so the two stay in sync.
  spriteCell: number;
  spriteCols: number;
  spriteRows: number;
  playerSpriteSize: number;
  playerSpriteFootOffset: number;
  mobSpriteSize: number;
  mobSpriteFootOffset: number;
  allyRadius: number;
  coneRange: number;
  coneHalfAngleDeg: number;
  hitFlashDurationMs: number;
  floatingTextDurationMs: number;
  floatingTextRisePx: number;
  mobFlashColor: string;
  mobFlashTime: number;
  mobFlashStrength: number;
  rimColor: [number, number, number];
  rimStrength: number;
  glowColor: string;
  glowSize: number;
  glowOpacity: number;
  glowPulse: number;
  glowPeriodMs: number;
  glowFoot: number;
};

function animColumn(a: CanvasAnimDef, animTime: number) {
  const from = a.from ?? 0;
  const span = 15 - from; // SPRITE_COLS is always 15 in this project
  const frame = Math.floor(animTime * a.fps);
  return from + (a.loop ? frame % span : Math.min(frame, span - 1));
}

const rgb = ([r, g, b]: [number, number, number]) => `rgb(${r}, ${g}, ${b})`;

/** One sprite-sheet frame, clipped to its cell and optionally tinted. */
function SpriteFrame({
  image,
  def,
  animTime,
  facing,
  size,
  cell,
  cols,
  x,
  y,
  tintColor,
  tintOpacity,
}: {
  image: ReturnType<typeof useImage>;
  def: CanvasAnimDef;
  animTime: number;
  facing: number;
  size: number;
  cell: number;
  cols: number;
  x: number;
  y: number;
  tintColor?: string;
  tintOpacity?: number;
}) {
  if (!image) return null;
  const rows = def.rows ?? 8;
  const col = animColumn(def, animTime);
  const row = Math.min(facing, rows - 1);
  const scale = size / cell;
  const sheetW = cell * cols * scale;
  const sheetH = cell * rows * scale;
  return (
    <Group clip={Skia.XYWHRect(x, y, size, size)}>
      <SkiaImage image={image} x={x - col * size} y={y - row * size} width={sheetW} height={sheetH} fit="fill">
        {tintColor != null && (
          <Paint color={tintColor} blendMode="srcATop" opacity={tintOpacity ?? 1} />
        )}
      </SkiaImage>
    </Group>
  );
}

function hpBar(x: number, y: number, width: number, ratio: number) {
  return (
    <Group key="hpbar">
      <Rect x={x} y={y} width={width} height={4} color="#000000" />
      <Rect x={x} y={y} width={width * Math.max(0, Math.min(1, ratio))} height={4} color="#4caf50" />
    </Group>
  );
}

export default function GameCanvas(props: GameCanvasProps) {
  const {
    width,
    height,
    playerRef,
    mobsRef,
    alliesRef,
    projectilesRef,
    hitFlashesRef,
    floatingTextsRef,
    groundItemsRef,
    itemColors,
    playerAttackRangeRef,
    aimAngleRef,
    playerAnims,
    mobAnims,
    glowSource,
    mobTypeColor,
    spriteCell,
    spriteCols,
    playerSpriteSize,
    playerSpriteFootOffset,
    mobSpriteSize,
    mobSpriteFootOffset,
    allyRadius,
    coneRange,
    coneHalfAngleDeg,
    hitFlashDurationMs,
    floatingTextDurationMs,
    floatingTextRisePx,
    mobFlashColor,
    mobFlashStrength,
    rimColor,
    rimStrength,
    glowColor,
    glowSize,
    glowOpacity,
    glowPulse,
    glowPeriodMs,
    glowFoot,
  } = props;

  // Preload every sprite sheet + rim variant once. Fixed set, so the hook
  // count never changes between renders.
  const playerImgs: Record<string, ReturnType<typeof useImage>> = {};
  const playerRimImgs: Record<string, ReturnType<typeof useImage>> = {};
  for (const [name, def] of Object.entries(playerAnims)) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    playerImgs[name] = useImage(def.sheet as any);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    playerRimImgs[name] = def.rim ? useImage(def.rim as any) : null;
  }
  const mobImgs: Record<string, ReturnType<typeof useImage>> = {};
  for (const [name, def] of Object.entries(mobAnims)) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    mobImgs[name] = useImage(def.sheet as any);
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const glowImg = useImage(glowSource as any);

  // Its own render clock, isolated from the rest of the app -- this is the
  // whole point of moving here: nothing outside this component re-renders
  // when combat updates.
  const [, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const loop = () => {
      setTick((t) => (t + 1) % 1000000);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const now = Date.now();
  const player = playerRef.current;
  const mobs = mobsRef.current ?? [];
  const allies = alliesRef.current ?? [];
  const projectiles = projectilesRef.current ?? [];
  const hitFlashes = hitFlashesRef.current ?? [];
  const floatingTexts = floatingTextsRef.current ?? [];
  const groundItems = groundItemsRef.current ?? [];
  const playerAttackRange = playerAttackRangeRef.current ?? 0;
  const aimAngle = aimAngleRef.current;

  if (!player) {
    return <SkiaCanvas style={{ width, height }} />;
  }

  // Depth-sorted actors: allies, player (+ its glow), mobs -- by feet (y).
  type Actor = { y: number; node: React.ReactNode };
  const actors: Actor[] = [];

  for (const a of allies) {
    actors.push({
      y: a.pos.y,
      node: (
        <Group key={`ally-${a.id}`}>
          <Circle cx={a.pos.x} cy={a.pos.y} r={allyRadius} color={a.ranged ? '#b39ddb' : '#9575cd'} />
          {hpBar(a.pos.x - allyRadius, a.pos.y - allyRadius - 8, allyRadius * 2, a.hp / a.maxHp)}
        </Group>
      ),
    });
  }

  // The glow sits under the knight but above the ground, in its own layer so
  // its blend mode reaches the ground rather than just the sprite above it.
  const glowPulseSize = glowSize * (1 + Math.sin(((now % glowPeriodMs) / glowPeriodMs) * Math.PI * 2) * glowPulse);
  if (glowImg) {
    actors.push({
      y: player.pos.y - 0.5, // just under the player in a tie
      node: (
        <Group key="player-glow" blendMode="plusLighter">
          <SkiaImage
            image={glowImg}
            x={player.pos.x - glowPulseSize / 2}
            y={player.pos.y + glowFoot - glowPulseSize / 2}
            width={glowPulseSize}
            height={glowPulseSize}
            fit="fill"
          >
            <Paint color={glowColor} blendMode="srcATop" opacity={glowOpacity} />
          </SkiaImage>
        </Group>
      ),
    });
  }

  const playerDef = playerAnims[player.anim];
  if (playerDef) {
    const px = player.pos.x - playerSpriteSize / 2;
    const py = player.pos.y + playerSpriteFootOffset - playerSpriteSize;
    actors.push({
      y: player.pos.y,
      node: (
        <Group key="player">
          <SpriteFrame
            image={playerImgs[player.anim]}
            def={playerDef}
            animTime={player.animTime * player.animSpeed}
            facing={player.facing}
            size={playerSpriteSize}
            cell={spriteCell}
            cols={spriteCols}
            x={px}
            y={py}
          />
          {playerRimImgs[player.anim] && (
            <Group blendMode="screen">
              <SpriteFrame
                image={playerRimImgs[player.anim]}
                def={playerDef}
                animTime={player.animTime * player.animSpeed}
                facing={player.facing}
                size={playerSpriteSize}
                cell={spriteCell}
                cols={spriteCols}
                x={px}
                y={py}
                tintColor={rgb(rimColor)}
                tintOpacity={rimStrength}
              />
            </Group>
          )}
        </Group>
      ),
    });
  }

  for (const m of mobs) {
    const meta = mobTypeColor[m.type];
    const node =
      m.type === 'melee' && mobAnims[m.anim] ? (
        <SpriteFrame
          image={mobImgs[m.anim]}
          def={mobAnims[m.anim]}
          animTime={m.animTime}
          facing={m.facing}
          size={mobSpriteSize}
          cell={spriteCell}
          cols={spriteCols}
          x={m.pos.x - mobSpriteSize / 2}
          y={m.pos.y + mobSpriteFootOffset - mobSpriteSize}
          tintColor={m.flashTime > 0 ? mobFlashColor : undefined}
          tintOpacity={m.flashTime > 0 ? (m.flashTime / props.mobFlashTime) * mobFlashStrength : undefined}
        />
      ) : (
        <Circle cx={m.pos.x} cy={m.pos.y} r={m.radius} color={meta} />
      );
    actors.push({
      y: m.pos.y,
      node: (
        <Group key={`mob-${m.id}`}>
          {node}
          {hpBar(m.pos.x - m.radius, m.pos.y - m.radius - 8, m.radius * 2, m.hp / m.maxHp)}
        </Group>
      ),
    });
  }

  actors.sort((a, b) => a.y - b.y);

  // Cone preview: a filled wedge from the player toward the aim direction.
  let conePath: ReturnType<typeof Skia.Path.Make> | null = null;
  if (aimAngle != null) {
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const a1 = rad(aimAngle - coneHalfAngleDeg);
    const a2 = rad(aimAngle + coneHalfAngleDeg);
    const p1 = { x: player.pos.x + coneRange * Math.cos(a1), y: player.pos.y + coneRange * Math.sin(a1) };
    const p2 = { x: player.pos.x + coneRange * Math.cos(a2), y: player.pos.y + coneRange * Math.sin(a2) };
    const path = Skia.Path.Make();
    path.moveTo(player.pos.x, player.pos.y);
    path.lineTo(p1.x, p1.y);
    path.lineTo(p2.x, p2.y);
    path.close();
    conePath = path;
  }

  return (
    <SkiaCanvas style={{ width, height }}>
      {/* Range ring */}
      <Circle
        cx={player.pos.x}
        cy={player.pos.y}
        r={playerAttackRange}
        color="rgba(255,255,255,0.25)"
        style="stroke"
        strokeWidth={1.5}
      />

      {conePath && <Path path={conePath} color="rgba(255,138,80,0.28)" />}

      {groundItems.map((it) => (
        <Rect
          key={`item-${it.item.id}`}
          x={it.pos.x - 11}
          y={it.pos.y - 11}
          width={22}
          height={22}
          color={itemColors[it.item.kind] ?? '#888'}
        />
      ))}

      {actors.map((a) => a.node)}

      {projectiles.map((pr) => {
        const t = Math.min(1, (now - pr.createdAt) / pr.duration);
        const x = pr.from.x + (pr.to.x - pr.from.x) * t;
        const y = pr.from.y + (pr.to.y - pr.from.y) * t;
        return <Circle key={`pr-${pr.id}`} cx={x} cy={y} r={4} color={pr.color} />;
      })}

      {hitFlashes.map((f) => {
        const age = now - f.createdAt;
        const opacity = Math.max(0, 1 - age / hitFlashDurationMs);
        return <Circle key={`fl-${f.id}`} cx={f.pos.x} cy={f.pos.y} r={10} color="#ffffff" opacity={opacity} />;
      })}
    </SkiaCanvas>
  );
}

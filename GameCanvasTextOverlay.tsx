import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

// Text for the fast-moving layer, kept in plain React Native rather than
// Skia: @shopify/react-native-skia's matchFont() throws "Not implemented on
// React Native Web" for system fonts, and bundling a .ttf just to draw a
// handful of small labels isn't worth it -- text was never the part of the
// play area that was expensive (that was the sprite stacks), so it stays
// here, layered over the Skia canvas.

type Vec = { x: number; y: number };
export type OverlayGroundItem = { item: { id: number; level: number }; pos: Vec };
export type OverlayFloatingText = { id: number; text: string; pos: Vec; color: string; createdAt: number };

export type GameCanvasTextOverlayProps = {
  width: number;
  height: number;
  groundItemsRef: React.RefObject<OverlayGroundItem[]>;
  floatingTextsRef: React.RefObject<OverlayFloatingText[]>;
  floatingTextDurationMs: number;
  floatingTextRisePx: number;
};

export default function GameCanvasTextOverlay({
  width,
  height,
  groundItemsRef,
  floatingTextsRef,
  floatingTextDurationMs,
  floatingTextRisePx,
}: GameCanvasTextOverlayProps) {
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
  const groundItems = groundItemsRef.current ?? [];
  const floatingTexts = floatingTextsRef.current ?? [];

  return (
    <View pointerEvents="none" style={[styles.root, { width, height }]}>
      {groundItems.map((it) => (
        <Text
          key={`gi-${it.item.id}`}
          style={[styles.groundItemText, { left: it.pos.x - 11, top: it.pos.y - 7 }]}
        >
          {it.item.level}
        </Text>
      ))}
      {floatingTexts.map((f) => {
        const age = now - f.createdAt;
        const t = Math.min(1, age / floatingTextDurationMs);
        const opacity = Math.max(0, 1 - t);
        const y = f.pos.y - t * floatingTextRisePx;
        return (
          <Text key={`ft-${f.id}`} style={[styles.floatingText, { left: f.pos.x - 25, top: y - 10, color: f.color, opacity }]}>
            {f.text}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  groundItemText: {
    position: 'absolute',
    width: 22,
    textAlign: 'center',
    color: '#1b1b2b',
    fontSize: 11,
    fontWeight: 'bold',
  },
  floatingText: {
    position: 'absolute',
    width: 50,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: 'bold',
  },
});

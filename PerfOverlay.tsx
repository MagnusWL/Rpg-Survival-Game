/**
 * A frame-time readout, for finding out what actually costs before changing it.
 *
 * Written because the preview pane could not be trusted to measure this: it
 * goes hidden without warning, and a hidden pane gets no animation frames at
 * all, which turns into a fake 140 ms "stall" the moment it comes back. So the
 * numbers have to be taken where the game is really being played.
 *
 * It reports once a second rather than every frame, so watching costs almost
 * nothing: the frame loop only pushes a number into an array.
 *
 * What to read:
 *   fps      what it averaged over the last second
 *   med      the typical frame. Under 16 ms is smooth at 60 Hz.
 *   p90      the slowest one in ten. This is what stutter feels like.
 *   top      the single worst frame in the last second.
 *   hak      how many frames took over 33 ms -- a dropped frame at 30 Hz.
 *   dom      how many elements are on the page.
 *
 * A high fps with a bad top and a few hak is not a slow game, it is a game that
 * hitches -- and the two have completely different causes. Steady slowness is
 * work every frame; hitches are usually something arriving, being decoded, or
 * being collected.
 */
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

/**
 * How many times the game loop actually simulated this second, as opposed to
 * how many frames the browser drew. The two parted ways when the loop got its
 * 60-cap: on a fast monitor fps stays at the display's rate while sim holds at
 * 60, and this is the number that proves the cap is doing its job.
 */
let simTicks = 0;
export const bumpSimTick = () => {
  simTicks++;
};

type Stats = {
  fps: number;
  /** Game-loop updates this second -- capped at 60 where fps follows the display. */
  sim: number;
  med: number;
  p90: number;
  top: number;
  hak: number;
  dom: number;
  /** Whether the page went hidden during the second. Its numbers are rubbish. */
  blinked: boolean;
};

export default function PerfOverlay() {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let frames: number[] = [];
    let last = performance.now();
    let raf = 0;
    let blinked = document.hidden;

    const onVis = () => {
      blinked = true;
    };
    document.addEventListener('visibilitychange', onVis);

    const tick = (now: number) => {
      frames.push(now - last);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const iv = setInterval(() => {
      if (frames.length < 2) return;
      const sorted = frames.slice().sort((a, b) => a - b);
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      setS({
        fps: Math.round(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length)),
        sim: simTicks,
        med: Math.round(at(0.5)),
        p90: Math.round(at(0.9)),
        top: Math.round(sorted[sorted.length - 1]),
        hak: frames.filter((f) => f > 33).length,
        dom: document.querySelectorAll('*').length,
        blinked,
      });
      frames = [];
      simTicks = 0;
      blinked = document.hidden;
    }, 1000);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  if (Platform.OS !== 'web') return null;

  // Shown before the first second is up, and while a hidden tab is giving no
  // frames at all -- otherwise the panel is simply absent and reads as broken.
  if (!s) {
    return (
      <View style={styles.box}>
        <Text style={styles.line}>maaler...</Text>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.line}>
        {s.fps} fps{'  '}sim {s.sim}{'  '}med {s.med}{'  '}p90 {s.p90}{'  '}top {s.top} ms
      </Text>
      <Text style={[styles.line, s.hak > 0 && styles.bad]}>
        hak {s.hak}{'  '}dom {s.dom}
        {s.blinked ? '   (fanen var skjult -- tallene gaelder ikke)' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    top: 2,
    left: 2,
    zIndex: 300,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.66)',
    // In the style rather than as a prop; the prop form is deprecated and
    // warned on every mount.
    pointerEvents: 'none',
  },
  line: { color: '#9fe8a0', fontSize: 10, fontVariant: ['tabular-nums'] },
  bad: { color: '#ff8a65' },
});

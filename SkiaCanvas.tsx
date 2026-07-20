import { Canvas } from '@shopify/react-native-skia';
import type { ComponentProps } from 'react';
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';

/**
 * Skia's web `<Canvas>` only builds its WebGL renderer when the container's
 * `onLayout` fires, which it wires to an internal ResizeObserver. In this stack
 * (react-native-skia 2.6 + react-native-web 0.21) that observer never delivers,
 * so the canvas stays blank at its default 300x150 buffer. The whole render
 * pipeline works the instant the layout handler runs -- confirmed by manually
 * invoking it -- so here we attach our own ResizeObserver to the canvas's
 * container div and drive that handler ourselves. No-op on native, where the
 * real onLayout fires normally.
 */
function useSkiaWebLayoutFix(wrapperRef: React.RefObject<View | null>) {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const wrapper = wrapperRef.current as unknown as HTMLElement | null;
    if (!wrapper || typeof wrapper.querySelector !== 'function') return;

    let ro: ResizeObserver | null = null;
    let cancelled = false;

    const attach = () => {
      if (cancelled) return;
      const canvas = wrapper.querySelector('canvas');
      const div = canvas?.parentElement;
      if (!canvas || !div) {
        // Canvas not mounted yet (Skia still initializing); retry next frame.
        requestAnimationFrame(attach);
        return;
      }
      const fire = () => {
        const handler = (div as any).__reactLayoutHandler;
        if (typeof handler !== 'function') return;
        handler({
          timeStamp: Date.now(),
          nativeEvent: { layout: { x: 0, y: 0, width: div.clientWidth, height: div.clientHeight } },
          currentTarget: 0,
          target: 0,
          bubbles: false,
          cancelable: false,
          defaultPrevented: false,
          eventPhase: 0,
          isTrusted: true,
          type: '',
          isDefaultPrevented() {},
          isPropagationStopped() {},
          persist() {},
          preventDefault() {},
          stopPropagation() {},
        });
      };
      ro = new ResizeObserver(() => fire());
      ro.observe(div);
      fire();
    };

    attach();
    return () => {
      cancelled = true;
      if (ro) ro.disconnect();
    };
  }, [wrapperRef]);
}

type SkiaCanvasProps = ComponentProps<typeof Canvas>;

export default function SkiaCanvas(props: SkiaCanvasProps) {
  const wrapperRef = useRef<View | null>(null);
  useSkiaWebLayoutFix(wrapperRef);

  if (Platform.OS !== 'web') {
    return <Canvas {...props} />;
  }
  // The wrapper gives us a stable DOM node to find the Skia <canvas> under.
  return (
    <View ref={wrapperRef} style={props.style}>
      <Canvas {...props} style={{ flex: 1 }} />
    </View>
  );
}

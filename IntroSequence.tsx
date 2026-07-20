/**
 * What happens before the menu: a logo card, then the three story cards.
 *
 * It sits over the menu rather than being a screen of its own. That way the
 * menu is already built and mounted underneath the whole time -- its tear
 * canvas has eleven seconds to assemble itself instead of the fraction of a
 * second it used to get -- and the last card can simply dissolve away to reveal
 * it, with no black gap and no handing a fade from one screen to another.
 *
 * The cards are mounted from the first frame at zero opacity, which is also how
 * they are preloaded: mounting them is what makes the browser fetch them, so by
 * the time each is faded up it has long since arrived. The first one is the
 * exception, since it is only two seconds behind the logo, and that one is
 * waited for properly -- see the schedule below.
 *
 * The art is a placeholder for a placeholder: these three are stills that will
 * be replaced by animated versions, and the logo is literally the word LOGO.
 */
import { Asset } from 'expo-asset';
import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Image, Pressable, StyleSheet, Text } from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/**
 * The story, in order: the two of them at the fire, her being carried off, and
 * what he walks into looking for her. Numbered rather than named, because the
 * order is the story.
 */
const CARDS = [
  require('./assets/sprites/intro/1.jpg'),
  require('./assets/sprites/intro/2.jpg'),
  require('./assets/sprites/intro/3.jpg'),
];

/** How long the logo card holds, once it is up. */
const LOGO_MS = 2000;
/** And how long it may hold while waiting for the first card to arrive. */
const LOGO_MAX_MS = 4500;
/** How long each story card is on screen, fade included. */
const CARD_MS = 3000;

const LOGO_FADE_MS = 700;
/** Card to card. Both are opaque, so this is a straight cross-dissolve. */
const CARD_FADE_MS = 600;
/** The last card dissolving into the menu waiting underneath. */
const TO_MENU_MS = 800;

/** The blood red the plaque is drawn in, so the logo belongs to the same game. */
const LOGO_COLOR = '#7e1610';
const LOGO_TRACKING = 14;

export default function IntroSequence({ onDone }: { onDone: () => void }) {
  /** 0 is the logo, 1..3 are the cards, and anything past that is leaving. */
  const [step, setStep] = useState(0);
  const [logoHeld, setLogoHeld] = useState(false);
  const [firstCardReady, setFirstCardReady] = useState(false);

  const logoFade = useRef(new Animated.Value(0)).current;
  const cardFades = useRef(CARDS.map(() => new Animated.Value(0))).current;
  /** The whole thing, which fades out at the end to uncover the menu. */
  const overlay = useRef(new Animated.Value(1)).current;

  const leaving = step > CARDS.length;

  /**
   * Held in a ref so the schedule below does not depend on it.
   *
   * The caller writes it as an inline arrow, which is a new function on every
   * render of the menu -- and an effect that lists it restarts its timers each
   * time, which would quietly stretch whichever card was showing.
   */
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  /**
   * Asked for once, and never through the Image's own onLoad prop.
   *
   * react-native-web's loading effect lists onLoad among its dependencies and
   * aborts the request it has in flight when it re-runs, so an inline handler
   * -- a new identity on every render -- cancels and restarts the very load it
   * is waiting for, and never reports. Prefetch is a promise, out of the render
   * tree, and nothing up here can abort it. It warms the browser cache, so the
   * card below then draws from memory.
   */
  useEffect(() => {
    let cancelled = false;
    // Ready either way: a card that will not load must not strand the intro on
    // a logo. The cap is the backstop for a load that neither settles nor fails.
    const ready = () => {
      if (!cancelled) setFirstCardReady(true);
    };
    Image.prefetch(Asset.fromModule(CARDS[0]).uri).then(ready, ready);
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The logo waits for the clock and for the first card both.
   *
   * Two seconds of black is the natural place to spend whatever loading time
   * there is -- the same trick the coin sack needed -- so rather than fade up an
   * image that has not arrived, the logo simply holds until it has. The cap
   * below means a card that never loads cannot strand the intro on a logo.
   */
  useEffect(() => {
    if (step === 0 && logoHeld && firstCardReady) setStep(1);
  }, [step, logoHeld, firstCardReady]);

  useEffect(() => {
    // Leaving: uncover the menu, then stop existing. The unmount is on a timer
    // rather than the animation's own callback, because an animation only
    // finishes if frames are being drawn and a throttled tab draws almost none.
    if (leaving) {
      Animated.timing(overlay, {
        toValue: 0,
        duration: TO_MENU_MS,
        useNativeDriver: true,
      }).start();
      const done = setTimeout(() => onDoneRef.current(), TO_MENU_MS);
      return () => clearTimeout(done);
    }

    if (step === 0) {
      Animated.timing(logoFade, {
        toValue: 1,
        duration: LOGO_FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      const held = setTimeout(() => setLogoHeld(true), LOGO_MS);
      const cap = setTimeout(() => setStep(1), LOGO_MAX_MS);
      return () => {
        clearTimeout(held);
        clearTimeout(cap);
      };
    }

    const i = step - 1;

    // Everything behind the incoming card is snapped solid first. Left to fade
    // on its own a card can still be halfway up when a tap calls for the next
    // one, and the new one would then dissolve in over black instead of over
    // the picture it is supposed to be replacing.
    for (let k = 0; k < i; k++) cardFades[k].setValue(1);
    if (i > 0) logoFade.setValue(0);
    else Animated.timing(logoFade, { toValue: 0, duration: CARD_FADE_MS, useNativeDriver: true }).start();

    Animated.timing(cardFades[i], {
      toValue: 1,
      duration: CARD_FADE_MS,
      useNativeDriver: true,
    }).start();

    const next = setTimeout(() => setStep((s) => s + 1), CARD_MS);
    return () => clearTimeout(next);
  }, [step, leaving, logoFade, cardFades, overlay]);

  return (
    <Animated.View style={[styles.root, { opacity: overlay }]}>
      <Animated.View style={[styles.logoWrap, { opacity: logoFade }]}>
        <Text style={styles.logoText}>LOGO</Text>
      </Animated.View>

      {CARDS.map((card, i) => (
        <Animated.Image
          key={i}
          source={card}
          resizeMode="cover"
          style={[styles.card, { opacity: cardFades[i] }]}
        />
      ))}

      {/* Tap to move on. It stays put while leaving rather than being taken
          away, so an eager last tap lands here and not on RESCUE HER. */}
      <Pressable style={styles.card} onPress={() => !leaving && setStep((s) => s + 1)} />
    </Animated.View>
  );
}

/** Written out rather than taken from StyleSheet, as the rest of the game does. */
const FILL = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } as const;

const styles = StyleSheet.create({
  root: {
    ...FILL,
    backgroundColor: '#000',
    // Over the menu, and over the veil the menu fades itself out with.
    zIndex: 200,
  },
  /**
   * Sized outright rather than pinned to all four edges, which is what the menu
   * background does and for the same reason: an Image given no width or height
   * falls back to the source's own, and these are 941x1672. Pinned, they drew a
   * 941-wide box in a 390-wide screen -- the top left corner of the picture,
   * enormous -- because the intrinsic size wins over the insets.
   */
  card: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_W,
    height: SCREEN_H,
  },
  logoWrap: {
    ...FILL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: LOGO_COLOR,
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: LOGO_TRACKING,
    // Tracking is added after the last letter too, so without this the word
    // sits half a space left of centre.
    paddingLeft: LOGO_TRACKING,
  },
});

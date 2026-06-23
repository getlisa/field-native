import { useCallback, useEffect, useRef } from 'react';
import { Animated, Dimensions, GestureResponderEvent, PanResponder, PanResponderGestureState } from 'react-native';

export interface SwipeNavigationConfig<T extends string> {
  tabs: readonly T[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  swipeThreshold?: number;
  animationDuration?: number;
  /** When false, the swipe gesture is disabled (e.g. while a signature pad/modal is open). */
  enabled?: boolean;
}

export interface SwipeNavigationReturn<T extends string = string> {
  panResponder: ReturnType<typeof PanResponder.create>;
  panX: Animated.Value;
  slideAnim: Animated.Value;
  fadeAnim: Animated.Value;
  /** Programmatic tab change with animation (for tab button presses). */
  changeTab: (tab: T) => void;
}

export const useSwipeNavigation = <T extends string>({
  tabs,
  activeTab,
  onTabChange,
  swipeThreshold = 50,
  animationDuration = 150,
  enabled = true,
}: SwipeNavigationConfig<T>): SwipeNavigationReturn<T> => {
  const screenWidth = Dimensions.get('window').width;

  const slideAnim = useRef(new Animated.Value(0)).current;
  const panX = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const activeTabRef = useRef<T>(activeTab);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Single-phase tab change: update state immediately, then run a quick
  // native-driven fade-in. No JS callback between phases — eliminates the
  // frame-drop that the old two-phase (fade-out → JS → fade-in) caused on iOS.
  const changeTab = useCallback(
    (newTab: T) => {
      if (newTab === activeTabRef.current) return;

      const oldIndex = tabs.indexOf(activeTabRef.current);
      const newIndex = tabs.indexOf(newTab);
      const direction = newIndex > oldIndex ? -1 : 1;

      // Switch state immediately (with keep-alive tabs, content is already mounted)
      onTabChange(newTab);

      // Quick single-phase slide-in + fade-in for visual polish
      slideAnim.setValue(direction * screenWidth * 0.08);
      fadeAnim.setValue(0.6);

      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: animationDuration,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: animationDuration,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [tabs, slideAnim, fadeAnim, screenWidth, animationDuration, onTabChange],
  );

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (
        _evt: GestureResponderEvent,
        gestureState: PanResponderGestureState,
      ) => {
        if (!enabledRef.current) return false;
        return (
          Math.abs(gestureState.dx) > 10 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
        );
      },
      onPanResponderMove: (
        _evt: GestureResponderEvent,
        gestureState: PanResponderGestureState,
      ) => {
        panX.setValue(gestureState.dx);
      },
      onPanResponderRelease: (
        _evt: GestureResponderEvent,
        gestureState: PanResponderGestureState,
      ) => {
        const currentTab = activeTabRef.current;
        const currentIndex = tabs.indexOf(currentTab);

        Animated.spring(panX, {
          toValue: 0,
          useNativeDriver: true,
          tension: 120,
          friction: 20,
        }).start();

        if (gestureState.dx < -swipeThreshold) {
          if (currentIndex < tabs.length - 1) {
            changeTab(tabs[currentIndex + 1]);
          }
        } else if (gestureState.dx > swipeThreshold) {
          if (currentIndex > 0) {
            changeTab(tabs[currentIndex - 1]);
          }
        }
      },
    }),
  ).current;

  return {
    panResponder,
    panX,
    slideAnim,
    fadeAnim,
    changeTab,
  };
};

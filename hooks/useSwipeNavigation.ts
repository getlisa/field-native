import { useCallback, useEffect, useRef } from 'react';
import { Animated, Dimensions, GestureResponderEvent, PanResponder, PanResponderGestureState } from 'react-native';

export interface SwipeNavigationConfig<T extends string> {
  tabs: readonly T[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  swipeThreshold?: number;
  animationDuration?: number;
}

export interface SwipeNavigationReturn {
  panResponder: ReturnType<typeof PanResponder.create>;
  panX: Animated.Value;
  slideAnim: Animated.Value;
  fadeAnim: Animated.Value;
}

/**
 * Reusable hook for smooth swipe navigation between tabs
 * 
 * Features:
 * - Horizontal swipe gestures
 * - Smooth slide and fade animations
 * - Configurable thresholds and durations
 * 
 * @example
 * ```tsx
 * const { panResponder, slideAnim, fadeAnim } = useSwipeNavigation({
 *   tabs: ['home', 'profile'],
 *   activeTab: currentTab,
 *   onTabChange: setCurrentTab,
 * });
 * ```
 */
export const useSwipeNavigation = <T extends string>({
  tabs,
  activeTab,
  onTabChange,
  swipeThreshold = 50,
  animationDuration = 250,
}: SwipeNavigationConfig<T>): SwipeNavigationReturn => {
  const screenWidth = Dimensions.get('window').width;
  
  // Animated values
  const slideAnim = useRef(new Animated.Value(0)).current;
  const panX = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  
  // Track current tab in ref for panResponder
  const activeTabRef = useRef<T>(activeTab);
  
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);
  
  // Handle tab change with animation
  const changeTab = useCallback((newTab: T) => {
    const oldIndex = tabs.indexOf(activeTabRef.current);
    const newIndex = tabs.indexOf(newTab);
    const direction = newIndex > oldIndex ? -1 : 1;
    
    // Slide and fade out
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: direction * screenWidth * 0.2,
        duration: animationDuration * 0.6,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: animationDuration * 0.5,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Change tab while invisible
      onTabChange(newTab);
      slideAnim.setValue(direction * -screenWidth * 0.2);
      
      // Slide and fade in
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: animationDuration * 0.6,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: animationDuration * 0.5,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [tabs, slideAnim, fadeAnim, screenWidth, animationDuration, onTabChange]);
  
  // Create pan responder for swipe gestures
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        // Only respond to horizontal swipes
        return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
      },
      onPanResponderMove: (_evt: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        // Update pan position for live feedback
        panX.setValue(gestureState.dx);
      },
      onPanResponderRelease: (_evt: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        const currentTab = activeTabRef.current;
        const currentIndex = tabs.indexOf(currentTab);
        
        // Reset pan animation
        Animated.spring(panX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
        
        if (gestureState.dx < -swipeThreshold) {
          // Swipe LEFT → Next tab
          if (currentIndex < tabs.length - 1) {
            changeTab(tabs[currentIndex + 1]);
          }
        } else if (gestureState.dx > swipeThreshold) {
          // Swipe RIGHT → Previous tab
          if (currentIndex > 0) {
            changeTab(tabs[currentIndex - 1]);
          }
        }
      },
    })
  ).current;
  
  return {
    panResponder,
    panX,
    slideAnim,
    fadeAnim,
  };
};


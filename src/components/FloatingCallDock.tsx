import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '../theme/tokens';

/** Movable call controls; a tap remains available to the child buttons. */
export function FloatingCallDock({ children, style }: { children: ReactNode; style: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [height, setHeight] = useState(0);
  const translateY = useRef(new Animated.Value(0)).current;
  const offset = useRef(0);
  const dragStart = useRef(0);
  const top = Math.max(insets.top, spacing.sm);
  const maxOffset = Math.max(0, windowHeight - top - height - insets.bottom - spacing.sm);

  useEffect(() => {
    // Keep controls reachable after rotation or a change in banner height.
    offset.current = Math.min(offset.current, maxOffset);
    translateY.setValue(offset.current);
  }, [maxOffset, translateY]);

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > spacing.sm && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => { dragStart.current = offset.current; },
    onPanResponderMove: (_event, gesture) => {
      offset.current = Math.max(0, Math.min(maxOffset, dragStart.current + gesture.dy));
      translateY.setValue(offset.current);
    },
    onPanResponderTerminationRequest: () => false,
  }), [maxOffset, translateY]);

  return (
    <Animated.View
      {...responder.panHandlers}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      style={[style, { top, transform: [{ translateY }] }]}
    >
      {children}
    </Animated.View>
  );
}

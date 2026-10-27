import { Reply } from 'lucide-react-native';
import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';
import { controlSize, spacing } from '../theme/tokens';

const REPLY_THRESHOLD = 40;
const ACTION_WIDTH = 56;
// Require a deliberate horizontal drag and let vertical list scrolling fail the
// pan before it activates, so scrolling a message never opens the reply action.
const HORIZONTAL_ACTIVATION = 20;
const VERTICAL_TOLERANCE = 14;

export function SwipeToReply({ children, onReply, enabled = true }: { children: ReactNode; onReply: () => void; enabled?: boolean }) {
  const { colors } = useTheme();
  const translation = useSharedValue(0);
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;
  const reply = useCallback(() => onReplyRef.current(), []);
  const gesture = useMemo(
    () => Gesture.Pan()
      .enabled(enabled)
      .activeOffsetX(HORIZONTAL_ACTIVATION)
      .failOffsetY([-VERTICAL_TOLERANCE, VERTICAL_TOLERANCE])
      .onUpdate((event) => {
        translation.value = Math.max(0, Math.min(ACTION_WIDTH, event.translationX));
      })
      .onEnd((_event, success) => {
        if (success && translation.value >= REPLY_THRESHOLD) runOnJS(reply)();
      })
      .onFinalize(() => {
        translation.value = withSpring(0, { damping: 20, stiffness: 200 });
      }),
    [enabled, reply, translation],
  );
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translation.value }] }));
  const actionStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, translation.value / REPLY_THRESHOLD) }));
  return (
    <View style={styles.row}>
      <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.action, actionStyle]}>
        <View style={[styles.icon, { backgroundColor: colors.surfaceSecondary }]}>
          <Reply color={colors.primary} size={20} strokeWidth={2.4} />
        </View>
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View style={contentStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { overflow: 'hidden' },
  action: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, paddingVertical: spacing.xxs, position: 'absolute', top: 0, width: ACTION_WIDTH },
  icon: { alignItems: 'center', borderRadius: controlSize.compact / 2, height: controlSize.compact, justifyContent: 'center', width: controlSize.compact },
});

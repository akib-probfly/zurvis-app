import { memo, useState } from 'react';
import { Platform, Text, View, useWindowDimensions } from 'react-native';
import { fontSize, fontWeight, lineHeight } from '../../theme/tokens';
import { openLink } from './links';

export const UnderlinedMessageLink = memo(function UnderlinedMessageLink({ value, href, color, size = fontSize.body }: { value: string; href: string; color: string; size?: number }) {
  const { fontScale } = useWindowDimensions();
  const [measurement, setMeasurement] = useState<{ key: string; width: number; baselineOffset: number } | null>(null);
  const measurementKey = `${value}:${size}:${fontScale}`;
  const width = measurement?.key === measurementKey ? measurement.width : value.length * size * fontScale * 0.65;
  const height = lineHeight.body * fontScale + 2;
  const baselineOffset = measurement?.key === measurementKey ? measurement.baselineOffset : (lineHeight.body - size) * fontScale / 2 + 2;
  const textStyle = { color, fontSize: size, fontWeight: fontWeight.bold, lineHeight: lineHeight.body };
  // Explicit dimensions let this view participate in native inline text layout.
  // Draw a solid 2dp line close to the text without changing text layout.
  return (
    <View style={{ width, height, transform: Platform.OS === 'android' ? [{ translateY: baselineOffset }] : undefined }}>
      {measurement?.key !== measurementKey ? <Text
        accessible={false}
        pointerEvents="none"
        style={[textStyle, { position: 'absolute', width: 1000, opacity: 0 }]}
        onTextLayout={(event) => {
          const line = event.nativeEvent.lines[0];
          const measuredWidth = Math.ceil(line?.width ?? 0);
          if (measuredWidth > 0 && (measurement?.key !== measurementKey || measurement.width !== measuredWidth)) {
            // Android anchors inline views at their bottom edge, not the child's
            // text baseline. Move the whole link (including its underline) down
            // by the measured space below that baseline.
            setMeasurement({ key: measurementKey, width: measuredWidth, baselineOffset: Math.max(0, height - line.y - line.ascender) });
          }
        }}
      >{value}</Text> : null}
      <Text style={textStyle} numberOfLines={1} accessibilityRole="link" onPress={() => openLink(href)}>{value}</Text>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 3 * fontScale, height: 2, backgroundColor: color }} />
    </View>
  );
});


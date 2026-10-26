import { memo, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { fontSize, fontWeight, lineHeight } from '../../theme/tokens';
import { openLink } from './links';

export const UnderlinedMessageLink = memo(function UnderlinedMessageLink({ value, href, color, size = fontSize.body }: { value: string; href: string; color: string; size?: number }) {
  const { fontScale } = useWindowDimensions();
  const [measurement, setMeasurement] = useState<{ key: string; width: number } | null>(null);
  const measurementKey = `${value}:${size}:${fontScale}`;
  const width = measurement?.key === measurementKey ? measurement.width : value.length * size * fontScale * 0.65;
  const textStyle = { color, fontSize: size, fontWeight: fontWeight.bold, lineHeight: lineHeight.body };
  // Explicit dimensions let this view participate in native inline text layout.
  // Draw a solid 2dp line close to the text without changing text layout.
  return (
    <View style={{ width, height: lineHeight.body * fontScale + 2 }}>
      {measurement?.key !== measurementKey ? <Text
        accessible={false}
        pointerEvents="none"
        style={[textStyle, { position: 'absolute', width: 1000, opacity: 0 }]}
        onTextLayout={(event) => {
          const measuredWidth = Math.ceil(event.nativeEvent.lines[0]?.width ?? 0);
          if (measuredWidth > 0 && (measurement?.key !== measurementKey || measurement.width !== measuredWidth)) {
            setMeasurement({ key: measurementKey, width: measuredWidth });
          }
        }}
      >{value}</Text> : null}
      <Text style={textStyle} numberOfLines={1} accessibilityRole="link" onPress={() => openLink(href)}>{value}</Text>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 3 * fontScale, height: 2, backgroundColor: color }} />
    </View>
  );
});


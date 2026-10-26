import { Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { MapPin, ExternalLink } from 'lucide-react-native';
import type { WhatsappLocation } from '../../lib/inbox-utils';
import { openLink } from './links';
import { useTheme } from '../../theme/ThemeContext';
import { createStyles } from './styles';

export function LocationMessageCard({ location, outgoing }: { location: WhatsappLocation; outgoing: boolean }) {
  const { colors, isDark } = useTheme();
  const styles = createStyles(colors);
  const coordinates = `${location.latitude},${location.longitude}`;
  const googleMapsUrl = location.url ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`;
  const embedUrl = `https://www.google.com/maps?q=${encodeURIComponent(coordinates)}&z=15&output=embed`;
  const embedHtml = `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body, iframe { height: 100%; margin: 0; padding: 0; width: 100%; }
      body { overflow: hidden; background: #e8eef7; }
      iframe { border: 0; display: block; }
    </style>
  </head>
  <body>
    <iframe src="${embedUrl}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
  </body>
</html>`;
  const locationLabel = location.name ?? 'Shared location';

  return (
    <View style={[
      styles.locationCard,
      outgoing ? styles.locationCardOutgoing : { backgroundColor: colors.surface, borderColor: colors.cardBorder },
    ]}>
      <View style={[styles.locationMap, { backgroundColor: isDark ? colors.surfaceSecondary : '#e8eef7' }]}>
        <WebView
          source={{ html: embedHtml, baseUrl: 'https://www.google.com' }}
          scrollEnabled={false}
          bounces={false}
          javaScriptEnabled
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          style={styles.locationWebView}
        />
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${locationLabel} in Google Maps`}
          onPress={() => openLink(googleMapsUrl)}
          style={styles.locationMapOverlay}
        >
          <View style={styles.locationMapButton}>
            <MapPin color="#fff" size={13} />
            <Text style={styles.locationMapButtonText}>Open in Google Maps</Text>
          </View>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="link"
        onPress={() => openLink(googleMapsUrl)}
        style={({ pressed }) => [
          styles.locationDetails,
          outgoing && styles.locationDetailsOutgoing,
          pressed && styles.locationDetailsPressed,
        ]}
      >
        <MapPin color={outgoing ? '#d1fae5' : colors.primary} size={17} style={styles.locationIcon} />
        <View style={styles.locationCopy}>
          <Text numberOfLines={1} style={[styles.locationTitle, outgoing ? styles.outgoingText : { color: colors.text }]}>{locationLabel}</Text>
          {location.address ? (
            <Text numberOfLines={1} style={[styles.locationAddress, outgoing ? styles.outgoingMuted : { color: colors.textSecondary }]}>{location.address}</Text>
          ) : null}
          <Text style={[styles.locationCoordinates, outgoing ? styles.locationCoordinatesOutgoing : { color: colors.textMuted }]}>
            {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
          </Text>
        </View>
        <ExternalLink color={outgoing ? '#dbeafe' : colors.textMuted} size={15} />
      </Pressable>
    </View>
  );
}


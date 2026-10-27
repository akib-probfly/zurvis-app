import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { Image as ExpoImage } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { latestAccessToken } from '../api/client';
import { useTheme } from '../theme/ThemeContext';

const cache = new Map<string, string>();
const authHeaderCache = new Map<string, Record<string, string> | undefined>();

function isPublicRemoteUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes('fbcdn.net')
      || host.includes('facebook.com')
      || host.includes('fbsbx.com')
      || host.includes('cdninstagram.com')
      || host.includes('googleusercontent.com')
      || host.includes('twimg.com')
    );
  } catch {
    return false;
  }
}

function shouldSendAuthHeader(url: string) {
  if (isPublicRemoteUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('zurvis') || host.includes('omnistra') || host.includes('localhost') || host === '127.0.0.1') {
      return true;
    }
    const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (apiBase) {
      const apiHost = new URL(apiBase).hostname.toLowerCase();
      return host === apiHost || host.endsWith(`.${apiHost}`);
    }
    return /\/api\/v1\/files\//i.test(parsed.pathname);
  } catch {
    return true;
  }
}

function extensionFromContentType(contentType: string | null) {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  if (type === 'image/heic' || type === 'image/heif') return 'heic';
  if (type === 'image/bmp') return 'bmp';
  if (type === 'video/mp4') return 'mp4';
  if (type === 'video/webm') return 'webm';
  if (type === 'video/quicktime') return 'mov';
  if (type === 'audio/mpeg' || type === 'audio/mp3') return 'mp3';
  if (type === 'audio/ogg' || type === 'audio/opus') return 'ogg';
  if (type === 'audio/mp4' || type === 'audio/aac' || type === 'audio/x-m4a') return 'm4a';
  if (type === 'audio/wav' || type === 'audio/x-wav' || type === 'audio/wave') return 'wav';
  if (type === 'application/pdf') return 'pdf';
  if (type === 'text/plain') return 'txt';
  if (type === 'text/csv') return 'csv';
  if (type === 'application/msword') return 'doc';
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (type === 'application/vnd.ms-excel') return 'xls';
  if (type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (type === 'application/vnd.ms-powerpoint') return 'ppt';
  if (type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  return null;
}

function uint8ToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x2000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function isLocalMediaUri(url: string) {
  return /^(file|content|ph|assets-library):/i.test(url);
}

export async function downloadMedia(url: string): Promise<string> {
  const existing = cache.get(url);
  if (existing) return existing;
  // Public CDNs (Facebook lookaside, etc.) often 404 when fetched via FileSystem.
  // Callers should render these with a remote Image uri instead.
  if (isPublicRemoteUrl(url) || isLocalMediaUri(url)) {
    cache.set(url, url);
    return url;
  }
  const token = shouldSendAuthHeader(url)
    ? (latestAccessToken ?? await SecureStore.getItemAsync('access-token'))
    : null;
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) throw new Error('Media cache directory is unavailable');

  // fetch follows cross-host redirects without forwarding Authorization.
  // FileSystem.downloadAsync in release builds often keeps the Bearer header,
  // so S3/R2 signed URLs return 403 and chat images render as blank tiles.
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }
  const extension = extensionFromContentType(response.headers.get('content-type')) ?? guessMediaExtension(url);
  const target = `${cacheDir}media-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const bytes = new Uint8Array(await response.arrayBuffer());
  await FileSystem.writeAsStringAsync(target, uint8ToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  cache.set(url, target);
  return target;
}

function guessMediaExtension(url: string) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const match = pathname.match(/\.([a-z0-9]+)$/);
    if (match) {
      const ext = match[1];
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'mp4', 'mov', 'webm', 'pdf', 'txt', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) {
        return ext === 'jpeg' ? 'jpg' : ext;
      }
    }
    if (pathname.includes('/preview') || pathname.includes('/thumbnail') || pathname.includes('/download')) return 'jpg';
  } catch {
    // fall through
  }
  return 'jpg';
}

/** Prefer the full file download endpoint over a preview variant when saving. */
export function toDownloadableMediaUrl(url: string) {
  if (!url) return url;
  return url.replace(/\/preview\/?(?:\?.*)?$/i, '/download');
}

/**
 * Ensures a local file:// URI with a real image extension for MediaLibrary.
 * Cached display files may use unsupported extensions like `.img`.
 */
export async function prepareLocalImageForLibrary(url: string): Promise<string> {
  const downloadUrl = toDownloadableMediaUrl(url);
  const localUri = await downloadMedia(downloadUrl);
  if (/^https?:\/\//i.test(localUri)) {
    throw new Error('Could not download a local copy of this image.');
  }
  if (/\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(localUri)) {
    return localUri;
  }
  const saveUri = `${FileSystem.cacheDirectory}save-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  await FileSystem.copyAsync({ from: localUri, to: saveUri });
  return saveUri;
}

export function getCachedMediaUri(url: string): string | null {
  return cache.get(url) ?? null;
}

export async function getImageRequestHeaders(url: string): Promise<Record<string, string> | undefined> {
  if (!url || isLocalMediaUri(url) || !shouldSendAuthHeader(url)) return undefined;

  const token = latestAccessToken ?? (await SecureStore.getItemAsync('access-token'));
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export function prefetchMedia(url: string): void {
  if (!url || isLocalMediaUri(url)) return;
  void getImageRequestHeaders(url)
    .then((headers) => ExpoImage.prefetch(url, { cachePolicy: 'memory-disk', headers }))
    .catch(() => {});
}

function fitWithinBounds(width: number, height: number, maxWidth: number, maxHeight: number) {
  if (width <= 0 || height <= 0) {
    return { width: maxWidth, height: Math.round(maxWidth * 0.75) };
  }
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function AuthenticatedImage({
  url,
  style,
  onPress,
  onLongPress,
  resizeMode = 'cover',
  adaptive,
  fitContent,
  maxWidth = 250,
  maxHeight = 340,
  onLoaded,
  onError,
}: {
  url: string;
  style: any;
  onPress?: () => void;
  onLongPress?: () => void;
  resizeMode?: 'cover' | 'contain';
  adaptive?: boolean;
  /** Size the image to its natural aspect ratio within maxWidth/maxHeight (no crop). */
  fitContent?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  onLoaded?: () => void;
  onError?: () => void;
}) {
  const { colors } = useTheme();
  const [imageHeaders, setImageHeaders] = useState<Record<string, string> | undefined>(() => authHeaderCache.get(url));
  const [checkingHeaders, setCheckingHeaders] = useState(() => Boolean(url && shouldSendAuthHeader(url) && !authHeaderCache.has(url)));
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const imageSource = useMemo(() => {
    if (!url) return null;
    if (checkingHeaders) return null;
    if (imageHeaders) return { uri: url, headers: imageHeaders, cacheKey: url };
    return { uri: url, cacheKey: url };
  }, [url, checkingHeaders, imageHeaders]);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setLoaded(false);

    if (!url) {
      setImageHeaders(undefined);
      setCheckingHeaders(false);
      return;
    }

    setImageHeaders(authHeaderCache.get(url));
    setCheckingHeaders(shouldSendAuthHeader(url) && !authHeaderCache.has(url));
    getImageRequestHeaders(url)
      .then((headers) => {
        authHeaderCache.set(url, headers);
        if (active) {
          setImageHeaders(headers);
          setCheckingHeaders(false);
        }
      })
      .catch((error) => {
        if (active) {
          setCheckingHeaders(false);
          setFailed(true);
          onError?.();
          console.error('[media] image auth failed', url, error);
        }
      });

    return () => {
      active = false;
    };
  }, [onError, url]);

  const flatStyle = useMemo(() => StyleSheet.flatten(style) ?? {}, [style]);
  const fittedSize = useMemo(() => {
    if (!fitContent) return null;
    if (naturalSize) return fitWithinBounds(naturalSize.width, naturalSize.height, maxWidth, maxHeight);
    return {
      width: typeof flatStyle.width === 'number' ? flatStyle.width : maxWidth,
      height: typeof flatStyle.height === 'number' ? flatStyle.height : Math.round(maxWidth * 0.75),
    };
  }, [fitContent, naturalSize, maxWidth, maxHeight, flatStyle.width, flatStyle.height]);

  const containerStyle = fitContent
    ? [flatStyle, fittedSize, styles.fitContent]
    : adaptive
      ? style
      : undefined;
  const imageStyle = fitContent
    ? [fittedSize, { borderRadius: flatStyle.borderRadius }]
    : adaptive
      ? [{ width: '100%', height: '100%' }, style]
      : style;

  return (
    <Pressable disabled={!onPress && !onLongPress} onPress={onPress} onLongPress={onLongPress} delayLongPress={350} style={containerStyle}>
      {imageSource && !failed ? (
        <ExpoImage
          source={imageSource}
          contentFit={fitContent ? 'cover' : resizeMode}
          cachePolicy="memory-disk"
          allowDownscaling
          style={imageStyle}
          onLoad={(event) => {
            const source = event?.source;
            if (fitContent && source?.width && source?.height) {
              setNaturalSize({ width: source.width, height: source.height });
            }
            setLoaded(true);
            onLoaded?.();
          }}
          onError={() => {
            setFailed(true);
            onError?.();
          }}
        />
      ) : (
        <View style={[fitContent ? fittedSize : adaptive ? styles.mediaPlaceholder : style, styles.mediaPlaceholder, { backgroundColor: colors.surfaceSecondary }]}>
          {loaded || failed ? null : (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.primary} size="small" />
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mediaPlaceholder: { alignItems: 'center', backgroundColor: '#e8eef7', justifyContent: 'center' },
  loadingWrap: { alignItems: 'center', justifyContent: 'center' },
  fitContent: { overflow: 'hidden' },
});

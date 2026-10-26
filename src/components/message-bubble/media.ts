const IMAGE_FILE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp'];
const AUDIO_FILE_EXTENSIONS = ['.aac', '.amr', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav', '.webm'];

export function isAudioAttachment(attachment: any): boolean {
  const mediaType = (attachment?.mediaType ?? '').toUpperCase();
  if (mediaType === 'VOICE' || mediaType === 'AUDIO') return true;
  const mime = (attachment?.mimeType ?? '').toLowerCase();
  if (mime.startsWith('audio/')) return true;
  const name = (attachment?.originalName ?? '').toLowerCase();
  if (name.startsWith('voice-note-')) return true;
  if (AUDIO_FILE_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return false;
}

export function isImageAttachment(attachment: any): boolean {
  const mediaType = (attachment?.mediaType ?? '').toUpperCase();
  if (mediaType === 'IMAGE' || mediaType === 'STICKER') return true;
  const mime = (attachment?.mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  // WhatsApp images sent as document often arrive as DOCUMENT/FILE with an
  // image filename (or no mime at all) — still render them inline as images.
  const name = (attachment?.originalName ?? '').toLowerCase();
  if (IMAGE_FILE_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return false;
}

export function isVideoAttachment(attachment: any): boolean {
  const mediaType = (attachment?.mediaType ?? '').toUpperCase();
  if (mediaType === 'VIDEO') return true;
  const mime = (attachment?.mimeType ?? '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  const name = (attachment?.originalName ?? '').toLowerCase();
  if (['.mp4', '.mov', '.webm'].some((ext) => name.endsWith(ext))) return true;
  return false;
}

export function previewUrl(attachment: any): string {
  if (typeof attachment.localPreviewUri === 'string' && attachment.localPreviewUri) return attachment.localPreviewUri;
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.zurvis.io/api/v1';
  // Keep the image preview URL stable across optimistic-to-server message
  // reconciliation. The full download endpoint can be slower and may reload
  // the bubble while the preview derivative is already available.
  const value = attachment.previewUrl ?? attachment.thumbnailUrl ?? attachment.downloadUrl;
  return resolveMediaUrl(base, value);
}

export function videoPosterUrl(attachment: any): string {
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.zurvis.io/api/v1';
  if (attachment.previewProcessingStatus === 'FAILED') return '';
  const value = attachment.thumbnailUrl ?? attachment.previewUrl;
  return resolveMediaUrl(base, value);
}

export function documentPreviewUrl(attachment: any): string | null {
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.zurvis.io/api/v1';
  const value = attachment.previewUrl ?? attachment.thumbnailUrl;
  return value ? resolveMediaUrl(base, value) : null;
}

export function audioUrl(attachment: any): string {
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.zurvis.io/api/v1';
  return resolveMediaUrl(base, attachment.downloadUrl ?? attachment.previewUrl ?? attachment.thumbnailUrl);
}

export function videoUrl(attachment: any): string {
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.zurvis.io/api/v1';
  return resolveMediaUrl(base, attachment.downloadUrl ?? attachment.previewUrl ?? attachment.thumbnailUrl);
}

export function resolveMediaUrl(base: string, value?: string): string {
  if (!value) return '';
  try {
    const parsed = new URL(value, `${base}/`);
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)) {
      const apiBase = new URL(base);
      return `${apiBase.origin}${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    return `${base.replace(/\/$/, '')}/${value.replace(/^\//, '')}`;
  }
}


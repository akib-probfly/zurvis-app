import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import { downloadMedia } from '../components/AuthenticatedImage';

export async function copyImageToClipboard(url: string) {
  const resolved = await downloadMedia(url);
  let temporary: File | null = null;
  try {
    let uri = resolved;
    if (/^https?:\/\//i.test(uri)) {
      // The shared downloader returns public CDN URLs without authorization.
      const response = await fetch(uri);
      if (!response.ok) throw new Error('Could not download this image.');
      temporary = new File(Paths.cache, `clipboard-copy-${Date.now()}.img`);
      temporary.create();
      temporary.write(new Uint8Array(await response.arrayBuffer()));
      uri = temporary.uri;
    }
    const base64 = uri.startsWith('data:') ? uri.slice(uri.indexOf(',') + 1)
      : await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    await Clipboard.setImageAsync(base64);
  } finally {
    if (temporary?.exists) temporary.delete();
  }
}

export async function readClipboardImageAttachment() {
  const image = await Clipboard.getImageAsync({ format: 'png' });
  if (!image) return null;
  const prefix = 'data:image/png;base64,';
  if (!image.data.startsWith(prefix)) throw new Error('Clipboard image format is unsupported.');
  if (!FileSystem.cacheDirectory) throw new Error('Image cache is unavailable.');
  const name = `pasted-image-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
  const uri = `${FileSystem.cacheDirectory}${name}`;
  await FileSystem.writeAsStringAsync(uri, image.data.slice(prefix.length), { encoding: FileSystem.EncodingType.Base64 });
  return { uri, name, mimeType: 'image/png', type: 'IMAGE' as const };
}

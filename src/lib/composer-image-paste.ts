// Native paste emits cached file URIs, not clipboard text. Preserve text paste
// handling in TextInput and never interpret a copied URL as an attachment.
export function nativePastedImageCandidates(uris: string[]) {
  const mimeTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic' };
  return [...new Set(uris)].filter((uri) => uri.startsWith('file://')).map((uri) => {
    const name = uri.split('/').pop() || `pasted-image-${Date.now()}.png`;
    const extension = name.split('.').pop()?.toLowerCase() ?? '';
    return { uri, name, mimeType: mimeTypes[extension] ?? 'application/octet-stream', type: 'IMAGE' as const };
  });
}

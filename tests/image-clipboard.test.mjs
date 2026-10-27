import assert from 'node:assert/strict';
import test from 'node:test';
import { application } from './helpers/application.mjs';

function harness({ image = { data: 'data:image/png;base64,aW1hZ2U=' }, copyError = false } = {}) {
  const calls = [];
  const clipboard = { getImageAsync: async (options) => { calls.push(['get', options.format]); return image; },
    setImageAsync: async (data) => { calls.push(['copy', data]); if (copyError) throw new Error('Clipboard unavailable'); } };
  const fs = { cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' },
    readAsStringAsync: async (uri) => { calls.push(['read', uri]); return 'aW1hZ2U='; },
    writeAsStringAsync: async (uri, data, options) => { calls.push(['write', uri, data, options.encoding]); } };
  const api = application({ 'expo-clipboard': clipboard, 'expo-file-system/legacy': fs,
    'expo-file-system': { File: class {}, Paths: {} },
    'src/components/AuthenticatedImage': { downloadMedia: async (url) => { calls.push(['download', url]); return url.startsWith('data:') ? url : 'file:///cache/protected.png'; } },
  })('src/lib/image-clipboard');
  return { calls, ...api };
}

test('copy uses the authenticated media downloader and puts image bytes on the clipboard', async () => {
  const h = harness();
  await h.copyImageToClipboard('https://api.example/files/image/download');
  assert.deepEqual(h.calls, [['download', 'https://api.example/files/image/download'], ['read', 'file:///cache/protected.png'], ['copy', 'aW1hZ2U=']]);
});

test('copy strips the data URI prefix rather than copying a URL or text', async () => {
  const h = harness();
  await h.copyImageToClipboard('data:image/png;base64,aW1hZ2U=');
  assert.deepEqual(h.calls.at(-1), ['copy', 'aW1hZ2U=']);
  assert.ok(!h.calls.some(([action]) => action === 'read'));
});

test('clipboard failures propagate so the UI cannot show a false copy success', async () => {
  await assert.rejects(harness({ copyError: true }).copyImageToClipboard('file:///image.png'), /Clipboard unavailable/);
});

test('paste writes a PNG file suitable for existing previews, validation, and uploads', async () => {
  const h = harness();
  const attachment = await h.readClipboardImageAttachment();
  assert.equal(attachment.type, 'IMAGE');
  assert.equal(attachment.mimeType, 'image/png');
  assert.match(attachment.uri, /^file:\/\/\/cache\/pasted-image-.+\.png$/);
  assert.equal(h.calls.at(-1)[2], 'aW1hZ2U=');
  assert.equal(h.calls.at(-1)[3], 'base64');
});

test('empty or unsupported clipboard content never creates an attachment file', async () => {
  const empty = harness({ image: null });
  assert.equal(await empty.readClipboardImageAttachment(), null);
  assert.equal(empty.calls.length, 1);
  const invalid = harness({ image: { data: 'https://example/image.png' } });
  await assert.rejects(invalid.readClipboardImageAttachment(), /unsupported/);
  assert.equal(invalid.calls.length, 1);
});

test('pasted PNG files respect the existing channel image limits', async () => {
  const { getComposerAttachmentValidationError } = application({ 'expo-file-system/legacy': {} })('src/lib/composer-attachments');
  assert.equal(await getComposerAttachmentValidationError({ mimeType: 'image/png', sizeBytes: 1000, channelType: 'WHATSAPP' }), null);
  assert.match(await getComposerAttachmentValidationError({ mimeType: 'image/png', sizeBytes: 6 * 1024 * 1024, channelType: 'WHATSAPP' }), /smaller/);
  assert.match(await getComposerAttachmentValidationError({ mimeType: 'image/png', sizeBytes: 4 * 1024 * 1024, channelType: 'TIKTOK' }), /smaller/);
});

test('native input paste accepts cached image files and deduplicates them without treating text URLs as images', () => {
  const { nativePastedImageCandidates } = application()('src/lib/composer-image-paste');
  const files = nativePastedImageCandidates(['file:///cache/photo.JPG', 'file:///cache/photo.JPG', 'file:///cache/sticker.gif', 'https://example/image.png']);
  assert.equal(files.length, 2);
  assert.equal(files[0].mimeType, 'image/jpeg');
  assert.equal(files[1].mimeType, 'image/gif');
  assert.equal(files[0].type, 'IMAGE');
});

test('native image-paste wrapper forwards media events while preserving the original text input', () => {
  const child = { type: 'TextInput', props: { value: 'caption' } };
  for (const available of [true, false]) {
    const { ImagePasteInput } = application({ expo: { requireOptionalNativeModule: () => available ? {} : null },
      'expo-paste-input': { TextInputWrapper: 'NativePasteWrapper' } })('src/components/ImagePasteInput');
    const events = [];
    const result = ImagePasteInput({ children: child, onPaste: (event) => events.push(event) });
    if (!available) { assert.equal(result, child); continue; }
    assert.equal(result.type, 'NativePasteWrapper');
    assert.equal(result.props.children, child);
    const payload = { type: 'images', uris: ['file:///cache/image.png'] };
    result.props.onPaste(payload);
    assert.deepEqual(events, [payload]);
  }
});

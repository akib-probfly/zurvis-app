import { requireOptionalNativeModule } from 'expo';
import type { ReactElement } from 'react';
import type { PasteEventPayload } from 'expo-paste-input';

// Older binaries retain the normal input and attachment-menu paste action until
// the native module is included in a new build.
const NativeWrapper = requireOptionalNativeModule('ExpoPasteInput')
  // Load conditionally so existing binaries do not require an unavailable view.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ? (require('expo-paste-input') as typeof import('expo-paste-input')).TextInputWrapper
  : null;

export function ImagePasteInput({ children, onPaste }: { children: ReactElement; onPaste: (payload: PasteEventPayload) => void }) {
  return NativeWrapper ? <NativeWrapper onPaste={onPaste}>{children}</NativeWrapper> : children;
}

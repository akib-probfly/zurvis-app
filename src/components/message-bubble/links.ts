import { Linking } from 'react-native';

export function openLink(href?: string) {
  if (!href) return;
  Linking.openURL(href).catch(() => {});
}


import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Building2, Check, ContactRound, Copy, Mail, MapPin, Phone } from 'lucide-react-native';
import type { WhatsappContactCard } from '../../lib/inbox-utils';
import { useTheme } from '../../theme/ThemeContext';
import { createStyles } from './styles';

function getContactInitials(displayName: string) {
  const initials = displayName
    .split(/\s+/)
    .map((part) => part.trim().charAt(0))
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return initials || '?';
}

function getContactClipboardText(contact: WhatsappContactCard) {
  return [
    contact.displayName,
    contact.organization ? `Organization: ${contact.organization}` : null,
    ...contact.phones.map((phoneItem) => `Phone${phoneItem.label ? ` (${phoneItem.label})` : ''}: ${phoneItem.value}`),
    ...contact.emails.map((email) => `Email${email.label ? ` (${email.label})` : ''}: ${email.value}`),
    contact.address ? `Address: ${contact.address}` : null,
    contact.url ? `Website: ${contact.url}` : null,
  ].filter((value): value is string => Boolean(value)).join('\n');
}

export function ContactMessageCard({ contacts, outgoing }: { contacts: WhatsappContactCard[]; outgoing: boolean }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [copiedContactIndex, setCopiedContactIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const title = contacts.length === 1 ? 'Shared contact' : 'Shared contacts';

  async function copyContact(contact: WhatsappContactCard, index: number) {
    await Clipboard.setStringAsync(getContactClipboardText(contact));
    setCopiedContactIndex(index);
    setTimeout(() => {
      setCopiedContactIndex((current) => (current === index ? null : current));
    }, 1400);
  }

  async function copyAllContacts() {
    await Clipboard.setStringAsync(contacts.map(getContactClipboardText).join('\n\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1400);
  }

  return (
    <View style={[
      styles.contactCard,
      outgoing ? styles.contactCardOutgoing : { backgroundColor: colors.surface, borderColor: colors.cardBorder },
    ]}>
      <View style={[styles.contactHeader, outgoing ? styles.contactHeaderOutgoing : { borderBottomColor: colors.cardBorder }]}>
        <View style={[styles.contactHeaderIcon, outgoing ? styles.contactHeaderIconOutgoing : { backgroundColor: colors.surfaceSecondary }]}>
          <ContactRound color={outgoing ? '#d1fae5' : colors.primary} size={15} />
        </View>
        <Text style={[styles.contactHeaderTitle, outgoing ? styles.outgoingText : { color: colors.text }]}>{title}</Text>
        <Pressable
          accessibilityLabel="Copy all contacts"
          onPress={() => void copyAllContacts()}
          hitSlop={8}
          style={[
            styles.contactIconButton,
            outgoing ? styles.contactIconButtonOutgoing : { backgroundColor: colors.surfaceSecondary },
          ]}
        >
          {copiedAll ? <Check color="#10b981" size={15} /> : <Copy color={outgoing ? '#dbeafe' : colors.textMuted} size={15} />}
        </Pressable>
        <View style={[styles.contactCount, outgoing ? styles.contactCountOutgoing : { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.contactCountText, outgoing ? styles.outgoingMuted : { color: colors.textSecondary }]}>{contacts.length}</Text>
        </View>
      </View>
      {contacts.map((contact, index) => (
        <View
          key={`${contact.displayName}-${index}`}
          style={[
            styles.contactRow,
            index > 0 && styles.contactRowDivider,
            index > 0 && (outgoing ? styles.contactRowDividerOutgoing : { borderTopColor: colors.cardBorder }),
          ]}
        >
          <View style={[styles.contactAvatar, outgoing ? styles.contactAvatarOutgoing : { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.contactAvatarText, { color: outgoing ? '#d1fae5' : colors.primary }]}>{getContactInitials(contact.displayName)}</Text>
          </View>
          <View style={styles.contactBody}>
            <Text numberOfLines={1} style={[styles.contactName, outgoing ? styles.outgoingText : { color: colors.text }]}>{contact.displayName}</Text>
            {contact.organization ? (
              <View style={styles.contactInfoRow}>
                <Building2 color={outgoing ? '#dbeafe' : colors.textSecondary} size={12} />
                <Text numberOfLines={1} style={[styles.contactInfoText, outgoing ? styles.outgoingMuted : { color: colors.textSecondary }]}>{contact.organization}</Text>
              </View>
            ) : null}
            {contact.phones.map((phoneItem, phoneIndex) => (
              <View key={`phone-${phoneItem.value}-${phoneIndex}`} style={styles.contactInfoRow}>
                <Phone color={outgoing ? '#dbeafe' : colors.textSecondary} size={12} />
                <Text numberOfLines={1} style={[styles.contactInfoText, outgoing ? styles.outgoingMuted : { color: colors.textSecondary }]}>
                  {phoneItem.value}{phoneItem.label ? ` - ${phoneItem.label}` : ''}
                </Text>
              </View>
            ))}
            {contact.emails.map((email, emailIndex) => (
              <View key={`email-${email.value}-${emailIndex}`} style={styles.contactInfoRow}>
                <Mail color={outgoing ? '#dbeafe' : colors.textSecondary} size={12} />
                <Text numberOfLines={1} style={[styles.contactInfoText, outgoing ? styles.outgoingMuted : { color: colors.textSecondary }]}>
                  {email.value}{email.label ? ` - ${email.label}` : ''}
                </Text>
              </View>
            ))}
            {contact.address ? (
              <View style={styles.contactInfoRow}>
                <MapPin color={outgoing ? '#dbeafe' : colors.textSecondary} size={12} />
                <Text numberOfLines={2} style={[styles.contactInfoText, outgoing ? styles.outgoingMuted : { color: colors.textSecondary }]}>{contact.address}</Text>
              </View>
            ) : null}
          </View>
          <Pressable
            accessibilityLabel={`Copy ${contact.displayName}`}
            onPress={() => void copyContact(contact, index)}
            hitSlop={8}
            style={[
              styles.contactCopyButton,
              outgoing ? styles.contactCopyButtonOutgoing : { backgroundColor: colors.surfaceSecondary },
            ]}
          >
            {copiedContactIndex === index ? <Check color="#10b981" size={15} /> : <Copy color={outgoing ? '#dbeafe' : colors.textMuted} size={15} />}
          </Pressable>
        </View>
      ))}
    </View>
  );
}


import type {
  WhatsappAuthCodeDeliveryMethod,
  WhatsappTemplate,
  WhatsappTemplateButton,
  WhatsappTemplateButtonType,
  WhatsappTemplateFormValues,
  WhatsappTemplateHeaderType,
  WhatsappTemplateVariable,
  WhatsappTemplateVariableSection,
} from '../api/whatsappTemplates';

const VARIABLE_TOKEN = /\{\{(\d+)\}\}/g;

export function makeId(prefix = 'tmp') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeEmptyButton(type: WhatsappTemplateButtonType = 'QUICK_REPLY'): WhatsappTemplateButton {
  return { id: makeId('btn'), type, label: '' };
}

function parseSectionVariables(value: string, section: WhatsappTemplateVariableSection) {
  return Array.from(value.matchAll(VARIABLE_TOKEN)).map((match) => ({
    index: Number(match[1]),
    section,
  }));
}

export function extractTemplateVariableDefinitions(input: {
  headerType: WhatsappTemplateHeaderType;
  headerContent: string;
  body: string;
  buttons: WhatsappTemplateButton[];
  existingVariables?: WhatsappTemplateVariable[];
}) {
  const ordered = [
    ...(input.headerType === 'TEXT' ? parseSectionVariables(input.headerContent, 'HEADER') : []),
    ...parseSectionVariables(input.body, 'BODY'),
    ...input.buttons.flatMap((button) =>
      button.type === 'URL' && button.url ? parseSectionVariables(button.url, 'BUTTON') : [],
    ),
  ];

  const seen = new Map<number, WhatsappTemplateVariableSection>();
  ordered.forEach((item) => {
    if (!seen.has(item.index)) seen.set(item.index, item.section);
  });

  const existing = new Map((input.existingVariables ?? []).map((variable) => [variable.index, variable]));

  return Array.from(seen.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([index, section]) => {
      const current = existing.get(index);
      return {
        index,
        section,
        label: current?.label ?? '',
        sampleValue: current?.sampleValue ?? '',
      } satisfies WhatsappTemplateVariable;
    });
}

export function renumberTemplateVariables(input: {
  headerType: WhatsappTemplateHeaderType;
  headerContent: string;
  body: string;
  buttons: WhatsappTemplateButton[];
  variables?: WhatsappTemplateVariable[];
}) {
  const placements = [
    ...(input.headerType === 'TEXT' ? parseSectionVariables(input.headerContent, 'HEADER') : []),
    ...parseSectionVariables(input.body, 'BODY'),
    ...input.buttons.flatMap((button) =>
      button.type === 'URL' && button.url ? parseSectionVariables(button.url, 'BUTTON') : [],
    ),
  ];

  const uniqueSorted = Array.from(new Set(placements.map((item) => item.index))).sort((a, b) => a - b);
  const mapping = new Map(uniqueSorted.map((value, index) => [value, index + 1]));

  const replaceByMapping = (value: string) =>
    value.replace(VARIABLE_TOKEN, (_, token) => {
      const mapped = mapping.get(Number(token));
      return mapped ? `{{${mapped}}}` : '';
    });

  const nextHeaderContent = input.headerType === 'TEXT' ? replaceByMapping(input.headerContent) : input.headerContent;
  const nextBody = replaceByMapping(input.body);
  const nextButtons = input.buttons.map((button) =>
    button.type === 'URL' && button.url ? { ...button, url: replaceByMapping(button.url) } : button,
  );

  const nextVariables = extractTemplateVariableDefinitions({
    headerType: input.headerType,
    headerContent: nextHeaderContent,
    body: nextBody,
    buttons: nextButtons,
    existingVariables: (input.variables ?? []).map((variable) => ({
      ...variable,
      index: mapping.get(variable.index) ?? variable.index,
    })),
  });

  return {
    headerContent: nextHeaderContent,
    body: nextBody,
    buttons: nextButtons,
    variables: nextVariables,
  };
}

export function makeDraftTemplate(seed?: Partial<WhatsappTemplateFormValues>): WhatsappTemplateFormValues {
  const body = seed?.body ?? 'Hello {{1}},';
  const headerType = seed?.header?.type ?? 'NONE';
  const buttons = seed?.buttons ?? [];
  const numbered = renumberTemplateVariables({
    headerType,
    headerContent: headerType === 'TEXT' ? seed?.header?.content ?? '' : '',
    body,
    buttons,
    variables: seed?.variables,
  });

  return {
    name: seed?.name ?? '',
    category: seed?.category ?? 'UTILITY',
    marketingTemplateType: seed?.marketingTemplateType ?? 'DEFAULT',
    authCodeDeliveryMethod: seed?.authCodeDeliveryMethod ?? 'COPY_CODE',
    authIncludeSecurityRecommendation: seed?.authIncludeSecurityRecommendation ?? true,
    authIncludeExpirationNotice: seed?.authIncludeExpirationNotice ?? false,
    authCodeExpirationMinutes: seed?.authCodeExpirationMinutes,
    language: seed?.language ?? 'en_US',
    header: {
      enabled: seed?.header?.enabled ?? false,
      type: headerType,
      content: headerType === 'TEXT' ? numbered.headerContent : '',
    },
    body: numbered.body,
    footer: seed?.footer ?? '',
    buttons: numbered.buttons,
    variables: numbered.variables,
    version: seed?.version ?? 1,
  };
}

export function mapTemplateToForm(template: WhatsappTemplate): WhatsappTemplateFormValues {
  return makeDraftTemplate({
    name: template.name,
    category: template.category,
    marketingTemplateType: template.marketingTemplateType ?? 'DEFAULT',
    authCodeDeliveryMethod: template.authCodeDeliveryMethod ?? 'COPY_CODE',
    authIncludeSecurityRecommendation: template.authIncludeSecurityRecommendation ?? true,
    authIncludeExpirationNotice: template.authIncludeExpirationNotice ?? false,
    authCodeExpirationMinutes: template.authCodeExpirationMinutes,
    language: template.language,
    header: template.header,
    body: template.body,
    footer: template.footer,
    buttons: template.buttons ?? [],
    variables: template.variables ?? [],
    version: template.version,
  });
}

export function buildAuthenticationTemplateContent(input: {
  codeDeliveryMethod: WhatsappAuthCodeDeliveryMethod;
  includeSecurityRecommendation: boolean;
  includeExpirationNotice: boolean;
  expirationMinutes?: number;
}) {
  const bodyParts = ['{{1}} is your verification code.'];
  if (input.includeSecurityRecommendation) bodyParts.push('For your security, do not share this code.');
  if (input.includeExpirationNotice && input.expirationMinutes) {
    bodyParts.push(`This code expires in ${input.expirationMinutes} minutes.`);
  }

  return {
    body: bodyParts.join(' '),
    footer: '',
    buttons: [
      {
        id: makeId('otp'),
        type: 'OTP' as const,
        label: input.codeDeliveryMethod === 'ONE_TAP' ? 'Autofill code' : 'Copy code',
      },
    ],
  };
}

export function renderTemplateTextWithSamples(value: string, variables: WhatsappTemplateVariable[]) {
  const variableMap = new Map(
    variables.map((variable) => [variable.index, variable.sampleValue || `{{${variable.index}}}`]),
  );
  return value.replace(VARIABLE_TOKEN, (_, token) => variableMap.get(Number(token)) ?? `{{${token}}}`);
}

function normalizeButtonsJson(buttonsJson: unknown): WhatsappTemplateButton[] {
  if (!Array.isArray(buttonsJson)) return [];

  return buttonsJson.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const rawButtons = Array.isArray(record.buttons) ? record.buttons : [record];

    return rawButtons.flatMap((button, buttonIndex) => {
      if (!button || typeof button !== 'object') return [];
      const source = button as Record<string, unknown>;
      return [{
        id: `remote-${index}-${buttonIndex}`,
        type:
          source.type === 'COPY_OFFER_CODE'
            ? 'COPY_CODE'
            : source.type === 'PHONE_NUMBER'
              || source.type === 'URL'
              || source.type === 'OTP'
              || source.type === 'CALL_TO_WHATSAPP'
              || source.type === 'COPY_CODE'
              ? (source.type as WhatsappTemplateButtonType)
              : 'QUICK_REPLY',
        label: typeof source.text === 'string' ? source.text : 'Button',
        url: typeof source.url === 'string' ? source.url : undefined,
        phoneNumber: typeof source.phone_number === 'string' ? source.phone_number : undefined,
        offerCode:
          typeof source.offer_code === 'string'
            ? source.offer_code
            : typeof source.example === 'string'
              ? source.example
              : undefined,
      } satisfies WhatsappTemplateButton];
    });
  });
}

/** Maps raw API template rows (bodyText/sampleVariablesJson) into the UI shape used by web. */
export function mapRemoteTemplate(template: {
  id: string;
  metaTemplateId?: string | null;
  name: string;
  category: string;
  language: string;
  status: string;
  headerType?: string | null;
  headerText?: string | null;
  bodyText?: string | null;
  body?: string | null;
  footerText?: string | null;
  footer?: string | null;
  buttonsJson?: unknown;
  buttons?: WhatsappTemplateButton[] | null;
  sampleVariablesJson?: unknown;
  variables?: WhatsappTemplateVariable[] | null;
  header?: WhatsappTemplate['header'] | null;
  rejectionReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
}): WhatsappTemplate {
  const bodyText = template.bodyText ?? template.body ?? '';
  const footerText = template.footerText ?? template.footer ?? '';
  const headerTypeRaw = template.header?.type
    ?? (template.headerType && template.headerType !== 'LOCATION' ? template.headerType.toUpperCase() : 'NONE');
  const headerType = (
    ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(headerTypeRaw))
      ? headerTypeRaw
      : 'NONE'
  ) as WhatsappTemplateHeaderType;
  const headerContent = template.header?.content ?? template.headerText ?? '';
  const buttons = Array.isArray(template.buttons) && template.buttons.length > 0
    ? template.buttons
    : normalizeButtonsJson(template.buttonsJson);

  const sampleVariables = Array.isArray(template.sampleVariablesJson)
    ? (template.sampleVariablesJson as Array<Record<string, unknown>>)
    : Array.isArray(template.variables)
      ? template.variables
      : [];

  const variables = extractTemplateVariableDefinitions({
    headerType,
    headerContent,
    body: bodyText,
    buttons,
    existingVariables: sampleVariables.map((item, index) => {
      const record = item as Record<string, unknown>;
      const rawIndex = record.index;
      return {
        index:
          typeof rawIndex === 'number'
            ? rawIndex
            : typeof rawIndex === 'string'
              ? Number(rawIndex)
              : index + 1,
        label: typeof record.label === 'string' ? record.label : '',
        sampleValue: typeof record.sampleValue === 'string' ? record.sampleValue : '',
        section:
          record.section === 'HEADER' || record.section === 'BUTTON' ? record.section : 'BODY',
      } satisfies WhatsappTemplateVariable;
    }),
  });

  return {
    id: template.id,
    name: template.name,
    category: (['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(template.category)
      ? template.category
      : 'UTILITY') as WhatsappTemplate['category'],
    language: template.language,
    status: (typeof template.status === 'string' && template.status.trim()
      ? template.status
      : 'PENDING') as WhatsappTemplate['status'],
    marketingTemplateType: 'DEFAULT',
    authCodeDeliveryMethod: 'COPY_CODE',
    authIncludeSecurityRecommendation: /do not share this code/i.test(bodyText),
    authIncludeExpirationNotice:
      /expires in|valid for|expiration|expire/i.test(bodyText)
      || /expires in|valid for|expiration|expire/i.test(footerText),
    authCodeExpirationMinutes:
      typeof bodyText.match(/(\d+)\s*minutes?/i)?.[1] === 'string'
        ? Number(bodyText.match(/(\d+)\s*minutes?/i)?.[1])
        : undefined,
    header: {
      enabled: headerType !== 'NONE',
      type: headerType,
      content: headerContent,
    },
    body: bodyText,
    footer: footerText,
    buttons,
    variables,
    version: 1,
    metaId: template.metaTemplateId ?? null,
    rejectionReason: template.rejectionReason?.trim() && template.rejectionReason.trim().toLowerCase() !== 'none'
      ? template.rejectionReason.trim()
      : null,
    createdAt: template.createdAt ?? new Date().toISOString(),
    updatedAt: template.updatedAt ?? new Date().toISOString(),
    source: 'remote',
  };
}

export function insertBodyVariable(body: string, variables: WhatsappTemplateVariable[]) {
  const nextIndex = (variables.reduce((max, variable) => Math.max(max, variable.index), 0) || 0) + 1;
  const nextBody = `${body}${body && !body.endsWith(' ') && !body.endsWith('\n') ? ' ' : ''}{{${nextIndex}}}`;
  return nextBody;
}

export function validateTemplateForm(form: WhatsappTemplateFormValues): string | null {
  if (!form.name.trim()) return 'Template name is required.';
  if (!/^[a-z0-9_]+$/.test(form.name.trim())) return 'Name must be lowercase letters, numbers, and underscores.';
  if (!form.language.trim()) return 'Language is required.';
  if (!form.body.trim()) return 'Body text is required.';
  if (form.body.length > 1024) return 'Body must be 1024 characters or fewer.';
  if (form.footer.length > 60) return 'Footer must be 60 characters or fewer.';
  if (form.header.enabled && form.header.type === 'TEXT' && !form.header.content.trim()) {
    return 'Header text is required when text header is enabled.';
  }
  if (form.buttons.length > 10) return 'A template can have at most 10 buttons.';
  for (const button of form.buttons) {
    if (!button.label.trim() && button.type !== 'OTP') return 'Each button needs a label.';
    if (button.type === 'URL' && button.url && !/^https?:\/\//i.test(button.url)) {
      return 'URL buttons must use http:// or https://.';
    }
    if (button.type === 'PHONE_NUMBER' && button.phoneNumber && !/^\+?[1-9]\d{6,14}$/.test(button.phoneNumber)) {
      return 'Phone buttons need a valid international number.';
    }
  }
  const missingSample = form.variables.find((variable) => !variable.sampleValue.trim());
  if (missingSample) return `Add a sample value for variable {{${missingSample.index}}}.`;
  return null;
}

export function formatTemplateUpdatedAt(value: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

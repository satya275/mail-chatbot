'use strict';

const DEFAULT_EXPECTED_FIELDS = [
  'Application Type',
  'Service Category',
  'Entity Name / Business Unit',
  'Case Details',
  'From',
  'From Mail',
  'To Mail',
  'Timestamp'
];

const APPLICATION_TYPES = ['Sundry Billing', 'Trade Billing', 'Receipts Application'];
const SERVICE_CATEGORIES_BY_TYPE = {
  'Sundry Billing': [
    'SB_REQINV',
    'SB_REQDOC',
    'SB_CHKINV',
    'SB_REQAMD',
    'SB_FIOQUE'
  ],
  'Trade Billing': [
    'SB_REQINV',
    'SB_REQDOC',
    'SB_CHKINV',
    'SB_REQAMD',
    'SB_FIOQUE'
  ],
  'Receipts Application': ['RA_REQRPT', 'RA_REQREC', 'RA_REQBAN', 'RA_REQSOA']
};
const SERVICE_CATEGORY_DESCRIPTIONS = {
  SB_REQINV: 'Request for Invoices / Credit Notes',
  SB_REQDOC: 'Request for Supporting Documents',
  SB_CHKINV: 'Check on Invoice Status',
  SB_REQAMD: 'Request for Invoice Amendment',
  SB_FIOQUE: 'Fiori Related Issues',
  RA_REQRPT: 'Request on Reports',
  RA_REQREC: 'Request on Receipt Status',
  RA_REQBAN: 'Request on Bank Account Details',
  RA_REQSOA: 'Request on Statement of Accounts'
};
const SERVICE_CATEGORIES = Object.values(SERVICE_CATEGORIES_BY_TYPE).flat();
const JUNK_FLAGS = new Set(['junk', 'isJunk', 'phishing', 'isPhishing']);

function normalizeExpectedFields(input) {
  if (Array.isArray(input) && input.length > 0) {
    return input.map((field) => `${field}`.trim()).filter(Boolean);
  }

  if (typeof input === 'string' && input.trim()) {
    const trimmed = input.trim();
    const parsed = parseJson(trimmed);

    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((field) => `${field}`.trim()).filter(Boolean);
    }

    const csvFields = trimmed
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);

    if (csvFields.length > 0) {
      return csvFields;
    }
  }

  return [...DEFAULT_EXPECTED_FIELDS];
}

function parseJson(value) {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function normalizeMailPayload(input) {
  if (!input) return {};
  if (typeof input === 'object') return input;
  if (typeof input === 'string') {
    const parsed = parseJson(input);
    if (parsed && typeof parsed === 'object') return parsed;
    return { body: input };
  }
  return { body: `${input}` };
}

function pickFirst(obj, keys, fallback = '') {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && `${value}`.trim() !== '') {
      return value;
    }
  }
  return fallback;
}

function formatMailForQuery(mailPayload) {
  const subject = pickFirst(mailPayload, ['subject', 'mailSubject', 'Subject']);
  const body = pickFirst(mailPayload, ['body', 'mailBody', 'content', 'Body']);
  const fromName = pickFirst(mailPayload, ['from', 'fromName', 'senderName', 'From']);
  const fromMail = pickFirst(mailPayload, ['fromMail', 'fromEmail', 'senderEmail', 'From Mail']);
  const toMail = pickFirst(mailPayload, ['toMail', 'toEmail', 'recipientEmail', 'To Mail']);
  const timestamp = pickFirst(mailPayload, ['timestamp', 'sentAt', 'date', 'Timestamp']);

  const lines = [
    `Subject: ${subject || 'N/A'}`,
    `From: ${fromName || 'N/A'}`,
    `From Mail: ${fromMail || 'N/A'}`,
    `To Mail: ${toMail || 'N/A'}`,
    `Timestamp: ${timestamp || 'N/A'}`,
    'Body:',
    body || 'N/A'
  ];

  return lines.join('\n');
}

function buildExtractionPrompt({ projectId, contextType, expectedFields }) {
  const normalizedFields = normalizeExpectedFields(expectedFields);
  const template = buildExpectedFieldTemplate(normalizedFields);
  const projectLine = projectId ? `Project ID: ${projectId}` : 'Project ID: N/A';
  const contextLine = contextType ? `Context Type: ${contextType}` : 'Context Type: N/A';
  const applicationTypeList = APPLICATION_TYPES.map((value) => `- ${value}`).join('\n');
  const serviceCategoryList = SERVICE_CATEGORIES.map((value) => {
    const description = SERVICE_CATEGORY_DESCRIPTIONS[value];
    return description ? `- ${value} (${description})` : `- ${value}`;
  }).join('\n');

  return `You are an AI mail-processing assistant. Extract the requested fields from the mail content provided by the user.
${projectLine}
${contextLine}

Rules:
- Return ONLY a JSON object with the exact keys listed below.
- Use the mail subject/body, sender, recipients, and timestamp to infer values.
- If a value is missing or not stated, return an empty string for that key.
- Do not invent details or normalize beyond what is in the mail.
- "Application Type" must be exactly one of the allowed values below. If it is not one of them, return "NA".
- "Service Category" must be exactly one of the allowed values below. If it is not one of them, return "NA".
- For "Sundry Billing" and "Trade Billing", use SB_* service categories. For "Receipts Application", use RA_* service categories.
- If the email appears to be junk, spam, or phishing, return ONLY {"junk": true} and no other keys.

Allowed Application Type values:
${applicationTypeList}

Allowed Service Category values:
${serviceCategoryList}

Expected fields:
${normalizedFields.map((field) => `- ${field}`).join('\n')}

Output JSON template:
${JSON.stringify(template, null, 2)}
`;
}

function buildExpectedFieldTemplate(expectedFields) {
  return expectedFields.reduce((acc, field) => {
    acc[field] = '';
    return acc;
  }, {});
}

function normalizeCompletion(ragResult) {
  if (typeof ragResult?.completion === 'string') {
    const parsed = parseJson(ragResult.completion);
    if (parsed) {
      return parsed;
    }
    return { role: 'assistant', content: ragResult.completion };
  }

  if (ragResult?.completion) {
    return ragResult.completion;
  }

  return {
    role: 'assistant',
    content: ragResult?.content || 'Unable to extract mail details at this time.'
  };
}

function normalizeAdditionalContents(ragResult) {
  if (typeof ragResult?.additionalContents === 'string') {
    const parsed = parseJson(ragResult.additionalContents);
    if (parsed) return parsed;
    return [];
  }
  return ragResult?.additionalContents || [];
}

function ensureJsonContent(content, expectedFields) {
  const normalizedFields = normalizeExpectedFields(expectedFields);
  const template = buildExpectedFieldTemplate(normalizedFields);
  const extracted = extractJsonObject(content);

  if (!extracted) {
    return JSON.stringify(template);
  }

  if (isJunkExtraction(extracted)) {
    return JSON.stringify({});
  }

  const sanitized = sanitizeExtraction(extracted);

  return JSON.stringify({ ...template, ...sanitized });
}

function extractJsonObject(content) {
  if (!content) return null;
  if (typeof content === 'object') return content;
  if (typeof content !== 'string') return null;

  const directParsed = parseJson(content);
  if (directParsed && typeof directParsed === 'object') return directParsed;

  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;

  const extracted = parseJson(match[0]);
  if (extracted && typeof extracted === 'object') return extracted;

  return null;
}

function isJunkExtraction(extracted) {
  if (!extracted || typeof extracted !== 'object') return false;
  return Object.entries(extracted).some(([key, value]) => {
    if (!JUNK_FLAGS.has(`${key}`.trim())) return false;
    if (typeof value === 'boolean') return value;
    const normalized = `${value}`.trim().toLowerCase();
    return normalized === 'true' || normalized === 'yes';
  });
}

function sanitizeExtraction(extracted) {
  const sanitized = { ...extracted };
  const applicationType =
    normalizeAllowedValue(extracted?.['Application Type'], APPLICATION_TYPES) || 'NA';
  const legacyServiceCategory = extracted?.['Service Subcategory'];
  const rawServiceCategory = extracted?.['Service Category'] || legacyServiceCategory;
  const serviceCategory = normalizeAllowedValue(rawServiceCategory, SERVICE_CATEGORIES) || 'NA';
  const validatedServiceCategory = validateServiceCategoryByType(applicationType, serviceCategory);

  if ('Application Type' in sanitized) {
    sanitized['Application Type'] = applicationType;
  }

  if ('Service Category' in sanitized || legacyServiceCategory !== undefined) {
    sanitized['Service Category'] = validatedServiceCategory;
    delete sanitized['Service Subcategory'];
  }

  return sanitized;
}

function normalizeAllowedValue(value, allowedValues) {
  if (!value) return '';
  const normalized = `${value}`.trim().toLowerCase();
  if (!normalized) return '';
  const match = allowedValues.find((allowed) => allowed.toLowerCase() === normalized);
  return match || '';
}

function validateServiceCategoryByType(applicationType, serviceCategory) {
  if (!serviceCategory) return 'NA';
  if (!applicationType || applicationType === 'NA') return serviceCategory;
  const allowedForType = SERVICE_CATEGORIES_BY_TYPE[applicationType] || [];
  return allowedForType.includes(serviceCategory) ? serviceCategory : 'NA';
}

module.exports = {
  normalizeExpectedFields,
  normalizeMailPayload,
  formatMailForQuery,
  buildExtractionPrompt,
  normalizeCompletion,
  normalizeAdditionalContents,
  ensureJsonContent
};

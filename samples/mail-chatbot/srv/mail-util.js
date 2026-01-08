'use strict';

const DEFAULT_EXPECTED_FIELDS = [
  'Service Category',
  'Service Subcategory',
  'Entity Name / Business Unit',
  'Case Details',
  'From',
  'From Mail',
  'To Mail',
  'Timestamp'
];

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

  return `You are an AI mail-processing assistant. Extract the requested fields from the mail content provided by the user.
${projectLine}
${contextLine}

Rules:
- Return ONLY a JSON object with the exact keys listed below.
- Use the mail subject/body, sender, recipients, and timestamp to infer values.
- If a value is missing or not stated, return an empty string for that key.
- Do not invent details or normalize beyond what is in the mail.

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

  return JSON.stringify({ ...template, ...extracted });
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

module.exports = {
  normalizeExpectedFields,
  normalizeMailPayload,
  formatMailForQuery,
  buildExtractionPrompt,
  normalizeCompletion,
  normalizeAdditionalContents,
  ensureJsonContent
};

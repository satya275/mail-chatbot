'use strict';

const cds = require('@sap/cds');
const mail_util = require('./mail-util');

const PROJECT_NAME = 'MAIL_USECASE';

// ---- CONFIG ----
const tableName = 'SAP_TISCE_DEMO_DOCUMENTCHUNK';
const embeddingColumn = 'EMBEDDING';
const contentColumn = 'TEXT_CHUNK';

// ---------------- SYSTEM PROMPT (classifier) ----------------
const systemPrompt = `Classify the user question into one of the following categories: purchase-order-status, invoice-status, purchase-requisition-status, status-clarification, or generic-query.

Return a JSON object following the examples below.

If the user requests the status of a purchase order, return:
{
  "category": "purchase-order-status",
  "purchaseOrder": "<purchase order number from the user, digits only>"
}

If the user requests the status of an invoice (including payment or invoice progress), return:
{
  "category": "invoice-status",
  "purchaseOrder": "<purchase order number tied to the invoice, digits only>"
}

If the user requests the status of a purchase requisition, return:
{
  "category": "purchase-requisition-status",
  "purchaseRequisition": "<purchase requisition number from the user, digits only>"
}

For all other questions (including queries answered from the embedding/policy documents), return:
{
  "category": "generic-query"
}

If the user asks for a status update but does not clearly specify whether it concerns a purchase order, invoice, or purchase requisition, return:
{
  "category": "status-clarification",
  "referenceNumber": "<number provided by the user if any, digits only>"
}

Rules:
1. Always provide the number if it is mentioned; otherwise return an empty string for that field.
2. Prefer the number explicitly associated with the document type mentioned by the user.
3. If the request is ambiguous between purchase order and invoice, choose invoice-status when the user mentions invoice terms.
4. If the user asks for a status but neither the document type nor the number is clear, return status-clarification with the provided number if any.
5. Do not invent numbers.
`;

// ---------------- CATEGORY PROMPTS ----------------
const genericRequestPrompt =
  'You are a mail procurement assistant. Answer the user question using only the provided context from mail policy or reference documents (delimited by triple backticks). Keep the tone formal, concise, and clearly formatted.';

const purchaseOrderStatusPrompt = `You are a mail procurement assistant. Use the provided purchase order status context, delimited by triple backticks, to summarize the status for the user.
- Highlight the purchase order number, each item, the status, and deletion indicators.
- If related purchase requisitions are present, summarize them as well.
- If the service response is empty or unsuccessful, state that you cannot find status for the provided purchase order.
- Keep the answer neatly formatted with short headings and bullet points.`;

const purchaseRequisitionStatusPrompt = `You are a mail procurement assistant. Use the provided purchase requisition status context, delimited by triple backticks, to summarize the status for the user.
- Show the purchase requisition number, release status, deletion indicators, and any linked purchase orders.
- If the service response is empty or unsuccessful, state that you cannot find status for the provided purchase requisition.
- Keep the answer neatly formatted with short headings and bullet points.`;

const invoiceStatusPrompt = `You are a mail procurement assistant. Use the provided invoice status context, delimited by triple backticks, to summarize the invoice details for the given purchase order.
- Include the invoice number, value, key dates, and invoice status.
- If the service response is empty or unsuccessful, state that you cannot find status for the provided invoice or purchase order.
- Keep the answer neatly formatted with short headings and bullet points.`;

const basePrompts = {
  'purchase-order-status': purchaseOrderStatusPrompt,
  'invoice-status': invoiceStatusPrompt,
  'purchase-requisition-status': purchaseRequisitionStatusPrompt,
  'status-clarification': genericRequestPrompt,
  'generic-query': genericRequestPrompt
};

// ---------------- Formatting helpers ----------------
function pickFirst(obj, keys, fallback = '') {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return fallback;
}

function normBoolText(v) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', 'x', 'yes', 'y'].includes(s)) return 'Yes';
    if (['false', 'no', 'n'].includes(s)) return 'No';
  }
  if (v === '' || v == null) return 'No';
  return String(v);
}

function joinLine(label, value) {
  const val = value == null ? '' : String(value).trim();
  return `${label}: ${val || 'N/A'}`;
}

function formatPoStatusNice(purchaseOrder, resp) {
  const poItems = Array.isArray(resp?.poItems) ? resp.poItems : [];
  const prItems = Array.isArray(resp?.prItems) ? resp.prItems : [];

  const lines = [];
  lines.push(`Purchase Order Status (PO: ${purchaseOrder})`);
  lines.push('');

  lines.push('Purchase Order Items:');
  if (!poItems.length) {
    lines.push('No PO items returned.');
  } else {
    poItems.forEach((it, idx) => {
      const poNo = pickFirst(it, ['PO Number', 'ebeln'], purchaseOrder);
      const poItem = pickFirst(it, ['PO Item', 'ebelp']);
      const status = pickFirst(it, ['PO Status', 'poStatus']);
      const delInd = pickFirst(it, ['Del. Indicator', 'loekz'], '');
      const deleted = normBoolText(pickFirst(it, ['PO Deleted', 'poDeleted'], ''));

      lines.push(`${idx + 1}.`);
      lines.push(joinLine('PO Number', poNo));
      lines.push(joinLine('PO Item', poItem));
      lines.push(joinLine('Status', status));
      lines.push(joinLine('Deleted', deleted));
      if (delInd) lines.push(joinLine('Deletion Indicator', delInd));

      const prNo = pickFirst(it, ['PR Number', 'banfn'], '');
      const prItem = pickFirst(it, ['PR Item', 'bnfpo'], '');
      if (prNo) lines.push(joinLine('Linked PR', prItem ? `${prNo} / ${prItem}` : prNo));

      lines.push('');
    });
  }

  lines.push('Related Purchase Requisitions:');
  if (!prItems.length) {
    lines.push('No related PR items returned.');
  } else {
    prItems.forEach((it, idx) => {
      const prNo = pickFirst(it, ['PR Number', 'banfn']);
      const prItem = pickFirst(it, ['PR Item', 'bnfpo']);
      const status = pickFirst(it, ['PR Status', 'prStatus']);
      const releaseStatus = pickFirst(it, ['Release Status'], '');
      const releaseInd = pickFirst(it, ['Release ind.', 'frgkz'], '');
      const deleted = normBoolText(pickFirst(it, ['PR Deleted', 'prDeleted'], ''));
      const rejected = normBoolText(pickFirst(it, ['PR Rejected', 'prRejected'], ''));
      const prReleaseDate = pickFirst(it, ['PR Release Date', 'prReleaseDate'], '');
      const delInd = pickFirst(it, ['Del. Indicator', 'loekz'], '');

      lines.push(`${idx + 1}.`);
      lines.push(joinLine('PR Number', prNo));
      lines.push(joinLine('PR Item', prItem));
      lines.push(joinLine('Status', status));
      if (releaseStatus) lines.push(joinLine('Release Status', releaseStatus));
      if (releaseInd) lines.push(joinLine('Release Indicator', releaseInd));
      if (prReleaseDate) lines.push(joinLine('Release Date', prReleaseDate));
      lines.push(joinLine('Deleted', deleted));
      lines.push(joinLine('Rejected', rejected));
      if (delInd) lines.push(joinLine('Deletion Indicator', delInd));

      const linkedPo = pickFirst(it, ['PO Number', 'ebeln'], '');
      const linkedPoItem = pickFirst(it, ['PO Item', 'ebelp'], '');
      if (linkedPo) lines.push(joinLine('Linked PO', linkedPoItem ? `${linkedPo} / ${linkedPoItem}` : linkedPo));

      lines.push('');
    });
  }

  return lines.join('\n');
}

function formatPrStatusNice(purchaseRequisition, resp) {
  const poItems = Array.isArray(resp?.poItems) ? resp.poItems : [];
  const prItems = Array.isArray(resp?.prItems) ? resp.prItems : [];

  const lines = [];
  lines.push(`Purchase Requisition Status (PR: ${purchaseRequisition})`);
  lines.push('');

  lines.push('Purchase Requisition Items:');
  if (!prItems.length) {
    lines.push('No PR items returned.');
  } else {
    prItems.forEach((it, idx) => {
      const prNo = pickFirst(it, ['PR Number', 'banfn'], purchaseRequisition);
      const prItem = pickFirst(it, ['PR Item', 'bnfpo']);
      const status = pickFirst(it, ['PR Status', 'prStatus']);
      const releaseStatus = pickFirst(it, ['Release Status'], '');
      const releaseInd = pickFirst(it, ['Release ind.', 'frgkz'], '');
      const deleted = normBoolText(pickFirst(it, ['PR Deleted', 'prDeleted'], ''));
      const rejected = normBoolText(pickFirst(it, ['PR Rejected', 'prRejected'], ''));
      const prReleaseDate = pickFirst(it, ['PR Release Date', 'prReleaseDate'], '');

      lines.push(`${idx + 1}.`);
      lines.push(joinLine('PR Number', prNo));
      lines.push(joinLine('PR Item', prItem));
      lines.push(joinLine('Status', status));
      if (releaseStatus) lines.push(joinLine('Release Status', releaseStatus));
      if (releaseInd) lines.push(joinLine('Release Indicator', releaseInd));
      if (prReleaseDate) lines.push(joinLine('Release Date', prReleaseDate));
      lines.push(joinLine('Deleted', deleted));
      lines.push(joinLine('Rejected', rejected));

      const linkedPo = pickFirst(it, ['PO Number', 'ebeln'], '');
      const linkedPoItem = pickFirst(it, ['PO Item', 'ebelp'], '');
      if (linkedPo) lines.push(joinLine('Linked PO', linkedPoItem ? `${linkedPo} / ${linkedPoItem}` : linkedPo));

      lines.push('');
    });
  }

  lines.push('Related Purchase Orders:');
  if (!poItems.length) {
    lines.push('No related PO items returned.');
  } else {
    poItems.forEach((it, idx) => {
      const poNo = pickFirst(it, ['PO Number', 'ebeln']);
      const poItem = pickFirst(it, ['PO Item', 'ebelp']);
      const status = pickFirst(it, ['PO Status', 'poStatus']);
      lines.push(`${idx + 1}.`);
      lines.push(joinLine('PO Number', poNo));
      lines.push(joinLine('PO Item', poItem));
      lines.push(joinLine('Status', status));
      lines.push('');
    });
  }

  return lines.join('\n');
}

function formatInvoiceStatusNice(purchaseOrder, resp) {
  const items = Array.isArray(resp?.items) ? resp.items : [];
  const lines = [];
  lines.push(`Invoice Status (PO: ${purchaseOrder})`);
  lines.push('');

  if (!items.length) {
    lines.push('No invoice items returned.');
    return lines.join('\n');
  }

  lines.push('Invoice Items:');
  items.forEach((it, idx) => {
    const invoiceNo = pickFirst(it, ['invoiceNo', 'Invoice No']);
    const value = pickFirst(it, ['invoiceValue', 'Invoice Value']);
    const status = pickFirst(it, ['livStatus', 'LIV Status']);
    const docDate = pickFirst(it, ['invoiceDocDate', 'Doc Date']);
    const postDate = pickFirst(it, ['invoicePostDate', 'Posting Date']);
    const paymentDueOn = pickFirst(it, ['paymentDueOn', 'Payment Due On'], '');

    lines.push(`${idx + 1}.`);
    lines.push(joinLine('Invoice Number', invoiceNo));
    lines.push(joinLine('Invoice Value', value));
    lines.push(joinLine('Status', status));
    lines.push(joinLine('Document Date', docDate));
    lines.push(joinLine('Posting Date', postDate));
    if (paymentDueOn) lines.push(joinLine('Payment Due On', paymentDueOn));
    lines.push('');
  });

  return lines.join('\n');
}

// ---------------- CATEGORY HANDLERS ----------------
const categoryHandlers = {
  'status-clarification': async ({ determinationJson }) => {
    const referenceNumber = determinationJson?.referenceNumber
      ? `${determinationJson.referenceNumber}`.trim()
      : '';

    const askForType =
      'Are you looking for the status of a purchase order, invoice, or purchase requisition?';

    const content = referenceNumber
      ? `${askForType} Please confirm what document type the number ${referenceNumber} refers to.`
      : `${askForType} Please share the relevant document number as well.`;

    return {
      deterministic: {
        role: 'assistant',
        content,
        additionalContents: []
      }
    };
  },

  'purchase-order-status': async ({ determinationJson }) => {
    const purchaseOrder = determinationJson?.purchaseOrder
      ? `${determinationJson.purchaseOrder}`.trim()
      : '';

    if (!purchaseOrder) {
      return {
        deterministic: {
          role: 'assistant',
          content: 'Please provide a purchase order number so I can check its status.',
          additionalContents: []
        }
      };
    }

    const serviceResponse = await mail_util.getPurchaseOrderStatus(purchaseOrder);

    const hasData =
      serviceResponse?.success &&
      ((Array.isArray(serviceResponse.poItems) && serviceResponse.poItems.length > 0) ||
        (Array.isArray(serviceResponse.prItems) && serviceResponse.prItems.length > 0));

    if (!hasData) {
      const reason = serviceResponse?.message ? ` Reason: ${serviceResponse.message}` : '';
      return {
        deterministic: {
          role: 'assistant',
          content: `I cannot find status for the provided purchase order.${reason}`,
          additionalContents: []
        }
      };
    }

    const content = formatPoStatusNice(purchaseOrder, serviceResponse);

    return {
      deterministic: {
        role: 'assistant',
        content,
        additionalContents: []
      }
    };
  },

  'invoice-status': async ({ determinationJson }) => {
    const purchaseOrder = determinationJson?.purchaseOrder
      ? `${determinationJson.purchaseOrder}`.trim()
      : '';

    if (!purchaseOrder) {
      return {
        deterministic: {
          role: 'assistant',
          content: 'Please provide a purchase order number so I can check the related invoice status.',
          additionalContents: []
        }
      };
    }

    const serviceResponse = await mail_util.getInvoiceStatus(purchaseOrder);

    const hasData =
      serviceResponse?.success &&
      Array.isArray(serviceResponse.items) &&
      serviceResponse.items.length > 0;

    if (!hasData) {
      const reason = serviceResponse?.message ? ` Reason: ${serviceResponse.message}` : '';
      return {
        deterministic: {
          role: 'assistant',
          content: `I cannot find status for the provided invoice or purchase order.${reason}`,
          additionalContents: []
        }
      };
    }

    const content = formatInvoiceStatusNice(purchaseOrder, serviceResponse);

    return {
      deterministic: {
        role: 'assistant',
        content,
        additionalContents: []
      }
    };
  },

  'purchase-requisition-status': async ({ determinationJson }) => {
    const purchaseRequisition = determinationJson?.purchaseRequisition
      ? `${determinationJson.purchaseRequisition}`.trim()
      : '';

    if (!purchaseRequisition) {
      return {
        deterministic: {
          role: 'assistant',
          content: 'Please provide a purchase requisition number so I can check its status.',
          additionalContents: []
        }
      };
    }

    const serviceResponse = await mail_util.getPurchaseRequisitionStatus(purchaseRequisition);

    const hasData =
      serviceResponse?.success &&
      ((Array.isArray(serviceResponse.prItems) && serviceResponse.prItems.length > 0) ||
        (Array.isArray(serviceResponse.poItems) && serviceResponse.poItems.length > 0));

    if (!hasData) {
      const reason = serviceResponse?.message ? ` Reason: ${serviceResponse.message}` : '';
      return {
        deterministic: {
          role: 'assistant',
          content: `I cannot find status for the provided purchase requisition.${reason}`,
          additionalContents: []
        }
      };
    }

    const content = formatPrStatusNice(purchaseRequisition, serviceResponse);

    return {
      deterministic: {
        role: 'assistant',
        content,
        additionalContents: []
      }
    };
  }
};

// ---------------------- CAP SERVICE ----------------------
module.exports = function () {
  /**
   * Main chat action called from UI
   */
  this.on('getChatRagResponse', async (req) => {
    const startTime = Date.now();

    try {
      const {
        conversationId,
        messageId,
        message_time,
        user_id,
        user_query,
        appId
      } = req.data;

      // 1) CLASSIFICATION – REMOTE via AI Engine destination
      const aiEngine = await cds.connect.to('AI_ENGINE');

      const classifyResult = await aiEngine.tx(req).send({
        method: 'POST',
        path: '/classifyUserQuery',
        data: {
          user_query,
          systemPrompt
        }
      });

      const category = classifyResult?.category;
      const determinationJson = JSON.parse(classifyResult?.determinationJson || '{}');

      console.log('AI ENGINE Classification', {
        query: user_query,
        classification: determinationJson
      });

      if (!basePrompts[category]) {
        throw new Error(`${category} is not in the supported categories`);
      }

      // 2) Run project-specific category handler
      const promptResponses = { ...basePrompts };
      let deterministicResponse = null;

      if (categoryHandlers[category]) {
        const { prompt, deterministic } =
          (await categoryHandlers[category]({
            determinationJson,
            user_query,
            basePrompt: promptResponses[category]
          })) || {};

        if (prompt) promptResponses[category] = prompt;
        if (deterministic) deterministicResponse = deterministic;
      }

      // 3) If deterministic → no RAG call
      if (deterministicResponse) {
        const responseTimestamp = new Date().toISOString();

        await logUsageToAiEngine(req, {
          category,
          startTime,
          isDeterministic: true,
          conversationId,
          messageId,
          userId: user_id
        });

        return {
          role: deterministicResponse.role,
          content: deterministicResponse.content,
          messageTime: responseTimestamp,
          messageId: messageId || null,
          additionalContents: JSON.stringify(deterministicResponse.additionalContents || [])
        };
      }

      // 4) RAG via AI ENGINE (remote CAP app via destination)
      const ragResult = await aiEngine.tx(req).send({
        method: 'POST',
        path: '/ragWithSdk',
        data: {
          conversationId,
          messageId,
          message_time,
          user_id,
          userQuery: user_query,
          appId: 'MAIL-CHATBOT',
          tableName,
          embeddingColumn,
          contentColumn,
          prompt: promptResponses[category],
          topK: 30
        }
      });

      // Normalize completion & additionalContents
      let completionObj;
      if (typeof ragResult?.completion === 'string') {
        try {
          completionObj = JSON.parse(ragResult.completion);
        } catch (e) {
          console.warn('RAG completion is not valid JSON string, using fallback.', ragResult.completion);
          completionObj = { role: 'assistant', content: ragResult?.completion || '' };
        }
      } else if (ragResult?.completion) {
        completionObj = ragResult.completion;
      } else {
        completionObj = {
          role: 'assistant',
          content: ragResult?.content || 'I was unable to generate a response at this time. Please try again.'
        };
      }

      let additionalContentsArr;
      if (typeof ragResult?.additionalContents === 'string') {
        try {
          additionalContentsArr = JSON.parse(ragResult.additionalContents);
        } catch (e) {
          console.warn('RAG additionalContents is not valid JSON string, defaulting to [].', ragResult.additionalContents);
          additionalContentsArr = [];
        }
      } else {
        additionalContentsArr = ragResult?.additionalContents || [];
      }

      const responseTimestamp = new Date().toISOString();

      await logUsageToAiEngine(req, {
        category,
        startTime,
        isDeterministic: false,
        conversationId,
        messageId,
        userId: user_id
      });

      return {
        role: completionObj.role,
        content: completionObj.content,
        messageTime: responseTimestamp,
        messageId: messageId || null,
        additionalContents: JSON.stringify(additionalContentsArr)
      };
    } catch (error) {
      console.error('Error while generating response for user query:', error);
      throw error;
    }
  });

  async function logUsageToAiEngine(req, { category, startTime, isDeterministic, conversationId, messageId, userId }) {
    try {
      const aiEngine = await cds.connect.to('AI_ENGINE');
      const durationMs = Date.now() - startTime;

      await aiEngine.tx(req).send({
        method: 'POST',
        path: '/logUsage',
        data: {
          sourceService: 'MAIL',
          category,
          isDeterministic,
          durationMs,
          conversationId,
          messageId,
          userId,
          tenantId: req.tenant || ''
        }
      });
    } catch (e) {
      console.warn('Failed to log usage to AI engine', e);
    }
  }

  this.on('getConversationHistoryFromEngine', async (req) => {
    const aiEngine = await cds.connect.to('AI_ENGINE');
    return aiEngine.tx(req).send({
      method: 'POST',
      path: '/getConversationHistory',
      data: { conversationId: req.data.conversationId }
    });
  });

  // ---------------------------------------------------------------------------
  // deleteChatData – delegated to AI engine (central cleanup)
  // ---------------------------------------------------------------------------
  this.on('deleteChatData', async (req) => {
    try {
      const aiEngine = await cds.connect.to('AI_ENGINE');

      await aiEngine.tx(req).send({
        method: 'POST',
        path: '/deleteAllChatData'
      });

      return 'Success!';
    } catch (error) {
      console.log('Error while deleting the chat content in AI engine:', error);
      throw error;
    }
  });
};

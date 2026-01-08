'use strict';

const cds = require('@sap/cds');
const mailUtil = require('./mail-util');

const DEFAULT_APP_ID = 'MAIL-CHATBOT';

// ---- CONFIG ----
const tableName = 'SAP_TISCE_DEMO_DOCUMENTCHUNK';
const embeddingColumn = 'EMBEDDING';
const contentColumn = 'TEXT_CHUNK';

// ---------------------- CAP SERVICE ----------------------
module.exports = function () {
  /**
   * Main mail extraction action called from CAP
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
        mail_json,
        projectId,
        contextType,
        expected_fields,
        appId
      } = req.data;

      const expectedFields = mailUtil.normalizeExpectedFields(expected_fields);
      const mailPayload = mailUtil.normalizeMailPayload(mail_json ?? user_query);
      const mailText = mailUtil.formatMailForQuery(mailPayload);
      const prompt = mailUtil.buildExtractionPrompt({
        projectId,
        contextType,
        expectedFields
      });

      const aiEngine = await cds.connect.to('AI_ENGINE');

      const ragResult = await aiEngine.tx(req).send({
        method: 'POST',
        path: '/ragWithSdk',
        data: {
          conversationId,
          messageId,
          message_time,
          user_id,
          userQuery: mailText,
          appId: appId || DEFAULT_APP_ID,
          tableName,
          embeddingColumn,
          contentColumn,
          prompt,
          topK: 30
        }
      });

      const completionObj = mailUtil.normalizeCompletion(ragResult);
      const additionalContentsArr = mailUtil.normalizeAdditionalContents(ragResult);
      const responseTimestamp = new Date().toISOString();

      await logUsageToAiEngine(req, {
        startTime,
        conversationId,
        messageId,
        userId: user_id
      });

      return {
        role: completionObj.role || 'assistant',
        content: mailUtil.ensureJsonContent(completionObj.content, expectedFields),
        messageTime: responseTimestamp,
        messageId: messageId || null,
        additionalContents: JSON.stringify(additionalContentsArr)
      };
    } catch (error) {
      console.error('Error while generating response for mail payload:', error);
      throw error;
    }
  });

  async function logUsageToAiEngine(req, { startTime, conversationId, messageId, userId }) {
    try {
      const aiEngine = await cds.connect.to('AI_ENGINE');
      const durationMs = Date.now() - startTime;

      await aiEngine.tx(req).send({
        method: 'POST',
        path: '/logUsage',
        data: {
          sourceService: 'MAIL',
          category: 'mail-extraction',
          isDeterministic: false,
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

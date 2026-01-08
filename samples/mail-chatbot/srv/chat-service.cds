service ChatService @(requires: 'authenticated-user') {

action getConversationHistoryFromEngine(conversationId : String)
  returns { historyJson : String; };

  // Flat response type – only primitive fields (no complex/array)
  type RagResponse {
    role               : String;
    content            : String;
    messageTime        : String;   // ISO timestamp as string
    messageId          : String;
    additionalContents : String;   // JSON string (e.g. "[]" or "[{...}]")
  }

  // Main mail extraction entrypoint used by CAP callers
  action getChatRagResponse(
    conversationId : String,
    messageId      : String,
    message_time   : Timestamp,
    user_id        : String,
    user_query     : String,
    mail_json      : String,
    projectId      : String,
    contextType    : String,
    expected_fields: String,
    appId          : String
  ) returns RagResponse;

  // Kept for backward compatibility – implementation can call
  // AIEngineService.deleteAllChatData or deleteChatDataForConversation
  function deleteChatData() returns String;
}

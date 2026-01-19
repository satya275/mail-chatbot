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
    conversationId : String null,
    messageId      : String null,
    message_time   : Timestamp null,
    user_id        : String null,
    user_query     : String null,
    mail_json      : String,
    projectId      : String null,
    contextType    : String null,
    expected_fields: String null,
    appId          : String
  ) returns RagResponse;

  // Kept for backward compatibility – implementation can call
  // AIEngineService.deleteAllChatData or deleteChatDataForConversation
  function deleteChatData() returns String;
}

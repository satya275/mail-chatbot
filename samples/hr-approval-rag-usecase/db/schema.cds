namespace sap.tisce.demo;

using {
    cuid,
    managed
} from '@sap/cds/common';

entity Conversation {

    key cID : UUID not null;
    userID: String;
    creation_time: Timestamp;
    last_update_time: Timestamp;
    title: String;
    to_messages: Composition of many Message on to_messages.cID = $self;
}

entity Message {

    key cID: Association to Conversation;
    key mID: UUID not null;
    role: String;
    content: LargeString;
    creation_time: Timestamp;
}

entity MessageFeedback {

    key feedback_id           : UUID not null;
    @cds.persistence.name: 'MSG_ID'
    message_id                : Association to Message;
    satisfaction_score        : String(1);
    satisfaction_score_reason : String(20);
    followup_consent_flag     : String(1);
    improvement_feedback      : LargeString;
    created_at                : Timestamp;
    created_by                : String(100);
}

entity DocumentChunk
{
    text_chunk: LargeString;
    metadata_column: LargeString;
    embedding: Vector(1536);
}


entity Files: cuid, managed{
    @Core.MediaType: mediaType @Core.ContentDisposition.Filename: fileName
    content: LargeBinary;
    @Core.IsMediaType: true
    mediaType: String;
    fileName: String;
    size: String;
}


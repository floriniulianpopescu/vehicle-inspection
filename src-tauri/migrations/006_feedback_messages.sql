-- Adds the feedback message, sent by WhatsApp to the cars inspected today. The message types
-- are a CHECK constraint, which SQLite cannot change in place, so both tables are rebuilt
-- (the migration runner turns foreign keys off meanwhile).
CREATE TABLE messages_new (
    MessageID INTEGER PRIMARY KEY,
    ClientID  INTEGER NOT NULL REFERENCES clients (ClientID) ON DELETE CASCADE,
    CarID     INTEGER REFERENCES cars (CarID) ON DELETE CASCADE,    -- empty for greetings
    Type      TEXT NOT NULL CHECK (Type IN ('inspection', 'christmas', 'new_year', 'easter', 'feedback')),
    Text      TEXT NOT NULL,
    SentAt    TEXT NOT NULL,                                        -- YYYY-MM-DDTHH:MM:SS, local time
    Status    TEXT NOT NULL CHECK (Status IN ('sent', 'failed'))
) STRICT;

INSERT INTO messages_new (MessageID, ClientID, CarID, Type, Text, SentAt, Status)
SELECT MessageID, ClientID, CarID, Type, Text, SentAt, Status FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX messages_sent_at ON messages (SentAt);
CREATE INDEX messages_client ON messages (ClientID);
CREATE INDEX messages_car ON messages (CarID);

CREATE TABLE sms_templates_new (
    Type TEXT PRIMARY KEY CHECK (Type IN ('inspection', 'christmas', 'new_year', 'easter', 'feedback')),
    Text TEXT NOT NULL
) STRICT, WITHOUT ROWID;

INSERT INTO sms_templates_new (Type, Text) SELECT Type, Text FROM sms_templates;
DROP TABLE sms_templates;
ALTER TABLE sms_templates_new RENAME TO sms_templates;

-- WhatsApp has no SMS length limits, so this text can use diacritics.
INSERT INTO sms_templates (Type, Text) VALUES
    ('feedback', 'Bună ziua! Vă mulțumim că ați făcut ITP-ul pentru {plate} la noi. Cum a fost experiența? Părerea dumneavoastră ne ajută să ne îmbunătățim.');

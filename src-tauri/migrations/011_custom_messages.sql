-- Holiday greetings make way for custom messages: a text (with an optional picture) for the
-- cars inspected in a chosen period. Cars inspected in the last week get a thank-you, or a
-- feedback request when their client agreed to one.
CREATE TABLE custom_messages (
    CustomID  INTEGER PRIMARY KEY,
    Name      TEXT NOT NULL,
    Text      TEXT NOT NULL,
    FromDate  TEXT NOT NULL,          -- YYYY-MM-DD, inspections from this day
    ToDate    TEXT NOT NULL,          -- YYYY-MM-DD, up to this day, included
    Image     BLOB,
    ImageType TEXT,
    CreatedAt TEXT NOT NULL
) STRICT;

-- The message types are a CHECK constraint, which SQLite cannot change in place, so the
-- table is rebuilt (the migration runner turns foreign keys off meanwhile). Greetings sent
-- before stay in the history.
CREATE TABLE messages_new (
    MessageID INTEGER PRIMARY KEY,
    ClientID  INTEGER NOT NULL REFERENCES clients (ClientID) ON DELETE CASCADE,
    CarID     INTEGER REFERENCES cars (CarID) ON DELETE CASCADE,
    Type      TEXT NOT NULL CHECK (Type IN ('inspection', 'christmas', 'new_year', 'easter', 'feedback',
                                            'thanks', 'custom')),
    Text      TEXT NOT NULL,
    SentAt    TEXT NOT NULL,
    Status    TEXT NOT NULL CHECK (Status IN ('sent', 'failed')),
    Channel   TEXT NOT NULL DEFAULT 'sms' CHECK (Channel IN ('sms', 'whatsapp')),
    -- Which custom message this was; kept as empty when that message is deleted.
    CustomID  INTEGER REFERENCES custom_messages (CustomID) ON DELETE SET NULL
) STRICT;

INSERT INTO messages_new (MessageID, ClientID, CarID, Type, Text, SentAt, Status, Channel)
SELECT MessageID, ClientID, CarID, Type, Text, SentAt, Status, Channel FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX messages_sent_at ON messages (SentAt);
CREATE INDEX messages_client ON messages (ClientID);
CREATE INDEX messages_car ON messages (CarID);
CREATE INDEX messages_channel ON messages (Channel, SentAt);
CREATE INDEX messages_custom ON messages (CustomID);

CREATE TABLE sms_templates_new (
    Type TEXT PRIMARY KEY CHECK (Type IN ('inspection', 'feedback', 'thanks')),
    Text TEXT NOT NULL
) STRICT, WITHOUT ROWID;

INSERT INTO sms_templates_new (Type, Text)
SELECT Type, Text FROM sms_templates WHERE Type IN ('inspection', 'feedback');
INSERT INTO sms_templates_new (Type, Text) VALUES
    ('thanks', 'Bună ziua! Vă mulțumim că ați făcut ITP-ul pentru {plate} la noi. Vă așteptăm cu drag și data viitoare!');

DROP TABLE sms_templates;
ALTER TABLE sms_templates_new RENAME TO sms_templates;

ALTER TABLE clients ADD COLUMN SmsOptOut INTEGER NOT NULL DEFAULT 0 CHECK (SmsOptOut IN (0, 1));

CREATE TABLE messages (
    MessageID INTEGER PRIMARY KEY,
    ClientID  INTEGER NOT NULL REFERENCES clients (ClientID) ON DELETE CASCADE,
    CarID     INTEGER REFERENCES cars (CarID) ON DELETE CASCADE,    -- empty for greetings
    Type      TEXT NOT NULL CHECK (Type IN ('inspection', 'christmas', 'new_year', 'easter')),
    Text      TEXT NOT NULL,
    SentAt    TEXT NOT NULL,                                        -- YYYY-MM-DDTHH:MM:SS, local time
    Status    TEXT NOT NULL CHECK (Status IN ('sent', 'failed'))
) STRICT;

CREATE INDEX messages_sent_at ON messages (SentAt);
CREATE INDEX messages_client ON messages (ClientID);
CREATE INDEX messages_car ON messages (CarID);

-- Lives in the database so custom wording comes back with a backup.
CREATE TABLE sms_templates (
    Type TEXT PRIMARY KEY CHECK (Type IN ('inspection', 'christmas', 'new_year', 'easter')),
    Text TEXT NOT NULL
) STRICT, WITHOUT ROWID;

-- No diacritics: they would cut the length of one SMS from 160 to 70 characters.
INSERT INTO sms_templates (Type, Text) VALUES
    ('inspection', 'Buna ziua! Inspectia tehnica pentru {plate} are scadenta la {date}. Va asteptam pentru programare.'),
    ('christmas', 'Craciun fericit si sarbatori linistite!'),
    ('new_year', 'La multi ani si un an nou plin de bucurii!'),
    ('easter', 'Paste fericit si sarbatori binecuvantate!');

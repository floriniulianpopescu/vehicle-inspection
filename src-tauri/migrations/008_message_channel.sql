-- ITP reminders now go by WhatsApp first and by SMS for whoever WhatsApp fails, so each
-- message records the channel it went through. Older messages: reminders were SMS, the rest
-- WhatsApp.
ALTER TABLE messages ADD COLUMN Channel TEXT NOT NULL DEFAULT 'sms' CHECK (Channel IN ('sms', 'whatsapp'));
UPDATE messages SET Channel = 'whatsapp' WHERE Type <> 'inspection';
CREATE INDEX messages_channel ON messages (Channel, SentAt);

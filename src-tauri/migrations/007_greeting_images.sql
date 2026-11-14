-- An optional picture sent with a greeting by WhatsApp. Kept in the database, so it comes back
-- with a backup like the text.
ALTER TABLE sms_templates ADD COLUMN Image BLOB;
ALTER TABLE sms_templates ADD COLUMN ImageType TEXT;

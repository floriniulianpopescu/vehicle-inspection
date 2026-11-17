-- When each car was last added or edited, for listing the most recently worked on first.
-- Cars already saved start from the day they were added.
ALTER TABLE cars ADD COLUMN UpdatedAt TEXT;
UPDATE cars SET UpdatedAt = CreatedAt;
CREATE INDEX cars_updated_at ON cars (UpdatedAt);

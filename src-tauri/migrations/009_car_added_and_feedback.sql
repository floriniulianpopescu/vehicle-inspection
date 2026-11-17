-- When each car was added, for listing the newest first, and whether its client agreed to be
-- asked for feedback. Cars already saved get the day of their first recorded inspection (or
-- today, when there is none); none of them is marked for feedback.
ALTER TABLE cars ADD COLUMN CreatedAt TEXT;
ALTER TABLE cars ADD COLUMN Feedback INTEGER NOT NULL DEFAULT 0 CHECK (Feedback IN (0, 1));
UPDATE cars SET CreatedAt = COALESCE(
    (SELECT MIN(i.Date) FROM inspections i WHERE i.CarID = cars.CarID) || 'T00:00:00',
    strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'));
CREATE INDEX cars_created_at ON cars (CreatedAt);

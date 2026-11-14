-- Adds 3 years (36 months) to the inspection frequencies. SQLite cannot change a CHECK
-- constraint in place, so the table is rebuilt; the migration runner turns foreign keys off
-- meanwhile, so the cars' links, inspections and messages are kept.
CREATE TABLE cars_new (
    CarID             INTEGER PRIMARY KEY,
    Plate             TEXT NOT NULL UNIQUE CHECK (Plate = upper(replace(Plate, ' ', ''))),
    Manufacturer      TEXT NOT NULL,
    Model             TEXT NOT NULL,
    LastRevision      TEXT,                       -- YYYY-MM-DD, empty when unknown
    RevisionFrequency INTEGER NOT NULL CHECK (RevisionFrequency IN (6, 12, 24, 36))  -- months
) STRICT;

INSERT INTO cars_new (CarID, Plate, Manufacturer, Model, LastRevision, RevisionFrequency)
SELECT CarID, Plate, Manufacturer, Model, LastRevision, RevisionFrequency FROM cars;

DROP TABLE cars;
ALTER TABLE cars_new RENAME TO cars;

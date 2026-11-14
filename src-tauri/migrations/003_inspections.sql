-- Appointments and the calendar are no longer used. Each visit is now kept as an inspection,
-- together with the client who brought the car.
CREATE TABLE inspections (
    InspectionID INTEGER PRIMARY KEY,
    CarID        INTEGER NOT NULL REFERENCES cars (CarID) ON DELETE CASCADE,
    ClientID     INTEGER REFERENCES clients (ClientID) ON DELETE SET NULL,  -- empty when unknown
    Date         TEXT NOT NULL,                                            -- YYYY-MM-DD
    UNIQUE (CarID, Date)
) STRICT;

CREATE INDEX inspections_date ON inspections (Date);
CREATE INDEX inspections_client ON inspections (ClientID);

-- Done appointments were real visits, so they start the history.
INSERT OR IGNORE INTO inspections (CarID, ClientID, Date)
SELECT CarID, ClientID, substr(TimeDate, 1, 10) FROM appointments
WHERE IsDone = 1 ORDER BY TimeDate DESC;

-- Every car's current last inspection is a visit too. The client is only known when the car
-- has exactly one.
INSERT OR IGNORE INTO inspections (CarID, ClientID, Date)
SELECT c.CarID,
       (SELECT CASE WHEN COUNT(*) = 1 THEN MAX(l.ClientID) END FROM carsclients l WHERE l.CarID = c.CarID),
       c.LastRevision
FROM cars c WHERE c.LastRevision IS NOT NULL;

DROP TABLE appointments;

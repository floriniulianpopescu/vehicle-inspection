CREATE TABLE clients (
    ClientID INTEGER PRIMARY KEY,
    Phone    TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE cars (
    CarID             INTEGER PRIMARY KEY,
    Plate             TEXT NOT NULL UNIQUE CHECK (Plate = upper(replace(Plate, ' ', ''))),
    Manufacturer      TEXT NOT NULL,
    Model             TEXT NOT NULL,
    LastRevision      TEXT,                       -- YYYY-MM-DD, empty when unknown
    RevisionFrequency INTEGER NOT NULL CHECK (RevisionFrequency IN (6, 12, 24))  -- months
) STRICT;

CREATE TABLE carsclients (
    CarID    INTEGER NOT NULL REFERENCES cars (CarID) ON DELETE CASCADE,
    ClientID INTEGER NOT NULL REFERENCES clients (ClientID) ON DELETE CASCADE,
    PRIMARY KEY (CarID, ClientID)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_carsclients_client ON carsclients (ClientID);

CREATE TABLE appointments (
    AppointmentID INTEGER PRIMARY KEY,
    ClientID      INTEGER NOT NULL REFERENCES clients (ClientID) ON DELETE CASCADE,
    CarID         INTEGER NOT NULL REFERENCES cars (CarID) ON DELETE CASCADE,
    TimeDate      TEXT NOT NULL,                  -- local time, YYYY-MM-DDTHH:MM
    IsDone        INTEGER NOT NULL DEFAULT 0 CHECK (IsDone IN (0, 1)),
    Duration      INTEGER NOT NULL CHECK (Duration > 0)  -- minutes
) STRICT;

CREATE INDEX idx_appointments_time ON appointments (TimeDate);
CREATE INDEX idx_appointments_client ON appointments (ClientID);
CREATE INDEX idx_appointments_car ON appointments (CarID);

-- Free text about a car ("Alte informații"), optional and searchable. Empty when not filled in.
ALTER TABLE cars ADD COLUMN Notes TEXT NOT NULL DEFAULT '';

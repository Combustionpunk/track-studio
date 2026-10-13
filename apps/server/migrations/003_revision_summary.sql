-- Each revision's own summary, so the public (approved) revision can be listed while a newer draft exists, and a
-- preview hash for cache-safe image URLs. Filled in at startup for older rows (backfillRevisions).
ALTER TABLE track_revisions ADD COLUMN name TEXT;
ALTER TABLE track_revisions ADD COLUMN lap_length REAL;
ALTER TABLE track_revisions ADD COLUMN corners INTEGER;
ALTER TABLE track_revisions ADD COLUMN size_length REAL;
ALTER TABLE track_revisions ADD COLUMN size_width REAL;
ALTER TABLE track_revisions ADD COLUMN area_length REAL;
ALTER TABLE track_revisions ADD COLUMN area_width REAL;
ALTER TABLE track_revisions ADD COLUMN errors INTEGER NOT NULL DEFAULT 0;
ALTER TABLE track_revisions ADD COLUMN preview_hash TEXT;

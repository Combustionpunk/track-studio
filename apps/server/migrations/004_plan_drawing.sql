-- The plan drawing changed (#9): preview hashes are of the new drawing, so clear them; backfillRevisions recomputes
-- them at start and every preview gets a new URL (old cached PNGs are simply no longer asked for).
UPDATE track_revisions SET preview_hash = NULL;

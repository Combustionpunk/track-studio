-- rctrack 1.2: real track size from the lane edges (built.size). NULL until the track is re-baked (pnpm rebake).
ALTER TABLE tracks ADD COLUMN size_length REAL;
ALTER TABLE tracks ADD COLUMN size_width REAL;

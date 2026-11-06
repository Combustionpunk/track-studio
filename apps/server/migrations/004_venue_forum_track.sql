-- A venue template links to one forum venue and one of its tracks (#65): at most one template per forum track.
-- Templates saved before rcvenue 1.1 have no track (NULL), and NULLs don't clash.
ALTER TABLE venues ADD COLUMN forum_track_id INTEGER;
CREATE UNIQUE INDEX venues_forum_track ON venues (forum_track_id);

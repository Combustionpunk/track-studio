-- Typical lap speed per race class, for the lap time estimate on layouts with no race data (#76): lap length / speed.
-- track-admins edit the list (PUT /api/class-speeds); position keeps their order (the first is the designer's default).
CREATE TABLE class_speeds (
  class TEXT PRIMARY KEY COLLATE NOCASE,
  speed REAL NOT NULL,
  position INTEGER NOT NULL
);
INSERT INTO class_speeds (class, speed, position) VALUES
  ('2WD Buggy', 6.5, 0),
  ('4WD Buggy', 7.0, 1),
  ('Stadium Truck', 6.0, 2),
  ('Short Course', 5.5, 3);

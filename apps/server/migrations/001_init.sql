-- Users come from the forum (DiscourseConnect). forum_id = Discourse user id; 0 = "system", negative = dev-login users.
CREATE TABLE users (
  forum_id    INTEGER PRIMARY KEY,
  username    TEXT NOT NULL,
  name        TEXT,
  avatar_url  TEXT,
  groups      TEXT NOT NULL DEFAULT '[]',   -- JSON array of forum group names
  admin       INTEGER NOT NULL DEFAULT 0,
  moderator   INTEGER NOT NULL DEFAULT 0,
  last_seen   TEXT NOT NULL
);

CREATE TABLE venues (
  id               TEXT PRIMARY KEY,          -- rcvenue id
  forum_venue_id   INTEGER,                   -- info.venue.id
  name             TEXT NOT NULL,
  owner_forum_id   INTEGER NOT NULL REFERENCES users(forum_id),
  current_revision INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE venue_revisions (
  venue_id     TEXT NOT NULL REFERENCES venues(id),
  revision     INTEGER NOT NULL,
  rcvenue_json TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  created_by   INTEGER NOT NULL REFERENCES users(forum_id),
  PRIMARY KEY (venue_id, revision)
);

CREATE TABLE tracks (
  id                TEXT PRIMARY KEY,         -- rctrack id (uuid)
  name              TEXT NOT NULL,
  author_forum_id   INTEGER NOT NULL REFERENCES users(forum_id),
  status            TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'archived')),
  venue_template_id TEXT,                     -- basedOn.venueTemplate
  derived_from_id   TEXT,                     -- info.derivedFrom.id
  current_revision  INTEGER NOT NULL,
  approved_revision INTEGER,                  -- pinned by the last approval
  lap_length        REAL NOT NULL,
  corners           INTEGER NOT NULL,
  area_length       REAL NOT NULL,
  area_width        REAL NOT NULL,
  footprint_w       REAL NOT NULL,            -- metres (footprint bbox)
  footprint_h       REAL NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX tracks_status ON tracks(status);
CREATE INDEX tracks_venue ON tracks(venue_template_id);

CREATE TABLE track_revisions (
  track_id     TEXT NOT NULL REFERENCES tracks(id),
  revision     INTEGER NOT NULL,
  rctrack_json TEXT NOT NULL,
  png_path     TEXT,                          -- relative to DATA_DIR once rendered
  created_at   TEXT NOT NULL,
  created_by   INTEGER NOT NULL REFERENCES users(forum_id),
  note         TEXT,
  PRIMARY KEY (track_id, revision)
);

-- DiscourseConnect login: one row per /auth/login, consumed by /auth/callback
CREATE TABLE auth_nonces (
  nonce       TEXT PRIMARY KEY,
  return_path TEXT NOT NULL,
  expires_at  INTEGER NOT NULL                -- unix ms
);

-- fit search results; revisions never change, so entries never go stale
CREATE TABLE fit_cache (
  track_id       TEXT NOT NULL,
  track_revision INTEGER NOT NULL,
  venue_id       TEXT NOT NULL,
  venue_revision INTEGER NOT NULL,
  results_json   TEXT NOT NULL,
  PRIMARY KEY (track_id, track_revision, venue_id, venue_revision)
);

INSERT INTO users (forum_id, username, name, last_seen) VALUES (0, 'system', 'Track Studio', '1970-01-01T00:00:00.000Z');

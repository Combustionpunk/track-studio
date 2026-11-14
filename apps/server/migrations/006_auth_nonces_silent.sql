-- Silent forum sign-in (#132). A nonce issued for a prompt=none check is marked, so a check that goes wrong (bad
-- signature, stale or replayed nonce, another browser) can land back on the page quietly instead of showing a login
-- error. Used nonces are marked rather than deleted, and expired ones kept an hour, so a late or repeated answer to a
-- silent check is still recognised as one.
ALTER TABLE auth_nonces ADD COLUMN silent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auth_nonces ADD COLUMN used_at INTEGER; -- unix ms; NULL until the forum's answer is taken

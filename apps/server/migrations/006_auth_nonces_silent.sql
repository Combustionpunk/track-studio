-- Silent forum sign-in (#132): a nonce issued for a prompt=none check is marked, so a check that goes wrong (bad
-- signature, stale nonce, another browser) can land back on the page quietly instead of showing a login error.
ALTER TABLE auth_nonces ADD COLUMN silent INTEGER NOT NULL DEFAULT 0;

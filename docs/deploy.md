# Deploying Track Studio (tracks.rcmisfits.org)

Production is one small DigitalOcean droplet running two containers from `docker-compose.prod.yml`:

- **track-studio**: the app image built from this repo's `Dockerfile` (API + web app). Not reachable from outside.
- **caddy**: HTTPS for `tracks.rcmisfits.org` (Let's Encrypt, renewed automatically), proxying to the app.

Data lives on named Docker volumes, so rebuilding or replacing containers keeps it:

| Volume | Holds | Backed up |
|---|---|---|
| `track-studio_track-studio-data` (`/data` in the app) | `track-studio.sqlite`, `previews/` PNG cache, `theme-cache.json` | the database, nightly, to Spaces. Previews and the theme cache rebuild themselves |
| `track-studio_caddy-data` | certificates | no: Caddy gets new ones (keep the volume to stay clear of Let's Encrypt rate limits) |

Agents never deploy: everything below is for Yeti.

## The droplet

- **Region: the same region as the forum.** Check the forum droplet's region in the DigitalOcean control panel
  (Droplets → the forum droplet) and pick the same one. Logins bounce between the two, and the forum fetches link
  previews from Track Studio.
- **Size: Basic, 2 GB RAM / 1 vCPU, 50 GB disk** (about $12 a month). The image is built on the droplet, and the
  `pnpm install` + web build need more than 1 GB. A 1 GB droplet works only with a swap file.
- **Image: Ubuntu 24.04 LTS**, SSH key login only.
- **Firewall** (Networking → Firewalls): inbound TCP 22 (ideally only from your IP), TCP 80, TCP 443 and UDP 443.
  Port 80 has to be open for Let's Encrypt and the redirect to HTTPS.
- **Spaces**: a private bucket for backups, e.g. `rcmisfits-backups`, in the Spaces region nearest the droplet
  (Spaces isn't in every region). Make an access key limited to that bucket (read/write/delete), not a full-access key.

## DNS

Where `rcmisfits.org` is hosted, add:

- an **A record** `tracks` → the droplet's IPv4 address (and an AAAA record if you enabled IPv6). A TTL of 300 for
  a start makes mistakes cheap to fix.

Check with `dig +short tracks.rcmisfits.org` before the first start. Caddy can only get its certificate once the name
points at the droplet.

## First deploy

On the droplet, as root (or with sudo):

```sh
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh
apt-get install -y unattended-upgrades

# the code
git clone https://github.com/Combustionpunk/track-studio.git /opt/track-studio
cd /opt/track-studio

# settings: start from the example, then edit
cp .env.example .env
chmod 600 .env
```

In `/opt/track-studio/.env` set:

```sh
BASE_URL=https://tracks.rcmisfits.org
FORUM_URL=https://forum.rcmisfits.org
DISCOURSE_CONNECT_SECRET=<openssl rand -hex 32>   # the same value goes into the forum (below)
SESSION_SECRET=<openssl rand -hex 32>             # changing it later logs everyone out
ORGANISER_GROUP=track-admins
TRACKS_DOMAIN=tracks.rcmisfits.org
COMPOSE_FILE=docker-compose.prod.yml             # so plain `docker compose …` uses the production file
SPACES_ENDPOINT=https://<region>.digitaloceanspaces.com
SPACES_BUCKET=rcmisfits-backups
SPACES_KEY=<access key id>
SPACES_SECRET=<access key secret>
```

`PORT`, `DATA_DIR`, `NODE_ENV` and `DEV_LOGIN` are fixed by the compose file; leave them as they are. Don't paste the
`.env` anywhere: it's the only place the secrets live.

Then:

```sh
docker compose up -d --build          # first build takes a few minutes
docker compose ps                     # track-studio should say (healthy), caddy Up
curl -fsS https://tracks.rcmisfits.org/healthz    # {"ok":true}
docker compose logs -f caddy          # if HTTPS isn't up yet: look for the certificate being obtained
```

Optional: load the reference venues and example tracks (approved, by "system"). Safe to re-run.

```sh
docker compose run --rm track-studio node dist/seed.js
```

Moving to a new droplet? Do everything up to `docker compose up`, then [restore](#restore) the latest backup first.

## Forum settings

On forum.rcmisfits.org, Admin → Settings:

- `enable discourse connect provider`: on.
- `discourse connect provider secrets`: add `tracks.rcmisfits.org|<DISCOURSE_CONNECT_SECRET>` (the host, a pipe, and
  the same secret as in `.env`).
- `allowed iframes`: add `https://tracks.rcmisfits.org/embed/` (for the embedded track viewer in posts).
- Create the group `track-admins` (or whatever `ORGANISER_GROUP` says) and add the organisers. Forum admins are
  organisers anyway.

Check: log in at https://tracks.rcmisfits.org (it should bounce through the forum and back), then paste a track link
into a forum post and see the preview, and try "Copy forum embed" from a track page.

## Updating

```sh
cd /opt/track-studio
deploy/backup.sh                      # a backup just before the update
git pull
docker compose up -d --build          # rebuilds the image; the data volume is kept
docker compose ps                     # (healthy) again
docker image prune -f                 # drop the old image layers
```

If the update changed the engine (its release notes or PR say "rebake"), refresh every stored track afterwards:

```sh
docker compose exec track-studio node dist/rebake.js --dry-run   # see what would change
docker compose exec track-studio node dist/rebake.js
```

Rolling back: `git checkout <previous commit>` and `docker compose up -d --build`. Migrations only add things, but if a
bad release damaged data, [restore](#restore) the backup taken before the update.

## Backups

`deploy/backup.sh` runs `node dist/backup.js` inside the running app container. It:

1. takes a snapshot with SQLite's online backup API, so it's consistent while the app keeps serving (a plain copy of
   the `.sqlite` file can miss recent writes still in the `-wal` file);
2. runs `integrity_check` on the snapshot, gzips it and uploads it as
   `track-studio/nightly/track-studio-<UTC time>.sqlite.gz`;
3. only then deletes the oldest, keeping the newest **14** (`BACKUP_KEEP`). Other files in the bucket are left alone.

Any failure exits non-zero and deletes nothing.

Try it, then schedule it:

```sh
deploy/backup.sh --dry-run            # makes and checks the snapshot, lists what it would upload and prune
deploy/backup.sh                      # a real one; check it in the Spaces browser

cat > /etc/cron.d/track-studio-backup <<'CRON'
# nightly Track Studio backup to Spaces (03:15 UTC)
15 3 * * * root /opt/track-studio/deploy/backup.sh >> /var/log/track-studio-backup.log 2>&1
CRON

cat > /etc/logrotate.d/track-studio-backup <<'ROT'
/var/log/track-studio-backup.log {
    monthly
    rotate 6
    compress
    missingok
    notifempty
}
ROT
```

Glance at `/var/log/track-studio-backup.log` now and then: each night adds an `Uploaded …` line.
Manual backups (like the one before an update) count towards the 14.

## Restore

The app must be stopped while its database is replaced. The database being replaced is kept next to it as
`track-studio.sqlite.before-restore-<time>`, so a restore can itself be undone.

```sh
cd /opt/track-studio
docker compose run --rm track-studio node dist/restore.js --list     # what's in Spaces, oldest first
docker compose stop track-studio
docker compose run --rm track-studio node dist/restore.js latest     # or a key from the list
docker compose up -d
docker compose ps                                                    # (healthy)
```

`restore.js` downloads the backup, checks it (`integrity_check` and the schema) before touching anything, and refuses
to run while the database looks in use (its `-wal` file exists). If you're sure the app is stopped and it still
refuses (after a crash, say), add `--force`.

### Restore drill

Every few months, prove the latest backup restores, without touching the live data:

```sh
docker compose run --rm -e DATA_DIR=/tmp/drill track-studio node dist/restore.js latest
```

It downloads and checks the backup into a throwaway folder inside a one-off container. `Restored …` means the backup is
good. The same round trip (backup a running app's database, restore it into an empty folder, serve the same tracks) is
in the automated tests: `apps/server/test/backup.test.ts`, against a local S3 stub.

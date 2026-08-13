# Amphi

Browse films and series, put them on a watchlist, and let the box fetch them on its own. It
searches your indexers through Jackett or Prowlarr, scores what comes back — resolution,
language, indexer, seeders, codec — hands the winner to qBittorrent, and keeps watching a
series episode by episode as new ones air. Metadata comes from TMDB; nothing about your
library leaves the machine.

No media server integration and none needed: what has been downloaded is the app's own
answer, kept in its own database.

## Install

Two containers, one file, no configuration:

```bash
curl -O https://raw.githubusercontent.com/gptrk0/amphi/master/docker-compose.yml
docker compose up -d
```

Then open <http://localhost:3000>.

1. **The first person to open a fresh install becomes its administrator.** The window closes
   the moment one account exists, so do this before the port is reachable from anywhere you
   do not trust.
2. **Settings → General**: a [TMDB API key](https://www.themoviedb.org/settings/api). Nothing
   can be shown without it.
3. **Settings → Indexer**: the Jackett or Prowlarr URL, its api key, and the indexer ids you
   want, in priority order.
4. **Settings → Download client**: the qBittorrent URL, user and password.
5. **Settings → Quality / Language**: what a good release looks like to you. The defaults
   prefer 1080p, then 720p, and Hungarian over English — both are lists you reorder.

That is the whole setup. Everything above lives in the database and is edited in the browser;
the container itself has no configuration file.

### Upgrading

```bash
docker compose pull && docker compose up -d
```

Migrations are applied at start, by the container, before the server accepts a request. The
database volume is the only thing that has to survive.

## Configuration outside the app

Three environment variables exist, and only because they have to be known before the
database can be read:

| Variable | What it is |
|---|---|
| `DATABASE_URL` | The Postgres connection string. Set in the compose file. |
| `SCAN_DISABLED` | `1` and the background scanner never starts — nothing is searched or downloaded on its own. Deliberately not a setting in the database: an emergency brake must not live somewhere the app can talk itself out of it. |
| `TZ` | The timezone of the log and the notifications. UTC without it. |

Everything else — 50-odd settings with their defaults, groups and help text — is in
[src/lib/settings.ts](src/lib/settings.ts) and on the `/settings` page.

## Development

The development stack bind mounts the repository and rebuilds on every start, which is the
opposite of what the released image does:

```bash
cp .env.example .env      # APP_ENV=development, and a database password
docker compose up -d      # COMPOSE_FILE in .env points at .docker/docker-compose.yml
```

The dev container also runs Prisma Studio on port 5555. Prisma commands go through it, since
the database is only reachable on the docker network:

```bash
docker exec -w /home/bun/app amphi_app bunx prisma migrate status
```

The plan document, the measurements behind every decision and the operational notes are in
[PLAN.md](PLAN.md) — in Hungarian.

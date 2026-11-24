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

That file is the app and its database and nothing else: it takes for granted that an indexer
manager and qBittorrent are already running somewhere it can be pointed at. If they are not,
or the ports and the folders have to be different on this machine, the [compose
generator](https://gptrk0.github.io/amphi/) writes a file with whatever is missing in it —
tick what you already run and it stays out.

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

## On a phone

Added to the home screen the app runs in its own window, with its own icon and no browser
around it. There is nothing to install from a store and nothing to publish: the page says
what it is, and the phone does the rest. Two things decide whether that works.

**It has to be https.** A browser will only offer to install a page, and will only run the
service worker behind it, in a secure context — `http://192.168.1.50:3000` is not one,
whatever else is right about it. The usual answer, and the one that also solves being away
from the house, is a [Tailscale](https://tailscale.com) address: `tailscale serve` puts a
real certificate in front of the container and the phone reaches it from anywhere. A
tunnel does the same job.

**On iOS it has to be the home screen.** A page in a Safari tab cannot be installed and
cannot be notified; Share → Add to Home Screen is what turns it into a web app, and from
iOS 16.4 that web app can receive notifications. Android offers the install itself.

Offline, the app says so and nothing more. Everything worth looking at is in a database on
a machine that is either reachable or not, and a cached shell with every list empty would
only look like a working app that had lost its library.

### Notifications on the phone

On your **account page**, turn on *Notifications on this device* and press Test. That is
the whole of it: no account anywhere, no second app, nothing else to install. The app
signs its own push messages, and the key pair it needs is generated the first time
somebody asks for one.

The switch belongs to the browser it was pressed in, not to the account — so every phone
you want to be told on has to be turned on on that phone, and a laptop is a third one. The
**What to send you** boxes beside it decide which events go out, and they are one answer
for every channel: wanting to hear that something is ready is a thing to want, not a thing
to want once per transport.

**What leaves the machine, since this is the one place it does.** A web push travels
through the browser maker's own service — Apple, Google or Mozilla — and the message is
encrypted to keys your phone generated and this server never chose, so what they carry is
sealed. What they do learn is that this install sent something to that device at that
moment. If that trade is not worth a notification, the webhook below does the same job
without it.

### A notification without https

A push needs a certificate, so an install reached as a plain address on the house network
cannot have one. A webhook can: it is the server calling out rather than a browser being
reached, and [ntfy](https://ntfy.sh) turns such a call into a notification on a phone that
has the ntfy app. Put one in **your account page → Your webhook**, or under **Settings →
Notifications** for the install's own channel:

```
https://ntfy.sh/<SECRET-TOPIC>/publish?title={title}&message={message}&click=<YOUR-AMPHI-URL>
```

- **The topic name is the password.** Anybody who guesses it reads every notification you
  get, so make it long and random — `amphi` is not a topic name.
- **`click` is where the tap lands**: the public address of this install.
- A **self-hosted ntfy** on the same network is refused by default. The app will not call a
  private address unless an administrator allows it under Settings → Notifications.

Telegram and Discord are the same field with a different URL; the account page offers all
three as examples to start from.

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

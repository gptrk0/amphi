# syntax=docker/dockerfile:1

# The released image. Everything a run needs is baked in: the dependencies, the generated
# Prisma client, the compiled server and the migrations. Starting a container applies the
# migrations and runs the server — nothing is installed and nothing is compiled at start,
# which is the whole difference from .docker/Dockerfile, where the repository is bind
# mounted and rebuilt on every start because that one is for developing.

# ---- dependencies -----------------------------------------------------------------------

FROM oven/bun:1 AS deps

WORKDIR /app

# only the manifest, so this layer survives every source change
COPY package.json bun.lock ./

# copyfile, not the default hardlink backend: linking out of the package cache across an
# overlay filesystem is what a build sandbox is, and bun fails the extraction there
# ("Fail extracting tarball for next") while the same install succeeds in a plain container
RUN bun install --frozen-lockfile --backend=copyfile

# ---- build ------------------------------------------------------------------------------

FROM oven/bun:1 AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# prisma.config.ts asks for the variable before it does anything, and `generate` never opens
# a connection — a placeholder is enough, and it stays behind in this stage
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# the client is generated, never committed, so the build has to make it before the compile
# can typecheck anything that touches the database. `public` is created because it is empty
# and git does not carry empty directories: it exists in a working copy and not in a fresh
# checkout, which is exactly the difference between a build here and a build on a runner.
RUN mkdir -p public && bunx prisma generate && bun run build

# ---- the migration tool -----------------------------------------------------------------

# Applying the migrations at start needs the Prisma cli, and the cli needs its own dependency
# tree: lifted package by package out of the build it came up looking for `valibot`. So it is
# installed on its own here, from the version the app itself pins, and on the image that will
# run it — the engines it downloads are chosen for that libc and that openssl.
FROM node:22-bookworm-slim AS migrator

WORKDIR /migrator

# the same openssl the runner has, and for the same reason: the engine is chosen at
# install time by what is detectable here, and at run time by what is detectable there.
# With the package on one side only, the two disagree — measured: the cli then tries to
# download the other engine into a read only /app and the container never starts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# under a name npm will not read as its own manifest: with a package.json in the directory it
# would install everything in it — next, react and all — next to the cli, which is how this
# stage first came out 600 MB heavier than the app it serves
COPY package.json ./version-source.json

# dotenv because prisma.config.ts asks for it, and there is no reason for the config file to
# have two shapes
RUN npm install --no-save --no-package-lock --omit=dev --omit=optional \
        "prisma@$(node -p "require('/migrator/version-source.json').dependencies.prisma")" \
        dotenv \
    && rm version-source.json

# ---- run --------------------------------------------------------------------------------

# node, not bun, and the same debian release the build used: the Prisma engines were picked
# during `bun install` for that libc and that openssl, and a binary chosen for one image
# does not run on another
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Prisma picks its engine by the openssl it finds, and without the package it cannot tell:
# it warns and falls back to 1.1.x on an image that has 3.x. It happened to work, but a
# guessed binary is not something a migration should depend on.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# the standalone output carries only what the server actually imports, node_modules included
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# the generated client explicitly: the trace follows imports, and the query compiler next to
# it is a .wasm nobody imports by name
COPY --from=builder /app/prisma/generated ./prisma/generated

# the cli on top of the traced modules — same versions, so the overlap is a replacement, not
# a second copy of anything — plus what it reads: the schema, the migrations and the config
COPY --from=migrator /migrator/node_modules ./node_modules
COPY --from=builder /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder /app/prisma/migrations ./prisma/migrations
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

COPY .docker/entrypoint.production.sh /entrypoint.sh

# nothing here is ever written to, so the server has no reason to be root
USER node

EXPOSE 3000

# the state endpoint is the one that answers without a session, and it reads the database on
# the way — so a healthy container really is a working one, not just a listening socket
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/auth/state').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# through the shell on purpose: whether the file carries an executable bit depends on the
# machine the image was built from, and that is not something a release should depend on
ENTRYPOINT [ "/bin/sh", "/entrypoint.sh" ]

#!/bin/bash

set -e

# Everything a clone does not carry: the dependencies, the generated Prisma client and
# the schema itself. Without these a fresh install came up against an empty database and
# died on the first query — and since 2026-08-08 the first thing the server does is write
# a log line, so that meant every single start.
prepare() {
    bun install
    bunx prisma generate

    # `deploy`, never `dev`: it only applies what is already in prisma/migrations, asks
    # nothing and can reset nothing. A database that is not accepting connections yet is
    # the normal case on a first `compose up`, so it is worth waiting for.
    for attempt in $(seq 1 30); do
        if bunx prisma migrate deploy; then
            return 0
        fi

        echo "The database did not answer, retrying ($attempt/30)."
        sleep 2
    done

    # a server that answers 500s is worse than a container that says why it stopped
    echo "The migrations could not be applied. Giving up instead of starting a server that cannot work."

    return 1
}

if [ "$APP_ENV" == "development" ]; then
    echo "Started in development mode."

    prepare

    bunx prisma studio --browser none --port 5555 &

    # the scanner starts with the Next server (src/instrumentation.ts), so nothing
    # is scanned while the dev server is not running
    exec bun run dev

else
    echo "Started in production mode."

    prepare

    bun run build

    exec bun run start
fi

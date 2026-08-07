#!/bin/bash

if [ "$APP_ENV" == "development" ]; then
    echo "Started in development mode."

    bunx prisma studio --browser none --port 5555 &

    # the scanner starts with the Next server (src/instrumentation.ts), so nothing
    # is scanned while the dev server is not running
    exec bun run dev

else
    echo "Started in production mode."
    bun install
    bun run build
    bun run start
fi

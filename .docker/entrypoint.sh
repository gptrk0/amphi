#!/bin/bash

if [ $APP_ENV == "development" ]; then
    echo "Started in development mode."
    bunx prisma studio --browser none --port 5555
    sleep infinity

else
    echo "Started in production mode."
    bun install
    bun run build
    bun run start
fi

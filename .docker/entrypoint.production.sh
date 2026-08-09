#!/bin/sh

set -e

# `deploy`, never `dev`: it only applies what is already in prisma/migrations, asks nothing
# and can reset nothing.
#
# The retry is not about the first start alone — the compose file already waits for the
# database healthcheck. It is about every other reason a database is briefly away (its own
# restart, a host that brought the two containers up in the wrong order, a slow volume): a
# container that gives up on those would need a human, and this one does not.
for attempt in $(seq 1 30); do
    if node node_modules/prisma/build/index.js migrate deploy; then
        # the scheduler starts with the server (src/instrumentation.ts), so from here on the
        # app is doing its own work whether or not anybody opens it
        exec node server.js
    fi

    echo "The database did not answer, retrying ($attempt/30)."
    sleep 2
done

# a server that answers 500s is worse than a container that says why it stopped
echo "The migrations could not be applied. Giving up instead of starting a server that cannot work."

exit 1

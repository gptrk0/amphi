import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // the production image runs this output: next traces what the server actually reaches
    // for and writes a self contained folder, so the released container carries neither the
    // sources nor the full node_modules it was built from
    output: "standalone",
    // the postgres driver reads files and opens sockets, and the production compiler tried to
    // bundle it anyway — `Module not found: Can't resolve 'fs'` from inside pg-connection-string,
    // by way of the prisma adapter that instrumentation.ts pulls in at boot. Listed here it
    // stays a plain require at run time, which is the only thing it can be.
    serverExternalPackages: [ "pg", "@prisma/adapter-pg" ],
    // and the same chain a second time, for the runtime it can never run in. Because a
    // middleware exists, next compiles instrumentation.ts for the edge as well, and from
    // there the imports lead to the postgres driver — which wants `fs`, `net`, `string_decoder`
    // and half of node besides. The code is unreachable there (`register()` returns unless
    // NEXT_RUNTIME is nodejs), so the driver is resolved to nothing rather than chased through
    // a list of shims that would only ever be dead weight.
    webpack: (config, { nextRuntime }) => {
        if (nextRuntime === "edge") {
            config.resolve.alias = { ...config.resolve.alias, pg: false, "pg-native": false };
        }

        return config;
    },
    images: {
        remotePatterns: [
            { protocol: "https", hostname: "image.tmdb.org" }
        ]
    }
};

export default nextConfig;

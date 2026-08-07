import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
    baseDirectory: __dirname,
});

const eslintConfig = [
    ...compat.extends("next/core-web-vitals", "next/typescript"),
    {
        // The three files that read foreign json and xml: TMDB, torznab and the
        // qBittorrent web api. Their shapes are documented elsewhere and change
        // without us, so every field is checked and defaulted where it is read —
        // writing interfaces for them would claim a guarantee nobody gives. Inside
        // the app the mapped types take over, and the rule still applies there.
        files: [ "src/lib/media.ts", "src/lib/indexer.ts", "src/lib/torrent.ts" ],
        rules: {
            "@typescript-eslint/no-explicit-any": "off"
        }
    }
];

export default eslintConfig;

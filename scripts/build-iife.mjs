// Builds the CDN artifact dist/verify.iife.js and prints its SRI hash.
// The hash is also written to dist/verify.iife.js.sri so CI and tests
// can check it.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const outfile = join(root, "dist", "verify.iife.js");

await build({
  entryPoints: [join(root, "src", "index.ts")],
  bundle: true,
  format: "iife",
  globalName: "VerisouraVerify",
  target: ["es2020"],
  minify: true,
  outfile,
  banner: {
    js: `/* ${pkg.name} ${pkg.version} | Apache-2.0 | https://docs.verisoura.com */`,
  },
  legalComments: "inline",
});

const bytes = readFileSync(outfile);
const sri = "sha384-" + createHash("sha384").update(bytes).digest("base64");
writeFileSync(outfile + ".sri", sri + "\n");

console.log(`built dist/verify.iife.js (${bytes.length} bytes)`);
console.log(`SRI: ${sri}`);
console.log(
  `<script src="https://sdk.verisoura.com/web/${pkg.version}/verify.js" integrity="${sri}" crossorigin="anonymous"></script>`
);

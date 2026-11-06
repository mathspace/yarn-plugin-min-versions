# minimatch 9.0.9 security backport

`minimatch+9.0.9.patch` backports the glob preprocessing limits from upstream
[77a0f5c4](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8)
for CVE-2026-118764 to both CommonJS and ESM entry points. It bounds `**/..`
splitting and skips quadratic deduplication of large pattern sets, preserving
their matching behavior.

There is no fixed upstream 9.x release. Fixed minimatch 11 changes APIs used by
the installed glob 10.5.0: replacing minimatch 9.0.9 with 11.0.5 made a simple
`*.json` glob return no files. Keep the existing dependency APIs until compatible
parent releases permit upgrading; remove this backport when that happens.

`npm ci` applies the patch through the `postinstall` lifecycle. Do not disable
install scripts. `npm test` checks both module formats against upstream's
adversarial patterns and exercises glob, rimraf and TUF delegation consumers.

# Release builds

## Build from the Mozilla source archive

Extract `sudont-VERSION-sources.zip` and open a terminal in the extracted folder.
The archive contains the source code, dependency lockfile, build scripts, and
original icon from the release tag. It does not include installed dependencies
or generated files.

Use Linux with Node.js 20, Bash, ImageMagick, and zip. CI uses Ubuntu 24.04 with
its packaged ImageMagick. The icon script accepts either `magick` (ImageMagick 7)
or `convert` (ImageMagick 6). Install the pnpm version listed in the
`packageManager` field in `package.json` (currently 12.6.0).

Run these commands from the extracted folder:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm zip
```

Installing dependencies requires network access. No credentials or private
services are needed. The build generates icons, checks TypeScript, bundles the
extension with esbuild, and copies static files into `dist/`. The resulting
`sudont.zip` contains the extension files at its root and excludes source maps.
Use a fresh extracted folder when rebuilding to avoid old files in the ZIP.

## GitHub release assets

After a release-please release is created, CI checks out its tag and attaches:

- `sudont-VERSION.zip`: the built extension for store submission.
- `sudont-VERSION-sources.zip`: the tagged source tree for Mozilla source review,
  including these build instructions.

The build does not submit to stores or sign the extension. The ZIP uses the
repository's manifest unchanged; it currently declares a Firefox background
script, not a Chrome Manifest V3 service worker.

To retry a failed build, run the `release-pipeline` workflow manually and set
`tag` to the existing release tag. This replaces the two assets on that release.
Leave `tag` empty to run release-please normally. Release-please requires the
`RELEASE_PLEASE_TOKEN` repository secret; asset uploads use the workflow's
GitHub token.

# Sudon't

A puzzle before you scroll.

Sudon't is a browser extension that adds a small, friendly pause before you
open distracting websites. Instead of the page loading instantly, you're
asked to solve a quick Sudoku puzzle first. Once you finish it, you can:

- enter the site with a limited block of scrolling time,
- play another Sudoku instead,
- do a crossword instead, or
- explain in a few sentences why you need extra time, and grant yourself a
  few more minutes.

When your time runs out, the pause returns. A short reflection log keeps
track of every time you granted yourself extra minutes and why, so you can
see your own patterns.

## Why it works

- The puzzle interrupts the automatic "open app, start scrolling" reflex
  without blocking you outright.
- Writing out *why* you need more time turns an impulsive click into a
  deliberate decision.
- You're always in control: leave anytime, add or remove sites, and adjust
  puzzle difficulty and unlock duration from the settings page.

## Privacy

Sudon't doesn't collect, transmit, or sell any data. Everything (your site
list, settings, and reflection log) is stored locally in your browser using
the standard extension storage API.

## Permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Save your site list and settings locally |
| `tabs` | Detect when you navigate to a site you've chosen to pause |
| `alarms` | Track when your unlocked time expires |
| `scripting` | Inject the pause screen only on sites you've explicitly granted access to |
| Host permissions (optional, per-site) | Granted one site at a time; nothing is monitored beyond what you add to your list |

## Development

Requires [pnpm](https://pnpm.io) and [ImageMagick](https://imagemagick.org)
(`magick` on `PATH`) for icon generation.

```sh
pnpm install
```

Drop a 128x128 PNG at `icons/icon-128.png`, then:

```sh
pnpm build   # generates icons, type-checks, bundles, and copies static files into dist/
pnpm zip     # zips dist/ into sudont.zip for store submission
```

Load `dist/` as an unpacked extension in Chrome (`chrome://extensions`,
enable Developer mode, "Load unpacked") or in Firefox
(`about:debugging#/runtime/this-firefox`, "Load Temporary Add-on").

## License

TBD.

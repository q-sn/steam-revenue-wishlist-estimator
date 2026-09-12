# Screenshots

The pictures in the project README, the seven images of the [Chrome Web Store
listing](https://chromewebstore.google.com/detail/kmolckbdnoohadbcjgdfdlchgacdbjij),
the five of the [Firefox listing](https://addons.mozilla.org/en-US/firefox/addon/wishlytic/), and the harness that
makes all of them.

```bash
node screenshots/take.mjs             # retake the pictures from the inputs in inputs/
node screenshots/take.mjs --collect   # refetch today's figures first, then retake
node screenshots/store.mjs            # recompose the store images from those pictures
node screenshots/store.mjs 3 small    # or just those
node screenshots/store.mjs --opera    # the five again, at Opera's size
node screenshots/store.mjs --firefox  # and at the size AMO takes
```

Nothing here is a mock-up. Each shot is the shipping overlay, running the
shipping core, over a real store page in headless Chrome, on figures collected
from the same endpoints the extension reads. The only thing standing in for the
extension is a `chrome.*` shim in `page.js`, because a page script has no
extension APIs — `chrome.i18n` is backed by `_locales/`, and `getManifest` by
`manifest.json`, so the wording and the version in the corner are the shipped
ones.

The inputs are committed alongside the pictures. A UI change can therefore be
re-shot against the same numbers as the pictures it replaces, which is the only
way to see what actually changed; `--collect` is for when the figures
themselves should move on. Nothing is cached to disk — in particular not into
`data/`, where the ranking and announcement files of the same names belong to
the crawl.

## Files

```
take.mjs      the shots, with their framing. Pictures of the overlay itself.
store.mjs     the listing images, composed from those pictures
store/        tiles.html holds the words and the layout; the PNGs are its output
collect.mjs   one game's inputs, from the endpoints scrape.js and the worker read
serve.mjs     the repo over HTTP, with the headers a store page needs to import it
page.js       page side: the chrome.* shim, then the real core and the real overlay
browser.mjs   a headless Chrome over CDP, for the length of one page
inputs/       what collect.mjs wrote, and what the committed pictures were drawn from
```

The three games are chosen for what each one can show: Tactical Breach Wizards
is released and paid with a full player history, Haunted Paws is unreleased and
ranked with a figure its studio published, and The Wandering Village has both a
review count and a discount history that move the multiple, so its multiplier
chain has steps in it rather than being a bare band.

## What the store requires

| File | Size | Why it exists |
| --- | --- | --- |
| `1-glance` … `5-sources` | 1280 x 800 | the listing carousel; five is the maximum |
| `promo-small-440x280` | 440 x 280 | **required.** Listings without one are shown after listings with one |
| `promo-marquee-1400x560` | 1400 x 560 | optional, and what a featured placement needs |

All of them JPEG or a 24-bit PNG with **no alpha channel**. So they render at a
device scale factor of 1 — the pixel size is the specification here, and a 2x
capture is rejected — and `store.mjs` checks the dimensions and the PNG colour
type of every file before writing it. Chrome emits 24-bit RGB for a page that
paints an opaque background, which `tiles.html` does; a transparent one would
come back as RGBA and fail at upload rather than here.

The carousel scales every screenshot to one height and fits as many as the row
allows, so two 1280 x 800 shots sit side by side; a listing showing one is a
listing with one uploaded, not one with the wrong size.

## What the other two listings ask for

`--opera` and `--firefox` write the same five tiles at a second size, into
`store/opera` and `store/firefox`. Each size is an exact fraction of the
Chrome tile — five eighths, 800 x 500, for Opera's 800 x 600 ceiling; five
fourths, 1600 x 1000, for AMO — so the words are typeset once, at the size
they were written for, and only the capture changes. Neither listing takes a
promotional tile of Chrome's kind; Opera's own 300 x 188 image is laid out at
that size in `tiles.html` and comes out of `store.mjs` like any other tile,
and its 64 x 64 icon out of `icon-64.mjs`.

AMO's maximum, and its recommendation, is 2400 x 1800; 1600 x 1000 stops short
of that deliberately. The photographs inside the tiles were captured at a
device scale factor of 2, and 1.25 is where the tightest of them runs out of
real pixels — `steam-page-wide.png` is 1480 of them wide in a 1180px frame.
Past 1.25 a tile stops being a photograph and becomes an enlargement of one,
and AMO takes any size up to its maximum.

AMO also asks for a caption per screenshot, which nothing in the tile itself
carries:

| File | Caption, English (US) |
| --- | --- |
| `1-glance` | The collapsed pill on a Steam store page: English reviews, units sold, gross revenue. |
| `2-ranges` | The panel open: units, gross and developer net, each a range, with the methods that produced it. |
| `3-waterfall` | Where the money goes: discount, regional pricing and VAT, refunds, then Valve's tiered royalty. |
| `4-wishlists` | An unreleased game: wishlists from a published figure, the store's ranking and the follower count. |
| `5-sources` | Why this multiplier: the band for the release year, what moved it, and the studies behind it. |

Crops are taken on block boundaries rather than by eye. Inside `released.png`
the panel's blocks run head 0-64, units 64-165, gross 165-318, net 318-419,
followers 419-555, reviews 555-679, players 679-833, in the CSS pixels the
overlay was laid out in — every frame height in `tiles.html` lands on one of
those numbers, so nothing is ever cut through a row of figures.

Headlines are set in Segoe UI Variable Display, which ships with Windows 11.
Elsewhere they fall back to Segoe UI and then to the platform's UI face, so
tiles rendered on another machine will not match the committed ones exactly.

## Two things Chrome has to be told

A store page cannot load either the overlay or the figures on its own, and both
refusals are the browser doing its job:

- **`script-src 'self'`** in Steam's CSP blocks the import. `Page.setBypassCSP`
  turns the page's policy off for the tab that is being photographed.
- **Loopback is a private network** to a page served from the public internet,
  so `http://127.0.0.1` is refused before the file is read. The launch disables
  `LocalNetworkAccessChecks` and the permission is granted for the store origin
  over CDP.

Neither is a workaround for something the extension needs; both exist only
because a screenshot runs the extension's code from outside the extension.

## What is not photographed

The local trend line, which needs two visits days apart to say anything. A
series faked to produce one would be the only invented number in these
pictures.

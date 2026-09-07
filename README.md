# Wishlytic — Steam Revenue & Wishlist Estimator

A Chrome extension that estimates units sold, developer revenue and wishlists on any Steam store page.

It shows ranges, not single numbers, and every coefficient it uses is traceable to a published study — or, where a study established an effect without sizing it, marked as our own judgement.

## Why another one of these

There are several free Steam revenue extensions. They share three problems:

1. **A single number.** The underlying multiplier spans 20x to 55x for a modern release. Presenting one figure hides a 2.75x spread that the reader then treats as a fact.
2. **A flat 30% for "net revenue".** Valve's cut is tiered (30/25/20) and is charged on adjusted gross — after VAT, refunds and chargebacks — not on the sticker price. Skipping regional pricing and discounts on top of that inflates the result by roughly 60%.
3. **No published accuracy.** None of them says how often it is right, so neither do their users.

This one takes the opposite position on all three.

## What it does

| Metric | Method | Availability                                                       |
| --- | --- |--------------------------------------------------------------------|
| Units sold, lifetime | Weighted ensemble of an adjusted review multiplier and the SteamSpy owner band | Released games with 10+ reviews                                    |
| Developer net revenue | Full waterfall: discount → regional and VAT → refunds → tiered royalty | Paid games                                                         |
| Wishlists, pre-launch | Three marks, each weighted by the width of its own band: a figure the developer published about this game, carried forward at the measured growth rate; the game's place in Steam's wishlist ordering through a curve measured on announced figures; followers × 9.6–32.8 | Unreleased games with a follower count, a ranked position, a published figure, or any of them |
| Week-one sales | Two published routes shown side by side, never averaged | Unreleased games                                                   |
| Player-count cross-check | All-time peak concurrent × 11.4, kept outside the average | Games whose peak was set at launch                                 |
| Player-hours cross-check | Measured player-hours ÷ an assumed average playtime, kept outside the average | Games with a concurrent-player history                             |
| Local trend | Snapshots of your own visits, stored on this device only | After two visits                                                   |

Every figure comes with a scale showing the low and high end. The width of that bar is the point. Where several methods contribute, each one leaves a tick mark on that scale, so you can see how far apart they landed before they were averaged.

## Honest limits

**Where the ceiling is.** Published benchmarks put a flat review multiplier at 42.7% of games within 30% error, adjusted multipliers at 50.4%, concurrent players over playtime at 64.4%, and a full ensemble at 76.9%. Two legs of that ensemble need infrastructure a browser extension does not have: continuous sampling of millions of Steam profiles, and years of daily top-seller snapshots. A third is reachable only in half — the player-hours are exact and the average playtime they must be divided by is not published anywhere, so it runs as a cross-check with its assumption on show. That leaves two estimators in the average and puts the ceiling in the middle of that table, not at the top.

**Disagreement is never averaged away.** When no figure satisfies every method, the band expands to cover all of them and the confidence drops. A tidy midpoint between sources that exclude each other is worse than no answer — but sources whose ranges overlap are not in disagreement, however far apart their centres sit, and treating them as though they were would collapse the whole scale onto one word.

**Confidence scores the evidence, not the width of the bar.** Every band here is dominated by a fixed published range, so the width barely varies, and a verdict read off it would be a constant: units could never reach the top, revenue would read *unreliable* on every paid game ever released, and wishlists *rough* on every unreleased one. A rating that never varies is a label. The word reports how many independent methods agree and how much of the chain was measured rather than assumed. The width is the bar itself, which is already on screen.

**Wishlists are the softest number here.** Steam publishes no wishlist counts for anyone. Three marks answer. One is a fact about the game — a figure its own studio posted on its own store page, carried forward to today — and it exists for about one ranked game in nine. The other two are inference: the store's own ordering of unreleased games by wishlists, positions with no numbers attached, read through a curve fitted to those announced figures; and the member count of the hidden group you join by following a game. Held out of its own fit, the model's median error is 12.3% on a figure posted in the last month and 21.9% on one of any age.

**After release the wishlist estimate is withheld entirely.** Wishlists are consumed by purchases while followers persist, and the total balance typically peaks at 2–4x the pre-launch count before decaying. No stable ratio survives that, so the extension shows the follower count and declines to convert it.

**Under 10 reviews there is no estimate.** Ten is the point at which Steam itself begins scoring a game, and below it one more review moves the answer by a tenth. The extension says so instead of printing a number.

**Only base games get numbers.** Steam serves DLC, soundtracks, videos, demos and hardware from the same `/app/` path, and the review multiple was measured on none of them. Each is declined with its own reason rather than a blanket "unsupported" — a soundtrack is unmeasured, a demo has no sales at all, and a Steam Deck is not sold under the revenue share. Demos are the one case with a better answer than a refusal: Steam names the game a demo belongs to, so the panel shows that game's figures and says it is doing so.

## Install

Not on the Chrome Web Store yet. The release is gated on publishing an accuracy figure: shipping an uncalibrated estimator is how the existing tools ended up with reviews saying they underestimate by two to three times.

```bash
git clone https://github.com/q-sn/steam-revenue-wishlist-estimator.git
```

Then open `chrome://extensions/`, enable Developer mode, click **Load unpacked**, and select the folder. Visit any `store.steampowered.com/app/...` page.

No build step, no bundler, no dependencies.

## Layout

```
src/core/          pure estimators, no browser APIs — Node imports these unchanged
  constants.js     every coefficient, with the study it came from
  units.js         adjusted Boxleiter, owner bands, CCU and player-hours cross-checks
  ensemble.js      weighted geometric combination and confidence scoring
  revenue.js       the waterfall and Valve's tiered royalty
  wishlists.js     the three wishlist marks, and both week-one routes
  wishlist-rank.js a place in Steam's wishlist ordering, read as a count
  wishlist-said.js a figure the developer announced, carried forward to today
  history.js       local snapshot series and visit-to-visit diffs
src/content/       page scraping and the Shadow DOM overlay
src/background/    cross-origin fetches, caching, local history
docs/METHODOLOGY.md  every formula and what it is worth
.github/workflows/
  wishlist-ranks.yml      the daily job that publishes both wishlist files
tools/
  calibrate.mjs                 accuracy harness
  calibrate-wishlist-model.mjs  the whole wishlist model, refit from the archive
  calibrate-follower-ratio.mjs  where the follower multiplier is measured
  crawl-wishlist-ranks.mjs      one snapshot of Steam's wishlist ordering
  harvest-anchors.mjs           wishlist numbers developers announced themselves
  condense-anchors.mjs          the archive, cut to what a browser needs
  merge-anchors.mjs             two copies of the archive, unioned on publish
  build-locales.mjs             _locales/ from tools/locales.source.json
  smoke.mjs                     offline checks
```

The wishlist-ranking tools run in CI, not on anyone's machine. `data/` is where they write locally and is git-ignored; the published files live on the `data` branch.

The core deliberately has no browser dependencies. That is what lets the calibration harness test the exact code that ships, rather than a reimplementation of it that drifts.

## Development

```bash
npm run smoke                 # offline checks, run before every commit
npm run calibrate:live        # accuracy against games with disclosed sales
npm run ranks                 # snapshot Steam's wishlist ordering
npm run anchors               # collect wishlist numbers developers posted
npm run condense              # cut the archive to what a browser needs
npm run check:model           # refit the wishlist model from that archive
npm run check:ratio           # re-measure the follower multiplier
```

`npm run check:model` exits non-zero when a constant in `src/core/constants.js` stops reproducing from the archive, so a drifting fit fails rather than passing quietly.

`test/fixtures.json` holds 62 games whose developers published real unit counts, each with the review count and positive share of its announcement day frozen into `snapshot`. Those come from `store.steampowered.com/appreviewhistogram/<appid>`, which returns a game's whole review history in one keyless request. Live mode still exists and still compares today's review count against a figure announced in the past, so it is biased toward overestimating and prints a warning saying so; the frozen run is the one to read. More games remain the single most valuable contribution to this project — the set is thin below a thousand copies and thinner still before 2020.

## Languages

English, Russian, Simplified Chinese, Spanish, Brazilian Portuguese, German, French, Japanese, Korean, Turkish, Polish and Italian. The extension follows your browser's UI language, and numbers are formatted with `Intl` so they read naturally in each one.

Translations live in a single master table at `tools/locales.source.json`. Adding a string means editing one file, not twelve:

```bash
node tools/build-locales.mjs          # regenerate _locales/
node tools/build-locales.mjs --check  # validate without writing
```

The build refuses to run if a locale is missing a key or if a translation dropped a `$1` placeholder, which is how a number silently disappears from a sentence.

## Privacy

No account, no telemetry, no analytics, no network calls to anything but Steam, SteamSpy and SteamCharts. Every lookup is cached before it is repeated, so a game costs a handful of requests per day rather than per page view. Visit snapshots and cached lookups live in `chrome.storage.local` and can be wiped from the options page.

## Contributing

One rule above the others: **no coefficient without a source.** `src/core/constants.js` pairs every number with the study it came from, and marks the ones whose *size* is our own judgement rather than a published figure. A number you cannot cite does not belong in a tool that claims to be honest about its uncertainty, and a number that looks cited when it is not is worse.

Full guidelines in [CONTRIBUTING.md](CONTRIBUTING.md). The methodology behind every formula is in [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## Credits

The coefficients here are other people's research. Jake Birkett, Simon Carless at GameDiscoverCo, Karl Kontus at Video Game Insights, and the Gamalytic team all published the studies this tool depends on, and all of them published their limitations too. Full citations with links are in `src/core/constants.js`.

Not affiliated with Valve. Steam is a trademark of Valve Corporation.

## Licence

MIT

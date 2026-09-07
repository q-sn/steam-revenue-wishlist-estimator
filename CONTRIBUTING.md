# Contributing

## The one rule

**No coefficient without a source.**

Every number that influences an estimate lives in `src/core/constants.js` and carries a `source` key pointing at an entry in `SOURCES`, which in turn carries a link and a note on what the study actually measured.

If you cannot cite where a number came from, it does not belong in a tool whose entire pitch is being honest about its uncertainty. A plausible-looking constant with no provenance is worse than no constant at all, because it inherits the credibility of the ones around it.

This applies to changing existing numbers too. "This felt too high" is not a source.

### The second half of the rule

Some studies establish that an effect exists and leave its size for later. VGI's 2021 paper says higher-priced games have lower multiples and that MMOs run higher, and then says the quantification is still to come; Gamalytic presents genre as a chart with no table.

A coefficient expressing one of those carries **`derived: true`** alongside its `source`. That marks the difference between "the survey measured this" and "the survey measured that this exists, and we sized it ourselves", and the "why this number" panel shows it to the reader with an asterisk.

Do not drop the flag to make a row look better sourced. Do drop it if you find a study that actually publishes the figure — and update the `source` when you do.

### Measuring one yourself

Several coefficients here are measured rather than cited: the wishlist model in `WISHLIST_CURVE` and `WISHLIST_SAID`, the follower ratio in `WISHLIST`, and the reviewer-playtime correction in `PLAYTIME.biasRange`. If you add another, it needs the same treatment — a derivation from public data, a `SOURCES` entry naming that data, and the resulting distribution written into the note. A measurement that will be repeated as new data arrives earns a script in `tools/`; a one-off keeps its numbers in the `SOURCES` note.

`tools/calibrate-wishlist-model.mjs` is what a repeated measurement should look like. It refits every wishlist constant from the raw archive and exits non-zero when a shipped value stops reproducing, so a constant cannot quietly drift away from the data it was measured on.

`SOURCES.OURS_OWNER_QUALITY` is the other half of that idea: it does not set a coefficient, it records whether a source deserves the weight it has. SteamSpy is the one estimator here with no published accuracy figure, so its behaviour was measured against disclosed sales instead of assumed. Any claim in the docs about how good a source is should have a measurement behind it.

Read what that one measures before reasoning your way to a number. "Reviewers play far more than the average owner" is true, and the correction it suggests is wrong by a factor of three.

### Data the extension does not fetch itself

`src/core/wishlist-rank.js` reads a game's place in Steam's wishlist ordering out of a file, not off the network, and `src/core/wishlist-said.js` reads the archive of developer announcements the same way. Both files are built by `.github/workflows/wishlist-ranks.yml`, published to the `data` branch, and downloaded by every installation once a day.

The rule behind that split is worth stating, because the next signal like it will face the same choice. **Anything whose cost is per-catalogue rather than per-page belongs in CI.** Reading that ordering is 56 requests; a per-page lookup is one. Fifty-odd requests times every user times every day is a load no free endpoint should be asked to carry, and the first consequence of asking is losing the endpoint.

If you add a signal of that shape:

- The crawler must refuse to publish a partial result. Steam signals throttling as HTTP 200 with an empty body, so an incomplete answer looks exactly like a real one and quietly changes every number downstream.
- Pin the axis it is read on. The ordering is crawled with `ignore_preferences=1` and a fixed region, because Steam's default content preferences hide 415 of the 5,574 positions and hide them unevenly. A default-axis snapshot is a compressed copy of the real ordering, and it would move under a curve fitted to it whenever Valve changed a default.
- The consumer in `src/core/` must know how old its input is and refuse it past a stated age. A wrong figure reads as authoritatively as a right one.
- Say what happens when the file is missing. A game absent from a list is not the same fact as a list that never arrived, and conflating them turns "we do not know" into a claim.

## Language

All code, comments, commit messages, documentation and user-facing strings are in English. Issues and discussions can be in any language.

## Architecture rules

**`src/core/` must not touch browser APIs.** No `chrome.*`, no `document`, no `window`, no `fetch`. The core is imported unchanged by `tools/calibrate.mjs` running in Node, and that is the only thing keeping the calibration harness honest — the moment the core needs a browser, the harness starts testing a reimplementation that quietly drifts from what ships.

Network access belongs in `src/background/`. DOM access belongs in `src/content/`.

**Estimators of different quantities are never averaged.** The peak-CCU rule predicts week-one sales; the review multiple, the owner band and the player-hours route all predict lifetime units. Mixing the two kinds produces a number that means nothing. Cross-checks may widen a band or lower confidence, never move a midpoint.

**A source excluded from the average is excluded from the veto.** If a signal is too weak to contribute, it is too weak to overrule. Anything else means a game scores worse for having data than for having none.

**Read the game, not the calendar.** Anything describing what a game *is* — its price point, its genre, its audience — reads the list price and the lifetime totals. Only signals genuinely about today read today's numbers. Reading `price_overview.final` as the list price moves the revenue estimate by 2.5x for the length of every sale.

**Before reaching for a DOM selector, check whether an API answers the question.** A store page answers in the present tense — whether a bundle is on offer today, whether a festival is running right now — while most coefficients ask about a game's whole history. A selector standing in for a historical fact is wrong in one direction and blind in the other: it fires on games that merely qualify today and misses every game that qualified last year.

**Gates fail closed.** A guard that exists to stop a confidently wrong number must refuse when it cannot tell. An unreadable release date is exactly when the week-one rule is least safe to apply, so that is where it declines rather than proceeding.

**No point estimates in the UI.** Every figure ships with its range. This is not negotiable; it is the product.

## Before you open a pull request

```bash
npm run smoke
```

All checks must pass. If you changed a coefficient, also run the harness that covers it and say in the PR what happened to the accuracy figure:

```bash
npm run calibrate:live   # units and revenue, against disclosed sales
npm run check:model      # the wishlist model, against the announcement archive
```

## The most valuable contribution

Fixtures with frozen snapshots.

`test/fixtures.json` holds games whose developers disclosed real unit counts. Every entry now carries a snapshot, reconstructed from `store.steampowered.com/appreviewhistogram/<appid>`, so the harness scores each game on what its store page showed the day the figure was published rather than on today's review count. `reviewsAsRead` on each row keeps the raw histogram and API counts and the `k` that scaled between them, because that scaling is an estimate and a reader should be able to undo it.

A snapshot captured at the moment a developer announces their numbers fixes that permanently:

```json
{
  "appId": 123456,
  "name": "Some Game",
  "reportedUnits": 42000,
  "reportedAt": "2026-09-04",
  "snapshot": {
    "reviews": 1180,
    "positivePct": 94,
    "price": 19.99,
    "releaseYear": 2025,
    "isFree": false,
    "tags": ["Roguelike", "Deckbuilder"]
  }
}
```

Every snapshot makes the accuracy figure in the README more trustworthy. Nothing else in this repository moves that needle as directly.

## Translations

Everything user-facing lives in `tools/locales.source.json`, one entry per key with all locales inline. Edit that file and run:

```bash
npm run locales
```

Commit both the source table and the regenerated `_locales/`.

Two rules the build enforces for you: every locale needs every key, and placeholders like `$1` must survive translation. You may move a placeholder anywhere in the sentence that the target language needs, but you cannot drop it.

To add a thirteenth language, append its code to `_locales` at the top of the source table and fill in the column.

## Also welcome

- Published magnitudes for any coefficient currently marked `derived: true`
- Steam top-seller rank, the one reachable-looking method still unimplemented
- Bug reports where the estimate was badly wrong **and you know the real number**
- Store-page selector fixes when Valve changes the markup
- Anything that makes an assumption more visible to the reader

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

One coefficient here is measured rather than cited: the reviewer-playtime correction in `PLAYTIME.biasRange`. If you add another, it needs the same treatment — a script in `tools/` that reproduces it from public data, a `SOURCES` entry pointing at that script, and the resulting distribution written into the note.

`tools/calibrate-owners.mjs` is the other half of that idea: it does not set a coefficient, it checks whether a source deserves the weight it has. SteamSpy is the one estimator here with no published accuracy figure, so its behaviour is measured against disclosed sales instead of assumed. Any claim in the docs about how good a source is should have a script behind it.

Read what that one measures before reasoning your way to a number. "Reviewers play far more than the average owner" is true, and the correction it suggests is wrong by a factor of three.

### Data the extension does not fetch itself

`src/core/wishlist-rank.js` reads a game's place in Steam's wishlist ordering out of a file, not off the network. The file is built by `.github/workflows/wishlist-ranks.yml`, published to the `data` branch, and downloaded by every installation once a day.

The rule behind that split is worth stating, because the next signal like it will face the same choice. **Anything whose cost is per-catalogue rather than per-page belongs in CI.** Reading that ordering is fifty requests; a per-page lookup is one. Fifty requests times every user times every day is a load no free endpoint should be asked to carry, and the first consequence of asking is losing the endpoint.

If you add a signal of that shape:

- The crawler must refuse to publish a partial result. Steam signals throttling as HTTP 200 with an empty body, so an incomplete answer looks exactly like a real one and quietly changes every number downstream.
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
node tools/smoke.mjs
```

All checks must pass. If you changed a coefficient, also run the calibration harness and say in the PR what happened to the accuracy figure:

```bash
node tools/calibrate.mjs --live
```

## The most valuable contribution

Fixtures with frozen snapshots.

`test/fixtures.json` holds games whose developers disclosed real unit counts. Most entries have `snapshot: null`, which forces the harness into live mode, comparing today's review count against a figure announced years ago — biased and clearly labelled as such.

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
node tools/build-locales.mjs
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

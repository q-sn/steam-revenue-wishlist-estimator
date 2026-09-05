# Methodology

How every number in this extension is produced, and what each one is worth.

Almost nothing here is original research. It is an implementation of published work by Jake Birkett, Simon Carless at GameDiscoverCo, Karl Kontus at Video Game Insights, and the Gamalytic team. Full citations with links live in [`src/core/constants.js`](../src/core/constants.js). The figures measured here rather than cited are the wishlist model, the announcement floor, the growth term, the follower ratio, the reviewer-playtime correction and the quality of the SteamSpy owner band; each has a `SOURCES.OURS_*` entry recording how.

## Why estimates exist at all

Valve publishes no sales figures. Reviews, follower counts, concurrent players and store rank are public; units, revenue and wishlists are not. Every tool in this category infers the private numbers from the public ones, and the whole game is knowing how much error that inference carries.

## The accuracy ceiling

Gamalytic benchmarked five methods against roughly 120 games whose real sales were publicly disclosed, excluding games that sold under 1,000 copies:

| Method | Within 30% error | Within 50% error |
| --- | --- | --- |
| Flat review multiple | 42.7% | 70.9% |
| Review multiple adjusted by year, price, score | 50.4% | 80.3% |
| Steam top-seller rank | 61.4% | 86.0% |
| Concurrent players + average playtime | 64.4% | 93.3% |
| Public profile polling | 77.9% | 97.7% |
| **All of the above, weighted** | **76.9%** | **99.2%** |

Two conclusions shaped this project.

First, **no single method is good**. Even the best one misses by more than 30% on a fifth of games. Any tool showing a single confident number is misrepresenting its own accuracy.

Second, **combination beats any component**. That is why this extension runs an ensemble rather than picking a favourite.

Of the five, profile polling and historical top-seller rank are out of reach: one means sampling millions of Steam profiles continuously, the other means recording the charts daily for years. Two of the remaining three are implemented as estimators. The concurrents-over-playtime method is implemented as a cross-check, because the half of it we can measure is exact and the half we cannot is the half that sets the answer — see below.

## Units sold

Two estimators are averaged, and both of them measure lifetime units on inputs we can specify. A third method measures the same quantity on an input we cannot, and is kept outside the average for that reason.

### Reviews, adjusted (primary)

The Boxleiter method: multiply public review count by a ratio representing how many buyers each reviewer stands for.

The ratio is not a constant. Steam added a review prompt in late October 2019, which roughly halved it. Video Game Insights found a correlation above 90% between reviews and units across a 10,000-game dataset, with a regression on reviews, release year and free-to-play status reaching an adjusted R² of 78% — release year matters nearly as much as the review count itself.

Base bands by release year, blending VGI's per-year distributions with GameDiscoverCo's 237-game developer survey:

| Released | Range | Point |
| --- | --- | --- |
| 2020 and later | 20–55x | 30x |
| 2019 | 30–70x | 51x |
| 2017–2018 | 35–85x | 65x |
| 2014–2016 | 40–100x | 74x |
| Before 2014 | 40–110x | 80x |

Pre-2017 rows are the softest. Gamalytic points out the ratio really tracks *the year each review was written*, and old games kept accumulating reviews after the 2019 prompt landed, so their lifetime ratios drift downward over time.

Multiplicative adjustments on top:

- **Free to play, ×2.0.** Free games get roughly twice as many downloads per review.
- **Price.** Under $10 ×1.15, over $30 ×0.85. Read from the **list price**, never from the price on the page today — see "list price versus sale price" below.
- **Review score.** The curve is non-monotonic: games above 90% positive sit near 30 sales per review, games around 70% climb to roughly 60, and games below 60% fall back toward 30. Apparently the share of players who write negative reviews is fairly constant, while the share writing positive ones rises with how much they enjoyed it. Our coefficients are damped relative to the raw study medians because the base table already reflects a sample skewed toward highly-rated games.
- **Review count.** Games under 100 reviews sit at 36x against 52.8x for games with 1,000 to 10,000 — the mid-size band is 1.47x above the small one. That ratio is from Gamalytic's 2023 dataset, whose overall median is about 35x and so cannot be dropped in beside a base table blended from other vintages. The *shape* carries over, anchored at the geometric centre of the published pair (×0.83 and ×1.21), so the table changes the spread between sizes without moving the overall level. Above 10,000 reviews the sources say the ratio falls again but publish no median, so it returns to neutral.
- **Genre.** MMO ×1.3, visual novel ×1.5, sports and racing ×0.8. One adjustment only, and it is the game's own highest-ranked matching tag: Steam orders store-page tags by how many players applied them, so that order is a signal where the order of our table is not.
- **Heavy discount, ×1.2.** Players who bought on sale review less often.

Several of those magnitudes are ours rather than the studies'. Each is marked in the code and in the panel; see "sourced direction, our magnitude" for the list and the reasoning.

### Player-hours over playtime (a cross-check, not a leg)

Gamalytic's second-strongest method, at 64.4% within 30% error: add up concurrent players over time for total player-hours, then divide by the hours an average owner puts in.

The first half we have exactly. SteamCharts publishes average concurrents per month for a game's whole life, on the page already fetched for the peak, and summing it is arithmetic. Enshrouded has 334 million player-hours on the record.

The second half is the average playtime of everyone who owns the game, and we cannot get it. SteamSpy returns zero for every app. What is free is the playtime attached to each review, and a review sample is not the owner population — in two compounding ways.

**The newest reviews are the newest buyers.** The hundred most recent reviews of Enshrouded span three days. Their median playtime is 41.7 hours. Reviewers from the game's launch quarter, measured today, have a median of 100.5 hours. For a game two and a half years old the owner population is mostly people who bought long ago and accumulated time, and sampling the newest reviews measures whoever bought this week. This is the same error as sampling recent reviews for the language mix, in the same function.

**The quantity needed is a mean.** Total hours divided by owners is a mean by definition, and playtime distributions have a long enough tail that the mean sits far above any median — 96.7 against 41.7 hours on that same sample.

A correction for all this was measured, and it does not transfer. It compares playtime-at-review in the 90 days before each disclosure against the true average at that date, over 26 games: min 0.50x, median 1.09x, max 2.07x. That is a coherent measurement, and the estimator applies it to a different quantity at an arbitrary game age. The measurement's own numbers say why it fails — the correction falls with a game's age, 0.50x for Stardew Valley at six years and 0.55x for Garry's Mod at fifteen, and one global constant papers over that so thoroughly that its middle-80% band does not contain either game.

Alternative specifications do no better. None of four tried on five games was consistently closer, and the only yardstick available is whether the answer matches the other two estimators — which is fitting an independent method to the ones it exists to be independent of.

So the honest reading is that Gamalytic's 64.4% belongs to *their* playtime estimate, drawn from profile data we do not have. Their article says as much: accuracy "depends completely on the average playtime estimate". Claiming that figure for this implementation would be unearned.

What remains is worth showing and is shown, in its own panel, with the divisor named: measured player-hours, an assumed average playtime, and the owner count that follows. It can widen a band and lower confidence. It never moves the midpoint.

Averaged in at half weight it would decide the result rather than check it: across 22 real games it is the high outlier on 9 of them, it would be the sole cause of 7 of the 8 recorded disagreements, and Enshrouded would read *unreliable* on its account alone.

### Owner bands (secondary)

SteamSpy samples public Steam profiles at 98% confidence. Valve made game libraries private by default in April 2018 and the sample never recovered, so bands spanning 2x are normal and small games are worst affected.

Owners are also not sales: the band includes free keys, giveaways, review copies and bundle purchases. The share to remove is read from the reviews API, which reports for each review whether its author bought the game on Steam or activated a key. Gamalytic names exactly this ratio as the signal for telling sold copies from given-away ones. It is clamped to 0.5–0.98, because reviewers are not a random sample of owners and key recipients review less often than buyers. A bundle widget in the purchase block cannot stand in for it: that says whether a bundle is on offer today, while the factor is about every key ever handed out.

Weight scales with size — zero below 20,000 owners, rising to 0.8 above 200,000. Below that floor the sample is too thin to contribute anything but noise.

### How good is the owner band, actually

It is the only leg here with no published accuracy figure. SteamSpy states its method — extrapolation from a sample of public profiles at 98% confidence — and that the April 2018 privacy change cost it most of its sample, but nobody has published a post-2018 error rate for it. So it is measured here, the same way the playtime correction is.

SteamSpy's bucket was compared against the units the developer disclosed, for each of the 30 games in `test/fixtures.json`. Owners can only ever exceed units sold, and a mean of 4.5 years has passed since those announcements, so the current bucket should comfortably contain or exceed every figure. What comes back:

| disclosed size | n | min | median | max |
| --- | --- | --- | --- | --- |
| 1M and above | 12 | 0.63x | **1.58x** | 7.07x |
| 100k to 1M | 12 | 1.41x | **3.39x** | 14.14x |
| under 100k | 6 | 0.21x | **4.18x** | 15.81x |

The ratios are bucket midpoint divided by disclosed units. Read the top row as the case for keeping this leg: a median of 1.58x over four and a half years of continued selling is a reading consistent with reality. Read the bottom row as the case for its weight reaching zero — and it is worse than a wide range, because Handshakes disclosed 60,000 units and sits in the `0 .. 20,000` bucket, which is not imprecise but impossible.

The weight curve is checked for direction against this table and deliberately not fitted to it. The test is one-sided: it can prove a bucket too low and never too high, because nobody knows what these games have sold today.

### An empty record is not a small game

SteamSpy answers for any app id it has heard of, including ones it has never processed. An unprocessed record looks like this:

    owners: "0 .. 20,000"   ccu: 0   positive: 0   negative: 0

Which is indistinguishable from a genuinely tiny game unless you read its own review tally. Sampled across 18 games, three had records like that — and not small ones: PEAK with 367,166 Steam reviews, Escape from Tarkov with 63,709, The Ember Guardian with 289.

The numeric outcome is the same either way, since that bucket carries no weight and never enters the average. What is at stake is the explanation: "single method, no cross-check available" is the wrong sentence for a game this source has never looked at. Those are different situations with different fixes — one is a fact about SteamSpy, the other a fact about the game's size, and a third possibility is that the request simply failed.

So the record's own review count is read alongside the owner band. Zero, on a game Steam says has enough reviews for us to be estimating at all, means the record is a placeholder, and the panel says so. The three cases read differently:

| what happened | what the panel says |
| --- | --- |
| SteamSpy has never processed the app | SteamSpy has no data on file for this game |
| the bucket is real but under 20,000 owners | SteamSpy's owner band is too small to trust |
| the request failed or returned nothing | Single method, no cross-check available |

This is also why "single method" is common on new and small releases. The owner band is the only second opinion available, and SteamSpy supplies it late or not at all for recent launches — which is exactly the population the review multiple is weakest on.

### The buckets are a ladder, and midpoints of ladders are not readings

The keyless API answers on fixed rungs — 20k, 50k, 100k, 200k, 500k, 1M, 2M, 5M and so on — so every bucket is exactly 2x or 2.5x wide, which is what the tool above reports and all it ever reports. Every game between 20 and 50 million owners gets the same reported band and therefore the same midpoint, 31.6 million.

This is not a rounding detail. It is the reason agreement between estimators is judged on whether their bands overlap rather than on how far their midpoints sit apart, and that distinction is worked through under Confidence below.

### Combining them

Midpoints combine as a **weighted geometric mean**. Sales estimates are multiplicative quantities with a roughly log-normal spread; an arithmetic mean would bias every result upward.

When the estimators leave no figure that all of them admit, the band expands to cover all of their ranges and confidence drops. Showing a narrow band around sources that exclude each other would actively mislead.

Agreement is a question about intervals, because every estimator here reports one. If the bands share a region there is no conflict, however far apart their midpoints happen to sit. Judging by midpoint ratio against a 1.5x threshold makes Baldur's Gate 3 read as a 1.9x disagreement between three bands that all admit 17.2M to 20.1M, widening the band to cover a conflict that does not exist — the offender is the owner leg, whose midpoint is the centre of a 20M-50M rung rather than a reading of the game. Judging by overlap, the same three bands agree and the game reads reliable.

## Cross-checks that never enter the average

**Peak concurrent players.** Week-one units ≈ peak CCU × 11.4, or ×14.1 without pre-orders and ×7.8 with them, from GameDiscoverCo's study of the top 50 Steam debuts of March 2025. Variance is 50% or more in both directions.

This predicts *week-one sales*, not lifetime units. Averaging it into a lifetime figure would be a category error, so it can only widen the band and lower confidence.

Two traps are worth naming.

The multiplier is calibrated on the **all-time** peak. Against the day-one peak the same study reports quite different medians — 21.8x overall, 14.1x without pre-orders, 15.4x with — so the two sets are not interchangeable. Feeding all-time multipliers a *yesterday's* peak from SteamSpy is the mismatch to avoid: that figure coincides with the launch peak for about a fortnight and then diverges without limit. Gating the rule to games under 60 days old papers over that; passing it the number the study measured answers it. The all-time peak is on the SteamCharts page we already fetch.

The second trap is that the all-time peak is only the launch peak while nothing has beaten it. Stardew Valley's record is from March 2024, eight years after release; running a week-one rule on that produces a confidently wrong figure that errs high. Which month the peak fell in is readable from the same monthly table, so the rule applies only when the peak sits within 60 days of release, and says how late the peak was when it does not.

With no readable release date or no monthly history the rule declines. A guard firing only on a *known* out-of-window date would fail open on exactly the pages it exists for, which is the one direction a guard against a confidently wrong number must never fail in.

**Owners are not a ceiling.** A third check suggests itself here and is deliberately not made.

Owners bound units in principle, so an estimate above the top of the SteamSpy band looks like a nameable inconsistency. It is not one. SteamSpy publishes a bucket spanning 2x or more, drawn from a profile sample that collapsed in 2018 and reads low — so its upper edge is the boundary of a wide guess rather than a fact about how many copies exist, and the likeliest explanation for a breach is that the bucket is low. The modest weight the band already carries is the honest way to handle that.

Such a check would also be redundant. The owner band is one of the estimators being averaged, so whenever the others clear its top the disagreement metric has already noticed and named both figures. A ceiling flag would add a second, vaguer sentence about the same fact — and by forcing the level rather than nudging it, let one fact decide the verdict twice.

## Revenue

The most common error in free Steam tools is `units × price × 0.7`. It is wrong three times over: it ignores discounting and regional pricing, it uses a flat 30% when the rate is tiered, and it applies that rate to the sticker price when Valve charges it on adjusted gross.

The chain, with each factor compounding:

```
net = units × list price
    × (1 − average_discount)
    × regional_factor
    × (1 − refund_rate)
    × (1 − steam_tier)
```

**Average lifetime discount, default 20%.** Most copies of most games sell below list eventually.

**Regional factor.** The combined effect of regional pricing and VAT on realised price. Following Steam's suggested prices costs roughly 22% against the US list price, which is the 0.78 a globally distributed release carries; a US/EU-concentrated audience keeps 0.88, and one genuinely concentrated in China, the CIS, Latin America and Southeast Asia lands nearer 0.60.

By default this is **read from the game's own reviews** rather than asked. The reviews endpoint takes a comma-joined language list and returns the union, so the share of a game's lifetime reviews written in the languages of low-price markets costs a single request. Under 20% reads as US/EU, 20–50% as mixed, above 50% as emerging. Stardew Valley comes out at 41%.

It is a proxy and is presented as one. Review propensity differs by market — Gamalytic found the demographic correlation real but not statistically significant — so the mix picks between the three published profiles rather than becoming a factor of its own, and the dropdown still overrides it. Sampling the most recent hundred reviews instead of taking lifetime totals put Stardew at 71%, because where a game sells today is not where it has sold.

**Refunds, default 9.5%.** A 2024 GameDiscoverCo survey of around 150 developers found a median of 9.5% and an average of 10.8%, with an Early Access median of 12.4% and Chinese-market rates of 15–28%. The earlier No More Robots portfolio piece reports 5–8% by units and 6.5–11% by revenue, with monthly extremes of 3% and 17%. The 6%–13% envelope is that span.

**Valve's royalty: 30% on the first $10M, 25% from $10M to $50M, 20% above.** Per app, marginal not retroactive, effective on sales from 1 October 2018, and the threshold counts the app together with its DLC, in-game sales and Community Marketplace fees. Adjusted gross revenue is gross less VAT, sales tax, refunds and chargebacks, and the royalty is charged on what is left. Steam keys sold through other stores do not count toward the thresholds.

On the shipped defaults this lands near **0.40 × list price**, and near **0.45** for a US/EU-weighted audience. Those are the two scenarios the cited waterfall works through. The options page shows the ratio live as a sanity check: drifting toward 0.70 means a deduction has been switched off.

### The revenue band

The band is not the unit band converted into money. Every step of the waterfall has a range of its own, and drawing the revenue figure exactly as wide as the sales estimate would leave the confidence score marked down a step for uncertainty the band never shows.

The low end is the low unit count under a pessimistic waterfall and the high end the high count under an optimistic one: discount 10–30%, refunds 6–13%, and the regional factor one published profile either side of the chosen one. The sliders set the midpoint of each assumption; they do not make it certain, so a developer who moves one keeps their own midpoint and still gets the published width around it.

Walking every assumption the same way at once is deliberate. They are correlated, not independent — a game selling heavily into low-price markets discounts harder and refunds more.

Free-to-play games get no revenue estimate at all. Their income is in-app purchases and DLC, which no public signal exposes. Paid games with DLC get the figure plus a count of the DLC it excludes, because "DLC is not estimated" is a caveat while "this excludes 11 DLC" says how much of the game's income might be missing.

### List price versus sale price

Steam's `price_overview` carries two prices: `final` is what the store charges today and `initial` is the list price. Reading `final` as the list price is the most expensive single mistake available here.

It counts every discount twice — once in the price, again in the average-discount step — and flips the price band on top of that, so during a 75% sale a $39.99 game reads as a sub-$10 game and its estimate moves by 1.6x on units and 2.5x on revenue. The same game, the same week, a different answer depending on whether the reader happened to open the page during a Steam sale.

Everything that describes the game reads `initial`. Only the deep-discount adjustment reads today's price, because that one is genuinely about today.

## Wishlists

Steam publishes no wishlist counts for anybody. Three marks answer: a figure the developer published about this game, the game's place in Steam's wishlist ordering, and its follower count. Each one's say is computed from the width of its own band rather than set by hand — inverse variance in logs, `1 / ln(hi/lo)^2`, normalised across whichever marks answered.

**Wishlists cannot be derived from reviews at any multiplier.** A review is a function of a purchase that already happened; a wishlist is a function of intent. There is no coefficient connecting them. This is why most tools show no wishlist figure at all.

### One fit behind two of the marks

Turning a position into a count and carrying an old announcement forward to today are the same estimation problem, and they are estimated together — one median (L1) regression over 1,234 posts across 732 ranked games:

```
log(wishlists) = log a - b*log(rank + q) - alpha*log(1 + age/90) - rungk*gap
```

`a` = 503,667,749, `b` = 1.31652, `q` = 84.699, `alpha` = 0.35859, `rungk` = 0.15942. `age` is the age of the post in days. `gap` is the log-distance from an announced figure to the next rung on the ladder studios post at, and is zero for off-ladder figures such as "114,000". `tools/calibrate-wishlist-model.mjs` refits all of it from the raw archive and exits non-zero if a shipped constant stops reproducing.

`alpha` is one constant read by both marks, so the curve and the carry-forward cannot disagree about how fast a game grows.

**Held-out accuracy**, over 5×10 folds split by game so that no game appears on both sides of a split: median absolute error **12.9%** on posts under 30 days old, 15.7% under 90, 19.4% under a year, 22.2% at any age. The band **0.693–1.401** is the p10 and p90 of that out-of-sample residual. It is asymmetric because the residual is: a game can hold far more than its position implies, while an announced floor limits how much less.

### What the developer said, which outranks everything else here

744 games have a wishlist figure their own studio published on their own store page, 732 of them ranked when the model was fitted — roughly one ranked game in eight. On the day it is posted such a figure carries **0.75** of the weight, because its band runs 0.858x to 1.351x of the announced figure against the curve's 0.693x to 1.401x. That share is not a constant: the announcement band widens with the age of the post, so the same figure four years later carries **0.04** and the curve decides instead. A fixed weight would have given a four-year-old floor the same vote as a fresh one, and did — it pushed the band to 10.2x and graded the answer red, so a game with a stale announcement scored worse than a game with none at all.

Two measured corrections turn a post into today's count.

**It is a floor.** A studio posts on crossing a round number, so "500,000" means at least that. The correction is **1.039x** at the centre, estimated inside the joint fit as `rungk` 0.15942 against a mean rung gap of 0.2393 in logs. It is also checked from outside the fit: off-ladder figures such as "114,000" are not milestone crossings, and their median residual sits 1.06x above on-ladder figures at the same ranks — 1.03x within sixty days, 1.16x over all ages.

The model this replaced applied 1.21x here. Its shape was fine and that multiplier was not: cross-validated, the old curve scored 15.4% median error with it against 14.0% without it. At rank 80 it read 636,596 for a game whose developer had announced 500,000 the day before.

**It was true when it was posted.** Wishlists only grow before release, so the age term carries the figure forward: ×(1 + age/90)^0.35859, which is 1.28x at ninety days and 1.79x at a year. `tau` = 90 days is pinned rather than fitted, because it trades against `alpha` along a ridge — 90 sits inside the bootstrap interval of 48–170 and leaves `alpha` sharply identified. Three routes sharing no estimator agree on the exponent: 0.3586 from the joint fit, 0.3604 from a curve fitted on thirty-day anchors alone and profiled against older posts, 0.3639 from a p50 pinball fit on the cross-validated residual.

**Growth is not a percent per day.** The figure this replaced was 0.0687% a day, and an intermediate analysis of studios that announced twice read 0.697% a day. That second one is a regression through the origin; the same regression with an intercept reads 0.119% a day on an intercept of 1.75x. The intercept is the milestone ladder: a studio posts when it crosses a rung, so the *size* of a leg is set by the ladder and only its *duration* by growth, and the apparent deceleration with leg length is a roughly constant numerator over a growing denominator. Deceleration is real, but it is a property of the level, which is what the age term measures.

There is no age at which an announcement stops being used. An old one is weaker evidence, not absent evidence, and the widening band says so where a cutoff would be a rule the reader cannot see.

The rest goes to the two inference marks — beside a fresh announcement, about 0.20 to the curve and 0.05 to the follower ratio. They are there because they can contradict. A game that announced 500,000 whose follower count implies 5,000 has a wrong reading somewhere, and the band widens to show it rather than averaging it away. It works in both directions: for 14% of games with a published figure the curve alone sits below that figure, which is a thing a position in an ordering cannot know.

### The store's own wishlist ordering

Steam publishes an ordering of unreleased games by wishlists at `store.steampowered.com/search/?filter=popularwishlist` — positions, no numbers, and no documentation of what the ordering weighs. Released games are not in it.

What it sorts by is measured, not assumed. Rank against announced count gives a Kendall tau of 0.91 and a Spearman of −0.95 on fresh anchors. Regressing log(rank) on log(announced) plus log(appid) leaves page age insignificant at t = −0.09 to −0.84: once the count is known, how long a page has existed is worth nothing, so the ordering is on the balance rather than on how fast wishlists arrive. It is also region-invariant — 0 order inversions across us, de, jp and br — which makes regional and content-preference differences pure deletions from one global order.

**The axis is pinned.** The crawler sends `ignore_preferences=1` and fixes the region. Steam's default anonymous content preferences hide 415 of the 5,574 positions, and hide them unevenly: 1.4% of the first 500 against 12.4% of ranks 3,001–3,500. A default-axis snapshot is the real ordering compressed by up to 1.08x, and it would move under the curve every time Valve changed a default.

**The list is not truncated.** `total_count` is a genuine 5,574, and archived snapshots show it growing: 3,462 in June 2025, 4,122 in January 2026.

**One expression answers for every position, and there is no rank at which anything changes.** `q` = 84.699 is the head offset — the top of a ranked list is crowded, so rank 1 and rank 20 are not 20x apart in wishlists. With it, rank 1 reads 1.44 million. The same data through a straight line in log-log, which has no upper bound, read 147 million there and had to be switched off above a rank to stay usable.

### Absence from the ordering is a ceiling

The ordering held 5,574 games out of 15,343 with an announced store page when this was written — the top 36%. A game that is not in it is not unmeasurable: it sits below every ranked position, which bounds it from above at about 5,800 wishlists, the curve's reading at the last rank.

That bound is reported as a bound. It has no midpoint, it never joins the average, and the only thing it can do is contradict the follower leg — which it does, loudly, when a game with 4,000 followers is missing from a list whose last position reads under 6,000. One of the two inputs is then wrong, and the reader is told so rather than shown their mean.

There is a difference between "below the list" and "we have no list", and the two are never conflated. Not knowing where the ordering ends bounds nothing.

### Why the ranking is a file and not a request

Reading the ordering costs 56 requests, one per page of 100. Doing that inside the extension would multiply by every installation — tens of thousands of daily requests against an undocumented store endpoint, which Valve would be right to close, taking the feature with it.

So `.github/workflows/wishlist-ranks.yml` reads it once a day on one runner and commits the result to this repository's `data` branch, next to the archive of developer announcements, and the extension downloads those two files from a CDN once a day. The load on Valve does not grow with the number of users. And the extension makes the same request whichever game is on screen, so unlike every per-game lookup here it discloses nothing about what anyone is browsing.

A short crawl is never published. A truncated ordering does not look broken downstream — it looks like a store where fewer games are wishlisted, which moves every position and inflates every estimate — so the crawler refuses to write a file below 97% of the total the store itself reports, and yesterday's snapshot stays. Steam signals throttling as HTTP 200 with an empty body rather than 429, which is exactly the failure a status check sails past.

### Where the announcements come from

`tools/harvest-anchors.mjs` reads the figures out of `ISteamNews` and pairs each with the position that game held on the day.

Contamination is filtered positionally: the 60 characters before the number and the 90 characters after the word "wishlists" are read separately rather than as one window spanning both. A single window lets a goal word near the number rescue a target, and an achievement word near the word rescue a goal — which is how "all the way to -30% for 1,000,000 wishlists! To get to the next tier" was recorded as an achieved 1,000,000 for a game at rank 99. Measured against 1,102 hand labels the positional rule scores **99.4% precision and 99.1% recall**, against 97.0% precision unfiltered.

`tools/condense-anchors.mjs` cuts the archive to what a browser needs and drops two further classes: any figure whose quote appears under more than one app id, which is one post cross-published to several game hubs, and every figure for a game but the largest, tie-broken to the most recent. That is the set the model is fitted on. `tools/merge-anchors.mjs` unions it with the published copy at publish time.

Nothing in `src/` changes automatically from any of this. If the mapping stops reproducing, `tools/calibrate-wishlist-model.mjs` exits non-zero, and the fix is a refit or an honest paragraph here.

### Followers, and the ratio we measured

Following a game silently joins a mostly hidden group, and Steamworks documentation confirms the member count of that group is the only place the number surfaces.

The multiplier applied to it used to be GameDiscoverCo's: median 12x, range 7–20x, from a June 2023 survey of 125+ developers who volunteered their own figures. It is now **16.2x, range 9.6–32.8x**, measured here.

The survey was not a constant of the platform. The same survey run in February 2021 on 113 games gave a median of 9.6x, so the ratio had moved 25% in two years, and three more years had passed since. Both vintages also asked developers to volunteer, and a studio with a flattering ratio answers more readily.

Measuring it needed nothing that was not already here. Every anchor collected for the ranking check is a wishlist figure a studio published on its own store page, and follower counts are public, so the multiplier is one division per game with no survey in between and nobody choosing whether to answer. `tools/calibrate-follower-ratio.mjs` reproduces it.

Over 83 games that announced a figure within thirty days:

| | min | p10 | median | p90 | max |
| --- | --- | --- | --- | --- | --- |
| Followers to wishlists | 4.5x | 9.6x | **16.2x** | 32.8x | 79.7x |

It holds still when the sample is cut different ways — 16.6x at fourteen days (n=38) against 15.3x at ninety (n=200), 15.7x for ranks 201–1000 and 15.3x below rank 3000. Follower counts in the sample run from 132 to 12,036, so this is measured on small and mid-size games rather than on the head of the chart.

**It does not vary with game size.** A 60-game re-measurement puts the slope of ln(ratio) on ln(wishlists) at +0.073 with a standard error of 0.049, which is indistinguishable from flat. One ratio for every game is what the data supports.

**There is now an outside check.** GameDiscoverCo measured 16.1x in May 2026 on 600+ games from their own data rather than from a survey — a different population read by a different method, landing within 1% of this. It is `SOURCES.GDC_FOLLOWERS_2026`.

**Read it as a floor.** Two biases push it down and neither pushes back. An announcement is a threshold crossing, so "500,000 wishlists!" means at least that much. And follower counts are read today against a figure that was true when it was posted, so every denominator is a little high. That the median falls as the window widens — 16.6x at fourteen days, 15.3x at ninety — is that second bias becoming visible, which is also why the tightest window is the one quoted.

p10 and p90 rather than min and max, the same choice `PLAYTIME.biasRange` makes: one game at 79.7x should not set the width of every band. Part of that width is this measurement's own noise, which a survey does not have, so treat 9.6–32.8x as an upper bound on how much games really differ.

### Genre, which is readable

The 2023 survey publishes per-tag multipliers alongside its range: 4X strategy 7.5x, turn-based strategy 9.0x, survival 9.5x, story-rich 13.2x, relaxing 15.7x, puzzle 15.9x. Strategy audiences follow closely and wishlist sparingly; puzzle and relaxing audiences do the opposite.

Those figures were measured around the survey's own 12x median, and dropping them in beside a 16.2x level would invert the effect — a game tagged Puzzle would score 15.9x against a general 16.2x, so detecting the survey's most wishlist-heavy genre would *lower* the estimate. What the survey measured is how far each genre sits from its own median, so that is what carries over: puzzle at 15.9/12 = 1.33x of the level, or 21.5x today.

One tag only, picked the same way as the genre adjustment for units — a game tagged Puzzle, Indie and Relaxing is scored on whichever of the three Steam ranks highest, not on whichever row sits first in our table. Genre moves this ratio 2.1x across its span, against 1.35x for the festival factors below, and unlike promotion history it is written on the store page.

### Promotion history, which is not

Promotion history is never inferred from the store page. Two signals look usable and neither is: a demo is not festival participation, and searching the page for festival wording only matches while the festival is actually running, so a game that took part last year reads as though it never did. The extension therefore always treats the history as unknown and uses the overall survey median. The context can still be supplied by a caller.

The multipliers it would apply come from the 2021 survey, published against an overall median of 9.6x: no festival 7.77x, a Steam festival 10x, a festival plus a store feature 10.45x. Those carry over as each group's distance from its own median — 0.81x, 1.04x and 1.09x — for the same reason the genre rows do.

**Only valid before release.** Afterwards wishlists are consumed by purchases while followers persist, and the total balance typically peaks at 2–4x the pre-launch count before decaying. No stable ratio survives that, so the extension shows the follower count and declines to convert it. The store ordering agrees: it holds no released games either.

## Week-one sales, and why we show two answers

Two published routes lead to the same quantity:

- **Via wishlists.** Followers × 16.2 → wishlists, then × 0.11 → week-one sales. GameDiscoverCo's analysis puts the median at 0.11x the launch wishlist balance, around 15% for games with 25,000+ wishlists and 10% for games priced above $10. Net effect: followers × 1.78.
- **Direct.** Jake Birkett's rule of thumb, followers × 2.5.

These disagree by roughly 1.4x, and did so by 1.9x before the follower ratio was re-measured. Two respected heuristics, composed, still land a long way apart.

The extension shows both and labels the disagreement. There is deliberately no midpoint anywhere in the result: the point of showing two answers is that nobody knows which is right, and anything called `mid` eventually gets rendered as though somebody did.

GameDiscoverCo's own warning on this metric deserves repeating: conversion outcomes vary by 10–20x, not 10–20%.

## Sourced direction, our magnitude

Some published findings establish that an effect exists and leave the size for later. VGI's 2021 study says in as many words that higher-priced games have lower multiples and that MMOs run higher while sports and racing run lower — and then says the quantification is still to come. Gamalytic presents genre as a chart with no table before concluding that genre is a weak factor.

The numbers expressing those directions are therefore ours: the over-$30 and under-$10 price factors, the three genre factors, the heavy-discount factor, the 100–1,000 and over-10,000 review bands, the emerging-markets regional profile, the language-mix thresholds, the discount span in the revenue envelope, and the confidence and disagreement thresholds. Each carries `derived: true` in `constants.js`, and the "why this number" panel marks them with an asterisk.

It is the difference between "the survey measured this" and "the survey measured that this exists, and we sized it ourselves". A file claiming full traceability has to show which is which, and a reader auditing the chain deserves to know which links are measured and which are judgement.

## What the store page is not asked

A store page answers in the present tense: whether a bundle is on offer today, whether a festival is running right now. Most coefficients ask about a game's whole history instead, and a selector standing in for a historical fact is wrong in one direction and blind in the other — it fires on games that merely qualify today and misses every game that qualified last year.

Two coefficients would be easy to read that way and are not. Promotion history is never inferred from a demo or from festival wording on the page; the survey median stands in until a caller supplies the real context. The owners-to-units factor is about every key ever handed out, so it comes from the reviews API rather than from a bundle widget in the purchase block.

The rule generalises: before reaching for a DOM selector, check whether an API already answers the question the coefficient is asking.

## Gates and refusals

**Under 10 reviews: no estimate.** Ten is where Steam itself starts. Ask the store's own review summary about a game with nine reviews and it answers `review_score: 0` with the description `"9 user reviews"`; at eleven it answers with a score and a word. Valve will not commit to a verdict on a smaller sample, and neither do we: under ten, one more review moves the estimate by a tenth, so the figure would track the sample rather than the game. Between 10 and 200 reviews the band is widened by ×0.75 and ×1.4 rather than pretending the survey ranges still hold — at ten reviews that is a band roughly five times wide, which the verdict reports as unreliable.

**Not a game: no estimate.** Steam serves several kinds of thing from `/app/`, and the extension runs on all of them. Asking the store API what those pages actually are:

| `type` | example | reviews | price | `fullgame` |
| --- | --- | --- | --- | --- |
| `game` | Cyberpunk 2077 | 977,729 | $59.99 | — |
| `dlc` | Cyberpunk 2077: Phantom Liberty | 23,823 | $29.99 | 1091500 |
| `music` | Terraria: Official Soundtrack | 548 | $2.49 | 105600 |
| `hardware` | Steam Deck | 20 | $399.00 | — |
| `hardware` | Steam Controller (2015) | 19,012 | — | — |
| `demo` | Duck Norris Tales Demo | 12 | free | 3161930 |

The review multiple was measured on base games, so only `game` gets a number. Each of the others is declined with a sentence of its own, because they are wrong in genuinely different ways and one of them is not wrong at all:

- **`demo`** has no sales to estimate, and its `is_free` flag would have doubled the multiplier on top. This one has a better answer than a refusal: Steam names the game the demo belongs to, so on a demo page the pipeline runs a second time against that game and the panel says whose figures it is showing. Where no parent is named, there is nothing to estimate.
- **`dlc`** and **`music`** do have sales. Only the coefficient is borrowed, and that is the harder problem: a DLC is bought by people who already own the base game and have often already reviewed it, so its reviews-per-sale ratio is its own and no source publishes it. The figure would have looked entirely plausible, which is worse than an obvious error.
- **`hardware`** is not sold under the revenue share at all — Valve pays itself no royalty — and no review multiple has ever been measured for devices.

Anything not on that list is declined too. An unfamiliar kind of page is not evidence that the game multiple applies to it.

**After release: no wishlist number.** See above.

**Free to play: no revenue number.** See above.

**No dated peak: no week-one figure.** See above.

Refusing to answer is a feature. Every wrong number this tool does not print is a decision someone does not make badly.

## Confidence

Each figure is scored separately, because the three rest on different evidence and a single verdict would have to be wrong about at least one of them.

### What the scale reads

None of the three scales is driven by the width of the band, because **width does not vary here**. Every band in this project is dominated by a fixed published range: the review multiplier spans 20-55x on its own, the follower-to-wishlist ratio is 9.6-32.8x for every game, and the revenue band is the unit band pushed through an envelope. Measured across 22 real games the unit spreads came out bimodal — eighteen between 2.23x and 2.64x, four above 7x, nothing in between.

Reading a level off that quantity would have three consequences:

- **Units** could never reach the top. The threshold sits at 2.2x and two overlapping published bands cannot combine below about 2.23x.
- **Revenue** is capped one step below units, so with the top of the units scale out of reach it would be a *constant*: every paid game on Steam reading "unreliable", forever.
- **Wishlists** would be scored on a range that is 9.6-32.8x by construction, so every unreleased game would read "rough". Also a constant.

A rating that never varies is a label. So each scale reads whatever actually differs between games, and width serves only as a ceiling.

**Units** — how many independent methods contributed, whether their bands admit a common figure, whether the review sample is past the low-sample gate, and whether either cross-check objects. Two methods agreeing on a healthy sample is the best this tool does, and it says so; a single source or a thin sample is a step down; a conflict past the published error envelope, or a band wider than 3.5x, is the bottom.

**Revenue** can never be rated above the units it derives from and is capped a step below, because the waterfall runs on assumptions with real ranges of their own. Its own varying fact is whether the regional factor was read from the game's review languages or left at a default — that factor swings the answer between 0.60 and 0.88 of list price, the widest single assumption in the chain, so measuring it rather than assuming it is worth a step.

**Wishlists** are scored on whether the midpoint is a multiplier the survey published for this kind of game, or the median across every kind. The band is the same either way; what differs is how much is known about where inside it the answer sits.

### The scale

- **Green** — two methods admitting a common figure, on a sample thick enough to mean something, with no cross-check objecting
- **Neutral** — a single method, a thin sample, a cross-check objecting, or a near miss between bands
- **Red** — a gap of more than 1.86x between the nearest band edges, or a band wider than 3.5x whatever the evidence looks like

The width thresholds are 2.2x and 3.5x for units. Widening them to 2.75x and 5.1x would move 18 of 22 games into *reliable* by relabelling rather than by learning anything, which is the argument for width being a ceiling rather than the level itself.

A single source caps at the neutral level rather than dropping to red. Having one method is the normal case for unreleased and small games; red should mean something is wrong, not that a second opinion was unavailable. An unknown promotion history costs nothing, because it is unknown on every game and a penalty applied every time is not a penalty.

#### Wishlists are scored separately, and on different facts

Width cannot grade a wishlist estimate, because it barely varies. Measured over the whole ordering it is 2.02x with the ranking alone, 2.30x with a follower count as well, and 2.52x where a stale announcement is on file. Width says which marks answered, not how good the evidence was, so it is kept only as a ceiling on the grade: 2.0x and 3.5x.

What grades the estimate is what kind of number it is.

- **Green** — most of the answer is a figure the developer published. That holds while the figure is under about a month old, which is where its share of the weight crosses a half and also where the held-out error is 12.3% rather than 14.7%. Two independent things landing on the same month is the reason the threshold is not a chosen number: it is `share > 0.5`, and the month falls out of it.
- **Neutral** — the answer is read off the store ranking. Held out, that curve lands within 25% for 70% of games and within 50% for 91%. This is the normal case and covers 97% of ranked games.
- **Red** — the marks contradict past 1.86x between their nearest edges, the follower ratio breaks the ceiling set by absence from the ordering, or the ranking cannot answer at all and only the follower ratio is left. The follower ratio is the weakest mark on file — 37% of games within 30% against the curve's 73% — so a game resting on it alone is at the bottom of the scale.

**Counting methods is not evidence and no longer scores.** The previous scale gave a step up for having more than one mark answer. With the published table gone the two remaining inference marks are rank and follower count, and those correlate at -0.96 in logs — a game high in the ordering has many followers for the same reason it has many wishlists. Under the old rule the narrower answer scored worse than the wider one: the ranking alone gave a 2.02x band graded neutral, and adding the less accurate follower leg widened it to 2.30x and graded it green.

**An unrecognised genre** used to cost a step and no longer does: the survey covers six tags, and marking a game down for falling outside somebody else's table penalised most games for a gap in the source rather than for anything about the estimate.

The collapsed row shows several figures at once, so its single word reports the weakest of the ones on display.

Confidence reflects how well the sources agree and how much of the chain is measured rather than assumed. It says nothing about the game, and it is **not** a claim that the band is narrow — the band is on screen, and on a typical released game it is still about 2.5x wide.

### What is not double-counted

Three ways of scoring disagreement would force the bottom level on almost every game, and none of them is used.

An alarm threshold below the noise floor of the methods alarms at healthy. Adjusted review multiples land within 30% of the truth on 50.4% of games and concurrents-over-playtime on 64.4%; two readings each inside their own 30% error can differ by 1.3 / 0.7 = 1.86x while both perform exactly as published, so a 1.5x threshold fires on agreement.

Comparing midpoints compares the wrong quantity — these are interval estimates, one of them centred on a bucket from a fixed ladder. Overlap between bands is the question worth asking.

And charging one fact twice: a conflict widens the band, so measuring the spread on the widened band and marking the level down again for the conflict that produced it counts it once in the width and once in the word.

## Where each number comes from

| Signal | Source | Cost |
| --- | --- | --- |
| Review totals and score | `appreviews`, same origin | 1 request, cached an hour |
| Price, release date, genres, DLC count | `appdetails`, same origin | 1 request, cached six hours |
| Audience language mix | `appreviews` with a joined language list | 1 request, cached a day |
| Playtime sample, Steam-purchase share | `appreviews`, one page of 100 | 1 request, cached a day |
| Followers | `steamcommunity.com` group member count | 1 request, cached a day |
| Owner band | SteamSpy | 1 request, cached a day |
| Place in Steam's wishlist ordering | A file built daily in CI, served from a CDN | 1 request a day, shared by every user and every game |
| Wishlist figures developers announced | A second file from the same daily job | 1 request a day, shared by every user and every game |
| Live players | Valve's `GetNumberOfCurrentPlayers` | 1 request, cached three minutes |
| 24-hour peak, all-time peak and its month, monthly history, 30-day trend | SteamCharts page | 1 request, cached a day |

Everything is cached before it is requested again. That is not politeness for its own sake: `appdetails` is rate-limited hard enough that a few minutes of browsing without a cache starts returning nothing, and a missing appdetails response silently costs the release year, the list price and the revenue figure at once.

SteamCharts is the only HTML here, because no public API exposes the all-time peak or the monthly series. Neither parser depends on position or class names — the summary figures are located by their labels, the monthly rows structurally by their cells — and both return nothing when the page does not look as expected, because a wrong number there would be indistinguishable from a right one.

The two figures the page contributes beyond the peak both answer questions the peak cannot. A concurrent player number says how big a game is; the 30-day trend says which way it is going; and the monthly series is what makes the player-hours estimator possible at all.

## Recent versus lifetime reviews

Valve computes its own 30-day review score and prints both summaries in the glance box on every store page. Since May 2016 the two have been separate precisely so a shopper can tell whether a reputation reflects the game's current state: a bad patch drops the recent figure within days while the lifetime score barely moves, and a fixed game recovers in the recent score long before the lifetime one catches up.

That score is read from the page rather than derived. The reviews API returns lifetime totals in its query summary and its `day_range` parameter only changes which helpful reviews surface, so reproducing the 30-day figure would mean paging through every review and counting timestamps — for a number Valve has already computed and rendered a few hundred pixels away.

Three traps are worth naming.

**Which row is which.** The labels are translated, so they cannot be matched. Position looks safe and is not: the store renders a second, responsive copy of both rows in the *opposite* order, so a page shipping one set without the other would have its lifetime score reported as the recent one. The rows are told apart by whether their sentence names the length of its window, which is digits in every Steam locale.

**The count inside the sentence.** "81% of the 22 user reviews in the last 30 days are positive" contains two numbers besides the percentage, and taking the larger reports 30 reviews instead of 22 — on every game with fewer than thirty reviews in the window. One occurrence of the window length is dropped, and only when something else is left to read, so a game with exactly thirty still reports thirty. A fixture of more than thirty reviews cannot exercise any of this, which is why the test uses a small one.

**Scope.** Steam scopes the lifetime row on a store page to the reader's own language while leaving the recent row across all of them. On Apex Legends the page reads "Recent Reviews: 68% of 7,497" beside "English Reviews: 76% of 449,071" — thirty days of every language against a lifetime of English. Subtracting one from the other produces a confident-looking gap that measures nothing. The check is arithmetic: a lifetime row counting far fewer reviews than we know exist has been filtered, and no comparison is drawn.

The gap is reported in percentage points rather than as a percentage change, because the distance between two shares is the signal and expressing it as a ratio would overstate small moves. A gap under one point is treated as flat, since both figures are already rounded.

Valve withholds the recent score until a game has been available for 45 days and has enough reviews inside the window. Below that the store page shows one summary, and the extension shows no comparison.

## Known limitations

- Steam keys sold on other stores are invisible. So are bundle revenues and any income outside Steam.
- DLC and in-app purchase revenue is not estimated. The DLC count is shown so the reader knows how much is missing.
- Early Access price changes are not modelled; the current list price is used throughout. No free source publishes price history, which is also why the average lifetime discount is an assumption rather than a measurement.
- Games whose community group is not keyed to the app ID return no follower count. The store ranking still answers for those, but only while the game is high enough to be ranked at all.
- The follower coefficient is fitted against the figure a studio published, which is a floor from the day of the post, while the curve and the announcement mark both target today's count. Measured on 60 games with a tagged genre and a readable follower count, the observed ratio against today's count is 20.2x where the shipped level is 16.2x, so the follower mark reads about a quarter low beside the other two. The level is left where it is because it has the only outside corroboration in this section — GameDiscoverCo measured 16.1x on 600+ games, independently — and moving it on 60 games would trade a checked number for an unchecked one. Re-deriving it needs `tools/calibrate-follower-ratio.mjs` run against today's count rather than the raw announcement, on a pass whose dropout stays under 15%.
- The genre table earns its place but its spread is overstated. Giving each variant its own best-fit level so only the shape is judged, the six tags lift accuracy from 37% of games within 30% to 45%, and the ordering reproduces on games the survey never saw. Halving the exponent scores better still, 48%, which matches the measured slope of 0.58 on the survey's own multipliers — but the gap is inside the noise of 60 games, so the table ships at full strength until a larger sample settles it.
- One follower ratio is applied to every game. That is what the data supports — the slope of ln(ratio) on ln(wishlists) is +0.073 with a standard error of 0.049 over 60 games — but it means the leg carries no information about a particular game beyond its follower count.
- **Rank alone cannot do better than about 1.20x.** Among games whose ranks differ by under 5%, the median pair of recent developer self-reports disagrees by 1.20x. Two games at the same position really do hold different counts, that gap is the floor on any function of rank alone, and it is most of the band's width.
- The ordering could be sorted by any quantity proportional to wishlists — follower count, for one — and no amount of this data separates those. What is settled is that it is not sorted by velocity and not sorted per region.
- The curve, the follower coefficient and the floor correction are all measured on the same archive of announcements, so a bias in what studios choose to announce moves all three the same way. There is a measured reason to expect one: at equal rank, games that announced a milestone carry 85% of the followers of games that did not, so the follower coefficient measured on announcers reads roughly 1.10–1.18x high. `GDC_FOLLOWERS_2026` is the first outside reading able to catch that, and at 16.1x against our 16.2x it does not.
- The developer's own figure covers roughly one ranked game in nine, so for the rest the estimate is still entirely inference. The archive grows daily and that share grows with it, but slowly: 118 of the 1,102 posts on file were written in the last thirty days.
- The two inference marks are not independent. Rank and follower count correlate at −0.96 in logs, 0.68 to 0.89 after the level is removed, and both are fitted to the same archive besides, so their agreement is not evidence. The follower leg earns its place by answering where the ranking cannot, and by being the only mark that reads something about the game rather than about its position.
- `tau` = 90 days in the age term is pinned rather than fitted. It trades against `alpha` along a ridge, and the bootstrap interval on it spans 48 to 170 days.
- The ranking is a daily snapshot, so a game that moved sharply in the last day is scored where it was. A snapshot older than three days is refused outright rather than used.
- DLC and soundtrack sales are real and are not estimated, because the reviews-per-sale ratio for them has never been published and the base-game multiple does not transfer. This is a gap in the sources, not in the plumbing: the figures would be easy to print and impossible to defend.
- On a demo page the figures describe the parent game, which is a different app from the one in the address bar. The panel says so, but a reader skimming will still be looking at one page and reading another page's numbers.
- SteamSpy supplies no owner band for many recent releases, so the units figure rests on one method for exactly the games where the review multiple is least reliable. There is no second free source of owner counts to fall back on.
- The review multiple overestimates the very largest games. Gamalytic reports that games with hundreds of thousands of reviews fall back toward 20 sales per review — Elden Ring is the example given — but publishes no median for that group, so we do not model the decline.
- The player-hours cross-check needs both a SteamCharts monthly history and at least 20 reviews with playtime, so it is unavailable for games too small or too new to have either. Its divisor is an assumption, which is why it is a cross-check.
- Confidence is scored on agreement between sources and on how much of the chain is measured, not on outcomes. Nothing here has been calibrated against whether an estimate turned out to be right, because that needs frozen snapshots in `test/fixtures.json` and there are none yet. A green verdict means the sources concur, not that the answer is verified.
- The regional profile read from review languages is a proxy for where copies were bought, not a measurement of it.
- Steam top-seller rank, the third reachable method in the benchmark table, is not implemented for units. Current rank is only published for the top of the chart and the historical series would take years to accumulate. The wishlist ordering is the same shape of signal and is implemented, because that one is published in full and a daily job can bank it — which is what the `data` branch is.
- Scheduled workflows in public repositories are disabled by GitHub after 60 days without repository activity, and commits made by the job itself are not reliably counted as activity. If the ranking stops updating, that is the first thing to check.
- The whole thing is calibrated on Western-market assumptions. A China-focused release will behave differently in ways we do not currently correct for.

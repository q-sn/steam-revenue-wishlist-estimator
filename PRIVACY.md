# Privacy Policy

**Wishlytic — Steam Revenue & Wishlist Estimator**
Chrome Web Store item
[`kmolckbdnoohadbcjgdfdlchgacdbjij`](https://chromewebstore.google.com/detail/kmolckbdnoohadbcjgdfdlchgacdbjij).
Effective 7 September 2026.

There is no server behind this extension. Nothing it learns about you is sent
anywhere, because there is nowhere to send it: no account, no sign-in, no
telemetry, no analytics, no advertising, no crash reporting, no third-party
SDKs. The developer of this extension receives no data from it, ever.

What follows is the whole of what it touches.

## What it reads

On a `store.steampowered.com/app/...` page, and nowhere else, the extension
reads what is already on the page: the app ID, title, price, discount, review
counts, release date, tags and follower count. This is the same public
information any visitor to that page can see.

It does not read your Steam account, your cart, your library, your friends,
your profile or your purchase history, and it cannot: every request it makes
sets `credentials: 'omit'`, so your Steam cookies are never attached to any of
them. The extension is signed out of Steam even when you are signed in.

## What it stores, and where

Two things, both in `chrome.storage.local`, both on your device only:

- **Visit snapshots.** For each game you open, a dated record of its review
  count, follower count and the estimate produced — at most one point per twelve
  hours, and at most 60 points per game, oldest dropped first. This is what
  draws the local trend line, which needs two visits to say anything. It
  amounts to a record of which Steam game pages you have opened while the
  extension was installed.
- **Cached lookups.** The figures fetched from the sources below, held so that
  a game costs a handful of requests per day rather than per page view, plus
  the two shared data files described under *Downloads*.

Neither is synced, uploaded, backed up or transmitted. Both are erasable at any
time from the extension's options page, and both are deleted with the extension
when you uninstall it.

## What leaves your browser

To produce an estimate the extension asks five public sources about the game
you are looking at. Each request carries the game's numeric app ID and nothing
else — no identifier for you, and no cookies:

| Source | What is asked | What comes back |
| --- | --- | --- |
| `store.steampowered.com` | app ID | review history and store details |
| `steamcommunity.com` | app ID | the follower count |
| `api.steampowered.com` | app ID | current concurrent players |
| `steamspy.com` | app ID | the owner band |
| `steamcharts.com` | app ID | all-time peak concurrent players |

These are ordinary web requests made by your browser, so each of those sites
sees your IP address exactly as it would if you had opened the page yourself.
What they do with it is governed by their own privacy policies, not this one.
Valve, SteamSpy and SteamCharts are independent of this project.

### Downloads

Twice a day the extension downloads two JSON data files —
`wishlist-ranks.json` and `wishlist-said.json` — from `cdn.jsdelivr.net`, with
`raw.githubusercontent.com` as a fallback. These are published by this
project's own repository and are identical for every user. They are **data, not
code**: the extension executes nothing it downloads, and every line of script
it runs is contained in the package Chrome installed. The download carries no
information about you beyond the request itself.

## What is never done

- No data is sold, rented or shared with anyone.
- No data is used for advertising, profiling, credit assessment or lending.
- No data is used for any purpose unrelated to producing the estimate on screen.
- No data is transmitted to the developer.

## Changes

Material changes to this policy will be published in this file, with the
effective date above updated, before the version they describe is released.

## Contact

Questions, or something here that does not match what the code does:
[github.com/q-sn/steam-revenue-wishlist-estimator/issues](https://github.com/q-sn/steam-revenue-wishlist-estimator/issues).

The source is public, and the claims above are checkable against it: the
requests are in `src/background/service-worker.js`, and everything written to
storage is in the same file and in `src/core/history.js`.

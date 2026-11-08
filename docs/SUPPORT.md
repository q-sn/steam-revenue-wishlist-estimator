# Support

Something broken, a number that looks wrong, or a question the panel does not answer — here is where to take it.

## Report a problem

**[Open an issue on GitHub](https://github.com/q-sn/steam-revenue-wishlist-estimator/issues/new)**. It is the one place questions and bug reports are read, and anyone else hitting the same thing will find the answer there.

To get it fixed fast, include:

- the Steam store page it happened on — the full `store.steampowered.com/app/…` address;
- your browser and its version;
- the Wishlytic version, printed in the bottom-right corner of the panel;
- a screenshot, if something looks wrong rather than being missing.

## Common questions

**The panel does not appear.**
It only runs on game pages, `store.steampowered.com/app/…`, and not on the store's front page, search or your library. Right after installing or updating, reload the page once.

**There is no number for units sold or revenue.**
It is withheld on purpose under 10 reviews, where a single new review moves the answer by a tenth, and on anything that is not a base game: DLC, soundtracks, videos and hardware. The panel says which of these applies. A demo shows the figures of the game it belongs to.

**A released game has no wishlist estimate.**
Also on purpose. Purchases empty wishlists while followers stay, so after release no ratio between the two holds up. The panel shows the follower count instead.

**Why a range and not one number?**
Because the sources honestly disagree by that much, and one figure would hide it. Every mark on the scale is one method; how they are combined, and how accurate the result is, is in the [methodology](METHODOLOGY.md).

**I know the real numbers, and the estimate is off.**
If they are your game's, the settings let you set its average discount, where its buyers are, and its refund rate — click the extension's icon. If the figures are public, say so in an issue with a link: every disclosed sales figure makes the estimates better for everyone. [How these are used](https://github.com/q-sn/steam-revenue-wishlist-estimator/blob/main/CONTRIBUTING.md#the-most-valuable-contribution).

**How do I change the language, size or corner of the panel?**
Click the extension's icon, or **Settings** at the bottom of the panel.

**What does it store, and how do I remove it?**
Only cached figures and your own visit snapshots, on your device, never sent anywhere. The settings page has a button that clears them, and uninstalling removes everything. In full: the [privacy policy](https://q-sn.github.io/steam-revenue-wishlist-estimator/privacy/).

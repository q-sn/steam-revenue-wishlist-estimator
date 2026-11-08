/**
 * When to ask for a Chrome Web Store review, and when to stop asking.
 *
 * Pure functions over one small record kept in chrome.storage.local under
 * REVIEW_ASK.storageKey; main.js does the reads and writes. Nothing here
 * leaves the device — the record is a handful of counters and dates, and the
 * only thing it ever decides is whether a card appears in the panel.
 *
 * The rules, and why each one:
 *
 *   Only a Chrome Web Store install is asked. Chrome writes `update_url` into
 *   the manifest of every extension it installs from its store, pointing at
 *   clients2.google.com; Opera's and Edge's stores write their own, Firefox
 *   serves the extension from moz-extension://, and an unpacked checkout has
 *   none at all. That is the signal for "a review here would land on the
 *   listing this copy came from", which a user-agent sniff is not: Brave or
 *   Edge running a CWS install can review it, Opera running its own store's
 *   copy cannot. The extension id is checked as well, so a fork re-published
 *   under another id never points its users at this listing.
 *
 *   Only someone who has used it for a while. Two weeks since the first page
 *   it ran on, on at least seven different days, with the panel opened at
 *   least five times. Days and opens rather than page views: one research
 *   afternoon on forty games is one day of use, not forty.
 *
 *   Only in the panel, which the user opened on purpose, and only on a page
 *   where an estimate came out — the moment the extension has just been useful.
 *   Never as a popup over the store page.
 *
 *   No gate. Both doors are open at once: the review link, and a link to
 *   report a problem. Asking "do you like it?" as a step of its own and only
 *   showing the store to the yes-sayers is review gating, which Google Play's
 *   in-app review rules forbid outright and which would skew the listing's
 *   average in a way its readers are owed better than.
 *
 *   Asked twice at most. "Not now" puts it away for 45 days; so does being
 *   seen on three separate days without an answer, since ignoring a card is an
 *   answer too. After the second time, or after the review link is used, it
 *   never comes back. A permanent link on the options page stays for anyone
 *   who wants to do it later on their own.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const STORE_ID = 'kmolckbdnoohadbcjgdfdlchgacdbjij';

export const REVIEW_ASK = {
  storageKey: 'reviewAsk',
  // Set to true by hand in an unpacked checkout to test the card. Ignored by
  // every store install.
  devFlagKey: 'reviewAskDev',
  storeId: STORE_ID,
  // Chrome's own update endpoint, as written into a store install's manifest.
  updateHost: 'clients2.google.com',
  reviewUrl: `https://chromewebstore.google.com/detail/${STORE_ID}/reviews`,
  issuesUrl: 'https://github.com/q-sn/steam-revenue-wishlist-estimator/issues',

  minAgeDays: 14,
  minActiveDays: 7,
  minPanelOpens: 5,

  snoozeDays: 45,
  maxAsks: 2,
  // Days the card was on screen with no answer before that counts as "not now".
  ignoredAfterDays: 3
};

/**
 * True when this copy came from the Chrome Web Store listing. `extensionUrl`
 * is chrome.runtime.getURL(''), whose scheme separates Chromium from Firefox
 * independently of the manifest.
 */
export function installedFromChromeWebStore(manifest, extensionUrl, extensionId) {
  if (!String(extensionUrl ?? '').startsWith('chrome-extension://')) return false;
  if (extensionId !== REVIEW_ASK.storeId) return false;
  try {
    return new URL(manifest?.update_url ?? '').hostname === REVIEW_ASK.updateHost;
  } catch {
    return false;
  }
}

/**
 * Whether this copy may ask at all: a Chrome Web Store install, or an unpacked
 * Chromium checkout with the dev flag set. An unpacked extension is the only
 * kind without `update_url` — every store writes one — so the flag cannot
 * switch the card on for anyone who installed from a store, whatever ends up
 * in their storage.
 */
export function mayAskHere(manifest, extensionUrl, extensionId, devFlag = false) {
  if (installedFromChromeWebStore(manifest, extensionUrl, extensionId)) return true;
  return devFlag === true
    && !manifest?.update_url
    && String(extensionUrl ?? '').startsWith('chrome-extension://');
}

/** The local calendar day, so "seven days of use" means seven of the user's days. */
export function dayStamp(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A fresh record. `firstSeen` can be backdated by the caller — an existing
 * user updating into this version has local history going back further than
 * today, and making them wait another two weeks would be pointless.
 */
export function newReviewState(now = Date.now(), firstSeen = now) {
  return {
    firstSeen: Math.min(firstSeen, now),
    lastDay: null,
    activeDays: 0,
    opens: 0,
    asks: 0,
    snoozedUntil: 0,
    shownDays: 0,
    lastShownDay: null,
    done: false
  };
}

/** A store page with the overlay on it. Counts each calendar day once. */
export function noteVisit(state, now = Date.now()) {
  const today = dayStamp(now);
  if (state.lastDay === today) return state;
  return { ...state, lastDay: today, activeDays: state.activeDays + 1 };
}

/** The user opened the panel. */
export function noteOpen(state) {
  return { ...state, opens: state.opens + 1 };
}

/** Whether the card belongs in the panel right now. */
export function shouldAsk(state, now = Date.now()) {
  if (!state || state.done) return false;
  if (state.asks >= REVIEW_ASK.maxAsks) return false;
  if (now < state.snoozedUntil) return false;
  return now - state.firstSeen >= REVIEW_ASK.minAgeDays * DAY_MS
    && state.activeDays >= REVIEW_ASK.minActiveDays
    && state.opens >= REVIEW_ASK.minPanelOpens;
}

function snooze(state, now) {
  const asks = state.asks + 1;
  return {
    ...state,
    asks,
    snoozedUntil: now + REVIEW_ASK.snoozeDays * DAY_MS,
    shownDays: 0,
    lastShownDay: null,
    done: asks >= REVIEW_ASK.maxAsks
  };
}

/** The card scrolled into view. Three unanswered days put it away. */
export function noteShown(state, now = Date.now()) {
  const today = dayStamp(now);
  if (state.lastShownDay === today) return state;
  const next = { ...state, lastShownDay: today, shownDays: state.shownDays + 1 };
  return next.shownDays >= REVIEW_ASK.ignoredAfterDays ? snooze(next, now) : next;
}

/**
 * What the user did with the card: 'review' ends it for good; 'later' and
 * 'issue' put it away. Someone reporting a problem is not asked again until
 * the next window, by which time the problem may be fixed.
 */
export function noteAnswer(state, answer, now = Date.now()) {
  if (answer === 'review') return { ...state, done: true };
  return snooze(state, now);
}

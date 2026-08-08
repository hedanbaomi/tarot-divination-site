[简体中文](./README.md) | [English](./README.en.md)

# Quareia Divination Website

An unofficial, frontend-only divination website supporting three decks: **Tarot**, **Mystagogus**, and **LXXXI — The Magician's Deck**. The interface offers one-click **Simplified Chinese / English** switching. Swipe horizontally through the deck, tap any card to draw it, and reveal the reading when the spread is complete. Tarot supports upright/reversed readings, Major and Minor Arcana filters, and the Chapter 6 layouts. Mystagogus and LXXXI remain upright-only because their guidebooks do not provide reversed meanings. The experience is optimized for comfortable one-handed use on mobile devices.

This project is not affiliated with, sponsored by, or endorsed by Quareia, Josephine McCarthy, the associated artists, or any publisher.

## Why This Project Exists

I wanted to use an online divination service, but its upright-only mode required payment and I could not find a way to draw the Major and Minor Arcana separately. Since I did not want to pay for those features, I built my own.

## Use It Online

Open:

https://hedanbaomi.github.io/tarot-divination-site/

The core reading experience is a static frontend that runs in any modern browser. The announcements list makes an identifier-free, read-only request to the project's Cloudflare Worker; network failure never blocks a reading.

## Android App

This project also provides a free offline Android version (`android-demo/`), wrapping the website into a phone-friendly offline experience:

- The same three decks (Tarot / Mystagogus / LXXXI), Simplified Chinese / English switching, and local reading history as the website
- Core features are fully offline and require no account; anonymous usage statistics (disable them anytime from the About screen), announcement/update checks, and external links need network access
- Requires Android 7.0 (API 24) or newer. Download the release-signed APK from GitHub Releases:

**[Download the Android APK](https://github.com/hedanbaomi/tarot-divination-site/releases)**

Build and release instructions live in [`android-demo/README.en.md`](android-demo/README.en.md). The repository contains the full application source code, excluding the LXXXI card decryption implementation and key material (see `.gitignore` and the "Open-Source Boundary" section in android-demo); the complete card functionality is provided only by the official APK.

## Features

- **Three decks**: 78-card Tarot, 78-card Mystagogus, and 81-card LXXXI, selectable in the reading settings.
- **Bilingual interface**: switch between `zh-CN` and `en` from the main screen. The preference is saved in the current browser, and the interface, card names, keywords, meanings, spread descriptions, history, and accessibility text change together.
- All three decks can use compatible layouts from the other deck families. The Four Seasons Spread is Tarot-only because each position restricts the eligible suit or Major Arcana pool.
- Tarot filters: all cards, Major Arcana only, Minor Arcana only, Major then Minor, or Minor then Major.
- Tarot supports upright-only and mixed upright/reversed readings. Mystagogus and LXXXI are upright-only, and the mixed-orientation option is disabled automatically for them.
- The deck is displayed as a horizontally scrollable row. Tap any card you want instead of being limited to the top card.
- Drawn cards move automatically into fixed spread positions with no dragging required.
- Tarot includes 16 selectable layouts: the 14 layouts from Chapter 6, plus the horizontal three-card spread and the Four Seasons Spread.
- The Four Seasons Spread presents five separate eligible pools in sequence: Wands, Cups, Swords, Pentacles, and Major Arcana.
- The Overview Layout supports the guidebook's 26-card split-deck method: place 13 Major Arcana cards as causes or underlying powers, then overlay 13 Minor Arcana cards as their concrete effects.
- Mystagogus includes the 18-card Mystagogus Layout.
- LXXXI includes four layouts from Chapter 10 of its guidebook: Foundation / Mystical Map (16 cards), Tree of Life (mystical and simple methods), and Four Directions.
- Position numbers, names, and meanings are displayed together as each card enters its assigned place.
- Removing another card never shifts fixed positions; the next draw fills the missing position.
- Reveal cards individually, or use **Reveal & Interpret** to turn over the entire completed spread.
- Reversed Tarot cards rotate automatically, with a 3D reveal animation.
- Any drawn card can be removed and returned to the deck.
- Mobile-first interaction with large touch targets, one-handed controls, and safe-area support for notched screens.
- Revealed readings show keywords and concise interpretations based on the sources described below.
- After **Reveal & Interpret**, tap any card in the spread to flip between its artwork and meaning without scrolling to the results section.

## Run Locally

Open `index.html` directly in a browser. No build step or server is required.

## Using a Spread

1. In **Reading Setup**, choose a deck, spread, orientation, and any available card-pool filter.
2. Draw cards in the order shown by the page. Each card enters its fixed position automatically.
3. When the spread is complete, choose **Reveal & Interpret**. Tap any card in the spread to view its meaning, and tap again to return to the artwork. You can also expand **View position guide** to compare each position with its meaning.

The Chapter 6 Tarot layouts are: Simple Yes / No, Tree of Life, Overview, Event, Direction / Location, Resources, Timing, Manifestation / Cause, Solution, Health, Fate Pattern, Angel, Landscape, and Self Map. The website also provides a horizontal three-card spread.

Mystagogus provides its 18-card signature layout. LXXXI provides four Chapter 10 layouts: Foundation / Mystical Map (16 cards), Tree of Life using either the mystical or simple method, and Four Directions.

## Project Structure

```text
.
├── README.md
├── README.en.md
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   ├── i18n.js
│   ├── i18n-data-en.js
│   ├── spreads.js
│   ├── history-records.js
│   ├── history-store.js
│   ├── history-ui.js
│   ├── celestial-sky.js
│   ├── tarot-data.js
│   ├── mystagogus-data.js
│   └── lxxxi-data.js
├── assets/
│   ├── cards/          # Card artwork and third-party source notices
│   │   ├── m/          # Mystagogus faces m-01…m-78 and m-back
│   │   └── LXXXI_SOURCE.md
│   └── icons/
├── android-demo/       # Offline Android app (source and build instructions)
├── backend/            # Optional companion API service for the app (local development)
└── telemetry-worker/   # Cloudflare Worker for anonymous usage statistics
```

## Content and Source Notes

- **Tarot** interpretations are edited and rewritten for this website with reference to *Tarot Skills for the 21st Century* and the Quareia training context.
- **Mystagogus** keywords and layout information are based on Josephine McCarthy's *Mystagogus* keyword index and layout PDF. The card artwork and content derived or translated from third-party publications are outside the AGPL/MPL open-source grants.
- **LXXXI** Simplified Chinese meanings are adapted from the Traditional Chinese *LXXXI Quareia Magician's Deck Guidebook*, while its layouts follow Chapter 10. The LXXXI artwork and related text are © Josephine McCarthy, Stuart Littlejohn, and Cassandra Beanland, used with written permission under the protected-material non-commercial conditions, and are excluded from the AGPL/MPL open-source grants. Related visual assets are used only in the authorised product surfaces and are not distributed with the public source repository; access does not grant visitors the right to copy or redistribute the artwork.
- **English support** is based on the English reference material stored locally in `en/`. Card names, keywords, meanings, and spread descriptions used by the website are concise edited summaries rather than page-by-page reproductions. The original PDFs are not runtime website assets. Text derived from those sources is outside the AGPL/MPL open-source grants.
- The Health Layout is provided only as a record of the spread structure and for personal reflection. It is not a substitute for medical diagnosis, treatment, or other professional advice.

## Card Image Sources

- Tarot: 78 Rider–Waite–Smith faces are local 420px derivatives from Wikimedia Commons' public-domain “Roses & Lilies” set. See [`assets/cards/SOURCE.md`](assets/cards/SOURCE.md).
- Mystagogus: local JPEG display derivatives in `assets/cards/m/`, plus the shared `m-back.jpeg`. Source materials © Josephine McCarthy. See [`assets/cards/m/SOURCE.md`](assets/cards/m/SOURCE.md).
- LXXXI — The Magician's Deck: visual assets are available only for the site's runtime presentation and are not distributed in this public source repository. Source art is attributed to Josephine McCarthy, Stuart Littlejohn, and Cassandra Beanland. See [`assets/cards/LXXXI_SOURCE.md`](assets/cards/LXXXI_SOURCE.md).

For the complete rights boundaries and attributions, see [`ATTRIBUTIONS.md`](ATTRIBUTIONS.md) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Contributors ✨

Thanks to the following contributor:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<table>
  <tr>
    <td align="center" valign="top" width="14.28%">
      <a href="https://github.com/WeirdCorn">
        <img src="https://github.com/WeirdCorn.png" width="100px;" alt="WeirdCorn"/><br />
        <sub><b>WeirdCorn</b></sub>
      </a><br />
      <span title="Physical LXXXI deck scans">📷</span>
    </td>
  </tr>
</table>
<!-- ALL-CONTRIBUTORS-LIST:END -->

<sub>📷 Physical LXXXI deck scans</sub>

## Attribution

This is an unofficial tool and does not imply endorsement by Quareia or by the authors. Written permission from Josephine McCarthy covers the GitHub Pages website and Android application; on 2026-08-05 she separately agreed to extend the protected-material use to the WeChat Mini Program. Mystagogus/LXXXI artwork, meanings, translations, layouts, and related authorised material must remain non-commercial, be protected from misuse, and stay outside AGPL, MPL, and the Mini Program proprietary software licence. The third-party cards and text are not covered by AGPL-3.0-only or MPL-2.0:

- **Mystagogus**: © Josephine McCarthy.
- **LXXXI — The Magician's Deck**: © Josephine McCarthy, Stuart Littlejohn, and Cassandra Beanland.

The official Quareia website is <https://www.quareia.com>. For the full rights boundaries, see [`ATTRIBUTIONS.md`](ATTRIBUTIONS.md) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

> "while digital tools for readings can be useful in an emergency, the interaction between the physical hands of the reader touching and shuffling the deck is safer, a lot more accurate and far more powerful" — Josephine McCarthy

## Android Boundary (documentation only)

Josephine McCarthy's written permission covers the GitHub Pages website and Android application (`android-demo/`); the WeChat Mini Program received a separate extension on 2026-08-05. The non-commercial condition applies to Mystagogus/LXXXI artwork, meanings, translations, layouts, and related authorised materials—not as a general commercial-use ban on project-authored software, infrastructure, or unrelated independent services. The protected materials may not be sold, paywalled or offered as a paid unlock, separately distributed for commercial purposes, sublicensed, or placed under AGPL, MPL, or the Mini Program proprietary software licence. Commercial use involving those materials requires separate permission from the relevant rights holders. This notice does not claim that Josephine has approved any particular commercial model. The LXXXI card decryption implementation and key material are not published with the open-source repository; the complete card faces are provided only through the official APK.

## License

This repository uses a file/directory licence map: project-authored software for the root website, `backend/`, and `telemetry-worker/` is `AGPL-3.0-only`; public Android native code and software assets distributed in `android-demo/` are `MPL-2.0`. Third-party artwork, meanings, translations and adaptations, plus the private LXXXI provider/Vault/material/qv, are excluded from both open-source grants. Historical MIT permissions already received for `v1.2.0` and earlier remain valid. See [`LICENSE.md`](LICENSE.md), [`ATTRIBUTIONS.md`](ATTRIBUTIONS.md), and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

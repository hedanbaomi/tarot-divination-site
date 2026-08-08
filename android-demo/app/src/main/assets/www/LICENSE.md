# Android bundled web-assets licence boundary

This directory is an Android application bundle, not the root website's
licence root.

Project-authored executable web software in this bundle is distributed under
MPL-2.0. This includes the HTML/CSS/JavaScript application structure and the
Android-only bridge/host adaptations. Equivalent project-authored source in
the root website is separately distributed under AGPL-3.0-only.

The following categories are excluded from MPL-2.0 even when stored inside a
JavaScript, HTML, image, or data file:

- Tarot, Mystagogus, and LXXXI meanings, keywords, layout text, translations,
  adaptations, and publication-derived expressions;
- Mystagogus and LXXXI artwork and all other separately authorised artwork;
- quotations and third-party prose;
- public-domain images, which remain public domain rather than becoming
  MPL-licensed.

In particular, `tarot-data.js`, `mystagogus-data.js`, `lxxxi-data.js`,
`i18n-data-en.js`, and `spreads.js` are mixed software/content files. MPL-2.0
applies only to their project-authored executable structure; it does not grant
rights in the embedded or referenced excluded content. The card-image
directories and asset source notices likewise remain outside MPL-2.0.

Written permission covers use of the protected Mystagogus/LXXXI materials in
the website and Android application, with a separate 2026-08-05 extension for
the WeChat Mini Program. Their non-commercial conditions apply only to those
materials: they may not be sold, paywalled or paid-unlocked, separately
commercially distributed, sublicensed, or placed under a software licence.
Commercial use requires separate permission. This does not create a general
commercial-use restriction on project-authored software, infrastructure, or
unrelated services, and it does not claim approval of a particular commercial
model.

Private protected LXXXI routes may resolve assets supplied from gitignored
release inputs. Their private providers, vault/key material, and `assets/qv/`
are not licensed by this notice and must never be committed to the public
repository.

See [`../../../../../../LICENSE.md`](../../../../../../LICENSE.md),
[`../../../../../../ATTRIBUTIONS.md`](../../../../../../ATTRIBUTIONS.md), and
the `assets/cards/**/SOURCE.md` notices for the complete rights map.

# Quareia Divination license map

Copyright (c) 2026 hedanbaomi.

This repository is intentionally multi-licensed. A file is licensed only under
the scope assigned below; the presence of a file in this repository or in an
Android application bundle does not extend an open-source licence to excluded
content.

## AGPL-3.0-only: website and server software

Unless a narrower notice or an exclusion below applies, project-authored
software for the root website, its tests and maintenance tools, `backend/`, and
`telemetry-worker/` is licensed under the GNU Affero General Public License,
version 3 only (`AGPL-3.0-only`). The full text is in
[`LICENSES/AGPL-3.0-only.txt`](LICENSES/AGPL-3.0-only.txt).

This includes the executable structure of the website, but not third-party
artwork, meanings, translations, adaptations, quotations, or other copyrighted
content embedded in or loaded by that software.

## MPL-2.0: public Android software

Unless a narrower notice or an exclusion below applies, project-authored public
Android native/host code, Android-specific resources, Gradle project
configuration, and Android tests under `android-demo/` are licensed under the
Mozilla Public License 2.0 (`MPL-2.0`). The full text is in
[`LICENSES/MPL-2.0.txt`](LICENSES/MPL-2.0.txt).

The Android application also bundles web assets under
`android-demo/app/src/main/assets/www/`. Project-authored software in that
bundle is distributed as part of the Android application under MPL-2.0, even
where an equivalent source file is distributed in the root website under
AGPL-3.0-only. This separate distribution is possible because the project
author owns both copies. The exact mixed-content boundary is documented in
[`android-demo/app/src/main/assets/www/LICENSE.md`](android-demo/app/src/main/assets/www/LICENSE.md).

The Gradle wrapper and third-party dependencies retain their own upstream
licences and are not relicensed under MPL-2.0.

## Content excluded from AGPL-3.0-only and MPL-2.0

No open-source rights are granted by this repository for any third-party or
separately authorised content, including:

- Mystagogus and LXXXI card artwork, card meanings, layouts, translations,
  adaptations, and material derived from third-party publications;
- other third-party card meanings, artwork, quoted text, translations,
  adaptations, and publication-derived data;
- the original English or Chinese reference publications and local private
  source material used to prepare concise display text;
- public-domain works, which remain public domain and are not claimed as
  project-authored software.

Josephine McCarthy's written permission covers use of the protected Mystagogus
and LXXXI materials in this website and Android application. A separate
extension dated 2026-08-05 covers their use in the WeChat Mini Program. The
covered artwork, meanings, translations, layouts, and related authorised
material must remain non-commercial and reasonably protected from misuse. They
may not be sold, placed behind a paywall or paid unlock, distributed separately
for commercial purposes, sublicensed, or included under AGPL-3.0-only,
MPL-2.0, or the Mini Program's proprietary software licence. Commercial use of
those materials requires separate permission from the relevant rights holders.

These content conditions do not impose a general non-commercial restriction on
project-authored software, infrastructure, or unrelated independent services,
and this notice does not claim that Josephine McCarthy has approved any
particular commercial model. The permission is separate from, and is not
sublicensed through, the software licences. The repository does not grant
downstream users permission to extract, reuse, copy, or redistribute the
protected materials. See [`ATTRIBUTIONS.md`](ATTRIBUTIONS.md) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

Some JavaScript/data files combine executable structure with excluded text or
data. The licence applies only to the project-authored software portions; the
excluded expressions remain under their separate copyright terms. See the
directory licence maps before copying such files.

## Private LXXXI Android implementation excluded

The private Android LXXXI implementation and material are not part of the
public open-source grant. This includes, without limitation:

- `PrivateLxxxiAssetProvider.kt`;
- `LxxxiVault.kt`;
- `VaultMaterial.kt`;
- `android-demo/app/src/main/assets/qv/`;
- generated vault/key material and equivalent gitignored private inputs.

These files are private, local/release inputs. They are neither AGPL-licensed
nor MPL-licensed, must not be committed to the public repository, and must not
be inferred to be licensed merely because they are linked into a release APK.

## WeChat Mini Program is a separate proprietary repository

`占卜小程序/` is a nested, independent Git repository. Its project-authored code
is Proprietary / All Rights Reserved, subject to its own future repository-level
notice. The 2026-08-05 written extension for the Mini Program applies only to
the separately authorised card content; that content remains subject to the
non-commercial material restrictions above and is not claimed as proprietary
source code. Nothing in this repository's AGPL/MPL map licenses the Mini
Program.

## Historical MIT grants remain valid

Quareia Divination v1.2.0 and earlier releases were offered under the scoped MIT
terms that accompanied those versions. Those already-granted permissions are
not revoked. A copy of that complete historical scoped licence notice is retained in
[`LICENSES/MIT-historical.txt`](LICENSES/MIT-historical.txt).

The AGPL/MPL structure above applies prospectively to project-authored changes
distributed from the licence-migration commit onward. It does not change the
`v1.2.0` tag or retroactively remove rights received under an earlier version.

## Attribution and upstream notices

All copyright statements, protected-material permission conditions,
public-domain source records, and upstream dependency licences remain in force. Consult
[`ATTRIBUTIONS.md`](ATTRIBUTIONS.md),
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), the asset `SOURCE.md` files,
and dependency metadata together with this map.

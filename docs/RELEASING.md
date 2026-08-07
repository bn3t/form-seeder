# Releasing to the Chrome Web Store

Dashboard: https://chrome.google.com/webstore/devconsole
Submit from your registered Chrome Web Store publisher account.

## What the Web Store requires

### One-time, before the first submission

1. **Registration fee** — US$5, once per developer account, non-refundable.
   Paid in the dashboard. Until it's paid you cannot submit anything.
2. **Verified contact email** — set it in the dashboard's *Account* tab and
   click through the verification mail. Submissions are rejected without it.
3. **Publisher display name** — what users see under the listing. Use your name
   or a project name; it appears publicly.
4. **Two-Step Verification** on the Google account — required to publish.
5. **A public privacy policy URL** — see below.

### Per submission

- A `.zip` with `manifest.json` at its root (`./scripts/package.sh` builds it).
- A version in `manifest.json` strictly higher than the published one. Chrome
  compares dot-separated integers, so `1.0.1` > `1.0.0`; you cannot re-upload
  the same version, even after a rejection.
- Store listing copy, a 128×128 store icon, and at least one screenshot
  (1280×800 or 640×400). Copy for all of it is in `docs/store-listing.md`.
- Privacy practices: a single-purpose statement, a justification for **each**
  permission, and the data-usage disclosures. Prefilled in
  `docs/store-listing.md`.
- A privacy policy URL that resolves publicly, without a login.

### Review

Expect a few days; simple extensions with no host permissions and no remote code
are usually toward the fast end, but Google gives no SLA and a first submission
from a new account often takes longer. Form filling is a category reviewers look
at carefully — the listing copy in `docs/store-listing.md` deliberately leads
with "developer tool, test data, you write the mapping" for that reason.

If it's rejected you get an email naming the policy. Fix, bump the version,
resubmit.

## Choosing a visibility

You have to pick this on the Distribution tab. The tradeoff:

| | Public | Unlisted | Private |
| --- | --- | --- | --- |
| Who can install | Anyone | Anyone with the link | Only your trusted testers / Workspace domain |
| Appears in search & category browsing | Yes | No | No |
| Reviewed by Google | Yes | Yes | Yes |
| Screenshots & full listing polish | Expected | Nice to have | Barely matters |
| Auto-updates for users | Yes | Yes | Yes |

**Recommendation: start Unlisted.** You get the real thing — signed, auto-updating,
installable by your team with a link — without needing a polished listing or
attracting installs from people who will be confused by a YAML config file.
Flipping Unlisted → Public later is a one-field change on an already-approved
item, and it goes through review again but from a known-good baseline.

Pick **Private** instead only if this is strictly internal and you want it
invisible to anyone outside your tester list or Workspace domain. Pick
**Public** from the start only if you actually want strangers to find it — in
which case invest in the screenshots first, because the listing is the whole
first impression.

## Cutting a release

```bash
# 1. Bump the version in manifest.json (e.g. 1.0.0 -> 1.1.0)
#    Semver-ish: patch for fixes, minor for new rule-format features,
#    major for a breaking config change.

# 2. Sanity-check the build as Chrome will see it
./scripts/package.sh
#    -> dist/form-seeder-<version>.zip, and it prints the file list.
#       Read that list. Nothing but runtime files should be in it.

# 3. Load the *unzipped* dist content once at chrome://extensions
#    (Load unpacked) and click through: popup on a matching page, options
#    editor, validate, save, export, import.

# 4. Commit and tag
git commit -am "chore: release v1.1.0"
git tag v1.1.0
git push && git push --tags
```

Then in the dashboard: **your item → Package → Upload new package**, attach the
zip, update the listing if the feature set changed, and **Submit for review**.

If the config format changed, `README.md` and `validateConfig()` in
`lib/config.js` must move together — that's the rule in `CLAUDE.md`, and a
release is the moment it bites.

## Checklist before you hit submit

- [ ] `manifest.json` version bumped and higher than what's published
- [ ] `./scripts/package.sh` run, file list read, no stray files
- [ ] Unpacked build smoke-tested in Chrome
- [ ] `README.md` matches the current rule format
- [ ] `PRIVACY.md` still accurate, `Last updated` date bumped if it changed
- [ ] Privacy policy URL loads in a logged-out browser
- [ ] Permission justifications match the permissions actually in the manifest
- [ ] Listing description reflects any new capability
- [ ] Git tag pushed

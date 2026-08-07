# Privacy Policy — Form Seeder

**Last updated:** 6 August 2026
**Contact:** open an issue at https://github.com/bn3t/form-seeder/issues

## Summary

Form Seeder does not collect, transmit, sell or share any data. It has no
server, no analytics, no telemetry and no network calls of any kind. Everything
it stores stays inside your own browser.

## What the extension stores

One thing: the YAML configuration you write on the Options page — your rules
(URL patterns, CSS selectors and the test values you choose). It is saved in
`chrome.storage.local`, which is local to your browser profile on your device.

Nothing else is persisted. There is no user account, no identifier, no usage
history, no record of the pages you visit or the forms you fill.

## What the extension reads

When you click the Form Seeder toolbar icon on a page, and only then, the
extension:

1. Reads the current tab's URL, to decide which of your rules apply to it.
2. Runs a script in that tab to check whether a rule's optional `pageSelector`
   is present in the page, and — when you click a profile button — to write your
   configured values into the matching form fields.

Both are transient, in-memory operations that happen while the popup is open.
Neither the page's content nor its URL is stored, logged or sent anywhere. The
extension requests no `host_permissions`; it uses Chrome's `activeTab`
permission, which grants access to a single tab only as a result of you clicking
the extension icon, and expires when you navigate away.

## Data sharing

None. No data leaves your device. Because there is no transmission, there is no
third party to name and no transfer to disclose.

## Data you export yourself

The Options page has an **Export** button that downloads your configuration as a
`.yaml` file to your own computer. That file is yours; the extension does not
upload it anywhere. Note that any test values you have written into your rules
are contained in it — treat it accordingly, and do not put real credentials or
real personal data into your rules.

## Removing your data

Removing the extension from `chrome://extensions` deletes its local storage,
including your configuration. Export first if you want to keep it.

## Permissions and why they exist

| Permission | Why |
| --- | --- |
| `storage` | Save your YAML configuration locally. |
| `activeTab` | Read the current tab's URL and allow a script to run in it, only after you click the extension icon. |
| `scripting` | Inject the script that checks the page selector and fills the form fields. |

The extension declares no host permissions and runs no background service worker
and no content scripts. It does nothing at all until you click its icon.

## Limited Use compliance

Form Seeder's use of information received from Google APIs adheres to the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
including the Limited Use requirements. As stated above, no user data is
collected or transmitted.

## Changes

Any change to this policy will be published in this file in the project
repository, with an updated date at the top.

## Source

Form Seeder is open source (MIT): https://github.com/bn3t/form-seeder

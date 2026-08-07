# Chrome Web Store listing — copy & answers

Everything below is meant to be pasted into the Developer Dashboard. Nothing
here is loaded by the extension.

Submit from your registered Chrome Web Store publisher account.

---

## Store listing tab

### Extension name (max 75 chars)

```
Form Seeder — test data for web forms
```

Fallback if you prefer the plain name (must match `manifest.json` closely
enough not to confuse reviewers):

```
Form Seeder
```

### Summary / short description (max 132 chars, plain text, no ALL CAPS)

```
Fill web forms with named sets of test data. You map the fields yourself with CSS selectors and URL patterns, in one YAML file.
```

(129 characters.)

### Category

**Developer Tools**

### Language

English

### Detailed description

```
Form Seeder fills web forms with test data you define yourself. It is a
developer tool: if you build an app with a long creation form and retype the
same twelve fields forty times a day, this stops that.

There is no magic. Form Seeder never guesses what a field means. You write the
mapping — a CSS selector and a value — and it does exactly that, in the order
you wrote it.

HOW IT WORKS

Rules live in a single YAML config on the Options page. A rule says: on these
URLs, offer these named sets of test data. Click the toolbar icon on a matching
page and you get one button per data set. Click a button and the form is filled,
with a summary: "7 fields filled, 1 selector not found".

WHAT IT HANDLES

• Text inputs, textareas, native selects, checkboxes and radio buttons
• React, Vue and Angular controlled inputs — values are set through the native
  property setters and real input/change events are dispatched, so frameworks
  actually register the change
• Angular Material mat-select — the panel is opened and the option matching the
  visible label is clicked, the way a user would
• Dynamic forms — each selector is polled briefly, so a field revealed by an
  earlier one is found; a slow panel can be given its own wait budget
• Clicking and submitting — a step can click a button or submit a form, in the
  middle of a profile, so a click that reveals more fields is just another step
• Profile inheritance — twenty shared fields in a base profile, and a variant
  that overrides two of them and drops a third

URL MATCHING

URL patterns are anchored globs, where * spans slashes too:
https://*.myapp.example/users/*/edit. Fragments and trailing slashes are
ignored. When the URL alone can't identify a page — a single-page app, a modal
dialog — add a pageSelector: a CSS selector that must also be present in the DOM
for the rule to be offered.

SHARING RULES

Export the config as YAML and version it next to your app's repository, so a
new developer on the team gets the same seed data on day one. Import replaces
the config; saving is always explicit and an invalid config is never saved.

PRIVACY

No servers, no analytics, no telemetry, no network calls. Your config is stored
locally in your browser and never leaves your device. The extension asks for no
host permissions and does nothing at all until you click its icon: it then reads
the current tab's URL to pick matching rules and injects the fill script into
that one tab.

Do not put real credentials or real personal data in your rules. This is a tool
for test data.

SCOPE

Top frame only. No iframes, no shadow DOM piercing, no contenteditable, no
generated values. Deliberately.

Open source (MIT): https://github.com/bn3t/form-seeder
```

---

## Privacy practices tab

### Single purpose description

```
Form Seeder fills forms on web pages with test data that the user has defined
in advance, using CSS selectors and URL patterns the user writes themselves.
That is its only function.
```

### Permission justifications

**`storage`**

```
Stores the user's own configuration — the YAML document containing their URL
patterns, CSS selectors and test values — in chrome.storage.local so it
persists between browser sessions. This is the only thing the extension
persists, and it never leaves the device.
```

**`activeTab`**

```
When the user clicks the extension's toolbar icon, the extension needs the
current tab's URL to decide which of the user's rules apply to that page, and
needs to run a script in that tab to fill the form. activeTab grants exactly
that — access to one tab, only as a result of the user's click. It is used in
place of host permissions so the extension has no standing access to any site.
```

**`scripting`**

```
Filling a form requires running code in the page. chrome.scripting.executeScript
is used, only on a user click, for two things: checking whether a rule's
optional pageSelector exists in the DOM, and writing the user's configured
values into the form fields they selected. The injected code is bundled with the
extension; no remote code is fetched or executed.
```

**Remote code:** answer **No, I am not using remote code.**
All JavaScript is bundled in the package. js-yaml 4.1.0 (MIT) is vendored in
`vendor/`. There is no `eval`, no `new Function`, no `fetch`, no CDN.

### Data usage disclosures

Check **nothing** in the data-collection list, then certify all three
statements. Under Chrome's definition, "collect" means transmitting data off the
device — Form Seeder transmits nothing.

| Data type | Collected? |
| --- | --- |
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | No |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity | No |
| Website content | No |

Certifications to tick:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

Host `PRIVACY.md` at a public, stable URL. Simplest option, once the GitHub repo
is public:

```
https://github.com/bn3t/form-seeder/blob/main/PRIVACY.md
```

If you'd rather have a plain page, enable GitHub Pages on the repo and use
`https://bn3t.github.io/form-seeder/privacy.html`. Either is accepted; the URL
must resolve without a login.

---

## Graphic assets you must supply

| Asset | Spec | Required |
| --- | --- | --- |
| Store icon | 128×128 PNG, square, no transparency around the edge preferred | Yes |
| Screenshot | 1280×800 or 640×400 PNG/JPEG, 1–5 of them | Yes, at least 1 |
| Small promo tile | 440×280 PNG/JPEG | No (needed only for featuring) |
| Marquee promo tile | 1400×560 PNG/JPEG | No |

Suggested screenshots, if you want the listing to explain itself: (1) the popup
open on a form with two profile buttons; (2) the options form editor with a rule
selected; (3) the raw YAML view.

---

## Distribution tab

- **Visibility:** see `docs/RELEASING.md` for the tradeoff between Public,
  Unlisted and Private.
- **Regions:** all.
- **Pricing:** free.

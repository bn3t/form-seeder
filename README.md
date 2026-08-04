# Form Seeder

Chrome extension (Manifest V3) that fills web forms with named test data sets,
mapped precisely via CSS selectors and URL glob patterns. Config is a single
YAML document. Built for developers seeding forms with repeatable test data
while building their own apps — no "smart" auto-detection.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder

No build step; everything runs as-is (js-yaml is vendored in `vendor/`).

## How it works

Everything the extension does is driven by **rules** you write. A rule says
*"on these pages, offer these named sets of test data"*. When you click the
extension icon, the popup shows the rules matching the current page and one
button per data set; clicking a button fills the form and reports a summary
("7 fields filled, 1 selector not found").

Rules are edited on the **Options** page — either in the form editor or in the
raw YAML view — and stored as YAML in the extension's local storage.

The form editor is a two-pane view: a filterable rule list on the left (filter
matches the rule name, its URL patterns, page selector and profile names) and
the selected rule's editor on the right, where profiles can be collapsed
individually or all at once.

---

# Writing rules

## Anatomy of a rule

A rule is one entry under `matchers`:

```yaml
matchers:
  - name: "User creation form"        # required — shown as a heading in the popup
    urlPatterns:                      # required — at least one; any may match
      - "https://local.myapp.dev/users/new"
      - "https://test.myapp.be/users/new"
    pageSelector: "form#user-create"  # optional — see "Page selector" below
    profiles:                         # required — at least one
      - name: "Test user 1"           # required — the popup button label
        fields:                       # selector/value pairs, filled in order
          - selector: "#firstName"
            value: "Jean"
          - selector: "input[name=email]"
            value: "jean.dupont@test.be"
```

| Key | Level | Required | Meaning |
| --- | --- | --- | --- |
| `name` | rule | yes | Non-empty label shown in the popup |
| `urlPatterns` | rule | yes | Non-empty list of URL globs |
| `pageSelector` | rule | no | CSS selector that must exist in the DOM |
| `profiles` | rule | yes | Non-empty list of data sets |
| `name` | profile | yes | Non-empty button label |
| `fields` | profile | yes | List of `{selector, value}` (may be empty) |
| `selector` | field | yes | Any CSS selector valid for `querySelector` |
| `value` | field | yes | Scalar — string, number or boolean, coerced to string |
| `waitMs` | field | no | Poll budget for this selector, in ms (default 300, max 60000) |

Multiple rules may match the same page; the popup shows all of them, each with
its own set of profile buttons.

## URL patterns

- Glob-style and **anchored** — the pattern must match the whole URL. `*`
  matches anything, **including `/`**.
- `#fragment` is always ignored.
- A pattern without `?` implicitly accepts any query string; a pattern
  containing `?` is matched literally.
- Trailing slash differences are ignored.

```yaml
urlPatterns:
  - "https://local.myapp.dev/users/new"      # also matches ...?foo=1 and a trailing /
  - "https://*.myapp.be/users/*/edit"        # * spans slashes too
  - "https://local.myapp.dev/search?q=test"  # literal: only this query string
```

## Page selector (DOM-based matching)

When the URL alone doesn't identify a page (e.g. an SPA where everything lives
under one URL), add a `pageSelector`. The rule is then active only when a URL
pattern matches **and** that CSS selector exists in the page's DOM (checked
when the popup opens).

The check is a snapshot taken when the popup opens, not a live watch — the
extension has no view of the page in between. So if the form lives in something
that appears later — a modal dialog, a wizard step, a lazily rendered panel —
bring it up on the page **first**, then open the popup. Reopening the popup
re-runs the whole match, so a rule can appear or disappear as you open and close
a dialog.

This is also how you scope a rule to a dialog: point `pageSelector` at something
only the dialog renders, e.g. `lib-add-occupation-dialog` or
`mat-dialog-container [data-cy="bce-input"]`.

```yaml
matchers:
  - name: "User creation form"
    urlPatterns:
      - "https://local.myapp.dev/*"
    pageSelector: "form#user-create"
    profiles:
      - name: "Test user 1"
        fields: []
```

## Value conventions

- **Checkbox / radio**: `"true"` or `"1"` checks, anything else unchecks.
  Target a specific radio with `input[name=gender][value=f]` and value `"true"`.
  These are filled with a real `click()` when the state must change (component
  libraries like Angular Material read the click, not `change`), so target the
  native `<input>`, not the wrapper component.
- **`<select>`**: the value must equal an option's `value` attribute, not its
  visible text.
- **Angular Material `<mat-select>`**: target the `mat-select` element itself
  and give the option's **visible label** (`"Travail"`), trimmed and matched
  case-insensitively. This is the opposite of a native `<select>` — a
  `mat-select` keeps its value in the component, so the label is all the DOM
  offers. The panel is opened with a click and the matching `mat-option` is
  clicked, exactly as a user would; if no label matches, the panel is closed
  again and the field is reported as skipped, with the available labels logged
  to the page console.
- **Date / time inputs**: `yyyy-mm-dd`, `HH:MM`, `yyyy-mm-ddTHH:MM`.
- Values are set through the native prototype setters and `input`/`change`
  events are dispatched, so React/Vue/Angular controlled inputs pick up the
  change.

## Field order and dynamic forms

Fields are filled top to bottom, and an earlier field may reveal a later one
(picking a type unlocks an extra input). Each selector is polled for a short
window (300 ms by default) before being given up on, so order dependent fields
naturally. That budget is also what a *wrong* selector costs before it is
reported as skipped — hence the default stays short.

When something genuinely takes longer to appear — a panel rendered after a
server round-trip, an animated dialog — give that one field its own budget with
`waitMs` rather than slowing every selector down:

```yaml
- selector: 'textarea[data-cy="justificationInput"]'
  value: "Doute sur la validité du C4."
  waitMs: 2000
```

`waitMs` is a whole number of milliseconds, 0 to 60000. In the form editor it is
the narrow third box on the field row; leave it blank for the default. For a
`mat-select` the same budget also covers the option panel opening.

## Validating and sharing rules

- **Validate** checks YAML syntax and the schema, reporting errors with a path
  such as ``matcher 1 'User creation form' › profile 'Test user 1' › field 3``.
- **Save** persists the config; an invalid config is never saved.
- **Export** downloads the YAML — version it alongside your app's repo.
- **Import** loads a `.yaml` file into the raw editor for review. Saving stays
  explicit, and import **replaces** the whole config (no merge).

## Out of scope (v1)

No iframes, no shadow DOM piercing, no dynamic value generation, no
contenteditable, no merge on import.

---

## Layout

```
manifest.json     MV3 manifest (storage, scripting, activeTab — no host_permissions)
popup.html/js     rule lookup for the active tab, profile buttons, fill injection
options.html/js   form editor + raw YAML view + export/import
lib/config.js     shared glob matching + schema validation
vendor/js-yaml.min.js   vendored js-yaml 4.1.0 (MIT)
```

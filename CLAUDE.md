# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project

**Form Seeder** — a Chrome Manifest V3 extension that fills web forms with named
test-data sets. Mapping is explicit: CSS selectors + URL glob patterns, defined
in a single YAML config. There is deliberately no "smart" field auto-detection.

No build step, no package manager, no tests. Everything is plain ES2020 loaded
directly by Chrome; js-yaml is vendored. To try a change: `chrome://extensions`
→ Developer mode → Load unpacked → this folder, then hit **Reload** on the
extension card after editing.

## Layout

```
manifest.json           MV3 manifest — permissions: storage, scripting, activeTab (no host_permissions)
popup.html/js           finds matchers for the active tab, renders profile buttons, injects the fill script
options.html/js         form editor + raw YAML view + validate/save/export/import
lib/config.js           shared: URL glob → RegExp, config validation, loadConfig()
vendor/js-yaml.min.js   js-yaml 4.1.0 (MIT), vendored
icons/                  16/48/128 action icons
```

## Architecture notes

- `lib/config.js` is loaded via `<script>` into **both** popup and options —
  plain globals, no modules. Anything shared between the two belongs there.
- The config lives as a **YAML string** in `chrome.storage.local` under
  `configYaml`. It is parsed and validated on every read (`loadConfig()`);
  nothing else is persisted.
- `validateConfig()` is the single schema authority. It returns either
  `{ok:true, config}` with values coerced to strings, or `{ok:false, errors}`
  with human-readable paths (`matcher 1 'X' › profile 'Y' › field 3: ...`).
  Changing the config shape means changing this function *and* the README.
- Page access is `activeTab` + `chrome.scripting.executeScript` only, triggered
  by the user clicking the action. There is no content script and no background
  service worker doing work.
- `fillForm` and `probeSelectors` in `popup.js` are **injected** functions: they
  are serialized into the page, so they may not reference anything from the
  popup's scope. All input arrives through `args`.
- Filling deliberately uses native prototype setters + `input`/`change` events
  (React/Vue/Angular controlled inputs), and a real `click()` for
  checkbox/radio (Angular Material and friends read the click, not `change`).
  Don't "simplify" these into plain `element.value = ...`.
- Only the top frame is touched (`allFrames: false`). No iframes, no shadow DOM,
  no contenteditable — out of scope for v1.

## Rules

A **rule** here is a matcher entry in the YAML config (URL patterns, optional
page selector, and its named profiles of selector/value pairs).

> **When asked to create, edit or debug rules, read `README.md` first.** It is
> the authoritative reference for the rule format, URL-pattern semantics,
> page selectors and value conventions. Keep it in sync when the format changes.

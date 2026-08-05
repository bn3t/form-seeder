/*
 * Shared config logic: URL glob matching and schema validation.
 * Loaded via <script> in both popup.html and options.html.
 */
"use strict";

const STORAGE_KEY = "configYaml";

// How long a selector is polled for before it is given up on. Per-field
// `waitMs` overrides it; the ceiling exists because the popup is blocked for
// the whole budget, and a wrong selector pays it in full.
// NOTE: fillForm() in popup.js is injected into the page and cannot see this
// scope, so it carries its own copy of the default — keep the two in step.
const DEFAULT_WAIT_MS = 300;
const MAX_WAIT_MS = 60000;

// A field either sets a `value` or performs an `action`, never both.
// NOTE: fillForm() in popup.js is injected and carries its own knowledge of
// these names — keep the two in step.
const FIELD_ACTIONS = ["click", "submit"];

const DEFAULT_YAML = `# Form Seeder configuration
#
# matchers: group URL patterns with named test-data profiles.
#   urlPatterns are globs: * matches anything, including "/".
#   pageSelector (optional): CSS selector that must also exist in the page's
#     DOM for the matcher to be active — for apps where the URL alone doesn't
#     identify the page.
#   selectors are standard CSS selectors; values are always strings.
#
matchers:
  - name: "Example form"
    urlPatterns:
      - "https://example.com/users/new"
    profiles:
      - name: "Test user 1"
        fields:
          - selector: "#firstName"
            value: "Jean"
          - selector: "#lastName"
            value: "Dupont"
`;

/**
 * Convert a URL glob pattern to an anchored RegExp.
 * - Regex metacharacters in literal parts are escaped, then "*" becomes ".*"
 *   ("*" crosses "/" boundaries).
 * - If the pattern has no "?", an optional query string is implicitly allowed.
 * - A single trailing slash is stripped (except on a bare origin).
 */
function globToRegex(pattern) {
  const hasQuery = pattern.includes("?");
  let source = hasQuery ? pattern : stripTrailingSlash(pattern);
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, (ch) =>
    ch === "*" ? ".*" : "\\" + ch
  );
  const query = hasQuery ? "" : "(\\?.*)?";
  return new RegExp("^" + escaped + query + "$");
}

/** Strip a single trailing slash unless the path is just the origin root. */
function stripTrailingSlash(url) {
  const m = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+)(\/.*)?$/);
  if (!m) return url.endsWith("/") ? url.slice(0, -1) : url;
  const origin = m[1];
  let rest = m[2] || "";
  if (rest.length > 1 && rest.endsWith("/")) rest = rest.slice(0, -1);
  if (rest === "/") rest = "";
  return origin + rest;
}

/** Normalize a tab URL for matching: drop #fragment, strip trailing slash. */
function normalizeUrl(url) {
  const hashIndex = url.indexOf("#");
  const noFragment = hashIndex === -1 ? url : url.slice(0, hashIndex);
  if (noFragment.includes("?")) {
    const qIndex = noFragment.indexOf("?");
    return stripTrailingSlash(noFragment.slice(0, qIndex)) + noFragment.slice(qIndex);
  }
  return stripTrailingSlash(noFragment);
}

/** True if any of the matcher's urlPatterns matches the tab URL. */
function matcherMatchesUrl(matcher, tabUrl) {
  const url = normalizeUrl(tabUrl);
  return matcher.urlPatterns.some((pattern) => {
    try {
      return globToRegex(pattern).test(url);
    } catch (e) {
      console.warn("Form Seeder: invalid pattern", pattern, e);
      return false;
    }
  });
}

/**
 * Validate the parsed YAML structure.
 * Returns { ok: true, config } with field values coerced to strings,
 * or { ok: false, errors: [string] }.
 */
function validateConfig(data) {
  const errors = [];

  if (data === null || data === undefined) {
    return { ok: false, errors: ["Config is empty."] };
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ["Root must be a mapping with a 'matchers' key."] };
  }
  if (!Array.isArray(data.matchers)) {
    return { ok: false, errors: ["Root must have a 'matchers' array."] };
  }

  const config = { matchers: [] };

  data.matchers.forEach((matcher, mi) => {
    const mLabel = `matcher ${mi + 1}` +
      (matcher && typeof matcher.name === "string" ? ` '${matcher.name}'` : "");
    if (matcher === null || typeof matcher !== "object" || Array.isArray(matcher)) {
      errors.push(`${mLabel}: must be a mapping.`);
      return;
    }
    const out = { name: null, urlPatterns: [], profiles: [] }; // + optional pageSelector

    if (typeof matcher.name !== "string" || matcher.name.trim() === "") {
      errors.push(`${mLabel}: missing or empty 'name'.`);
    } else {
      out.name = matcher.name;
    }

    if (matcher.pageSelector !== undefined && matcher.pageSelector !== null) {
      if (typeof matcher.pageSelector !== "string" || matcher.pageSelector.trim() === "") {
        errors.push(`${mLabel}: 'pageSelector' must be a non-empty string.`);
      } else {
        out.pageSelector = matcher.pageSelector;
      }
    }

    if (!Array.isArray(matcher.urlPatterns) || matcher.urlPatterns.length === 0) {
      errors.push(`${mLabel}: 'urlPatterns' must be a non-empty array.`);
    } else {
      matcher.urlPatterns.forEach((p, pi) => {
        if (typeof p !== "string" || p.trim() === "") {
          errors.push(`${mLabel} › urlPattern ${pi + 1}: must be a non-empty string.`);
        } else {
          out.urlPatterns.push(p);
        }
      });
    }

    if (!Array.isArray(matcher.profiles) || matcher.profiles.length === 0) {
      errors.push(`${mLabel}: 'profiles' must be a non-empty array.`);
    } else {
      matcher.profiles.forEach((profile, pri) => {
        const pLabel = `${mLabel} › profile ` +
          (profile && typeof profile.name === "string" ? `'${profile.name}'` : `${pri + 1}`);
        if (profile === null || typeof profile !== "object" || Array.isArray(profile)) {
          errors.push(`${pLabel}: must be a mapping.`);
          return;
        }
        // Key order here is the key order of the dumped YAML: name, extends,
        // fields.
        const outProfile = { name: null };

        if (typeof profile.name !== "string" || profile.name.trim() === "") {
          errors.push(`${pLabel}: missing or empty 'name'.`);
        } else {
          outProfile.name = profile.name;
        }

        if (profile.extends !== undefined && profile.extends !== null) {
          if (typeof profile.extends !== "string" || profile.extends.trim() === "") {
            errors.push(`${pLabel}: 'extends' must be a non-empty profile name.`);
          } else {
            outProfile.extends = profile.extends;
          }
        }

        outProfile.fields = [];

        if (!Array.isArray(profile.fields)) {
          errors.push(`${pLabel}: 'fields' must be an array.`);
        } else {
          profile.fields.forEach((field, fi) => {
            const fLabel = `${pLabel} › field ${fi + 1}`;
            if (field === null || typeof field !== "object" || Array.isArray(field)) {
              errors.push(`${fLabel}: must be a mapping with 'selector' and 'value'.`);
              return;
            }
            if (typeof field.selector !== "string" || field.selector.trim() === "") {
              errors.push(`${fLabel}: missing selector.`);
              return;
            }
            // An action field does something to the element instead of giving
            // it a value — a button to click, a form to submit. Checked before
            // the tombstone below so `action` + `value: null` is an error
            // rather than a silently ignored action.
            if (field.action !== undefined && field.action !== null && field.action !== "") {
              if (
                typeof field.action !== "string" ||
                !FIELD_ACTIONS.includes(field.action.trim().toLowerCase())
              ) {
                errors.push(
                  `${fLabel}: 'action' must be one of ${FIELD_ACTIONS.join(", ")}.`
                );
                return;
              }
              if (Object.prototype.hasOwnProperty.call(field, "value")) {
                errors.push(`${fLabel}: a field has either 'value' or 'action', not both.`);
                return;
              }
              const outField = {
                selector: field.selector,
                action: field.action.trim().toLowerCase(),
              };
              if (applyWaitMs(field, outField, fLabel, errors)) {
                outProfile.fields.push(outField);
              }
              return;
            }
            // In an inheriting profile an explicit null value is a tombstone:
            // it drops the inherited field instead of setting it. Everywhere
            // else null keeps its old meaning (empty string), and an *absent*
            // `value` key is never a tombstone — only `value: null` / `value:`.
            if (outProfile.extends !== undefined && field.value === null) {
              outProfile.fields.push({ selector: field.selector, value: null });
              return;
            }
            const value = coerceScalar(field.value);
            if (value === null) {
              errors.push(`${fLabel}: 'value' must be a scalar (string, number or boolean).`);
              return;
            }
            const outField = { selector: field.selector, value };
            if (applyWaitMs(field, outField, fLabel, errors)) {
              outProfile.fields.push(outField);
            }
          });
        }
        out.profiles.push(outProfile);
      });
      // Only now are all the profile names of this matcher known.
      checkExtends(out, mLabel, errors);
    }
    config.matchers.push(out);
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config };
}

/**
 * Copy an optional `waitMs` onto the output field, coercing a numeric string.
 * Blank/absent means "use the default", so the key stays out of the config.
 * Returns false (having pushed an error) if the value is not usable.
 */
function applyWaitMs(field, outField, fLabel, errors) {
  if (field.waitMs === undefined || field.waitMs === null || field.waitMs === "") {
    return true;
  }
  const waitMs = typeof field.waitMs === "string" ? Number(field.waitMs) : field.waitMs;
  if (
    typeof waitMs !== "number" ||
    !Number.isInteger(waitMs) ||
    waitMs < 0 ||
    waitMs > MAX_WAIT_MS
  ) {
    errors.push(
      `${fLabel}: 'waitMs' must be a whole number of milliseconds ` +
        `between 0 and ${MAX_WAIT_MS}.`
    );
    return false;
  }
  outField.waitMs = waitMs;
  return true;
}

/**
 * Check every `extends` in a matcher: the target must be another profile of the
 * *same* matcher, unambiguously named, and the chain must not loop. Inheritance
 * is deliberately matcher-local — a rule stays a self-contained unit you can
 * move between configs.
 */
function checkExtends(matcher, mLabel, errors) {
  const byName = new Map();
  const duplicated = new Set();
  matcher.profiles.forEach((profile) => {
    if (profile.name === null) return;
    if (byName.has(profile.name)) duplicated.add(profile.name);
    else byName.set(profile.name, profile);
  });

  matcher.profiles.forEach((profile, pri) => {
    if (profile.extends === undefined) return;
    const pLabel = `${mLabel} › profile ` +
      (profile.name === null ? `${pri + 1}` : `'${profile.name}'`);
    const target = profile.extends;

    if (target === profile.name) {
      errors.push(`${pLabel}: 'extends' cannot point at the profile itself.`);
      return;
    }
    if (duplicated.has(target)) {
      errors.push(
        `${pLabel}: 'extends' is ambiguous — this rule has more than one ` +
          `profile named '${target}'.`
      );
      return;
    }
    if (!byName.has(target)) {
      errors.push(
        `${pLabel}: 'extends' names '${target}', which is not a profile of this rule.`
      );
      return;
    }

    const seen = new Set([profile.name]);
    let current = byName.get(target);
    while (current && current.extends !== undefined) {
      if (seen.has(current.name)) {
        errors.push(`${pLabel}: 'extends' forms a cycle via '${current.name}'.`);
        return;
      }
      seen.add(current.name);
      current = byName.get(current.extends);
    }
  });
}

/**
 * The fields a profile actually fills: the parent chain resolved first, then
 * the profile's own fields merged in — a repeated selector replaces the
 * inherited one *in place* (so the parent's fill order is preserved), a null
 * value drops it, and a new selector is appended.
 *
 * Expects a config that passed validateConfig(), so the chain terminates; the
 * `seen` guard only keeps a hand-built config from hanging the popup.
 */
function resolveProfileFields(matcher, profile, seen) {
  const visited = seen || new Set();
  let fields = [];

  if (profile.extends !== undefined && !visited.has(profile.name)) {
    visited.add(profile.name);
    const parent = matcher.profiles.find((p) => p.name === profile.extends);
    if (parent) fields = resolveProfileFields(matcher, parent, visited);
  }

  profile.fields.forEach((field) => {
    const at = fields.findIndex((f) => f.selector === field.selector);
    if (field.value === null) {
      if (at !== -1) fields.splice(at, 1);
      return;
    }
    if (at === -1) fields.push(field);
    else fields[at] = field;
  });

  return fields;
}

/** Coerce YAML scalars (number/boolean/string) to string; reject others. */
function coerceScalar(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  return null;
}

/**
 * Load and fully validate the stored config.
 * Returns { ok: true, config, yaml } or { ok: false, errors, yaml }.
 */
async function loadConfig() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const yaml = typeof stored[STORAGE_KEY] === "string" ? stored[STORAGE_KEY] : DEFAULT_YAML;
  let data;
  try {
    data = jsyaml.load(yaml);
  } catch (e) {
    return { ok: false, errors: ["YAML parse error: " + e.message], yaml };
  }
  const result = validateConfig(data);
  if (!result.ok) return { ok: false, errors: result.errors, yaml };
  return { ok: true, config: result.config, yaml };
}

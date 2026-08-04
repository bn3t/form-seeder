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
        const outProfile = { name: null, fields: [] };

        if (typeof profile.name !== "string" || profile.name.trim() === "") {
          errors.push(`${pLabel}: missing or empty 'name'.`);
        } else {
          outProfile.name = profile.name;
        }

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
            const value = coerceScalar(field.value);
            if (value === null) {
              errors.push(`${fLabel}: 'value' must be a scalar (string, number or boolean).`);
              return;
            }
            const outField = { selector: field.selector, value };
            if (field.waitMs !== undefined && field.waitMs !== null && field.waitMs !== "") {
              const waitMs =
                typeof field.waitMs === "string" ? Number(field.waitMs) : field.waitMs;
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
                return;
              }
              outField.waitMs = waitMs;
            }
            outProfile.fields.push(outField);
          });
        }
        out.profiles.push(outProfile);
      });
    }
    config.matchers.push(out);
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config };
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

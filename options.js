"use strict";

/*
 * Both views operate on `state` (the in-memory config object).
 * - Form view mutates `state` directly.
 * - Switching form -> YAML serializes `state` into the textarea.
 * - Switching YAML -> form reparses; on error the switch is blocked.
 * - Save persists the YAML string (from the active view) after parse +
 *   schema validation; invalid config never reaches storage.
 */

let state = { matchers: [] };
let currentView = "form"; // "form" | "yaml"

/*
 * Form view is a two-pane editor: the rule list (filtered) selects one matcher,
 * only that one is rendered in the detail pane. `collapsedProfiles` holds the
 * indices of the collapsed profile cards of the *selected* matcher; it is
 * re-resolved from the persisted UI state below whenever the selection changes.
 */
let selectedIndex = 0;
let ruleFilterText = "";
let collapsedProfiles = new Set();

/*
 * Editor UI state — selected rule, filter text, collapsed profile cards — is
 * persisted next to the config under its own storage key, so it survives view
 * switches and reloads. It is keyed by *name* (rule name → profile names), not
 * by index, so it stays attached to the right cards across reordering and raw
 * YAML edits. Rules (or profiles) sharing a name share collapse state.
 */
const UI_STATE_KEY = "editorUiState";
let uiState = { selectedRule: "", filter: "", collapsed: {} };
let uiSaveTimer = null;

/** Persist `uiState`, debounced — handlers fire on every keystroke. */
function saveUiState() {
  clearTimeout(uiSaveTimer);
  uiSaveTimer = setTimeout(() => {
    chrome.storage.local.set({ [UI_STATE_KEY]: uiState });
  }, 200);
}

/** Stored collapse state of a matcher, resolved to current profile indices. */
function collapsedFor(matcher) {
  const names = uiState.collapsed[matcher.name] || [];
  const set = new Set();
  matcher.profiles.forEach((profile, i) => {
    if (names.includes(profile.name)) set.add(i);
  });
  return set;
}

/** Write `collapsedProfiles` back into `uiState` as profile names. */
function persistCollapsed(matcher) {
  const names = matcher.profiles
    .filter((_, i) => collapsedProfiles.has(i))
    .map((profile) => profile.name);
  if (names.length === 0) delete uiState.collapsed[matcher.name];
  else uiState.collapsed[matcher.name] = names;
  saveUiState();
}

const formView = document.getElementById("formView");
const yamlView = document.getElementById("yamlView");
const yamlText = document.getElementById("yamlText");
const messageEl = document.getElementById("message");
const ruleList = document.getElementById("ruleList");
const ruleDetail = document.getElementById("ruleDetail");
const ruleFilter = document.getElementById("ruleFilter");
const btnFormView = document.getElementById("btnFormView");
const btnYamlView = document.getElementById("btnYamlView");
const btnSave = document.getElementById("btnSave");
const importFile = document.getElementById("importFile");

function showMessage(text, kind) {
  messageEl.textContent = text;
  messageEl.className = "message " + kind;
}

function clearMessage() {
  messageEl.textContent = "";
  messageEl.className = "message";
}

// ---------- state helpers ----------

function newMatcher() {
  return { name: "", urlPatterns: [""], profiles: [newProfile()] };
}

function newProfile() {
  return { name: "", fields: [newField()] };
}

function newField() {
  return { selector: "", value: "" };
}

function stateToYaml() {
  // Omit an empty pageSelector so the optional key doesn't clutter the YAML.
  const clean = {
    matchers: state.matchers.map((matcher) => {
      const out = { name: matcher.name, urlPatterns: matcher.urlPatterns };
      if (typeof matcher.pageSelector === "string" && matcher.pageSelector.trim() !== "") {
        out.pageSelector = matcher.pageSelector;
      }
      out.profiles = matcher.profiles;
      return out;
    }),
  };
  return jsyaml.dump(clean, { lineWidth: -1, noRefs: true });
}

/** Parse + schema-validate a YAML string. Returns {ok, config?|errors}. */
function parseAndValidate(yaml) {
  let data;
  try {
    data = jsyaml.load(yaml);
  } catch (e) {
    const mark = e.mark ? ` (line ${e.mark.line + 1}, column ${e.mark.column + 1})` : "";
    return { ok: false, errors: ["YAML parse error" + mark + ": " + e.reason] };
  }
  return validateConfig(data);
}

// ---------- form view rendering ----------

function render() {
  if (selectedIndex >= state.matchers.length) selectedIndex = state.matchers.length - 1;
  if (selectedIndex < 0) selectedIndex = 0;
  // Collapse state is re-resolved from storage on every full render; toggles
  // persist immediately, so this never loses a pending change.
  const matcher = state.matchers[selectedIndex];
  collapsedProfiles = matcher ? collapsedFor(matcher) : new Set();
  if (matcher) {
    uiState.selectedRule = matcher.name;
    saveUiState();
  }
  renderList();
  renderDetail();
}

/** Select a matcher by index; its stored collapse state comes along. */
function selectMatcher(index) {
  if (index === selectedIndex) return;
  selectedIndex = index;
  render();
}

/** True if the matcher matches the filter box (name, URL patterns, profiles). */
function matcherMatchesFilter(matcher, needle) {
  if (needle === "") return true;
  const haystack = [
    matcher.name,
    matcher.pageSelector || "",
    ...matcher.urlPatterns,
    ...matcher.profiles.map((p) => p.name),
  ].join("\n").toLowerCase();
  return haystack.includes(needle);
}

/**
 * Rule list order, as [matcher, realIndex] pairs: alphabetical by name,
 * case-insensitive, unnamed rules last. Display only — `state.matchers` keeps
 * the config's own order, so saving never reshuffles the YAML.
 */
function listOrder() {
  return state.matchers
    .map((matcher, mi) => [matcher, mi])
    .sort(([a], [b]) => {
      const an = a.name.trim(), bn = b.name.trim();
      if (an === "" || bn === "") return (an === "" ? 1 : 0) - (bn === "" ? 1 : 0);
      return an.localeCompare(bn, undefined, { sensitivity: "base" });
    });
}

function renderList() {
  ruleList.innerHTML = "";
  const needle = ruleFilterText.trim().toLowerCase();
  let shown = 0;

  listOrder().forEach(([matcher, mi]) => {
    if (!matcherMatchesFilter(matcher, needle)) return;
    shown += 1;

    const item = document.createElement("div");
    item.className = "rule-item" + (mi === selectedIndex ? " selected" : "");

    const name = document.createElement("div");
    name.className = "rule-name";
    name.textContent = matcher.name.trim() || "(unnamed rule)";
    item.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "rule-meta";
    meta.textContent = plural(matcher.urlPatterns.length, "pattern") + " · " +
      plural(matcher.profiles.length, "profile");
    item.appendChild(meta);

    item.title = matcher.urlPatterns.join("\n");
    item.addEventListener("click", () => selectMatcher(mi));
    ruleList.appendChild(item);
  });

  if (shown === 0) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = state.matchers.length === 0
      ? "No rules yet."
      : "No rule matches the filter.";
    ruleList.appendChild(empty);
  }
}

function renderDetail() {
  ruleDetail.innerHTML = "";
  const matcher = state.matchers[selectedIndex];
  if (!matcher) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = "Add a rule to start editing.";
    ruleDetail.appendChild(empty);
    return;
  }

  const card = document.createElement("div");
  card.className = "matcher-card";

  const header = document.createElement("div");
  header.className = "matcher-header";
  header.appendChild(textInput(matcher.name, "Rule name (e.g. User creation form)",
    (v) => {
      // Collapse state is keyed by rule name — carry it over to the new one.
      const entry = uiState.collapsed[matcher.name];
      delete uiState.collapsed[matcher.name];
      if (entry) uiState.collapsed[v] = entry;
      matcher.name = v;
      uiState.selectedRule = v;
      saveUiState();
      renderList();
    }));
  header.appendChild(smallButton("Delete rule", "danger", () => {
    delete uiState.collapsed[matcher.name];
    state.matchers.splice(selectedIndex, 1);
    saveUiState();
    render();
  }));
  card.appendChild(header);

  card.appendChild(sectionLabel("Page selector (optional)"));
  const psRow = document.createElement("div");
  psRow.className = "row";
  const psInput = textInput(matcher.pageSelector || "",
    "CSS selector that must exist on the page, e.g. form#user-create",
    (v) => { matcher.pageSelector = v; });
  psInput.style.fontFamily = "monospace";
  psRow.appendChild(psInput);
  card.appendChild(psRow);

  card.appendChild(sectionLabel("URL patterns"));
  matcher.urlPatterns.forEach((pattern, pi) => {
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(textInput(pattern, "https://*.myapp.be/users/new",
      (v) => { matcher.urlPatterns[pi] = v; renderList(); }));
    row.appendChild(smallButton("✕", "danger", () => {
      matcher.urlPatterns.splice(pi, 1);
      render();
    }));
    card.appendChild(row);
  });
  card.appendChild(smallButton("+ Add pattern", "", () => {
    matcher.urlPatterns.push("");
    render();
  }));

  const profilesLabel = sectionLabel("Profiles");
  profilesLabel.classList.add("profiles-label");
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  profilesLabel.appendChild(spacer);
  profilesLabel.appendChild(smallButton("Expand all", "", () => {
    collapsedProfiles = new Set();
    persistCollapsed(matcher);
    renderDetail();
  }));
  profilesLabel.appendChild(smallButton("Collapse all", "", () => {
    collapsedProfiles = new Set(matcher.profiles.map((_, i) => i));
    persistCollapsed(matcher);
    renderDetail();
  }));
  card.appendChild(profilesLabel);

  matcher.profiles.forEach((profile, pri) => {
    const collapsed = collapsedProfiles.has(pri);
    const pCard = document.createElement("div");
    pCard.className = "profile-card" + (collapsed ? " collapsed" : "");

    const pHeader = document.createElement("div");
    pHeader.className = "profile-header";
    pHeader.appendChild(smallButton(collapsed ? "▸" : "▾", "toggle", () => {
      if (collapsed) collapsedProfiles.delete(pri);
      else collapsedProfiles.add(pri);
      persistCollapsed(matcher);
      renderDetail();
    }));
    pHeader.appendChild(textInput(profile.name, "Profile name (e.g. Test user 1)",
      (v) => {
        profile.name = v;
        persistCollapsed(matcher); // stored under the profile's name
        renderList();
      }));
    if (collapsed) {
      const count = document.createElement("span");
      count.className = "rule-meta";
      count.textContent = plural(profile.fields.length, "field");
      pHeader.appendChild(count);
    }
    pHeader.appendChild(smallButton("Delete profile", "danger", () => {
      // Persist by name *before* splicing — indices shift underneath us.
      collapsedProfiles.delete(pri);
      persistCollapsed(matcher);
      matcher.profiles.splice(pri, 1);
      render();
    }));
    pCard.appendChild(pHeader);

    const body = document.createElement("div");
    body.className = "profile-body";
    profile.fields.forEach((field, fi) => {
      const row = document.createElement("div");
      row.className = "row field-row";
      const sel = textInput(field.selector, "#firstName", (v) => { field.selector = v; });
      sel.classList.add("selector");
      const val = textInput(field.value, "Value", (v) => { field.value = v; });
      val.classList.add("value");
      row.appendChild(sel);
      row.appendChild(val);
      row.appendChild(smallButton("✕", "danger", () => {
        profile.fields.splice(fi, 1);
        renderDetail();
      }));
      body.appendChild(row);
    });
    body.appendChild(smallButton("+ Add field", "", () => {
      profile.fields.push(newField());
      renderDetail();
    }));
    pCard.appendChild(body);

    card.appendChild(pCard);
  });
  card.appendChild(smallButton("+ Add profile", "", () => {
    matcher.profiles.push(newProfile());
    render();
  }));

  ruleDetail.appendChild(card);
}

function plural(n, word) {
  return n + " " + word + (n === 1 ? "" : "s");
}

function textInput(value, placeholder, onInput) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function smallButton(label, extraClass, onClick) {
  const button = document.createElement("button");
  button.className = "small" + (extraClass ? " " + extraClass : "");
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function sectionLabel(text) {
  const el = document.createElement("div");
  el.className = "section-label";
  el.textContent = text;
  return el;
}

// ---------- view switching ----------

function switchToYaml() {
  if (currentView === "yaml") return;
  yamlText.value = stateToYaml();
  currentView = "yaml";
  formView.style.display = "none";
  yamlView.style.display = "block";
  btnFormView.classList.remove("active");
  btnYamlView.classList.add("active");
  clearMessage();
}

function switchToForm() {
  if (currentView === "form") return;
  const result = parseAndValidate(yamlText.value);
  if (!result.ok) {
    showMessage("Cannot switch to form view — fix the YAML first:\n" +
      result.errors.join("\n"), "error");
    return;
  }
  state = result.config;
  restoreSelection();
  render();
  currentView = "form";
  yamlView.style.display = "none";
  formView.style.display = "block";
  btnYamlView.classList.remove("active");
  btnFormView.classList.add("active");
  clearMessage();
}

// ---------- validate / save ----------

/** YAML string of the active view's current content. */
function activeYaml() {
  return currentView === "yaml" ? yamlText.value : stateToYaml();
}

function validateActive() {
  const result = parseAndValidate(activeYaml());
  if (!result.ok) {
    showMessage(result.errors.join("\n"), "error");
  } else {
    showMessage("Config is valid.", "success");
  }
  return result;
}

async function save() {
  const yaml = activeYaml();
  const result = parseAndValidate(yaml);
  if (!result.ok) {
    showMessage("Not saved — config is invalid:\n" + result.errors.join("\n"), "error");
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: yaml });
  if (currentView === "yaml") state = result.config;
  showMessage("Saved.", "success");
}

// ---------- export / import ----------

function exportYaml() {
  const blob = new Blob([activeYaml()], { type: "text/yaml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "form-seeder.yaml";
  a.click();
  URL.revokeObjectURL(url);
}

function importYaml(file) {
  const reader = new FileReader();
  reader.onload = () => {
    // Load into the raw view only — the user reviews, validates and saves
    // explicitly. Import replaces the whole config (no merge).
    if (currentView !== "yaml") {
      currentView = "yaml";
      formView.style.display = "none";
      yamlView.style.display = "block";
      btnFormView.classList.remove("active");
      btnYamlView.classList.add("active");
    }
    yamlText.value = String(reader.result);
    const result = parseAndValidate(yamlText.value);
    if (!result.ok) {
      showMessage("Imported file has issues (not saved yet):\n" +
        result.errors.join("\n"), "error");
    } else {
      showMessage("File imported into the editor — review and press Save to apply.", "success");
    }
  };
  reader.readAsText(file);
}

// ---------- wiring ----------

ruleFilter.addEventListener("input", () => {
  ruleFilterText = ruleFilter.value;
  uiState.filter = ruleFilterText;
  saveUiState();
  renderList();
});
document.getElementById("btnAddMatcher").addEventListener("click", () => {
  // A fresh rule has no name, so it would be hidden by an active filter.
  ruleFilter.value = "";
  ruleFilterText = "";
  uiState.filter = "";
  state.matchers.push(newMatcher());
  selectedIndex = state.matchers.length - 1;
  render();
});
btnFormView.addEventListener("click", switchToForm);
btnYamlView.addEventListener("click", switchToYaml);
document.getElementById("btnValidate").addEventListener("click", validateActive);
btnSave.addEventListener("click", save);
document.getElementById("btnExport").addEventListener("click", exportYaml);
document.getElementById("btnImport").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", () => {
  if (importFile.files[0]) importYaml(importFile.files[0]);
  importFile.value = "";
});
yamlText.addEventListener("blur", () => {
  if (currentView !== "yaml") return;
  const result = parseAndValidate(yamlText.value);
  if (!result.ok) showMessage(result.errors.join("\n"), "error");
  else clearMessage();
});

// ---------- init ----------

/** Point `selectedIndex` at the remembered rule name, or fall back to the first. */
function restoreSelection() {
  const i = state.matchers.findIndex((m) => m.name === uiState.selectedRule);
  selectedIndex = i === -1 ? 0 : i;
}

async function init() {
  const stored = await chrome.storage.local.get([STORAGE_KEY, UI_STATE_KEY]);
  const savedUi = stored[UI_STATE_KEY];
  if (savedUi && typeof savedUi === "object") {
    uiState = {
      selectedRule: typeof savedUi.selectedRule === "string" ? savedUi.selectedRule : "",
      filter: typeof savedUi.filter === "string" ? savedUi.filter : "",
      collapsed: savedUi.collapsed && typeof savedUi.collapsed === "object" ? savedUi.collapsed : {},
    };
    ruleFilterText = uiState.filter;
    ruleFilter.value = uiState.filter;
  }
  const yaml = typeof stored[STORAGE_KEY] === "string" ? stored[STORAGE_KEY] : DEFAULT_YAML;
  const result = parseAndValidate(yaml);
  if (result.ok) {
    state = result.config;
    restoreSelection();
    render();
  } else {
    // Stored config is broken: open in raw view so the user can repair it
    // without losing the stored text.
    yamlText.value = yaml;
    currentView = "yaml";
    formView.style.display = "none";
    yamlView.style.display = "block";
    btnFormView.classList.remove("active");
    btnYamlView.classList.add("active");
    showMessage("Stored config is invalid — fix it here and save:\n" +
      result.errors.join("\n"), "error");
  }
}

init();

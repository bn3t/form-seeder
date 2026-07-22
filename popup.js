"use strict";

/**
 * Injected into the page. Self-contained: everything comes in via `fields`.
 * Returns { filled, skipped } summary.
 */
async function fillForm(fields) {
  const summary = { filled: 0, skipped: [] };

  // Fields are filled in order, and an earlier one can reveal a later one:
  // picking "worker" adds the commission paritaire input. The framework needs
  // a change-detection cycle plus a render (a frame or two) before it lands in
  // the DOM, so poll briefly instead of giving up on the first miss. A wrong
  // selector costs this whole budget before it is reported as skipped, which
  // is why it stays short.
  const WAIT_MS = 300;
  const POLL_MS = 25;

  async function waitFor(produce) {
    const deadline = performance.now() + WAIT_MS;
    for (;;) {
      const value = produce();
      if (value) return value;
      if (performance.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  function waitForElement(selector) {
    return waitFor(() => document.querySelector(selector));
  }

  /**
   * Angular Material's <mat-select> is not a native <select>: its options only
   * exist in a CDK overlay while the panel is open, and the selected value
   * lives in the component, not in the DOM. So drive it the way a user does —
   * open the panel, click the option whose label matches. Matching is on
   * visible text because the option's real value never reaches the DOM.
   */
  async function selectMatOption(select, value) {
    const wanted = value.trim().toLowerCase();

    // The panel is a sibling of the app root, not a descendant of the select,
    // so find it by the id the select advertises and only fall back to a
    // global sweep (which could see another select's panel) if that is absent.
    function optionsOf() {
      const panelId =
        select.getAttribute("aria-controls") ||
        select.getAttribute("aria-owns") ||
        (select.id && select.id + "-panel");
      const root =
        (panelId && document.getElementById(panelId)) ||
        document.querySelector(".cdk-overlay-container");
      const options = root ? [...root.querySelectorAll("mat-option")] : [];
      return options.length > 0 ? options : null;
    }

    if (select.getAttribute("aria-expanded") !== "true") {
      (select.querySelector(".mat-mdc-select-trigger") || select).click();
    }

    const options = await waitFor(optionsOf);
    if (!options) return false;

    const match = options.find(
      (option) => option.textContent.trim().toLowerCase() === wanted
    );
    if (!match) {
      // Leave the page as we found it rather than stranding an open panel over
      // the fields the remaining selectors still have to reach.
      console.warn(
        "Form Seeder: no mat-option labelled",
        value,
        "— available:",
        options.map((o) => o.textContent.trim())
      );
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      return false;
    }

    match.click();
    return true;
  }

  const inputValueSetter =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const textAreaValueSetter =
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  const selectValueSetter =
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  const checkedSetter =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;

  for (const { selector, value } of fields) {
    let element;
    try {
      element = await waitForElement(selector);
    } catch (e) {
      console.warn("Form Seeder: invalid selector", selector, e);
      summary.skipped.push(selector);
      continue;
    }
    if (!element) {
      console.warn("Form Seeder: no element matches selector", selector);
      summary.skipped.push(selector);
      continue;
    }

    if (element.tagName === "MAT-SELECT") {
      if (!(await selectMatOption(element, value))) {
        summary.skipped.push(selector);
        continue;
      }
      summary.filled++;
      continue;
    }

    const isCheckable =
      element instanceof HTMLInputElement &&
      (element.type === "checkbox" || element.type === "radio");

    // A native click is what component libraries listen to for checkables:
    // Material's mat-checkbox stops propagation on `change` and reads its
    // form control from the click, so setting `.checked` only paints the box.
    // click() also fires input/change itself, hence the early increment.
    if (isCheckable) {
      const checked = value === "true" || value === "1";
      if (element.checked !== checked) element.click();
      if (element.checked !== checked) {
        // Click was intercepted or the control is disabled — fall back.
        if (checkedSetter) checkedSetter.call(element, checked);
        else element.checked = checked;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
      summary.filled++;
      continue;
    }

    if (element instanceof HTMLTextAreaElement) {
      if (textAreaValueSetter) textAreaValueSetter.call(element, value);
      else element.value = value;
    } else if (element instanceof HTMLSelectElement) {
      if (selectValueSetter) selectValueSetter.call(element, value);
      else element.value = value;
    } else if (element instanceof HTMLInputElement) {
      if (inputValueSetter) inputValueSetter.call(element, value);
      else element.value = value;
    } else {
      console.warn("Form Seeder: unsupported element for selector", selector, element);
      summary.skipped.push(selector);
      continue;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    summary.filled++;
  }

  return summary;
}

/**
 * Injected into the page. Returns { selector: boolean } for each selector,
 * so the popup can tell which matchers' pageSelector is present in the DOM.
 */
function probeSelectors(selectors) {
  const found = {};
  for (const selector of selectors) {
    try {
      found[selector] = document.querySelector(selector) !== null;
    } catch (e) {
      console.warn("Form Seeder: invalid pageSelector", selector, e);
      found[selector] = false;
    }
  }
  return found;
}

const contentEl = document.getElementById("content");
const statusEl = document.getElementById("status");

document.getElementById("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

function showStatus(message, warn) {
  statusEl.textContent = message;
  statusEl.className = "status" + (warn ? " warn" : "");
  statusEl.style.display = "block";
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    contentEl.innerHTML =
      '<div class="empty">This page cannot be filled (not an http/https page).</div>';
    return;
  }

  const result = await loadConfig();
  if (!result.ok) {
    contentEl.innerHTML = "";
    const err = document.createElement("div");
    err.className = "error";
    err.textContent =
      "Config is invalid — fix it in the options page:\n" + result.errors.join("\n");
    contentEl.appendChild(err);
    return;
  }

  const urlMatching = result.config.matchers.filter((m) => matcherMatchesUrl(m, tab.url));

  // URL patterns are a coarse filter; matchers with a pageSelector also need
  // that selector present in the page's DOM.
  const selectors = [...new Set(
    urlMatching.filter((m) => m.pageSelector).map((m) => m.pageSelector)
  )];
  let found = {};
  if (selectors.length > 0) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        func: probeSelectors,
        args: [selectors],
      });
      found = results?.[0]?.result || {};
    } catch (e) {
      contentEl.innerHTML = "";
      const err = document.createElement("div");
      err.className = "error";
      err.textContent = "Could not inspect the page to check page selectors: " + e.message;
      contentEl.appendChild(err);
      return;
    }
  }

  const matching = urlMatching.filter((m) => !m.pageSelector || found[m.pageSelector]);
  if (matching.length === 0) {
    contentEl.innerHTML = '<div class="empty">No rule set matches this page.</div>';
    return;
  }

  contentEl.innerHTML = "";
  for (const matcher of matching) {
    const section = document.createElement("div");
    section.className = "matcher";
    const title = document.createElement("div");
    title.className = "matcher-name";
    title.textContent = matcher.name;
    section.appendChild(title);

    for (const profile of matcher.profiles) {
      const button = document.createElement("button");
      button.className = "profile";
      button.textContent = profile.name;
      button.addEventListener("click", () => fill(tab.id, profile));
      section.appendChild(button);
    }
    contentEl.appendChild(section);
  }
}

async function fill(tabId, profile) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      func: fillForm,
      args: [profile.fields],
    });
    const summary = results?.[0]?.result;
    if (!summary) {
      showStatus("Fill script did not return a result.", true);
      return;
    }
    if (summary.skipped.length > 0) {
      showStatus(
        `${summary.filled} field(s) filled, ${summary.skipped.length} selector(s) not found: ` +
          summary.skipped.join(", "),
        true
      );
    } else {
      showStatus(`${summary.filled} field(s) filled.`);
    }
  } catch (e) {
    showStatus("Failed to inject fill script: " + e.message, true);
  }
}

init();

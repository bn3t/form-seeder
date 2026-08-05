"use strict";

/**
 * Injected into the page. Self-contained: everything comes in via `fields`.
 * Returns { filled, clicked, skipped } summary.
 */
async function fillForm(fields) {
  const summary = { filled: 0, clicked: 0, skipped: [] };

  // Fields are filled in order, and an earlier one can reveal a later one:
  // picking "worker" adds the commission paritaire input. The framework needs
  // a change-detection cycle plus a render (a frame or two) before it lands in
  // the DOM, so poll briefly instead of giving up on the first miss. A wrong
  // selector costs this whole budget before it is reported as skipped, which
  // is why the default stays short — a field that waits on something genuinely
  // slow (a panel appearing after a server round-trip) sets its own `waitMs`.
  // Mirrors DEFAULT_WAIT_MS in lib/config.js, which this injected function
  // cannot reach.
  const DEFAULT_WAIT_MS = 300;
  const POLL_MS = 25;

  async function waitFor(produce, waitMs = DEFAULT_WAIT_MS) {
    const deadline = performance.now() + waitMs;
    for (;;) {
      const value = produce();
      if (value) return value;
      if (performance.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  function waitForElement(selector, waitMs) {
    return waitFor(() => document.querySelector(selector), waitMs);
  }

  /**
   * Angular Material's <mat-select> is not a native <select>: its options only
   * exist in a CDK overlay while the panel is open, and the selected value
   * lives in the component, not in the DOM. So drive it the way a user does —
   * open the panel, click the option whose label matches. Matching is on
   * visible text because the option's real value never reaches the DOM.
   */
  async function selectMatOption(select, value, waitMs) {
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

    // The panel is a render too, so it gets the same budget as the element.
    const options = await waitFor(optionsOf, waitMs);
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

  /**
   * `action: submit` — submit the form the selector points at (or belongs to).
   * requestSubmit() rather than submit(), so validation and the page's own
   * `submit` handler still run, exactly as a user's click would.
   * Returns false if there is no form to submit.
   */
  function submitForm(element) {
    if (element instanceof HTMLFormElement) {
      element.requestSubmit();
      return true;
    }
    const form = element.form || element.closest("form");
    if (!form) return false;
    // A submit button is passed as the submitter: its name/value is part of the
    // submission, and some apps branch on which button was used.
    const isSubmitter =
      (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
      element.type === "submit";
    form.requestSubmit(isSubmitter ? element : undefined);
    return true;
  }

  for (const { selector, value, action, waitMs } of fields) {
    let element;
    try {
      element = await waitForElement(selector, waitMs);
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

    // An action field acts on the element instead of giving it a value. It is
    // an ordinary step in the list, so a click that reveals more fields can sit
    // in the middle of a profile, not only at the end.
    if (action) {
      if (action === "submit") {
        if (!submitForm(element)) {
          console.warn("Form Seeder: no form to submit for selector", selector);
          summary.skipped.push(selector);
          continue;
        }
      } else {
        element.click();
      }
      summary.clicked++;
      continue;
    }

    if (element.tagName === "MAT-SELECT") {
      if (!(await selectMatOption(element, value, waitMs))) {
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
      // Inheritance is flattened here, so the injected fillForm only ever sees
      // a plain field list.
      const fields = resolveProfileFields(matcher, profile);
      button.addEventListener("click", () => fill(tab.id, fields));
      section.appendChild(button);
    }
    contentEl.appendChild(section);
  }
}

async function fill(tabId, fields) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      func: fillForm,
      args: [fields],
    });
    const summary = results?.[0]?.result;
    if (!summary) {
      showStatus("Fill script did not return a result.", true);
      return;
    }
    let done = `${summary.filled} field(s) filled`;
    if (summary.clicked > 0) done += `, ${summary.clicked} action(s) run`;
    if (summary.skipped.length > 0) {
      showStatus(
        `${done}, ${summary.skipped.length} selector(s) not found: ` +
          summary.skipped.join(", "),
        true
      );
    } else {
      showStatus(done + ".");
    }
  } catch (e) {
    // A submit that navigates tears down the frame the script is running in,
    // so the result never comes back. That is a success, not a failure — but
    // only read it that way for a profile that actually had an action to run.
    if (
      fields.some((f) => f.action) &&
      /frame|context|destroyed|removed|navigat/i.test(e.message)
    ) {
      showStatus("Form filled — the page navigated away (submit went through).");
      return;
    }
    showStatus("Failed to inject fill script: " + e.message, true);
  }
}

init();

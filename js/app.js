const client = window.supabase.createClient(window.APP_CONFIG.supabaseUrl, window.APP_CONFIG.supabaseAnonKey, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
});
const page = location.pathname.split("/").pop();
const roleForPage = { "sales.html": "salesperson", "designer.html": "designer", "admin.html": "admin" };
const routes = { salesperson: "sales.html", designer: "designer.html", admin: "admin.html" };
const LOGIN_AT_KEY = "loginAt";
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
let session;
let profile;
let allRows = [];
let allChanges = [];
let users = [];
let endingSession = false;
const SORT_STATE_KEY = `artworkSort:${page}`;
const SORT_KEYS = ["sr", "created_month", "created_at", "ref_no"];
function readSortState() {
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_STATE_KEY) || "null");
    return saved && SORT_KEYS.includes(saved.key) && ["asc", "desc"].includes(saved.direction) ? saved : null;
  } catch (error) {
    console.error("Could not read the table sort preference.", error);
    return null;
  }
}
const savedSortState = readSortState();
let activeSort = savedSortState || { key: "sr", direction: "asc" };
let userSortKey = savedSortState?.key || null;
let donePopoverTrigger = null;

function toast(message, type = "success") {
  const root = document.querySelector("#toast-root");
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  root.append(item);
  setTimeout(() => item.remove(), 4200);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

const lineFieldNames = ["product"];
const lineFieldTitles = {
  product: "Product with code and colour"
};
const brandingModes = [
  "Embroidery",
  "Screen printing",
  "Digital printing",
  "Sublimation",
  "DTF",
  "Embroidery/sublimation",
  "Large Format"
];
let lineDialog;
let lineDialogState;
let brandingDialog;
let brandingDialogState;
let assignmentNotifications = [];

function linesFromValue(value) {
  const values = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
  return values.filter((line) => typeof line === "string").map((line) => line.trim()).filter(Boolean);
}

function lineSummary(lines) {
  if (!lines.length) return "Click to add";
  return `${lines[0]}${lines.length > 1 ? ` +${lines.length - 1} more` : ""}`;
}

function lineFieldMarkup(name, value, { mode = "edit", recordId = "", direct = false } = {}) {
  const lines = linesFromValue(value);
  const payload = escapeHtml(JSON.stringify(lines));
  return `<div class="line-field-group">
    <input type="hidden" name="${name}" value="${payload}">
    <button type="button" class="line-field-box" data-line-field="${name}" data-line-value="${payload}" data-line-mode="${mode}" data-line-record="${escapeHtml(recordId)}" data-line-direct="${direct}" aria-haspopup="dialog" aria-required="${mode === "edit"}" aria-label="${escapeHtml(lineFieldTitles[name])}: ${escapeHtml(lineSummary(lines))}">${escapeHtml(lineSummary(lines))}</button>
  </div>`;
}

function makeLineDialog() {
  lineDialog = document.createElement("dialog");
  lineDialog.id = "line-editor-dialog";
  lineDialog.className = "line-editor-dialog";
  lineDialog.innerHTML = `<div class="line-dialog-content">
    <div class="section-heading"><h2 id="line-dialog-title"></h2><button type="button" class="icon-button" data-line-close aria-label="Close">×</button></div>
    <div id="line-dialog-list" class="line-dialog-list"></div>
    <p id="line-dialog-message" class="form-message" role="alert"></p>
    <div class="dialog-actions" id="line-dialog-actions"></div>
  </div>`;
  document.body.append(lineDialog);
  lineDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    discardLineDialog();
  });
  lineDialog.addEventListener("click", (event) => {
    if (event.target === lineDialog) discardLineDialog();
  });
  lineDialog.querySelector("[data-line-close]").addEventListener("click", () => {
    if (lineDialogState?.mode === "view") closeLineDialog();
    else discardLineDialog();
  });
}

function renderLineDialog() {
  const { lines, mode } = lineDialogState;
  const editable = mode === "edit";
  lineDialog.querySelector("#line-dialog-title").textContent = lineFieldTitles[lineDialogState.field];
  lineDialog.querySelector("[data-line-close]").classList.toggle("hidden", !editable);
  const list = lineDialog.querySelector("#line-dialog-list");
  list.replaceChildren();
  lines.forEach((line, index) => {
    if (editable) {
      const row = document.createElement("div");
      row.className = "line-editor-row";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 200;
      input.value = line;
      input.setAttribute("aria-label", `Line ${index + 1}`);
      input.placeholder = `Line ${index + 1}`;
      input.addEventListener("input", () => { lineDialogState.lines[index] = input.value; });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "quiet";
      remove.textContent = "Remove line";
      remove.addEventListener("click", () => {
        if (lineDialogState.lines.length === 1) lineDialogState.lines[0] = "";
        else lineDialogState.lines.splice(index, 1);
        renderLineDialog();
        const nextInput = list.querySelectorAll("input")[Math.min(index, lineDialogState.lines.length - 1)];
        nextInput?.focus();
      });
      row.append(input, remove);
      list.append(row);
    } else {
      const item = document.createElement("p");
      item.className = "line-view-item";
      item.textContent = line;
      list.append(item);
    }
  });
  const actions = lineDialog.querySelector("#line-dialog-actions");
  actions.replaceChildren();
  if (editable) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "secondary";
    add.textContent = "Add line";
    add.addEventListener("click", () => {
      lineDialogState.lines.push("");
      renderLineDialog();
      list.lastElementChild?.querySelector("input")?.focus();
    });
    const discard = document.createElement("button");
    discard.type = "button";
    discard.className = "quiet";
    discard.textContent = "Discard changes";
    discard.addEventListener("click", discardLineDialog);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "primary";
    save.textContent = "Save changes";
    save.addEventListener("click", () => { void saveLineDialog(); });
    actions.append(add, discard, save);
  } else {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "primary";
    close.textContent = "Close";
    close.addEventListener("click", closeLineDialog);
    actions.append(close);
  }
}

function openLineDialog(trigger) {
  let values;
  try {
    values = JSON.parse(trigger.dataset.lineValue || "[]");
  } catch (error) {
    toast("Could not read these request details.", "error");
    return;
  }
  const lines = linesFromValue(values);
  const editable = trigger.dataset.lineMode !== "view";
  lineDialogState = {
    trigger,
    field: trigger.dataset.lineField,
    mode: editable ? "edit" : "view",
    direct: trigger.dataset.lineDirect === "true",
    recordId: trigger.dataset.lineRecord,
    initialLines: lines.length ? [...lines] : [""],
    lines: lines.length ? [...lines] : [""]
  };
  lineDialog.querySelector("#line-dialog-message").textContent = "";
  renderLineDialog();
  lineDialog.showModal();
  (editable ? lineDialog.querySelector("#line-dialog-list input") : lineDialog.querySelector("#line-dialog-actions button"))?.focus();
}

function lineDialogHasChanges() {
  return JSON.stringify(lineDialogState.lines) !== JSON.stringify(lineDialogState.initialLines);
}

function closeLineDialog() {
  const trigger = lineDialogState?.trigger;
  lineDialog.close();
  lineDialogState = null;
  if (trigger?.isConnected) trigger.focus();
}

function discardLineDialog() {
  if (!lineDialogState) return;
  if (lineDialogState.mode === "edit" && lineDialogHasChanges()
    && !window.confirm("Discard the unsaved changes to these lines?")) return;
  closeLineDialog();
}

async function saveLineDialog() {
  const state = lineDialogState;
  const lines = state.lines.map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    lineDialog.querySelector("#line-dialog-message").textContent = "Enter at least one non-empty line.";
    return;
  }
  if (state.direct) {
    try {
      const { error } = await client.from("artwork_requests").update({ [state.field]: lines }).eq("id", state.recordId);
      if (error) throw error;
    } catch (error) {
      lineDialog.querySelector("#line-dialog-message").textContent = error.message || "Could not save these lines.";
      return;
    }
    const row = allRows.find((item) => item.id === state.recordId);
    if (row) row[state.field] = lines;
    toast("Request details updated.");
  }
  const group = state.trigger.closest(".line-field-group");
  const hidden = group?.querySelector('input[type="hidden"]');
  if (hidden) hidden.value = JSON.stringify(lines);
  state.trigger.dataset.lineValue = JSON.stringify(lines);
  state.trigger.textContent = lineSummary(lines);
  closeLineDialog();
}

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-line-field]");
  if (trigger) openLineDialog(trigger);
});

makeLineDialog();

function normalizeBrandingDetails(value) {
  let details = value;
  if (typeof details === "string") {
    try {
      details = JSON.parse(details);
    } catch {
      details = [];
    }
  }
  if (!Array.isArray(details)) return [];
  return details.filter((line) => line && typeof line === "object" && !Array.isArray(line)).map((line) => ({
    logo: String(line.logo ?? ""),
    mode: String(line.mode ?? ""),
    pantone: String(line.pantone ?? ""),
    size: String(line.size ?? ""),
    position: String(line.position ?? "")
  }));
}

function brandingLineSummary(line) {
  return [line.mode, line.logo, line.pantone, line.size, line.position].filter(Boolean).join(" · ");
}

function brandingSummary(details) {
  const lines = normalizeBrandingDetails(details);
  const first = lines.length ? brandingLineSummary(lines[0]) : "";
  return `${first || "Click to add"}${lines.length > 1 ? ` +${lines.length - 1} more` : ""}`;
}

function brandingFieldMarkup(value, { mode = "edit", recordId = "", direct = false } = {}) {
  const details = normalizeBrandingDetails(value);
  const payload = escapeHtml(JSON.stringify(details));
  return `<div class="branding-field-group">
    <input type="hidden" name="branding_details" value="${payload}">
    <button type="button" class="line-field-box" data-branding-field data-branding-value="${payload}" data-branding-mode="${mode}" data-branding-record="${escapeHtml(recordId)}" data-branding-direct="${direct}" aria-haspopup="dialog" aria-required="${mode === "edit"}" aria-label="Branding: ${escapeHtml(brandingSummary(details))}">${escapeHtml(brandingSummary(details))}</button>
  </div>`;
}

function makeBrandingDialog() {
  brandingDialog = document.createElement("dialog");
  brandingDialog.id = "branding-editor-dialog";
  brandingDialog.className = "line-editor-dialog branding-editor-dialog";
  brandingDialog.innerHTML = `<div class="line-dialog-content">
    <div class="section-heading"><h2 id="branding-dialog-title">Branding</h2><button type="button" class="icon-button" data-branding-close aria-label="Close">×</button></div>
    <div id="branding-dialog-list" class="line-dialog-list"></div>
    <p id="branding-dialog-message" class="form-message" role="alert"></p>
    <div class="dialog-actions" id="branding-dialog-actions"></div>
  </div>`;
  document.body.append(brandingDialog);
  brandingDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    discardBrandingDialog();
  });
  brandingDialog.addEventListener("click", (event) => {
    if (event.target === brandingDialog) discardBrandingDialog();
  });
  brandingDialog.querySelector("[data-branding-close]").addEventListener("click", () => {
    if (brandingDialogState?.mode === "view") closeBrandingDialog();
    else discardBrandingDialog();
  });
}

function renderBrandingDialog() {
  const { details, mode } = brandingDialogState;
  const editable = mode === "edit";
  brandingDialog.querySelector("[data-branding-close]").classList.toggle("hidden", !editable);
  const list = brandingDialog.querySelector("#branding-dialog-list");
  list.replaceChildren();
  details.forEach((detail, index) => {
    if (!editable) {
      const item = document.createElement("section");
      item.className = "branding-detail-view";
      const fields = [
        ["Logo to use", detail.logo],
        ["Mode of branding", detail.mode],
        ["Pantone code", detail.pantone],
        ["Size", detail.size],
        ["Position", detail.position]
      ];
      item.innerHTML = fields.filter(([, value]) => value).map(([label, value]) =>
        `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("") || "<p>No branding details saved.</p>";
      list.append(item);
      return;
    }

    const row = document.createElement("section");
    row.className = "branding-detail-row";
    const heading = document.createElement("h3");
    heading.textContent = `Branding line ${index + 1}`;
    const grid = document.createElement("div");
    grid.className = "branding-detail-grid";

    const textFields = [
      ["logo", "Logo to use"],
      ["pantone", "Pantone code"],
      ["size", "Size"],
      ["position", "Position"]
    ];
    const controls = new Map();
    textFields.forEach(([key, label]) => {
      const wrapper = document.createElement("label");
      wrapper.textContent = label;
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 200;
      input.value = detail[key];
      input.setAttribute("aria-label", `${label}, branding line ${index + 1}`);
      input.addEventListener("input", () => { detail[key] = input.value; });
      wrapper.append(input);
      controls.set(key, input);
      grid.append(wrapper);
    });

    const modeLabel = document.createElement("label");
    modeLabel.textContent = "Mode of branding";
    const select = document.createElement("select");
    select.required = true;
    select.setAttribute("aria-label", `Mode of branding, line ${index + 1}`);
    select.append(new Option("Select a mode…", ""));
    if (detail.mode && !brandingModes.includes(detail.mode)) {
      const legacyOption = new Option(`Previous value: ${detail.mode}`, detail.mode);
      legacyOption.hidden = true;
      select.append(legacyOption);
    }
    brandingModes.forEach((value) => select.append(new Option(value, value)));
    select.value = detail.mode;
    select.addEventListener("change", () => { detail.mode = select.value; });
    modeLabel.append(select);
    grid.insertBefore(modeLabel, grid.children[1] || null);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Remove line";
    remove.addEventListener("click", () => {
      if (brandingDialogState.details.length === 1) {
        brandingDialogState.details[0] = { logo: "", mode: "", pantone: "", size: "", position: "" };
      } else {
        brandingDialogState.details.splice(index, 1);
      }
      renderBrandingDialog();
      const next = list.querySelectorAll(".branding-detail-row")[Math.min(index, brandingDialogState.details.length - 1)];
      next?.querySelector("input, select")?.focus();
    });
    row.append(heading, grid, remove);
    list.append(row);
    controls.get("logo")?.setAttribute("autocomplete", "off");
  });

  const actions = brandingDialog.querySelector("#branding-dialog-actions");
  actions.replaceChildren();
  if (!editable) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "primary";
    close.textContent = "Close";
    close.addEventListener("click", closeBrandingDialog);
    actions.append(close);
    return;
  }

  const add = document.createElement("button");
  add.type = "button";
  add.className = "secondary";
  add.textContent = "Add line";
  add.addEventListener("click", () => {
    brandingDialogState.details.push({ logo: "", mode: "", pantone: "", size: "", position: "" });
    renderBrandingDialog();
    list.lastElementChild?.querySelector("input, select")?.focus();
  });
  const discard = document.createElement("button");
  discard.type = "button";
  discard.className = "quiet";
  discard.textContent = "Discard changes";
  discard.addEventListener("click", discardBrandingDialog);
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Save changes";
  save.addEventListener("click", () => { void saveBrandingDialog(); });
  actions.append(add, discard, save);
}

function openBrandingDialog(trigger) {
  let details;
  try {
    details = normalizeBrandingDetails(JSON.parse(trigger.dataset.brandingValue || "[]"));
  } catch {
    toast("Could not read these branding details.", "error");
    return;
  }
  const editable = trigger.dataset.brandingMode !== "view";
  const lines = details.length ? details : [{ logo: "", mode: "", pantone: "", size: "", position: "" }];
  brandingDialogState = {
    trigger,
    mode: editable ? "edit" : "view",
    direct: trigger.dataset.brandingDirect === "true",
    recordId: trigger.dataset.brandingRecord,
    initialDetails: lines.map((line) => ({ ...line })),
    details: lines.map((line) => ({ ...line }))
  };
  brandingDialog.querySelector("#branding-dialog-message").textContent = "";
  renderBrandingDialog();
  brandingDialog.showModal();
  (editable
    ? brandingDialog.querySelector("#branding-dialog-list input, #branding-dialog-list select")
    : brandingDialog.querySelector("#branding-dialog-actions button"))?.focus();
}

function brandingDialogHasChanges() {
  return JSON.stringify(brandingDialogState.details) !== JSON.stringify(brandingDialogState.initialDetails);
}

function closeBrandingDialog() {
  const trigger = brandingDialogState?.trigger;
  brandingDialog.close();
  brandingDialogState = null;
  if (trigger?.isConnected) trigger.focus();
}

function discardBrandingDialog() {
  if (!brandingDialogState) return;
  if (brandingDialogState.mode === "edit" && brandingDialogHasChanges()
    && !window.confirm("Discard the unsaved branding changes?")) return;
  closeBrandingDialog();
}

async function saveBrandingDialog() {
  const state = brandingDialogState;
  const message = brandingDialog.querySelector("#branding-dialog-message");
  const details = state.details.map((line) => Object.fromEntries(
    Object.entries(line).map(([key, value]) => [key, String(value).trim()])
  ));
  const nonEmpty = details.filter((line) => Object.values(line).some(Boolean));
  if (!nonEmpty.length) {
    message.textContent = "Add at least one branding line and choose a mode.";
    return;
  }
  const invalid = nonEmpty.find((line) => !line.mode);
  if (invalid) {
    message.textContent = "Choose a mode of branding for every non-empty line.";
    const index = details.indexOf(invalid);
    brandingDialog.querySelectorAll(".branding-detail-row select")[index]?.focus();
    return;
  }
  if (nonEmpty.some((line) => Object.values(line).some((value) => value.length > 200))) {
    message.textContent = "Branding text must be 200 characters or fewer per field.";
    return;
  }
  if (state.direct) {
    try {
      const { data, error } = await client.from("artwork_requests").update({ branding_details: nonEmpty })
        .eq("id", state.recordId).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("This request can no longer be edited. Refresh the page and try again.");
      const row = allRows.find((item) => item.id === state.recordId);
      if (row) row.branding_details = nonEmpty;
      toast("Branding details updated.");
    } catch (error) {
      message.textContent = error.message || "Could not save branding details.";
      return;
    }
  }
  const group = state.trigger.closest(".branding-field-group");
  const hidden = group?.querySelector('input[type="hidden"]');
  if (hidden) hidden.value = JSON.stringify(nonEmpty);
  state.trigger.dataset.brandingValue = JSON.stringify(nonEmpty);
  state.trigger.textContent = brandingSummary(nonEmpty);
  state.trigger.setAttribute("aria-label", `Branding: ${brandingSummary(nonEmpty)}`);
  closeBrandingDialog();
}

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-branding-field]");
  if (trigger) openBrandingDialog(trigger);
});

makeBrandingDialog();

function storedLoginAt() {
  try {
    const timestamp = Number(localStorage.getItem(LOGIN_AT_KEY));
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
  } catch (error) {
    console.error("Could not read the session timestamp.", error);
    return null;
  }
}

function clearLoginAt() {
  try {
    localStorage.removeItem(LOGIN_AT_KEY);
  } catch (error) {
    console.error("Could not clear the session timestamp.", error);
  }
}

function sessionIsWithinLimit() {
  const loginAt = storedLoginAt();
  const age = Date.now() - loginAt;
  return loginAt !== null && age >= 0 && age < SESSION_DURATION_MS;
}

async function endSession(message) {
  endingSession = true;
  clearLoginAt();
  const { error } = await client.auth.signOut();
  location.replace(`./index.html${message ? "?session=expired" : ""}`);
  if (error) throw error;
}

function monitorSessionExpiry() {
  const checkExpiry = () => {
    if (session && !sessionIsWithinLimit()) {
      void endSession("expired").catch((error) => toast(error.message || "Could not end the expired session.", "error"));
    }
  };
  window.setInterval(checkExpiry, 60 * 1000);
}

function localDate(value) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T12:00:00+03:00`)
    : new Date(value);
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Nairobi" }).format(date);
}

function localDateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }).format(new Date(value));
}

function sortRows(rows) {
  const direction = activeSort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    let comparison = 0;
    if (activeSort.key === "sr") {
      comparison = Number(left.sr) - Number(right.sr);
    } else if (activeSort.key === "created_month") {
      comparison = String(left.created_month || "").localeCompare(String(right.created_month || ""));
    } else if (activeSort.key === "created_at") {
      comparison = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    } else if (activeSort.key === "ref_no") {
      comparison = String(left.ref_no || "").localeCompare(String(right.ref_no || ""), undefined, { numeric: true, sensitivity: "base" });
    }
    return comparison * direction;
  });
}

function updateSortIndicators() {
  document.querySelectorAll("th[data-sort]").forEach((header) => {
    const label = header.dataset.sortLabel || header.textContent.trim();
    header.dataset.sortLabel = label;
    header.title = "Double-click to sort";
    header.classList.add("sortable-header");
    const active = header.dataset.sort === activeSort.key;
    header.textContent = `${label}${active ? (activeSort.direction === "asc" ? " ▲" : " ▼") : ""}`;
    header.setAttribute("aria-sort", active ? (activeSort.direction === "asc" ? "ascending" : "descending") : "none");
  });
}

function bindSortableHeaders() {
  document.querySelectorAll("th[data-sort]").forEach((header) => {
    header.addEventListener("dblclick", () => {
      activeSort = userSortKey === header.dataset.sort
        ? { key: activeSort.key, direction: activeSort.direction === "asc" ? "desc" : "asc" }
        : { key: header.dataset.sort, direction: "asc" };
      userSortKey = header.dataset.sort;
      try {
        localStorage.setItem(SORT_STATE_KEY, JSON.stringify(activeSort));
      } catch (error) {
        console.error("Could not save the table sort preference.", error);
      }
      if (page === "sales.html") renderSales();
      else if (page === "designer.html") void renderDesigner();
      else if (page === "admin.html") renderAdminRows();
    });
  });
  updateSortIndicators();
}

function statusBadge(status) {
  const className = status === "Done" ? "done" : status === "In progress" ? "progress" : status === "Change requested" ? "change" : "requested";
  return `<span class="badge ${className}">${escapeHtml(status)}</span>`;
}

function profileName(id) {
  return users.find((user) => user.id === id)?.full_name || users.find((user) => user.id === id)?.username || "Any";
}

function preferredDesignerName(row) {
  return row.preferred_designer_recorded === false ? "Not recorded" : profileName(row.preferred_designer);
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label || "Saving…";
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
  }
  button.disabled = busy;
}

async function invokeAdmin(action, payload = {}) {
  const { data, error } = await client.functions.invoke("user-admin", { body: { action, ...payload } });
  if (error) {
    if (error.context && typeof error.context.clone === "function") {
      try {
        const body = await error.context.clone().json();
        if (typeof body?.error === "string") throw new Error(body.error);
      } catch (responseError) {
        if (!(responseError instanceof SyntaxError)) throw responseError;
      }
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function bindPasswordHints(root) {
  root.querySelectorAll("[data-password-hint]").forEach((hint) => {
    const input = hint.parentElement.querySelector('input[type="password"]');
    if (!input) return;
    const update = () => {
      hint.textContent = input.value.length >= 8
        ? "Password length is valid."
        : `Password must be at least 8 characters. (${input.value.length}/8)`;
    };
    input.addEventListener("input", update);
    update();
  });
}

async function loadUsers() {
  const { data, error } = await client.from("profiles").select("id,username,full_name,role,active").order("full_name");
  if (error) throw error;
  users = data || [];
  return users;
}

async function loadArtworks() {
  const { data, error } = await client.from("artwork_requests").select("*").order("sr", { ascending: true });
  if (error) throw error;
  allRows = data || [];
  if (allRows.length) {
    const changeResult = await client.from("artwork_changes").select("*").in("artwork_id", allRows.map((row) => row.id));
    if (changeResult.error) throw changeResult.error;
    allChanges = changeResult.data || [];
  } else {
    allChanges = [];
  }
  return allRows;
}

function dateKey(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(value));
}

function periodBounds(period) {
  const key = dateKey(today);
  const length = period === "day" ? 10 : period === "month" ? 7 : 4;
  return (value) => dateKey(value).slice(0, length) === key.slice(0, length);
}

function tallyMarkup(items) {
  return items.map(([label, value]) => `<div class="stat-card"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`).join("");
}

async function initSales() {
  document.querySelector("#current-user").textContent = profile.full_name;
  const [rows, loadedUsers] = await Promise.all([loadArtworks(), loadUsers()]);
  bindSortableHeaders();
  renderSalesTallies();
  renderSales();
  document.querySelector("#sales-period").addEventListener("change", renderSalesTallies);
  document.querySelector("#sales-search").addEventListener("input", renderSales);
  document.querySelector("#sales-status").addEventListener("change", renderSales);
  document.querySelector("#new-request").addEventListener("click", () => openRequestEditor());
  document.querySelector("#change-form").addEventListener("submit", saveChange);
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  document.addEventListener("click", (event) => {
    if (donePopoverTrigger && !event.target.closest("#done-time-popover, .done-time-trigger")) closeDonePopover();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDonePopover();
  });
  subscribeToChanges();
  void loadedUsers;
}

function renderSalesTallies() {
  const inPeriod = periodBounds(document.querySelector("#sales-period").value);
  const ownRows = allRows.filter((row) => row.created_by === profile.id);
  const ownIds = new Set(ownRows.map((row) => row.id));
  const rows = ownRows.filter((row) => inPeriod(row.created_at));
  const changes = allChanges.filter((change) => ownIds.has(change.artwork_id) && inPeriod(change.requested_on));
  document.querySelector("#sales-tallies").innerHTML = tallyMarkup([
    ["Artworks requested", rows.length],
    ["Artworks done", ownRows.filter((row) => row.status === "Done" && inPeriod(row.done_at)).length],
    ["Changes requested", changes.length],
    ["Changes done", changes.filter((change) => change.status === "done" && inPeriod(change.done_at)).length]
  ]);
}

function renderSales() {
  closeDonePopover();
  const search = document.querySelector("#sales-search").value.trim().toLowerCase();
  const status = document.querySelector("#sales-status").value;
  const rows = sortRows(allRows.filter((row) => row.created_by === profile.id
    && (!status || row.status === status)
    && (!search || `${row.ref_no} ${row.client_name}`.toLowerCase().includes(search))));
  const tbody = document.querySelector("#sales-rows");
  tbody.innerHTML = rows.map((row) => `<tr>
    <td>${escapeHtml(row.sr)}</td><td>${escapeHtml(row.created_month)}</td><td>${localDate(row.created_at)}</td>
    <td><strong>${escapeHtml(row.ref_no)}</strong></td><td>${escapeHtml(profile.full_name)}</td><td>${escapeHtml(row.client_name)}</td>
    <td>${lineFieldMarkup("product", row.product, { mode: row.status === "Requested" ? "edit" : "view", recordId: row.id, direct: row.status === "Requested" })}</td>
    <td>${brandingFieldMarkup(row.branding_details, { mode: row.status === "Requested" ? "edit" : "view", recordId: row.id, direct: row.status === "Requested" })}</td>
    <td>${localDate(row.date_needed)}</td><td>${escapeHtml(preferredDesignerName(row))}</td>
    <td>${row.status === "Done" ? `<button type="button" class="badge done done-time-trigger" data-done-time="${escapeHtml(row.completed_at || "")}" aria-expanded="false" aria-label="Done status, show completion time">Done</button> <span title="Designer marked this done">✓</span>` : statusBadge(row.status)}</td>
    <td>${row.status === "Done" && row.completed_at ? escapeHtml(localDateTime(row.completed_at)) : "—"}</td>
    <td><div class="table-actions">
      <button class="secondary" data-history="${escapeHtml(row.id)}">History</button>
      <button class="secondary" data-change="${escapeHtml(row.id)}">Change</button>
      <button class="quiet" data-edit="${escapeHtml(row.id)}" ${row.status !== "Requested" ? "disabled" : ""}>Edit</button>
    </div></td></tr>`).join("");
  document.querySelector("#sales-empty").classList.toggle("hidden", rows.length > 0);
  updateSortIndicators();
  tbody.querySelectorAll("[data-done-time]").forEach((button) => button.addEventListener("click", () => {
    openDonePopover(button, button.dataset.doneTime);
  }));
  tbody.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openRequestEditor(allRows.find((row) => row.id === button.dataset.edit))));
  tbody.querySelectorAll("[data-change]").forEach((button) => button.addEventListener("click", () => openChangeDialog(allRows.find((row) => row.id === button.dataset.change))));
  tbody.querySelectorAll("[data-history]").forEach((button) => button.addEventListener("click", () => showHistory(button.dataset.history)));
}

function closeDonePopover() {
  document.querySelector("#done-time-popover")?.remove();
  donePopoverTrigger?.setAttribute("aria-expanded", "false");
  donePopoverTrigger = null;
}

function openDonePopover(trigger, timestamp) {
  if (donePopoverTrigger === trigger) {
    closeDonePopover();
    return;
  }
  closeDonePopover();
  const date = timestamp
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Nairobi" }).format(new Date(timestamp))
    : "—";
  const time = timestamp
    ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" }).format(new Date(timestamp))
    : "—";
  const popover = document.createElement("div");
  popover.id = "done-time-popover";
  popover.className = "done-time-popover";
  popover.setAttribute("role", "tooltip");
  popover.textContent = `Done on ${date} at ${time}`;
  document.body.append(popover);
  const bounds = trigger.getBoundingClientRect();
  const left = Math.min(Math.max(8, bounds.left), window.innerWidth - 248);
  popover.style.left = `${left}px`;
  popover.style.top = `${Math.min(bounds.bottom + 8, window.innerHeight - 56)}px`;
  trigger.setAttribute("aria-expanded", "true");
  donePopoverTrigger = trigger;
}

function requestFormMarkup(row = null) {
  const editing = Boolean(row);
  const activeDesigners = users.filter((user) => user.role === "designer" && user.active);
  const inactivePreferred = row?.preferred_designer && !activeDesigners.some((user) => user.id === row.preferred_designer)
    ? users.find((user) => user.id === row.preferred_designer) : null;
  const designers = (inactivePreferred
    ? `<option value="${escapeHtml(inactivePreferred.id)}" selected>${escapeHtml(inactivePreferred.full_name)} (inactive)</option>` : "")
    + activeDesigners.map((user) => `<option value="${escapeHtml(user.id)}" ${row?.preferred_designer === user.id ? "selected" : ""}>${escapeHtml(user.full_name)}</option>`).join("");
  return `<form id="request-form" class="request-form"><div class="form-grid">
    <label>Category<select name="category" required><option value="">Select…</option><option ${row?.category === "New client" ? "selected" : ""}>New client</option><option ${row?.category === "Old client" ? "selected" : ""}>Old client</option></select></label>
    <label>Client name<input name="client_name" value="${escapeHtml(row?.client_name)}" required></label>
    <label>SO number<input name="so_number" value="${escapeHtml(row?.so_number)}" required></label>
    <div class="line-field-label"><span>Product with code and colour</span>${lineFieldMarkup("product", row?.product)}</div>
    <div class="line-field-label"><span>Branding</span>${brandingFieldMarkup(row?.branding_details)}</div>
    <label class="check-line"><input name="high_res_logo" type="checkbox" ${row?.high_res_logo ? "checked" : ""}> High resolution logo</label>
    <label class="check-line"><input name="redesign_logo" type="checkbox" ${row?.redesign_logo ? "checked" : ""}> Redesign logo</label>
    <label class="wide">Additional information<textarea name="additional_info" rows="2">${escapeHtml(row?.additional_info)}</textarea></label>
    <label>Date needed<input name="date_needed" type="date" min="${today}" value="${escapeHtml(row?.date_needed || "")}" required></label>
    <label>Designer preferred<select name="preferred_designer"><option value="">Any</option>${designers}</select></label>
  </div><div class="form-actions"><button type="button" class="quiet" id="discard-request">Discard</button><button class="primary" type="submit">${editing ? "Save changes" : "Save request"}</button></div></form>`;
}

function openRequestEditor(row = null) {
  const container = document.querySelector("#request-editor");
  container.innerHTML = requestFormMarkup(row);
  const form = container.querySelector("#request-form");
  form.addEventListener("submit", (event) => saveRequest(event, row));
  container.querySelector("#discard-request").addEventListener("click", () => { container.replaceChildren(); toast("Draft discarded."); });
  container.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveRequest(event, existing) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  setBusy(button, true);
  try {
    const data = new FormData(form);
    const values = Object.fromEntries(["category","client_name","so_number","additional_info","date_needed"].map((name) => [name, data.get(name) || null]));
    for (const name of lineFieldNames) {
      const lines = linesFromValue(JSON.parse(data.get(name) || "[]"));
      if (!lines.length) throw new Error(`${lineFieldTitles[name]} must contain at least one non-empty line.`);
      values[name] = lines;
    }
    const brandingDetails = normalizeBrandingDetails(data.get("branding_details"))
      .map((line) => Object.fromEntries(Object.entries(line).map(([key, value]) => [key, String(value).trim()])));
    if (!brandingDetails.length || brandingDetails.some((line) => !line.mode
      || Object.values(line).some((value) => value.length > 200))) {
      throw new Error("Add at least one branding line, choose a mode for each line, and keep each field to 200 characters or fewer.");
    }
    values.branding_details = brandingDetails;
    values.preferred_designer = data.get("preferred_designer") || null;
    values.preferred_designer_recorded = true;
    values.assigned_designer = values.preferred_designer;
    Object.assign(values, { high_res_logo: data.has("high_res_logo"), redesign_logo: data.has("redesign_logo") });
    if (values.date_needed < today) throw new Error("Date needed cannot be in the past.");
    let result;
    if (existing) {
      result = await client.from("artwork_requests").update(values).eq("id", existing.id).select("id").single();
    } else {
      result = await client.from("artwork_requests").insert({ ...values, created_by: profile.id }).select("id,ref_no").single();
    }
    if (result.error) throw result.error;
    toast(existing ? "Artwork request updated." : `Request saved as ${result.data.ref_no}.`);
    form.closest("#request-editor").replaceChildren();
    await refreshArtworks();
  } catch (error) {
    toast(error.message || "Could not save request.", "error");
  } finally {
    setBusy(button, false);
  }
}

function openChangeDialog(row) {
  const dialog = document.querySelector("#change-dialog");
  const form = document.querySelector("#change-form");
  form.reset();
  form.elements.artwork_id.value = row.id;
  form.elements.requested_by.value = profile.full_name;
  form.elements.requested_on.value = today;
  dialog.showModal();
}

async function saveChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("[type=submit]");
  setBusy(button, true);
  try {
    const values = Object.fromEntries(new FormData(form));
    const { error } = await client.from("artwork_changes").insert({
      artwork_id: values.artwork_id, change_text: values.change_text,
      requested_by: values.requested_by, requested_on: values.requested_on
    });
    if (error) throw error;
    form.closest("dialog").close();
    toast("Change request sent to the designer.");
    await refreshArtworks();
  } catch (error) {
    toast(error.message || "Could not submit change request.", "error");
  } finally {
    setBusy(button, false);
  }
}

async function showHistory(artworkId) {
  const { data, error } = await client.from("artwork_changes").select("*").eq("artwork_id", artworkId).order("requested_on");
  if (error) return toast(error.message, "error");
  const content = document.querySelector("#history-content");
  content.innerHTML = data.length ? data.map((change) => `<div class="change-item">${escapeHtml(change.change_text)}<small>${escapeHtml(change.requested_by)} · Requested ${localDate(change.requested_on)} · ${change.status === "done" ? `Done by ${escapeHtml(profileName(change.done_by))} ${localDateTime(change.done_at)}` : "Open"}</small></div>`).join("") : '<p class="empty-state">No changes requested.</p>';
  document.querySelector("#history-dialog").showModal();
}

async function initDesigner() {
  document.querySelector("#current-user").textContent = profile.full_name;
  await Promise.all([loadUsers(), loadArtworks(), loadAssignmentNotifications()]);
  bindSortableHeaders();
  renderDesignerTallies();
  renderDesigner();
  document.querySelector("#designer-filter").addEventListener("change", renderDesigner);
  document.querySelector("#change-bell").addEventListener("click", () => {
    document.querySelector("#designer-filter").value = "changes";
    renderDesigner();
  });
  document.querySelector("#assignment-bell").addEventListener("click", () => {
    document.querySelector("#designer-filter").value = "assignments";
    renderDesigner();
  });
  subscribeToChanges();
}

function visibleDesignerRows() {
  return allRows;
}

async function loadAssignmentNotifications() {
  const { data, error } = await client.from("designer_notifications")
    .select("id,artwork_id,created_at")
    .is("read_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  assignmentNotifications = data || [];
  return assignmentNotifications;
}

async function changesFor(artworkIds) {
  if (!artworkIds.length) return [];
  const { data, error } = await client.from("artwork_changes").select("*").in("artwork_id", artworkIds).eq("status", "open").order("requested_on", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function renderDesignerTallies() {
  try {
    const rows = visibleDesignerRows();
    const ids = rows.map((row) => row.id);
    const { data: changes, error } = ids.length
      ? await client.from("artwork_changes").select("id,artwork_id").in("artwork_id", ids).eq("status", "open")
      : { data: [], error: null };
    if (error) throw error;
    const pending = rows.filter((row) => row.status !== "Done");
    document.querySelector("#designer-tallies").innerHTML = tallyMarkup([
      ["Artworks done today", rows.filter((row) => row.status === "Done" && dateKey(row.done_at) === today).length],
      ["Artworks pending", pending.length],
      ["Requests received", rows.length],
      ["Needed today", pending.filter((row) => row.date_needed === today).length],
      ["Needed tomorrow", pending.filter((row) => row.date_needed === tomorrow()).length]
    ]);
    document.querySelector("#change-count").textContent = changes?.length || 0;
    document.querySelector("#assignment-count").textContent = assignmentNotifications.length;
  } catch (error) {
    toast(error.message, "error");
  }
}

function tomorrow() {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1, 12));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

async function renderDesigner() {
  try {
    const rows = visibleDesignerRows();
    const openChanges = await changesFor(rows.map((row) => row.id));
    const assignedIds = new Set(assignmentNotifications.map((notice) => notice.artwork_id));
    const byArtwork = new Map();
    openChanges.forEach((change) => byArtwork.set(change.artwork_id, [...(byArtwork.get(change.artwork_id) || []), change]));
    const filter = document.querySelector("#designer-filter").value;
    const filtered = sortRows(rows.filter((row) => {
      if (filter === "today") return row.date_needed === today;
      if (filter === "tomorrow") return row.date_needed === tomorrow();
      if (filter === "pending") return row.status !== "Done";
      if (filter === "done") return row.status === "Done";
      if (filter === "changes") return byArtwork.has(row.id);
      if (filter === "assignments") return assignedIds.has(row.id) && row.assigned_designer === profile.id;
      return true;
    }));
    const tbody = document.querySelector("#designer-rows");
    tbody.innerHTML = filtered.map((row) => {
      const changes = byArtwork.get(row.id) || [];
      const otherDetails = [row.category, `SO ${row.so_number}`, row.additional_info].filter(Boolean).map(escapeHtml).join(" · ");
      const claimed = row.assigned_designer === profile.id && row.status === "In progress";
      const canStart = row.status !== "Done" && row.status !== "In progress"
        && (row.assigned_designer === null || row.assigned_designer === profile.id);
      return `<tr><td><strong>${escapeHtml(row.ref_no)}</strong><br>${escapeHtml(row.client_name)}</td><td>
        <div class="designer-line-fields">${lineFieldMarkup("product", row.product, { mode: "view" })}${brandingFieldMarkup(row.branding_details, { mode: "view" })}</div>
        <p>${otherDetails}</p></td>
        <td>${localDate(row.date_needed)}</td><td>${escapeHtml(profileName(row.created_by))}</td>
        <td>${statusBadge(row.status)}</td>
        <td>${changes.map((change) => `<div class="change-item">${escapeHtml(change.change_text)}<small>${escapeHtml(change.requested_by)} · ${localDate(change.requested_on)}</small></div>`).join("") || "—"}</td>
        <td><textarea data-notes="${escapeHtml(row.id)}" rows="2" placeholder="Designer notes or final file URL" ${claimed ? "" : "disabled"}>${escapeHtml(row.designer_notes)}</textarea></td>
        <td>${escapeHtml(preferredDesignerName(row))}${assignedIds.has(row.id) ? '<br><span class="badge assignment-badge">New assignment</span>' : ""}</td>
        <td><div class="table-actions">${canStart ? `<button class="primary" data-start="${escapeHtml(row.id)}">Start</button>` : ""}
        ${claimed && row.status !== "Done" ? `<button class="secondary" data-done="${escapeHtml(row.id)}">Done</button>` : ""}
        ${claimed ? `<button class="quiet" data-notes-save="${escapeHtml(row.id)}">Save notes</button>` : ""}</div></td></tr>`;
    }).join("");
    document.querySelector("#designer-empty").classList.toggle("hidden", filtered.length > 0);
    updateSortIndicators();
    document.querySelector("#change-banner").classList.toggle("hidden", openChanges.length === 0);
    document.querySelector("#change-banner").textContent = openChanges.length ? `CHANGE REQUESTED · ${openChanges.length} change${openChanges.length === 1 ? "" : "s"} need attention` : "";
    const assignmentBanner = document.querySelector("#assignment-banner");
    assignmentBanner.classList.toggle("hidden", assignmentNotifications.length === 0);
    assignmentBanner.textContent = assignmentNotifications.length
      ? `NEW ASSIGNMENT · ${assignmentNotifications.length} request${assignmentNotifications.length === 1 ? "" : "s"} assigned specifically to you.`
      : "";
    tbody.querySelectorAll("[data-start]").forEach((button) => button.addEventListener("click", () => updateArtwork(button.dataset.start, { status: "In progress", assigned_designer: profile.id }, button, "Job started.")));
    tbody.querySelectorAll("[data-done]").forEach((button) => button.addEventListener("click", () => updateArtwork(button.dataset.done, { status: "Done", done_at: new Date().toISOString(), done_by: profile.id }, button, "Artwork marked done.")));
    tbody.querySelectorAll("[data-notes-save]").forEach((button) => button.addEventListener("click", () => {
      const notes = tbody.querySelector(`[data-notes="${CSS.escape(button.dataset.notesSave)}"]`).value;
      updateArtwork(button.dataset.notesSave, { designer_notes: notes }, button, "Notes saved.");
    }));
  } catch (error) {
    toast(error.message || "Could not load the designer queue.", "error");
  }
}

async function updateArtwork(id, values, button, success) {
  setBusy(button, true);
  try {
    const { data, error } = await client.from("artwork_requests").update(values).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("This artwork is no longer available to update. Refresh the queue and try again.");
    toast(success);
    await refreshArtworks();
  } catch (error) {
    toast(error.message || "Could not update artwork.", "error");
  } finally {
    setBusy(button, false);
  }
}

function subscribeToChanges() {
  const channel = client.channel(`artwork-${profile.id}`).on("postgres_changes", { event: "*", schema: "public", table: "artwork_requests" }, () => {
    void refreshArtworks();
  }).on("postgres_changes", { event: "*", schema: "public", table: "artwork_changes" }, () => {
    void refreshArtworks();
  });
  if (page === "designer.html") {
    channel.on("postgres_changes", { event: "*", schema: "public", table: "designer_notifications" }, () => {
      void refreshArtworks();
    });
  }
  channel.subscribe();
}

async function refreshArtworks() {
  await Promise.all([
    loadArtworks(),
    page === "designer.html" ? loadAssignmentNotifications() : Promise.resolve()
  ]);
  if (page === "sales.html") {
    renderSalesTallies();
    renderSales();
  } else if (page === "designer.html") {
    renderDesignerTallies();
    renderDesigner();
  } else if (page === "admin.html") {
    renderAdminTallies();
    renderAdminRows();
  }
}

async function initAdmin() {
  document.querySelector("#current-user").textContent = profile.full_name;
  await Promise.all([loadUsers(), loadArtworks()]);
  bindSortableHeaders();
  renderAdmin();
  document.querySelector("#admin-period").addEventListener("change", renderAdminTallies);
  ["filter-sales", "filter-designer", "filter-status", "filter-category", "filter-from", "filter-to", "admin-search"].forEach((id) => document.querySelector(`#${id}`).addEventListener("input", renderAdminRows));
  document.querySelector("#export-csv").addEventListener("click", exportCsv);
  document.querySelector("#user-create-form").addEventListener("submit", createUser);
  document.querySelector("#admin-edit-form").addEventListener("submit", saveAdminEdit);
  document.querySelector("#admin-edit-form").elements.preferred_designer.addEventListener("change", (event) => {
    if (event.currentTarget.value !== "__unknown") {
      document.querySelector("#admin-edit-form").elements.assigned_designer.value = event.currentTarget.value;
    }
  });
  document.querySelector("#admin-delete").addEventListener("click", deleteArtwork);
  document.querySelector("#password-form").addEventListener("submit", resetPassword);
  bindPasswordHints(document);
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  client.channel(`admin-artwork-${profile.id}`).on("postgres_changes", { event: "*", schema: "public", table: "artwork_requests" }, () => { void refreshArtworks(); }).subscribe();
}

function renderAdmin() {
  renderAdminTallies();
  const salesSelect = document.querySelector("#filter-sales");
  const designerSelect = document.querySelector("#filter-designer");
  salesSelect.innerHTML = '<option value="">All salespeople</option>' + users.filter((user) => user.role === "salesperson").map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.full_name)}</option>`).join("");
  designerSelect.innerHTML = '<option value="">All designers</option>' + users.filter((user) => user.role === "designer").map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.full_name)}</option>`).join("");
  renderAdminRows();
  renderUsers();
}

function renderAdminTallies() {
  const inPeriod = periodBounds(document.querySelector("#admin-period").value);
  const rows = allRows.filter((row) => inPeriod(row.created_at));
  document.querySelector("#admin-tallies").innerHTML = tallyMarkup([
    ["Requested", rows.length], ["Done", rows.filter((row) => row.status === "Done").length],
    ["Pending", rows.filter((row) => row.status !== "Done").length],
    ["Changes", rows.reduce((total, row) => total + (row.change_count || 0), 0)]
  ]);
}

function filteredAdminRows() {
  const search = document.querySelector("#admin-search").value.trim().toLowerCase();
  const from = document.querySelector("#filter-from").value;
  const to = document.querySelector("#filter-to").value;
  return allRows.filter((row) => (!document.querySelector("#filter-sales").value || row.created_by === document.querySelector("#filter-sales").value)
    && (!document.querySelector("#filter-designer").value || row.preferred_designer === document.querySelector("#filter-designer").value)
    && (!document.querySelector("#filter-status").value || row.status === document.querySelector("#filter-status").value)
    && (!document.querySelector("#filter-category").value || row.category === document.querySelector("#filter-category").value)
    && (!from || dateKey(row.created_at) >= from) && (!to || dateKey(row.created_at) <= to)
    && (!search || `${row.ref_no} ${row.client_name}`.toLowerCase().includes(search)));
}

function renderAdminRows() {
  const tbody = document.querySelector("#admin-rows");
  if (!tbody) return;
  const rows = sortRows(filteredAdminRows());
  tbody.innerHTML = rows.map((row) => `<tr><td><strong>${escapeHtml(row.ref_no)}</strong></td><td>${escapeHtml(row.client_name)}<br><span class="muted">${escapeHtml(row.so_number)}</span></td>
    <td>${escapeHtml(profileName(row.created_by))}</td><td>${escapeHtml(preferredDesignerName(row))}</td><td>${escapeHtml(row.category)}</td>
    <td>${lineFieldMarkup("product", row.product, { recordId: row.id, direct: true })}</td>
    <td>${brandingFieldMarkup(row.branding_details, { recordId: row.id, direct: true })}</td>
    <td>${localDate(row.created_at)}</td><td>${localDate(row.date_needed)}</td><td>${statusBadge(row.status)}</td><td><button class="secondary" data-admin-edit="${escapeHtml(row.id)}">Edit</button></td></tr>`).join("");
  document.querySelector("#admin-empty").classList.toggle("hidden", rows.length > 0);
  updateSortIndicators();
  tbody.querySelectorAll("[data-admin-edit]").forEach((button) => button.addEventListener("click", () => openAdminEdit(allRows.find((row) => row.id === button.dataset.adminEdit))));
}

function openAdminEdit(row) {
  const form = document.querySelector("#admin-edit-form");
  form.reset();
  Object.entries(row).forEach(([key, value]) => {
    if (lineFieldNames.includes(key)) return;
    if (!form.elements[key]) return;
    if (form.elements[key].type === "checkbox") form.elements[key].checked = Boolean(value);
    else form.elements[key].value = value ?? "";
  });
  for (const name of lineFieldNames) {
    const slot = form.querySelector(`[data-line-slot="${name}"]`);
    slot.innerHTML = lineFieldMarkup(name, row[name]);
  }
  form.querySelector('[data-branding-slot="branding_details"]').innerHTML = brandingFieldMarkup(row.branding_details);
  const activeDesigners = users.filter((user) => user.role === "designer" && user.active);
  const preferredSelect = form.elements.preferred_designer;
  preferredSelect.innerHTML = '<option value="">Any</option>'
    + (row.preferred_designer_recorded === false ? '<option value="__unknown">Not recorded (historical)</option>' : "")
    + activeDesigners.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.full_name)}</option>`).join("");
  if (row.preferred_designer && !activeDesigners.some((user) => user.id === row.preferred_designer)) {
    const previousPreference = users.find((user) => user.id === row.preferred_designer);
    preferredSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(row.preferred_designer)}">${escapeHtml(previousPreference?.full_name || "Inactive designer")} (inactive)</option>`);
  }
  preferredSelect.value = row.preferred_designer_recorded === false ? "__unknown" : row.preferred_designer || "";
  const assignedSelect = form.elements.assigned_designer;
  assignedSelect.innerHTML = '<option value="">Any / unassigned</option>'
    + activeDesigners.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.full_name)}</option>`).join("");
  if (row.assigned_designer && !activeDesigners.some((user) => user.id === row.assigned_designer)) {
    const previousDesigner = users.find((user) => user.id === row.assigned_designer);
    assignedSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(row.assigned_designer)}">${escapeHtml(previousDesigner?.full_name || "Inactive designer")}</option>`);
  }
  assignedSelect.value = row.assigned_designer || "";
  document.querySelector("#admin-edit-dialog").showModal();
}

async function saveAdminEdit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("[type=submit]");
  setBusy(button, true);
  try {
    const data = new FormData(form);
    const lineValues = {};
    for (const name of lineFieldNames) {
      const lines = linesFromValue(JSON.parse(data.get(name) || "[]"));
      if (!lines.length) throw new Error(`${lineFieldTitles[name]} must contain at least one non-empty line.`);
      lineValues[name] = lines;
    }
    const brandingDetails = normalizeBrandingDetails(data.get("branding_details"))
      .map((line) => Object.fromEntries(Object.entries(line).map(([key, value]) => [key, String(value).trim()])));
    if (!brandingDetails.length || brandingDetails.some((line) => !line.mode
      || Object.values(line).some((value) => value.length > 200))) {
      throw new Error("Add at least one branding line, choose a mode for each line, and keep each field to 200 characters or fewer.");
    }
    const preferenceRecorded = data.get("preferred_designer") !== "__unknown";
    const preferredDesigner = preferenceRecorded ? data.get("preferred_designer") || null : null;
    const { error } = await client.from("artwork_requests").update({
      category: data.get("category"), client_name: data.get("client_name"), so_number: data.get("so_number"),
      ...lineValues, branding_details: brandingDetails,
      high_res_logo: data.has("high_res_logo"), redesign_logo: data.has("redesign_logo"),
      additional_info: data.get("additional_info") || null,
      preferred_designer: preferredDesigner,
      preferred_designer_recorded: preferenceRecorded,
      assigned_designer: data.get("assigned_designer") || null,
      status: data.get("status"),
      date_needed: data.get("date_needed"), designer_notes: data.get("designer_notes") || null
    }).eq("id", data.get("id"));
    if (error) throw error;
    document.querySelector("#admin-edit-dialog").close();
    toast("Artwork updated.");
    await refreshArtworks();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function deleteArtwork(event) {
  const id = document.querySelector("#admin-edit-form").elements.id.value;
  if (!confirm("Delete this saved artwork and its change history? This cannot be undone.")) return;
  const button = event.currentTarget;
  setBusy(button, true);
  try {
    const { error } = await client.from("artwork_requests").delete().eq("id", id);
    if (error) throw error;
    document.querySelector("#admin-edit-dialog").close();
    toast("Artwork deleted.");
    await refreshArtworks();
  } catch (error) {
    toast(error.message || "Could not delete artwork.", "error");
  } finally {
    setBusy(button, false);
  }
}

function exportCsv() {
  const columns = ["ref_no","sr","created_at","created_month","created_by","preferred_designer","assigned_designer","category","client_name","so_number","product","branding_details","high_res_logo","redesign_logo","additional_info","date_needed","status","claimed_at","done_at","done_by","designer_notes","change_count","changes_done","updated_at"];
  const brandingCsvValue = (details) => normalizeBrandingDetails(details).map((line) =>
    [["Logo", line.logo], ["Mode", line.mode], ["Pantone", line.pantone], ["Size", line.size], ["Position", line.position]]
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}: ${value}`)
      .join("; ")
  ).join(" | ");
  const csvValue = (row, column) => column === "preferred_designer"
    ? preferredDesignerName(row)
    : ["created_by", "assigned_designer", "done_by"].includes(column) ? profileName(row[column])
    : column === "branding_details" ? brandingCsvValue(row.branding_details)
      : lineFieldNames.includes(column) ? linesFromValue(row[column]).join(" | ") : row[column];
  const csvCell = (value) => {
    const safeValue = /^[=+\-@]/.test(String(value ?? "")) ? `'${value}` : value;
    return `"${String(safeValue ?? "").replaceAll('"', '""')}"`;
  };
  const csv = [columns.join(","), ...filteredAdminRows().map((row) => columns.map((column) => csvCell(csvValue(row, column))).join(","))].join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = "promo-kings-artworks.csv";
  link.click();
  URL.revokeObjectURL(link.href);
  toast("Filtered CSV exported.");
}

async function requirePasswordChange() {
  if (!session.user.user_metadata?.password_change_required) return;
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<form id="first-password-form">
    <div class="section-heading"><h2>Change your temporary password</h2></div>
    <p class="muted">Choose a new password before continuing. Use at least 8 characters.</p>
    <label>New password<input name="password" type="password" autocomplete="new-password" required><small class="password-hint" data-password-hint>Password must be at least 8 characters.</small></label>
    <label>Confirm new password<input name="confirmation" type="password" autocomplete="new-password" required><small class="password-hint" data-password-hint>Password must be at least 8 characters.</small></label>
    <div class="dialog-actions"><button class="primary" type="submit">Update password</button></div>
  </form>`;
  dialog.addEventListener("cancel", (event) => event.preventDefault());
  document.body.append(dialog);
  bindPasswordHints(dialog);
  dialog.showModal();
  await new Promise((resolve) => {
    dialog.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      if (String(values.get("password")).length < 8) {
        toast("Password must be at least 8 characters.", "error");
        return;
      }
      if (values.get("password") !== values.get("confirmation")) {
        toast("The passwords do not match.", "error");
        return;
      }
      const button = form.querySelector("[type=submit]");
      setBusy(button, true);
      try {
        await invokeAdmin("self_change_password", { password: values.get("password") });
        session.user.user_metadata.password_change_required = false;
        dialog.close();
        dialog.remove();
        toast("Password updated.");
        resolve();
      } catch (error) {
        toast(error.message || "Could not update your password.", "error");
        setBusy(button, false);
      }
    });
  });
}

async function createUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("[type=submit]");
  if (String(new FormData(form).get("password")).length < 8) {
    toast("Password must be at least 8 characters.", "error");
    return;
  }
  setBusy(button, true);
  try {
    const values = Object.fromEntries(new FormData(form));
    await invokeAdmin("create_user", values);
    form.reset();
    toast("User created. Share the temporary password securely.");
    await loadUsers();
    renderUsers();
    renderAdmin();
  } catch (error) {
    toast(error.message || "Could not create user.", "error");
  } finally {
    setBusy(button, false);
  }
}

function renderUsers() {
  document.querySelector("#user-rows").innerHTML = users.map((user) => `<tr><td>${escapeHtml(user.full_name)}</td><td>${escapeHtml(user.username)}</td>
    <td><select data-role="${escapeHtml(user.id)}"><option ${user.role === "salesperson" ? "selected" : ""}>salesperson</option><option ${user.role === "designer" ? "selected" : ""}>designer</option><option ${user.role === "admin" ? "selected" : ""}>admin</option></select></td>
    <td><input type="checkbox" data-active="${escapeHtml(user.id)}" ${user.active ? "checked" : ""} aria-label="Active"></td><td><div class="table-actions">
    <button class="secondary" data-reset="${escapeHtml(user.id)}">Reset password</button><button class="quiet" data-view-password="${escapeHtml(user.id)}">View password</button></div></td></tr>`).join("");
  document.querySelectorAll("[data-role]").forEach((select) => select.addEventListener("change", () => updateUser(select.dataset.role, { role: select.value }, select)));
  document.querySelectorAll("[data-active]").forEach((input) => input.addEventListener("change", () => updateUser(input.dataset.active, { active: input.checked }, input)));
  document.querySelectorAll("[data-reset]").forEach((button) => button.addEventListener("click", () => {
    const form = document.querySelector("#password-form");
    form.reset(); form.elements.user_id.value = button.dataset.reset;
    document.querySelector("#password-dialog").showModal();
  }));
  document.querySelectorAll("[data-view-password]").forEach((button) => button.addEventListener("click", () => viewPassword(button.dataset.viewPassword, button)));
}

async function updateUser(id, changes, control) {
  setBusy(control, true);
  try {
    const { error } = await client.from("profiles").update(changes).eq("id", id);
    if (error) throw error;
    toast("User updated.");
    await loadUsers();
    renderAdmin();
  } catch (error) {
    toast(error.message || "Could not update user.", "error");
    await loadUsers();
    renderUsers();
  } finally {
    setBusy(control, false);
  }
}

async function resetPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("[type=submit]");
  if (String(new FormData(form).get("password")).length < 8) {
    toast("Password must be at least 8 characters.", "error");
    return;
  }
  setBusy(button, true);
  try {
    const values = Object.fromEntries(new FormData(form));
    await invokeAdmin("reset_password", values);
    document.querySelector("#password-dialog").close();
    toast("Password reset successfully.");
  } catch (error) {
    toast(error.message || "Could not reset password.", "error");
  } finally {
    setBusy(button, false);
  }
}

async function viewPassword(userId, button) {
  setBusy(button, true, "Loading…");
  try {
    const result = await invokeAdmin("view_password", { user_id: userId });
    document.querySelector("#view-password-value").textContent = result.password;
    document.querySelector("#view-password-dialog").showModal();
  } catch (error) {
    toast(error.message || "Could not view password.", "error");
  } finally {
    setBusy(button, false);
  }
}

client.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" && !endingSession) location.replace("./index.html");
});
document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    await endSession();
  } catch (error) {
    toast(error.message || "Could not sign out.", "error");
    button.disabled = false;
  }
}));

document.querySelectorAll("[data-menu-toggle]").forEach((button) => button.addEventListener("click", () => {
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  button.closest(".topbar").classList.toggle("menu-open", !expanded);
}));

async function bootstrap() {
  try {
    const { data: { session: activeSession } } = await client.auth.getSession();
    session = activeSession;
    if (!session) return location.replace("./index.html");
    if (!sessionIsWithinLimit()) {
      await endSession("expired");
      return;
    }
    const { data: currentProfile, error } = await client.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    if (error) throw error;
    if (!currentProfile?.active || currentProfile.role !== roleForPage[page]) {
      if (currentProfile?.active && routes[currentProfile.role]) location.replace(routes[currentProfile.role]);
      else await endSession();
      return;
    }
    profile = currentProfile;
    monitorSessionExpiry();
    await requirePasswordChange();
    if (page === "sales.html") await initSales();
    if (page === "designer.html") await initDesigner();
    if (page === "admin.html") await initAdmin();
  } catch (error) {
    toast(error.message || "Could not load this page.", "error");
  }
}

bootstrap();

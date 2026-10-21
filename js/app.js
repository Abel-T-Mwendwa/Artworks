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

const lineFieldNames = ["product", "branding_mode", "logo_position"];
const lineFieldTitles = {
  product: "Product with code and colour",
  branding_mode: "Mode of branding",
  logo_position: "Logo to use and branding position"
};
let lineDialog;
let lineDialogState;

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

function statusBadge(status) {
  const className = status === "Done" ? "done" : status === "In progress" ? "progress" : status === "Change requested" ? "change" : "requested";
  return `<span class="badge ${className}">${escapeHtml(status)}</span>`;
}

function profileName(id) {
  return users.find((user) => user.id === id)?.full_name || users.find((user) => user.id === id)?.username || "Any";
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
  const { data, error } = await client.from("artwork_requests").select("*").order("date_needed").order("created_at", { ascending: false });
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
  renderSalesTallies();
  renderSales();
  document.querySelector("#sales-period").addEventListener("change", renderSalesTallies);
  document.querySelector("#sales-search").addEventListener("input", renderSales);
  document.querySelector("#sales-status").addEventListener("change", renderSales);
  document.querySelector("#new-request").addEventListener("click", () => openRequestEditor());
  document.querySelector("#change-form").addEventListener("submit", saveChange);
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
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
  const search = document.querySelector("#sales-search").value.trim().toLowerCase();
  const status = document.querySelector("#sales-status").value;
  const rows = allRows.filter((row) => row.created_by === profile.id
    && (!status || row.status === status)
    && (!search || `${row.ref_no} ${row.client_name}`.toLowerCase().includes(search)));
  const tbody = document.querySelector("#sales-rows");
  tbody.innerHTML = rows.map((row) => `<tr>
    <td>${escapeHtml(row.sr)}</td><td>${escapeHtml(row.created_month)}</td><td>${localDate(row.created_at)}</td>
    <td><strong>${escapeHtml(row.ref_no)}</strong></td><td>${escapeHtml(profile.full_name)}</td><td>${escapeHtml(row.client_name)}</td>
    <td>${lineFieldMarkup("product", row.product, { mode: row.status === "Requested" ? "edit" : "view", recordId: row.id, direct: row.status === "Requested" })}</td>
    <td>${lineFieldMarkup("branding_mode", row.branding_mode, { mode: row.status === "Requested" ? "edit" : "view", recordId: row.id, direct: row.status === "Requested" })}</td>
    <td>${lineFieldMarkup("logo_position", row.logo_position, { mode: row.status === "Requested" ? "edit" : "view", recordId: row.id, direct: row.status === "Requested" })}</td>
    <td>${escapeHtml(row.branding_size)}</td><td>${localDate(row.date_needed)}</td><td>${escapeHtml(profileName(row.assigned_designer))}</td>
    <td>${statusBadge(row.status)}${row.status === "Done" ? ' <span title="Designer marked this done">✓</span>' : ""}</td>
    <td><div class="table-actions">
      <button class="secondary" data-history="${escapeHtml(row.id)}">History</button>
      <button class="secondary" data-change="${escapeHtml(row.id)}">Change</button>
      <button class="quiet" data-edit="${escapeHtml(row.id)}" ${row.status !== "Requested" ? "disabled" : ""}>Edit</button>
    </div></td></tr>`).join("");
  document.querySelector("#sales-empty").classList.toggle("hidden", rows.length > 0);
  tbody.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openRequestEditor(allRows.find((row) => row.id === button.dataset.edit))));
  tbody.querySelectorAll("[data-change]").forEach((button) => button.addEventListener("click", () => openChangeDialog(allRows.find((row) => row.id === button.dataset.change))));
  tbody.querySelectorAll("[data-history]").forEach((button) => button.addEventListener("click", () => showHistory(button.dataset.history)));
}

function requestFormMarkup(row = null) {
  const editing = Boolean(row);
  const designers = users.filter((user) => user.role === "designer" && user.active).map((user) => `<option value="${escapeHtml(user.id)}" ${row?.assigned_designer === user.id ? "selected" : ""}>${escapeHtml(user.full_name)}</option>`).join("");
  return `<form id="request-form" class="request-form"><div class="form-grid">
    <label>Category<select name="category" required><option value="">Select…</option><option ${row?.category === "New client" ? "selected" : ""}>New client</option><option ${row?.category === "Old client" ? "selected" : ""}>Old client</option></select></label>
    <label>Client name<input name="client_name" value="${escapeHtml(row?.client_name)}" required></label>
    <label>SO number<input name="so_number" value="${escapeHtml(row?.so_number)}" required></label>
    <div class="line-field-label"><span>Product with code and colour</span>${lineFieldMarkup("product", row?.product)}</div>
    <div class="line-field-label"><span>Mode of branding</span>${lineFieldMarkup("branding_mode", row?.branding_mode)}</div>
    <div class="line-field-label"><span>Logo to use and branding position</span>${lineFieldMarkup("logo_position", row?.logo_position)}</div>
    <label>Pantone code<input name="pantone_code" value="${escapeHtml(row?.pantone_code)}"></label>
    <label>Size of branding required<input name="branding_size" value="${escapeHtml(row?.branding_size)}" placeholder="e.g. 10 x 5 cm" maxlength="100" required></label>
    <label class="check-line"><input name="high_res_logo" type="checkbox" ${row?.high_res_logo ? "checked" : ""}> High resolution logo</label>
    <label class="check-line"><input name="redesign_logo" type="checkbox" ${row?.redesign_logo ? "checked" : ""}> Redesign logo</label>
    <label class="wide">Additional information<textarea name="additional_info" rows="2">${escapeHtml(row?.additional_info)}</textarea></label>
    <label>Date needed<input name="date_needed" type="date" min="${today}" value="${escapeHtml(row?.date_needed || "")}" required></label>
    <label>Designer<select name="assigned_designer"><option value="">Any</option>${designers}</select></label>
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
    const values = Object.fromEntries(["category","client_name","so_number","pantone_code","branding_size","additional_info","date_needed","assigned_designer"].map((name) => [name, data.get(name) || null]));
    for (const name of lineFieldNames) {
      const lines = linesFromValue(JSON.parse(data.get(name) || "[]"));
      if (!lines.length) throw new Error(`${lineFieldTitles[name]} must contain at least one non-empty line.`);
      values[name] = lines;
    }
    values.branding_size = String(data.get("branding_size") || "").trim();
    if (!values.branding_size || values.branding_size.length > 100) {
      throw new Error("Enter a branding size of no more than 100 characters.");
    }
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
  await Promise.all([loadUsers(), loadArtworks()]);
  renderDesignerTallies();
  renderDesigner();
  document.querySelector("#designer-filter").addEventListener("change", renderDesigner);
  document.querySelector("#change-bell").addEventListener("click", () => {
    document.querySelector("#designer-filter").value = "changes";
    renderDesigner();
  });
  subscribeToChanges();
}

function visibleDesignerRows() {
  return allRows.filter((row) => row.assigned_designer === profile.id || row.assigned_designer === null);
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
    const byArtwork = new Map();
    openChanges.forEach((change) => byArtwork.set(change.artwork_id, [...(byArtwork.get(change.artwork_id) || []), change]));
    const filter = document.querySelector("#designer-filter").value;
    const filtered = rows.filter((row) => {
      if (filter === "today") return row.date_needed === today;
      if (filter === "tomorrow") return row.date_needed === tomorrow();
      if (filter === "pending") return row.status !== "Done";
      if (filter === "done") return row.status === "Done";
      if (filter === "changes") return byArtwork.has(row.id);
      return true;
    }).sort((a, b) => String(a.date_needed).localeCompare(String(b.date_needed)));
    const tbody = document.querySelector("#designer-rows");
    tbody.innerHTML = filtered.map((row) => {
      const changes = byArtwork.get(row.id) || [];
      const otherDetails = [row.category, `SO ${row.so_number}`, row.pantone_code, row.branding_size, row.additional_info].filter(Boolean).map(escapeHtml).join(" · ");
      const claimed = row.assigned_designer === profile.id && row.status === "In progress";
      const canStart = row.status !== "Done" && row.status !== "In progress";
      return `<tr><td><strong>${escapeHtml(row.ref_no)}</strong><br>${escapeHtml(row.client_name)}</td><td>
        <div class="designer-line-fields">${lineFieldMarkup("product", row.product, { mode: "view" })}${lineFieldMarkup("branding_mode", row.branding_mode, { mode: "view" })}${lineFieldMarkup("logo_position", row.logo_position, { mode: "view" })}</div>
        <p>${otherDetails}</p></td>
        <td>${localDate(row.date_needed)}</td><td>${escapeHtml(profileName(row.created_by))}</td><td>${statusBadge(row.status)}</td>
        <td>${changes.map((change) => `<div class="change-item">${escapeHtml(change.change_text)}<small>${escapeHtml(change.requested_by)} · ${localDate(change.requested_on)}</small></div>`).join("") || "—"}</td>
        <td><textarea data-notes="${escapeHtml(row.id)}" rows="2" placeholder="Designer notes or final file URL" ${claimed ? "" : "disabled"}>${escapeHtml(row.designer_notes)}</textarea></td>
        <td><div class="table-actions">${canStart ? `<button class="primary" data-start="${escapeHtml(row.id)}">Start</button>` : ""}
        ${claimed && row.status !== "Done" ? `<button class="secondary" data-done="${escapeHtml(row.id)}">Done</button>` : ""}
        ${claimed ? `<button class="quiet" data-notes-save="${escapeHtml(row.id)}">Save notes</button>` : ""}</div></td></tr>`;
    }).join("");
    document.querySelector("#designer-empty").classList.toggle("hidden", filtered.length > 0);
    document.querySelector("#change-banner").classList.toggle("hidden", openChanges.length === 0);
    document.querySelector("#change-banner").textContent = openChanges.length ? `CHANGE REQUESTED · ${openChanges.length} change${openChanges.length === 1 ? "" : "s"} need attention` : "";
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
  client.channel(`artwork-${profile.id}`).on("postgres_changes", { event: "*", schema: "public", table: "artwork_requests" }, () => {
    void refreshArtworks();
  }).on("postgres_changes", { event: "*", schema: "public", table: "artwork_changes" }, () => {
    void refreshArtworks();
  }).subscribe();
}

async function refreshArtworks() {
  await loadArtworks();
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
  renderAdmin();
  document.querySelector("#admin-period").addEventListener("change", renderAdminTallies);
  ["filter-sales", "filter-designer", "filter-status", "filter-category", "filter-from", "filter-to", "admin-search"].forEach((id) => document.querySelector(`#${id}`).addEventListener("input", renderAdminRows));
  document.querySelector("#export-csv").addEventListener("click", exportCsv);
  document.querySelector("#user-create-form").addEventListener("submit", createUser);
  document.querySelector("#admin-edit-form").addEventListener("submit", saveAdminEdit);
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
    && (!document.querySelector("#filter-designer").value || row.assigned_designer === document.querySelector("#filter-designer").value)
    && (!document.querySelector("#filter-status").value || row.status === document.querySelector("#filter-status").value)
    && (!document.querySelector("#filter-category").value || row.category === document.querySelector("#filter-category").value)
    && (!from || dateKey(row.created_at) >= from) && (!to || dateKey(row.created_at) <= to)
    && (!search || `${row.ref_no} ${row.client_name}`.toLowerCase().includes(search)));
}

function renderAdminRows() {
  const tbody = document.querySelector("#admin-rows");
  if (!tbody) return;
  const rows = filteredAdminRows();
  tbody.innerHTML = rows.map((row) => `<tr><td><strong>${escapeHtml(row.ref_no)}</strong></td><td>${escapeHtml(row.client_name)}<br><span class="muted">${escapeHtml(row.so_number)}</span></td>
    <td>${escapeHtml(profileName(row.created_by))}</td><td>${escapeHtml(profileName(row.assigned_designer))}</td><td>${escapeHtml(row.category)}</td>
    <td>${lineFieldMarkup("product", row.product, { recordId: row.id, direct: true })}</td>
    <td>${lineFieldMarkup("branding_mode", row.branding_mode, { recordId: row.id, direct: true })}</td>
    <td>${lineFieldMarkup("logo_position", row.logo_position, { recordId: row.id, direct: true })}</td><td>${escapeHtml(row.branding_size)}</td>
    <td>${localDate(row.created_at)}</td><td>${localDate(row.date_needed)}</td><td>${statusBadge(row.status)}</td><td><button class="secondary" data-admin-edit="${escapeHtml(row.id)}">Edit</button></td></tr>`).join("");
  document.querySelector("#admin-empty").classList.toggle("hidden", rows.length > 0);
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
  form.elements.assigned_designer.innerHTML = '<option value="">Any</option>' + users.filter((user) => user.role === "designer" && user.active).map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.full_name)}</option>`).join("");
  form.elements.assigned_designer.value = row.assigned_designer || "";
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
    const { error } = await client.from("artwork_requests").update({
      category: data.get("category"), client_name: data.get("client_name"), so_number: data.get("so_number"),
      ...lineValues, pantone_code: data.get("pantone_code") || null,
      branding_size: String(data.get("branding_size") || "").trim() || null,
      high_res_logo: data.has("high_res_logo"), redesign_logo: data.has("redesign_logo"),
      additional_info: data.get("additional_info") || null,
      assigned_designer: data.get("assigned_designer") || null, status: data.get("status"),
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
  const columns = ["ref_no","sr","created_at","created_month","created_by","assigned_designer","category","client_name","so_number","product","branding_mode","logo_position","pantone_code","branding_size","high_res_logo","redesign_logo","additional_info","date_needed","status","claimed_at","done_at","done_by","designer_notes","change_count","changes_done","updated_at"];
  const csvValue = (row, column) => ["created_by", "assigned_designer", "done_by"].includes(column)
    ? profileName(row[column]) : lineFieldNames.includes(column) ? linesFromValue(row[column]).join(" | ") : row[column];
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

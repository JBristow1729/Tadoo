import { addDays, addMonths, addWeeks, dateStr, DAYS, MONTHS, parseDate, today, todayStr } from "./date.js";
import { buildWholegrainLinkUrl, fetchRemoteProfile, restoreWholegrainProfile, syncRemoteChores } from "./api.js";
import { readChores, readLinkedAccount, readTheme, writeChores, writeLinkedAccount, writeTheme } from "./storage.js";

const SYMBOLS = ["Home", "Dishes", "Plants", "Shop", "Meds", "Pets", "Work", "Car", "Bills", "Clean", "Laundry", "Fix", "Boxes", "Money", "Gym", "Books", "Post", "Goal", "Soap", "Bath", "Night", "Day", "Birthday", "Gift"];
const SYMBOL_ICONS = ["ti-home", "ti-tools-kitchen-2", "ti-plant", "ti-shopping-cart", "ti-pill", "ti-paw", "ti-briefcase", "ti-car", "ti-bulb", "ti-brush", "ti-shirt", "ti-tool", "ti-package", "ti-coins", "ti-barbell", "ti-books", "ti-mail", "ti-target", "ti-spray", "ti-bath", "ti-moon", "ti-sun", "ti-cake", "ti-gift"];

let chores = [];
let editId = null;
let isDark = true;
let calViewDate = new Date();
let calPickerCallback = null;
let calPickerMin = null;
let calPickerMax = null;
let syncStatus = "Saved on this device";
let linkedAccount = readLinkedAccount();

const overlay = document.getElementById("overlay");
const dialogContainer = document.getElementById("dialog-container");

document.addEventListener("click", handleDocumentClick);
overlay.addEventListener("click", (event) => {
  if (event.target === overlay) closeOverlay();
});

init();

async function init() {
  setTheme(readTheme(), false);
  chores = readChores() ?? seedChores();
  writeChores(chores);
  await restoreFromUrl();
  renderAll();
  hydrateFromRemote();
}

async function restoreFromUrl() {
  const url = new URL(window.location.href);
  const restoreToken = url.searchParams.get("tadooRestoreToken");
  if (!restoreToken) return;
  url.searchParams.delete("tadooRestoreToken");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  syncStatus = "Restoring linked chores...";
  try {
    const profile = await restoreWholegrainProfile(restoreToken);
    if (Array.isArray(profile?.chores)) {
      chores = profile.chores;
      rememberLinkedAccount(profile);
      persist("Linked chores restored");
    }
  } catch (error) {
    syncStatus = error.message || "Could not restore linked chores";
  }
}

async function hydrateFromRemote() {
  try {
    const profile = await fetchRemoteProfile();
    if (profile?.identityId) rememberLinkedAccount(profile);
    if (Array.isArray(profile?.chores) && (profile.chores.length || profile.identityId)) {
      rememberLinkedAccount(profile);
      chores = profile.chores;
      persist("Synced with Wholegrain");
      renderAll();
    } else {
      await syncRemoteChores(chores);
      syncStatus = "Ready to link";
    }
  } catch {
    syncStatus = "Saved on this device";
  }
}

function handleDocumentClick(event) {
  const actionTarget = event.target.closest("[data-action]");
  if (actionTarget) {
    event.preventDefault();
    runAction(actionTarget.dataset.action, actionTarget.dataset, actionTarget);
    return;
  }

  const choreTarget = event.target.closest("[data-chore-id]");
  if (choreTarget) openView(choreTarget.dataset.choreId);
}

function runAction(action, data = {}, target = null) {
  if (action === "open-create") openCreate();
  if (action === "open-calendar") openCalendar();
  if (action === "open-options") openOptions();
  if (action === "close-overlay") closeOverlay();
  if (action === "select-symbol") selectSymbol(data.symbol);
  if (action === "toggle-day") target?.classList.toggle("active");
  if (action === "save-chore") saveChore(data.edit === "true");
  if (action === "complete-chore") completeChore(data.id);
  if (action === "edit-chore") {
    const chore = chores.find((item) => item.id === data.id);
    if (chore) openCreate(chore);
  }
  if (action === "confirm-delete") confirmDelete(data.id);
  if (action === "delete-chore") deleteChore(data.id);
  if (action === "pull-forward") openPullForward(data.id);
  if (action === "push-back") openPushBack(data.id);
  if (action === "shift-mini-cal") shiftMiniCal(Number(data.dir));
  if (action === "select-mini-day") selectMiniDay(data.date);
  if (action === "confirm-mini-cal") confirmMiniCal();
  if (action === "shift-cal") shiftCalMonth(Number(data.dir));
  if (action === "select-cal-day") renderCalDialog(data.date);
  if (action === "toggle-theme") toggleDark();
  if (action === "link-account") linkAccount();
}

function persist(message = "Saved") {
  writeChores(chores);
  syncStatus = message;
  syncRemoteChores(chores)
    .then(() => {
      syncStatus = "Synced with Wholegrain";
      updateSyncStatus();
    })
    .catch(() => {
      syncStatus = "Saved on this device";
      updateSyncStatus();
    });
  updateSyncStatus();
}

function updateSyncStatus() {
  const element = document.getElementById("sync-status");
  if (element) element.textContent = linkedAccount ? linkedAccountEmailLabel() : syncStatus;
}

function rememberLinkedAccount(profile) {
  if (!profile?.identityId) return;
  linkedAccount = {
    identityId: profile.identityId,
    email: profile.identityEmail || profile.email || ""
  };
  writeLinkedAccount(profile);
  syncStatus = linkedAccount.email ? `Account linked: ${linkedAccount.email}` : "Account linked";
}

function nextDue(chore, fromDate) {
  const base = fromDate || today();
  const schedule = chore.schedule;
  if (schedule.type === "daily") return addDays(base, 1);
  if (schedule.type === "weekly") {
    let date = addDays(base, 1);
    for (let index = 0; index < 14; index += 1) {
      if ((schedule.days || []).includes(date.getDay())) return date;
      date = addDays(date, 1);
    }
    return addDays(base, 7);
  }
  if (schedule.type === "monthly") {
    for (let month = 1; month < 4; month += 1) {
      const baseMonth = new Date(base.getFullYear(), base.getMonth() + month, 1);
      const match = monthlyCandidate(baseMonth, schedule);
      if (match) return match;
    }
  }
  if (schedule.type === "every") {
    const count = schedule.num || 1;
    if (schedule.unit === "days") return addDays(base, count);
    if (schedule.unit === "weeks") return addWeeks(base, count);
    return addMonths(base, count);
  }
  return addDays(base, 1);
}

function firstDueFromSchedule(schedule) {
  const start = today();
  if (schedule.type === "daily" || schedule.type === "every") return start;
  if (schedule.type === "weekly") {
    let date = new Date(start);
    for (let index = 0; index < 7; index += 1) {
      if ((schedule.days || []).includes(date.getDay())) return date;
      date = addDays(date, 1);
    }
  }
  if (schedule.type === "monthly") {
    for (let month = 0; month < 4; month += 1) {
      const match = monthlyCandidate(new Date(start.getFullYear(), start.getMonth() + month, 1), schedule);
      if (match && match >= start) return match;
    }
  }
  return start;
}

function monthlyCandidate(base, schedule) {
  const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  if (schedule.monthPos === "last") {
    for (let day = daysInMonth; day >= 1; day -= 1) {
      const candidate = new Date(base.getFullYear(), base.getMonth(), day);
      if (candidate.getDay() === schedule.monthDay) return candidate;
    }
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const candidate = new Date(base.getFullYear(), base.getMonth(), day);
    if (candidate.getDay() === schedule.monthDay) return candidate;
  }
  return null;
}

function schedLabel(chore) {
  const schedule = chore.schedule;
  if (schedule.type === "daily") return "Daily";
  if (schedule.type === "weekly") return `Weekly · ${(schedule.days || []).map((index) => DAYS[index]).join(", ")}`;
  if (schedule.type === "monthly") return `Monthly · ${schedule.monthPos} ${DAYS[schedule.monthDay || 0]}`;
  if (schedule.type === "every") return `Every ${schedule.num} ${schedule.unit}`;
  return "";
}

function renderAll() {
  const ts = todayStr();
  const todayChores = chores.filter((chore) => chore.dueDate === ts);
  const upcomingChores = chores.filter((chore) => chore.dueDate > ts).sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  document.getElementById("today-badge").textContent = String(todayChores.length);
  document.getElementById("upcoming-badge").textContent = String(upcomingChores.length);
  document.getElementById("today-date").textContent = today().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  document.getElementById("today-list").innerHTML = todayChores.length ? todayChores.map(choreHTML).join("") : emptyHTML("ti-confetti", "All done! Nothing due today.");
  document.getElementById("upcoming-list").innerHTML = upcomingChores.length ? upcomingHTML(upcomingChores) : emptyHTML("ti-calendar-off", "No upcoming chores.");
}

function upcomingHTML(upcomingChores) {
  const groups = {};
  upcomingChores.forEach((chore) => {
    groups[chore.dueDate] ??= [];
    groups[chore.dueDate].push(chore);
  });
  return Object.entries(groups).map(([date, items]) => {
    const parsed = parseDate(date);
    const diff = Math.round((parsed - today()) / 86400000);
    const label = diff === 1 ? "Tomorrow" : parsed.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    return `<div class="upcoming-group"><div class="upcoming-day-label">${label}</div>${items.map(choreHTML).join("")}</div>`;
  }).join("");
}

function choreHTML(chore) {
  return `<div class="chore-item" data-chore-id="${escapeAttr(chore.id)}">
    <button class="chore-check" type="button" data-action="complete-chore" data-id="${escapeAttr(chore.id)}" aria-label="Complete ${escapeAttr(chore.title)}"></button>
    <span class="chore-symbol"><i class="ti ${escapeAttr(chore.symbol)}" aria-hidden="true"></i></span>
    <div class="chore-info">
      <div class="chore-title">${escapeHtml(chore.title)}</div>
      ${chore.description ? `<div class="chore-sub">${escapeHtml(chore.description)}</div>` : ""}
    </div>
    <span class="chore-freq">${escapeHtml(schedLabel(chore))}</span>
  </div>`;
}

function emptyHTML(icon, text) {
  return `<div class="empty"><i class="ti ${icon}" aria-hidden="true"></i><span>${escapeHtml(text)}</span></div>`;
}

function completeChore(id) {
  const index = chores.findIndex((chore) => chore.id === id);
  if (index === -1) return;
  const chore = chores[index];
  chores[index] = { ...chore, dueDate: dateStr(nextDue(chore, parseDate(chore.dueDate))) };
  persist();
  renderAll();
  launchConfetti();
  playTick();
}

function openCreate(prefill) {
  editId = prefill?.id ?? null;
  const chore = prefill ?? { symbol: "ti-home", title: "", description: "", schedule: { type: "daily" } };
  openOverlay(createDialogHTML(chore, Boolean(prefill)));
  setScheduleUI(chore.schedule);
}

function createDialogHTML(chore, isEdit) {
  return `<form class="dialog" data-create-form>
    <div class="dialog-header">
      <i class="ti ti-${isEdit ? "edit" : "plus"}" aria-hidden="true"></i>
      <span class="dialog-title">${isEdit ? "Edit chore" : "New chore"}</span>
      <button class="dialog-close" type="button" data-action="close-overlay" aria-label="Close">×</button>
    </div>
    <div class="dialog-body">
      <div class="field">
        <label>Symbol</label>
        <div class="symbol-grid" id="sym-grid">
          ${SYMBOLS.map((label, index) => `<button class="sym-btn${SYMBOL_ICONS[index] === chore.symbol ? " active" : ""}" type="button" data-action="select-symbol" data-symbol="${SYMBOL_ICONS[index]}" title="${label}"><i class="ti ${SYMBOL_ICONS[index]}" aria-hidden="true"></i></button>`).join("")}
        </div>
      </div>
      <div id="selected-symbol" class="view-symbol-big"><i class="ti ${escapeAttr(chore.symbol)}" aria-hidden="true"></i></div>
      <div class="field"><label>Title</label><input type="text" id="f-title" value="${escapeAttr(chore.title || "")}" placeholder="e.g. Clean kitchen" maxlength="60"></div>
      <div class="field"><label>Description</label><textarea id="f-desc" placeholder="Optional details...">${escapeHtml(chore.description || "")}</textarea></div>
      <div class="field">
        <label>Schedule</label>
        <select id="f-sched-type">
          <option value="daily"${chore.schedule.type === "daily" ? " selected" : ""}>Daily</option>
          <option value="weekly"${chore.schedule.type === "weekly" ? " selected" : ""}>Weekly</option>
          <option value="monthly"${chore.schedule.type === "monthly" ? " selected" : ""}>Monthly</option>
          <option value="every"${chore.schedule.type === "every" ? " selected" : ""}>Every</option>
        </select>
        <div id="sched-extra"></div>
      </div>
    </div>
    <div class="dialog-footer">
      <button class="btn-secondary" type="button" data-action="close-overlay">Cancel</button>
      <button class="btn-primary" type="submit" data-action="save-chore" data-edit="${Boolean(chore.id)}">${isEdit ? "Save changes" : "Create"}</button>
    </div>
  </form>`;
}

document.addEventListener("change", (event) => {
  if (event.target.id === "f-sched-type") setScheduleUI({ type: event.target.value });
});

function selectSymbol(symbol) {
  document.querySelectorAll(".sym-btn").forEach((button) => button.classList.toggle("active", button.dataset.symbol === symbol));
  document.getElementById("selected-symbol").innerHTML = `<i class="ti ${escapeAttr(symbol)}" aria-hidden="true"></i>`;
}

function setScheduleUI(schedule) {
  const extra = document.getElementById("sched-extra");
  if (!extra) return;
  const type = document.getElementById("f-sched-type").value;
  if (type === "daily") extra.innerHTML = "";
  if (type === "weekly") {
    const active = schedule.days || [today().getDay()];
    extra.innerHTML = `<div class="sched-days">${DAYS.map((day, index) => `<button class="day-pill${active.includes(index) ? " active" : ""}" type="button" data-action="toggle-day" data-day="${index}">${day}</button>`).join("")}</div>`;
  }
  if (type === "monthly") {
    extra.innerHTML = `<div class="sched-days"><select id="f-mpos"><option value="first"${schedule.monthPos !== "last" ? " selected" : ""}>First</option><option value="last"${schedule.monthPos === "last" ? " selected" : ""}>Last</option></select><select id="f-mday">${DAYS.map((day, index) => `<option value="${index}"${schedule.monthDay === index ? " selected" : ""}>${day}</option>`).join("")}</select></div>`;
  }
  if (type === "every") {
    extra.innerHTML = `<div class="sched-days"><input class="inline-input" type="number" id="f-every-num" min="1" value="${schedule.num || 1}" style="width:72px"><select id="f-every-unit"><option value="days"${schedule.unit !== "weeks" && schedule.unit !== "months" ? " selected" : ""}>Days</option><option value="weeks"${schedule.unit === "weeks" ? " selected" : ""}>Weeks</option><option value="months"${schedule.unit === "months" ? " selected" : ""}>Months</option></select></div>`;
  }
}

function getSchedFromDialog() {
  const type = document.getElementById("f-sched-type").value;
  if (type === "daily") return { type: "daily" };
  if (type === "weekly") {
    const days = [...document.querySelectorAll(".day-pill.active")].map((item) => Number(item.dataset.day));
    return { type: "weekly", days: days.length ? days : [today().getDay()] };
  }
  if (type === "monthly") return { type: "monthly", monthPos: document.getElementById("f-mpos").value, monthDay: Number(document.getElementById("f-mday").value) };
  if (type === "every") return { type: "every", num: Number(document.getElementById("f-every-num").value) || 1, unit: document.getElementById("f-every-unit").value };
  return { type: "daily" };
}

function saveChore(isEdit) {
  const title = document.getElementById("f-title").value.trim();
  if (!title) {
    document.getElementById("f-title").focus();
    return;
  }
  const symbol = document.querySelector(".sym-btn.active")?.dataset.symbol || "ti-home";
  const description = document.getElementById("f-desc").value.trim();
  const schedule = getSchedFromDialog();
  if (isEdit && editId) {
    const index = chores.findIndex((chore) => chore.id === editId);
    if (index !== -1) chores[index] = { ...chores[index], symbol, title, description, schedule };
  } else {
    chores.push({ id: crypto.randomUUID(), symbol, title, description, schedule, dueDate: dateStr(firstDueFromSchedule(schedule)) });
  }
  closeOverlay();
  persist();
  renderAll();
}

function openView(id) {
  const chore = chores.find((item) => item.id === id);
  if (!chore) return;
  const isToday = chore.dueDate === todayStr();
  const next = nextDue(chore, parseDate(chore.dueDate));
  openOverlay(`<div class="dialog dialog-narrow">
    <div class="dialog-header"><i class="ti ti-info-circle" aria-hidden="true"></i><span class="dialog-title">Chore details</span><button class="dialog-close" type="button" data-action="close-overlay" aria-label="Close">×</button></div>
    <div class="dialog-body">
      <div class="action-row">
        <button class="btn-secondary" type="button" data-action="edit-chore" data-id="${escapeAttr(id)}"><i class="ti ti-edit" aria-hidden="true"></i> Edit</button>
        <div class="view-symbol-big" style="flex:1"><i class="ti ${escapeAttr(chore.symbol)}" aria-hidden="true"></i></div>
        <button class="btn-danger" type="button" data-action="confirm-delete" data-id="${escapeAttr(id)}"><i class="ti ti-trash" aria-hidden="true"></i> Delete</button>
      </div>
      <div class="view-section"><div class="view-label">Title</div><div class="view-value">${escapeHtml(chore.title)}</div></div>
      ${chore.description ? `<div class="view-section"><div class="view-label">Description</div><div class="view-value">${escapeHtml(chore.description)}</div></div>` : ""}
      <div class="view-section"><div class="view-label">Schedule</div><div class="view-value">${escapeHtml(schedLabel(chore))}</div></div>
      <div class="view-section"><div class="view-label">Due</div><div class="view-value">${parseDate(chore.dueDate).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div></div>
      <div class="view-section"><div class="view-label">Next after completion</div><div class="view-value">${next.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div></div>
      <div class="sep"></div>
      <div class="action-row">
        ${!isToday ? `<button class="action-card" type="button" data-action="pull-forward" data-id="${escapeAttr(id)}"><i class="ti ti-arrow-left" aria-hidden="true"></i><div class="action-card-label">Pull forward</div></button>` : ""}
        <button class="action-card" type="button" data-action="push-back" data-id="${escapeAttr(id)}"><i class="ti ti-arrow-right" aria-hidden="true"></i><div class="action-card-label">Push back</div></button>
      </div>
    </div>
  </div>`);
}

function openPullForward(id) {
  const chore = chores.find((item) => item.id === id);
  if (!chore) return;
  const minDate = todayStr();
  const maxDate = dateStr(addDays(parseDate(chore.dueDate), -1));
  if (maxDate < minDate) return closeOverlay();
  openDatePickerDialog("Pull forward to...", "Select a date between today and the current due date", minDate, maxDate, (value) => {
    chore.dueDate = value;
    persist();
  });
}

function openPushBack(id) {
  const chore = chores.find((item) => item.id === id);
  if (!chore) return;
  const minDate = dateStr(addDays(parseDate(chore.dueDate), 1));
  openDatePickerDialog("Push back to...", "Select a new due date after the current one", minDate, null, (value) => {
    chore.dueDate = value;
    persist();
  });
}

function openDatePickerDialog(title, subtitle, minDate, maxDate, callback) {
  calPickerCallback = callback;
  calPickerMin = minDate;
  calPickerMax = maxDate;
  const viewDate = parseDate(minDate);
  window._miniCalDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  window._miniCalSelected = null;
  openOverlay(`<div class="dialog dialog-narrow">
    <div class="dialog-header"><i class="ti ti-calendar" aria-hidden="true"></i><span class="dialog-title">${escapeHtml(title)}</span><button class="dialog-close" type="button" data-action="close-overlay" aria-label="Close">×</button></div>
    <div class="dialog-body">
      <p class="sync-status">${escapeHtml(subtitle)}</p>
      <div class="cal-header"><button class="cal-nav" type="button" data-action="shift-mini-cal" data-dir="-1">&#8249;</button><span class="cal-month-label" id="mini-cal-label"></span><button class="cal-nav" type="button" data-action="shift-mini-cal" data-dir="1">&#8250;</button></div>
      <div class="cal-grid">${DAYS.map((day) => `<div class="cal-day-label">${day[0]}</div>`).join("")}</div>
      <div class="mini-cal" id="mini-cal"></div>
      <div class="dialog-footer"><button class="btn-secondary" type="button" data-action="close-overlay">Cancel</button><button class="btn-primary" id="mini-confirm-btn" type="button" data-action="confirm-mini-cal" disabled>Confirm</button></div>
    </div>
  </div>`);
  renderMiniCal();
}

function shiftMiniCal(direction) {
  window._miniCalDate = new Date(window._miniCalDate.getFullYear(), window._miniCalDate.getMonth() + direction, 1);
  renderMiniCal();
}

function renderMiniCal() {
  const viewDate = window._miniCalDate;
  document.getElementById("mini-cal-label").textContent = `${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}`;
  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  let html = "";
  for (let index = 0; index < firstDay; index += 1) html += "<div></div>";
  for (let day = 1; day <= daysInMonth; day += 1) {
    const value = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const disabled = (calPickerMin && value < calPickerMin) || (calPickerMax && value > calPickerMax);
    html += `<button class="mini-day${disabled ? " disabled" : ""}${window._miniCalSelected === value ? " mini-selected" : ""}" type="button" ${disabled ? "disabled" : `data-action="select-mini-day" data-date="${value}"`}>${day}</button>`;
  }
  document.getElementById("mini-cal").innerHTML = html;
}

function selectMiniDay(value) {
  window._miniCalSelected = value;
  renderMiniCal();
  document.getElementById("mini-confirm-btn").disabled = false;
}

function confirmMiniCal() {
  if (!window._miniCalSelected) return;
  const callback = calPickerCallback;
  closeOverlay();
  if (callback) callback(window._miniCalSelected);
  renderAll();
}

function confirmDelete(id) {
  openOverlay(`<div class="dialog dialog-narrow">
    <div class="dialog-header"><i class="ti ti-alert-triangle" aria-hidden="true"></i><span class="dialog-title">Delete chore?</span><button class="dialog-close" type="button" data-action="close-overlay" aria-label="Close">×</button></div>
    <div class="dialog-body"><p class="sync-status">This chore will be permanently deleted and cannot be recovered.</p></div>
    <div class="dialog-footer"><button class="btn-secondary" type="button" data-action="close-overlay">Cancel</button><button class="btn-danger" type="button" data-action="delete-chore" data-id="${escapeAttr(id)}">Delete</button></div>
  </div>`);
}

function deleteChore(id) {
  chores = chores.filter((chore) => chore.id !== id);
  closeOverlay();
  persist();
  renderAll();
}

function openCalendar() {
  calViewDate = new Date(today().getFullYear(), today().getMonth(), 1);
  renderCalDialog(null);
}

function renderCalDialog(selectedDate) {
  const viewDate = calViewDate;
  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  let cells = "";
  for (let index = 0; index < firstDay; index += 1) {
    const previous = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1 - firstDay + index);
    cells += calDayHTML(previous, selectedDate, true);
  }
  for (let day = 1; day <= daysInMonth; day += 1) cells += calDayHTML(new Date(viewDate.getFullYear(), viewDate.getMonth(), day), selectedDate, false);
  const trailing = (firstDay + daysInMonth) % 7 ? 7 - ((firstDay + daysInMonth) % 7) : 0;
  for (let day = 1; day <= trailing; day += 1) cells += calDayHTML(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, day), selectedDate, true);
  const dayChores = selectedDate ? chores.filter((chore) => chore.dueDate === selectedDate) : [];
  const dayLabel = selectedDate ? parseDate(selectedDate).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "";
  openOverlay(`<div class="dialog cal-widget">
    <div class="dialog-header"><i class="ti ti-calendar-event" aria-hidden="true"></i><span class="dialog-title">Calendar</span><button class="dialog-close" type="button" data-action="close-overlay" aria-label="Close">×</button></div>
    <div class="dialog-body">
      <div class="cal-header"><button class="cal-nav" type="button" data-action="shift-cal" data-dir="-1">&#8249;</button><span class="cal-month-label">${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}</span><button class="cal-nav" type="button" data-action="shift-cal" data-dir="1">&#8250;</button></div>
      <div class="cal-grid">${DAYS.map((day) => `<div class="cal-day-label">${day[0]}</div>`).join("")}${cells}</div>
      ${selectedDate ? `<div style="margin-top:14px"><div class="upcoming-day-label">${escapeHtml(dayLabel)}</div>${dayChores.length ? dayChores.map((chore) => `<div class="day-list-item" data-chore-id="${escapeAttr(chore.id)}"><span><i class="ti ${escapeAttr(chore.symbol)}" aria-hidden="true"></i></span><div><div class="chore-title">${escapeHtml(chore.title)}</div><div class="chore-sub">${escapeHtml(schedLabel(chore))}</div></div></div>`).join("") : `<div class="empty-day">No chores on this day</div>`}</div>` : ""}
    </div>
  </div>`);
}

function calDayHTML(date, selectedDate, otherMonth) {
  const value = dateStr(date);
  const hasDot = chores.some((chore) => chore.dueDate === value);
  return `<button class="cal-day${otherMonth ? " other-month" : ""}${value === todayStr() ? " today" : ""}${value === selectedDate ? " selected" : ""}" type="button" data-action="select-cal-day" data-date="${value}"><span>${date.getDate()}</span>${hasDot ? '<div class="cal-dot"></div>' : ""}</button>`;
}

function shiftCalMonth(direction) {
  calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() + direction, 1);
  renderCalDialog(null);
}

function openOptions() {
  openOverlay(`<div class="dialog dialog-narrow">
    <div class="dialog-header"><i class="ti ti-settings" aria-hidden="true"></i><span class="dialog-title">Options</span><button class="dialog-close" type="button" data-action="close-overlay" aria-label="Close">×</button></div>
    <div class="dialog-body">
      <div class="option-row">
        <div class="option-copy"><strong>Dark mode</strong><span>Use the darker Tadoo theme.</span></div>
        <button class="switch" type="button" role="switch" aria-checked="${isDark}" data-action="toggle-theme" aria-label="Toggle dark mode"></button>
      </div>
      <div class="option-row">
        ${linkedAccount ? linkedAccountOptionHTML() : `<div class="option-copy"><strong>Wholegrain account</strong><span id="sync-status">${escapeHtml(syncStatus)}</span></div><button class="btn-secondary" type="button" data-action="link-account">Link Account</button>`}
      </div>
    </div>
  </div>`);
}

function linkedAccountOptionHTML() {
  return `<div class="option-copy"><strong>Account linked</strong><span id="sync-status">${escapeHtml(linkedAccountEmailLabel())}</span></div><span class="sync-status">Wholegrain</span>`;
}

function linkedAccountEmailLabel() {
  return linkedAccount.email || "Wholegrain account";
}

function toggleDark() {
  setTheme(isDark ? "light" : "dark");
  const switchButton = document.querySelector(".switch");
  if (switchButton) switchButton.setAttribute("aria-checked", String(isDark));
}

function setTheme(theme, persistTheme = true) {
  isDark = theme !== "light";
  document.body.classList.toggle("light", !isDark);
  if (persistTheme) writeTheme(isDark ? "dark" : "light");
}

async function linkAccount() {
  syncStatus = "Preparing account link...";
  updateSyncStatus();
  try {
    await syncRemoteChores(chores);
  } catch {
    syncStatus = "Linking with local chores";
  }
  window.location.href = buildWholegrainLinkUrl();
}

function openOverlay(html) {
  dialogContainer.innerHTML = html;
  overlay.hidden = false;
}

function closeOverlay() {
  overlay.hidden = true;
  dialogContainer.innerHTML = "";
  editId = null;
  calPickerCallback = null;
}

function playTick() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1320, context.currentTime + 0.08);
    gain.gain.setValueAtTime(0.3, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.3);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
  } catch {}
}

function launchConfetti() {
  const canvas = document.getElementById("confetti-canvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const context = canvas.getContext("2d");
  const particles = [];
  const colors = ["#7c6af5", "#a594f9", "#c4b5fd", "#4ade80", "#fbbf24", "#f87171", "#60a5fa"];
  for (let index = 0; index < 80; index += 1) {
    particles.push({ x: Math.random() * canvas.width, y: -10, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 4 + 2, color: colors[Math.floor(Math.random() * colors.length)], r: Math.random() * 4 + 2, rot: Math.random() * 360, rspeed: (Math.random() - 0.5) * 8, life: 1 });
  }
  let frame = 0;
  function animate() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((particle) => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.08;
      particle.rot += particle.rspeed;
      particle.life -= 0.012;
      if (particle.life <= 0 || particle.y > canvas.height) return;
      context.save();
      context.globalAlpha = Math.max(0, particle.life);
      context.translate(particle.x, particle.y);
      context.rotate((particle.rot * Math.PI) / 180);
      context.fillStyle = particle.color;
      context.fillRect(-particle.r, -particle.r / 2, particle.r * 2, particle.r);
      context.restore();
    });
    frame += 1;
    if (frame < 120) requestAnimationFrame(animate);
    else context.clearRect(0, 0, canvas.width, canvas.height);
  }
  animate();
}

function seedChores() {
  const ts = todayStr();
  const base = today();
  return [
    { id: crypto.randomUUID(), symbol: "ti-brush", title: "Vacuum living room", description: "Don't forget under the sofa", schedule: { type: "weekly", days: [1, 5] }, dueDate: ts },
    { id: crypto.randomUUID(), symbol: "ti-tools-kitchen-2", title: "Clean the dishes", description: "", schedule: { type: "daily" }, dueDate: ts },
    { id: crypto.randomUUID(), symbol: "ti-plant", title: "Water the plants", description: "Kitchen and balcony plants", schedule: { type: "every", num: 3, unit: "days" }, dueDate: dateStr(addDays(base, 1)) },
    { id: crypto.randomUUID(), symbol: "ti-shopping-cart", title: "Weekly shop", description: "Check the fridge first", schedule: { type: "weekly", days: [6] }, dueDate: dateStr(addDays(base, 2)) },
    { id: crypto.randomUUID(), symbol: "ti-pill", title: "Order prescriptions", description: "", schedule: { type: "monthly", monthPos: "first", monthDay: 1 }, dueDate: dateStr(addDays(base, 5)) },
    { id: crypto.randomUUID(), symbol: "ti-tool", title: "Service boiler", description: "Annual check", schedule: { type: "every", num: 12, unit: "months" }, dueDate: dateStr(addDays(base, 12)) }
  ];
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

const snoozeListDiv = document.getElementById("snooze-list");
const customModal = document.getElementById("customModal");
const recurringModal = document.getElementById("recurringModal");

let modalHandlersWired = false;
let lastOptionsSignature = "";

function getSmartSnoozeOptions() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 Sun .. 6 Sat
  const options = [];

  // Quick options
  options.push({ id: 'snooze10min', text: '10 min', hours: 0.17 });
  options.push({ id: 'snooze1hour', text: '1 hour', hours: 1 });

  // Context-aware
  if (hour < 12) {
    options.push({ id: 'snoozeAfternoon', text: 'Today 2 PM', hours: getHoursUntil(14, 0) });
  } else if (hour < 17) {
    options.push({ id: 'snoozeEvening', text: 'Today 6 PM', hours: getHoursUntil(18, 0) });
  } else {
    options.push({ id: 'snoozeNextMorning', text: 'Tomorrow 9 AM', hours: getHoursUntil(9, 0, 1) });
  }

  // Weekend / Next week
  if (day < 6) {
    options.push({ id: 'snoozeWeekend', text: 'Sat 10 AM', hours: getHoursUntilNextDay(6, 10, 0) });
  }
  if (day !== 1 || hour >= 9) {
    options.push({ id: 'snoozeNextWeek', text: 'Mon 9 AM', hours: getHoursUntilNextDay(1, 9, 0) });
  }

  return options;
}

function getHoursUntil(targetHour, targetMinute, addDays = 0) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(targetHour, targetMinute, 0, 0);
  if (addDays > 0 || target <= now) target.setDate(target.getDate() + (addDays || 1));
  return (target - now) / 36e5;
}

function getHoursUntilNextDay(targetDay, targetHour, targetMinute) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(targetHour, targetMinute, 0, 0);
  while (target.getDay() !== targetDay || target <= now) target.setDate(target.getDate() + 1);
  return (target - now) / 36e5;
}

// ---- Recurring confirm handler (restored) ----
async function handleRecurringSnooze() {
  const timeInput = document.getElementById("recurringTime");
  const selectedDays = Array.from(document.querySelectorAll(".days-selector input:checked"))
    .map(cb => parseInt(cb.value, 10));

  if (selectedDays.length === 0) {
    alert("Please select at least one day for recurring snooze.");
    return;
  }

  const [hours, minutes] = timeInput.value.split(":").map(Number);
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!currentTab || !currentTab.url) {
    alert("No active tab found to snooze.");
    return;
  }

  const recurringConfig = {
    url: currentTab.url,
    title: currentTab.title,
    time: timeInput.value,
    days: selectedDays,
    type: "recurring"
  };

  const configId = `recurring-${Date.now()}`;
  await chrome.storage.local.set({ [configId]: recurringConfig });

  const nextTime = getNextOccurrence(hours, minutes, selectedDays);
  const alarmName = `snooze-${currentTab.id}-${nextTime.getTime()}`;

  await chrome.storage.local.set({
    [alarmName]: {
      url: currentTab.url,
      snoozeTime: nextTime.getTime(),
      title: currentTab.title,
      recurringId: configId
    }
  });

  chrome.alarms.create(alarmName, { when: nextTime.getTime() });
  chrome.tabs.remove(currentTab.id);

  recurringModal.style.display = "none";
  alert("Recurring snooze set successfully!");
}

// Helper for recurring next time (popup-side)
function getNextOccurrence(hours, minutes, selectedDays) {
  const now = new Date();
  const result = new Date();
  result.setHours(hours, minutes, 0, 0);
  if (result <= now) result.setDate(result.getDate() + 1);
  while (!selectedDays.includes(result.getDay())) result.setDate(result.getDate() + 1);
  return result;
}

function openModal(el) { el.style.display = "block"; const f = el.querySelector('input,button'); if (f) f.focus(); }
function closeModal(el) { el.style.display = "none"; }

function setupModalHandlers() {
  if (modalHandlersWired) return;
  modalHandlersWired = true;

  // Open custom
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#snoozeCustom");
    if (!btn) return;
    const dateTimeInput = document.getElementById("customDateTime");

    const now = new Date();
    dateTimeInput.min = toLocalDatetimeValue(now);

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    dateTimeInput.value = toLocalDatetimeValue(tomorrow);

    openModal(customModal);
  });

  // Open recurring
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#snoozeRecurring");
    if (!btn) return;
    const timeInput = document.getElementById("recurringTime");
    if (!timeInput.value) timeInput.value = "09:00";
    openModal(recurringModal);
  });

  // Cancel buttons
  document.querySelectorAll(".modal .modal-cancel").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".modal").forEach(m => (m.style.display = "none"));
    });
  });

  // Backdrop click
  document.querySelectorAll(".modal").forEach(modal => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  // Esc key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal").forEach(m => (m.style.display = "none"));
    }
  });

  // Custom datetime confirm
  document.querySelector("#customModal .modal-confirm").addEventListener("click", async () => {
    const dateTimeInput = document.getElementById("customDateTime");
    const selected = new Date(dateTimeInput.value);
    if (!dateTimeInput.value || selected.getTime() <= Date.now()) {
      alert("Please select a future date and time.");
      return;
    }
    const hoursFromNow = (selected.getTime() - Date.now()) / 36e5;
    await snoozeTab(hoursFromNow);
    closeModal(customModal);
  });

  // Recurring confirm
  document.querySelector("#recurringModal .modal-confirm").addEventListener("click", handleRecurringSnooze);
}

function toLocalDatetimeValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function optionsSignature(opts) {
  return opts.map(o => `${o.id}:${o.text}:${o.hours.toFixed(3)}`).join('|');
}

function updateSnoozeGrid() {
  const snoozeGrid = document.querySelector('.snooze-grid');
  const options = getSmartSnoozeOptions();
  const sig = optionsSignature(options);
  if (sig === lastOptionsSignature && snoozeGrid.children.length) return;

  lastOptionsSignature = sig;
  snoozeGrid.innerHTML = '';

  options.forEach(option => {
    const button = document.createElement('button');
    button.id = option.id;
    button.textContent = option.text;
    button.addEventListener('click', () => snoozeTab(option.hours), { once: true });
    snoozeGrid.appendChild(button);
  });

  // custom + recurring
  const customButton = document.createElement('button');
  customButton.id = 'snoozeCustom';
  customButton.className = 'custom-snooze';
  customButton.textContent = 'Pick date/time';
  snoozeGrid.appendChild(customButton);

  const recurringButton = document.createElement('button');
  recurringButton.id = 'snoozeRecurring';
  recurringButton.className = 'custom-snooze';
  recurringButton.textContent = 'Set recurring';
  snoozeGrid.appendChild(recurringButton);

  setupModalHandlers();
}

document.addEventListener('DOMContentLoaded', () => {
  updateSnoozeGrid();
  listSnoozed();
});

setInterval(updateSnoozeGrid, 60_000);

async function snoozeTab(hours) {
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!currentTab || !currentTab.url) {
    alert("No active tab found to snooze.");
    return;
  }

  const snoozeTime = Date.now() + hours * 36e5;
  const alarmName = `snooze-${currentTab.id}-${snoozeTime}`;

  await chrome.storage.local.set({
    [alarmName]: { url: currentTab.url, snoozeTime, title: currentTab.title },
  });

  chrome.alarms.create(alarmName, { when: snoozeTime });
  chrome.tabs.remove(currentTab.id);

  console.log(`Snoozed for ~${Math.round(hours * 60)} minutes.`);
}

async function removeSnooze(alarmName) {
  const item = await chrome.storage.local.get(alarmName);
  const removeModal = document.getElementById("removeModal");
  const removeRecurringModal = document.getElementById("removeRecurringModal");

  if (item[alarmName]?.recurringId) {
    const modal = removeRecurringModal;
    openModal(modal);

    return new Promise((resolve) => {
      const handleClick = async (action) => {
        closeModal(modal);
        if (action === 'cancel') return resolve();

        await chrome.alarms.clear(alarmName);
        await chrome.storage.local.remove(alarmName);

        if (action === 'removeAll' || action === 'removeAllAndOpen') {
          await chrome.storage.local.remove(item[alarmName].recurringId);
        }
        if (action === 'removeAllAndOpen' || action === 'removeSingleAndOpen') {
          await chrome.tabs.create({ url: item[alarmName].url });
        }
        listSnoozed();
        resolve();
      };

      modal.querySelector('.modal-confirm').onclick = () => handleClick('removeAllAndOpen');
      modal.querySelector('.modal-remove-only').onclick = () => handleClick('removeAll');
      modal.querySelector('.modal-remove-single').onclick = () => handleClick('removeSingleAndOpen');
      modal.querySelector('.modal-cancel').onclick = () => handleClick('cancel');
    });
  } else {
    const modal = removeModal;
    openModal(modal);

    return new Promise((resolve) => {
      const handleClick = async (action) => {
        closeModal(modal);
        if (action === 'cancel') return resolve();

        await chrome.alarms.clear(alarmName);
        await chrome.storage.local.remove(alarmName);

        if (action === 'removeAndOpen') {
          await chrome.tabs.create({ url: item[alarmName].url });
        }
        listSnoozed();
        resolve();
      };

      modal.querySelector('.modal-confirm').onclick = () => handleClick('removeAndOpen');
      modal.querySelector('.modal-remove-only').onclick = () => handleClick('removeOnly');
      modal.querySelector('.modal-cancel').onclick = () => handleClick('cancel');
    });
  }
}

function listSnoozed() {
  snoozeListDiv.innerHTML = "";

  chrome.storage.local.get(null, (items) => {
    const tabsContainer = document.createElement("div");
    tabsContainer.className = "tabs-container";
    snoozeListDiv.appendChild(tabsContainer);

    const regularSnoozes = Object.entries(items).filter(([key, value]) =>
      key.startsWith("snooze-") && !value.recurringId
    );
    const recurringSnoozes = Object.entries(items).filter(([key, value]) =>
      key.startsWith("snooze-") && value.recurringId
    );

    const tabButtons = document.createElement("div");
    tabButtons.className = "tab-buttons";
    tabButtons.innerHTML = `
      <button class="tab-button active" data-tab="regular">
        One-time <span class="count">${regularSnoozes.length}</span>
      </button>
      <button class="tab-button" data-tab="recurring">
        Recurring <span class="count">${recurringSnoozes.length}</span>
      </button>
    `;
    tabsContainer.appendChild(tabButtons);

    const regularTabContent = document.createElement("div");
    regularTabContent.className = "tab-content active";
    regularTabContent.id = "regular-tab";

    const recurringTabContent = document.createElement("div");
    recurringTabContent.className = "tab-content";
    recurringTabContent.id = "recurring-tab";

    if (regularSnoozes.length === 0) {
      regularTabContent.innerHTML = `
        <div class="empty-state">
          <p>No snoozed tabs</p>
          <p class="empty-subtitle">Choose a time above to snooze your current tab</p>
        </div>`;
    }
    if (recurringSnoozes.length === 0) {
      recurringTabContent.innerHTML = `
        <div class="empty-state">
          <p>No recurring tabs</p>
          <p class="empty-subtitle">Set up recurring snoozes for tabs you need regularly</p>
        </div>`;
    }

    tabsContainer.appendChild(regularTabContent);
    tabsContainer.appendChild(recurringTabContent);

    tabButtons.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', () => {
        tabButtons.querySelector('.active').classList.remove('active');
        button.classList.add('active');
        tabsContainer.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tabsContainer.querySelector(`#${button.dataset.tab}-tab`).classList.add('active');
      });
    });

    const addItemToTab = (key, value, container) => {
      const { url, snoozeTime, title, recurringId } = value;
      const snoozeTimeStr = new Date(snoozeTime).toLocaleString();
      const listItem = document.createElement("div");
      listItem.className = "snoozed-tab";

      const recurringIndicator = recurringId ? "🔄 " : "";
      const data = title || url;

      listItem.innerHTML = `
        <span title="${data}" class="tab-info">
          <div class="tab-title">${recurringIndicator}${data}</div>
          <div class="tab-time">${snoozeTimeStr}</div>
        </span>
      `;

      const removeButton = document.createElement("button");
      removeButton.className = "remove-btn";
      removeButton.innerHTML = '<span class="close-icon"></span>';
      removeButton.title = "Remove snooze";
      removeButton.addEventListener("click", () => removeSnooze(key));
      listItem.appendChild(removeButton);

      container.appendChild(listItem);
    };

    regularSnoozes.sort(([,a], [,b]) => a.snoozeTime - b.snoozeTime)
      .forEach(([key, val]) => addItemToTab(key, val, regularTabContent));
    recurringSnoozes.sort(([,a], [,b]) => a.snoozeTime - b.snoozeTime)
      .forEach(([key, val]) => addItemToTab(key, val, recurringTabContent));
  });
}

// Material-ish ripple
document.addEventListener('click', (e) => {
  const target = e.target.closest('button');
  if (!target) return;

  const rect = target.getBoundingClientRect();
  const ripple = document.createElement('span');
  const size = Math.max(rect.width, rect.height);
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
  ripple.style.top  = `${e.clientY - rect.top  - size / 2}px`;
  ripple.style.zIndex = 1;
  target.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
});

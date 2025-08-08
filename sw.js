try {
  // ------- Concurrency guard -------
  let isCheckingTabs = false;

  async function checkForSnoozedTabs() {
    if (isCheckingTabs) {
      console.log("checkForSnoozedTabs is already running. Skipping.");
      return;
    }
    isCheckingTabs = true;

    try {
      const now = Date.now();
      const items = await chrome.storage.local.get(null); // all keys

      for (const [key, value] of Object.entries(items)) {
        if (!value || !value.snoozeTime) continue;
        if (value.snoozeTime > now) continue;

        if (value.processing) {
          console.log(`Skipping ${key}, already processing.`);
          continue;
        }

        // mark processing to avoid double opens
        value.processing = true;
        await chrome.storage.local.set({ [key]: value });

        try {
          await chrome.tabs.create({ url: value.url });
          console.log(`Reopened tab: ${value.url}`);

          // Handle recurring
          if (value.recurringId) {
            const recurringConfig = items[value.recurringId];
            if (recurringConfig) {
              const [h, m] = recurringConfig.time.split(":").map(Number);
              const nextTime = getNextOccurrence(h, m, recurringConfig.days);
              const newAlarmName = `snooze-${Date.now()}-${nextTime.getTime()}`;

              await chrome.storage.local.set({
                [newAlarmName]: {
                  url: value.url,
                  title: value.title,
                  snoozeTime: nextTime.getTime(),
                  recurringId: value.recurringId
                }
              });

              chrome.alarms.create(newAlarmName, { when: nextTime.getTime() });
              console.log(`Scheduled next recurring snooze for: ${value.url}`);
            }
          }

          // remove current entry
          await chrome.storage.local.remove(key);
          console.log(`Cleared snooze entry: ${key}`);
        } catch (err) {
          console.error(`Failed to reopen tab for ${key}:`, err);
          // clear processing flag so we can try again later
          value.processing = false;
          await chrome.storage.local.set({ [key]: value });
        }
      }
    } catch (err) {
      console.error("Error in checkForSnoozedTabs:", err);
    } finally {
      isCheckingTabs = false;
    }
  }

  // Next occurrence for recurring config
  function getNextOccurrence(hours, minutes, selectedDays) {
    const now = new Date();
    const result = new Date();
    result.setHours(hours, minutes, 0, 0);
    if (result <= now) result.setDate(result.getDate() + 1);
    while (!selectedDays.includes(result.getDay())) {
      result.setDate(result.getDate() + 1);
    }
    return result;
  }

  // ------- MV3-friendly heartbeat using chrome.alarms -------
  const HEARTBEAT_NAME = "snoozer-heartbeat";
  const HEARTBEAT_MINUTES = 5;

  async function ensureHeartbeat() {
    const alarms = await chrome.alarms.getAll();
    const exists = alarms.some(a => a.name === HEARTBEAT_NAME);
    if (!exists) {
      chrome.alarms.create(HEARTBEAT_NAME, { periodInMinutes: HEARTBEAT_MINUTES });
      console.log("Heartbeat alarm created.");
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    console.log("Tab Snoozer installed");
    ensureHeartbeat();
  });

  chrome.runtime.onStartup.addListener(() => {
    console.log("Tab Snoozer service worker started");
    ensureHeartbeat();
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === HEARTBEAT_NAME) {
      console.log("Heartbeat: scanning for due tabs...");
    } else {
      console.log(`Snooze alarm: ${alarm.name}`);
    }
    await checkForSnoozedTabs();
  });

} catch (e) {
  console.log(e);
}

/**
 * Fridge Dashboard – data endpoint (Google Apps Script)  · v3
 *
 * Returns JSON: today/tomorrow calendar events, meals, to-dos, shopping list,
 * countdowns, message, pack reminder, photos (with orientation + date taken).
 *
 * After pasting: Save → run setupForm() once (family quick-add form)
 * → Deploy → Manage deployments → Edit → New version → Deploy.
 */

// ---------- CONFIG (edit these) ----------
const CONFIG = {
  // One entry per calendar. Use either a calendar NAME (as shown in Google
  // Calendar's left sidebar) or its ID. Colour = that person's dot.
  // Run listCalendars() to see every calendar name and ID you have access to.
  CALENDARS: [
    { id: 'primary', color: '#F2A65A', who: 'Me' },                          // You
    { name: 'Family', color: '#E8E2D6', who: 'All' },                        // Family
    { name: 'Academic Calendar - FIITJEE NNG', color: '#7FB3FF', who: 'Kids' },// Kids' school
    // { name: 'Holidays in India', color: '#8FD3B6', who: 'All' },          // off: noisy
  ],

  // Google Drive folder ID for photo mode (the part after /folders/ in its URL).
  PHOTO_FOLDER_ID: '',

  MAX_PHOTOS: 300,
  TASK_LISTS: ['Fridge', '@default'],   // Google Tasks lists shown under REMIND ('@default' = your main list)
  CACHE_SECONDS: 120,   // dashboard polls every 5 min; Sheet edits show within ~5–7 min
};
// -----------------------------------------

function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('DASH_KEY');
  if (!key || !e || !e.parameter || e.parameter.key !== key) {
    return json_({ error: 'unauthorized' });
  }
  const cache = CacheService.getScriptCache();
  const hit = cache.get('payload');
  if (hit && !e.parameter.nocache) {
    return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  }
  let payload;
  try {
    payload = JSON.stringify(build_());
  } catch (err) {
    return json_({ error: String(err) });
  }
  if (payload.length < 95000) cache.put('payload', payload, CONFIG.CACHE_SECONDS);
  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
}

function build_() {
  const tz = Session.getScriptTimeZone();
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const dayAfter = new Date(today.getTime() + 2 * 86400000);

  return {
    v: 3,
    generatedAt: now.getTime(),
    today: withWorkout_(events_(today, tomorrow, tz), ss, today),
    tomorrow: withWorkout_(events_(tomorrow, dayAfter, tz), ss, tomorrow),
    meals: { today: mealFor_(ss, today, tz), tomorrow: mealFor_(ss, tomorrow, tz) },
    todos: listItems_(ss, 'todo'),
    shopping: listItems_(ss, 'buy'),
    countdowns: countdowns_(ss, today),
    message: setting_(ss, 'message'),
    pack: setting_(ss, 'pack'),
    photos: photos_(),
    tasks: tasks_(today, tomorrow),
  };
}

// ---------- Calendar ----------
function calendarFor_(c) {
  if (c.name) {
    const list = CalendarApp.getCalendarsByName(c.name);
    return list && list.length ? list[0] : null;
  }
  if (!c.id || c.id === 'primary') return CalendarApp.getDefaultCalendar();
  return CalendarApp.getCalendarById(c.id);
}

function events_(start, end, tz) {
  const out = [];
  const seen = {};
  CONFIG.CALENDARS.forEach(function (c) {
    const cal = calendarFor_(c);
    if (!cal) return;
    cal.getEvents(start, end).forEach(function (ev) {
      const k = ev.getId() + ev.getStartTime().getTime();
      if (seen[k]) return;          // same event shared across calendars
      seen[k] = true;
      const allDay = ev.isAllDayEvent();
      const p = splitWho_(ev.getTitle());
      out.push({
        title: p.title,
        who: p.who || c.who || '',
        allDay: allDay,
        start: ev.getStartTime().getTime(),
        end: ev.getEndTime().getTime(),
        time: allDay ? 'All day' : Utilities.formatDate(ev.getStartTime(), tz, 'h:mm'),
        color: c.color,
      });
    });
  });
  out.sort(function (a, b) {
    return (a.allDay ? 0 : 1) - (b.allDay ? 0 : 1) || a.start - b.start;
  });
  return out;
}

/** Run from the editor: logs every calendar you can see, with its ID. */
function listCalendars() {
  CalendarApp.getAllCalendars().forEach(function (c) {
    Logger.log(c.getName() + '  →  ' + c.getId());
  });
}

// ---------- Liftin workout (synced daily into Settings by a scheduled Claude task) ----------
// Settings rows: "workout" = Liftin's up-next routine name, "workout_synced" = date of last sync.
// Shown as a "Gym" row on today's and tomorrow's lists. Value "Rest" (or blank) hides it.
function withWorkout_(events, ss, dayStart) {
  const rows = rows_(ss, 'Settings');
  const get = function (k) {
    const r = rows.find(function (x) { return String(x.key).trim().toLowerCase() === k; });
    return r ? r.value : '';
  };
  const name = String(get('workout') || '').trim();
  if (!name || /^rest/i.test(name)) return events;
  const synced = get('workout_synced');
  const syncedAt = synced instanceof Date ? synced : new Date(String(synced));
  const stale = isNaN(syncedAt.getTime()) || (Date.now() - syncedAt.getTime()) > 3 * 86400000;
  const short = name.replace(/^day\s*\d+\s*[—–-]\s*/i, '');
  const color = (CONFIG.CALENDARS[0] && CONFIG.CALENDARS[0].color) || '#F2A65A';
  return [{
    who: 'Me', title: short + (stale ? ' (sync overdue)' : ''),
    allDay: true, start: dayStart.getTime(), end: dayStart.getTime() + 86400000,
    time: 'Gym', color: color,
  }].concat(events);
}

// "Rhea · NSEC" → who: Rhea, title: NSEC
function splitWho_(s) {
  const m = /^\s*([^·]{1,14}?)\s*·\s+(.+)$/.exec(String(s));
  return m ? { who: m[1].trim(), title: m[2].trim() } : { who: '', title: String(s) };
}

// ---------- Google Tasks (needs the "Tasks" advanced service) ----------
function tasks_(today, tomorrow) {
  const out = { today: [], tomorrow: [] };
  if (typeof Tasks === 'undefined') return out;
  const tz = Session.getScriptTimeZone();
  const tKey = Utilities.formatDate(today, tz, 'yyyy-MM-dd');
  const mKey = Utilities.formatDate(tomorrow, tz, 'yyyy-MM-dd');
  let lists = [];
  try { lists = Tasks.Tasklists.list({ maxResults: 100 }).items || []; } catch (e) { return out; }
  const want = (CONFIG.TASK_LISTS || []).map(function (w) { return String(w).toLowerCase(); });
  lists.forEach(function (l, i) {
    const ok = want.indexOf(String(l.title).toLowerCase()) >= 0 || (i === 0 && want.indexOf('@default') >= 0);
    if (!ok) return;
    let res;
    try { res = Tasks.Tasks.list(l.id, { showCompleted: false, showHidden: false, maxResults: 100 }); } catch (e) { return; }
    (res.items || []).forEach(function (t) {
      if (!t.title || !t.due) return;
      const d = String(t.due).slice(0, 10);
      if (d <= tKey) out.today.push(String(t.title));       // overdue counts as today
      else if (d === mKey) out.tomorrow.push(String(t.title));
    });
  });
  out.today = out.today.slice(0, 6);
  out.tomorrow = out.tomorrow.slice(0, 6);
  return out;
}

function fridgeListId_() {
  const lists = Tasks.Tasklists.list({ maxResults: 100 }).items || [];
  const f = lists.find(function (l) { return l.title === 'Fridge'; });
  return f ? f.id : Tasks.Tasklists.insert({ title: 'Fridge' }).id;
}

// ---------- Sheet helpers ----------
function rows_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues();
  const head = v.shift().map(function (h) { return String(h).trim().toLowerCase(); });
  return v
    .filter(function (r) { return r.some(function (x) { return x !== '' && x !== false; }); })
    .map(function (r) {
      const o = {};
      head.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    });
}

function mealFor_(ss, date, tz) {
  const day = Utilities.formatDate(date, tz, 'EEE').toLowerCase();
  const row = rows_(ss, 'Meals').find(function (r) {
    return String(r.day).trim().toLowerCase().slice(0, 3) === day;
  });
  if (!row) return null;
  return {
    breakfast: String(row.breakfast || ''),
    lunch: String(row['lunch box'] || ''),
    dinner: String(row.dinner || ''),
    prep: String(row.prep || ''),
  };
}

function listItems_(ss, type) {
  return rows_(ss, 'Lists')
    .filter(function (r) {
      return String(r.type).trim().toLowerCase() === type && r.done !== true;
    })
    .map(function (r) { return String(r.item); })
    .slice(0, 6);
}

// Countdowns = upcoming one-off events on the Family calendar (next 90 days)
// plus any rows in the Countdowns tab. Recurring events are skipped so a weekly
// class doesn't crowd out tests. Today's events are left to the Today list.
const COUNTDOWN_CALENDAR = 'Family';
const COUNTDOWN_DAYS = 90;

function countdowns_(ss, today) {
  const out = [];
  const seen = {};
  const add = function (label, d) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round((day - today) / 86400000);
    const k = label.toLowerCase() + '|' + days;
    if (days < 0 || seen[k]) return;
    seen[k] = true;
    out.push({ label: label, days: days });
  };
  try {
    const cal = calendarFor_({ name: COUNTDOWN_CALENDAR });
    if (cal) {
      const from = new Date(today.getTime() + 86400000);
      const to = new Date(today.getTime() + COUNTDOWN_DAYS * 86400000);
      cal.getEvents(from, to).forEach(function (ev) {
        if (ev.isRecurringEvent()) return;
        add(ev.getTitle(), ev.getStartTime());
      });
    }
  } catch (err) {
    console.warn('Countdown calendar read failed: ' + err);
  }
  rows_(ss, 'Countdowns').forEach(function (r) {
    if (r.date instanceof Date) add(String(r.event), r.date);
  });
  return out.sort(function (a, b) { return a.days - b.days; }).slice(0, 3);
}

function setting_(ss, key) {
  const row = rows_(ss, 'Settings').find(function (r) {
    return String(r.key).trim().toLowerCase() === key;
  });
  return row ? String(row.value || '') : '';
}

// ---------- Photos ----------
// With the "Drive API" service enabled (Services → + → Drive API), photos carry
// orientation and the date they were taken. Without it, they still work, just
// without captions and with every photo treated as landscape.
function photos_() {
  if (!CONFIG.PHOTO_FOLDER_ID) return [];
  try {
    if (typeof Drive !== 'undefined') return photosRich_();
  } catch (err) {
    console.warn('Drive API failed, falling back: ' + err);
  }
  const it = DriveApp.getFolderById(CONFIG.PHOTO_FOLDER_ID).getFiles();
  const out = [];
  while (it.hasNext() && out.length < CONFIG.MAX_PHOTOS) {
    const f = it.next();
    if (f.getMimeType().indexOf('image/') === 0) out.push({ id: f.getId() });
  }
  return out;
}

function photosRich_() {
  const out = [];
  let token = null;
  do {
    const res = Drive.Files.list({
      q: "'" + CONFIG.PHOTO_FOLDER_ID + "' in parents and trashed = false and mimeType contains 'image/'",
      fields: 'nextPageToken, files(id, imageMediaMetadata(width, height, rotation, time))',
      pageSize: 200,
      pageToken: token,
    });
    (res.files || []).forEach(function (f) {
      const m = f.imageMediaMetadata || {};
      let w = m.width || 0, h = m.height || 0;
      if (m.rotation === 1 || m.rotation === 3) { const t = w; w = h; h = t; }
      let taken = '';
      if (m.time && /^\d{4}:\d{2}/.test(m.time)) taken = m.time.slice(0, 4) + '-' + m.time.slice(5, 7);
      out.push({ id: f.id, w: w, h: h, t: taken });
    });
    token = res.nextPageToken;
  } while (token && out.length < CONFIG.MAX_PHOTOS);
  return out.slice(0, CONFIG.MAX_PHOTOS);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Family quick-add form ----------
// Branching form: buy / to-do / reminder / test-or-event. Re-running setupForm()
// rebuilds the questions on the SAME form, so the shared link never changes.
const Q_KIND = 'What are you adding?';
const Q_ITEM = 'What is it?';
const Q_EVENT = 'Name of the test or event';
const Q_DATE = 'Date';
const Q_WHO = 'Whose is it? (optional)';
const Q_TYPE = 'Kind';
const Q_REM = 'Remind about';
const Q_REM_DATE = 'On which day?';

function setupForm() {
  const props = PropertiesService.getScriptProperties();
  let form;
  const existing = props.getProperty('FORM_ID');
  if (existing) {
    form = FormApp.openById(existing);
    form.getItems().forEach(function (it) { form.deleteItem(it); });
  } else {
    form = FormApp.create('Add to fridge');
    props.setProperty('FORM_ID', form.getId());
  }
  form.setTitle('Add to fridge')
      .setDescription('Adds something to the fridge dashboard. It shows up within a few minutes.')
      .setConfirmationMessage('Added! It will show on the fridge in a few minutes.')
      .setShowLinkToRespondAgain(true)
      .setCollectEmail(false)
      .setProgressBar(false);

  const kind = form.addMultipleChoiceItem().setTitle(Q_KIND).setRequired(true);

  const itemPage = form.addPageBreakItem().setTitle('Shopping or to-do');
  form.addTextItem().setTitle(Q_ITEM).setRequired(true);

  const eventPage = form.addPageBreakItem().setTitle('Test or event')
      .setHelpText('It appears as a countdown on the fridge and on the Family calendar for that day.');
  form.addTextItem().setTitle(Q_EVENT).setHelpText('e.g. Physics unit test, Annual day, Science project due').setRequired(true);
  form.addDateItem().setTitle(Q_DATE).setRequired(true);
  form.addTextItem().setTitle(Q_WHO).setHelpText('Your name, or leave blank for the whole family');
  form.addMultipleChoiceItem().setTitle(Q_TYPE).setChoiceValues(['Test', 'Event', 'Deadline', 'Birthday']).setRequired(true);

  const remPage = form.addPageBreakItem().setTitle('Reminder')
      .setHelpText('Shows under REMIND on the fridge on that day (and the evening before, under Tomorrow).');
  form.addTextItem().setTitle(Q_REM).setHelpText('e.g. Carry sports shoes, Pay school fee').setRequired(true);
  form.addDateItem().setTitle(Q_REM_DATE).setRequired(true);

  // A page break's goTo = where to go after the section BEFORE it.
  eventPage.setGoToPage(FormApp.PageNavigationType.SUBMIT);   // after shopping/to-do → submit
  remPage.setGoToPage(FormApp.PageNavigationType.SUBMIT);     // after test/event → submit
  kind.setChoices([
    kind.createChoice('Something to buy', itemPage),
    kind.createChoice('A to-do', itemPage),
    kind.createChoice('A reminder (with a date)', remPage),
    kind.createChoice('A test or event', eventPage),
  ]);

  fridgeListId_();   // make sure the "Fridge" task list exists

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'fridgeFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('fridgeFormSubmit').forForm(form).onFormSubmit().create();
  Logger.log('Form link (unchanged): ' + form.getPublishedUrl());
}

function fridgeFormSubmit(e) {
  const a = {};
  e.response.getItemResponses().forEach(function (r) { a[r.getItem().getTitle()] = r.getResponse(); });
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  const kind = String(a[Q_KIND] || a['Type'] || '');
  const ymd = function (s) { return /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); };

  if (/test or event/i.test(kind)) {
    const name = String(a[Q_EVENT] || '').trim();
    const m = ymd(a[Q_DATE]);
    if (!name || !m) return;
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const who = String(a[Q_WHO] || '').trim();
    const label = (who ? who + ' · ' : '') + name;
    try {
      const cal = calendarFor_({ name: COUNTDOWN_CALENDAR }) || CalendarApp.getDefaultCalendar();
      cal.createAllDayEvent(label, date, { description: 'Added from the fridge form (' + (a[Q_TYPE] || 'Event') + ')' });
    } catch (err) {
      console.warn('Calendar add failed: ' + err);
    }
  } else if (/reminder/i.test(kind)) {
    const what = String(a[Q_REM] || '').trim();
    const m = ymd(a[Q_REM_DATE]);
    if (!what || !m) return;
    Tasks.Tasks.insert({ title: what, due: m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00.000Z' }, fridgeListId_());
  } else {
    const what = String(a[Q_ITEM] || a['What?'] || '').trim();
    if (!what) return;
    const type = /buy/i.test(kind) ? 'buy' : 'todo';
    ss.getSheetByName('Lists').appendRow([what, type, false]);
  }
  CacheService.getScriptCache().remove('payload');   // show it on the next poll
}

// ---------- One-time setup (already done) ----------
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  if (!props.getProperty('DASH_KEY')) {
    props.setProperty('DASH_KEY', Utilities.getUuid().replace(/-/g, ''));
  }
  makeTab_(ss, 'Meals', ['Day', 'Breakfast', 'Lunch box', 'Dinner', 'Prep'], [
    ['Mon', 'Idli', 'Lemon rice', 'Dal, rice, beans fry', ''],
    ['Tue', 'Upma', 'Chapati, sabzi', 'Sambar, rice', ''],
    ['Wed', 'Dosa', 'Curd rice', 'Rajma, rice', 'Soak rajma tonight'],
    ['Thu', 'Poha', 'Veg pulao', 'Rajma chawal', ''],
    ['Fri', 'Pesarattu', 'Curd rice', 'Dal, jeera rice, bhindi fry', 'Soak moong dal tonight'],
    ['Sat', 'Puri, aloo', '', 'Biryani', ''],
    ['Sun', 'Pongal', '', 'Something light', ''],
  ]);
  makeTab_(ss, 'Lists', ['Item', 'Type', 'Done'], [
    ['Pay internet bill', 'todo', false],
    ['Curd', 'buy', false],
  ]);
  const lists = ss.getSheetByName('Lists');
  lists.getRange('C2:C500').insertCheckboxes();
  lists.getRange('B2:B500').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['todo', 'buy'], true).build()
  );
  makeTab_(ss, 'Countdowns', ['Event', 'Date'], [['Unit test', new Date(Date.now() + 14 * 86400000)]]);
  ss.getSheetByName('Countdowns').getRange('B2:B200').setNumberFormat('d mmm yyyy');
  makeTab_(ss, 'Settings', ['Key', 'Value'], [['message', 'Proud of you, champ!'], ['pack', 'Hall ticket, umbrella']]);
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
  Logger.log('YOUR KEY: ' + props.getProperty('DASH_KEY'));
}

function makeTab_(ss, name, header, sample) {
  if (ss.getSheetByName(name)) return;
  const sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (sample.length) sh.getRange(2, 1, sample.length, header.length).setValues(sample);
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
}

/** Logs exactly what the dashboard receives. */
function test() {
  Logger.log(JSON.stringify(build_(), null, 2));
}

function showKey() {
  Logger.log(PropertiesService.getScriptProperties().getProperty('DASH_KEY'));
}

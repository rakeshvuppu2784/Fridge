/**
 * Fridge Dashboard – data endpoint (Google Apps Script)  · v2
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
    { id: 'primary', color: '#F2A65A' },               // You
    // { name: 'Family',  color: '#E8E2D6' },
    // { name: 'Kids',    color: '#7FB3FF' },
    // { id: 'spouse@gmail.com', color: '#8FD3B6' },
  ],

  // Google Drive folder ID for photo mode (the part after /folders/ in its URL).
  PHOTO_FOLDER_ID: '',

  MAX_PHOTOS: 300,
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
    v: 2,
    generatedAt: now.getTime(),
    today: events_(today, tomorrow, tz),
    tomorrow: events_(tomorrow, dayAfter, tz),
    meals: { today: mealFor_(ss, today, tz), tomorrow: mealFor_(ss, tomorrow, tz) },
    todos: listItems_(ss, 'todo'),
    shopping: listItems_(ss, 'buy'),
    countdowns: countdowns_(ss, today),
    message: setting_(ss, 'message'),
    pack: setting_(ss, 'pack'),
    photos: photos_(),
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
      out.push({
        title: ev.getTitle(),
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

function countdowns_(ss, today) {
  return rows_(ss, 'Countdowns')
    .filter(function (r) { return r.date instanceof Date; })
    .map(function (r) {
      const d = new Date(r.date.getFullYear(), r.date.getMonth(), r.date.getDate());
      return { label: String(r.event), days: Math.round((d - today) / 86400000) };
    })
    .filter(function (c) { return c.days >= 0; })
    .sort(function (a, b) { return a.days - b.days; })
    .slice(0, 3);
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
/** Run once. Creates a 2-question Google Form whose answers land in the Lists tab. */
function setupForm() {
  const props = PropertiesService.getScriptProperties();
  let form;
  const existing = props.getProperty('FORM_ID');
  if (existing) {
    form = FormApp.openById(existing);
  } else {
    form = FormApp.create('Add to fridge');
    form.setDescription('Adds an item to the fridge dashboard.')
        .setConfirmationMessage('Added. It will show on the fridge in a few minutes.')
        .setShowLinkToRespondAgain(true)
        .setCollectEmail(false);
    form.addTextItem().setTitle('What?').setRequired(true);
    form.addMultipleChoiceItem().setTitle('Type')
        .setChoiceValues(['Buy', 'To-do']).setRequired(true);
    props.setProperty('FORM_ID', form.getId());
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'fridgeFormSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('fridgeFormSubmit').forForm(form).onFormSubmit().create();
  Logger.log('Share this link with the family (add it to their home screens):');
  Logger.log(form.getPublishedUrl());
}

function fridgeFormSubmit(e) {
  const answers = e.response.getItemResponses();
  const what = String(answers[0].getResponse()).trim();
  const type = /buy/i.test(String(answers[1].getResponse())) ? 'buy' : 'todo';
  if (!what) return;
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  ss.getSheetByName('Lists').appendRow([what, type, false]);
  CacheService.getScriptCache().remove('payload');   // show it on next poll
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

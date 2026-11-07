/**
 * Fridge Dashboard – data endpoint (Google Apps Script)
 *
 * Paste this into Extensions → Apps Script of a blank Google Sheet.
 * Run setup() once, then Deploy → New deployment → Web app.
 *
 * Returns JSON: today/tomorrow calendar events, meals, to-dos,
 * shopping list, countdowns, message, pack reminder, photo IDs.
 */

// ---------- CONFIG (edit these) ----------
const CONFIG = {
  // One entry per calendar you want on the fridge. Colour = person dot.
  // 'primary' = your main Google Calendar. For others use the Calendar ID
  // (Google Calendar → Settings → the calendar → "Integrate calendar").
  CALENDARS: [
    { id: 'primary', color: '#F2A65A' },          // You
    // { id: 'xxxx@group.calendar.google.com', color: '#7FB3FF' }, // Kids
    // { id: 'yyyy@gmail.com',                 color: '#8FD3B6' }, // Spouse
    // { id: 'zzzz@group.calendar.google.com', color: '#E8E2D6' }, // Family
  ],

  // Google Drive folder ID for photo mode (the part after /folders/ in its URL).
  // Leave '' to skip photos. Folder must be shared "Anyone with the link: Viewer".
  PHOTO_FOLDER_ID: '',

  MAX_PHOTOS: 300,
  CACHE_SECONDS: 300,   // dashboard polls every 10 min; 5 min cache keeps quota tiny
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
    generatedAt: now.getTime(),
    today: events_(today, tomorrow, tz),
    tomorrow: events_(tomorrow, dayAfter, tz),
    meals: {
      today: mealFor_(ss, today, tz),
      tomorrow: mealFor_(ss, tomorrow, tz),
    },
    todos: listItems_(ss, 'todo'),
    shopping: listItems_(ss, 'buy'),
    countdowns: countdowns_(ss, today),
    message: setting_(ss, 'message'),
    pack: setting_(ss, 'pack'),
    photos: photos_(),
  };
}

// ---------- Calendar ----------
function events_(start, end, tz) {
  const out = [];
  CONFIG.CALENDARS.forEach(function (c) {
    const cal = c.id === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(c.id);
    if (!cal) return;
    cal.getEvents(start, end).forEach(function (ev) {
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
  const day = Utilities.formatDate(date, tz, 'EEE').toLowerCase(); // mon, tue…
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
function photos_() {
  if (!CONFIG.PHOTO_FOLDER_ID) return [];
  const it = DriveApp.getFolderById(CONFIG.PHOTO_FOLDER_ID).getFiles();
  const ids = [];
  while (it.hasNext() && ids.length < CONFIG.MAX_PHOTOS) {
    const f = it.next();
    if (f.getMimeType().indexOf('image/') === 0) ids.push(f.getId());
  }
  return ids;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- One-time setup ----------
/** Run once from the editor. Builds the tabs, creates your secret key, logs it. */
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
    ['Water plants', 'todo', false],
    ['Curd', 'buy', false],
    ['Bananas', 'buy', false],
  ]);
  const lists = ss.getSheetByName('Lists');
  lists.getRange('C2:C200').insertCheckboxes();
  lists.getRange('B2:B200').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['todo', 'buy'], true).build()
  );

  const inTwoWeeks = new Date(Date.now() + 14 * 86400000);
  makeTab_(ss, 'Countdowns', ['Event', 'Date'], [['Unit test', inTwoWeeks]]);
  ss.getSheetByName('Countdowns').getRange('B2:B200').setNumberFormat('d mmm yyyy');

  makeTab_(ss, 'Settings', ['Key', 'Value'], [
    ['message', 'Proud of you, champ!'],
    ['pack', 'Hall ticket, umbrella'],
  ]);

  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);

  Logger.log('Setup done.');
  Logger.log('YOUR KEY: ' + props.getProperty('DASH_KEY'));
  Logger.log('Next: Deploy → New deployment → Web app (Execute as: Me, Access: Anyone).');
}

function makeTab_(ss, name, header, sample) {
  let sh = ss.getSheetByName(name);
  if (sh) return; // never overwrite your data
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (sample.length) sh.getRange(2, 1, sample.length, header.length).setValues(sample);
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
}

/** Run from the editor to see exactly what the dashboard will receive. */
function test() {
  Logger.log(JSON.stringify(build_(), null, 2));
}

/** Prints the key again if you lose it. */
function showKey() {
  Logger.log(PropertiesService.getScriptProperties().getProperty('DASH_KEY'));
}

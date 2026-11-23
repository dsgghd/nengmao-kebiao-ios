/* 课程表 · 测试版 */
(function () {
  'use strict';

  var STORAGE = {
    settings: 'tt.settings.v1',
    data: 'tt.data.v1',
    presets: 'tt.presets.v1',
    notes: 'tt.notes.v1',
    schools: 'tt.schools.v1'
  };

  var APK_FILE = 'nengmao-kebiao.apk';
  var APK_VERSION = '6.0.1';
  var APK_SIZE = '899 KB';
  var UA = navigator.userAgent;
  var IS_ANDROID_APP = !!(window.AndroidBridge && window.AndroidBridge.startAutoImport);
  var IS_WECHAT = /MicroMessenger/i.test(UA);
  var IS_IOS = /iPhone|iPad|iPod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  var PRESETS = [
    {
      id: 'demo-2026-1',
      school: '示例大学',
      semester: '2026-2027学年第一学期',
      week1: '2026-08-31',
      maxWeek: 20,
      note: '按课表周次与校历推算'
    },
    {
      id: 'generic-2026-1',
      school: '通用',
      semester: '2026-2027学年第一学期',
      week1: '2026-08-31',
      maxWeek: 20,
      note: '通用参考日期'
    }
  ];

  var DEFAULT_PERIODS = [
    ['08:00', '08:45'], ['08:55', '09:40'], ['10:00', '10:45'], ['10:55', '11:40'],
    ['14:00', '14:45'], ['14:55', '15:40'], ['16:00', '16:45'], ['16:55', '17:40'],
    ['19:00', '19:45'], ['19:55', '20:40'], ['20:50', '21:35']
  ];

  var COLORS = ['#1F6F5C', '#B07A24', '#2E4F7A', '#7A4A2B', '#6B5B7A', '#3E6B34', '#8A5A44', '#4A5B6B'];
  var WEEK_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  var state = {
    data: null,
    settings: null,
    notes: {},
    week: 1,
    day: 1,
    view: 'today'
  };

  var toastTimer = null;
  var swipeGuardUntil = 0;

  function $(sel) {
    return document.querySelector(sel);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      toast('保存失败：浏览器存储空间不足', true);
      return false;
    }
  }

  var REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60];

  function defaultSettings() {
    return {
      school: '示例大学',
      semester: '2026-2027学年第一学期',
      week1: '2026-08-31',
      maxWeek: 20,
      periods: DEFAULT_PERIODS.map(function (p) { return { start: p[0], end: p[1] }; }),
      student: { name: '', id: '', className: '' },
      reminderDefault: 15,
      sync: { enabled: true, weekday: 1, time: '07:00', keepAlive: true, lastAt: '', lastOk: '', lastNote: '' },
      autoImport: null
    };
  }

  function loadNotes() {
    var n = readJSON(STORAGE.notes);
    return n && typeof n === 'object' ? n : {};
  }

  function saveNotes() {
    writeJSON(STORAGE.notes, state.notes);
  }

  function getNote(id) {
    return state.notes[id] || null;
  }

  function noteLead(rec) {
    var n = getNote(rec.id);
    if (n && n.remindMinutes !== null && n.remindMinutes !== undefined) {
      return parseInt(n.remindMinutes, 10) || 0;
    }
    return parseInt(state.settings.reminderDefault, 10) || 0;
  }

  function setNote(id, text, remindMinutes) {
    var cleaned = String(text || '').trim().slice(0, 1000);
    var isDefault = remindMinutes === null || remindMinutes === undefined;
    if (!cleaned && isDefault) {
      delete state.notes[id];
    } else {
      state.notes[id] = {
        text: cleaned,
        remindMinutes: isDefault ? null : parseInt(remindMinutes, 10) || 0,
        updatedAt: new Date().toISOString()
      };
    }
    saveNotes();
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function parseISODate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 12, 0, 0, 0);
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  }

  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  function daysBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function todayWeekday() {
    var d = new Date().getDay();
    return d === 0 ? 7 : d;
  }

  function dateForWeekDay(week, day) {
    var w1 = parseISODate(state.settings.week1) || new Date();
    return addDays(w1, (week - 1) * 7 + (day - 1));
  }

  function getCurrentWeek() {
    if (!state.settings || !state.settings.week1) return 1;
    var w1 = parseISODate(state.settings.week1);
    if (!w1) return 1;
    var w = Math.floor(daysBetween(w1, new Date()) / 7) + 1;
    return clamp(w, 1, state.settings.maxWeek || 20);
  }

  function fmtShort(d) {
    return (d.getMonth() + 1) + '.' + pad2(d.getDate());
  }

  function fmtLong(d) {
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function periodStart(n) {
    var p = state.settings.periods[n - 1];
    return p ? p.start : '';
  }

  function periodEnd(n) {
    var p = state.settings.periods[n - 1];
    return p ? p.end : '';
  }

  function combine(date, hhmm) {
    if (!hhmm) return null;
    var parts = String(hhmm).split(':');
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0);
  }

  function minutesUntil(target, from) {
    return Math.max(0, Math.ceil((target.getTime() - from.getTime()) / 60000));
  }

  function courseKey(rec) {
    if (rec.code) return 'c:' + rec.code;
    return 'n:' + (rec.name || '') + '|' + (rec.teacher || '');
  }

  function courseColor(key) {
    var h = 0;
    for (var i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
    return COLORS[Math.abs(h) % COLORS.length];
  }

  function hexToHsl(hex) {
    var r = parseInt(hex.slice(1, 3), 16) / 255;
    var g = parseInt(hex.slice(3, 5), 16) / 255;
    var b = parseInt(hex.slice(5, 7), 16) / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    var l = (max + min) / 2;
    var s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    ];
  }

  function pickText(h, s, l) {
    var rgb = hslToRgb(h, s, l);
    function ch(v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    var lum = 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
    return lum > 0.35 ? '#141414' : '#FFFFFF';
  }

  function courseHsl(rec) {
    if (rec.kind === 'practice') return { h: 0, s: 0 };
    return hexToHsl(courseColor(courseKey(rec)));
  }

  function computeNextOccurrence() {
    if (!state.data) return null;
    var now = new Date();
    var currentWeek = getCurrentWeek();
    var max = state.settings.maxWeek || 20;
    var endWeek = Math.min(max, currentWeek + 6);
    var best = null;

    function consider(rec) {
      if (rec.day == null || !rec.startPeriod) return;
      for (var w = currentWeek; w <= endWeek; w++) {
        if (rec.weeks && rec.weeks.length && rec.weeks.indexOf(w) < 0) continue;
        var adj = adjustmentFor(rec.id, w);
        if (adj && adj.cancel) continue;
        var day = adj ? adj.day : rec.day;
        var startPeriod = adj ? adj.period : rec.startPeriod;
        var date = dateForWeekDay(w, day);
        var start = combine(date, periodStart(startPeriod));
        if (!start || start <= now) continue;
        if (!best || start < best.start) {
          best = { id: rec.id, week: w, start: start };
        }
      }
    }

    (state.data.blocks || []).forEach(consider);
    (state.data.practice || []).forEach(function (p) {
      if (!p.allWeek) consider(p);
    });
    return best;
  }

  function temporalInfo(rec, week, nextOcc, hasCurrent) {
    var date = dateForWeekDay(week, rec.day);
    var start = combine(date, periodStart(rec.startPeriod));
    var end = combine(date, periodEnd(rec.endPeriod));
    var now = new Date();
    var base = courseHsl(rec);
    var info = { state: 'later', bg: 'hsl(' + base.h + ', 28%, 72%)', fg: '#141414', tag: '', tagShort: '' };

    if (!start || !end) return info;

    if (now >= start && now < end) {
      info.state = 'now';
      info.bg = '#E03A2F';
      info.fg = '#FFFFFF';
      info.tag = '还剩 ' + minutesUntil(end, now) + ' 分';
      info.tagShort = '正在上课';
      return info;
    }

    if (now >= end) {
      info.state = 'done';
      info.bg = 'hsl(' + base.h + ', 8%, 84%)';
      info.fg = '#3A3732';
      return info;
    }

    var isNext = !hasCurrent && nextOcc && nextOcc.id === rec.id && nextOcc.week === week &&
      Math.abs(nextOcc.start.getTime() - start.getTime()) < 60000;
    if (isNext) {
      info.state = 'next';
      info.bg = '#E03A2F';
      info.fg = '#FFFFFF';
      info.tag = '下一节 · ' + periodStart(rec.startPeriod);
      info.tagShort = '下一节';
      return info;
    }

    var hours = (start.getTime() - now.getTime()) / 3600000;
    if (hours <= 36) {
      info.state = 'soon';
      info.bg = 'hsl(' + base.h + ', 42%, 60%)';
      info.fg = pickText(base.h, 42, 60);
    } else if (hours <= 120) {
      info.state = 'later';
      info.bg = 'hsl(' + base.h + ', 28%, 72%)';
      info.fg = '#141414';
    } else {
      info.state = 'far';
      info.bg = 'hsl(' + base.h + ', 18%, 80%)';
      info.fg = '#141414';
    }
    return info;
  }

  function buildReminders() {
    if (!state.data) return [];
    var now = new Date();
    var limit = now.getTime() + 30 * 86400000;
    var currentWeek = getCurrentWeek();
    var maxWeek = state.settings.maxWeek || 20;
    var out = [];

    function add(rec) {
      if (rec.day == null || !rec.startPeriod) return;
      var lead = noteLead(rec);
      if (lead <= 0) return;
      var weeks = rec.weeks && rec.weeks.length ? rec.weeks : rangeWeeks(currentWeek, maxWeek);
      weeks.forEach(function (w) {
        if (w < currentWeek) return;
        var adj = adjustmentFor(rec.id, w);
        if (adj && adj.cancel) return;
        var day = adj ? adj.day : rec.day;
        var startPeriod = adj ? adj.period : rec.startPeriod;
        var start = combine(dateForWeekDay(w, day), periodStart(startPeriod));
        if (!start || start <= now) return;
        var at = start.getTime() - lead * 60000;
        if (at <= now.getTime() || at > limit) return;
        var note = getNote(rec.id);
        var place = [rec.room, rec.campus].filter(Boolean).join(' ');
        var leadLabel = lead >= 60 ? Math.round(lead / 60) + ' 小时' : lead + ' 分钟';
        var body = leadLabel + '后上课';
        if (adj) body += '（本周调课）';
        if (place) body += ' · ' + place;
        if (note && note.text) body += ' · ' + note.text;
        out.push({
          id: rec.id + '-' + w,
          at: at,
          title: '能猫课表 · ' + rec.name,
          body: body
        });
      });
    }

    (state.data.blocks || []).forEach(add);
    (state.data.practice || []).forEach(function (p) {
      if (!p.allWeek) add(p);
    });
    return out;
  }

  function syncPhoneReminders() {
    if (!state.data) return;
    if (window.AndroidBridge && typeof window.AndroidBridge.syncReminders === 'function') {
      try {
        window.AndroidBridge.syncReminders(JSON.stringify(buildReminders()));
      } catch (e) {}
    }
  }

  function formatWeeks(weeks) {
    if (!weeks || !weeks.length) return '周次未知';
    var uniq = [];
    weeks.forEach(function (w) { if (uniq.indexOf(w) < 0) uniq.push(w); });
    uniq.sort(function (a, b) { return a - b; });
    var parts = [];
    var start = uniq[0];
    var prev = uniq[0];
    for (var i = 1; i <= uniq.length; i++) {
      var w = uniq[i];
      if (w === prev + 1) { prev = w; continue; }
      parts.push(start === prev ? String(start) : start + '–' + prev);
      start = prev = w;
    }
    return '第 ' + parts.join('、') + ' 周';
  }

  function weekUnion(records) {
    var seen = {};
    records.forEach(function (r) {
      (r.weeks || []).forEach(function (w) { seen[w] = true; });
    });
    return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
  }

  /* ---------------- boot ---------------- */

  function init() {
    var params = new URLSearchParams(location.search);
    var demoParam = params.get('demo') === '1';
    var viewParam = params.get('view');

    var saved = readJSON(STORAGE.settings);
    state.settings = Object.assign(defaultSettings(), saved || {});
    if (!Array.isArray(state.settings.periods) || !state.settings.periods.length) {
      state.settings.periods = defaultSettings().periods;
    }
    state.settings.student = Object.assign({ name: '', id: '', className: '' }, state.settings.student || {});
    state.settings.maxWeek = clamp(parseInt(state.settings.maxWeek, 10) || 20, 1, 30);
    var reminderDefault = parseInt(state.settings.reminderDefault, 10);
    state.settings.reminderDefault = REMINDER_OPTIONS.indexOf(reminderDefault) >= 0 ? reminderDefault : 15;
    state.settings.sync = Object.assign(
      { enabled: true, weekday: 1, time: '07:00', keepAlive: true, lastAt: '', lastOk: '', lastNote: '' },
      state.settings.sync || {}
    );
    state.settings.autoImport = state.settings.autoImport || null;

    state.notes = loadNotes();
    state.data = readJSON(STORAGE.data);
    // 老版本把示例课表写进了本机缓存；载入时统一归一成公开的示例身份，不保留任何旧值
    (function tidyDemoIdentity() {
      var d = state.data, st = state.settings, dirty = false;
      if (d && d.meta && d.meta.fileName === '示例课表') {
        if (d.meta.className && d.meta.className !== '默认班级') { d.meta.className = '默认班级'; dirty = true; }
        if (d.meta.studentName && d.meta.studentName !== '示例同学') { d.meta.studentName = '示例同学'; dirty = true; }
      }
      if (st && st.student && st.student.className && st.student.className !== '默认班级'
          && d && d.meta && d.meta.fileName === '示例课表') {
        st.student.className = '默认班级'; dirty = true;
      }
      // 设置里可能残留旧版本的默认学校：没导入过真实课表时统一归一
      if (st && !st.schema) {
        var untouched = !d || !d.blocks || !d.blocks.length || (d.meta && d.meta.fileName === '示例课表');
        if (untouched) {
          if (st.school && st.school !== '示例大学' && st.school !== '通用') { st.school = '示例大学'; dirty = true; }
          if (st.student && st.student.name && st.student.name !== '示例同学') { st.student.name = '示例同学'; dirty = true; }
        }
        st.schema = 1; dirty = true;
      }
      if (dirty) { writeJSON(STORAGE.data, d); writeJSON(STORAGE.settings, st); }
    })();

    state.week = getCurrentWeek();
    state.day = todayWeekday();
    state.view = 'today';

    bindGlobal();

    setInterval(function () {
      if (state.data && state.view !== 'courses' && !viewTransition && !dayAnimTimer && !weekBusy && !weekGesture) renderView();
    }, 60000);

    if (demoParam && (!state.data || !state.data.blocks || !state.data.blocks.length)) {
      loadDemo();
      if (isView(viewParam)) setView(viewParam);
      return;
    }

    if (state.data && state.data.blocks && state.data.blocks.length) {
      showApp();
      renderAll();
      syncPhoneReminders();
      if (isView(viewParam)) setView(viewParam);
    } else {
      showWelcome();
    }

    if (IS_ANDROID_APP) {
      scheduleNativeSync();
      maybeAutoSync();
    }

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  function maybeAutoSync() {
    if (!state.data || !state.data.blocks || !state.data.blocks.length) return;
    var cfg = state.settings.sync;
    if (!cfg || !cfg.enabled) return;
    if (!state.settings.autoImport) return;
    if (!syncOverdue()) return;
    var attempt = cfg.lastAttempt ? new Date(cfg.lastAttempt) : null;
    if (attempt && Date.now() - attempt.getTime() < 20 * 3600000) return;
    setTimeout(function () { startSync('sync'); }, 1500);
  }

  function isView(v) {
    return v === 'today' || v === 'week' || v === 'courses';
  }

  function showWelcome() {
    $('#app').hidden = true;
    $('#welcome').hidden = false;
  }

  function showApp() {
    $('#welcome').hidden = true;
    $('#app').hidden = false;
  }

  function bindGlobal() {
    $('#welcomeImport').addEventListener('click', function (e) { showImportStart(e.currentTarget); });
    $('#welcomeDemo').addEventListener('click', loadDemo);
    $('#welcomeRestore').addEventListener('click', function () { restoreJSONFile(); });
    $('#importBtn').addEventListener('click', function (e) { showImportStart(e.currentTarget); });
    $('#settingsBtn').addEventListener('click', function (e) { openSettings(e.currentTarget); });

    $('#fileInput').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) handleFile(file);
      e.target.value = '';
    });

    $('#prevWeek').addEventListener('click', function () { setWeek(state.week - 1); });
    $('#nextWeek').addEventListener('click', function () { setWeek(state.week + 1); });

    $('#weekChips').addEventListener('click', function (e) {
      var btn = e.target.closest('.week-chip');
      if (btn) setWeek(parseInt(btn.dataset.week, 10));
    });

    $('#weekInfo').addEventListener('click', function (e) {
      var syncChip = e.target.closest('#syncOpen');
      if (syncChip) {
        openSettings(syncChip);
        return;
      }
      if (e.target.closest('#backThisWeek')) {
        state.week = getCurrentWeek();
        state.day = todayWeekday();
        renderAll();
      }
    });

    $('#tabbar').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-view]');
      if (btn) setView(btn.dataset.view, true);
    });

    $('#todayView').addEventListener('click', function (e) {
      var dayBtn = e.target.closest('.day-tab');
      if (dayBtn) {
        animateDaySwitch(parseInt(dayBtn.dataset.day, 10));
        return;
      }
      var block = e.target.closest('[data-block]');
      if (block) openBlockDetail(block.dataset.block, block);
    });

    $('#weekView').addEventListener('click', function (e) {
      var undo = e.target.closest('[data-undo-adj]');
      if (undo) {
        clearAdjustment(undo.dataset.undoAdj, state.week);
        renderAll();
        syncPhoneReminders();
        toast('已恢复本周原课表');
        return;
      }
      var block = e.target.closest('[data-block]');
      if (block) openBlockDetail(block.dataset.block, block);
    });

    $('#coursesView').addEventListener('click', function (e) {
      var card = e.target.closest('[data-course]');
      if (card) openCourse(card.dataset.course, card);
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      document.addEventListener(ev, function (e) { e.preventDefault(); });
    });
    document.addEventListener('click', function (e) {
      var copy = e.target.closest && e.target.closest('[data-apk-copy]');
      if (copy) {
        e.preventDefault();
        copyApkLink();
      }
    });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    window.addEventListener('resize', function () {
      if (state.view === 'week') measureWeekGap();
    });

    bindSwipeNav();
    bindWeekCarousel();
  }

  function bindSwipeNav() {
    var swipe = null;

    document.addEventListener('touchstart', function (e) {
      swipe = null;
      if (state.view !== 'today' || !state.data || e.touches.length !== 1) return;
      var target = e.target;
      if (!target || !target.closest) return;
      if (!target.closest('#app') || target.closest('.weekbar') || target.closest('#tabbar')) return;
      if (document.body.style.overflow === 'hidden') return;
      var p = e.touches[0];
      swipe = { x: p.clientX, y: p.clientY, time: Date.now() };
    }, { passive: true });

    document.addEventListener('click', function (e) {
      if (Date.now() >= swipeGuardUntil) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    document.addEventListener('touchmove', function (e) {
      if (swipe && e.touches.length !== 1) swipe = null;
    }, { passive: true });

    document.addEventListener('touchend', function (e) {
      if (!swipe) return;
      var start = swipe;
      swipe = null;
      var p = e.changedTouches && e.changedTouches[0];
      if (!p) return;
      var dx = p.clientX - start.x;
      var dy = p.clientY - start.y;
      if (Date.now() - start.time > 650) return;
      if (Math.abs(dx) < 46 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      swipeGuardUntil = Date.now() + 420;
      switchToday(dx < 0 ? 1 : -1);
    }, { passive: true });

    document.addEventListener('touchcancel', function () { swipe = null; }, { passive: true });
  }

  function resetWeekCarousel() {
    if (weekSnapTimer) { clearTimeout(weekSnapTimer); weekSnapTimer = null; }
    weekSnapTarget = null;
    weekBusy = false;
    weekGesture = null;
    var view = document.getElementById('weekView');
    if (view) view.classList.remove('is-week-dragging');
    if (weekViewportEl && weekTrackEl) {
      weekTrackWidth = weekViewportEl.clientWidth;
      weekTrackEl.style.transition = 'none';
      weekTrackEl.style.transform = 'translate3d(-' + weekTrackWidth + 'px,0,0)';
    }
  }

  function bindWeekCarousel() {
    var view = document.getElementById('weekView');
    if (!view) return;

    function rebaseWeekPanels(dir) {
      if (!weekTrackEl) return;
      var max = state.settings.maxWeek || 20;
      if (dir > 0) {
        var first = weekTrackEl.firstElementChild;
        if (first) weekTrackEl.removeChild(first);
        var nextWeek = state.week + 1;
        weekTrackEl.insertAdjacentHTML('beforeend', nextWeek <= max ? weekPanelHTML(nextWeek) : edgeWeekPanel('已经是最后一周'));
      } else {
        var last = weekTrackEl.lastElementChild;
        if (last) weekTrackEl.removeChild(last);
        var prevWeek = state.week - 1;
        weekTrackEl.insertAdjacentHTML('afterbegin', prevWeek >= 1 ? weekPanelHTML(prevWeek) : edgeWeekPanel('已经是第一周'));
      }
      weekTrackWidth = weekViewportEl ? weekViewportEl.clientWidth : weekTrackWidth;
      weekTrackEl.style.transition = 'none';
      weekTrackEl.style.transform = 'translate3d(-' + weekTrackWidth + 'px,0,0)';
      measureWeekGap();
    }

    function finishWeekSnap() {
      if (!weekSnapTarget) { weekBusy = false; return; }
      var snap = weekSnapTarget;
      weekSnapTarget = null;
      if (weekSnapTimer) { clearTimeout(weekSnapTimer); weekSnapTimer = null; }
      if (weekTrackEl) {
        var endX = -weekTrackWidth + (snap.dir > 0 ? -weekTrackWidth : weekTrackWidth);
        weekTrackEl.style.transition = 'none';
        weekTrackEl.style.transform = 'translate3d(' + endX + 'px,0,0)';
      }
      rebaseWeekPanels(snap.dir);
      weekBusy = false;
    }

    view.addEventListener('pointerdown', function (e) {
      if (state.view !== 'week' || !state.data || !state.settings) return;
      if (weekGesture || document.body.style.overflow === 'hidden') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (weekBusy) {
        if (weekSnapTarget) {
          finishWeekSnap();
        } else {
          if (weekSnapTimer) { clearTimeout(weekSnapTimer); weekSnapTimer = null; }
          if (weekTrackEl) {
            weekTrackEl.style.transition = 'none';
            weekTrackEl.style.transform = 'translate3d(-' + weekTrackWidth + 'px,0,0)';
          }
          weekBusy = false;
        }
      }
      var vp = view.querySelector('.week-viewport');
      var tr = view.querySelector('.week-track');
      if (!vp || !tr) return;
      var wrap = e.target && e.target.closest ? e.target.closest('.grid-wrap') : null;
      if (wrap && wrap.scrollWidth > wrap.clientWidth + 1) return;
      weekViewportEl = vp;
      weekTrackEl = tr;
      weekTrackWidth = vp.clientWidth || weekTrackWidth;
      weekGesture = {
        id: e.pointerId, x: e.clientX, y: e.clientY,
        lastX: e.clientX, lastT: performance.now(), vx: 0,
        dx: 0, rawDx: 0, horizontal: false, captured: false
      };
      tr.style.transition = 'none';
    });

    view.addEventListener('pointermove', function (e) {
      var g = weekGesture;
      if (!g || e.pointerId !== g.id) return;
      var dx = e.clientX - g.x;
      var dy = e.clientY - g.y;
      var now = performance.now();
      var dt = Math.max(1, now - g.lastT);
      g.vx = (e.clientX - g.lastX) / dt;
      g.lastX = e.clientX;
      g.lastT = now;
      g.rawDx = dx;
      if (!g.horizontal) {
        if (Math.abs(dx) > 7 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          g.horizontal = true;
          view.classList.add('is-week-dragging');
          try { view.setPointerCapture(e.pointerId); g.captured = true; } catch (err) {}
          weekTrackEl.style.transition = 'none';
        } else {
          return;
        }
      }
      e.preventDefault();
      var move = dx;
      var max = state.settings.maxWeek || 20;
      if ((dx > 0 && state.week <= 1) || (dx < 0 && state.week >= max)) move *= .3;
      g.dx = move;
      weekTrackEl.style.transform = 'translate3d(' + (-weekTrackWidth + move) + 'px,0,0)';
    });

    function finish(e, cancel) {
      var g = weekGesture;
      if (!g || (e && e.pointerId !== g.id)) return;
      weekGesture = null;
      view.classList.remove('is-week-dragging');
      if (g.captured && e) {
        try { view.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      if (!g.horizontal) return;
      if (!cancel) {
        swipeGuardUntil = Date.now() + 420;
        var max = state.settings.maxWeek || 20;
        var target = state.week + (g.rawDx < 0 ? 1 : -1);
        var far = Math.abs(g.rawDx) > weekTrackWidth * .18;
        var fast = Math.abs(g.vx) > .45 && Math.abs(g.rawDx) > 18;
        if ((far || fast) && Math.abs(g.rawDx) > 6 && target >= 1 && target <= max) {
          weekBusy = true;
          weekSnapTarget = { dir: g.rawDx < 0 ? 1 : -1, week: target };
          state.week = target;
          renderHeader();
          renderWeekbar();
          renderWeekInfo();
          var targetX = -weekTrackWidth + (g.rawDx < 0 ? -weekTrackWidth : weekTrackWidth);
          weekTrackEl.style.transition = 'transform 300ms cubic-bezier(.22,1,.36,1)';
          weekTrackEl.style.transform = 'translate3d(' + targetX + 'px,0,0)';
          weekSnapTimer = setTimeout(finishWeekSnap, 310);
          return;
        }
      }
      weekBusy = true;
      weekSnapTarget = null;
      weekTrackEl.style.transition = 'transform 280ms cubic-bezier(.22,1,.36,1)';
      weekTrackEl.style.transform = 'translate3d(' + (-weekTrackWidth) + 'px,0,0)';
      weekSnapTimer = setTimeout(function () {
        weekSnapTimer = null;
        weekBusy = false;
      }, 290);
    }

    view.addEventListener('pointerup', function (e) { finish(e, false); });
    view.addEventListener('pointercancel', function (e) { finish(e, true); });
  }

  function setWeek(w) {
    resetWeekCarousel();
    clearViewTransition();
    clearDayAnimation();
    state.week = clamp(w, 1, state.settings.maxWeek || 20);
    renderAll();
  }

  var VIEW_ORDER = { today: 0, week: 1, courses: 2 };
  var VIEW_SWITCH_MS = 500;
  var PAGE_THEME = {
    today: { accent: '#D33228', ink: '#FFFFFF', wash: '#F6E0DA' },
    week: { accent: '#C9912B', ink: '#141414', wash: '#F2E4C4' },
    courses: { accent: '#1F6F5C', ink: '#FFFFFF', wash: '#DFECE5' }
  };
  var viewTransition = null;
  var dayAnimTimer = null;
  var weekViewportEl = null;
  var weekTrackEl = null;
  var weekTrackWidth = 0;
  var weekGesture = null;
  var weekSnapTimer = null;
  var weekSnapTarget = null;
  var weekBusy = false;
  var weekbarMax = 0;
  var weekbarReady = false;
  var indicatorWeek = null;

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function clearDayAnimation() {
    if (dayAnimTimer) { clearTimeout(dayAnimTimer); dayAnimTimer = null; }
    var today = document.getElementById('todayView');
    if (!today) return;
    today.classList.remove('is-day-entering');
    Array.prototype.forEach.call(today.querySelectorAll('.day-anim'), function (el) {
      el.classList.remove('day-anim');
      el.style.removeProperty('--i');
    });
    Array.prototype.forEach.call(today.querySelectorAll('.day-tab.is-day-chip-enter'), function (el) {
      el.classList.remove('is-day-chip-enter');
    });
  }

  function clearViewTransition() {
    if (!viewTransition) return;
    if (viewTransition.timer) clearTimeout(viewTransition.timer);
    if (viewTransition.layer && viewTransition.layer.parentNode) {
      viewTransition.layer.parentNode.removeChild(viewTransition.layer);
    }
    if (viewTransition.entering) {
      viewTransition.entering.classList.remove('is-entering', 'is-day-entering', 'is-dir-next', 'is-dir-prev');
      Array.prototype.forEach.call(viewTransition.entering.children, function (child) {
        child.style.removeProperty('--i');
      });
    }
    var app = $('#app');
    if (app) app.classList.remove('is-switching');
    viewTransition = null;
  }

  function animateSwap(oldEl, nextEl, render, dir, duration) {
    var main = document.querySelector('.main');
    if (!oldEl || !nextEl || !main) {
      render();
      return;
    }

    clearViewTransition();

    var rect = oldEl.getBoundingClientRect();
    var mainRect = main.getBoundingClientRect();

    var dirClass = dir > 0 ? 'is-dir-next' : 'is-dir-prev';
    var layer = document.createElement('div');
    layer.className = 'tt-leave-layer ' + dirClass;
    layer.setAttribute('aria-hidden', 'true');
    layer.inert = true;
    layer.style.left = (rect.left - mainRect.left) + 'px';
    layer.style.top = (rect.top - mainRect.top) + 'px';
    layer.style.width = rect.width + 'px';
    layer.style.height = rect.height + 'px';
    layer.style.setProperty('--dir', String(dir));

    var ghost = oldEl.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.removeAttribute('hidden');
    layer.appendChild(ghost);
    main.appendChild(layer);

    render();

    nextEl.style.setProperty('--dir', String(dir));
    nextEl.classList.add('is-entering', dirClass);
    Array.prototype.forEach.call(nextEl.children, function (child, i) {
      child.style.setProperty('--i', String(Math.min(i, 3)));
    });
    $('#app').classList.add('is-switching');

    viewTransition = { layer: layer, entering: nextEl, timer: null };
    viewTransition.timer = setTimeout(clearViewTransition, duration);
  }

  function animateViewSwitch(next) {
    var oldName = state.view;
    var oldEl = document.getElementById(oldName + 'View');
    var nextEl = document.getElementById(next + 'View');
    if (!oldEl || !nextEl) {
      state.view = next;
      renderView();
      return;
    }
    clearDayAnimation();
    animateSwap(oldEl, nextEl, function () {
      state.view = next;
      renderView();
    }, VIEW_ORDER[next] > VIEW_ORDER[oldName] ? 1 : -1, VIEW_SWITCH_MS);
  }

  function animateTodayChange(week, day, dir, crossWeek) {
    var todayEl = document.getElementById('todayView');
    if (!todayEl || state.view !== 'today' || prefersReducedMotion()) {
      clearViewTransition();
      clearDayAnimation();
      state.week = week;
      state.day = day;
      if (crossWeek) renderAll();
      else renderToday();
      return;
    }
    clearDayAnimation();
    animateSwap(todayEl, todayEl, function () {
      state.week = week;
      state.day = day;
      if (crossWeek) renderAll();
      else renderToday();
    }, dir, VIEW_SWITCH_MS);
  }

  function decorateDayTransition(today, strip) {
    var els = [];
    var nodes = today.querySelectorAll('.week-practice, .day-summary, .timeline > .class-card, .empty');
    Array.prototype.forEach.call(nodes, function (el) { els.push(el); });
    els.forEach(function (el, i) {
      el.classList.add('day-anim');
      el.style.setProperty('--i', String(Math.min(i + 1, 6)));
    });
    today.classList.add('is-day-entering');
    var chip = (strip && strip.querySelector('.day-tab.active')) ||
      today.querySelector('.day-strip .day-tab.active');
    if (chip) chip.classList.add('is-day-chip-enter');
    dayAnimTimer = setTimeout(function () {
      today.classList.remove('is-day-entering');
      els.forEach(function (el) {
        el.classList.remove('day-anim');
        el.style.removeProperty('--i');
      });
      if (chip) chip.classList.remove('is-day-chip-enter');
      dayAnimTimer = null;
    }, 480);
  }

  function animateDaySwitch(nextDay) {
    if (!(nextDay >= 1 && nextDay <= 7) || nextDay === state.day) return;
    var todayEl = document.getElementById('todayView');
    if (!todayEl || state.view !== 'today') {
      state.day = nextDay;
      renderToday();
      return;
    }
    clearViewTransition();
    clearDayAnimation();
    if (prefersReducedMotion()) {
      state.day = nextDay;
      renderToday();
      return;
    }
    var strip = todayEl.querySelector('.day-strip');
    if (strip) {
      Array.prototype.forEach.call(strip.querySelectorAll('.day-tab'), function (btn) {
        btn.classList.toggle('active', parseInt(btn.dataset.day, 10) === nextDay);
      });
    }
    state.day = nextDay;
    renderToday();
    var newStrip = todayEl.querySelector('.day-strip');
    if (strip && newStrip && strip !== newStrip) newStrip.replaceWith(strip);
    decorateDayTransition(todayEl, strip);
  }

  function switchToday(delta) {
    if (state.view !== 'today' || !state.data || !state.settings) return;
    var w1 = parseISODate(state.settings.week1);
    if (!w1) return;
    var target = addDays(dateForWeekDay(state.week, state.day), delta);
    var diff = daysBetween(w1, target);
    var newWeek = Math.floor(diff / 7) + 1;
    var newDay = (diff % 7) + 1;
    var max = state.settings.maxWeek || 20;
    if (newWeek < 1 || newWeek > max) return;

    animateTodayChange(newWeek, newDay, delta > 0 ? 1 : -1, newWeek !== state.week);
  }

  function setView(view, animate) {
    if (!isView(view)) return;
    resetWeekCarousel();
    if (view === state.view) {
      if (!viewTransition) renderView();
      return;
    }
    if (!animate || prefersReducedMotion()) {
      clearDayAnimation();
      clearViewTransition();
      state.view = view;
      renderView();
      return;
    }
    animateViewSwitch(view);
  }

  function renderAll() {
    if (!state.data) return;
    clearDayAnimation();
    renderHeader();
    renderWeekbar();
    renderWeekInfo();
    renderView();
  }

  function renderView() {
    var isCourses = state.view === 'courses';
    var wb = document.querySelector('.weekbar');
    var wi = document.querySelector('.weekinfo');
    var mainEl = document.querySelector('.main');
    var appEl = $('#app');
    var theme = PAGE_THEME[state.view] || PAGE_THEME.today;
    if (appEl) {
      appEl.style.setProperty('--page-accent', theme.accent);
      appEl.style.setProperty('--page-accent-ink', theme.ink);
      appEl.style.setProperty('--page-wash', theme.wash);
    }
    if (mainEl) mainEl.classList.toggle('week-overview', state.view === 'week');
    if (wb) {
      wb.classList.toggle('is-collapsed', isCourses);
      wb.inert = isCourses;
    }
    if (wi) {
      wi.classList.toggle('is-collapsed', isCourses);
      wi.inert = isCourses;
    }

    ['today', 'week', 'courses'].forEach(function (v) {
      var el = document.getElementById(v + 'View');
      if (el) el.hidden = v !== state.view;
    });
    document.querySelectorAll('#tabbar button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === state.view);
    });
    if (state.view === 'today') renderToday();
    else if (state.view === 'week') renderWeek();
    else renderCourses();
  }

  function renderHeader() {
    var s = state.settings;
    $('#semesterLabel').textContent = s.semester || '未设置学期';
    var w = state.week;
    var start = dateForWeekDay(w, 1);
    var end = dateForWeekDay(w, 7);
    var num = $('#headerWeekNum');
    var meta = $('#headerWeekMeta');
    if (num) num.textContent = pad2(w);
    if (meta) meta.textContent = '第 ' + w + ' 周 · ' + fmtShort(start) + ' – ' + fmtShort(end);
    var block = $('#headerWeekBlock');
    if (block) block.classList.toggle('is-current', w === getCurrentWeek());
  }

  function renderWeekbar() {
    var max = state.settings.maxWeek || 20;
    var current = getCurrentWeek();
    var practiceWeeks = {};
    (state.data.practice || []).forEach(function (p) {
      (p.weeks || []).forEach(function (w) { practiceWeeks[w] = true; });
    });

    var wrap = $('#weekChips');
    if (!wrap) return;
    var needBuild = weekbarMax !== max || !wrap.querySelector('.week-chip');
    if (needBuild) {
      var html = '<span class="week-indicator" aria-hidden="true"></span>';
      for (var w = 1; w <= max; w++) {
        html += '<button type="button" class="week-chip" data-week="' + w + '" role="tab"><span>' + w + '</span></button>';
      }
      wrap.innerHTML = html;
      weekbarMax = max;
      weekbarReady = false;
      indicatorWeek = null;
    }

    var chips = wrap.querySelectorAll('.week-chip');
    Array.prototype.forEach.call(chips, function (chip) {
      var w = parseInt(chip.dataset.week, 10);
      chip.classList.toggle('active', w === state.week);
      chip.classList.toggle('is-now', w === current);
      chip.classList.toggle('has-practice', !!practiceWeeks[w]);
      chip.setAttribute('aria-selected', w === state.week ? 'true' : 'false');
    });

    var active = wrap.querySelector('.week-chip.active');
    var indicator = wrap.querySelector('.week-indicator');
    if (!active || !indicator) return;

    if (!weekbarReady) indicator.classList.add('no-anim');
    indicator.style.width = active.offsetWidth + 'px';
    indicator.style.height = active.offsetHeight + 'px';
    indicator.style.top = active.offsetTop + 'px';
    indicator.style.transform = 'translate3d(' + active.offsetLeft + 'px,0,0)';

    if (!weekbarReady) {
      var center = active.offsetLeft - (wrap.clientWidth - active.offsetWidth) / 2;
      wrap.scrollTo({ left: Math.max(0, center), behavior: 'auto' });
      requestAnimationFrame(function () { indicator.classList.remove('no-anim'); });
      weekbarReady = true;
      indicatorWeek = state.week;
    } else if (indicatorWeek !== state.week) {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      indicatorWeek = state.week;
    }
  }

  function renderWeekInfo() {
    var w = state.week;
    var current = getCurrentWeek();
    var s = state.settings;
    var who = [s.student.name, s.student.className].filter(Boolean).join(' · ');
    var html = '<span class="wi-student">' + esc(who || '') + '</span>';
    html += '<span class="sep hide-mobile">/</span><span class="wi-first hide-mobile">第 1 周：' +
      esc(fmtShort(parseISODate(s.week1) || new Date())) + '</span>';
    if (w === current) {
      html += '<span class="sep">/</span><span class="wi-status">本周</span>';
    } else {
      html += '<span class="sep">/</span><span class="wi-status">非本周</span>' +
        '<button type="button" class="week-back" id="backThisWeek">回到本周</button>';
    }
    var cfg = state.settings.sync || {};
    if (state.data && state.data.blocks && state.data.blocks.length && cfg.enabled !== false) {
      var overdue = syncOverdue();
      var hint = !cfg.lastAt ? '还没同步过'
        : (overdue ? '距上次同步已超过一周' : '上次同步 ' + fmtSyncAt(cfg.lastAt));
      if (cfg.lastNote && cfg.lastOk === 'ok' && !overdue) hint += ' · ' + cfg.lastNote;
      html += '<span class="sep hide-mobile">/</span><span class="wi-sync hide-mobile' + (overdue ? ' is-due' : '') + '">' +
        esc(hint) + '</span>' +
        '<button type="button" class="wi-sync-short' + (overdue ? ' is-due' : '') + '" id="syncOpen">' + (overdue ? '待同步' : '已同步') + '</button>';
    }
    $('#weekInfo').innerHTML = html;
  }

  /* ---------------- data helpers ---------------- */

  function getDayBlocks(week, day) {
    var out = [];
    var weekBlocks = (state.data.blocks || []).filter(function (b) {
      return !b.weeks || !b.weeks.length || b.weeks.indexOf(week) >= 0;
    });
    applyWeekAdjustments(weekBlocks, week).forEach(function (b) {
      if (b.day !== day) return;
      out.push(Object.assign({}, b, { kind: 'course' }));
    });
    (state.data.practice || []).forEach(function (p) {
      if (p.allWeek || p.day !== day) return;
      if (!p.weeks || p.weeks.indexOf(week) < 0) return;
      out.push(Object.assign({}, p, { kind: 'practice' }));
    });
    out.sort(function (a, b) {
      return (a.startPeriod || 0) - (b.startPeriod || 0) || (a.endPeriod || 0) - (b.endPeriod || 0);
    });
    return out;
  }

  function allWeekPractice(week) {
    return (state.data.practice || []).filter(function (p) {
      return p.allWeek && p.weeks && p.weeks.indexOf(week) >= 0;
    });
  }

  /* ---------- 本周调课 ----------
     调课只作用于某一周，不改基础课表：
     { blockId, week, day, period, cancel }  —— cancel 为 true 表示这一周停课。 */

  function adjustmentList() {
    return (state.data && state.data.adjustments) || [];
  }

  function adjustmentFor(blockId, week) {
    var list = adjustmentList();
    for (var i = 0; i < list.length; i++) {
      if (list[i].blockId === blockId && list[i].week === week) return list[i];
    }
    return null;
  }

  function weekAdjustments(week) {
    return adjustmentList().filter(function (a) { return a.week === week; });
  }

  function findBlock(id) {
    return (state.data.blocks || []).find(function (b) { return b.id === id; }) || null;
  }

  function setAdjustment(blockId, week, next) {
    if (!state.data) return;
    var list = adjustmentList().slice().filter(function (a) {
      return !(a.blockId === blockId && a.week === week);
    });
    if (next) list.push(Object.assign({ blockId: blockId, week: week }, next));
    state.data.adjustments = list;
    writeJSON(STORAGE.data, state.data);
  }

  function clearAdjustment(blockId, week) {
    setAdjustment(blockId, week, null);
  }

  function applyWeekAdjustments(blocks, week) {
    var list = adjustmentList();
    if (!list.length) return blocks;
    var byBlock = {};
    list.forEach(function (a) {
      if (a.week === week && !byBlock[a.blockId]) byBlock[a.blockId] = a;
    });
    var out = [];
    blocks.forEach(function (b) {
      var a = byBlock[b.id];
      if (!a) { out.push(b); return; }
      if (a.cancel) return;
      var span = Math.max(0, (b.endPeriod || b.startPeriod) - b.startPeriod);
      out.push(Object.assign({}, b, {
        day: a.day,
        startPeriod: a.period,
        endPeriod: a.period + span,
        adjusted: a,
        baseDay: b.day,
        baseStart: b.startPeriod
      }));
    });
    return out;
  }

  function adjustmentLabel(b, a) {
    var span = Math.max(0, (b.endPeriod || b.startPeriod) - b.startPeriod);
    var period = '第 ' + a.period + (span ? '–' + (a.period + span) : '') + ' 节';
    if (a.cancel) return '本周停课';
    return '本周改到 ' + WEEK_NAMES[a.day] + ' ' + period;
  }

  function adjustedCardLabel(b) {
    var span = Math.max(0, (b.endPeriod || b.startPeriod) - b.startPeriod);
    var base = '原 ' + WEEK_NAMES[b.baseDay || b.day] + ' 第 ' + (b.baseStart || b.startPeriod) +
      (span ? '–' + ((b.baseStart || b.startPeriod) + span) : '') + ' 节';
    return '本周调课 · ' + base;
  }

  function statusTagFor(block, date, isToday) {
    if (!isToday) return '';
    var now = new Date();
    var start = combine(date, periodStart(block.startPeriod));
    var end = combine(date, periodEnd(block.endPeriod));
    if (!start || !end) return '';
    if (now >= start && now < end) {
      return { cls: 'is-now', text: '还剩 ' + minutesUntil(end, now) + ' 分钟' };
    }
    return null;
  }

  /* ---------------- today ---------------- */

  function renderToday() {
    var week = state.week;
    var day = state.day;
    var date = dateForWeekDay(week, day);
    var current = getCurrentWeek();
    var isToday = week === current && sameDay(date, new Date());
    var allWeek = allWeekPractice(week);
    var blocks = getDayBlocks(week, day);
    var nextOcc = computeNextOccurrence();
    var now = new Date();
    var hasCurrent = false;

    if (isToday) {
      for (var i = 0; i < blocks.length; i++) {
        var st = combine(date, periodStart(blocks[i].startPeriod));
        var en = combine(date, periodEnd(blocks[i].endPeriod));
        if (st && en && now >= st && now < en) { hasCurrent = true; break; }
      }
    }

    var infos = blocks.map(function (b) {
      return temporalInfo(b, week, nextOcc, hasCurrent);
    });
    var currentInfo = null;
    var nextInfo = null;
    infos.forEach(function (info, idx) {
      if (info.state === 'now' && !currentInfo) currentInfo = { b: blocks[idx], info: info };
      if (info.state === 'next' && !nextInfo) nextInfo = { b: blocks[idx], info: info };
    });

    var nowNote;
    if (isToday && currentInfo) nowNote = '正在上课';
    else if (isToday && nextInfo) nowNote = '下一节 ' + periodStart(nextInfo.b.startPeriod);
    else if (isToday) nowNote = '今天已无课';
    else nowNote = '第 ' + week + ' 周';
    var nowTime = pad2(now.getHours()) + ':' + pad2(now.getMinutes());

    var dayTabs = '';
    var firstMonth = dateForWeekDay(week, 1).getMonth();
    for (var d = 1; d <= 7; d++) {
      var dt = dateForWeekDay(week, d);
      var cls = ['day-tab'];
      if (d === day) cls.push('active');
      if (week === current && sameDay(dt, new Date())) cls.push('today');
      var dayLabel = dt.getMonth() !== firstMonth
        ? (dt.getMonth() + 1) + '.' + pad2(dt.getDate())
        : pad2(dt.getDate());
      dayTabs += '<button type="button" class="' + cls.join(' ') + '" data-day="' + d + '">' +
        '<div class="dt-w">' + WEEK_NAMES[d] + '</div>' +
        '<div class="dt-d">' + dayLabel + '</div>' +
        '</button>';
    }

    var totalPeriods = blocks.reduce(function (sum, b) {
      return sum + Math.max(1, (b.endPeriod || b.startPeriod) - (b.startPeriod || 1) + 1);
    }, 0);

    var html = '<div class="today-head">' +
      '<div class="th-left">' +
      '<div class="th-weekday">' + WEEK_NAMES[day] + '</div>' +
      '<div class="th-date">' + fmtLong(date) + (isToday ? ' · 今天' : '') + '</div>' +
      '</div>' +
      '<div class="now-block">' +
      '<div class="now-label">NOW</div>' +
      '<div class="now-time">' + nowTime + '</div>' +
      '<div class="now-note">' + esc(nowNote) + '</div>' +
      '</div>' +
      '</div>';

    html += '<div class="day-strip">' + dayTabs + '</div>';

    if (allWeek.length) {
      allWeek.forEach(function (p) {
        html += '<div class="week-practice">' +
          '<div><div class="wp-label">本周实践安排</div><div class="wp-name">' + esc(p.name) + '</div></div>' +
          '<div class="wp-meta">' + esc(formatWeeks(p.weeks)) + '<br>全周占用</div>' +
          '</div>';
      });
    }

    html += '<div class="day-summary"><strong>' + blocks.length + '</strong><span>门课 / ' + totalPeriods + ' 节</span>' +
      (allWeek.length ? '<span>· 本周另有整周实践</span>' : '') + '</div>';

    if (!blocks.length) {
      var onlyStops = weekAdjustments(week).filter(function (a) {
        if (!a.cancel) return false;
        var cb = findBlock(a.blockId);
        return cb && cb.day === day;
      });
      if (!onlyStops.length) {
        html += '<div class="empty' + (allWeek.length ? ' has-data' : '') + '">' +
          '<div class="empty-rule"></div>' +
          '<div class="glyph">空</div>' +
          '<p>' + (allWeek.length ? '这一周被实践安排占用了。' : '这一天没有排课，留白也是课程表的一部分。') + '</p>' +
          '</div>';
        $('#todayView').innerHTML = html;
        return;
      }
    }

    html += '<div class="timeline">';
    var stops = weekAdjustments(week).filter(function (a) {
      if (!a.cancel) return false;
      var cb = findBlock(a.blockId);
      return cb && cb.day === day;
    }).map(function (a) { return findBlock(a.blockId); }).sort(function (x, y) {
      return (x.startPeriod || 0) - (y.startPeriod || 0);
    });
    function stopCard(cb) {
      return '<button type="button" class="class-card is-cancelled" data-block="' + esc(cb.id) + '">' +
        '<div class="cc-time">' +
        '<span class="cc-start">' + esc(periodStart(cb.startPeriod) || '—') + '</span>' +
        '<span class="cc-end">' + esc(periodEnd(cb.endPeriod) || '') + '</span>' +
        '<span class="cc-period">' + cb.startPeriod + (cb.endPeriod !== cb.startPeriod ? '–' + cb.endPeriod : '') + ' 节</span>' +
        '</div>' +
        '<div class="cc-body">' +
        '<span class="cc-name">' + esc(cb.name) + '</span>' +
        '<div class="cc-meta">本周停课 · 这一周不用去</div>' +
        '</div>' +
        '</button>';
    }
    for (var k = 0; k < blocks.length; k++) {
      var b = blocks[k];
      while (stops.length && (stops[0].startPeriod || 0) <= (b.startPeriod || 0)) {
        html += stopCard(stops.shift());
      }
      var info = infos[k];
      var note = getNote(b.id);
      var stText = periodStart(b.startPeriod) || '';
      var enText = periodEnd(b.endPeriod) || '';
      var meta = [];
      var place = [b.room, b.campus].filter(Boolean).join(' · ');
      if (place) meta.push(place);
      if (b.teacher) meta.push(b.teacher);
      if (b.kind === 'practice') meta.push('实践安排');

      var cls = 'class-card state-' + info.state +
        (info.tag ? ' has-status' : '') +
        (note && note.text ? ' has-note' : '') +
        (b.adjusted ? ' is-adjusted' : '') +
        (b.kind === 'practice' ? ' is-practice' : '');

      html += '<button type="button" class="' + cls + '" data-block="' + esc(b.id) + '" ' +
        'style="background:' + info.bg + ';color:' + info.fg + '">' +
        '<div class="cc-time">' +
        '<span class="cc-start">' + esc(stText || '—') + '</span>' +
        '<span class="cc-end">' + esc(enText || '') + '</span>' +
        '<span class="cc-period">' + b.startPeriod + (b.endPeriod !== b.startPeriod ? '–' + b.endPeriod : '') + ' 节</span>' +
        '</div>' +
        '<div class="cc-body">' +
        (info.tag ? '<span class="cc-state">' + esc(info.tag) + '</span>' : '') +
        '<span class="cc-name">' + esc(b.name) + '</span>' +
        '<div class="cc-meta">' + esc(meta.join(' · ')) + '</div>' +
        '<div class="cc-weeks">' + esc(formatWeeks(b.weeks)) + (b.weeksUnknown ? ' · 请核对' : '') + '</div>' +
        (b.adjusted ? '<div class="cc-adj">' + esc(adjustedCardLabel(b)) + '</div>' : '') +
        (note && note.text
          ? '<div class="cc-note"><span>备注</span>' + esc(note.text) + '</div>'
          : '<div class="cc-note is-empty">＋ 备注</div>') +
        '</div>' +
        '</button>';
    }
    html += '</div>';

    $('#todayView').innerHTML = html;
  }

  /* ---------------- week grid ---------------- */

  function measureWeekGap() {
    var view = document.getElementById('weekView');
    if (!view || view.hidden) return;
    var top = view.querySelector('.week-top');
    var grid = view.querySelector('.timetable');
    if (!top || !grid) return;
    var gap = Math.round(grid.getBoundingClientRect().top - top.getBoundingClientRect().bottom);
    view.style.setProperty('--week-gap', Math.max(0, gap) + 'px');
  }

  function weekPanelHTML(week) {
    var current = getCurrentWeek();
    var todayDay = week === current ? todayWeekday() : -1;
    var allWeek = allWeekPractice(week);
    var blocks = (state.data.blocks || []).filter(function (b) {
      return !b.weeks || !b.weeks.length || b.weeks.indexOf(week) >= 0;
    });
    blocks = applyWeekAdjustments(blocks, week);
    var sessions = (state.data.practice || []).filter(function (p) {
      return !p.allWeek && p.weeks && p.weeks.indexOf(week) >= 0;
    });
    var nextOcc = computeNextOccurrence();
    var hasCurrent = false;

    if (week === current) {
      var now = new Date();
      blocks.concat(sessions).forEach(function (b) {
        if (b.day !== todayDay || !b.startPeriod) return;
        var date = dateForWeekDay(week, b.day);
        var st = combine(date, periodStart(b.startPeriod));
        var en = combine(date, periodEnd(b.endPeriod));
        if (st && en && now >= st && now < en) hasCurrent = true;
      });
    }

    var maxPeriod = state.settings.periods.length;
    blocks.concat(sessions).forEach(function (b) {
      maxPeriod = Math.max(maxPeriod, b.endPeriod || b.startPeriod || 1);
    });
    maxPeriod = Math.max(maxPeriod, 1);

    var html = '<div class="week-top">' +
      '<div class="week-title">第 ' + week + ' 周</div>' +
      '<div class="legend temporal-legend">' +
      '<span><i class="lg-next"></i>下一节</span>' +
      '<span><i class="lg-soon"></i>稍后/明天</span>' +
      '<span><i class="lg-later"></i>本周后续</span>' +
      '<span><i class="lg-done"></i>已结束</span>' +
      '</div>' +
      '<span class="legend-note">颜色越深越近 · 点按课块看详情</span>' +
      '</div>';

    var weekAdjs = weekAdjustments(week);
    if (weekAdjs.length) {
      html += '<div class="adj-strip">';
      weekAdjs.forEach(function (a) {
        var ab = findBlock(a.blockId);
        if (!ab) return;
        html += '<div class="adj-item' + (a.cancel ? ' is-cancel' : '') + '">' +
          '<span class="ai-tag">' + (a.cancel ? '停课' : '调课') + '</span>' +
          '<span class="ai-t">' + esc(ab.name) + ' · ' + esc(adjustmentLabel(ab, a)) + '</span>' +
          '<button type="button" class="ai-x" data-undo-adj="' + esc(a.blockId) + '" aria-label="撤销本周调整">×</button>' +
          '</div>';
      });
      html += '</div>';
    }

    if (allWeek.length) {
      html += '<div class="week-practice-strip">';
      allWeek.forEach(function (p) {
        html += '<div class="week-practice">' +
          '<div><div class="wp-label">本周实践安排</div><div class="wp-name">' + esc(p.name) + '</div></div>' +
          '<div class="wp-meta">' + esc(formatWeeks(p.weeks)) + '<br>全周占用</div>' +
          '</div>';
      });
      html += '</div>';
    }

    if (!blocks.length && !sessions.length && !allWeek.length) {
      html += '<p class="hint" style="margin:0 0 10px">本周没有排课。</p>';
    }

    html += '<div class="grid-wrap"><div class="timetable" style="--periods:' + maxPeriod + '">';
    html += '<div class="tt-corner">节次</div>';

    for (var d = 1; d <= 7; d++) {
      var dt = dateForWeekDay(week, d);
      html += '<div class="tt-day' + (d === todayDay ? ' today' : '') + '" style="grid-column:' + (d + 1) + ';grid-row:1">' +
        '<div class="td-w">' + WEEK_NAMES[d] + '</div>' +
        '<div class="td-d">' + fmtShort(dt) + '</div>' +
        '</div>';
    }

    for (var p = 1; p <= maxPeriod; p++) {
      var pClass = p <= 4 ? 'p-morning' : (p <= 8 ? 'p-afternoon' : 'p-evening');
      html += '<div class="tt-time ' + pClass + '" style="grid-column:1;grid-row:' + (p + 1) + '">' +
        '<span class="tt-n">' + p + '</span>' +
        '<span class="tt-h">' + esc(periodStart(p) || '') + '</span>' +
        '</div>';
      for (var dd = 1; dd <= 7; dd++) {
        var alt = (dd === 3 || dd === 5 || dd === 7) ? ' day-alt' : '';
        var todayCls = dd === todayDay ? ' today' : '';
        html += '<div class="tt-cell ' + pClass + alt + todayCls + '" style="grid-column:' + (dd + 1) + ';grid-row:' + (p + 1) + '"></div>';
      }
    }

    var dots = '';
    for (var q = 0; q < 9; q++) dots += '<i></i>';
    html += '<div class="week-deco" aria-hidden="true">' +
      '<div class="wd-tri"></div><div class="wd-square"></div><div class="wd-dots">' + dots + '</div>' +
      '</div><div class="week-frost" aria-hidden="true"></div>';

    var all = blocks.concat(sessions);
    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      if (!b.day || b.day < 1 || b.day > 7 || !b.startPeriod) continue;
      var span = Math.max(1, (b.endPeriod || b.startPeriod) - b.startPeriod + 1);
      var info = temporalInfo(b, week, nextOcc, hasCurrent);
      var note = getNote(b.id);
      var cls = 'tt-block state-' + info.state +
        (span <= 1 ? ' compact' : '') +
        (info.tagShort ? ' has-tag' : '') +
        (note && note.text ? ' has-note' : '') +
        (b.adjusted ? ' is-adjusted' : '') +
        (b.kind === 'practice' ? ' is-practice' : '');
      var blockTitle = b.name + (b.teacher ? ' · ' + b.teacher : '') + (b.room ? ' · ' + b.room : '') +
        (b.adjusted ? ' · 本周调课：' + adjustmentLabel(b, b.adjusted) : '') +
        (note && note.text ? ' · 有备注' : '');
      html += '<button type="button" class="' + cls + '" data-block="' + esc(b.id) + '" ' +
        'style="grid-column:' + (b.day + 1) + ';grid-row:' + (b.startPeriod + 1) + ' / span ' + span +
        ';background:' + info.bg + ';color:' + info.fg + '" ' +
        'title="' + esc(blockTitle) + '">' +
        (info.tagShort ? '<span class="tt-tag">' + esc(info.tagShort) + '</span>' : '') +
        (b.adjusted ? '<span class="tt-adj">调</span>' : '') +
        (note && note.text ? '<span class="tt-note-dot" aria-label="有备注"></span>' : '') +
        '<span class="tb-name">' + esc(b.name) + (b.weeksUnknown ? ' <span class="tb-unknown">*</span>' : '') + '</span>' +
        (b.room ? '<span class="tb-room">' + esc(b.room) + '</span>' : '') +
        (b.teacher ? '<span class="tb-teacher">' + esc(b.teacher) + '</span>' : '') +
        '</button>';
    }

    html += '</div></div>';
    return '<section class="week-panel" data-week="' + week + '">' + html + '</section>';
  }

  function edgeWeekPanel(label) {
    return '<section class="week-panel is-edge"><div class="week-edge">' + label + '</div></section>';
  }

  function renderWeek() {
    var view = document.getElementById('weekView');
    if (!view || !state.data) return;
    var max = state.settings.maxWeek || 20;
    var html = '<div class="week-viewport"><div class="week-track">';
    html += state.week > 1 ? weekPanelHTML(state.week - 1) : edgeWeekPanel('已经是第一周');
    html += weekPanelHTML(state.week);
    html += state.week < max ? weekPanelHTML(state.week + 1) : edgeWeekPanel('已经是最后一周');
    html += '</div></div>';
    view.innerHTML = html;
    weekViewportEl = view.querySelector('.week-viewport');
    weekTrackEl = view.querySelector('.week-track');
    measureWeekGap();
    if (weekViewportEl && weekTrackEl) {
      weekTrackWidth = weekViewportEl.clientWidth;
      weekTrackEl.style.transition = 'none';
      weekTrackEl.style.transform = 'translate3d(-' + weekTrackWidth + 'px,0,0)';
    }
  }

  /* ---------------- courses ---------------- */

  function buildCourseGroups() {
    var groups = {};
    function ensure(rec) {
      var key = courseKey(rec);
      if (!groups[key]) {
        groups[key] = {
          key: key,
          name: rec.name,
          code: rec.code || '',
          teacher: rec.teacher || '',
          credits: rec.credits || '',
          blocks: [],
          practice: [],
          rooms: {},
          weeks: {}
        };
      }
      var g = groups[key];
      if (!g.teacher && rec.teacher) g.teacher = rec.teacher;
      if (!g.credits && rec.credits) g.credits = rec.credits;
      if (rec.room) g.rooms[rec.room] = true;
      (rec.weeks || []).forEach(function (w) { g.weeks[w] = true; });
      return g;
    }

    (state.data.blocks || []).forEach(function (b) {
      ensure(b).blocks.push(b);
    });
    (state.data.practice || []).forEach(function (p) {
      ensure(p).practice.push(p);
    });

    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      g.weekList = Object.keys(g.weeks).map(Number).sort(function (a, b) { return a - b; });
      g.roomList = Object.keys(g.rooms);
      return g;
    }).sort(function (a, b) {
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }

  function renderCourses() {
    var groups = buildCourseGroups();
    var html = '<div class="courses-head">' +
      '<div class="courses-title">课程</div>' +
      '<div class="courses-count">' + groups.length + ' 门课</div>' +
      '</div>';

    if (!groups.length) {
      html += '<div class="empty"><div class="glyph">空</div><p>还没有课程，先导入课表。</p></div>';
      $('#coursesView').innerHTML = html;
      return;
    }

    html += '<div class="course-grid">';
    groups.forEach(function (g) {
      var base = hexToHsl(courseColor(g.key));
      var bg = 'hsl(' + base.h + ', 34%, 82%)';
      var meta = [];
      if (g.teacher) meta.push(g.teacher);
      meta.push((g.blocks.length + g.practice.length) + ' 个时段');
      if (g.roomList.length) meta.push(g.roomList.join(' / '));
      html += '<button type="button" class="course-card" data-course="' + esc(g.key) + '" ' +
        'style="background:' + bg + ';color:#141414">' +
        (g.credits ? '<span class="course-credits">' + esc(g.credits) + ' 学分</span>' : '') +
        '<span class="course-name">' + esc(g.name) + '</span>' +
        '<div class="course-meta">' + esc(meta.join(' · ')) + '</div>' +
        '<div class="course-weeks">' + esc(formatWeeks(g.weekList)) + '</div>' +
        '</button>';
    });
    html += '</div>';
    $('#coursesView').innerHTML = html;
  }

  /* ---------------- modals ---------------- */

  function openModal(opts) {
    var root = $('#modalRoot');
    root.innerHTML = '<div class="modal-overlay" id="modalOverlay">' +
      '<div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><div><h2>' + opts.title + '</h2>' +
      (opts.sub ? '<div class="modal-sub">' + opts.sub + '</div>' : '') +
      '</div><button type="button" class="modal-close" aria-label="关闭">×</button></div>' +
      '<div class="modal-body">' + opts.body + '</div>' +
      (opts.footer ? '<div class="modal-foot">' + opts.footer + '</div>' : '') +
      '</div></div>';

    var overlay = $('#modalOverlay');
    if (!overlay) return { close: function () {} };
    var modal = overlay.querySelector('.modal');
    document.body.style.overflow = 'hidden';
    var trigger = opts.trigger || null;
    var shutter = !!opts.shutter && !!trigger && !prefersReducedMotion();
    var shutterKind = opts.shutterKind || '';
    var actionShutter = shutterKind === 'settings' || shutterKind === 'import';
    var morph = !!trigger && !prefersReducedMotion() && !shutter;
    var morphTimers = [];
    var morphSource = null;
    var shutterRect = null;
    var closed = false;
    var closeCallbacks = [];

    function cleanupMorph() {
      morphTimers.forEach(function (id) { clearTimeout(id); });
      morphTimers = [];
      if (morphSource && morphSource.parentNode) morphSource.parentNode.removeChild(morphSource);
      morphSource = null;
    }

    function finish() {
      if (actionShutter && trigger) trigger.style.visibility = '';
      if (!overlay.parentNode) return;
      if (morphSource && morphSource.parentNode) morphSource.parentNode.removeChild(morphSource);
      morphSource = null;
      root.innerHTML = '';
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      if (trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
      var cbs = closeCallbacks.splice(0);
      cbs.forEach(function (fn) { fn(); });
    }

    function close(done) {
      if (typeof done === 'function') closeCallbacks.push(done);
      if (closed) {
        if (!overlay.parentNode && closeCallbacks.length) {
          var cbs = closeCallbacks.splice(0);
          cbs.forEach(function (fn) { fn(); });
        }
        return;
      }
      closed = true;
      document.removeEventListener('keydown', onKey);
      if (shutter) {
        morphTimers.forEach(function (id) { clearTimeout(id); });
        morphTimers = [];
        modal.classList.add('is-shutter-closing');
        modal.classList.remove('is-unrolling');
        setTimeout(function () {
          if (morphSource) {
            morphSource.classList.remove('is-wide');
            morphSource.style.left = (shutterRect ? shutterRect.left : 0) + 'px';
            morphSource.style.width = (shutterRect ? shutterRect.width : 0) + 'px';
            morphSource.style.transform = 'none';
          }
          overlay.classList.add('is-closing');
          setTimeout(finish, 350);
        }, 300);
        return;
      }
      cleanupMorph();
      if (morph) {
        var head = modal.querySelector('.modal-head');
        var hr = head.getBoundingClientRect();
        var tr = trigger.getBoundingClientRect();
        var ret = document.createElement('div');
        ret.className = 'modal-morph-source is-solid is-returning no-anim';
        ret.style.background = opts.sourceBg || getComputedStyle(head).backgroundColor || '#141414';
        ret.style.color = opts.sourceFg || '#F2EEE3';
        ret.style.left = tr.left + 'px';
        ret.style.top = tr.top + 'px';
        ret.style.width = tr.width + 'px';
        ret.style.height = tr.height + 'px';
        ret.setAttribute('aria-hidden', 'true');
        ret.inert = true;
        document.body.appendChild(ret);
        morphSource = ret;
        void ret.offsetWidth;
        var rdx = hr.left - tr.left;
        var rdy = hr.top - tr.top;
        var rsx = hr.width / tr.width;
        var rsy = hr.height / tr.height;
        ret.style.transform = 'translate(' + rdx + 'px,' + rdy + 'px) scale(' + rsx + ',' + rsy + ')';
        void ret.offsetWidth;
        ret.classList.remove('no-anim');
        void ret.offsetWidth;
        ret.style.transform = 'none';
        modal.classList.add('is-closing');
        setTimeout(function () {
          overlay.classList.add('is-closing');
          setTimeout(finish, 220);
        }, 280);
      } else {
        finish();
      }
    }

    function onKey(e) {
      if (e.key === 'Escape') close();
    }

    if (shutter) {
      overlay.classList.add('is-morph', 'is-shutter');
      modal.classList.add('shutter');
      modal.setAttribute('aria-label', opts.ariaTitle || '详情');

      var svw = window.innerWidth;
      var svh = window.innerHeight;
      var smw = Math.min(opts.wide ? 860 : 720, svw - 16);
      var str = trigger.getBoundingClientRect();
      var iconTop = opts.shutterDock != null ? opts.shutterDock : 96;
      var sheetTop = iconTop + str.height + 8;
      modal.style.width = smw + 'px';
      modal.style.position = 'absolute';
      modal.style.left = Math.max(8, (svw - smw) / 2) + 'px';
      modal.style.top = sheetTop + 'px';
      modal.style.maxHeight = Math.max(160, svh - sheetTop - 8) + 'px';
      modal.style.margin = '0';
      void modal.offsetHeight;

      var icon = trigger.cloneNode(true);
      icon.classList.add('shutter-source');
      icon.removeAttribute('id');
      icon.style.left = str.left + 'px';
      icon.style.top = str.top + 'px';
      icon.style.width = str.width + 'px';
      icon.style.height = str.height + 'px';
      icon.setAttribute('aria-hidden', 'true');
      icon.inert = true;
      if (trigger.classList && trigger.classList.contains('tt-block')) {
        icon.classList.add('is-week');
      }
      if (actionShutter) {
        icon.classList.add('is-action');
        icon.style.setProperty('--ss-font', getComputedStyle(trigger).fontSize);
        var metaText = opts.shutterMeta || (shutterKind === 'settings' ? '课表数据只保存在这台设备' : '');
        if (metaText) {
          var meta = document.createElement('span');
          meta.className = 'ss-meta';
          meta.textContent = metaText;
          icon.appendChild(meta);
        }
        trigger.style.visibility = 'hidden';
      }
      document.body.appendChild(icon);
      morphSource = icon;
      shutterRect = { left: str.left, top: str.top, width: str.width, height: str.height };
      void icon.offsetWidth;
      icon.style.transform = 'translateY(' + (iconTop - str.top) + 'px)';

      var sheetLeft = Math.max(8, (svw - smw) / 2);
      morphTimers.push(setTimeout(function () {
        icon.style.left = sheetLeft + 'px';
        icon.style.width = smw + 'px';
        icon.classList.add('is-wide');
      }, 240));
      morphTimers.push(setTimeout(function () {
        modal.classList.add('is-unrolling');
      }, 520));
    } else if (morph) {
      overlay.classList.add('is-morph');
      modal.classList.add('morph');
      if (opts.headColor) {
        modal.classList.add('morph-head');
        modal.style.setProperty('--morph-head-bg', opts.headColor);
        modal.style.setProperty('--morph-head-fg', opts.headInk || '#FFFFFF');
      }

      var vw = window.innerWidth;
      var vh = window.innerHeight;
      modal.style.width = Math.min(opts.wide ? 860 : 720, vw - 16) + 'px';
      modal.style.position = 'absolute';
      void modal.offsetHeight;
      var tr = trigger.getBoundingClientRect();
      var mh = modal.offsetHeight;
      var mw = modal.offsetWidth;
      var left = tr.left + tr.width / 2 - mw / 2;
      var top = tr.top + tr.height / 2 - mh / 2;
      left = Math.max(8, Math.min(vw - mw - 8, left));
      top = Math.max(8, Math.min(vh - mh - 8, top));
      modal.style.left = left + 'px';
      modal.style.top = top + 'px';
      modal.style.margin = '0';
      void modal.offsetHeight;
      modal.classList.add('is-open');

      var head = modal.querySelector('.modal-head');
      var headRect = head.getBoundingClientRect();
      var source;
      if (opts.sourceLabel) {
        source = document.createElement('div');
        source.className = 'modal-morph-source is-solid';
        source.style.background = opts.sourceBg || '#141414';
        source.style.color = opts.sourceFg || '#F2EEE3';
      } else {
        source = trigger.cloneNode(true);
        source.classList.add('modal-morph-source');
        source.removeAttribute('id');
      }
      source.style.left = tr.left + 'px';
      source.style.top = tr.top + 'px';
      source.style.width = tr.width + 'px';
      source.style.height = tr.height + 'px';
      source.setAttribute('aria-hidden', 'true');
      source.inert = true;
      document.body.appendChild(source);
      void source.offsetWidth;

      var dx = headRect.left - tr.left;
      var dy = headRect.top - tr.top;
      var sx = headRect.width / tr.width;
      var sy = headRect.height / tr.height;
      source.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')';
      morphSource = source;

      morphTimers.push(setTimeout(function () { source.classList.add('is-content-out'); }, 80));
      morphTimers.push(setTimeout(function () {
        modal.classList.add('is-head-in');
        source.classList.add('is-gone');
      }, 340));
      morphTimers.push(setTimeout(function () {
        if (source.parentNode) source.parentNode.removeChild(source);
        if (morphSource === source) morphSource = null;
      }, 500));
      overlay.querySelector('.modal-close').focus({ preventScroll: true });
    }

    document.addEventListener('keydown', onKey);
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    return { overlay: overlay, close: close };
  }

  function findRecord(id) {
    var b = (state.data.blocks || []).find(function (x) { return x.id === id; });
    if (b) return b;
    return (state.data.practice || []).find(function (x) { return x.id === id; }) || null;
  }

  function reminderLabel(min) {
    min = parseInt(min, 10) || 0;
    if (min <= 0) return '关闭';
    return min >= 60 ? Math.round(min / 60) + ' 小时前' : min + ' 分钟前';
  }

  function openBlockDetail(id, trigger) {
    var rec = findRecord(id);
    if (!rec) return;
    var note = getNote(id) || { text: '', remindMinutes: null };
    var def = parseInt(state.settings.reminderDefault, 10) || 0;
    var current = note.remindMinutes === null || note.remindMinutes === undefined ? 'default' : String(note.remindMinutes);
    var opts = '<option value="default"' + (current === 'default' ? ' selected' : '') + '>跟随默认（' + reminderLabel(def) + '）</option>' +
      '<option value="0"' + (current === '0' ? ' selected' : '') + '>不提醒</option>';
    REMINDER_OPTIONS.filter(function (m) { return m > 0; }).forEach(function (m) {
      opts += '<option value="' + m + '"' + (current === String(m) ? ' selected' : '') + '>' + reminderLabel(m) + '</option>';
    });

    var period = rec.startPeriod
      ? '第 ' + rec.startPeriod + (rec.endPeriod !== rec.startPeriod ? '–' + rec.endPeriod : '') + ' 节'
      : '整周';
    var time = [periodStart(rec.startPeriod), periodEnd(rec.endPeriod)].filter(Boolean).join('–');
    var rows = '<div class="detail-list">' +
      '<div class="detail-row"><div class="dr-label">时间</div><div class="dr-value">' +
      esc((WEEK_NAMES[rec.day] || '实践') + ' · ' + period + (time ? ' · ' + time : '')) + '</div></div>' +
      '<div class="detail-row"><div class="dr-label">教室</div><div class="dr-value">' +
      esc([rec.room, rec.campus].filter(Boolean).join(' · ') || '—') + '</div></div>' +
      '<div class="detail-row"><div class="dr-label">教师</div><div class="dr-value">' + esc(rec.teacher || '—') + '</div></div>' +
      '<div class="detail-row"><div class="dr-label">周次</div><div class="dr-value">' + esc(formatWeeks(rec.weeks)) + '</div></div>' +
      '</div>';

    /* 本周调课：只改当前这一周，基础课表不动 */
    var wk = state.week;
    var inWeek = !rec.weeks || !rec.weeks.length || rec.weeks.indexOf(wk) >= 0;
    var adj = (rec.kind !== 'practice' && inWeek && rec.day) ? adjustmentFor(rec.id, wk) : null;
    var adjHTML = '';
    if (rec.kind !== 'practice' && inWeek && rec.day) {
      var adjSpan = Math.max(0, (rec.endPeriod || rec.startPeriod) - rec.startPeriod);
      var maxP = Math.min(30, Math.max(1, state.settings.periods.length));
      var periodOpts = '';
      for (var pi = 1; pi + adjSpan <= maxP; pi++) {
        var picked = adj && !adj.cancel ? adj.period : rec.startPeriod;
        periodOpts += '<option value="' + pi + '"' + (picked === pi ? ' selected' : '') + '>' +
          '第 ' + pi + (adjSpan ? '–' + (pi + adjSpan) : '') + ' 节</option>';
      }
      var selDay = adj && !adj.cancel ? adj.day : rec.day;
      var dayBtns = '';
      for (var di = 1; di <= 7; di++) {
        dayBtns += '<button type="button" class="adj-day' + (di === selDay ? ' active' : '') + '" ' +
          'data-adj-day="' + di + '">' + WEEK_NAMES[di] + '</button>';
      }
      var baseLabel = WEEK_NAMES[rec.day] + ' 第 ' + rec.startPeriod +
        (rec.endPeriod !== rec.startPeriod ? '–' + rec.endPeriod : '') + ' 节';
      var nowText = !adj
        ? '本周按原课表上课（' + baseLabel + '）。'
        : (adj.cancel
          ? '本周已停课，原时间为 ' + baseLabel + '。'
          : adjustmentLabel(rec, adj) + '（原 ' + baseLabel + '）。');
      adjHTML = '<div class="form-section adj-section">' +
        '<h3>本周调课 · 第 ' + wk + ' 周</h3>' +
        '<p class="hint adj-now" id="adjNow">' + esc(nowText) + '</p>' +
        '<div class="adj-form" id="adjForm" hidden>' +
        '<div class="adj-days" id="adjDays">' + dayBtns + '</div>' +
        '<div class="field" style="margin-top:10px"><label for="adjPeriod">改到第几节</label>' +
        '<select id="adjPeriod">' + periodOpts + '</select></div>' +
        '<label class="adj-check"><input type="checkbox" id="adjCancelCk"' + (adj && adj.cancel ? ' checked' : '') + '> 本周停课，不排这节课</label>' +
        '</div>' +
        '<div class="adj-btns">' +
        '<button type="button" class="btn ghost" id="adjEdit">调课 / 停课</button>' +
        '<button type="button" class="btn ghost" id="adjReset"' + (adj ? '' : ' hidden') + '>恢复本周正常</button>' +
        '<button type="button" class="btn primary" id="adjSave" hidden>保存调整</button>' +
        '</div></div>';
    }

    var body = rows + adjHTML +
      '<div class="form-section"><h3>上课备注</h3>' +
      '<textarea id="noteText" class="note-text" maxlength="1000" placeholder="比如：带实验报告、交作业、找老师签到、带计算器…">' + esc(note.text || '') + '</textarea>' +
      '<div class="field" style="margin-top:10px"><label for="noteReminder">提醒</label>' +
      '<select id="noteReminder">' + opts + '</select></div>' +
      '<p class="hint">Android 安装版会同步成系统通知；iPhone 请用“导出 .ics 日历”并导入系统日历，由日历提醒。</p>' +
      '</div>';

    var style = trigger ? getComputedStyle(trigger) : null;
    var modal = openModal({
      title: esc(rec.name),
      sub: '备注与提醒',
      body: body,
      trigger: trigger,
      shutter: true,
      ariaTitle: rec.name,
      headColor: style ? style.backgroundColor : '',
      headInk: style ? style.color : '',
      footer: '<button type="button" class="btn ghost" data-close>取消</button>' +
        '<button type="button" class="btn primary" id="saveNote">保存备注</button>'
    });

    var adjForm = modal.overlay.querySelector('#adjForm');
    if (adjForm) {
      var adjEditBtn = modal.overlay.querySelector('#adjEdit');
      var adjSaveBtn = modal.overlay.querySelector('#adjSave');
      var adjResetBtn = modal.overlay.querySelector('#adjReset');
      var adjCancelCk = modal.overlay.querySelector('#adjCancelCk');
      var adjDaysEl = modal.overlay.querySelector('#adjDays');
      var adjPeriodEl = modal.overlay.querySelector('#adjPeriod');

      function syncCancelState() {
        var on = adjCancelCk.checked;
        adjDaysEl.classList.toggle('is-off', on);
        adjPeriodEl.disabled = on;
      }
      syncCancelState();
      adjCancelCk.addEventListener('change', syncCancelState);

      adjEditBtn.addEventListener('click', function () {
        var opening = adjForm.hasAttribute('hidden');
        if (opening) adjForm.removeAttribute('hidden');
        else adjForm.setAttribute('hidden', '');
        adjSaveBtn.hidden = !opening;
        adjEditBtn.textContent = opening ? '收起' : '调课 / 停课';
      });

      adjDaysEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-adj-day]');
        if (!btn) return;
        Array.prototype.forEach.call(adjDaysEl.querySelectorAll('.adj-day'), function (x) {
          x.classList.toggle('active', x === btn);
        });
      });

      adjSaveBtn.addEventListener('click', function () {
        var next = null;
        if (adjCancelCk.checked) {
          next = { cancel: true };
        } else {
          var dayBtn = adjDaysEl.querySelector('.adj-day.active');
          var day = dayBtn ? parseInt(dayBtn.dataset.adjDay, 10) : rec.day;
          var period = parseInt(adjPeriodEl.value, 10) || rec.startPeriod;
          next = (day === rec.day && period === rec.startPeriod) ? null : { day: day, period: period };
        }
        setAdjustment(rec.id, wk, next);
        modal.close();
        renderAll();
        syncPhoneReminders();
        toast(!next ? '已恢复本周原课表' : (next.cancel ? '本周已标记停课' : '本周已改到 ' + WEEK_NAMES[next.day]));
      });

      adjResetBtn.addEventListener('click', function () {
        clearAdjustment(rec.id, wk);
        modal.close();
        renderAll();
        syncPhoneReminders();
        toast('已恢复本周原课表');
      });
    }

    var cancel = modal.overlay.querySelector('[data-close]');
    if (cancel) cancel.addEventListener('click', modal.close);
    var save = modal.overlay.querySelector('#saveNote');
    if (save) {
      save.addEventListener('click', function () {
        var text = document.getElementById('noteText').value;
        var val = document.getElementById('noteReminder').value;
        var remind = val === 'default' ? null : parseInt(val, 10);
        setNote(id, text, remind);
        modal.close();
        renderAll();
        syncPhoneReminders();
        toast(remind === 0 ? '已保存，这节课不提醒' : '备注已保存');
      });
    }
  }

  function slotLabel(b) {
    var period = '第 ' + b.startPeriod + (b.endPeriod !== b.startPeriod ? '–' + b.endPeriod : '') + ' 节';
    var time = [periodStart(b.startPeriod), periodEnd(b.endPeriod)].filter(Boolean).join('–');
    var place = [b.room, b.campus].filter(Boolean).join(' · ');
    return [period, time, place].filter(Boolean).join(' · ');
  }

  function openCourse(key, trigger) {
    var groups = buildCourseGroups();
    var g = groups.find(function (x) { return x.key === key; });
    if (!g) return;

    var rows = '';
    rows += '<div class="detail-row"><div class="dr-label">课程代码</div><div class="dr-value">' + esc(g.code || '—') + '</div></div>';
    rows += '<div class="detail-row"><div class="dr-label">教师</div><div class="dr-value">' + esc(g.teacher || '—') + '</div></div>';
    rows += '<div class="detail-row"><div class="dr-label">学分</div><div class="dr-value">' + esc(g.credits || '—') + '</div></div>';
    rows += '<div class="detail-row"><div class="dr-label">周次</div><div class="dr-value">' + esc(formatWeeks(g.weekList)) + '</div></div>';
    if (g.roomList.length) {
      rows += '<div class="detail-row"><div class="dr-label">教室</div><div class="dr-value">' + esc(g.roomList.join(' / ')) + '</div></div>';
    }

    var slots = '';
    g.blocks.slice().sort(function (a, b) {
      return a.day - b.day || a.startPeriod - b.startPeriod;
    }).forEach(function (b) {
      slots += '<div class="detail-row"><div class="dr-label">' + WEEK_NAMES[b.day] + '</div>' +
        '<div class="dr-value">' + esc(slotLabel(b)) + '<br><span class="hint">' + esc(formatWeeks(b.weeks)) + '</span></div></div>';
    });
    g.practice.slice().sort(function (a, b) {
      return (a.weeks[0] || 0) - (b.weeks[0] || 0);
    }).forEach(function (p) {
      var label = p.allWeek
        ? '整周占用 · ' + formatWeeks(p.weeks)
        : WEEK_NAMES[p.day] + ' · 第 ' + p.startPeriod + '–' + p.endPeriod + ' 节 · ' + formatWeeks(p.weeks);
      slots += '<div class="detail-row"><div class="dr-label">实践</div><div class="dr-value">' + esc(label) + '</div></div>';
    });

    var body = '<div class="detail-list">' + rows + '</div>' +
      '<h3 style="margin:18px 0 8px;font-size:12px;letter-spacing:.1em">所有时段</h3>' +
      '<div class="detail-list">' + slots + '</div>';

    var style = trigger ? getComputedStyle(trigger) : null;
    var modal = openModal({
      title: esc(g.name),
      sub: g.code ? esc(g.code) : '课程详情',
      body: body,
      trigger: trigger,
      shutter: true,
      ariaTitle: g.name,
      headColor: style ? style.backgroundColor : '',
      headInk: style ? style.color : '',
      footer: '<button type="button" class="btn ghost" data-close>关闭</button>'
    });

    var closeBtn = modal.overlay.querySelector('[data-close]');
    if (closeBtn) closeBtn.addEventListener('click', modal.close);
  }

  /* ---------------- settings ---------------- */

  function loadPresets() {
    var custom = readJSON(STORAGE.presets) || [];
    return PRESETS.concat(Array.isArray(custom) ? custom : []);
  }

  function periodRowsHTML(periods) {
    return periods.map(function (p, i) {
      return '<tr><td>' + (i + 1) + '</td>' +
        '<td><input type="time" class="p-start" value="' + esc(p.start) + '"></td>' +
        '<td><input type="time" class="p-end" value="' + esc(p.end) + '"></td>' +
        '<td><button type="button" class="period-remove" aria-label="删除这一节">×</button></td></tr>';
    }).join('');
  }

  function renumberPeriods() {
    var rows = document.querySelectorAll('#periodRows tr');
    for (var i = 0; i < rows.length; i++) rows[i].firstElementChild.textContent = i + 1;
  }

  function addMinutes(hhmm, min) {
    var parts = String(hhmm || '08:00').split(':');
    var total = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10) + min;
    total = ((total % 1440) + 1440) % 1440;
    return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
  }

  function reminderOptionsHTML(selected) {
    var opts = '<option value="0"' + (selected === 0 ? ' selected' : '') + '>关闭</option>';
    [5, 10, 15, 30, 60].forEach(function (m) {
      opts += '<option value="' + m + '"' + (selected === m ? ' selected' : '') + '>' + reminderLabel(m) + '</option>';
    });
    return opts;
  }

  function syncSettingsHTML() {
    var cfg = state.settings.sync || {};
    var auto = state.settings.autoImport;
    var dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    var dayOpts = dayNames.map(function (n, i) {
      return '<option value="' + (i + 1) + '"' + ((parseInt(cfg.weekday, 10) || 1) === i + 1 ? ' selected' : '') + '>每' + n + '</option>';
    }).join('');
    var lastLine = !cfg.lastAt ? '还没同步过'
      : '上次同步 ' + fmtSyncAt(cfg.lastAt) + (cfg.lastNote ? ' · ' + cfg.lastNote : '') +
        (cfg.lastOk === 'fail' ? '（上次未完成，可能需要重新登录）' : '');
    var hint = auto
      ? '同步日 / 时间只是提醒窗口：打开 App 时如果已经过了这个时间，就自动刷新。'
      : '先在「导入」里做一次自动导入并选好学校，这里才能每周刷新。';
    return '<div class="form-section"><h3>每周同步</h3>' +
      '<div class="sync-switches">' +
      '<label class="sync-switch' + (cfg.enabled !== false ? ' is-on' : '') + '">' +
      '<input type="checkbox" id="setSyncOn"' + (cfg.enabled !== false ? ' checked' : '') + '>' +
      '<span class="ss-copy"><span class="ss-title">每周自动同步</span>' +
      '<em class="ss-note">到点打开 App 就自动刷新课表，有变化直接应用</em></span>' +
      '</label>' +
      '<label class="sync-switch' + (cfg.keepAlive !== false ? ' is-on' : '') + '">' +
      '<input type="checkbox" id="setKeepAlive"' + (cfg.keepAlive !== false ? ' checked' : '') + '>' +
      '<span class="ss-copy"><span class="ss-title">保持登录</span>' +
      '<em class="ss-note">每 25 分钟轻量续一次会话，少登录、少验证码</em></span>' +
      '</label>' +
      '</div>' +
      '<div class="form-grid sync-when">' +
      '<div class="field"><label for="setSyncWeekday">同步日</label><select id="setSyncWeekday">' + dayOpts + '</select></div>' +
      '<div class="field"><label for="setSyncTime">时间</label><input id="setSyncTime" type="time" value="' + esc(cfg.time || '07:00') + '"></div>' +
      '</div>' +
      '<p class="hint">' + esc(hint) + '</p>' +
      '<p class="hint sync-last" id="syncLast">' + esc(lastLine) + '</p>' +
      '<div class="settings-actions"><button type="button" class="btn ghost" id="syncNowBtn">立即同步</button></div>' +
      credSettingsHTML() +
      '</div>';
  }

  function credSettingsHTML() {
    var bridge = window.AndroidBridge;
    var canCred = !!(bridge && typeof bridge.hasCredentials === 'function');
    if (!canCred) {
      return '<p class="hint">「登录一次、之后自动同步」需要安卓安装版：网页版没有后台登录能力。</p>';
    }
    var saved = false, user = '';
    try { saved = bridge.hasCredentials(); user = saved ? bridge.credentialUser() : ''; } catch (e) {}
    return '<div class="cred-box">' +
      '<div class="cred-line">自动登录：<b id="credStatus">' +
      (saved ? '已保存 ' + esc(user || '学号') : '未保存') + '</b></div>' +
      '<div class="form-grid">' +
      '<div class="field"><label for="credUser">学号</label><input id="credUser" value="' + esc(saved ? user : '') + '" autocomplete="username"></div>' +
      '<div class="field"><label for="credPass">密码</label><input id="credPass" type="password" placeholder="只在保存时读一次" autocomplete="current-password"></div>' +
      '</div>' +
      '<div class="settings-actions">' +
      '<button type="button" class="btn ghost" id="credSave">保存账号</button>' +
      '<button type="button" class="btn ghost" id="credClear">清除已保存账号</button>' +
      '</div>' +
      '<p class="hint">密码用系统密钥（Android Keystore）加密后只存在这台手机，不上传、也不写进导出的备份；学校会话过期时，同步会用它在登录页自动登录。</p>' +
      '</div>';
  }

  function openSettings(trigger) {
    var s = state.settings;
    var presets = loadPresets();
    var matched = presets.find(function (p) { return p.week1 === s.week1 && p.semester === s.semester; });

    var presetOptions = presets.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (matched && matched.id === p.id ? ' selected' : '') + '>' +
        esc(p.school + ' · ' + p.semester) + '</option>';
    }).join('');
    presetOptions = '<option value="">自定义</option>' + presetOptions;
    if (!matched) presetOptions = presetOptions.replace('<option value="">自定义</option>', '<option value="" selected>自定义</option>');

    var body = '' +
      '<div class="form-grid">' +
      '<div class="field full"><label for="setPreset">学校 / 学期预设</label><select id="setPreset">' + presetOptions + '</select>' +
      '<span class="hint">不同学校开学日期不同。选预设可自动填入第 1 周日期；找不到就选“自定义”手动填。</span></div>' +
      '<div class="field"><label for="setSchool">学校名称</label><input id="setSchool" value="' + esc(s.school) + '"></div>' +
      '<div class="field"><label for="setSemester">学期</label><input id="setSemester" value="' + esc(s.semester) + '"></div>' +
      '<div class="field"><label for="setWeek1">第 1 周周一</label><input id="setWeek1" type="date" value="' + esc(s.week1) + '"></div>' +
      '<div class="field"><label for="setMaxWeek">总周数</label><input id="setMaxWeek" type="number" min="1" max="30" value="' + esc(s.maxWeek) + '"></div>' +
      '<div class="field"><label for="setName">姓名</label><input id="setName" value="' + esc(s.student.name) + '"></div>' +
      '<div class="field"><label for="setClass">班级</label><input id="setClass" value="' + esc(s.student.className) + '"></div>' +
      '</div>' +
      '<div class="form-section"><h3>作息时间</h3>' +
      '<table class="period-table"><thead><tr><th>#</th><th>开始</th><th>结束</th><th></th></tr></thead>' +
      '<tbody id="periodRows">' + periodRowsHTML(s.periods) + '</tbody></table>' +
      '<button type="button" class="btn ghost" id="addPeriod" style="margin-top:10px">+ 添加一节</button>' +
      '<p class="hint">默认采用常见的 11 节制：45 分钟一节，8:00 开始，14:00 下午，19:00 晚上。请按学校实际作息修改。</p>' +
      '</div>' +
      '<div class="form-section"><h3>颜色说明</h3>' +
      '<div class="color-legend">' +
      '<div><i class="cl-next"></i><b>下一节</b><span>最高饱和</span></div>' +
      '<div><i class="cl-soon"></i><b>稍后 / 明天</b><span>中等饱和</span></div>' +
      '<div><i class="cl-later"></i><b>本周后续</b><span>更低饱和</span></div>' +
      '<div><i class="cl-done"></i><b>已结束</b><span>最低饱和</span></div>' +
      '</div>' +
      '<p class="hint">课程色块越深，离下一节越近；已结束的课只降低底色饱和度，文字仍保持可读。网格里的几何装饰只出现在空白区。</p>' +
      '</div>' +
      '<div class="form-section"><h3>上课提醒</h3>' +
      '<div class="form-grid"><div class="field full">' +
      '<label for="setReminder">默认提前时间</label>' +
      '<select id="setReminder">' + reminderOptionsHTML(parseInt(s.reminderDefault, 10) || 0) + '</select>' +
      '<span class="hint">所有课程默认按这个时间提醒；每节课可在备注里单独改或关闭。Android 安装版会同步系统通知；iPhone 请导出 .ics 并导入系统日历。</span>' +
      '</div></div></div>' +
      syncSettingsHTML() +
      '<div class="form-section"><h3>安卓安装版</h3>' + apkDownloadHTML('settings') + '</div>' +
      '<div class="form-section"><h3>数据</h3>' +
      '<div class="settings-actions">' +
      '<button type="button" class="btn ghost" id="settingsImport">导入 xlsx</button>' +
      '<button type="button" class="btn ghost" id="settingsIcs">导出 .ics 日历</button>' +
      '<button type="button" class="btn ghost" id="settingsJson">导出数据</button>' +
      '<button type="button" class="btn ghost" id="settingsRestore">导入数据</button>' +
      '<button type="button" class="btn ghost" id="settingsSavePreset">保存为我的学校</button>' +
      '<button type="button" class="btn danger" id="settingsReset">清空数据</button>' +
      '</div>' +
      '<p class="hint">所有解析和存储都在本机完成，不会上传。导出的 .ics 可以直接导入手机系统日历。</p>' +
      '</div>';

    var modal = openModal({
      title: '设置',
      sub: '课表数据只保存在这台设备',
      body: body,
      wide: true,
      trigger: trigger,
      shutter: true,
      shutterKind: 'settings',
      shutterDock: 18,
      ariaTitle: '设置',
      footer: '<button type="button" class="btn ghost" data-close>取消</button>' +
        '<button type="button" class="btn primary" id="saveSettings">保存设置</button>'
    });

    var overlay = modal.overlay;
    var close = modal.close;

    overlay.querySelector('.modal-close').addEventListener('click', close);
    var closeBtn = overlay.querySelector('[data-close]');
    if (closeBtn) closeBtn.addEventListener('click', close);

    $('#setPreset').addEventListener('change', function (e) {
      var p = presets.find(function (x) { return x.id === e.target.value; });
      if (!p) return;
      $('#setSchool').value = p.school;
      $('#setSemester').value = p.semester;
      $('#setWeek1').value = p.week1;
      if (p.maxWeek) $('#setMaxWeek').value = p.maxWeek;
    });

    $('#addPeriod').addEventListener('click', function () {
      var rows = document.querySelectorAll('#periodRows tr');
      var start = '08:00';
      var end = '08:45';
      if (rows.length) {
        var lastEnd = rows[rows.length - 1].querySelector('.p-end').value || '08:45';
        start = addMinutes(lastEnd, 10);
        end = addMinutes(start, 45);
      }
      var tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td><input type="time" class="p-start" value="' + start + '"></td>' +
        '<td><input type="time" class="p-end" value="' + end + '"></td>' +
        '<td><button type="button" class="period-remove" aria-label="删除这一节">×</button></td>';
      $('#periodRows').appendChild(tr);
      renumberPeriods();
    });

    $('#periodRows').addEventListener('click', function (e) {
      var btn = e.target.closest('.period-remove');
      if (!btn) return;
      if (document.querySelectorAll('#periodRows tr').length <= 1) {
        toast('至少要保留一节', true);
        return;
      }
      btn.closest('tr').remove();
      renumberPeriods();
    });

    $('#syncNowBtn').addEventListener('click', function () {
      close(function () { startSync('manual'); });
    });

    ['setSyncOn', 'setKeepAlive'].forEach(function (id) {
      var box = document.getElementById(id);
      if (!box) return;
      box.addEventListener('change', function () {
        var wrap = box.closest('.sync-switch');
        if (wrap) wrap.classList.toggle('is-on', box.checked);
      });
    });

    var credSaveBtn = overlay.querySelector('#credSave');
    if (credSaveBtn) {
      credSaveBtn.addEventListener('click', function () {
        var u = document.getElementById('credUser').value.trim();
        var p = document.getElementById('credPass').value;
        if (!u || !p) { toast('填好学号和密码', true); return; }
        var ok = false;
        try { ok = window.AndroidBridge.saveCredentials(u, p); } catch (e) {}
        document.getElementById('credPass').value = '';
        if (ok) {
          document.getElementById('credStatus').textContent = '已保存 ' + u;
          toast('已保存，之后自动同步会自己登录');
        } else {
          toast('保存失败', true);
        }
      });
    }
    var credClearBtn = overlay.querySelector('#credClear');
    if (credClearBtn) {
      credClearBtn.addEventListener('click', function () {
        try { window.AndroidBridge.clearCredentials(); } catch (e) {}
        document.getElementById('credStatus').textContent = '未保存';
        toast('已清除保存的账号');
      });
    }

    $('#settingsImport').addEventListener('click', function () {
      close(function () {
        var btn = document.getElementById('importBtn');
        showImportStart(btn && btn.isConnected ? btn : null);
      });
    });

    $('#settingsIcs').addEventListener('click', function () {
      exportICS();
    });

    $('#settingsJson').addEventListener('click', function () {
      exportJSON();
    });

    $('#settingsRestore').addEventListener('click', function () {
      restoreJSONFile(function () { close(); });
    });

    $('#settingsReset').addEventListener('click', function () {
      if (!confirm('清空本机的课表和设置？这个操作不能撤销。')) return;
      localStorage.removeItem(STORAGE.data);
      localStorage.removeItem(STORAGE.settings);
      location.reload();
    });

    $('#settingsSavePreset').addEventListener('click', function () {
      var school = $('#setSchool').value.trim();
      var semester = $('#setSemester').value.trim();
      var week1 = $('#setWeek1').value;
      if (!school || !week1) {
        toast('先填写学校名称和第 1 周日期', true);
        return;
      }
      var custom = readJSON(STORAGE.presets) || [];
      if (!Array.isArray(custom)) custom = [];
      custom = custom.filter(function (p) { return !(p.school === school && p.semester === semester); });
      custom.push({
        id: 'my_' + Date.now(),
        school: school,
        semester: semester,
        week1: week1,
        maxWeek: parseInt($('#setMaxWeek').value, 10) || 20
      });
      writeJSON(STORAGE.presets, custom);
      toast('已保存，下次可在学校预设中选择');
    });

    $('#saveSettings').addEventListener('click', function () {
      var week1 = $('#setWeek1').value;
      if (!parseISODate(week1)) {
        toast('第 1 周日期格式不正确', true);
        return;
      }
      var periods = [];
      document.querySelectorAll('#periodRows tr').forEach(function (tr) {
        var start = tr.querySelector('.p-start').value;
        var end = tr.querySelector('.p-end').value;
        if (start && end) periods.push({ start: start, end: end });
      });
      if (!periods.length) {
        toast('至少需要一节作息时间', true);
        return;
      }
      var maxWeek = clamp(parseInt($('#setMaxWeek').value, 10) || 20, 1, 30);
      var oldWeek1 = state.settings.week1;
      var oldSync = state.settings.sync || {};
      var oldAuto = state.settings.autoImport || null;

      state.settings = {
        school: $('#setSchool').value.trim() || '我的学校',
        semester: $('#setSemester').value.trim(),
        week1: week1,
        maxWeek: maxWeek,
        periods: periods,
        student: {
          name: $('#setName').value.trim(),
          id: state.settings.student.id || '',
          className: $('#setClass').value.trim()
        },
        reminderDefault: parseInt($('#setReminder').value, 10) || 0,
        schema: state.settings.schema || 1,
        sync: {
          enabled: $('#setSyncOn').checked,
          keepAlive: $('#setKeepAlive').checked,
          weekday: parseInt($('#setSyncWeekday').value, 10) || 1,
          time: $('#setSyncTime').value || '07:00',
          lastAt: oldSync.lastAt || '',
          lastOk: oldSync.lastOk || '',
          lastNote: oldSync.lastNote || '',
          lastAttempt: oldSync.lastAttempt || ''
        },
        autoImport: oldAuto
      };

      writeJSON(STORAGE.settings, state.settings);
      scheduleNativeSync();
      state.week = oldWeek1 !== week1 ? getCurrentWeek() : clamp(state.week, 1, maxWeek);
      close();
      renderAll();
      syncPhoneReminders();
      toast('设置已保存');
    });
  }

  /* ---------------- import ---------------- */

  var SEED_SCHOOLS = [
    {
      id: 'seed-demo-eams',
      name: '示例大学',
      aliases: ['示例学院'],
      province: '示例省',
      system: 'EAMS',
      login: 'https://jw.example.edu.cn/eams/loginExt.action',
      builtin: true
    }
  ];

  function normSchoolName(v) {
    return String(v || '').replace(/\s+/g, '').replace(/[（）()·]/g, '').toLowerCase();
  }

  function normalizeLoginUrl(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (!/^https?:\/\//i.test(raw)) {
      if (/^[\w.-]+\.[a-z]{2,}/i.test(raw)) raw = 'https://' + raw;
      else return '';
    }
    try {
      var u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return raw;
    } catch (e) {
      return '';
    }
  }

  function detectSchoolSystem(name, login) {
    var n = normSchoolName(name);
    for (var i = 0; i < SEED_SCHOOLS.length; i++) {
      var seed = SEED_SCHOOLS[i];
      if (normSchoolName(seed.name) === n) return seed.system;
      for (var j = 0; j < (seed.aliases || []).length; j++) {
        if (normSchoolName(seed.aliases[j]) === n) return seed.system;
      }
    }
    var u = String(login || '').toLowerCase();
    if (!u) return '其他';
    if (u.indexOf('eams') >= 0) return 'EAMS';
    if (u.indexOf('jsxsd') >= 0 || u.indexOf('qiangzhi') >= 0) return '强智';
    if (u.indexOf('jwglxt') >= 0 || u.indexOf('zfxk') >= 0 || u.indexOf('zfsoft') >= 0 || u.indexOf('zfc') >= 0 || u.indexOf('home.aspx') >= 0) return '正方';
    if (u.indexOf('urp') >= 0) return 'URP';
    return '其他';
  }

  function loadCustomSchools() {
    var list = readJSON(STORAGE.schools);
    if (!Array.isArray(list)) return [];
    return list.filter(function (s) {
      return s && s.name && normalizeLoginUrl(s.login);
    }).map(function (s) {
      return {
        id: s.id || ('custom-' + normSchoolName(s.name)),
        name: String(s.name).trim(),
        province: String(s.province || '').trim(),
        system: String(s.system || '其他').trim() || '其他',
        login: normalizeLoginUrl(s.login),
        aliases: Array.isArray(s.aliases) ? s.aliases : [],
        builtin: false
      };
    });
  }

  function saveCustomSchools(list) {
    writeJSON(STORAGE.schools, list);
  }

  function allSchools() {
    var out = [];
    var seen = {};
    loadCustomSchools().forEach(function (s) {
      var k = normSchoolName(s.name);
      if (!k || seen[k]) return;
      seen[k] = true;
      out.push(s);
    });
    SEED_SCHOOLS.forEach(function (s) {
      var k = normSchoolName(s.name);
      if (!k || seen[k]) return;
      seen[k] = true;
      out.push(Object.assign({}, s, { builtin: true }));
    });
    var catalog = Array.isArray(window.SCHOOL_CATALOG) ? window.SCHOOL_CATALOG : [];
    catalog.forEach(function (s, i) {
      var k = normSchoolName(s.name);
      if (!k || seen[k]) return;
      seen[k] = true;
      out.push({
        id: 'catalog-' + i,
        name: String(s.name || '').trim(),
        province: String(s.province || '').trim(),
        city: String(s.city || '').trim(),
        level: String(s.level || '').trim(),
        system: String(s.system || '').trim(),
        login: normalizeLoginUrl(s.login),
        homepage: normalizeLoginUrl(s.homepage),
        office: normalizeLoginUrl(s.office),
        entryType: String(s.entryType || '').trim(),
        loginForm: String(s.loginForm || '').trim(),
        ssoTarget: String(s.ssoTarget || '').trim(),
        studentVerified: String(s.studentVerified || '').trim(),
        studentNote: String(s.studentNote || '').trim(),
        pageTitle: String(s.pageTitle || '').trim(),
        officeName: String(s.officeName || '').trim(),
        type: String(s.type || '').trim(),
        verified: String(s.verified || '').trim(),
        phone: String(s.phone || '').trim(),
        aliases: [],
        builtin: true,
        catalog: true
      });
    });
    return out;
  }

  function findAutoSchool(name) {
    var n = normSchoolName(name);
    if (!n) return null;
    var list = allSchools();
    for (var i = 0; i < list.length; i++) {
      var school = list[i];
      if (normSchoolName(school.name) === n) return school;
      for (var j = 0; j < (school.aliases || []).length; j++) {
        if (normSchoolName(school.aliases[j]) === n) return school;
      }
    }
    return null;
  }

  function searchAutoSchools(query) {
    var q = normSchoolName(query);
    return allSchools().filter(function (s) {
      if (!q) return true;
      if (normSchoolName(s.name).indexOf(q) >= 0) return true;
      if (normSchoolName(s.province).indexOf(q) >= 0) return true;
      if (normSchoolName(s.system).indexOf(q) >= 0) return true;
      return (s.aliases || []).some(function (a) { return normSchoolName(a).indexOf(q) >= 0; });
    });
  }

  function upsertCustomSchool(entry) {
    var name = String(entry && entry.name || '').trim();
    var login = normalizeLoginUrl(entry && entry.login);
    if (!name || !login) return false;
    var list = loadCustomSchools();
    var key = normSchoolName(name);
    var existing = null;
    for (var i = 0; i < list.length; i++) {
      if (normSchoolName(list[i].name) === key) { existing = list[i]; break; }
    }
    var next = {
      id: existing ? existing.id : ('custom-' + Date.now() + '-' + Math.floor(Math.random() * 1000)),
      name: name,
      province: String(entry.province || '').trim(),
      system: (String(entry.system || '').trim() && String(entry.system || '').trim() !== '自动') ? String(entry.system).trim() : detectSchoolSystem(name, login),
      login: login,
      aliases: existing && existing.aliases ? existing.aliases : []
    };
    if (existing) {
      list[list.indexOf(existing)] = next;
    } else {
      list.push(next);
    }
    saveCustomSchools(list);
    return next;
  }

  function removeCustomSchool(id) {
    var list = loadCustomSchools().filter(function (s) { return s.id !== id; });
    saveCustomSchools(list);
  }

  function exportSchoolLibrary() {
    var schools = allSchools().filter(function (s) { return !!s.login; }).map(function (s) {
      return {
        name: s.name,
        province: s.province || '',
        system: s.system || '其他',
        login: s.login,
        aliases: s.aliases || []
      };
    });
    saveTextFile('能猫课表-学校库-' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify({ version: 1, schools: schools }, null, 2), 'application/json;charset=utf-8');
    toast('已导出学校库');
  }

  function importSchoolLibraryFile(onDone) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var payload = JSON.parse(String(reader.result || ''));
          var items = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.schools) ? payload.schools : null);
          if (!items) throw new Error('学校库格式不正确');
          var added = 0;
          items.forEach(function (item) {
            if (!item || !item.name || !normalizeLoginUrl(item.login)) return;
            upsertCustomSchool(item);
            added++;
          });
          toast(added ? ('已导入 ' + added + ' 所学校') : '没有可导入的学校');
          if (onDone) onDone();
        } catch (e) {
          toast(e && e.message ? e.message : '学校库读取失败', true);
        }
      };
      reader.onerror = function () { toast('学校库读取失败', true); };
      reader.readAsText(file);
    });
    input.click();
  }

  function apkDownloadHTML(variant) {
    if (IS_ANDROID_APP) return '';
    if (variant === 'compact' && IS_IOS) return '';
    var href = APK_FILE + '?v=' + APK_VERSION;
    var head = '<div class="apk-card-head"><span class="apk-card-kicker">ANDROID / 安装版</span>' +
      '<b>能猫课表 ' + APK_VERSION + '</b>' +
      '<span class="apk-card-meta">' + APK_SIZE + ' · 安卓 7.0+</span></div>';
    var body = '<p>在应用内登录学校教务系统，登录后自动读取课表。课表仍只解析并保存在本机。</p>';
    var action;
    if (IS_IOS) {
      action = '<p class="apk-card-note">安装包只能装在安卓手机上。iPhone 请在 Safari 里点分享 → 添加到主屏幕；提醒可用「导出 .ics」交给系统日历。</p>';
    } else if (IS_WECHAT) {
      action = '<div class="apk-actions"><button type="button" class="btn primary" data-apk-copy>复制下载地址</button></div>' +
        '<p class="apk-card-note">微信内不能直接下载安装包：点右上角 ··· → 在浏览器打开本页，再点下载。</p>';
    } else {
      action = '<div class="apk-actions"><a class="btn primary" href="' + href + '" download="nengmao-kebiao-' + APK_VERSION + '.apk" type="application/vnd.android.package-archive">下载 APK</a></div>' +
        '<p class="apk-card-note">首次安装需在系统设置里允许「未知来源」。未上架应用商店，安装包由本页直接提供。</p>';
    }
    return '<div class="apk-card' + (variant === 'compact' ? ' is-compact' : '') + '">' + head + body + action + '</div>';
  }

  function apkAbsoluteURL() {
    try { return new URL(APK_FILE, location.href).href; } catch (e) { return APK_FILE; }
  }

  function copyApkLink() {
    var text = apkAbsoluteURL();
    var done = function () { toast('下载地址已复制，粘贴到浏览器打开'); };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      if (ok) done(); else toast('复制失败，请手动复制地址', true);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function importChoiceHTML() {
    var androidAuto = !!(window.AndroidBridge && window.AndroidBridge.startAutoImport);
    return '<div class="import-screen">' +
      '<div class="import-kicker">IMPORT / 选择导入方式</div>' +
      '<h3 class="import-title">课表怎么进来？</h3>' +
      '<p class="import-sub">自动导入先去学校教务系统登录；手动导入是完整的导出教程。</p>' +
      '<div class="import-choice">' +
        '<button type="button" class="import-option is-auto" data-import-choice="auto">' +
          '<span class="io-no">01</span>' +
          '<span class="io-body"><b>自动导入</b><small>' + (androidAuto ? '打开学校教务系统登录，登录后自动读取' : '打开学校教务系统登录，导出后回来选文件') + '</small></span>' +
          '<span class="io-arrow">→</span>' +
        '</button>' +
        '<button type="button" class="import-option is-manual" data-import-choice="manual">' +
          '<span class="io-no">02</span>' +
          '<span class="io-body"><b>手动导入</b><small>先看导出教程，再选择已经下载的 xlsx</small></span>' +
          '<span class="io-arrow">→</span>' +
        '</button>' +
      '</div>' +
      '<p class="import-privacy">' + (androidAuto ? '安卓版在应用内登录并自动读取课表；账号密码只输入到学校页面。' : '网页版为半自动：登录和导出在学校页面内完成；能猫课表不读取账号密码，课表仍只在本机解析。') + '</p>' +
      '<div class="import-actions"><button type="button" class="btn ghost" data-import-close>取消</button></div>' +
    '</div>';
  }

  function importManualHTML() {
    return '<div class="import-screen">' +
      '<button type="button" class="import-back" data-import-back>← 返回</button>' +
      '<div class="import-kicker">MANUAL / 手动导入</div>' +
      '<h3 class="import-title">从教务系统导出 xlsx</h3>' +
      '<div class="import-guide">' +
        '<div class="import-step"><div class="num">01</div><div>' +
          '<b>登录学校教务系统</b>' +
          '<span>用电脑或手机浏览器打开学校教务系统并登录。</span>' +
        '</div></div>' +
        '<div class="import-step"><div class="num">02</div><div>' +
          '<b>进入「我的课表」</b>' +
          '<span>找到“我的课表 / 课表查询 / 上课课表”等入口。</span>' +
        '</div></div>' +
        '<div class="import-step"><div class="num">03</div><div>' +
          '<b>点击「导出」并选择 xlsx</b>' +
          '<span>不同学校可能叫“下载 / 打印 / 导出课表”，保存为 .xlsx 或 .xls 即可。</span>' +
        '</div></div>' +
      '</div>' +
      '<div class="detail-note">拿到文件后回到能猫课表，点下方按钮选择刚导出的文件。课表只在本机解析，不会上传。<br>手机上也可以：用手机浏览器登录教务系统，把 xlsx 保存到“文件 / 下载”，再回来导入。</div>' +
      '<div class="import-actions"><button type="button" class="btn ghost" data-import-close>取消</button>' +
        '<button type="button" class="btn primary" data-select-file>选择已导出的 xlsx</button></div>' +
    '</div>';
  }

  function importAutoHTML(prefill) {
    return '<div class="import-screen">' +
      '<button type="button" class="import-back" data-import-back>← 返回</button>' +
      '<div class="import-kicker">AUTO / 自动导入</div>' +
      '<h3 class="import-title">先确认学校</h3>' +
      '<p class="import-sub">自动入口会打开学校自己的教务登录页；登录与密码输入都在学校页面内完成。</p>' +
      '<div class="field"><label for="autoSchool">学校名称</label>' +
        '<input id="autoSchool" value="' + esc(prefill || '') + '" placeholder="输入学校名称，例如：示例大学" autocomplete="organization">' +
      '</div>' +
      '<div class="school-suggest" id="autoSuggest"></div>' +
      '<div class="school-db-bar"><span id="autoDbCount">本地学校库</span>' +
        '<button type="button" class="school-manage-link" data-school-manage>管理 / 添加</button></div>' +
      '<p class="auto-school-hint">输入学校名匹配本地学校库；未收录可在下一步填写教务系统登录地址。</p>' +
      '<div class="import-actions"><button type="button" class="btn ghost" data-import-close>取消</button>' +
        '<button type="button" class="btn primary" data-auto-check>确认学校</button></div>' +
    '</div>';
  }

  function importAutoReadyHTML(school) {
    var androidAuto = !!(window.AndroidBridge && window.AndroidBridge.startAutoImport);
    var step2Title = androidAuto ? '进入「我的课表」' : '进入「我的课表」并导出';
    var step2Sub = androidAuto
      ? '登录后会自动读取课表；账号密码只输入到学校页面。'
      : '在教务系统内找到课表查询 / 我的课表，使用导出或下载得到 .xlsx 或 .xls。';
    var step3Title = androidAuto ? '回来确认导入' : '回来选择文件';
    var step3Sub = androidAuto
      ? '读取完成后会显示识别结果，确认后再覆盖当前课表。'
      : '点下方按钮选择刚导出的文件，解析仍在本机完成。';
    var sysLabel = school.system === 'EAMS' ? 'EAMS 教学综合管理系统' :
      (school.system === '统一身份认证' ? '统一身份认证入口' :
      (school.system && school.system !== '其他' && school.system !== '教务系统' ? school.system + ' 教务系统' : '学校教务系统'));
    var entryMeta = [school.entryType, school.loginForm].filter(Boolean).join(' · ');
    var loginLabel = (school.entryType && /SSO|统一/.test(school.entryType)) ? '打开统一认证入口' : '打开教务系统登录';
    return '<div class="import-screen">' +
      '<button type="button" class="import-back" data-auto-reset>← 换学校</button>' +
      '<div class="import-kicker">AUTO / ' + esc(school.system || '教务系统') + '</div>' +
      '<div class="auto-school"><b>' + esc(school.name) + '</b>' +
        '<span>' + esc(sysLabel) + '</span>' +
        (entryMeta ? '<small>' + esc(entryMeta) + '</small>' : '') +
        '<small>' + esc(school.login) + '</small></div>' +
      '<div class="import-guide">' +
        '<div class="import-step"><div class="num">01</div><div>' +
          '<b>在打开的系统里登录</b>' +
          '<span>学号、密码只输入到学校页面；能猫课表不读取、不保存账号密码。</span>' +
        '</div></div>' +
        '<div class="import-step"><div class="num">02</div><div>' +
          '<b>' + esc(step2Title) + '</b>' +
          '<span>' + esc(step2Sub) + '</span>' +
        '</div></div>' +
        '<div class="import-step"><div class="num">03</div><div>' +
          '<b>' + esc(step3Title) + '</b>' +
          '<span>' + esc(step3Sub) + '</span>' +
        '</div></div>' +
      '</div>' +
      '<a class="btn primary auto-login" href="' + school.login + '" target="_blank" rel="noopener" data-auto-login data-school-name="' + esc(school.name) + '" data-school-system="' + esc(school.system || '') + '">' + esc(loginLabel) + '</a>' +
      '<p class="auto-school-hint">' + (androidAuto ? '将打开应用内登录页，登录后自动读取课表；账号密码只输入到学校页面。' : '网页版受浏览器安全限制，不能读取学校页面内容；这是半自动流程。请在打开的登录页完成登录和导出。') + '</p>' +
      (androidAuto ? '' : apkDownloadHTML('compact')) +
      '<div class="import-actions"><button type="button" class="btn ghost" data-import-close>取消</button>' +
        '<button type="button" class="btn primary" data-select-file>我已导出，选择文件</button></div>' +
    '</div>';
  }

  function importAutoUnsupportedHTML(name) {
    var label = String(name || '').trim();
    return '<div class="import-screen">' +
      '<button type="button" class="import-back" data-auto-back>← 换学校</button>' +
      '<div class="import-kicker">AUTO / 未预置</div>' +
      '<h3 class="import-title">换一所学校</h3>' +
      '<p class="import-sub">' + (label ? '“' + esc(label) + '”' : '这个学校') +
        ' 还没有预置入口。填写学校教务系统的登录地址，仍然可以走同一套半自动流程；也可以改用完整的手动教程。</p>' +
      '<input type="hidden" id="autoUnsupportedSchool" value="' + esc(label) + '">' +
      '<div class="field"><label for="autoLoginUrl">教务系统登录地址</label>' +
        '<input id="autoLoginUrl" type="url" inputmode="url" placeholder="https://jw.example.edu.cn/login" autocomplete="url">' +
      '</div>' +
      '<div class="field"><label for="autoProvince">省份（可选）</label>' +
        '<input id="autoProvince" placeholder="例如：江苏" autocomplete="address-level1"></div>' +
      '<p class="auto-school-hint">填写学校教务系统首页或登录页地址即可；系统类型会自动识别。地址只在本机打开，不会上传；继续后会自动保存到学校库。</p>' +
      '<div class="import-actions"><button type="button" class="btn ghost" data-import-close>取消</button>' +
        '<button type="button" class="btn ghost" data-auto-manual>手动导入</button>' +
        '<button type="button" class="btn primary" data-auto-url>保存并继续</button></div>' +
    '</div>';
  }

  function importSchoolNeedsLoginHTML(school) {
    var place = [school.province, school.city].filter(Boolean).join(' · ');
    var type = school.type || '学校目录';
    var office = school.office || '';
    var home = school.homepage || '';
    var target = office || home;
    var targetLabel = office ? '打开教务处' : '打开学校官网';
    return '<div class="import-screen">' +
      '<button type="button" class="import-back" data-need-back>← 换学校</button>' +
      '<div class="import-kicker">AUTO / 待补登录地址</div>' +
      '<div class="auto-school"><b>' + esc(school.name) + '</b>' +
        '<span>' + esc([place, type].filter(Boolean).join(' · ')) + '</span>' +
        (school.officeName ? '<small>' + esc(school.officeName) + '</small>' : '') +
        (target ? '<small>' + esc(target) + '</small>' : '') + '</div>' +
      '<p class="import-sub">学校目录提供的是教务处 / 官网入口，不是统一的教务登录页。请从入口找到学校教务系统登录，或直接在那边登录导出；也可以把登录地址补到下面。</p>' +
      (target ? '<a class="btn ghost auto-login" href="' + esc(target) + '" target="_blank" rel="noopener" data-school-office>' + targetLabel + '</a>' : '') +
      '<input type="hidden" id="needSchoolName" value="' + esc(school.name) + '">' +
      '<input type="hidden" id="needSchoolProvince" value="' + esc(school.province || '') + '">' +
      '<div class="field"><label for="needLoginUrl">教务系统登录地址</label>' +
        '<input id="needLoginUrl" type="url" inputmode="url" placeholder="https://jw.example.edu.cn/login" autocomplete="url"></div>' +
      '<p class="auto-school-hint">系统类型会根据登录地址自动识别；保存后会加入你的本地学校库，地址只在本机打开，不会上传。</p>' +
      '<div class="import-actions"><button type="button" class="btn ghost" data-import-close>取消</button>' +
        '<button type="button" class="btn ghost" data-auto-manual>手动导入</button>' +
        '<button type="button" class="btn ghost" data-select-file>我已导出，直接选文件</button>' +
        '<button type="button" class="btn primary" data-need-login-set>保存登录地址并继续</button></div>' +
    '</div>';
  }

  function importSchoolManagerHTML() {
    var all = allSchools();
    var schools = all.filter(function (s) { return !!s.login; });
    var catalogCount = all.filter(function (s) { return !!s.catalog; }).length;
    var loginCount = schools.length;
    var rows = schools.map(function (s) {
      var meta = [s.province, s.level, s.system].filter(Boolean).join(' · ');
      return '<div class="school-row" data-school-pick="' + esc(s.id) + '" role="button" tabindex="0">' +
        '<div class="school-row-main"><b>' + esc(s.name) + '</b>' +
          '<span>' + esc(meta || '教务系统') + '</span>' +
          '<small>' + esc(s.login) + '</small></div>' +
        (s.builtin ? '<span class="school-builtin">内置</span>' :
          '<button type="button" class="school-del" data-school-del="' + esc(s.id) + '" aria-label="删除这所学校">×</button>') +
      '</div>';
    }).join('');
    return '<div class="import-screen">' +
      '<button type="button" class="import-back" data-school-back>← 返回</button>' +
      '<div class="import-kicker">LIBRARY / 本地学校库</div>' +
      '<h3 class="import-title">学校库</h3>' +
      '<p class="import-sub">本地共 ' + all.length + ' 所（学校目录 ' + catalogCount + ' 所）。这里列出已有登录入口的 ' + loginCount + ' 所；其余可在自动导入里搜索并补登录地址。</p>' +
      '<div class="school-db-actions">' +
        '<button type="button" class="btn ghost" data-school-import>导入学校库</button>' +
        '<button type="button" class="btn ghost" data-school-export>导出学校库</button>' +
      '</div>' +
      '<div class="school-list">' + rows + '</div>' +
      '<div class="school-add">' +
        '<h3>添加学校</h3>' +
        '<div class="field"><label for="libName">学校名称</label><input id="libName" placeholder="学校全名"></div>' +
        '<div class="field"><label for="libProvince">省份（可选）</label><input id="libProvince" placeholder="例如：江苏"></div>' +
        '<div class="field"><label for="libLogin">教务系统登录地址</label><input id="libLogin" type="url" inputmode="url" placeholder="https://jw.example.edu.cn/login"></div>' +
        '<p class="auto-school-hint">系统类型会根据学校名和登录地址自动识别。</p>' +
        '<div class="import-actions"><button type="button" class="btn primary" data-school-add>保存到学校库</button></div>' +
      '</div>' +
      '<div class="import-actions"><button type="button" class="btn ghost" data-import-close>关闭</button></div>' +
    '</div>';
  }

  function showImportStart(trigger) {
    var presets = state.settings && state.settings.school ? state.settings.school : '';
    var modal = openModal({
      title: '导入课表',
      sub: '选择自动或手动导入',
      body: importChoiceHTML(),
      trigger: trigger || null,
      shutter: !!trigger,
      shutterKind: 'import',
      shutterDock: 18,
      shutterMeta: '自动登录学校教务，或按教程手动导出 xlsx',
      ariaTitle: '导入课表'
    });
    var overlay = modal.overlay;
    if (!overlay) return;
    var bodyEl = overlay.querySelector('.modal-body');
    var sheetEl = overlay.querySelector('.modal');
    if (!bodyEl) return;

    function setMeta(text) {
      var meta = document.querySelector('.shutter-source .ss-meta');
      if (meta) meta.textContent = text;
    }

    function render(html, meta) {
      bodyEl.innerHTML = html;
      setMeta(meta);
      if (sheetEl) sheetEl.scrollTop = 0;
    }

    function showChoice() {
      render(importChoiceHTML(), '自动登录学校教务，或按教程手动导出 xlsx');
    }

    function showManual() {
      render(importManualHTML(), '手动导入 · 先导出 xlsx');
    }

    function urlHost(value) {
      try { return new URL(value).host; } catch (e) { return value; }
    }

    function renderSuggestions(query) {
      var box = overlay.querySelector('#autoSuggest');
      if (!box) return;
      var all = allSchools();
      var count = overlay.querySelector('#autoDbCount');
      if (count) count.textContent = '本地学校库 · ' + all.length + ' 所';
      var q = String(query || '').trim();
      var list = searchAutoSchools(q);
      var shown = list.slice(0, q ? 6 : 3);
      if (!shown.length) {
        box.innerHTML = q ? ('<div class="school-suggest-empty">学校库里还没有“' + esc(q) + '”，确认后会让你填写登录地址。</div>') : '';
        return;
      }
      box.innerHTML = shown.map(function (school) {
        var meta = [school.province, school.level, school.system || school.type || (school.catalog ? '学校目录' : '教务系统')].filter(Boolean).join(' · ');
        var host = school.login || school.office || school.homepage || '';
        return '<button type="button" class="school-suggest-item" data-school-pick="' + esc(school.id) + '">' +
          '<b>' + esc(school.name) + '</b>' +
          '<span>' + esc(meta) + '</span>' +
          (host ? '<small>' + esc(urlHost(host)) + '</small>' : '') +
        '</button>';
      }).join('');
    }

    function showManager() {
      render(importSchoolManagerHTML(), '学校库 · 本地保存');
    }

    function pickSchool(id) {
      var school = allSchools().find(function (x) { return x.id === id; });
      if (!school) return;
      if (!school.login) { showNeedsLogin(school); return; }
      render(importAutoReadyHTML(school), '自动导入 · ' + (school.system === 'EAMS' ? 'EAMS 登录' : '教务系统'));
    }

    function showNeedsLogin(school) {
      render(importSchoolNeedsLoginHTML(school), '自动导入 · 补登录地址');
    }

    function showAuto(prefill, focus) {
      render(importAutoHTML(prefill), '自动导入 · 先确认学校');
      renderSuggestions(prefill || '');
      if (focus) {
        var field = overlay.querySelector('#autoSchool');
        if (field) { field.focus(); field.select(); }
      }
    }

    function showUnsupported(name) {
      render(importAutoUnsupportedHTML(name), '自动导入 · 填写登录地址');
    }

    function checkSchool() {
      var input = overlay.querySelector('#autoSchool');
      var name = input ? input.value : '';
      var school = findAutoSchool(name);
      if (school) {
        if (school.login) render(importAutoReadyHTML(school), '自动导入 · ' + (school.system === 'EAMS' ? 'EAMS 登录' : '教务系统'));
        else showNeedsLogin(school);
      } else showUnsupported(name);
    }

    function continueWithUrl() {
      var nameEl = overlay.querySelector('#autoUnsupportedSchool');
      var urlEl = overlay.querySelector('#autoLoginUrl');
      var provinceEl = overlay.querySelector('#autoProvince');
      var name = nameEl ? nameEl.value.trim() : '';
      var raw = urlEl ? urlEl.value.trim() : '';
      if (!raw) { toast('请填写教务系统登录地址', true); return; }
      var login = normalizeLoginUrl(raw);
      if (!login) { toast('请填写以 http:// 或 https:// 开头的地址', true); return; }
      var saved = upsertCustomSchool({
        name: name || '我的学校',
        province: provinceEl ? provinceEl.value.trim() : '',
        login: login
      });
      if (!saved) { toast('学校名称或地址不完整', true); return; }
      toast('已保存到学校库：' + saved.name);
      render(importAutoReadyHTML(saved), '自动导入 · 其他教务');
    }

    bodyEl.addEventListener('click', function (e) {
      var choice = e.target.closest('[data-import-choice]');
      if (choice) {
        if (choice.getAttribute('data-import-choice') === 'auto') showAuto(presets, false);
        else showManual();
        return;
      }
      if (e.target.closest('[data-import-back]')) { showChoice(); return; }
      if (e.target.closest('[data-auto-reset]')) { showAuto('', true); return; }
      if (e.target.closest('[data-auto-check]')) { checkSchool(); return; }
      if (e.target.closest('[data-auto-back]')) {
        var backName = overlay.querySelector('#autoUnsupportedSchool');
        showAuto(backName ? backName.value : '', true);
        return;
      }
      if (e.target.closest('[data-need-back]')) {
        var needName = overlay.querySelector('#needSchoolName');
        showAuto(needName ? needName.value : '', true);
        return;
      }
      if (e.target.closest('[data-need-login-set]')) {
        var nn = overlay.querySelector('#needSchoolName');
        var np = overlay.querySelector('#needSchoolProvince');
        var nu = overlay.querySelector('#needLoginUrl');
        var saved = upsertCustomSchool({
          name: nn ? nn.value : '',
          province: np ? np.value : '',
          login: nu ? nu.value : ''
        });
        if (!saved) { toast('请填写正确的教务系统登录地址', true); return; }
        toast('已保存到学校库：' + saved.name);
        render(importAutoReadyHTML(saved), '自动导入 · 其他教务');
        return;
      }
      if (e.target.closest('[data-auto-url]')) { continueWithUrl(); return; }
      if (e.target.closest('[data-auto-manual]')) { showManual(); return; }
      var del = e.target.closest('[data-school-del]');
      if (del) {
        removeCustomSchool(del.getAttribute('data-school-del'));
        showManager();
        toast('已从学校库删除');
        return;
      }
      var pick = e.target.closest('[data-school-pick]');
      if (pick) { pickSchool(pick.getAttribute('data-school-pick')); return; }
      if (e.target.closest('[data-school-manage]')) { showManager(); return; }
      if (e.target.closest('[data-school-back]')) { showAuto('', true); return; }
      if (e.target.closest('[data-school-export]')) { exportSchoolLibrary(); return; }
      if (e.target.closest('[data-school-import]')) { importSchoolLibraryFile(showManager); return; }
      if (e.target.closest('[data-school-add]')) {
        var nEl = overlay.querySelector('#libName');
        var pEl = overlay.querySelector('#libProvince');
        var uEl = overlay.querySelector('#libLogin');
        var added = upsertCustomSchool({
          name: nEl ? nEl.value : '',
          province: pEl ? pEl.value : '',
          login: uEl ? uEl.value : ''
        });
        if (!added) { toast('请填写学校名称和正确的登录地址', true); return; }
        showManager();
        toast('已保存到学校库');
        return;
      }
      if (e.target.closest('[data-import-close]')) { modal.close(); return; }
      if (e.target.closest('[data-select-file]')) {
        modal.close();
        $('#fileInput').click();
        return;
      }
      var login = e.target.closest('[data-auto-login]');
      if (login) {
        var href = login.getAttribute('href') || '';
        var sys = login.getAttribute('data-school-system') || '';
        var schoolName = login.getAttribute('data-school-name') || '';
        var autoSys = /^(EAMS|正方|强智|青果|URP|统一身份认证)$/.test(sys) ||
            /(eams|jwglxt|jsxsd|urp)/i.test(sys + ' ' + href);
        if (window.AndroidBridge && typeof window.AndroidBridge.startAutoImport === 'function' && autoSys) {
          e.preventDefault();
          modal.close();
          state.settings.autoImport = { loginUrl: href, school: schoolName, system: sys || '其他' };
          writeJSON(STORAGE.settings, state.settings);
          try { window.AndroidBridge.startAutoImport(href, schoolName, sys || '其他'); } catch (err) { toast('无法启动自动导入', true); }
          return;
        }
        if (window.AndroidBridge && typeof window.AndroidBridge.openExternal === 'function') {
          e.preventDefault();
          try { window.AndroidBridge.openExternal(href); } catch (err) {}
        }
        return;
      }
    });

    bodyEl.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'autoSchool') renderSuggestions(e.target.value);
    });

    bodyEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.id === 'autoSchool') {
        e.preventDefault();
        checkSchool();
      }
      if (e.key === 'Enter' && e.target && e.target.id === 'autoLoginUrl') {
        e.preventDefault();
        continueWithUrl();
      }
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      if (file.arrayBuffer) {
        file.arrayBuffer().then(resolve, reject);
        return;
      }
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('读取文件失败')); };
      reader.readAsArrayBuffer(file);
    });
  }

  function handleFile(file) {
    var name = file.name || '';
    if (!/\.(xlsx|xls)$/i.test(name)) {
      toast('请选择 .xlsx 或 .xls 文件', true);
      return;
    }
    toast('正在解析 ' + name + ' …');
    readFileAsArrayBuffer(file).then(function (buf) {
      var parsed = TTParser.parseWorkbook(buf, name);
      showImportPreview(parsed);
    }).catch(function (err) {
      showError('导入失败', err && err.message ? err.message : '无法读取这个文件。');
    });
  }

  function showImportPreview(parsed) {
    var stats = parsed.stats;
    var meta = parsed.meta || {};
    var sample = parsed.blocks.slice(0, 8);
    var rows = sample.map(function (b) {
      return '<div class="preview-row">' +
        '<div class="pr-name">' + esc(b.name) + '</div>' +
        '<div class="pr-meta">' + WEEK_NAMES[b.day] + ' · 第 ' + b.startPeriod + (b.endPeriod !== b.startPeriod ? '–' + b.endPeriod : '') + ' 节' + (b.room ? ' · ' + esc(b.room) : '') + (b.section ? ' · ' + esc(b.section) : '') + '</div>' +
        '<div class="pr-weeks">' + esc(formatWeeks(b.weeks)) + (b.credits ? ' · ' + esc(b.credits) + ' 学分' : '') + '</div>' +
        '</div>';
    }).join('');

    var metaBits = [];
    if (meta.semester) metaBits.push(meta.semester);
    if (meta.studentName) metaBits.push(meta.studentName);
    if (meta.className) metaBits.push(meta.className);
    if (meta.totalCredits) metaBits.push('总学分 ' + meta.totalCredits);
    if (parsed.fileName) metaBits.push(parsed.fileName);
    if (parsed.sheetName) metaBits.push('工作表：' + parsed.sheetName);

    var warn = parsed.warnings && parsed.warnings.length
      ? '<div class="warn-list"><b>解析提示</b>' + parsed.warnings.slice(0, 8).map(esc).join('<br>') + '</div>'
      : '';

    var body = '<div class="stat-grid">' +
      '<div class="stat"><b>' + stats.blocks + '</b><span>课程块</span></div>' +
      '<div class="stat"><b>' + stats.courses + '</b><span>课程</span></div>' +
      '<div class="stat"><b>' + stats.practice + '</b><span>实践时段</span></div>' +
      '<div class="stat"><b>' + stats.actualMaxWeek + '</b><span>最晚周次</span></div>' +
      '</div>' +
      (metaBits.length ? '<div class="preview-meta">' + esc(metaBits.join(' · ')) + '</div>' : '') +
      warn +
      '<div class="preview-list">' + rows + '</div>' +
      '<div class="detail-note">当前第 1 周日期：' + esc(state.settings.week1) +
      '（第 ' + getCurrentWeek() + ' 周）。如果学校开学时间不同，导入后到“设置”里改一下即可。</div>';

    var modal = openModal({
      title: '识别结果',
      sub: '确认无误后再导入',
      body: body,
      wide: true,
      footer: '<button type="button" class="btn ghost" data-close>取消</button>' +
        '<button type="button" class="btn primary" id="confirmImport">导入并覆盖</button>'
    });

    modal.overlay.querySelector('[data-close]').addEventListener('click', modal.close);
    modal.overlay.querySelector('#confirmImport').addEventListener('click', function () {
      state.data = parsed;
      if (meta.semester) state.settings.semester = meta.semester;
      if (meta.studentName) state.settings.student.name = meta.studentName;
      if (meta.className) state.settings.student.className = meta.className;
      if (meta.studentId) state.settings.student.id = meta.studentId;
      state.settings.maxWeek = Math.max(20, stats.maxWeek || 20);
      state.week = getCurrentWeek();
      state.day = todayWeekday();
      state.view = 'today';
      writeJSON(STORAGE.settings, state.settings);
      writeJSON(STORAGE.data, state.data);
      recordSync(true, '手动导入 ' + stats.blocks + ' 个课程块');
      modal.close();
      showApp();
      renderAll();
      syncPhoneReminders();
      toast('已导入 ' + stats.blocks + ' 个课程块');
    });
  }

  function buildAutoParsed(payload) {
    var data = payload;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { data = null; }
    }
    var courses = data && data.courses ? data.courses : [];
    if (!Array.isArray(courses) || !courses.length) {
      toast('自动导入没有抓到课程', true);
      return null;
    }
    var blocks = [];
    var names = {};
    var minWeek = 99;
    var maxWeek = 1;
    courses.forEach(function (c, idx) {
      if (!c) return;
      var day = clamp(parseInt(c.day, 10), 1, 7);
      var start = clamp(parseInt(c.startPeriod, 10), 1, 20);
      var end = clamp(parseInt(c.endPeriod, 10), start, 20);
      var weeks = Array.isArray(c.weeks) ? c.weeks.map(function (w) { return parseInt(w, 10); }).filter(function (w) { return w >= 1 && w <= 60; }) : [];
      weeks = weeks.filter(function (w, i, arr) { return arr.indexOf(w) === i; }).sort(function (a, b) { return a - b; });
      if (!day || !start || !end || !weeks.length) return;
      minWeek = Math.min(minWeek, weeks[0]);
      maxWeek = Math.max(maxWeek, weeks[weeks.length - 1]);
      var name = String(c.name || '未命名课程').trim();
      names[name] = 1;
      var section = String(c.section || c.code || '');
      var courseCode = String(c.courseCode || section.split('.')[0] || '');
      blocks.push({
        id: 'auto_eams_' + idx + '_' + day + '_' + start,
        name: name,
        code: courseCode,
        section: section,
        courseCode: courseCode,
        teacher: String(c.teacher || ''),
        day: day,
        startPeriod: start,
        endPeriod: end,
        weeks: weeks,
        weeksUnknown: false,
        room: String(c.room || ''),
        campus: String(c.campus || ''),
        credits: String(c.credits || ''),
        note: String(c.note || ''),
        raw: '',
        source: 'eams'
      });
    });
    if (!blocks.length) {
      toast('抓到课表页，但没有解析到课程', true);
      return null;
    }
    var catalog = (Array.isArray(data.catalog) ? data.catalog : []).map(function (x) {
      x = x || {};
      return {
        name: String(x.name || ''),
        code: String(x.code || ''),
        section: String(x.section || ''),
        teacher: String(x.teacher || ''),
        credits: String(x.credits || ''),
        note: String(x.note || '')
      };
    }).filter(function (x) { return !!x.name; });
    if (!catalog.length) {
      var seenCat = {};
      blocks.forEach(function (b) {
        var key = b.section || b.courseCode || b.name;
        if (seenCat[key]) return;
        seenCat[key] = 1;
        catalog.push({
          name: b.name,
          code: b.courseCode || '',
          section: b.section || '',
          teacher: b.teacher || '',
          credits: b.credits || '',
          note: b.note || ''
        });
      });
    }
    var creditSum = 0;
    var hasCredit = false;
    catalog.forEach(function (x) {
      var v = parseFloat(x.credits);
      if (!isNaN(v)) { creditSum += v; hasCredit = true; }
    });
    var catalogByKey = {};
    catalog.forEach(function (x) {
      if (x.section) catalogByKey[x.section] = x;
      if (x.code && !catalogByKey[x.code]) catalogByKey[x.code] = x;
    });
    blocks.forEach(function (b) {
      var hit = catalogByKey[b.section] || catalogByKey[b.courseCode];
      if (!hit) return;
      if (!b.credits && hit.credits) b.credits = hit.credits;
      if (!b.note && hit.note) b.note = hit.note;
    });

    var stats = {
      blocks: blocks.length,
      courses: catalog.length || Object.keys(names).length,
      practice: 0,
      minWeek: minWeek === 99 ? 1 : minWeek,
      maxWeek: maxWeek,
      actualMaxWeek: maxWeek
    };
    var srcMeta = data.meta || {};
    var parsed = {
      meta: {
        semester: srcMeta.semester || state.settings.semester || '',
        studentName: srcMeta.studentName || state.settings.student.name || '',
        studentId: srcMeta.studentId || state.settings.student.id || '',
        className: srcMeta.className || state.settings.student.className || '',
        totalCredits: srcMeta.totalCredits ? String(srcMeta.totalCredits) :
          (hasCredit ? String(Math.round(creditSum * 10) / 10) : ''),
        title: data.title || '学校自动抓取课表'
      },
      blocks: blocks,
      practice: [],
      catalog: catalog,
      warnings: [
        '从学校课表页面自动抓取，请核对周次、节次、教室与作息。',
        '学分、备注只有课表页提供时才会带出；缺失时可在课程详情里补。',
        '确认后会覆盖当前课表；备注会按课程重新对应。'
      ],
      stats: stats,
      fileName: '自动导入 · ' + (data.system || '教务系统'),
      sheetName: data.system || '自动导入'
    };
    return parsed;
  }

  /* ---------- 每周自动同步 ---------- */

  function syncConfig() {
    return state.settings.sync || {};
  }

  function nextSyncSlot(from) {
    var cfg = syncConfig();
    var wd = clamp(parseInt(cfg.weekday, 10) || 1, 1, 7);
    var parts = String(cfg.time || '07:00').split(':');
    var hh = clamp(parseInt(parts[0], 10) || 0, 0, 23);
    var mm = clamp(parseInt(parts[1], 10) || 0, 0, 59);
    var d = new Date(from.getTime());
    var diff = ((wd % 7) - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + diff);
    d.setHours(hh, mm, 0, 0);
    if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 7);
    return d;
  }

  function syncOverdue() {
    var cfg = syncConfig();
    if (!cfg.enabled) return false;
    if (!cfg.lastAt) return true;
    var last = new Date(cfg.lastAt);
    if (isNaN(last.getTime())) return true;
    return Date.now() - last.getTime() > 6.5 * 86400000;
  }

  function fmtSyncAt(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '还没同步过';
    return (d.getMonth() + 1) + '.' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function recordSync(ok, note) {
    var cfg = state.settings.sync;
    cfg.lastAt = new Date().toISOString();
    cfg.lastOk = ok ? 'ok' : 'fail';
    cfg.lastNote = note || '';
    writeJSON(STORAGE.settings, state.settings);
  }

  function scheduleNativeSync() {
    if (!window.AndroidBridge || typeof window.AndroidBridge.scheduleSync !== 'function') return;
    var cfg = syncConfig();
    try {
      window.AndroidBridge.scheduleSync(JSON.stringify({
        enabled: !!cfg.enabled,
        weekday: clamp(parseInt(cfg.weekday, 10) || 1, 1, 7),
        time: cfg.time || '07:00'
      }));
    } catch (e) {}
    if (typeof window.AndroidBridge.scheduleKeepAlive === 'function') {
      var auto = state.settings.autoImport;
      try {
        window.AndroidBridge.scheduleKeepAlive(
          auto ? keepAliveUrl(auto.loginUrl) : '',
          !!cfg.enabled && cfg.keepAlive !== false && !!auto
        );
      } catch (e) {}
    }
  }

  function keepAliveUrl(loginUrl) {
    if (!loginUrl) return '';
    return String(loginUrl).replace(/login(Ext)?\.action.*$/i, 'courseTableForStd.action');
  }

  function startSync(mode) {
    var cfg = state.settings.autoImport;
    if (!cfg || !cfg.loginUrl) {
      var ibtn = document.getElementById('importBtn');
      showImportStart(ibtn && ibtn.isConnected ? ibtn : null);
      toast('选一次学校完成导入，之后每周自动同步');
      return false;
    }
    state.settings.sync.lastAttempt = new Date().toISOString();
    writeJSON(STORAGE.settings, state.settings);
    if (window.AndroidBridge && typeof window.AndroidBridge.startAutoSync === 'function') {
      try {
        window.AndroidBridge.startAutoSync(cfg.loginUrl, cfg.school || '', cfg.system || '', mode || 'sync');
        return true;
      } catch (e) {
        toast('无法启动同步', true);
        return false;
      }
    }
    if (window.AndroidBridge && typeof window.AndroidBridge.startAutoImport === 'function') {
      try {
        window.AndroidBridge.startAutoImport(cfg.loginUrl, cfg.school || '', cfg.system || '', mode || 'sync');
        return true;
      } catch (e) {
        toast('无法启动同步', true);
        return false;
      }
    }
    toast('网页版没有后台同步，请用安卓版自动同步', true);
    return false;
  }

  function teacherKey(v) {
    return String(v || '').split(/[,，、;；\s]+/).filter(Boolean).sort().join(',');
  }

  function syncKeyOf(b) {
    return String(b.section || b.courseCode || b.name || '') + '|' + b.day + '|' + b.startPeriod;
  }

  function applyAutoSyncData(parsed) {
    var oldList = (state.data && state.data.blocks) || [];
    var oldMap = {};
    oldList.forEach(function (b) {
      var k = syncKeyOf(b);
      if (!oldMap[k]) oldMap[k] = [];
      oldMap[k].push(b);
    });
    var used = {};
    var added = 0, changed = 0;
    var firstDiff = '';
    parsed.blocks.forEach(function (nb) {
      var list = oldMap[syncKeyOf(nb)] || [];
      var ob = null;
      var bestScore = -1;
      for (var i = 0; i < list.length; i++) {
        var cand = list[i];
        if (used[cand.id]) continue;
        var score = 0;
        if (String(cand.room) === String(nb.room)) score += 4;
        if (String(cand.teacher || '') === String(nb.teacher || '')) score += 4;
        if ((cand.weeks || []).join(',') === (nb.weeks || []).join(',')) score += 2;
        if (cand.endPeriod === nb.endPeriod) score += 1;
        if (score > bestScore) { bestScore = score; ob = cand; }
      }
      if (ob) {
        nb.id = ob.id;
        used[ob.id] = 1;
        var sameTeacher = teacherKey(ob.teacher) === teacherKey(nb.teacher);
        if (sameTeacher && nb.teacher !== ob.teacher) nb.teacher = ob.teacher;
        var diff = '';
        if (String(ob.room) !== String(nb.room)) diff = '教室 ' + (ob.room || '—') + '→' + (nb.room || '—');
        else if (!sameTeacher) diff = '教师改为 ' + (nb.teacher || '—');
        else if (ob.endPeriod !== nb.endPeriod) diff = '节次改为 ' + nb.startPeriod + '–' + nb.endPeriod;
        else if ((ob.weeks || []).join(',') !== (nb.weeks || []).join(',')) diff = '周次变了';
        if (diff) {
          changed++;
          if (!firstDiff) firstDiff = nb.name + ' ' + diff;
        }
      } else {
        nb.id = 'auto_' + nb.day + '_' + nb.startPeriod + '_' + added;
        added++;
      }
    });
    var removed = 0;
    oldList.forEach(function (ob) {
      if (!used[ob.id]) removed++;
    });

    var validIds = {};
    parsed.blocks.forEach(function (b) { validIds[b.id] = 1; });
    parsed.practice = (state.data && state.data.practice) || [];
    parsed.adjustments = ((state.data && state.data.adjustments) || []).filter(function (a) {
      return validIds[a.blockId];
    });
    parsed.syncLog = ((state.data && state.data.syncLog) || []).slice(-4).concat([{
      at: new Date().toISOString(),
      added: added,
      removed: removed,
      changed: changed
    }]);
    state.data = parsed;
    writeJSON(STORAGE.data, state.data);

    var note = added || removed || changed
      ? '新增 ' + added + ' · 调整 ' + changed + ' · 移除 ' + removed + (firstDiff ? '（' + firstDiff + '）' : '')
      : '无变化';
    recordSync(true, note);
    renderAll();
    syncPhoneReminders();
    toast('本周课表已同步 · ' + note);
  }

  function importAutoCourses(payload, mode) {
    var parsed = buildAutoParsed(payload);
    if (!parsed) return;
    if (mode === 'sync' && state.data && state.data.blocks && state.data.blocks.length) {
      applyAutoSyncData(parsed);
      return;
    }
    showImportPreview(parsed);
  }
  window.importAutoCourses = importAutoCourses;
  window.__forceSync = function () {
    startSync('sync');
  };

  function showError(title, message) {
    var body = '<p style="margin:0 0 12px;font-size:14px;line-height:1.7">' + esc(message) + '</p>' +
      '<div class="detail-note">可以试试：<br>1. 确认文件是学校导出的课程表，而不是截图或 PDF；<br>2. 用 Excel 打开后“另存为”新的 .xlsx；<br>3. 确认表头里有“星期一”到“星期日”，或者包含课程名称、星期、节次的列表。</div>';
    var modal = openModal({
      title: esc(title),
      body: body,
      footer: '<button type="button" class="btn primary" data-close>知道了</button>'
    });
    modal.overlay.querySelector('[data-close]').addEventListener('click', modal.close);
  }

  /* ---------------- demo ---------------- */

  var demoCounter = 0;
  function mkBlock(name, code, teacher, day, start, end, weeks, room, campus, credits) {
    demoCounter++;
    return {
      id: 'b_demo_' + demoCounter,
      name: name,
      code: code,
      section: code,
      teacher: teacher,
      day: day,
      startPeriod: start,
      endPeriod: end,
      weeks: weeks,
      weeksUnknown: false,
      room: room,
      campus: campus,
      credits: credits || '',
      source: 'demo'
    };
  }

  function mkPractice(name, code, teacher, weeks, allWeek, day, start, end, credits) {
    demoCounter++;
    return {
      id: 'p_demo_' + demoCounter,
      name: name,
      code: code,
      section: code,
      teacher: teacher,
      credits: credits || '',
      weeks: weeks,
      allWeek: allWeek,
      day: allWeek ? null : day,
      startPeriod: allWeek ? null : start,
      endPeriod: allWeek ? null : end,
      raw: ''
    };
  }

  function loadDemo() {
    demoCounter = 0;
    var weeksMain = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    var weeksLong = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
    var blocks = [
      mkBlock('高等数学', 'DEMO-01', '王老师', 1, 1, 2, weeksMain, '教学楼A101', '主校区', '4'),
      mkBlock('大学英语', 'DEMO-02', '李老师', 1, 5, 6, weeksLong, '教学楼B203', '主校区', '3'),
      mkBlock('程序设计基础', 'DEMO-03', '陈老师', 1, 7, 8, weeksLong, '计算机楼C302', '主校区', '3'),
      mkBlock('大学体育', 'DEMO-04', '刘老师', 2, 1, 2, weeksLong, '田径场', '主校区', '1'),
      mkBlock('机械制图', 'DEMO-05', '赵老师', 2, 3, 4, weeksMain, '工程楼B315', '主校区', '3'),
      mkBlock('高等数学', 'DEMO-01', '王老师', 3, 1, 2, weeksMain, '教学楼A101', '主校区', '4'),
      mkBlock('大学物理', 'DEMO-06', '周老师', 3, 3, 4, weeksMain, '实验楼A210', '主校区', '3'),
      mkBlock('思想道德与法治', 'DEMO-07', '吴老师', 3, 5, 6, weeksLong, '教学楼C201', '主校区', '3'),
      mkBlock('大学英语', 'DEMO-02', '李老师', 4, 1, 2, weeksLong, '教学楼B203', '主校区', '3'),
      mkBlock('大学体育', 'DEMO-04', '刘老师', 4, 3, 4, weeksLong, '田径场', '主校区', '1'),
      mkBlock('程序设计基础', 'DEMO-03', '陈老师', 4, 7, 8, weeksLong, '计算机楼C302', '主校区', '3'),
      mkBlock('高等数学', 'DEMO-01', '王老师', 5, 1, 2, weeksMain, '教学楼A101', '主校区', '4'),
      mkBlock('人工智能基础', 'DEMO-08', '郑老师', 5, 5, 6, weeksMain, '计算机楼C101', '主校区', '2'),
      mkBlock('军事理论', 'DEMO-09', '孙老师', 5, 9, 11, weeksMain, '教学楼A312', '主校区', '1.5')
    ];
    var practice = [
      mkPractice('入学教育', 'DEMO-P1', '', [2], true, null, null, null, '1'),
      mkPractice('军事训练', 'DEMO-P2', '', [3, 4], true, null, null, null, '2'),
      mkPractice('劳动实践', 'DEMO-P3', '陈老师', [5], false, 6, 1, 11, '0.5'),
      mkPractice('课程设计', 'DEMO-P4', '赵老师', [18], false, 1, 1, 4, '1'),
      mkPractice('专业实践', 'DEMO-P5', '陈老师', [20], true, null, null, null, '1')
    ];

    state.data = {
      meta: {
        title: '个人课程表',
        semester: '2026-2027学年第一学期',
        studentName: '示例同学',
        studentId: '',
        className: '默认班级',
        fileName: '示例课表',
        sheetName: '示例'
      },
      blocks: blocks,
      practice: practice,
      catalog: [],
      warnings: [],
      stats: {
        blocks: blocks.length,
        courses: 14,
        practice: practice.length,
        minWeek: 2,
        maxWeek: 20,
        actualMaxWeek: 20
      }
    };

    state.settings.semester = '2026-2027学年第一学期';
    state.settings.week1 = state.settings.week1 || '2026-08-31';
    state.settings.maxWeek = Math.max(20, state.settings.maxWeek || 20);
    state.settings.student.name = '示例同学';
    state.settings.student.className = '默认班级';

    writeJSON(STORAGE.settings, state.settings);
    writeJSON(STORAGE.data, state.data);
    state.week = getCurrentWeek();
    state.day = todayWeekday();
    state.view = 'today';
    showApp();
    renderAll();
    syncPhoneReminders();
    toast('示例课表已载入');
  }

  /* ---------------- export ---------------- */

  function icsEscape(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  function icsDate(date, hhmm) {
    return '' + date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate()) +
      'T' + String(hhmm).replace(':', '') + '00';
  }

  function icsDateOnly(date) {
    return '' + date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate());
  }

  function icsStamp() {
    var d = new Date();
    return '' + d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
      'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
  }

  function foldLine(line) {
    if (typeof TextEncoder === 'undefined') return line;
    var enc = new TextEncoder();
    var out = [];
    var cur = '';
    var bytes = 0;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      var b = enc.encode(ch).length;
      if (bytes + b > 73 && cur) {
        out.push(cur);
        cur = ' ' + ch;
        bytes = 1 + b;
      } else {
        cur += ch;
        bytes += b;
      }
    }
    out.push(cur);
    return out.join('\r\n');
  }

  function saveTextFile(filename, text, mime) {
    if (window.AndroidBridge && typeof window.AndroidBridge.saveFile === 'function') {
      try {
        window.AndroidBridge.saveFile(filename, text, mime);
        return;
      } catch (e) {}
    }
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  }

  function exportICS() {
    if (!state.data) {
      toast('还没有课表可以导出', true);
      return;
    }
    var s = state.settings;
    var maxWeek = s.maxWeek || 20;
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Timetable//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + icsEscape('能猫课表 · ' + (s.semester || '')),
      'X-WR-TIMEZONE:Asia/Shanghai'
    ];
    var stamp = icsStamp();

    function pushEvent(uid, date, startTime, endTime, summary, location, description, leadMinutes) {
      if (!startTime || !endTime) return;
      var ds = icsDate(date, startTime);
      var de = icsDate(date, endTime);
      if (de <= ds) return;
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + uid + '@timetable.local');
      lines.push('DTSTAMP:' + stamp);
      lines.push('DTSTART:' + ds);
      lines.push('DTEND:' + de);
      lines.push('SUMMARY:' + icsEscape(summary));
      lines.push('LOCATION:' + icsEscape(location || ''));
      lines.push('DESCRIPTION:' + icsEscape(description || ''));
      if (leadMinutes > 0) {
        lines.push('BEGIN:VALARM');
        lines.push('ACTION:DISPLAY');
        lines.push('DESCRIPTION:' + icsEscape(summary));
        lines.push('TRIGGER:-PT' + leadMinutes + 'M');
        lines.push('END:VALARM');
      }
      lines.push('END:VEVENT');
    }

    (state.data.blocks || []).forEach(function (b) {
      var weeks = b.weeks && b.weeks.length ? b.weeks : rangeWeeks(1, maxWeek);
      weeks.forEach(function (w) {
        if (w < 1 || w > maxWeek) return;
        var icsAdj = adjustmentFor(b.id, w);
        if (icsAdj && icsAdj.cancel) return;
        var icsDay = icsAdj ? icsAdj.day : b.day;
        var icsStartP = icsAdj ? icsAdj.period : b.startPeriod;
        var icsSpan = Math.max(0, (b.endPeriod || b.startPeriod) - b.startPeriod);
        var icsEndP = icsStartP + icsSpan;
        var date = dateForWeekDay(w, icsDay);
        var st = periodStart(icsStartP);
        var en = periodEnd(icsEndP);
        var place = [b.room, b.campus].filter(Boolean).join(' ');
        var note = getNote(b.id);
        var desc = '第 ' + icsStartP + (icsEndP !== icsStartP ? '–' + icsEndP : '') +
          ' 节；' + formatWeeks(b.weeks) + (b.teacher ? '；教师：' + b.teacher : '') +
          (icsAdj ? '；本周调课' : '') +
          (note && note.text ? '；备注：' + note.text : '');
        pushEvent(b.id + '-' + w, date, st, en, b.name + (b.teacher ? ' · ' + b.teacher : ''), place, desc, noteLead(b));
      });
    });

    (state.data.practice || []).forEach(function (p) {
      (p.weeks || []).forEach(function (w) {
        if (w < 1 || w > maxWeek) return;
        if (p.allWeek) {
          var monday = dateForWeekDay(w, 1);
          var nextMonday = addDays(monday, 7);
          lines.push('BEGIN:VEVENT');
          lines.push('UID:' + p.id + '-' + w + '-all@timetable.local');
          lines.push('DTSTAMP:' + stamp);
          lines.push('DTSTART;VALUE=DATE:' + icsDateOnly(monday));
          lines.push('DTEND;VALUE=DATE:' + icsDateOnly(nextMonday));
          lines.push('SUMMARY:' + icsEscape('[整周] ' + p.name));
          lines.push('DESCRIPTION:' + icsEscape(formatWeeks(p.weeks) + '；全周占用'));
          lines.push('END:VEVENT');
        } else {
          var date2 = dateForWeekDay(w, p.day);
          var pnote = getNote(p.id);
          var desc2 = '第 ' + p.startPeriod + '–' + p.endPeriod + ' 节；' + formatWeeks(p.weeks) +
            (pnote && pnote.text ? '；备注：' + pnote.text : '');
          pushEvent(p.id + '-' + w, date2, periodStart(p.startPeriod), periodEnd(p.endPeriod),
            '[实践] ' + p.name, '', desc2, noteLead(p));
        }
      });
    });

    lines.push('END:VCALENDAR');
    var text = lines.map(foldLine).join('\r\n') + '\r\n';
    saveTextFile(('能猫课表-' + (s.semester || '') + '.ics').replace(/[\\/:*?"<>|]/g, '-'),
      text, 'text/calendar;charset=utf-8');
    toast('已导出日历文件');
  }

  function rangeWeeks(a, b) {
    var out = [];
    for (var i = a; i <= b; i++) out.push(i);
    return out;
  }

  function exportJSON() {
    if (!state.data) {
      toast('还没有数据可以导出', true);
      return;
    }
    var payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      data: state.data,
      notes: state.notes
    };
    saveTextFile('能猫课表备份-' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    toast('已导出数据备份');
  }

  function restoreJSONFile(onDone) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var payload = JSON.parse(String(reader.result));
          if (!payload || !payload.data || !Array.isArray(payload.data.blocks)) {
            throw new Error('这不是本工具导出的数据文件。');
          }
          state.data = payload.data;
          state.notes = payload.notes && typeof payload.notes === 'object' ? payload.notes : {};
          saveNotes();
          if (payload.settings) {
            state.settings = Object.assign(defaultSettings(), payload.settings);
            if (!Array.isArray(state.settings.periods) || !state.settings.periods.length) {
              state.settings.periods = defaultSettings().periods;
            }
            state.settings.student = Object.assign({ name: '', id: '', className: '' }, state.settings.student || {});
            state.settings.maxWeek = clamp(parseInt(state.settings.maxWeek, 10) || 20, 1, 30);
            var rd = parseInt(state.settings.reminderDefault, 10);
            state.settings.reminderDefault = REMINDER_OPTIONS.indexOf(rd) >= 0 ? rd : 15;
          }
          state.week = getCurrentWeek();
          state.day = todayWeekday();
          state.view = 'today';
          writeJSON(STORAGE.settings, state.settings);
          writeJSON(STORAGE.data, state.data);
          if (onDone) onDone();
          showApp();
          renderAll();
          syncPhoneReminders();
          toast('已恢复数据');
        } catch (e) {
          toast(e && e.message ? e.message : '数据文件读取失败', true);
        }
      };
      reader.onerror = function () { toast('读取文件失败', true); };
      reader.readAsText(file);
    });
    input.click();
  }

  /* ---------------- toast ---------------- */

  function toast(msg, isError) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle('error', !!isError);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
  }

  /* ---------------- go ---------------- */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
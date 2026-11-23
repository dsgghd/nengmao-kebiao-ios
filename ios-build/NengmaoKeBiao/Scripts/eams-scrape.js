(function () {
  function pad(x) { return x < 10 ? '0' + x : '' + x; }

  function parseWeeks(raw) {
    var weeks = [];
    String(raw || '').split(/\s+/).forEach(function (seg) {
      seg = seg.trim();
      if (!seg) return;
      var odd = false;
      var even = false;
      if (seg.indexOf('单') >= 0) { odd = true; seg = seg.replace(/单/g, ''); }
      if (seg.indexOf('双') >= 0) { even = true; seg = seg.replace(/双/g, ''); }
      seg = seg.replace(/^连/, '').replace(/周/g, '');
      if (!seg) return;
      if (seg.indexOf('-') >= 0) {
        var r = seg.split('-');
        var a = parseInt(r[0], 10);
        var b = parseInt(r[1], 10);
        if (isNaN(a) || isNaN(b)) return;
        for (var w = Math.min(a, b); w <= Math.max(a, b); w++) {
          if (odd || even) {
            var isOdd = (w % 2 === 1);
            if (odd && !isOdd) continue;
            if (even && isOdd) continue;
          }
          weeks.push(w);
        }
      } else if (/^\d+$/.test(seg)) {
        weeks.push(parseInt(seg, 10));
      }
    });
    return weeks.filter(function (w, i, arr) { return arr.indexOf(w) === i; }).sort(function (a, b) { return a - b; });
  }

  function splitTokens(title) {
    return String(title || '').split(/[;；]/).map(function (t) { return t.trim(); }).filter(Boolean);
  }

  function splitWeekPlace(value) {
    var s = String(value || '').replace(/^[（(]/, '').replace(/[）)]\s*$/, '').trim();
    var parts = s.split(',');
    var weeks = parts.shift() || '';
    var place = parts.join(',').trim();
    return { weeks: weeks, place: place };
  }

  function parsePlace(place) {
    var room = place || '';
    var campus = '';
    var m = room.match(/[（(]([^（()）]*)[）)]\s*$/);
    if (m) {
      campus = m[1].trim();
      room = room.replace(/[（(][^（()）]*[）)]\s*$/, '').trim();
    }
    return { room: room, campus: campus };
  }

  // 课程对象统一补齐为与导出 xlsx 对齐的字段：课程序号(section)、课程代码(courseCode)、学分、备注。
  function baseCode(code) {
    var m = String(code || '').match(/^([A-Za-z0-9]+)\s*\./);
    return m ? m[1] : String(code || '');
  }

  function normalizeCourse(c) {
    if (!c) return c;
    c.section = c.section || c.code || '';
    c.courseCode = c.courseCode || baseCode(c.code);
    c.credits = c.credits == null ? '' : String(c.credits);
    c.note = c.note == null ? '' : String(c.note);
    return c;
  }

  function buildCatalog(courses) {
    var out = [];
    var seen = {};
    for (var i = 0; i < courses.length; i++) {
      var c = courses[i];
      var key = (c.section || c.courseCode || '') + '|' + c.name;
      if (seen[key]) continue;
      seen[key] = 1;
      out.push({
        name: c.name,
        code: c.courseCode || baseCode(c.code),
        section: c.section || c.code || '',
        teacher: c.teacher || '',
        credits: c.credits || '',
        note: c.note || ''
      });
    }
    return out;
  }

  // 课表页上能拿到的学生信息；拿不到就留空，不用登录账号反推。
  function collectMeta(docs) {
    var text = '';
    for (var i = 0; i < docs.length; i++) {
      try { if (docs[i].body) text += ' ' + docs[i].body.innerText; } catch (e) {}
    }
    text = String(text || '').replace(/\s+/g, ' ');
    var nameM = text.match(/学生姓名\s*[:：]\s*([\u4e00-\u9fa5·]{2,20})/) ||
      text.match(/Hi[,，]\s*([\u4e00-\u9fa5·]{2,20})/);
    var idM = text.match(/学号\s*[:：]\s*([0-9]{6,20})/);
    var classM = text.match(/(?:所属班级|班级)\s*[:：]\s*([^\s,，;；|]{2,30})/);
    var semM = text.match(/(20\d{2}\s*[-—]\s*20\d{2}\s*学年\s*第[一二12]学期)/);
    var semester = semM ? semM[1].replace(/\s+/g, '') : '';
    if (!semester) {
      for (var d = 0; d < docs.length; d++) {
        try {
          var sels = docs[d].querySelectorAll('select');
          for (var s = 0; s < sels.length; s++) {
            var nm = (sels[s].name || '') + ' ' + (sels[s].id || '');
            if (!/semester|学期|学年/i.test(nm)) continue;
            var opt = sels[s].options[sels[s].selectedIndex];
            if (opt && opt.text) { semester = String(opt.text).replace(/\s+/g, ''); break; }
          }
        } catch (e) {}
        if (semester) break;
      }
    }
    return {
      studentName: nameM ? nameM[1] : '',
      studentId: idM ? idM[1] : '',
      className: classM ? classM[1] : '',
      semester: semester
    };
  }

  function parseTitle(title, day, start, end) {
    var list = [];
    var tokens = splitTokens(title);
    var k = 0;
    while (k < tokens.length) {
      var coursePart = tokens[k++];
      if (!coursePart || coursePart.charAt(0) === '(' || coursePart.charAt(0) === '（') continue;
      var weekPart = tokens[k];
      if (!weekPart || (weekPart.charAt(0) !== '(' && weekPart.charAt(0) !== '（')) continue;
      k++;
      var teacher = '';
      var name = coursePart;
      var code = '';
      var m = coursePart.match(/^(.*?)\s+(.+?)[（(]([^（()）]*)[）)]\s*$/);
      if (m) {
        teacher = m[1].trim();
        name = m[2].trim();
        code = m[3].trim();
      } else {
        var m2 = coursePart.match(/^(.*?)\s+(.+)$/);
        if (m2) { teacher = m2[1].trim(); name = m2[2].trim(); }
      }
      var wp = splitWeekPlace(weekPart);
      var weeks = parseWeeks(wp.weeks);
      if (!name || !weeks.length) continue;
      var place = parsePlace(wp.place);
      list.push({
        name: name,
        teacher: teacher,
        code: code,
        section: code,
        courseCode: baseCode(code),
        credits: '',
        note: '',
        day: day,
        startPeriod: start,
        endPeriod: end,
        weeks: weeks,
        room: place.room,
        campus: place.campus
      });
    }
    return list;
  }

  function scanDoc(doc, stats) {
    var courses = [];
    if (!doc) return courses;
    for (var i = 0; i < 84; i++) {
      var td = doc.getElementById('TD' + i + '_0');
      if (!td) continue;
      stats.cells++;
      var title = (td.getAttribute('title') || '').trim();
      if (!title) continue;
      stats.titled++;
      if (!stats.sample) stats.sample = title.slice(0, 240);
      var span = parseInt(td.getAttribute('rowspan') || '1', 10);
      if (isNaN(span) || span < 1) span = 1;
      var day = Math.floor(i / 12) + 1;
      var start = (i % 12) + 1;
      var end = Math.min(12, start + span - 1);
      courses = courses.concat(parseTitle(title, day, start, end));
    }
    if (!courses.length && stats.titled === 0) {
      var cells = doc.querySelectorAll('td[id^="TD"]');
      for (var j = 0; j < cells.length; j++) {
        var c = cells[j];
        var id = c.getAttribute('id') || '';
        var im = id.match(/^TD(\d+)_(\d+)$/);
        if (!im) continue;
        stats.cells++;
        var t = (c.getAttribute('title') || '').trim();
        if (!t) continue;
        stats.titled++;
        if (!stats.sample) stats.sample = t.slice(0, 240);
        var idx = parseInt(im[1], 10);
        if (isNaN(idx) || idx < 0 || idx > 83) continue;
        var sp = parseInt(c.getAttribute('rowspan') || '1', 10);
        if (isNaN(sp) || sp < 1) sp = 1;
        var d = Math.floor(idx / 12) + 1;
        var s = (idx % 12) + 1;
        var e = Math.min(12, s + sp - 1);
        courses = courses.concat(parseTitle(t, d, s, e));
      }
    }
    return courses;
  }

  function splitArgs(t) {
    var out = [];
    var cur = '';
    var q = null;
    var esc = false;
    var depth = 0;
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      if (q) {
        cur += ch;
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === q) q = null;
      } else {
        if (ch === '"' || ch === "'") {
          q = ch;
          cur += ch;
        } else if (ch === '(') {
          depth++;
          cur += ch;
        } else if (ch === ')') {
          depth--;
          cur += ch;
        } else if (ch === ',' && depth === 0) {
          out.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function jsString(x) {
    x = String(x || '').trim();
    if (x.length >= 2 && (x.charAt(0) === '"' || x.charAt(0) === "'") && x.charAt(x.length - 1) === x.charAt(0)) {
      return x.slice(1, -1);
    }
    return null;
  }

  function parseActivitiesDoc(doc) {
    var text = '';
    try {
      var ss = doc.scripts || [];
      for (var i = 0; i < ss.length; i++) {
        var t = ss[i].textContent || '';
        if (t.indexOf('new TaskActivity') >= 0) text += '\n' + t;
      }
    } catch (e) {}
    if (!text) return [];

    var um = text.match(/var\s+unitCount\s*=\s*(\d+)/);
    var unit = um ? parseInt(um[1], 10) : 11;
    if (!unit) unit = 11;

    var teach = [];
    var tr = /var\s+actTeachers\s*=\s*(\[[^\]]*\]);/g;
    var tm;
    while ((tm = tr.exec(text))) {
      var names = [];
      var nr = /name\s*:\s*"([^"]*)"/g;
      var nm;
      while ((nm = nr.exec(tm[1]))) names.push(nm[1]);
      teach.push({ pos: tm.index, names: names });
    }

    var out = [];
    var ar = /activity\s*=\s*new\s+TaskActivity\(([\s\S]*?)\);/g;
    var am;
    while ((am = ar.exec(text))) {
      var args = splitArgs(am[1]);
      if (args.length < 7) continue;
      var tn = [];
      for (var ti = 0; ti < teach.length; ti++) {
        if (teach[ti].pos < am.index) tn = teach[ti].names;
        else break;
      }
      var rest = text.slice(am.index + am[0].length);
      var next = rest.search(/activity\s*=\s*new\s+TaskActivity|var\s+teachers\s*=/);
      var seg = next >= 0 ? rest.slice(0, next) : rest;
      var idx = [];
      var ir = /index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)\s*;/g;
      var im;
      while ((im = ir.exec(seg))) idx.push([parseInt(im[1], 10), parseInt(im[2], 10)]);
      if (!idx.length) continue;

      var cname = jsString(args[3]);
      var room = jsString(args[5]) || '';
      var weeks = jsString(args[6]) || '';
      if (!cname) continue;
      var cm = cname.match(/\(([^)]*)\)\s*$/);
      var code = cm ? cm[1] : '';
      var name = cname.replace(/\([^)]*\)\s*$/, '').trim();
      var rm = room.match(/^(.*?)[（(]([^（()）]*)[）)]\s*$/);
      var roomName = rm ? rm[1].trim() : room;
      var campus = rm ? rm[2].trim() : '';
      var wk = [];
      for (var wi = 0; wi < weeks.length; wi++) {
        // EAMS 的周次位串第 i 位就是「第 i 周」（与学校导出的 xlsx 一致），不要再 +1
        if (wi >= 1 && weeks.charAt(wi) === '1') wk.push(wi);
      }
      if (!name || !wk.length) continue;

      var extraText = args.join(' ');
      var creditM = extraText.match(/学分\s*[:：]?\s*(\d+(?:\.\d+)?)/);
      var noteM = extraText.match(/备注\s*[:：]\s*([^,，;；()（）]{1,40})/);
      var credits = creditM ? creditM[1] : '';
      var note = noteM ? noteM[1].trim() : '';

      var byDay = {};
      for (var ii = 0; ii < idx.length; ii++) {
        var d = idx[ii][0];
        var pnum = idx[ii][1];
        if (!byDay[d]) byDay[d] = [];
        if (byDay[d].indexOf(pnum) < 0) byDay[d].push(pnum);
      }
      for (var dk in byDay) {
        if (!Object.prototype.hasOwnProperty.call(byDay, dk)) continue;
        var ps = byDay[dk];
        var start = Math.min.apply(null, ps) + 1;
        var end = Math.max.apply(null, ps) + 1;
        out.push({
          name: name,
          teacher: tn.join(','),
          code: code,
          section: code,
          courseCode: baseCode(code),
          credits: credits,
          note: note,
          day: parseInt(dk, 10) + 1,
          startPeriod: start,
          endPeriod: end,
          weeks: wk.slice(0),
          room: roomName,
          campus: campus
        });
      }
    }
    return out;
  }

  function collectDocs(doc, list, depth) {
    if (!doc || depth > 4) return;
    if (list.indexOf(doc) >= 0) return;
    list.push(doc);
    var frames = [];
    try { frames = doc.querySelectorAll('iframe,frame') || []; } catch (e) {}
    for (var i = 0; i < frames.length; i++) {
      var child = null;
      try { child = frames[i].contentDocument; } catch (e) {}
      if (child) collectDocs(child, list, depth + 1);
    }
  }

  function formInfo(doc) {
    var out = [];
    try {
      var fs = doc.forms || [];
      for (var i = 0; i < fs.length && out.length < 4; i++) {
        var f = fs[i];
        var names = [];
        var els = f.querySelectorAll('input,select');
        for (var j = 0; j < els.length && names.length < 16; j++) {
          var n = els[j].getAttribute('name') || els[j].id || '';
          if (!n || /password/i.test(n)) continue;
          var v = /(^|\.)ids$|semester\.id/i.test(n) ? (String(els[j].value || '') ? '=(set)' : '=(empty)') : '';
          names.push(n + v);
        }
        out.push({
          action: String(f.getAttribute('action') || '').slice(0, 140),
          method: String(f.method || ''),
          target: String(f.target || ''),
          inputs: names
        });
      }
    } catch (e) {}
    return out;
  }

  function acTerm() {
    var d = new Date();
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    if (m >= 8) return { year: y, term: 1 };
    if (m <= 1) return { year: y - 1, term: 1 };
    return { year: y - 1, term: 2 };
  }

  function termFromDate(s) {
    var m = String(s || '').match(/(\d{4})-(\d{2})/);
    if (!m) return null;
    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10);
    return { year: mo >= 8 ? y : y - 1, term: mo >= 2 && mo <= 7 ? 2 : 1 };
  }

  function setField(doc, name, value) {
    var el = null;
    try { el = doc.querySelector('[name="' + name + '"]'); } catch (e) {}
    if (!el) return false;
    if (String(el.tagName || '').toLowerCase() === 'select') {
      var found = false;
      for (var i = 0; i < el.options.length; i++) {
        if (String(el.options[i].value) === String(value)) {
          el.selectedIndex = i;
          found = true;
          break;
        }
      }
      if (!found && el.options.length === 0) {
        var o = doc.createElement('option');
        o.value = value;
        o.text = value;
        el.appendChild(o);
        el.value = value;
      }
    } else {
      el.value = value;
    }
    return String(el.value || '') !== '';
  }

  function currentSemester(base) {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', base + 'getCurrentSemester.action?t=' + Date.now(), false);
      x.withCredentials = true;
      x.send(null);
      if (x.status >= 200 && x.status < 300) {
        var d = JSON.parse(x.responseText);
        if (d && d.id) return d;
      }
    } catch (e) {}
    return null;
  }

  function submitOuter(doc) {
    var form = null;
    try {
      var fs = doc.forms || [];
      for (var i = 0; i < fs.length; i++) {
        var action = String(fs[i].getAttribute('action') || '');
        if (/courseTableForStd\.action/.test(action) || fs[i].querySelector('[name="semesterCalendar_year"]')) {
          form = fs[i];
          break;
        }
      }
    } catch (e) {}
    if (!form && doc.forms && doc.forms.length) form = doc.forms[0];
    if (!form) return false;
    try {
      form.target = '_self';
      form.submit();
      return true;
    } catch (e) { return false; }
  }

  function fixSemester(doc, base) {
    try {
      var ss = doc.querySelectorAll('script');
      for (var si = 0; si < ss.length; si++) {
        var st = ss[si].textContent || '';
        if (st.indexOf('semesterCalendar(') < 0) continue;
        var vm = st.match(/semesterCalendar\(\{[\s\S]{0,300}?value\s*:\s*["'](\d+)["']/);
        if (vm && setField(doc, 'semester.id', vm[1])) return 'selected';
      }
    } catch (e) {}
    var ac = acTerm();
    var sels = [];
    try {
      sels = doc.querySelectorAll('select[name="semester.id"], select[name^="semesterBar"], select[id^="semesterBar"], select[name*="semester"], select[id*="semester"]');
    } catch (e) {}
    var changedBar = false;
    var barValue = '';
    for (var si = 0; si < sels.length; si++) {
      var sel = sels[si];
      if (!sel.options || !sel.options.length) continue;
      var best = -1;
      var bestScore = -1;
      for (var i = 0; i < sel.options.length; i++) {
        var txt = String(sel.options[i].text || '') + ' ' + String(sel.options[i].value || '');
        var score = 0;
        if (txt.indexOf(String(ac.year)) >= 0) score += 2;
        if (txt.indexOf(String(ac.year + 1)) >= 0) score += 1;
        if (ac.term === 1 && /(^|\D)1(\D|$)|第一|秋/.test(txt)) score += 1;
        if (ac.term === 2 && /(^|\D)2(\D|$)|第二|春/.test(txt)) score += 1;
        if (score > bestScore) { best = i; bestScore = score; }
      }
      if (best >= 0) {
        sel.selectedIndex = best;
        try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        changedBar = true;
        var nm = String(sel.name || '') + ' ' + String(sel.id || '');
        if (nm.indexOf('semesterBar') >= 0 && sel.value) barValue = String(sel.value);
      }
    }

    var semEl = null;
    try { semEl = doc.querySelector('[name="semester.id"]'); } catch (e) {}
    var semVal = semEl ? String(semEl.value || '') : '';
    if (semVal) return 'selected';

    if (barValue && semEl && /^\d+$/.test(barValue)) {
      semEl.value = barValue;
      if (String(semEl.value || '')) return 'selected';
    }

    try {
      if (sessionStorage.getItem('ttSemTried')) return 'no-params';
    } catch (e) {}
    try { sessionStorage.setItem('ttSemTried', '1'); } catch (e) {}

    if (changedBar && barValue) {
      if (submitOuter(doc)) return 'semester';
    }

    var cur = currentSemester(base);
    if (cur && cur.id) {
      setField(doc, 'semester.id', cur.id);
      var tf = termFromDate(cur.startDate);
      if (tf) {
        setField(doc, 'semesterCalendar_year', tf.year);
        setField(doc, 'semesterCalendar_term', tf.term);
      }
      var bar = null;
      try { bar = doc.querySelector('[name^="semesterBar"]'); } catch (e) {}
      if (bar && cur.name) bar.value = cur.name;
      if (submitOuter(doc)) return 'semester';
    }

    var yOk = setField(doc, 'semesterCalendar_year', ac.year);
    var tOk = setField(doc, 'semesterCalendar_term', ac.term);
    if ((yOk || tOk) && submitOuter(doc)) return 'semester';
    return 'no-params';
  }

  function maybeOpenTable(docs) {
    if (docs.length > 1) return 'frames';
    if (!/courseTableForStd\.action/.test(location.href)) return '';
    if (/courseTableForStd!/.test(location.href)) return '';
    window.__ttHits = (window.__ttHits || 0) + 1;
    if (window.__ttTriedSubmit) return 'done';
    if (window.__ttHits < 3) return 'wait';

    var doc = document;
    var base = location.href.replace(/courseTableForStd.*$/, '');

    var semVal = '';
    try {
      var semEl = doc.querySelector('[name="semester.id"]');
      if (semEl) semVal = String(semEl.value || '');
    } catch (e) {}
    if (!semVal) {
      var fixed = fixSemester(doc, base);
      if (fixed !== 'selected') return fixed;
    }

    var best = null;
    var bestScore = 0;
    try {
      var fs = doc.forms || [];
      for (var i = 0; i < fs.length; i++) {
        var f = fs[i];
        var action = String(f.getAttribute('action') || '');
        var score = 0;
        if (/courseTableForStd/.test(action)) score += 2;
        if (f.querySelector('[name="ids"]')) score += 2;
        if (f.querySelector('[name="semester.id"]')) score += 1;
        if (f.querySelector('input[type=password]')) score -= 5;
        if (score > bestScore) { best = f; bestScore = score; }
      }
    } catch (e) {}

    var html = doc.documentElement ? doc.documentElement.innerHTML : '';
    try {
      var view = doc.defaultView;
      if (view && typeof view.searchTable === 'function') {
        window.__ttTriedSubmit = 1;
        view.searchTable();
        return 'searchTable';
      }
    } catch (e) {}

    var params = {};
    var fieldOk = false;
    if (best) {
      try {
        var els = best.querySelectorAll('input,select');
        for (var j = 0; j < els.length; j++) {
          var n = els[j].getAttribute('name') || '';
          var t = String(els[j].type || '').toLowerCase();
          if (!n || /password|submit|button|image|reset|file/i.test(t)) continue;
          params[n] = String(els[j].value || '');
        }
        fieldOk = true;
      } catch (e) {}
    }

    var ids = fieldOk ? String(params['ids'] || '') : '';
    if (!ids) {
      var im = html.match(/bg\.form\.addInput\(\s*[^,]+,\s*["']ids["']\s*,\s*["']?([\d,]+)/i)
        || html.match(/["']ids["']\s*[,:]\s*["']([\d,]{3,})["']/i);
      if (im) ids = im[1];
    }
    if (!ids) {
      try { ids = String(doc.defaultView.ids || doc.defaultView.studentId || ''); } catch (e) {}
    }

    var sem = fieldOk ? String(params['semester.id'] || '') : '';
    if (!sem) {
      var sm = html.match(/semester\.id["']?\s*[,:=]\s*["']?(\d+)/i);
      if (sm) sem = sm[1];
    }
    if (!sem) {
      try { sem = String(doc.defaultView.semesterId || ''); } catch (e) {}
    }

    if (!ids || !sem) return 'no-params';
    window.__ttTriedSubmit = 1;
    params['ids'] = ids;
    params['semester.id'] = sem;
    if (!params['weekFlag']) params['weekFlag'] = '1';

    var target = base + 'courseTableForStd!courseTable.action';
    if (best) {
      var oa = String(best.getAttribute('action') || '');
      var qi = oa.indexOf('?');
      if (qi >= 0) target += oa.slice(qi);
    }
    try {
      var nf = doc.createElement('form');
      nf.method = 'post';
      nf.action = target;
      nf.target = '_self';
      nf.style.display = 'none';
      for (var k in params) {
        if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
        var inp = doc.createElement('input');
        inp.type = 'hidden';
        inp.name = k;
        inp.value = params[k];
        nf.appendChild(inp);
      }
      (doc.body || doc.documentElement).appendChild(nf);
      nf.submit();
      return 'form';
    } catch (e) {
      return 'form-error';
    }
  }

  var stats = { frames: 0, cells: 0, titled: 0, sample: '', tables: 0, days: 0, links: [], flags: [], frameInfo: [] };
  var docs = [];
  collectDocs(document, docs, 0);
  stats.frames = docs.length;

  var all = [];
  for (var di = 0; di < docs.length; di++) {
    var doc = docs[di];
    var frameRow = { url: '', title: '', tables: 0, tds: 0 };
    try {
      frameRow.url = String(doc.location && doc.location.href || '').slice(0, 180);
      frameRow.title = String(doc.title || '').slice(0, 80);
      frameRow.tables = doc.querySelectorAll('table').length;
      frameRow.tds = doc.querySelectorAll('td').length;
      stats.tables += frameRow.tables;
      var bodyText = doc.body ? String(doc.body.innerText || '').slice(0, 3000) : '';
      if (/星期|周一|周1/.test(bodyText)) stats.days++;
      if (/未注册/.test(bodyText) && stats.flags.indexOf('未注册') < 0) stats.flags.push('未注册');
      if (/未选择|请选择学期|选择学期/.test(bodyText) && stats.flags.indexOf('选择学期') < 0) stats.flags.push('选择学期');
      var anchors = doc.querySelectorAll('a,button');
      for (var ai = 0; ai < anchors.length && stats.links.length < 12; ai++) {
        var at = String(anchors[ai].innerText || anchors[ai].textContent || '').replace(/\s+/g, ' ').trim();
        if (at && at.length <= 24 && /课表/.test(at) && stats.links.indexOf(at) < 0) stats.links.push(at);
      }
    } catch (e) {}
    stats.frameInfo.push(frameRow);
    var found = scanDoc(doc, stats);
    if (!found.length) {
      var scriptCourses = parseActivitiesDoc(doc);
      if (scriptCourses.length) {
        stats.activities = (stats.activities || 0) + scriptCourses.length;
        found = scriptCourses;
      }
    }
    for (var fi = 0; fi < found.length; fi++) all.push(found[fi]);
  }

  var seen = {};
  var courses = [];
  for (var ci = 0; ci < all.length; ci++) {
    var co = all[ci];
    var key = [co.name, co.day, co.startPeriod, co.endPeriod, co.weeks.join(','), co.room].join('|');
    if (seen[key]) continue;
    seen[key] = true;
    courses.push(co);
  }

  for (var ni = 0; ni < courses.length; ni++) normalizeCourse(courses[ni]);
  var catalog = buildCatalog(courses);
  var meta = collectMeta(docs);
  stats.catalog = catalog.length;

  var result = {
    ok: courses.length > 0,
    courses: courses,
    catalog: catalog,
    meta: meta,
    title: document.title || '',
    url: location.href || '',
    debug: stats
  };
  var pageExtra = { forms: [], text: '', hints: [], auto: '' };
  try {
    if (!courses.length) {
      pageExtra.forms = formInfo(document);
      pageExtra.text = String(document.body && document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 240);
      var html = document.documentElement ? document.documentElement.innerHTML : '';
      var hre = /courseTableForStd[^"'<>]{0,90}|semester\.id[^"'<>]{0,60}|\bids\b[^,;<>]{0,40}/g;
      var hm;
      var hc = 0;
      while ((hm = hre.exec(html)) && hc < 8) {
        pageExtra.hints.push(String(hm[0]).replace(/\d{5,}/g, '#').slice(0, 120));
        hc++;
      }
      pageExtra.auto = maybeOpenTable(docs);
    }
  } catch (e) {}
  try {
    if (window.EamsBridge && typeof EamsBridge.onCourses === 'function') {
      EamsBridge.onCourses(JSON.stringify(result));
    }
    if (window.EamsBridge && typeof EamsBridge.onDebug === 'function') {
      EamsBridge.onDebug(JSON.stringify({
        frames: stats.frames,
        cells: stats.cells,
        titled: stats.titled,
        tables: stats.tables,
        activities: stats.activities || 0,
        days: stats.days,
        links: stats.links,
        flags: stats.flags,
        frameInfo: stats.frameInfo,
        sample: stats.sample,
        title: result.title,
        url: result.url,
        forms: pageExtra.forms,
        text: pageExtra.text,
        hints: pageExtra.hints,
        auto: pageExtra.auto
      }));
    }
  } catch (e) {}
})();
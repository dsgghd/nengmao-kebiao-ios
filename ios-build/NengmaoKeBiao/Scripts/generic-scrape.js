(function () {
  function clean(v) {
    return String(v == null ? '' : v).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  }

  function textOf(el) {
    if (!el) return '';
    try {
      var html = el.innerHTML || '';
      if (/<br\s*\/?>/i.test(html)) {
        var tmp = document.createElement('div');
        tmp.innerHTML = html.replace(/<br\s*\/?>/gi, '\n');
        return String(tmp.textContent || '');
      }
      var t = el.innerText;
      if (!t || !t.trim()) t = el.textContent;
      return String(t || '');
    } catch (e) { return ''; }
  }

  // 与导出 xlsx 对齐：补齐课程序号、课程代码、学分、备注，并生成课程列表与学生信息。
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

  function collectMeta(docs) {
    var text = '';
    for (var i = 0; i < docs.length; i++) {
      try { if (docs[i].body) text += ' ' + (docs[i].body.innerText || docs[i].body.textContent || ''); } catch (e) {}
    }
    text = String(text || '').replace(/\s+/g, ' ');
    var nameM = text.match(/学生姓名\s*[:：]\s*([\u4e00-\u9fa5·]{2,20})/) ||
      text.match(/Hi[,，]\s*([\u4e00-\u9fa5·]{2,20})/);
    var idM = text.match(/学号\s*[:：]\s*([0-9]{6,20})/);
    var classM = text.match(/(?:所属班级|班级)\s*[:：]\s*([^\s,，;；|]{2,30})/);
    var semM = text.match(/(20\d{2}\s*[-—]\s*20\d{2}\s*学年\s*第[一二12]学期)/);
    return {
      studentName: nameM ? nameM[1] : '',
      studentId: idM ? idM[1] : '',
      className: classM ? classM[1] : '',
      semester: semM ? semM[1].replace(/\s+/g, '') : ''
    };
  }

  function parseWeeks(raw) {
    var s = clean(raw);
    if (!s) return [];
    if (/^[01]{20,}$/.test(s.replace(/\s/g, ''))) {
      var bits = s.replace(/\s/g, '');
      var bw = [];
      for (var bi = 0; bi < bits.length; bi++) if (bits.charAt(bi) === '1' && bi + 1 <= 30) bw.push(bi + 1);
      return bw;
    }
    s = s.replace(/[（）()]/g, ' ').replace(/第/g, ' ').replace(/周/g, ' ')
      .replace(/学期/g, ' ').replace(/[，、；;]/g, ',');
    var out = [];
    var globalOdd = s.indexOf('单') >= 0;
    var globalEven = s.indexOf('双') >= 0;
    var segs = s.split(/[\s,]+/);
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (!seg) continue;
      var odd = seg.indexOf('单') >= 0;
      var even = seg.indexOf('双') >= 0;
      if (!odd && !even) { odd = globalOdd; even = globalEven; }
      seg = seg.replace(/[单双]/g, '').replace(/^连/, '').replace(/~/g, '-').replace(/—/g, '-').replace(/至/g, '-');
      if (!seg) continue;
      var m = seg.match(/^(\d+)-(\d+)$/);
      if (m) {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        for (var w = Math.min(a, b); w <= Math.max(a, b) && w <= 30; w++) {
          if (w < 1) continue;
          if (odd && w % 2 === 0) continue;
          if (even && w % 2 === 1) continue;
          out.push(w);
        }
        continue;
      }
      if (/^\d+$/.test(seg)) {
        var n = parseInt(seg, 10);
        if (n >= 1 && n <= 30) out.push(n);
      }
    }
    out = out.filter(function (v, idx, arr) { return arr.indexOf(v) === idx; }).sort(function (a, b) { return a - b; });
    return out;
  }

  function parsePeriods(raw) {
    var s = clean(raw);
    if (!s) return null;
    var m = s.match(/(\d+)\s*[-~—至]\s*(\d+)\s*节/);
    if (m) return { start: +m[1], end: +m[2], text: m[0] };
    m = s.match(/^(\d+)\s*[-~—]\s*(\d+)$/);
    if (m) return { start: +m[1], end: +m[2], text: m[0] };
    m = s.match(/(\d+)\s*节/);
    if (m) return { start: +m[1], end: +m[1], text: m[0] };
    m = s.match(/第\s*(\d+)\s*[-~—至]\s*(\d+)/);
    if (m) return { start: +m[1], end: +m[2], text: m[0] };
    m = s.match(/^(\d+)(?:\s*,\s*(\d+))+$/);
    if (m) {
      var nums = s.split(',').map(function (x) { return parseInt(x, 10); }).filter(function (n) { return !isNaN(n); });
      if (nums.length) return { start: Math.min.apply(null, nums), end: Math.max.apply(null, nums), text: s };
    }
    return null;
  }

  function parseDay(raw) {
    var s = clean(raw);
    var m = s.match(/(?:星期|周)([一二三四五六日天])/);
    if (m) {
      var map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
      return map[m[1]] || 0;
    }
    m = s.match(/^(?:周)?([1-7])$/);
    if (m) return +m[1];
    return 0;
  }

  function splitCourseText(text) {
    var t = String(text || '').replace(/\r/g, '');
    var parts = t.split(/-{3,}|—{3,}/);
    if (parts.length > 1) return parts.map(clean).filter(Boolean);
    return [clean(t)];
  }

  function parseBlock(el, fDay, fStart, fEnd, stats) {
    var out = [];
    if (!el) return out;
    var text = textOf(el);
    var name = '';
    var teacher = '';
    var room = '';
    var campus = '';
    var weeks = [];
    var periods = null;

    try {
      var titleEl = el.querySelector ? el.querySelector('.title') : null;
      if (titleEl) name = clean(textOf(titleEl));
      var tf = el.querySelector ? el.querySelector('font[title*="老师"],font[title*="教师"],font[title*="授课"]') : null;
      if (tf) teacher = clean(textOf(tf));
      var rf = el.querySelector ? el.querySelector('font[title*="教室"],font[title*="地点"]') : null;
      if (rf) room = clean(textOf(rf));
      var wf = el.querySelector ? el.querySelector('font[title*="周"]') : null;
      if (wf) weeks = parseWeeks(textOf(wf));
      if (el.querySelector) {
        var ps = el.querySelectorAll('p');
        for (var pi = 0; pi < ps.length; pi++) {
          var pt = clean(textOf(ps[pi]));
          if (!pt) continue;
          if (/\(\s*\d+\s*[-~]\s*\d+\s*节\s*\)|\d+\s*[-~]\s*\d+\s*节/.test(pt)) {
            periods = parsePeriods(pt);
            if (!weeks.length) {
              var wm = pt.match(/\)\s*([0-9,，\-~—\s单双]+周[^*]*)$/);
              if (wm) weeks = parseWeeks(wm[1]);
            }
          } else if (!weeks.length && /周/.test(pt)) {
            weeks = parseWeeks(pt);
          }
        }
      }
    } catch (e) {}

    var lines = text.split(/\n+/).map(clean).filter(Boolean);
    if (!name) {
      for (var li = 0; li < lines.length; li++) {
        var L = lines[li];
        if (!L) continue;
        if (/^(节\s*\/\s*周|节次|星期|周次|教师|老师|教室|地点|备注)$/.test(L)) continue;
        if (/^\(?\d+\s*[-~]\s*\d+\s*节\)?/.test(L) && L.length < 16) continue;
        if (/周/.test(L) && L.indexOf(' ') < 0 && L.length < 20) continue;
        if (L.length > 40) continue;
        name = L;
        break;
      }
    }
    if (!weeks.length) {
      for (var wi = 0; wi < lines.length; wi++) {
        if (/周/.test(lines[wi]) && !/周[一二三四五六日天]/.test(lines[wi])) {
          weeks = parseWeeks(lines[wi]);
          if (weeks.length) break;
        }
      }
    }
    if (!periods) {
      for (var pj = 0; pj < lines.length; pj++) {
        if (/节/.test(lines[pj])) {
          var pp = parsePeriods(lines[pj]);
          if (pp) { periods = pp; break; }
        }
      }
    }
    if (!teacher) {
      for (var ti = 0; ti < lines.length; ti++) {
        var TL = lines[ti];
        if (TL === name) continue;
        if (/老师|教师|讲师|教授$/.test(TL) && TL.length <= 24 && !/周/.test(TL)) { teacher = TL.replace(/^(老师|教师)[:：]?/, '').trim(); break; }
      }
      if (!teacher) {
        for (var tj = 0; tj < lines.length; tj++) {
          var T2 = lines[tj];
          if (T2 === name || /周|节/.test(T2) || T2.length > 20) continue;
          if (/楼|室|馆|场|校区|教室/.test(T2)) continue;
          teacher = T2;
          break;
        }
      }
    }
    if (!room) {
      for (var ri = lines.length - 1; ri >= 0; ri--) {
        var RL = lines[ri];
        if (RL === name || RL === teacher) continue;
        if (/楼|室|馆|场|校区|教室|实验/.test(RL) && RL.length <= 40) { room = RL; break; }
      }
    }
    if (!room && lines.length) {
      var wIdx = -1;
      for (var wi2 = 0; wi2 < lines.length; wi2++) {
        if (lines[wi2] !== name && lines[wi2] !== teacher && /周/.test(lines[wi2])) { wIdx = wi2; break; }
      }
      if (wIdx >= 0) {
        var after = lines[wIdx + 1];
        var before = lines[wIdx - 1];
        if (after && after !== name && after !== teacher && !/周/.test(after)) room = after;
        else if (before && before !== name && before !== teacher && !/周/.test(before)) room = before;
      } else if (lines.length >= 4) {
        var last = lines[lines.length - 1];
        if (last !== name && last !== teacher) room = last;
      }
    }
    if (room) {
      var rm = room.match(/^(.*?)[（(]([^（()）]*)[）)]\s*$/);
      if (rm) { room = clean(rm[1]); campus = clean(rm[2]); }
    }
    if (name) name = name.replace(/\(\s*[0-9A-Za-z._-]{3,}\s*\)\s*$/, '').trim();
    if (!name || !weeks.length) return out;

    var start = periods ? periods.start : fStart;
    var end = periods ? periods.end : fEnd;
    if (!start || start < 1 || start > 20) start = fStart;
    if (!end || end < start) end = start;
    var day = fDay || 0;
    if (!day) return out;

    out.push({
      name: name,
      teacher: teacher,
      code: '',
      section: '',
      courseCode: '',
      credits: '',
      note: '',
      day: day,
      startPeriod: start,
      endPeriod: end,
      weeks: weeks.slice(),
      room: room,
      campus: campus
    });
    return out;
  }

  function blocksInCell(cell, stats) {
    var blocks = [];
    try {
      var tcs = cell.querySelectorAll('.timetable_con');
      if (tcs.length) return Array.prototype.slice.call(tcs);
      var kb = cell.querySelectorAll('.kbcontent1,.kbcontent,.kbcontent2');
      if (kb.length) return Array.prototype.slice.call(kb);
      var divs = cell.querySelectorAll('div[id]');
      for (var i = 0; i < divs.length; i++) {
        var d = divs[i];
        if (textOf(d).trim()) { blocks.push(d); break; }
      }
      if (blocks.length) return blocks;
      if (textOf(cell).trim()) return [cell];
    } catch (e) {}
    return blocks;
  }

  function parseGrid(table, stats) {
    var out = [];
    var rows;
    try { rows = table.rows; } catch (e) { return out; }
    if (!rows || rows.length < 2) return out;
    var header = null;
    var dayMap = {};
    for (var r = 0; r < Math.min(rows.length, 4); r++) {
      var map = {};
      var count = 0;
      for (var c = 0; c < rows[r].cells.length; c++) {
        var d = parseDay(textOf(rows[r].cells[c]));
        if (d) { map[c] = d; count++; }
      }
      if (count >= 4) { header = r; dayMap = map; break; }
    }
    if (header === null) return out;
    stats.grids = (stats.grids || 0) + 1;
    for (var ri = header + 1; ri < rows.length; ri++) {
      var row = rows[ri];
      var rowPeriod = null;
      var firstText = row.cells.length ? textOf(row.cells[0]) : '';
      rowPeriod = parsePeriods(firstText);
      var rowIndexPeriod = ri - header;
      var bigStart = rowIndexPeriod * 2 - 1;
      var bigEnd = rowIndexPeriod * 2;
      for (var ci = 0; ci < row.cells.length; ci++) {
        var day = dayMap[ci] || 0;
        var cell = row.cells[ci];
        var cellPeriod = rowPeriod;
        var idm = String(cell.id || '').match(/^(\d+)[-_](\d+)$/);
        if (idm) {
          if (+idm[1] >= 1 && +idm[1] <= 7) day = +idm[1];
          if (!cellPeriod) cellPeriod = { start: +idm[2], end: +idm[2] };
        }
        if (!day) continue;
        var blocks = blocksInCell(cell, stats);
        for (var bi = 0; bi < blocks.length; bi++) {
          var bDay = day;
          var bStart = cellPeriod ? cellPeriod.start : bigStart;
          var bEnd = cellPeriod ? cellPeriod.end : bigEnd;
          var bm = String(blocks[bi].id || '').match(/^(\d+)[-_](\d+)$/);
          if (bm) {
            if (+bm[1] >= 1 && +bm[1] <= 7) bDay = +bm[1];
            bStart = (+bm[2]) * 2 - 1;
            bEnd = (+bm[2]) * 2;
          }
          var chunkText = textOf(blocks[bi]);
          var segments = splitCourseText(chunkText);
          for (var si = 0; si < segments.length; si++) {
            var parsed;
            if (segments.length > 1) {
              var temp = document.createElement('div');
              temp.textContent = segments[si];
              parsed = parseBlock(temp, bDay, bStart, bEnd, stats);
            } else {
              parsed = parseBlock(blocks[bi], bDay, bStart, bEnd, stats);
            }
            for (var qi = 0; qi < parsed.length; qi++) out.push(parsed[qi]);
          }
        }
      }
    }
    return out;
  }

  function parseJsArray(raw, stats) {
    var out = [];
    var text = String(raw || '').trim();
    if (!text) return out;
    var arr = null;
    try { arr = JSON.parse(text); } catch (e) {
      try {
        var repaired = text.replace(/,\s*([\]}])/g, '$1');
        arr = JSON.parse(repaired);
      } catch (e2) {
        try { arr = Function('return (' + text + ')')(); } catch (e3) { arr = null; }
      }
    }
    if (!arr) return out;
    if (!Array.isArray(arr)) {
      if (arr.kbList && Array.isArray(arr.kbList)) arr = arr.kbList;
      else if (arr.rows && Array.isArray(arr.rows)) arr = arr.rows;
      else if (arr.data && Array.isArray(arr.data)) arr = arr.data;
    }
    if (!Array.isArray(arr)) return out;
    for (var i = 0; i < arr.length; i++) {
      var o = arr[i];
      if (!o || typeof o !== 'object') continue;
      var name = clean(o.kcmc || o.courseName || o.name || o.title || o.kcmc_name || o.course);
      var teacher = clean(o.teaxms || o.xm || o.teacher || o.jsxm || o.skjs || o.teacherName);
      var room = clean(o.jxcdmcs || o.cdmc || o.room || o.location || o.jxdd || o.place);
      var day = parseDay(o.xq || o.xqj || o.day || o.weekday || o.weekDay || '');
      var periods = parsePeriods(o.jcdm2 || o.jc || o.jcs || o.periods || o.jcstr || o.section || '');
      var weeks = parseWeeks(o.zcs || o.zcd || o.weeks || o.zhou || o.zcmc || o.week || '');
      if (!day && o.xq) day = parseInt(o.xq, 10) || 0;
      if (!name || !day || !periods || !weeks.length) continue;
      var rm = room.match(/^(.*?)[（(]([^（()）]*)[）)]\s*$/);
      var campus = '';
      if (rm) { room = clean(rm[1]); campus = clean(rm[2]); }
      var code = clean(o.kch || o.kch_id || o.courseCode || o.code || o.kcdm);
      out.push({
        name: name,
        teacher: teacher,
        code: code,
        section: clean(o.kchxq || o.section || o.courseSection || code),
        courseCode: baseCode(code),
        credits: clean(o.xf || o.xfzk || o.credit || o.credits || o.creditValue || ''),
        note: clean(o.bz || o.bzxx || o.note || o.remark || ''),
        day: day,
        startPeriod: periods.start,
        endPeriod: periods.end,
        weeks: weeks,
        room: room,
        campus: campus
      });
    }
    if (out.length) stats.jsArrays = (stats.jsArrays || 0) + 1;
    return out;
  }

  function parseScripts(doc, stats) {
    var out = [];
    try {
      var scripts = doc.scripts || [];
      for (var i = 0; i < scripts.length; i++) {
        var t = scripts[i].textContent || '';
        if (t.length < 20) continue;
        var re = /(?:var\s+|window\.)?(kbxx|kblist|kbList|courseList|schedule|courses)\s*=\s*/g;
        var m;
        while ((m = re.exec(t))) {
          var start = m.index + m[0].length;
          var arrPos = t.indexOf('[', start);
          var objPos = t.indexOf('{', start);
          var bracket = -1;
          var openCh = '[';
          var closeCh = ']';
          if (arrPos >= 0 && (objPos < 0 || arrPos < objPos)) bracket = arrPos;
          else if (objPos >= 0) { bracket = objPos; openCh = '{'; closeCh = '}'; }
          if (bracket < 0) continue;
          var depth = 0, end = -1, q = null, esc = false;
          for (var j = bracket; j < t.length; j++) {
            var ch = t.charAt(j);
            if (q) {
              if (esc) esc = false;
              else if (ch === '\\') esc = true;
              else if (ch === q) q = null;
            } else if (ch === '"' || ch === "'") q = ch;
            else if (ch === openCh) depth++;
            else if (ch === closeCh) { depth--; if (depth === 0) { end = j + 1; break; } }
          }
          if (end > bracket) {
            var arr = parseJsArray(t.slice(bracket, end), stats);
            for (var k = 0; k < arr.length; k++) out.push(arr[k]);
          }
        }
      }
    } catch (e) {}
    return out;
  }

  function parseListTables(doc, stats) {
    var out = [];
    var tables = doc.querySelectorAll('table');
    for (var ti = 0; ti < tables.length; ti++) {
      var table = tables[ti];
      var rows = table.rows || [];
      if (rows.length < 2) continue;
      var header = null, cols = {};
      for (var r = 0; r < Math.min(rows.length, 3); r++) {
        var texts = [];
        for (var c = 0; c < rows[r].cells.length; c++) texts.push(clean(textOf(rows[r].cells[c])));
        var joined = texts.join('|');
        if (/课程名称|课程名/.test(joined) && /教师|老师|上课时间|周次|教室|地点/.test(joined)) {
          header = r;
          for (var ci = 0; ci < texts.length; ci++) {
            var h = texts[ci];
            if (/课程名称|课程名/.test(h)) cols.name = ci;
            else if (/教师|老师/.test(h)) cols.teacher = ci;
            else if (/教室|地点|上课地点/.test(h)) cols.room = ci;
            else if (/周次/.test(h)) cols.weeks = ci;
            else if (/时间|节次|上课时间/.test(h)) cols.time = ci;
            else if (/课程代码|课程号/.test(h)) cols.code = ci;
            else if (/学分/.test(h)) cols.credits = ci;
            else if (/备注/.test(h)) cols.note = ci;
          }
          break;
        }
      }
      if (header === null || cols.name == null || cols.time == null) continue;
      stats.listTables = (stats.listTables || 0) + 1;
      for (var rr = header + 1; rr < rows.length; rr++) {
        var cells = rows[rr].cells;
        var name = cols.name < cells.length ? clean(textOf(cells[cols.name])) : '';
        var teacher = cols.teacher != null && cols.teacher < cells.length ? clean(textOf(cells[cols.teacher])) : '';
        var room = cols.room != null && cols.room < cells.length ? clean(textOf(cells[cols.room])) : '';
        var time = cols.time < cells.length ? clean(textOf(cells[cols.time])) : '';
        var weekText = cols.weeks != null && cols.weeks < cells.length ? clean(textOf(cells[cols.weeks])) : '';
        if (!name || /课程名称/.test(name)) continue;
        var day = parseDay(time);
        var periods = parsePeriods(time);
        var weeks = parseWeeks(weekText || time);
        if (!day || !periods || !weeks.length) continue;
        out.push({
          name: name,
          teacher: teacher,
          code: cols.code != null && cols.code < cells.length ? clean(textOf(cells[cols.code])) : '',
          section: cols.code != null && cols.code < cells.length ? clean(textOf(cells[cols.code])) : '',
          courseCode: baseCode(cols.code != null && cols.code < cells.length ? clean(textOf(cells[cols.code])) : ''),
          credits: cols.credits != null && cols.credits < cells.length ? clean(textOf(cells[cols.credits])) : '',
          note: cols.note != null && cols.note < cells.length ? clean(textOf(cells[cols.note])) : '',
          day: day,
          startPeriod: periods.start,
          endPeriod: periods.end,
          weeks: weeks,
          room: room,
          campus: ''
        });
      }
    }
    return out;
  }

  function collectDocs(doc, list, depth) {
    if (!doc || depth > 4 || list.indexOf(doc) >= 0) return;
    list.push(doc);
    var frames = [];
    try { frames = doc.querySelectorAll('iframe,frame') || []; } catch (e) {}
    for (var i = 0; i < frames.length; i++) {
      var d = null;
      try { d = frames[i].contentDocument; } catch (e) {}
      if (d) collectDocs(d, list, depth + 1);
    }
  }

  function merge(courses) {
    var out = [];
    for (var i = 0; i < courses.length; i++) {
      var c = courses[i];
      if (!c || !c.name || !c.weeks || !c.weeks.length) continue;
      var found = null;
      for (var j = 0; j < out.length; j++) {
        var o = out[j];
        if (o.name === c.name && o.day === c.day && o.startPeriod === c.startPeriod &&
            o.endPeriod === c.endPeriod && o.room === c.room && o.weeks.join(',') === c.weeks.join(',')) {
          found = o;
          break;
        }
      }
      if (found) {
        if (!found.teacher && c.teacher) found.teacher = c.teacher;
        continue;
      }
      out.push(c);
    }
    var grouped = {};
    var merged = [];
    for (var m = 0; m < out.length; m++) {
      var x = out[m];
      var key = [x.name, x.day, x.room, x.weeks.join(','), x.teacher, x.code].join('|');
      if (!grouped[key]) { grouped[key] = x; merged.push(x); }
      else {
        var g = grouped[key];
        if (x.startPeriod <= g.endPeriod + 1 && x.endPeriod >= g.startPeriod - 1) {
          g.startPeriod = Math.min(g.startPeriod, x.startPeriod);
          g.endPeriod = Math.max(g.endPeriod, x.endPeriod);
        } else {
          merged.push(x);
        }
      }
    }
    merged.sort(function (a, b) {
      if (a.day !== b.day) return a.day - b.day;
      if (a.startPeriod !== b.startPeriod) return a.startPeriod - b.startPeriod;
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return merged;
  }

  var stats = { frames: 0, tables: 0, grids: 0, jsArrays: 0, listTables: 0, courses: 0, sample: '' };
  var docs = [];
  collectDocs(document, docs, 0);
  stats.frames = docs.length;
  var all = [];
  for (var di = 0; di < docs.length; di++) {
    var doc = docs[di];
    var tables = [];
    try { tables = doc.querySelectorAll('table') || []; } catch (e) {}
    stats.tables += tables.length;
    for (var ti = 0; ti < tables.length; ti++) {
      var g = parseGrid(tables[ti], stats);
      for (var gi = 0; gi < g.length; gi++) all.push(g[gi]);
      var l = parseListTables({ querySelectorAll: function () { return [tables[ti]]; } }, stats);
      for (var li = 0; li < l.length; li++) all.push(l[li]);
    }
    var js = parseScripts(doc, stats);
    for (var ji = 0; ji < js.length; ji++) all.push(js[ji]);
    if (!stats.sample) {
      try {
        var first = doc.body ? clean(textOf(doc.body)).slice(0, 240) : '';
        if (first) stats.sample = first;
      } catch (e) {}
    }
  }
  var courses = merge(all);
  for (var ci2 = 0; ci2 < courses.length; ci2++) normalizeCourse(courses[ci2]);
  var catalog = buildCatalog(courses);
  var meta = collectMeta(docs);
  stats.courses = courses.length;
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
  try {
    if (window.EamsBridge && typeof EamsBridge.onCourses === 'function') {
      EamsBridge.onCourses(JSON.stringify(result));
    }
    if (window.EamsBridge && typeof EamsBridge.onDebug === 'function') {
      EamsBridge.onDebug(JSON.stringify({
        frames: stats.frames, tables: stats.tables, grids: stats.grids,
        jsArrays: stats.jsArrays, listTables: stats.listTables,
        courses: stats.courses, sample: stats.sample,
        title: result.title, url: result.url
      }));
    }
  } catch (e) {}
})();
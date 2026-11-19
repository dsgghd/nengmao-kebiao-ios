/* 课程表 xlsx 解析器 —— 纯浏览器端，无上传 */
(function (global) {
  'use strict';

  var MAX_WEEK = 30;
  var WEEKDAY_EN = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/\u00a0/g, ' ')
      .replace(/\u3000/g, ' ')
      .replace(/\r/g, '')
      .replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
      .replace(/[（]/g, '(')
      .replace(/[）]/g, ')')
      .replace(/[，]/g, ',')
      .replace(/[：]/g, ':')
      .replace(/[；]/g, ';')
      .replace(/[－—–]/g, '-')
      .replace(/[～]/g, '~');
  }

  function clean(s) {
    return normalize(s)
      .replace(/[ \t]+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }

  function cellText(ws, r, c) {
    var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })];
    if (!cell) return '';
    var v = cell.v;
    if (v == null) v = cell.w;
    return clean(v);
  }

  function parseCnNumber(raw) {
    var s = clean(raw);
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var digits = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    if (s === '十') return 10;
    if (s.indexOf('十') >= 0) {
      var parts = s.split('十');
      var high = parts[0] ? (digits[parts[0]] || 0) : 1;
      var low = parts[1] ? (digits[parts[1]] || 0) : 0;
      return high * 10 + low;
    }
    return digits[s] || null;
  }

  function parseWeekday(text) {
    var s = clean(text).toLowerCase();
    if (!s) return null;
    var m = s.match(/(?:星期|周|礼拜)\s*([一二三四五六日天])/);
    if (m) {
      if (m[1] === '日' || m[1] === '天') return 7;
      return { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 }[m[1]] || null;
    }
    for (var k in WEEKDAY_EN) {
      if (s.indexOf(k) >= 0) return WEEKDAY_EN[k];
    }
    return null;
  }

  function parseWeekdays(text) {
    var s = clean(text);
    var out = [];
    var re = /(?:星期|周|礼拜)\s*([一二三四五六日天])/g;
    var m;
    while ((m = re.exec(s))) {
      var d = m[1] === '日' || m[1] === '天' ? 7 : ({ '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 }[m[1]] || null);
      if (d && out.indexOf(d) < 0) out.push(d);
    }
    if (!out.length) {
      var lower = s.toLowerCase();
      for (var k in WEEKDAY_EN) {
        if (lower.indexOf(k) >= 0 && out.indexOf(WEEKDAY_EN[k]) < 0) out.push(WEEKDAY_EN[k]);
      }
    }
    if (!out.length && /^[1-7]$/.test(s)) out.push(parseInt(s, 10));
    return out;
  }

  function parseWeeks(raw) {
    var s = clean(raw);
    var result = { weeks: [], parity: null };
    if (!s) return result;

    var hasOdd = /单/.test(s);
    var hasEven = /双/.test(s);
    if (hasOdd && !hasEven) result.parity = 'odd';
    if (hasEven && !hasOdd) result.parity = 'even';

    var t = s
      .replace(/第/g, ' ')
      .replace(/周/g, ' ')
      .replace(/学期/g, ' ')
      .replace(/单周|双周|单|双/g, ' ')
      .replace(/[,;、]/g, ' ');

    var weeks = {};
    var rangeRe = /(\d{1,2})\s*[-~至]\s*(\d{1,2})/g;
    var m;
    while ((m = rangeRe.exec(t))) {
      var a = parseInt(m[1], 10);
      var b = parseInt(m[2], 10);
      if (a > b) { var tmp = a; a = b; b = tmp; }
      for (var w = a; w <= b; w++) weeks[w] = true;
    }

    var rest = t.replace(rangeRe, ' ');
    var singleRe = /\d{1,2}/g;
    while ((m = singleRe.exec(rest))) weeks[parseInt(m[0], 10)] = true;

    var arr = Object.keys(weeks)
      .map(function (x) { return parseInt(x, 10); })
      .filter(function (w) { return w >= 1 && w <= MAX_WEEK; })
      .sort(function (a, b) { return a - b; });

    if (result.parity === 'odd') arr = arr.filter(function (w) { return w % 2 === 1; });
    if (result.parity === 'even') arr = arr.filter(function (w) { return w % 2 === 0; });
    result.weeks = arr;
    return result;
  }

  function parsePeriodLabel(text) {
    var s = clean(text);
    var m = s.match(/第\s*([一二三四五六七八九十两\d]+)\s*(?:大)?节/);
    if (m) return parseCnNumber(m[1]);
    if (/^\d{1,2}$/.test(s)) return parseInt(s, 10);
    m = s.match(/^([一二三四五六七八九十]{1,3})$/);
    if (m) return parseCnNumber(m[1]);
    return null;
  }

  function parsePeriodRanges(text) {
    var s = clean(text);
    if (!s) return [];
    var out = [];
    var rangeRe = /(\d{1,2})\s*[-~至]\s*(\d{1,2})/g;
    var m;
    var foundRange = false;
    while ((m = rangeRe.exec(s))) {
      foundRange = true;
      var a = parseInt(m[1], 10);
      var b = parseInt(m[2], 10);
      if (a > b) { var t = a; a = b; b = t; }
      out.push({ start: Math.max(1, a), end: Math.min(MAX_WEEK, b) });
    }
    if (foundRange) return out;

    var nums = (s.match(/\d{1,2}/g) || []).map(function (x) { return parseInt(x, 10); });
    if (!nums.length) {
      var cn = s.match(/第?\s*([一二三四五六七八九十]{1,2})\s*[-~至]?\s*([一二三四五六七八九十]{1,2})?\s*节/);
      if (cn) {
        var a2 = parseCnNumber(cn[1]);
        var b2 = cn[2] ? parseCnNumber(cn[2]) : a2;
        if (a2) out.push({ start: Math.min(a2, b2 || a2), end: Math.max(a2, b2 || a2) });
      }
      return out;
    }
    out.push({ start: Math.min.apply(null, nums), end: Math.max.apply(null, nums) });
    return out;
  }

  function parseRoom(raw) {
    var s = clean(raw);
    if (!s) return { room: '', campus: '' };

    var open = (s.match(/\(/g) || []).length;
    var close = (s.match(/\)/g) || []).length;
    while (close > open && /\)$/.test(s)) {
      s = s.replace(/\)$/, '');
      close--;
    }

    var campus = '';
    var cm = s.match(/\(([^()]*校区)\)?\s*$/);
    if (cm) {
      campus = clean(cm[1]);
      s = s.slice(0, cm.index).trim();
    }
    s = s.replace(/[;,]\s*$/, '').trim();
    return { room: s, campus: campus };
  }

  function parseTeacher(raw) {
    var s = clean(raw);
    if (!s) return '';
    // 只去掉最外层一对括号，保留“陈婷婷(兼职)”这类内部括号
    s = s.replace(/^\(\s*/, '').replace(/\s*\)$/, '');
    return s.trim();
  }

  function looksLikeSchedule(line) {
    var s = clean(line);
    if (!/^\(/.test(s)) return false;
    if (/\d/.test(s) && /,/.test(s)) return true;
    if (/\d/.test(s) && /周/.test(s)) return true;
    return false;
  }

  function looksLikeTeacher(line) {
    var s = clean(line);
    if (!/^\(.*\)$/.test(s)) return false;
    if (looksLikeSchedule(s)) return false;
    return !/\d/.test(s) || s.length < 8;
  }

  function parseSchedule(raw) {
    var s = clean(raw).replace(/^\(+\s*/, '');
    var comma = s.search(/,/);
    var weeksPart = '';
    var roomPart = '';

    if (comma >= 0) {
      weeksPart = s.slice(0, comma);
      roomPart = s.slice(comma + 1);
    } else {
      var m = s.match(/^([第\d\s\-~至、,()单双周]+?)\s+(.+)$/);
      if (m) {
        weeksPart = m[1];
        roomPart = m[2];
      } else {
        weeksPart = s;
      }
    }

    var parsedWeeks = parseWeeks(weeksPart);
    var parsedRoom = parseRoom(roomPart);
    return {
      weeks: parsedWeeks.weeks,
      parity: parsedWeeks.parity,
      room: parsedRoom.room,
      campus: parsedRoom.campus
    };
  }

  var COURSE_LINE_RE = /^(.+?)\s*\(\s*([0-9A-Za-z]{6,}(?:\.[0-9A-Za-z]+)?)\s*\)\s*(.*)$/;
  var NOISE_RE = /^(上午|下午|晚上|中午|午休|备注|说明|无|节次|周次|课程表|个人课程表)$/;

  function isNoiseLine(line) {
    var s = clean(line);
    if (!s) return true;
    if (NOISE_RE.test(s)) return true;
    if (/课表格式说明/.test(s)) return true;
    return false;
  }

  function parseCourseCell(rawText) {
    var text = String(rawText == null ? '' : rawText).replace(/\r/g, '');
    var lines = text.split('\n').map(clean).filter(function (x) { return !!x; });
    var entries = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (looksLikeSchedule(line) || isNoiseLine(line) || looksLikeTeacher(line)) {
        i++;
        continue;
      }

      var name = '';
      var code = '';
      var rest = '';
      var m = line.match(COURSE_LINE_RE);

      if (m) {
        name = m[1];
        code = m[2];
        rest = m[3] || '';
      } else {
        var idx = line.search(/\(\s*[0-9A-Za-z]{6,}(?:\.[0-9A-Za-z]+)?\s*\)/);
        if (idx > 0) {
          name = line.slice(0, idx).trim();
          var tail = line.slice(idx).trim();
          var cm = tail.match(/^\(\s*([0-9A-Za-z]{6,}(?:\.[0-9A-Za-z]+)?)\s*\)\s*(.*)$/);
          if (cm) { code = cm[1]; rest = cm[2] || ''; }
        } else {
          name = line.trim();
        }
      }

      name = name.replace(/^[\s*·]+|[\s*·]+$/g, '').trim();
      if (!name || name.length > 100 || !/[\u4e00-\u9fa5A-Za-z]/.test(name)) {
        i++;
        continue;
      }

      var inlineSchedule = null;
      var schedIdx = rest.search(/\(\s*\d{1,2}\s*(?:[-~至]\s*\d{1,2})?\s*,/);
      if (schedIdx >= 0) {
        inlineSchedule = rest.slice(schedIdx);
        rest = rest.slice(0, schedIdx);
      }

      var teacher = parseTeacher(rest);
      var weeks = [];
      var room = '';
      var campus = '';
      var weeksUnknown = true;
      var parity = null;

      if (inlineSchedule) {
        var sched = parseSchedule(inlineSchedule);
        weeks = sched.weeks;
        room = sched.room;
        campus = sched.campus;
        parity = sched.parity;
        weeksUnknown = weeks.length === 0;
      } else {
        var j = i + 1;
        while (j < lines.length) {
          var next = lines[j];
          if (looksLikeSchedule(next)) {
            var sched2 = parseSchedule(next);
            weeks = sched2.weeks;
            room = sched2.room;
            campus = sched2.campus;
            parity = sched2.parity;
            weeksUnknown = weeks.length === 0;
            j++;
            break;
          }
          if (!teacher && looksLikeTeacher(next)) {
            teacher = parseTeacher(next);
            j++;
            continue;
          }
          break;
        }
        i = Math.max(i, j - 1);
      }

      entries.push({
        name: name,
        code: code,
        teacher: teacher,
        weeks: weeks,
        parity: parity,
        room: room,
        campus: campus,
        weeksUnknown: weeksUnknown
      });
      i++;
    }

    return entries;
  }

  function buildMergeIndex(ws) {
    var byStart = {};
    var covered = {};
    var merges = ws['!merges'] || [];
    for (var i = 0; i < merges.length; i++) {
      var m = merges[i];
      byStart[m.s.r + ',' + m.s.c] = m;
      for (var r = m.s.r; r <= m.e.r; r++) {
        for (var c = m.s.c; c <= m.e.c; c++) {
          if (r !== m.s.r || c !== m.s.c) covered[r + ',' + c] = true;
        }
      }
    }
    return { byStart: byStart, covered: covered };
  }

  function findHeader(ws, maxR, maxC) {
    var best = null;
    var limit = Math.min(maxR, 60);
    for (var r = 0; r <= limit; r++) {
      var dayCols = [];
      for (var c = 0; c <= maxC; c++) {
        var d = parseWeekday(cellText(ws, r, c));
        if (d) dayCols.push({ day: d, col: c });
      }
      // 去重，保留每天第一次出现的列
      var seen = {};
      dayCols = dayCols.filter(function (x) {
        if (seen[x.day]) return false;
        seen[x.day] = true;
        return true;
      });
      if (dayCols.length >= 5 && (!best || dayCols.length > best.dayCols.length)) {
        best = { row: r, dayCols: dayCols };
        if (dayCols.length === 7) break;
      }
    }
    return best;
  }

  function findPeriodColumn(ws, header, maxR, maxC) {
    var minDayCol = Math.min.apply(null, header.dayCols.map(function (x) { return x.col; }));
    var best = null;
    for (var c = 0; c < minDayCol; c++) {
      var strong = 0;
      var weak = 0;
      for (var r = header.row + 1; r <= maxR; r++) {
        var text = cellText(ws, r, c);
        var p = parsePeriodLabel(text);
        if (!p) continue;
        if (/第\s*[一二三四五六七八九十两\d]+\s*(?:大)?节/.test(text)) strong++;
        else weak++;
      }
      var score = strong * 10 + weak;
      if (score >= 3 && (!best || score > best.score)) {
        best = { col: c, score: score };
      }
    }
    return best;
  }

  function headerMap(ws, r, maxC) {
    var map = {};
    for (var c = 0; c <= maxC; c++) {
      var t = cellText(ws, r, c).replace(/\s/g, '');
      if (!t) continue;
      if (/课程名称|课程名/.test(t)) map.name = c;
      else if (/课程代码|课程编号/.test(t)) map.code = c;
      else if (/课程序号/.test(t)) map.section = c;
      else if (/学分/.test(t)) map.credits = c;
      else if (/课程安排/.test(t)) map.arrangement = c;
      else if (/教师|老师|任课/.test(t)) map.teacher = c;
      else if (/备注/.test(t)) map.note = c;
      else if (/星期|周几|上课星期/.test(t)) map.day = c;
      else if (/节次|上课节|节/.test(t)) map.period = c;
      else if (/周次|周数|上课周/.test(t)) map.weeks = c;
      else if (/教室|地点|上课地点/.test(t)) map.room = c;
      else if (/校区/.test(t)) map.campus = c;
    }
    return map;
  }

  function findRow(ws, maxR, maxC, predicate) {
    for (var r = 0; r <= maxR; r++) {
      for (var c = 0; c <= maxC; c++) {
        if (predicate(cellText(ws, r, c))) return r;
      }
    }
    return -1;
  }

  function parseMeta(ws, headerRow, maxC) {
    var chunks = [];
    for (var r = 0; r < headerRow; r++) {
      for (var c = 0; c <= maxC; c++) {
        var t = cellText(ws, r, c);
        if (t) chunks.push(t);
      }
    }
    var text = chunks.join(' | ');
    var semesterM = text.match(/(\d{4}\s*[-]\s*\d{4}\s*学年\s*第[一二12]学期)/);
    var nameM = text.match(/学生姓名\s*:\s*([^\s|]+)/);
    var idM = text.match(/学号\s*:\s*([A-Za-z0-9]+)/);
    var classM = text.match(/(?:所属班级|班级)\s*:\s*([^\s|]+)/);
    var creditM = text.match(/总学分\s*:\s*(\d+(?:\.\d+)?)/);
    return {
      title: chunks.length ? chunks[0] : '',
      semester: semesterM ? semesterM[1].replace(/\s+/g, '') : '',
      studentName: nameM ? nameM[1] : '',
      studentId: idM ? idM[1] : '',
      className: classM ? classM[1] : '',
      totalCredits: creditM ? creditM[1] : ''
    };
  }

  function parseCatalog(ws, maxR, maxC, sectionRow) {
    var bySection = {};
    var byCode = {};
    var list = [];
    if (sectionRow < 0) return { bySection: bySection, byCode: byCode, list: list };

    for (var hr = sectionRow + 1; hr <= Math.min(maxR, sectionRow + 4); hr++) {
      var map = headerMap(ws, hr, maxC);
      if (map.name == null || (map.code == null && map.section == null)) continue;

      for (var r = hr + 1; r <= maxR; r++) {
        var name = cellText(ws, r, map.name);
        if (!name) {
          var any = false;
          for (var key in map) {
            if (cellText(ws, r, map[key])) { any = true; break; }
          }
          if (!any) break;
          continue;
        }
        if (/课程列表|实践专周/.test(name)) break;

        var rec = {
          name: name,
          code: map.code != null ? cellText(ws, r, map.code) : '',
          section: map.section != null ? cellText(ws, r, map.section) : '',
          teacher: map.teacher != null ? cellText(ws, r, map.teacher) : '',
          credits: map.credits != null ? cellText(ws, r, map.credits) : ''
        };
        list.push(rec);
        if (rec.section) bySection[rec.section] = rec;
        if (rec.code) byCode[rec.code] = rec;
      }
      break;
    }
    return { bySection: bySection, byCode: byCode, list: list };
  }

  function parsePracticeArrangement(text) {
    var out = [];
    var segments = String(text).split(/(?=第\s*\d+\s*周)/);
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var wm = seg.match(/第\s*(\d+)\s*周/);
      if (!wm) continue;
      var week = parseInt(wm[1], 10);
      var brackets = [];
      var re = /\[([^\]]+)\]/g;
      var bm;
      while ((bm = re.exec(seg))) brackets.push(bm[1]);

      if (!brackets.length) {
        out.push({ week: week, allWeek: true });
        continue;
      }

      var any = false;
      for (var j = 0; j < brackets.length; j++) {
        var b = brackets[j];
        if (/全周/.test(b)) {
          out.push({ week: week, allWeek: true });
          any = true;
          continue;
        }
        var dm = b.match(/周\s*([一二三四五六日天1-7])\s*(\d+)\s*[-~至]\s*(\d+)\s*小节/);
        if (dm) {
          var day = /^[1-7]$/.test(dm[1]) ? parseInt(dm[1], 10) : parseWeekday('周' + dm[1]);
          out.push({
            week: week,
            allWeek: false,
            day: day,
            start: parseInt(dm[2], 10),
            end: parseInt(dm[3], 10)
          });
          any = true;
        }
      }
      if (!any) out.push({ week: week, allWeek: true });
    }
    return out;
  }

  function parsePractice(ws, maxR, maxC) {
    var sectionRow = findRow(ws, maxR, maxC, function (t) {
      return /实践/.test(t) && /课程/.test(t) && /(列表|安排)/.test(t);
    });
    if (sectionRow < 0) return [];

    var headerRow = -1;
    var map = null;
    for (var hr = sectionRow + 1; hr <= Math.min(maxR, sectionRow + 3); hr++) {
      var m = headerMap(ws, hr, maxC);
      if (m.name != null && m.arrangement != null) { headerRow = hr; map = m; break; }
    }
    if (headerRow < 0) return [];

    var records = {};
    var order = [];

    for (var r = headerRow + 1; r <= maxR; r++) {
      var name = cellText(ws, r, map.name);
      var arr = cellText(ws, r, map.arrangement);
      if (!name && !arr) {
        var any = false;
        for (var key in map) {
          if (cellText(ws, r, map[key])) { any = true; break; }
        }
        if (!any) break;
        continue;
      }
      if (!name || !arr) continue;
      if (/课程列表|实践专周/.test(name)) break;

      var code = map.code != null ? cellText(ws, r, map.code) : '';
      var section = map.section != null ? cellText(ws, r, map.section) : '';
      var teacher = map.teacher != null ? cellText(ws, r, map.teacher) : '';
      var credits = map.credits != null ? cellText(ws, r, map.credits) : '';
      var parsed = parsePracticeArrangement(arr);

      for (var p = 0; p < parsed.length; p++) {
        var item = parsed[p];
        var key = [name, code, item.allWeek ? 'ALL' : 'D' + item.day + '-' + item.start + '-' + item.end].join('|');
        if (!records[key]) {
          records[key] = {
            name: name,
            code: code,
            section: section,
            teacher: teacher,
            credits: credits,
            weeks: [],
            allWeek: item.allWeek,
            day: item.allWeek ? null : item.day,
            startPeriod: item.allWeek ? null : item.start,
            endPeriod: item.allWeek ? null : item.end,
            raw: arr
          };
          order.push(key);
        }
        if (records[key].weeks.indexOf(item.week) < 0) records[key].weeks.push(item.week);
      }
    }

    var out = [];
    for (var i = 0; i < order.length; i++) {
      var rec = records[order[i]];
      rec.weeks.sort(function (a, b) { return a - b; });
      rec.id = 'p_' + i;
      out.push(rec);
    }
    return out;
  }

  function enrich(entry, catalog) {
    if (!catalog) return;
    var sec = entry.code || entry.section || '';
    var base = sec ? sec.split('.')[0] : '';
    var cat = (sec && catalog.bySection[sec]) || (base && catalog.byCode[base]);
    if (!cat) return;
    if (cat.name) entry.name = cat.name;
    if (!entry.teacher && cat.teacher) entry.teacher = cat.teacher;
    if (!entry.credits && cat.credits) entry.credits = cat.credits;
    if (!entry.code && cat.section) entry.code = cat.section;
  }

  function hashId(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
  }

  function parseGridSheet(ws, maxR, maxC, header, warnings) {
    var mergeIndex = buildMergeIndex(ws);
    var periodCol = findPeriodColumn(ws, header, maxR, maxC);
    var periodByRow = {};
    var lastPeriodRow = maxR;

    if (periodCol) {
      // 只认表头之后连续递增的节次序列；课程列表里的“1、2、3…”会重新开始，必须截断
      var lastPeriod = 0;
      var lastLabelRow = header.row;
      for (var pr = header.row + 1; pr <= maxR; pr++) {
        var pv = parsePeriodLabel(cellText(ws, pr, periodCol.col));
        if (!pv) continue;
        if (pv > lastPeriod && pv <= lastPeriod + 4) {
          periodByRow[pr] = pv;
          lastPeriod = pv;
          lastLabelRow = pr;
        } else {
          break;
        }
      }
      if (lastLabelRow > header.row) lastPeriodRow = lastLabelRow;
    } else {
      warnings.push('没有识别到“第 X 节”的节次标签，已按行号估算节次，建议导入后在设置中核对。');
      for (var rr = header.row + 1; rr <= maxR; rr++) periodByRow[rr] = rr - header.row;
    }

    var blocks = [];
    var seenIds = {};

    for (var r = header.row + 1; r <= lastPeriodRow; r++) {
      for (var d = 0; d < header.dayCols.length; d++) {
        var dc = header.dayCols[d];
        var key = r + ',' + dc.col;
        if (mergeIndex.covered[key]) continue;

        var text = cellText(ws, r, dc.col);
        if (!text) continue;
        if (parseWeekday(text)) continue;
        if (isNoiseLine(text)) continue;

        var merge = mergeIndex.byStart[key];
        var endR = merge ? merge.e.r : r;
        var startPeriod = periodByRow[r] || (r - header.row);
        var endPeriod = periodByRow[endR] || startPeriod + Math.max(0, endR - r);
        if (endPeriod < startPeriod) { var tmp = startPeriod; startPeriod = endPeriod; endPeriod = tmp; }
        endPeriod = Math.min(endPeriod, startPeriod + 20);

        var entries = parseCourseCell(text);
        if (!entries.length) {
          warnings.push('第 ' + (r + 1) + ' 行 ' + XLSX.utils.encode_col(dc.col) + ' 列的单元格有内容但未识别出课程。');
          continue;
        }

        for (var e = 0; e < entries.length; e++) {
          var entry = entries[e];
          if (entry.weeksUnknown) {
            warnings.push('课程“' + entry.name + '”没有识别到周次，暂按全学期显示。');
          }
          var idBase = [entry.name, entry.code, dc.day, startPeriod, endPeriod, entry.room, entry.weeks.join('-')].join('|');
          var id = 'b_' + hashId(idBase);
          if (seenIds[id]) id = id + '_' + e;
          seenIds[id] = true;
          blocks.push({
            id: id,
            name: entry.name,
            code: entry.code,
            section: entry.code,
            teacher: entry.teacher,
            day: dc.day,
            startPeriod: startPeriod,
            endPeriod: endPeriod,
            weeks: entry.weeks,
            weeksUnknown: entry.weeksUnknown,
            room: entry.room,
            campus: entry.campus,
            credits: '',
            source: 'grid'
          });
        }
      }
    }

    return blocks;
  }

  function parseListSheet(ws, maxR, maxC, warnings) {
    var headerRow = -1;
    var map = null;
    for (var r = 0; r <= Math.min(maxR, 60); r++) {
      var m = headerMap(ws, r, maxC);
      var hasDayValue = false;
      if (m.name != null && m.day != null) {
        for (var rr = r + 1; rr <= Math.min(maxR, r + 3); rr++) {
          if (parseWeekdays(cellText(ws, rr, m.day)).length) { hasDayValue = true; break; }
        }
      }
      if (m.name != null && m.period != null && (m.day != null || hasDayValue)) {
        headerRow = r;
        map = m;
        break;
      }
    }
    if (headerRow < 0) return null;

    warnings.push('已按“一行一门课”的列表格式解析。');
    var blocks = [];
    var seenIds = {};

    for (var row = headerRow + 1; row <= maxR; row++) {
      var name = cellText(ws, row, map.name);
      if (!name) {
        var any = false;
        for (var key in map) {
          if (cellText(ws, row, map[key])) { any = true; break; }
        }
        if (!any) break;
        continue;
      }
      if (/课程列表|实践专周/.test(name)) break;

      var days = parseWeekdays(cellText(ws, row, map.day));
      var periodText = cellText(ws, row, map.period);
      var ranges = parsePeriodRanges(periodText);
      if (!days.length || !ranges.length) continue;

      var code = map.code != null ? cellText(ws, row, map.code) : '';
      var teacher = map.teacher != null ? cellText(ws, row, map.teacher) : '';
      var weeksText = map.weeks != null ? cellText(ws, row, map.weeks) : '';
      var weeks = parseWeeks(weeksText).weeks;
      var roomRaw = map.room != null ? cellText(ws, row, map.room) : '';
      var campus = map.campus != null ? cellText(ws, row, map.campus) : '';
      var roomParsed = parseRoom(roomRaw);

      for (var di = 0; di < days.length; di++) {
        for (var pi = 0; pi < ranges.length; pi++) {
          var range = ranges[pi];
          var idBase = [name, code, days[di], range.start, range.end, roomParsed.room, weeks.join('-')].join('|');
          var id = 'b_' + hashId(idBase);
          if (seenIds[id]) id = id + '_' + di + '_' + pi;
          seenIds[id] = true;
          blocks.push({
            id: id,
            name: name,
            code: code,
            section: code,
            teacher: teacher,
            day: days[di],
            startPeriod: range.start,
            endPeriod: range.end,
            weeks: weeks,
            weeksUnknown: weeks.length === 0,
            room: roomParsed.room,
            campus: campus || roomParsed.campus,
            credits: '',
            source: 'list'
          });
        }
      }
    }

    return blocks.length ? blocks : null;
  }

  function finalize(result) {
    var allWeeks = [];
    result.blocks.forEach(function (b) { allWeeks = allWeeks.concat(b.weeks); });
    result.practice.forEach(function (p) { allWeeks = allWeeks.concat(p.weeks); });

    var maxWeek = allWeeks.length ? Math.max.apply(null, allWeeks) : 0;
    var minWeek = allWeeks.length ? Math.min.apply(null, allWeeks) : 0;
    var courseKeys = {};
    result.blocks.forEach(function (b) { courseKeys[b.code || b.name] = true; });
    result.practice.forEach(function (p) { courseKeys[p.code || p.name] = true; });

    result.stats = {
      blocks: result.blocks.length,
      courses: Object.keys(courseKeys).length,
      practice: result.practice.length,
      minWeek: minWeek,
      maxWeek: Math.max(20, maxWeek),
      actualMaxWeek: maxWeek
    };

    var deduped = [];
    var seen = {};
    result.warnings.forEach(function (w) {
      if (!seen[w]) { seen[w] = true; deduped.push(w); }
    });
    result.warnings = deduped;
    return result;
  }

  function parseSheet(ws, sheetName, fileName) {
    var range = global.XLSX.utils.decode_range(ws['!ref']);
    var maxR = range.e.r;
    var maxC = range.e.c;
    var warnings = [];
    var header = findHeader(ws, maxR, maxC);
    var blocks = null;

    if (header) {
      blocks = parseGridSheet(ws, maxR, maxC, header, warnings);
    } else {
      blocks = parseListSheet(ws, maxR, maxC, warnings);
    }

    if (!blocks || !blocks.length) {
      throw new Error('没有识别到课程');
    }

    var meta = header ? parseMeta(ws, header.row, maxC) : parseMeta(ws, 0, maxC);
    var catalogRow = findRow(ws, maxR, maxC, function (t) {
      return /课程列表/.test(t) && !/实践/.test(t);
    });
    var catalog = parseCatalog(ws, maxR, maxC, catalogRow);
    var practice = parsePractice(ws, maxR, maxC);

    blocks.forEach(function (b) { enrich(b, catalog); });
    practice.forEach(function (p) { enrich(p, catalog); });

    if (!catalog.list.length) warnings.push('没有找到“课程列表”表格，学分信息可能缺失。');
    if (!practice.length) warnings.push('没有找到“实践专周”安排，整周实践课不会显示。');

    var result = {
      meta: meta,
      blocks: blocks,
      practice: practice,
      catalog: catalog.list,
      warnings: warnings,
      sheetName: sheetName,
      fileName: fileName || ''
    };

    result.meta.sheetName = sheetName;
    result.meta.fileName = fileName || '';
    return result;
  }

  function parseWorkbook(arrayBuffer, fileName) {
    if (!global.XLSX) throw new Error('xlsx 解析库没有加载成功。');
    var wb = global.XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
    if (!wb.SheetNames || !wb.SheetNames.length) throw new Error('文件里没有工作表。');

    var best = null;
    var errors = [];

    for (var i = 0; i < wb.SheetNames.length; i++) {
      var name = wb.SheetNames[i];
      var ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) continue;
      try {
        var result = parseSheet(ws, name, fileName);
        if (!best || result.blocks.length > best.blocks.length) best = result;
      } catch (e) {
        errors.push(name + '：' + (e && e.message ? e.message : '解析失败'));
      }
    }

    if (!best) {
      var detail = errors.length ? '\n' + errors.slice(0, 3).join('\n') : '';
      throw new Error('没有识别到课程。请确认文件是“星期 × 节次”的课程表，或包含课程名称、星期、节次的列表。' + detail);
    }

    return finalize(best);
  }

  global.TTParser = {
    parseWorkbook: parseWorkbook,
    parseWeeks: parseWeeks,
    parseWeekday: parseWeekday,
    parsePeriodRanges: parsePeriodRanges,
    _internal: {
      parseCourseCell: parseCourseCell,
      parseSchedule: parseSchedule,
      parseRoom: parseRoom,
      parsePracticeArrangement: parsePracticeArrangement
    }
  };
})(window);
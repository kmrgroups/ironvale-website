/* ============================================================================
   kpi.js — the KPI dashboards, shared engine.

   Three things live here and nothing else:

   1. A chart engine that draws plain SVG (bar, grouped bar, line, pie, radar,
      pareto). No library, no build step, no network call — the same rule the
      rest of this platform follows.

   2. A registry of every KPI the business reviews, by department. Each entry
      says what it is measured in, how it should be drawn, and — the part that
      matters — WHERE ITS NUMBER COMES FROM.

   3. The two ways a number can arrive:
        derived  — computed from records already in the database (production
                   bookings, inward inspections, orders, gauges, attendance).
                   Nobody types it, so nobody can massage it.
        entered  — a monthly plan and actual typed on the KPI Data Entry
                   screen, because the system holds no record to compute it
                   from. Budgets and audit calendars are all of this kind.

   A chart with no data says so and offers the entry screen. It never draws an
   invented figure — a dashboard that guesses is worse than no dashboard,
   because somebody will act on it.
   ========================================================================= */
(function () {
  'use strict';
  var C = window.Core;
  function esc(s) { return C ? C.esc(s) : String(s == null ? '' : s); }

  /* ---------------- financial year, Apr–Mar ---------------- */
  var MONTHS = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];
  function fyOf(d) {
    d = d ? new Date(d) : new Date();
    if (isNaN(d)) return null;
    return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  }
  function fyLabel(y) { return y + '–' + String(y + 1).slice(2); }
  /* month position inside the financial year: Apr = 0 … Mar = 11 */
  function mIndex(d) {
    d = new Date(d);
    if (isNaN(d)) return -1;
    return (d.getMonth() + 9) % 12;
  }
  function inFy(d, fy) {
    d = new Date(d);
    if (isNaN(d)) return false;
    return fyOf(d) === fy;
  }
  function zeros() { return [0,0,0,0,0,0,0,0,0,0,0,0]; }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
  function pct(a, b) { return b > 0 ? Math.round((a / b) * 1000) / 10 : 0; }
  function sum(a) { return (a || []).reduce(function (t, x) { return t + num(x); }, 0); }
  function anyValue(a) { return (a || []).some(function (x) { return num(x) !== 0; }); }

  /* ---------------- chart engine ----------------
     Every chart is one SVG string. Colours come from the design system so a
     theme change carries through, and every bar carries a <title> so the exact
     figure is one hover away — a chart you cannot read the number off is a
     decoration. */
  var PALETTE = ['#1E88C7', '#0B2A5B', '#C2932E', '#1F9D6B', '#B03A2E', '#7C5BC7', '#E0B44E', '#41567E'];
  var W = 680, H = 250, PL = 52, PR = 12, PT = 16, PB = 38;

  function niceMax(v) {
    if (v <= 0) return 10;
    var mag = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var n = v / mag;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * mag;
  }
  function fmt(v, unit) {
    var n = num(v);
    if (unit === '%') return (Math.round(n * 10) / 10) + '%';
    if (unit === '₹') return C ? C.rate(n) : n.toFixed(2);
    if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString('en-IN');
    return String(Math.round(n * 100) / 100);
  }
  function axis(max, unit) {
    var out = '', i, y, v;
    for (i = 0; i <= 4; i++) {
      v = (max / 4) * i;
      y = H - PB - ((H - PT - PB) * i / 4);
      out += '<line x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y +
        '" stroke="rgba(11,42,91,.10)" stroke-width="1"/>' +
        '<text x="' + (PL - 7) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" ' +
        'fill="#7C8CAB" font-family="monospace">' + fmt(v, unit === '₹' ? '' : unit) + '</text>';
    }
    return out;
  }
  function xLabels(labels) {
    var band = (W - PL - PR) / labels.length, out = '';
    labels.forEach(function (l, i) {
      out += '<text x="' + (PL + band * i + band / 2) + '" y="' + (H - PB + 15) +
        '" text-anchor="middle" font-size="10" fill="#41567E" font-family="monospace">' +
        esc(String(l).slice(0, 9)) + '</text>';
    });
    return out;
  }
  function legend(series) {
    return '<div class="kpi-leg">' + series.map(function (s, i) {
      return '<span><i style="background:' + (s.color || PALETTE[i % PALETTE.length]) + '"></i>' +
        esc(s.name) + '</span>';
    }).join('') + '</div>';
  }
  function svg(inner) {
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet" ' +
      'xmlns="http://www.w3.org/2000/svg" class="kpi-svg">' + inner + '</svg>';
  }

  /* grouped (or single) vertical bars over a shared set of labels */
  function chartBars(labels, series, unit) {
    var max = niceMax(Math.max.apply(null, [0].concat(series.map(function (s) {
      return Math.max.apply(null, [0].concat(s.values.map(num)));
    }))));
    var band = (W - PL - PR) / labels.length;
    var gap = band * 0.18, bw = (band - gap * 2) / series.length;
    var body = axis(max, unit) + xLabels(labels);
    series.forEach(function (s, si) {
      var col = s.color || PALETTE[si % PALETTE.length];
      s.values.forEach(function (v, i) {
        var val = num(v);
        var h = max ? Math.max(0, (H - PT - PB) * (val / max)) : 0;
        var x = PL + band * i + gap + bw * si;
        body += '<rect x="' + x.toFixed(1) + '" y="' + (H - PB - h).toFixed(1) + '" width="' +
          Math.max(1, bw - 1.5).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + col +
          '" rx="2"><title>' + esc(s.name + ' · ' + labels[i] + ': ' + fmt(val, unit)) + '</title></rect>';
      });
    });
    body += '<line x1="' + PL + '" y1="' + (H - PB) + '" x2="' + (W - PR) + '" y2="' + (H - PB) +
      '" stroke="rgba(11,42,91,.35)"/>';
    return legend(series) + svg(body);
  }

  /* lines with dots — for rates and ratios read over time */
  function chartLine(labels, series, unit) {
    var max = niceMax(Math.max.apply(null, [0].concat(series.map(function (s) {
      return Math.max.apply(null, [0].concat(s.values.map(num)));
    }))));
    var band = (W - PL - PR) / labels.length;
    var body = axis(max, unit) + xLabels(labels);
    series.forEach(function (s, si) {
      var col = s.color || PALETTE[si % PALETTE.length], pts = [];
      s.values.forEach(function (v, i) {
        var x = PL + band * i + band / 2;
        var y = H - PB - (max ? (H - PT - PB) * (num(v) / max) : 0);
        pts.push(x.toFixed(1) + ',' + y.toFixed(1));
      });
      body += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + col +
        '" stroke-width="2.2" stroke-linejoin="round"/>';
      s.values.forEach(function (v, i) {
        var x = PL + band * i + band / 2;
        var y = H - PB - (max ? (H - PT - PB) * (num(v) / max) : 0);
        body += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.4" fill="' + col +
          '"><title>' + esc(s.name + ' · ' + labels[i] + ': ' + fmt(v, unit)) + '</title></circle>';
      });
    });
    return legend(series) + svg(body);
  }

  /* donut — for a split of one total */
  function chartPie(labels, values, unit) {
    var total = sum(values);
    if (!total) return '';
    var cx = W / 2, cy = H / 2, r = 92, ir = 52, a = -Math.PI / 2, body = '';
    values.forEach(function (v, i) {
      var frac = num(v) / total, ang = frac * Math.PI * 2, b = a + ang;
      var big = ang > Math.PI ? 1 : 0;
      var p = ['M', cx + r * Math.cos(a), cy + r * Math.sin(a),
        'A', r, r, 0, big, 1, cx + r * Math.cos(b), cy + r * Math.sin(b),
        'L', cx + ir * Math.cos(b), cy + ir * Math.sin(b),
        'A', ir, ir, 0, big, 0, cx + ir * Math.cos(a), cy + ir * Math.sin(a), 'Z']
        .map(function (x) { return typeof x === 'number' ? x.toFixed(2) : x; }).join(' ');
      body += '<path d="' + p + '" fill="' + PALETTE[i % PALETTE.length] + '"><title>' +
        esc(labels[i] + ': ' + fmt(v, unit) + ' (' + Math.round(frac * 100) + '%)') + '</title></path>';
      a = b;
    });
    body += '<text x="' + cx + '" y="' + (cy + 5) + '" text-anchor="middle" font-size="15" ' +
      'font-weight="700" fill="#0B2A5B">' + esc(fmt(total, unit)) + '</text>';
    return legend(labels.map(function (l, i) { return { name: l + ' — ' + fmt(values[i], unit), color: PALETTE[i % PALETTE.length] }; })) + svg(body);
  }

  /* radar — for comparing several measures on one common scale (0–100) */
  function chartRadar(axes, series) {
    var cx = W / 2, cy = H / 2 + 4, r = 96, n = axes.length, body = '', i, k;
    if (!n) return '';
    function pt(i, frac) {
      var a = -Math.PI / 2 + (Math.PI * 2 * i / n);
      return [cx + r * frac * Math.cos(a), cy + r * frac * Math.sin(a)];
    }
    for (k = 1; k <= 4; k++) {
      var ring = [];
      for (i = 0; i < n; i++) { var p = pt(i, k / 4); ring.push(p[0].toFixed(1) + ',' + p[1].toFixed(1)); }
      body += '<polygon points="' + ring.join(' ') + '" fill="none" stroke="rgba(11,42,91,.12)"/>';
    }
    for (i = 0; i < n; i++) {
      var e = pt(i, 1), lp = pt(i, 1.16);
      body += '<line x1="' + cx + '" y1="' + cy + '" x2="' + e[0].toFixed(1) + '" y2="' + e[1].toFixed(1) +
        '" stroke="rgba(11,42,91,.12)"/>' +
        '<text x="' + lp[0].toFixed(1) + '" y="' + lp[1].toFixed(1) + '" text-anchor="middle" ' +
        'font-size="9.5" fill="#41567E" font-family="monospace">' + esc(String(axes[i]).slice(0, 14)) + '</text>';
    }
    series.forEach(function (s, si) {
      var col = s.color || PALETTE[si % PALETTE.length], poly = [];
      for (i = 0; i < n; i++) {
        var frac = Math.max(0, Math.min(1, num(s.values[i]) / 100));
        var p = pt(i, frac);
        poly.push(p[0].toFixed(1) + ',' + p[1].toFixed(1));
      }
      body += '<polygon points="' + poly.join(' ') + '" fill="' + col + '" fill-opacity=".16" stroke="' +
        col + '" stroke-width="2"/>';
      for (i = 0; i < n; i++) {
        var f2 = Math.max(0, Math.min(1, num(s.values[i]) / 100)), q = pt(i, f2);
        body += '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="3" fill="' + col +
          '"><title>' + esc(s.name + ' · ' + axes[i] + ': ' + fmt(s.values[i], '%')) + '</title></circle>';
      }
    });
    return legend(series) + svg(body);
  }

  /* pareto — bars descending with the cumulative line and the 80% mark, one of
     the 7QC tools and the only honest way to say "start here" */
  function chartPareto(labels, values, unit) {
    var pairs = labels.map(function (l, i) { return { l: l, v: num(values[i]) }; })
      .filter(function (p) { return p.v > 0; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, 10);
    if (!pairs.length) return '';
    var total = pairs.reduce(function (t, p) { return t + p.v; }, 0);
    var max = niceMax(pairs[0].v);
    var band = (W - PL - PR) / pairs.length, run = 0;
    var body = axis(max, unit) + xLabels(pairs.map(function (p) { return p.l; }));
    var line = [];
    pairs.forEach(function (p, i) {
      var h = (H - PT - PB) * (p.v / max);
      body += '<rect x="' + (PL + band * i + band * 0.16).toFixed(1) + '" y="' + (H - PB - h).toFixed(1) +
        '" width="' + (band * 0.68).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + PALETTE[0] +
        '" rx="2"><title>' + esc(p.l + ': ' + fmt(p.v, unit)) + '</title></rect>';
      run += p.v;
      line.push((PL + band * i + band / 2).toFixed(1) + ',' +
        (H - PB - (H - PT - PB) * (run / total)).toFixed(1));
    });
    body += '<polyline points="' + line.join(' ') + '" fill="none" stroke="' + PALETTE[2] + '" stroke-width="2"/>';
    var y80 = H - PB - (H - PT - PB) * 0.8;
    body += '<line x1="' + PL + '" y1="' + y80.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y80.toFixed(1) +
      '" stroke="' + PALETTE[4] + '" stroke-dasharray="4 4"/>' +
      '<text x="' + (W - PR - 4) + '" y="' + (y80 - 5).toFixed(1) + '" text-anchor="end" font-size="9.5" fill="' +
      PALETTE[4] + '" font-family="monospace">80% of the loss</text>';
    return legend([{ name: 'Loss', color: PALETTE[0] }, { name: 'Cumulative %', color: PALETTE[2] }]) + svg(body);
  }

  /* ---------------- data loading ----------------
     One cache per screen visit. Every source is fetched at most once however
     many KPIs on the dashboard read from it. */
  var cache = {};
  function reset() { cache = {}; }
  function once(key, fn) {
    if (!cache[key]) cache[key] = fn().catch(function () { return []; });
    return cache[key];
  }
  function docs(kind) { return once('d:' + kind, function () { return C.idms.docs(kind); }); }
  function rfqList() {
    return once('rfqs', function () {
      return C.api('/api/rfqs').then(function (j) { return j.rfqs || []; });
    });
  }
  function hr(what, key) {
    return once('hr:' + what, function () {
      return C.api('/api/hr?what=' + what).then(function (j) { return j[key] || []; });
    });
  }
  function kpiDocs() { return once('d:kpi', function () { return C.idms.docs('kpi'); }); }

  /* ---------------- derivations ----------------
     Each returns { series } or { labels, values }. Every one of them is
     arithmetic over records that already exist: same records, same answer. */
  var D = {};

  D.rfq = async function (fy) {
    var rows = await rfqList();
    var got = zeros(), won = zeros();
    rows.forEach(function (r) {
      var d = r.date || r.createdAt;
      if (!inFy(d, fy)) return;
      var i = mIndex(d); if (i < 0) return;
      got[i]++;
      if (String(r.status || '') === 'Won') won[i]++;
    });
    return { series: [{ name: 'RFQ received', values: got }, { name: 'RFQ won', values: won }] };
  };

  /* one pass over production bookings feeds nine KPIs */
  async function prodStats(fy) {
    return once('prod:' + fy, async function () {
      var rows = await docs('production');
      var s = {
        made: zeros(), good: zeros(), rej: zeros(), mins: zeros(), run: zeros(),
        earned: zeros(), down: zeros(), bdMins: zeros(), bdCount: zeros(),
        byOperator: {}, byMachine: {}, rejReason: {}, downReason: {}
      };
      rows.forEach(function (r) {
        var v = r.data || {};
        if (!inFy(v.date, fy)) return;
        var i = mIndex(v.date); if (i < 0) return;
        var made = num(v.made), rej = num(v.rejected), mins = num(v.minutes),
          run = num(v.runMinutes) || Math.max(0, mins - num(v.downtime)),
          cyc = num(v.plannedCycle), down = num(v.downtime);
        s.made[i] += made; s.rej[i] += rej; s.good[i] += Math.max(0, made - rej);
        s.mins[i] += mins; s.run[i] += run; s.down[i] += down;
        s.earned[i] += (made * cyc) / 60;              // standard minutes earned
        if (/break\s*down|breakdown/i.test(v.downtimeReason || '')) {
          s.bdMins[i] += down; if (down > 0) s.bdCount[i]++;
        }
        if (v.operator) {
          var o = s.byOperator[v.operator] = s.byOperator[v.operator] || { earned: 0, run: 0 };
          o.earned += (made * cyc) / 60; o.run += run;
        }
        if (v.machine) {
          var m = s.byMachine[v.machine] = s.byMachine[v.machine] || { earned: 0, run: 0 };
          m.earned += (made * cyc) / 60; m.run += run;
        }
        if (rej > 0 && v.rejectReason) s.rejReason[v.rejectReason] = (s.rejReason[v.rejectReason] || 0) + rej;
        if (down > 0 && v.downtimeReason) s.downReason[v.downtimeReason] = (s.downReason[v.downtimeReason] || 0) + down;
      });
      return s;
    });
  }
  function ratio(a, b) { return a.map(function (v, i) { return pct(v, b[i]); }); }

  D.prodOutput = async function (fy) {
    var s = await prodStats(fy);
    return { series: [{ name: 'Good pieces produced', values: s.good }] };
  };
  D.availability = async function (fy) {
    var s = await prodStats(fy);
    return { series: [{ name: 'Availability', values: ratio(s.run, s.mins) }] };
  };
  D.performance = async function (fy) {
    var s = await prodStats(fy);
    return { series: [{ name: 'Performance', values: ratio(s.earned, s.run) }] };
  };
  D.qualityRate = async function (fy) {
    var s = await prodStats(fy);
    return { series: [{ name: 'Quality', values: ratio(s.good, s.made) }] };
  };
  D.oee = async function (fy) {
    var s = await prodStats(fy);
    var a = ratio(s.run, s.mins), p = ratio(s.earned, s.run), q = ratio(s.good, s.made);
    return { series: [{ name: 'OEE', values: a.map(function (v, i) { return Math.round(v * p[i] * q[i] / 100) / 100; }) }] };
  };
  D.prodEfficiency = async function (fy) {
    var s = await prodStats(fy);
    return { series: [{ name: 'Production efficiency', values: ratio(s.earned, s.mins) }] };
  };
  D.capacityUsed = async function (fy) {
    var s = await prodStats(fy);
    return { series: [{ name: 'Machine hours booked', values: s.mins.map(function (v) { return Math.round(v / 60 * 10) / 10; }) }] };
  };
  D.operatorEff = async function (fy) {
    var s = await prodStats(fy), out = [];
    Object.keys(s.byOperator).forEach(function (k) {
      var o = s.byOperator[k];
      out.push({ l: k, v: pct(o.earned, o.run) });
    });
    out.sort(function (a, b) { return b.v - a.v; });
    return { labels: out.map(function (x) { return x.l; }), values: out.map(function (x) { return x.v; }) };
  };
  D.machineEff = async function (fy) {
    var s = await prodStats(fy), out = [];
    Object.keys(s.byMachine).forEach(function (k) {
      var m = s.byMachine[k];
      out.push({ l: k, v: pct(m.earned, m.run) });
    });
    out.sort(function (a, b) { return b.v - a.v; });
    return { labels: out.map(function (x) { return x.l; }), values: out.map(function (x) { return x.v; }) };
  };
  D.lossPareto = async function (fy) {
    var s = await prodStats(fy);
    var ks = Object.keys(s.downReason);
    return { labels: ks, values: ks.map(function (k) { return Math.round(s.downReason[k] / 60 * 10) / 10; }) };
  };
  D.rejectPareto = async function (fy) {
    var s = await prodStats(fy);
    var ks = Object.keys(s.rejReason);
    return { labels: ks, values: ks.map(function (k) { return s.rejReason[k]; }) };
  };
  D.breakdownHours = async function (fy) {
    var s = await prodStats(fy);
    return { series: [{ name: 'Breakdown hours', values: s.bdMins.map(function (v) { return Math.round(v / 60 * 10) / 10; }) }] };
  };
  D.mttrMtbf = async function (fy) {
    var s = await prodStats(fy);
    var mttr = zeros(), mtbf = zeros();
    for (var i = 0; i < 12; i++) {
      mttr[i] = s.bdCount[i] ? Math.round(s.bdMins[i] / s.bdCount[i] / 6) / 10 : 0;
      mtbf[i] = s.bdCount[i] ? Math.round((s.run[i] / s.bdCount[i]) / 6) / 10 : 0;
    }
    return { series: [{ name: 'MTTR (hours)', values: mttr }, { name: 'MTBF (hours)', values: mtbf }] };
  };

  /* inward inspection carries received / accepted / rejected against a GRN */
  async function inwardStats(fy) {
    return once('inward:' + fy, async function () {
      var rows = await docs('inward'), rec = zeros(), rej = zeros(), bySup = {};
      rows.forEach(function (r) {
        var v = r.data || {};
        var d = v.date || v.at || r.created_at;
        if (!inFy(d, fy)) return;
        var i = mIndex(d); if (i < 0) return;
        var got = num(v.received) || (num(v.accepted) + num(v.rejected));
        rec[i] += got; rej[i] += num(v.rejected);
        var s = v.supplier || v.supplierName || '';
        if (s) {
          var b = bySup[s] = bySup[s] || { rec: 0, rej: 0 };
          b.rec += got; b.rej += num(v.rejected);
        }
      });
      return { rec: rec, rej: rej, bySup: bySup };
    });
  }
  D.supplierPpm = async function (fy) {
    var s = await inwardStats(fy);
    return { series: [{ name: 'Supplier PPM', values: s.rec.map(function (v, i) { return v ? Math.round(s.rej[i] / v * 1e6) : 0; }) }] };
  };
  D.supplierQuality = async function (fy) {
    var s = await inwardStats(fy), out = [];
    Object.keys(s.bySup).forEach(function (k) {
      out.push({ l: k, v: pct(s.bySup[k].rec - s.bySup[k].rej, s.bySup[k].rec) });
    });
    out.sort(function (a, b) { return b.v - a.v; });
    return { labels: out.map(function (x) { return x.l; }), values: out.map(function (x) { return x.v; }) };
  };

  /* rejection PPM at all four gates, on one pair of axes */
  D.rejectionPpm4 = async function (fy) {
    var p = await prodStats(fy), iw = await inwardStats(fy);
    var pdi = await docs('pdi'), nc = await docs('ncr');
    var fRec = zeros(), fRej = zeros(), cust = zeros(), custBase = zeros();
    pdi.forEach(function (r) {
      var v = r.data || {}, d = v.date || v.at || r.created_at;
      if (!inFy(d, fy)) return;
      var i = mIndex(d); if (i < 0) return;
      fRec[i] += num(v.offered) || (num(v.accepted) + num(v.rejected));
      fRej[i] += num(v.rejected);
    });
    nc.forEach(function (r) {
      var v = r.data || {}, d = v.raisedOn || v.date || r.created_at;
      if (!inFy(d, fy)) return;
      var i = mIndex(d); if (i < 0) return;
      if (/customer/i.test(v.source || v.origin || '')) cust[i] += num(v.qty);
    });
    for (var i = 0; i < 12; i++) custBase[i] = fRec[i] || p.good[i];
    return {
      series: [
        { name: 'Supplier', values: iw.rec.map(function (v, i) { return v ? Math.round(iw.rej[i] / v * 1e6) : 0; }) },
        { name: 'In-process', values: p.made.map(function (v, i) { return v ? Math.round(p.rej[i] / v * 1e6) : 0; }) },
        { name: 'Final inspection', values: fRec.map(function (v, i) { return v ? Math.round(fRej[i] / v * 1e6) : 0; }) },
        { name: 'Customer', values: custBase.map(function (v, i) { return v ? Math.round(cust[i] / v * 1e6) : 0; }) }
      ]
    };
  };
  D.customerComplaints = async function (fy) {
    var nc = await docs('ncr'), out = zeros();
    nc.forEach(function (r) {
      var v = r.data || {}, d = v.raisedOn || v.date || r.created_at;
      if (!inFy(d, fy)) return;
      var i = mIndex(d); if (i < 0) return;
      if (/customer/i.test(v.source || v.origin || '')) out[i]++;
    });
    return { series: [{ name: 'Customer complaints', values: out }] };
  };
  D.ncClosure = async function (fy) {
    var nc = await docs('ncr'), raised = zeros(), closed = zeros();
    nc.forEach(function (r) {
      var v = r.data || {};
      if (inFy(v.raisedOn || r.created_at, fy)) {
        var i = mIndex(v.raisedOn || r.created_at); if (i >= 0) raised[i]++;
      }
      if (v.closedOn && inFy(v.closedOn, fy)) {
        var j = mIndex(v.closedOn); if (j >= 0) closed[j]++;
      }
    });
    return { series: [{ name: 'Raised', values: raised }, { name: 'Closed', values: closed }] };
  };

  /* calibration: both halves come from the gauge register, so plan and actual
     cannot drift apart the way two typed numbers would */
  D.calibration = async function (fy) {
    var g = await docs('gauge'), due = zeros(), done = zeros();
    g.forEach(function (r) {
      var v = r.data || {};
      (v.history || []).forEach(function (h) {
        if (inFy(h.on || h.date, fy)) { var i = mIndex(h.on || h.date); if (i >= 0) done[i]++; }
      });
      if (v.lastCalibrated && inFy(v.lastCalibrated, fy)) {
        var k = mIndex(v.lastCalibrated); if (k >= 0 && !(v.history || []).length) done[k]++;
      }
      if (v.dueOn && inFy(v.dueOn, fy)) { var j = mIndex(v.dueOn); if (j >= 0) due[j]++; }
      else if (v.lastCalibrated && num(v.frequencyMonths)) {
        var d = new Date(v.lastCalibrated);
        d.setMonth(d.getMonth() + num(v.frequencyMonths));
        if (inFy(d, fy)) { var m = mIndex(d); if (m >= 0) due[m]++; }
      }
    });
    return { series: [{ name: 'Due (plan)', values: due }, { name: 'Calibrated (actual)', values: done }] };
  };
  D.msaActual = async function (fy) {
    var rows = await docs('msa'), out = zeros();
    rows.forEach(function (r) {
      var d = (r.data || {}).date || r.created_at;
      if (!inFy(d, fy)) return;
      var i = mIndex(d); if (i >= 0) out[i]++;
    });
    return { series: [{ name: 'Studies completed', values: out }] };
  };
  D.ppapActual = async function (fy) {
    var rows = await docs('ppap'), out = zeros();
    rows.forEach(function (r) {
      var v = r.data || {}, d = v.submittedOn || v.date || r.created_at;
      if (!inFy(d, fy)) return;
      var i = mIndex(d); if (i >= 0) out[i]++;
    });
    return { series: [{ name: 'PPAP submitted', values: out }] };
  };
  D.pmActual = async function (fy) {
    var rows = await docs('machine'), out = zeros();
    rows.forEach(function (r) {
      var v = r.data || {};
      (v.history || []).forEach(function (h) {
        var d = h.on || h.date;
        if (!inFy(d, fy)) return;
        var i = mIndex(d); if (i >= 0) out[i]++;
      });
    });
    return { series: [{ name: 'Maintenance carried out', values: out }] };
  };

  /* despatch and delivery come from the challans against the order due dates */
  async function dcStats(fy) {
    return once('dc:' + fy, async function () {
      var dc = await docs('dc'), orders = await docs('order');
      var due = {}, qty = zeros(), onTime = zeros(), lines = zeros();
      orders.forEach(function (o) { var v = o.data || {}; if (v.po) due[v.po] = v.due; });
      dc.forEach(function (r) {
        var v = r.data || {}, d = v.date || r.created_at;
        if (!inFy(d, fy)) return;
        var i = mIndex(d); if (i < 0) return;
        qty[i] += num(v.qty);
        lines[i]++;
        var dd = due[v.po];
        if (!dd || new Date(d) <= new Date(dd)) onTime[i]++;
      });
      return { qty: qty, onTime: onTime, lines: lines };
    });
  }
  D.despatchQty = async function (fy) {
    var s = await dcStats(fy);
    return { series: [{ name: 'Despatched', values: s.qty }] };
  };
  D.deliveryRating = async function (fy) {
    var s = await dcStats(fy);
    return { series: [{ name: 'On-time delivery', values: s.lines.map(function (v, i) { return pct(s.onTime[i], v); }) }] };
  };

  /* ---- tools ----
     Every event on a tool history card carries a cost and a date, so the two
     tool cost lines on the production dashboard are added up from what the shop
     floor already recorded rather than typed once a month from a notebook. */
  async function toolEvents(fy) {
    return once('toolev:' + fy, async function () {
      var rows = await docs('tool'), out = [];
      rows.forEach(function (t) {
        ((t.data || {}).history || []).forEach(function (h) {
          if (!inFy(h.on, fy)) return;
          var i = mIndex(h.on); if (i < 0) return;
          out.push({ i: i, event: String(h.event || ''), cost: num(h.cost) });
        });
      });
      return out;
    });
  }
  D.toolBreakage = async function (fy) {
    var ev = await toolEvents(fy), out = zeros();
    ev.forEach(function (e) { if (/broken/i.test(e.event)) out[e.i] += e.cost; });
    return { series: [{ name: 'Tool breakage cost', values: out }] };
  };
  /* consumption is what was put on the machine and what wore out — a breakage is
     counted on its own line above and not double-counted here */
  D.toolConsumption = async function (fy) {
    var ev = await toolEvents(fy), out = zeros();
    ev.forEach(function (e) {
      if (/issued|reground|worn/i.test(e.event)) out[e.i] += e.cost;
    });
    return { series: [{ name: 'Tool consumption cost', values: out }] };
  };

  /* ---- audits ----
     One set of records answers three questions per audit type: was the audit
     done when it was planned, were its findings closed when they were due, and
     where do the open ones stand today. Building these as a factory rather than
     fifteen near-identical functions means a change to how closure is counted
     lands in one place. */
  function auditsOfType(rows, type, fy) {
    return rows.filter(function (a) {
      var v = a.data || {};
      return v.type === type && inFy(v.plannedOn, fy);
    });
  }
  function mkAuditPlanActual(type) {
    return async function (fy) {
      var rows = await docs('audit');
      var plan = zeros(), done = zeros();
      auditsOfType(rows, type, fy).forEach(function (a) {
        var v = a.data || {};
        var i = mIndex(v.plannedOn); if (i >= 0) plan[i]++;
        if (v.actualOn && inFy(v.actualOn, fy)) { var j = mIndex(v.actualOn); if (j >= 0) done[j]++; }
      });
      return { series: [{ name: 'Planned', values: plan }, { name: 'Carried out', values: done }] };
    };
  }
  /* closure "plan" is the month a finding was due, "actual" the month it closed */
  function mkNcPlanActual(type) {
    return async function (fy) {
      var rows = await docs('audit');
      var due = zeros(), closed = zeros();
      rows.forEach(function (a) {
        var v = a.data || {};
        if (type && v.type !== type) return;
        (v.findings || []).forEach(function (f) {
          if (f.dueOn && inFy(f.dueOn, fy)) { var i = mIndex(f.dueOn); if (i >= 0) due[i]++; }
          if (f.closedOn && inFy(f.closedOn, fy)) { var j = mIndex(f.closedOn); if (j >= 0) closed[j]++; }
        });
      });
      return { series: [{ name: 'Due to close', values: due }, { name: 'Closed', values: closed }] };
    };
  }
  /* where the open ones stand today — the three buckets people actually act on */
  function mkNcStatus(type) {
    return async function (fy) {
      var rows = await docs('audit');
      var today = new Date().toISOString().slice(0, 10);
      var closed = 0, open = 0, overdue = 0;
      rows.forEach(function (a) {
        var v = a.data || {};
        if (type && v.type !== type) return;
        (v.findings || []).forEach(function (f) {
          var when = f.closedOn || f.dueOn || f.raisedOn;
          if (!when || !inFy(when, fy)) return;
          if (f.closedOn) closed++;
          else if (f.dueOn && f.dueOn < today) overdue++;
          else open++;
        });
      });
      return { labels: ['Closed', 'Open — within date', 'Overdue'], values: [closed, open, overdue] };
    };
  }
  ['Process', 'Product', 'IQA', 'Layer process', 'Layout', 'Dock', 'SQA', 'Customer', 'External', 'MRM']
    .forEach(function (t) {
      var k = t.replace(/\s+/g, '_');
      D['audit_' + k] = mkAuditPlanActual(t);
      D['nc_' + k] = mkNcPlanActual(t);
      D['ncst_' + k] = mkNcStatus(t);
    });

  /* training: both halves come from the same session records, so the plan and
     the actual cannot drift apart the way two typed numbers would */
  D.training = async function (fy) {
    var rows = await docs('training'), plan = zeros(), done = zeros();
    rows.forEach(function (r) {
      var v = r.data || {};
      if (v.plannedOn && inFy(v.plannedOn, fy)) { var i = mIndex(v.plannedOn); if (i >= 0) plan[i]++; }
      if (v.actualOn && inFy(v.actualOn, fy)) { var j = mIndex(v.actualOn); if (j >= 0) done[j]++; }
    });
    return { series: [{ name: 'Planned', values: plan }, { name: 'Held', values: done }] };
  };

  /* people */
  D.manpower = async function (fy) {
    var emps = await hr('employees', 'employees'), out = zeros();
    for (var i = 0; i < 12; i++) {
      var y = fy + (i < 9 ? 0 : 1), m = (i + 3) % 12;
      var end = new Date(y, m + 1, 0);
      out[i] = emps.filter(function (e) {
        var d = e.data || e;
        var join = d.doj || d.joinedOn || d.dateOfJoining;
        var exit = d.exitDate || d.dol;
        if (join && new Date(join) > end) return false;
        if (exit && new Date(exit) < end) return false;
        return String(d.status || 'Active') !== 'Left';
      }).length;
    }
    return { series: [{ name: 'On roll (actual)', values: out }] };
  };
  D.absenteeism = async function (fy) {
    var rows = await hr('attendance', 'attendance'), abs = zeros(), tot = zeros();
    rows.forEach(function (a) {
      if (!inFy(a.day, fy)) return;
      var i = mIndex(a.day); if (i < 0) return;
      tot[i]++;
      if (String(a.status) === 'Absent') abs[i]++;
    });
    return { series: [{ name: 'Absenteeism', values: abs.map(function (v, i) { return pct(v, tot[i]); }) }] };
  };

  /* ---------------- the registry ----------------
     id, name, unit, chart, and where each series comes from.
       chart:  bars | line | pie | radar | pareto | barCat
       derive: name of a function above (its series are read-only)
       plan:   'entry' when the plan is typed on the entry screen
       cats:   columns other than months (categories) for entered KPIs   */
  var KPIS = [
    /* ---- i. Marketing ---- */
    { id: 'mk_rfq', dept: 'marketing', name: 'RFQ received vs RFQ won', unit: 'count', chart: 'bars', derive: 'rfq',
      note: 'Counted from the enquiries on the website RFQ pipeline.' },
    { id: 'mk_winrate', dept: 'marketing', name: 'Enquiry conversion', unit: '%', chart: 'line', derive: 'rfq', transform: 'ratio',
      note: 'Won as a percentage of received, from the same enquiries.' },
    { id: 'mk_budget', dept: 'marketing', name: 'Marketing budget — plan vs actual', unit: '₹', chart: 'bars' },
    { id: 'mk_offbudget', dept: 'marketing', name: 'Cost utilised not in the budget', unit: '₹', chart: 'bars', single: true },

    /* ---- ii. New Product Development ---- */
    { id: 'npd_prodn', dept: 'npd', name: 'New projects productionised — plan vs actual', unit: 'count', chart: 'bars' },
    { id: 'npd_budget', dept: 'npd', name: 'New product budget — plan vs actual', unit: '₹', chart: 'bars' },
    { id: 'npd_offbudget', dept: 'npd', name: 'Cost utilised not in the budget', unit: '₹', chart: 'bars', single: true },
    { id: 'npd_apqp', dept: 'npd', name: 'APQP — plan vs actual', unit: 'count', chart: 'bars' },
    { id: 'npd_ppap', dept: 'npd', name: 'PPAP submission — plan vs actual', unit: 'count', chart: 'bars', derive: 'ppapActual', plan: 'entry',
      note: 'Actual counted from PPAP records; the plan is entered.' },

    /* ---- iii. Engineering ---- */
    { id: 'eng_ftr', dept: 'engineering', name: 'First time right to the customer — plan vs actual', unit: '%', chart: 'bars' },
    { id: 'eng_budget', dept: 'engineering', name: 'Engineering budget — plan vs actual', unit: '₹', chart: 'bars',
      cats: ['Tools', 'Fixtures', 'Gauges', 'Equipment', 'Measurement systems', 'Manpower', 'Layout', 'Packing material', 'WIP handling', 'Bins/trays/pallets', 'Consumables'] },
    { id: 'eng_budget_split', dept: 'engineering', name: 'Engineering spend — where it went', unit: '₹', chart: 'pie', mirror: 'eng_budget', mirrorSeries: 'Actual' },
    { id: 'eng_offbudget', dept: 'engineering', name: 'Cost utilised not in the budget', unit: '₹', chart: 'bars', single: true },
    { id: 'eng_pfmea', dept: 'engineering', name: 'PFMEA review — plan vs actual', unit: 'count', chart: 'bars' },

    /* ---- iv. Purchase & SCM ---- */
    { id: 'pur_del_rating', dept: 'purchase', name: 'Supplier delivery rating', unit: '%', chart: 'bars',
      cats: ['Raw material', 'Consumables', 'Tools'] },
    { id: 'pur_qual_rating', dept: 'purchase', name: 'Supplier quality rating — by supplier', unit: '%', chart: 'barCat', derive: 'supplierQuality',
      note: 'Accepted as a percentage of received, from the inward inspections on file.' },
    { id: 'pur_ppm', dept: 'purchase', name: 'Supplier PPM', unit: 'ppm', chart: 'line', derive: 'supplierPpm',
      note: 'Rejected over received at goods inward, month by month.' },
    { id: 'pur_dev', dept: 'purchase', name: 'Supplier development — plan vs actual', unit: 'count', chart: 'bars',
      cats: ['Raw material', 'Consumables', 'Tools'] },
    { id: 'pur_budget', dept: 'purchase', name: 'Purchase budget — plan vs actual', unit: '₹', chart: 'bars',
      cats: ['Raw material', 'Consumables', 'Tools & fixtures'] },
    { id: 'pur_offbudget', dept: 'purchase', name: 'Cost utilised not in the budget', unit: '₹', chart: 'bars', single: true },

    /* ---- v. PPC & MMD ---- */
    { id: 'ppc_sales', dept: 'ppc', name: 'Sales — plan vs actual', unit: 'qty', chart: 'bars', derive: 'despatchQty', plan: 'entry',
      note: 'Actual is what left on delivery challans; the plan is entered.' },
    { id: 'ppc_prod', dept: 'ppc', name: 'Production — plan vs actual', unit: 'qty', chart: 'bars', derive: 'prodOutput', plan: 'entry',
      note: 'Actual is good pieces booked in production; the plan is entered.' },
    { id: 'ppc_capacity', dept: 'ppc', name: 'Capacity — plan vs actual', unit: 'hours', chart: 'bars', derive: 'capacityUsed', plan: 'entry',
      note: 'Actual is machine hours booked; the plan is entered.' },
    { id: 'ppc_resource', dept: 'ppc', name: 'Resource — plan vs actual', unit: 'count', chart: 'bars' },
    { id: 'ppc_delivery', dept: 'ppc', name: 'Customer delivery rating', unit: '%', chart: 'line', derive: 'deliveryRating',
      note: 'Challans despatched on or before the order due date.' },
    { id: 'ppc_csi', dept: 'ppc', name: 'Customer satisfaction index', unit: '%', chart: 'bars', yearly: true },
    { id: 'ppc_routecard', dept: 'ppc', name: 'Route card reconciliation — plan vs actual', unit: 'count', chart: 'bars' },
    { id: 'ppc_nonmoving', dept: 'ppc', name: 'Non-moving item value', unit: '₹', chart: 'bars', single: true,
      cats: ['Raw material', 'Consumables', 'Tools & fixtures'] },
    { id: 'ppc_dc_recon', dept: 'ppc', name: 'DC reconciliation', unit: 'count', chart: 'bars' },
    { id: 'ppc_grn_recon', dept: 'ppc', name: 'GRN reconciliation', unit: 'count', chart: 'bars' },
    { id: 'ppc_perpetual', dept: 'ppc', name: 'Perpetual inventory variation', unit: '₹', chart: 'bars', single: true,
      cats: ['Raw material', 'Consumables', 'Tools & fixtures'] },
    { id: 'ppc_inventory', dept: 'ppc', name: 'Total inventory cost', unit: '₹', chart: 'bars', single: true,
      cats: ['Raw material', 'WIP', 'At supplier', 'Finished goods', 'Tools', 'Consumables'] },
    { id: 'ppc_inventory_split', dept: 'ppc', name: 'Inventory cost — where it sits', unit: '₹', chart: 'pie', mirror: 'ppc_inventory', mirrorSeries: 'Actual' },
    { id: 'ppc_freight', dept: 'ppc', name: 'Premium freight charges', unit: '₹', chart: 'bars', single: true },
    { id: 'ppc_changeover', dept: 'ppc', name: 'Unplanned change-overs', unit: 'count', chart: 'bars', single: true },

    /* ---- vi. Production ---- */
    { id: 'prd_oee', dept: 'production', name: 'OEE — plan vs actual', unit: '%', chart: 'bars', derive: 'oee', plan: 'entry',
      note: 'Availability × performance × quality, all three from the production bookings.' },
    { id: 'prd_avail', dept: 'production', name: 'Availability — plan vs actual', unit: '%', chart: 'bars', derive: 'availability', plan: 'entry',
      note: 'Run time over time booked.' },
    { id: 'prd_perf', dept: 'production', name: 'Performance — plan vs actual', unit: '%', chart: 'bars', derive: 'performance', plan: 'entry',
      note: 'Standard minutes earned over run time, using the routing cycle.' },
    { id: 'prd_qual', dept: 'production', name: 'Quality — plan vs actual', unit: '%', chart: 'bars', derive: 'qualityRate', plan: 'entry',
      note: 'Good pieces over pieces made.' },
    { id: 'prd_eff', dept: 'production', name: 'Production efficiency — plan vs actual', unit: '%', chart: 'bars', derive: 'prodEfficiency', plan: 'entry',
      note: 'Standard minutes earned over total time booked, downtime included.' },
    { id: 'prd_caputil', dept: 'production', name: 'Capacity utilisation — plan vs actual', unit: 'hours', chart: 'bars', derive: 'capacityUsed', plan: 'entry' },
    { id: 'prd_operator', dept: 'production', name: 'Operator efficiency', unit: '%', chart: 'barCat', derive: 'operatorEff',
      note: 'From the bookings each person made — nobody types this figure.' },
    { id: 'prd_machine', dept: 'production', name: 'Machine efficiency', unit: '%', chart: 'barCat', derive: 'machineEff',
      note: 'From the bookings against each machine.' },
    { id: 'prd_fgvalue', dept: 'production', name: 'FG parts value moved to finished goods', unit: '₹', chart: 'bars', single: true },
    { id: 'prd_toolbreak', dept: 'production', name: 'Tool breakage cost', unit: '₹', chart: 'bars', single: true, derive: 'toolBreakage',
      note: 'Added up from the breakages recorded on the tool history cards.' },
    { id: 'prd_toolcons', dept: 'production', name: 'Tool consumption cost', unit: '₹', chart: 'bars', single: true, derive: 'toolConsumption',
      note: 'Tools issued, reground and worn out, from the tool history cards. Breakages are on their own line and are not counted twice.' },
    { id: 'prd_offbudget', dept: 'production', name: 'Cost utilised not in the budget', unit: '₹', chart: 'bars', single: true },
    { id: 'prd_rework', dept: 'production', name: 'Rework cost', unit: '₹', chart: 'bars', single: true },
    { id: 'prd_losspareto', dept: 'production', name: 'Loss pareto — downtime by reason', unit: 'hours', chart: 'pareto', derive: 'lossPareto',
      note: 'Every minute of downtime booked this year, largest cause first.' },
    { id: 'prd_rejpareto', dept: 'production', name: 'Rejection pareto — by reason', unit: 'pcs', chart: 'pareto', derive: 'rejectPareto',
      note: 'Rejection reasons recorded against production bookings.' },

    /* ---- vii. Quality Assurance ---- */
    { id: 'qa_rejcost', dept: 'quality', name: 'Rejection cost', unit: '₹', chart: 'bars', single: true,
      cats: ['Supplier', 'In-process', 'Final inspection', 'Customer'] },
    { id: 'qa_rejcost_split', dept: 'quality', name: 'Rejection cost — where it arises', unit: '₹', chart: 'pie', mirror: 'qa_rejcost', mirrorSeries: 'Actual' },
    { id: 'qa_ppm', dept: 'quality', name: 'Rejection PPM at all four gates', unit: 'ppm', chart: 'line', derive: 'rejectionPpm4',
      note: 'Supplier from inward inspection, in-process from production, final from PDI, customer from non-conformances.' },
    { id: 'qa_copq', dept: 'quality', name: 'Cost of poor quality', unit: '₹', chart: 'bars', single: true },
    { id: 'qa_custrating', dept: 'quality', name: 'Customer quality rating', unit: '%', chart: 'line', single: true },
    { id: 'qa_complaints', dept: 'quality', name: 'Customer complaints', unit: 'count', chart: 'bars', derive: 'customerComplaints',
      note: 'Non-conformances raised from a customer source.' },
    { id: 'qa_cal', dept: 'quality', name: 'Calibration — plan vs actual', unit: 'count', chart: 'bars', derive: 'calibration',
      note: 'Both halves come from the gauge register: what fell due against what was calibrated.' },
    { id: 'qa_calcost', dept: 'quality', name: 'Calibration cost — plan vs actual', unit: '₹', chart: 'bars' },
    { id: 'qa_gaugecost', dept: 'quality', name: 'Gauge procurement cost — plan vs actual', unit: '₹', chart: 'bars' },
    { id: 'qa_msa', dept: 'quality', name: 'MSA — plan vs actual', unit: 'count', chart: 'bars', derive: 'msaActual', plan: 'entry',
      note: 'Actual counted from the MSA studies recorded; the plan is entered.' },
    { id: 'qa_spc', dept: 'quality', name: 'SPC — plan vs actual', unit: 'count', chart: 'bars' },
    { id: 'qa_thirdparty', dept: 'quality', name: 'Third-party inspection cost — plan vs actual', unit: '₹', chart: 'bars' },
    { id: 'qa_offbudget', dept: 'quality', name: 'Cost utilised not in the budget', unit: '₹', chart: 'bars', single: true },

    /* ---- viii. Maintenance ---- */
    { id: 'mnt_breakdown', dept: 'maintenance', name: 'Breakdown hours', unit: 'hours', chart: 'bars', derive: 'breakdownHours',
      note: 'Downtime booked in production against a machine breakdown — nobody enters it twice.' },
    { id: 'mnt_mttr', dept: 'maintenance', name: 'MTTR and MTBF', unit: 'hours', chart: 'line', derive: 'mttrMtbf',
      note: 'From the same breakdown records: repair time per event, and run time between events.' },
    { id: 'mnt_spares', dept: 'maintenance', name: 'Spares stock', unit: 'count', chart: 'bars', single: true,
      cats: ['Regular spares', 'Critical spares'] },
    { id: 'mnt_sparecost', dept: 'maintenance', name: 'Total spares inventory cost', unit: '₹', chart: 'bars', single: true },
    { id: 'mnt_cost', dept: 'maintenance', name: 'Maintenance cost', unit: '₹', chart: 'bars', single: true },
    { id: 'mnt_offbudget', dept: 'maintenance', name: 'Cost utilised not in the budget', unit: '₹', chart: 'bars', single: true },
    { id: 'mnt_pm', dept: 'maintenance', name: 'Preventive maintenance — plan vs actual', unit: 'count', chart: 'bars', derive: 'pmActual', plan: 'entry',
      note: 'Actual counted from maintenance recorded against machines; the plan is entered.' },
    { id: 'mnt_eb', dept: 'maintenance', name: 'EB cost', unit: '₹', chart: 'bars', single: true },
    { id: 'mnt_dg', dept: 'maintenance', name: 'DG fuel cost', unit: '₹', chart: 'bars', single: true },

    /* ---- ix. HR & Admin ---- */
    { id: 'hr_manpower', dept: 'hrm', name: 'Manpower — plan vs actual', unit: 'count', chart: 'bars', derive: 'manpower', plan: 'entry',
      note: 'Actual counted from the employee records on roll at each month end.' },
    { id: 'hr_mpcost', dept: 'hrm', name: 'Manpower cost — plan vs actual', unit: '₹', chart: 'bars' },
    { id: 'hr_ot', dept: 'hrm', name: 'Overtime cost', unit: '₹', chart: 'bars', single: true },
    { id: 'hr_training', dept: 'hrm', name: 'Training — plan vs actual', unit: 'count', chart: 'bars', derive: 'training',
      note: 'Counted from the training sessions: planned in the month they were due, held in the month they happened.' },
    { id: 'hr_legal', dept: 'hrm', name: 'Legal compliance calendar — plan vs actual', unit: 'count', chart: 'bars' },
    { id: 'hr_absent', dept: 'hrm', name: 'Absenteeism rate', unit: '%', chart: 'line', derive: 'absenteeism',
      note: 'Days marked absent over days recorded, from the attendance register.' },
    { id: 'hr_attrition', dept: 'hrm', name: 'Attrition rate', unit: '%', chart: 'line', single: true },
    { id: 'hr_ess', dept: 'hrm', name: 'Employee satisfaction survey', unit: '%', chart: 'bars', yearly: true },
    { id: 'hr_offbudget', dept: 'hrm', name: 'Cost utilised not in the budget', unit: '₹', chart: 'bars', single: true },
    { id: 'hr_kpireview', dept: 'hrm', name: 'KPI review — plan vs actual', unit: 'count', chart: 'bars' },
    { id: 'hr_kpiaction', dept: 'hrm', name: 'KPI action plan closure', unit: 'count', chart: 'pie',
      cats: ['Closed', 'Open — within date', 'Overdue'], single: true },
    { id: 'hr_mpcost_todate', dept: 'hrm', name: 'Manpower cost as of today', unit: '₹', chart: 'bars', single: true },

    /* ---- x. QMS & MR ---- */
    { id: 'qms_process_audit', dept: 'qms', name: 'Process audit — plan vs actual', unit: 'count', chart: 'bars', derive: 'audit_Process',
      note: 'Counted from the audit register: planned in the month it was due, carried out in the month it happened.' },
    { id: 'qms_process_nc', dept: 'qms', name: 'Process audit NC closure — plan vs actual', unit: 'count', chart: 'bars', derive: 'nc_Process',
      note: 'Counted from the findings on the audit register: due to close in the month, against closed in the month.' },
    { id: 'qms_product_audit', dept: 'qms', name: 'Product audit — plan vs actual', unit: 'count', chart: 'bars', derive: 'audit_Product',
      note: 'Counted from the audit register: planned in the month it was due, carried out in the month it happened.' },
    { id: 'qms_product_nc', dept: 'qms', name: 'Product audit NC closure — plan vs actual', unit: 'count', chart: 'bars', derive: 'nc_Product',
      note: 'Counted from the findings on the audit register: due to close in the month, against closed in the month.' },
    { id: 'qms_iqa', dept: 'qms', name: 'IQA audit — plan vs actual', unit: 'count', chart: 'bars', derive: 'audit_IQA',
      note: 'Counted from the audit register: planned in the month it was due, carried out in the month it happened.' },
    { id: 'qms_iqa_nc', dept: 'qms', name: 'IQA NC closure — plan vs actual', unit: 'count', chart: 'bars', derive: 'nc_IQA',
      note: 'Counted from the findings on the audit register: due to close in the month, against closed in the month.' },
    { id: 'qms_mrm', dept: 'qms', name: 'MRM — plan vs actual', unit: 'count', chart: 'bars', derive: 'audit_MRM',
      note: 'Counted from the audit register: planned in the month it was due, carried out in the month it happened.' },
    { id: 'qms_mrm_actions', dept: 'qms', name: 'MRM action plan closure', unit: 'count', chart: 'pie', derive: 'ncst_MRM',
      note: 'The findings on the audit register as they stand today.' },
    { id: 'qms_external_nc', dept: 'qms', name: 'External audit NC closure', unit: 'count', chart: 'pie', derive: 'ncst_External',
      note: 'The findings on the audit register as they stand today.' },
    { id: 'qms_layer', dept: 'qms', name: 'Layer process audit — plan vs actual', unit: 'count', chart: 'bars', derive: 'audit_Layer_process',
      note: 'Counted from the audit register: planned in the month it was due, carried out in the month it happened.' },
    { id: 'qms_layer_nc', dept: 'qms', name: 'Layer process audit NC closure', unit: 'count', chart: 'pie', derive: 'ncst_Layer_process',
      note: 'The findings on the audit register as they stand today.' },
    { id: 'qms_layout', dept: 'qms', name: 'Layout audit — plan vs actual', unit: 'count', chart: 'bars', derive: 'audit_Layout',
      note: 'Counted from the audit register: planned in the month it was due, carried out in the month it happened.' },
    { id: 'qms_dock', dept: 'qms', name: 'Dock audit — plan vs actual', unit: 'count', chart: 'bars', derive: 'audit_Dock',
      note: 'Counted from the audit register: planned in the month it was due, carried out in the month it happened.' },
    { id: 'qms_customer_nc', dept: 'qms', name: 'Customer audit NC closure', unit: 'count', chart: 'pie', derive: 'ncst_Customer',
      note: 'The findings on the audit register as they stand today.' },
    { id: 'qms_sqa', dept: 'qms', name: 'SQA audit — plan vs actual', unit: 'count', chart: 'bars', derive: 'audit_SQA',
      note: 'Counted from the audit register: planned in the month it was due, carried out in the month it happened.' },
    { id: 'qms_sqa_nc', dept: 'qms', name: 'SQA audit NC closure', unit: 'count', chart: 'pie', derive: 'ncst_SQA',
      note: 'The findings on the audit register as they stand today.' },
    { id: 'qms_nc_register', dept: 'qms', name: 'Non-conformances raised and closed', unit: 'count', chart: 'bars', derive: 'ncClosure',
      note: 'From the non-conformance register — raised in the month against closed in the month.' }
  ];

  var DEPTS = [
    { key: 'topmgmt', title: 'Top Management', note: 'One picture of every department, from the same records the departments see.' },
    { key: 'qms', title: 'QMS & MR', note: 'Audits, non-conformance closure and management review.' },
    { key: 'marketing', title: 'Marketing', note: 'Enquiries, conversion and spend.' },
    { key: 'npd', title: 'New Product Development', note: 'Projects productionised, APQP and PPAP.' },
    { key: 'engineering', title: 'Engineering', note: 'First time right, PFMEA reviews and the engineering budget.' },
    { key: 'purchase', title: 'Purchase & SCM', note: 'Supplier rating, PPM, development and budget.' },
    { key: 'ppc', title: 'PPC & MMD', note: 'Sales, production, capacity, inventory and delivery.' },
    { key: 'production', title: 'Production', note: 'OEE and its three parts, efficiency, and where the losses are.' },
    { key: 'quality', title: 'Quality Assurance', note: 'Rejection at all four gates, calibration, MSA and complaints.' },
    { key: 'maintenance', title: 'Maintenance', note: 'Breakdowns, MTTR/MTBF, preventive maintenance and cost.' },
    { key: 'hrm', title: 'HR & Admin', note: 'Manpower, attendance, training and cost.' },
    { key: 'accounts', title: 'Accounts', note: 'Budget against actual across every department, and what was spent outside it.' }
  ];

  function byId(id) { return KPIS.filter(function (k) { return k.id === id; })[0]; }
  function forDept(d) { return KPIS.filter(function (k) { return k.dept === d; }); }
  function cols(k) { return k.cats ? k.cats : (k.yearly ? ['Full year'] : MONTHS); }
  function seriesNames(k) { return k.single ? ['Actual'] : ['Plan', 'Actual']; }

  /* ---------------- entered values ---------------- */
  function entryFor(all, id, fy) {
    var d = all.filter(function (r) {
      var v = r.data || {};
      return v.kpiId === id && Number(v.fy) === Number(fy);
    })[0];
    return d || null;
  }
  function rowsOf(doc, k) {
    var out = {}, v = (doc && doc.data && doc.data.rows) || {};
    seriesNames(k).forEach(function (n) {
      var arr = v[n] || [];
      out[n] = cols(k).map(function (_, i) { return num(arr[i]); });
    });
    return out;
  }

  /* ---------------- one KPI card ---------------- */
  async function cardBody(k, fy, entries) {
    var doc = entryFor(entries, k.id, fy);
    var entered = rowsOf(doc, k);
    var labels = cols(k), derived = null;

    if (k.mirror) {
      var mk = byId(k.mirror), md = entryFor(entries, k.mirror, fy);
      var mr = rowsOf(md, mk);
      var vals = mr[k.mirrorSeries] || mr.Actual || [];
      if (!anyValue(vals)) return empty(k, 'Nothing entered against ' + esc(mk.name) + ' yet.');
      return chartPie(cols(mk), vals, mk.unit);
    }

    if (k.derive && D[k.derive]) {
      try { derived = await D[k.derive](fy); }
      catch (e) { return '<div class="note bad">This figure could not be computed: ' + esc(e.message) + '</div>'; }
    }

    /* a derived pie arrives as labels and values rather than monthly series */
    if (derived && k.chart === 'pie' && derived.labels) {
      if (!anyValue(derived.values)) return empty(k, 'No records to compute this from yet.');
      return chartPie(derived.labels, derived.values, k.unit);
    }

    /* charts that stand entirely on derived data */
    if (derived && (k.chart === 'barCat' || k.chart === 'pareto')) {
      if (!derived.values || !derived.values.length || !anyValue(derived.values))
        return empty(k, 'No records to compute this from yet.');
      return k.chart === 'pareto'
        ? chartPareto(derived.labels, derived.values, k.unit)
        : chartBars(derived.labels.slice(0, 12), [{ name: k.name, values: derived.values.slice(0, 12) }], k.unit);
    }

    var series = [];
    if (derived && derived.series) {
      if (k.transform === 'ratio') {
        var a = derived.series[0].values, b = derived.series[1].values;
        series = [{ name: 'Conversion', values: a.map(function (v, i) { return pct(b[i], v); }) }];
      } else if (k.plan === 'entry') {
        series = [{ name: 'Plan', values: entered.Plan || zeros() },
                  { name: 'Actual', values: derived.series[0].values }];
      } else {
        series = derived.series;
      }
    } else {
      seriesNames(k).forEach(function (n) { series.push({ name: n, values: entered[n] }); });
    }

    var has = series.some(function (s) { return anyValue(s.values); });
    if (!has) return empty(k, k.derive ? 'No records and nothing entered for this year yet.' : 'Nothing entered for this year yet.');

    if (k.chart === 'pie') {
      var s0 = series[series.length - 1];
      return chartPie(labels, s0.values, k.unit);
    }
    if (k.chart === 'line') return chartLine(labels, series, k.unit);
    return chartBars(labels, series, k.unit);
  }

  function empty(k, why) {
    return '<div class="kpi-empty"><b>No data yet</b><span>' + esc(why) + '</span>' +
      (k.derive ? '' : '<a data-kpi-entry="' + k.id + '">Enter plan and actual →</a>') + '</div>';
  }

  function sourceLine(k) {
    if (k.mirror) return 'Drawn from the figures entered against ' + esc(byId(k.mirror).name) + '.';
    if (k.derive && k.plan === 'entry') return k.note || 'Actual computed from records; plan entered.';
    if (k.derive) return k.note || 'Computed from records already in the system.';
    return 'Entered monthly on KPI Data Entry.';
  }

  /* ---------------- dashboards ---------------- */
  async function renderDashboard(deptKey, host, fy) {
    var dept = DEPTS.filter(function (d) { return d.key === deptKey; })[0];
    if (!dept) { host.innerHTML = '<div class="note bad">No such dashboard.</div>'; return; }
    reset();
    host.innerHTML = '<div class="hint">Loading ' + esc(dept.title) + ' — reading the records…</div>';

    if (deptKey === 'topmgmt') return renderTop(host, fy);
    if (deptKey === 'accounts') return renderAccounts(host, fy);

    var list = forDept(deptKey), entries = await kpiDocs();
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var k = list[i], body;
      try { body = await cardBody(k, fy, entries); }
      catch (e) { body = '<div class="note bad">' + esc(e.message) + '</div>'; }
      html += '<div class="card kpi-card"><h4>' + esc(k.name) + '</h4>' +
        '<div class="kpi-src">' + esc(sourceLine(k)) + '</div>' + body + '</div>';
    }
    host.innerHTML = '<div class="kpi-grid">' + html + '</div>';
    wireEntryLinks(host);
  }

  /* Top Management is a roll-up, not a new set of numbers: every figure on it
     is one already shown on a department dashboard. */
  async function renderTop(host, fy) {
    var entries = await kpiDocs();
    var axes = [], vals = [];
    var picks = [
      ['Production', 'prd_oee'], ['Quality', 'prd_qual'], ['Delivery', 'ppc_delivery'],
      ['Supplier', 'pur_qual_rating'], ['Availability', 'prd_avail'], ['Attendance', 'hr_absent']
    ];
    for (var i = 0; i < picks.length; i++) {
      var k = byId(picks[i][1]), v = 0;
      try {
        if (k.derive && D[k.derive]) {
          var r = await D[k.derive](fy);
          var arr = r.series ? r.series[0].values : r.values;
          var live = (arr || []).filter(function (x) { return num(x) > 0; });
          v = live.length ? sum(live) / live.length : 0;
          if (picks[i][0] === 'Attendance') v = v ? 100 - v : 0;   // present, not absent
        }
      } catch (e) { v = 0; }
      axes.push(picks[i][0]); vals.push(Math.round(v * 10) / 10);
    }
    var radar = anyValue(vals)
      ? chartRadar(axes, [{ name: 'This year, average of the months with data', values: vals }])
      : '<div class="kpi-empty"><b>No data yet</b><span>Book production, inspections and despatches and this fills itself.</span></div>';

    var head = '<div class="card kpi-card wide"><h4>Company scorecard</h4>' +
      '<div class="kpi-src">Each spoke is the average of the months that have data, on a 0–100 scale. ' +
      'Every one of them is computed from records — nothing here is typed in.</div>' + radar + '</div>';

    var extra = '';
    var tiles = [
      ['Marketing', 'mk_rfq'], ['Production', 'prd_oee'], ['Quality', 'qa_ppm'],
      ['Delivery', 'ppc_delivery'], ['Maintenance', 'mnt_breakdown'], ['People', 'hr_manpower']
    ];
    for (var j = 0; j < tiles.length; j++) {
      var kk = byId(tiles[j][1]), body;
      try { body = await cardBody(kk, fy, entries); } catch (e) { body = ''; }
      extra += '<div class="card kpi-card"><h4>' + esc(tiles[j][0]) + ' — ' + esc(kk.name) + '</h4>' +
        '<div class="kpi-src">' + esc(sourceLine(kk)) + '</div>' + body + '</div>';
    }
    host.innerHTML = head + '<div class="kpi-grid">' + extra + '</div>';
    wireEntryLinks(host);
  }

  /* Accounts reads across the budget KPIs the departments enter. It adds no
     figure of its own — if a department has not entered its budget, its bar is
     missing rather than assumed to be zero spend. */
  async function renderAccounts(host, fy) {
    var entries = await kpiDocs();
    var budgets = KPIS.filter(function (k) { return /budget$/.test(k.id) || k.id === 'hr_mpcost'; });
    var off = KPIS.filter(function (k) { return /offbudget$/.test(k.id); });

    var labels = [], plan = [], actual = [], missing = [];
    budgets.forEach(function (k) {
      var r = rowsOf(entryFor(entries, k.id, fy), k);
      var dept = DEPTS.filter(function (d) { return d.key === k.dept; })[0];
      var nm = dept ? dept.title : k.dept;
      if (!anyValue(r.Plan) && !anyValue(r.Actual)) { missing.push(nm); return; }
      labels.push(nm); plan.push(sum(r.Plan)); actual.push(sum(r.Actual));
    });

    var offLabels = [], offVals = [];
    off.forEach(function (k) {
      var r = rowsOf(entryFor(entries, k.id, fy), k);
      var dept = DEPTS.filter(function (d) { return d.key === k.dept; })[0];
      if (!anyValue(r.Actual)) return;
      offLabels.push(dept ? dept.title : k.dept); offVals.push(sum(r.Actual));
    });

    var html = '<div class="kpi-grid">';
    html += '<div class="card kpi-card wide"><h4>Budget vs actual, by department</h4>' +
      '<div class="kpi-src">Totals for the year from each department\'s own budget KPI.' +
      (missing.length ? ' Not yet entered: ' + esc(missing.join(', ')) + '.' : '') + '</div>' +
      (labels.length
        ? chartBars(labels, [{ name: 'Plan', values: plan }, { name: 'Actual', values: actual }], '₹')
        : '<div class="kpi-empty"><b>No budgets entered</b><span>Each department enters its own budget on KPI Data Entry.</span>' +
          '<a data-kpi-entry="mk_budget">Enter a budget →</a></div>') + '</div>';

    html += '<div class="card kpi-card"><h4>Spent outside the budget</h4>' +
      '<div class="kpi-src">The "cost utilised not in the budget" figure from each department.</div>' +
      (offVals.length ? chartPie(offLabels, offVals, '₹')
        : '<div class="kpi-empty"><b>Nothing recorded</b><span>Either nothing was spent outside budget, or it has not been entered.</span></div>') +
      '</div>';

    var pl = byId('ppc_inventory');
    var invRows = rowsOf(entryFor(entries, 'ppc_inventory', fy), pl);
    html += '<div class="card kpi-card"><h4>Inventory cost</h4>' +
      '<div class="kpi-src">Entered by PPC & MMD.</div>' +
      (anyValue(invRows.Actual) ? chartPie(cols(pl), invRows.Actual, '₹')
        : '<div class="kpi-empty"><b>Not entered</b><span>PPC & MMD enter this on KPI Data Entry.</span></div>') + '</div>';

    host.innerHTML = html + '</div>';
    wireEntryLinks(host);
  }

  function wireEntryLinks(host) {
    host.querySelectorAll('[data-kpi-entry]').forEach(function (a) {
      a.addEventListener('click', function () {
        if (window.KPIX.onEntryRequest) window.KPIX.onEntryRequest(a.dataset.kpiEntry);
      });
    });
  }

  /* ---------------- the entry screen ----------------
     Twelve months of plan and actual for one KPI. Saved as one idms_docs
     record of kind `kpi`, so a new KPI needs no migration. */
  function entryForm(kpiId, fy, doc) {
    var k = byId(kpiId);
    if (!k) return '<div class="note bad">No such KPI.</div>';
    var labels = cols(k), rows = rowsOf(doc, k), names = seriesNames(k);
    var derivedActual = k.derive && (k.plan === 'entry' || !k.plan);

    var head = '<tr><th style="min-width:120px;">Series</th>' + labels.map(function (l) {
      return '<th class="r">' + esc(l) + '</th>';
    }).join('') + '<th class="r">Total</th></tr>';

    var body = names.map(function (n) {
      var locked = derivedActual && n === 'Actual';
      return '<tr><td><b>' + esc(n) + '</b>' +
        (locked ? '<div class="hint">computed from records</div>' : '') + '</td>' +
        labels.map(function (_, i) {
          return '<td>' + (locked
            ? '<span class="hint">—</span>'
            : '<input class="num kpi-in" data-s="' + esc(n) + '" data-i="' + i + '" value="' +
              (rows[n][i] || '') + '">') + '</td>';
        }).join('') + '<td class="r"><b class="kpi-tot" data-s="' + esc(n) + '">' +
        (locked ? '—' : fmt(sum(rows[n]), k.unit)) + '</b></td></tr>';
    }).join('');

    return '<div class="kpi-note">' + esc(k.name) + ' · measured in ' + esc(k.unit) +
      ' · ' + esc(sourceLine(k)) + '</div>' +
      '<div class="scroll-x"><table class="t kpi-entry"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  async function saveEntry(kpiId, fy, host, reason) {
    var k = byId(kpiId), rows = {};
    seriesNames(k).forEach(function (n) { rows[n] = cols(k).map(function () { return 0; }); });
    host.querySelectorAll('.kpi-in').forEach(function (inp) {
      rows[inp.dataset.s][+inp.dataset.i] = num(inp.value);
    });
    var all = await kpiDocs();
    var doc = entryFor(all, kpiId, fy);
    await C.idms.saveDoc({
      docId: doc ? doc.doc_id : '', kind: 'kpi', docNo: kpiId + '-' + fy,
      status: 'Entered',
      data: { kpiId: kpiId, fy: fy, dept: k.dept, name: k.name, unit: k.unit, rows: rows }
    }, reason || 'KPI plan and actual entered');
    delete cache['d:kpi'];
    return true;
  }

  /* ---------------- print ---------------- */
  function printDashboard(deptKey, fy, host) {
    var dept = DEPTS.filter(function (d) { return d.key === deptKey; })[0] || { title: 'KPI' };
    var w = window.open('', '_blank');
    if (!w) return;
    var css = '';
    try {
      css = Array.prototype.slice.call(document.styleSheets).map(function (s) {
        try { return Array.prototype.slice.call(s.cssRules).map(function (r) { return r.cssText; }).join('\n'); }
        catch (e) { return ''; }
      }).join('\n');
    } catch (e) { css = ''; }
    w.document.write('<html><head><title>' + esc(dept.title) + ' — ' + fyLabel(fy) +
      '</title><style>' + css + '@media print{.kpi-card{break-inside:avoid;}}' +
      'body{padding:18px;background:#fff;}</style></head><body>' +
      '<h2 style="font-family:sans-serif;">' + esc(dept.title) + ' — financial year ' + fyLabel(fy) + '</h2>' +
      host.innerHTML + '</body></html>');
    w.document.close();
    setTimeout(function () { w.print(); }, 400);
  }

  window.KPIX = {
    MONTHS: MONTHS, DEPTS: DEPTS, KPIS: KPIS,
    fyOf: fyOf, fyLabel: fyLabel, cols: cols, byId: byId, forDept: forDept,
    renderDashboard: renderDashboard, entryForm: entryForm, saveEntry: saveEntry,
    entryDoc: function (id, fy) { return kpiDocs().then(function (all) { return entryFor(all, id, fy); }); },
    refresh: reset, printDashboard: printDashboard,
    charts: { bars: chartBars, line: chartLine, pie: chartPie, radar: chartRadar, pareto: chartPareto },
    onEntryRequest: null
  };
})();

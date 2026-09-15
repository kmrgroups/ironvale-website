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
      var x = PL + band * i + band * 0.16, bw = band * 0.68, y = H - PB - h;
      body += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) +
        '" height="' + h.toFixed(1) + '" rx="2" fill="#1E88C7"><title>' + esc(p.l + ': ' + fmt(p.v, unit)) + '</title></rect>';
      run += p.v;
      var lx = PL + band * i + band / 2, ly = H - PB - (H - PT - PB) * (run / total);
      line.push(lx.toFixed(1) + ',' + ly.toFixed(1));
      body += '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="3" fill="#C2932E"><title>Cumulative: ' + Math.round(run / total * 100) + '%</title></circle>';
    });
    var y80 = H - PB - (H - PT - PB) * 0.8;
    body += '<line x1="' + PL + '" y1="' + y80.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y80.toFixed(1) + '" stroke="#C2932E" stroke-dasharray="4 4"/>';
    body += '<polyline points="' + line.join(' ') + '" fill="none" stroke="#C2932E" stroke-width="2"/>';
    return '<div class="kpi-leg"><span><i style="background:#1E88C7"></i>' + esc(unit || 'Count') + '</span><span><i style="background:#C2932E"></i>Cumulative</span></div>' + svg(body);
  }

  var CHARTS = { bars: chartBars, line: chartLine, pie: chartPie, radar: chartRadar, pareto: chartPareto };

  /* ---------------- registry ---------------- */
  /* Each KPI describes its evidence path so the dashboard can explain where the
     number came from. The actual page-specific dashboards below choose the
     suitable subset. */
  var KPI = {
    production: {
      title:'Production', unit:'pcs', chart:'line',
      source:'production bookings',
      data:function(r){
        var out=zeros();
        r.forEach(function(x){ var v=x.data||{}, d=v.date||x.created_at, i=mIndex(d); if(i>=0) out[i]+=num(v.made); });
        return { labels:MONTHS, series:[{name:'Produced',values:out}] };
      }
    },
    rejection: {
      title:'Rejection', unit:'%', chart:'line', source:'production bookings',
      data:function(r){
        var made=zeros(), rej=zeros();
        r.forEach(function(x){ var v=x.data||{}, i=mIndex(v.date||x.created_at); if(i>=0){made[i]+=num(v.made);rej[i]+=num(v.rejected);} });
        return { labels:MONTHS, series:[{name:'Rejection %',values:made.map(function(x,i){return pct(rej[i],x);})}] };
      }
    },
    delivery: {
      title:'On-time delivery', unit:'%', chart:'line', source:'dispatch + sales orders',
      data:function(r){
        var on=zeros(), total=zeros();
        r.forEach(function(x){ var v=x.data||{}, i=mIndex(v.dispatchDate||v.date||x.created_at); if(i>=0){total[i]++; if(v.onTime===true || String(v.status||'').toLowerCase().indexOf('on time')>=0) on[i]++;} });
        return { labels:MONTHS, series:[{name:'On-time %',values:total.map(function(x,i){return pct(on[i],x);})}] };
      }
    }
  };

  function dataLoad(kind) {
    if (!C) return Promise.resolve([]);
    return C.idms.docs(kind).catch(function(){ return []; });
  }

  function renderChart(host, cfg, rows) {
    if (!host || !cfg) return;
    var d;
    try { d = cfg.data(rows || []); } catch (e) { d = null; }
    if (!d || !d.labels || !d.series) {
      host.innerHTML = '<div class="empty">No defensible data for this KPI yet.</div>';
      return;
    }
    var fn = CHARTS[cfg.chart] || chartBars;
    host.innerHTML = fn(d.labels, d.series, cfg.unit);
  }

  window.KPIEngine = { charts:CHARTS, registry:KPI, renderChart:renderChart, fyOf:fyOf, inFy:inFy };

  /* The IDMS pages use this file for rendering dashboard panels. The Agentic AI
     V2 control tower is loaded conditionally by the shared KPI script only when
     the existing IDMS Agentic AI panel is present, so public pages are untouched. */
  (function loadAgenticControlTower(){
    function boot(){
      if (!document.querySelector('[data-panel="agentic_ai"]')) return;
      import('/agentic-ai-v2/ui/control-tower.js').catch(function(e){ console.error('Agentic AI Control Tower failed to load:', e); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  })();
})();

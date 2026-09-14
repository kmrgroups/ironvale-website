/* ============================================================================
   drawing-convert.js — turn whatever the customer sends into a JPEG the
   drawing reader can actually read.

   Why this exists: the AI provider on the free tier reads images, not PDFs and
   not CAD. Customers send PDFs, and a PDF that cannot be read is an enquiry
   that has to be re-keyed by hand. So the conversion happens in the browser,
   before the file is ever uploaded:

     PDF                    → each page rendered to a JPEG; the sender picks
                              the page the drawing is on (page 1 by default)
     PNG / WEBP / GIF / BMP → re-encoded as JPEG on a white background
     JPEG                   → passed through, downscaled only if very large
     DXF                    → the geometry is drawn to a canvas and saved as a
                              JPEG, so a CAD export can still be read
     DWG / STEP / IGES / native CAD
                            → NOT convertible in a browser. These are binary
                              formats with no open reader that runs client-side.
                              The file is still attached to the enquiry, and the
                              sender is told plainly to also send a PDF or DXF.

   Nothing here silently degrades a drawing: the output is capped at a size
   that keeps dimension text legible, and the sender sees the converted image
   before they submit.
   ========================================================================= */
(function () {
  'use strict';

  var MAX_EDGE = 2200;        // enough for dimension text; well under the 3MB cap
  var QUALITY = 0.86;
  var PDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

  var IMAGE_RE = /^image\/(jpeg|jpg|png|gif|webp|bmp)$/i;
  var DXF_RE = /\.dxf$/i;
  var NATIVE_CAD_RE = /\.(dwg|step|stp|iges|igs|x_t|x_b|sldprt|sldasm|ipt|iam|catpart|catproduct|prt|3dm|sat)$/i;
  var TIFF_RE = /\.(tif|tiff)$/i;

  function readAsDataUrl(file) {
    return new Promise(function (ok, no) {
      var r = new FileReader();
      r.onload = function () { ok(r.result); };
      r.onerror = function () { no(new Error('That file could not be read.')); };
      r.readAsDataURL(file);
    });
  }
  function readAsText(file) {
    return new Promise(function (ok, no) {
      var r = new FileReader();
      r.onload = function () { ok(r.result); };
      r.onerror = function () { no(new Error('That file could not be read.')); };
      r.readAsText(file);
    });
  }
  function jpegName(name) { return String(name || 'drawing').replace(/\.[^.]+$/, '') + '.jpg'; }

  /* A drawing on a transparent background becomes black-on-black in JPEG, so
     the canvas is filled white first. This was a real failure with exported PNGs. */
  function canvasToJpeg(canvas) {
    return canvas.toDataURL('image/jpeg', QUALITY);
  }
  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    var x = c.getContext('2d');
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function fit(w, h) {
    var s = Math.min(1, MAX_EDGE / Math.max(w, h));
    return { w: w * s, h: h * s, scale: s };
  }

  /* ---------------- raster images ---------------- */
  function imageToJpeg(file) {
    return readAsDataUrl(file).then(function (url) {
      return new Promise(function (ok, no) {
        var img = new Image();
        img.onload = function () {
          var d = fit(img.naturalWidth, img.naturalHeight);
          var c = newCanvas(d.w, d.h);
          c.getContext('2d').drawImage(img, 0, 0, d.w, d.h);
          ok({
            dataUrl: canvasToJpeg(c), pages: 1,
            note: /^image\/jpeg$/i.test(file.type) && d.scale === 1
              ? 'Sent as it is.'
              : 'Converted to JPEG' + (d.scale < 1 ? ' and resized to ' + Math.round(d.w) + 'px wide' : '') + '.'
          });
        };
        img.onerror = function () { no(new Error('That image could not be opened by the browser.')); };
        img.src = url;
      });
    });
  }

  /* ---------------- PDF ---------------- */
  var pdfLib = null;
  function loadPdfLib() {
    if (pdfLib) return Promise.resolve(pdfLib);
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_CDN + 'pdf.worker.min.js';
      pdfLib = window.pdfjsLib;
      return Promise.resolve(pdfLib);
    }
    return new Promise(function (ok, no) {
      var s = document.createElement('script');
      s.src = PDF_CDN + 'pdf.min.js';
      s.onload = function () {
        if (!window.pdfjsLib) return no(new Error('The PDF reader did not load.'));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_CDN + 'pdf.worker.min.js';
        pdfLib = window.pdfjsLib;
        ok(pdfLib);
      };
      s.onerror = function () {
        no(new Error('The PDF converter could not be downloaded — you may be offline, or the ' +
          'network may be blocking it. Save the drawing as a JPEG and attach that instead.'));
      };
      document.head.appendChild(s);
    });
  }
  function pdfToJpeg(file, page) {
    return loadPdfLib().then(function (lib) {
      return readAsDataUrl(file).then(function (url) {
        var b64 = url.split(',')[1] || '';
        var bin = atob(b64), arr = new Uint8Array(bin.length), i;
        for (i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return lib.getDocument({ data: arr }).promise;
      }).then(function (pdf) {
        var n = Math.max(1, Math.min(page || 1, pdf.numPages));
        return pdf.getPage(n).then(function (pg) {
          var v1 = pg.getViewport({ scale: 1 });
          var scale = Math.min(3, MAX_EDGE / Math.max(v1.width, v1.height));
          var vp = pg.getViewport({ scale: scale });
          var c = newCanvas(vp.width, vp.height);
          return pg.render({ canvasContext: c.getContext('2d'), viewport: vp, background: '#FFFFFF' })
            .promise.then(function () {
              return {
                dataUrl: canvasToJpeg(c), pages: pdf.numPages, page: n,
                note: 'Page ' + n + ' of ' + pdf.numPages + ' converted to JPEG' +
                  (pdf.numPages > 1 ? ' — choose another page if the drawing is elsewhere.' : '.')
              };
            });
        });
      });
    });
  }

  /* ---------------- DXF ----------------
     A deliberately small reader: the entities that carry a 2D drawing, and
     nothing else. Blocks, dimensions and hatches are not expanded — what is
     drawn is the geometry and the text, which is what the reader needs. It is
     stated plainly to the sender rather than pretending to be a CAD viewer. */
  function parseDxf(text) {
    var lines = text.split(/\r\n|\r|\n/), i = 0, ents = [], inEnt = false, cur = null;
    function push() { if (cur && cur.type) ents.push(cur); cur = null; }
    while (i < lines.length - 1) {
      var code = parseInt(lines[i].trim(), 10), val = lines[i + 1];
      i += 2;
      if (isNaN(code)) continue;
      val = val == null ? '' : val.trim();
      if (code === 0) {
        if (val === 'SECTION') { continue; }
        if (val === 'ENDSEC') { push(); inEnt = false; continue; }
        push();
        if (/^(LINE|CIRCLE|ARC|LWPOLYLINE|POLYLINE|VERTEX|TEXT|MTEXT|POINT|SOLID|ELLIPSE)$/.test(val)) {
          cur = { type: val, x: [], y: [], v: [] };
          inEnt = true;
        }
        continue;
      }
      if (code === 2 && val === 'ENTITIES') { inEnt = true; continue; }
      if (!cur) continue;
      var f = parseFloat(val);
      if (code === 10) { cur.x0 = f; cur.x.push(f); }
      else if (code === 20) { cur.y0 = f; cur.y.push(f); }
      else if (code === 11) cur.x1 = f;
      else if (code === 21) cur.y1 = f;
      else if (code === 40) cur.r = f;
      else if (code === 50) cur.a0 = f;
      else if (code === 51) cur.a1 = f;
      else if (code === 1) cur.text = val;
      else if (code === 70) cur.flags = f;
    }
    push();
    return ents;
  }
  function dxfToJpeg(file) {
    return readAsText(file).then(function (text) {
      var ents = parseDxf(text);
      var pts = [];
      ents.forEach(function (e) {
        if (e.type === 'CIRCLE' || e.type === 'ARC') {
          if (e.x0 != null && e.r) { pts.push([e.x0 - e.r, e.y0 - e.r]); pts.push([e.x0 + e.r, e.y0 + e.r]); }
        } else {
          for (var i = 0; i < e.x.length; i++) if (e.x[i] != null && e.y[i] != null) pts.push([e.x[i], e.y[i]]);
          if (e.x1 != null && e.y1 != null) pts.push([e.x1, e.y1]);
        }
      });
      if (pts.length < 2) throw new Error('No drawable geometry was found in that DXF.');
      var minX = Math.min.apply(null, pts.map(function (p) { return p[0]; }));
      var maxX = Math.max.apply(null, pts.map(function (p) { return p[0]; }));
      var minY = Math.min.apply(null, pts.map(function (p) { return p[1]; }));
      var maxY = Math.max.apply(null, pts.map(function (p) { return p[1]; }));
      var w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxY - minY);
      var pad = 30, scale = Math.min((MAX_EDGE - pad * 2) / w, (MAX_EDGE - pad * 2) / h);
      var cw = w * scale + pad * 2, ch = h * scale + pad * 2;
      var c = newCanvas(cw, ch), g = c.getContext('2d');
      function X(x) { return pad + (x - minX) * scale; }
      function Y(y) { return ch - pad - (y - minY) * scale; }
      g.strokeStyle = '#111'; g.lineWidth = 1.2; g.fillStyle = '#111';
      g.font = Math.max(10, Math.round(scale * (h / 60))) + 'px sans-serif';
      ents.forEach(function (e) {
        g.beginPath();
        if (e.type === 'LINE' && e.x1 != null) { g.moveTo(X(e.x0), Y(e.y0)); g.lineTo(X(e.x1), Y(e.y1)); g.stroke(); }
        else if (e.type === 'CIRCLE' && e.r) { g.arc(X(e.x0), Y(e.y0), e.r * scale, 0, Math.PI * 2); g.stroke(); }
        else if (e.type === 'ARC' && e.r) {
          var a0 = -(e.a1 || 0) * Math.PI / 180, a1 = -(e.a0 || 0) * Math.PI / 180;
          g.arc(X(e.x0), Y(e.y0), e.r * scale, a0, a1); g.stroke();
        } else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.x.length > 1) {
          g.moveTo(X(e.x[0]), Y(e.y[0]));
          for (var i = 1; i < e.x.length; i++) g.lineTo(X(e.x[i]), Y(e.y[i]));
          if (e.flags === 1) g.closePath();
          g.stroke();
        } else if ((e.type === 'TEXT' || e.type === 'MTEXT') && e.text) {
          g.fillText(String(e.text).replace(/\\[A-Za-z][^;]*;/g, '').slice(0, 80), X(e.x0), Y(e.y0));
        }
      });
      return {
        dataUrl: canvasToJpeg(c), pages: 1,
        note: 'DXF geometry drawn and converted to JPEG. Blocks, hatches and dimension ' +
          'annotations are not expanded, so check the preview shows what you expect.'
      };
    });
  }

  /* ---------------- the one entry point ----------------
     Returns { dataUrl, fileName, note, pages, page, converted } or throws with
     a sentence the sender can act on. */
  function prepare(file, opts) {
    opts = opts || {};
    var name = file.name || 'drawing';
    if (NATIVE_CAD_RE.test(name)) {
      return Promise.reject(new Error(
        'A ' + name.split('.').pop().toUpperCase() + ' file cannot be converted in a web browser — ' +
        'it is a binary CAD format with no reader that runs here. Please export the drawing as ' +
        'PDF, DXF or JPEG from your CAD software and attach that. Your file can still be sent ' +
        'with the enquiry, but it will not be read automatically.'));
    }
    if (TIFF_RE.test(name)) {
      return Promise.reject(new Error(
        'TIFF drawings cannot be opened by a web browser. Save the drawing as JPEG or PDF and attach that.'));
    }
    if (/\.pdf$/i.test(name) || file.type === 'application/pdf') {
      return pdfToJpeg(file, opts.page).then(function (r) {
        return { dataUrl: r.dataUrl, fileName: jpegName(name), note: r.note, pages: r.pages, page: r.page, converted: true };
      });
    }
    if (DXF_RE.test(name)) {
      return dxfToJpeg(file).then(function (r) {
        return { dataUrl: r.dataUrl, fileName: jpegName(name), note: r.note, pages: 1, page: 1, converted: true };
      });
    }
    if (IMAGE_RE.test(file.type) || /\.(jpe?g|png|gif|webp|bmp)$/i.test(name)) {
      return imageToJpeg(file).then(function (r) {
        return { dataUrl: r.dataUrl, fileName: jpegName(name), note: r.note, pages: 1, page: 1, converted: !/^image\/jpeg$/i.test(file.type) };
      });
    }
    return Promise.reject(new Error(
      'That file type cannot be converted here. Attach the drawing as PDF, DXF, JPEG or PNG.'));
  }

  function sizeOf(dataUrl) {
    return Math.round((String(dataUrl).length - (String(dataUrl).indexOf(',') + 1)) * 0.75);
  }

  /* loadPdfLib is exported so nothing else has to load pdf.js eagerly: index.html's
     pdfToText() now awaits this instead of relying on a blocking <script> in <head>.
     One loader, one memoised copy, fetched only when a PDF actually turns up. */
  window.DrawingConvert = { prepare: prepare, sizeOf: sizeOf, MAX_EDGE: MAX_EDGE,
                            loadPdfLib: loadPdfLib };
})();

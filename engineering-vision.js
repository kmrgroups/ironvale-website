/*
 * engineering-vision.js
 * Hybrid drawing evidence engine.
 *
 * The engineering reader is intentionally not one-model-only:
 *   1) Tesseract.js OCR supplies independent printed-text coordinates.
 *   2) Canvas preprocessing keeps fine strokes/decimals/± signs readable.
 *   3) Fuzzy text matching ties the AI's proposed callout to an observed OCR box.
 *   4) Focus crops can be sent back to the vision model for hard callouts only.
 *
 * This module does not create a characteristic. It only supplies evidence and
 * confidence to the existing drawing reader. When evidence is weak it returns
 * unresolved rather than guessing a balloon location.
 */
(function(global){
  'use strict';
  var OCR_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  /* Two workers, not one. scan() below used to run its two preprocessing
     passes (contrast + threshold) back-to-back on a single Tesseract worker —
     a worker only ever processes one recognize() job at a time, so the second
     pass always waited for the first to finish completely. Two independent
     workers let the two passes run at the same time on separate cores, which
     is most of where "AI reading the drawing" felt slow: wall-clock time was
     the sum of both passes when it only needed to be the slower of the two. */
  var workerPromises = [null, null];

  var scriptPromise = null;
  function loadScript(src){
    // Shared across both worker slots so requesting two workers at once
    // (scan() below does exactly that) injects the CDN <script> tag once,
    // not twice.
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function(){ resolve(); };
      s.onerror = function(){ scriptPromise = null; reject(new Error('Advanced OCR library could not be loaded.')); };
      document.head.appendChild(s);
    });
    return scriptPromise;
  }

  async function worker(slot){
    var i = slot || 0;
    if (workerPromises[i]) return workerPromises[i];
    workerPromises[i] = (async function(){
      if (!global.Tesseract) await loadScript(OCR_CDN);
      if (!global.Tesseract || !global.Tesseract.createWorker)
        throw new Error('Advanced OCR library is unavailable.');
      /* v5 createWorker accepts language directly. Keep logger off so the IDMS
         console is not flooded while a drawing is being checked. */
      var w = await global.Tesseract.createWorker('eng', 1, {
        logger:function(){}
      });
      return w;
    })().catch(function(e){ workerPromises[i] = null; throw e; });
    return workerPromises[i];
  }

  function dataUrlToImage(dataUrl){
    return new Promise(function(resolve, reject){
      var img = new Image();
      img.onload = function(){ resolve(img); };
      img.onerror = function(){ reject(new Error('The drawing image could not be decoded for visual validation.')); };
      img.src = dataUrl;
    });
  }

  function attachmentDataUrl(att){
    if (!att || !att.mime || !att.b64) return null;
    return 'data:' + att.mime + ';base64,' + att.b64;
  }

  function preprocess(img, mode){
    /* OCR does not need the full 3600px edge the AI vision model gets (that
       size exists for the model to read fine dimension text, not for
       Tesseract). Tesseract's cost scales with pixel count, so feeding it a
       needlessly large canvas — and, as this used to do, upscaling a smaller
       source image by up to 1.8x for no gain in legible detail — was pure
       wasted time. Cap at 2200px and never enlarge past the source. */
    var maxEdge = 2200;
    var s = Math.min(1, maxEdge / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    if (!isFinite(s) || s <= 0) s = 1;
    var w = Math.max(1, Math.round((img.naturalWidth || img.width) * s));
    var h = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
    var c = document.createElement('canvas'); c.width=w; c.height=h;
    var ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h);
    ctx.drawImage(img,0,0,w,h);
    var d=ctx.getImageData(0,0,w,h), p=d.data;
    for(var i=0;i<p.length;i+=4){
      var g=0.2126*p[i]+0.7152*p[i+1]+0.0722*p[i+2];
      if(mode==='threshold'){
        g = g < 205 ? 0 : 255;
      } else {
        /* light contrast stretch; preserve hairline dimension strokes */
        g = Math.max(0, Math.min(255, (g-242)*1.75+242));
      }
      p[i]=p[i+1]=p[i+2]=g;
    }
    ctx.putImageData(d,0,0);
    return { canvas:c, width:w, height:h, scale:s };
  }

  function normalizeText(s){
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/ø|⌀/g,'dia')
      .replace(/±|\+\/−|\+\/\-/g,' pm ')
      .replace(/[×✕]/g,'x')
      .replace(/[−–—]/g,'-')
      .replace(/,/g,'.')
      .replace(/[^a-z0-9.+\-\/ ]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  function numericTokens(s){
    return (String(s||'').replace(/,/g,'.').match(/[+-]?\d+(?:\.\d+)?/g)||[]).map(Number);
  }

  function editDistance(a,b){
    a=String(a||''); b=String(b||'');
    var m=a.length,n=b.length;
    if(!m) return n; if(!n) return m;
    var prev=new Array(n+1),cur=new Array(n+1),i,j,cost;
    for(j=0;j<=n;j++) prev[j]=j;
    for(i=1;i<=m;i++){
      cur[0]=i;
      for(j=1;j<=n;j++){
        cost=a.charAt(i-1)===b.charAt(j-1)?0:1;
        cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+cost);
      }
      var t=prev;prev=cur;cur=t;
    }
    return prev[n];
  }

  function similarity(a,b){
    a=normalizeText(a); b=normalizeText(b);
    if(!a || !b) return 0;
    if(a===b) return 1;
    var d=editDistance(a,b), max=Math.max(a.length,b.length);
    return Math.max(0,1-d/max);
  }

  function bboxCenter(b){
    return b ? {x:Number(b.x||0)+Number(b.w||0)/2,y:Number(b.y||0)+Number(b.h||0)/2} : null;
  }

  function distancePct(ax,ay,bx,by){
    var dx=(Number(ax)-Number(bx))/100,dy=(Number(ay)-Number(by))/100;
    return Math.sqrt(dx*dx+dy*dy);
  }

  function ocrWords(result, fullW, fullH, scale){
    var words=((result && result.data && result.data.words)||[]).map(function(w){
      var bb=w.bbox||{};
      return {
        text:String(w.text||'').trim(), confidence:Number(w.confidence||0),
        x:(bb.x0||0)/scale/fullW*100, y:(bb.y0||0)/scale/fullH*100,
        w:Math.max(0,(bb.x1||0)-(bb.x0||0))/scale/fullW*100,
        h:Math.max(0,(bb.y1||0)-(bb.y0||0))/scale/fullH*100,
        px:{x:bb.x0||0,y:bb.y0||0,w:Math.max(0,(bb.x1||0)-(bb.x0||0)),h:Math.max(0,(bb.y1||0)-(bb.y0||0))}
      };
    }).filter(function(w){ return w.text; });
    return words;
  }

  function groupLines(words){
    var sorted=words.slice().sort(function(a,b){ return a.y-b.y || a.x-b.x; }), lines=[];
    sorted.forEach(function(w){
      var cy=w.y+w.h/2, best=null,bestDy=Infinity;
      lines.forEach(function(l){
        var dy=Math.abs(cy-l.cy);
        var h=Math.max(w.h,l.h);
        if(dy<=Math.max(0.45,h*1.25) && dy<bestDy){ best=l;bestDy=dy; }
      });
      if(!best){ best={words:[],cy:cy,h:w.h}; lines.push(best); }
      best.words.push(w); best.cy=best.words.reduce(function(s,q){return s+q.y+q.h/2;},0)/best.words.length;
      best.h=Math.max(best.h,w.h);
    });
    return lines.map(function(l){
      l.words.sort(function(a,b){return a.x-b.x;});
      var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      l.words.forEach(function(w){minX=Math.min(minX,w.x);minY=Math.min(minY,w.y);maxX=Math.max(maxX,w.x+w.w);maxY=Math.max(maxY,w.y+w.h);});
      return {text:l.words.map(function(w){return w.text;}).join(' '),x:minX,y:minY,w:maxX-minX,h:maxY-minY,words:l.words,cy:l.cy};
    });
  }

  function fmtNum(v){
    if(v==null || v==='') return '';
    var n=Number(v); if(!isFinite(n)) return String(v).replace(',','.');
    return String(n).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
  }
  function expectedNumericParts(c){
    var out=[];
    function add(v){ if(v!=='' && v!=null && out.indexOf(v)<0) out.push(v); }
    add(fmtNum(c.nominal));
    if(c.upper!=null && c.upper!=='' ) add((Number(c.upper)>=0?'+':'')+fmtNum(Math.abs(Number(c.upper))));
    if(c.lower!=null && c.lower!=='' ) add((Number(c.lower)>=0?'+':'')+fmtNum(Math.abs(Number(c.lower))));
    var t=[c.calloutText,c.feature,c.spec,c.gdt].filter(Boolean).join(' ');
    var m=t.match(/M\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?/i);
    if(m) add(normalizeText(m[0]));
    return out;
  }
  function buildCandidateVariants(c){
    var arr=[];
    function add(v){if(v && arr.indexOf(v)<0) arr.push(v);}
    add(c.calloutText); add(c.evidenceText); add(c.spec); add(c.gdt);
    add(c.feature);
    var nums=numericTokens(c.calloutText||c.feature||'');
    if(nums.length) add(nums.join(' '));
    expectedNumericParts(c).forEach(add);
    return arr.filter(Boolean);
  }

  function matchCandidate(c, lines){
    var vars=buildCandidateVariants(c), best=null;
    var cx=c.calloutX!=null?Number(c.calloutX):null, cy=c.calloutY!=null?Number(c.calloutY):null;
    var expected=expectedNumericParts(c).map(function(v){return normalizeText(v);}).filter(Boolean);
    var candidates=[];
    (lines||[]).forEach(function(l){
      candidates.push(l);
      var ws=l.words||[];
      /* Tight spans: engineering callouts are often split into nominal/tolerance/
         degree/thread tokens. Search 1..10 adjacent OCR/vector words instead of
         assuming one OCR line equals one engineering annotation. */
      for(var a=0;a<ws.length;a++){
        for(var len=1;len<=Math.min(10,ws.length-a);len++){
          var slice=ws.slice(a,a+len), minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
          slice.forEach(function(w){minX=Math.min(minX,w.x);minY=Math.min(minY,w.y);maxX=Math.max(maxX,w.x+w.w);maxY=Math.max(maxY,w.y+w.h);});
          candidates.push({text:slice.map(function(w){return w.text;}).join(' '),x:minX,y:minY,w:maxX-minX,h:maxY-minY,words:slice});
        }
      }
    });
    function numberCoverage(text){
      var n=normalizeText(text), hit=0;
      expected.forEach(function(v){
        if(!v) return;
        /* Compare complete formatted numbers first. `0.05` must not match `0.5`. */
        if(n.indexOf(v)>=0) hit++;
        else {
          var base=v.replace(/^\+/,'');
          if(base && n.indexOf(base)>=0) hit+=0.55;
        }
      });
      return expected.length?Math.min(1,hit/expected.length):0;
    }
    candidates.forEach(function(l){
      vars.forEach(function(v){
        var sim=similarity(v,l.text);
        var d=(cx!=null&&cy!=null)?distancePct(cx,cy,l.x+l.w/2,l.y+l.h/2):0.30;
        var near=Math.max(0,1-d/0.18);
        var numsA=numericTokens(v), numsB=numericTokens(l.text), numHit=0;
        if(numsA.length){
          numsA.forEach(function(a){ if(numsB.some(function(b){return Math.abs(a-b)<0.000001;})) numHit++; });
          numHit/=numsA.length;
        }
        var fmtHit=numberCoverage(l.text);
        var symbolHit=0;
        var lt=String(l.text||''), ct=String(c.calloutText||'');
        if(/[±]/.test(ct) && /±|\+\/-/.test(lt)) symbolHit+=0.25;
        if(/[Ø⌀]/.test(ct) && /Ø|⌀|dia|diam/i.test(lt)) symbolHit+=0.20;
        if(/[×x]/.test(ct) && /×|x/.test(lt)) symbolHit+=0.12;
        if(/[°]/.test(ct) && /°|deg/i.test(lt)) symbolHit+=0.12;
        var avgConf=(l.words&&l.words.length)?l.words.reduce(function(s,w){return s+Number(w.confidence||0);},0)/l.words.length:95;
        var conf=Math.max(0,Math.min(1,avgConf/100));
        /* Numeric/formatted evidence dominates prose similarity for engineering
           drawings because the feature description is frequently AI-generated.
           Reported from the field: balloons landing on the wrong one of several
           identical callouts (the same tolerance, the same chamfer, repeated
           across a dense drawing) — prose similarity and number-matching alone
           cannot tell two "0.5 x 45°" chamfers apart, but their positions are
           different. near was weighted at 0.10, too little to break that tie
           against a strong text match on the WRONG occurrence. It now weighs
           as much as prose similarity, taken from prose similarity's own
           weight, since the AI's own reported location is at least as
           trustworthy as its restated wording of the callout. */
        var score=0.18*sim+0.24*numHit+0.28*fmtHit+0.16*near+0.08*conf+symbolHit;
        if(!best || score>best.score) best={score:Math.min(1,score),line:l,variant:v,sim:sim,numHit:numHit,fmtHit:fmtHit,near:near};
      });
    });
    return best;
  }


  function cropFromDataUrl(dataUrl, cx, cy, pctW, pctH){
    return dataUrlToImage(dataUrl).then(function(img){
      var x=Math.max(0,Math.min(img.width-1,(Number(cx)/100-Number(pctW)/200)*img.width));
      var y=Math.max(0,Math.min(img.height-1,(Number(cy)/100-Number(pctH)/200)*img.height));
      var w=Math.min(img.width-x, img.width*Number(pctW)/100), h=Math.min(img.height-y,img.height*Number(pctH)/100);
      var out=document.createElement('canvas'); out.width=Math.max(1,Math.round(w)); out.height=Math.max(1,Math.round(h));
      var g=out.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,out.width,out.height);g.drawImage(img,x,y,w,h,0,0,out.width,out.height);
      return { dataUrl:out.toDataURL('image/png'), origin:{x:x/img.width*100,y:y/img.height*100,w:w/img.width*100,h:h/img.height*100} };
    });
  }

  async function scan(att){
    var url=attachmentDataUrl(att); if(!url) throw new Error('No image attachment available for OCR.');
    var img=await dataUrlToImage(url);
    var p1=preprocess(img,'contrast'), p2=preprocess(img,'threshold');
    // Two workers, run together — see the note on workerPromises above.
    var w1p=worker(0), w2p=worker(1);
    var r1p = w1p.then(function(w){ return w.recognize(p1.canvas.toDataURL('image/png')); });
    var r2p = w2p.then(function(w){ return w.recognize(p2.canvas.toDataURL('image/png')); });
    var r1r2 = await Promise.all([r1p, r2p]);
    var r1 = r1r2[0], r2 = r1r2[1];
    var words=ocrWords(r1,img.width,img.height,p1.scale).concat(ocrWords(r2,img.width,img.height,p2.scale));
    /* De-duplicate OCR words from the two preprocessing passes. */
    var uniq=[];
    words.forEach(function(wd){
      var dup=uniq.some(function(q){
        return normalizeText(q.text)===normalizeText(wd.text) && Math.abs(q.x-wd.x)<0.45 && Math.abs(q.y-wd.y)<0.65;
      });
      if(!dup) uniq.push(wd);
    });
    return {width:img.width,height:img.height,words:uniq,lines:groupLines(uniq),source:'tesseract+dual-preprocess'};
  }

  /* Apply OCR evidence to the AI list. The important behaviour is conservative:
     a high-quality OCR hit relocates the printed callout box; a weak/no hit clears
     the automatic balloon target. */
  function apply(parsed, evidence){
    var cs=(parsed&&parsed.characteristics)||[], changed=0, unresolved=0;
    cs.forEach(function(c){
      var m=matchCandidate(c,evidence.lines||[]);
      if(m && m.score>=0.64){
        var l=m.line, ctr=bboxCenter(l);
        c.visionEvidence={source:evidence.source,score:Number(m.score.toFixed(3)),text:l.text,ocrBBox:{x:l.x,y:l.y,w:l.w,h:l.h}};
        c.calloutX=ctr.x; c.calloutY=ctr.y; c.calloutBBox={x:l.x,y:l.y,w:l.w,h:l.h};
        c.validationConfidence=(m.score>=0.82 && m.line.words.every(function(w){return w.confidence>=55;}))?'High':(c.validationConfidence||'Medium');
        if(c.validationStatus!=='duplicate') c.validationStatus=(m.score>=0.78?'corrected':'unresolved');
        c.x=c.calloutX;c.y=c.calloutY;
        changed++;
      } else {
        var score=m?Number(m.score.toFixed(3)):0;
        c.visionEvidence={source:evidence.source,score:score,text:m?m.line.text:'',ocrBBox:m&&m.line?{x:m.line.x,y:m.line.y,w:m.line.w,h:m.line.h}:null};
        /* A vector-PDF text box is stronger spatial evidence than OCR. If OCR
           cannot see it because of font/scan noise, keep the vector proof and
           let the export gate decide from both sources. */
        if (!(c.vectorEvidence && Number(c.vectorEvidence.score||0)>=0.82)) {
          c.calloutX=null;c.calloutY=null;c.calloutBBox=null;c.x=null;c.y=null;
          c.validationStatus='unresolved'; unresolved++;
          /* Below 0.30 is not "weak evidence, check by hand" — it is no match
             anywhere on the sheet for this text or its numbers, on either OCR
             pass. Leaving a row like that in the table (just unballooned)
             reads as a real requirement someone forgot to place; it is more
             often the AI describing something that is not printed on this
             drawing at all. Flag it distinctly so the caller can drop it from
             the table rather than only from the drawing. */
          if(score<0.30) c.noDrawingEvidence=true;
        }
      }
    });
    parsed.vision={source:evidence.source,scannedWords:(evidence.words||[]).length,scannedLines:(evidence.lines||[]).length,
      matched:changed,unresolved:unresolved,at:new Date().toLocaleString()};
    return parsed.vision;
  }

  function applyVector(parsed, meta){
    var items=(meta&&meta.textItems)||[];
    if(!items.length) return {source:'pdf-text-layer',matched:0,available:false};
    var fullW=(meta.viewport&&meta.viewport.width)||1, fullH=(meta.viewport&&meta.viewport.height)||1;
    var lines=groupLines(items.map(function(it){
      return {text:String(it.text||''),confidence:100,
        x:Number(it.x||0)/fullW*100,y:Number(it.y||0)/fullH*100,
        w:Number(it.w||0)/fullW*100,h:Number(it.h||0)/fullH*100,words:[]};
    }));
    var matched=0, recovered=0;
    (parsed.characteristics||[]).forEach(function(c){
      var m=matchCandidate(c,lines);
      /* If the model already supplied a plausible callout coordinate, use that as
         the spatial prior. For vector PDFs the actual printed text box wins when
         the vector matcher has enough numeric evidence. */
      if(m && m.score>=0.66){
        var l=m.line, ctr=bboxCenter(l);
        var oldX=c.calloutX, oldY=c.calloutY;
        c.vectorEvidence={source:'pdf-text-layer',score:Number(m.score.toFixed(3)),text:l.text,
          bbox:{x:l.x,y:l.y,w:l.w,h:l.h},method:'vector-text-run+numeric-signature'};
        c.calloutX=ctr.x; c.calloutY=ctr.y;
        c.calloutBBox={x:l.x,y:l.y,w:l.w,h:l.h};
        /* The vector text is the exact printed callout; prefer it over a prose
           description so future focused verification receives the real text. */
        if(l.text && l.text.trim()) c.calloutText=l.text.trim();
        if(c.validationStatus!=='duplicate') c.validationStatus='corrected';
        c.validationConfidence = m.score>=0.78 ? 'High' : 'Medium';
        c.x=c.calloutX;c.y=c.calloutY; matched++;
        if(oldX==null || oldY==null) recovered++;
      }
    });
    return {source:'pdf-text-layer',matched:matched,recovered:recovered,available:true,at:new Date().toLocaleString()};
  }

  global.EngineeringVision={
    scan:scan,
    apply:apply,
    applyVector:applyVector,
    crop:cropFromDataUrl,
    normalizeText:normalizeText,
    similarity:similarity,
    matchCandidate:matchCandidate
  };
})(window);

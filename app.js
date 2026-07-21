/* ============================================================
   app.js — telemetry, impact KPIs, symbol map, control wiring
   Drives both the DOM panels and the 3D Scene (scene.js).
   Data reproduces the verified DDDSU (S=10:2:2) impact table.
   ============================================================ */
(function () {
  "use strict";

  /* ---- verified dataset: 6 × DDDSU (S=10:2:2) ---- */
  /* symbols out of DL=312, UL=96; frame total = 420 */
  const DATA = {
    30:  { ta:3.5, blankS:60,  blankP:19, unusS:84,  unusP:27,  totS:144, totP:46,  ulS:96, ulP:100 },
    40:  { ta:3.0, blankS:0,   blankP:0,  unusS:96,  unusP:31,  totS:96,  totP:31,  ulS:96, ulP:100 },
    50:  { ta:2.5, blankS:0,   blankP:0,  unusS:72,  unusP:23,  totS:72,  totP:23,  ulS:72, ulP:75  },
    90:  { ta:2.0, blankS:96,  blankP:31, unusS:96,  unusP:31,  totS:96,  totP:31,  ulS:0,  ulP:0   },
    all: { ta:null,blankS:156, blankP:50, unusS:312, unusP:100, totS:312, totP:100, ulS:96, ulP:100, combo:true }
  };
  const DL_TOT = 312, UL_TOT = 96;
  const ANCHORS = [30, 40, 50, 90];

  /* delay-vs-elevation curve (verified measured points, ms) */
  const DELAY_PTS = [[30,3.586],[40,2.943],[50,2.579],[90,2.000]];
  const TA_PTS    = [[30,3.5],  [40,3.0],  [50,2.5],  [90,2.0]];

  function lerpCurve(pts, e){
    for(let i=0;i<pts.length-1;i++){
      const [a,va]=pts[i], [b,vb]=pts[i+1];
      if(e>=a && e<=b){ const t=(e-a)/(b-a); return va+(vb-va)*t; }
    }
    return e<pts[0][0] ? pts[0][1] : pts[pts.length-1][1];
  }
  const delayAt = e => lerpCurve(DELAY_PTS, e);
  const taAt    = e => lerpCurve(TA_PTS, e);

  function nearestAnchor(e){
    let best=ANCHORS[0], bd=Infinity;
    for(const a of ANCHORS){ const d=Math.abs(a-e); if(d<bd){bd=d;best=a;} }
    return best;
  }

  const C = 299792.458; // km/ms
  const $ = id => document.getElementById(id);
  const fmt = (n,d) => n.toFixed(d);

  const elev = $('elev');

  /* =========================================================
     RENDER
     ========================================================= */
  function render(mode){
    const combo = (mode === 'all');
    const el = combo ? 90 : mode;
    const d  = combo ? DATA.all : DATA[nearestAnchor(el)];
    const dt = combo ? null : delayAt(el);
    const ta = combo ? null : taAt(el);

    /* ---- telemetry rail ---- */
    $('tElev').textContent  = combo ? 'Σ' : el;
    $('tTa').textContent    = combo ? '—' : fmt(ta,1);
    $('tDt').textContent    = combo ? '—' : fmt(dt,2);
    $('tRange').textContent = combo ? '↕'  : Math.round(dt*C);

    const status = $('tStatus');
    const critState = combo || d.totP>=45 || d.ulP>=100;
    status.classList.toggle('crit', critState);
    status.querySelector('b').textContent =
      combo ? 'Aggregate · full pass' :
      (el===90 ? 'Tracking · zenith pass' :
       el<=35  ? 'Tracking · horizon-grazing' :
                 'Tracking · slant pass');

    /* ---- mode tag ---- */
    $('modeTag').textContent = combo ? 'All elevations' : 'Single pass';

    /* ---- KPIs ---- */
    setKPI('kBlankP','kBlankS','barBlank', d.blankP, d.blankS, DL_TOT);
    setKPI('kUnusP', 'kUnusS', 'barUnus',  d.unusP,  d.unusS,  DL_TOT);
    setKPI('kTotP',  'kTotS',  'barTot',   d.totP,   d.totS,   DL_TOT);
    setKPI('kUlP',   'kUlS',   'barUl',    d.ulP,    d.ulS,    UL_TOT);

    /* ---- slider fill + tick state ---- */
    elev.style.setProperty('--fill', combo ? '100%' : ((el-30)/60*100)+'%');
    document.querySelectorAll('#ticks button').forEach(b=>{
      b.classList.toggle('on', b.dataset.e === String(mode));
    });

    drawStrip(d, el, combo);
    drawVerdict(d, el, combo);

    /* ---- drive the 3D scene ---- */
    if(window.Scene && Scene.ready){
      if(combo) Scene.setCombo(true);
      else Scene.setElevation(el);
    }
  }

  function setKPI(pId, sId, barId, pct, sym){
    const pctEl = $(pId);
    pctEl.firstChild.textContent = pct;        // number node
    $(sId).textContent = sym;
    $(barId).style.width = Math.min(100, pct) + '%';
  }

  /* =========================================================
     SYMBOL STRIP — one DDDSU period (5 slots × 14 = 70 symbols)
     ========================================================= */
  const NS = 'http://www.w3.org/2000/svg';
  function el_(name, attrs){
    const n = document.createElementNS(NS, name);
    for(const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function drawStrip(d, el, combo){
    const strip = $('strip');
    strip.innerHTML = '';

    const W=700, padL=8, padR=8, total=70;
    const usable=W-padL-padR, cw=usable/total;
    const yTop=28, hh=36;

    /* per-period budget (frame is 6 periods): DL 52, UL 16 */
    const per = combo ? DATA.all : DATA[nearestAnchor(el)];
    const dlPer=52, ulPer=16;
    const blankN = Math.round(per.blankP/100 * dlPer);
    const unusN  = Math.round(per.unusP /100 * dlPer);
    const ulN    = Math.round(per.ulP  /100 * ulPer);

    /* base classes across the period: D D D | S(10D 2GP 2U) | U */
    const cells=[];
    for(let i=0;i<42;i++) cells.push('DL');
    for(let i=0;i<10;i++) cells.push('DL');
    for(let i=0;i<2;i++)  cells.push('GP');
    for(let i=0;i<2;i++)  cells.push('UL');
    for(let i=0;i<14;i++) cells.push('UL');

    const dlIdx=[], ulIdx=[];
    cells.forEach((c,i)=>{ if(c==='DL')dlIdx.push(i); if(c==='UL')ulIdx.push(i); });

    /* interfered UL from start of UL region */
    for(let k=0;k<ulN && k<ulIdx.length;k++) cells[ulIdx[k]]='INTERF';
    /* unusable DL = last unusN downlink symbols (nearest the guard) */
    for(let k=0;k<unusN;k++){ const i=dlIdx[dlIdx.length-1-k]; if(i!=null) cells[i]='UNUS'; }
    /* blanked DL = the blankN symbols just before those */
    for(let k=0;k<blankN;k++){ const i=dlIdx[dlIdx.length-1-unusN-k]; if(i!=null && cells[i]==='DL') cells[i]='BLANK'; }

    const col={ DL:'var(--dl)', GP:'var(--gp)', UL:'var(--ul)',
                BLANK:'var(--blank)', UNUS:'var(--unus)', INTERF:'var(--interf)' };

    let x=padL;
    cells.forEach(c=>{
      strip.appendChild(el_('rect',{
        x:x.toFixed(2), y:yTop, width:(cw-0.6).toFixed(2), height:hh,
        rx:0.5, fill:col[c], opacity:(c==='DL'?0.82:0.96)
      }));
      x+=cw;
    });

    /* slot labels D D D S U + separators */
    const bounds=[0,14,28,42,56,70], lbl=['D','D','D','S','U'];
    for(let s=0;s<5;s++){
      const mid=padL+((bounds[s]+bounds[s+1])/2)*cw;
      const t=el_('text',{ x:mid, y:19, 'text-anchor':'middle', 'font-size':11,
        fill:'var(--ink-dim)', 'letter-spacing':1 });
      t.textContent=lbl[s]; strip.appendChild(t);
      if(s>0){
        const bx=padL+bounds[s]*cw;
        strip.appendChild(el_('line',{ x1:bx, y1:yTop-3, x2:bx, y2:yTop+hh+3,
          stroke:'var(--panel-solid)', 'stroke-width':1.6 }));
      }
    }

    /* index baseline */
    strip.appendChild(el_('line',{ x1:padL, y1:yTop+hh+11, x2:W-padR, y2:yTop+hh+11,
      stroke:'var(--glass-line-soft)' }));
    [1,14,28,42,56,70].forEach(n=>{
      const tx=Math.min(padL+(n-1)*cw, W-padR-6);
      const t=el_('text',{ x:tx, y:yTop+hh+24, 'font-size':8.5, fill:'var(--ink-faint)' });
      t.textContent=n; strip.appendChild(t);
    });

    /* note */
    const note=$('stripNote');
    if(combo){
      note.innerHTML='<b>Aggregated across 30°–90°:</b> every downlink symbol is struck by at least one elevation (100% DL loss) and all uplink symbols see aggregate BS interference. No single synchronised frame can serve a moving satellite.';
    }else{
      const near=nearestAnchor(el);
      note.innerHTML='At <b>'+el+'°</b> (nearest measured row '+near+'°, TA '+fmt(taAt(el),1)+' ms) the satellite&#39;s DL arrives <b>'+fmt(delayAt(el),2)+' ms</b> late — far beyond the 71.4&nbsp;µs guard. Trailing DL symbols must be <b>blanked</b> or become <b>unusable</b>, and terrestrial UL suffers <b>BS-to-BS interference</b>.';
    }
  }

  /* =========================================================
     VERDICT
     ========================================================= */
  function drawVerdict(d, el, combo){
    const v=$('verdict'), ic=$('verdIc'), tx=$('verdTxt');
    let crit=false, msg='';

    if(combo){
      crit=true;
      msg='<b>Not feasible across the full pass.</b> Accounting for all elevation angles gives 100% DL capacity loss and 100% of UL symbols interfered — there is no single synchronised frame that serves a satellite in motion.';
    }else{
      const near=nearestAnchor(el);
      const row=DATA[near];
      if(row.totP>=45 || row.ulP>=100) crit=true;
      if(near===90){
        msg='At <b>zenith (90°)</b> the delay is smallest (2.0 ms) yet still ≈28× the guard: <b>31% of DL</b> is lost. UL is spared here because the timing advance keeps the D2D UE clear of terrestrial UL.';
      }else if(near===50){
        msg='At <b>50°</b> the impact is lowest of the sampled angles — <b>23% DL</b> loss and <b>75% UL</b> interfered — but it is still a large, unavoidable capacity hit.';
      }else if(near===40){
        msg='At <b>40°</b> the 2.94 ms delay pushes <b>31% of DL</b> into unusable simultaneous DL/UL, and <b>100% of UL</b> symbols are interfered by terrestrial BSs.';
      }else{
        msg='At <b>30°</b> (worst case, 3.59 ms delay) the combined DL impact reaches <b>46%</b> and <b>every UL symbol</b> is interfered — the guard period cannot absorb the round-trip.';
      }
    }
    v.classList.toggle('crit', crit);
    ic.textContent = crit ? '▲' : '◆';
    tx.innerHTML = msg;
  }

  /* =========================================================
     EVENTS
     ========================================================= */
  elev.addEventListener('input', () => render(+elev.value));
  document.querySelectorAll('#ticks button').forEach(b=>{
    b.addEventListener('click', ()=>{
      const e=b.dataset.e;
      if(e==='all'){ render('all'); }
      else { elev.value=e; render(+e); }
    });
  });

  /* init at zenith */
  render(90);
})();

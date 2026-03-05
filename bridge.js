'use strict';

/* ── UTC Clock ── */
function tick() {
  const n = new Date(), p = v => String(v).padStart(2, '0');
  const el = document.getElementById('clock');
  if (el) el.textContent = p(n.getUTCHours()) + ':' + p(n.getUTCMinutes()) + ':' + p(n.getUTCSeconds()) + ' UTC';
}
setInterval(tick, 1000);
tick();

/* ══════════════════════════════════════════
   TOPOLOGY SVG
   ══════════════════════════════════════════ */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK  = 'http://www.w3.org/1999/xlink';

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('xlink:')) el.setAttributeNS(XLINK, k.split(':')[1], v);
    else el.setAttribute(k, v);
  }
  return el;
}

/* Measure element position relative to the btc container */
function relPos(el) {
  const btc   = document.getElementById('btc');
  const bRect = btc.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  return {
    cx:     eRect.left - bRect.left + eRect.width  / 2,
    cy:     eRect.top  - bRect.top  + eRect.height / 2,
    top:    eRect.top  - bRect.top,
    bottom: eRect.bottom - bRect.top,
    left:   eRect.left - bRect.left,
    right:  eRect.right - bRect.left,
    w: eRect.width,
    h: eRect.height,
  };
}

/* Draw a cubic bezier path between two points (vertical direction) */
function makeBezier(x1, y1, x2, y2) {
  const mid = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

let pathMap = {}; // id → pathEl

function buildTopoSVG() {
  const svg  = document.getElementById('topo-svg');
  const btc  = document.getElementById('btc');
  const dpu  = document.getElementById('topo-dpu');
  const gw   = document.getElementById('topo-gw');

  if (!svg || !btc || !dpu || !gw) return;

  /* Size the SVG to cover the whole container */
  const h = btc.getBoundingClientRect().height;
  svg.setAttribute('height', h);

  /* Remove old paths (but keep <defs>) */
  svg.querySelectorAll('path').forEach(e => e.remove());
  pathMap = {};

  const dpuP = relPos(dpu);
  const gwP  = relPos(gw);

  /* ── MFD → DPU ── */
  ['port', 'center', 'stbd'].forEach(zone => {
    const mfd = document.querySelector(`#zone-${zone} .m-tile.mfd`);
    if (!mfd) return;
    const mP = relPos(mfd);
    const d  = makeBezier(mP.cx, mP.bottom, dpuP.cx, dpuP.top);
    const p  = svgEl('path', { d, id: `path-mfd-${zone}`, class: 'topo-path mfd-dpu' });
    svg.appendChild(p);
    pathMap[`mfd-${zone}`] = p;
  });

  /* ── DPU → Gateway ── */
  const d1 = `M ${dpuP.cx} ${dpuP.bottom} L ${gwP.cx} ${gwP.top}`;
  const pd = svgEl('path', { d: d1, id: 'path-dpu-gw', class: 'topo-path dpu-gw' });
  svg.appendChild(pd);
  pathMap['dpu-gw'] = pd;

  /* ── Gateway → 3rd party monitors (return path) ── */
  ['port', 'center', 'stbd'].forEach(zone => {
    document.querySelectorAll(`#zone-${zone} .m-tile.third`).forEach((el, idx) => {
      const tP = relPos(el);
      /* Gateway TOP → monitor BOTTOM  (arrow goes upward) */
      const d  = makeBezier(gwP.cx, gwP.top, tP.cx, tP.bottom);
      const id = `path-gw-${zone}-${idx}`;
      const p  = svgEl('path', { d, id, class: `topo-path gw-third` });
      svg.appendChild(p);
      pathMap[`gw-${zone}-${idx}`] = p;
    });
  });
}

/* Animate a moving dot along a path */
function pulseDot(pathId, color, durationMs) {
  const svg    = document.getElementById('topo-svg');
  const pathEl = document.getElementById(pathId);
  if (!svg || !pathEl) return;

  const dot    = svgEl('circle', { r: '5', fill: color, filter: 'url(#glow)', opacity: '0.95' });
  const motion = svgEl('animateMotion', { dur: durationMs + 'ms', begin: '0s', fill: 'remove', calcMode: 'linear' });
  const mpath  = svgEl('mpath', { 'xlink:href': '#' + pathId });
  motion.appendChild(mpath);
  dot.appendChild(motion);
  svg.appendChild(dot);
  setTimeout(() => { if (svg.contains(dot)) svg.removeChild(dot); }, durationMs + 150);
}

/* Fire a path (bright + pulseDot) */
function firePath(pathId, color, durationMs) {
  const p = document.getElementById(pathId);
  if (!p) return;
  p.classList.add('firing');
  pulseDot(pathId, '#ffffff', durationMs);
  setTimeout(() => p.classList.remove('firing'), durationMs + 200);
}

/* Fire a topology node box */
function fireTopoNode(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('firing');
  void el.offsetWidth;
  el.classList.add('firing');
  setTimeout(() => el.classList.remove('firing'), 700);
}

/* Flash zone header */
function flashZone(zone) {
  const col = document.getElementById('zone-' + zone);
  if (!col) return;
  col.classList.add('transmitting');
  setTimeout(() => col.classList.remove('transmitting'), 1400);
}

/* Flash 3rd party tiles */
function flashThirdParty(zone) {
  document.querySelectorAll('#zone-' + zone + ' .m-tile.third').forEach(el => {
    el.classList.remove('snmp-received');
    void el.offsetWidth;
    el.classList.add('snmp-received');
    setTimeout(() => el.classList.remove('snmp-received'), 700);
  });
}

/*
  Signal chain when dimmer pressed on zone Z:
  t=0   → MFD of Z flashes (zone header goes green)
  t=0   → firePath mfd-Z → DPU  (300ms travel)
  t=320 → fireTopoNode DPU
  t=400 → firePath DPU → GW  (280ms travel)
  t=700 → fireTopoNode GW
  t=750 → firePath GW → all 3 thirds of Z (350ms travel, staggered 60ms)
  t=1050 → flashThirdParty + apply CSS filter
*/
function triggerTopoAnimation(zone) {
  flashZone(zone);

  /* MFD → DPU */
  firePath(`path-mfd-${zone}`, '#00e8ff', 310);

  setTimeout(() => {
    fireTopoNode('topo-dpu');
  }, 330);

  /* DPU → GW */
  setTimeout(() => {
    firePath('path-dpu-gw', '#ffcc00', 280);
  }, 410);

  /* GW → 3rd party */
  setTimeout(() => {
    fireTopoNode('topo-gw');
    [0, 1, 2].forEach((idx, i) => {
      setTimeout(() => {
        firePath(`path-gw-${zone}-${idx}`, '#c8b8ff', 340);
      }, i * 70);
    });
  }, 710);
}

/* ══════════════════════════════════════════
   DIMMER
   ══════════════════════════════════════════ */
const LEVELS  = [100, 80, 60, 40, 20];
const FILTERS = {
  100: 'brightness(1)',
   80: 'brightness(0.72) saturate(0.9)',
   60: 'brightness(0.50) saturate(0.75)',
   40: 'brightness(0.30) saturate(0.55)',
   20: 'brightness(0.14) saturate(0.30)'
};
const state = { port: 0, center: 0, stbd: 0 };

function applyDim(zone, idx) {
  state[zone] = idx;
  const lvl = LEVELS[idx];
  const f   = FILTERS[lvl];

  document.querySelectorAll(`#zone-${zone} .dim-pip`).forEach((p, i) => {
    p.classList.toggle('on', i >= idx);
  });
  const pct = document.getElementById(`dpct-${zone}`);
  if (pct) pct.textContent = lvl + '%';

  /* MFD — immediate */
  const mfd = document.querySelector(`#zone-${zone} .m-tile.mfd`);
  if (mfd) { mfd.style.transition = 'filter .3s'; mfd.style.filter = f; }

  /* 3rd party — after topology signal arrives (~1050ms) */
  document.querySelectorAll(`#zone-${zone} .m-tile.third`).forEach(el => {
    el.style.transition = 'none';
    setTimeout(() => {
      el.style.transition = 'filter .5s';
      el.style.filter = f;
      flashThirdParty(zone);
    }, 1060);
  });
}

function dimChange(zone, dir) {
  const next = state[zone] + dir;
  if (next < 0 || next >= LEVELS.length) return;
  applyDim(zone, next);
  triggerTopoAnimation(zone);
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
  ['port', 'center', 'stbd'].forEach(z => applyDim(z, 0));

  /* Build SVG after layout is painted */
  requestAnimationFrame(() => {
    setTimeout(() => {
      buildTopoSVG();
    }, 80);
  });

  /* Rebuild on resize */
  window.addEventListener('resize', () => {
    clearTimeout(window._rszTimer);
    window._rszTimer = setTimeout(buildTopoSVG, 150);
  });
});

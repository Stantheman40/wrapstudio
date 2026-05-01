// WrapStudio Pro — app.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
const CAR_IMAGES = ['img/bil1.png','img/bil2.png','img/bil3.png','img/bil4.png'];

const state = {
  carIndex : 0,
  carImgs  : Array(4).fill(null),   // loaded Image elements
  whiteMask: Array(4).fill(null),   // canvas – white body pixels only
  carMask  : Array(4).fill(null),   // canvas – full car silhouette
  wrap     : { active:false, color:'#cc0000', opacity:0.82, pattern:null, uploadedImg:null,
               gradColor2:'#0044cc', gradDir:'h' },
  decals   : [],
  nextId   : 1,
  selId    : null,
  viewMode : '2d',
  drag     : { on:false, mode:null, id:null, handle:null,
               sx:0, sy:0, ox:0, oy:0, ow:0, oh:0, orot:0 },
};

// ═══════════════════════════════════════════════════════
//  CANVAS REFERENCES
// ═══════════════════════════════════════════════════════
const canvas = document.getElementById('main-canvas');
const ctx    = canvas.getContext('2d');
// Persistent off-screen composite canvas
const tmp    = document.createElement('canvas');
const tctx   = tmp.getContext('2d');

function syncTmp() {
  if (tmp.width !== canvas.width || tmp.height !== canvas.height) {
    tmp.width  = canvas.width;
    tmp.height = canvas.height;
  }
}

// ═══════════════════════════════════════════════════════
//  MASK BUILDER  (runs once per image, in a Worker-lite loop)
// ═══════════════════════════════════════════════════════
function buildMasks(img, idx) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const oc  = off.getContext('2d');
  oc.drawImage(img, 0, 0);
  const src = oc.getImageData(0, 0, W, H).data;

  const wData = new Uint8ClampedArray(W * H * 4);
  const cData = new Uint8ClampedArray(W * H * 4);

  for (let i = 0; i < src.length; i += 4) {
    const r = src[i], g = src[i+1], b = src[i+2], a = src[i+3];
    if (a < 18) continue;

    // Car silhouette — any visible pixel
    cData[i+3] = a;

    // White-body mask — bright + low saturation
    const br  = (r + g + b) / 3;
    const sat = Math.max(r,g,b) - Math.min(r,g,b);
    if (br > 168 && sat < 58) {
      // Smooth alpha: full where very white, fades at edges/shadows
      wData[i+3] = Math.min(255, Math.round((br - 168) / 87 * 255 * (a / 255)));
    }
  }

  const toCanvas = (data, w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
    return c;
  };

  state.whiteMask[idx] = toCanvas(wData, W, H);
  state.carMask[idx]   = toCanvas(cData, W, H);
}

// ═══════════════════════════════════════════════════════
//  CANVAS RESIZE
// ═══════════════════════════════════════════════════════
function resizeCanvas() {
  const v = document.getElementById('viewer-2d');
  canvas.width  = v.clientWidth  || window.innerWidth  - 300;
  canvas.height = v.clientHeight || window.innerHeight - 54;
  render2D();
}

// ═══════════════════════════════════════════════════════
//  CAR RECT (fit-contain inside canvas)
// ═══════════════════════════════════════════════════════
function carRect() {
  const img = state.carImgs[state.carIndex];
  if (!img) return { x:0, y:0, w:canvas.width, h:canvas.height, sx:1, sy:1 };
  const scale = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
  const w = img.naturalWidth  * scale;
  const h = img.naturalHeight * scale;
  return {
    x  : (canvas.width  - w) / 2,
    y  : (canvas.height - h) / 2,
    w, h,
    sx : scale,   // pixel → canvas scale factors
    sy : scale,
  };
}

// ═══════════════════════════════════════════════════════
//  MAIN RENDER
// ═══════════════════════════════════════════════════════
function render2D() {
  const W = canvas.width, H = canvas.height;
  syncTmp();
  ctx.clearRect(0, 0, W, H);

  // ── background ──────────────────────────────────────
  ctx.fillStyle = '#0d0d14';
  ctx.fillRect(0, 0, W, H);

  const img  = state.carImgs[state.carIndex];
  const r    = carRect();

  // ── base car image ───────────────────────────────────
  if (img) ctx.drawImage(img, r.x, r.y, r.w, r.h);

  // ── wrap / vinyl  (clipped to white body mask) ───────
  if (state.wrap.active) {
    tctx.clearRect(0, 0, W, H);
    tctx.save();
    tctx.globalAlpha = state.wrap.opacity;
    drawWrapToCtx(tctx, r);
    tctx.restore();

    const wm = state.whiteMask[state.carIndex];
    if (wm) {
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(wm, r.x, r.y, r.w, r.h);
      tctx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(tmp, 0, 0);
  }

  // ── decals  (clipped to full car silhouette) ─────────
  const cm = state.carMask[state.carIndex];
  state.decals.forEach(d => {
    if (d.opacity === 0) return;
    tctx.clearRect(0, 0, W, H);
    drawDecalToCtx(tctx, d);

    if (cm) {
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(cm, r.x, r.y, r.w, r.h);
      tctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = d.opacity ?? 1;
    ctx.drawImage(tmp, 0, 0);
    ctx.globalAlpha = 1;
  });

  // ── selection handles (NOT masked) ───────────────────
  if (state.selId) {
    const d = state.decals.find(d => d.id === state.selId);
    if (d) drawHandles(d);
  }

  // ── keep 3D in sync with every 2D change ─────────────
  scene3d?.syncWrap(state.wrap, state.decals, canvas.width, canvas.height);
}

// ═══════════════════════════════════════════════════════
//  DRAW WRAP LAYER
// ═══════════════════════════════════════════════════════
function drawWrapToCtx(c, r) {
  const p   = state.wrap.pattern;
  const col = state.wrap.color;
  const { x, y, w, h } = r;

  if (!p || p === 'matte') {
    c.fillStyle = col; c.fillRect(x, y, w, h);

  } else if (p === 'gloss') {
    c.fillStyle = col; c.fillRect(x, y, w, h);
    const g = c.createLinearGradient(x, y, x, y + h * 0.55);
    g.addColorStop(0, 'rgba(255,255,255,0.38)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.06)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(x, y, w, h);

  } else if (p === 'gradient') {
    const col2 = state.wrap.gradColor2 || darken(col, 0.5);
    const dir  = state.wrap.gradDir   || 'h';
    let g;
    if      (dir === 'h') g = c.createLinearGradient(x,     y,     x+w,   y    );
    else if (dir === 'v') g = c.createLinearGradient(x,     y,     x,     y+h  );
    else if (dir === 'd') g = c.createLinearGradient(x,     y,     x+w,   y+h  );
    else                  g = c.createRadialGradient(x+w/2, y+h/2, 0, x+w/2, y+h/2, Math.max(w,h)*0.65);
    g.addColorStop(0, col);
    g.addColorStop(1, col2);
    c.fillStyle = g; c.fillRect(x, y, w, h);

  } else if (p === 'carbon') {
    patCarbon(c, x, y, w, h, col);

  } else if (p === 'stripes') {
    c.fillStyle = col; c.fillRect(x, y, w, h);
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.fillStyle = 'rgba(255,255,255,0.22)';
    const step = Math.max(18, w * 0.045);
    for (let i = -h; i < w + h; i += step * 2) {
      c.beginPath();
      c.moveTo(x+i, y); c.lineTo(x+i+step, y);
      c.lineTo(x+i+step+h, y+h); c.lineTo(x+i+h, y+h);
      c.closePath(); c.fill();
    }
    c.restore();

  } else if (p === 'camo') {
    patCamo(c, x, y, w, h, col);

  } else if (p === 'checker') {
    const sz = Math.max(14, Math.round(w / 32));
    c.fillStyle = darken(col, 0.48); c.fillRect(x, y, w, h);
    c.fillStyle = col;
    for (let gy = 0; gy * sz < h + sz; gy++)
      for (let gx = 0; gx * sz < w + sz; gx++)
        if ((gx + gy) % 2 === 0)
          c.fillRect(x + gx*sz, y + gy*sz, sz, sz);

  } else if (p === 'flames') {
    c.fillStyle = col; c.fillRect(x, y, w, h);
    patFlames(c, x, y, w, h);

  } else if (p === 'brushed') {
    patBrushed(c, x, y, w, h, col);

  } else if (p === 'hex') {
    patHex(c, x, y, w, h, col);

  } else if (p === 'dots') {
    patDots(c, x, y, w, h, col);

  } else if (p === 'pinstripe') {
    patPinstripe(c, x, y, w, h, col);

  } else if (p === 'marble') {
    patMarble(c, x, y, w, h, col);

  } else if (p === 'tiger') {
    patTiger(c, x, y, w, h, col);

  } else if (p === 'racing') {
    patRacing(c, x, y, w, h, col);

  } else if (p === 'holo') {
    patHolo(c, x, y, w, h, col);

  } else if (p === 'image' && state.wrap.uploadedImg) {
    c.drawImage(state.wrap.uploadedImg, x, y, w, h);

  } else {
    c.fillStyle = col; c.fillRect(x, y, w, h);
  }
}

// ═══════════════════════════════════════════════════════
//  PATTERN HELPERS
// ═══════════════════════════════════════════════════════
function patCarbon(c, x, y, w, h, col) {
  const s = 13;
  c.fillStyle = darken(col, 0.62); c.fillRect(x, y, w, h);
  c.fillStyle = lighten(col, 0.06);
  for (let gy = y; gy < y+h; gy += s) {
    const off = (Math.floor((gy-y)/s) % 2) * (s/2);
    for (let gx = x-s; gx < x+w+s; gx += s) {
      c.fillRect(gx + off % s, gy, s*0.82, s*0.82);
    }
  }
  c.fillStyle = darken(col, 0.38);
  for (let gy = y; gy < y+h; gy += s) {
    c.fillRect(x, gy, w, 1);
    for (let gx = x; gx < x+w; gx += s) c.fillRect(gx, gy, 1, s);
  }
}

function patCamo(c, x, y, w, h, col) {
  const variants = [col, darken(col,0.32), darken(col,0.58), lighten(col,0.12)];
  c.fillStyle = darken(col, 0.5); c.fillRect(x, y, w, h);
  let seed = 7331;
  const rnd = () => { seed = (seed*16807) % 2147483647; return (seed-1)/2147483646; };
  for (let i = 0; i < 55; i++) {
    c.fillStyle = variants[Math.floor(rnd() * variants.length)];
    c.save(); c.beginPath();
    c.ellipse(x + rnd()*w, y + rnd()*h, 14 + rnd()*w*0.17, 10 + rnd()*h*0.17, rnd()*Math.PI, 0, Math.PI*2);
    c.fill(); c.restore();
  }
}

function patFlames(c, x, y, w, h) {
  const n = Math.round(w / 75) + 1;
  for (let i = 0; i < n; i++) {
    const fx = x + (i + 0.5) * (w/n), fw = (w/n) * 0.68, fh = h * 0.52;
    const g = c.createLinearGradient(fx, y+h, fx, y+h-fh);
    g.addColorStop(0, 'rgba(255,60,0,0.96)');
    g.addColorStop(0.4,'rgba(255,140,0,0.8)');
    g.addColorStop(0.78,'rgba(255,230,40,0.45)');
    g.addColorStop(1,  'rgba(255,255,80,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(fx - fw*0.38, y+h);
    c.bezierCurveTo(fx-fw*0.55, y+h-fh*0.38, fx-fw*0.25, y+h-fh*0.72, fx, y+h-fh);
    c.bezierCurveTo(fx+fw*0.25, y+h-fh*0.72, fx+fw*0.55, y+h-fh*0.38, fx+fw*0.38, y+h);
    c.fill();
  }
}

function patBrushed(c, x, y, w, h, col) {
  c.fillStyle = darken(col, 0.22); c.fillRect(x, y, w, h);
  const g = c.createLinearGradient(x, y, x+w, y+h*0.55);
  g.addColorStop(0, lighten(col, 0.2)); g.addColorStop(0.42, col);
  g.addColorStop(0.75, lighten(col, 0.1)); g.addColorStop(1, darken(col, 0.08));
  c.fillStyle = g; c.fillRect(x, y, w, h);
  c.save();
  for (let i = 0; i < h; i++) {
    const t = i % 7;
    const alpha = t === 0 ? 0.14 : t === 3 ? 0.07 : 0.02;
    c.strokeStyle = `rgba(255,255,255,${alpha})`;
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, y+i); c.lineTo(x+w, y+i); c.stroke();
  }
  c.restore();
}

function patHex(c, x, y, w, h, col) {
  c.fillStyle = darken(col, 0.42); c.fillRect(x, y, w, h);
  const s = 18, rh = s * Math.sqrt(3) / 2;
  c.strokeStyle = col; c.lineWidth = 1.5;
  for (let row = -1; row * rh * 2 <= h + rh * 2; row++) {
    for (let col2 = -1; col2 * s * 1.5 <= w + s * 2; col2++) {
      const cx2 = x + col2 * s * 1.5 + s;
      const cy2 = y + row * rh * 2 + (col2 % 2 !== 0 ? rh : 0);
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI / 3) - Math.PI / 6;
        const px = cx2 + (s-1.5)*Math.cos(a), py = cy2 + (s-1.5)*Math.sin(a);
        i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
      }
      c.closePath();
      if ((row + col2 + 400) % 3 === 0) { c.fillStyle = lighten(col, 0.14); c.fill(); }
      c.stroke();
    }
  }
}

function patDots(c, x, y, w, h, col) {
  c.fillStyle = darken(col, 0.5); c.fillRect(x, y, w, h);
  const r = 8, sp = 24;
  for (let gy = y - sp; gy < y+h+sp; gy += sp)
    for (let gx = x - sp; gx < x+w+sp; gx += sp) {
      const ox = (Math.floor((gy - y) / sp + 200) % 2) * (sp / 2);
      const g = c.createRadialGradient(gx+ox-r*0.3, gy-r*0.3, r*0.08, gx+ox, gy, r);
      g.addColorStop(0, lighten(col, 0.3)); g.addColorStop(1, col);
      c.fillStyle = g;
      c.beginPath(); c.arc(gx+ox, gy, r, 0, Math.PI*2); c.fill();
    }
}

function patPinstripe(c, x, y, w, h, col) {
  c.fillStyle = darken(col, 0.3); c.fillRect(x, y, w, h);
  const gap = 12;
  c.save();
  for (let gx = x; gx < x+w+gap; gx += gap) {
    c.strokeStyle = col; c.lineWidth = 2;
    c.beginPath(); c.moveTo(gx, y); c.lineTo(gx, y+h); c.stroke();
    c.strokeStyle = lighten(col, 0.25); c.lineWidth = 0.6;
    c.beginPath(); c.moveTo(gx+2.5, y); c.lineTo(gx+2.5, y+h); c.stroke();
  }
  c.restore();
}

function patMarble(c, x, y, w, h, col) {
  c.fillStyle = lighten(col, 0.44); c.fillRect(x, y, w, h);
  for (let v = 0; v < 7; v++) {
    const seed = v * 7919 + 1234;
    const rnd = (n) => {
      let s = ((seed + n * 2654435761) >>> 0);
      s = ((s ^ (s >> 16)) * 0x45d9f3b) >>> 0;
      return ((s ^ (s >> 16)) >>> 0) / 4294967295;
    };
    const vCol = v % 2 === 0 ? darken(col, 0.28+rnd(0)*0.28) : lighten(col, 0.12+rnd(1)*0.18);
    c.save();
    c.globalAlpha = 0.28 + rnd(2) * 0.48;
    c.strokeStyle = vCol; c.lineWidth = 0.8 + rnd(3)*3.5; c.lineCap = 'round';
    c.beginPath();
    let vx = x + rnd(4)*w; c.moveTo(vx, y);
    for (let i = 1; i <= 10; i++) {
      vx += (rnd(i*10+5) - 0.48) * w * 0.28;
      const vy = y + (i/10)*h;
      c.bezierCurveTo(vx+(rnd(i*10+6)-0.5)*w*0.38, vy-h/22,
                      vx+(rnd(i*10+7)-0.5)*w*0.38, vy+h/22, vx, vy);
    }
    c.stroke(); c.restore();
  }
}

function patTiger(c, x, y, w, h, col) {
  c.fillStyle = col; c.fillRect(x, y, w, h);
  const dark = darken(col, 0.82);
  const n = Math.max(4, Math.round(w / 50));
  for (let i = 0; i < n; i++) {
    const bx = x + (i + 0.5) * (w / n) - w * 0.05;
    const sw = (w / n) * 0.44;
    const sk = h * 0.24;
    c.fillStyle = dark;
    c.beginPath();
    c.moveTo(bx - sk, y);
    c.bezierCurveTo(bx-sk+sw*0.55, y+h*0.32, bx+sk-sw*0.55, y+h*0.68, bx+sk, y+h);
    c.lineTo(bx+sk+sw, y+h);
    c.bezierCurveTo(bx+sk+sw-sw*0.55, y+h*0.68, bx-sk+sw+sw*0.55, y+h*0.32, bx-sk+sw, y);
    c.closePath(); c.fill();
  }
}

function patRacing(c, x, y, w, h, col) {
  c.fillStyle = col; c.fillRect(x, y, w, h);
  const sk = h * 0.3;
  const stripes = [
    { ox: w*0.27, sw: w*0.08, col: darken(col, 0.58) },
    { ox: w*0.37, sw: w*0.13, col: '#ffffff' },
    { ox: w*0.53, sw: w*0.08, col: darken(col, 0.58) },
  ];
  stripes.forEach(s => {
    c.save(); c.globalAlpha = 0.88;
    c.fillStyle = s.col;
    c.beginPath();
    c.moveTo(x+s.ox-sk,    y);
    c.lineTo(x+s.ox+s.sw-sk, y);
    c.lineTo(x+s.ox+s.sw+sk, y+h);
    c.lineTo(x+s.ox+sk,    y+h);
    c.closePath(); c.fill();
    c.restore();
  });
}

function patHolo(c, x, y, w, h, col) {
  const bg = c.createLinearGradient(x, y, x+w, y);
  bg.addColorStop(0, '#b0b0c4'); bg.addColorStop(0.5, '#d0d0e4'); bg.addColorStop(1, '#a8a8bc');
  c.fillStyle = bg; c.fillRect(x, y, w, h);
  const g = c.createLinearGradient(x, y, x+w, y+h);
  g.addColorStop(0,    'rgba(255,0,128,0.65)');
  g.addColorStop(0.14, 'rgba(255,60,0,0.58)');
  g.addColorStop(0.29, 'rgba(255,190,0,0.65)');
  g.addColorStop(0.44, 'rgba(60,255,80,0.58)');
  g.addColorStop(0.58, 'rgba(0,180,255,0.65)');
  g.addColorStop(0.73, 'rgba(80,0,255,0.58)');
  g.addColorStop(0.88, 'rgba(255,0,210,0.65)');
  g.addColorStop(1,    'rgba(255,0,128,0.58)');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  c.save(); c.globalAlpha = 0.22;
  for (let i = 0; i < 6; i++) {
    const sx = x + (i+0.5)*(w/6);
    const sg = c.createLinearGradient(sx-12, y, sx+12, y);
    sg.addColorStop(0,'transparent'); sg.addColorStop(0.5,'white'); sg.addColorStop(1,'transparent');
    c.fillStyle = sg; c.fillRect(sx-12, y, 24, h);
  }
  c.restore();
}

// ═══════════════════════════════════════════════════════
//  DRAW A DECAL
// ═══════════════════════════════════════════════════════
function drawDecalToCtx(c, d) {
  c.save();
  c.translate(d.x + d.w/2, d.y + d.h/2);
  c.rotate(d.rotation || 0);
  switch (d.type) {
    case 'sticker': drawShape(c, d.data.shape, -d.w/2, -d.h/2, d.w, d.h, d.data.color); break;
    case 'text':    drawText(c, d, -d.w/2, -d.h/2); break;
    case 'image':   if (d.data.img) c.drawImage(d.data.img, -d.w/2, -d.h/2, d.w, d.h); break;
  }
  c.restore();
}

// ═══════════════════════════════════════════════════════
//  SHAPE LIBRARY
// ═══════════════════════════════════════════════════════
function drawShape(c, shape, x, y, w, h, col) {
  c.save();
  switch(shape) {
    case 'lightning': sLightning(c,x,y,w,h,col); break;
    case 'star':      sStar(c, x+w/2, y+h/2, Math.min(w,h)*0.47, 5, col); break;
    case 'flame':     sFlame(c,x,y,w,h,col); break;
    case 'arrow':     sArrow(c,x,y,w,h,col); break;
    case 'diamond':   sDiamond(c,x,y,w,h,col); break;
    case 'skull':     sSkull(c,x,y,w,h,col); break;
    case 'stripe-h':  sStripeH(c,x,y,w,h,col); break;
    case 'stripe-d':  sStripeD(c,x,y,w,h,col); break;
    case 'tribal':    sTribal(c,x,y,w,h,col); break;
    case 'circle':    sCircle(c, x+w/2, y+h/2, Math.min(w,h)/2, col); break;
    case 'cross':     sCross(c,x,y,w,h,col); break;
    case 'wave':      sWave(c,x,y,w,h,col); break;
    case 'crown':     sCrown(c,x,y,w,h,col); break;
    case 'heart':     sHeart(c,x,y,w,h,col); break;
    case 'music':     sMusic(c,x,y,w,h,col); break;
    case 'shield':    sShield(c,x,y,w,h,col); break;
    case 'flag':      sFlag(c,x,y,w,h,col); break;
    case 'paw':       sPaw(c,x,y,w,h,col); break;
    case 'infinity':  sInfinity(c,x,y,w,h,col); break;
    case 'dragon':    sDragon(c,x,y,w,h,col); break;
  }
  c.restore();
}

function outline(c, col=0.35) { c.strokeStyle=`rgba(0,0,0,${col})`; c.lineWidth=2; c.lineJoin='round'; c.stroke(); }

function sLightning(c,x,y,w,h,col) {
  c.fillStyle=col;
  c.beginPath();
  c.moveTo(x+w*.62,y); c.lineTo(x+w*.37,y+h*.46); c.lineTo(x+w*.56,y+h*.46);
  c.lineTo(x+w*.37,y+h); c.lineTo(x+w*.64,y+h*.53); c.lineTo(x+w*.44,y+h*.53);
  c.closePath(); c.fill(); outline(c);
  c.fillStyle=lighten(col,.35);
  c.beginPath(); c.moveTo(x+w*.58,y+h*.05); c.lineTo(x+w*.47,y+h*.33); c.lineTo(x+w*.54,y+h*.33); c.closePath(); c.fill();
}

function sStar(c,cx,cy,r,pts,col) {
  c.fillStyle=col;
  c.beginPath();
  for (let i=0;i<pts*2;i++) {
    const a=(i*Math.PI/pts)-Math.PI/2, ri=i%2===0?r:r*0.41;
    i===0?c.moveTo(cx+Math.cos(a)*ri,cy+Math.sin(a)*ri):c.lineTo(cx+Math.cos(a)*ri,cy+Math.sin(a)*ri);
  }
  c.closePath(); c.fill(); outline(c);
}

function sFlame(c,x,y,w,h,col) {
  const g=c.createLinearGradient(x+w/2,y+h,x+w/2,y);
  g.addColorStop(0,'#ff2200'); g.addColorStop(.35,'#ff8800'); g.addColorStop(.7,col); g.addColorStop(1,'#ffff44');
  c.fillStyle=g;
  c.beginPath();
  c.moveTo(x+w/2,y+h);
  c.bezierCurveTo(x+w*.05,y+h*.8,x+w*.1,y+h*.48,x+w*.3,y+h*.28);
  c.bezierCurveTo(x+w*.2,y,x+w*.4,y+h*.1,x+w/2,y);
  c.bezierCurveTo(x+w*.6,y+h*.1,x+w*.8,y,x+w*.7,y+h*.28);
  c.bezierCurveTo(x+w*.9,y+h*.48,x+w*.95,y+h*.8,x+w/2,y+h);
  c.fill();
}

function sArrow(c,x,y,w,h,col) {
  c.fillStyle=col;
  const ty=h*.28,by=h*.72;
  c.beginPath();
  c.moveTo(x,y+ty); c.lineTo(x+w*.58,y+ty); c.lineTo(x+w*.58,y);
  c.lineTo(x+w,y+h/2); c.lineTo(x+w*.58,y+h); c.lineTo(x+w*.58,y+by); c.lineTo(x,y+by);
  c.closePath(); c.fill(); outline(c);
}

function sDiamond(c,x,y,w,h,col) {
  c.fillStyle=col;
  c.beginPath(); c.moveTo(x+w/2,y); c.lineTo(x+w,y+h/2); c.lineTo(x+w/2,y+h); c.lineTo(x,y+h/2); c.closePath();
  c.fill(); outline(c);
  c.fillStyle='rgba(255,255,255,0.28)';
  c.beginPath(); c.moveTo(x+w/2,y+h*.06); c.lineTo(x+w*.76,y+h*.4); c.lineTo(x+w/2,y+h*.3); c.closePath(); c.fill();
}

function sSkull(c,x,y,w,h,col) {
  c.fillStyle=col;
  c.beginPath(); c.ellipse(x+w/2,y+h*.38,w*.38,h*.38,0,0,Math.PI*2); c.fill();
  c.fillRect(x+w*.25,y+h*.62,w*.5,h*.21);
  outline(c,.3);
  c.fillStyle='rgba(0,0,0,0.65)';
  c.beginPath(); c.ellipse(x+w*.34,y+h*.35,w*.1,h*.1,0,0,Math.PI*2); c.fill();
  c.beginPath(); c.ellipse(x+w*.66,y+h*.35,w*.1,h*.1,0,0,Math.PI*2); c.fill();
  c.beginPath(); c.moveTo(x+w*.44,y+h*.5); c.lineTo(x+w*.56,y+h*.5); c.lineTo(x+w/2,y+h*.44); c.fill();
  [.29,.39,.49,.59].forEach(t=>c.fillRect(x+w*t,y+h*.63,w*.08,h*.13));
}

function sStripeH(c,x,y,w,h,col) {
  const bh=h/7; c.fillStyle=col;
  [0,2,4,6].forEach(i=>c.fillRect(x,y+i*bh,w,bh));
}

function sStripeD(c,x,y,w,h,col) {
  c.save(); c.beginPath(); c.rect(x,y,w,h); c.clip();
  c.strokeStyle=col; c.lineWidth=Math.max(4,h*.11);
  const step=c.lineWidth*2.5;
  for (let i=-w;i<w*2;i+=step) { c.beginPath(); c.moveTo(x+i,y); c.lineTo(x+i+h,y+h); c.stroke(); }
  c.restore();
}

function sTribal(c,x,y,w,h,col) {
  c.fillStyle=col;
  c.beginPath();
  c.moveTo(x,y+h/2);
  c.bezierCurveTo(x+w*.1,y,  x+w*.2,y+h, x+w*.35,y+h*.25);
  c.bezierCurveTo(x+w*.45,y, x+w*.5,y+h, x+w*.6, y+h*.35);
  c.bezierCurveTo(x+w*.7,y+h*.1, x+w*.85,y+h, x+w,y+h/2);
  c.lineTo(x+w,y+h*.85);
  c.bezierCurveTo(x+w*.85,y+h*.5, x+w*.7,y+h, x+w*.6,y+h*.65);
  c.bezierCurveTo(x+w*.5,y+h*.35, x+w*.45,y+h, x+w*.35,y+h*.65);
  c.bezierCurveTo(x+w*.2,y+h*.3, x+w*.1,y+h, x,y+h*.85);
  c.closePath(); c.fill();
}

function sCircle(c,cx,cy,r,col) {
  const g=c.createRadialGradient(cx-r*.3,cy-r*.3,r*.05,cx,cy,r);
  g.addColorStop(0,lighten(col,.38)); g.addColorStop(.65,col); g.addColorStop(1,darken(col,.32));
  c.fillStyle=g; c.beginPath(); c.arc(cx,cy,r,0,Math.PI*2); c.fill(); outline(c,.3);
}

function sCross(c,x,y,w,h,col) {
  c.fillStyle=col;
  c.beginPath(); c.rect(x,y+h*.33,w,h*.34); c.fill();
  c.beginPath(); c.rect(x+w*.33,y,w*.34,h); c.fill();
  outline(c);
}

function sWave(c,x,y,w,h,col) {
  c.save(); c.beginPath(); c.rect(x,y,w,h); c.clip();
  const amp=h*.3, period=w/3.5;
  c.strokeStyle=col; c.lineWidth=Math.max(4,h*.13); c.lineCap='round';
  c.beginPath(); c.moveTo(x,y+h/2);
  for (let px=0;px<=w;px+=2) c.lineTo(x+px, y+h/2+Math.sin(px/period*Math.PI*2)*amp);
  c.stroke();
  c.strokeStyle=lighten(col,.3); c.lineWidth*=.38;
  c.beginPath(); c.moveTo(x,y+h/2);
  for (let px=0;px<=w;px+=2) c.lineTo(x+px, y+h/2+Math.sin(px/period*Math.PI*2)*amp);
  c.stroke();
  c.restore();
}

function sCrown(c, x, y, w, h, col) {
  c.fillStyle = col;
  // Base band
  c.beginPath(); c.rect(x+w*0.08, y+h*0.7, w*0.84, h*0.26); c.fill();
  // 5-point crown shape
  c.beginPath();
  c.moveTo(x+w*0.08, y+h*0.7);
  c.lineTo(x+w*0.08, y+h*0.14);
  c.lineTo(x+w*0.28, y+h*0.52);
  c.lineTo(x+w*0.5,  y+h*0.06);
  c.lineTo(x+w*0.72, y+h*0.52);
  c.lineTo(x+w*0.92, y+h*0.14);
  c.lineTo(x+w*0.92, y+h*0.7);
  c.closePath(); c.fill(); outline(c);
  c.fillStyle = lighten(col, 0.55);
  [[0.25,0.82],[0.5,0.82],[0.75,0.82]].forEach(([gx,gy]) => {
    c.beginPath(); c.arc(x+gx*w, y+gy*h, Math.min(w,h)*0.055, 0, Math.PI*2); c.fill();
  });
}

function sHeart(c, x, y, w, h, col) {
  const cx = x+w/2, cy = y+h/2;
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(cx, cy+h*0.3);
  c.bezierCurveTo(cx-w*0.02,cy+h*0.04, cx-w*0.5,cy-h*0.02, cx-w*0.48,cy-h*0.22);
  c.bezierCurveTo(cx-w*0.48,cy-h*0.48, cx-w*0.08,cy-h*0.46, cx,cy-h*0.18);
  c.bezierCurveTo(cx+w*0.08,cy-h*0.46, cx+w*0.48,cy-h*0.48, cx+w*0.48,cy-h*0.22);
  c.bezierCurveTo(cx+w*0.5,cy-h*0.02, cx+w*0.02,cy+h*0.04, cx,cy+h*0.3);
  c.closePath(); c.fill(); outline(c);
  c.fillStyle = lighten(col, 0.42);
  c.beginPath(); c.ellipse(cx-w*0.16, cy-h*0.1, w*0.09, h*0.11, -0.4, 0, Math.PI*2); c.fill();
}

function sMusic(c, x, y, w, h, col) {
  c.fillStyle = col;
  // Stem
  c.fillRect(x+w*0.52, y+h*0.1, w*0.1, h*0.68);
  // Flag / beam
  c.beginPath();
  c.moveTo(x+w*0.62, y+h*0.1);
  c.bezierCurveTo(x+w*0.95,y+h*0.06, x+w*0.88,y+h*0.42, x+w*0.62,y+h*0.4);
  c.lineTo(x+w*0.62,y+h*0.54);
  c.bezierCurveTo(x+w*0.92,y+h*0.52, x+w*0.95,y+h*0.18, x+w*0.62,y+h*0.22);
  c.closePath(); c.fill();
  // Note head
  c.beginPath(); c.ellipse(x+w*0.38, y+h*0.78, w*0.22, h*0.16, -0.35, 0, Math.PI*2);
  c.fill(); outline(c);
}

function sShield(c, x, y, w, h, col) {
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(x+w*0.5, y+h*0.03);
  c.lineTo(x+w*0.92, y+h*0.15);
  c.lineTo(x+w*0.92, y+h*0.54);
  c.bezierCurveTo(x+w*0.92,y+h*0.8, x+w*0.5,y+h*0.98, x+w*0.5,y+h*0.98);
  c.bezierCurveTo(x+w*0.5,y+h*0.98, x+w*0.08,y+h*0.8, x+w*0.08,y+h*0.54);
  c.lineTo(x+w*0.08, y+h*0.15);
  c.closePath(); c.fill(); outline(c);
  c.fillStyle = lighten(col, 0.22);
  c.beginPath();
  c.moveTo(x+w*0.5,y+h*0.1); c.lineTo(x+w*0.82,y+h*0.2);
  c.lineTo(x+w*0.82,y+h*0.5);
  c.bezierCurveTo(x+w*0.82,y+h*0.7,x+w*0.5,y+h*0.86,x+w*0.5,y+h*0.86);
  c.bezierCurveTo(x+w*0.5,y+h*0.86,x+w*0.18,y+h*0.7,x+w*0.18,y+h*0.5);
  c.lineTo(x+w*0.18,y+h*0.2); c.closePath(); c.fill();
}

function sFlag(c, x, y, w, h, col) {
  c.fillStyle = '#777';
  c.fillRect(x+w*0.05, y+h*0.04, w*0.06, h*0.92);
  const fw = w*0.8, fh = h*0.52, fx = x+w*0.11, fy = y+h*0.04;
  const sz = Math.max(4, fw/6);
  for (let gy2 = 0; gy2*sz < fh; gy2++)
    for (let gx2 = 0; gx2*sz < fw; gx2++) {
      c.fillStyle = (gx2+gy2)%2===0 ? '#ffffff' : '#111';
      c.fillRect(fx+gx2*sz, fy+gy2*sz, sz+1, sz+1);
    }
  c.strokeStyle='#444'; c.lineWidth=1.5; c.strokeRect(fx,fy,fw,fh);
}

function sPaw(c, x, y, w, h, col) {
  c.fillStyle = col;
  [[0.22,0.32],[0.44,0.22],[0.66,0.22],[0.82,0.32]].forEach(([px,py],i) => {
    c.beginPath();
    c.ellipse(x+px*w, y+py*h, w*(i===0||i===3?0.09:0.1), h*0.11, (px<0.5?-0.3:0.3), 0, Math.PI*2);
    c.fill(); outline(c);
  });
  c.beginPath(); c.ellipse(x+w*0.5, y+h*0.65, w*0.27, h*0.27, 0, 0, Math.PI*2);
  c.fill(); outline(c);
  c.fillStyle = darken(col, 0.24);
  [[0.36,0.65],[0.5,0.6],[0.64,0.65]].forEach(([px,py]) => {
    c.beginPath(); c.ellipse(x+px*w,y+py*h,w*0.04,h*0.04,0,0,Math.PI*2); c.fill();
  });
}

function sInfinity(c, x, y, w, h, col) {
  const cx = x+w/2, cy = y+h/2, rx = w*0.26, ry = h*0.28;
  c.strokeStyle = col;
  c.lineWidth = Math.max(4, h*0.18);
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(cx, cy);
  c.bezierCurveTo(cx-rx*0.44,cy-ry*1.5, cx-rx*1.5,cy-ry*1.5, cx-rx,cy);
  c.bezierCurveTo(cx-rx*1.5,cy+ry*1.5, cx-rx*0.44,cy+ry*1.5, cx,cy);
  c.bezierCurveTo(cx+rx*0.44,cy-ry*1.5, cx+rx*1.5,cy-ry*1.5, cx+rx,cy);
  c.bezierCurveTo(cx+rx*1.5,cy+ry*1.5, cx+rx*0.44,cy+ry*1.5, cx,cy);
  c.stroke();
}

function sDragon(c, x, y, w, h, col) {
  c.fillStyle = col;
  // Body
  c.beginPath(); c.ellipse(x+w*0.52,y+h*0.62,w*0.3,h*0.27,0,0,Math.PI*2); c.fill();
  // Head
  c.beginPath(); c.ellipse(x+w*0.28,y+h*0.28,w*0.2,h*0.17,-0.3,0,Math.PI*2); c.fill();
  // Wing
  c.beginPath();
  c.moveTo(x+w*0.5,y+h*0.42);
  c.bezierCurveTo(x+w*0.9,y+h*0.1, x+w,y+h*0.52, x+w*0.76,y+h*0.56);
  c.bezierCurveTo(x+w*0.7,y+h*0.44, x+w*0.63,y+h*0.36, x+w*0.5,y+h*0.42);
  c.fill();
  // Tail
  c.beginPath();
  c.moveTo(x+w*0.65,y+h*0.76);
  c.bezierCurveTo(x+w*0.85,y+h*0.8, x+w*0.9,y+h*0.88, x+w*0.72,y+h*0.93);
  c.bezierCurveTo(x+w*0.62,y+h*0.96, x+w*0.55,y+h*0.86, x+w*0.6,y+h*0.76);
  c.fill();
  // Horns
  c.beginPath(); c.moveTo(x+w*0.22,y+h*0.14); c.lineTo(x+w*0.14,y); c.lineTo(x+w*0.28,y+h*0.1); c.fill();
  c.beginPath(); c.moveTo(x+w*0.33,y+h*0.12); c.lineTo(x+w*0.38,y+h*0.02); c.lineTo(x+w*0.38,y+h*0.14); c.fill();
  outline(c);
  // Eye
  c.fillStyle='#fff'; c.beginPath(); c.arc(x+w*0.23,y+h*0.26,w*0.04,0,Math.PI*2); c.fill();
  c.fillStyle='#111'; c.beginPath(); c.arc(x+w*0.24,y+h*0.26,w*0.02,0,Math.PI*2); c.fill();
}

// ── Text ─────────────────────────────────────────────
function drawText(c, d, x, y) {
  const { text, size, color, font, bold, italic, outline: hasOutline } = d.data;
  c.font = `${italic?'italic ':''}${bold?'bold ':''}${size}px "${font||'Impact'}"`;
  c.textBaseline = 'top'; c.textAlign = 'left';
  if (hasOutline) {
    c.strokeStyle = 'rgba(0,0,0,0.82)';
    c.lineWidth   = Math.max(2, size * 0.07);
    c.lineJoin    = 'round';
    c.strokeText(text, x, y);
  }
  c.fillStyle = color || '#ffffff';
  c.fillText(text, x, y);
}

// ═══════════════════════════════════════════════════════
//  SELECTION HANDLES
// ═══════════════════════════════════════════════════════
function handles(d) {
  const cx = d.x+d.w/2, cy = d.y+d.h/2, rot = d.rotation||0;
  const tp = (lx,ly) => ({
    x: cx + lx*Math.cos(rot) - ly*Math.sin(rot),
    y: cy + lx*Math.sin(rot) + ly*Math.cos(rot),
  });
  return [
    { ...tp(-d.w/2,-d.h/2), pos:'nw', type:'resize' },
    { ...tp( d.w/2,-d.h/2), pos:'ne', type:'resize' },
    { ...tp( d.w/2, d.h/2), pos:'se', type:'resize' },
    { ...tp(-d.w/2, d.h/2), pos:'sw', type:'resize' },
    { ...tp(0, -d.h/2-26),  pos:'rot', type:'rotate' },
  ];
}

function drawHandles(d) {
  ctx.save();
  // dashed box
  ctx.strokeStyle='#6366f1'; ctx.lineWidth=2; ctx.setLineDash([6,4]);
  ctx.save();
  ctx.translate(d.x+d.w/2, d.y+d.h/2); ctx.rotate(d.rotation||0);
  ctx.strokeRect(-d.w/2,-d.h/2,d.w,d.h);
  ctx.restore(); ctx.setLineDash([]);

  handles(d).forEach(h=>{
    ctx.fillStyle   = h.type==='rotate' ? '#f59e0b' : '#ffffff';
    ctx.strokeStyle = h.type==='rotate' ? '#d97706' : '#6366f1';
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(h.x,h.y,h.type==='rotate'?7:6,0,Math.PI*2); ctx.fill(); ctx.stroke();
  });
  ctx.restore();
}

// ═══════════════════════════════════════════════════════
//  MOUSE ↔ CANVAS
// ═══════════════════════════════════════════════════════
function mpos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (canvas.width  / r.width),
    y: (e.clientY - r.top)  * (canvas.height / r.height),
  };
}

function hitHandle(d, mx, my) {
  for (const h of handles(d)) {
    const dx=mx-h.x, dy=my-h.y;
    if (dx*dx+dy*dy<=100) return h;
  }
  return null;
}

function hitDecal(d, mx, my) {
  const cx=d.x+d.w/2, cy=d.y+d.h/2, rot=-(d.rotation||0);
  const dx=mx-cx, dy=my-cy;
  const lx=dx*Math.cos(rot)-dy*Math.sin(rot);
  const ly=dx*Math.sin(rot)+dy*Math.cos(rot);
  return lx>=-d.w/2 && lx<=d.w/2 && ly>=-d.h/2 && ly<=d.h/2;
}

canvas.addEventListener('mousedown', e=>{
  if (e.button!==0) return;
  const {x,y} = mpos(e);

  // handles first
  if (state.selId) {
    const sel = state.decals.find(d=>d.id===state.selId);
    if (sel) {
      const h = hitHandle(sel,x,y);
      if (h) {
        state.drag={on:true, mode:h.type==='rotate'?'rotate':'resize', id:sel.id, handle:h,
                    sx:x,sy:y, ox:sel.x,oy:sel.y, ow:sel.w,oh:sel.h, orot:sel.rotation||0};
        return;
      }
    }
  }
  // decals top→bottom
  for (let i=state.decals.length-1;i>=0;i--) {
    const d=state.decals[i];
    if (hitDecal(d,x,y)) {
      state.selId=d.id;
      state.drag={on:true,mode:'drag',id:d.id,handle:null,
                  sx:x,sy:y,ox:d.x,oy:d.y,ow:d.w,oh:d.h,orot:d.rotation||0};
      render2D(); updateList(); return;
    }
  }
  // empty click
  state.selId=null; state.drag.on=false;
  render2D(); updateList();
});

canvas.addEventListener('mousemove', e=>{
  const {x,y}=mpos(e);

  if (!state.drag.on) {
    // cursor feedback
    if (state.selId) {
      const sel=state.decals.find(d=>d.id===state.selId);
      if (sel) {
        const h=hitHandle(sel,x,y);
        if (h) { canvas.style.cursor=h.type==='rotate'?'crosshair':'nwse-resize'; return; }
        if (hitDecal(sel,x,y)) { canvas.style.cursor='move'; return; }
      }
    }
    canvas.style.cursor=state.decals.some(d=>hitDecal(d,x,y))?'move':'default';
    return;
  }

  const d = state.decals.find(d=>d.id===state.drag.id);
  if (!d) return;
  const {sx,sy,ox,oy,ow,oh,orot} = state.drag;
  const dx=x-sx, dy=y-sy, min=24;

  if (state.drag.mode==='drag') {
    d.x=ox+dx; d.y=oy+dy;

  } else if (state.drag.mode==='rotate') {
    const cx=ox+ow/2, cy=oy+oh/2;
    d.rotation = Math.atan2(y-cy, x-cx)+Math.PI/2;

  } else if (state.drag.mode==='resize') {
    const pos=state.drag.handle.pos;
    if (pos==='se') { d.w=Math.max(min,ow+dx); d.h=Math.max(min,oh+dy); }
    if (pos==='ne') { d.w=Math.max(min,ow+dx); const nh=Math.max(min,oh-dy); d.y=oy+oh-nh; d.h=nh; }
    if (pos==='sw') { const nw=Math.max(min,ow-dx); d.x=ox+ow-nw; d.w=nw; d.h=Math.max(min,oh+dy); }
    if (pos==='nw') { const nw=Math.max(min,ow-dx),nh=Math.max(min,oh-dy); d.x=ox+ow-nw; d.y=oy+oh-nh; d.w=nw; d.h=nh; }
  }
  render2D();
});

canvas.addEventListener('mouseup',   ()=>{ state.drag.on=false; });
canvas.addEventListener('mouseleave',()=>{ state.drag.on=false; });

canvas.addEventListener('dblclick', e=>{
  const {x,y}=mpos(e);
  for (let i=state.decals.length-1;i>=0;i--)
    if (hitDecal(state.decals[i],x,y)) { delDecal(state.decals[i].id); return; }
});

canvas.addEventListener('contextmenu', e=>{
  e.preventDefault();
  const {x,y}=mpos(e);
  for (let i=state.decals.length-1;i>=0;i--)
    if (hitDecal(state.decals[i],x,y)) {
      state.selId=state.decals[i].id;
      showCtx(e.clientX,e.clientY);
      render2D(); updateList(); return;
    }
});

document.addEventListener('keydown', e=>{
  if (!state.selId) return;
  const tag=document.activeElement.tagName;
  if (tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;
  if (e.key==='Delete'||e.key==='Backspace') { e.preventDefault(); delDecal(state.selId); }
  if (e.key==='Escape') { state.selId=null; render2D(); updateList(); }
  const d=state.decals.find(d=>d.id===state.selId);
  if (!d) return;
  const step=e.shiftKey?10:1;
  if (e.key==='ArrowLeft')  { e.preventDefault(); d.x-=step; render2D(); }
  if (e.key==='ArrowRight') { e.preventDefault(); d.x+=step; render2D(); }
  if (e.key==='ArrowUp')    { e.preventDefault(); d.y-=step; render2D(); }
  if (e.key==='ArrowDown')  { e.preventDefault(); d.y+=step; render2D(); }
});

// ═══════════════════════════════════════════════════════
//  CONTEXT MENU
// ═══════════════════════════════════════════════════════
const ctxMenu=document.getElementById('ctx-menu');
function showCtx(x,y){ ctxMenu.style.left=x+'px'; ctxMenu.style.top=y+'px'; ctxMenu.classList.remove('hidden'); }
document.addEventListener('click',()=>ctxMenu.classList.add('hidden'));
document.getElementById('ctx-delete')   .onclick=()=>delDecal(state.selId);
document.getElementById('ctx-duplicate').onclick=()=>dupDecal(state.selId);
document.getElementById('ctx-front')    .onclick=()=>zOrder(state.selId,'front');
document.getElementById('ctx-back-z')   .onclick=()=>zOrder(state.selId,'back');

// ═══════════════════════════════════════════════════════
//  DECAL MANAGEMENT
// ═══════════════════════════════════════════════════════
function addDecal(cfg) {
  // id MUST come last so a spread from dupDecal never overwrites the new id
  const d={
    rotation: cfg.rotation ?? 0,
    opacity:  cfg.opacity  ?? 1,
    type:     cfg.type,
    data:     cfg.data,
    x: cfg.x ?? (canvas.width /2-(cfg.w??120)/2),
    y: cfg.y ?? (canvas.height/2-(cfg.h??120)/2),
    w: cfg.w ?? 120,
    h: cfg.h ?? 120,
    id: state.nextId++,   // always last, never overwritten
  };
  state.decals.push(d);
  state.selId=d.id;
  render2D(); updateList();
  return d;
}

function delDecal(id) {
  state.decals=state.decals.filter(d=>d.id!==id);
  if (state.selId===id) state.selId=null;
  render2D(); updateList();
}

function dupDecal(id) {
  const d=state.decals.find(d=>d.id===id); if(!d) return;
  addDecal({...d, id:undefined, x:d.x+22, y:d.y+22, data:{...d.data}});
}

function zOrder(id,dir) {
  const i=state.decals.findIndex(d=>d.id===id); if(i<0) return;
  const [item]=state.decals.splice(i,1);
  dir==='front'?state.decals.push(item):state.decals.unshift(item);
  render2D(); updateList();
}

function updateList() {
  const list=document.getElementById('decals-list');
  if (!state.decals.length) { list.innerHTML='<p class="empty-hint">Ingen elementer ennå</p>'; return; }
  list.innerHTML='';
  [...state.decals].reverse().forEach(d=>{
    const icon=d.type==='text'?'fa-font':d.type==='image'?'fa-image':'fa-shapes';
    const name=d.type==='text'?`"${d.data.text.slice(0,14)}"`:d.type==='image'?(d.data.name||'Bilde'):d.data.shape;
    const el=document.createElement('div');
    el.className=`decal-item${d.id===state.selId?' active':''}`;
    el.innerHTML=`<i class="fas ${icon}"></i><span>${name}</span>
      <div class="decal-item-actions">
        <button class="icon-btn" data-a="vis" title="${d.opacity>0?'Skjul':'Vis'}">
          <i class="fas fa-eye${d.opacity>0?'':'-slash'}"></i></button>
        <button class="icon-btn" data-a="del" title="Slett"><i class="fas fa-trash"></i></button>
      </div>`;
    el.addEventListener('click', ev=>{
      if (ev.target.closest('.decal-item-actions')) return;
      state.selId=d.id; render2D(); updateList();
    });
    el.querySelector('[data-a="del"]').onclick=ev=>{ev.stopPropagation();delDecal(d.id);};
    el.querySelector('[data-a="vis"]').onclick=ev=>{
      ev.stopPropagation(); d.opacity=d.opacity>0?0:1; render2D(); updateList();
    };
    list.appendChild(el);
  });
}

// ═══════════════════════════════════════════════════════
//  COLOUR UTILITIES
// ═══════════════════════════════════════════════════════
function hx(hex) {
  hex=hex.replace(/^#/,'');
  if(hex.length===3) hex=hex.split('').map(c=>c+c).join('');
  return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16)];
}
function darken(col,f){ try{const[r,g,b]=hx(col);return `rgb(${~~(r*(1-f))},${~~(g*(1-f))},${~~(b*(1-f))})`;}catch{return '#333';} }
function lighten(col,f){ try{const[r,g,b]=hx(col);return `rgb(${Math.min(255,~~(r+255*f))},${Math.min(255,~~(g+255*f))},${Math.min(255,~~(b+255*f))})`;}catch{return '#aaa';} }

// ═══════════════════════════════════════════════════════
//  NOTIFICATION
// ═══════════════════════════════════════════════════════
let notifyT;
function notify(msg) {
  document.querySelectorAll('.notification').forEach(n=>n.remove());
  const el=document.createElement('div'); el.className='notification'; el.textContent=msg;
  document.body.appendChild(el);
  clearTimeout(notifyT); notifyT=setTimeout(()=>el.remove(),2800);
}

// ═══════════════════════════════════════════════════════
//  UI WIRING
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
//  PROCEDURAL AI-STYLE WRAP GENERATOR
//  Parses keywords → renders a style-matched 1024×512 canvas
// ═══════════════════════════════════════════════════════
function aiProceduralWrap(prompt) {
  const W = 1024, H = 512;
  const c = Object.assign(document.createElement('canvas'), { width:W, height:H });
  const g = c.getContext('2d');

  const lo = prompt.toLowerCase();
  const has = (...ws) => ws.some(w => lo.includes(w));

  /* ── colour palette from keywords ─────────────────── */
  let c1 = '#cc0000', c2 = '#111111';
  if (has('blue','blå','navy','cyan','cobalt'))     { c1='#0055dd'; c2='#001133'; }
  if (has('green','grønn','forest','army'))         { c1='#006622'; c2='#001100'; }
  if (has('orange'))                                 { c1='#ff6600'; c2='#331100'; }
  if (has('purple','lilla','violet'))               { c1='#7700cc'; c2='#110022'; }
  if (has('pink','rosa'))                            { c1='#dd0066'; c2='#220011'; }
  if (has('gold','gull','golden'))                  { c1='#cc9900'; c2='#221100'; }
  if (has('silver','chrome','krom'))                { c1='#aaaaaa'; c2='#333333'; }
  if (has('white','hvit'))                           { c1='#cccccc'; c2='#777777'; }
  if (has('red','rød'))                              { c1='#cc0000'; c2='#220000'; }
  if (has('yellow','gul'))                           { c1='#ddcc00'; c2='#222200'; }
  if (has('teal','turkis'))                          { c1='#009999'; c2='#001111'; }

  /* ── style detection ───────────────────────────────── */
  let style = 'abstract';
  if (has('sport','racing','race','speed','motorsport'))           style = 'racing';
  else if (has('flame','fire','flamme','illd'))                    style = 'flames';
  else if (has('military','camo','army','tactical','militær'))     style = 'camo';
  else if (has('luxury','gold','gull','art deco','premium'))       style = 'luxury';
  else if (has('cyber','neon','circuit','digital','futuristic'))   style = 'cyber';
  else if (has('ice','winter','frost','snow','crystal','isblå'))   style = 'ice';
  else if (has('urban','street','graffiti','wild'))                style = 'urban';
  else if (has('hex','hexagon','geo','geometric'))                 style = 'geo';
  else if (has('marble','marmor'))                                 style = 'marble';
  else if (has('ocean','wave','sea','bølge','vann'))               style = 'ocean';
  else if (has('stripe','stripes','stripe'))                       style = 'stripes';
  else if (has('carbon','karbon'))                                 style = 'carbon';
  else if (has('tiger'))                                           style = 'tiger';
  else if (has('holo','holographic','regnbue','rainbow'))          style = 'holo';

  const r = { x:0, y:0, w:W, h:H };

  switch (style) {

    case 'racing': {
      g.fillStyle = c2; g.fillRect(0,0,W,H);
      const gr = g.createLinearGradient(0,0,W,0);
      gr.addColorStop(0, c1); gr.addColorStop(0.55, lighten(c1,0.18)); gr.addColorStop(1, c2);
      g.fillStyle = gr; g.fillRect(0, H*0.28, W, H*0.44);
      patRacing(g, 0, 0, W, H, c1);
      // speed lines
      g.save(); g.globalAlpha = 0.22; g.strokeStyle='#fff'; g.lineWidth=1;
      for (let i=0;i<10;i++) {
        const y=H*(i/10)+H*0.05;
        g.beginPath(); g.moveTo(W*0.05,y); g.lineTo(W, y+H*0.12); g.stroke();
      }
      g.restore();
      break;
    }

    case 'flames': {
      g.fillStyle = c2; g.fillRect(0,0,W,H);
      patFlames(g, 0, 0, W, H);
      g.save(); g.globalAlpha = 0.55;
      patFlames(g, W*0.08, 0, W*0.84, H);
      g.restore();
      break;
    }

    case 'camo': {
      const base = has('desert','sand') ? '#c8a832'
                 : has('blue','blå','navy') ? '#1a3a5a'
                 : '#3a5e2a';
      patCamo(g, 0, 0, W, H, base);
      break;
    }

    case 'luxury': {
      g.fillStyle = '#080608'; g.fillRect(0,0,W,H);
      // Gold banner
      const gl = g.createLinearGradient(0,0,W,H);
      gl.addColorStop(0,'#6b4f10'); gl.addColorStop(0.5,'#f5c518'); gl.addColorStop(1,'#6b4f10');
      g.fillStyle = gl; g.fillRect(0, H*0.38, W, H*0.24);
      // Fine horizontal rules
      g.strokeStyle='#c9a227'; g.lineWidth=0.8;
      for (let i=0;i<16;i++) { g.beginPath(); g.moveTo(0,H*i/16); g.lineTo(W,H*i/16); g.stroke(); }
      // Diamond row
      g.fillStyle='#f5c518';
      for (let i=0;i<7;i++) {
        const dx=W/8*(i+1), dy=H/2, dr=H*0.07;
        g.beginPath();
        g.moveTo(dx,dy-dr); g.lineTo(dx+dr*0.55,dy);
        g.lineTo(dx,dy+dr); g.lineTo(dx-dr*0.55,dy);
        g.closePath(); g.fill();
      }
      // Vertical corner accents
      g.fillStyle='rgba(245,197,24,0.18)';
      g.fillRect(0,0,W*0.06,H); g.fillRect(W*0.94,0,W*0.06,H);
      break;
    }

    case 'cyber': {
      g.fillStyle = '#04040f'; g.fillRect(0,0,W,H);
      const neon = has('pink','rosa') ? '#ff0088'
                 : has('green','grønn') ? '#00ff88'
                 : '#00aaff';
      // Grid
      g.strokeStyle=neon; g.lineWidth=0.6; g.globalAlpha=0.28;
      for (let x=0;x<W;x+=28) { g.beginPath(); g.moveTo(x,0); g.lineTo(x,H); g.stroke(); }
      for (let y=0;y<H;y+=28) { g.beginPath(); g.moveTo(0,y); g.lineTo(W,y); g.stroke(); }
      g.globalAlpha=1;
      // Circuit traces
      g.strokeStyle=neon; g.lineWidth=2;
      g.shadowColor=neon; g.shadowBlur=8;
      for (let row=0;row<5;row++) {
        const sy=H/6*(row+0.5);
        g.beginPath(); g.moveTo(0,sy);
        for (let x=0,step=0;x<W;x+=step) {
          step=32+(x*31+row*13)%52;
          const mode=(x*7+row*11)%3;
          if (mode===0) { g.lineTo(x+step,sy); }
          else if (mode===1) { g.lineTo(x,sy+H*0.07); g.lineTo(x+step,sy+H*0.07); g.lineTo(x+step,sy); }
          else { g.lineTo(x,sy-H*0.07); g.lineTo(x+step,sy-H*0.07); g.lineTo(x+step,sy); }
        }
        g.stroke();
        g.fillStyle=neon;
        for (let x=50;x<W;x+=(x*3%40)+55) { g.beginPath(); g.arc(x,sy,3,0,Math.PI*2); g.fill(); }
      }
      g.shadowBlur=0;
      break;
    }

    case 'ice': {
      const ig = g.createLinearGradient(0,0,W,H);
      ig.addColorStop(0,'#c8eeff'); ig.addColorStop(0.5,'#a0d4f0'); ig.addColorStop(1,'#80b8e0');
      g.fillStyle=ig; g.fillRect(0,0,W,H);
      // Sparkle dots
      g.fillStyle='rgba(255,255,255,0.7)';
      for (let i=0;i<40;i++) { g.beginPath(); g.arc((i*137)%W,(i*59)%H,1.5,0,Math.PI*2); g.fill(); }
      // Ice crystals
      g.strokeStyle='rgba(160,220,255,0.75)'; g.lineWidth=1;
      for (let i=0;i<12;i++) {
        const cx=W*(i+0.5)/12, cy=H/2, cr=H*0.18;
        for (let a=0;a<6;a++) {
          const an=(a/6)*Math.PI*2;
          g.beginPath(); g.moveTo(cx,cy);
          g.lineTo(cx+Math.cos(an)*cr, cy+Math.sin(an)*cr); g.stroke();
          // Branch
          const mx=cx+Math.cos(an)*cr*0.55, my=cy+Math.sin(an)*cr*0.55;
          const ba=an+Math.PI/3;
          g.beginPath(); g.moveTo(mx,my);
          g.lineTo(mx+Math.cos(ba)*cr*0.28, my+Math.sin(ba)*cr*0.28); g.stroke();
        }
      }
      // White shimmer band
      const sg=g.createLinearGradient(0,H*0.4,0,H*0.6);
      sg.addColorStop(0,'rgba(255,255,255,0)');
      sg.addColorStop(0.5,'rgba(255,255,255,0.28)');
      sg.addColorStop(1,'rgba(255,255,255,0)');
      g.fillStyle=sg; g.fillRect(0,0,W,H);
      break;
    }

    case 'urban': {
      g.fillStyle='#111'; g.fillRect(0,0,W,H);
      const uc=['#ff2244','#ff8800','#ffdd00','#00cc44','#0088ff','#cc00ff','#ff0088'];
      for (let i=0;i<6;i++) {
        g.save(); g.globalAlpha=0.72;
        g.fillStyle=uc[(i*3)%uc.length];
        const bx=W*(i/6)+(i%2)*W*0.08, bw=W*0.3, by=H*(i%2?0.08:0.28);
        const sk=H*0.22;
        g.beginPath();
        g.moveTo(bx-sk,by); g.lineTo(bx+bw-sk,by);
        g.lineTo(bx+bw+sk,by+H*0.64); g.lineTo(bx+sk,by+H*0.64);
        g.closePath(); g.fill(); g.restore();
      }
      g.save(); g.globalAlpha=0.18; g.strokeStyle='#fff';
      for (let i=0;i<18;i++) {
        g.lineWidth=1+(i%3);
        const x=W*(i/18);
        g.beginPath(); g.moveTo(x,0); g.lineTo(x+H*0.25,H); g.stroke();
      }
      g.restore();
      break;
    }

    case 'geo': {
      g.fillStyle=c2; g.fillRect(0,0,W,H);
      patHex(g, 0, 0, W, H, c1);
      // Second polygon layer
      g.save(); g.globalAlpha=0.3; g.strokeStyle=lighten(c1,0.4); g.lineWidth=0.8;
      const dw=W/14;
      for (let gx2=0;gx2<W;gx2+=dw*2)
        for (let gy2=0;gy2<H;gy2+=dw) {
          const off=(Math.floor(gy2/dw)%2)*dw;
          g.beginPath();
          g.moveTo(gx2+off,gy2); g.lineTo(gx2+off+dw,gy2+dw*0.5);
          g.lineTo(gx2+off,gy2+dw); g.lineTo(gx2+off-dw,gy2+dw*0.5);
          g.closePath(); g.stroke();
        }
      g.restore();
      break;
    }

    case 'marble': {
      patMarble(g, 0, 0, W, H, c1 || '#8899aa');
      break;
    }

    case 'ocean': {
      const og=g.createLinearGradient(0,0,0,H);
      og.addColorStop(0,'#001144'); og.addColorStop(0.5,'#003888'); og.addColorStop(1,'#006baa');
      g.fillStyle=og; g.fillRect(0,0,W,H);
      for (let wi=0;wi<10;wi++) {
        const wy=H*(wi/10), amp=H*0.035;
        g.strokeStyle=`rgba(80,180,255,${0.15+wi*0.04})`; g.lineWidth=1.5;
        g.beginPath(); g.moveTo(0,wy);
        for (let x=0;x<=W;x+=3) g.lineTo(x, wy+Math.sin((x/W)*Math.PI*5+wi)*amp);
        g.stroke();
      }
      // foam highlights
      g.fillStyle='rgba(200,240,255,0.18)'; g.fillRect(0,0,W,H*0.12);
      break;
    }

    case 'stripes':  { patRacing(g,0,0,W,H,c1); break; }
    case 'carbon':   { patCarbon(g,0,0,W,H,c1); break; }
    case 'tiger':    { patTiger(g,0,0,W,H,c1); break; }
    case 'holo':     { patHolo(g,0,0,W,H,c1); break; }

    default: { // abstract — multi-layer colour blobs
      const abg=g.createLinearGradient(0,0,W,H);
      abg.addColorStop(0,c2); abg.addColorStop(0.5,lighten(c1,0.06)); abg.addColorStop(1,c2);
      g.fillStyle=abg; g.fillRect(0,0,W,H);
      for (let i=0;i<10;i++) {
        g.save(); g.globalAlpha=0.32;
        g.fillStyle=`hsl(${(i*36)%360},75%,52%)`;
        const bx=W*((i*137+50)%100/100), by=H*((i*79+25)%100/100);
        const br=W*0.1+(i%4)*W*0.04;
        g.beginPath(); g.arc(bx,by,br,0,Math.PI*2); g.fill(); g.restore();
      }
      // diagonal shimmer streaks
      g.save(); g.globalAlpha=0.12;
      for (let i=0;i<6;i++) {
        const sx=W*i/5;
        const sg=g.createLinearGradient(sx,0,sx+H*0.4,H);
        sg.addColorStop(0,'transparent'); sg.addColorStop(0.5,'#fff'); sg.addColorStop(1,'transparent');
        g.fillStyle=sg; g.fillRect(sx,0,H*0.4,H);
      }
      g.restore();
      break;
    }
  }

  return c;
}

function setupUI() {
  // ── car thumbnails ───────────────────────────────────
  updateCarThumbs();

  // ── 2D view image upload ─────────────────────────────
  document.getElementById('btn-upload-2d').onclick = () =>
    document.getElementById('input-2d-img').click();

  document.getElementById('input-2d-img').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const idx = state.carIndex;
        state.carImgs[idx] = img;
        buildMasks(img, idx);
        updateCarThumbs();
        render2D();
        notify(`2D-bilde oppdatert for visning ${idx + 1}`);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  };

  // ── quick colours ────────────────────────────────────
  document.querySelectorAll('.qc').forEach(el=>{
    el.onclick=()=>{
      document.getElementById('wrap-color').value=el.dataset.color;
      document.querySelectorAll('.qc').forEach(q=>q.classList.remove('active'));
      el.classList.add('active');
    };
  });

  // ── opacity slider ───────────────────────────────────
  const opS=document.getElementById('wrap-opacity'), opV=document.getElementById('wrap-opacity-val');
  opS.oninput=()=>{ state.wrap.opacity=opS.value/100; opV.textContent=opS.value+'%'; if(state.wrap.active) render2D(); };

  // ── apply colour ─────────────────────────────────────
  document.getElementById('btn-apply-color').onclick=()=>{
    state.wrap.color=document.getElementById('wrap-color').value;
    state.wrap.pattern=null; state.wrap.active=true;
    document.querySelectorAll('.pattern-btn').forEach(b=>b.classList.remove('active'));
    render2D(); notify('Wrap-farge lagt på');
    if(state.viewMode==='3d') scene3d?.applyWrapColor(state.wrap.color);
  };

  // ── clear wrap ───────────────────────────────────────
  document.getElementById('btn-clear-wrap').onclick=()=>{
    state.wrap.active=false; state.wrap.pattern=null; state.wrap.uploadedImg=null;
    document.querySelectorAll('.pattern-btn').forEach(b=>b.classList.remove('active'));
    render2D(); notify('Wrap fjernet');
    if(state.viewMode==='3d') scene3d?.clearWrap();
  };

  // ── gradient controls ────────────────────────────────
  const gradExtra = document.getElementById('gradient-extra');
  document.getElementById('wrap-color2').oninput = e => {
    state.wrap.gradColor2 = e.target.value;
    if (state.wrap.pattern === 'gradient') render2D();
  };
  document.getElementById('grad-dir').onchange = e => {
    state.wrap.gradDir = e.target.value;
    if (state.wrap.pattern === 'gradient') render2D();
  };

  // ── patterns ─────────────────────────────────────────
  document.querySelectorAll('.pattern-btn').forEach(btn=>{
    btn.onclick=()=>{
      state.wrap.color=document.getElementById('wrap-color').value;
      state.wrap.pattern=btn.dataset.pattern; state.wrap.active=true;
      document.querySelectorAll('.pattern-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      // Show gradient extra controls only for gradient pattern
      gradExtra.classList.toggle('hidden', btn.dataset.pattern !== 'gradient');
      render2D(); notify('Mønster: '+btn.dataset.pattern);
      if(state.viewMode==='3d') scene3d?.applyWrapColor(state.wrap.color);
    };
  });

  // ── stickers ─────────────────────────────────────────
  document.querySelectorAll('.sticker-btn').forEach(btn=>{
    btn.onclick=()=>{
      const col=document.getElementById('sticker-color').value;
      addDecal({type:'sticker',w:130,h:130,data:{shape:btn.dataset.sticker,color:col}});
      notify('Sticker lagt til — dra for å flytte, hjørne for resize, gul sirkel for rotering');
    };
  });

  // ── text ─────────────────────────────────────────────
  document.getElementById('btn-add-text').onclick=()=>{
    const text=document.getElementById('text-input').value.trim();
    if (!text) { notify('Skriv inn tekst først'); return; }
    const size=parseInt(document.getElementById('text-size').value)||52;
    const color=document.getElementById('text-color').value;
    const font=document.getElementById('text-font').value;
    const bold=document.getElementById('text-bold').checked;
    const outline=document.getElementById('text-outline').checked;
    const italic=document.getElementById('text-italic').checked;
    const tmp2=document.createElement('canvas').getContext('2d');
    tmp2.font=`${italic?'italic ':''}${bold?'bold ':''}${size}px "${font}"`;
    const m=tmp2.measureText(text);
    addDecal({type:'text',w:Math.ceil(m.width)+18,h:Math.ceil(size*1.38),data:{text,size,color,font,bold,outline,italic}});
    notify('Tekst lagt til');
  };

  // ── upload ───────────────────────────────────────────
  const fi=document.getElementById('file-input'), dz=document.getElementById('drop-zone');
  document.getElementById('btn-upload').onclick=e=>{e.stopPropagation();fi.click();};
  dz.onclick=()=>fi.click();
  fi.onchange=e=>{if(e.target.files[0])doUpload(e.target.files[0]);fi.value='';};
  dz.ondragover=e=>{e.preventDefault();dz.classList.add('drag-over');};
  dz.ondragleave=()=>dz.classList.remove('drag-over');
  dz.ondrop=e=>{e.preventDefault();dz.classList.remove('drag-over');if(e.dataTransfer.files[0])doUpload(e.dataTransfer.files[0]);};

  function doUpload(file) {
    const reader=new FileReader();
    reader.onload=ev=>{
      const img=new Image();
      img.onload=()=>{
        const mode=document.querySelector('input[name="upload-mode"]:checked').value;
        if (mode==='wrap') {
          state.wrap.uploadedImg=img; state.wrap.pattern='image'; state.wrap.active=true;
          document.querySelectorAll('.pattern-btn').forEach(b=>b.classList.remove('active'));
          render2D(); notify('Bilde lagt på som wrap');
        } else {
          const maxW=Math.min(280,canvas.width*.38);
          const sc=maxW/img.naturalWidth;
          addDecal({type:'image',w:img.naturalWidth*sc,h:img.naturalHeight*sc,data:{img,name:file.name}});
          notify('Bilde lagt til som sticker/logo');
        }
      };
      img.src=ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ── view toggle ──────────────────────────────────────
  document.querySelectorAll('.view-btn').forEach(btn=>{
    btn.onclick=()=>{
      const mode=btn.dataset.mode;
      state.viewMode=mode;
      document.querySelectorAll('.view-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
      document.getElementById('viewer-2d').classList.toggle('active',mode==='2d');
      document.getElementById('viewer-3d').classList.toggle('active',mode==='3d');
      if (mode==='2d') { resizeCanvas(); }
      if (mode==='3d') {
        // Wait for DOM reflow before reading clientWidth/Height
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          scene3d?.resize();
          scene3d?.syncWrap(state.wrap, state.decals, canvas.width, canvas.height);
        }));
      }
    };
  });

  // ── camera preset buttons ─────────────────────────────
  document.querySelectorAll('.cam-btn').forEach(btn=>{
    btn.onclick=()=>scene3d?.setCameraPreset(btn.dataset.view);
  });

  // ── reset ─────────────────────────────────────────────
  document.getElementById('btn-reset').onclick=()=>{
    if(!confirm('Nullstille alt?')) return;
    state.decals=[]; state.selId=null;
    state.wrap={active:false,color:'#cc0000',opacity:0.82,pattern:null,uploadedImg:null};
    document.querySelectorAll('.pattern-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById('wrap-color').value='#cc0000';
    document.getElementById('wrap-opacity').value=82;
    document.getElementById('wrap-opacity-val').textContent='82%';
    scene3d?.clearWrap();
    render2D(); updateList(); notify('Tilbakestilt!');
  };

  // ── export ────────────────────────────────────────────
  document.getElementById('btn-export').onclick=()=>{
    const prev=state.selId; state.selId=null; render2D();
    requestAnimationFrame(()=>{
      const a=document.createElement('a');
      if (state.viewMode==='2d') {
        a.download=`wrapstudio-2d-${Date.now()}.png`;
        a.href=canvas.toDataURL('image/png');
      } else {
        scene3d?.render();
        a.download=`wrapstudio-3d-${Date.now()}.png`;
        a.href=document.getElementById('canvas-3d').toDataURL('image/png');
      }
      a.click();
      state.selId=prev; render2D(); notify('Eksportert!');
    });
  };

  // ── AI wrap generator ────────────────────────────────
  let aiImgObj = null;

  document.querySelectorAll('.ai-tag').forEach(btn => {
    btn.onclick = () => {
      document.getElementById('ai-prompt').value = btn.dataset.p;
      document.querySelectorAll('.ai-tag').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
    };
  });

  function runAiGenerate() {
    const rawPrompt = document.getElementById('ai-prompt').value.trim();
    if (!rawPrompt) { notify('Skriv en beskrivelse av ønsket wrap'); return; }

    const statusEl = document.getElementById('ai-status');
    const statusTx = document.getElementById('ai-status-text');
    const resultEl = document.getElementById('ai-result');
    statusEl.classList.remove('hidden');
    resultEl.classList.add('hidden');
    statusTx.textContent = 'Genererer design…';

    function applyResult(dataUrl, label) {
      const img = new Image();
      img.onload = () => {
        aiImgObj = img;
        document.getElementById('ai-img').src = dataUrl;
        statusEl.classList.add('hidden');
        resultEl.classList.remove('hidden');
        notify(label);
      };
      img.src = dataUrl;
    }

    // Go straight to the procedural generator — no external fetch needed
    statusTx.textContent = 'Genererer design…';
    setTimeout(() => {
      const c = aiProceduralWrap(rawPrompt);
      applyResult(c.toDataURL('image/png'), 'Design generert! Klikk "Bruk som wrap".');
    }, 40);
  }

  document.getElementById('btn-ai-generate').onclick = runAiGenerate;
  document.getElementById('btn-ai-retry').onclick    = runAiGenerate;
  document.getElementById('btn-ai-discard').onclick  = () => {
    aiImgObj = null;
    document.getElementById('ai-result').classList.add('hidden');
    document.getElementById('ai-status').classList.add('hidden');
  };
  document.getElementById('btn-ai-apply').onclick = () => {
    if (!aiImgObj) return;
    state.wrap.uploadedImg = aiImgObj;
    state.wrap.pattern     = 'image';
    state.wrap.active      = true;
    document.querySelectorAll('.pattern-btn').forEach(b => b.classList.remove('active'));
    render2D(); notify('AI wrap lagt på!');
  };

  // ── 3D Model: upload & Sketchfab ────────────────────
  document.getElementById('btn-upload-glb').onclick = () =>
    document.getElementById('glb-input').click();

  document.getElementById('glb-input').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    notify(`Laster inn ${f.name}…`);
    scene3d?.loadGLBFromFile(f);
    e.target.value = '';
  };

  document.getElementById('btn-reset-model').onclick = () => {
    scene3d?.resetToDefault();
    notify('Tilbake til standard bil');
  };

  // Restore saved token
  const savedTok = localStorage.getItem('sfToken');
  if (savedTok) document.getElementById('sf-token').value = savedTok;

  async function doSfSearch() {
    const q = document.getElementById('sf-query').value.trim();
    if (!q) return;
    const statusEl  = document.getElementById('sf-status');
    const resultsEl = document.getElementById('sf-results');
    statusEl.textContent = 'Søker Sketchfab…';
    statusEl.classList.remove('hidden');
    resultsEl.classList.add('hidden');
    resultsEl.innerHTML = '';
    try {
      const models = await sfSearch(q);
      statusEl.classList.add('hidden');
      if (!models.length) { statusEl.textContent = 'Ingen resultater'; statusEl.classList.remove('hidden'); return; }
      document.getElementById('sf-token-row').classList.remove('hidden');
      document.getElementById('sf-browse-link').classList.remove('hidden');
      models.forEach(m => {
        const thumb = m.thumbnails?.images?.find(i => i.width >= 100)?.url
                   || m.thumbnails?.images?.[0]?.url || '';
        const card = document.createElement('div');
        card.className = 'sf-card';
        card.innerHTML = `<img src="${thumb}" alt=""><span title="${m.name}">${m.name}</span>`;
        card.onclick = () => doSfLoad(m);
        resultsEl.appendChild(card);
      });
      resultsEl.classList.remove('hidden');
    } catch(err) {
      statusEl.textContent = `Feil: ${err.message}`;
    }
  }

  async function doSfLoad(model) {
    const token = document.getElementById('sf-token').value.trim();
    if (!token) {
      notify('Lim inn Sketchfab API-token for å laste ned');
      document.getElementById('sf-token').focus();
      return;
    }
    localStorage.setItem('sfToken', token);
    notify(`Laster ned "${model.name}"…`);
    try {
      const glbUrl = await sfDownloadUrl(model.uid, token);
      const resp   = await fetch(glbUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob   = await resp.blob();
      scene3d?.loadGLBFromFile(new File([blob], model.name + '.glb', { type:'model/gltf-binary' }));
      notify(`"${model.name}" lagt inn!`);
    } catch(err) {
      notify(`Feil: ${err.message}`);
      console.error('Sketchfab last ned feil:', err);
    }
  }

  document.getElementById('btn-sf-search').onclick = doSfSearch;
  document.getElementById('sf-query').onkeydown = e => { if (e.key === 'Enter') doSfSearch(); };

  // hint auto-hide
  setTimeout(()=>document.getElementById('canvas-hint')?.classList.add('hidden'),7000);
}

// ─────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────
// Convert a rendered white-on-black canvas into an alpha-mask canvas
// (used by the 2D renderer's destination-in compositing)
function renderToAlphaMask(srcCanvas) {
  const out = document.createElement('canvas');
  out.width = srcCanvas.width; out.height = srcCanvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0);
  const d = ctx.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const br = (d.data[i] + d.data[i+1] + d.data[i+2]) / 3;
    d.data[i] = d.data[i+1] = d.data[i+2] = 255;
    d.data[i+3] = br;
  }
  ctx.putImageData(d, 0, 0);
  return out;
}

// Refresh the car-thumb strip from whatever is currently in state.carImgs
function updateCarThumbs() {
  const box = document.getElementById('car-thumbs');
  if (!box) return;
  box.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const img  = state.carImgs[i];
    const el   = document.createElement(img ? 'img' : 'div');
    el.className = `car-thumb${i === state.carIndex ? ' active' : ''}`;
    el.title     = `Visning ${i + 1}`;
    if (img) {
      el.src = img.src || img.currentSrc || '';
      if (!el.src && img instanceof HTMLCanvasElement) el.src = img.toDataURL();
    }
    el.onclick = () => {
      state.carIndex = i;
      document.querySelectorAll('.car-thumb').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
      render2D();
    };
    box.appendChild(el);
  }
}

// ═══════════════════════════════════════════════════════
//  3D SCENE  — Three.js
// ═══════════════════════════════════════════════════════
class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0d18);

    this.camera = new THREE.PerspectiveCamera(42, 16/9, 0.1, 500);
    this.camera.position.set(0, 3.5, -14);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias:true, preserveDrawingBuffer:true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setSize(900, 600, false);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance   = 2;
    this.controls.maxDistance   = 40;
    this.controls.maxPolarAngle = Math.PI * 0.75;
    this.controls.target.set(0, 1.5, 0);
    this.controls.update();

    // ── GLB model state ──────────────────────────────
    this._mode       = 'png';   // 'png' | 'glb'
    this._glbGroup   = null;
    this._bodyMeshes = [];      // meshes that receive the wrap texture
    this._origMats   = [];      // original materials (restored on clear)
    this._wrapTexC   = null;
    this._wrapTexCtx = null;
    this._wrapTex    = null;

    // ── PNG plane state (shown while GLB loads / as fallback) ──
    this._viewCanvases = [];
    this._viewCtxs     = [];
    this._planeMats    = [];
    this._planes       = [];
    this._tmp          = null;
    this._tmpCtx       = null;

    this._loader = new GLTFLoader();

    this._setupLights();
    this._setupFloor();
    this._buildViews();   // PNG planes visible while GLB loads

    // Auto-load the bundled default model
    this.loadGLB('3d/2021_pandem_gr86_v1_aero_kit.glb', 'GR86 Pandem');
  }

  // ─────────────────────────────────────────────────────
  //  GLB LOADING
  // ─────────────────────────────────────────────────────
  loadGLB(url, name, onDone, onFail) {
    document.getElementById('model-loading')?.classList.remove('hidden');
    this._loader.load(url, gltf => {
      this._activateGLB(gltf.scene);
      document.getElementById('model-loading')?.classList.add('hidden');
      const nameEl = document.getElementById('model-name');
      if (nameEl) nameEl.textContent = name;
      this.syncWrap(state.wrap, state.decals, canvas.width, canvas.height);
      if (onDone) onDone();
    }, undefined, err => {
      console.warn('GLB load failed, using PNG fallback:', err);
      document.getElementById('model-loading')?.classList.add('hidden');
      if (onFail) onFail(err);
    });
  }

  loadGLBFromFile(file) {
    const url  = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^.]+$/, '');
    this.loadGLB(url, name, () => URL.revokeObjectURL(url));
  }

  resetToDefault() {
    this.loadGLB('3d/2021_pandem_gr86_v1_aero_kit.glb', 'GR86 Pandem');
  }

  // ─────────────────────────────────────────────────────
  //  ACTIVATE LOADED GLB
  // ─────────────────────────────────────────────────────
  _activateGLB(group) {
    if (this._glbGroup) this.scene.remove(this._glbGroup);
    this._planes.forEach(p => { p.visible = false; });   // hide PNG panels

    // Auto-center + scale to ~8 world units at longest axis
    const box    = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const scale  = 8 / Math.max(size.x, size.y, size.z);
    group.scale.setScalar(scale);
    group.position.set(-center.x * scale,
                       -center.y * scale + (size.y * scale) / 2,
                       -center.z * scale);

    // Identify body-panel meshes (skip glass, lights, tires, chrome…)
    const skipRx = /glass|window|wind|screen|lens|light|lamp|indicator|bulb|rubber|tire|tyre|rim|mirror|chrome|exhaust|interior|seat|carpet/i;
    this._bodyMeshes = [];
    this._origMats   = [];

    group.traverse(child => {
      if (!child.isMesh) return;
      const mat = Array.isArray(child.material) ? child.material[0] : child.material;
      if (!mat) return;
      if (skipRx.test(mat.name + ' ' + child.name)) return;
      if (mat.transparent && mat.opacity < 0.7) return;
      this._bodyMeshes.push(child);
      this._origMats.push(child.material);
    });

    // Fallback: no names matched → use all opaque meshes
    if (!this._bodyMeshes.length) {
      group.traverse(child => {
        if (!child.isMesh) return;
        const mat = Array.isArray(child.material) ? child.material[0] : child.material;
        if (!mat || (mat.transparent && mat.opacity < 0.5)) return;
        this._bodyMeshes.push(child);
        this._origMats.push(child.material);
      });
    }

    this.scene.add(group);
    this._glbGroup = group;
    this._mode     = 'glb';

    this.camera.position.set(0, 4, -13);
    this.controls.target.set(0, 1.5, 0);
    this.controls.update();

    // Capture 4 orthographic views → update the 2D canvas too
    setTimeout(() => this._captureViews(), 120);
  }

  // ─────────────────────────────────────────────────────
  //  WRAP SYNC — dispatches to GLB or PNG path
  // ─────────────────────────────────────────────────────
  syncWrap(wrapState, decals, canW, canH) {
    if (this._mode === 'glb') {
      this._syncWrapGLB(wrapState);
    } else {
      this._syncWrapPNG(wrapState, decals, canW, canH);
    }
  }

  // Apply wrap as a UV-mapped canvas texture on all body meshes
  _syncWrapGLB(wrapState) {
    if (!this._bodyMeshes.length) return;

    if (!wrapState.active) {
      this._bodyMeshes.forEach((m, i) => { m.material = this._origMats[i]; });
      return;
    }

    if (!this._wrapTexC) {
      this._wrapTexC   = Object.assign(document.createElement('canvas'), { width:2048, height:2048 });
      this._wrapTexCtx = this._wrapTexC.getContext('2d');
      this._wrapTex    = new THREE.CanvasTexture(this._wrapTexC);
      this._wrapTex.colorSpace = THREE.SRGBColorSpace;
      this._wrapTex.wrapS = this._wrapTex.wrapT = THREE.RepeatWrapping;
    }

    const c = this._wrapTexCtx, W = 2048, H = 2048;
    c.clearRect(0, 0, W, H);
    c.save();
    c.globalAlpha = wrapState.opacity;
    drawWrapToCtx(c, { x:0, y:0, w:W, h:H });
    c.restore();
    this._wrapTex.needsUpdate = true;

    this._bodyMeshes.forEach(mesh => {
      if (!mesh._wrapMat) {
        mesh._wrapMat = new THREE.MeshPhysicalMaterial({
          map: this._wrapTex,
          roughness: 0.28, metalness: 0.06,
          clearcoat: 0.9,  clearcoatRoughness: 0.08,
        });
      }
      mesh.material = mesh._wrapMat;
    });
  }

  // ─────────────────────────────────────────────────────
  //  LIGHTS  (used in GLB mode; PNG planes use MeshBasicMaterial)
  // ─────────────────────────────────────────────────────
  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const key = new THREE.DirectionalLight(0xfffaf0, 2.0);
    key.position.set(6, 12, -8);
    key.castShadow = true;
    key.shadow.mapSize.setScalar(2048);
    key.shadow.bias = -0.0003;
    Object.assign(key.shadow.camera, { left:-10, right:10, top:10, bottom:-10, near:0.5, far:60 });
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x8899ff, 0.5);
    fill.position.set(-6, 4, 6);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffcc88, 0.4);
    rim.position.set(0, 3, 12);
    this.scene.add(rim);
  }

  // ─────────────────────────────────────────────────────
  //  FLOOR
  // ─────────────────────────────────────────────────────
  _setupFloor() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color:0x0d0d1a, roughness:0.92, metalness:0.08 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(80, 80, 0x1a1a2e, 0x1a1a2e);
    grid.position.y = 0.005;
    this.scene.add(grid);
  }

  // ─────────────────────────────────────────────────────
  //  CAPTURE 4 VIEWS → sync 2D canvas
  // ─────────────────────────────────────────────────────
  _captureViews() {
    if (!this._glbGroup) return;

    const W = 1200, H = 520;
    const off = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const tmpR = new THREE.WebGLRenderer({ canvas: off, antialias: true, preserveDrawingBuffer: true });
    tmpR.setSize(W, H);
    tmpR.toneMapping       = THREE.ACESFilmicToneMapping;
    tmpR.toneMappingExposure = 1.1;
    tmpR.shadowMap.enabled = false;

    const cam = new THREE.PerspectiveCamera(38, W / H, 0.1, 300);
    const tgt = new THREE.Vector3(0, 1.5, 0);

    // Camera distance based on model size
    const box  = new THREE.Box3().setFromObject(this._glbGroup);
    const sz   = box.getSize(new THREE.Vector3());
    const dist = Math.max(sz.x, sz.y, sz.z) * 1.6 + 5;
    const eyeY = sz.y * 0.45;

    const poses = [
      new THREE.Vector3(  0,  eyeY, -dist),  // front
      new THREE.Vector3(dist, eyeY,   0  ),  // right
      new THREE.Vector3(  0,  eyeY,  dist),  // back
      new THREE.Vector3(-dist,eyeY,   0  ),  // left
    ];

    // Non-model scene children to hide during mask renders (keep lights)
    const extras = this.scene.children.filter(
      c => c !== this._glbGroup &&
           !(c instanceof THREE.Light)
    );

    const whiteMat  = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const newImgs   = [];
    const newWMasks = [];
    const newCMasks = [];

    poses.forEach((pos, vi) => {
      cam.position.copy(pos);
      cam.lookAt(tgt);
      cam.updateProjectionMatrix();

      // ① Normal render (scene bg #0d0d18)
      extras.forEach(c => { c.visible = true; });
      tmpR.setClearColor(0x0d0d18, 1);
      tmpR.render(this.scene, cam);

      const imgC = document.createElement('canvas');
      imgC.width = W; imgC.height = H;
      imgC.getContext('2d').drawImage(off, 0, 0);
      const img = new Image();
      img.src = imgC.toDataURL('image/png');
      newImgs[vi] = img;

      // Hide extras for mask renders
      extras.forEach(c => { c.visible = false; });
      tmpR.setClearColor(0x000000, 1);

      // ② White body mask (body meshes = white, rest hidden)
      const allMeshData = [];
      this._glbGroup.traverse(c => {
        if (!c.isMesh) return;
        allMeshData.push({ c, vis: c.visible, mat: c.material });
        c.visible = false;
      });
      const savedBodyMats = this._bodyMeshes.map(m => m.material);
      this._bodyMeshes.forEach(m => { m.visible = true; m.material = whiteMat; });

      tmpR.render(this.scene, cam);
      const wmC = document.createElement('canvas');
      wmC.width = W; wmC.height = H;
      wmC.getContext('2d').drawImage(off, 0, 0);
      newWMasks[vi] = renderToAlphaMask(wmC);

      // ③ Car silhouette (all meshes white)
      allMeshData.forEach(({ c }) => { c.visible = true; c.material = whiteMat; });
      tmpR.render(this.scene, cam);
      const cmC = document.createElement('canvas');
      cmC.width = W; cmC.height = H;
      cmC.getContext('2d').drawImage(off, 0, 0);
      newCMasks[vi] = renderToAlphaMask(cmC);

      // Restore
      this._bodyMeshes.forEach((m, j) => { m.material = savedBodyMats[j]; });
      allMeshData.forEach(({ c, vis, mat }) => { c.visible = vis; c.material = mat; });
      extras.forEach(c => { c.visible = true; });
    });

    tmpR.dispose();

    // Push into state and refresh 2D
    for (let i = 0; i < 4; i++) {
      state.carImgs[i]   = newImgs[i];
      state.whiteMask[i] = newWMasks[i];
      state.carMask[i]   = newCMasks[i];
    }
    state.carIndex = 0;
    updateCarThumbs();
    resizeCanvas();
    render2D();
    notify('2D-visning oppdatert fra 3D-modell');
  }

  // ── Build 4 PNG-based view planes ────────────────────
  _buildViews() {
    const imgs = state.carImgs;
    const first = imgs.find(Boolean);
    if (!first) return;

    const iW0 = first.naturalWidth, iH0 = first.naturalHeight;
    const planeH = 4.8;                               // world-space panel height

    // Spread the panels in a cross so orbiting reveals each view:
    //
    //   bird's-eye:          0=front  at z=-D  (faces camera at z<0)
    //                        1=right  at x=+D  (faces camera at x>0)
    //                        2=back   at z=+D  (faces camera at z>0)
    //                        3=left   at x=-D  (faces camera at x<0)
    //
    // Each panel's front-face normal (ry) is chosen so camera presets
    // see the correct non-mirrored face with FrontSide rendering.
    //
    //  rotation.y=PI    → normal = -Z  (front panel visible from z<0) ✓
    //  rotation.y=PI/2  → normal = +X  (right panel visible from x>0) ✓
    //  rotation.y=0     → normal = +Z  (back  panel visible from z>0) ✓
    //  rotation.y=-PI/2 → normal = -X  (left  panel visible from x<0) ✓

    const D = planeH * (iW0 / iH0) * 0.52;  // half panel-width + small gap

    const configs = [
      { ry:  Math.PI,     px:  0, pz: -D },   // 0 front
      { ry:  Math.PI/2,   px:  D, pz:  0 },   // 1 right
      { ry:  0,           px:  0, pz:  D },   // 2 back
      { ry: -Math.PI/2,   px: -D, pz:  0 },   // 3 left
    ];

    configs.forEach((cfg, i) => {
      const img = imgs[i];
      const W   = img ? img.naturalWidth  : iW0;
      const H   = img ? img.naturalHeight : iH0;

      const cv  = Object.assign(document.createElement('canvas'), { width:W, height:H });
      const cx  = cv.getContext('2d');
      if (img) cx.drawImage(img, 0, 0);           // initial render (no wrap yet)

      this._viewCanvases.push(cv);
      this._viewCtxs.push(cx);

      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;

      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true,
        side: THREE.FrontSide,
        alphaTest: 0.01,
      });
      this._planeMats.push(mat);

      const pW  = planeH * (W / H);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pW, planeH), mat);
      mesh.position.set(cfg.px, planeH / 2, cfg.pz);
      mesh.rotation.y = cfg.ry;
      this.scene.add(mesh);
      this._planes.push(mesh);
    });

  }

  // ── Composite wrap + decals onto every PNG plane ─────
  _syncWrapPNG(wrapState, decals, canW, canH) {
    const imgs = state.carImgs;
    const img0 = imgs.find(Boolean);
    if (!img0 || !this._viewCanvases.length) return;

    // The 2D canvas fit-contains the car image; recover that transform so
    // decal coords (in 2D canvas px) can be mapped to image/texture space.
    const imgW = img0.naturalWidth, imgH = img0.naturalHeight;
    let scale2d = 1, ox2d = 0, oy2d = 0;
    if (canW > 0 && canH > 0) {
      scale2d = Math.min(canW / imgW, canH / imgH);
      ox2d    = (canW - imgW * scale2d) / 2;
      oy2d    = (canH - imgH * scale2d) / 2;
    }

    this._viewCanvases.forEach((cv, i) => {
      const img = imgs[i];
      if (!img) return;

      const W = cv.width, H = cv.height;
      const cx = this._viewCtxs[i];

      // Lazy-init / resize shared scratch canvas
      if (!this._tmp) {
        this._tmp    = document.createElement('canvas');
        this._tmpCtx = this._tmp.getContext('2d');
      }
      if (this._tmp.width !== W || this._tmp.height !== H) {
        this._tmp.width = W; this._tmp.height = H;
      }
      const tc = this._tmpCtx;

      // ① Base car photo (natural resolution, fills texture exactly)
      cx.clearRect(0, 0, W, H);
      cx.drawImage(img, 0, 0, W, H);

      // ② Wrap layer — same white-mask compositing as the 2D render
      if (wrapState.active) {
        tc.clearRect(0, 0, W, H);
        tc.save();
        tc.globalAlpha = wrapState.opacity;
        drawWrapToCtx(tc, { x:0, y:0, w:W, h:H });
        tc.restore();

        const wm = state.whiteMask[i];
        if (wm) {
          tc.globalCompositeOperation = 'destination-in';
          tc.drawImage(wm, 0, 0, W, H);
          tc.globalCompositeOperation = 'source-over';
        }
        cx.drawImage(this._tmp, 0, 0);
      }

      // ③ Decals — inverse the 2D fit-contain transform to get texture coords
      if (decals && scale2d > 0) {
        const cm = state.carMask[i];
        decals.forEach(d => {
          if (d.opacity === 0) return;
          tc.clearRect(0, 0, W, H);

          const tx    = (d.x - ox2d) / scale2d;
          const ty    = (d.y - oy2d) / scale2d;
          const tw    = d.w  / scale2d;
          const th    = d.h  / scale2d;
          const tdata = d.type === 'text'
            ? { ...d.data, size: Math.round(d.data.size / scale2d) }
            : d.data;

          drawDecalToCtx(tc, { ...d, x:tx, y:ty, w:tw, h:th, data:tdata });

          if (cm) {
            tc.globalCompositeOperation = 'destination-in';
            tc.drawImage(cm, 0, 0, W, H);
            tc.globalCompositeOperation = 'source-over';
          }
          cx.globalAlpha = d.opacity ?? 1;
          cx.drawImage(this._tmp, 0, 0);
          cx.globalAlpha = 1;
        });
      }

      this._planeMats[i].map.needsUpdate = true;
    });
  }

  setCameraPreset(preset) {
    const views = {
      front : { pos:[  0, 4.5, -18 ], tgt:[0, 2, 0] },
      back  : { pos:[  0, 4.5,  18 ], tgt:[0, 2, 0] },
      right : { pos:[ 18, 4.5,   0 ], tgt:[0, 2, 0] },
      left  : { pos:[-18, 4.5,   0 ], tgt:[0, 2, 0] },
      top   : { pos:[  0, 22,  0.1 ], tgt:[0, 0, 0] },
    };
    const cfg = views[preset]; if (!cfg) return;
    const sp = this.camera.position.clone(), ep = new THREE.Vector3(...cfg.pos);
    const st = this.controls.target.clone(),  et = new THREE.Vector3(...cfg.tgt);
    const t0 = Date.now(), dur = 700;
    const ease = t => t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    const anim = () => {
      const t = Math.min((Date.now()-t0)/dur, 1);
      this.camera.position.lerpVectors(sp, ep, ease(t));
      this.controls.target.lerpVectors(st, et, ease(t));
      this.controls.update();
      if (t < 1) requestAnimationFrame(anim);
    };
    anim();
  }

  resize() {
    const w = Math.max(100, this.canvas.clientWidth);
    const h = Math.max(100, this.canvas.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// ═══════════════════════════════════════════════════════
//  SKETCHFAB API  (search = no-auth; download = API token)
// ═══════════════════════════════════════════════════════
async function sfSearch(query) {
  const url = `https://api.sketchfab.com/v3/search?type=models&downloadable=true&count=8&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sketchfab ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

async function sfDownloadUrl(uid, token) {
  const res = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, {
    headers: { 'Authorization': `Token ${token}` },
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg.detail || `HTTP ${res.status}`);
  }
  const data = await res.json();
  const u = data.glb?.url || data.source?.url;
  if (!u) throw new Error('Ingen GLB tilgjengelig for denne modellen');
  return u;
}

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
let scene3d=null;

(function init(){
  let done=0;
  CAR_IMAGES.forEach((src,i)=>{
    const img=new Image();
    img.onload=()=>{
      state.carImgs[i]=img;
      buildMasks(img,i);
      if(++done===CAR_IMAGES.length) onReady();
    };
    img.onerror=()=>{ if(++done===CAR_IMAGES.length) onReady(); };
    img.src=src;
  });
})();

function onReady(){
  resizeCanvas();
  setupUI();
  render2D();
  updateList();

  // Init Three.js
  scene3d=new Scene3D(document.getElementById('canvas-3d'));

  // RAF loop — only renders when 3D tab is active
  (function loop(){ requestAnimationFrame(loop); if(state.viewMode==='3d') scene3d.render(); })();

  // Remove loading screen
  setTimeout(()=>document.getElementById('loading-overlay')?.remove(), 600);
  notify('WrapStudio klar!  Velg farge eller mønster → klikk "Legg på"');
}

window.addEventListener('resize',()=>{
  if(state.viewMode==='2d') resizeCanvas();
  else scene3d?.resize();
});

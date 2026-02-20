// ===== Config (edit if needed) =====
const DATA_URL = "https://raw.githubusercontent.com/AnaushkaGoyal/AnaushkaGoyal.github.io/refs/heads/main/data/pa_signals.geojson";
const FIELDS = { tab: "tabE", lap: "lapE", phone: "phoneE" };

const COLORS = {
  tab: "rgba(78, 220, 255, 0.65)",
  lap: "rgba(255, 214, 92, 0.62)",
  phone: "rgba(255, 142, 72, 0.60)"
};


// ring radius range (pixels)
const R_MIN = 1.2;
const R_MAX = 12.0;

// emergence + breathing
const BLANK_MS = 700;         // blank screen
const EMERGE_WINDOW_MS = 1700; // how long waves appear
const PULSE_START_MS = 2600;  // when breathing clearly starts
const TYPE_AT_MS = 5200;      // when typed line begins
const PULSE_AMPLITUDE = 0.028; // 2.8% pulse

const TAGLINE = "Geospatial intelligence that drives real decisions.";

// ===== Canvas setup =====
const canvas = document.getElementById("heroCanvas");
const ctx = canvas.getContext("2d");
let W = 0, H = 0, DPR = 1;

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);

// ===== Helpers =====
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function quantileCuts(values, k = 6) {
  // robust, fast-ish quantiles
  const v = values.filter(Number.isFinite).slice().sort((a,b)=>a-b);
  if (v.length === 0) return Array.from({length:k-1}, ()=>0);
  const cuts = [];
  for (let i = 1; i < k; i++) {
    const p = i / k;
    const idx = Math.floor(p * (v.length - 1));
    cuts.push(v[idx]);
  }
  return cuts;
}

function binIndex(x, cuts) {
  // returns 0..cuts.length
  let i = 0;
  while (i < cuts.length && x > cuts[i]) i++;
  return i;
}

function projectToScreen(points) {
  // points: [{lon,lat,...}]
  // Fit lon/lat bbox to canvas with padding
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.lon);
    maxX = Math.max(maxX, p.lon);
    minY = Math.min(minY, p.lat);
    maxY = Math.max(maxY, p.lat);
  }
  const pad = 0.10;
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;

  const sx = W * (1 - pad*2) / bw;
  const sy = H * (1 - pad*2) / bh;
  const s = Math.min(sx, sy);

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const ox = W * 0.68;  // push map right
  const oy = H * 0.52;  // slightly down for balance

  for (const p of points) {
    p.x = (p.lon - cx) * s + ox;
    p.y = (-(p.lat - cy)) * s + oy;
  }
}

function drawVignette() {
  const g = ctx.createRadialGradient(W*0.38, H*0.42, 40, W*0.5, H*0.5, Math.max(W,H));
  g.addColorStop(0, "rgba(255,255,255,0.04)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0,0,W,H);
}

function drawRing(x, y, r, color, glowBoost=1) {
  // glow pass
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.0;
  ctx.shadowColor = color;
  ctx.shadowBlur = 3 * glowBoost;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.stroke();
  ctx.restore();

  // crisp pass
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.stroke();
  ctx.restore();
}

// ===== Typed line =====
const typedEl = document.getElementById("typed");
let typedStarted = false;

function startTyping() {
  if (typedStarted) return;
  typedStarted = true;
  typedEl.textContent = "";
  let i = 0;
  const speed = 10; // ms per char
  const tick = () => {
    typedEl.textContent = TAGLINE.slice(0, i);
    i++;
    if (i <= TAGLINE.length) setTimeout(tick, speed);
  };
  tick();
}

// Smooth scroll
document.getElementById("scrollBtn")?.addEventListener("click", () => {
  document.getElementById("intro")?.scrollIntoView({ behavior: "smooth" });
});

// ===== Data + animation =====
let points = []; // {x,y, rTab,rLap,rPhone, delay, phase, glow}
let startTime = performance.now();

async function loadData() {
  const res = await fetch(DATA_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to fetch ${DATA_URL}: ${res.status}`);
  const geo = await res.json();

  const feats = geo.type === "FeatureCollection" ? geo.features : (geo.features || []);
  const raw = [];

  for (const f of feats) {
    if (!f.geometry || f.geometry.type !== "Point") continue;
    const coords = f.geometry.coordinates;
    if (!coords || coords.length < 2) continue;
    const props = f.properties || {};
    const tab = Number(props[FIELDS.tab]);
    const lap = Number(props[FIELDS.lap]);
    const phone = Number(props[FIELDS.phone]);

    raw.push({
      lon: Number(coords[0]),
      lat: Number(coords[1]),
      tab, lap, phone
    });
  }

  // Compute quantile cuts (fast + always looks good)
  const cutsTab = quantileCuts(raw.map(d=>d.tab), 6);
  const cutsLap = quantileCuts(raw.map(d=>d.lap), 6);
  const cutsPhone = quantileCuts(raw.map(d=>d.phone), 6);

  // Precompute screen projection + radii bins
  projectToScreen(raw);

  points = raw.map((d) => {
    const bTab = binIndex(d.tab, cutsTab);       // 0..5
    const bLap = binIndex(d.lap, cutsLap);
    const bPhone = binIndex(d.phone, cutsPhone);

    const k = 5; // bins-1
    const rTab = lerp(R_MIN, R_MAX, bTab / k);
    const rLap = lerp(R_MIN, R_MAX, bLap / k);
    const rPhone = lerp(R_MIN, R_MAX, bPhone / k);

    // random emergence wave
    const delay = BLANK_MS + Math.random() * EMERGE_WINDOW_MS;
    const phase = Math.random() * Math.PI * 2;

    // slight glow variance
    const glow = 0.8 + Math.random() * 0.6;

    return { x: d.x, y: d.y, rTab, rLap, rPhone, delay, phase, glow };
  });

  // sort by delay so emergence feels wave-like (optional)
  points.sort((a,b)=>a.delay-b.delay);
}

function frame(now) {
  const ms = now - startTime;

  // background
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = "#000";
  ctx.fillRect(0,0,W,H);
  

  // start typing at time
  if (ms >= TYPE_AT_MS) startTyping();

  // pulse factor
  const pulseT = (ms - PULSE_START_MS) * 0.0022;
  const pulse = 1 + Math.sin(pulseT) * PULSE_AMPLITUDE;

  // draw points
  // per-point looping envelope: fade in -> hold -> fade out -> repeat
  const localT = (ms - p.delay);
  if (localT < 0) continue;

  const cyc = localT % CYCLE_MS;

 // fade in
 let env = 1;
 if (cyc < FADE_IN_MS) {
  const u = clamp(cyc / FADE_IN_MS, 0, 1);
  env = u*u*(3 - 2*u); // smoothstep in
 } else if (cyc > (CYCLE_MS - FADE_OUT_MS)) {
  const u = clamp((CYCLE_MS - cyc) / FADE_OUT_MS, 0, 1);
  env = u*u*(3 - 2*u); // smoothstep out
 } else {
  env = 1; // hold
 }

    // breathing starts after PULSE_START_MS; before that, keep near 1
    const localPulse = ms >= PULSE_START_MS
      ? (1 + Math.sin(pulseT + p.phase) * PULSE_AMPLITUDE)
      : 1;

    const s = env * localPulse;

    // keep order consistent (you said you don't care)
    drawRing(p.x, p.y, p.rTab * s, COLORS.tab, p.glow);
    drawRing(p.x, p.y, p.rLap * s, COLORS.lap, p.glow);
    drawRing(p.x, p.y, p.rPhone * s, COLORS.phone, p.glow);
  }

  requestAnimationFrame(frame);
}

async function init() {
  resize();
  await loadData();
  requestAnimationFrame(frame);
}

init().catch((err) => {
  console.error(err);
});
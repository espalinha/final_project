/* =====================================================================
   Rota Acessível AR – Demo
   Lucas (cadeirante) vai da Sala 2 (térreo) até a Sala 23 (2º andar)
   usando somente elevador/rampas. Setas em AR no chão + minimapa WIM.

   - WebXR "immersive-ar" (Chrome Android + ARCore): setas presas ao chão.
   - Sem WebXR: "modo compatível" (vídeo da câmera + giroscópio, 3DoF).
   - Cada QR code = um ponto de referência no prédio (posição + direção).
   ===================================================================== */
import * as THREE from 'three';

/* ----------------------------- CONFIG ------------------------------ */
const params = new URLSearchParams(location.search);
const CONFIG = {
  EYE_HEIGHT: 1.40,       // altura do celular ao iniciar o AR (m) → chão em y = -1.40
  ARROW_LIFT: 0.03,       // setas "ligeiramente acima" do chão (m)
  ARROW_SPACING: 0.6,     // distância entre setas (m)
  CORNER_RADIUS: 1.6,     // raio das curvas (m)
  // URL da nossa API. Vazio = modo simulado (rota local).
  // Também dá para passar na URL: ?api=https://minha-api.com/v1
  API_BASE_URL: params.get('api') || '',
  API_TIMEOUT_MS: 3000,
  USER: { id: 'lucas', name: 'Lucas', profile: 'wheelchair' },
  JSQR_URL: 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
};

/* --------------------------- PRÉDIO (mock) ------------------------- */
// Coordenadas do prédio em metros. Plano X/Z, -Z = "norte".
// heading (graus): 0 = olhando para -Z, 90 = olhando para -X (vira à esquerda = positivo).
const BUILDING = {
  footprint: { minX: -2.5, maxX: 7.5, minZ: -12.5, maxZ: 1.5 },
  floors: { 0: 'Térreo', 2: '2º andar' },
  rooms: [
    { label: 'Sala 2', floor: 0, x: 0, z: 0.6 },
    { label: 'Sala 23', floor: 2, x: 0, z: -11.6 },
  ],
  elevator: { x: 5.9, z: -6 },
  stairs: { x: -1.6, z: -8 },   // existe, mas é EVITADA
};

const DESTINATIONS = [
  { id: 'sala-23', label: 'Sala 23', num: '23', floor: 2, floorLabel: '2º andar', desc: 'Laboratório de Inovação' },
];

function mockRoute(origin, destination) {
  return {
    routeId: 'mock-' + Date.now().toString(36),
    origin, destination,
    profile: 'wheelchair',
    accessible: true,
    avoid: ['stairs', 'steps', 'escalator'],
    checkpoints: [
      {
        id: 1, place: 'Sala 2 · Térreo', floor: 0, pos: [0, 0], headingDeg: 0,
        icon: '⬆️', title: 'Siga em frente pelo corredor',
        sub: 'A curva fica a 4 m. Leia o QR 2 lá.',
        near: 'Chegou na curva. Leia o QR 2.',
        path: [[0, 0], [0, -4]],
        end: { type: 'qr', label: 'QR 2 · curva' },
      },
      {
        id: 2, place: 'Corredor – curva (térreo)', floor: 0, pos: [0, -4], headingDeg: 0,
        icon: '↪️', title: 'Vire à direita até o elevador',
        sub: 'Pegue o elevador para o 2º andar. Ao sair, leia o QR 3.',
        near: 'Entre no elevador e aperte 2. Ao sair, leia o QR 3.',
        path: [[0, -4], [0, -6], [5, -6]],
        end: { type: 'elevator', label: '🛗 ELEVADOR → 2º' },
      },
      {
        id: 3, place: 'Saída do elevador · 2º andar', floor: 2, pos: [5, -6], headingDeg: 90,
        icon: '⬆️', title: 'Saia do elevador e siga em frente',
        sub: 'A curva fica a 3 m. Leia o QR 4 lá.',
        near: 'Chegou na curva. Leia o QR 4.',
        path: [[5, -6], [2, -6]],
        end: { type: 'qr', label: 'QR 4 · curva' },
      },
      {
        id: 4, place: 'Corredor – curva (2º andar)', floor: 2, pos: [2, -6], headingDeg: 90,
        icon: '↪️', title: 'Vire à direita até a Sala 23',
        sub: 'A sala fica no fim do corredor. Leia o QR 5 na porta.',
        near: 'Você chegou! Leia o QR 5 na porta.',
        path: [[2, -6], [0, -6], [0, -11]],
        end: { type: 'destination', label: '✅ SALA 23' },
      },
      { id: 5, place: 'Sala 23 · 2º andar', floor: 2, pos: [0, -11], headingDeg: 0, arrived: true },
    ],
  };
}

/* ------------------------------- API -------------------------------- */
const API = {
  base: CONFIG.API_BASE_URL.replace(/\/$/, ''),
  status: 'mock',            // mock | online | offline
  sessionId: (crypto.randomUUID && crypto.randomUUID()) || 'sess-' + Math.random().toString(36).slice(2),

  async post(path, body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CONFIG.API_TIMEOUT_MS);
    try {
      const r = await fetch(this.base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, userId: CONFIG.USER.id, timestamp: new Date().toISOString(), ...body }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const txt = await r.text();
      return txt ? JSON.parse(txt) : {};
    } finally {
      clearTimeout(t);
    }
  },

  setStatus(s) {
    this.status = s;
    const el = $('#apiBadge');
    el.className = 'badge ' + s;
    el.textContent = { mock: 'API: simulada', online: 'API: online', offline: 'API: offline · rota local' }[s];
  },

  async fire(path, body) {
    if (!this.base) { console.info('[API simulada]', path, body); return null; }
    try { const r = await this.post(path, body); this.setStatus('online'); return r; }
    catch (e) { console.warn('[API]', path, e.message); this.setStatus('offline'); return null; }
  },

  // Pede a rota acessível. Se a API não responder, usa a rota local.
  async requestRoute(origin, destination) {
    const body = { origin, destination, profile: CONFIG.USER.profile, constraints: { avoid: ['stairs', 'steps'], prefer: ['elevator', 'ramp'] } };
    const r = await this.fire('/navigation/route', body);
    if (r && Array.isArray(r.checkpoints) && r.checkpoints.length) return r;
    return mockRoute(origin, destination);
  },
  sendCheckpoint(cp, raw) {
    return this.fire('/navigation/checkpoint', { checkpointId: cp.id, qr: raw, place: cp.place, floor: cp.floor });
  },
  sendPosition(p) {
    if (this.status === 'online') this.fire('/navigation/position', p);
  },
  sendArrival(stats) {
    return this.fire('/navigation/arrival', { destination: state.destination?.id, ...stats });
  },
};

/* ------------------------------ ESTADO ------------------------------ */
const state = {
  destination: null,
  route: null,
  cpId: 0,
  mode: null,            // 'xr' | 'fallback'
  xrSupported: false,
  session: null,
  endingForScan: null,
  done: false,
};
const currentCp = () => state.route?.checkpoints.find(c => c.id === state.cpId) || null;

/* ------------------------------ HELPERS ----------------------------- */
const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}
function showHud(on) { $('#hud').classList.toggle('hidden', !on); }

let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

function normalizeRoute(route) {
  route.checkpoints.forEach(cp => {
    cp.heading = THREE.MathUtils.degToRad(cp.headingDeg ?? 0);
    if (cp.path) cp.poly = smoothPath(cp.path, CONFIG.CORNER_RADIUS);
  });
  return route;
}

/* ---------------------------- GEOMETRIA ----------------------------- */
// Arredonda os cantos de uma polilinha (curvas suaves).
function smoothPath(pts, r) {
  const P = pts.map(([x, z]) => new THREE.Vector2(x, z));
  if (P.length < 3) return P;
  const out = [P[0].clone()];
  for (let i = 1; i < P.length - 1; i++) {
    const A = P[i - 1], B = P[i], C = P[i + 1];
    const u = B.clone().sub(A), lu = u.length(); u.normalize();
    const v = C.clone().sub(B), lv = v.length(); v.normalize();
    const rr = Math.min(r, i === 1 ? lu : lu / 2, i === P.length - 2 ? lv : lv / 2);
    const t1 = B.clone().addScaledVector(u, -rr);
    const t2 = B.clone().addScaledVector(v, rr);
    if (t1.distanceTo(out[out.length - 1]) > 1e-4) out.push(t1);
    for (let k = 1; k <= 14; k++) {
      const t = k / 14, a = (1 - t) ** 2, b = 2 * (1 - t) * t, c = t * t;
      out.push(new THREE.Vector2(a * t1.x + b * B.x + c * t2.x, a * t1.y + b * B.y + c * t2.y));
    }
  }
  const last = P[P.length - 1];
  if (last.distanceTo(out[out.length - 1]) > 1e-4) out.push(last.clone());
  return out;
}

function polyLength(poly) {
  let L = 0;
  for (let i = 1; i < poly.length; i++) L += poly[i].distanceTo(poly[i - 1]);
  return L;
}

// Amostra pontos igualmente espaçados ao longo do caminho (para as setas).
function resample(poly, step) {
  const res = [];
  let carry = step * 0.6;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], seg = poly[i + 1].clone().sub(a), len = seg.length();
    if (len < 1e-6) continue;
    const dir = seg.divideScalar(len);
    let d = carry;
    while (d <= len) { res.push({ p: a.clone().addScaledVector(dir, d), dir: dir.clone() }); d += step; }
    carry = d - len;
  }
  return res;
}

/* ------------------------------ THREE ------------------------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.xr.enabled = true;
renderer.domElement.id = 'gl';
document.body.insertBefore(renderer.domElement, $('#overlay'));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.01, 60);

// Estrutura: routeOuter (gira para o referencial do QR) > routeInner (coordenadas do prédio)
const routeOuter = new THREE.Group();
const routeInner = new THREE.Group();
routeOuter.add(routeInner);
scene.add(routeOuter);

let chevrons = [];
let pulses = [];

// Seta em "V" deitada no chão, apontando para -Z.
const CHEVRON_GEO = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0.20);
  s.lineTo(0.30, -0.10);
  s.lineTo(0.30, -0.25);
  s.lineTo(0, 0.05);
  s.lineTo(-0.30, -0.25);
  s.lineTo(-0.30, -0.10);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
})();

function makeLabel(text, bg = 'rgba(11,18,32,0.9)', border = '#38bdf8') {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.strokeStyle = border; g.lineWidth = 8;
  g.beginPath();
  if (g.roundRect) g.roundRect(6, 6, 628, 148, 40); else g.rect(6, 6, 628, 148);
  g.fill(); g.stroke();
  g.fillStyle = '#fff';
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 320, 84);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(1.6, 0.4, 1);
  sp.renderOrder = 10;
  return sp;
}

function makeRibbon(poly, width, color, opacity) {
  const pos = [], idx = [];
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[Math.max(0, i - 1)], next = poly[Math.min(poly.length - 1, i + 1)];
    const d = next.clone().sub(prev).normalize();
    const n = new THREE.Vector2(-d.y, d.x).multiplyScalar(width / 2);
    pos.push(poly[i].x + n.x, 0.01, poly[i].y + n.y, poly[i].x - n.x, 0.01, poly[i].y - n.y);
    if (i < poly.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
}

function makeRing(x, z, color) {
  const g = new THREE.RingGeometry(0.32, 0.45, 40);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set(x, CONFIG.ARROW_LIFT + 0.005, z);
  pulses.push(m);
  return m;
}

function clearGroup(g) {
  while (g.children.length) {
    const o = g.children.pop();
    o.traverse(n => {
      if (n.geometry && n.geometry !== CHEVRON_GEO) n.geometry.dispose();
      if (n.material) { n.material.map?.dispose(); n.material.dispose(); }
    });
  }
}

// Monta as setas do trecho atual (do QR atual até o próximo ponto).
function buildSegment(cp) {
  clearGroup(routeInner);
  chevrons = []; pulses = [];
  if (!cp || !cp.poly) return;

  // Referencial: o celular, no início do AR, está em cp.pos, olhando para cp.heading, a 1,40 m do chão.
  routeOuter.rotation.set(0, -cp.heading, 0);
  routeOuter.position.set(0, -CONFIG.EYE_HEIGHT, 0);
  routeInner.position.set(-cp.pos[0], 0, -cp.pos[1]);

  const poly = cp.poly;
  routeInner.add(makeRibbon(poly, 0.7, 0x0ea5e9, 0.18));

  for (const { p, dir } of resample(poly, CONFIG.ARROW_SPACING)) {
    const m = new THREE.Mesh(CHEVRON_GEO, new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(p.x, CONFIG.ARROW_LIFT, p.y);
    m.rotation.y = Math.atan2(-dir.x, -dir.y);
    routeInner.add(m);
    chevrons.push(m);
  }

  const end = poly[poly.length - 1];
  const e = cp.end || {};
  if (e.type === 'elevator') {
    const { x, z } = BUILDING.elevator;
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.3, 2.1, 1.3)),
      new THREE.LineBasicMaterial({ color: 0xf59e0b }));
    box.position.set(x, 1.05, z);
    routeInner.add(box);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.0),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    door.rotation.y = Math.PI / 2;
    door.position.set(x - 0.66, 1.0, z);
    routeInner.add(door);
    routeInner.add(makeRing(end.x, end.y, 0xf59e0b));
    const lb = makeLabel(e.label, 'rgba(11,18,32,0.9)', '#f59e0b');
    lb.position.set(x, 2.45, z);
    routeInner.add(lb);
  } else if (e.type === 'destination') {
    routeInner.add(makeRing(end.x, end.y, 0x22c55e));
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.4, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    beacon.position.set(end.x, 1.2, end.y);
    routeInner.add(beacon);
    const lb = makeLabel(e.label, 'rgba(11,18,32,0.9)', '#22c55e');
    lb.position.set(end.x, 1.9, end.y);
    routeInner.add(lb);
  } else {
    routeInner.add(makeRing(end.x, end.y, 0x38bdf8));
    const lb = makeLabel(e.label || 'Próximo QR');
    lb.position.set(end.x, 1.3, end.y);
    routeInner.add(lb);
  }
}

function animateRoute(t) {
  const n = chevrons.length;
  for (let i = 0; i < n; i++) {
    // onda que "corre" no sentido do caminho
    const w = 0.5 + 0.5 * Math.sin(t * 5 - i * 0.7);
    chevrons[i].material.opacity = 0.3 + 0.7 * w * w;
  }
  const s = 1 + 0.2 * Math.sin(t * 3);
  pulses.forEach(p => p.scale.set(s, 1, s));
}

/* ------------------------ RASTREAMENTO / POSE ----------------------- */
const tracking = { x: 0, z: 0, y: 0, yaw: 0, floor: 0, valid: false };
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
let lastMini = 0, lastTelemetry = 0;

function yawFromQuat(q) {
  _v.set(0, 0, -1).applyQuaternion(q);
  // celular apontado para o chão: usa o "topo" do aparelho como frente
  if (Math.abs(_v.y) > 0.85) _v.set(0, 1, 0).applyQuaternion(q);
  return Math.atan2(-_v.x, -_v.z);
}

function updateTracking(lp, lq, now) {
  const cp = currentCp();
  if (!cp) return;
  _q.set(lq.x, lq.y, lq.z, lq.w);
  const localYaw = yawFromQuat(_q);
  const h = cp.heading, c = Math.cos(h), s = Math.sin(h);
  // local (AR) → prédio
  tracking.x = cp.pos[0] + lp.x * c + lp.z * s;
  tracking.z = cp.pos[1] - lp.x * s + lp.z * c;
  tracking.y = lp.y;
  tracking.yaw = h + localYaw;
  tracking.floor = cp.floor;
  tracking.valid = true;

  if (now - lastMini > 50) { lastMini = now; drawMinimap(); updateHudText(); }
  if (now - lastTelemetry > 1000) {
    lastTelemetry = now;
    API.sendPosition({
      floor: cp.floor, checkpointId: cp.id,
      positionMm: { x: Math.round(tracking.x * 1000), y: Math.round((tracking.y + CONFIG.EYE_HEIGHT) * 1000), z: Math.round(tracking.z * 1000) },
      headingDeg: +THREE.MathUtils.radToDeg(tracking.yaw).toFixed(1),
    });
  }
}

function updateHudText() {
  const cp = currentCp();
  if (!cp || !cp.poly) return;
  const end = cp.poly[cp.poly.length - 1];
  const dist = Math.hypot(end.x - tracking.x, end.y - tracking.z);
  const near = dist < 1.0 && cp.near;
  $('#hudSub').textContent = near ? cp.near : cp.sub;
  $('#minimapInfo').innerHTML =
    `<b>${BUILDING.floors[cp.floor]}</b> · faltam ${dist.toFixed(1).replace('.', ',')} m<br>` +
    `x ${tracking.x.toFixed(3)} · z ${tracking.z.toFixed(3)} m (±1 mm)`;
}

/* ----------------------------- MINIMAPA ----------------------------- */
// "World in miniature": dois andares empilhados, gira junto com o usuário (frente = cima).
const mini = { canvas: $('#minimap'), ctx: null, W: 170, H: 230 };
(function setupMinimap() {
  const dpr = Math.min(devicePixelRatio || 1, 3);
  mini.canvas.width = mini.W * dpr;
  mini.canvas.height = mini.H * dpr;
  mini.ctx = mini.canvas.getContext('2d');
  mini.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
})();

function drawMinimap() {
  const g = mini.ctx, W = mini.W, H = mini.H;
  g.clearRect(0, 0, W, H);
  const route = state.route;
  if (!route) return;

  const yaw = tracking.valid ? tracking.yaw : (currentCp()?.heading || 0);
  const c = Math.cos(-yaw), s = Math.sin(-yaw);
  const fp = BUILDING.footprint;
  const cx0 = (fp.minX + fp.maxX) / 2, cz0 = (fp.minZ + fp.maxZ) / 2;
  const S = 8.5, TILT = 0.5;
  const levelY = { 0: H * 0.72, 2: H * 0.72 - 82 };
  const P = (x, z, f) => {
    const dx = x - cx0, dz = z - cz0;
    const rx = dx * c + dz * s, rz = -dx * s + dz * c;
    return [W / 2 + rx * S, levelY[f] + rz * S * TILT];
  };
  const userFloor = currentCp()?.floor ?? 0;

  const drawFloor = f => {
    const corners = [[fp.minX, fp.minZ], [fp.maxX, fp.minZ], [fp.maxX, fp.maxZ], [fp.minX, fp.maxZ]].map(([x, z]) => P(x, z, f));
    g.beginPath();
    corners.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = f === userFloor ? 'rgba(56,189,248,0.16)' : 'rgba(148,163,184,0.10)';
    g.strokeStyle = f === userFloor ? 'rgba(56,189,248,0.9)' : 'rgba(148,163,184,0.45)';
    g.lineWidth = 1.2;
    g.fill(); g.stroke();

    // escada (evitada)
    const [sx, sy] = P(BUILDING.stairs.x, BUILDING.stairs.z, f);
    g.strokeStyle = '#ef4444'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(sx - 4, sy - 4); g.lineTo(sx + 4, sy + 4); g.moveTo(sx + 4, sy - 4); g.lineTo(sx - 4, sy + 4); g.stroke();

    // rota por trecho
    route.checkpoints.forEach(cp => {
      if (!cp.poly || cp.floor !== f) return;
      g.beginPath();
      cp.poly.forEach((p, i) => { const [x, y] = P(p.x, p.y, f); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      if (cp.id < state.cpId) { g.setLineDash([]); g.strokeStyle = 'rgba(34,197,94,0.85)'; g.lineWidth = 3; }
      else if (cp.id === state.cpId) { g.setLineDash([]); g.strokeStyle = '#38bdf8'; g.lineWidth = 4; }
      else { g.setLineDash([3, 3]); g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 2; }
      g.stroke();
      g.setLineDash([]);
      // ponto do QR
      const [qx, qy] = P(cp.pos[0], cp.pos[1], f);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(qx, qy, 2.2, 0, Math.PI * 2); g.fill();
    });

    // elevador
    const [ex, ey] = P(BUILDING.elevator.x, BUILDING.elevator.z, f);
    g.fillStyle = '#f59e0b'; g.fillRect(ex - 4, ey - 4, 8, 8);

    // salas
    BUILDING.rooms.filter(r => r.floor === f).forEach(r => {
      const [rx, ry] = P(r.x, r.z, f);
      g.fillStyle = r.label === 'Sala 23' ? '#22c55e' : '#e2e8f0';
      g.beginPath(); g.arc(rx, ry, 3.5, 0, Math.PI * 2); g.fill();
      g.font = 'bold 10px system-ui'; g.textAlign = 'center';
      g.fillText(r.label, rx, ry - 6);
    });

    // nome do andar
    g.font = 'bold 10px system-ui'; g.textAlign = 'left';
    g.fillStyle = f === userFloor ? '#38bdf8' : '#94a3b8';
    g.fillText(BUILDING.floors[f], 6, levelY[f] - 36);
  };

  drawFloor(0);
  // poço do elevador ligando os andares
  const [a1, b1] = P(BUILDING.elevator.x, BUILDING.elevator.z, 0);
  const [a2, b2] = P(BUILDING.elevator.x, BUILDING.elevator.z, 2);
  g.setLineDash([4, 3]); g.strokeStyle = 'rgba(245,158,11,0.9)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(a1, b1); g.lineTo(a2, b2); g.stroke(); g.setLineDash([]);
  drawFloor(2);

  // usuário (triângulo sempre para cima = para onde ele está virado)
  const cp = currentCp();
  if (cp) {
    const ux = tracking.valid ? tracking.x : cp.pos[0];
    const uz = tracking.valid ? tracking.z : cp.pos[1];
    const [px, py] = P(ux, uz, cp.floor);
    g.fillStyle = 'rgba(56,189,248,0.25)';
    g.beginPath(); g.arc(px, py, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.strokeStyle = '#0284c7'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(px, py - 8); g.lineTo(px + 6, py + 6); g.lineTo(px, py + 3); g.lineTo(px - 6, py + 6); g.closePath();
    g.fill(); g.stroke();
  }

  // legenda
  g.font = '9px system-ui'; g.textAlign = 'left';
  g.fillStyle = '#f59e0b'; g.fillText('■ elevador', 6, H - 6);
  g.fillStyle = '#ef4444'; g.fillText('✕ escada evitada', 70, H - 6);
}

/* ------------------------- MODO COMPATÍVEL --------------------------- */
// Sem WebXR: vídeo da câmera + giroscópio (só rotação). Setas continuam "presas" ao chão ao girar.
const orient = { has: false, alpha: 0, beta: 0, gamma: 0, needsReset: true };
const yawOffset = new THREE.Quaternion();
const drag = { yaw: 0, pitch: -0.35, active: false, x: 0, y: 0 };
const _euler = new THREE.Euler(), _q0 = new THREE.Quaternion(), _qDev = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const _zee = new THREE.Vector3(0, 0, 1), _yAxis = new THREE.Vector3(0, 1, 0);

// Aparelhos sem giroscópio (ex.: Galaxy A15 4G) só têm acelerômetro + bússola:
// o sinal é mais "tremido", então suavizamos mais.
const _qTarget = new THREE.Quaternion();
orient.source = null; // 'relative' | 'absolute'
orient.hasGyro = false;

function onDeviceOrientation(e) {
  if (e.alpha == null) return;
  const src = e.type === 'deviceorientationabsolute' || e.absolute ? 'absolute' : 'relative';
  // prefere o evento relativo (usa giroscópio); o absoluto fica como reserva
  if (orient.source === 'relative' && src === 'absolute') return;
  if (orient.source !== src) { orient.source = src; orient.needsReset = true; }
  orient.has = true;
  orient.alpha = e.alpha; orient.beta = e.beta; orient.gamma = e.gamma;
}

function detectGyro() {
  if (!('Gyroscope' in window)) return;
  try {
    const g = new Gyroscope({ frequency: 10 });
    g.addEventListener('reading', () => { orient.hasGyro = true; g.stop(); });
    g.addEventListener('error', () => {});
    g.start();
  } catch { /* sem permissão/sem sensor */ }
}

function recenter() {
  orient.needsReset = true;
  drag.yaw = 0;
  toast('Direção recentralizada ↑');
}

function updateFallbackCamera() {
  camera.position.set(0, 0, 0);
  if (orient.has) {
    const d = THREE.MathUtils.degToRad;
    _euler.set(d(orient.beta), d(orient.alpha), -d(orient.gamma), 'YXZ');
    _qDev.setFromEuler(_euler).multiply(_q1);
    const so = d(screen.orientation?.angle || 0);
    _qDev.multiply(_q0.setFromAxisAngle(_zee, -so));
    if (orient.needsReset) {
      yawOffset.setFromAxisAngle(_yAxis, -yawFromQuat(_qDev));
      orient.needsReset = false;
      camera.quaternion.copy(yawOffset).multiply(_qDev);
    }
    _qTarget.copy(yawOffset).multiply(_qDev);
    // suavização: mais forte quando não há giroscópio
    camera.quaternion.slerp(_qTarget, orient.hasGyro ? 0.35 : 0.12);
  } else {
    camera.rotation.set(drag.pitch, drag.yaw, 0, 'YXZ');
  }
}

window.addEventListener('pointerdown', e => {
  if (state.mode !== 'fallback' || orient.has || e.target.closest('button,#minimapWrap')) return;
  drag.active = true; drag.x = e.clientX; drag.y = e.clientY;
});
window.addEventListener('pointermove', e => {
  if (!drag.active) return;
  drag.yaw += (e.clientX - drag.x) * 0.005;
  drag.pitch = THREE.MathUtils.clamp(drag.pitch + (e.clientY - drag.y) * 0.005, -1.4, 1.4);
  drag.x = e.clientX; drag.y = e.clientY;
});
window.addEventListener('pointerup', () => (drag.active = false));

/* ------------------------------ CÂMERA ------------------------------ */
const Cam = {
  stream: null,
  async get() {
    if (this.stream && this.stream.active) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    return this.stream;
  },
  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  },
};

/* --------------------------- LEITOR DE QR --------------------------- */
function parseQR(text) {
  const m = String(text).match(/CP\s*[-_:]?\s*(\d+)/i) || String(text).trim().match(/^(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

const Scanner = {
  running: false, detector: null, canvas: null, lastBad: null,

  async open() {
    $('#scanner').classList.remove('hidden');
    const next = Math.min((state.cpId || 0) + 1, 5);
    $('#scanHint').textContent = state.cpId ? `Aponte para o QR ${next}` : 'Aponte para o QR da sua sala (QR 1)';
    const video = $('#scanVideo');
    try {
      video.srcObject = await Cam.get();
      await video.play();
    } catch (e) {
      $('#scanHint').textContent = 'Não consegui abrir a câmera (' + e.message + '). Use "Simular próximo QR".';
      return;
    }
    if (!this.detector && 'BarcodeDetector' in window) {
      try {
        const f = await BarcodeDetector.getSupportedFormats();
        if (f.includes('qr_code')) this.detector = new BarcodeDetector({ formats: ['qr_code'] });
      } catch { /* ignora */ }
    }
    if (!this.detector && !window.jsQR) {
      try { await loadScript(CONFIG.JSQR_URL); } catch { console.warn('jsQR indisponível'); }
    }
    this.running = true;
    this.tick();
  },

  async tick() {
    if (!this.running) return;
    try {
      const val = await this.detect();
      if (val && this.running && val !== this.lastBad) {
        this.running = false;
        const ok = await handleQR(val);
        if (!ok) { this.lastBad = val; this.running = true; }
      }
    } catch (e) { /* frame ruim, tenta de novo */ }
    if (this.running) setTimeout(() => this.tick(), 120);
  },

  async detect() {
    const v = $('#scanVideo');
    if (v.readyState < 2 || !v.videoWidth) return null;
    if (this.detector) {
      const r = await this.detector.detect(v);
      return r[0]?.rawValue || null;
    }
    if (window.jsQR) {
      this.canvas ||= document.createElement('canvas');
      const scale = Math.min(1, 640 / v.videoWidth);
      const w = (this.canvas.width = Math.round(v.videoWidth * scale));
      const h = (this.canvas.height = Math.round(v.videoHeight * scale));
      const g = this.canvas.getContext('2d', { willReadFrequently: true });
      g.drawImage(v, 0, 0, w, h);
      const code = window.jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      return code?.data || null;
    }
    return null;
  },

  close() {
    this.running = false;
    this.lastBad = null;
    $('#scanner').classList.add('hidden');
    const v = $('#scanVideo');
    v.pause(); v.srcObject = null;
    if (state.mode !== 'fallback') Cam.stop(); // no modo compatível o vídeo de fundo usa o mesmo stream
  },
};

/* ------------------------------- FLUXO ------------------------------ */
async function handleQR(raw) {
  const id = parseQR(raw);
  if (!id) { $('#scanHint').textContent = 'QR não reconhecido: ' + raw; return false; }

  if (!state.route) {
    $('#scanHint').textContent = 'Calculando rota acessível…';
    const route = await API.requestRoute(id === 1 ? 'sala-2' : 'cp-' + id, state.destination.id);
    state.route = normalizeRoute(route);
  }
  const cp = state.route.checkpoints.find(c => c.id === id);
  if (!cp) { $('#scanHint').textContent = `QR ${id} não faz parte desta rota.`; return false; }

  Scanner.close();
  navigator.vibrate?.(80);
  state.cpId = id;
  tracking.valid = false;
  API.sendCheckpoint(cp, raw);

  if (cp.arrived) { finish(); return true; }

  buildSegment(cp);
  showStepCard(cp);
  return true;
}

function showStepCard(cp) {
  showHud(false);
  $('#stepTag').textContent = `📍 QR ${cp.id} lido`;
  $('#stepPlace').textContent = cp.place;
  $('#stepIcon').textContent = cp.icon;
  $('#stepTitle').textContent = cp.title;
  $('#stepSub').textContent = cp.sub;
  $('#stepProgress').innerHTML = state.route.checkpoints
    .filter(c => !c.arrived)
    .map(c => `<li class="${c.id < cp.id ? 'done' : c.id === cp.id ? 'now' : ''}"></li>`).join('');
  showScreen('screenStep');
}

async function enterAR() {
  const cp = currentCp();
  if (!cp) return;
  buildSegment(cp);
  $('#hudIcon').textContent = cp.icon;
  $('#hudTitle').textContent = cp.title;
  $('#hudSub').textContent = cp.sub;
  try { await navigator.wakeLock?.request('screen'); } catch { /* ok */ }

  if (state.xrSupported) {
    try { await startXR(); return; }
    catch (e) { console.warn('WebXR falhou, usando modo compatível:', e); toast('AR indisponível – modo compatível'); }
  }
  await startFallback();
}

async function startXR() {
  Cam.stop(); // ARCore precisa da câmera só para ele
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['local'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: $('#overlay') },
  });
  state.session = session;
  state.mode = 'xr';
  session.addEventListener('end', onXREnd);
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  document.body.classList.add('ar-active');
  showScreen(null);
  showHud(true);
  drawMinimap();
}

function onXREnd() {
  state.session = null;
  document.body.classList.remove('ar-active');
  showHud(false);
  if (state.endingForScan) { const r = state.endingForScan; state.endingForScan = null; r(); return; }
  if (!state.done && currentCp()) showStepCard(currentCp()); // usuário saiu com "voltar"
}

function endXR() {
  return new Promise(res => {
    if (!state.session) return res();
    state.endingForScan = res;
    state.session.end().catch(() => res());
  });
}

async function startFallback() {
  state.mode = 'fallback';
  const v = $('#bgVideo');
  try {
    v.srcObject = await Cam.get();
    await v.play();
    v.classList.add('on');
  } catch (e) { console.warn('Sem câmera no modo compatível', e); }
  if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
    try { await DeviceOrientationEvent.requestPermission(); } catch { /* ok */ }
  }
  window.addEventListener('deviceorientation', onDeviceOrientation);
  window.addEventListener('deviceorientationabsolute', onDeviceOrientation);
  detectGyro();
  orient.needsReset = true;
  drag.yaw = 0; drag.pitch = -0.35;
  document.body.classList.add('fallback-active');
  showScreen(null);
  showHud(true);
  drawMinimap();
}

function stopFallback() {
  window.removeEventListener('deviceorientation', onDeviceOrientation);
  window.removeEventListener('deviceorientationabsolute', onDeviceOrientation);
  document.body.classList.remove('fallback-active');
  $('#bgVideo').classList.remove('on');
  $('#bgVideo').srcObject = null;
  Cam.stop();
  state.mode = null;
}

async function onScanButton() {
  showHud(false);
  if (state.mode === 'xr' && state.session) {
    await endXR();
    await sleep(300); // dá tempo do ARCore liberar a câmera
  }
  Scanner.open();
}

function onScanCancel() {
  Scanner.close();
  const cp = currentCp();
  if (!cp) { showScreen('screenLocate'); return; }
  if (state.mode === 'fallback') { showScreen(null); showHud(true); }
  else showStepCard(cp);
}

function finish() {
  state.done = true;
  showHud(false);
  if (state.mode === 'fallback') stopFallback();
  const total = state.route.checkpoints.reduce((a, c) => a + (c.poly ? polyLength(c.poly) : 0), 0);
  const stats = { distanceM: +total.toFixed(1), elevators: 1, stairs: 0, steps: 0, checkpoints: state.route.checkpoints.length };
  API.sendArrival(stats);
  $('#doneStats').innerHTML = `
    <li><b>${total.toFixed(1).replace('.', ',')} m</b>percorridos</li>
    <li><b>1</b>elevador</li>
    <li><b>0</b>degraus</li>
    <li><b>${stats.checkpoints}</b>QR codes</li>`;
  showScreen('screenDone');
  navigator.vibrate?.([100, 60, 100]);
}

function restart() {
  if (state.mode === 'fallback') stopFallback();
  Object.assign(state, { destination: null, route: null, cpId: 0, done: false, mode: null });
  clearGroup(routeInner);
  chevrons = []; pulses = [];
  showScreen('screenHome');
}

/* ------------------------------- LOOP ------------------------------- */
renderer.setAnimationLoop((t, frame) => {
  const time = t / 1000;
  if (state.mode === 'fallback' && !renderer.xr.isPresenting) updateFallbackCamera();
  animateRoute(time);
  renderer.render(scene, camera);

  if (frame) {
    const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
    if (pose) updateTracking(pose.transform.position, pose.transform.orientation, t);
  } else if (state.mode === 'fallback') {
    updateTracking(camera.position, camera.quaternion, t);
  }
});

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ------------------------------- INIT ------------------------------- */
async function init() {
  // lista de destinos (no demo só a Sala 23)
  $('#destList').innerHTML = DESTINATIONS.map(d => `
    <li><button class="dest-item" data-id="${d.id}">
      <span class="dest-num">${d.num}</span>
      <span class="dest-info">
        <span class="dest-name">${d.label}</span><br>
        <span class="muted small">${d.floorLabel} · ${d.desc}</span><br>
        <span class="dest-badge">♿ rota acessível disponível</span>
      </span>
      <span aria-hidden="true">›</span>
    </button></li>`).join('');
  $('#destList').addEventListener('click', e => {
    const b = e.target.closest('.dest-item');
    if (!b) return;
    state.destination = DESTINATIONS.find(d => d.id === b.dataset.id);
    $('#locateDest').textContent = `${state.destination.label} (${state.destination.floorLabel})`;
    showScreen('screenLocate');
  });

  $('#btnBackHome').onclick = () => showScreen('screenHome');
  $('#btnScanStart').onclick = () => Scanner.open();
  $('#btnEnterAR').onclick = enterAR;
  $('#btnScan').onclick = onScanButton;
  $('#btnScanCancel').onclick = onScanCancel;
  $('#btnSimulate').onclick = () => handleQR('RA:CP' + Math.min((state.cpId || 0) + 1, 5));
  $('#btnRestart').onclick = restart;
  // tocar na instrução recentraliza a direção (útil se a bússola "puxar" a seta)
  $('.instruction').addEventListener('click', () => { if (state.mode === 'fallback') recenter(); });

  // ?modo=compat força o modo compatível (para testar sem ARCore)
  if (params.get('modo') === 'compat') state.forceCompat = true;

  // toques no overlay não viram "select" do WebXR
  $('#overlay').addEventListener('beforexrselect', e => e.preventDefault());

  API.setStatus(API.base ? 'offline' : 'mock');

  try { state.xrSupported = !state.forceCompat && !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); }
  catch { state.xrSupported = false; }
  $('#arSupport').textContent = state.xrSupported
    ? 'AR: WebXR disponível ✓'
    : 'AR: modo compatível (câmera + sensores, sem ARCore)';
}

init();

// The 3D world: road, scenery, weather, the player's car, hazards, markers and labels.
import * as THREE from 'three';
import type { Surface } from './physics';
import { CAR_LENGTH, type CarModel, type HazardKind, type HazardModel, makeCar, makeHazard, mulberry32 } from './models';

export const LANE_X = -1.8; // UK: drive on the left.
const ROAD_WIDTH = 7.3;
const ROAD_START = 120; // metres behind the start line
const ROAD_LENGTH = 2600;
const TEX_METRES = 24; // road texture covers 24 m of road

interface SurfaceLook {
  sky: number;
  fogNear: number;
  fogFar: number;
  grass: number;
  foliage: number;
  road: { base: string; speckle: string; speckleAlpha: number; line: string };
  roadRoughness: number;
  roadMetalness: number;
  sun: number;
  hemi: number;
  rain: boolean;
  puddles: boolean;
}

const LOOKS: Record<Surface, SurfaceLook> = {
  dry: {
    sky: 0xa9d4f0,
    fogNear: 80,
    fogFar: 520,
    grass: 0x6ea84e,
    foliage: 0x3d8a3a,
    road: { base: '#55595f', speckle: '#6b7077', speckleAlpha: 0.5, line: '#f2f2ee' },
    roadRoughness: 0.95,
    roadMetalness: 0,
    sun: 2.4,
    hemi: 1.3,
    rain: false,
    puddles: false,
  },
  wet: {
    sky: 0x7f8c97,
    fogNear: 40,
    fogFar: 380,
    grass: 0x4c7a3a,
    foliage: 0x2c6430,
    road: { base: '#2b2f34', speckle: '#3d434a', speckleAlpha: 0.5, line: '#d9dcdc' },
    roadRoughness: 0.28,
    roadMetalness: 0.35,
    sun: 0.9,
    hemi: 1.4,
    rain: true,
    puddles: true,
  },
  icy: {
    sky: 0xd9e6ef,
    fogNear: 60,
    fogFar: 460,
    grass: 0xe8eff4,
    foliage: 0x8fac9f,
    road: { base: '#8c9aa5', speckle: '#e8f2f8', speckleAlpha: 0.55, line: '#ffffff' },
    roadRoughness: 0.15,
    roadMetalness: 0.25,
    sun: 2.8,
    hemi: 1.5,
    rain: false,
    puddles: false,
  },
};

export interface ViewInset {
  right: number;
  bottom: number;
}

interface Label {
  el: HTMLDivElement;
  pos: THREE.Vector3;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
  readonly car: CarModel;

  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private hemi = new THREE.HemisphereLight(0xdfefff, 0x445533, 1.2);
  private ground: THREE.Mesh;
  private groundMat = new THREE.MeshStandardMaterial({ color: 0x6ea84e, flatShading: true, roughness: 1 });
  private roadMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  private roadTextures = new Map<Surface, THREE.CanvasTexture>();
  private foliageMat = new THREE.MeshStandardMaterial({ color: 0x3d8a3a, flatShading: true, roughness: 0.9 });
  private leftScenery = new THREE.Group();
  private rightScenery = new THREE.Group();
  private runProps = new THREE.Group();
  private paint = new THREE.Group();
  private rain: THREE.LineSegments | null = null;
  private rainVel: Float32Array | null = null;
  private hazard: HazardModel | null = null;
  private hazardBaseZ = 0;
  private idealMarker: THREE.Mesh;
  private labels: Label[] = [];
  private labelRoot: HTMLElement;
  private inset: ViewInset = { right: 0, bottom: 0 };
  private surface: Surface = 'dry';
  private sideRange: [number, number] | null = null;

  constructor(canvas: HTMLCanvasElement, labelRoot: HTMLElement) {
    this.labelRoot = labelRoot;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene.fog = new THREE.Fog(0xa9d4f0, 80, 520);
    this.sun.position.set(-30, 60, 20);
    this.scene.add(this.sun, this.hemi);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(600, ROAD_LENGTH + 400), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(0, -0.02, ROAD_START - (ROAD_LENGTH + 400) / 2 + 200);
    this.scene.add(this.ground);

    const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, ROAD_LENGTH), this.roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, ROAD_START - ROAD_LENGTH / 2);
    this.scene.add(road);

    // Pavement and kerb on the left; grass verge on the right.
    const pavementMat = new THREE.MeshStandardMaterial({ color: 0x9a9a94, roughness: 0.95 });
    const pavement = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, ROAD_LENGTH), pavementMat);
    pavement.position.set(-ROAD_WIDTH / 2 - 1.1, 0.07, ROAD_START - ROAD_LENGTH / 2);
    this.scene.add(pavement);

    this.scene.add(this.leftScenery, this.rightScenery, this.runProps, this.paint);

    this.car = makeCar(0xd8452f);
    this.scene.add(this.car.group);

    this.idealMarker = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.7),
      new THREE.MeshBasicMaterial({ color: 0x6fd3a8, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.idealMarker.rotation.x = -Math.PI / 2;
    this.idealMarker.position.set(LANE_X, 0.03, 0);
    this.idealMarker.renderOrder = 2;
    this.scene.add(this.idealMarker);

    this.setSurface('dry');
    this.buildScenery(1, null);
    this.resize();
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  setSurface(surface: Surface): void {
    this.surface = surface;
    const look = LOOKS[surface];
    this.scene.background = new THREE.Color(look.sky);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(look.sky);
    fog.near = look.fogNear;
    fog.far = look.fogFar;
    this.groundMat.color.setHex(look.grass);
    this.foliageMat.color.setHex(look.foliage);
    this.sun.intensity = look.sun;
    this.hemi.intensity = look.hemi;
    this.roadMat.map = this.roadTexture(surface);
    this.roadMat.roughness = look.roadRoughness;
    this.roadMat.metalness = look.roadMetalness;
    this.roadMat.needsUpdate = true;
    this.setRain(look.rain);
  }

  private roadTexture(surface: Surface): THREE.CanvasTexture {
    const cached = this.roadTextures.get(surface);
    if (cached) return cached;
    const look = LOOKS[surface].road;
    const W = 256;
    const H = 1024;
    const pxPerM = H / TEX_METRES;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = look.base;
    g.fillRect(0, 0, W, H);
    const rnd = mulberry32(surface.length * 7919);
    g.globalAlpha = look.speckleAlpha;
    g.fillStyle = look.speckle;
    for (let i = 0; i < 9000; i++) {
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
    }
    if (surface === 'icy') {
      // Glassy frost patches.
      for (let i = 0; i < 26; i++) {
        g.globalAlpha = 0.12 + rnd() * 0.15;
        g.beginPath();
        g.ellipse(rnd() * W, rnd() * H, 20 + rnd() * 60, 40 + rnd() * 120, rnd() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    const mToPx = W / ROAD_WIDTH;
    g.fillStyle = look.line;
    // Edge lines.
    g.fillRect(0.25 * mToPx, 0, 0.1 * mToPx, H);
    g.fillRect(W - 0.35 * mToPx, 0, 0.1 * mToPx, H);
    // Centre line: 4 m dash, 8 m gap.
    const cw = 0.12 * mToPx;
    for (let m = 0; m < TEX_METRES; m += 12) {
      g.fillRect(W / 2 - cw / 2, m * pxPerM, cw, 4 * pxPerM);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, ROAD_LENGTH / TEX_METRES);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.roadTextures.set(surface, tex);
    return tex;
  }

  /**
   * Rebuild trees, houses and lamp posts for a run. `junctionP` leaves a gap
   * for a side road on the left where a car will pull out.
   */
  buildScenery(seed: number, junctionP: number | null): void {
    disposeChildren(this.leftScenery);
    disposeChildren(this.rightScenery);
    disposeChildren(this.runProps);
    const rnd = mulberry32(seed);
    const from = ROAD_START - 20;
    const to = ROAD_START - ROAD_LENGTH + 20;
    const clear = (z: number, margin: number) => junctionP !== null && Math.abs(-z - junctionP) < margin;

    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.8, 6);
    trunkGeo.translate(0, 0.9, 0);
    const coneGeo = new THREE.ConeGeometry(1.5, 3.8, 7);
    coneGeo.translate(0, 3.4, 0);
    const blobGeo = new THREE.IcosahedronGeometry(1.8, 0);
    blobGeo.translate(0, 3.0, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4030, flatShading: true });

    const treesL: THREE.Matrix4[] = [];
    const treesR: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let z = from; z > to; z -= 6 + rnd() * 10) {
      const scale = 0.8 + rnd() * 0.7;
      s.set(scale, scale, scale);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
      p.set(ROAD_WIDTH / 2 + 4 + rnd() * 30, 0, z);
      treesR.push(m.compose(p, q, s).clone());
      if (rnd() < 0.55 && !clear(z, 14)) {
        p.set(-ROAD_WIDTH / 2 - 7 - rnd() * 6 - (rnd() < 0.5 ? 18 : 0), 0, z + rnd() * 4);
        treesL.push(m.compose(p, q, s).clone());
      }
    }
    const addTrees = (list: THREE.Matrix4[], group: THREE.Group) => {
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
      const half = Math.ceil(list.length / 2);
      const cones = new THREE.InstancedMesh(coneGeo, this.foliageMat, half);
      const blobs = new THREE.InstancedMesh(blobGeo, this.foliageMat, list.length - half);
      list.forEach((mat, i) => {
        trunks.setMatrixAt(i, mat);
        if (i < half) cones.setMatrixAt(i, mat);
        else blobs.setMatrixAt(i - half, mat);
      });
      group.add(trunks, cones, blobs);
    };
    addTrees(treesL, this.leftScenery);
    addTrees(treesR, this.rightScenery);

    // Houses on the left, set back behind the pavement.
    const houseGeo = new THREE.BoxGeometry(7, 5, 8);
    houseGeo.translate(0, 2.5, 0);
    const roofGeo = new THREE.ConeGeometry(6.2, 3, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.scale(1, 1, 1.25);
    roofGeo.translate(0, 6.5, 0);
    const houseZ: number[] = [];
    for (let z = from - 10; z > to; z -= 14 + rnd() * 30) {
      if (!clear(z, 16)) houseZ.push(z);
    }
    const walls = new THREE.InstancedMesh(houseGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), houseZ.length);
    const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), houseZ.length);
    const wallColours = [0xe8dcc8, 0xc9a78a, 0xd8d2c4, 0xb5654a, 0xefe7d6];
    const roofColours = this.surface === 'icy' ? [0xf3f7fa, 0xe6eef3] : [0x5a3d33, 0x45484d, 0x6b4a3a];
    const col = new THREE.Color();
    houseZ.forEach((z, i) => {
      const sc = 0.85 + rnd() * 0.3;
      m.compose(new THREE.Vector3(-ROAD_WIDTH / 2 - 12 - rnd() * 3, 0, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc));
      walls.setMatrixAt(i, m);
      roofs.setMatrixAt(i, m);
      walls.setColorAt(i, col.setHex(wallColours[Math.floor(rnd() * wallColours.length)]));
      roofs.setColorAt(i, col.setHex(roofColours[Math.floor(rnd() * roofColours.length)]));
    });
    this.leftScenery.add(walls, roofs);

    // Lamp posts on the pavement.
    const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 6, 6);
    postGeo.translate(0, 3, 0);
    const armGeo = new THREE.BoxGeometry(1.2, 0.1, 0.18);
    armGeo.translate(0.55, 6, 0);
    const postZ: number[] = [];
    for (let z = from; z > to; z -= 40) if (!clear(z, 8)) postZ.push(z);
    const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x55595e }), postZ.length);
    const arms = new THREE.InstancedMesh(armGeo, new THREE.MeshStandardMaterial({ color: 0x55595e }), postZ.length);
    postZ.forEach((z, i) => {
      m.makeTranslation(-ROAD_WIDTH / 2 - 0.5, 0, z);
      posts.setMatrixAt(i, m);
      arms.setMatrixAt(i, m);
    });
    this.leftScenery.add(posts, arms);

    // Puddles on wet roads.
    if (LOOKS[this.surface].puddles) {
      const puddleMat = new THREE.MeshStandardMaterial({
        color: 0x1a1e22,
        roughness: 0.05,
        metalness: 0.6,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      });
      const puddleGeo = new THREE.CircleGeometry(1, 14);
      puddleGeo.rotateX(-Math.PI / 2);
      const n = 140;
      const puddles = new THREE.InstancedMesh(puddleGeo, puddleMat, n);
      for (let i = 0; i < n; i++) {
        const z = from - rnd() * (from - to);
        const x = (rnd() - 0.5) * (ROAD_WIDTH - 1);
        m.compose(new THREE.Vector3(x, 0.012, z), new THREE.Quaternion(), new THREE.Vector3(0.6 + rnd() * 1.4, 1, 1 + rnd() * 2.5));
        puddles.setMatrixAt(i, m);
      }
      puddles.renderOrder = 1;
      this.runProps.add(puddles);
    }

    // Side road for a car pulling out.
    if (junctionP !== null) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(40, 7), this.roadMat.clone());
      (side.material as THREE.MeshStandardMaterial).map = null;
      (side.material as THREE.MeshStandardMaterial).color.set(LOOKS[this.surface].road.base);
      side.rotation.x = -Math.PI / 2;
      side.position.set(-ROAD_WIDTH / 2 - 20, 0.15, -(junctionP + 0.9));
      this.runProps.add(side);
      // Give way lines.
      const gw = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 3.2),
        new THREE.MeshBasicMaterial({ color: 0xf2f2ee }),
      );
      gw.rotation.x = -Math.PI / 2;
      gw.position.set(-ROAD_WIDTH / 2 - 0.6, 0.16, -(junctionP + 0.9) - 1.6);
      this.runProps.add(gw);
    }
  }

  private setRain(on: boolean): void {
    if (this.rain) {
      this.scene.remove(this.rain);
      this.rain.geometry.dispose();
      (this.rain.material as THREE.Material).dispose();
      this.rain = null;
    }
    if (!on) return;
    const n = 1400;
    const pos = new Float32Array(n * 6);
    this.rainVel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 50;
      const y = Math.random() * 18;
      const z = -Math.random() * 70 + 8;
      pos.set([x, y, z, x, y + 0.5, z + 0.08], i * 6);
      this.rainVel[i] = 14 + Math.random() * 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0xc8d4de, transparent: true, opacity: 0.45, fog: false }),
    );
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  // -------------------------------------------------------------------------
  // Per-run objects
  // -------------------------------------------------------------------------

  /** Place the player's car with its front bumper at road position p (metres). */
  setCar(p: number, speed: number, braking: boolean, dt: number): void {
    this.car.group.position.set(LANE_X, 0, -(p - CAR_LENGTH / 2));
    this.car.brakeLight.emissiveIntensity = braking ? 2.2 : 0;
    const pitchTarget = braking && speed > 0.2 ? -0.035 : 0;
    this.car.body.rotation.x += (pitchTarget - this.car.body.rotation.x) * Math.min(1, dt * 8);
    for (const w of this.car.wheels) w.rotation.x = -p / 0.34;
  }

  placeHazard(kind: HazardKind, hazardP: number): HazardModel {
    this.clearHazard();
    const h = makeHazard(kind, LANE_X);
    this.hazard = h;
    this.hazardBaseZ = -(hazardP + h.depth / 2);
    h.group.position.set(h.fromX, 0, this.hazardBaseZ);
    h.group.visible = false;
    this.scene.add(h.group);
    return h;
  }

  /** Show the hazard `t` seconds after it appeared (negative hides it). */
  updateHazard(t: number): void {
    const h = this.hazard;
    if (!h) return;
    h.group.visible = t >= 0;
    if (t < 0) return;
    const k = Math.min(1, t / h.enterSeconds);
    const ease = 1 - (1 - k) * (1 - k);
    h.group.position.x = h.fromX + (h.toX - h.fromX) * ease;
    h.animate?.(t);
  }

  clearHazard(): void {
    if (!this.hazard) return;
    this.scene.remove(this.hazard.group);
    disposeChildren(this.hazard.group);
    this.hazard = null;
  }

  setIdealMarker(p: number | null): void {
    this.idealMarker.visible = p !== null;
    if (p !== null) this.idealMarker.position.z = -p;
  }

  /** Paint a coloured strip on our lane between road positions a and b. */
  paintSegment(a: number, b: number, color: number, opacity = 0.85): THREE.Mesh {
    const len = Math.max(0.01, b - a);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 1),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 3;
    mesh.position.set(LANE_X, 0.035, 0);
    this.paint.add(mesh);
    setSegment(mesh, a, len);
    return mesh;
  }

  clearPaint(): void {
    disposeChildren(this.paint);
  }

  setSceneryRightVisible(v: boolean): void {
    this.rightScenery.visible = v;
  }

  // -------------------------------------------------------------------------
  // Labels projected from 3D into the DOM
  // -------------------------------------------------------------------------

  addLabel(text: string, p: number, height: number, cls: string, x = LANE_X): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `label3d ${cls}`;
    el.textContent = text;
    this.labelRoot.appendChild(el);
    this.labels.push({ el, pos: new THREE.Vector3(x, height, -p) });
    return el;
  }

  moveLabel(el: HTMLDivElement, p: number): void {
    const l = this.labels.find((x) => x.el === el);
    if (l) l.pos.z = -p;
  }

  clearLabels(): void {
    for (const l of this.labels) l.el.remove();
    this.labels = [];
  }

  private updateLabels(): void {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const v = new THREE.Vector3();
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const l of this.labels) {
      v.copy(l.pos).project(this.camera);
      const visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      l.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const lw = l.el.offsetWidth;
      const lh = l.el.offsetHeight;
      const x = Math.min(w - lw / 2 - 6, Math.max(lw / 2 + 6, ((v.x + 1) / 2) * w));
      let y = ((1 - v.y) / 2) * h; // bottom edge of the label
      // Nudge upwards until it no longer overlaps a label already placed.
      for (let guard = 0; guard < 8; guard++) {
        const hit = placed.find((r) => x - lw / 2 < r.x1 && x + lw / 2 > r.x0 && y - lh < r.y1 && y > r.y0);
        if (!hit) break;
        y = hit.y0 - 3;
      }
      // Hide labels that would sit under the results panel.
      if (y > h - this.inset.bottom || x + lw / 2 > w - this.inset.right) {
        l.el.style.display = 'none';
        continue;
      }
      placed.push({ x0: x - lw / 2, x1: x + lw / 2, y0: y - lh, y1: y });
      l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  }

  // -------------------------------------------------------------------------
  // Cameras
  // -------------------------------------------------------------------------

  chaseCamera(p: number, speed: number, time: number): void {
    if (this.sideRange) {
      this.sideRange = null;
      const fog = this.scene.fog as THREE.Fog;
      fog.near = LOOKS[this.surface].fogNear;
      fog.far = LOOKS[this.surface].fogFar;
    }
    const carZ = -(p - CAR_LENGTH / 2);
    const shake = Math.min(speed / 31, 1) * 0.02;
    this.camera.position.set(LANE_X + 0.2, 2.3 + Math.sin(time * 23) * shake, carZ + 7.2);
    this.camera.lookAt(LANE_X * 0.6, 1.1, carZ - 30);
  }

  /** Side-on view from the right-hand verge framing road positions a..b. */
  sideCamera(a: number, b: number): void {
    this.sideRange = [a, b];
    this.reframeSide();
  }

  /** Re-apply the side-on framing, e.g. after a resize or a change of inset. */
  reframeSide(): void {
    if (!this.sideRange) return;
    const [a, b] = this.sideRange;
    const len = Math.max(28, b - a);
    const mid = (a + b) / 2;
    const el = this.renderer.domElement;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const fullH = H + this.inset.bottom;
    const availW = Math.max(120, W - this.inset.right);
    const availH = Math.max(120, H - this.inset.bottom);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    // Push the fog back so a distant replay camera still sees the road clearly.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = len * 2;
    fog.far = len * 2 + 900;
    if (availW / availH < 0.9 || W / H < 0.75) {
      // Portrait: look down the road from high behind, so the stop runs up the screen.
      const dist = (len * 1.1 * fullH) / (2 * tanHalf * availH);
      this.camera.position.set(LANE_X + 2, dist * 0.93, -mid + dist * 0.37);
      this.camera.lookAt(LANE_X, 0, -mid);
      return;
    }
    // Landscape: side-on from the right-hand verge, angled down so the paint shows.
    const dist = (len * 1.1 * fullH) / (2 * tanHalf * availW);
    this.camera.position.set(LANE_X + dist * 0.88, dist * 0.47, -mid);
    this.camera.lookAt(LANE_X, 0, -mid);
  }

  setInset(inset: ViewInset): void {
    this.inset = inset;
    this.applyViewOffset();
  }

  private applyViewOffset(): void {
    const el = this.renderer.domElement;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const { right, bottom } = this.inset;
    if (right > 0 || bottom > 0) {
      this.camera.setViewOffset(W + right, H + bottom, right, bottom, W, H);
    } else {
      this.camera.clearViewOffset();
    }
  }

  resize(): void {
    const el = this.renderer.domElement;
    const W = el.clientWidth;
    const H = el.clientHeight;
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.fov = W / H < 1 ? 66 : 50;
    this.camera.updateProjectionMatrix();
    this.applyViewOffset();
    this.reframeSide();
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  render(dt: number): void {
    if (this.rain && this.rainVel) {
      const attr = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const cam = this.camera.position;
      for (let i = 0; i < this.rainVel.length; i++) {
        const o = i * 6;
        let y = arr[o + 1] - this.rainVel[i] * dt;
        let x = arr[o];
        let z = arr[o + 2];
        // Keep drops in a box around the camera.
        if (y < 0 || z > cam.z + 10 || z < cam.z - 80 || Math.abs(x - cam.x) > 30) {
          y = 4 + Math.random() * 16;
          x = cam.x + (Math.random() - 0.5) * 50;
          z = cam.z + 8 - Math.random() * 80;
        }
        arr[o] = x;
        arr[o + 1] = y;
        arr[o + 2] = z;
        arr[o + 3] = x;
        arr[o + 4] = y + 0.5;
        arr[o + 5] = z + 0.08;
      }
      attr.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }
}

export function setSegment(mesh: THREE.Mesh, a: number, len: number): void {
  mesh.scale.y = Math.max(0.01, len);
  mesh.position.z = -(a + len / 2);
}

function disposeChildren(group: THREE.Object3D): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
    });
  }
}

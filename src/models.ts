// Low-poly models built from primitives, so the game ships with no asset files.
import * as THREE from 'three';

const flat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, ...extra });

export const CAR_LENGTH = 4.2;
export const CAR_WIDTH = 1.8;

export interface CarModel {
  group: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Mesh[];
  brakeLight: THREE.MeshStandardMaterial;
}

/** A small hatchback. Front of the car faces -z, origin at the centre of its footprint. */
export function makeCar(color: number): CarModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const paint = flat(color, { roughness: 0.45, metalness: 0.1 });
  const glass = flat(0x3b5266, { roughness: 0.25, metalness: 0.2 });
  const trim = flat(0x22262b);

  const lower = new THREE.Mesh(new THREE.BoxGeometry(CAR_WIDTH, 0.62, CAR_LENGTH), paint);
  lower.position.y = 0.62;
  body.add(lower);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.56, 2.3), glass);
  cabin.position.set(0, 1.21, 0.25);
  body.add(cabin);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 2.0), paint);
  roof.position.set(0, 1.52, 0.3);
  body.add(roof);

  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(CAR_WIDTH + 0.04, 0.22, 0.2), trim);
  bumperF.position.set(0, 0.42, -CAR_LENGTH / 2);
  body.add(bumperF);
  const bumperR = bumperF.clone();
  bumperR.position.z = CAR_LENGTH / 2;
  body.add(bumperR);

  const headMat = flat(0xfff6d5, { emissive: 0xfff2c0, emissiveIntensity: 0.4 });
  for (const x of [-0.62, 0.62]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.05), headMat);
    h.position.set(x, 0.74, -CAR_LENGTH / 2 - 0.01);
    body.add(h);
  }

  const brakeLight = flat(0x5a1010, { emissive: 0xff1a1a, emissiveIntensity: 0 });
  for (const x of [-0.64, 0.64]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.05), brakeLight);
    b.position.set(x, 0.78, CAR_LENGTH / 2 + 0.01);
    body.add(b);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const tyre = flat(0x16181b);
  const hubGeo = new THREE.BoxGeometry(0.27, 0.12, 0.42);
  const hubMat = flat(0x9aa3ab);
  const wheels: THREE.Mesh[] = [];
  for (const x of [-0.84, 0.84]) {
    for (const z of [-1.35, 1.35]) {
      const w = new THREE.Mesh(wheelGeo, tyre);
      w.position.set(x, 0.34, z);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      w.add(hub);
      group.add(w);
      wheels.push(w);
    }
  }

  // Soft contact shadow.
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(CAR_WIDTH + 0.6, CAR_LENGTH + 0.6),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  group.add(shadow);

  return { group, body, wheels, brakeLight };
}

export interface HazardModel {
  group: THREE.Group;
  /** Depth along the road (m), so the near edge can sit on the hazard line. */
  depth: number;
  /** Lateral start and end positions for the entrance animation. */
  fromX: number;
  toX: number;
  enterSeconds: number;
  /** Extra per-frame animation, given seconds since the hazard appeared. */
  animate?: (t: number) => void;
  name: string;
}

export type HazardKind = 'child' | 'deer' | 'car';

export function makeHazard(kind: HazardKind, laneX: number): HazardModel {
  switch (kind) {
    case 'child':
      return makeChild(laneX);
    case 'deer':
      return makeDeer(laneX);
    case 'car':
      return makePullingOutCar(laneX);
  }
}

function makeChild(laneX: number): HazardModel {
  const group = new THREE.Group();
  const figure = new THREE.Group();
  group.add(figure);
  const coat = flat(0xffc21a);
  const trousers = flat(0x253a6b);
  const skin = flat(0xe0ac85);
  const hair = flat(0x4a2f1c);

  const legs: THREE.Mesh[] = [];
  for (const x of [-0.09, 0.09]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.15), trousers);
    leg.geometry.translate(0, -0.25, 0);
    leg.position.set(x, 0.52, 0);
    figure.add(leg);
    legs.push(leg);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.46, 0.24), coat);
  torso.position.y = 0.75;
  figure.add(torso);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 1), skin);
  head.position.y = 1.12;
  figure.add(head);
  const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.155, 1), hair);
  cap.scale.set(1, 0.6, 1);
  cap.position.set(0, 1.18, 0.02);
  figure.add(cap);
  for (const x of [-0.25, 0.25]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.12), coat);
    arm.position.set(x, 0.78, 0);
    arm.rotation.z = x > 0 ? -0.5 : 0.5;
    figure.add(arm);
  }
  // Facing across the road (towards +x).
  figure.rotation.y = Math.PI / 2;

  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), flat(0xe0302a, { roughness: 0.5 }));
  ball.position.set(1.4, 0.12, -0.2);
  group.add(ball);

  return {
    group,
    depth: 0.5,
    fromX: laneX - 3.4,
    toX: laneX - 0.2,
    enterSeconds: 0.9,
    name: 'child',
    animate: (t) => {
      const running = t < 0.9;
      const swing = running ? Math.sin(t * 18) * 0.6 : 0;
      legs[0].rotation.x = swing;
      legs[1].rotation.x = -swing;
      ball.position.x = 1.0 + Math.min(t, 2.2) * 1.6;
      ball.rotation.z = -ball.position.x / 0.12;
    },
  };
}

function makeDeer(laneX: number): HazardModel {
  const group = new THREE.Group();
  const deer = new THREE.Group();
  group.add(deer);
  const coat = flat(0x8a5a33);
  const pale = flat(0xd9c3a3);
  const dark = flat(0x2a1d14);

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.48, 0.42), coat);
  body.position.y = 0.95;
  deer.add(body);
  const rump = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.3), pale);
  rump.position.set(-0.6, 1.0, 0);
  deer.add(rump);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), coat);
  neck.position.set(0.55, 1.3, 0);
  neck.rotation.z = -0.5;
  deer.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.18), coat);
  head.position.set(0.78, 1.55, 0);
  deer.add(head);
  for (const z of [-0.08, 0.08]) {
    const antler = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), dark);
    antler.position.set(0.7, 1.75, z);
    antler.rotation.z = 0.3;
    deer.add(antler);
  }
  const legs: THREE.Mesh[] = [];
  for (const x of [-0.48, 0.48]) {
    for (const z of [-0.14, 0.14]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 0.08), coat);
      leg.geometry.translate(0, -0.36, 0);
      leg.position.set(x, 0.74, z);
      deer.add(leg);
      legs.push(leg);
    }
  }
  // Crossing from the right-hand verge towards the left (facing -x).
  deer.rotation.y = Math.PI;

  return {
    group,
    depth: 0.5,
    fromX: laneX + 6.5,
    toX: laneX,
    enterSeconds: 0.8,
    name: 'deer',
    animate: (t) => {
      const moving = t < 0.8;
      const s = moving ? Math.sin(t * 20) * 0.7 : 0;
      legs.forEach((l, i) => (l.rotation.z = i % 2 ? s : -s));
      deer.position.y = moving ? Math.abs(Math.sin(t * 10)) * 0.25 : 0;
    },
  };
}

function makePullingOutCar(laneX: number): HazardModel {
  const car = makeCar(0x2f6fb5);
  car.brakeLight.emissiveIntensity = 1.6;
  const group = new THREE.Group();
  // Turn it to face +x: pulling out of a side road on the left across our lane.
  car.group.rotation.y = -Math.PI / 2;
  group.add(car.group);
  return {
    group,
    depth: CAR_WIDTH,
    fromX: laneX - 7.5,
    toX: laneX + 0.3,
    enterSeconds: 1.5,
    name: 'car pulling out',
    animate: (t) => {
      const spin = Math.min(t, 1.5) * 6;
      car.wheels.forEach((w) => (w.rotation.x = spin));
    },
  };
}

/** Deterministic random numbers, so a run's scenery can be rebuilt. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

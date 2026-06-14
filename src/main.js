import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const canvas = document.querySelector('#game-canvas');
const startScreen = document.querySelector('#start-screen');
const resultScreen = document.querySelector('#result-screen');
const startButton = document.querySelector('#start-button');
const restartButton = document.querySelector('#restart-button');
const resultKicker = document.querySelector('#result-kicker');
const resultTitle = document.querySelector('#result-title');
const resultCopy = document.querySelector('#result-copy');
const hud = document.querySelector('#hud');
const touchLayer = document.querySelector('#touch-layer');
const joystick = document.querySelector('#joystick');
const joystickKnob = document.querySelector('#joystick span');
const sprayButton = document.querySelector('#spray-button');
const flashlightButton = document.querySelector('#flashlight-button');
const fearFill = document.querySelector('#fear-fill');
const keyCounter = document.querySelector('#key-counter');
const messageFeed = document.querySelector('#message-feed');
const jumpscare = document.querySelector('#jumpscare');
const bloodFlash = document.querySelector('#blood-flash');

const CELL = 3;
const ROWS = 17;
const COLS = 25;
const WALL_HEIGHT = 3.4;
const PLAYER_HEIGHT = 1.62;
const PLAYER_RADIUS = 0.42;
const MOVE_SPEED = 3.05;
const LOOK_SENS = 0.0031;
const DOG_RADIUS = 0.38;
const KEY_TOTAL = 3;

const startCell = { c: 1, r: 1 };
const exitCell = { c: 23, r: 1 };
const dogStartCell = { c: 2, r: 14 };
const keyCells = [
  { c: 10, r: 2 },
  { c: 3, r: 8 },
  { c: 21, r: 14 }
];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x040606);
scene.fog = new THREE.FogExp2(0x030505, 0.02);

const camera = new THREE.PerspectiveCamera(73, window.innerWidth / window.innerHeight, 0.03, 85);
camera.rotation.order = 'YXZ';

const isMobileLike = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !isMobileLike,
  powerPreference: 'high-performance'
});
renderer.shadowMap.enabled = !isMobileLike;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const maxDpr = isMobileLike ? 1.25 : 1.85;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
renderer.setSize(window.innerWidth, window.innerHeight, false);

let composer = null;
let bloomPass = null;
try {
  if (!isMobileLike) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.22,
      0.35,
      0.72
    );
    composer.addPass(bloomPass);
  }
} catch {
  composer = null;
}

let lastFrameTime = performance.now();
const rng = mulberry32(3713);
const grid = createLevelGrid();
const solidCells = new Set();
const world = {
  walls: [],
  props: [],
  width: COLS * CELL,
  depth: ROWS * CELL
};

const materials = createMaterials();
const wallGroup = new THREE.Group();
const propGroup = new THREE.Group();
const keyGroup = new THREE.Group();
const sprayGroup = new THREE.Group();
const dogGroup = new THREE.Group();
scene.add(wallGroup, propGroup, keyGroup, sprayGroup, dogGroup);

const ambient = new THREE.HemisphereLight(0xd4dfcf, 0x080705, 0.31);
scene.add(ambient);

const flashlight = new THREE.SpotLight(0xfff4ce, 78, 28, Math.PI / 6.3, 0.58, 1.42);
flashlight.castShadow = !isMobileLike;
flashlight.shadow.mapSize.set(isMobileLike ? 512 : 1024, isMobileLike ? 512 : 1024);
flashlight.shadow.camera.near = 0.15;
flashlight.shadow.camera.far = 22;
flashlight.target.position.set(0, 0, -1);
scene.add(flashlight, flashlight.target);

const flashlightSpill = new THREE.PointLight(0xffedc9, 0.72, 7.5, 1.35);
scene.add(flashlightSpill);

const flashlightVolume = createFlashlightVolume();
scene.add(flashlightVolume);

const player = {
  pos: new THREE.Vector3(),
  yaw: -Math.PI / 2,
  pitch: 0,
  fear: 0,
  keys: 0,
  bob: 0,
  shake: 0,
  lastSafe: new THREE.Vector3()
};

const dog = {
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  path: [],
  pathTimer: 0,
  stun: 0,
  retreat: 0,
  barkTimer: 1.2,
  growlTimer: 0,
  biteCooldown: 0,
  flashlightExposure: 0,
  squirtHits: 0,
  flashlightRepels: 0,
  jumpscares: 0,
  lastDistance: 99
};

const input = {
  moveX: 0,
  moveY: 0,
  lookX: 0,
  lookY: 0,
  testMoveX: 0,
  testMoveY: 0,
  testLookX: 0,
  testLookY: 0,
  testUntil: 0,
  keys: new Set(),
  flashlightOn: true,
  sprayCooldown: 0,
  joystickPointer: null,
  lookPointer: null,
  lookLast: { x: 0, y: 0 }
};

const runtime = {
  state: 'idle',
  time: 0,
  messageTimer: 0,
  message: '',
  collectedKeys: [],
  sprayParticles: [],
  fps: 60,
  fpsTimer: 0,
  fpsFrames: 0,
  scoreEvents: {
    keyPickups: 0,
    exitUnlocked: false,
    won: false,
    dogRepelled: false,
    jumpscareSeen: false,
    mobileInputSeen: false
  }
};

const keys = [];
let exitDoor = null;
let exitLight = null;

buildWorld();
createExit();
createKeys();
createDog();
resetGame(false);
attachControls();
animate();

function createLevelGrid() {
  const level = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => '.'));

  for (let r = 0; r < ROWS; r += 1) {
    level[r][0] = '#';
    level[r][COLS - 1] = '#';
  }
  for (let c = 0; c < COLS; c += 1) {
    level[0][c] = '#';
    level[ROWS - 1][c] = '#';
  }

  const wallV = (c, r1, r2, openings = []) => {
    for (let r = r1; r <= r2; r += 1) {
      if (!openings.includes(r)) level[r][c] = '#';
    }
  };
  const wallH = (r, c1, c2, openings = []) => {
    for (let c = c1; c <= c2; c += 1) {
      if (!openings.includes(c)) level[r][c] = '#';
    }
  };

  wallV(6, 1, 15, [4, 10, 14]);
  wallV(13, 1, 15, [5, 11, 15]);
  wallV(19, 3, 15, [8, 13]);
  wallH(5, 1, 23, [3, 10, 16, 22]);
  wallH(10, 1, 23, [4, 8, 15, 22]);
  wallH(13, 6, 23, [11, 18, 21]);
  wallV(3, 10, 15, [12]);
  wallV(22, 5, 12, [7, 10]);

  const carveH = (r, c1, c2) => {
    for (let c = c1; c <= c2; c += 1) level[r][c] = '.';
  };
  const carveV = (c, r1, r2) => {
    for (let r = r1; r <= r2; r += 1) level[r][c] = '.';
  };
  carveH(8, 3, 21);
  carveV(21, 8, 14);

  const alwaysOpen = [startCell, exitCell, dogStartCell, ...keyCells];
  for (const cell of alwaysOpen) level[cell.r][cell.c] = '.';
  return level;
}

function buildWorld() {
  const floorTexture = materials.floor.map;
  floorTexture.repeat.set(COLS / 2.2, ROWS / 2.2);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(COLS * CELL, ROWS * CELL, COLS, ROWS),
    materials.floor
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(COLS * CELL, ROWS * CELL),
    materials.ceiling
  );
  ceiling.position.y = WALL_HEIGHT;
  ceiling.rotation.x = Math.PI / 2;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  const wallCount = grid.flat().filter((cell) => cell === '#').length;
  const wallGeometry = new THREE.BoxGeometry(CELL, WALL_HEIGHT, CELL);
  const wallMesh = new THREE.InstancedMesh(wallGeometry, materials.wall, wallCount);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  let index = 0;

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      if (grid[r][c] !== '#') continue;
      const worldPos = cellToWorld(c, r);
      matrix.compose(
        new THREE.Vector3(worldPos.x, WALL_HEIGHT / 2, worldPos.z),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 1 + rng() * 0.04, 1)
      );
      wallMesh.setMatrixAt(index, matrix);
      solidCells.add(`${c},${r}`);
      world.walls.push({
        c,
        r,
        minX: worldPos.x - CELL / 2,
        maxX: worldPos.x + CELL / 2,
        minZ: worldPos.z - CELL / 2,
        maxZ: worldPos.z + CELL / 2
      });
      index += 1;
    }
  }
  wallMesh.instanceMatrix.needsUpdate = true;
  wallGroup.add(wallMesh);

  addRoomLights();
  addDoorFramesAndTrim();
  addPropsAndDebris();
}

function createMaterials() {
  const wallTexture = makeConcreteTexture(512);
  const floorTexture = makeFloorTexture(512);
  const ceilingTexture = makeCeilingTexture(512);

  for (const texture of [wallTexture, floorTexture, ceilingTexture]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  return {
    wall: new THREE.MeshStandardMaterial({
      map: wallTexture,
      color: 0x828272,
      roughness: 0.94,
      metalness: 0.02,
      bumpMap: wallTexture,
      bumpScale: 0.06
    }),
    floor: new THREE.MeshStandardMaterial({
      map: floorTexture,
      color: 0x6c7167,
      roughness: 0.88,
      metalness: 0.08,
      bumpMap: floorTexture,
      bumpScale: 0.04
    }),
    ceiling: new THREE.MeshStandardMaterial({
      map: ceilingTexture,
      color: 0x353735,
      roughness: 0.98,
      metalness: 0.01
    }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2f332d, roughness: 0.72, metalness: 0.28 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd8b853, roughness: 0.32, metalness: 0.85, emissive: 0x3a2505, emissiveIntensity: 0.22 }),
    exit: new THREE.MeshStandardMaterial({ color: 0x283226, roughness: 0.7, metalness: 0.1 }),
    exitUnlocked: new THREE.MeshStandardMaterial({ color: 0x516b46, roughness: 0.55, metalness: 0.14, emissive: 0x243f1b, emissiveIntensity: 0.35 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x181c1e, roughness: 0.52, metalness: 0.78 }),
    crate: new THREE.MeshStandardMaterial({ color: 0x66513b, roughness: 0.86, metalness: 0.02 }),
    wet: new THREE.MeshStandardMaterial({ color: 0x1a2526, roughness: 0.38, metalness: 0.05, transparent: true, opacity: 0.62 }),
    fur: new THREE.MeshStandardMaterial({ color: 0x6d3d20, roughness: 0.96, metalness: 0.0 }),
    furLight: new THREE.MeshStandardMaterial({ color: 0xc0844a, roughness: 0.92, metalness: 0.0 }),
    muzzle: new THREE.MeshStandardMaterial({ color: 0xd3a06d, roughness: 0.9, metalness: 0.0 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x0d0704, roughness: 0.36, metalness: 0.0, emissive: 0xffc36b, emissiveIntensity: 0.08 }),
    water: new THREE.MeshStandardMaterial({ color: 0x9be8ff, roughness: 0.2, metalness: 0.0, transparent: true, opacity: 0.68, emissive: 0x17485a, emissiveIntensity: 0.3 })
  };
}

function makeConcreteTexture(size) {
  return makeTexture(size, (ctx, s, random) => {
    const grad = ctx.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, '#87887c');
    grad.addColorStop(1, '#4d524d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    for (let i = 0; i < 5200; i += 1) {
      const v = Math.floor(55 + random() * 120);
      ctx.fillStyle = `rgba(${v},${v},${v - 8},${0.035 + random() * 0.05})`;
      ctx.fillRect(random() * s, random() * s, 1 + random() * 2, 1 + random() * 2);
    }
    for (let i = 0; i < 34; i += 1) {
      ctx.strokeStyle = `rgba(25, 28, 24, ${0.18 + random() * 0.22})`;
      ctx.lineWidth = 1 + random() * 2.5;
      ctx.beginPath();
      let x = random() * s;
      let y = random() * s;
      ctx.moveTo(x, y);
      for (let j = 0; j < 5; j += 1) {
        x += (random() - 0.5) * 80;
        y += (random() - 0.5) * 80;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 20; i += 1) {
      const x = random() * s;
      const y = random() * s;
      const radius = 20 + random() * 80;
      const stain = ctx.createRadialGradient(x, y, 0, x, y, radius);
      stain.addColorStop(0, `rgba(18, 27, 18, ${0.2 + random() * 0.2})`);
      stain.addColorStop(1, 'rgba(18, 27, 18, 0)');
      ctx.fillStyle = stain;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  });
}

function makeFloorTexture(size) {
  return makeTexture(size, (ctx, s, random) => {
    ctx.fillStyle = '#5d625b';
    ctx.fillRect(0, 0, s, s);
    const tile = s / 4;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const shade = 70 + Math.floor(random() * 42);
        ctx.fillStyle = `rgb(${shade},${shade + 6},${shade})`;
        ctx.fillRect(x * tile + 2, y * tile + 2, tile - 4, tile - 4);
        ctx.fillStyle = `rgba(8, 13, 12, ${0.05 + random() * 0.16})`;
        ctx.fillRect(x * tile + random() * 42, y * tile + random() * 42, 10 + random() * 80, 5 + random() * 28);
      }
    }
    ctx.strokeStyle = 'rgba(20, 24, 21, 0.65)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * tile, 0);
      ctx.lineTo(i * tile, s);
      ctx.moveTo(0, i * tile);
      ctx.lineTo(s, i * tile);
      ctx.stroke();
    }
    for (let i = 0; i < 1000; i += 1) {
      const v = Math.floor(50 + random() * 90);
      ctx.fillStyle = `rgba(${v},${v},${v},${0.04 + random() * 0.08})`;
      ctx.fillRect(random() * s, random() * s, 1 + random() * 2, 1 + random() * 2);
    }
  });
}

function makeCeilingTexture(size) {
  return makeTexture(size, (ctx, s, random) => {
    ctx.fillStyle = '#303331';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2400; i += 1) {
      const v = Math.floor(28 + random() * 55);
      ctx.fillStyle = `rgba(${v},${v + 2},${v},${0.08 + random() * 0.09})`;
      ctx.fillRect(random() * s, random() * s, 1 + random() * 3, 1 + random() * 3);
    }
    for (let i = 0; i < 18; i += 1) {
      ctx.fillStyle = `rgba(0, 0, 0, ${0.18 + random() * 0.24})`;
      ctx.fillRect(random() * s, random() * s, 20 + random() * 90, 4 + random() * 14);
    }
  });
}

function makeTexture(size, draw) {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = size;
  textureCanvas.height = size;
  const ctx = textureCanvas.getContext('2d');
  draw(ctx, size, mulberry32(size * 17 + 53));
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.needsUpdate = true;
  return texture;
}

function addRoomLights() {
  const lightCells = [
    { c: 3, r: 2, color: 0xffe8ba, intensity: 0.34 },
    { c: 10, r: 3, color: 0xbfe6ff, intensity: 0.26 },
    { c: 16, r: 7, color: 0xffd7a1, intensity: 0.21 },
    { c: 4, r: 12, color: 0xb8ffd1, intensity: 0.19 },
    { c: 21, r: 14, color: 0xffe3ae, intensity: 0.3 },
    { c: 22, r: 1, color: 0xdbffc9, intensity: 0.42 }
  ];
  const fixtureGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.08, 20);

  for (const spec of lightCells) {
    const pos = cellToWorld(spec.c, spec.r);
    const fixture = new THREE.Mesh(fixtureGeometry, materials.darkMetal);
    fixture.position.set(pos.x, WALL_HEIGHT - 0.08, pos.z);
    fixture.castShadow = true;
    propGroup.add(fixture);

    const light = new THREE.PointLight(spec.color, spec.intensity, 11, 1.6);
    light.position.set(pos.x, WALL_HEIGHT - 0.3, pos.z);
    light.castShadow = !isMobileLike && spec.intensity > 0.28;
    light.userData.baseIntensity = spec.intensity;
    light.userData.flicker = rng() * 20;
    propGroup.add(light);
    world.props.push(light);
  }
}

function addDoorFramesAndTrim() {
  const frameMaterial = materials.trim;
  const beamGeometry = new THREE.BoxGeometry(CELL * 0.88, 0.14, 0.12);
  const sideGeometry = new THREE.BoxGeometry(0.12, 1.85, 0.12);
  const frameCells = [
    { c: 6, r: 4, axis: 'z' },
    { c: 6, r: 10, axis: 'z' },
    { c: 13, r: 5, axis: 'z' },
    { c: 13, r: 11, axis: 'z' },
    { c: 19, r: 8, axis: 'z' },
    { c: 3, r: 5, axis: 'x' },
    { c: 10, r: 5, axis: 'x' },
    { c: 15, r: 10, axis: 'x' },
    { c: 18, r: 13, axis: 'x' }
  ];

  for (const frame of frameCells) {
    const pos = cellToWorld(frame.c, frame.r);
    const top = new THREE.Mesh(beamGeometry, frameMaterial);
    top.position.set(pos.x, 2.12, pos.z);
    if (frame.axis === 'x') top.rotation.y = Math.PI / 2;
    top.castShadow = true;
    propGroup.add(top);

    const offset = frame.axis === 'x'
      ? [new THREE.Vector3(0, 0, -CELL * 0.42), new THREE.Vector3(0, 0, CELL * 0.42)]
      : [new THREE.Vector3(-CELL * 0.42, 0, 0), new THREE.Vector3(CELL * 0.42, 0, 0)];
    for (const sideOffset of offset) {
      const side = new THREE.Mesh(sideGeometry, frameMaterial);
      side.position.set(pos.x + sideOffset.x, 1.02, pos.z + sideOffset.z);
      side.castShadow = true;
      propGroup.add(side);
    }
  }
}

function addPropsAndDebris() {
  const crateGeometry = new THREE.BoxGeometry(0.85, 0.65, 0.85);
  const pipeGeometry = new THREE.CylinderGeometry(0.06, 0.06, 1.4, 12);
  const puddleGeometry = new THREE.CircleGeometry(0.7, 24);
  const posterTexture = makePosterTexture(256);
  const posterMaterial = new THREE.MeshBasicMaterial({ map: posterTexture, transparent: true, opacity: 0.78 });

  for (let r = 1; r < ROWS - 1; r += 1) {
    for (let c = 1; c < COLS - 1; c += 1) {
      if (!isWalkableCell(c, r)) continue;
      if (nearSpecialCell(c, r)) continue;
      const roll = rng();
      const pos = cellToWorld(c, r);

      if (roll < 0.055) {
        const crate = new THREE.Mesh(crateGeometry, materials.crate);
        crate.position.set(pos.x + (rng() - 0.5) * 1.2, 0.33, pos.z + (rng() - 0.5) * 1.2);
        crate.rotation.y = rng() * Math.PI;
        crate.scale.setScalar(0.75 + rng() * 0.7);
        crate.castShadow = true;
        crate.receiveShadow = true;
        propGroup.add(crate);
      } else if (roll < 0.095) {
        const pipe = new THREE.Mesh(pipeGeometry, materials.darkMetal);
        pipe.position.set(pos.x + (rng() - 0.5) * 1.4, 0.11, pos.z + (rng() - 0.5) * 1.4);
        pipe.rotation.z = Math.PI / 2;
        pipe.rotation.y = rng() * Math.PI;
        pipe.castShadow = true;
        propGroup.add(pipe);
      } else if (roll < 0.135) {
        const puddle = new THREE.Mesh(puddleGeometry, materials.wet);
        puddle.position.set(pos.x + (rng() - 0.5) * 1.3, 0.012, pos.z + (rng() - 0.5) * 1.3);
        puddle.rotation.x = -Math.PI / 2;
        puddle.scale.set(0.7 + rng() * 1.4, 0.34 + rng() * 0.7, 1);
        propGroup.add(puddle);
      }
    }
  }

  const posterCells = [
    { c: 2, r: 4, rot: 0 },
    { c: 11, r: 1, rot: Math.PI },
    { c: 18, r: 9, rot: -Math.PI / 2 },
    { c: 8, r: 15, rot: Math.PI }
  ];
  for (const poster of posterCells) {
    const pos = cellToWorld(poster.c, poster.r);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.45), posterMaterial);
    mesh.position.set(pos.x, 1.72, pos.z);
    mesh.rotation.y = poster.rot;
    mesh.translateZ(-CELL * 0.48);
    propGroup.add(mesh);
  }
}

function makePosterTexture(size) {
  return makeTexture(size, (ctx, s, random) => {
    ctx.fillStyle = 'rgba(210, 198, 152, 0.86)';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(38, 49, 40, 0.75)';
    ctx.fillRect(22, 24, s - 44, 28);
    ctx.fillRect(22, 73, s - 70, 9);
    ctx.fillRect(22, 96, s - 54, 9);
    ctx.fillStyle = 'rgba(76, 26, 20, 0.42)';
    for (let i = 0; i < 18; i += 1) {
      ctx.beginPath();
      ctx.arc(random() * s, random() * s, 5 + random() * 34, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function nearSpecialCell(c, r) {
  return [startCell, exitCell, dogStartCell, ...keyCells].some((cell) => Math.abs(cell.c - c) <= 1 && Math.abs(cell.r - r) <= 1);
}

function createExit() {
  const pos = cellToWorld(exitCell.c, exitCell.r);
  const door = new THREE.Group();
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.65, 2.6, 0.22), materials.exit);
  panel.position.set(0, 1.3, -1.05);
  panel.castShadow = true;
  panel.receiveShadow = true;
  door.add(panel);

  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), materials.brass);
  handle.position.set(-0.52, 1.22, -0.91);
  handle.castShadow = true;
  door.add(handle);

  const signTexture = makeExitSignTexture(256);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.25, 0.44),
    new THREE.MeshBasicMaterial({ map: signTexture, transparent: true })
  );
  sign.position.set(0, 2.82, -0.88);
  door.add(sign);

  exitLight = new THREE.PointLight(0xbaff8f, 0.45, 5.5, 1.2);
  exitLight.position.set(0, 2.62, -0.7);
  door.add(exitLight);

  door.position.set(pos.x, 0, pos.z);
  door.rotation.y = Math.PI / 2;
  exitDoor = door;
  scene.add(door);
}

function makeExitSignTexture(size) {
  return makeTexture(size, (ctx, s) => {
    ctx.fillStyle = '#18261d';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#bdf2a6';
    ctx.fillRect(8, 8, s - 16, s - 16);
    ctx.fillStyle = '#163018';
    ctx.font = 'bold 96px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EXIT', s / 2, s / 2 + 6);
  });
}

function createKeys() {
  for (let i = 0; i < keyCells.length; i += 1) {
    const cell = keyCells[i];
    const pos = cellToWorld(cell.c, cell.r);
    const key = createKeyMesh();
    key.position.set(pos.x, 0.9, pos.z);
    key.userData = { collected: false, index: i, baseY: 0.9, cell };
    keyGroup.add(key);
    keys.push(key);
  }
}

function createKeyMesh() {
  const key = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.034, 12, 34), materials.brass);
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = true;
  key.add(ring);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 14), materials.brass);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = 0.33;
  shaft.castShadow = true;
  key.add(shaft);

  const toothA = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.06), materials.brass);
  toothA.position.set(0.6, -0.1, 0);
  toothA.castShadow = true;
  key.add(toothA);

  const toothB = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.06), materials.brass);
  toothB.position.set(0.49, -0.2, 0);
  toothB.castShadow = true;
  key.add(toothB);

  const glow = new THREE.PointLight(0xffda6d, 0.32, 4.2, 2);
  key.add(glow);
  return key;
}

function createDog() {
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 30, 18), materials.fur);
  body.scale.set(1.18, 0.55, 0.72);
  body.position.set(0, 0.43, 0);
  body.castShadow = true;
  dogGroup.add(body);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.38, 24, 16), materials.furLight);
  chest.scale.set(0.8, 0.72, 0.68);
  chest.position.set(0, 0.45, -0.48);
  chest.castShadow = true;
  dogGroup.add(chest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 30, 18), materials.fur);
  head.scale.set(1.02, 0.92, 0.95);
  head.position.set(0, 0.88, -0.55);
  head.castShadow = true;
  dogGroup.add(head);

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 12), materials.muzzle);
  muzzle.scale.set(0.85, 0.6, 1.1);
  muzzle.position.set(0, 0.8, -0.9);
  muzzle.castShadow = true;
  dogGroup.add(muzzle);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 10), materials.eye);
  nose.position.set(0, 0.83, -1.08);
  dogGroup.add(nose);

  const earGeometry = new THREE.ConeGeometry(0.16, 0.38, 18);
  const leftEar = new THREE.Mesh(earGeometry, materials.fur);
  leftEar.position.set(-0.23, 1.15, -0.54);
  leftEar.rotation.set(0.2, 0.4, 0.3);
  leftEar.castShadow = true;
  dogGroup.add(leftEar);
  const rightEar = leftEar.clone();
  rightEar.position.x = 0.23;
  rightEar.rotation.z = -0.3;
  dogGroup.add(rightEar);

  const eyeGeometry = new THREE.SphereGeometry(0.045, 12, 8);
  for (const x of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(eyeGeometry, materials.eye);
    eye.position.set(x, 0.94, -0.88);
    dogGroup.add(eye);
  }

  const legGeometry = new THREE.CapsuleGeometry(0.07, 0.35, 6, 10);
  for (const x of [-0.33, 0.33]) {
    for (const z of [-0.28, 0.34]) {
      const leg = new THREE.Mesh(legGeometry, materials.fur);
      leg.position.set(x, 0.2, z);
      leg.castShadow = true;
      dogGroup.add(leg);
    }
  }

  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.055, 12, 24, Math.PI * 1.45), materials.furLight);
  tail.position.set(0, 0.72, 0.55);
  tail.rotation.set(0.7, 0, Math.PI / 2);
  tail.castShadow = true;
  dogGroup.add(tail);

  const tuftGeometry = new THREE.ConeGeometry(0.045, 0.18, 7);
  for (let i = 0; i < 58; i += 1) {
    const tuft = new THREE.Mesh(tuftGeometry, i % 3 === 0 ? materials.furLight : materials.fur);
    const angle = rng() * Math.PI * 2;
    const radius = 0.34 + rng() * 0.22;
    const y = 0.38 + rng() * 0.48;
    tuft.position.set(Math.cos(angle) * radius * 0.9, y, Math.sin(angle) * radius * 0.6);
    tuft.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    tuft.castShadow = true;
    dogGroup.add(tuft);
  }

  const dogEyeLight = new THREE.PointLight(0xffb36b, 0.22, 2.1, 1.9);
  dogEyeLight.position.set(0, 0.92, -0.82);
  dogGroup.add(dogEyeLight);
}

function createFlashlightVolume() {
  const length = 9;
  const coneGeometry = new THREE.ConeGeometry(2.2, length, 32, 1, true);
  coneGeometry.translate(0, -length / 2, 0);
  const coneMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff0c8,
    transparent: true,
    opacity: 0.045,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    wireframe: true
  });
  const cone = new THREE.Mesh(coneGeometry, coneMaterial);
  cone.visible = true;
  return cone;
}

function attachControls() {
  startButton.addEventListener('click', () => startGame());
  restartButton.addEventListener('click', () => resetGame(true));

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    input.keys.add(event.code);
    if (event.code === 'KeyF') toggleFlashlight();
    if (event.code === 'Space') fireSquirt();
  });
  window.addEventListener('keyup', (event) => input.keys.delete(event.code));

  canvas.addEventListener('click', () => {
    if (runtime.state === 'playing' && !isMobileLike && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock?.();
    }
  });

  document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement !== canvas || runtime.state !== 'playing') return;
    input.lookX += event.movementX;
    input.lookY += event.movementY;
  });

  touchLayer.addEventListener('pointerdown', onTouchPointerDown);
  touchLayer.addEventListener('pointermove', onTouchPointerMove);
  touchLayer.addEventListener('pointerup', onTouchPointerUp);
  touchLayer.addEventListener('pointercancel', onTouchPointerUp);

  sprayButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    runtime.scoreEvents.mobileInputSeen = true;
    fireSquirt();
  });
  flashlightButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    runtime.scoreEvents.mobileInputSeen = true;
    toggleFlashlight();
  });

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
}

function onTouchPointerDown(event) {
  if (event.target.closest('button')) return;
  if (runtime.state !== 'playing') return;
  event.preventDefault();
  runtime.scoreEvents.mobileInputSeen = true;

  if (event.clientX < window.innerWidth * 0.48 && input.joystickPointer === null) {
    input.joystickPointer = event.pointerId;
    safePointerCapture(event.pointerId);
    updateJoystick(event);
  } else if (input.lookPointer === null) {
    input.lookPointer = event.pointerId;
    input.lookLast.x = event.clientX;
    input.lookLast.y = event.clientY;
    safePointerCapture(event.pointerId);
  }
}

function safePointerCapture(pointerId) {
  try {
    touchLayer.setPointerCapture?.(pointerId);
  } catch {
    // Synthetic test events and a few browser edge cases can lack an active pointer.
  }
}

function onTouchPointerMove(event) {
  if (runtime.state !== 'playing') return;
  if (event.pointerId === input.joystickPointer) {
    event.preventDefault();
    updateJoystick(event);
  } else if (event.pointerId === input.lookPointer) {
    event.preventDefault();
    input.lookX += event.clientX - input.lookLast.x;
    input.lookY += event.clientY - input.lookLast.y;
    input.lookLast.x = event.clientX;
    input.lookLast.y = event.clientY;
  }
}

function onTouchPointerUp(event) {
  if (event.pointerId === input.joystickPointer) {
    input.joystickPointer = null;
    input.moveX = 0;
    input.moveY = 0;
    joystickKnob.style.transform = 'translate(-50%, -50%)';
  }
  if (event.pointerId === input.lookPointer) {
    input.lookPointer = null;
  }
}

function updateJoystick(event) {
  const rect = joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const max = rect.width * 0.34;
  const dx = clamp(event.clientX - cx, -max, max);
  const dy = clamp(event.clientY - cy, -max, max);
  const length = Math.hypot(dx, dy);
  const scale = length > max ? max / length : 1;
  const sx = dx * scale;
  const sy = dy * scale;
  input.moveX = sx / max;
  input.moveY = -sy / max;
  joystickKnob.style.transform = `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px))`;
}

function startGame() {
  if (runtime.state === 'playing') return;
  audio.unlock();
  startScreen.classList.add('hidden');
  resultScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  touchLayer.classList.remove('hidden');
  runtime.state = 'playing';
  showMessage('The lock needs three keys.', 2.8);
}

function resetGame(showStart) {
  for (const particle of runtime.sprayParticles) {
    sprayGroup.remove(particle);
    particle.geometry.dispose();
  }

  player.pos.copy(cellToWorldVector(startCell.c, startCell.r, PLAYER_HEIGHT));
  player.yaw = -Math.PI / 2;
  player.pitch = 0;
  player.fear = 0;
  player.keys = 0;
  player.bob = 0;
  player.shake = 0;
  player.lastSafe.copy(player.pos);

  dog.pos.copy(cellToWorldVector(dogStartCell.c, dogStartCell.r, 0));
  dog.vel.set(0, 0, 0);
  dog.path = [];
  dog.pathTimer = 0;
  dog.stun = 0;
  dog.retreat = 0;
  dog.barkTimer = 1.2;
  dog.growlTimer = 0;
  dog.biteCooldown = 0;
  dog.flashlightExposure = 0;
  dog.squirtHits = 0;
  dog.flashlightRepels = 0;
  dog.jumpscares = 0;
  dog.lastDistance = 99;
  dogGroup.position.copy(dog.pos);

  runtime.time = 0;
  runtime.messageTimer = 0;
  runtime.message = '';
  runtime.collectedKeys = [];
  runtime.sprayParticles = [];
  runtime.scoreEvents = {
    keyPickups: 0,
    exitUnlocked: false,
    won: false,
    dogRepelled: false,
    jumpscareSeen: false,
    mobileInputSeen: false
  };

  input.flashlightOn = true;
  input.sprayCooldown = 0;
  input.moveX = 0;
  input.moveY = 0;
  input.lookX = 0;
  input.lookY = 0;
  input.testMoveX = 0;
  input.testMoveY = 0;
  input.testLookX = 0;
  input.testLookY = 0;
  input.testUntil = 0;
  input.joystickPointer = null;
  input.lookPointer = null;
  input.keys.clear();
  joystickKnob.style.transform = 'translate(-50%, -50%)';
  sprayButton.disabled = false;
  sprayButton.style.opacity = '1';
  jumpscare.classList.remove('active');
  bloodFlash.classList.remove('active');
  flashlightButton.classList.add('active');

  for (const key of keys) {
    key.visible = true;
    key.userData.collected = false;
  }

  updateExitState();
  updateHud();
  if (showStart) {
    startScreen.classList.remove('hidden');
    resultScreen.classList.add('hidden');
    hud.classList.add('hidden');
    touchLayer.classList.add('hidden');
    runtime.state = 'idle';
  } else {
    runtime.state = 'idle';
  }
}

function finishGame(win) {
  if (runtime.state === 'won' || runtime.state === 'lost') return;
  runtime.state = win ? 'won' : 'lost';
  runtime.scoreEvents.won = win;
  resultKicker.textContent = win ? 'Escaped' : 'Caught';
  resultTitle.textContent = win ? 'You made it out.' : 'Nighttail found you.';
  resultCopy.textContent = win ? 'The exit clicks open behind you.' : 'The little growl is the last thing in the hall.';
  resultScreen.classList.remove('hidden');
  touchLayer.classList.add('hidden');
  if (win) audio.win();
}

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastFrameTime) / 1000, 0.04);
  lastFrameTime = now;
  runtime.time += dt;
  updateFps(dt);
  update(dt);
  if (composer) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

function update(dt) {
  animateScene(dt);

  if (runtime.state === 'playing') {
    applyLook(dt);
    movePlayer(dt);
    updateKeys(dt);
  }
  if (runtime.state === 'playing') {
    updateDog(dt);
  }
  if (runtime.state === 'playing') {
    updateSpray(dt);
  }
  if (runtime.state === 'playing') {
    updateExit(dt);
  }
  if (runtime.state === 'playing') {
    updateHud(dt);
  }

  updateCamera(dt);
  updateFlashlight();
}

function applyLook() {
  const lookX = input.lookX + input.testLookX;
  const lookY = input.lookY + input.testLookY;
  player.yaw -= lookX * LOOK_SENS;
  player.pitch -= lookY * LOOK_SENS;
  player.pitch = clamp(player.pitch, -1.18, 1.05);
  input.lookX = 0;
  input.lookY = 0;
  input.testLookX = 0;
  input.testLookY = 0;
}

function movePlayer(dt) {
  const keyMove = getKeyboardMove();
  const testActive = runtime.time <= input.testUntil;
  if (!testActive) {
    input.testMoveX = 0;
    input.testMoveY = 0;
  }
  let moveX = clamp(input.moveX + (testActive ? input.testMoveX : 0) + keyMove.x, -1, 1);
  let moveY = clamp(input.moveY + (testActive ? input.testMoveY : 0) + keyMove.y, -1, 1);
  const magnitude = Math.hypot(moveX, moveY);
  if (magnitude > 1) {
    moveX /= magnitude;
    moveY /= magnitude;
  }

  const forward = getFlatForward();
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const move = new THREE.Vector3()
    .addScaledVector(forward, moveY)
    .addScaledVector(right, moveX);

  if (move.lengthSq() > 0.0001) {
    move.normalize();
    const fearDrag = 1 - Math.min(player.fear, 70) * 0.0025;
    const distance = MOVE_SPEED * fearDrag * dt;
    tryMove(move.x * distance, move.z * distance);
    player.bob += dt * 9.2;
    player.lastSafe.copy(player.pos);
  } else {
    player.bob += dt * 2.4;
  }

  player.fear = Math.max(0, player.fear - dt * 2.4);
}

function getKeyboardMove() {
  let x = 0;
  let y = 0;
  if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) y += 1;
  if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) y -= 1;
  if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) x -= 1;
  if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) x += 1;
  return { x, y };
}

function tryMove(dx, dz) {
  const nextX = player.pos.x + dx;
  if (!collides(nextX, player.pos.z, PLAYER_RADIUS)) player.pos.x = nextX;
  const nextZ = player.pos.z + dz;
  if (!collides(player.pos.x, nextZ, PLAYER_RADIUS)) player.pos.z = nextZ;
}

function updateCamera(dt) {
  const walkBob = runtime.state === 'playing' ? Math.sin(player.bob) * 0.024 : 0;
  player.shake = Math.max(0, player.shake - dt * 3.2);
  const shakeX = (rng() - 0.5) * player.shake * 0.06;
  const shakeY = (rng() - 0.5) * player.shake * 0.06;
  camera.position.set(player.pos.x, PLAYER_HEIGHT + walkBob + shakeY, player.pos.z);
  camera.rotation.set(player.pitch + shakeX, player.yaw + shakeY * 0.4, 0);
}

function updateFlashlight() {
  flashlight.visible = input.flashlightOn;
  flashlightSpill.visible = input.flashlightOn;
  const showVolume = input.flashlightOn && !isMobileLike && window.innerWidth > 700;
  flashlightVolume.visible = showVolume;
  flashlightButton.classList.toggle('active', input.flashlightOn);

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  flashlight.position.copy(camera.position);
  flashlightSpill.position.copy(camera.position);
  flashlight.target.position.copy(camera.position).addScaledVector(forward, 12);

  flashlightVolume.position.copy(camera.position).addScaledVector(forward, 0.15);
  flashlightVolume.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), forward.clone().normalize());
  const flicker = 0.92 + Math.sin(runtime.time * 17.3) * 0.035 + Math.sin(runtime.time * 41.7) * 0.02;
  flashlight.intensity = input.flashlightOn ? 78 * flicker : 0;
  flashlightSpill.intensity = input.flashlightOn ? 0.72 * flicker : 0;
  flashlightVolume.material.opacity = showVolume ? 0.04 + Math.sin(runtime.time * 15) * 0.008 : 0;
}

function updateKeys(dt) {
  for (const key of keys) {
    if (key.userData.collected) continue;
    key.rotation.y += dt * 1.6;
    key.position.y = key.userData.baseY + Math.sin(runtime.time * 2.6 + key.userData.index) * 0.08;
    const dist = flatDistance(player.pos, key.position);
    if (dist < 1.2) {
      key.userData.collected = true;
      key.visible = false;
      player.keys += 1;
      runtime.collectedKeys.push(key.userData.index);
      runtime.scoreEvents.keyPickups += 1;
      audio.pickup();
      showMessage(`Key ${player.keys}/${KEY_TOTAL}`, 1.6);
      updateExitState();
    }
  }
}

function updateExit(dt) {
  if (player.keys >= KEY_TOTAL) {
    exitDoor.rotation.y = lerp(exitDoor.rotation.y, Math.PI / 2 - 0.85, dt * 1.8);
    if (!runtime.scoreEvents.exitUnlocked) {
      runtime.scoreEvents.exitUnlocked = true;
      showMessage('The exit is open.', 2.2);
    }
  }

  const exitPos = cellToWorldVector(exitCell.c, exitCell.r, 0);
  if (flatDistance(player.pos, exitPos) < 2.35) {
    if (player.keys >= KEY_TOTAL) {
      finishGame(true);
    } else if (runtime.messageTimer <= 0) {
      showMessage('Still locked.', 1.6);
      player.fear = Math.min(100, player.fear + 5);
      audio.locked();
    }
  }
}

function updateExitState() {
  if (!exitDoor) return;
  const unlocked = player.keys >= KEY_TOTAL;
  exitDoor.children[0].material = unlocked ? materials.exitUnlocked : materials.exit;
  if (exitLight) exitLight.intensity = unlocked ? 0.85 : 0.45;
}

function updateDog(dt) {
  dog.stun = Math.max(0, dog.stun - dt);
  dog.retreat = Math.max(0, dog.retreat - dt);
  dog.biteCooldown = Math.max(0, dog.biteCooldown - dt);
  dog.pathTimer -= dt;

  const playerFlat = new THREE.Vector3(player.pos.x, 0, player.pos.z);
  dog.lastDistance = dog.pos.distanceTo(playerFlat);
  const playerVisible = input.flashlightOn && dog.lastDistance < 9.5 && targetInLightCone(dog.pos, 0.71) && hasLineOfSight(player.pos, dog.pos);

  if (playerVisible) {
    dog.flashlightExposure += dt;
    dog.retreat = Math.max(dog.retreat, 0.22);
    player.fear = Math.max(0, player.fear - dt * 7);
    if (dog.flashlightExposure > 0.42) {
      dog.flashlightExposure = 0;
      dog.flashlightRepels += 1;
      runtime.scoreEvents.dogRepelled = true;
      showMessage('It backs into the dark.', 1.1);
    }
  } else {
    dog.flashlightExposure = Math.max(0, dog.flashlightExposure - dt * 0.4);
  }

  let desired = new THREE.Vector3();
  const away = dog.pos.clone().sub(playerFlat).setY(0);
  if (away.lengthSq() < 0.01) away.set(1, 0, 0);

  if (dog.stun > 0 || dog.retreat > 0) {
    desired.copy(away.normalize());
  } else {
    if (dog.pathTimer <= 0) {
      dog.path = findPath(worldToCell(dog.pos.x, dog.pos.z), worldToCell(player.pos.x, player.pos.z));
      dog.pathTimer = 0.35;
    }
    const nextCell = dog.path.length > 1 ? dog.path[1] : worldToCell(player.pos.x, player.pos.z);
    const target = cellToWorldVector(nextCell.c, nextCell.r, 0);
    desired.copy(target).sub(dog.pos).setY(0);
    if (desired.lengthSq() < 0.05 && dog.path.length > 2) {
      const later = cellToWorldVector(dog.path[2].c, dog.path[2].r, 0);
      desired.copy(later).sub(dog.pos).setY(0);
    }
    if (desired.lengthSq() < 0.01) desired.copy(playerFlat).sub(dog.pos).setY(0);
  }

  if (desired.lengthSq() > 0.001) desired.normalize();

  const huntBoost = 1 + player.keys * 0.12 + player.fear * 0.004;
  const speed = dog.stun > 0 ? 0.8 : dog.retreat > 0 ? 1.45 : 1.02 * huntBoost;
  moveDog(desired.x * speed * dt, desired.z * speed * dt);

  if (desired.lengthSq() > 0.001) {
    const targetAngle = Math.atan2(desired.x, desired.z);
    dogGroup.rotation.y = lerpAngle(dogGroup.rotation.y, targetAngle, dt * 7.5);
  }

  dogGroup.position.set(dog.pos.x, 0, dog.pos.z);
  dogGroup.position.y = Math.sin(runtime.time * 8.5) * 0.018;

  updateDogAudio(dt);
  updateDogThreat(dt);
}

function moveDog(dx, dz) {
  const nextX = dog.pos.x + dx;
  if (!collides(nextX, dog.pos.z, DOG_RADIUS)) dog.pos.x = nextX;
  const nextZ = dog.pos.z + dz;
  if (!collides(dog.pos.x, nextZ, DOG_RADIUS)) dog.pos.z = nextZ;
}

function updateDogAudio(dt) {
  const distance = dog.lastDistance;
  dog.barkTimer -= dt;
  dog.growlTimer -= dt;

  if (distance < 12 && dog.growlTimer <= 0) {
    audio.growl(clamp(1 - distance / 12, 0.08, 0.9));
    dog.growlTimer = 1.4 + rng() * 1.5;
  }
  if (distance < 6.2 && dog.barkTimer <= 0) {
    audio.bark(clamp(1 - distance / 7, 0.25, 1));
    dog.barkTimer = 1.1 + rng() * 1.6;
  }
}

function updateDogThreat(dt) {
  const distance = dog.lastDistance;
  if (distance < 8 && dog.stun <= 0) {
    player.fear = Math.min(100, player.fear + dt * (8 - distance) * 0.95);
  }

  if (distance < 1.08 && dog.biteCooldown <= 0 && dog.stun <= 0) {
    dog.biteCooldown = 3.8;
    dog.jumpscares += 1;
    runtime.scoreEvents.jumpscareSeen = true;
    player.fear = Math.min(100, player.fear + 24);
    player.shake = Math.max(player.shake, 1.4);
    triggerJumpScare();
    audio.jumpscare();

    const shove = player.pos.clone().sub(dog.pos).setY(0);
    if (shove.lengthSq() > 0.001) {
      shove.normalize().multiplyScalar(0.7);
      tryMove(shove.x, shove.z);
    }
  }

  if (player.fear >= 100) {
    finishGame(false);
  }
}

function fireSquirt() {
  if (runtime.state !== 'playing' || input.sprayCooldown > 0) return;
  input.sprayCooldown = 0.72;
  player.shake = Math.max(player.shake, 0.18);
  audio.squirt();
  spawnSprayParticles();

  if (dog.lastDistance < 8.2 && targetInLightCone(dog.pos, 0.67) && hasLineOfSight(player.pos, dog.pos)) {
    dog.stun = 3.2;
    dog.retreat = 3.8;
    dog.squirtHits += 1;
    runtime.scoreEvents.dogRepelled = true;
    player.fear = Math.max(0, player.fear - 12);
    showMessage('The squirt gun buys time.', 1.4);
    audio.yelpAway();
  }
}

function spawnSprayParticles() {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const start = camera.position.clone().addScaledVector(forward, 0.45).addScaledVector(right, 0.18);
  for (let i = 0; i < 16; i += 1) {
    const particle = new THREE.Mesh(new THREE.SphereGeometry(0.035 + rng() * 0.035, 8, 6), materials.water);
    particle.position.copy(start);
    particle.userData.vel = forward.clone()
      .multiplyScalar(7.5 + rng() * 4)
      .addScaledVector(right, (rng() - 0.5) * 1.1)
      .add(new THREE.Vector3(0, (rng() - 0.2) * 0.45, 0));
    particle.userData.life = 0.42 + rng() * 0.18;
    particle.userData.maxLife = particle.userData.life;
    sprayGroup.add(particle);
    runtime.sprayParticles.push(particle);
  }
}

function updateSpray(dt) {
  input.sprayCooldown = Math.max(0, input.sprayCooldown - dt);
  sprayButton.disabled = input.sprayCooldown > 0.02;
  sprayButton.style.opacity = input.sprayCooldown > 0 ? '0.62' : '1';

  for (let i = runtime.sprayParticles.length - 1; i >= 0; i -= 1) {
    const particle = runtime.sprayParticles[i];
    particle.userData.life -= dt;
    particle.userData.vel.y -= dt * 3.6;
    particle.position.addScaledVector(particle.userData.vel, dt);
    particle.material.opacity = Math.max(0, 0.68 * (particle.userData.life / particle.userData.maxLife));
    if (particle.userData.life <= 0) {
      sprayGroup.remove(particle);
      particle.geometry.dispose();
      runtime.sprayParticles.splice(i, 1);
    }
  }
}

function triggerJumpScare() {
  jumpscare.classList.add('active');
  bloodFlash.classList.add('active');
  setTimeout(() => jumpscare.classList.remove('active'), 290);
  setTimeout(() => bloodFlash.classList.remove('active'), 180);
}

function toggleFlashlight() {
  if (runtime.state !== 'playing') return;
  input.flashlightOn = !input.flashlightOn;
  audio.click();
}

function updateHud(dt = 0) {
  fearFill.style.width = `${clamp(player.fear, 0, 100)}%`;
  keyCounter.textContent = `Keys ${player.keys}/${KEY_TOTAL}`;
  if (runtime.messageTimer > 0) {
    runtime.messageTimer -= dt;
    messageFeed.textContent = runtime.message;
  } else {
    messageFeed.textContent = '';
  }
}

function showMessage(message, seconds = 1.6) {
  runtime.message = message;
  runtime.messageTimer = seconds;
}

function animateScene(dt) {
  for (const prop of world.props) {
    if (prop.isPointLight) {
      prop.intensity = prop.userData.baseIntensity * (0.84 + Math.sin(runtime.time * 7 + prop.userData.flicker) * 0.08 + rng() * 0.06);
    }
  }
  for (let i = 0; i < dogGroup.children.length; i += 1) {
    const child = dogGroup.children[i];
    if (child.geometry?.type === 'CapsuleGeometry') {
      child.rotation.x = Math.sin(runtime.time * 7 + i) * 0.12;
    }
  }
  if (bloomPass) {
    bloomPass.strength = isMobileLike ? 0.13 + player.fear * 0.001 : 0.19 + player.fear * 0.0012;
  }
}

function updateFps(dt) {
  runtime.fpsTimer += dt;
  runtime.fpsFrames += 1;
  if (runtime.fpsTimer >= 0.5) {
    runtime.fps = Math.round(runtime.fpsFrames / runtime.fpsTimer);
    runtime.fpsTimer = 0;
    runtime.fpsFrames = 0;
  }
}

function targetInLightCone(target, minDot) {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const toTarget = new THREE.Vector3(target.x - player.pos.x, 0, target.z - player.pos.z);
  if (toTarget.lengthSq() < 0.001) return true;
  toTarget.normalize();
  return forward.dot(toTarget) > minDot;
}

function getFlatForward() {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
  return forward.normalize();
}

function hasLineOfSight(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.ceil(dist / (CELL * 0.34)));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    const cell = worldToCell(x, z);
    if (!isWalkableCell(cell.c, cell.r)) return false;
  }
  return true;
}

function collides(x, z, radius) {
  const cell = worldToCell(x, z);
  for (let r = cell.r - 1; r <= cell.r + 1; r += 1) {
    for (let c = cell.c - 1; c <= cell.c + 1; c += 1) {
      if (!solidCells.has(`${c},${r}`)) continue;
      const wall = {
        minX: (c - COLS / 2) * CELL,
        maxX: (c - COLS / 2 + 1) * CELL,
        minZ: (r - ROWS / 2) * CELL,
        maxZ: (r - ROWS / 2 + 1) * CELL
      };
      const closestX = clamp(x, wall.minX, wall.maxX);
      const closestZ = clamp(z, wall.minZ, wall.maxZ);
      if (Math.hypot(x - closestX, z - closestZ) < radius) return true;
    }
  }
  return false;
}

function findPath(start, goal) {
  if (!isWalkableCell(start.c, start.r) || !isWalkableCell(goal.c, goal.r)) return [start];
  const queue = [start];
  const cameFrom = new Map();
  const startKey = `${start.c},${start.r}`;
  cameFrom.set(startKey, null);
  const dirs = [
    { c: 1, r: 0 },
    { c: -1, r: 0 },
    { c: 0, r: 1 },
    { c: 0, r: -1 }
  ];

  while (queue.length) {
    const current = queue.shift();
    if (current.c === goal.c && current.r === goal.r) break;
    for (const dir of dirs) {
      const next = { c: current.c + dir.c, r: current.r + dir.r };
      const key = `${next.c},${next.r}`;
      if (cameFrom.has(key) || !isWalkableCell(next.c, next.r)) continue;
      cameFrom.set(key, current);
      queue.push(next);
    }
  }

  const goalKey = `${goal.c},${goal.r}`;
  if (!cameFrom.has(goalKey)) return [start];
  const path = [];
  let cur = goal;
  while (cur) {
    path.push(cur);
    cur = cameFrom.get(`${cur.c},${cur.r}`);
  }
  return path.reverse();
}

function isWalkableCell(c, r) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS && grid[r][c] !== '#';
}

function cellToWorld(c, r) {
  return {
    x: (c - COLS / 2) * CELL + CELL / 2,
    z: (r - ROWS / 2) * CELL + CELL / 2
  };
}

function cellToWorldVector(c, r, y = 0) {
  const pos = cellToWorld(c, r);
  return new THREE.Vector3(pos.x, y, pos.z);
}

function worldToCell(x, z) {
  return {
    c: clamp(Math.floor(x / CELL + COLS / 2), 0, COLS - 1),
    r: clamp(Math.floor(z / CELL + ROWS / 2), 0, ROWS - 1)
  };
}

function flatDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function onResize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  if (bloomPass) bloomPass.setSize(window.innerWidth, window.innerHeight);
}

function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

function lerpAngle(a, b, t) {
  const delta = normalizeAngle(b - a);
  return a + delta * clamp(t, 0, 1);
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const audio = {
  ctx: null,
  master: null,
  unlocked: false,
  unlock() {
    if (this.unlocked) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.58;
    this.master.connect(this.ctx.destination);
    this.unlocked = true;
  },
  tone(type, frequency, duration, gain = 0.14, bend = 0) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (bend) osc.frequency.exponentialRampToValueAtTime(Math.max(20, frequency + bend), now + duration);
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(gain, now + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(amp);
    amp.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  },
  noise(duration, gain = 0.08, filterFreq = 1200) {
    if (!this.ctx) return;
    const samples = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, samples, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i += 1) data[i] = Math.random() * 2 - 1;
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const amp = this.ctx.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.9;
    amp.gain.setValueAtTime(gain, this.ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(amp);
    amp.connect(this.master);
    source.start();
    source.stop(this.ctx.currentTime + duration);
  },
  growl(amount) {
    this.tone('sawtooth', 58 + amount * 26, 0.35, 0.05 + amount * 0.08, -12);
    this.noise(0.25, 0.02 + amount * 0.04, 180);
  },
  bark(amount = 1) {
    this.tone('square', 340 + amount * 90, 0.095, 0.09 + amount * 0.08, -150);
    setTimeout(() => this.tone('square', 270, 0.08, 0.06, -90), 78);
  },
  jumpscare() {
    this.noise(0.42, 0.34, 650);
    this.tone('sawtooth', 90, 0.48, 0.24, -40);
    this.bark(1);
  },
  squirt() {
    this.noise(0.18, 0.12, 1850);
  },
  yelpAway() {
    this.tone('sine', 540, 0.17, 0.08, 180);
  },
  pickup() {
    this.tone('triangle', 700, 0.12, 0.08, 260);
    setTimeout(() => this.tone('triangle', 960, 0.12, 0.06, 90), 90);
  },
  locked() {
    this.tone('square', 120, 0.14, 0.08, -30);
  },
  click() {
    this.tone('square', 920, 0.035, 0.035, -200);
  },
  win() {
    this.tone('triangle', 440, 0.18, 0.08, 220);
    setTimeout(() => this.tone('triangle', 660, 0.22, 0.08, 160), 160);
    setTimeout(() => this.tone('triangle', 980, 0.28, 0.07, 100), 340);
  }
};

window.__NIGHTTAIL_TEST__ = {
  start() {
    startGame();
  },
  reset() {
    resetGame(false);
    startGame();
  },
  setInput(next) {
    input.testMoveX = clamp(next.moveX ?? 0, -1, 1);
    input.testMoveY = clamp(next.moveY ?? 0, -1, 1);
    input.testLookX = clamp(next.lookX ?? 0, -90, 90);
    input.testLookY = clamp(next.lookY ?? 0, -60, 60);
    input.testUntil = runtime.time + clamp(next.hold ?? 0.28, 0.04, 0.5);
  },
  fire() {
    fireSquirt();
  },
  stageDogBiteTest() {
    const flatPlayer = new THREE.Vector3(player.pos.x, 0, player.pos.z);
    dog.pos.copy(flatPlayer).addScaledVector(getFlatForward(), 0.82);
    dog.vel.set(0, 0, 0);
    dog.path = [];
    dog.pathTimer = 0;
    dog.stun = 0;
    dog.retreat = 0;
    dog.biteCooldown = 0;
    dog.lastDistance = flatDistance(player.pos, dog.pos);
    dogGroup.position.copy(dog.pos);
    player.fear = Math.min(player.fear, 20);
  },
  setFlashlight(on) {
    input.flashlightOn = Boolean(on);
  },
  snapshot() {
    return {
      state: runtime.state,
      player: {
        x: player.pos.x,
        z: player.pos.z,
        yaw: player.yaw,
        pitch: player.pitch,
        fear: player.fear,
        keys: player.keys
      },
      dog: {
        x: dog.pos.x,
        z: dog.pos.z,
        distance: dog.lastDistance,
        stun: dog.stun,
        retreat: dog.retreat,
        squirtHits: dog.squirtHits,
        flashlightRepels: dog.flashlightRepels,
        jumpscares: dog.jumpscares
      },
      keys: keys.map((key) => ({
        index: key.userData.index,
        collected: key.userData.collected,
        x: key.position.x,
        z: key.position.z,
        cell: key.userData.cell
      })),
      exit: {
        x: cellToWorld(exitCell.c, exitCell.r).x,
        z: cellToWorld(exitCell.c, exitCell.r).z,
        cell: exitCell,
        unlocked: player.keys >= KEY_TOTAL
      },
      grid: grid.map((row) => row.join('')),
      cellSize: CELL,
      rows: ROWS,
      cols: COLS,
      fps: runtime.fps,
      events: { ...runtime.scoreEvents },
      mobileUi: {
        joystick: !!joystick.offsetWidth,
        sprayButton: !!sprayButton.offsetWidth,
        flashlightButton: !!flashlightButton.offsetWidth
      }
    };
  },
  cellToWorld(c, r) {
    return cellToWorld(c, r);
  },
  pathToCell(cell) {
    return findPath(worldToCell(player.pos.x, player.pos.z), cell).map((pathCell) => ({
      ...pathCell,
      ...cellToWorld(pathCell.c, pathCell.r)
    }));
  }
};

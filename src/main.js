import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const app = document.querySelector('#app');
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
const jumpscareSprite = document.querySelector('#jumpscare-sprite');
const bloodFlash = document.querySelector('#blood-flash');
const weaponView = document.querySelector('#weapon-view');
const TEST_MODE = new URLSearchParams(window.location.search).has('test')
  && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

const CELL = 3;
const ROWS = 17;
const COLS = 25;
const WALL_HEIGHT = 3.4;
const PLAYER_HEIGHT = 1.62;
const PLAYER_RADIUS = 0.42;
const MOVE_SPEED = 3.05;
const LOOK_SENS = 0.0031;
const DOG_RADIUS = 0.22;
const KEY_TOTAL = 3;
const MUTT_DAISY_WIDTH = 34;
const MUTT_DAISY_HEIGHT = 32;

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
let dogApparition = null;
renderJumpscareSprite();

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
  vanishes: 0,
  hiddenTimer: 0,
  apparitionTimer: 0,
  apparitionCooldown: 0,
  warpCooldown: 7.5,
  stareTime: 0,
  seenTimer: 0,
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
  threat: 0,
  scoreEvents: {
    keyPickups: 0,
    exitUnlocked: false,
    won: false,
    dogRepelled: false,
    dogVanished: false,
    apparitionSeen: false,
    jumpscareSeen: false,
    mobileInputSeen: false
  }
};
const effectTimers = new Set();

function scheduleEffect(callback, delay) {
  const id = window.setTimeout(() => {
    effectTimers.delete(id);
    callback();
  }, delay);
  effectTimers.add(id);
  return id;
}

function clearEffectTimers() {
  for (const id of effectTimers) window.clearTimeout(id);
  effectTimers.clear();
}

const keys = [];
let exitDoor = null;
let exitLight = null;

buildWorld();
createExit();
createKeys();
createDog();
createDogApparition();
resetGame(false);
attachControls();

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
  const wallTexture = loadAssetTexture('abandoned-wall.png');
  const floorTexture = loadAssetTexture('abandoned-floor.png');
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
    paper: new THREE.MeshStandardMaterial({ color: 0xc9c1a8, roughness: 0.93, metalness: 0.01 }),
    fabric: new THREE.MeshStandardMaterial({ color: 0x35423c, roughness: 0.97, metalness: 0.0 }),
    stain: new THREE.MeshBasicMaterial({ color: 0x190d09, transparent: true, opacity: 0.56, depthWrite: false }),
    wire: new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.55, metalness: 0.5 }),
    warning: new THREE.MeshStandardMaterial({ color: 0x7f6b24, roughness: 0.74, metalness: 0.18, emissive: 0x1d1203, emissiveIntensity: 0.12 }),
    wet: new THREE.MeshStandardMaterial({ color: 0x1a2526, roughness: 0.38, metalness: 0.05, transparent: true, opacity: 0.62 }),
    fur: new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.98, metalness: 0.0 }),
    furDark: new THREE.MeshStandardMaterial({ color: 0x2a1b12, roughness: 0.98, metalness: 0.0 }),
    furLight: new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.95, metalness: 0.0 }),
    furCoffee: new THREE.MeshStandardMaterial({ color: 0x8b6c42, roughness: 0.96, metalness: 0.0 }),
    muzzle: new THREE.MeshStandardMaterial({ color: 0xa0845c, roughness: 0.92, metalness: 0.0 }),
    tooth: new THREE.MeshStandardMaterial({ color: 0xfff1d2, roughness: 0.62, metalness: 0.0, emissive: 0x2a1809, emissiveIntensity: 0.08 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x0d0704, roughness: 0.36, metalness: 0.0, emissive: 0xffc36b, emissiveIntensity: 0.08 }),
    water: new THREE.MeshStandardMaterial({ color: 0x9be8ff, roughness: 0.2, metalness: 0.0, transparent: true, opacity: 0.68, emissive: 0x17485a, emissiveIntensity: 0.3 })
  };
}

function loadAssetTexture(filename) {
  const texture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/${filename}`);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
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

  addFixedSetDressing();
  addWallDecals();
}

function addFixedSetDressing() {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const plank = new THREE.BoxGeometry(1.65, 0.12, 0.16);
  const mattress = new THREE.BoxGeometry(1.45, 0.18, 2.1);
  const chairSeat = new THREE.BoxGeometry(0.62, 0.08, 0.58);
  const chairBack = new THREE.BoxGeometry(0.62, 0.72, 0.08);
  const leg = new THREE.CylinderGeometry(0.035, 0.035, 0.58, 8);
  const stain = new THREE.CircleGeometry(0.72, 24);

  const cabinets = [
    { c: 5, r: 2, rot: 0.1 },
    { c: 15, r: 4, rot: Math.PI * 0.52 },
    { c: 22, r: 9, rot: -0.35 }
  ];
  for (const spec of cabinets) {
    const pos = cellToWorld(spec.c, spec.r);
    addBox(box, materials.darkMetal, pos.x, 0.74, pos.z, 0.92, 1.48, 0.48, spec.rot);
    addBox(box, materials.paper, pos.x + Math.cos(spec.rot) * 0.05, 1.16, pos.z + Math.sin(spec.rot) * 0.05, 0.72, 0.06, 0.07, spec.rot);
  }

  const rooms = [
    { c: 10, r: 4, rot: -0.25 },
    { c: 4, r: 11, rot: 0.55 },
    { c: 20, r: 14, rot: -0.5 }
  ];
  for (const spec of rooms) {
    const pos = cellToWorld(spec.c, spec.r);
    addBox(mattress, materials.fabric, pos.x - 0.35, 0.13, pos.z + 0.18, 1, 1, 1, spec.rot);
    addBox(box, materials.paper, pos.x + 0.55, 0.25, pos.z - 0.55, 0.78, 0.08, 0.48, spec.rot + 0.2);
    addStain(stain, pos.x + 0.2, pos.z + 0.7, 1.1, 0.46, spec.rot + 0.1);
  }

  const chairs = [
    { c: 8, r: 8, rot: 0.8 },
    { c: 17, r: 6, rot: -0.55 },
    { c: 14, r: 12, rot: 2.2 },
    { c: 21, r: 3, rot: -1.1 }
  ];
  for (const spec of chairs) {
    const pos = cellToWorld(spec.c, spec.r);
    addBox(chairSeat, materials.crate, pos.x, 0.42, pos.z, 1, 1, 1, spec.rot);
    addBox(chairBack, materials.crate, pos.x - Math.sin(spec.rot) * 0.32, 0.78, pos.z - Math.cos(spec.rot) * 0.32, 1, 1, 1, spec.rot);
    for (const x of [-0.24, 0.24]) {
      for (const z of [-0.2, 0.2]) {
        const mesh = new THREE.Mesh(leg, materials.darkMetal);
        mesh.position.set(pos.x + Math.cos(spec.rot) * x - Math.sin(spec.rot) * z, 0.2, pos.z + Math.sin(spec.rot) * x + Math.cos(spec.rot) * z);
        mesh.rotation.z = (rng() - 0.5) * 0.22;
        mesh.castShadow = true;
        propGroup.add(mesh);
      }
    }
  }

  const boards = [
    { c: 2, r: 6, rot: 0 },
    { c: 12, r: 15, rot: Math.PI },
    { c: 19, r: 2, rot: Math.PI },
    { c: 23, r: 12, rot: -Math.PI / 2 }
  ];
  for (const spec of boards) {
    const pos = cellToWorld(spec.c, spec.r);
    for (let i = 0; i < 3; i += 1) {
      const mesh = new THREE.Mesh(plank, materials.crate);
      mesh.position.set(pos.x, 1.12 + i * 0.29, pos.z);
      mesh.rotation.y = spec.rot + (i - 1) * 0.08;
      mesh.translateZ(-CELL * 0.49);
      mesh.castShadow = true;
      propGroup.add(mesh);
    }
  }

  addHangingCable(6, 12, 9, 12);
  addHangingCable(16, 10, 16, 13);
  addHangingCable(21, 5, 23, 5);
}

function addBox(geometry, material, x, y, z, sx, sy, sz, rot = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.y = rot;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  propGroup.add(mesh);
  return mesh;
}

function addStain(geometry, x, z, sx, sy, rot) {
  const mesh = new THREE.Mesh(geometry, materials.stain);
  mesh.position.set(x, 0.018, z);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rot;
  mesh.scale.set(sx, sy, 1);
  propGroup.add(mesh);
}

function addHangingCable(c1, r1, c2, r2) {
  const a = cellToWorld(c1, r1);
  const b = cellToWorld(c2, r2);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(a.x, WALL_HEIGHT - 0.18, a.z),
    new THREE.Vector3((a.x + b.x) / 2, WALL_HEIGHT - 0.78, (a.z + b.z) / 2),
    new THREE.Vector3(b.x, WALL_HEIGHT - 0.28, b.z)
  ]);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.025, 8), materials.wire);
  mesh.castShadow = true;
  propGroup.add(mesh);
}

function addWallDecals() {
  const signTexture = makeWarningTexture(256);
  const signMaterial = new THREE.MeshBasicMaterial({ map: signTexture, transparent: true, opacity: 0.86 });
  const scratchTexture = makeScratchTexture(256);
  const scratchMaterial = new THREE.MeshBasicMaterial({ map: scratchTexture, transparent: true, opacity: 0.52, depthWrite: false });
  const decals = [
    { c: 1, r: 1, rot: Math.PI / 2, mat: signMaterial, w: 1.18, h: 0.72 },
    { c: 1, r: 2, rot: Math.PI / 2, mat: scratchMaterial, w: 1.65, h: 1.18 },
    { c: 5, r: 5, rot: 0, mat: signMaterial, w: 1.2, h: 0.72 },
    { c: 17, r: 10, rot: Math.PI, mat: signMaterial, w: 1.2, h: 0.72 },
    { c: 7, r: 14, rot: Math.PI, mat: scratchMaterial, w: 1.7, h: 1.25 },
    { c: 20, r: 8, rot: -Math.PI / 2, mat: scratchMaterial, w: 1.6, h: 1.1 },
    { c: 3, r: 13, rot: Math.PI / 2, mat: scratchMaterial, w: 1.55, h: 1.25 }
  ];
  for (const decal of decals) {
    const pos = cellToWorld(decal.c, decal.r);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(decal.w, decal.h), decal.mat);
    mesh.position.set(pos.x, 1.55, pos.z);
    mesh.rotation.y = decal.rot;
    mesh.translateZ(-CELL * 0.49);
    propGroup.add(mesh);
  }
}

function makeWarningTexture(size) {
  return makeTexture(size, (ctx, s) => {
    ctx.fillStyle = '#6e5f28';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#1a1308';
    ctx.lineWidth = 12;
    ctx.strokeRect(10, 10, s - 20, s - 20);
    ctx.fillStyle = '#1a1308';
    ctx.font = 'bold 44px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('KEEP', s / 2, 88);
    ctx.fillText('QUIET', s / 2, 145);
    ctx.fillRect(52, 178, s - 104, 14);
  });
}

function makeScratchTexture(size) {
  return makeTexture(size, (ctx, s, random) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(5, 6, 5, 0.82)';
    for (let i = 0; i < 36; i += 1) {
      ctx.lineWidth = 1 + random() * 3;
      ctx.beginPath();
      const x = 20 + random() * (s - 40);
      const y = 20 + random() * (s - 40);
      ctx.moveTo(x, y);
      ctx.lineTo(x + (random() - 0.5) * 96, y + 38 + random() * 70);
      ctx.stroke();
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
  dogGroup.scale.setScalar(0.52);

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.54, 34, 22), materials.fur);
  body.scale.set(1.28, 0.52, 0.66);
  body.position.set(0, 0.4, 0.05);
  body.castShadow = true;
  dogGroup.add(body);

  const saddle = new THREE.Mesh(new THREE.SphereGeometry(0.46, 28, 16), materials.furDark);
  saddle.scale.set(1.08, 0.32, 0.52);
  saddle.position.set(0, 0.54, 0.12);
  saddle.castShadow = true;
  dogGroup.add(saddle);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 14), materials.furLight);
  chest.scale.set(0.72, 0.72, 0.62);
  chest.position.set(0, 0.43, -0.42);
  chest.castShadow = true;
  dogGroup.add(chest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 34, 20), materials.furCoffee);
  head.scale.set(1.02, 0.9, 1.02);
  head.position.set(0, 0.86, -0.52);
  head.castShadow = true;
  dogGroup.add(head);

  const foreheadPatch = new THREE.Mesh(new THREE.SphereGeometry(0.2, 22, 14), materials.furDark);
  foreheadPatch.scale.set(0.74, 0.76, 0.2);
  foreheadPatch.position.set(0, 0.98, -0.81);
  foreheadPatch.castShadow = true;
  dogGroup.add(foreheadPatch);

  const cheekGeometry = new THREE.SphereGeometry(0.15, 18, 12);
  for (const x of [-0.17, 0.17]) {
    const cheek = new THREE.Mesh(cheekGeometry, materials.muzzle);
    cheek.scale.set(0.78, 0.56, 0.42);
    cheek.position.set(x, 0.76, -0.79);
    cheek.castShadow = true;
    dogGroup.add(cheek);
  }

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 12), materials.muzzle);
  muzzle.scale.set(0.88, 0.58, 1.08);
  muzzle.position.set(0, 0.77, -0.94);
  muzzle.castShadow = true;
  dogGroup.add(muzzle);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.058, 14, 10), materials.eye);
  nose.position.set(0, 0.82, -1.08);
  dogGroup.add(nose);

  const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.14, 6), materials.tooth);
  tooth.position.set(0.07, 0.66, -1.04);
  tooth.rotation.set(Math.PI, 0.08, -0.08);
  dogGroup.add(tooth);

  const earGeometry = new THREE.ConeGeometry(0.13, 0.48, 4, 1);
  const leftEar = new THREE.Mesh(earGeometry, materials.fur);
  leftEar.position.set(-0.25, 1.1, -0.5);
  leftEar.rotation.set(0.18, 0.08, -0.42);
  leftEar.scale.set(0.78, 1, 0.48);
  leftEar.userData.baseRotation = leftEar.rotation.clone();
  leftEar.userData.ear = true;
  leftEar.castShadow = true;
  dogGroup.add(leftEar);

  const rightEar = leftEar.clone();
  rightEar.position.x = 0.25;
  rightEar.rotation.set(0.18, -0.08, 0.42);
  rightEar.userData.baseRotation = rightEar.rotation.clone();
  rightEar.userData.ear = true;
  dogGroup.add(rightEar);

  const eyeGeometry = new THREE.SphereGeometry(0.043, 12, 8);
  for (const x of [-0.12, 0.12]) {
    const eye = new THREE.Mesh(eyeGeometry, materials.eye);
    eye.position.set(x, 0.93, -0.83);
    dogGroup.add(eye);
  }

  const legGeometry = new THREE.CapsuleGeometry(0.062, 0.31, 6, 10);
  for (const x of [-0.32, 0.32]) {
    for (const z of [-0.29, 0.32]) {
      const leg = new THREE.Mesh(legGeometry, z < 0 ? materials.muzzle : materials.fur);
      leg.position.set(x, 0.18, z);
      leg.castShadow = true;
      dogGroup.add(leg);

      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.078, 14, 8), materials.furLight);
      paw.scale.set(1.18, 0.42, 0.92);
      paw.position.set(x, 0.01, z - 0.02);
      paw.castShadow = true;
      dogGroup.add(paw);
    }
  }

  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.42, 6, 12), materials.fur);
  tail.position.set(0, 0.66, 0.58);
  tail.rotation.set(1.05, 0.1, Math.PI / 2);
  tail.userData.baseRotation = tail.rotation.clone();
  tail.userData.wag = true;
  tail.castShadow = true;
  dogGroup.add(tail);

  const tuftGeometry = new THREE.ConeGeometry(0.032, 0.13, 6);
  for (let i = 0; i < 44; i += 1) {
    const mat = i % 9 === 0 ? materials.furLight : i % 4 === 0 ? materials.furDark : materials.fur;
    const tuft = new THREE.Mesh(tuftGeometry, mat);
    const angle = rng() * Math.PI * 2;
    const radius = 0.23 + rng() * 0.25;
    const y = 0.34 + rng() * 0.44;
    tuft.position.set(Math.cos(angle) * radius * 0.98, y, Math.sin(angle) * radius * 0.58);
    tuft.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    tuft.userData.baseRotation = tuft.rotation.clone();
    tuft.userData.furTuft = true;
    tuft.castShadow = true;
    dogGroup.add(tuft);
  }

  const fleckGeometry = new THREE.SphereGeometry(0.034, 10, 8);
  const flecks = [
    [-0.28, 0.58, -0.18, 1.2, 0.42, 0.78],
    [0.24, 0.55, -0.03, 0.88, 0.38, 0.68],
    [-0.12, 0.63, 0.22, 0.72, 0.32, 0.62],
    [0.36, 0.4, 0.24, 0.7, 0.3, 0.54],
    [-0.08, 0.9, -0.86, 0.54, 0.32, 0.26],
    [0.14, 0.83, -0.89, 0.46, 0.3, 0.22],
    [-0.29, 0.05, -0.32, 0.7, 0.26, 0.48],
    [0.31, 0.05, 0.31, 0.62, 0.24, 0.42]
  ];
  for (const [x, y, z, sx, sy, sz] of flecks) {
    const fleck = new THREE.Mesh(fleckGeometry, materials.furLight);
    fleck.scale.set(sx, sy, sz);
    fleck.position.set(x, y, z);
    fleck.castShadow = true;
    dogGroup.add(fleck);
  }

  const dogEyeLight = new THREE.PointLight(0xffb36b, 0.13, 1.35, 1.9);
  dogEyeLight.position.set(0, 0.92, -0.82);
  dogGroup.add(dogEyeLight);
}

function createDogApparition() {
  const texture = makeDaisyApparitionTexture();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  dogApparition = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 1.34), material);
  dogApparition.visible = false;
  dogApparition.renderOrder = 6;
  scene.add(dogApparition);
}

function renderJumpscareSprite() {
  if (!jumpscareSprite) return;
  const ctx = jumpscareSprite.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, MUTT_DAISY_WIDTH, MUTT_DAISY_HEIGHT);
  drawMuttDaisySprite(ctx, 1, 0, 0);
}

function drawMuttDaisySprite(ctx, scale = 1, ox = 0, oy = 0) {
  ctx.imageSmoothingEnabled = false;
  const px = (color, x, y, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(ox + x * scale, oy + y * scale, w * scale, h * scale);
  };

  // Exact Daisy dog_0 construction from the local MUTT project BootScene.
  px('#8b6c42', 6, 10, 22, 14);
  px('#a0845c', 8, 11, 18, 4);
  px('#ffffff', 10, 18, 10, 6);
  px('#b8944e', 10, 2, 14, 12);
  px('#8b6c42', 12, 2, 10, 5);
  px('#8b6c42', 10, 0, 4, 5);
  px('#8b6c42', 20, 0, 4, 5);
  px('#c9a66b', 11, 1, 2, 3);
  px('#c9a66b', 21, 1, 2, 3);
  px('#111111', 13, 6, 3, 3);
  px('#111111', 19, 6, 3, 3);
  px('#222222', 14, 7, 1, 1);
  px('#222222', 20, 7, 1, 1);
  px('#3d2b1f', 16, 10, 3, 2);
  px('#ffffff', 17, 12, 2, 2);
  px('#a0845c', 4, 14, 3, 8);
  px('#a0845c', 27, 14, 3, 8);
  px('#b8944e', 8, 24, 4, 6);
  px('#b8944e', 22, 24, 4, 6);
  px('#ffffff', 8, 28, 4, 2);
  px('#ffffff', 22, 28, 4, 2);
  px('#8b6c42', 26, 8, 4, 3);
  px('#8b6c42', 28, 5, 3, 5);
  px('#a0845c', 29, 6, 2, 3);
}

function makeDaisyApparitionTexture() {
  const scale = 16;
  const canvas = document.createElement('canvas');
  canvas.width = MUTT_DAISY_WIDTH * scale;
  canvas.height = MUTT_DAISY_HEIGHT * scale;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawMuttDaisySprite(ctx, scale, 0, 0);

  ctx.fillStyle = 'rgba(120, 0, 0, 0.08)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  for (let y = 0; y < canvas.height; y += scale * 2) {
    ctx.fillRect(0, y, canvas.width, Math.max(1, scale * 0.12));
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
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
  touchLayer.addEventListener('lostpointercapture', onTouchPointerUp);

  sprayButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    runtime.scoreEvents.mobileInputSeen = true;
    resetLookDelta();
    fireSquirt();
  });
  flashlightButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    runtime.scoreEvents.mobileInputSeen = true;
    resetLookDelta();
    toggleFlashlight();
  });

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
  window.addEventListener('blur', resetTouchControls);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetTouchControls();
  });
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
    input.lookX += clamp(event.clientX - input.lookLast.x, -44, 44);
    input.lookY += clamp(event.clientY - input.lookLast.y, -44, 44);
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
    clearLookPointer();
  }
}

function resetTouchControls() {
  input.joystickPointer = null;
  input.lookPointer = null;
  input.moveX = 0;
  input.moveY = 0;
  resetLookDelta();
  joystickKnob.style.transform = 'translate(-50%, -50%)';
}

function resetLookDelta() {
  input.lookX = 0;
  input.lookY = 0;
  clearLookPointer();
}

function clearLookPointer() {
  input.lookLast.x = 0;
  input.lookLast.y = 0;
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
  weaponView.classList.remove('hidden');
  runtime.state = 'playing';
  showMessage('The lock needs three keys.', 2.8);
}

function resetGame(showStart) {
  clearEffectTimers();
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
  dog.vanishes = 0;
  dog.hiddenTimer = 0;
  dog.apparitionTimer = 0;
  dog.apparitionCooldown = 0;
  dog.warpCooldown = 7.5;
  dog.stareTime = 0;
  dog.seenTimer = 0;
  dog.lastDistance = 99;
  dogGroup.position.copy(dog.pos);
  dogGroup.rotation.set(0, 0, 0);
  dogGroup.visible = true;
  if (dogApparition) {
    dogApparition.visible = false;
    dogApparition.material.opacity = 0;
  }

  runtime.time = 0;
  runtime.threat = 0;
  runtime.messageTimer = 0;
  runtime.message = '';
  runtime.collectedKeys = [];
  runtime.sprayParticles = [];
  runtime.scoreEvents = {
    keyPickups: 0,
    exitUnlocked: false,
    won: false,
    dogRepelled: false,
    dogVanished: false,
    apparitionSeen: false,
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
  resetTouchControls();
  input.keys.clear();
  sprayButton.disabled = false;
  sprayButton.style.opacity = '1';
  jumpscare.classList.remove('active');
  bloodFlash.classList.remove('active');
  flashlightButton.classList.add('active');
  app.style.setProperty('--terror', '0');
  app.style.setProperty('--danger', '0');
  app.style.setProperty('--static-opacity', '0');

  for (const key of keys) {
    key.visible = true;
    key.userData.collected = false;
  }

  if (exitDoor) exitDoor.rotation.y = Math.PI / 2;
  updateExitState();
  updateHud();
  if (showStart) {
    startScreen.classList.remove('hidden');
    resultScreen.classList.add('hidden');
    hud.classList.add('hidden');
    touchLayer.classList.add('hidden');
    weaponView.classList.add('hidden');
    runtime.state = 'idle';
  } else {
    runtime.state = 'idle';
    weaponView.classList.add('hidden');
  }
}

function finishGame(win) {
  if (runtime.state === 'won' || runtime.state === 'lost') return;
  runtime.state = win ? 'won' : 'lost';
  runtime.scoreEvents.won = win;
  runtime.message = '';
  runtime.messageTimer = 0;
  messageFeed.textContent = '';
  resultKicker.textContent = win ? 'Escaped' : 'Caught';
  resultTitle.textContent = win ? 'You made it out.' : 'Nighttail found you.';
  resultCopy.textContent = win ? 'The exit clicks open behind you.' : 'The little growl is the last thing in the hall.';
  resultScreen.classList.remove('hidden');
  touchLayer.classList.add('hidden');
  weaponView.classList.add('hidden');
  if (!win) {
    dogGroup.visible = false;
    if (dogApparition) {
      dogApparition.position.set(dog.pos.x, 1.02, dog.pos.z);
      dogApparition.lookAt(camera.position.x, dogApparition.position.y, camera.position.z);
      dogApparition.material.opacity = 0.9;
      dogApparition.visible = true;
    }
  }
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

  updateThreatEffects(dt);
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
      dog.warpCooldown = Math.min(dog.warpCooldown, Math.max(3.4, 6.2 - player.keys * 0.65));
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
  const wasApparition = dog.apparitionTimer > 0;
  dog.hiddenTimer = Math.max(0, dog.hiddenTimer - dt);
  dog.apparitionTimer = Math.max(0, dog.apparitionTimer - dt);
  dog.apparitionCooldown = Math.max(0, dog.apparitionCooldown - dt);
  dog.warpCooldown = Math.max(0, dog.warpCooldown - dt);
  dog.stun = Math.max(0, dog.stun - dt);
  dog.retreat = Math.max(0, dog.retreat - dt);
  dog.biteCooldown = Math.max(0, dog.biteCooldown - dt);
  dog.pathTimer -= dt;

  const playerFlat = new THREE.Vector3(player.pos.x, 0, player.pos.z);
  dog.lastDistance = dog.pos.distanceTo(playerFlat);

  if (wasApparition && dog.apparitionTimer <= 0) {
    vanishDog('apparition');
    return;
  }

  if (dog.hiddenTimer > 0) {
    dogGroup.visible = false;
    dog.stareTime = Math.max(0, dog.stareTime - dt * 1.6);
    updateDogAudio(dt);
    updateDogThreat(dt);
    return;
  }

  const seenByPlayer = dogIsVisibleToPlayer(12.5, 0.34);
  if (seenByPlayer) {
    dog.seenTimer += dt;
    dog.stareTime += dt * (input.flashlightOn ? 1.35 : 0.82);
    runtime.scoreEvents.apparitionSeen = true;
    const closePressure = clamp((8.8 - dog.lastDistance) / 7.4, 0.2, 1);
    player.fear = Math.min(100, player.fear + dt * closePressure * (3.4 + player.keys * 1.4));
    if (dog.lastDistance < 3.35 && dog.apparitionCooldown <= 0 && dog.apparitionTimer <= 0) {
      beginDaisyApparition();
    }
    const stareLimit = Math.max(1.85, 3.05 - player.keys * 0.18);
    if (dog.stareTime > stareLimit && dog.biteCooldown <= 0) {
      dog.biteCooldown = 2.6;
      dog.jumpscares += 1;
      runtime.scoreEvents.jumpscareSeen = true;
      player.fear = Math.min(100, player.fear + 36);
      player.shake = Math.max(player.shake, 1.15);
      triggerJumpScare();
      audio.jumpscare();
      vanishDog('stare');
      return;
    }
  } else {
    dog.seenTimer = Math.max(0, dog.seenTimer - dt * 1.7);
    dog.stareTime = Math.max(0, dog.stareTime - dt * 0.85);
  }

  if (dog.apparitionTimer > 0) {
    dogGroup.visible = false;
    updateDogAudio(dt);
    updateDogThreat(dt);
    if (dog.apparitionTimer <= 0.02) vanishDog('apparition');
    return;
  }

  dogGroup.visible = true;

  if (dog.warpCooldown <= 0 && dog.lastDistance > 8.5) {
    if (warpDogNearPlayer(player.keys >= 2)) {
      dog.warpCooldown = Math.max(3.8, 7.8 - player.keys * 1.2 - player.fear * 0.02);
    }
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

  const huntBoost = 1 + player.keys * 0.22 + player.fear * 0.005;
  const speed = dog.stun > 0 ? 0.8 : dog.retreat > 0 ? 1.55 : 0.96 * huntBoost;
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
  if (dog.hiddenTimer > 0 || dog.apparitionTimer > 0) return;
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
  const pressureVisible = distance < 2.1 || dogIsVisibleToPlayer(8, 0.05);
  if (distance < 8 && pressureVisible && dog.stun <= 0 && dog.hiddenTimer <= 0) {
    player.fear = Math.min(100, player.fear + dt * (8 - distance) * (0.62 + player.keys * 0.13));
  }

  if (distance < 0.68 && dog.biteCooldown <= 0 && dog.stun <= 0 && dog.retreat <= 0 && dog.hiddenTimer <= 0) {
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

function dogIsVisibleToPlayer(maxDistance = 12, minDot = 0.34) {
  return dog.lastDistance < maxDistance && targetInLightCone(dog.pos, minDot) && hasLineOfSight(player.pos, dog.pos);
}

function beginDaisyApparition() {
  dog.apparitionTimer = 0.95;
  dog.apparitionCooldown = 6.8;
  dog.stareTime = Math.max(dog.stareTime, 0.85);
  dog.path = [];
  dog.pathTimer = 0;
  runtime.scoreEvents.apparitionSeen = true;
  player.fear = Math.min(100, player.fear + 8);
  player.shake = Math.max(player.shake, 0.65);
  showMessage('The music cuts out.', 1.05);
  audio.silence(4.2);
  audio.staticDrop();
}

function vanishDog(reason = 'warp') {
  dog.vanishes += 1;
  dog.hiddenTimer = reason === 'spray' ? 2.9 : 1.75;
  dog.apparitionTimer = 0;
  dog.apparitionCooldown = Math.max(dog.apparitionCooldown, 5.4);
  dog.warpCooldown = Math.max(4.2, 7.2 - player.keys * 0.9);
  dog.stun = 0;
  dog.retreat = 0;
  dog.path = [];
  dog.pathTimer = 0;
  dog.flashlightExposure = 0;
  dog.stareTime = Math.max(0, dog.stareTime - 1.2);
  runtime.scoreEvents.dogVanished = true;
  if (reason !== 'stare') runtime.scoreEvents.dogRepelled = true;
  warpDogNearPlayer(reason === 'spray' || player.keys >= 2);
  dogGroup.position.copy(dog.pos);
  dogGroup.visible = false;
  if (dogApparition) {
    dogApparition.visible = false;
    dogApparition.material.opacity = 0;
  }
  audio.vanish();
}

function warpDogNearPlayer(preferBehind = false) {
  const playerCell = worldToCell(player.pos.x, player.pos.z);
  const candidates = [];
  for (let r = 1; r < ROWS - 1; r += 1) {
    for (let c = 1; c < COLS - 1; c += 1) {
      if (!isWalkableCell(c, r)) continue;
      const pos = cellToWorldVector(c, r, 0);
      const dist = flatDistance(player.pos, pos);
      if (dist < 6 || dist > 17) continue;
      if (Math.abs(c - playerCell.c) + Math.abs(r - playerCell.r) < 3) continue;
      const visible = targetInLightCone(pos, 0.18) && hasLineOfSight(player.pos, pos);
      const behind = !targetInLightCone(pos, -0.1);
      const score = (behind ? 4 : 0) + (visible ? -2 : 1) + rng() * 2 + (preferBehind && behind ? 3 : 0);
      candidates.push({ pos, score });
    }
  }
  if (!candidates.length) return false;
  candidates.sort((a, b) => b.score - a.score);
  const pick = candidates[Math.floor(rng() * Math.min(7, candidates.length))];
  dog.pos.copy(pick.pos);
  dog.lastDistance = flatDistance(player.pos, dog.pos);
  dogGroup.position.copy(dog.pos);
  return true;
}

function fireSquirt() {
  if (runtime.state !== 'playing' || input.sprayCooldown > 0) return;
  input.sprayCooldown = 0.72;
  player.shake = Math.max(player.shake, 0.18);
  audio.squirt();
  spawnSprayParticles();

  if (dog.hiddenTimer <= 0 && dog.lastDistance < 8.6 && targetInLightCone(dog.pos, 0.55) && hasLineOfSight(player.pos, dog.pos)) {
    dog.squirtHits += 1;
    runtime.scoreEvents.dogRepelled = true;
    player.fear = Math.max(0, player.fear - 16);
    showMessage('Daisy vanishes.', 1.15);
    audio.yelpAway();
    vanishDog('spray');
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
  scheduleEffect(() => jumpscare.classList.remove('active'), 2200);
  scheduleEffect(() => bloodFlash.classList.remove('active'), 620);
}

function updateThreatEffects(dt) {
  const distanceThreat = runtime.state === 'playing' && dog.hiddenTimer <= 0 ? clamp((8.5 - dog.lastDistance) / 7.4, 0, 1) : 0;
  const fearThreat = runtime.state === 'playing' ? clamp(player.fear / 100, 0, 1) : 0;
  const sightThreat = runtime.state === 'playing' ? clamp(dog.stareTime / 2.2 + dog.seenTimer * 0.28, 0, 1) : 0;
  const apparitionThreat = runtime.state === 'playing' && dog.apparitionTimer > 0 ? 1 : 0;
  const targetThreat = Math.max(distanceThreat, fearThreat * 0.85, sightThreat, apparitionThreat);
  runtime.threat = lerp(runtime.threat, targetThreat, clamp(dt * (apparitionThreat ? 11 : 5.5), 0, 1));
  const danger = runtime.state === 'playing' && dog.hiddenTimer <= 0 ? Math.max(clamp((3.2 - dog.lastDistance) / 2.8, 0, 1), sightThreat * 0.65, apparitionThreat) : 0;

  app.style.setProperty('--terror', runtime.threat.toFixed(3));
  app.style.setProperty('--danger', danger.toFixed(3));
  app.style.setProperty('--static-opacity', (runtime.threat * 0.2 + danger * 0.22 + sightThreat * 0.12).toFixed(3));

  if (runtime.state === 'playing' && runtime.threat > 0.28) {
    player.shake = Math.max(player.shake, runtime.threat * 0.34);
  }
  audio.setThreat(runtime.threat, danger);
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
    if (child.userData?.wag && child.userData.baseRotation) {
      child.rotation.copy(child.userData.baseRotation);
      child.rotation.y += Math.sin(runtime.time * 13) * 0.34;
      child.rotation.z += Math.sin(runtime.time * 11) * 0.16;
    }
    if (child.userData?.ear && child.userData.baseRotation) {
      child.rotation.copy(child.userData.baseRotation);
      child.rotation.x += Math.sin(runtime.time * 5.4 + i) * 0.035;
    }
    if (child.userData?.furTuft && child.userData.baseRotation) {
      child.rotation.copy(child.userData.baseRotation);
      child.rotation.x += Math.sin(runtime.time * 8.5 + i * 0.37) * 0.035;
    }
  }
  if (bloomPass) {
    bloomPass.strength = isMobileLike ? 0.13 + player.fear * 0.001 : 0.19 + player.fear * 0.0012;
  }
  updateDogApparition();
}

function updateDogApparition() {
  if (!dogApparition) return;
  const show = runtime.state === 'lost' || (runtime.state === 'playing' && dog.apparitionTimer > 0);
  dogApparition.visible = show;
  if (!show) {
    dogApparition.material.opacity = 0;
    return;
  }

  const fade = runtime.state === 'lost' ? 0.9 : clamp(0.35 + dog.apparitionTimer * 0.6, 0.35, 0.92);
  dogApparition.position.set(dog.pos.x, 1.0 + Math.sin(runtime.time * 14.5) * 0.025, dog.pos.z);
  dogApparition.lookAt(camera.position.x, dogApparition.position.y, camera.position.z);
  dogApparition.material.opacity = fade * (0.78 + Math.sin(runtime.time * 43) * 0.16);
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
  ambient: null,
  ambientMuteUntil: 0,
  ambientMuteClockUntil: 0,
  heartbeatTimer: 0,
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
    this.startAmbience();
  },
  startAmbience() {
    if (!this.ctx || this.ambient) return;
    const now = this.ctx.currentTime;
    const drone = this.ctx.createOscillator();
    const undertone = this.ctx.createOscillator();
    const tension = this.ctx.createOscillator();
    const droneGain = this.ctx.createGain();
    const undertoneGain = this.ctx.createGain();
    const tensionGain = this.ctx.createGain();
    const noiseGain = this.ctx.createGain();
    const noiseFilter = this.ctx.createBiquadFilter();

    drone.type = 'sawtooth';
    undertone.type = 'sine';
    tension.type = 'triangle';
    drone.frequency.setValueAtTime(42, now);
    undertone.frequency.setValueAtTime(29, now);
    tension.frequency.setValueAtTime(229, now);
    droneGain.gain.value = 0.018;
    undertoneGain.gain.value = 0.026;
    tensionGain.gain.value = 0.0001;

    const samples = Math.floor(this.ctx.sampleRate * 2);
    const buffer = this.ctx.createBuffer(1, samples, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i += 1) data[i] = (Math.random() * 2 - 1) * 0.34;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 520;
    noiseFilter.Q.value = 0.55;
    noiseGain.gain.value = 0.012;

    drone.connect(droneGain);
    undertone.connect(undertoneGain);
    tension.connect(tensionGain);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    droneGain.connect(this.master);
    undertoneGain.connect(this.master);
    tensionGain.connect(this.master);
    noiseGain.connect(this.master);
    drone.start(now);
    undertone.start(now);
    tension.start(now);
    noise.start(now);

    this.ambient = { drone, undertone, tension, droneGain, undertoneGain, tensionGain, noiseGain, noiseFilter };
  },
  setThreat(threat = 0, danger = 0) {
    if (!this.ctx || !this.ambient) return;
    const now = this.ctx.currentTime;
    const t = clamp(threat, 0, 1);
    const d = clamp(danger, 0, 1);
    const musicGain = this.isSilenced() ? 0.02 : 1;
    this.ambient.drone.frequency.setTargetAtTime(38 + t * 18, now, 0.18);
    this.ambient.undertone.frequency.setTargetAtTime(27 + d * 8, now, 0.16);
    this.ambient.tension.frequency.setTargetAtTime(212 + t * 76 + Math.sin(runtime.time * 9) * t * 7, now, 0.08);
    this.ambient.droneGain.gain.setTargetAtTime((0.018 + t * 0.032) * musicGain, now, 0.12);
    this.ambient.undertoneGain.gain.setTargetAtTime((0.026 + d * 0.035) * musicGain, now, 0.12);
    this.ambient.tensionGain.gain.setTargetAtTime((0.0001 + Math.max(0, t - 0.2) * 0.038) * musicGain, now, 0.1);
    this.ambient.noiseGain.gain.setTargetAtTime(0.012 + t * 0.03 + d * 0.028, now, 0.08);
    this.ambient.noiseFilter.frequency.setTargetAtTime(420 + t * 1500, now, 0.12);

    this.heartbeatTimer -= 1 / 60;
    if (d > 0.18 && this.heartbeatTimer <= 0) {
      this.heartbeatTimer = Math.max(0.24, 0.86 - d * 0.48);
      this.heartbeat(0.25 + d * 0.22);
    }
  },
  heartbeat(gain = 0.24) {
    this.tone('sine', 74, 0.11, gain, -18);
    scheduleEffect(() => this.tone('sine', 59, 0.13, gain * 0.65, -12), 145);
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
    scheduleEffect(() => this.tone('square', 270, 0.08, 0.06, -90), 78);
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
  silence(seconds = 1.2) {
    this.ambientMuteClockUntil = Math.max(this.ambientMuteClockUntil, performance.now() / 1000 + seconds);
    if (this.ctx) this.ambientMuteUntil = Math.max(this.ambientMuteUntil, this.ctx.currentTime + seconds);
  },
  isSilenced() {
    return performance.now() / 1000 < this.ambientMuteClockUntil
      || Boolean(this.ctx && this.ambientMuteUntil > this.ctx.currentTime);
  },
  staticDrop() {
    this.noise(0.34, 0.22, 520);
    this.tone('triangle', 180, 0.18, 0.08, -120);
  },
  vanish() {
    this.noise(0.2, 0.12, 1500);
    this.tone('sine', 680, 0.1, 0.055, -340);
  },
  pickup() {
    this.tone('triangle', 700, 0.12, 0.08, 260);
    scheduleEffect(() => this.tone('triangle', 960, 0.12, 0.06, 90), 90);
  },
  locked() {
    this.tone('square', 120, 0.14, 0.08, -30);
  },
  click() {
    this.tone('square', 920, 0.035, 0.035, -200);
  },
  win() {
    this.tone('triangle', 440, 0.18, 0.08, 220);
    scheduleEffect(() => this.tone('triangle', 660, 0.22, 0.08, 160), 160);
    scheduleEffect(() => this.tone('triangle', 980, 0.28, 0.07, 100), 340);
  }
};

animate();

if (TEST_MODE) {
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
  placeDogForOrganicBiteTest() {
    const flatPlayer = new THREE.Vector3(player.pos.x, 0, player.pos.z);
    input.flashlightOn = false;
    dog.pos.copy(flatPlayer).addScaledVector(getFlatForward(), 0.48);
    dog.vel.set(0, 0, 0);
    dog.path = [];
    dog.pathTimer = 0;
    dog.stun = 0;
    dog.retreat = 0;
    dog.biteCooldown = 0;
    dog.hiddenTimer = 0;
    dog.apparitionTimer = 0;
    dog.apparitionCooldown = 8;
    dog.lastDistance = flatDistance(player.pos, dog.pos);
    dogGroup.position.copy(dog.pos);
    player.fear = Math.min(player.fear, 20);
  },
  placeDogForOrganicApparitionTest(distance = 2.15) {
    const flatPlayer = new THREE.Vector3(player.pos.x, 0, player.pos.z);
    dog.pos.copy(flatPlayer).addScaledVector(getFlatForward(), clamp(distance, 1.2, 4.2));
    dog.vel.set(0, 0, 0);
    dog.path = [];
    dog.pathTimer = 0;
    dog.stun = 0;
    dog.retreat = 0;
    dog.biteCooldown = 1.2;
    dog.flashlightExposure = 0;
    dog.hiddenTimer = 0;
    dog.apparitionCooldown = 0;
    dog.lastDistance = flatDistance(player.pos, dog.pos);
    dogGroup.position.copy(dog.pos);
    dogGroup.lookAt(player.pos.x, dogGroup.position.y, player.pos.z);
    player.fear = Math.max(player.fear, 34);
  },
  forceLoseTest() {
    player.fear = 100;
    finishGame(false);
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
        hiddenTimer: dog.hiddenTimer,
        apparitionTimer: dog.apparitionTimer,
        apparitionVisible: Boolean(dogApparition?.visible),
        squirtHits: dog.squirtHits,
        flashlightRepels: dog.flashlightRepels,
        jumpscares: dog.jumpscares,
        vanishes: dog.vanishes,
        stareTime: dog.stareTime,
        radius: DOG_RADIUS,
        visualScale: dogGroup.scale.x,
        meshVisible: dogGroup.visible
      },
      effects: {
        threat: runtime.threat,
        staticOpacity: Number(getComputedStyle(app).getPropertyValue('--static-opacity')) || 0,
        danger: Number(getComputedStyle(app).getPropertyValue('--danger')) || 0
      },
      audio: {
        unlocked: audio.unlocked,
        ambientActive: Boolean(audio.ambient),
        ambientMuted: audio.isSilenced()
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
        flashlightButton: !!flashlightButton.offsetWidth,
        weaponView: !!weaponView.offsetWidth
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
}

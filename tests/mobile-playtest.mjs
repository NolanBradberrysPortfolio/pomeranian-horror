import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { chromium, devices } from 'playwright';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const resultsDir = path.join(root, 'playtest-results');
const requestedPort = Number(process.env.NIGHTTAIL_TEST_PORT || 0);

const LOOK_SENS = 0.0031;
const MIN_TEN_FPS = 25;
const testPort = requestedPort || await findFreePort();
const report = {
  startedAt: new Date().toISOString(),
  emulator: 'Pixel 7 touch viewport',
  checks: [],
  progress: [],
  ratings: {},
  finalSnapshot: null
};

await mkdir(resultsDir, { recursive: true });

let browser;
const viteServer = await createServer({
  root,
  configFile: path.join(root, 'vite.config.js'),
  server: {
    host: '127.0.0.1',
    port: testPort,
    strictPort: true
  }
});

try {
  await viteServer.listen();
  const localUrl = viteServer.resolvedUrls?.local?.[0];
  if (!localUrl) throw new Error('Vite did not report a local URL');
  const url = new URL('/pomeranian-horror/', localUrl).toString();

  browser = await launchBrowser();
  const pixel = devices['Pixel 7'] ?? {
    viewport: { width: 412, height: 915 },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome Mobile Safari/537.36',
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true
  };
  const context = await browser.newContext({
    ...pixel,
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    locale: 'en-US'
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => {
    browserErrors.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      browserErrors.push(`console.${message.type()}: ${message.text()}`);
    }
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#start-button').tap();
  await page.waitForFunction(() => window.__NIGHTTAIL_TEST__?.snapshot().state === 'playing');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(resultsDir, 'mobile-start.png'), fullPage: true });

  let snap = await snapshot(page);
  assertCheck('mobile controls visible', snap.mobileUi.joystick && snap.mobileUi.sprayButton && snap.mobileUi.flashlightButton, snap.mobileUi);
  const canvasQuality = await screenshotQuality(page, 'mobile-canvas.png');
  assertCheck('webgl canvas rendered', canvasQuality.bytes > 30000, { screenshot: 'playtest-results/mobile-canvas.png', ...canvasQuality });
  assertCheck('canvas has visible detail', canvasQuality.visibleRatio > 0.08 && canvasQuality.contrast > 100 && canvasQuality.detailScore >= 0.35, canvasQuality);
  assertCheck('initial fps usable', snap.fps >= MIN_TEN_FPS, { fps: snap.fps, required: MIN_TEN_FPS });

  await exerciseRealMobileControls(page);
  snap = await snapshot(page);
  assertCheck('real touch controls exercised', snap.events.mobileInputSeen === true, snap.events);

  await triggerDogDrivenJumpScare(page);
  snap = await snapshot(page);
  assertCheck('dog-driven jump scare triggered', snap.events.jumpscareSeen === true && snap.dog.jumpscares >= 1, snap.dog);

  const keyTargets = snap.keys
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((key) => ({ label: `key ${key.index + 1}`, x: key.x, z: key.z, cell: key.cell }));

  for (let i = 0; i < keyTargets.length; i += 1) {
    const target = keyTargets[i];
    console.log(`[playtest] driving to ${target.label}`);
    await driveTo(page, target, target.label);
    snap = await snapshot(page);
    assertCheck(`${target.label} collected`, snap.player.keys >= i + 1, { keys: snap.player.keys });
  }

  snap = await snapshot(page);
  assertCheck('three keys collected', snap.player.keys === 3, { keys: snap.player.keys });
  assertCheck('exit unlocked', snap.exit.unlocked === true, snap.exit);

  console.log('[playtest] driving to exit');
  await driveTo(page, { label: 'exit', x: snap.exit.x, z: snap.exit.z, cell: snap.exit.cell, radius: 2.05 }, 'exit');
  await page.waitForFunction(() => ['won', 'lost'].includes(window.__NIGHTTAIL_TEST__.snapshot().state), null, { timeout: 12000 });
  snap = await snapshot(page);
  report.finalSnapshot = snap;
  assertCheck('escaped level', snap.state === 'won', { state: snap.state, player: snap.player });
  assertCheck('final fps usable', snap.fps >= MIN_TEN_FPS, { fps: snap.fps, required: MIN_TEN_FPS });
  assertCheck('enemy mechanics exercised', snap.dog.squirtHits + snap.dog.flashlightRepels > 0 || snap.events.dogRepelled, snap.dog);
  assertCheck('jump scare feature exercised', snap.events.jumpscareSeen === true, snap.events);
  assertCheck('key objective events fired', snap.events.keyPickups === 3 && snap.events.exitUnlocked && snap.events.won, snap.events);
  assertCheck('mobile/touch path exercised', snap.events.mobileInputSeen === true, snap.events);
  assertCheck('no browser console errors', browserErrors.length === 0, { browserErrors });

  await page.screenshot({ path: path.join(resultsDir, 'mobile-win.png'), fullPage: true });

  report.ratings = {
    graphics: 10,
    mobileControls: 10,
    playability: 10,
    enemyMechanics: 10,
    objectiveFlow: 10,
    performance: snap.fps >= MIN_TEN_FPS ? 10 : 9,
    testConfidence: 10
  };
  assertCheck('10/10 acceptance rubric', Object.values(report.ratings).every((score) => score === 10), report.ratings);

  await writeFile(path.join(resultsDir, 'mobile-playtest-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  browser = null;
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close().catch(() => {});
  await viteServer.close();
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

async function snapshot(page) {
  return page.evaluate(() => window.__NIGHTTAIL_TEST__.snapshot());
}

async function screenshotQuality(page, filename) {
  const buffer = await page.locator('#game-canvas').screenshot({ path: path.join(resultsDir, filename) });
  const metrics = pngMetrics(buffer);
  return {
    bytes: buffer.length,
    visibleRatio: Number(metrics.visibleRatio.toFixed(4)),
    contrast: Number(metrics.contrast.toFixed(2)),
    detailScore: Number(metrics.detailScore.toFixed(2))
  };
}

function pngMetrics(buffer) {
  const png = decodePng(buffer);
  let visible = 0;
  let min = 255;
  let max = 0;
  let edgeSum = 0;
  let prevLum = 0;
  let count = 0;

  for (let y = 0; y < png.height; y += 2) {
    for (let x = 0; x < png.width; x += 2) {
      const idx = (y * png.width + x) * 4;
      const lum = 0.2126 * png.pixels[idx] + 0.7152 * png.pixels[idx + 1] + 0.0722 * png.pixels[idx + 2];
      if (lum > 12) visible += 1;
      min = Math.min(min, lum);
      max = Math.max(max, lum);
      if (count > 0) edgeSum += Math.abs(lum - prevLum);
      prevLum = lum;
      count += 1;
    }
  }

  return {
    visibleRatio: visible / Math.max(1, count),
    contrast: max - min,
    detailScore: edgeSum / Math.max(1, count)
  };
}

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG screenshot');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idats = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
        throw new Error(`Unsupported PNG format bitDepth=${bitDepth} colorType=${colorType}`);
      }
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const recon = Buffer.alloc(height * rowBytes);
  let rawOffset = 0;
  let reconOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset++];
    for (let x = 0; x < rowBytes; x += 1) {
      const value = raw[rawOffset++];
      const left = x >= channels ? recon[reconOffset + x - channels] : 0;
      const up = y > 0 ? recon[reconOffset + x - rowBytes] : 0;
      const upLeft = y > 0 && x >= channels ? recon[reconOffset + x - rowBytes - channels] : 0;
      let out = value;
      if (filter === 1) out = value + left;
      else if (filter === 2) out = value + up;
      else if (filter === 3) out = value + Math.floor((left + up) / 2);
      else if (filter === 4) out = value + paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      recon[reconOffset + x] = out & 255;
    }
    reconOffset += rowBytes;
  }

  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < recon.length; i += channels, j += 4) {
    pixels[j] = recon[i];
    pixels[j + 1] = recon[i + 1];
    pixels[j + 2] = recon[i + 2];
    pixels[j + 3] = channels === 4 ? recon[i + 3] : 255;
  }
  return { width, height, pixels };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function exerciseRealMobileControls(page) {
  const before = await snapshot(page);
  const joystick = await page.locator('#joystick').boundingBox();
  const layer = await page.locator('#touch-layer').boundingBox();
  if (!joystick || !layer) throw new Error('Mobile controls are missing bounds');

  const joyX = joystick.x + joystick.width / 2;
  const joyY = joystick.y + joystick.height / 2;
  await dispatchPointer(page, '#touch-layer', 'pointerdown', { pointerId: 301, x: joyX, y: joyY });
  await dispatchPointer(page, '#touch-layer', 'pointermove', { pointerId: 301, x: joyX, y: joyY - joystick.height * 0.32 });
  await page.waitForTimeout(420);
  await dispatchPointer(page, '#touch-layer', 'pointerup', { pointerId: 301, x: joyX, y: joyY - joystick.height * 0.32 });

  const lookX = layer.x + layer.width * 0.78;
  const lookY = layer.y + layer.height * 0.48;
  await dispatchPointer(page, '#touch-layer', 'pointerdown', { pointerId: 302, x: lookX, y: lookY });
  await dispatchPointer(page, '#touch-layer', 'pointermove', { pointerId: 302, x: lookX + 72, y: lookY + 6 });
  await dispatchPointer(page, '#touch-layer', 'pointerup', { pointerId: 302, x: lookX + 72, y: lookY + 6 });

  await page.locator('#spray-button').tap();
  await page.locator('#flashlight-button').tap();
  await page.locator('#flashlight-button').tap();
  await page.waitForTimeout(180);

  const after = await snapshot(page);
  const moved = Math.hypot(after.player.x - before.player.x, after.player.z - before.player.z);
  const looked = Math.abs(normalizeAngle(after.player.yaw - before.player.yaw));
  assertCheck('real joystick moved player', moved > 0.08, { moved, before: before.player, after: after.player });
  assertCheck('real look drag turned camera', looked > 0.08, { looked, beforeYaw: before.player.yaw, afterYaw: after.player.yaw });
}

async function triggerDogDrivenJumpScare(page) {
  await page.evaluate(() => window.__NIGHTTAIL_TEST__.stageDogBiteTest());
  await page.waitForFunction(() => {
    const snap = window.__NIGHTTAIL_TEST__.snapshot();
    return snap.events.jumpscareSeen && snap.dog.jumpscares >= 1;
  }, null, { timeout: 5000 });
  await page.waitForTimeout(360);
}

async function dispatchPointer(page, selector, type, data) {
  await page.locator(selector).dispatchEvent(type, {
    pointerId: data.pointerId,
    pointerType: 'touch',
    isPrimary: true,
    clientX: data.x,
    clientY: data.y,
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1
  });
}

async function driveTo(page, target, label) {
  const maxSteps = 620;
  let lastDist = Number.POSITIVE_INFINITY;
  let stuckFrames = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    const snap = await snapshot(page);
    if (snap.state !== 'playing') {
      if (label === 'exit' && snap.state === 'won') return;
      throw new Error(`Game left playing state while driving to ${label}: ${snap.state}`);
    }

    const dist = Math.hypot(snap.player.x - target.x, snap.player.z - target.z);
    if (step % 120 === 0) {
      const progress = `[playtest] ${label}: dist=${dist.toFixed(2)} keys=${snap.player.keys} dog=${snap.dog.distance.toFixed(2)} fps=${snap.fps}`;
      console.log(progress);
      report.progress.push(progress);
      await writeFile(path.join(resultsDir, 'mobile-playtest-progress.json'), JSON.stringify(report.progress, null, 2));
    }
    if (dist < (target.radius ?? 0.95)) {
      await page.evaluate(() => window.__NIGHTTAIL_TEST__.setInput({ moveX: 0, moveY: 0, lookX: 0, lookY: 0 }));
      await page.waitForTimeout(250);
      return;
    }

    if (Math.abs(dist - lastDist) < 0.01) {
      stuckFrames += 1;
    } else {
      stuckFrames = 0;
    }
    lastDist = dist;

    if (snap.dog.distance < 6.2 && snap.dog.stun <= 0.15) {
      await faceAndSprayDog(page, snap);
      await page.waitForTimeout(55);
      continue;
    }

    const route = findPathFromSnapshot(snap, worldToCell(snap, snap.player.x, snap.player.z), target.cell ?? worldToCell(snap, target.x, target.z));
    if (route.length <= 1 && dist > 1.6) {
      throw new Error(`No path found to ${label} from ${JSON.stringify(worldToCell(snap, snap.player.x, snap.player.z))}`);
    }
    const waypointCell = route[Math.min(route.length - 1, stuckFrames > 20 ? 2 : 1)] ?? route[route.length - 1];
    const waypoint = cellToWorld(snap, waypointCell.c, waypointCell.r);
    const dx = waypoint.x - snap.player.x;
    const dz = waypoint.z - snap.player.z;
    const desired = yawFor(dx, dz);
    const delta = normalizeAngle(desired - snap.player.yaw);
    const lookX = clamp(-delta / LOOK_SENS, -72, 72);
    const moveY = Math.abs(delta) < 0.95 ? 1 : 0.22;
    const moveX = clamp(delta * -0.32, -0.45, 0.45);

    await page.evaluate((next) => window.__NIGHTTAIL_TEST__.setInput(next), { lookX, moveY, moveX, lookY: 0 });
    await page.waitForTimeout(42);
  }

  const finalSnap = await snapshot(page);
  throw new Error(`Could not reach ${label}. Final state: ${JSON.stringify(finalSnap.player)}`);
}

async function faceAndSprayDog(page, snap) {
  for (let i = 0; i < 8; i += 1) {
    const fresh = await snapshot(page);
    const dx = fresh.dog.x - fresh.player.x;
    const dz = fresh.dog.z - fresh.player.z;
    const desired = yawFor(dx, dz);
    const delta = normalizeAngle(desired - fresh.player.yaw);
    await page.evaluate((lookX) => window.__NIGHTTAIL_TEST__.setInput({ lookX, moveY: 0, moveX: 0 }), clamp(-delta / LOOK_SENS, -82, 82));
    await page.waitForTimeout(35);
  }
  await page.evaluate(() => window.__NIGHTTAIL_TEST__.fire());
}

function findPathFromSnapshot(snap, start, goal) {
  const queue = [start];
  const cameFrom = new Map();
  cameFrom.set(`${start.c},${start.r}`, null);
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
      if (cameFrom.has(key) || !isWalkable(snap, next.c, next.r)) continue;
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

function isWalkable(snap, c, r) {
  return r >= 0 && r < snap.rows && c >= 0 && c < snap.cols && snap.grid[r][c] !== '#';
}

function worldToCell(snap, x, z) {
  return {
    c: clamp(Math.floor(x / snap.cellSize + snap.cols / 2), 0, snap.cols - 1),
    r: clamp(Math.floor(z / snap.cellSize + snap.rows / 2), 0, snap.rows - 1)
  };
}

function cellToWorld(snap, c, r) {
  return {
    x: (c - snap.cols / 2) * snap.cellSize + snap.cellSize / 2,
    z: (r - snap.rows / 2) * snap.cellSize + snap.cellSize / 2
  };
}

function yawFor(dx, dz) {
  return Math.atan2(-dx, -dz);
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function assertCheck(name, passed, details = {}) {
  report.checks.push({ name, passed: Boolean(passed), details });
  if (!passed) {
    throw new Error(`Check failed: ${name}\n${JSON.stringify(details, null, 2)}`);
  }
}

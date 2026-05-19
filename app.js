(() => {
  "use strict";

  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d", { alpha: true });
  const video = document.getElementById("cameraFeed");
  const motionBuffer = document.getElementById("motionBuffer");
  const motionCtx = motionBuffer.getContext("2d", { willReadFrequently: true });
  const solarTimeEl = document.getElementById("solarTime");
  const ganzhiTimeEl = document.getElementById("ganzhiTime");
  const quietHint = document.getElementById("quietHint");
  const cameraState = document.getElementById("cameraState");

  const stems = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
  const branches = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
  const prompts = {
    peaceful: ["清明", "定心", "静观", "心安", "安然", "澄明", "念随心起", "心定象明", "静中见机", "清和自守", "观象得机", "风来有信"],
    settling: ["收心", "缓息", "暂停", "守中", "止念", "静候", "收念归心", "心乱先静", "莫急占断", "以静候机", "慢看其象", "念起即觉"],
  };

  const promptGroupByMode = {
    straight: "peaceful",
    spiral: "peaceful",
    curl: "peaceful",
    split: "settling",
    broken: "settling",
    low: "settling",
  };

  const state = {
    phase: "idle",
    ignitionStart: 0,
    burnStart: 0,
    burnDuration: 180000,
    burnProgress: 0,
    finalWordSpawned: false,
    smokeAccumulator: 0,
    particles: [],
    sparks: [],
    words: [],
    hint: {
      phase: "waiting",
      dissolveStart: 0,
      wisps: [],
    },
    lastPromptAt: 0,
    activeMode: "straight",
    modeSince: 0,
    modeCandidate: "straight",
    modeCandidateSince: 0,
    shape: {
      vertical: 1,
      spiral: 0.08,
      split: 0,
      broken: 0,
      curl: 0.28,
      low: 0,
    },
    input: {
      amount: 0,
      flowX: 0,
      brightness: 0,
    },
    pointer: {
      x: 0,
      y: 0,
      lastX: 0,
      lastY: 0,
      lastMoveAt: 0,
      amount: 0,
      flowX: 0,
      active: false,
    },
    camera: {
      requested: false,
      ready: false,
      denied: false,
      previous: null,
      previousCenterX: 0.5,
      previousBrightness: 0,
      amount: 0,
      flowX: 0,
      brightness: 0,
      lastSample: 0,
    },
  };

  let width = 0;
  let height = 0;
  let dpr = 1;
  let lastFrame = performance.now();
  let ceramicSeeds = [];

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const positiveMod = (value, mod) => ((value % mod) + mod) % mod;
  const randomRange = (min, max) => min + Math.random() * (max - min);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 1.15);
    width = Math.max(320, rect.width);
    height = Math.max(480, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ceramicSeeds = Array.from({ length: 120 }, (_, index) => ({
      x: fract(Math.sin(index * 91.73) * 742.44),
      y: fract(Math.sin(index * 37.31) * 219.91),
      r: fract(Math.sin(index * 18.17) * 17.5),
      a: fract(Math.sin(index * 23.69) * 11.8),
    }));
  }

  function fract(value) {
    return value - Math.floor(value);
  }

  function hash2(x, y) {
    return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
  }

  function noise2(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
  }

  function getLayout() {
    const bowlWidth = clamp(width * 0.36, 190, 330);
    const bowlHeight = clamp(height * 0.12, 72, 116);
    const bowlY = height - clamp(height * 0.16, 96, 148);
    const baseY = bowlY - bowlHeight * 0.26;
    const stickLength = clamp(height * 0.39, 230, 390);
    const remaining = stickLength * (1 - state.burnProgress);
    const centerX = width * 0.5;
    const headY = baseY - Math.max(remaining, state.phase === "ended" ? 0 : 12);

    return {
      centerX,
      bowl: {
        x: centerX,
        y: bowlY,
        w: bowlWidth,
        h: bowlHeight,
      },
      baseY,
      stickLength,
      head: {
        x: centerX,
        y: headY,
      },
      topInitial: baseY - stickLength,
    };
  }

  function ignite(now = performance.now()) {
    if (state.phase !== "idle") return;

    const layout = getLayout();
    state.phase = "igniting";
    state.ignitionStart = now;
    state.burnStart = now + 1300;
    state.lastPromptAt = now;
    startHintDissolve(layout, now);
    setCameraStatus("正在借一缕风", true);
    window.setTimeout(() => requestCamera(), 900);

    for (let i = 0; i < 26; i += 1) {
      spawnSpark(layout.head.x, layout.head.y, true);
    }
    for (let i = 0; i < 2; i += 1) {
      spawnSmoke(layout.head, 1.12);
    }
  }

  async function requestCamera() {
    if (state.camera.requested || !navigator.mediaDevices?.getUserMedia) {
      if (!navigator.mediaDevices?.getUserMedia) {
        state.camera.denied = true;
        setCameraStatus("以手代风", true);
      }
      return;
    }

    state.camera.requested = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 96 },
          height: { ideal: 72 },
        },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      motionBuffer.width = 64;
      motionBuffer.height = 48;
      state.camera.ready = true;
      state.camera.denied = false;
      setCameraStatus("摄像头已入场", true);
      window.setTimeout(() => setCameraStatus("", false), 2800);
    } catch {
      state.camera.denied = true;
      state.camera.ready = false;
      setCameraStatus("以手代风", true);
      window.setTimeout(() => setCameraStatus("", false), 3600);
    }
  }

  function setCameraStatus(text, visible) {
    cameraState.textContent = text;
    cameraState.classList.toggle("is-visible", visible && Boolean(text));
  }

  function getHintPosition(layout) {
    return {
      x: layout.head.x,
      y: Math.max(72, layout.head.y - clamp(height * 0.062, 38, 56)),
    };
  }

  function startHintDissolve(layout, now) {
    state.hint.phase = "dissolving";
    state.hint.dissolveStart = now;
    state.hint.wisps = [];

    const hint = getHintPosition(layout);
    const fontSize = clamp(width * 0.027, 18, 30);
    const letterGap = fontSize * 1.05;
    for (let letter = 0; letter < 3; letter += 1) {
      const baseX = hint.x + (letter - 1) * letterGap;
      for (let i = 0; i < 16; i += 1) {
        state.hint.wisps.push({
          x: baseX + randomRange(-fontSize * 0.34, fontSize * 0.34),
          y: hint.y + randomRange(-fontSize * 0.36, fontSize * 0.36),
          vx: randomRange(-7, 7) + (letter - 1) * randomRange(1, 5),
          vy: randomRange(-20, -6),
          age: 0,
          life: randomRange(2.4, 3.9),
          size: randomRange(0.28, 1.05),
          seed: randomRange(0, 1000),
        });
      }
    }
  }

  function spawnSpark(x, y, burst = false) {
    const angle = randomRange(-Math.PI, 0);
    const speed = burst ? randomRange(18, 90) : randomRange(6, 22);
    state.sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed + randomRange(-8, 8),
      vy: Math.sin(angle) * speed - randomRange(8, 24),
      age: 0,
      life: randomRange(0.35, burst ? 1.2 : 0.7),
      size: randomRange(0.6, burst ? 2.4 : 1.2),
    });
  }

  function spawnSmoke(head, strength = 1) {
    const splitSign = Math.random() < 0.5 ? -1 : 1;
    const shape = state.shape;
    const input = state.input;
    const now = performance.now();
    const ignitionStir = getIgnitionStir(now);
    const ignitionFlow = getIgnitionFlow(now);
    const ignitionLift = state.phase === "igniting" ? 1.25 : 1;
    const disturbance = clamp(
      input.amount * 0.92 + Math.abs(input.flowX) * 0.84 + shape.split * 0.24 + ignitionStir * 0.36,
      0,
      1,
    );
    const startX = head.x + randomRange(-1.1 - disturbance * 2.4 - ignitionStir * 2.2, 1.1 + disturbance * 2.4 + ignitionStir * 2.2);
    const startY = head.y + randomRange(-2.2, 1);
    const trailLength = Math.round(randomRange(44, 74) * (1 - ignitionStir * 0.2));
    const trail = [{ x: startX, y: startY }];

    state.particles.push({
      x: startX,
      y: startY,
      vx:
        (input.flowX + ignitionFlow * 0.5) * randomRange(7, 20) +
        disturbance * splitSign * randomRange(4, 14) +
        ignitionStir * splitSign * randomRange(5, 18),
      vy: randomRange(-31, -18) * ignitionLift * (1 - disturbance * 0.28),
      age: 0,
      life: randomRange(8.2, 12.8) * (1 - ignitionStir * 0.38) * (shape.low > 0.5 ? 0.9 : 1),
      width: randomRange(3.6, 8.8) * strength,
      seed: randomRange(0, 1000),
      spin: randomRange(-1, 1),
      silk: randomRange(0.72, 1.35),
      baseAlpha: randomRange(0.094, 0.19) * clamp(strength, 0.72, 1.28),
      splitSign,
      ribbon: Math.random() < 0.42,
      trail,
      trailLength,
      trailClock: randomRange(0, 0.04),
    });
  }

  function spawnWord(text, x, y, life = 5200) {
    state.words.push({
      text,
      x,
      y,
      startX: x,
      startY: y,
      age: 0,
      life,
      seed: randomRange(0, 1000),
    });
  }

  function getIgnitionStir(now) {
    if ((state.phase !== "igniting" && state.phase !== "burning") || !state.ignitionStart) return 0;
    const age = (now - state.ignitionStart) / 1000;
    if (age <= 0 || age >= 20) return 0;
    return smoothstep(0, 0.9, age) * (1 - smoothstep(15.5, 20, age));
  }

  function getIgnitionFlow(now) {
    const stir = getIgnitionStir(now);
    if (!stir) return 0;
    const slow = Math.sin(now * 0.00105);
    const soft = noise2(now * 0.00042, 7.3) - 0.5;
    return clamp((slow * 0.62 + soft * 1.15) * stir, -1, 1);
  }

  function update(now, dt) {
    updateBurn(now);
    updateInput(now, dt);
    updateShape(dt);
    updateHint(now, dt);
    updateSmoke(now, dt);
    updateSparks(dt);
    updateWords(dt);
    maybeSpawnPrompt(now);
  }

  function updateBurn(now) {
    if (state.phase === "igniting" && now >= state.burnStart) {
      state.phase = "burning";
    }

    if (state.phase === "igniting") {
      state.burnProgress = 0;
      return;
    }

    if (state.phase === "burning") {
      state.burnProgress = clamp((now - state.burnStart) / state.burnDuration, 0, 1);
      if (state.burnProgress >= 1) {
        state.phase = "ended";
        state.finalWordSpawned = false;
      }
    }

    if (state.phase === "ended" && !state.finalWordSpawned) {
      const layout = getLayout();
      spawnWord("香尽，愿留", layout.centerX, layout.topInitial - 20, 12000);
      state.finalWordSpawned = true;
      setCameraStatus("", false);
    }
  }

  function updateInput(now, dt) {
    state.pointer.amount *= Math.exp(-dt * 1);
    state.pointer.flowX *= Math.exp(-dt * 1.15);

    if (state.camera.ready && now - state.camera.lastSample > 150) {
      sampleCamera(now);
    }

    state.camera.amount *= Math.exp(-dt * 0.3);
    state.camera.flowX *= Math.exp(-dt * 0.42);

    const cameraWeight = state.camera.ready ? 0.68 : 0;
    const pointerWeight = state.camera.ready ? 0.48 : 1;
    const cameraAir = state.camera.ready ? 0.16 : 0;
    const targetAmount = clamp(
      state.camera.amount * cameraWeight + state.pointer.amount * pointerWeight + cameraAir,
      0,
      1,
    );
    const targetFlowX = clamp(
      state.camera.flowX * cameraWeight + state.pointer.flowX * pointerWeight,
      -1,
      1,
    );

    state.input.amount = lerp(state.input.amount, targetAmount, 1 - Math.exp(-dt * 1.85));
    state.input.flowX = lerp(state.input.flowX, targetFlowX, 1 - Math.exp(-dt * 2.2));
    state.input.brightness = lerp(
      state.input.brightness,
      state.camera.brightness,
      1 - Math.exp(-dt * 0.68),
    );
  }

  function sampleCamera(now) {
    if (!video.videoWidth || !video.videoHeight) return;

    const w = motionBuffer.width;
    const h = motionBuffer.height;
    motionCtx.save();
    motionCtx.scale(-1, 1);
    motionCtx.drawImage(video, -w, 0, w, h);
    motionCtx.restore();

    const data = motionCtx.getImageData(0, 0, w, h).data;
    const current = new Uint8ClampedArray(w * h);
    let brightness = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      current[p] = gray;
      brightness += gray;
    }
    brightness /= current.length * 255;

    if (!state.camera.previous) {
      state.camera.previous = current;
      state.camera.previousBrightness = brightness;
      state.camera.lastSample = now;
      return;
    }

    let diffSum = 0;
    let weightedX = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const index = y * w + x;
        const diff = Math.abs(current[index] - state.camera.previous[index]);
        if (diff > 9) {
          diffSum += diff;
          weightedX += diff * (x / (w - 1));
        }
      }
    }

    const rawAmount = clamp(diffSum / (w * h * 255 * 0.18), 0, 1);
    const centerX = diffSum > 0 ? weightedX / diffSum : state.camera.previousCenterX;
    const flowX = clamp((centerX - state.camera.previousCenterX) * 7.5, -1, 1);
    const brightnessDelta = Math.abs(brightness - state.camera.previousBrightness);

    state.camera.amount = lerp(
      state.camera.amount,
      clamp(rawAmount + brightnessDelta * 3.4, 0, 1),
      0.3,
    );
    state.camera.flowX = lerp(state.camera.flowX, flowX, 0.34);
    state.camera.brightness = lerp(state.camera.brightness, brightnessDelta, 0.38);
    state.camera.previous = current;
    state.camera.previousCenterX = lerp(state.camera.previousCenterX, centerX, 0.24);
    state.camera.previousBrightness = brightness;
    state.camera.lastSample = now;
  }

  function updateShape(dt) {
    const now = performance.now();
    const motion = state.input.amount;
    const flow = Math.abs(state.input.flowX);
    const breath = 0.5 + Math.sin(now * 0.00023) * 0.5;
    const ignitionStir = getIgnitionStir(now);
    const ignitionFlow = Math.abs(getIgnitionFlow(now));
    const cameraAir = state.camera.ready ? 0.18 : 0;
    const disturbance = clamp(
      motion * 0.92 + flow * 0.84 + state.input.brightness * 0.44 + cameraAir + ignitionStir * 0.34 + ignitionFlow * 0.18,
      0,
      1,
    );

    const target = {
      vertical: clamp(0.98 - disturbance * 0.96 - ignitionStir * 0.16, 0.06, 0.98),
      spiral: clamp(0.04 + breath * 0.04, 0.02, 0.1),
      split: clamp(flow * 1.15 + ignitionFlow * 0.38 + smoothstep(0.14, 0.72, disturbance) * 0.68 + ignitionStir * 0.18, 0, 1),
      broken: clamp(smoothstep(0.5, 0.98, disturbance) * 0.42 + ignitionStir * 0.08, 0, 1),
      curl: clamp(0.24 + disturbance * 0.22 + breath * 0.08 + ignitionStir * 0.16, 0.18, 0.68),
      low: clamp(smoothstep(0.42, 0.95, disturbance) * 0.82 + state.input.brightness * 0.42 + ignitionStir * 0.08, 0, 1),
    };

    const t = 1 - Math.exp(-dt * 0.52);
    Object.keys(state.shape).forEach((key) => {
      state.shape[key] = lerp(state.shape[key], target[key], t);
    });

    const scores = {
      straight: state.shape.vertical * 1.18 - disturbance * 0.36,
      spiral: state.shape.spiral * 0.34,
      split: state.shape.split * 0.95,
      broken: state.shape.broken * 1.08,
      curl: state.shape.curl * (1 - disturbance * 0.62),
      low: state.shape.low,
    };
    let nextMode = state.activeMode;
    let topScore = -Infinity;
    Object.entries(scores).forEach(([mode, score]) => {
      if (score > topScore) {
        topScore = score;
        nextMode = mode;
      }
    });

    if (nextMode !== state.activeMode) {
      if (state.modeCandidate !== nextMode) {
        state.modeCandidate = nextMode;
        state.modeCandidateSince = now;
      }
      const minStay = state.activeMode === "straight" ? 5200 : 6200;
      const candidateHold = state.camera.ready ? 2200 : 1600;
      if (now - state.modeSince > minStay && now - state.modeCandidateSince > candidateHold) {
        state.activeMode = nextMode;
        state.modeSince = now;
      }
    } else {
      state.modeCandidate = nextMode;
      state.modeCandidateSince = now;
    }
  }

  function updateHint(now, dt) {
    if (state.hint.phase !== "dissolving") return;

    const ageMs = now - state.hint.dissolveStart;
    for (let i = state.hint.wisps.length - 1; i >= 0; i -= 1) {
      const wisp = state.hint.wisps[i];
      wisp.age += dt;
      const life = wisp.age / wisp.life;
      const n = noise2(wisp.seed, wisp.age * 0.9 + now * 0.00012) - 0.5;
      wisp.vx += n * dt * 14;
      wisp.vy -= dt * 3.6;
      wisp.x += wisp.vx * dt;
      wisp.y += wisp.vy * dt;
      if (life >= 1) state.hint.wisps.splice(i, 1);
    }

    if (ageMs > 3900 && !state.hint.wisps.length) {
      state.hint.phase = "done";
    }
  }

  function updateSmoke(now, dt) {
    const layout = getLayout();
    const burning = state.phase === "igniting" || state.phase === "burning";
    const ignitionStir = getIgnitionStir(now);
    const ignitionFlow = getIgnitionFlow(now);
    if (burning) {
      const ignitionBoost = state.phase === "igniting" ? 1.25 : 1;
      const brokenGate = 1 - state.shape.broken * 0.14;
      const rate =
        (6.4 + state.shape.vertical * 1.2 + state.shape.curl * 3 + state.shape.split * 5.2 + state.shape.low * 2.2 + ignitionStir * 2.6) *
        ignitionBoost *
        brokenGate;
      state.smokeAccumulator += dt * rate;
      const count = Math.min(3, Math.floor(state.smokeAccumulator));
      state.smokeAccumulator -= count;
      for (let i = 0; i < count && state.particles.length < 88; i += 1) {
        spawnSmoke(layout.head, state.phase === "igniting" ? 1.08 : 1);
      }

      if (Math.random() < dt * (state.phase === "igniting" ? 24 : 2.2)) {
        spawnSpark(layout.head.x, layout.head.y, state.phase === "igniting");
      }
    }

    const input = state.input;
    const shape = state.shape;
    const disturbance = clamp(
      input.amount * 1.06 +
        Math.abs(input.flowX) * 0.86 +
        Math.abs(ignitionFlow) * 0.26 +
        shape.split * 0.28 +
        shape.broken * 0.32 +
        ignitionStir * 0.32 +
        (state.camera.ready ? 0.14 : 0),
      0,
      1,
    );
    const spread = smoothstep(0.12, 0.86, disturbance);
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const p = state.particles[i];
      p.age += dt;
      const n = noise2(p.x * 0.006 + p.seed, p.y * 0.005 - now * 0.00016);
      const n2 = noise2(p.x * 0.004 - p.seed, p.age * 0.55 + now * 0.00012);
      const life = p.age / p.life;
      const lift = 1 - smoothstep(0.58, 1, life) * 0.42;
      const ageSpread = smoothstep(0.14, 0.92, life);
      const combinedFlow = input.flowX + ignitionFlow * 0.58;
      const splitDrift = (p.splitSign * 0.34 + p.spin * 0.58) * spread * ageSpread * (20 + input.amount * 74 + ignitionStir * 36);
      const curlDrift = (n - 0.5) * (7 + shape.curl * 14 + spread * 84 + ignitionStir * 32);
      const flowDrift = combinedFlow * ageSpread * (44 + input.amount * 138 + ignitionStir * 62);
      const silkDrift = Math.sin(p.seed + p.age * (0.48 + p.silk * 0.18)) * spread * ageSpread * (18 + p.silk * 20 + ignitionStir * 16);
      const lowTurn = shape.low * smoothstep(0.16, 0.7, life) * (16 + input.amount * 22);
      const targetVx = curlDrift + splitDrift + flowDrift + silkDrift + p.spin * lowTurn * 0.12;
      const targetVy =
        -30 * (0.64 + shape.vertical * 0.82) * lift * (1 - spread * 0.5) -
        shape.curl * 2.4 +
        shape.low * smoothstep(0.18, 0.86, life) * 30 +
        spread * ageSpread * 18 +
        ignitionStir * ageSpread * 9 +
        (n2 - 0.5) * (8 + spread * 12);

      p.vx = lerp(p.vx, targetVx, 1 - Math.exp(-dt * 0.58));
      p.vy = lerp(p.vy, targetVy, 1 - Math.exp(-dt * 0.55));
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.width += dt * (0.58 + spread * 3.15 + shape.low * 0.95);
      p.trailClock += dt;
      if (p.trail.length) {
        const headPoint = p.trail[p.trail.length - 1];
        headPoint.x = p.x;
        headPoint.y = p.y;
      }
      if (p.trailClock >= 0.042) {
        p.trail.push({ x: p.x, y: p.y });
        p.trailClock %= 0.042;
        if (p.trail.length > p.trailLength) p.trail.shift();
      }

      if (spread > 0.06 && Math.abs(combinedFlow) > 0.015 && p.trail.length > 4) {
        const windPush = combinedFlow * dt * (54 + input.amount * 156 + ignitionStir * 86);
        const loosen = spread * dt * (2.5 + input.amount * 8 + ignitionStir * 5);
        for (let j = 0; j < p.trail.length - 1; j += 1) {
          const local = j / (p.trail.length - 1);
          const influence = smoothstep(0.08, 1, local) * (0.28 + local * 0.9);
          p.trail[j].x += windPush * influence;
          p.trail[j].y += loosen * smoothstep(0.3, 1, local);
        }
      }

      const fadeIn = smoothstep(0.02, 0.2, life);
      const fadeOut = Math.pow(clamp(1 - life, 0, 1), 0.55);
      p.alpha = p.baseAlpha * fadeIn * fadeOut * (1 - spread * 0.18) * (1 - shape.broken * 0.18);

      if (shape.broken > 0.14) {
        const veilNoise = noise2(p.seed * 0.73 + p.age * 0.18, p.seed * 0.19 + life * 1.6);
        const veil = smoothstep(0.22, 0.86, veilNoise);
        p.alpha *= lerp(1, 0.62 + veil * 0.34, shape.broken);
      }

      if (p.age >= p.life || p.y < -120 || p.x < -160 || p.x > width + 160) {
        state.particles.splice(i, 1);
      }
    }
  }

  function updateSparks(dt) {
    for (let i = state.sparks.length - 1; i >= 0; i -= 1) {
      const s = state.sparks[i];
      s.age += dt;
      s.vy += 36 * dt;
      s.vx *= 1 - dt * 0.8;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.age >= s.life) state.sparks.splice(i, 1);
    }
  }

  function updateWords(dt) {
    for (let i = state.words.length - 1; i >= 0; i -= 1) {
      const word = state.words[i];
      word.age += dt * 1000;
      const life = word.age / word.life;
      word.x = word.startX + Math.sin(life * Math.PI * 1.25 + word.seed) * 12;
      word.y = word.startY - life * 22 + Math.sin(word.seed + life * 3.2) * 4.5;
      if (word.age >= word.life) state.words.splice(i, 1);
    }
  }

  function maybeSpawnPrompt(now) {
    if (state.phase !== "burning") return;
    const group = promptGroupByMode[state.activeMode] || "peaceful";
    const maxWords = group === "settling" ? 4 : 2;
    if (state.words.length >= maxWords) return;
    const minGap = group === "settling" ? 6500 : state.activeMode === "straight" ? 15500 : 13500;
    if (now - state.lastPromptAt < minGap) return;

    const pool = prompts[group];
    const text = pool[Math.floor(Math.random() * pool.length)];
    const layout = getLayout();
    const verticalOffset = randomRange(86, Math.min(280, height * 0.42));
    const side = state.input.flowX * 80 + randomRange(-48, 48);
    const life = group === "settling" ? randomRange(6800, 9200) : randomRange(7600, 10800);
    spawnWord(text, layout.head.x + side, layout.head.y - verticalOffset, life);
    state.lastPromptAt = now;
  }

  function draw(now) {
    ctx.clearRect(0, 0, width, height);
    drawAmbient(now);
    drawSmoke(now);
    drawHint(now);
    drawWords();
    drawBowlAndIncense(now);
    drawSparks();
  }

  function drawAmbient(now) {
    const layout = getLayout();
    const head = layout.head;

    ctx.save();
    const tableY = layout.bowl.y + layout.bowl.h * 0.28;
    const table = ctx.createLinearGradient(0, tableY - 40, 0, height);
    table.addColorStop(0, "rgba(47, 34, 21, 0)");
    table.addColorStop(0.28, "rgba(47, 34, 21, 0.18)");
    table.addColorStop(1, "rgba(9, 6, 4, 0.34)");
    ctx.fillStyle = table;
    ctx.fillRect(0, tableY - 40, width, height - tableY + 40);

    const glowPower =
      state.phase === "idle"
        ? 0.08
        : state.phase === "ended"
          ? 0
          : state.phase === "igniting"
            ? 0.42 + Math.sin(now * 0.012) * 0.08
            : 0.18 + Math.sin(now * 0.004) * 0.035;
    if (glowPower > 0) {
      const glow = ctx.createRadialGradient(head.x, head.y, 2, head.x, head.y, 170);
      glow.addColorStop(0, `rgba(220, 116, 43, ${0.24 * glowPower})`);
      glow.addColorStop(0.26, `rgba(160, 80, 36, ${0.12 * glowPower})`);
      glow.addColorStop(1, "rgba(160, 80, 36, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    }

    const floorShadow = ctx.createRadialGradient(
      layout.bowl.x,
      tableY + layout.bowl.h * 0.12,
      12,
      layout.bowl.x,
      tableY + layout.bowl.h * 0.12,
      layout.bowl.w * 0.82,
    );
    floorShadow.addColorStop(0, "rgba(0, 0, 0, 0.46)");
    floorShadow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = floorShadow;
    ctx.beginPath();
    ctx.ellipse(layout.bowl.x, tableY + layout.bowl.h * 0.16, layout.bowl.w * 0.6, layout.bowl.h * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSmoke(now) {
    if (!state.particles.length) return;

    const ignitionStir = getIgnitionStir(now);
    const disturbance = clamp(
      state.input.amount * 1.02 + Math.abs(state.input.flowX) * 0.84 + state.shape.split * 0.28 + ignitionStir * 0.3 + (state.camera.ready ? 0.14 : 0),
      0,
      1,
    );
    const spread = smoothstep(0.08, 0.78, disturbance);

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    state.particles.forEach((p) => {
      const life = p.age / p.life;
      const alpha = clamp(p.alpha, 0, 0.2);
      if (alpha <= 0.004 || p.trail.length < 3) return;

      drawSmokeTrail(p, alpha * (0.2 + spread * 0.08), p.width * (2.32 + spread * 1.8 + life * 0.58), "rgba(150, 163, 157, ALPHA)");
      drawSmokeTrail(p, alpha * (0.33 - spread * 0.02), p.width * (0.52 + spread * 0.48 + life * 0.12), "rgba(214, 221, 213, ALPHA)");
    });
    ctx.restore();
  }

  function drawSmokeTrail(p, alpha, baseWidth, colorTemplate) {
    const points = p.trail;
    if (points.length < 3) return;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const step = Math.max(2, Math.ceil(points.length / 18));
    for (let i = step; i < points.length; i += step) {
      const from = points[Math.max(0, i - step)];
      const control = points[Math.max(0, i - Math.ceil(step / 2))];
      const to = points[i];
      const local = i / (points.length - 1);
      const rootFade = smoothstep(0, 0.26, local);
      const body = Math.pow(Math.sin(local * Math.PI), 0.42);
      const topFade = 1 - local * 0.38;
      const segmentAlpha = alpha * rootFade * (0.26 + body * 0.5) * topFade;
      const segmentWidth = baseWidth * rootFade * (0.16 + body * 0.68) * (1 - local * 0.34);
      if (segmentAlpha <= 0.0015 || segmentWidth <= 0.08) continue;

      ctx.strokeStyle = colorTemplate.replace("ALPHA", segmentAlpha.toFixed(4));
      ctx.lineWidth = clamp(segmentWidth, 0.2, 20);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
      ctx.stroke();
    }
  }

  function drawHint(now) {
    if (state.hint.phase === "done") return;

    const layout = getLayout();
    const hint = getHintPosition(layout);
    const fontSize = clamp(width * 0.027, 18, 30);

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${fontSize}px "Noto Serif SC", "Songti SC", "STSong", serif`;
    ctx.shadowColor = "rgba(185, 150, 110, 0.24)";
    ctx.shadowBlur = 20;

    if (state.hint.phase === "waiting") {
      const breathCycle = 5200;
      const breathWave = (1 - Math.cos((now / breathCycle) * Math.PI * 2)) * 0.5;
      const breath = smoothstep(0, 1, breathWave);
      const blur = breath * 1.75;
      ctx.shadowBlur = 14 + breath * 18;
      ctx.globalAlpha = 0.78 - breath * 0.12;
      ctx.filter = `blur(${blur.toFixed(2)}px)`;
      ctx.fillStyle = "rgba(226, 222, 205, 0.74)";
      ctx.fillText("请点香", hint.x, hint.y);
      if (breath < 0.55) {
        ctx.filter = "none";
        ctx.globalAlpha = (0.55 - breath) * 0.38;
        ctx.fillStyle = "rgba(244, 239, 218, 0.82)";
        ctx.fillText("请点香", hint.x, hint.y);
      }
      ctx.restore();
      return;
    }

    const age = Math.max(0, (now - state.hint.dissolveStart) / 1000);
    const textAlpha = 1 - smoothstep(0.08, 1.25, age);
    if (textAlpha > 0.01) {
      ctx.globalAlpha = textAlpha * 0.68;
      ctx.filter = `blur(${smoothstep(0, 1.25, age) * 3.2}px)`;
      ctx.fillStyle = "rgba(226, 222, 205, 0.72)";
      ctx.fillText("请点香", hint.x, hint.y - age * 4);
      ctx.filter = "none";
    }

    ctx.globalAlpha = 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    state.hint.wisps.forEach((wisp) => {
      const life = wisp.age / wisp.life;
      const alpha = Math.pow(clamp(1 - life, 0, 1), 1.35) * 0.18;
      if (alpha <= 0.006) return;
      const curl = Math.sin(wisp.seed + life * 4.6) * (5 + life * 12);
      const lift = life * (12 + wisp.size * 7);
      ctx.strokeStyle = `rgba(207, 216, 208, ${alpha.toFixed(4)})`;
      ctx.lineWidth = wisp.size * (0.82 + life * 1.2);
      ctx.beginPath();
      ctx.moveTo(wisp.x, wisp.y);
      ctx.quadraticCurveTo(
        wisp.x + curl * 0.45,
        wisp.y - lift * 0.45,
        wisp.x + curl,
        wisp.y - lift,
      );
      ctx.stroke();
    });

    ctx.restore();
  }

  function drawWords() {
    if (!state.words.length) return;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    state.words.forEach((word) => {
      const life = word.age / word.life;
      const alpha = smoothstep(0, 0.16, life) * (1 - smoothstep(0.74, 1, life));
      const size = word.text.length > 5 ? clamp(width * 0.022, 16, 25) : clamp(width * 0.027, 18, 30);
      ctx.font = `${size}px "Noto Serif SC", "Songti SC", "STSong", serif`;
      ctx.globalAlpha = alpha * 0.76;
      ctx.filter = alpha > 0.55 ? "none" : `blur(${(1 - alpha) * 2.2}px)`;
      ctx.fillStyle = "rgba(226, 222, 205, 0.82)";
      ctx.shadowColor = "rgba(185, 150, 110, 0.26)";
      ctx.shadowBlur = 24;
      ctx.fillText(word.text, word.x, word.y);
    });
    ctx.restore();
  }

  function drawBowlAndIncense(now) {
    const layout = getLayout();
    drawIncenseBack(layout, now);
    drawBowl(layout);
    drawIncenseFront(layout, now);
  }

  function drawIncenseBack(layout) {
    const { centerX, baseY, head, stickLength } = layout;
    const lit = state.phase === "igniting" || state.phase === "burning";
    const ended = state.phase === "ended";
    const remaining = stickLength * (1 - state.burnProgress);
    const visibleTop = ended ? baseY - 4 : head.y;

    ctx.save();
    ctx.lineCap = "round";

    if (!ended && remaining > 4) {
      const stickGradient = ctx.createLinearGradient(centerX - 3, visibleTop, centerX + 3, baseY);
      stickGradient.addColorStop(0, lit ? "#4c3020" : "#2e241b");
      stickGradient.addColorStop(0.48, "#5a3a22");
      stickGradient.addColorStop(1, "#241811");
      ctx.strokeStyle = stickGradient;
      ctx.lineWidth = clamp(width * 0.004, 2.4, 4.4);
      ctx.beginPath();
      ctx.moveTo(centerX, visibleTop);
      ctx.lineTo(centerX, baseY + layout.bowl.h * 0.18);
      ctx.stroke();

      const sideLight = ctx.createLinearGradient(centerX - 2, visibleTop, centerX + 2, visibleTop);
      sideLight.addColorStop(0, "rgba(0,0,0,0)");
      sideLight.addColorStop(0.66, "rgba(204, 145, 86, 0.18)");
      sideLight.addColorStop(1, "rgba(0,0,0,0)");
      ctx.strokeStyle = sideLight;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX + 1.3, visibleTop + 6);
      ctx.lineTo(centerX + 1.3, baseY + layout.bowl.h * 0.08);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawIncenseFront(layout, now) {
    const { centerX, baseY, head, stickLength, bowl } = layout;
    const lit = state.phase === "igniting" || state.phase === "burning";
    const ended = state.phase === "ended";
    const remaining = stickLength * (1 - state.burnProgress);
    const visibleTop = ended ? baseY - bowl.h * 0.08 : head.y;
    const bridgeTop = baseY - bowl.h * 0.18;
    const bridgeBottom = baseY + bowl.h * 0.045;

    ctx.save();
    ctx.lineCap = "round";

    if (!ended && remaining > 4) {
      const foregroundTop = Math.max(visibleTop, bridgeTop);
      const stickGradient = ctx.createLinearGradient(centerX - 3, foregroundTop, centerX + 3, bridgeBottom);
      stickGradient.addColorStop(0, state.phase === "idle" ? "#3e2d20" : "#563521");
      stickGradient.addColorStop(0.52, "#5a3a22");
      stickGradient.addColorStop(1, "#2b1c13");
      ctx.strokeStyle = stickGradient;
      ctx.lineWidth = clamp(width * 0.004, 2.4, 4.4);
      ctx.beginPath();
      ctx.moveTo(centerX, foregroundTop);
      ctx.lineTo(centerX, bridgeBottom);
      ctx.stroke();

      ctx.strokeStyle = "rgba(204, 145, 86, 0.14)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX + 1.3, foregroundTop + 2);
      ctx.lineTo(centerX + 1.3, bridgeBottom - 2);
      ctx.stroke();
    }

    if (ended) {
      ctx.strokeStyle = "rgba(90, 84, 72, 0.45)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(centerX, visibleTop);
      ctx.lineTo(centerX, baseY + bowl.h * 0.035);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (lit) {
      const ignition = state.phase === "igniting" ? smoothstep(0, 1, (now - state.ignitionStart) / 1300) : 1;
      const ember = 0.62 + Math.sin(now * 0.016) * 0.12 + ignition * 0.24;
      const ashLength = clamp(10 + state.burnProgress * 32, 10, 42);

      ctx.strokeStyle = "rgba(181, 180, 166, 0.52)";
      ctx.lineWidth = clamp(width * 0.003, 1.8, 3.2);
      ctx.beginPath();
      ctx.moveTo(centerX, head.y + 1);
      ctx.lineTo(centerX + Math.sin(now * 0.002) * 1.2, Math.min(head.y + ashLength, baseY + bowl.h * 0.04));
      ctx.stroke();

      const glow = ctx.createRadialGradient(centerX, head.y, 0.4, centerX, head.y, 18 + ember * 15);
      glow.addColorStop(0, `rgba(255, 165, 76, ${0.82 * ember})`);
      glow.addColorStop(0.18, `rgba(221, 78, 32, ${0.55 * ember})`);
      glow.addColorStop(1, "rgba(221, 78, 32, 0)");
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(centerX, head.y, 19 + ember * 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";

      ctx.fillStyle = `rgba(255, ${Math.round(96 + ember * 70)}, 54, ${0.88 * ember})`;
      ctx.beginPath();
      ctx.ellipse(centerX, head.y, 2.6, 4.2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(74, 55, 40, 0.92)";
      ctx.beginPath();
      ctx.ellipse(centerX, head.y, 2.1, 3.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawBowl(layout) {
    const bowl = layout.bowl;

    ctx.save();
    ctx.translate(bowl.x, bowl.y);

    const bodyGradient = ctx.createLinearGradient(0, -bowl.h * 0.55, 0, bowl.h * 0.62);
    bodyGradient.addColorStop(0, "#4c3a2a");
    bodyGradient.addColorStop(0.22, "#2e241b");
    bodyGradient.addColorStop(0.62, "#15100c");
    bodyGradient.addColorStop(1, "#090705");

    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.moveTo(-bowl.w * 0.5, -bowl.h * 0.14);
    ctx.bezierCurveTo(-bowl.w * 0.46, bowl.h * 0.32, -bowl.w * 0.26, bowl.h * 0.58, 0, bowl.h * 0.62);
    ctx.bezierCurveTo(bowl.w * 0.26, bowl.h * 0.58, bowl.w * 0.46, bowl.h * 0.32, bowl.w * 0.5, -bowl.h * 0.14);
    ctx.bezierCurveTo(bowl.w * 0.36, bowl.h * 0.04, -bowl.w * 0.36, bowl.h * 0.04, -bowl.w * 0.5, -bowl.h * 0.14);
    ctx.fill();

    const rimGradient = ctx.createLinearGradient(0, -bowl.h * 0.38, 0, bowl.h * 0.08);
    rimGradient.addColorStop(0, "#6d5740");
    rimGradient.addColorStop(0.34, "#34271d");
    rimGradient.addColorStop(1, "#0b0907");
    ctx.fillStyle = rimGradient;
    ctx.beginPath();
    ctx.ellipse(0, -bowl.h * 0.18, bowl.w * 0.51, bowl.h * 0.23, 0, 0, Math.PI * 2);
    ctx.fill();

    const hollow = ctx.createRadialGradient(0, -bowl.h * 0.2, bowl.w * 0.05, 0, -bowl.h * 0.18, bowl.w * 0.5);
    hollow.addColorStop(0, "#020201");
    hollow.addColorStop(0.52, "#0b0806");
    hollow.addColorStop(0.74, "rgba(82, 62, 45, 0.8)");
    hollow.addColorStop(1, "rgba(162, 126, 85, 0.55)");
    ctx.fillStyle = hollow;
    ctx.beginPath();
    ctx.ellipse(0, -bowl.h * 0.22, bowl.w * 0.43, bowl.h * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(226, 190, 136, 0.28)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, -bowl.h * 0.18, bowl.w * 0.5, bowl.h * 0.225, 0, Math.PI * 0.98, Math.PI * 1.98);
    ctx.stroke();

    ceramicSeeds.forEach((seed) => {
      const x = (seed.x - 0.5) * bowl.w * 0.92;
      const y = -bowl.h * 0.12 + seed.y * bowl.h * 0.58;
      if ((x / (bowl.w * 0.5)) ** 2 + ((y + bowl.h * 0.08) / (bowl.h * 0.66)) ** 2 > 1) return;
      ctx.fillStyle = `rgba(208, 174, 126, ${0.035 + seed.a * 0.09})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.45 + seed.r * 1.35, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }

  function drawSparks() {
    if (!state.sparks.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    state.sparks.forEach((s) => {
      const life = s.age / s.life;
      const alpha = (1 - life) * 0.8;
      ctx.fillStyle = `rgba(255, 150, 60, ${alpha})`;
      ctx.shadowColor = "rgba(255, 120, 44, 0.72)";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * (1 - life * 0.42), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function updateTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();

    const dayIndex = getDayGanzhiIndex(now);
    const yearIndex = getYearGanzhiIndex(now);
    const monthInfo = getMonthGanzhiInfo(now);
    const hourInfo = getHourGanzhiInfo(now, dayIndex);

    solarTimeEl.textContent = `${year}年${pad(month)}月${pad(day)}日 ${pad(hour)}:${pad(minute)}:${pad(second)} ${branches[hourInfo.branch]}时`;
    ganzhiTimeEl.textContent = `${stems[yearIndex % 10]}${branches[yearIndex % 12]}年 ${stems[monthInfo.stem]}${branches[monthInfo.branch]}月 ${stems[dayIndex % 10]}${branches[dayIndex % 12]}日 ${stems[hourInfo.stem]}${branches[hourInfo.branch]}时`;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function getYearGanzhiIndex(date) {
    const solarYear = isBeforeLiChun(date) ? date.getFullYear() - 1 : date.getFullYear();
    return positiveMod(solarYear - 4, 60);
  }

  function isBeforeLiChun(date) {
    const y = date.getFullYear();
    const lichun = new Date(y, 1, 4, 0, 0, 0);
    return date < lichun;
  }

  function getMonthGanzhiInfo(date) {
    const y = isBeforeLiChun(date) ? date.getFullYear() - 1 : date.getFullYear();
    const starts = [
      { date: new Date(y, 1, 4), branch: 2, ordinal: 0 },
      { date: new Date(y, 2, 6), branch: 3, ordinal: 1 },
      { date: new Date(y, 3, 5), branch: 4, ordinal: 2 },
      { date: new Date(y, 4, 6), branch: 5, ordinal: 3 },
      { date: new Date(y, 5, 6), branch: 6, ordinal: 4 },
      { date: new Date(y, 6, 7), branch: 7, ordinal: 5 },
      { date: new Date(y, 7, 8), branch: 8, ordinal: 6 },
      { date: new Date(y, 8, 8), branch: 9, ordinal: 7 },
      { date: new Date(y, 9, 8), branch: 10, ordinal: 8 },
      { date: new Date(y, 10, 7), branch: 11, ordinal: 9 },
      { date: new Date(y, 11, 7), branch: 0, ordinal: 10 },
      { date: new Date(y + 1, 0, 6), branch: 1, ordinal: 11 },
    ];
    let current = starts[0];
    for (const start of starts) {
      if (date >= start.date) current = start;
    }

    const yearStem = positiveMod(y - 4, 10);
    const tigerMonthStartStem = [2, 4, 6, 8, 0][yearStem % 5];
    return {
      branch: current.branch,
      stem: positiveMod(tigerMonthStartStem + current.ordinal, 10),
    };
  }

  function getDayGanzhiIndex(date) {
    const currentDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const anchorDay = Date.UTC(2026, 4, 19);
    const diff = Math.round((currentDay - anchorDay) / 86400000);
    return positiveMod(29 + diff, 60);
  }

  function getHourGanzhiInfo(date, dayIndex) {
    const branch = Math.floor((date.getHours() + 1) / 2) % 12;
    const dayStem = dayIndex % 10;
    const ratStem = [0, 2, 4, 6, 8][dayStem % 5];
    return {
      branch,
      stem: positiveMod(ratStem + branch, 10),
    };
  }

  function onPointerDown(event) {
    const point = eventPoint(event);
    state.pointer.x = point.x;
    state.pointer.y = point.y;
    state.pointer.lastX = point.x;
    state.pointer.lastY = point.y;
    state.pointer.lastMoveAt = performance.now();
    state.pointer.active = true;

    const layout = getLayout();
    const distance = Math.hypot(point.x - layout.head.x, point.y - layout.head.y);
    const hitRadius = clamp(width * 0.04, 24, 44);
    if (distance <= hitRadius) {
      ignite();
    }
  }

  function onPointerMove(event) {
    const now = performance.now();
    const point = eventPoint(event);
    const dx = point.x - state.pointer.lastX;
    const dy = point.y - state.pointer.lastY;
    const distance = Math.hypot(dx, dy);
    const elapsed = clamp((now - (state.pointer.lastMoveAt || now - 16.7)) / 16.7, 0.55, 3.2);
    const frameDx = dx / elapsed;
    const frameDistance = distance / elapsed;
    state.pointer.x = point.x;
    state.pointer.y = point.y;
    state.pointer.lastX = point.x;
    state.pointer.lastY = point.y;
    state.pointer.lastMoveAt = now;
    const motion = clamp(frameDistance / 16, 0, 1);
    const flow = clamp(frameDx / 34, -1, 1);
    const amountEase = motion > state.pointer.amount ? 0.42 : 0.18;
    state.pointer.amount = lerp(state.pointer.amount, motion, amountEase);
    state.pointer.flowX = clamp(lerp(state.pointer.flowX, flow, 0.3), -1, 1);
  }

  function onPointerUp() {
    state.pointer.active = false;
  }

  function eventPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const source = event.touches?.[0] || event.changedTouches?.[0] || event;
    return {
      x: source.clientX - rect.left,
      y: source.clientY - rect.top,
    };
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;
    if (state.particles.length > 82 && dt > 0.034) {
      state.particles.splice(0, state.particles.length - 82);
    }
    update(now, dt);
    draw(now);
    requestAnimationFrame(tick);
  }

  window.addEventListener("resize", resize);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
  canvas.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false });

  resize();
  updateTime();
  window.setInterval(updateTime, 1000);
  requestAnimationFrame((now) => {
    lastFrame = now;
    requestAnimationFrame(tick);
  });
})();

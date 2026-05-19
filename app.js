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
    straight: ["清明", "定心", "许愿", "静观", "愿力上行"],
    spiral: ["能量汇聚", "思绪回环", "内在对话", "灵感升起"],
    split: ["分心", "选择", "交会", "扰动", "需要安静"],
    broken: ["气息不稳", "暂停", "调整", "回到当下"],
    curl: ["和谐", "流动", "灵性", "创造", "安然"],
    low: ["返气", "牵挂", "旧事浮现", "理清思绪"],
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
    lastPromptAt: 0,
    activeMode: "straight",
    modeSince: 0,
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
    dpr = Math.min(window.devicePixelRatio || 1, 1.45);
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

    state.phase = "igniting";
    state.ignitionStart = now;
    state.burnStart = now + 1300;
    quietHint.classList.add("is-hidden");
    setCameraStatus("正在借一缕风", true);
    requestCamera();

    const layout = getLayout();
    for (let i = 0; i < 38; i += 1) {
      spawnSpark(layout.head.x, layout.head.y, true);
    }
    for (let i = 0; i < 5; i += 1) {
      spawnSmoke(layout.head, 1.12);
    }
    spawnWord("火起", layout.head.x, layout.head.y - 42, 2600);
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
    const ignitionLift = state.phase === "igniting" ? 1.25 : 1;
    const startX = head.x + randomRange(-1.1, 1.1);
    const startY = head.y + randomRange(-2.2, 1);
    const trailLength = Math.round(randomRange(44, 72));
    const trail = [{ x: startX, y: startY }];

    state.particles.push({
      x: startX,
      y: startY,
      vx: input.flowX * randomRange(5, 16) + shape.split * splitSign * randomRange(3, 13),
      vy: randomRange(-34, -22) * ignitionLift,
      age: 0,
      life: randomRange(6.8, 11.5) * (shape.low > 0.5 ? 0.82 : 1),
      width: randomRange(2.6, 6.4) * strength,
      seed: randomRange(0, 1000),
      spin: randomRange(-1, 1),
      baseAlpha: randomRange(0.055, 0.13) * clamp(strength, 0.72, 1.25),
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

  function update(now, dt) {
    updateBurn(now);
    updateInput(now, dt);
    updateShape(dt);
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
      spawnWord("香尽，愿留", layout.centerX, layout.topInitial - 20, 9000);
      state.finalWordSpawned = true;
      setCameraStatus("", false);
    }
  }

  function updateInput(now, dt) {
    state.pointer.amount *= Math.exp(-dt * 2.2);
    state.pointer.flowX *= Math.exp(-dt * 2.7);

    if (state.camera.ready && now - state.camera.lastSample > 150) {
      sampleCamera(now);
    }

    state.camera.amount *= Math.exp(-dt * 0.45);
    state.camera.flowX *= Math.exp(-dt * 0.65);

    const cameraWeight = state.camera.ready ? 0.78 : 0;
    const pointerWeight = state.camera.ready ? 0.26 : 1;
    const targetAmount = clamp(
      state.camera.amount * cameraWeight + state.pointer.amount * pointerWeight,
      0,
      1,
    );
    const targetFlowX = clamp(
      state.camera.flowX * cameraWeight + state.pointer.flowX * pointerWeight,
      -1,
      1,
    );

    state.input.amount = lerp(state.input.amount, targetAmount, 1 - Math.exp(-dt * 2.8));
    state.input.flowX = lerp(state.input.flowX, targetFlowX, 1 - Math.exp(-dt * 2.4));
    state.input.brightness = lerp(
      state.input.brightness,
      state.camera.brightness,
      1 - Math.exp(-dt * 1.4),
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
      0.45,
    );
    state.camera.flowX = lerp(state.camera.flowX, flowX, 0.55);
    state.camera.brightness = lerp(state.camera.brightness, brightnessDelta, 0.38);
    state.camera.previous = current;
    state.camera.previousCenterX = lerp(state.camera.previousCenterX, centerX, 0.35);
    state.camera.previousBrightness = brightness;
    state.camera.lastSample = now;
  }

  function updateShape(dt) {
    const motion = state.input.amount;
    const flow = Math.abs(state.input.flowX);
    const breath = 0.5 + Math.sin(performance.now() * 0.00023) * 0.5;

    const target = {
      vertical: clamp(1.05 - motion * 1.65 - flow * 0.55, 0, 1),
      spiral: clamp(0.12 + smoothstep(0.09, 0.36, motion) * 0.76 + breath * 0.11, 0, 1),
      split: clamp(flow * 1.24 + smoothstep(0.28, 0.68, motion) * 0.44, 0, 1),
      broken: clamp(smoothstep(0.42, 0.82, motion) * 0.95, 0, 1),
      curl: clamp(0.28 + (1 - Math.abs(motion - 0.23) * 2.4) * 0.48 - flow * 0.16, 0, 1),
      low: clamp(smoothstep(0.66, 0.96, motion) * 0.92 + state.input.brightness * 0.6, 0, 1),
    };

    const t = 1 - Math.exp(-dt * 1.55);
    Object.keys(state.shape).forEach((key) => {
      state.shape[key] = lerp(state.shape[key], target[key], t);
    });

    const scores = {
      straight: state.shape.vertical * 1.15 - flow * 0.22,
      spiral: state.shape.spiral * (0.86 - state.shape.broken * 0.22),
      split: state.shape.split,
      broken: state.shape.broken * 1.06,
      curl: state.shape.curl * (1 - state.shape.low * 0.28),
      low: state.shape.low * 1.1,
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
      state.activeMode = nextMode;
      state.modeSince = performance.now();
    }
  }

  function updateSmoke(now, dt) {
    const layout = getLayout();
    const burning = state.phase === "igniting" || state.phase === "burning";
    if (burning) {
      const ignitionBoost = state.phase === "igniting" ? 1.25 : 1;
      const brokenGate =
        state.shape.broken > 0.32
          ? 0.46 + Math.sin(now * 0.012) * 0.32 + noise2(now * 0.001, 4.2) * 0.22
          : 1;
      const rate = (4.8 + state.shape.curl * 3.8 + state.shape.split * 3.2) * ignitionBoost * brokenGate;
      state.smokeAccumulator += dt * rate;
      const count = Math.min(3, Math.floor(state.smokeAccumulator));
      state.smokeAccumulator -= count;
      for (let i = 0; i < count; i += 1) {
        spawnSmoke(layout.head, state.phase === "igniting" ? 1.08 : 1);
      }

      if (Math.random() < dt * (state.phase === "igniting" ? 24 : 2.2)) {
        spawnSpark(layout.head.x, layout.head.y, state.phase === "igniting");
      }
    }

    const input = state.input;
    const shape = state.shape;
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const p = state.particles[i];
      p.age += dt;
      const n = noise2(p.x * 0.006 + p.seed, p.y * 0.005 - now * 0.00016);
      const n2 = noise2(p.x * 0.004 - p.seed, p.age * 0.55 + now * 0.00012);
      const life = p.age / p.life;
      const lift = 1 - smoothstep(0.58, 1, life) * 0.42;
      const splitDrift = p.splitSign * shape.split * smoothstep(0.1, 0.72, life) * 34;
      const curlDrift = (n - 0.5) * (10 + shape.curl * 52 + shape.spiral * 26);
      const spiralDrift = Math.sin(p.age * (1.28 + shape.spiral * 2.35) + p.seed) * shape.spiral * 34;
      const flowDrift = input.flowX * (15 + input.amount * 52);
      const lowTurn = shape.low * smoothstep(0.16, 0.7, life) * (34 + input.amount * 32);
      const targetVx = curlDrift + spiralDrift + splitDrift + flowDrift + p.spin * lowTurn;
      const targetVy =
        -26 * (0.55 + shape.vertical * 0.7) * lift -
        shape.curl * 6 +
        shape.low * smoothstep(0.18, 0.86, life) * 44 +
        (n2 - 0.5) * 6;

      p.vx = lerp(p.vx, targetVx, 1 - Math.exp(-dt * 0.92));
      p.vy = lerp(p.vy, targetVy, 1 - Math.exp(-dt * 0.86));
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.width += dt * (0.5 + shape.split * 0.55 + shape.low * 0.8);
      p.trailClock += dt;
      if (p.trailClock >= 0.036) {
        p.trail.push({ x: p.x, y: p.y });
        p.trailClock = 0;
        if (p.trail.length > p.trailLength) p.trail.shift();
      }

      const fadeIn = smoothstep(0.02, 0.2, life);
      const fadeOut = Math.pow(clamp(1 - life, 0, 1), 0.55);
      p.alpha = p.baseAlpha * fadeIn * fadeOut * (1 - shape.broken * 0.42);

      if (shape.broken > 0.28) {
        const gap = noise2(p.seed + now * 0.0015, p.age * 1.45);
        p.alpha *= gap > 0.45 + shape.broken * 0.28 ? 1 : 0.08;
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
      word.x = word.startX + Math.sin(life * Math.PI * 1.7 + word.seed) * 16;
      word.y = word.startY - life * 28 + Math.sin(word.seed + life * 4) * 6;
      if (word.age >= word.life) state.words.splice(i, 1);
    }
  }

  function maybeSpawnPrompt(now) {
    if (state.phase !== "burning") return;
    if (state.words.length > 2) return;
    const minGap = state.activeMode === "straight" ? 7200 : 5800;
    if (now - state.lastPromptAt < minGap) return;

    const pool = prompts[state.activeMode] || prompts.curl;
    const text = pool[Math.floor(Math.random() * pool.length)];
    const layout = getLayout();
    const verticalOffset = randomRange(86, Math.min(280, height * 0.42));
    const side = state.input.flowX * 80 + randomRange(-48, 48);
    spawnWord(text, layout.head.x + side, layout.head.y - verticalOffset, randomRange(4200, 6500));
    state.lastPromptAt = now;
  }

  function draw(now) {
    ctx.clearRect(0, 0, width, height);
    drawAmbient(now);
    drawSmoke(now);
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
    drawProceduralSmoke(now);
    if (!state.particles.length) return;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    state.particles.forEach((p) => {
      const life = p.age / p.life;
      const alpha = clamp(p.alpha, 0, 0.16);
      if (alpha <= 0.004 || p.trail.length < 3) return;

      drawSmokeTrail(p, alpha * 0.12, p.width * (1.8 + life * 0.6), "rgba(178, 188, 180, ALPHA)");
      drawSmokeTrail(p, alpha * 0.28, p.width * (0.62 + life * 0.18), "rgba(212, 218, 210, ALPHA)");
    });
    ctx.restore();
  }

  function drawProceduralSmoke(now) {
    const active = state.phase === "igniting" || state.phase === "burning";
    if (!active) return;

    const layout = getLayout();
    const head = layout.head;
    const time = now * 0.001;
    const shape = state.shape;
    const motion = state.input.amount;
    const flow = state.input.flowX;
    const plumeHeight = clamp(height * 0.38, 230, 430);
    const activeSpread = clamp(shape.curl + shape.spiral + shape.split + motion * 0.7, 0, 1.6);
    const calmSmoke = shape.vertical > 0.72 && motion < 0.12 && Math.abs(flow) < 0.12;
    const strandCount = calmSmoke
      ? 1
      : Math.round(lerp(2, 5, clamp(activeSpread * 0.58 + shape.split * 0.25, 0, 1)));

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 0; i < strandCount; i += 1) {
      const sign = i % 2 === 0 ? -1 : 1;
      const order = Math.floor(i / 2) + 1;
      const phase = i * 1.73 + Math.sin(time * 0.13 + i) * 0.7;
      const points = [];
      const steps = 18;
      const endT = calmSmoke ? 0.92 : 0.68 + fract(Math.sin(i * 43.31 + 7.1) * 19.19) * 0.28;

      for (let step = 0; step <= steps; step += 1) {
        const t = (step / steps) * endT;
        const lift = smoothstep(0.02, 0.92, t);
        const upper = smoothstep(0.2, 1, t);
        const calm = shape.vertical * (1 - motion * 0.5);
        const curlAmp = (4 + shape.curl * 28 + shape.spiral * 44 + motion * 28) * upper;
        const slowWave = Math.sin(phase + t * (3.1 + shape.spiral * 4.2) + time * (0.55 + shape.spiral * 0.55));
        const fineWave = Math.sin(phase * 1.8 + t * 9.5 - time * 0.38) * (1 - calm) * 8;
        const split = sign * order * shape.split * upper * (30 + motion * 42);
        const current = flow * upper * upper * (70 + motion * 86);
        const lowCurl = shape.low * upper * (34 + motion * 42);
        const x =
          head.x +
          split +
          current +
          slowWave * curlAmp * (calmSmoke ? 0.36 : 1) +
          fineWave +
          sign * order * (1 - calm) * 4;
        const y =
          head.y -
          t * plumeHeight * (0.72 + calm * 0.22) +
          lowCurl * t * t +
          Math.sin(phase + t * 5.4 + time * 0.22) * shape.low * 18;
        points.push({ x, y, local: step / steps });
      }

      const broken = shape.broken > 0.36;
      if (broken) ctx.setLineDash([18, 16 + shape.broken * 22]);
      const baseAlpha = (0.052 + shape.vertical * 0.018 + shape.curl * 0.03) * (1 - shape.broken * 0.35);
      strokeSmokeLayer(points, [155, 166, 158], baseAlpha * (calmSmoke ? 0.13 : 0.2), 13 + activeSpread * 7, 0.02, 0.78);
      strokeSmokeLayer(points, [204, 214, 206], baseAlpha * (calmSmoke ? 0.5 : 0.82), 4.4 + activeSpread * 2.2, 0, 0.88);
      strokeSmokeLayer(points, [246, 241, 226], baseAlpha * (calmSmoke ? 0.12 : 0.46), 1 + activeSpread * 0.6, 0, 0.94);
      drawSmokeFeather(points, phase, baseAlpha, activeSpread, calmSmoke);
      if (broken) ctx.setLineDash([]);
    }

    ctx.restore();
  }

  function strokeSmokeLayer(points, color, alpha, lineWidth, fromRatio, toRatio) {
    if (points.length < 2) return;
    const start = Math.max(0, Math.floor(points.length * fromRatio));
    const end = Math.min(points.length - 1, Math.ceil(points.length * toRatio));
    if (end - start < 1) return;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(4)})`;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(points[start].x, points[start].y);

    for (let i = start + 1; i < end - 1; i += 1) {
      const current = points[i];
      const next = points[i + 1];
      ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) * 0.5, (current.y + next.y) * 0.5);
    }

    ctx.lineTo(points[end].x, points[end].y);
    ctx.stroke();
  }

  function drawSmokeFeather(points, seed, baseAlpha, activeSpread, calmSmoke) {
    const startIndex = Math.max(1, Math.floor(points.length * 0.62));
    const tip = points[Math.min(points.length - 1, Math.floor(points.length * 0.94))];
    const strands = calmSmoke ? 3 : 4;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 0; i < strands; i += 1) {
      const origin = points[startIndex + ((i * 2) % Math.max(1, points.length - startIndex - 2))];
      const sign = i % 2 === 0 ? -1 : 1;
      const drift = sign * (10 + i * 4 + activeSpread * 12);
      const fade = 0.18 - i * 0.026;
      const controlX = (origin.x + tip.x) * 0.5 + Math.sin(seed + i * 2.7) * 14 + drift * 0.45;
      const controlY = (origin.y + tip.y) * 0.5 - 12 - i * 5;
      const endX = tip.x + drift + Math.sin(seed * 1.6 + i) * 18;
      const endY = tip.y - 16 - i * 10;

      ctx.strokeStyle = `rgba(213, 222, 214, ${(baseAlpha * fade).toFixed(4)})`;
      ctx.lineWidth = clamp((2.4 - i * 0.36) + activeSpread * 0.8, 0.45, 4.2);
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.quadraticCurveTo(controlX, controlY, endX, endY);
      ctx.stroke();
    }
  }

  function drawSmokeTrail(p, alpha, baseWidth, colorTemplate) {
    const points = p.trail;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = colorTemplate.replace("ALPHA", alpha.toFixed(4));
    ctx.lineWidth = clamp(baseWidth, 0.35, 13);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length - 2; i += 1) {
      const current = points[i];
      const next = points[i + 1];
      const midX = (current.x + next.x) * 0.5;
      const midY = (current.y + next.y) * 0.5;
      ctx.quadraticCurveTo(current.x, current.y, midX, midY);
    }

    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  function drawWords() {
    if (!state.words.length) return;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    state.words.forEach((word) => {
      const life = word.age / word.life;
      const alpha = Math.sin(clamp(life, 0, 1) * Math.PI);
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
    drawIncense(layout, now);
    drawBowl(layout);
  }

  function drawIncense(layout, now) {
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
      ctx.lineTo(centerX, baseY + 8);
      ctx.stroke();

      const sideLight = ctx.createLinearGradient(centerX - 2, visibleTop, centerX + 2, visibleTop);
      sideLight.addColorStop(0, "rgba(0,0,0,0)");
      sideLight.addColorStop(0.66, "rgba(204, 145, 86, 0.18)");
      sideLight.addColorStop(1, "rgba(0,0,0,0)");
      ctx.strokeStyle = sideLight;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX + 1.3, visibleTop + 6);
      ctx.lineTo(centerX + 1.3, baseY);
      ctx.stroke();
    }

    if (lit) {
      const ignition = state.phase === "igniting" ? smoothstep(0, 1, (now - state.ignitionStart) / 1300) : 1;
      const ember = 0.62 + Math.sin(now * 0.016) * 0.12 + ignition * 0.24;
      const ashLength = clamp(10 + state.burnProgress * 32, 10, 42);

      ctx.strokeStyle = "rgba(181, 180, 166, 0.52)";
      ctx.lineWidth = clamp(width * 0.003, 1.8, 3.2);
      ctx.beginPath();
      ctx.moveTo(centerX, head.y + 1);
      ctx.lineTo(centerX + Math.sin(now * 0.002) * 1.2, head.y + ashLength);
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
    } else if (!ended) {
      ctx.fillStyle = "rgba(74, 55, 40, 0.92)";
      ctx.beginPath();
      ctx.ellipse(centerX, head.y, 2.1, 3.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (ended) {
      ctx.strokeStyle = "rgba(90, 84, 72, 0.45)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(centerX, baseY - 3);
      ctx.lineTo(centerX, baseY + 10);
      ctx.stroke();
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
    state.pointer.active = true;

    const layout = getLayout();
    const distance = Math.hypot(point.x - layout.head.x, point.y - layout.head.y);
    const hitRadius = clamp(width * 0.04, 24, 44);
    if (distance <= hitRadius) {
      ignite();
    }
  }

  function onPointerMove(event) {
    const point = eventPoint(event);
    const dx = point.x - state.pointer.lastX;
    const dy = point.y - state.pointer.lastY;
    const distance = Math.hypot(dx, dy);
    state.pointer.x = point.x;
    state.pointer.y = point.y;
    state.pointer.lastX = point.x;
    state.pointer.lastY = point.y;
    state.pointer.amount = clamp(state.pointer.amount + distance / 48, 0, 1);
    state.pointer.flowX = clamp(lerp(state.pointer.flowX, dx / 42, 0.42), -1, 1);
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

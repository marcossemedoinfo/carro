/**
 * Empacotamos a inicialização em um script clássico que importa Three.js e GLTFLoader
 * dinamicamente via CDN, permitindo que o jogo funcione tanto dando duplo-clique direto
 * em `index.html` (protocolo file://) quanto via servidor local (`Jogar.bat`) ou GitHub Pages.
 */
(async function initHighwayGame() {
  const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
  const { GLTFLoader } = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js');

  // ============================================================================
  // SISTEMA DE ÁUDIO SINTETIZADO (MOTOR, TURBO NOS, COLISÃO, TIROU FINO)
  // Compatível com Desktop, Android e iPhone (desbloqueia no primeiro toque)
  // ============================================================================
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.initialized = false;
      this.engineOsc1 = null;
      this.engineOsc2 = null;
      this.engineGain = null;
      this.engineFilter = null;
      this.nosGain = null;
      this.nosFilter = null;
      this.nosWhineOsc = null;
      this.nosWhineGain = null;
    }

    init() {
      if (this.initialized) {
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume();
        }
        return;
      }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      this.initialized = true;

      // 1. Som contínuo do motor V8 (2 osciladores + filtro passa-baixa)
      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc2.type = 'triangle';
      this.engineOsc1.frequency.value = 55;
      this.engineOsc2.frequency.value = 110;

      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 320;
      this.engineFilter.Q.value = 3.5;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0001;

      this.engineOsc1.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);

      this.engineOsc1.start();
      this.engineOsc2.start();

      // 2. Som contínuo do Turbo NOS (ruído de jato + assobio de turbina)
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      this.nosFilter = this.ctx.createBiquadFilter();
      this.nosFilter.type = 'bandpass';
      this.nosFilter.frequency.value = 1100;
      this.nosFilter.Q.value = 1.8;

      this.nosGain = this.ctx.createGain();
      this.nosGain.gain.value = 0.0001;

      whiteNoise.connect(this.nosFilter);
      this.nosFilter.connect(this.nosGain);
      this.nosGain.connect(this.ctx.destination);
      whiteNoise.start();

      this.nosWhineOsc = this.ctx.createOscillator();
      this.nosWhineOsc.type = 'sine';
      this.nosWhineOsc.frequency.value = 650;
      this.nosWhineGain = this.ctx.createGain();
      this.nosWhineGain.gain.value = 0.0001;
      this.nosWhineOsc.connect(this.nosWhineGain);
      this.nosWhineGain.connect(this.ctx.destination);
      this.nosWhineOsc.start();
    }

    toggleMute() {
      this.init();
      this.muted = !this.muted;
      if (this.muted && this.engineGain && this.nosGain) {
        const now = this.ctx.currentTime;
        this.engineGain.gain.setTargetAtTime(0.0001, now, 0.05);
        this.nosGain.gain.setTargetAtTime(0.0001, now, 0.05);
        this.nosWhineGain.gain.setTargetAtTime(0.0001, now, 0.05);
      }
      return this.muted;
    }

    update(speedKmh, rpmPct, nosActive, running) {
      if (!this.initialized || !this.ctx) return;
      const now = this.ctx.currentTime;

      if (this.muted || !running) {
        this.engineGain.gain.setTargetAtTime(0.0001, now, 0.08);
        this.nosGain.gain.setTargetAtTime(0.0001, now, 0.08);
        this.nosWhineGain.gain.setTargetAtTime(0.0001, now, 0.08);
        return;
      }

      // Frequência do motor sobe com a velocidade e com o RPM de cada marcha
      const baseFreq = 42 + (speedKmh / 320) * 65 + (rpmPct / 100) * 48;
      this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.05);
      this.engineOsc2.frequency.setTargetAtTime(baseFreq * 1.98, now, 0.05);
      this.engineFilter.frequency.setTargetAtTime(220 + speedKmh * 2.2 + (nosActive ? 400 : 0), now, 0.06);
      this.engineGain.gain.setTargetAtTime(0.11, now, 0.08);

      // Som do Turbo NOS
      if (nosActive) {
        this.nosFilter.frequency.setTargetAtTime(1450 + Math.random() * 250, now, 0.05);
        this.nosGain.gain.setTargetAtTime(0.16, now, 0.06);
        this.nosWhineOsc.frequency.setTargetAtTime(880 + (speedKmh - 200) * 3.5, now, 0.08);
        this.nosWhineGain.gain.setTargetAtTime(0.045, now, 0.06);
      } else {
        this.nosGain.gain.setTargetAtTime(0.0001, now, 0.08);
        this.nosWhineGain.gain.setTargetAtTime(0.0001, now, 0.08);
      }
    }

    playCrash() {
      this.init();
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;

      // Impacto metálico + estrondo grave + ruído de batida
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.45);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.14));
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(950, now);
      filter.frequency.exponentialRampToValueAtTime(140, now + 0.4);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.42, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start(now);

      // Pancada grave (sub-bass thud)
      const thudOsc = this.ctx.createOscillator();
      const thudGain = this.ctx.createGain();
      thudOsc.type = 'triangle';
      thudOsc.frequency.setValueAtTime(135, now);
      thudOsc.frequency.exponentialRampToValueAtTime(28, now + 0.32);

      thudGain.gain.setValueAtTime(0.5, now);
      thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      thudOsc.connect(thudGain);
      thudGain.connect(this.ctx.destination);
      thudOsc.start(now);
      thudOsc.stop(now + 0.36);
    }

    playNearMiss() {
      this.init();
      if (!this.ctx || this.muted) return;
      const now = this.ctx.currentTime;

      // Efeito Doppler de carro passando raspando ("whoosh" + chime de pontos)
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(580, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    }
  }

  const sound = new SoundEngine();

  // ============================================================================
  // CONFIGURAÇÕES DO JOGO E DA PISTA (INSPIRADO NA IMAGEM MODELO)
  // ============================================================================
  const LANE_CENTERS = [-5.4, -1.8, 1.8, 5.4]; // 4 faixas: 2 à esquerda da linha central, 2 à direita
  const ROAD_WIDTH = 15.2;
  const SEGMENT_LENGTH = 40;
  const NUM_SEGMENTS = 14;
  const RACE_DISTANCE = 2800; // Distância total até a linha de chegada

  const state = {
    running: false,
    paused: false,
    gameOver: false,
    modelLoaded: false,
    cameraMode: 0, // 0: Câmera atrás (padrão igual à imagem), 1: Câmera mais distante, 2: Câmera capô
    speedKmh: 0,
    rpmPct: 50,
    baseMaxSpeed: 245,
    nosMaxSpeed: 325,
    minCruiseSpeed: 95,
    distance: 0,
    playerX: 1.8, // Começa na 3ª faixa (faixa da direita como na imagem)
    playerVelX: 0,
    playerTiltZ: 0,
    playerYawY: 0,
    health: 3,
    maxHealth: 3,
    invulnerableTimer: 0,
    trophies: 65,
    nosCharge: 100,
    nosActive: false,
    rank: 3,
    rivalDistances: [320, 165], // 2 corredores rivais à frente para disputar o 1º lugar
    inputs: {
      left: false,
      right: false,
      gas: false,
      brake: false,
      nos: false
    }
  };

  // ============================================================================
  // ELEMENTOS DO DOM (HUD)
  // ============================================================================
  const canvas = document.getElementById('game-canvas');
  const trophyCountEl = document.getElementById('trophy-count');
  const missionPillEl = document.getElementById('mission-pill');
  const rankNumberEl = document.getElementById('rank-number');
  const distanceGapEl = document.getElementById('distance-gap');
  const progressPointerEl = document.getElementById('progress-pointer');
  const progressFillEl = document.getElementById('race-progress-fill');
  const gearValueEl = document.getElementById('gear-value');
  const speedValueEl = document.getElementById('speed-value');
  const rpmBarFillEl = document.getElementById('rpm-bar-fill');
  const healthSegmentsEl = document.getElementById('health-segments');
  const nosRingProgressEl = document.getElementById('nos-ring-progress');
  const eventBannerEl = document.getElementById('event-banner');

  const overlayScreenEl = document.getElementById('overlay-screen');
  const modalBadgeEl = document.getElementById('modal-badge');
  const modalTitleEl = document.getElementById('modal-title');
  const modalSubtitleEl = document.getElementById('modal-subtitle');
  const loadingStatusEl = document.getElementById('loading-status');
  const btnStartGame = document.getElementById('btn-start-game');

  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const btnGas = document.getElementById('btn-gas');
  const btnBrake = document.getElementById('btn-brake');
  const btnNos = document.getElementById('btn-nos');
  const btnCamera = document.getElementById('btn-camera');
  const btnPause = document.getElementById('btn-pause');
  const btnMute = document.getElementById('btn-mute');
  const muteIconEl = document.getElementById('mute-icon');

  // ============================================================================
  // CENA THREE.JS, CÂMERA E ILUMINAÇÃO COSTEIRA ENSOLARADA
  // ============================================================================
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x56b4e9);
  scene.fog = new THREE.FogExp2(0x8cd3ff, 0.0024);

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(1.8, 3.2, 7.6);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  // Iluminação
  const hemiLight = new THREE.HemisphereLight(0xdff4ff, 0x3b4d5e, 1.25);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff7e6, 2.2);
  sunLight.position.set(-35, 65, 40);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 5;
  sunLight.shadow.camera.far = 180;
  const d = 35;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  scene.add(sunLight);

  // ============================================================================
  // AMBIENTE: CÉU COM NUVENS, OCEANO À DIREITA E PRÉDIOS LATERAIS DA PONTE
  // ============================================================================
  const oceanGeo = new THREE.PlaneGeometry(1200, 1200);
  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0x29b6f6,
    roughness: 0.25,
    metalness: 0.1
  });
  const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
  oceanMesh.rotation.x = -Math.PI / 2;
  oceanMesh.position.set(220, -4.5, -200);
  scene.add(oceanMesh);

  // Nuvens estilizadas no céu
  const cloudsGroup = new THREE.Group();
  scene.add(cloudsGroup);
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.82 });
  for (let i = 0; i < 22; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(Math.random() * 3);
    for (let p = 0; p < puffs; p++) {
      const puffGeo = new THREE.SphereGeometry(6 + Math.random() * 5, 10, 10);
      const puff = new THREE.Mesh(puffGeo, cloudMat);
      puff.position.set(p * 6 - 6, Math.random() * 2, Math.random() * 3);
      puff.scale.set(1.6, 0.55, 0.9);
      cloud.add(puff);
    }
    cloud.position.set((Math.random() - 0.35) * 320, 42 + Math.random() * 35, -Math.random() * 420);
    cloudsGroup.add(cloud);
  }

  // Torres e prédios da ponte (SEMPRE posicionados fora da pista e das calçadas!)
  // A pista + calçadas ocupam de X = -15.5 até X = +12.0.
  // Portanto, os prédios ficam com X <= -26 (lado esquerdo) ou X >= +24 (lado direito).
  function createBridgeTower(x, z, scale = 1) {
    const towerGroup = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x7a868c, roughness: 0.8 });
    const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x4f5a60, roughness: 0.85 });

    const base = new THREE.Mesh(new THREE.BoxGeometry(14 * scale, 22 * scale, 12 * scale), stoneMat);
    base.position.y = 11 * scale;
    towerGroup.add(base);

    const mid = new THREE.Mesh(new THREE.BoxGeometry(11 * scale, 12 * scale, 10 * scale), darkStoneMat);
    mid.position.y = 28 * scale;
    towerGroup.add(mid);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(12.5 * scale, 2.5 * scale, 11 * scale), stoneMat);
    roof.position.y = 35 * scale;
    towerGroup.add(roof);

    towerGroup.position.set(x, -1, z);
    return towerGroup;
  }

  const landmarkTowers = [
    createBridgeTower(-28, -190, 1.15),
    createBridgeTower(25, -310, 0.95),
    createBridgeTower(-32, -410, 1.05)
  ];
  landmarkTowers.forEach((t) => scene.add(t));

  // ============================================================================
  // CONSTRUÇÃO MODULAR DA PONTE / PISTA (FIEL À IMAGEM)
  // ============================================================================
  const roadSegments = [];

  const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x5c646d, roughness: 0.85 });
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.75 });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x6f7880, roughness: 0.7 });
  const whiteLineMat = new THREE.MeshBasicMaterial({ color: 0xf5f7fa });
  const yellowLineMat = new THREE.MeshBasicMaterial({ color: 0xf7b731 });
  const balustradeMat = new THREE.MeshStandardMaterial({ color: 0x95a5b2, roughness: 0.6 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x4b5c6b, metalness: 0.5, roughness: 0.4 });
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.8 });

  function createUmbrellaTable(colorHex1, colorHex2) {
    const group = new THREE.Group();

    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 1.4), benchMat);
    tableTop.position.y = 0.75;
    group.add(tableTop);

    const seatL = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.4), benchMat);
    seatL.position.set(0, 0.45, -0.95);
    group.add(seatL);

    const seatR = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.4), benchMat);
    seatR.position.set(0, 0.45, 0.95);
    group.add(seatR);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8), poleMat);
    pole.position.y = 1.6;
    group.add(pole);

    const canopyGeo = new THREE.ConeGeometry(2.35, 0.95, 8);
    const canopyMat = new THREE.MeshStandardMaterial({ color: colorHex1, roughness: 0.5 });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.y = 3.15;
    group.add(canopy);

    const rimGeo = new THREE.CylinderGeometry(2.35, 2.38, 0.14, 8);
    const rimMat = new THREE.MeshStandardMaterial({ color: colorHex2, roughness: 0.5 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.y = 2.68;
    group.add(rim);

    return group;
  }

  function createRoadSegment(zPos, index) {
    const seg = new THREE.Group();

    const roadMesh = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH, 0.4, SEGMENT_LENGTH), asphaltMat);
    roadMesh.position.y = -0.2;
    roadMesh.receiveShadow = true;
    seg.add(roadMesh);

    const centerLineL = new THREE.Mesh(new THREE.PlaneGeometry(0.14, SEGMENT_LENGTH), whiteLineMat);
    centerLineL.rotation.x = -Math.PI / 2;
    centerLineL.position.set(-0.14, 0.015, 0);
    seg.add(centerLineL);

    const centerLineR = new THREE.Mesh(new THREE.PlaneGeometry(0.14, SEGMENT_LENGTH), whiteLineMat);
    centerLineR.rotation.x = -Math.PI / 2;
    centerLineR.position.set(0.14, 0.015, 0);
    seg.add(centerLineR);

    const rightYellowLine = new THREE.Mesh(new THREE.PlaneGeometry(0.22, SEGMENT_LENGTH), yellowLineMat);
    rightYellowLine.rotation.x = -Math.PI / 2;
    rightYellowLine.position.set(7.1, 0.015, 0);
    seg.add(rightYellowLine);

    const leftEdgeLine = new THREE.Mesh(new THREE.PlaneGeometry(0.18, SEGMENT_LENGTH), whiteLineMat);
    leftEdgeLine.rotation.x = -Math.PI / 2;
    leftEdgeLine.position.set(-7.1, 0.015, 0);
    seg.add(leftEdgeLine);

    for (let z = -SEGMENT_LENGTH / 2 + 4; z < SEGMENT_LENGTH / 2; z += 8) {
      const dashL = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 3.6), whiteLineMat);
      dashL.rotation.x = -Math.PI / 2;
      dashL.position.set(-3.6, 0.015, z);
      seg.add(dashL);

      const dashR = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 3.6), whiteLineMat);
      dashR.rotation.x = -Math.PI / 2;
      dashR.position.set(3.6, 0.015, z);
      seg.add(dashR);
    }

    if (index % 4 === 2) {
      for (let x = -6.4; x <= 6.4; x += 1.1) {
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 2.8), whiteLineMat);
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(x, 0.02, 0);
        seg.add(stripe);
      }
    }

    const sidewalkR = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.55, SEGMENT_LENGTH), sidewalkMat);
    sidewalkR.position.set(ROAD_WIDTH / 2 + 1.8, -0.02, 0);
    sidewalkR.receiveShadow = true;
    seg.add(sidewalkR);

    const curbR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, SEGMENT_LENGTH), curbMat);
    curbR.position.set(ROAD_WIDTH / 2 + 0.15, 0.02, 0);
    seg.add(curbR);

    const railTopR = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, SEGMENT_LENGTH), balustradeMat);
    railTopR.position.set(ROAD_WIDTH / 2 + 3.25, 1.35, 0);
    seg.add(railTopR);

    const railBotR = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.35, SEGMENT_LENGTH), balustradeMat);
    railBotR.position.set(ROAD_WIDTH / 2 + 3.25, 0.35, 0);
    seg.add(railBotR);

    for (let z = -SEGMENT_LENGTH / 2 + 2; z <= SEGMENT_LENGTH / 2 - 2; z += 4) {
      const isMainPost = Math.abs(z % 8) < 0.1;
      const postW = isMainPost ? 0.72 : 0.35;
      const postH = isMainPost ? 1.55 : 1.1;
      const post = new THREE.Mesh(new THREE.BoxGeometry(postW, postH, postW), balustradeMat);
      post.position.set(ROAD_WIDTH / 2 + 3.25, 0.25 + postH / 2, z);
      post.castShadow = true;
      seg.add(post);
    }

    const lampGroup = new THREE.Group();
    const vPole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 6.8, 8), poleMat);
    vPole.position.y = 3.4;
    lampGroup.add(vPole);

    const hArm = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.12), poleMat);
    hArm.position.set(-0.95, 6.65, 0);
    lampGroup.add(hArm);

    const lampHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.18, 0.32),
      new THREE.MeshBasicMaterial({ color: 0xfff9c4 })
    );
    lampHead.position.set(-1.85, 6.55, 0);
    lampGroup.add(lampHead);

    lampGroup.position.set(ROAD_WIDTH / 2 + 0.55, 0.25, -8);
    seg.add(lampGroup);

    const sidewalkL = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.55, SEGMENT_LENGTH), sidewalkMat);
    sidewalkL.position.set(-ROAD_WIDTH / 2 - 3.75, -0.02, 0);
    sidewalkL.receiveShadow = true;
    seg.add(sidewalkL);

    const railLeft = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, SEGMENT_LENGTH), balustradeMat);
    railLeft.position.set(-ROAD_WIDTH / 2 - 7.2, 0.7, 0);
    seg.add(railLeft);

    const umb1 = createUmbrellaTable(0x74d4f7, 0x4bbbe6);
    umb1.position.set(-ROAD_WIDTH / 2 - 3.6, 0.25, -9);
    seg.add(umb1);

    const umb2 = createUmbrellaTable(0xd4f257, 0xb8dc35);
    umb2.position.set(-ROAD_WIDTH / 2 - 3.6, 0.25, 9);
    seg.add(umb2);

    seg.position.z = zPos;
    scene.add(seg);
    return seg;
  }

  for (let i = 0; i < NUM_SEGMENTS; i++) {
    roadSegments.push(createRoadSegment(20 - i * SEGMENT_LENGTH, i));
  }

  // ============================================================================
  // CARRO DO JOGADOR (CARREGANDO relampago_mcqueen.glb) + NITRO FLAMES
  // ============================================================================
  const playerRoot = new THREE.Group();
  playerRoot.position.set(state.playerX, 0, 0);
  scene.add(playerRoot);

  const playerCarHolder = new THREE.Group();
  playerRoot.add(playerCarHolder);

  const nosFlamesGroup = new THREE.Group();
  const flameGeo = new THREE.ConeGeometry(0.22, 1.35, 10);
  flameGeo.rotateX(Math.PI / 2);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.88 });
  const flameL = new THREE.Mesh(flameGeo, flameMat);
  flameL.position.set(-0.52, 0.42, 2.35);
  const flameR = new THREE.Mesh(flameGeo, flameMat);
  flameR.position.set(0.52, 0.42, 2.35);
  nosFlamesGroup.add(flameL, flameR);
  nosFlamesGroup.visible = false;
  playerRoot.add(nosFlamesGroup);

  const gltfLoader = new GLTFLoader();

  function onMcQueenLoaded(gltf) {
    const model = gltf.scene;

    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    model.position.x -= center.x;
    model.position.y -= box.min.y;
    model.position.z -= center.z;

    const orientedWrapper = new THREE.Group();
    orientedWrapper.add(model);

    // Rotaciona 180 graus em Y para a frente apontar para -Z e a câmera ficar atrás do carro
    orientedWrapper.rotation.y = Math.PI;

    const desiredWidth = 2.15;
    const scaleFactor = desiredWidth / Math.max(size.x, 0.01);
    orientedWrapper.scale.setScalar(scaleFactor);

    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          child.material.envMapIntensity = 1.2;
        }
      }
    });

    playerCarHolder.add(orientedWrapper);

    state.modelLoaded = true;
    loadingStatusEl.textContent = '✔ Modelo 3D relampago_mcqueen.glb carregado com sucesso!';
    btnStartGame.disabled = false;
  }

  function createFallbackPlayerCar() {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.9, 4.3),
      new THREE.MeshStandardMaterial({ color: 0xe53935, metalness: 0.4, roughness: 0.2 })
    );
    body.position.y = 0.55;
    playerCarHolder.add(body);
  }

  function loadFromEmbeddedBase64() {
    if (!window.MCQUEEN_GLB_BASE64) return false;
    try {
      const binaryStr = atob(window.MCQUEEN_GLB_BASE64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      gltfLoader.parse(
        bytes.buffer,
        '',
        onMcQueenLoaded,
        (err) => {
          console.error('Erro ao fazer parse do GLB:', err);
          createFallbackPlayerCar();
          state.modelLoaded = true;
          btnStartGame.disabled = false;
        }
      );
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  if (window.location.protocol === 'file:' && window.MCQUEEN_GLB_BASE64) {
    loadFromEmbeddedBase64();
  } else {
    gltfLoader.load(
      './relampago_mcqueen.glb',
      onMcQueenLoaded,
      (xhr) => {
        if (xhr.total > 0) {
          const pct = Math.round((xhr.loaded / xhr.total) * 100);
          loadingStatusEl.textContent = `Carregando relampago_mcqueen.glb (${pct}%)...`;
        }
      },
      () => {
        if (!loadFromEmbeddedBase64()) {
          loadingStatusEl.textContent = 'Usando carro de reserva (erro ao abrir .glb)';
          createFallbackPlayerCar();
          state.modelLoaded = true;
          btnStartGame.disabled = false;
        }
      }
    );
  }

  // ============================================================================
  // VEÍCULOS DO TRÂNSITO (CAMINHÕES BAÚ, VANS PRETAS, CARROS ESPORTIVOS)
  // ============================================================================
  const trafficVehicles = [];
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1e242b, roughness: 0.9 });
  const tailLightMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  const headLightMat = new THREE.MeshBasicMaterial({ color: 0xfff4b8 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1c2833, roughness: 0.15, metalness: 0.8 });

  function createTrafficVehicleMesh(type) {
    const group = new THREE.Group();
    let halfWidth = 1.05;
    let halfLength = 2.2;

    if (type === 'truck') {
      halfWidth = 1.25;
      halfLength = 4.1;

      const cargo = new THREE.Mesh(
        new THREE.BoxGeometry(2.45, 2.75, 5.8),
        new THREE.MeshStandardMaterial({ color: 0xd0d7de, roughness: 0.5 })
      );
      cargo.position.set(0, 1.85, 0.8);
      cargo.castShadow = true;
      group.add(cargo);

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(2.52, 0.35, 7.8),
        new THREE.MeshStandardMaterial({ color: 0x2c353d, roughness: 0.8 })
      );
      frame.position.set(0, 0.45, 0);
      group.add(frame);

      const cab = new THREE.Mesh(
        new THREE.BoxGeometry(2.35, 1.85, 2.1),
        new THREE.MeshStandardMaterial({ color: 0x3b4652, roughness: 0.4 })
      );
      cab.position.set(0, 1.35, -3.0);
      cab.castShadow = true;
      group.add(cab);

      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.1), tailLightMat);
      tlL.position.set(-0.85, 0.55, 3.92);
      const tlR = tlL.clone();
      tlR.position.x = 0.85;
      group.add(tlL, tlR);

      [-2.8, 0.5, 2.8].forEach((zW) => {
        const wL = new THREE.Mesh(wheelGeo, wheelMat);
        wL.position.set(-1.18, 0.38, zW);
        const wR = new THREE.Mesh(wheelGeo, wheelMat);
        wR.position.set(1.18, 0.38, zW);
        group.add(wL, wR);
      });
    } else if (type === 'van') {
      halfWidth = 1.08;
      halfLength = 2.4;

      const vanBody = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 1.55, 4.6),
        new THREE.MeshStandardMaterial({ color: 0x22272e, roughness: 0.35, metalness: 0.3 })
      );
      vanBody.position.set(0, 1.05, 0);
      vanBody.castShadow = true;
      group.add(vanBody);

      const rearWin = new THREE.Mesh(new THREE.PlaneGeometry(1.65, 0.6), glassMat);
      rearWin.position.set(0, 1.35, 2.31);
      group.add(rearWin);

      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.1), tailLightMat);
      tlL.position.set(-0.78, 0.85, 2.31);
      const tlR = tlL.clone();
      tlR.position.x = 0.78;
      group.add(tlL, tlR);

      [-1.45, 1.45].forEach((zW) => {
        const wL = new THREE.Mesh(wheelGeo, wheelMat);
        wL.position.set(-1.02, 0.38, zW);
        const wR = new THREE.Mesh(wheelGeo, wheelMat);
        wR.position.set(1.02, 0.38, zW);
        group.add(wL, wR);
      });
    } else {
      halfWidth = 1.02;
      halfLength = 2.15;
      const colors = [0x1c1e24, 0xff3b30, 0x2979ff, 0xffc107, 0x00bfa5];
      const carColor = colors[Math.floor(Math.random() * colors.length)];
      const bodyMat = new THREE.MeshStandardMaterial({ color: carColor, roughness: 0.22, metalness: 0.45 });

      const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.68, 4.25), bodyMat);
      lowerBody.position.set(0, 0.56, 0);
      lowerBody.castShadow = true;
      group.add(lowerBody);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.52, 2.1), glassMat);
      cabin.position.set(0, 1.08, -0.15);
      group.add(cabin);

      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.1, 0.35), bodyMat);
      spoiler.position.set(0, 1.04, 1.85);
      group.add(spoiler);

      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.1), tailLightMat);
      tlL.position.set(-0.62, 0.65, 2.13);
      const tlR = tlL.clone();
      tlR.position.x = 0.62;
      group.add(tlL, tlR);

      const hlL = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.1), headLightMat);
      hlL.position.set(-0.62, 0.6, -2.13);
      const hlR = hlL.clone();
      hlR.position.x = 0.62;
      group.add(hlL, hlR);

      [-1.35, 1.35].forEach((zW) => {
        const wL = new THREE.Mesh(wheelGeo, wheelMat);
        wL.position.set(-0.98, 0.38, zW);
        const wR = new THREE.Mesh(wheelGeo, wheelMat);
        wR.position.set(0.98, 0.38, zW);
        group.add(wL, wR);
      });
    }

    return { group, halfWidth, halfLength };
  }

  function spawnTrafficVehicle(zOffset) {
    const laneIdx = Math.floor(Math.random() * LANE_CENTERS.length);
    const rand = Math.random();
    const type = rand < 0.25 ? 'truck' : rand < 0.5 ? 'van' : 'sport';
    const { group, halfWidth, halfLength } = createTrafficVehicleMesh(type);

    const speedKmh = type === 'truck'
      ? 95 + Math.random() * 25
      : 120 + Math.random() * 55;

    group.position.set(LANE_CENTERS[laneIdx], 0, zOffset);
    scene.add(group);

    return {
      mesh: group,
      laneIdx,
      type,
      speedKmh,
      halfWidth,
      halfLength,
      passed: false
    };
  }

  function resetTraffic() {
    trafficVehicles.forEach((v) => scene.remove(v.mesh));
    trafficVehicles.length = 0;

    for (let i = 0; i < 14; i++) {
      const zPos = -32 - i * 32 - Math.random() * 12;
      const v = spawnTrafficVehicle(zPos);
      for (let j = 0; j < i; j++) {
        const other = trafficVehicles[j];
        if (other.laneIdx === v.laneIdx && Math.abs(other.mesh.position.z - v.mesh.position.z) < 16) {
          v.laneIdx = (v.laneIdx + 1) % LANE_CENTERS.length;
          v.mesh.position.x = LANE_CENTERS[v.laneIdx];
        }
      }
      trafficVehicles.push(v);
    }
  }

  resetTraffic();

  // ============================================================================
  // CONTROLES DE TECLADO, MOUSE E MULTI-TOUCH (ANDROID E IPHONE)
  // ============================================================================
  const keyMap = {
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowRight: 'right',
    KeyD: 'right',
    ArrowUp: 'gas',
    KeyW: 'gas',
    ArrowDown: 'brake',
    KeyS: 'brake',
    Space: 'nos',
    ShiftLeft: 'nos',
    ShiftRight: 'nos'
  };

  window.addEventListener('keydown', (e) => {
    sound.init();
    if (e.code === 'KeyC') {
      cycleCamera();
      return;
    }
    if (e.code === 'KeyM') {
      toggleMuteButton();
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state.running && !state.gameOver) togglePause();
      return;
    }
    const action = keyMap[e.code];
    if (action) {
      state.inputs[action] = true;
      updateButtonVisuals();
    }
  });

  window.addEventListener('keyup', (e) => {
    const action = keyMap[e.code];
    if (action) {
      state.inputs[action] = false;
      updateButtonVisuals();
    }
  });

  // Suporte Multi-Touch completo para Android e iPhone (permite segurar Acelerador/NOS + Setas ao mesmo tempo)
  function bindTouchAndPointerButton(btn, inputKey) {
    const activePointers = new Set();

    const activate = (e) => {
      if (e.cancelable) e.preventDefault();
      sound.init();
      state.inputs[inputKey] = true;
      updateButtonVisuals();
    };

    const deactivate = (e) => {
      if (e && e.cancelable) e.preventDefault();
      if (activePointers.size === 0) {
        state.inputs[inputKey] = false;
        updateButtonVisuals();
      }
    };

    // Eventos Touch explícitos (garante multi-toque simultâneo no Safari iOS e Chrome Android)
    btn.addEventListener('touchstart', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        activePointers.add(e.changedTouches[i].identifier);
      }
      activate(e);
    }, { passive: false });

    const endTouch = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        activePointers.delete(e.changedTouches[i].identifier);
      }
      deactivate(e);
    };
    btn.addEventListener('touchend', endTouch, { passive: false });
    btn.addEventListener('touchcancel', endTouch, { passive: false });

    // Eventos Pointer para Mouse / Desktop
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      activePointers.add(e.pointerId);
      activate(e);
    });
    const endPointer = (e) => {
      if (e.pointerType === 'touch') return;
      activePointers.delete(e.pointerId);
      deactivate(e);
    };
    btn.addEventListener('pointerup', endPointer);
    btn.addEventListener('pointerleave', endPointer);
    btn.addEventListener('pointercancel', endPointer);
  }

  bindTouchAndPointerButton(btnLeft, 'left');
  bindTouchAndPointerButton(btnRight, 'right');
  bindTouchAndPointerButton(btnGas, 'gas');
  bindTouchAndPointerButton(btnBrake, 'brake');
  bindTouchAndPointerButton(btnNos, 'nos');

  // Também permite deslizar o dedo diretamente sobre a tela (canvas) no celular para virar o carro!
  let canvasTouchId = null;
  let canvasTouchStartX = 0;

  canvas.addEventListener('touchstart', (e) => {
    sound.init();
    if (canvasTouchId === null && e.changedTouches.length > 0) {
      const t = e.changedTouches[0];
      canvasTouchId = t.identifier;
      canvasTouchStartX = t.clientX;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === canvasTouchId) {
        const dx = t.clientX - canvasTouchStartX;
        state.inputs.left = dx < -14;
        state.inputs.right = dx > 14;
        updateButtonVisuals();
      }
    }
  }, { passive: true });

  const clearCanvasTouch = (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === canvasTouchId) {
        canvasTouchId = null;
        state.inputs.left = false;
        state.inputs.right = false;
        updateButtonVisuals();
      }
    }
  };
  canvas.addEventListener('touchend', clearCanvasTouch, { passive: true });
  canvas.addEventListener('touchcancel', clearCanvasTouch, { passive: true });

  function toggleMuteButton() {
    const isMuted = sound.toggleMute();
    muteIconEl.textContent = isMuted ? '🔇' : '🔊';
    showBanner(isMuted ? 'SOM DESATIVADO 🔇' : 'SOM ATIVADO 🔊');
  }

  btnMute.addEventListener('click', toggleMuteButton);
  btnCamera.addEventListener('click', cycleCamera);
  btnPause.addEventListener('click', () => {
    if (state.running && !state.gameOver) togglePause();
  });

  btnStartGame.addEventListener('click', () => {
    sound.init();
    if (state.paused) {
      togglePause();
    } else {
      startNewRace();
    }
  });

  function updateButtonVisuals() {
    btnLeft.classList.toggle('pressed', state.inputs.left);
    btnRight.classList.toggle('pressed', state.inputs.right);
    btnGas.classList.toggle('pressed', state.inputs.gas);
    btnBrake.classList.toggle('pressed', state.inputs.brake);
    btnNos.classList.toggle('active-nos', state.inputs.nos && state.nosCharge > 5);
  }

  function cycleCamera() {
    state.cameraMode = (state.cameraMode + 1) % 3;
    const names = ['CÂMERA TRASEIRA PADRÃO', 'CÂMERA PANORÂMICA', 'CÂMERA DO CAPÔ'];
    showBanner(names[state.cameraMode]);
  }

  function togglePause() {
    state.paused = !state.paused;
    if (state.paused) {
      sound.update(0, 0, false, false);
      modalBadgeEl.textContent = '⏸ JOGO PAUSADO';
      modalTitleEl.textContent = 'CORRIDA EM PAUSA';
      modalSubtitleEl.textContent = 'Descanse um instante ou toque abaixo para voltar para a pista.';
      loadingStatusEl.textContent = '';
      btnStartGame.textContent = 'CONTINUAR CORRIDA ▶';
      overlayScreenEl.classList.remove('hidden');
    } else {
      overlayScreenEl.classList.add('hidden');
    }
  }

  let bannerTimeout = null;
  function showBanner(text) {
    eventBannerEl.textContent = text;
    eventBannerEl.classList.remove('hidden');
    clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => {
      eventBannerEl.classList.add('hidden');
    }, 1400);
  }

  // ============================================================================
  // FLUXO DE PARTIDA E REINÍCIO
  // ============================================================================
  function startNewRace() {
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.speedKmh = 140;
    state.distance = 0;
    state.playerX = 1.8;
    state.playerVelX = 0;
    state.health = state.maxHealth;
    state.invulnerableTimer = 0;
    state.nosCharge = 100;
    state.rank = 3;
    state.rivalDistances = [340, 165];

    missionPillEl.classList.remove('completed');
    overlayScreenEl.classList.add('hidden');
    resetTraffic();
    updateHUD();
  }

  function endRace(victory) {
    state.gameOver = true;
    state.running = false;
    nosFlamesGroup.visible = false;
    sound.update(0, 0, false, false);

    if (victory) {
      const firstPlace = state.rank === 1;
      const bonus = firstPlace ? 50 : 20;
      state.trophies += bonus;
      trophyCountEl.textContent = state.trophies;

      modalBadgeEl.textContent = firstPlace ? '🏆 VITÓRIA EM 1º LUGAR!' : '🏁 CORRIDA CONCLUÍDA!';
      modalTitleEl.textContent = firstPlace ? 'CAMPEÃO DA PONTE!' : `VOCÊ CHEGOU EM ${state.rank}º LUGAR!`;
      modalSubtitleEl.innerHTML = firstPlace
        ? `Missão <strong>"finish race in first place"</strong> concluída com sucesso! Você ganhou <strong>+${bonus} troféus</strong>!`
        : `Você cruzou a linha de chegada vivo! Use mais o <strong>NOS</strong> e tire finos no trânsito para alcançar o 1º lugar.`;
    } else {
      modalBadgeEl.textContent = '💥 CARRO DESTRUÍDO';
      modalTitleEl.textContent = 'FIM DE CORRIDA';
      modalSubtitleEl.textContent = 'Seu carro sofreu muitas colisões no trânsito pesado. Tente desviar com antecedência!';
    }

    loadingStatusEl.textContent = `Troféus acumulados: 🏆 ${state.trophies}`;
    btnStartGame.textContent = 'JOGAR NOVAMENTE 🔄';
    overlayScreenEl.classList.remove('hidden');
  }

  // ============================================================================
  // ATUALIZAÇÃO DO HUD (VELOCÍMETRO, MARCHAS, VIDA, RANK E PROGRESSO)
  // ============================================================================
  function updateHUD() {
    const spd = Math.round(state.speedKmh);
    speedValueEl.textContent = spd;

    let gear = 1;
    if (spd > 240) gear = 6;
    else if (spd > 195) gear = 5;
    else if (spd > 150) gear = 4;
    else if (spd > 105) gear = 3;
    else if (spd > 55) gear = 2;
    gearValueEl.textContent = gear;

    const gearMin = [0, 0, 55, 105, 150, 195, 240][gear];
    const gearMax = [55, 55, 105, 150, 195, 245, 330][gear];
    const rpmPct = Math.min(100, Math.max(18, ((spd - gearMin) / (gearMax - gearMin)) * 100));
    state.rpmPct = rpmPct;
    rpmBarFillEl.style.width = `${rpmPct}%`;

    const progressPct = Math.min(100, (state.distance / RACE_DISTANCE) * 100);
    progressFillEl.style.width = `${progressPct}%`;
    progressPointerEl.style.left = `${progressPct}%`;

    rankNumberEl.textContent = `${state.rank}.`;
    const nearestRivalGap = state.rank === 1
      ? Math.max(0, Math.abs(state.rivalDistances[0]))
      : Math.max(0, state.rivalDistances[state.rank - 2]);
    distanceGapEl.textContent = (nearestRivalGap / 10).toFixed(1).replace('.', ',');

    if (state.rank === 1) {
      missionPillEl.classList.add('completed');
    } else {
      missionPillEl.classList.remove('completed');
    }

    const circumference = 276.46;
    const offset = circumference * (1 - state.nosCharge / 100);
    nosRingProgressEl.style.strokeDashoffset = `${offset}`;
    nosRingProgressEl.style.stroke = state.nosActive ? '#00e5ff' : '#ffe324';

    const segs = healthSegmentsEl.children;
    for (let i = 0; i < segs.length; i++) {
      segs[i].className = 'health-seg';
      if (i < state.health) {
        if (state.health === 3) segs[i].classList.add('active');
        else if (state.health === 2) segs[i].classList.add('warn');
        else segs[i].classList.add('danger');
      }
    }
  }

  // ============================================================================
  // LOOP PRINCIPAL DE FÍSICA, TRÂNSITO, ÁUDIO E RENDERIZAÇÃO
  // ============================================================================
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);

    const dt = Math.min(clock.getDelta(), 0.05);

    if (state.running && !state.paused && !state.gameOver) {
      state.nosActive = state.inputs.nos && state.nosCharge > 2;
      if (state.nosActive) {
        state.nosCharge = Math.max(0, state.nosCharge - 28 * dt);
      } else {
        state.nosCharge = Math.min(100, state.nosCharge + 8 * dt);
      }

      const targetMax = state.nosActive ? state.nosMaxSpeed : state.baseMaxSpeed;
      if (state.nosActive) {
        state.speedKmh = THREE.MathUtils.lerp(state.speedKmh, targetMax, 3.2 * dt);
      } else if (state.inputs.brake) {
        state.speedKmh = Math.max(60, state.speedKmh - 145 * dt);
      } else if (state.inputs.gas) {
        state.speedKmh = Math.min(targetMax, state.speedKmh + 75 * dt);
      } else {
        const cruiseTarget = 225;
        if (state.speedKmh < cruiseTarget) {
          state.speedKmh = Math.min(cruiseTarget, state.speedKmh + 48 * dt);
        } else {
          state.speedKmh = Math.max(cruiseTarget, state.speedKmh - 35 * dt);
        }
      }

      nosFlamesGroup.visible = state.nosActive;
      if (state.nosActive) {
        const flicker = 0.85 + Math.random() * 0.45;
        flameL.scale.set(1, 1, flicker);
        flameR.scale.set(1, 1, flicker);
      }

      const steerInput = (state.inputs.right ? 1 : 0) - (state.inputs.left ? 1 : 0);
      const steerSpeed = 12.5;
      state.playerVelX = THREE.MathUtils.lerp(state.playerVelX, steerInput * steerSpeed, 10 * dt);
      state.playerX += state.playerVelX * dt;

      const maxOffset = ROAD_WIDTH / 2 - 1.25;
      if (state.playerX < -maxOffset) {
        state.playerX = -maxOffset;
        state.playerVelX = 0;
      } else if (state.playerX > maxOffset) {
        state.playerX = maxOffset;
        state.playerVelX = 0;
      }

      playerRoot.position.x = state.playerX;

      state.playerTiltZ = THREE.MathUtils.lerp(state.playerTiltZ, -state.playerVelX * 0.022, 10 * dt);
      state.playerYawY = THREE.MathUtils.lerp(state.playerYawY, -state.playerVelX * 0.028, 10 * dt);
      playerCarHolder.rotation.z = state.playerTiltZ;
      playerCarHolder.rotation.y = state.playerYawY;

      if (state.invulnerableTimer > 0) {
        state.invulnerableTimer -= dt;
        playerCarHolder.visible = Math.floor(state.invulnerableTimer * 16) % 2 === 0;
      } else {
        playerCarHolder.visible = true;
      }

      const playerSpeedMps = state.speedKmh / 3.6;
      const stepZ = playerSpeedMps * dt;
      state.distance += stepZ;

      roadSegments.forEach((seg) => {
        seg.position.z += stepZ;
        if (seg.position.z > 55) {
          seg.position.z -= NUM_SEGMENTS * SEGMENT_LENGTH;
        }
      });

      // Prédios laterais se movem ao lado da ponte (nunca no meio da pista)
      landmarkTowers.forEach((tower, idx) => {
        tower.position.z += stepZ * 0.35;
        if (tower.position.z > 40) {
          tower.position.z = -380 - idx * 55;
          tower.position.x = idx % 2 === 0 ? -28 - Math.random() * 6 : 25 + Math.random() * 6;
        }
      });

      const rivalBaseSpeedMps = 198 / 3.6;
      for (let i = 0; i < state.rivalDistances.length; i++) {
        state.rivalDistances[i] -= (playerSpeedMps - rivalBaseSpeedMps) * dt;
      }
      let currentRank = 1;
      for (let i = 0; i < state.rivalDistances.length; i++) {
        if (state.rivalDistances[i] > 0) currentRank++;
      }
      if (currentRank < state.rank) {
        sound.playNearMiss();
        showBanner(`ULTRAPASSAGEM! ${currentRank}º LUGAR! 🏁`);
      }
      state.rank = currentRank;

      for (let i = 0; i < trafficVehicles.length; i++) {
        const v = trafficVehicles[i];
        const relSpeedMps = (state.speedKmh - v.speedKmh) / 3.6;
        v.mesh.position.z += relSpeedMps * dt;

        const dz = Math.abs(v.mesh.position.z - playerRoot.position.z);
        const dx = Math.abs(v.mesh.position.x - playerRoot.position.x);

        const hitWidth = v.halfWidth + 0.85;
        const hitLength = v.halfLength + 1.85;
        if (dz < hitLength && dx < hitWidth && state.invulnerableTimer <= 0) {
          state.health -= 1;
          state.invulnerableTimer = 1.6;
          state.speedKmh = Math.max(85, state.speedKmh * 0.52);
          sound.playCrash();
          showBanner('💥 COLISÃO! CUIDADO!');

          v.mesh.position.z -= 12;

          if (state.health <= 0) {
            updateHUD();
            endRace(false);
            break;
          }
        }

        if (!v.passed && v.mesh.position.z > 2.5) {
          v.passed = true;
          if (dx < v.halfWidth + 1.95 && state.speedKmh > 180) {
            state.trophies += 5;
            trophyCountEl.textContent = state.trophies;
            state.nosCharge = Math.min(100, state.nosCharge + 14);
            sound.playNearMiss();
            showBanner('🔥 TIROU FINO! +5 🏆 +NOS');
          }
        }

        if (v.mesh.position.z > 28) {
          v.mesh.position.z = -380 - Math.random() * 65;
          v.laneIdx = Math.floor(Math.random() * LANE_CENTERS.length);
          v.mesh.position.x = LANE_CENTERS[v.laneIdx];
          v.passed = false;
        }
      }

      if (state.distance >= RACE_DISTANCE) {
        updateHUD();
        endRace(true);
      }

      updateHUD();
      sound.update(state.speedKmh, state.rpmPct, state.nosActive, true);
    } else if (!state.running && !state.gameOver) {
      sound.update(0, 0, false, false);
      roadSegments.forEach((seg) => {
        seg.position.z += 18 * dt;
        if (seg.position.z > 55) {
          seg.position.z -= NUM_SEGMENTS * SEGMENT_LENGTH;
        }
      });
    }

    const camConfigs = [
      { offsetX: 0, height: 3.15, dist: 6.9, lookY: 1.15, lookZ: -16, fov: 58 },
      { offsetX: 0, height: 4.4, dist: 9.4, lookY: 1.2, lookZ: -20, fov: 62 },
      { offsetX: 0, height: 1.55, dist: -0.4, lookY: 1.1, lookZ: -28, fov: 68 }
    ];
    const cfg = camConfigs[state.cameraMode];
    const nosBoostFov = state.nosActive ? 10 : 0;
    camera.fov = THREE.MathUtils.lerp(camera.fov, cfg.fov + nosBoostFov, 6 * dt);
    camera.updateProjectionMatrix();

    const targetCamX = playerRoot.position.x * 0.78 + cfg.offsetX;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, 8 * dt);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, cfg.height, 8 * dt);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, cfg.dist, 8 * dt);

    camera.lookAt(playerRoot.position.x * 0.65, cfg.lookY, cfg.lookZ);

    renderer.render(scene, camera);
  }

  animate();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
})();

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';

/* =====================================================================
 * 太阳系 · Three.js 演示
 * - 行星建模：球体 + textures 目录下的 NASA 2k 贴图
 *   （vite.config.js 已把 publicDir 指向 textures，贴图直接以根路径访问）
 * - 结构：orbitGroup(轨道倾角) > pivot(公转) > system(轨道锚点)
 *          > tiltGroup(自转轴倾角) > mesh(自转)
 * - 比例说明：真实比例下行星小到肉眼不可见，因此尺寸/距离/公转周期
 *   均做了艺术化压缩，各天体之间仍保持相对大小关系
 * ================================================================== */

const CONFIG = {
  sunRadius: 10, // 已随行星 2 倍观感放大同步调整（光晕尺寸联动此值）
  orbitBaseSeconds: 20, // 基准：地球公转一圈 20 秒
  orbitPeriodExponent: 0.6, // 公转周期压缩指数：pow(周期年, 0.6)，否则外行星几乎不动
  rotationBaseSeconds: 8, // 基准：地球自转一圈 8 秒
  backgroundRadius: 500,
  cameraFov: 55,
  cameraFar: 2000,
  loadingTimeoutMs: 15000, // 纹理加载兜底：超时后强制撤掉遮罩
};

/** 贴图清单（文件名与 textures 目录一一对应） */
const TEX = {
  sun: '/2k_sun_太阳.jpg',
  mercury: '/2k_mercury_水星.jpg',
  venus: '/2k_venus_surface_金星表面.jpg',
  earth: '/2k_earth_daymap_地球.jpg',
  moon: '/2k_moon_月球.jpg',
  mars: '/2k_mars_火星.jpg',
  jupiter: '/2k_jupiter_木星.jpg',
  saturn: '/2k_saturn_土星.jpg',
  saturnRing: '/2k_saturn_ring_alpha_土星环.png',
  uranus: '/2k_uranus_天王星.jpg',
  neptune: '/2k_neptune_海王星.jpg',
  milkyWay: '/2k_stars_milky_way_银河.jpg',
};

/**
 * 八大行星参数
 * 尺寸说明：radius 为观感放大约 2 倍后的值，distance 已同步拉开，
 * 保证相邻天体（含土星环外缘、地月系）互不重叠
 * periodYears：公转周期（年）；rotationDays：自转周期（天，负值 = 逆行自转）
 * axialTilt：自转轴倾角（度）；orbitInclination：轨道倾角（度）
 * fallback：贴图加载失败时显示的兜底纯色
 */
const PLANETS = [
  { name: '水星', texture: TEX.mercury, radius: 1.0, distance: 18, periodYears: 0.241, rotationDays: 58.6, axialTilt: 0.03, orbitInclination: 7.0, fallback: 0x8c8378 },
  { name: '金星', texture: TEX.venus, radius: 1.8, distance: 25, periodYears: 0.615, rotationDays: -243, axialTilt: 2.6, orbitInclination: 3.4, fallback: 0xd8b98a },
  { name: '地球', texture: TEX.earth, radius: 2.0, distance: 33, periodYears: 1.0, rotationDays: 1.0, axialTilt: 23.4, orbitInclination: 0.0, fallback: 0x3f6fb5 },
  { name: '火星', texture: TEX.mars, radius: 1.4, distance: 42, periodYears: 1.881, rotationDays: 1.03, axialTilt: 25.2, orbitInclination: 1.85, fallback: 0xb55a3c },
  { name: '木星', texture: TEX.jupiter, radius: 5.6, distance: 52, periodYears: 11.86, rotationDays: 0.41, axialTilt: 3.1, orbitInclination: 1.3, fallback: 0xc8a97e },
  { name: '土星', texture: TEX.saturn, radius: 4.8, distance: 76, periodYears: 29.45, rotationDays: 0.45, axialTilt: 26.7, orbitInclination: 2.5, fallback: 0xd8c08a, hasRing: true },
  { name: '天王星', texture: TEX.uranus, radius: 3.4, distance: 96, periodYears: 84.02, rotationDays: 0.72, axialTilt: 97.8, orbitInclination: 0.77, fallback: 0x9fd4d9 },
  { name: '海王星', texture: TEX.neptune, radius: 3.3, distance: 110, periodYears: 164.8, rotationDays: 0.67, axialTilt: 28.3, orbitInclination: 1.77, fallback: 0x4666d1 },
];

/** 月球参数（periodDays：绕地球公转周期，天；distance 已随地球放大调整） */
const MOON = {
  texture: TEX.moon,
  radius: 0.54,
  distance: 3.4,
  periodDays: 27.3,
  orbitInclination: 5.1,
  fallback: 0x9a9a9a,
};

/* ---------------- 全局状态 ---------------- */
let renderer;
let scene;
let camera;
let controls;
let textureLoader;
let maxAnisotropy = 1;
let loadingHidden = false;

/** 每帧动画回调集合：{ update(delta) } */
const animatables = [];

/* ---------------- 加载管理 ---------------- */
const manager = new THREE.LoadingManager();

manager.onProgress = (_url, loaded, total) => {
  const text = document.getElementById('loading-text');
  if (text) text.textContent = `正在加载宇宙… ${Math.round((loaded / total) * 100)}%`;
};

manager.onLoad = () => hideLoading();

manager.onError = (url) => {
  // 单张贴图失败不阻断场景：对应天体将以兜底纯色显示
  console.warn(`[solar] 纹理加载失败，该天体将以纯色显示: ${url}`);
};

/* ---------------- 工具函数 ---------------- */

/** 隐藏加载遮罩（幂等，可安全多次调用） */
function hideLoading() {
  if (loadingHidden) return;
  loadingHidden = true;
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.add('is-hidden');
  window.setTimeout(() => el.remove(), 900);
}

/** 致命错误提示（如 WebGL 不可用） */
function showFatalError(message) {
  hideLoading();
  const el = document.createElement('div');
  el.className = 'error-tip';
  el.textContent = message;
  document.body.appendChild(el);
}

/**
 * 为材质加载贴图；加载成功前材质保持兜底纯色，失败时仅告警
 * （中文文件名经 encodeURI 编码后请求；onError 可选，供特定对象定制失败降级）
 */
function loadTexture(url, material, onError) {
  textureLoader.load(
    encodeURI(url),
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace; // 颜色贴图需声明 sRGB，否则整体发白
      texture.anisotropy = maxAnisotropy; // 各向异性过滤，斜视时贴图更清晰
      material.map = texture;
      material.color.set(0xffffff); // 贴图就位后撤掉兜底色
      material.needsUpdate = true;
    },
    undefined,
    (error) => {
      console.warn(`[solar] 纹理加载失败: ${url}`, error);
      if (onError) onError(error);
    },
  );
}

/** 生成圆形轨道线（XZ 平面，半径 radius；默认较淡，避免喧宾夺主） */
function createOrbitLine(radius, opacity = 0.18) {
  const segments = 256;
  const positions = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: 0x6f8fc9, transparent: true, opacity, depthWrite: false });
  return new THREE.LineLoop(geometry, material);
}

/** 用 canvas 径向渐变生成太阳光晕贴图（不依赖外部资源） */
function createGlowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 244, 214, 1)');
  gradient.addColorStop(0.18, 'rgba(255, 208, 130, 0.55)');
  gradient.addColorStop(0.45, 'rgba(255, 150, 60, 0.18)');
  gradient.addColorStop(1, 'rgba(255, 120, 40, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* ---------------- 场景构建 ---------------- */

function initRenderer() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (err) {
    console.error('[solar] WebGL 初始化失败', err);
    showFatalError('抱歉，当前浏览器或环境不支持 WebGL，无法渲染太阳系。\n请更换现代浏览器（Chrome / Edge / Firefox）后重试。');
    return false;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  document.getElementById('app').appendChild(renderer.domElement);
  return true;
}

function initScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CONFIG.cameraFov, window.innerWidth / window.innerHeight, 0.1, CONFIG.cameraFar);
  // 初始位置拉近内太阳系（太阳 + 光晕占画面约 1/3 高，更震撼），
  // 并自行 lookAt：默认进入遨游模式后没有 OrbitControls 接管朝向
  camera.position.set(0, 26, 72);
  camera.lookAt(0, 0, 0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 12;
  controls.maxDistance = 400;

  // 太阳光：decay=0 关闭物理衰减，保证远行星也被照亮
  scene.add(new THREE.PointLight(0xfff2e0, 1.8, 0, 0));
  // 微弱冷色环境光，避免行星背光面完全漆黑
  scene.add(new THREE.AmbientLight(0x8fa3c8, 0.25));

  textureLoader = new THREE.TextureLoader(manager);
}

/** 银河星空天球（内表面贴图） */
function createBackground() {
  const material = new THREE.MeshBasicMaterial({ color: 0x101018, side: THREE.BackSide, toneMapped: false });
  loadTexture(TEX.milkyWay, material);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(CONFIG.backgroundRadius, 64, 32), material);
  scene.add(sky);
}

/** 太阳：自发光球体 + 加色混合光晕 */
function createSun() {
  const material = new THREE.MeshBasicMaterial({ color: 0xffb648, toneMapped: false });
  loadTexture(TEX.sun, material);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(CONFIG.sunRadius, 64, 40), material);
  mesh.rotation.y = Math.random() * Math.PI * 2;
  scene.add(mesh);

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createGlowTexture(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  glow.scale.setScalar(CONFIG.sunRadius * 3.6);
  scene.add(glow);

  // 太阳缓慢自转
  animatables.push({
    update: (delta) => {
      mesh.rotation.y += 0.02 * delta;
    },
  });
}

/** 土星环：重映射 UV 后的环形几何，使横向条带贴图沿半径方向展开 */
function createSaturnRing(planetRadius) {
  const inner = planetRadius * 1.24;
  const outer = planetRadius * 2.27;
  const geometry = new THREE.RingGeometry(inner, outer, 128, 1);

  // RingGeometry 默认 UV 是平面投影，无法让环贴图沿半径铺开；
  // 这里把 u 设为归一化半径、v 固定 0.5，匹配横向条带状的光环贴图。
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const v3 = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v3.fromBufferAttribute(position, i);
    const u = (v3.length() - inner) / (outer - inner);
    uv.setXY(i, u, 0.5);
  }
  uv.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({
    color: 0xbfae90,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false, // 避免透明环与行星深度冲突产生渲染瑕疵
  });

  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = -Math.PI / 2; // RingGeometry 位于 XY 平面，转到水平

  // 环的空间形态（环缝、透明渐变）完全依赖贴图 alpha，
  // 贴图失败时会变成实心圆环穿帮，因此失败时直接隐藏
  loadTexture(TEX.saturnRing, material, () => {
    ring.visible = false;
  });

  return ring;
}

/**
 * 创建一颗行星：轨道倾角容器 > 公转枢轴 > 轨道锚点 > 轴倾角容器 > 球体
 * @returns 行星句柄（system 为该行星在轨道上的锚点组，可挂卫星等）
 */
function createPlanet(config) {
  const { name, texture, radius, distance, periodYears, rotationDays, axialTilt, orbitInclination, fallback, hasRing } = config;

  const orbitGroup = new THREE.Group(); // 轨道倾角
  orbitGroup.rotation.x = THREE.MathUtils.degToRad(orbitInclination);
  scene.add(orbitGroup);

  orbitGroup.add(createOrbitLine(distance));

  const pivot = new THREE.Group(); // 公转枢轴
  pivot.rotation.y = Math.random() * Math.PI * 2; // 随机初始相位，避免行星排成一条直线
  orbitGroup.add(pivot);

  const system = new THREE.Group(); // 行星锚点（位于轨道上）
  system.position.x = distance;
  pivot.add(system);

  const tiltGroup = new THREE.Group(); // 自转轴倾角
  tiltGroup.rotation.z = THREE.MathUtils.degToRad(axialTilt);
  system.add(tiltGroup);

  const material = new THREE.MeshStandardMaterial({ color: fallback, roughness: 1, metalness: 0 });
  loadTexture(texture, material);

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 40), material);
  tiltGroup.add(mesh);

  if (hasRing) tiltGroup.add(createSaturnRing(radius));

  // 公转速度：地球 20 秒/圈为基准，按 pow(周期年, 0.6) 压缩换算
  const orbitSpeed = (Math.PI * 2) / (CONFIG.orbitBaseSeconds * Math.pow(periodYears, CONFIG.orbitPeriodExponent));
  // 自转速度：地球 8 秒/圈为基准，按 sqrt(|自转周期天|) 换算；负值 = 逆行（金星）
  const rotationSpeed = ((Math.sign(rotationDays) * Math.PI * 2) / CONFIG.rotationBaseSeconds) / Math.sqrt(Math.abs(rotationDays));

  animatables.push({
    update(delta) {
      pivot.rotation.y += orbitSpeed * delta;
      mesh.rotation.y += rotationSpeed * delta;
    },
  });

  return { name, system };
}

/** 月球：挂在地球锚点下，潮汐锁定（自转周期 = 公转周期） */
function createMoon(earthSystem) {
  const orbitTilt = new THREE.Group(); // 月球轨道倾角
  orbitTilt.rotation.x = THREE.MathUtils.degToRad(MOON.orbitInclination);
  earthSystem.add(orbitTilt);

  orbitTilt.add(createOrbitLine(MOON.distance, 0.14));

  const pivot = new THREE.Group();
  pivot.rotation.y = Math.random() * Math.PI * 2;
  orbitTilt.add(pivot);

  const material = new THREE.MeshStandardMaterial({ color: MOON.fallback, roughness: 1, metalness: 0 });
  loadTexture(MOON.texture, material);

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(MOON.radius, 32, 24), material);
  mesh.position.x = MOON.distance;
  pivot.add(mesh);

  const periodYears = MOON.periodDays / 365.25;
  const orbitSpeed = (Math.PI * 2) / (CONFIG.orbitBaseSeconds * Math.pow(periodYears, CONFIG.orbitPeriodExponent));

  animatables.push({
    update(delta) {
      pivot.rotation.y += orbitSpeed * delta;
      // 潮汐锁定：pivot 带动 mesh 旋转本身即为同步自转，本地无需再叠加旋转，
      // 这样月球才会始终以同一面朝向地球
    },
  });
}

/* ---------------- 双视角模式与自由遨游 ---------------- */

/**
 * 视角模式：
 * - 'orbit' 全局漫游（OrbitControls）
 * - 'free'  自由遨游（自写飞行控制，默认模式，由 main() 中 setViewMode 设定）
 * 不使用内置 FlyControls：其键盘监听挂在 canvas 上，canvas 无焦点时
 * WASD 会静默失效；自写约 70 行换取行为完全可控。
 */
let viewMode = 'orbit';

const flight = {
  keys: new Set(), // 当前按住的键（e.code）
  velocity: new THREE.Vector3(), // 平滑后的移动速度向量
  speed: 30, // 基础移动速度（units/s，滚轮可调）
  minSpeed: 2,
  maxSpeed: 300,
  dragging: false,
  euler: new THREE.Euler(0, 0, 0, 'YXZ'), // YXZ 顺序防止俯仰带出滚转
};

/** 注册自由遨游的键盘 / 鼠标 / 滚轮输入（事件常驻，仅 free 模式生效） */
function initFlightControls() {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && !e.repeat) {
      setViewMode(viewMode === 'free' ? 'orbit' : 'free');
      return;
    }
    if (e.code === 'Escape' && viewMode === 'free') {
      setViewMode('orbit');
      return;
    }
    flight.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => flight.keys.delete(e.code));
  window.addEventListener('blur', () => flight.keys.clear()); // 切窗后防卡键

  const el = renderer.domElement;
  el.addEventListener('mousedown', (e) => {
    if (viewMode === 'free' && e.button === 0) flight.dragging = true;
  });
  window.addEventListener('mouseup', () => {
    flight.dragging = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (!flight.dragging || viewMode !== 'free') return;
    flight.euler.setFromQuaternion(camera.quaternion);
    flight.euler.y -= e.movementX * 0.0022;
    flight.euler.x -= e.movementY * 0.0022;
    const lim = Math.PI / 2 - 0.01; // 俯仰限位，防止视角翻转
    flight.euler.x = THREE.MathUtils.clamp(flight.euler.x, -lim, lim);
    camera.quaternion.setFromEuler(flight.euler);
  });

  window.addEventListener(
    'wheel',
    (e) => {
      if (viewMode !== 'free') return; // 全局模式滚轮缩放交给 OrbitControls
      e.preventDefault();
      flight.speed = THREE.MathUtils.clamp(flight.speed * (e.deltaY > 0 ? 0.85 : 1.18), flight.minSpeed, flight.maxSpeed);
      updateHud();
    },
    { passive: false },
  );

  const btn = document.getElementById('mode-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      setViewMode(viewMode === 'free' ? 'orbit' : 'free');
      btn.blur(); // 移除焦点，避免空格/回车误触发按钮
    });
  }
}

/** 自由飞行：按相机朝向合成移动方向，指数阻尼平滑加减速（帧率无关） */
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _targetVel = new THREE.Vector3();

function updateFlight(delta) {
  _forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _moveDir.set(0, 0, 0);
  const k = flight.keys;
  if (k.has('KeyW') || k.has('ArrowUp')) _moveDir.add(_forward);
  if (k.has('KeyS') || k.has('ArrowDown')) _moveDir.sub(_forward);
  if (k.has('KeyD') || k.has('ArrowRight')) _moveDir.add(_right);
  if (k.has('KeyA') || k.has('ArrowLeft')) _moveDir.sub(_right);
  if (k.has('KeyR')) _moveDir.y += 1;
  if (k.has('KeyF')) _moveDir.y -= 1;
  if (_moveDir.lengthSq() > 0) _moveDir.normalize();

  const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1;
  _targetVel.copy(_moveDir).multiplyScalar(flight.speed * boost);
  flight.velocity.lerp(_targetVel, 1 - Math.exp(-6 * delta));
  camera.position.addScaledVector(flight.velocity, delta);
  // 软边界：限制在银河天球内，防止飞出背景后画面突然变黑
  camera.position.clampLength(0, CONFIG.backgroundRadius - 20);
}

/** 切换视角模式；切回全局时相机位置保留、朝向重定向回原点俯瞰 */
function setViewMode(mode) {
  if (mode === viewMode) return;
  viewMode = mode;
  if (mode === 'free') {
    controls.enabled = false; // 关闭轨道交互，避免双控制器抢输入
    flight.velocity.set(0, 0, 0);
    flight.dragging = false;
  } else {
    controls.enabled = true;
    controls.target.set(0, 0, 0);
    controls.update();
  }
  updateHud();
}

/** 根据当前模式刷新 HUD 按钮与操作提示 */
function updateHud() {
  const btn = document.getElementById('mode-btn');
  const hint = document.getElementById('hint');
  if (!btn || !hint) return;
  if (viewMode === 'free') {
    btn.textContent = '🌐 返回全局视图';
    hint.textContent = `WASD 平移 · R/F 升降 · 拖拽转向 · 滚轮调速(${Math.round(flight.speed)}) · Shift 加速 · V/Esc 返回`;
  } else {
    btn.textContent = '🚀 自由遨游';
    hint.textContent = '拖拽旋转 · 滚轮缩放 · 右键平移 · V 进入遨游';
  }
}

/* ---------------- 事件与主循环 ---------------- */

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // 跨屏拖动/浏览器缩放时 DPR 会变化
  renderer.setSize(window.innerWidth, window.innerHeight);
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  // delta 上限 0.1s：切换标签页回来时避免天体瞬移
  const delta = Math.min(clock.getDelta(), 0.1);
  for (const item of animatables) item.update(delta);
  if (viewMode === 'free') updateFlight(delta);
  else controls.update();
  renderer.render(scene, camera);
}

function main() {
  if (!initRenderer()) return;
  initScene();
  createBackground();
  createSun();

  const planets = PLANETS.map(createPlanet);
  const earthHandle = planets.find((p) => p.name === '地球');
  if (!earthHandle) throw new Error('PLANETS 配置中缺少地球，无法挂载月球');
  createMoon(earthHandle.system);

  window.addEventListener('resize', onResize);
  initFlightControls();
  setViewMode('free'); // 默认进入自由遨游模式（内部会刷新 HUD）

  // 兜底：即使个别纹理请求长时间挂起，超时后也强制撤掉加载遮罩
  window.setTimeout(hideLoading, CONFIG.loadingTimeoutMs);

  animate();
}

main();

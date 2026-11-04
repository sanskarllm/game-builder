// three.js viewer for Meta-AI-built primitive models, plus GLB export.
// Loaded lazily so the rest of the editor works even if the CDN is blocked.

let THREE, OrbitControls, GLTFExporter, GLTFLoader;
async function load() {
  if (THREE) return;
  THREE = await import('three');
  ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
  ({ GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js'));
  ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
}

const DEG = Math.PI / 180;
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

function material(color, style) {
  const c = new THREE.Color(/^#[0-9a-f]{3,8}$/i.test(color || '') ? color : '#9397ab');
  if (/toon/i.test(style)) return new THREE.MeshToonMaterial({ color: c });
  if (/realistic|pbr/i.test(style)) return new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.1 });
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: /low-poly/i.test(style) });
}

function geometry(p, style) {
  const s = Array.isArray(p.size) ? p.size.map(Number) : [];
  const lo = /low-poly/i.test(style);
  const seg = p.segments || (lo ? 8 : 28);
  switch (String(p.shape).toLowerCase()) {
    case 'box': case 'cube': return new THREE.BoxGeometry(num(s[0], 1), num(s[1], num(s[0], 1)), num(s[2], num(s[0], 1)));
    case 'cylinder': return new THREE.CylinderGeometry(num(s[0], 0.5), num(s[1], num(s[0], 0.5)), num(s[2], 1), seg);
    case 'cone': return new THREE.ConeGeometry(num(s[0], 0.5), num(s[1], 1), seg);
    case 'sphere': return new THREE.SphereGeometry(num(s[0], 0.5), lo ? 10 : 28, lo ? 7 : 20);
    case 'torus': return new THREE.TorusGeometry(num(s[0], 0.5), num(s[1], 0.1), lo ? 6 : 14, lo ? 12 : 36);
    case 'capsule': return new THREE.CapsuleGeometry(num(s[0], 0.2), num(s[1], 0.6), lo ? 3 : 8, lo ? 8 : 16);
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

export function buildGroup(asset, style) {
  const group = new THREE.Group(); group.name = asset.name || 'asset';
  let tris = 0;
  for (const p of asset.parts || []) {
    const geo = geometry(p, style);
    const mesh = new THREE.Mesh(geo, material(p.color, style));
    const pos = p.position || [0, 0, 0], rot = p.rotation || [0, 0, 0];
    mesh.position.set(num(pos[0], 0), num(pos[1], 0), num(pos[2], 0));
    mesh.rotation.set(num(rot[0], 0) * DEG, num(rot[1], 0) * DEG, num(rot[2], 0) * DEG);
    mesh.name = p.label || p.shape; mesh.castShadow = mesh.receiveShadow = true;
    tris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    group.add(mesh);
  }
  return { group, tris: Math.round(tris) };
}

const HEIGHT = { Building: 6, Human: 1.75, Prop: 0.6 };
function countTris(obj) {
  let t = 0;
  obj.traverse(o => { if (o.isMesh && o.geometry) { const g = o.geometry; t += g.index ? g.index.count / 3 : g.attributes.position.count / 3; } });
  return Math.round(t);
}

// SAM 3D Objects meshes come in their own unit frame: apply the user's
// up-axis fix, scale to a real-world height, and stand the model on y=0.
async function loadGlb(asset) {
  const b64 = String(asset.glb).split(',')[1];
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
  const inner = gltf.scene;
  const fix = asset.fix || [0, 0, 0];
  inner.rotation.set(fix[0] * DEG, fix[1] * DEG, fix[2] * DEG);
  const group = new THREE.Group(); group.name = asset.name || 'asset'; group.add(inner);
  group.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(group); const size = box.getSize(new THREE.Vector3());
  const target = asset.height || HEIGHT[asset.cat] || 1;
  inner.scale.setScalar(target / Math.max(size.y, 1e-6));
  group.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(group); const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box.min.y, -c.z);
  group.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return { group, tris: countTris(group) };
}

export async function buildObject(asset, style) {
  await load();
  return asset.glb ? loadGlb(asset) : buildGroup(asset, style);
}

// .glb of any asset, without a viewer on screen (asset pack, Full Game).
export async function exportGLB(asset, style) {
  const { group } = await buildObject(asset, style || asset.style || 'Low-poly stylized');
  const buf = await new GLTFExporter().parseAsync(group, { binary: true });
  return new Blob([buf], { type: 'model/gltf-binary' });
}

export async function createViewer(canvas) {
  await load();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.01, 500);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xdfe4ff, 0x2b2741, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(6, 10, 7); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
  const grid = new THREE.GridHelper(40, 40, 0x595d6c, 0x3f424d); scene.add(grid);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(20, 48), new THREE.ShadowMaterial({ opacity: 0.35 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  let current = null, raf = 0, wire = false, autoRotate = false, showToken = 0;

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  function frame() { raf = requestAnimationFrame(frame); controls.autoRotate = autoRotate; controls.update(); renderer.render(scene, camera); }
  frame();

  function frameObject() {
    if (!current) return;
    const box = new THREE.Box3().setFromObject(current); const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z, 0.2);
    camera.position.set(c.x + r * 1.05, c.y + r * 0.6, c.z + r * 1.35); controls.target.copy(c); camera.near = r / 100; camera.far = r * 100; camera.updateProjectionMatrix();
    grid.scale.setScalar(Math.max(0.05, r / 8)); ground.scale.setScalar(Math.max(0.05, r / 8));
    sun.position.set(c.x + r * 2, c.y + r * 4, c.z + r * 2.5); sun.shadow.camera.left = sun.shadow.camera.bottom = -r * 2; sun.shadow.camera.right = sun.shadow.camera.top = r * 2; sun.shadow.camera.updateProjectionMatrix();
  }

  return {
    async show(asset, style) {
      const token = ++showToken;
      const { group, tris } = await buildObject(asset, style);
      if (token !== showToken) return tris; // a newer asset was selected meanwhile
      if (current) { scene.remove(current); current.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
      current = group; scene.add(group);
      group.traverse(o => { if (o.material) o.material.wireframe = wire; });
      frameObject(); resize(); return tris;
    },
    reset: frameObject,
    toggleWire() { wire = !wire; if (current) current.traverse(o => { if (o.material) o.material.wireframe = wire; }); return wire; },
    toggleSpin() { autoRotate = !autoRotate; return autoRotate; },
    async exportGLB(asset, style) {
      const { group } = await buildObject(asset, style);
      const exporter = new GLTFExporter();
      const buf = await exporter.parseAsync(group, { binary: true });
      return new Blob([buf], { type: 'model/gltf-binary' });
    },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); },
  };
}

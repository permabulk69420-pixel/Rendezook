import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const MODEL_URL = './assets/models/flanker_vr_quest3.glb';
const statusEl = document.querySelector('#status');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x79b6e6);
scene.fog = new THREE.Fog(0x79b6e6, 1800, 9000);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const vrButton = VRButton.createButton(renderer);
vrButton.id = 'vrButton';
document.body.appendChild(vrButton);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 20000);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xcfe9ff, 0x5d4934, 2.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(500, 900, 300);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(20000, 20000),
  new THREE.MeshStandardMaterial({ color: 0x8a7353, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

const grid = new THREE.GridHelper(12000, 120, 0x233548, 0x425a6f);
grid.position.y = 0.08;
grid.material.opacity = 0.23;
grid.material.transparent = true;
scene.add(grid);

// Aircraft root. We move/rotate this object; the GLB stays as authored beneath it.
const aircraft = new THREE.Group();
scene.add(aircraft);

// XR seat rig is parented to the aircraft so the headset naturally follows it.
const xrSeatRig = new THREE.Group();
xrSeatRig.position.set(0, 1.5, 0);
aircraft.add(xrSeatRig);

const REQUIRED_VR_NODES = [
  'AircraftOrigin',
  'SeatAnchor',
  'PilotEye',
  'FlightStickPivot',
  'FlightStickGrip',
  'ThrottlePivot',
  'ThrottleGrip',
  'RudderPedalL',
  'RudderPedalR',
  'CanopyHinge'
];

let modelRoot = null;
let pilotEye = null;
let modelLoaded = false;
let modelMessage = 'Waiting for GLB…';
let foundNodes = [];

const loader = new GLTFLoader();
loader.load(
  MODEL_URL,
  (gltf) => {
    modelRoot = gltf.scene;
    aircraft.add(modelRoot);
    modelRoot.updateMatrixWorld(true);

    foundNodes = REQUIRED_VR_NODES.filter((name) => modelRoot.getObjectByName(name));
    pilotEye = modelRoot.getObjectByName('PilotEye') || modelRoot.getObjectByName('SeatAnchor');

    if (pilotEye) {
      const eyeWorld = new THREE.Vector3();
      pilotEye.getWorldPosition(eyeWorld);
      xrSeatRig.position.copy(aircraft.worldToLocal(eyeWorld.clone()));
    }

    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = box.getSize(new THREE.Vector3());
    modelLoaded = true;
    modelMessage = `GLB loaded · ${foundNodes.length}/${REQUIRED_VR_NODES.length} VR nodes found · size ${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)} m`;
    console.log('[Rendezook] VR nodes:', Object.fromEntries(REQUIRED_VR_NODES.map((n) => [n, !!modelRoot.getObjectByName(n)])));
  },
  undefined,
  (err) => {
    console.warn('[Rendezook] GLB not loaded yet:', err);
    modelMessage = 'Upload assets/models/flanker_vr_quest3.glb, then reload.';
  }
);

const state = {
  throttle: 0.35,
  speed: 90,
  pitch: 0,
  roll: 0,
  yaw: 0
};

const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyR') resetAircraft();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function resetAircraft() {
  aircraft.position.set(0, 350, 0);
  aircraft.quaternion.identity();
  state.throttle = 0.35;
  state.speed = 90;
}
resetAircraft();

function applyKeyboard(dt) {
  if (keys.has('KeyW')) state.throttle += 0.35 * dt;
  if (keys.has('KeyS')) state.throttle -= 0.35 * dt;

  state.pitch = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0);
  state.roll = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
  state.yaw = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
}

function getThumbstick(gamepad) {
  if (!gamepad) return { x: 0, y: 0 };
  // Quest Touch generally exposes the thumbstick on axes 2/3.
  if (gamepad.axes.length >= 4) return { x: gamepad.axes[2] || 0, y: gamepad.axes[3] || 0 };
  return { x: gamepad.axes[0] || 0, y: gamepad.axes[1] || 0 };
}

function applyXRControls(dt) {
  const session = renderer.xr.getSession();
  if (!session) return;

  let left = null;
  let right = null;
  for (const source of session.inputSources) {
    if (!source.gamepad) continue;
    if (source.handedness === 'left') left = getThumbstick(source.gamepad);
    if (source.handedness === 'right') right = getThumbstick(source.gamepad);
  }

  if (left) {
    state.yaw = THREE.MathUtils.clamp(left.x, -1, 1);
    state.throttle += -left.y * 0.28 * dt;
  }
  if (right) {
    state.roll = THREE.MathUtils.clamp(right.x, -1, 1);
    state.pitch = THREE.MathUtils.clamp(right.y, -1, 1);
  }
}

function updateFlight(dt) {
  state.throttle = THREE.MathUtils.clamp(state.throttle, 0, 1);

  const minSpeed = 45;
  const maxSpeed = 330;
  const targetSpeed = THREE.MathUtils.lerp(minSpeed, maxSpeed, state.throttle);
  state.speed = THREE.MathUtils.damp(state.speed, targetSpeed, 1.5, dt);

  const pitchRate = THREE.MathUtils.degToRad(38);
  const rollRate = THREE.MathUtils.degToRad(80);
  const yawRate = THREE.MathUtils.degToRad(24);

  aircraft.rotateX(state.pitch * pitchRate * dt);
  aircraft.rotateZ(-state.roll * rollRate * dt);
  aircraft.rotateY(-state.yaw * yawRate * dt);

  // Initial assumption: aircraft forward is local -Z. Easy to flip if the GLB proves opposite.
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraft.quaternion).normalize();
  aircraft.position.addScaledVector(forward, state.speed * dt);

  if (aircraft.position.y < 5) resetAircraft();
}

function updateDesktopCamera(dt) {
  if (renderer.xr.isPresenting) return;

  const chaseOffset = new THREE.Vector3(0, 5.5, 18).applyQuaternion(aircraft.quaternion);
  const desired = aircraft.position.clone().add(chaseOffset);
  camera.position.lerp(desired, 1 - Math.exp(-5 * dt));

  const lookAhead = new THREE.Vector3(0, 1.5, -35).applyQuaternion(aircraft.quaternion);
  camera.lookAt(aircraft.position.clone().add(lookAhead));
}

renderer.xr.addEventListener('sessionstart', () => {
  xrSeatRig.add(camera);
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
});

renderer.xr.addEventListener('sessionend', () => {
  scene.add(camera);
});

function updateHud() {
  const altitude = Math.max(0, aircraft.position.y).toFixed(0);
  const knots = (state.speed * 1.94384).toFixed(0);
  statusEl.textContent = `${modelMessage} · throttle ${(state.throttle * 100).toFixed(0)}% · ${knots} kt · ${altitude} m`;
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 20);

  state.pitch = 0;
  state.roll = 0;
  state.yaw = 0;
  applyKeyboard(dt);
  applyXRControls(dt);
  updateFlight(dt);
  updateDesktopCamera(dt);
  updateHud();

  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

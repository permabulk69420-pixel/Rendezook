import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

// Same hand assets already proven in Oasis, pinned to the source commit.
const HAND_ASSETS = Object.freeze({
  left: 'https://raw.githubusercontent.com/permabulk69420-pixel/dumbgame/be12b76764264438e33879b3a05406f16d37c194/assets/models/hands/LeftHand.glb',
  right: 'https://raw.githubusercontent.com/permabulk69420-pixel/dumbgame/be12b76764264438e33879b3a05406f16d37c194/assets/models/hands/RightHand.glb'
});

const HAND_GRIP_OFFSETS = Object.freeze({
  left: Object.freeze({ rotation: Object.freeze([0, 0, Math.PI / 2]) }),
  right: Object.freeze({ rotation: Object.freeze([0, 0, -Math.PI / 2]) })
});

const loader = new GLTFLoader();

function prepareModel(root) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = false;
    child.receiveShadow = false;
    child.frustumCulled = false;
  });
  return root;
}

function createActions(root, clips) {
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map();

  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    action.play();
    action.paused = true;
    action.weight = 0;
    actions.set(clip.name, action);
  }

  return { mixer, actions, current: null };
}

function setPose(mixerState, name, amount) {
  if (!mixerState) return;
  const action = mixerState.actions.get(name);
  if (!action) return;

  if (mixerState.current && mixerState.current !== action) {
    mixerState.current.weight = 0;
  }

  mixerState.current = action;
  action.weight = 1;
  action.time = THREE.MathUtils.clamp(amount, 0, 1);
}

function pulseState(state, strength = 0.22, durationMs = 35) {
  const gamepad = state?.inputSource?.gamepad;
  if (!gamepad) return;

  const actuator = gamepad.hapticActuators?.[0] || gamepad.vibrationActuator;
  if (!actuator?.pulse) return;

  actuator.pulse(THREE.MathUtils.clamp(strength, 0, 1), durationMs).catch?.(() => {});
}

export function createVRHands({ renderer, parent, onError = console.warn }) {
  if (!parent) throw new Error('VR hands require an XR rig parent.');

  const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
  const grips = [renderer.xr.getControllerGrip(0), renderer.xr.getControllerGrip(1)];
  const models = { left: null, right: null };

  const states = controllers.map((controller, index) => {
    const grip = grips[index];
    parent.add(controller);
    parent.add(grip);

    return {
      controller,
      grip,
      inputSource: null,
      handedness: '',
      handAnchor: null,
      handRoot: null,
      mixerState: null,
      poseOverride: null
    };
  });

  function detach(state) {
    if (state.handAnchor) state.grip.remove(state.handAnchor);
    state.handAnchor = null;
    state.handRoot = null;
    state.mixerState = null;
    state.poseOverride = null;
  }

  function attach(state) {
    const handedness = state.handedness;
    const gltf = models[handedness];
    if (!gltf || (handedness !== 'left' && handedness !== 'right')) return;

    detach(state);

    const root = prepareModel(clone(gltf.scene));
    root.name = `${handedness}-vr-hand`;

    const anchor = new THREE.Group();
    anchor.name = `${handedness}-hand-grip-offset`;
    anchor.rotation.set(...HAND_GRIP_OFFSETS[handedness].rotation);
    anchor.add(root);
    state.grip.add(anchor);

    state.handAnchor = anchor;
    state.handRoot = root;
    state.mixerState = createActions(root, gltf.animations);
    setPose(state.mixerState, 'Open', 0);
  }

  for (const state of states) {
    state.controller.addEventListener('connected', (event) => {
      state.inputSource = event.data;
      state.handedness = event.data.handedness || '';
      attach(state);
    });

    state.controller.addEventListener('disconnected', () => {
      state.inputSource = null;
      state.handedness = '';
      detach(state);
    });
  }

  Promise.allSettled([
    loader.loadAsync(HAND_ASSETS.left),
    loader.loadAsync(HAND_ASSETS.right)
  ]).then(([left, right]) => {
    if (left.status === 'fulfilled') models.left = left.value;
    else onError(`Left VR hand failed to load: ${left.reason?.message || left.reason}`);

    if (right.status === 'fulfilled') models.right = right.value;
    else onError(`Right VR hand failed to load: ${right.reason?.message || right.reason}`);

    for (const state of states) attach(state);
  });

  function update(dt) {
    for (const state of states) {
      if (!state.mixerState) continue;

      const buttons = state.inputSource?.gamepad?.buttons || [];
      const trigger = buttons[0]?.value ?? 0;
      const squeeze = buttons[1]?.value ?? 0;

      if (state.poseOverride) {
        setPose(state.mixerState, state.poseOverride.name, state.poseOverride.amount);
      } else if (squeeze > 0.08 && trigger > 0.08) {
        setPose(state.mixerState, 'Fist', Math.max(trigger, squeeze));
      } else if (squeeze > 0.08) {
        setPose(state.mixerState, 'Grip', squeeze);
      } else if (trigger > 0.08) {
        setPose(state.mixerState, 'Pinch', trigger);
      } else {
        setPose(state.mixerState, 'Open', 0);
      }

      state.mixerState.mixer.update(dt);
    }
  }

  function getState(handedness) {
    return states.find((state) => state.handedness === handedness) || null;
  }

  function setControlGrip(handedness, active, amount = 0.72) {
    const state = getState(handedness);
    if (!state) return;
    state.poseOverride = active ? { name: 'Grip', amount } : null;
  }

  function pulse(handedness, strength, durationMs) {
    pulseState(getState(handedness), strength, durationMs);
  }

  return {
    states,
    controllers,
    grips,
    update,
    getState,
    setControlGrip,
    pulse
  };
}

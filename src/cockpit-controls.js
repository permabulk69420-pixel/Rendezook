import * as THREE from 'three';

const STICK_GRAB_RADIUS = 0.22;
const THROTTLE_GRAB_RADIUS = 0.22;
const GRAB_ON = 0.55;
const GRAB_OFF = 0.25;

const MAX_STICK_PITCH = THREE.MathUtils.degToRad(24);
const MAX_STICK_ROLL = THREE.MathUtils.degToRad(24);
const THROTTLE_FORWARD = THREE.MathUtils.degToRad(-36);
const THROTTLE_BACK = THREE.MathUtils.degToRad(32);

const worldPos = new THREE.Vector3();
const localPos = new THREE.Vector3();
const handVector = new THREE.Vector3();

function squeezeValue(handState) {
  return handState?.inputSource?.gamepad?.buttons?.[1]?.value ?? 0;
}

function handDistanceTo(handState, target) {
  if (!handState?.grip || !target) return Infinity;
  handState.grip.getWorldPosition(worldPos);
  return worldPos.distanceTo(target.getWorldPosition(localPos));
}

function handVectorFromPivot(handState, pivot) {
  handState.grip.getWorldPosition(worldPos);
  pivot.parent.worldToLocal(localPos.copy(worldPos));
  return handVector.copy(localPos).sub(pivot.position);
}

function throttleToAngle(value) {
  return THREE.MathUtils.lerp(THROTTLE_BACK, THROTTLE_FORWARD, THREE.MathUtils.clamp(value, 0, 1));
}

function angleToThrottle(angle) {
  return THREE.MathUtils.clamp((THROTTLE_BACK - angle) / (THROTTLE_BACK - THROTTLE_FORWARD), 0, 1);
}

export function createCockpitControls({
  flightStickPivot,
  flightStickGrip,
  throttlePivot,
  throttleGrip,
  handStates,
  flightState,
  setHandGrip = () => {},
  pulseHand = () => {}
}) {
  if (!flightStickPivot || !flightStickGrip || !throttlePivot || !throttleGrip) {
    throw new Error('Cockpit controls require stick and throttle pivot/grip nodes.');
  }

  const stickBaseQuaternion = flightStickPivot.quaternion.clone();
  const throttleBaseQuaternion = throttlePivot.quaternion.clone();
  const stickRest = flightStickGrip.position.clone();
  const throttleRest = throttleGrip.position.clone();
  const throttleRestPitch = Math.atan2(throttleRest.z, throttleRest.y);

  let stickPitch = 0;
  let stickRoll = 0;
  let throttleAngle = throttleToAngle(flightState.throttle);
  let stickGrab = null;
  let throttleGrab = null;

  const qPitch = new THREE.Quaternion();
  const qRoll = new THREE.Quaternion();
  const qThrottle = new THREE.Quaternion();
  const axisX = new THREE.Vector3(1, 0, 0);
  const axisZ = new THREE.Vector3(0, 0, 1);

  function hand(handedness) {
    return handStates.find((item) => item.handedness === handedness) || null;
  }

  function applyStickVisual() {
    qPitch.setFromAxisAngle(axisX, stickPitch);
    qRoll.setFromAxisAngle(axisZ, -stickRoll);
    flightStickPivot.quaternion.copy(stickBaseQuaternion).multiply(qPitch).multiply(qRoll);
    flightStickPivot.updateMatrixWorld(true);
  }

  function applyThrottleVisual() {
    qThrottle.setFromAxisAngle(axisX, throttleAngle);
    throttlePivot.quaternion.copy(throttleBaseQuaternion).multiply(qThrottle);
    throttlePivot.updateMatrixWorld(true);
  }

  function beginStickGrab(right) {
    const v = handVectorFromPivot(right, flightStickPivot);
    const handPitch = Math.atan2(v.z, Math.max(0.001, v.y)) - Math.atan2(stickRest.z, Math.max(0.001, stickRest.y));
    const handRoll = Math.atan2(v.x, Math.max(0.001, v.y));

    stickGrab = {
      pitchOffset: stickPitch - handPitch,
      rollOffset: stickRoll - handRoll
    };

    setHandGrip('right', true, 0.74);
    pulseHand('right', 0.28, 35);
  }

  function endStickGrab() {
    if (!stickGrab) return;
    stickGrab = null;
    setHandGrip('right', false);
    pulseHand('right', 0.14, 24);
  }

  function beginThrottleGrab(left) {
    const v = handVectorFromPivot(left, throttlePivot);
    const handAngle = Math.atan2(v.z, Math.max(0.001, v.y)) - throttleRestPitch;

    throttleGrab = {
      angleOffset: throttleAngle - handAngle
    };

    setHandGrip('left', true, 0.76);
    pulseHand('left', 0.28, 35);
  }

  function endThrottleGrab() {
    if (!throttleGrab) return;
    throttleGrab = null;
    setHandGrip('left', false);
    pulseHand('left', 0.14, 24);
  }

  function updateStick(dt, right) {
    const squeeze = squeezeValue(right);
    const squeezed = squeeze >= GRAB_ON;

    if (!stickGrab && squeezed && handDistanceTo(right, flightStickGrip) <= STICK_GRAB_RADIUS) {
      beginStickGrab(right);
    }

    if (stickGrab && squeeze <= GRAB_OFF) endStickGrab();

    if (stickGrab && right) {
      const v = handVectorFromPivot(right, flightStickPivot);
      const handPitch = Math.atan2(v.z, Math.max(0.001, v.y)) - Math.atan2(stickRest.z, Math.max(0.001, stickRest.y));
      const handRoll = Math.atan2(v.x, Math.max(0.001, v.y));

      stickPitch = THREE.MathUtils.clamp(handPitch + stickGrab.pitchOffset, -MAX_STICK_PITCH, MAX_STICK_PITCH);
      stickRoll = THREE.MathUtils.clamp(handRoll + stickGrab.rollOffset, -MAX_STICK_ROLL, MAX_STICK_ROLL);

      flightState.pitch = stickPitch / MAX_STICK_PITCH;
      flightState.roll = stickRoll / MAX_STICK_ROLL;
    } else {
      stickPitch = THREE.MathUtils.damp(stickPitch, 0, 10, dt);
      stickRoll = THREE.MathUtils.damp(stickRoll, 0, 10, dt);
    }

    applyStickVisual();
  }

  function updateThrottle(dt, left) {
    const squeeze = squeezeValue(left);
    const squeezed = squeeze >= GRAB_ON;

    if (!throttleGrab && squeezed && handDistanceTo(left, throttleGrip) <= THROTTLE_GRAB_RADIUS) {
      beginThrottleGrab(left);
    }

    if (throttleGrab && squeeze <= GRAB_OFF) endThrottleGrab();

    if (throttleGrab && left) {
      const v = handVectorFromPivot(left, throttlePivot);
      const handAngle = Math.atan2(v.z, Math.max(0.001, v.y)) - throttleRestPitch;
      throttleAngle = THREE.MathUtils.clamp(handAngle + throttleGrab.angleOffset, THROTTLE_FORWARD, THROTTLE_BACK);
      flightState.throttle = angleToThrottle(throttleAngle);
    } else {
      throttleAngle = THREE.MathUtils.damp(throttleAngle, throttleToAngle(flightState.throttle), 12, dt);
    }

    applyThrottleVisual();
  }

  function update(dt) {
    updateStick(dt, hand('right'));
    updateThrottle(dt, hand('left'));
  }

  function reset() {
    endStickGrab();
    endThrottleGrab();
    stickPitch = 0;
    stickRoll = 0;
    throttleAngle = throttleToAngle(flightState.throttle);
    applyStickVisual();
    applyThrottleVisual();
  }

  applyStickVisual();
  applyThrottleVisual();

  return {
    update,
    reset,
    isStickGrabbed: () => Boolean(stickGrab),
    isThrottleGrabbed: () => Boolean(throttleGrab)
  };
}

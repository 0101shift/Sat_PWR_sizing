"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import { DEFAULT_EO_SATELLITES, type SatelliteInventoryItem } from "./lib/satellite-inventory";
import { shortestQuaternionTarget, type MissionConfig, type QuaternionTuple, type Vector3 } from "./lib/orbit-model";
import { buildInventorySatelliteModel, disposeThreeTree, setModelPayloadBoresight } from "./lib/satellite-three";

const ATLAS = DEFAULT_EO_SATELLITES.find((item) => item.id === "eo-atlas-600")!;
const CAMERA_DISTANCE_PX = 720;
const ATTITUDE_SLEW_MS = 84;

export interface OrbitSatellite3DPose {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelSize: number;
  visible: boolean;
  bodyXAxis: Vector3;
  bodyYAxis: Vector3;
  bodyZAxis: Vector3;
  payloadBoresightBody: Vector3;
  sunDirection: Vector3;
  sunlightFactor: number;
}

export interface OrbitSatellite3DHandle {
  updatePose: (pose: OrbitSatellite3DPose) => void;
}

function toThree(vector: Vector3) {
  return new THREE.Vector3(vector[0], vector[1], vector[2]);
}

function properBodyBasis(xInput: Vector3, yInput: Vector3, zInput: Vector3) {
  const x = toThree(xInput).normalize();
  const yRaw = toThree(yInput);
  const y = yRaw.addScaledVector(x, -yRaw.dot(x));
  if (y.lengthSq() < 1e-10) y.crossVectors(toThree(zInput), x);
  y.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z);
}

const OrbitSatellite3DOverlay = forwardRef<OrbitSatellite3DHandle, {
  satellite?: SatelliteInventoryItem;
  mission: MissionConfig;
  panelNormalBody: Vector3;
}>(function OrbitSatellite3DOverlay({ satellite = ATLAS, mission, panelNormalBody }, forwardedRef) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const anchorRef = useRef<THREE.Group | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const modelSpanRef = useRef(1);
  const lastPoseRef = useRef<OrbitSatellite3DPose | null>(null);
  const attitudeAnimationRef = useRef<number | null>(null);
  const [panelNormalX, panelNormalY, panelNormalZ] = panelNormalBody;

  const visualAtlas = useMemo<SatelliteInventoryItem>(() => ({
    ...structuredClone(satellite),
    frames: {
      ...satellite.frames,
      velocityAxis: mission.velocityBodyAxis,
      nadirAxis: mission.nadirBodyAxis,
      solarCellNormalAxis: mission.panelFacingAxis,
    },
    array: {
      ...satellite.array,
      wingLayout: mission.wingLayout === "DUAL" ? "dual" : "single",
    },
  }), [mission.nadirBodyAxis, mission.panelFacingAxis, mission.velocityBodyAxis, mission.wingLayout, satellite]);

  const renderScene = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (renderer && scene && camera) renderer.render(scene, camera);
  }, []);

  const applyPose = useCallback((pose: OrbitSatellite3DPose) => {
    // Pose updates can arrive before WebGL or a newly selected model is ready.
    // Retaining the latest pose prevents a stale/blank frame during rebuilds.
    const previousPose = lastPoseRef.current;
    lastPoseRef.current = pose;
    const anchor = anchorRef.current;
    const model = modelRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!anchor || !camera || !renderer) return;
      const width = Math.max(1, pose.width);
      const height = Math.max(1, pose.height);
      camera.aspect = width / height;
      // Calibrate the perspective frustum so one world unit at z=0 remains
      // approximately one screen pixel while real spacecraft depth stays visible.
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(height / (2 * CAMERA_DISTANCE_PX)));
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      anchor.visible = pose.visible;
      anchor.position.set(pose.x - width / 2, height / 2 - pose.y, 0);
      const basis = properBodyBasis(pose.bodyXAxis, pose.bodyYAxis, pose.bodyZAxis);
      const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(basis).normalize();
      const startQuaternion = anchor.quaternion.clone().normalize();
      const alignedTargetValues = shortestQuaternionTarget(
        startQuaternion.toArray() as QuaternionTuple,
        targetQuaternion.toArray() as QuaternionTuple,
      );
      const alignedTarget = new THREE.Quaternion(...alignedTargetValues).normalize();
      if (attitudeAnimationRef.current !== null) {
        cancelAnimationFrame(attitudeAnimationRef.current);
        attitudeAnimationRef.current = null;
      }
      const shouldSnap = !previousPose?.visible
        || !pose.visible
        || startQuaternion.angleTo(alignedTarget) < 1e-5
        || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (shouldSnap) {
        anchor.quaternion.copy(alignedTarget);
      } else {
        const startedAt = performance.now();
        const animateAttitude = (now: number) => {
          const progress = THREE.MathUtils.clamp((now - startedAt) / ATTITUDE_SLEW_MS, 0, 1);
          const eased = progress * progress * (3 - 2 * progress);
          anchor.quaternion.slerpQuaternions(startQuaternion, alignedTarget, eased);
          renderScene();
          if (progress < 1) attitudeAnimationRef.current = requestAnimationFrame(animateAttitude);
          else attitudeAnimationRef.current = null;
        };
        attitudeAnimationRef.current = requestAnimationFrame(animateAttitude);
      }
      const sunLight = sunLightRef.current;
      if (sunLight) {
        sunLight.target.position.copy(anchor.position);
        sunLight.position.copy(anchor.position).add(toThree(pose.sunDirection).normalize().multiplyScalar(100));
        sunLight.intensity = 0.35 + THREE.MathUtils.clamp(pose.sunlightFactor, 0, 1) * 3.45;
      }
      if (model) {
        setModelPayloadBoresight(model, pose.payloadBoresightBody);
        const desiredSpanPx = pose.pixelSize * 6.2;
        model.scale.setScalar(desiredSpanPx / Math.max(modelSpanRef.current, 0.1));
      }
      renderScene();
  }, [renderScene]);

  useImperativeHandle(forwardedRef, () => ({ updatePose: applyPose }), [applyPose]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 1, CAMERA_DISTANCE_PX * 4);
    camera.position.set(0, 0, CAMERA_DISTANCE_PX);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.45));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.14;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xc7e6f2, 0x07131a, 1.7));
    const sunLight = new THREE.DirectionalLight(0xffedc2, 3.8);
    sunLight.position.set(8, 7, 12);
    scene.add(sunLight);
    scene.add(sunLight.target);
    const rimLight = new THREE.DirectionalLight(0x4f9bd2, 2.1);
    rimLight.position.set(-7, -4, 8);
    scene.add(rimLight);
    const cameraFill = new THREE.DirectionalLight(0x9fc8dd, 1.25);
    cameraFill.position.set(0, 2, 18);
    scene.add(cameraFill);
    const anchor = new THREE.Group();
    anchor.visible = false;
    scene.add(anchor);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    anchorRef.current = anchor;
    sunLightRef.current = sunLight;
    if (lastPoseRef.current) applyPose(lastPoseRef.current);

    return () => {
      if (attitudeAnimationRef.current !== null) {
        cancelAnimationFrame(attitudeAnimationRef.current);
        attitudeAnimationRef.current = null;
      }
      disposeThreeTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      anchorRef.current = null;
      sunLightRef.current = null;
    };
  }, [applyPose]);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    if (modelRef.current) {
      anchor.remove(modelRef.current);
      disposeThreeTree(modelRef.current);
    }
    const model = buildInventorySatelliteModel(visualAtlas, 1, false, {
      solarNormalBody: [panelNormalX, panelNormalY, panelNormalZ],
    });
    modelSpanRef.current = visualAtlas.array.panelLengthM * (visualAtlas.array.wingLayout === "dual" ? 2 : 1)
      + Math.max(...Object.values(visualAtlas.geometry.dimensionsM));
    anchor.add(model);
    modelRef.current = model;
    if (lastPoseRef.current) applyPose(lastPoseRef.current);
    else renderScene();
    return () => {
      if (anchorRef.current && modelRef.current === model) {
        anchorRef.current.remove(model);
        disposeThreeTree(model);
        modelRef.current = null;
      }
    };
  }, [applyPose, panelNormalX, panelNormalY, panelNormalZ, renderScene, visualAtlas]);

  return <div ref={mountRef} className="orbit-satellite-3d-overlay" aria-label={`Actual three-dimensional ${satellite.name} model in orbit`} />;
});

export default OrbitSatellite3DOverlay;

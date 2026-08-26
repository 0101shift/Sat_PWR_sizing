"use client";

import Link from "next/link";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  BODY_AXES,
  DEFAULT_EO_SATELLITES,
  SATELLITE_INVENTORY_SCHEMA,
  activeArrayAreaM2,
  arrayConfigurationLabel,
  cloneInventory,
  isSatelliteInventoryItem,
  mergeSatelliteInventory,
  readSatelliteInventoryPayload,
  type BodyAxis,
  type SatelliteInventoryItem,
  type SatelliteSubsystem,
} from "../lib/satellite-inventory";
import {
  PART_CATEGORIES,
  SATELLITE_PART_CATALOG,
  createCustomSatelliteDraft,
  createSubsystemFromPart,
  customAssemblyTotals,
  validateSatelliteAssembly,
  type PartCategory,
} from "../lib/satellite-parts";
import { buildInventorySatelliteModel } from "../lib/satellite-three";
import type { Vector3 } from "../lib/orbit-model";
import styles from "./SatelliteInventory.module.css";

const STORAGE_KEY = "orbit-pwr-eo-inventory-v1";
const FLUENCE_OPTIONS = [0, 0.5, 2.5, 5, 10, 100] as const;

type ViewerHandle = { resetView: () => void };

export interface SatelliteEnvironmentContext {
  bodySun: Vector3;
  bodyVelocity: Vector3;
  bodyNadir: Vector3;
  shadowFactor: number;
  label: string;
}

type EnvironmentObjects = {
  earth: THREE.Mesh;
  atmosphere: THREE.Mesh;
  sun: THREE.Mesh;
  sunGlow: THREE.Mesh;
  velocityArrow: THREE.ArrowHelper;
  nadirArrow: THREE.ArrowHelper;
  sunArrow: THREE.ArrowHelper;
  sunLight: THREE.DirectionalLight;
};

function axisVector(axis: BodyAxis) {
  const sign = axis.startsWith("-") ? -1 : 1;
  if (axis.endsWith("X")) return new THREE.Vector3(sign, 0, 0);
  if (axis.endsWith("Y")) return new THREE.Vector3(0, sign, 0);
  return new THREE.Vector3(0, 0, sign);
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

function addPanelGrid(panel: THREE.Mesh, width: number, height: number) {
  const gridMaterial = new THREE.LineBasicMaterial({ color: 0x62a7c8, transparent: true, opacity: 0.55 });
  const points: THREE.Vector3[] = [];
  for (let index = 1; index < 4; index += 1) {
    const x = -width / 2 + (index * width) / 4;
    points.push(new THREE.Vector3(x, -height / 2, 0.031), new THREE.Vector3(x, height / 2, 0.031));
  }
  for (let index = 1; index < 4; index += 1) {
    const y = -height / 2 + (index * height) / 4;
    points.push(new THREE.Vector3(-width / 2, y, 0.031), new THREE.Vector3(width / 2, y, 0.031));
  }
  panel.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), gridMaterial));
}

function buildSatelliteModel(item: SatelliteInventoryItem, deployment: number, showAxes: boolean) {
  const root = new THREE.Group();
  root.name = "spacecraft";
  const { x, y, z } = item.geometry.dimensionsM;
  const longestBusSide = Math.max(x, y, z);
  const busMaterial = new THREE.MeshStandardMaterial({ color: 0xb8c4c4, metalness: 0.7, roughness: 0.28 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x172329, metalness: 0.55, roughness: 0.38 });
  const goldMaterial = new THREE.MeshStandardMaterial({ color: 0xa4772a, metalness: 0.55, roughness: 0.42 });
  const bus = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), busMaterial);
  bus.castShadow = true;
  bus.receiveShadow = true;
  root.add(bus);

  const equipmentScale = Math.max(longestBusSide * 0.035, 0.025);
  const cornerPositions = [
    [-x * 0.34, y * 0.51, -z * 0.28],
    [x * 0.34, y * 0.51, -z * 0.28],
    [-x * 0.34, y * 0.51, z * 0.28],
    [x * 0.34, y * 0.51, z * 0.28],
  ];
  cornerPositions.forEach(([px, py, pz]) => {
    const unit = new THREE.Mesh(
      new THREE.BoxGeometry(equipmentScale * 2.4, equipmentScale, equipmentScale * 2.4),
      darkMaterial,
    );
    unit.position.set(px, py, pz);
    root.add(unit);
  });

  const apertureRadius = Math.min(item.geometry.payloadApertureM / 2, x * 0.34, y * 0.34);
  const payload = new THREE.Mesh(
    new THREE.CylinderGeometry(apertureRadius, apertureRadius * 1.22, Math.max(z * 0.18, 0.06), 32),
    darkMaterial,
  );
  payload.rotation.x = Math.PI / 2;
  payload.position.z = -z / 2 - Math.max(z * 0.09, 0.03);
  root.add(payload);
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(apertureRadius * 0.8, 32),
    new THREE.MeshStandardMaterial({ color: 0x275c78, metalness: 0.15, roughness: 0.12 }),
  );
  lens.position.z = -z / 2 - Math.max(z * 0.18, 0.06) - 0.002;
  lens.rotation.y = Math.PI;
  root.add(lens);

  if (item.className !== "CubeSat") {
    const radiator = new THREE.Mesh(new THREE.BoxGeometry(x * 0.58, 0.012, z * 0.48), goldMaterial);
    radiator.position.y = -y / 2 - 0.008;
    root.add(radiator);
  }

  const arrayMount = new THREE.Group();
  arrayMount.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisVector(item.frames.solarCellNormalAxis));
  const wingCount = item.array.wingLayout === "dual" ? 2 : 1;
  const panelGap = item.array.panelLengthM * 0.018;
  const segmentLength =
    (item.array.panelLengthM - panelGap * (item.array.panelsPerWing - 1)) / item.array.panelsPerWing;
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0x153f68,
    emissive: 0x061526,
    metalness: 0.48,
    roughness: 0.3,
    side: THREE.DoubleSide,
  });
  const localDeploymentAxis = axisVector(item.array.deploymentAxis)
    .applyQuaternion(arrayMount.quaternion.clone().invert())
    .normalize();
  const signs = wingCount === 2 ? [-1, 1] : [1];
  signs.forEach((sign) => {
    const pivot = new THREE.Group();
    pivot.position.x = sign * (x / 2 + 0.015);
    pivot.setRotationFromAxisAngle(
      localDeploymentAxis,
      sign * (1 - deployment) * THREE.MathUtils.degToRad(item.array.deployedAngleDeg),
    );
    for (let panelIndex = 0; panelIndex < item.array.panelsPerWing; panelIndex += 1) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(segmentLength, item.array.panelWidthM, Math.max(longestBusSide * 0.018, 0.012)),
        panelMaterial,
      );
      panel.position.x = sign * (segmentLength / 2 + panelIndex * (segmentLength + panelGap));
      panel.castShadow = true;
      addPanelGrid(panel, segmentLength, item.array.panelWidthM);
      pivot.add(panel);
    }
    const boom = new THREE.Mesh(
      new THREE.CylinderGeometry(equipmentScale * 0.18, equipmentScale * 0.18, item.array.panelLengthM, 12),
      darkMaterial,
    );
    boom.rotation.z = Math.PI / 2;
    boom.position.x = sign * item.array.panelLengthM / 2;
    boom.position.y = -item.array.panelWidthM * 0.54;
    pivot.add(boom);
    arrayMount.add(pivot);
  });
  root.add(arrayMount);

  if (showAxes) {
    const arrowLength = Math.max(longestBusSide, item.array.panelWidthM) * 0.9;
    root.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), arrowLength, 0xff4d5a));
    root.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), arrowLength, 0x35e68a));
    root.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), arrowLength, 0x4285ff));
    root.add(
      new THREE.ArrowHelper(
        axisVector(item.frames.velocityAxis),
        new THREE.Vector3(0, arrowLength * 0.035, 0),
        arrowLength * 1.45,
        0x00e5ff,
        arrowLength * 0.15,
        arrowLength * 0.08,
      ),
    );
    root.add(
      new THREE.ArrowHelper(
        axisVector(item.frames.nadirAxis),
        new THREE.Vector3(arrowLength * 0.035, 0, 0),
        arrowLength * 1.4,
        0xb15cff,
        arrowLength * 0.15,
        arrowLength * 0.08,
      ),
    );
    root.add(
      new THREE.ArrowHelper(
        axisVector(item.frames.payloadBoresightAxis),
        new THREE.Vector3(-arrowLength * 0.035, 0, 0),
        arrowLength * 1.6,
        0xff8a34,
        arrowLength * 0.15,
        arrowLength * 0.08,
      ),
    );
    root.add(
      new THREE.ArrowHelper(
        axisVector(item.frames.solarCellNormalAxis),
        new THREE.Vector3(0, -arrowLength * 0.035, 0),
        arrowLength * 1.8,
        0xffd43b,
        arrowLength * 0.16,
        arrowLength * 0.09,
      ),
    );
  }
  return root;
}

const SatelliteViewer = forwardRef<ViewerHandle, {
  item: SatelliteInventoryItem;
  deployment: number;
  showAxes: boolean;
  environmentContext?: SatelliteEnvironmentContext;
}>(({ item, deployment, showAxes, environmentContext }, ref) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const environmentRef = useRef<EnvironmentObjects | null>(null);
  const earthTextureRef = useRef<THREE.Texture | null>(null);
  const fittedItemIdRef = useRef<string | null>(null);

  const fitView = (preserveDirection: boolean) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const bus = Math.max(...Object.values(item.geometry.dimensionsM));
    const span = item.array.panelLengthM * (item.array.wingLayout === "dual" ? 2.2 : 1.35) + bus;
    const distance = Math.max(span * 1.28, bus * 4.2, 1.8);
    const direction = preserveDirection
      ? camera.position.clone().sub(controls.target).normalize()
      : new THREE.Vector3(0.72, 0.48, 0.88).normalize();
    if (!Number.isFinite(direction.x) || direction.lengthSq() < 0.5) direction.set(0.72, 0.48, 0.88).normalize();
    camera.position.copy(controls.target).add(direction.multiplyScalar(distance));
    camera.near = Math.max(distance / 1000, 0.001);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
  };

  const resetView = () => fitView(false);

  useImperativeHandle(ref, () => ({ resetView }));

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04090d);
    scene.fog = new THREE.FogExp2(0x04090d, 0.018);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = true;
    controls.minDistance = 0.2;
    controls.maxDistance = 150;

    scene.add(new THREE.HemisphereLight(0x8fbfe5, 0x101820, 1.65));
    const keyLight = new THREE.DirectionalLight(0xfff2d4, 3.2);
    keyLight.position.set(-5, 6, 8);
    keyLight.castShadow = true;
    scene.add(keyLight);
    scene.add(keyLight.target);
    const rimLight = new THREE.DirectionalLight(0x4ba8d8, 1.2);
    rimLight.position.set(6, -3, -4);
    scene.add(rimLight);

    const environmentGroup = new THREE.Group();
    environmentGroup.name = "mission-environment";
    const earthTexture = new THREE.TextureLoader().load("/earth-blue-marble.png");
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    earthTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    earthTextureRef.current = earthTexture;
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 40),
      new THREE.MeshStandardMaterial({ map: earthTexture, color: 0x8fc5e2, roughness: 0.92, metalness: 0 }),
    );
    earth.name = "mission-earth";
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.035, 64, 40),
      new THREE.MeshBasicMaterial({ color: 0x58aee0, transparent: true, opacity: 0.17, side: THREE.BackSide, depthWrite: false }),
    );
    atmosphere.name = "mission-atmosphere";
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd16a }),
    );
    sun.name = "mission-sun";
    const sunGlow = new THREE.Mesh(
      new THREE.SphereGeometry(1.65, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0xffbd4a, transparent: true, opacity: 0.11, depthWrite: false }),
    );
    sunGlow.name = "mission-sun-glow";
    const velocityArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x00e5ff, 0.15, 0.08);
    const nadirArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1, 0xb15cff, 0.15, 0.08);
    const sunArrow = new THREE.ArrowHelper(new THREE.Vector3(0.5, 0.5, 0.5).normalize(), new THREE.Vector3(), 1, 0xfff0a8, 0.15, 0.08);
    velocityArrow.name = "mission-velocity-vector";
    nadirArrow.name = "mission-nadir-vector";
    sunArrow.name = "mission-sun-vector";
    environmentGroup.add(earth, atmosphere, sun, sunGlow, velocityArrow, nadirArrow, sunArrow);
    scene.add(environmentGroup);
    environmentRef.current = { earth, atmosphere, sun, sunGlow, velocityArrow, nadirArrow, sunArrow, sunLight: keyLight };

    const stars: number[] = [];
    for (let index = 0; index < 500; index += 1) {
      const theta = index * 2.399963;
      const phi = Math.acos(1 - (2 * (index + 0.5)) / 500);
      const radius = 55 + (index % 13);
      stars.push(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      );
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(stars, 3));
    scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xaac7d5, size: 0.075 })));

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    let frameId = 0;
    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      controls.dispose();
      disposeTree(scene);
      earthTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      environmentRef.current = null;
      earthTextureRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (modelRef.current) {
      scene.remove(modelRef.current);
      disposeTree(modelRef.current);
    }
    const useAssemblyRenderer = item.id.startsWith("custom-build-") || item.subsystems?.some((subsystem) => Boolean(subsystem.catalogPartId));
    const model = useAssemblyRenderer
      ? buildInventorySatelliteModel(item, deployment, showAxes)
      : buildSatelliteModel(item, deployment, showAxes);
    modelRef.current = model;
    scene.add(model);
    return () => {
      if (sceneRef.current && modelRef.current === model) {
        sceneRef.current.remove(model);
        disposeTree(model);
        modelRef.current = null;
      }
    };
  }, [item, deployment, showAxes]);

  useEffect(() => {
    const objects = environmentRef.current;
    if (!objects) return;
    const normalizedDirection = (vector: Vector3 | undefined, fallback: THREE.Vector3) => {
      if (!vector) return fallback.clone().normalize();
      const direction = new THREE.Vector3(vector[0], vector[1], vector[2]);
      return direction.lengthSq() > 1e-10 ? direction.normalize() : fallback.clone().normalize();
    };
    const velocityDirection = normalizedDirection(environmentContext?.bodyVelocity, axisVector(item.frames.velocityAxis));
    const nadirDirection = normalizedDirection(environmentContext?.bodyNadir, axisVector(item.frames.nadirAxis));
    const sunDirection = normalizedDirection(environmentContext?.bodySun, new THREE.Vector3(0.62, 0.46, 0.63));
    const busSpan = Math.max(...Object.values(item.geometry.dimensionsM));
    const arraySpan = item.array.panelLengthM * (item.array.wingLayout === "dual" ? 2.2 : 1.35) + busSpan;
    const contextSpan = Math.max(arraySpan, busSpan * 2, 0.6);

    objects.earth.position.copy(nadirDirection).multiplyScalar(contextSpan * 2.75);
    objects.atmosphere.position.copy(objects.earth.position);
    objects.earth.scale.setScalar(contextSpan * 1.5);
    objects.atmosphere.scale.copy(objects.earth.scale);

    objects.sun.position.copy(sunDirection).multiplyScalar(contextSpan * 3.35);
    objects.sunGlow.position.copy(objects.sun.position);
    objects.sun.scale.setScalar(contextSpan * 0.16);
    objects.sunGlow.scale.copy(objects.sun.scale);

    const arrowLength = contextSpan * 1.55;
    const arrowHeadLength = contextSpan * 0.15;
    const arrowHeadWidth = contextSpan * 0.075;
    objects.velocityArrow.setDirection(velocityDirection);
    objects.velocityArrow.setLength(arrowLength, arrowHeadLength, arrowHeadWidth);
    objects.nadirArrow.setDirection(nadirDirection);
    objects.nadirArrow.setLength(arrowLength, arrowHeadLength, arrowHeadWidth);
    objects.sunArrow.setDirection(sunDirection);
    objects.sunArrow.setLength(arrowLength * 1.08, arrowHeadLength, arrowHeadWidth);
    objects.velocityArrow.visible = showAxes;
    objects.nadirArrow.visible = showAxes;
    objects.sunArrow.visible = showAxes;

    objects.sunLight.position.copy(sunDirection).multiplyScalar(contextSpan * 3.5);
    objects.sunLight.target.position.set(0, 0, 0);
    objects.sunLight.intensity = 1.1 + Math.max(0, Math.min(1, environmentContext?.shadowFactor ?? 1)) * 3.1;
  }, [environmentContext, item.array.panelLengthM, item.array.wingLayout, item.frames.nadirAxis, item.frames.velocityAxis, item.geometry.dimensionsM, showAxes]);

  useEffect(() => {
    fitView(fittedItemIdRef.current === item.id);
    fittedItemIdRef.current = item.id;
    // Refit while preserving the viewing direction whenever visible dimensions change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    item.id,
    item.geometry.dimensionsM.x,
    item.geometry.dimensionsM.y,
    item.geometry.dimensionsM.z,
    item.array.wingLayout,
    item.array.panelsPerWing,
    item.array.panelLengthM,
    item.array.panelWidthM,
  ]);

  return <div className={styles.viewerMount} ref={mountRef} aria-label={`Interactive 3D view of ${item.name}`} />;
});
SatelliteViewer.displayName = "SatelliteViewer";

function NumericField({
  label,
  value,
  step = 1,
  min,
  max,
  unit,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <span className={styles.inputWrap}>
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {unit && <small>{unit}</small>}
      </span>
    </label>
  );
}

function CustomFlightConfiguration({
  item,
  onUpdate,
}: {
  item: SatelliteInventoryItem;
  onUpdate: (mutate: (draft: SatelliteInventoryItem) => void) => void;
}) {
  const updateSolarNormal = (axis: BodyAxis) => onUpdate((draft) => {
    draft.frames.solarCellNormalAxis = axis;
    const solarArray = draft.subsystems?.find((part) => part.kind === "solar_array" && part.attached);
    if (solarArray) solarArray.functionalAxis = axis;
  });

  return <>
    <section className={styles.formSection}>
      <div className={styles.formSectionTitle}><h3>Body-frame assignments</h3><span>EDITABLE HERE</span></div>
      <div className={styles.fieldGrid2}>
        {([[
          "Velocity", "velocityAxis",
        ], [
          "Nadir", "nadirAxis",
        ], [
          "Payload boresight", "payloadBoresightAxis",
        ]] as const).map(([label, key]) => (
          <label className={styles.field} key={key}><span>{label}</span><select value={item.frames[key]} onChange={(event) => onUpdate((draft) => { draft.frames[key] = event.target.value as BodyAxis; })}>{BODY_AXES.map((axis) => <option key={axis}>{axis}</option>)}</select></label>
        ))}
        <label className={styles.field}><span>Solar-panel facing axis</span><select value={item.frames.solarCellNormalAxis} onChange={(event) => updateSolarNormal(event.target.value as BodyAxis)}>{BODY_AXES.map((axis) => <option key={axis}>{axis}</option>)}</select></label>
      </div>
      <label className={styles.field}><span>Attitude mode</span><select value={item.missionDefaults.attitudeMode} onChange={(event) => onUpdate((draft) => { draft.missionDefaults.attitudeMode = event.target.value as SatelliteInventoryItem["missionDefaults"]["attitudeMode"]; })}><option>Nadir pointing</option><option>Sun pointing</option><option>Mission profile / DIL</option></select></label>
    </section>

    <section className={styles.formSection}>
      <div className={styles.formSectionTitle}><h3>Solar-array rig</h3><span>EDITABLE HERE</span></div>
      <div className={styles.fieldGrid2}>
        <label className={styles.field}><span>Panel sides</span><select value={item.array.wingLayout} onChange={(event) => onUpdate((draft) => { draft.array.wingLayout = event.target.value as "single" | "dual"; })}><option value="single">Single side</option><option value="dual">Dual side</option></select></label>
        <NumericField label="Panels / side" value={item.array.panelsPerWing} min={1} max={8} onChange={(value) => onUpdate((draft) => { draft.array.panelsPerWing = Math.round(value); })} />
        <NumericField label="Wing length" value={item.array.panelLengthM} min={0.05} step={0.05} unit="m" onChange={(value) => onUpdate((draft) => { draft.array.panelLengthM = value; })} />
        <NumericField label="Wing width" value={item.array.panelWidthM} min={0.05} step={0.05} unit="m" onChange={(value) => onUpdate((draft) => { draft.array.panelWidthM = value; })} />
        <label className={styles.field}><span>Deployment axis</span><select value={item.array.deploymentAxis} onChange={(event) => onUpdate((draft) => { draft.array.deploymentAxis = event.target.value as BodyAxis; })}>{BODY_AXES.map((axis) => <option key={axis}>{axis}</option>)}</select></label>
        <NumericField label="Deployed angle" value={item.array.deployedAngleDeg} min={0} max={180} unit="°" onChange={(value) => onUpdate((draft) => { draft.array.deployedAngleDeg = value; })} />
      </div>
    </section>

    <section className={styles.formSection}>
      <div className={styles.formSectionTitle}><h3>Solar power defaults</h3><span>EDITABLE HERE</span></div>
      <label className={styles.field}><span>Cell model</span><select value={item.array.cellModel} onChange={(event) => onUpdate((draft) => { draft.array.cellModel = event.target.value as SatelliteInventoryItem["array"]["cellModel"]; })}><option>AZUR 3G30-Advanced 4x8</option><option>AZUR 4G32-Advanced 4x8</option></select></label>
      <div className={styles.fieldGrid2}>
        <NumericField label="Series cells" value={item.array.seriesCells} min={1} onChange={(value) => onUpdate((draft) => { draft.array.seriesCells = Math.round(value); })} />
        <NumericField label="Parallel strings" value={item.array.parallelStrings} min={1} onChange={(value) => onUpdate((draft) => { draft.array.parallelStrings = Math.round(value); })} />
        <NumericField label="Packaging efficiency" value={item.array.packagingEfficiency * 100} min={1} max={100} step={0.1} unit="%" onChange={(value) => onUpdate((draft) => { draft.array.packagingEfficiency = value / 100; })} />
        <NumericField label="Operating temperature" value={item.array.operatingTemperatureC} min={-150} max={200} unit="°C" onChange={(value) => onUpdate((draft) => { draft.array.operatingTemperatureC = value; })} />
        <NumericField label="MPPT efficiency" value={item.powerDefaults.mpptEfficiency * 100} min={1} max={100} step={0.1} unit="%" onChange={(value) => onUpdate((draft) => { draft.powerDefaults.mpptEfficiency = value / 100; })} />
        <NumericField label="Harness efficiency" value={(item.powerDefaults.harnessEfficiency ?? 1) * 100} min={1} max={100} step={0.1} unit="%" onChange={(value) => onUpdate((draft) => { draft.powerDefaults.harnessEfficiency = value / 100; })} />
      </div>
      <label className={styles.field}><span>EOL fluence data point</span><select value={item.powerDefaults.fluenceE14Cm2 ?? 5} onChange={(event) => onUpdate((draft) => { draft.powerDefaults.fluenceE14Cm2 = Number(event.target.value); })}>{FLUENCE_OPTIONS.map((fluence) => <option key={fluence} value={fluence}>{fluence === 0 ? "BOL / 0" : `${fluence} × 10¹⁴ cm⁻²`}</option>)}</select></label>
      <div className={styles.fieldGrid2}>
        <NumericField label="AM0 irradiance @ 1 AU" value={item.powerDefaults.referenceIrradianceWm2 ?? 1367} min={1000} max={1500} unit="W/m²" onChange={(value) => onUpdate((draft) => { draft.powerDefaults.referenceIrradianceWm2 = value; })} />
        <NumericField label="Cell reference temperature" value={item.powerDefaults.referenceTemperatureC ?? 28} min={-150} max={150} unit="°C" onChange={(value) => onUpdate((draft) => { draft.powerDefaults.referenceTemperatureC = value; })} />
        <NumericField label="Pmp temperature coefficient" value={item.powerDefaults.powerTempCoefficientPctC ?? -0.08} min={-2} max={0.5} step={0.01} unit="%/°C" onChange={(value) => onUpdate((draft) => { draft.powerDefaults.powerTempCoefficientPctC = value; })} />
        <NumericField label="Pointing uncertainty" value={item.powerDefaults.pointingErrorDeg ?? 0} min={0} max={45} step={0.1} unit="°" onChange={(value) => onUpdate((draft) => { draft.powerDefaults.pointingErrorDeg = value; })} />
        <NumericField label="Angular-response exponent" value={item.powerDefaults.angularResponseExponent ?? 1} min={0.25} max={4} step={0.05} onChange={(value) => onUpdate((draft) => { draft.powerDefaults.angularResponseExponent = value; })} />
        <NumericField label="Mismatch loss" value={item.powerDefaults.mismatchLossPct ?? 0} min={0} max={50} step={0.1} unit="%" onChange={(value) => onUpdate((draft) => { draft.powerDefaults.mismatchLossPct = value; })} />
        <NumericField label="Blocking-diode loss" value={item.powerDefaults.diodeLossPct ?? 0} min={0} max={30} step={0.1} unit="%" onChange={(value) => onUpdate((draft) => { draft.powerDefaults.diodeLossPct = value; })} />
        <NumericField label="Contamination loss" value={item.powerDefaults.contaminationLossPct ?? 0} min={0} max={50} step={0.1} unit="%" onChange={(value) => onUpdate((draft) => { draft.powerDefaults.contaminationLossPct = value; })} />
        <NumericField label="Self-shadowed area" value={item.powerDefaults.selfShadowLossPct ?? 0} min={0} max={90} step={0.5} unit="%" onChange={(value) => onUpdate((draft) => { draft.powerDefaults.selfShadowLossPct = value; })} />
        <NumericField label="Other system loss" value={item.powerDefaults.systemLossPct ?? 12} min={0} max={60} step={0.5} unit="%" onChange={(value) => onUpdate((draft) => { draft.powerDefaults.systemLossPct = value; })} />
      </div>
    </section>
  </>;
}

function ReadOnlyFlightConfiguration({ item }: { item: SatelliteInventoryItem }) {
  const rows: Array<[string, string]> = [
    ["Cell model", item.array.cellModel],
    ["String configuration", `${item.array.seriesCells}S × ${item.array.parallelStrings}P`],
    ["Packaging efficiency", `${(item.array.packagingEfficiency * 100).toFixed(1)}%`],
    ["Operating temperature", `${item.array.operatingTemperatureC} °C`],
    ["EOL fluence data point", `${item.powerDefaults.fluenceE14Cm2 ?? 5} × 10¹⁴ cm⁻²`],
    ["AM0 irradiance @ 1 AU", `${item.powerDefaults.referenceIrradianceWm2 ?? 1367} W/m²`],
    ["Cell reference temperature", `${item.powerDefaults.referenceTemperatureC ?? 28} °C`],
    ["Pmp temperature coefficient", `${item.powerDefaults.powerTempCoefficientPctC ?? -0.08} %/°C`],
    ["Pointing uncertainty", `${item.powerDefaults.pointingErrorDeg ?? 0}°`],
    ["Angular-response exponent", String(item.powerDefaults.angularResponseExponent ?? 1)],
    ["MPPT efficiency", `${((item.powerDefaults.mpptEfficiency ?? 1) * 100).toFixed(1)}%`],
    ["Harness efficiency", `${((item.powerDefaults.harnessEfficiency ?? 1) * 100).toFixed(1)}%`],
    ["Mismatch loss", `${item.powerDefaults.mismatchLossPct ?? 0}%`],
    ["Blocking-diode loss", `${item.powerDefaults.diodeLossPct ?? 0}%`],
    ["Contamination loss", `${item.powerDefaults.contaminationLossPct ?? 0}%`],
    ["Self-shadowed area", `${item.powerDefaults.selfShadowLossPct ?? 0}%`],
    ["Other system loss", `${item.powerDefaults.systemLossPct ?? 12}%`],
  ];
  return <>
    <section className={styles.formSection}>
      <div className={styles.formSectionTitle}><h3>Body-frame assignments</h3><span className={styles.readOnlyTag}>READ ONLY</span></div>
      <div className={styles.readOnlyGrid}>
        <div><span>Velocity</span><b>{item.frames.velocityAxis}</b></div>
        <div><span>Nadir</span><b>{item.frames.nadirAxis}</b></div>
        <div><span>Payload boresight</span><b>{item.frames.payloadBoresightAxis}</b></div>
        <div><span>Panel facing</span><b>{item.frames.solarCellNormalAxis}</b></div>
        <div className={styles.readOnlyWide}><span>Attitude mode</span><b>{item.missionDefaults.attitudeMode}</b></div>
      </div>
    </section>
    <section className={styles.formSection}>
      <div className={styles.formSectionTitle}><h3>Solar-array rig</h3><span className={styles.readOnlyTag}>READ ONLY</span></div>
      <div className={styles.readOnlyGrid}>
        <div><span>Panel sides</span><b>{item.array.wingLayout === "dual" ? "Dual side" : "Single side"}</b></div>
        <div><span>Panels / side</span><b>{item.array.panelsPerWing}</b></div>
        <div><span>Wing length</span><b>{item.array.panelLengthM} m</b></div>
        <div><span>Wing width</span><b>{item.array.panelWidthM} m</b></div>
        <div><span>Deployment axis</span><b>{item.array.deploymentAxis}</b></div>
        <div><span>Deployed angle</span><b>{item.array.deployedAngleDeg}°</b></div>
      </div>
    </section>
    <section className={styles.formSection}>
      <div className={styles.formSectionTitle}><h3>Solar power defaults</h3><span className={styles.readOnlyTag}>READ ONLY</span></div>
      <div className={styles.readOnlyGrid}>{rows.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
      <p className={styles.readOnlyNote}>Edit these engineering assignments in Custom Build, then save and redeploy the spacecraft.</p>
    </section>
  </>;
}

function CustomBuildWorkspace({
  draft,
  setDraft,
  deployment,
  setDeployment,
  isPlaying,
  onReplayDeployment,
  showAxes,
  setShowAxes,
  environmentContext,
  notice,
  setNotice,
  onSave,
  onDeploy,
}: {
  draft: SatelliteInventoryItem;
  setDraft: Dispatch<SetStateAction<SatelliteInventoryItem>>;
  deployment: number;
  setDeployment: Dispatch<SetStateAction<number>>;
  isPlaying: boolean;
  onReplayDeployment: () => void;
  showAxes: boolean;
  setShowAxes: Dispatch<SetStateAction<boolean>>;
  environmentContext?: SatelliteEnvironmentContext;
  notice: string;
  setNotice: Dispatch<SetStateAction<string>>;
  onSave: (item: SatelliteInventoryItem) => void;
  onDeploy?: (item: SatelliteInventoryItem) => void;
}) {
  const [category, setCategory] = useState<PartCategory>("Structures");
  const [catalogPartId, setCatalogPartId] = useState(SATELLITE_PART_CATALOG[0].id);
  const [mountAxis, setMountAxis] = useState<BodyAxis>(SATELLITE_PART_CATALOG[0].defaultMountAxis);
  const [selectedSubsystemId, setSelectedSubsystemId] = useState<string | null>(null);
  const viewerRef = useRef<ViewerHandle>(null);
  const visibleParts = SATELLITE_PART_CATALOG.filter((part) => part.category === category);
  const catalogPart = SATELLITE_PART_CATALOG.find((part) => part.id === catalogPartId) ?? visibleParts[0];
  const selectedSubsystem = draft.subsystems?.find((part) => part.id === selectedSubsystemId);
  const totals = useMemo(() => customAssemblyTotals(draft), [draft]);
  const issues = useMemo(() => validateSatelliteAssembly(draft), [draft]);
  const errorCount = issues.filter((issue) => issue.severity === "error").length;

  const updateDraft = (mutate: (next: SatelliteInventoryItem) => void) => {
    setDraft((current) => {
      const next = structuredClone(current);
      mutate(next);
      return next;
    });
  };

  const chooseCategory = (nextCategory: PartCategory) => {
    const firstPart = SATELLITE_PART_CATALOG.find((part) => part.category === nextCategory)!;
    setCategory(nextCategory);
    setCatalogPartId(firstPart.id);
    setMountAxis(firstPart.defaultMountAxis);
    setSelectedSubsystemId(null);
  };

  const chooseCatalogPart = (partId: string) => {
    const part = SATELLITE_PART_CATALOG.find((candidate) => candidate.id === partId);
    if (!part) return;
    setCatalogPartId(part.id);
    setMountAxis(part.defaultMountAxis);
    setSelectedSubsystemId(null);
  };

  const placePart = () => {
    if (!catalogPart) return;
    if (catalogPart.structurePreset) {
      updateDraft((next) => {
        next.className = catalogPart.structurePreset!.className;
        next.geometry.dimensionsM = { ...catalogPart.structurePreset!.dimensionsM };
        next.geometry.massKg = catalogPart.structurePreset!.massKg;
      });
      setNotice(`${catalogPart.name} is now the active spacecraft structure`);
      return;
    }
    const subsystem = createSubsystemFromPart(catalogPart, mountAxis, (draft.subsystems?.length ?? 0) + 1);
    updateDraft((next) => {
      if (subsystem.kind === "solar_array") {
        next.subsystems = (next.subsystems ?? []).filter((part) => part.kind !== "solar_array");
        Object.assign(next.array, catalogPart.arrayPreset ?? {});
        subsystem.functionalAxis = catalogPart.functionalAxis ?? next.frames.solarCellNormalAxis;
        next.array.deploymentAxis = catalogPart.arrayPreset?.deploymentAxis ?? mountAxis;
        next.frames.solarCellNormalAxis = subsystem.functionalAxis;
      }
      if (subsystem.kind === "payload") {
        next.frames.payloadBoresightAxis = mountAxis;
        next.geometry.payloadApertureM = Math.min(subsystem.envelopeM.x, subsystem.envelopeM.y) * 0.7;
      }
      next.subsystems = [...(next.subsystems ?? []), subsystem];
    });
    setSelectedSubsystemId(subsystem.id);
    setDeployment(1);
    setNotice(`${catalogPart.name} placed on the ${mountAxis} face`);
  };

  const updateSubsystem = (mutate: (part: SatelliteSubsystem) => void) => {
    if (!selectedSubsystemId) return;
    updateDraft((next) => {
      const part = next.subsystems?.find((candidate) => candidate.id === selectedSubsystemId);
      if (!part) return;
      mutate(part);
      if (part.kind === "payload") next.frames.payloadBoresightAxis = part.functionalAxis ?? part.mountAxis;
      if (part.kind === "solar_array") {
        next.frames.solarCellNormalAxis = part.functionalAxis ?? part.mountAxis;
        next.array.deploymentAxis = part.mountAxis;
      }
    });
  };

  const removeSubsystem = () => {
    if (!selectedSubsystem) return;
    updateDraft((next) => {
      next.subsystems = (next.subsystems ?? []).filter((part) => part.id !== selectedSubsystem.id);
    });
    setSelectedSubsystemId(null);
    setNotice(`${selectedSubsystem.name} removed from the assembly`);
  };

  const newBuild = () => {
    setDraft(createCustomSatelliteDraft());
    setSelectedSubsystemId(null);
    setDeployment(1);
    setNotice("New custom assembly started");
  };

  const saveBuild = () => {
    if (errorCount > 0) {
      setNotice(`Resolve ${errorCount} assembly error${errorCount === 1 ? "" : "s"} before saving`);
      return;
    }
    onSave(draft);
  };

  const deployBuild = () => {
    if (errorCount > 0) {
      setNotice(`Resolve ${errorCount} assembly error${errorCount === 1 ? "" : "s"} before deployment`);
      return;
    }
    onDeploy?.(draft);
  };

  return (
    <section className={styles.customWorkspace}>
      <aside className={styles.partsRail}>
        <div className={styles.sectionTitle}>
          <div><small>MODULAR LIBRARY</small><h2>Spacecraft parts</h2></div>
          <span>{SATELLITE_PART_CATALOG.length}</span>
        </div>
        <p className={styles.railIntro}>Select a flight-function part, choose a body face, then place and fine-tune it in the assembly.</p>
        <nav className={styles.categoryTabs} aria-label="Part categories">
          {PART_CATEGORIES.map((partCategory) => (
            <button type="button" key={partCategory} className={category === partCategory ? styles.activeCategory : ""} onClick={() => chooseCategory(partCategory)}>{partCategory}</button>
          ))}
        </nav>
        <div className={styles.partList}>
          {visibleParts.map((part) => (
            <button type="button" key={part.id} className={`${styles.partCard} ${catalogPart?.id === part.id && !selectedSubsystem ? styles.selectedPart : ""}`} onClick={() => chooseCatalogPart(part.id)}>
              <i data-kind={part.kind} />
              <span><strong>{part.name}</strong><small>{part.massKg} kg · {part.nominalPowerW} W</small></span>
            </button>
          ))}
        </div>
        <div className={styles.builderHint}>
          <strong>PLACEMENT MODEL</strong>
          <p>Phase 2A uses face-constrained mounting with metric offsets and Euler rotation. Free mesh snapping and STEP connectors remain a later rigging layer.</p>
        </div>
      </aside>

      <section className={styles.builderCenter}>
        <div className={styles.viewerHeader}>
          <div><small>CUSTOM ASSEMBLY / LIVE 3D</small><h2>{draft.name}</h2></div>
          <div className={styles.viewerTools}>
            <button type="button" className={showAxes ? styles.activeTool : ""} onClick={() => setShowAxes((value) => !value)}>Axes &amp; vectors</button>
            <button type="button" onClick={() => viewerRef.current?.resetView()}>Fit / reset</button>
          </div>
        </div>
        <div className={`${styles.viewerFrame} ${styles.builderViewerFrame}`}>
          <SatelliteViewer ref={viewerRef} item={draft} deployment={deployment} showAxes={showAxes} environmentContext={environmentContext} />
          <div className={styles.builderBadge}><span>FACE MOUNTING</span><b>{selectedSubsystem ? `${selectedSubsystem.name} · ${selectedSubsystem.mountAxis}` : "Select a part from the library"}</b></div>
          <div className={styles.customAxisLegend}>
            <strong>BODY AXES</strong>
            <span><i className={styles.axisX} />+X</span><span><i className={styles.axisY} />+Y</span><span><i className={styles.axisZ} />+Z</span>
            <strong>ASSIGNED VECTORS</strong>
            <span><i className={styles.axisVelocity} />VELOCITY {draft.frames.velocityAxis}</span>
            <span><i className={styles.axisNadir} />NADIR {draft.frames.nadirAxis}</span>
            <span><i className={styles.axisPayload} />PAYLOAD {draft.frames.payloadBoresightAxis}</span>
            <span><i className={styles.axisSun} />PANEL FACING {draft.frames.solarCellNormalAxis}</span>
            <span><i className={styles.axisDeploy} />SOLAR DEPLOY {draft.array.deploymentAxis}</span>
          </div>
          <div className={styles.viewerReadout}><span>DRAG · ROTATE</span><span>WHEEL · ZOOM</span><span>RIGHT DRAG · PAN</span></div>
        </div>
        <div className={styles.assemblyStats}>
          <article><small>ASSEMBLED MASS</small><strong>{totals.massKg.toFixed(1)} kg</strong></article>
          <article><small>PARTS INSTALLED</small><strong>{totals.partCount}</strong></article>
          <article><small>NOMINAL LOAD</small><strong>{totals.nominalPowerW.toFixed(0)} W</strong></article>
          <article><small>VALIDATION</small><strong className={errorCount > 0 ? styles.validationError : styles.validationOk}>{errorCount > 0 ? `${errorCount} error${errorCount === 1 ? "" : "s"}` : "Ready"}</strong></article>
        </div>
        <div className={styles.assemblyTree}>
          <div className={styles.treeTitle}><span>ASSEMBLY HIERARCHY</span><button type="button" onClick={newBuild}>New build</button></div>
          <button type="button" className={styles.busNode} onClick={() => setSelectedSubsystemId(null)}><i />BUS · {draft.geometry.dimensionsM.x} × {draft.geometry.dimensionsM.y} × {draft.geometry.dimensionsM.z} m</button>
          <div className={styles.treeChildren}>
            {(draft.subsystems ?? []).length === 0 && <p>No subsystems installed yet.</p>}
            {(draft.subsystems ?? []).map((part) => (
              <button type="button" key={part.id} className={part.id === selectedSubsystemId ? styles.activeTreeNode : ""} onClick={() => setSelectedSubsystemId(part.id)}><i data-kind={part.kind} /><span>{part.name}</span><em>{part.mountAxis}</em></button>
            ))}
          </div>
        </div>
      </section>

      <aside className={styles.builderInspector}>
        <div className={styles.inspectorHead}>
          <div><small>{selectedSubsystem ? "INSTALLED COMPONENT" : "PLACEMENT STAGE"}</small><h2>{selectedSubsystem?.name ?? catalogPart?.name ?? "Part inspector"}</h2></div>
          <span className={styles.dirtyTag}>custom</span>
        </div>
        <div className={styles.inspectorScroll}>
          <section className={styles.formSection}>
            <h3>Spacecraft identity</h3>
            <label className={styles.field}><span>Build name</span><input value={draft.name} onChange={(event) => updateDraft((next) => { next.name = event.target.value; })} /></label>
            <div className={styles.fieldGrid2}>
              <label className={styles.field}><span>Family</span><input value={draft.family} onChange={(event) => updateDraft((next) => { next.family = event.target.value; })} /></label>
              <label className={styles.field}><span>Spacecraft class</span><select value={draft.className} onChange={(event) => updateDraft((next) => { next.className = event.target.value as SatelliteInventoryItem["className"]; })}><option>CubeSat</option><option>Microsatellite</option><option>Small satellite</option></select></label>
            </div>
            <label className={styles.field}><span>Description</span><textarea value={draft.description} rows={3} onChange={(event) => updateDraft((next) => { next.description = event.target.value; })} /></label>
            <label className={styles.field}><span>Intended use</span><textarea value={draft.intendedUse} rows={2} onChange={(event) => updateDraft((next) => { next.intendedUse = event.target.value; })} /></label>
          </section>

          <CustomFlightConfiguration item={draft} onUpdate={updateDraft} />

          {!selectedSubsystem && catalogPart && <section className={styles.formSection}>
            <div className={styles.partHero}><i data-kind={catalogPart.kind} /><div><strong>{catalogPart.name}</strong><p>{catalogPart.description}</p></div></div>
            {catalogPart.structurePreset ? (
              <button type="button" className={styles.placeButton} onClick={placePart}>Use this structure</button>
            ) : <>
              <h3>Choose mounting face</h3>
              <div className={styles.facePicker}>
                {catalogPart.allowedMountAxes.map((axis) => <button type="button" key={axis} className={mountAxis === axis ? styles.activeFace : ""} onClick={() => setMountAxis(axis)}>{axis}</button>)}
              </div>
              <dl className={styles.partMetrics}><div><dt>Envelope</dt><dd>{catalogPart.envelopeM.x} × {catalogPart.envelopeM.y} × {catalogPart.envelopeM.z} m</dd></div><div><dt>Function axis</dt><dd>{catalogPart.functionalAxis ? mountAxis : "Internal / none"}</dd></div></dl>
              <button type="button" className={styles.placeButton} onClick={placePart}>Place on {mountAxis} face</button>
            </>}
          </section>}

          {selectedSubsystem && <section className={styles.formSection}>
            <div className={styles.formSectionTitle}><h3>Mounting transform</h3><span>LIVE 3D</span></div>
            <label className={styles.field}><span>Body mounting face</span><select value={selectedSubsystem.mountAxis} onChange={(event) => updateSubsystem((part) => { part.mountAxis = event.target.value as BodyAxis; if (part.functionalAxis && part.kind !== "solar_array") part.functionalAxis = part.mountAxis; })}>{BODY_AXES.map((axis) => <option key={axis}>{axis}</option>)}</select></label>
            {selectedSubsystem.kind === "solar_array" && <div className={styles.solarAxisControls}>
              <label className={styles.field}><span>Panel sides</span><select value={draft.array.wingLayout} onChange={(event) => updateDraft((next) => { next.array.wingLayout = event.target.value as "single" | "dual"; })}><option value="single">Single side</option><option value="dual">Dual side</option></select></label>
              <label className={styles.field}><span>Deployment axis (wing extension)</span><select value={draft.array.deploymentAxis} onChange={(event) => updateDraft((next) => { next.array.deploymentAxis = event.target.value as BodyAxis; })}>{BODY_AXES.map((axis) => <option key={axis}>{axis}</option>)}</select></label>
              <label className={styles.field}><span>Solar-panel facing axis</span><select value={selectedSubsystem.functionalAxis ?? draft.frames.solarCellNormalAxis} onChange={(event) => updateSubsystem((part) => { part.functionalAxis = event.target.value as BodyAxis; })}>{BODY_AXES.map((axis) => <option key={axis}>{axis}</option>)}</select></label>
              <p>Deployment defines the deployed wing direction. Panel facing defines the active-cell normal and must be perpendicular to deployment.</p>
            </div>}
            <div className={styles.fieldGrid3}>
              <NumericField label="Face U" value={selectedSubsystem.faceOffsetM?.u ?? 0} step={0.01} unit="m" onChange={(value) => updateSubsystem((part) => { part.faceOffsetM = { ...(part.faceOffsetM ?? { u: 0, v: 0, normal: 0 }), u: value }; })} />
              <NumericField label="Face V" value={selectedSubsystem.faceOffsetM?.v ?? 0} step={0.01} unit="m" onChange={(value) => updateSubsystem((part) => { part.faceOffsetM = { ...(part.faceOffsetM ?? { u: 0, v: 0, normal: 0 }), v: value }; })} />
              <NumericField label="Stand-off" value={selectedSubsystem.faceOffsetM?.normal ?? 0} step={0.01} min={0} unit="m" onChange={(value) => updateSubsystem((part) => { part.faceOffsetM = { ...(part.faceOffsetM ?? { u: 0, v: 0, normal: 0 }), normal: value }; })} />
            </div>
            <div className={styles.fieldGrid3}>
              {(["x", "y", "z"] as const).map((axis) => <NumericField key={axis} label={`Rotate ${axis.toUpperCase()}`} value={selectedSubsystem.rotationDeg?.[axis] ?? 0} step={5} min={-180} max={180} unit="°" onChange={(value) => updateSubsystem((part) => { part.rotationDeg = { ...(part.rotationDeg ?? { x: 0, y: 0, z: 0 }), [axis]: value }; })} />)}
            </div>
            <label className={styles.field}><span>Component name</span><input value={selectedSubsystem.name} onChange={(event) => updateSubsystem((part) => { part.name = event.target.value; })} /></label>
            <button type="button" className={styles.removePartButton} onClick={removeSubsystem}>Detach component</button>
          </section>}

          <section className={styles.formSection}>
            <h3>Assembly validation</h3>
            <div className={styles.issueList}>
              {issues.length === 0 && <p className={styles.issueOk}>No placement conflicts detected.</p>}
              {issues.map((issue, index) => <button type="button" key={`${issue.message}-${index}`} data-severity={issue.severity} onClick={() => issue.subsystemId && setSelectedSubsystemId(issue.subsystemId)}><strong>{issue.severity}</strong><span>{issue.message}</span></button>)}
            </div>
          </section>
        </div>
        <footer className={`${styles.inspectorFooter} ${styles.builderFooter}`}>
          <p aria-live="polite">{notice}</p>
          <div>
            <button type="button" onClick={onReplayDeployment} disabled={isPlaying}>{isPlaying ? "Deploying…" : "Replay deployment"}</button>
            <button type="button" onClick={() => setDeployment((value) => value > 0.5 ? 0 : 1)}>Toggle arrays</button>
            <button type="button" className={styles.primaryButton} onClick={saveBuild}>Save build</button>
            {onDeploy && <button type="button" className={styles.useButton} onClick={deployBuild}>Deploy to orbit</button>}
          </div>
        </footer>
      </aside>
    </section>
  );
}

export default function SatelliteInventory({
  embedded = false,
  activeSimulationId,
  focusActiveRequest = 0,
  environmentContext,
  onUseInSimulator,
}: {
  embedded?: boolean;
  activeSimulationId?: string;
  focusActiveRequest?: number;
  environmentContext?: SatelliteEnvironmentContext;
  onUseInSimulator?: (item: SatelliteInventoryItem) => void;
} = {}) {
  const [inventory, setInventory] = useState(() => cloneInventory());
  const [selectedId, setSelectedId] = useState(
    () => activeSimulationId ?? DEFAULT_EO_SATELLITES[0].id,
  );
  const [deployment, setDeployment] = useState(1);
  const [showAxes, setShowAxes] = useState(true);
  const [inventoryMode, setInventoryMode] = useState<"EO" | "CUSTOM">("EO");
  const [customDraft, setCustomDraft] = useState(() => createCustomSatelliteDraft());
  const [isPlaying, setIsPlaying] = useState(false);
  const [notice, setNotice] = useState(embedded ? "Configuration inventory connected to simulator" : "Trial inventory loaded");
  const viewerRef = useRef<ViewerHandle>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const animationRef = useRef<number | null>(null);
  const selected = inventory.find((item) => item.id === selectedId) ?? inventory[0];

  useEffect(() => {
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as unknown;
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter(isSatelliteInventoryItem);
      if (valid.length > 0) {
        restoreTimer = setTimeout(() => {
          setInventory(valid);
          setSelectedId(valid.some((item) => item.id === activeSimulationId) ? activeSimulationId! : valid[0].id);
          setNotice(`Restored ${valid.length} local inventory item${valid.length === 1 ? "" : "s"}`);
        }, 0);
      }
    } catch {
      restoreTimer = setTimeout(() => {
        setNotice("Stored draft could not be read; trial defaults are active");
      }, 0);
    }
    return () => {
      if (restoreTimer) clearTimeout(restoreTimer);
    };
  }, [activeSimulationId]);

  useEffect(() => {
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  useEffect(() => {
    if (focusActiveRequest <= 0 || !activeSimulationId) return;
    const focusTimer = setTimeout(() => {
      setInventoryMode("EO");
      setSelectedId(activeSimulationId);
      setDeployment(1);
    }, 0);
    return () => clearTimeout(focusTimer);
  }, [activeSimulationId, focusActiveRequest]);

  const activeArea = useMemo(() => activeArrayAreaM2(selected), [selected]);

  const playDeployment = () => {
    if (isPlaying) return;
    setIsPlaying(true);
    const startValue = deployment > 0.95 ? 0 : deployment;
    const started = performance.now();
    const duration = 1500;
    const tick = (now: number) => {
      const progress = Math.min((now - started) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDeployment(startValue + (1 - startValue) * eased);
      if (progress < 1) animationRef.current = requestAnimationFrame(tick);
      else {
        setIsPlaying(false);
        animationRef.current = null;
      }
    };
    setDeployment(startValue);
    animationRef.current = requestAnimationFrame(tick);
  };

  const saveLocal = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inventory));
    setNotice(`Saved ${inventory.length} inventory items locally`);
  };

  const exportJson = () => {
    const payload = JSON.stringify({ schema: SATELLITE_INVENTORY_SCHEMA, satellites: inventory }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "orbit-pwr-eo-satellite-inventory.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice("Inventory JSON exported");
  };

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const imported = readSatelliteInventoryPayload(parsed);
      const merged = mergeSatelliteInventory(inventory, imported.items);
      const focusId = merged.updatedIds[0] ?? merged.addedIds[0] ?? imported.items[0].id;
      const focusItem = merged.inventory.find((item) => item.id === focusId);
      setInventory(merged.inventory);
      setSelectedId(focusId);
      setDeployment(1);
      const report = [
        merged.updatedIds.length > 0 ? `${merged.updatedIds.length} updated` : "",
        merged.addedIds.length > 0 ? `${merged.addedIds.length} added` : "",
        merged.unchangedIds.length > 0 ? `${merged.unchangedIds.length} unchanged` : "",
        imported.rejectedCount > 0 ? `${imported.rejectedCount} rejected` : "",
      ].filter(Boolean).join(", ");
      setNotice(`Import complete: ${report}. Viewing ${focusItem?.name ?? focusId}. Save locally to persist`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Invalid JSON";
      setNotice(`Import rejected: ${detail}`);
    } finally {
      event.target.value = "";
    }
  };

  const duplicateSelected = () => {
    const copy = structuredClone(selected);
    copy.id = `custom-${Date.now()}`;
    copy.name = `${selected.name} — Custom`;
    copy.status = "custom";
    setInventory((current) => [...current, copy]);
    setSelectedId(copy.id);
    setNotice("Custom editable copy created");
  };

  const deleteSelected = () => {
    if (inventory.length <= 1) {
      setNotice("The last inventory spacecraft cannot be deleted");
      return;
    }
    if (!window.confirm(`Delete ${selected.name} from this inventory?`)) return;
    const selectedIndex = inventory.findIndex((item) => item.id === selected.id);
    const remaining = inventory.filter((item) => item.id !== selected.id);
    const nextSelection = remaining[Math.min(selectedIndex, remaining.length - 1)];
    setInventory(remaining);
    setSelectedId(nextSelection.id);
    setDeployment(1);
    setNotice(`Deleted ${selected.name}. Use Save locally to persist this inventory`);
  };

  const useInSimulator = () => {
    onUseInSimulator?.(structuredClone(selected));
    setNotice(`${selected.name} deployed to the orbit simulation`);
  };

  const saveCustomBuild = (item: SatelliteInventoryItem) => {
    const savedItem = structuredClone(item);
    savedItem.status = "custom";
    setInventory((current) => {
      const exists = current.some((candidate) => candidate.id === savedItem.id);
      const next = exists
        ? current.map((candidate) => candidate.id === savedItem.id ? savedItem : candidate)
        : [...current, savedItem];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setSelectedId(savedItem.id);
    setNotice(`${savedItem.name} saved to the local satellite inventory`);
  };

  const deployCustomBuild = (item: SatelliteInventoryItem) => {
    onUseInSimulator?.(structuredClone(item));
    setNotice(`${item.name} deployed to the orbit simulation`);
  };

  const openCustomBuilder = () => {
    if (selected.status === "custom" && (selected.id.startsWith("custom-build-") || selected.subsystems?.some((part) => part.catalogPartId))) {
      setCustomDraft(structuredClone(selected));
    }
    setInventoryMode("CUSTOM");
    setDeployment(1);
  };

  return (
    <main className={`${styles.shell} ${embedded ? styles.embeddedShell : ""}`}>
      {!embedded && <header className={styles.topbar}>
        <div className={styles.brandBlock}>
          <div className={styles.brandMark} aria-hidden="true"><i /></div>
          <div>
            <p>ORBIT·PWR / DEVELOPMENT LAB</p>
            <h1>EO Satellite Inventory</h1>
          </div>
        </div>
        <div className={styles.prototypeFlag}>
          <span /> LOCAL PROTOTYPE · NOT CONNECTED TO SIMULATOR
        </div>
        <Link href="/" className={styles.backLink}>Back to sizing dashboard</Link>
      </header>}

      <nav className={styles.modeBar} aria-label="Satellite configuration mode">
        <button type="button" className={inventoryMode === "EO" ? styles.activeMode : ""} onClick={() => setInventoryMode("EO")}><span>01</span> EO Platforms</button>
        <button type="button" className={inventoryMode === "CUSTOM" ? styles.activeMode : ""} onClick={openCustomBuilder}><span>02</span> Custom Build <em>PHASE 2A</em></button>
        <p>{inventoryMode === "EO" ? "Select and tune a validated starting platform" : "Assemble a spacecraft from face-mounted functional parts"}</p>
      </nav>

      {inventoryMode === "EO" ? <section className={styles.workspace}>
        <aside className={styles.inventoryRail}>
          <div className={styles.sectionTitle}>
            <div><small>DEFAULT LIBRARY</small><h2>EO platforms</h2></div>
            <span>{inventory.length}</span>
          </div>
          <p className={styles.railIntro}>Representative trial concepts for configuring the inventory workflow. They are not flight-accurate mission replicas.</p>
          <div className={styles.cardList}>
            {inventory.map((item, index) => (
              <button
                type="button"
                key={item.id}
                className={`${styles.satelliteCard} ${item.id === selected.id ? styles.selectedCard : ""}`}
                onClick={() => { setSelectedId(item.id); setDeployment(1); }}
              >
                <span className={styles.cardIndex}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.cardBody}>
                  <strong>{item.name}</strong>
                  <small>{item.className} · {item.geometry.massKg} kg</small>
                  <em>{item.status === "trial" ? "TRIAL MODEL" : "CUSTOM DRAFT"}</em>
                  {item.id === activeSimulationId && <em className={styles.simulatorTag}>DEPLOYED SNAPSHOT · REDEPLOY CHANGES</em>}
                </span>
                <span className={styles.cardChevron}>›</span>
              </button>
            ))}
          </div>
          <div className={styles.railActions}>
            <button type="button" onClick={duplicateSelected}>Duplicate as custom</button>
            <button type="button" onClick={() => importRef.current?.click()}>Import inventory JSON</button>
            <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={importJson} />
          </div>
          <div className={styles.phaseNote}>
            <strong>STEP workflow · phase 2</strong>
            <p>These initial models are procedural. STEP tessellation, part selection, axis picking, and deployment-joint rigging will be added after the inventory schema and models are approved.</p>
          </div>
        </aside>

        <section className={styles.viewerColumn}>
          <div className={styles.viewerHeader}>
            <div>
              <small>{selected.family}</small>
              <h2>{selected.name}</h2>
            </div>
            <div className={styles.viewerTools}>
              <button type="button" className={showAxes ? styles.activeTool : ""} onClick={() => setShowAxes((value) => !value)}>Axes</button>
              <button type="button" onClick={() => viewerRef.current?.resetView()}>Fit / reset</button>
            </div>
          </div>
          <div className={styles.viewerFrame}>
            <SatelliteViewer ref={viewerRef} item={selected} deployment={deployment} showAxes={showAxes} environmentContext={environmentContext} />
            <div className={styles.environmentReadout}>
              <span>MISSION CONTEXT</span>
              <b>{environmentContext?.label ?? "Reference Sun / Earth geometry"}</b>
              <em>{(environmentContext?.shadowFactor ?? 1) <= 0.02 ? "UMBRA" : (environmentContext?.shadowFactor ?? 1) < 0.98 ? "PENUMBRA" : "SUNLIGHT"}</em>
            </div>
            <div className={styles.viewerReadout}>
              <span>DRAG · ROTATE</span><span>WHEEL · ZOOM</span><span>RIGHT DRAG · PAN</span>
            </div>
            <div className={styles.axisLegend}>
              <strong>BODY AXES</strong>
              <span><i className={styles.axisX} />+X</span>
              <span><i className={styles.axisY} />+Y</span>
              <span><i className={styles.axisZ} />+Z</span>
              <strong>ASSIGNED VECTORS</strong>
              <span><i className={styles.axisVelocity} />VELOCITY {selected.frames.velocityAxis}</span>
              <span><i className={styles.axisNadir} />NADIR {selected.frames.nadirAxis}</span>
              <span><i className={styles.axisPayload} />PAYLOAD {selected.frames.payloadBoresightAxis}</span>
              <span><i className={styles.axisSun} />CELL NORMAL {selected.frames.solarCellNormalAxis}</span>
              <strong>MISSION CONTEXT</strong>
              <span><i className={styles.contextVelocity} />ACTUAL VELOCITY</span>
              <span><i className={styles.contextNadir} />ACTUAL NADIR / EARTH</span>
              <span><i className={styles.contextSun} />ACTUAL SUN VECTOR</span>
            </div>
          </div>
          <div className={styles.deploymentStrip}>
            <button type="button" onClick={playDeployment} disabled={isPlaying}>{isPlaying ? "Deploying…" : "Replay deployment"}</button>
            <label>
              <span>ARRAY DEPLOYMENT</span>
              <input type="range" min="0" max="1" step="0.01" value={deployment} onChange={(event) => setDeployment(Number(event.target.value))} />
            </label>
            <output>{Math.round(deployment * selected.array.deployedAngleDeg)}° / {selected.array.deployedAngleDeg}°</output>
          </div>
          <div className={styles.summaryGrid}>
            <article><small>BUS ENVELOPE</small><strong>{selected.geometry.dimensionsM.x} × {selected.geometry.dimensionsM.y} × {selected.geometry.dimensionsM.z} m</strong></article>
            <article><small>ARRAY ACTIVE AREA</small><strong>{activeArea.toFixed(2)} m²</strong></article>
            <article><small>STRING CONFIGURATION</small><strong>{arrayConfigurationLabel(selected)}</strong></article>
            <article><small>SOLAR POWER MODEL</small><strong>{selected.powerDefaults.fluenceE14Cm2 ?? 5}e14 cm⁻² · {((selected.powerDefaults.mpptEfficiency ?? 1) * 100).toFixed(1)}% MPPT</strong></article>
          </div>
        </section>

        <aside className={styles.inspector}>
          <div className={styles.inspectorHead}>
            <div><small>CONFIGURATION</small><h2>Spacecraft setup</h2></div>
            <span className={styles.dirtyTag}>{selected.status}</span>
          </div>
          <div className={styles.inspectorScroll}>
            <section className={styles.formSection}>
              <div className={styles.formSectionTitle}><h3>Identity</h3><span className={styles.readOnlyTag}>READ ONLY</span></div>
              <label className={styles.field}><span>Name</span><input value={selected.name} readOnly /></label>
              <div className={styles.fieldGrid2}>
                <label className={styles.field}><span>Family</span><input value={selected.family} readOnly /></label>
                <label className={styles.field}><span>Spacecraft class</span><select value={selected.className} disabled><option>CubeSat</option><option>Microsatellite</option><option>Small satellite</option></select></label>
              </div>
              <label className={styles.field}><span>Description</span><textarea value={selected.description} rows={3} readOnly /></label>
              <label className={styles.field}><span>Intended use</span><textarea value={selected.intendedUse} rows={2} readOnly /></label>
              <p className={styles.readOnlyNote}>Spacecraft identity is edited in Custom Build. Duplicate this platform or open an existing custom build to make changes.</p>
            </section>

            <ReadOnlyFlightConfiguration item={selected} />
          </div>
          <footer className={`${styles.inspectorFooter} ${styles.inventoryFooter}`}>
            <p aria-live="polite">{notice}</p>
            <div>
              <button type="button" className={styles.dangerButton} onClick={deleteSelected} disabled={inventory.length <= 1}>Delete satellite</button>
              <button type="button" onClick={exportJson}>Export JSON</button>
              <button type="button" className={styles.primaryButton} onClick={saveLocal}>Save locally</button>
              {onUseInSimulator && <button type="button" className={styles.useButton} onClick={useInSimulator}>Deploy to orbit</button>}
            </div>
          </footer>
        </aside>
      </section> : <CustomBuildWorkspace
        draft={customDraft}
        setDraft={setCustomDraft}
        deployment={deployment}
        setDeployment={setDeployment}
        isPlaying={isPlaying}
        onReplayDeployment={playDeployment}
        showAxes={showAxes}
        setShowAxes={setShowAxes}
        environmentContext={environmentContext}
        notice={notice}
        setNotice={setNotice}
        onSave={saveCustomBuild}
        onDeploy={onUseInSimulator ? deployCustomBuild : undefined}
      />}
    </main>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import OrbitSatellite3DOverlay, { type OrbitSatellite3DHandle } from "./OrbitSatellite3DOverlay";
import SatelliteInventory from "./satellite-inventory/SatelliteInventory";
import { DEFAULT_EO_SATELLITES, type SatelliteInventoryItem } from "./lib/satellite-inventory";
import {
  EARTH_RADIUS_KM,
  orbitalFollowCamera,
  formatDuration,
  greenwichMeanSiderealAngleRad,
  runSimulation,
  sunDirection,
  type AttitudeMode,
  type CellModel,
  type MissionConfig,
  type OrbitPreset,
  type PowerConfig,
  type SignedAxis,
  type SimulationPoint,
  type Vector3,
} from "./lib/orbit-model";
import {
  analyzeDilEnergy,
  analyzeDilAxisSweep,
  analyzeDilOperationLoads,
  buildDilSimulation,
  dilLoadIlluminationState,
  dilOperationLoadKey,
  DIL_REQUIRED_FIELDS,
  DIL_TEMPLATE_FIELDS,
  parseDilData,
  type DilRecord,
  type ParsedDilData,
} from "./lib/dil-data";
import { serializeCsv, UTF8_CSV_BOM } from "./lib/csv-export";
import { inventorySatelliteModelSpanM, operationBeamSourceBody } from "./lib/satellite-three";

type ViewMode = "ORBIT" | "SPACECRAFT";
type DashboardTab = "SIMULATION" | "SATELLITE_CONFIGURATION";

const DEFAULT_MISSION: MissionConfig = {
  preset: "SSO",
  altitudeKm: 550,
  inclinationDeg: 97.6,
  raanDeg: 0,
  ltanHours: 10.5,
  eccentricity: 0,
  argumentOfPerigeeDeg: 0,
  trueAnomalyDeg: 0,
  epoch: "2026-08-18T00:00",
  durationDays: 2,
  stepSec: 60,
  attitude: "LVLH",
  panelFacingAxis: "+Z",
  velocityBodyAxis: "+X",
  nadirBodyAxis: "+Z",
  panelRotationXDeg: 0,
  panelRotationYDeg: 0,
  panelRotationZDeg: 0,
  wingLayout: "DUAL",
};

const DEFAULT_POWER: PowerConfig = {
  cellModel: "AZUR_3G30_ADV_4X8",
  vmpV: 2.411,
  impA: 0.499,
  vscV: 2.7,
  iscA: 0.515,
  eolVmpV: 2.262,
  eolImpA: 0.494,
  eolVocV: 2.552,
  eolIscA: 0.511,
  cellAreaCm2: 30.18,
  seriesCells: 19,
  parallelStrings: 24,
  packagingEfficiencyPct: 90,
  fluenceE14Cm2: 5,
  referenceIrradianceWm2: 1367,
  referenceTemperatureC: 28,
  operatingTemperatureC: 60,
  powerTempCoefficientPctC: -0.08,
  pointingErrorDeg: 0,
  angularResponseExponent: 1,
  mpptEfficiencyPct: 100,
  harnessEfficiencyPct: 100,
  mismatchLossPct: 0,
  diodeLossPct: 0,
  contaminationLossPct: 0,
  selfShadowLossPct: 0,
  systemLossPct: 12,
  averageLoadW: 200,
  batteryWh: 1000,
  initialSocPct: 100,
};

const DEFAULT_SIMULATION_SATELLITE = DEFAULT_EO_SATELLITES.find((item) => item.id === "eo-atlas-600")
  ?? DEFAULT_EO_SATELLITES[0];

const PRESET_LABELS: Record<OrbitPreset, string> = {
  LEO: "Keplerian LEO",
  SSO: "Sun-sync orbit",
  GEO: "Circular GEO",
};

const ATTITUDE_LABELS: Record<AttitudeMode, string> = {
  LVLH: "Nadir / LVLH",
  SUN_POINTING: "Sun pointing",
  INERTIAL: "Inertial fixed",
};

const SIGNED_AXES: SignedAxis[] = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];
const PLAYBACK_SPEEDS = [1, 5, 10, 25, 50] as const;
const ORBIT_RADIUS_SCALES = [1, 1.5, 2, 3] as const;

type CatalogElectrical = {
  vocV: number;
  iscA: number;
  vmpV: number;
  impA: number;
};

const CELL_CATALOG: Record<Exclude<CellModel, "CUSTOM">, {
  label: string;
  cellAreaCm2: number;
  assemblyAreaCm2: number;
  referenceUrl: string;
  bol: CatalogElectrical;
  eol: Record<number, CatalogElectrical>;
}> = {
  AZUR_3G30_ADV_4X8: {
    label: "AZUR 3G30-Advanced 4×8 CIC",
    cellAreaCm2: 30.18,
    assemblyAreaCm2: 31.13,
    referenceUrl: "https://www.azurspace.com/media/uploads/file_links/file/bdb_00010891-01-00_tj3g30-advanced_4x8.pdf",
    bol: { vocV: 2.7, iscA: 0.515, vmpV: 2.411, impA: 0.499 },
    eol: {
      0: { vocV: 2.7, iscA: 0.515, vmpV: 2.411, impA: 0.499 },
      0.5: { vocV: 2.633, iscA: 0.513, vmpV: 2.336, impA: 0.496 },
      2.5: { vocV: 2.584, iscA: 0.512, vmpV: 2.298, impA: 0.495 },
      5: { vocV: 2.552, iscA: 0.511, vmpV: 2.262, impA: 0.494 },
      10: { vocV: 2.519, iscA: 0.496, vmpV: 2.23, impA: 0.48 },
      100: { vocV: 2.341, iscA: 0.394, vmpV: 2.127, impA: 0.356 },
    },
  },
  AZUR_3G30_ADV_HP: {
    label: "AZUR 3G30-Advanced (HP) CIC",
    cellAreaCm2: 77.55,
    assemblyAreaCm2: 78.64,
    referenceUrl: "https://www.azurspace.com/media/uploads/file_links/file/bdb_00010894-02-00_3g30-advanced_hp.pdf",
    bol: { vocV: 2.7, iscA: 1.303, vmpV: 2.395, impA: 1.269 },
    eol: {
      0: { vocV: 2.7, iscA: 1.303, vmpV: 2.395, impA: 1.269 },
      0.5: { vocV: 2.633, iscA: 1.298, vmpV: 2.321, impA: 1.261 },
      2.5: { vocV: 2.584, iscA: 1.295, vmpV: 2.282, impA: 1.259 },
      5: { vocV: 2.552, iscA: 1.293, vmpV: 2.247, impA: 1.255 },
      10: { vocV: 2.519, iscA: 1.255, vmpV: 2.215, impA: 1.22 },
      100: { vocV: 2.341, iscA: 0.997, vmpV: 2.112, impA: 0.906 },
    },
  },
  AZUR_4G32_ADV_4X8: {
    label: "AZUR 4G32-Advanced 4×8 CIC",
    cellAreaCm2: 30.6,
    assemblyAreaCm2: 31.34,
    referenceUrl: "https://www.azurspace.com/media/uploads/file_links/file/bdb_00010895-02-00_4g32-advanced_4x8.pdf",
    bol: { vocV: 3.415, iscA: 0.445, vmpV: 3.015, impA: 0.428 },
    eol: {
      0: { vocV: 3.415, iscA: 0.445, vmpV: 3.015, impA: 0.428 },
      0.5: { vocV: 3.33, iscA: 0.444, vmpV: 2.94, impA: 0.426 },
      2.5: { vocV: 3.289, iscA: 0.443, vmpV: 2.891, impA: 0.424 },
      5: { vocV: 3.251, iscA: 0.441, vmpV: 2.849, impA: 0.423 },
      10: { vocV: 3.196, iscA: 0.439, vmpV: 2.786, impA: 0.418 },
      100: { vocV: 2.927, iscA: 0.356, vmpV: 2.572, impA: 0.317 },
    },
  },
  AZUR_4G32_ADV_HP: {
    label: "AZUR 4G32-Advanced (HP) CIC",
    cellAreaCm2: 77.44,
    assemblyAreaCm2: 78.62,
    referenceUrl: "https://www.azurspace.com/media/uploads/file_links/file/bdb_00010897-01-00_4g32-advanced_hp_sqvHd09.pdf",
    bol: { vocV: 3.405, iscA: 1.134, vmpV: 2.97, impA: 1.078 },
    eol: {
      0: { vocV: 3.405, iscA: 1.134, vmpV: 2.97, impA: 1.078 },
      0.5: { vocV: 3.32, iscA: 1.132, vmpV: 2.896, impA: 1.073 },
      2.5: { vocV: 3.279, iscA: 1.128, vmpV: 2.848, impA: 1.068 },
      5: { vocV: 3.242, iscA: 1.125, vmpV: 2.807, impA: 1.065 },
      10: { vocV: 3.187, iscA: 1.118, vmpV: 2.744, impA: 1.053 },
      100: { vocV: 2.918, iscA: 0.906, vmpV: 2.533, impA: 0.799 },
    },
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function magnitude(vector: Vector3) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Vector3, fallback: Vector3 = [1, 0, 0]): Vector3 {
  const length = magnitude(vector);
  return length > 1e-9
    ? [vector[0] / length, vector[1] / length, vector[2] / length]
    : fallback;
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function add(a: Vector3, b: Vector3): Vector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(vector: Vector3, amount: number): Vector3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function signedAxisVector(axis: SignedAxis): Vector3 {
  const sign = axis.startsWith("-") ? -1 : 1;
  if (axis.endsWith("X")) return [sign, 0, 0];
  if (axis.endsWith("Y")) return [0, sign, 0];
  return [0, 0, sign];
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vector3, b: Vector3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function rotateAround(vector: Vector3, axis: Vector3, angleRad: number): Vector3 {
  const unitAxis = normalize(axis);
  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  return add(
    add(scale(vector, cosine), scale(cross(unitAxis, vector), sine)),
    scale(unitAxis, dot(unitAxis, vector) * (1 - cosine)),
  );
}

function rayEarthIntersection(originKm: Vector3, direction: Vector3) {
  const unitDirection = normalize(direction);
  const projection = dot(originKm, unitDirection);
  const radiusTerm = dot(originKm, originKm) - EARTH_RADIUS_KM * EARTH_RADIUS_KM;
  const discriminant = projection * projection - radiusTerm;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const near = -projection - root;
  const far = -projection + root;
  const distance = near > 0 ? near : far > 0 ? far : -1;
  return distance > 0 ? add(originKm, scale(unitDirection, distance)) : null;
}

function pointInPolygon(point: [number, number], polygon: Array<[number, number]>) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    const intersects = yi > point[1] !== yj > point[1]
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

type OperationVisual = "PROPULSION" | "IMAGING" | "TRANSITION" | "GEOPOINTING" | "NOMINAL";

function classifyOperation(value?: string): OperationVisual {
  const operation = value?.trim().toUpperCase() ?? "";
  if (operation.startsWith("GSPOINTING")) return "GEOPOINTING";
  if (/PROPULS|THRUST|BURN|MANEUVER|MANOEUVRE/.test(operation)) return "PROPULSION";
  if (/IMAG|CAPTURE|CAMERA|OBSERV/.test(operation)) return "IMAGING";
  if (/TRANSITION|SLEW|REORIENT|ACQUISITION/.test(operation)) return "TRANSITION";
  if (/GEO.?POINT|EARTH.?POINT|GROUND.?POINT/.test(operation)) return "GEOPOINTING";
  return "NOMINAL";
}

function decimateSimulationPoints(points: SimulationPoint[], maximum: number) {
  if (points.length <= maximum) return points;
  const indices = new Set<number>([0, points.length - 1]);
  const stride = Math.ceil(points.length / maximum);
  for (let index = 0; index < points.length; index += stride) indices.add(index);
  for (let index = 1; index < points.length; index += 1) {
    const previousState = points[index - 1].shadowFactor <= 0.02 ? 0 : points[index - 1].shadowFactor < 0.98 ? 1 : 2;
    const state = points[index].shadowFactor <= 0.02 ? 0 : points[index].shadowFactor < 0.98 ? 1 : 2;
    if (state !== previousState) {
      indices.add(index - 1);
      indices.add(index);
    }
    if (points[index - 1].operationLoadW !== points[index].operationLoadW) {
      indices.add(index - 1);
      indices.add(index);
    }
  }
  return [...indices].sort((a, b) => a - b).map((index) => points[index]);
}

type Quaternion = [number, number, number, number];

function normalizeQuaternion(quaternion: Quaternion): Quaternion {
  const length = Math.hypot(...quaternion) || 1;
  return quaternion.map((value) => value / length) as Quaternion;
}

function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return normalizeQuaternion([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}

function quaternionFromArc(from: Vector3, to: Vector3): Quaternion {
  const axis = cross(from, to);
  return normalizeQuaternion([axis[0], axis[1], axis[2], 1 + clamp(dot(from, to), -1, 1)]);
}

function rotateByQuaternion(vector: Vector3, quaternion: Quaternion): Vector3 {
  const [qx, qy, qz, qw] = quaternion;
  const qVector: Vector3 = [qx, qy, qz];
  const uv = cross(qVector, vector);
  const uuv = cross(qVector, uv);
  return add(vector, add(scale(uv, 2 * qw), scale(uuv, 2)));
}

function arcballPoint(clientX: number, clientY: number, bounds: DOMRect): Vector3 {
  const radius = Math.max(1, Math.min(bounds.width, bounds.height) / 2);
  const x = (clientX - (bounds.left + bounds.width / 2)) / radius;
  const y = ((bounds.top + bounds.height / 2) - clientY) / radius;
  const distanceSquared = x * x + y * y;
  return distanceSquared <= 1
    ? [x, y, Math.sqrt(1 - distanceSquared)]
    : normalize([x, y, 0]);
}

function useCanvasSize(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const [size, setSize] = useState({ width: 800, height: 500, dpr: 1 });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const update = () => {
      const rect = canvas.getBoundingClientRect();
      setSize({
        width: Math.max(280, rect.width),
        height: Math.max(220, rect.height),
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef]);
  return size;
}

function drawArrow(
  context: CanvasRenderingContext2D,
  from: [number, number],
  to: [number, number],
  color: string,
  label?: string,
  lineWidth = 2,
) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = lineWidth;
  context.beginPath();
  context.moveTo(from[0], from[1]);
  context.lineTo(to[0], to[1]);
  context.stroke();
  context.beginPath();
  context.moveTo(to[0], to[1]);
  context.lineTo(to[0] - 9 * Math.cos(angle - 0.45), to[1] - 9 * Math.sin(angle - 0.45));
  context.lineTo(to[0] - 9 * Math.cos(angle + 0.45), to[1] - 9 * Math.sin(angle + 0.45));
  context.closePath();
  context.fill();
  if (label) {
    context.font = "600 11px var(--font-geist-mono), monospace";
    context.fillText(label, to[0] + 7, to[1] - 5);
  }
}

function OrbitCanvas({
  points,
  currentIndex,
  mode,
  mission,
  isDilReplay,
  illuminationEpochMs,
  sceneSunVector,
  spacecraftOperation,
  orbitSpacecraft,
  onAxisChange,
}: {
  points: SimulationPoint[];
  currentIndex: number;
  mode: ViewMode;
  mission: MissionConfig;
  isDilReplay: boolean;
  illuminationEpochMs: number;
  sceneSunVector: Vector3;
  spacecraftOperation?: string;
  orbitSpacecraft: SatelliteInventoryItem | null;
  onAxisChange: (value: SignedAxis) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const earthTexture = useRef<HTMLImageElement | null>(null);
  const size = useCanvasSize(canvasRef);
  const [viewRotation, setViewRotation] = useState<Quaternion>([0, 0, 0, 1]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panEnabled, setPanEnabled] = useState(false);
  const [orbitCameraMode, setOrbitCameraMode] = useState<"FREE" | "FOLLOW">("FREE");
  const [followOrbitAngles, setFollowOrbitAngles] = useState({ yaw: 0, pitch: 0 });
  const [orbitRadiusScale, setOrbitRadiusScale] = useState<number>(1.5);
  const [deploymentProgress, setDeploymentProgress] = useState(1);
  const [earthTextureReady, setEarthTextureReady] = useState(false);
  const deploymentAnimation = useRef<number | null>(null);
  const operationAnimation = useRef<number | null>(null);
  const orbitSatellite3dRef = useRef<OrbitSatellite3DHandle>(null);
  const faceHitRegions = useRef<Array<{ axis: SignedAxis; polygon: Array<[number, number]> }>>([]);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; moved: boolean; arcball: Vector3 } | null>(null);
  const orbitMetadata = useMemo(() => {
    let maxRadius = EARTH_RADIUS_KM + 100;
    const sampledRadii: number[] = [];
    const radiusStride = Math.max(1, Math.ceil(points.length / 2000));
    for (let index = 0; index < points.length; index += 1) {
      const radius = magnitude(points[index].positionKm);
      maxRadius = Math.max(maxRadius, radius);
      if (index % radiusStride === 0) sampledRadii.push(radius);
    }
    if (isDilReplay && sampledRadii.length) {
      sampledRadii.sort((a, b) => a - b);
      maxRadius = Math.max(EARTH_RADIUS_KM + 100, sampledRadii[Math.floor((sampledRadii.length - 1) * 0.95)]);
    }
    const positiveSteps: number[] = [];
    for (let index = 1; index < Math.min(points.length, 257); index += 1) {
      const step = points[index].tSec - points[index - 1].tSec;
      if (step > 0) positiveSteps.push(step);
    }
    positiveSteps.sort((a, b) => a - b);
    return {
      maxRadius,
      typicalStepSec: positiveSteps.length ? positiveSteps[Math.floor(positiveSteps.length / 2)] : 60,
      dilTrack: isDilReplay ? decimateSimulationPoints(points, 1600) : null,
    };
  }, [isDilReplay, points]);
  const activePoint = points[clamp(currentIndex, 0, points.length - 1)] ?? null;
  const targetOperationVisual = classifyOperation(spacecraftOperation);
  const [operationTransition, setOperationTransition] = useState<{
    from: OperationVisual;
    to: OperationVisual;
    progress: number;
  }>(() => ({ from: targetOperationVisual, to: targetOperationVisual, progress: 1 }));
  const operationTransitionRef = useRef(operationTransition);
  const followSatellite = orbitCameraMode !== "FREE";
  const lockedSunVector = sceneSunVector;

  const resetView = () => {
    setViewRotation([0, 0, 0, 1]);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPanEnabled(false);
    setOrbitCameraMode("FREE");
    setFollowOrbitAngles({ yaw: 0, pitch: 0 });
    setOrbitRadiusScale(1.5);
  };

  const replayDeployment = () => {
    if (deploymentAnimation.current !== null) cancelAnimationFrame(deploymentAnimation.current);
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = clamp((now - startedAt) / 1800, 0, 1);
      setDeploymentProgress(1 - (1 - progress) ** 3);
      if (progress < 1) deploymentAnimation.current = requestAnimationFrame(animate);
      else deploymentAnimation.current = null;
    };
    setDeploymentProgress(0);
    deploymentAnimation.current = requestAnimationFrame(animate);
  };

  useEffect(() => () => {
    if (deploymentAnimation.current !== null) cancelAnimationFrame(deploymentAnimation.current);
    if (operationAnimation.current !== null) cancelAnimationFrame(operationAnimation.current);
  }, []);

  useEffect(() => {
    operationTransitionRef.current = operationTransition;
  }, [operationTransition]);

  useEffect(() => {
    const previous = operationTransitionRef.current;
    if (previous.to === targetOperationVisual && previous.progress >= 1) return;
    if (operationAnimation.current !== null) cancelAnimationFrame(operationAnimation.current);
    const from = previous.progress < 0.5 ? previous.from : previous.to;
    const commit = (next: { from: OperationVisual; to: OperationVisual; progress: number }) => {
      operationTransitionRef.current = next;
      setOperationTransition(next);
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      commit({ from: targetOperationVisual, to: targetOperationVisual, progress: 1 });
      return;
    }
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = clamp((now - startedAt) / 520, 0, 1);
      commit({ from, to: targetOperationVisual, progress });
      if (progress < 1) operationAnimation.current = requestAnimationFrame(animate);
      else operationAnimation.current = null;
    };
    commit({ from, to: targetOperationVisual, progress: 0 });
    operationAnimation.current = requestAnimationFrame(animate);
    return () => {
      if (operationAnimation.current !== null) cancelAnimationFrame(operationAnimation.current);
      operationAnimation.current = null;
    };
  }, [targetOperationVisual]);

  useEffect(() => {
    const image = new Image();
    image.decoding = "async";
    image.src = "/earth-blue-marble.png";
    image.onload = () => {
      earthTexture.current = image;
      setEarthTextureReady(true);
    };
    return () => {
      image.onload = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      if (mode !== "ORBIT" || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      event.stopPropagation();
      setZoom((value) => clamp(value * (event.deltaY > 0 ? 0.9 : 1.1), 0.65, 12));
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !points.length) return;
    const { width, height, dpr } = size;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#030a10");
    background.addColorStop(0.58, "#07151b");
    background.addColorStop(1, "#050b10");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    for (let star = 0; star < 110; star += 1) {
      const x = (((star * 67 + 29) % 997) / 997) * width;
      const y = (((star * 149 + 71) % 991) / 991) * height;
      const alpha = 0.1 + ((star * 17) % 45) / 100;
      context.fillStyle = `rgba(218, 238, 242, ${alpha})`;
      context.fillRect(x, y, star % 13 === 0 ? 1.5 : 1, star % 13 === 0 ? 1.5 : 1);
    }

    const current = points[clamp(currentIndex, 0, points.length - 1)];

    const rotate = (vector: Vector3): Vector3 => {
      return rotateByQuaternion(vector, viewRotation);
    };
    const transitionProgress = operationTransition.progress * operationTransition.progress * (3 - 2 * operationTransition.progress);
    const operationLayers: Array<{ visual: OperationVisual; opacity: number }> =
      operationTransition.from === operationTransition.to || transitionProgress >= 1
        ? [{ visual: operationTransition.to, opacity: 1 }]
        : [
            { visual: operationTransition.from, opacity: 1 - transitionProgress },
            { visual: operationTransition.to, opacity: transitionProgress },
          ];

    if (mode === "ORBIT") {
      const maxRadius = orbitMetadata.maxRadius;
      const displayMaxRadius = EARTH_RADIUS_KM + Math.max(0, maxRadius - EARTH_RADIUS_KM) * orbitRadiusScale;
      const plotRadius = followSatellite
        ? Math.min(width * 0.42, height * 0.43)
        : Math.min(width * 0.35, height * 0.34);
      const plotScale = followSatellite
        ? ((height * 0.43) / (EARTH_RADIUS_KM * 1.08)) * zoom
        : (plotRadius / (displayMaxRadius * 1.12)) * zoom;
      const inertialSun2d = rotate(lockedSunVector);
      const center: [number, number] = followSatellite
        ? [width * 0.5 + pan.x, height * 0.48 + pan.y]
        : [width * 0.66 + pan.x, height * 0.65 + pan.y];
      // The orbital follow rig advances with the propagated state but looks
      // ahead of the spacecraft. This preserves real travel through the scene
      // instead of pinning the vehicle to the center of the user's screen.
      const followCamera = orbitalFollowCamera(current.positionKm, current.velocityKmS);
      let cameraRight = followCamera.right;
      let cameraVertical = followCamera.up;
      let cameraDepth = followCamera.depth;
      let cameraOrigin = followCamera.cameraPositionKm;
      if (followSatellite && (Math.abs(followOrbitAngles.yaw) > 1e-6 || Math.abs(followOrbitAngles.pitch) > 1e-6)) {
        const observerDistanceKm = magnitude(subtract(followCamera.cameraPositionKm, followCamera.targetKm));
        const cosPitch = Math.cos(followOrbitAngles.pitch);
        const localOffset: Vector3 = [
          Math.sin(followOrbitAngles.yaw) * cosPitch * observerDistanceKm,
          Math.sin(followOrbitAngles.pitch) * observerDistanceKm,
          -Math.cos(followOrbitAngles.yaw) * cosPitch * observerDistanceKm,
        ];
        const worldOffset = add(
          add(scale(followCamera.right, localOffset[0]), scale(followCamera.up, localOffset[1])),
          scale(followCamera.depth, localOffset[2]),
        );
        cameraOrigin = add(followCamera.targetKm, worldOffset);
        const minimumObserverRadiusKm = EARTH_RADIUS_KM + Math.max(80, (magnitude(current.positionKm) - EARTH_RADIUS_KM) * 0.08);
        if (magnitude(cameraOrigin) < minimumObserverRadiusKm) {
          cameraOrigin = scale(normalize(cameraOrigin, followCamera.radialOut), minimumObserverRadiusKm);
        }
        cameraDepth = normalize(subtract(followCamera.targetKm, cameraOrigin), followCamera.depth);
        cameraRight = normalize(cross(cameraDepth, followCamera.radialOut), followCamera.right);
        cameraVertical = normalize(cross(cameraRight, cameraDepth), followCamera.up);
      }
      const followFocalLengthPx = Math.min(width, height) * 0.58 * Math.sqrt(zoom);
      const displayOrbitPosition = (vector: Vector3): Vector3 => {
        if (followSatellite) return vector;
        const radius = magnitude(vector);
        if (radius <= EARTH_RADIUS_KM || radius < 1e-9) return vector;
        const displayRadius = EARTH_RADIUS_KM + (radius - EARTH_RADIUS_KM) * orbitRadiusScale;
        return scale(vector, displayRadius / radius);
      };
      const project = (vector: Vector3): [number, number, number] => {
        const relative = followSatellite ? subtract(vector, cameraOrigin) : displayOrbitPosition(vector);
        const transformed = followSatellite
          ? [dot(relative, cameraRight), dot(relative, cameraVertical), dot(relative, cameraDepth)] as Vector3
          : rotate(relative);
        if (followSatellite) {
          const perspective = followFocalLengthPx / Math.max(followCamera.nearClipKm, transformed[2]);
          return [
            center[0] + transformed[0] * perspective,
            center[1] - transformed[1] * perspective,
            transformed[2],
          ];
        }
        return [center[0] + transformed[0] * plotScale, center[1] - transformed[1] * plotScale, transformed[2]];
      };
      const earthCenter = project([0, 0, 0]);
      const cameraEarthDistanceKm = magnitude(cameraOrigin);
      const earthRadius = followSatellite
        ? followFocalLengthPx * EARTH_RADIUS_KM
          / Math.sqrt(Math.max(1, cameraEarthDistanceKm ** 2 - EARTH_RADIUS_KM ** 2))
        : EARTH_RADIUS_KM * plotScale;
      const sun2d = followSatellite
        ? [dot(lockedSunVector, cameraRight), dot(lockedSunVector, cameraVertical), dot(lockedSunVector, cameraDepth)] as Vector3
        : inertialSun2d;
      const screenSun = normalize([sun2d[0], -sun2d[1], 0], [-0.82, -0.42, 0]);

      if (!followSatellite && zoom <= 2.25) {
        context.strokeStyle = "rgba(131, 179, 184, 0.10)";
        context.lineWidth = 1;
        for (let ring = 1; ring <= 3; ring += 1) {
          context.beginPath();
          context.arc(earthCenter[0], earthCenter[1], (plotRadius * zoom * ring) / 3, 0, Math.PI * 2);
          context.stroke();
        }
      }

      // Projected umbra direction gives the orbit state colors physical context.
      const shadowDirection = scale(screenSun, -1);
      const perpendicular: [number, number] = [-shadowDirection[1], shadowDirection[0]];
      const coneLength = Math.max(plotRadius * 1.65 * zoom, earthRadius * 2.4);
      context.fillStyle = "rgba(2, 5, 9, 0.46)";
      context.beginPath();
      context.moveTo(earthCenter[0] + perpendicular[0] * earthRadius * 0.93, earthCenter[1] + perpendicular[1] * earthRadius * 0.93);
      context.lineTo(earthCenter[0] + shadowDirection[0] * coneLength + perpendicular[0] * earthRadius * 0.42, earthCenter[1] + shadowDirection[1] * coneLength + perpendicular[1] * earthRadius * 0.42);
      context.lineTo(earthCenter[0] + shadowDirection[0] * coneLength - perpendicular[0] * earthRadius * 0.42, earthCenter[1] + shadowDirection[1] * coneLength - perpendicular[1] * earthRadius * 0.42);
      context.lineTo(earthCenter[0] - perpendicular[0] * earthRadius * 0.93, earthCenter[1] - perpendicular[1] * earthRadius * 0.93);
      context.closePath();
      context.fill();

      const dt = Math.max(0.001, orbitMetadata.typicalStepSec);
      const radius = magnitude(current.positionKm);
      const periodRadius = isDilReplay
        ? radius
        : EARTH_RADIUS_KM + (mission.preset === "GEO" ? 35786 : mission.altitudeKm);
      const periodEstimate = 2 * Math.PI * Math.sqrt(periodRadius ** 3 / 398600.4418);
      const samplesPerOrbit = Math.max(12, Math.round(periodEstimate / dt));
      const revolutionStart = Math.floor(currentIndex / samplesPerOrbit) * samplesPerOrbit;
      const orbitPoints = orbitMetadata.dilTrack ?? decimateSimulationPoints(
        points.slice(revolutionStart, Math.min(points.length, revolutionStart + samplesPerOrbit + 1)),
        1600,
      );
      const stateColor = (factor: number) => factor <= 0.02 ? "#ef6f58" : factor < 0.98 ? "#f2b45b" : "#54ddd8";

      // The global orbit ring belongs to the engineering overview. In orbital
      // follow mode it would pass behind the camera and break the cinematic
      // depth cue, so only the local travelled trail remains visible.
      if (!followSatellite) {
        context.strokeStyle = "rgba(166, 205, 207, 0.16)";
        context.lineWidth = 1.25;
        context.beginPath();
        orbitPoints.forEach((point, index) => {
          const projected = project(point.positionKm);
          if (index === 0) context.moveTo(projected[0], projected[1]);
          else context.lineTo(projected[0], projected[1]);
        });
        context.stroke();

        context.save();
        context.globalAlpha = 0.48;
        for (let index = 1; index < orbitPoints.length; index += 1) {
          const from = project(orbitPoints[index - 1].positionKm);
          const to = project(orbitPoints[index].positionKm);
          const light = (orbitPoints[index - 1].shadowFactor + orbitPoints[index].shadowFactor) / 2;
          context.strokeStyle = stateColor(light);
          context.shadowColor = stateColor(light);
          context.shadowBlur = light <= 0.02 ? 1 : 2;
          context.lineWidth = light <= 0.02 ? 1.25 : 1;
          context.setLineDash(light <= 0.02 ? [7, 4] : []);
          context.beginPath();
          context.moveTo(from[0], from[1]);
          context.lineTo(to[0], to[1]);
          context.stroke();
        }
        context.setLineDash([]);
        context.shadowBlur = 0;
        context.restore();
      }

      // A full-revolution, tapered history trail makes the propagated path
      // readable without changing the epoch/LTAN-defined orbit geometry.
      const trailStart = Math.max(0, currentIndex - samplesPerOrbit);
      const trailPoints = decimateSimulationPoints(points.slice(trailStart, currentIndex + 1), 1200);
      for (let index = 1; index < trailPoints.length; index += 1) {
        const from = project(trailPoints[index - 1].positionKm);
        const to = project(trailPoints[index].positionKm);
        if (followSatellite && (from[2] <= followCamera.nearClipKm || to[2] <= followCamera.nearClipKm)) continue;
        const progress = index / Math.max(1, trailPoints.length - 1);
        const light = (trailPoints[index - 1].shadowFactor + trailPoints[index].shadowFactor) / 2;
        context.globalAlpha = 0.16 + progress * 0.78;
        context.strokeStyle = stateColor(light);
        context.shadowColor = stateColor(light);
        context.shadowBlur = 2 + progress * 7;
        context.lineWidth = 2.2 + progress * 2.2;
        context.beginPath();
        context.moveTo(from[0], from[1]);
        context.lineTo(to[0], to[1]);
        context.stroke();
      }
      context.globalAlpha = 1;
      context.shadowBlur = 0;

      if (!followSatellite) {
        for (let index = 1; index < orbitPoints.length; index += 1) {
          const previous = orbitPoints[index - 1].shadowFactor;
          const next = orbitPoints[index].shadowFactor;
          if ((previous >= 0.98 && next < 0.98) || (previous < 0.98 && next >= 0.98)) {
            const marker = project(orbitPoints[index].positionKm);
            context.fillStyle = next < 0.98 ? "#f2b45b" : "#54ddd8";
            context.strokeStyle = "#071014";
            context.lineWidth = 2;
            context.beginPath();
            context.arc(marker[0], marker[1], 4.2, 0, Math.PI * 2);
            context.fill();
            context.stroke();
          }
        }
      }

      // Earth-fixed features and the epoch/LTAN orbit share the same scene
      // projection, so camera rotation and pan can never separate the two.
      const earthAngle = greenwichMeanSiderealAngleRad(new Date(illuminationEpochMs + current.tSec * 1000));
      // NASA Blue Marble texture is wrapped across a rotating spherical disc.
      context.save();
      context.beginPath();
      context.arc(earthCenter[0], earthCenter[1], earthRadius, 0, Math.PI * 2);
      context.clip();
      const texture = earthTexture.current;
      if (texture && earthTextureReady) {
        const rotationPhase = earthAngle / (Math.PI * 2);
        const centerTextureX = (((0.5 - rotationPhase) % 1 + 1) % 1) * texture.width;
        const sourceSpan = texture.width / 2;
        const sourceStart = ((centerTextureX - sourceSpan / 2) % texture.width + texture.width) % texture.width;
        const firstSpan = Math.min(sourceSpan, texture.width - sourceStart);
        const firstDestinationWidth = earthRadius * 2 * (firstSpan / sourceSpan);
        context.drawImage(texture, sourceStart, 0, firstSpan, texture.height, earthCenter[0] - earthRadius, earthCenter[1] - earthRadius, firstDestinationWidth, earthRadius * 2);
        const remainingSpan = sourceSpan - firstSpan;
        if (remainingSpan > 0) {
          context.drawImage(texture, 0, 0, remainingSpan, texture.height, earthCenter[0] - earthRadius + firstDestinationWidth, earthCenter[1] - earthRadius, earthRadius * 2 - firstDestinationWidth, earthRadius * 2);
        }
      } else {
        const fallbackOcean = context.createRadialGradient(earthCenter[0] - earthRadius * 0.3, earthCenter[1] - earthRadius * 0.3, 0, earthCenter[0], earthCenter[1], earthRadius);
        fallbackOcean.addColorStop(0, "#2a91b3");
        fallbackOcean.addColorStop(0.55, "#12617f");
        fallbackOcean.addColorStop(1, "#020b13");
        context.fillStyle = fallbackOcean;
        context.fillRect(earthCenter[0] - earthRadius, earthCenter[1] - earthRadius, earthRadius * 2, earthRadius * 2);
      }

      const globeShade = context.createRadialGradient(
        earthCenter[0] - earthRadius * 0.34,
        earthCenter[1] - earthRadius * 0.36,
        earthRadius * 0.08,
        earthCenter[0],
        earthCenter[1],
        earthRadius,
      );
      globeShade.addColorStop(0, "rgba(130, 205, 232, 0.14)");
      globeShade.addColorStop(0.68, "rgba(0, 8, 18, 0.06)");
      globeShade.addColorStop(1, "rgba(0, 3, 11, 0.52)");
      context.fillStyle = globeShade;
      context.fillRect(earthCenter[0] - earthRadius, earthCenter[1] - earthRadius, earthRadius * 2, earthRadius * 2);

      const earthFixedPoint = (latitudeDeg: number, longitudeDeg: number): Vector3 => {
        const latitude = latitudeDeg * Math.PI / 180;
        const longitude = longitudeDeg * Math.PI / 180;
        const xFixed = EARTH_RADIUS_KM * Math.cos(latitude) * Math.cos(longitude);
        const yFixed = EARTH_RADIUS_KM * Math.cos(latitude) * Math.sin(longitude);
        const zFixed = EARTH_RADIUS_KM * Math.sin(latitude);
        return [
          Math.cos(earthAngle) * xFixed - Math.sin(earthAngle) * yFixed,
          Math.sin(earthAngle) * xFixed + Math.cos(earthAngle) * yFixed,
          zFixed,
        ];
      };
      const drawEarthFixedCurve = (curve: Vector3[]) => {
        context.beginPath();
        let drawing = false;
        for (const vector of curve) {
          const point = project(vector);
          const visible = followSatellite
            ? dot(vector, subtract(cameraOrigin, vector)) > 0
            : point[2] >= earthCenter[2];
          if (!visible) {
            drawing = false;
            continue;
          }
          if (!drawing) context.moveTo(point[0], point[1]);
          else context.lineTo(point[0], point[1]);
          drawing = true;
        }
        context.stroke();
      };
      context.strokeStyle = "rgba(168, 218, 224, 0.16)";
      context.lineWidth = 0.7;
      for (const latitude of [-45, 0, 45]) {
        const curve: Vector3[] = [];
        for (let longitude = -180; longitude <= 180; longitude += 6) curve.push(earthFixedPoint(latitude, longitude));
        drawEarthFixedCurve(curve);
      }
      for (const longitude of [-90, 0, 90, 180]) {
        const curve: Vector3[] = [];
        for (let latitude = -90; latitude <= 90; latitude += 5) curve.push(earthFixedPoint(latitude, longitude));
        drawEarthFixedCurve(curve);
      }

      const terminator = context.createLinearGradient(
        earthCenter[0] + screenSun[0] * earthRadius,
        earthCenter[1] + screenSun[1] * earthRadius,
        earthCenter[0] - screenSun[0] * earthRadius,
        earthCenter[1] - screenSun[1] * earthRadius,
      );
      terminator.addColorStop(0, "rgba(0, 0, 0, 0)");
      terminator.addColorStop(0.48, "rgba(0, 2, 7, 0.18)");
      terminator.addColorStop(0.65, "rgba(0, 3, 9, 0.66)");
      terminator.addColorStop(1, "rgba(0, 2, 7, 0.9)");
      context.fillStyle = terminator;
      context.fillRect(earthCenter[0] - earthRadius, earthCenter[1] - earthRadius, earthRadius * 2, earthRadius * 2);
      context.restore();
      const atmosphereThickness = clamp(earthRadius * 0.014, 1.4, 7);
      const atmosphere = context.createRadialGradient(
        earthCenter[0],
        earthCenter[1],
        Math.max(0, earthRadius - atmosphereThickness * 0.45),
        earthCenter[0],
        earthCenter[1],
        earthRadius + atmosphereThickness * 1.8,
      );
      atmosphere.addColorStop(0, "rgba(73, 146, 193, 0)");
      atmosphere.addColorStop(0.44, "rgba(80, 177, 223, 0.24)");
      atmosphere.addColorStop(0.62, "rgba(98, 193, 235, 0.42)");
      atmosphere.addColorStop(0.76, "rgba(105, 137, 220, 0.18)");
      atmosphere.addColorStop(1, "rgba(70, 105, 190, 0)");
      context.fillStyle = atmosphere;
      context.beginPath();
      context.arc(earthCenter[0], earthCenter[1], earthRadius + atmosphereThickness * 1.8, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(137, 211, 238, 0.46)";
      context.lineWidth = clamp(earthRadius * 0.004, 0.65, 2.2);
      context.beginPath();
      context.arc(earthCenter[0], earthCenter[1], earthRadius, 0, Math.PI * 2);
      context.stroke();

      const sunDistance = Math.max(earthRadius * 2.2, Math.min(width, height) * 0.34);
      const sunCenter: [number, number] = followSatellite
        ? [
            clamp(earthCenter[0] + screenSun[0] * sunDistance, 44, width - 44),
            clamp(earthCenter[1] + screenSun[1] * sunDistance, 48, height - 48),
          ]
        : [
            clamp(earthCenter[0] + screenSun[0] * sunDistance, 44, width - 44),
            clamp(earthCenter[1] + screenSun[1] * sunDistance, 48, height - 48),
          ];
      const sunGlow = context.createRadialGradient(sunCenter[0], sunCenter[1], 2, sunCenter[0], sunCenter[1], 42);
      sunGlow.addColorStop(0, "rgba(255, 244, 184, 1)");
      sunGlow.addColorStop(0.26, "rgba(249, 185, 72, 0.95)");
      sunGlow.addColorStop(0.54, "rgba(245, 145, 45, 0.28)");
      sunGlow.addColorStop(1, "rgba(245, 145, 45, 0)");
      context.fillStyle = sunGlow;
      context.beginPath();
      context.arc(sunCenter[0], sunCenter[1], 42, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#ffc96a";
      context.shadowColor = "rgba(255, 183, 69, 0.9)";
      context.shadowBlur = 18;
      context.beginPath();
      context.arc(sunCenter[0], sunCenter[1], 13, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      const satellite = project(current.positionKm);
      const velocity = normalize(current.velocityKmS);
      const velocityVectorLengthKm = maxRadius * (followSatellite ? 0.035 : 0.19);
      const velocityEnd = project(add(current.positionKm, scale(velocity, velocityVectorLengthKm)));
      const assignedVelocityBody = signedAxisVector(mission.velocityBodyAxis);
      const assignedVelocityDirection = normalize(add(
        add(scale(current.bodyXAxis, assignedVelocityBody[0]), scale(current.bodyYAxis, assignedVelocityBody[1])),
        scale(current.bodyZAxis, assignedVelocityBody[2]),
      ));
      const assignedVelocityEnd = project(add(current.positionKm, scale(assignedVelocityDirection, velocityVectorLengthKm)));
      const velocityAlignmentDeg = Math.acos(clamp(dot(velocity, assignedVelocityDirection), -1, 1)) * 180 / Math.PI;
      const showDilVelocityDifference = isDilReplay && velocityAlignmentDeg > 2;
      const drawVelocityVectors = () => {
        drawArrow(
          context,
          [satellite[0], satellite[1]],
          [velocityEnd[0], velocityEnd[1]],
          "#c8f0ee",
          showDilVelocityDifference ? "V ACTUAL" : `${mission.velocityBodyAxis} = V`,
          1.1,
        );
        if (showDilVelocityDifference) {
          drawArrow(
            context,
            [satellite[0], satellite[1]],
            [assignedVelocityEnd[0], assignedVelocityEnd[1]],
            "#f2c55c",
            `BODY ${mission.velocityBodyAxis}`,
            1.1,
          );
        }
      };
      const satColor = stateColor(current.shadowFactor);
      const atlasDeployed = Boolean(orbitSpacecraft);
      const satelliteBaseSize = atlasDeployed ? 11.5 : 9;
      // In chase mode the inventory model should occupy the foreground like a
      // nearby formation observer, instead of reading as a distant orbit icon.
      const chaseModelSpanPx = clamp(
        Math.min(width * 0.58, height * 0.54) * Math.sqrt(zoom),
        Math.min(width, height) * 0.32,
        560,
      );
      const satSize = followSatellite
        ? chaseModelSpanPx / 6.2
        : clamp(satelliteBaseSize * Math.sqrt(zoom), satelliteBaseSize, atlasDeployed ? 31 : 24);
      const satelliteBehindEarth = !followSatellite
        && Math.hypot(satellite[0] - earthCenter[0], satellite[1] - earthCenter[1]) < earthRadius * 0.985
        && satellite[2] < earthCenter[2];
      const cameraBasisVector = (vector: Vector3): Vector3 => orbitCameraMode === "FOLLOW"
        // Orbit-camera depth is positive away from the observer; Three.js
        // camera-space +Z points toward the observer. Negating depth preserves
        // a proper right-handed body basis instead of reflecting the model.
        ? [dot(vector, cameraRight), dot(vector, cameraVertical), -dot(vector, cameraDepth)]
        : rotate(vector);
      const modelPixelsPerMeter = atlasDeployed && orbitSpacecraft
        ? (satSize * 6.2) / Math.max(
            inventorySatelliteModelSpanM(orbitSpacecraft, mission.wingLayout === "DUAL" ? "dual" : "single"),
            0.1,
          )
        : 0;
      const spacecraftBodyPointToScreen = (pointBody: Vector3): [number, number] => {
        if (!atlasDeployed || !orbitSpacecraft) return [satellite[0], satellite[1]];
        const cameraOffset = add(
          add(
            scale(cameraBasisVector(current.bodyXAxis), pointBody[0]),
            scale(cameraBasisVector(current.bodyYAxis), pointBody[1]),
          ),
          scale(cameraBasisVector(current.bodyZAxis), pointBody[2]),
        );
        return [
          satellite[0] + cameraOffset[0] * modelPixelsPerMeter,
          satellite[1] - cameraOffset[1] * modelPixelsPerMeter,
        ];
      };
      orbitSatellite3dRef.current?.updatePose({
        x: satellite[0],
        y: satellite[1],
        width,
        height,
        pixelSize: satSize,
        visible: atlasDeployed && !satelliteBehindEarth,
        bodyXAxis: cameraBasisVector(current.bodyXAxis),
        bodyYAxis: cameraBasisVector(current.bodyYAxis),
        bodyZAxis: cameraBasisVector(current.bodyZAxis),
        sunDirection: cameraBasisVector(lockedSunVector),
        sunlightFactor: current.shadowFactor,
      });
      if (!satelliteBehindEarth && !atlasDeployed) {
        const screenDirection = (vector: Vector3, fallback: Vector3): Vector3 => {
          const transformed = cameraBasisVector(vector);
          return normalize([transformed[0], -transformed[1], 0], fallback);
        };
        const bodyX = screenDirection(current.bodyXAxis, [1, 0, 0]);
        const bodyZ = screenDirection(current.bodyZAxis, [-bodyX[1], bodyX[0], 0]);
        const panelSpan3d = normalize(cross(current.hingeAxis, current.panelNormal), current.bodyYAxis);
        const panelSpan = screenDirection(panelSpan3d, [bodyX[0], bodyX[1], 0]);
        const panelHinge = screenDirection(current.hingeAxis, [-panelSpan[1], panelSpan[0], 0]);
        const panelFrontVisible = orbitCameraMode === "FOLLOW"
          ? dot(current.panelNormal, cameraDepth) >= 0
          : rotate(current.panelNormal)[2] >= 0;
        const wingSides = mission.wingLayout === "DUAL" ? [-1, 1] : [1];

        context.save();
        wingSides.forEach((side) => {
          const boomEnd: [number, number] = [
            satellite[0] + panelSpan[0] * side * satSize * 0.85,
            satellite[1] + panelSpan[1] * side * satSize * 0.85,
          ];
          context.strokeStyle = "rgba(196, 214, 214, 0.82)";
          context.lineWidth = 1.4;
          context.beginPath();
          context.moveTo(satellite[0], satellite[1]);
          context.lineTo(boomEnd[0], boomEnd[1]);
          context.stroke();
          const segmentCount = atlasDeployed ? 4 : 1;
          const segmentLength = atlasDeployed ? 0.48 : 1.52;
          const segmentGap = atlasDeployed ? 0.055 : 0;
          const innerOffset = atlasDeployed ? 0.92 : 0.96;
          const panelHalfWidth = atlasDeployed ? 0.37 : 0.34;
          for (let segment = 0; segment < segmentCount; segment += 1) {
            const distance = innerOffset + segmentLength / 2 + segment * (segmentLength + segmentGap);
            const panelCenter: [number, number] = [
              satellite[0] + panelSpan[0] * side * satSize * distance,
              satellite[1] + panelSpan[1] * side * satSize * distance,
            ];
            const halfLength = segmentLength / 2;
            const corners: Array<[number, number]> = [
              [panelCenter[0] - panelSpan[0] * side * satSize * halfLength - panelHinge[0] * satSize * panelHalfWidth, panelCenter[1] - panelSpan[1] * side * satSize * halfLength - panelHinge[1] * satSize * panelHalfWidth],
              [panelCenter[0] + panelSpan[0] * side * satSize * halfLength - panelHinge[0] * satSize * panelHalfWidth, panelCenter[1] + panelSpan[1] * side * satSize * halfLength - panelHinge[1] * satSize * panelHalfWidth],
              [panelCenter[0] + panelSpan[0] * side * satSize * halfLength + panelHinge[0] * satSize * panelHalfWidth, panelCenter[1] + panelSpan[1] * side * satSize * halfLength + panelHinge[1] * satSize * panelHalfWidth],
              [panelCenter[0] - panelSpan[0] * side * satSize * halfLength + panelHinge[0] * satSize * panelHalfWidth, panelCenter[1] - panelSpan[1] * side * satSize * halfLength + panelHinge[1] * satSize * panelHalfWidth],
            ];
            context.fillStyle = panelFrontVisible ? "rgba(22, 91, 137, 0.97)" : "rgba(47, 62, 72, 0.95)";
            context.strokeStyle = atlasDeployed ? "rgba(111, 205, 220, 0.88)" : satColor;
            context.lineWidth = atlasDeployed ? 0.8 : 1;
            context.beginPath();
            corners.forEach((corner, index) => index === 0 ? context.moveTo(corner[0], corner[1]) : context.lineTo(corner[0], corner[1]));
            context.closePath();
            context.fill();
            context.stroke();
            if (atlasDeployed) {
              context.strokeStyle = "rgba(143, 202, 219, 0.32)";
              context.beginPath();
              context.moveTo((corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2);
              context.lineTo((corners[3][0] + corners[2][0]) / 2, (corners[3][1] + corners[2][1]) / 2);
              context.stroke();
            }
          }
        });

        const busHalfX = atlasDeployed ? 0.57 : 0.62;
        const busHalfZ = atlasDeployed ? 0.73 : 0.52;
        const busCorners: Array<[number, number]> = [
          [satellite[0] - bodyX[0] * satSize * busHalfX - bodyZ[0] * satSize * busHalfZ, satellite[1] - bodyX[1] * satSize * busHalfX - bodyZ[1] * satSize * busHalfZ],
          [satellite[0] + bodyX[0] * satSize * busHalfX - bodyZ[0] * satSize * busHalfZ, satellite[1] + bodyX[1] * satSize * busHalfX - bodyZ[1] * satSize * busHalfZ],
          [satellite[0] + bodyX[0] * satSize * busHalfX + bodyZ[0] * satSize * busHalfZ, satellite[1] + bodyX[1] * satSize * busHalfX + bodyZ[1] * satSize * busHalfZ],
          [satellite[0] - bodyX[0] * satSize * busHalfX + bodyZ[0] * satSize * busHalfZ, satellite[1] - bodyX[1] * satSize * busHalfX + bodyZ[1] * satSize * busHalfZ],
        ];
        context.fillStyle = "#bdcdd0";
        context.strokeStyle = "rgba(230, 240, 239, 0.82)";
        context.beginPath();
        busCorners.forEach((corner, index) => index === 0 ? context.moveTo(corner[0], corner[1]) : context.lineTo(corner[0], corner[1]));
        context.closePath();
        context.fill();
        context.stroke();
        if (atlasDeployed) {
          const payloadCenter: [number, number] = [
            satellite[0] - bodyZ[0] * satSize * 0.77,
            satellite[1] - bodyZ[1] * satSize * 0.77,
          ];
          context.fillStyle = "#12262f";
          context.strokeStyle = "#58a8c8";
          context.lineWidth = 1;
          context.beginPath();
          context.arc(payloadCenter[0], payloadCenter[1], satSize * 0.22, 0, Math.PI * 2);
          context.fill();
          context.stroke();
          context.fillStyle = "rgba(80, 166, 198, 0.75)";
          context.beginPath();
          context.arc(payloadCenter[0], payloadCenter[1], satSize * 0.11, 0, Math.PI * 2);
          context.fill();
        }
        context.shadowColor = satColor;
        context.shadowBlur = 18;
        context.strokeStyle = satColor;
        context.beginPath();
        context.arc(satellite[0], satellite[1], satSize * 2.5, 0, Math.PI * 2);
        context.stroke();
        context.shadowBlur = 0;
        drawVelocityVectors();
        context.restore();
      }
      if (!satelliteBehindEarth && atlasDeployed) {
        drawVelocityVectors();
      }

      for (const { visual, opacity } of operationLayers) {
        if (satelliteBehindEarth || visual === "NOMINAL" || opacity <= 0.001) continue;
        context.save();
        context.globalAlpha *= opacity;
        const forward2d = normalize([velocityEnd[0] - satellite[0], velocityEnd[1] - satellite[1], 0], [1, 0, 0]);
        const toEarth2d = normalize([earthCenter[0] - satellite[0], earthCenter[1] - satellite[1], 0], [0, 1, 0]);
        const phase = ((current.tSec / Math.max(dt, 0.001)) * 0.37 + currentIndex * 0.17) % 1;
        if (visual === "PROPULSION") {
          const plumeLength = satSize * (2.1 + phase * 0.9);
          const perpendicular2d: Vector3 = [-forward2d[1], forward2d[0], 0];
          const plumeTip: [number, number] = [satellite[0] - forward2d[0] * plumeLength, satellite[1] - forward2d[1] * plumeLength];
          const plume = context.createLinearGradient(satellite[0], satellite[1], plumeTip[0], plumeTip[1]);
          plume.addColorStop(0, "rgba(223, 244, 255, 0.95)");
          plume.addColorStop(0.38, "rgba(83, 183, 255, 0.82)");
          plume.addColorStop(1, "rgba(76, 126, 255, 0)");
          context.fillStyle = plume;
          context.beginPath();
          context.moveTo(satellite[0] + perpendicular2d[0] * satSize * 0.34, satellite[1] + perpendicular2d[1] * satSize * 0.34);
          context.lineTo(plumeTip[0], plumeTip[1]);
          context.lineTo(satellite[0] - perpendicular2d[0] * satSize * 0.34, satellite[1] - perpendicular2d[1] * satSize * 0.34);
          context.closePath();
          context.fill();
        } else if (visual === "IMAGING" || visual === "GEOPOINTING") {
          const beamSourceBody = orbitSpacecraft
            ? operationBeamSourceBody(orbitSpacecraft, visual)
            : ([0, 0, 0] satisfies Vector3);
          const beamSource = spacecraftBodyPointToScreen(beamSourceBody);
          const payloadTargetWorld = rayEarthIntersection(current.positionKm, current.payloadBoresight)
            ?? add(current.positionKm, scale(normalize(current.payloadBoresight), maxRadius * 0.45));
          const payloadTarget = project(payloadTargetWorld);
          const target: [number, number] = [payloadTarget[0], payloadTarget[1]];
          const imaging = visual === "IMAGING";
          const payloadDirection2d = normalize([target[0] - beamSource[0], target[1] - beamSource[1], 0], toEarth2d);
          const perpendicular2d: Vector3 = [-payloadDirection2d[1], payloadDirection2d[0], 0];
          const beamHalfWidth = imaging ? 14 : 9;
          context.fillStyle = imaging ? "rgba(74, 222, 139, 0.13)" : "rgba(75, 166, 255, 0.13)";
          context.beginPath();
          context.moveTo(beamSource[0], beamSource[1]);
          context.lineTo(target[0] + perpendicular2d[0] * beamHalfWidth, target[1] + perpendicular2d[1] * beamHalfWidth);
          context.lineTo(target[0] - perpendicular2d[0] * beamHalfWidth, target[1] - perpendicular2d[1] * beamHalfWidth);
          context.closePath();
          context.fill();
          context.strokeStyle = imaging ? "rgba(78, 225, 145, 0.9)" : "rgba(78, 169, 255, 0.92)";
          context.lineWidth = 1.2;
          context.beginPath();
          context.moveTo(beamSource[0], beamSource[1]);
          context.lineTo(target[0], target[1]);
          context.stroke();
          const pulseX = beamSource[0] + (target[0] - beamSource[0]) * (0.25 + phase * 0.7);
          const pulseY = beamSource[1] + (target[1] - beamSource[1]) * (0.25 + phase * 0.7);
          context.fillStyle = imaging ? "#62e79b" : "#61b4ff";
          context.beginPath();
          context.arc(pulseX, pulseY, 2.2, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.arc(target[0], target[1], 5 + phase * 3, 0, Math.PI * 2);
          context.stroke();
        } else if (visual === "TRANSITION") {
          context.strokeStyle = "rgba(242, 180, 90, 0.88)";
          context.lineWidth = 1.2;
          context.setLineDash([5, 4]);
          context.beginPath();
          context.arc(satellite[0], satellite[1], satSize * 3.1, phase * Math.PI * 2, phase * Math.PI * 2 + Math.PI * 1.45);
          context.stroke();
          context.setLineDash([]);
        }
        context.restore();
      }

      context.fillStyle = "rgba(217, 239, 237, 0.65)";
      context.font = "500 11px var(--font-geist-mono), monospace";
      const cameraLabel = orbitCameraMode === "FOLLOW"
        ? "ORBIT FOLLOW / TRAILING PERSPECTIVE CAMERA"
        : `${Math.round(zoom * 100)}% VIEW · ALTITUDE ×${orbitRadiusScale.toFixed(1)} VISUAL`;
      const footerLabel = isDilReplay
        ? `DIL TRACK · ${cameraLabel}`
        : `REV ${Math.floor(currentIndex / samplesPerOrbit) + 1} · 1-REV TRAIL · ${cameraLabel}`;
      context.textAlign = "right";
      context.fillText(footerLabel, width - 18, height - 18);
      context.textAlign = "start";
    } else {
      faceHitRegions.current = [];
      const center: [number, number] = [width * 0.5, height * 0.52];
      const bodyScale = Math.min(width, height) / 210;
      const project = (vector: Vector3): [number, number, number] => {
        const transformed = rotate(vector);
        return [
          center[0] + transformed[0] * bodyScale,
          center[1] - transformed[1] * bodyScale,
          transformed[2],
        ];
      };
      const busVertices: Vector3[] = [
        [-24, -18, -16], [24, -18, -16], [24, 18, -16], [-24, 18, -16],
        [-24, -18, 16], [24, -18, 16], [24, 18, 16], [-24, 18, 16],
      ];
      const faces: Array<{ indices: number[]; axis: SignedAxis; depth: number }> = [
        { indices: [0, 1, 2, 3], axis: "-Z" as SignedAxis },
        { indices: [4, 5, 6, 7], axis: "+Z" as SignedAxis },
        { indices: [0, 1, 5, 4], axis: "-Y" as SignedAxis },
        { indices: [2, 3, 7, 6], axis: "+Y" as SignedAxis },
        { indices: [1, 2, 6, 5], axis: "+X" as SignedAxis },
        { indices: [0, 3, 7, 4], axis: "-X" as SignedAxis },
      ].map((face) => ({
        ...face,
        depth: face.indices.reduce((sum, index) => sum + rotate(busVertices[index])[2], 0) / 4,
      })).sort((a, b) => a.depth - b.depth);

      faces.forEach((face, faceIndex) => {
        const projected = face.indices.map((index) => project(busVertices[index]));
        const hitPolygon = projected.map((point) => [point[0], point[1]] as [number, number]);
        faceHitRegions.current.push({ axis: face.axis, polygon: hitPolygon });
        const isSelected = mission.panelFacingAxis === face.axis;
        const faceGradient = context.createLinearGradient(projected[0][0], projected[0][1], projected[2][0], projected[2][1]);
        faceGradient.addColorStop(0, isSelected ? "#21585a" : faceIndex % 2 ? "#4b514b" : "#26383e");
        faceGradient.addColorStop(0.48, isSelected ? "#2e8582" : faceIndex % 2 ? "#8b7852" : "#40545a");
        faceGradient.addColorStop(1, "#17262c");
        context.fillStyle = faceGradient;
        context.strokeStyle = isSelected ? "#64e4df" : "rgba(193, 224, 220, 0.62)";
        context.lineWidth = isSelected ? 2 : 1;
        context.beginPath();
        projected.forEach((point, index) => {
          if (index === 0) context.moveTo(point[0], point[1]);
          else context.lineTo(point[0], point[1]);
        });
        context.closePath();
        context.fill();
        context.stroke();
        const labelX = projected.reduce((sum, point) => sum + point[0], 0) / projected.length;
        const labelY = projected.reduce((sum, point) => sum + point[1], 0) / projected.length;
        context.fillStyle = isSelected ? "#d8fffc" : "rgba(221, 238, 236, 0.72)";
        context.font = "700 9px var(--font-geist-mono), monospace";
        context.textAlign = "center";
        context.fillText(face.axis, labelX, labelY + 3);
        context.textAlign = "left";
      });

      const busEdges: Array<[number, number]> = [[0, 6], [1, 7], [3, 5], [2, 4]];
      context.strokeStyle = "rgba(235, 185, 94, 0.48)";
      context.lineWidth = 0.8;
      busEdges.forEach(([fromIndex, toIndex]) => {
        const from = project(busVertices[fromIndex]);
        const to = project(busVertices[toIndex]);
        context.beginPath();
        context.moveTo(from[0], from[1]);
        context.lineTo(to[0], to[1]);
        context.stroke();
      });

      const hinge = normalize(current.hingeBody);
      const deployedNormal = normalize(current.panelNormalBody, [0, 0, 1]);
      const normal = normalize(rotateAround(deployedNormal, hinge, -(1 - deploymentProgress) * Math.PI / 2));
      const span = normalize(cross(hinge, normal), [1, 0, 0]);
      const wingSides = mission.wingLayout === "DUAL" ? [-1, 1] : [1];
      wingSides.forEach((side) => {
        const centerPanel = scale(span, side * 60);
        const boomStart = project(scale(span, side * 25));
        const boomEnd = project(scale(span, side * 30));
        context.strokeStyle = "#c0c9c8";
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(boomStart[0], boomStart[1]);
        context.lineTo(boomEnd[0], boomEnd[1]);
        context.stroke();
        const corners = [
          add(add(centerPanel, scale(span, -32)), scale(hinge, -18)),
          add(add(centerPanel, scale(span, 32)), scale(hinge, -18)),
          add(add(centerPanel, scale(span, 32)), scale(hinge, 18)),
          add(add(centerPanel, scale(span, -32)), scale(hinge, 18)),
        ].map(project);
        const panelGradient = context.createLinearGradient(corners[0][0], corners[0][1], corners[2][0], corners[2][1]);
        panelGradient.addColorStop(0, "rgba(20, 73, 117, 0.96)");
        panelGradient.addColorStop(0.52, "rgba(27, 120, 148, 0.96)");
        panelGradient.addColorStop(1, "rgba(10, 51, 91, 0.98)");
        context.fillStyle = panelGradient;
        context.strokeStyle = "#75deda";
        context.lineWidth = 1.3;
        context.beginPath();
        corners.forEach((point, index) => {
          if (index === 0) context.moveTo(point[0], point[1]);
          else context.lineTo(point[0], point[1]);
        });
        context.closePath();
        context.fill();
        context.stroke();
        context.strokeStyle = "rgba(195, 238, 235, 0.32)";
        context.lineWidth = 0.65;
        for (let column = 1; column < 8; column += 1) {
          const ratio = column / 8;
          const topX = corners[0][0] + (corners[1][0] - corners[0][0]) * ratio;
          const topY = corners[0][1] + (corners[1][1] - corners[0][1]) * ratio;
          const bottomX = corners[3][0] + (corners[2][0] - corners[3][0]) * ratio;
          const bottomY = corners[3][1] + (corners[2][1] - corners[3][1]) * ratio;
          context.beginPath();
          context.moveTo(topX, topY);
          context.lineTo(bottomX, bottomY);
          context.stroke();
        }
        for (let row = 1; row < 3; row += 1) {
          const ratio = row / 3;
          const leftX = corners[0][0] + (corners[3][0] - corners[0][0]) * ratio;
          const leftY = corners[0][1] + (corners[3][1] - corners[0][1]) * ratio;
          const rightX = corners[1][0] + (corners[2][0] - corners[1][0]) * ratio;
          const rightY = corners[1][1] + (corners[2][1] - corners[1][1]) * ratio;
          context.beginPath();
          context.moveTo(leftX, leftY);
          context.lineTo(rightX, rightY);
          context.stroke();
        }
      });

      const mastBase = project([0, 0, 16]);
      const mastTop = project([0, 0, 34]);
      context.strokeStyle = "#d5dbd7";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(mastBase[0], mastBase[1]);
      context.lineTo(mastTop[0], mastTop[1]);
      context.stroke();
      context.fillStyle = "#c9d3d1";
      context.strokeStyle = "#70888a";
      context.lineWidth = 1;
      context.beginPath();
      context.ellipse(mastTop[0], mastTop[1], 12 * bodyScale / 2.4, 5 * bodyScale / 2.4, 0, 0, Math.PI * 2);
      context.fill();
      context.stroke();

      const origin = project([0, 0, 0]);
      const vectorArrow = (vector: Vector3, length: number, color: string, label: string, lineWidth = 2) => {
        const end = project(scale(normalize(vector), length));
        drawArrow(context, [origin[0], origin[1]], [end[0], end[1]], color, label, lineWidth);
      };
      vectorArrow(current.bodySun, 86, "#f7b957", "");
      vectorArrow(current.bodyVelocity, 72, "#d3efed", "V", 1.1);
      vectorArrow(current.bodyNadir, 68, "#6ca9ff", "NADIR");
      vectorArrow(current.payloadBoresightBody, 76, "#ff8a34", "PAYLOAD");
      vectorArrow(normal, 57, "#58e1dd", "CELL +N");
      vectorArrow([1, 0, 0], 43, "#ef795e", "+X");
      vectorArrow([0, 1, 0], 43, "#51d9d4", "+Y");
      vectorArrow([0, 0, 1], 43, "#a28af8", "+Z");
      for (const { visual, opacity } of operationLayers) {
        if (visual === "NOMINAL" || opacity <= 0.001) continue;
        context.save();
        context.globalAlpha *= opacity;
        const phase = (currentIndex * 0.31 + current.tSec * 0.03) % 1;
        if (visual === "PROPULSION") {
          const exhaust = normalize(scale(current.bodyVelocity, -1), [-1, 0, 0]);
          const exhaustEnd = project(scale(exhaust, 64 + phase * 18));
          const exhaustBase = project(scale(exhaust, 23));
          const direction = normalize([exhaustEnd[0] - exhaustBase[0], exhaustEnd[1] - exhaustBase[1], 0]);
          const perpendicular2d: Vector3 = [-direction[1], direction[0], 0];
          context.fillStyle = "rgba(72, 166, 255, 0.56)";
          context.beginPath();
          context.moveTo(exhaustBase[0] + perpendicular2d[0] * 8, exhaustBase[1] + perpendicular2d[1] * 8);
          context.lineTo(exhaustEnd[0], exhaustEnd[1]);
          context.lineTo(exhaustBase[0] - perpendicular2d[0] * 8, exhaustBase[1] - perpendicular2d[1] * 8);
          context.closePath();
          context.fill();
        } else if (visual === "IMAGING" || visual === "GEOPOINTING") {
          const target = project(scale(normalize(current.payloadBoresightBody), 118));
          const imaging = visual === "IMAGING";
          const direction = normalize([target[0] - origin[0], target[1] - origin[1], 0], [0, 1, 0]);
          const perpendicular2d: Vector3 = [-direction[1], direction[0], 0];
          const beamHalfWidth = imaging ? 14 : 9;
          context.fillStyle = imaging ? "rgba(74, 222, 139, 0.14)" : "rgba(75, 166, 255, 0.14)";
          context.beginPath();
          context.moveTo(origin[0], origin[1]);
          context.lineTo(target[0] + perpendicular2d[0] * beamHalfWidth, target[1] + perpendicular2d[1] * beamHalfWidth);
          context.lineTo(target[0] - perpendicular2d[0] * beamHalfWidth, target[1] - perpendicular2d[1] * beamHalfWidth);
          context.closePath();
          context.fill();
          context.strokeStyle = imaging ? "rgba(78, 225, 145, 0.92)" : "rgba(78, 169, 255, 0.94)";
          context.lineWidth = 1.2;
          context.beginPath();
          context.moveTo(origin[0], origin[1]);
          context.lineTo(target[0], target[1]);
          context.stroke();
          const pulseX = origin[0] + (target[0] - origin[0]) * (0.25 + phase * 0.7);
          const pulseY = origin[1] + (target[1] - origin[1]) * (0.25 + phase * 0.7);
          context.fillStyle = imaging ? "#62e79b" : "#61b4ff";
          context.beginPath();
          context.arc(pulseX, pulseY, 2.4, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.arc(target[0], target[1], 7 + phase * 4, 0, Math.PI * 2);
          context.stroke();
        } else if (visual === "TRANSITION") {
          context.strokeStyle = "rgba(242, 180, 90, 0.9)";
          context.lineWidth = 1.4;
          context.setLineDash([6, 4]);
          context.beginPath();
          context.arc(origin[0], origin[1], 58 * bodyScale / 2.4, phase * Math.PI * 2, phase * Math.PI * 2 + Math.PI * 1.5);
          context.stroke();
          context.setLineDash([]);
        }
        context.restore();
      }
      context.fillStyle = "rgba(217, 239, 237, 0.65)";
      context.font = "500 11px var(--font-geist-mono), monospace";
      context.fillText(`FIXED TO SPACECRAFT · DEPLOY ${(deploymentProgress * 90).toFixed(0)}° · ${mission.wingLayout} WING`, 20, height - 18);
      context.fillText("Arcball drag to rotate", width - 148, height - 18);
    }
  }, [currentIndex, deploymentProgress, earthTextureReady, followOrbitAngles, followSatellite, illuminationEpochMs, isDilReplay, lockedSunVector, mission, mode, operationTransition, orbitCameraMode, orbitMetadata, orbitRadiusScale, orbitSpacecraft, pan, points, size, viewRotation, zoom]);

  return (
    <div className="orbit-stage">
      <canvas
        ref={canvasRef}
        className={`space-canvas${mode === "ORBIT" && panEnabled ? " is-pan-mode" : ""}${mode === "ORBIT" && followSatellite && !panEnabled ? " is-follow-rotate" : ""}${mode === "SPACECRAFT" ? " is-face-picker" : ""}`}
        aria-label={mode === "ORBIT" ? "Interactive three-dimensional Earth and locked orbit scene" : "Interactive spacecraft and solar-panel vector view"}
        onPointerDown={(event) => {
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
            arcball: arcballPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()),
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const dx = event.clientX - drag.current.x;
          const dy = event.clientY - drag.current.y;
          drag.current.x = event.clientX;
          drag.current.y = event.clientY;
          drag.current.moved = drag.current.moved || Math.hypot(event.clientX - drag.current.startX, event.clientY - drag.current.startY) > 4;
          if (mode === "ORBIT" && panEnabled) {
            setPan((value) => ({ x: value.x + dx, y: value.y + dy }));
          } else if (mode === "ORBIT" && followSatellite) {
            setFollowOrbitAngles((value) => ({
              yaw: value.yaw - dx * 0.007,
              pitch: clamp(value.pitch + dy * 0.007, -1.22, 1.22),
            }));
          } else {
            const nextArcball = arcballPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
            const delta = quaternionFromArc(drag.current.arcball, nextArcball);
            drag.current.arcball = nextArcball;
            setViewRotation((value) => multiplyQuaternions(delta, value));
          }
        }}
        onPointerUp={(event) => {
          const dragState = drag.current;
          drag.current = null;
          if (mode !== "SPACECRAFT" || !dragState || dragState.moved) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const point: [number, number] = [event.clientX - bounds.left, event.clientY - bounds.top];
          const region = [...faceHitRegions.current].reverse().find((candidate) => pointInPolygon(point, candidate.polygon));
          if (region) onAxisChange(region.axis);
        }}
        onPointerCancel={() => { drag.current = null; }}
      />
      {mode === "ORBIT" && orbitSpacecraft && activePoint && (
        <OrbitSatellite3DOverlay
          ref={orbitSatellite3dRef}
          satellite={orbitSpacecraft}
          mission={mission}
          panelNormalBody={activePoint.panelNormalBody}
        />
      )}
      {mode === "ORBIT" && (
        <div className="camera-controls" aria-label="Orbit camera controls">
          <button type="button" onClick={() => setZoom((value) => clamp(value / 1.25, 0.65, 12))} aria-label="Zoom out">−</button>
          <span>{zoom.toFixed(1)}x</span>
          <button type="button" onClick={() => setZoom((value) => clamp(value * 1.25, 0.65, 12))} aria-label="Zoom in">+</button>
          <button type="button" onClick={resetView}>Reset view</button>
          <button type="button" className={panEnabled ? "active" : ""} onClick={() => setPanEnabled((value) => !value)}>Pan</button>
          <button
            type="button"
            onClick={() => setOrbitRadiusScale((value) => ORBIT_RADIUS_SCALES[(ORBIT_RADIUS_SCALES.indexOf(value as (typeof ORBIT_RADIUS_SCALES)[number]) + 1) % ORBIT_RADIUS_SCALES.length])}
            title="Visual-only altitude exaggeration; mission calculations are unchanged"
          >
            Orbit radius {orbitRadiusScale.toFixed(1)}×
          </button>
          <button type="button" className={orbitCameraMode === "FOLLOW" ? "active" : ""} onClick={() => { setOrbitCameraMode((value) => value === "FOLLOW" ? "FREE" : "FOLLOW"); setPanEnabled(false); setPan({ x: 0, y: 0 }); setFollowOrbitAngles({ yaw: 0, pitch: 0 }); }}>Orbit follow</button>
          <button type="button" className={followSatellite && !panEnabled ? "active" : ""} disabled={!followSatellite} onClick={() => setPanEnabled(false)} title="Drag the orbit view to circle around the followed satellite">3D rotate</button>
          <em>{followSatellite ? "Drag · rotate · Ctrl + wheel" : "Ctrl + wheel"}</em>
        </div>
      )}
      {mode === "SPACECRAFT" && (
        <div className="spacecraft-tools" aria-label="Interactive spacecraft face assignment">
          <div className="face-assignment-controls">
            <span>Click a labelled spacecraft face to set the active solar-cell side</span>
            <em>{mission.panelFacingAxis} cell-facing face selected</em>
          </div>
          <div className="deployment-controls">
            <button type="button" onClick={resetView}>Reset 3D view</button>
            <button type="button" onClick={replayDeployment}>Replay deployment</button>
            <span>{(deploymentProgress * 90).toFixed(0)}° deployed</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PowerChart({
  points,
  currentIndex,
  dilRecords,
  dilPowerLabel = "DIL-derived",
  showSoc = true,
}: {
  points: SimulationPoint[];
  currentIndex: number;
  dilRecords?: DilRecord[];
  dilPowerLabel?: string;
  showSoc?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(canvasRef);
  const [hover, setHover] = useState<{ index: number; x: number; y: number; side: "left" | "right" } | null>(null);
  const isDilReplay = Boolean(dilRecords?.length);
  const chartModel = useMemo(() => {
    let maxPower = 1;
    for (const point of points) {
      maxPower = Math.max(maxPower, point.powerW, point.measuredPowerW ?? 0, point.perfectPointingPowerW ?? 0, point.operationLoadW ?? 0);
    }
    return {
      sampledPoints: decimateSimulationPoints(points, 1800),
      maxPower: maxPower * 1.08,
      maxTime: Math.max(1e-9, points[points.length - 1]?.tSec ?? 0),
    };
  }, [points]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !points.length) return;
    const { width, height, dpr } = size;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const left = 54;
    const right = 52;
    const top = 28;
    const bottom = 42;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const { maxPower, maxTime, sampledPoints } = chartModel;
    const x = (time: number) => left + (time / maxTime) * plotWidth;
    const yPower = (power: number) => top + plotHeight - (power / maxPower) * plotHeight;
    const ySoc = (soc: number) => top + plotHeight - (soc / 100) * plotHeight;

    context.fillStyle = "#0b181c";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "rgba(158, 197, 199, 0.12)";
    context.lineWidth = 1;
    context.font = "10px var(--font-geist-mono), monospace";
    context.fillStyle = "rgba(203, 228, 228, 0.55)";
    for (let row = 0; row <= 4; row += 1) {
      const yy = top + (plotHeight * row) / 4;
      context.beginPath();
      context.moveTo(left, yy);
      context.lineTo(width - right, yy);
      context.stroke();
      context.textAlign = "right";
      context.fillText(`${Math.round(maxPower * (1 - row / 4))}`, left - 9, yy + 3);
    }
    for (let column = 0; column <= 4; column += 1) {
      const xx = left + (plotWidth * column) / 4;
      context.beginPath();
      context.moveTo(xx, top);
      context.lineTo(xx, top + plotHeight);
      context.stroke();
      const tickSeconds = (maxTime * column) / 4;
      const tickLabel = maxTime >= 86400
        ? `${(tickSeconds / 86400).toFixed(1)}d`
        : maxTime >= 7200
          ? `${(tickSeconds / 3600).toFixed(1)}h`
          : `${Math.round(tickSeconds / 60)}m`;
      context.textAlign = column === 0 ? "left" : column === 4 ? "right" : "center";
      context.fillText(tickLabel, xx, height - 14);
    }

    const primaryPower = (point: SimulationPoint) => isDilReplay ? (point.measuredPowerW ?? 0) : point.powerW;
    const powerGradient = context.createLinearGradient(0, top, 0, top + plotHeight);
    powerGradient.addColorStop(0, isDilReplay ? "rgba(115, 242, 218, 0.42)" : "rgba(73, 217, 212, 0.38)");
    powerGradient.addColorStop(1, isDilReplay ? "rgba(115, 242, 218, 0.02)" : "rgba(73, 217, 212, 0.015)");
    context.beginPath();
    context.moveTo(x(sampledPoints[0].tSec), top + plotHeight);
    sampledPoints.forEach((point) => context.lineTo(x(point.tSec), yPower(primaryPower(point))));
    context.lineTo(x(maxTime), top + plotHeight);
    context.closePath();
    context.fillStyle = powerGradient;
    context.fill();
    context.beginPath();
    sampledPoints.forEach((point, index) => {
      const xx = x(point.tSec);
      const yy = yPower(primaryPower(point));
      if (index === 0) context.moveTo(xx, yy);
      else context.lineTo(xx, yy);
    });
    context.strokeStyle = isDilReplay ? "#73f2da" : "#50dcd7";
    context.lineWidth = isDilReplay ? 2.2 : 1.8;
    context.stroke();

    if (isDilReplay) {
      context.beginPath();
      sampledPoints.forEach((point, index) => {
        const xx = x(point.tSec);
        const yy = yPower(point.powerW);
        if (index === 0) context.moveTo(xx, yy);
        else context.lineTo(xx, yy);
      });
      context.strokeStyle = "rgba(255, 138, 101, 0.92)";
      context.lineWidth = 1.25;
      context.setLineDash([6, 5]);
      context.stroke();
      context.setLineDash([]);
    }

    if (sampledPoints.some((point) => point.perfectPointingPowerW !== undefined)) {
      context.beginPath();
      sampledPoints.forEach((point, index) => {
        const xx = x(point.tSec);
        const yy = yPower(point.perfectPointingPowerW ?? 0);
        if (index === 0) context.moveTo(xx, yy);
        else context.lineTo(xx, yy);
      });
      context.strokeStyle = "#c7a6ff";
      context.lineWidth = 1.2;
      context.setLineDash([2, 4]);
      context.stroke();
      context.setLineDash([]);
    }

    if (sampledPoints.some((point) => point.operationLoadW !== undefined)) {
      context.beginPath();
      let previousLoadPoint: SimulationPoint | undefined;
      sampledPoints.forEach((point) => {
        if (point.operationLoadW === undefined) {
          previousLoadPoint = undefined;
          return;
        }
        if (!previousLoadPoint || previousLoadPoint.operationLoadW === undefined) {
          context.moveTo(x(point.tSec), yPower(point.operationLoadW));
        } else if (previousLoadPoint.operationLoadW === point.operationLoadW) {
          context.lineTo(x(point.tSec), yPower(point.operationLoadW));
        } else {
          // Energy integration assigns half of a transition interval to each
          // state, so place the visible step at the same interval midpoint.
          const transitionTime = (previousLoadPoint.tSec + point.tSec) / 2;
          context.lineTo(x(transitionTime), yPower(previousLoadPoint.operationLoadW));
          context.lineTo(x(transitionTime), yPower(point.operationLoadW));
          context.lineTo(x(point.tSec), yPower(point.operationLoadW));
        }
        previousLoadPoint = point;
      });
      context.strokeStyle = "#ff7aa8";
      context.lineWidth = 1.8;
      context.stroke();
    }

    if (showSoc) {
      context.beginPath();
      sampledPoints.forEach((point, index) => {
        const xx = x(point.tSec);
        const yy = ySoc(point.socPct);
        if (index === 0) context.moveTo(xx, yy);
        else context.lineTo(xx, yy);
      });
      context.strokeStyle = "#ffd166";
      context.lineWidth = 1.5;
      context.stroke();
    }
    const cursor = points[clamp(currentIndex, 0, points.length - 1)];
    context.strokeStyle = "rgba(255, 255, 255, 0.55)";
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(x(cursor.tSec), top);
    context.lineTo(x(cursor.tSec), top + plotHeight);
    context.stroke();
    context.setLineDash([]);

    if (hover) {
      const hoveredPoint = points[hover.index];
      const hoverX = x(hoveredPoint.tSec);
      context.strokeStyle = "rgba(81, 217, 212, 0.9)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(hoverX, top);
      context.lineTo(hoverX, top + plotHeight);
      context.stroke();
      context.fillStyle = isDilReplay ? "#73f2da" : "#50dcd7";
      context.beginPath();
      context.arc(hoverX, yPower(primaryPower(hoveredPoint)), 3.2, 0, Math.PI * 2);
      context.fill();
      if (hoveredPoint.operationLoadW !== undefined) {
        context.fillStyle = "#ff7aa8";
        context.beginPath();
        context.arc(hoverX, yPower(hoveredPoint.operationLoadW), 3.2, 0, Math.PI * 2);
        context.fill();
      }
      if (showSoc) {
        context.fillStyle = "#ffd166";
        context.beginPath();
        context.arc(hoverX, ySoc(hoveredPoint.socPct), 3.2, 0, Math.PI * 2);
        context.fill();
      }
    }

    context.fillStyle = "rgba(203, 228, 228, 0.62)";
    context.textAlign = "left";
    context.fillText("POWER (W)", left, 15);
    if (showSoc) {
      context.fillStyle = "#ffd166";
      context.textAlign = "right";
      context.fillText("SOC %", width - right, 15);
    }
  }, [chartModel, currentIndex, hover, isDilReplay, points, showSoc, size]);

  const hoveredPoint = hover ? points[hover.index] : null;
  const hoveredRecord = hover ? dilRecords?.[hover.index] : null;
  const hoveredOperation = hoveredRecord?.spacecraftOperation?.trim() || "Analytical propagation";
  const hoveredIllumination = hoveredPoint
    ? hoveredPoint.shadowFactor <= 0.02 ? "Umbra" : hoveredPoint.shadowFactor < 0.98 ? "Penumbra" : "Sunlight"
    : "";
  const hoveredLoadState = hoveredPoint ? dilLoadIlluminationState(hoveredPoint.shadowFactor) : "";

  return (
    <div className="power-chart-interactive">
      <canvas
        ref={canvasRef}
        className="power-chart"
        aria-label={`Interactive ${isDilReplay ? "DIL-derived primary power" : "power"}, battery state-of-charge, and spacecraft operation timeline`}
        onPointerMove={(event) => {
          if (!points.length) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const left = 54;
          const right = 52;
          const plotWidth = Math.max(1, bounds.width - left - right);
          const localX = clamp(event.clientX - bounds.left, left, bounds.width - right);
          const targetTime = ((localX - left) / plotWidth) * chartModel.maxTime;
          let low = 0;
          let high = points.length - 1;
          while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (points[middle].tSec < targetTime) low = middle + 1;
            else high = middle;
          }
          const previous = Math.max(0, low - 1);
          const index = Math.abs(points[previous].tSec - targetTime) <= Math.abs(points[low].tSec - targetTime) ? previous : low;
          setHover({
            index,
            x: localX,
            y: clamp(event.clientY - bounds.top, 66, Math.max(66, bounds.height - 66)),
            side: localX > bounds.width * 0.68 ? "left" : "right",
          });
        }}
        onPointerLeave={() => setHover(null)}
      />
      {hover && hoveredPoint && (
        <div
          className="power-chart-tooltip"
          data-side={hover.side}
          data-operation={classifyOperation(hoveredOperation).toLowerCase()}
          role="tooltip"
          style={{ left: hover.x, top: hover.y }}
        >
          <div className="power-chart-tooltip-head"><span>Operation mode</span><b>{hoveredOperation}</b></div>
          <dl>
            <div><dt>Time</dt><dd>{hoveredRecord?.timeLabel ?? `T+ ${formatDuration(hoveredPoint.tSec)}`}</dd></div>
            {hoveredPoint.measuredPowerW !== undefined && <div><dt>{dilPowerLabel}</dt><dd>{hoveredPoint.measuredPowerW.toFixed(1)} W</dd></div>}
            {hoveredPoint.operationLoadW !== undefined && <div><dt>Maximum load</dt><dd>{hoveredPoint.operationLoadW.toFixed(1)} W</dd></div>}
            {hoveredPoint.netPowerW !== undefined && <div><dt>Net power</dt><dd>{hoveredPoint.netPowerW >= 0 ? "+" : ""}{hoveredPoint.netPowerW.toFixed(1)} W</dd></div>}
            {showSoc && <div><dt>Battery SOC</dt><dd>{hoveredPoint.socPct.toFixed(1)}%</dd></div>}
            <div><dt>Illumination</dt><dd>{hoveredIllumination} · {(hoveredPoint.shadowFactor * 100).toFixed(0)}%</dd></div>
            {hoveredPoint.operationLoadW !== undefined && <div><dt>Load state</dt><dd>{hoveredLoadState}</dd></div>}
          </dl>
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={`number-field${disabled ? " is-disabled" : ""}`}>
      <span>{label}</span>
      <span className="input-shell">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => onChange(clamp(Number(event.target.value), min, max))}
        />
        <em>{unit}</em>
      </span>
    </label>
  );
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "warn" | "good" }) {
  return (
    <article className={`metric${tone ? ` metric-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

type PowerMetricState = "neutral" | "good" | "watch" | "critical";

function PowerMetricCell({
  label,
  value,
  note,
  state,
  status,
}: {
  label: string;
  value: string;
  note: string;
  state: PowerMetricState;
  status: string;
}) {
  const cellRef = useRef<HTMLTableCellElement>(null);
  const previousState = useRef(state);

  useEffect(() => {
    if (previousState.current === state) return;
    previousState.current = state;
    const cell = cellRef.current;
    if (!cell) return;
    cell.classList.remove("is-updating");
    void cell.offsetWidth;
    cell.classList.add("is-updating");
    const timer = window.setTimeout(() => cell.classList.remove("is-updating"), 650);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <td ref={cellRef} data-state={state}>
      <span className="power-metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
      <span className="power-metric-status"><i aria-hidden="true" />{status}</span>
    </td>
  );
}

function Segmented<T extends string>({
  value,
  options,
  labels,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={value === option ? "active" : ""}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

export default function SolarSizingDashboard({ layoutVariant = "cockpit" }: { layoutVariant?: "cockpit" | "legacy" }) {
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>("SIMULATION");
  const [satelliteFocusRequest, setSatelliteFocusRequest] = useState(0);
  const [engineeringView, setEngineeringView] = useState<"ORBIT" | "POWER">("ORBIT");
  const [mission, setMission] = useState(DEFAULT_MISSION);
  const [power, setPower] = useState(DEFAULT_POWER);
  const [simulationSatellite, setSimulationSatellite] = useState<SatelliteInventoryItem>(() =>
    structuredClone(DEFAULT_SIMULATION_SATELLITE),
  );
  const [deployedSpacecraft, setDeployedSpacecraft] = useState<SatelliteInventoryItem>(() =>
    structuredClone(DEFAULT_SIMULATION_SATELLITE),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [dilData, setDilData] = useState<ParsedDilData | null>(null);
  const [dilError, setDilError] = useState("");
  const [dilLoading, setDilLoading] = useState(false);
  const [dilSampleIntervalSec, setDilSampleIntervalSec] = useState("");
  const [dilReferenceAxisOverride, setDilReferenceAxisOverride] = useState<"AUTO" | SignedAxis>("AUTO");
  const [dilOperationMaxLoadInputs, setDilOperationMaxLoadInputs] = useState<Record<string, string>>({});
  const result = useMemo(
    () => runSimulation(mission, power, simulationSatellite.frames.payloadBoresightAxis),
    [mission, power, simulationSatellite.frames.payloadBoresightAxis],
  );
  const configuredEpochMs = new Date(mission.epoch).getTime();
  const illuminationEpochMs = dilData?.epochMs
    ?? (Number.isFinite(configuredEpochMs) ? configuredEpochMs : Date.UTC(2026, 0, 1));
  const dilEnergyAnalysis = useMemo(
    () => dilData ? analyzeDilEnergy(dilData.energySeries, mission, power, dilData.epochMs, dilData.powerSemantics, dilData.referencePanelAxis) : null,
    [dilData, mission, power],
  );
  const dilOperationMaxLoadsW = useMemo(() => Object.fromEntries(
    Object.entries(dilOperationMaxLoadInputs).map(([operation, value]) => [
      operation,
      value.trim() === "" ? undefined : Number(value),
    ]),
  ), [dilOperationMaxLoadInputs]);
  const dilLoadAnalysis = useMemo(
    () => dilEnergyAnalysis ? analyzeDilOperationLoads(dilEnergyAnalysis, dilOperationMaxLoadsW) : null,
    [dilEnergyAnalysis, dilOperationMaxLoadsW],
  );
  const dilLoadProfileComplete = Boolean(dilLoadAnalysis?.complete);
  const dilPoints = useMemo(
    () => dilData ? buildDilSimulation(
      dilData.records,
      mission,
      power,
      dilData.epochMs,
      dilData.powerSemantics,
      dilData.referencePanelAxis,
      simulationSatellite.frames.payloadBoresightAxis,
      dilOperationMaxLoadsW,
      dilLoadProfileComplete,
    ) : null,
    [dilData, dilLoadProfileComplete, dilOperationMaxLoadsW, mission, power, simulationSatellite.frames.payloadBoresightAxis],
  );
  const displayPoints = dilPoints?.length ? dilPoints : result.points;
  const sceneSunVector = useMemo(() => {
    if (dilPoints?.length) return normalize(dilPoints[0].sunVector);
    const epoch = new Date(illuminationEpochMs);
    return sunDirection(Number.isFinite(epoch.getTime()) ? epoch : new Date("2026-01-01T00:00:00Z"));
  }, [dilPoints, illuminationEpochMs]);
  const activeIndex = clamp(currentIndex, 0, displayPoints.length - 1);
  const current = displayPoints[activeIndex];
  const visualPanelIncidenceDeg = Math.acos(clamp(
    dot(normalize(current.panelNormal), sceneSunVector),
    -1,
    1,
  )) * 180 / Math.PI;
  const sunLockDriftDeg = current.attitudeCorrectionDeg
    ?? Math.acos(clamp(dot(normalize(current.sunVector), sceneSunVector), -1, 1)) * 180 / Math.PI;
  const currentDilRecord = dilData?.records[activeIndex] ?? null;
  const dilAxisSweep = useMemo(
    () => dilData ? analyzeDilAxisSweep(dilData.energySeries, mission, power, dilData.epochMs, dilData.referencePanelAxis) : null,
    [dilData, mission, power],
  );
  const dilSummary = useMemo(() => {
    if (!dilPoints?.length || !dilEnergyAnalysis) return null;
    let minSocPct = dilPoints[0].socPct;
    let minPowerW = dilPoints[0].powerW;
    let maxPowerW = dilPoints[0].powerW;
    for (let index = 1; index < dilPoints.length; index += 1) {
      minSocPct = Math.min(minSocPct, dilPoints[index].socPct);
      minPowerW = Math.min(minPowerW, dilPoints[index].powerW);
      maxPowerW = Math.max(maxPowerW, dilPoints[index].powerW);
    }
    return {
      ...dilEnergyAnalysis,
      minSocPct,
      finalSocPct: dilPoints[dilPoints.length - 1].socPct,
      minPowerW,
      maxPowerW,
    };
  }, [dilEnergyAnalysis, dilPoints]);
  const designAxes = dilAxisSweep
    ? dilAxisSweep.map((axis) => ({ ...axis, energyPerOrbitWh: axis.energyWh, minSocPct: 0 }))
    : result.axes;
  const bestAxis = designAxes.find((axis) => axis.rank === 1) ?? designAxes[0];
  const selectedAxis = designAxes.find((axis) => axis.axis === mission.panelFacingAxis) ?? designAxes[0];
  const maxAxisEnergy = Math.max(...designAxes.map((axis) => axis.energyPerOrbitWh), 1);
  const illuminationState = current.shadowFactor <= 0.02
    ? "Umbra"
    : current.shadowFactor < 0.98
      ? "Penumbra"
      : "Sunlight";
  const maximumSafeEccentricity = Math.min(
    0.8,
    Math.max(0, (mission.altitudeKm - 160) / (EARTH_RADIUS_KM + mission.altitudeKm)),
  );
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setCurrentIndex((index) => {
        const candidate = (index + playbackSpeed) % displayPoints.length;
        if (!dilData || candidate <= index) return candidate;
        const currentOperation = dilData.records[index]?.spacecraftOperation;
        for (let next = index + 1; next <= candidate; next += 1) {
          if (dilData.records[next]?.spacecraftOperation !== currentOperation) return next;
        }
        return candidate;
      });
    }, 90);
    return () => window.clearInterval(timer);
  }, [dilData, displayPoints.length, playbackSpeed, playing]);

  const updateMission = <K extends keyof MissionConfig>(key: K, value: MissionConfig[K]) => {
    setCurrentIndex(0);
    setMission((currentMission) => {
      const nextMission = { ...currentMission, [key]: value };
      if (key === "altitudeKm") {
        const altitudeKm = Number(value);
        const maximumEccentricity = Math.min(0.8, Math.max(0, (altitudeKm - 160) / (EARTH_RADIUS_KM + altitudeKm)));
        nextMission.eccentricity = Math.min(nextMission.eccentricity, maximumEccentricity);
      }
      return nextMission;
    });
  };
  const updatePower = <K extends keyof PowerConfig>(key: K, value: PowerConfig[K]) => {
    setCurrentIndex(0);
    setPower((currentPower) => ({ ...currentPower, [key]: value }));
  };

  const applySatelliteConfiguration = (item: SatelliteInventoryItem) => {
    const attitude: AttitudeMode = item.missionDefaults.attitudeMode === "Sun pointing"
      ? "SUN_POINTING"
      : "LVLH";
    const cellModel: Exclude<CellModel, "CUSTOM"> = item.array.cellModel.startsWith("AZUR 4G32")
      ? "AZUR_4G32_ADV_4X8"
      : "AZUR_3G30_ADV_4X8";
    const catalog = CELL_CATALOG[cellModel];
    const solarMountRotation = item.subsystems?.find((subsystem) => subsystem.kind === "solar_array" && subsystem.attached)?.rotationDeg
      ?? { x: 0, y: 0, z: 0 };

    setSimulationSatellite(structuredClone(item));
    setDeployedSpacecraft(structuredClone(item));
    setMission((currentMission) => ({
      ...currentMission,
      attitude,
      panelFacingAxis: item.frames.solarCellNormalAxis,
      velocityBodyAxis: item.frames.velocityAxis,
      nadirBodyAxis: item.frames.nadirAxis,
      panelRotationXDeg: solarMountRotation.x,
      panelRotationYDeg: solarMountRotation.y,
      panelRotationZDeg: solarMountRotation.z,
      wingLayout: item.array.wingLayout === "dual" ? "DUAL" : "SINGLE",
    }));
    setPower((currentPower) => {
      const fluenceE14Cm2 = item.powerDefaults.fluenceE14Cm2 ?? 5;
      const eol = catalog.eol[fluenceE14Cm2] ?? catalog.eol[5];
      return {
        ...currentPower,
        cellModel,
        vmpV: catalog.bol.vmpV,
        impA: catalog.bol.impA,
        vscV: catalog.bol.vocV,
        iscA: catalog.bol.iscA,
        eolVmpV: eol.vmpV,
        eolImpA: eol.impA,
        eolVocV: eol.vocV,
        eolIscA: eol.iscA,
        cellAreaCm2: catalog.cellAreaCm2,
        seriesCells: item.array.seriesCells,
        parallelStrings: item.array.parallelStrings,
        packagingEfficiencyPct: item.array.packagingEfficiency * 100,
        fluenceE14Cm2,
        referenceIrradianceWm2: item.powerDefaults.referenceIrradianceWm2 ?? 1367,
        referenceTemperatureC: item.powerDefaults.referenceTemperatureC ?? 28,
        operatingTemperatureC: item.array.operatingTemperatureC,
        powerTempCoefficientPctC: item.powerDefaults.powerTempCoefficientPctC ?? -0.08,
        pointingErrorDeg: item.powerDefaults.pointingErrorDeg ?? 0,
        angularResponseExponent: item.powerDefaults.angularResponseExponent ?? 1,
        mpptEfficiencyPct: item.powerDefaults.mpptEfficiency * 100,
        harnessEfficiencyPct: (item.powerDefaults.harnessEfficiency ?? 1) * 100,
        mismatchLossPct: item.powerDefaults.mismatchLossPct ?? 0,
        diodeLossPct: item.powerDefaults.diodeLossPct ?? 0,
        contaminationLossPct: item.powerDefaults.contaminationLossPct ?? 0,
        selfShadowLossPct: item.powerDefaults.selfShadowLossPct ?? 0,
        systemLossPct: item.powerDefaults.systemLossPct ?? 12,
      };
    });
    setCurrentIndex(0);
    setPlaying(true);
    setDashboardTab("SIMULATION");
  };

  const choosePreset = (preset: OrbitPreset) => {
    setCurrentIndex(0);
    setMission((currentMission) => ({
      ...currentMission,
      preset,
      altitudeKm: preset === "GEO" ? 35786 : preset === "SSO" ? 550 : 500,
      inclinationDeg: preset === "GEO" ? 0 : preset === "SSO" ? 97.6 : 51.6,
      eccentricity: 0,
      argumentOfPerigeeDeg: 0,
      trueAnomalyDeg: 0,
      attitude: simulationSatellite.missionDefaults.attitudeMode === "Sun pointing"
        ? "SUN_POINTING"
        : "LVLH",
    }));
  };

  const handleDilFile = async (file: File) => {
    setDilError("");
    setDilLoading(true);
    setPlaying(false);
    try {
      const text = await file.text();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
      const requestedInterval = dilSampleIntervalSec.trim() === "" ? undefined : Number(dilSampleIntervalSec);
      const parsed = parseDilData(text, file.name, {
        sampleIntervalSec: requestedInterval,
        referencePanelAxis: dilReferenceAxisOverride === "AUTO" ? undefined : dilReferenceAxisOverride,
      });
      setDilOperationMaxLoadInputs({});
      setDilData(parsed);
      if (parsed.referencePanelAxis) {
        setMission((currentMission) => ({
          ...currentMission,
          panelFacingAxis: parsed.referencePanelAxis as SignedAxis,
          panelRotationXDeg: 0,
          panelRotationYDeg: 0,
          panelRotationZDeg: 0,
        }));
      }
      setCurrentIndex(0);
    } catch (error) {
      setDilOperationMaxLoadInputs({});
      setDilData(null);
      setDilError(error instanceof Error ? error.message : "Unable to parse the selected DIL file.");
    } finally {
      setDilLoading(false);
    }
  };

  const downloadDilTemplate = () => {
    const rows = [
      DIL_TEMPLATE_FIELDS.join(","),
      '01-01-2028 05:30,"[-4438020.84,5254771.61,0]",0,ECLIPSE,-0.101659,30.358629,"[-65816770934.25,58947726557.83,117625372932.45]","[-75.15,-9.60,6878128.64]",0,"[-82.60,-40.18,-90.00]",0.000631,36.912396,+Y,66.378348',
      '01-01-2028 05:30,"[-4430203.74,5260714.34,75490.27]",0,ECLIPSE,0.531305,30.236480,"[-64502864785.37,58948496745.62,118350644789.31]","[392.72,50.18,6878046.17]",0,"[-82.07,-40.10,-90.83]",0.003298,36.439493,+Y,66.378026',
      '01-01-2028 05:31,"[-4421500.00,5265000.00,150700.00]",40.09,TRANSITION,1.164000,30.114000,"[-63180000000,58950000000,119000000000]","[860,110,6877900]",1,"[-81.54,-40.01,-91.65]",0.006100,35.970000,+Y,66.377500',
    ];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "orbit-pwr-dil-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    const header = [
      "time", "elapsed_time_s", "x_eci_km", "y_eci_km", "z_eci_km", "modeled_power_w", "dil_comparison_power_w",
      "perfect_pointing_power_w", "dil_generation_factor_pct", "dil_reference_axis", "spacecraft_operation",
      "load_illumination_state", "operation_max_load_w", "net_power_w", "soc_pct",
      "beta_deg", "incidence_deg", "shadow_factor", "illumination_state", "panel_facing_axis",
      "payload_earth_angle_deg", "payload_sun_angle_deg", "payload_pointing_residual_deg",
      "velocity_body_axis", "nadir_body_axis", "panel_rotation_x_deg",
      "panel_rotation_y_deg", "panel_rotation_z_deg", "panel_mounting", "wing_layout", "cell_model",
      "series_cells", "parallel_strings", "bol_cell_vmp_v", "bol_cell_imp_a", "eol_cell_vmp_v", "eol_cell_imp_a",
      "eol_array_vmp_v", "eol_array_imp_a", "eol_array_power_w",
      "active_cell_area_m2", "packaged_area_m2", "fluence_1e14_cm2",
    ];
    const rows = displayPoints.map((point, index) => [
      dilData?.records[index]?.timeLabel ?? new Date(illuminationEpochMs + point.tSec * 1000).toISOString(),
      point.tSec.toFixed(2), ...point.positionKm.map((value) => value.toFixed(5)),
      point.powerW.toFixed(3), point.measuredPowerW?.toFixed(3) ?? "",
      point.perfectPointingPowerW?.toFixed(3) ?? "", point.dilGenerationFactorPct?.toFixed(4) ?? "",
      dilData?.referencePanelAxis ?? "", dilData?.records[index]?.spacecraftOperation ?? "",
      dilData ? dilLoadIlluminationState(point.shadowFactor) : "",
      point.operationLoadW?.toFixed(3) ?? "", point.netPowerW?.toFixed(3) ?? "",
      dilData && !dilLoadProfileComplete ? "" : point.socPct.toFixed(3), point.betaDeg.toFixed(4),
      point.incidenceDeg.toFixed(4), point.shadowFactor.toFixed(5),
      point.shadowFactor <= 0.02 ? "UMBRA" : point.shadowFactor < 0.98 ? "PENUMBRA" : "SUNLIGHT",
      mission.panelFacingAxis, point.payloadEarthAngleDeg?.toFixed(4) ?? "", point.payloadSunAngleDeg?.toFixed(4) ?? "",
      point.payloadPointingResidualDeg?.toFixed(4) ?? "",
      mission.velocityBodyAxis, mission.nadirBodyAxis,
      mission.panelRotationXDeg, mission.panelRotationYDeg, mission.panelRotationZDeg,
      "FIXED_TO_SPACECRAFT", mission.wingLayout, power.cellModel,
      power.seriesCells, power.parallelStrings, power.vmpV, power.impA, power.eolVmpV, power.eolImpA,
      result.metrics.arrayVmpV.toFixed(3), result.metrics.arrayImpA.toFixed(3),
      result.metrics.eolArrayPowerW.toFixed(3),
      result.metrics.activeCellAreaM2.toFixed(4), result.metrics.packagedAreaM2.toFixed(4),
      power.fluenceE14Cm2.toFixed(3),
    ]);
    const csv = serializeCsv([header, ...rows]);
    const url = URL.createObjectURL(new Blob([UTF8_CSV_BOM, csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = dilData
      ? `orbit-pwr-dil-replay-${dilData.fileName.replace(/\.[^.]+$/, "")}.csv`
      : `orbit-pwr-${mission.preset.toLowerCase()}-${mission.panelFacingAxis.replace("+", "plus-").replace("-", "minus-").toLowerCase()}facing.csv`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const printReport = () => {
    const previousView = engineeringView;
    setEngineeringView("POWER");
    const restoreView = () => setEngineeringView(previousView);
    window.addEventListener("afterprint", restoreView, { once: true });
    window.setTimeout(() => window.print(), 120);
  };

  const dilWorstCaseReady = Boolean(dilSummary && dilLoadAnalysis?.complete);
  const currentOperationMaxLoadW = currentDilRecord
    ? dilOperationMaxLoadsW[dilOperationLoadKey(
        currentDilRecord.spacecraftOperation,
        dilLoadIlluminationState(current.shadowFactor),
      )]
    : undefined;
  const marginPositive = dilSummary
    ? dilWorstCaseReady && (dilLoadAnalysis?.netEnergyWh ?? 0) >= 0
    : result.metrics.energyMarginWh >= 0;
  const batteryHealthy = dilSummary
    ? dilWorstCaseReady && dilSummary.minSocPct >= 20
    : result.metrics.minSocPct >= 20;
  const dilPowerIsFactor = dilData?.powerSemantics === "PERCENT_MAX";
  const dilComparisonLabel = dilPowerIsFactor
    ? `DIL-derived${dilData?.referencePanelAxis ? ` ${dilData.referencePanelAxis}` : ""}`
    : "Measured";
  const dilReferenceAngleActive = Boolean(
    dilData?.referencePanelAxis === mission.panelFacingAxis
    && Math.abs(mission.panelRotationXDeg) < 1e-9
    && Math.abs(mission.panelRotationYDeg) < 1e-9
    && Math.abs(mission.panelRotationZDeg) < 1e-9,
  );
  const dilGeometryConflict = Boolean(
    dilData && (dilData.referenceVectorMaeDeg > 2 || dilData.referenceVectorMismatchPct > 10),
  );

  const batteryMinimumPct = dilSummary?.minSocPct ?? result.metrics.minSocPct;
  const primaryPowerNowW = dilSummary ? (current.measuredPowerW ?? 0) : current.powerW;
  const primaryEnergyPositive = dilSummary
    ? dilWorstCaseReady && (dilLoadAnalysis?.netEnergyWh ?? 0) >= 0
    : marginPositive;
  const powerMetricState: PowerMetricState = dilSummary && !dilWorstCaseReady
    ? "neutral"
    : current.shadowFactor <= 0.02
    ? "neutral"
    : primaryPowerNowW >= (dilSummary ? currentOperationMaxLoadW ?? 0 : power.averageLoadW) ? "good" : "critical";
  const energyMetricState: PowerMetricState = dilSummary && !dilWorstCaseReady
    ? "neutral"
    : primaryEnergyPositive ? "good" : "critical";
  const dilToModeledMetricState: PowerMetricState = !dilSummary
    ? "neutral"
    : dilSummary.measuredToModeledPct >= 90 ? "good" : dilSummary.measuredToModeledPct >= 70 ? "watch" : "critical";
  const batteryMetricState: PowerMetricState = dilSummary && !dilWorstCaseReady
    ? "neutral"
    : batteryMinimumPct >= 40
    ? "good"
    : batteryMinimumPct >= 20 ? "watch" : "critical";

  const renderMissionPowerSummary = (className: string) => (
    <section className={`cockpit-output-metrics ${className}`} aria-label="Mission power summary">
      <table aria-live="polite">
        <tbody>
          <tr>
            <PowerMetricCell
              label={dilData ? `${dilComparisonLabel} power` : "Power now"}
              value={`${primaryPowerNowW.toFixed(0)} W`}
              note={dilData ? `Modeled ${current.powerW.toFixed(0)} W · imported DIL · ${Math.round(current.shadowFactor * 100)}% light` : `Corrected EOL MPP · ${Math.round(current.shadowFactor * 100)}% light · θ ${current.incidenceDeg.toFixed(1)}°`}
              state={powerMetricState}
              status={dilSummary && !dilWorstCaseReady
                ? "Enter operation loads"
                : current.shadowFactor <= 0.02
                  ? "Eclipse"
                  : powerMetricState === "good"
                    ? dilSummary ? "Above max load" : "Nominal"
                    : dilSummary ? "Below max load" : "Below load"}
            />
            <PowerMetricCell
              label={dilData ? `${dilComparisonLabel} energy / span` : "Generated energy / span"}
              value={dilSummary ? `${dilSummary.measuredEnergyWh.toFixed(0)} Wh` : `${result.metrics.energyWh.toFixed(0)} Wh`}
              note={dilSummary ? `Modeled ${dilSummary.modeledEnergyWh.toFixed(0)} Wh · perfect ceiling ${dilSummary.perfectPointingEnergyWh.toFixed(0)} Wh` : `${result.metrics.energyPerOrbitWh.toFixed(0)} Wh/orbit · ${result.metrics.averagePowerW.toFixed(0)} W average`}
              state={energyMetricState}
              status={dilSummary && !dilWorstCaseReady ? "Generation only" : primaryEnergyPositive ? "Positive margin" : "Energy deficit"}
            />
            <PowerMetricCell
              label={dilData ? "Worst-case load / span" : "Eclipse / orbit"}
              value={dilSummary ? dilWorstCaseReady ? `${dilLoadAnalysis?.loadEnergyWh?.toFixed(0)} Wh` : "—" : formatDuration(result.metrics.eclipsePerOrbitSec)}
              note={dilSummary ? dilWorstCaseReady ? `${dilLoadAnalysis?.worstCaseAverageLoadW?.toFixed(1)} W OAP · net ${(dilLoadAnalysis?.netEnergyWh ?? 0) >= 0 ? "+" : ""}${dilLoadAnalysis?.netEnergyWh?.toFixed(1)} Wh` : `Enter max load for ${dilLoadAnalysis?.missingOperations.length ?? 0} active states` : "penumbra weighted"}
              state={dilSummary ? energyMetricState : dilToModeledMetricState}
              status={!dilSummary ? "Orbit model" : dilWorstCaseReady ? "Max-load profile" : "Load profile pending"}
            />
            <PowerMetricCell
              label={dilData ? "Worst-case minimum battery" : "Minimum battery"}
              value={dilSummary && !dilWorstCaseReady ? "—" : `${batteryMinimumPct.toFixed(0)}%`}
              note={dilSummary && !dilWorstCaseReady ? "Complete operation loads to calculate SOC" : `${(dilSummary?.finalSocPct ?? result.metrics.finalSocPct).toFixed(0)}% final SOC`}
              state={batteryMetricState}
              status={dilSummary && !dilWorstCaseReady ? "Awaiting loads" : batteryMetricState === "good" ? "Healthy" : batteryMetricState === "watch" ? "Monitor reserve" : "Low reserve"}
            />
          </tr>
        </tbody>
      </table>
    </section>
  );

  return (
    <main className={`app-shell layout-${layoutVariant}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div>
            <p>ORBIT·PWR</p>
            <span>Preliminary solar array sizing</span>
          </div>
        </div>
        <div className="topbar-center">
          <nav className="dashboard-tabs" aria-label="Dashboard sections">
            <button type="button" className={dashboardTab === "SIMULATION" ? "active" : ""} onClick={() => setDashboardTab("SIMULATION")}>Mission simulation</button>
            <button type="button" className={dashboardTab === "SATELLITE_CONFIGURATION" ? "active" : ""} onClick={() => setDashboardTab("SATELLITE_CONFIGURATION")}>Satellite configuration</button>
          </nav>
          <div className="topbar-status">
            <span className="model-chip"><i /> {dashboardTab === "SATELLITE_CONFIGURATION" ? "Inventory editor" : dilData ? "DIL replay" : "Analytical MVP"}</span>
            <span className="model-detail">{dashboardTab === "SATELLITE_CONFIGURATION" ? `${simulationSatellite.name} active in simulator` : dilData ? `${dilData.records.length.toLocaleString()} replay samples / ${dilData.sourceRecordCount.toLocaleString()} rows · local file` : "Kepler orbit · J2 drift · conical eclipse · EOL power"}</span>
          </div>
        </div>
        <div className="topbar-actions">
          {dashboardTab === "SIMULATION" ? (
            <>
              <button type="button" className="button-quiet" onClick={exportCsv}>Export CSV</button>
              <button type="button" className="button-primary" onClick={printReport}>Print report</button>
            </>
          ) : (
            <span className="configuration-mode-label">LOCAL INVENTORY · LIVE 3D</span>
          )}
          <a className="layout-archive-link" href={layoutVariant === "cockpit" ? "/legacy" : "/"}>
            {layoutVariant === "cockpit" ? "Archived layout" : "Current layout"}
          </a>
        </div>
      </header>

      <section
        className="satellite-configuration-tab dashboard-tab-panel"
        aria-label="Satellite configuration workspace"
        hidden={dashboardTab !== "SATELLITE_CONFIGURATION"}
      >
        <SatelliteInventory
          embedded
          activeSimulationId={simulationSatellite.id}
          focusActiveRequest={satelliteFocusRequest}
          environmentContext={{
            bodySun: current.bodySun,
            bodyVelocity: current.bodyVelocity,
            bodyNadir: current.bodyNadir,
            shadowFactor: current.shadowFactor,
            label: `${dilData ? "DIL replay" : mission.preset} · T+${formatDuration(current.tSec)}`,
          }}
          onUseInSimulator={applySatelliteConfiguration}
        />
      </section>
      <div className="dashboard-grid dashboard-tab-panel" hidden={dashboardTab !== "SIMULATION"}>
        <aside className="control-rail">
          <section className="control-section">
            <div className="section-heading"><span>01</span><h2>Mission</h2></div>
            <Segmented
              value={mission.preset}
              options={["LEO", "SSO", "GEO"]}
              labels={{ LEO: "LEO", SSO: "SSO", GEO: "GEO" }}
              onChange={choosePreset}
              ariaLabel="Orbit preset"
            />
            <p className="preset-name">{PRESET_LABELS[mission.preset]}</p>
            <div className="field-grid">
              <NumberField
                label="Altitude"
                value={mission.preset === "GEO" ? 35786 : mission.altitudeKm}
                unit="km"
                min={160}
                max={50000}
                disabled={mission.preset === "GEO"}
                onChange={(value) => updateMission("altitudeKm", value)}
              />
              <NumberField
                label="Inclination"
                value={mission.preset === "GEO" ? 0 : mission.inclinationDeg}
                unit="deg"
                min={0}
                max={180}
                step={0.1}
                disabled={mission.preset === "GEO"}
                onChange={(value) => updateMission("inclinationDeg", value)}
              />
              {mission.preset === "SSO" ? (
                <NumberField label="LTAN" value={mission.ltanHours} unit="hr" min={0} max={24} step={0.25} onChange={(value) => updateMission("ltanHours", value)} />
              ) : (
                <NumberField label="RAAN" value={mission.raanDeg} unit="deg" min={0} max={360} step={1} onChange={(value) => updateMission("raanDeg", value)} />
              )}
              <NumberField
                label="Eccentricity"
                value={mission.preset === "GEO" ? 0 : mission.eccentricity}
                unit="—"
                min={0}
                max={maximumSafeEccentricity}
                step={0.001}
                disabled={mission.preset === "GEO"}
                onChange={(value) => updateMission("eccentricity", value)}
              />
              <NumberField
                label="Argument of perigee"
                value={mission.preset === "GEO" ? 0 : mission.argumentOfPerigeeDeg}
                unit="deg"
                min={0}
                max={360}
                step={1}
                disabled={mission.preset === "GEO"}
                onChange={(value) => updateMission("argumentOfPerigeeDeg", value)}
              />
              <NumberField label="True anomaly at epoch" value={mission.trueAnomalyDeg} unit="deg" min={0} max={360} step={1} onChange={(value) => updateMission("trueAnomalyDeg", value)} />
              <NumberField label="Duration" value={mission.durationDays} unit="days" min={2} max={30} step={0.5} onChange={(value) => updateMission("durationDays", value)} />
            </div>
            <label className="date-field">
              <span>Mission epoch</span>
              <input type="datetime-local" value={mission.epoch} onChange={(event) => updateMission("epoch", event.target.value)} />
            </label>
            <p className="control-note">Altitude is the semi-major-axis altitude for eccentric cases. True anomaly fixes the satellite’s along-track position at epoch; eccentricity is limited so perigee remains at or above 160 km.</p>
          </section>

          <section className="control-section dil-section">
            <div className="section-heading"><span>DIL</span><h2>Actual data replay</h2></div>
            <label className="dil-interval-field">
              <span>Minute-only TIME interval</span>
              <div>
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  list="dil-interval-suggestions"
                  value={dilSampleIntervalSec}
                  placeholder="Auto"
                  disabled={dilLoading}
                  aria-label="DIL sample interval in seconds"
                  onChange={(event) => setDilSampleIntervalSec(event.target.value)}
                />
                <em>seconds</em>
              </div>
              <small>Optional fixed cadence. Suggested: 10, 20 or 50 s. Set before uploading; blank uses timestamp inference.</small>
              <datalist id="dil-interval-suggestions">
                <option value="10" />
                <option value="20" />
                <option value="50" />
              </datalist>
            </label>
            <label className="select-field">
              <span>DIL reference panel axis</span>
              <select
                value={dilReferenceAxisOverride}
                disabled={dilLoading}
                onChange={(event) => setDilReferenceAxisOverride(event.target.value as "AUTO" | SignedAxis)}
              >
                <option value="AUTO">Auto-detect / file value</option>
                {SIGNED_AXES.map((axis) => <option value={axis} key={axis}>{axis}</option>)}
              </select>
              <small>Optional override for legacy files. New files should declare SOLAR_PANEL_AXIS.</small>
            </label>
            <label className="dil-upload">
              <input
                type="file"
                disabled={dilLoading}
                accept=".csv,.tsv,.txt,.json,text/csv,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleDilFile(file);
                  event.currentTarget.value = "";
                }}
              />
              <b>{dilLoading ? "Preparing replay…" : dilData ? "Replace DIL file" : "Upload DIL file"}</b>
              <span>{dilLoading ? "Large files are reduced to a responsive replay track" : "CSV, TSV or JSON · processed only in this browser"}</span>
            </label>
            <div className="dil-actions">
              <button type="button" onClick={downloadDilTemplate}>Download template</button>
              {dilData && <button type="button" onClick={() => { setDilOperationMaxLoadInputs({}); setDilData(null); setDilError(""); setCurrentIndex(0); }}>Return to model</button>}
            </div>
            {dilData && (
              <div className="dil-file-status" role="status">
                <b>{dilData.fileName}</b>
                <span>{dilData.records.length.toLocaleString()} replay samples from {dilData.sourceRecordCount.toLocaleString()} rows</span>
                <span>Start: {dilData.records[0].timeLabel}</span>
                <span>End: {dilData.records[dilData.records.length - 1].timeLabel}</span>
                <span>Computed power-profile span: {formatDuration(dilData.records[dilData.records.length - 1].timeSec)}</span>
                <span>Reference panel axis: {dilData.referencePanelAxis ?? "Not assigned"} · {dilData.referenceAxisSource.toLowerCase().replaceAll("_", " ")}</span>
                <span>Reference angle / SUN_BODY agreement: {dilData.referenceVectorMaeDeg.toFixed(2)}° mean error · {dilData.referenceVectorMismatchPct.toFixed(1)}% above 5°</span>
                {dilData.warnings.map((warning) => <em key={warning}>{warning}</em>)}
              </div>
            )}
            {dilError && <p className="inline-warning dil-error" role="alert">{dilError}</p>}
            <details className="dil-format">
              <summary>Required fields & assumptions</summary>
              <p>{DIL_REQUIRED_FIELDS.join(" · ")}</p>
              <span>Universal panel reference: add SOLAR_PANEL_AXIS with +X, −X, +Y, −Y, +Z or −Z and SUN_PANEL_INCIDENCE in degrees. Legacy signed columns such as sun_+Y_panels and sun_-Z_panels remain supported. When no axis field exists, Auto mode infers the best-matching signed axis from SUN_BODY and a 0–100 SOLAR_POWER_GENERATED factor. The import override can resolve ambiguous legacy files.</span>
              <span>On import, the modeled cell normal is aligned to the declared/detected reference axis and mounting rotations are reset to 0°. You can then select another axis or apply mounting rotations for comparison.</span>
              <span>TIME: elapsed seconds, ISO-8601, or DD-MM-YYYY HH:mm[:ss] using a 24-hour clock (AM/PM is also accepted), for example 01-01-2028 05:30 · for minute-only TIME, specify the known row interval above or leave it blank to infer sub-minute spacing · SATELLITE_POSITION: Earth-centred km or m (auto-detected by magnitude) and directly drives the orbit · LATITUDE/LONGITUDE: degrees · body vectors: XYZ · ATTITUDE_RPY: degrees, ZYX body-to-ECI · SOLAR_POWER_GENERATED: measured W or an automatically detected 0–100 generation factor. Vector cells in CSV must be quoted.</span>
              <span>SPACECRAFT_OPERATION values beginning with GSPOINTING activate a blue downlink beam from the installed X/Ka-band communication dish, while imaging/capture values activate a green footprint from the installed optical payload. Numeric PAYLOAD_EARTH and PAYLOAD_SUN angles drive the target direction; rigid spacecraft parts retain their configured mounts while ATTITUDE_RPY rotates the complete spacecraft assembly.</span>
            </details>
          </section>

          <section className="control-section">
            <div className="section-heading"><span>02</span><h2>Deployed spacecraft</h2></div>
            <div className="deployed-input-summary" aria-label="Deployed spacecraft and solar array configuration">
              <div><span>Attitude law</span><b>{ATTITUDE_LABELS[mission.attitude]}</b></div>
              <div><span>Body frame</span><b>V {mission.velocityBodyAxis} · N {mission.nadirBodyAxis}</b></div>
              <div><span>Sun-facing cell normal</span><b>{mission.panelFacingAxis}</b></div>
              <div><span>Wing layout</span><b>{mission.wingLayout === "DUAL" ? "Dual wing" : "Single wing"}</b></div>
              <div><span>Cell / strings</span><b>{deployedSpacecraft.array.cellModel} · {deployedSpacecraft.array.seriesCells}S × {deployedSpacecraft.array.parallelStrings}P</b></div>
              <div><span>Packaging</span><b>{power.packagingEfficiencyPct.toFixed(1)}%</b></div>
              <div><span>Operating temperature</span><b>{power.operatingTemperatureC.toFixed(0)}°C</b></div>
            </div>
            {layoutVariant === "legacy" && <button type="button" className="edit-deployed-config-button" onClick={() => setDashboardTab("SATELLITE_CONFIGURATION")}>Edit spacecraft & solar power model</button>}
            <p className="control-note">Spacecraft geometry, body frames and the solar power model are managed in Satellite Configuration and applied after Deploy to orbit.</p>
          </section>

          <section className="control-section">
            <div className="section-heading"><span>03</span><h2>Power balance</h2></div>
            <div className="field-grid">
              <NumberField label="Orbit-average load" value={power.averageLoadW} unit="W" min={0} max={10000} step={10} onChange={(value) => updatePower("averageLoadW", value)} />
              <NumberField label="Battery" value={power.batteryWh} unit="Wh" min={1} max={10000} step={10} onChange={(value) => updatePower("batteryWh", value)} />
            </div>
            <p className="control-note">Default playback only: this constant load is applied at every analytical time step. DIL replay ignores it and uses the maximum loads entered for its operation states.</p>
            <div className="range-field">
              <span><b>Initial state of charge</b><em>{power.initialSocPct}%</em></span>
              <input aria-label="Initial state of charge" id="initial-soc" type="range" min="10" max="100" step="1" value={power.initialSocPct} onChange={(event) => updatePower("initialSocPct", Number(event.target.value))} />
            </div>
          </section>
        </aside>

        <section className="workspace">
          <header className="cockpit-stage-toolbar">
            <div>
              <b>{engineeringView === "ORBIT" ? "Sun–array geometry" : "Power & operations"}</b>
            </div>
            <nav className="cockpit-stage-view-switcher" aria-label="Engineering view">
              <button type="button" className={engineeringView === "ORBIT" ? "active" : ""} aria-pressed={engineeringView === "ORBIT"} onClick={() => setEngineeringView("ORBIT")}>Orbit view</button>
              <button type="button" className={engineeringView === "POWER" ? "active" : ""} aria-pressed={engineeringView === "POWER"} onClick={() => setEngineeringView("POWER")}>Power + operations</button>
            </nav>
          </header>
          <div className="cockpit-stage-content">
          {engineeringView === "ORBIT" && (
            <aside className="cockpit-stage-switcher" aria-label="Deployed spacecraft">
              <button
                type="button"
                className="cockpit-deployed-badge"
                title={`Open ${deployedSpacecraft.name} in Satellite Configuration`}
                onClick={() => {
                  setSatelliteFocusRequest((currentRequest) => currentRequest + 1);
                  setDashboardTab("SATELLITE_CONFIGURATION");
                }}
              >
                <small>DEPLOYED SPACECRAFT</small>
                <b>{deployedSpacecraft.name}</b>
                <span>Open configuration →</span>
              </button>
            </aside>
          )}
          <section className="cockpit-stage-pane cockpit-orbit-pane" hidden={layoutVariant === "cockpit" && engineeringView !== "ORBIT"}>
          <section className="visual-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">{dilData ? `DIL REPLAY / ${dilData.fileName}` : `SIMULATION / ${mission.preset}`}</span>
                <h1>Sun–array geometry</h1>
              </div>
              <div className="deployed-config-actions">
                <span><small>DEPLOYED SPACECRAFT</small><b>{deployedSpacecraft.name}</b></span>
                {layoutVariant === "legacy" && <button type="button" onClick={() => setDashboardTab("SATELLITE_CONFIGURATION")}>Edit configuration</button>}
              </div>
            </div>
            <div className="canvas-wrap orbit-canvas-wrap">
              <OrbitCanvas
                points={displayPoints}
                currentIndex={activeIndex}
                mode="ORBIT"
                mission={mission}
                isDilReplay={Boolean(dilData)}
                illuminationEpochMs={illuminationEpochMs}
                sceneSunVector={sceneSunVector}
                spacecraftOperation={currentDilRecord?.spacecraftOperation}
                orbitSpacecraft={deployedSpacecraft}
                onAxisChange={(value) => updateMission("panelFacingAxis", value)}
              />
              <div className="orbit-bottom-left-overlays">
                <div className="orbit-deployed-model" aria-live="polite">
                  <b>{deployedSpacecraft.name.toUpperCase()}</b>
                  <span>Deployed configuration snapshot · live mission attitude</span>
                </div>
                <div className="canvas-readout">
                  <span className={`illumination-state state-${illuminationState.toLowerCase()}`}><i /> {illuminationState} {Math.round(current.shadowFactor * 100)}%</span>
                  <span>β {current.betaDeg.toFixed(1)}°</span>
                  <span>PANEL {mission.panelFacingAxis} · VIS θ {visualPanelIncidenceDeg.toFixed(1)}° · PWR θ {current.incidenceDeg.toFixed(1)}°</span>
                  <span>{dilData ? "SUN: DIL BODY→ECI LOCKED" : "SUN / SHADOW EPOCH-LOCKED"}</span>
                  <span>EARTH / ORBIT VIEW-LOCKED</span>
                  {dilData && <span>ATTITUDE_RPY · SUN-LOCK CORR {sunLockDriftDeg.toFixed(2)}°</span>}
                  {currentDilRecord && ["IMAGING", "GEOPOINTING"].includes(classifyOperation(currentDilRecord.spacecraftOperation)) && (
                    <span>PAYLOAD E {current.payloadEarthAngleDeg?.toFixed(1) ?? "—"}° · SUN {current.payloadSunAngleDeg?.toFixed(1) ?? "—"}° · RES {current.payloadPointingResidualDeg?.toFixed(2) ?? "—"}°</span>
                  )}
                  {currentDilRecord && <span className={`operation-pill operation-${classifyOperation(currentDilRecord.spacecraftOperation).toLowerCase()}`}>{classifyOperation(currentDilRecord.spacecraftOperation)}</span>}
                </div>
                <div className="orbit-legend" aria-label="Orbit illumination legend">
                  <span><i className="legend-sunlight" />Sunlight</span>
                  <span><i className="legend-penumbra" />Penumbra</span>
                  <span><i className="legend-umbra" />Umbra</span>
                  <span className="earth-credit">Earth: NASA Blue Marble</span>
                </div>
              </div>
            </div>
            <div className="timeline-control">
              <button type="button" className="play-button" aria-label={playing ? "Pause simulation" : "Play simulation"} onClick={() => setPlaying((value) => !value)}>
                <span className={`playback-icon ${playing ? "is-paused" : "is-playing"}`} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="speed-button"
                aria-label={`Playback speed ${playbackSpeed} times. Click to increase.`}
                title="Playback speed: 1×, 5×, 10×, 25×, 50×"
                onClick={() => setPlaybackSpeed((speed) => PLAYBACK_SPEEDS[(PLAYBACK_SPEEDS.indexOf(speed as (typeof PLAYBACK_SPEEDS)[number]) + 1) % PLAYBACK_SPEEDS.length])}
              >
                {playbackSpeed}×
              </button>
              <input
                type="range"
                min="0"
                max={displayPoints.length - 1}
                value={activeIndex}
                aria-label="Simulation time"
                onChange={(event) => { setPlaying(false); setCurrentIndex(Number(event.target.value)); }}
              />
              <span>{currentDilRecord ? currentDilRecord.timeLabel : `T+ ${formatDuration(current.tSec)}`}</span>
              <span>{dilSummary ? `${formatDuration(dilSummary.durationSec)} record` : `${formatDuration(result.metrics.periodSec)} / orbit`}</span>
            </div>
            {layoutVariant === "cockpit" && renderMissionPowerSummary("orbit-output-metrics")}
            {currentDilRecord && (
              <div className="dil-telemetry" aria-label="Current DIL telemetry">
                <div><span>Operation</span><b>{currentDilRecord.spacecraftOperation || "—"}</b></div>
                <div><span>Sunlit status</span><b>{currentDilRecord.sunlitStatus || "—"}</b></div>
                <div><span>Reference panel axis</span><b>{dilData.referencePanelAxis ?? "—"}</b></div>
                <div><span>Imported panel incidence</span><b>{currentDilRecord.referencePanelIncidenceDeg !== undefined ? `${currentDilRecord.referencePanelIncidenceDeg.toFixed(2)}°` : currentDilRecord.sunPanelReference || "—"}</b></div>
                <div><span>Payload / Sun</span><b>{currentDilRecord.payloadSun || "—"}</b></div>
                <div><span>Payload / Earth</span><b>{currentDilRecord.payloadEarth || "—"}</b></div>
                <div><span>Latitude / Longitude</span><b>{currentDilRecord.latitudeDeg.toFixed(4)}° / {currentDilRecord.longitudeDeg.toFixed(4)}°</b></div>
                <div><span>Attitude RPY</span><b>{currentDilRecord.attitudeRpyDeg.map((value) => value.toFixed(2)).join(" / ")}°</b></div>
                <div><span>Modeled / {dilComparisonLabel.toLowerCase()} power</span><b>{current.powerW.toFixed(1)} / {(current.measuredPowerW ?? 0).toFixed(1)} W</b></div>
                <div><span>Perfect-pointing ceiling</span><b>{(current.perfectPointingPowerW ?? 0).toFixed(1)} W</b></div>
                {dilPowerIsFactor && <div><span>Raw DIL generation factor</span><b>{(current.dilGenerationFactorPct ?? 0).toFixed(2)}%</b></div>}
                {currentDilRecord.referencePanelIncidenceDeg !== undefined && <div><span>Reference / selected-axis incidence</span><b>{currentDilRecord.referencePanelIncidenceDeg.toFixed(2)}° / {current.incidenceDeg.toFixed(2)}°</b></div>}
              </div>
            )}
          </section>

          </section>
          <section className={`cockpit-stage-pane cockpit-power-pane${dilSummary ? " has-dil-operations" : ""}`} hidden={layoutVariant === "cockpit" && engineeringView !== "POWER"}>

          {layoutVariant === "legacy" && (
            <section className="metrics-grid" aria-live="polite">
              <Metric label={dilData ? `${dilComparisonLabel} power` : "Power now"} value={`${primaryPowerNowW.toFixed(0)} W`} note={dilData ? `Modeled ${current.powerW.toFixed(0)} W · imported DIL · ${Math.round(current.shadowFactor * 100)}% light` : `Corrected EOL MPP · ${Math.round(current.shadowFactor * 100)}% light · θ ${current.incidenceDeg.toFixed(1)}°`} tone={dilSummary && !dilWorstCaseReady ? undefined : primaryPowerNowW > (dilSummary ? currentOperationMaxLoadW ?? 0 : power.averageLoadW) ? "good" : "warn"} />
              <Metric label={dilData ? `${dilComparisonLabel} energy / span` : "Generated energy / span"} value={dilSummary ? `${dilSummary.measuredEnergyWh.toFixed(0)} Wh` : `${result.metrics.energyWh.toFixed(0)} Wh`} note={dilSummary ? `Modeled ${dilSummary.modeledEnergyWh.toFixed(0)} Wh · perfect-pointing ceiling ${dilSummary.perfectPointingEnergyWh.toFixed(0)} Wh` : `${result.metrics.energyPerOrbitWh.toFixed(0)} Wh/orbit · ${result.metrics.averagePowerW.toFixed(0)} W average`} tone={primaryEnergyPositive ? "good" : "warn"} />
              <Metric label={dilData ? "Worst-case OAP load" : "Eclipse / orbit"} value={dilSummary ? dilWorstCaseReady ? `${dilLoadAnalysis?.worstCaseAverageLoadW?.toFixed(1)} W` : "—" : formatDuration(result.metrics.eclipsePerOrbitSec)} note={dilSummary ? dilWorstCaseReady ? `${dilLoadAnalysis?.loadEnergyWh?.toFixed(1)} Wh used · net ${dilLoadAnalysis?.netEnergyWh?.toFixed(1)} Wh` : "Enter every active state load" : "penumbra weighted"} />
              <Metric label={dilData ? "Worst-case minimum battery" : "Minimum battery"} value={dilSummary && !dilWorstCaseReady ? "—" : `${(dilSummary?.minSocPct ?? result.metrics.minSocPct).toFixed(0)}%`} note={dilSummary && !dilWorstCaseReady ? "Awaiting operation loads" : `${(dilSummary?.finalSocPct ?? result.metrics.finalSocPct).toFixed(0)}% final SOC`} tone={dilSummary && !dilWorstCaseReady ? undefined : batteryHealthy ? "good" : "warn"} />
            </section>
          )}

          <section className="analysis-grid">
            <article className="chart-card">
              <div className="card-heading">
                <div><span className="eyebrow">POWER PROFILE</span><h2>Generation & battery</h2></div>
                <div className={`chart-legend${dilData ? " dil-primary" : ""}`}>
                  {dilData ? (
                    <>
                      <span><i className="measured-key" /> {dilComparisonLabel}</span>
                      <span><i className="power-key" /> Modeled comparison</span>
                    </>
                  ) : <span><i className="power-key" /> Power</span>}
                  {dilData && <span><i className="ceiling-key" /> Perfect ceiling</span>}
                  {dilData && <span><i className="load-key" /> {dilWorstCaseReady ? "Maximum load" : "Maximum load (partial)"}</span>}
                  <span><i className="soc-key" /> {dilData ? dilWorstCaseReady ? "SOC (max-load)" : "SOC pending loads" : "SOC"}</span>
                </div>
              </div>
              <PowerChart points={displayPoints} currentIndex={activeIndex} dilRecords={dilData?.records} dilPowerLabel={dilComparisonLabel} showSoc={!dilData || dilWorstCaseReady} />
            </article>

            <article className="axis-card">
              <div className="card-heading">
                <div><span className="eyebrow">{dilData ? "DIL SIX-AXIS SWEEP" : "DESIGN SWEEP"}</span><h2>{dilData ? "Cell normal over imported attitude history" : "Sun-facing cell normal"}</h2></div>
                <span className="recommended-tag">Best: {bestAxis.axis}</span>
              </div>
              <div className="axis-bars">
                {[...designAxes].sort((a, b) => a.axis.localeCompare(b.axis)).map((axis) => (
                  <button type="button" key={axis.axis} onClick={() => updateMission("panelFacingAxis", axis.axis)} className={mission.panelFacingAxis === axis.axis ? "selected" : ""}>
                    <span className="bar-label"><b>{axis.axis}</b><em>#{axis.rank}</em></span>
                    <span className="bar-track"><i style={{ width: `${((axis.energyPerOrbitWh / maxAxisEnergy) * 100).toFixed(3)}%` }} /></span>
                    <span className="bar-value"><b>{axis.energyPerOrbitWh.toFixed(0)} Wh</b><em>{axis.averagePowerW.toFixed(0)} W avg</em></span>
                  </button>
                ))}
              </div>
              <div className="axis-verdict">
                <span className="verdict-icon">↗</span>
                <p>
                  <b>{bestAxis.axis} facing produces {((bestAxis.energyPerOrbitWh / Math.max(selectedAxis.energyPerOrbitWh, 0.001) - 1) * 100).toFixed(1)}% more energy</b>
                  <span>than the selected {mission.panelFacingAxis} cell normal for {dilData ? "this imported DIL attitude history" : "this mission and spacecraft attitude"}.</span>
                </p>
              </div>
            </article>
          </section>

          {dilSummary && (
            <section className="operation-energy-card">
              <div className="card-heading">
                <div><span className="eyebrow">DIL OPERATION ENERGY</span><h2>Attitude-constrained generation by operation</h2></div>
                <span className="operation-count">{dilSummary.operations.length} states</span>
              </div>
              <div className="dil-value-guide">
                <div><b>{dilComparisonLabel} · primary</b><span>{dilPowerIsFactor ? `Independent imported ${dilData.referencePanelAxis ?? "reference"} factor scaled to the corrected EOL array rating; it does not change when another modeled axis is selected.` : "Imported SOLAR_POWER_GENERATED telemetry interpreted directly as watts; it does not change with dashboard axis selection."}</span></div>
                <div><b>Modeled · comparison</b><span>{dilReferenceAngleActive ? `Imported ${dilData.referencePanelAxis} reference incidence` : `Selected/mounted ${mission.panelFacingAxis} normal × SUN_BODY`} × sunlight × configured EOL array and losses.</span></div>
                <div><b>Perfect</b><span>Same array and eclipse history with panel incidence fixed at 0°.</span></div>
              </div>
              <p className={`operation-load-prompt${dilLoadProfileComplete ? " complete" : ""}`}>
                <b>{dilLoadProfileComplete ? "Worst-case load profile active." : "Max-load inputs required."}</b>
                <span>{dilLoadProfileComplete ? "SOC and OAP use DIL generation minus each operation's sunlit or eclipse maximum load." : "Enter a non-negative maximum load for every encountered sunlit/eclipse operation state to calculate worst-case OAP, energy margin, and battery SOC."}</span>
              </p>
              <div className="operation-energy-table-wrap">
                <table className="operation-energy-table">
                  <thead><tr><th>Operation</th><th>Illumination</th><th>Max load</th><th>Duration</th><th>Mean {mission.panelFacingAxis} θ</th><th>{dilComparisonLabel}</th><th>Energy used</th><th>Net energy</th><th>Modeled</th><th>Perfect</th><th>DIL / model</th></tr></thead>
                  <tbody>
                    {dilSummary.operations.map((operation) => {
                      const loadKey = dilOperationLoadKey(operation.operation, operation.illumination);
                      const load = dilLoadAnalysis?.operations.find((item) =>
                        item.operation === operation.operation && item.illumination === operation.illumination,
                      );
                      const stateActive = operation.durationSec > 0;
                      return (
                        <tr key={loadKey} className={stateActive ? "" : "inactive-operation-state"}>
                          <td>{operation.operation}</td>
                          <td><span className={`illumination-badge ${operation.illumination.toLowerCase()}`}>{operation.illumination}</span></td>
                          <td className="operation-load-cell">
                            <label>
                              <input
                                type="number"
                                min="0"
                                max="100000"
                                step="1"
                                inputMode="decimal"
                                placeholder={stateActive ? "Required" : "Unused"}
                                aria-label={`Maximum load for ${operation.operation} during ${operation.illumination.toLowerCase()} in watts`}
                                value={dilOperationMaxLoadInputs[loadKey] ?? ""}
                                onChange={(event) => setDilOperationMaxLoadInputs((currentLoads) => ({
                                  ...currentLoads,
                                  [loadKey]: event.target.value,
                                }))}
                              />
                              <span>W</span>
                            </label>
                          </td>
                          <td>{formatDuration(operation.durationSec)}</td>
                          <td>{stateActive ? `${operation.averageIncidenceDeg.toFixed(1)}°` : "—"}</td>
                          <td className="dil-primary-number">{operation.measuredEnergyWh.toFixed(1)} Wh</td>
                          <td>{load?.loadEnergyWh === undefined ? "—" : `${load.loadEnergyWh.toFixed(1)} Wh`}</td>
                          <td className={load?.netEnergyWh === undefined ? "" : load.netEnergyWh >= 0 ? "positive" : "negative"}>{load?.netEnergyWh === undefined ? "—" : `${load.netEnergyWh >= 0 ? "+" : ""}${load.netEnergyWh.toFixed(1)} Wh`}</td>
                          <td>{operation.modeledEnergyWh.toFixed(1)} Wh</td>
                          <td>{operation.perfectPointingEnergyWh.toFixed(1)} Wh</td>
                          <td className="dil-ratio-number">{operation.modeledEnergyWh > 0 ? (operation.measuredEnergyWh / operation.modeledEnergyWh * 100).toFixed(1) : "0.0"}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="operation-table-note">Each operation has separate sunlit and eclipse maximum loads. Penumbra uses the eclipse load profile conservatively while retaining partial generation. Unencountered states remain visible but are not required. Inputs reset with a new DIL or page reload.</p>
            </section>
          )}

          {dilSummary ? (
            <section className="engineering-strip dil-engineering-strip">
              <div><span>Recorded span</span><b>{formatDuration(dilSummary.durationSec)}</b></div>
              <div><span>{dilComparisonLabel} / modeled energy</span><b>{dilSummary.measuredEnergyWh.toFixed(1)} / {dilSummary.modeledEnergyWh.toFixed(1)} Wh</b></div>
              <div><span>DIL / modeled energy</span><b>{dilSummary.measuredToModeledPct.toFixed(1)}%</b></div>
              <div><span>Worst-case OAP load</span><b>{dilWorstCaseReady ? `${dilLoadAnalysis?.worstCaseAverageLoadW?.toFixed(1)} W` : "—"}</b></div>
              <div><span>Worst-case load energy</span><b>{dilWorstCaseReady ? `${dilLoadAnalysis?.loadEnergyWh?.toFixed(1)} Wh` : "—"}</b></div>
              <div><span>Net DIL energy</span><b className={!dilWorstCaseReady ? "" : (dilLoadAnalysis?.netEnergyWh ?? 0) >= 0 ? "positive" : "negative"}>{dilWorstCaseReady ? `${(dilLoadAnalysis?.netEnergyWh ?? 0) >= 0 ? "+" : ""}${dilLoadAnalysis?.netEnergyWh?.toFixed(1)} Wh` : "—"}</b></div>
              <div><span>Perfect-pointing ceiling</span><b>{dilSummary.perfectPointingEnergyWh.toFixed(1)} Wh</b></div>
              <div><span>Average {dilComparisonLabel.toLowerCase()} / modeled</span><b>{dilSummary.averageMeasuredPowerW.toFixed(1)} / {dilSummary.averageModeledPowerW.toFixed(1)} W</b></div>
              <div><span>Attitude capture</span><b>{dilSummary.modeledCapturePct.toFixed(1)}%</b></div>
              <div><span>Weighted sunlit</span><b>{dilSummary.illuminatedPct.toFixed(1)}%</b></div>
              <div><span>Worst-case minimum SOC</span><b>{dilWorstCaseReady ? `${dilSummary.minSocPct.toFixed(1)}%` : "—"}</b></div>
            </section>
          ) : (
          <section className="engineering-strip">
            <div><span>Effective RAAN</span><b>{result.effectiveRaanDeg.toFixed(2)}°</b></div>
            <div><span>Perigee / apogee</span><b>{result.metrics.perigeeAltitudeKm.toFixed(0)} / {result.metrics.apogeeAltitudeKm.toFixed(0)} km</b></div>
            <div><span>J2 RAAN drift</span><b>{result.metrics.raanRateDegDay.toFixed(3)}°/day</b></div>
            <div><span>Beta range</span><b>{result.metrics.betaMinDeg.toFixed(1)}° to {result.metrics.betaMaxDeg.toFixed(1)}°</b></div>
            <div><span>Energy margin</span><b className={marginPositive ? "positive" : "negative"}>{result.metrics.energyMarginWh >= 0 ? "+" : ""}{result.metrics.energyMarginWh.toFixed(0)} Wh</b></div>
            <div><span>Peak array power</span><b>{result.metrics.peakPowerW.toFixed(0)} W</b></div>
            <div><span>Total generated energy</span><b>{result.metrics.energyWh.toFixed(0)} Wh</b></div>
            <div><span>BOL array rating</span><b>{result.metrics.bolArrayPowerW.toFixed(0)} W</b></div>
            <div><span>EOL array rating</span><b>{result.metrics.eolArrayPowerW.toFixed(0)} W</b></div>
            <div><span>Cell / packaged area</span><b>{result.metrics.activeCellAreaM2.toFixed(2)} / {result.metrics.packagedAreaM2.toFixed(2)} m²</b></div>
            <div><span>Implied cell efficiency</span><b>{result.metrics.impliedCellEfficiencyPct.toFixed(1)}%</b></div>
            <div><span>Radiation retention</span><b>{result.metrics.radiationRetentionPct.toFixed(1)}%</b></div>
            <div><span>Temperature / electrical</span><b>{result.metrics.temperatureRetentionPct.toFixed(1)} / {result.metrics.electricalRetentionPct.toFixed(1)}%</b></div>
            <div><span>Optical retention</span><b>{result.metrics.opticalRetentionPct.toFixed(1)}%</b></div>
            <div><span>Analysis span</span><b>{mission.durationDays.toFixed(1)} d / {result.metrics.elapsedOrbits.toFixed(1)} orbits</b></div>
          </section>
          )}

          <div className="power-alerts">
            {dilGeometryConflict && (
              <aside className="design-alert" role="alert">
                <b>DIL geometry inconsistency.</b>
                <span>The imported {dilData?.referencePanelAxis} incidence and SUN_BODY disagree by {dilData?.referenceVectorMaeDeg.toFixed(1)}° on average. The declared reference angle drives its own axis; the other five axes still use SUN_BODY and should not be treated as a physically consistent comparison until the source DIL is corrected.</span>
              </aside>
            )}

            {(!dilSummary || dilWorstCaseReady) && (!marginPositive || !batteryHealthy) && (
              <aside className="design-alert" role="alert">
                <b>Design check required.</b>
                <span>{!marginPositive ? "Generated energy is below mission load. " : ""}{!batteryHealthy ? "Battery reserve falls below 20%." : ""}</span>
              </aside>
            )}
          </div>

          {layoutVariant === "cockpit" && renderMissionPowerSummary("power-output-metrics")}

          <footer className="model-note">
            <span>MODEL SCOPE</span>
            <p>
              {dilData && `DIL replay maps SATELLITE_POSITION directly into the Earth-centred scene. The global Sun and shadow direction are initialized from the first absolute DIL TIME and then held inertially fixed. For the declared reference axis with zero mounting rotation, an explicit imported incidence history is authoritative; this ensures a declared 0° reference angle produces normal-incidence power. Other signed axes and rotated mountings use each row's body-frame SUN_BODY. The imported reference panel axis is ${dilData.referencePanelAxis ?? "unassigned"}; it may come from SOLAR_PANEL_AXIS, a legacy signed-angle column, the import override, or automatic correlation inference. The importer measures and reports disagreement between that reference incidence and SUN_BODY because a large mismatch makes cross-axis comparisons physically inconsistent. Energy is trapezoid-integrated from every original DIL row before display decimation, including irregular timestamp intervals. ${dilPowerIsFactor ? `For this file, SOLAR_POWER_GENERATED is a 0–100 cosine-like ${dilData.referencePanelAxis ?? "panel"} reference factor and is scaled by the corrected unshadowed EOL array rating to produce DIL-derived watts.` : "SOLAR_POWER_GENERATED is interpreted directly as measured watts."} When all encountered operation/illumination maximum loads are entered, the imported DIL generation minus those loads drives the conservative worst-case battery SOC and OAP calculation; the default orbit-average load is ignored. Every operation has separate sunlit and eclipse profiles, with penumbra conservatively assigned to the eclipse load profile while its partial generation is retained. A perfect-pointing ceiling retains eclipse and electrical losses but removes attitude-incidence loss. Position magnitudes above 100,000 are treated as metres and converted to kilometres. `}
              Preliminary design only. Keplerian propagation uses semi-major-axis altitude, eccentricity, argument of perigee and true anomaly at epoch, with secular J2 RAAN/perigee drift, analytical Sun position and
              spherical-Earth conical eclipse. The deployed panel is rigidly mounted to the spacecraft; there is no ideal Sun tracker.
              Signed body-axis assignments map velocity and nadir/pointing references into the spacecraft frame, while mounting
              rotations are applied sequentially about body X, then Y, then Z. Array output uses EOL cell Vmp × Imp, configured
              series-parallel topology, angular-response exponent, pointing uncertainty, Sun–Earth distance, constant-temperature Pmp correction, conical eclipse, MPPT/harness efficiencies, mismatch/diode/contamination/self-shadowing and other system losses. Catalog EOL points are not interpolated.
              The analytical Sun/shadow direction is locked from mission epoch while LTAN defines the SSO orbit plane. Earth texture phase is initialized from GMST and advances at the sidereal rotation rate. The Earth rendering remains visual context rather than a geodetic map. Operating temperature and self-shadowing are equivalent constant inputs; detailed thermal time histories, CAD ray tracing, spectral response, albedo and transient MPPT operating limits remain outside this preliminary model.
            </p>
          </footer>
          </section>
          </div>
        </section>
      </div>
    </main>
  );
}

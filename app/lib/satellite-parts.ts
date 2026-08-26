import {
  BODY_AXES,
  type BodyAxis,
  type SatelliteInventoryItem,
  type SatelliteSubsystem,
  type SubsystemKind,
} from "./satellite-inventory";

export const PART_CATEGORIES = [
  "Structures",
  "Payloads",
  "Communications",
  "Solar arrays",
  "Propulsion",
] as const;

export type PartCategory = (typeof PART_CATEGORIES)[number];

export interface SatellitePartDefinition {
  id: string;
  name: string;
  category: PartCategory;
  kind: SubsystemKind;
  description: string;
  massKg: number;
  nominalPowerW: number;
  envelopeM: { x: number; y: number; z: number };
  defaultMountAxis: BodyAxis;
  allowedMountAxes: readonly BodyAxis[];
  functionalAxis?: BodyAxis;
  structurePreset?: {
    className: SatelliteInventoryItem["className"];
    dimensionsM: { x: number; y: number; z: number };
    massKg: number;
  };
  arrayPreset?: Partial<SatelliteInventoryItem["array"]>;
}

const ALL_FACES = BODY_AXES;

export const SATELLITE_PART_CATALOG: SatellitePartDefinition[] = [
  { id: "structure-12u", name: "12U CubeSat frame", category: "Structures", kind: "structure", description: "Compact 12U structural bus for demonstrators and hosted payloads.", massKg: 12, nominalPowerW: 0, envelopeM: { x: 0.226, y: 0.226, z: 0.34 }, defaultMountAxis: "+Z", allowedMountAxes: ALL_FACES, structurePreset: { className: "CubeSat", dimensionsM: { x: 0.226, y: 0.226, z: 0.34 }, massKg: 12 } },
  { id: "structure-micro-600", name: "MicroBus 600", category: "Structures", kind: "structure", description: "A 600 mm microsatellite bus with six equipment mounting faces.", massKg: 68, nominalPowerW: 0, envelopeM: { x: 0.6, y: 0.6, z: 0.82 }, defaultMountAxis: "+Z", allowedMountAxes: ALL_FACES, structurePreset: { className: "Microsatellite", dimensionsM: { x: 0.6, y: 0.6, z: 0.82 }, massKg: 68 } },
  { id: "structure-eo-1200", name: "EO Bus 1200", category: "Structures", kind: "structure", description: "High-stability small-satellite structure for larger EO payloads.", massKg: 184, nominalPowerW: 0, envelopeM: { x: 1.2, y: 1.0, z: 1.55 }, defaultMountAxis: "+Z", allowedMountAxes: ALL_FACES, structurePreset: { className: "Small satellite", dimensionsM: { x: 1.2, y: 1.0, z: 1.55 }, massKg: 184 } },
  { id: "payload-pushbroom-120", name: "Pushbroom EO-120", category: "Payloads", kind: "payload", description: "Compact nadir pushbroom camera; functional axis is its optical boresight.", massKg: 8.5, nominalPowerW: 42, envelopeM: { x: 0.2, y: 0.2, z: 0.16 }, defaultMountAxis: "-Z", allowedMountAxes: ALL_FACES, functionalAxis: "-Z" },
  { id: "payload-ms8", name: "Multispectral MS-8", category: "Payloads", kind: "payload", description: "Eight-band reflective optical payload for agile EO missions.", massKg: 34, nominalPowerW: 135, envelopeM: { x: 0.42, y: 0.42, z: 0.38 }, defaultMountAxis: "-Z", allowedMountAxes: ALL_FACES, functionalAxis: "-Z" },
  { id: "payload-tir640", name: "Thermal IR-640", category: "Payloads", kind: "payload", description: "Cooled thermal imager with a nadir-facing aperture.", massKg: 22, nominalPowerW: 190, envelopeM: { x: 0.34, y: 0.3, z: 0.3 }, defaultMountAxis: "-Z", allowedMountAxes: ALL_FACES, functionalAxis: "-Z" },
  { id: "radio-sband-patch", name: "S-band patch", category: "Communications", kind: "radio", description: "Low-profile TT&C patch antenna and radio electronics.", massKg: 1.4, nominalPowerW: 11, envelopeM: { x: 0.14, y: 0.14, z: 0.04 }, defaultMountAxis: "+Z", allowedMountAxes: ALL_FACES, functionalAxis: "+Z" },
  { id: "radio-xband-dish", name: "X-band dish", category: "Communications", kind: "radio", description: "High-rate payload downlink dish with outward antenna boresight.", massKg: 5.8, nominalPowerW: 48, envelopeM: { x: 0.32, y: 0.32, z: 0.16 }, defaultMountAxis: "+Z", allowedMountAxes: ALL_FACES, functionalAxis: "+Z" },
  { id: "solar-body-4x8", name: "Body panel 4×8", category: "Solar arrays", kind: "solar_array", description: "Single body-mounted AZUR cell panel.", massKg: 1.8, nominalPowerW: 0, envelopeM: { x: 0.32, y: 0.22, z: 0.018 }, defaultMountAxis: "+X", allowedMountAxes: ALL_FACES, functionalAxis: "+Y", arrayPreset: { wingLayout: "single", panelsPerWing: 1, panelLengthM: 0.32, panelWidthM: 0.22, deploymentAxis: "+X", deployedAngleDeg: 0, seriesCells: 8, parallelStrings: 4 } },
  { id: "solar-dual-azur", name: "Dual AZUR wing", category: "Solar arrays", kind: "solar_array", description: "One- or two-sided deployable three-panel wings for sustained payload operations.", massKg: 15, nominalPowerW: 0, envelopeM: { x: 2.1, y: 0.68, z: 0.035 }, defaultMountAxis: "+X", allowedMountAxes: ALL_FACES, functionalAxis: "+Y", arrayPreset: { wingLayout: "dual", panelsPerWing: 3, panelLengthM: 2.1, panelWidthM: 0.68, deploymentAxis: "+X", deployedAngleDeg: 90, seriesCells: 19, parallelStrings: 24 } },
  { id: "prop-mono-1n", name: "1 N monoprop module", category: "Propulsion", kind: "propulsion", description: "Compact orbit-control propulsion module; functional axis is thrust direction.", massKg: 12, nominalPowerW: 18, envelopeM: { x: 0.28, y: 0.24, z: 0.2 }, defaultMountAxis: "-X", allowedMountAxes: ALL_FACES, functionalAxis: "-X" },
  { id: "prop-hall-200", name: "200 W Hall thruster", category: "Propulsion", kind: "propulsion", description: "Electric propulsion unit with a defined plume/thrust axis.", massKg: 9.2, nominalPowerW: 200, envelopeM: { x: 0.24, y: 0.22, z: 0.22 }, defaultMountAxis: "-X", allowedMountAxes: ALL_FACES, functionalAxis: "-X" },
];

export function createCustomSatelliteDraft(): SatelliteInventoryItem {
  return {
    id: `custom-build-${Date.now()}`,
    name: "Untitled EO spacecraft",
    family: "Custom assembly",
    className: "Microsatellite",
    status: "custom",
    description: "User-built modular EO spacecraft.",
    intendedUse: "Custom Earth-observation mission",
    geometry: { dimensionsM: { x: 0.6, y: 0.6, z: 0.82 }, massKg: 68, payloadApertureM: 0.12, modelSource: "procedural" },
    frames: { velocityAxis: "+X", nadirAxis: "-Z", payloadBoresightAxis: "-Z", solarCellNormalAxis: "+Y" },
    array: { wingLayout: "dual", panelsPerWing: 3, panelLengthM: 2.1, panelWidthM: 0.68, deploymentAxis: "+Y", deployedAngleDeg: 90, cellModel: "AZUR 3G30-Advanced 4x8", seriesCells: 19, parallelStrings: 24, packagingEfficiency: 0.88, operatingTemperatureC: 60 },
    missionDefaults: { attitudeMode: "Mission profile / DIL" },
    powerDefaults: { mpptEfficiency: 0.95, fluenceE14Cm2: 5, referenceIrradianceWm2: 1367, referenceTemperatureC: 28, powerTempCoefficientPctC: -0.08, pointingErrorDeg: 0, angularResponseExponent: 1, harnessEfficiency: 1, mismatchLossPct: 0, diodeLossPct: 0, contaminationLossPct: 0, selfShadowLossPct: 0, systemLossPct: 12, batteryWh: 1000 },
    subsystems: [],
  };
}

export function createSubsystemFromPart(part: SatellitePartDefinition, mountAxis: BodyAxis, index: number): SatelliteSubsystem {
  return {
    id: `${part.id}-${Date.now()}-${index}`,
    name: part.name,
    kind: part.kind,
    attached: true,
    mountAxis,
    massKg: part.massKg,
    nominalPowerW: part.nominalPowerW,
    envelopeM: { ...part.envelopeM },
    catalogPartId: part.id,
    functionalAxis: part.functionalAxis ? mountAxis : undefined,
    faceOffsetM: { u: 0, v: 0, normal: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
  };
}

export function faceAxes(axis: BodyAxis) {
  if (axis.endsWith("X")) return { u: "y" as const, v: "z" as const, depth: "x" as const };
  if (axis.endsWith("Y")) return { u: "x" as const, v: "z" as const, depth: "y" as const };
  return { u: "x" as const, v: "y" as const, depth: "z" as const };
}

export function mountedPartCenter(item: SatelliteInventoryItem, subsystem: SatelliteSubsystem) {
  const { u, v, depth } = faceAxes(subsystem.mountAxis);
  const sign = subsystem.mountAxis.startsWith("-") ? -1 : 1;
  const offset = subsystem.faceOffsetM ?? { u: 0, v: 0, normal: 0 };
  const center = { x: 0, y: 0, z: 0 };
  center[u] = offset.u;
  center[v] = offset.v;
  center[depth] = sign * (item.geometry.dimensionsM[depth] / 2 + subsystem.envelopeM[depth] / 2 + offset.normal);
  return center;
}

export function mountedFacePoint(item: SatelliteInventoryItem, subsystem: SatelliteSubsystem) {
  const { u, v, depth } = faceAxes(subsystem.mountAxis);
  const sign = subsystem.mountAxis.startsWith("-") ? -1 : 1;
  const offset = subsystem.faceOffsetM ?? { u: 0, v: 0, normal: 0 };
  const point = { x: 0, y: 0, z: 0 };
  point[u] = offset.u;
  point[v] = offset.v;
  point[depth] = sign * (item.geometry.dimensionsM[depth] / 2 + offset.normal);
  return point;
}

export interface AssemblyIssue {
  severity: "error" | "warning";
  subsystemId?: string;
  message: string;
}

export function validateSatelliteAssembly(item: SatelliteInventoryItem): AssemblyIssue[] {
  const parts = (item.subsystems ?? []).filter((part) => part.attached && part.kind !== "structure");
  const issues: AssemblyIssue[] = [];
  if (!parts.some((part) => part.kind === "payload")) issues.push({ severity: "warning", message: "No payload is installed." });
  if (!parts.some((part) => part.kind === "solar_array")) issues.push({ severity: "warning", message: "No solar array is installed." });
  for (const part of parts) {
    if (part.kind === "solar_array") {
      const facingAxis = part.functionalAxis ?? item.frames.solarCellNormalAxis;
      if (facingAxis.slice(-1) === item.array.deploymentAxis.slice(-1)) {
        issues.push({ severity: "error", subsystemId: part.id, message: "Solar deployment and panel-facing axes must be perpendicular." });
      }
      continue;
    }
    const axes = faceAxes(part.mountAxis);
    const offset = part.faceOffsetM ?? { u: 0, v: 0, normal: 0 };
    const uLimit = item.geometry.dimensionsM[axes.u] / 2;
    const vLimit = item.geometry.dimensionsM[axes.v] / 2;
    if (Math.abs(offset.u) + part.envelopeM[axes.u] / 2 > uLimit + 0.001 || Math.abs(offset.v) + part.envelopeM[axes.v] / 2 > vLimit + 0.001) {
      issues.push({ severity: "error", subsystemId: part.id, message: `${part.name} exceeds the ${part.mountAxis} mounting face.` });
    }
  }
  for (let leftIndex = 0; leftIndex < parts.length; leftIndex += 1) {
    const left = parts[leftIndex];
    const leftCenter = mountedPartCenter(item, left);
    for (let rightIndex = leftIndex + 1; rightIndex < parts.length; rightIndex += 1) {
      const right = parts[rightIndex];
      if (left.kind === "solar_array" || right.kind === "solar_array") continue;
      if (left.mountAxis !== right.mountAxis) continue;
      const rightCenter = mountedPartCenter(item, right);
      const overlap = (["x", "y", "z"] as const).every((axis) =>
        Math.abs(leftCenter[axis] - rightCenter[axis]) < (left.envelopeM[axis] + right.envelopeM[axis]) / 2 - 0.002,
      );
      if (overlap) issues.push({ severity: "error", subsystemId: right.id, message: `${left.name} overlaps ${right.name}.` });
    }
  }
  return issues;
}

export function customAssemblyTotals(item: SatelliteInventoryItem) {
  const attached = (item.subsystems ?? []).filter((part) => part.attached);
  return {
    partCount: attached.length,
    massKg: item.geometry.massKg + attached.reduce((total, part) => total + part.massKg, 0),
    nominalPowerW: attached.reduce((total, part) => total + part.nominalPowerW, 0),
  };
}

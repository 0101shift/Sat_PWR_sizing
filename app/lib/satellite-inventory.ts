export const BODY_AXES = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as const;
export const SATELLITE_INVENTORY_SCHEMA = "orbit-pwr-satellite-inventory/v1";

export type BodyAxis = (typeof BODY_AXES)[number];
export type SatelliteClass = "CubeSat" | "Microsatellite" | "Small satellite";
export type WingLayout = "single" | "dual";
export const SUBSYSTEM_KINDS = ["payload", "radio", "solar_array", "propulsion", "power", "attitude", "thermal", "structure", "custom"] as const;
export type SubsystemKind = (typeof SUBSYSTEM_KINDS)[number];

export interface SatelliteSubsystem {
  id: string;
  name: string;
  kind: SubsystemKind;
  attached: boolean;
  mountAxis: BodyAxis;
  massKg: number;
  nominalPowerW: number;
  envelopeM: { x: number; y: number; z: number };
  catalogPartId?: string;
  functionalAxis?: BodyAxis;
  faceOffsetM?: { u: number; v: number; normal: number };
  rotationDeg?: { x: number; y: number; z: number };
}

export interface SatelliteInventoryItem {
  id: string;
  name: string;
  family: string;
  className: SatelliteClass;
  status: "trial" | "custom";
  description: string;
  intendedUse: string;
  geometry: {
    dimensionsM: { x: number; y: number; z: number };
    massKg: number;
    payloadApertureM: number;
    modelSource: "procedural" | "step";
    stepFileName?: string;
  };
  frames: {
    velocityAxis: BodyAxis;
    nadirAxis: BodyAxis;
    payloadBoresightAxis: BodyAxis;
    solarCellNormalAxis: BodyAxis;
  };
  array: {
    wingLayout: WingLayout;
    panelsPerWing: number;
    panelLengthM: number;
    panelWidthM: number;
    deploymentAxis: BodyAxis;
    deployedAngleDeg: number;
    cellModel: "AZUR 3G30-Advanced 4x8" | "AZUR 4G32-Advanced 4x8";
    seriesCells: number;
    parallelStrings: number;
    packagingEfficiency: number;
    operatingTemperatureC: number;
  };
  missionDefaults: {
    attitudeMode: "Nadir pointing" | "Sun pointing" | "Mission profile / DIL";
    altitudeKm?: number;
    inclinationDeg?: number;
    ltan?: string;
  };
  powerDefaults: {
    mpptEfficiency: number;
    fluenceE14Cm2?: number;
    referenceIrradianceWm2?: number;
    referenceTemperatureC?: number;
    powerTempCoefficientPctC?: number;
    pointingErrorDeg?: number;
    angularResponseExponent?: number;
    harnessEfficiency?: number;
    mismatchLossPct?: number;
    diodeLossPct?: number;
    contaminationLossPct?: number;
    selfShadowLossPct?: number;
    systemLossPct?: number;
    averageLoadW?: number;
    batteryWh?: number;
  };
  subsystems?: SatelliteSubsystem[];
}

export const DEFAULT_EO_SATELLITES: SatelliteInventoryItem[] = [
  {
    id: "eo-scout-12u",
    name: "EO Scout 12U",
    family: "Compact EO demonstrator",
    className: "CubeSat",
    status: "trial",
    description:
      "A compact 12U-class Earth-observation concept with a nadir camera and one deployable solar wing.",
    intendedUse: "Low-cost imaging demonstrator and short-duration technology missions",
    geometry: {
      dimensionsM: { x: 0.226, y: 0.226, z: 0.34 },
      massKg: 24,
      payloadApertureM: 0.12,
      modelSource: "procedural",
    },
    frames: {
      velocityAxis: "+X",
      nadirAxis: "-Z",
      payloadBoresightAxis: "-Z",
      solarCellNormalAxis: "+Y",
    },
    array: {
      wingLayout: "single",
      panelsPerWing: 3,
      panelLengthM: 0.72,
      panelWidthM: 0.23,
      deploymentAxis: "+Y",
      deployedAngleDeg: 90,
      cellModel: "AZUR 3G30-Advanced 4x8",
      seriesCells: 19,
      parallelStrings: 4,
      packagingEfficiency: 0.86,
      operatingTemperatureC: 60,
    },
    missionDefaults: {
      attitudeMode: "Nadir pointing",
    },
    powerDefaults: {
      mpptEfficiency: 0.94,
      fluenceE14Cm2: 5,
      referenceIrradianceWm2: 1367,
      referenceTemperatureC: 28,
      powerTempCoefficientPctC: -0.08,
      pointingErrorDeg: 0,
      angularResponseExponent: 1,
      harnessEfficiency: 1,
      mismatchLossPct: 0,
      diodeLossPct: 0,
      contaminationLossPct: 0,
      selfShadowLossPct: 0,
      systemLossPct: 12,
    },
    subsystems: [
      { id: "scout-payload", name: "Compact EO payload", kind: "payload", attached: true, mountAxis: "-Z", massKg: 6, nominalPowerW: 28, envelopeM: { x: 0.14, y: 0.14, z: 0.1 } },
      { id: "scout-radio", name: "X-band radio", kind: "radio", attached: true, mountAxis: "+Z", massKg: 1.8, nominalPowerW: 12, envelopeM: { x: 0.1, y: 0.1, z: 0.06 } },
      { id: "scout-array", name: "Deployable solar array", kind: "solar_array", attached: true, mountAxis: "+Y", massKg: 2.5, nominalPowerW: 0, envelopeM: { x: 0.72, y: 0.23, z: 0.02 } },
      { id: "scout-adcs", name: "ADCS package", kind: "attitude", attached: true, mountAxis: "+X", massKg: 2.2, nominalPowerW: 9, envelopeM: { x: 0.08, y: 0.08, z: 0.05 } },
    ],
  },
  {
    id: "eo-meridian-150",
    name: "EO Meridian 150",
    family: "Agile optical microsatellite",
    className: "Microsatellite",
    status: "trial",
    description:
      "A representative agile optical microsatellite with dual deployable wings and a barrel telescope payload.",
    intendedUse: "Medium-resolution multispectral imaging with target-pointing operations",
    geometry: {
      dimensionsM: { x: 1.2, y: 1.0, z: 1.5 },
      massKg: 150,
      payloadApertureM: 0.42,
      modelSource: "procedural",
    },
    frames: {
      velocityAxis: "+X",
      nadirAxis: "-Z",
      payloadBoresightAxis: "-Z",
      solarCellNormalAxis: "+Y",
    },
    array: {
      wingLayout: "dual",
      panelsPerWing: 3,
      panelLengthM: 2.4,
      panelWidthM: 0.86,
      deploymentAxis: "+Y",
      deployedAngleDeg: 90,
      cellModel: "AZUR 3G30-Advanced 4x8",
      seriesCells: 19,
      parallelStrings: 24,
      packagingEfficiency: 0.88,
      operatingTemperatureC: 60,
    },
    missionDefaults: {
      attitudeMode: "Mission profile / DIL",
    },
    powerDefaults: {
      mpptEfficiency: 0.95,
      fluenceE14Cm2: 5,
      referenceIrradianceWm2: 1367,
      referenceTemperatureC: 28,
      powerTempCoefficientPctC: -0.08,
      pointingErrorDeg: 0,
      angularResponseExponent: 1,
      harnessEfficiency: 1,
      mismatchLossPct: 0,
      diodeLossPct: 0,
      contaminationLossPct: 0,
      selfShadowLossPct: 0,
      systemLossPct: 12,
    },
    subsystems: [
      { id: "meridian-payload", name: "Multispectral telescope", kind: "payload", attached: true, mountAxis: "-Z", massKg: 46, nominalPowerW: 145, envelopeM: { x: 0.55, y: 0.55, z: 0.48 } },
      { id: "meridian-radio", name: "X-band high-rate radio", kind: "radio", attached: true, mountAxis: "+Z", massKg: 8, nominalPowerW: 42, envelopeM: { x: 0.34, y: 0.34, z: 0.18 } },
      { id: "meridian-array", name: "Dual solar array", kind: "solar_array", attached: true, mountAxis: "+Y", massKg: 18, nominalPowerW: 0, envelopeM: { x: 2.4, y: 0.86, z: 0.04 } },
      { id: "meridian-prop", name: "Orbit-control propulsion", kind: "propulsion", attached: true, mountAxis: "-X", massKg: 17, nominalPowerW: 35, envelopeM: { x: 0.32, y: 0.28, z: 0.24 } },
      { id: "meridian-adcs", name: "Agile ADCS", kind: "attitude", attached: true, mountAxis: "+X", massKg: 14, nominalPowerW: 55, envelopeM: { x: 0.28, y: 0.25, z: 0.22 } },
    ],
  },
  {
    id: "eo-atlas-600",
    name: "EO Atlas 600",
    family: "High-capacity mapping bus",
    className: "Small satellite",
    status: "trial",
    description:
      "A larger mapping-spacecraft concept with a high-stability bus, large optical payload, and two multi-panel wings.",
    intendedUse: "Wide-swath optical mapping and sustained high-duty-cycle payload operations",
    geometry: {
      dimensionsM: { x: 1.8, y: 1.6, z: 2.3 },
      massKg: 620,
      payloadApertureM: 0.82,
      modelSource: "procedural",
    },
    frames: {
      velocityAxis: "+X",
      nadirAxis: "-Z",
      payloadBoresightAxis: "-Z",
      solarCellNormalAxis: "+Y",
    },
    array: {
      wingLayout: "dual",
      panelsPerWing: 4,
      panelLengthM: 4.8,
      panelWidthM: 1.25,
      deploymentAxis: "+Y",
      deployedAngleDeg: 90,
      cellModel: "AZUR 4G32-Advanced 4x8",
      seriesCells: 36,
      parallelStrings: 32,
      packagingEfficiency: 0.9,
      operatingTemperatureC: 60,
    },
    missionDefaults: {
      attitudeMode: "Mission profile / DIL",
    },
    powerDefaults: {
      mpptEfficiency: 0.96,
      fluenceE14Cm2: 5,
      referenceIrradianceWm2: 1367,
      referenceTemperatureC: 28,
      powerTempCoefficientPctC: -0.08,
      pointingErrorDeg: 0,
      angularResponseExponent: 1,
      harnessEfficiency: 1,
      mismatchLossPct: 0,
      diodeLossPct: 0,
      contaminationLossPct: 0,
      selfShadowLossPct: 0,
      systemLossPct: 12,
    },
    subsystems: [
      { id: "atlas-payload", name: "Wide-swath mapping payload", kind: "payload", attached: true, mountAxis: "-Z", massKg: 185, nominalPowerW: 520, envelopeM: { x: 1.0, y: 1.0, z: 0.72 } },
      { id: "atlas-radio", name: "Ka/X-band communications", kind: "radio", attached: true, mountAxis: "+Z", massKg: 28, nominalPowerW: 155, envelopeM: { x: 0.62, y: 0.62, z: 0.3 } },
      { id: "atlas-array", name: "High-capacity dual array", kind: "solar_array", attached: true, mountAxis: "+Y", massKg: 68, nominalPowerW: 0, envelopeM: { x: 4.8, y: 1.25, z: 0.06 } },
      { id: "atlas-prop", name: "Chemical propulsion module", kind: "propulsion", attached: true, mountAxis: "-X", massKg: 82, nominalPowerW: 110, envelopeM: { x: 0.62, y: 0.58, z: 0.5 } },
      { id: "atlas-adcs", name: "High-stability ADCS", kind: "attitude", attached: true, mountAxis: "+X", massKg: 44, nominalPowerW: 135, envelopeM: { x: 0.48, y: 0.42, z: 0.34 } },
      { id: "atlas-thermal", name: "Payload thermal-control unit", kind: "thermal", attached: true, mountAxis: "-Y", massKg: 24, nominalPowerW: 90, envelopeM: { x: 0.52, y: 0.12, z: 0.7 } },
    ],
  },
];

export function cloneInventory(items: SatelliteInventoryItem[] = DEFAULT_EO_SATELLITES) {
  return items.map((item) => structuredClone(item));
}

export function isBodyAxis(value: unknown): value is BodyAxis {
  return typeof value === "string" && BODY_AXES.includes(value as BodyAxis);
}

export function isSatelliteInventoryItem(value: unknown): value is SatelliteInventoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SatelliteInventoryItem>;
  return Boolean(
    typeof item.id === "string" &&
      typeof item.name === "string" &&
      item.geometry &&
      Number.isFinite(item.geometry.massKg) &&
      Number.isFinite(item.geometry.payloadApertureM) &&
      item.geometry.dimensionsM &&
      Number.isFinite(item.geometry.dimensionsM.x) &&
      Number.isFinite(item.geometry.dimensionsM.y) &&
      Number.isFinite(item.geometry.dimensionsM.z) &&
      item.frames &&
      isBodyAxis(item.frames.velocityAxis) &&
      isBodyAxis(item.frames.nadirAxis) &&
      isBodyAxis(item.frames.payloadBoresightAxis) &&
      isBodyAxis(item.frames.solarCellNormalAxis) &&
      item.array &&
      (item.array.wingLayout === "single" || item.array.wingLayout === "dual") &&
      isBodyAxis(item.array.deploymentAxis) &&
      Number.isFinite(item.array.panelsPerWing) &&
      Number.isFinite(item.array.panelLengthM) &&
      Number.isFinite(item.array.panelWidthM) &&
      Number.isFinite(item.array.deployedAngleDeg) &&
      Number.isFinite(item.array.packagingEfficiency) &&
      Number.isFinite(item.array.seriesCells) &&
      Number.isFinite(item.array.parallelStrings) &&
      item.missionDefaults &&
      ["Nadir pointing", "Sun pointing", "Mission profile / DIL"].includes(item.missionDefaults.attitudeMode ?? "") &&
      item.powerDefaults &&
      Number.isFinite(item.powerDefaults.mpptEfficiency) &&
      (!item.subsystems || (
        Array.isArray(item.subsystems) && item.subsystems.every((subsystem) =>
          typeof subsystem.id === "string" &&
          typeof subsystem.name === "string" &&
          SUBSYSTEM_KINDS.includes(subsystem.kind) &&
          typeof subsystem.attached === "boolean" &&
          isBodyAxis(subsystem.mountAxis) &&
          Number.isFinite(subsystem.massKg) &&
          Number.isFinite(subsystem.nominalPowerW) &&
          Number.isFinite(subsystem.envelopeM?.x) &&
          Number.isFinite(subsystem.envelopeM?.y) &&
          Number.isFinite(subsystem.envelopeM?.z) &&
          (!subsystem.catalogPartId || typeof subsystem.catalogPartId === "string") &&
          (!subsystem.functionalAxis || isBodyAxis(subsystem.functionalAxis)) &&
          (!subsystem.faceOffsetM || (
            Number.isFinite(subsystem.faceOffsetM.u) &&
            Number.isFinite(subsystem.faceOffsetM.v) &&
            Number.isFinite(subsystem.faceOffsetM.normal)
          )) &&
          (!subsystem.rotationDeg || (
            Number.isFinite(subsystem.rotationDeg.x) &&
            Number.isFinite(subsystem.rotationDeg.y) &&
            Number.isFinite(subsystem.rotationDeg.z)
          ))
        )
      )),
  );
}

export interface SatelliteInventoryImportResult {
  items: SatelliteInventoryItem[];
  rejectedCount: number;
}

export interface SatelliteInventoryMergeResult {
  inventory: SatelliteInventoryItem[];
  addedIds: string[];
  updatedIds: string[];
  unchangedIds: string[];
}

export function readSatelliteInventoryPayload(payload: unknown): SatelliteInventoryImportResult {
  const candidates = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload && "satellites" in payload
      ? (payload as { satellites: unknown }).satellites
      : [payload];
  if (!Array.isArray(candidates)) throw new Error("The satellites field must be an array");

  const byId = new Map<string, SatelliteInventoryItem>();
  let rejectedCount = 0;
  for (const candidate of candidates) {
    if (!isSatelliteInventoryItem(candidate)) {
      rejectedCount += 1;
      continue;
    }
    byId.set(candidate.id, structuredClone(candidate));
  }
  const items = [...byId.values()];
  if (items.length === 0) throw new Error("No valid spacecraft records were found");
  return { items, rejectedCount };
}

export function mergeSatelliteInventory(
  current: SatelliteInventoryItem[],
  imported: SatelliteInventoryItem[],
): SatelliteInventoryMergeResult {
  const importedById = new Map(imported.map((item) => [item.id, structuredClone(item)]));
  const addedIds: string[] = [];
  const updatedIds: string[] = [];
  const unchangedIds: string[] = [];

  const inventory = current.map((item) => {
    const incoming = importedById.get(item.id);
    if (!incoming) return item;
    importedById.delete(item.id);
    if (JSON.stringify(item) === JSON.stringify(incoming)) unchangedIds.push(item.id);
    else updatedIds.push(item.id);
    return incoming;
  });

  for (const incoming of importedById.values()) {
    inventory.push(incoming);
    addedIds.push(incoming.id);
  }
  return { inventory, addedIds, updatedIds, unchangedIds };
}

export function activeArrayAreaM2(item: SatelliteInventoryItem) {
  const wingCount = item.array.wingLayout === "dual" ? 2 : 1;
  return (
    wingCount *
    item.array.panelLengthM *
    item.array.panelWidthM *
    item.array.packagingEfficiency
  );
}

export function arrayConfigurationLabel(item: SatelliteInventoryItem) {
  return `${item.array.seriesCells}S × ${item.array.parallelStrings}P`;
}

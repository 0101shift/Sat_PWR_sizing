import {
  arrayPowerSample,
  parallelStringAvailability,
  type MissionConfig,
  type PowerConfig,
  type SignedAxis,
  type SimulationPoint,
  type Vector3,
} from "./orbit-model";

export const DIL_REQUIRED_FIELDS = [
  "TIME",
  "SATELLITE_POSITION",
  "SOLAR_POWER_GENERATED",
  "SPACECRAFT_OPERATION",
  "LATITUDE",
  "LONGITUDE",
  "SUN_BODY",
  "EARTH_BODY",
  "SUNLIT_STATUS",
  "ATTITUDE_RPY",
  "PAYLOAD_EARTH",
  "PAYLOAD_SUN",
] as const;

export const DIL_TEMPLATE_FIELDS = [
  ...DIL_REQUIRED_FIELDS,
  "SOLAR_PANEL_AXIS",
  "SUN_PANEL_INCIDENCE",
] as const;

export type DilRecord = {
  timeLabel: string;
  timeSec: number;
  satellitePositionKm: Vector3;
  latitudeDeg: number;
  longitudeDeg: number;
  sunBody: Vector3;
  earthBody: Vector3;
  attitudeRpyDeg: Vector3;
  sunPanelReference: string;
  referencePanelIncidenceDeg?: number;
  payloadSun: string;
  payloadEarth: string;
  payloadSunAngleDeg?: number;
  payloadEarthAngleDeg?: number;
  sunlitStatus: string;
  spacecraftOperation: string;
  solarPowerGeneratedW: number;
};

export type ParsedDilData = {
  fileName: string;
  records: DilRecord[];
  energySeries: DilEnergySeries;
  powerSemantics: DilPowerSemantics;
  referencePanelAxis?: SignedAxis;
  referenceAxisSource: DilReferenceAxisSource;
  referenceVectorMaeDeg: number;
  referenceVectorMismatchPct: number;
  sourceRecordCount: number;
  epochMs?: number;
  warnings: string[];
};

export type DilEnergySeries = {
  timeSec: Float64Array;
  sunBodyXyz: Float32Array;
  panelIncidenceDeg: Float32Array;
  sunlightFactor: Float32Array;
  measuredPowerW: Float32Array;
  operationIndex: Uint32Array;
  operations: string[];
};

export type DilPowerSemantics = "WATTS" | "PERCENT_MAX";
export type DilReferenceAxisSource = "EXPLICIT_COLUMN" | "LEGACY_COLUMN" | "USER_OVERRIDE" | "INFERRED" | "NONE";
export const DIL_LOAD_ILLUMINATION_STATES = ["SUNLIT", "ECLIPSE"] as const;
export type DilLoadIlluminationState = (typeof DIL_LOAD_ILLUMINATION_STATES)[number];

const MAX_EXTRAPOLATED_RECORDS = 120_000;

function medianPositiveStep(records: DilRecord[]) {
  const steps = records.slice(1)
    .map((record, index) => record.timeSec - records[index].timeSec)
    .filter((step) => step > 0)
    .sort((a, b) => a - b);
  return steps.length ? steps[Math.floor(steps.length / 2)] : 1;
}

function energySeriesFromRecords(records: DilRecord[]): DilEnergySeries {
  const operations: string[] = [];
  const operationLookup = new Map<string, number>();
  const timeSec = new Float64Array(records.length);
  const sunBodyXyz = new Float32Array(records.length * 3);
  const panelIncidenceDeg = new Float32Array(records.length);
  const sunlightFactor = new Float32Array(records.length);
  const measuredPowerW = new Float32Array(records.length);
  const operationIndex = new Uint32Array(records.length);
  records.forEach((record, index) => {
    timeSec[index] = record.timeSec;
    sunBodyXyz[index * 3] = record.sunBody[0];
    sunBodyXyz[index * 3 + 1] = record.sunBody[1];
    sunBodyXyz[index * 3 + 2] = record.sunBody[2];
    panelIncidenceDeg[index] = record.referencePanelIncidenceDeg ?? Number.NaN;
    sunlightFactor[index] = dilSunlightFactor(record.sunlitStatus);
    measuredPowerW[index] = record.solarPowerGeneratedW;
    let operation = operationLookup.get(record.spacecraftOperation);
    if (operation === undefined) {
      operation = operations.length;
      operationLookup.set(record.spacecraftOperation, operation);
      operations.push(record.spacecraftOperation);
    }
    operationIndex[index] = operation;
  });
  return { timeSec, sunBodyXyz, panelIncidenceDeg, sunlightFactor, measuredPowerW, operationIndex, operations };
}

/**
 * Repeats (or crops) the imported sequence to the configured mission duration.
 * The source upload remains unchanged; this derived replay is only used by the
 * simulator and carries an explicit warning when sampling must be reduced.
 */
export function extrapolateDilData(source: ParsedDilData, targetDurationSec: number): ParsedDilData {
  if (!source.records.length || targetDurationSec <= 0) return source;
  const sourceStartSec = source.records[0].timeSec;
  const stepSec = medianPositiveStep(source.records);
  const sourceSpanSec = Math.max(0, source.records[source.records.length - 1].timeSec - sourceStartSec);
  const wholeDaySpan = Math.round(sourceSpanSec / 86400) * 86400;
  const lastSampleClosesCycle = wholeDaySpan > 0 && Math.abs(sourceSpanSec - wholeDaySpan) <= stepSec * 0.25;
  const cycleSec = Math.max(stepSec, lastSampleClosesCycle ? sourceSpanSec : sourceSpanSec + stepSec);
  const cycleCount = Math.max(1, Math.ceil(targetDurationSec / cycleSec));
  const maximumPerCycle = Math.max(2, Math.floor(MAX_EXTRAPOLATED_RECORDS / cycleCount));
  const stride = Math.max(1, Math.ceil(source.records.length / maximumPerCycle));
  const baseRecords = source.records.filter((record, index, records) => {
    if (index === 0 || index === records.length - 1 || index % stride === 0) return true;
    const previous = records[index - 1];
    return record.spacecraftOperation !== previous.spacecraftOperation
      || dilLoadIlluminationState(dilSunlightFactor(record.sunlitStatus))
        !== dilLoadIlluminationState(dilSunlightFactor(previous.sunlitStatus));
  });
  const records: DilRecord[] = [];
  for (let cycle = 0; cycle < cycleCount; cycle += 1) {
    for (const record of baseRecords) {
      const timeSec = cycle * cycleSec + (record.timeSec - sourceStartSec);
      if (timeSec > targetDurationSec + 1e-9) break;
      records.push({ ...record, timeSec, timeLabel: `D${Math.floor(timeSec / 86400) + 1} +${Math.round(timeSec % 86400)}s` });
    }
  }
  const last = records[records.length - 1];
  if (last && last.timeSec < targetDurationSec - 1e-9) {
    const cycleOffsetSec = targetDurationSec % cycleSec;
    const template = baseRecords.reduce((nearest, record) => (
      Math.abs((record.timeSec - sourceStartSec) - cycleOffsetSec)
        < Math.abs((nearest.timeSec - sourceStartSec) - cycleOffsetSec) ? record : nearest
    ), baseRecords[0]);
    records.push({
      ...template,
      timeSec: targetDurationSec,
      timeLabel: `D${Math.floor(targetDurationSec / 86400) + 1} +${Math.round(targetDurationSec % 86400)}s`,
    });
  }
  return {
    ...source,
    records,
    energySeries: energySeriesFromRecords(records),
    warnings: [
      ...source.warnings,
      `DIL replay repeated to ${Math.round(targetDurationSec / 3600 * 10) / 10} h for mission-duration energy and SOC analysis.`,
      ...(stride > 1 ? [`Extrapolated replay sampled every ${stride} source rows to keep the dashboard responsive.`] : []),
    ],
  };
}

export function dilLoadIlluminationState(sunlightFactor: number): DilLoadIlluminationState {
  // Penumbra uses the eclipse load profile for conservative sizing while its
  // actual fractional illumination continues to drive generated power.
  return sunlightFactor >= 0.98 ? "SUNLIT" : "ECLIPSE";
}

export function dilOperationLoadKey(operation: string, illumination: DilLoadIlluminationState) {
  return JSON.stringify([operation, illumination]);
}

export type DilOperationEnergy = {
  operation: string;
  illumination: DilLoadIlluminationState;
  durationSec: number;
  sunlitSec: number;
  averageIncidenceDeg: number;
  measuredEnergyWh: number;
  modeledEnergyWh: number;
  perfectPointingEnergyWh: number;
};

export type DilOperationLoad = {
  operation: string;
  illumination: DilLoadIlluminationState;
  maxLoadW?: number;
  loadEnergyWh?: number;
  netEnergyWh?: number;
};

export type DilOperationLoadAnalysis = {
  complete: boolean;
  missingOperations: string[];
  loadEnergyWh?: number;
  worstCaseAverageLoadW?: number;
  netEnergyWh?: number;
  operations: DilOperationLoad[];
};

export type DilEnergyAnalysis = {
  durationSec: number;
  measuredEnergyWh: number;
  modeledEnergyWh: number;
  perfectPointingEnergyWh: number;
  averageMeasuredPowerW: number;
  averageModeledPowerW: number;
  peakMeasuredPowerW: number;
  peakModeledPowerW: number;
  modeledCapturePct: number;
  measuredToModeledPct: number;
  illuminatedPct: number;
  operationTransitions: number;
  averageSampleSec: number;
  recordedIncidencePct: number;
  operations: DilOperationEnergy[];
};

export function analyzeDilOperationLoads(
  analysis: DilEnergyAnalysis,
  maxLoadsW: Readonly<Record<string, number | undefined>>,
): DilOperationLoadAnalysis {
  const missingOperations: string[] = [];
  let loadEnergyWh = 0;
  const operations = analysis.operations.map((operation): DilOperationLoad => {
    const rawLoadW = maxLoadsW[dilOperationLoadKey(operation.operation, operation.illumination)];
    if (!Number.isFinite(rawLoadW) || (rawLoadW ?? -1) < 0) {
      if (operation.durationSec > 0) missingOperations.push(`${operation.operation} · ${operation.illumination}`);
      return { operation: operation.operation, illumination: operation.illumination };
    }
    const maxLoadW = Math.max(0, rawLoadW as number);
    const operationLoadEnergyWh = maxLoadW * operation.durationSec / 3600;
    loadEnergyWh += operationLoadEnergyWh;
    return {
      operation: operation.operation,
      illumination: operation.illumination,
      maxLoadW,
      loadEnergyWh: operationLoadEnergyWh,
      netEnergyWh: operation.measuredEnergyWh - operationLoadEnergyWh,
    };
  });
  const complete = missingOperations.length === 0 && analysis.operations.some((operation) => operation.durationSec > 0);
  return {
    complete,
    missingOperations,
    loadEnergyWh: complete ? loadEnergyWh : undefined,
    worstCaseAverageLoadW: complete && analysis.durationSec > 0
      ? loadEnergyWh * 3600 / analysis.durationSec
      : undefined,
    netEnergyWh: complete ? analysis.measuredEnergyWh - loadEnergyWh : undefined,
    operations,
  };
}

export type DilAxisEnergy = {
  axis: SignedAxis;
  energyWh: number;
  averagePowerW: number;
  capturePct: number;
  rank: number;
};

export type DilParseOptions = {
  sampleIntervalSec?: number;
  referencePanelAxis?: SignedAxis;
};

const MAX_DIL_REPLAY_RECORDS = 60_000;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const SIGNED_PANEL_AXES: SignedAxis[] = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];

function parseSignedAxis(value: unknown): SignedAxis | undefined {
  const normalized = textValue(value).replace(/\s+/g, "").toUpperCase();
  const candidate = normalized.length === 1 ? `+${normalized}` : normalized;
  return SIGNED_PANEL_AXES.includes(candidate as SignedAxis) ? candidate as SignedAxis : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function dot(a: Vector3, b: Vector3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function magnitude(vector: Vector3) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Vector3, fallback: Vector3 = [1, 0, 0]): Vector3 {
  const length = magnitude(vector);
  return length > 1e-12 ? [vector[0] / length, vector[1] / length, vector[2] / length] : fallback;
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vector3, b: Vector3): Vector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(vector: Vector3, amount: number): Vector3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function signedAxisVector(axis: SignedAxis): Vector3 {
  const sign = axis[0] === "-" ? -1 : 1;
  if (axis[1] === "X") return [sign, 0, 0];
  if (axis[1] === "Y") return [0, sign, 0];
  return [0, 0, sign];
}

function inferredDeploymentAxis(facingAxis: SignedAxis): SignedAxis {
  if (facingAxis.endsWith("X")) return "+Y";
  if (facingAxis.endsWith("Y")) return "+Z";
  return "+Y";
}

function rotateX(vector: Vector3, angle: number): Vector3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [vector[0], vector[1] * cosine - vector[2] * sine, vector[1] * sine + vector[2] * cosine];
}

function rotateY(vector: Vector3, angle: number): Vector3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [vector[0] * cosine + vector[2] * sine, vector[1], -vector[0] * sine + vector[2] * cosine];
}

function rotateZ(vector: Vector3, angle: number): Vector3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [vector[0] * cosine - vector[1] * sine, vector[0] * sine + vector[1] * cosine, vector[2]];
}

function applyPanelMounting(vector: Vector3, mission: MissionConfig) {
  return normalize(rotateZ(
    rotateY(rotateX(vector, mission.panelRotationXDeg * DEG), mission.panelRotationYDeg * DEG),
    mission.panelRotationZDeg * DEG,
  ));
}

function rpyBodyAxes([rollDeg, pitchDeg, yawDeg]: Vector3): [Vector3, Vector3, Vector3] {
  const roll = rollDeg * DEG;
  const pitch = pitchDeg * DEG;
  const yaw = yawDeg * DEG;
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  return [
    [cy * cp, sy * cp, -sp],
    [cy * sp * sr - sy * cr, sy * sp * sr + cy * cr, cp * sr],
    [cy * sp * cr + sy * sr, sy * sp * cr - cy * sr, cp * cr],
  ];
}

function bodyToInertial(body: Vector3, axes: [Vector3, Vector3, Vector3]): Vector3 {
  return [
    axes[0][0] * body[0] + axes[1][0] * body[1] + axes[2][0] * body[2],
    axes[0][1] * body[0] + axes[1][1] * body[1] + axes[2][1] * body[2],
    axes[0][2] * body[0] + axes[1][2] * body[1] + axes[2][2] * body[2],
  ];
}

function inertialToBody(vector: Vector3, axes: [Vector3, Vector3, Vector3]): Vector3 {
  return [dot(vector, axes[0]), dot(vector, axes[1]), dot(vector, axes[2])];
}

function closestVectorAtIncidence(rawDirection: Vector3, normal: Vector3, incidenceDeg: number): Vector3 {
  const unitNormal = normalize(normal);
  const raw = normalize(rawDirection, unitNormal);
  const tangentRaw = subtract(raw, scale(unitNormal, dot(raw, unitNormal)));
  const fallbackTangent = Math.abs(unitNormal[0]) < 0.8
    ? normalize(cross(unitNormal, [1, 0, 0]))
    : normalize(cross(unitNormal, [0, 1, 0]));
  const tangent = normalize(tangentRaw, fallbackTangent);
  const angle = clamp(incidenceDeg, 0, 180) * DEG;
  return normalize(add(scale(unitNormal, Math.cos(angle)), scale(tangent, Math.sin(angle))));
}

function rotateFromTo(vector: Vector3, fromDirection: Vector3, toDirection: Vector3): Vector3 {
  const from = normalize(fromDirection);
  const to = normalize(toDirection);
  const cosine = clamp(dot(from, to), -1, 1);
  if (cosine > 1 - 1e-12) return vector;
  let axis = cross(from, to);
  if (magnitude(axis) < 1e-10) {
    const fallback = Math.abs(from[0]) < 0.8 ? [1, 0, 0] as Vector3 : [0, 1, 0] as Vector3;
    axis = normalize(cross(from, fallback));
  } else {
    axis = normalize(axis);
  }
  const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
  return add(
    add(scale(vector, cosine), scale(cross(axis, vector), sine)),
    scale(axis, dot(axis, vector) * (1 - cosine)),
  );
}

function payloadBoresightFromAngles(
  preferredDirection: Vector3,
  earthDirection: Vector3,
  sunDirectionBody: Vector3,
  earthAngleDeg?: number,
  sunAngleDeg?: number,
) {
  const preferred = normalize(preferredDirection);
  const earth = normalize(earthDirection, preferred);
  const sun = normalize(sunDirectionBody, preferred);
  const hasEarth = earthAngleDeg !== undefined && Number.isFinite(earthAngleDeg);
  const hasSun = sunAngleDeg !== undefined && Number.isFinite(sunAngleDeg);
  if (hasEarth && !hasSun) return closestVectorAtIncidence(preferred, earth, earthAngleDeg!);
  if (!hasEarth && hasSun) return closestVectorAtIncidence(preferred, sun, sunAngleDeg!);
  if (!hasEarth || !hasSun) return preferred;

  const earthCosine = Math.cos(clamp(earthAngleDeg!, 0, 180) * DEG);
  const sunCosine = Math.cos(clamp(sunAngleDeg!, 0, 180) * DEG);
  const separationCosine = clamp(dot(earth, sun), -1, 1);
  const determinant = 1 - separationCosine * separationCosine;
  if (determinant < 1e-8) {
    const primary = closestVectorAtIncidence(preferred, earth, earthAngleDeg!);
    return closestVectorAtIncidence(primary, sun, sunAngleDeg!);
  }

  const earthWeight = (earthCosine - separationCosine * sunCosine) / determinant;
  const sunWeight = (sunCosine - separationCosine * earthCosine) / determinant;
  const inPlane = add(scale(earth, earthWeight), scale(sun, sunWeight));
  const remainingSquared = 1 - dot(inPlane, inPlane);
  if (remainingSquared <= 1e-10) return normalize(inPlane, preferred);
  const normal = normalize(cross(earth, sun));
  const offset = scale(normal, Math.sqrt(remainingSquared));
  const positive = normalize(add(inPlane, offset));
  const negative = normalize(subtract(inPlane, offset));
  return dot(positive, preferred) >= dot(negative, preferred) ? positive : negative;
}

export function dilSunlightFactor(status: string) {
  const normalized = status.trim().toUpperCase();
  const numeric = Number(normalized);
  if (normalized !== "" && Number.isFinite(numeric)) return clamp(numeric, 0, 1);
  if (normalized.includes("PENUMBRA") || normalized.includes("PARTIAL")) return 0.5;
  if (["ECLIPSE", "UMBRA", "DARK", "NIGHT", "FALSE", "NO"].some((word) => normalized.includes(word))) return 0;
  if (["SUNLIT", "SUNLIGHT", "LIGHT", "DAY", "TRUE", "YES"].some((word) => normalized.includes(word))) return 1;
  return 1;
}

export function analyzeDilEnergy(
  series: DilEnergySeries,
  mission: MissionConfig,
  power: PowerConfig,
  epochMs?: number,
  powerSemantics: DilPowerSemantics = "WATTS",
  referencePanelAxis?: SignedAxis,
): DilEnergyAnalysis {
  const count = series.timeSec.length;
  const configuredEpochMs = new Date(mission.epoch).getTime();
  const analysisEpochMs = epochMs
    ?? (Number.isFinite(configuredEpochMs) ? configuredEpochMs : Date.UTC(2026, 0, 1));
  const panelNormalBody = applyPanelMounting(signedAxisVector(mission.panelFacingAxis), mission);
  const referenceIncidenceApplies = referencePanelAxis === mission.panelFacingAxis
    && Math.abs(mission.panelRotationXDeg) < 1e-9
    && Math.abs(mission.panelRotationYDeg) < 1e-9
    && Math.abs(mission.panelRotationZDeg) < 1e-9;

  let recordedIncidenceSamples = 0;
  for (let index = 0; index < count; index += 1) {
    if (Number.isFinite(series.panelIncidenceDeg[index])) recordedIncidenceSamples += 1;
  }
  const configuredReferenceDate = new Date(
    Number.isFinite(configuredEpochMs) ? configuredEpochMs : analysisEpochMs,
  );
  const correctedEolReferencePowerW = arrayPowerSample(power, configuredReferenceDate, 0, 1).effectiveBusPowerW;
  const stringAvailability = parallelStringAvailability(power);
  type OperationAccumulator = DilOperationEnergy & { incidenceDegSec: number };
  const operationAccumulators = series.operations.flatMap((operation) =>
    DIL_LOAD_ILLUMINATION_STATES.map((illumination): OperationAccumulator => ({
      operation,
      illumination,
      durationSec: 0,
      sunlitSec: 0,
      averageIncidenceDeg: 0,
      incidenceDegSec: 0,
      measuredEnergyWh: 0,
      modeledEnergyWh: 0,
      perfectPointingEnergyWh: 0,
    })),
  );
  const accumulatorIndex = (operationIndex: number, illumination: DilLoadIlluminationState) =>
    operationIndex * DIL_LOAD_ILLUMINATION_STATES.length
      + DIL_LOAD_ILLUMINATION_STATES.indexOf(illumination);
  const evaluate = (index: number) => {
    const sunBody: Vector3 = [
      series.sunBodyXyz[index * 3],
      series.sunBodyXyz[index * 3 + 1],
      series.sunBodyXyz[index * 3 + 2],
    ];
    const referenceIncidenceDeg = series.panelIncidenceDeg[index];
    const incidenceDeg = referenceIncidenceApplies && Number.isFinite(referenceIncidenceDeg)
      ? clamp(referenceIncidenceDeg, 0, 180)
      : Math.acos(clamp(dot(panelNormalBody, sunBody), -1, 1)) * RAD;
    const shadowFactor = series.sunlightFactor[index];
    const date = new Date(analysisEpochMs + series.timeSec[index] * 1000);
    const modeledPowerW = arrayPowerSample(power, date, incidenceDeg, shadowFactor).effectiveBusPowerW;
    const perfectPointingPowerW = arrayPowerSample(power, date, -power.pointingErrorDeg, shadowFactor).effectiveBusPowerW;
    const rawPowerValue = series.measuredPowerW[index];
    return {
      incidenceDeg,
      shadowFactor,
      modeledPowerW,
      perfectPointingPowerW,
      measuredPowerW: powerSemantics === "PERCENT_MAX"
        ? clamp(rawPowerValue, 0, 100) / 100 * correctedEolReferencePowerW
        : rawPowerValue * stringAvailability.powerRetention,
      operationIndex: series.operationIndex[index],
      illumination: dilLoadIlluminationState(shadowFactor),
    };
  };

  if (!count) {
    return {
      durationSec: 0,
      measuredEnergyWh: 0,
      modeledEnergyWh: 0,
      perfectPointingEnergyWh: 0,
      averageMeasuredPowerW: 0,
      averageModeledPowerW: 0,
      peakMeasuredPowerW: 0,
      peakModeledPowerW: 0,
      modeledCapturePct: 0,
      measuredToModeledPct: 0,
      illuminatedPct: 0,
      operationTransitions: 0,
      averageSampleSec: 0,
      recordedIncidencePct: 0,
      operations: [],
    };
  }

  let previous = evaluate(0);
  let measuredEnergyWh = 0;
  let modeledEnergyWh = 0;
  let perfectPointingEnergyWh = 0;
  let illuminatedSec = 0;
  let operationTransitions = 0;
  let peakMeasuredPowerW = previous.measuredPowerW;
  let peakModeledPowerW = previous.modeledPowerW;
  for (let index = 1; index < count; index += 1) {
    const current = evaluate(index);
    const dtSec = Math.max(0, series.timeSec[index] - series.timeSec[index - 1]);
    const measuredIntervalWh = (previous.measuredPowerW + current.measuredPowerW) * 0.5 * dtSec / 3600;
    const modeledIntervalWh = (previous.modeledPowerW + current.modeledPowerW) * 0.5 * dtSec / 3600;
    const perfectIntervalWh = (previous.perfectPointingPowerW + current.perfectPointingPowerW) * 0.5 * dtSec / 3600;
    measuredEnergyWh += measuredIntervalWh;
    modeledEnergyWh += modeledIntervalWh;
    perfectPointingEnergyWh += perfectIntervalWh;
    illuminatedSec += (previous.shadowFactor + current.shadowFactor) * 0.5 * dtSec;
    peakMeasuredPowerW = Math.max(peakMeasuredPowerW, current.measuredPowerW);
    peakModeledPowerW = Math.max(peakModeledPowerW, current.modeledPowerW);

    const previousAccumulatorIndex = accumulatorIndex(previous.operationIndex, previous.illumination);
    const currentAccumulatorIndex = accumulatorIndex(current.operationIndex, current.illumination);
    if (previousAccumulatorIndex === currentAccumulatorIndex) {
      const accumulator = operationAccumulators[previousAccumulatorIndex];
      accumulator.durationSec += dtSec;
      accumulator.sunlitSec += (previous.shadowFactor + current.shadowFactor) * 0.5 * dtSec;
      accumulator.incidenceDegSec += (previous.incidenceDeg + current.incidenceDeg) * 0.5 * dtSec;
      accumulator.measuredEnergyWh += measuredIntervalWh;
      accumulator.modeledEnergyWh += modeledIntervalWh;
      accumulator.perfectPointingEnergyWh += perfectIntervalWh;
    } else {
      if (previous.operationIndex !== current.operationIndex) operationTransitions += 1;
      const previousAccumulator = operationAccumulators[previousAccumulatorIndex];
      const currentAccumulator = operationAccumulators[currentAccumulatorIndex];
      const halfDurationSec = dtSec / 2;
      previousAccumulator.durationSec += halfDurationSec;
      previousAccumulator.sunlitSec += previous.shadowFactor * halfDurationSec;
      previousAccumulator.incidenceDegSec += previous.incidenceDeg * halfDurationSec;
      previousAccumulator.measuredEnergyWh += previous.measuredPowerW * halfDurationSec / 3600;
      previousAccumulator.modeledEnergyWh += previous.modeledPowerW * halfDurationSec / 3600;
      previousAccumulator.perfectPointingEnergyWh += previous.perfectPointingPowerW * halfDurationSec / 3600;
      currentAccumulator.durationSec += halfDurationSec;
      currentAccumulator.sunlitSec += current.shadowFactor * halfDurationSec;
      currentAccumulator.incidenceDegSec += current.incidenceDeg * halfDurationSec;
      currentAccumulator.measuredEnergyWh += current.measuredPowerW * halfDurationSec / 3600;
      currentAccumulator.modeledEnergyWh += current.modeledPowerW * halfDurationSec / 3600;
      currentAccumulator.perfectPointingEnergyWh += current.perfectPointingPowerW * halfDurationSec / 3600;
    }
    previous = current;
  }
  const durationSec = Math.max(0, series.timeSec[count - 1] - series.timeSec[0]);
  const operations = operationAccumulators
    .map(({ incidenceDegSec, ...operation }) => ({
      ...operation,
      averageIncidenceDeg: operation.durationSec > 0 ? incidenceDegSec / operation.durationSec : 0,
    }));
  return {
    durationSec,
    measuredEnergyWh,
    modeledEnergyWh,
    perfectPointingEnergyWh,
    averageMeasuredPowerW: durationSec > 0 ? measuredEnergyWh * 3600 / durationSec : series.measuredPowerW[0],
    averageModeledPowerW: durationSec > 0 ? modeledEnergyWh * 3600 / durationSec : previous.modeledPowerW,
    peakMeasuredPowerW,
    peakModeledPowerW,
    modeledCapturePct: perfectPointingEnergyWh > 0 ? modeledEnergyWh / perfectPointingEnergyWh * 100 : 0,
    measuredToModeledPct: modeledEnergyWh > 0 ? measuredEnergyWh / modeledEnergyWh * 100 : 0,
    illuminatedPct: durationSec > 0 ? illuminatedSec / durationSec * 100 : previous.shadowFactor * 100,
    operationTransitions,
    averageSampleSec: count > 1 ? durationSec / (count - 1) : 0,
    recordedIncidencePct: count > 0 ? recordedIncidenceSamples / count * 100 : 0,
    operations,
  };
}

export function analyzeDilAxisSweep(
  series: DilEnergySeries,
  mission: MissionConfig,
  power: PowerConfig,
  epochMs?: number,
  referencePanelAxis?: SignedAxis,
): DilAxisEnergy[] {
  const count = series.timeSec.length;
  const axes: SignedAxis[] = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];
  if (!count) return axes.map((axis, index) => ({ axis, energyWh: 0, averagePowerW: 0, capturePct: 0, rank: index + 1 }));
  const panelNormals = axes.map((axis) => applyPanelMounting(signedAxisVector(axis), mission));
  const configuredEpochMs = new Date(mission.epoch).getTime();
  const analysisEpochMs = epochMs
    ?? (Number.isFinite(configuredEpochMs) ? configuredEpochMs : Date.UTC(2026, 0, 1));
  const pointingErrorDeg = Math.max(0, power.pointingErrorDeg);
  const referenceIncidenceApplies = Math.abs(mission.panelRotationXDeg) < 1e-9
    && Math.abs(mission.panelRotationYDeg) < 1e-9
    && Math.abs(mission.panelRotationZDeg) < 1e-9;
  const axisEnergyWh = new Float64Array(axes.length);
  let perfectPointingEnergyWh = 0;
  const evaluate = (index: number) => {
    const sunBody: Vector3 = [
      series.sunBodyXyz[index * 3],
      series.sunBodyXyz[index * 3 + 1],
      series.sunBodyXyz[index * 3 + 2],
    ];
    const date = new Date(analysisEpochMs + series.timeSec[index] * 1000);
    const perfectPowerW = arrayPowerSample(
      power,
      date,
      -pointingErrorDeg,
      series.sunlightFactor[index],
    ).effectiveBusPowerW;
    return {
      perfectPowerW,
      axisPowerW: panelNormals.map((normal, axisIndex) => {
        const importedReferenceIncidenceDeg = series.panelIncidenceDeg[index];
        const incidenceDeg = referenceIncidenceApplies
          && axes[axisIndex] === referencePanelAxis
          && Number.isFinite(importedReferenceIncidenceDeg)
          ? clamp(importedReferenceIncidenceDeg, 0, 180)
          : Math.acos(clamp(dot(normal, sunBody), -1, 1)) * RAD;
        return arrayPowerSample(power, date, incidenceDeg, series.sunlightFactor[index]).effectiveBusPowerW;
      }),
    };
  };
  let previous = evaluate(0);
  for (let index = 1; index < count; index += 1) {
    const current = evaluate(index);
    const dtSec = Math.max(0, series.timeSec[index] - series.timeSec[index - 1]);
    perfectPointingEnergyWh += (previous.perfectPowerW + current.perfectPowerW) * 0.5 * dtSec / 3600;
    for (let axisIndex = 0; axisIndex < axes.length; axisIndex += 1) {
      axisEnergyWh[axisIndex] += (previous.axisPowerW[axisIndex] + current.axisPowerW[axisIndex]) * 0.5 * dtSec / 3600;
    }
    previous = current;
  }
  const durationSec = Math.max(0, series.timeSec[count - 1] - series.timeSec[0]);
  const results = axes.map((axis, index) => ({
    axis,
    energyWh: axisEnergyWh[index],
    averagePowerW: durationSec > 0 ? axisEnergyWh[index] * 3600 / durationSec : previous.axisPowerW[index],
    capturePct: perfectPointingEnergyWh > 0 ? axisEnergyWh[index] / perfectPointingEnergyWh * 100 : 0,
    rank: 0,
  }));
  [...results]
    .sort((a, b) => b.energyWh - a.energyWh)
    .forEach((result, index) => { result.rank = index + 1; });
  return results;
}

/**
 * Converts imported DIL samples into the shared render/plot format.
 * RPY is interpreted as degrees using Rz(yaw) · Ry(pitch) · Rx(roll), body to ECI.
 */
export function buildDilSimulation(
  records: DilRecord[],
  mission: MissionConfig,
  power: PowerConfig,
  epochMs?: number,
  powerSemantics: DilPowerSemantics = "WATTS",
  referencePanelAxis?: SignedAxis,
  payloadBoresightAxis: SignedAxis = mission.nadirBodyAxis,
  operationMaxLoadsW?: Readonly<Record<string, number | undefined>>,
  integrateOperationLoads = true,
): SimulationPoint[] {
  if (!records.length) return [];
  let batteryWh = power.batteryWh * clamp(power.initialSocPct / 100, 0, 1);
  const panelNormalBody = applyPanelMounting(signedAxisVector(mission.panelFacingAxis), mission);
  const configuredPayloadBoresightBody = signedAxisVector(payloadBoresightAxis);
  const hingeBody = applyPanelMounting(signedAxisVector(inferredDeploymentAxis(mission.panelFacingAxis)), mission);
  const configuredEpochMs = new Date(mission.epoch).getTime();
  const replayEpochMs = epochMs
    ?? (Number.isFinite(configuredEpochMs) ? configuredEpochMs : Date.UTC(2026, 0, 1));
  const configuredReferenceDate = new Date(
    Number.isFinite(configuredEpochMs) ? configuredEpochMs : replayEpochMs,
  );
  const referencePower = arrayPowerSample(power, configuredReferenceDate, 0, 1);
  const correctedEolReferencePowerW = referencePower.effectiveBusPowerW;
  const rawEolReferencePowerW = referencePower.rawPanelPowerW;
  const stringAvailability = parallelStringAvailability(power);
  const referenceIncidenceApplies = referencePanelAxis === mission.panelFacingAxis
    && Math.abs(mission.panelRotationXDeg) < 1e-9
    && Math.abs(mission.panelRotationYDeg) < 1e-9
    && Math.abs(mission.panelRotationZDeg) < 1e-9;

  // The orbit scene deliberately keeps the Sun inertially fixed. Imported RPY
  // and SUN_BODY can otherwise produce a different inertial Sun at every row,
  // making a 0° power sample look visibly off-Sun. Use the first row to define
  // the inertial lock and apply the minimum rigid attitude correction per row.
  // If the declared panel-incidence channel is authoritative, first reconcile
  // SUN_BODY to that angle; this keeps the rendered rigid panel, body axes, and
  // the incidence used by the power model in one self-consistent frame.
  const firstRawAxes = rpyBodyAxes(records[0].attitudeRpyDeg);
  const firstRawBodySun = normalize(records[0].sunBody);
  const firstIncidenceDeg = referenceIncidenceApplies && records[0].referencePanelIncidenceDeg !== undefined
    ? clamp(records[0].referencePanelIncidenceDeg, 0, 180)
    : Math.acos(clamp(dot(panelNormalBody, firstRawBodySun), -1, 1)) * RAD;
  const firstEffectiveBodySun = referenceIncidenceApplies
    ? closestVectorAtIncidence(firstRawBodySun, panelNormalBody, firstIncidenceDeg)
    : firstRawBodySun;
  const lockedSunVector = normalize(bodyToInertial(firstEffectiveBodySun, firstRawAxes));

  const geometry = records.map((record) => {
    const axes = rpyBodyAxes(record.attitudeRpyDeg);
    const rawRadius = magnitude(record.satellitePositionKm);
    return {
      axes,
      // The new DIL supplies the actual Earth-centred satellite position.
      // Preserve its direction and only auto-convert metre-scale values to km.
      positionKm: scale(record.satellitePositionKm, rawRadius > 100_000 ? 0.001 : 1),
    };
  });

  let previousMeasuredPowerW: number | undefined;
  return records.map((record, index) => {
    const previousIndex = Math.max(0, index - 1);
    const nextIndex = Math.min(records.length - 1, index + 1);
    const previous = records[previousIndex];
    const next = records[nextIndex];
    const spanSec = next.timeSec - previous.timeSec;
    const velocityKmS = spanSec > 1e-9
      ? scale(subtract(geometry[nextIndex].positionKm, geometry[previousIndex].positionKm), 1 / spanSec)
      : [0, 0, 0] as Vector3;
    const { axes: rawAxes, positionKm } = geometry[index];
    const rawBodySun = normalize(record.sunBody);
    const bodyNadir = normalize(record.earthBody, [0, 0, -1]);
    const incidenceDeg = referenceIncidenceApplies && record.referencePanelIncidenceDeg !== undefined
      ? clamp(record.referencePanelIncidenceDeg, 0, 180)
      : Math.acos(clamp(dot(panelNormalBody, rawBodySun), -1, 1)) * RAD;
    const bodySun = referenceIncidenceApplies
      ? closestVectorAtIncidence(rawBodySun, panelNormalBody, incidenceDeg)
      : rawBodySun;
    const rawEffectiveSunVector = normalize(bodyToInertial(bodySun, rawAxes));
    const axes = rawAxes.map((axis) => normalize(rotateFromTo(axis, rawEffectiveSunVector, lockedSunVector))) as [Vector3, Vector3, Vector3];
    const sunVector = lockedSunVector;
    const panelNormal = normalize(bodyToInertial(panelNormalBody, axes));
    const payloadBoresightBody = payloadBoresightFromAngles(
      configuredPayloadBoresightBody,
      bodyNadir,
      bodySun,
      record.payloadEarthAngleDeg,
      record.payloadSunAngleDeg,
    );
    const payloadBoresight = normalize(bodyToInertial(payloadBoresightBody, axes));
    const resolvedPayloadEarthAngleDeg = Math.acos(clamp(dot(payloadBoresightBody, bodyNadir), -1, 1)) * RAD;
    const resolvedPayloadSunAngleDeg = Math.acos(clamp(dot(payloadBoresightBody, bodySun), -1, 1)) * RAD;
    const payloadPointingResidualDeg = Math.max(
      record.payloadEarthAngleDeg === undefined ? 0 : Math.abs(resolvedPayloadEarthAngleDeg - record.payloadEarthAngleDeg),
      record.payloadSunAngleDeg === undefined ? 0 : Math.abs(resolvedPayloadSunAngleDeg - record.payloadSunAngleDeg),
    );
    const hingeAxis = normalize(bodyToInertial(hingeBody, axes));
    const visualIncidenceDeg = Math.acos(clamp(dot(panelNormal, sunVector), -1, 1)) * RAD;
    const attitudeCorrectionDeg = Math.acos(clamp(dot(rawEffectiveSunVector, lockedSunVector), -1, 1)) * RAD;
    const shadowFactor = dilSunlightFactor(record.sunlitStatus);
    const date = new Date(replayEpochMs + record.timeSec * 1000);
    const modeledPower = arrayPowerSample(power, date, visualIncidenceDeg, shadowFactor);
    const modeledPowerW = modeledPower.effectiveBusPowerW;
    const perfectPointingPowerW = arrayPowerSample(power, date, -power.pointingErrorDeg, shadowFactor).effectiveBusPowerW;
    const measuredPowerW = powerSemantics === "PERCENT_MAX"
      ? clamp(record.solarPowerGeneratedW, 0, 100) / 100 * correctedEolReferencePowerW
      : record.solarPowerGeneratedW * stringAvailability.powerRetention;
    const rawPanelPowerW = powerSemantics === "PERCENT_MAX"
      ? clamp(record.solarPowerGeneratedW, 0, 100) / 100 * rawEolReferencePowerW
      : modeledPower.rawPanelPowerW;
    const orbitNormal = normalize(cross(positionKm, velocityKmS), axes[2]);
    const betaDeg = Math.asin(clamp(dot(orbitNormal, sunVector), -1, 1)) * RAD;
    const dtSec = index === 0 ? 0 : Math.max(0, record.timeSec - records[index - 1].timeSec);
    const illumination = dilLoadIlluminationState(shadowFactor);
    const operationLoadW = operationMaxLoadsW?.[dilOperationLoadKey(record.spacecraftOperation, illumination)];
    if (integrateOperationLoads && operationMaxLoadsW && operationLoadW !== undefined && index > 0) {
      const previousRecord = records[index - 1];
      const previousIllumination = dilLoadIlluminationState(dilSunlightFactor(previousRecord.sunlitStatus));
      const previousLoadW = operationMaxLoadsW[dilOperationLoadKey(previousRecord.spacecraftOperation, previousIllumination)];
      if (previousLoadW !== undefined && previousMeasuredPowerW !== undefined) {
        const intervalGenerationW = (previousMeasuredPowerW + measuredPowerW) * 0.5;
        const intervalLoadW = (Math.max(0, previousLoadW) + Math.max(0, operationLoadW)) * 0.5;
        batteryWh = clamp(
          batteryWh + (intervalGenerationW - intervalLoadW) * dtSec / 3600,
          0,
          power.batteryWh,
        );
      }
    }
    previousMeasuredPowerW = measuredPowerW;
    return {
      tSec: record.timeSec,
      positionKm,
      velocityKmS,
      sunVector,
      bodySun,
      bodyVelocity: inertialToBody(normalize(velocityKmS), axes),
      bodyNadir,
      bodyXAxis: axes[0],
      bodyYAxis: axes[1],
      bodyZAxis: axes[2],
      bodyMinusZAxis: scale(axes[2], -1),
      hingeAxis,
      hingeBody,
      panelNormal,
      panelNormalBody,
      payloadBoresight,
      payloadBoresightBody,
      payloadEarthAngleDeg: resolvedPayloadEarthAngleDeg,
      payloadSunAngleDeg: resolvedPayloadSunAngleDeg,
      payloadPointingResidualDeg,
      attitudeCorrectionDeg,
      betaDeg,
      incidenceDeg: visualIncidenceDeg,
      shadowFactor,
      rawPanelPowerW,
      powerW: modeledPowerW,
      measuredPowerW,
      perfectPointingPowerW,
      dilGenerationFactorPct: powerSemantics === "PERCENT_MAX" ? record.solarPowerGeneratedW : undefined,
      operationLoadW,
      netPowerW: operationLoadW === undefined ? undefined : measuredPowerW - operationLoadW,
      socPct: power.batteryWh > 0 ? batteryWh / power.batteryWh * 100 : 0,
    };
  });
}

type SourceRow = Record<string, unknown>;

function normalizeHeader(value: string) {
  return value
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/([_\s])-([XYZ])(?=[_\s]|$)/gi, "$1MINUS$2")
    .replace(/[\s-]+/g, "_")
    .toUpperCase()
    .replace(/MINUS([XYZ])/g, "-$1");
}

function textValue(value: unknown) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function optionalAngleDeg(value: unknown) {
  const text = textValue(value);
  if (!text) return undefined;
  const match = text.match(/^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(?:°|DEG(?:REES?)?)?\s*$/i);
  if (!match) return undefined;
  const angle = Number(match[1]);
  return Number.isFinite(angle) ? clamp(angle, 0, 180) : undefined;
}

function parseVector(value: unknown, field: string, rowNumber: number): Vector3 {
  const values = Array.isArray(value)
    ? value.map(Number)
    : (String(value ?? "").match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  if (values.length !== 3 || values.some((entry) => !Number.isFinite(entry))) {
    throw new Error(`Row ${rowNumber}: ${field} must contain exactly three finite numbers.`);
  }
  return [values[0], values[1], values[2]];
}

function parseNumber(value: unknown, field: string, rowNumber: number) {
  const result = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(result)) throw new Error(`Row ${rowNumber}: ${field} must be a finite number.`);
  return result;
}

function parseDelimited(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("The DIL file contains an unterminated quoted field.");
  row.push(field.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  if (rows.length < 2) throw new Error("The DIL file must contain a header and at least one data row.");

  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function sourceRows(text: string, fileName: string): SourceRow[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The selected DIL file is empty.");
  if (fileName.toLowerCase().endsWith(".json") || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as unknown;
    const array = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown }).records)
        ? (parsed as { records: unknown[] }).records
        : null;
    if (!array?.length || array.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new Error("JSON DIL data must be a non-empty object array or an object with a records array.");
    }
    return array.map((row) => Object.fromEntries(
      Object.entries(row as Record<string, unknown>).map(([key, value]) => [normalizeHeader(key), value]),
    ));
  }
  return parseDelimited(text);
}

type IndexedSourceRow = { row: SourceRow; sourceIndex: number };

function reduceReplayRows(rows: SourceRow[]): IndexedSourceRow[] {
  if (rows.length <= MAX_DIL_REPLAY_RECORDS) {
    return rows.map((row, sourceIndex) => ({ row, sourceIndex }));
  }
  const stride = Math.ceil(rows.length / MAX_DIL_REPLAY_RECORDS);
  const prioritized = rows.flatMap((row, index): IndexedSourceRow[] => {
    if (index === 0 || index === rows.length - 1 || index % stride === 0) {
      return [{ row, sourceIndex: index }];
    }
    const previous = rows[index - 1];
    const keep = textValue(row.SPACECRAFT_OPERATION) !== textValue(previous.SPACECRAFT_OPERATION)
      || textValue(row.SUNLIT_STATUS) !== textValue(previous.SUNLIT_STATUS);
    return keep ? [{ row, sourceIndex: index }] : [];
  });
  if (prioritized.length <= MAX_DIL_REPLAY_RECORDS) return prioritized;
  const finalStride = Math.ceil(prioritized.length / MAX_DIL_REPLAY_RECORDS);
  return prioritized.filter((_, index) => index === 0 || index === prioritized.length - 1 || index % finalStride === 0);
}

type CalendarOrder = "DMY" | "YMD";

function parseCalendarTimestamp(value: string, order: CalendarOrder) {
  const match = value.trim().match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})[\s,T]+(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(?:\s*([AP])\.?M\.?)?\s*$/i);
  if (!match) return Number.NaN;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = Number(match[3]);
  let year: number;
  let month: number;
  let day: number;
  if (order === "YMD") {
    year = first;
    month = second;
    day = third;
  } else {
    year = third;
    month = second;
    day = first;
  }
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  const seconds = Number(match[6] ?? 0);
  const meridiem = match[7]?.toUpperCase();
  const invalidHour = meridiem ? hour < 1 || hour > 12 : hour < 0 || hour > 23;
  if (invalidHour || minute > 59 || seconds >= 60 || month < 1 || month > 12 || day < 1 || day > 31) return Number.NaN;
  if (meridiem) hour = hour % 12 + (meridiem === "P" ? 12 : 0);
  const wholeSeconds = Math.floor(seconds);
  const milliseconds = Math.round((seconds - wholeSeconds) * 1000);
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, wholeSeconds, milliseconds);
  const check = new Date(timestamp);
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
    || check.getUTCHours() !== hour
    || check.getUTCMinutes() !== minute
  ) return Number.NaN;
  return timestamp;
}

function expandRepeatedTimestamps(values: number[]) {
  const expanded = [...values];
  let repeated = false;
  let inferredStepMs = 1000;

  for (let start = 0; start < values.length;) {
    let end = start + 1;
    while (end < values.length && values[end] === values[start]) end += 1;
    const count = end - start;
    if (count > 1) {
      repeated = true;
      const nextDistinct = end < values.length ? values[end] : Number.NaN;
      const stepMs = Number.isFinite(nextDistinct) && nextDistinct > values[start]
        ? (nextDistinct - values[start]) / count
        : inferredStepMs;
      for (let offset = 1; offset < count; offset += 1) {
        expanded[start + offset] = values[start] + stepMs * offset;
      }
      inferredStepMs = stepMs;
    } else if (start > 0 && values[start] > expanded[start - 1]) {
      inferredStepMs = values[start] - expanded[start - 1];
    }
    start = end;
  }

  return { values: expanded, repeated };
}

function resolveDilTimes(rows: SourceRow[], sampleIntervalSec?: number) {
  const labels = rows.map((row) => textValue(row.TIME));
  const numericValues = labels.map(Number);
  if (labels.every((label, index) => label !== "" && Number.isFinite(numericValues[index]))) {
    return { values: numericValues, divisor: 1, epochMs: undefined, warning: "" };
  }

  const firstToken = labels[0]?.match(/^\s*(\d{1,4})[/.-]/)?.[1] ?? "";
  const order: CalendarOrder = firstToken.length === 4 ? "YMD" : "DMY";
  const calendarValues = labels.map((label) => parseCalendarTimestamp(label, order));
  if (calendarValues.every(Number.isFinite)) {
    const label = order === "DMY" ? "DD-MM-YYYY" : "YYYY-MM-DD";
    const hasMeridiem = labels.some((value) => /[AP]\.?M\.?\s*$/i.test(value));
    const minuteOnly = labels.every((value) => /^\s*\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}[\s,T]+\d{1,2}:\d{2}(?:\s*[AP]\.?M\.?)?\s*$/i.test(value));
    if (minuteOnly && sampleIntervalSec !== undefined) {
      const intervalMs = sampleIntervalSec * 1000;
      const manualValues = calendarValues.map((_, index) => calendarValues[0] + index * intervalMs);
      const conflictsWithMinuteLabels = manualValues.some((timestamp, index) => (
        timestamp < calendarValues[index] || timestamp >= calendarValues[index] + 60_000
      ));
      return {
        values: manualValues,
        divisor: 1000,
        epochMs: calendarValues[0],
        warning: `TIME parsed as ${label}; the specified ${sampleIntervalSec} s sample interval was applied to each row.${conflictsWithMinuteLabels ? " Some displayed minute labels do not align with that cadence; row order and the specified interval were used." : ""}`,
      };
    }
    const expanded = expandRepeatedTimestamps(calendarValues);
    const repeatNote = expanded.repeated ? " Repeated minute labels were expanded using inferred sub-minute spacing." : "";
    return {
      values: expanded.values,
      divisor: 1000,
      epochMs: calendarValues[0],
      warning: `TIME parsed as ${label} with a ${hasMeridiem ? "12-hour AM/PM" : "24-hour"} clock.${repeatNote}`,
    };
  }

  const nativeValues = labels.map((label) => Date.parse(label));
  if (order === "YMD" && nativeValues.every(Number.isFinite)) {
    const expanded = expandRepeatedTimestamps(nativeValues);
    return {
      values: expanded.values,
      divisor: 1000,
      epochMs: nativeValues[0],
      warning: `TIME interpreted using explicit ISO/date-time values.${expanded.repeated ? " Repeated timestamps were expanded using inferred sub-minute spacing." : ""}`,
    };
  }
  if (labels.some((label) => /^\s*\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/.test(label))) {
    throw new Error("TIME must use DD-MM-YYYY HH:mm[:ss] with a 24-hour clock, or include AM/PM; for example 01-01-2028 05:30.");
  }
  if (nativeValues.every(Number.isFinite)) {
    const expanded = expandRepeatedTimestamps(nativeValues);
    return {
      values: expanded.values,
      divisor: 1000,
      epochMs: nativeValues[0],
      warning: `TIME interpreted using explicit date/time values.${expanded.repeated ? " Repeated timestamps were expanded using inferred sub-minute spacing." : ""}`,
    };
  }
  throw new Error("TIME must use elapsed seconds, ISO-8601, or DD-MM-YYYY HH:mm[:ss], such as 01-01-2028 05:30.");
}

function buildDilEnergySeries(
  source: SourceRow[],
  resolvedTimes: ReturnType<typeof resolveDilTimes>,
  overrideAxis?: SignedAxis,
) {
  const count = source.length;
  const available = new Set(Object.keys(source[0] ?? {}));
  const declaredColumnAxis = source
    .map((row) => parseSignedAxis(row.SOLAR_PANEL_AXIS ?? row.SUN_PANEL_AXIS ?? row.PANEL_AXIS))
    .find((axis): axis is SignedAxis => axis !== undefined);
  const legacyAxes = SIGNED_PANEL_AXES.filter((axis) => available.has(`SUN_${axis}_PANELS`));
  const referencePanelAxis = overrideAxis ?? declaredColumnAxis ?? (legacyAxes.length === 1 ? legacyAxes[0] : undefined);
  const referenceAxisSource: DilReferenceAxisSource = overrideAxis
    ? "USER_OVERRIDE"
    : declaredColumnAxis
      ? "EXPLICIT_COLUMN"
      : legacyAxes.length === 1
        ? "LEGACY_COLUMN"
        : "NONE";
  const genericIncidenceField = available.has("SUN_PANEL_INCIDENCE")
    ? "SUN_PANEL_INCIDENCE"
    : available.has("SUN_PANEL_ANGLE")
      ? "SUN_PANEL_ANGLE"
      : undefined;
  const legacyIncidenceField = referencePanelAxis && available.has(`SUN_${referencePanelAxis}_PANELS`)
    ? `SUN_${referencePanelAxis}_PANELS`
    : undefined;
  const rawTimeSec = new Float64Array(count);
  const rawSunBodyXyz = new Float32Array(count * 3);
  const rawPanelIncidenceDeg = new Float32Array(count);
  const rawSunlightFactor = new Float32Array(count);
  const rawMeasuredPowerW = new Float32Array(count);
  const rawOperations = new Array<string>(count);
  let outOfSequence = false;

  for (let index = 0; index < count; index += 1) {
    const row = source[index];
    const rowNumber = index + 2;
    rawTimeSec[index] = (resolvedTimes.values[index] - resolvedTimes.values[0]) / resolvedTimes.divisor;
    if (index > 0 && rawTimeSec[index] <= rawTimeSec[index - 1]) outOfSequence = true;
    const sunBody = normalize(parseVector(row.SUN_BODY, "SUN_BODY", rowNumber));
    rawSunBodyXyz[index * 3] = sunBody[0];
    rawSunBodyXyz[index * 3 + 1] = sunBody[1];
    rawSunBodyXyz[index * 3 + 2] = sunBody[2];
    const panelIncidenceDeg = Number(textValue(
      genericIncidenceField ? row[genericIncidenceField] : legacyIncidenceField ? row[legacyIncidenceField] : undefined,
    ));
    rawPanelIncidenceDeg[index] = Number.isFinite(panelIncidenceDeg) ? panelIncidenceDeg : Number.NaN;
    rawSunlightFactor[index] = dilSunlightFactor(textValue(row.SUNLIT_STATUS));
    rawMeasuredPowerW[index] = Math.max(0, parseNumber(row.SOLAR_POWER_GENERATED, "SOLAR_POWER_GENERATED", rowNumber));
    rawOperations[index] = textValue(row.SPACECRAFT_OPERATION).trim() || "UNSPECIFIED";
  }

  const order = Array.from({ length: count }, (_, index) => index);
  if (outOfSequence) order.sort((a, b) => rawTimeSec[a] - rawTimeSec[b]);
  const timeSec = new Float64Array(count);
  const sunBodyXyz = new Float32Array(count * 3);
  const panelIncidenceDeg = new Float32Array(count);
  const sunlightFactor = new Float32Array(count);
  const measuredPowerW = new Float32Array(count);
  const operationIndex = new Uint32Array(count);
  const operations: string[] = [];
  const operationLookup = new Map<string, number>();
  const baseTime = rawTimeSec[order[0]];
  for (let destination = 0; destination < count; destination += 1) {
    const sourceIndex = order[destination];
    timeSec[destination] = rawTimeSec[sourceIndex] - baseTime;
    sunBodyXyz[destination * 3] = rawSunBodyXyz[sourceIndex * 3];
    sunBodyXyz[destination * 3 + 1] = rawSunBodyXyz[sourceIndex * 3 + 1];
    sunBodyXyz[destination * 3 + 2] = rawSunBodyXyz[sourceIndex * 3 + 2];
    panelIncidenceDeg[destination] = rawPanelIncidenceDeg[sourceIndex];
    sunlightFactor[destination] = rawSunlightFactor[sourceIndex];
    measuredPowerW[destination] = rawMeasuredPowerW[sourceIndex];
    const operation = rawOperations[sourceIndex];
    let encodedOperation = operationLookup.get(operation);
    if (encodedOperation === undefined) {
      encodedOperation = operations.length;
      operationLookup.set(operation, encodedOperation);
      operations.push(operation);
    }
    operationIndex[destination] = encodedOperation;
  }
  return {
    energySeries: { timeSec, sunBodyXyz, panelIncidenceDeg, sunlightFactor, measuredPowerW, operationIndex, operations } satisfies DilEnergySeries,
    outOfSequence,
    referencePanelAxis,
    referenceAxisSource,
  };
}

function incidenceFromSeriesAxis(series: DilEnergySeries, index: number, axis: SignedAxis) {
  const axisVector = signedAxisVector(axis);
  const sunBody: Vector3 = [
    series.sunBodyXyz[index * 3],
    series.sunBodyXyz[index * 3 + 1],
    series.sunBodyXyz[index * 3 + 2],
  ];
  return Math.acos(clamp(dot(axisVector, sunBody), -1, 1)) * RAD;
}

function scoreDilFactorAxis(series: DilEnergySeries, axis: SignedAxis, useProvidedIncidence: boolean) {
  const count = series.measuredPowerW.length;
  let maximum = 0;
  let meanAbsoluteError = 0;
  let pairedCount = 0;
  let sumMeasured = 0;
  let sumExpected = 0;
  let sumMeasuredSquared = 0;
  let sumExpectedSquared = 0;
  let sumProduct = 0;
  for (let index = 0; index < count; index += 1) {
    const measured = series.measuredPowerW[index];
    maximum = Math.max(maximum, measured);
    const providedIncidenceDeg = series.panelIncidenceDeg[index];
    const incidenceDeg = useProvidedIncidence && Number.isFinite(providedIncidenceDeg)
      ? providedIncidenceDeg
      : incidenceFromSeriesAxis(series, index, axis);
    const expectedPercent = Math.max(0, Math.cos(clamp(incidenceDeg, 0, 180) * DEG))
      * series.sunlightFactor[index]
      * 100;
    meanAbsoluteError += Math.abs(measured - expectedPercent);
    sumMeasured += measured;
    sumExpected += expectedPercent;
    sumMeasuredSquared += measured * measured;
    sumExpectedSquared += expectedPercent * expectedPercent;
    sumProduct += measured * expectedPercent;
    pairedCount += 1;
  }
  meanAbsoluteError = pairedCount > 0 ? meanAbsoluteError / pairedCount : Number.POSITIVE_INFINITY;
  const covariance = pairedCount * sumProduct - sumMeasured * sumExpected;
  const measuredVariance = pairedCount * sumMeasuredSquared - sumMeasured ** 2;
  const expectedVariance = pairedCount * sumExpectedSquared - sumExpected ** 2;
  const correlation = measuredVariance > 0 && expectedVariance > 0
    ? covariance / Math.sqrt(measuredVariance * expectedVariance)
    : 0;
  return { axis, maximum, pairedCount, meanAbsoluteError, correlation };
}

function detectDilPowerSemantics(
  series: DilEnergySeries,
  declaredAxis?: SignedAxis,
) {
  const candidates = declaredAxis ? [declaredAxis] : SIGNED_PANEL_AXES;
  const scores = candidates
    .map((axis) => scoreDilFactorAxis(series, axis, axis === declaredAxis))
    .sort((a, b) => b.correlation - a.correlation || a.meanAbsoluteError - b.meanAbsoluteError);
  const best = scores[0];
  const isPercentFactor = series.measuredPowerW.length >= 10
    && best.maximum >= 95
    && best.maximum <= 100.5
    && best.pairedCount >= 10
    && best.correlation >= 0.9
    && best.meanAbsoluteError <= 15;
  return {
    powerSemantics: isPercentFactor ? "PERCENT_MAX" as const : "WATTS" as const,
    inferredPanelAxis: isPercentFactor ? best.axis : declaredAxis,
    maximum: best.maximum,
    correlation: best.correlation,
    meanAbsoluteError: best.meanAbsoluteError,
  };
}

export function parseDilData(text: string, fileName: string, options: DilParseOptions = {}): ParsedDilData {
  if (options.sampleIntervalSec !== undefined && (!Number.isFinite(options.sampleIntervalSec) || options.sampleIntervalSec <= 0)) {
    throw new Error("DIL sample interval must be a positive number of seconds.");
  }
  const source = sourceRows(text, fileName);
  const sourceRecordCount = source.length;
  const available = new Set(Object.keys(source[0] ?? {}));
  const missing = DIL_REQUIRED_FIELDS.filter((field) => !available.has(field));
  if (missing.length) throw new Error(`Missing required DIL field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);

  const warnings: string[] = [];
  const resolvedTimes = resolveDilTimes(source, options.sampleIntervalSec);
  if (resolvedTimes.warning) warnings.push(resolvedTimes.warning);
  const denseEnergy = buildDilEnergySeries(source, resolvedTimes, options.referencePanelAxis);
  const detection = detectDilPowerSemantics(denseEnergy.energySeries, denseEnergy.referencePanelAxis);
  const powerSemantics = detection.powerSemantics;
  const referencePanelAxis = denseEnergy.referencePanelAxis ?? detection.inferredPanelAxis;
  const referenceAxisSource: DilReferenceAxisSource = denseEnergy.referenceAxisSource !== "NONE"
    ? denseEnergy.referenceAxisSource
    : referencePanelAxis
      ? "INFERRED"
      : "NONE";
  let referenceVectorSamples = 0;
  let referenceVectorErrorSumDeg = 0;
  let referenceVectorMismatchSamples = 0;
  if (referencePanelAxis) {
    for (let index = 0; index < denseEnergy.energySeries.panelIncidenceDeg.length; index += 1) {
      const importedIncidenceDeg = denseEnergy.energySeries.panelIncidenceDeg[index];
      if (!Number.isFinite(importedIncidenceDeg)) continue;
      const vectorIncidenceDeg = incidenceFromSeriesAxis(denseEnergy.energySeries, index, referencePanelAxis);
      const errorDeg = Math.abs(clamp(importedIncidenceDeg, 0, 180) - vectorIncidenceDeg);
      referenceVectorErrorSumDeg += errorDeg;
      if (errorDeg > 5) referenceVectorMismatchSamples += 1;
      referenceVectorSamples += 1;
    }
  }
  const referenceVectorMaeDeg = referenceVectorSamples > 0
    ? referenceVectorErrorSumDeg / referenceVectorSamples
    : 0;
  const referenceVectorMismatchPct = referenceVectorSamples > 0
    ? referenceVectorMismatchSamples / referenceVectorSamples * 100
    : 0;
  if (referencePanelAxis) {
    for (let index = 0; index < denseEnergy.energySeries.panelIncidenceDeg.length; index += 1) {
      if (!Number.isFinite(denseEnergy.energySeries.panelIncidenceDeg[index])) {
        denseEnergy.energySeries.panelIncidenceDeg[index] = incidenceFromSeriesAxis(
          denseEnergy.energySeries,
          index,
          referencePanelAxis,
        );
      }
    }
  }
  if (powerSemantics === "PERCENT_MAX") {
    warnings.push(`SOLAR_POWER_GENERATED was detected as a 0–100 generation factor for the ${referencePanelAxis ?? "unknown"} panel normal (${(detection.correlation * 100).toFixed(1)}% correlation), not watts. It is converted to equivalent EOL array watts using the configured electrical and loss inputs.`);
  } else if (referencePanelAxis && detection.maximum >= 95 && detection.maximum <= 100.5) {
    warnings.push(`SOLAR_POWER_GENERATED is bounded near 0–100 but has only ${(detection.correlation * 100).toFixed(1)}% correlation with the declared ${referencePanelAxis} incidence history (mean factor error ${detection.meanAbsoluteError.toFixed(1)} points). It is interpreted as watts because the file does not support treating it as a ${referencePanelAxis} cosine generation factor.`);
  }
  if (referencePanelAxis) {
    const sourceLabel = referenceAxisSource === "INFERRED"
      ? "inferred from SUN_BODY and SOLAR_POWER_GENERATED"
      : referenceAxisSource === "USER_OVERRIDE"
        ? "set by the import override"
        : referenceAxisSource === "LEGACY_COLUMN"
          ? "read from the legacy signed-axis angle column"
          : "read from SOLAR_PANEL_AXIS";
    warnings.push(`DIL solar-panel reference axis ${referencePanelAxis} was ${sourceLabel}.`);
  }
  if (referenceVectorSamples > 0 && (referenceVectorMaeDeg > 2 || referenceVectorMismatchPct > 10)) {
    warnings.push(`Imported ${referencePanelAxis} panel incidence conflicts with SUN_BODY: mean absolute difference ${referenceVectorMaeDeg.toFixed(1)}° and ${referenceVectorMismatchPct.toFixed(1)}% of samples differ by more than 5°. The declared reference-angle history is used for ${referencePanelAxis}; other-axis comparisons still use SUN_BODY and may not be physically comparable.`);
  }
  const replayRows = reduceReplayRows(source);
  if (replayRows.length < sourceRecordCount) {
    warnings.push(`${sourceRecordCount.toLocaleString()} source rows were reduced to ${replayRows.length.toLocaleString()} replay samples; operation and illumination transitions were prioritized.`);
  }
  let outOfSequence = denseEnergy.outOfSequence;
  const records = replayRows.map(({ row, sourceIndex }, index): DilRecord => {
    const rowNumber = sourceIndex + 2;
    const timeLabel = textValue(row.TIME);
    const rawTime = resolvedTimes.values[sourceIndex];
    const timeSec = (rawTime - resolvedTimes.values[0]) / resolvedTimes.divisor;
    if (index > 0) {
      const previousSourceIndex = replayRows[index - 1].sourceIndex;
      const previousSec = (resolvedTimes.values[previousSourceIndex] - resolvedTimes.values[0]) / resolvedTimes.divisor;
      if (timeSec <= previousSec) outOfSequence = true;
    }
    const sunBody = parseVector(row.SUN_BODY, "SUN_BODY", rowNumber);
    const genericPanelReference = row.SUN_PANEL_INCIDENCE ?? row.SUN_PANEL_ANGLE;
    const legacyPanelReference = referencePanelAxis ? row[`SUN_${referencePanelAxis}_PANELS`] : undefined;
    const panelReferenceText = textValue(genericPanelReference ?? legacyPanelReference);
    const explicitIncidenceDeg = Number(panelReferenceText);
    const derivedIncidenceDeg = referencePanelAxis
      ? Math.acos(clamp(dot(signedAxisVector(referencePanelAxis), normalize(sunBody)), -1, 1)) * RAD
      : undefined;
    return {
      timeLabel,
      timeSec,
      satellitePositionKm: parseVector(row.SATELLITE_POSITION, "SATELLITE_POSITION", rowNumber),
      latitudeDeg: parseNumber(row.LATITUDE, "LATITUDE", rowNumber),
      longitudeDeg: parseNumber(row.LONGITUDE, "LONGITUDE", rowNumber),
      sunBody,
      earthBody: parseVector(row.EARTH_BODY, "EARTH_BODY", rowNumber),
      attitudeRpyDeg: parseVector(row.ATTITUDE_RPY, "ATTITUDE_RPY", rowNumber),
      sunPanelReference: panelReferenceText,
      referencePanelIncidenceDeg: Number.isFinite(explicitIncidenceDeg) ? explicitIncidenceDeg : derivedIncidenceDeg,
      payloadSun: textValue(row.PAYLOAD_SUN),
      payloadEarth: textValue(row.PAYLOAD_EARTH),
      payloadSunAngleDeg: optionalAngleDeg(row.PAYLOAD_SUN),
      payloadEarthAngleDeg: optionalAngleDeg(row.PAYLOAD_EARTH),
      sunlitStatus: textValue(row.SUNLIT_STATUS),
      spacecraftOperation: textValue(row.SPACECRAFT_OPERATION),
      solarPowerGeneratedW: Math.max(0, parseNumber(row.SOLAR_POWER_GENERATED, "SOLAR_POWER_GENERATED", rowNumber)),
    };
  });

  if (outOfSequence) {
    records.sort((a, b) => a.timeSec - b.timeSec);
    const base = records[0].timeSec;
    records.forEach((record) => { record.timeSec -= base; });
    warnings.push("TIME values were not strictly increasing; rows were sorted for replay.");
  }
  if (records.length < 3) warnings.push("At least three samples are recommended for stable velocity reconstruction.");

  return {
    fileName,
    records,
    energySeries: denseEnergy.energySeries,
    powerSemantics,
    referencePanelAxis,
    referenceAxisSource,
    referenceVectorMaeDeg,
    referenceVectorMismatchPct,
    sourceRecordCount,
    epochMs: resolvedTimes.epochMs,
    warnings,
  };
}

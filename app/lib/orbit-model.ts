export type Vector3 = [number, number, number];
export type OrbitPreset = "LEO" | "SSO" | "GEO";
export type Axis = "X" | "Y" | "Z";
export type SignedAxis = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
export type AttitudeMode = "LVLH" | "SUN_POINTING" | "INERTIAL";
export type PanelControlMode = "SUN_TRACK" | "FIXED";
export type WingLayout = "SINGLE" | "DUAL";

export interface MissionConfig {
  preset: OrbitPreset;
  altitudeKm: number;
  inclinationDeg: number;
  raanDeg: number;
  ltanHours: number;
  epoch: string;
  durationDays: number;
  stepSec: number;
  attitude: AttitudeMode;
  panelFacingAxis: SignedAxis;
  panelHingeAxis: SignedAxis;
  velocityBodyAxis: SignedAxis;
  nadirBodyAxis: SignedAxis;
  panelRotationXDeg: number;
  panelRotationYDeg: number;
  panelRotationZDeg: number;
  panelControlMode: PanelControlMode;
  wingLayout: WingLayout;
}

export interface PowerConfig {
  vmpV: number;
  impA: number;
  vscV: number;
  iscA: number;
  cellAreaCm2: number;
  seriesCells: number;
  parallelStrings: number;
  packagingEfficiencyPct: number;
  fluenceE14Cm2: number;
  fluenceLossPctPerE14: number;
  nonRadiationEolPct: number;
  systemLossPct: number;
  averageLoadW: number;
  batteryWh: number;
  initialSocPct: number;
}

export interface SimulationPoint {
  tSec: number;
  positionKm: Vector3;
  velocityKmS: Vector3;
  sunVector: Vector3;
  bodySun: Vector3;
  bodyVelocity: Vector3;
  bodyNadir: Vector3;
  hingeAxis: Vector3;
  hingeBody: Vector3;
  panelNormal: Vector3;
  panelNormalBody: Vector3;
  trackerAngleDeg: number;
  betaDeg: number;
  incidenceDeg: number;
  shadowFactor: number;
  powerW: number;
  socPct: number;
}

export interface SimulationMetrics {
  periodSec: number;
  durationSec: number;
  peakPowerW: number;
  averagePowerW: number;
  energyWh: number;
  energyPerOrbitWh: number;
  eclipsePerOrbitSec: number;
  betaMinDeg: number;
  betaMaxDeg: number;
  minSocPct: number;
  finalSocPct: number;
  energyMarginWh: number;
  raanRateDegDay: number;
  elapsedOrbits: number;
  cellCount: number;
  activeCellAreaM2: number;
  packagedAreaM2: number;
  arrayVmpV: number;
  arrayImpA: number;
  arrayVscV: number;
  arrayIscA: number;
  bolArrayPowerW: number;
  impliedCellEfficiencyPct: number;
  radiationRetentionPct: number;
}

export interface AxisResult {
  axis: SignedAxis;
  energyPerOrbitWh: number;
  averagePowerW: number;
  minSocPct: number;
  rank: number;
}

export interface SimulationResult {
  points: SimulationPoint[];
  metrics: SimulationMetrics;
  axes: AxisResult[];
  effectiveRaanDeg: number;
}

export const EARTH_RADIUS_KM = 6378.137;
export const EARTH_MU_KM3_S2 = 398600.4418;
export const EARTH_J2 = 1.08262668e-3;
export const SOLAR_CONSTANT_W_M2 = 1361;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const SUN_ANGULAR_RADIUS_RAD = 0.2666 * DEG;

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

function magnitude(a: Vector3) {
  return Math.sqrt(dot(a, a));
}

function normalize(a: Vector3, fallback: Vector3 = [1, 0, 0]): Vector3 {
  const length = magnitude(a);
  if (length < 1e-12) return fallback;
  return [a[0] / length, a[1] / length, a[2] / length];
}

function scale(a: Vector3, amount: number): Vector3 {
  return [a[0] * amount, a[1] * amount, a[2] * amount];
}

function add(a: Vector3, b: Vector3): Vector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function toJulianDate(date: Date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Low-order apparent Sun direction, adequate for this preliminary design model. */
export function sunDirection(date: Date): Vector3 {
  const days = toJulianDate(date) - 2451545;
  const meanLongitude = (280.46 + 0.9856474 * days) * DEG;
  const meanAnomaly = (357.528 + 0.9856003 * days) * DEG;
  const eclipticLongitude =
    meanLongitude +
    1.915 * DEG * Math.sin(meanAnomaly) +
    0.02 * DEG * Math.sin(2 * meanAnomaly);
  const obliquity = (23.439 - 0.0000004 * days) * DEG;
  return normalize([
    Math.cos(eclipticLongitude),
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.sin(obliquity) * Math.sin(eclipticLongitude),
  ]);
}

export function orbitalPeriodSec(altitudeKm: number) {
  const semiMajorAxis = EARTH_RADIUS_KM + altitudeKm;
  return 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / EARTH_MU_KM3_S2);
}

function ssoRaanFromLtan(date: Date, ltanHours: number) {
  const sun = sunDirection(date);
  const sunRightAscension = Math.atan2(sun[1], sun[0]) * RAD;
  return ((sunRightAscension + 15 * (ltanHours - 12)) % 360 + 360) % 360;
}

function orbitState(
  semiMajorAxisKm: number,
  inclinationRad: number,
  raanRad: number,
  argumentOfLatitudeRad: number,
) {
  const cosO = Math.cos(raanRad);
  const sinO = Math.sin(raanRad);
  const cosI = Math.cos(inclinationRad);
  const sinI = Math.sin(inclinationRad);
  const cosU = Math.cos(argumentOfLatitudeRad);
  const sinU = Math.sin(argumentOfLatitudeRad);
  const position: Vector3 = [
    semiMajorAxisKm * (cosO * cosU - sinO * sinU * cosI),
    semiMajorAxisKm * (sinO * cosU + cosO * sinU * cosI),
    semiMajorAxisKm * sinU * sinI,
  ];
  const speed = Math.sqrt(EARTH_MU_KM3_S2 / semiMajorAxisKm);
  const velocity: Vector3 = [
    speed * (-cosO * sinU - sinO * cosU * cosI),
    speed * (-sinO * sinU + cosO * cosU * cosI),
    speed * cosU * sinI,
  ];
  return { position, velocity };
}

function signedAxisParts(axis: SignedAxis) {
  return {
    index: axis.endsWith("X") ? 0 : axis.endsWith("Y") ? 1 : 2,
    sign: axis.startsWith("-") ? -1 : 1,
  };
}

function signedAxisVector(axis: SignedAxis): Vector3 {
  const { index, sign } = signedAxisParts(axis);
  const vector: Vector3 = [0, 0, 0];
  vector[index] = sign;
  return vector;
}

function mappedBodyFrame(
  velocityDirection: Vector3,
  pointingDirection: Vector3,
  velocityBodyAxis: SignedAxis,
  pointingBodyAxis: SignedAxis,
) {
  const velocityParts = signedAxisParts(velocityBodyAxis);
  const pointingParts = signedAxisParts(pointingBodyAxis);
  const safeVelocityAxis = velocityParts.index === pointingParts.index ? signedAxisParts("+X") : velocityParts;
  const safePointingAxis = velocityParts.index === pointingParts.index ? signedAxisParts("+Z") : pointingParts;
  const first = normalize(velocityDirection);
  const second = normalize(
    subtract(pointingDirection, scale(first, dot(pointingDirection, first))),
    normalize(cross([0, 0, 1], first), [0, 1, 0]),
  );
  const basis: Array<Vector3 | undefined> = [undefined, undefined, undefined];
  basis[safeVelocityAxis.index] = scale(first, safeVelocityAxis.sign);
  basis[safePointingAxis.index] = scale(second, safePointingAxis.sign);
  if (!basis[2]) basis[2] = normalize(cross(basis[0]!, basis[1]!));
  if (!basis[1]) basis[1] = normalize(cross(basis[2]!, basis[0]!));
  if (!basis[0]) basis[0] = normalize(cross(basis[1]!, basis[2]!));
  return { x: basis[0]!, y: basis[1]!, z: basis[2]! };
}

function bodyFrame(
  mission: MissionConfig,
  position: Vector3,
  velocity: Vector3,
  sun: Vector3,
) {
  const nadir = normalize(scale(position, -1));
  if (mission.attitude === "INERTIAL") {
    return mappedBodyFrame([1, 0, 0], [0, 0, 1], mission.velocityBodyAxis, mission.nadirBodyAxis);
  }
  const pointing = mission.attitude === "SUN_POINTING" ? sun : nadir;
  const projectedVelocity = normalize(
    subtract(velocity, scale(pointing, dot(velocity, pointing))),
    normalize(cross([0, 0, 1], pointing), [1, 0, 0]),
  );
  return mappedBodyFrame(
    projectedVelocity,
    pointing,
    mission.velocityBodyAxis,
    mission.nadirBodyAxis,
  );
}

function bodyComponents(vector: Vector3, frame: ReturnType<typeof bodyFrame>): Vector3 {
  return [dot(vector, frame.x), dot(vector, frame.y), dot(vector, frame.z)];
}

function bodyToInertial(vector: Vector3, frame: ReturnType<typeof bodyFrame>): Vector3 {
  return [
    frame.x[0] * vector[0] + frame.y[0] * vector[1] + frame.z[0] * vector[2],
    frame.x[1] * vector[0] + frame.y[1] * vector[1] + frame.z[1] * vector[2],
    frame.x[2] * vector[0] + frame.y[2] * vector[1] + frame.z[2] * vector[2],
  ];
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

function mountedPanelNormal(mission: MissionConfig, facingAxis: SignedAxis): Vector3 {
  let normal = signedAxisVector(facingAxis);
  normal = rotateAround(normal, [1, 0, 0], mission.panelRotationXDeg * DEG);
  normal = rotateAround(normal, [0, 1, 0], mission.panelRotationYDeg * DEG);
  normal = rotateAround(normal, [0, 0, 1], mission.panelRotationZDeg * DEG);
  return normalize(normal);
}

function trackSunAboutHinge(baseNormal: Vector3, hinge: Vector3, sun: Vector3) {
  const unitHinge = normalize(hinge);
  const parallel = scale(unitHinge, dot(baseNormal, unitHinge));
  const perpendicular = subtract(baseNormal, parallel);
  if (magnitude(perpendicular) < 1e-9) {
    return { normal: baseNormal, angleDeg: 0 };
  }
  const tangent = cross(unitHinge, perpendicular);
  const angle = Math.atan2(dot(sun, tangent), dot(sun, perpendicular));
  return { normal: normalize(rotateAround(baseNormal, unitHinge, angle)), angleDeg: angle * RAD };
}

/** Fraction of the apparent solar disc visible using a linear penumbra transition. */
export function eclipseFactor(positionKm: Vector3, sun: Vector3) {
  const radius = magnitude(positionKm);
  const earthAngularRadius = Math.asin(clamp(EARTH_RADIUS_KM / radius, -1, 1));
  const earthDirection = normalize(scale(positionKm, -1));
  const separation = Math.acos(clamp(dot(earthDirection, sun), -1, 1));
  const fullUmbraLimit = earthAngularRadius - SUN_ANGULAR_RADIUS_RAD;
  const fullSunLimit = earthAngularRadius + SUN_ANGULAR_RADIUS_RAD;
  if (separation <= fullUmbraLimit) return 0;
  if (separation >= fullSunLimit) return 1;
  return clamp((separation - fullUmbraLimit) / (2 * SUN_ANGULAR_RADIUS_RAD), 0, 1);
}

function simulateAxis(mission: MissionConfig, power: PowerConfig, facingAxis: SignedAxis) {
  const epoch = new Date(mission.epoch);
  const safeEpoch = Number.isNaN(epoch.getTime()) ? new Date("2026-01-01T00:00:00Z") : epoch;
  const altitudeKm = mission.preset === "GEO" ? 35786 : clamp(mission.altitudeKm, 160, 50000);
  const inclinationDeg = mission.preset === "GEO" ? 0 : clamp(mission.inclinationDeg, 0, 180);
  const semiMajorAxis = EARTH_RADIUS_KM + altitudeKm;
  const inclination = inclinationDeg * DEG;
  const periodSec = orbitalPeriodSec(altitudeKm);
  const meanMotion = Math.sqrt(EARTH_MU_KM3_S2 / semiMajorAxis ** 3);
  const raanRate =
    -1.5 * EARTH_J2 * meanMotion * (EARTH_RADIUS_KM / semiMajorAxis) ** 2 * Math.cos(inclination);
  const effectiveRaanDeg =
    mission.preset === "SSO"
      ? ssoRaanFromLtan(safeEpoch, mission.ltanHours)
      : ((mission.raanDeg % 360) + 360) % 360;
  const raan0 = effectiveRaanDeg * DEG;
  const durationSec = clamp(mission.durationDays, 2, 30) * 86400;
  const desiredStep = clamp(mission.stepSec, 10, 600);
  const sampleCount = Math.min(2400, Math.max(96, Math.ceil(durationSec / desiredStep)));
  const dt = durationSec / sampleCount;
  const points: SimulationPoint[] = [];
  const capacityWh = Math.max(0.1, power.batteryWh);
  let batteryWh = capacityWh * clamp(power.initialSocPct / 100, 0, 1);
  let minSocPct = (batteryWh / capacityWh) * 100;
  let energyWh = 0;
  let eclipseEquivalentSec = 0;
  let peakPowerW = 0;
  let betaMinDeg = 90;
  let betaMaxDeg = -90;
  const seriesCells = Math.max(1, Math.round(power.seriesCells));
  const parallelStrings = Math.max(1, Math.round(power.parallelStrings));
  const cellCount = seriesCells * parallelStrings;
  const activeCellAreaM2 = cellCount * Math.max(0.01, power.cellAreaCm2) / 10000;
  const packagingFactor = clamp(power.packagingEfficiencyPct / 100, 0.1, 1);
  const packagedAreaM2 = activeCellAreaM2 / packagingFactor;
  const bolArrayPowerW =
    Math.max(0, power.vmpV) * Math.max(0, power.impA) * cellCount;
  const radiationRetention = clamp(
    1 - Math.max(0, power.fluenceE14Cm2) * Math.max(0, power.fluenceLossPctPerE14) / 100,
    0,
    1,
  );
  const eolFactor =
    radiationRetention *
    clamp(power.nonRadiationEolPct / 100, 0, 1) *
    clamp(1 - power.systemLossPct / 100, 0, 1);
  const impliedCellEfficiencyPct =
    activeCellAreaM2 > 0
      ? (bolArrayPowerW / (SOLAR_CONSTANT_W_M2 * activeCellAreaM2)) * 100
      : 0;

  for (let sample = 0; sample <= sampleCount; sample += 1) {
    const tSec = Math.min(sample * dt, durationSec);
    const date = new Date(safeEpoch.getTime() + tSec * 1000);
    const sun = sunDirection(date);
    const raan = raan0 + raanRate * tSec;
    const argumentOfLatitude = meanMotion * tSec;
    const { position, velocity } = orbitState(
      semiMajorAxis,
      inclination,
      raan,
      argumentOfLatitude,
    );
    const orbitNormal = normalize(cross(position, velocity), [0, 0, 1]);
    const betaDeg = Math.asin(clamp(dot(orbitNormal, sun), -1, 1)) * RAD;
    const frame = bodyFrame(mission, position, velocity, sun);
    const hingeBody = signedAxisVector(mission.panelHingeAxis);
    const hinge = normalize(bodyToInertial(hingeBody, frame));
    const baseNormalBody = mountedPanelNormal(mission, facingAxis);
    const basePanelNormal = normalize(bodyToInertial(baseNormalBody, frame));
    const tracking = mission.panelControlMode === "SUN_TRACK"
      ? trackSunAboutHinge(basePanelNormal, hinge, sun)
      : { normal: basePanelNormal, angleDeg: 0 };
    const panelNormal = tracking.normal;
    const incidenceCosine = clamp(dot(panelNormal, sun), 0, 1);
    const incidenceDeg = Math.acos(incidenceCosine) * RAD;
    const shadowFactor = eclipseFactor(position, sun);
    const generatedPowerW = bolArrayPowerW * eolFactor * incidenceCosine * shadowFactor;

    if (sample > 0) {
      energyWh += (generatedPowerW * dt) / 3600;
      eclipseEquivalentSec += (1 - shadowFactor) * dt;
      batteryWh = clamp(
        batteryWh + ((generatedPowerW - Math.max(0, power.averageLoadW)) * dt) / 3600,
        0,
        capacityWh,
      );
    }
    const socPct = (batteryWh / capacityWh) * 100;
    minSocPct = Math.min(minSocPct, socPct);
    peakPowerW = Math.max(peakPowerW, generatedPowerW);
    betaMinDeg = Math.min(betaMinDeg, betaDeg);
    betaMaxDeg = Math.max(betaMaxDeg, betaDeg);

    points.push({
      tSec,
      positionKm: position,
      velocityKmS: velocity,
      sunVector: sun,
      bodySun: bodyComponents(sun, frame),
      bodyVelocity: bodyComponents(normalize(velocity), frame),
      bodyNadir: bodyComponents(normalize(scale(position, -1)), frame),
      hingeAxis: hinge,
      hingeBody,
      panelNormal,
      panelNormalBody: bodyComponents(panelNormal, frame),
      trackerAngleDeg: tracking.angleDeg,
      betaDeg,
      incidenceDeg,
      shadowFactor,
      powerW: generatedPowerW,
      socPct,
    });
  }

  const durationHours = durationSec / 3600;
  const elapsedOrbits = durationSec / periodSec;
  const averagePowerW = energyWh / durationHours;
  const loadEnergyWh = Math.max(0, power.averageLoadW) * durationHours;
  return {
    points,
    effectiveRaanDeg,
    metrics: {
      periodSec,
      durationSec,
      peakPowerW,
      averagePowerW,
      energyWh,
      energyPerOrbitWh: energyWh / elapsedOrbits,
      eclipsePerOrbitSec: eclipseEquivalentSec / elapsedOrbits,
      betaMinDeg,
      betaMaxDeg,
      minSocPct,
      finalSocPct: (batteryWh / capacityWh) * 100,
      energyMarginWh: energyWh - loadEnergyWh,
      raanRateDegDay: raanRate * RAD * 86400,
      elapsedOrbits,
      cellCount,
      activeCellAreaM2,
      packagedAreaM2,
      arrayVmpV: seriesCells * Math.max(0, power.vmpV),
      arrayImpA: parallelStrings * Math.max(0, power.impA),
      arrayVscV: seriesCells * Math.max(0, power.vscV),
      arrayIscA: parallelStrings * Math.max(0, power.iscA),
      bolArrayPowerW,
      impliedCellEfficiencyPct,
      radiationRetentionPct: radiationRetention * 100,
    } satisfies SimulationMetrics,
  };
}

export function runSimulation(mission: MissionConfig, power: PowerConfig): SimulationResult {
  const selected = simulateAxis(mission, power, mission.panelFacingAxis);
  const comparisons = (["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as SignedAxis[]).map((axis) => {
    const result = axis === mission.panelFacingAxis ? selected : simulateAxis(mission, power, axis);
    return {
      axis,
      energyPerOrbitWh: result.metrics.energyPerOrbitWh,
      averagePowerW: result.metrics.averagePowerW,
      minSocPct: result.metrics.minSocPct,
      rank: 0,
    };
  });
  const ranked = [...comparisons].sort((a, b) => b.energyPerOrbitWh - a.energyPerOrbitWh);
  const axes = comparisons.map((entry) => ({
    ...entry,
    rank: ranked.findIndex((candidate) => candidate.axis === entry.axis) + 1,
  }));
  return { ...selected, axes };
}

export function formatDuration(seconds: number) {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  return `${Math.round(seconds / 60)} min`;
}

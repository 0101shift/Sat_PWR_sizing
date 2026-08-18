export type Vector3 = [number, number, number];
export type OrbitPreset = "LEO" | "SSO" | "GEO";
export type Axis = "X" | "Y" | "Z";
export type AttitudeMode = "LVLH" | "SUN_POINTING" | "INERTIAL";

export interface MissionConfig {
  preset: OrbitPreset;
  altitudeKm: number;
  inclinationDeg: number;
  raanDeg: number;
  ltanHours: number;
  epoch: string;
  durationOrbits: number;
  stepSec: number;
  attitude: AttitudeMode;
  deploymentAxis: Axis;
}

export interface PowerConfig {
  activeAreaM2: number;
  efficiencyPct: number;
  degradationPct: number;
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
  hingeAxis: Vector3;
  hingeBody: Vector3;
  panelNormal: Vector3;
  panelNormalBody: Vector3;
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
}

export interface AxisResult {
  axis: Axis;
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

function bodyFrame(
  attitude: AttitudeMode,
  position: Vector3,
  velocity: Vector3,
  sun: Vector3,
) {
  if (attitude === "INERTIAL") {
    return { x: [1, 0, 0] as Vector3, y: [0, 1, 0] as Vector3, z: [0, 0, 1] as Vector3 };
  }

  if (attitude === "SUN_POINTING") {
    const z = sun;
    const projectedVelocity = subtract(velocity, scale(z, dot(velocity, z)));
    const x = normalize(projectedVelocity, normalize(cross([0, 0, 1], z), [1, 0, 0]));
    const y = normalize(cross(z, x), [0, 1, 0]);
    return { x: normalize(cross(y, z), x), y, z };
  }

  const z = normalize(scale(position, -1));
  const projectedVelocity = subtract(velocity, scale(z, dot(velocity, z)));
  const x = normalize(projectedVelocity);
  const y = normalize(cross(z, x), [0, 1, 0]);
  return { x: normalize(cross(y, z), x), y, z };
}

function bodyComponents(vector: Vector3, frame: ReturnType<typeof bodyFrame>): Vector3 {
  return [dot(vector, frame.x), dot(vector, frame.y), dot(vector, frame.z)];
}

function axisVector(axis: Axis, frame: ReturnType<typeof bodyFrame>) {
  return axis === "X" ? frame.x : axis === "Y" ? frame.y : frame.z;
}

function axisBody(axis: Axis): Vector3 {
  return axis === "X" ? [1, 0, 0] : axis === "Y" ? [0, 1, 0] : [0, 0, 1];
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

function simulateAxis(mission: MissionConfig, power: PowerConfig, axis: Axis) {
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
  const durationSec = periodSec * clamp(mission.durationOrbits, 1, 5);
  const desiredStep = clamp(mission.stepSec, 10, 600);
  const sampleCount = Math.min(1200, Math.max(48, Math.ceil(durationSec / desiredStep)));
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
  const arrayFactor =
    Math.max(0, power.activeAreaM2) *
    clamp(power.efficiencyPct / 100, 0, 1) *
    clamp(power.degradationPct / 100, 0, 1) *
    clamp(1 - power.systemLossPct / 100, 0, 1);

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
    const frame = bodyFrame(mission.attitude, position, velocity, sun);
    const hinge = normalize(axisVector(axis, frame));
    const projectedSun = subtract(sun, scale(hinge, dot(sun, hinge)));
    const panelNormal = normalize(projectedSun, normalize(cross(hinge, orbitNormal)));
    const incidenceCosine = clamp(dot(panelNormal, sun), 0, 1);
    const incidenceDeg = Math.acos(incidenceCosine) * RAD;
    const shadowFactor = eclipseFactor(position, sun);
    const generatedPowerW =
      SOLAR_CONSTANT_W_M2 * arrayFactor * incidenceCosine * shadowFactor;

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
      hingeAxis: hinge,
      hingeBody: axisBody(axis),
      panelNormal,
      panelNormalBody: bodyComponents(panelNormal, frame),
      betaDeg,
      incidenceDeg,
      shadowFactor,
      powerW: generatedPowerW,
      socPct,
    });
  }

  const durationHours = durationSec / 3600;
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
      energyPerOrbitWh: energyWh / clamp(mission.durationOrbits, 1, 5),
      eclipsePerOrbitSec: eclipseEquivalentSec / clamp(mission.durationOrbits, 1, 5),
      betaMinDeg,
      betaMaxDeg,
      minSocPct,
      finalSocPct: (batteryWh / capacityWh) * 100,
      energyMarginWh: energyWh - loadEnergyWh,
      raanRateDegDay: raanRate * RAD * 86400,
    } satisfies SimulationMetrics,
  };
}

export function runSimulation(mission: MissionConfig, power: PowerConfig): SimulationResult {
  const selected = simulateAxis(mission, power, mission.deploymentAxis);
  const comparisons = (["X", "Y", "Z"] as Axis[]).map((axis) => {
    const result = axis === mission.deploymentAxis ? selected : simulateAxis(mission, power, axis);
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


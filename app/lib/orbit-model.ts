export type Vector3 = [number, number, number];
export type QuaternionTuple = [number, number, number, number];
export type OrbitPreset = "LEO" | "SSO" | "GEO";
export type Axis = "X" | "Y" | "Z";
export type SignedAxis = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
export type AttitudeMode = "LVLH" | "SUN_POINTING" | "INERTIAL";
export type WingLayout = "SINGLE" | "DUAL";
export type CellModel =
  | "AZUR_3G30_ADV_4X8"
  | "AZUR_3G30_ADV_HP"
  | "AZUR_4G32_ADV_4X8"
  | "AZUR_4G32_ADV_HP"
  | "CUSTOM";

export interface MissionConfig {
  preset: OrbitPreset;
  altitudeKm: number;
  inclinationDeg: number;
  raanDeg: number;
  ltanHours: number;
  eccentricity: number;
  argumentOfPerigeeDeg: number;
  trueAnomalyDeg: number;
  epoch: string;
  durationDays: number;
  stepSec: number;
  attitude: AttitudeMode;
  panelFacingAxis: SignedAxis;
  velocityBodyAxis: SignedAxis;
  nadirBodyAxis: SignedAxis;
  panelRotationXDeg: number;
  panelRotationYDeg: number;
  panelRotationZDeg: number;
  wingLayout: WingLayout;
}

export interface PowerConfig {
  cellModel: CellModel;
  vmpV: number;
  impA: number;
  vscV: number;
  iscA: number;
  eolVmpV: number;
  eolImpA: number;
  eolVocV: number;
  eolIscA: number;
  cellAreaCm2: number;
  seriesCells: number;
  parallelStrings: number;
  packagingEfficiencyPct: number;
  fluenceE14Cm2: number;
  referenceIrradianceWm2: number;
  referenceTemperatureC: number;
  operatingTemperatureC: number;
  powerTempCoefficientPctC: number;
  pointingErrorDeg: number;
  angularResponseExponent: number;
  mpptEfficiencyPct: number;
  harnessEfficiencyPct: number;
  mismatchLossPct: number;
  diodeLossPct: number;
  contaminationLossPct: number;
  selfShadowLossPct: number;
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
  bodyXAxis: Vector3;
  bodyYAxis: Vector3;
  bodyZAxis: Vector3;
  bodyMinusZAxis: Vector3;
  hingeAxis: Vector3;
  hingeBody: Vector3;
  panelNormal: Vector3;
  panelNormalBody: Vector3;
  payloadBoresight: Vector3;
  payloadBoresightBody: Vector3;
  payloadEarthAngleDeg?: number;
  payloadSunAngleDeg?: number;
  payloadPointingResidualDeg?: number;
  /** Minimum attitude-frame rotation applied to keep imported SUN_BODY in the locked inertial Sun frame. */
  attitudeCorrectionDeg?: number;
  betaDeg: number;
  incidenceDeg: number;
  shadowFactor: number;
  powerW: number;
  measuredPowerW?: number;
  perfectPointingPowerW?: number;
  dilGenerationFactorPct?: number;
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
  eolArrayPowerW: number;
  bolArrayVmpV: number;
  bolArrayImpA: number;
  impliedCellEfficiencyPct: number;
  radiationRetentionPct: number;
  temperatureRetentionPct: number;
  electricalRetentionPct: number;
  opticalRetentionPct: number;
  solarFluxMinWm2: number;
  solarFluxMaxWm2: number;
  perigeeAltitudeKm: number;
  apogeeAltitudeKm: number;
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
/** AZUR SPACE datasheet reference irradiance for the catalog cell values. */
export const SOLAR_CONSTANT_W_M2 = 1367;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const SUN_ANGULAR_RADIUS_RAD = 0.2666 * DEG;

/**
 * Returns the target quaternion representation that lies in the same
 * hemisphere as the current orientation. q and -q describe the same pose,
 * but choosing the nearer representation is what makes interpolation follow
 * the shortest physical slew across 0°/360° wrap boundaries.
 */
export function shortestQuaternionTarget(
  current: QuaternionTuple,
  target: QuaternionTuple,
): QuaternionTuple {
  const dotProduct = current[0] * target[0]
    + current[1] * target[1]
    + current[2] * target[2]
    + current[3] * target[3];
  return dotProduct < 0
    ? [-target[0], -target[1], -target[2], -target[3]]
    : [...target];
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

/**
 * Orthonormal view basis for a virtual formation-flying observer positioned
 * above the orbit plane and slightly behind the spacecraft velocity vector.
 * `depth` points from the observer toward the spacecraft and `up` stays close
 * to radial-out, keeping Earth visually below the tracked spacecraft.
 */
export function formationObserverBasis(positionKm: Vector3, velocityKmS: Vector3) {
  const radialOut = normalize(positionKm);
  const forward = normalize(velocityKmS);
  const orbitNormal = normalize(cross(radialOut, forward), [0, 0, 1]);
  const depth = normalize(add(scale(forward, 0.36), scale(orbitNormal, -0.93)));
  const right = normalize(cross(depth, radialOut), forward);
  const up = normalize(cross(right, depth), radialOut);
  return { right, up, depth, radialOut, forward, orbitNormal };
}

/**
 * Cinematic camera rig that travels along the propagated orbit instead of
 * pinning the spacecraft to the viewer. The camera trails the vehicle, floats
 * above and slightly cross-track, then looks toward a point ahead and a little
 * Earthward. Distances scale with altitude but stay usable from LEO to GEO.
 */
export function orbitalFollowCamera(positionKm: Vector3, velocityKmS: Vector3) {
  const radialOut = normalize(positionKm);
  const forward = normalize(velocityKmS);
  const orbitNormal = normalize(cross(radialOut, forward), [0, 0, 1]);
  const altitudeKm = Math.max(100, magnitude(positionKm) - EARTH_RADIUS_KM);
  const trailingKm = Math.min(3200, Math.max(360, altitudeKm * 0.9));
  const aboveKm = trailingKm * 0.54;
  const crossTrackKm = trailingKm * 0.58;
  const leadKm = trailingKm * 0.36;
  const earthwardLookKm = trailingKm * 0.32;
  const cameraPositionKm = add(
    add(subtract(positionKm, scale(forward, trailingKm)), scale(radialOut, aboveKm)),
    scale(orbitNormal, crossTrackKm),
  );
  const targetKm = subtract(add(positionKm, scale(forward, leadKm)), scale(radialOut, earthwardLookKm));
  const depth = normalize(subtract(targetKm, cameraPositionKm));
  const right = normalize(cross(depth, radialOut), orbitNormal);
  const up = normalize(cross(right, depth), radialOut);
  return {
    cameraPositionKm,
    targetKm,
    right,
    up,
    depth,
    radialOut,
    forward,
    orbitNormal,
    nearClipKm: Math.max(8, trailingKm * 0.04),
  };
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

/** Earth-Sun irradiance multiplier relative to 1 AU using a low-order solar ephemeris. */
export function solarIrradianceScale(date: Date) {
  const days = toJulianDate(date) - 2451545;
  const meanAnomaly = (357.529 + 0.98560028 * days) * DEG;
  const distanceAu = 1.00014 - 0.01671 * Math.cos(meanAnomaly) - 0.00014 * Math.cos(2 * meanAnomaly);
  return 1 / (distanceAu * distanceAu);
}

/** Greenwich mean sidereal angle for orienting Earth-fixed longitude in ECI. */
export function greenwichMeanSiderealAngleRad(date: Date) {
  const julianDate = date.getTime() / 86_400_000 + 2_440_587.5;
  const daysSinceJ2000 = julianDate - 2_451_545;
  const centuriesSinceJ2000 = daysSinceJ2000 / 36_525;
  const angleDeg = 280.46061837
    + 360.98564736629 * daysSinceJ2000
    + 0.000387933 * centuriesSinceJ2000 ** 2
    - centuriesSinceJ2000 ** 3 / 38_710_000;
  return (((angleDeg % 360) + 360) % 360) * DEG;
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

function solveEccentricAnomaly(meanAnomalyRad: number, eccentricity: number) {
  const wrappedMeanAnomaly = ((meanAnomalyRad + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  let eccentricAnomaly = eccentricity < 0.8 ? wrappedMeanAnomaly : Math.PI;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const residual = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - wrappedMeanAnomaly;
    eccentricAnomaly -= residual / Math.max(1e-9, 1 - eccentricity * Math.cos(eccentricAnomaly));
  }
  return eccentricAnomaly;
}

function meanAnomalyFromTrueAnomaly(trueAnomalyRad: number, eccentricity: number) {
  const eccentricAnomaly = 2 * Math.atan2(
    Math.sqrt(1 - eccentricity) * Math.sin(trueAnomalyRad / 2),
    Math.sqrt(1 + eccentricity) * Math.cos(trueAnomalyRad / 2),
  );
  return eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly);
}

function orbitState(
  semiMajorAxisKm: number,
  eccentricity: number,
  inclinationRad: number,
  raanRad: number,
  argumentOfPerigeeRad: number,
  meanAnomalyRad: number,
) {
  const eccentricAnomaly = solveEccentricAnomaly(meanAnomalyRad, eccentricity);
  const radiusKm = semiMajorAxisKm * (1 - eccentricity * Math.cos(eccentricAnomaly));
  const xPerifocal = semiMajorAxisKm * (Math.cos(eccentricAnomaly) - eccentricity);
  const yPerifocal = semiMajorAxisKm * Math.sqrt(1 - eccentricity ** 2) * Math.sin(eccentricAnomaly);
  const velocityScale = Math.sqrt(EARTH_MU_KM3_S2 * semiMajorAxisKm) / radiusKm;
  const vxPerifocal = -velocityScale * Math.sin(eccentricAnomaly);
  const vyPerifocal = velocityScale * Math.sqrt(1 - eccentricity ** 2) * Math.cos(eccentricAnomaly);
  const cosO = Math.cos(raanRad);
  const sinO = Math.sin(raanRad);
  const cosI = Math.cos(inclinationRad);
  const sinI = Math.sin(inclinationRad);
  const cosW = Math.cos(argumentOfPerigeeRad);
  const sinW = Math.sin(argumentOfPerigeeRad);
  const pHat: Vector3 = [
    cosO * cosW - sinO * sinW * cosI,
    sinO * cosW + cosO * sinW * cosI,
    sinW * sinI,
  ];
  const qHat: Vector3 = [
    -cosO * sinW - sinO * cosW * cosI,
    -sinO * sinW + cosO * cosW * cosI,
    cosW * sinI,
  ];
  const position: Vector3 = [
    pHat[0] * xPerifocal + qHat[0] * yPerifocal,
    pHat[1] * xPerifocal + qHat[1] * yPerifocal,
    pHat[2] * xPerifocal + qHat[2] * yPerifocal,
  ];
  const velocity: Vector3 = [
    pHat[0] * vxPerifocal + qHat[0] * vyPerifocal,
    pHat[1] * vxPerifocal + qHat[1] * vyPerifocal,
    pHat[2] * vxPerifocal + qHat[2] * vyPerifocal,
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

export interface OrbitFrameSample {
  positionKm: Vector3;
  velocityKmS: Vector3;
  velocityDirection: Vector3;
  nadirDirection: Vector3;
  bodyXAxis: Vector3;
  bodyYAxis: Vector3;
  bodyZAxis: Vector3;
  mappedVelocityDirection: Vector3;
  mappedNadirDirection: Vector3;
  velocityAlignmentErrorDeg: number;
  nadirAlignmentErrorDeg: number;
  frameOrthogonalityErrorDeg: number;
  validAxisMapping: boolean;
}

function angleBetweenDeg(a: Vector3, b: Vector3) {
  return Math.acos(clamp(dot(normalize(a), normalize(b)), -1, 1)) * RAD;
}

/**
 * Circular-orbit LVLH reference used by the isolated inventory integration lab.
 * It intentionally reuses the simulator's orbit and body-frame mapping equations.
 */
export function orbitFrameSample(
  altitudeKm: number,
  inclinationDeg: number,
  raanDeg: number,
  trueAnomalyDeg: number,
  velocityBodyAxis: SignedAxis,
  nadirBodyAxis: SignedAxis,
): OrbitFrameSample {
  const state = orbitState(
    EARTH_RADIUS_KM + altitudeKm,
    0,
    inclinationDeg * DEG,
    raanDeg * DEG,
    0,
    trueAnomalyDeg * DEG,
  );
  const velocityDirection = normalize(state.velocity);
  const nadirDirection = normalize(scale(state.position, -1));
  const frame = mappedBodyFrame(velocityDirection, nadirDirection, velocityBodyAxis, nadirBodyAxis);
  const mappedVelocityDirection = normalize(bodyToInertial(signedAxisVector(velocityBodyAxis), frame));
  const mappedNadirDirection = normalize(bodyToInertial(signedAxisVector(nadirBodyAxis), frame));
  const velocityParts = signedAxisParts(velocityBodyAxis);
  const nadirParts = signedAxisParts(nadirBodyAxis);
  return {
    positionKm: state.position,
    velocityKmS: state.velocity,
    velocityDirection,
    nadirDirection,
    bodyXAxis: frame.x,
    bodyYAxis: frame.y,
    bodyZAxis: frame.z,
    mappedVelocityDirection,
    mappedNadirDirection,
    velocityAlignmentErrorDeg: angleBetweenDeg(mappedVelocityDirection, velocityDirection),
    nadirAlignmentErrorDeg: angleBetweenDeg(mappedNadirDirection, nadirDirection),
    frameOrthogonalityErrorDeg: Math.abs(90 - angleBetweenDeg(frame.x, frame.y)),
    validAxisMapping: velocityParts.index !== nadirParts.index,
  };
}

export function bodyAxisDirectionInInertial(
  axis: SignedAxis,
  sample: Pick<OrbitFrameSample, "bodyXAxis" | "bodyYAxis" | "bodyZAxis">,
): Vector3 {
  return normalize(bodyToInertial(signedAxisVector(axis), {
    x: sample.bodyXAxis,
    y: sample.bodyYAxis,
    z: sample.bodyZAxis,
  }));
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

function mountedPanelVector(mission: MissionConfig, axis: SignedAxis): Vector3 {
  let vector = signedAxisVector(axis);
  vector = rotateAround(vector, [1, 0, 0], mission.panelRotationXDeg * DEG);
  vector = rotateAround(vector, [0, 1, 0], mission.panelRotationYDeg * DEG);
  vector = rotateAround(vector, [0, 0, 1], mission.panelRotationZDeg * DEG);
  return normalize(vector);
}

function inferredPanelHingeAxis(facingAxis: SignedAxis): SignedAxis {
  if (facingAxis.endsWith("X")) return "+Y";
  if (facingAxis.endsWith("Y")) return "+Z";
  return "+Y";
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

export function arrayPowerCorrectionFactors(
  power: PowerConfig,
  date: Date,
  incidenceDeg: number,
  shadowFactor: number,
) {
  const temperatureRetention = clamp(
    1 + (power.powerTempCoefficientPctC / 100) * (power.operatingTemperatureC - power.referenceTemperatureC),
    0,
    1.25,
  );
  const electricalRetention =
    clamp(1 - power.systemLossPct / 100, 0, 1)
    * clamp(power.mpptEfficiencyPct / 100, 0, 1)
    * clamp(power.harnessEfficiencyPct / 100, 0, 1)
    * clamp(1 - power.mismatchLossPct / 100, 0, 1)
    * clamp(1 - power.diodeLossPct / 100, 0, 1);
  const opticalRetention =
    clamp(1 - power.contaminationLossPct / 100, 0, 1)
    * clamp(1 - power.selfShadowLossPct / 100, 0, 1);
  const adjustedIncidenceDeg = clamp(incidenceDeg + Math.max(0, power.pointingErrorDeg), 0, 180);
  const directCosine = Math.max(0, Math.cos(adjustedIncidenceDeg * DEG));
  const incidenceRetention = directCosine ** clamp(power.angularResponseExponent, 0.25, 4);
  const solarFluxWm2 = Math.max(0, power.referenceIrradianceWm2) * solarIrradianceScale(date);
  const irradianceRetention = solarFluxWm2 / SOLAR_CONSTANT_W_M2;
  return {
    temperatureRetention,
    electricalRetention,
    opticalRetention,
    incidenceRetention,
    irradianceRetention,
    solarFluxWm2,
    totalRetention:
      temperatureRetention
      * electricalRetention
      * opticalRetention
      * incidenceRetention
      * irradianceRetention
      * clamp(shadowFactor, 0, 1),
  };
}

function simulateAxis(
  mission: MissionConfig,
  power: PowerConfig,
  facingAxis: SignedAxis,
  payloadBoresightAxis: SignedAxis = mission.nadirBodyAxis,
) {
  const epoch = new Date(mission.epoch);
  const safeEpoch = Number.isNaN(epoch.getTime()) ? new Date("2026-01-01T00:00:00Z") : epoch;
  const lockedSunDirection = sunDirection(safeEpoch);
  const altitudeKm = mission.preset === "GEO" ? 35786 : clamp(mission.altitudeKm, 160, 50000);
  const inclinationDeg = mission.preset === "GEO" ? 0 : clamp(mission.inclinationDeg, 0, 180);
  const semiMajorAxis = EARTH_RADIUS_KM + altitudeKm;
  const maximumSafeEccentricity = clamp(1 - (EARTH_RADIUS_KM + 160) / semiMajorAxis, 0, 0.8);
  const eccentricity = mission.preset === "GEO" ? 0 : clamp(mission.eccentricity, 0, maximumSafeEccentricity);
  const inclination = inclinationDeg * DEG;
  const periodSec = orbitalPeriodSec(altitudeKm);
  const meanMotion = Math.sqrt(EARTH_MU_KM3_S2 / semiMajorAxis ** 3);
  const semiLatusRectumKm = semiMajorAxis * (1 - eccentricity ** 2);
  const raanRate =
    -1.5 * EARTH_J2 * meanMotion * (EARTH_RADIUS_KM / semiLatusRectumKm) ** 2 * Math.cos(inclination);
  const argumentOfPerigeeRate = eccentricity > 1e-6
    ? 0.75 * EARTH_J2 * meanMotion * (EARTH_RADIUS_KM / semiLatusRectumKm) ** 2 * (5 * Math.cos(inclination) ** 2 - 1)
    : 0;
  const effectiveRaanDeg =
    mission.preset === "SSO"
      ? ssoRaanFromLtan(safeEpoch, mission.ltanHours)
      : ((mission.raanDeg % 360) + 360) % 360;
  const raan0 = effectiveRaanDeg * DEG;
  const argumentOfPerigee0 = (mission.preset === "GEO" ? 0 : mission.argumentOfPerigeeDeg) * DEG;
  const initialTrueAnomaly = mission.trueAnomalyDeg * DEG;
  const initialMeanAnomaly = meanAnomalyFromTrueAnomaly(initialTrueAnomaly, eccentricity);
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
  let solarFluxMinWm2 = Number.POSITIVE_INFINITY;
  let solarFluxMaxWm2 = 0;
  const seriesCells = Math.max(1, Math.round(power.seriesCells));
  const parallelStrings = Math.max(1, Math.round(power.parallelStrings));
  const cellCount = seriesCells * parallelStrings;
  const activeCellAreaM2 = cellCount * Math.max(0.01, power.cellAreaCm2) / 10000;
  const packagingFactor = clamp(power.packagingEfficiencyPct / 100, 0.1, 1);
  const packagedAreaM2 = activeCellAreaM2 / packagingFactor;
  const bolArrayPowerW =
    Math.max(0, power.vmpV) * Math.max(0, power.impA) * cellCount;
  const eolArrayPowerW =
    Math.max(0, power.eolVmpV) * Math.max(0, power.eolImpA) * cellCount;
  const radiationRetention = bolArrayPowerW > 0
    ? clamp(eolArrayPowerW / bolArrayPowerW, 0, 1.2)
    : 0;
  const referenceCorrections = arrayPowerCorrectionFactors(power, safeEpoch, 0, 1);
  const impliedCellEfficiencyPct =
    activeCellAreaM2 > 0
      ? (bolArrayPowerW / (Math.max(1, power.referenceIrradianceWm2) * activeCellAreaM2)) * 100
      : 0;

  for (let sample = 0; sample <= sampleCount; sample += 1) {
    const tSec = Math.min(sample * dt, durationSec);
    const sun = lockedSunDirection;
    const raan = raan0 + raanRate * tSec;
    const argumentOfPerigee = argumentOfPerigee0 + argumentOfPerigeeRate * tSec;
    const meanAnomaly = initialMeanAnomaly + meanMotion * tSec;
    const { position, velocity } = orbitState(
      semiMajorAxis,
      eccentricity,
      inclination,
      raan,
      argumentOfPerigee,
      meanAnomaly,
    );
    const orbitNormal = normalize(cross(position, velocity), [0, 0, 1]);
    const betaDeg = Math.asin(clamp(dot(orbitNormal, sun), -1, 1)) * RAD;
    const frame = bodyFrame(mission, position, velocity, sun);
    const hingeBody = mountedPanelVector(mission, inferredPanelHingeAxis(facingAxis));
    const hinge = normalize(bodyToInertial(hingeBody, frame));
    const baseNormalBody = mountedPanelVector(mission, facingAxis);
    const basePanelNormal = normalize(bodyToInertial(baseNormalBody, frame));
    const payloadBoresightBody = signedAxisVector(payloadBoresightAxis);
    const payloadBoresight = normalize(bodyToInertial(payloadBoresightBody, frame));
    // The panel is rigidly mounted after deployment. Spacecraft attitude, not an
    // idealized array drive, changes its Sun incidence through the orbit.
    const panelNormal = basePanelNormal;
    const incidenceDot = clamp(dot(panelNormal, sun), -1, 1);
    const incidenceDeg = Math.acos(incidenceDot) * RAD;
    const shadowFactor = eclipseFactor(position, sun);
    const sampleDate = new Date(safeEpoch.getTime() + tSec * 1000);
    const corrections = arrayPowerCorrectionFactors(power, sampleDate, incidenceDeg, shadowFactor);
    const generatedPowerW = eolArrayPowerW * corrections.totalRetention;
    solarFluxMinWm2 = Math.min(solarFluxMinWm2, corrections.solarFluxWm2);
    solarFluxMaxWm2 = Math.max(solarFluxMaxWm2, corrections.solarFluxWm2);

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
      bodyXAxis: frame.x,
      bodyYAxis: frame.y,
      bodyZAxis: frame.z,
      bodyMinusZAxis: normalize(bodyToInertial([0, 0, -1], frame)),
      hingeAxis: hinge,
      hingeBody,
      panelNormal,
      panelNormalBody: bodyComponents(panelNormal, frame),
      payloadBoresight,
      payloadBoresightBody,
      payloadEarthAngleDeg: angleBetweenDeg(payloadBoresight, normalize(scale(position, -1))),
      payloadSunAngleDeg: angleBetweenDeg(payloadBoresight, sun),
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
      arrayVmpV: seriesCells * Math.max(0, power.eolVmpV),
      arrayImpA: parallelStrings * Math.max(0, power.eolImpA),
      arrayVscV: seriesCells * Math.max(0, power.eolVocV),
      arrayIscA: parallelStrings * Math.max(0, power.eolIscA),
      bolArrayPowerW,
      eolArrayPowerW,
      bolArrayVmpV: seriesCells * Math.max(0, power.vmpV),
      bolArrayImpA: parallelStrings * Math.max(0, power.impA),
      impliedCellEfficiencyPct,
      radiationRetentionPct: radiationRetention * 100,
      temperatureRetentionPct: referenceCorrections.temperatureRetention * 100,
      electricalRetentionPct: referenceCorrections.electricalRetention * 100,
      opticalRetentionPct: referenceCorrections.opticalRetention * 100,
      solarFluxMinWm2,
      solarFluxMaxWm2,
      perigeeAltitudeKm: semiMajorAxis * (1 - eccentricity) - EARTH_RADIUS_KM,
      apogeeAltitudeKm: semiMajorAxis * (1 + eccentricity) - EARTH_RADIUS_KM,
    } satisfies SimulationMetrics,
  };
}

export function runSimulation(
  mission: MissionConfig,
  power: PowerConfig,
  payloadBoresightAxis: SignedAxis = mission.nadirBodyAxis,
): SimulationResult {
  const selected = simulateAxis(mission, power, mission.panelFacingAxis, payloadBoresightAxis);
  const comparisons = (["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as SignedAxis[]).map((axis) => {
    const result = axis === mission.panelFacingAxis ? selected : simulateAxis(mission, power, axis, payloadBoresightAxis);
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
  if (seconds >= 86400) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  return `${Math.round(seconds / 60)} min`;
}

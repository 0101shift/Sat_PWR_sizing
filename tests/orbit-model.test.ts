import assert from "node:assert/strict";
import test from "node:test";
import {
  arrayPowerCorrectionFactors,
  eclipseFactor,
  formationObserverBasis,
  formatDuration,
  greenwichMeanSiderealAngleRad,
  orbitalFollowCamera,
  orbitalPeriodSec,
  orbitFrameSample,
  bodyAxisDirectionInInertial,
  runSimulation,
  shortestQuaternionTarget,
  solarIrradianceScale,
  sunDirection,
  type MissionConfig,
  type PowerConfig,
} from "../app/lib/orbit-model";

test("quaternion continuity selects the shortest physical attitude slew", () => {
  const degrees = (value: number) => value * Math.PI / 180;
  const current: [number, number, number, number] = [0, 0, Math.sin(degrees(10)), Math.cos(degrees(10))];
  // The negated quaternion is the same 60° target pose, but naive component
  // interpolation would travel through the long rotation.
  const target: [number, number, number, number] = [0, 0, -Math.sin(degrees(30)), -Math.cos(degrees(30))];
  const aligned = shortestQuaternionTarget(current, target);
  const dot = current.reduce((sum, value, index) => sum + value * aligned[index], 0);
  const shortestArcDeg = 2 * Math.acos(Math.min(1, Math.abs(dot))) * 180 / Math.PI;
  assert.ok(dot > 0, "target must be placed in the current quaternion hemisphere");
  assert.ok(Math.abs(shortestArcDeg - 40) < 1e-10, `${shortestArcDeg} deg`);
});

test("multi-day durations are reported in days instead of accumulated hours", () => {
  assert.equal(formatDuration(172800), "2d 0h 0m");
});

test("400 km circular LEO period matches the analytical reference", () => {
  const periodMinutes = orbitalPeriodSec(400) / 60;
  assert.ok(periodMinutes > 92 && periodMinutes < 93, `${periodMinutes} min`);
});

test("GEO circular period is one sidereal day within the spherical model", () => {
  const periodMinutes = orbitalPeriodSec(35786) / 60;
  assert.ok(periodMinutes > 1435 && periodMinutes < 1437, `${periodMinutes} min`);
});

test("formation observer stays above and behind while keeping Earth below", () => {
  const basis = formationObserverBasis([7000, 0, 0], [0, 7.5, 0]);
  const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  assert.ok(Math.abs(Math.hypot(...basis.right) - 1) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...basis.up) - 1) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...basis.depth) - 1) < 1e-12);
  assert.ok(Math.abs(dot(basis.right, basis.up)) < 1e-12);
  assert.ok(Math.abs(dot(basis.right, basis.depth)) < 1e-12);
  assert.ok(Math.abs(dot(basis.up, basis.depth)) < 1e-12);
  assert.ok(dot(basis.up, basis.radialOut) > 0.999999999);
  assert.ok(dot(basis.depth, basis.forward) > 0);
  assert.ok(dot(basis.depth, basis.orbitNormal) < 0);
  assert.ok(dot(basis.up, [-1, 0, 0]) < -0.999999999);
});

test("orbital follow camera trails the spacecraft and looks ahead along orbit", () => {
  const position: [number, number, number] = [7000, 0, 0];
  const velocity: [number, number, number] = [0, 7.5, 0];
  const camera = orbitalFollowCamera(position, velocity);
  const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const cameraToSatellite = position.map((value, index) => value - camera.cameraPositionKm[index]);
  const targetFromSatellite = camera.targetKm.map((value, index) => value - position[index]);
  assert.ok(dot(cameraToSatellite, camera.forward) > 0, "camera must trail the satellite");
  assert.ok(dot(camera.cameraPositionKm, camera.radialOut) > dot(position, camera.radialOut), "camera must float above the orbit");
  assert.ok(dot(targetFromSatellite, camera.forward) > 0, "camera target must lead the satellite");
  assert.ok(dot(camera.depth, cameraToSatellite) > 0, "satellite must remain in front of the camera");
  assert.ok(Math.abs(dot(camera.right, camera.up)) < 1e-12);
  assert.ok(Math.abs(dot(camera.right, camera.depth)) < 1e-12);
  assert.ok(Math.abs(dot(camera.up, camera.depth)) < 1e-12);
});

test("LVLH laboratory frame aligns configured signed velocity and nadir axes", () => {
  const sample = orbitFrameSample(550, 97.6, 42, 137, "+X", "-Z");
  assert.equal(sample.validAxisMapping, true);
  assert.ok(sample.velocityAlignmentErrorDeg < 1e-8, `${sample.velocityAlignmentErrorDeg} deg`);
  assert.ok(sample.nadirAlignmentErrorDeg < 1e-8, `${sample.nadirAlignmentErrorDeg} deg`);
  assert.ok(sample.frameOrthogonalityErrorDeg < 1e-8, `${sample.frameOrthogonalityErrorDeg} deg`);
  const payloadDirection = bodyAxisDirectionInInertial("-Z", sample);
  const payloadNadirDot = payloadDirection.reduce(
    (sum, component, index) => sum + component * sample.nadirDirection[index],
    0,
  );
  assert.ok(payloadNadirDot > 0.999999999);
});

test("LVLH laboratory frame supports alternate signed body-axis mappings", () => {
  const sample = orbitFrameSample(786, 98.5, 165, 298, "-Y", "+Z");
  assert.equal(sample.validAxisMapping, true);
  assert.ok(sample.velocityAlignmentErrorDeg < 1e-8);
  assert.ok(sample.nadirAlignmentErrorDeg < 1e-8);
});

test("LVLH laboratory frame flags velocity and nadir on the same axis family", () => {
  const sample = orbitFrameSample(500, 45, 0, 0, "+X", "-X");
  assert.equal(sample.validAxisMapping, false);
});

test("Sun direction is normalized", () => {
  const sun = sunDirection(new Date("2026-08-18T00:00:00Z"));
  const norm = Math.hypot(...sun);
  assert.ok(Math.abs(norm - 1) < 1e-12);
});

test("Earth-Sun distance raises January irradiance above July irradiance", () => {
  const january = solarIrradianceScale(new Date("2026-01-03T00:00:00Z"));
  const july = solarIrradianceScale(new Date("2026-07-04T00:00:00Z"));
  assert.ok(january > 1);
  assert.ok(july < 1);
  assert.ok(january > july);
});

test("GMST initializes Earth rotation at the J2000 reference epoch", () => {
  const angleDeg = greenwichMeanSiderealAngleRad(new Date("2000-01-01T12:00:00Z")) * 180 / Math.PI;
  assert.ok(Math.abs(angleDeg - 280.46061837) < 1e-8, `${angleDeg} deg`);
});

test("conical eclipse discriminator recognizes day and night side", () => {
  const sun: [number, number, number] = [1, 0, 0];
  assert.equal(eclipseFactor([7000, 0, 0], sun), 1);
  assert.equal(eclipseFactor([-7000, 0, 0], sun), 0);
});

test("simulation produces bounded power, battery, and a complete axis ranking", () => {
  const mission: MissionConfig = {
    preset: "SSO",
    altitudeKm: 550,
    inclinationDeg: 97.6,
    raanDeg: 0,
    ltanHours: 10.5,
    eccentricity: 0,
    argumentOfPerigeeDeg: 0,
    trueAnomalyDeg: 0,
    epoch: "2026-08-18T00:00:00Z",
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
  const power: PowerConfig = {
    cellModel: "AZUR_3G30_ADV_HP",
    vmpV: 2.395,
    impA: 1.269,
    vscV: 2.7,
    iscA: 1.303,
    eolVmpV: 2.247,
    eolImpA: 1.255,
    eolVocV: 2.552,
    eolIscA: 1.293,
    cellAreaCm2: 77.55,
    seriesCells: 32,
    parallelStrings: 16,
    packagingEfficiencyPct: 88,
    fluenceE14Cm2: 5,
    referenceIrradianceWm2: 1367,
    referenceTemperatureC: 28,
    operatingTemperatureC: 28,
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
    averageLoadW: 420,
    batteryWh: 520,
    initialSocPct: 100,
  };
  const result = runSimulation(mission, power);
  assert.deepEqual(result.points.at(-1)?.sunVector, result.points[0].sunVector);
  assert.ok(result.points.length > 100);
  assert.equal(result.metrics.durationSec, 2 * 86400);
  assert.ok(result.metrics.energyPerOrbitWh > 0);
  const expectedBolPower = 2.395 * 1.269 * 32 * 16;
  const expectedEolPower = 2.247 * 1.255 * 32 * 16;
  assert.equal(result.metrics.bolArrayPowerW, expectedBolPower);
  assert.equal(result.metrics.eolArrayPowerW, expectedEolPower);
  const referenceCorrections = arrayPowerCorrectionFactors(power, new Date(mission.epoch), 0, 1);
  assert.ok(Math.abs(result.metrics.bolNetArrayPowerW - expectedBolPower * referenceCorrections.totalRetention) < 1e-9);
  assert.ok(Math.abs(result.metrics.eolNetArrayPowerW - expectedEolPower * referenceCorrections.totalRetention) < 1e-9);
  assert.ok(result.metrics.peakPowerW <= expectedEolPower * 0.88 * 1.04 + 1e-9);
  assert.ok(Math.abs(result.metrics.activeCellAreaM2 - (32 * 16 * 77.55) / 10000) < 1e-12);
  assert.ok(Math.abs(result.metrics.packagedAreaM2 - result.metrics.activeCellAreaM2 / 0.88) < 1e-12);
  assert.equal(result.metrics.arrayVmpV, 2.247 * 32);
  assert.equal(result.metrics.arrayImpA, 1.255 * 16);
  assert.equal(result.metrics.bolArrayVmpV, 2.395 * 32);
  assert.ok(Math.abs(result.metrics.radiationRetentionPct - (expectedEolPower / expectedBolPower) * 100) < 1e-12);
  assert.equal(result.metrics.temperatureRetentionPct, 100);
  assert.equal(result.metrics.electricalRetentionPct, 88);
  assert.equal(result.metrics.opticalRetentionPct, 100);
  assert.equal(runSimulation({ ...mission, durationDays: 1 }, power).metrics.durationSec, 2 * 86400);
  assert.ok(result.points.every((point) => point.shadowFactor >= 0 && point.shadowFactor <= 1));
  const rearFacing = result.points.filter((point) => point.incidenceDeg > 90);
  assert.ok(rearFacing.length > 0);
  assert.ok(rearFacing.every((point) => point.powerW === 0));
  assert.ok(result.points.every((point) => point.socPct >= 0 && point.socPct <= 100));
  assert.ok(result.points.every((point) => Math.abs(Math.hypot(...point.bodyMinusZAxis) - 1) < 1e-9));
  assert.deepEqual([...result.axes.map((axis) => axis.rank)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  const sunlit = result.points.find((point) => point.shadowFactor > 0.999 && point.powerW > 0);
  assert.ok(sunlit);
  const corrections = arrayPowerCorrectionFactors(
    power,
    new Date(new Date(mission.epoch).getTime() + sunlit.tSec * 1000),
    sunlit.incidenceDeg,
    sunlit.shadowFactor,
  );
  const expectedInstantPower = expectedEolPower * corrections.totalRetention;
  assert.ok(Math.abs(sunlit.powerW - expectedInstantPower) < 1e-8);
  const derated = arrayPowerCorrectionFactors({
    ...power,
    operatingTemperatureC: 78,
    powerTempCoefficientPctC: -0.1,
    systemLossPct: 0,
    mpptEfficiencyPct: 90,
    harnessEfficiencyPct: 95,
    mismatchLossPct: 2,
    diodeLossPct: 1,
    contaminationLossPct: 3,
    selfShadowLossPct: 4,
  }, new Date(mission.epoch), 0, 1);
  assert.ok(Math.abs(derated.temperatureRetention - 0.95) < 1e-12);
  assert.ok(Math.abs(derated.electricalRetention - 0.9 * 0.95 * 0.98 * 0.99) < 1e-12);
  assert.ok(Math.abs(derated.opticalRetention - 0.97 * 0.96) < 1e-12);

  const eccentric = runSimulation({
    ...mission,
    preset: "LEO",
    altitudeKm: 2000,
    inclinationDeg: 20,
    eccentricity: 0.1,
    argumentOfPerigeeDeg: 35,
    trueAnomalyDeg: 0,
  }, power);
  assert.ok(Math.abs(eccentric.metrics.perigeeAltitudeKm - 1162.1863) < 1e-3);
  assert.ok(Math.abs(eccentric.metrics.apogeeAltitudeKm - 2837.8137) < 1e-3);
  assert.ok(Math.abs(Math.hypot(...eccentric.points[0].positionKm) - (6378.137 + 1162.1863)) < 1e-3);

  const remapped = runSimulation({
    ...mission,
    velocityBodyAxis: "-Y",
    nadirBodyAxis: "+X",
    panelFacingAxis: "+X",
    panelRotationZDeg: 90,
  }, power);
  const initial = remapped.points[0];
  assert.ok(Math.abs(initial.bodyVelocity[0]) < 1e-9 && Math.abs(initial.bodyVelocity[1] + 1) < 1e-9);
  assert.ok(Math.abs(initial.bodyNadir[0] - 1) < 1e-9 && Math.abs(initial.bodyNadir[1]) < 1e-9);
  assert.ok(Math.abs(initial.panelNormalBody[0]) < 1e-9 && Math.abs(initial.panelNormalBody[1] - 1) < 1e-9);
  assert.ok(Math.abs(initial.hingeBody[0] + 1) < 1e-9 && Math.abs(initial.hingeBody[1]) < 1e-9);
  assert.ok(remapped.points.every((point) => point.panelNormalBody.every((component, index) => Math.abs(component - initial.panelNormalBody[index]) < 1e-9)));
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  eclipseFactor,
  orbitalPeriodSec,
  runSimulation,
  sunDirection,
  type MissionConfig,
  type PowerConfig,
} from "../app/lib/orbit-model";

test("400 km circular LEO period matches the analytical reference", () => {
  const periodMinutes = orbitalPeriodSec(400) / 60;
  assert.ok(periodMinutes > 92 && periodMinutes < 93, `${periodMinutes} min`);
});

test("GEO circular period is one sidereal day within the spherical model", () => {
  const periodMinutes = orbitalPeriodSec(35786) / 60;
  assert.ok(periodMinutes > 1435 && periodMinutes < 1437, `${periodMinutes} min`);
});

test("Sun direction is normalized", () => {
  const sun = sunDirection(new Date("2026-08-18T00:00:00Z"));
  const norm = Math.hypot(...sun);
  assert.ok(Math.abs(norm - 1) < 1e-12);
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
    epoch: "2026-08-18T00:00:00Z",
    durationDays: 2,
    stepSec: 60,
    attitude: "LVLH",
    deploymentAxis: "Y",
  };
  const power: PowerConfig = {
    vmpV: 2.45,
    impA: 0.52,
    vscV: 2.75,
    iscA: 0.56,
    cellAreaCm2: 30.2,
    seriesCells: 32,
    parallelStrings: 16,
    packagingEfficiencyPct: 88,
    fluenceE14Cm2: 5,
    fluenceLossPctPerE14: 0.8,
    nonRadiationEolPct: 92,
    systemLossPct: 12,
    averageLoadW: 420,
    batteryWh: 520,
    initialSocPct: 100,
  };
  const result = runSimulation(mission, power);
  assert.ok(result.points.length > 100);
  assert.equal(result.metrics.durationSec, 2 * 86400);
  assert.ok(result.metrics.energyPerOrbitWh > 0);
  const expectedBolPower = 2.45 * 0.52 * 32 * 16;
  assert.equal(result.metrics.bolArrayPowerW, expectedBolPower);
  assert.ok(result.metrics.peakPowerW <= expectedBolPower + 1e-9);
  assert.ok(Math.abs(result.metrics.activeCellAreaM2 - (32 * 16 * 30.2) / 10000) < 1e-12);
  assert.ok(Math.abs(result.metrics.packagedAreaM2 - result.metrics.activeCellAreaM2 / 0.88) < 1e-12);
  assert.equal(result.metrics.arrayVmpV, 2.45 * 32);
  assert.equal(result.metrics.arrayImpA, 0.52 * 16);
  assert.equal(result.metrics.radiationRetentionPct, 96);
  assert.equal(runSimulation({ ...mission, durationDays: 1 }, power).metrics.durationSec, 2 * 86400);
  assert.ok(result.points.every((point) => point.shadowFactor >= 0 && point.shadowFactor <= 1));
  assert.ok(result.points.every((point) => point.socPct >= 0 && point.socPct <= 100));
  assert.deepEqual([...result.axes.map((axis) => axis.rank)].sort(), [1, 2, 3]);
});

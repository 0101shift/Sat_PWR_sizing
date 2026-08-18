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
    durationOrbits: 2,
    stepSec: 45,
    attitude: "LVLH",
    deploymentAxis: "Y",
  };
  const power: PowerConfig = {
    activeAreaM2: 2.4,
    efficiencyPct: 30,
    degradationPct: 80,
    systemLossPct: 12,
    averageLoadW: 420,
    batteryWh: 520,
    initialSocPct: 100,
  };
  const result = runSimulation(mission, power);
  assert.ok(result.points.length > 100);
  assert.ok(result.metrics.energyPerOrbitWh > 0);
  assert.ok(result.metrics.peakPowerW <= 1361 * 2.4 * 0.3 * 0.8 * 0.88 + 1e-9);
  assert.ok(result.points.every((point) => point.shadowFactor >= 0 && point.shadowFactor <= 1));
  assert.ok(result.points.every((point) => point.socPct >= 0 && point.socPct <= 100));
  assert.deepEqual([...result.axes.map((axis) => axis.rank)].sort(), [1, 2, 3]);
});


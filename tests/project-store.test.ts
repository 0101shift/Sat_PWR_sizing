import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ORBIT_PWR_MAX_LOAD_SCHEMA,
  ORBIT_PWR_PROJECT_SCHEMA,
  ORBIT_PWR_PROJECT_SPACECRAFT_SCHEMA,
  projectIdFromName,
  type OrbitPwrProjectBundle,
} from "../app/lib/project-schema";
import { DEFAULT_EO_SATELLITES } from "../app/lib/satellite-inventory";
import {
  LOCAL_PROJECTS_DIRECTORY,
  listLocalProjects,
  loadLocalProject,
  renameLocalProject,
  saveLocalProject,
} from "../build/local-project-store";
import type { MissionConfig, PowerConfig } from "../app/lib/orbit-model";

const mission: MissionConfig = {
  preset: "SSO", altitudeKm: 550, inclinationDeg: 97.6, raanDeg: 0, ltanHours: 10.5,
  eccentricity: 0, argumentOfPerigeeDeg: 0, trueAnomalyDeg: 0, epoch: "2028-01-01T00:00",
  durationDays: 1, stepSec: 60, attitude: "LVLH", panelFacingAxis: "+Y", velocityBodyAxis: "+X",
  nadirBodyAxis: "+Z", panelRotationXDeg: 0, panelRotationYDeg: 0, panelRotationZDeg: 0, wingLayout: "DUAL",
};

const power: PowerConfig = {
  cellModel: "AZUR_3G30_ADV_4X8", vmpV: 2.411, impA: 0.499, vscV: 2.7, iscA: 0.515,
  eolVmpV: 2.262, eolImpA: 0.494, eolVocV: 2.552, eolIscA: 0.511, cellAreaCm2: 30.18,
  seriesCells: 19, parallelStrings: 24, packagingEfficiencyPct: 90, fluenceE14Cm2: 5,
  referenceIrradianceWm2: 1367, referenceTemperatureC: 28, operatingTemperatureC: 60,
  powerTempCoefficientPctC: -0.08, pointingErrorDeg: 0, angularResponseExponent: 1,
  mpptEfficiencyPct: 95, harnessEfficiencyPct: 98, mismatchLossPct: 2, diodeLossPct: 1,
  contaminationLossPct: 2, selfShadowLossPct: 4, systemLossPct: 12, averageLoadW: 200,
  batteryWh: 1000, initialSocPct: 90,
};

function projectBundle(): OrbitPwrProjectBundle {
  const timestamp = "2028-01-01T00:00:00.000Z";
  return {
    project: {
      schema: ORBIT_PWR_PROJECT_SCHEMA,
      id: "mission-alpha",
      name: "Mission Alpha",
      description: "DIL sizing run",
      createdAt: timestamp,
      updatedAt: timestamp,
      dashboard: {
        mission,
        power,
        engineeringView: "POWER",
        playbackSpeed: 5,
        plotVisibility: { primary: true, modeled: false, perfect: true, load: true, soc: true },
        dil: { sampleIntervalSec: "10", referenceAxisOverride: "+Y", sourceFileName: "alpha.csv" },
      },
    },
    spacecraft: {
      schema: ORBIT_PWR_PROJECT_SPACECRAFT_SCHEMA,
      simulation: structuredClone(DEFAULT_EO_SATELLITES[0]),
      deployed: structuredClone(DEFAULT_EO_SATELLITES[0]),
    },
    maxLoads: {
      schema: ORBIT_PWR_MAX_LOAD_SCHEMA,
      loadsW: { "SUNLIT::IMAGING": 420, "ECLIPSE::IMAGING": 510 },
    },
    dilSource: {
      fileName: "alpha.csv",
      content: "TIME,SOLAR_POWER_GENERATED\n0,100\n",
    },
  };
}

test("project store round-trips dashboard, spacecraft, DIL source and max loads", async () => {
  const root = await mkdtemp(join(tmpdir(), "orbit-pwr-project-test-"));
  try {
    const source = projectBundle();
    await saveLocalProject(root, source);
    const restored = await loadLocalProject(root, source.project.id);
    assert.deepEqual(restored, source);
    const summaries = await listLocalProjects(root);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].spacecraftName, source.spacecraft.deployed.name);
    assert.equal(summaries[0].maxLoadCount, 2);
    assert.equal(summaries[0].hasDil, true);
    const savedLoads = JSON.parse(await readFile(join(root, LOCAL_PROJECTS_DIRECTORY, "mission-alpha", "dil", "max-loads.json"), "utf8"));
    assert.deepEqual(savedLoads.loadsW, source.maxLoads.loadsW);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project rename changes the dedicated folder and preserves its session", async () => {
  const root = await mkdtemp(join(tmpdir(), "orbit-pwr-project-rename-"));
  try {
    await saveLocalProject(root, projectBundle());
    const renamed = await renameLocalProject(root, "mission-alpha", "mission-beta", "Mission Beta", "Renamed study");
    assert.equal(renamed.project.id, "mission-beta");
    assert.equal(renamed.project.name, "Mission Beta");
    assert.equal(renamed.project.description, "Renamed study");
    assert.equal((await listLocalProjects(root))[0].id, "mission-beta");
    await assert.rejects(loadLocalProject(root, "mission-alpha"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project identifiers are normalized and traversal is rejected", async () => {
  assert.equal(projectIdFromName("  EO / Mission #7  "), "eo-mission-7");
  const root = await mkdtemp(join(tmpdir(), "orbit-pwr-project-safety-"));
  try {
    await assert.rejects(loadLocalProject(root, "../outside"), /Invalid project identifier/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

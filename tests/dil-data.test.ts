import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeDilAxisSweep,
  analyzeDilEnergy,
  analyzeDilOperationLoads,
  buildDilSimulation,
  dilLoadIlluminationState,
  dilOperationLoadKey,
  DIL_REQUIRED_FIELDS,
  DIL_TEMPLATE_FIELDS,
  parseDilData,
} from "../app/lib/dil-data";
import { arrayPowerCorrectionFactors, type MissionConfig, type PowerConfig } from "../app/lib/orbit-model";

const mission: MissionConfig = {
  preset: "LEO",
  altitudeKm: 550,
  inclinationDeg: 0,
  raanDeg: 0,
  ltanHours: 12,
  eccentricity: 0,
  argumentOfPerigeeDeg: 0,
  trueAnomalyDeg: 0,
  epoch: "2026-08-18T00:00",
  durationDays: 2,
  stepSec: 60,
  attitude: "LVLH",
  panelFacingAxis: "+Y",
  velocityBodyAxis: "+X",
  nadirBodyAxis: "+Z",
  panelRotationXDeg: 0,
  panelRotationYDeg: 0,
  panelRotationZDeg: 0,
  wingLayout: "DUAL",
};

const power: PowerConfig = {
  cellModel: "CUSTOM",
  vmpV: 2.4,
  impA: 0.5,
  vscV: 2.7,
  iscA: 0.55,
  eolVmpV: 2.2,
  eolImpA: 0.48,
  eolVocV: 2.5,
  eolIscA: 0.52,
  cellAreaCm2: 30,
  seriesCells: 10,
  parallelStrings: 2,
  packagingEfficiencyPct: 90,
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
  systemLossPct: 10,
  averageLoadW: 100,
  batteryWh: 100,
  initialSocPct: 50,
};

const csv = `TIME,SATELLITE_POSITION,SOLAR_POWER_GENERATED,SPACECRAFT_OPERATION,LATITUDE,LONGITUDE,SUN_BODY,EARTH_BODY,SUNLIT_STATUS,ATTITUDE_RPY,payload_earth,payload_sun,sun_+Y_panels
100,"[6928.137,0,0]",200,NOMINAL,0,30,"[0,1,0]","[-1,0,0]",SUNLIT,"[0,0,0]",CLEAR,SAFE,TRACKING
160,"[6920,450,0]",50,PAYLOAD,3.72,30.25,"[0,1,0]","[-0.998,-0.065,0]",ECLIPSE,"[0,0,0]",CLEAR,SAFE,TRACKING`;

function calendarCsv(times: string[]) {
  const fields = '"[6928.137,0,0]",200,NOMINAL,0,30,"[0,1,0]","[-1,0,0]",SUNLIT,"[0,0,0]",CLEAR,SAFE,TRACKING';
  return [csv.split("\n")[0], ...times.map((time) => `"${time}",${fields}`)].join("\n");
}

test("parses required DIL CSV fields and rebases numeric time", () => {
  const parsed = parseDilData(csv, "actual.csv");
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.sourceRecordCount, 2);
  assert.equal(parsed.energySeries.timeSec.length, 2);
  assert.deepEqual([...parsed.energySeries.measuredPowerW], [200, 50]);
  assert.deepEqual(parsed.energySeries.operations, ["NOMINAL", "PAYLOAD"]);
  assert.equal(parsed.powerSemantics, "WATTS");
  assert.equal(parsed.records[0].timeSec, 0);
  assert.equal(parsed.records[1].timeSec, 60);
  assert.deepEqual(parsed.records[0].satellitePositionKm, [6928.137, 0, 0]);
  assert.equal(parsed.records[1].latitudeDeg, 3.72);
  assert.equal(parsed.records[1].longitudeDeg, 30.25);
  assert.equal(parsed.records[1].spacecraftOperation, "PAYLOAD");
  assert.equal(parsed.records[1].solarPowerGeneratedW, 50);
});

test("accepts a JSON records envelope and case-insensitive field names", () => {
  const first = parseDilData(csv, "actual.csv").records[0];
  const source = {
    records: [{
      time: "2026-08-22T00:00:00Z",
      satellite_position: first.satellitePositionKm,
      solar_power_generated: 200,
      spacecraft_operation: "NOMINAL",
      latitude: 0,
      longitude: 30,
      sun_body: first.sunBody,
      earth_body: first.earthBody,
      sunlit_status: "SUNLIT",
      attitude_rpy: first.attitudeRpyDeg,
      payload_earth: "CLEAR",
      payload_sun: "SAFE",
      "sun_+y_panels": "TRACKING",
    }],
  };
  const parsed = parseDilData(JSON.stringify(source), "actual.json");
  assert.equal(parsed.records[0].timeSec, 0);
  assert.equal(parsed.records[0].sunPanelReference, "TRACKING");
  assert.equal(parsed.referencePanelAxis, "+Y");
  assert.equal(parsed.referenceAxisSource, "LEGACY_COLUMN");
});

test("accepts the universal SOLAR_PANEL_AXIS and SUN_PANEL_INCIDENCE fields", () => {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const angleDeg = index * 7;
    const sunX = Math.sin(angleDeg * Math.PI / 180);
    const sunMinusZ = -Math.cos(angleDeg * Math.PI / 180);
    const factor = Math.max(0, Math.cos(angleDeg * Math.PI / 180)) * 100;
    return `${index * 10},"[6928.137,${index},0]",${factor},SUNLIT,0,30,"[${sunX},0,${sunMinusZ}]","[-1,0,0]",1,"[0,0,0]",CLEAR,SAFE,-Z,${angleDeg}`;
  });
  const parsed = parseDilData([DIL_TEMPLATE_FIELDS.join(","), ...rows].join("\n"), "universal-minus-z.csv");
  assert.equal(parsed.referencePanelAxis, "-Z");
  assert.equal(parsed.referenceAxisSource, "EXPLICIT_COLUMN");
  assert.equal(parsed.powerSemantics, "PERCENT_MAX");
  assert.equal(parsed.records[0].referencePanelIncidenceDeg, 0);
  assert.match(parsed.warnings.join(" "), /reference axis -Z/i);
});

test("keeps signed negative-axis legacy incidence columns backward compatible", () => {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const angleDeg = index * 7;
    const sunX = Math.sin(angleDeg * Math.PI / 180);
    const sunMinusZ = -Math.cos(angleDeg * Math.PI / 180);
    const factor = Math.max(0, Math.cos(angleDeg * Math.PI / 180)) * 100;
    return `${index * 10},"[6928.137,${index},0]",${factor},SUNLIT,0,30,"[${sunX},0,${sunMinusZ}]","[-1,0,0]",1,"[0,0,0]",CLEAR,SAFE,${angleDeg}`;
  });
  const header = `${DIL_REQUIRED_FIELDS.join(",")},sun_-Z_panels`;
  const parsed = parseDilData([header, ...rows].join("\n"), "legacy-minus-z.csv");
  assert.equal(parsed.referencePanelAxis, "-Z");
  assert.equal(parsed.referenceAxisSource, "LEGACY_COLUMN");
  assert.equal(parsed.powerSemantics, "PERCENT_MAX");
});

test("uses an explicit reference angle for its declared axis and flags conflicting SUN_BODY geometry", () => {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const angleDeg = index * 7;
    const factor = Math.max(0, Math.cos(angleDeg * Math.PI / 180)) * 100;
    return `${index * 10},"[6928.137,${index},0]",${factor},SUNLIT,0,30,"[0,1,0]","[-1,0,0]",1,"[0,0,0]",CLEAR,SAFE,-Z,${angleDeg}`;
  });
  const parsed = parseDilData([DIL_TEMPLATE_FIELDS.join(","), ...rows].join("\n"), "conflicting-minus-z.csv");
  assert.equal(parsed.referencePanelAxis, "-Z");
  assert.ok(parsed.referenceVectorMaeDeg > 40);
  assert.equal(parsed.referenceVectorMismatchPct, 100);
  assert.match(parsed.warnings.join(" "), /conflicts with SUN_BODY/i);
  const minusZMission = { ...mission, panelFacingAxis: "-Z" as const };
  const authoritativeReplay = buildDilSimulation(
    parsed.records,
    minusZMission,
    power,
    parsed.epochMs,
    parsed.powerSemantics,
    parsed.referencePanelAxis,
  );
  assert.ok(authoritativeReplay.every((point) => point.incidenceDeg < 90 && point.powerW > 0));
  authoritativeReplay.forEach((point) => assert.ok(Math.abs(point.powerW - (point.measuredPowerW ?? 0)) < 1e-5));
  const lockedSun = authoritativeReplay[0].sunVector;
  authoritativeReplay.forEach((point, index) => {
    const sunDelta = Math.hypot(
      point.sunVector[0] - lockedSun[0],
      point.sunVector[1] - lockedSun[1],
      point.sunVector[2] - lockedSun[2],
    );
    const renderedCosine = point.panelNormal[0] * lockedSun[0]
      + point.panelNormal[1] * lockedSun[1]
      + point.panelNormal[2] * lockedSun[2];
    const renderedIncidenceDeg = Math.acos(Math.max(-1, Math.min(1, renderedCosine))) * 180 / Math.PI;
    assert.ok(sunDelta < 1e-9, `sample ${index} must retain the inertial Sun lock`);
    assert.ok(Math.abs(renderedIncidenceDeg - point.incidenceDeg) < 1e-8, `sample ${index} visual and power incidence must agree`);
  });
  const vectorOnlyReplay = buildDilSimulation(parsed.records, minusZMission, power, parsed.epochMs, parsed.powerSemantics);
  assert.ok(vectorOnlyReplay.every((point) => point.powerW < 1e-9));
});

test("does not silently scale a 0–100 column that is unrelated to the declared incidence", () => {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const angleDeg = index * 7;
    const unrelatedValue = index % 2 === 0 ? 100 : 0;
    return `${index * 10},"[6928.137,${index},0]",${unrelatedValue},SUNLIT,0,30,"[0,1,0]","[-1,0,0]",1,"[0,0,0]",CLEAR,SAFE,-Z,${angleDeg}`;
  });
  const parsed = parseDilData([DIL_TEMPLATE_FIELDS.join(","), ...rows].join("\n"), "uncorrelated-factor.csv");
  assert.equal(parsed.powerSemantics, "WATTS");
  assert.match(parsed.warnings.join(" "), /bounded near 0–100/i);
  assert.match(parsed.warnings.join(" "), /interpreted as watts/i);
});

test("infers a signed reference axis from SUN_BODY when no panel-axis field exists", () => {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const angleDeg = index * 7;
    const sunX = Math.cos(angleDeg * Math.PI / 180);
    const sunY = Math.sin(angleDeg * Math.PI / 180);
    const factor = Math.max(0, sunX) * 100;
    return `${index * 10},"[6928.137,${index},0]",${factor},SUNLIT,0,30,"[${sunX},${sunY},0]","[-1,0,0]",1,"[0,0,0]",CLEAR,SAFE`;
  });
  const parsed = parseDilData([DIL_REQUIRED_FIELDS.join(","), ...rows].join("\n"), "axis-inferred.csv");
  assert.equal(parsed.referencePanelAxis, "+X");
  assert.equal(parsed.referenceAxisSource, "INFERRED");
  assert.equal(parsed.powerSemantics, "PERCENT_MAX");
  assert.match(parsed.warnings.join(" "), /inferred from SUN_BODY/i);
});

test("parses the DIL DD-MM-YYYY AM/PM format as an exact two-day span", () => {
  const parsed = parseDilData(calendarCsv([
    "01-01-2028  05:30:00 AM",
    "02-01-2028  05:30:00 AM",
    "03-01-2028  05:30:00 AM",
  ]), "two-days.csv");
  assert.equal(parsed.records[1].timeSec, 86400);
  assert.equal(parsed.records[2].timeSec, 172800);
  assert.equal(parsed.epochMs, Date.UTC(2028, 0, 1, 5, 30));
  assert.match(parsed.warnings.join(" "), /DD-MM-YYYY/i);
});

test("parses the new minute-only DMY format and expands repeated samples", () => {
  const parsed = parseDilData(calendarCsv([
    "01-01-2028 05:30",
    "01-01-2028 05:30",
    "01-01-2028 05:31",
  ]), "new-format.csv");
  assert.equal(parsed.records[0].timeSec, 0);
  assert.equal(parsed.records[1].timeSec, 30);
  assert.equal(parsed.records[2].timeSec, 60);
  assert.match(parsed.warnings.join(" "), /24-hour/i);
  assert.match(parsed.warnings.join(" "), /sub-minute/i);
});

test("applies a user-specified cadence to minute-only DIL timestamps", () => {
  const parsed = parseDilData(calendarCsv([
    "01-01-2028 05:30",
    "01-01-2028 05:30",
    "01-01-2028 05:31",
    "01-01-2028 05:32",
  ]), "50-second-data.csv", { sampleIntervalSec: 50 });
  assert.deepEqual(parsed.records.map((record) => record.timeSec), [0, 50, 100, 150]);
  assert.match(parsed.warnings.join(" "), /specified 50 s sample interval/i);
});

test("rejects an invalid manual DIL sample interval", () => {
  assert.throws(
    () => parseDilData(calendarCsv(["01-01-2028 05:30"]), "bad-interval.csv", { sampleIntervalSec: 0 }),
    /positive number of seconds/i,
  );
});

test("rejects month-first AM/PM dates instead of silently creating the wrong span", () => {
  assert.throws(() => parseDilData(calendarCsv([
    "01-13-2028 05:30:00 AM",
    "01-14-2028 05:30:00 AM",
  ]), "wrong-order.csv"), /DD-MM-YYYY/i);
});

test("rejects a DIL file with missing required fields", () => {
  assert.throws(() => parseDilData("TIME,SATELLITE_POSITION\n0,1", "bad.csv"), /Missing required DIL fields/i);
});

test("builds attitude-constrained replay power and preserves measured telemetry", () => {
  const parsed = parseDilData(csv, "actual.csv");
  const points = buildDilSimulation(
    parsed.records,
    mission,
    power,
    parsed.epochMs,
    parsed.powerSemantics,
    parsed.referencePanelAxis,
    mission.nadirBodyAxis,
    {
      [dilOperationLoadKey("NOMINAL", "SUNLIT")]: 300,
      [dilOperationLoadKey("PAYLOAD", "ECLIPSE")]: 300,
    },
  );
  assert.equal(points.length, 2);
  assert.deepEqual(points[0].panelNormalBody, [0, 1, 0]);
  assert.ok(Math.abs(points[0].incidenceDeg) < 1e-9);
  assert.ok(points[0].powerW > 18 && points[0].powerW < 21);
  assert.equal(points[0].measuredPowerW, 200);
  assert.ok(Math.abs((points[0].perfectPointingPowerW ?? 0) - points[0].powerW) < 1e-9);
  assert.equal(points[1].shadowFactor, 0);
  assert.equal(points[1].powerW, 0);
  assert.equal(points[1].measuredPowerW, 50);
  assert.ok(points[1].socPct < points[0].socPct);
  assert.equal(points[1].operationLoadW, 300);
  assert.equal(points[1].netPowerW, -250);
});

test("resolves numeric payload Earth and Sun angles into the rendered payload boresight", () => {
  const payloadCsv = `${DIL_REQUIRED_FIELDS.join(",")}
0,"[6928.137,0,0]",100,IMAGING_STRIP,0,0,"[1,0,0]","[0,0,-1]",SUNLIT,"[0,0,0]",0,90
10,"[6928,75,0]",100,GSPOINTING_A,0,0,"[1,0,0]","[0,0,-1]",SUNLIT,"[0,0,0]",90,0`;
  const parsed = parseDilData(payloadCsv, "payload-angles.csv");
  assert.equal(parsed.records[0].payloadEarthAngleDeg, 0);
  assert.equal(parsed.records[0].payloadSunAngleDeg, 90);
  const replay = buildDilSimulation(
    parsed.records,
    mission,
    power,
    parsed.epochMs,
    parsed.powerSemantics,
    parsed.referencePanelAxis,
    "-Z",
  );
  assert.ok(Math.abs(replay[0].payloadEarthAngleDeg ?? 999) < 1e-8);
  assert.ok(Math.abs((replay[0].payloadSunAngleDeg ?? 0) - 90) < 1e-8);
  assert.ok(Math.abs((replay[1].payloadEarthAngleDeg ?? 0) - 90) < 1e-8);
  assert.ok(Math.abs(replay[1].payloadSunAngleDeg ?? 999) < 1e-8);
  replay.forEach((point) => {
    const norm = Math.hypot(...point.payloadBoresightBody);
    assert.ok(Math.abs(norm - 1) < 1e-9);
    assert.ok((point.payloadPointingResidualDeg ?? 999) < 1e-8);
  });
});

test("integrates dense DIL modeled, measured and perfect-pointing energy by operation", () => {
  const parsed = parseDilData(csv, "actual.csv");
  const analysis = analyzeDilEnergy(parsed.energySeries, mission, power, parsed.epochMs);
  const replay = buildDilSimulation(parsed.records, mission, power, parsed.epochMs);
  assert.equal(analysis.durationSec, 60);
  assert.ok(Math.abs(analysis.measuredEnergyWh - 2.0833333333) < 1e-6);
  assert.ok(Math.abs(analysis.modeledEnergyWh - replay[0].powerW * 30 / 3600) < 1e-6);
  assert.ok(Math.abs(analysis.perfectPointingEnergyWh - analysis.modeledEnergyWh) < 1e-9);
  assert.ok(Math.abs(analysis.modeledCapturePct - 100) < 1e-9);
  assert.equal(analysis.operationTransitions, 1);
  assert.equal(analysis.operations.length, 4);
  assert.equal(analysis.operations.filter((operation) => operation.durationSec > 0).length, 2);
  assert.ok(Math.abs(analysis.operations.reduce((sum, operation) => sum + operation.measuredEnergyWh, 0) - analysis.measuredEnergyWh) < 1e-9);
  assert.ok(Math.abs(analysis.operations.reduce((sum, operation) => sum + operation.modeledEnergyWh, 0) - analysis.modeledEnergyWh) < 1e-9);
});

test("calculates conservative DIL load energy and OAP from per-operation maximum loads", () => {
  const parsed = parseDilData(csv, "actual.csv");
  const analysis = analyzeDilEnergy(parsed.energySeries, mission, power, parsed.epochMs);
  const incomplete = analyzeDilOperationLoads(analysis, {
    [dilOperationLoadKey("NOMINAL", "SUNLIT")]: 100,
  });
  assert.equal(incomplete.complete, false);
  assert.deepEqual(incomplete.missingOperations, ["PAYLOAD · ECLIPSE"]);
  assert.equal(incomplete.loadEnergyWh, undefined);

  const complete = analyzeDilOperationLoads(analysis, {
    [dilOperationLoadKey("NOMINAL", "SUNLIT")]: 100,
    [dilOperationLoadKey("PAYLOAD", "ECLIPSE")]: 300,
  });
  assert.equal(complete.complete, true);
  assert.ok(Math.abs((complete.loadEnergyWh ?? 0) - 3.3333333333) < 1e-6);
  assert.ok(Math.abs((complete.worstCaseAverageLoadW ?? 0) - 200) < 1e-9);
  assert.ok(Math.abs((complete.netEnergyWh ?? 0) + 1.25) < 1e-6);
});

test("splits each DIL operation into sunlit and eclipse load states", () => {
  const splitCsv = `${DIL_REQUIRED_FIELDS.join(",")}
0,"[6928.137,0,0]",100,NOMINAL,0,0,"[0,1,0]","[-1,0,0]",SUNLIT,"[0,0,0]",CLEAR,SAFE
10,"[6928,75,0]",100,NOMINAL,0,0,"[0,1,0]","[-1,0,0]",PENUMBRA,"[0,0,0]",CLEAR,SAFE
20,"[6927,150,0]",100,NOMINAL,0,0,"[0,1,0]","[-1,0,0]",ECLIPSE,"[0,0,0]",CLEAR,SAFE
30,"[6925,225,0]",100,NOMINAL,0,0,"[0,1,0]","[-1,0,0]",SUNLIT,"[0,0,0]",CLEAR,SAFE`;
  const parsed = parseDilData(splitCsv, "split-illumination.csv");
  const analysis = analyzeDilEnergy(parsed.energySeries, mission, power, parsed.epochMs, parsed.powerSemantics);
  const sunlit = analysis.operations.find((operation) => operation.illumination === "SUNLIT");
  const eclipse = analysis.operations.find((operation) => operation.illumination === "ECLIPSE");

  assert.equal(analysis.operations.length, 2);
  assert.equal(sunlit?.durationSec, 10);
  assert.equal(eclipse?.durationSec, 20);
  assert.equal(dilLoadIlluminationState(1), "SUNLIT");
  assert.equal(dilLoadIlluminationState(0.5), "ECLIPSE");
  assert.equal(dilLoadIlluminationState(0), "ECLIPSE");
  assert.ok(Math.abs((sunlit?.measuredEnergyWh ?? 0) - 100 * 10 / 3600) < 1e-9);
  assert.ok(Math.abs((eclipse?.measuredEnergyWh ?? 0) - 100 * 20 / 3600) < 1e-9);

  const loads = {
    [dilOperationLoadKey("NOMINAL", "SUNLIT")]: 100,
    [dilOperationLoadKey("NOMINAL", "ECLIPSE")]: 300,
  };
  const loadAnalysis = analyzeDilOperationLoads(analysis, loads);
  assert.equal(loadAnalysis.complete, true);
  assert.ok(Math.abs((loadAnalysis.loadEnergyWh ?? 0) - (100 * 10 + 300 * 20) / 3600) < 1e-9);
  assert.ok(Math.abs((loadAnalysis.worstCaseAverageLoadW ?? 0) - 7000 / 30) < 1e-9);

  const replay = buildDilSimulation(
    parsed.records,
    mission,
    power,
    parsed.epochMs,
    parsed.powerSemantics,
    parsed.referencePanelAxis,
    mission.nadirBodyAxis,
    loads,
  );
  assert.deepEqual(replay.map((point) => point.operationLoadW), [100, 300, 300, 100]);
  assert.ok(Math.abs(replay[3].socPct - (50 - 4000 / 3600) / power.batteryWh * 100) < 1e-9);
});

test("DIL battery uses imported generation and operation loads instead of orbit-average load", () => {
  const parsed = parseDilData(csv, "actual.csv");
  const highDefaultLoad = { ...power, averageLoadW: 10_000 };
  const replay = buildDilSimulation(
    parsed.records,
    mission,
    highDefaultLoad,
    parsed.epochMs,
    parsed.powerSemantics,
    parsed.referencePanelAxis,
    mission.nadirBodyAxis,
    {
      [dilOperationLoadKey("NOMINAL", "SUNLIT")]: 0,
      [dilOperationLoadKey("PAYLOAD", "ECLIPSE")]: 0,
    },
  );
  assert.ok(replay[1].socPct > replay[0].socPct);
});

test("detects a cosine-like 0–100 DIL factor and converts it to equivalent array watts", () => {
  const header = csv.split("\n")[0];
  const rows = Array.from({ length: 12 }, (_, index) => {
    const angleDeg = index * 7;
    const generationFactor = Math.max(0, Math.cos(angleDeg * Math.PI / 180)) * 100;
    const sunX = Math.sin(angleDeg * Math.PI / 180);
    const sunY = Math.cos(angleDeg * Math.PI / 180);
    return `${index * 10},"[6928.137,${index},0]",${generationFactor},SUNLIT,0,30,"[${sunX},${sunY},0]","[-1,0,0]",1,"[0,0,0]",CLEAR,SAFE,${angleDeg}`;
  });
  const parsed = parseDilData([header, ...rows].join("\n"), "factor.csv");
  assert.equal(parsed.powerSemantics, "PERCENT_MAX");
  assert.match(parsed.warnings.join(" "), /0–100 generation factor/i);
  const replay = buildDilSimulation(parsed.records, mission, power, parsed.epochMs, parsed.powerSemantics);
  assert.equal(replay[0].incidenceDeg, 0);
  assert.ok(replay[0].powerW > 18);
  replay.forEach((point) => assert.ok(Math.abs(point.powerW - (point.measuredPowerW ?? 0)) < 1e-5));
  const analysis = analyzeDilEnergy(parsed.energySeries, mission, power, parsed.epochMs, parsed.powerSemantics);
  assert.ok(Math.abs(analysis.measuredToModeledPct - 100) < 0.01);
  assert.equal(analysis.recordedIncidencePct, 100);
  const oppositeMission = { ...mission, panelFacingAxis: "-Y" as const };
  const oppositeReplay = buildDilSimulation(parsed.records, oppositeMission, power, parsed.epochMs, parsed.powerSemantics);
  assert.ok(oppositeReplay.every((point) => point.powerW < 1e-9));
  assert.ok(oppositeReplay.some((point) => (point.measuredPowerW ?? 0) > 0));
  const sweep = analyzeDilAxisSweep(parsed.energySeries, mission, power, parsed.epochMs);
  const plusY = sweep.find((axis) => axis.axis === "+Y");
  const minusY = sweep.find((axis) => axis.axis === "-Y");
  assert.ok((plusY?.energyWh ?? 0) > 0);
  assert.ok((plusY?.energyWh ?? 0) > (minusY?.energyWh ?? 0));
  assert.equal(minusY?.energyWh, 0);
  assert.deepEqual([...sweep.map((axis) => axis.rank)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
});

test("scales a 100% DIL factor to corrected net EOL power, including pointing loss", () => {
  const header = csv.split("\n")[0];
  const rows = Array.from({ length: 12 }, (_, index) => {
    const angleDeg = index * 7;
    const generationFactor = Math.max(0, Math.cos(angleDeg * Math.PI / 180)) * 100;
    const sunX = Math.sin(angleDeg * Math.PI / 180);
    const sunY = Math.cos(angleDeg * Math.PI / 180);
    return `${index * 10},"[6928.137,${index},0]",${generationFactor},SUNLIT,0,30,"[${sunX},${sunY},0]","[-1,0,0]",1,"[0,0,0]",CLEAR,SAFE,${angleDeg}`;
  });
  const parsed = parseDilData([header, ...rows].join("\n"), "factor-with-pointing-loss.csv");
  const powerWithPointingLoss = { ...power, pointingErrorDeg: 20 };
  const replay = buildDilSimulation(
    parsed.records,
    mission,
    powerWithPointingLoss,
    parsed.epochMs,
    parsed.powerSemantics,
  );
  const rawEolPowerW = powerWithPointingLoss.eolVmpV
    * powerWithPointingLoss.eolImpA
    * powerWithPointingLoss.seriesCells
    * powerWithPointingLoss.parallelStrings;
  const correctedNetEolPowerW = rawEolPowerW * arrayPowerCorrectionFactors(
    powerWithPointingLoss,
    new Date(mission.epoch),
    0,
    1,
  ).totalRetention;

  assert.equal(parsed.powerSemantics, "PERCENT_MAX");
  assert.ok(Math.abs((replay[0].measuredPowerW ?? 0) - correctedNetEolPowerW) < 1e-5);
  assert.ok((replay[0].measuredPowerW ?? 0) < (replay[0].perfectPointingPowerW ?? 0));

  const analysis = analyzeDilEnergy(
    parsed.energySeries,
    mission,
    powerWithPointingLoss,
    parsed.epochMs,
    parsed.powerSemantics,
  );
  assert.ok(Math.abs(analysis.peakMeasuredPowerW - correctedNetEolPowerW) < 1e-5);
});

test("uses the DIL satellite position directly and auto-detects metres", () => {
  const source = parseDilData(csv, "actual.csv").records[0];
  const point = buildDilSimulation([{
    ...source,
    satellitePositionKm: [0, 6_928_137, 0],
    earthBody: [-1, 0, 0],
    attitudeRpyDeg: [0, 0, 0],
  }], mission, power)[0];
  assert.ok(Math.abs(point.positionKm[0]) < 1e-9);
  assert.ok(Math.abs(point.positionKm[1] - 6928.137) < 1e-6);
  assert.ok(Math.abs(point.positionKm[2]) < 1e-9);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  BODY_AXES,
  DEFAULT_EO_SATELLITES,
  activeArrayAreaM2,
  arrayConfigurationLabel,
  cloneInventory,
  isSatelliteInventoryItem,
  mergeSatelliteInventory,
  readSatelliteInventoryPayload,
} from "../app/lib/satellite-inventory";

test("trial inventory supplies three distinct EO platform classes", () => {
  assert.equal(DEFAULT_EO_SATELLITES.length, 3);
  assert.deepEqual(
    DEFAULT_EO_SATELLITES.map((item) => item.className),
    ["CubeSat", "Microsatellite", "Small satellite"],
  );
  assert.equal(new Set(DEFAULT_EO_SATELLITES.map((item) => item.id)).size, 3);
});

test("every trial spacecraft carries simulator-ready frame, array, and solar power data", () => {
  for (const item of DEFAULT_EO_SATELLITES) {
    assert.equal(isSatelliteInventoryItem(item), true);
    assert.ok(BODY_AXES.includes(item.frames.velocityAxis));
    assert.ok(BODY_AXES.includes(item.frames.nadirAxis));
    assert.ok(BODY_AXES.includes(item.frames.solarCellNormalAxis));
    assert.ok(item.missionDefaults.attitudeMode.length > 0);
    assert.equal(item.missionDefaults.altitudeKm, undefined);
    assert.equal(item.missionDefaults.inclinationDeg, undefined);
    assert.equal(item.missionDefaults.ltan, undefined);
    assert.ok((item.powerDefaults.fluenceE14Cm2 ?? -1) >= 0);
    assert.ok((item.powerDefaults.referenceIrradianceWm2 ?? 0) > 1000);
    assert.ok((item.powerDefaults.mpptEfficiency ?? 0) > 0);
    assert.ok((item.powerDefaults.harnessEfficiency ?? 0) > 0);
    assert.equal(item.powerDefaults.averageLoadW, undefined);
    assert.equal(item.powerDefaults.batteryWh, undefined);
    assert.ok(activeArrayAreaM2(item) > 0);
    assert.match(arrayConfigurationLabel(item), /^\d+S × \d+P$/);
  }
});

test("cloneInventory returns deep editable copies without mutating supplied trials", () => {
  const clone = cloneInventory();
  clone[0].name = "Changed locally";
  clone[0].geometry.dimensionsM.x = 99;
  assert.notEqual(clone[0].name, DEFAULT_EO_SATELLITES[0].name);
  assert.notEqual(clone[0].geometry.dimensionsM.x, DEFAULT_EO_SATELLITES[0].geometry.dimensionsM.x);
});

test("active area includes wing count and packaging efficiency", () => {
  const item = cloneInventory([DEFAULT_EO_SATELLITES[1]])[0];
  item.array.wingLayout = "dual";
  item.array.panelLengthM = 2;
  item.array.panelWidthM = 1;
  item.array.packagingEfficiency = 0.8;
  assert.equal(activeArrayAreaM2(item), 3.2);
});

test("reads the exported inventory envelope and preserves edited values", () => {
  const exported = cloneInventory();
  exported[1].geometry.massKg = 157.5;
  const result = readSatelliteInventoryPayload({
    schema: "orbit-pwr-satellite-inventory/v1",
    satellites: exported,
  });
  assert.equal(result.items.length, 3);
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.items[1].geometry.massKg, 157.5);
});

test("inventory import updates matching IDs and appends new spacecraft", () => {
  const current = cloneInventory();
  const edited = cloneInventory([current[1]])[0];
  edited.array.panelWidthM += 0.2;
  const added = cloneInventory([current[0]])[0];
  added.id = "custom-imported-eo";
  added.name = "Imported EO concept";
  added.status = "custom";
  const result = mergeSatelliteInventory(current, [edited, added]);
  assert.deepEqual(result.updatedIds, [edited.id]);
  assert.deepEqual(result.addedIds, [added.id]);
  assert.equal(result.inventory.find((item) => item.id === edited.id)?.array.panelWidthM, edited.array.panelWidthM);
  assert.equal(result.inventory.at(-1)?.id, added.id);
});

test("inventory import counts invalid records while accepting valid ones", () => {
  const valid = cloneInventory([DEFAULT_EO_SATELLITES[0]])[0];
  const result = readSatelliteInventoryPayload({ satellites: [valid, { id: "broken" }] });
  assert.equal(result.items.length, 1);
  assert.equal(result.rejectedCount, 1);
});

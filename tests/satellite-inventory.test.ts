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
import { createCustomSatelliteDraft, mountedPartCenter } from "../app/lib/satellite-parts";
import { buildInventorySatelliteModel, disposeThreeTree, operationBeamSourceBody } from "../app/lib/satellite-three";

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

test("custom arrays preserve a selectable fold direction", () => {
  const draft = createCustomSatelliteDraft();
  assert.equal(draft.array.foldDirection, "lateral");
  draft.array.foldDirection = "longitudinal";
  const result = readSatelliteInventoryPayload({ satellites: [draft] });
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.items[0].array.foldDirection, "longitudinal");

  const invalid = structuredClone(draft) as unknown as { array: { foldDirection: string } };
  invalid.array.foldDirection = "diagonal";
  assert.equal(isSatelliteInventoryItem(invalid), false);
});

test("lateral deployment uses a nested zig-zag hinge chain instead of sliding panels", () => {
  const draft = createCustomSatelliteDraft();
  draft.array.wingLayout = "dual";
  draft.array.panelsPerWing = 3;
  draft.array.foldDirection = "lateral";
  const stowedModel = buildInventorySatelliteModel(draft, 0, false);
  const deployedModel = buildInventorySatelliteModel(draft, 1, false);

  for (const sign of [-1, 1]) {
    const stowedLinks = [1, 2, 3].map((index) => stowedModel.getObjectByName(`solar-panel-link-${sign}-${index}`));
    const deployedLinks = [1, 2, 3].map((index) => deployedModel.getObjectByName(`solar-panel-link-${sign}-${index}`));
    assert.ok(stowedLinks.every(Boolean));
    assert.ok(deployedLinks.every(Boolean));
    assert.equal(stowedLinks[1]!.parent, stowedLinks[0]);
    assert.equal(stowedLinks[2]!.parent, stowedLinks[1]);
    assert.ok(Math.abs(Math.abs(stowedLinks[1]!.rotation.y) - Math.PI) < 1e-9);
    assert.ok(Math.abs(Math.abs(stowedLinks[2]!.rotation.y) - Math.PI) < 1e-9);
    assert.equal(Math.abs(deployedLinks[1]!.rotation.y), 0);
    assert.equal(Math.abs(deployedLinks[2]!.rotation.y), 0);
    assert.equal(stowedModel.getObjectByName(`solar-panel-hinge-${sign}-1`)?.parent, stowedLinks[1]);
    assert.equal(stowedModel.getObjectByName(`solar-panel-hinge-${sign}-2`)?.parent, stowedLinks[2]);
    assert.deepEqual(stowedLinks.slice(1).map((link) => link!.position.toArray()), deployedLinks.slice(1).map((link) => link!.position.toArray()));
  }

  disposeThreeTree(stowedModel);
  disposeThreeTree(deployedModel);
});

test("operation beams originate from their assigned rigid spacecraft components", () => {
  const item = cloneInventory([DEFAULT_EO_SATELLITES[2]])[0];
  const xBand = item.subsystems.find((subsystem) => subsystem.kind === "radio")!;
  xBand.faceOffsetM = { u: 0.17, v: -0.11, normal: 0.04 };
  const sBand = structuredClone(xBand);
  sBand.id = "test-s-band";
  sBand.name = "S-band patch";
  sBand.catalogPartId = "radio-sband-patch";
  sBand.faceOffsetM = { u: -0.21, v: 0.08, normal: 0 };
  item.subsystems.unshift(sBand);

  const expectedRadioCenter = mountedPartCenter(item, xBand);
  assert.deepEqual(operationBeamSourceBody(item, "GEOPOINTING"), [
    expectedRadioCenter.x,
    expectedRadioCenter.y,
    expectedRadioCenter.z,
  ]);

  const payload = item.subsystems.find((subsystem) => subsystem.kind === "payload")!;
  payload.catalogPartId = "payload-ms8";
  payload.faceOffsetM = { u: 0.12, v: 0.09, normal: 0.03 };
  const expectedPayloadCenter = mountedPartCenter(item, payload);
  assert.deepEqual(operationBeamSourceBody(item, "IMAGING"), [
    expectedPayloadCenter.x,
    expectedPayloadCenter.y,
    expectedPayloadCenter.z,
  ]);
});

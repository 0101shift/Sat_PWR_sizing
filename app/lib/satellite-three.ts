import * as THREE from "three";
import type { BodyAxis, SatelliteInventoryItem } from "./satellite-inventory";
import { mountedFacePoint, mountedPartCenter } from "./satellite-parts";

export function bodyAxisVector(axis: BodyAxis) {
  const sign = axis.startsWith("-") ? -1 : 1;
  if (axis.endsWith("X")) return new THREE.Vector3(sign, 0, 0);
  if (axis.endsWith("Y")) return new THREE.Vector3(0, sign, 0);
  return new THREE.Vector3(0, 0, sign);
}

export type OperationBeamSource = "IMAGING" | "GEOPOINTING";

function vectorTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

/**
 * Returns the rigid body-frame location of the component that emits an
 * operation visual. Imaging originates at the optical payload; ground-station
 * pointing prefers an installed X-band/Ka-band dish and otherwise uses the
 * first attached radio. The returned point intentionally follows the complete
 * spacecraft attitude instead of articulating an individual subsystem.
 */
export function operationBeamSourceBody(
  item: SatelliteInventoryItem,
  source: OperationBeamSource,
): [number, number, number] {
  const configured = item.subsystems ?? [];
  const attached = configured.filter((subsystem) => subsystem.attached);
  const customAssembly = attached.some((subsystem) => Boolean(subsystem.catalogPartId));
  const payloadAttached = configured.length === 0 || attached.some((subsystem) => subsystem.kind === "payload");
  if (source === "IMAGING" && !customAssembly && payloadAttached) {
    const boresight = bodyAxisVector(item.frames.payloadBoresightAxis);
    const projection = item.geometry.dimensionsM.z / 2 + Math.max(item.geometry.dimensionsM.z * 0.18, 0.06);
    return vectorTuple(boresight.multiplyScalar(projection));
  }

  const candidates = attached.filter((subsystem) => subsystem.kind === (source === "IMAGING" ? "payload" : "radio"));
  const selected = source === "GEOPOINTING"
    ? candidates.find((subsystem) => /(?:^|[^a-z])(?:x|ka)[-\s/]?band|xband/i.test(`${subsystem.name} ${subsystem.catalogPartId ?? ""}`)) ?? candidates[0]
    : candidates[0];
  if (!selected) return [0, 0, 0];

  const center = mountedPartCenter(item, selected);
  return [center.x, center.y, center.z];
}

export function inventorySatelliteModelSpanM(
  item: SatelliteInventoryItem,
  wingLayout: SatelliteInventoryItem["array"]["wingLayout"] = item.array.wingLayout,
) {
  return item.array.panelLengthM * (wingLayout === "dual" ? 2 : 1)
    + Math.max(...Object.values(item.geometry.dimensionsM));
}

export function disposeThreeTree(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

export function setModelPayloadBoresight(root: THREE.Object3D, targetBody: readonly [number, number, number]) {
  const target = new THREE.Vector3(...targetBody).normalize();
  if (target.lengthSq() < 0.5) return;
  root.traverse((object) => {
    const sourceValues = object.userData.payloadBoresightBody as number[] | undefined;
    const baseValues = object.userData.payloadBaseQuaternion as number[] | undefined;
    if (!sourceValues || sourceValues.length !== 3 || !baseValues || baseValues.length !== 4) return;
    const source = new THREE.Vector3(sourceValues[0], sourceValues[1], sourceValues[2]).normalize();
    const base = new THREE.Quaternion(baseValues[0], baseValues[1], baseValues[2], baseValues[3]);
    const correction = new THREE.Quaternion().setFromUnitVectors(source, target);
    object.quaternion.copy(correction.multiply(base));
  });
}

function markPayloadMount(group: THREE.Group, boresightBody: THREE.Vector3) {
  group.userData.payloadBoresightBody = boresightBody.toArray();
  group.userData.payloadBaseQuaternion = group.quaternion.toArray();
}

function addPanelGrid(panel: THREE.Mesh, width: number, height: number) {
  const gridMaterial = new THREE.LineBasicMaterial({ color: 0x62a7c8, transparent: true, opacity: 0.55 });
  const points: THREE.Vector3[] = [];
  for (let index = 1; index < 4; index += 1) {
    const x = -width / 2 + (index * width) / 4;
    points.push(new THREE.Vector3(x, -height / 2, 0.031), new THREE.Vector3(x, height / 2, 0.031));
  }
  for (let index = 1; index < 4; index += 1) {
    const y = -height / 2 + (index * height) / 4;
    points.push(new THREE.Vector3(-width / 2, y, 0.031), new THREE.Vector3(width / 2, y, 0.031));
  }
  panel.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), gridMaterial));
}

export function buildInventorySatelliteModel(
  item: SatelliteInventoryItem,
  deployment: number,
  showAxes: boolean,
  options?: { solarNormalBody?: readonly [number, number, number] },
) {
  const root = new THREE.Group();
  root.name = "spacecraft";
  const { x, y, z } = item.geometry.dimensionsM;
  const longestBusSide = Math.max(x, y, z);
  const busMaterial = new THREE.MeshStandardMaterial({ color: 0xb8c4c4, metalness: 0.7, roughness: 0.28 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x172329, metalness: 0.55, roughness: 0.38 });
  const goldMaterial = new THREE.MeshStandardMaterial({ color: 0xa4772a, metalness: 0.55, roughness: 0.42 });
  const bus = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), busMaterial);
  bus.castShadow = true;
  bus.receiveShadow = true;
  root.add(bus);
  const configuredSubsystems = item.subsystems ?? [];
  const modularAssembly = configuredSubsystems.length > 0;
  const customAssembly = configuredSubsystems.some((subsystem) => Boolean(subsystem.catalogPartId));
  const payloadAttached = !modularAssembly || configuredSubsystems.some((subsystem) => subsystem.kind === "payload" && subsystem.attached);
  const solarArrayAttached = !modularAssembly || configuredSubsystems.some((subsystem) => subsystem.kind === "solar_array" && subsystem.attached);
  const solarSubsystem = configuredSubsystems.find((subsystem) => subsystem.kind === "solar_array" && subsystem.attached);

  const equipmentScale = Math.max(longestBusSide * 0.035, 0.025);
  const cornerPositions = [
    [-x * 0.34, y * 0.51, -z * 0.28],
    [x * 0.34, y * 0.51, -z * 0.28],
    [-x * 0.34, y * 0.51, z * 0.28],
    [x * 0.34, y * 0.51, z * 0.28],
  ];
  cornerPositions.forEach(([px, py, pz]) => {
    const unit = new THREE.Mesh(
      new THREE.BoxGeometry(equipmentScale * 2.4, equipmentScale, equipmentScale * 2.4),
      darkMaterial,
    );
    unit.position.set(px, py, pz);
    root.add(unit);
  });

  if (payloadAttached && !customAssembly) {
    const payloadMount = new THREE.Group();
    payloadMount.name = "payload-mount";
    const configuredBoresight = bodyAxisVector(item.frames.payloadBoresightAxis);
    payloadMount.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), configuredBoresight);
    const apertureRadius = Math.min(item.geometry.payloadApertureM / 2, x * 0.34, y * 0.34);
    const payload = new THREE.Mesh(
      new THREE.CylinderGeometry(apertureRadius, apertureRadius * 1.22, Math.max(z * 0.18, 0.06), 32),
      darkMaterial,
    );
    payload.rotation.x = Math.PI / 2;
    payload.position.z = -z / 2 - Math.max(z * 0.09, 0.03);
    payloadMount.add(payload);
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(apertureRadius * 0.8, 32),
      new THREE.MeshStandardMaterial({ color: 0x275c78, metalness: 0.15, roughness: 0.12 }),
    );
    lens.position.z = -z / 2 - Math.max(z * 0.18, 0.06) - 0.002;
    lens.rotation.y = Math.PI;
    payloadMount.add(lens);
    markPayloadMount(payloadMount, configuredBoresight);
    root.add(payloadMount);
  }

  if (item.className !== "CubeSat") {
    const radiator = new THREE.Mesh(new THREE.BoxGeometry(x * 0.58, 0.012, z * 0.48), goldMaterial);
    radiator.position.y = -y / 2 - 0.008;
    root.add(radiator);
  }

  const arrayMount = new THREE.Group();
  arrayMount.name = "solar-array-mount";
  const solarNormalBody = options?.solarNormalBody
    ? new THREE.Vector3(...options.solarNormalBody).normalize()
    : bodyAxisVector(solarSubsystem?.functionalAxis ?? item.frames.solarCellNormalAxis);
  let deployedDirectionBody = bodyAxisVector(item.array.deploymentAxis);
  deployedDirectionBody = deployedDirectionBody
    .sub(solarNormalBody.clone().multiplyScalar(deployedDirectionBody.dot(solarNormalBody)))
    .normalize();
  if (deployedDirectionBody.lengthSq() < 0.5) {
    const fallback = Math.abs(solarNormalBody.x) < 0.8 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    deployedDirectionBody = fallback.sub(solarNormalBody.clone().multiplyScalar(fallback.dot(solarNormalBody))).normalize();
  }
  const panelWidthDirectionBody = new THREE.Vector3().crossVectors(solarNormalBody, deployedDirectionBody).normalize();
  const basis = new THREE.Matrix4().makeBasis(deployedDirectionBody, panelWidthDirectionBody, solarNormalBody);
  arrayMount.quaternion.setFromRotationMatrix(basis);
  if (solarSubsystem) {
    const facePoint = mountedFacePoint(item, solarSubsystem);
    if (item.array.wingLayout === "dual") {
      const mountNormal = bodyAxisVector(solarSubsystem.mountAxis);
      const mountDepth = solarSubsystem.mountAxis.endsWith("X") ? x : solarSubsystem.mountAxis.endsWith("Y") ? y : z;
      arrayMount.position.set(facePoint.x, facePoint.y, facePoint.z);
      if (Math.abs(mountNormal.dot(deployedDirectionBody)) > 0.9) {
        arrayMount.position.sub(mountNormal.multiplyScalar(mountDepth / 2));
      }
    } else {
      arrayMount.position.set(facePoint.x, facePoint.y, facePoint.z);
    }
    if (!options?.solarNormalBody) {
      const rotation = solarSubsystem.rotationDeg ?? { x: 0, y: 0, z: 0 };
      const userRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(rotation.x),
        THREE.MathUtils.degToRad(rotation.y),
        THREE.MathUtils.degToRad(rotation.z),
      ));
      arrayMount.quaternion.premultiply(userRotation);
    }
  }
  const wingCount = item.array.wingLayout === "dual" ? 2 : 1;
  const panelCount = Math.max(1, Math.round(item.array.panelsPerWing));
  const foldDirection = panelCount > 2 ? item.array.foldDirection ?? "lateral" : "lateral";
  const panelGap = (foldDirection === "lateral" ? item.array.panelLengthM : item.array.panelWidthM) * 0.018;
  const segmentLength = foldDirection === "lateral"
    ? (item.array.panelLengthM - panelGap * (panelCount - 1)) / panelCount
    : item.array.panelLengthM;
  const segmentWidth = foldDirection === "longitudinal"
    ? (item.array.panelWidthM - panelGap * (panelCount - 1)) / panelCount
    : item.array.panelWidthM;
  const panelThickness = Math.max(longestBusSide * 0.018, 0.012);
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0x153f68,
    emissive: 0x061526,
    metalness: 0.48,
    roughness: 0.3,
    side: THREE.DoubleSide,
  });
  const signs = wingCount === 2 ? [-1, 1] : [1];
  const deploymentBusHalfExtent = Math.abs(deployedDirectionBody.x) * x / 2 + Math.abs(deployedDirectionBody.y) * y / 2 + Math.abs(deployedDirectionBody.z) * z / 2;
  signs.forEach((sign) => {
    const pivot = new THREE.Group();
    pivot.name = `solar-wing-pivot-${sign}`;
    pivot.position.x = wingCount === 2 ? sign * (deploymentBusHalfExtent + 0.015) : 0;
    pivot.rotation.y = sign * (1 - deployment) * THREE.MathUtils.degToRad(item.array.deployedAngleDeg);
    let previousLink: THREE.Group = pivot;
    for (let panelIndex = 0; panelIndex < panelCount; panelIndex += 1) {
      const link = new THREE.Group();
      link.name = `solar-panel-link-${sign}-${panelIndex + 1}`;
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(segmentLength, segmentWidth, panelThickness),
        panelMaterial,
      );
      panel.name = `solar-panel-${sign}-${panelIndex + 1}`;
      if (foldDirection === "lateral") {
        if (panelIndex > 0) {
          link.position.x = sign * (segmentLength + panelGap);
          link.rotation.y = (panelIndex % 2 === 1 ? -sign : sign) * (1 - deployment) * Math.PI;
        }
        panel.position.x = sign * segmentLength / 2;
      } else {
        link.position.y = panelIndex === 0 ? -item.array.panelWidthM / 2 : segmentWidth + panelGap;
        if (panelIndex > 0) {
          link.rotation.x = (panelIndex % 2 === 1 ? sign : -sign) * (1 - deployment) * Math.PI;
        }
        panel.position.x = sign * item.array.panelLengthM / 2;
        panel.position.y = segmentWidth / 2;
      }
      panel.castShadow = true;
      addPanelGrid(panel, segmentLength, segmentWidth);
      link.add(panel);
      if (panelIndex > 0) {
        const hingeLength = foldDirection === "lateral" ? segmentWidth * 0.9 : item.array.panelLengthM * 0.9;
        const hinge = new THREE.Mesh(
          new THREE.CylinderGeometry(panelThickness * 0.72, panelThickness * 0.72, hingeLength, 12),
          darkMaterial,
        );
        hinge.name = `solar-panel-hinge-${sign}-${panelIndex}`;
        if (foldDirection === "longitudinal") {
          hinge.rotation.z = Math.PI / 2;
          hinge.position.x = sign * item.array.panelLengthM / 2;
        }
        link.add(hinge);
      }
      previousLink.add(link);
      previousLink = link;
    }
    const boom = new THREE.Mesh(
      new THREE.CylinderGeometry(equipmentScale * 0.18, equipmentScale * 0.18, item.array.panelLengthM, 12),
      darkMaterial,
    );
    boom.rotation.z = Math.PI / 2;
    boom.position.x = sign * item.array.panelLengthM / 2 * deployment;
    boom.position.y = -item.array.panelWidthM * 0.54;
    boom.scale.y = Math.max(0.08, deployment);
    pivot.add(boom);
    arrayMount.add(pivot);
  });
  if (solarArrayAttached) root.add(arrayMount);

  const subsystemColors: Record<string, number> = {
    payload: 0x263a45,
    radio: 0x5a91ae,
    propulsion: 0x8b7360,
    power: 0xb98b44,
    attitude: 0x5d72a8,
    thermal: 0xa66b55,
    structure: 0x738187,
    custom: 0x6f8e7b,
  };
  configuredSubsystems
    .filter((subsystem) => subsystem.attached && subsystem.kind !== "solar_array" && (customAssembly || subsystem.kind !== "payload"))
    .forEach((subsystem) => {
      const normal = bodyAxisVector(subsystem.mountAxis);
      const center = mountedPartCenter(item, subsystem);
      const moduleGroup = new THREE.Group();
      moduleGroup.name = `subsystem-${subsystem.id}`;
      moduleGroup.position.set(center.x, center.y, center.z);
      const rotation = subsystem.rotationDeg ?? { x: 0, y: 0, z: 0 };
      moduleGroup.rotation.set(
        THREE.MathUtils.degToRad(rotation.x),
        THREE.MathUtils.degToRad(rotation.y),
        THREE.MathUtils.degToRad(rotation.z),
      );
      const moduleMaterial = new THREE.MeshStandardMaterial({
        color: subsystemColors[subsystem.kind] ?? 0x6f8e7b,
        metalness: 0.5,
        roughness: 0.36,
      });
      if (subsystem.kind === "radio") {
        const dishRadius = Math.max(subsystem.envelopeM.x, subsystem.envelopeM.y) / 2;
        const dish = new THREE.Mesh(
          new THREE.CylinderGeometry(dishRadius * 0.28, dishRadius, Math.max(subsystem.envelopeM.z * 0.28, 0.03), 28),
          moduleMaterial,
        );
        dish.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        moduleGroup.add(dish);
      } else if (subsystem.kind === "payload") {
        moduleGroup.name = `payload-mount-${subsystem.id}`;
        const radius = Math.max(Math.min(subsystem.envelopeM.x, subsystem.envelopeM.y) / 2, 0.02);
        const payload = new THREE.Mesh(
          new THREE.CylinderGeometry(radius * 0.82, radius, Math.max(subsystem.envelopeM.z, 0.04), 28),
          moduleMaterial,
        );
        payload.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        const lens = new THREE.Mesh(
          new THREE.CircleGeometry(radius * 0.7, 28),
          new THREE.MeshStandardMaterial({ color: 0x2b7899, metalness: 0.15, roughness: 0.12 }),
        );
        lens.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        lens.position.copy(normal).multiplyScalar(Math.max(subsystem.envelopeM.z, 0.04) / 2 + 0.002);
        moduleGroup.add(payload, lens);
      } else if (subsystem.kind === "propulsion") {
        const thruster = new THREE.Mesh(
          new THREE.ConeGeometry(Math.max(subsystem.envelopeM.y, subsystem.envelopeM.z) * 0.32, Math.max(subsystem.envelopeM.x, 0.08), 20, 1, true),
          moduleMaterial,
        );
        thruster.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        moduleGroup.add(thruster);
      } else {
        const equipmentModule = new THREE.Mesh(
          new THREE.BoxGeometry(subsystem.envelopeM.x, subsystem.envelopeM.y, subsystem.envelopeM.z),
          moduleMaterial,
        );
        moduleGroup.add(equipmentModule);
      }
      if (subsystem.kind === "payload") {
        markPayloadMount(moduleGroup, bodyAxisVector(subsystem.functionalAxis ?? subsystem.mountAxis));
      }
      root.add(moduleGroup);
    });

  if (showAxes) {
    const arrowLength = Math.max(longestBusSide, item.array.panelWidthM) * 0.9;
    root.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), arrowLength, 0xff4d5a));
    root.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), arrowLength, 0x35e68a));
    root.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), arrowLength, 0x4285ff));
    root.add(new THREE.ArrowHelper(bodyAxisVector(item.frames.velocityAxis), new THREE.Vector3(0, arrowLength * 0.035, 0), arrowLength * 1.45, 0x00e5ff, arrowLength * 0.15, arrowLength * 0.08));
    root.add(new THREE.ArrowHelper(bodyAxisVector(item.frames.nadirAxis), new THREE.Vector3(arrowLength * 0.035, 0, 0), arrowLength * 1.4, 0xb15cff, arrowLength * 0.15, arrowLength * 0.08));
    root.add(new THREE.ArrowHelper(bodyAxisVector(item.frames.payloadBoresightAxis), new THREE.Vector3(-arrowLength * 0.035, 0, 0), arrowLength * 1.6, 0xff8a34, arrowLength * 0.15, arrowLength * 0.08));
    root.add(new THREE.ArrowHelper(bodyAxisVector(item.frames.solarCellNormalAxis), new THREE.Vector3(0, -arrowLength * 0.035, 0), arrowLength * 1.8, 0xffd43b, arrowLength * 0.16, arrowLength * 0.09));
    if (customAssembly && solarArrayAttached) {
      root.add(new THREE.ArrowHelper(bodyAxisVector(item.array.deploymentAxis), new THREE.Vector3(0, arrowLength * 0.07, 0), arrowLength * 1.65, 0xff4fd8, arrowLength * 0.15, arrowLength * 0.08));
    }
  }
  return root;
}

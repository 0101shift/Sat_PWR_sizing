"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DEFAULT_EO_SATELLITES, type SatelliteInventoryItem } from "./lib/satellite-inventory";
import type { MissionConfig, SignedAxis, SimulationPoint, Vector3 } from "./lib/orbit-model";
import { bodyAxisVector, buildInventorySatelliteModel, disposeThreeTree, setModelPayloadBoresight } from "./lib/satellite-three";

const ATLAS = DEFAULT_EO_SATELLITES.find((item) => item.id === "eo-atlas-600")!;

function toThree(vector: Vector3) {
  return new THREE.Vector3(vector[0], vector[1], vector[2]);
}

function inertialNadir(point: SimulationPoint) {
  return toThree(point.positionKm).normalize().negate();
}

function operationKind(value?: string) {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (normalized.startsWith("GSPOINTING")) return "GSPOINTING";
  if (normalized.startsWith("IMAGING")) return "IMAGING";
  if (normalized.startsWith("PROPULSION")) return "PROPULSION";
  if (normalized.startsWith("TRANSITION")) return "TRANSITION";
  return "NOMINAL";
}

export default function AtlasSpacecraftView({
  satellite = ATLAS,
  current,
  mission,
  spacecraftOperation,
  onAxisChange,
}: {
  satellite?: SatelliteInventoryItem;
  current: SimulationPoint;
  mission: MissionConfig;
  spacecraftOperation?: string;
  onAxisChange: (axis: SignedAxis) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelAnchorRef = useRef<THREE.Group | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const vectorArrowsRef = useRef<THREE.ArrowHelper[]>([]);
  const operationRef = useRef<THREE.Group | null>(null);
  const [deployment, setDeployment] = useState(1);

  const visualAtlas = useMemo<SatelliteInventoryItem>(() => ({
    ...structuredClone(satellite),
    frames: {
      ...satellite.frames,
      velocityAxis: mission.velocityBodyAxis,
      nadirAxis: mission.nadirBodyAxis,
      solarCellNormalAxis: mission.panelFacingAxis,
    },
    array: {
      ...satellite.array,
      wingLayout: mission.wingLayout === "DUAL" ? "dual" : "single",
    },
  }), [mission.nadirBodyAxis, mission.panelFacingAxis, mission.velocityBodyAxis, mission.wingLayout, satellite]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03080c);
    scene.fog = new THREE.FogExp2(0x03080c, 0.018);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 160);
    camera.position.set(10.5, 6.4, 12.5);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = true;
    controls.minDistance = 7;
    controls.maxDistance = 32;

    scene.add(new THREE.HemisphereLight(0x9bc9e4, 0x061016, 1.25));
    const keyLight = new THREE.DirectionalLight(0xffefcc, 3.5);
    keyLight.position.set(9, 7, 11);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x4b9ed8, 1.8);
    rimLight.position.set(-9, -3, -7);
    scene.add(rimLight);

    const referenceGrid = new THREE.GridHelper(24, 24, 0x2d7478, 0x173238);
    referenceGrid.position.y = -4.4;
    const gridMaterials = Array.isArray(referenceGrid.material) ? referenceGrid.material : [referenceGrid.material];
    gridMaterials.forEach((material) => { material.transparent = true; material.opacity = 0.34; });
    scene.add(referenceGrid);

    const stars: number[] = [];
    for (let index = 0; index < 520; index += 1) {
      const theta = index * 2.399963;
      const phi = Math.acos(1 - (2 * (index + 0.5)) / 520);
      const radius = 48 + (index % 17);
      stars.push(radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta));
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(stars, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xa9c9d5, size: 0.075 });
    scene.add(new THREE.Points(starGeometry, starMaterial));

    const modelAnchor = new THREE.Group();
    scene.add(modelAnchor);
    const arrows = [
      new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 4.8, 0x00e5ff, 0.38, 0.2),
      new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 4.5, 0xb15cff, 0.38, 0.2),
      new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 4.2, 0xffd43b, 0.38, 0.2),
      new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 4.0, 0xfff0a8, 0.38, 0.2),
    ];
    scene.add(...arrows);

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    modelAnchorRef.current = modelAnchor;
    vectorArrowsRef.current = arrows;

    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    let frameId = 0;
    const render = (time: number) => {
      controls.update();
      if (operationRef.current) operationRef.current.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (material instanceof THREE.MeshBasicMaterial) material.opacity = 0.5 + Math.sin(time * 0.007) * 0.18;
        });
      });
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(render);
    };
    frameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      controls.dispose();
      disposeThreeTree(scene);
      starGeometry.dispose();
      starMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      modelAnchorRef.current = null;
      vectorArrowsRef.current = [];
    };
  }, []);

  useEffect(() => {
    const anchor = modelAnchorRef.current;
    if (!anchor) return;
    if (modelRef.current) {
      anchor.remove(modelRef.current);
      disposeThreeTree(modelRef.current);
    }
    const model = buildInventorySatelliteModel(visualAtlas, 1, true, {
      solarNormalBody: current.panelNormalBody,
    });
    const bus = Math.max(...Object.values(visualAtlas.geometry.dimensionsM));
    const span = visualAtlas.array.panelLengthM * (visualAtlas.array.wingLayout === "dual" ? 2 : 1) + bus;
    model.scale.setScalar(8.4 / Math.max(span, bus, 0.1));
    anchor.add(model);
    modelRef.current = model;
    return () => {
      if (modelAnchorRef.current && modelRef.current === model) {
        modelAnchorRef.current.remove(model);
        disposeThreeTree(model);
        modelRef.current = null;
      }
    };
  }, [current.panelNormalBody, visualAtlas]);

  useEffect(() => {
    const model = modelRef.current;
    const arrayMount = model?.getObjectByName("solar-array-mount");
    if (!arrayMount) return;
    const localDeploymentAxis = bodyAxisVector(visualAtlas.array.deploymentAxis)
      .applyQuaternion(arrayMount.quaternion.clone().invert())
      .normalize();
    const signs = visualAtlas.array.wingLayout === "dual" ? [-1, 1] : [1];
    signs.forEach((sign) => {
      const pivot = arrayMount.getObjectByName(`solar-wing-pivot-${sign}`);
      pivot?.quaternion.setFromAxisAngle(
        localDeploymentAxis,
        sign * (1 - deployment) * THREE.MathUtils.degToRad(visualAtlas.array.deployedAngleDeg),
      );
    });
  }, [deployment, visualAtlas]);

  useEffect(() => {
    const anchor = modelAnchorRef.current;
    if (!anchor) return;
    const basis = new THREE.Matrix4().makeBasis(
      toThree(current.bodyXAxis),
      toThree(current.bodyYAxis),
      toThree(current.bodyZAxis),
    );
    anchor.quaternion.setFromRotationMatrix(basis);
    if (modelRef.current) setModelPayloadBoresight(modelRef.current, current.payloadBoresightBody);
    const [velocityArrow, nadirArrow, panelArrow, sunArrow] = vectorArrowsRef.current;
    velocityArrow?.setDirection(toThree(current.velocityKmS).normalize());
    nadirArrow?.setDirection(inertialNadir(current));
    panelArrow?.setDirection(toThree(current.panelNormal).normalize());
    sunArrow?.setDirection(toThree(current.sunVector).normalize());
  }, [current]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (operationRef.current) {
      scene.remove(operationRef.current);
      disposeThreeTree(operationRef.current);
      operationRef.current = null;
    }
    const kind = operationKind(spacecraftOperation);
    if (kind === "NOMINAL") return;
    const group = new THREE.Group();
    if (kind === "IMAGING" || kind === "GSPOINTING") {
      const direction = toThree(current.payloadBoresight).normalize();
      const color = kind === "IMAGING" ? 0x4ee191 : 0x4ea9ff;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, kind === "IMAGING" ? 0.72 : 0.48, 5.5, 24, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.58, side: THREE.DoubleSide }),
      );
      beam.position.copy(direction).multiplyScalar(2.75);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      group.add(beam);
    } else if (kind === "PROPULSION") {
      const direction = toThree(current.velocityKmS).normalize().negate();
      const plume = new THREE.Mesh(
        new THREE.ConeGeometry(0.55, 3.2, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x4ea9ff, transparent: true, opacity: 0.62, side: THREE.DoubleSide }),
      );
      plume.position.copy(direction).multiplyScalar(1.7);
      plume.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      group.add(plume);
    } else {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(3.6, 0.045, 8, 72),
        new THREE.MeshBasicMaterial({ color: 0xf2b45a, transparent: true, opacity: 0.66 }),
      );
      group.add(ring);
    }
    scene.add(group);
    operationRef.current = group;
    return () => {
      if (sceneRef.current && operationRef.current === group) {
        sceneRef.current.remove(group);
        disposeThreeTree(group);
        operationRef.current = null;
      }
    };
  }, [current, spacecraftOperation]);

  const replayDeployment = () => {
    setDeployment(0);
    const started = performance.now();
    const step = (time: number) => {
      const progress = Math.min(1, (time - started) / 1200);
      setDeployment(progress * progress * (3 - 2 * progress));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const resetView = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    camera.position.set(10.5, 6.4, 12.5);
    controls.target.set(0, 0, 0);
    controls.update();
  };

  return (
    <div className="atlas-spacecraft-stage">
      <div ref={mountRef} className="atlas-three-mount" aria-label={`Live ${satellite.name} spacecraft attitude view`} />
      <div className="atlas-model-badge">
        <b>{satellite.name} · live attitude</b>
        <span>Inventory geometry · current simulator body frame</span>
      </div>
      <div className="spacecraft-tools atlas-spacecraft-tools" aria-label={`${satellite.name} spacecraft controls`}>
        <div className="face-assignment-controls">
          <span>Sun-facing cell normal</span>
          <div className="atlas-axis-buttons">
            {(["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as SignedAxis[]).map((axis) => (
              <button type="button" className={mission.panelFacingAxis === axis ? "active" : ""} key={axis} onClick={() => onAxisChange(axis)}>{axis}</button>
            ))}
          </div>
          <em>{mission.panelFacingAxis} drives both geometry and power incidence</em>
        </div>
        <div className="deployment-controls">
          <button type="button" onClick={resetView}>Reset 3D view</button>
          <button type="button" onClick={replayDeployment}>Replay deployment</button>
          <span>{Math.round(deployment * 90)}° deployed</span>
        </div>
      </div>
      <div className="atlas-vector-legend" aria-label="Spacecraft vector legend">
        <span><i className="atlas-v-velocity" />Velocity</span>
        <span><i className="atlas-v-nadir" />Nadir</span>
        <span><i className="atlas-v-panel" />Cell +N</span>
        <span><i className="atlas-v-sun" />Sun</span>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  DEFAULT_EO_SATELLITES,
  cloneInventory,
  isSatelliteInventoryItem,
  type SatelliteInventoryItem,
} from "../lib/satellite-inventory";
import {
  bodyAxisDirectionInInertial,
  orbitalPeriodSec,
  orbitFrameSample,
  sunDirection,
  type OrbitFrameSample,
  type Vector3,
} from "../lib/orbit-model";
import { buildInventorySatelliteModel, disposeThreeTree } from "../lib/satellite-three";
import styles from "./SatelliteIntegrationLab.module.css";

const STORAGE_KEY = "orbit-pwr-eo-inventory-v1";
const EARTH_SCENE_RADIUS = 3;
const EPOCH = new Date("2028-01-01T00:00:00Z");

function toThree(vector: Vector3) {
  return new THREE.Vector3(vector[0], vector[1], vector[2]);
}

function angleDeg(a: Vector3, b: Vector3) {
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(toThree(a).normalize().dot(toThree(b).normalize()), -1, 1)));
}

function visualOrbitRadius(altitudeKm: number) {
  return EARTH_SCENE_RADIUS + 0.92 + Math.min(altitudeKm / 2200, 1.6);
}

function orbitPosition(sample: OrbitFrameSample, altitudeKm: number) {
  return toThree(sample.positionKm).normalize().multiplyScalar(visualOrbitRadius(altitudeKm));
}

interface SceneProps {
  satellite: SatelliteInventoryItem;
  sample: OrbitFrameSample;
  altitudeKm: number;
  inclinationDeg: number;
  raanDeg: number;
  deployment: number;
  panelDirection: Vector3;
  payloadDirection: Vector3;
  sunVector: Vector3;
  showVectors: boolean;
}

function OrbitIntegrationScene({
  satellite,
  sample,
  altitudeKm,
  inclinationDeg,
  raanDeg,
  deployment,
  panelDirection,
  payloadDirection,
  sunVector,
  showVectors,
}: SceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const satelliteAnchorRef = useRef<THREE.Group | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const orbitLineRef = useRef<THREE.Line | null>(null);
  const vectorGroupRef = useRef<THREE.Group | null>(null);
  const velocityArrowRef = useRef<THREE.ArrowHelper | null>(null);
  const nadirArrowRef = useRef<THREE.ArrowHelper | null>(null);
  const panelArrowRef = useRef<THREE.ArrowHelper | null>(null);
  const payloadArrowRef = useRef<THREE.ArrowHelper | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03080c);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.02, 200);
    camera.position.set(7.8, 5.5, 9.2);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.target.set(0, 0, 0);
    controls.minDistance = 5;
    controls.maxDistance = 35;

    scene.add(new THREE.HemisphereLight(0x8bb8d5, 0x071017, 1.15));
    const sunlight = new THREE.DirectionalLight(0xfff1cc, 3.4);
    sunlight.position.copy(toThree(sunVector).multiplyScalar(14));
    sunlight.castShadow = true;
    scene.add(sunlight);

    const earthMaterial = new THREE.MeshStandardMaterial({ color: 0x174e75, roughness: 0.82, metalness: 0.02 });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_SCENE_RADIUS, 64, 48), earthMaterial);
    earth.receiveShadow = true;
    scene.add(earth);
    new THREE.TextureLoader().load("/earth-blue-marble.png", (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      earthMaterial.map = texture;
      earthMaterial.needsUpdate = true;
    });
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_SCENE_RADIUS * 1.018, 64, 48),
      new THREE.MeshBasicMaterial({ color: 0x4ca7d6, transparent: true, opacity: 0.08, side: THREE.BackSide }),
    );
    scene.add(atmosphere);

    const stars: number[] = [];
    for (let index = 0; index < 700; index += 1) {
      const theta = index * 2.399963;
      const phi = Math.acos(1 - (2 * (index + 0.5)) / 700);
      const radius = 65 + (index % 19);
      stars.push(radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta));
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(stars, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xb5ccd6, size: 0.08 });
    scene.add(new THREE.Points(starGeometry, starMaterial));

    const sunPosition = toThree(sunVector).normalize().multiplyScalar(14);
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd36a }),
    );
    sun.position.copy(sunPosition);
    scene.add(sun);

    const satelliteAnchor = new THREE.Group();
    scene.add(satelliteAnchor);
    const vectorGroup = new THREE.Group();
    scene.add(vectorGroup);
    const velocityArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1.25, 0x00e5ff, 0.18, 0.09);
    const nadirArrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 1.25, 0xb15cff, 0.18, 0.09);
    const panelArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1.05, 0xffd43b, 0.16, 0.08);
    const payloadArrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 1.05, 0xff8a34, 0.16, 0.08);
    vectorGroup.add(velocityArrow, nadirArrow, panelArrow, payloadArrow);

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    satelliteAnchorRef.current = satelliteAnchor;
    vectorGroupRef.current = vectorGroup;
    velocityArrowRef.current = velocityArrow;
    nadirArrowRef.current = nadirArrow;
    panelArrowRef.current = panelArrow;
    payloadArrowRef.current = payloadArrow;
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
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      earth.geometry.dispose();
      earthMaterial.dispose();
      atmosphere.geometry.dispose();
      (atmosphere.material as THREE.Material).dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      satelliteAnchorRef.current = null;
    };
  }, [sunVector]);

  useEffect(() => {
    const anchor = satelliteAnchorRef.current;
    if (!anchor) return;
    if (modelRef.current) {
      anchor.remove(modelRef.current);
      disposeThreeTree(modelRef.current);
    }
    const model = buildInventorySatelliteModel(satellite, deployment, false);
    const bus = Math.max(...Object.values(satellite.geometry.dimensionsM));
    const span = satellite.array.panelLengthM * (satellite.array.wingLayout === "dual" ? 2 : 1) + bus;
    model.scale.setScalar(0.72 / Math.max(span, bus, 0.1));
    anchor.add(model);
    modelRef.current = model;
    return () => {
      if (satelliteAnchorRef.current && modelRef.current === model) {
        satelliteAnchorRef.current.remove(model);
        disposeThreeTree(model);
        modelRef.current = null;
      }
    };
  }, [satellite, deployment]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (orbitLineRef.current) {
      scene.remove(orbitLineRef.current);
      disposeThreeTree(orbitLineRef.current);
    }
    const points: THREE.Vector3[] = [];
    for (let anomaly = 0; anomaly <= 360; anomaly += 2) {
      const orbitSample = orbitFrameSample(
        altitudeKm,
        inclinationDeg,
        raanDeg,
        anomaly,
        satellite.frames.velocityAxis,
        satellite.frames.nadirAxis,
      );
      points.push(orbitPosition(orbitSample, altitudeKm));
    }
    const orbitLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x4c8fa5, transparent: true, opacity: 0.6 }),
    );
    scene.add(orbitLine);
    orbitLineRef.current = orbitLine;
    return () => {
      if (sceneRef.current && orbitLineRef.current === orbitLine) {
        sceneRef.current.remove(orbitLine);
        disposeThreeTree(orbitLine);
        orbitLineRef.current = null;
      }
    };
  }, [altitudeKm, inclinationDeg, raanDeg, satellite.frames.velocityAxis, satellite.frames.nadirAxis]);

  useEffect(() => {
    const anchor = satelliteAnchorRef.current;
    const vectors = vectorGroupRef.current;
    if (!anchor || !vectors) return;
    const position = orbitPosition(sample, altitudeKm);
    anchor.position.copy(position);
    const basis = new THREE.Matrix4().makeBasis(
      toThree(sample.bodyXAxis),
      toThree(sample.bodyYAxis),
      toThree(sample.bodyZAxis),
    );
    anchor.quaternion.setFromRotationMatrix(basis);
    vectors.visible = showVectors;
    const vectorOrigin = position.clone();
    velocityArrowRef.current?.position.copy(vectorOrigin);
    velocityArrowRef.current?.setDirection(toThree(sample.velocityDirection).normalize());
    nadirArrowRef.current?.position.copy(vectorOrigin);
    nadirArrowRef.current?.setDirection(toThree(sample.nadirDirection).normalize());
    panelArrowRef.current?.position.copy(vectorOrigin);
    panelArrowRef.current?.setDirection(toThree(panelDirection).normalize());
    payloadArrowRef.current?.position.copy(vectorOrigin);
    payloadArrowRef.current?.setDirection(toThree(payloadDirection).normalize());
  }, [sample, altitudeKm, panelDirection, payloadDirection, showVectors]);

  return <div ref={mountRef} className={styles.sceneMount} aria-label={`Orbit integration view of ${satellite.name}`} />;
}

function metricClass(errorDeg: number, valid = true) {
  if (!valid || errorDeg > 1) return styles.metricFail;
  if (errorDeg > 0.05) return styles.metricWarn;
  return styles.metricPass;
}

export default function SatelliteIntegrationLab() {
  const [inventory, setInventory] = useState(() => cloneInventory());
  const [selectedId, setSelectedId] = useState(DEFAULT_EO_SATELLITES[0].id);
  const [altitudeKm, setAltitudeKm] = useState(DEFAULT_EO_SATELLITES[0].missionDefaults.altitudeKm ?? 550);
  const [inclinationDeg, setInclinationDeg] = useState(DEFAULT_EO_SATELLITES[0].missionDefaults.inclinationDeg ?? 97.6);
  const [raanDeg, setRaanDeg] = useState(0);
  const [trueAnomalyDeg, setTrueAnomalyDeg] = useState(22);
  const [deployment, setDeployment] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(500);
  const [showVectors, setShowVectors] = useState(true);
  const satellite = inventory.find((item) => item.id === selectedId) ?? inventory[0];

  useEffect(() => {
    const restore = setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return;
        const parsed = JSON.parse(saved) as unknown;
        if (!Array.isArray(parsed)) return;
        const valid = parsed.filter(isSatelliteInventoryItem);
        if (valid.length > 0) {
          setInventory(valid);
          setSelectedId(valid[0].id);
          setAltitudeKm(valid[0].missionDefaults.altitudeKm ?? 550);
          setInclinationDeg(valid[0].missionDefaults.inclinationDeg ?? 97.6);
        }
      } catch {
        // Trial inventory remains available when a local draft is invalid.
      }
    }, 0);
    return () => clearTimeout(restore);
  }, []);

  const periodSec = orbitalPeriodSec(altitudeKm);
  useEffect(() => {
    if (!playing) return;
    let frameId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const elapsedSec = Math.min((now - last) / 1000, 0.1);
      last = now;
      setTrueAnomalyDeg((value) => (value + (elapsedSec * speed * 360) / periodSec) % 360);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playing, speed, periodSec]);

  const sample = useMemo(
    () => orbitFrameSample(
      altitudeKm,
      inclinationDeg,
      raanDeg,
      trueAnomalyDeg,
      satellite.frames.velocityAxis,
      satellite.frames.nadirAxis,
    ),
    [altitudeKm, inclinationDeg, raanDeg, trueAnomalyDeg, satellite.frames.velocityAxis, satellite.frames.nadirAxis],
  );
  const panelDirection = useMemo(
    () => bodyAxisDirectionInInertial(satellite.frames.solarCellNormalAxis, sample),
    [satellite.frames.solarCellNormalAxis, sample],
  );
  const payloadDirection = useMemo(
    () => bodyAxisDirectionInInertial(satellite.frames.payloadBoresightAxis, sample),
    [satellite.frames.payloadBoresightAxis, sample],
  );
  const sunVector = useMemo(() => sunDirection(EPOCH), []);
  const panelSunAngleDeg = angleDeg(panelDirection, sunVector);
  const payloadNadirErrorDeg = angleDeg(payloadDirection, sample.nadirDirection);

  const selectSatellite = (id: string) => {
    const next = inventory.find((item) => item.id === id);
    if (!next) return;
    setSelectedId(id);
    setAltitudeKm(next.missionDefaults.altitudeKm ?? 550);
    setInclinationDeg(next.missionDefaults.inclinationDeg ?? 97.6);
    setDeployment(1);
  };

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div>
          <p>ORBIT·PWR / LOCAL EXPERIMENT</p>
          <h1>Satellite Axis Integration Lab</h1>
        </div>
        <span className={styles.isolationBadge}>ISOLATED · FINAL SIMULATOR UNCHANGED</span>
        <nav><Link href="/satellite-inventory">Inventory</Link><Link href="/">Final simulator</Link></nav>
      </header>

      <section className={styles.workspace}>
        <aside className={styles.controls}>
          <div className={styles.panelHeading}><small>TEST ARTICLE</small><h2>Inventory spacecraft</h2></div>
          <label className={styles.field}><span>Satellite</span><select value={satellite.id} onChange={(event) => selectSatellite(event.target.value)}>{inventory.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <div className={styles.identityCard}><strong>{satellite.name}</strong><span>{satellite.className} · {satellite.geometry.massKg} kg</span><small>{satellite.status === "custom" ? "LOCAL CUSTOM DRAFT" : "TRIAL INVENTORY MODEL"}</small></div>

          <div className={styles.section}><div className={styles.panelHeading}><small>ORBIT FRAME</small><h2>Circular LVLH test</h2></div>
            <label className={styles.field}><span>Altitude <output>{altitudeKm.toFixed(0)} km</output></span><input type="range" min="300" max="1200" step="10" value={altitudeKm} onChange={(event) => setAltitudeKm(Number(event.target.value))} /></label>
            <label className={styles.field}><span>Inclination <output>{inclinationDeg.toFixed(1)}°</output></span><input type="range" min="0" max="110" step="0.1" value={inclinationDeg} onChange={(event) => setInclinationDeg(Number(event.target.value))} /></label>
            <label className={styles.field}><span>RAAN <output>{raanDeg.toFixed(1)}°</output></span><input type="range" min="0" max="360" step="1" value={raanDeg} onChange={(event) => setRaanDeg(Number(event.target.value))} /></label>
            <label className={styles.field}><span>True anomaly <output>{trueAnomalyDeg.toFixed(1)}°</output></span><input type="range" min="0" max="360" step="0.1" value={trueAnomalyDeg} onChange={(event) => setTrueAnomalyDeg(Number(event.target.value))} /></label>
          </div>

          <div className={styles.section}><div className={styles.panelHeading}><small>BODY MAPPING</small><h2>Inventory assignments</h2></div>
            {([[
              "Velocity body axis", "velocityAxis"], ["Nadir body axis", "nadirAxis"], ["Payload boresight", "payloadBoresightAxis"], ["Panel cell normal", "solarCellNormalAxis"],
            ] as const).map(([label, key]) => <div className={styles.mappingRow} key={key}><span>{label}</span><strong>{satellite.frames[key]}</strong></div>)}
          </div>
        </aside>

        <section className={styles.sceneColumn}>
          <div className={styles.sceneHeader}><div><small>ECI WORLD / LVLH ATTITUDE</small><h2>{satellite.name} alignment preview</h2></div><div><button type="button" className={showVectors ? styles.activeButton : ""} onClick={() => setShowVectors((value) => !value)}>Vectors</button><button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? "Pause" : "Play"}</button></div></div>
          <div className={styles.sceneFrame}>
            <OrbitIntegrationScene satellite={satellite} sample={sample} altitudeKm={altitudeKm} inclinationDeg={inclinationDeg} raanDeg={raanDeg} deployment={deployment} panelDirection={panelDirection} payloadDirection={payloadDirection} sunVector={sunVector} showVectors={showVectors} />
            <div className={styles.sceneLegend}><span><i className={styles.velocityColor} />ORBIT VELOCITY</span><span><i className={styles.nadirColor} />EARTH NADIR</span><span><i className={styles.panelColor} />PANEL NORMAL</span><span><i className={styles.payloadColor} />PAYLOAD</span></div>
            <div className={styles.scaleNote}>ORBIT RADIUS VISUALLY EXAGGERATED · ATTITUDE/VECTOR GEOMETRY ANALYTICAL</div>
          </div>
          <div className={styles.playbackBar}><label><span>ARRAY DEPLOYMENT</span><input type="range" min="0" max="1" step="0.01" value={deployment} onChange={(event) => setDeployment(Number(event.target.value))} /></label><label><span>PLAYBACK</span><select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value="50">50×</option><option value="200">200×</option><option value="500">500×</option><option value="1000">1000×</option></select></label><output>{(periodSec / 60).toFixed(1)} min orbit</output></div>
        </section>

        <aside className={styles.diagnostics}>
          <div className={styles.panelHeading}><small>VERIFICATION</small><h2>Axis alignment</h2></div>
          <div className={`${styles.validityBanner} ${sample.validAxisMapping ? styles.validBanner : styles.invalidBanner}`}><strong>{sample.validAxisMapping ? "VALID LVLH MAPPING" : "AXIS CONFLICT"}</strong><span>{sample.validAxisMapping ? "Velocity and nadir use independent body axes" : "Velocity and nadir cannot use the same body-axis family"}</span></div>
          <div className={styles.metricList}>
            <article className={metricClass(sample.velocityAlignmentErrorDeg, sample.validAxisMapping)}><small>VELOCITY ALIGNMENT ERROR</small><strong>{sample.velocityAlignmentErrorDeg.toFixed(4)}°</strong><span>{satellite.frames.velocityAxis} → +V</span></article>
            <article className={metricClass(sample.nadirAlignmentErrorDeg, sample.validAxisMapping)}><small>NADIR ALIGNMENT ERROR</small><strong>{sample.nadirAlignmentErrorDeg.toFixed(4)}°</strong><span>{satellite.frames.nadirAxis} → Earth center</span></article>
            <article className={metricClass(sample.frameOrthogonalityErrorDeg)}><small>BODY FRAME ORTHOGONALITY ERROR</small><strong>{sample.frameOrthogonalityErrorDeg.toFixed(6)}°</strong><span>X · Y · Z right-handed frame</span></article>
            <article className={metricClass(payloadNadirErrorDeg)}><small>PAYLOAD–NADIR ERROR</small><strong>{payloadNadirErrorDeg.toFixed(3)}°</strong><span>{satellite.frames.payloadBoresightAxis} payload axis</span></article>
            <article className={styles.metricNeutral}><small>PANEL–SUN INCIDENCE</small><strong>{panelSunAngleDeg.toFixed(2)}°</strong><span>{satellite.frames.solarCellNormalAxis} cell normal at epoch</span></article>
          </div>
          <div className={styles.methodNote}><strong>Mapping method</strong><p>The selected signed velocity axis is aligned with the orbit tangent. The selected signed nadir axis is aligned with −R. The third body axis is generated by the right-handed cross product. No attitude behavior has been merged into the final simulator.</p></div>
        </aside>
      </section>
    </main>
  );
}

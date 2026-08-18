"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  EARTH_RADIUS_KM,
  formatDuration,
  runSimulation,
  type AttitudeMode,
  type Axis,
  type MissionConfig,
  type OrbitPreset,
  type PowerConfig,
  type SimulationPoint,
  type Vector3,
} from "./lib/orbit-model";

type ViewMode = "ORBIT" | "SPACECRAFT";

const DEFAULT_MISSION: MissionConfig = {
  preset: "SSO",
  altitudeKm: 550,
  inclinationDeg: 97.6,
  raanDeg: 0,
  ltanHours: 10.5,
  epoch: "2026-08-18T00:00",
  durationOrbits: 2,
  stepSec: 45,
  attitude: "LVLH",
  deploymentAxis: "Y",
};

const DEFAULT_POWER: PowerConfig = {
  activeAreaM2: 2.4,
  efficiencyPct: 30,
  degradationPct: 80,
  systemLossPct: 12,
  averageLoadW: 420,
  batteryWh: 520,
  initialSocPct: 100,
};

const PRESET_LABELS: Record<OrbitPreset, string> = {
  LEO: "Circular LEO",
  SSO: "Sun-sync LEO",
  GEO: "Circular GEO",
};

const ATTITUDE_LABELS: Record<AttitudeMode, string> = {
  LVLH: "Nadir / LVLH",
  SUN_POINTING: "Sun pointing",
  INERTIAL: "Inertial fixed",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function magnitude(vector: Vector3) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Vector3, fallback: Vector3 = [1, 0, 0]): Vector3 {
  const length = magnitude(vector);
  return length > 1e-9
    ? [vector[0] / length, vector[1] / length, vector[2] / length]
    : fallback;
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function add(a: Vector3, b: Vector3): Vector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(vector: Vector3, amount: number): Vector3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function useCanvasSize(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const [size, setSize] = useState({ width: 800, height: 500, dpr: 1 });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const update = () => {
      const rect = canvas.getBoundingClientRect();
      setSize({
        width: Math.max(280, rect.width),
        height: Math.max(220, rect.height),
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef]);
  return size;
}

function drawArrow(
  context: CanvasRenderingContext2D,
  from: [number, number],
  to: [number, number],
  color: string,
  label?: string,
) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(from[0], from[1]);
  context.lineTo(to[0], to[1]);
  context.stroke();
  context.beginPath();
  context.moveTo(to[0], to[1]);
  context.lineTo(to[0] - 9 * Math.cos(angle - 0.45), to[1] - 9 * Math.sin(angle - 0.45));
  context.lineTo(to[0] - 9 * Math.cos(angle + 0.45), to[1] - 9 * Math.sin(angle + 0.45));
  context.closePath();
  context.fill();
  if (label) {
    context.font = "600 11px var(--font-geist-mono), monospace";
    context.fillText(label, to[0] + 7, to[1] - 5);
  }
}

function OrbitCanvas({
  points,
  currentIndex,
  mode,
}: {
  points: SimulationPoint[];
  currentIndex: number;
  mode: ViewMode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(canvasRef);
  const [rotation, setRotation] = useState({ yaw: -0.55, pitch: 0.56 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !points.length) return;
    const { width, height, dpr } = size;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#061219");
    background.addColorStop(0.58, "#08171c");
    background.addColorStop(1, "#071014");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    for (let star = 0; star < 80; star += 1) {
      const x = ((star * 67 + 29) % 997) / 997 * width;
      const y = ((star * 149 + 71) % 991) / 991 * height;
      const alpha = 0.12 + ((star * 17) % 50) / 100;
      context.fillStyle = `rgba(204, 235, 238, ${alpha})`;
      context.fillRect(x, y, star % 9 === 0 ? 1.5 : 1, star % 9 === 0 ? 1.5 : 1);
    }

    const rotate = (vector: Vector3): Vector3 => {
      const cy = Math.cos(rotation.yaw);
      const sy = Math.sin(rotation.yaw);
      const cp = Math.cos(rotation.pitch);
      const sp = Math.sin(rotation.pitch);
      const x = cy * vector[0] - sy * vector[1];
      const y = sy * vector[0] + cy * vector[1];
      const z = vector[2];
      return [x, cp * y - sp * z, sp * y + cp * z];
    };

    const current = points[clamp(currentIndex, 0, points.length - 1)];

    if (mode === "ORBIT") {
      const maxRadius = Math.max(...points.map((point) => magnitude(point.positionKm)));
      const plotRadius = Math.min(width * 0.42, height * 0.43);
      const plotScale = plotRadius / (maxRadius * 1.12);
      const center: [number, number] = [width * 0.52, height * 0.52];
      const project = (vector: Vector3): [number, number, number] => {
        const transformed = rotate(vector);
        return [
          center[0] + transformed[0] * plotScale,
          center[1] - transformed[1] * plotScale,
          transformed[2],
        ];
      };

      context.strokeStyle = "rgba(131, 179, 184, 0.12)";
      context.lineWidth = 1;
      for (let ring = 1; ring <= 3; ring += 1) {
        context.beginPath();
        context.arc(center[0], center[1], (plotRadius * ring) / 3, 0, Math.PI * 2);
        context.stroke();
      }

      for (let index = 1; index < points.length; index += 1) {
        const from = project(points[index - 1].positionKm);
        const to = project(points[index].positionKm);
        const light = (points[index - 1].shadowFactor + points[index].shadowFactor) / 2;
        context.strokeStyle = light < 0.25 ? "rgba(245, 166, 78, 0.45)" : "rgba(87, 225, 226, 0.72)";
        context.lineWidth = light < 0.25 ? 2 : 1.6;
        context.beginPath();
        context.moveTo(from[0], from[1]);
        context.lineTo(to[0], to[1]);
        context.stroke();
      }

      const earthRadius = EARTH_RADIUS_KM * plotScale;
      const sun2d = rotate(current.sunVector);
      const lightX = center[0] - sun2d[0] * earthRadius * 0.34;
      const lightY = center[1] + sun2d[1] * earthRadius * 0.34;
      const earthGradient = context.createRadialGradient(
        lightX,
        lightY,
        earthRadius * 0.08,
        center[0],
        center[1],
        earthRadius,
      );
      earthGradient.addColorStop(0, "#5bd4d1");
      earthGradient.addColorStop(0.34, "#147c83");
      earthGradient.addColorStop(0.72, "#0a3845");
      earthGradient.addColorStop(1, "#041419");
      context.fillStyle = earthGradient;
      context.beginPath();
      context.arc(center[0], center[1], earthRadius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(113, 225, 224, 0.38)";
      context.lineWidth = 1;
      context.stroke();
      context.save();
      context.beginPath();
      context.arc(center[0], center[1], earthRadius, 0, Math.PI * 2);
      context.clip();
      context.strokeStyle = "rgba(172, 236, 231, 0.12)";
      for (let latitude = -2; latitude <= 2; latitude += 1) {
        context.beginPath();
        context.ellipse(
          center[0],
          center[1] + latitude * earthRadius * 0.28,
          earthRadius * Math.sqrt(Math.max(0.1, 1 - (latitude * 0.25) ** 2)),
          earthRadius * 0.12,
          0,
          0,
          Math.PI * 2,
        );
        context.stroke();
      }
      context.restore();

      const sunOrigin: [number, number] = [42, 56];
      const sunTarget: [number, number] = [
        sunOrigin[0] + sun2d[0] * 62,
        sunOrigin[1] - sun2d[1] * 62,
      ];
      context.fillStyle = "rgba(246, 180, 81, 0.18)";
      context.beginPath();
      context.arc(sunOrigin[0], sunOrigin[1], 18, 0, Math.PI * 2);
      context.fill();
      drawArrow(context, sunOrigin, sunTarget, "#f7b957", "SUN");

      const satellite = project(current.positionKm);
      const velocity = normalize(current.velocityKmS);
      const velocityEnd = project(add(current.positionKm, scale(velocity, maxRadius * 0.22)));
      context.fillStyle = current.shadowFactor < 0.2 ? "#f2a54d" : "#88ffff";
      context.shadowColor = context.fillStyle;
      context.shadowBlur = 16;
      context.beginPath();
      context.arc(satellite[0], satellite[1], 5.5, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      drawArrow(
        context,
        [satellite[0], satellite[1]],
        [velocityEnd[0], velocityEnd[1]],
        "#c8f0ee",
        "V",
      );
      context.fillStyle = "rgba(217, 239, 237, 0.65)";
      context.font = "500 11px var(--font-geist-mono), monospace";
      context.fillText("Drag to rotate", width - 106, height - 18);
    } else {
      const center: [number, number] = [width * 0.5, height * 0.52];
      const bodyScale = Math.min(width, height) / 210;
      const project = (vector: Vector3): [number, number, number] => {
        const transformed = rotate(vector);
        return [
          center[0] + transformed[0] * bodyScale,
          center[1] - transformed[1] * bodyScale,
          transformed[2],
        ];
      };
      const busVertices: Vector3[] = [
        [-24, -18, -16], [24, -18, -16], [24, 18, -16], [-24, 18, -16],
        [-24, -18, 16], [24, -18, 16], [24, 18, 16], [-24, 18, 16],
      ];
      const faces = [
        [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
        [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4],
      ].map((indices) => ({
        indices,
        depth: indices.reduce((sum, index) => sum + rotate(busVertices[index])[2], 0) / 4,
      })).sort((a, b) => a.depth - b.depth);

      faces.forEach((face, faceIndex) => {
        const projected = face.indices.map((index) => project(busVertices[index]));
        context.fillStyle = faceIndex % 2 ? "#244249" : "#1a3339";
        context.strokeStyle = "rgba(154, 211, 210, 0.55)";
        context.lineWidth = 1;
        context.beginPath();
        projected.forEach((point, index) => {
          if (index === 0) context.moveTo(point[0], point[1]);
          else context.lineTo(point[0], point[1]);
        });
        context.closePath();
        context.fill();
        context.stroke();
      });

      const hinge = normalize(current.hingeBody);
      const normal = normalize(current.panelNormalBody, [0, 0, 1]);
      const span = normalize(cross(hinge, normal), [1, 0, 0]);
      [-1, 1].forEach((side) => {
        const centerPanel = scale(span, side * 60);
        const corners = [
          add(add(centerPanel, scale(span, -32)), scale(hinge, -18)),
          add(add(centerPanel, scale(span, 32)), scale(hinge, -18)),
          add(add(centerPanel, scale(span, 32)), scale(hinge, 18)),
          add(add(centerPanel, scale(span, -32)), scale(hinge, 18)),
        ].map(project);
        context.fillStyle = "rgba(20, 113, 132, 0.88)";
        context.strokeStyle = "#63d7d6";
        context.lineWidth = 1.3;
        context.beginPath();
        corners.forEach((point, index) => {
          if (index === 0) context.moveTo(point[0], point[1]);
          else context.lineTo(point[0], point[1]);
        });
        context.closePath();
        context.fill();
        context.stroke();
        const centerLineFrom = project(add(centerPanel, scale(span, -32)));
        const centerLineTo = project(add(centerPanel, scale(span, 32)));
        context.strokeStyle = "rgba(177, 235, 232, 0.35)";
        context.beginPath();
        context.moveTo(centerLineFrom[0], centerLineFrom[1]);
        context.lineTo(centerLineTo[0], centerLineTo[1]);
        context.stroke();
      });

      const origin = project([0, 0, 0]);
      const vectorArrow = (vector: Vector3, length: number, color: string, label: string) => {
        const end = project(scale(normalize(vector), length));
        drawArrow(context, [origin[0], origin[1]], [end[0], end[1]], color, label);
      };
      vectorArrow(current.bodySun, 86, "#f7b957", "SUN");
      vectorArrow(current.bodyVelocity, 72, "#d3efed", "V");
      vectorArrow(current.hingeBody, 62, "#9d7cf7", "HINGE");
      vectorArrow(current.panelNormalBody, 57, "#58e1dd", "N");
      context.fillStyle = "rgba(217, 239, 237, 0.65)";
      context.font = "500 11px var(--font-geist-mono), monospace";
      context.fillText("Ideal single-axis tracking", 20, height - 18);
      context.fillText("Drag to rotate", width - 106, height - 18);
    }
  }, [currentIndex, mode, points, rotation, size]);

  return (
    <canvas
      ref={canvasRef}
      className="space-canvas"
      aria-label={mode === "ORBIT" ? "Interactive three-dimensional orbit view" : "Interactive spacecraft and solar-panel vector view"}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const dx = event.clientX - drag.current.x;
        const dy = event.clientY - drag.current.y;
        drag.current = { x: event.clientX, y: event.clientY };
        setRotation((value) => ({
          yaw: value.yaw + dx * 0.008,
          pitch: clamp(value.pitch + dy * 0.008, -1.35, 1.35),
        }));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    />
  );
}

function PowerChart({ points, currentIndex }: { points: SimulationPoint[]; currentIndex: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(canvasRef);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !points.length) return;
    const { width, height, dpr } = size;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const left = 46;
    const right = 38;
    const top = 22;
    const bottom = 32;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const maxPower = Math.max(1, ...points.map((point) => point.powerW)) * 1.08;
    const maxTime = points[points.length - 1].tSec;
    const x = (time: number) => left + (time / maxTime) * plotWidth;
    const yPower = (power: number) => top + plotHeight - (power / maxPower) * plotHeight;
    const ySoc = (soc: number) => top + plotHeight - (soc / 100) * plotHeight;

    context.fillStyle = "#0b181c";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "rgba(158, 197, 199, 0.12)";
    context.lineWidth = 1;
    context.font = "10px var(--font-geist-mono), monospace";
    context.fillStyle = "rgba(203, 228, 228, 0.55)";
    for (let row = 0; row <= 4; row += 1) {
      const yy = top + (plotHeight * row) / 4;
      context.beginPath();
      context.moveTo(left, yy);
      context.lineTo(width - right, yy);
      context.stroke();
      context.fillText(`${Math.round(maxPower * (1 - row / 4))}`, 7, yy + 3);
    }
    for (let column = 0; column <= 4; column += 1) {
      const xx = left + (plotWidth * column) / 4;
      context.beginPath();
      context.moveTo(xx, top);
      context.lineTo(xx, top + plotHeight);
      context.stroke();
      context.fillText(`${Math.round((maxTime * column) / 240)}m`, xx - 10, height - 10);
    }

    const powerGradient = context.createLinearGradient(0, top, 0, top + plotHeight);
    powerGradient.addColorStop(0, "rgba(73, 217, 212, 0.38)");
    powerGradient.addColorStop(1, "rgba(73, 217, 212, 0.015)");
    context.beginPath();
    context.moveTo(x(points[0].tSec), top + plotHeight);
    points.forEach((point) => context.lineTo(x(point.tSec), yPower(point.powerW)));
    context.lineTo(x(maxTime), top + plotHeight);
    context.closePath();
    context.fillStyle = powerGradient;
    context.fill();
    context.beginPath();
    points.forEach((point, index) => {
      const xx = x(point.tSec);
      const yy = yPower(point.powerW);
      if (index === 0) context.moveTo(xx, yy);
      else context.lineTo(xx, yy);
    });
    context.strokeStyle = "#50dcd7";
    context.lineWidth = 1.8;
    context.stroke();

    context.beginPath();
    points.forEach((point, index) => {
      const xx = x(point.tSec);
      const yy = ySoc(point.socPct);
      if (index === 0) context.moveTo(xx, yy);
      else context.lineTo(xx, yy);
    });
    context.strokeStyle = "#f1b459";
    context.lineWidth = 1.5;
    context.stroke();
    const cursor = points[clamp(currentIndex, 0, points.length - 1)];
    context.strokeStyle = "rgba(255, 255, 255, 0.55)";
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(x(cursor.tSec), top);
    context.lineTo(x(cursor.tSec), top + plotHeight);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "rgba(203, 228, 228, 0.62)";
    context.fillText("POWER (W)", 7, 12);
    context.fillStyle = "#f1b459";
    context.fillText("SOC %", width - 37, 12);
  }, [currentIndex, points, size]);
  return <canvas ref={canvasRef} className="power-chart" aria-label="Power and battery state-of-charge timeline" />;
}

function NumberField({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={`number-field${disabled ? " is-disabled" : ""}`}>
      <span>{label}</span>
      <span className="input-shell">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => onChange(clamp(Number(event.target.value), min, max))}
        />
        <em>{unit}</em>
      </span>
    </label>
  );
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "warn" | "good" }) {
  return (
    <article className={`metric${tone ? ` metric-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function Segmented<T extends string>({
  value,
  options,
  labels,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={value === option ? "active" : ""}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

export default function SolarSizingDashboard() {
  const [mission, setMission] = useState(DEFAULT_MISSION);
  const [power, setPower] = useState(DEFAULT_POWER);
  const [viewMode, setViewMode] = useState<ViewMode>("ORBIT");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const result = useMemo(() => runSimulation(mission, power), [mission, power]);
  const current = result.points[clamp(currentIndex, 0, result.points.length - 1)];
  const bestAxis = result.axes.find((axis) => axis.rank === 1) ?? result.axes[0];
  const selectedAxis = result.axes.find((axis) => axis.axis === mission.deploymentAxis) ?? result.axes[0];
  const maxAxisEnergy = Math.max(...result.axes.map((axis) => axis.energyPerOrbitWh), 1);

  useEffect(() => {
    setCurrentIndex(0);
  }, [result]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setCurrentIndex((index) => (index + 1) % result.points.length);
    }, 90);
    return () => window.clearInterval(timer);
  }, [playing, result.points.length]);

  const updateMission = <K extends keyof MissionConfig>(key: K, value: MissionConfig[K]) => {
    setMission((currentMission) => ({ ...currentMission, [key]: value }));
  };
  const updatePower = <K extends keyof PowerConfig>(key: K, value: PowerConfig[K]) => {
    setPower((currentPower) => ({ ...currentPower, [key]: value }));
  };

  const choosePreset = (preset: OrbitPreset) => {
    setMission((currentMission) => ({
      ...currentMission,
      preset,
      altitudeKm: preset === "GEO" ? 35786 : preset === "SSO" ? 550 : 500,
      inclinationDeg: preset === "GEO" ? 0 : preset === "SSO" ? 97.6 : 51.6,
      attitude: preset === "GEO" ? "SUN_POINTING" : "LVLH",
    }));
  };

  const exportCsv = () => {
    const header = [
      "time_s", "x_eci_km", "y_eci_km", "z_eci_km", "power_w", "soc_pct",
      "beta_deg", "incidence_deg", "shadow_factor", "deployment_axis",
    ];
    const rows = result.points.map((point) => [
      point.tSec.toFixed(2), ...point.positionKm.map((value) => value.toFixed(5)),
      point.powerW.toFixed(3), point.socPct.toFixed(3), point.betaDeg.toFixed(4),
      point.incidenceDeg.toFixed(4), point.shadowFactor.toFixed(5), mission.deploymentAxis,
    ]);
    const csv = [header, ...rows].map((row) => row.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `orbit-pwr-${mission.preset.toLowerCase()}-${mission.deploymentAxis.toLowerCase()}-axis.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const marginPositive = result.metrics.energyMarginWh >= 0;
  const batteryHealthy = result.metrics.minSocPct >= 20;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div>
            <p>ORBIT·PWR</p>
            <span>Preliminary solar array sizing</span>
          </div>
        </div>
        <div className="topbar-status">
          <span className="model-chip"><i /> Analytical MVP</span>
          <span className="model-detail">Circular orbit · J2 drift · conical eclipse</span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="button-quiet" onClick={exportCsv}>Export CSV</button>
          <button type="button" className="button-primary" onClick={() => window.print()}>Print report</button>
        </div>
      </header>

      <div className="dashboard-grid">
        <aside className="control-rail">
          <section className="control-section">
            <div className="section-heading"><span>01</span><h2>Mission</h2></div>
            <Segmented
              value={mission.preset}
              options={["LEO", "SSO", "GEO"]}
              labels={{ LEO: "LEO", SSO: "SSO", GEO: "GEO" }}
              onChange={choosePreset}
              ariaLabel="Orbit preset"
            />
            <p className="preset-name">{PRESET_LABELS[mission.preset]}</p>
            <div className="field-grid">
              <NumberField
                label="Altitude"
                value={mission.preset === "GEO" ? 35786 : mission.altitudeKm}
                unit="km"
                min={160}
                max={50000}
                disabled={mission.preset === "GEO"}
                onChange={(value) => updateMission("altitudeKm", value)}
              />
              <NumberField
                label="Inclination"
                value={mission.preset === "GEO" ? 0 : mission.inclinationDeg}
                unit="deg"
                min={0}
                max={180}
                step={0.1}
                disabled={mission.preset === "GEO"}
                onChange={(value) => updateMission("inclinationDeg", value)}
              />
              {mission.preset === "SSO" ? (
                <NumberField label="LTAN" value={mission.ltanHours} unit="hr" min={0} max={24} step={0.25} onChange={(value) => updateMission("ltanHours", value)} />
              ) : (
                <NumberField label="RAAN" value={mission.raanDeg} unit="deg" min={0} max={360} step={1} onChange={(value) => updateMission("raanDeg", value)} />
              )}
              <NumberField label="Duration" value={mission.durationOrbits} unit="orbits" min={1} max={5} step={1} onChange={(value) => updateMission("durationOrbits", value)} />
            </div>
            <label className="date-field">
              <span>Mission epoch</span>
              <input type="datetime-local" value={mission.epoch} onChange={(event) => updateMission("epoch", event.target.value)} />
            </label>
          </section>

          <section className="control-section">
            <div className="section-heading"><span>02</span><h2>Attitude & array</h2></div>
            <label className="select-field">
              <span>Attitude law</span>
              <select value={mission.attitude} onChange={(event) => updateMission("attitude", event.target.value as AttitudeMode)}>
                {(Object.keys(ATTITUDE_LABELS) as AttitudeMode[]).map((mode) => (
                  <option value={mode} key={mode}>{ATTITUDE_LABELS[mode]}</option>
                ))}
              </select>
            </label>
            <div className="axis-control">
              <span>Panel hinge axis</span>
              <div role="group" aria-label="Panel deployment axis">
                {(["X", "Y", "Z"] as Axis[]).map((axis) => (
                  <button
                    type="button"
                    key={axis}
                    className={mission.deploymentAxis === axis ? "active" : ""}
                    aria-pressed={mission.deploymentAxis === axis}
                    onClick={() => updateMission("deploymentAxis", axis)}
                  >
                    <i className={`axis-dot axis-${axis.toLowerCase()}`} />
                    {axis}
                  </button>
                ))}
              </div>
            </div>
            <div className="field-grid">
              <NumberField label="Active area" value={power.activeAreaM2} unit="m²" min={0.05} max={100} step={0.1} onChange={(value) => updatePower("activeAreaM2", value)} />
              <NumberField label="Efficiency" value={power.efficiencyPct} unit="%" min={1} max={45} step={0.5} onChange={(value) => updatePower("efficiencyPct", value)} />
              <NumberField label="EOL factor" value={power.degradationPct} unit="%" min={10} max={100} step={1} onChange={(value) => updatePower("degradationPct", value)} />
              <NumberField label="System loss" value={power.systemLossPct} unit="%" min={0} max={60} step={1} onChange={(value) => updatePower("systemLossPct", value)} />
            </div>
          </section>

          <section className="control-section">
            <div className="section-heading"><span>03</span><h2>Power balance</h2></div>
            <div className="field-grid">
              <NumberField label="Average load" value={power.averageLoadW} unit="W" min={0} max={10000} step={10} onChange={(value) => updatePower("averageLoadW", value)} />
              <NumberField label="Battery" value={power.batteryWh} unit="Wh" min={1} max={10000} step={10} onChange={(value) => updatePower("batteryWh", value)} />
            </div>
            <label className="range-field">
              <span><b>Initial state of charge</b><em>{power.initialSocPct}%</em></span>
              <input type="range" min="10" max="100" step="1" value={power.initialSocPct} onChange={(event) => updatePower("initialSocPct", Number(event.target.value))} />
            </label>
          </section>
        </aside>

        <section className="workspace">
          <section className="visual-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">SIMULATION / {mission.preset}</span>
                <h1>Sun–array geometry</h1>
              </div>
              <Segmented
                value={viewMode}
                options={["ORBIT", "SPACECRAFT"]}
                labels={{ ORBIT: "Orbit view", SPACECRAFT: "Spacecraft view" }}
                onChange={setViewMode}
                ariaLabel="Simulation view"
              />
            </div>
            <div className="canvas-wrap">
              <OrbitCanvas points={result.points} currentIndex={currentIndex} mode={viewMode} />
              <div className="canvas-readout">
                <span><i className="sun-dot" /> Sunlit {Math.round(current.shadowFactor * 100)}%</span>
                <span>β {current.betaDeg.toFixed(1)}°</span>
                <span>θ {current.incidenceDeg.toFixed(1)}°</span>
              </div>
            </div>
            <div className="timeline-control">
              <button type="button" className="play-button" aria-label={playing ? "Pause simulation" : "Play simulation"} onClick={() => setPlaying((value) => !value)}>
                {playing ? "Ⅱ" : "▶"}
              </button>
              <input
                type="range"
                min="0"
                max={result.points.length - 1}
                value={currentIndex}
                aria-label="Simulation time"
                onChange={(event) => { setPlaying(false); setCurrentIndex(Number(event.target.value)); }}
              />
              <span>T+ {formatDuration(current.tSec)}</span>
              <span>{formatDuration(result.metrics.periodSec)} / orbit</span>
            </div>
          </section>

          <section className="metrics-grid" aria-live="polite">
            <Metric label="Power now" value={`${current.powerW.toFixed(0)} W`} note={`${current.incidenceDeg.toFixed(1)}° incidence`} tone={current.powerW > power.averageLoadW ? "good" : "warn"} />
            <Metric label="Orbit energy" value={`${result.metrics.energyPerOrbitWh.toFixed(0)} Wh`} note={`${result.metrics.averagePowerW.toFixed(0)} W average`} tone={marginPositive ? "good" : "warn"} />
            <Metric label="Eclipse / orbit" value={formatDuration(result.metrics.eclipsePerOrbitSec)} note="penumbra weighted" />
            <Metric label="Minimum battery" value={`${result.metrics.minSocPct.toFixed(0)}%`} note={`${result.metrics.finalSocPct.toFixed(0)}% final SOC`} tone={batteryHealthy ? "good" : "warn"} />
          </section>

          <section className="analysis-grid">
            <article className="chart-card">
              <div className="card-heading">
                <div><span className="eyebrow">POWER PROFILE</span><h2>Generation & battery</h2></div>
                <div className="chart-legend"><span><i className="power-key" /> Power</span><span><i className="soc-key" /> SOC</span></div>
              </div>
              <PowerChart points={result.points} currentIndex={currentIndex} />
            </article>

            <article className="axis-card">
              <div className="card-heading">
                <div><span className="eyebrow">DESIGN SWEEP</span><h2>Deployment axis</h2></div>
                <span className="recommended-tag">Best: {bestAxis.axis}-axis</span>
              </div>
              <div className="axis-bars">
                {[...result.axes].sort((a, b) => a.axis.localeCompare(b.axis)).map((axis) => (
                  <button type="button" key={axis.axis} onClick={() => updateMission("deploymentAxis", axis.axis)} className={mission.deploymentAxis === axis.axis ? "selected" : ""}>
                    <span className="bar-label"><b>{axis.axis}</b><em>#{axis.rank}</em></span>
                    <span className="bar-track"><i style={{ width: `${((axis.energyPerOrbitWh / maxAxisEnergy) * 100).toFixed(3)}%` }} /></span>
                    <span className="bar-value"><b>{axis.energyPerOrbitWh.toFixed(0)} Wh</b><em>{axis.averagePowerW.toFixed(0)} W avg</em></span>
                  </button>
                ))}
              </div>
              <div className="axis-verdict">
                <span className="verdict-icon">↗</span>
                <p>
                  <b>{bestAxis.axis}-axis produces {((bestAxis.energyPerOrbitWh / selectedAxis.energyPerOrbitWh - 1) * 100).toFixed(1)}% more energy</b>
                  <span>than the selected {mission.deploymentAxis}-axis for this mission and attitude.</span>
                </p>
              </div>
            </article>
          </section>

          <section className="engineering-strip">
            <div><span>Effective RAAN</span><b>{result.effectiveRaanDeg.toFixed(2)}°</b></div>
            <div><span>J2 RAAN drift</span><b>{result.metrics.raanRateDegDay.toFixed(3)}°/day</b></div>
            <div><span>Beta range</span><b>{result.metrics.betaMinDeg.toFixed(1)}° to {result.metrics.betaMaxDeg.toFixed(1)}°</b></div>
            <div><span>Energy margin</span><b className={marginPositive ? "positive" : "negative"}>{result.metrics.energyMarginWh >= 0 ? "+" : ""}{result.metrics.energyMarginWh.toFixed(0)} Wh</b></div>
            <div><span>Peak array power</span><b>{result.metrics.peakPowerW.toFixed(0)} W</b></div>
          </section>

          {(!marginPositive || !batteryHealthy) && (
            <aside className="design-alert" role="alert">
              <b>Design check required.</b>
              <span>{!marginPositive ? "Generated energy is below mission load. " : ""}{!batteryHealthy ? "Battery reserve falls below 20%." : ""}</span>
            </aside>
          )}

          <footer className="model-note">
            <span>MODEL SCOPE</span>
            <p>
              Preliminary design only. Circular two-body propagation with secular J2 RAAN drift, analytical Sun position,
              spherical-Earth conical eclipse and ideal single-axis solar tracking. Thermal coupling, self-shadowing,
              eccentricity, detailed electrical strings and radiation environment are intentionally excluded from this MVP.
            </p>
          </footer>
        </section>
      </div>
    </main>
  );
}

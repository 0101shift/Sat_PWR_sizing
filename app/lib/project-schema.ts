import { isSatelliteInventoryItem, type SatelliteInventoryItem } from "./satellite-inventory";
import type { MissionConfig, PowerConfig, SignedAxis } from "./orbit-model";

export const ORBIT_PWR_PROJECT_SCHEMA = "orbit-pwr-project/v1";
export const ORBIT_PWR_PROJECT_SPACECRAFT_SCHEMA = "orbit-pwr-project-spacecraft/v1";
export const ORBIT_PWR_MAX_LOAD_SCHEMA = "orbit-pwr-dil-max-loads/v1";

export type ProjectPlotVisibility = {
  raw?: boolean;
  primary: boolean;
  modeled: boolean;
  perfect: boolean;
  load: boolean;
  soc: boolean;
};

export type OrbitPwrProjectDocument = {
  schema: typeof ORBIT_PWR_PROJECT_SCHEMA;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  dashboard: {
    mission: MissionConfig;
    power: PowerConfig;
    engineeringView: "ORBIT" | "POWER";
    playbackSpeed: number;
    plotVisibility: ProjectPlotVisibility;
    dil: {
      sampleIntervalSec: string;
      referenceAxisOverride: "AUTO" | SignedAxis;
      sourceFileName?: string;
    };
  };
};

export type OrbitPwrProjectSpacecraftDocument = {
  schema: typeof ORBIT_PWR_PROJECT_SPACECRAFT_SCHEMA;
  simulation: SatelliteInventoryItem;
  deployed: SatelliteInventoryItem;
};

export type OrbitPwrMaxLoadDocument = {
  schema: typeof ORBIT_PWR_MAX_LOAD_SCHEMA;
  loadsW: Record<string, number>;
};

export type OrbitPwrDilSource = {
  fileName: string;
  content: string;
};

export type OrbitPwrProjectBundle = {
  project: OrbitPwrProjectDocument;
  spacecraft: OrbitPwrProjectSpacecraftDocument;
  maxLoads: OrbitPwrMaxLoadDocument;
  dilSource?: OrbitPwrDilSource;
};

export type OrbitPwrProjectSummary = Pick<
  OrbitPwrProjectDocument,
  "id" | "name" | "description" | "createdAt" | "updatedAt"
> & {
  spacecraftName: string;
  hasDil: boolean;
  maxLoadCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function projectIdFromName(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return slug || "orbit-pwr-project";
}

export function isSafeProjectId(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value);
}

export function isOrbitPwrProjectDocument(value: unknown): value is OrbitPwrProjectDocument {
  if (!isRecord(value) || value.schema !== ORBIT_PWR_PROJECT_SCHEMA) return false;
  if (typeof value.id !== "string" || !isSafeProjectId(value.id)) return false;
  if (typeof value.name !== "string" || value.name.trim().length === 0 || value.name.length > 120) return false;
  if (typeof value.description !== "string" || value.description.length > 1000) return false;
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return false;
  if (!isRecord(value.dashboard)) return false;
  const dashboard = value.dashboard;
  if (!isRecord(dashboard.mission) || !isRecord(dashboard.power) || !isRecord(dashboard.plotVisibility) || !isRecord(dashboard.dil)) return false;
  if (dashboard.engineeringView !== "ORBIT" && dashboard.engineeringView !== "POWER") return false;
  if (typeof dashboard.playbackSpeed !== "number" || !Number.isFinite(dashboard.playbackSpeed) || dashboard.playbackSpeed <= 0) return false;
  const visibility = dashboard.plotVisibility;
  if (!["primary", "modeled", "perfect", "load", "soc"].every((key) => typeof visibility[key] === "boolean")) return false;
  if (visibility.raw !== undefined && typeof visibility.raw !== "boolean") return false;
  if (typeof dashboard.dil.sampleIntervalSec !== "string") return false;
  if (typeof dashboard.dil.referenceAxisOverride !== "string") return false;
  if (dashboard.dil.sourceFileName !== undefined && typeof dashboard.dil.sourceFileName !== "string") return false;
  return true;
}

export function isOrbitPwrProjectSpacecraftDocument(value: unknown): value is OrbitPwrProjectSpacecraftDocument {
  return isRecord(value)
    && value.schema === ORBIT_PWR_PROJECT_SPACECRAFT_SCHEMA
    && isSatelliteInventoryItem(value.simulation)
    && isSatelliteInventoryItem(value.deployed);
}

export function isOrbitPwrMaxLoadDocument(value: unknown): value is OrbitPwrMaxLoadDocument {
  if (!isRecord(value) || value.schema !== ORBIT_PWR_MAX_LOAD_SCHEMA || !isRecord(value.loadsW)) return false;
  return Object.entries(value.loadsW).every(([key, load]) => (
    key.length > 0
    && key.length <= 240
    && typeof load === "number"
    && Number.isFinite(load)
    && load >= 0
  ));
}

export function isOrbitPwrProjectBundle(value: unknown): value is OrbitPwrProjectBundle {
  if (!isRecord(value)) return false;
  if (!isOrbitPwrProjectDocument(value.project)) return false;
  if (!isOrbitPwrProjectSpacecraftDocument(value.spacecraft)) return false;
  if (!isOrbitPwrMaxLoadDocument(value.maxLoads)) return false;
  if (value.dilSource === undefined) return true;
  return isRecord(value.dilSource)
    && typeof value.dilSource.fileName === "string"
    && value.dilSource.fileName.length > 0
    && value.dilSource.fileName.length <= 240
    && typeof value.dilSource.content === "string";
}

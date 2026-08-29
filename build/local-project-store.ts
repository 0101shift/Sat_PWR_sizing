import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import {
  ORBIT_PWR_MAX_LOAD_SCHEMA,
  isOrbitPwrMaxLoadDocument,
  isOrbitPwrProjectBundle,
  isOrbitPwrProjectDocument,
  isOrbitPwrProjectSpacecraftDocument,
  isSafeProjectId,
  type OrbitPwrDilSource,
  type OrbitPwrProjectBundle,
  type OrbitPwrProjectSummary,
} from "../app/lib/project-schema";

export const LOCAL_PROJECTS_DIRECTORY = "Orbit_PWR_Projects";

function assertSafeProjectId(projectId: string) {
  if (!isSafeProjectId(projectId)) throw new Error("Invalid project identifier.");
}

function projectDirectory(root: string, projectId: string) {
  assertSafeProjectId(projectId);
  const projectsRoot = resolve(root, LOCAL_PROJECTS_DIRECTORY);
  const candidate = resolve(projectsRoot, projectId);
  if (!candidate.startsWith(`${projectsRoot}${sep}`)) throw new Error("Project path escapes the project workspace.");
  return candidate;
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function atomicWrite(path: string, content: string) {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rm(path, { force: true });
  await rename(temporaryPath, path);
}

function dilExtension(fileName: string) {
  const extension = extname(basename(fileName)).toLowerCase();
  return extension === ".json" || extension === ".tsv" ? extension : ".csv";
}

export async function listLocalProjects(root: string): Promise<OrbitPwrProjectSummary[]> {
  const projectsRoot = resolve(root, LOCAL_PROJECTS_DIRECTORY);
  await mkdir(projectsRoot, { recursive: true });
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  const summaries = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    try {
      const directory = projectDirectory(root, entry.name);
      const project = await readJson(resolve(directory, "project.json"));
      const spacecraft = await readJson(resolve(directory, "spacecraft.json"));
      const loadsPath = resolve(directory, "dil", "max-loads.json");
      const maxLoads = await exists(loadsPath)
        ? await readJson(loadsPath)
        : { schema: ORBIT_PWR_MAX_LOAD_SCHEMA, loadsW: {} };
      if (!isOrbitPwrProjectDocument(project) || !isOrbitPwrProjectSpacecraftDocument(spacecraft) || !isOrbitPwrMaxLoadDocument(maxLoads)) return null;
      return {
        id: project.id,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        spacecraftName: spacecraft.deployed.name,
        hasDil: Boolean(project.dashboard.dil.sourceFileName),
        maxLoadCount: Object.keys(maxLoads.loadsW).length,
      } satisfies OrbitPwrProjectSummary;
    } catch {
      return null;
    }
  }));
  return summaries
    .filter((summary): summary is OrbitPwrProjectSummary => summary !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function loadLocalProject(root: string, projectId: string): Promise<OrbitPwrProjectBundle> {
  const directory = projectDirectory(root, projectId);
  const project = await readJson(resolve(directory, "project.json"));
  const spacecraft = await readJson(resolve(directory, "spacecraft.json"));
  const maxLoadsPath = resolve(directory, "dil", "max-loads.json");
  const maxLoads = await exists(maxLoadsPath)
    ? await readJson(maxLoadsPath)
    : { schema: ORBIT_PWR_MAX_LOAD_SCHEMA, loadsW: {} };
  if (!isOrbitPwrProjectDocument(project) || project.id !== projectId) throw new Error("Project configuration is invalid.");
  if (!isOrbitPwrProjectSpacecraftDocument(spacecraft)) throw new Error("Project spacecraft snapshot is invalid.");
  if (!isOrbitPwrMaxLoadDocument(maxLoads)) throw new Error("Project DIL maximum-load data is invalid.");

  let dilSource: OrbitPwrDilSource | undefined;
  if (project.dashboard.dil.sourceFileName) {
    const sourcePath = resolve(directory, "dil", `source${dilExtension(project.dashboard.dil.sourceFileName)}`);
    dilSource = {
      fileName: project.dashboard.dil.sourceFileName,
      content: await readFile(sourcePath, "utf8"),
    };
  }
  return { project, spacecraft, maxLoads, dilSource };
}

export async function saveLocalProject(root: string, bundle: OrbitPwrProjectBundle) {
  if (!isOrbitPwrProjectBundle(bundle)) throw new Error("Project payload is invalid.");
  const directory = projectDirectory(root, bundle.project.id);
  const dilDirectory = resolve(directory, "dil");
  await mkdir(dilDirectory, { recursive: true });

  if (bundle.dilSource) {
    const sourceExtension = dilExtension(bundle.dilSource.fileName);
    await atomicWrite(resolve(dilDirectory, `source${sourceExtension}`), bundle.dilSource.content);
    for (const extension of [".csv", ".tsv", ".json"]) {
      if (extension !== sourceExtension) await rm(resolve(dilDirectory, `source${extension}`), { force: true });
    }
  } else {
    await Promise.all([".csv", ".tsv", ".json"].map((extension) => rm(resolve(dilDirectory, `source${extension}`), { force: true })));
  }

  await atomicWrite(resolve(directory, "spacecraft.json"), `${JSON.stringify(bundle.spacecraft, null, 2)}\n`);
  await atomicWrite(resolve(dilDirectory, "max-loads.json"), `${JSON.stringify(bundle.maxLoads, null, 2)}\n`);
  // Write project.json last so a listed project always points at complete companion files.
  await atomicWrite(resolve(directory, "project.json"), `${JSON.stringify(bundle.project, null, 2)}\n`);
  return loadLocalProject(root, bundle.project.id);
}

export async function renameLocalProject(root: string, fromId: string, toId: string, name: string, description: string) {
  assertSafeProjectId(fromId);
  assertSafeProjectId(toId);
  if (!name.trim() || name.length > 120) throw new Error("Project name is required and must be 120 characters or fewer.");
  if (description.length > 1000) throw new Error("Project description must be 1000 characters or fewer.");
  const source = projectDirectory(root, fromId);
  const destination = projectDirectory(root, toId);
  if (fromId !== toId && await exists(destination)) throw new Error("A project with that name already exists.");
  const bundle = await loadLocalProject(root, fromId);
  if (fromId !== toId) await rename(source, destination);
  bundle.project.id = toId;
  bundle.project.name = name.trim();
  bundle.project.description = description.trim();
  bundle.project.updatedAt = new Date().toISOString();
  return saveLocalProject(root, bundle);
}

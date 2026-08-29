import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { isOrbitPwrProjectBundle } from "../app/lib/project-schema";
import { listLocalProjects, loadLocalProject, renameLocalProject, saveLocalProject } from "./local-project-store";

const API_PATH = "/api/local-projects";
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_REQUEST_BYTES) throw new Error("Project payload exceeds the 64 MB local limit.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export function localProjects(): Plugin {
  let root = process.cwd();
  return {
    name: "orbit-pwr-local-projects",
    apply: "serve",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url) return next();
        const url = new URL(request.url, "http://localhost");
        if (url.pathname !== API_PATH) return next();
        try {
          if (request.method === "GET") {
            const projectId = url.searchParams.get("id");
            return sendJson(response, 200, projectId
              ? { project: await loadLocalProject(root, projectId) }
              : { projects: await listLocalProjects(root) });
          }
          if (request.method === "POST") {
            const body = await readJsonBody(request);
            if (!isOrbitPwrProjectBundle(body)) return sendJson(response, 400, { error: "Project payload is invalid." });
            return sendJson(response, 200, { project: await saveLocalProject(root, body) });
          }
          if (request.method === "PATCH") {
            const body = await readJsonBody(request) as { fromId?: unknown; toId?: unknown; name?: unknown; description?: unknown };
            if (typeof body?.fromId !== "string" || typeof body.toId !== "string" || typeof body.name !== "string" || typeof body.description !== "string") {
              return sendJson(response, 400, { error: "Rename request is invalid." });
            }
            return sendJson(response, 200, { project: await renameLocalProject(root, body.fromId, body.toId, body.name, body.description) });
          }
          response.setHeader("Allow", "GET, POST, PATCH");
          return sendJson(response, 405, { error: "Method not allowed." });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Local project operation failed.";
          return sendJson(response, 400, { error: message });
        }
      });
    },
  };
}

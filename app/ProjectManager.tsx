"use client";

import { useEffect, useState } from "react";
import type { OrbitPwrProjectSummary } from "./lib/project-schema";

export default function ProjectManager({
  open,
  projects,
  activeProject,
  dirty,
  busy,
  notice,
  onClose,
  onRefresh,
  onCreate,
  onOpen,
  onSave,
  onRename,
}: {
  open: boolean;
  projects: OrbitPwrProjectSummary[];
  activeProject: OrbitPwrProjectSummary | null;
  dirty: boolean;
  busy: boolean;
  notice: string;
  onClose: () => void;
  onRefresh: () => void;
  onCreate: (name: string, description: string) => void;
  onOpen: (projectId: string) => void;
  onSave: () => void;
  onRename: (name: string, description: string) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    const syncTimer = window.setTimeout(() => {
      setSelectedId(activeProject?.id ?? projects[0]?.id ?? "");
      setEditName(activeProject?.name ?? "");
      setEditDescription(activeProject?.description ?? "");
    }, 0);
    return () => window.clearTimeout(syncTimer);
  }, [activeProject, open, projects]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;
  const selected = projects.find((project) => project.id === selectedId) ?? null;

  return (
    <div className="project-manager-backdrop">
      <button type="button" className="project-manager-dismiss" aria-label="Close project manager window" onClick={onClose} />
      <section className="project-manager-window" role="dialog" aria-modal="true" aria-labelledby="project-manager-title">
        <header>
          <div>
            <span>LOCAL PROJECT WORKSPACE</span>
            <h2 id="project-manager-title">Projects</h2>
            <p>Mission, power, spacecraft, DIL source and maximum-load data are saved together.</p>
          </div>
          <button type="button" onClick={onClose}>Close ×</button>
        </header>

        <div className="project-manager-body">
          <section className="project-list-panel">
            <div className="project-panel-title">
              <div><small>PROJECT TREE</small><strong>{projects.length} saved</strong></div>
              <button type="button" onClick={onRefresh} disabled={busy}>Refresh</button>
            </div>
            <div className="project-list" role="listbox" aria-label="Saved projects">
              {projects.length === 0 && <p>No projects saved yet. Create one from the current dashboard configuration.</p>}
              {projects.map((project) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={project.id === selectedId}
                  className={project.id === selectedId ? "selected" : ""}
                  key={project.id}
                  onClick={() => setSelectedId(project.id)}
                >
                  <span><b>{project.name}</b>{project.id === activeProject?.id && <em>{dirty ? "UNSAVED" : "ACTIVE"}</em>}</span>
                  <small>{project.spacecraftName} · {project.hasDil ? "DIL" : "Analytical"} · {project.maxLoadCount} max loads</small>
                  <time>{new Date(project.updatedAt).toLocaleString()}</time>
                </button>
              ))}
            </div>
            <button type="button" className="project-open-button" disabled={!selected || busy} onClick={() => selected && onOpen(selected.id)}>Open selected project</button>
          </section>

          <section className="project-editor-panel">
            <div className="project-editor-section">
              <small>CREATE / SAVE AS</small>
              <h3>New project from current dashboard</h3>
              <label><span>Project name</span><input value={newName} maxLength={120} onChange={(event) => setNewName(event.target.value)} placeholder="Mission or study name" /></label>
              <label><span>Description</span><textarea value={newDescription} maxLength={1000} rows={3} onChange={(event) => setNewDescription(event.target.value)} placeholder="Optional scope or revision note" /></label>
              <button type="button" className="project-primary-button" disabled={!newName.trim() || busy} onClick={() => onCreate(newName, newDescription)}>Create project</button>
            </div>

            <div className="project-editor-section">
              <small>ACTIVE PROJECT</small>
              <h3>{activeProject?.name ?? "No project open"}</h3>
              <label><span>Project name</span><input value={editName} maxLength={120} disabled={!activeProject || busy} onChange={(event) => setEditName(event.target.value)} /></label>
              <label><span>Description</span><textarea value={editDescription} maxLength={1000} rows={3} disabled={!activeProject || busy} onChange={(event) => setEditDescription(event.target.value)} /></label>
              <div className="project-edit-actions">
                <button type="button" disabled={!activeProject || !editName.trim() || busy} onClick={() => onRename(editName, editDescription)}>Save project details</button>
                <button type="button" className="project-primary-button" disabled={!activeProject || busy} onClick={onSave}>{dirty ? "Save changes" : "Save project"}</button>
              </div>
            </div>
          </section>
        </div>

        <footer>
          <span aria-live="polite">{busy ? "Working…" : notice}</span>
          <code>Orbit_PWR_Projects/{activeProject?.id ?? "project-name"}/</code>
        </footer>
      </section>
    </div>
  );
}

import type { Project } from '../lib/models';
export function groupProjectLocations(projects: Project[], currentId?: string) {
  const groups = new Map<string, { id: string; project: Project; locations: string[] }>();
  for (const project of projects) {
    const id = project.logicalId ?? project.id;
    const group = groups.get(id);
    if (group) { group.locations.push(project.id); if (project.id === currentId) group.project = project; }
    else groups.set(id, { id, project, locations: [project.id] });
  }
  return [...groups.values()];
}

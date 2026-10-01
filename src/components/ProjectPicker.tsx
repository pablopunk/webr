import { Folder } from 'lucide-react';
import type { Project } from '../lib/models';
import { ComposerCombobox } from './ComposerCombobox';
import { ProjectIcon } from './ProjectIcon';

export function ProjectPicker({ projects, projectId, onChange }: {
  projects: Project[]; projectId: string; onChange: (id: string) => void;
}) {
  return <ComposerCombobox label="Project" value={projectId} onChange={onChange} icon={<Folder size={14} />}
    options={projects.map((project) => ({ value: project.id, label: project.name, icon: <ProjectIcon key={project.id} project={project} /> }))} />;
}

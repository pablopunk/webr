import { Folder, Plus } from 'lucide-react';
import type { Project } from '../lib/models';
import { ComposerCombobox } from './ComposerCombobox';
import { ProjectIcon } from './ProjectIcon';

export function ProjectPicker({ projects, projectId, onChange, onAddProject }: {
  projects: Project[]; projectId: string; onChange: (id: string) => void; onAddProject?: () => void;
}) {
  return <ComposerCombobox label="Project" value={projectId} onChange={onChange} icon={<Folder size={14} />}
    action={onAddProject ? { label: 'Add project', icon: <Plus size={14} />, onClick: onAddProject } : undefined}
    options={projects.map((project) => ({ value: project.id, label: project.name, icon: <ProjectIcon key={project.id} project={project} /> }))} />;
}

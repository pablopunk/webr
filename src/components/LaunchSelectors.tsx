import { Cpu, Monitor, TerminalSquare } from 'lucide-react';
import type { Project } from '../lib/models';
import type { Machine } from '../lib/machines';
import { ComposerCombobox } from './ComposerCombobox';
import { ProjectPicker } from './ProjectPicker';

export function LaunchSelectors({ machine, machines, projects, projectId, harness, model, onMachineChange, onProjectChange, onHarnessChange, onModelChange }: {
  machine: Machine; machines: Machine[]; projects: Project[]; projectId: string; harness: string; model: string;
  onMachineChange: (id: string) => void; onProjectChange: (id: string) => void;
  onHarnessChange: (id: string) => void; onModelChange: (model: string) => void;
}) {
  const models = machine.harnesses.find((choice) => choice.id === harness)?.models ?? [];
  return <div className="composer-selectors">
    <ComposerCombobox label="Machine" value={machine.id} onChange={onMachineChange} icon={<Monitor size={14} />}
      options={machines.map((choice) => ({ value: choice.id, label: `${choice.name}${choice.connected ? '' : ' · Not connected'}`, shortLabel: choice.name, disabled: !choice.connected }))} />
    <ProjectPicker key={machine.id} projects={projects} projectId={projectId} onChange={onProjectChange} />
    <ComposerCombobox label="Harness" value={harness} onChange={onHarnessChange} icon={<TerminalSquare size={14} />}
      options={machine.harnesses.map((choice) => ({ value: choice.id, label: choice.name, shortLabel: choice.name === 'Claude Code' ? 'Claude' : choice.name }))} />
    <ComposerCombobox key={`${machine.id}:${harness}`} label="Model" value={model} onChange={onModelChange} icon={<Cpu size={14} />} allowCustom={machine.harnesses.find((choice) => choice.id === harness)?.customModels ?? false}
      options={models.map((name) => ({ value: name, label: name, shortLabel: name.split('/').at(-1) }))} />
  </div>;
}

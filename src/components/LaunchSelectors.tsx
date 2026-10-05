import { Cpu, Monitor, Server, TerminalSquare } from 'lucide-react';
import type { Project } from '../lib/models';
import type { Machine } from '../lib/machines';
import { ComposerCombobox } from './ComposerCombobox';
import { HarnessIcon } from './HarnessIcon';
import { OsIcon } from './OsIcon';
import { ProjectPicker } from './ProjectPicker';

const machineIcon = (machine: Machine) => machine.os ? <OsIcon os={machine.os} /> : machine.id === 'local' ? <Monitor size={14} /> : <Server size={14} />;

export function LaunchSelectors({ machine, machines, projects, projectId, harness, model, onMachineChange, onProjectChange, onHarnessChange, onModelChange, onAddProject }: {
  machine: Machine; machines: Machine[]; projects: Project[]; projectId: string; harness: string; model: string;
  onMachineChange: (id: string) => void; onProjectChange: (id: string) => void;
  onHarnessChange: (id: string) => void; onModelChange: (model: string) => void; onAddProject?: () => void;
}) {
  const models = machine.harnesses.find((choice) => choice.id === harness)?.models ?? [];
  return <div className="composer-selectors">
    <ComposerCombobox label="Machine" value={machine.id} onChange={onMachineChange} icon={machineIcon(machine)}
      options={machines.map((choice) => ({ icon: machineIcon(choice), value: choice.id, label: `${choice.name}${choice.connected ? '' : ' · Not connected'}`, shortLabel: choice.name, disabled: !choice.connected }))} />
    <ProjectPicker key={machine.id} projects={projects} projectId={projectId} onChange={onProjectChange} onAddProject={onAddProject} />
    <ComposerCombobox label="Harness" value={harness} onChange={onHarnessChange} icon={<TerminalSquare size={14} />}
      options={machine.harnesses.map((choice) => ({ value: choice.id, label: choice.name, shortLabel: choice.name === 'Claude Code' ? 'Claude' : choice.name, icon: <HarnessIcon harness={choice.id} /> }))} />
    <ComposerCombobox key={`${machine.id}:${harness}`} label="Model" value={model} onChange={onModelChange} icon={<Cpu size={14} />} allowCustom={machine.harnesses.find((choice) => choice.id === harness)?.customModels ?? false}
      options={models.map((name) => ({ value: name, label: name, shortLabel: name.split('/').at(-1) }))} />
  </div>;
}

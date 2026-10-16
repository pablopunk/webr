import { Monitor, Server, TerminalSquare } from 'lucide-react';
import type { Project } from '../lib/models';
import type { Machine } from '../lib/machines';
import { ComposerCombobox } from './ComposerCombobox';
import { HarnessIcon } from './HarnessIcon';
import { OsIcon } from './OsIcon';
import { ProjectPicker } from './ProjectPicker';

type CatalogState = { data?: Machine; isLoading: boolean; isRefetchError: boolean; isError: boolean };
const machineIcon = (machine: Machine) => machine.os ? <OsIcon os={machine.os} /> : machine.id === 'local' ? <Monitor size={14} /> : <Server size={14} />;

export function LaunchSelectors({ machine, machines, projects, projectId, harness, catalog, onMachineChange, onProjectChange, onHarnessChange, onAddProject }: {
  machine: Machine; machines: Machine[]; projects: Project[]; projectId: string; harness: string; catalog: CatalogState;
  onMachineChange: (id: string) => void; onProjectChange: (id: string) => void; onHarnessChange: (id: string) => void; onAddProject?: () => void;
}) {
  const harnesses = catalog.data?.harnesses ?? machine.harnesses;
  return <div className="composer-selectors">
    <ComposerCombobox label="Machine" value={machine.id} onChange={onMachineChange} icon={machineIcon(machine)}
      options={machines.map((choice) => ({ icon: machineIcon(choice), value: choice.id, label: `${choice.name}${choice.connected ? '' : ' · Not connected'}`, shortLabel: choice.name, disabled: !choice.connected }))} />
    <ProjectPicker key={machine.id} projects={projects} projectId={projectId} onChange={onProjectChange} onAddProject={onAddProject} />
    <ComposerCombobox label="Harness" value={harness} onChange={onHarnessChange} icon={<TerminalSquare size={14} />}
      options={harnesses.map((choice) => ({ value: choice.id, label: choice.reason ? `${choice.name} — ${choice.reason}` : choice.name, shortLabel: choice.name === 'Claude Code' ? 'Claude' : choice.name, icon: <HarnessIcon harness={choice.id} />, disabled: choice.launchEnabled === false }))}
      loading={catalog.isLoading && !catalog.data} refreshError={catalog.isRefetchError && !!catalog.data}
      emptyMessage={catalog.isError && !catalog.data ? 'Could not load harnesses.' : 'No harnesses available.'} />
  </div>;
}

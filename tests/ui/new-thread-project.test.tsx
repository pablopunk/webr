import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NewThreadView } from '../../src/components/NewThreadView';
import { buildPendingThreadUrl } from '../../src/client/navigation';

vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));
vi.mock('../../src/client/catalog', () => ({ useMachineCatalog: () => ({ data: { harnesses: [{ id: 'claude', name: 'Claude Code', models: ['Default'], launchEnabled: true }] }, isError: false }) }));

const projects = [
  { id: 'local:first', name: 'First', path: '/first', color: '#555', initial: 'F', metadataVersion: 0 },
  { id: 'local:second', name: 'Second', path: '/second', color: '#555', initial: 'S', metadataVersion: 0 },
];
const machines = [{ id: 'local', name: 'Local', connected: true, session: 'default', projectPaths: { 'local:first': '/first', 'local:second': '/second' }, harnesses: [] }];
const view = (selectedProjectId?: string) => <NewThreadView projects={projects} machines={machines} selectedProjectId={selectedProjectId} onOpenSidebar={() => {}} />;

afterEach(() => { cleanup(); localStorage.clear(); });

it('starts on the project it was opened for', () => {
  render(view('local:second'));
  expect(screen.getByRole('combobox', { name: /Project: Second/ })).toBeDefined();
});

it('preserves composer route state while moving immediately to a pending ticket', () => {
  expect(buildPendingThreadUrl('ticket-key', 'http://webr.local/new?project=local%3Asecond&sidebar=collapsed&recover=old'))
    .toBe('/new?project=local%3Asecond&sidebar=collapsed&pending=ticket-key');
});

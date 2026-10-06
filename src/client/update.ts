import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { UpdateStatus } from '../shared/update';
import { alertDialog, confirmDialog } from '../components/dialogs';

const CHECK_MS = 30 * 60 * 1000;
const POLL_MS = 2000;
const GIVE_UP_MS = 3 * 60 * 1000;

const fetchStatus = async (signal: AbortSignal) => {
  const response = await fetch('/api/update', { signal });
  if (!response.ok) throw new Error('Updates are not available.');
  return await response.json() as UpdateStatus;
};

const confirmationMessage = ({ current, latest }: UpdateStatus) => `Update Webr from ${current} to ${latest}? Webr restarts and this page reloads. Running agents keep working.`;

export function useUpdate() {
  const [updatingFrom, setUpdatingFrom] = useState<string>();
  const status = useQuery({ queryKey: ['update'], queryFn: ({ signal }) => fetchStatus(signal), refetchInterval: updatingFrom ? POLL_MS : CHECK_MS, refetchOnWindowFocus: !updatingFrom });
  const data = status.data;
  const stopWaiting = useCallback((message: string) => { setUpdatingFrom(undefined); void alertDialog(message); }, []);

  useEffect(() => {
    if (!updatingFrom || !data) return;
    if (data.current !== updatingFrom) window.location.reload();
    else if (data.state === 'failed') stopWaiting(data.error ?? 'The update failed.');
  }, [updatingFrom, data, stopWaiting]);

  useEffect(() => {
    if (!updatingFrom) return;
    const timer = setTimeout(() => stopWaiting('Webr did not come back after the update. Reload this page, or restart Herdr.'), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [updatingFrom, stopWaiting]);

  const requestUpdate = useCallback(async () => {
    if (!data || !await confirmDialog(confirmationMessage(data), { confirmLabel: 'Update' })) return;
    const response = await fetch('/api/update', { method: 'POST' }).catch(() => undefined);
    if (response?.status === 202) setUpdatingFrom(data.current);
    else await alertDialog('Webr could not start the update.');
  }, [data]);

  return { status: data, updating: !!updatingFrom, requestUpdate };
}

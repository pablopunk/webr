import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateStatus } from '../shared/update';
import { alertDialog, confirmDialog } from '../components/dialogs';

const CHECK_MS = 15 * 60 * 1000;
const POLL_MS = 2000;
const GIVE_UP_MS = 3 * 60 * 1000;

const fetchStatus = async (signal: AbortSignal) => {
  const response = await fetch('/api/update', { signal });
  if (!response.ok) throw new Error('Updates are not available.');
  return await response.json() as UpdateStatus;
};

const postCheck = async () => {
  const response = await fetch('/api/update/check', { method: 'POST' });
  if (!response.ok) throw new Error('Updates are not available.');
  return await response.json() as UpdateStatus;
};

const RESTART_POLL_MS = 500;
const restartConfirmation = 'Restart the Webr server? This page reloads and every open terminal reconnects. Running agents keep working.';
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const answers = async () => (await fetch('/api/update', { cache: 'no-store' }).catch(() => undefined))?.ok === true;

async function waitForServerToReturn() {
  let wentDown = false;
  for (const deadline = Date.now() + GIVE_UP_MS; Date.now() < deadline; await sleep(RESTART_POLL_MS)) {
    if (!await answers()) wentDown = true;
    else if (wentDown) return true;
  }
  return false;
}

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

  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const checkNow = useCallback(async () => {
    setChecking(true);
    try { queryClient.setQueryData(['update'], await postCheck()); } catch { await alertDialog('Webr could not check for updates.'); } finally { setChecking(false); }
  }, [queryClient]);

  const requestUpdate = useCallback(async () => {
    if (!data || !await confirmDialog(confirmationMessage(data), { confirmLabel: 'Update' })) return;
    const response = await fetch('/api/update', { method: 'POST' }).catch(() => undefined);
    if (response?.status === 202) setUpdatingFrom(data.current);
    else await alertDialog('Webr could not start the update.');
  }, [data]);

  const [restarting, setRestarting] = useState(false);
  const requestRestart = useCallback(async () => {
    if (!await confirmDialog(restartConfirmation, { confirmLabel: 'Restart', danger: true })) return;
    const response = await fetch('/api/restart', { method: 'POST' }).catch(() => undefined);
    if (response?.status !== 202) return void await alertDialog('Webr could not restart.');
    setRestarting(true);
    if (await waitForServerToReturn()) window.location.reload();
    else { setRestarting(false); await alertDialog('Webr did not come back. Reload this page, or restart Herdr.'); }
  }, []);

  return { status: data, updating: !!updatingFrom, checking, checkNow, requestUpdate, restarting, requestRestart };
}

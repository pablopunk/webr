import { useCallback, useEffect, useRef, useState } from 'react';
import { closeThreadPane, openThreadTerminal, PaneActionError } from './thread-actions';
import { canClosePane, paneToFocusAfterClosing } from '../lib/pane-strip';
import type { Pane, Thread } from '../lib/models';
import type { Projection } from '../shared/runtime';
import { event, perfAvailable, perfNow, time } from './perf';

export type PaneActionPhase = 'pending' | 'confirming' | 'awaiting' | 'uncertain' | 'confirmed';
export type PendingPaneSplit = {
  key: string;
  afterPaneId: string;
  paneId?: string;
  phase: PaneActionPhase;
  message: string;
  dismissed: boolean;
};
export type PendingPaneClose = {
  key: string;
  paneId: string;
  terminalId: string;
  paneTitle: string;
  phase: PaneActionPhase;
  message: string;
  dismissed: boolean;
};
export type PaneActionNotice = { message: string };

type PaneActionIdentity = {
  machineId: string;
  threadId: string;
  tabId: string;
  session: string;
  bindingFingerprint?: string;
  bindingConfigVersion?: number;
  identityKey: string;
  scope: string;
  routeKey: string;
  windowStart: number;
  panesAtStart: Pane[];
  attemptId?: string;
  startGeneration?: string;
  startRevision?: number;
};

const identityKey = (thread: Thread) => JSON.stringify([
  thread.machineId, thread.id, thread.tabId, thread.session, thread.bindingFingerprint, thread.bindingConfigVersion,
]);
const sameIdentity = (thread: Thread, identity: PaneActionIdentity) => thread.machineId === identity.machineId
  && thread.id === identity.threadId && thread.tabId === identity.tabId && thread.session === identity.session
  && thread.bindingFingerprint === identity.bindingFingerprint && thread.bindingConfigVersion === identity.bindingConfigVersion;
function actionThread(projection: Projection | undefined, identity: PaneActionIdentity) {
  if (!projection?.connected || !projection.freshAt || projection.machineId !== identity.machineId) return undefined;
  const thread = projection.threads.find((candidate) => candidate.id === identity.threadId);
  return thread && sameIdentity(thread, identity) && thread.bindingState === 'attached' ? thread : undefined;
}
function confirmedNativePane(projection: Projection | undefined, identity: PaneActionIdentity, paneId: string) {
  const thread = actionThread(projection, identity);
  if (!thread) return undefined;
  const matches = thread.panes.filter((pane) => pane.id === paneId && typeof pane.terminalId === 'string' && !!pane.terminalId);
  const nativeIdentities = thread.panes.filter((pane) => pane.id === paneId || pane.terminalId === matches[0]?.terminalId);
  return matches.length === 1 && nativeIdentities.length === 1 ? { thread, pane: matches[0]! } : undefined;
}
function paneKey(kind: 'split' | 'close', identity: PaneActionIdentity, terminalId: string) {
  return JSON.stringify([kind, identity.machineId, identity.session, terminalId]);
}

export function usePendingPaneActions({ thread, projection, routeKey, scope, focusedPane, windowStart, focusPane, confirmClose }: {
  thread?: Thread;
  projection?: Projection;
  routeKey: string;
  scope: string;
  focusedPane: string;
  windowStart: number;
  focusPane: (scope: string, paneId: string) => void;
  confirmClose: (message: string) => Promise<boolean>;
}) {
  const [splits, setSplits] = useState<(PendingPaneSplit & PaneActionIdentity)[]>([]);
  const [closes, setCloses] = useState<(PendingPaneClose & PaneActionIdentity)[]>([]);
  const [notice, setNotice] = useState<(PaneActionNotice & { identityKey: string }) | undefined>();
  const locks = useRef(new Set<string>());
  const current = useRef({ projection, routeKey, focusedPane });
  current.current = { projection, routeKey, focusedPane };
  const attemptCounter = useRef(0);
  const settledCloseAttempts = useRef(new Set<string>());
  const closeTimings = useRef(new Map<string, { start: number; httpStart: number }>());
  useEffect(() => () => { closeTimings.current.clear(); }, []);

  const makeIdentity = useCallback((currentThread: Thread): PaneActionIdentity => ({
    machineId: currentThread.machineId,
    threadId: currentThread.id,
    tabId: currentThread.tabId,
    session: currentThread.session,
    ...(currentThread.bindingFingerprint === undefined ? {} : { bindingFingerprint: currentThread.bindingFingerprint }),
    ...(currentThread.bindingConfigVersion === undefined ? {} : { bindingConfigVersion: currentThread.bindingConfigVersion }),
    identityKey: identityKey(currentThread), scope, routeKey, windowStart,
    panesAtStart: [...currentThread.panes],
  }), [scope, routeKey, windowStart]);

  const focusAfterClose = useCallback((entry: PaneActionIdentity & PendingPaneClose, confirmedThread?: Thread) => {
    const live = current.current;
    if (live.routeKey !== entry.routeKey || live.focusedPane !== entry.paneId) return;
    const candidate = paneToFocusAfterClosing(entry.panesAtStart, entry.windowStart, entry.paneId);
    const next = candidate && confirmedThread?.panes.some((pane) => pane.id === candidate.id)
      ? candidate.id
      : confirmedThread?.panes[0]?.id ?? candidate?.id;
    if (next && next !== entry.paneId) focusPane(entry.scope, next);
  }, [focusPane]);

  const removeSplit = useCallback((key: string) => {
    setSplits((items) => items.filter((item) => item.key !== key));
    locks.current.delete(key);
  }, []);
  const removeClose = useCallback((key: string) => {
    setCloses((items) => items.filter((item) => item.key !== key));
    locks.current.delete(key);
  }, []);

  useEffect(() => {
    for (const split of splits) {
      if (!split.paneId || split.phase === 'pending') continue;
      const confirmed = confirmedNativePane(projection, split, split.paneId);
      if (!confirmed) continue;
      removeSplit(split.key);
      const live = current.current;
      if (live.routeKey === split.routeKey && live.focusedPane === split.afterPaneId) focusPane(split.scope, confirmed.pane.id);
    }
    for (const close of closes) {
      if (close.phase !== 'pending' && close.phase !== 'confirming' && close.phase !== 'uncertain' && close.phase !== 'confirmed') continue;
      const confirmed = actionThread(projection, close);
      if (!confirmed) continue;
      // Generation-aware freshness: a later accepted, connected, fresh
      // projection in the same generation with a newer revision. Never compare
      // revisions across generations and never settle on generation change.
      if (close.startGeneration !== undefined) {
        if (!projection || projection.generation !== close.startGeneration) continue;
        if (typeof projection.revision !== 'number' || typeof close.startRevision !== 'number' || !(projection.revision > close.startRevision)) continue;
      }
      if (confirmed.panes.some((pane) => pane.id === close.paneId || pane.terminalId === close.terminalId)) continue;
      // Fresh scoped absence of both native pane ID and terminal ID is
      // authoritative evidence, not optimistic deletion. Collapse promptly even
      // when the HTTP promise remains unresolved.
      const settledKey = close.attemptId ? `${close.key}:${close.attemptId}` : close.key;
      if (close.attemptId) {
        settledCloseAttempts.current.add(settledKey);
        if (settledCloseAttempts.current.size > 100) {
          const oldest = settledCloseAttempts.current.values().next().value;
          if (oldest) settledCloseAttempts.current.delete(oldest);
        }
      }
      if (perfAvailable) {
        const timing = close.attemptId ? closeTimings.current.get(settledKey) : undefined;
        if (timing) {
          time('pane.close.clickToAbsenceMs', perfNow() - timing.start);
          event('pane.close.absenceSettled', { ...(close.attemptId ? { closeId: close.attemptId } : {}), via: 'observation' });
          closeTimings.current.delete(settledKey);
        } else {
          event('pane.close.absenceSettled', { ...(close.attemptId ? { closeId: close.attemptId } : {}), via: 'observation' });
        }
      }
      removeClose(close.key);
      if (close.phase !== 'confirmed') focusAfterClose(close, confirmed);
    }
  }, [projection, splits, closes, focusPane, focusAfterClose, removeSplit, removeClose]);

  const openTerminal = useCallback((paneId?: string) => {
    if (!thread || thread.bindingState !== 'attached') return;
    const sourcePaneId = paneId ?? focusedPane;
    const sourcePane = thread.panes.find((pane) => pane.id === sourcePaneId && !!pane.terminalId);
    if (!sourcePane?.terminalId) return;
    const identity = makeIdentity(thread);
    const key = paneKey('split', identity, sourcePane.terminalId);
    if (locks.current.has(key)) {
      if (!splits.some((item) => item.key === key && item.identityKey === identity.identityKey && !item.dismissed)) setNotice({ identityKey: identity.identityKey, message: 'A previous split on this terminal is unresolved. Webr did not retry it.' });
      return;
    }
    locks.current.add(key);
    setNotice(undefined);
    const pending: PendingPaneSplit & PaneActionIdentity = {
      ...identity, key, afterPaneId: sourcePaneId, phase: 'pending', message: 'Creating terminal pane…', dismissed: false,
    };
    setSplits((items) => items.some((item) => item.key === key) ? items : [...items, pending]);

    void openThreadTerminal(thread, sourcePaneId).then(({ paneId: returnedPaneId }) => {
      const confirmed = confirmedNativePane(current.current.projection, identity, returnedPaneId);
      if (confirmed) {
        removeSplit(key);
        const live = current.current;
        if (live.routeKey === identity.routeKey && live.focusedPane === sourcePaneId) focusPane(identity.scope, returnedPaneId);
        return;
      }
      setSplits((items) => items.map((item) => item.key === key
        ? { ...item, paneId: returnedPaneId, phase: 'awaiting', message: 'Waiting for the new pane to appear in a fresh snapshot…' }
        : item));
    }).catch((error: unknown) => {
      if (error instanceof PaneActionError && !error.outcomeUncertain) {
        removeSplit(key);
        setNotice({ identityKey: identity.identityKey, message: error.message });
        return;
      }
      setSplits((items) => items.map((item) => item.key === key
        ? { ...item, phase: 'uncertain', message: 'Split outcome is uncertain. Webr did not retry it.' }
        : item));
    });
  }, [thread, focusedPane, makeIdentity, removeSplit, focusPane, splits]);

  const closePane = useCallback((paneId = focusedPane) => {
    if (!thread || thread.bindingState !== 'attached' || !canClosePane(thread, paneId)) return;
    const pane = thread.panes.find((item) => item.id === paneId && !!item.terminalId);
    if (!pane?.terminalId) return;
    const baseIdentity = makeIdentity(thread);
    const attemptId = `close-${++attemptCounter.current}`;
    const liveProjection = current.current.projection;
    const startGeneration = liveProjection && liveProjection.machineId === thread.machineId ? liveProjection.generation : undefined;
    const startRevision = liveProjection && liveProjection.machineId === thread.machineId ? liveProjection.revision : undefined;
    const identity: PaneActionIdentity = {
      ...baseIdentity,
      attemptId,
      ...(typeof startGeneration === 'string' && Number.isSafeInteger(startRevision) ? { startGeneration, startRevision: startRevision as number } : {}),
    };
    const key = paneKey('close', identity, pane.terminalId);
    if (locks.current.has(key)) {
      if (!closes.some((item) => item.key === key && item.identityKey === identity.identityKey && !item.dismissed)) setNotice({ identityKey: identity.identityKey, message: 'A previous close on this terminal is unresolved. Webr did not retry it.' });
      return;
    }
    locks.current.add(key);
    setNotice(undefined);
    const pending: PendingPaneClose & PaneActionIdentity = {
      ...identity, key, paneId, terminalId: pane.terminalId, paneTitle: pane.title, phase: 'pending', message: `Closing ${pane.title}…`, dismissed: false,
    };
    setCloses((items) => items.some((item) => item.key === key) ? items : [...items, pending]);

    const settledKey = `${key}:${attemptId}`;
    const isSettled = () => settledCloseAttempts.current.has(settledKey);
    if (perfAvailable) {
      const now = perfNow();
      closeTimings.current.set(settledKey, { start: now, httpStart: now });
      event('pane.close.start', { closeId: attemptId });
      time('pane.close.clickToFeedbackMs', perfNow() - now);
    }

    const finish = (result: { closed: boolean; busy: boolean }, forced: boolean): Promise<void> => {
      if (isSettled()) return Promise.resolve();
      if (perfAvailable) {
        const timing = closeTimings.current.get(settledKey);
        if (timing) {
          time('pane.close.httpMs', perfNow() - timing.httpStart);
          event('pane.close.httpSettled', { closeId: attemptId, closed: result.closed, busy: result.busy, forced });
        }
      }
      if (result.closed) {
        const liveThread = actionThread(current.current.projection, identity);
        setCloses((items) => items.map((item) => item.key === key && (!item.attemptId || item.attemptId === attemptId)
          ? { ...item, phase: 'confirmed', message: `${pane.title} closed.` }
          : item));
        focusAfterClose(pending, liveThread);
        return Promise.resolve();
      }
      if (result.busy && !forced) {
        setCloses((items) => items.map((item) => item.key === key && (!item.attemptId || item.attemptId === attemptId)
          ? { ...item, phase: 'confirming', message: `${pane.title} is running a process.` }
          : item));
        return confirmClose(`${pane.title} is running a process. Close it anyway?`).then((confirmed) => {
          if (isSettled()) return;
          if (!confirmed) {
            if (perfAvailable) closeTimings.current.delete(settledKey);
            removeClose(key); return;
          }
          if (perfAvailable) {
            const timing = closeTimings.current.get(settledKey);
            if (timing) timing.httpStart = perfNow();
          }
          setCloses((items) => items.map((item) => item.key === key && (!item.attemptId || item.attemptId === attemptId)
            ? { ...item, phase: 'pending', message: `Closing ${pane.title}…` }
            : item));
          return closeThreadPane(thread, paneId, true).then((forcedResult) => finish(forcedResult, true));
        }, () => {
          if (isSettled()) return;
          if (perfAvailable) closeTimings.current.delete(settledKey);
          removeClose(key);
          setNotice({ identityKey: identity.identityKey, message: 'Close confirmation was interrupted; the pane was left open.' });
        });
      }
      if (perfAvailable) closeTimings.current.delete(settledKey);
      removeClose(key);
      setNotice({ identityKey: identity.identityKey, message: forced ? 'Herdr could not confirm that the pane closed.' : 'The pane could not be closed.' });
      return Promise.resolve();
    };

    void closeThreadPane(thread, paneId, false).then((result) => finish(result, false)).catch((error: unknown) => {
      if (isSettled()) return;
      if (error instanceof PaneActionError && !error.outcomeUncertain) {
        if (perfAvailable) closeTimings.current.delete(settledKey);
        removeClose(key);
        setNotice({ identityKey: identity.identityKey, message: error.message });
        return;
      }
      if (perfAvailable) {
        const timing = closeTimings.current.get(settledKey);
        if (timing) {
          time('pane.close.httpMs', perfNow() - timing.httpStart);
          event('pane.close.httpSettled', { closeId: attemptId, uncertain: true });
        }
      }
      setCloses((items) => items.map((item) => item.key === key && (!item.attemptId || item.attemptId === attemptId)
        ? { ...item, phase: 'uncertain', message: `Close outcome is uncertain. ${pane.title} remains visible; Webr did not retry it.` }
        : item));
    });
  }, [thread, focusedPane, makeIdentity, confirmClose, removeClose, focusAfterClose, closes]);

  const dismissSplit = useCallback((key: string) => {
    setSplits((items) => items.map((item) => item.key === key ? { ...item, dismissed: true } : item));
  }, []);
  const dismissClose = useCallback((key: string) => {
    setCloses((items) => items.map((item) => item.key === key ? { ...item, dismissed: true } : item));
  }, []);
  const dismissNotice = useCallback(() => setNotice(undefined), []);

  const visibleIdentityKey = thread ? identityKey(thread) : undefined;
  return {
    pendingSplits: visibleIdentityKey ? splits.filter((item) => item.identityKey === visibleIdentityKey && !item.dismissed) : [],
    pendingCloses: visibleIdentityKey ? closes.filter((item) => item.identityKey === visibleIdentityKey && !item.dismissed) : [],
    notice: notice?.identityKey === visibleIdentityKey ? notice : undefined,
    openTerminal,
    closePane,
    dismissSplit,
    dismissClose,
    dismissNotice,
  };
}

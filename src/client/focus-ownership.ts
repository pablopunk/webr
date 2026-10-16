const focusOwningContainers = '[role="dialog"], [role="alertdialog"], [data-recording="true"]';

export const focusRestsNowhere = () => document.activeElement === null || document.activeElement === document.body || document.activeElement === document.documentElement;

const terminalOwnsFocus = () => !!document.activeElement?.classList.contains('terminal-input-capture');

export const pressesAButtonWhileTerminalOwnsFocus = (target: EventTarget | null) => terminalOwnsFocus() && target instanceof Element && !!target.closest('button') && !target.closest(focusOwningContainers);

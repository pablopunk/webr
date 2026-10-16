const focusOwningContainers = '[role="dialog"], [role="alertdialog"], [data-recording="true"]';

export const focusRestsNowhere = () => document.activeElement === null || document.activeElement === document.body || document.activeElement === document.documentElement;

export const textIsSelectedOutsideTerminal = () => { const selection = document.getSelection(); return !!selection && !selection.isCollapsed && !(selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement)?.closest('.terminal-pane'); };

const terminalOwnsFocus = () => !!document.activeElement?.classList.contains('terminal-input-capture');

export const pressesAButtonWhileTerminalOwnsFocus = (target: EventTarget | null) => terminalOwnsFocus() && target instanceof Element && !!target.closest('button') && !target.closest(focusOwningContainers);

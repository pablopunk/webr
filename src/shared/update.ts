export type UpdateState = 'idle' | 'updating' | 'failed';

export type UpdateStatus = { current: string; latest: string; available: boolean; state: UpdateState; error?: string };

export type Updates = { status: () => UpdateStatus; start: () => UpdateStatus };

export const retryDelay = (attempt: number, random = Math.random) => Math.min(30_000, Math.round(Math.min(25_000, 1000 * 2 ** Math.min(attempt, 5)) * (0.8 + random() * 0.4)));

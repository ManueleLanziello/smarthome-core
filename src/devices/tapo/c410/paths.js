import { fileURLToPath } from 'node:url';

export const c410WorkerPath = () => fileURLToPath(new URL('./c410-worker.py', import.meta.url));
export const c410ProbePath = () => fileURLToPath(new URL('./c410-probe.py', import.meta.url));

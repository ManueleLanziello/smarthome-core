import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { c410ProbePath } from './paths.js';

const execFileAsync = promisify(execFile);

export class TapoCameraVerificationError extends Error {
  constructor(message, code = 'CAMERA_VERIFICATION_FAILED') {
    super(message);
    this.name = 'TapoCameraVerificationError';
    this.code = code;
  }
}

function findValue(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (keys.includes(key.toLowerCase()) && child) return child;
    const nested = findValue(child, keys);
    if (nested) return nested;
  }
  return null;
}

export async function verifyTapoC410({ ip }, {
  pythonPath,
  probePath = c410ProbePath(),
  env,
  execute = execFileAsync,
} = {}) {
  if (!pythonPath) throw new TapoCameraVerificationError('Python camera non configurato.', 'PYTHON_NOT_CONFIGURED');
  if (!ip?.trim()) throw new TapoCameraVerificationError('IP telecamera non configurato.', 'CAMERA_NOT_CONFIGURED');
  let stdout;
  try {
    ({ stdout } = await execute(pythonPath, [probePath, '--ip', ip.trim()], {
      env, timeout: 30_000, windowsHide: true,
    }));
  } catch (error) {
    throw new TapoCameraVerificationError('Verifica tecnica telecamera non riuscita.', error?.code || 'CAMERA_VERIFICATION_FAILED');
  }
  let report;
  try { report = JSON.parse(stdout); } catch { throw new TapoCameraVerificationError('Risposta probe telecamera non valida.', 'INVALID_PROBE_RESPONSE'); }
  if (!report.authentication) throw new TapoCameraVerificationError('Autenticazione telecamera non riuscita.', 'AUTHENTICATION_FAILED');
  return {
    model: findValue(report.device_info, ['device_model', 'model']),
    alias: findValue(report.device_info, ['alias', 'device_name', 'name']),
    mac: findValue(report.device_info, ['mac', 'mac_address']),
    protocol: report.transport || 'PyTapo HTTPS',
    online: true,
  };
}

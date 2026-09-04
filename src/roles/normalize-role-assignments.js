export const NO_ROLE = 'none';
const ROLE_PATTERN = /^[a-z][a-z0-9._-]*$/;

export class RoleAssignmentValidationError extends Error {
  constructor(message, code = 'INVALID_ROLE_ASSIGNMENTS') {
    super(message);
    this.name = 'RoleAssignmentValidationError';
    this.code = code;
  }
}

export function normalizeRoleAssignments(assignments, deviceIds) {
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
    throw new RoleAssignmentValidationError('Configurazione ruoli non valida.');
  }
  if (!Array.isArray(deviceIds)) {
    throw new RoleAssignmentValidationError('Elenco dispositivi non valido.', 'INVALID_DEVICE_IDS');
  }
  const normalized = {};
  const occupiedRoles = new Set();
  for (const deviceId of deviceIds) {
    const role = assignments[deviceId] ?? NO_ROLE;
    if (role !== NO_ROLE && (typeof role !== 'string' || !ROLE_PATTERN.test(role))) {
      throw new RoleAssignmentValidationError(`Ruolo non valido per ${deviceId}.`, 'INVALID_ROLE');
    }
    if (role !== NO_ROLE && occupiedRoles.has(role)) {
      throw new RoleAssignmentValidationError(`Ruolo assegnato più volte: ${role}.`, 'DUPLICATE_ROLE');
    }
    if (role !== NO_ROLE) occupiedRoles.add(role);
    normalized[deviceId] = role;
  }
  return normalized;
}

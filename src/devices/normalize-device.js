export const CONNECTION_TYPES = Object.freeze(['lan', 'cloud']);

export class DeviceValidationError extends Error {
  constructor(message, code = 'INVALID_DEVICE') {
    super(message);
    this.name = 'DeviceValidationError';
    this.code = code;
  }
}

function requiredText(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new DeviceValidationError(`${label} obbligatorio.`, `MISSING_${label.toUpperCase()}`);
  return normalized;
}

function optionalText(value) {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function plainObject(value, label) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DeviceValidationError(`${label} deve essere un oggetto.`, `INVALID_${label.toUpperCase()}`);
  }
  return structuredClone(value);
}

function normalizeCapabilities(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new DeviceValidationError('capabilities deve essere un array.', 'INVALID_CAPABILITIES');
  const capabilities = value.map((item) => requiredText(item, 'capability'));
  if (new Set(capabilities).size !== capabilities.length) {
    throw new DeviceValidationError('Capability duplicata.', 'DUPLICATE_CAPABILITY');
  }
  return capabilities;
}

export function normalizeDevice(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DeviceValidationError('Dispositivo non valido.');
  }
  if (Object.hasOwn(input, 'role')) {
    throw new DeviceValidationError('Il ruolo logico non appartiene al dispositivo fisico.', 'ROLE_MUST_BE_SEPARATE');
  }
  const connectionType = requiredText(input.connectionType, 'connectionType').toLowerCase();
  if (!CONNECTION_TYPES.includes(connectionType)) {
    throw new DeviceValidationError('Tipo di connessione non valido.', 'INVALID_CONNECTION_TYPE');
  }
  const verificationStatus = input.verificationStatus === 'verified' ? 'verified' : 'pending';
  return {
    id: requiredText(input.id, 'id'),
    alias: requiredText(input.alias, 'alias'),
    model: requiredText(input.model, 'model'),
    protocol: requiredText(input.protocol, 'protocol'),
    connectionType,
    ...(optionalText(input.manufacturer) ? { manufacturer: optionalText(input.manufacturer) } : {}),
    ...(optionalText(input.type) ? { type: optionalText(input.type) } : {}),
    identity: plainObject(input.identity, 'identity'),
    connection: plainObject(input.connection, 'connection'),
    capabilities: normalizeCapabilities(input.capabilities),
    metadata: plainObject(input.metadata, 'metadata'),
    configurationStatus: input.configurationStatus === 'complete' ? 'complete' : 'incomplete',
    verificationStatus,
    verifiedAt: verificationStatus === 'verified' ? input.verifiedAt || null : null,
  };
}

import { DeviceValidationError, normalizeDevice } from '../devices/normalize-device.js';

export const HARDWARE_REGISTRY_SCHEMA_VERSION = 1;

export class HardwareRegistryValidationError extends Error {
  constructor(message, code = 'INVALID_HARDWARE_REGISTRY') {
    super(message);
    this.name = 'HardwareRegistryValidationError';
    this.code = code;
  }
}

export function normalizeHardwareRegistry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HardwareRegistryValidationError('Registro hardware non valido.');
  }
  if (value.devices !== undefined && !Array.isArray(value.devices)) {
    throw new HardwareRegistryValidationError('devices deve essere un array.', 'INVALID_DEVICES');
  }
  let devices;
  try {
    devices = (value.devices || []).map(normalizeDevice);
  } catch (error) {
    if (error instanceof DeviceValidationError) {
      throw new HardwareRegistryValidationError(error.message, error.code);
    }
    throw error;
  }
  const ids = new Set();
  for (const device of devices) {
    if (ids.has(device.id)) {
      throw new HardwareRegistryValidationError('ID dispositivo duplicato.', 'DUPLICATE_DEVICE_ID');
    }
    ids.add(device.id);
  }
  return { version: HARDWARE_REGISTRY_SCHEMA_VERSION, devices };
}

export function validateHardwareRegistry(value) {
  return normalizeHardwareRegistry(value);
}

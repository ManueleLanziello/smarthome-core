export {
  CONNECTION_TYPES,
  DeviceValidationError,
  normalizeDevice,
} from './devices/normalize-device.js';
export {
  HARDWARE_REGISTRY_SCHEMA_VERSION,
  HardwareRegistryValidationError,
  normalizeHardwareRegistry,
  validateHardwareRegistry,
} from './registry/normalize-hardware-registry.js';
export {
  NO_ROLE,
  RoleAssignmentValidationError,
  normalizeRoleAssignments,
} from './roles/normalize-role-assignments.js';
export {
  TuyaCloudClient,
  TuyaCloudError,
} from './devices/tuya/tuya-cloud-client.js';
export {
  DewinTuyaAdapter,
  buildDewinMeasurementSnapshot,
  parseTuyaDatapoints,
} from './devices/tuya/dewin/dewin-adapter.js';
export {
  Wt200TuyaAdapter,
  buildWt200Snapshot,
  normalizeWt200Mode,
} from './devices/tuya/wt200/wt200-adapter.js';
export {
  Wt200TuyaLanAdapter,
  buildWt200LanSnapshot,
  encodeWt200WeekPattern,
  normalizeWt200HeatingActive,
  normalizeWt200WeekPattern,
  encodeWt200Schedule,
  parseWt200Schedule,
  wt200ScheduleGroups,
} from './devices/tuya/wt200/wt200-lan-adapter.js';

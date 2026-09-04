import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DewinTuyaAdapter,
  HARDWARE_REGISTRY_SCHEMA_VERSION,
  TuyaCloudClient,
  buildDewinMeasurementSnapshot,
  normalizeDevice,
  normalizeHardwareRegistry,
  normalizeRoleAssignments,
} from '../src/index.js';

const device = {
  id: 'living-room-sensor-1',
  alias: ' Sensore soggiorno ',
  manufacturer: 'Example',
  model: 'S-1',
  protocol: 'example-local',
  connectionType: 'LAN',
  identity: { serial: 'placeholder' },
  connection: {},
  capabilities: ['temperature'],
  metadata: {},
};

test('normalizza un dispositivo fisico senza ruolo logico', () => {
  const normalized = normalizeDevice(device);
  assert.equal(normalized.alias, 'Sensore soggiorno');
  assert.equal(normalized.connectionType, 'lan');
  assert.deepEqual(normalized.capabilities, ['temperature']);
  assert.throws(() => normalizeDevice({ ...device, role: 'home.light' }), { code: 'ROLE_MUST_BE_SEPARATE' });
});

test('normalizza il registry canonico e rifiuta ID duplicati', () => {
  const registry = normalizeHardwareRegistry({ devices: [device] });
  assert.equal(registry.version, HARDWARE_REGISTRY_SCHEMA_VERSION);
  assert.equal(registry.devices.length, 1);
  assert.throws(() => normalizeHardwareRegistry({ devices: [device, { ...device }] }), { code: 'DUPLICATE_DEVICE_ID' });
});

test('normalizza ruoli generici separati e ne mantiene l unicita', () => {
  assert.deepEqual(
    normalizeRoleAssignments({ 'living-room-sensor-1': 'home.room_sensor', 'pond-pump-1': 'pond.pump' }, ['living-room-sensor-1', 'pond-pump-1']),
    { 'living-room-sensor-1': 'home.room_sensor', 'pond-pump-1': 'pond.pump' },
  );
  assert.throws(
    () => normalizeRoleAssignments({ 'living-room-sensor-1': 'home.camera', 'pond-pump-1': 'home.camera' }, ['living-room-sensor-1', 'pond-pump-1']),
    { code: 'DUPLICATE_ROLE' },
  );
});

const dewinSpecification = {
  category: 'example_dewin_sensor',
  status: [
    { code: 'temp_current', type: 'Integer', name: 'Temperatura ambiente', values: '{"scale":1,"unit":"℃"}' },
    { code: 'humidity_value', type: 'Integer', name: 'Umidità', values: '{"scale":0,"unit":"%"}' },
    { code: 'temp_current_external', type: 'Integer', name: 'Sonda esterna', values: '{"scale":1,"unit":"℃"}' },
    { code: 'battery_state', type: 'Enum', name: 'Batteria', values: '{}' },
  ],
};

test('normalizza temperatura, umidita e sonda Dewin dai datapoint Tuya', () => {
  const snapshot = buildDewinMeasurementSnapshot({
    device: { id: 'example-device', online: true, name: 'Sensore esempio' },
    specification: dewinSpecification,
    statuses: [
      { code: 'temp_current', value: 234 },
      { code: 'humidity_value', value: 56 },
      { code: 'temp_current_external', value: 198 },
      { code: 'battery_state', value: 'high' },
    ],
    updatedAt: '2026-09-04T10:00:00.000Z',
  });
  assert.equal(snapshot.measurements.ambientTemperature.value, 23.4);
  assert.equal(snapshot.measurements.ambientTemperature.unit, '°C');
  assert.equal(snapshot.measurements.ambientHumidity.value, 56);
  assert.equal(snapshot.measurements.ambientHumidity.unit, '%');
  assert.equal(snapshot.measurements.externalProbeTemperature.value, 19.8);
  assert.equal(snapshot.measurements.batteryState.value, 'high');
});

test('gestisce datapoint Dewin mancanti o non validi senza inventare misure', () => {
  const snapshot = buildDewinMeasurementSnapshot({
    device: { id: 'example-device' },
    specification: { status: [{ code: 'temp_current', values: '{not-json' }] },
    statuses: [{ code: 'temp_current', value: 'invalid' }],
  });
  assert.equal(snapshot.measurements.ambientTemperature.value, 'invalid');
  assert.equal(snapshot.measurements.ambientTemperature.scale, null);
  assert.equal(snapshot.measurements.ambientHumidity, null);
  assert.equal(snapshot.measurements.externalProbeTemperature, null);
});

test('il client Tuya e l adapter Dewin eseguono soltanto GET quando viene chiamata read', async () => {
  const methods = [];
  const fetchImpl = async (url, options) => {
    methods.push(options.method);
    if (url.includes('grant_type=1')) return { ok: true, status: 200, json: async () => ({ success: true, result: { access_token: 'fixture-token', expire_time: 3600 } }) };
    if (url.includes('/specification')) return { ok: true, status: 200, json: async () => ({ success: true, result: dewinSpecification }) };
    if (url.includes('/status')) return { ok: true, status: 200, json: async () => ({ success: true, result: [{ code: 'temp_current', value: 210 }] }) };
    return { ok: true, status: 200, json: async () => ({ success: true, result: { id: 'example-device', online: true } }) };
  };
  const client = new TuyaCloudClient({ clientId: 'fixture-client', clientSecret: 'fixture-secret', deviceId: 'example-device', fetchImpl, randomUUID: () => 'fixture-nonce' });
  const adapter = new DewinTuyaAdapter({ client, now: () => '2026-09-04T10:00:00.000Z' });
  assert.equal(methods.length, 0);
  const snapshot = await adapter.read();
  assert.equal(snapshot.measurements.ambientTemperature.value, 21);
  assert.deepEqual(methods, ['GET', 'GET', 'GET', 'GET']);
});

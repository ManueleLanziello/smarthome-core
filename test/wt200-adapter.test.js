import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWt200Snapshot, normalizeWt200Mode, Wt200TuyaAdapter } from '../src/index.js';

const SCHEDULE_RAW = 'BgAAFAgAAA8LEgAPDRwADxEAABYWAAAPBgAAFBYAAA8=';

function status(code, value) {
  return { code, value };
}

const statuses = [
  status('switch', true),
  status('temp_set', 315),
  status('temp_current', 278),
  status('mode', 'home'),
  status('child_lock', false),
  status('fault', 0),
  status('upper_temp', 60),
  status('temp_correction', -10),
  status('frost', false),
  status('sound', true),
];

test('normalizza il WT200: temperature, mode e status principali', () => {
  const snapshot = buildWt200Snapshot({
    device: { id: 'wt200-1', online: true, name: 'Temp-3', category: 'wk' },
    statuses,
    updatedAt: '2026-09-07T10:00:00.000Z',
  });

  assert.equal(snapshot.thermostat.currentTemperature, 27.8);
  assert.equal(snapshot.thermostat.setpointTemperature, 31.5);
  assert.equal(snapshot.thermostat.temperatureCorrection, -1);
  assert.equal(snapshot.thermostat.upperTemperatureLimit, 60);
  assert.equal(snapshot.thermostat.mode, 'manual');
  assert.equal(snapshot.thermostat.enabled, true);
  assert.equal(snapshot.thermostat.childLock, false);
  assert.equal(snapshot.thermostat.fault, 0);
  assert.equal(snapshot.thermostat.frostProtection, false);
  assert.equal(snapshot.thermostat.sound, true);
  assert.deepEqual(snapshot.rawDatapoints, statuses);
});

test('normalizza tutti i mode WT200 osservati', () => {
  assert.equal(normalizeWt200Mode('home'), 'manual');
  assert.equal(normalizeWt200Mode('auto'), 'auto');
  assert.equal(normalizeWt200Mode('temporary'), 'temporary');
  assert.equal(normalizeWt200Mode('leave'), 'leave');
});

test('preserva un mode WT200 sconosciuto senza errore', () => {
  assert.equal(normalizeWt200Mode('future_mode'), 'future_mode');
});

test('adapter Cloud legge DP105/DP107 reali e conferma cambio modalita', async () => {
  let mode = '1';
  const issued = [];
  const client = {
    deviceId: 'wt200-1',
    async readDevice() { return { device: { id: 'wt200-1', online: true }, statuses, specification: {} }; },
    async readShadowProperties() {
      return [{ code: 'week_program3', value: SCHEDULE_RAW }, { code: 'work_days', value: mode }];
    },
    async issueProperties(value) { issued.push(value); if (value.work_days) mode = value.work_days; },
  };
  const adapter = new Wt200TuyaAdapter({ client });
  const before = await adapter.read();
  assert.equal(before.schedule.weekPattern, '5+2');
  const changed = await adapter.setWeekPattern('7');
  assert.equal(changed.schedule.weekPattern, '7');
  assert.deepEqual(issued, [{ work_days: '3' }]);
});

test('adapter Cloud encoda e rilegge DP105 prima di confermare', async () => {
  let raw = SCHEDULE_RAW;
  const client = {
    deviceId: 'wt200-1',
    async readDevice() { return { device: { id: 'wt200-1', online: true }, statuses, specification: {} }; },
    async readShadowProperties() { return [{ code: 'week_program3', value: raw }, { code: 'work_days', value: '3' }]; },
    async issueProperties(value) { raw = value.week_program3; },
  };
  const adapter = new Wt200TuyaAdapter({ client });
  const current = await adapter.readProgramming();
  const normalPeriods = [{ ...current.schedule.normalPeriods[0], minute: 5 }, ...current.schedule.normalPeriods.slice(1)];
  const confirmed = await adapter.writeSchedule({ weekPattern: '7', normalPeriods });
  assert.equal(confirmed.schedule.normalPeriods[0].minute, 5);
  assert.equal(confirmed.schedule.restDayPeriods.length, 2);
});

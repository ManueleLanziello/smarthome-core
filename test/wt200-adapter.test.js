import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWt200Snapshot, normalizeWt200Mode } from '../src/index.js';

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

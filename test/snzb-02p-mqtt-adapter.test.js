import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnzb02pPayload } from '../src/index.js';

test('SNZB-02P normalizza le misure e ignora calibration e OTA', () => {
  const snapshot = normalizeSnzb02pPayload({ temperature: 27.8, humidity: 49.9, battery: 100, linkquality: 192,
    temperature_calibration: 0, humidity_calibration: 0, update: { state: 'idle' } }, { updatedAt: '2026-09-16T12:00:00Z' });
  assert.deepEqual(snapshot, { temperature: 27.8, humidity: 49.9, battery: 100, linkQuality: 192,
    online: true, updatedAt: '2026-09-16T12:00:00Z', model: 'SONOFF SNZB-02P', protocol: 'Zigbee' });
});

test('SNZB-02P richiede temperatura e umidita, diagnostica opzionale', () => {
  assert.equal(normalizeSnzb02pPayload({ temperature: 20 }), null);
  assert.equal(normalizeSnzb02pPayload({ humidity: 50 }), null);
  const snapshot = normalizeSnzb02pPayload({ temperature: 20, humidity: 50 });
  assert.equal(snapshot.battery, null);
  assert.equal(snapshot.linkQuality, null);
});

test('SNZB-02P rifiuta valori non numerici e percentuali/LQI fuori intervallo', () => {
  for (const payload of [null, [], { temperature: '20', humidity: 50 }, { temperature: 20, humidity: '50' },
    { temperature: Infinity, humidity: 50 }, { temperature: 20, humidity: 101 },
    { temperature: 20, humidity: 50, battery: -1 }, { temperature: 20, humidity: 50, linkquality: 300 }]) {
    assert.equal(normalizeSnzb02pPayload(payload), null);
  }
});

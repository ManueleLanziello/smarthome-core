import assert from 'node:assert/strict';
import test from 'node:test';
import { CiarraTuyaLanAdapter, buildCiarraLanState } from '../src/index.js';

test('normalizza esclusivamente lo stato semantico CIARRA noto', () => {
  assert.deepEqual(buildCiarraLanState({
    rawDps: { 1: false, 2: '4', 6: false, 12: '0', 15: 163, 104: 'Level_1' },
    updatedAt: '2026-09-14T10:00:00.000Z',
  }), {
    online: true,
    power: false,
    fanSpeed: 4,
    light: 'level1',
    operatingStatus: 'off',
    updatedAt: '2026-09-14T10:00:00.000Z',
  });
  assert.deepEqual(buildCiarraLanState({ rawDps: { 1: true, 2: '0', 12: '2', 104: 'Level_2' } }), {
    online: true, power: true, fanSpeed: 0, light: 'level2', operatingStatus: 'on', updatedAt: null,
  });
});

function adapterFixture({ initial = { 1: false, 2: '3', 12: '0', 104: 'Turn_off' } } = {}) {
  const state = { ...initial };
  const writes = [];
  const devices = [];
  const waits = [];
  const adapter = new CiarraTuyaLanAdapter({
    deviceId: 'hood-test', ip: '127.0.0.1', localKey: 'fixture-key',
    now: () => '2026-09-14T10:00:00.000Z',
    wait: async milliseconds => { waits.push(milliseconds); },
    createDevice(options) {
      const device = {
        options, disconnected: false,
        async connect() {},
        async disconnect() { this.disconnected = true; },
        async get() { return { dps: { ...state } }; },
        async set(command) { writes.push(command); state[String(command.dps)] = command.set; },
      };
      devices.push(device);
      return device;
    },
  });
  return { adapter, devices, state, waits, writes };
}

test('GET usa Tuya 3.4, legge i DPS e chiude la sessione', async () => {
  const fixture = adapterFixture();
  const state = await fixture.adapter.getState();
  assert.equal(state.fanSpeed, 3);
  assert.equal(fixture.devices.length, 1);
  assert.equal(fixture.devices[0].options.version, '3.4');
  assert.equal(fixture.devices[0].options.issueGetOnConnect, false);
  assert.equal(fixture.devices[0].disconnected, true);
});

test('power, velocita e luce scrivono solo DP1/DP2/DP104 e verificano con una nuova sessione dopo 5 secondi', async () => {
  const fixture = adapterFixture();
  assert.equal((await fixture.adapter.setPower(true)).power, true);
  assert.equal((await fixture.adapter.setFanSpeed(2)).fanSpeed, 2);
  assert.equal((await fixture.adapter.setLight('level2')).light, 'level2');
  assert.deepEqual(fixture.writes, [
    { dps: 1, set: true },
    { dps: 2, set: '2' },
    { dps: 104, set: 'Level_2' },
  ]);
  assert.deepEqual(fixture.waits, [5000, 5000, 5000]);
  assert.equal(fixture.devices.length, 6);
  assert.equal(fixture.devices.every(device => device.disconnected), true);
  assert.equal(fixture.state['12'], '0');
});

test('validazione rigida rifiuta input non semantici prima di creare sessioni', async () => {
  const fixture = adapterFixture();
  await assert.rejects(fixture.adapter.setPower(1), TypeError);
  for (const speed of [-1, 1.5, 5, '2']) await assert.rejects(fixture.adapter.setFanSpeed(speed), TypeError);
  for (const light of ['Turn_off', 'on', 'level3', null]) await assert.rejects(fixture.adapter.setLight(light), TypeError);
  assert.equal(fixture.devices.length, 0);
  assert.equal(typeof fixture.adapter.setDp, 'undefined');
  assert.equal(typeof fixture.adapter.writeDp, 'undefined');
  assert.equal(typeof fixture.adapter.writeDps, 'undefined');
  assert.equal(typeof fixture.adapter.writeAndVerify, 'undefined');
  assert.equal(typeof fixture.adapter.withDevice, 'undefined');
});

test('mancata conferma del GET post-write produce errore senza retry aggressivi', async () => {
  let creations = 0;
  const adapter = new CiarraTuyaLanAdapter({
    deviceId: 'hood-test', ip: '127.0.0.1', localKey: 'fixture-key', wait: async () => {},
    createDevice: () => ({
      async connect() {}, async disconnect() {}, async set() {},
      async get() { return { dps: { 1: false, 2: '0', 12: '0', 104: 'Turn_off' } }; },
    }),
  });
  const originalFactory = adapter.createDevice;
  adapter.createDevice = options => { creations += 1; return originalFactory(options); };
  await assert.rejects(adapter.setPower(true), error => error.code === 'CIARRA_WRITE_NOT_CONFIRMED');
  assert.equal(creations, 2);
});

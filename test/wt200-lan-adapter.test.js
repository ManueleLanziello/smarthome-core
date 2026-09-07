import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Wt200TuyaLanAdapter,
  buildWt200LanSnapshot,
  normalizeWt200HeatingActive,
  normalizeWt200WeekPattern,
  encodeWt200Schedule,
  parseWt200Schedule,
} from '../src/index.js';

const SCHEDULE_RAW = 'BgAAFAgAAA8LEgAPDRwADxEAABYWAAAPBgAAFBYAAA8=';
const UPDATED_SCHEDULE_RAW = 'BgAAFAgAAA8LEgAPDR4ADxEAABYWAAAPBgAAFBYAAA8=';

test('normalizza DP5 attivo, inattivo e assente senza inferenze', () => {
  assert.equal(normalizeWt200HeatingActive('1'), true);
  assert.equal(normalizeWt200HeatingActive('0'), false);
  assert.equal(normalizeWt200HeatingActive(undefined), null);
});

test('parsa il payload DP105 reale in sei fasce normali e due di riposo', () => {
  const schedule = parseWt200Schedule(SCHEDULE_RAW);
  assert.equal(schedule.normalPeriods.length, 6);
  assert.equal(schedule.restDayPeriods.length, 2);
  assert.deepEqual(schedule.normalPeriods[3], { hour: 13, minute: 28, unknownByte: 0, temperature: 1.5 });
  assert.equal(schedule.normalPeriods[0].temperature, 2);
  assert.equal(schedule.normalPeriods[1].temperature, 1.5);
  assert.equal(schedule.normalPeriods[4].temperature, 2.2);
});

test('conserva DP107 raw e normalizza 1 come schema 5+2', () => {
  const snapshot = buildWt200LanSnapshot({
    deviceId: 'wt200-1',
    rawDps: { 5: '1', 107: '1' },
    scheduleRaw: SCHEDULE_RAW,
  });
  assert.equal(normalizeWt200WeekPattern('1'), '5+2');
  assert.equal(snapshot.heatingActive, true);
  assert.equal(snapshot.schedule.weekPattern, '5+2');
  assert.equal(snapshot.schedule.weekPatternRaw, '1');
  assert.equal(snapshot.schedule.raw, SCHEDULE_RAW);
});

test('gestisce in sicurezza un payload DP105 non valido', () => {
  assert.equal(parseWt200Schedule('not-base64'), null);
  assert.equal(buildWt200LanSnapshot({ rawDps: {}, scheduleRaw: 'not-base64' }).schedule, null);
});

test('encoda DP105 preservando byte3 e record invariati', () => {
  const original = Buffer.from(SCHEDULE_RAW, 'base64');
  const parsed = parseWt200Schedule(SCHEDULE_RAW);
  const raw = encodeWt200Schedule(SCHEDULE_RAW, {
    normalPeriods: [{ ...parsed.normalPeriods[0], hour: 7, temperature: 2.5 }, ...parsed.normalPeriods.slice(1)],
    restDayPeriods: parsed.restDayPeriods,
  });
  const result = Buffer.from(raw, 'base64');
  assert.equal(result.length, 32);
  assert.equal(result[2], original[2]);
  assert.equal(result[3], 25);
  assert.deepEqual([...result.slice(4)], [...original.slice(4)]);
  assert.throws(() => encodeWt200Schedule(SCHEDULE_RAW, { normalPeriods: [], restDayPeriods: [] }));
});

test('mantiene in memoria l ultimo DP105 ricevuto dagli eventi read-only', async () => {
  const listeners = new Map();
  const statuses = [
    { dps: { 5: '0', 107: '1' } },
    { dps: { 5: '0', 107: '1' } },
    { dps: { 5: '0', 107: '1' } },
  ];
  const fakeDevice = {
    on(event, listener) { listeners.set(event, listener); },
    async connect() {},
    async get() { return statuses.shift(); },
    async disconnect() {},
  };
  const adapter = new Wt200TuyaLanAdapter({
    deviceId: 'wt200-1',
    ip: '192.168.1.19',
    localKey: 'test-key',
    createDevice: () => fakeDevice,
  });
  await adapter.connect();

  const beforeSchedule = await adapter.read();
  assert.equal(beforeSchedule.schedule, null);

  listeners.get('dp-refresh')({ dps: { 105: SCHEDULE_RAW } });
  const cachedSchedule = await adapter.read();
  assert.equal(cachedSchedule.heatingActive, false);
  assert.equal(cachedSchedule.schedule.normalPeriods[3].minute, 28);
  assert.equal(cachedSchedule.schedule.weekPattern, '5+2');
  assert.equal(cachedSchedule.schedule.raw, SCHEDULE_RAW);

  listeners.get('data')({ dps: { 105: UPDATED_SCHEDULE_RAW } });
  const updatedSchedule = await adapter.read();
  assert.equal(updatedSchedule.schedule.normalPeriods[3].minute, 30);
  assert.equal(updatedSchedule.schedule.raw, UPDATED_SCHEDULE_RAW);
  await adapter.disconnect();
});

test('writeSchedule invia esclusivamente DP105 serializzato', async () => {
  const writes = [];
  const fakeDevice = {
    on() {}, async connect() {}, async disconnect() {},
    async set(value) { writes.push(value); },
  };
  const adapter = new Wt200TuyaLanAdapter({ deviceId: 'wt200-1', ip: '127.0.0.1', localKey: 'test', createDevice: () => fakeDevice });
  const schedule = parseWt200Schedule(SCHEDULE_RAW);
  await adapter.writeSchedule({ ...schedule, raw: SCHEDULE_RAW });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].dps, 105);
  assert.equal(Object.keys(writes[0]).length, 2);
});

test('setOperatingMode scrive solo DP4 con home o auto', async () => {
  const writes = [];
  const fake = { on() {}, async connect() {}, async disconnect() {}, async set(value) { writes.push(value); } };
  const adapter = new Wt200TuyaLanAdapter({ deviceId: 'wt200-1', ip: '127.0.0.1', localKey: 'test', createDevice: () => fake });
  await adapter.setOperatingMode('home');
  await adapter.setOperatingMode('auto');
  assert.deepEqual(writes, [{ dps: 4, set: 'home' }, { dps: 4, set: 'auto' }]);
  await assert.rejects(adapter.setOperatingMode('temporary'), /non consentita/);
});

test('setSetpointTemperature converte x10 e scrive solo DP2', async () => {
  const writes = [];
  const fake = { on() {}, async connect() {}, async disconnect() {}, async set(value) { writes.push(value); } };
  const adapter = new Wt200TuyaLanAdapter({ deviceId: 'wt200-1', ip: '127.0.0.1', localKey: 'test', createDevice: () => fake });
  for (const [value, raw] of [[0, 0], [20, 200], [20.5, 205], [30, 300]]) await adapter.setSetpointTemperature(value), assert.deepEqual(writes.at(-1), { dps: 2, set: raw });
  await assert.rejects(adapter.setSetpointTemperature(20.2));
  await assert.rejects(adapter.setSetpointTemperature(30.5));
});

test('dopo un write e disconnect riconnette una sola volta con un solo nuovo client', async () => {
  const devices = [];
  const listeners = new Map();
  const first = { on(event, listener) { listeners.set(event, listener); }, async connect() {}, async disconnect() {}, async set() { listeners.get('disconnected')(); } };
  const second = { on() {}, async connect() {}, async disconnect() {} };
  const adapter = new Wt200TuyaLanAdapter({ deviceId: 'wt200-1', ip: '127.0.0.1', localKey: 'test', createDevice: () => devices.length ? second : (devices.push(first), first) });
  const schedule = parseWt200Schedule(SCHEDULE_RAW);
  await adapter.writeSchedule({ ...schedule, raw: SCHEDULE_RAW });
  assert.equal(devices.length, 1);
  assert.equal(adapter.device, second);
});

test('reconnect fallito dopo write non crea loop o client concorrenti', async () => {
  let creations = 0;
  const listeners = new Map();
  const first = { on(event, listener) { listeners.set(event, listener); }, async connect() {}, async disconnect() {}, async set() { listeners.get('disconnected')(); } };
  const adapter = new Wt200TuyaLanAdapter({ deviceId: 'wt200-1', ip: '127.0.0.1', localKey: 'test', createDevice: () => (++creations === 1 ? first : { on() {}, async connect() { throw new Error('offline'); } }) });
  const schedule = parseWt200Schedule(SCHEDULE_RAW);
  await assert.rejects(adapter.writeSchedule({ ...schedule, raw: SCHEDULE_RAW }), /offline/);
  assert.equal(creations, 2);
  assert.equal(adapter.device, null);
});

test('lettura LAN bloccata scade, disconnette e libera la coda per una lettura successiva', async () => {
  let creations = 0;
  const first = { on() {}, async connect() {}, async disconnect() { this.disconnected = true; }, async get() { return new Promise(() => {}); } };
  const second = { on() {}, async connect() {}, async disconnect() {}, async get() { return { dps: { 5: '1', 107: '1' } }; } };
  const adapter = new Wt200TuyaLanAdapter({ deviceId: 'wt200-1', ip: '127.0.0.1', localKey: 'test', operationTimeoutMs: 5, createDevice: () => (++creations === 1 ? first : second) });
  await assert.rejects(adapter.read(), /Timeout operazione LAN WT200/);
  const snapshot = await adapter.read();
  assert.equal(first.disconnected, true);
  assert.equal(creations, 2);
  assert.equal(snapshot.heatingActive, true);
});

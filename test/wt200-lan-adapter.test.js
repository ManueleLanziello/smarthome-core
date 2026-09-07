import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Wt200TuyaLanAdapter,
  buildWt200LanSnapshot,
  normalizeWt200HeatingActive,
  normalizeWt200WeekPattern,
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

import TuyAPI from 'tuyapi';

const WT200_PROTOCOL_VERSION = '3.4';
const SCHEDULE_BYTE_LENGTH = 32;
const SCHEDULE_RECORD_LENGTH = 4;
const NORMAL_PERIOD_COUNT = 6;

function strictBase64Buffer(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    return null;
  }
  const buffer = Buffer.from(value, 'base64');
  return buffer.toString('base64') === value ? buffer : null;
}

export function normalizeWt200HeatingActive(rawValue) {
  if (rawValue === '1') return true;
  if (rawValue === '0') return false;
  return null;
}

export function normalizeWt200WeekPattern(rawValue) {
  return rawValue === '1' ? '5+2' : null;
}

export function parseWt200Schedule(rawValue) {
  const buffer = strictBase64Buffer(rawValue);
  if (!buffer || buffer.length !== SCHEDULE_BYTE_LENGTH) return null;

  const periods = [];
  for (let offset = 0; offset < buffer.length; offset += SCHEDULE_RECORD_LENGTH) {
    const hour = buffer[offset];
    const minute = buffer[offset + 1];
    if (hour > 23 || minute > 59) return null;
    periods.push({
      hour,
      minute,
      unknownByte: buffer[offset + 2],
      temperature: buffer[offset + 3] / 10,
    });
  }

  return {
    normalPeriods: periods.slice(0, NORMAL_PERIOD_COUNT),
    restDayPeriods: periods.slice(NORMAL_PERIOD_COUNT),
  };
}

export function buildWt200LanSnapshot({ deviceId, rawDps, scheduleRaw = null, updatedAt = null }) {
  const dps = rawDps && typeof rawDps === 'object' ? structuredClone(rawDps) : {};
  const parsedSchedule = parseWt200Schedule(scheduleRaw);

  return {
    deviceId: deviceId ?? null,
    heatingActive: normalizeWt200HeatingActive(dps['5']),
    rawDps: dps,
    schedule: parsedSchedule
      ? {
        weekPattern: normalizeWt200WeekPattern(dps['107']),
        weekPatternRaw: dps['107'] ?? null,
        ...parsedSchedule,
        raw: scheduleRaw,
      }
      : null,
    updatedAt,
  };
}

export class Wt200TuyaLanAdapter {
  constructor({ deviceId, ip, localKey, createDevice = (options) => new TuyAPI(options), now = () => new Date().toISOString() }) {
    if (!deviceId || !ip || !localKey) {
      throw new TypeError('deviceId, ip e localKey sono obbligatori per il client LAN WT200.');
    }
    this.deviceId = deviceId;
    this.ip = ip;
    this.localKey = localKey;
    this.createDevice = createDevice;
    this.now = now;
    this.device = null;
    this.rawDps = {};
    this.scheduleRaw = null;
  }

  async connect() {
    if (this.device) return;
    this.device = this.createDevice({
      id: this.deviceId,
      key: this.localKey,
      ip: this.ip,
      version: WT200_PROTOCOL_VERSION,
      issueGetOnConnect: false,
      issueRefreshOnConnect: false,
    });
    this.device.on('data', (payload) => this.capturePayload(payload));
    this.device.on('dp-refresh', (payload) => this.capturePayload(payload));
    await this.device.connect();
  }

  capturePayload(payload) {
    const dps = payload?.dps;
    if (!dps || typeof dps !== 'object') return;
    Object.assign(this.rawDps, dps);
    if (typeof dps['105'] === 'string') this.scheduleRaw = dps['105'];
  }

  async read() {
    await this.connect();
    const payload = await this.device.get({ schema: true });
    this.capturePayload(payload);
    return buildWt200LanSnapshot({
      deviceId: this.deviceId,
      rawDps: this.rawDps,
      scheduleRaw: this.scheduleRaw,
      updatedAt: this.now(),
    });
  }

  async disconnect() {
    if (!this.device) return;
    const device = this.device;
    this.device = null;
    await device.disconnect();
  }
}

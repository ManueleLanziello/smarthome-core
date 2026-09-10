import TuyAPI from 'tuyapi';

const WT200_PROTOCOL_VERSION = '3.4';
const SCHEDULE_BYTE_LENGTH = 32;
const SCHEDULE_RECORD_LENGTH = 4;
const NORMAL_PERIOD_COUNT = 6;
const OPERATING_MODES = new Set(['home', 'auto']);
const WEEK_PATTERN_BY_RAW = Object.freeze({ 0: 'Chiuso', 1: '5+2', 2: '6+1', 3: '7' });
const RAW_BY_WEEK_PATTERN = Object.freeze({ '5+2': '1', '6+1': '2', 7: '3' });
const DAYS_BY_WEEK_PATTERN = Object.freeze({
  '5+2': Object.freeze({ normalPeriods: [1, 2, 3, 4, 5], restDayPeriods: [6, 0] }),
  '6+1': Object.freeze({ normalPeriods: [1, 2, 3, 4, 5, 6], restDayPeriods: [0] }),
  7: Object.freeze({ normalPeriods: [1, 2, 3, 4, 5, 6, 0], restDayPeriods: [] }),
});

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
  return WEEK_PATTERN_BY_RAW[rawValue] ?? null;
}

export function encodeWt200WeekPattern(weekPattern) {
  const raw = RAW_BY_WEEK_PATTERN[weekPattern];
  if (!raw) throw new TypeError('Modalita settimanale WT200 non consentita.');
  return raw;
}

export function wt200ScheduleGroups(weekPattern, { normalPeriods, restDayPeriods }) {
  const days = DAYS_BY_WEEK_PATTERN[weekPattern];
  if (!days) return [];
  return [
    { key: 'normalPeriods', days: [...days.normalPeriods], periods: normalPeriods },
    ...(days.restDayPeriods.length ? [{ key: 'restDayPeriods', days: [...days.restDayPeriods], periods: restDayPeriods }] : []),
  ];
}

export function parseWt200Schedule(rawValue, weekPatternRaw = null) {
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

  const schedule = {
    normalPeriods: periods.slice(0, NORMAL_PERIOD_COUNT),
    restDayPeriods: periods.slice(NORMAL_PERIOD_COUNT),
  };
  const weekPattern = normalizeWt200WeekPattern(weekPatternRaw);
  return weekPattern && weekPattern !== 'Chiuso'
    ? { ...schedule, groups: wt200ScheduleGroups(weekPattern, schedule) }
    : schedule;
}

export function encodeWt200Schedule(rawValue, { weekPattern = null, normalPeriods, restDayPeriods }) {
  const buffer = strictBase64Buffer(rawValue);
  const parsed = parseWt200Schedule(rawValue);
  const effectiveRestPeriods = weekPattern === '7' && restDayPeriods === undefined ? parsed?.restDayPeriods : restDayPeriods;
  const periods = [...(normalPeriods || []), ...(effectiveRestPeriods || [])];
  if (!buffer || buffer.length !== SCHEDULE_BYTE_LENGTH || normalPeriods?.length !== 6 || effectiveRestPeriods?.length !== 2) {
    throw new TypeError('DP105 e fasce 6+2 validi sono obbligatori.');
  }
  if (weekPattern !== null) encodeWt200WeekPattern(weekPattern);
  for (const [index, period] of periods.entries()) {
    const temperatureRaw = Number(period?.temperature) * 10;
    if (!Number.isInteger(period?.hour) || period.hour < 0 || period.hour > 23
      || !Number.isInteger(period?.minute) || period.minute < 0 || period.minute > 59
      || !Number.isInteger(temperatureRaw) || temperatureRaw < 0 || temperatureRaw > 255) {
      throw new TypeError(`Fascia DP105 non valida al record ${index + 1}.`);
    }
    const offset = index * SCHEDULE_RECORD_LENGTH;
    buffer[offset] = period.hour;
    buffer[offset + 1] = period.minute;
    buffer[offset + 3] = temperatureRaw;
  }
  return buffer.toString('base64');
}

export function buildWt200LanSnapshot({ deviceId, rawDps, scheduleRaw = null, updatedAt = null }) {
  const dps = rawDps && typeof rawDps === 'object' ? structuredClone(rawDps) : {};
  const parsedSchedule = parseWt200Schedule(scheduleRaw, dps['107']);

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
  constructor({ deviceId, ip, localKey, createDevice = (options) => new TuyAPI(options), now = () => new Date().toISOString(), operationTimeoutMs = 3000 }) {
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
    this.operationQueue = Promise.resolve();
    this.operationTimeoutMs = operationTimeoutMs;
  }

  serialize(operation) {
    const execute = async () => {
      let timer;
      try {
        return await Promise.race([
          operation(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const error = new Error('Timeout operazione LAN WT200.');
              error.code = 'WT200_LAN_TIMEOUT';
              reject(error);
            }, this.operationTimeoutMs);
          }),
        ]);
      } catch (error) {
        if (error?.code === 'WT200_LAN_TIMEOUT') await this.disconnect();
        throw error;
      } finally {
        clearTimeout(timer);
      }
    };
    const next = this.operationQueue.then(execute, execute);
    this.operationQueue = next.catch(() => undefined);
    return next;
  }

  async connect() {
    if (this.device) return;
    const device = this.createDevice({
      id: this.deviceId,
      key: this.localKey,
      ip: this.ip,
      version: WT200_PROTOCOL_VERSION,
      issueGetOnConnect: false,
      issueRefreshOnConnect: false,
    });
    this.device = device;
    device.on('data', (payload) => this.capturePayload(payload));
    device.on('dp-refresh', (payload) => this.capturePayload(payload));
    const invalidate = () => {
      if (this.device === device) this.device = null;
    };
    device.on('disconnected', invalidate);
    device.on('error', invalidate);
    try {
      await device.connect();
    } catch (error) {
      invalidate();
      throw error;
    }
  }

  capturePayload(payload) {
    const dps = payload?.dps;
    if (!dps || typeof dps !== 'object') return;
    Object.assign(this.rawDps, dps);
    if (typeof dps['105'] === 'string') this.scheduleRaw = dps['105'];
  }

  async read() {
    return this.serialize(async () => {
      await this.connect();
      const payload = await this.device.get({ schema: true });
      this.capturePayload(payload);
      return buildWt200LanSnapshot({
        deviceId: this.deviceId,
        rawDps: this.rawDps,
        scheduleRaw: this.scheduleRaw,
        updatedAt: this.now(),
      });
    });
  }

  async writeSchedule({ weekPattern = normalizeWt200WeekPattern(this.rawDps['107']), normalPeriods, restDayPeriods, raw = this.scheduleRaw }) {
    return this.serialize(async () => {
      await this.connect();
      const scheduleRaw = encodeWt200Schedule(raw, { weekPattern, normalPeriods, restDayPeriods });
      const response = await this.device.set({ dps: 105, set: scheduleRaw });
      if (response?.dps?.['105'] !== undefined && response.dps['105'] !== scheduleRaw) {
        const error = new Error('Il WT200 non ha confermato la programmazione richiesta.');
        error.code = 'SCHEDULE_NOT_CONFIRMED';
        throw error;
      }
      this.scheduleRaw = scheduleRaw;
      this.rawDps['105'] = scheduleRaw;
      // WT200 can close the socket after a successful DP105 write. Reconnect once, only when that close was observed.
      if (!this.device) await this.connect();
      return buildWt200LanSnapshot({
        deviceId: this.deviceId,
        rawDps: this.rawDps,
        scheduleRaw,
        updatedAt: this.now(),
      });
    });
  }

  async setWeekPattern(weekPattern) {
    const raw = encodeWt200WeekPattern(weekPattern);
    return this.serialize(async () => {
      await this.connect();
      const response = await this.device.set({ dps: 107, set: raw });
      const confirmed = response?.dps?.['107'];
      if (confirmed !== undefined && confirmed !== raw) {
        const error = new Error('Il WT200 non ha confermato la modalita settimanale richiesta.');
        error.code = 'WEEK_PATTERN_NOT_CONFIRMED';
        throw error;
      }
      this.rawDps['107'] = raw;
      if (!this.device) await this.connect();
      const status = await this.device.get({ schema: true });
      this.capturePayload(status);
      if (this.rawDps['107'] !== raw) {
        const error = new Error('Il WT200 non ha confermato la modalita settimanale richiesta.');
        error.code = 'WEEK_PATTERN_NOT_CONFIRMED';
        throw error;
      }
      return buildWt200LanSnapshot({ deviceId: this.deviceId, rawDps: this.rawDps, scheduleRaw: this.scheduleRaw, updatedAt: this.now() });
    });
  }

  async setOperatingMode(mode) {
    if (!OPERATING_MODES.has(mode)) throw new TypeError('Modalita WT200 non consentita.');
    return this.serialize(async () => {
      await this.connect();
      await this.device.set({ dps: 4, set: mode });
      this.rawDps['4'] = mode;
      if (!this.device) await this.connect();
      return buildWt200LanSnapshot({ deviceId: this.deviceId, rawDps: this.rawDps, scheduleRaw: this.scheduleRaw, updatedAt: this.now() });
    });
  }

  async setSetpointTemperature(temperature) {
    const raw = Number(temperature) * 10;
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 30 || !Number.isInteger(raw) || raw % 5 !== 0) {
      throw new TypeError('Setpoint WT200 non valido.');
    }
    return this.serialize(async () => {
      await this.connect();
      await this.device.set({ dps: 2, set: raw });
      this.rawDps['2'] = raw;
      if (!this.device) await this.connect();
      return buildWt200LanSnapshot({ deviceId: this.deviceId, rawDps: this.rawDps, scheduleRaw: this.scheduleRaw, updatedAt: this.now() });
    });
  }

  async disconnect() {
    if (!this.device) return;
    const device = this.device;
    this.device = null;
    await device.disconnect();
  }
}

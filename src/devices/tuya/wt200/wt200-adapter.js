import {
  buildWt200LanSnapshot,
  encodeWt200Schedule,
  encodeWt200WeekPattern,
} from './wt200-lan-adapter.js';

const MODE_BY_RAW_VALUE = Object.freeze({
  home: 'manual',
  auto: 'auto',
  temporary: 'temporary',
  leave: 'leave',
});

function datapointValue(byCode, code) {
  return byCode.get(code)?.value ?? null;
}

function scaledTemperature(value, scale) {
  return typeof value === 'number' ? value / (10 ** scale) : value;
}

export function normalizeWt200Mode(rawMode) {
  return MODE_BY_RAW_VALUE[rawMode] ?? rawMode;
}

export function buildWt200Snapshot({ device, statuses, specification, updatedAt = null }) {
  const rawDatapoints = Array.isArray(statuses) ? structuredClone(statuses) : [];
  const byCode = new Map(rawDatapoints.map((datapoint) => [datapoint.code, datapoint]));
  const currentTemperature = datapointValue(byCode, 'temp_current');
  const setpointTemperature = datapointValue(byCode, 'temp_set');
  const temperatureCorrection = datapointValue(byCode, 'temp_correction');
  const upperTemperatureLimit = datapointValue(byCode, 'upper_temp');

  return {
    deviceId: device?.id ?? null,
    online: Boolean(device?.online),
    name: device?.name ?? null,
    category: device?.category ?? specification?.category ?? null,
    thermostat: {
      enabled: datapointValue(byCode, 'switch'),
      currentTemperature: scaledTemperature(currentTemperature, 1),
      setpointTemperature: scaledTemperature(setpointTemperature, 1),
      mode: normalizeWt200Mode(datapointValue(byCode, 'mode')),
      childLock: datapointValue(byCode, 'child_lock'),
      fault: datapointValue(byCode, 'fault'),
      upperTemperatureLimit: scaledTemperature(upperTemperatureLimit, 0),
      temperatureCorrection: scaledTemperature(temperatureCorrection, 1),
      frostProtection: datapointValue(byCode, 'frost'),
      sound: datapointValue(byCode, 'sound'),
    },
    rawDatapoints,
    updatedAt,
  };
}

export class Wt200TuyaAdapter {
  constructor({ client, now = () => new Date().toISOString() }) {
    if (!client || typeof client.readDevice !== 'function') {
      throw new TypeError('Il client Tuya read-only e obbligatorio.');
    }
    this.client = client;
    this.now = now;
  }

  async read() {
    const [{ device, statuses, specification }, programming] = await Promise.all([
      this.client.readDevice(),
      this.readProgramming().catch(() => null),
    ]);
    return {
      ...buildWt200Snapshot({ device, statuses, specification, updatedAt: this.now() }),
      ...(programming?.schedule ? { schedule: programming.schedule } : {}),
    };
  }

  async readProgramming() {
    if (typeof this.client.readShadowProperties !== 'function') return null;
    const properties = await this.client.readShadowProperties();
    const byCode = new Map(properties.map((property) => [property.code, property.value]));
    return buildWt200LanSnapshot({
      deviceId: this.client.deviceId,
      rawDps: { 107: byCode.get('work_days') },
      scheduleRaw: byCode.get('week_program3'),
      updatedAt: this.now(),
    });
  }

  async confirmProgramming(predicate) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const snapshot = await this.readProgramming();
      if (predicate(snapshot)) return snapshot;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }

  async writeSchedule({ weekPattern, normalPeriods, restDayPeriods, raw }) {
    if (typeof this.client.issueProperties !== 'function') throw new TypeError('Scrittura Tuya Cloud non disponibile.');
    const current = await this.readProgramming();
    const sourceRaw = current?.schedule?.raw || raw;
    const activePattern = weekPattern || current?.schedule?.weekPattern;
    const scheduleRaw = encodeWt200Schedule(sourceRaw, { weekPattern: activePattern, normalPeriods, restDayPeriods });
    await this.client.issueProperties({ week_program3: scheduleRaw });
    const confirmed = await this.confirmProgramming((snapshot) => snapshot?.schedule?.raw === scheduleRaw);
    if (!confirmed) {
      const error = new Error('Il WT200 non ha confermato la programmazione richiesta.');
      error.code = 'SCHEDULE_NOT_CONFIRMED';
      throw error;
    }
    return confirmed;
  }

  async setWeekPattern(weekPattern) {
    if (typeof this.client.issueProperties !== 'function') throw new TypeError('Scrittura Tuya Cloud non disponibile.');
    const raw = encodeWt200WeekPattern(weekPattern);
    await this.client.issueProperties({ work_days: raw });
    const confirmed = await this.confirmProgramming((snapshot) => snapshot?.schedule?.weekPattern === weekPattern);
    if (!confirmed) {
      const error = new Error('Il WT200 non ha confermato la modalita settimanale richiesta.');
      error.code = 'WEEK_PATTERN_NOT_CONFIRMED';
      throw error;
    }
    return confirmed;
  }
}

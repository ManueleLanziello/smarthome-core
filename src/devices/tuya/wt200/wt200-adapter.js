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
    const { device, statuses, specification } = await this.client.readDevice();
    return buildWt200Snapshot({ device, statuses, specification, updatedAt: this.now() });
  }
}

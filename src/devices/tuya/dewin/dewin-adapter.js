const NORMALIZED_CODES = Object.freeze({
  temp_current: 'ambientTemperature',
  humidity_value: 'ambientHumidity',
  battery_state: 'batteryState',
  temp_current_external: 'externalProbeTemperature',
  temp_calibration: 'temperatureCalibration',
  hum_calibration: 'humidityCalibration',
  temp_correction: 'temperatureCorrection',
});

function normalizedUnit(unit) {
  return unit === '℃' ? '°C' : unit ?? null;
}

function parseValues(values) {
  if (values && typeof values === 'object') return values;
  if (typeof values !== 'string' || !values) return null;
  try {
    return JSON.parse(values);
  } catch {
    return null;
  }
}

export function parseTuyaDatapoints(statuses, specification) {
  const metadata = new Map((specification?.status || []).map((entry) => [entry.code, entry]));
  return (Array.isArray(statuses) ? statuses : []).map((status) => {
    const spec = metadata.get(status.code);
    const values = parseValues(spec?.values);
    const scale = Number.isInteger(values?.scale) ? values.scale : null;
    const converted = typeof status.value === 'number' && scale !== null
      ? status.value / (10 ** scale)
      : status.value;
    return {
      code: status.code,
      raw: status.value,
      scale,
      unit: normalizedUnit(values?.unit ?? spec?.lang_config?.unit),
      value: converted,
      type: spec?.type ?? null,
      label: spec?.name ?? null,
    };
  });
}

export function buildDewinMeasurementSnapshot({ device, statuses, specification, updatedAt = null }) {
  const datapoints = parseTuyaDatapoints(statuses, specification);
  const byCode = new Map(datapoints.map((datapoint) => [datapoint.code, datapoint]));
  const measurements = Object.fromEntries(Object.values(NORMALIZED_CODES).map((field) => [field, null]));
  for (const [code, field] of Object.entries(NORMALIZED_CODES)) {
    if (byCode.has(code)) measurements[field] = structuredClone(byCode.get(code));
  }
  return {
    deviceId: device?.id ?? null,
    online: Boolean(device?.online),
    name: device?.name ?? null,
    category: device?.category ?? specification?.category ?? null,
    measurements,
    datapoints,
    updatedAt,
  };
}

export class DewinTuyaAdapter {
  constructor({ client, now = () => new Date().toISOString() }) {
    if (!client || typeof client.readDevice !== 'function') {
      throw new TypeError('Il client Tuya read-only è obbligatorio.');
    }
    this.client = client;
    this.now = now;
  }

  async read() {
    const { device, statuses, specification } = await this.client.readDevice();
    return buildDewinMeasurementSnapshot({ device, statuses, specification, updatedAt: this.now() });
  }
}

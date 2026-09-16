function optionalNumber(payload, key, maximum) {
  if (!Object.hasOwn(payload, key)) return null;
  const value = payload[key];
  return Number.isFinite(value) && value >= 0 && value <= maximum ? value : undefined;
}

// Transport, broker, topic and logical assignments belong to the application.
export function normalizeSnzb02pPayload(payload, { updatedAt = null } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || !Number.isFinite(payload.temperature) || !Number.isFinite(payload.humidity)
    || payload.humidity < 0 || payload.humidity > 100) return null;
  const battery = optionalNumber(payload, 'battery', 100);
  const linkQuality = optionalNumber(payload, 'linkquality', 255);
  if (battery === undefined || linkQuality === undefined) return null;
  return {
    temperature: payload.temperature, humidity: payload.humidity,
    battery, linkQuality, online: true, updatedAt,
    model: 'SONOFF SNZB-02P', protocol: 'Zigbee',
  };
}

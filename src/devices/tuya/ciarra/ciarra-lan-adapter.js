import TuyAPI from 'tuyapi';

const CIARRA_PROTOCOL_VERSION = '3.4';
const VERIFY_DELAY_MS = 5000;
const FAN_SPEEDS = new Set([0, 1, 2, 3, 4]);
const LIGHT_TO_RAW = Object.freeze({ off: 'Turn_off', level1: 'Level_1', level2: 'Level_2' });
const RAW_TO_LIGHT = Object.freeze(Object.fromEntries(Object.entries(LIGHT_TO_RAW).map(([key, value]) => [value, key])));
const RAW_TO_OPERATING_STATUS = Object.freeze({ 0: 'off', 2: 'on' });

function timeoutError() {
  const error = new Error('Timeout operazione LAN CIARRA.');
  error.code = 'CIARRA_LAN_TIMEOUT';
  return error;
}

export function buildCiarraLanState({ rawDps, updatedAt = null }) {
  const dps = rawDps && typeof rawDps === 'object' ? rawDps : {};
  const fanSpeed = typeof dps['2'] === 'string' && /^[0-4]$/.test(dps['2']) ? Number(dps['2']) : null;
  return {
    online: true,
    power: typeof dps['1'] === 'boolean' ? dps['1'] : null,
    fanSpeed,
    light: RAW_TO_LIGHT[dps['104']] ?? null,
    operatingStatus: RAW_TO_OPERATING_STATUS[dps['12']] ?? null,
    updatedAt,
  };
}

export class CiarraTuyaLanAdapter {
  constructor({
    deviceId,
    ip,
    localKey,
    createDevice = options => new TuyAPI(options),
    now = () => new Date().toISOString(),
    wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    operationTimeoutMs = 5000,
    verifyDelayMs = VERIFY_DELAY_MS,
  }) {
    if (!deviceId || !ip || !localKey) throw new TypeError('deviceId, ip e localKey sono obbligatori per il client LAN CIARRA.');
    this.deviceId = deviceId;
    this.ip = ip;
    this.localKey = localKey;
    this.createDevice = createDevice;
    this.now = now;
    this.wait = wait;
    this.operationTimeoutMs = operationTimeoutMs;
    this.verifyDelayMs = verifyDelayMs;
    this.operationQueue = Promise.resolve();
  }

  #serialize(operation) {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.catch(() => undefined);
    return next;
  }

  async #withTimeout(operation) {
    let timer;
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError()), this.operationTimeoutMs); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #withDevice(operation) {
    const device = this.createDevice({
      id: this.deviceId,
      key: this.localKey,
      ip: this.ip,
      version: CIARRA_PROTOCOL_VERSION,
      issueGetOnConnect: false,
      issueRefreshOnConnect: false,
    });
    try {
      await this.#withTimeout(device.connect());
      return await this.#withTimeout(operation(device));
    } finally {
      try { await device.disconnect(); } catch { /* La sessione è comunque terminata o non raggiungibile. */ }
    }
  }

  async #readState() {
    return this.#withDevice(async device => {
      const payload = await device.get({ schema: true });
      if (!payload?.dps || typeof payload.dps !== 'object') {
        const error = new Error('Risposta LAN CIARRA senza DPS.');
        error.code = 'CIARRA_INVALID_RESPONSE';
        throw error;
      }
      return buildCiarraLanState({ rawDps: payload.dps, updatedAt: this.now() });
    });
  }

  async getState() {
    return this.#serialize(() => this.#readState());
  }

  async #writeAndVerify({ dp, rawValue, field, expected }) {
    return this.#serialize(async () => {
      await this.#withDevice(device => device.set({ dps: dp, set: rawValue }));
      await this.wait(this.verifyDelayMs);
      const state = await this.#readState();
      if (state[field] !== expected) {
        const error = new Error('La CIARRA non ha confermato il comando LAN.');
        error.code = 'CIARRA_WRITE_NOT_CONFIRMED';
        throw error;
      }
      return state;
    });
  }

  async setPower(power) {
    if (typeof power !== 'boolean') throw new TypeError('Stato power CIARRA non valido.');
    return this.#writeAndVerify({ dp: 1, rawValue: power, field: 'power', expected: power });
  }

  async setFanSpeed(fanSpeed) {
    if (!Number.isInteger(fanSpeed) || !FAN_SPEEDS.has(fanSpeed)) throw new TypeError('Velocita CIARRA non valida.');
    return this.#writeAndVerify({ dp: 2, rawValue: String(fanSpeed), field: 'fanSpeed', expected: fanSpeed });
  }

  async setLight(light) {
    if (!Object.hasOwn(LIGHT_TO_RAW, light)) throw new TypeError('Luce CIARRA non valida.');
    return this.#writeAndVerify({ dp: 104, rawValue: LIGHT_TO_RAW[light], field: 'light', expected: light });
  }
}

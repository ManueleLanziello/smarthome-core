import crypto from 'node:crypto';

const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const EMPTY_BODY_SHA256 = crypto.createHash('sha256').update('').digest('hex');

export class TuyaCloudError extends Error {
  constructor(message, code = 'TUYA_REQUEST_FAILED', options = {}) {
    super(message, options);
    this.name = 'TuyaCloudError';
    this.code = code;
  }
}

function signRequest({ clientId, clientSecret, accessToken = '', requestPath, method = 'GET', body = '', now, randomUUID }) {
  const timestamp = String(now());
  const nonce = randomUUID().replaceAll('-', '');
  const contentHash = body ? crypto.createHash('sha256').update(body).digest('hex') : EMPTY_BODY_SHA256;
  const stringToSign = `${method}\n${contentHash}\n\n${requestPath}`;
  const message = `${clientId}${accessToken}${timestamp}${nonce}${stringToSign}`;
  const sign = crypto.createHmac('sha256', clientSecret).update(message).digest('hex').toUpperCase();
  return {
    client_id: clientId,
    sign,
    sign_method: 'HMAC-SHA256',
    t: timestamp,
    nonce,
    ...(accessToken ? { access_token: accessToken } : {}),
  };
}

export class TuyaCloudClient {
  constructor({
    clientId,
    clientSecret,
    deviceId,
    baseUrl = 'https://openapi.tuyaeu.com',
    fetchImpl = fetch,
    now = () => Date.now(),
    randomUUID = crypto.randomUUID,
    timeoutMs = 10_000,
  }) {
    if (!clientId || !clientSecret || !deviceId) {
      throw new TuyaCloudError('Configurazione Tuya incompleta', 'CONFIGURATION_INCOMPLETE');
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.deviceId = deviceId;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.randomUUID = randomUUID;
    this.timeoutMs = timeoutMs;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async request(requestPath, accessToken = '', { method = 'GET', body = '' } = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${requestPath}`, {
        method,
        headers: {
          ...signRequest({
          clientId: this.clientId,
          clientSecret: this.clientSecret,
            accessToken,
            requestPath,
            method,
            body,
            now: this.now,
            randomUUID: this.randomUUID,
          }),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) { throw error; }
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new TuyaCloudError(`Tuya HTTP ${response.status}: risposta non JSON`, 'INVALID_RESPONSE', { cause: error });
    }
    if (!response.ok || payload.success !== true) {
      throw new TuyaCloudError(
        `Tuya HTTP ${response.status}, code=${payload.code ?? 'n/a'}, message=${payload.msg ?? 'unknown'}`,
        'API_ERROR',
      );
    }
    return payload.result;
  }

  async accessToken() {
    if (this.token && this.now() < this.tokenExpiresAt - TOKEN_EXPIRY_MARGIN_MS) return this.token;
    const result = await this.request('/v1.0/token?grant_type=1');
    if (!result?.access_token) throw new TuyaCloudError('Tuya non ha restituito un access token', 'TOKEN_MISSING');
    this.token = result.access_token;
    this.tokenExpiresAt = this.now() + Number(result.expire_time || 0) * 1000;
    return this.token;
  }

  async readDevice() {
    const token = await this.accessToken();
    const id = encodeURIComponent(this.deviceId);
    const [device, specification, statuses] = await Promise.all([
      this.request(`/v1.0/iot-03/devices/${id}`, token),
      this.request(`/v1.2/iot-03/devices/${id}/specification`, token),
      this.request(`/v1.0/iot-03/devices/${id}/status`, token),
    ]);
    return { device, specification, statuses };
  }

  async readShadowProperties() {
    const token = await this.accessToken();
    const id = encodeURIComponent(this.deviceId);
    const result = await this.request(`/v2.0/cloud/thing/${id}/shadow/properties`, token);
    return Array.isArray(result?.properties) ? result.properties : [];
  }

  async issueProperties(properties) {
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
      throw new TuyaCloudError('Proprieta Tuya non valide', 'INVALID_PROPERTIES');
    }
    const token = await this.accessToken();
    const id = encodeURIComponent(this.deviceId);
    const body = JSON.stringify({ properties: JSON.stringify(properties) });
    return this.request(`/v2.0/cloud/thing/${id}/shadow/properties/issue`, token, { method: 'POST', body });
  }
}

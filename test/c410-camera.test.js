import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  CameraManager, c410ProbePath, c410WorkerPath, defaultCameraPython, RoleRuntimeManager, verifyTapoC410,
} from '../src/index.js';

class FakeWorker extends EventEmitter {
  constructor() { super(); this.stdout = new PassThrough(); this.stderr = new PassThrough(); }
  kill() { setImmediate(() => this.emit('exit', 0)); return true; }
}

test('C410 manager starts one mocked worker, persists a JPEG and stops by signal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'core-c410-'));
  let worker; let spawns = 0;
  const manager = new CameraManager({
    ip: '192.0.2.8', pythonPath: 'python-test', workerPath: c410WorkerPath(), outputDirectory: directory,
    startTimeoutMs: 1000, stopTimeoutMs: 100,
    spawnProcess: () => {
      spawns += 1; worker = new FakeWorker();
      setImmediate(() => void writeFile(path.join(directory, 'live-frame.jpg'), Buffer.alloc(2048, 1))
        .then(() => worker.stdout.write('{"event":"ready"}\n')));
      return worker;
    },
  });
  try {
    const [first, second] = await Promise.all([manager.start(), manager.start()]);
    assert.equal(spawns, 1); assert.equal(first.live, true); assert.equal(second.imageAvailable, true);
    const stopping = manager.stop();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(await readFile(path.join(directory, 'stop.signal'), 'utf8'), 'stop\n');
    worker.emit('exit', 0);
    assert.equal((await stopping).live, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('C410 manager redacts credentials and classifies a missing ffmpeg failure', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'core-c410-redaction-'));
  const manager = new CameraManager({
    ip: '192.0.2.8', pythonPath: 'python-test', workerPath: c410WorkerPath(), outputDirectory: directory,
    startTimeoutMs: 1000, env: { TAPO_USERNAME: 'private-user', TAPO_PASSWORD: 'private-password' },
    spawnProcess: () => {
      const worker = new FakeWorker();
      setImmediate(() => { worker.stderr.write('imageio_ffmpeg private-user private-password'); worker.emit('exit', 1); });
      return worker;
    },
  });
  try {
    await assert.rejects(manager.start(), error => error.code === 'FFMPEG_NOT_FOUND' && !/private-user|private-password/.test(error.message));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('C410 verifier receives only caller-provided process environment and parses a mocked probe', async () => {
  let call;
  const detected = await verifyTapoC410({ ip: '192.0.2.9' }, {
    pythonPath: 'python-test', env: { TAPO_USERNAME: 'fixture', TAPO_PASSWORD: 'secret' },
    execute: async (...args) => { call = args; return { stdout: JSON.stringify({ authentication: true, transport: 'PyTapo HTTPS', device_info: { model: 'C410', alias: 'Fixture', mac: 'AA:BB:CC:DD:EE:FF' } }) }; },
  });
  assert.deepEqual(detected, { model: 'C410', alias: 'Fixture', mac: 'AA:BB:CC:DD:EE:FF', protocol: 'PyTapo HTTPS', online: true });
  assert.deepEqual(call[1].slice(1), ['--ip', '192.0.2.9']);
  assert.equal(call[2].env.TAPO_PASSWORD, 'secret');
  assert.match(c410ProbePath(), /c410-probe\.py$/);
  assert.match(c410WorkerPath(), /c410-worker\.py$/);
  assert.equal(defaultCameraPython('C:\\app', { env: {}, platform: 'win32', pathExists: () => false }), 'python');
});

test('generic role runtime replaces a changed camera identity without stale fallback', async () => {
  const stopped = [];
  const manager = new RoleRuntimeManager({ category: 'camera', emptySnapshot: () => ({ configured: false }), createRuntime: record => ({
    snapshot: () => ({ configured: true, ip: record.ip }), stop: () => stopped.push(record.ip),
  }) });
  await manager.reconcile([{ id: 'camera', model: 'C410', ip: '192.0.2.1', mac: 'AA:BB:CC:DD:EE:01' }], { camera: 'camera.role' });
  await manager.reconcile([{ id: 'camera', model: 'C410', ip: '192.0.2.2', mac: 'AA:BB:CC:DD:EE:02' }], { camera: 'camera.role' });
  assert.equal((await manager.snapshot('camera.role')).ip, '192.0.2.2');
  assert.deepEqual(stopped, ['192.0.2.1']);
});

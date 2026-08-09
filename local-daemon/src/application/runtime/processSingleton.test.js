import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireProcessSingleton } from './processSingleton.js';

test('process singleton rejects a live owner and replaces a stale lock', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'quant-bot-lock-')
  );
  const lockPath = path.join(directory, 'quant-bot.lock');
  const release = acquireProcessSingleton(lockPath, {
    pid: 101,
    isProcessAlive: ownerPid => ownerPid === 101
  });
  assert.throws(
    () => acquireProcessSingleton(lockPath, {
      pid: 202,
      isProcessAlive: ownerPid => ownerPid === 101
    }),
    /PID 101/
  );
  release();

  fs.writeFileSync(lockPath, '303', 'utf8');
  const releaseReplacement = acquireProcessSingleton(lockPath, {
    pid: 404,
    isProcessAlive: () => false
  });
  assert.strictEqual(fs.readFileSync(lockPath, 'utf8'), '404');
  releaseReplacement();
  fs.rmSync(directory, { recursive: true });
});

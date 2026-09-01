import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const deployScript = readFileSync('scripts/deploy-enigma-monitor.sh', 'utf8');
const service = readFileSync('ops/enigma/monitor-integridad-autodeploy.service', 'utf8');
const timer = readFileSync('ops/enigma/monitor-integridad-autodeploy.timer', 'utf8');

test('Enigma deployment scripts have valid bash syntax', () => {
  execFileSync('bash', ['-n', 'scripts/deploy-enigma-monitor.sh']);
  execFileSync('bash', ['-n', 'scripts/install-enigma-autodeploy.sh']);
});

test('deployment is scoped to the specialized container and port', () => {
  assert.match(deployScript, /CONTAINER_NAME:-monitor-integridad-main/);
  assert.match(deployScript, /HOST_PORT:-8144/);
  assert.match(deployScript, /Refusing deployment outside monitor-integridad-main:8144/);
  assert.doesNotMatch(deployScript, /8142|vercel/i);
});

test('deployment requires a green gate, canary health, and automatic rollback', () => {
  assert.match(deployScript, /gate_state.*success/s);
  assert.match(deployScript, /monitor-integridad-canary/);
  assert.match(deployScript, /api\/sidecar-health/);
  assert.match(deployScript, /restore_previous_container/);
  assert.match(deployScript, /org\.opencontainers\.image\.revision/);
});

test('a pending gate exits before Docker is touched', () => {
  const root = mkdtempSync(join(tmpdir(), 'enigma-deploy-test-'));
  const fakeBin = join(root, 'bin');
  const deployRoot = join(root, 'state');
  const envFile = join(root, 'container.env');
  mkdirSync(fakeBin);
  mkdirSync(join(deployRoot, 'repository.git'), { recursive: true });
  writeFileSync(envFile, 'WM_SESSION_SECRET=test-only\n', { mode: 0o600 });

  const commands = {
    curl: '#!/bin/sh\nprintf \'%s\\n\' \'{"statuses":[{"context":"gate","state":"pending"}]}\'\n',
    docker: '#!/bin/sh\necho docker-was-called >&2\nexit 99\n',
    flock: '#!/bin/sh\nexit 0\n',
    git: `#!/bin/sh\ncase "$*" in *rev-parse*) printf '%s\\n' '${'a'.repeat(40)}';; *) exit 0;; esac\n`,
    stat: '#!/bin/sh\nprintf \'600\\n\'\n',
  };
  for (const [name, body] of Object.entries(commands)) {
    const path = join(fakeBin, name);
    writeFileSync(path, body);
    chmodSync(path, 0o700);
  }

  const output = execFileSync('bash', ['scripts/deploy-enigma-monitor.sh'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      CONTAINER_ENV_FILE: envFile,
      DEPLOY_ROOT: deployRoot,
    },
  });
  assert.match(output, /gate=pending/);
  assert.doesNotMatch(output, /docker-was-called/);
});

test('systemd runs a serialized pull deployment every five minutes', () => {
  assert.match(service, /Type=oneshot/);
  assert.match(service, /TimeoutStartSec=45min/);
  assert.match(timer, /OnUnitActiveSec=5min/);
  assert.match(timer, /Persistent=true/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('dedicated integrity page exposes the complete human review journey', async () => {
  const [html, source, nginx, vercel] = await Promise.all([
    readFile(new URL('integrity.html', root), 'utf8'),
    readFile(new URL('src/integrity/main.ts', root), 'utf8'),
    readFile(new URL('docker/nginx.conf.template', root), 'utf8'),
    readFile(new URL('vercel.json', root), 'utf8'),
  ]);

  for (const anchor of ['search-form', 'assign-form', 'action-form', 'timeline']) {
    assert.match(html, new RegExp(`id="${anchor}"`));
  }
  for (const action of [
    'NoObservations', 'RequestMissingRequirement', 'RecordAlternativeExplanation',
    'RecommendInspection', 'RecommendReferral', 'RecordOfficialDecision', 'CloseReview',
  ]) assert.match(html, new RegExp(`value="${action}"`));

  assert.match(source, /\/api\/integrity\/v1\/search-patents/);
  assert.match(source, /\/api\/integrity\/v1\/open-license-review/);
  assert.match(source, /\/api\/integrity\/v1\/assign-reviewer/);
  assert.match(source, /\/api\/integrity\/v1\/record-review-action/);
  assert.match(source, /\/api\/integrity\/v1\/get-review-case/);
  assert.match(source, /credentials: 'same-origin'/);
  assert.match(source, /Release fijado/);
  assert.match(source, /Hash de evidencia/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML/);
  assert.match(nginx, /location = \/integrity/);
  assert.equal(JSON.parse(vercel).rewrites.some((rule: { source?: string }) => (
    rule.source === '/integrity'
  )), true);
});

test('integrity page labels recommendations as non-decisions', async () => {
  const html = await readFile(new URL('integrity.html', root), 'utf8');
  assert.match(html, /Las recomendaciones no constituyen decisiones oficiales/);
  assert.match(html, /Registrar decisión oficial/);
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import handler, { patentHealthService } from '../api/integrity/patent-health.ts';
import type { PatentCoverageResponse } from '../server/_shared/commercial-licenses-contract.ts';

function coverage(status: 'never_run' | 'running' | 'success' | 'partial' | 'failed') {
  const refresh = status === 'never_run'
    ? { status } as const
    : {
        status,
        run_id: 'run-001',
        trigger: 'scheduled' as const,
        started_at: '2026-08-31T20:00:00Z',
        completed_at: status === 'running' ? null : '2026-08-31T20:01:00Z',
        discovery_status: 'success' as const,
        discovered_resources: 123,
        candidate_resources: 104,
        pending_releases: 0,
        imported_releases: 0,
        failed_releases: status === 'partial' || status === 'failed' ? 1 : 0,
      };
  return {
    metadata: {
      producer: 'inteligencia-inmobiliaria',
      product: 'commercial-licenses',
      release_id: 'purranque-2025-s2',
      schema_version: '0.1.0',
      data_as_of: '2025-12-31T23:59:59Z',
      promoted_at: '2026-08-28T23:34:23Z',
      quality_status: 'promoted',
      availability: 'current',
      data_marking: 'PUBLIC',
      last_good_release_id: 'purranque-2025-s1',
      quality_report_uri: '/quality/purranque-2025-s2',
    },
    refresh,
    coverage: [],
    source_refs: [],
    limitations: [],
  } as PatentCoverageResponse;
}

describe('patent refresh health projection', () => {
  it('maps producer outcomes to operator-facing service health', () => {
    assert.equal(patentHealthService(coverage('success')).status, 'operational');
    assert.equal(patentHealthService(coverage('running')).status, 'degraded');
    assert.equal(patentHealthService(coverage('partial')).status, 'degraded');
    assert.equal(patentHealthService(coverage('failed')).status, 'outage');
    assert.equal(patentHealthService(coverage('never_run')).status, 'unknown');
  });

  it('keeps counts and release identity visible without exposing credentials', () => {
    const result = patentHealthService(coverage('success'));
    assert.equal(result.releaseId, 'purranque-2025-s2');
    assert.match(result.description, /123 recursos descubiertos/);
    assert.match(result.description, /104 candidatos por gobernar/);
    assert.doesNotMatch(JSON.stringify(result), /service.key|authorization|secret/iu);
  });

  it('proxies producer health with server-only credentials', async () => {
    const previousFetch = globalThis.fetch;
    const previousBaseUrl = process.env.CHILE_COMMERCIAL_LICENSES_BASE_URL;
    const previousServiceKey = process.env.CHILE_COMMERCIAL_LICENSES_SERVICE_KEY;
    let observedServiceKey = '';
    process.env.CHILE_COMMERCIAL_LICENSES_BASE_URL = 'http://10.0.0.3:8130/api/integrity/';
    process.env.CHILE_COMMERCIAL_LICENSES_SERVICE_KEY = 'test-service-key';
    globalThis.fetch = async (_input, init) => {
      observedServiceKey = String(new Headers(init?.headers).get('X-Service-Key'));
      return new Response(JSON.stringify(coverage('success')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    try {
      const response = await handler(new Request(
        'http://monitor.test/api/integrity/patent-health?municipality_cut=10303',
      ));
      assert.equal(response.status, 200);
      const body = await response.json() as { success: boolean; service: { status: string } };
      assert.equal(body.success, true);
      assert.equal(body.service.status, 'operational');
      assert.equal(observedServiceKey, 'test-service-key');
      assert.doesNotMatch(JSON.stringify(body), /test-service-key/);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousBaseUrl === undefined) delete process.env.CHILE_COMMERCIAL_LICENSES_BASE_URL;
      else process.env.CHILE_COMMERCIAL_LICENSES_BASE_URL = previousBaseUrl;
      if (previousServiceKey === undefined) delete process.env.CHILE_COMMERCIAL_LICENSES_SERVICE_KEY;
      else process.env.CHILE_COMMERCIAL_LICENSES_SERVICE_KEY = previousServiceKey;
    }
  });
});

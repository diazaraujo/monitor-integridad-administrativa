export const config = { runtime: 'edge' };

import {
  CommercialLicensesClientError,
  createCommercialLicensesClientFromEnv,
} from '../../server/_shared/commercial-licenses-client';
import type { PatentCoverageResponse } from '../../server/_shared/commercial-licenses-contract';

export interface PatentHealthService {
  id: 'municipal-commercial-licenses';
  name: string;
  category: 'dev';
  status: 'operational' | 'degraded' | 'outage' | 'unknown';
  description: string;
  releaseId: string;
  dataAsOf: string;
}

export function patentHealthService(payload: PatentCoverageResponse): PatentHealthService {
  const refresh = payload.refresh;
  const status = refresh.status === 'success'
    ? 'operational'
    : refresh.status === 'failed'
      ? 'outage'
      : refresh.status === 'never_run'
        ? 'unknown'
        : 'degraded';
  const description = refresh.status === 'never_run'
    ? 'Actualización aún no ejecutada'
    : [
        `corrida ${refresh.status}`,
        `${refresh.discovered_resources ?? 0} recursos descubiertos`,
        `${refresh.candidate_resources ?? 0} candidatos por gobernar`,
        `${refresh.imported_releases ?? 0} releases importados`,
        `${refresh.failed_releases ?? 0} fallidos`,
      ].join(' · ');
  return {
    id: 'municipal-commercial-licenses',
    name: 'Actualización de patentes municipales',
    category: 'dev',
    status,
    description,
    releaseId: payload.metadata.release_id,
    dataAsOf: payload.metadata.data_as_of,
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'GET' },
    });
  }
  const municipalityCut = new URL(req.url).searchParams.get('municipality_cut') ?? '10303';
  if (!/^\d{5}$/u.test(municipalityCut)) return json({ error: 'invalid_municipality_cut' }, 400);
  try {
    const coverage = await createCommercialLicensesClientFromEnv().getPatentCoverage({
      municipalityCut,
      representation: 'public',
    });
    return json({ success: true, service: patentHealthService(coverage) }, 200);
  } catch (error) {
    const kind = error instanceof CommercialLicensesClientError ? error.kind : 'unavailable';
    return json({ success: false, error: kind }, 503);
  }
}

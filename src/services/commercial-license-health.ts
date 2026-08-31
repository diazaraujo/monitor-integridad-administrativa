export interface CommercialLicenseHealthService {
  id: string;
  name: string;
  category: string;
  status: 'operational' | 'degraded' | 'outage' | 'unknown';
  description: string;
  releaseId: string;
  dataAsOf: string;
}

interface CommercialLicenseHealthResponse {
  success: boolean;
  service?: CommercialLicenseHealthService;
}

export async function fetchCommercialLicenseHealth(): Promise<CommercialLicenseHealthService> {
  const response = await fetch('/api/integrity/patent-health?municipality_cut=10303', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const payload = await response.json() as CommercialLicenseHealthResponse;
  if (!response.ok || !payload.success || !payload.service) {
    throw new Error('Commercial license health is unavailable');
  }
  return payload.service;
}

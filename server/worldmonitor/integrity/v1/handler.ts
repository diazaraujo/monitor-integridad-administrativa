import type { IntegrityServiceHandler } from '../../../../src/generated/server/worldmonitor/integrity/v1/service_server';

import { searchPatents } from './search-patents';

export const integrityHandler: IntegrityServiceHandler = {
  searchPatents,
};

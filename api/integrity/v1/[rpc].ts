export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../server/gateway';
import { integrityHandler } from '../../../server/worldmonitor/integrity/v1/handler';
import { createIntegrityServiceRoutes } from '../../../src/generated/server/worldmonitor/integrity/v1/service_server';

export default createDomainGateway(
  createIntegrityServiceRoutes(integrityHandler, serverOptions),
);

import type { IntegrityServiceHandler } from '../../../../src/generated/server/worldmonitor/integrity/v1/service_server';

import { searchPatents } from './search-patents';
import {
  assignReviewer,
  getReviewCase,
  openLicenseReview,
  recordReviewAction,
} from './review-workflow';

export const integrityHandler: IntegrityServiceHandler = {
  searchPatents,
  openLicenseReview,
  getReviewCase,
  assignReviewer,
  recordReviewAction,
};

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createCommercialLicensesClientFromEnv } from '../server/_shared/commercial-licenses-client.ts';
import {
  evaluateHistoricalPatentCohort,
  parseHistoricalPatentCohort,
} from '../server/_shared/historical-patent-cohort.ts';

const manifestPath = resolve(
  process.argv[2] ?? 'data/integrity/historical-provisional-license-cohort-v1.json',
);
const cohort = parseHistoricalPatentCohort(JSON.parse(await readFile(manifestPath, 'utf8')));
const report = await evaluateHistoricalPatentCohort({
  cohort,
  client: createCommercialLicensesClientFromEnv(),
  builderVersion: 'historical-cohort-v0.1.0',
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.gate.passed) process.exitCode = 2;

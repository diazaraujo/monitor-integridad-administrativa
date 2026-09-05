import { expect, test } from '@playwright/test';

test('completes a provisional-license review from queue through official closure', async ({ page }) => {
  const releaseId = 'lo-barnechea-2025-s1';
  const evidenceHash = 'a'.repeat(64);
  const actions: Record<string, unknown>[] = [];
  const idempotencyKeys: string[] = [];
  let snapshot: Record<string, unknown> = {};

  await page.route('**/api/integrity/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const key = request.headers()['idempotency-key'];
    if (key) idempotencyKeys.push(key);

    if (path.endsWith('/search-patents')) {
      await route.fulfill({ json: {
        items: [{
          licenseId: '7-092387', licenseNumber: '92387', licenseType: 'commercial',
          reportedStatus: 'vigente', provisionalStatus: 'provisional',
          address: 'Av. Siempre Viva 123', activities: ['Restaurante'],
          limitationCodes: ['ambiguous_match'],
        }],
        releaseId, availability: 'current', limitationCodes: ['ambiguous_match'],
      } });
      return;
    }

    if (path.endsWith('/open-license-review')) {
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({ licenseId: '7-092387', releaseId });
      snapshot = {
        case_id: 'case-001', case_version: 1, license_id: '7-092387',
        municipality_cut: '13115', status: 'open',
        created_at: '2026-09-05T12:00:00.000Z', updated_at: '2026-09-05T12:00:00.000Z',
        packet_ref: { release_id: releaseId, packet_content_sha256: evidenceHash },
      };
      actions.push({ action_type: 'OpenLicenseReview', occurred_at: snapshot.created_at });
      await route.fulfill({ json: { caseId: 'case-001', caseVersion: 1 } });
      return;
    }

    if (path.endsWith('/get-review-case')) {
      await route.fulfill({ json: {
        caseJson: JSON.stringify(snapshot),
        evidencePacketJson: JSON.stringify({
          gaps: [{ description: 'Resolución ambiental no disponible' }],
          conflicts: [{ description: 'Coincidencia predial ambigua' }],
        }),
        actionJson: actions.map((action) => JSON.stringify(action)),
        permittedActions: [
          'AssignReviewer', 'RecommendReferral', 'RecordOfficialDecision', 'CloseReview',
        ],
      } });
      return;
    }

    const body = request.postDataJSON() as Record<string, unknown>;
    const nextVersion = Number(snapshot.case_version) + 1;
    if (path.endsWith('/assign-reviewer')) {
      expect(body).toMatchObject({ reviewerId: 'reviewer-001', expectedCaseVersion: 1 });
      snapshot = {
        ...snapshot, case_version: nextVersion, status: 'in_review',
        assignment: { reviewer_id: 'reviewer-001', assigned_at: '2026-09-05T12:01:00.000Z' },
      };
      actions.push({ action_type: 'AssignReviewer', occurred_at: '2026-09-05T12:01:00.000Z' });
    } else if (path.endsWith('/record-review-action')) {
      const actionType = String(body.actionType);
      snapshot = {
        ...snapshot, case_version: nextVersion,
        status: actionType === 'CloseReview' ? 'closed' : 'in_review',
      };
      if (actionType === 'RecordOfficialDecision') {
        snapshot.official_outcome = {
          outcome_code: body.outcomeCode, external_reference: body.externalReference,
        };
      }
      actions.push({
        action_type: actionType, note: body.note,
        occurred_at: `2026-09-05T12:0${nextVersion}:00.000Z`,
      });
    } else {
      await route.abort();
      return;
    }
    await route.fulfill({ json: { caseId: 'case-001', caseVersion: nextVersion } });
  });

  await page.goto('/integrity');
  await page.getByRole('button', { name: 'Buscar patentes' }).click();
  await expect(page.getByText('92387 · provisional')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir revisión' }).click();
  await expect(page.getByText(releaseId, { exact: true })).toBeVisible();
  await expect(page.getByText(evidenceHash, { exact: true })).toBeVisible();
  await expect(page.getByText('Resolución ambiental no disponible')).toBeVisible();
  await expect(page.getByText('Coincidencia predial ambigua')).toBeVisible();

  await page.getByLabel('Asignar revisor').fill('reviewer-001');
  await page.getByRole('button', { name: 'Asignar', exact: true }).click();
  await expect(page.getByText('reviewer-001', { exact: true })).toBeVisible();

  await page.locator('select[name="action_type"]').selectOption('RecommendReferral');
  await page.getByLabel('Fundamento').fill('Revisión humana recomienda derivación.');
  await page.getByRole('button', { name: 'Registrar acción' }).click();
  await expect(page.getByText('RecommendReferral', { exact: true })).toBeVisible();

  await page.locator('select[name="action_type"]').selectOption('RecordOfficialDecision');
  await page.getByLabel('Fundamento').fill('Acto administrativo ya emitido por la autoridad.');
  await page.getByLabel('Outcome oficial').fill('renewal_approved');
  await page.getByLabel('Referencia del acto').fill('RES-2026-001');
  await page.getByRole('button', { name: 'Registrar acción' }).click();
  await expect(page.getByText('renewal_approved', { exact: true })).toBeVisible();

  await page.locator('select[name="action_type"]').selectOption('CloseReview');
  await page.getByRole('button', { name: 'Registrar acción' }).click();
  await expect(page.locator('#case-state')).toContainText('closed · v5');
  await expect(page.getByText('CloseReview', { exact: true })).toBeVisible();
  expect(idempotencyKeys).toHaveLength(5);
  expect(new Set(idempotencyKeys).size).toBe(5);
});

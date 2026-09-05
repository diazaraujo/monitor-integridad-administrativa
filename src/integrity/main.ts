import './styles.css';

interface CaseSnapshot {
  case_id: string; case_version: number; license_id: string; municipality_cut: string;
  status: string; created_at: string; updated_at: string;
  packet_ref: { release_id: string; packet_content_sha256: string };
  assignment?: { reviewer_id: string; assigned_at: string };
  official_outcome?: { outcome_code: string; external_reference: string };
}
interface DossierResponse {
  caseJson: string; evidencePacketJson: string; actionJson: string[]; permittedActions: string[];
}
interface QueueResponse { items: QueueItem[]; releaseId: string; availability: string; limitationCodes: string[] }
interface QueueItem { licenseId: string; licenseNumber: string; licenseType: string; reportedStatus: string; provisionalStatus: string; address: string; activities: string[]; limitationCodes: string[] }

let activeCase: CaseSnapshot | null = null;
let currentRelease = '';
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const idempotencyKey = () => crypto.randomUUID();

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  const value = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(value.message || `La operación falló (${response.status})`);
  return value as T;
}

function setBusy(form: HTMLFormElement, busy: boolean) {
  form.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = busy; });
}

function addFact(container: HTMLElement, label: string, value: string) {
  const box = document.createElement('div');
  const term = document.createElement('dt'); term.textContent = label;
  const detail = document.createElement('dd'); detail.textContent = value;
  box.append(term, detail); container.append(box);
}

function renderList(target: HTMLElement, rows: unknown[], empty: string) {
  target.replaceChildren();
  if (rows.length === 0) { const li = document.createElement('li'); li.textContent = empty; target.append(li); return; }
  rows.forEach((row) => {
    const item = document.createElement('li');
    const record = row as Record<string, unknown>;
    item.textContent = String(record.description ?? record.code ?? record.gap_id ?? record.conflict_id ?? 'Registro trazable');
    target.append(item);
  });
}

async function loadCase(caseId: string, version: number) {
  const params = new URLSearchParams({ case_id: caseId, case_version: String(version) });
  const dossier = await api<DossierResponse>(`/api/integrity/v1/get-review-case?${params}`);
  activeCase = JSON.parse(dossier.caseJson) as CaseSnapshot;
  const packet = JSON.parse(dossier.evidencePacketJson) as { gaps?: unknown[]; conflicts?: unknown[] };
  byId('case-empty').hidden = true; byId('case-content').hidden = false;
  byId('case-state').textContent = `${activeCase.status} · v${activeCase.case_version}`;
  const facts = byId('case-facts'); facts.replaceChildren();
  addFact(facts, 'Caso', activeCase.case_id); addFact(facts, 'Patente', activeCase.license_id);
  addFact(facts, 'Municipio', activeCase.municipality_cut);
  addFact(facts, 'Release fijado', activeCase.packet_ref.release_id);
  addFact(facts, 'Hash de evidencia', activeCase.packet_ref.packet_content_sha256);
  addFact(facts, 'Revisor', activeCase.assignment?.reviewer_id ?? 'Sin asignar');
  if (activeCase.official_outcome) addFact(facts, 'Outcome oficial', activeCase.official_outcome.outcome_code);
  const permitted = new Set(dossier.permittedActions);
  byId<HTMLFormElement>('assign-form').querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')
    .forEach((control) => { control.disabled = !permitted.has('AssignReviewer'); });
  byId<HTMLFormElement>('action-form').querySelectorAll<HTMLOptionElement>('option')
    .forEach((option) => { option.disabled = !permitted.has(option.value); });
  const firstPermitted = byId<HTMLSelectElement>('action-form-action').querySelector<HTMLOptionElement>(
    'option:not(:disabled)',
  );
  if (firstPermitted) byId<HTMLSelectElement>('action-form-action').value = firstPermitted.value;
  byId<HTMLButtonElement>('record-action').disabled = !firstPermitted;
  renderList(byId('gaps'), packet.gaps ?? [], 'Sin brechas registradas.');
  renderList(byId('conflicts'), packet.conflicts ?? [], 'Sin conflictos registrados.');
  const timeline = byId('timeline'); timeline.replaceChildren();
  dossier.actionJson.map((value) => JSON.parse(value) as Record<string, unknown>).forEach((action) => {
    const li = document.createElement('li');
    const title = document.createElement('strong'); title.textContent = String(action.action_type);
    const note = document.createElement('div'); note.textContent = String(action.note ?? 'Sin nota adicional');
    const time = document.createElement('time'); time.textContent = String(action.occurred_at ?? '');
    li.append(title, note, time); timeline.append(li);
  });
}

byId<HTMLFormElement>('search-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget as HTMLFormElement; setBusy(form, true);
  const message = byId('queue-message'); message.textContent = 'Consultando release municipal…';
  try {
    const data = new FormData(form); const params = new URLSearchParams();
    data.forEach((value, key) => { if (String(value).trim()) params.set(key, String(value)); });
    const result = await api<QueueResponse>(`/api/integrity/v1/search-patents?${params}`);
    currentRelease = result.releaseId; byId('release-state').textContent = `${result.releaseId} · ${result.availability}`;
    const queue = byId('queue'); queue.replaceChildren();
    result.items.forEach((patent) => {
      const row = document.createElement('article'); row.className = 'queue-item';
      const content = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = `${patent.licenseNumber || patent.licenseId} · ${patent.provisionalStatus}`;
      const meta = document.createElement('div'); meta.className = 'muted'; meta.textContent = `${patent.licenseType} · ${patent.reportedStatus} · ${patent.address}`;
      const activity = document.createElement('div'); activity.textContent = patent.activities.join(', ');
      content.append(title, meta, activity);
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Abrir revisión';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const result = await api<{ caseId: string; caseVersion: number }>('/api/integrity/v1/open-license-review', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey() },
            body: JSON.stringify({ licenseId: patent.licenseId, releaseId: currentRelease, effectiveOn: '' }),
          });
          await loadCase(result.caseId, result.caseVersion);
        } catch (error) { message.textContent = error instanceof Error ? error.message : 'No fue posible abrir el caso.'; }
        finally { button.disabled = false; }
      });
      row.append(content, button); queue.append(row);
    });
    message.textContent = result.items.length ? `${result.items.length} patente(s) en el release fijado.` : 'No se encontraron patentes.';
  } catch (error) { message.textContent = error instanceof Error ? error.message : 'Consulta no disponible.'; }
  finally { setBusy(form, false); }
});

byId<HTMLFormElement>('assign-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!activeCase) return;
  const form = event.currentTarget as HTMLFormElement; setBusy(form, true);
  try {
    const reviewerId = String(new FormData(form).get('reviewer_id') ?? '').trim();
    const result = await api<{ caseVersion: number }>('/api/integrity/v1/assign-reviewer', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey() },
      body: JSON.stringify({ caseId: activeCase.case_id, expectedCaseVersion: activeCase.case_version, reviewerId }),
    });
    await loadCase(activeCase.case_id, result.caseVersion);
  } catch (error) { byId('action-message').textContent = error instanceof Error ? error.message : 'No fue posible asignar.'; }
  finally { setBusy(form, false); }
});

byId<HTMLFormElement>('action-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget as HTMLFormElement;
  const message = byId('action-message');
  if (!activeCase) { message.textContent = 'Abra o cargue un expediente antes de actuar.'; return; }
  setBusy(form, true);
  try {
    const data = new FormData(form);
    const result = await api<{ caseVersion: number }>('/api/integrity/v1/record-review-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey() },
      body: JSON.stringify({
        caseId: activeCase.case_id,
        expectedCaseVersion: activeCase.case_version,
        actionType: String(data.get('action_type') ?? ''),
        note: String(data.get('note') ?? ''),
        outcomeCode: String(data.get('outcome_code') ?? ''),
        externalReference: String(data.get('external_reference') ?? ''),
      }),
    });
    await loadCase(activeCase.case_id, result.caseVersion); message.textContent = 'Acción registrada de forma trazable.';
  } catch (error) { message.textContent = error instanceof Error ? error.message : 'No fue posible registrar la acción.'; }
  finally { setBusy(form, false); }
});

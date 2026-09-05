# Diseño del cliente `commercial-licenses`

**Estado:** sincronizado con el adaptador operativo `0.1.0` del productor.

## Decisión

El cliente será exclusivamente server-side. No se implementará en `src/services`
ni recibirá secretos mediante variables `VITE_*`. Si sus resultados se exponen al
frontend, la superficie pública deberá definirse después mediante los contratos
proto/sebuf del repositorio.

## Archivos propuestos

| Archivo | Responsabilidad |
|---|---|
| `server/_shared/commercial-licenses-contract.ts` | tipos, parsing y validadores runtime |
| `server/_shared/commercial-licenses-client.ts` | transporte HTTP, autenticación, timeout y errores tipados |
| `server/_shared/commercial-licenses-cache.ts` | caché read-through sólo de respuestas válidas |
| `server/__tests__/commercial-licenses-contract.test.ts` | invariantes, privacidad y compatibilidad |
| `server/__tests__/commercial-licenses-client.test.ts` | serialización, HTTP, fallas y releases |
| `server/__tests__/commercial-licenses-cache.test.ts` | claves, aislamiento y política de caché |
| `tests/fixtures/commercial-licenses/` | fixtures acordados con el productor |

El transporte autentica con `X-Service-Key` exclusivamente desde runtime
servidor. La configuración se obtiene de `CHILE_COMMERCIAL_LICENSES_BASE_URL`,
`CHILE_COMMERCIAL_LICENSES_SERVICE_KEY` y, opcionalmente,
`CHILE_COMMERCIAL_LICENSES_TIMEOUT_MS`; no existe equivalente `VITE_*`.

## Interfaz

```ts
interface CommercialLicensesClient {
  getPatent(params: PatentGetParams): Promise<PatentGetResponse>;
  getPatentTimeline(params: PatentTimelineParams): Promise<PatentTimelineResponse>;
  searchPatents(params: PatentSearchParams): Promise<PatentSearchResponse>;
  getPatentCoverage(params: PatentCoverageParams): Promise<PatentCoverageResponse>;
  resolveEstablishment(
    request: EstablishmentResolveRequest,
    options?: { releaseId?: string },
  ): Promise<EstablishmentResolveResponse>;
}
```

Todas las operaciones aceptan un `releaseId` opcional. Cuando se entrega, la
respuesta debe usar exactamente ese release. Omitirlo solicita el último release
bueno al productor; nunca autoriza al cliente a inventar un fallback.

`getPatent` y `getPatentTimeline` reciben `sourceLicenseId`: la identidad estable
es `(municipalityCut, sourceLicenseId)`, no el UUID interno del productor. Search
no acepta RUT como filtro, limita cada página a 100 y sólo utiliza representación
`public` durante el piloto.

## Transporte

- construir URLs con `URL` y `URLSearchParams`;
- enviar `Accept: application/json` y un `User-Agent` identificable;
- usar timeout inicial de ocho segundos;
- no hacer retries automáticos hasta acordar presupuesto y semántica con el productor;
- no registrar cuerpos, direcciones, RUT ni parámetros sensibles;
- distinguir configuración, timeout, red, HTTP, payload inválido y schema incompatible;
- conservar la diferencia entre objeto ausente, release inexistente y brecha de cobertura.

## Validación previa al consumo

El cliente rechaza una respuesta antes de devolverla o cachearla si:

- productor o producto no coinciden;
- el release no está promovido;
- la versión no es compatible;
- faltan campos requeridos, incluyendo `null` explícitos;
- un titular natural conserva ID, RUT o nombre fuente;
- un match `resolved` no selecciona un candidato existente;
- un match ambiguo o no resuelto contiene una selección;
- una referencia material no puede resolverse en `source_refs`;
- el productor responde con otro release cuando la consulta estaba fijada.

## Caché

El fallback de disponibilidad pertenece a Inteligencia Inmobiliaria. Chile Monitor
sólo interpreta `current` o `stale_last_good` y almacena respuestas que hayan pasado
todos los validadores.

La clave incluirá operación, release y todos los parámetros variables mediante un
hash SHA-256 de la forma normalizada. No contendrá RUT, dirección ni IDs fuente en
claro. Consultas fijadas y `latest` nunca compartirán clave. Releases promovidos e
inmutables podrán tener TTL mayor que consultas sin release.

## Pruebas mínimas

1. Las cinco operaciones serializan método, path, query, headers y body correctos.
2. Los parámetros ausentes no se envían.
3. Timeout, red, JSON inválido y errores HTTP quedan tipados.
4. Se rechazan metadata, privacidad, release y schema incompatibles.
5. Se comprueban los invariantes de resolución y `source_ref`.
6. `stale_last_good` permanece visible para el expediente.
7. Un release fijado nunca cae silenciosamente a otro.
8. Sólo un éxito validado entra al caché.
9. Las claves no revelan datos de consulta.
10. Los fixtures contractuales cubren AC-01 a AC-18.

## Gate de implementación

Antes de crear código productivo se requiere:

1. issue de implementación para ejecutar el preflight obligatorio;
2. Node 24 activo, como exige el repositorio;
3. URL privada de Enigma configurada fuera de Git;
4. autenticación y rotación de credenciales acordadas fuera de Git;
5. major de `schema_version` soportada;
6. release y fixtures reales del productor.

La verificación prevista es:

```bash
npm run --silent agent:preflight -- --issue <ISSUE>
./node_modules/.bin/vitest run \
  server/__tests__/commercial-licenses-contract.test.ts \
  server/__tests__/commercial-licenses-client.test.ts \
  server/__tests__/commercial-licenses-cache.test.ts
npm run typecheck:api
npm run lint:boundaries
git diff --check
git status --short
```

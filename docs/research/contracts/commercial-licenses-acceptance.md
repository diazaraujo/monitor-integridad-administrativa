# Aceptación del data product `commercial-licenses`

**Versión:** 0.1.0

**Productor:** Inteligencia Inmobiliaria

**Consumidor:** Chile Monitor

**Piloto:** Purranque (`10303`), release promovido `purranque-2026-s1`, último
release bueno `purranque-2025-s2`.

Esta pauta complementa
[`commercial-licenses.openapi.yaml`](commercial-licenses.openapi.yaml). Una tabla,
una descarga o un endpoint sin estos controles no constituye una entrega aceptada.

Los diez escenarios mínimos tienen una representación sintética y procesable en
[`commercial-licenses.fixtures.yaml`](commercial-licenses.fixtures.yaml).

La autenticación acordada es `X-Service-Key` desde runtime servidor. La URL, la
clave y su rotación se configuran fuera de Git mediante
`CHILE_COMMERCIAL_LICENSES_BASE_URL` y
`CHILE_COMMERCIAL_LICENSES_SERVICE_KEY`; ningún secreto usa prefijo `VITE_*`.
El endpoint privado del piloto es `http://10.0.0.3:8130/api/integrity/`; la URL no
contiene credenciales y `X-Service-Key` permanece exclusivamente server-side.

Las cinco capabilities canónicas y sus `operationId` compatibles son:

| Capability | operationId |
|---|---|
| `patents.get` | `patentsGet` |
| `patents.search` | `patentsSearch` |
| `patents.timeline` | `patentsTimeline` |
| `patents.coverage` | `patentsCoverage` |
| `establishments.resolve` | `establishmentsResolve` |

La identidad estable de consulta es `(municipality_cut, source_license_id)`. Los
UUID internos del productor son opacos. La búsqueda admite estado, tipo, actividad,
dirección, establecimiento, predio y fecha efectiva; no admite RUT como filtro. El
cursor es opaco y el límite máximo es 100. Durante el piloto sólo se solicita y
acepta la representación `public`.

## Evidencia de sincronización

Esta versión incorpora la revisión del productor en el commit
`144d9c5ed9ccfeb8f9a5e50afc8f1c307cb9cda3` y el recibo
`phase4.248-contract-review-production-receipt-2026-09-01`. El smoke del productor
confirmó HTTP 200 para las cinco capabilities, cursor en `patents.search`, 770
registros recibidos en `patents.coverage`, cero RUT/tax ID no vacíos en la muestra
pública y HTTP 401 sin credencial. El recibo no contiene la credencial ni payloads
de patentes; tampoco autoriza merge o despliegue del consumidor.

## Insumos para la prueba

Inteligencia Inmobiliaria debe entregar un ambiente de prueba y un fixture estable con:

1. una patente vigente y definitiva;
2. una patente provisoria próxima a vencer;
3. una patente con cambio histórico de titular, giro o domicilio;
4. una patente asociada inequívocamente a establecimiento y predio;
5. una patente con dos o más candidatos prediales plausibles;
6. una patente sin match predial;
7. una patente con un requisito o período sin cobertura;
8. una patente cuyo titular fuente sea persona natural;
9. una patente con clausura o reapertura respaldada por acto;
10. un ID válido pero ausente del universo publicado.

Cada fixture debe indicar qué resultado se espera y qué `source_ref` permite
comprobarlo. Los datos personales del fixture deben ser sintéticos o estar
correctamente restringidos.

## Gates bloqueantes

| ID | Prueba | Resultado exigido |
|---|---|---|
| AC-01 | Consultar sin `release_id` | responde desde el último release bueno e informa el `release_id` exacto |
| AC-02 | Repetir con ese `release_id` | devuelve el mismo contenido semántico y las mismas referencias |
| AC-03 | Consultar un release inexistente | error explícito `release_not_found`; nunca cambia silenciosamente al release actual |
| AC-04 | Inspeccionar metadata | `producer`, `product`, `schema_version`, `data_as_of`, promoción y quality report presentes |
| AC-05 | Revisar una dirección normalizada | conserva siempre `address.original` junto al valor normalizado |
| AC-06 | Revisar titular persona natural | no expone RUT, nombre fuente, correo, teléfono ni otro identificador personal en el release público |
| AC-07 | Resolver match inequívoco | retorna `resolved`, método, confianza, release predial y fuentes |
| AC-08 | Resolver match ambiguo | retorna `ambiguous`, todos los candidatos pertinentes y `selected_candidate_id: null` |
| AC-09 | Resolver sin candidato | retorna `unresolved`; no crea un predio ni interpreta incumplimiento |
| AC-10 | Consultar historia | distingue `effective_at` de `observed_at` y no aplica el titular o domicilio actual retrospectivamente |
| AC-11 | Verificar hechos administrativos | clausura, reapertura, revocación y similares apuntan a acto o fuente municipal |
| AC-12 | Verificar dato ausente | informa `data_gap` o limitación equivalente; no devuelve un falso estado negativo |
| AC-13 | Consultar cobertura | declara período, tipos, campos, registros, frescura y brechas por municipio |
| AC-14 | Simular caída del release nuevo | sirve `stale_last_good` con el último release bueno o falla de forma visible si no existe |
| AC-15 | Buscar con paginación | no duplica ni pierde resultados al recorrer cursores sobre un release fijado |
| AC-16 | Auditar fuente | cada hecho material puede recorrerse hasta un `source_ref` incluido en la respuesta |
| AC-17 | Cambiar versión incompatible | Chile Monitor puede detectarla antes de abrir o actualizar un caso |
| AC-18 | Revisar contabilidad del quality report | cumple `IN = OUT + DROP` y cada descarte tiene causa |

Privacidad, autenticación, reproducibilidad, trazabilidad, integridad del release y
prohibición de fallback silencioso nunca pueden declararse no aplicables. Sólo un
gate de cobertura material puede aceptarse como brecha cuando la fuente municipal
no entrega ese dominio, la limitación aparece en `patents.coverage` y no se infiere
un estado positivo ni negativo desde su ausencia.

Además del schema, las pruebas automatizadas deben comprobar invariantes que
OpenAPI no puede expresar por sí solo:

- unicidad e integridad referencial de IDs y `source_ref`;
- orden cronológico y validez de intervalos temporales;
- `effective_at <= observed_at` cuando ambas fechas sean conocidas;
- pertenencia del candidato seleccionado al conjunto devuelto;
- estabilidad del cursor cuando se publica un release concurrente;
- rechazo de un cursor usado con otro release o filtros;
- prohibición de cambiar a `latest` cuando se pidió un `release_id` exacto.

## Prueba de privacidad

Sobre la representación pública se debe buscar, como mínimo:

- RUT de titulares clasificados como persona natural;
- nombres fuente de titulares naturales;
- correos y teléfonos personales;
- nombres o identificadores de denunciantes y trabajadores;
- observaciones internas municipales no publicables.
- filtraciones indirectas en `source_record_id`, URI, explicaciones, nombres de
  establecimiento y otros textos libres.

El resultado aceptable es cero ocurrencias. La representación municipal
restringida se evalúa por separado y no puede ser alcanzable con credenciales del
cliente público.

## Prueba temporal

Para el fixture con cambio histórico se consultan al menos tres fechas: antes del
cambio, durante su vigencia y después. En cada fecha deben coincidir:

- titular;
- establecimiento y domicilio;
- giro informado;
- estado de patente;
- relación con predio, si la fuente permite resolverla históricamente;
- fuente y release utilizados.

Si un atributo histórico no puede reconstruirse, se informa como limitación. No se
rellena con el valor actual.

## Evidencia de aceptación

La revisión conjunta debe conservar:

1. versión firmada del contrato;
2. identificador del release probado;
3. reporte de calidad de ese release;
4. resultados de AC-01 a AC-18;
5. fixtures o hashes de fixtures;
6. lista de limitaciones aceptadas y responsable de resolverlas;
7. fecha, productor, revisor y decisión de promoción.

## Salida

La entrega queda en uno de estos estados:

- `accepted_for_shadow`: cumple todos los gates y puede alimentar expedientes sin acciones reales;
- `accepted_with_published_gaps`: sólo presenta brechas de fuente expresamente aceptadas y visibles;
- `rejected_contract`: incumple forma, versionado o reproducibilidad;
- `rejected_quality`: incumple trazabilidad, privacidad, temporalidad o matches;
- `blocked_by_source`: el municipio aún no entregó el insumo y la brecha está documentada.

Sólo `accepted_for_shadow` y `accepted_with_published_gaps` habilitan el Bloque D
del plan. Ninguno habilita por sí mismo decisiones administrativas automáticas.

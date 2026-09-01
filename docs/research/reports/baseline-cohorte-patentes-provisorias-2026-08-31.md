# Baseline de cohorte histórica de patentes provisorias

Fecha de ejecución: 2026-08-31
Cohorte: `provisional-licenses-2026-08-31-v1`
Builder: `historical-cohort-v0.1.0`

## Resultado

| Outcome | Casos |
|---|---:|
| `reproduced` | 0 |
| `insufficient_evidence` | 7 |
| `failed` | 13 |
| Total | 20 |

El gate de al menos 16 casos reproducidos **no pasa**. La corrida fue read-only y persistió cero
`ReviewCase`.

## Hallazgos

Los 20 registros fueron entregados por `commercial-licenses` como patentes provisorias y los 20
incluyeron un match predial `unresolved`.

- Siete casos conservaron un establecimiento vigente a la fecha efectiva. Sus EvidencePackets se
  construyeron, pero quedaron en `insufficient_evidence` con los gaps `coverage_gap` y
  `unresolved_match`: dos de Purranque y cinco de Renca.
- Siete casos de Purranque no incluyeron ningún establecimiento en la respuesta upstream.
- Otros seis casos incluyeron un establecimiento que no estaba vigente a la fecha efectiva: uno de
  Purranque y los cinco de Lo Barnechea.
- Esos trece casos no pudieron materializar una resolución establecimiento–predio dentro del
  EvidencePacket y fallaron la expectativa `parcel_match_status`.

## Interpretación

El baseline no acredita incumplimientos. Mide dos brechas de evidencia diferentes:

1. existencia y vigencia temporal del establecimiento asociado a la patente;
2. resolución concluyente del establecimiento hacia el predio.

Que la respuesta contenga un candidato predial `unresolved` sin un establecimiento vigente no basta
para crear una relación temporal en el expediente. El monitor conserva esa diferencia en vez de
inferir el vínculo.

## Feedback para Inteligencia Inmobiliaria

Para volver a correr la misma cohorte se necesita un release promovido que:

- complete el establecimiento de los siete casos de Purranque que hoy no lo entregan;
- revise los intervalos de vigencia de un caso de Purranque y cinco de Lo Barnechea;
- mantenga visibles las ambigüedades mientras mejora el match establecimiento–predio;
- explique en el quality report cuántos casos cambian y por qué;
- preserve los mismos identificadores fuente o publique una correspondencia explícita.

La cohorte y su umbral no deben modificarse para mejorar artificialmente el resultado. Después de
un nuevo release se ejecuta el mismo comando y se comparan outcomes y hashes.

## Reproducción

```bash
npm run integrity:evaluate-historical-cohort
```

El proceso requiere `CHILE_COMMERCIAL_LICENSES_BASE_URL` y
`CHILE_COMMERCIAL_LICENSES_SERVICE_KEY`. La salida deliberadamente contiene identificadores de la
cohorte, outcomes, hashes y códigos de brecha, pero no valores personales ni mensajes upstream.

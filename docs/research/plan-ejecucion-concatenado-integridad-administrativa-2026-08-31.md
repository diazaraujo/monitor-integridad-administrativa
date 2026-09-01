# Plan de ejecución concatenado — Integridad administrativa

Fecha de corte: 2026-08-31
Proyecto: `monitor-integridad-administrativa`

## Objetivo

Validar un flujo especializado de revisión de patentes comerciales provisorias, desde releases
municipales trazables hasta un outcome administrativo humano, sin convertir señales en decisiones
automáticas ni duplicar la ingesta de Inteligencia Inmobiliaria.

## Estado de entrada

- Inteligencia Inmobiliaria es el productor de `commercial-licenses` y de los cruces con
  establecimiento y predio.
- La actualización automática y el estado del último release bueno están operativos.
- La gobernanza de nuevas fuentes municipales continúa en paralelo en el repositorio productor.
- Este monitor ya dispone del cliente read-only, contratos de datos, `EvidencePacket`, apertura de
  casos y health del productor.
- La autoridad jurídica sigue siendo municipal; el monitor registra revisiones y outcomes.

## Secuencia única

### 0. Base operativa — entregada

**Recibe:** releases promovidos de patentes y capability read-only.
**Entrega:** cliente validado, pinning de release, EvidencePacket reproducible y health operacional.
**Gate:** ninguna reingesta en el consumidor y último release bueno visible.

### 1. Gobernanza de candidatos upstream — trabajo paralelo

**Responsable:** Inteligencia Inmobiliaria.
**Trabajo:** convertir fuentes candidatas en canaries, aprobar calidad y promover sólo aquellas que
cumplan sus contratos.
**Entrega:** nuevos releases municipales gobernados.
**Gate:** procedencia, contabilidad, cobertura, privacidad y rollback aprobados por el productor.

El monitor no modifica ni replica este trabajo. Consume únicamente releases promovidos.

### 2. Cohorte histórica de patentes provisorias — en curso

**Recibe:** 20 identificadores fijados a release y fecha efectiva: 10 Purranque, 5 Lo Barnechea y
5 Renca.
**Trabajo:** construir los 20 EvidencePackets en modo read-only y clasificar cada caso como
`reproduced`, `insufficient_evidence` o `failed`.
**Entrega:** reporte reproducible con hashes, gaps y cero `ReviewCase` persistidos.
**Gate:** al menos 16 de 20 casos reproducidos con evidencia suficiente.

Un match predial ambiguo o no resuelto es un gap explícito. No se interpreta como incumplimiento.

### 3. Cierre de brechas de evidencia

**Recibe:** baseline de la cohorte.
**Trabajo:** devolver al productor las brechas de match, timeline o cobertura; volver a ejecutar
exactamente la misma cohorte contra releases nuevos.
**Entrega:** comparación entre releases y explicación de cada cambio de outcome.
**Gate:** 16/20 reproducidos, sin expectativas modificadas para esconder fallas.

### 4. Actions, RBAC y auditoría en shadow

**Recibe:** EvidencePackets que aprobaron el gate.
**Trabajo:** probar asignación, solicitudes, explicaciones alternativas, recomendaciones,
correcciones, registro de decisión oficial y cierre.
**Entrega:** ledger append-only y matriz actor–objeto–propiedad–acción.
**Gate:** ninguna Action adquiere una facultad municipal y toda transición tiene actor, fundamento,
evidencia y reversa operacional.

### 5. Piloto vivo de provisorias

**Recibe:** workflow shadow aprobado y municipio socio.
**Trabajo:** operar una cohorte acotada con revisión humana, rectificación y derivación formal.
**Entrega:** outcomes administrativos trazables y evaluación de carga, tiempos y falsos positivos.
**Gate:** decisión de escala basada en outcomes, no en volumen de alertas.

## Reglas que atraviesan todos los bloques

- Cada consumidor fija `producer`, `release_id`, `schema_version`, `data_as_of` y source refs.
- La ausencia de un dato es una brecha de cobertura, no evidencia de incumplimiento.
- Ningún caso histórico ejecuta Actions ni persiste expedientes operacionales.
- La cohorte técnica contiene sólo identificadores fuente; no incorpora datos de titulares,
  domicilios ni otros campos personales.
- La promoción de nuevas fuentes permanece en Inteligencia Inmobiliaria.
- El paso siguiente sólo comienza cuando el gate anterior queda medido y registrado.

## Punto de control actual

El baseline v1 fue ejecutado: `0 reproduced`, `7 insufficient_evidence` y `13 failed`; el gate 16/20
permanece fallido. Los veinte casos tienen match predial no resuelto; trece además carecen de un
establecimiento vigente que permita representar esa resolución dentro del EvidencePacket.

El siguiente paso es entregar estas brechas al productor y repetir exactamente la misma cohorte
sobre un nuevo release promovido. El detalle está en
`reports/baseline-cohorte-patentes-provisorias-2026-08-31.md`.

# Runbook de aceptación — revisión municipal de patentes

Este runbook completa los bloques E y F del caso Luis Cordero después de fusionar la vertical
funcional. El destino es exclusivamente Enigma, contenedor `monitor-integridad-main`, puerto
`8144`. No modifica el Chile Monitor genérico ni los stores de los productores.

## Precondiciones protegidas

1. Crear o seleccionar el deployment Convex productivo existente. No crear otro proyecto.
2. Configurar `CONVEX_DEPLOY_KEY` como secret de GitHub Actions.
3. Generar un valor independiente para `REVIEW_CASE_STORAGE_SECRET` y guardarlo tanto en Convex
   como en el archivo privado de entorno del contenedor de Enigma.
4. Configurar `CONVEX_SITE_URL` en Enigma.
5. Configurar `INTEGRITY_ACTOR_SCOPES_JSON` con los IDs autenticados reales y un único CUT por
   actor. No registrar identidades, tokens ni secretos en GitHub.

El operador comprueba sólo presencia, nunca imprime valores. Ninguna variable de este flujo usa
prefijo `VITE_`.

## Despliegue y autoridad

Una vez que `main` esté verde, verificar que `Convex Deploy` ejecute el deploy y que
`reviewCases:_seedReviewWriteLock` termine correctamente. Luego provisionar al menos:

- un actor `rentas` o `control` para abrir/revisar;
- un actor exclusivamente `coordinator` para asignar y cerrar;
- el revisor elegido (`rentas`, `control` o `fiscalizacion`).

Cada actor se provisiona mediante la mutación interna `reviewCases:provisionWorkflowActor`, con
`actorId`, `municipalityCut`, `authorityVersion`, `roles` y `validFrom`. La versión debe aumentar
para cualquier cambio posterior. La mutación crea en una sola transacción los fences compatibles
de apertura, asignación, elegibilidad y Actions.

## Recorrido de aceptación

1. Abrir `http://<enigma>:8144/integrity` con una sesión municipal autenticada.
2. Buscar una patente provisoria y anotar el `release_id` mostrado.
3. Abrir la revisión y anotar `case_id`, versión y hash del EvidencePacket.
4. Ingresar como coordinador, asignar al revisor y verificar la nueva versión.
5. Ingresar como revisor y registrar una solicitud, explicación o recomendación.
6. Registrar una decisión externa únicamente con su outcome y referencia oficial.
7. Cerrar el caso y comprobar que recomendación, acto oficial y cierre son eventos distintos.
8. Reiniciar sólo `monitor-integridad-main` y volver a leer la versión final desde `/integrity`.
9. Confirmar `Cache-Control: no-store` en búsqueda, expediente y mutaciones.

## Receipt requerido

Guardar fuera del repositorio cualquier dato sensible. El receipt versionado incluye únicamente:

- SHA de `main` e imagen desplegada;
- CUT, ID fuente de patente y release fijado;
- `case_id`, versión final y hash del EvidencePacket;
- tipos e IDs de Actions, sin notas ni contenido de evidencia;
- outcome code y referencia pública del acto, cuando corresponda;
- resultado del reread posterior al reinicio;
- confirmación de que ninguna brecha se transformó en incumplimiento.

La aceptación no está completa si falta configuración productiva, si el caso no sobrevive al
reinicio o si el recorrido exige terminal o acceso directo a Convex.

# Plan de ejecución concatenado — caso Luis Cordero

Fecha de corte: 2026-08-31
Proyecto: `monitor-integridad-administrativa`
Destino operacional: Enigma, contenedor `monitor-integridad-main`, puerto `8144`

## Resultado buscado

Una persona municipal debe poder revisar una patente comercial desde una cola hasta su cierre,
con evidencia trazable, intervención humana y registro append-only. El producto materializa el
enfoque administrativo discutido con Luis Cordero: usar facultades municipales ordinarias sobre
patentes, permisos, fiscalización y actos, sin presentar una señal como delito ni automatizar una
sanción.

La prueba termina cuando el recorrido completo funciona en Enigma sin terminal ni acceso directo a
la base de datos:

```text
buscar patente
  -> abrir revisión y fijar releases
  -> construir EvidencePacket
  -> asignar revisor
  -> registrar análisis o pedir antecedente
  -> recomendar inspección o derivación, si corresponde
  -> registrar el acto externo autorizado
  -> cerrar con outcome y auditoría
```

## Contrato entre proyectos

- Inteligencia Inmobiliaria produce `commercial-licenses` y resuelve
  establecimiento–dirección–rol–predio.
- Los otros productores entregan identidad societaria, contexto municipal, ambiente, compras y
  fundamento jurídico mediante capabilities read-only.
- Este repositorio no vuelve a ingerir ni reparar esas fuentes. Fija los releases que recibió,
  muestra sus gaps y continúa el workflow cuando la evidencia disponible permite una revisión.
- Una ausencia upstream se representa como brecha de cobertura; nunca como incumplimiento.
- Los datos públicos de patentes usados para fiscalización no abren un bloque adicional de
  privacidad en este caso de uso. Las credenciales y notas operacionales internas sí permanecen
  protegidas.

La cohorte histórica sigue siendo un instrumento de calidad del productor. Su baseline
`0 reproduced / 7 insufficient_evidence / 13 failed` y el objetivo 16/20 no bloquean la entrega del
workflow municipal: los productores pueden cerrar esas brechas en paralelo y el monitor consume
los releases promovidos posteriores.

## Secuencia ejecutable

### A. Base y contratos — entregado

**Recibe:** releases promovidos de patentes.

**Entrega:** cliente `commercial-licenses`, pinning de release, contratos temporales,
`EvidencePacket`, health del productor y persistencia inicial de `ReviewCase`.

**Gate:** no hay reingesta en el consumidor; source refs, gaps y último release bueno son visibles.

### B. Frontera HTTP operacional

**Recibe:** los servicios de dominio ya implementados.

**Trabajo:** exponer búsqueda/cola, apertura, lectura de expediente y asignación mediante handlers
autenticados. La identidad y el rol se derivan en el servidor; el body no puede suplantar al actor.

**Entrega:** API probada para recorrer desde una patente hasta un caso asignado.

**Gate:** autorización por action, errores upstream explícitos, idempotencia y ningún acceso directo
a tablas internas desde el cliente.

### C. Actions, outcome y cierre

**Recibe:** un caso asignado con EvidencePacket fijado.

**Trabajo:** completar solicitud de antecedentes, corrección, explicación alternativa,
recomendación de inspección/derivación, registro de decisión oficial y cierre.

**Entrega:** ledger append-only con actor, fecha, fundamento, evidencia, transición y outcome.

**Gate:** una recomendación nunca aparece como acto oficial; sólo un rol autorizado registra el
acto externo y toda mutación rechazada deja el estado anterior intacto.

### D. Interfaz especializada

**Recibe:** la API operacional.

**Trabajo:** construir cola, búsqueda, expediente, panel de acciones y timeline dentro de
`monitor-integridad-administrativa`, sin modificar la experiencia del Chile Monitor genérico.

**Entrega:** recorrido completo utilizable por Rentas, Control/Jurídica y fiscalización.

**Gate:** estados de carga, degradación, ambigüedad y falta de evidencia son distinguibles; cada
botón refleja la facultad del rol activo.

### E. Persistencia y aceptación en Enigma

**Recibe:** vertical funcional y configuración operacional.

**Trabajo:** conectar la persistencia definitiva, ejecutar una patente provisoria de extremo a
extremo, reiniciar el servicio y volver a leer el expediente.

**Entrega:** evidencia de aceptación con `review_case_id`, releases, actions, outcome, SHA desplegado
y resultado tras reinicio.

**Gate:** el caso sobrevive al reinicio, su historia es reproducible y ninguna brecha upstream fue
convertida silenciosamente en una certeza.

### F. Autodeploy seguro — preparado en este cambio

**Recibe:** un commit nuevo en `main`.

**Trabajo:** un timer en Enigma consulta `main`; sólo continúa cuando el status `gate` del SHA es
`success`. Construye una imagen inmutable, levanta un canary en loopback, prueba nginx + sidecar,
reemplaza únicamente `monitor-integridad-main:8144` y conserva el contenedor previo como rollback.

**Entrega:** SHA exacto desplegado y estado local auditable.

**Gate:** un build, canary o smoke fallido mantiene/restaura la versión anterior. Vercel, el Chile
Monitor genérico en `8142` y los contenedores productores quedan fuera del alcance.

## Cadena de despliegue

```text
PR -> checks requeridos -> merge a main -> gate=success
   -> timer Enigma -> fetch SHA -> build SHA
   -> canary loopback -> health OK
   -> cutover sólo 8144 -> smoke OK
   -> conservar rollback + registrar deployed SHA
```

El autodeploy no necesita exponer SSH ni almacenar una llave de Enigma en GitHub. La máquina inicia
la consulta desde su red privada. Si GitHub no responde, el gate está pendiente o la configuración
local no existe, no hay despliegue.

## Definition of Done

- Un usuario municipal completa el flujo desde búsqueda hasta cierre desde la interfaz.
- Cada expediente fija los releases y conserva evidencia, gaps y explicaciones alternativas.
- El actor proviene de la sesión del servidor y RBAC cubre objeto y action.
- Recomendaciones, actuaciones externas y outcomes son conceptos separados.
- El ledger es append-only y el caso persiste después de reiniciar.
- La caída de un productor muestra degradación o el último release bueno.
- `main` verde se publica automáticamente sólo en Enigma `8144`.
- El canary y el rollback fueron probados al menos una vez.
- La evidencia final identifica commit, imagen y caso aceptado.

## Orden inmediato

1. Terminar B y C en el issue #23.
2. Construir D sobre esos contratos, sin mocks que oculten gaps.
3. Ejecutar E con una patente provisoria real disponible.
4. Instalar una vez el agente descrito en `ops/enigma/README.md`.
5. Fusionar únicamente con checks verdes; desde ese punto F opera automáticamente.

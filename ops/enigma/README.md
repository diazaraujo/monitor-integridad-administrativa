# Autodeploy de Integridad Administrativa en Enigma

Este agente pull despliega sólo `monitor-integridad-main` en el puerto `8144`. No administra
Vercel, el Chile Monitor genérico (`8142`) ni los productores conectados a la red Docker.

## Instalación única

En Enigma, preservar la configuración del contenedor especializado actual sin imprimirla:

```bash
install -d -m 700 "$HOME/.config/monitor-integridad-administrativa"
umask 077
docker inspect monitor-integridad-main \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  > "$HOME/.config/monitor-integridad-administrativa/container.env"
```

Desde un checkout del commit ya fusionado a `main`:

```bash
./scripts/install-enigma-autodeploy.sh
```

El instalador copia el ejecutable a `~/.local/lib`, habilita el timer de usuario y ejecuta una
primera reconciliación. El usuario `antonio` debe conservar `loginctl enable-linger` para que el
timer funcione sin una sesión abierta.

## Comportamiento

Cada cinco minutos el servicio:

1. obtiene el SHA actual de `main`;
2. consulta el status GitHub `gate` de ese SHA;
3. no hace nada salvo que el gate sea `success`;
4. construye `monitor-integridad-administrativa:<sha>`;
5. valida un canary publicado sólo en loopback;
6. reemplaza `monitor-integridad-main:8144`;
7. conserva la versión anterior como `monitor-integridad-rollback`.

Una falla antes del cutover no toca producción. Una falla después del cutover restaura y reinicia
el contenedor anterior. El SHA aceptado queda en
`~/.local/state/monitor-integridad-autodeploy/deployed-sha`.

## Operación

```bash
systemctl --user status monitor-integridad-autodeploy.timer
journalctl --user -u monitor-integridad-autodeploy.service -n 200 --no-pager
systemctl --user start monitor-integridad-autodeploy.service
cat "$HOME/.local/state/monitor-integridad-autodeploy/deployed-sha"
docker inspect monitor-integridad-main \
  --format '{{index .Config.Labels "cl.monitor.deployed-sha"}}'
```

Para pausar nuevos despliegues sin detener la versión activa:

```bash
systemctl --user disable --now monitor-integridad-autodeploy.timer
```

## Rollback manual

El script hace rollback automáticamente ante un smoke fallido. Si una regresión aparece después:

```bash
systemctl --user disable --now monitor-integridad-autodeploy.timer
docker stop --time 30 monitor-integridad-main
docker rename monitor-integridad-main monitor-integridad-failed
docker rename monitor-integridad-rollback monitor-integridad-main
docker start monitor-integridad-main
curl --fail http://127.0.0.1:8144/api/sidecar-health
```

No volver a habilitar el timer hasta que `main` contenga el fix o el commit defectuoso deje de ser
el head promovible.

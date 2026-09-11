# bbbbb

[English](README.md) | [简体中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md)

<p align="center"><img src="assets/readme/bbbbb-logo.svg" width="128" alt="Logotipo de bbbbb"></p>

Recibe un aviso cuando tengas que intervenir.

bbbbb («B-five») guarda las actualizaciones de tus agentes de programación y servicios en una bandeja privada del iPhone. Puedes consultar el teléfono cuando termina una compilación, un agente tiene una pregunta o un despliegue necesita aprobación.

![Demo: una petición curl y un comando envían actualizaciones a la bandeja del iPhone](assets/readme/bbbbb-demo.svg)

<p align="center"><a href="https://apps.apple.com/us/app/bbbbb-coding-agent-alerts/id6791204016"><img src="assets/readme/download-on-the-app-store.svg" height="60" alt="Descargar en el App Store"></a></p>

[Visita bbbbb.app](https://bbbbb.app/?lang=es)

Las actualizaciones siguen en la app cuando desaparece la notificación:

- Atención conserva preguntas, errores, aprobaciones y tareas hasta que las marcas como resueltas.
- Actividad permite consultar las demás actualizaciones.
- Las fuentes pueden enviar, pero nunca leer la bandeja ni ejecutar comandos.

Conecta con un QR temporal o un código de seis dígitos y envía por HTTP. La CLI opcional ejecuta comandos y envía su resultado cuando terminan.

## Próximamente: v1.5

La web ya está disponible en inglés, chino simplificado, español, japonés, alemán, francés y portugués de Brasil. La versión 1.5 incorporará estos idiomas a la app para iPhone, mejorará el guardado del historial local y tratará con más seguridad el texto que una hoja de cálculo podría interpretar como una fórmula al abrir un CSV. El precio y las ventajas de Plus se mantienen. La actualización de la app aún no está disponible en el App Store.

## Primeros pasos

### HTTP, sin necesidad de CLI

Dile al agente: `Set up bbbbb at bbbbb.app/setup`. Preparará una fuente HTTP, te pedirá que escanees un QR o introduzcas un código en el iPhone para aprobar la conexión, guardará el enlace de forma privada y enviará un mensaje de prueba. Para apps y automatizaciones, elige «Conectar una app o automatización» en el iPhone.

Después, envía mediante la variable guardada:

```sh
curl -X POST "$BBBBB_SOURCE_URL"
```

El remitente elige la categoría: Atención puede requerir una respuesta; el resto es Actividad. Mantén el enlace de la fuente fuera de las instrucciones y los registros.

### CLI opcional

```sh
npm install --global @bbbbbapp/cli
bbbbb setup --name "My Mac"
bbbbb run -- npm test
```

Si npm no está disponible, usa una versión verificada de [GitHub Releases](https://github.com/xxsang/bbbbb/releases). Consulta [Instalar la CLI](docs/guides/CLI_SOURCES.md), en inglés.

### Skill para el agente

Instala:

```sh
sh scripts/install-bbbbb-notify-skill.sh
```

Puedes decirle:

> Usa bbbbb para esta tarea. Avísame cuando termine. Envía Atención solo si tengo que intervenir. No envíes actualizaciones de progreso.

## Guías

Las guías del sitio permiten cambiar de idioma. La documentación técnica del repositorio sigue en inglés.

| Tarea | Guía |
| --- | --- |
| Elegir la configuración | [Instalación](docs/guides/INSTALLING.md) |
| Agente, webhook o script | [Fuente HTTP](docs/guides/HTTP_SOURCES.md) |
| Instalar la CLI | [Fuente CLI](docs/guides/CLI_SOURCES.md) |
| macOS, Linux o Windows | [Guías por plataforma](https://bbbbb.app/docs/?lang=es) |
| Alojamiento propio y operaciones | [Operaciones](docs/launch/OPERATIONS.md) |

## Planes y límites

La versión gratuita incluye todas las funciones básicas: hasta 1.000 actualizaciones en cualquier periodo de 30 días. Las 100 más recientes se guardan cifradas hasta siete días para sincronizarlas cuando vuelvas a tener conexión.

Plus cuesta US$4.99 una sola vez durante los primeros 60 días tras el lanzamiento e incluye futuras funciones. No es una suscripción y las funciones básicas siguen siendo gratis. Desde el 26 de octubre de 2026, el precio normal será US$6.99, también con un solo pago.

Plus aumenta el límite a 10.000 actualizaciones en cualquier periodo de 30 días, conserva las 500 más recientes cifradas hasta 30 días y permite exportar JSON/CSV desde el dispositivo.

No hay cuota diaria. Cada bandeja comparte un límite de seguridad de 20 envíos por minuto. Añadir fuentes no aumenta la capacidad.

## Privacidad

Los eventos CLI salen cifrados del emisor; los eventos HTTP se cifran antes de almacenarse. La versión gratuita conserva los 100 más recientes hasta siete días y Plus los 500 más recientes hasta 30 días. Las fuentes no pueden leer el historial. Si pierdes un aviso, puedes consultar la actualización en la app.

El núcleo para desarrolladores usa la [licencia Apache 2.0](LICENSE). La app de iPhone se ofrece por separado.

<sub>Apple, el logotipo de Apple y App Store son marcas comerciales de Apple Inc., registradas en EE. UU. y otros países y regiones.</sub>

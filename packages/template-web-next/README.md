# @lakutata/template-web-next

The Next.js web template of the [lakutata](https://github.com/lakutata/lakutata) projects: the service serves its HTTP API
under `/api` and a Next.js application (rendered on the server) from one process, one port and one Docker image. The
project is a workspace: `packages/app` is the service, `packages/ui` the Next.js application and its `renderUI` handler.

```bash
npx @lakutata/cli create --name my-app --template web-next
```

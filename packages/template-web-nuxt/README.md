# @lakutata/template-web-nuxt

The Nuxt web template of the [lakutata](https://github.com/lakutata/lakutata) projects: the service serves its HTTP API
under `/api` and a Nuxt application (rendered on the server by its Nitro build) from one process, one port and one Docker
image. The project is a workspace: `packages/app` is the service, `packages/ui` the Nuxt application and its `renderUI`
handler.

```bash
npx @lakutata/cli create --name my-app --template web-nuxt
```

# @lakutata/template-web-react

The React web template of the [lakutata](https://github.com/lakutata/lakutata) projects: the service serves its HTTP API
under `/api` and a React single-page application built with Vite (`StaticUI`), from one process, one port and one Docker
image. The project is a workspace: `packages/app` is the service, `packages/ui` the application.

```bash
npx @lakutata/cli create --name my-app --template web-react
```

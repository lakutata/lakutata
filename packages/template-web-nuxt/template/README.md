# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) web application. The project is a workspace: `packages/app` is the
service, serving its API under `/api` and the Nuxt application of `packages/ui` (rendered by its Nitro build); the other
packages are added in `packages/`. The routes of the Nuxt application are not under `/api`, which belongs to the actions;
its pages call the API from the browser (on the server, `/api` is not the one of Nitro: call the service by its address).

```bash
npm run dev            # start the service and the Nuxt dev server, http://localhost:3000
npm test               # build the packages and run their tests
npm run build          # build the packages, in the order of their dependencies (ui, then app)
npm start              # start the built service, http://localhost:8080
npm run version:patch  # give the packages their next version
npm run docker:build   # build the image {$APP_ID}:<version>
DOCKER_REPOSITORY=registry.example.com/team/{$APP_ID} npm run docker:push   # build it for linux/amd64 and push it
```

The results are `{errno, errMsg, data}`, the errors too (with the status 200). The requests carry
`Authorization: Bearer <API_TOKEN>` when the environment has an `API_TOKEN`
(`packages/app/src/middlewares/Authenticate.ts`). `/health` tells whether the process answers.

`docker login <registry>` once before pushing: the credentials are kept by Docker.

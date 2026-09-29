# {$APP_NAME}

{$APP_DESC}

A [lakutata](https://github.com/lakutata/lakutata) application.

```bash
npm run dev     # build and start, http://localhost:8080/example
npm test        # build and run the tests
npm run build   # compile into build/
npm start       # start the compiled application
```

- `src/App.ts` starts the application;
- `src/config/Config.ts` declares its components, the entrypoint and its adapters;
- `src/controllers/` holds the controllers: their actions are served by the adapters of the entrypoint.

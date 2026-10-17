# Examples

Each example builds a whole application, from a template of `lakutata create` to its tests: the files to write, the
commands to run and what they print. The code of every page is checked: a script creates the project from the page,
builds it and runs its tests.

| Example | What it shows |
|---|---|
| [A REST API with a database](RestAPI.md) | The `service` template, an entity and its migration (SQLite), DTO validation, an exception with its HTTP status, pagination, tests |
| [A command line tool](CommandLineTool.md) | The `cli` template, commands with arguments and options (`@CLIAction` and their DTOs), the validation errors, asking for a missing option in the terminal, the exit codes, tests, a bundle that runs without `node_modules` |
| [A web application with a user interface](WebApp.md) | The `web-react` template, an HTTP API under `/api` with its data in a component, a React page that calls it (through the Vite proxy in development), the page served by the built application and from the resources of a bundle (`lakutata.resources`, `resourcesPath()`), tests |
| [A desktop application](DesktopApp.md) | The `electron-react` template, a notes app: the actions of the main process called over IPC, a system dialog, events pushed to the window, tests that run without Electron |
| [Calls between services](ServiceCalls.md) | Two `service` projects: `@ServiceAction` patterns with `@Prefix`, the HTTP service transport, a proxy component that calls it, a token between the services, the callee's refusal passed back to the caller (409), the tests of each service with a stand-in in the test process |
| [Background jobs](BackgroundJobs.md) | The `service` template, a queue (memory driver) and its `@QueueAction`, retries and the dead letter queue, a cron schedule run in one instance with a lock, two instances sharing a directory, tests that replace a component |
| [An MCP server for AI assistants](MCPServer.md) | The `default` template, tools, a resource and a prompt served over stdio and HTTP, arguments validated by DTOs, registration in Claude Code and Claude Desktop, tests with the SDK's MCP client |
| [A service on a device](DeviceService.md) | The `service` template with its `installer` feature: a scheduled action, components with options, the monitors, configuration through environment variables, a system service installed by deb/rpm packages, tests |

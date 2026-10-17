# 示例

每个示例都构建一个完整的应用：从 `lakutata create` 的模板开始，一直到测试，包括要写的文件、要运行的命令，以及命令的输出。每一页的代码都经过检查：脚本根据页面创建项目并构建，再运行项目的测试。

| 示例 | 展示的内容 |
|---|---|
| [带数据库的 REST API](RestAPI.md) | `service` 模板、实体及其迁移（SQLite）、DTO 校验、带 HTTP 状态码的异常、分页、测试 |
| [命令行工具](CommandLineTool.md) | `cli` 模板、带参数和选项的命令（`@CLIAction` 及其 DTO）、校验错误、在终端中询问缺少的选项、退出码、测试、不需要 `node_modules` 的单文件包 |
| [带界面的 Web 应用](WebApp.md) | `web-react` 模板、`/api` 下的 HTTP API（数据放在组件中）、调用它的 React 页面（开发时经由 Vite 代理）、构建后由应用提供页面、单文件包把页面作为资源带上（`lakutata.resources`、`resourcesPath()`）、测试 |
| [桌面应用](DesktopApp.md) | `electron-react` 模板，一个笔记应用：主进程通过 IPC 提供的动作、系统对话框、向窗口推送的事件、不需要 Electron 就能运行的测试 |
| [服务之间的调用](ServiceCalls.md) | 两个 `service` 项目：`@ServiceAction` 的模式与 `@Prefix`、HTTP 服务传输方式、调用它的代理组件、服务之间的令牌、被调用方的拒绝传回调用方（409）、各服务的测试（替身运行在测试进程中） |
| [后台任务](BackgroundJobs.md) | `service` 模板、队列（内存驱动）及其 `@QueueAction`、重试和死信队列、借助锁只在一个实例中执行的 cron 定时任务、共用目录的两个实例、替换组件的测试 |
| [给 AI 助手用的 MCP 服务器](MCPServer.md) | `default` 模板、工具、资源和提示词（通过 stdio 和 HTTP 提供）、用 DTO 校验参数、在 Claude Code 和 Claude Desktop 中注册、用 SDK 的 MCP 客户端编写的测试 |
| [设备上的服务](DeviceService.md) | `service` 模板及其 `installer` 功能：定时任务、带选项的组件、监控器、用环境变量配置、由 deb/rpm 软件包安装的系统服务、测试 |

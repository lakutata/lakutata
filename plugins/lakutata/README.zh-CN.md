# lakutata 技能

[English](README.md) | 中文

Lakutata 官方的 Agent Skill（智能体技能），供 AI 编程助手使用。安装该技能后，助手在 Lakutata 项目中工作时，会先检查项目所用的版本，遵守框架的规则，避开常见陷阱，并在编写代码之前阅读对应的指南。该技能也会指导将 2.x 或 1.x 的项目升级到 3.x，每个版本分别参阅各自的升级指南。

该技能采用 [Agent Skills](https://agentskills.io) 格式，即一个名为 `lakutata` 的文件夹，其中包含一个 `SKILL.md`。下文为每个编程助手各设一节，按名称的字母顺序排列，各节结构相同：如何安装技能、助手读取哪些文件夹、如何确认技能已加载、如何更新，以及该助手需要注意的事项。这些小节之后是 Claude 应用，最后一节适用于其他任何助手。

## 工作方式

技能本身很小，也很少需要改动。技能只包含助手必须始终遵守的内容：版本检查（1.x、2.x 和 3.x 的代码互不兼容）、框架的模型、规则和常见陷阱，以及一张“什么任务看哪篇指南”的对照表。具体知识按以下顺序从文档中读取：

1. **已安装的包中自带的指南**，即 `node_modules/lakutata/doc/en/`：这些指南描述的正是项目所用的版本，无需联网，项目升级 `lakutata` 时也随之更新。
2. **已安装的包的类型声明**，用于确认确切的函数签名和选项。
3. **本网站上的 Markdown 格式指南**，例如 <https://lakutata.com/doc/en/Overview.md>，全部列在 <https://lakutata.com/llms.txt> 中，在项目尚未安装 `lakutata`（新项目）或助手无法读取 `node_modules` 时使用。这些指南跟随最新的源码，因此两者都可用时，以已安装的包为准。

因此框架更新时，技能本身很少需要更新。有些助手的文件工具会避开 `node_modules`（例如 Cursor、Devin Desktop 和 Gemini CLI，见各自的小节），此时技能会通过终端命令读取指南，或读取本网站上的版本。

安装之后，任务涉及 Lakutata 时，助手会按照技能的描述自动使用该技能。每一节也写明了如何主动要求助手使用该技能。

## Claude Code

- **安装：** 在 Claude Code 会话中，使用一条命令添加本仓库的插件市场并安装插件（Claude Code 2.1.275 或更高版本）：

  ```text
  /plugin install lakutata --marketplace lakutata/lakutata
  ```

  更早的版本需要两条命令：先运行 `/plugin marketplace add lakutata/lakutata`，再运行 `/plugin install lakutata@lakutata`。在终端中（Claude Code 2.1.292 或更高版本）运行 `claude plugin install lakutata --marketplace lakutata/lakutata`。在会话中，Claude Code 随后会询问适用范围：用户（当前用户的所有项目）、项目（在该仓库中工作的所有人；该选择记录在 `.claude/settings.json` 中并提交到仓库，每个协作者各自运行一次安装）或本地（仅对当前用户、仅在该仓库中）。在终端中，插件默认安装在用户范围，加 `--scope project` 或 `--scope local` 可改为其他范围。
- **文件夹：** Claude Code 从项目中的 `.claude/skills` 和用户目录中的 `~/.claude/skills` 读取技能。不使用插件市场时，请将 `lakutata` 文件夹复制到其中一个文件夹，或运行 `npx skills add lakutata/lakutata -a claude-code`。
- **确认：** 打开 `/plugin` 的 Installed 标签页，或在终端中运行 `claude plugin list`。在会话中安装的插件在运行 `/reload-plugins` 后加载；在终端中安装的插件在下一个会话中加载，或在已打开的会话中运行 `/reload-plugins` 后加载。复制到文件夹中的技能在当前会话中即会被发现（如果 `.claude/skills` 文件夹是在会话开始之后才创建的，则需要运行 `/reload-skills`）。以插件方式安装时，技能的命令为 `/lakutata:lakutata`；复制到文件夹中时为 `/lakutata`。
- **更新：** 插件随本仓库的提交更新：`claude plugin update lakutata@lakutata` 安装最新的提交，在下一个会话中或运行 `/reload-plugins` 后生效。如需自动更新，请在 `/plugin` 的 Marketplaces 标签页中选择该市场，再选择 Enable auto-update（非官方的市场默认关闭自动更新）。通过 `npx skills` 安装的技能使用 `npx skills update lakutata` 更新。
- **注意：** Claude Code 会跟随指向技能文件夹的符号链接，因此 `npx skills` 创建的链接可以正常使用。云端会话不加载插件，也不读取 `~/.claude/skills`，因此请将 `lakutata` 文件夹提交到仓库的 `.claude/skills` 中，或将技能添加到 claude.ai 账号。
- **官方文档：** [安装和管理插件](https://code.claude.com/docs/zh-CN/plugins/install)、[使用 skills 扩展 Claude](https://code.claude.com/docs/zh-CN/skills)。

## Cline

- **安装：** 使用 Cline 命令行：`cline skill add lakutata/lakutata`。该命令会为 Cline 运行 `npx skills`（见最后一节），将技能写入项目中的 `.agents/skills/lakutata`；在任何终端中运行 `npx skills add lakutata/lakutata -a cline` 效果相同，加 `-g` 则对当前用户的所有项目生效（`~/.agents/skills`）。
- **文件夹：** 项目中的 `.cline/skills`（Cline 推荐的文件夹）、`.clinerules/skills`、`.claude/skills` 或 `.agents/skills`；用户目录中的 `~/.cline/skills` 或 `~/.agents/skills`。同名时，用户目录中的技能优先于项目中的技能。
- **确认：** 点击 Cline 面板底部、模型选择器左侧的天平图标，打开 Skills 标签页（每个技能在那里都有一个开关）；在命令行中使用 `cline skill list` 或 `/skills`。在对话中输入 `/lakutata` 可以主动使用该技能。
- **更新：** `npx skills update lakutata`；对于手动复制的文件夹，重新复制一次即可。
- **注意：** Cline 的云端代理不加载任何技能；在包含多个文件夹的工作区中，Cline 只读取第一个文件夹中的技能。
- **官方文档：** [Skills](https://docs.cline.bot/customization/skills)。

## CodeBuddy

- **安装：** `npx skills add lakutata/lakutata -a codebuddy` 将技能写入项目中的 `.codebuddy/skills/lakutata`（加 `-g` 则写入 `~/.codebuddy/skills`）。CodeBuddy IDE 也能导入该技能，方法是使用技能设置页右上角的“导入 Skill”按钮。
- **文件夹：** CodeBuddy Code（命令行）读取项目中的 `.codebuddy/skills` 和用户目录中的 `~/.codebuddy/skills`；同名时，项目中的技能优先。IDE 读取工作区中的 `.codebuddy/skills`；其文档未给出用户目录中的文件夹。
- **确认：** 在 CodeBuddy Code 中，`/skills` 列出已加载的技能；IDE 在设置中分 Project Skills 和 User Skills 列出这些技能。直接说出 lakutata 技能的名称，即可主动使用该技能。
- **更新：** CodeBuddy 的文档未说明。通过 `npx skills` 安装的技能使用 `npx skills update lakutata` 更新；对于手动复制的文件夹，重新复制一次即可。
- **注意：** CodeBuddy 的 VS Code 和 JetBrains 插件的文档未提及技能，因此请使用 CodeBuddy Code 或 CodeBuddy IDE。
- **官方文档：** [CodeBuddy Code 的 Skills](https://www.codebuddy.cn/docs/cli/skills)、[IDE 的 Skills](https://www.codebuddy.cn/docs/ide/Features/Skills)。

## Codex

- **安装：** Codex 可以从本仓库的插件市场安装插件：

  ```bash
  codex plugin marketplace add lakutata/lakutata
  codex plugin add lakutata@lakutata
  ```

  在 Codex 命令行中，也可以在 `/plugins` 的插件浏览器中安装；技能从下一个会话开始可用。也可以运行 `npx skills add lakutata/lakutata -a codex`，将技能写入项目中的 `.agents/skills/lakutata`（加 `-g` 则写入 `~/.agents/skills`）。Codex 也能在会话中单独安装该技能，并将其放到 `~/.codex/skills`：

  ```text
  $skill-installer install https://github.com/lakutata/lakutata/tree/main/plugins/lakutata/skills/lakutata
  ```

- **文件夹：** 从当前文件夹到仓库根目录之间每一层的 `.agents/skills`，以及用户目录中的 `~/.agents/skills`。Codex 会跟随指向技能文件夹的符号链接。
- **确认：** `codex plugin list` 列出已安装的插件。在 Codex 命令行或 IDE 扩展中，`/skills` 列出技能；输入 `$` 并选择 lakutata，可以主动使用该技能。在 ChatGPT 桌面应用中，打开侧边栏的 Skills。Codex 会自动发现新增和改动的技能文件夹；如果技能没有出现，请重启 Codex。
- **更新：** `codex plugin marketplace upgrade lakutata` 刷新该插件市场（插件带有版本号，技能每次改动都会随之更新）。通过 `npx skills` 安装的技能使用 `npx skills update lakutata` 更新。`$skill-installer` 不会覆盖已有的技能，因此重新安装之前，请先删除 `~/.codex/skills/lakutata`。
- **注意：** 主动使用插件中的该技能时（`$lakutata:lakutata`），Codex 只将其 `SKILL.md` 的前 8,000 字节加入提示，并提示该技能已被截断；通过 `npx skills` 或 `$skill-installer` 安装的副本会完整加入，因此在 Codex 中建议使用这两种方式之一。插件可以在 Codex 命令行和 ChatGPT 桌面应用中使用；IDE 扩展不支持插件，改为读取技能文件夹。如需关闭该技能而不删除，请在 `~/.codex/config.toml` 中添加一个 `[[skills.config]]` 条目，写明技能的路径和 `enabled = false`。
- **官方文档：** [Build skills](https://learn.chatgpt.com/docs/build-skills)、[Plugins](https://learn.chatgpt.com/docs/plugins)。

## Cursor

- **安装：** 打开 Customize，选择 From GitHub Repository，填入本仓库的地址 `https://github.com/lakutata/lakutata`；然后在 lakutata 插件上选择 Install，再选择项目或用户范围。在 Cursor 命令行中，先运行 `agent plugin marketplace add https://github.com/lakutata/lakutata`，再在 `/plugin` 中安装插件。也可以运行 `npx skills add lakutata/lakutata -a cursor`，将技能写入项目中的 `.agents/skills/lakutata`（加 `-g` 则写入 `~/.cursor/skills`）。
- **文件夹：** 项目中的 `.cursor/skills` 或 `.agents/skills`，用户目录中的 `~/.cursor/skills` 或 `~/.agents/skills`；Cursor 也会加载 `.claude/skills` 和 `~/.claude/skills`。
- **确认：** 打开侧边栏的 Customize，再打开 Skills。在 Agent 对话中输入 `/` 并搜索 lakutata，可以主动使用该技能；在 Cursor 命令行中，`/skills` 列出所有技能。Cursor 在启动时查找技能。
- **更新：** 团队插件市场使用 Refresh 更新，开启 Enable Auto Refresh 后，每次推送都会更新。对于单个用户导入的仓库，Cursor 的工作人员在论坛上确认，插件会停留在导入时的提交上，这是一个已知问题。在修复之前，可以通过 `npx skills` 安装，再用 `npx skills update lakutata` 使技能保持最新。对于手动复制的文件夹，重新复制一次，然后重启 Cursor。
- **注意：** Cursor 不允许其 Agent 访问被忽略的文件，而 `node_modules` 默认被忽略，因此 Agent 无法用文件工具打开已安装的包中的指南。此时技能会用终端命令读取这些指南（Cursor 不拦截终端命令），或读取本网站上的版本。云端代理（Cloud Agents）能获取 `~/.cursor/skills` 中的技能，但无法获取 `~/.agents/skills` 中的技能。
- **官方文档：** [Agent Skills](https://cursor.com/docs/skills)、[Plugins](https://cursor.com/docs/plugins)。

## Devin Desktop

Windsurf 已于 2026 年 6 月 2 日更名为 Devin Desktop。其智能体 Devin Local 读取技能的方式与 Devin 命令行相同。

- **安装：** Devin 可以安装本仓库的插件（Devin 能读取插件的 Claude 清单文件）。在 Devin 命令行中先登录（`devin auth login`），然后运行：

  ```bash
  devin plugins install lakutata/lakutata#plugins/lakutata
  ```

  插件安装在用户级别，登录后 Devin Desktop 也会获得同样的插件。也可以运行 `npx skills add lakutata/lakutata -a devin`，将技能写入项目中的 `.devin/skills/lakutata`（加 `-g` 则写入 `~/.config/devin/skills`）。
- **文件夹：** 项目中的 `.agents/skills`、`.devin/skills` 或 `.windsurf/skills`；用户目录中的 `~/.agents/skills` 或 `~/.config/devin/skills`（Windows 上为 `%APPDATA%\devin\skills`）。
- **确认：** 在 Devin Desktop 中，点击智能体侧边栏中的 Customize，其 Skills 和 Plugins 标签页列出智能体加载的内容；在命令行中使用 `devin skills list` 和 `devin plugins list`。以插件方式安装时，技能的命令为 `/lakutata:lakutata`；复制到文件夹中时为 `/lakutata`。新安装的插件在下一个会话中加载。
- **更新：** `devin plugins update lakutata` 安装最新的提交，在下一个会话中生效。通过 `npx skills` 安装的技能使用 `npx skills update lakutata` 更新。
- **注意：** Devin Local 默认无法读取被 git 忽略的文件，例如 `node_modules`。可以开启 Devin Local > Configuration > Gitignore access；否则技能会用终端命令读取指南，或读取本网站上的版本。企业可以为成员关闭插件功能。
- **官方文档：** [Skills](https://docs.devin.ai/cli/extensibility/skills/overview)、[Plugins](https://docs.devin.ai/cli/extensibility/plugins/overview)。

## Gemini CLI

- **安装：**

  ```bash
  gemini skills install https://github.com/lakutata/lakutata --path plugins/lakutata/skills/lakutata
  ```

  该命令将技能安装到用户目录（`~/.gemini/skills`），对当前用户的所有项目生效；加 `--scope workspace` 则安装到项目中（`.gemini/skills`）。也可以运行 `npx skills add lakutata/lakutata -a gemini-cli`，将技能写入项目中的 `.agents/skills/lakutata`（加 `-g` 则写入 `~/.gemini/skills`）。
- **文件夹：** 项目中的 `.gemini/skills` 或 `.agents/skills`，用户目录中的 `~/.gemini/skills` 或 `~/.agents/skills`；同名时，项目中的技能优先。
- **确认：** 在会话中输入 `/skills list`，或在终端中运行 `gemini skills list`。Gemini CLI 在会话开始时查找技能；`/skills reload` 无需重启即可发现新的技能。要求 Gemini CLI“使用 lakutata 技能”即可主动使用该技能；激活技能之前，Gemini CLI 会请求用户确认。
- **更新：** 没有更新命令，请先运行 `gemini skills uninstall lakutata`（项目中的安装需要加上 `--scope workspace`），再重新安装。
- **注意：** 项目中的技能只在受信任的文件夹中加载，因此请在信任对话框中选择信任，或运行 `/permissions trust`，Gemini CLI 随后会重启。Gemini CLI 遵循 `.gitignore`，不会读取 `node_modules`，因此技能会用终端命令读取指南，或读取本网站上的版本；设置项 `context.fileFiltering.respectGitIgnore` 可以改变这一行为。
- **官方文档：** [Agent Skills](https://geminicli.com/docs/cli/skills/)。

## GitHub Copilot

- **安装：**
  - Copilot 命令行从本仓库的插件市场安装插件（Copilot 命令行能读取 Claude 的插件市场）：

    ```bash
    copilot plugin marketplace add lakutata/lakutata
    copilot plugin install lakutata@lakutata
    ```

    在会话中，先运行 `/plugin marketplace add lakutata/lakutata`，再运行 `/plugin install lakutata@lakutata`。不经过插件市场时，运行 `copilot plugin install lakutata/lakutata:plugins/lakutata`。
  - VS Code：在命令面板中运行“聊天: 管理插件市场”（Chat: Manage Plugin Marketplaces），选择 Add Marketplace…，输入 `lakutata/lakutata`；然后打开聊天视图中的 Customize（“聊天: 打开自定义”），在 Browse（或 Plugins > Browse Marketplace）中找到 lakutata，选择 Install。实验性的设置项 `chat.plugins.marketplaces` 也可以添加该市场，但请保留其中的默认市场：`"chat.plugins.marketplaces": ["github/awesome-copilot#marketplace", "lakutata/lakutata"]`。VS Code 也会显示通过 Copilot 命令行安装的插件。
  - 云端代理使用仓库中的内容，因此请将技能提交到下面的某个文件夹中，或在 `.github/copilot/settings.json` 中启用插件：

    ```json
    {
        "extraKnownMarketplaces": {"lakutata": {"source": {"source": "github", "repo": "lakutata/lakutata"}}},
        "enabledPlugins": {"lakutata@lakutata": true}
    }
    ```

  - 也可以运行 `npx skills add lakutata/lakutata -a github-copilot`，将技能写入项目中的 `.agents/skills/lakutata`（加 `-g` 则写入 `~/.copilot/skills`）。
  - 也可以用 GitHub 命令行运行 `gh skill install lakutata/lakutata lakutata --agent github-copilot --scope project`（见最后一节），将技能写入项目中的 `.agents/skills/lakutata`（加 `--scope user` 则写入 `~/.copilot/skills`）。
- **文件夹：** 仓库中的 `.github/skills`、`.claude/skills` 或 `.agents/skills`；用户目录中的 `~/.copilot/skills` 或 `~/.agents/skills`（VS Code 还读取 `~/.claude/skills`）。
- **确认：** 在 Copilot 命令行中使用 `/skills list` 或 `/skills info lakutata`；在提示中输入 `/lakutata` 可以主动使用该技能，`/skills reload` 无需重启即可加载新的技能。在 VS Code 中，在对话框中输入 `/` 查看技能；从插件安装的技能为 `/lakutata:lakutata`。云端代理根据技能的描述决定是否使用该技能。
- **更新：** 在 Copilot 命令行中运行 `copilot plugin update lakutata`。VS Code 通过 Extensions: Check for Extension Updates 检查插件更新，或在开启 `extensions.autoUpdate` 时每 24 小时检查一次。Copilot 读取插件的 Agent Plugins 清单文件（`plugin.json`），技能每次改动，其中的版本号都会随之更新。通过 `npx skills` 安装的技能使用 `npx skills update lakutata` 更新，通过 `gh skill` 安装的技能使用 `gh skill update lakutata` 更新。
- **注意：** 在 GitHub Actions 上运行的云端代理会话中，`.github/workflows/copilot-setup-steps.yml` 可以在代理开始工作前运行 `npm ci`；云端沙盒会话（可选择时的默认环境）不运行该文件。否则代理可能自行安装依赖，或者技能读取本网站上的指南。Copilot 代码审查、GitHub Copilot 应用和 JetBrains IDE 中也能使用技能。
- **官方文档：** [代理技能](https://docs.github.com/zh/copilot/concepts/customizations/agent-skills)、[VS Code 中的 Agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins)。

## Kiro

- **安装：** 在 Kiro IDE 中，打开 Kiro 面板的 Agent Steering & Skills，点击 +，选择 Import a skill，再选择 GitHub，粘贴技能文件夹的地址：

  ```text
  https://github.com/lakutata/lakutata/tree/main/plugins/lakutata/skills/lakutata
  ```

  Kiro 会将技能复制到技能文件夹中，并立即生效。本仓库的插件文件夹也是一个 Kiro Power，导入路径为 Powers panel > Add Custom Power > Import power from GitHub；Kiro 的文档没有说明 Power 位于仓库的子文件夹中时应填写什么地址。Kiro 命令行可以使用 `npx skills add lakutata/lakutata -a kiro-cli`，将技能写入项目中的 `.kiro/skills/lakutata`（加 `-g` 则写入 `~/.kiro/skills`）。
- **文件夹：** 项目中的 `.kiro/skills` 和用户目录中的 `~/.kiro/skills`；同名时，项目中的技能优先。Kiro 的文档未提及 `.agents/skills`。
- **确认：** 在 IDE 中查看 Agent Steering & Skills 部分；在命令行中，`/context show` 列出会话中的技能。输入 `/lakutata` 可以主动使用该技能。命令行在新的对话会话开始时查找技能。
- **更新：** Kiro 的文档没有说明技能如何更新，在 IDE 中重新导入技能即可。Power 可以在 Powers panel 中通过 Check for updates 更新。通过 `npx skills` 安装的技能使用 `npx skills update lakutata` 更新。
- **注意：** Kiro 命令行只在用户信任工作区之后才加载其中的技能。自定义智能体默认不加载技能，除非在 `resources` 中列出，例如 `skill://.kiro/skills/*/SKILL.md`。网页版和手机版的 Kiro 没有用户目录中的技能（`~/.kiro/skills`）。
- **官方文档：** [Skills](https://kiro.dev/docs/skills)、[Install powers](https://kiro.dev/docs/powers/installation)。

## OpenCode

- **安装：** OpenCode 没有安装技能的工具。`npx skills add lakutata/lakutata -a opencode` 将技能写入项目中的 `.agents/skills/lakutata`（加 `-g` 则写入 `~/.config/opencode/skills`）；也可以直接复制文件夹。
- **文件夹：** 从当前文件夹到 git 工作树根目录之间每一层的 `.opencode/skills`、`.agents/skills` 或 `.claude/skills`；用户目录中的 `~/.config/opencode/skills`、`~/.agents/skills` 或 `~/.claude/skills`。
- **确认：** 在 OpenCode 1 中，`opencode debug skill` 列出所有技能；OpenCode 2 的文档没有提供列出技能的方法。在 OpenCode 2 中，在提示中写入 `@lakutata` 即可加载该技能；在 OpenCode 1 中，任务符合时，模型会用其 `skill` 工具加载技能，你也可以直接说出技能的名称。
- **更新：** OpenCode 的文档未说明。通过 `npx skills` 安装的技能使用 `npx skills update lakutata` 更新；对于手动复制的文件夹，重新复制一次即可。
- **注意：** OpenCode 2 是当前版本，部分安装方式仍会安装 OpenCode 1。两者的命令都是 `opencode`（`opencode --version` 可以看出所用的版本），OpenCode 1 的技能在 OpenCode 2 中可以继续使用。
- **官方文档：** [Agent Skills（OpenCode 1）](https://opencode.ai/v1/docs/skills/)、[Skills（OpenCode 2）](https://opencode.ai/docs/skills/)。

## Qoder

- **安装：** 按照 Qoder 文档的建议，在 Qoder IDE 的终端中运行 `npx skills add lakutata/lakutata -a qoder`，将技能写入项目中的 `.qoder/skills/lakutata`（加 `-g` 则写入 `~/.qoder/skills`）。在 Qoder 桌面应用中，打开“扩展 > 技能 > 添加技能 > 上传技能”，上传技能的 `SKILL.md`（位于[该 zip 文件](https://lakutata.com/lakutata-skill.zip)中）。
- **文件夹：** IDE 和命令行都读取项目中的 `.qoder/skills` 和用户目录中的 `~/.qoder/skills`。
- **确认：** 在 IDE 中，重启后在对话框中输入 `/` 查看已加载的技能；`/lakutata` 可以主动使用该技能。在命令行中使用 `/skills`，在运行中的会话中使用 `/skills reload`。在桌面应用中，技能会出现在“已安装”中；在新任务中输入 `/` 即可使用。
- **更新：** 在命令行中，新的会话会加载改动后的技能，或使用 `/skills reload`。在 IDE 中，重新复制文件夹（或运行 `npx skills update lakutata`），然后重启。
- **注意：** 在 Qoder 命令行中，只有开启了 Skills 功能和管理员权限，`/skills` 才会出现。
- **官方文档：** [Skills](https://docs.qoder.com/zh/extensions/skills)、[Qoder 应用中的技能](https://docs.qoder.com/zh/qoder/skills)。

## Qoder CN

通义灵码已于 2026 年 5 月 20 日更名为 Qoder CN。

- **安装：** Qoder CN IDE 和 Qoder CN 命令行（`qodercn`）：`npx skills add lakutata/lakutata -a qoder-cn` 将技能写入项目中的 `.qoder/skills/lakutata`（加 `-g` 则写入 `~/.qoder-cn/skills`）；也可以将 `lakutata` 文件夹复制到这两个文件夹，或在 IDE 的“设置 → 技能与指令”的“技能”区点击“导入”。Qoder CN 桌面应用：打开“扩展 > 技能 > 添加技能 > 上传技能”，上传技能的 `SKILL.md`（位于[该 zip 文件](https://lakutata.com/lakutata-skill.zip)中）。
- **文件夹：** IDE 和命令行都读取项目中的 `.qoder/skills` 和用户目录中的 `~/.qoder-cn/skills`；IDE 还会读取 `.agents/skills`。
- **确认：** 在 IDE 中，在对话框中输入 `/` 查看已加载的技能；`/lakutata` 可以主动使用该技能。在命令行中使用 `/skills`，在运行中的会话中使用 `/skills reload`。
- **更新：** 在 IDE 中，重新复制文件夹（或运行 `npx skills update lakutata`），然后重启。在命令行中，新的会话会加载改动后的技能，或使用 `/skills reload`。
- **注意：** 在 Qoder CN 命令行中，只有开启了 Skills 功能和管理员权限，`/skills` 才会出现。
- **官方文档：** [技能（Skills）](https://docs.qoder.cn/user-guide/skills)、[Qoder CN 应用中的技能](https://docs.qoder.cn/qoder/skills)。

## Trae

- **安装：** 在 Trae 中打开“设置 > 技能与命令”。在“技能”部分点击“创建”，选择“全局”或“项目”，然后上传技能的 `SKILL.md`（位于[该 zip 文件](https://lakutata.com/lakutata-skill.zip)中），Trae 会据此填写技能名称、描述和指令；最后点击“确认”。也可以运行 `npx skills add lakutata/lakutata -a trae`（Trae 中国版使用 `-a trae-cn`），将技能写入项目中的 `.trae/skills/lakutata`（加 `-g` 则写入 `~/.trae/skills`，Trae 中国版为 `~/.trae-cn/skills`）。
- **文件夹：** 项目中的 `.trae/skills`；用户目录中的 `~/.trae/skills`（Trae 中国版：`~/.trae-cn/skills`）。在“导入设置”中打开“启用 .agents 技能目录”之后，Trae 也会读取项目中的 `.agents/skills`；同名时，`.trae/skills` 中的技能优先。
- **确认：** “设置 > 技能与命令”中分“全局”和“项目”两个标签页列出技能，每个技能都有开关。Trae 没有调用技能的命令，直接提出要求即可，例如“使用 lakutata 技能添加一个 HTTP 路由”。
- **更新：** Trae 的文档未说明。请替换技能文件夹中的 `SKILL.md`；通过 `npx skills` 安装的技能使用 `npx skills update lakutata` 更新。
- **注意：** 上传的技能只保留 `SKILL.md`，其他文件需要手动添加；该技能只有这一个文件。Trae 中国版只加载可信目录中的项目技能。打开项目时如果出现“是否信任此文件夹中的文件的作者？”，请选择“是，我信任此作者”。
- **官方文档：** [技能（国际版）](https://docs.trae.ai/ide/skills)、[技能（中国版）](https://docs.trae.cn/ide_skills)。

## Claude 应用

下载 [lakutata-skill.zip](https://lakutata.com/lakutata-skill.zip)（其中包含 `lakutata` 文件夹），在“自定义 > 技能”中上传（“+” > “+ 创建技能” > “上传技能”），然后启用该技能；需要在“设置 > 功能”中开启“代码执行和文件创建”。详见 [Claude 帮助中心：在 Claude 中使用技能](https://support.claude.com/zh-CN/articles/12512180)。在 Claude 应用中，助手没有项目文件。技能提供规则和模型，只有在能访问本网站时才能读取指南。

## 其他任何助手

该技能即一个名为 `lakutata` 的文件夹，其中只有一个文件 `SKILL.md`；文件夹的名称必须保持为 `lakutata`。

- **npx skills：** Vercel 的工具 [skills](https://skills.sh) 可以为其支持的助手安装技能（支持的助手列在[其 README](https://github.com/vercel-labs/skills) 中）：

  ```bash
  npx skills add lakutata/lakutata
  ```

  - 该工具会在本仓库中找到该技能，然后询问要为哪些助手安装（`-a <助手>` 可直接指定一个）。
  - 默认安装到当前项目中（将其创建的文件夹提交到仓库后，团队成员均可使用）；加 `-g` 则对当前用户的所有项目生效。
  - 该工具在 `.agents/skills` 中保存一份副本，其他助手的文件夹以链接指向该副本。并非每个助手的文档都说明会跟随这种链接，加上 `--copy` 可以写入真正的副本。
  - `npx skills update lakutata` 安装最新的提交，`npx skills remove lakutata` 删除该技能。
  - 除非设置了 `DISABLE_TELEMETRY=1`，该工具会匿名地将安装记录报告给 skills.sh 的排行榜。
- **gh skill：** [GitHub 命令行](https://cli.github.com/manual/gh_skill_install)（GitHub CLI）2.92 及以上版本可以为其支持的助手安装技能（`gh skill install --help` 会列出这些助手）。其 `gh skill` 命令仍处于预览阶段，使用前需要先登录（`gh auth login`）：

  ```bash
  gh skill install lakutata/lakutata lakutata
  ```

  - 该命令会询问要为哪些助手安装，以及安装在当前项目中还是对当前用户的所有项目生效；用 `--agent <助手>` 和 `--scope project` 或 `--scope user` 直接指定后，就不会再询问。无法询问时（例如在脚本中运行），该命令会为 GitHub Copilot 将技能安装在当前项目中。
  - 该命令将技能显示为 `lakutata/lakutata`（前面是插件名，后面是技能名），但写入的文件夹名为 `lakutata`。
  - 该命令复制整个文件夹，并在 `SKILL.md` 的头部信息（frontmatter）中记录技能的来源，之后即可使用 `gh skill update lakutata` 更新。
  - 该命令从本仓库最新的 GitHub Release 安装技能；仓库没有 Release 时，从默认分支安装。
- **手动复制：** 将 `lakutata` 文件夹（来自[该 zip 文件](https://lakutata.com/lakutata-skill.zip)，或本仓库中的 [skills/lakutata](skills/lakutata)）复制到所用助手的文档指定的技能文件夹中。大多数支持 Agent Skills 的助手都读取项目中的 `.agents/skills` 和用户目录中的 `~/.agents/skills`。
- **不支持技能的助手：** 仍然将文件夹复制到项目中的 `.agents/skills/lakutata`，然后在助手读取的指令文件中（许多助手读取 `AGENTS.md`，见 [agents.md](https://agents.md)）添加一行：

  ```text
  在修改使用 lakutata 的代码之前，先阅读 .agents/skills/lakutata/SKILL.md 并按其中的要求去做。
  ```

## 内容

[skills/lakutata/SKILL.md](skills/lakutata/SKILL.md)：使用时机、版本检查、具体知识的位置（指南对照表）、项目、子路径、一个应用、对象与注入、控制器、DTO 与错误，以及常见陷阱。技能本身以英文编写，因为它是写给 AI 助手阅读的；助手仍会使用用户的语言回答。

# lakutata 技能

[English](README.md) | 中文

lakutata 官方的 Agent Skill（智能体技能），供 AI 编程助手使用。装上它之后，助手在 lakutata 项目中工作时，会先检查项目所用的版本，遵守框架的规则，避开常见的坑，并在写代码之前阅读对应的指南。它也会指导把 2.x 或 1.x 的项目升级到 3.x，每个版本各看各自的升级指南。

它采用 [Agent Skills](https://agentskills.io) 格式：一个名为 `lakutata` 的文件夹，里面有一个 `SKILL.md`。下面每个编程助手各有一节，按名称的字母顺序排列，每节的结构相同：怎样安装技能、助手读取哪些文件夹、怎样确认技能已经加载、怎样更新，以及这个助手需要注意的地方。这些小节之后是 Claude 应用，最后一节适用于其他任何助手。

## 工作方式

技能本身很小，也很少需要改动。它只包含助手必须始终遵守的内容：版本检查（1.x、2.x 和 3.x 的代码互不兼容）、框架的模型、规则和常见的坑，以及一张"什么任务看哪篇指南"的表。具体知识按下面的顺序从文档中读取：

1. **已安装的包中自带的指南**，即 `node_modules/lakutata/doc/en/`：它们描述的正是项目所用的版本，不需要联网，项目升级 `lakutata` 时也随之更新。
2. **已安装的包的类型声明**，用来确认确切的函数签名和选项。
3. **本网站上的 Markdown 格式指南**，例如 https://lakutata.com/doc/en/Overview.md，全部列在 https://lakutata.com/llms.txt 中：在项目还没有安装 lakutata（新项目），或者助手读不了 `node_modules` 时使用。它们跟随最新的源码，所以两者都有时，以已安装的包为准。

因此框架更新时，技能本身很少需要更新。有些助手的文件工具会避开 `node_modules`（例如 Cursor、Devin Desktop 和 Gemini CLI，见各自的小节）；这时技能会通过终端命令读取指南，或者读取本网站上的版本。

安装之后，任务涉及 lakutata 时，助手会按照技能的描述自动使用它。每一节也写明了怎样主动要求助手使用它。

## Claude Code

- **安装：** 在 Claude Code 会话中，用一条命令添加本仓库的插件市场并安装插件（Claude Code 2.1.275 或更高版本）：

  ```text
  /plugin install lakutata --marketplace lakutata/lakutata
  ```

  更早的版本需要两条命令：先 `/plugin marketplace add lakutata/lakutata`，再 `/plugin install lakutata@lakutata`。在终端中（Claude Code 2.1.292 或更高版本）：`claude plugin install lakutata --marketplace lakutata/lakutata`。然后选择适用范围：用户（你的所有项目）、项目（在这个仓库中工作的所有人：这个选择记录在 `.claude/settings.json` 中并提交到仓库，每个协作者各自运行一次安装）或本地（只对你、只在这个仓库中）。
- **文件夹：** Claude Code 读取项目中 `.claude/skills` 和用户目录中 `~/.claude/skills` 里的技能。不使用插件市场时，把 `lakutata` 文件夹复制到其中一个，或者运行 `npx skills add lakutata/lakutata -a claude-code`。
- **确认：** 打开 `/plugin` 的 Installed 标签页，或者在终端中运行 `claude plugin list`。在会话中安装的插件在运行 `/reload-plugins` 后加载；在终端中安装的插件在下一个会话中加载，或者在已打开的会话中运行 `/reload-plugins` 后加载。复制到文件夹中的技能在当前会话中就会被发现（如果 `.claude/skills` 文件夹是在会话开始之后才创建的，需要运行 `/reload-skills`）。以插件方式安装时，技能的命令是 `/lakutata:lakutata`；复制到文件夹中时是 `/lakutata`。
- **更新：** 插件随本仓库的提交更新：`claude plugin update lakutata@lakutata` 安装最新的提交，在下一个会话中或运行 `/reload-plugins` 后生效。要让它自动更新，在 `/plugin` 的 Marketplaces 标签页中选择这个市场，再选 Enable auto-update（非官方的市场默认关闭自动更新）。用 `npx skills` 安装的技能用 `npx skills update lakutata` 更新。
- **注意：** Claude Code 会跟随指向技能文件夹的符号链接，所以 `npx skills` 创建的链接可以正常使用。
- **官方文档：** [安装和管理插件](https://code.claude.com/docs/zh-CN/plugins/install)、[使用 skills 扩展 Claude](https://code.claude.com/docs/zh-CN/skills)。

## Cline

- **安装：** 使用 Cline 命令行：`cline skill add lakutata/lakutata`。它会为 Cline 运行 `npx skills`（见最后一节），把技能写入项目中的 `.agents/skills/lakutata`；在任何终端中运行 `npx skills add lakutata/lakutata -a cline` 效果相同，加 `-g` 则对你的所有项目生效（`~/.agents/skills`）。
- **文件夹：** 项目中的 `.cline/skills`（Cline 推荐的文件夹）、`.clinerules/skills`、`.claude/skills` 或 `.agents/skills`；用户目录中的 `~/.cline/skills` 或 `~/.agents/skills`。同名时，用户目录中的技能优先于项目中的技能。
- **确认：** 点击 Cline 面板底部、模型选择器左边的天平图标，打开 Skills 标签页（每个技能在那里都有一个开关）；在命令行中用 `cline skill list` 或 `/skills`。在对话中输入 `/lakutata` 可以主动使用这个技能。
- **更新：** `npx skills update lakutata`；手动复制的文件夹，再复制一次即可。
- **注意：** Cline 的云端代理不加载任何技能；在包含多个文件夹的工作区中，Cline 只读取第一个文件夹中的技能。
- **官方文档：** [Skills](https://docs.cline.bot/customization/skills)。

## CodeBuddy

- **安装：** `npx skills add lakutata/lakutata -a codebuddy` 把技能写入项目中的 `.codebuddy/skills/lakutata`（加 `-g` 则写入 `~/.codebuddy/skills`）。CodeBuddy IDE 也能导入它：使用技能设置页右上角的"导入 Skill"按钮。CodeBuddy Code 的插件市场要求仓库中有 `.codebuddy-plugin/marketplace.json`，本仓库没有这个文件。
- **文件夹：** CodeBuddy Code（命令行）读取项目中的 `.codebuddy/skills` 和用户目录中的 `~/.codebuddy/skills`；同名时，项目中的技能优先。IDE 读取工作区中的 `.codebuddy/skills`；它的文档没有给出用户目录中的文件夹。
- **确认：** 在 CodeBuddy Code 中，`/skills` 列出已加载的技能；IDE 在设置中分 Project Skills 和 User Skills 列出它们。直接说出 lakutata 技能的名字，就能主动使用它。
- **更新：** 它的文档没有说明。用 `npx skills` 安装的技能用 `npx skills update lakutata` 更新；手动复制的文件夹，再复制一次即可。
- **注意：** CodeBuddy 的 VS Code 和 JetBrains 插件的文档没有提到技能：请使用 CodeBuddy Code 或 CodeBuddy IDE。
- **官方文档：** [CodeBuddy Code 的 Skills](https://www.codebuddy.cn/docs/cli/skills)、[IDE 的 Skills](https://www.codebuddy.cn/docs/ide/Features/Skills)。

## Codex

- **安装：** `npx skills add lakutata/lakutata -a codex` 把技能写入项目中的 `.agents/skills/lakutata`（加 `-g` 则写入 `~/.agents/skills`）。Codex 也能自己安装它，在会话中输入：

  ```text
  $skill-installer install https://github.com/lakutata/lakutata/tree/main/plugins/lakutata/skills/lakutata
  ```

  这样会安装到 `~/.codex/skills`，对你的所有项目生效。
- **文件夹：** 从当前文件夹到仓库根目录之间每一层的 `.agents/skills`，以及用户目录中的 `~/.agents/skills`。Codex 会跟随指向技能文件夹的符号链接。
- **确认：** 在 Codex 命令行或 IDE 扩展中输入 `/skills`；输入 `$lakutata` 可以主动使用这个技能。在 ChatGPT 桌面应用中，打开侧边栏的 Skills。Codex 会自动发现新增和改动的技能；如果没有出现，重启 Codex。
- **更新：** `npx skills update lakutata`。`$skill-installer` 不会覆盖已有的技能：重新安装之前，先删除 `~/.codex/skills/lakutata`。
- **注意：** 技能可以在 Codex 命令行、它的 IDE 扩展以及 ChatGPT 桌面应用中的 Codex 里使用。想关闭这个技能又不删除它时，在 `~/.codex/config.toml` 中加一个 `[[skills.config]]` 条目，写上它的路径和 `enabled = false`。
- **官方文档：** [Build skills](https://learn.chatgpt.com/docs/build-skills)。

## Cursor

- **安装：** `npx skills add lakutata/lakutata -a cursor` 把技能写入项目中的 `.agents/skills/lakutata`（加 `-g` 则写入 `~/.cursor/skills`）。Cursor 只能通过插件从 GitHub 导入技能，而且要求仓库中有 `.cursor-plugin/marketplace.json`，本仓库没有这个文件。
- **文件夹：** 项目中的 `.cursor/skills` 或 `.agents/skills`，用户目录中的 `~/.cursor/skills` 或 `~/.agents/skills`；Cursor 也会加载 `.claude/skills` 和 `~/.claude/skills`。
- **确认：** 打开侧边栏的 Customize，再打开 Skills。在 Agent 对话中输入 `/` 并搜索 lakutata，可以主动使用这个技能；在 Cursor 命令行中，`/skills` 列出所有技能。Cursor 在启动时查找技能。
- **更新：** `npx skills update lakutata`，或者重新复制文件夹；然后重启 Cursor。
- **注意：** Cursor 不让它的 Agent 访问被忽略的文件，而 `node_modules` 默认就被忽略：Agent 无法用文件工具打开已安装的包中的指南。这时技能会用终端命令读取它们（Cursor 不拦截终端命令），或者读取本网站上的版本。云端代理（Cloud Agents）能拿到 `~/.cursor/skills` 中的技能，拿不到 `~/.agents/skills` 中的技能。
- **官方文档：** [Agent Skills](https://cursor.com/docs/skills)。

## Devin Desktop

Windsurf 已于 2026 年 6 月 2 日更名为 Devin Desktop。它的智能体 Devin Local 读取技能的方式与 Devin 命令行相同。

- **安装：** Devin 可以安装本仓库的插件（它能读取插件的 Claude 清单文件）。在 Devin 命令行中先登录（`devin auth login`），然后运行：

  ```bash
  devin plugins install lakutata/lakutata#plugins/lakutata
  ```

  插件安装在用户级别，登录后 Devin Desktop 也会得到同样的插件。也可以运行 `npx skills add lakutata/lakutata -a devin`，把技能写入项目中的 `.devin/skills/lakutata`（加 `-g` 则写入 `~/.config/devin/skills`）。
- **文件夹：** 项目中的 `.agents/skills`、`.devin/skills` 或 `.windsurf/skills`；用户目录中的 `~/.agents/skills` 或 `~/.config/devin/skills`（Windows 上是 `%APPDATA%\devin\skills`）。
- **确认：** 在 Devin Desktop 中，新标签页菜单里的 Open customizations 会列出 Devin Local 会话加载的所有内容；在命令行中用 `devin skills list` 和 `devin plugins list`。以插件方式安装时，技能的命令是 `/lakutata:lakutata`；复制到文件夹中时是 `/lakutata`。新安装的插件在下一个会话中加载。
- **更新：** `devin plugins update lakutata` 安装最新的提交，在下一个会话中生效。用 `npx skills` 安装的技能用 `npx skills update lakutata` 更新。
- **注意：** Devin Local 默认读不了被 git 忽略的文件，例如 `node_modules`。可以打开 Devin Local > Configuration > Gitignore access；否则技能会用终端命令读取指南，或者读取本网站上的版本。企业可以为成员关闭插件功能。
- **官方文档：** [Skills](https://docs.devin.ai/cli/extensibility/skills/overview)、[Plugins](https://docs.devin.ai/cli/extensibility/plugins/overview)。

## Gemini CLI

- **安装：**

  ```bash
  gemini skills install https://github.com/lakutata/lakutata --path plugins/lakutata/skills/lakutata
  ```

  这条命令安装到你的用户目录（`~/.gemini/skills`），对你的所有项目生效；加 `--scope workspace` 则安装到项目中（`.gemini/skills`）。也可以运行 `npx skills add lakutata/lakutata -a gemini-cli`，把技能写入项目中的 `.agents/skills/lakutata`（加 `-g` 则写入 `~/.gemini/skills`）。
- **文件夹：** 项目中的 `.gemini/skills` 或 `.agents/skills`，用户目录中的 `~/.gemini/skills` 或 `~/.agents/skills`；同名时，项目中的技能优先。
- **确认：** 在会话中输入 `/skills list`，或者在终端中运行 `gemini skills list`。Gemini CLI 在会话开始时查找技能；`/skills reload` 不用重启就能发现新的技能。让它"使用 lakutata 技能"即可主动使用；激活技能之前，它会请你确认。
- **更新：** 没有更新命令：先 `gemini skills uninstall lakutata`（项目中的安装要加上 `--scope workspace`），再重新安装。
- **注意：** 项目中的技能只在受信任的文件夹中加载：运行 `/trust`，然后重启会话。Gemini CLI 遵循 `.gitignore`，不会读取 `node_modules`，所以技能会用终端命令读取指南，或者读取本网站上的版本；设置项 `context.fileFiltering.respectGitIgnore` 可以改变这一点。
- **官方文档：** [Agent Skills](https://geminicli.com/docs/cli/skills/)。

## GitHub Copilot

- **安装：**
  - Copilot 命令行从本仓库的插件市场安装插件（它能读取 Claude 的插件市场）：

    ```bash
    copilot plugin marketplace add lakutata/lakutata
    copilot plugin install lakutata@lakutata
    ```

    在会话中：先 `/plugin marketplace add lakutata/lakutata`，再 `/plugin install lakutata@lakutata`。
  - VS Code：把这个市场加入设置项 `chat.plugins.marketplaces`（`"chat.plugins.marketplaces": ["lakutata/lakutata"]`），然后在扩展视图中搜索 `@agentPlugins`，安装 lakutata。VS Code 也会显示用 Copilot 命令行安装的插件。
  - 云端代理使用仓库中的内容：把技能提交到下面的某个文件夹中，或者在 `.github/copilot/settings.json` 中启用插件：

    ```json
    {
        "extraKnownMarketplaces": {"lakutata": {"source": {"source": "github", "repo": "lakutata/lakutata"}}},
        "enabledPlugins": {"lakutata@lakutata": true}
    }
    ```

  - 也可以运行 `npx skills add lakutata/lakutata -a github-copilot`，把技能写入项目中的 `.agents/skills/lakutata`（加 `-g` 则写入 `~/.copilot/skills`）。
- **文件夹：** 仓库中的 `.github/skills`、`.claude/skills` 或 `.agents/skills`；用户目录中的 `~/.copilot/skills` 或 `~/.agents/skills`（VS Code 还读取 `~/.claude/skills`）。
- **确认：** 在 Copilot 命令行中用 `/skills list` 或 `/skills info lakutata`；在提示中输入 `/lakutata` 可以主动使用这个技能，`/skills reload` 不用重启就能加载新的技能。在 VS Code 中，在对话框中输入 `/` 查看技能；从插件安装的技能是 `/lakutata:lakutata`。云端代理根据技能的描述决定是否使用它。
- **更新：** 在 Copilot 命令行中运行 `copilot plugin update lakutata`。VS Code 通过 Extensions: Check for Extension Updates 检查插件更新，或者在打开 `extensions.autoUpdate` 时每 24 小时检查一次；它的文档把更新和插件的 `version` 绑定在一起，而这个插件没有设置版本号（它跟随仓库的提交），所以如果等不到更新，就重新安装插件。用 `npx skills` 安装的技能用 `npx skills update lakutata` 更新。
- **注意：** 在云端代理上，只有 `.github/workflows/copilot-setup-steps.yml` 安装了依赖（`npm ci`）时才有 `node_modules`；否则技能会读取本网站上的指南。Copilot 代码审查、GitHub Copilot 应用和 JetBrains IDE 中也能使用技能。
- **官方文档：** [关于代理技能](https://docs.github.com/zh/copilot/concepts/agents/about-agent-skills)、[VS Code 中的 Agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins)。

## Kiro

- **安装：** 在 Kiro IDE 中，打开 Kiro 面板的 Agent Steering & Skills，点击 +，选择 Import a skill，再选 GitHub，粘贴技能文件夹的地址：

  ```text
  https://github.com/lakutata/lakutata/tree/main/plugins/lakutata/skills/lakutata
  ```

  Kiro 会把技能复制到你的技能文件夹中，立即生效。Kiro 命令行可以用 `npx skills add lakutata/lakutata -a kiro-cli`，写入项目中的 `.kiro/skills/lakutata`（加 `-g` 则写入 `~/.kiro/skills`）。Kiro 的 Powers 需要一个本仓库没有的清单文件。
- **文件夹：** 项目中的 `.kiro/skills` 和用户目录中的 `~/.kiro/skills`；同名时，项目中的技能优先。Kiro 的文档没有提到 `.agents/skills`。
- **确认：** 在 IDE 中看 Agent Steering & Skills 部分；在命令行中，`/context show` 列出会话中的技能。输入 `/lakutata` 可以主动使用这个技能。命令行在新的对话会话开始时查找技能。
- **更新：** 它的文档没有说明。在 IDE 中重新导入技能；用 `npx skills` 安装的技能用 `npx skills update lakutata` 更新。
- **注意：** Kiro 命令行只在你信任工作区之后才加载其中的技能。自定义智能体默认不加载技能，除非在 `resources` 中列出，例如 `skill://.kiro/skills/*/SKILL.md`。网页版和手机版的 Kiro 没有用户目录中的技能（`~/.kiro/skills`）。
- **官方文档：** [Skills](https://kiro.dev/docs/skills)。

## OpenCode

- **安装：** OpenCode 没有安装技能的工具。`npx skills add lakutata/lakutata -a opencode` 把技能写入项目中的 `.agents/skills/lakutata`（加 `-g` 则写入 `~/.config/opencode/skills`）；也可以直接复制文件夹。
- **文件夹：** 从当前文件夹到 git 工作树根目录之间每一层的 `.opencode/skills`、`.agents/skills` 或 `.claude/skills`；用户目录中的 `~/.config/opencode/skills`、`~/.agents/skills` 或 `~/.claude/skills`。
- **确认：** 它的文档没有提供列出技能的方法。在 OpenCode 2 中，在提示里写 `@lakutata` 即可加载这个技能；在 OpenCode 1 中，任务符合时模型会用它的 `skill` 工具加载技能，你也可以直接说出技能的名字。
- **更新：** 它的文档没有说明。用 `npx skills` 安装的技能用 `npx skills update lakutata` 更新；手动复制的文件夹，再复制一次即可。
- **注意：** OpenCode 1 和 OpenCode 2 目前都在使用，命令都是 `opencode`；OpenCode 1 的技能在 OpenCode 2 中可以继续使用。
- **官方文档：** [Agent Skills（OpenCode 1）](https://opencode.ai/docs/skills)、[Skills（OpenCode 2）](https://opencode.ai/v2/docs/skills/)。

## Qoder

- **安装：** 按照 Qoder 文档的建议，在 Qoder IDE 的终端中运行 `npx skills add lakutata/lakutata -a qoder`，把技能写入项目中的 `.qoder/skills/lakutata`（加 `-g` 则写入 `~/.qoder/skills`）。在 Qoder 桌面应用中：打开"扩展 > 技能 > 添加技能 > 上传技能"，上传技能的 `SKILL.md`（在[这个 zip](https://lakutata.com/lakutata-skill.zip) 中）。
- **文件夹：** IDE 和命令行都读取项目中的 `.qoder/skills` 和用户目录中的 `~/.qoder/skills`。
- **确认：** 在 IDE 中，重启后在对话框中输入 `/` 查看已加载的技能；`/lakutata` 可以主动使用这个技能。在命令行中用 `/skills`，在运行中的会话里用 `/skills reload`。在桌面应用中，技能会出现在"已安装"中；在新任务中输入 `/` 即可使用。
- **更新：** 在命令行中，新的会话会加载改动后的技能，或者用 `/skills reload`。在 IDE 中，重新复制文件夹（或者运行 `npx skills update lakutata`），然后重启。
- **注意：** 在 Qoder 命令行中，只有开启了 Skills 功能和管理员权限，`/skills` 才会出现。
- **官方文档：** [Skills](https://docs.qoder.com/zh/extensions/skills)、[Qoder 应用中的技能](https://docs.qoder.com/zh/qoder/skills)。

## Qoder CN

通义灵码已于 2026 年 5 月 20 日更名为 Qoder CN；它的 IDE 使用的文件夹仍然叫 `.lingma`。

- **安装：** Qoder CN IDE：把 `lakutata` 文件夹复制到项目中的 `.lingma/skills` 或用户目录中的 `~/.lingma/skills`，然后重启 IDE；`npx skills add lakutata/lakutata -a lingma` 写入的也是这两个文件夹。Qoder CN 命令行（`qodercn`）：`npx skills add lakutata/lakutata -a qoder-cn` 写入命令行读取的文件夹。Qoder CN 桌面应用：打开"扩展 > 技能 > 添加技能 > 上传技能"，上传技能的 `SKILL.md`（在[这个 zip](https://lakutata.com/lakutata-skill.zip) 中）。
- **文件夹：** IDE 读取项目中的 `.lingma/skills` 和用户目录中的 `~/.lingma/skills`；命令行读取项目中的 `.qoder/skills` 和用户目录中的 `~/.qoder-cn/skills`。
- **确认：** 在 IDE 中，重启后在对话框中输入 `/` 查看已加载的技能；`/lakutata` 可以主动使用这个技能。在命令行中用 `/skills`，在运行中的会话里用 `/skills reload`。
- **更新：** 在 IDE 中，重新复制文件夹（或者运行 `npx skills update lakutata`），然后重启。在命令行中，新的会话会加载改动后的技能，或者用 `/skills reload`。
- **注意：** 在 Qoder CN 命令行中，只有开启了 Skills 功能和管理员权限，`/skills` 才会出现。
- **官方文档：** [技能（Skills）](https://docs.qoder.cn/user-guide/skills)、[Qoder CN 应用中的技能](https://docs.qoder.cn/qoder/skills)。

## Trae

- **安装：** 在 Trae 中打开"设置 > 技能与命令"。在"技能"部分点击"创建"，选择"全局"或"项目"，然后上传技能的 `SKILL.md`（在[这个 zip](https://lakutata.com/lakutata-skill.zip) 中）：Trae 会据此填好技能名称、描述和指令；最后点击"确认"。也可以运行 `npx skills add lakutata/lakutata -a trae`（Trae 中国版用 `-a trae-cn`），把技能写入项目中的 `.trae/skills/lakutata`（加 `-g` 则写入 `~/.trae/skills`，Trae 中国版是 `~/.trae-cn/skills`）。
- **文件夹：** 项目中的 `.trae/skills`；用户目录中的 `~/.trae/skills`（Trae 中国版：`~/.trae-cn/skills`）。在"导入设置"中打开"启用 .agents 技能目录"之后，Trae 也会读取项目中的 `.agents/skills`；同名时，`.trae/skills` 中的技能优先。
- **确认：** "设置 > 技能与命令"中分"全局"和"项目"两个标签页列出技能，每个技能都有开关。Trae 没有调用技能的命令：直接提出要求即可，例如"使用 lakutata 技能添加一个 HTTP 路由"。
- **更新：** 它的文档没有说明。替换技能文件夹中的 `SKILL.md`；用 `npx skills` 安装的技能用 `npx skills update lakutata` 更新。
- **注意：** 上传的技能只保留 `SKILL.md`，其他文件需要手动添加；这个技能只有这一个文件。
- **官方文档：** [技能（国际版）](https://docs.trae.ai/ide/skills)、[技能（中国版）](https://docs.trae.cn/ide_skills)。

## Claude 应用

下载 [lakutata-skill.zip](https://lakutata.com/lakutata-skill.zip)（其中是 `lakutata` 文件夹），在 Claude 的设置中把它上传为技能；使用技能需要打开代码执行功能。详见 [Claude 帮助中心关于自定义技能的说明](https://support.claude.com/en/articles/12512198)。在那里，助手没有项目文件：技能提供规则和模型，只有在能访问本网站时才能读到指南。

## 其他任何助手

这个技能就是一个名为 `lakutata` 的文件夹，里面只有一个文件 `SKILL.md`；文件夹的名字必须保持为 `lakutata`。

- **npx skills：** Vercel 的工具 [skills](https://skills.sh) 可以为它支持的助手安装技能（支持的助手列在[它的 README](https://github.com/vercel-labs/skills) 中）：

  ```bash
  npx skills add lakutata/lakutata
  ```

  - 它会在本仓库中找到这个技能，然后询问要为哪些助手安装（`-a <助手>` 直接指定一个）。
  - 默认安装到当前项目中（把它创建的文件夹提交到仓库，团队成员就都能用上）；加 `-g` 则对你的所有项目生效。
  - 它在 `.agents/skills` 中保存一份副本，其他助手的文件夹以链接指向它。并不是每个助手的文档都说明会跟随这种链接：加上 `--copy` 可以写入真正的副本。
  - `npx skills update lakutata` 安装最新的提交，`npx skills remove lakutata` 删除这个技能。
  - 除非设置了 `DISABLE_TELEMETRY=1`，它会匿名地把安装记录报告给 skills.sh 的排行榜。
- **手动复制：** 把 `lakutata` 文件夹（来自[这个 zip](https://lakutata.com/lakutata-skill.zip)，或本仓库中的 [skills/lakutata](skills/lakutata)）复制到你的助手的文档所写的技能文件夹中。大多数支持 Agent Skills 的助手都读取项目中的 `.agents/skills` 和用户目录中的 `~/.agents/skills`。
- **不支持技能的助手：** 仍然把文件夹复制到项目中的 `.agents/skills/lakutata`，然后在助手读取的指令文件中（很多助手读取 `AGENTS.md`，见 [agents.md](https://agents.md)）加上一行：

  ```text
  在修改使用 lakutata 的代码之前，先阅读 .agents/skills/lakutata/SKILL.md 并按其中的要求去做。
  ```

## 内容

[skills/lakutata/SKILL.md](skills/lakutata/SKILL.md)：什么时候使用、版本检查、具体知识在哪里（指南对照表）、项目、子路径、一个应用、对象与注入、控制器、DTO 与错误，以及常见的坑。技能本身是英文的：它是写给 AI 助手读的，助手仍然会用你的语言回答。

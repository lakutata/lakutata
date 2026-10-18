# lakutata 技能

[English](README.md) | 中文

lakutata 官方的 Agent Skill（智能体技能），供 AI 编程助手使用。装上它之后，助手在 lakutata 项目中工作时，会先检查项目所用的版本，遵守框架的规则，避开常见的坑，并在写代码之前阅读对应的指南。它也会指导把 2.x 或 1.x 的项目升级到 3.x，每个版本各看各自的升级指南。

它采用 [Agent Skills](https://agentskills.io) 格式：一个名为 `lakutata` 的文件夹，里面有一个 `SKILL.md`。Claude Code、Codex、Cursor、GitHub Copilot、Gemini CLI、Kiro、OpenCode、Trae、Qoder 以及下面列出的其他助手都能加载它。

## 工作方式

技能本身很小，也很少需要改动。它只包含助手必须始终遵守的内容：版本检查（1.x、2.x 和 3.x 的代码互不兼容）、框架的模型、规则和常见的坑，以及一张"什么任务看哪篇指南"的表。具体知识按下面的顺序从文档中读取：

1. **已安装的包中自带的指南**，即 `node_modules/lakutata/doc/en/`：它们描述的正是项目所用的版本，不需要联网，项目升级 `lakutata` 时也随之更新。
2. **已安装的包的类型声明**，用来确认确切的函数签名和选项。
3. **本网站上的 Markdown 格式指南**，例如 https://lakutata.com/doc/en/Overview.md，全部列在 https://lakutata.com/llms.txt 中：在项目还没有安装 lakutata（新项目），或者助手读不了 `node_modules` 时使用。它们跟随最新的源码，所以两者都有时，以已安装的包为准。

因此框架更新时，技能本身很少需要更新。有些助手的文件工具会避开 `node_modules`（例如 Cursor 会屏蔽它忽略的文件）；这时技能会通过终端命令读取指南，或者读取本网站上的版本。

## 为任何助手安装

Vercel 的工具 [skills](https://skills.sh) 能为你电脑上已有的助手安装它：

```bash
npx skills add lakutata/lakutata
```

- 它会在本仓库中找到这个技能，然后询问要为哪些助手安装（`-a <助手>` 直接指定一个）。
- 默认安装到当前项目中（把它创建的文件夹提交到仓库，团队成员就都能用上）；加 `-g` 则对你的所有项目生效。
- 它在 `.agents/skills` 中保存一份副本，其他助手的文件夹以链接指向它。并不是每个助手的文档都说明会跟随这种链接：加上 `--copy` 可以写入真正的副本。
- 除非设置了 `DISABLE_TELEMETRY=1`，它会匿名地把安装记录报告给 skills.sh 的排行榜。

## Claude Code

在 Claude Code 会话中，从本仓库的插件市场安装：

```text
/plugin install lakutata --marketplace lakutata/lakutata
```

然后选择它的适用范围（只对你自己，或者对某个项目）。2.1.275 之前的 Claude Code 需要两条命令：

```text
/plugin marketplace add lakutata/lakutata
/plugin install lakutata@lakutata
```

在终端中（Claude Code 2.1.292 起）：`claude plugin install lakutata --marketplace lakutata/lakutata`。

插件随本仓库的提交更新：`claude plugin update lakutata@lakutata` 获取最新的提交；也可以在 `/plugin` 的 Marketplaces 中打开这个市场的自动更新。新版本在下一个会话中加载，或者运行 `/reload-plugins` 立即加载。不使用插件市场时，把技能复制到 `~/.claude/skills/lakutata`（对你的所有项目生效）或者 `.claude/skills/lakutata`（只对一个项目生效）。

## Claude 应用

下载 [lakutata-skill.zip](https://lakutata.com/lakutata-skill.zip)（其中是 `lakutata` 文件夹），在 Claude 的设置中把它上传为技能；使用技能需要打开代码执行功能。详见 [Claude 帮助中心关于自定义技能的说明](https://support.claude.com/en/articles/12512198)。在那里，助手没有项目文件：技能提供规则和模型，只有在能访问本网站时才能读到指南。

## 其他助手

把 `lakutata` 文件夹（来自[这个 zip](https://lakutata.com/lakutata-skill.zip)，或本仓库中的 [skills/lakutata](skills/lakutata)）复制到助手的某个技能文件夹中：项目中的文件夹（提交到仓库后团队共享），或者用户目录中的文件夹（对你的所有项目生效）。下表中的文件夹都来自各助手自己的文档；它们大多也读取共用的 `.agents/skills`。

| 助手 | 项目中的文件夹 | 用户目录中的文件夹 | 它自己的安装方式 |
|---|---|---|---|
| Codex（命令行和 IDE 扩展） | `.agents/skills` | `~/.agents/skills` | 在会话中让 `$skill-installer` 从本仓库安装这个技能 |
| GitHub Copilot（VS Code、命令行、云端代理） | `.github/skills` 或 `.agents/skills` | `~/.copilot/skills` 或 `~/.agents/skills` | Copilot 命令行：先 `copilot plugin marketplace add lakutata/lakutata`，再 `copilot plugin install lakutata@lakutata`；云端代理使用提交到仓库中的项目文件夹 |
| Cursor | `.cursor/skills` 或 `.agents/skills` | `~/.cursor/skills` 或 `~/.agents/skills` | |
| Gemini CLI | `.gemini/skills` 或 `.agents/skills` | `~/.gemini/skills` 或 `~/.agents/skills` | `gemini skills install https://github.com/lakutata/lakutata --path plugins/lakutata/skills/lakutata` |
| Kiro（IDE 和命令行） | `.kiro/skills` | `~/.kiro/skills` | IDE：Agent Steering & Skills，点 +，选 Import a skill，填入地址 https://github.com/lakutata/lakutata/tree/main/plugins/lakutata/skills/lakutata |
| OpenCode | `.opencode/skills` 或 `.agents/skills` | `~/.config/opencode/skills` 或 `~/.agents/skills` | |
| Devin Desktop（原 Windsurf） | `.agents/skills`、`.devin/skills` 或 `.windsurf/skills` | `~/.agents/skills` 或 `~/.config/devin/skills` | `devin plugins install lakutata/lakutata#plugins/lakutata` |
| Cline | `.cline/skills` | `~/.cline/skills` | `cline skill add lakutata/lakutata` |
| Trae | `.trae/skills` | `~/.trae/skills`（中国版：`~/.trae-cn/skills`） | 设置中的 Skills & Commands，点 Create，上传这个 zip |
| Qoder | `.qoder/skills` | `~/.qoder/skills` | 复制后重启 Qoder |
| Qoder CN（原通义灵码） | `.lingma/skills` | `~/.lingma/skills` | 复制后重启 IDE |
| CodeBuddy | `.codebuddy/skills` | `~/.codebuddy/skills`（命令行） | IDE：Import Skill 按钮 |

任务涉及 lakutata 时，各个助手会按照技能的描述自动使用它。

## 内容

[skills/lakutata/SKILL.md](skills/lakutata/SKILL.md)：什么时候使用、版本检查、具体知识在哪里（指南对照表）、项目、子路径、一个应用、对象与注入、控制器、DTO 与错误，以及常见的坑。技能本身是英文的：它是写给 AI 助手读的，助手仍然会用你的语言回答。

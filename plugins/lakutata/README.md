# The lakutata skill

English | [中文](README.zh-CN.md)

The official Agent Skill of lakutata, for AI coding assistants. With it, an assistant that works on a lakutata project
checks which version the project runs, follows the rules of the framework, avoids its pitfalls, and reads the right
guide before writing code. It also guides the upgrade of a 2.x or 1.x project to 3.x, each version by its own page.

It follows the [Agent Skills](https://agentskills.io) format: a folder named `lakutata` that holds a `SKILL.md`. Claude
Code, Codex, Cursor, GitHub Copilot, Gemini CLI, Kiro, OpenCode, Trae, Qoder and the other assistants listed below load
it.

## How it works

The skill is small and rarely changes. It holds what an assistant must always apply: the version check (1.x, 2.x and
3.x are not source compatible), the model of the framework, its rules and pitfalls, and a table of which guide covers
which task. The details come from the documentation, in this order:

1. **The guides inside the installed package**, `node_modules/lakutata/doc/en/`: they describe the very version the
   project runs, need no network, and change when the project upgrades `lakutata`.
2. **The type declarations** of the installed packages, for the exact signatures and options.
3. **The guides on this website as plain Markdown**, such as https://lakutata.com/doc/en/Overview.md, listed by
   https://lakutata.com/llms.txt: when the package is not installed yet (a new project), or when the assistant cannot
   read `node_modules`. They follow the latest sources, so the installed package wins when both exist.

So the skill seldom has to be updated when the framework changes. Some assistants keep `node_modules` away from
their file tools (Cursor blocks the files it ignores, for example); the skill then reads the guides through a shell
command, or from this website.

## Installing it in any assistant

[skills](https://skills.sh), a tool of Vercel, installs it for the assistants it finds on your machine:

```bash
npx skills add lakutata/lakutata
```

- It finds the skill in this repository, then asks which assistants to install it for (`-a <assistant>` names one).
- It installs it in the current project (commit the folders it creates to share the skill with your team), or for all
  your projects with `-g`.
- It keeps one copy in `.agents/skills` and links the folders of the other assistants to it. Not every assistant
  documents that it follows such links: add `--copy` to write real copies.
- It reports installs anonymously to the skills.sh leaderboard unless `DISABLE_TELEMETRY=1` is set.

## Claude Code

Install it from the plugin marketplace of this repository, in a Claude Code session:

```text
/plugin install lakutata --marketplace lakutata/lakutata
```

Then choose where it applies (for you, or for a project). Claude Code before 2.1.275 needs two commands:

```text
/plugin marketplace add lakutata/lakutata
/plugin install lakutata@lakutata
```

In a shell, from Claude Code 2.1.292: `claude plugin install lakutata --marketplace lakutata/lakutata`.

The plugin follows the commits of this repository: `claude plugin update lakutata@lakutata` brings the latest one, or
turn on the auto-update of the marketplace in `/plugin` (Marketplaces). A new version is loaded by the next session,
or by `/reload-plugins`. Without the marketplace, copy the skill to `~/.claude/skills/lakutata` (all your projects) or
`.claude/skills/lakutata` (one project).

## Claude apps

Download [lakutata-skill.zip](https://lakutata.com/lakutata-skill.zip) (the `lakutata` folder) and upload it as a skill
in the settings of Claude; skills need code execution to be turned on. See
[the help of Claude on custom skills](https://support.claude.com/en/articles/12512198). There, the assistant has no
project files: the skill gives it the rules and the model, and the guides only when it can reach this website.

## The other assistants

Copy the `lakutata` folder (from [the zip](https://lakutata.com/lakutata-skill.zip), or
[skills/lakutata](skills/lakutata) in this repository) into one of the folders of your assistant: a folder of the
project (commit it to share it with your team) or a folder of your user (all your projects). The folders below are
those the documentation of each assistant names; most of them also read the shared `.agents/skills`.

| Assistant | Project folder | User folder | Its own way to install |
|---|---|---|---|
| Codex (CLI and IDE extension) | `.agents/skills` | `~/.agents/skills` | Ask `$skill-installer` in a session to install the skill from this repository |
| GitHub Copilot (VS Code, CLI, cloud agent) | `.github/skills` or `.agents/skills` | `~/.copilot/skills` or `~/.agents/skills` | Copilot CLI: `copilot plugin marketplace add lakutata/lakutata`, then `copilot plugin install lakutata@lakutata`; the cloud agent uses the project folders committed to the repository |
| Cursor | `.cursor/skills` or `.agents/skills` | `~/.cursor/skills` or `~/.agents/skills` | |
| Gemini CLI | `.gemini/skills` or `.agents/skills` | `~/.gemini/skills` or `~/.agents/skills` | `gemini skills install https://github.com/lakutata/lakutata --path plugins/lakutata/skills/lakutata` |
| Kiro (IDE and CLI) | `.kiro/skills` | `~/.kiro/skills` | IDE: Agent Steering & Skills, +, Import a skill, with the address https://github.com/lakutata/lakutata/tree/main/plugins/lakutata/skills/lakutata |
| OpenCode | `.opencode/skills` or `.agents/skills` | `~/.config/opencode/skills` or `~/.agents/skills` | |
| Devin Desktop (formerly Windsurf) | `.agents/skills`, `.devin/skills` or `.windsurf/skills` | `~/.agents/skills` or `~/.config/devin/skills` | `devin plugins install lakutata/lakutata#plugins/lakutata` |
| Cline | `.cline/skills` | `~/.cline/skills` | `cline skill add lakutata/lakutata` |
| Trae | `.trae/skills` | `~/.trae/skills` (China edition: `~/.trae-cn/skills`) | Settings, Skills & Commands, Create: upload the zip |
| Qoder | `.qoder/skills` | `~/.qoder/skills` | Restart Qoder after copying |
| Qoder CN (formerly Tongyi Lingma) | `.lingma/skills` | `~/.lingma/skills` | Restart the IDE after copying |
| CodeBuddy | `.codebuddy/skills` | `~/.codebuddy/skills` (CLI) | IDE: the Import Skill button |

Each assistant uses the skill on its own when a task involves lakutata, as the description of the skill says.

## Its content

[skills/lakutata/SKILL.md](skills/lakutata/SKILL.md): when to use it, the version check, where the details are (the
table of the guides), a project, the subpaths, an application, objects and injection, controllers, DTOs and errors, and
the pitfalls. The skill is in English, as it is written for the assistants; they still answer in your language.

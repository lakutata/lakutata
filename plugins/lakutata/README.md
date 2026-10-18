# The lakutata skill

English | [中文](README.zh-CN.md)

The official Agent Skill of lakutata, for AI coding assistants. With it, an assistant that works on a lakutata project
checks which version the project runs, follows the rules of the framework, avoids its pitfalls, and reads the right
guide before writing code. It also guides the upgrade of a 2.x or 1.x project to 3.x, each version by its own page.

It follows the [Agent Skills](https://agentskills.io) format: a folder named `lakutata` that holds a `SKILL.md`. The
coding assistants below each have a section, in alphabetical order, and each section has the same parts: how to install
the skill, the folders the assistant reads, how to check that the skill is loaded, how to update it, and what to know
about that assistant. The Claude apps come after them, and the last section works for any other assistant.

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
their file tools (Cursor, Devin Desktop and Gemini CLI, for example: see their sections); the skill then reads the
guides through a shell command, or from this website.

Once installed, an assistant uses the skill on its own when a task involves lakutata, as the description of the skill
says. Each section also says how to ask for it explicitly.

## Claude Code

- **Install:** in a Claude Code session, add the plugin marketplace of this repository and install the plugin with one
  command (Claude Code 2.1.275 or later):

  ```text
  /plugin install lakutata --marketplace lakutata/lakutata
  ```

  Earlier versions need two commands: `/plugin marketplace add lakutata/lakutata`, then
  `/plugin install lakutata@lakutata`. In a shell (Claude Code 2.1.292 or later):
  `claude plugin install lakutata --marketplace lakutata/lakutata`. Then choose the scope: user (all your projects),
  project (everyone who works in the repository: the choice is committed in `.claude/settings.json`, and each
  collaborator runs the install once) or local (you, in this repository only).
- **Folders:** Claude Code reads the skills of `.claude/skills` in the project and `~/.claude/skills` in your home
  folder. Without the marketplace, copy the `lakutata` folder into one of them, or run
  `npx skills add lakutata/lakutata -a claude-code`.
- **Check:** the Installed tab of `/plugin`, or `claude plugin list` in a shell. A plugin installed in a session loads
  after `/reload-plugins`; one installed in a shell loads in the next session, or after `/reload-plugins` in an open
  one. A skill copied into a folder is found during the session (a `.claude/skills` folder created after the session
  started needs `/reload-skills`). Installed as a plugin, the skill is the command `/lakutata:lakutata`; copied into a
  folder, `/lakutata`.
- **Update:** the plugin follows the commits of this repository: `claude plugin update lakutata@lakutata` installs the
  latest one, for the next session or after `/reload-plugins`. To have it update on its own, select the marketplace in
  the Marketplaces tab of `/plugin`, then Enable auto-update (it is off for the marketplaces that are not official). A
  skill installed with `npx skills` is updated by `npx skills update lakutata`.
- **Note:** Claude Code follows symbolic links to skill folders, so the links that `npx skills` creates work.
- **Its documentation:** [Discover and install plugins](https://code.claude.com/docs/en/plugins/install),
  [Skills](https://code.claude.com/docs/en/skills).

## Cline

- **Install:** with the Cline CLI, `cline skill add lakutata/lakutata`. It runs `npx skills` (see the last section)
  for Cline, which writes the skill to `.agents/skills/lakutata` in the project;
  `npx skills add lakutata/lakutata -a cline` does the same from any shell, and with `-g` installs it for all your
  projects (`~/.agents/skills`).
- **Folders:** in the project, `.cline/skills` (the folder Cline recommends), `.clinerules/skills`, `.claude/skills` or
  `.agents/skills`; in your home folder, `~/.cline/skills` or `~/.agents/skills`. A skill in your home folder wins over
  one of the same name in the project.
- **Check:** click the scale icon at the bottom of the Cline panel, left of the model selector, and open the Skills tab
  (each skill has a switch there); in the CLI, `cline skill list` or `/skills`. Type `/lakutata` in the chat to use the
  skill explicitly.
- **Update:** `npx skills update lakutata`; a folder copied by hand is updated by copying it again.
- **Note:** the cloud agents of Cline load no skills, and in a workspace of several folders, Cline reads the skills of
  the first folder only.
- **Its documentation:** [Skills](https://docs.cline.bot/customization/skills).

## CodeBuddy

- **Install:** `npx skills add lakutata/lakutata -a codebuddy` writes the skill to `.codebuddy/skills/lakutata` in the
  project (with `-g`, to `~/.codebuddy/skills`). The CodeBuddy IDE can also import it, with the Import Skill button at
  the top right of its Skills settings. The plugin marketplaces of CodeBuddy Code expect a
  `.codebuddy-plugin/marketplace.json`, which this repository does not have.
- **Folders:** CodeBuddy Code (the CLI) reads `.codebuddy/skills` in the project and `~/.codebuddy/skills` in your home
  folder; a skill of the project wins over one of the same name in your home folder. The IDE reads `.codebuddy/skills`
  in the workspace; its documentation does not give the folder in your home folder.
- **Check:** `/skills` in CodeBuddy Code lists the loaded skills; the IDE lists them in its settings, as Project Skills
  and User Skills. Ask for the lakutata skill by name to use it explicitly.
- **Update:** its documentation does not say. A skill installed with `npx skills` is updated by
  `npx skills update lakutata`; a folder copied by hand, by copying it again.
- **Note:** the documentation of the CodeBuddy plugins for VS Code and JetBrains does not mention skills: use
  CodeBuddy Code or the CodeBuddy IDE.
- **Its documentation:** [Skills of CodeBuddy Code](https://www.codebuddy.ai/docs/cli/skills),
  [Skills of the IDE](https://www.codebuddy.ai/docs/ide/Features/Skills).

## Codex

- **Install:** `npx skills add lakutata/lakutata -a codex` writes the skill to `.agents/skills/lakutata` in the project
  (with `-g`, to `~/.agents/skills`). Codex can also install it itself, in a session:

  ```text
  $skill-installer install https://github.com/lakutata/lakutata/tree/main/plugins/lakutata/skills/lakutata
  ```

  This puts it in `~/.codex/skills`, for all your projects.
- **Folders:** `.agents/skills` in each folder from the current one up to the root of the repository, and
  `~/.agents/skills` in your home folder. Codex follows symbolic links to skill folders.
- **Check:** in Codex CLI or the IDE extension, `/skills`; type `$lakutata` to use the skill explicitly. In the ChatGPT
  desktop app, open Skills in the sidebar. Codex notices new and changed skills on its own; restart it if one does not
  appear.
- **Update:** `npx skills update lakutata`. `$skill-installer` does not overwrite a skill: delete
  `~/.codex/skills/lakutata` before installing it again.
- **Note:** skills work in Codex CLI, its IDE extension and Codex in the ChatGPT desktop app. To turn the skill off
  without deleting it, add a `[[skills.config]]` entry with its path and `enabled = false` to `~/.codex/config.toml`.
- **Its documentation:** [Build skills](https://learn.chatgpt.com/docs/build-skills).

## Cursor

- **Install:** `npx skills add lakutata/lakutata -a cursor` writes the skill to `.agents/skills/lakutata` in the
  project (with `-g`, to `~/.cursor/skills`). Cursor imports skills from GitHub only inside a plugin, from a repository
  that has a `.cursor-plugin/marketplace.json`, which this repository does not have.
- **Folders:** `.cursor/skills` or `.agents/skills` in the project, `~/.cursor/skills` or `~/.agents/skills` in your
  home folder; Cursor also loads `.claude/skills` and `~/.claude/skills`.
- **Check:** open Customize in the sidebar, then Skills. In the Agent chat, type `/` and search for lakutata to use the
  skill explicitly; in the Cursor CLI, `/skills` lists the skills. Cursor looks for skills when it starts.
- **Update:** `npx skills update lakutata`, or copy the folder again; then restart Cursor.
- **Note:** Cursor blocks the files it ignores from its Agent, and it ignores `node_modules` by default: the agent
  cannot open the guides of the installed package with its file tools. The skill then reads them with a terminal
  command, which Cursor does not block, or from this website. Cloud Agents get the skills of `~/.cursor/skills`, not
  those of `~/.agents/skills`.
- **Its documentation:** [Agent Skills](https://cursor.com/docs/skills).

## Devin Desktop

Windsurf was renamed Devin Desktop on June 2, 2026. Devin Local, its agent, reads skills as the Devin CLI does.

- **Install:** Devin installs the plugin of this repository (it reads the Claude manifest of a plugin). With the Devin
  CLI, sign in (`devin auth login`), then:

  ```bash
  devin plugins install lakutata/lakutata#plugins/lakutata
  ```

  Plugins are installed at the user level, and Devin Desktop gets the same plugins when you are signed in. Or
  `npx skills add lakutata/lakutata -a devin`, which writes the skill to `.devin/skills/lakutata` in the project (with
  `-g`, to `~/.config/devin/skills`).
- **Folders:** `.agents/skills`, `.devin/skills` or `.windsurf/skills` in the project; `~/.agents/skills` or
  `~/.config/devin/skills` in your home folder (on Windows, `%APPDATA%\devin\skills`).
- **Check:** in Devin Desktop, Open customizations (in the menu of a new tab) lists what a Devin Local session has
  loaded; in the CLI, `devin skills list` and `devin plugins list`. Installed as a plugin, the skill is the command
  `/lakutata:lakutata`; copied into a folder, `/lakutata`. A newly installed plugin is loaded by the next session.
- **Update:** `devin plugins update lakutata` installs the latest commit, for the next session. A skill installed with
  `npx skills` is updated by `npx skills update lakutata`.
- **Note:** by default, Devin Local cannot read the files that git ignores, such as `node_modules`. Turn on
  Devin Local > Configuration > Gitignore access; otherwise the skill reads the guides with a terminal command or from
  this website.
  An enterprise can turn plugins off for its members.
- **Its documentation:** [Skills](https://docs.devin.ai/cli/extensibility/skills/overview),
  [Plugins](https://docs.devin.ai/cli/extensibility/plugins/overview).

## Gemini CLI

- **Install:**

  ```bash
  gemini skills install https://github.com/lakutata/lakutata --path plugins/lakutata/skills/lakutata
  ```

  This installs it for you, in `~/.gemini/skills`; add `--scope workspace` to install it in the project
  (`.gemini/skills`). Or `npx skills add lakutata/lakutata -a gemini-cli`, which writes the skill to
  `.agents/skills/lakutata` in the project (with `-g`, to `~/.gemini/skills`).
- **Folders:** `.gemini/skills` or `.agents/skills` in the project, `~/.gemini/skills` or `~/.agents/skills` in your
  home folder; a skill of the project wins over one of the same name in your home folder.
- **Check:** `/skills list` in a session, or `gemini skills list` in a shell. Gemini CLI looks for skills when a
  session starts; `/skills reload` finds new ones without a restart. Ask it to use the lakutata skill to use it
  explicitly; it asks you to confirm before it activates a skill.
- **Update:** there is no update command: `gemini skills uninstall lakutata` (with `--scope workspace` for a project
  install), then install it again.
- **Note:** the skills of a project load only in a trusted folder: run `/trust`, then restart the session. Gemini CLI
  follows `.gitignore` and does not read `node_modules`, so the skill reads the guides with a shell command or from
  this website; the setting `context.fileFiltering.respectGitIgnore` changes that.
- **Its documentation:** [Agent Skills](https://geminicli.com/docs/cli/skills/).

## GitHub Copilot

- **Install:**
  - Copilot CLI installs the plugin of this repository from its marketplace (it reads Claude marketplaces):

    ```bash
    copilot plugin marketplace add lakutata/lakutata
    copilot plugin install lakutata@lakutata
    ```

    In a session: `/plugin marketplace add lakutata/lakutata`, then `/plugin install lakutata@lakutata`.
  - VS Code: add the marketplace to the setting `chat.plugins.marketplaces`
    (`"chat.plugins.marketplaces": ["lakutata/lakutata"]`), then install lakutata from the Extensions view, searching
    for `@agentPlugins`. VS Code also shows the plugins installed with Copilot CLI.
  - The cloud agent uses what the repository holds: commit the skill to one of the folders below, or enable the plugin
    in `.github/copilot/settings.json`:

    ```json
    {
        "extraKnownMarketplaces": {"lakutata": {"source": {"source": "github", "repo": "lakutata/lakutata"}}},
        "enabledPlugins": {"lakutata@lakutata": true}
    }
    ```

  - Or `npx skills add lakutata/lakutata -a github-copilot`, which writes the skill to `.agents/skills/lakutata` in the
    project (with `-g`, to `~/.copilot/skills`).
- **Folders:** `.github/skills`, `.claude/skills` or `.agents/skills` in the repository; `~/.copilot/skills` or
  `~/.agents/skills` in your home folder (VS Code also reads `~/.claude/skills`).
- **Check:** in Copilot CLI, `/skills list` or `/skills info lakutata`; type `/lakutata` in a prompt to use the skill
  explicitly, and `/skills reload` loads a new skill without a restart. In VS Code, type `/` in the chat to see the
  skills; from the plugin, the skill is `/lakutata:lakutata`. The cloud agent chooses a skill by its description.
- **Update:** in Copilot CLI, `copilot plugin update lakutata`. VS Code checks for plugin updates with Extensions:
  Check for Extension Updates, or every 24 hours when `extensions.autoUpdate` is on; its documentation ties an update
  to a new `version` of the plugin, which this plugin does not set (it follows the commits), so if an update does not
  arrive, install the plugin again. A skill installed with `npx skills` is updated by `npx skills update lakutata`.
- **Note:** on the cloud agent, `node_modules` exists only when `.github/workflows/copilot-setup-steps.yml` installs
  the dependencies (`npm ci`); without it, the skill reads the guides from this website. Skills also work in Copilot
  code review, the GitHub Copilot app and the JetBrains IDEs.
- **Its documentation:** [About agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills),
  [Agent plugins in VS Code](https://code.visualstudio.com/docs/agent-customization/agent-plugins).

## Kiro

- **Install:** in the Kiro IDE, open Agent Steering & Skills in the Kiro panel, click +, choose Import a skill, then
  GitHub, and paste the address of the skill folder:

  ```text
  https://github.com/lakutata/lakutata/tree/main/plugins/lakutata/skills/lakutata
  ```

  Kiro copies the skill to your skills folder, and it works at once. For the Kiro CLI,
  `npx skills add lakutata/lakutata -a kiro-cli` writes it to `.kiro/skills/lakutata` in the project (with `-g`, to
  `~/.kiro/skills`). Kiro powers need a manifest that this repository does not have.
- **Folders:** `.kiro/skills` in the project and `~/.kiro/skills` in your home folder; a skill of the project wins over
  one of the same name in your home folder. The documentation of Kiro does not name `.agents/skills`.
- **Check:** in the IDE, the Agent Steering & Skills section; in the CLI, `/context show` lists the skills of the
  session. Type `/lakutata` to use the skill explicitly. The CLI looks for skills when a new chat session starts.
- **Update:** its documentation does not say. Import the skill again in the IDE; a skill installed with `npx skills`
  is updated by `npx skills update lakutata`.
- **Note:** the Kiro CLI loads the skills of a workspace only once you trust it. Custom agents load no skills unless
  their `resources` list them, for example `skill://.kiro/skills/*/SKILL.md`. Kiro on the web and on mobile has no
  skills of your home folder (`~/.kiro/skills`).
- **Its documentation:** [Skills](https://kiro.dev/docs/skills).

## OpenCode

- **Install:** OpenCode has no installer for skills. `npx skills add lakutata/lakutata -a opencode` writes the skill to
  `.agents/skills/lakutata` in the project (with `-g`, to `~/.config/opencode/skills`); or copy the folder.
- **Folders:** `.opencode/skills`, `.agents/skills` or `.claude/skills`, in each folder from the current one up to the
  root of the git worktree; `~/.config/opencode/skills`, `~/.agents/skills` or `~/.claude/skills` in your home folder.
- **Check:** its documentation gives no list of the skills. In OpenCode 2, mention `@lakutata` in a prompt to load the
  skill; in OpenCode 1, the model loads it with its `skill` tool when a task matches it, and you can ask for it by
  name.
- **Update:** its documentation does not say. A skill installed with `npx skills` is updated by
  `npx skills update lakutata`; a folder copied by hand, by copying it again.
- **Note:** OpenCode 1 and OpenCode 2 are both current, and both use the `opencode` command; the skills of OpenCode 1
  keep working in OpenCode 2.
- **Its documentation:** [Agent Skills (OpenCode 1)](https://opencode.ai/docs/skills),
  [Skills (OpenCode 2)](https://opencode.ai/v2/docs/skills/).

## Qoder

- **Install:** in the terminal of the Qoder IDE, as the documentation of Qoder suggests,
  `npx skills add lakutata/lakutata -a qoder` writes the skill to `.qoder/skills/lakutata` in the project (with `-g`,
  to `~/.qoder/skills`). In the Qoder desktop app: Extensions > Skills > Add Skills > Upload Skill, and upload the
  `SKILL.md` of the skill (from [the zip](https://lakutata.com/lakutata-skill.zip)).
- **Folders:** `.qoder/skills` in the project and `~/.qoder/skills` in your home folder, for the IDE and the CLI.
- **Check:** in the IDE, restart it, then type `/` in the chat to see the loaded skills; `/lakutata` uses the skill
  explicitly. In the CLI, `/skills`, and `/skills reload` in a running session. In the desktop app, the skill appears
  under Installed; type `/` in a new task.
- **Update:** in the CLI, a new session loads the changed skill, or `/skills reload`. In the IDE, copy the folder
  again (or run `npx skills update lakutata`), then restart it.
- **Note:** in the Qoder CLI, `/skills` appears only when skill support and the administrator permission are turned
  on.
- **Its documentation:** [Skills](https://docs.qoder.com/extensions/skills),
  [Skills in the Qoder app](https://docs.qoder.com/qoder/skills).

## Qoder CN

Tongyi Lingma (通义灵码) was renamed Qoder CN on May 20, 2026; the folders of its IDE keep the name `.lingma`.

- **Install:** for the Qoder CN IDE, copy the `lakutata` folder into `.lingma/skills` in the project or
  `~/.lingma/skills` in your home folder, then restart the IDE; `npx skills add lakutata/lakutata -a lingma` writes it
  to the same folders. For the Qoder CN CLI (`qodercn`), `npx skills add lakutata/lakutata -a qoder-cn` writes it to
  the folders of the CLI. In the Qoder CN desktop app: 扩展 > 技能 > 添加技能 > 上传技能
  (Extensions > Skills > Add Skills > Upload Skill), and upload the `SKILL.md` of the skill (from
  [the zip](https://lakutata.com/lakutata-skill.zip)).
- **Folders:** the IDE reads `.lingma/skills` in the project and `~/.lingma/skills` in your home folder; the CLI reads
  `.qoder/skills` in the project and `~/.qoder-cn/skills` in your home folder.
- **Check:** in the IDE, after the restart, type `/` in the chat to see the loaded skills; `/lakutata` uses the skill
  explicitly. In the CLI, `/skills`, and `/skills reload` in a running session.
- **Update:** in the IDE, copy the folder again (or run `npx skills update lakutata`), then restart it. In the CLI, a
  new session loads the changed skill, or `/skills reload`.
- **Note:** in the Qoder CN CLI, `/skills` appears only when skill support and the administrator permission are
  turned on.
- **Its documentation:** [Skills](https://docs.qoder.cn/user-guide/skills),
  [Skills in the Qoder CN app](https://docs.qoder.cn/qoder/skills).

## Trae

- **Install:** in Trae, open Settings > Skills & Commands. In the Skills section, click Create, choose Global or
  Project, and upload the `SKILL.md` of the skill (from [the zip](https://lakutata.com/lakutata-skill.zip)): Trae fills
  in the name, the description and the instructions from it; then click Confirm. Or
  `npx skills add lakutata/lakutata -a trae` (`-a trae-cn` for Trae CN), which writes the skill to
  `.trae/skills/lakutata` in the project (with `-g`, to `~/.trae/skills`, or `~/.trae-cn/skills` for Trae CN).
- **Folders:** `.trae/skills` in the project; `~/.trae/skills` in your home folder (Trae CN: `~/.trae-cn/skills`).
  Trae also reads `.agents/skills` in the project once Enable .agents Skills Directory is turned on in Import Settings;
  a skill in `.trae/skills` wins over one of the same name there.
- **Check:** Settings > Skills & Commands lists the skills, on a Global tab and a Project tab, with a switch for each.
  Trae has no command for a skill: ask for it, for example "Use the lakutata skill to add an HTTP route".
- **Update:** its documentation does not say. Replace the `SKILL.md` in the folder of the skill; a skill installed
  with `npx skills` is updated by `npx skills update lakutata`.
- **Note:** an uploaded skill keeps only its `SKILL.md`, and any other file is added by hand; this skill is that one
  file.
- **Its documentation:** [Skills](https://docs.trae.ai/ide/skills),
  [Skills of Trae CN](https://docs.trae.cn/ide_skills).

## Claude apps

Download [lakutata-skill.zip](https://lakutata.com/lakutata-skill.zip) (the `lakutata` folder) and upload it as a skill
in the settings of Claude; skills need code execution to be turned on. See
[the help of Claude on custom skills](https://support.claude.com/en/articles/12512198). There, the assistant has no
project files: the skill gives it the rules and the model, and the guides only when it can reach this website.

## Any other assistant

The skill is one folder named `lakutata` that holds one file, `SKILL.md`; the folder must keep the name `lakutata`.

- **npx skills:** [skills](https://skills.sh), a tool of Vercel, installs the skill for the assistants it knows (they
  are listed in [its README](https://github.com/vercel-labs/skills)):

  ```bash
  npx skills add lakutata/lakutata
  ```

  - It finds the skill in this repository, then asks which assistants to install it for (`-a <assistant>` names one).
  - It installs it in the current project (commit the folders it creates to share the skill with your team), or for
    all your projects with `-g`.
  - It keeps one copy in `.agents/skills` and links the folders of the other assistants to it. Not every assistant
    documents that it follows such links: add `--copy` to write real copies.
  - `npx skills update lakutata` installs the latest commit, and `npx skills remove lakutata` removes the skill.
  - It reports installs anonymously to the skills.sh leaderboard unless `DISABLE_TELEMETRY=1` is set.
- **By hand:** copy the `lakutata` folder (from [the zip](https://lakutata.com/lakutata-skill.zip), or
  [skills/lakutata](skills/lakutata) in this repository) into the skills folder the documentation of your assistant
  names. Most assistants that load Agent Skills read `.agents/skills` in the project and `~/.agents/skills` in your
  home folder.
- **An assistant without skills:** copy the folder to `.agents/skills/lakutata` in the project anyway, and add a line
  to the instructions file your assistant reads (`AGENTS.md` for many of them, see [agents.md](https://agents.md)):

  ```text
  Before working on code that uses lakutata, read .agents/skills/lakutata/SKILL.md and follow it.
  ```

## Its content

[skills/lakutata/SKILL.md](skills/lakutata/SKILL.md): when to use it, the version check, where the details are (the
table of the guides), a project, the subpaths, an application, objects and injection, controllers, DTOs and errors, and
the pitfalls. The skill is in English, as it is written for the assistants; they still answer in your language.

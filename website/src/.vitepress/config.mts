import {existsSync, readFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {defineConfig, type DefaultTheme} from 'vitepress'
import {publishedPackages} from '../../scripts/packages.mjs'

const ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const REPOSITORY: string = 'https://github.com/lakutata/lakutata'

/**
 * The guides, in the order of the README of lakutata, by group
 */
const GUIDES: {en: string, zh: string, guides: string[]}[] = [
    {en: 'Introduction', zh: '入门', guides: ['Overview', 'GettingStarted', 'ProjectStructure']},
    {en: 'Fundamentals', zh: '基础', guides: ['Application', 'Objects', 'Injection', 'DTOValidation', 'Exceptions', 'Logger', 'Decorator', 'Time', 'HelperFunctions']},
    {en: 'Controllers and Entrypoints', zh: '控制器与入口', guides: ['Controllers', 'Entrypoint', 'Middlewares', 'HTTP', 'CLI', 'ServiceCalls', 'GRPC', 'NATS', 'Schedules', 'Queue']},
    {en: 'Data', zh: '数据', guides: ['Database', 'DatabaseDrivers', 'MongoEmbedded', 'Entities', 'Migrations', 'Cache']},
    {en: 'Components', zh: '组件', guides: ['Mutex', 'I18n', 'DockerIntegration', 'ContainerdIntegration', 'Monitor', 'Security', 'DBus', 'MCP']},
    {en: 'Tools', zh: '工具', guides: ['Command', 'Workspaces', 'NativeAddons', 'Packaging', 'Installers']}
]

/**
 * The title of a guide: its first heading, without the name of the framework
 * @param language The language of the guide.
 * @param guide The guide.
 */
function guideTitle(language: 'en' | 'zh', guide: string): string {
    const heading: string = readFileSync(join(ROOT, 'packages/lakutata/doc', language, `${guide}.md`), 'utf8').split('\n')[0]
    return heading.replace(/^#\s*/, '').replace(/^Lakutata\s*/, '').trim() || guide
}

/**
 * The sidebar of the guides of a language
 * @param language The language.
 * @param base The path of the guides.
 */
function guideSidebar(language: 'en' | 'zh', base: string): DefaultTheme.SidebarItem[] {
    return GUIDES.map((group): DefaultTheme.SidebarItem => ({
        text: group[language],
        items: group.guides
            .filter((guide: string): boolean => existsSync(join(ROOT, 'packages/lakutata/doc', language, `${guide}.md`)))
            .map((guide: string): DefaultTheme.SidebarItem => ({text: guideTitle(language, guide), link: `${base}/${guide}`}))
    }))
}

/**
 * The sidebar of the examples of a language: the pages its index (README.md) links to, in its order
 * @param language The language of the pages.
 */
function exampleSidebar(language: 'en' | 'zh'): DefaultTheme.SidebarItem[] {
    const directory: string = join(ROOT, 'packages/lakutata/doc', language, 'examples')
    const base: string = language === 'zh' ? '/zh/examples/' : '/examples/'
    if (!existsSync(join(directory, 'README.md'))) return []
    const pages: string[] = [...readFileSync(join(directory, 'README.md'), 'utf8').matchAll(/\]\(([A-Za-z]+)\.md\)/g)].map((match): string => match[1])
    return [{
        text: language === 'zh' ? '示例' : 'Examples',
        link: base,
        items: pages.filter((page: string): boolean => existsSync(join(directory, `${page}.md`))).map((page: string): DefaultTheme.SidebarItem => ({
            text: readFileSync(join(directory, `${page}.md`), 'utf8').split('\n')[0].replace(/^#\s*/, ''),
            link: `${base}${page}`
        }))
    }]
}

/**
 * The sidebar of the packages of a language
 * @param language The language of the pages.
 */
function packageSidebar(language: 'en' | 'zh'): DefaultTheme.SidebarItem[] {
    const base: string = language === 'zh' ? '/zh/packages/' : '/packages/'
    return [{
        text: language === 'zh' ? '包列表' : 'Packages',
        link: base,
        items: publishedPackages().map((manifest): DefaultTheme.SidebarItem => ({text: manifest.name, link: `${base}${manifest.directory}`}))
    }]
}

/**
 * The sidebars of the API reference, one by module (a page carries the sidebar of its module only: the whole reference
 * in every page would make them heavy), and the list of the modules for its index; the Chinese website has the same
 * pages under /zh/api/
 * @param language The language of the website.
 */
function apiSidebars(language: 'en' | 'zh'): Record<string, DefaultTheme.SidebarItem[]> {
    const file: string = resolve(dirname(fileURLToPath(import.meta.url)), '../api/typedoc-sidebar.json')
    if (!existsSync(file)) return {}
    const modules: {name: string, link: string, items: DefaultTheme.SidebarItem[]}[] = []
    //A module is an item linked to its index; a folder of the subpaths (`com`, `adapter`) holds modules
    const isModule = (item: DefaultTheme.SidebarItem): boolean => !!item.link?.endsWith('/')
    const isFolder = (item: DefaultTheme.SidebarItem): boolean => !item.link && !!item.items?.some((child): boolean => isModule(child) && /^[a-z]/.test(child.text ?? ''))
    const collect = (items: DefaultTheme.SidebarItem[]): void => {
        for (const item of items) {
            //Its groups (the classes, the functions...), without the modules of its subpaths
            if (isModule(item)) modules.push({name: item.link!.replace(/^(\/zh)?\/api\//, '').slice(0, -1), link: item.link!, items: (item.items ?? []).filter((child): boolean => !isModule(child) && !isFolder(child))})
            collect((item.items ?? []).filter((child): boolean => !!child.items?.length))
        }
    }
    const prefix: string = language === 'zh' ? '/zh' : ''
    //The links of the Chinese pages
    const localized = (items: DefaultTheme.SidebarItem[]): DefaultTheme.SidebarItem[] => items.map((item): DefaultTheme.SidebarItem => ({...item, ...(item.link ? {link: `${prefix}${item.link}`} : {}), ...(item.items ? {items: localized(item.items)} : {})}))
    collect(localized(JSON.parse(readFileSync(file, 'utf8'))))
    modules.sort((a, b): number => a.name.localeCompare(b.name))
    const root: string = `${prefix}/api/`
    const index: DefaultTheme.SidebarItem = {text: language === 'zh' ? '模块' : 'Modules', link: root, items: modules.map((module): DefaultTheme.SidebarItem => ({text: module.name, link: module.link}))}
    const sidebars: Record<string, DefaultTheme.SidebarItem[]> = {[root]: [index]}
    for (const module of modules)
        sidebars[module.link] = [{text: language === 'zh' ? '← 所有模块' : '← All modules', link: root}, {text: module.name, link: module.link, items: module.items}]
    return sidebars
}

/**
 * The edit link of a page: the file of the repository it comes from. Serialized to the browser by VitePress, it is
 * self-contained (no name of this module)
 * @param page The page.
 */
const editLink = ({filePath}: {filePath: string}): string => {
    const example = /^(zh\/)?examples\/(.*)$/.exec(filePath)
    const source: string = filePath.startsWith('guide/') ? `packages/lakutata/doc/en/${filePath.slice(6)}`
        : filePath.startsWith('zh/guide/') ? `packages/lakutata/doc/zh/${filePath.slice(9)}`
            : example ? `packages/lakutata/doc/${example[1] ? 'zh' : 'en'}/examples/${example[2] === 'index.md' ? 'README.md' : example[2]}`
            : filePath.startsWith('packages/') && filePath !== 'packages/index.md' ? `packages/${filePath.slice(9).replace(/\.md$/, '')}/README.md`
                : filePath.startsWith('zh/packages/') && filePath !== 'zh/packages/index.md' ? `packages/${filePath.slice(12).replace(/\.md$/, '')}/README.zh-CN.md`
                    : `website/src/${filePath}`
    return `https://github.com/lakutata/lakutata/edit/main/${source}`
}

/**
 * The HTML elements the pages of the repository may use (the other words in angle brackets are text)
 */
const HTML_ELEMENTS: Set<string> = new Set(('a abbr b blockquote br caption code col colgroup dd del details div dl dt em figcaption figure ' +
    'h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p picture pre q s samp section small source span strong sub summary sup ' +
    'table tbody td tfoot th thead time tr u ul var video wbr').split(' '))

/**
 * The pages copied or generated from the repository (the guides, the READMEs, the API reference): their text is kept
 * as it is, never compiled by Vue (its `{{...}}` are ICU messages or templates, its `<T>` types)
 * @param path The path of the page in the website.
 */
function verbatim(path: string): boolean {
    return /^(zh\/)?(guide|examples|packages|api)\//.test(path)
}

export default defineConfig({
    title: 'Lakutata',
    markdown: {
        config(markdown): void {
            markdown.core.ruler.push('lakutata-verbatim', (state): void => {
                if (!verbatim(state.env?.relativePath ?? '')) return
                //A word in angle brackets which is no HTML element (`<name>`, `<T>`) is text
                const text = (token: {type: string, content: string}): void => {
                    const tag: string | undefined = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(token.content.trim())?.[1]
                    if (tag && !HTML_ELEMENTS.has(tag.toLowerCase())) token.type = 'text'
                }
                for (const token of state.tokens) {
                    if (token.type === 'html_block') text(token)
                    for (const child of token.children ?? []) if (child.type === 'html_inline') text(child)
                }
                const open = new state.Token('html_block', '', 0)
                open.content = '<div v-pre>\n'
                const close = new state.Token('html_block', '', 0)
                close.content = '</div>\n'
                state.tokens.unshift(open)
                state.tokens.push(close)
            })
        }
    },
    description: 'An IoC framework for Node.js and TypeScript: web services, CLI tools, desktop and embedded applications',
    cleanUrls: true,
    //The configuration in a chunk of its own, rather than in every page
    metaChunk: true,
    lastUpdated: false,
    sitemap: {hostname: 'https://lakutata.com'},
    head: [
        ['link', {rel: 'icon', type: 'image/svg+xml', href: '/logo.svg'}],
        ['meta', {name: 'theme-color', content: '#ffde00'}]
    ],
    locales: {
        root: {
            label: 'English',
            lang: 'en',
            themeConfig: {
                nav: [
                    {text: 'Guide', link: '/guide/Overview', activeMatch: '/guide/'},
                    {text: 'Examples', link: '/examples/', activeMatch: '/examples/'},
                    {text: 'API', link: '/api/', activeMatch: '/api/'},
                    {text: 'Packages', link: '/packages/', activeMatch: '/packages/'},
                    {text: 'npm', link: 'https://www.npmjs.com/package/lakutata'}
                ],
                sidebar: {
                    '/guide/': guideSidebar('en', '/guide'),
                    '/examples/': exampleSidebar('en'),
                    ...apiSidebars('en'),
                    '/packages/': packageSidebar('en')
                },
                editLink: {
                    pattern: editLink,
                    text: 'Edit this page on GitHub'
                }
            }
        },
        zh: {
            label: '简体中文',
            lang: 'zh-CN',
            link: '/zh/',
            description: '面向 Node.js 和 TypeScript 的 IoC 框架：Web 服务、命令行工具、桌面和嵌入式应用',
            themeConfig: {
                nav: [
                    {text: '指南', link: '/zh/guide/Overview', activeMatch: '/zh/guide/'},
                    {text: '示例', link: '/zh/examples/', activeMatch: '/zh/examples/'},
                    {text: 'API', link: '/zh/api/', activeMatch: '/zh/api/'},
                    {text: '包列表', link: '/zh/packages/', activeMatch: '/zh/packages/'},
                    {text: 'npm', link: 'https://www.npmjs.com/package/lakutata'}
                ],
                sidebar: {
                    '/zh/guide/': guideSidebar('zh', '/zh/guide'),
                    '/zh/examples/': exampleSidebar('zh'),
                    ...apiSidebars('zh'),
                    '/zh/packages/': packageSidebar('zh')
                },
                editLink: {
                    pattern: editLink,
                    text: '在 GitHub 上编辑此页'
                },
                outline: {label: '本页目录'},
                docFooter: {prev: '上一页', next: '下一页'},
                darkModeSwitchLabel: '外观',
                lightModeSwitchTitle: '切换到浅色模式',
                darkModeSwitchTitle: '切换到深色模式',
                sidebarMenuLabel: '菜单',
                returnToTopLabel: '回到顶部',
                langMenuLabel: '语言'
            }
        }
    },
    themeConfig: {
        logo: '/logo.svg',
        socialLinks: [{icon: 'github', link: REPOSITORY}],
        search: {
            provider: 'local',
            options: {
                //The guides and the packages: the API reference has its own sidebar
                _render(source, environment, markdown): string {
                    if (/^(zh\/)?api\//.test(environment.relativePath)) return ''
                    return markdown.render(source, environment)
                },
                locales: {
                    zh: {
                        translations: {
                            button: {buttonText: '搜索', buttonAriaLabel: '搜索'},
                            modal: {
                                noResultsText: '没有找到结果',
                                resetButtonTitle: '清除',
                                footer: {selectText: '选择', navigateText: '切换', closeText: '关闭'}
                            }
                        }
                    }
                }
            }
        },
        footer: {
            message: 'Released under the MIT License.',
            copyright: 'Copyright © 2023-present Lakutata'
        }
    }
})

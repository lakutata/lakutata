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
    {en: 'Introduction', zh: '入门', guides: ['Overview']},
    {en: 'Fundamentals', zh: '基础', guides: ['Core', 'DTOValidation', 'Decorator', 'ActionPattern']},
    {en: 'Controllers and Entrypoints', zh: '控制器与入口', guides: ['CLI', 'GRPC', 'NATS', 'Schedules', 'Queue']},
    {en: 'Components', zh: '组件', guides: ['ORMIntegration', 'I18n', 'Mutex', 'DockerIntegration', 'ContainerdIntegration']},
    {en: 'Utilities', zh: '工具', guides: ['Security', 'Time', 'HelperFunctions']}
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
 * The sidebar of the packages
 */
function packageSidebar(): DefaultTheme.SidebarItem[] {
    return [{
        text: 'Packages',
        link: '/packages/',
        items: publishedPackages().map((manifest): DefaultTheme.SidebarItem => ({text: manifest.name, link: `/packages/${manifest.directory}`}))
    }]
}

/**
 * The sidebars of the API reference, one by module (a page carries the sidebar of its module only: the whole reference
 * in every page would make them heavy), and the list of the modules for its index
 */
function apiSidebars(): Record<string, DefaultTheme.SidebarItem[]> {
    const file: string = resolve(dirname(fileURLToPath(import.meta.url)), '../api/typedoc-sidebar.json')
    if (!existsSync(file)) return {}
    const modules: {name: string, link: string, items: DefaultTheme.SidebarItem[]}[] = []
    //A module is an item linked to its index; a folder of the subpaths (`com`, `adapter`) holds modules
    const isModule = (item: DefaultTheme.SidebarItem): boolean => !!item.link?.endsWith('/')
    const isFolder = (item: DefaultTheme.SidebarItem): boolean => !item.link && !!item.items?.some((child): boolean => isModule(child) && /^[a-z]/.test(child.text ?? ''))
    const collect = (items: DefaultTheme.SidebarItem[]): void => {
        for (const item of items) {
            //Its groups (the classes, the functions...), without the modules of its subpaths
            if (isModule(item)) modules.push({name: item.link!.slice('/api/'.length, -1), link: item.link!, items: (item.items ?? []).filter((child): boolean => !isModule(child) && !isFolder(child))})
            collect((item.items ?? []).filter((child): boolean => !!child.items?.length))
        }
    }
    collect(JSON.parse(readFileSync(file, 'utf8')))
    modules.sort((a, b): number => a.name.localeCompare(b.name))
    const index: DefaultTheme.SidebarItem = {text: 'Modules', link: '/api/', items: modules.map((module): DefaultTheme.SidebarItem => ({text: module.name, link: module.link}))}
    const sidebars: Record<string, DefaultTheme.SidebarItem[]> = {'/api/': [index]}
    for (const module of modules)
        sidebars[module.link] = [{text: '← All modules', link: '/api/'}, {text: module.name, link: module.link, items: module.items}]
    return sidebars
}

/**
 * The edit link of a page: the file of the repository it comes from. Serialized to the browser by VitePress, it is
 * self-contained (no name of this module)
 * @param page The page.
 */
const editLink = ({filePath}: {filePath: string}): string => {
    const source: string = filePath.startsWith('guide/') ? `packages/lakutata/doc/en/${filePath.slice(6)}`
        : filePath.startsWith('zh/guide/') ? `packages/lakutata/doc/zh/${filePath.slice(9)}`
            : filePath.startsWith('packages/') && filePath !== 'packages/index.md' ? `packages/${filePath.slice(9).replace(/\.md$/, '')}/README.md`
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
    return /^(guide|zh\/guide|packages|api)\//.test(path)
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
                    {text: 'API', link: '/api/', activeMatch: '/api/'},
                    {text: 'Packages', link: '/packages/', activeMatch: '/packages/'},
                    {text: 'npm', link: 'https://www.npmjs.com/package/lakutata'}
                ],
                sidebar: {
                    '/guide/': guideSidebar('en', '/guide'),
                    ...apiSidebars(),
                    '/packages/': packageSidebar()
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
                    {text: 'API（英文）', link: '/api/'},
                    {text: '包列表（英文）', link: '/packages/'},
                    {text: 'npm', link: 'https://www.npmjs.com/package/lakutata'}
                ],
                sidebar: {
                    '/zh/guide/': guideSidebar('zh', '/zh/guide')
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
                    if (environment.relativePath.startsWith('api/')) return ''
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

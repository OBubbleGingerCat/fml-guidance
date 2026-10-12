import { defineConfig, type DefaultTheme } from 'vitepress'

const base = '/fml-guidance/'

// One sidebar per language: the same pages, under /zh/ in Chinese.
type Page = [string, string, string] // path, English title, Chinese title

const guide: Page[] = [
  ['introduction', 'What is FML?', 'FML 是什么'],
  ['getting-started', 'Getting started', '快速开始'],
  ['modules', 'Modules and parameters', '模块与参数'],
  ['state-and-tasks', 'State and tasks', '状态与 task'],
  ['time', 'Time: clocks and events', '时间：时钟与事件'],
  ['components', 'Components and interfaces', '组件与接口'],
  ['external-ports', 'External ports', '外部端口'],
  ['running', 'Running a simulation', '运行仿真'],
  ['snapshots', 'Snapshots', '快照'],
  ['performance', 'Performance and runtime policies', '性能与运行时策略'],
  ['errors', 'Errors and debugging', '报错与调试'],
]

const examples: Page[] = [
  ['event-pipeline', 'Event pipeline', '事件流水线'],
  ['gpgpu-sim', 'GPGPU-Sim reproduction', 'GPGPU-Sim 复现'],
  ['event-bench', 'Event benchmark', '事件基准'],
]

function section(prefix: string, dir: string, pages: Page[], zh: boolean): DefaultTheme.SidebarItem[] {
  return pages.map(([path, en, cn]) => ({ text: zh ? cn : en, link: `${prefix}/${dir}/${path}` }))
}

function sidebar(zh: boolean): DefaultTheme.Sidebar {
  const prefix = zh ? '/zh' : ''
  const groups: [string, string, string, Page[]][] = [
    ['guide', 'Guide', '用法', guide],
    ['examples', 'Examples', '示例', examples],
  ]
  return Object.fromEntries(
    groups.map(([dir, en, cn, pages]) => [
      `${prefix}/${dir}/`,
      groups.map(([d, e, c, p]) => ({
        text: zh ? c : e,
        collapsed: d !== dir,
        items: section(prefix, d, p, zh),
      })),
    ]),
  )
}

function nav(zh: boolean): DefaultTheme.NavItem[] {
  const prefix = zh ? '/zh' : ''
  return [
    { text: zh ? '用法' : 'Guide', link: `${prefix}/guide/introduction`, activeMatch: `${prefix}/guide/` },
    { text: zh ? '示例' : 'Examples', link: `${prefix}/examples/gpgpu-sim`, activeMatch: `${prefix}/examples/` },
  ]
}

export default defineConfig({
  base,
  title: 'FML',
  description: 'Full-System Modeling Language: clocked timing and discrete events in one Rust model, simulated in parallel with deterministic results.',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#1f2d4d' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'FML: Full-System Modeling Language' }],
    ['meta', { property: 'og:image', content: `https://obubblegingercat.github.io${base}og.png` }],
  ],
  markdown: {
    theme: { light: 'github-light', dark: 'github-dark' },
  },
  themeConfig: {
    logo: { light: '/logo.svg', dark: '/logo-dark.svg', alt: 'FML' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/OBubbleGingerCat/fml-guidance' }],
    search: {
      provider: 'local',
      options: {
        locales: {
          zh: {
            translations: {
              button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
              modal: {
                noResultsText: '没有找到',
                resetButtonTitle: '清除',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
              },
            },
          },
        },
      },
    },
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: nav(false),
        sidebar: sidebar(false),
        footer: {
          message: 'Released under the AGPL-3.0 license.',
          copyright: 'Copyright © 2026 the FML authors',
        },
      },
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh/',
      description: 'FML（全系统建模语言）：在一个 Rust 模型里结合时钟驱动的时序与离散事件，并行仿真，结果确定。',
      themeConfig: {
        nav: nav(true),
        sidebar: sidebar(true),
        outline: { label: '本页目录', level: [2, 3] },
        docFooter: { prev: '上一页', next: '下一页' },
        lastUpdated: { text: '最后更新' },
        returnToTopLabel: '回到顶部',
        sidebarMenuLabel: '目录',
        darkModeSwitchLabel: '深色模式',
        langMenuLabel: '语言',
        footer: {
          message: '以 AGPL-3.0 许可发布。',
          copyright: 'Copyright © 2026 FML 作者',
        },
      },
    },
  },
})

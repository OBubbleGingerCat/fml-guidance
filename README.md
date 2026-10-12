<p align="center">
  <img src="docs/public/logo.svg" width="120" alt="FML logo">
</p>

# FML guidance · FML 指南

The website of FML, the Full-System Modeling Language:
<https://obubblegingercat.github.io/fml-guidance/> (English, with a Chinese
version at `/zh/`).

FML（全系统建模语言）的网站：<https://obubblegingercat.github.io/fml-guidance/zh/>。

## Working on the site · 修改网站

The site is built with [VitePress](https://vitepress.dev). The English pages
are in `docs/`, the Chinese ones in `docs/zh/` with the same names; the
navigation and sidebars are in `docs/.vitepress/config.mts`.

网站用 VitePress 生成。英文页面在 `docs/`，中文页面在 `docs/zh/`，文件名一一对应；
导航和侧栏在 `docs/.vitepress/config.mts`。

```sh
npm ci            # install
npm run dev       # live preview at http://localhost:5173/fml-guidance/
npm run build     # build into docs/.vitepress/dist
```

Every push to `main` builds the site and publishes it on GitHub Pages
(`.github/workflows/deploy.yml`).

每次推到 `main` 都会自动构建并发布到 GitHub Pages。

## License · 许可

AGPL-3.0, see [LICENSE](LICENSE).

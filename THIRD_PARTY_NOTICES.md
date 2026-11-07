# 第三方组件

运行所需的以下组件已经放入 `app/vendor/`，使用时无需从 CDN 下载。

| 组件 | 版本 | 许可 | 官方来源 |
| --- | --- | --- | --- |
| PDF.js | 5.6.205 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| PDF-LIB | 1.17.1 | MIT | https://github.com/Hopding/pdf-lib |
| JSZip | 3.10.1 | MIT（本项目所采用条款） | https://github.com/Stuk/jszip |
| xml-js | 1.6.11 | MIT | https://github.com/nashwaan/xml-js |
| Material Color Utilities | 0.4.0 | Apache-2.0 | https://github.com/material-foundation/material-color-utilities |
| Material Symbols Rounded（子集） | 0.48.3 | Apache-2.0 | https://github.com/google/material-design-icons |
| Google Sans Flex（拉丁字符子集） | 5.3.2（Fontsource 打包） | SIL OFL 1.1 | https://fonts.google.com/specimen/Google+Sans+Flex |

PDF.js 许可位于 `app/vendor/PDFJS-LICENSE.txt`，PDF-LIB 许可位于 `app/vendor/PDFLIB-LICENSE.txt`。PDF.js 字体、CMap、ICC 和 WASM 目录中的附带许可也随目录保留。

界面字体与图标放在 `app/fonts/`：Material Symbols Rounded 只保留界面实际用到的 83 个图标（保留填充与字重两个可变轴，许可 `app/fonts/MATERIAL-SYMBOLS-LICENSE.txt`）；Google Sans Flex 只含拉丁字符（字重与圆润度两个可变轴，许可 `app/fonts/GOOGLE-SANS-FLEX-OFL.txt`），中文仍使用系统的微软雅黑。Material Color Utilities 用 esbuild 打包为单文件 `app/vendor/material-color.mjs`，许可位于 `app/vendor/MATERIAL-COLOR-LICENSE.txt`。

JSZip 和 xml-js 的许可也随 vendor 目录提供。在线安装器下载并校验 Electron 官方 45.2.3 运行组件；标准 NSIS 构建则把运行组件装进安装包。Electron 运行组件随附 Chromium 和其他第三方许可。源码包 `runtime/` 目录用于放置与 `installer/runtime.json` 对应的完整运行组件。Calibre 为用户可选安装的独立转换组件，未随本项目分发。开发测试依赖的许可见各 npm 包。

墨页名称、界面、应用图标和示例文档为本项目内容。界面遵循公开的 Material Design 3 设计规范，未使用 Google 或 Goodnotes 的商标图形。

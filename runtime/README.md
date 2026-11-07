# Windows 离线运行组件

> **0.5.0 说明**：0.4.0 和 0.5.0 使用的运行组件与 0.3.3 完全相同。为了减小下载体积，源码包没有附带这个 158 MB 的 ZIP。重新打包前，请把 0.3.3 源码包 `runtime/` 中的 `electron-v45.2.3-win32-x64.zip` 复制到本目录。构建器会核对下面的 SHA-256，不一致时会直接停止。0.5.0 的离线安装 EXE 已经内置这个组件，直接安装不需要它。

本目录中的 `electron-v45.2.3-win32-x64.zip` 与墨页 0.3.3 已交付的完整离线安装器中嵌入的 ZIP 相同，可直接传给 `installer/build-offline-exe.py --runtime`。

- 平台：Windows x64。
- 版本：Electron 45.2.3。
- 文件大小：158182975 字节。
- SHA-256：`4bb5f7adf3b08cc0bdef88623de2f623f69b228eda762fb56450b27b02d0482f`。
- 原始来源：Electron 官方仓库 v45.2.3 发布流水线 `41872094557`，构建产物 `13348223727` 的 `dist.zip`。
- 官方流水线外层构建产物 SHA-256：`4cedaba2c79de8b6a229d7e44987cbd2f4d58303f7f2bbc09bb7174762796a5d`。
- 原始提交：`d0a18d02058b21ff292e25d5f53f00bd120f2f61`。

该文件是官方流水线的原始构建 ZIP，未经过公开发布包的后续签名处理，因此与 GitHub 发布页最终同名 ZIP 的摘要不同。两个摘要及来源分别记录在 `installer/runtime.json`。本次从已经保存的 0.3.3 离线安装器提取后，再次核对了文件大小和 SHA-256。

运行组件自带 Electron/Chromium 许可文件。解压到 Windows 后可用于桌面开发预览；打包时使用本目录未修改的 ZIP。

运行组件已经随源码提供。Node.js、Python、GCC/binutils 等开发工具需要由开发环境提供。

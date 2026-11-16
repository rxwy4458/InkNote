# 墨页原生书写测试版

面向一加 Pad 2 Pro 的原生迁移第一阶段：验证实际书写体验，再迁移完整产品。

界面为 Kotlin + Compose，画布为 Android Jetpack Ink 1.0.0 的 `InProgressStrokesView`。
应用不使用 WebView，也不加载 HTML、CSS 或 JavaScript。

## 已实现

- 原生笔记库、新建与重命名、多页、空白/横线/点阵纸张。
- 压感画笔、荧光笔、整笔橡皮擦、撤销与重做、颜色与粗细设置。
- 笔迹预测（可关闭）、非批处理输入请求、按 pointer ID 跟踪手写笔，手掌不会因为增加一根触点就中断笔迹。
- 手指平移、两指缩放、页面适配。仅用笔书写默认开启。
- 使用最高刷新率请求；显示系统实际报告的刷新率。系统设置、温度、电量策略可能限制实际刷新率。
- 历史笔迹使用独立 RenderNode 缓存；移动笔尖不会重画整个 Compose 界面或遍历历史笔迹。
- 完成的笔迹在串行后台任务中原子保存，保存真实位置、时间、压感等输入；预测点不进入文件。
- PDF 导入和原生批注，后台渲染 PDF（单页缓存，最大 2048 像素宽）、PDF 导出。
- `.inknative` 可编辑备份导入导出，包含原 PDF。

## 范围

这是可以实际书写和保存的测试版，不是 0.7.0 的完整替代。
帖子/楼中楼、富文本、电子书、无限画布、二维模板与图层、套索、局部橡皮擦、插件和旧 `.inknote` 数据迁移尚未接入。
PDF 暂无随缩放重采样的分块渲染；重点先验证空白页、密集笔迹和普通 PDF 上的实时书写。

应用 ID 为 `com.inknote.nativepreview`，显示名称「墨页·原生试写」。可与原版同时安装。
测试 APK 使用 Android 调试签名，后续测试更新需保留相同签名，或先导出 `.inknative` 再安装。
本版要求 Android 10 或以上。一加 Pad 2 Pro 的具体 ColorOS 和手写笔版本需在真机上验证。

## 构建与验证

在仓库根目录：

```sh
cd mobile/native-android
../android/gradlew assembleDebug assembleDebugAndroidTest lintDebug
../android/gradlew connectedDebugAndroidTest
```

依赖仓库已有的 Gradle 8.14.3 Wrapper，使用 JDK 17、Android SDK 36。
GitHub Actions「Native Android ink preview」构建 APK、检查签名，并在 Android 15 平板模拟器上运行仪器测试。

仪器测试覆盖压感/时间戳持久化、真实点与预测点分离、取消输入、手掌与笔的 pointer index 变化、撤销重做、快速整笔擦除、可编辑备份往返、PDF 导出再导入，以及原生笔记库到编辑器的实际交互。
模拟器测试可以验证功能，不能代表一加平板上的端到端手写延迟。

## 真机比较

1. 使用相同手写笔、屏幕刷新率、笔宽和纸张缩放，对比 Goodnotes、自由笔记和本版。
2. 分别测试点按、慢写、快写、急转弯、连续圆圈、手掌贴屏、密集笔迹和 PDF 页面。
3. 打开「更多 → 笔迹预测」比较开关前后的笔尖距离，以及急转弯时有没有过冲。
4. 检查「当前屏幕」显示的实际 Hz。144 Hz 的帧间隔约 6.94 ms，这不等于端到端书写延迟。
5. 使用另一台设备的高速录像观察笔尖到首个可见像素、移动笔尖到笔迹末端的差距。

技术依据：
- https://developer.android.com/develop/ui/views/touch-and-input/stylus-input/ink-api-draw-stroke
- https://developer.android.com/develop/ui/views/touch-and-input/stylus-input/ink-api-modules
- https://developer.android.com/jetpack/androidx/releases/ink

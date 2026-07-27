[简体中文](./README.md) | [English](./README.en.md)

# Quareia 占卜 · Android 离线演示版

这是 Quareia 占卜网站的 Android 演示版本。应用将网站界面封装为适合手机使用的离线体验，不需要登录，也不申请网络权限。

本项目为非官方、非商业演示，与 Quareia、Josephine McCarthy、相关艺术家或出版方不存在隶属、赞助或背书关系。

## 功能

- 支持塔罗牌、Mystagogus（M 牌）与 LXXXI 魔法牌
- 支持简体中文与 English 一键切换
- 支持网站版的牌组、牌阵、正逆位规则与本地占卜历史
- 可从铺开的牌堆中自行选择任意一张牌
- 点击「开牌解读」后，可直接轻点牌阵中的牌，在牌面与牌意之间翻转
- 重新洗牌或切换会清空牌阵的设置时，使用与站点视觉一致的确认窗口
- 页面与必要内容随应用提供，可离线完成主要操作

## 构建与运行

环境要求：

- JDK 17
- Android SDK（compileSdk 36，minSdk 24）

在 Windows PowerShell 中运行：

```powershell
cd android-demo
.\gradlew.bat :app:assembleDebug
android run --apks=app\build\outputs\apk\debug\app-debug.apk
```

调试 APK 输出到：

```text
app/build/outputs/apk/debug/app-debug.apk
```

## 已验证场景

- 应用可在 Android 模拟器中启动并进入首页
- 三套牌组可切换，抽牌与开牌流程可用
- 开牌后轻点牌面可查看牌意，再次轻点可返回牌面
- 重新洗牌确认窗口支持取消、继续与点击遮罩关闭
- 占卜历史保存在当前应用的本地 WebView 数据中

## 内容与权利说明

MIT 许可仅适用于本项目原创程序代码及明确标注为原创的内容。第三方牌面、出版物内容及其整理、改写或翻译不在 MIT 许可范围内，也不因本演示版的存在而获得复制或再分发授权。完整说明见仓库根目录的 [`LICENSE`](../LICENSE) 与 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。

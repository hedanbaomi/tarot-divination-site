[简体中文](./README.md) | [English](./README.en.md)

# Quareia 占卜 · Android 离线演示版

这是 Quareia 占卜网站的 Android 演示版本。应用将网站界面封装为适合手机使用的离线体验，不需要登录；牌面与核心功能不依赖网络。应用会为可关闭的匿名使用统计和外部链接申请 `INTERNET` 权限。

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

在 Windows PowerShell 中运行（仅用于开发调试）：

```powershell
cd android-demo
.\gradlew.bat :app:assembleDebug
android run --apks=app\build\outputs\apk\debug\app-debug.apk
```

`debug` 变体可调试且未启用 R8，严禁分发或上传。需要在本机验证加固后的
离线牌面时使用：

```powershell
cd android-demo
.\gradlew.bat :app:assembleHardened
android run --apks=app\build\outputs\apk\hardened\app-hardened.apk
```

`hardened` 是不可调试、启用 R8/shrink 的本地验收变体，使用 Android
debug 签名，仅用于本机验证，不能作为正式发布签名。正式发布使用
`assembleRelease` 直接产出已签名 APK，并须通过 `apksigner verify`：

```powershell
.\gradlew.bat :app:assembleRelease
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.0\apksigner.bat" verify --print-certs app\build\outputs\apk\release\app-release.apk
```

仓库不包含发布凭据。签名配置从仓库外的 `keystore.properties` 读取：通过
环境变量 `QUAREIA_KEYSTORE_PROPERTIES` 指向该文件，或放在
`C:\Users\32735\Desktop\证书与密钥\占卜app\keystore.properties` 回退路径；
找不到时 release 构建会直接失败，不会产出无签名 APK。keystore 与密码必须
妥善离线备份，丢失后将无法向已安装用户发布更新。mapping 文件必须私下保存。

调试 APK 输出到（不可分发）：

```text
app/build/outputs/apk/debug/app-debug.apk
```

本地加固验收 APK 输出到：

```text
app/build/outputs/apk/hardened/app-hardened.apk
```

正式发布 APK（release keystore 签名）输出到：

```text
app/build/outputs/apk/release/app-release.apk
```

## 开源边界

本仓库是应用的开源代码。LXXXI 牌面的解密实现、密钥材料与加密牌面记录
**不随开源仓库发布**（见根目录 `.gitignore` 对应条目）：`LxxxiVault.kt`、
`VaultMaterial.kt`、`qv/` 资产目录以及相关测试仅存在于受控本机环境，用于
构建带完整牌面的正式发布 APK。开源构建的 `MainActivity` 中，LXXXI 牌面
图片请求一律返回 404（牌意文本仍可用）；完整功能仅通过 GitHub Releases
发布的正式 APK 提供。

## 已验证场景

- 应用可在 Android 模拟器中启动并进入首页
- 三套牌组可切换，抽牌与开牌流程可用
- 开牌后轻点牌面可查看牌意，再次轻点可返回牌面
- 重新洗牌确认窗口支持取消、继续与点击遮罩关闭
- 占卜历史保存在当前应用的本地 WebView 数据中
- 「关于 / 版权与署名」页面可从首页右上角进入，中英文随系统语言切换，Quareia 链接可点击跳转，作者英文原文逐字保留

## 内容与权利说明

本应用为非官方、免费、严格非商业工具，不含广告、打赏、订阅、付费云服务、付费解锁或其他盈利功能。Josephine McCarthy 的书面许可已明确覆盖本免费应用（及对应的免费 GitHub Pages 网站），但仅限严格非商业使用，并排除在一切开源许可之外。

应用内提供「关于 / 版权与署名」页面（首页右上角按钮进入），中英文双语，包含：项目非商业声明、Mystagogus 与 LXXXI 的版权署名、第三方素材与应用开源许可的分离说明、可点击的 Quareia 官网链接，以及作者要求逐字保留的英文原文与中文参考译文。

MIT 许可仅适用于本项目原创程序代码及明确标注为原创的内容。第三方牌面（Mystagogus、LXXXI 等）、出版物内容及其整理、改写或翻译不在 MIT 许可范围内，也不因本应用开源而获得复制或再分发授权。LXXXI 牌面内容不随开源仓库提供；正式 APK 中的牌面经过保护性打包，不含原始扫描母版，也不提供批量导出或下载原图功能。完整说明见仓库根目录的 [`LICENSE`](../LICENSE) 与 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。

正式发布所需的开发者密钥材料仅保存在受控本机目录，禁止提交、打包、上传或
共享。如需在受控环境重建完整牌面的正式 APK，请联系维护者获取材料与流程说明。

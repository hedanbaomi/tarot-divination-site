[简体中文](./README.md) | [English](./README.en.md)

# Quareia 占卜 · Android 离线演示版

这是 Quareia 占卜网站的 Android 演示版本。应用将网站界面封装为适合手机使用的离线体验，不需要登录；牌面与核心功能不依赖网络。应用会为可关闭的匿名使用统计和外部链接申请 `INTERNET` 权限。

本项目为非官方演示，与 Quareia、Josephine McCarthy、相关艺术家或出版方不存在隶属、赞助或背书关系。

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

仓库不包含发布凭据。release 签名只通过环境变量或 Gradle property 提供：

- 环境变量 `QUAREIA_KEYSTORE_PROPERTIES` 指向仓库外的一个
  `keystore.properties` 文件（含 `storeFile` / `storePassword` /
  `keyAlias` / `keyPassword`），或
- Gradle property：`quareia.keystore.storeFile`、
  `quareia.keystore.storePassword`、`quareia.keystore.keyAlias`、
  `quareia.keystore.keyPassword`（写在 `~/.gradle/gradle.properties` 或
  构建时以 `-P` 传入）。

未配置凭据时，`assembleDebug`、`testDebugUnitTest`、`assembleHardened` 与
IDE Sync 均可正常工作；只有请求 `assembleRelease` 时构建会以
“SigningConfig 'release' is missing required property 'storeFile'”清晰失败，
不会产出未签名 APK。keystore 与密码必须妥善离线备份，丢失后将无法向已
安装用户发布更新。mapping 文件必须私下保存。

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

## 应用内更新（v1.2.0 起）

应用在启动时静默检查 GitHub Releases，并在「关于 / 版权」页提供手动检查。
应用内更新只接受正式发布的 Release（非 draft、非 prerelease），且必须恰好
包含一个名为 `QuareiaDivination-v<版本>.apk` 的 APK 资产，其大小不超过
100 MiB，并带有 GitHub API 返回的 `sha256:<hex>` digest；资产缺失、重复、
digest 缺失或格式非法、或下载 URL 不是可信的 GitHub HTTPS 域名时，一律
fail closed（提示“检查更新失败”或“下载失败”），绝不回退到 tarball/zipball
或 Release 页面。

下载在后台线程进行，文件先写入应用私有目录 `files/updates/` 下的 `.part`
临时文件；下载完成后必须全部通过以下校验才会打开系统安装器：

1. 实际文件大小等于 Release 资产 size；
2. 文件 SHA-256 等于 GitHub API 返回的 `sha256:<hex>` digest；
3. APK 可被 PackageManager 正常解析；
4. `packageName` 必须等于 `com.quareia.divination`；
5. versionCode 高于当前已安装版本；
6. APK 签名证书的 SHA-256 与当前已安装应用的签名证书（含签名轮换历史）
   匹配——证书 digest 由系统读取并实时计算，不使用任何硬编码字符串。

任一校验失败都会删除下载文件、不打开安装器，并给出本地化的安全提示；
权限开启后的续装同样会重新校验。注意区分两个不同的 SHA-256：第 2 条是
APK 文件的哈希，第 6 条是签名证书的哈希，两者不是一回事。

安装权限流程：用户确认更新且下载校验完成后，若应用已有“允许安装未知来源
应用”权限，直接打开系统安装器；若没有，则保存待安装 APK 状态并跳转到
对应系统设置页。用户返回应用后会自动重新检查权限：已开启则重新校验缓存的
APK 并自动继续安装；未开启或缓存文件已失效（被删除、大小或 digest 不符、
解析失败等）时给出明确提示，且不会重复下载。Activity 重建或进程重启后，
待安装状态从本地偏好中安全恢复，路径始终限制在应用私有更新目录内。

v1.1 及更早版本不含修复后的应用内更新；本次为最后一次手动安装
v1.2.0，此后各版本即可使用应用内更新。

## 公告与活跃版本统计（v1.2.0 起）

应用的普通公告检查有 6 小时节流；回到前台时会执行 fresh 检查，以及时获取
新的 `important` / `update` revision。网络失败不影响任何功能；「关于 / 版权」
页提供公告列表与手动刷新入口。

- 公告由后台（telemetry-worker 的 D1）按状态、平台、版本范围、起止时间
  过滤后下发；内容为纯文本，客户端不渲染 HTML。
- `important` / `update` 级别的未读公告在打开应用时弹出一次；`info` 公告
  只进入公告列表，不强制弹窗。
- 已读状态按 `id + revision` 记录在本地：后台编辑后 revision 递增，会重新
  展示。
- `update` 公告的按钮直接复用应用内更新器（检查更新并提示下载）；
  其余公告的 action URL 仅当为 HTTPS 时才交给系统浏览器打开。
- 中英文随应用当前语言选择，缺少对应语言时回退另一种语言。

匿名活跃版本统计：新版本在首次启动、回到前台、以及已安装版本变化时，通过
遥测通道上报 `app_active`（含当前 `versionCode`）；同一版本最多每 6 小时
上报一次，版本变化立即上报。遥测关闭时不再发送任何事件，并继续删除本机
匿名标识。后台据此维护“活跃安装数/活跃设备数”统计（24 小时 / 7 天 / 30 天
窗口与按最近上报版本的分布），这些数字是匿名估算值，不代表精确用户人数。
v1.1 的 `install_seen` / `daily_active` / `reading_completed` 事件保持兼容；
v1.1 客户端的 `daily_active` 也会计入统计（标记为“未知/旧客户端”），升级后
上报的 `app_active` 会将其迁移到新版本分组。

### 隐私与联网语义

- 关闭遥测后，`app_active`、`daily_active`、`install_seen` 与
  `reading_completed` 均不再发送，本机匿名安装标识随即删除；
- 公告检查与应用更新检查不属于统计，关闭遥测后仍可能联网；
- 公告请求不携带 install_hash，也不上传占卜内容、牌阵、问题或本地历史；
- 活跃安装数/活跃设备数基于随机安装标识的周期性采样估算，不是精确用户
  人数。

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

本应用为非官方工具。Josephine McCarthy 的书面许可已明确覆盖本 Android 应用和对应的 GitHub Pages 网站；微信小程序于 2026-08-05 单独获得扩展同意。非商业条件仅针对 Mystagogus/LXXXI 牌面、牌意、翻译、牌阵及相关授权材料，而不是对用户原创 Android 软件、基础设施或无关独立服务的一般性商业禁令。授权材料不得出售、设置付费墙或付费解锁、单独商业分发、转授权，也不得纳入 AGPL、MPL 或小程序 proprietary 软件许可；涉及这些材料的商业利用必须另行取得权利人授权。本文不声称 Josephine 已批准任何具体商业模式。

应用内提供「关于 / 版权与署名」页面（首页右上角按钮进入），中英文双语，包含：授权材料的非商业边界、Mystagogus 与 LXXXI 的版权署名、第三方素材与应用开源许可的分离说明、可点击的 Quareia 官网链接，以及作者要求逐字保留的英文原文与中文参考译文。

本目录中由项目作者创作的公开 Android 原生/宿主代码、Android 专用资源、Gradle 项目配置和测试使用 `MPL-2.0`。Android 包内的 Web 软件资产按目录许可地图作为 Android 分发版本使用 MPL；根网站则单独使用 `AGPL-3.0-only`。第三方牌面（Mystagogus、LXXXI 等）、出版物内容及其整理、改写或翻译不进入任何上述开源许可，也不因本应用开源而获得复制或再分发授权。私有 LXXXI provider/Vault/material/qv 同样排除。LXXXI 牌面内容不随开源仓库提供；正式 APK 中的牌面经过保护性打包，不含原始扫描母版，也不提供批量导出或下载原图功能。完整说明见 [`LICENSE.md`](LICENSE.md)、仓库根目录的 [`LICENSE.md`](../LICENSE.md) 与 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。`v1.2.0` 及以前已取得的历史 MIT 授权继续有效。

正式发布所需的开发者密钥材料仅保存在受控本机目录，禁止提交、打包、上传或
共享。如需在受控环境重建完整牌面的正式 APK，请联系维护者获取材料与流程说明。

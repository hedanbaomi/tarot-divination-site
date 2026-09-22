# iPhone / iPad 安装 IPA：超详细自签教程

> 适用对象：第一次听说“IPA、自签、证书、开发者模式”的普通用户。  
> 目标：把本项目提供的 `.ipa` 文件安装到自己的 iPhone / iPad 上。  
> 最后核对：2026-09-22。

如果你只想尽快装上，不想研究原理，**优先看「方法一：Sideloadly」**。它对第一次操作的人最直观。

---

## 0. 先说人话：什么叫 IPA、自签、侧载？

Android 下载的是 `.apk`；iPhone / iPad 上的应用安装包通常是 `.ipa`。

但 iOS 默认不会让你随便双击一个 IPA 就安装。除了 App Store 等正式分发渠道以外，系统还要求这个 App 带有 Apple 能识别的有效签名。

所谓**自签**，可以简单理解成：

1. 你下载本项目提供的 IPA；
2. 用你自己的 Apple 账户向 Apple 申请一个个人开发签名；
3. 工具用这个签名重新签一次 IPA；
4. 再把签过名的 App 安装到你自己的设备上。

这不需要越狱。

### 免费 Apple 账户和付费开发者账户有什么区别？

绝大多数普通用户直接使用**免费 Apple 账户**就可以。

免费账户最重要的限制是：

- 自签 App 的有效期通常只有 **7 天**；
- 到期前需要重新签名 / 刷新；
- 免费账户通常最多同时保留 **3 个侧载 App**；
- 某些高级 entitlement / App 能力无法使用。

这不是本项目设置的限制，而是 Apple 的个人开发签名限制。

如果你有付费 Apple Developer Program 账户，签名有效期通常可到 **1 年**，并且限制更少。

---

# 1. 安装前准备

你需要准备：

- 一台 iPhone 或 iPad；
- 一个能正常登录的 Apple 账户；
- 本项目的 `.ipa` 文件；
- 一根能传数据的数据线；
- 根据你选择的方法，准备 Windows / macOS / Linux 电脑。

本项目发布页：

https://github.com/hedanbaomi/tarot-divination-site/releases

如果某个版本提供 iOS 安装包，请下载文件名以 `.ipa` 结尾的文件。

> **不要把 APK 下载到 iPhone 上。** APK 是 Android 安装包，iPhone 不能安装。

---

# 2. 三种方法怎么选？

| 方法 | 难度 | 需要电脑 | 后续续签 | 适合谁 |
|---|---:|---|---|---|
| **Sideloadly** | ★ | 安装和续签时通常需要 | 可配置自动刷新 | 第一次自签、只想把 IPA 装上 |
| **AltStore Classic** | ★★ | 初装需要，刷新时电脑端 AltServer 要可连接 | AltStore 可自动/手动刷新 | 经常侧载多个 App |
| **SideStore** | ★★★ | 初装需要，之后通常不需要电脑 | 可在手机端刷新 | 愿意多配置一步，想减少依赖电脑 |

**完全小白推荐顺序：Sideloadly > AltStore > SideStore。**

如果你只是安装本项目，而不是长期折腾各种 IPA，Sideloadly 通常最省事。

---

# 3. 方法一：Sideloadly（最推荐小白）

官方站点：

https://sideloadly.io/

Sideloadly 支持 Windows 和 macOS，不需要越狱，也支持免费 Apple 账户。

## 3.1 Windows 用户：先处理 Apple 驱动

这是整个教程里**最容易翻车的一步**。

Sideloadly 官方目前仍建议 Windows 用户安装 Apple 官网提供的 iTunes / iCloud 组件，而不是依赖不兼容的精简驱动环境。

如果之后出现：

- No devices detected
- 找不到 iPhone
- 插线以后 Sideloadly 没反应
- 登录/Anisette 异常

第一件事就是回来检查 Apple 驱动。

### 步骤 A：安装 iTunes / Apple 设备支持

安装后：

1. 用数据线连接 iPhone；
2. 解锁 iPhone；
3. iPhone 如果弹出「要信任此电脑吗？」；
4. 点**信任**；
5. 输入 iPhone 锁屏密码；
6. 电脑端打开 iTunes，确认能看到你的设备。

如果电脑连 iTunes 都看不到手机，Sideloadly 大概率也看不到。

### 步骤 B：必要时安装 iCloud

如果 Sideloadly 提示和 Apple 账户认证、Anisette、iCloud 组件有关，再检查 iCloud 是否正确安装。

Sideloadly 官方下载页会给出其当前推荐的 Apple 组件下载入口，请优先按官方页面提示操作。

---

## 3.2 macOS 用户准备

macOS 通常简单很多：

1. 用数据线连接 iPhone；
2. 解锁；
3. Finder 左侧找到你的 iPhone；
4. 如果弹出「信任」，电脑和手机两边都点信任；
5. 确认 Finder 能正常看到设备。

---

## 3.3 下载并打开 Sideloadly

1. 打开 https://sideloadly.io/
2. 下载对应系统版本；
3. 安装；
4. 启动 Sideloadly；
5. 用数据线连接 iPhone；
6. 等几秒。

正常情况下，Sideloadly 顶部设备框里会出现你的 iPhone。

### 如果设备栏是空的

依次检查：

1. iPhone 有没有解锁；
2. 有没有点「信任此电脑」；
3. 换一个 USB 接口；
4. 换一根确认能传数据的线；
5. Windows 下打开 iTunes 看能否识别设备；
6. 重启 Sideloadly；
7. 还不行就重启电脑和手机。

很多“神秘问题”最后真的是线只能充电不能传数据。

---

## 3.4 把 IPA 放进去

你可以：

- 把下载好的 `.ipa` 文件直接拖到 Sideloadly 窗口；
- 或点击 IPA 图标手动选择文件。

确认你选的是本项目的 IPA。

---

## 3.5 填 Apple 账户

在 Apple Account / Apple ID 一栏填写你的 Apple 账户邮箱。

然后：

1. 点击 **Start**；
2. 根据提示输入 Apple 账户密码；
3. 如果开启了双重认证，按提示完成验证码验证。

### 我应该用主 Apple 账户吗？

技术上可以。

如果你比较介意把主账户用于第三方签名工具，也可以专门注册一个 Apple 账户用于侧载。

无论用哪个账号，都建议：

- 开启双重认证；
- 不要把密码发给任何人；
- 只从 Sideloadly 官方站点下载工具。

---

## 3.6 等待安装完成

点击 Start 后不要拔线。

你会看到日志不断滚动。

成功时通常会看到类似：

`Done.`

然后查看 iPhone 主屏幕/App 资源库。

此时 App 可能已经出现，但**第一次打开大概率还会提示开发者未受信任**。

这很正常。

---

# 4. 第一次打开前：信任开发者

在 iPhone / iPad 上打开：

**设置 → 通用 → VPN 与设备管理**

不同 iOS 版本里名字可能略有不同，例如：

- VPN 与设备管理
- 设备管理
- 描述文件与设备管理

进入后，找到与你刚才用于签名的 Apple 账户对应的「开发者 App」。

点进去，然后：

**信任 / 允许并重新启动**

在较新的系统中，Apple 可能要求设备重启来完成信任。

如果页面显示「尚未验证」，先确认手机能联网，然后重新点验证。

---

# 5. iOS 16 及以上：打开开发者模式

如果系统提示：

> Developer Mode Required  
> 需要启用开发者模式

请打开：

**设置 → 隐私与安全性 → 开发者模式**

然后：

1. 打开开关；
2. 按提示重新启动设备；
3. 开机解锁；
4. 系统会再次询问是否启用开发者模式；
5. 选择启用；
6. 输入锁屏密码。

完成后再打开 App。

> 看不到「开发者模式」也不要慌。有时它会在你第一次通过开发工具安装应用后才出现。

---

# 6. Sideloadly 的 7 天续签

如果你使用免费 Apple 账户，自签 App 一般只有 7 天有效期。

也就是说：

- 第 1 天安装成功；
- 之后正常使用；
- 接近第 7 天时需要重新签名；
- 如果过期，App 图标可能还在，但打不开。

### 最简单的续签方法

在过期前：

1. 电脑打开 Sideloadly；
2. iPhone 通过 USB 或已经配置好的 Wi-Fi 连接；
3. 仍然使用**同一个 Apple 账户**；
4. 仍然安装同一个 App；
5. 保持相同 Bundle ID；
6. 再次 Start。

正常情况下会覆盖刷新，而不是让你重新从零开始。

### 自动刷新

Sideloadly 提供自动刷新功能。

开启后，其后台组件会在电脑能发现你的 iPhone 时尝试自动重新签名。

如果你依赖自动刷新：

- 电脑不能长期关机；
- 手机和电脑需要能互相发现；
- Wi-Fi 刷新通常要求两台设备在同一局域网；
- Windows 的 Bonjour / Apple 网络组件也需要正常。

**重要：自动刷新是“帮你在 7 天前重新签”，不是把免费签名变成永久签名。**

---

# 7. 方法二：AltStore Classic

如果你以后还想装别的 IPA，AltStore 是很成熟的一套方案。

官方站点：

https://altstore.io/

官方文档：

https://faq.altstore.io/

## 7.1 Windows 前置条件

AltStore 对 Windows 的 Apple 组件要求比较严格。

其官方教程目前建议：

- 安装 Apple 官方网站版本的 iTunes；
- 安装 Apple 官方网站版本的 iCloud；
- 不要优先使用 Microsoft Store 版本来做经典配置。

然后重启电脑。

---

## 7.2 安装 AltServer

1. 从 AltStore 官网下载 **AltServer for Windows**；
2. 解压；
3. 运行安装程序；
4. 安装完成后，在开始菜单里找到 AltServer；
5. 建议第一次**以管理员身份运行**。

AltServer 通常不会显示一个大窗口，而是在 Windows 右下角托盘里出现图标。

找不到托盘图标时，点任务栏右下角的 `^` 展开隐藏图标。

---

## 7.3 把 iPhone 连接到电脑

1. 插数据线；
2. 解锁 iPhone；
3. 点「信任此电脑」；
4. 打开 iTunes；
5. 进入设备页面；
6. 勾选类似：
   **通过 Wi-Fi 与此 iPhone 同步 / Sync with this iPhone over Wi-Fi**；
7. 点应用/同步。

这一步是后续无线刷新 AltStore 的关键。

---

## 7.4 用 AltServer 安装 AltStore

1. 点右下角 AltServer 图标；
2. 选择 **Install AltStore**；
3. 选择你的 iPhone；
4. 输入 Apple 账户；
5. 按提示完成验证；
6. 等待安装完成。

然后回到 iPhone。

同样需要完成：

- 设置 → 通用 → VPN 与设备管理 → 信任开发者；
- iOS 16+：设置 → 隐私与安全性 → 开发者模式。

---

## 7.5 用 AltStore 安装本项目 IPA

先把本项目 IPA 下载到 iPhone。

最简单的保存方式：

1. 用 Safari 打开 GitHub Releases；
2. 下载 `.ipa`；
3. 下载完成后，文件通常在「文件」App 的「下载项」里。

然后：

1. 打开 AltStore；
2. 进入 **My Apps**；
3. 点击左上角 **+**；
4. 文件选择器弹出；
5. 找到刚下载的 IPA；
6. 点它；
7. 等待安装。

如果 AltStore 要求重新登录 Apple 账户，按提示操作。

安装完成后，App 会出现在主屏幕或 App 资源库。

---

## 7.6 AltStore 怎么续签？

免费账户仍然是 7 天。

AltStore 会显示每个 App 还剩多少天。

你可以：

1. 让运行 AltServer 的电脑保持开机；
2. iPhone 和电脑连同一个 Wi-Fi；
3. 确保之前已经打开 Wi-Fi 同步；
4. AltStore 会尝试后台刷新。

也可以手动：

**AltStore → My Apps → Refresh All**

如果刷新失败，最稳妥的排错方法就是：

- 插上数据线；
- 打开 AltServer；
- 解锁手机；
- 再点 Refresh All。

---

# 8. 方法三：SideStore（初装后更少依赖电脑）

SideStore 可以理解成更偏“手机端自维护”的侧载方案。

官方文档：

https://docs.sidestore.io/

它的优势是：**电脑主要用于第一次安装**。配置完成后，安装 / 刷新 IPA 可以更多地在手机端完成。

代价是第一次配置比 Sideloadly 麻烦。

如果你只装一个 App，而且不想研究 pairing file、LocalDevVPN，建议直接回去用 Sideloadly。

---

## 8.1 SideStore 需要什么？

按照当前官方文档，需要：

- iOS / iPadOS 15 或更高版本设备；
- Apple 账户；
- 首次配置用电脑；
- Wi-Fi；
- SideStore 当前要求的安装器；
- LocalDevVPN。

SideStore 通过设备上的本地 VPN 与系统服务通信，因此在**安装、更新、刷新 App 时**通常需要打开 LocalDevVPN。

---

## 8.2 安装 LocalDevVPN

根据 SideStore 官方文档：

1. 在 iPhone 上安装 LocalDevVPN；
2. 第一次打开时允许添加 VPN 配置；
3. 输入锁屏密码；
4. 连接 VPN。

注意：

这个 VPN 主要用于 SideStore 的本地通信机制。

它不是让你“翻墙”的 VPN。

---

## 8.3 在电脑安装 SideStore

SideStore 的安装工具会随项目发展变化，所以这里不写死某一个旧安装器版本。

请打开：

https://docs.sidestore.io/docs/installation/prerequisites

以及：

https://docs.sidestore.io/docs/installation/install

按官方页面下载当前推荐的安装器。

按照当前官方流程，大致是：

1. iPhone 用 USB 连接电脑；
2. 解锁并信任电脑；
3. 启动官方推荐安装器；
4. 登录 Apple 账户；
5. 选择你的设备；
6. 选择安装稳定版 SideStore；
7. 等待安装完成。

---

## 8.4 手机端完成信任

安装 SideStore 后：

1. 设置；
2. 通用；
3. VPN 与设备管理；
4. 找到你的 Apple 账户；
5. 选择信任 / 允许并重新启动。

然后：

**设置 → 隐私与安全性 → 开发者模式**

打开并重启。

---

## 8.5 打开 SideStore 并完成第一次刷新

1. 打开 LocalDevVPN；
2. 确认 VPN 已连接；
3. 打开 SideStore；
4. 登录刚才用于安装 SideStore 的 Apple 账户；
5. 进入 **My Apps**；
6. 找到 SideStore 自己；
7. 点击右侧显示的 `7 DAYS` / 剩余天数；
8. 手动刷新一次。

如果它询问是否创建/撤销并重建签名证书，按照 SideStore 官方提示继续。

---

## 8.6 用 SideStore 安装本项目 IPA

1. Safari 打开本项目 Releases；
2. 下载 IPA；
3. 保存到「文件」App；
4. 打开 SideStore；
5. 确保 LocalDevVPN 已连接；
6. 选择安装 IPA / 从文件导入；
7. 找到下载的 `.ipa`；
8. 等待签名和安装完成。

之后定期打开 SideStore 检查剩余天数并刷新即可。

### SideStore pairing file 失效怎么办？

SideStore 官方明确提醒：系统升级、重置设备，甚至某些随机情况都可能导致 pairing file 失效。

症状通常包括：

- 刷新失败；
- 无法安装；
- 本地设备服务连接异常；
- SideStore 突然不能正常工作。

这时不要反复删 App。

优先回到 SideStore 官方安装文档，重新生成/替换 pairing file。

---

# 9. 我到底应该用哪一种？

### 你第一次自签

用 **Sideloadly**。

### 你有 Windows，想偶尔装一个 IPA

还是 **Sideloadly**。

### 你经常装 IPA，而且电脑经常开机

可以用 **AltStore**。

### 你不想每周都依赖电脑

可以研究 **SideStore**。

### 你有付费 Apple Developer Program

三种都可以，签名有效期和 App 数量限制会宽松很多。

---

# 10. 常见问题：照着症状找答案

## Q1：装好了，点开提示「未受信任的开发者」

去：

**设置 → 通用 → VPN 与设备管理**

找到对应 Apple 账户，点信任。

较新的系统可能显示「允许并重新启动」。

---

## Q2：提示 Developer Mode Required

去：

**设置 → 隐私与安全性 → 开发者模式**

打开，重启，再确认一次。

---

## Q3：设置里根本没有「开发者模式」

先确认你已经：

- 真正通过 Sideloadly / AltStore / SideStore 安装过一次开发签名 App；
- 重启过手机。

如果仍没有：

- 再连接电脑；
- 重新安装一次 IPA；
- 然后重新查看「隐私与安全性」页面底部。

---

## Q4：为什么用了 7 天突然打不开？

免费 Apple 开发签名过期了。

重新用原来的工具签一次即可。

**不是应用自己设置了 7 天试用。**

---

## Q5：重签会不会丢数据？

正确“覆盖安装”时通常可以保留原 App 容器数据，但这不是绝对保证。

为了降低风险：

- 尽量一直使用同一种签名工具；
- 使用同一个 Apple 账户；
- 不要随便改 Bundle ID；
- 不要先删除旧 App；
- 重要数据先导出/备份。

如果你主动删除 App，iOS 通常也会一起删除该 App 的本地数据。

---

## Q6：安装新版 IPA，能直接覆盖旧版吗？

通常可以，但需要签名身份和 Bundle ID 等保持兼容。

最稳妥做法：

1. 不删除旧版；
2. 使用之前同一个工具；
3. 使用之前同一个 Apple 账户；
4. 直接对新版 IPA 重新签名安装。

如果提示 Bundle ID 冲突、profile 不匹配，再根据工具错误信息处理。

---

## Q7：Sideloadly 显示 No devices detected

按顺序排查：

1. 手机解锁；
2. 重新插线；
3. 点「信任此电脑」；
4. Windows 打开 iTunes，看 iTunes 能否看到手机；
5. 换 USB 口；
6. 换数据线；
7. 重启 Apple Mobile Device 相关服务或直接重启电脑；
8. 重新安装官方推荐的 iTunes/iCloud 组件。

---

## Q8：输入 Apple 账户以后登录失败

常见原因：

- 密码输错；
- Apple 账户触发安全验证；
- 双重认证没有完成；
- Windows 的 Apple 认证组件异常；
- 网络无法访问 Apple 服务；
- 工具版本过旧。

先登录 Apple 官方网页确认账户本身正常，再更新签名工具。

---

## Q9：我不想把主 Apple 账户填进去

可以新注册一个专门用于侧载的 Apple 账户。

但请注意：

- 仍然需要你自己能接收验证；
- 不要使用来历不明的共享账户；
- 不要购买所谓“永久企业证书共享号”。

---

## Q10：为什么不推荐网上的“共享证书 / 企业签 / 永久签”？

因为它们和“自己用自己的 Apple 账户签名”完全不是一回事。

共享企业证书常见风险：

- 证书被 Apple 撤销；
- App 突然全部打不开；
- 来源不透明；
- 安装包可能被二次修改；
- 可能要求安装额外描述文件；
- 可能收集设备 UDID；
- 所谓“永久”并不等于真的永久。

本教程优先介绍**你自己控制签名账户**的方法。

---

## Q11：需要越狱吗？

不需要。

Sideloadly、AltStore Classic、SideStore 都可以用于未越狱设备。

---

## Q12：为什么教程不把 TrollStore 当普通方案？

TrollStore 属于依赖特定系统条件/漏洞链的持久签名方案，不是所有 iOS 版本和设备都能使用。

本教程面向普通用户，所以只把“正常系统 + 自己 Apple 账户就能操作”的方法作为主方案。

如果你的设备恰好满足 TrollStore 的兼容条件，请以 TrollStore 项目当前官方兼容表为准，不要照着几年前的视频盲装。

---

## Q13：免费账号到底能装几个 App？

常规免费开发签名通常受 Apple 的免费 provisioning 限制，常见限制是同时 3 个侧载 App。

而且 **AltStore / SideStore 自己也会占用侧载名额**。

所以如果你只是想装本项目一个 IPA，Sideloadly 的名额利用通常更直接。

---

## Q14：安装后需要一直联网吗？

App 本身是否需要联网取决于 App 功能。

但签名相关操作可能需要联网，例如：

- 第一次验证开发者；
- 获取/刷新 provisioning profile；
- 重新签名；
- SideStore 刷新。

本项目的核心占卜体验设计为本地可用；公告、更新检查等联网功能另说。

---

## Q15：换手机后还能直接用吗？

不能假设原来的签名会自动迁移。

换新 iPhone 后，通常需要：

1. 在新设备上重新连接电脑；
2. 重新建立信任；
3. 用签名工具重新安装；
4. 重新开启开发者模式。

本地应用数据能否迁移，取决于系统迁移和应用容器是否被完整转移，重要内容请提前导出。

---

# 11. 安全提醒

请尽量做到：

1. 只从本项目 GitHub Releases 下载本项目 IPA；
2. 自签工具只从各自官方网站下载；
3. 不安装陌生人发来的“魔改 IPA”；
4. 不购买来路不明的共享企业证书；
5. 不把 Apple 账户验证码发给别人；
6. 不向陌生网站上传 Apple 证书、p12、mobileprovision；
7. 遇到要求安装陌生根证书/MDM 描述文件的教程，先停下来确认用途。

---

# 12. 官方参考

为了避免第三方教程过时，遇到界面和本文不一致时，优先看这些页面：

- Apple Developer：Developer Mode  
  https://developer.apple.com/support/install-beta/
- Apple 支持：手动安装 App 后的开发者信任说明  
  https://support.apple.com/zh-cn/118254
- Sideloadly  
  https://sideloadly.io/
- Sideloadly FAQ  
  https://sideloadly.io/faq
- AltStore  
  https://altstore.io/
- AltStore Classic 文档  
  https://faq.altstore.io/
- SideStore 文档  
  https://docs.sidestore.io/
- SideStore 安装要求  
  https://docs.sidestore.io/docs/installation/prerequisites
- SideStore 安装步骤  
  https://docs.sidestore.io/docs/installation/install

---

# 13. 一分钟版：真的不想看全文

如果你是 Windows 用户：

1. 下载本项目 IPA；
2. 下载并安装 Sideloadly；
3. 安装/确认 Apple iTunes 驱动正常；
4. 数据线连接 iPhone；
5. 手机点「信任此电脑」；
6. Sideloadly 里拖入 IPA；
7. 输入自己的 Apple 账户；
8. 点 Start；
9. 手机：设置 → 通用 → VPN 与设备管理 → 信任开发者；
10. 手机：设置 → 隐私与安全性 → 开发者模式 → 开启并重启；
11. 打开 App；
12. 免费账户记得 **7 天内刷新一次**。

如果卡住，别从头乱试，直接回到上面的「常见问题」，按你屏幕上的报错找对应条目。

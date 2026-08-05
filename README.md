[简体中文](./README.md) | [English](./README.en.md)

# Quareia 占卜站点

一个非官方、非商业的纯前端占卜网站：支持**塔罗牌**、**Mystagogus（M 牌）** 与 **LXXXI 魔法牌（奎瑞亚）** 三套牌组，并提供**简体中文 / English** 一键切换。左右滑动牌堆、轻点任意一张牌抽出，翻牌解读；塔罗支持正位/逆位模式、大小阿卡那筛选与第六章牌阵，M 牌与 LXXXI 魔法牌固定全正位（说明书未提供逆位含义）。为手机端优化，单手轻点即可完成占卜。

本项目与 Quareia、Josephine McCarthy、相关艺术家和出版方不存在隶属、赞助或背书关系。

## 为什么会有这个项目

昨天想用占星猫占卜，发现全正位模式要付费，大阿卡那和小阿卡那分开抽牌的功能也没找到。考虑到我不想付钱,所以就做了一个

## 在线使用

访问地址：

https://hedanbaomi.github.io/tarot-divination-site/

无需后端服务，任何现代浏览器都可以直接打开。

## Android 应用

本项目提供免费的 Android 离线版（`android-demo/`），将网站封装为适合手机使用的离线体验：

- 三套牌组（塔罗 / Mystagogus / LXXXI 魔法牌）、中英文切换、本地占卜历史与网站版一致
- 主要功能完全离线，不需要登录；仅匿名使用统计（可在「关于 / 版权」页随时关闭）与外部链接需要网络
- 系统要求：Android 7.0（API 24）及以上，正式签名 APK 从 GitHub Releases 下载：

**[下载 Android 正式版 APK](https://github.com/hedanbaomi/tarot-divination-site/releases)**

构建与发布说明见 [`android-demo/README.md`](android-demo/README.md)。开源仓库包含应用完整源代码（不含 LXXXI 牌面加密实现与密钥材料，详见 `.gitignore` 与 android-demo 的「开源边界」一节）；完整牌面功能仅随正式 APK 提供。

## 功能

- **三牌组**：塔罗 78 张 / Mystagogus（M 牌）78 张 / LXXXI 魔法牌 81 张，可在设置中切换
- **双语界面**：主界面一键切换 `zh-CN` / `en`；选择会保存在当前浏览器，界面、牌名、关键词、牌义、牌阵说明、历史记录与无障碍文案同步切换
- 三套牌组可互相使用兼容牌阵；四季牌阵因牌位限定花色与大阿卡那，仅在塔罗牌组中提供
- 塔罗：大阿卡那、小阿卡那、混合、先大后小 / 先小后大筛选
- 塔罗支持全正位或正逆位混合模式；M 牌与 LXXXI 魔法牌固定全正位（「正逆位混合」选项在非塔罗牌组下自动禁用）
- 牌堆铺开成一排，左右滑动浏览，轻点任意一张牌抽出（可自由挑选，不只是最上面一张）
- 抽到的牌自动排列成牌阵，无需拖拽
- 塔罗可预先选择 16 种牌阵：第六章收录的 14 种布局，以及额外的横向三张牌阵和四季牌阵
- 四季牌阵按权杖、圣杯、宝剑、星币、大阿卡那依次提供五个独立牌池，确保每个牌位只能抽到符合限制的牌
- 概览布局支持教材中的分牌叠放／叠牌法：先铺 13 张大阿卡那作为原因与力量，再叠放 13 张小阿卡那作为具体表现
- M 牌自带 Mystagogus 布局（18 张）
- LXXXI 魔法牌自带说明书第十章 4 种牌阵：基础／神秘学地图（16 张）、生命之树（神秘学方法 / 简易方法）、四方位
- 每张牌自动进入对应牌位，牌位编号、名称与含义会同步显示
- 固定牌位不会因移除其他牌而错位；重新抽牌会补回空缺位置
- 轻点任意一张牌单独翻开，或一键「开牌解读」全部翻开
- 逆位牌面自动旋转，翻牌带 3D 动画
- 每张牌可随手移除并放回牌堆
- 移动端优先：大号点击区域、单手可用、适配刘海屏安全区
- 开牌后展示关键词与解读（M 牌关键词译自英文索引；LXXXI 牌意译自繁体中文版说明书）
- 点击「开牌解读」后，可直接轻点牌阵中的任意牌，在牌面与牌意之间翻转，无需滚动到下方结果区

## 本地打开

直接用浏览器打开 `index.html` 即可运行。

## 使用牌阵

1. 在「抽牌设置」中选择预设牌阵、牌位模式与牌组筛选。
2. 按页面提示依次抽牌；每张牌会自动进入图示对应的固定牌位。
3. 抽满后按「开牌解读」，翻开全部牌；轻点牌阵中的牌可直接查看牌意，再次轻点返回牌面，也可以展开「查看牌位说明」对照每个位置的含义。

教材第六章牌阵包括：简单的是/否、生命之树、概览、事件、方向/位置、资源、时机、表现/因果、解决方案、健康、命运模式、天使、景观与自我地图布局。网站另提供横向三张牌阵。

M 牌提供 Mystagogus 布局（18 张）。LXXXI 魔法牌提供说明书第十章收录的 4 种牌阵：基础／神秘学地图（16 张）、生命之树（神秘学方法与简易方法各一）、四方位。

## 文件结构

```text
.
├── README.md
├── README.en.md
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   ├── i18n.js
│   ├── i18n-data-en.js
│   ├── spreads.js
│   ├── history-records.js
│   ├── history-store.js
│   ├── history-ui.js
│   ├── celestial-sky.js
│   ├── tarot-data.js
│   ├── mystagogus-data.js
│   └── lxxxi-data.js
├── assets/
│   ├── cards/          # 塔罗牌面与第三方素材来源说明
│   │   ├── m/          # Mystagogus 牌面 m-01…m-78 与 m-back
│   │   └── LXXXI_SOURCE.md
│   └── icons/
├── android-demo/       # Android 离线版（源码与构建说明）
├── backend/            # Android 应用的可选配套 API 服务（本地开发用）
└── telemetry-worker/   # 匿名使用统计的 Cloudflare Worker
```

## 说明

- **塔罗**牌意文本为面向本网站的整理与改写，参考《21世纪的塔罗技能》和 Quareia 训练语境。
- **M 牌**关键词与牌阵译自 Josephine McCarthy《Mystagogus》关键词索引与 Layout PDF；牌面图像和由第三方出版物整理或翻译的内容不在 MIT 许可范围内。
- **LXXXI 魔法牌**牌意译自《LXXXI 奎瑞亚魔法牌·牌意说明书》（繁体中文版）并转写为简体中文；牌阵译自说明书第十章。LXXXI 牌面与相关文本为 Josephine McCarthy、Stuart Littlejohn、Cassandra Beanland 的作品，经作者书面许可在本项目严格非商业使用，不在 MIT 许可范围内；相关视觉素材仅用于站点运行展示，不随公开源码仓库分发，也不向访问者授予复制、再分发或其他开源权利。
- **英文支持**以本地 `en/` 中的英文资料为依据，对用于网页展示的牌名、关键词、牌义与牌阵说明进行简明整理和改写；不会在网页中逐页转载整本资料，原始 PDF 也不作为网站运行资源发布。据其整理的文本不属于 MIT 许可。
- 健康布局仅用于记录牌阵结构与个人反思，不能替代医生诊断、治疗或其他专业医疗建议。

## Card Image Source

- Tarot: 78 Rider–Waite–Smith faces are local 420px derivatives from Wikimedia Commons' public-domain "Roses & Lilies" set. See `assets/cards/SOURCE.md`.
- Mystagogus: local JPEG display derivatives (`assets/cards/m/`) and shared card back `m-back.jpeg`. Source materials © Josephine McCarthy. See `assets/cards/m/SOURCE.md`.
- LXXXI Magician's Deck: visual assets are available only for the site's runtime presentation and are not distributed in this public source repository. Source art is attributed to Josephine McCarthy, Stuart Littlejohn, and Cassandra Beanland. See `assets/cards/LXXXI_SOURCE.md`.

完整的权利边界与来源说明见 [`ATTRIBUTIONS.md`](ATTRIBUTIONS.md) 与 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 贡献者 ✨

感谢以下伙伴对项目做出的贡献

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<table>
  <tr>
    <td align="center" valign="top" width="14.28%">
      <a href="https://github.com/WeirdCorn">
        <img src="https://github.com/WeirdCorn.png" width="100px;" alt="WeirdCorn"/><br />
        <sub><b>WeirdCorn</b></sub>
      </a><br />
      <span title="LXXXI 魔法牌实体卡扫描">📷</span>
    </td>
  </tr>
</table>
<!-- ALL-CONTRIBUTORS-LIST:END -->

<sub>📷 LXXXI 魔法牌实体卡扫描</sub>

## 授权与署名

本项目为非官方、免费、严格非商业工具，不暗示 Quareia 或相关作者为项目背书。Josephine McCarthy 的书面许可已明确覆盖本免费的 GitHub Pages 网站，以及免费的 Android 应用，前提是第三方版权素材始终严格非商业、防止滥用，并排除在一切开源许可之外。第三方牌面与文本不适用 MIT License：

- **Mystagogus**：© Josephine McCarthy。
- **LXXXI 魔法牌**：© Josephine McCarthy、Stuart Littlejohn、Cassandra Beanland。

Quareia 官网：<https://www.quareia.com>。完整权利边界见 [`ATTRIBUTIONS.md`](ATTRIBUTIONS.md) 与 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

> “while digital tools for readings can be useful in an emergency, the interaction between the physical hands of the reader touching and shuffling the deck is safer, a lot more accurate and far more powerful” — Josephine McCarthy
>
> （中文参考译文：「虽然数字占卜工具在紧急情况下可能会有用，但占卜师用双手亲自接触和洗牌的互动更安全，准确度也更高，且力量强大得多。」原文以英文为准。）

## Android 边界（仅文档说明）

Josephine McCarthy 的书面许可已明确覆盖本免费的 GitHub Pages 网站，以及免费的 Android 应用（`android-demo/`），前提是第三方版权素材始终严格非商业、采取合理措施防止滥用，并排除在一切开源许可之外。Android 版本同样不得包含广告、打赏、订阅、付费云服务、付费解锁或其他盈利功能；第三方牌面与文本（Mystagogus、LXXXI 等）不得纳入 MIT 或其他开源许可。LXXXI 牌面加密实现与密钥材料不随开源仓库发布，完整牌面仅通过正式 APK 提供。未来若要商业化，必须另行取得正式的商业电子版权许可。

## License

MIT 仅适用于本项目作者原创的程序代码，以及明确标注为项目原创的内容。第三方牌面图像、Mystagogus 与 LXXXI 材料，以及基于第三方出版物整理、改写或翻译的文本与数据均不在 MIT 许可范围内（Mystagogus 与 LXXXI 经作者书面许可仅限本项目严格非商业使用）。详见 [`LICENSE`](LICENSE)、[`ATTRIBUTIONS.md`](ATTRIBUTIONS.md) 与 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

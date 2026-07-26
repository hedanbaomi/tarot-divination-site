# Quareia 占卜站点

一个纯前端 Quareia 占卜网站：支持**塔罗牌**、**Mystagogus（M 牌）** 与 **LXXXI 魔法牌（奎瑞亚）** 三套牌组。左右滑动牌堆、轻点任意一张牌抽出，翻牌解读；塔罗支持正位/逆位模式、大小阿卡那筛选与第六章牌阵，M 牌与 LXXXI 魔法牌固定全正位（说明书未提供逆位含义）。为手机端优化，单手轻点即可完成占卜。

## 为什么会有这个项目

昨天想用占星猫占卜，发现全正位模式要付费，大阿卡那和小阿卡那分开抽牌的功能也没找到。考虑到我不想付钱,所以就做了一个

## 在线使用

访问地址：

https://hedanbaomi.github.io/tarot-divination-site/

无需后端服务，任何现代浏览器都可以直接打开。

## 功能

- **三牌组**：塔罗 78 张 / Mystagogus（M 牌）78 张 / LXXXI 魔法牌 81 张，可在设置中切换
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

## 本地打开

直接用浏览器打开 `index.html` 即可运行。

## 使用牌阵

1. 在「抽牌设置」中选择预设牌阵、牌位模式与牌组筛选。
2. 按页面提示依次抽牌；每张牌会自动进入图示对应的固定牌位。
3. 抽满后开牌解读，并可展开「查看牌位说明」对照每个位置的含义。

教材第六章牌阵包括：简单的是/否、生命之树、概览、事件、方向/位置、资源、时机、表现/因果、解决方案、健康、命运模式、天使、景观与自我地图布局。网站另提供横向三张牌阵。

M 牌提供 Mystagogus 布局（18 张）。LXXXI 魔法牌提供说明书第十章收录的 4 种牌阵：基础／神秘学地图（16 张）、生命之树（神秘学方法与简易方法各一）、四方位。

## 文件结构

```text
.
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   ├── spreads.js
│   ├── tarot-data.js
│   ├── mystagogus-data.js
│   └── lxxxi-data.js
└── assets/
    ├── cards/          # 塔罗牌面
    │   ├── m/          # Mystagogus 牌面 m-01…m-78 与 m-back
    │   └── lxxxi/      # LXXXI 魔法牌牌面 lxxxi-01…lxxxi-81 与 lxxxi-back
    ├── support/        # 支持作者收款码
    └── icons/
```

## 说明

- **塔罗**牌意文本为面向本网站的整理与改写，参考《21世纪的塔罗技能》和 Quareia 训练语境。
- **M 牌**关键词与牌阵译自 Josephine McCarthy《Mystagogus》关键词索引与 Layout PDF；牌面图像版权归原作者所有，仅供本站本地使用。
- **LXXXI 魔法牌**牌意译自《LXXXI 奎瑞亚魔法牌·牌意说明书》（繁体中文版）并转写为简体中文；牌阵译自说明书第十章；牌面图像版权归原作者所有，仅供本站本地使用。
- 健康布局仅用于记录牌阵结构与个人反思，不能替代医生诊断、治疗或其他专业医疗建议。

## Card Image Source

- Tarot: 78 Rider–Waite–Smith faces are local 420px derivatives from Wikimedia Commons' public-domain "Roses & Lilies" set. See `assets/cards/SOURCE.md`.
- Mystagogus: high-res local JPEGs for offline UI (`assets/cards/m/`), plus shared card back `m-back.jpeg`. © Josephine McCarthy. See `assets/cards/m/SOURCE.md`.
- LXXXI Magician's Deck: 81 local JPEGs for offline UI (`assets/cards/lxxxi/`), plus shared card back `lxxxi-back.jpeg`. © Josephine McCarthy, Stuart Littlejohn, Cassandra Beanland. See `assets/cards/lxxxi/SOURCE.md`.

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

## License

MIT

## 支持作者

如果这个小站对你有用，欢迎随意打赏，感谢支持。

### 微信支付

![微信支付收款码](assets/support/pay-wechat.jpg)

### 支付宝

![支付宝收款码](assets/support/pay-alipay.jpg)

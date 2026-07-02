# Tarot Divination Site

一个纯前端塔罗占卜网站：左右滑动牌堆、轻点任意一张牌抽出，翻牌解读，支持正位/逆位模式、大小阿卡那筛选和基于 Quareia 语境整理的牌意解读。为手机端优化，单手轻点即可完成占卜。

## 为什么会有这个项目

昨天想用占星猫占卜，发现全正位模式要付费，大阿卡那和小阿卡那分开抽牌的功能也没找到。该交的钱我不是没交过，但这辈子最烦的就是基础功能被锁在付费墙后面。

实在受不了了，自己搓了一个。虽然用着不算多舒服，但起码能用，而且想怎么改就怎么改。

## 在线使用

访问地址：

https://hedanbaomi.github.io/tarot-divination-site/

无需后端服务，任何现代浏览器都可以直接打开。

## 功能

- 78 张塔罗牌完整牌组
- 大阿卡那、小阿卡那、混合、先大后小 / 先小后大筛选
- 全正位或正逆位混合模式
- 牌堆铺开成一排，左右滑动浏览，轻点任意一张牌抽出（可自由挑选，不只是最上面一张）
- 抽到的牌自动排列成牌阵，无需拖拽
- 轻点任意一张牌单独翻开，或一键「开牌解读」全部翻开
- 逆位牌面自动旋转，翻牌带 3D 动画
- 每张牌可随手移除并放回牌堆
- 移动端优先：大号点击区域、单手可用、适配刘海屏安全区
- 开牌后展示关键词、元素方向和解读

## 本地打开

直接用浏览器打开 `index.html` 即可运行。

## 文件结构

```text
.
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   ├── spreads.js
│   └── tarot-data.js
└── assets/
    ├── cards/
    └── icons/
```

## 说明

牌意文本为面向本网站的整理与改写，参考《21世纪的塔罗技能》和 Quareia 训练语境。原始 PDF 资料不包含在开源仓库中。

## Card Image Source

The 78 Rider-Waite-Smith card face images are local 420px derivatives from Wikimedia Commons' public-domain "Roses & Lilies" set. See `assets/cards/SOURCE.md`.

## License

MIT

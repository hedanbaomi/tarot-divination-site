(function (global) {
  "use strict";

  var STORAGE_KEY = "quareia-divination-locale";
  var DEFAULT_LOCALE = "zh-CN";
  var supported = ["zh-CN", "en"];
  var initialized = false;
  var locale = readStoredLocale();

  var messages = {
    "zh-CN": {
      "page.title": "Quareia 占卜 · Quareia Divination",
      "page.description": "Quareia 占卜：支持塔罗、Mystagogus（M 牌）与 LXXXI 魔法牌，轻点牌堆抽牌，翻牌解读，预设牌阵与正逆位模式。",
      "site.title": "Quareia 占卜",
      "site.subtitle": "QUAREIA DIVINATION · 塔罗 / Mystagogus / LXXXI",
      "language.switch": "EN",
      "language.switchLabel": "Switch to English",
      "menu.openLabel": "打开菜单",
      "menu.closeLabel": "关闭菜单",
      "menu.kicker": "应用菜单",
      "menu.title": "菜单",
      "menu.actionsLabel": "应用菜单",
      "menu.language": "语言",
      "menu.about": "关于 / 版权",
      "history.open": "占卜历史",
      "home.quoteKicker": "作者附言",
      "home.quote": "while digital tools for readings can be useful in an emergency, the interaction between the physical hands of the reader touching and shuffling the deck is safer, a lot more accurate and far more powerful",
      "home.quoteCite": "— Josephine McCarthy",
      "home.quoteTranslation": "中文参考译文：「虽然数字占卜工具在紧急情况下可能会有用，但占卜师用双手亲自接触和洗牌的互动更安全，准确度也更高，且力量强大得多。」原文以英文为准。",
      "telemetry.kicker": "隐私说明",
      "telemetry.title": "匿名使用统计",
      "telemetry.firstLaunchNotice": "本应用默认启用匿名使用统计，用于了解活跃设备数量和功能使用情况。统计内容包括应用版本、语言、牌组和抽牌数量；不收集问题、具体抽牌结果或本地历史。服务端会临时读取连接IP，用于限流和防止滥用。对于网络地址和地理位置数据，统计数据库仅保存由 Cloudflare 根据连接IP推断的国家代码、一级行政区代码和名称，不保存原始IP、IP摘要、城市或更精确的位置。这些位置字段可能缺失或存在偏差，不代表用户的真实居住地。可在“关于 / 版权”页面随时关闭。",
      "telemetry.manage": "打开隐私设置",
      "telemetry.acknowledge": "知道了",
      "settings.title": "抽牌设置",
      "settings.deck": "牌组",
      "deck.tarotOption": "塔罗牌（Rider–Waite 体系）",
      "deck.mystagogusOption": "M 牌（Mystagogus）",
      "deck.lxxxiOption": "LXXXI 魔法牌（奎瑞亚）",
      "settings.mode": "牌位模式",
      "mode.upright": "全正位（推荐）",
      "mode.mixed": "正逆位混合",
      "settings.arcana": "牌组筛选",
      "arcana.mixed": "混合抽取",
      "arcana.majorOnly": "仅大阿卡那",
      "arcana.minorOnly": "仅小阿卡那",
      "arcana.majorThenMinor": "先大后小",
      "arcana.minorThenMajor": "先小后大",
      "settings.overviewMethod": "概览抽法",
      "overview.single": "单牌法（13 张）",
      "overview.stacked": "分牌叠放／叠牌法（26 张）",
      "overview.summary": "先铺 13 张大阿卡那，再将 13 张小阿卡那叠在对应牌位。",
      "settings.spread": "预设牌阵",
      "deck.heading": "牌堆",
      "deck.initialRemaining": "剩 78 张",
      "deck.shuffle": "🔀 洗牌",
      "deck.initialCta": "左右滑动浏览牌堆，轻点任意一张牌抽出",
      "deck.initialAria": "牌堆，左右滑动浏览，轻点抽牌",
      "deck.switch": "切换牌组",
      "spread.initialTitle": "你的牌阵",
      "spread.initialCount": "0 / 3",
      "spread.reveal": "开牌解读",
      "spread.clear": "重新洗牌",
      "spread.hint": "轻点任意一张牌可单独翻开，或按「开牌解读」全部翻开；开牌后再次轻点牌面可查看牌意。",
      "spread.guide": "查看牌位说明",
      "spread.gridAria": "抽取的牌按所选牌阵自动排列",
      "results.title": "解读结果",
      "history.kicker": "APP HISTORY",
      "history.title": "占卜历史",
      "history.closeLabel": "关闭占卜历史",
      "history.privacy": "占卜记录仅保存在本应用的本地存储中。卸载应用、清除应用数据或更换设备可能导致记录丢失；可导出 JSON 自行备份。本应用不会上传历史，也不进行遥测或追踪。",
      "history.filterLabel": "按牌组筛选",
      "history.filterAll": "全部牌组",
      "history.filterTarot": "塔罗牌",
      "history.filterMystagogus": "Mystagogus",
      "history.filterLxxxi": "LXXXI 魔法牌",
      "history.backupAria": "历史备份",
      "history.export": "导出 JSON",
      "history.import": "导入 JSON",
      "history.listAria": "占卜历史记录",
      "history.empty": "暂无保存的占卜记录。",
      "history.clear": "清空全部记录",
      "history.back": "返回历史列表",
      "history.detailTitle": "占卜记录详情",
      "history.delete": "删除这条记录",
      "footer.note": "塔罗牌意参考《21世纪的塔罗技能》与 Quareia 语境；M 牌关键词译自 Josephine McCarthy《Mystagogus》；LXXXI 牌意参考其英文说明书 · 仅供娱乐，请理性看待占卜结果",
      "source.tarot": "参考《21世纪的塔罗技能》与 Quareia 训练语境整理",
      "source.mystagogus": "参考 Josephine McCarthy《Mystagogus》关键词索引与 Quareia 体系整理",
      "source.lxxxi": "参考《LXXXI 奎瑞亚魔法牌·牌意说明书》整理翻译",
      "deck.name.tarot": "RWS 塔罗",
      "deck.name.mystagogus": "Mystagogus",
      "deck.name.lxxxi": "LXXXI",
      "deck.group.tarot": "塔罗牌阵",
      "deck.group.mystagogus": "M 牌牌阵",
      "deck.group.lxxxi": "LXXXI 牌阵",
      "orientation.upright": "正位",
      "orientation.reversed": "逆位",
      "arcana.major": "大阿卡那",
      "arcana.minor": "小阿卡那",
      "arcana.switchToMinor": "切换到小阿卡那",
      "arcana.switchBackMajor": "切回大阿卡那",
      "arcana.switchToMajor": "切换到大阿卡那",
      "arcana.switchBackMinor": "切回小阿卡那",
      "app.current": "当前：{value}",
      "app.cards": "{count} 张",
      "app.cardsStackable": "{count} 张（可叠放 26 张）",
      "app.cardsStacked": "26 张（13 组） · 分牌叠放",
      "app.remaining": "剩 {count} 张",
      "app.remainingWithPrefix": "{prefix} · 剩 {count} 张",
      "app.deckAria.tarot": "塔罗牌堆，左右滑动浏览，轻点抽牌",
      "app.deckAria.mystagogus": "Mystagogus 牌堆，左右滑动浏览，轻点抽牌",
      "app.deckAria.lxxxi": "LXXXI 魔法牌堆，左右滑动浏览，轻点抽牌",
      "app.deckAriaRule": "{label}；当前{rule}",
      "app.deckEmptyPhase": "这组牌已抽完，可切换牌组或重新洗牌",
      "app.deckEmpty": "牌已抽完，按「洗牌」重新开始",
      "app.deckComplete": "牌阵已完成",
      "app.drawAria": "第 {index} 张，轻点抽到{position}{selection}",
      "app.layerMajorBase": "大阿卡那底牌",
      "app.layerMinorTop": "小阿卡那叠牌",
      "app.layerMajorCause": "大牌 · 因",
      "app.layerMinorEffect": "小牌 · 果",
      "app.layerMajorCaption": "大牌底牌 · 因",
      "app.layerMinorCaption": "小牌叠牌 · 果",
      "app.overviewComplete": "概览布局 · 分牌叠放已完成（13 组 / 26 张），可以逐组开牌解读",
      "app.spreadComplete": "{spread}已完成，可以开牌解读",
      "app.pileEmptyCta": "牌堆已空，翻开你的牌，或重新洗牌再来一次",
      "app.nextStacking": "下一张：位置 {number} · {position} · {instruction}（轻点任意一张牌抽出）",
      "app.nextRule": "下一张：位置 {number} · {position} · {rule}（从当前合法牌池中任选一张）",
      "app.nextCard": "下一张：位置 {number} · {position}（轻点任意一张牌抽出）",
      "app.majorInstruction": "大阿卡那底牌 · 原因与力量",
      "app.minorInstruction": "小阿卡那叠牌 · 具体表现",
      "app.flipAria": "位置 {number}，{position}{layer}，轻点翻开这张牌",
      "app.revealedAria": "位置 {number} · {position}{layer} · {card} · {orientation}。轻点查看牌意",
      "app.meaningAria": "位置 {number} · {position}{layer} · {card}的牌意。轻点返回牌面",
      "app.meaningTitle": "牌意",
      "app.meaningHint": "轻点任意已开牌可翻到牌意面，再次轻点返回牌面。",
      "app.removeCardAria": "移除位置 {number}的这张牌",
      "app.removeLayerAria": "移除位置 {number}的{layer}",
      "app.stackSlotMajor": "大牌底牌",
      "app.stackSlotMinor": "小牌叠牌",
      "app.stackPhaseComplete": "分牌叠放 · 13 组已完成",
      "app.stackPhaseMajor": "分牌叠放 · 第 1 层：大牌（因）",
      "app.stackPhaseMinor": "分牌叠放 · 第 2 层：小牌（果）",
      "app.currentRule": "当前牌位：{rule}",
      "app.fourSeasonsComplete": "四季牌阵 · 五个限定牌位已完成",
      "app.revealedAll": "已全部翻开",
      "app.stackHint": "同一牌位的大牌与小牌需一起解读：大牌是背后的原因与力量，小牌是这种力量的具体表现。",
      "app.ruleHint": "每个牌位只会展示符合限制的牌背供你选择；轻点牌可单独翻开，或按「开牌解读」全部翻开。",
      "app.defaultHint": "轻点任意一张牌可单独翻开，或按「开牌解读」全部翻开。",
      "app.resultMajor": "大牌底牌（因）",
      "app.resultMinor": "小牌叠牌（果）",
      "app.position": "位置 {number} · {position}",
      "app.positionMeaning": "牌位：{meaning}",
      "app.pairHint": "大牌揭示背后的原因与力量，小牌说明这种力量将如何具体表现；请将两张牌作为一组解读。",
      "app.majorPending": "大牌底牌（因）尚未翻开",
      "app.minorPending": "小牌叠牌（果）尚未翻开",
      "app.overviewSingleSummary": "单牌法在十三个牌位各抽一张；需要更多信息时可切换为分牌叠放。",
      "app.overviewStackedSummary": "先铺 13 张大阿卡那作为原因与力量，再将 13 张小阿卡那叠在对应牌位作为具体表现。",
      "app.stackedDefinition": " 每组大牌表示原因与力量，小牌表示这种力量如何表现。",
      "confirm.mode": "切换模式会清空当前牌阵并重新洗牌，是否继续？",
      "confirm.arcana": "切换筛选会清空当前牌阵并重新洗牌，是否继续？",
      "confirm.overview": "切换概览抽法会清空当前牌阵并重新洗牌，是否继续？",
      "confirm.spread": "切换牌阵会清空当前抽牌并重新洗牌，是否继续？",
      "confirm.deck": "切换牌组会清空当前牌阵并重新洗牌，是否继续？",
      "confirm.shuffle": "确定要重新洗牌吗？这会清空当前牌阵。",
      "confirm.kicker": "牌阵变更",
      "confirm.title": "当前牌阵尚未清空",
      "confirm.cancel": "保留牌阵",
      "confirm.proceed": "继续并清空",
      "choice.kicker": "纸牌选择",
      "choice.title": "请选择",
      "choice.cancel": "取消",
      "choice.none": "暂无可选项",
      "choice.openAria": "{label}，当前为 {value}，轻点更改",
      "history.cards": "{count} 张",
      "history.viewAria": "查看 {spread}，{time}",
      "history.orientation.upright": "正位",
      "history.orientation.reversed": "逆位",
      "history.layer.major": " · 大牌层（因）",
      "history.layer.minor": " · 小牌层（果）",
      "history.field.time": "时间",
      "history.field.deck": "牌组",
      "history.field.cards": "牌数",
      "history.completePositions": "完整牌位",
      "history.unavailableSave": "本应用当前无法保存历史；占卜仍可正常使用。",
      "history.unavailable": "本应用当前无法访问本地存储，历史不可用；占卜功能不受影响。",
      "history.saveSnapshotError": "自动保存失败；当前占卜结果仍会保留。",
      "history.saving": "正在自动保存占卜历史…",
      "history.saveUnavailable": "自动保存失败；本应用的本地历史当前不可用。",
      "history.duplicate": "这次完整占卜刚刚已经自动保存，无需重复保存。",
      "history.saved": "开牌完成，已自动保存到本应用的占卜历史。",
      "history.deleted": "已删除这条历史记录。",
      "history.deleteFailed": "删除失败，请稍后再试。",
      "history.deleteConfirm": "确定删除这条占卜历史吗？此操作无法撤销。",
      "history.clearConfirm": "确定清空本应用中的全部占卜历史吗？此操作无法撤销。",
      "history.confirmKicker": "本地历史",
      "history.confirmTitle": "删除占卜记录？",
      "history.confirmCancel": "保留记录",
      "history.confirmProceed": "确认删除",
      "history.cleared": "全部历史记录已清空。",
      "history.clearFailed": "清空失败，请稍后再试。",
      "history.exported": "历史已导出为 JSON 备份。",
      "history.exportFailed": "导出失败，请稍后再试。",
      "history.imported": "已导入 {count} 条历史记录。",
      "history.remapped": " {count} 条重复 ID 已安全重编号。",
      "history.importFailed": "导入失败：文件格式不正确或内容已损坏。"
    },
    "en": {
      "page.title": "Quareia Divination",
      "page.description": "Quareia-inspired divination with Rider-Waite Tarot, Mystagogus, and LXXXI decks, hand-picked card drawing, guided spreads, and upright or reversed Tarot readings.",
      "site.title": "Quareia Divination",
      "site.subtitle": "TAROT · MYSTAGOGUS · LXXXI",
      "language.switch": "中文",
      "language.switchLabel": "切换至简体中文",
      "menu.openLabel": "Open menu",
      "menu.closeLabel": "Close menu",
      "menu.kicker": "APP MENU",
      "menu.title": "Menu",
      "menu.actionsLabel": "App menu",
      "menu.language": "Language",
      "menu.about": "About / Copyright",
      "history.open": "Reading History",
      "home.quoteKicker": "A note from the author",
      "home.quote": "while digital tools for readings can be useful in an emergency, the interaction between the physical hands of the reader touching and shuffling the deck is safer, a lot more accurate and far more powerful",
      "home.quoteCite": "— Josephine McCarthy",
      "home.quoteTranslation": "A Chinese reference translation appears below the English original; the English text is authoritative.",
      "telemetry.kicker": "PRIVACY NOTE",
      "telemetry.title": "Anonymous usage statistics",
      "telemetry.firstLaunchNotice": "This app enables anonymous usage statistics by default to understand active device counts and feature usage. We collect app version, language, deck, and the number of cards drawn; we do not collect questions, specific draw results, or local history. The server temporarily reads the connection IP for rate limiting and abuse prevention. Of network-address and location data, the statistics database stores only the country code and first-level subdivision code and name inferred by Cloudflare from the connection IP; it does not store the raw IP address, an IP digest, a city, or more precise location data. These location fields may be missing or inaccurate and do not represent the user's actual residence. You can turn it off at any time in About / Copyright.",
      "telemetry.manage": "Open privacy settings",
      "telemetry.acknowledge": "Got it",
      "settings.title": "Reading Setup",
      "settings.deck": "Deck",
      "deck.tarotOption": "Tarot (Rider-Waite system)",
      "deck.mystagogusOption": "Mystagogus",
      "deck.lxxxiOption": "LXXXI - The Magician's Deck",
      "settings.mode": "Orientation",
      "mode.upright": "Upright only (recommended)",
      "mode.mixed": "Upright and reversed",
      "settings.arcana": "Card pool",
      "arcana.mixed": "Major and Minor Arcana",
      "arcana.majorOnly": "Major Arcana only",
      "arcana.minorOnly": "Minor Arcana only",
      "arcana.majorThenMinor": "Major, then Minor",
      "arcana.minorThenMajor": "Minor, then Major",
      "settings.overviewMethod": "Overview method",
      "overview.single": "Single-card method (13 cards)",
      "overview.stacked": "Split-deck method (26 cards)",
      "overview.summary": "Lay 13 Major Arcana cards, then place 13 Minor Arcana cards over the matching positions.",
      "settings.spread": "Spread",
      "deck.heading": "Deck",
      "deck.initialRemaining": "78 remaining",
      "deck.shuffle": "🔀 Shuffle",
      "deck.initialCta": "Swipe to browse the deck, then tap any card to draw it",
      "deck.initialAria": "Card deck. Swipe to browse and tap a card to draw.",
      "deck.switch": "Switch card pool",
      "spread.initialTitle": "Your Spread",
      "spread.initialCount": "0 / 3",
      "spread.reveal": "Reveal & Interpret",
      "spread.clear": "Shuffle Again",
      "spread.hint": "Tap a card to reveal it, or choose “Reveal & Interpret” to turn over every card. After revealing, tap a card again to view its meaning.",
      "spread.guide": "View position guide",
      "spread.gridAria": "Drawn cards arranged in the selected spread",
      "results.title": "Reading",
      "history.kicker": "APP HISTORY",
      "history.title": "Reading History",
      "history.closeLabel": "Close reading history",
      "history.privacy": "Readings are stored locally by this app on this device. Uninstalling the app, clearing its data, or changing devices may remove them. Export a JSON backup if needed. This app does not upload, track, or collect your reading history.",
      "history.filterLabel": "Filter by deck",
      "history.filterAll": "All decks",
      "history.filterTarot": "Tarot",
      "history.filterMystagogus": "Mystagogus",
      "history.filterLxxxi": "LXXXI",
      "history.backupAria": "History backup",
      "history.export": "Export JSON",
      "history.import": "Import JSON",
      "history.listAria": "Saved readings",
      "history.empty": "No saved readings yet.",
      "history.clear": "Clear All History",
      "history.back": "Back to History",
      "history.detailTitle": "Reading Details",
      "history.delete": "Delete This Reading",
      "footer.note": "Tarot meanings are based on Tarot Skills for the 21st Century and the Quareia context; Mystagogus keywords and LXXXI meanings follow their English guidebooks · For entertainment only - approach divination thoughtfully",
      "source.tarot": "Based on Tarot Skills for the 21st Century and the Quareia training context",
      "source.mystagogus": "Based on Josephine McCarthy's Mystagogus keyword index and the Quareia system",
      "source.lxxxi": "Based on LXXXI - The Magician's Deck: A Guide to the Card Meanings",
      "deck.name.tarot": "RWS Tarot",
      "deck.name.mystagogus": "Mystagogus",
      "deck.name.lxxxi": "LXXXI",
      "deck.group.tarot": "Tarot spreads",
      "deck.group.mystagogus": "Mystagogus spreads",
      "deck.group.lxxxi": "LXXXI spreads",
      "orientation.upright": "Upright",
      "orientation.reversed": "Reversed",
      "arcana.major": "Major Arcana",
      "arcana.minor": "Minor Arcana",
      "arcana.switchToMinor": "Switch to Minor Arcana",
      "arcana.switchBackMajor": "Back to Major Arcana",
      "arcana.switchToMajor": "Switch to Major Arcana",
      "arcana.switchBackMinor": "Back to Minor Arcana",
      "app.current": "Current: {value}",
      "app.cards": "{count} cards",
      "app.cardsStackable": "{count} cards (26 with split-deck method)",
      "app.cardsStacked": "26 cards (13 pairs) · Split-deck method",
      "app.remaining": "{count} remaining",
      "app.remainingWithPrefix": "{prefix} · {count} remaining",
      "app.deckAria.tarot": "Tarot deck. Swipe to browse and tap a card to draw.",
      "app.deckAria.mystagogus": "Mystagogus deck. Swipe to browse and tap a card to draw.",
      "app.deckAria.lxxxi": "LXXXI deck. Swipe to browse and tap a card to draw.",
      "app.deckAriaRule": "{label}; current requirement: {rule}",
      "app.deckEmptyPhase": "This card pool is empty. Switch pools or shuffle again.",
      "app.deckEmpty": "The deck is empty. Choose “Shuffle” to begin again.",
      "app.deckComplete": "The spread is complete",
      "app.drawAria": "Card {index}. Tap to draw for {position}{selection}",
      "app.layerMajorBase": "Major Arcana base card",
      "app.layerMinorTop": "Minor Arcana overlay",
      "app.layerMajorCause": "Major · Cause",
      "app.layerMinorEffect": "Minor · Effect",
      "app.layerMajorCaption": "Major base · Cause",
      "app.layerMinorCaption": "Minor overlay · Effect",
      "app.overviewComplete": "Overview · Split-deck method complete (13 pairs / 26 cards). Reveal each pair to interpret it.",
      "app.spreadComplete": "{spread} complete. You can now reveal the reading.",
      "app.pileEmptyCta": "The deck is empty. Reveal your cards or shuffle and begin again.",
      "app.nextStacking": "Next: position {number} · {position} · {instruction} (tap any card to draw)",
      "app.nextRule": "Next: position {number} · {position} · {rule} (choose any card in the valid pool)",
      "app.nextCard": "Next: position {number} · {position} (tap any card to draw)",
      "app.majorInstruction": "Major Arcana base · Cause and power",
      "app.minorInstruction": "Minor Arcana overlay · Manifestation",
      "app.flipAria": "Position {number}, {position}{layer}. Tap to reveal this card.",
      "app.revealedAria": "Position {number} · {position}{layer} · {card} · {orientation}. Tap to view its meaning.",
      "app.meaningAria": "Meaning of {card} in position {number}, {position}{layer}. Tap to return to the card face.",
      "app.meaningTitle": "Card meaning",
      "app.meaningHint": "Tap any revealed card to flip to its meaning. Tap again to return to the card face.",
      "app.removeCardAria": "Remove the card in position {number}",
      "app.removeLayerAria": "Remove the {layer} in position {number}",
      "app.stackSlotMajor": "Major base",
      "app.stackSlotMinor": "Minor overlay",
      "app.stackPhaseComplete": "Split-deck method · 13 pairs complete",
      "app.stackPhaseMajor": "Split-deck method · Layer 1: Major Arcana (cause)",
      "app.stackPhaseMinor": "Split-deck method · Layer 2: Minor Arcana (effect)",
      "app.currentRule": "Current position: {rule}",
      "app.fourSeasonsComplete": "Four Seasons · All five constrained positions are complete",
      "app.revealedAll": "All Cards Revealed",
      "app.stackHint": "Read the Major and Minor cards in each position together: the Major shows the cause or power; the Minor shows how it manifests.",
      "app.ruleHint": "Each position shows only cards that meet its rule. Tap a card to reveal it, or choose “Reveal & Interpret” to turn over every card.",
      "app.defaultHint": "Tap a card to reveal it, or choose “Reveal & Interpret” to turn over every card.",
      "app.resultMajor": "Major base (cause)",
      "app.resultMinor": "Minor overlay (effect)",
      "app.position": "Position {number} · {position}",
      "app.positionMeaning": "Position: {meaning}",
      "app.pairHint": "The Major card shows the underlying cause or power; the Minor card shows how it will manifest. Read them as one pair.",
      "app.majorPending": "Major base (cause) not yet revealed",
      "app.minorPending": "Minor overlay (effect) not yet revealed",
      "app.overviewSingleSummary": "Draw one card for each of the thirteen positions. Switch to the split-deck method when you need more detail.",
      "app.overviewStackedSummary": "Lay 13 Major Arcana cards for causes and powers, then place 13 Minor Arcana cards over the matching positions to show manifestation.",
      "app.stackedDefinition": " Read each Major as the cause or power and each Minor as the way that power manifests.",
      "confirm.mode": "Changing the orientation mode will clear this spread and reshuffle. Continue?",
      "confirm.arcana": "Changing the card pool will clear this spread and reshuffle. Continue?",
      "confirm.overview": "Changing the Overview method will clear this spread and reshuffle. Continue?",
      "confirm.spread": "Changing the spread will clear the current cards and reshuffle. Continue?",
      "confirm.deck": "Changing decks will clear this spread and reshuffle. Continue?",
      "confirm.shuffle": "Shuffle again? This will clear the current spread.",
      "confirm.kicker": "SPREAD CHANGE",
      "confirm.title": "Your current spread is still here",
      "confirm.cancel": "Keep Spread",
      "confirm.proceed": "Continue & Clear",
      "choice.kicker": "CARD PICKER",
      "choice.title": "Choose an option",
      "choice.cancel": "Cancel",
      "choice.none": "No options available",
      "choice.openAria": "{label}, currently {value}. Tap to change.",
      "history.cards": "{count} cards",
      "history.viewAria": "View {spread}, {time}",
      "history.orientation.upright": "Upright",
      "history.orientation.reversed": "Reversed",
      "history.layer.major": " · Major layer (cause)",
      "history.layer.minor": " · Minor layer (effect)",
      "history.field.time": "Time",
      "history.field.deck": "Deck",
      "history.field.cards": "Cards",
      "history.completePositions": "Complete Spread",
      "history.unavailableSave": "This app cannot save history right now. Divination remains available.",
      "history.unavailable": "This app cannot access local storage, so history is unavailable. Divination is unaffected.",
      "history.saveSnapshotError": "Automatic save failed. Your current reading remains available.",
      "history.saving": "Saving this reading automatically…",
      "history.saveUnavailable": "Automatic save failed because this app's local history is unavailable.",
      "history.duplicate": "This complete reading was just saved, so no duplicate was created.",
      "history.saved": "Reading revealed and saved automatically in this app.",
      "history.deleted": "Reading deleted.",
      "history.deleteFailed": "Could not delete the reading. Please try again.",
      "history.deleteConfirm": "Delete this saved reading? This cannot be undone.",
      "history.clearConfirm": "Clear all reading history saved by this app? This cannot be undone.",
      "history.confirmKicker": "LOCAL HISTORY",
      "history.confirmTitle": "Delete reading history?",
      "history.confirmCancel": "Keep Records",
      "history.confirmProceed": "Delete",
      "history.cleared": "All reading history has been cleared.",
      "history.clearFailed": "Could not clear history. Please try again.",
      "history.exported": "History exported as a JSON backup.",
      "history.exportFailed": "Could not export history. Please try again.",
      "history.imported": "Imported {count} reading(s).",
      "history.remapped": " Safely reassigned {count} duplicate ID(s).",
      "history.importFailed": "Import failed: the file format is invalid or its contents are damaged."
    }
  };

  function detectSystemLocale() {
    var language = (global.navigator && (global.navigator.language || global.navigator.userLanguage)) || "zh-CN";
    return String(language).toLowerCase().indexOf("zh") === 0 ? "zh-CN" : "en";
  }

  function readStoredLocale() {
    try {
      var value = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      return supported.indexOf(value) !== -1 ? value : detectSystemLocale();
    } catch (_error) {
      return detectSystemLocale();
    }
  }

  function interpolate(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (_match, key) {
      return values && Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : "";
    });
  }

  function t(key, values) {
    var catalogue = messages[locale] || messages[DEFAULT_LOCALE];
    var fallback = messages[DEFAULT_LOCALE][key];
    return interpolate(Object.prototype.hasOwnProperty.call(catalogue, key) ? catalogue[key] : (fallback || key), values);
  }

  function tForLocale(requestedLocale, key, values) {
    var normalized = String(requestedLocale || "").toLowerCase().indexOf("zh") === 0
      ? "zh-CN"
      : "en";
    var previous = locale;
    locale = normalized;
    var result = t(key, values);
    locale = previous;
    return result;
  }

  function field(value, key) {
    if (!value) return "";
    if (locale === "en") return value[key + "En"] || value[key] || "";
    return value[key] || value[key + "En"] || "";
  }

  function applyDocument() {
    if (!global.document) return;
    var document = global.document;
    document.documentElement.lang = locale;
    document.title = t("page.title");
    var description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute("content", t("page.description"));
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (element) {
      element.textContent = t(element.getAttribute("data-i18n"));
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-aria-label]"), function (element) {
      element.setAttribute("aria-label", t(element.getAttribute("data-i18n-aria-label")));
    });
    var toggle = document.getElementById("languageToggle");
    if (toggle) {
      toggle.textContent = t("language.switch");
      toggle.setAttribute("aria-label", t("language.switchLabel"));
      toggle.setAttribute("lang", locale === "en" ? "zh-CN" : "en");
    }
  }

  function setLocale(nextLocale) {
    if (supported.indexOf(nextLocale) === -1 || nextLocale === locale) return false;
    locale = nextLocale;
    try {
      if (global.localStorage) global.localStorage.setItem(STORAGE_KEY, locale);
    } catch (_error) {}
    applyDocument();
    if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
      global.dispatchEvent(new global.CustomEvent("quareia:languagechange", {
        detail: { locale: locale }
      }));
    }
    return true;
  }

  function toggleLocale() {
    setLocale(locale === "en" ? "zh-CN" : "en");
  }

  function init() {
    if (initialized || !global.document) return;
    initialized = true;
    applyDocument();
    var toggle = global.document.getElementById("languageToggle");
    if (toggle) toggle.addEventListener("click", toggleLocale);
  }

  global.DivinationI18n = {
    STORAGE_KEY: STORAGE_KEY,
    getLocale: function () { return locale; },
    isEnglish: function () { return locale === "en"; },
    t: t,
    tForLocale: tForLocale,
    field: field,
    applyDocument: applyDocument,
    setLocale: setLocale,
    toggleLocale: toggleLocale,
    init: init
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.DivinationI18n;
  }

  if (global.document) init();
})(typeof globalThis !== "undefined" ? globalThis : this);

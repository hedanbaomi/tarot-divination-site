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
    "nav.settings": "设置",
    "deck.kicker": "抽牌",
    "spread.kicker": "牌阵",
    "results.kicker": "解读",
    "footer.aboutTitle": "关于本站",
    "footer.licenseTitle": "授权与署名",
    "footer.privacyTitle": "隐私与统计",
      "language.switch": "EN",
      "language.switchLabel": "Switch to English",
      "history.open": "占卜历史",
      "announcement.open": "公告",
      "announcement.kicker": "PUBLIC ANNOUNCEMENTS",
      "announcement.title": "公告",
      "announcement.closeLabel": "关闭公告",
      "announcement.listAria": "公告列表",
      "announcement.empty": "暂无公告。",
      "announcement.cached": "当前显示最近成功缓存的公告。",
      "announcement.severity.info": "提示",
      "announcement.severity.important": "重要",
      "announcement.severity.update": "更新",
      "announcement.openAction": "了解详情",
      "announcement.updateAction": "查看更新",
      "settings.title": "高级设置",
      "settings.theme": "界面主题",
      "settings.themeAria": "选择界面主题",
      "theme.celestial": "星夜秘境",
      "theme.parchment": "羊皮纸晨光",
      "theme.ember": "余烬圣堂",
      "theme.grove": "密林祭坛",
      "theme.groveLight": "密林祭坛（明亮版）",
    "theme.jade": "青玉纸",
    "theme.dusk": "暮紫",
    "theme.ash": "素灰",
    "theme.toggle": "轻点月亮切换界面主题", "egg.wake": "它睁开了眼睛", "egg.sleep": "它闭上了眼睛",
      "settings.deck": "牌组",
      "deck.tarotOption": "塔罗牌（Rider–Waite）",
      "deck.mystagogusOption": "M 牌（Mystagogus）",
      "deck.lxxxiOption": "LXXXI 魔法牌（奎瑞亚）",
      "settings.mode": "牌位模式",
      "mode.upright": "全正位",
      "mode.mixed": "正逆位混合",
      "settings.layoutMode": "布局方式",
      "settings.pageVersion": "页面版本",
      "settings.useClassic": "切回旧版",
      "settings.useModern": "切回新版",
      "layout.preset": "预设牌阵",
      "layout.freeform": "自由画板",
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
      "customSpread.open": "设计或导入牌阵",
      "customSpread.kicker": "牌阵工作室",
      "customSpread.title": "自定义牌阵工作室",
      "customSpread.closeLabel": "关闭自定义牌阵工作室",
      "customSpread.windowControls": "工作室窗口位置",
      "customSpread.windowLeft": "左",
      "customSpread.windowCenter": "居中",
      "customSpread.windowRight": "右",
      "customSpread.windowLeftLabel": "将工作室停靠在左侧",
      "customSpread.windowCenterLabel": "将工作室居中",
      "customSpread.windowRightLabel": "将工作室停靠在右侧",
      "customSpread.enterFullscreen": "全屏",
      "customSpread.exitFullscreen": "退出全屏",
      "customSpread.dragWindow": "拖动标题栏可自由移动工作室",
      "customSpread.tabsAria": "自定义牌阵功能",
      "customSpread.libraryTab": "自定义牌阵",
      "customSpread.designerTab": "设计牌阵",
      "customSpread.importTab": "导入分享码",
      "customSpread.libraryTitle": "可用的自定义牌阵",
      "customSpread.new": "新建设计",
      "customSpread.libraryEmpty": "还没有自定义牌阵，可新建设计或导入分享码。",
      "customSpread.name": "牌阵名称",
      "customSpread.description": "用途说明",
      "customSpread.columns": "网格列数",
      "customSpread.rows": "网格行数",
      "customSpread.deckScope": "牌组限制",
      "customSpread.deckScopeAny": "不限牌组",
      "customSpread.deckScopeTarotOnly": "仅塔罗",
      "customSpread.deckScopeNonTarotOnly": "仅非塔罗",
      "customSpread.tarotMode": "塔罗抽牌模式",
      "customSpread.tarotModeMixed": "大阿与小阿混合",
      "customSpread.tarotModeMajorOnly": "仅大阿卡那",
      "customSpread.tarotModeMinorOnly": "仅小阿卡那",
      "customSpread.stackingMode": "叠牌法",
      "customSpread.stackingModeSingle": "单牌",
      "customSpread.stackingModeMajorMinor": "大阿＋小阿叠放",
      "customSpread.preview": "布局预览",
      "customSpread.previewAria": "自定义牌阵布局预览",
      "customSpread.previewEffect": "抽牌效果预览",
      "customSpread.previewEffectTitle": "抽牌效果预览",
      "customSpread.previewEffectClose": "关闭抽牌效果预览",
      "customSpread.previewEffectAria": "抽牌效果预览内容",
      "customSpread.dragHint": "拖动牌位到网格单元格；十列会完整缩放显示，坐标也可手动输入。",
      "customSpread.positions": "牌位",
      "customSpread.addPosition": "添加牌位",
      "customSpread.generateCode": "生成分享码",
      "customSpread.shareCode": "分享码",
      "customSpread.shareCodeAria": "自定义牌阵分享码",
      "customSpread.copyCode": "复制分享码",
      "customSpread.downloadCode": "保存分享码文件",
      "customSpread.importLabel": "粘贴分享码",
      "customSpread.importAndUse": "导入并使用",
      "customSpread.saveAndUse": "保存并使用",
      "customSpread.useThisSession": "使用牌阵",
      "customSpread.androidPrivacy": "自定义牌阵只保存在本机应用中，不使用账号、云同步或网络；卸载或清除应用数据会删除它们，请保留分享码备份。",
      "customSpread.webPrivacy": "网页会在当前浏览器记住最后打开的牌阵，包括自定义牌阵。其他自定义牌阵仅在本次会话可用，请复制分享码或保存文本文件以便保留。",
      "customSpread.group": "自定义牌阵",
      "customSpread.cardCount": "{count} 个牌位",
      "customSpread.noDescription": "未填写用途说明",
      "customSpread.use": "使用",
      "customSpread.edit": "编辑",
      "customSpread.delete": "删除",
      "customSpread.positionNumber": "牌位 {number}",
      "customSpread.positionName": "牌位名称",
      "customSpread.positionMeaning": "牌位含义",
      "customSpread.column": "列",
      "customSpread.row": "行",
      "customSpread.drawRule": "抽牌限制",
      "customSpread.drawRuleFollowing": "跟随牌阵",
      "customSpread.drawRuleMajor": "仅大阿",
      "customSpread.drawRuleMinor": "仅小阿",
      "customSpread.drawRuleWands": "权杖",
      "customSpread.drawRuleCups": "圣杯",
      "customSpread.drawRuleSwords": "宝剑",
      "customSpread.drawRulePentacles": "星币",
      "customSpread.stackOn": "叠在牌位",
      "customSpread.stackOnNone": "不叠放",
      "customSpread.stackOnPrevious": "叠在牌位 {number}",
      "customSpread.rotation": "牌位旋转",
      "customSpread.rotateLeft": "向左旋转 45°",
      "customSpread.rotateRight": "向右旋转 45°",
      "customSpread.previewMajorLayer": "大阿层",
      "customSpread.previewMinorLayer": "小阿层",
      "customSpread.previewCardLayer": "单牌层",
      "customSpread.moveUp": "前移",
      "customSpread.moveDown": "后移",
      "customSpread.removePosition": "移除牌位",
      "customSpread.previewPosition": "牌位 {number}：{name}",
      "customSpread.unnamedPosition": "未命名",
      "customSpread.codeReady": "分享码已生成；可复制或保存为文本文件。",
      "customSpread.invalidDefinition": "牌阵资料不完整或超出限制，请检查名称、网格和每个牌位。",
      "customSpread.savedAndroid": "牌阵已保存在本机并可开始抽牌。",
      "customSpread.savedWeb": "牌阵已启用；当前浏览器会记住最后打开的牌阵。",
      "customSpread.importedAndroid": "分享码已导入并保存在本机。",
      "customSpread.importedWeb": "牌阵已导入并启用；当前浏览器会记住最后打开的牌阵。",
      "customSpread.invalidCode": "分享码无效、已损坏、版本不受支持或内容超出限制。",
      "customSpread.storageFailed": "无法写入本机存储；牌阵没有保存，请保留分享码并检查可用空间。",
      "customSpread.libraryFull": "本机最多同时保存 {limit} 个自定义牌阵。请先删除一个，再保存或导入新的牌阵。",
      "customSpread.capacityKicker": "牌组容量",
      "customSpread.capacityTitle": "当前筛选的牌不够",
      "customSpread.capacityMessage": "该牌阵需要 {positions} 张牌，但“仅大阿卡那”只有 {available} 张。切换到完整塔罗牌组后继续？",
      "customSpread.keepFilter": "保持当前筛选",
      "customSpread.switchFullDeck": "切换并使用",
      "customSpread.deleteKicker": "本地牌阵",
      "customSpread.deleteTitle": "删除自定义牌阵？",
      "customSpread.deleteMessage": "确定删除“{name}”吗？若这是当前牌阵，当前抽牌也会被清空。",
      "customSpread.keep": "保留牌阵",
      "customSpread.deleted": "自定义牌阵已删除。",
      "customSpread.copied": "分享码已复制。",
      "customSpread.copyFailed": "无法自动复制，请长按或全选分享码后手动复制。",
      "customSpread.downloadFailed": "当前环境无法保存分享码文件，请复制分享码。",
      "customSpread.downloaded": "分享码文件已开始保存。",
      "deck.heading": "牌堆",
    "table.title": "牌桌",
    "table.dragHint": "左右拖动翻看牌堆 · 轻点任意一张牌",
    "spread.settings": "牌阵设置",
    "spread.settingsClose": "关闭牌阵设置",
      "deck.initialRemaining": "剩 78 张",
      "deck.shuffle": "洗牌",
      "deck.shuffleHold": "按住不放持续洗牌，准备好后松手",
      "deck.shuffleRelease": "松手收牌",
    "deck.prev": "往前翻一张牌",
    "deck.next": "往后翻一张牌",
      "deck.initialCta": "轻点环绕四周的任意一张牌，把它抽进中央牌阵",
      "deck.initialAria": "环形牌堆，轻点任意一张抽牌",
      "deck.switch": "切换牌组",
      "spread.initialTitle": "你的牌阵",
      "spread.initialCount": "0 / 3",
      "spread.reveal": "一键开牌",
      "spread.clear": "重新洗牌",
      "spread.hint": "轻点任意一张牌可单独翻开，或按「开牌解读」全部翻开；开牌后再次轻点牌面可查看牌意。",
      "spread.guide": "牌位说明",
      "spread.gridAria": "抽取的牌按所选牌阵自动排列",
      "results.title": "解读结果",
      "history.kicker": "LOCAL HISTORY",
      "history.title": "占卜历史",
      "history.closeLabel": "关闭占卜历史",
      "history.privacy": "数据仅保存在当前浏览器。清除网站数据、使用无痕模式、换设备或换浏览器都可能导致记录丢失；可导出 JSON 自行备份。本站不会上传历史，也不做遥测或追踪。",
      "history.notesTitle": "占卜笔记",
      "history.sourcesAndCredits": "来源与致谢",
      "history.credit.tarot": "牌意参考 Josephine McCarthy 的[《21世纪的塔罗技能》]({url})及 Quareia 训练教材。",
      "history.credit.mystagogus": "Josephine McCarthy 著，[《Mystagogus》牌组指南]({url})。",
      "history.credit.lxxxi": "Josephine McCarthy 著，[《LXXXI 奎瑞亚魔法牌：牌意指南》第二版]({url})。",
      "history.keywords": "关键词",
      "history.meaningUnavailable": "内置牌库中没有这张牌的牌意。",
      "notes.library": "卡牌笔记",
      "notes.search": "搜索牌名或笔记",
      "notes.onlySaved": "只看有笔记的牌",
      "notes.back": "返回",
      "notes.text": "个人笔记",
      "notes.open": "笔记",
      "notes.editFor": "查看或编辑{name}的笔记",
      "notes.hasNote": "已有笔记",
      "notes.export": "导出笔记 JSON",
      "notes.import": "导入笔记 JSON",
      "notes.local": "笔记自动保存在本机。换设备或清理数据前，请导出备份。",
      "notes.loading": "正在读取…",
      "notes.autoSave": "自动保存到本机",
      "notes.saved": "已保存到本机",
      "notes.saving": "正在保存…",
      "notes.noMatches": "没有找到符合条件的牌。",
      "notes.noNotes": "还没有笔记。取消筛选即可选择一张牌开始写。",
      "notes.loadFailed": "无法读取本机笔记。请重试。",
      "notes.saveFailed": "保存失败。草稿仍在此处，可以复制或重试。",
      "notes.conflict": "这张牌的笔记已在其他窗口更改。请先复制自己的草稿，再载入已保存的版本。",
      "notes.reload": "载入已保存的版本",
      "notes.retry": "重试",
      "notes.discard": "放弃未保存的修改",
      "notes.emptyEditor": "输入或粘贴你的读书笔记…",
      "notes.imported": "已导入 {imported} 条，保留本机已有的 {skipped} 条。",
      "notes.badBackup": "导入失败，请选择有效的卡牌笔记 JSON 备份。",
      "notes.exported": "笔记备份已导出。",
      "notes.exportFailed": "笔记备份导出失败，请重试。",
      "notes.choosing": "请选择笔记备份的保存位置。",
      "notes.cancelled": "已取消备份导出。",
      "history.exportBusy": "请先完成当前文件的导出。",
      "history.question": "占卜问题",
      "history.addQuestion": "记录问题",
      "history.editQuestion": "修改问题",
      "history.optionalQuestion": "本次占卜想问什么？（选填）",
      "history.saveQuestion": "保存问题",
      "history.cancel": "取消",
      "history.questionSaved": "问题已保存。",
      "history.questionFailed": "未能保存问题，请重试。",
      "history.search": "搜索问题、牌阵或牌名",
      "history.noMatches": "没有符合条件的记录。",
      "history.selectReadings": "选择记录",
      "history.cancelSelection": "取消选择",
      "history.exportNotes": "导出 Markdown",
      "history.exportSelected": "导出 Markdown（{count}）",
      "history.fileDownloaded": "已下载 {fileName}。",
      "history.fileSaved": "已保存 {fileName}。",
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
      "footer.srcTarotTag": "塔罗",
      "footer.srcTarot": "牌意参考《21 世纪的塔罗技能》与 Quareia 语境",
      "footer.srcMTag": "M 牌",
      "footer.srcM": "关键词译自 Josephine McCarthy《Mystagogus》",
      "footer.srcLxxxiTag": "LXXXI",
      "footer.srcLxxxi": "牌意参考其英文说明书",
      "footer.funNote": "仅供娱乐，请理性看待占卜结果。",
      "attribution.status": "本站为非官方工具，不暗示 Quareia 或作者为项目背书。书面许可覆盖网站与 Android，并于 2026-08-05 扩展至微信小程序；非商业限制只针对 Mystagogus/LXXXI 牌面、牌意、翻译、牌阵及相关授权材料。这些材料不得出售、设置付费墙或付费解锁、单独商业分发、转授权或纳入软件许可；商业利用须另行授权。该限制不是对用户原创软件、基础设施或无关服务的一般性商业禁令，也不代表任何具体商业模式已获批准。",
      "attribution.mystagogusLabel": "Mystagogus 牌面与相关文本",
      "attribution.mystagogusRights": "© Josephine McCarthy",
      "attribution.lxxxiLabel": "LXXXI 魔法牌牌面与相关文本",
      "attribution.lxxxiRights": "© Josephine McCarthy、Stuart Littlejohn、Cassandra Beanland",
      "attribution.quareiaLink": "Quareia 官网",
      "attribution.quoteCite": "— Josephine McCarthy",
      "attribution.quoteZh": "（中文参考译文：「虽然数字占卜工具在紧急情况下可能会有用，但占卜师用双手亲自接触和洗牌的互动更安全，准确度也更高，且力量强大得多。」原文以英文为准。）",
      "privacy.analytics": "本站使用匿名浏览器标识，将访问量、活跃浏览器、完成解牌次数、AI 模型 ID / Token 用量 / 对话轮数及国家/省州级地区分布汇总至与手机端共用的统计后台，可随时关闭；另使用 Cloudflare Web Analytics 统计访问量与页面性能。不收集邮箱、占卜内容、抽牌结果或本地历史记录。",
      "privacy.telemetryDisable": "关闭统一使用统计",
      "privacy.telemetryEnable": "开启统一使用统计",
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
      "app.deckAria.tarot": "塔罗牌堆，轻点抽牌",
      "app.deckAria.mystagogus": "Mystagogus 牌堆，轻点抽牌",
      "app.deckAria.lxxxi": "LXXXI 魔法牌堆，轻点抽牌",
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
  "app.meaningClose": "关闭",
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
      "app.emptySpreadHint": "虚线框是当前牌阵的空牌位。从上方牌堆轻点任意一张抽出后，牌会落到对应位置。",
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
      "confirm.shuffle": "重新洗牌会清空桌上已抽出的牌，是否继续？",
      "confirm.layout": "切换布局会清除当前未保存的牌面内容，是否继续？",
      "confirm.freeBoardDiscard": "确定丢弃自由画板草稿并清空画板吗？此操作无法撤销。",
      "confirm.freeBoardShuffle": "重新洗牌会清空自由画板并打乱待抽牌堆，是否继续？",
      "confirm.kicker": "牌阵变更",
      "confirm.title": "当前牌阵尚未清空",
      "confirm.cancel": "保留牌阵",
      "confirm.keep": "保留",
      "confirm.proceed": "清空并洗牌",
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
      "history.actualLayout": "实际摆放",
      "history.hideActualLayout": "收起实际摆放",
      "history.actualLayoutAria": "完整牌位实际摆放",
      "history.actualLayoutHint": "已按记录中的牌位重新摆放；轻点任意牌面可翻转查看牌意，再次轻点返回牌面。",
      "history.unavailableSave": "当前浏览器无法保存历史；占卜仍可正常使用。",
      "history.unavailable": "当前浏览器无法访问 IndexedDB，历史不可用；占卜功能不受影响。",
      "history.saveSnapshotError": "自动保存失败；占卜结果仍保留在当前页面。",
      "history.saving": "正在自动保存占卜历史…",
      "history.saveUnavailable": "自动保存失败；当前浏览器无法使用本地历史。",
      "history.duplicate": "这次完整占卜刚刚已经自动保存，无需重复保存。",
      "history.saved": "开牌完成，已自动保存到当前浏览器的占卜历史。",
      "history.deleted": "已删除这条历史记录。",
      "history.deleteFailed": "删除失败，请稍后再试。",
      "history.deleteConfirm": "确定删除这条占卜历史吗？此操作无法撤销。",
      "history.clearConfirm": "确定清空当前浏览器中的全部占卜历史吗？此操作无法撤销。",
      "history.confirmKicker": "本地历史",
      "history.confirmTitle": "删除占卜记录？",
      "history.confirmCancel": "保留记录",
      "history.confirmProceed": "确认删除",
      "history.cleared": "全部历史记录已清空。",
      "history.clearFailed": "清空失败，请稍后再试。",
      "history.exported": "已下载 JSON 备份：{fileName}。请在浏览器下载列表或“下载”文件夹中查看。",
      "history.exportChoosing": "正在打开保存位置，请在系统窗口中选择文件夹：{fileName}",
      "history.exportedTo": "已保存 JSON 备份：{fileName}，位置为你刚刚选择的文件夹。",
      "history.exportCancelled": "已取消导出，历史记录没有改变。",
      "history.exportFailed": "导出失败，请稍后再试。",
      "history.imported": "已导入 {count} 条历史记录。",
      "history.remapped": " {count} 条重复 ID 已安全重编号。",
      "history.importFailed": "导入失败：文件格式不正确或内容已损坏。"
      ,"freeBoard.settingsSummary": "自由画板：可从当前牌组与筛选结果中任意抽牌，不设固定牌位或目标张数。"
      ,"freeBoard.title": "自由画板"
      ,"freeBoard.open": "自由画板"
      ,"freeBoard.backToPreset": "返回预设牌阵"
      ,"freeBoard.openHint": "牌堆以扇形摊在桌上，不套用任何牌阵，想抽哪张抽哪张。", "freeBoard.cardHiddenAria": "第 {index} 张牌，未翻开", "freeBoard.cardAria": "第 {index} 张牌，{name}，{orientation}", "freeBoard.slotName": "自由牌位",
  "freeBoard.angleTitle": "角度", "freeBoard.drawnAria": "已抽出的牌"
      ,"freeBoard.toolbarAria": "自由画板控制"
      ,"freeBoard.undo": "撤销"
      ,"freeBoard.undoAria": "撤销上一次自由画板操作"
      ,"freeBoard.redo": "重做"
      ,"freeBoard.redoAria": "重做上一次自由画板操作"
      ,"freeBoard.revealAll": "全部开牌"
      ,"freeBoard.revealAllAria": "翻开自由画板上的所有卡牌"
      ,"freeBoard.resetView": "重置视图"
      ,"freeBoard.resetViewAria": "将自由画板平移和缩放重置为默认"
      ,"freeBoard.shuffle": "洗牌"
      ,"freeBoard.shuffleAria": "清空自由画板并重新洗牌"
      ,"freeBoard.clearAndDiscard": "清空画板并放弃草稿"
      ,"freeBoard.clearAndDiscardAria": "清空自由画板并删除已保存草稿"
      ,"freeBoard.boardAria": "自由画板，可拖动画板与卡牌，双指或滚轮缩放"
      ,"freeBoard.worldAria": "自由画板上的卡牌"
      ,"freeBoard.selectedControlsAria": "所选卡牌控制"
      ,"freeBoard.pileTitle": "待抽牌堆"
      ,"freeBoard.pileAria": "自由画板待抽牌堆，可任意选择一张"
      ,"freeBoard.drawAria": "待抽牌堆第 {index} 张，共 {count} 张，轻点抽到自由画板"
      ,"freeBoard.faceDown": "牌背"
      ,"freeBoard.meaning": "牌意"
      ,"freeBoard.revealed": "已开牌"
      ,"freeBoard.unrevealed": "未开牌"
      ,"freeBoard.selectedControls": "当前选择：{card}"
      ,"freeBoard.drawOrder": "牌位{order}"
      ,"freeBoard.cardsDrawn": "已放置 {count} 张"
      ,"freeBoard.remaining": "待抽 {count} 张"
      ,"freeBoard.status": "已放置 {cards} 张 · 待抽 {remaining} 张"
      ,"freeBoard.hint": "在扇形的牌堆里双击一张牌，它就落到画板上；拖动卡牌改变位置，长按卡牌可以转动它的角度。需要开牌时用“全部开牌”。"
      ,"freeBoard.rotateMinus15": "−15°"
      ,"freeBoard.rotateMinus15Aria": "逆时针旋转当前卡牌 15 度"
      ,"freeBoard.rotatePlus15": "＋15°"
      ,"freeBoard.rotatePlus15Aria": "顺时针旋转当前卡牌 15 度"
      ,"freeBoard.rotateMinus90": "−90°"
      ,"freeBoard.rotateMinus90Aria": "逆时针旋转当前卡牌 90 度"
      ,"freeBoard.rotatePlus90": "＋90°"
      ,"freeBoard.rotatePlus90Aria": "顺时针旋转当前卡牌 90 度"
      ,"freeBoard.bringFront": "置于顶层"
      ,"freeBoard.bringFrontAria": "将当前卡牌置于最上层"
      ,"freeBoard.showMeaning": "显示牌意"
      ,"freeBoard.showMeaningAria": "查看当前已开牌的牌意"
      ,"freeBoard.hideMeaning": "显示牌面"
      ,"freeBoard.hideMeaningAria": "返回查看当前卡牌牌面"
      ,"freeBoard.remove": "移除／回牌堆"
      ,"freeBoard.removeAria": "移除当前卡牌并放回待抽牌堆"
      ,"freeBoard.draftInvalid": "保存的自由画板草稿无效，已安全忽略。"
      ,"freeBoard.draftSaveFailed": "自由画板草稿保存失败；当前画板仍可继续使用。"
      ,"freeBoard.draftDiscarded": "自由画板草稿已丢弃。"
      ,"freeBoard.saving": "正在自动保存自由画板历史…"
      ,"freeBoard.saved": "自由画板已自动保存到占卜历史。"
      ,"freeBoard.duplicate": "这份自由画板刚刚已经保存，无需重复保存。"
      ,"freeBoard.saveFailed": "自由画板历史保存失败；画板仍保留在当前页面。"
      ,"freeBoard.saveUnavailable": "当前浏览器无法保存历史；自由画板仍可正常使用。"
      ,"history.freeBoard": "自由画板"
      ,"history.freeBoardDetail": "自由画板记录"
      ,"history.freeBoardPreview": "自由画板空间重建（只读）"
      ,"history.freeBoardHidden": "牌背（未开牌）"
      ,"history.freeBoardRevealed": "已开牌 · {orientation}"
      ,"history.freeBoardCardState": "{card} · {state}"
      ,"history.savingFreeBoard": "正在保存自由画板历史…"
      ,"history.savedFreeBoard": "自由画板已保存到当前浏览器的占卜历史。"
      ,"history.duplicateFreeBoard": "这份自由画板刚刚已经保存，无需重复保存。"
      ,"history.openInAi": "去 AI 解牌"
      ,"privacy.ai": "AI 密钥与聊天记录只保存在本机，请求直连你配置的模型接口。开启匿名使用统计时，会发送模型 ID、接口回传的 Token 用量和对话轮数；后台不接收密钥、接口地址、问题或回答内容。"
      ,"ai.open": "AI 解牌"
      ,"ai.pageTitle": "AI 辅助解牌 · Quareia 占卜"
      ,"ai.title": "AI 辅助解牌"
      ,"ai.subtitle": "基于应用内牌意 · 仅限非自由画板历史"
      ,"ai.chatsMenu": "对话"
      ,"ai.sidebarToggleAria": "打开对话列表"
      ,"ai.sidebarAria": "AI 对话历史"
      ,"ai.backToReading": "返回占卜"
      ,"ai.settingsOpen": "API 设置"
      ,"ai.newChat": "+ 新建对话"
      ,"ai.searchPlaceholder": "搜索对话标题、问题或聊天内容"
      ,"ai.untitledChat": "新解牌对话"
      ,"ai.archivedBadge": "已归档"
      ,"ai.pickReadings": "+ 选择占卜历史"
      ,"ai.rename": "重命名"
      ,"ai.exportMd": "导出 Markdown"
      ,"ai.archive": "归档"
      ,"ai.unarchive": "取消归档"
      ,"ai.delete": "删除"
      ,"ai.pin": "置顶"
      ,"ai.unpin": "取消置顶"
      ,"ai.pinned": "已置顶"
      ,"ai.exportBackup": "导出备份"
      ,"ai.err.incomplete": "连接在回答完成前结束，已保留收到的内容。请重试或继续追问。"
      ,"ai.archiveTooLargeTitle": "备份超过导入上限"
      ,"ai.archiveTooLargeMsg": "全部对话的 JSON 备份超过 8 MiB，无法通过本页面恢复。可改为导出全部对话的 Markdown 存档，保留聊天正文、回答提示与占卜摘要供阅读。Markdown 存档不能导入聊天列表。"
      ,"ai.exportArchive": "导出 Markdown 存档"
      ,"ai.storageMemoryWarning": "无法访问聊天存储，本次聊天仅保存在内存中。刷新或离开页面会丢失本次聊天，请先导出备份。"
      ,"ai.importTooLarge": "AI 对话备份不能超过 8 MiB。请选择较小的备份文件。"
      ,"ai.err.truncated": "已达到模型输出上限，回答可能不完整。可以继续追问，或在 API 设置中提高最大输出 Token。"
      ,"ai.err.blocked": "模型的内容策略拦截了本次回答，已保留收到的内容。请调整问题后重试。"
      ,"ai.err.invalidResponse": "接口返回了无法识别的响应，请检查接口地址或中转服务：{detail}"
      ,"ai.importBackup": "导入备份"
      ,"ai.clearArchived": "清空已归档"
      ,"ai.clearActive": "清空进行中"
      ,"ai.tabActiveCount": "进行中 ({count})"
      ,"ai.tabArchivedCount": "已归档 ({count})"
      ,"ai.noMatchingChats": "没有匹配的对话记录。"
      ,"ai.noArchivedChats": "暂无已归档对话。"
      ,"ai.noActiveChats": "暂无对话，点击上方「新建对话」开始。"
      ,"ai.chatMetaSummary": "{readings} 条占卜 · {messages} 条消息"
      ,"ai.promptPlaceholder": "输入你的困惑或追问（Enter 发送，Shift+Enter 换行）"
      ,"ai.medicalNoticeTitle": "医疗相关提示（应用说明，非 AI 回复）"
      ,"ai.medicalNoticeBody": "牌义与 AI 解读不能确认疾病、判断病情轻重或预测自愈，也不能替代诊断、检查与治疗。请勿据此延误就医或自行停药、改变治疗方案；如有健康疑虑，请咨询医疗专业人士。"
      ,"ai.disclaimer": "免责声明：AI 解读可能存在错误或偏差，仅供个人反思与参考，不代表事实或对未来的保证，不能替代医疗、心理、法律或财务等专业意见。涉及健康、安全及其他重要决定，请核实实际情况并咨询合格专业人士。"
      ,"ai.send": "发送"
      ,"ai.stop": "停止"
      ,"ai.pickerTitle": "选择占卜历史（仅非自由画板）"
      ,"ai.pickerHint": "支持多选。已自动过滤自由画板记录；卡片仅展示摘要信息，后台将准确注入牌阵牌位、叠牌因果关系与对应应用内牌意。"
      ,"ai.pickerSearchPlaceholder": "按问题、牌阵名或牌名筛选"
      ,"ai.deckAll": "全部牌组"
      ,"ai.pickerClear": "清空已选"
      ,"ai.pickerApplyCount": "确定附加 ({count})"
      ,"ai.pickerEmpty": "没有找到可选的非自由画板占卜记录。请先在首页使用固定牌阵或自定义牌阵完成一次占卜并保存历史。"
      ,"ai.renameTitle": "重命名对话"
      ,"ai.renameLabel": "对话标题"
      ,"ai.save": "保存"
      ,"ai.cancel": "取消"
      ,"ai.close": "关闭"
      ,"ai.ok": "确定"
      ,"ai.settingsTitle": "模型接口与 API Key 设置"
      ,"ai.newProfile": "+ 新增配置"
      ,"ai.deleteProfile": "删除配置"
      ,"ai.newProfileDefaultName": "新模型配置"
      ,"ai.lockedPromptNote": "系统提示词与内置 Quareia 解牌技法引擎已锁定（自动按牌组、牌阵电路与追问轮次挂载，依据应用内牌意推演且严禁照搬说明书），不可手动篡改，且不限制日常非占卜正常对话。"
      ,"ai.presetLabel": "快速填入"
      ,"ai.preset.deepseekFlash": "DeepSeek Flash"
      ,"ai.preset.deepseekPro": "DeepSeek V4 Pro"
      ,"ai.presetApplied": "已填入 {preset}；请确认此接口的 API Key 后保存。"
      ,"ai.fieldName": "配置名称"
      ,"ai.fieldFormat": "接口格式"
      ,"ai.fieldBaseUrl": "Base URL（接口地址 / 代理地址）"
      ,"ai.fieldApiKey": "静态 API Key（仅存本机，持续有效）"
      ,"ai.fieldModel": "模型名称（Model ID）"
      ,"ai.fieldVertexProject": "Vertex Project ID（Express Mode 可留空）"
      ,"ai.fieldVertexLocation": "Vertex Location（如 global 或 us-central1）"
      ,"ai.fieldTemperature": "Temperature（可选，0–2）"
      ,"ai.fieldMaxTokens": "Max Tokens（可选）"
      ,"ai.fieldContextWindow": "模型上下文窗口（Tokens，留空自动识别）"
      ,"ai.contextWindowPlaceholder": "自动识别模型上下文大小"
      ,"ai.contextWindowAutoPlaceholder": "自动识别（当前约 {count} tokens）"
      ,"ai.detectContextWindow": "自动获取"
      ,"ai.detectingContext": "正在获取模型上下文窗口大小…"
      ,"ai.detectContextDone": "已从接口获取上下文窗口：{count} tokens"
      ,"ai.detectContextCatalog": "接口未返回上下文长度，已使用模型目录：{count} tokens。代理限制可能不同，可手动覆盖。"
      ,"ai.detectContextUnknown": "未能识别此模型的上下文窗口。当前使用 {count} tokens（{source}）；请按服务商说明手动填写。"
      ,"ai.detectContextChanged": "配置已更改，请重新获取上下文窗口。"
      ,"ai.contextWindowStatus": "当前生效上限：{count} tokens（来源：{source}）"
      ,"ai.contextSource.manual": "手动指定"
      ,"ai.contextSource.api": "接口实时获取"
      ,"ai.contextSource.catalog": "模型目录识别"
      ,"ai.contextSource.default": "默认保守估计"
      ,"ai.fieldAutoCompress": "自动压缩早期上下文"
      ,"ai.autoCompressHint": "接近模型上下文上限时自动摘要早期对话，并保留当前关联的占卜牌意与近期对话。"
      ,"ai.contextMeter": "上下文约 {used} / {limit} tokens（{source}）"
      ,"ai.contextMeterCompressed": " · 已压缩早期 {count} 条"
      ,"ai.compressingStatus": "正在压缩早期对话上下文以保持完整牌意…"
      ,"ai.testConnection": "测试连接"
      ,"ai.saveActivate": "保存并启用"
      ,"ai.profileUnconfigured": "未配置 API Key"
      ,"ai.banner.needBoth": "请先配置大模型 API Key；如需辅助解牌，可从非自由画板占卜历史中选择一条或多条记录作为上下文，也可直接自由对话。"
      ,"ai.banner.needKey": "尚未配置可用的模型 API Key。点击「API 设置」填写密钥并测试连接后即可开始对话。"
      ,"ai.banner.needReading": "当前对话尚未附加占卜记录：可直接进行常规 AI 对话，或点击「选择占卜历史」传入固定/自定义牌阵与应用内牌意。"
      ,"ai.noAttachedReadings": "未附加占卜记录（已自动过滤自由画板记录）"
      ,"ai.readingSnapshotSaved": "已使用对话内保存的牌阵快照"
      ,"ai.readingDeleted": "原记录已不在本地历史中"
      ,"ai.removeReading": "移除此占卜记录"
      ,"ai.emptyHeading": "AI 辅助解牌助手"
      ,"ai.emptyDesc": "选择一条或多条非自由画板占卜记录后，系统会自动挂载对应的牌阵拓扑与牌组解牌技法（提纯意象底稿、告别照念说明书）。建议在上方卡片补充当时所问之事，或点击下方提问直接开始："
      ,"ai.roleUser": "你"
      ,"ai.reasoningSummary": "思考过程 / 推理摘要"
      ,"ai.saveAndResend": "保存并重新发送"
      ,"ai.retry": "重试"
      ,"ai.copy": "复制"
      ,"ai.copied": "已复制"
      ,"ai.editResend": "编辑并重发"
      ,"ai.regenerate": "重新生成"
      ,"ai.showKey": "显示"
      ,"ai.hideKey": "隐藏"
      ,"ai.format.openaiChat": "OpenAI Chat Completions (/v1/chat/completions)"
      ,"ai.format.openaiResponses": "OpenAI Responses API (/v1/responses)"
      ,"ai.format.anthropic": "Anthropic Messages (/v1/messages)"
      ,"ai.format.geminiStudio": "Google Gemini AI Studio"
      ,"ai.format.geminiVertex": "Google Gemini Vertex AI（仅静态 API Key）"
      ,"ai.hint.openaiChat": "兼容 OpenAI、DeepSeek、OpenRouter、SiliconFlow 及符合 /v1/chat/completions 规范的代理地址；默认发送 Authorization: Bearer 请求头。"
      ,"ai.hint.openaiResponses": "适用于 OpenAI 新版 Responses 接口 (/v1/responses)，请求体使用 instructions 与 input 字段。"
      ,"ai.hint.anthropic": "适用于 Claude (/v1/messages)，自动附带 x-api-key、anthropic-version 与浏览器直连所需请求头。"
      ,"ai.hint.geminiStudio": "使用 Google AI Studio API Key，自动请求 generativelanguage.googleapis.com 的 streamGenerateContent?alt=sse 接口。"
      ,"ai.hint.geminiVertex": "仅使用静态 API Key (x-goog-api-key)，不提供 OAuth 登录。留空 Project ID 可直接用于 Vertex Express Mode；填写 Project ID 与 Location 则构造区域项目静态密钥接口。"
      ,"ai.err.missingKey": "请填写 API Key"
      ,"ai.err.missingModel": "请填写模型名称"
      ,"ai.err.insecureUrl": "除本机 localhost 外 Base URL 必须使用 https://"
      ,"ai.err.invalidUrl": "Base URL 格式无效"
      ,"ai.settingsSaved": "配置已持久保存并设为当前启用方案。"
      ,"ai.testingConnection": "正在测试接口连接…"
      ,"ai.testSuccess": "连接成功（{model}），可保存使用。"
      ,"ai.err.unknown": "请求失败"
      ,"ai.err.auth": "鉴权失败，请检查 API Key、模型权限或 Vertex 接口设置：{detail}"
      ,"ai.err.rateLimit": "触发频率或配额限制，请稍后重试：{detail}"
      ,"ai.err.network": "网络或跨域请求失败，请检查网络、Base URL（HTTPS）或中转站 CORS 配置：{detail}"
      ,"ai.stoppedEmpty": "已停止生成。"
      ,"ai.confirmKicker": "AI 对话"
      ,"ai.deleteChatTitle": "确认删除该对话？"
      ,"ai.deleteChatMsg": "将永久移除「{title}」中的所有提问与解牌记录，无法恢复。"
      ,"ai.clearArchivedTitle": "清空所有已归档对话？"
      ,"ai.clearAllTitle": "清空当前进行中的对话？"
      ,"ai.clearArchivedMsg": "此操作将删除所有已归档的 AI 对话，进行中的对话会保留。"
      ,"ai.clearAllMsg": "此操作将清空所有进行中（非归档）对话，或建议先导出备份。"
      ,"ai.clearConfirm": "确认清空"
      ,"ai.deleteMsgTitle": "删除这条消息？"
      ,"ai.deleteMsgDesc": "确认将该条发言从本地聊天记录中移除吗？"
      ,"ai.backupKicker": "AI 备份"
      ,"ai.importDoneTitle": "导入完成"
      ,"ai.importDoneMsg": "已成功合并导入 {imported} 段对话（当前共 {total} 段）。"
      ,"ai.importErrTitle": "导入失败"
      ,"ai.importErrMsg": "文件格式不匹配，请选择本站导出的 AI 对话 JSON 备份文件。"
      ,"ai.pageDescription": "结合 Quareia 应用内牌意与非自由画板占卜历史的 AI 辅助解牌对话工作台"
      ,"ai.contextBarAria": "当前对话与占卜上下文"
      ,"ai.deckTarot": "Quareia 塔罗"
      ,"ai.clearConfig": "清除已存密钥"
      ,"ai.clearConfigTitle": "清除所有已保存的 API Key？"
      ,"ai.clearConfigMsg": "此操作将从当前设备移除所有已保存的模型配置与 API Key，但不会删除你的 AI 对话记录。"
      ,"ai.clearConfigConfirm": "确认清除"
      ,"ai.configCleared": "已清除本地保存的所有 API Key 与模型配置。"
      ,"ai.exportedTo": "已导出：{fileName}"
      ,"ai.exportCancelled": "已取消导出。"
      ,"ai.exportFailed": "导出失败，请稍后重试。"
      ,"ai.chatChangedTitle": "对话已更新"
      ,"ai.chatChangedMsg": "其他标签页已修改此对话，已载入最新内容。请确认后重试。"
      ,"ai.saveFailedTitle": "保存失败"
      ,"ai.saveFailedMsg": "无法保存对话，请检查存储空间后重试。"
      ,"ai.skillModeLabel": "解牌人格"
      ,"ai.skillModeAria": "选择 AI 解读人格"
      ,"ai.skillMode.auto": "奥莉薇娅"
      ,"ai.skillModeHint.auto": "内置人格包：塔罗咨询师 · 非暴力沟通 · 牌面镜像"
      ,"ai.activeSkillsLabel": "已挂载技法"
      ,"ai.activeSkillsNone": "自由对话（附加排盘后自动挂载专属占卜技法）"
      ,"ai.questionPrefix": "所问："
      ,"ai.questionAdd": "+ 补充当时所问之事"
      ,"ai.questionEdit": "修改问题"
      ,"ai.questionPlaceholder": "补充当时抽牌的具体问题与时间范围（如：未来三个月跳槽是否合适）"
      ,"ai.starter.core": "直说核心结论：这副牌眼下最核心的矛盾卡在哪？牌势正往哪边推？"
      ,"ai.starter.action": "先一句话交代稳固的基本盘，再重点深挖我没意识到的盲点与破局抓手。"
      ,"ai.starter.compare": "若关联了多条记录，请对比局势在时间线上的真实演变，看看哪些隐患正在缓解或加剧。"
    },
    "en": {
      "page.title": "Quareia Divination",
      "page.description": "Quareia-inspired divination with Rider-Waite Tarot, Mystagogus, and LXXXI decks, hand-picked card drawing, guided spreads, and upright or reversed Tarot readings.",
      "site.title": "Quareia Divination",
      "site.subtitle": "TAROT · MYSTAGOGUS · LXXXI",
    "nav.settings": "Settings",
    "deck.kicker": "Draw",
    "spread.kicker": "Spread",
    "results.kicker": "Reading",
    "footer.aboutTitle": "About",
    "footer.licenseTitle": "Licence & credits",
    "footer.privacyTitle": "Privacy & analytics",
      "language.switch": "中文",
      "language.switchLabel": "切换至简体中文",
      "history.open": "Reading History",
      "announcement.open": "Announcements",
      "announcement.kicker": "PUBLIC ANNOUNCEMENTS",
      "announcement.title": "Announcements",
      "announcement.closeLabel": "Close announcements",
      "announcement.listAria": "Announcement list",
      "announcement.empty": "No announcements.",
      "announcement.cached": "Showing the most recently cached announcements.",
      "announcement.severity.info": "Info",
      "announcement.severity.important": "Important",
      "announcement.severity.update": "Update",
      "announcement.openAction": "Learn more",
      "announcement.updateAction": "View update",
      "settings.title": "Advanced setup",
      "settings.theme": "Theme",
      "settings.themeAria": "Choose an interface theme",
      "theme.celestial": "Celestial Night",
      "theme.parchment": "Parchment Dawn",
      "theme.ember": "Ember Sanctum",
      "theme.grove": "Verdant Grove",
      "theme.groveLight": "Verdant Grove (Bright)",
    "theme.jade": "Jade Paper",
    "theme.dusk": "Dusk Violet",
    "theme.ash": "Ash",
    "theme.toggle": "Tap the moon to change theme", "egg.wake": "It opens its eyes", "egg.sleep": "It closes its eyes",
      "settings.deck": "Deck",
      "deck.tarotOption": "Tarot (Rider-Waite)",
      "deck.mystagogusOption": "Mystagogus",
      "deck.lxxxiOption": "LXXXI - The Magician's Deck",
      "settings.mode": "Orientation",
      "mode.upright": "Upright only",
      "mode.mixed": "Upright and reversed",
      "settings.layoutMode": "Layout",
      "settings.pageVersion": "Site version",
      "settings.useClassic": "Switch to classic",
      "settings.useModern": "Switch to the new version",
      "layout.preset": "Preset spread",
      "layout.freeform": "Free Board",
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
      "customSpread.open": "Design or import a spread",
      "customSpread.kicker": "SPREAD STUDIO",
      "customSpread.title": "Custom Spread Studio",
      "customSpread.closeLabel": "Close Custom Spread Studio",
      "customSpread.windowControls": "Studio window position",
      "customSpread.windowLeft": "Left",
      "customSpread.windowCenter": "Center",
      "customSpread.windowRight": "Right",
      "customSpread.windowLeftLabel": "Dock the studio to the left",
      "customSpread.windowCenterLabel": "Center the studio",
      "customSpread.windowRightLabel": "Dock the studio to the right",
      "customSpread.enterFullscreen": "Full screen",
      "customSpread.exitFullscreen": "Exit full screen",
      "customSpread.dragWindow": "Drag the title bar to move the studio freely",
      "customSpread.tabsAria": "Custom spread tools",
      "customSpread.libraryTab": "Custom spreads",
      "customSpread.designerTab": "Design",
      "customSpread.importTab": "Import code",
      "customSpread.libraryTitle": "Available custom spreads",
      "customSpread.new": "New design",
      "customSpread.libraryEmpty": "No custom spreads yet. Create one or import a share code.",
      "customSpread.name": "Spread name",
      "customSpread.description": "Purpose",
      "customSpread.columns": "Grid columns",
      "customSpread.rows": "Grid rows",
      "customSpread.deckScope": "Deck scope",
      "customSpread.deckScopeAny": "Any deck",
      "customSpread.deckScopeTarotOnly": "Tarot only",
      "customSpread.deckScopeNonTarotOnly": "Non-Tarot only",
      "customSpread.tarotMode": "Tarot draw mode",
      "customSpread.tarotModeMixed": "Mixed Major and Minor",
      "customSpread.tarotModeMajorOnly": "Major Arcana only",
      "customSpread.tarotModeMinorOnly": "Minor Arcana only",
      "customSpread.stackingMode": "Stacking method",
      "customSpread.stackingModeSingle": "Single card",
      "customSpread.stackingModeMajorMinor": "Major + Minor layers",
      "customSpread.preview": "Layout preview",
      "customSpread.previewAria": "Custom spread layout preview",
      "customSpread.previewEffect": "Draw effect preview",
      "customSpread.previewEffectTitle": "Draw effect preview",
      "customSpread.previewEffectClose": "Close draw effect preview",
      "customSpread.previewEffectAria": "Draw effect preview content",
      "customSpread.dragHint": "Drag a position onto a grid cell; all ten columns scale into view, and coordinates remain editable.",
      "customSpread.positions": "Positions",
      "customSpread.addPosition": "Add position",
      "customSpread.generateCode": "Generate share code",
      "customSpread.shareCode": "Share code",
      "customSpread.shareCodeAria": "Custom spread share code",
      "customSpread.copyCode": "Copy share code",
      "customSpread.downloadCode": "Save code file",
      "customSpread.importLabel": "Paste a share code",
      "customSpread.importAndUse": "Import and use",
      "customSpread.saveAndUse": "Save and use",
      "customSpread.useThisSession": "Use spread",
      "customSpread.androidPrivacy": "Custom spreads stay only in this app on this device. No account, cloud sync, or network is used. Uninstalling or clearing app data removes them, so keep a share-code backup.",
      "customSpread.webPrivacy": "This browser remembers the last opened spread, including a custom spread. Other custom spreads last only for this session; copy their share codes or save text files to keep them.",
      "customSpread.group": "Custom spreads",
      "customSpread.cardCount": "{count} positions",
      "customSpread.noDescription": "No purpose provided",
      "customSpread.use": "Use",
      "customSpread.edit": "Edit",
      "customSpread.delete": "Delete",
      "customSpread.positionNumber": "Position {number}",
      "customSpread.positionName": "Position name",
      "customSpread.positionMeaning": "Position meaning",
      "customSpread.column": "Column",
      "customSpread.row": "Row",
      "customSpread.drawRule": "Draw rule",
      "customSpread.drawRuleFollowing": "Follow spread",
      "customSpread.drawRuleMajor": "Major Arcana only",
      "customSpread.drawRuleMinor": "Minor Arcana only",
      "customSpread.drawRuleWands": "Wands",
      "customSpread.drawRuleCups": "Cups",
      "customSpread.drawRuleSwords": "Swords",
      "customSpread.drawRulePentacles": "Pentacles",
      "customSpread.stackOn": "Stack on",
      "customSpread.stackOnNone": "Do not stack",
      "customSpread.stackOnPrevious": "Stack on position {number}",
      "customSpread.rotation": "Position rotation",
      "customSpread.rotateLeft": "Rotate left 45°",
      "customSpread.rotateRight": "Rotate right 45°",
      "customSpread.previewMajorLayer": "Major layer",
      "customSpread.previewMinorLayer": "Minor layer",
      "customSpread.previewCardLayer": "Single-card layer",
      "customSpread.moveUp": "Move up",
      "customSpread.moveDown": "Move down",
      "customSpread.removePosition": "Remove position",
      "customSpread.previewPosition": "Position {number}: {name}",
      "customSpread.unnamedPosition": "Unnamed",
      "customSpread.codeReady": "Share code generated. Copy it or save it as a text file.",
      "customSpread.invalidDefinition": "The spread is incomplete or exceeds a limit. Check its name, grid, and every position.",
      "customSpread.savedAndroid": "The spread is saved on this device and ready for a reading.",
      "customSpread.savedWeb": "The spread is ready. This browser remembers your last opened spread.",
      "customSpread.importedAndroid": "The share code was imported and saved on this device.",
      "customSpread.importedWeb": "The spread was imported and activated. This browser remembers your last opened spread.",
      "customSpread.invalidCode": "The share code is invalid, damaged, unsupported, or exceeds a limit.",
      "customSpread.storageFailed": "Local storage could not be written. The spread was not saved; keep its share code and check available space.",
      "customSpread.libraryFull": "This device can keep up to {limit} custom spreads at once. Delete one before saving or importing another.",
      "customSpread.capacityKicker": "DECK CAPACITY",
      "customSpread.capacityTitle": "The current filter has too few cards",
      "customSpread.capacityMessage": "This spread needs {positions} cards, but Major Arcana only has {available}. Switch to the full Tarot deck and continue?",
      "customSpread.keepFilter": "Keep current filter",
      "customSpread.switchFullDeck": "Switch and use",
      "customSpread.deleteKicker": "LOCAL SPREAD",
      "customSpread.deleteTitle": "Delete custom spread?",
      "customSpread.deleteMessage": "Delete “{name}”? If it is active, the current reading will also be cleared.",
      "customSpread.keep": "Keep spread",
      "customSpread.deleted": "Custom spread deleted.",
      "customSpread.copied": "Share code copied.",
      "customSpread.copyFailed": "Automatic copy is unavailable. Select the share code and copy it manually.",
      "customSpread.downloadFailed": "This environment cannot save the code file. Copy the share code instead.",
      "customSpread.downloaded": "The share-code file is being saved.",
      "deck.heading": "Deck",
    "table.title": "Table",
    "table.dragHint": "Drag to browse the deck · tap a card",
    "spread.settings": "Spread settings",
    "spread.settingsClose": "Close spread settings",
      "deck.initialRemaining": "78 remaining",
      "deck.shuffle": "Shuffle",
      "deck.shuffleHold": "Hold to keep shuffling; release when ready",
      "deck.shuffleRelease": "Release to collect",
    "deck.prev": "Previous card",
    "deck.next": "Next card",
      "deck.initialCta": "Tap any card in the ring to draw it into the spread",
      "deck.initialAria": "Circular card deck. Tap a card to draw.",
      "deck.switch": "Switch card pool",
      "spread.initialTitle": "Your Spread",
      "spread.initialCount": "0 / 3",
      "spread.reveal": "Reveal all",
      "spread.clear": "Shuffle Again",
      "spread.hint": "Tap a card to reveal it, or choose “Reveal & Interpret” to turn over every card. After revealing, tap a card again to view its meaning.",
      "spread.guide": "Position guide",
      "spread.gridAria": "Drawn cards arranged in the selected spread",
      "results.title": "Reading",
      "history.kicker": "LOCAL HISTORY",
      "history.title": "Reading History",
      "history.closeLabel": "Close reading history",
      "history.privacy": "Your readings stay in this browser. Clearing site data, using private browsing, changing devices, or changing browsers may remove them. Export a JSON backup if needed. This site does not upload, track, or collect your reading history.",
      "history.notesTitle": "Reading notes",
      "history.sourcesAndCredits": "Sources and credits",
      "history.credit.tarot": "Interpretations draw on Josephine McCarthy’s [Tarot Skills for the 21st Century]({url}) and Quareia training materials.",
      "history.credit.mystagogus": "Josephine McCarthy, [Mystagogus – The Deck Book]({url}).",
      "history.credit.lxxxi": "Josephine McCarthy, [LXXXI – The Magician’s Deck: A Guide to the Card Meanings]({url}), second edition.",
      "history.keywords": "Keywords",
      "history.meaningUnavailable": "Card meaning unavailable.",
      "notes.library": "Card notes",
      "notes.search": "Search cards or notes",
      "notes.onlySaved": "Only cards with notes",
      "notes.back": "Back",
      "notes.text": "Personal note",
      "notes.open": "Notes",
      "notes.editFor": "Read or edit notes for {name}",
      "notes.hasNote": "Has notes",
      "notes.export": "Export notes JSON",
      "notes.import": "Import notes JSON",
      "notes.local": "Notes save automatically on this device. Export a backup before switching devices or clearing data.",
      "notes.loading": "Loading…",
      "notes.autoSave": "Saves automatically on this device",
      "notes.saved": "Saved on this device",
      "notes.saving": "Saving…",
      "notes.noMatches": "No matching cards.",
      "notes.noNotes": "No notes yet. Turn off the filter to choose a card.",
      "notes.loadFailed": "Could not read notes on this device. Try again.",
      "notes.saveFailed": "Could not save. Your draft is still here to copy or retry.",
      "notes.conflict": "This note changed in another window. Copy your draft before loading the saved version.",
      "notes.reload": "Load saved version",
      "notes.retry": "Retry",
      "notes.discard": "Discard unsaved changes",
      "notes.emptyEditor": "Write or paste your study notes…",
      "notes.imported": "Imported {imported}. Kept {skipped} existing notes.",
      "notes.badBackup": "Import failed. Choose a valid card notes JSON backup.",
      "notes.exported": "Notes backup exported.",
      "notes.exportFailed": "Could not export the notes backup. Try again.",
      "notes.choosing": "Choose where to save the notes backup.",
      "notes.cancelled": "Backup export cancelled.",
      "history.exportBusy": "Finish the current file export first.",
      "history.question": "Reading question",
      "history.addQuestion": "Add a question",
      "history.editQuestion": "Edit question",
      "history.optionalQuestion": "What would you like to ask? (optional)",
      "history.saveQuestion": "Save question",
      "history.cancel": "Cancel",
      "history.questionSaved": "Question saved.",
      "history.questionFailed": "Could not save the question. Please try again.",
      "history.search": "Search questions, spreads or cards",
      "history.noMatches": "No matching readings.",
      "history.selectReadings": "Select readings",
      "history.cancelSelection": "Cancel selection",
      "history.exportNotes": "Export Markdown",
      "history.exportSelected": "Export Markdown ({count})",
      "history.fileDownloaded": "Downloaded {fileName}.",
      "history.fileSaved": "Saved {fileName}.",
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
      "footer.srcTarotTag": "Tarot",
      "footer.srcTarot": "Meanings follow Tarot Skills for the 21st Century and the Quareia context",
      "footer.srcMTag": "M deck",
      "footer.srcM": "Keywords translated from Mystagogus by Josephine McCarthy",
      "footer.srcLxxxiTag": "LXXXI",
      "footer.srcLxxxi": "Meanings follow its English companion text",
      "footer.funNote": "For entertainment only — read the cards with a level head.",
      "attribution.status": "This is an unofficial tool and does not imply endorsement by Quareia or the authors. Written permission covers the website and Android application, with a 2026-08-05 extension for the WeChat Mini Program. The non-commercial restriction applies only to Mystagogus/LXXXI artwork, meanings, translations, layouts, and related authorised material. Those materials may not be sold, placed behind a paywall or paid unlock, separately commercially distributed, sublicensed, or placed under a software licence; commercial use requires separate permission. This is not a general commercial-use ban on project-authored software, infrastructure, or unrelated services, and it does not claim approval of any particular commercial model.",
      "attribution.mystagogusLabel": "Mystagogus artwork and related text",
      "attribution.mystagogusRights": "© Josephine McCarthy",
      "attribution.lxxxiLabel": "LXXXI Magician's Deck artwork and related text",
      "attribution.lxxxiRights": "© Josephine McCarthy, Stuart Littlejohn, and Cassandra Beanland",
      "attribution.quareiaLink": "Official Quareia website",
      "attribution.quoteCite": "— Josephine McCarthy",
      "attribution.quoteZh": "(Chinese reference translation is shown on the Chinese interface; the English original is authoritative.)",
      "privacy.analytics": "This site uses an anonymous browser identifier to combine visits, active browsers, completed readings, AI model IDs / token usage / conversation rounds, and coarse country/region statistics with mobile statistics; you can turn this off at any time. Cloudflare Web Analytics separately measures traffic and performance. It does not collect email addresses, reading questions, card results, or locally stored history.",
      "privacy.telemetryDisable": "Turn off unified usage statistics",
      "privacy.telemetryEnable": "Turn on unified usage statistics",
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
      "app.deckAria.tarot": "Tarot deck. Tap a card to draw.",
      "app.deckAria.mystagogus": "Mystagogus deck. Tap a card to draw.",
      "app.deckAria.lxxxi": "LXXXI deck. Tap a card to draw.",
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
  "app.meaningClose": "Close",
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
      "app.emptySpreadHint": "Dashed boxes show empty positions in the selected spread. Tap any card in the deck above to place it.",
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
      "confirm.shuffle": "Shuffling again clears the cards on the table. Continue?",
      "confirm.layout": "Changing layouts will clear unsaved card content. Continue?",
      "confirm.freeBoardDiscard": "Discard the Free Board draft and clear the board? This cannot be undone.",
      "confirm.freeBoardShuffle": "Reshuffling clears the Free Board and changes the pile order. Continue?",
      "confirm.kicker": "SPREAD CHANGE",
      "confirm.title": "Your current spread is still here",
      "confirm.cancel": "Keep Spread",
      "confirm.keep": "Keep", "confirm.proceed": "Clear & shuffle",
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
      "history.actualLayout": "Actual Layout",
      "history.hideActualLayout": "Hide Actual Layout",
      "history.actualLayoutAria": "Actual spread layout",
      "history.actualLayoutHint": "Reconstructed from the recorded positions. Tap any card to flip to its meaning, and tap again to return.",
      "history.unavailableSave": "This browser cannot save history. Divination remains available.",
      "history.unavailable": "This browser cannot access IndexedDB, so history is unavailable. Divination is unaffected.",
      "history.saveSnapshotError": "Automatic save failed. Your reading is still available on this page.",
      "history.saving": "Saving this reading automatically…",
      "history.saveUnavailable": "Automatic save failed because local history is unavailable in this browser.",
      "history.duplicate": "This complete reading was just saved, so no duplicate was created.",
      "history.saved": "Reading revealed and saved automatically in this browser.",
      "history.deleted": "Reading deleted.",
      "history.deleteFailed": "Could not delete the reading. Please try again.",
      "history.deleteConfirm": "Delete this saved reading? This cannot be undone.",
      "history.clearConfirm": "Clear all reading history in this browser? This cannot be undone.",
      "history.confirmKicker": "LOCAL HISTORY",
      "history.confirmTitle": "Delete reading history?",
      "history.confirmCancel": "Keep Records",
      "history.confirmProceed": "Delete",
      "history.cleared": "All reading history has been cleared.",
      "history.clearFailed": "Could not clear history. Please try again.",
      "history.exported": "JSON backup downloaded: {fileName}. Check the browser downloads list or Downloads folder.",
      "history.exportChoosing": "Opening the save location. Choose a folder in the system dialog for {fileName}.",
      "history.exportedTo": "JSON backup saved as {fileName} in the folder you selected.",
      "history.exportCancelled": "Export cancelled. Your history was not changed.",
      "history.exportFailed": "Could not export history. Please try again.",
      "history.imported": "Imported {count} reading(s).",
      "history.remapped": " Safely reassigned {count} duplicate ID(s).",
      "history.importFailed": "Import failed: the file format is invalid or its contents are damaged.",
      "freeBoard.settingsSummary": "Free Board: draw any card from the current deck and filter; there are no fixed positions or target count.",
      "freeBoard.title": "Free Board",
      "freeBoard.open": "Free board",
      "freeBoard.backToPreset": "Return to preset spread",
      "freeBoard.openHint": "The deck fans out on the table with no spread applied.", "freeBoard.cardHiddenAria": "Card {index}, face down", "freeBoard.cardAria": "Card {index}, {name}, {orientation}", "freeBoard.slotName": "Free slot",
  "freeBoard.angleTitle": "Angle", "freeBoard.drawnAria": "Drawn cards",
      "freeBoard.toolbarAria": "Free Board controls",
      "freeBoard.undo": "Undo",
      "freeBoard.undoAria": "Undo the last Free Board action",
      "freeBoard.redo": "Redo",
      "freeBoard.redoAria": "Redo the last Free Board action",
      "freeBoard.revealAll": "Reveal all",
      "freeBoard.revealAllAria": "Reveal every card on the Free Board",
      "freeBoard.resetView": "Reset view",
      "freeBoard.resetViewAria": "Reset Free Board pan and zoom",
      "freeBoard.shuffle": "Shuffle",
      "freeBoard.shuffleAria": "Clear the Free Board and reshuffle the pile",
      "freeBoard.clearAndDiscard": "Clear board and discard draft",
      "freeBoard.clearAndDiscardAria": "Clear the Free Board and delete its saved draft",
      "freeBoard.boardAria": "Free Board. Drag the board or cards; pinch or wheel to zoom.",
      "freeBoard.worldAria": "Cards on the Free Board",
      "freeBoard.selectedControlsAria": "Selected card controls",
      "freeBoard.pileTitle": "Face-down pile",
      "freeBoard.pileAria": "Free Board face-down pile. Choose any card.",
      "freeBoard.drawAria": "Face-down pile card {index} of {count}. Tap to draw to the Free Board.",
      "freeBoard.faceDown": "Face down",
      "freeBoard.meaning": "Meaning",
      "freeBoard.revealed": "Revealed",
      "freeBoard.unrevealed": "Not revealed",
      "freeBoard.selectedControls": "Selected: {card}",
      "freeBoard.drawOrder": "Position {order}",
      "freeBoard.cardsDrawn": "{count} placed",
      "freeBoard.remaining": "{count} remaining",
      "freeBoard.status": "{cards} placed · {remaining} remaining",
      "freeBoard.hint": "Double tap a card in the fan to drop it on the board; drag a card to move it; press and hold a card to turn it. Use Reveal all when you are ready to read the cards.",
      "freeBoard.rotateMinus15": "−15°",
      "freeBoard.rotateMinus15Aria": "Rotate the selected card counter-clockwise by 15 degrees",
      "freeBoard.rotatePlus15": "+15°",
      "freeBoard.rotatePlus15Aria": "Rotate the selected card clockwise by 15 degrees",
      "freeBoard.rotateMinus90": "−90°",
      "freeBoard.rotateMinus90Aria": "Rotate the selected card counter-clockwise by 90 degrees",
      "freeBoard.rotatePlus90": "+90°",
      "freeBoard.rotatePlus90Aria": "Rotate the selected card clockwise by 90 degrees",
      "freeBoard.bringFront": "Bring to front",
      "freeBoard.bringFrontAria": "Bring the selected card to the front",
      "freeBoard.showMeaning": "Show meaning",
      "freeBoard.showMeaningAria": "Show the meaning for the selected revealed card",
      "freeBoard.hideMeaning": "Show card face",
      "freeBoard.hideMeaningAria": "Return to the selected card face",
      "freeBoard.remove": "Remove / return to pile",
      "freeBoard.removeAria": "Remove the selected card and return it to the face-down pile",
      "freeBoard.draftInvalid": "The saved Free Board draft was invalid and was safely ignored.",
      "freeBoard.draftSaveFailed": "Could not save the Free Board draft; the current board is still available.",
      "freeBoard.draftDiscarded": "The Free Board draft was discarded.",
      "freeBoard.saving": "Saving Free Board history automatically…",
      "freeBoard.saved": "Free Board saved to divination history automatically.",
      "freeBoard.duplicate": "This Free Board was just saved; no duplicate was created.",
      "freeBoard.saveFailed": "Could not save Free Board history; the board remains on this page.",
      "freeBoard.saveUnavailable": "This browser cannot save history; the Free Board remains available.",
      "history.freeBoard": "Free Board",
      "history.freeBoardDetail": "Free Board record",
      "history.freeBoardPreview": "Read-only Free Board spatial reconstruction",
      "history.freeBoardHidden": "Face down (not revealed)",
      "history.freeBoardRevealed": "Revealed · {orientation}",
      "history.freeBoardCardState": "{card} · {state}",
      "history.savingFreeBoard": "Saving Free Board history…",
      "history.savedFreeBoard": "Free Board saved to this browser's divination history.",
      "history.duplicateFreeBoard": "This Free Board was just saved; no duplicate was created.",
      "history.openInAi": "Open in AI",
      "privacy.ai": "API keys and chats stay on this device; requests go directly to your configured model endpoint. When anonymous usage statistics are enabled, we report model IDs, provider-reported token usage, and conversation rounds. The backend never receives keys, endpoint URLs, questions, or answers.",
      "ai.open": "AI Reading",
      "ai.pageTitle": "AI Assisted Reading · Quareia Divination",
      "ai.title": "AI Assisted Reading",
      "ai.subtitle": "Grounded in In-App Card Meanings · Preset Readings Only",
      "ai.chatsMenu": "Chats",
      "ai.sidebarToggleAria": "Open conversation list",
      "ai.sidebarAria": "AI chat history",
      "ai.backToReading": "Back to Reading",
      "ai.settingsOpen": "API Settings",
      "ai.newChat": "+ New Chat",
      "ai.searchPlaceholder": "Search titles, questions, or messages",
      "ai.untitledChat": "Untitled Chat",
      "ai.archivedBadge": "Archived",
      "ai.pickReadings": "+ Attach Readings",
      "ai.rename": "Rename",
      "ai.exportMd": "Export Markdown",
      "ai.archive": "Archive",
      "ai.unarchive": "Unarchive",
      "ai.delete": "Delete",
      "ai.pin": "Pin",
      "ai.unpin": "Unpin",
      "ai.pinned": "Pinned",
      "ai.exportBackup": "Export Backup",
      "ai.err.incomplete": "The connection ended before the response finished. Any received text has been kept. Retry or ask it to continue.",
      "ai.archiveTooLargeTitle": "Backup exceeds the import limit",
      "ai.archiveTooLargeMsg": "The JSON backup exceeds the 8 MiB import limit and cannot be restored here. You can instead export all transcripts, response notices and reading summaries as a readable Markdown archive. This archive cannot be imported into the chat list.",
      "ai.exportArchive": "Export Markdown Archive",
      "ai.storageMemoryWarning": "Chat storage is unavailable. This session is kept only in memory and will be lost when you reload or leave. Export a backup first.",
      "ai.importTooLarge": "AI chat backups must be 8 MiB or smaller. Choose a smaller backup file.",
      "ai.err.truncated": "The model reached its output limit, so the answer may be incomplete. Ask it to continue or increase the output token limit in API settings.",
      "ai.err.blocked": "The provider blocked this response under its content policy. Any received text has been kept. Revise your question and retry.",
      "ai.err.invalidResponse": "The endpoint returned an invalid response. Check its URL or proxy service: {detail}",
      "ai.importBackup": "Import Backup",
      "ai.clearArchived": "Clear Archived",
      "ai.clearActive": "Clear Active",
      "ai.tabActiveCount": "Active ({count})",
      "ai.tabArchivedCount": "Archived ({count})",
      "ai.noMatchingChats": "No matching conversations.",
      "ai.noArchivedChats": "No archived conversations.",
      "ai.noActiveChats": "No conversations yet. Start a new chat above.",
      "ai.chatMetaSummary": "{readings} readings · {messages} msgs",
      "ai.promptPlaceholder": "Ask about your reading (Enter to send, Shift+Enter for newline)",
      "ai.medicalNoticeTitle": "Medical notice (app text, not an AI response)",
      "ai.medicalNoticeBody": "Card meanings and AI readings cannot confirm illness, assess its severity, or predict spontaneous recovery. They do not replace medical diagnosis, tests, or treatment. Do not delay care, stop medication, or change treatment based on a reading; consult a medical professional about health concerns.",
      "ai.disclaimer": "Disclaimer: AI readings may be inaccurate and are for personal reflection and reference only. They do not establish facts or guarantee future outcomes, and do not replace qualified medical, mental health, legal, or financial advice. For health, safety, or other important decisions, verify real-world information and consult a qualified professional.",
      "ai.send": "Send",
      "ai.stop": "Stop",
      "ai.pickerTitle": "Attach Readings (Non-Freeboard Only)",
      "ai.pickerHint": "Multi-select supported (freeform excluded). Cards show a concise summary here while spread positions, stacking links, and in-app card meanings are injected accurately.",
      "ai.pickerSearchPlaceholder": "Filter by question, spread, or card",
      "ai.deckAll": "All Decks",
      "ai.pickerClear": "Clear",
      "ai.pickerApplyCount": "Attach Selected ({count})",
      "ai.pickerEmpty": "No matching non-freeboard readings found. Complete and save a preset or custom spread reading first.",
      "ai.renameTitle": "Rename Chat",
      "ai.renameLabel": "Conversation Title",
      "ai.save": "Save",
      "ai.cancel": "Cancel",
      "ai.close": "Close",
      "ai.ok": "OK",
      "ai.settingsTitle": "Model Endpoint & API Key Settings",
      "ai.newProfile": "+ New Profile",
      "ai.deleteProfile": "Delete Profile",
      "ai.newProfileDefaultName": "New Profile",
      "ai.lockedPromptNote": "The system prompt and built-in Quareia reading skills engine are locked (auto-mounting spread circuitry and deck craft without manual-parroting), cannot be edited, and never block normal non-divination chat.",
      "ai.presetLabel": "Quick fill",
      "ai.preset.deepseekFlash": "DeepSeek Flash",
      "ai.preset.deepseekPro": "DeepSeek V4 Pro",
      "ai.presetApplied": "Filled {preset}; confirm the API key for this endpoint, then save.",
      "ai.fieldName": "Profile Name",
      "ai.fieldFormat": "API Format",
      "ai.fieldBaseUrl": "Base URL (Endpoint or Proxy)",
      "ai.fieldApiKey": "Static API Key (Stored Locally Only)",
      "ai.fieldModel": "Model ID",
      "ai.fieldVertexProject": "Vertex Project ID (Optional for Express Mode)",
      "ai.fieldVertexLocation": "Vertex Location (e.g. global or us-central1)",
      "ai.fieldTemperature": "Temperature (Optional, 0–2)",
      "ai.fieldMaxTokens": "Max Tokens (Optional)",
      "ai.fieldContextWindow": "Model Context Window (Tokens, blank for auto)",
      "ai.contextWindowPlaceholder": "Auto-detect model context window",
      "ai.contextWindowAutoPlaceholder": "Auto ({count} tokens)",
      "ai.detectContextWindow": "Auto Detect",
      "ai.detectingContext": "Detecting model context window…",
      "ai.detectContextDone": "Context window fetched from API: {count} tokens",
      "ai.detectContextCatalog": "The API did not return a context limit. Using the model catalog: {count} tokens. Proxy limits may differ; you can override this manually.",
      "ai.detectContextUnknown": "Could not identify this model's context window. Using {count} tokens ({source}); enter the provider's limit manually.",
      "ai.detectContextChanged": "Configuration changed. Detect the context window again.",
      "ai.contextWindowStatus": "Active window: {count} tokens ({source})",
      "ai.contextSource.manual": "Manual",
      "ai.contextSource.api": "Fetched from API",
      "ai.contextSource.catalog": "Matched from catalog",
      "ai.contextSource.default": "Default estimate",
      "ai.fieldAutoCompress": "Auto-compress earlier context",
      "ai.autoCompressHint": "Automatically summarizes earlier turns before reaching the model context limit while keeping attached card meanings and recent turns intact.",
      "ai.contextMeter": "Context ~{used} / {limit} tokens ({source})",
      "ai.contextMeterCompressed": " · {count} earlier compressed",
      "ai.compressingStatus": "Compressing earlier messages to preserve context…",
      "ai.testConnection": "Test Connection",
      "ai.saveActivate": "Save & Activate",
      "ai.profileUnconfigured": "API Key not set",
      "ai.banner.needBoth": "Configure an API key first. Optionally attach non-freeboard readings for interpretation, or chat freely on any topic.",
      "ai.banner.needKey": "No active API key configured yet. Open API Settings to add your key and test the connection.",
      "ai.banner.needReading": "No readings attached: you can chat normally on any topic, or attach non-freeboard readings for in-app card interpretation.",
      "ai.noAttachedReadings": "No readings attached (freeform records excluded)",
      "ai.readingSnapshotSaved": "Saved snapshot",
      "ai.readingDeleted": "Removed from local history",
      "ai.removeReading": "Remove reading",
      "ai.emptyHeading": "AI Assisted Reading",
      "ai.emptyDesc": "Attach one or more non-freeboard readings to auto-mount Quareia spread topology and deck skills (synthesizing dynamic patterns rather than reciting a manual). Optionally add your question on the card chip above, or pick a starter:",
      "ai.roleUser": "You",
      "ai.reasoningSummary": "Reasoning Summary",
      "ai.saveAndResend": "Save & Resend",
      "ai.retry": "Retry",
      "ai.copy": "Copy",
      "ai.copied": "Copied",
      "ai.editResend": "Edit & Resend",
      "ai.regenerate": "Regenerate",
      "ai.showKey": "Show",
      "ai.hideKey": "Hide",
      "ai.format.openaiChat": "OpenAI Chat Completions (/v1/chat/completions)",
      "ai.format.openaiResponses": "OpenAI Responses API (/v1/responses)",
      "ai.format.anthropic": "Anthropic Messages (/v1/messages)",
      "ai.format.geminiStudio": "Google Gemini AI Studio",
      "ai.format.geminiVertex": "Google Gemini Vertex AI (Static API Key)",
      "ai.hint.openaiChat": "Compatible with OpenAI, DeepSeek, OpenRouter, and /v1/chat/completions proxies using Authorization: Bearer.",
      "ai.hint.openaiResponses": "Uses OpenAI Responses API (/v1/responses) with instructions and input payload fields.",
      "ai.hint.anthropic": "Uses Anthropic Messages (/v1/messages) with x-api-key, anthropic-version, and browser direct-access header.",
      "ai.hint.geminiStudio": "Uses Google AI Studio API Key via x-goog-api-key against generativelanguage.googleapis.com.",
      "ai.hint.geminiVertex": "Static API key only (x-goog-api-key); no OAuth login. Leave Project ID blank for Express Mode, or set Project ID & Location for regional endpoints.",
      "ai.err.missingKey": "API Key is required",
      "ai.err.missingModel": "Model name is required",
      "ai.err.insecureUrl": "Base URL must use https:// (except localhost)",
      "ai.err.invalidUrl": "Invalid Base URL",
      "ai.settingsSaved": "Configuration saved and activated.",
      "ai.testingConnection": "Testing connection…",
      "ai.testSuccess": "Connection succeeded ({model}). Ready to save.",
      "ai.err.unknown": "Request failed",
      "ai.err.auth": "Authentication failed. Verify your API key and endpoint permissions: {detail}",
      "ai.err.rateLimit": "Rate limit or quota reached: {detail}",
      "ai.err.network": "Network or CORS error. Check connectivity, HTTPS Base URL, or proxy CORS headers: {detail}",
      "ai.stoppedEmpty": "Generation stopped.",
      "ai.confirmKicker": "AI CHAT",
      "ai.deleteChatTitle": "Delete this conversation?",
      "ai.deleteChatMsg": "All messages in \"{title}\" will be permanently removed.",
      "ai.clearArchivedTitle": "Clear all archived chats?",
      "ai.clearAllTitle": "Clear all active chats?",
      "ai.clearArchivedMsg": "This permanently deletes all archived chats while keeping active ones.",
      "ai.clearAllMsg": "This deletes all active conversations. Consider exporting a JSON backup first.",
      "ai.clearConfirm": "Clear",
      "ai.deleteMsgTitle": "Delete this message?",
      "ai.deleteMsgDesc": "Remove this message from local chat history?",
      "ai.backupKicker": "AI BACKUP",
      "ai.importDoneTitle": "Import Complete",
      "ai.importDoneMsg": "Merged {imported} conversations ({total} total).",
      "ai.importErrTitle": "Import Failed",
      "ai.importErrMsg": "Invalid backup file format. Choose an AI chat JSON backup exported from this app.",
      "ai.pageDescription": "AI-assisted divination workspace grounded in Quareia in-app card meanings and preset spread history.",
      "ai.contextBarAria": "Active conversation and reading context",
      "ai.deckTarot": "Quareia Tarot",
      "ai.clearConfig": "Clear Saved Keys",
      "ai.clearConfigTitle": "Clear all saved API keys?",
      "ai.clearConfigMsg": "This removes all saved model profiles and API keys from this device without deleting your AI chat history.",
      "ai.clearConfigConfirm": "Clear Keys",
      "ai.configCleared": "All locally saved API keys and model settings have been cleared.",
      "ai.exportedTo": "Exported: {fileName}",
      "ai.exportCancelled": "Export cancelled.",
      "ai.exportFailed": "Export failed. Please try again.",
      "ai.chatChangedTitle": "Conversation Updated",
      "ai.chatChangedMsg": "Another tab changed this conversation. The latest messages have been loaded; review them and retry.",
      "ai.saveFailedTitle": "Save Failed",
      "ai.saveFailedMsg": "Could not save the conversation. Check available storage and retry.",
      "ai.skillModeLabel": "Reader",
      "ai.skillModeAria": "Choose the AI reading persona",
      "ai.skillMode.auto": "Olivia",
      "ai.skillModeHint.auto": "Built-in persona: tarot counselor with an NVC backbone",
      "ai.activeSkillsLabel": "Active Skills",
      "ai.activeSkillsNone": "Free chat (attach a reading to auto-mount Quareia skills)",
      "ai.questionPrefix": "Question: ",
      "ai.questionAdd": "+ Add question context",
      "ai.questionEdit": "Edit question",
      "ai.questionPlaceholder": "Add what you asked and the timeframe (e.g. Changing jobs in the next 3 months)",
      "ai.starter.core": "Give me the straight verdict: what is the most central tension and momentum here?",
      "ai.starter.action": "Briefly anchor what is stable on the board, then dig into the blind spots and key levers I haven't noticed.",
      "ai.starter.compare": "Across the attached readings, trace how the underlying pattern has shifted and which pressures are easing or intensifying."
    }
  };

  if (global.QuareiaClassicMessages) {
    supported.forEach(function (lang) {
      Object.assign(messages[lang], global.QuareiaClassicMessages[lang]);
    });
  }

  function readStoredLocale() {
    try {
      var value = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      return supported.indexOf(value) !== -1 ? value : DEFAULT_LOCALE;
    } catch (_error) {
      return DEFAULT_LOCALE;
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

  function field(value, key) {
    if (!value) return "";
    if (locale === "en") return value[key + "En"] || value[key] || "";
    return value[key] || value[key + "En"] || "";
  }

  function applyDocument() {
    if (!global.document) return;
    var document = global.document;
    document.documentElement.lang = locale;
    var isAiPage = Boolean(document.body && document.body.classList && document.body.classList.contains("ai-chat-page"));
    document.title = t(isAiPage ? "ai.pageTitle" : "page.title");
    var description = document.querySelector('meta[name="description"]');
    if (description) {
      var descKey = description.getAttribute("data-i18n-content") || (isAiPage ? "ai.pageDescription" : "page.description");
      description.setAttribute("content", t(descKey));
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (element) {
      element.textContent = t(element.getAttribute("data-i18n"));
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-aria-label]"), function (element) {
      element.setAttribute("aria-label", t(element.getAttribute("data-i18n-aria-label")));
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-title]"), function (element) {
      element.setAttribute("title", t(element.getAttribute("data-i18n-title")));
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

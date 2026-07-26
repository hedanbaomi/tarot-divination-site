function getDeckByArcanaFilter(filter, phase) {
  var majors = tarotDeckFull.filter(function (c) { return c.arcana === "major"; });
  var minors = tarotDeckFull.filter(function (c) { return c.arcana === "minor"; });

  switch (filter) {
    case "major-only":
      return majors;
    case "minor-only":
      return minors;
    case "major-then-minor":
      return phase === "minor" ? minors : majors;
    case "minor-then-major":
      return phase === "major" ? majors : minors;
    default:
      return tarotDeckFull.slice();
  }
}

function getOtherPhaseLabel(filter, currentPhase) {
  if (filter === "major-then-minor") {
    return currentPhase === "major" ? "切换到小阿卡那" : "切回大阿卡那";
  }
  if (filter === "minor-then-major") {
    return currentPhase === "minor" ? "切换到大阿卡那" : "切回小阿卡那";
  }
  return "";
}

function isPhaseFilter(filter) {
  return filter === "major-then-minor" || filter === "minor-then-major";
}

function getPhaseArcanaLabel(filter, phase) {
  if (filter === "major-then-minor") {
    return phase === "major" ? "大阿卡那" : "小阿卡那";
  }
  if (filter === "minor-then-major") {
    return phase === "minor" ? "小阿卡那" : "大阿卡那";
  }
  return "";
}

// Chapter 6 spread catalogue. Coordinates use a compact CSS grid so the same
// definitions drive both automatic card placement and the position legend.
// name = Chinese display name; nameEn = English display name.
function spreadPosition(number, name, nameEn, meaning, column, row, options) {
  var position = {
    number: number,
    name: name,
    nameEn: nameEn,
    meaning: meaning,
    column: column,
    row: row
  };
  Object.keys(options || {}).forEach(function (key) { position[key] = options[key]; });
  return position;
}

function formatPositionName(position, style) {
  if (!position) return "";
  var zh = position.name || "";
  var en = position.nameEn || "";
  if (!en) return zh;
  if (style === "slash") return zh + " / " + en;
  if (style === "paren") return zh + "（" + en + "）";
  return zh + " · " + en;
}

function isOverviewStackingMode(deckType, spreadId, method) {
  return deckType === "tarot" && spreadId === "overview" && method === "stacked";
}

function getNextOverviewStackingSlot(entries, positionCount, layer) {
  var used = {};
  (entries || []).forEach(function (entry) {
    if (entry.layer === layer) used[entry.slotIndex] = true;
  });
  for (var i = 0; i < positionCount; i++) {
    if (!used[i]) return i;
  }
  return -1;
}

function getOverviewStackingPhase(entries, positionCount) {
  if (getNextOverviewStackingSlot(entries, positionCount, "major") !== -1) return "major";
  if (getNextOverviewStackingSlot(entries, positionCount, "minor") !== -1) return "minor";
  return "complete";
}

function getOverviewStackingState(entries, positionCount) {
  var status = getOverviewStackingPhase(entries, positionCount);
  return {
    status: status,
    activeLayer: status === "major" ? "major" : "minor",
    complete: status === "complete",
    targetCount: positionCount * 2
  };
}

function getAvailableOverviewStackingCards(cards, entries, layer) {
  var usedIds = {};
  (entries || []).forEach(function (entry) {
    if (entry.layer === layer && entry.card) usedIds[entry.card.id] = true;
  });
  return (cards || []).filter(function (card) { return !usedIds[card.id]; });
}

function cardMatchesDrawRule(card, rule) {
  if (!rule) return true;
  if (rule.arcana && card.arcana !== rule.arcana) return false;
  if (rule.suit && card.suit !== rule.suit) return false;
  return true;
}

function getAvailableCardsForDrawRule(cards, entries, rule) {
  var usedIds = {};
  (entries || []).forEach(function (entry) {
    if (entry.card) usedIds[entry.card.id] = true;
  });
  return (cards || []).filter(function (card) {
    return !usedIds[card.id] && cardMatchesDrawRule(card, rule);
  });
}

var tarotSpreads = [
  {
    id: "three-card-horizontal",
    name: "三张牌（横向）",
    category: "快速牌阵",
    description: "从左到右阅读过去、现在与未来。",
    source: "网站追加牌阵",
    columns: 3,
    rows: 1,
    positions: [
      spreadPosition(1, "过去", "Past", "影响当前问题的过去。", 1, 1),
      spreadPosition(2, "现在", "Present", "问题目前的状态与核心。", 2, 1),
      spreadPosition(3, "未来", "Future", "沿当前趋势最可能出现的未来。", 3, 1)
    ]
  },
  {
    id: "four-seasons",
    name: "四季牌阵",
    category: "季节牌阵",
    description: "用于春分、夏至、秋分或冬至，观察接下来一个季度的运势与需要注意之处；五个牌位分别限定为权杖、圣杯、宝剑、星币与大阿卡那。",
    source: "用户提供的四季牌阵参考图",
    requiresDeck: "tarot",
    columns: 3,
    rows: 3,
    positions: [
      spreadPosition(1, "行动／欲望／能量", "Action / Desire / Energy", "行动、欲望以及能量如何运用。", 1, 2, {
        drawRule: { suit: "权杖", label: "仅限权杖牌" }
      }),
      spreadPosition(2, "情感状态", "Emotional State", "这个季度的情感状态。", 2, 3, {
        drawRule: { suit: "圣杯", label: "仅限圣杯牌" }
      }),
      spreadPosition(3, "思维／理性／人际", "Mind / Reason / Relationships", "思维状态、理性判断与人际关系。", 3, 2, {
        drawRule: { suit: "宝剑", label: "仅限宝剑牌" }
      }),
      spreadPosition(4, "工作／物质／生活／健康", "Work / Material / Life / Health", "工作、物质条件、日常生活与健康。", 2, 1, {
        drawRule: { suit: "星币", label: "仅限星币牌" }
      }),
      spreadPosition(5, "季度关键点", "Seasonal Key", "整个季度的能量与灵性成长关键，以及需要学习和关注的地方。", 2, 2, {
        drawRule: { arcana: "major", label: "仅限大阿卡那" }
      })
    ]
  },
  {
    id: "yes-no",
    name: "简单的是/否布局",
    category: "世俗布局",
    description: "为清晰、聚焦的问题给出答案，并展示答案的来路。",
    source: "第六章，图 6.1",
    columns: 3,
    rows: 3,
    positions: [
      spreadPosition(1, "问题", "Question", "问题的内容。", 2, 2),
      spreadPosition(2, "相关的过去", "Related Past", "导致当前事件的经历。", 1, 1),
      spreadPosition(3, "困难", "Difficulties", "需要克服的困难。", 1, 3),
      spreadPosition(4, "帮助", "Help", "给予你的帮助。", 3, 3),
      spreadPosition(5, "未来的结果", "Future Outcome", "答案将导致什么。", 3, 1),
      spreadPosition(6, "答案", "Answer", "对聚焦问题的回答。", 2, 2, { offsetX: 16, offsetY: 34 })
    ]
  },
  {
    id: "tree-of-life",
    name: "生命之树布局",
    category: "世俗／神秘布局",
    description: "沿生命之树的创造模式，观察答案如何形成。",
    source: "第六章，图 6.2",
    columns: 3,
    rows: 7,
    positions: [
      spreadPosition(1, "故事主题", "Theme of the Story", "故事的主题是什么？", 2, 1),
      spreadPosition(2, "积极方面", "Active / Giving Aspect", "哪个积极或给予的方面帮助构建了故事？", 3, 2),
      spreadPosition(3, "隐藏／过去因素", "Hidden / Past Factors", "有哪些隐藏或过去的因素对故事产生影响？", 1, 2),
      spreadPosition(4, "发展条件", "Conditions for Development", "故事发展所需的条件是什么？", 3, 3),
      spreadPosition(5, "被隐瞒／剥夺", "Withheld / Taken Away", "故事中被隐瞒或正在被剥夺的内容是什么？", 1, 3),
      spreadPosition(6, "关键核心", "Key / Core", "故事的关键或核心要素是什么？", 2, 4),
      spreadPosition(7, "纪律／限制", "Discipline / Restriction", "成功需要哪些纪律或限制？也受到情绪影响。", 3, 5),
      spreadPosition(8, "放松／流动", "Relaxation / Flow", "需要放松以便顺畅流动的是什么？也受到思维影响。", 1, 5),
      spreadPosition(9, "原因／动力", "Cause / Driver", "答案背后的原因或动力是什么？", 2, 6),
      spreadPosition(10, "答案", "Answer", "答案是什么？", 2, 7)
    ]
  },
  {
    id: "overview",
    name: "概览布局",
    category: "世俗布局",
    description: "在设定时间段内，从十三个生活面向取得总体概览；可用单牌法，或先铺大阿卡那、再叠放小阿卡那的分牌法。",
    source: "第六章，图 6.3-6.4",
    supportsStacking: true,
    columns: 7,
    rows: 2,
    positions: [
      spreadPosition(1, "家庭／家", "Home / Family", "家、紧密社区、血脉与认同的起点。", 1, 1),
      spreadPosition(2, "关系", "Relationships", "爱情、亲密友谊与重要合作关系。", 2, 1),
      spreadPosition(3, "创造力", "Creativity", "孩子、艺术、设计或你创造并热爱的事物。", 3, 1),
      spreadPosition(4, "当前命运循环", "Current Fate Cycle", "当前所处的命运循环。", 4, 1),
      spreadPosition(5, "健康", "Health", "占卜时间范围内的整体健康。", 5, 1),
      spreadPosition(6, "礼物", "Gifts", "命运提供的帮助、资源、支持或保护。", 6, 1),
      spreadPosition(7, "冲突", "Conflict", "个人、人际、情境或自我造成的干扰。", 1, 2),
      spreadPosition(8, "隐藏的敌人", "Hidden Enemies", "未被看到的敌意、危险或威胁。", 2, 2),
      spreadPosition(9, "磨难", "Ordeal", "必须面对并从中获得力量或智慧的逆境。", 3, 2),
      spreadPosition(10, "资源", "Resources", "收入、能量、食物等可用资源。", 4, 2),
      spreadPosition(11, "解开者", "Unraveller", "需要识别并自愿放弃的弱点或事物。", 5, 2),
      spreadPosition(12, "夺取者", "Taker", "命运为推动你前进而将夺走的事物。", 6, 2),
      spreadPosition(13, "前方的道路", "Path Ahead", "时间范围内的整体短期未来与发展方向。", 7, 1, { rowSpan: 2 })
    ]
  },
  {
    id: "event",
    name: "事件布局",
    category: "世俗布局",
    description: "前瞻特定事件或行动选择将如何展开。",
    source: "第六章，图 6.5",
    columns: 3,
    rows: 5,
    positions: [
      spreadPosition(1, "当前情况", "Current Situation", "当前情况。", 2, 3),
      spreadPosition(2, "过去影响", "Past Influence", "过去对当前情况产生影响的因素。", 2, 5),
      spreadPosition(3, "触发原因", "Trigger", "触发当前情况的原因。", 1, 4),
      spreadPosition(4, "益处", "Benefit", "当前情况给你带来的益处。", 1, 2),
      spreadPosition(5, "带走之物", "What Is Taken", "当前情况带走了你什么。", 3, 2),
      spreadPosition(6, "如何展开", "How It Unfolds", "当前情况将如何展开。", 3, 4),
      spreadPosition(7, "结论", "Conclusion", "当前情况的结论。", 2, 1)
    ]
  },
  {
    id: "direction",
    name: "方向／位置布局",
    category: "世俗布局",
    description: "以指南针方向寻找失物或逐步缩小搜索范围。",
    source: "第六章，图 6.6",
    columns: 3,
    rows: 3,
    positions: [
      spreadPosition(1, "中心", "Centre", "搜索区域的中心。", 2, 2),
      spreadPosition(2, "东方", "East", "搜索区域的东方。", 3, 2),
      spreadPosition(3, "南方", "South", "搜索区域的南方。", 2, 3),
      spreadPosition(4, "西方", "West", "搜索区域的西方。", 1, 2),
      spreadPosition(5, "北方", "North", "搜索区域的北方。", 2, 1)
    ]
  },
  {
    id: "resources",
    name: "资源布局",
    category: "世俗布局",
    description: "观察外在、核心与内在资源的盈余、赤字和平衡。",
    source: "第六章，图 6.7",
    columns: 3,
    rows: 7,
    positions: [
      spreadPosition(1, "自我", "Self", "能量资源的整体状况。", 2, 4),
      spreadPosition(2, "平衡", "Balance", "管理能量资源的平衡程度。", 2, 1),
      spreadPosition(3, "生命力", "Vitality", "整体生命力。", 2, 7),
      spreadPosition(4, "爱与情感", "Love & Emotion", "情感稳定性与爱情关系。", 1, 6),
      spreadPosition(5, "金钱／物质／财产", "Money / Matter / Property", "经济与物质资源状况。", 1, 5),
      spreadPosition(6, "健康", "Health", "身体健康状况。", 1, 3),
      spreadPosition(7, "创造力", "Creativity", "创造性能量，包括怀孕的可能性。", 1, 2),
      spreadPosition(8, "沟通", "Communication", "给予和接收清晰沟通的能量。", 3, 2),
      spreadPosition(9, "直觉", "Intuition", "接触直觉、梦境与内心雷达的能量。", 3, 3),
      spreadPosition(10, "占卜", "Divination", "使用卡片、符文等清晰看见未来的能量。", 3, 5),
      spreadPosition(11, "魔法／神秘", "Magic / Mysteries", "学习魔法或探索神秘面向所需的能量。", 3, 6)
    ]
  },
  {
    id: "timing",
    name: "时机布局",
    category: "次要布局",
    description: "用八个等长时间单位观察事件何时活跃（正文列出七位，图示与后续范例含第八位，本站依图示实现）。",
    source: "第六章，图 6.8",
    columns: 4,
    rows: 2,
    positions: [
      spreadPosition(1, "第一时段", "1st Period", "从占卜当天开始的第一个时间单位。", 1, 1),
      spreadPosition(2, "第二时段", "2nd Period", "第二个时间单位。", 2, 1),
      spreadPosition(3, "第三时段", "3rd Period", "第三个时间单位。", 3, 1),
      spreadPosition(4, "第四时段", "4th Period", "第四个时间单位。", 4, 1),
      spreadPosition(5, "第五时段", "5th Period", "第五个时间单位。", 1, 2),
      spreadPosition(6, "第六时段", "6th Period", "第六个时间单位。", 2, 2),
      spreadPosition(7, "第七时段", "7th Period", "第七个时间单位。", 3, 2),
      spreadPosition(8, "第八时段", "8th Period", "第八个时间单位。", 4, 2)
    ]
  },
  {
    id: "manifestation-cause",
    name: "表现／因果布局",
    category: "次要布局",
    description: "识别潜在灾难事件最可能的表现方式与原因。",
    source: "第六章，图 6.9",
    columns: 3,
    rows: 6,
    positions: [
      spreadPosition(1, "事件本身", "The Event", "正在追查的事件。", 2, 4),
      spreadPosition(2, "自然事件", "Natural Event", "天气、滑坡、地震等自然原因。", 1, 6),
      spreadPosition(3, "意外", "Accident", "意外事件。", 1, 5),
      spreadPosition(4, "经济问题", "Financial Issues", "收入、债务、储蓄或财产问题。", 1, 3),
      spreadPosition(5, "疾病／受伤", "Illness / Injury", "疾病或身体受伤。", 1, 2),
      spreadPosition(6, "自我造成", "Self-Caused", "由自身行为造成的问题。", 2, 1),
      spreadPosition(7, "情感／心理", "Emotional / Psychological", "情感或心理问题。", 3, 2),
      spreadPosition(8, "关系问题", "Relationship Issues", "关系所引发的问题。", 3, 3),
      spreadPosition(9, "攻击", "Attack", "身体或情感虐待、盗窃、欺诈等攻击。", 3, 5),
      spreadPosition(10, "正义的天秤", "Scales of Justice", "法院、法律事务或报复。", 3, 6)
    ]
  },
  {
    id: "solution",
    name: "解决方案布局",
    category: "次要布局",
    description: "寻找成功、稳定或治愈的卡片，以定位最佳解决路径。",
    source: "第六章，图 6.10",
    columns: 3,
    rows: 6,
    positions: [
      spreadPosition(1, "事件", "Event", "需要解决的事件。", 2, 4),
      spreadPosition(2, "被动展开", "Passive Unfolding", "让命运和时间发挥作用。", 1, 6),
      spreadPosition(3, "随机行动", "Random Action", "灵感或无计划行动触发解决方案。", 1, 5),
      spreadPosition(4, "经济", "Finances", "金钱或物质是解决方案。", 1, 3),
      spreadPosition(5, "健康", "Health", "改善健康将带来解决方案。", 1, 2),
      spreadPosition(6, "责任", "Responsibility", "为自己的行为承担责任。", 2, 1),
      spreadPosition(7, "冷静的头脑", "Cool Head", "冷静、公正、无情绪地谈判或行动。", 3, 2),
      spreadPosition(8, "仁慈", "Mercy", "善良、理解与同情。", 3, 3),
      spreadPosition(9, "斗争", "Struggle", "捍卫立场、坚定信念、不放弃。", 3, 5),
      spreadPosition(10, "还债", "Paying Debts", "偿还债务、传递财富或归还不属于你的东西。", 3, 6)
    ]
  },
  {
    id: "health",
    name: "健康布局",
    category: "专业布局",
    description: "观察健康图景的能量、身体系统、情绪与近期趋势；不能替代医疗。",
    source: "第六章，图 6.11",
    columns: 3,
    rows: 10,
    positions: [
      spreadPosition(1, "正在形成", "Forming", "从命运与未来进入健康图景、刚开始形成的内容。", 2, 1),
      spreadPosition(2, "尚未显现", "Not Yet Manifest", "已在命运层面形成、尚未在身体显现的内容。", 2, 3),
      spreadPosition(3, "头部", "Head", "大脑、鼻窦、腺体、眼鼻喉与颈部以上。", 2, 5),
      spreadPosition(4, "固态摄入", "Solid Intake", "食物、饮料、药物等进入身体的固态能量。", 3, 2),
      spreadPosition(5, "情绪", "Emotion", "情绪、心理状态与身体疼痛。", 1, 2),
      spreadPosition(6, "主要免疫", "Primary Immune", "短期或主要免疫系统的当前状态。", 3, 4),
      spreadPosition(7, "深层免疫", "Deep Immune", "次级免疫与已克服威胁的处理。", 1, 4),
      spreadPosition(8, "核心器官", "Core Organs", "心、肺、胃、胰腺、肝脏与肾脏。", 2, 6),
      spreadPosition(9, "男性生殖／激素", "Male Reproductive / Hormones", "男性生殖器、膀胱与睾酮。", 3, 6),
      spreadPosition(10, "女性生殖／激素", "Female Reproductive / Hormones", "女性生殖器、膀胱与雌激素。", 1, 6),
      spreadPosition(11, "消化系统", "Digestive System", "大肠与小肠的消化处理。", 3, 8),
      spreadPosition(12, "睡眠／梦境", "Sleep / Dreams", "睡眠与梦境中发生的事情。", 1, 8),
      spreadPosition(13, "结构与运动", "Structure & Movement", "骨骼、肌肉、神经与炎症反应。", 2, 7),
      spreadPosition(14, "皮肤", "Skin", "身体最外层、最大的器官。", 2, 9),
      spreadPosition(15, "近期未来", "Near Future", "身体健康的近期未来。", 2, 10)
    ]
  },
  {
    id: "fate-pattern",
    name: "命运模式布局",
    category: "神秘布局",
    description: "查看当前命运路径、需要处理的动态与最高潜力。",
    source: "第六章，图 6.12",
    columns: 5,
    rows: 5,
    positions: [
      spreadPosition(1, "当前命运路径", "Current Fate Path", "当前命运路径。", 3, 3),
      spreadPosition(2, "已学到的教训", "Lessons Learned", "已经留下且仍与当前相关的教训。", 3, 5),
      spreadPosition(3, "最高潜力", "Highest Potential", "这个命运模式所能实现的最高结果。", 3, 1),
      spreadPosition(4, "需要培育的种子", "Seeds to Tend", "为未来种下并需精心照料的事物。", 1, 3),
      spreadPosition(5, "需要攀登的山峰", "Mountain to Climb", "为成功必须克服的困难。", 2, 2),
      spreadPosition(6, "需要释放", "What to Release", "为实现潜力需要放弃的东西。", 4, 2),
      spreadPosition(7, "收获", "Harvest", "到目前为止取得的成就。", 5, 3),
      spreadPosition(8, "严厉天使", "Severe Angel", "可能令命运模式与个人进化面临风险的自身行为。", 4, 4),
      spreadPosition(9, "仁慈天使", "Merciful Angel", "因你的行为、决策与反思而给予的帮助。", 2, 4),
      spreadPosition(10, "影响", "Influence", "交叉第一张牌，显示正在影响你的连接或存在。", 3, 3, { offsetX: 14, offsetY: 32 })
    ]
  },
  {
    id: "angel",
    name: "天使布局",
    category: "神秘布局",
    description: "观察魔法发展、周围力量，并与个人守护者的建议相接。",
    source: "第六章，图 6.13",
    columns: 5,
    rows: 5,
    positions: [
      spreadPosition(1, "自我", "Self", "被观察的个人、地点或系统。", 3, 3),
      spreadPosition(2, "慈悲", "Mercy", "照亮前方道路的天使或神圣力量。", 2, 4),
      spreadPosition(3, "限制者", "Limiter", "减缓或限制道路、提供守护的力量。", 1, 3),
      spreadPosition(4, "法杖", "Staff", "需要参与和工作的学习与发展。", 2, 2),
      spreadPosition(5, "灯笼", "Lantern", "已经获得、并照亮前路的学习与发展。", 4, 2),
      spreadPosition(6, "容器", "Vessel", "已完成且正在成熟、脱粒的工作或学习。", 5, 3),
      spreadPosition(7, "吉布拉", "What Must Sink", "应让其沉入过去、不应复苏的事物。", 4, 4),
      spreadPosition(8, "伴侣", "Companion", "关于最佳前进方式的指引与建议。", 3, 1),
      spreadPosition(9, "HGA：过去", "HGA: Past", "过去经历带来的协同建议。", 2, 5),
      spreadPosition(10, "HGA：是什么", "HGA: What Is", "守护者反映出的真实当前状况或自我。", 3, 5),
      spreadPosition(11, "HGA：将会是什么", "HGA: What Will Be", "关于你可以成为什么的洞见。", 4, 5)
    ]
  },
  {
    id: "landscape",
    name: "景观布局",
    category: "世俗／神秘布局",
    description: "观察过去、现在、未来以及内在世界如何流入日常生活。",
    source: "第六章，图 6.14",
    columns: 5,
    rows: 7,
    positions: [
      spreadPosition(1, "基础", "Foundation", "身体、结构或土地。", 3, 4),
      spreadPosition(2, "联合", "Union", "交叉第一张牌的当前力量、关系或内在连接。", 3, 4, { offsetX: 14, offsetY: 32 }),
      spreadPosition(3, "星之父", "Star Father", "仍在形成、与问题相关的长期未来。", 3, 1),
      spreadPosition(4, "冥界", "Underworld", "已经消逝且不会回来的事物。", 3, 7),
      spreadPosition(5, "过去之门", "Past Gate", "直接过去的门槛，未来可能返回。", 1, 4),
      spreadPosition(6, "命运之轮", "Wheel of Fate", "正在展开的当前命运或行动模式。", 2, 3),
      spreadPosition(7, "磨石", "Millstone", "当前道路上必须克服的艰难与障碍。", 3, 2),
      spreadPosition(8, "内在神殿", "Inner Temple", "来自内在世界或内在连接的影响。", 4, 3),
      spreadPosition(9, "家与炉灶", "Home & Hearth", "家、家庭、组织或魔法之家的影响。", 4, 5),
      spreadPosition(10, "解开者", "Unraveller", "正在消退、失去影响力并走向过去的事物。", 3, 6),
      spreadPosition(11, "沉睡者", "Sleeper", "梦境、睡眠、潜意识或视觉工作。", 2, 5),
      spreadPosition(12, "前方的道路", "Path Ahead", "问题的短期结果与前进方向。", 5, 4)
    ]
  },
  {
    id: "self-map",
    name: "自我地图布局",
    category: "神秘布局",
    description: "从世俗、魔法与灵魂三个层次映射人物、结构或系统。",
    source: "第六章，图 6.15",
    columns: 7,
    rows: 9,
    positions: [
      spreadPosition(1, "自我", "Self", "问题的起点。", 4, 5),
      spreadPosition(2, "起源", "Origin", "主题的来源。", 4, 9),
      spreadPosition(3, "目的地", "Destination", "主题的去向。", 4, 1),
      spreadPosition(4, "世俗积极", "Mundane Positive", "对身体和世俗生活有积极贡献的因素。", 3, 4),
      spreadPosition(5, "短期未来", "Short-term Future", "灵魂的短期世俗未来。", 5, 4),
      spreadPosition(6, "最近的过去", "Recent Past", "灵魂命运中已经过去的事情。", 5, 6),
      spreadPosition(7, "世俗消极", "Mundane Negative", "对身体和世俗生活有负面影响的因素。", 3, 6),
      spreadPosition(8, "魔法／精神之路", "Magical / Spiritual Path", "当前道路如何服务或影响灵魂。", 2, 3),
      spreadPosition(9, "魔法接触", "Magical Contact", "与魔法师对话或提供指导的存在类型。", 4, 3),
      spreadPosition(10, "魔法未来", "Magical Future", "当前魔法之路将灵魂带向何方。", 6, 3),
      spreadPosition(11, "魔法对手", "Magical Adversary", "作为成长平衡、对抗魔法师的力量。", 6, 7),
      spreadPosition(12, "基石", "Foundation Stone", "支撑魔法之路的基础及其稳定程度。", 2, 7),
      spreadPosition(13, "灵魂的步骤", "Soul Steps", "此生需要实现的主要课程或行动。", 1, 8),
      spreadPosition(14, "灵魂之路", "Soul Path", "此生为实现目标需要走的道路。", 1, 5),
      spreadPosition(15, "灵魂命运模式", "Soul Fate Pattern", "促进灵魂道路与步骤的主要命运模式。", 1, 2),
      spreadPosition(16, "灵魂的收获", "Soul Harvest", "此生迄今获得的知识与经验。", 7, 2),
      spreadPosition(17, "天秤", "Scales", "仍需平衡的债务、赤字与必要性。", 7, 5),
      spreadPosition(18, "克制", "Restraint", "仍需克制、以免破坏此生目标的事物。", 7, 8)
    ]
  }
];

function getTarotSpread(id) {
  return tarotSpreads.filter(function (spread) { return spread.id === id; })[0] || tarotSpreads[0];
}

// Mystagogus (M 牌) layouts — from Mystagogus_Layout.pdf
// Zigzag grid: left column / center column / right column across 13 rows.
var mystagogusSpreads = [
  {
    id: "mystagogus-layout",
    name: "Mystagogus 布局",
    deck: "mystagogus",
    category: "M 牌牌阵",
    description: "完整阅读当前故事：起源、耐力、分离、关系、家园、过去门槛、命运织线、道路与限制、礼物与对手、梦境与内在世界、建议与危险，以及近远未来。",
    source: "Mystagogus Layout · Josephine McCarthy",
    columns: 3,
    rows: 13,
    positions: [
      spreadPosition(1, "始源者", "Progenitor", "故事的主题是什么？", 2, 1),
      spreadPosition(2, "耐力", "Endurance", "为了成功／成长必须克服什么？", 3, 2),
      spreadPosition(3, "解开", "Unravelling", "必须放下、松动，或正在脱落的是什么？", 1, 2),
      spreadPosition(4, "伙伴关系", "Partnership", "你正紧密互动的对象，或正产生直接影响的力量。", 2, 3),
      spreadPosition(5, "炉灶", "Hearth", "家、家庭与所属群体。", 2, 4),
      spreadPosition(6, "西门", "West Gate", "正在沉入过去、但仍可能返回的内容。", 3, 5),
      spreadPosition(7, "北门", "North Gate", "久已过去、不会再返，却仍有意义的内容。", 1, 5),
      spreadPosition(8, "命运编织者", "Fate Weavers", "当前活跃的个人命运模式。", 2, 6),
      spreadPosition(9, "道路", "The Path", "正在向前、活跃且正向的内容。", 3, 7),
      spreadPosition(10, "束缚者", "The Binder", "被扣住、当前不应启动的内容。", 1, 7),
      spreadPosition(11, "礼物", "The Gift", "进入局势的帮助。", 3, 8),
      spreadPosition(12, "冥界", "Underworld", "局势中的对手／对抗力量。", 1, 8),
      spreadPosition(13, "梦境", "Dreams", "睡眠与梦中发生的事；也可作异象工作的位置。", 2, 9),
      spreadPosition(14, "内在世界", "Inner Worlds", "从内在／灵性世界流入局势的内容。", 2, 10),
      spreadPosition(15, "守护灵", "Daimon", "为成功所需行动提供的建议。", 3, 11),
      spreadPosition(16, "危险", "Danger", "危险、可能抑制或阻断进展的因素。", 1, 11),
      spreadPosition(17, "东门", "East Gate", "短期未来，前方的路径。", 2, 12),
      spreadPosition(18, "南门", "South Gate", "在更长期未来中，由当前局势将形成的结果。", 2, 13)
    ]
  }
];

function getMystagogusSpread(id) {
  return mystagogusSpreads.filter(function (spread) { return spread.id === id; })[0] || mystagogusSpreads[0];
}

// LXXXI / Quareia Magician's Deck spreads — from 《LXXXI 奎瑞亚魔法牌说明书》第十章
// Note: 景色牌阵与塔罗「景观布局」牌位意义与摆放几乎相同，故不重复收录。
var lxxxiSpreads = [
  {
    id: "lxxxi-occult-map",
    name: "基础／神秘学地图牌阵(LXXXI牌)",
    deck: "lxxxi",
    category: "LXXXI 牌阵",
    description: "大规模神秘学地图：观察一生中创造与毁灭的深层力量、命运模式、先祖与内在联系。不宜频繁用于世俗问题。",
    source: "LXXXI 奎瑞亚魔法牌说明书 · 第十章",
    columns: 5,
    rows: 7,
    positions: [
      spreadPosition(1, "大地之母", "Mother Earth", "占卜的中心点：人的身体、所居之地或相关土地；容器、健康与当下状态。", 3, 4),
      spreadPosition(2, "结合", "Union", "交叉第一张牌：与主题相关的关系、重要人物，或正造成最大影响的互动／力量。", 3, 4, { offsetX: 14, offsetY: 32 }),
      spreadPosition(3, "星辰之父", "Star Father", "长远未来：若沿当前道路继续，正在形成的长期命运模式与结局。", 3, 1),
      spreadPosition(4, "深渊", "Abyss", "地下世界深处：已逝去且不会再回来的事物；久远的过去。", 3, 7),
      spreadPosition(5, "过去之门", "Gate of the Past", "正远离主题的事物；大门双向——可能回头、停驻，或继续沉入过去。", 1, 4),
      spreadPosition(6, "祖庙", "Temple of Ancestors", "血脉、当地先祖或侍奉先祖的祭司所流出的影响、建议或继承的技巧与天赋。", 2, 2),
      spreadPosition(7, "内在神殿", "Inner Temple", "主题更玄妙、深刻的魔法或内在层面；内在联系者、天使与众神所在之处。", 4, 2),
      spreadPosition(8, "血脉先祖", "Blood Ancestor", "地下世界最深处的血源先祖：直接赋予的天赋或问题，以及先祖是否活跃。", 5, 6),
      spreadPosition(9, "基石", "Foundation", "深处的锚点：过去已发生且深远影响未来的事件；不可改变的立足根基。", 1, 6),
      spreadPosition(10, "创造织者", "Weaver of Creation", "当前沉浸其中的命运模式主题；与基石位置直接相关，宜一并解读。", 2, 3),
      spreadPosition(11, "砥砺石", "The Grindstone", "当前限制与必须克服的困难；磨砺人使之更强的努力与功课。", 3, 3),
      spreadPosition(12, "魔法殿堂", "Magical Temple", "魔法生命中正在发生的事、流入的力量，或宗教集体意识的影响。", 4, 3),
      spreadPosition(13, "家与壁炉", "Home and Hearth", "家、家族、种族、地方社区与周围外部世界的日常生活。", 4, 5),
      spreadPosition(14, "分解者", "The Unraveller", "正被分解、经过去之门进入过去的事物；已达巅峰、将离开主题一生的内容。", 3, 5),
      spreadPosition(15, "梦之河", "River of Dreams", "沉睡、梦境、灵视与夜晚；强大时宜对照创造织者、祖庙与内在神殿。", 2, 5),
      spreadPosition(16, "赫丘利之路", "Path of Hercules", "短期未来：已成型、正展开行动的前方道路与直接结果。", 5, 4)
    ]
  },
  {
    id: "lxxxi-tree-of-life-occult",
    name: "生命之树牌阵(LXXXI牌,神秘学方法)",
    deck: "lxxxi",
    category: "LXXXI 牌阵",
    description: "依生命之树深层力量解读：概念如何经时间、限制与平衡而显化为结果。适于魔法与神秘学占卜，而非简单是／否。",
    source: "LXXXI 奎瑞亚魔法牌说明书 · 第十章 · 深度解法",
    columns: 3,
    rows: 7,
    positions: [
      spreadPosition(1, "星辰之父", "Star Father I", "开始、概念、宇宙创始；从魔法东方／内在世界流出、将要显化的东西。", 2, 1),
      spreadPosition(2, "时间创造者", "Creator of Time II", "赋予形状、给予时间；包含时间与命运、已被触发以使命运显化的深层力量。", 3, 2),
      spreadPosition(3, "持光者", "Holder of Light III", "正被扣押、休眠中，或被收回的事物。", 1, 2),
      spreadPosition(4, "光之承载", "Light Bearer IV", "路径的建造者、道路的开拓者。", 3, 3),
      spreadPosition(5, "监禁者", "Imprisoner V", "必要的限制；必须被扣押才能使道路得以展开的力量。", 1, 3),
      spreadPosition(6, "纯粹平衡", "Pure Balance VI", "支点；保持平衡、使命运得以展现的力量。", 2, 4),
      spreadPosition(7, "砥砺石", "Grindstone VII", "使主题成长的苦难、边界与控制；物质上的困难与命运模式。", 3, 5),
      spreadPosition(8, "分解者", "Unraveller VIII", "使主题失败的松懈、失去边界、缺乏控制；心理或魔法上的难处。", 1, 5),
      spreadPosition(9, "界线守卫", "Threshold Guardian IX", "创造、内在灵视与内在景观；允许内在力量流到外在的内在桥梁。", 2, 6),
      spreadPosition(10, "大地之母", "Mother Earth X", "身体、土地、结果；开始的完成与开花结果。", 2, 7)
    ]
  },
  {
    id: "lxxxi-tree-of-life-simple",
    name: "生命之树牌阵(LXXXI牌,简易方法)",
    deck: "lxxxi",
    category: "LXXXI 牌阵",
    description: "通俗解读：看主题得失、命运所给与所失，以及答案如何形成。第十位为结果／答案，适合一般占卜与是／否问题。",
    source: "LXXXI 奎瑞亚魔法牌说明书 · 第十章 · 简易解法",
    columns: 3,
    rows: 7,
    positions: [
      spreadPosition(1, "占卜主题概论", "Subject Overview", "占卜主题的总体概况。", 2, 1),
      spreadPosition(2, "得的面向", "Gaining Aspect", "主题积极、获得或给予的面向。", 3, 2),
      spreadPosition(3, "失的面向", "Losing Aspect", "主题消极、失去或被隐瞒的面向。", 1, 2),
      spreadPosition(4, "命运给予的", "What Fate Gives", "命运所给予的、必要的条件与支持。", 3, 3),
      spreadPosition(5, "失去的", "What Is Lost", "被拿走、失去或被剥夺的内容。", 1, 3),
      spreadPosition(6, "现状的中心点", "Core of the Present", "当前状况的关键与核心。", 2, 4),
      spreadPosition(7, "情感与负担", "Emotion & Burden", "情感层面，以及需要承担的负担。", 3, 5),
      spreadPosition(8, "心智与分解", "Mind & Unravelling", "心智、魔法层面，以及正在分解中的事物。", 1, 5),
      spreadPosition(9, "族群家与先祖", "Clan, Home & Ancestors", "族群、家与先祖的影响。", 2, 6),
      spreadPosition(10, "结果", "Outcome", "问题的结果或答案。", 2, 7)
    ]
  },
  {
    id: "lxxxi-four-directions",
    name: "四方位牌阵(LXXXI牌)",
    deck: "lxxxi",
    category: "LXXXI 牌阵",
    description: "六张牌检视从各方位流入并影响主题的力量，以及与主题的最大互动。可用于人、情况、地点或时间点。",
    source: "LXXXI 奎瑞亚魔法牌说明书 · 第十章",
    columns: 3,
    rows: 3,
    positions: [
      spreadPosition(1, "中央", "Centre", "身体、地点、土地、人或物体——关于占卜主题本身。", 2, 2),
      spreadPosition(2, "东方", "East", "诞生、潜力、风元素、话语、春天、到来、学习。", 3, 2),
      spreadPosition(3, "南方", "South", "前方的路、未来、火元素、夏天、工作。", 2, 3),
      spreadPosition(4, "西方", "West", "家庭、家、老化、水元素、秋天、消失、遗留物。", 1, 2),
      spreadPosition(5, "北方", "North", "先祖、死亡、过去、冬天、土元素。", 2, 1),
      spreadPosition(6, "结合", "Union", "交叉第一张牌：对主题最大的影响、关系或投入。", 2, 2, { offsetX: 14, offsetY: 32 })
    ]
  }
];

function getLxxxiSpread(id) {
  return lxxxiSpreads.filter(function (spread) { return spread.id === id; })[0] || lxxxiSpreads[0];
}

/** Label spread origin for UI: 出自 M 牌 / 出自 LXXXI 牌 / 出自塔罗牌 */
function getSpreadOriginLabel(spread) {
  if (spread && spread.deck === "mystagogus") return "出自 M 牌";
  if (spread && spread.deck === "lxxxi") return "出自 LXXXI 牌";
  return "出自塔罗牌";
}

function getSpreadsForDeck(deckType) {
  var compatibleTarotSpreads = tarotSpreads.filter(function (spread) {
    return !spread.requiresDeck || spread.requiresDeck === deckType;
  });
  // 各牌组均可使用对方牌阵；当前牌组的本族牌阵排在前面。
  if (deckType === "mystagogus") {
    return mystagogusSpreads.concat(compatibleTarotSpreads, lxxxiSpreads);
  }
  if (deckType === "lxxxi") {
    return lxxxiSpreads.concat(compatibleTarotSpreads, mystagogusSpreads);
  }
  return compatibleTarotSpreads.concat(mystagogusSpreads, lxxxiSpreads);
}

function getSpreadById(deckType, id) {
  var lSpread = lxxxiSpreads.filter(function (spread) { return spread.id === id; })[0];
  if (lSpread) return lSpread;
  var mSpread = mystagogusSpreads.filter(function (spread) { return spread.id === id; })[0];
  if (mSpread) return mSpread;
  var tSpread = tarotSpreads.filter(function (spread) { return spread.id === id; })[0];
  if (tSpread && (!tSpread.requiresDeck || tSpread.requiresDeck === deckType)) return tSpread;
  if (deckType === "mystagogus") return mystagogusSpreads[0];
  if (deckType === "lxxxi") return lxxxiSpreads[0];
  return tarotSpreads[0];
}

function validateTarotSpreads(spreads) {
  var ids = {};
  (spreads || []).forEach(function (spread) {
    if (!spread.id || ids[spread.id]) throw new Error("牌阵 id 必须存在且唯一：" + spread.id);
    ids[spread.id] = true;
    if (!spread.positions || spread.positions.length === 0) throw new Error(spread.id + " 缺少牌位");
    var numbers = {};
    spread.positions.forEach(function (position, index) {
      if (position.number !== index + 1 || numbers[position.number]) {
        throw new Error(spread.id + " 的牌位编号必须从 1 连续排列");
      }
      numbers[position.number] = true;
      if (!position.name || !position.nameEn) {
        throw new Error(spread.id + " 的第 " + position.number + " 个牌位缺少中英文名称");
      }
      if (position.column < 1 || position.column > spread.columns || position.row < 1 || position.row > spread.rows) {
        throw new Error(spread.id + " 的第 " + position.number + " 个牌位超出布局网格");
      }
      if (position.drawRule && !position.drawRule.arcana && !position.drawRule.suit) {
        throw new Error(spread.id + " 的第 " + position.number + " 个牌位抽牌限制无效");
      }
    });
  });
  return true;
}

validateTarotSpreads(tarotSpreads);
validateTarotSpreads(mystagogusSpreads);
validateTarotSpreads(lxxxiSpreads);

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    tarotSpreads: tarotSpreads,
    mystagogusSpreads: mystagogusSpreads,
    lxxxiSpreads: lxxxiSpreads,
    getTarotSpread: getTarotSpread,
    getMystagogusSpread: getMystagogusSpread,
    getLxxxiSpread: getLxxxiSpread,
    getSpreadOriginLabel: getSpreadOriginLabel,
    getSpreadsForDeck: getSpreadsForDeck,
    getSpreadById: getSpreadById,
    formatPositionName: formatPositionName,
    isOverviewStackingMode: isOverviewStackingMode,
    getNextOverviewStackingSlot: getNextOverviewStackingSlot,
    getOverviewStackingPhase: getOverviewStackingPhase,
    getOverviewStackingState: getOverviewStackingState,
    getAvailableOverviewStackingCards: getAvailableOverviewStackingCards,
    cardMatchesDrawRule: cardMatchesDrawRule,
    getAvailableCardsForDrawRule: getAvailableCardsForDrawRule,
    validateTarotSpreads: validateTarotSpreads
  };
}

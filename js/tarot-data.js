const quareiaSource = "参考《21世纪的塔罗技能》与 Quareia 训练语境整理";

const tarotDeck = [
  {
    id: "major-00",
    name: "愚者",
    arcana: "major",
    uprightKeywords: ["空", "缺乏经验", "鲁莽", "自我无知", "不在那里"],
    reversedKeywords: ["误判", "盲动", "警告被忽视", "重新确认"],
    uprightMeaning: "愚者不是浪漫化的新旅程，而是尚未意识到自身处境的空白状态。它常指缺乏经验、轻率行动、自我欺骗，也可直接表示某处为空、某物不在那儿。",
    reversedMeaning: "这股愚者力量被放大时，容易把无知当成直觉。先暂停，确认事实、边界与方向，再决定是否行动。"
  },
  {
    id: "major-01",
    name: "魔法师",
    arcana: "major",
    uprightKeywords: ["控制", "技能", "意图", "组织", "有计划的行动"],
    reversedKeywords: ["操控", "技能误用", "目标狭窄", "强行控制"],
    uprightMeaning: "魔法师代表有工具、有技术、有意图的人或力量。它强调组织、掌控局面并运用熟练行动达成目标，但智慧与成熟未必同步到位。",
    reversedMeaning: "技能可能被用来操纵情境或他人。与其追求控制一切，不如检查动机、方法和代价。"
  },
  {
    id: "major-02",
    name: "女祭司",
    arcana: "major",
    uprightKeywords: ["智慧", "真理", "直觉", "成熟", "神圣知识"],
    reversedKeywords: ["忽视内在", "道德失衡", "表象判断", "封闭直觉"],
    uprightMeaning: "女祭司是平衡的内在力量，连接神圣法则、伦理与深层直觉。她提醒你不要只看表面，真正的秩序可能在更深处运作。",
    reversedMeaning: "当女祭司失衡，直觉会被情绪或偏见遮蔽。回到事实、伦理和安静的内在判断。"
  },
  {
    id: "major-03",
    name: "皇后",
    arcana: "major",
    uprightKeywords: ["丰饶", "母性", "自然", "收获", "保护"],
    reversedKeywords: ["过度控制", "情感操控", "窒息", "丰盈过载"],
    uprightMeaning: "皇后是滋养、土地、收获与保护弱者的力量。她带来温和的成功、身体与情感需求的满足，也代表会守护成果的女性原则。",
    reversedMeaning: "滋养若变成占有，就会让人成长受限。检查关怀背后的控制欲，给关系和项目留出呼吸空间。"
  },
  {
    id: "major-04",
    name: "皇帝",
    arcana: "major",
    uprightKeywords: ["秩序", "权威", "责任", "边界", "公共利益"],
    reversedKeywords: ["专断", "权力压迫", "僵硬", "责任失衡"],
    uprightMeaning: "皇帝是安全权力与责任的典型：建立结构、保护边界、限制强者并保护弱者。它可指父权、机构、财务稳定或最终负责的人。",
    reversedMeaning: "权威可能变成压迫或僵硬。重新确认权力是否仍在服务秩序与保护，而不是服务恐惧。"
  },
  {
    id: "major-05",
    name: "教皇",
    arcana: "major",
    uprightKeywords: ["信仰结构", "教导", "纪律", "传统", "制度"],
    reversedKeywords: ["教条", "狭隘", "盲从", "拒绝异见"],
    uprightMeaning: "教皇代表结构化的信仰、教育、纪律和制度权威。它可以是有完整性的导师，也可以提示你需要遵循某套成熟规则。",
    reversedMeaning: "当结构失去活性，就会成为狭隘教条。把规则拿来检验现实，而不是让规则替你思考。"
  },
  {
    id: "major-06",
    name: "恋人",
    arcana: "major",
    uprightKeywords: ["契约", "伙伴", "联合", "爱情", "力量平衡"],
    reversedKeywords: ["失衡关系", "错误契约", "分裂", "不忠于选择"],
    uprightMeaning: "恋人关乎协议、关系与两股力量的联合。它不只说爱情，也说共鸣、承诺、合作与维持平衡所需的清晰选择。",
    reversedMeaning: "关系或契约中的力量可能失衡。回到真正的承诺，确认双方是否仍在同一方向上。"
  },
  {
    id: "major-07",
    name: "战车",
    arcana: "major",
    uprightKeywords: ["前进", "运动", "旅程", "神圣行动", "道路"],
    reversedKeywords: ["失控", "方向错误", "急进", "行动受阻"],
    uprightMeaning: "战车是向前推进的动力，可能指交通工具、旅程、行动路线，也可能表示被更深力量推动的必要行动。",
    reversedMeaning: "能量在动，但方向可能不稳。先确认路线、工具和目标，再继续加速。"
  },
  {
    id: "major-08",
    name: "力量",
    arcana: "major",
    uprightKeywords: ["耐力", "勇气", "坚韧", "保护", "逆境中成功"],
    reversedKeywords: ["耗尽", "脆弱", "硬撑", "结构承压"],
    uprightMeaning: "力量来自长期经历、逆境和持续维护的结构。它不是短暂爆发，而是能经受时间考验的耐力与稳定。",
    reversedMeaning: "力量需要维护，不是无限消耗。若已疲惫，先修复结构、分担压力，再继续承担。"
  },
  {
    id: "major-09",
    name: "隐士",
    arcana: "major",
    uprightKeywords: ["孤独智慧", "内省", "经验", "唯一道路", "成熟"],
    reversedKeywords: ["孤立", "苦涩经验", "拒绝指引", "退缩过度"],
    uprightMeaning: "隐士站在逆境之后的高处，带着经验、内省和独自前行的灯。它要求相信自身判断，并承认成长常来自艰难课程。",
    reversedMeaning: "独处若变成封闭，会让智慧失去流动。带着经验回来，与现实重新连接。"
  },
  {
    id: "major-10",
    name: "命运之轮",
    arcana: "major",
    uprightKeywords: ["变化", "命运转向", "真实路径", "周期", "运势改变"],
    reversedKeywords: ["抗拒变化", "偏离路径", "循环停滞", "时机未稳"],
    uprightMeaning: "命运之轮表示力量正在转动，把事情带回更真实的命运路径。它未必只带好运，而是带来必要的转向。",
    reversedMeaning: "抗拒变化会让循环更难结束。观察正在重复的模式，顺势调整。"
  },
  {
    id: "major-11",
    name: "正义",
    arcana: "major",
    uprightKeywords: ["平衡", "因果", "判决", "法律", "偿还"],
    reversedKeywords: ["不公", "逃避责任", "因果失衡", "偏见"],
    uprightMeaning: "正义是因果与秩序的力量，不被情绪故事轻易打动。它要求负责、偿还、重新平衡，并让混乱回到秩序中。",
    reversedMeaning: "若逃避责任，因果仍会寻找出口。诚实面对行为、契约和应付的代价。"
  },
  {
    id: "major-12",
    name: "倒吊人",
    arcana: "major",
    uprightKeywords: ["考验", "牺牲", "服务", "道德义务", "自我否定"],
    reversedKeywords: ["无谓牺牲", "殉道姿态", "停滞", "失去边界"],
    uprightMeaning: "倒吊人指主动承受考验、服务或道德义务。它不是软弱，而是在更高目的前暂时放下自我。",
    reversedMeaning: "牺牲若只剩姿态，就会成为消耗。确认这份付出是否真的服务于正确的事。"
  },
  {
    id: "major-13",
    name: "死亡",
    arcana: "major",
    uprightKeywords: ["周期结束", "过渡", "环境改变", "清除", "不可回头"],
    reversedKeywords: ["抗拒结束", "拖延", "腐败残留", "转化受阻"],
    uprightMeaning: "死亡是周期的终结与环境的改变。它通常不是字面死亡，而是某种模式、关系或阶段已经不能继续维持。",
    reversedMeaning: "越拖延，越会把旧结构的腐败带入新阶段。让该结束的结束。"
  },
  {
    id: "major-14",
    name: "节制",
    arcana: "major",
    uprightKeywords: ["必要性", "中庸", "疗愈", "保护", "继续前行"],
    reversedKeywords: ["过量", "资源失衡", "保护不足", "节奏混乱"],
    uprightMeaning: "节制是在压力释放后的恢复力量：得到所需，而非贪求更多。它带来庇护、疗愈、适度资源和继续前进的空间。",
    reversedMeaning: "过多或过少都会破坏平衡。把需求缩回必要尺度，恢复节奏。"
  },
  {
    id: "major-15",
    name: "魔鬼",
    arcana: "major",
    uprightKeywords: ["诱惑", "软弱", "自我破坏", "不诚实", "脆弱"],
    reversedKeywords: ["投射责任", "欲望失控", "逃避真相", "解构"],
    uprightMeaning: "魔鬼不是外部替罪者，而是明知会带来灾难却仍难以克服的诱惑。它要求看见自己在堕落模式中的角色。",
    reversedMeaning: "不要把责任全投向外部。识别欲望、借口和自我欺骗，才有机会脱离束缚。"
  },
  {
    id: "major-16",
    name: "塔",
    arcana: "major",
    uprightKeywords: ["灾难", "崩溃", "清场", "报应", "堕落"],
    reversedKeywords: ["否认崩塌", "延迟冲击", "耻辱", "结构腐朽"],
    uprightMeaning: "塔是突然崩塌与清理场地的力量。它摧毁已经失去完整性的结构，让真实后果显现。",
    reversedMeaning: "如果继续否认，冲击只会更强。把能清理的先清理，减少坠落的代价。"
  },
  {
    id: "major-17",
    name: "星星",
    arcana: "major",
    uprightKeywords: ["灾后黎明", "希望", "神圣指引", "种子", "第一步"],
    reversedKeywords: ["失去方向", "希望微弱", "拒绝重建", "灯光被遮"],
    uprightMeaning: "星星是在黑暗之后出现的微光，指向安全通道和重建的第一步。它不是轻飘的愿望，而是灾后仍能指路的真实希望。",
    reversedMeaning: "光还在，但你可能没有抬头看。先走最小、最真实的一步。"
  },
  {
    id: "major-18",
    name: "月亮",
    arcana: "major",
    uprightKeywords: ["隐藏", "幻想", "潮汐", "妄想", "隐秘"],
    reversedKeywords: ["迷雾加深", "自欺", "恐惧投射", "看不清"],
    uprightMeaning: "月亮表示事物处在阴影、雾气或潮汐变化中。它可能是隐藏、保护、想象力，也可能是误看现实。",
    reversedMeaning: "不要在雾中下最终判断。承认不清晰，等待更多光线或证据。"
  },
  {
    id: "major-19",
    name: "太阳",
    arcana: "major",
    uprightKeywords: ["成功", "成就", "恩惠", "地位", "完成"],
    reversedKeywords: ["成功延迟", "目标偏差", "光芒不足", "过度自信"],
    uprightMeaning: "太阳是长期努力后的成功与认可。它给予的是你真正需要的成果，而不一定是最初想象的欲望。",
    reversedMeaning: "成功可能仍在形成，或目标需要校准。保持努力，但别让自满遮住判断。"
  },
  {
    id: "major-20",
    name: "审判",
    arcana: "major",
    uprightKeywords: ["决定", "高潮", "解决", "自我责任", "重新平衡"],
    reversedKeywords: ["逃避召唤", "拒绝负责", "未完成", "拖延判定"],
    uprightMeaning: "审判是一个必须面对的决定点：事件达到高潮，需要自我认识、责任承担和重新平衡。",
    reversedMeaning: "拖延不会取消审判。把问题说清楚，把责任拿回来。"
  },
  {
    id: "major-21",
    name: "世界",
    arcana: "major",
    uprightKeywords: ["完成", "实现", "机会", "稳定", "赞誉"],
    reversedKeywords: ["未完成", "机会未接住", "缺少整合", "最后一步"],
    uprightMeaning: "世界是通过考验后的完整与稳定。它显示成果、机会、赞誉，以及一个循环真正完成后的安全感。",
    reversedMeaning: "已经接近完成，但仍需整合最后的部分。别急着宣告结束，先把收尾做好。"
  }
];

const minorArcanaSuits = {
  wands: { name: "权杖", element: "火", direction: "南方" },
  cups: { name: "圣杯", element: "水", direction: "西方" },
  swords: { name: "宝剑", element: "空气", direction: "东方" },
  pentacles: { name: "星币", element: "大地", direction: "北方" }
};

const minorRanks = [
  { rank: "ace", number: "王牌" },
  { rank: "two", number: "二" },
  { rank: "three", number: "三" },
  { rank: "four", number: "四" },
  { rank: "five", number: "五" },
  { rank: "six", number: "六" },
  { rank: "seven", number: "七" },
  { rank: "eight", number: "八" },
  { rank: "nine", number: "九" },
  { rank: "ten", number: "十" },
  { rank: "page", number: "侍者" },
  { rank: "knight", number: "骑士" },
  { rank: "queen", number: "王后" },
  { rank: "king", number: "国王" }
];

const numberDynamics = {
  ace: "王牌放大本元素，是入口、种子和单一力量的爆发。",
  two: "二带来极性、对话、冲突与互相平衡。",
  three: "三让两股力量结合并产生具体行动或成果。",
  four: "四使元素稳定汇聚，也可能让局面静止。",
  five: "五对应日常斗争、挑战与生存压力。",
  six: "六承载过去、记忆、继承与旧模式的影响。",
  seven: "七推动心灵和灵魂的成熟。",
  eight: "八带来觉醒事件，让人从日常沉睡中被唤起。",
  nine: "九显现因果，过去的行为结出现在的果实。",
  ten: "十表示循环圆满，当前阶段正在走向结束。",
  page: "侍者带来消息、初学者、孩子或新生项目。",
  knight: "骑士表现年轻、移动、个性鲜明但尚未完全成熟的力量。",
  queen: "王后表现成熟、承载与影响他人的阴性力量。",
  king: "国王表现成熟、负责、掌握资源或权威的人物力量。"
};

const minorMeanings = {
  wands: {
    ace: ["创造开端", "灵感", "成功", "火焰入口", "克服困难", "权杖王牌带来火的启动：灵感、创造性开端、温暖和突破困难的能量。"],
    two: ["合作", "争论", "商业难题", "力量平衡", "权杖二显示创造或商业中的摩擦，需要讨论、合作和权力平衡。"],
    three: ["好运", "建设", "基础", "资源", "权杖三把概念推进到实际建设，代表好运、可用资源和良好基础。"],
    four: ["友谊", "幸福", "元素汇聚", "社交", "权杖四让创造所需的元素聚合，带来友谊、社交和阶段性幸福。"],
    five: ["分歧", "障碍", "创造性解决", "挑战", "权杖五是可被思考和创造力克服的分歧与障碍。"],
    six: ["胜利", "挣扎后成功", "妥协", "警惕自满", "权杖六表示经过挣扎后的胜利与愉快妥协，同时提醒不要自满。"],
    seven: ["坚守", "决心", "不屈服", "小病", "权杖七要求在不平等局面中坚守立场，决心会带来胜利。"],
    eight: ["沟通", "速度", "学习", "能量爆发", "权杖八带来快速沟通、灵感爆发和迅速学习的火性流动。"],
    nine: ["战斗疲惫", "逆境", "警告", "受伤", "权杖九显示长期挣扎后的疲惫，并警告不诚实、受伤或背叛。"],
    ten: ["负担", "撤退", "冲突", "分担", "权杖十是必须承担的能量负担，也提示离开冲突或分担压力。"],
    page: ["好消息", "创意学生", "写作开始", "新月", "权杖侍者带来财务或创意消息、写作开端和有潜力的初学者。"],
    knight: ["年轻", "创意个性", "诚实", "不稳定", "权杖骑士热情、开放、竞争性强，可靠但未成熟，情绪被点燃时会很猛烈。"],
    queen: ["教师", "思想家", "艺术女性", "经验智慧", "权杖王后是富有影响力和创造力的女性力量，诚实而有经验，但被触犯时很危险。"],
    king: ["家庭男人", "商人", "教师", "经验", "权杖国王可靠、乐于助人、经验丰富，适合学习请教，但愤怒时不容小觑。"]
  },
  cups: {
    ace: ["幸福", "爱情", "疗愈", "好结果", "圣杯王牌带来水的祝福：爱、疗愈、幸福和温柔的好结果。"],
    two: ["友谊", "爱情", "沟通", "自然连接", "圣杯二显示友谊、爱、愉快沟通以及与自然的情感连接。"],
    three: ["成就", "快乐", "认可", "创造成功", "圣杯三是在完成某事后产生的幸福、认可和创造性成功。"],
    four: ["情感稳定", "自满", "珍惜所爱", "提醒", "圣杯四显示情感稳定，也提醒不要把爱与稳定视为理所当然。"],
    five: ["情感脆弱", "失望", "看不清", "悲观", "圣杯五是情感不安全和失望，但爱仍在，只是尚未被看见。"],
    six: ["温柔", "纯真", "回忆", "过去", "圣杯六承载纯真、温柔、理想主义和过去事件的影响。"],
    seven: ["魅力", "宝藏被忽视", "超感知", "觉醒", "圣杯七提示眼前有真正的宝藏，也可能标记魔法感知的初醒。"],
    eight: ["情感过载", "离开舒适区", "孤独探索", "寻求未知", "圣杯八带人离开熟悉情绪，开始孤独探索和寻找未知。"],
    nine: ["情感安全", "好预兆", "满足", "和平", "圣杯九是情感安全与平和满足，常是柔和的好预兆。"],
    ten: ["幸福", "逆境后成功", "庆祝", "持久的爱", "圣杯十在逆境之后带来和平、庆祝、幸福和持久的爱。"],
    page: ["支持信", "新项目", "孩子", "创意想法", "圣杯侍者带来爱或支持的信息，也代表需要保护的新项目与温柔孩子。"],
    knight: ["浪漫", "戏剧化", "艺术天赋", "依赖", "圣杯骑士情感丰富、浪漫而不够实际，具有艺术天赋，也可能制造戏剧。"],
    queen: ["敏感女性", "爱心", "被动", "美感", "圣杯王后温柔敏感、充满爱心，喜爱美好事物，但受伤时可能变得狭隘。"],
    king: ["善良男性", "艺术气质", "宗教性", "慷慨", "圣杯国王善良、艺术感强、内心慷慨，有时像宗教或牧者式人物。"]
  },
  swords: {
    ace: ["法律", "敌人", "冲突", "责任", "宝剑王牌带来空气的锋利：法律、冲突、敌意、重责和艰难变化。"],
    two: ["和平提议", "辩论", "写作", "知识讨论", "宝剑二让对立双方进入对话，可从争论中产生有用的友谊或知识成果。"],
    three: ["分离", "破裂", "幻灭", "失落", "宝剑三是关系或结构的破裂、分离、敌意和幻灭。"],
    four: ["疾病", "疲惫", "退缩", "休息", "宝剑四要求退隐、休息、等待，让身体和思想从疲惫中恢复。"],
    five: ["挫折", "暂败", "重整", "决心考验", "宝剑五是暂时失败后的重整，考验你在失面子或挫折后是否仍能站稳。"],
    six: ["旅程", "远离困难", "保存知识", "水上移动", "宝剑六带来旅行、离开困难，以及把知识安全保存到未来。"],
    seven: ["避灾", "策略", "神圣帮助", "法律援助", "宝剑七是避开灾难的策略，也可能显示精神帮助、法律援助或安全加固。"],
    eight: ["被困", "恐惧行动", "不公", "欺凌", "宝剑八显示被困、行动恐惧、监禁或不公，越犹豫局面越恶化。"],
    nine: ["攻击", "怀疑", "悲伤", "痛苦", "宝剑九是仇恨、攻击、怀疑和精神痛苦的压力峰值。"],
    ten: ["失败", "崩溃", "最低谷", "黎明前黑暗", "宝剑十是彻底低谷与剧烈痛苦，但也意味着最黑暗处已接近转折。"],
    page: ["新月", "秘密敌人", "隐藏沟通", "困难孩子", "宝剑侍者显示隐藏敌意、暗中沟通、困难孩子或尚未显露的冲突。"],
    knight: ["不可信", "冷漠", "操控", "恶意", "宝剑骑士是冷漠而危险的年轻力量，善于伪装、操控，可能无情。"],
    queen: ["意志坚定", "法律头脑", "领地意识", "冷智慧", "宝剑王后意志强、智慧锋利、边界清楚，被触犯时会成为强敌。"],
    king: ["权威男性", "法律", "军事", "技术", "宝剑国王是法律、军事、高等教育或数字技术领域的权威，可成为强力帮助者或敌人。"]
  },
  pentacles: {
    ace: ["物质成功", "财务收益", "基础", "身体力量", "星币王牌带来大地的实质：物质成功、稳固基础、身体力量与祖先性保护。"],
    two: ["金钱流动", "平衡", "给予接受", "维持完整", "星币二显示资源进出平衡，强调必要的帮助、交换和身体完整性。"],
    three: ["工作", "职业", "生产力", "具体创造", "星币三是劳动、职业和把想法做成具体事物的生产力。"],
    four: ["财务安全", "谨慎", "囤积", "稳定", "星币四显示安全与稳定，也可能指过度谨慎、囤积或家庭聚会。"],
    five: ["损失", "财务困难", "体力流失", "可克服艰难", "星币五是物质或身体能量的损失，但通常不是灾难，而是可走出的困难。"],
    six: ["报酬", "偿还", "债务", "天秤平衡", "星币六表示得到应得、偿还债务、处理贷款或财务争议中的平衡。"],
    seven: ["满足", "完成", "礼物", "改善", "星币七是辛勤工作后的成果、项目完成、财务改善或意外礼物。"],
    eight: ["工艺", "技艺", "繁荣", "实用发展", "星币八把工艺、技能和劳动果实转化为繁荣与实用自我发展。"],
    nine: ["丰盈", "资源", "怀孕", "安全", "星币九是资源、丰收、物质回报、安全和被赠予的满足感。"],
    ten: ["财富", "财产", "长期资源", "资源负担", "星币十显示长期资源、财产与财富，也提示资源本身可能成为负担。"],
    page: ["财务信件", "强壮孩子", "新生长", "象征礼物", "星币侍者带来财务消息、新生长、花园、孩子或一份象征性礼物。"],
    knight: ["勤奋年轻人", "温和", "身体享乐", "被动攻击", "星币骑士勤奋、温和、务实，但受冒犯时可能表现得被动攻击。"],
    queen: ["大地母亲", "家庭", "园艺", "保护", "星币王后实用、稳重、重视家庭与土地，保护性强，也可能占有和控制。"],
    king: ["财富人物", "金融", "农业", "成熟可靠", "星币国王掌握实质资源，成熟勤奋、可靠，会保护自己的利益。"]
  }
};

function reverseKeywords(words) {
  return ["受阻的" + words[0], "失衡", "过度", "需要校准"];
}

function reversedText(cardName, uprightText) {
  return cardName + "逆位时，这股力量不是消失，而是受阻、过量或方向错位。请回到它的正位主题，检查哪里需要节制、承担或重新平衡。";
}

function getCardImagePath(cardId) {
  return `assets/cards/${cardId}.jpeg`;
}

function buildMinorArcana() {
  const cards = [];
  for (const suitKey of Object.keys(minorArcanaSuits)) {
    const suitInfo = minorArcanaSuits[suitKey];
    for (const rankInfo of minorRanks) {
      const entry = minorMeanings[suitKey][rankInfo.rank];
      const id = `minor-${suitKey}-${rankInfo.rank}`;
      const name = `${suitInfo.name}${rankInfo.number}`;
      const uprightKeywords = entry.slice(0, 4);
      const uprightMeaning = entry[4] + " " + numberDynamics[rankInfo.rank];
      cards.push({
        id,
        name,
        arcana: "minor",
        suit: suitInfo.name,
        element: suitInfo.element,
        direction: suitInfo.direction,
        uprightKeywords,
        reversedKeywords: reverseKeywords(uprightKeywords),
        uprightMeaning,
        reversedMeaning: reversedText(name, uprightMeaning),
        image: getCardImagePath(id),
        source: quareiaSource
      });
    }
  }
  return cards;
}

tarotDeck.forEach(function (card) {
  card.source = quareiaSource;
  card.image = getCardImagePath(card.id);
});

const minorArcana = buildMinorArcana();
const tarotDeckFull = [...tarotDeck, ...minorArcana];

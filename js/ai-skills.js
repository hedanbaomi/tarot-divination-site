(function (global) {
  "use strict";

  var RAW_SKILL_MODES = [
    {
      id: "auto",
      labelZh: "奥莉薇娅",
      labelEn: "Olivia",
      descZh: "内置人格包：塔罗咨询师 · 非暴力沟通 · 盘面镜像",
      descEn: "Built-in persona: tarot counselor with an NVC backbone"
    }
  ];

  var SKILL_MODES = (global && typeof global.Array === "function" && typeof global.Array.from === "function")
    ? global.Array.from(RAW_SKILL_MODES)
    : RAW_SKILL_MODES;

  var VALID_SKILL_MODES = {
    auto: true
  };

  var TAROT_SUIT_META = {
    wands: { zh: "权杖", en: "Wands", elementKey: "fire", elementZh: "火", elementEn: "Fire" },
    cups: { zh: "圣杯", en: "Cups", elementKey: "water", elementZh: "水", elementEn: "Water" },
    swords: { zh: "宝剑", en: "Swords", elementKey: "air", elementZh: "风", elementEn: "Air" },
    pentacles: { zh: "星币", en: "Pentacles", elementKey: "earth", elementZh: "土", elementEn: "Earth" }
  };

  var ZH_SUIT_TO_KEY = {
    "权杖": "wands",
    "圣杯": "cups",
    "宝剑": "swords",
    "星币": "pentacles"
  };

  var TAROT_RANK_META = {
    ace: { zh: "王牌", en: "Ace", clusterZh: "王牌（原初高压电涌注入，能量量级等同于10）", clusterEn: "Aces (raw elemental surge, equal to 10 in voltage)" },
    two: { zh: "二", en: "Two", clusterZh: "二（二元拉锯、对话或僵持平衡）", clusterEn: "Twos (polarity, dialogue, or stalemate)" },
    three: { zh: "三", en: "Three", clusterZh: "三（两股力量碰撞催生具体行动或第三物）", clusterEn: "Threes (synthesis producing concrete action or outcome)" },
    four: { zh: "四", en: "Four", clusterZh: "四（稳定筑基，亦需警惕固化停滞或自满）", clusterEn: "Fours (consolidation that can tip into stasis)" },
    five: { zh: "五", en: "Five", clusterZh: "五（日常人事缠斗、摩擦与生存消耗）", clusterEn: "Fives (ordinary human friction and struggle)" },
    six: { zh: "六", en: "Six", clusterZh: "六（过往记忆、旧债或既有模式余波塑形当下）", clusterEn: "Sixes (past memory, debts, or inherited patterns)" },
    seven: { zh: "七", en: "Seven", clusterZh: "七（心智与抗压成熟前的关键试炼）", clusterEn: "Sevens (maturation test under pressure)" },
    eight: { zh: "八", en: "Eight", clusterZh: "八（突发震醒与既有秩序重排）", clusterEn: "Eights (awakening shock and reorganization)" },
    nine: { zh: "九", en: "Nine", clusterZh: "九（前期作为结出熟果，因果显影）", clusterEn: "Nines (ripened cause-and-effect harvest)" },
    ten: { zh: "十", en: "Ten", clusterZh: "十（当前周期走完峰值，物极必反、即将翻篇）", clusterEn: "Tens (cycle completion—'this too shall pass')" },
    page: { zh: "侍者", en: "Page", isCourt: true, clusterZh: "侍者（消息、学徒起步或稚嫩新动向）", clusterEn: "Pages (messages, beginners, or nascent ventures)" },
    knight: { zh: "骑士", en: "Knight", isCourt: true, clusterZh: "骑士（快速推进、锋芒外露但欠稳重的行动者）", clusterEn: "Knights (fast-moving, volatile agency)" },
    queen: { zh: "王后", en: "Queen", isCourt: true, clusterZh: "王后（向内承载、浸润与深层影响他人的成熟力量）", clusterEn: "Queens (inward mastery and formative influence)" },
    king: { zh: "国王", en: "King", isCourt: true, clusterZh: "国王（掌管边界、资源与决断的成熟权威角色）", clusterEn: "Kings (commanding authority, boundaries, and accountability)" }
  };

  var TAROT_RANK_COMPACT_ACTION_ZH = {
    ace: "原初入口与高能火种迸发",
    two: "二元拉锯与对话平衡",
    three: "两股力量结合催生行动成果",
    four: "稳固筑基（亦需防固化停滞）",
    five: "日常交锋与生存摩擦消耗",
    six: "过往记忆与旧模式余波传导",
    seven: "承压试炼与心智磨熟",
    eight: "突发震醒与既有格局重排",
    nine: "前期作为结出因果熟果",
    ten: "阶段走完峰值、物极必反翻篇",
    page: "新消息传递与学徒起步动向",
    knight: "快速推进但尚欠沉稳的行动势能",
    queen: "向内承载、涵养与深层浸润影响",
    king: "掌管边界、资源与成熟决断的人物力量"
  };

  var TAROT_RANK_COMPACT_ACTION_EN = {
    ace: "raw elemental surge & root gateway (voltage equal to 10)",
    two: "polarity, dialogue, or stalemate balance",
    three: "two forces combining into concrete action or outcome",
    four: "stabilizing consolidation (watch for stagnation or complacency)",
    five: "ordinary human friction, contention & survival strain",
    six: "past memory, debts, or inherited patterns shaping the present",
    seven: "maturation test under pressure",
    eight: "awakening shock & structural reorganization",
    nine: "ripened cause-and-effect harvest",
    ten: "cycle completion at peak—about to turn the page",
    page: "incoming message, student/beginner, or nascent venture",
    knight: "fast-moving, volatile agency not yet fully seasoned",
    queen: "inward mastery, containment & formative influence",
    king: "mature authority governing boundaries, resources & accountability"
  };

  var TAROT_QUAREIA_OVERRIDES = {
    "major-00": {
      zh: "零点空白、天真无防备、尚未成形或不在该处（Quareia原义：忌套流行鸡汤的浪漫追梦冒险）",
      en: "Zero-point emptiness, naivety, unformed blankness, or 'not there' (Quareia canon: never romanticize as carefree adventure)"
    },
    "major-06": {
      zh: "对等契约、合伙协议、深层结盟与两股力量的平衡（Quareia原义：重在契约与力量对等，不局限于浪漫恋爱）",
      en: "Binding agreement, partnership contract, union & equal balance of power (Quareia canon: weigh contractual parity, not mere romance)"
    },
    "major-12": {
      zh: "沉重的考验、不得不付出的牺牲、道德义务与受困停摆（Quareia原义：严酷磨难与责任，忌轻描淡写为「换个角度看世界」）",
      en: "Heavy ordeal, necessary sacrifice, moral duty & suspension under strain (Quareia canon: real sacrifice—not casual 'shift your perspective')"
    },
    "major-14": {
      zh: "风暴后的必要性调和、克制节度、主动疗愈与保护性过渡（Quareia原义：重在「必要性」与灾后修复前行）",
      en: "Necessity, post-crisis moderation, active healing & protective restraint enabling forward motion"
    },
    "minor-wands-seven": {
      zh: "",
      en: "Holding ground with determination against odds | Health nuance: minor illness, stamina strain, or primary immune defence"
    },
    "minor-swords-ace": {
      zh: "",
      en: "Sharp mental breakthrough, law, conflict, enemies, accountability & decisive boundary"
    },
    "minor-swords-four": {
      zh: "",
      en: "Truce, quiet convalescence, enforced rest, or illness/exhaustion requiring recovery"
    },
    "minor-swords-page": {
      zh: "",
      en: "Vigilant observation, sharp message/inquiry, or a covert/secret adversary watching"
    }
  };

  var TAROT_NUMBER_DYNAMICS_SENTENCES_ZH = [
    "王牌放大本元素，是入口、种子和单一力量的爆发。",
    "二带来极性、对话、冲突与互相平衡。",
    "三让两股力量结合并产生具体行动或成果。",
    "四使元素稳定汇聚，也可能让局面静止。",
    "五对应日常斗争、挑战与生存压力。",
    "六承载过去、记忆、继承与旧模式的影响。",
    "七推动心灵和灵魂的成熟。",
    "八带来觉醒事件，让人从日常沉睡中被唤起。",
    "九显现因果，过去的行为结出现在的果实。",
    "十表示循环圆满，当前阶段正在走向结束。",
    "侍者带来消息、初学者、孩子或新生项目。",
    "骑士表现年轻、移动、个性鲜明但尚未完全成熟的力量。",
    "王后表现成熟、承载与影响他人的阴性力量。",
    "国王表现成熟、负责、掌握资源或权威的人物力量。"
  ];

  var LXXXI_ROOT_POWERS = {
    1: "I",
    2: "II",
    3: "III",
    7: "IV",
    8: "V",
    9: "VI",
    10: "VII",
    11: "VIII",
    12: "IX",
    27: "X"
  };

  // Only genuine mild everyday check cards keep Minor Check Card tag (54 Bailiff & 67 Idiot carry critical warnings)
  var LXXXI_SMALL_CHECK_CARDS = {
    53: true,
    65: true
  };

  var LXXXI_COMPACT_ZH = {
    1: { kw: ["未成形潜能", "最初火种", "迈出第一步", "新方向萌芽"], cue: "未成形的新潜能与最初火种刚跨过分水岭，需结合邻牌看其落地形貌", eso: "神圣意志最初的创造火花跨界流入，尚未定型" },
    2: { kw: ["孕育筹划", "划定界限", "新时间窗口", "期限延展"], cue: "新时间窗口与命运周期正在编织成形，字面亦可指宽限时间或前期筹划", eso: "神圣之光开始塑造时间轴与显化边界，赋予进程时间容器" },
    3: { kw: ["功成身退", "归藏休眠", "收敛锋芒", "深层庇护"], cue: "阶段使命完成后撤回休眠与受护状态，宜收敛外推、静养藏锋", eso: "力量脱离显化循环撤回神圣源头与庇护殿堂，不再外显作用" },
    4: { kw: ["高压临界", "保护性屏障", "暂停观望", "严禁强闯"], cue: "已触及不可强闯的保护性极限屏障，必须停步静候，强行越界必受反冲", eso: "抵达神界守门双天使的能量屏障，凡人意识此刻不可强行穿越" },
    5: { kw: ["谷底转折", "失控风险", "破釜沉舟", "急需转向"], cue: "逼近无回头路的谷底转折或失控剧痛，唯有极度清醒止损方可安全转向", eso: "纵贯诸界的深渊通道开启，踏出即无回头路的重生或毁灭关口" },
    6: { kw: ["十字路口", "命运受护", "防过早冒进", "稳妥桥接"], cue: "关键十字路口的保护性拦截与桥接，防止你在错误时机盲目抢跑", eso: "深渊守卫架起上下跨界之桥，校准通行时机并护持来者抉择" },
    7: { kw: ["破局开路", "新径贯通", "充沛动能", "暗处见光"], cue: "隧道尽头破局开路的建设性力量，新通道正获充沛动能支撑向前", eso: "内在领域开路天使将本源脉动导入物质通道，铺设未来命运轨迹" },
    8: { kw: ["制动扣留", "受限停摆", "封锁降温", "被迫休眠"], cue: "强力制动、扣留与封锁机制启动，令过热或失序进程暂停停摆", eso: "内在天平的回收制动端发力，扣押不合时宜的流动以维持深层平衡" },
    9: { kw: ["动态平衡", "和谐成局", "支点责任", "缓冲凶牌"], cue: "高压动态平衡与和谐成局，需定力维系支点｜同盘缓冲判词：若伴随凶牌无需害怕，它们只是达成平衡过程的一部分", eso: "光之承载与监禁者之间的玛亚特支点就位，创造与消解力量完全对等" },
    10: { kw: ["高强度打磨", "必要磨砺", "自律硬仗", "淬炼真功"], cue: "无法绕开的高强度实干、纪律约束与硬仗，借压力把生铁锻造成器", eso: "土星式砥砺天使收紧边界、放慢节奏，以严苛打磨塑形内在容器" },
    11: { kw: ["纪律松脱", "放纵失控", "解开死结", "过剩增生"], cue: "纪律松脱、放纵失控或旧制瓦解｜正向：松绑过严束缚、解开死结｜健康/物质过剩：细胞失控增生、肥胖或囤积过载", eso: "分解者与砥砺石互为天平：缺乏自律则引向崩解，受控则松解僵局" },
    12: { kw: ["跨界转化", "灵感涌流", "构想落地", "新机孕育"], cue: "内外转化的桥梁已通，酝酿中的创意、灵感或新生活正跨过门槛落地", eso: "界线守卫把内在织物炼金转化为外在形态，并护卫梦境与灵视边界" },
    13: { kw: ["安全避难", "暂停休整", "疗愈恢复", "慈悲护持"], cue: "下一步尚不安全，须先退回安全港湾暂停休整、养精蓄锐后再出发", eso: "灵魂保护者展开斗篷庇护困顿疲惫之魂，提供跨阶段前的安息重整" },
    14: { kw: ["底层织局", "长远基业", "新项目奠基", "字面怀孕"], cue: "大型长期格局、新项目基业正在底层织机精密成形｜健康/备孕语境：字面指向已怀孕或妊娠可能", eso: "创造织者汇聚光与力量编织长期命运母版，奠定深层结构根基" },
    15: { kw: ["未知变量", "隐而不显", "静待揭晓", "深层直觉"], cue: "局中存在必不可少但暂未显露的隐藏变量，勿急于求全，静待真相浮出", eso: "神圣意识流经隐秘知识过滤网，深藏奥秘需经长期沉淀方能开启" },
    16: { kw: ["深层指引", "直觉校准", "内在中枢", "超越个人眼界"], cue: "深层直觉与内在准则正在幕后校准外在局势，宜退回内心安静核对方向", eso: "内在神殿开启，与高阶内在联系者及神圣秩序建立中枢共振" },
    17: { kw: ["良师引路", "系统研习", "打磨新技", "诚实求知"], cue: "正直可靠的引路人或正式进修阶段开启，适合踏实研习新技能与专业知识", eso: "内在图书馆员开启知识宝库，召唤严谨求实的深层学习与传承" },
    18: { kw: ["暗中护持", "并非独行", "同行见证", "不代劳助长"], cue: "你并非孤军奋战，背后有稳健向导陪同，但向导只指路助你成长、绝不替你代劳", eso: "内在同伴贴身守望与协同工作，在关键旅途上提供无声护航" },
    19: { kw: ["前路受阻", "保护性封路", "险境止步", "慢行审视"], cue: "前路被挡实为保护，门槛之外潜藏风险，务必停步自省、切勿强行闯关", eso: "内在荒漠守卫封锁未成熟的越界通道，防止心智贸然踏入险境" },
    20: { kw: ["关键讯息", "公开发声", "教学讲演", "审慎立言"], cue: "重要消息、通知或公开发声（写作、讲演、谈判）即将到来，务必字斟句酌", eso: "发言者传导塑造现实的真言振动，话语出口即成因果契约" },
    21: { kw: ["重归公允", "因果清算", "法律法院", "天平复位"], cue: "失衡局面正在恢复公允｜字面专向：法院诉讼、法律规章、合同审计与公正裁断", eso: "正义守卫执掌因果天平，令偏离失序之物按客观法则归位" },
    22: { kw: ["重要行程", "交通车辆", "异地变动", "命运换轨"], cue: "伴随局势转折的重要出行或异地推进启动｜字面器物：汽车、车辆与运输方式", eso: "载具与跨界移动之力激活，推动生命轨迹驶入新阶段舞台" },
    23: { kw: ["命运转轮", "周期更替", "变局开启", "顺势换道"], cue: "无论顺逆，一轮实质性变局已开始转动，打破停滞并推开新阶段大门", eso: "命运之轮旋动大周期更替，要求顺应潮汐转向而非死守旧位" },
    24: { kw: ["新局触发", "命运馈赠", "方向确立", "生机注入"], cue: "全新的重要周期与发展方向已被正式触发，起点条件就位、可顺势起步", eso: "命运给予者将新一段生命线织入现实，开启建设性新篇章" },
    25: { kw: ["周期稳行", "节奏受控", "持守定局", "时机恰当"], cue: "既定进程正按应有节奏稳步运转并被牢牢托住，无需拔苗助长，守正即可", eso: "命运持有者稳固当前时间线与结构张力，令事态按精确时序成熟" },
    26: { kw: ["周期收束", "清理退场", "腾出空间", "时态分流"], cue: "旧历程收束清场为新周期腾空间｜落点时态分流：落内在/远期位=结束时间已在后台排定但尚未显化；落物质现实位=终结已在眼前表露", eso: "命运收回者剪断已完成使命的旧线，清空容器迎接下一轮循环" },
    27: { kw: ["落地成局", "圆满收成", "合适居所", "扎根大地"], cue: "事情扎实落地并结出成果｜字面选址：已找到真正适合自己的房产、居所或土地", eso: "十大核心力量最终落脚于大地之母X，内在构想在物质世界圆满显化" },
    28: { kw: ["充沛生机", "显赫成果", "能量储备", "局部过热"], cue: "充沛活力、预备资源与可见成功照亮局面｜健康/过载分支：火力过猛集中引发炎症、高热或灼烧", eso: "太阳原初热能注入物质场域，带来强劲生长力与清晰显影" },
    29: { kw: ["迷雾遮蔽", "信息残缺", "情绪戏剧化", "暗藏隐情"], cue: "全貌仍被迷雾、情绪戏码或隐瞒欺骗遮挡，并对邻牌投射幻影，看清底牌前切忌轻信盲动", eso: "月相潮汐与幻影折射干扰视线，需穿透表象迷障辨识隐伏因素" },
    30: { kw: ["身心修复", "最坏已过", "静养回血", "受护康复"], cue: "最煎熬的关口已过，身心或局势正进入修复期，眼下需要安静受护的恢复空间", eso: "疗愈之地张开洁净结界，承接创伤后的深层再生与元气归位" },
    31: { kw: ["清凉活水", "灵感泉涌", "体液调理", "润泽焕新"], cue: "如清泉注入般带来降温、灵感与健康创造力｜健康语境：体液循环滋润与再生恢复", eso: "生命活水流动润泽干涸场域，激活深层直觉与生机循环" },
    32: { kw: ["传统技艺", "老派智慧", "家族护荫", "古老组织"], cue: "老一辈经验、传统手艺、家族先祖或表面低调但底蕴犹存的老牌组织正在提供支撑", eso: "祖庙传承与在地先祖智慧活跃，输送久经考验的技艺与护持" },
    33: { kw: ["专业机构", "医院高校", "政府规章", "僵化自缚"], cue: "顺位：专科医院、高校、法院或政府等专业机构与制度支撑｜落凶位/受阻位反转：执着于过时僵化的体制外壳或过度包装，须放手突破限制", eso: "有组织的专业殿堂与集体规训力量介入当前课题" },
    34: { kw: ["梦境讯息", "深层睡眠", "潜意识灵感", "静心沉淀"], cue: "留意近期睡眠质量、梦境提示与安静独处时浮现的深层灵感，身体亦需补觉", eso: "梦之河连通潜意识与灵视水路，连接先祖与内在联系者的夜间讯息通道" },
    35: { kw: ["退入过去", "旧事余波", "双向门槛", "忌恋旧退缩"], cue: "旧事正退入过去但双向门仍可回潮｜落凶位/阻碍位警示：当事人正死抓过去不放或往后退缩，破局关键在于彻底了结旧账往前走", eso: "过去之门呈双向开启，退场之物若未妥善了结仍可能回返" },
    36: { kw: ["家宅根基", "家庭责任", "日常烟火", "归属之地"], cue: "家庭、居所、亲族责任或最核心的归属圈是眼下整件事的重心所在（字面亦指房子与家人）", eso: "家与壁炉锚定世俗安身容器，守护日常生活的稳定温度" },
    37: { kw: ["前路扫清", "坦途开启", "直球推进", "前景明朗"], cue: "前方障碍已被扫清，一条清晰直接的行动通道正式打开，为挣扎者亮起隧道尽头之光", eso: "赫丘利试炼之路豁然贯通，历经磨砺后迎来明朗前程" },
    38: { kw: ["迎难而上", "先苦后甜", "硬仗立威", "越挫越强"], cue: "眼前可能有一场硬仗或逆境考验，应对过程有助于积累实力，结果仍需结合其他牌判断", eso: "神之挑战以逆境试金，应对考验可以磨炼实力与推动进阶" },
    39: { kw: ["向内退守", "安静独处", "私密空间", "休养定神"], cue: "外在喧嚣无益，宜暂时关起门来退回绝对安全的私密空间静心休整", eso: "退入内在圣所闭关沉淀，校准心神核心而不受外界侵扰" },
    40: { kw: ["资金粮草", "精力储备", "可用资源", "防透支枯竭"], cue: "顺位：资金、食物、精力等必要粮草在场可用｜落扣押/过去/冥界位反转：警示资源已近耗尽或远少于预期，切忌盲目透支", eso: "支撑工作运转的实质能源、生命力与物质补给水位显影" },
    41: { kw: ["暗中指点", "直觉预警", "贵人点拨", "梦中提醒"], cue: "有过来人建议、敏锐直觉或故人/地利在关键处点拨提醒，留心听取劝告", eso: "指导灵、故人或土地守护灵正借征兆与梦境传递护持建议" },
    42: { kw: ["深藏不露", "强悍护短", "打破常规", "不可小觑"], cue: "表面低调却手腕老辣、不按世俗规矩出牌的强悍女性或力量在场，为护所珍视之物不惜强硬反击", eso: "哥布林皇后式的原野阴性主权：精明、独立、严守领地边界" },
    43: { kw: ["反复无常", "搅局添乱", "言而无信", "心神欠安"], cue: "警惕身边靠不住、爱无端搅局或情绪失衡之人带来麻烦｜身心分支：亦指心神不宁或身体欠安时期", eso: "妖精国王式的无序扰动力量介入，诱发失衡与不可预测的折腾" },
    44: { kw: ["家族习气", "遗传基因", "原生烙印", "代际延续"], cue: "家族遗传基因、原生家庭习气或祖辈传下的禀赋与老问题正在背后深刻塑形当下", eso: "血脉先祖的基因记忆与远古沉睡血缘力量在场域中活跃显影" },
    45: { kw: ["暗处作祟", "表里不一", "旧影纠缠", "字面闹鬼"], cue: "有人表里不一、戴着面具在暗处搞小动作，或旧账残影纠缠｜字面灵异：场所滞留灵体出没", eso: "鬼魂或未入轮回的滞留残影纠缠场域，提示看穿伪装并清理执念" },
    46: { kw: ["单向吸血", "搭便车利用", "精力透支", "慢性消耗"], cue: "单向吸血的寄生关系、搭便车占便宜的假朋友，或慢性耗能的环境/身体隐患（虽非致命绝症但持续掏空精力，须果断切割）", eso: "能量寄生物附着抽取生命力，必须识别宿主漏洞并彻底剥离" },
    47: { kw: ["提前预警", "苗头初显", "及早排雷", "防患未然"], cue: "麻烦、变故或疾病苗头提前亮起红灯｜行动铁律：此刻趁未成形及早干预即可闪避或止损，拖延不理才会酿祸", eso: "报丧女妖式的先兆预警信号亮起，趁命运凝固前及早干预修正" },
    48: { kw: ["表面光鲜", "自欺欺人", "障眼迷魂", "转移焦点"], cue: "光鲜假象取代了真实底牌——有人放烟雾弹误导你转移焦点，或你自己正被虚荣自欺迷住双眼", eso: "魅惑障眼法扭曲认知，须剥去华丽包装直视朴素事实" },
    49: { kw: ["软肋暴露", "定力失守", "情绪破口", "健康薄弱点"], cue: "情绪、生理健康或判断力上的软肋正暴露在诱惑与高压下，切忌因贪快或意气做错决定", eso: "内在薄弱点受试探牵引，守住心性底线方免连锁失守" },
    50: { kw: ["背锅顶雷", "转嫁责任", "代人受过", "主动挑担"], cue: "双向判词：警惕有人推卸甩锅让你代人受过，或指自愿替他人挑起沉重担子——须结合牌位厘清责任边界", eso: "替罪与代受机制运作，分辨是恶意嫁祸还是清醒的责任分担" },
    51: { kw: ["身体抱恙", "过劳预警", "无凶自愈", "伴凶就医"], cue: "身体抱恙或过劳信号｜同盘分流标尺：若全盘无恶牌多属短期无生命危险小病，减负休息即可自愈；若落核心位且伴随破坏牌，须立即就医并调整生活方式", eso: "疾病失衡显化于肉体或能量容器，棘手慢病需长期温和调养对策" },
    52: { kw: ["正面交锋", "恶意攻讦", "激烈口角", "严密设防"], cue: "存在明显的敌意、激烈争吵或针对性攻击，需结合落点看清来路、冷静加固防线，勿赤膊拼情绪", eso: "外在或能量层面的攻击性冲击逼近，须稳守边界理性评估防御" },
    53: { kw: ["雪中送炭", "实质补给", "药物钱粮", "恰逢所需"], cue: "急需的钱款、食物、房产、药物或人脉支持正及时给予或接收（日常温和补给牌，务实接纳即可）", eso: "赠礼者带来恰如其分的日常扶持与必要资源流转" },
    54: { kw: ["罚单欠账", "必要破财", "财物失窃", "重估治疗"], cue: "必须结清的还款、罚款或代价｜字面失窃：某物被偷走｜重症健康落死亡/死亡之桥位：警示当前治疗方向需立即重新评估（改对方向则带走疾病而非人命）", eso: "执行官/死亡天使按律收取应付代价，结清因果欠账后即可翻篇" },
    55: { kw: ["长辈明师", "老练经验", "务实指点", "阅历智慧"], cue: "阅历深厚的长辈、老师或行家提供接地气的指点，亦指步入成熟阶段凭自身过往苦功沉淀出的真智慧", eso: "岁月淬炼的明师智慧在场，以平实经验校准方向" },
    56: { kw: ["亲友后盾", "同道扶持", "团契共振", "凶位防损友"], cue: "顺位：亲友、老搭档或志同道合圈子在默默支持守护｜落凶位/阻碍位反转：警告正被所处圈子或团体卷入冲突与危险", eso: "良性团契与更广大的同行网络共振（凶位则警示群体漩涡拖累）" },
    57: { kw: ["重要信函", "关键通话", "书面记录", "著作研读"], cue: "关键信件、电话、合同文书或正式谈话需全神贯注处理，亦指把经验知识落笔成文记录传承", eso: "信息传递与抄写传承节点激活（若与先知同现则须立即响应内在传讯）" },
    58: { kw: ["闭门谢客", "独处回血", "暂离社交", "避开乱流"], cue: "必须暂时退出社交应酬与外界乱流，待在安全家中保持低调、静养恢复元气后再重新出山", eso: "主动隐退入静，隔绝地域蔓延的混乱能量以完成内在修复" },
    59: { kw: ["受限减速", "言路受阻", "肢体受限", "缺觉缺食"], cue: "进程被按下减速键（保护栏或过严压制）｜健康/日常字面：肢体因外伤病痛活动受限，或单纯睡眠不足、饮食摄入不足", eso: "东方风之限制器运作：裁切多余枝蔓、收束心智散乱" },
    60: { kw: ["命运点火", "冷静果断", "局势升温", "防火过载"], cue: "命运火流已被强力触发，须采取坚定而冷静的行动推开未来｜过载警示：火能极不稳定，忌滥用蛮力怒火反伤自身", eso: "南方神之权杖引燃命运火流，人神各尽其责共同开辟前路" },
    61: { kw: ["活水回春", "苦尽甘来", "情绪疗愈", "元气再生"], cue: "凛冬过后的回春活水，预示长期病痛、虚弱或重压即将结束，身心与局势迎来滋润回血", eso: "西方重生之水洗涤疲惫残损，带来深层疗愈与周期完成后的新生" },
    62: { kw: ["扎实立基", "长期基业", "稳固根盘", "土地定锚"], cue: "一项长周期事业、建筑、组织或生活安排正建立在极其稳固的根基与土地之上", eso: "北方大地基石落定，以山岩大地之力提供不可动摇的定锚守护" },
    63: { kw: ["资深权威", "学术导师", "体制教席", "正统传承"], cue: "资深教授、行业泰斗、宗教或体制权威人物（不论男女）介入此事并握有深厚话语权", eso: "神职与正统法脉原型在场，代表严整规范与深层奥秘传承" },
    64: { kw: ["缔结契约", "婚姻合伙", "深度绑定", "利益合流"], cue: "核心聚焦于婚姻、商业合伙、正式签约或两股力量的深度绑定（结合牌位看该绑定带来助力还是牵制）", eso: "两极力量正式结合缔约，形成休戚与共的能量联合体" },
    65: { kw: ["稚嫩新苗", "字面孩童", "尚需呵护", "初创阶段"], cue: "字面指向具体孩童，或代表刚起步、有潜力但尚稚嫩的新计划，需耐心护苗而非急催收成", eso: "初生新芽承载纯粹潜能，需时间与保护方能长成" },
    66: { kw: ["年长前辈", "岁月磨损", "老成持重", "衰老疲惫"], cue: "涉及年长者与老道经验｜健康/器物分支：衰老相关症状、体力耗损觉得又老又累，或老旧设施自然磨损", eso: "老灵魂的深厚阅历与时间留下的物质风化印记并存" },
    67: { kw: ["否与零点", "无视危机警告", "愚行招祸", "空洞伪问题"], cue: "极性直断：否 / 零 / 空无一物｜严厉警告：正无视眼前迫近的危机预警（如火烧眉毛仍死抱书本）做蠢事招灾，或所问本身毫无意义", eso: "盲目愚行与空洞消耗，警示立即停下自毁式麻木或无果空转" },
    68: { kw: ["权术操控", "被动攻击", "不成熟权威", "暗中拿捏"], cue: "有人玩弄权术、被动攻击或以不成熟的控制欲暗中操纵局面，亦警示检视自身是否在搞权力游戏", eso: "失衡术士原型：早期不成熟阶段将技艺用于狭隘控制而非服务" },
    69: { kw: ["成熟掌舵", "靠谱担当", "统筹资源", "稳健领航"], cue: "成熟负责的掌舵者或权威人物（不论男女）在场，能够在力量与服务间保持平衡并提供实质资源与指引", eso: "健全领袖原型：以自律与公心承载权威、贯通内外秩序" },
    70: { kw: ["亲近土地", "户外动物", "去浪漫化", "务实自然"], cue: "涉及与土地、农林、动物共事之人，或提醒打破城市人对自然的浪漫幻想、用务实方式重新接地气", eso: "自然之人致力于守护土地、动物与大地生灵的质朴法则" },
    71: { kw: ["深度内省", "安静独行", "追寻意义", "远离浮躁"], cue: "性格深思内敛之人，或一段主动远离世俗喧嚣、安静探求核心生命意义的沉淀期", eso: "神秘主义者穿过日常杂音，全心投入内在灵性深处的探索" },
    72: { kw: ["激烈冲突", "暴怒失控", "字面火灾", "高烧急症"], cue: "破坏性怒火、激烈争吵或强硬摧毁者逼近（亦防自身沉迷好斗）｜字面灾害与健康：房屋失火/火灾隐患，或急性严重感染与高烧", eso: "男武士爆裂火能接管场域，失控则成杀戮破坏，务必降温制动" },
    73: { kw: ["敏锐直觉", "关键传讯", "听懂真意", "忌弃基本功"], cue: "灵通敏锐之人或关键直觉讯息传来，务必听懂真意｜负面警示：切忌过度依赖天生直觉而荒废扎实基本功训练与事实核查", eso: "先知通道传来深层神谕讯息，需客观接收并以系统训练托底" },
    74: { kw: ["强势主见", "女性领军", "防专断失控", "破僵化体制"], cue: "强大女性主导力与决断力（防滑向专断控制）｜体制警示：女性或柔韧力量在男性化僵化旧系统中受限或被迫扮演刻板角色，须忠于自身本色", eso: "魔法女祭司统御深层权柄，突破陈旧框架并在意志与平衡间稳行" },
    75: { kw: ["挺身抗争", "捍卫公义", "迎战病痛", "有纪律反击"], cue: "必须硬气站出来对抗病痛、顶住不公或保护弱者——借有纪律的守护锋芒破局（常需付出不小代价），而非情绪失控", eso: "女武士执限制器披挂上阵，从至暗处劈开失衡以重建秩序" },
    76: { kw: ["修复启动", "温柔护持", "抚平创伤", "忌教条束缚"], cue: "温和坚定的疗愈过程已启动，带来保护、关爱与情绪疏导（此类滋养力量在死板教条制约下无法施展，需留出自由空间）", eso: "治疗者导入深海母性再生水脉，缝合创口并恢复生机和谐" },
    77: { kw: ["野性独立", "大隐隐于市", "不拘俗套", "顺应天性"], cue: "外表低调常被忽视、实则力量深厚且高度独立的成熟女性或良师，按客观自然法则而非世俗陈规行事", eso: "女萨满融通大地古脉与风中神谕，跳出人为教条自在整合力量" },
    78: { kw: ["陈年隐疾", "暗藏议程", "感染旧痛", "深层排毒"], cue: "过去隐情、固有失衡或未愈旧痛重新浮出水面｜健康分支：感染、潜伏隐疾或躯体失衡阵痛正待清理", eso: "地下世界森林连接先祖、梦境与死亡水脉源头，显露深层待化阴影" },
    79: { kw: ["濒临决裂", "最后缓冲桥", "悬崖勒马", "恶况终结"], cue: "照当前势头继续硬推将造成永久终结，但此刻仍站在可回头的缓冲桥界——及时撤回可免毁损（正面亦指坏局面即将跨过终点结束）", eso: "踏上横跨死亡之河的临界桥：跨过即彻底终结，亦指冥想梦中护送过渡" },
    80: { kw: ["彻底句号", "不可逆终结", "冬季封藏", "器物报废"], cue: "某事画上彻底不可逆的句号｜时间季节：冬天草木凋零｜日常器物：车子、设备或旧关系彻底报废无法修理，宜干脆放手", eso: "死亡领域完全落定，不再属于物质世界之物彻底谢幕归零" },
    81: { kw: ["剧烈清盘", "重创瓦解", "破旧开路", "结合全局定尺度"], cue: "剧烈冲击终结失衡旧局｜量级与破立校准：务必结合全盘看清尺度——常指为更好新局开路的清盘（如丢工作、撞毁车但人平安无伤），勿盲目恐慌", eso: "毁灭脉动在大地立基前强行清场腐朽容器，必须严看前后牌脉络" }
  };

  var LXXXI_EN_SUPPLEMENTS = {
    9: "Buffer rule: if harsh cards appear alongside Pure Balance, do not panic—they are part of the balancing adjustment.",
    11: "Health/material excess nuance: uncontrolled growth, overindulgence, obesity, or surplus accumulation; benignly untying a rigid knot.",
    14: "Health/fertility context: literally indicates pregnancy or conception possibility.",
    21: "Literal legal marker: courts, lawsuits, contracts, or formal impartial judgement.",
    22: "Literal transport marker: a car, vehicle, or physical journey tied to a turn of fate.",
    26: "Positional timing split: in inner/distant-future slots = ending time is set backstage but not yet manifest; in physical slots = ending is already unfolding.",
    28: "Health/excess nuance: 'burning'—too much heat/inflammation concentrated in one area.",
    33: "Negative/blocked slot reversal: clinging to an outdated institutional shell or over-packaging that restricts growth—let it go.",
    35: "Negative/blocked slot warning: clinging to the past or looking backward—close old business and move forward.",
    40: "Withheld/Underworld slot reversal: warns that vital resources are nearly depleted or scarcer than assumed.",
    46: "Non-lethal but chronically draining—free-riders, one-way attachments, or exhausting environments that must be cut off.",
    51: "Context rule: if no harsh cards accompany it, illness is usually brief and self-limiting with rest; if in a major slot with destructive cards, seek medical care and reassess lifestyle.",
    54: "Literal nuances: theft/stolen item; in serious illness on a Death/Bridge slot = urgent warning to reassess medical treatment direction (correcting course removes the illness, not the life).",
    56: "Negative/challenging slot reversal: warns of danger or conflict arising from a group, clique, or circle around you.",
    59: "Health/mundane literal: limb movement restricted by injury, or simple lack of sleep or food.",
    67: "Polarity: hard No / Zero / Nothing. Urgent warning against ignoring obvious danger right in front of you (clinging to books while fire burns), or asking a pointless question.",
    72: "Literal hazard & health: destructive house fire / electrical-fire risk, or acute severe fever and infection.",
    73: "Shadow warning: relying too heavily on raw psychic intuition while neglecting disciplined foundational training.",
    74: "Systemic warning: strong woman or feminine force constrained or stereotyped within a rigid male-coded hierarchy—stay true to authentic power.",
    80: "Season/object literal: winter season; or a car/machine broken beyond repair—full irreversible stop.",
    81: "Scale check: read strictly in context—often clears way for something better (e.g. losing a job or totaling a car without bodily harm)."
  };

  var MYSTAGOGUS_SIGNALS = {
    7: { kind: "yes", zh: "通行路标（倾向「是」：方向正确，果断信任并向前行动）", en: "Green-light signal (leans 'Yes': right path—trust and move forward)" },
    8: { kind: "yes", zh: "见证路标（倾向「是」：有向导在场，须以绝对诚实做出慎重抉择）", en: "Witness signal (leans 'Yes' if chosen wisely and honestly)" },
    16: { kind: "yes", zh: "疗愈绿灯（倾向「是」：修复稳固、药物见效、重归完整）", en: "Healing green-light (leans 'Yes': medicine, fixing, stabilizing)" },
    24: { kind: "yes", zh: "战车通行（明确肯定「是」：向前推进、出行移动、跨界上升）", en: "Affirmative signal ('Yes': forward action, travel, ascent)" },
    30: { kind: "yes", zh: "明灯路标（倾向「是」：点燃内在中心之光，信任自己稳步推进）", en: "Beacon signal (leans 'Yes': trust inner light at the centre)" },
    64: { kind: "yes", zh: "真言路标（明确「是」：事实确凿、正直有益，坦诚直面即可通行）", en: "Truth signal (clear 'Yes': truthful, balanced, and helpful)" },
    67: { kind: "yes", zh: "荣光路标（明确「是」：正向成局、尊重与充沛生机确认）", en: "Splendour signal (clear 'Yes': success, joy, and harmony)" },
    22: { kind: "stop", zh: "死路红灯（明确「否/空」：此路不通，立即停手转向）", en: "Dead-end stop signal (hard 'No' / empty—halt and redirect)" },
    27: { kind: "stop", zh: "荒漠红线（严正警告：已抵强力门槛，切勿再往前越界）", en: "Threshold warning (go no further—powerful boundary)" },
    37: { kind: "stop", zh: "亵渎红灯（明确「否」：环境有毒、贪婪腐败或压迫，远离污染源）", en: "Toxic red-light (hard 'No': corruption, greed, oppression, poison)" },
    52: { kind: "stop", zh: "门槛拦截（明确「否/停止」：保护性守卫拦路，须重新思考勿硬闯）", en: "Threshold block (hard 'No/Stop': protective barrier—rethink)" },
    61: { kind: "stop", zh: "分离路标（倾向「否/离开」：时代结束，果断放手转身往前走）", en: "Separation signal ('No / walk away': let go and move forward)" },
    62: { kind: "wait", zh: "限制减速（倾向「否/等待」：保护性暂停、减量放慢，眼下不宜强求）", en: "Limiter signal ('No / wait': protective pause, slow down, small dose)" },
    70: { kind: "wait", zh: "暂挫路标（当下「否/时机不对」：暂时受挫需认清极限，属黎明前的黑暗而非绝境）", en: "Not-now signal ('No / bad timing': temporary setback—dark before dawn)" },
    72: { kind: "stop", zh: "束缚红灯（明确「否/勿动」：力量被锁定移出流通，当下无法行动）", en: "Binder stop signal (hard 'No / don't': bound up and unable to act)" },
    77: { kind: "stop", zh: "严厉止步（立即停手守密：伤人、泄密或妄动将招致严惩与反噬）", en: "Immediate halt signal (stop & keep silent—reckless harm or leak risks ruin)" },
    78: { kind: "stop", zh: "空容器红灯（明确「否/零」：空壳废话、失能或失忆，勿再徒劳投入）", en: "Empty-vessel stop (hard 'No / Zero': hollow shell, futility, or memory loss)" },
    14: { kind: "wait", zh: "静默路标（闭嘴守密、停手勿问，有些事无需知道，三思而后言）", en: "Silence signal (keep quiet, do not act or pry, guard secrets)" },
    39: { kind: "wait", zh: "幽暗潜行（倾向「否/等待」：局势隐蔽未明，原地踏水、藏锋信直觉）", en: "Obscure-path signal ('No / wait': stay hidden, tread water, trust instincts)" },
    41: { kind: "wait", zh: "退守圣所（「尚未/时机未到」：先隐身退入安全处充电休整）", en: "Sanctuary signal ('Not yet': withdraw, go invisible, recharge in safety)" },
    33: { kind: "gate", zh: "东门时空标（倾向「可能/是」：正在破晓成型的近未来、新知与新入口）", en: "East Gate marker ('Possible / Yes': forming near-term future & new opening)" },
    34: { kind: "gate", zh: "南门时空标（倾向「是/积极」：烈火淬炼后的远期结果与高峰显化）", en: "South Gate marker ('Yes / positive': volatile creative fire & long-term outcome)" },
    35: { kind: "gate", zh: "西门时空标（倾向「大概不是/不再可行」：正在退潮放缓的近期旧事，但双向门仍可能回潮）", en: "West Gate marker ('Probably not / no longer viable': receding recent past that may still echo)" },
    36: { kind: "gate", zh: "北门时空标（明确「否/已逝」：彻底封存翻篇、绝不回头的远古过去）", en: "North Gate marker (hard 'No / gone': closed ancient past that will not return)" }
  };

  // Complete 78-card canonical English fact atoms from Josephine McCarthy's Mystagogus_Keyword.pdf
  var MYSTAGOGUS_EN_FACTS = {
    1: "Idea forming in preconception, before dawn—latent seed not yet manifest",
    2: "True new beginning, major shift ahead, birth/rebirth, a new path and life phase",
    3: "Helpful long-term fate weave, protective allies, fateful gift upholding your trajectory",
    4: "Cycle harvesting and closing, limited time, necessary letting go—or destructive loss of control if resisted",
    5: "Waking up to consciousness and power, revelation, honestly facing exposed truth",
    6: "Still in training and process—unfinished skill, youth/innocence, rightful student stage",
    7: "Important and right fate path (leans Yes)—trust, take action, move forward",
    8: "Fateful witness/guide present (leans Yes)—tread carefully and choose with strict honesty",
    9: "Cleanse, bathe, tidy up, and purify body, living/working space, or conduct",
    10: "Active dream/vision channel, sleep messages, or literal bodily need for rest",
    11: "Wheel turning—active growth, decisive movement, maturation, and expansion",
    12: "Heightened alertness to signs and warnings—exposing veiled facts others miss",
    13: "High craft, skilled or ritual work, or an expert applying deep knowledge to benefit others",
    14: "Be silent, do not act, do not ask—guard secrets and think carefully before speaking",
    15: "Teamwork, selfless service to a larger work, maturity, stepping up to responsibility",
    16: "Active healing and regeneration (leans Yes)—medicine, fixing damage, stabilizing whole",
    17: "Check your defences—immune response, boundary protection, honour, and energetic hygiene",
    18: "Wise fellowship (you are not alone)—shared higher study, stars/cycles, seasoned mentors",
    19: "Measured power of spoken or written words, formal statement, contacted writing, or prayer",
    20: "Creative act in motion—writing, visual art, music, drama, or dedicated craft as service",
    21: "Loadsharer—carrying or sharing heavy weight, caretaking, hard work that upholds others",
    22: "Dead end (hard No / Empty)—route completely blocked; stop and redirect",
    23: "Profound turning-point revelation and protection—participate actively in your destiny and value yourself",
    24: "Chariot (affirmative Yes)—forward momentum, travel/transport, ascent, bridging realms",
    25: "Stable, ethical leadership—a boss/leader or your own initiative stepping up to protect and guide",
    26: "Unseen potential incubating in deep obscurity, or dark night of the soul before emerging",
    27: "Inner Desert threshold warning—go no further; sober judgement at an Abyss boundary",
    28: "Crossroads test of law, candor, and integrity—literal exam, audit, or character trial",
    29: "Simplicity, long-term wise choice, peaceful home, elder perspective, lasting harmony",
    30: "Phanos inner lamp (leans Yes)—light needed inside; trust your own center",
    31: "Akh—evolved integrity, true character of a person, self-knowledge, clean balanced path",
    32: "Foundation Stone—first stage completed; solid anchor in body, land, and passive shelter",
    33: "East Gate (Possible / Yes)—forming near-term future, new learning, invention, emerging opening",
    34: "South Gate (Yes / Positive)—volatile creative fire, full-heat long-term outcome",
    35: "West Gate (Probably not / no longer viable)—fading recent past, slowing down, ageing (may still return)",
    36: "North Gate (Hard No / gone)—ancestors, ancient closed past, burial ground that never returns",
    37: "Profane Place (Hard No)—greed, pollution, oppression, toxic environment, or poison",
    38: "Hearth—home, house, family, children, domestic rest, safety, and core nourishment",
    39: "Obscure Path (No / Wait)—hidden factor; tread water, stay hidden, and trust instincts",
    40: "Inner Library—deep research, higher education institution, learning from nature and history",
    41: "Sanctuary (Not yet)—withdraw, go invisible, seek safe shelter, and recharge first",
    42: "Raw land and elemental nature force—reconnect practically with natural surroundings",
    43: "Underworld—potential hazard, decay, or imbalance; facing your own shadow under test",
    44: "Sacred Place—clean, balanced, protected space, special ally, or natural power spot",
    45: "Wind Spirits—stormy air current, weather shift, urgent need to talk or truly listen",
    46: "Firestorm—out-of-control fire: rage, acute fever/inflammation, warlike clash, violent temper",
    47: "Water of Life—deep physical and emotional healing, regeneration, restorative nourishment",
    48: "Sustained effort succeeding—truth, fair resolution, equilibrium on the right path",
    49: "Ancient One—matriarch, older woman, female lineage, menopause, harvest of labor, or Underworld gate",
    50: "Companions—an animal or bird is the key; tending creatures, working animal ally, or augury/omen",
    51: "Secret Commonwealth—unpredictable person, land spirit, or shifting ground; make NO promises and keep strict integrity amid unfairness",
    52: "Threshold Guardians (Hard No / Stop)—closed protective barrier; rethink before proceeding",
    53: "Light Bearer—new dawn, kindness, light in darkness, major seed of potential about to realize",
    54: "Divine Servants—guiding inner support, consecrated space, important destiny unfolding",
    55: "Oracle—vital message, prompt to write/speak, or an explicit need for further divination",
    56: "College—collective knowledge, mentorship (being teacher or student), formal skill training",
    57: "Ghost—hollow echo of what once was, drained remnant almost gone but still lingering",
    58: "Parasite—vampiric drain, infection, disease, infestation, or unhealthy attachment",
    59: "Choppers—rotting deadwood requiring a clean cut: severing ties, clearing out, or literal surgery",
    60: "Partnership—active contract, friendship, union, mutual energetic influence",
    61: "Separation (No / walk away)—parting, end of an era clearing space to move forward",
    62: "Limiter (No / Wait)—protective pause, self- or imposed limit, slow down, small amount only",
    63: "Endurance—necessary hardship, persistence, discipline polishing raw grit into strength",
    64: "Voice of Truth (Clear Yes)—right, candid, self-aware, balanced, genuinely helpful",
    65: "Gift—receiving needed medicine, resources, or help; or sharing your surplus where needed",
    66: "Lightning Strike—sudden shock or electrical issue; necessary disruption protecting the fate path—act fast to pin things down",
    67: "Splendour (Clear Yes)—visible achievement, joy, beauty, respect, and harmony",
    68: "True Justice—impartial law, cause and effect harvesting exact results of actions",
    69: "Unraveller—slowly coming apart, loosening, unwinding, crumbling structure",
    70: "Defeat (No / Not now)—poor timing, temporary collapse, know your limits and pause (dark before dawn)",
    71: "Voice of Untruth—lies, manipulation, spying/snooping, cheating, theft, or addiction",
    72: "Binder (Hard No / Don't)—bound up, trapped, removed from circulation, unable to move",
    73: "Danger—active destructive potential; change plans, take zero risks, stay sharply observant",
    74: "Fall—loss of status or setback from one's own lapse of judgement; back to the beginning",
    75: "Serpent of Chaos—severe degeneration, destructive chaos, being glamoured, or brainwashing",
    76: "Destruction—dangerous imbalance or catastrophe; make a major change and get out of the way",
    77: "Magical Death (Immediate Stop)—harming others, exposing a secret, or reckless conduct risks ruin; keep silent",
    78: "Empty Vessel (Hard No / Zero)—empty shell, nonsense, loss of function, or memory loss/amnesia"
  };

  var MYSTAGOGUS_ZH_SUPPLEMENTS = {
    16: "极性倾向「是」；含医药救治与修复加固",
    24: "极性明确「是」；含字面出行、车辆载具与跨阶段上升",
    33: "极性倾向「可能/是」",
    34: "极性倾向「是/积极」；留意高热波动能量",
    35: "极性倾向「大概不是/不再可行」",
    37: "极性明确「否」；警示有毒压迫环境或实质污染毒害",
    41: "时机判词：「尚未/时机未到」",
    49: "字面亦含年长女性、母系血脉或更年期阶段",
    66: "字面亦指电路/电器突发故障",
    71: "含暗中窥探（spying）、作弊偷窃与成瘾性纠缠",
    75: "含被魅惑障眼（glamoured）或洗脑精神控制",
    78: "字面亦含机能丧失或记忆减退/失忆（loss of memory）"
  };

  // Canonical concept tags connecting LXXXI & Mystagogus cards to spread position concepts
  var CARD_DISPLACEMENT_CONCEPTS = {
    "lxxxi-01": ["star-father"],
    "lxxxi-02": ["creator-of-time"],
    "lxxxi-03": ["holder-of-light"],
    "lxxxi-05": ["abyss", "underworld"],
    "lxxxi-07": ["light-bearer", "mercy"],
    "lxxxi-08": ["imprisoner", "binder", "withheld"],
    "lxxxi-09": ["pure-balance", "balance"],
    "lxxxi-10": ["grindstone", "ordeal"],
    "lxxxi-11": ["unraveller"],
    "lxxxi-12": ["threshold-guardian"],
    "lxxxi-14": ["weaver", "fate-weavers"],
    "lxxxi-16": ["inner-temple", "inner-worlds"],
    "lxxxi-18": ["companion"],
    "lxxxi-23": ["wheel-of-fate", "fate-cycle"],
    "lxxxi-26": ["taker"],
    "lxxxi-27": ["mother-earth"],
    "lxxxi-32": ["temple-of-ancestors"],
    "lxxxi-33": ["magical-temple"],
    "lxxxi-34": ["river-of-dreams", "dreams"],
    "lxxxi-35": ["past-gate", "west-gate"],
    "lxxxi-36": ["home-hearth"],
    "lxxxi-37": ["path-ahead", "the-path"],
    "lxxxi-40": ["resources"],
    "lxxxi-44": ["blood-ancestor"],
    "lxxxi-53": ["gifts"],
    "lxxxi-56": ["partnership", "relationships"],
    "lxxxi-57": ["communication"],
    "lxxxi-59": ["limiter", "east"],
    "lxxxi-60": ["staff", "south"],
    "lxxxi-61": ["west"],
    "lxxxi-62": ["foundation", "north"],
    "lxxxi-64": ["union"],
    "lxxxi-78": ["underworld", "abyss"],

    "m-01": ["progenitor"],
    "m-03": ["fate-weavers", "weaver"],
    "m-07": ["the-path", "path-ahead"],
    "m-08": ["daimon", "companion"],
    "m-10": ["dreams", "river-of-dreams"],
    "m-11": ["wheel-of-fate", "fate-cycle"],
    "m-32": ["foundation"],
    "m-33": ["east-gate", "east"],
    "m-34": ["south-gate", "south"],
    "m-35": ["west-gate", "past-gate", "west"],
    "m-36": ["north-gate", "north"],
    "m-38": ["home-hearth"],
    "m-43": ["underworld", "abyss"],
    "m-48": ["balance", "pure-balance"],
    "m-52": ["threshold-guardian"],
    "m-53": ["light-bearer", "mercy"],
    "m-60": ["partnership", "relationships"],
    "m-62": ["limiter"],
    "m-63": ["endurance"],
    "m-65": ["gifts"],
    "m-69": ["unraveller"],
    "m-72": ["binder", "imprisoner"],
    "m-73": ["danger"]
  };

  var POSITION_CONCEPT_RULES = [
    { concept: "star-father", re: /星辰之父|星之父|star\s*father/i },
    { concept: "creator-of-time", re: /时间创造者|creator\s*of\s*time/i },
    { concept: "holder-of-light", re: /持光者|holder\s*of\s*light/i },
    { concept: "abyss", re: /^深渊$|\babyss\b/i },
    { concept: "underworld", re: /冥界|地下世界|\bunderworld\b/i },
    { concept: "light-bearer", re: /光之承载|light\s*bearer/i },
    { concept: "mercy", re: /^慈悲$|\bmercy\b/i },
    { concept: "imprisoner", re: /监禁者|\bimprisoner\b/i },
    { concept: "binder", re: /束缚者|\bbinder\b/i },
    { concept: "pure-balance", re: /纯粹平衡|pure\s*balance/i },
    { concept: "balance", re: /^平衡$|\bbalance\b/i },
    { concept: "grindstone", re: /砥砺石|磨石|grindstone|millstone/i },
    { concept: "ordeal", re: /^磨难$|\bordeal\b/i },
    { concept: "unraveller", re: /分解者|解开者|^解开$|心智与分解|unravell/i },
    { concept: "threshold-guardian", re: /界线守卫|门槛守卫|threshold\s*guardian/i },
    { concept: "weaver", re: /创造织者|weaver\s*of\s*creation/i },
    { concept: "fate-weavers", re: /命运编织者|fate\s*weavers/i },
    { concept: "inner-temple", re: /内在神殿|inner\s*temple/i },
    { concept: "inner-worlds", re: /内在世界|inner\s*worlds/i },
    { concept: "companion", re: /^伴侣$|\bcompanion\b/i },
    { concept: "daimon", re: /守护灵|\bdaimon\b/i },
    { concept: "wheel-of-fate", re: /命运之轮|wheel\s*of\s*fate/i },
    { concept: "fate-cycle", re: /当前命运循环|fate\s*cycle/i },
    { concept: "taker", re: /夺取者|\btaker\b/i },
    { concept: "mother-earth", re: /大地之母|mother\s*earth/i },
    { concept: "temple-of-ancestors", re: /^祖庙$|temple\s*of\s*ancestors/i },
    { concept: "magical-temple", re: /魔法殿堂|magical\s*temple/i },
    { concept: "river-of-dreams", re: /梦之河|沉睡者|river\s*of\s*dreams|\bsleeper\b/i },
    { concept: "dreams", re: /^梦境$|睡眠／梦境|\bdreams\b/i },
    { concept: "past-gate", re: /过去之门|past\s*gate|gate\s*of\s*the\s*past/i },
    { concept: "west-gate", re: /^西门$|west\s*gate/i },
    { concept: "north-gate", re: /^北门$|north\s*gate/i },
    { concept: "east-gate", re: /^东门$|east\s*gate/i },
    { concept: "south-gate", re: /^南门$|south\s*gate/i },
    { concept: "home-hearth", re: /家与壁炉|家与炉灶|^炉灶$|^家庭／家$|home\s*(?:and|&)\s*hearth|\bhearth\b|^home\s*\/\s*family$/i },
    { concept: "path-ahead", re: /赫丘利之路|前方的道路|path\s*of\s*hercules|path\s*ahead/i },
    { concept: "the-path", re: /^道路$|^the\s*path$/i },
    { concept: "resources", re: /^资源$|\bresources\b/i },
    { concept: "blood-ancestor", re: /血脉先祖|blood\s*ancestor/i },
    { concept: "gifts", re: /^礼物$|\bgifts?\b/i },
    { concept: "partnership", re: /伙伴关系|\bpartnership\b/i },
    { concept: "relationships", re: /^关系$|\brelationships\b/i },
    { concept: "communication", re: /^沟通$|\bcommunication\b/i },
    { concept: "limiter", re: /限制者|\blimiter\b/i },
    { concept: "staff", re: /^法杖$|\bstaff\b/i },
    { concept: "foundation", re: /^基石$|^基础$|\bfoundation(?:\s*stone)?\b/i },
    { concept: "union", re: /^结合$|^联合$|\bunion\b/i },
    { concept: "progenitor", re: /始源者|\bprogenitor\b/i },
    { concept: "endurance", re: /^耐力$|\bendurance\b/i },
    { concept: "danger", re: /^危险$|\bdanger\b/i },
    { concept: "east", re: /^东方$|^east$/i },
    { concept: "south", re: /^南方$|^south$/i },
    { concept: "west", re: /^西方$|^west$/i },
    { concept: "north", re: /^北方$|^north$/i }
  ];

  var SPREAD_TOPOLOGY_CATALOG = {
    "three-card-horizontal": {
      family: "axial-triad",
      isFilter: false,
      circuitZh: "以 [2现在] 锁定当前症结，回溯 [1过去] 看成因惯性，再推演若不加干预 [3未来] 的自然延伸——指出在当下调整何处即可改写第3位走向。",
      circuitEn: "Anchor on [2 Present] as the active crux, trace [1 Past] as momentum source, and project [3 Future] as inertial trajectory—highlight how shifting Pos 2 alters Pos 3."
    },
    "four-seasons": {
      family: "axial-triad",
      isFilter: false,
      circuitZh: "先立中心 [5季度关键点（大阿卡那总纲）]，再交叉检视四方元素支撑与失衡：[1权杖·行动火 ↔ 3宝剑·心智人际风] 与 [2圣杯·情绪水 ↔ 4星币·工作物质健康土]。",
      circuitEn: "Anchor on [5 Seasonal Key (Major Arcana hub)], then weigh elemental axes [1 Wands/Action ↔ 3 Swords/Mind & Relations] against [2 Cups/Emotion ↔ 4 Pentacles/Work & Body]."
    },
    "yes-no": {
      family: "axial-triad",
      isFilter: false,
      circuitZh: "先以中心 [1问题 × 6交叉答案] 直断是/否倾向，再用 [2相关的过去 + 4帮助] 对照 [3困难] 推演 [5未来的结果] 如何成局（切忌孤立只看第6位报喜或报丧，有时第6位受挫恰为第5位转机腾出空间）。",
      circuitEn: "Deliver the direct verdict from [1 Question × 6 Crossing Answer], then weigh [2 Related Past + 4 Help] against [3 Difficulties] to show how [5 Future Outcome] turns."
    },
    "tree-of-life": {
      family: "axial-triad",
      isFilter: false,
      circuitZh: "按三层三柱电路跳读：①顶层定调（1故事主题 + 2积极给予 ↔ 3隐藏过去）→ ②中核引擎（4发展条件 ↔ 5被隐瞒剥夺 汇入 6关键核心）→ ③人为可控层（7纪律限制 ↔ 8放松流动 注入 9原因动力——此层完全在提问者掌控之内！）→ ④ 10最终答案。",
      circuitEn: "Read as three bands & pillars: Top seed (1 Theme + 2 Active ↔ 3 Hidden Past) -> Core engine (4 Conditions ↔ 5 Withheld feeding 6 Core) -> Human-agency band (7 Discipline ↔ 8 Flow driving 9 Cause—fully changeable by the querent!) -> 10 Answer."
    },
    "overview": {
      family: "matrix-orbits",
      isFilter: false,
      circuitZh: "严禁1→13挨个点名！先对比上排支持(1-6)与下排张力(7-12)整体冷暖，再择重点串联三大四角X轨道：①身份关系轨 [1家↔7冲突, 2关系↔8隐藏敌人]、②生存磨砺轨 [3创造力↔10资源, 4命运循环↔9磨难]、③健康舍离轨 [6礼物↔11解开者, 5健康↔12夺取者：在11位主动松手清理冗余，即可免遭12位强行剥夺并护住5位健康]，最终收束于 [13前方的道路]。",
      circuitEn: "Never list Pos 1->13 linearly! Contrast upper support row (1-6) vs. lower tension row (7-12), then weave the three X-orbits: (1) Pack/Identity [1 Home↔7 Conflict, 2 Relations↔8 Hidden Enemies], (2) Survival/Grind [3 Creativity↔10 Resources, 4 Fate Cycle↔9 Ordeal], (3) Health/Release [6 Gifts↔11 Unraveller, 5 Health↔12 Taker: voluntary release at 11 prevents forced stripping at 12 and protects 5 Health], converging on [13 Path Ahead]."
    },
    "event": {
      family: "axial-triad",
      isFilter: false,
      circuitZh: "沿中轴时间脊柱 [2过去影响 → 1当前情况 → 7结论] 立主干，交叉对读两组对角线：[3触发原因 ↔ 5带走之物]（警惕第3位往往只是表面导火索，第5位被剥离的舒适区或旧执念才是真正深层动因！）与 [4益处 ↔ 6如何展开（其烈度反映当事人固执程度）]。",
      circuitEn: "Follow the central spine [2 Past -> 1 Present -> 7 Conclusion], crossed by diagonals [3 Trigger ↔ 5 What Is Taken] (Pos 3 is often just the surface spark while Pos 5 reveals the deeper attachment being stripped!) and [4 Benefit ↔ 6 How It Unfolds]."
    },
    "direction": {
      family: "signal-filter",
      isFilter: true,
      circuitZh: "【寻物方位罗盘·字面物象匹配优先】以 [1中心] 核对所寻目标状态，在 [2东 / 3南 / 4西 / 5北] 中**优先采信牌面器物、人物或场景特征与所寻目标字面契合**的方位（如寻文书信件看沟通/图书馆/侍者牌，寻宠物看同伴/自然牌），其次采信强通畅成功信号（相邻两方位同强则取夹角如东南/西南；愚者/空容器/死路代表零点不在该方向；全盘无匹配信号则提示扩大搜索半径），勿逐位硬凑。",
      circuitEn: "[Compass Location Spread—Literal Object Match First] Check [1 Centre] for target state, then in [2 East / 3 South / 4 West / 5 North] prioritize directions whose card imagery or literal objects match what is sought (e.g. letters/library for documents, creature/nature cards for pets), followed by strong success signals (combine adjacent strong slots into NE/SE/SW/NW; Fool/Empty Vessel/Dead End = zero/not there; if none match, widen search radius)."
    },
    "resources": {
      family: "balance-ledger",
      isFilter: false,
      circuitZh: "按天平能量账本解读：先查中轴总控 [2平衡(节律调节阀) → 1自我(控制台) → 3生命力(总电池)]，再对看左侧外在世俗罐(4爱/5金钱/6健康/7创造力)与右侧内在灵性罐(8沟通/9直觉/10占卜/11魔法)的交叉补给(4↔8, 5↔9, 6↔10, 7↔11, 5↔11)，必须明确点出哪些罐子充盈稳固、可暂停哪个盈余非刚需罐去回血透支的核心生存罐。",
      circuitEn: "Read as Justice scales: inspect central controller [2 Balance (regulator) -> 1 Self -> 3 Vitality (battery)], then cross-match outer mundane pots (4-7) with inner pots (8-11) via [4↔8, 5↔9, 6↔10, 7↔11, 5↔11], explicitly naming which pots are full/healthy and which surplus non-essential pot can rest to replenish depleted vital pots."
    },
    "timing": {
      family: "signal-filter",
      isFilter: true,
      circuitZh: "【时间波段·严禁1→8报流水账】将 1～8 时段连成一条能量起伏曲线，归并标出「平稳安全窗 → 隐伏酝酿期（如月亮/隐秘牌）→ 冲突或行动峰值窗口 → 回落修复期」，直接围绕关键转折窗口作答。",
      circuitEn: "[Timing Wave—No 1->8 roll-call!] Synthesize Periods 1–8 into a single wave curve (quiet safe windows -> hidden incubation -> peak heat/action window -> recovery phase) and highlight the decisive timing inflection points."
    },
    "manifestation-cause": {
      family: "signal-filter",
      isFilter: true,
      circuitZh: "【筛针追因牌阵·按事件量级与槽位语义动态筛查】以 [1事件本身] 的实际轻重标定基准，在 2～10 位中动态锁定「破坏力与第1位量级相当」或「牌象语义直指该槽位领域」的核心病因重点深挖——务必识别专向对应牌（如法律/判决/宝剑王牌落第10位天秤、伤病疲惫牌落第5位、暗敌操控牌落第8/9位、车辆移动牌落第3位意外）以及「贪图安逸/过度控制/固守囤积（如圣杯九、女皇、星币四）」落第6位自我造成时的慢性致祸；仅将与事件量级和槽位职能均明显平淡无关的槽位用一句话干净略过，切忌1→10逐位硬编牵强理由！",
      circuitEn: "[Signal-Hunting Cause Spread—Dynamic Scale & Slot-Semantic Matching] Calibrate against the actual scale of [1 The Event], then isolate and unpack ONLY slots in Pos 2–10 whose disruption matches that scale OR whose imagery directly fits the slot's domain—including domain-specific cards (legal/justice/Ace of Swords in 10 Scales, illness/fatigue in 5 Injury, covert hostility in 8/9, vehicles/motion in 3 Accident) and excess/stasis causes (complacency, overcontrol, hoarding in 6 Self-Caused). Set aside genuinely unrelated filler slots in one brief clause; never force a story onto all 10 slots!"
    },
    "solution": {
      family: "signal-filter",
      isFilter: true,
      circuitZh: "【筛针寻优牌阵·按破局实效动态筛查】针对 [1事件]，在 2～10 位中提取真正能跑通的 1～3 条有效路径重点展开——既包含正向通畅/胜利疗愈牌，也必须识别与槽位高度契合的「以退为进/断舍离/认账止损」良方（如第2位被动展开出休养静默/圣所隐退牌，第6位担责或第10位还债出清偿执行/砍除枯枝/转身离开牌）；仅将明显受阻卡死、与破局相悖的低效槽位一笔略过，切忌把所有槽位硬凑成自相矛盾的建议！",
      circuitEn: "[Signal-Hunting Solution Spread—Dynamic Viability Matching] Against [1 Event], spotlight the 1–3 genuinely workable routes in Pos 2–10—counting both constructive/victorious cards AND slot-fitting strategic retreats or clean cuts (e.g. rest/silence/sanctuary in 2 Passive Unfolding; paying dues, pruning deadwood, or walking away in 6 Responsibility or 10 Paying Debts). Set aside genuinely blocked or counterproductive slots rather than advising every position!"
    },
    "health": {
      family: "body-circuit",
      isFilter: false,
      circuitZh: "先检视 [1正在形成 → 2尚未显现]；再按牌位职能联系 [3头部、5情绪、11消化]、[4固态摄入、6主要免疫]、[7深层免疫、12睡眠梦境]、[8核心器官与9/10激素]、[13结构与运动] 和 [14皮肤]，最后看 [15近期未来]。",
      circuitEn: "Consider [1 Forming -> 2 Not Yet Manifest], then connect the position roles of [3 Head, 5 Emotion, 11 Digestion], [4 Intake, 6 Primary Immune], [7 Deep Immune, 12 Sleep], [8 Core Organs and 9/10 Hormones], [13 Structure and Movement] and [14 Skin], before [15 Near Future]."
    },
    "fate-pattern": {
      family: "sacred-map",
      isFilter: false,
      circuitZh: "以中心 [1当前命运路径 × 10交叉影响] 立轴，沿纵轴 [2已学教训 → 3最高潜力] 看演化上下限，沿横轴 [4需培育种子 → 7已获收获] 看耕耘进度，再对读内环制衡 [5需攀山峰 ↔ 6需释放之物] 与 [8严厉天使(自身偏差警示) ↔ 9仁慈天使(回应行动的护持)]。",
      circuitEn: "Center on [1 Fate Path × 10 Influence], frame vertical ceiling [2 Lessons Learned -> 3 Highest Potential] and horizontal progress [4 Seeds to Tend -> 7 Harvest], then balance inner ring [5 Mountain ↔ 6 What to Release] and [8 Severe Angel (self-sabotage warning) ↔ 9 Merciful Angel (earned support)]."
    },
    "angel": {
      family: "sacred-map",
      isFilter: false,
      circuitZh: "以 [1自我] 为圆心，成对校准：[2慈悲(外赐神圣之光) ↔ 5灯笼(过往实修攒下的自性提灯)]、[3限制者(减速护栏) ↔ 4法杖(仍需主动投入的功课)]、[6容器(正在熟化的成果) ↔ 7吉布拉(必须沉入过去严禁翻旧账之物)] 与 [8伴侣指引]；底部 [9-10-11] 必须合读为同一面高我(HGA)三联镜（过往来路·当下真貌·未来潜能）。",
      circuitEn: "Orbit around [1 Self] in pairs: [2 Mercy (given light) ↔ 5 Lantern (earned light)], [3 Limiter ↔ 4 Staff (active work)], [6 Vessel ↔ 7 What Must Sink (do not revive)], plus [8 Companion]; read [9–10–11] together as one unified HGA mirror triad (was / is / can become)."
    },
    "landscape": {
      family: "sacred-map",
      isFilter: false,
      circuitZh: "先立中心 [1基础 × 2联合]，严格区分两组时空门户：[5过去之门(双向门，旧事仍可能回潮) vs 4冥界(彻底死去永不回头)]、[12前方的道路(近期已成型的直接走向) vs 3星之父(尚在编织的远期宿命)]，再将四象限 [6命运之轮·7磨石 ↔ 10解开者] 与 [8内在神殿·9家与炉灶·11沉睡者] 织入内外联动。",
      circuitEn: "Anchor [1 Foundation × 2 Union], strictly distinguish [5 Past Gate (two-way—may still return) vs. 4 Underworld (gone for good)] and [12 Path Ahead (immediate formed trajectory) vs. 3 Star Father (long-term forming fate)], weaving quadrants [6 Wheel & 7 Millstone ↔ 10 Unraveller] with [8 Inner Temple, 9 Home, 11 Sleeper]."
    },
    "self-map": {
      family: "sacred-map",
      isFilter: false,
      circuitZh: "按四层同心螺旋由内向外推进（忌1→18平铺）：①自我核心轴(2起源→1自我→3目的地) → ②世俗可改层(4积极↔7消极, 6近过去→5短未来) → ③魔法实修可改层(8道路·9接触·10魔法未来 ↔ 11对手·12基石) → ④灵魂长周期底片层(13步骤·14路·15模式·16收获，配对 17天秤↔18克制)。",
      circuitEn: "Read outward across four concentric rings: (1) Core spine [2 Origin -> 1 Self -> 3 Destination], (2) Changeable Mundane ring [4 Positive ↔ 7 Negative, 6 Recent Past -> 5 Short-Term Future], (3) Changeable Magical ring [8 Path, 9 Contact, 10 Future ↔ 11 Adversary, 12 Foundation], (4) Long-range Soul ring [13–16 paired with 17 Scales ↔ 18 Restraint]."
    },
    "mystagogus-layout": {
      family: "sacred-map",
      isFilter: false,
      circuitZh: "按之字形叙事团块推进（严禁1→18挨个点名）：①源起与定力(1始源者 + 2耐力↔3解开) → ②关系与家宅根基(4伙伴关系 + 5炉灶) → ③双过去门分流(6西门[暂退仍可能回潮] vs 7北门[彻底翻篇永不回头]) → ④当下核心博弈(8命运编织者 + 9道路[可行]↔10束缚者[禁动] + 11礼物↔12冥界对手) → ⑤潜意识与内在流入(13梦境→14内在世界) → ⑥行动忠告与双未来门(15守护灵建议↔16危险警示 → 17东门[近未来路径] vs 18南门[远期终局])。",
      circuitEn: "Advance in narrative clusters (never 1->18 roll-call!): (1) Seed & stamina [1 Progenitor + 2 Endurance ↔ 3 Unravelling], (2) Bond & base [4 Partnership + 5 Hearth], (3) Dual past gates [6 West Gate (fading, may return) vs. 7 North Gate (gone forever)], (4) Active crux [8 Fate Weavers + 9 Path (go) ↔ 10 Binder (hold) + 11 Gift ↔ 12 Underworld], (5) Inner channel [13 Dreams -> 14 Inner Worlds], (6) Counsel & dual future gates [15 Daimon ↔ 16 Danger -> 17 East Gate (near future) vs. 18 South Gate (long-term outcome)]."
    },
    "lxxxi-occult-map": {
      family: "sacred-map",
      isFilter: false,
      circuitZh: "按神圣地理回路解读（忌1→16流水账）：先立中心 [1大地之母 × 2结合]；强制并读 [10创造织者 + 9基石]（当下命运主线与不可改立足点）；对比双过去 [5过去之门(双向可回) vs 4深渊(永逝)] 与双未来 [16赫丘利之路(近期直接结果) vs 3星辰之父(远期大势)]；对衡 [11砥砺石(磨砺功课) ↔ 14分解者(瓦解退场)]；串联血脉与殿堂 [6祖庙·8血脉先祖 ↔ 7内在神殿·12魔法殿堂·13家与壁炉]，若 [15梦之河] 牌力强则必须回看 10/6/7 位。",
      circuitEn: "Read as sacred geography: anchor [1 Mother Earth × 2 Union]; always pair [10 Weaver + 9 Foundation]; contrast [5 Gate of the Past (may return) vs. 4 Abyss (gone forever)] and [16 Path of Hercules (near-term) vs. 3 Star Father (long-term)]; balance [11 Grindstone ↔ 14 Unraveller]; link [6 Ancestors & 8 Blood Ancestor ↔ 7 Inner Temple, 12 Magical Temple, 13 Home], cross-checking [15 River of Dreams] against 10/6/7 when strong."
    },
    "lxxxi-tree-of-life-occult": {
      family: "axial-triad",
      isFilter: false,
      circuitZh: "沿十大核心力量(I→X)显化阶梯推进：源头三元组 [1星辰之父I(初念) → 2时间创造者II(赋形给时间) ↔ 3持光者III(休眠收回)] → 深层天平 [4光之承载IV(开路) ↔ 5监禁者V(必要制动) 交汇于 6纯粹平衡VI(支点)] → 人世磨合 [7砥砺石VII(纪律打磨) ↔ 8分解者VIII(失控松脱) 经由 9界线守卫IX(内外炼金桥)] → [10大地之母X(最终落地结果)]。",
      circuitEn: "Trace manifestation down Powers I->X: Divine triad [1 Star Father I -> 2 Creator of Time II ↔ 3 Holder of Light III] -> Inner fulcrum [4 Light Bearer IV ↔ 5 Imprisoner V meeting at 6 Pure Balance VI] -> Formative test [7 Grindstone VII ↔ 8 Unraveller VIII bridging through 9 Threshold Guardian IX] -> [10 Mother Earth X (embodied outcome)]."
    },
    "lxxxi-tree-of-life-simple": {
      family: "axial-triad",
      isFilter: false,
      circuitZh: "按得失制衡三层推进：顶层定调 [1主题概论 + 2得的面向 ↔ 3失或隐瞒面向] → 命运收支与核心 [4命运给予 ↔ 5失去剥夺 汇入 6现状中心点] → 个体承压与家系根基 [7情感与负担 ↔ 8心智与分解 → 9族群家与先祖] → [10结果与答案]。",
      circuitEn: "Advance through gain/loss balance: Overview triad [1 Subject + 2 Gaining ↔ 3 Losing/Hidden] -> Fate exchange [4 What Fate Gives ↔ 5 What Is Lost feeding 6 Present Core] -> Personal handling & roots [7 Emotion/Burden ↔ 8 Mind/Unravelling -> 9 Clan & Ancestors] -> [10 Outcome]."
    },
    "lxxxi-four-directions": {
      family: "axial-triad",
      isFilter: false,
      circuitZh: "先锁中心 [1中央(主体容器本身) × 6结合(最大外部关系或力量冲击)]，再沿四方元素季节流向对读：[2东方(风·新生潜能·言语学习)] → [3南方(火·前方道路与工作推进)] → [4西方(水·家室老化与消退遗留)] → [5北方(土·先祖过去与冬藏根基)]。",
      circuitEn: "Lock center [1 Centre (subject/vessel) × 6 Union (strongest crossing influence)], then trace directional currents: [2 East (Air/birth/words)] -> [3 South (Fire/work/road ahead)] -> [4 West (Water/home/fading)] -> [5 North (Earth/ancestors/deep past)]."
    }
  };

  var ESOTERIC_SPREAD_IDS = {
    "fate-pattern": true,
    "angel": true,
    "self-map": true,
    "lxxxi-occult-map": true,
    "lxxxi-tree-of-life-occult": true
  };

  var HYBRID_ESOTERIC_SPREAD_IDS = {
    "landscape": true,
    "mystagogus-layout": true
  };

  // Deliberately excludes generic brand words ("奎瑞亚" / "Quareia") so mundane questions naming the system stay mundane
  var ESOTERIC_SIGNAL_ZH_RE = /冥想|仪式|魔法|灵视|内在接触|内在世界|内在神殿|内在圣殿|高我|守护天使|神圣守护|先祖|血脉|业力|能量|寄生物|寄生体|灵体|梦境|实修|修行|神秘学|异象|星体|深渊|神殿|祭司|灵魂|净化|诅咒|附体/;
  var ESOTERIC_SIGNAL_EN_RE = /\b(?:meditat\w*|ritual\w*|magical\s+(?:practice|work\w*|path|protection|attack|defense)|magic\b|visionary|inner\s+(?:contact|world|worlds|temple|sanctum|adept|desert)|hga|holy\s+guardian|spiritual\s+(?:path|practice)|esoteric|occult|mystical|initiation|astral|deity|deities|angelic|ancest\w*|karma|karmic|parasit\w*|spirit\s+(?:contact|guide|world)|entity|entities|dream\s+work)\b/i;

  var MUNDANE_OVERRIDE_ZH_RE = /工作|跳槽|辞职|离职|裁员|面试|升职|薪资|工资|老板|同事|创业|合伙|合同|官司|买房|租房|搬家|考试|留学|恋爱|分手|复合|结婚|离婚|冷战|伴侣|前任|存款|负债|投资|报销|钱/;
  var MUNDANE_OVERRIDE_EN_RE = /\b(?:job|career|resign\w*|layoff|interview|promotion|salary|boss|colleague|startup|contract|lawsuit|rent|mortgage|exam|dating|break\s*up|divorce|marriage|partner|ex-partner|budget|debt|money|invest\w*)\b/i;

  var GENERIC_STARTER_ZH_RE = /^(?:请结合所附牌阵|帮我(?:整体)?(?:看看|解读|梳理|分析|看清)(?:一下)?(?:这(?:副|次|张|组))?(?:牌阵|占卜|牌)?|解读(?:一下)?(?:这副牌|本次占卜)?|看看这副牌)[，。！？、\s]*$/;
  var GENERIC_STARTER_EN_RE = /^(?:please\s+)?(?:read|interpret|analyze|walk\s+me\s+through|summarize|give\s+me\s+an?\s+(?:overview|reading)\s+of)\s+(?:this|the|my)?\s*(?:attached\s+)?(?:spread|reading|cards|layout)?[.!?\s]*$/i;

  function normalizeLocale(locale) {
    return locale === "en" ? "en" : "zh-CN";
  }

  function normalizeSkillMode(mode) {
    if (typeof mode !== "string") {
      return "auto";
    }
    var cleaned = mode.trim().toLowerCase();
    return VALID_SKILL_MODES[cleaned] ? cleaned : "auto";
  }

  function parseCardIdentity(card, fallbackDeckType) {
    var raw = card && typeof card === "object" ? card : {};
    var cardId = String(raw.cardId || raw.id || "").trim().toLowerCase();
    var deckType = fallbackDeckType === "lxxxi" || fallbackDeckType === "mystagogus" ? fallbackDeckType : "tarot";
    var arcana = String(raw.arcana || "").trim().toLowerCase();
    var suitRaw = String(raw.suit || "").trim();
    var suitKey = "";
    var rankKey = "";
    var number = typeof raw.number === "number" && Number.isFinite(raw.number) ? raw.number : null;

    var majorMatch = /^major-(\d{1,2})$/.exec(cardId);
    var minorMatch = /^minor-(wands|cups|swords|pentacles)-(ace|two|three|four|five|six|seven|eight|nine|ten|page|knight|queen|king)$/.exec(cardId);
    var lxxxiMatch = /^lxxxi-(\d{1,2})$/.exec(cardId);
    var mystMatch = /^m-(\d{1,2})$/.exec(cardId);

    if (majorMatch) {
      deckType = "tarot";
      arcana = "major";
      number = Number(majorMatch[1]);
    } else if (minorMatch) {
      deckType = "tarot";
      arcana = "minor";
      suitKey = minorMatch[1];
      rankKey = minorMatch[2];
    } else if (lxxxiMatch) {
      deckType = "lxxxi";
      arcana = "lxxxi";
      number = Number(lxxxiMatch[1]);
    } else if (mystMatch) {
      deckType = "mystagogus";
      arcana = "mystagogus";
      number = Number(mystMatch[1]);
    } else {
      if (arcana === "lxxxi") {
        deckType = "lxxxi";
      } else if (arcana === "mystagogus") {
        deckType = "mystagogus";
      }
      var lowerSuit = suitRaw.toLowerCase();
      if (TAROT_SUIT_META[lowerSuit]) {
        suitKey = lowerSuit;
      } else if (ZH_SUIT_TO_KEY[suitRaw]) {
        suitKey = ZH_SUIT_TO_KEY[suitRaw];
      }
      if (deckType === "tarot" && !arcana) {
        var layer = raw.layer === "major" || raw.layer === "minor" ? raw.layer : "";
        if (!(layer === "major" && suitKey)) {
          arcana = layer || (suitKey ? "minor" : "");
        }
      }
    }

    var suitMeta = suitKey ? TAROT_SUIT_META[suitKey] : null;
    var rankMeta = rankKey ? TAROT_RANK_META[rankKey] : null;

    var lxxxiRealm = "";
    var lxxxiRealmZh = "";
    var lxxxiRealmEn = "";
    if (deckType === "lxxxi" && number !== null) {
      if (number >= 1 && number <= 4) {
        lxxxiRealm = "divine";
        lxxxiRealmZh = "神圣领域";
        lxxxiRealmEn = "Divine Realm";
      } else if (number >= 5 && number <= 26) {
        lxxxiRealm = "inner";
        lxxxiRealmZh = "内在领域";
        lxxxiRealmEn = "Inner Realm";
      } else if (number >= 27 && number <= 77) {
        lxxxiRealm = "physical";
        lxxxiRealmZh = "物质领域";
        lxxxiRealmEn = "Physical Realm";
      } else if (number >= 78 && number <= 81) {
        lxxxiRealm = "underworld";
        lxxxiRealmZh = "冥界领域";
        lxxxiRealmEn = "Underworld Realm";
      }
    }

    return {
      cardId: cardId,
      deckType: deckType,
      arcana: arcana || (deckType === "tarot" ? "" : deckType),
      number: number,
      suitKey: suitKey,
      suitZh: suitMeta ? suitMeta.zh : "",
      suitEn: suitMeta ? suitMeta.en : "",
      elementKey: suitMeta ? suitMeta.elementKey : "",
      elementZh: suitMeta ? suitMeta.elementZh : "",
      elementEn: suitMeta ? suitMeta.elementEn : "",
      rankKey: rankKey,
      rankMeta: rankMeta,
      isCourt: Boolean(rankMeta && rankMeta.isCourt),
      lxxxiRealm: lxxxiRealm,
      lxxxiRealmZh: lxxxiRealmZh,
      lxxxiRealmEn: lxxxiRealmEn,
      lxxxiRootRoman: deckType === "lxxxi" && number !== null ? (LXXXI_ROOT_POWERS[number] || "") : "",
      isSmallCheck: Boolean(deckType === "lxxxi" && number !== null && LXXXI_SMALL_CHECK_CARDS[number]),
      mystagogusSignal: deckType === "mystagogus" && number !== null ? (MYSTAGOGUS_SIGNALS[number] || null) : null
    };
  }

  function stripControlAndCidGarbage(text) {
    return String(text || "")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\(cid:\d+\)\s*\d*[^，。；;\n]*/gi, "")
      .replace(/麦可[．.·]?雪帕德[^，。；;\n]*/g, "")
      .replace(/门户之书[：:][^，。；;\n]*/g, "")
      .replace(/︔/g, "；")
      .replace(/（译注[：:][^）]*）/g, "")
      .replace(/\(译注[：:][^)]*\)/g, "")
      .replace(/（请参考[^）]*）/g, "")
      .replace(/（见下一张牌）/g, "")
      .replace(/([\u4E00-\u9FFF])\s+([\u4E00-\u9FFF])/g, "$1$2")
      .replace(/([\u4E00-\u9FFF])\s+([\u4E00-\u9FFF])/g, "$1$2")
      .replace(/\s+/g, " ")
      .trim();
  }

  var SINGLE_CHAR_VALID_KEYWORDS_ZH = /^(?:是|否|空|零|火|水|风|土|家|死|病|债|光|爱|法|善|恶)$/;

  function cleanSingleKeyword(rawItem, isEnglish) {
    var s = stripControlAndCidGarbage(rawItem);
    if (!s) {
      return "";
    }
    if (isEnglish) {
      s = s
        .replace(/^(?:and|or)\s+/i, "")
        .replace(/[.]+$/g, "")
        .trim();
      if (!s || s.length > 48) {
        return "";
      }
      return s;
    }

    // Drop meta-book fragments from LXXXI punctuation-split keywords
    if (/占卜|这张牌|此牌|这是一张|它指出|它可以|它也|表示占卜|大多数情况|座落的位置|除了上面|一般来说|如果它出现|当她出现|与这张牌|^例如[：:]/.test(s)) {
      return "";
    }

    s = s
      .replace(/^[「『"]+|[」』"]+$/g, "")
      .replace(/^(?:或|但|且|以及|或是)/, "")
      .replace(/的牌$/, "")
      .replace(/^[：:，、；\s]+|[：:，、；。.\s]+$/g, "")
      .trim();

    if (!s || s.length > 14) {
      return "";
    }
    if (s.length === 1 && !SINGLE_CHAR_VALID_KEYWORDS_ZH.test(s)) {
      return "";
    }
    if (/^(?:如果|因为|虽然|除了|根据)/.test(s)) {
      return "";
    }
    return s;
  }

  function sanitizeKeywords(rawKeywords, identity, isEnglish) {
    if (!isEnglish && identity.deckType === "lxxxi" && identity.number && LXXXI_COMPACT_ZH[identity.number]) {
      return (LXXXI_COMPACT_ZH[identity.number].kw || []).slice(0, 8);
    }

    var list = Array.isArray(rawKeywords) ? rawKeywords : [];
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var cleaned = cleanSingleKeyword(list[i], isEnglish);
      if (!cleaned) {
        continue;
      }
      var key = cleaned.toLowerCase();
      if (seen[key]) {
        continue;
      }
      seen[key] = true;
      out.push(cleaned);
      if (out.length >= 8) {
        break;
      }
    }
    return out;
  }

  function stripTarotNumberBoilerplateZh(text) {
    var out = String(text || "");
    for (var i = 0; i < TAROT_NUMBER_DYNAMICS_SENTENCES_ZH.length; i += 1) {
      var needle = TAROT_NUMBER_DYNAMICS_SENTENCES_ZH[i];
      if (out.indexOf(needle) !== -1) {
        out = out.split(needle).join("");
      }
    }
    return out.replace(/^[。；，\s]+|[。；，\s]+$/g, "").trim();
  }

  function stripEnglishTemplateShell(text) {
    var s = stripControlAndCidGarbage(text);
    if (!s) {
      return "";
    }
    s = s
      .replace(/^Reversed,\s+[^.]+?\s+warns\s+of\s+/i, "")
      .replace(/^[^.]{2,42}?\s+points\s+to\s+/i, "")
      .replace(/\.?\s*Read this as the active pattern shaping the situation\.?/gi, "")
      .replace(/\.?\s*Pause,\s*check the facts,\s*and correct the imbalance before proceeding\.?/gi, "")
      .replace(/^This is a sign of\s+/i, "")
      .replace(/[.:\s]+$/g, "")
      .trim();
    return s;
  }

  function distillChineseProse(rawText, identity, register, isReversed) {
    var text = stripTarotNumberBoilerplateZh(stripControlAndCidGarbage(rawText));

    if (identity.deckType === "lxxxi" && identity.number && LXXXI_COMPACT_ZH[identity.number]) {
      var entry = LXXXI_COMPACT_ZH[identity.number];
      if (!text || text.length > 85 || /这张牌|此牌|占卜/.test(text)) {
        return (register === "esoteric" || register === "dual")
          ? (entry.cue + "｜灵性/内在层：" + entry.eso)
          : entry.cue;
      }
    }

    if (!text) {
      return "";
    }

    text = text
      .replace(/^[^，。]{1,10}逆位(?:时|表示|显示|暗示|提醒|提示)[，：:\s]*/, "")
      .replace(/(?:当)?(?:这张牌|此牌)(?:的?出现)?(?:在[^，。；]*占卜[中时])?[，：,\s]*(?:可?以?就字面上解读为|告诉我们|表示|暗示著?|意味著?|意味着|代表|传达著?|诉说著?|宣告著?|说明|指向)?/g, "")
      .replace(/^[，。；：:\s]+|[：:，；\s]+$/g, "")
      .trim();

    if (isReversed) {
      var revParts = text.split(/[。！？]+/).map(function (p) { return p.trim(); }).filter(Boolean);
      var revCore = revParts.slice(0, 2).join("；");
      if (revCore.length > 84) {
        revCore = revParts[0];
      }
      return revCore.replace(/[。：:，；\s]+$/, "");
    }

    if (text.length > 96) {
      var parts = text.split(/[。！？；]+/).map(function (p) { return p.trim(); }).filter(Boolean);
      var joined = parts.slice(0, 2).join("；");
      text = joined.length <= 108 ? joined : parts[0];
    }
    text = text.replace(/[。：:，；\s]+$/, "");

    if (identity.deckType === "mystagogus" && identity.number && MYSTAGOGUS_ZH_SUPPLEMENTS[identity.number]) {
      text = text + "｜" + MYSTAGOGUS_ZH_SUPPLEMENTS[identity.number];
    }
    return text;
  }

  function distillEnglishProse(rawText, identity, register, isReversed) {
    if (!isReversed && identity.deckType === "mystagogus" && identity.number && MYSTAGOGUS_EN_FACTS[identity.number]) {
      if (!rawText || /Read this as the active pattern|points\s+to/i.test(String(rawText))) {
        return MYSTAGOGUS_EN_FACTS[identity.number];
      }
    }

    var stripped = stripEnglishTemplateShell(rawText);
    if (stripped.length > 180) {
      var clauses = stripped.split(/[.;]+/).map(function (c) { return c.trim(); }).filter(Boolean);
      var two = clauses.slice(0, 2).join("; ");
      stripped = two.length <= 190 ? two : clauses[0];
    }
    stripped = stripped.replace(/[.:\s]+$/, "");

    if (!isReversed && identity.deckType === "lxxxi" && identity.number && LXXXI_EN_SUPPLEMENTS[identity.number]) {
      var supp = LXXXI_EN_SUPPLEMENTS[identity.number];
      stripped = stripped ? (stripped + " | " + supp) : supp;
    }

    if (!isReversed && identity.deckType === "tarot") {
      var qOverride = TAROT_QUAREIA_OVERRIDES[identity.cardId];
      if (qOverride && qOverride.en) {
        return qOverride.en;
      }
      if (identity.arcana === "minor" && identity.rankKey && TAROT_RANK_COMPACT_ACTION_EN[identity.rankKey]) {
        var rActEn = TAROT_RANK_COMPACT_ACTION_EN[identity.rankKey];
        stripped = stripped ? (stripped + " — " + rActEn) : rActEn;
      }
    }

    return stripped;
  }

  var ZERO_EMPTY_CARD_IDS = {
    "major-00": true,
    "lxxxi-03": true,
    "lxxxi-67": true,
    "m-22": true,
    "m-78": true
  };

  function buildFilterSlotHint(card, identity, spreadId, isFilterSpread, isEnglish) {
    var posNum = Number(card && card.positionNumber) || 0;
    if (!isFilterSpread && spreadId !== "manifestation-cause" && spreadId !== "solution" && spreadId !== "direction" && spreadId !== "timing") {
      return "";
    }
    // Only retain objective canonical zero/void attribute for compass location slots;
    // dynamic scale & slot-domain matching is handled in spread circuitry without static pre-culling.
    if (spreadId === "direction" && ZERO_EMPTY_CARD_IDS[identity.cardId]) {
      if (posNum >= 2) {
        return isEnglish
          ? "Zero/empty signal—canonical void/blocked marker (target is NOT in this direction)"
          : "零点/空位信号——原典「空/死路」标记（目标不在此方位）";
      }
      return isEnglish
        ? "Zero/void point—canonical Quareia zero/unformed or empty-track marker"
        : "原典零点/虚空标记——代表尚未成形、落空或归零信号";
    }
    return "";
  }

  function normalizeRegisterValue(reg) {
    if (reg === "esoteric" || reg === "dual") {
      return reg;
    }
    return "mundane";
  }

  function compileCardCue(card, options) {
    var opts = options && typeof options === "object" ? options : {};
    var locale = normalizeLocale(opts.locale);
    var isEnglish = locale === "en";
    var register = normalizeRegisterValue(opts.register);
    var rawCard = card && typeof card === "object" ? card : {};
    var identity = parseCardIdentity(rawCard, opts.deckType);
    var spreadId = String(opts.spreadId || "").trim();
    var spreadMeta = SPREAD_TOPOLOGY_CATALOG[spreadId] || null;
    var isFilterSpread = typeof opts.isFilterSpread === "boolean"
      ? opts.isFilterSpread
      : Boolean(spreadMeta && spreadMeta.isFilter);

    var isReversed = identity.deckType === "tarot" && rawCard.orientation === "reversed";
    var keywordsClean = sanitizeKeywords(rawCard.keywords, identity, isEnglish);

    var prefixTags = [];
    if (identity.deckType === "lxxxi") {
      if (identity.lxxxiRealmZh) {
        prefixTags.push(isEnglish ? identity.lxxxiRealmEn : identity.lxxxiRealmZh);
      }
      if (identity.lxxxiRootRoman) {
        prefixTags.push(isEnglish ? ("Root Power " + identity.lxxxiRootRoman) : ("核心力量" + identity.lxxxiRootRoman));
      } else if (identity.isSmallCheck) {
        prefixTags.push(isEnglish ? "Minor Check Card" : "日常校验牌");
      }
    } else if (identity.deckType === "tarot") {
      if (identity.arcana === "major") {
        prefixTags.push(isEnglish ? "Major Arcana" : "大阿卡那");
      } else if (identity.suitZh) {
        prefixTags.push(isEnglish
          ? (identity.suitEn + "/" + identity.elementEn)
          : (identity.suitZh + "·" + identity.elementZh));
      }
    } else if (identity.deckType === "mystagogus" && identity.mystagogusSignal) {
      prefixTags.push(isEnglish ? identity.mystagogusSignal.en : identity.mystagogusSignal.zh);
    }

    var distilledMain = isEnglish
      ? distillEnglishProse(rawCard.meaning, identity, register, isReversed)
      : distillChineseProse(rawCard.meaning, identity, register, isReversed);

    // Canonical Quareia Major Arcana anchors in Chinese (prevents pop-tarot drift)
    if (!isEnglish && !isReversed && identity.deckType === "tarot" && TAROT_QUAREIA_OVERRIDES[identity.cardId] && TAROT_QUAREIA_OVERRIDES[identity.cardId].zh) {
      var zhOverride = TAROT_QUAREIA_OVERRIDES[identity.cardId].zh;
      if (identity.cardId === "major-00") {
        distilledMain = zhOverride;
      } else {
        distilledMain = distilledMain ? (distilledMain + "｜" + zhOverride) : zhOverride;
      }
    }

    var uprightAnchor = "";
    var reversalVector = "";

    if (isReversed) {
      var rawUprightRef = rawCard.uprightMeaningRef || "";
      var uprightKwClean = sanitizeKeywords(rawCard.uprightKeywordsRef, identity, isEnglish);
      var distilledUpright = isEnglish
        ? distillEnglishProse(rawUprightRef, identity, register, false)
        : distillChineseProse(rawUprightRef, identity, register, false);

      if (TAROT_QUAREIA_OVERRIDES[identity.cardId]) {
        var revOv = isEnglish ? TAROT_QUAREIA_OVERRIDES[identity.cardId].en : TAROT_QUAREIA_OVERRIDES[identity.cardId].zh;
        if (revOv) {
          distilledUpright = revOv;
        }
      }

      if (!isEnglish) {
        if (uprightKwClean.length > 0) {
          if (!distilledUpright) {
            uprightAnchor = uprightKwClean.join("、");
          } else if (distilledUpright.length <= 12) {
            var mergedUp = uprightKwClean.slice();
            if (mergedUp.indexOf(distilledUpright) === -1) {
              mergedUp.push(distilledUpright);
            }
            uprightAnchor = mergedUp.join("、");
          } else {
            uprightAnchor = distilledUpright;
          }
        } else {
          uprightAnchor = distilledUpright;
        }
      } else {
        uprightAnchor = distilledUpright || (uprightKwClean.length > 0 ? uprightKwClean.join(", ") : "");
      }

      // Never fall back to reversed keywordsClean for uprightAnchor!
      if (!uprightAnchor) {
        if (identity.suitZh && identity.rankMeta) {
          uprightAnchor = isEnglish
            ? (identity.rankMeta.en + " of " + identity.suitEn + " (" + identity.elementEn + ") upright root force")
            : (identity.suitZh + "（" + identity.elementZh + "）" + identity.rankMeta.zh + "阶正位本源力量");
        } else if (identity.arcana === "major") {
          uprightAnchor = isEnglish ? "Core upright Major Arcana principle" : "该大阿卡那正位原初法则力量";
        } else {
          uprightAnchor = isEnglish ? "Core upright function of this card" : "该牌正位根源力量";
        }
      }

      var revRaw = distilledMain || (keywordsClean.length > 0 ? keywordsClean.join(isEnglish ? ", " : "、") : "");
      reversalVector = isEnglish
        ? ("Blocked, delayed, internalized, or overdriven vector: " + (revRaw || "flow turns inward or stalls") + " (weigh with position polarity)")
        : ("能量阻滞/延迟/内耗或过度代偿：" + (revRaw || "原本流向受阻或变形") + "（须结合牌位正负向综合推演）");
    } else {
      if (!isEnglish && identity.deckType === "tarot" && identity.arcana === "minor" && identity.rankKey && TAROT_RANK_COMPACT_ACTION_ZH[identity.rankKey]) {
        var rankAct = TAROT_RANK_COMPACT_ACTION_ZH[identity.rankKey];
        if (!distilledMain) {
          distilledMain = keywordsClean.length > 0
            ? (keywordsClean.join("、") + "（" + rankAct + "）")
            : rankAct;
        } else if (distilledMain.length <= 8) {
          distilledMain = "围绕「" + distilledMain + "」展开的" + rankAct;
        }
      } else if (!distilledMain && keywordsClean.length > 0) {
        distilledMain = keywordsClean.join(isEnglish ? ", " : "、");
      } else if (!distilledMain && identity.suitZh && identity.rankMeta) {
        distilledMain = isEnglish
          ? (identity.rankMeta.en + " of " + identity.suitEn + " (" + identity.elementEn + ") active dynamic")
          : (identity.suitZh + "·" + identity.elementZh + "之" + identity.rankMeta.zh + "阶动态");
      }
      uprightAnchor = distilledMain;
    }

    var tagHeader = prefixTags.length > 0 ? ("[" + prefixTags.join(" · ") + "] ") : "";
    var coreCue = "";
    if (isReversed) {
      coreCue = isEnglish
        ? (tagHeader + "Root: " + uprightAnchor + " | Reversed shift: " + reversalVector)
        : (tagHeader + "正位根源：" + uprightAnchor + "｜逆位偏转：" + reversalVector);
    } else {
      coreCue = tagHeader + (uprightAnchor || (keywordsClean.join(isEnglish ? ", " : "、")));
    }

    var filterSlotHint = buildFilterSlotHint(rawCard, identity, spreadId, isFilterSpread, isEnglish);

    return {
      keywordsClean: keywordsClean,
      coreCue: coreCue.trim(),
      uprightAnchor: uprightAnchor.trim(),
      reversalVector: reversalVector.trim(),
      filterSlotHint: filterSlotHint
    };
  }

  function detectPositionConcepts(positionName) {
    var name = String(positionName || "").trim();
    if (!name) {
      return [];
    }
    var hits = [];
    for (var i = 0; i < POSITION_CONCEPT_RULES.length; i += 1) {
      var rule = POSITION_CONCEPT_RULES[i];
      if (rule.re.test(name)) {
        hits.push(rule.concept);
      }
    }
    return hits;
  }

  function lookupGlobalSpread(spreadId) {
    if (!spreadId) {
      return null;
    }
    var pools = [global.lxxxiSpreads, global.mystagogusSpreads, global.tarotSpreads];
    for (var p = 0; p < pools.length; p += 1) {
      var arr = pools[p];
      if (!Array.isArray(arr)) {
        continue;
      }
      for (var i = 0; i < arr.length; i += 1) {
        if (arr[i] && arr[i].id === spreadId) {
          return arr[i];
        }
      }
    }
    return null;
  }

  function registerPositionConceptEntry(conceptToPositions, pNum, posName, isEnglish) {
    var pConcepts = detectPositionConcepts(posName);
    for (var cIdx = 0; cIdx < pConcepts.length; cIdx += 1) {
      var concept = pConcepts[cIdx];
      if (!conceptToPositions[concept]) {
        conceptToPositions[concept] = [];
      }
      var exists = false;
      for (var k = 0; k < conceptToPositions[concept].length; k += 1) {
        if (conceptToPositions[concept][k].positionNumber === pNum) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        conceptToPositions[concept].push({
          positionNumber: pNum,
          positionName: posName || ((isEnglish ? "Position " : "第 ") + pNum)
        });
      }
    }
  }

  function detectDisplacements(cards, deckType, spreadId, isEnglish) {
    if (deckType !== "lxxxi" && deckType !== "mystagogus") {
      return [];
    }
    var list = Array.isArray(cards) ? cards : [];
    if (list.length === 0) {
      return [];
    }

    // Build map of concept -> position entry from both drawn cards and preset spread catalog
    var conceptToPositions = {};
    var posNumToCards = {};
    for (var i = 0; i < list.length; i += 1) {
      var item = list[i];
      if (!item) {
        continue;
      }
      var pNum = Number(item.positionNumber) || (i + 1);
      if (!posNumToCards[pNum]) {
        posNumToCards[pNum] = [];
      }
      posNumToCards[pNum].push(item);
      registerPositionConceptEntry(conceptToPositions, pNum, item.positionName, isEnglish);
    }

    var spreadDef = lookupGlobalSpread(spreadId);
    if (spreadDef && Array.isArray(spreadDef.positions)) {
      for (var spIdx = 0; spIdx < spreadDef.positions.length; spIdx += 1) {
        var spPos = spreadDef.positions[spIdx];
        if (!spPos) {
          continue;
        }
        var spNum = Number(spPos.number) || (spIdx + 1);
        var spLabel = isEnglish ? (spPos.nameEn || spPos.name) : (spPos.name || spPos.nameEn);
        registerPositionConceptEntry(conceptToPositions, spNum, spLabel, isEnglish);
      }
    }

    var displacements = [];
    var seenPairs = {};

    for (var j = 0; j < list.length; j += 1) {
      var drawn = list[j];
      if (!drawn || !drawn.cardId) {
        continue;
      }
      var cardKey = String(drawn.cardId).trim().toLowerCase();
      var cardConcepts = CARD_DISPLACEMENT_CONCEPTS[cardKey];
      if (!cardConcepts || cardConcepts.length === 0) {
        continue;
      }
      var drawnPosNum = Number(drawn.positionNumber) || (j + 1);
      for (var m = 0; m < cardConcepts.length; m += 1) {
        var matchedPositions = conceptToPositions[cardConcepts[m]] || [];
        for (var n = 0; n < matchedPositions.length; n += 1) {
          var nativePos = matchedPositions[n];
          if (nativePos.positionNumber === drawnPosNum) {
            continue;
          }
          var pairKey = drawnPosNum + ":" + cardKey + "->" + nativePos.positionNumber;
          if (seenPairs[pairKey]) {
            continue;
          }
          seenPairs[pairKey] = true;

          var residentCards = posNumToCards[nativePos.positionNumber] || [];
          var residentLabel = residentCards.map(function (rc) { return rc.cardName; }).filter(Boolean).join(" / ");
          var residentSuffixZh = residentLabel ? ("（该本位当前为〈" + residentLabel + "〉）") : "";
          var residentSuffixEn = residentLabel ? (" (currently holding <" + residentLabel + ">)") : "";

          var note = isEnglish
            ? ("Position-card displacement: Pos " + drawnPosNum + " (" + drawn.positionName + ") drew <" + drawn.cardName + ">, which corresponds to Pos " + nativePos.positionNumber + " (" + nativePos.positionName + ")" + residentSuffixEn + "—cross-read Pos " + drawnPosNum + " and Pos " + nativePos.positionNumber + " as one linked circuit.")
            : ("位置牌移位共振：第 " + drawnPosNum + " 位「" + drawn.positionName + "」抽到了对应本阵第 " + nativePos.positionNumber + " 位「" + nativePos.positionName + "」的同名母牌〈" + drawn.cardName + "〉" + residentSuffixZh + "——须将第 " + drawnPosNum + " 位与第 " + nativePos.positionNumber + " 位连成同一回路并读！");

          displacements.push({
            positionNumber: drawnPosNum,
            positionName: String(drawn.positionName || ""),
            landedPositionNumber: drawnPosNum,
            landedPositionName: String(drawn.positionName || ""),
            cardId: cardKey,
            cardName: String(drawn.cardName || ""),
            nativePositionNumber: nativePos.positionNumber,
            nativePositionName: String(nativePos.positionName || ""),
            homePositionNumber: nativePos.positionNumber,
            homePositionName: String(nativePos.positionName || ""),
            note: note
          });
        }
      }
    }

    return displacements;
  }

  function buildCustomSpreadCircuitHint(resolved, cards, isEnglish) {
    var total = cards.length;
    if (total === 0) {
      return isEnglish
        ? "Synthesize central tension first, then connect supporting and opposing positions without numbering slot-by-slot."
        : "先抓核心矛盾定调，再串联互相对偶或因果关联的牌位，切勿按编号流水账念牌。";
    }
    var crossings = [];
    for (var i = 0; i < cards.length; i += 1) {
      var c = cards[i];
      if (c && Number.isInteger(c.stackOn) && c.stackOn > 0) {
        crossings.push({ from: c.positionNumber, to: c.stackOn, name: c.positionName });
      }
    }
    var crossTextZh = crossings.length > 0
      ? ("先锁定交叉焦点 [" + crossings.map(function (x) { return "第" + x.from + "位×第" + x.to + "位"; }).join("、") + "]，")
      : "依据实际牌位名称与牌位职能确定主轴，";
    var crossTextEn = crossings.length > 0
      ? ("Lock onto crossing hub(s) [" + crossings.map(function (x) { return "Pos " + x.from + " × Pos " + x.to; }).join(", ") + "] first, ")
      : "Choose the main axis using the actual position names and position roles, ";

    var stackTextZh = resolved && resolved.isSplitDeckStacked
      ? "每个牌位以底层大牌为深层成因、上层小牌为日常表象，"
      : "";
    var stackTextEn = resolved && resolved.isSplitDeckStacked
      ? "reading each slot's Base Major as underlying cause and Stacked Minor as everyday manifestation, "
      : "";

    return isEnglish
      ? (crossTextEn + stackTextEn + "then group remaining positions by functional contrast (support vs. friction, past root vs. next step) rather than listing 1 through " + total + ".")
      : (crossTextZh + stackTextZh + "再将其余牌位按「助力vs阻力、来路vs去向」聚类成文，严禁从第1位到第" + total + "位挨个点名。");
  }

  function getSpreadTopologyMeta(spreadId, resolved, isEnglish) {
    var key = String(spreadId || "").trim();
    var preset = SPREAD_TOPOLOGY_CATALOG[key];
    if (preset) {
      var hint = isEnglish ? preset.circuitEn : preset.circuitZh;
      if (key === "overview" && resolved && resolved.isSplitDeckStacked) {
        hint += isEnglish
          ? " In 26-card Split-Deck mode, read every slot's Base Major as deep fate tide (cause) and Stacked Minor as surface daily expression (effect), highlighting mismatches where calm surfaces hide turbulent Majors or solid Majors contain minor bumps."
          : " 当前为26张分牌叠放模式：每处均须以底牌大阿卡那为水下深层动因（因）、叠牌小阿卡那为日常显化（果），重点点破「底稳表乱（小风浪可控）」或「底暗表顺（平静下藏结构拐点）」的反差位！";
      }
      return {
        topologyFamily: preset.family,
        isFilterSpread: Boolean(preset.isFilter),
        readingCircuitHint: hint
      };
    }
    var cards = resolved && Array.isArray(resolved.cards) ? resolved.cards : [];
    return {
      topologyFamily: "custom-grid",
      isFilterSpread: false,
      readingCircuitHint: buildCustomSpreadCircuitHint(resolved, cards, isEnglish)
    };
  }

  function analyzeReadingGestalt(resolved, locale) {
    var effectiveLocale = normalizeLocale(locale || (resolved && resolved.locale));
    var isEnglish = effectiveLocale === "en";
    var data = resolved && typeof resolved === "object" ? resolved : {};
    var spreadId = String(data.spreadId || "").trim();
    var deckType = data.deckType === "lxxxi" || data.deckType === "mystagogus" ? data.deckType : "tarot";
    var cards = Array.isArray(data.cards) ? data.cards : [];

    var topo = getSpreadTopologyMeta(spreadId, data, isEnglish);
    var summaryLines = [];

    if (cards.length === 0) {
      return {
        topologyFamily: topo.topologyFamily,
        isFilterSpread: topo.isFilterSpread,
        summaryLines: [],
        displacements: [],
        readingCircuitHint: topo.readingCircuitHint
      };
    }

    var identities = cards.map(function (c) { return parseCardIdentity(c, deckType); });

    // 1. Deck-specific macro power / realm / signal density
    if (deckType === "tarot") {
      var majorCount = 0;
      var minorCount = 0;
      var unknownArcanaCount = 0;
      var unknownSuitCount = 0;
      var reversedCount = 0;
      var suitCounts = { wands: 0, cups: 0, swords: 0, pentacles: 0 };
      var rankCounts = {};
      var courtCount = 0;

      for (var i = 0; i < cards.length; i += 1) {
        var iden = identities[i];
        var cardEntry = cards[i];
        if (cardEntry && cardEntry.orientation === "reversed") {
          reversedCount += 1;
        }
        if (iden.arcana === "major") {
          majorCount += 1;
        } else if (iden.arcana === "minor") {
          minorCount += 1;
          if (iden.suitKey && suitCounts[iden.suitKey] !== undefined) {
            suitCounts[iden.suitKey] += 1;
          } else {
            unknownSuitCount += 1;
          }
          if (iden.rankKey) {
            rankCounts[iden.rankKey] = (rankCounts[iden.rankKey] || 0) + 1;
          }
          if (iden.isCourt) {
            courtCount += 1;
          }
        } else {
          unknownArcanaCount += 1;
        }
      }

      if (unknownArcanaCount > 0) {
        summaryLines.push(isEnglish
          ? ("Known arcana: " + majorCount + " Major + " + minorCount + " Minor; " + unknownArcanaCount + " unknown. Do not infer whole-spread arcana proportions from incomplete identities.")
          : ("已知牌类：" + majorCount + " 张大阿卡那 + " + minorCount + " 张小阿卡那；" + unknownArcanaCount + " 张牌类未知，不应据此推断全盘大小牌比例。"));
      } else if (data.isSplitDeckStacked) {
        summaryLines.push(isEnglish
          ? ("Split-Deck causality active (" + majorCount + " Base Majors as deep cause + " + minorCount + " Stacked Minors as daily manifestation).")
          : ("分牌叠牌法激活（" + majorCount + " 张底层大阿卡那定深层动因 + " + minorCount + " 张上层小阿卡那显日常落点）。"));
      } else if (data.filterMode !== "major-only" && data.filterMode !== "minor-only" && spreadId !== "four-seasons") {
        var majorRatio = majorCount / cards.length;
        if (majorRatio >= 0.45 && cards.length >= 3) {
          summaryLines.push(isEnglish
            ? ("High Major Arcana density (" + majorCount + "/" + cards.length + "): strong archetypal/fate momentum at work—focus on structural shifts rather than trivial tweaks.")
            : ("大阿卡那密度偏高（" + majorCount + "/" + cards.length + "）：深层命运齿轮与长期结构力量主导，非一时情绪或表面微调所能轻改。"));
        } else if (majorCount === 0 && cards.length >= 4) {
          summaryLines.push(isEnglish
            ? ("All Minor Arcana (" + cards.length + " cards): everyday human-scale friction, habits, and practical choices—high personal room to maneuver.")
            : ("全盘皆为小阿卡那（共 " + cards.length + " 张）：事态处于日常人事磨合与习惯层面，未触发重度宿命锁死，个人主动调整空间极大。"));
        } else {
          summaryLines.push(isEnglish
            ? ("Arcana balance: " + majorCount + " Major (structural tide) + " + minorCount + " Minor (practical expression).")
            : ("大小牌配比：" + majorCount + " 张大阿卡那（底层推力）+ " + minorCount + " 张小阿卡那（现实落点）。"));
        }
      }

      if (data.orientationMode === "mixed") {
        summaryLines.push(isEnglish
          ? ("Mixed orientation stats: " + reversedCount + "/" + cards.length + " Reversed (treat reversals as blocked, internalized, or delayed vectors on the upright root power).")
          : ("正逆分布：" + reversedCount + "/" + cards.length + " 张逆位（逆位须作正位根源能量的阻滞、内耗、延迟或松绑推演，禁当独立词条硬背）。"));
      }

      // Elemental tilt & missing elements
      if (minorCount >= 3 && unknownArcanaCount === 0 && unknownSuitCount === 0 && spreadId !== "four-seasons") {
        var suitOrder = ["wands", "cups", "swords", "pentacles"];
        var presentParts = [];
        var missingParts = [];
        var dominantKey = "";
        var dominantVal = 0;

        for (var sIdx = 0; sIdx < suitOrder.length; sIdx += 1) {
          var sk = suitOrder[sIdx];
          var cnt = suitCounts[sk];
          var sm = TAROT_SUIT_META[sk];
          if (cnt > dominantVal) {
            dominantVal = cnt;
            dominantKey = sk;
          }
          if (cnt > 0) {
            presentParts.push(isEnglish ? (sm.en + "(" + sm.elementEn + "):" + cnt) : (sm.zh + "(" + sm.elementZh + ")×" + cnt));
          } else if (minorCount >= 4) {
            missingParts.push(isEnglish ? (sm.en + "/" + sm.elementEn) : (sm.zh + "/" + sm.elementZh));
          }
        }

        var elemLine = isEnglish
          ? ("Elemental distribution: " + presentParts.join(", "))
          : ("花色与四元素分布：" + presentParts.join("、"));
        if (dominantKey && dominantVal >= Math.ceil(minorCount * 0.5)) {
          var domMeta = TAROT_SUIT_META[dominantKey];
          elemLine += isEnglish
            ? (" — " + domMeta.elementEn + "-dominant climate")
            : (" —— 盘面明显偏向「" + domMeta.elementZh + "」元素主导");
        }
        if (missingParts.length > 0 && missingParts.length <= 3) {
          elemLine += isEnglish
            ? ("; absent: " + missingParts.join(", ") + " (note what dimension is lacking)")
            : ("；缺席元素：" + missingParts.join("、") + "（留意该现实维度的缺位）");
        }
        summaryLines.push(elemLine + (isEnglish ? "." : "。"));
      }

      // Rank clusters
      var repeatedRanks = [];
      var rankKeys = Object.keys(rankCounts);
      for (var rIdx = 0; rIdx < rankKeys.length; rIdx += 1) {
        var rk = rankKeys[rIdx];
        if (rankCounts[rk] >= 2 && TAROT_RANK_META[rk]) {
          repeatedRanks.push(isEnglish
            ? (rankCounts[rk] + "× " + TAROT_RANK_META[rk].clusterEn)
            : (rankCounts[rk] + "张" + TAROT_RANK_META[rk].clusterZh));
        }
      }
      if (courtCount >= 3) {
        repeatedRanks.push(isEnglish
          ? (courtCount + " Court cards (multiple human actors, roles, or interpersonal agendas entangled)")
          : ("宫廷牌密集（共" + courtCount + "张：多名关键人物角色或人际立场交织博弈）"));
      }
      if (repeatedRanks.length > 0) {
        summaryLines.push((isEnglish ? "Numerical/Court clusters: " : "数字与宫廷共振簇：") + repeatedRanks.join(isEnglish ? "; " : "；") + (isEnglish ? "." : "。"));
      }
    } else if (deckType === "lxxxi") {
      var realmCounts = { divine: 0, inner: 0, physical: 0, underworld: 0 };
      var rootList = [];
      var unknownRealmCount = 0;
      for (var lIdx = 0; lIdx < identities.length; lIdx += 1) {
        var li = identities[lIdx];
        if (li.deckType === "lxxxi" && Number.isInteger(li.number) && li.lxxxiRealm && realmCounts[li.lxxxiRealm] !== undefined) {
          realmCounts[li.lxxxiRealm] += 1;
        } else {
          unknownRealmCount += 1;
        }
        if (li.deckType === "lxxxi" && Number.isInteger(li.number) && li.lxxxiRootRoman) {
          rootList.push(cards[lIdx].cardName + "(" + li.lxxxiRootRoman + ")");
        }
      }
      if (unknownRealmCount) {
        summaryLines.push(isEnglish
          ? (unknownRealmCount + " LXXXI card identities unknown; the complete realm distribution cannot be determined.")
          : (unknownRealmCount + " 张 LXXXI 牌的身份未知，无法确定全盘领域分布。"));
      } else summaryLines.push(isEnglish
        ? ("LXXXI Four-Realm distribution: Divine(1-4):" + realmCounts.divine + ", Inner(5-26):" + realmCounts.inner + ", Physical(27-77):" + realmCounts.physical + ", Underworld(78-81):" + realmCounts.underworld + " — gauge whether patterns are unformed seeds, weaving inner currents, manifest reality, or ending cycles.")
        : ("LXXXI 四领域分布：神圣领域(1-4)×" + realmCounts.divine + "、内在领域(5-26)×" + realmCounts.inner + "、物质领域(27-77)×" + realmCounts.physical + "、冥界领域(78-81)×" + realmCounts.underworld + "（据此判定事态尚在潜流酝酿、已落地显化，还是步入终结清场）。"));
      if (rootList.length > 0) {
        summaryLines.push(isEnglish
          ? ("Active Root Powers (I–X): " + rootList.join(", ") + " — anchor structural weight on these over minor check cards.")
          : ("在场十大根源力量（I–X）：" + rootList.join("、") + "（定盘面主权骨架，优先级高于日常小型校验牌）。"));
      }
    } else if (deckType === "mystagogus") {
      var signalHits = [];
      var unknownSignalCount = 0;
      for (var mIdx = 0; mIdx < identities.length; mIdx += 1) {
        var mi = identities[mIdx];
        if (mi.deckType !== "mystagogus" || !Number.isInteger(mi.number) || mi.number < 1 || mi.number > 78) {
          unknownSignalCount += 1;
        } else if (mi.mystagogusSignal) {
          var mc = cards[mIdx];
          signalHits.push(isEnglish
            ? ("Pos " + mc.positionNumber + " <" + mc.cardName + ">: " + mi.mystagogusSignal.en)
            : ("第" + mc.positionNumber + "位〈" + mc.cardName + "〉：" + mi.mystagogusSignal.zh));
        }
      }
      if (signalHits.length > 0) {
        summaryLines.push((isEnglish ? "Mystagogus active road-signs & gates: " : "M牌直断路标与门户信号：") + signalHits.join(isEnglish ? "; " : "；") + (isEnglish ? "." : "。"));
      } else if (!unknownSignalCount) {
        summaryLines.push(isEnglish
          ? "Mystagogus pattern scan: no hard red-light/gate trump overrides; weigh active weave between supportive and restrictive positions."
          : "M牌全局扫描：未触发极端封堵红灯牌，重点权衡支持位与束缚/危险位的力量消长。");
      }
      if (unknownSignalCount) {
        summaryLines.push(isEnglish
          ? (unknownSignalCount + " Mystagogus card identities unknown; the complete signal scan is unavailable.")
          : (unknownSignalCount + " 张 Mystagogus 牌的身份未知，无法完成全盘信号扫描。"));
      }
    }

    // 2. Crossing pairs highlight
    var crossingPairs = [];
    var posCardMap = {};
    for (var p = 0; p < cards.length; p += 1) {
      var pc = cards[p];
      if (!pc) {
        continue;
      }
      if (!posCardMap[pc.positionNumber]) {
        posCardMap[pc.positionNumber] = pc;
      }
    }
    for (var q = 0; q < cards.length; q += 1) {
      var qc = cards[q];
      if (qc && Number.isInteger(qc.stackOn) && qc.stackOn > 0) {
        var baseCard = posCardMap[qc.stackOn];
        var baseDesc = baseCard
          ? (isEnglish ? ("<" + baseCard.cardName + ">") : ("〈" + baseCard.cardName + "〉"))
          : (isEnglish ? ("Pos " + qc.stackOn) : ("第" + qc.stackOn + "位"));
        crossingPairs.push(isEnglish
          ? ("Pos " + qc.positionNumber + " <" + qc.cardName + "> crosses Pos " + qc.stackOn + " " + baseDesc)
          : ("第" + qc.positionNumber + "位〈" + qc.cardName + "〉交叉横切第" + qc.stackOn + "位" + (baseCard ? baseDesc : "")));
      }
    }
    if (crossingPairs.length > 0) {
      summaryLines.push((isEnglish ? "Central crossing lock: " : "核心交叉锁点：") + crossingPairs.join(isEnglish ? "; " : "；") + (isEnglish ? "." : "。"));
    }

    // 3. Position-Card Displacement detection (LXXXI & Mystagogus)
    var displacements = detectDisplacements(cards, deckType, spreadId, isEnglish);
    if (displacements.length > 0) {
      summaryLines.push(isEnglish
        ? ("Position-Card Displacement triggered (" + displacements.length + " circuit link" + (displacements.length > 1 ? "s" : "") + ")—mandatory cross-position reading active!")
        : ("检测到 " + displacements.length + " 处「位置牌移位共振」短路通道——必须执行跨位并读文法！"));
    }

    return {
      topologyFamily: topo.topologyFamily,
      isFilterSpread: topo.isFilterSpread,
      summaryLines: summaryLines,
      displacements: displacements,
      readingCircuitHint: topo.readingCircuitHint
    };
  }

  function extractReadingsArray(options) {
    var opts = options && typeof options === "object" ? options : {};
    if (Array.isArray(opts.resolvedReadings) && opts.resolvedReadings.length > 0) {
      return opts.resolvedReadings.filter(Boolean);
    }
    if (Array.isArray(opts.records) && opts.records.length > 0) {
      return opts.records.filter(function (r) {
        return r && typeof r === "object" && r.layoutMode !== "freeform" && Array.isArray(r.cards) && r.cards.length > 0;
      });
    }
    return [];
  }

  function collectUserTexts(readings, messages) {
    var questionParts = [];
    var rList = Array.isArray(readings) ? readings : [];
    for (var i = 0; i < rList.length; i += 1) {
      var q = rList[i] && typeof rList[i].question === "string" ? rList[i].question.trim() : "";
      if (q) {
        questionParts.push(q);
      }
    }
    var userMsgParts = [];
    var assistantCount = 0;
    var lastRole = "";
    var mList = Array.isArray(messages) ? messages : [];
    for (var j = 0; j < mList.length; j += 1) {
      var msg = mList[j];
      if (!msg || typeof msg.content !== "string") {
        continue;
      }
      var trimmed = msg.content.trim();
      if (!trimmed) {
        continue;
      }
      if (msg.role === "user") {
        userMsgParts.push(trimmed);
        lastRole = "user";
      } else if (msg.role === "assistant") {
        assistantCount += 1;
        lastRole = "assistant";
      }
    }
    var latestUser = userMsgParts.length > 0 ? userMsgParts[userMsgParts.length - 1] : "";
    return {
      questionsText: questionParts.join("\n"),
      userMessages: userMsgParts,
      latestUserText: latestUser,
      pendingUserText: lastRole === "user" ? latestUser : "",
      allUserText: questionParts.concat(userMsgParts).join("\n"),
      validUserTurns: userMsgParts.length,
      assistantTurns: assistantCount
    };
  }

  function detectRegister(options) {
    var opts = options && typeof options === "object" ? options : {};
    var readings = extractReadingsArray(opts);
    var textBundle = collectUserTexts(readings, opts.messages);
    var combinedText = textBundle.allUserText;

    var hasEsotericText = Boolean(
      combinedText && (ESOTERIC_SIGNAL_ZH_RE.test(combinedText) || ESOTERIC_SIGNAL_EN_RE.test(combinedText))
    );
    var hasMundaneText = Boolean(
      combinedText && (MUNDANE_OVERRIDE_ZH_RE.test(combinedText) || MUNDANE_OVERRIDE_EN_RE.test(combinedText))
    );

    var hasEsotericDimensionSpread = false;
    for (var i = 0; i < readings.length; i += 1) {
      var sid = String(readings[i].spreadId || "").trim();
      if (ESOTERIC_SPREAD_IDS[sid] || HYBRID_ESOTERIC_SPREAD_IDS[sid]) {
        hasEsotericDimensionSpread = true;
        break;
      }
    }

    if (hasEsotericDimensionSpread) {
      if (hasEsotericText && !hasMundaneText) {
        return "esoteric";
      }
      return "dual";
    }

    if (hasEsotericText) {
      return hasMundaneText ? "dual" : "esoteric";
    }

    return "mundane";
  }

  function isGenericStarterOnly(text) {
    var t = String(text || "").trim();
    if (!t) {
      return true;
    }
    if (GENERIC_STARTER_ZH_RE.test(t) || GENERIC_STARTER_EN_RE.test(t)) {
      return true;
    }
    // Match all 3 built-in starter prompts (current & legacy wordings, ZH & EN) that carry no personal facts
    if (
      /牌位含义与应用内牌意/.test(t)
      || /这副牌眼下最核心的矛盾卡在哪/.test(t)
      || /先一句话交代稳固的基本盘.*重点深挖我没意识到的盲点/.test(t)
      || /跳过平淡牌位，只抓我还没意识到的盲点/.test(t)
      || /若关联了多条记录，请对比局势在时间线上的真实演变/.test(t)
      || (/核心的矛盾/.test(t) && t.length <= 42)
      || /what is the most central tension and momentum here/i.test(t)
      || /briefly anchor what is stable on the board.*dig into the blind spots/i.test(t)
      || /skip routine slots.*point out my blind spots/i.test(t)
      || /across the attached readings,\s*trace how the underlying pattern has shifted/i.test(t)
      || (/most central tension/i.test(t) && t.length <= 95)
    ) {
      return true;
    }
    return false;
  }

  function isExplicitOverviewRequest(text) {
    var t = String(text || "").trim();
    if (!t) {
      return false;
    }
    if (isGenericStarterOnly(t)) {
      return true;
    }
    if (
      /整体(?:梳理|解读|看看|分析|评估)|全盘(?:解读|梳理|看看|分析)|通盘|完整解读|从头解读|重新整体|新挂.*牌|第二张牌阵/.test(t)
      || /\b(?:overall\s+(?:reading|overview|synthesis|picture)|full\s+(?:reading|spread)|whole\s+spread|entire\s+(?:spread|reading)|walk\s+me\s+through\s+(?:this|the)\s+(?:spread|reading)|read\s+(?:this|the)\s+new\s+spread)\b/i.test(t)
    ) {
      return true;
    }
    return false;
  }

  function matchIntentFromText(probe) {
    var text = String(probe || "").trim();
    if (!text) {
      return "";
    }
    if (
      /要不要|该不该|能不能|可不可以|是否|选哪|还是选|去留|跳槽|辞职|离职|签约|买不买|分不分|留不留|值得吗|可行吗|二选一|抉择|决定/.test(text)
      || /\b(?:should\s+(?:i|we)|whether\s+(?:i|we|to)|yes\s+or\s+no|choose|choice|decide|decision|stay\s+or\s+leave|resign\w*|quit\w*|worth\s+it|take\s+the\s+(?:job|offer)|accept\s+the\s+offer|either\s+.+\s+or)\b/i.test(text)
    ) {
      return "decision";
    }
    if (
      /感情|恋爱|婚姻|伴侣|前任|复合|暧昧|喜欢|爱我|他怎么想|她怎么想|对方|夫妻|分手|冷战|合伙人|同事关系|家人|父母|朋友|人际/.test(text)
      || /\b(?:relationship|partner|ex-partner|\bex\b|marriage|dating|feelings|break\s*up|reconcil\w*|boyfriend|girlfriend|spouse|husband|wife|colleague|family|friend\w*|trust)\b/i.test(text)
    ) {
      return "relationship";
    }
    if (
      /为什么会|怎么回事|卡在|卡点|阻力|障碍|瓶颈|干扰|难题|症结|不顺|困境|困局|破局|怎么办|怎么解决|怎么补救|出问题|危机|止损|受阻|焦虑|内耗|失眠|崩了|黄了|救急|压力|丢失|找不到/.test(text)
      || /\b(?:why\s+did|stuck|blocked|obstacle\w*|resistance|bottleneck|hindrance|friction|difficult(?:y|ies)|barrier\w*|crisis|problem|fix|solve|solution|remedy|went\s+wrong|fail\w*|collaps\w*|damage|recover|overcome|struggl\w*|anxious|insomnia|lost)\b/i.test(text)
    ) {
      return "predicament";
    }
    if (
      /趋势|运势|走向|接下来|未来|什么时候|何时|哪天|时机|近期|下半年|上半年|今年|这个月|下周|季度|发展|前景|周期/.test(text)
      || /\b(?:trend|outlook|when\s+will|what\s+day|timing|next\s+few|coming\s+months|this\s+year|quarter|week\s+ahead|trajectory|unfold|future|cycle)\b/i.test(text)
    ) {
      return "trend";
    }
    return "";
  }

  function detectQuestionIntent(readings, textBundle, isFollowUp) {
    var questionsText = textBundle.questionsText;
    var latest = textBundle.latestUserText;
    var primarySpreadId = readings.length > 0 ? String(readings[0].spreadId || "").trim() : "";

    var hasConcreteQuestion = Boolean(questionsText) || (!isGenericStarterOnly(latest) && latest.length > 0);
    if (!hasConcreteQuestion && readings.length > 0) {
      return "open-snapshot";
    }

    // On follow-up turns (or whenever the latest user message carries a clear new angle),
    // prioritize the current turn's intent so earlier card.question keywords do not lock later turns!
    if (latest && !isGenericStarterOnly(latest)) {
      var latestIntent = matchIntentFromText(latest);
      if (latestIntent) {
        return latestIntent;
      }
      if (isFollowUp && questionsText) {
        var fallbackQIntent = matchIntentFromText(questionsText);
        if (fallbackQIntent) {
          return fallbackQIntent;
        }
      }
    }

    var combinedIntent = matchIntentFromText((latest + "\n" + questionsText).trim());
    if (combinedIntent) {
      return combinedIntent;
    }

    if (primarySpreadId === "yes-no") {
      return "decision";
    }
    if (primarySpreadId === "manifestation-cause" || primarySpreadId === "solution" || primarySpreadId === "direction") {
      return "predicament";
    }
    if (primarySpreadId === "timing" || primarySpreadId === "four-seasons") {
      return "trend";
    }

    return readings.length > 0 && !questionsText && isGenericStarterOnly(latest) ? "open-snapshot" : "trend";
  }

  function isDivinationTopicMessage(text) {
    if (!text) {
      return false;
    }
    return /占卜|塔罗|牌阵|解牌|抽牌|正位|逆位|大阿卡那|小阿卡那|生命之树|神秘学|奎瑞亚|LXXXI|Mystagogus|M牌|权杖|圣杯|宝剑|星币|愚者|高塔|女祭司/i.test(text)
      || /\b(?:tarot|divination|spread|layout|arcana|quareia|mystagogus|lxxxi|upright|reversed|querent|cards?)\b/i.test(text);
  }

  function buildSkillModeDirective(skillMode, isEnglish) {
    // Only the built-in persona mode remains; the persona itself carries the reading stance.
    return "";
  }

  function buildDeckCraftLines(deckMap, hasMixedTarot, isEnglish) {
    var lines = [];
    if (deckMap.tarot) {
      var revClauseZh = hasMixedTarot
        ? "当前含混抽逆位：逆位绝非背诵第二本反义词典，须作为正位根源力量在该牌位的「阻滞、延迟、向内内耗、过度用力或松绑退潮」推演（尤其留意逆位落入负面/困难牌位时的双重极性互动）。"
        : "当前为 Quareia 全正位模式：牌的阴影面由「困难/冲突/隐瞒/解开者/夺取者」等挑战牌位自然激发——好牌落凶位或剥夺位代表该优势被扣留、因执迷自满而停滞，或恰恰是要被拿走的舒适区。";
      var revClauseEn = hasMixedTarot
        ? "Mixed reversals active: never recite a separate reversed dictionary—read reversal as blocked, delayed, internalized, overdriven, or loosening flow of the upright root force within that position's polarity."
        : "Upright-only Quareia mode: shadow/blocked meanings come from challenging positions (Conflict, Withheld, Unraveller, Taker)—a 'good' card in a negative/stripping slot means that gift is withheld, stagnant from complacency, or the exact comfort being removed.";

      lines.push(isEnglish
        ? ("- **[Tarot Craft]** Weave RWS visual staging (posture, gaze, terrain) with Elemental climate × Numerical stage (1–10). Honor Quareia canonical distinctions over pop-tarot clichés: The Fool = 0/blankness/naivety (not carefree adventure); The Hanged Man = heavy ordeal, sacrifice & moral duty (not casual 'new perspective'); The Lovers = equal contract/union; Temperance = post-storm necessity & protective healing. " + revClauseEn)
        : ("- **【经典塔罗心法】** 结合 RWS 牌面视觉动作细节与「四元素冷暖 × 数字演化阶段(1-10)」解牌；严守 Quareia 原典牌义，防流行鸡汤跑偏：《愚者》= 0/空白/天真无防备（非浪漫冒险）、《倒吊人》= 沉重考验、牺牲与道德义务（非轻松换视角）、《恋人》= 对等契约结盟、《节制》= 灾后必要性调和与保护。" + revClauseZh));
    }
    if (deckMap.lxxxi) {
      lines.push(isEnglish
        ? "- **[LXXXI Magician's Deck Craft]** Diagnose manifestation stage via the Four Realms (Divine 1–4 seed/limit -> Inner 5–26 forming weave -> Physical 27–77 embodied reality -> Underworld 78–81 closure/compost). Anchor structural weight on Root Powers I–X over mild check cards (Giver of Gifts, Child), and strictly apply card-specific positional reversal/literal branches (e.g. Fellowship in negative slots = group conflict/danger; Bailiff = dues/theft or reassessing medical treatment; Idiot = No/Zero/ignoring fire warnings). Cross-read any displaced position-named card with its home slot!"
        : "- **【LXXXI 魔法牌心法】** 先看四大领域判定显化阶段（神圣1-4未成形源头/界限 → 内在5-26潜流编织 → 物质27-77现实人事落地 → 冥界78-81终结封存）；以罗马数字 I–X 十大根源力量定骨架（勿夸大《赠礼者》《孩童》等日常校验牌），并严格执行底稿标注的「落凶位反转判词与字面专向落点」（如伙伴关系落凶位转团伙冲突风险、执行官含失窃与重症重估治疗、愚者Idiot为否/无视眼前明火警告）；凡触发「位置牌移位共振」，必须将落点位与同名本位连成回路并读！");
    }
    if (deckMap.mystagogus) {
      lines.push(isEnglish
        ? "- **[Mystagogus Voice & Gate Craft]** Speak with crisp, stripped-back diagnostic clarity. Honor canonical Yes/No/Wait signals (Path/Phanos/Voice of Truth/Splendour/Chariot/Healing = Yes; Dead End/Threshold Guardians/Binder/Empty Vessel/Profane Place = hard No/Stop; Silence/Obscure Path/Sanctuary/Limiter = Wait/Not yet) and specific literal keys (Choppers = surgery/clean cut; Companions = animal is the key; Oracle = further divination needed). Distinguish West Gate (probably not—fading past that CAN return) from North Gate (hard No—dead past, never returns), and East Gate (near future) from South Gate (long-term outcome). Cross-read displaced position-named cards!"
        : "- **【Mystagogus 秘仪导师心法】** 保持清冷、直白、一针见血的诊断语感；严格采信原典内置的是/否/时机判词（道路/法诺斯/真理之声/荣光/战车/疗愈=是；死路/门槛守卫/束缚者/空容器/亵渎之地=否与止步；静默/幽暗之路/圣所[尚未]/限制者=等待勿动）与专向物象（砍伐者=断舍离或手术、同伴=动物是破局钥匙、神谕=需进一步占卜）；严分西门（大概不是·暂退仍可回潮）与北门（否·彻底死去永不回头）、东门（近未来）与南门（远期结果），并执行同名位置牌移位并读！");
    }
    return lines;
  }

  function buildIntentAndRegisterLines(intent, register, hasReadings, isFollowUp, isEnglish) {
    var lines = [];
    if (register === "mundane") {
      lines.push(isEnglish
        ? "- **[Mundane Register Lock]** Translate the 78/81-card limited symbol vocabulary ('baby booties' lateral decoding) strictly into everyday human reality—work, contracts, money, vitality, communication, practical logistics. Apply Occam's razor and calibrate scale to timeframe (a harsh card in a weekly/mundane reading means an argument, blown plan, or mechanical snag—NOT cosmic doom or curses)."
        : "- **【世俗语域与量级锁】** 运用 Quareia「有限词汇侧向解码法」，将抽象牌象翻译为直白的人间现实（工作协同、合同账目、精力作息、具体沟通与器物细节）；严格按时间窗执行奥卡姆剃刀降敏——日常/短期问题抽到高塔、死神或武士牌仅对应方案推翻、争执或突发折腾，严禁渲染灾难恐慌或玄学诅咒，严禁堆砌神学宇宙论术语。");
    } else if (register === "dual") {
      lines.push(isEnglish
        ? "- **[Dual Mundane–Esoteric Bridge Register]** This spread carries inner, ancestral, or guardian positions alongside real-life practical concerns: preserve the authentic meaning of inner/ancestral/visionary slots and bridge them soberly to everyday work, finances, relationships, and health (showing how deep patterns or energy drains project into daily life)—neither flattening inner slots into corporate clichés nor indulging in mystical fear-mongering."
        : "- **【世俗×内在双层桥接语域】** 当前牌阵含先祖/内在神殿/守护灵等深层维度，且关联现实生活议题：请完整保留内在、梦境、先祖或能量牌位的本义，将其与当事人的工作、财务、关系或身心现实做平实清醒的因果桥接（剖析深层模式或精力耗散如何投射为现实卡点），既不把深层牌位硬拗成纯职场套话，也严禁渲染玄虚恐吓或宿命迷信。");
    } else {
      lines.push(isEnglish
        ? "- **[Esoteric Register Active]** You may address inner-world contacts, threshold guardianship, ancestral currents, and spiritual discipline with sober Quareia precision—grounded, practical, zero New-Age puffery, keeping mundane health and daily balance anchored."
        : "- **【神秘学实修语域激活】** 可结合 Quareia 内在接触、门槛守卫、先祖流向与心性打磨做深层解读，但文风必须保持冷静克制与实修纪律感，忌新纪元玄虚吹捧，且始终兼顾现实生活与身心根基平衡。");
    }

    if (!hasReadings) {
      lines.push(isEnglish
        ? "- **[Methodology / Question Framing]** Help the user sharpen vague or emotionally loaded questions into clear, time-bounded, actionable inquiries, and recommend the most fitting spread in this app when appropriate."
        : "- **【占卜方法与提问校准】** 协助用户将宽泛或情绪化的问题收敛为带明确时间窗、聚焦可行动主体的有效占卜问题，并按需推荐应用内最匹配的牌阵。");
      return lines;
    }

    if (isFollowUp) {
      lines.push(isEnglish
        ? "- **[Follow-Up Keyhole Drilldown—Local Zoom in Context]** Do NOT re-narrate the entire spread already covered! Zoom into the positions relevant to the user's question, keeping their actual roles and the broader pattern in view without inventing an outcome position. If the question exceeds this spread's resolution, suggest a focused time-bounded question and a suitable secondary spread (Timing, Manifestation/Cause, Solution, Resources, or Simple Yes/No)."
        : "- **【多轮追问「开窗深挖」协议】** 切勿复述上一轮全盘综述；聚焦与追问相关的牌位，依据实际牌位职能并结合全盘关系解读，不要虚构结果位。若追问超出当前牌阵的分辨率，可建议带时间窗的聚焦问题与适合的次要牌阵（时机布局、显化/成因、解决方案、资源布局或简单是/否）。");
    }

    if (intent === "open-snapshot") {
      lines.push(isEnglish
        ? "- **[Blind Reading / No-Question Protocol]** Because no specific question was recorded, do NOT fall back into reciting generic card meanings slot-by-slot! Briefly anchor which life domains look stable, synthesize the 1–2 sharpest real-life tension portraits across the main axes, show where momentum is heading, and close with ONE brief, natural check-in question inviting the user to share what concrete situation this mirrors."
        : "- **【无特定问题「盲解破局」协议】** 当前未附具体占卜问题，**严禁因此退化为挨个牌位泛泛念牌义！** 请先用一句话点明盘面上稳固无虞的基本盘领域，再勾勒出主轴中最突出的 1～2 组现实生活张力画像与近期走向，并在结尾用 1 句自然平实的核对提问，邀请对方补充这正对应手头哪桩具体事（职场、合作、关系或搬迁筹划），以便下一轮精准对焦。");
    } else if (intent === "decision") {
      lines.push(isEnglish
        ? "- **[Decision Routing]** Say which way you lean and what would have to be true for that lean to hold; lay out the real cost and payoff of each path, but do not decide for them—hand the choice back."
        : "- **【抉择意图路由】** 开篇说清你更偏向哪一边、这个偏向成立的前提是什么，摊开不同选择各自的代价与后劲，但不替对方拍板；最后把选择权交还给他。");
    } else if (intent === "relationship") {
      lines.push(isEnglish
        ? "- **[Relationship Routing]** Unpack mutual projections, give-and-take asymmetry, and actual relational trajectory without claiming omniscient mind-reading of the other party."
        : "- **【关系意图路由】** 剖析双方各自的现实处境、投入失衡点与互动实相，聚焦提问者自身的边界与回应方式，忌替第三方做绝对化读心宣判。");
    } else if (intent === "predicament") {
      lines.push(isEnglish
        ? "- **[Predicament & Triage Routing]** Separate irreversible losses that should be cleanly released from leverage points still within reach; give clear damage-control priority."
        : "- **【困局止损路由】** 先帮当事人厘清「什么已是沉没成本必须干脆放手」与「哪里仍是可发力的活口」，给出清晰的止损与破局先后顺序。");
    } else if (intent === "trend") {
      lines.push(isEnglish
        ? "- **[Trajectory & Cycle Routing]** Map the unfolding rhythm (current footing -> friction/turning window -> outcome direction) and highlight what signs to watch."
        : "- **【趋势周期路由】** 按阶段脉络（当下立足点 → 关键阻力或转折窗口 → 顺势出口）串联叙事，标出最值得留意的现实风向标。");
    }

    return lines;
  }

  function buildAntiParrotingVoiceBlock(hasFilterSpread, isEnglish, isFollowUp) {
    if (isEnglish) {
      var enRule1 = isFollowUp
        ? "1. **Direct Follow-Up Zoom (No Macro Recap)**: Answer the user's follow-up or newly shared context in Sentence 1 by weaving ONLY the 2–4 relevant positions naturally into prose (citing card names inside sentences or parentheses as evidence)—**do NOT repeat the macro weather forecast or re-summarize the whole spread**."
        : "1. **One Line of Weather, Then Card by Card**: Open with a single plain sentence on the spread's overall temperature (cold / warm / tight / easy) - no verdict, no forecast of how it ends. Then start from the card carrying the most tension: say what the card is in the terms of the deck that drew it and what it means in that position, then land it on their situation - covering one or two cards before you stop and leave room for their reaction.";
      var enRule2 = isFollowUp
        ? "2. **Focused Micro-Depth in Context**: Explore the relevant local positions and practical actions in light of their actual roles and the wider spread; leave unrelated positions untouched."
        : "2. **Settle the Ground, Then Spend Depth on the Tightest Card or Two**: first say in one clause which domains look steady (never only report trouble), then put this turn's depth on the one or two cards that are actually tight; leave the rest for the next turn.";

      var enLines = [
        "### Narrative & Anti-Parroting Rules (Strictly Enforced; Voice and Rhythm Follow the Persona)",
        enRule1,
        enRule2,
        "3. **Six Forbidden Novice Patterns**:",
        "   - NEVER write slot-by-slot roll-calls (`Position 1 is X, representing... Position 2 is Y, indicating...`).",
        "   - NEVER copy whole scratchpad sentences verbatim or expose meta-phrases (`According to the in-app meaning`, `the keywords show`, `Read this as the active pattern shaping the situation`, `Pause, check the facts...`); DO naturally use exact position names, card names, and precise core concepts without artificial synonym drift.",
        "   - NEVER dump cosmic/theological jargon onto purely mundane work, money, or relationship questions.",
        hasFilterSpread
          ? "   - **CRITICAL FILTER RULE**: A secondary filter spread (`manifestation-cause` / `solution` / `direction` / `timing`) is attached—match slots dynamically against Position 1's actual scale and slot domain (counting domain-specific legal/illness/retreat/cutting cards and literal object matches), and set aside genuinely unrelated filler slots in one brief clause instead of inventing forced stories for every position!"
          : "   - In secondary filter spreads, set aside genuinely unrelated slots cleanly rather than forcing stories onto every slot.",
        "   - NEVER pad with fortune-cookie or therapy clichés (`opportunities and challenges coexist`, `trust the universe`, `embrace your inner self`, `practice self-love`).",
        "   - NEVER catastrophize or preach fatalism; keep tone direct, grounded, humane, and agency-preserving.",
        "4. **Plain-First & Anti-Preach Rules**:",
        "   - **Say the card logic in plain words (meaning first, situation second)**: in every paragraph, first say what the card means in the deck that drew it and what that means in its position, in everyday language, then land it on what it means for their work/money/relationship/health right now. Never open a point with abstract or mystical vocabulary.",
        "   - **No grand philosophy or life lecture**: never drift into universal maxims about fate, destiny, the universe's plan, self-cultivation, or \"human nature\"—unless the user explicitly asks. Keep every sentence tied to THIS person's concrete situation and decision.",
        "   - **Keep it short and scannable**: keep the final answer to roughly 130–220 words (expand only if the user explicitly asks for the whole reading at once, and never past 400). One short sentence per idea; write plainly and avoid piling on clauses and modifiers. Prefer a handful of tight, concrete paragraphs over an exhaustive essay. One clear idea per paragraph; cut anything that restates what you already said. This cap applies to the final answer only—your internal reasoning may run as long as needed."
      ];
      return enLines.join("\n");
    }

    var zhRule1 = isFollowUp
      ? "1. **直奔追问靶心，免除全盘复盘**：首句直接回应用户本轮追问或刚补充的现实情况，只调取关联的 2～4 个局部牌位自然嵌在句中或括号内作联动论据，**严禁重背全盘、严禁重报全局气象或复述上一轮已讲过的全盘结论**。"
      : "1. **开篇一句话点冷暖，然后逐张推进**：第一句只用一句平实的话交代盘面整体的温度（偏冷／偏暖／紧／松），不预先给定性结论、不预告结局；接着从最吃紧的那张牌开始，先按记录里那副牌组给这张牌的牌意说清它是什么、放进这个位置意味着什么，再落到他的处境上，讲完一两张就停，把反应的空间留给对方。";
    var zhRule2 = isFollowUp
      ? "2. **结合全盘微距深挖**：聚焦追问涉及的局部牌位与具体应对，结合其实际职能和全盘关系判断，无关牌位略过。"
      : "2. **先安顿基本盘，再把力气放在最吃紧的一两张牌上**：先用一句话说明盘面上相对稳固的领域（别只报忧），然后把这一轮的笔墨集中在最吃紧的一两张牌上，其余留到下一轮。";

    var zhLines = [
      "### 自然叙事与反抄书铁律（严格执行；语气与节奏仍以人格为准）",
      zhRule1,
      zhRule2,
      "3. **六大「新手念说明书」绝对禁令**：",
      "   - 【禁按号点名报菜名】严禁写出「第1位【XX】是某牌，代表……；第2位【XX】是某牌，意味着……」的流水账或编号分点。",
      "   - 【禁整句复读底稿套话，允许精准概念词】鼓励自然使用精准牌位名、牌名与核心概念术语（勿为刻意换词而扭曲牌义），仅严禁整句照抄底稿原句或出现「根据应用内牌意」「关键词显示」「这张牌在占卜中象征」等说明书元话语。",
      "   - 【禁错位堆砌神学黑话】纯世俗问题严禁扯「宇宙织机、神圣领域使命、门户之书」等玄虚辞藻。",
      hasFilterSpread
        ? "   - 【次要筛查牌阵强制降噪】当前包含筛查型牌阵（显化成因/解决方案/方位/时机）——须按第1位事件实际量级与槽位语义动态识别有效信号（含专向法律/伤病/休养切割牌及过剩致祸、字面物象匹配），真正平淡无关的槽位用一句话干净略过，**严禁1→N逐位硬编牵强故事！**"
        : "   - 【禁强行圆场】遇到次要筛查牌阵时，真正无关的平淡槽位干净略过，绝不逐位硬编理由。",
      "   - 【禁正确的废话与鸡汤说教】严禁「机遇与挑战并存」「倾听内心的声音」「宇宙提醒你爱自己、接纳不完美」等空洞套话。",
      "   - 【禁恐吓报丧与宿命论】孤立凶牌须结合全盘降敏，不替提问者做道德说教，落脚于平实、具体的人间行动选择。",
      "4. **先讲人话、后牌理；禁大道理；控制篇幅**：",
      "   - **平实地说牌理（先牌意、再处境）**：每一段先用日常的话把这张牌在记录牌组里的含义说清、说它在这个位置意味着什么，再落到「这对你当下的工作/钱/感情/身体具体意味着什么」；不堆抽象术语、不从玄学概念起头。",
      "   - **禁泛人生哲理与说教**：不得扯「命运自有安排、人生无常、宇宙自有其用意、人要学会放下执念」这类放之四海皆准的大道理，除非用户主动要求；每一句都要扣着眼前这个人的具体处境和决定。",
      "   - **短句、说人话、别长篇大论**：一句话只说一个意思，尽量口语、别堆砌修饰和连珠炮式的长串分句。最终答复正文约 200～350 字（用户明确要求「一次讲完」「直接给结论」时才展开，最多不超过 600 字）；宁可用几段紧凑、具体的短段落，也不要铺成一长篇；一段只讲一个意思，已经讲过的不要换种说法再复述一遍。推理与思考过程不受此篇幅限制，可以充分展开。"
    ];
    return zhLines.join("\n");
  }

  function routeSkills(options) {
    var opts = options && typeof options === "object" ? options : {};
    var locale = normalizeLocale(opts.locale);
    var isEnglish = locale === "en";
    var skillMode = normalizeSkillMode(opts.skillMode);
    var readings = extractReadingsArray(opts);
    var hasReadings = readings.length > 0;

    var textBundle = collectUserTexts(readings, opts.messages);
    var validUserTurns = textBundle.validUserTurns;
    var isFollowUp = Boolean(
      hasReadings
      && textBundle.assistantTurns >= 1
      && !opts.hasUninterpretedReading
      && !isExplicitOverviewRequest(textBundle.pendingUserText)
    );
    var register = detectRegister({ locale: locale, resolvedReadings: readings, messages: opts.messages });
    var intent = detectQuestionIntent(readings, textBundle, isFollowUp);

    var isDivinationChat = hasReadings || isDivinationTopicMessage(textBundle.allUserText);
    if (!isDivinationChat) {
      return {
        locale: locale,
        skillMode: skillMode,
        register: register,
        intent: intent,
        isFollowUp: false,
        hasUninterpretedReading: Boolean(opts.hasUninterpretedReading),
        validUserTurns: validUserTurns,
        hasReadings: false,
        activeSkills: [],
        promptBlock: ""
      };
    }

    var activeSkills = [];
    var sectionLines = [];

    sectionLines.push(isEnglish
      ? "## Active Quareia Reading Craft Skills"
      : "## 当前激活的内置占卜解读 Skills 协议");

    sectionLines.push(isEnglish
      ? "0. **Clarify-First Gate (highest priority — overrides everything below)**: An attached spread does NOT mean you may immediately analyze it. If the user's question still lacks key real-world grounding — for a person: who they are to the user and what stage / how long the connection has been; for work or study: the exact field, role, and how long it has been going; and the concrete situation right now — you MUST ask 1–3 short, natural, specific questions first and wait for the answer, even when an intent (relationship / decision / trend…) has already been detected. You MAY weave in one brief, natural clause of the spread's overall weather (its dominant mood, the biggest tension, or where momentum leans) so your question feels informed by the cards — but keep it to a single sentence, then pivot straight to the clarifying question; do NOT turn this into an analysis. Only after the key facts are clear may you proceed to the reading; when you do, open with one short line such as \"Alright, let's begin the reading.\" before the interpretation. This gate overrides any 'open immediately / lead with a verdict' style and the intent routing below."
      : "0. **澄清优先闸门（最高优先级，凌驾于下方所有规则）**：关联了牌阵 ≠ 可以立刻开讲。只要用户的问题还缺关键现实背景——涉及某人：这个人和你是什么关系、目前处于什么阶段／相处多久；涉及事业学业：具体是什么领域、岗位，已经进行多久；以及眼下具体处境——你就必须先追问 1～3 个简短、自然、具体的问题并等对方回答，即使已经识别出意图（关系／抉择／趋势……）也不例外。追问时可以**顺带用一句自然、平实的话点一下牌面的总览**（牌面大致冷暖、最突出的张力、或势头往哪边偏），让问题显得是从牌面里长出来的——但只限于一句，说完立刻转回追问，**不得顺势展开成解读**。关键事实坐实之后，正式开始解读：此时**先简短说一句开场语**（如「好，我们现在开始解读。」），再进入解读正文。本规则凌驾于「开门见山、立刻定论」这类话术与下方意图路由之上。");

    var modeLine = buildSkillModeDirective(skillMode, isEnglish);
    if (modeLine) {
      sectionLines.push(modeLine);
      var modeMeta = SKILL_MODES.filter(function (m) { return m.id === skillMode; })[0];
      if (modeMeta) {
        activeSkills.push({
          id: "skill-mode-" + skillMode,
          name: isEnglish ? ("Mode: " + modeMeta.labelEn) : ("模式：" + modeMeta.labelZh),
          reason: isEnglish ? modeMeta.descEn : modeMeta.descZh
        });
      }
    }

    var deckMap = {};
    var hasMixedTarot = false;
    var topologyFamilies = [];
    var seenFamilies = {};
    var hasFilterSpread = false;
    var spreadCircuits = [];

    for (var i = 0; i < readings.length; i += 1) {
      var r = readings[i];
      var dt = r.deckType === "lxxxi" || r.deckType === "mystagogus" ? r.deckType : "tarot";
      deckMap[dt] = true;
      if (dt === "tarot" && r.orientationMode === "mixed") {
        hasMixedTarot = true;
      }
      var sid = String(r.spreadId || "").trim();
      var tMeta = getSpreadTopologyMeta(sid, r, isEnglish);
      if (tMeta.isFilterSpread) {
        hasFilterSpread = true;
      }
      if (!seenFamilies[tMeta.topologyFamily]) {
        seenFamilies[tMeta.topologyFamily] = true;
        topologyFamilies.push(tMeta.topologyFamily);
      }
      var sLabel = r.spreadName || sid || ("#" + (i + 1));
      spreadCircuits.push("- **" + sLabel + "**: " + tMeta.readingCircuitHint);
    }

    if (hasReadings) {
      // 1. Gestalt & Scale Skill
      activeSkills.push({
        id: "skill-gestalt-calibrator",
        name: isEnglish ? "First-Impression & Scale Calibration" : "首印气势与量级校准",
        reason: readings.length > 1
          ? (isEnglish ? "Cross-reading momentum, power density & scale calibration across " + readings.length + " spreads" : "跨 " + readings.length + " 份占卜记录对比气势、主次权重与现实量级")
          : (isEnglish ? "Scan trump/realm density, elemental tilt & Major-cause vs. Minor-effect proportion" : "扫描大牌/四领域密度、元素偏态与主次轻重比例")
      });
      if (isFollowUp) {
        sectionLines.push(isEnglish
          ? ("- **[Spread Context for Follow-Up]** Skip macro recaps; interpret relevant positions in their actual roles and the wider spread without magnifying an isolated card." + (readings.length > 1 ? " Across multiple readings, cross-reference only relevant positions." : ""))
          : ("- **【追问的全盘背景】** 免去全局复盘，依据实际牌位职能与全盘关系解读相关局部，不孤立放大单张牌。" + (readings.length > 1 ? " 多份记录关联时只对照与本轮问题相关的牌位。" : "")));
      } else {
        sectionLines.push(isEnglish
          ? ("- **[Macro Gestalt & Proportion]** Start from the pre-computed First-Impression signals before touching individual cards. Weigh Majors/Root Powers as underlying tide (cause) and Minors/check cards as surface ripples (effect); a single harsh card surrounded by stable cards is a contained local bump, never total collapse." + (readings.length > 1 ? " Multiple readings are attached: compare how patterns shift, reinforce, or resolve across them rather than reading each in isolation." : ""))
          : ("- **【首印气势与主次权重】** 动笔前先依据盘面「首印统计信号」定全局冷暖：大牌/根源力量定底层潮汐（因），小牌/校验牌看日常浪花（果）；全盘稳健中孤立出现的一张重牌仅作局部小插曲降敏处理，严禁以偏概全。" + (readings.length > 1 ? " 当前关联了多份占卜记录：须横向打通各盘之间的演变脉络、印证关系或主次递进，切勿割裂成几份孤立报告。" : "")));
      }

      // 2. Deck Craft Skill
      var deckLabelsZh = [];
      var deckLabelsEn = [];
      if (deckMap.tarot) { deckLabelsZh.push("经典塔罗"); deckLabelsEn.push("Tarot"); }
      if (deckMap.lxxxi) { deckLabelsZh.push("LXXXI魔法牌"); deckLabelsEn.push("LXXXI"); }
      if (deckMap.mystagogus) { deckLabelsZh.push("Mystagogus"); deckLabelsEn.push("Mystagogus"); }

      activeSkills.push({
        id: "skill-deck-craft",
        name: isEnglish ? ("Deck Craft (" + deckLabelsEn.join("+") + ")") : ("牌组心法（" + deckLabelsZh.join("+") + "）"),
        reason: isEnglish
          ? "Apply deck-specific symbol grammar, realm/gate rules, and displacement circuits"
          : "加载对应牌组视觉动作、四领域/四门路标与位置牌移位共振文法"
      });
      var deckLines = buildDeckCraftLines(deckMap, hasMixedTarot, isEnglish);
      for (var d = 0; d < deckLines.length; d += 1) {
        sectionLines.push(deckLines[d]);
      }

      // 3. Spread Topology Skill
      activeSkills.push({
        id: "skill-spread-topology",
        name: isEnglish
          ? ("Spread Circuitry" + (hasFilterSpread ? " (Signal Filter)" : ""))
          : ("牌阵拓扑动线" + (hasFilterSpread ? "（筛针降噪）" : "")),
        reason: isEnglish
          ? ("Route across " + topologyFamilies.join(", ") + " axes instead of 1->N listing")
          : ("按「" + topologyFamilies.join(" / ") + "」轴线跳读取代逐位报数")
      });
      if (isFollowUp) {
        sectionLines.push(isEnglish
          ? "- **[Spread Axis Lookup (Selective Zoom Only)]** Use the structural map below ONLY to locate the 2–4 positions or polarity pairs relevant to this follow-up—**do NOT walk the whole spread again**:"
          : "- **【牌阵局部轴线索引（按需调取，禁重走全盘）】** 以下结构回路仅供定位本轮追问牵动的 2～4 个局部牌位或对偶轴，**切勿把整条动线重新串讲一遍**：");
      } else {
        sectionLines.push(isEnglish
          ? "- **[Spread Topology Circuitry]** Read along structural axes and polarity pairs below:"
          : "- **【本阵解牌拓扑动线】** 严格沿以下结构回路组织叙事，废除 1→N 顺序念牌：");
      }
      for (var sc = 0; sc < spreadCircuits.length; sc += 1) {
        sectionLines.push("  " + spreadCircuits[sc]);
      }
    }

    // 4. Intent & Register Skill
    var intentLabelsZh = {
      "open-snapshot": "无问题盲解锚定",
      "decision": "抉择取舍",
      "relationship": "关系互动",
      "predicament": "困局止损",
      "trend": "周期趋势"
    };
    var intentLabelsEn = {
      "open-snapshot": "Open Snapshot Anchoring",
      "decision": "Decision Verdict",
      "relationship": "Relational Dynamics",
      "predicament": "Predicament Triage",
      "trend": "Cycle & Trajectory"
    };
    var regLabelZh = register === "esoteric"
      ? "神秘学语域"
      : (register === "dual" ? "双层桥接语域" : "世俗语域");
    var regLabelEn = register === "esoteric"
      ? "Esoteric"
      : (register === "dual" ? "Dual-Layer" : "Mundane");

    activeSkills.push({
      id: "skill-intent-router",
      name: isEnglish
        ? ("Intent: " + (intentLabelsEn[intent] || "Contextual") + " · " + regLabelEn)
        : ("意图：" + (intentLabelsZh[intent] || "处境推演") + " · " + regLabelZh),
      reason: isEnglish
        ? "Anchor abstract symbols to concrete human scale and question type"
        : "将抽象牌象锚定至具体现实处境、时间窗与提问类型"
    });

    // 5. Follow-Up Drilldown Skill (when genuinely following up on an already-read spread)
    if (isFollowUp) {
      activeSkills.push({
        id: "skill-followup-drilldown",
        name: isEnglish ? "Follow-Up Keyhole Drilldown" : "追问开窗深挖",
        reason: isEnglish
          ? "Explore relevant positions in their wider context and suggest a secondary spread if needed"
          : "结合全盘与实际牌位职能聚焦追问，按需建议次要牌阵"
      });
    }

    var intentLines = buildIntentAndRegisterLines(intent, register, hasReadings, isFollowUp, isEnglish);
    for (var il = 0; il < intentLines.length; il += 1) {
      sectionLines.push(intentLines[il]);
    }

    // 6. Voice & Anti-Parroting Skill
    activeSkills.push({
      id: "skill-voice-antiparroting",
      name: isEnglish ? "Natural Narrative Calibration" : "反八股自然叙事校准",
      reason: isEnglish
        ? "Anchor stable baseline domains, focus priority hubs, and enforce anti-parroting rules"
        : "先归并稳固基本盘防报忧偏差，重锤敲核心枢纽并禁用逐位报菜名"
    });

    sectionLines.push("");
    sectionLines.push(buildAntiParrotingVoiceBlock(hasFilterSpread, isEnglish, isFollowUp));

    return {
      locale: locale,
      skillMode: skillMode,
      register: register,
      intent: intent,
      isFollowUp: isFollowUp,
      hasUninterpretedReading: Boolean(opts.hasUninterpretedReading),
      validUserTurns: validUserTurns,
      hasReadings: hasReadings,
      activeSkills: activeSkills,
      promptBlock: sectionLines.join("\n")
    };
  }

  var api = {
    SKILL_MODES: SKILL_MODES,
    normalizeSkillMode: normalizeSkillMode,
    detectRegister: detectRegister,
    compileCardCue: compileCardCue,
    analyzeReadingGestalt: analyzeReadingGestalt,
    routeSkills: routeSkills,
    parseCardIdentity: parseCardIdentity,
    getSpreadTopologyMeta: getSpreadTopologyMeta
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.DivinationAiSkills = api;
})(typeof window !== "undefined" ? window : globalThis);

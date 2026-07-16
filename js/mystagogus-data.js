/* Mystagogus (M 牌) deck data — Quareia / Josephine McCarthy.
 * Keywords translated from Mystagogus_Keyword.pdf for local divination UI.
 * Original English keywords © Josephine McCarthy 2022.
 */
const mystagogusSource = "参考 Josephine McCarthy《Mystagogus》关键词索引与 Quareia 体系整理";

function getMystagogusImagePath(num) {
  var n = num < 10 ? "0" + num : String(num);
  return "assets/cards/m/m-" + n + ".jpeg";
}

/** @type {Array<{id:string,number:number,name:string,nameEn:string,deck:string,uprightKeywords:string[],reversedKeywords:string[],uprightMeaning:string,reversedMeaning:string,image:string,source:string}>} */
const mystagogusDeck = [
  {
    number: 1,
    nameEn: "Progenitor",
    name: "始源者",
    uprightKeywords: ["意念成形", "神圣临在", "受孕之前", "黎明前"],
    reversedKeywords: ["灵感受阻", "盲目冲动", "尚未成形却强行启动"],
    uprightMeaning: "意念刚刚在神圣场域中成形：事情仍在「黎明之前」。它提示你留意尚未显化、却已开始的孕育力量。",
    reversedMeaning: "灵感或神圣推动被截断，或你在时机未到时硬推结果。先回到安静的孕育阶段，不要用意志强行催生。"
  },
  {
    number: 2,
    nameEn: "Fate Creation",
    name: "命运创生",
    uprightKeywords: ["全新开始", "重大转变", "创造之力", "新生与重生", "新路径"],
    reversedKeywords: ["拒绝新生", "假重启", "创造受阻", "路径摇摆"],
    uprightMeaning: "重大变化已经开启：新的命运路径、新的人生阶段或创造性力量正在成形。这是真正的开始，而非表面调整。",
    reversedMeaning: "新生的窗口被拖延，或你把换汤不换药当成重启。认清真正需要重新开始的部分，再迈出第一步。"
  },
  {
    number: 3,
    nameEn: "Fate Weavers",
    name: "命运编织者",
    uprightKeywords: ["有益影响", "命运之礼", "长期守护", "命运性事件", "织线者"],
    reversedKeywords: ["支持撤离", "误读「帮助」", "命运礼物被浪费"],
    uprightMeaning: "有长期、保护性的命运力量在托住你。它可指关键盟友、隐性支援，或会改变轨迹的命运性事件。",
    reversedMeaning: "本可托住你的线被忽视、误用，或「帮助」其实带着其他议程。分辨谁在真正编织你的前路。"
  },
  {
    number: 4,
    nameEn: "Harvester",
    name: "收割者",
    uprightKeywords: ["死亡与转变", "解放", "结束", "放手", "命运周期终了"],
    reversedKeywords: ["死抓不放", "失控毁灭", "结束被拖延"],
    uprightMeaning: "一个命运周期正在收割：结束、解放、有限时间与不得不放手。它可能残酷，却常是通往下一阶段的必经门。",
    reversedMeaning: "你抗拒必要的结束，或失控的「收割」正在摧毁本可有序放下的事物。主动完成告别，比被强行切断更少伤害。"
  },
  {
    number: 5,
    nameEn: "Awakening",
    name: "觉醒",
    uprightKeywords: ["醒来", "显现", "意识", "启示", "直面真相"],
    reversedKeywords: ["拒绝清醒", "假觉醒", "害怕真相"],
    uprightMeaning: "意识正在打开：你醒了、活过来了，并开始看见权力与真相。要求你诚实面对已经显露的内容。",
    reversedMeaning: "你选择继续沉睡，或把情绪高潮误当成觉醒。真正的清醒往往更安静、更要求责任。"
  },
  {
    number: 6,
    nameEn: "Student",
    name: "学生",
    uprightKeywords: ["学习中", "尚未成熟", "纯真", "新技能", "过程之中"],
    reversedKeywords: ["自以为什么都懂", "训练中断", "幼稚误事"],
    uprightMeaning: "你仍在训练与发展中：技能未完成、经验未满，却处在正当的学习位置。允许自己「还在过程中」。",
    reversedMeaning: "未熟却硬充专家，或中断必要训练。回到学徒心态，比假装完成更安全。"
  },
  {
    number: 7,
    nameEn: "Path",
    name: "道路",
    uprightKeywords: ["重要命运之路", "信任", "是", "正确", "向前行动"],
    reversedKeywords: ["偏航", "犹豫", "「否」", "行动受阻"],
    uprightMeaning: "这是一条重要且正确的命运路径。回答倾向「是」：信任、行动、继续向前。",
    reversedMeaning: "当前路线偏离，或你对正确道路失去信任。停下来校准方向，而不是盲目加速。"
  },
  {
    number: 8,
    nameEn: "Daimon",
    name: "守护灵",
    uprightKeywords: ["谨慎前行", "你并不孤单", "见证者", "指引", "诚实选择"],
    reversedKeywords: ["忽视警示", "假指引", "自欺选择"],
    uprightMeaning: "有见证者与向导在场——你并不孤单。要求你小心、诚实、清醒地选择，因为此刻选择具有命运重量。",
    reversedMeaning: "你无视内在或外在的警示，或把操控当指引。先恢复诚实，再做决定。"
  },
  {
    number: 9,
    nameEn: "Purification",
    name: "净化",
    uprightKeywords: ["仪式清洁", "净化", "圣化", "整理空间", "使成神圣"],
    reversedKeywords: ["污染残留", "表面清洁", "拒绝清理"],
    uprightMeaning: "需要清洁、沐浴、整理与圣化——身体、空间、仪式场域或关系。把该清的清掉，使场域重新洁净。",
    reversedMeaning: "脏污仍在，或你只做了表面打扫。真正的净化要触及动机、习惯与空间本身。"
  },
  {
    number: 10,
    nameEn: "Dreams",
    name: "梦境",
    uprightKeywords: ["做梦", "睡眠", "异象", "梦中沟通", "需要休息"],
    reversedKeywords: ["失眠", "忽视梦讯", "逃避性睡眠"],
    uprightMeaning: "梦、睡眠与异象通道正在开启。也可能单纯表示：你需要休息，并留意梦中传来的信息。",
    reversedMeaning: "休息被剥夺，或你用昏睡逃避清醒责任。重建睡眠节律，并记录梦中真正出现的内容。"
  },
  {
    number: 11,
    nameEn: "Wheel",
    name: "轮盘",
    uprightKeywords: ["变化", "成长", "抉择", "成熟", "扩展"],
    reversedKeywords: ["停滞", "抗拒成长", "错误扩张"],
    uprightMeaning: "命运之轮在转：成长、决定、移动与扩展正在发生。成熟要求你参与变化，而不是旁观。",
    reversedMeaning: "轮子卡住，或你在错误方向上扩张。先停，再确认这是成长还是逃逸。"
  },
  {
    number: 12,
    nameEn: "Perception",
    name: "感知",
    uprightKeywords: ["注意征兆", "警示", "揭开隐藏", "预知", "看见被遮蔽者"],
    reversedKeywords: ["视而不见", "误读信号", "妄想当洞察"],
    uprightMeaning: "请提高警觉：有征兆、警告或隐藏信息正在露出。你可能看见别人看不见的层——把真相看清楚。",
    reversedMeaning: "信号被忽略，或恐惧把妄想当成洞察。用可验证的事实校准你的「看见」。"
  },
  {
    number: 13,
    nameEn: "Magic",
    name: "魔法",
    uprightKeywords: ["魔法活动", "仪式场域", "高深技艺", "以技能助人"],
    reversedKeywords: ["魔法误用", "炫技", "场域被污染"],
    uprightMeaning: "魔法、仪式或高技能正在发生。也可能指向知识深厚之人，以及把技能用于造福他人的工作。",
    reversedMeaning: "技艺被用来操控或炫耀，或仪式场域不净。回到服务与纪律，而不是表演。"
  },
  {
    number: 14,
    nameEn: "Silence",
    name: "静默",
    uprightKeywords: ["保持沉默", "不要行动", "不必知道", "先想后说", "守密"],
    reversedKeywords: ["泄密", "多嘴", "不耐静默而乱动"],
    uprightMeaning: "现在适合闭嘴、停手、不追问。有些事你不需要知道；有些秘密必须守住。说话前先思考。",
    reversedMeaning: "不该说的被说出，或不该动的被推动。收回言语与行动，重建边界。"
  },
  {
    number: 15,
    nameEn: "Service",
    name: "服务",
    uprightKeywords: ["侍奉", "大工作", "团队合作", "无私", "承担责任"],
    reversedKeywords: ["自我牺牲过度", "推卸责任", "假服务"],
    uprightMeaning: "指向服务、团队、成熟与承担责任——为更大的工作献力，而不是只为自己。",
    reversedMeaning: "服务变成自我耗竭，或口头服务、实际卸责。厘清真正的责任边界。"
  },
  {
    number: 16,
    nameEn: "Healing",
    name: "疗愈",
    uprightKeywords: ["健康", "再生", "疗愈过程", "是", "稳固与完整"],
    reversedKeywords: ["疗愈中断", "症状反复", "拒绝治疗"],
    uprightMeaning: "疗愈、再生与稳固正在进行。答案倾向「是」：修复、医药、让事物重新完整。",
    reversedMeaning: "疗愈进程受阻或被忽视。回到规律的修复工作，不要期待一夜痊愈。"
  },
  {
    number: 17,
    nameEn: "Defence",
    name: "防御",
    uprightKeywords: ["保护", "守卫", "免疫反应", "检查防线", "洁净与荣誉"],
    reversedKeywords: ["防线崩溃", "过度防御", "名誉受损"],
    uprightMeaning: "需要保护、加固防线或启动「免疫」。检查谁在守护你，以及你是否仍保持洁净与荣誉。",
    reversedMeaning: "防线失效，或你把每个人都当敌人。修边界，但不要变成封闭的堡垒。"
  },
  {
    number: 18,
    nameEn: "Stargazers (Fellowship)",
    name: "观星者（团契）",
    uprightKeywords: ["团契", "奥秘", "炼金", "你不孤单", "智者指引"],
    reversedKeywords: ["孤立于群体", "伪智者", "星象迷思"],
    uprightMeaning: "神秘传统、学习共同体与智者的指引。你并不孤单；占星、炼金与高等学习可能相关。",
    reversedMeaning: "真正的团契缺失，或你追随空谈的「智者」。寻找脚踏实地的同伴与学问。"
  },
  {
    number: 19,
    nameEn: "Utterance",
    name: "言说",
    uprightKeywords: ["沟通", "圣言", "魔法书写", "诵读", "祈祷"],
    reversedKeywords: ["话语伤人", "沟通断裂", "滥用言辞"],
    uprightMeaning: "话语具有力量：沟通、祈祷、魔法书写或被触达的写作。用词要精确，因为话会成形。",
    reversedMeaning: "言辞被误用、沟通失效，或重要话语被压抑。清理表达意图后再开口。"
  },
  {
    number: 20,
    nameEn: "Creating",
    name: "创造",
    uprightKeywords: ["创作", "圣艺", "音乐戏剧", "创造性服务", "创造行为本身"],
    reversedKeywords: ["创意枯竭", "亵渎创作", "只做表演"],
    uprightMeaning: "创造行为正在发生——绘画、写作、音乐、戏剧或被圣化的艺术。创造本身即是服务。",
    reversedMeaning: "创造被阻断，或作品失去神圣意图只剩表演。回到真实的创造动机。"
  },
  {
    number: 21,
    nameEn: "Loadsharer",
    name: "负重分担者",
    uprightKeywords: ["分担重负", "照料", "托住工作", "保护他人", "促成"],
    reversedKeywords: ["独自扛全部", "越界拯救", "被压垮"],
    uprightMeaning: "有人或有力量在与你分担重负：照料、托住魔法工作、保护并促成他人。勤勉的服务在此显效。",
    reversedMeaning: "重负无人分担，或你越界替人扛不该扛的。学习托住，也学习放手。"
  },
  {
    number: 22,
    nameEn: "Dead End",
    name: "死路",
    uprightKeywords: ["无路可走", "受阻", "空", "否", "停止"],
    reversedKeywords: ["误判死路", "强行突破", "不肯止步"],
    uprightMeaning: "前方封死：停止、空、否。不要硬闯；这是明确的「到此为止」。",
    reversedMeaning: "你把暂时的坎当成永久死路，或死路当前仍要冲。重新评估，而不是用蛮力。"
  },
  {
    number: 23,
    nameEn: "Four Creatures",
    name: "四活物",
    uprightKeywords: ["天使守护", "灵性启示", "生命转折体验", "主动参与命运", "自我价值"],
    reversedKeywords: ["拒绝启示", "自我贬低", "被动等命运"],
    uprightMeaning: "深刻的灵性启示与天使级守护。要求你主动参与自己的命运，并承认自身价值。",
    reversedMeaning: "启示被忽视，或你把自己贬到不配领受。站回中心，承认你有权参与命运。"
  },
  {
    number: 24,
    nameEn: "Chariot",
    name: "战车",
    uprightKeywords: ["异象旅程", "向前行动", "界域旅行", "是", "上升"],
    reversedKeywords: ["行程受阻", "方向混乱", "强行推进"],
    uprightMeaning: "前进、旅行、上升与肯定的回应。可能是现实旅程，也可能是灵性界域间的移动。答案倾向「是」。",
    reversedMeaning: "动力在，方向乱，或推进过猛。校准载具与目的地后再出发。"
  },
  {
    number: 25,
    nameEn: "Leadership",
    name: "领导",
    uprightKeywords: ["稳定", "领导力", "正直", "责任", "挺身而出"],
    reversedKeywords: ["滥权", "逃避负责", "伪领袖"],
    uprightMeaning: "稳定、正直与负责任的领导——可能是你，也可能是你的上级。要求挺身而出并提供保护。",
    reversedMeaning: "领导失德，或该站出来的人躲在后面。权力必须重新对齐正直与责任。"
  },
  {
    number: 26,
    nameEn: "Hidden Knowledge",
    name: "隐秘知识",
    uprightKeywords: ["未见", "秘密", "潜藏潜力", "深度酝酿", "灵魂暗夜"],
    reversedKeywords: ["强行揭秘", "沉溺绝望", "否认深度"],
    uprightMeaning: "知识与潜力仍在深处酝酿：不可见、不可完全理解。可能伴随浮现前的绝望与灵魂暗夜——仍属过程。",
    reversedMeaning: "你过早撬开未成熟的秘密，或在暗夜中放弃。给深度学习留时间。"
  },
  {
    number: 27,
    nameEn: "Inner Desert",
    name: "内在荒漠",
    uprightKeywords: ["深渊", "内殿", "强力门槛", "勿再前进", "神圣审判"],
    reversedKeywords: ["无视警告", "僭越门槛", "假异象"],
    uprightMeaning: "强大的内在门槛：深渊、内殿与神圣审判。常是「到此为止」的警告——异象存在，但不宜再深入。",
    reversedMeaning: "警告被无视，危险越界正在发生。立刻后退，重建尊重与防护。"
  },
  {
    number: 28,
    nameEn: "Test",
    name: "试炼",
    uprightKeywords: ["被考验", "法则", "正直", "命运十字路口", "考试"],
    reversedKeywords: ["作弊过关", "回避考验", "正直破产"],
    uprightMeaning: "你正处在考验与命运十字路口。法律、诚实与品格被检验——把试炼当作校准，而不是惩罚。",
    reversedMeaning: "你回避必要考验，或以欺骗求过关。真正的通过只能靠正直。"
  },
  {
    number: 29,
    nameEn: "Wisdom",
    name: "智慧",
    uprightKeywords: ["简朴", "明智选择", "家园", "长远", "平安喜乐"],
    reversedKeywords: ["复杂化问题", "短视", "假平静"],
    uprightMeaning: "简朴的智慧、家园感与长远的和谐。可能指向年长者、未来的自己，或神圣庇护下的满足。",
    reversedMeaning: "智慧被复杂算计取代，或表面平静下暗流涌动。回到简单与真正的安宁。"
  },
  {
    number: 30,
    nameEn: "Phanos",
    name: "法诺斯（圣灯）",
    uprightKeywords: ["信任自己", "需要光", "火焰", "中心", "是", "圣光"],
    reversedKeywords: ["自我怀疑", "熄灯", "外求光明"],
    uprightMeaning: "内在需要光：信任自己，点燃中心之火。答案倾向「是」。圣灯在内，不在别处。",
    reversedMeaning: "内在之光被熄灭或你向外讨光。先护住自己的火焰。"
  },
  {
    number: 31,
    nameEn: "Akh",
    name: "阿赫（光明灵）",
    uprightKeywords: ["进化", "人格真相", "正道", "高意识", "开明之灵"],
    reversedKeywords: ["自命开明", "道路污染", "失去自我真相"],
    uprightMeaning: "指向洁净、平衡、进化中的光明面向：一个人的真相、正确道路与更高意识的仆人身份。",
    reversedMeaning: "「开明」变成自我形象，或道路被污染。回到清洁与真实的自我认知。"
  },
  {
    number: 32,
    nameEn: "Foundation Stone",
    name: "基石",
    uprightKeywords: ["根基", "核心", "身体与土地", "锚点", "稳定庇护"],
    reversedKeywords: ["根基动摇", "无处安身", "第一阶段未完成"],
    uprightMeaning: "基础已立：身体、土地、核心锚点与被动保护。第一阶段完成，可在稳固上继续建造。",
    reversedMeaning: "根基不稳或被掏空。先修基础，再谈扩展。"
  },
  {
    number: 33,
    nameEn: "East Gate",
    name: "东门",
    uprightKeywords: ["开始", "成形", "学习", "新潜能", "可能", "是"],
    reversedKeywords: ["开始夭折", "拒绝学习", "潜能被封"],
    uprightMeaning: "东方之门：开始、学习、扩张与发明之力。新知识与新可能打开，答案倾向「是」。",
    reversedMeaning: "开始受阻，学习窗口关闭。检查是时机未到，还是你自己关上了门。"
  },
  {
    number: 34,
    nameEn: "South Gate",
    name: "南门",
    uprightKeywords: ["南方", "未来", "火", "创造之火", "是", "积极"],
    reversedKeywords: ["火力失控", "未来焦灼", "假阳性"],
    uprightMeaning: "南方与未来之火：创造性、活跃、正向能量。整体倾向积极与「是」。",
    reversedMeaning: "火变成焦躁或破坏。收束火力，让未来热而不灼。"
  },
  {
    number: 35,
    nameEn: "West Gate",
    name: "西门",
    uprightKeywords: ["离开", "临近结束", "近过去", "放缓", "大概不是"],
    reversedKeywords: ["该走不走", "沉溺近过去", "活力耗尽却硬撑"],
    uprightMeaning: "西方：离开、收尾、极近的过去与放缓。事物可能不再可行，回答倾向「大概不是」。",
    reversedMeaning: "结束被拖延，或你用旧活力硬撑已西沉的事。允许完成与离开。"
  },
  {
    number: 36,
    nameEn: "North Gate",
    name: "北门",
    uprightKeywords: ["北方", "祖先", "古老", "冥界门槛", "过去", "否"],
    reversedKeywords: ["被过去拖住", "祖先线索被切断", "不尊重门槛"],
    uprightMeaning: "北方与祖先、古老层、墓地与冥界门槛。事已过去或应止步，答案倾向「否」。",
    reversedMeaning: "你被过去缠住，或粗暴闯入祖先/冥界领域。以尊重态度处理过去。"
  },
  {
    number: 37,
    nameEn: "Profane Place",
    name: "亵渎之地",
    uprightKeywords: ["堕落", "贪婪", "污染", "有毒", "压迫", "否"],
    reversedKeywords: ["毒性被美化", "否认污染", "同流合污"],
    uprightMeaning: "场域或关系已堕落：贪婪、污染、压迫与毒素。明确的「不好 / 否」——远离并净化。",
    reversedMeaning: "你把有毒当成正常，或身在污染中仍自我说服。先承认毒性，再撤离。"
  },
  {
    number: 38,
    nameEn: "Hearth",
    name: "炉灶",
    uprightKeywords: ["家", "家庭", "安全", "滋养", "休息", "炉灶女神"],
    reversedKeywords: ["家不再安全", "滋养匮乏", "家庭紧张"],
    uprightMeaning: "家、家人、安全与滋养——包括灵性与自然的「家」。炉灶中心需要被照料。",
    reversedMeaning: "家园失稳或滋养断裂。先重建安全与休息，再处理外务。"
  },
  {
    number: 39,
    nameEn: "Obscure Path",
    name: "幽暗之路",
    uprightKeywords: ["隐藏要素", "信任直觉", "原地踏水", "等待", "否", "保持隐蔽"],
    reversedKeywords: ["过早暴露", "瞎闯", "不耐等待"],
    uprightMeaning: "路径不明：信任直觉、暂时踩水等待、保持隐蔽。当前答案常是「否」或「还不到亮相时」。",
    reversedMeaning: "你在不该现身时暴露，或因焦虑乱闯。退回隐蔽，继续观察。"
  },
  {
    number: 40,
    nameEn: "Inner Library",
    name: "内在图书馆",
    uprightKeywords: ["深度学习", "获取知识", "连接奥秘", "向自然学习", "高等学问"],
    reversedKeywords: ["知识堆积不用", "假博学", "学习中断"],
    uprightMeaning: "深度学问与奥秘连接：图书馆、高等学习、从自然获取的智慧。认真求知的时机。",
    reversedMeaning: "学习流于收藏标签，或关键教育被中断。回到真正改变认知的阅读与实践。"
  },
  {
    number: 41,
    nameEn: "Sanctuary",
    name: "圣所",
    uprightKeywords: ["退隐", "充电", "隐身", "庇护", "尚未"],
    reversedKeywords: ["无处可躲", "过早离开庇护", "用逃避代替休整"],
    uprightMeaning: "需要撤回、充电、隐身于安全处。现在还不是出击的时候——「尚未」。",
    reversedMeaning: "庇护失效，或你把逃避当成圣所。真正的休整有期限，也有目的。"
  },
  {
    number: 42,
    nameEn: "Nature",
    name: "自然",
    uprightKeywords: ["土地之力", "自然之力", "与自然共融", "元素力量", "天然"],
    reversedKeywords: ["脱离自然", "滥用土地", "元素失衡"],
    uprightMeaning: "土地与自然元素的力量。回到野外、元素与「天然」的节奏中寻求答案。",
    reversedMeaning: "与自然失联，或对土地予取予求。重建互惠的自然关系。"
  },
  {
    number: 43,
    nameEn: "Underworld",
    name: "冥界",
    uprightKeywords: ["潜在危险", "失衡", "腐烂", "死者之域", "直面自我"],
    reversedKeywords: ["被暗处吞噬", "拒绝下降", "测试失败"],
    uprightMeaning: "冥界工作、腐烂与失衡的警示。可能危险，也可能是必须的自我直面与试炼。",
    reversedMeaning: "下降失控，或该下降时死命拒绝。带着防护与诚实进入暗处，而不是被暗处吞没。"
  },
  {
    number: 44,
    nameEn: "Sacred Place",
    name: "圣地",
    uprightKeywords: ["神圣空间", "神圣临在", "洁净平衡", "安全之地", "能量点"],
    reversedKeywords: ["圣地被渎", "误认圣地", "安全幻觉"],
    uprightMeaning: "神圣、洁净、平衡的场域或人。它是安全的特殊地点，也可能是自然力量的节点。",
    reversedMeaning: "神圣性被破坏，或你把舒适区误认为圣地。重新确认场域是否真正洁净。"
  },
  {
    number: 45,
    nameEn: "Wind Spirits",
    name: "风之灵",
    uprightKeywords: ["风暴", "自然沟通", "风", "言说", "气元素", "需要交谈或倾听"],
    reversedKeywords: ["沟通风暴", "听不进话", "天气/言辞失控"],
    uprightMeaning: "气元素与风灵：风暴、天气工作、言说与需要真正交谈或倾听。与自然意识建立工作关系。",
    reversedMeaning: "话语与气流变成风暴。先倾听，再说话；先稳定，再呼风。"
  },
  {
    number: 46,
    nameEn: "Firestorm",
    name: "火风暴",
    uprightKeywords: ["火元素", "愤怒", "发烧发炎", "失控之火", "战争", "暴烈人格"],
    reversedKeywords: ["怒火内烧", "炎症失控", "暴力升级"],
    uprightMeaning: "火已失控：怒气、炎症、战争性能量或暴烈性格。识别燃烧点，避免被火吞噬。",
    reversedMeaning: "火在暗处烧得更凶。必须降温、隔离燃料，必要时寻求外部制止。"
  },
  {
    number: 47,
    nameEn: "Water of Life",
    name: "生命之水",
    uprightKeywords: ["灵魂滋养", "神圣疗愈", "身体疗愈", "神圣之爱", "再生"],
    reversedKeywords: ["枯竭", "情感淹没", "疗愈之水被污染"],
    uprightMeaning: "滋养灵魂与身体的圣水：疗愈、再生、神圣之爱与水元素工作。允许被滋润。",
    reversedMeaning: "水太少或太脏：枯竭或淹没。净化水源，恢复真正的滋养。"
  },
  {
    number: 48,
    nameEn: "Balance",
    name: "平衡",
    uprightKeywords: ["真理", "平衡", "努力", "过程成功", "正道"],
    reversedKeywords: ["失衡", "半途而废", "伪平衡"],
    uprightMeaning: "努力之后达成平衡与解决。你走在正确的路上，过程本身已见成效。",
    reversedMeaning: "平衡破裂，或你用「差不多」假装已解决。继续校准，直到真正站稳。"
  },
  {
    number: 49,
    nameEn: "Ancient One",
    name: "古者",
    uprightKeywords: ["祖先", "土地女神", "古老", "收获劳作之果", "母系", "冥界入口"],
    reversedKeywords: ["切断母系/祖先", "拒绝成熟", "收获落空"],
    uprightMeaning: "祖先、土地女神、年长女性与母系血脉。也可能是劳作后的收获，或通往冥界的古老入口。",
    reversedMeaning: "与祖先/母系失联，或拒绝进入成熟阶段。以尊重态度重连古老线索。"
  },
  {
    number: 50,
    nameEn: "Companions",
    name: "同伴",
    uprightKeywords: ["工作伴侣生物", "照料生灵", "占兆", "关键动物", "动物是钥匙"],
    reversedKeywords: ["忽视动物信号", "伴侣关系破裂", "虐待/忽略生灵"],
    uprightMeaning: "动物、鸟类或工作伴侣生灵是关键。照料它们，或通过它们的征兆读取答案。",
    reversedMeaning: "你忽略了动物带来的钥匙。重新关注身边的生灵与征兆。"
  },
  {
    number: 51,
    nameEn: "Secret Commonwealth",
    name: "隐秘共同体",
    uprightKeywords: ["土地之灵", "仙灵", "不可预测", "勿轻易承诺", "面对不公仍守正直"],
    reversedKeywords: ["轻率承诺", "被奇异迷惑", "正直失守"],
    uprightMeaning: "土地之灵与不可预测的存在或情境。不要轻易承诺；在不公中仍保持正直。",
    reversedMeaning: "你被奇异情境拉下水，或为求便利放弃正直。收回承诺，守住底线。"
  },
  {
    number: 52,
    nameEn: "Threshold Guardians",
    name: "门槛守卫",
    uprightKeywords: ["屏障", "关闭", "否", "停止", "重新思考", "安全守卫"],
    reversedKeywords: ["硬闯守卫", "误判禁止", "安全失效"],
    uprightMeaning: "门被守卫：停止、否、重新思考。守卫可能是保护，而不是恶意——前方暂不可通。",
    reversedMeaning: "你硬闯守卫，或真正的安全屏障已塌。先搞清楚「不许进」是保护还是攻击。"
  },
  {
    number: 53,
    nameEn: "Light Bearer",
    name: "持光者",
    uprightKeywords: ["新黎明", "伟大的种子", "暗中之光", "仁慈", "潜能将显"],
    reversedKeywords: ["光被遮蔽", "潜能浪费", "虚假黎明"],
    uprightMeaning: "黑暗中的光与即将实现的伟大潜能。仁慈与新黎明的种子已在——好好护持。",
    reversedMeaning: "光被盖住，或你追逐假黎明。保护真实的种子，去掉虚荣的照明。"
  },
  {
    number: 54,
    nameEn: "Divine Servants",
    name: "神圣仆役",
    uprightKeywords: ["天使存在", "圣地", "重要命运", "魔法进化"],
    reversedKeywords: ["误认天使", "命运傲慢", "进化停滞"],
    uprightMeaning: "天使级存在、圣地与重要命运线索。魔法进化在支援你——以仆人而非主人的心态回应。",
    reversedMeaning: "神圣线索被自我膨胀扭曲。回到服务与谦卑。"
  },
  {
    number: 55,
    nameEn: "Oracle",
    name: "神谕",
    uprightKeywords: ["信息", "内在沟通", "需要进一步占卜", "书写或言说的提示"],
    reversedKeywords: ["假信息", "拒收讯息", "过度占卜"],
    uprightMeaning: "有重要信息：内在沟通、写作/言说的提示，或需要再做一轮占卜以澄清。",
    reversedMeaning: "讯息被污染，或你用不停占卜逃避行动。确认来源，然后执行已清楚的部分。"
  },
  {
    number: 56,
    nameEn: "College",
    name: "学院",
    uprightKeywords: ["学习", "异象接触", "建议", "灵性接触", "集体知识", "为师或为徒"],
    reversedKeywords: ["学阀/假导师", "拒绝学习", "接触混乱"],
    uprightMeaning: "学院式学习、导师、集体知识与灵性/异象接触。你可能在学，也可能在教。",
    reversedMeaning: "学习结构败坏，或接触变得混乱。更换场域，回到可验证的学问。"
  },
  {
    number: 57,
    nameEn: "Ghost",
    name: "幽灵",
    uprightKeywords: ["鬼魂", "残影", "几乎掏空", "最后残余", "将逝未逝"],
    reversedKeywords: ["被残影纠缠", "否认消亡", "能量被抽干"],
    uprightMeaning: "某物只剩幽灵：昔日的影子、能量将尽的残余。它几乎走了，但还没完全离开。",
    reversedMeaning: "你被本该过去的残影拖住。完成送别与清理，让残余真正落地。"
  },
  {
    number: 58,
    nameEn: "Parasite",
    name: "寄生体",
    uprightKeywords: ["寄生", "疾病", "吸血", "侵染", "不健康"],
    reversedKeywords: ["寄生加深", "否认病灶", "共依存"],
    uprightMeaning: "寄生、疾病或不健康的吸取关系。识别谁/什么在吸血，并开始清除侵染。",
    reversedMeaning: "寄生被正常化。必须更坚决地切断吸取链，必要时求医或求助。"
  },
  {
    number: 59,
    nameEn: "Choppers",
    name: "砍伐者",
    uprightKeywords: ["腐烂", "需要砍除", "断舍离", "清理", "手术", "清除枯枝"],
    reversedKeywords: ["乱砍", "该砍不砍", "清理过激"],
    uprightMeaning: "该剪的必须剪：断关系、清死枝、必要时「动手术」。腐烂部分不能留。",
    reversedMeaning: "该砍的舍不得，或不该砍的被砍掉。精准清理，而不是发泄式破坏。"
  },
  {
    number: 60,
    nameEn: "Partnership",
    name: "伙伴关系",
    uprightKeywords: ["能量连接", "契约", "关系", "联合", "友谊", "相互影响"],
    reversedKeywords: ["连接失衡", "契约破裂", "有毒联结"],
    uprightMeaning: "重要的关系、契约或能量伙伴。互动本身在塑造局势——看清连接的质量。",
    reversedMeaning: "伙伴关系失衡或破裂。重谈条件，或诚实结束不良连接。"
  },
  {
    number: 61,
    nameEn: "Separation",
    name: "分离",
    uprightKeywords: ["失去", "放手", "断裂", "结束开启新生", "离开", "向前"],
    reversedKeywords: ["纠缠不放", "错误分离", "拒绝向前"],
    uprightMeaning: "分离与放手：一个时代结束，往往为新生腾位。有时答案是「否 / 离开 / 往前走」。",
    reversedMeaning: "该分不分，或不该分却被扯断。分辨哪一种分离在服务生命。"
  },
  {
    number: 62,
    nameEn: "Limiter",
    name: "限制者",
    uprightKeywords: ["暂停", "自我限制", "外加限制", "否", "少量", "等待", "放慢"],
    reversedKeywords: ["限制过死", "拒绝一切限制", "保护变囚禁"],
    uprightMeaning: "限制在保护你：暂停、减速、只要一点点、现在不行。剑一般的边界，是为了安全。",
    reversedMeaning: "限制变成窒息，或你砸碎所有必要边界。调整剂量，而不是全有或全无。"
  },
  {
    number: 63,
    nameEn: "Endurance",
    name: "耐力",
    uprightKeywords: ["必要的艰难", "挑战", "坚持", "打磨", "转化", "纪律"],
    reversedKeywords: ["硬撑到伤", "半途放弃", "拒绝被打磨"],
    uprightMeaning: "必要的困难正在打磨你：坚持、纪律与不放弃会带来转化。这不是无意义的折磨。",
    reversedMeaning: "你要么过早放弃，要么用自毁方式硬撑。找到可持续的耐力节奏。"
  },
  {
    number: 64,
    nameEn: "Voice of Truth",
    name: "真理之声",
    uprightKeywords: ["正确", "是", "真实", "良善", "自觉", "有助"],
    reversedKeywords: ["真话被压抑", "自我欺骗", "伪善的「正确」"],
    uprightMeaning: "清晰的肯定：真实、正确、有益、平衡。听并跟随真理的声音。",
    reversedMeaning: "真理被盖过，或你用「我是对的」掩盖恐惧。回到可检验的真实。"
  },
  {
    number: 65,
    nameEn: "Gift",
    name: "礼物",
    uprightKeywords: ["礼物", "得所需", "资源", "给予与接受", "医药", "支援"],
    reversedKeywords: ["礼物附带条件", "囤积剩余", "拒绝接受帮助"],
    uprightMeaning: "你会得到所需，或你应把多余送给需要的人。支持、医药与资源正在流动。",
    reversedMeaning: "流动卡住：要么舍不得给，要么死撑不收。让礼物重新循环。"
  },
  {
    number: 66,
    nameEn: "Lightning Strike",
    name: "闪电打击",
    uprightKeywords: ["突发未见事件", "必要的破坏", "危险风暴", "需突然行动", "命运路径防护"],
    reversedKeywords: ["被雷打懵", "该闪不闪", "混乱反噬"],
    uprightMeaning: "突如其来、可能具破坏性的事件，却可能护住命运路径。需要迅速、精准的行动钉住问题。",
    reversedMeaning: "突发冲击造成瘫痪，或你对必要的雷击视而不见。站稳后再回应风暴。"
  },
  {
    number: 67,
    nameEn: "Splendour",
    name: "荣光",
    uprightKeywords: ["是", "成功", "成就", "喜悦", "美", "尊重", "和谐"],
    reversedKeywords: ["虚荣", "成功幻觉", "和谐破裂"],
    uprightMeaning: "鲜明的肯定：成功、喜悦、美与和谐。事情朝着荣光的方向展开。",
    reversedMeaning: "荣光变成炫耀，或和谐只是表象。回到真实的成就与尊重。"
  },
  {
    number: 68,
    nameEn: "True Justice",
    name: "真正义",
    uprightKeywords: ["真理", "正义", "平衡", "法则", "因果收成"],
    reversedKeywords: ["不公", "因果被否认", "报复冒充正义"],
    uprightMeaning: "真正的正义与因果：行动的结果正在收成。平衡与法则会显明。",
    reversedMeaning: "正义被扭曲为报复，或你否认自己种下的因。回到真实的平衡工作。"
  },
  {
    number: 69,
    nameEn: "Unraveller",
    name: "解开者",
    uprightKeywords: ["散开", "脱落", "松动", "缓慢崩解", "拆线"],
    reversedKeywords: ["强行拆解", "该散不散", "结构突然垮塌"],
    uprightMeaning: "事物正在慢慢拆线、松动、脱落。结构在解开——可能是释放，也可能是崩解的早期信号。",
    reversedMeaning: "拆解失控，或你死死缝住必须松开的线。有意识地参与解开过程。"
  },
  {
    number: 70,
    nameEn: "Defeat",
    name: "挫败",
    uprightKeywords: ["失败", "失去", "否", "时机不对", "暂时崩溃", "黎明前的黑暗"],
    reversedKeywords: ["把暂时当永久", "不知止境", "在谷底自毁"],
    uprightMeaning: "此刻是失败、暂停或「现在不行」。需要力量，也需要认清极限——这常是黎明前的黑暗，未必是终局。",
    reversedMeaning: "你在谷底放弃一切，或不知止息地再撞南墙。休整，保留火种。"
  },
  {
    number: 71,
    nameEn: "Voice of Untruth",
    name: "虚妄之声",
    uprightKeywords: ["谎言", "错误信息", "误导", "操控", "窥探", "欺骗", "成瘾"],
    reversedKeywords: ["谎言败露", "沉溺虚假叙事", "自我洗脑"],
    uprightMeaning: "虚假信息与操控：谎言、误导、偷窃式欺骗或成瘾性叙事。不要信表面的声音。",
    reversedMeaning: "虚妄已渗透自我叙事。停下来核对事实，切断操控源。"
  },
  {
    number: 72,
    nameEn: "Binder",
    name: "束缚者",
    uprightKeywords: ["束缚", "被绑", "囚禁", "无法行动", "否", "收缩"],
    reversedKeywords: ["挣脱过猛", "自我囚禁", "限制被滥用"],
    uprightMeaning: "被绑住、受限、移出流通：现在不能、不要、无法。收缩是当前状态。",
    reversedMeaning: "束缚不合理地加深，或你用更狠的方式把自己锁死。寻找合法的松绑路径。"
  },
  {
    number: 73,
    nameEn: "Danger",
    name: "危险",
    uprightKeywords: ["危险", "破坏潜能", "警告", "改计划", "勿冒险", "保持警觉"],
    reversedKeywords: ["麻痹大意", "已知危险仍冲", "恐慌过度"],
    uprightMeaning: "明确警告：有破坏潜能。改变计划，不冒险，留意周围正在发生的事。",
    reversedMeaning: "危险被低估或被恐慌放大。冷静评估真实风险，再决定进退。"
  },
  {
    number: 74,
    nameEn: "Fall",
    name: "坠落",
    uprightKeywords: ["被拒", "因己失位", "出局", "愚蠢导致失败", "退回起点"],
    reversedKeywords: ["否认责任", "重复愚蠢", "羞愤自毁"],
    uprightMeaning: "因自身行为导致的失位与失败：判断失误、愚蠢代价、退回起点。必须承认自己的部分。",
    reversedMeaning: "你把坠落全怪外界，或在羞愤中再犯同样错误。承担责任，才能真正重新开始。"
  },
  {
    number: 75,
    nameEn: "Serpent of Chaos",
    name: "混沌之蛇",
    uprightKeywords: ["危险", "混沌", "堕落", "邪恶", "破坏性冥界力", "魅惑", "洗脑"],
    reversedKeywords: ["已被魅惑", "混沌蔓延", "否认邪性影响"],
    uprightMeaning: "混沌与破坏性冥界力量：魅惑、洗脑、堕落。高度危险——保持清醒，不要被光鲜的混乱吸引。",
    reversedMeaning: "你已在蛇的叙事里还以为自己清醒。立刻切断魅惑源，寻求干净的见证。"
  },
  {
    number: 76,
    nameEn: "Destruction",
    name: "毁灭",
    uprightKeywords: ["丧失", "毁灭", "危险失衡", "破坏行为", "痛苦再平衡", "灾难", "让开"],
    reversedKeywords: ["加速自毁", "该毁不毁", "站在坍塌路径上"],
    uprightMeaning: "重大破坏或必要的痛苦再平衡。可能是灾难级事件——有时唯一正确动作是让开。",
    reversedMeaning: "你站在坍塌路径上还不肯动，或主动加速毁灭。撤离，再谈重建。"
  },
  {
    number: 77,
    nameEn: "Magical Death",
    name: "魔法之死",
    uprightKeywords: ["停止", "危险", "伤害他人", "泄密", "惩罚", "不智", "被毁风险"],
    reversedKeywords: ["已踏入禁区", "沉默太晚", "罪责扩大"],
    uprightMeaning: "立即停止：伤害他人、泄露秘密或不智的魔法行为会招致惩罚与毁灭风险。沉默，收手。",
    reversedMeaning: "禁线已被越过。停止一切相关行动，做损害控制，不要再赌。"
  },
  {
    number: 78,
    nameEn: "Empty Vessel",
    name: "空容器",
    uprightKeywords: ["白痴", "否", "零", "空壳", "废话", "失能", "失忆"],
    reversedKeywords: ["被空话填满", "假装有内容", "功能继续丧失"],
    uprightMeaning: "空、零、否：没有实质内容，只是空壳或胡话。不要从空容器里期待营养。",
    reversedMeaning: "你把空壳当圣杯，或自己正变成失能的空容器。停止灌输废话，重建真实功能。"
  }
];

mystagogusDeck.forEach(function (card) {
  card.id = "m-" + (card.number < 10 ? "0" + card.number : String(card.number));
  card.deck = "mystagogus";
  card.arcana = "mystagogus";
  card.image = getMystagogusImagePath(card.number);
  card.source = mystagogusSource;
});

const mystagogusDeckFull = mystagogusDeck.slice();

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    mystagogusDeck: mystagogusDeck,
    mystagogusDeckFull: mystagogusDeckFull,
    mystagogusSource: mystagogusSource,
    getMystagogusImagePath: getMystagogusImagePath
  };
}

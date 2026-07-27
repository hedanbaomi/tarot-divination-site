/*
 * English locale enrichment for the three divination decks and their spreads.
 *
 * Load after tarot-data.js, mystagogus-data.js, lxxxi-data.js, and spreads.js.
 * The source arrays and every existing card/spread/position object are mutated
 * in place so callers that already hold references continue to work.
 */
(function (root) {
  "use strict";

  var tarotCards = typeof tarotDeckFull !== "undefined" ? tarotDeckFull : root.tarotDeckFull;
  var mystagogusCards = typeof mystagogusDeckFull !== "undefined" ? mystagogusDeckFull : root.mystagogusDeckFull;
  var lxxxiCards = typeof lxxxiDeckFull !== "undefined" ? lxxxiDeckFull : root.lxxxiDeckFull;
  var tarotLayouts = typeof tarotSpreads !== "undefined" ? tarotSpreads : root.tarotSpreads;
  var mystagogusLayouts = typeof mystagogusSpreads !== "undefined" ? mystagogusSpreads : root.mystagogusSpreads;
  var lxxxiLayouts = typeof lxxxiSpreads !== "undefined" ? lxxxiSpreads : root.lxxxiSpreads;

  var FALLBACKS = [
    "LXXXI 61 Regenerator: Water, West uses a concise source-consistent fallback because the PDF has no clearly labelled Mundane Divination paragraph for that card."
  ];
  var CARD_SOURCES_EN = {
    tarot: "Based on Tarot Skills for the 21st Century and the Quareia training context",
    mystagogus: "Based on the Mystagogus Card Keyword Index by Josephine McCarthy",
    lxxxi: "Based on LXXXI—Quareia The Magician's Deck: A Guide to the Card Meanings"
  };

  function list(text) {
    return text.split("|");
  }

  function sentenceList(items) {
    if (items.length < 2) return String(items[0] || "");
    if (items.length === 2) return items[0] + " and " + items[1];
    return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
  }

  function cardMeaning(name, keywords, reversed) {
    var lead = reversed ? "Reversed, " + name + " warns of " : name + " points to ";
    var close = reversed
      ? ". Pause, check the facts, and correct the imbalance before proceeding."
      : ". Read this as the active pattern shaping the situation.";
    return lead + sentenceList(keywords.slice(0, 4).map(function (item) {
      return item.charAt(0).toLowerCase() + item.slice(1);
    })) + close;
  }

  var MAJOR_NAMES = list("The Fool|The Magician|The High Priestess|The Empress|The Emperor|The Hierophant|The Lovers|The Chariot|Strength|The Hermit|Wheel of Fortune|Justice|The Hanged Man|Death|Temperance|The Devil|The Tower|The Star|The Moon|The Sun|Judgement|The World");
  var MAJOR_UPRIGHT = [
    list("emptiness|inexperience|recklessness|self-unawareness"),
    list("control|skill|intention|planned action"),
    list("wisdom|truth|intuition|maturity"),
    list("abundance|nurture|nature|harvest"),
    list("order|authority|responsibility|boundaries"),
    list("structured belief|teaching|discipline|tradition"),
    list("agreement|partnership|union|love"),
    list("forward movement|journey|transport|necessary action"),
    list("endurance|courage|resilience|protection"),
    list("solitary wisdom|introspection|experience|maturity"),
    list("change|a turn of fate|cycles|realignment"),
    list("balance|cause and effect|judgement|law"),
    list("ordeal|sacrifice|service|moral duty"),
    list("an ending|transition|clearing|irreversibility"),
    list("necessity|moderation|healing|protection"),
    list("temptation|weakness|self-sabotage|dishonesty"),
    list("collapse|disaster|clearing|consequence"),
    list("hope after hardship|guidance|a seed|a first step"),
    list("the hidden|illusion|tides|secrecy"),
    list("success|achievement|favour|completion"),
    list("decision|culmination|resolution|accountability"),
    list("completion|fulfilment|opportunity|stability")
  ];
  var MAJOR_REVERSED = [
    list("misjudgement|blind action|ignored warnings|poor orientation"),
    list("manipulation|misused skill|narrow aims|forced control"),
    list("ignored intuition|ethical imbalance|surface judgement|inner closure"),
    list("overcontrol|emotional manipulation|smothering|excess"),
    list("tyranny|oppressive power|rigidity|failed responsibility"),
    list("dogma|narrowness|blind conformity|rejected dissent"),
    list("an unequal bond|a wrong agreement|division|betrayed choice"),
    list("loss of control|wrong direction|haste|blocked movement"),
    list("exhaustion|fragility|overstrain|a structure under pressure"),
    list("isolation|bitter experience|rejected guidance|excess withdrawal"),
    list("resisted change|a repeated loop|stagnation|poor timing"),
    list("injustice|evaded responsibility|imbalance|bias"),
    list("needless sacrifice|martyrdom|stagnation|lost boundaries"),
    list("resisted endings|delay|decay|blocked transformation"),
    list("excess|resource imbalance|weak protection|disordered rhythm"),
    list("blame projection|uncontrolled desire|denial|self-deception"),
    list("denied collapse|delayed impact|shame|structural decay"),
    list("lost direction|faint hope|refused rebuilding|obscured guidance"),
    list("deepening fog|self-deception|projected fear|uncertainty"),
    list("delayed success|a misaligned goal|low vitality|overconfidence"),
    list("an avoided call|refused responsibility|unfinished business|delay"),
    list("incompletion|a missed opening|poor integration|the last unfinished step")
  ];

  var RANK_NAMES = {
    ace: "Ace", two: "Two", three: "Three", four: "Four", five: "Five",
    six: "Six", seven: "Seven", eight: "Eight", nine: "Nine", ten: "Ten",
    page: "Page", knight: "Knight", queen: "Queen", king: "King"
  };
  var SUIT_NAMES = {
    wands: "Wands", cups: "Cups", swords: "Swords", pentacles: "Pentacles"
  };
  var MINOR = {
    wands: {
      ace: "creative beginning|inspiration|success|fire opening|delay|blocked inspiration|frustration|a fading spark",
      two: "cooperation|debate|a business dilemma|negotiation|isolation|refused cooperation|stalemate|broken communication",
      three: "good fortune|building|foundations|resources|weak foundations|scarce resources|delay|poor preparation",
      four: "friendship|happiness|gathering|community|alienation|exclusion|community strain|isolation",
      five: "disagreement|obstacles|creative solutions|competition|destructive rivalry|irreconcilable conflict|frustration|division",
      six: "victory|success after struggle|compromise|recognition|complacency|hollow honour|failed compromise|stolen victory",
      seven: "standing firm|determination|resistance|resolve|exhaustion|a breached defence|forced retreat|overwhelming odds",
      eight: "communication|speed|learning|a surge of energy|rumour|confused information|impulsive decisions|blocked communication",
      nine: "battle fatigue|adversity|warning|vigilance|exhaustion|betrayal|an unhealed wound|ignored warning",
      ten: "burden|retreat|conflict|shared load|overload|refused help|collapse under pressure|failed withdrawal",
      page: "good news|a creative student|new writing|fresh inspiration|bad news|blocked learning|creative dryness|misdirection",
      knight: "youthful energy|creative character|honesty|vitality|recklessness|unreliability|impatience|broken promises",
      queen: "teaching|thought|artistic maturity|experienced wisdom|arrogance|jealousy|controlling instruction|hardened bias",
      king: "reliability|business|teaching|experience|authoritarianism|anger|refused guidance|abused authority"
    },
    cups: {
      ace: "happiness|love|healing|a good outcome|emotional closure|rejected love|blocked healing|hollow joy",
      two: "friendship|love|communication|connection|division|misunderstanding|emotional distance|a broken bond",
      three: "achievement|joy|recognition|celebration|overindulgence|envy|empty celebration|joy turned sour",
      four: "emotional stability|contentment|appreciation|reflection|emotional numbness|taking love for granted|disinterest|fatigue",
      five: "emotional vulnerability|disappointment|grief|pessimism|despair|refused comfort|missed blessings|dwelling on loss",
      six: "gentleness|innocence|memory|nostalgia|living in the past|refused growth|idealisation|fixation on memory",
      seven: "attraction|overlooked treasure|awakening|insight|fantasy|missed value|illusion|misperception",
      eight: "emotional overload|leaving comfort|solitary searching|farewell|fear of leaving|stagnation|dependency|inability to release",
      nine: "emotional security|a good omen|satisfaction|peace|emotional emptiness|missed signs|surface calm|inner unease",
      ten: "happiness|success after hardship|lasting love|fulfilment|family strain|empty form|hollow celebration|lost meaning",
      page: "a supportive message|a new project|a child|a gentle beginning|emotional delay|a failed start|a child needing care|hesitation",
      knight: "romance|drama|artistic talent|pursuit|unreality|emotional manipulation|escapism|empty promises",
      queen: "sensitivity|love|beauty|gentleness|emotional volatility|dependency|jealousy|loss of self",
      king: "kindness|artistic nature|generosity|inclusion|emotional closure|emotional control|false kindness|hypocrisy"
    },
    swords: {
      ace: "law|an opponent|conflict|responsibility|evaded law|a hidden opponent|avoided responsibility|delay",
      two: "a peace offer|debate|writing|dialogue|refused communication|escalation|misused knowledge|failed negotiation",
      three: "separation|rupture|disillusionment|heartbreak|inability to release|deepened grief|fixation on loss|delayed healing",
      four: "illness|fatigue|withdrawal|recovery|insufficient rest|excess withdrawal|failed escape|accumulated strain",
      five: "setback|temporary defeat|regrouping|tested resolve|giving up|despair after failure|failed regrouping|self-defeat",
      six: "a journey|leaving difficulty|preserved knowledge|departure|being stuck|a delayed journey|lost knowledge|avoidance",
      seven: "avoiding disaster|strategy|timely help|caution|failed strategy|missing help|exposure|overconfidence",
      eight: "confinement|fear of action|injustice|breaking free|self-imprisonment|deepened fear|worsening injustice|surrender",
      nine: "attack|doubt|grief|mental anguish|breakdown|loss of control|overwhelm|consuming fear",
      ten: "failure|collapse|rock bottom|an ending|denial|pointless repetition|irreversibility|despair",
      page: "a hidden message|a secret opponent|covert communication|watchfulness|an exposed plot|amplified malice|discovery|duplicity",
      knight: "coldness|manipulation|hostility|danger|escalating attack|destructive conflict|irreversibility|loss of control",
      queen: "strong will|a legal mind|clear boundaries|sharp insight|cruelty|weaponised intellect|walls instead of boundaries|cold attack",
      king: "authority|law|technical command|control|abused power|unjust judgement|suppression|tyranny"
    },
    pentacles: {
      ace: "material success|financial gain|a foundation|tangible reward|a missed opening|financial loss|weak foundations|wasted resources",
      two: "money in motion|balance|exchange|adaptability|financial imbalance|uncontrolled flow|instability|broken credit",
      three: "work|career|productivity|craft|burnout|low productivity|team division|stolen work",
      four: "financial safety|caution|saving|stability|miserliness|fearful hoarding|inability to release|wealth becoming a trap",
      five: "loss|financial hardship|depleted vitality|survivable difficulty|deepening trouble|refused help|exhausted resources|ignored support",
      six: "payment|repayment|debt|fairness|unfair distribution|unpaid debt|exploitation|inadequate return",
      seven: "satisfaction|completion|a gift|harvest|delayed reward|dissatisfaction|a burdensome gift|disappointing results",
      eight: "craft|skill|prosperity|practice|poor workmanship|missed detail|weak output|neglected practice",
      nine: "abundance|resources|fertility|security|waste|dependency|coveted resources|false security",
      ten: "wealth|property|long-term resources|inheritance|family dispute|property loss|burdensome assets|a blocked legacy",
      page: "financial news|a strong child|new growth|a practical gift|delayed news|slow learning|blocked growth|a missed gift",
      knight: "diligence|gentleness|physical enjoyment|steadiness|laziness|stagnation|overcaution|missed opportunity",
      queen: "earthy nurture|home|protection|cultivation|overcontrol|emotional neglect|possessiveness|materialism",
      king: "wealth|finance|agriculture|reliability|greed|hoarding|closed thinking|missed opportunity"
    }
  };

  var RANK_FOCUS = {
    ace: "a concentrated beginning", two: "polarity and exchange",
    three: "development into action", four: "stability that can become stillness",
    five: "ordinary struggle and pressure", six: "the influence of memory and the past",
    seven: "maturation of mind and soul", eight: "an awakening event",
    nine: "consequences ripening", ten: "a cycle reaching completion",
    page: "news, study, youth, or a new project", knight: "mobile but not fully mature force",
    queen: "mature receptive influence", king: "mature responsible authority"
  };

  function enrichTarot() {
    if (!Array.isArray(tarotCards)) return;
    tarotCards.forEach(function (card) {
      var majorMatch = /^major-(\d+)$/.exec(card.id);
      if (majorMatch) {
        var index = Number(majorMatch[1]);
        card.nameEn = MAJOR_NAMES[index];
        card.uprightKeywordsEn = MAJOR_UPRIGHT[index].slice();
        card.reversedKeywordsEn = MAJOR_REVERSED[index].slice();
        card.uprightMeaningEn = cardMeaning(card.nameEn, card.uprightKeywordsEn, false);
        card.reversedMeaningEn = cardMeaning(card.nameEn, card.reversedKeywordsEn, true);
        card.sourceEn = CARD_SOURCES_EN.tarot;
        return;
      }
      var minorMatch = /^minor-(wands|cups|swords|pentacles)-(ace|two|three|four|five|six|seven|eight|nine|ten|page|knight|queen|king)$/.exec(card.id);
      if (!minorMatch) return;
      var suit = minorMatch[1];
      var rank = minorMatch[2];
      var parts = list(MINOR[suit][rank]);
      card.nameEn = RANK_NAMES[rank] + " of " + SUIT_NAMES[suit];
      card.uprightKeywordsEn = parts.slice(0, 4);
      card.reversedKeywordsEn = parts.slice(4, 8);
      card.uprightMeaningEn = cardMeaning(card.nameEn, card.uprightKeywordsEn, false) +
        " The rank adds " + RANK_FOCUS[rank] + ".";
      card.reversedMeaningEn = cardMeaning(card.nameEn, card.reversedKeywordsEn, true);
      card.sourceEn = CARD_SOURCES_EN.tarot;
    });
  }

  var MYSTAGOGUS = [
    ["Progenitor","Idea forming|Divine presence|preconception|before dawn"],["Fate Creation","New beginning|major changes ahead|creative power|birth and rebirth"],["Fate Weavers","Helpful influence|gifts of fate|upholders of your fate|protection"],["Harvester","Death|change|liberation|closing"],["Awakening","Waking up|emerging|alive|conscious"],["Student","Learning|still developing|immature|innocence"],["Path","Important fate path|trust|yes|correct"],["Daimon","Tread carefully|pay attention|you are not alone|witness"],["Purification","Ritual cleansing|purify|consecrate|bathe"],["Dreams","Dreaming|sleep|vision|dream communication"],["Wheel","Change|growth|decisions|maturing"],["Perception","Pay attention|a sign|warning|exposing hidden information"],["Magic","Magic|magical activity|a ritual site|a person of great knowledge and skill"],["Silence","Be silent|do not act|you do not need to know|do not ask"],["Service","Serving|the Great Work|teamwork|helping"],["Healing","Health|regeneration|healing process|yes"],["Defence","Protection|guardian|immune response|check your defences"],["Stargazers (Fellowship)","Fellowship|the Mysteries|the Path of Gold|alchemy"],["Utterance","Communication|use of words|sacred utterance|magical writing or recitation"],["Creating","Creating|painting|writing|sacred art"],["Loadsharer","Sharing a burden|upholding others|caretaking|holding a magical working"],["Dead End","No way ahead|blocked|dead end|empty"],["Four Creatures","Angelic protection|evolving|spiritual revelation|profound life-changing spiritual experience"],["Chariot","Visionary journey|evolution|forward action|travel between realms"],["Leadership","Stability|leadership|integrity|responsibility"],["Hidden Knowledge","Unseen|secret|hidden|beyond understanding"],["Inner Desert","Abyss|Inner Desert|inner temples|powerful threshold"],["Test","Being tested|law|integrity|truthfulness"],["Wisdom","Simplicity|wisdom|evolving|wise choice"],["Phanos","Trust in yourself|light is needed|a flame|the centre"],["Akh","Evolved|evolving|bright|truth of a person"],["Foundation Stone","Foundation|core|body|land"],["East Gate","Beginnings|formation|newness|learning"],["South Gate","South|future|fire|creative fire"],["West Gate","Leaving|coming to an end|very recent past|slowing down"],["North Gate","North|ancestors|ancient|burial ground"],["Profane Place","Degenerate|greed|pollution|toxic"],["Hearth","Home|family|safety|nourishment"],["Obscure Path","Hidden element|trust your instincts|tread water|wait"],["Inner Library","Deep learning|acquiring knowledge|connecting to the Mysteries|learning from nature"],["Sanctuary","Withdraw|need to recharge|go invisible|seek shelter"],["Nature","Land power|nature power|commune with nature|natural elemental force"],["Underworld","Potential danger|imbalance|rot|darkness"],["Sacred Place","Holy place|sacred space|Divine presence|clean"],["Wind Spirits","Storm|nature communication|wind|utterance"],["Firestorm","Fire|anger|fever|inflammation"],["Water of Life","Soul nourishment|sacred healing|physical healing|Divine love"],["Balance","Truth|balance|effort|process"],["Ancient One","Ancestor|goddess of the land|ancient|burial mound"],["Companions","Working creature companion|care for creatures|augury|an important animal or bird"],["Secret Commonwealth","Land being|faery|nature spirit|unpredictability"],["Threshold Guardians","Barrier|closed|no|stop"],["Light Bearer","A new dawn|the seed of greatness|a light in the darkness|kindness"],["Divine Servants","Angelic being|sacred place|important destiny|magical evolution"],["Oracle","A message|inner communication|further divination|a prompt to write or speak"],["College","Learning|vision contact|advice|spirit contact"],["Ghost","Ghost|apparition|presence|a remnant of the past"],["Parasite","Parasite|illness or disease|vampire|infestation"],["Choppers","Rotting|breaking down|needs cutting back|cutting ties"],["Partnership","Energy connection|contract|relationship|union"],["Separation","Loss|separation|letting go|a break"],["Limiter","Pause|self-limitation|imposed limitation|no"],["Endurance","Necessary difficulty|challenge|endurance|strengthening"],["Voice of Truth","Right|yes|truthful|good"],["Gift","A gift|getting what you need|resources|giving where needed"],["Lightning Strike","Sudden unseen event|necessary destruction|dangerous storm|something needs pinning"],["Splendour","Yes|success|achievement|joy"],["True Justice","Truth|justice|balance|harmony"],["Unraveller","Falling apart|falling away|loosening|breaking up slowly"],["Defeat","Failure|loss|no|not now"],["Voice of Untruth","Lies|misinformation|misdirection|manipulation"],["Binder","Restriction|bound up|restrained|imprisoned"],["Danger","Danger|destructive potential|warning|change plans"],["Fall","Rejection|loss of status through one's actions|outcast|failure through foolishness"],["Serpent of Chaos","Danger|chaos|degeneration|evil"],["Destruction","Loss|destruction|dangerous imbalance|destructive behaviour"],["Magical Death","Stop|danger|harming others|exposing a secret"],["Empty Vessel","Idiot|no|zero|nothing"]
  ];

  var LXXXI = [
    ["The Star Father","new potential|the first step|an idea|a new direction"],["The Creator of Time","incubation|boundaries forming|a new fate line|more time"],["The Holder of Light","return to source|hibernation|deep withdrawal|completion"],["The Archon and the Aion","a dangerous limit|wait|a protective barrier|pause and watch"],["The Abyss","destructive potential|rock bottom|pain out of control|change course"],["The Keeper of the Abyss","fate protection|timely restraint|being held back|protection from error"],["The Light Bearer","a new path|trailblazing|forward movement|guidance through darkness"],["The Imprisoner","restriction|being withheld|imprisonment|something stopped"],["Pure Balance","balance restored|harmony|success|responsibility"],["The Grindstone","intense work|learning through hardship|discipline|endurance"],["The Unraveller","loss of control|loosening restrictions|unravelling|early decay"],["Threshold Guardian","energy flow|ideas|creativity|new life"],["The Protector of Souls","safety|shelter|rest|regeneration"],["The Weaver of Creation","creative power|a new project|conception|a forming path"],["Hidden Knowledge","an unknown element|what is unseen|trust|deep inner knowledge"],["The Inner Temple","deep inner dynamics|intuition|greater guidance|Divine oversight"],["The Inner Librarian","an honest guide|learning|formal study|new skills"],["The Inner Companion","you are not alone|guidance|watchful protection|companionship"],["Guardians of the Inner Desert","a necessary block|a dangerous threshold|do not force passage|protection"],["The Utterer","important news|teaching|writing|conveying information"],["Keeper of Justice","balance|restored equilibrium|law|justice"],["Chariot","an important journey|transport|movement|a turn of fate"],["Wheel of Fate","change|a new path|a new life phase|fate turning"],["Fate Giver","a new cycle|a new direction|major change|a new life phase"],["Fate Holder","a cycle in progress|things held in place|stability|right timing"],["Fate Taker","an ending|completion|clearing away|space for the new"],["Mother Earth","success|completion|land|the right place"],["Sol","success|energy|heat|visible achievement"],["Luna","a hidden element|an incomplete picture|foggy thought|deception"],["Place of Healing","mental healing|physical healing|recovery|the worst has passed"],["Inspiration","coolness|water|inspiration|healthy creativity"],["Temple of Ancestors","traditional skills|old wisdom|ancestral help|an ancient institution"],["Magical Temple","an organised structure|specialist skill|institutional influence|training"],["River of Dreams","dreams|sleep|meditation|deep creativity"],["Gate of the Past","moving into the past|past influence|conclusion|letting go"],["Home and Hearth","home|family|domestic life|belonging"],["Path of Hercules","an opening path|the way cleared|new potential|light ahead"],["Challenge of the Gods","adversity|a good conclusion|struggle before success|strength gained"],["Inner Sanctum","turn inward|stillness|rest|a safe place"],["Resources","money|food|energy|available help"],["Spirit Guide","a guide is active|guardian advice|dream guidance|watchful help"],["Goblin Queen","hidden power|complex skill|fierce protection|independence"],["Faerie King","unreliability|trouble|instability|unease"],["Blood Ancestor","inheritance|skills|genetics|ancestral dynamics"],["Ghost","a hidden person|shadow influence|a haunting|things not as they seem"],["Parasite","drain|exploitation|unhealthy attachment|a health warning"],["Premonition","warning|an approaching problem|second sight|preventive action"],["Glamour","being fooled|self-deception|distraction|hidden reality"],["Temptation","weakness|a poor decision|emotional vulnerability|energetic vulnerability"],["Scapegoat","shifted blame|carrying a burden|relieving others|context matters"],["Disease","sickness|a health warning|rest|recovery needs"],["Magical Attack","hostility|heated conflict|attack|defensive action"],["Giver of Gifts","receiving what is needed|resources|property|medicine"],["Bailiff","paying dues|fines|necessary loss|unavoidable cost"],["Wise Teacher","an older teacher|age-earned wisdom|an elder|guidance"],["Fellowship","quiet support|friends|family|like-minded allies"],["Communication","letters|calls|important communication|study"],["Seclusion","withdrawal|healing|solitude|introspection"],["Limiter: Air, East","limitation|suppression|withholding|slowing down"],["Staff of the Gods: Fire, South","strong fire power|fate activated|firm action|an opening future"],["Regenerator: Water, West","healing flow|restoration|water|regeneration"],["Foundation: Earth, North","a long-term beginning|foundation|roots|stable ground"],["Hierophant","religious leader|senior teacher|professor|spiritual authority"],["Union","partnership|union|marriage|agreement"],["Child","a child|youthful energy|new potential|a new project"],["Elder","an elder|age|wisdom|wear and tear"],["Idiot","foolishness|emptiness|nothing of consequence|a needless question"],["Occultist","manipulation|immature authority|power games|control"],["The Leader","responsible authority|guidance|help|resources"],["The Man of Nature","closeness to nature|land work|animals|natural connection"],["The Mystic","thoughtfulness|introversion|withdrawal|searching for meaning"],["Male Warrior","fiery illness|heated argument|riot|destructive anger"],["The Oracle","a psychic person|an important message|intuition|listen"],["Priestess Magician","powerful feminine qualities|strong will|leadership|balanced expression"],["Female Warrior","necessary struggle|fighting illness|resisting injustice|defending others"],["Healer","a healing process|protection|love|regeneration"],["Shamaness","wild nature|independence|natural surroundings|integrated power"],["Underworld Forest","unhealthy influence|old imbalance|hidden agenda|painful processing"],["Bridge of Death","a permanent ending|a reversible threshold|withdraw or continue|closure"],["Death","an ending|a full stop|winter|irreversible completion"],["Destruction","a difficult ending|pain|destructive events|serious illness"]
  ];
  var LXXXI_MEANINGS = {
    "lxxxi-01": "A new but not yet formed possibility is beginning to appear: an idea, first step, or change of direction.",
    "lxxxi-02": "A new cycle is incubating as its boundaries and fate line take shape; more time may be available.",
    "lxxxi-03": "Something completed is withdrawing toward its source, entering rest, concealment, or deep hibernation.",
    "lxxxi-04": "A protective limit has been reached. Wait, observe, and do not force the temporary barrier ahead.",
    "lxxxi-05": "Destructive potential could escape control, including pain or illness; at rock bottom, seek a safer future path.",
    "lxxxi-06": "Progress is being held back at the wrong time in order to protect the subject's fate.",
    "lxxxi-07": "A new route is being prepared and energised, bringing trailblazing movement and guidance through uncertainty.",
    "lxxxi-08": "Restriction, suppression, or confinement stops something from happening or removes it from circulation.",
    "lxxxi-09": "Harmony and success are returning through balance, together with responsibility for maintaining it.",
    "lxxxi-10": "An unavoidable period of work, learning, or hardship develops focus, strength, discipline, and endurance.",
    "lxxxi-11": "Control or discipline is loosening; a knotted situation may open, or decay and dissolution may be beginning.",
    "lxxxi-12": "Energy, ideas, creativity, and sometimes new life are flowing from the inner world into expression.",
    "lxxxi-13": "Safety, shelter, rest, and regeneration are available under a protective and nurturing influence.",
    "lxxxi-14": "Creative power is laying the ground for a project, conception, pregnancy, or a new life path.",
    "lxxxi-15": "An essential element remains unseen; trust carefully while deeper knowledge is still hidden within.",
    "lxxxi-16": "Deep inner dynamics guide the outer situation through intuition, inner contact, or a power greater than the self.",
    "lxxxi-17": "A trustworthy guide or teacher opens a period of formal study, practical learning, or new skills.",
    "lxxxi-18": "You are not alone: a greater power is watching, accompanying, and guiding the situation.",
    "lxxxi-19": "The road is blocked for good reason because what lies beyond the present threshold is unsafe.",
    "lxxxi-20": "Important news, teaching, writing, speech, or another act of conveying significant information is approaching.",
    "lxxxi-21": "Equilibrium is being restored, or law, courts, and the impartial working of justice are involved.",
    "lxxxi-22": "An important journey, vehicle, or movement connected with a turn of fate is indicated.",
    "lxxxi-23": "Change is coming for good or ill, opening a new road and a new phase of life.",
    "lxxxi-24": "A major new cycle, direction, or phase of life has been triggered and is beginning.",
    "lxxxi-25": "A cycle is already in progress and is being held securely in place; timing is working as it should.",
    "lxxxi-26": "Something reaches completion and ends, clearing space so that a new cycle can begin.",
    "lxxxi-27": "This is a sign of success or completion and may also identify the right land, home, or physical place.",
    "lxxxi-28": "Success, heat, vitality, growth, and a visible reserve of energy illuminate the matter.",
    "lxxxi-29": "The full picture is obscured by an undeveloped factor, confusion, drama, concealment, or dishonesty.",
    "lxxxi-30": "Mental or physical healing is underway; the worst may have passed and recovery now needs a protected space.",
    "lxxxi-31": "A cool, life-giving flow supports inspiration, creativity, bodily fluids, health, and regeneration.",
    "lxxxi-32": "Traditional skills, old wisdom, and family ancestors are active, protective, or trying to help.",
    "lxxxi-33": "An organised body of specialised skill, training, government, medicine, religion, or magic influences the subject.",
    "lxxxi-34": "Dreams, sleep, meditation, and deep creativity carry messages that deserve sustained attention.",
    "lxxxi-35": "Something is passing into the past, while an earlier event may still shape the present and future.",
    "lxxxi-36": "Home, family, domestic responsibility, or the place where one truly belongs is central.",
    "lxxxi-37": "A path has opened and been cleared, revealing new potential and a direct way forward.",
    "lxxxi-38": "Adversity lies ahead, but the struggle can strengthen you and lead to a constructive conclusion.",
    "lxxxi-39": "Turn inward, become still, rest, or withdraw to a private and genuinely safe place.",
    "lxxxi-40": "Money, food, energy, or another necessary resource is available, though its position may warn of scarcity.",
    "lxxxi-41": "A guide or guardian is active through advice, dreams, a departed loved one, or a spirit of place.",
    "lxxxi-42": "A complex and underestimated woman or feminine power will fiercely defend what she values.",
    "lxxxi-43": "An unreliable or disruptive person may bring trouble, unease, or mental and physical imbalance.",
    "lxxxi-44": "Inherited behaviour, ability, ancestry, or genetics is shaping the present situation.",
    "lxxxi-45": "Someone is not what they seem, a hidden person acts from the shadows, or a literal haunting is present.",
    "lxxxi-46": "A person, place, illness, or attachment is draining energy and taking more than it gives.",
    "lxxxi-47": "An unpleasant event or illness is on the horizon and should be identified early enough to prevent or limit it.",
    "lxxxi-48": "Appearance has displaced reality: someone is deceiving you, or self-deception is diverting attention from what matters.",
    "lxxxi-49": "A weakness in the person or situation is exposed through emotion, health, energy, or a poor decision.",
    "lxxxi-50": "Blame or burden may be shifted onto someone, though the same image can show willingly carrying weight for others.",
    "lxxxi-51": "A period of sickness may be present or approaching; reduce strain and give the body time to heal.",
    "lxxxi-52": "Hostility, heated argument, or physical, emotional, or energetic attack requires careful defensive assessment.",
    "lxxxi-53": "Something genuinely needed is being given or received, such as food, money, property, support, or medicine.",
    "lxxxi-54": "Dues, fines, or another necessary and unavoidable loss must be paid.",
    "lxxxi-55": "An older teacher, elder, or the practical wisdom of age offers guidance.",
    "lxxxi-56": "Friends, family, companions, or a like-minded group are quietly supporting and watching over you.",
    "lxxxi-57": "A letter, call, lesson, written record, or other important communication needs full attention.",
    "lxxxi-58": "Withdrawal, solitude, healing, and introspection are needed before re-entering ordinary activity.",
    "lxxxi-59": "Something is limited, suppressed, withheld, or slowed, either protectively or more than is necessary.",
    "lxxxi-60": "A strong current of fire activates fate and calls for firm, calm action toward an opening future.",
    "lxxxi-61": "The restorative water current supports healing, emotional renewal, replenishment, and regeneration.",
    "lxxxi-62": "A lasting project or structure begins from stable ground, strong roots, and a dependable foundation.",
    "lxxxi-63": "A senior teacher, professor, religious leader, or comparable spiritual authority is involved.",
    "lxxxi-64": "Partnership, marriage, agreement, contract, or another binding union is central.",
    "lxxxi-65": "A literal child, youthful energy, or a young project holds potential that still needs nurture.",
    "lxxxi-66": "An older person, old soul, age-earned wisdom, or the physical wear of age affects the matter.",
    "lxxxi-67": "The question or path may be foolish, empty, unnecessary, or without meaningful consequence.",
    "lxxxi-68": "Immature authority, manipulation, passive aggression, or a desire to control is operating behind the situation.",
    "lxxxi-69": "Responsible authority can provide wise guidance, practical help, and resources when leadership is expressed maturely.",
    "lxxxi-70": "A person close to land or animals is involved, or a deeper and less romanticised bond with nature is needed.",
    "lxxxi-71": "A thoughtful, introverted person or period of withdrawal seeks meaning beyond the noise of daily life.",
    "lxxxi-72": "Fiery illness, a heated dispute, riot, or destructive anger is close to being unleashed.",
    "lxxxi-73": "A psychic person or inner contact brings a message that must be heard and correctly understood.",
    "lxxxi-74": "Strong feminine power or leadership needs expression, but must remain balanced rather than controlling.",
    "lxxxi-75": "The time has come to fight illness or injustice, defend the vulnerable, or express disciplined protective force.",
    "lxxxi-76": "A healing process is beginning, bringing protection, love, regeneration, and wiser emotional direction.",
    "lxxxi-77": "A fiercely independent nature-connected woman or integrated wild power follows natural law rather than convention.",
    "lxxxi-78": "An unhealthy influence, old imbalance, hidden agenda, infection, or unresolved pain is resurfacing for processing.",
    "lxxxi-79": "Continuing the present course may permanently end something; this threshold still allows withdrawal from destruction.",
    "lxxxi-80": "A final ending or full stop has arrived, comparable to winter or an irreversible completion.",
    "lxxxi-81": "A difficult energy may end the situation through pain, serious illness, or a destructive event that demands context."
  };

  function enrichOriginalDeck(deck, records, idPrefix, sourceEn, meaningsById) {
    if (!Array.isArray(deck)) return;
    deck.forEach(function (card) {
      var match = new RegExp("^" + idPrefix + "(\\d+)$").exec(card.id);
      var record = match ? records[Number(match[1]) - 1] : null;
      if (!record) return;
      var keywords = list(record[1]);
      card.nameEn = record[0];
      card.uprightKeywordsEn = keywords.slice();
      card.uprightMeaningEn = meaningsById && meaningsById[card.id]
        ? meaningsById[card.id]
        : cardMeaning(card.nameEn, keywords, false);
      card.sourceEn = sourceEn;
    });
  }

  var SPREAD_EN = {
    "three-card-horizontal": ["Three Cards (Horizontal)","Quick Spread","Read past, present, and future from left to right.","Site-added spread"],
    "four-seasons": ["Four Seasons Spread","Seasonal Spread","A quarterly reading with positions restricted to Wands, Cups, Swords, Pentacles, and Major Arcana.","User-provided Four Seasons reference diagram"],
    "yes-no": ["Simple Yes / No Layout","Mundane Layout","Answers a focused question while showing how the answer develops.","Tarot Skills for the 21st Century, Chapter 6"],
    "tree-of-life": ["Tree of Life Layout","Mundane / Mystical Layout","Follows the Tree of Life pattern to show how an answer comes into being.","Tarot Skills for the 21st Century, Chapter 6"],
    "overview": ["Overview Layout","Mundane Layout","Surveys thirteen areas of life across a chosen period.","Tarot Skills for the 21st Century, Chapter 6"],
    "event": ["Event Layout","Mundane Layout","Explores how a specific event or proposed action is likely to unfold.","Tarot Skills for the 21st Century, Chapter 6"],
    "direction": ["Direction / Location Layout","Mundane Layout","Uses compass directions to locate something or narrow a search.","Tarot Skills for the 21st Century, Chapter 6"],
    "resources": ["Resources Layout","Mundane Layout","Examines surplus, shortage, and balance across inner and outer resources.","Tarot Skills for the 21st Century, Chapter 6"],
    "timing": ["Timing Layout","Minor Layout","Tracks activity across eight equal units of time.","Tarot Skills for the 21st Century, Chapter 6"],
    "manifestation-cause": ["Manifestation / Cause Layout","Minor Layout","Tests how a difficult event may manifest and what may cause it.","Tarot Skills for the 21st Century, Chapter 6"],
    "solution": ["Solution Layout","Minor Layout","Compares possible routes toward success, stability, or healing.","Tarot Skills for the 21st Century, Chapter 6"],
    "health": ["Health Layout","Specialist Layout","Maps health-related energies, body systems, emotions, and near-term trends; it is not medical advice.","Tarot Skills for the 21st Century, Chapter 6"],
    "fate-pattern": ["Fate Pattern Layout","Mystical Layout","Shows the current fate path, active dynamics, and highest potential.","Tarot Skills for the 21st Century, Chapter 6"],
    "angel": ["Angel Layout","Mystical Layout","Explores magical development, surrounding powers, and guidance from the personal guardian.","Tarot Skills for the 21st Century, Chapter 6"],
    "landscape": ["Landscape Layout","Mundane / Mystical Layout","Connects past, present, future, and inner-world influences with daily life.","Tarot Skills for the 21st Century, Chapter 6"],
    "self-map": ["Self Map Layout","Mystical Layout","Maps a person or system across mundane, magical, and soul levels.","Tarot Skills for the 21st Century, Chapter 6"],
    "mystagogus-layout": ["The Mystagogus Layout","Mystagogus Layout","Reads the complete active story from origin and endurance through advice, danger, and future.","The Mystagogus Layout, Josephine McCarthy"],
    "lxxxi-occult-map": ["Foundation / Mystical Map Layout","LXXXI Layout","Maps foundations, active powers, resources, inner contacts, and the path ahead.","LXXXI—Quareia The Magician's Deck, Layouts"],
    "lxxxi-tree-of-life-occult": ["Tree of Life Layout (Mystical Method)","LXXXI Layout","Uses the deeper Tree of Life method to trace how a situation forms.","LXXXI—Quareia The Magician's Deck, Layouts"],
    "lxxxi-tree-of-life-simple": ["Tree of Life Layout (Simple Method)","LXXXI Layout","Uses the simpler Tree of Life method for a direct ten-position reading.","LXXXI—Quareia The Magician's Deck, Layouts"],
    "lxxxi-four-directions": ["Four Directions Layout","LXXXI Layout","Reads the centre and four directional powers around a subject.","LXXXI—Quareia The Magician's Deck, Layouts"]
  };

  var POSITION_MEANING_EN = {
    "three-card-horizontal": [
      "Past events and influences that shape the present question.",
      "The question's current state and central issue.",
      "The most likely future if the present trend continues."
    ],
    "four-seasons": [
      "How action, desire, and personal energy will be expressed.",
      "The emotional climate of the coming quarter.",
      "Thought, reason, judgement, and relationships during the quarter.",
      "Work, material conditions, daily life, and health during the quarter.",
      "The quarter's central energy, spiritual lesson, and main point of attention."
    ],
    "yes-no": [
      "The substance of the question being asked.",
      "The experiences that led to the present situation.",
      "The difficulty that must be overcome.",
      "The help or support available to you.",
      "What follows from the answer.",
      "The direct answer to the focused question."
    ],
    "tree-of-life": [
      "The central theme of the unfolding story.",
      "The active or giving influence helping to build the story.",
      "Hidden or past factors influencing the story.",
      "The conditions needed for the story to develop.",
      "What is being withheld or taken away.",
      "The key or core element of the story.",
      "The discipline or restriction required for success, with an emotional influence.",
      "What must relax so events can flow, with a mental influence.",
      "The cause or driving force behind the answer.",
      "The answer produced by the whole pattern."
    ],
    "overview": [
      "Home, close community, bloodline, and the starting point of identity.",
      "Love, close friendship, and important partnerships.",
      "Children, art, design, or anything you create and love.",
      "The fate cycle currently active in your life.",
      "Overall health during the chosen reading period.",
      "Help, resources, support, or protection supplied by fate.",
      "Personal, interpersonal, situational, or self-created interference.",
      "Hostility, danger, or threat that has not yet been seen.",
      "Adversity that must be faced to gain strength or wisdom.",
      "Available resources such as income, energy, or food.",
      "A weakness or attachment that should be recognised and willingly released.",
      "What fate will remove in order to move you forward.",
      "The overall near future and direction of development during the reading period."
    ],
    "event": [
      "The situation as it currently stands.",
      "A past factor influencing the present situation.",
      "What triggered the present situation.",
      "The benefit the situation brings.",
      "What the situation takes away.",
      "How the situation is likely to unfold.",
      "The situation's conclusion."
    ],
    "direction": [
      "The centre of the search area.",
      "The eastern part of the search area.",
      "The southern part of the search area.",
      "The western part of the search area.",
      "The northern part of the search area."
    ],
    "resources": [
      "The overall state of your energy resources.",
      "How well your energy resources are being balanced and managed.",
      "Your overall vitality.",
      "Emotional stability and loving relationships.",
      "Financial and material resources, including property.",
      "The condition of physical health.",
      "Creative energy, including the possibility of pregnancy.",
      "Energy for giving and receiving clear communication.",
      "Access to intuition, dreams, and the inner warning system.",
      "Energy for seeing ahead clearly through cards, runes, or other divination.",
      "Energy available for studying magic or exploring the Mysteries."
    ],
    "timing": [
      "The first time unit, beginning on the day of the reading.",
      "The second time unit.",
      "The third time unit.",
      "The fourth time unit.",
      "The fifth time unit.",
      "The sixth time unit.",
      "The seventh time unit.",
      "The eighth time unit."
    ],
    "manifestation-cause": [
      "The event being investigated.",
      "A natural cause such as weather, a landslide, or an earthquake.",
      "An accidental cause.",
      "A cause involving income, debt, savings, or property.",
      "Illness or bodily injury as a cause.",
      "A problem caused by one's own actions.",
      "An emotional or psychological cause.",
      "A problem caused by a relationship.",
      "An attack such as physical or emotional abuse, theft, or fraud.",
      "Courts, legal affairs, justice, or retaliation."
    ],
    "solution": [
      "The event or problem that needs a solution.",
      "Allowing fate and time to unfold the solution.",
      "An inspired or unplanned action that triggers the solution.",
      "Money or material resources as the solution.",
      "Improved health as the solution.",
      "Taking responsibility for your own actions.",
      "Negotiating or acting calmly, impartially, and without emotional heat.",
      "Kindness, understanding, and compassion as the solution.",
      "Standing your ground, holding your convictions, and refusing to give up.",
      "Repaying debt, passing wealth onward, or returning what is not yours."
    ],
    "health": [
      "What is just beginning to enter the health picture from fate and the future.",
      "What has formed in fate but has not yet manifested in the body.",
      "The brain, sinuses, glands, eyes, nose, throat, and structures above the neck.",
      "Food, drink, medicine, and other solid intake entering the body.",
      "Emotions, psychological state, and bodily pain.",
      "The present state of the short-term or primary immune response.",
      "Deeper immunity and the body's processing of threats already overcome.",
      "The heart, lungs, stomach, pancreas, liver, and kidneys.",
      "Male reproductive organs, bladder, and testosterone.",
      "Female reproductive organs, bladder, and oestrogen.",
      "Digestive processing in the large and small intestines.",
      "What is happening through sleep and dreams.",
      "Bones, muscles, nerves, movement, and inflammatory response.",
      "The skin, the body's outermost and largest organ.",
      "The near future of physical health."
    ],
    "fate-pattern": [
      "The fate path currently active.",
      "Lessons from the past that remain relevant now.",
      "The highest outcome this fate pattern can achieve.",
      "What must be planted for the future and carefully tended.",
      "The difficulty that must be overcome for success.",
      "What must be released to realise the pattern's potential.",
      "What has been achieved so far.",
      "Your own behaviour that could endanger the fate pattern or personal evolution.",
      "Help given in response to your actions, decisions, and reflection.",
      "A connection or presence crossing the first card and influencing you."
    ],
    "angel": [
      "The person, place, or system being examined.",
      "An angelic or Divine power illuminating the road ahead.",
      "A guarding power that slows or limits the path.",
      "Learning and development that still require active participation and work.",
      "Learning already gained that now illuminates the path ahead.",
      "Completed work or learning that is ripening and being refined.",
      "What should sink into the past and must not be revived.",
      "Guidance and advice about the best way forward.",
      "The guardian's advice arising from past experience.",
      "The true present state or self reflected by the guardian.",
      "Insight into what you can become."
    ],
    "landscape": [
      "The body, structure, or land forming the foundation.",
      "The present force, relationship, or inner connection crossing the foundation.",
      "The long-term future still forming around the question.",
      "What has passed away and will not return.",
      "The threshold of the immediate past, from which something may still return.",
      "The current fate or action pattern now unfolding.",
      "The hardship or obstacle that must be overcome on the present path.",
      "Influence flowing from the inner worlds or an inner connection.",
      "Influence from home, family, an organisation, or a magical household.",
      "What is fading, losing influence, and moving into the past.",
      "Dreams, sleep, the unconscious, or visionary work.",
      "The question's near-term result and direction forward."
    ],
    "self-map": [
      "The starting point of the question.",
      "Where the subject comes from.",
      "Where the subject is going.",
      "What contributes positively to the body and mundane life.",
      "The soul's short-term mundane future.",
      "What has recently passed from the soul's fate.",
      "What contributes negatively to the body and mundane life.",
      "How the current magical or spiritual path serves or affects the soul.",
      "The kind of being communicating with or guiding the magician.",
      "Where the current magical path is taking the soul.",
      "The balancing force that opposes the magician and stimulates growth.",
      "The foundation supporting the magical path and how stable it is.",
      "The principal lessons or actions the soul must accomplish in this life.",
      "The road the soul must walk to fulfil its purpose in this life.",
      "The main fate pattern supporting the soul's path and required steps.",
      "Knowledge and experience harvested by the soul so far in this life.",
      "Debts, deficits, and necessities that still need to be balanced.",
      "What must still be restrained so it does not damage this life's purpose."
    ],
    "mystagogus-layout": [
      "The theme or progenitor of the story.",
      "What must be overcome to succeed or grow.",
      "What must be released, loosened, or allowed to fall away.",
      "The person or force closely interacting with you or exerting a direct influence.",
      "Home, family, and the group to which you belong.",
      "What is sinking into the past but may still return.",
      "What is long past and will not return, yet remains meaningful.",
      "The personal fate pattern currently active.",
      "What is moving forward and is active and constructive.",
      "What is bound and should not be activated now.",
      "Help entering the situation.",
      "The adversary or opposing force within the situation.",
      "What happens in sleep and dreams, including visionary work.",
      "What flows into the situation from the inner or spiritual worlds.",
      "Advice about the action needed for success.",
      "A danger that may inhibit or block progress.",
      "The short-term future and the path immediately ahead.",
      "The longer-term result forming from the present situation."
    ],
    "lxxxi-occult-map": [
      "The reading's centre: the body, dwelling, or relevant land; its vessel, health, and present condition.",
      "The relationship, important person, interaction, or force exerting the greatest influence on the subject.",
      "The long-term fate pattern and outcome forming if the present road continues.",
      "What has passed into the deep Underworld and will not return; the distant past.",
      "What is moving away from the subject and may turn back, pause, or continue into the past.",
      "Influence, advice, inherited skill, or talent flowing from bloodline, local ancestors, or their priesthood.",
      "The subject's deeper magical or inner dimension, where inner contacts, angels, and deities operate.",
      "The deepest blood ancestor, directly inherited gifts or problems, and whether that ancestor is active.",
      "A deep anchor: a past event that profoundly shapes the future and cannot be changed.",
      "The fate-pattern theme currently surrounding the subject, read together with the Foundation.",
      "Present limits and difficulties that must be overcome, and the effort that strengthens you.",
      "What is happening in magical life, the powers flowing in, or the influence of a religious collective.",
      "Everyday life involving home, family, people, local community, and the surrounding outer world.",
      "What has peaked and is breaking down, passing through the Past Gate, and leaving the subject's life.",
      "Sleep, dreams, visions, and the night, especially in relation to the Weaver, Ancestor Temple, and Inner Temple.",
      "The formed short-term future: the path now moving into action and its direct result."
    ],
    "lxxxi-tree-of-life-occult": [
      "Beginning, conception, and what flows from the magical East or inner worlds toward manifestation.",
      "What gives form and time, including deep powers of fate already triggered toward manifestation.",
      "What is being withheld, put to sleep, or withdrawn.",
      "The force that builds and opens the path.",
      "The necessary restriction that allows the path to unfold.",
      "The fulcrum that preserves balance so fate can manifest.",
      "Hardship, boundaries, and control that make the subject grow through material and fateful difficulty.",
      "Laxity, lost boundaries, or lack of control that makes the subject fail psychologically or magically.",
      "Creation, inner vision, and the bridge allowing inner power to flow outward.",
      "Body, land, and result: the completion and flowering of the beginning."
    ],
    "lxxxi-tree-of-life-simple": [
      "An overall view of the reading's subject.",
      "The subject's positive, gaining, or giving aspect.",
      "The subject's negative, losing, or withheld aspect.",
      "The necessary condition or support supplied by fate.",
      "What is taken away, lost, or withheld.",
      "The key and core of the present situation.",
      "The emotional dimension and the burden that must be carried.",
      "The mental or magical dimension and what is coming apart.",
      "Influence from clan, home, and ancestors.",
      "The outcome or answer to the question."
    ],
    "lxxxi-four-directions": [
      "The body, place, land, person, or object at the centre of the question.",
      "Birth, potential, air, utterance, spring, arrival, and learning.",
      "The road ahead, future, fire, summer, and work.",
      "Family, home, ageing, water, autumn, disappearance, and what remains.",
      "Ancestors, death, the past, winter, and earth.",
      "The relationship, commitment, or force exerting the greatest influence on the subject."
    ]
  };

  function drawRuleLabel(rule) {
    if (rule.arcana === "major") return "Major Arcana only";
    var suits = { "权杖": "Wands", "圣杯": "Cups", "宝剑": "Swords", "星币": "Pentacles" };
    return suits[rule.suit] ? suits[rule.suit] + " only" : "Restricted draw";
  }

  function enrichSpreads(spreads) {
    if (!Array.isArray(spreads)) return;
    spreads.forEach(function (spread) {
      var data = SPREAD_EN[spread.id];
      if (data) {
        spread.nameEn = data[0];
        spread.categoryEn = data[1];
        spread.descriptionEn = data[2];
        spread.sourceEn = data[3];
      }
      var meanings = POSITION_MEANING_EN[spread.id] || [];
      (spread.positions || []).forEach(function (position) {
        position.meaningEn = meanings[position.number - 1] || "";
        if (position.drawRule) position.drawRule.labelEn = drawRuleLabel(position.drawRule);
      });
    });
  }

  function validate() {
    var errors = [];
    var counts = {
      tarotCards: Array.isArray(tarotCards) ? tarotCards.length : 0,
      mystagogusCards: Array.isArray(mystagogusCards) ? mystagogusCards.length : 0,
      lxxxiCards: Array.isArray(lxxxiCards) ? lxxxiCards.length : 0,
      tarotSpreads: Array.isArray(tarotLayouts) ? tarotLayouts.length : 0,
      mystagogusSpreads: Array.isArray(mystagogusLayouts) ? mystagogusLayouts.length : 0,
      lxxxiSpreads: Array.isArray(lxxxiLayouts) ? lxxxiLayouts.length : 0,
      positions: 0,
      drawRules: 0
    };

    function requireText(object, field, path) {
      if (typeof object[field] !== "string" || !object[field].trim()) errors.push(path + "." + field);
    }
    function requireList(object, field, path) {
      if (!Array.isArray(object[field]) || !object[field].length ||
          object[field].some(function (item) { return typeof item !== "string" || !item.trim(); })) {
        errors.push(path + "." + field);
      }
    }
    function checkDeck(deck, label, reversible) {
      if (!Array.isArray(deck)) {
        errors.push(label + " deck is unavailable");
        return;
      }
      var expectedCounts = { tarot: 78, mystagogus: 78, lxxxi: 81 };
      if (deck.length !== expectedCounts[label]) {
        errors.push(label + " deck expected " + expectedCounts[label] + " cards, found " + deck.length);
      }
      deck.forEach(function (card, index) {
        var path = label + "[" + index + "]";
        requireText(card, "nameEn", path);
        requireList(card, "uprightKeywordsEn", path);
        requireText(card, "uprightMeaningEn", path);
        requireText(card, "sourceEn", path);
        if (reversible) {
          requireList(card, "reversedKeywordsEn", path);
          requireText(card, "reversedMeaningEn", path);
        }
      });
    }
    function checkSpreads(spreads, label) {
      if (!Array.isArray(spreads)) {
        errors.push(label + " spreads are unavailable");
        return;
      }
      var expectedCounts = { tarot: 16, mystagogus: 1, lxxxi: 4 };
      if (spreads.length !== expectedCounts[label]) {
        errors.push(label + " spreads expected " + expectedCounts[label] + ", found " + spreads.length);
      }
      spreads.forEach(function (spread, index) {
        var path = label + "[" + index + "]";
        ["nameEn", "categoryEn", "descriptionEn", "sourceEn"].forEach(function (field) {
          requireText(spread, field, path);
        });
        if (/^Spread \d+$/i.test(String(spread.nameEn || ""))) errors.push(path + ".nameEn is generic");
        if (!Array.isArray(spread.positions) || !spread.positions.length) {
          errors.push(path + ".positions");
          return;
        }
        var expectedMeanings = POSITION_MEANING_EN[spread.id];
        if (!expectedMeanings || expectedMeanings.length !== spread.positions.length) {
          errors.push(path + ".position meaning catalogue");
        }
        spread.positions.forEach(function (position, positionIndex) {
          counts.positions += 1;
          requireText(position, "nameEn", path + ".positions[" + positionIndex + "]");
          requireText(position, "meaningEn", path + ".positions[" + positionIndex + "]");
          if (/^Position \d+$/i.test(String(position.nameEn || ""))) {
            errors.push(path + ".positions[" + positionIndex + "].nameEn is generic");
          }
          if (/^Shows position \d+/i.test(String(position.meaningEn || ""))) {
            errors.push(path + ".positions[" + positionIndex + "].meaningEn is generic");
          }
          if (position.drawRule) {
            counts.drawRules += 1;
            requireText(position.drawRule, "labelEn", path + ".positions[" + positionIndex + "].drawRule");
          }
        });
      });
    }

    checkDeck(tarotCards, "tarot", true);
    checkDeck(mystagogusCards, "mystagogus", false);
    checkDeck(lxxxiCards, "lxxxi", false);
    checkSpreads(tarotLayouts, "tarot");
    checkSpreads(mystagogusLayouts, "mystagogus");
    checkSpreads(lxxxiLayouts, "lxxxi");
    return { valid: errors.length === 0, errors: errors, counts: counts, fallbacks: FALLBACKS.slice() };
  }

  function applyAll() {
    enrichTarot();
    enrichOriginalDeck(mystagogusCards, MYSTAGOGUS, "m-", CARD_SOURCES_EN.mystagogus);
    enrichOriginalDeck(lxxxiCards, LXXXI, "lxxxi-", CARD_SOURCES_EN.lxxxi, LXXXI_MEANINGS);
    enrichSpreads(tarotLayouts);
    enrichSpreads(mystagogusLayouts);
    enrichSpreads(lxxxiLayouts);
  }

  var api = { validate: validate };

  applyAll();
  root.DivinationEnglishData = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

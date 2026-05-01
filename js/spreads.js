var spreadDefinitions = {
  "simple-3": {
    name: "三张牌（过去 · 现在 · 未来）",
    positions: 3,
    desc: "适合快速观察问题的来龙去脉。"
  },
  "yes-no": {
    name: "是/否布局",
    positions: 6,
    desc: "参考 Quareia 的聚焦式是/否判断，适合明确问题。"
  },
  "tree-of-life": {
    name: "生命之树布局",
    positions: 10,
    desc: "用于观察不同层面的力量结构和稳定状态。"
  },
  "overview": {
    name: "概览布局",
    positions: 13,
    desc: "用于较长周期的整体观察。"
  },
  "event": {
    name: "事件布局",
    positions: 7,
    desc: "适合评估特定选择、行动或事件的动力。"
  },
  "direction": {
    name: "方向布局",
    positions: 5,
    desc: "参考方向与元素对应：东方剑、南方杖、西方杯、北方币。"
  },
  "resource": {
    name: "资源布局",
    positions: 11,
    desc: "用于观察内外资源和需要调整的位置。"
  },
  "timing": {
    name: "时间布局",
    positions: 7,
    desc: "用于识别事件可能展开的时间节点。"
  },
  "cause": {
    name: "表现/因果布局",
    positions: 10,
    desc: "用于识别事件背后的原因与表现方式。"
  },
  "solution": {
    name: "解决方案布局",
    positions: 7,
    desc: "用于寻找解决路径和动态方法。"
  },
  "celtic-cross": {
    name: "凯尔特十字",
    positions: 10,
    desc: "经典十张牌布局，可用于综合问题。"
  }
};

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

function getSpreadDrawCount(spreadId) {
  var spread = spreadDefinitions[spreadId];
  return spread ? spread.positions : 3;
}

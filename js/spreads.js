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

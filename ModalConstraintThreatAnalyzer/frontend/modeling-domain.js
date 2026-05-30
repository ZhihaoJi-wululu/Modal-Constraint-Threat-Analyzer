(() => {
const typeDefaults = {
  Role: { name: "New Role", width: 94, height: 94 },
  Actor: { name: "New Actor", awareness: "", width: 94, height: 94 },
  Task: { name: "New Task", width: 160, height: 62 },
  Asset: { name: "New Asset", width: 160, height: 62 },
  Scenario: { name: "New Scenario", complexity: "High", width: 286, height: 118 },
  Constraint: {
    name: "New Constraint",
    modalType: "Obligation",
    polarity: "Positive",
    actionType: "Execute",
    width: 118,
    height: 44
  }
};

const SCENARIO_PADDING = 54;
const CANVAS_MIN_WIDTH = 1800;
const CANVAS_MIN_HEIGHT = 1200;
const CANVAS_MARGIN = 8;
const ELEMENT_GAP = 14;
const SCENARIO_GAP = 28;
const GRID_SIZE = 20;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.8;
const ZOOM_STEP = 0.1;

const MODAL_CODE = {
  Obligation: "M",
  Permission: "S",
  Recommendation: "Sh",
  Ability: "C"
};

const MODAL_NAME = {
  M: "Obligation",
  S: "Permission",
  Sh: "Recommendation",
  C: "Ability"
};

const POLARITY_CODE = {
  Positive: "P",
  Negative: "N",
  Uncertain: "Y",
  PositiveUncertain: "P,Y"
};

const POLARITY_NAME = {
  p: "Positive",
  n: "Negative"
};

const MODELING_ELEMENT_TYPES = ["Role", "Actor", "Task", "Asset"];

const MODAL_RELATION_META = {
  modal_M_P: { label: "M,P", modal: "M", polarity: "p", punish: false },
  modal_M_N: { label: "M,N", modal: "M", polarity: "n", punish: false },
  modal_S_P: { label: "S,P", modal: "S", polarity: "p", punish: false },
  modal_S_N: { label: "S,N", modal: "S", polarity: "n", punish: false },
  modal_Sh_P: { label: "Sh,P", modal: "Sh", polarity: "p", punish: false },
  modal_Sh_N: { label: "Sh,N", modal: "Sh", polarity: "n", punish: false },
  modal_C_P: { label: "C,P", modal: "C", polarity: "p", punish: false },
  modal_C_N: { label: "C,N", modal: "C", polarity: "n", punish: false },
  modal_M_P_Y: { label: "M,P,Y", modal: "M", polarity: "p", punish: true },
  modal_M_N_Y: { label: "M,N,Y", modal: "M", polarity: "n", punish: true },
  modal_S_P_Y: { label: "S,P,Y", modal: "S", polarity: "p", punish: true },
  modal_S_N_Y: { label: "S,N,Y", modal: "S", polarity: "n", punish: true }
};

const MODAL_RELATION_TYPES = Object.keys(MODAL_RELATION_META);

const VISIBLE_RELATION_TYPES = [
  ...MODAL_RELATION_TYPES,
  "plays",
  "possesses",
  "owns",
  "needs",
  "generates",
  "depends",
  "delegates",
  "delegatePermission",
  "delegateObligation",
  "subordinate",
  "authority",
  "trust",
  "externalCooperation",
  "executes"
];

function isModalRelationType(type) {
  return Object.prototype.hasOwnProperty.call(MODAL_RELATION_META, type);
}

function isUndirectedRelationType(type) {
  return isModalRelationType(type);
}

const RELATIONSHIP_RELATION_TYPES = VISIBLE_RELATION_TYPES.filter(
  (type) => !isModalRelationType(type) && type !== "appliesTo" && type !== "constrains"
);

function edgeLabel(type) {
  const labels = {
    ...Object.fromEntries(Object.entries(MODAL_RELATION_META).map(([key, value]) => [key, value.label])),
    delegatePermission: "DP",
    delegateObligation: "DP",
    externalCooperation: "ex_cooperation",
    subordinate: "subordinate",
    authority: "authority",
    plays: "play",
    possesses: "possess",
    executes: "execute",
    needs: "need",
    generates: "generate",
    appliesTo: "",
    constrains: "",
    depends: "depend",
    delegates: "DP",
    owns: "own",
    trust: "trust"
  };
  return Object.prototype.hasOwnProperty.call(labels, type) ? labels[type] : type;
}

function edgeCategory(type) {
  if (isModalRelationType(type)) return "modal";
  if (["trust", "authority", "subordinate", "externalCooperation"].includes(type)) return "social";
  if (["delegates", "delegatePermission", "delegateObligation"].includes(type)) return "delegation";
  if (["needs", "generates", "depends", "owns", "possesses"].includes(type)) return "resource";
  if (["appliesTo", "constrains"].includes(type)) return "modal";
  return "structural";
}

function edgeDash(type) {
  if (["trust", "externalCooperation"].includes(type)) return "6 5";
  if (["delegatePermission", "delegateObligation", "delegates"].includes(type)) return "10 4";
  return "";
}

function relationPredicate(type) {
  const map = {
    plays: "play",
    owns: "ownership",
    possesses: "ownership",
    needs: "need",
    generates: "generate",
    depends: "depend",
    delegates: "delegate",
    externalCooperation: "ex_cooperation"
  };
  return map[type] || type;
}

function modalPredicate(constraint) {
  const modal = MODAL_CODE[constraint.modalType] || "M";
  const polarity = String(constraint.polarity || "Positive").toLowerCase();
  const polarityCode = polarity.startsWith("neg") ? "n" : "p";
  return modalPredicateFromParts(modal, polarityCode);
}

function isUncertainConstraint(constraint) {
  return String(constraint.polarity || "").toLowerCase().includes("uncertain");
}

function modalPredicateFromParts(modal, polarity) {
  return `modal_constraint_${modal}_${polarity}`;
}

window.ModelingDomain = {
  CANVAS_MARGIN,
  CANVAS_MIN_HEIGHT,
  CANVAS_MIN_WIDTH,
  ELEMENT_GAP,
  GRID_SIZE,
  MAX_ZOOM,
  MIN_ZOOM,
  MODELING_ELEMENT_TYPES,
  MODAL_CODE,
  MODAL_NAME,
  MODAL_RELATION_META,
  MODAL_RELATION_TYPES,
  POLARITY_CODE,
  POLARITY_NAME,
  RELATIONSHIP_RELATION_TYPES,
  SCENARIO_GAP,
  SCENARIO_PADDING,
  VISIBLE_RELATION_TYPES,
  ZOOM_STEP,
  edgeCategory,
  edgeDash,
  edgeLabel,
  isModalRelationType,
  isUncertainConstraint,
  isUndirectedRelationType,
  modalPredicate,
  modalPredicateFromParts,
  relationPredicate,
  typeDefaults
};
})();

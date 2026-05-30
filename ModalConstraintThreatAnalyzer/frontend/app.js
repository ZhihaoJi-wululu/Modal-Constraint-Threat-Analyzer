const {
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
  POLARITY_NAME,
  POLARITY_CODE,
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
} = window.ModelingDomain;

const state = {
  nodes: [],
  edges: [],
  facts: [],
  selectedNodeId: null,
  selectedNodeIds: [],
  selectedEdgeId: null,
  connectMode: false,
  connectSourceId: null,
  connectDirection: "out",
  connectLockedType: false,
  dragNodeId: null,
  dragOffset: { x: 0, y: 0 },
  dragStart: { x: 0, y: 0 },
  dragOriginal: { x: 0, y: 0 },
  dragNodeIds: [],
  dragOriginals: {},
  dragScenarioId: null,
  dragMoved: false,
  dragSnapshot: null,
  selectionBox: null,
  selectionMoved: false,
  selectionJustCompleted: false,
  edgeLabelDrag: null,
  edgeLabelMoved: false,
  edgeLabelSnapshot: null,
  resizingPanel: null,
  pendingTool: null,
  zoom: 1,
  gridEnabled: true,
  undoStack: [],
  redoStack: [],
  findings: []
};

const edgeAnchors = new Map();
let clickRenderTimer = null;

const API_BASE = location.protocol === "file:" ? "http://127.0.0.1:8000" : "";
const POSITIVE_ACCESS_MODAL_PREDICATES = modalPredicateSet([
  ["M", "p"],
  ["S", "p"],
  ["C", "p"]
]);
const NEGATIVE_BOUNDARY_MODAL_PREDICATES = modalPredicateSet([
  ["C", "n"],
  ["S", "n"]
]);
const RECOMMENDATION_MODAL_PREDICATES = modalPredicateSet([
  ["Sh", "p"],
  ["S", "p"]
]);
const OWNERSHIP_MODAL_PREDICATES = modalPredicateSet([
  ["S", "p"],
  ["M", "p"]
]);

const canvas = document.getElementById("canvas");
const canvasWrap = document.querySelector(".canvas-wrap");
const canvasStage = document.getElementById("canvasStage");
const edgeLayer = document.getElementById("edgeLayer");
const relationType = document.getElementById("relationType");
const connectMode = document.getElementById("connectMode");
const selectMode = document.getElementById("selectMode");
const undoAction = document.getElementById("undoAction");
const redoAction = document.getElementById("redoAction");
const gridToggle = document.getElementById("gridToggle");
const zoomOut = document.getElementById("zoomOut");
const zoomIn = document.getElementById("zoomIn");
const fitView = document.getElementById("fitView");
const zoomReadout = document.getElementById("zoomReadout");
const nodeInspector = document.getElementById("nodeInspector");
const nodeName = document.getElementById("nodeName");
const nodeType = document.getElementById("nodeType");
const modalType = document.getElementById("modalType");
const polarity = document.getElementById("polarity");
const actionType = document.getElementById("actionType");
const awareness = document.getElementById("awareness");
const complexity = document.getElementById("complexity");
const nodeWidth = document.getElementById("nodeWidth");
const nodeHeight = document.getElementById("nodeHeight");
const description = document.getElementById("description");
const findings = document.getElementById("findings");
const relationList = document.getElementById("relationList");
const appShell = document.querySelector(".app-shell");

document.querySelectorAll(".tool").forEach((tool) => {
  tool.addEventListener("dragstart", (event) => {
    if (!tool.dataset.type) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", tool.dataset.type);
  });
  tool.addEventListener("click", () => {
    if (tool.dataset.action === "relationship") {
      activateRelationshipTool();
      return;
    }
    setPendingTool(tool.dataset.type);
  });
});

document.querySelectorAll(".panel-resizer").forEach((resizer) => {
  resizer.addEventListener("pointerdown", (event) => {
    const side = resizer.dataset.resizePanel;
    if (!side) return;
    event.preventDefault();
    state.resizingPanel = {
      side,
      startX: event.clientX,
      startWidth: side === "left" ? currentPanelWidth("left") : currentPanelWidth("right")
    };
    resizer.classList.add("active");
    document.body.classList.add("resizing-panels");
    resizer.setPointerCapture(event.pointerId);
  });
});

canvas.addEventListener("dragover", (event) => event.preventDefault());
canvas.addEventListener("drop", (event) => {
  event.preventDefault();
  const type = event.dataTransfer.getData("text/plain");
  if (!type) return;
  const size = getNodeSize({ type });
  const point = canvasPointFromEvent(event);
  const position = snapPoint({
    x: point.x - size.width / 2,
    y: point.y - size.height / 2
  }, event.shiftKey);
  addNode(type, position.x, position.y);
  setPendingTool(null);
});

window.addEventListener("pointermove", (event) => {
  if (state.selectionBox) {
    const point = canvasPointFromEvent(event);
    state.selectionBox.current = point;
    const start = state.selectionBox.start;
    if (Math.hypot(point.x - start.x, point.y - start.y) > 6) state.selectionMoved = true;
    renderSelectionBox();
    return;
  }
  if (state.resizingPanel) {
    resizeSidePanel(event);
    return;
  }
  if (state.edgeLabelDrag) {
    const point = canvasPointFromEvent(event);
    const dx = point.x - state.edgeLabelDrag.startPoint.x;
    const dy = point.y - state.edgeLabelDrag.startPoint.y;
    if (Math.hypot(dx, dy) > 3) state.edgeLabelMoved = true;
    const edge = getEdge(state.edgeLabelDrag.edgeId);
    if (edge) {
      edge.labelOffset = {
        x: state.edgeLabelDrag.originalOffset.x + dx,
        y: state.edgeLabelDrag.originalOffset.y + dy
      };
      render();
    }
    return;
  }
  if (!state.dragNodeId) return;
  const node = getNode(state.dragNodeId);
  if (!node) return;
  if (Math.hypot(event.clientX - state.dragStart.x, event.clientY - state.dragStart.y) > 4) {
    state.dragMoved = true;
  }
  const point = canvasPointFromEvent(event);
  const position = snapPoint({
    x: point.x - state.dragOffset.x,
    y: point.y - state.dragOffset.y
  }, event.shiftKey);
  const originals = state.dragOriginals || {};
  const dragIds = state.dragNodeIds?.length ? state.dragNodeIds : [node.id];
  let dx = position.x - state.dragOriginal.x;
  let dy = position.y - state.dragOriginal.y;
  const groupRect = dragIds.reduce((acc, id) => {
    const item = getNode(id);
    const original = originals[id];
    if (!item || !original) return acc;
    const size = getNodeSize(item);
    return {
      left: Math.min(acc.left, original.x),
      top: Math.min(acc.top, original.y),
      right: Math.max(acc.right, original.x + size.width),
      bottom: Math.max(acc.bottom, original.y + size.height)
    };
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  if (Number.isFinite(groupRect.left)) {
    dx = Math.max(dx, CANVAS_MARGIN - groupRect.left);
    dy = Math.max(dy, CANVAS_MARGIN - groupRect.top);
  }
  dragIds.forEach((id) => {
    const item = getNode(id);
    const original = originals[id];
    if (!item || !original) return;
    item.x = original.x + dx;
    item.y = original.y + dy;
  });
  dragIds
    .map((id) => getNode(id))
    .filter((item) => item && item.type !== "Scenario" && item.type !== "Actor")
    .forEach((item) => {
      item.scenarioId = scenarioForBox(item.type, item.x, item.y, item)?.id || "";
    });
  render();
});

window.addEventListener("pointerup", (event) => {
  if (state.selectionBox) {
    const box = state.selectionBox;
    const moved = state.selectionMoved;
    state.selectionBox = null;
    state.selectionMoved = false;
    if (moved) {
      const rect = selectionRectFromBox(box);
      const selected = state.nodes
        .filter((node) => rectsOverlap(rect, nodeRect(node)))
        .map((node) => node.id);
      setSelectedNodes(selected);
      state.selectionJustCompleted = true;
      render();
    } else {
      renderSelectionBox();
    }
    return;
  }
  if (state.resizingPanel) {
    endResizeSidePanel();
    return;
  }
  if (state.edgeLabelDrag) {
    if (state.edgeLabelMoved && state.edgeLabelSnapshot) {
      pushHistorySnapshot(state.edgeLabelSnapshot);
      saveState();
    }
    state.edgeLabelDrag = null;
    state.edgeLabelMoved = false;
    state.edgeLabelSnapshot = null;
    render();
    return;
  }
  if (!state.dragNodeId) return;
  state.dragNodeId = null;
  state.dragNodeIds = [];
  state.dragOriginals = {};
  state.dragScenarioId = null;
  if (state.dragMoved && state.dragSnapshot) {
    pushHistorySnapshot(state.dragSnapshot);
  }
  state.dragSnapshot = null;
  const moved = state.dragMoved;
  state.dragMoved = false;
  if (moved) {
    applySmartLayout();
    render();
    saveState();
  }
});

connectMode.addEventListener("click", () => {
  state.connectMode = !state.connectMode;
  state.connectSourceId = null;
  state.connectDirection = "out";
  state.connectLockedType = false;
  state.pendingTool = null;
  connectMode.classList.toggle("active", state.connectMode);
  render();
});

selectMode.addEventListener("click", () => {
  state.connectMode = false;
  state.connectSourceId = null;
  state.connectDirection = "out";
  state.connectLockedType = false;
  setPendingTool(null);
  render();
});

undoAction.addEventListener("click", undo);
redoAction.addEventListener("click", redo);
gridToggle.addEventListener("click", () => {
  state.gridEnabled = !state.gridEnabled;
  render();
  saveState();
});
zoomOut.addEventListener("click", () => setZoom(state.zoom - ZOOM_STEP));
zoomIn.addEventListener("click", () => setZoom(state.zoom + ZOOM_STEP));
fitView.addEventListener("click", fitCanvasToView);

document.getElementById("deleteNode").addEventListener("click", () => {
  deleteSelectedNode();
});

document.getElementById("clearWorkspace").addEventListener("click", () => {
  recordHistory();
  state.nodes = [];
  state.edges = [];
  state.findings = [];
  state.facts = [];
  clearNodeSelection();
  state.selectedEdgeId = null;
  state.connectSourceId = null;
  state.connectDirection = "out";
  state.connectLockedType = false;
  render();
  saveState();
});

document.getElementById("loadSample").addEventListener("click", loadSampleCase);
document.getElementById("validateModel").addEventListener("click", validateModel);
document.getElementById("runScenarioInference").addEventListener("click", runScenarioInference);
document.getElementById("runInference").addEventListener("click", runThreatDetection);
document.getElementById("exportModel").addEventListener("click", exportModel);
document.getElementById("saveServerModel").addEventListener("click", saveServerModel);
document.getElementById("saveDiagramImage").addEventListener("click", saveDiagramImage);
document.getElementById("exportThreatResult").addEventListener("click", exportThreatResult);
document.getElementById("exportReport").addEventListener("click", exportReport);
document.getElementById("importModel").addEventListener("change", importModel);

[nodeName, modalType, polarity, actionType, awareness, complexity, nodeWidth, nodeHeight, description].forEach((input) => {
  input.addEventListener("input", updateSelectedNode);
});

canvas.addEventListener("wheel", handleCanvasWheel, { passive: false });
canvas.addEventListener("pointerdown", handleCanvasPointerDown);
canvas.addEventListener("click", handleCanvasClick);
canvas.addEventListener("dblclick", handleCanvasDoubleClick, { capture: true });

document.addEventListener("keydown", (event) => {
  if (isTextEditing(event.target)) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "0") {
    event.preventDefault();
    fitCanvasToView();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelectedNode();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    cancelTransientModes();
    return;
  }
  if (key === "v") {
    cancelTransientModes();
    return;
  }
  if (key === "c") {
    state.connectMode = true;
    state.connectSourceId = null;
    state.connectDirection = "out";
    state.connectLockedType = false;
    state.pendingTool = null;
    render();
    return;
  }
  if (event.key === "+" || event.key === "=") {
    setZoom(state.zoom + ZOOM_STEP);
    return;
  }
  if (event.key === "-") {
    setZoom(state.zoom - ZOOM_STEP);
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest?.(".modeling-catalog") && !event.target.closest?.(".node")) {
    closeModelingCatalog();
  }
});

function takeSnapshot() {
  return {
    nodes: JSON.parse(JSON.stringify(state.nodes)),
    edges: JSON.parse(JSON.stringify(state.edges)),
    facts: JSON.parse(JSON.stringify(state.facts)),
    findings: JSON.parse(JSON.stringify(state.findings))
  };
}

function pushHistorySnapshot(snapshot) {
  if (!snapshot) return;
  state.undoStack.push(snapshot);
  if (state.undoStack.length > 80) state.undoStack.shift();
  state.redoStack = [];
  updateToolbarState();
}

function recordHistory() {
  pushHistorySnapshot(takeSnapshot());
}

function setSelectedNodes(ids = []) {
  const valid = new Set(state.nodes.map((node) => node.id));
  state.selectedNodeIds = [...new Set(ids)].filter((id) => valid.has(id));
  state.selectedNodeId = state.selectedNodeIds.length === 1 ? state.selectedNodeIds[0] : null;
  if (state.selectedNodeIds.length) state.selectedEdgeId = null;
}

function clearNodeSelection() {
  state.selectedNodeIds = [];
  state.selectedNodeId = null;
}

function isNodeSelected(id) {
  return state.selectedNodeIds.includes(id) || state.selectedNodeId === id;
}

function dragIdsForNode(node) {
  const baseIds = isNodeSelected(node.id) && state.selectedNodeIds.length > 1
    ? state.selectedNodeIds
    : [node.id];
  const expanded = new Set(baseIds);
  baseIds
    .map((id) => getNode(id))
    .filter((item) => item?.type === "Scenario")
    .forEach((scenario) => nodesInScenario(scenario).forEach((member) => expanded.add(member.id)));
  return [...expanded].filter((id) => getNode(id));
}

function selectionRectFromBox(box) {
  return {
    left: Math.min(box.start.x, box.current.x),
    top: Math.min(box.start.y, box.current.y),
    right: Math.max(box.start.x, box.current.x),
    bottom: Math.max(box.start.y, box.current.y)
  };
}

function restoreSnapshot(snapshot) {
  state.nodes = Array.isArray(snapshot.nodes) ? migrateNodes(snapshot.nodes) : [];
  state.edges = Array.isArray(snapshot.edges) ? snapshot.edges.filter((edge) => edge.type !== "inScenario") : [];
  state.facts = Array.isArray(snapshot.facts) ? snapshot.facts : [];
  state.findings = Array.isArray(snapshot.findings) ? snapshot.findings : [];
  clearNodeSelection();
  state.selectedEdgeId = null;
  state.connectMode = false;
  state.connectSourceId = null;
  state.connectDirection = "out";
  state.connectLockedType = false;
  state.pendingTool = null;
  assignScenarioMembership();
  autoFitScenarios();
  render();
  saveState();
}

function undo() {
  if (!state.undoStack.length) return;
  const current = takeSnapshot();
  const previous = state.undoStack.pop();
  state.redoStack.push(current);
  restoreSnapshot(previous);
}

function redo() {
  if (!state.redoStack.length) return;
  const current = takeSnapshot();
  const next = state.redoStack.pop();
  state.undoStack.push(current);
  restoreSnapshot(next);
}

function deleteSelectedNode() {
  if (state.selectedEdgeId) {
    recordHistory();
    const removedEdgeId = state.selectedEdgeId;
    state.edges = state.edges.filter((edge) => (
      edge.id !== removedEdgeId &&
      edge.from !== removedEdgeId &&
      edge.to !== removedEdgeId
    ));
    edgeAnchors.delete(removedEdgeId);
    state.selectedEdgeId = null;
    state.findings = [];
    state.facts = [];
    render();
    saveState();
    return;
  }
  const selectedIds = state.selectedNodeIds.length ? state.selectedNodeIds : state.selectedNodeId ? [state.selectedNodeId] : [];
  if (!selectedIds.length) return;
  recordHistory();
  const selectedSet = new Set(selectedIds);
  state.nodes = state.nodes.filter((node) => !selectedSet.has(node.id));
  state.edges = state.edges.filter(
    (edge) => !selectedSet.has(edge.from) && !selectedSet.has(edge.to)
  );
  clearNodeSelection();
  state.selectedEdgeId = null;
  state.findings = [];
  state.facts = [];
  render();
  saveState();
}

function setPendingTool(type) {
  state.pendingTool = type || null;
  if (state.pendingTool) {
    state.connectMode = false;
    state.connectSourceId = null;
    state.connectDirection = "out";
    state.connectLockedType = false;
    state.selectedEdgeId = null;
  }
  updateToolbarState();
}

function activateRelationshipTool() {
  state.pendingTool = null;
  state.connectMode = true;
  state.connectSourceId = null;
  state.connectDirection = "out";
  state.connectLockedType = false;
  relationType.value = "depends";
  state.findings = [{
    threatType: "Relationship Modeling",
    riskLevel: "Ready",
    evidence: "Click a shape or an existing relationship label, then click the target. The connector will use the closest supported paper relation.",
    kind: "ready"
  }];
  render();
}

function cancelTransientModes() {
  closeModelingCatalog();
  state.connectMode = false;
  state.connectSourceId = null;
  state.connectDirection = "out";
  state.connectLockedType = false;
  state.pendingTool = null;
  state.selectedEdgeId = null;
  render();
}

function isTextEditing(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function canvasPointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const zoom = state.zoom || 1;
  return {
    x: (event.clientX - rect.left) / zoom,
    y: (event.clientY - rect.top) / zoom
  };
}

function snapValue(value, bypass = false) {
  if (!state.gridEnabled || bypass) return value;
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function snapPoint(point, bypass = false) {
  return {
    x: snapValue(point.x, bypass),
    y: snapValue(point.y, bypass)
  };
}

function setZoom(nextZoom) {
  const previousZoom = state.zoom || 1;
  const next = clamp(Number(nextZoom) || 1, MIN_ZOOM, MAX_ZOOM);
  if (Math.abs(next - previousZoom) < 0.001) return;
  const wrapRect = canvasWrap.getBoundingClientRect();
  const center = {
    x: (canvasWrap.scrollLeft + wrapRect.width / 2) / previousZoom,
    y: (canvasWrap.scrollTop + wrapRect.height / 2) / previousZoom
  };
  state.zoom = next;
  render();
  requestAnimationFrame(() => {
    canvasWrap.scrollLeft = Math.max(0, center.x * state.zoom - wrapRect.width / 2);
    canvasWrap.scrollTop = Math.max(0, center.y * state.zoom - wrapRect.height / 2);
  });
  saveState();
}

function fitCanvasToView() {
  if (!state.nodes.length) {
    setZoom(1);
    canvasWrap.scrollLeft = 0;
    canvasWrap.scrollTop = 0;
    return;
  }
  const bounds = diagramBounds(44);
  const availableWidth = Math.max(120, canvasWrap.clientWidth - 28);
  const availableHeight = Math.max(120, canvasWrap.clientHeight - 28);
  state.zoom = clamp(Math.min(availableWidth / bounds.width, availableHeight / bounds.height), MIN_ZOOM, 1.25);
  render();
  requestAnimationFrame(() => {
    canvasWrap.scrollLeft = Math.max(0, bounds.left * state.zoom - 14);
    canvasWrap.scrollTop = Math.max(0, bounds.top * state.zoom - 14);
  });
  saveState();
}

function diagramBounds(padding = 0) {
  if (!state.nodes.length) {
    return { left: 0, top: 0, right: CANVAS_MIN_WIDTH, bottom: CANVAS_MIN_HEIGHT, width: CANVAS_MIN_WIDTH, height: CANVAS_MIN_HEIGHT };
  }
  const bounds = state.nodes.reduce((acc, node) => {
    const size = getNodeSize(node);
    return {
      left: Math.min(acc.left, node.x),
      top: Math.min(acc.top, node.y),
      right: Math.max(acc.right, node.x + size.width),
      bottom: Math.max(acc.bottom, node.y + size.height)
    };
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  bounds.left = Math.max(0, bounds.left - padding);
  bounds.top = Math.max(0, bounds.top - padding);
  bounds.right += padding;
  bounds.bottom += padding;
  bounds.width = Math.max(1, bounds.right - bounds.left);
  bounds.height = Math.max(1, bounds.bottom - bounds.top);
  return bounds;
}

function syncCanvasView() {
  const dimensions = canvasDimensions();
  canvasStage.style.width = `${Math.ceil(dimensions.width * state.zoom)}px`;
  canvasStage.style.height = `${Math.ceil(dimensions.height * state.zoom)}px`;
  canvasStage.style.setProperty("--canvas-width", `${dimensions.width}px`);
  canvasStage.style.setProperty("--canvas-height", `${dimensions.height}px`);
  canvasStage.style.setProperty("--canvas-zoom", state.zoom);
  canvas.classList.toggle("grid-enabled", state.gridEnabled);
}

function currentPanelWidth(side) {
  const property = side === "left" ? "--left-panel-width" : "--right-panel-width";
  const fallback = side === "left" ? 292 : 340;
  const value = getComputedStyle(appShell).getPropertyValue(property).trim();
  return Number.parseFloat(value) || fallback;
}

function setPanelWidth(side, width) {
  const property = side === "left" ? "--left-panel-width" : "--right-panel-width";
  const next = clamp(Math.round(width), 220, 560);
  appShell.style.setProperty(property, `${next}px`);
  return next;
}

function resizeSidePanel(event) {
  const resizing = state.resizingPanel;
  if (!resizing) return;
  const delta = event.clientX - resizing.startX;
  const nextWidth = resizing.side === "left"
    ? resizing.startWidth + delta
    : resizing.startWidth - delta;
  setPanelWidth(resizing.side, nextWidth);
}

function endResizeSidePanel() {
  const leftWidth = currentPanelWidth("left");
  const rightWidth = currentPanelWidth("right");
  state.resizingPanel = null;
  document.body.classList.remove("resizing-panels");
  document.querySelectorAll(".panel-resizer.active").forEach((resizer) => resizer.classList.remove("active"));
  localStorage.setItem("mcta-panel-widths", JSON.stringify({ left: leftWidth, right: rightWidth }));
  render();
}

function restorePanelWidths() {
  try {
    const saved = JSON.parse(localStorage.getItem("mcta-panel-widths") || "{}");
    if (Number(saved.left)) setPanelWidth("left", Number(saved.left));
    if (Number(saved.right)) setPanelWidth("right", Number(saved.right));
  } catch {
    setPanelWidth("left", 292);
    setPanelWidth("right", 340);
  }
}

function updateToolbarState() {
  undoAction.disabled = !state.undoStack.length;
  redoAction.disabled = !state.redoStack.length;
  selectMode.classList.toggle("active", !state.connectMode && !state.pendingTool);
  connectMode.classList.toggle("active", state.connectMode);
  gridToggle.classList.toggle("active", state.gridEnabled);
  zoomOut.disabled = state.zoom <= MIN_ZOOM + 0.001;
  zoomIn.disabled = state.zoom >= MAX_ZOOM - 0.001;
  zoomReadout.textContent = `${Math.round((state.zoom || 1) * 100)}%`;
  document.querySelectorAll(".tool").forEach((tool) => {
    const activeType = tool.dataset.type && tool.dataset.type === state.pendingTool;
    const activeAction = tool.dataset.action === "relationship" && state.connectMode && relationType.value === "depends";
    tool.classList.toggle("active", Boolean(activeType || activeAction));
  });
}

function handleCanvasPointerDown(event) {
  if (event.button !== 0 || event.target !== canvas || event.detail > 1) return;
  if (state.pendingTool || state.connectMode) return;
  const point = canvasPointFromEvent(event);
  state.selectionBox = { start: point, current: point };
  state.selectionMoved = false;
  state.selectionJustCompleted = false;
  canvas.setPointerCapture?.(event.pointerId);
  renderSelectionBox();
}

function handleCanvasClick(event) {
  if (state.selectionJustCompleted) {
    state.selectionJustCompleted = false;
    return;
  }
  const nodeElement = event.target.closest?.(".node");
  if (nodeElement && event.detail >= 2) {
    if (clickRenderTimer) {
      clearTimeout(clickRenderTimer);
      clickRenderTimer = null;
    }
    const node = getNode(nodeElement.dataset.id);
    if (node) showModelingCatalog(event, node);
    return;
  }
  if (nodeElement) {
    const node = getNode(nodeElement.dataset.id);
    if (node) {
      if (!isNodeSelected(node.id)) setSelectedNodes([node.id]);
      state.selectedEdgeId = null;
      if (clickRenderTimer) clearTimeout(clickRenderTimer);
      clickRenderTimer = setTimeout(() => {
        clickRenderTimer = null;
        render();
      }, 240);
    }
    return;
  }
  if (event.target !== canvas || event.detail > 1) return;
  if (state.pendingTool) {
    const size = getNodeSize({ type: state.pendingTool });
    const point = canvasPointFromEvent(event);
    const position = snapPoint({
      x: point.x - size.width / 2,
      y: point.y - size.height / 2
    }, event.shiftKey);
    addNode(state.pendingTool, position.x, position.y);
    setPendingTool(null);
    return;
  }
  clearNodeSelection();
  state.selectedEdgeId = null;
  render();
}

function handleCanvasDoubleClick(event) {
  const nodeElement = event.target.closest?.(".node");
  if (nodeElement) {
    const node = getNode(nodeElement.dataset.id);
    if (node) {
      showModelingCatalog(event, node);
      return;
    }
  }
  if (event.target === canvas) {
    event.preventDefault();
    showCanvasCatalog(event);
  }
}

function addNode(type, x, y, override = {}, options = {}) {
  if (options.recordHistory !== false) recordHistory();
  const scenario = type === "Scenario" ? null : scenarioForBox(type, x, y, override);
  const node = {
    id: `node_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    type,
    x: Math.max(8, x),
    y: Math.max(8, y),
    awareness: "",
    complexity: "",
    description: "",
    ...typeDefaults[type],
    ...override,
    scenarioId: override.scenarioId || scenario?.id || ""
  };
  clampNodeToCanvas(node);
  placeNodeAvoidingOverlap(node);
  state.nodes.push(node);
  applySmartLayout();
  setSelectedNodes([node.id]);
  state.findings = [];
  state.facts = [];
  render();
  saveState();
  return node;
}

function addEdge(from, to, type, options = {}) {
  if (from === to) return false;
  const fromNode = getConnectable(from);
  const toNode = getConnectable(to);
  const resolvedType = options.inferType === false ? type : resolveRelationType(fromNode, toNode, type);
  if (!canConnectNodes(fromNode, toNode, resolvedType)) return false;
  const exists = state.edges.some((edge) => {
    if (edge.type !== resolvedType) return false;
    if (isUndirectedRelationType(resolvedType)) {
      return (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from);
    }
    return edge.from === from && edge.to === to;
  });
  if (exists) {
    showModelingNotice(`The ${edgeLabel(resolvedType)} relation already exists between these two elements.`);
    return false;
  }
  if (options.recordHistory !== false) recordHistory();
  state.edges.push({ id: `edge_${Date.now()}_${Math.floor(Math.random() * 1000)}`, from, to, type: resolvedType });
  state.findings = [];
  state.facts = [];
  applySmartLayout();
  return true;
}

function resolveRelationType(fromNode, toNode, preferredType) {
  if (fromNode?.type === "Relationship" || toNode?.type === "Relationship") {
    return RELATIONSHIP_RELATION_TYPES.includes(preferredType) ? preferredType : "depends";
  }
  if (canConnectNodes(fromNode, toNode, preferredType, { quiet: true })) return preferredType;
  const inferred = inferRelationTypeByEndpoints(fromNode, toNode);
  if (inferred) return inferred;
  return relationOptionsForNode(fromNode || {}, "out")
    .find((candidate) => canConnectNodes(fromNode, toNode, candidate, { quiet: true })) || preferredType;
}

function inferRelationTypeByEndpoints(fromNode, toNode) {
  if (!fromNode || !toNode) return "";
  if (fromNode.type === "Actor" && toNode.type === "Role") return "plays";
  if (fromNode.type === "Role" && toNode.type === "Task") return "executes";
  if (fromNode.type === "Role" && toNode.type === "Asset") return "possesses";
  if (fromNode.type === "Role" && toNode.type === "Role") return "subordinate";
  if (fromNode.type === "Task" && toNode.type === "Asset") return "needs";
  if ((fromNode.type === "Task" || fromNode.type === "Asset") && toNode.type === "Task") return "delegates";
  return "";
}

function canPlaceOnScenario(type, x, y, override = {}) {
  return Boolean(scenarioForBox(type, x, y, override));
}

function scenarioForBox(type, x, y, override = {}) {
  if (type === "Actor" || type === "Scenario") return null;
  const size = getNodeSize({ type, ...override });
  const center = { x: x + size.width / 2, y: y + size.height / 2 };
  return smallestScenarioContainingPoint(center);
}

function canConnectNodes(fromNode, toNode, type, options = {}) {
  const notice = (message) => {
    if (!options.quiet) showModelingNotice(message);
  };
  if (!fromNode || !toNode) return false;
  if (fromNode.type === "Relationship" || toNode.type === "Relationship") {
    const valid = RELATIONSHIP_RELATION_TYPES.includes(type);
    if (!valid) notice("Use one of the paper-supported relations when connecting relationships.");
    return valid;
  }
  if (fromNode.type === "Scenario" || toNode.type === "Scenario") {
    notice("Scenario is a background boundary. Connect the elements placed on top of it.");
    return false;
  }
  if (isModalRelationType(type)) {
    const endpointTypes = [fromNode.type, toNode.type];
    const valid = endpointTypes.includes("Role") && (endpointTypes.includes("Task") || endpointTypes.includes("Asset"));
    if (!valid) notice(`${edgeLabel(type)} should directly connect a Role with a Task or Asset.`);
    return valid;
  }
  if (type === "plays") {
    const valid = fromNode.type === "Actor" && toNode.type === "Role";
    if (!valid) notice("play must point from an Actor to a Role.");
    return valid;
  }
  if (type === "delegates") {
    const valid = (fromNode.type === "Task" || fromNode.type === "Asset") && toNode.type === "Task";
    if (!valid) notice("delegate must point from an Asset or Task to a Task.");
    return valid;
  }
  if (type === "depends") {
    const valid = fromNode.type === "Task" && toNode.type === "Asset";
    if (!valid) notice("depend must point from a Task to an Asset.");
    return valid;
  }
  if (type === "needs") {
    const valid = fromNode.type === "Task" && toNode.type === "Asset";
    if (!valid) notice("need must point from a Task to an Asset.");
    return valid;
  }
  if (type === "generates") {
    const valid = fromNode.type === "Task" && toNode.type === "Asset";
    if (!valid) notice("generate must point from a Task to an Asset.");
    return valid;
  }
  if (type === "executes") {
    const valid = fromNode.type === "Role" && toNode.type === "Task";
    if (!valid) notice("execute must point from a Role to a Task.");
    return valid;
  }
  if (type === "possesses" || type === "owns") {
    const valid = fromNode.type === "Role" && toNode.type === "Asset";
    if (!valid) notice(`${edgeLabel(type)} must point from a Role to an Asset.`);
    return valid;
  }
  if (type === "delegatePermission" || type === "delegateObligation") {
    const valid = fromNode.type === "Role" && toNode.type === "Role";
    if (!valid) notice(`${edgeLabel(type)} must point from a Role to another Role.`);
    return valid;
  }
  if (type === "appliesTo") {
    const valid = fromNode.type === "Constraint" && toNode.type === "Role";
    if (!valid) notice("appliesTo should connect a modal relationship to a Role.");
    return valid;
  }
  if (type === "constrains") {
    const valid = fromNode.type === "Constraint" && (toNode.type === "Task" || toNode.type === "Asset");
    if (!valid) notice("constrains should connect a modal relationship to a Task or Asset.");
    return valid;
  }
  if (fromNode.type === "Constraint" || toNode.type === "Constraint") {
    notice("Use appliesTo/constrains for modal relationship links.");
    return false;
  }
  return true;
}

function nodeOnScenario(node) {
  return Boolean(scenarioForNode(node));
}

function scenarioForNode(node) {
  if (!node || node.type === "Actor" || node.type === "Scenario") return null;
  const assigned = node?.scenarioId ? getNode(node.scenarioId) : null;
  if (assigned?.type === "Scenario") return assigned;
  return smallestScenarioContainingPoint(getNodeCenter(node));
}

function smallestScenarioContainingPoint(point) {
  return state.nodes
    .filter((scenario) => scenario.type === "Scenario" && pointInsideScenario(point, scenario))
    .sort((a, b) => {
      const aSize = getNodeSize(a);
      const bSize = getNodeSize(b);
      return aSize.width * aSize.height - bSize.width * bSize.height;
    })[0];
}

function assignScenarioMembership() {
  state.nodes.forEach((node) => {
    if (node.type === "Scenario") return;
    if (node.type === "Actor") {
      node.scenarioId = "";
      return;
    }
    const assigned = node.scenarioId ? getNode(node.scenarioId) : null;
    if (assigned?.type === "Scenario") return;
    node.scenarioId = scenarioForNode(node)?.id || "";
  });
}

function applySmartLayout() {
  assignScenarioMembership();
  resolveElementOverlaps();
  autoFitScenarios();
  resolveScenarioOverlaps();
  clampAllNodesToCanvas();
  autoFitScenarios();
  clampAllNodesToCanvas();
}

function autoFitScenarios() {
  state.nodes
    .filter((node) => node.type === "Scenario")
    .forEach((scenario) => fitScenarioToContents(scenario));
}

function fitScenarioToContents(scenario) {
  const members = state.nodes.filter((node) => node.type !== "Scenario" && node.scenarioId === scenario.id);
  if (!members.length) return;
  const bounds = members.reduce((acc, node) => {
    const size = getNodeSize(node);
    return {
      minX: Math.min(acc.minX, node.x),
      minY: Math.min(acc.minY, node.y),
      maxX: Math.max(acc.maxX, node.x + size.width),
      maxY: Math.max(acc.maxY, node.y + size.height)
    };
  }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

  const boundsLimit = canvasDimensions();
  const size = getNodeSize(scenario);
  const nextLeft = Math.min(scenario.x, bounds.minX - SCENARIO_PADDING);
  const nextTop = Math.min(scenario.y, bounds.minY - SCENARIO_PADDING);
  const nextRight = Math.max(scenario.x + size.width, bounds.maxX + SCENARIO_PADDING);
  const nextBottom = Math.max(scenario.y + size.height, bounds.maxY + SCENARIO_PADDING);
  scenario.x = Math.round(Math.max(CANVAS_MARGIN, nextLeft));
  scenario.y = Math.round(Math.max(CANVAS_MARGIN, nextTop));
  scenario.width = Math.min(Math.round(nextRight - scenario.x), boundsLimit.width - CANVAS_MARGIN * 2);
  scenario.height = Math.min(Math.round(nextBottom - scenario.y), boundsLimit.height - CANVAS_MARGIN * 2);
  clampScenarioGroupToCanvas(scenario);
}

function nodesInScenario(scenario) {
  return state.nodes.filter((node) => (
    scenario.type === "Scenario" &&
    scenario.id !== node.id &&
    node.type !== "Scenario" &&
    (node.scenarioId === scenario.id || pointInsideScenario(getNodeCenter(node), scenario))
  ));
}

function resolveElementOverlaps() {
  const movable = state.nodes.filter((node) => node.type !== "Scenario");
  for (let pass = 0; pass < 2; pass += 1) {
    movable.forEach((node, index) => {
      const others = movable.slice(0, index).concat(movable.slice(index + 1));
      const position = findNonOverlappingPosition(node, others, ELEMENT_GAP);
      node.x = position.x;
      node.y = position.y;
      clampNodeToCanvas(node);
    });
  }
}

function resolveScenarioOverlaps() {
  const scenarios = state.nodes.filter((node) => node.type === "Scenario");
  for (let pass = 0; pass < 4; pass += 1) {
    let moved = false;
    for (let i = 0; i < scenarios.length; i += 1) {
      for (let j = i + 1; j < scenarios.length; j += 1) {
        const first = scenarios[i];
        const second = scenarios[j];
        if (!rectsOverlap(expandedRect(first, SCENARIO_GAP), expandedRect(second, SCENARIO_GAP))) continue;
        const firstCenter = getNodeCenter(first);
        const secondCenter = getNodeCenter(second);
        const dx = secondCenter.x - firstCenter.x;
        const dy = secondCenter.y - firstCenter.y;
        const firstSize = getNodeSize(first);
        const secondSize = getNodeSize(second);
        const overlapX = (firstSize.width + secondSize.width) / 2 + SCENARIO_GAP - Math.abs(dx);
        const overlapY = (firstSize.height + secondSize.height) / 2 + SCENARIO_GAP - Math.abs(dy);
        const shift = overlapX < overlapY
          ? { x: (dx >= 0 ? 1 : -1) * Math.ceil(overlapX / 2), y: 0 }
          : { x: 0, y: (dy >= 0 ? 1 : -1) * Math.ceil(overlapY / 2) };
        moveScenarioGroup(second, shift.x, shift.y);
        clampScenarioGroupToCanvas(second);
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function moveScenarioGroup(scenario, dx, dy) {
  scenario.x += dx;
  scenario.y += dy;
  nodesInScenario(scenario).forEach((node) => {
    node.x += dx;
    node.y += dy;
  });
}

function clampScenarioGroupToCanvas(scenario) {
  const bounds = canvasDimensions();
  const size = getNodeSize(scenario);
  const nextX = clamp(scenario.x, CANVAS_MARGIN, bounds.width - size.width - CANVAS_MARGIN);
  const nextY = clamp(scenario.y, CANVAS_MARGIN, bounds.height - size.height - CANVAS_MARGIN);
  moveScenarioGroup(scenario, nextX - scenario.x, nextY - scenario.y);
}

function placeNodeAvoidingOverlap(node) {
  const others = node.type === "Scenario"
    ? state.nodes.filter((candidate) => candidate.type === "Scenario" && candidate.id !== node.id)
    : state.nodes.filter((candidate) => candidate.type !== "Scenario" && candidate.id !== node.id);
  const position = findNonOverlappingPosition(
    node,
    others,
    node.type === "Scenario" ? SCENARIO_GAP : ELEMENT_GAP
  );
  node.x = position.x;
  node.y = position.y;
  clampNodeToCanvas(node);
}

function findNonOverlappingPosition(node, others, gap) {
  const original = { x: node.x, y: node.y };
  const candidates = [{ x: node.x, y: node.y }];
  const step = 28;
  for (let radius = 1; radius <= 8; radius += 1) {
    candidates.push(
      { x: original.x + step * radius, y: original.y },
      { x: original.x - step * radius, y: original.y },
      { x: original.x, y: original.y + step * radius },
      { x: original.x, y: original.y - step * radius },
      { x: original.x + step * radius, y: original.y + step * radius },
      { x: original.x - step * radius, y: original.y + step * radius },
      { x: original.x + step * radius, y: original.y - step * radius },
      { x: original.x - step * radius, y: original.y - step * radius }
    );
  }
  const bounds = canvasDimensions();
  const size = getNodeSize(node);
  for (const candidate of candidates) {
    const test = {
      ...node,
      x: clamp(candidate.x, CANVAS_MARGIN, bounds.width - size.width - CANVAS_MARGIN),
      y: clamp(candidate.y, CANVAS_MARGIN, bounds.height - size.height - CANVAS_MARGIN)
    };
    if (!others.some((other) => rectsOverlap(expandedRect(test, gap), expandedRect(other, gap)))) {
      return { x: test.x, y: test.y };
    }
  }
  return {
    x: clamp(node.x, CANVAS_MARGIN, bounds.width - size.width - CANVAS_MARGIN),
    y: clamp(node.y, CANVAS_MARGIN, bounds.height - size.height - CANVAS_MARGIN)
  };
}

function clampAllNodesToCanvas() {
  state.nodes.forEach((node) => {
    if (node.type === "Scenario") {
      clampScenarioGroupToCanvas(node);
    } else {
      clampNodeToCanvas(node);
    }
  });
}

function clampNodeToCanvas(node) {
  const bounds = canvasDimensions();
  const size = getNodeSize(node);
  node.width = Math.min(size.width, bounds.width - CANVAS_MARGIN * 2);
  node.height = Math.min(size.height, bounds.height - CANVAS_MARGIN * 2);
  const nextSize = getNodeSize(node);
  node.x = clamp(Number(node.x) || CANVAS_MARGIN, CANVAS_MARGIN, bounds.width - nextSize.width - CANVAS_MARGIN);
  node.y = clamp(Number(node.y) || CANVAS_MARGIN, CANVAS_MARGIN, bounds.height - nextSize.height - CANVAS_MARGIN);
}

function canvasDimensions() {
  const zoom = state.zoom || 1;
  const content = diagramBounds(120);
  return {
    width: Math.max(Math.ceil((canvasWrap.clientWidth || 0) / zoom), content.right + CANVAS_MARGIN, CANVAS_MIN_WIDTH),
    height: Math.max(Math.ceil((canvasWrap.clientHeight || 0) / zoom), content.bottom + CANVAS_MARGIN, CANVAS_MIN_HEIGHT)
  };
}

function expandedRect(node, gap = 0) {
  const rect = nodeRect(node);
  return {
    left: rect.left - gap,
    top: rect.top - gap,
    right: rect.right + gap,
    bottom: rect.bottom + gap
  };
}

function nodeRect(node) {
  const size = getNodeSize(node);
  return {
    left: node.x,
    top: node.y,
    right: node.x + size.width,
    bottom: node.y + size.height
  };
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function showModelingNotice(message) {
  state.findings = [{
    threatType: "Modeling",
    riskLevel: "Notice",
    evidence: message,
    kind: "notice"
  }];
  render();
}

function getNode(id) {
  return state.nodes.find((node) => node.id === id);
}

function getEdge(id) {
  return state.edges.find((edge) => edge.id === id);
}

function getConnectable(id) {
  const node = getNode(id);
  if (node) return node;
  const edge = getEdge(id);
  if (!edge) return null;
  return {
    id: edge.id,
    type: "Relationship",
    name: edgeLabel(edge.type),
    relationType: edge.type,
    edge
  };
}

function getConnectableName(id) {
  const item = getConnectable(id);
  if (!item) return "Missing";
  return item.type === "Relationship" ? `Relationship: ${edgeLabel(item.relationType)}` : item.name;
}

function render() {
  applySmartLayout();
  syncCanvasView();
  renderNodes();
  renderEdges();
  renderSelectionBox();
  renderInspector();
  renderRelations();
  renderFindings();
  document.getElementById("nodeCount").textContent = state.nodes.length;
  document.getElementById("edgeCount").textContent = state.edges.length;
  document.getElementById("findingCount").textContent = state.findings.length;
  updateToolbarState();
}

function renderSelectionBox() {
  canvas.querySelector(".selection-box")?.remove();
  if (!state.selectionBox) return;
  const rect = selectionRectFromBox(state.selectionBox);
  const box = document.createElement("div");
  box.className = "selection-box";
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${Math.max(1, rect.right - rect.left)}px`;
  box.style.height = `${Math.max(1, rect.bottom - rect.top)}px`;
  canvas.appendChild(box);
}

function renderNodes() {
  canvas.innerHTML = "";
  orderedNodes().forEach((node) => {
    const element = document.createElement("div");
    element.className = `node ${node.type} ${constraintClass(node)}`;
    if (isNodeSelected(node.id)) element.classList.add("selected");
    if (node.id === state.connectSourceId) {
      element.classList.add(state.connectDirection === "in" ? "connect-target" : "connect-source");
    }
    const size = getNodeSize(node);
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    element.style.width = `${size.width}px`;
    element.style.height = `${size.height}px`;
    element.style.minHeight = `${size.height}px`;
    element.dataset.id = node.id;

    const title = document.createElement("div");
    title.className = "node-title";
    title.textContent = node.name;

    const meta = document.createElement("div");
    meta.className = "node-meta";
    meta.textContent = getNodeMeta(node);

    element.append(title);
    if (meta.textContent) element.appendChild(meta);
    element.addEventListener("dblclick", (event) => showModelingCatalog(event, node), { capture: true });
    element.addEventListener("pointerdown", (event) => handleNodePointerDown(event, node));
    canvas.appendChild(element);
  });
}

function showModelingCatalog(event, sourceNode) {
  if (!sourceNode) return;
  event.preventDefault();
  event.stopPropagation();
  closeModelingCatalog();

  const canvasRect = canvas.getBoundingClientRect();
  const catalog = document.createElement("div");
  const catalogHeight = Math.min(520, window.innerHeight - 16);
  catalog.className = "modeling-catalog";
  catalog.style.left = `${clamp(event.clientX, 8, Math.max(8, window.innerWidth - 348))}px`;
  catalog.style.top = `${clamp(event.clientY, 8, Math.max(8, window.innerHeight - catalogHeight - 8))}px`;

  const title = document.createElement("div");
  title.className = "catalog-title";
  title.textContent = sourceNode.type === "Scenario" ? "Scenario Contents" : singleLine(sourceNode.name);
  catalog.appendChild(title);

  if (sourceNode.type === "Scenario") {
    catalog.appendChild(buildCatalogSection(
      "Add Element",
      MODELING_ELEMENT_TYPES.map((type) => ({
        label: displayElementLabel(type),
        icon: elementIcon(type),
        action: () => {
          const position = positionInsideScenario(type, event, canvasRect, sourceNode);
          addNode(type, position.x, position.y);
          closeModelingCatalog();
        }
      }))
    ));
  } else {
    const sections = [];
    sections.push(buildCatalogSection(
      sourceNode.type === "Relationship" ? "Link Relationship" : "Create Relation",
      relationOptionsForNode(sourceNode, "out").map((type) => ({
        label: edgeLabel(type),
        icon: relationGlyph(type),
        action: () => beginRelationFromCatalog(type, sourceNode, "out")
      }))
    ));
    sections.push(buildCatalogSection(
      sourceNode.type === "Relationship" ? "Link Into Relationship" : "Create Incoming Relation",
      relationOptionsForNode(sourceNode, "in").map((type) => ({
        label: edgeLabel(type),
        icon: relationGlyph(type, true),
        action: () => beginRelationFromCatalog(type, sourceNode, "in")
      }))
    ));
    sections.forEach((section) => catalog.appendChild(section));
  }

  document.body.appendChild(catalog);
}

function showCanvasCatalog(event) {
  event.preventDefault();
  event.stopPropagation();
  closeModelingCatalog();

  const catalog = document.createElement("div");
  const catalogHeight = Math.min(520, window.innerHeight - 16);
  catalog.className = "modeling-catalog";
  catalog.style.left = `${clamp(event.clientX, 8, Math.max(8, window.innerWidth - 348))}px`;
  catalog.style.top = `${clamp(event.clientY, 8, Math.max(8, window.innerHeight - catalogHeight - 8))}px`;

  const title = document.createElement("div");
  title.className = "catalog-title";
  title.textContent = "Add Element";
  catalog.appendChild(title);
  catalog.appendChild(buildCatalogSection(
    "Elements",
    ["Role", "Actor", "Task", "Asset", "Scenario"].map((type) => ({
      label: displayElementLabel(type),
      icon: elementIcon(type),
      action: () => {
        const size = getNodeSize({ type });
        const point = canvasPointFromEvent(event);
        const position = snapPoint({
          x: point.x - size.width / 2,
          y: point.y - size.height / 2
        }, event.shiftKey);
        addNode(type, position.x, position.y);
        closeModelingCatalog();
      }
    }))
  ));
  document.body.appendChild(catalog);
}

function buildCatalogSection(title, items) {
  const section = document.createElement("section");
  section.className = "catalog-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const grid = document.createElement("div");
  grid.className = "catalog-grid";
  items.filter((item) => item.label).forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "catalog-item";
    button.innerHTML = `${item.icon}<span>${item.label}</span>`;
    button.addEventListener("click", item.action);
    grid.appendChild(button);
  });
  section.append(heading, grid);
  return section;
}

function closeModelingCatalog() {
  document.querySelector(".modeling-catalog")?.remove();
}

function relationOptions() {
  return VISIBLE_RELATION_TYPES;
}

function relationOptionsForNode(node, direction = "out") {
  if (node.type === "Relationship") return RELATIONSHIP_RELATION_TYPES;
  if (node.type === "Constraint") return ["appliesTo", "constrains"];
  if (node.type === "Actor") return direction === "out" ? ["plays", "trust"] : ["trust"];
  if (node.type === "Role") {
    return direction === "out"
      ? [...MODAL_RELATION_TYPES, "executes", "possesses", "owns", "delegatePermission", "delegateObligation", "subordinate", "authority", "trust", "externalCooperation"]
      : [...MODAL_RELATION_TYPES, "plays", "delegatePermission", "delegateObligation", "subordinate", "authority", "trust", "externalCooperation"];
  }
  if (node.type === "Task") {
    return direction === "out"
      ? ["needs", "generates", "depends", "delegates"]
      : [...MODAL_RELATION_TYPES, "executes", "needs", "generates", "depends", "delegates"];
  }
  if (node.type === "Asset") {
    return direction === "out"
      ? ["delegates"]
      : [...MODAL_RELATION_TYPES, "possesses", "owns", "needs", "generates", "depends"];
  }
  return relationOptions();
}

function beginRelationFromCatalog(type, node, direction) {
  relationType.value = type;
  state.connectMode = true;
  state.connectSourceId = node.id;
  state.connectDirection = direction;
  state.connectLockedType = true;
  state.selectedNodeId = node.type === "Relationship" ? null : node.id;
  state.selectedEdgeId = node.type === "Relationship" ? node.id : null;
  const relationText = isUndirectedRelationType(type)
    ? `${singleLine(node.name)} -- ${edgeLabel(type)} --`
    : `${singleLine(node.name)} -> ${edgeLabel(type)}`;
  state.findings = [{
    threatType: "Relation Modeling",
    riskLevel: "Ready",
    evidence: isUndirectedRelationType(type)
      ? `Click the other element for ${relationText}.`
      : direction === "in"
        ? `Click the source element for ${edgeLabel(type)} -> ${singleLine(node.name)}.`
        : `Click the target element for ${relationText}.`,
    kind: "ready"
  }];
  connectMode.classList.add("active");
  render();
  closeModelingCatalog();
}

function positionInsideScenario(type, event, canvasRect, scenario) {
  const size = getNodeSize({ type });
  const point = canvasPointFromEvent(event);
  const preferred = {
    x: point.x - size.width / 2,
    y: point.y - size.height / 2
  };
  const center = { x: preferred.x + size.width / 2, y: preferred.y + size.height / 2 };
  if (pointInsideScenario(center, scenario)) return preferred;
  return {
    x: scenario.x + getNodeSize(scenario).width / 2 - size.width / 2,
    y: scenario.y + getNodeSize(scenario).height / 2 - size.height / 2
  };
}

function elementIcon(type) {
  const classes = {
    Role: "mini-shape mini-role",
    Actor: "mini-shape mini-agent",
    Task: "mini-shape mini-task",
    Asset: "mini-shape mini-asset",
    Scenario: "mini-shape mini-scenario",
    Constraint: "mini-line",
    Relationship: "mini-shape mini-relationship"
  };
  const text = type === "Constraint" ? "M,P" : "";
  return `<span class="${classes[type]}">${text}</span>`;
}

function displayElementLabel(type) {
  if (type === "Relationship") return "Relationship";
  if (type === "Constraint") return "Modal Constraint";
  return type;
}

function relationGlyph(type, reverse = false) {
  if (isModalRelationType(type)) return "<span class=\"relation-glyph plain\" aria-hidden=\"true\"></span>";
  if (type === "externalCooperation") return "<span class=\"relation-glyph bidirectional\" aria-hidden=\"true\"></span>";
  return `<span class="relation-glyph ${reverse ? "arrow-start" : "arrow-end"}" aria-hidden="true"></span>`;
}

function renderEdges() {
  const dimensions = canvasDimensions();
  edgeLayer.setAttribute("width", dimensions.width);
  edgeLayer.setAttribute("height", dimensions.height);
  edgeLayer.innerHTML = "";
  const previousAnchors = new Map(edgeAnchors);
  edgeAnchors.clear();

  const defs = svg("defs");
  const arrow = svg("marker", {
    id: "arrow",
    viewBox: "0 0 10 10",
    markerWidth: "6.5",
    markerHeight: "6.5",
    refX: "8",
    refY: "5",
    orient: "auto",
    markerUnits: "strokeWidth"
  });
  arrow.appendChild(svg("path", { d: "M0,0 L0,10 L10,5 z", fill: "#111" }));
  const arrowStart = svg("marker", {
    id: "arrow-start",
    viewBox: "0 0 10 10",
    markerWidth: "6.5",
    markerHeight: "6.5",
    refX: "2",
    refY: "5",
    orient: "auto",
    markerUnits: "strokeWidth"
  });
  arrowStart.appendChild(svg("path", { d: "M10,0 L10,10 L0,5 z", fill: "#111" }));
  const diamond = svg("marker", {
    id: "diamond",
    viewBox: "0 0 10 10",
    markerWidth: "8",
    markerHeight: "8",
    refX: "9",
    refY: "5",
    orient: "auto",
    markerUnits: "strokeWidth"
  });
  diamond.appendChild(svg("path", { d: "M1,5 L5,1 L9,5 L5,9 z", fill: "#fff", stroke: "#111", "stroke-width": "1.3" }));
  defs.append(arrow, arrowStart, diamond);
  edgeLayer.appendChild(defs);

  const pairCounts = new Map();
  visibleEdges().forEach((edge) => {
    const key = edgePairKey(edge);
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  });
  const pairIndexes = new Map();
  const labelRects = [];

  visibleEdges().forEach((edge) => {
    const p1 = getEndpointPoint(edge.from, edge.to, previousAnchors);
    const p2 = getEndpointPoint(edge.to, edge.from, previousAnchors);
    if (!p1 || !p2) return;
    const key = edgePairKey(edge);
    const total = pairCounts.get(key) || 1;
    const used = pairIndexes.get(key) || 0;
    pairIndexes.set(key, used + 1);
    const offset = routedEdgeOffset(edge, p1, p2, (used - (total - 1) / 2) * 34);
    const path = curvedPath(p1, p2, offset);
    const kind = edgeCategory(edge.type);
    const pathAttrs = {
      d: path.d,
      fill: "none",
      stroke: "#111",
      "stroke-width": "2.1",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "vector-effect": "non-scaling-stroke",
      ...edgeMarkerAttrs(edge.type)
    };
    const dash = edgeDash(edge.type);
    if (dash) pathAttrs["stroke-dasharray"] = dash;
    edgeLayer.appendChild(svg("path", {
      ...pathAttrs
    }));
    const labelText = edgeLabel(edge.type);
    const autoLabelPosition = placeRelationshipLabel(edge, path, labelText, labelRects);
    const labelPosition = applyEdgeLabelOffset(edge, autoLabelPosition);
    edgeAnchors.set(edge.id, labelPosition);
    if (!labelText) return;
    const label = document.createElement("button");
    label.type = "button";
    label.className = `relationship-label kind-${kind}`;
    if (edge.id === state.selectedEdgeId) label.classList.add("selected");
    if (edge.id === state.connectSourceId) {
      label.classList.add(state.connectDirection === "in" ? "connect-target" : "connect-source");
    }
    label.dataset.edgeId = edge.id;
    label.style.left = `${labelPosition.x}px`;
    label.style.top = `${labelPosition.y}px`;
    label.title = isUndirectedRelationType(edge.type)
      ? `${getConnectableName(edge.from)} -- ${labelText} -- ${getConnectableName(edge.to)}`
      : `${getConnectableName(edge.from)} -> ${labelText} -> ${getConnectableName(edge.to)}`;
    label.textContent = labelText;
    label.addEventListener("pointerdown", (event) => handleRelationshipPointerDown(event, edge));
    label.addEventListener("dblclick", (event) => showModelingCatalog(event, getConnectable(edge.id)));
    canvas.appendChild(label);
  });
}

function renderInspector() {
  const node = getNode(state.selectedNodeId);
  nodeInspector.classList.toggle("hidden", !node);
  if (!node) return;

  nodeName.value = node.name || "";
  nodeType.value = node.type || "";
  modalType.value = node.modalType || "Obligation";
  polarity.value = node.polarity || "Positive";
  actionType.value = node.actionType || "Execute";
  awareness.value = node.awareness || "";
  complexity.value = node.complexity || "";
  const size = getNodeSize(node);
  nodeWidth.value = size.width;
  nodeHeight.value = size.height;
  description.value = node.description || "";

  document.querySelectorAll(".constraint-only").forEach((field) => {
    field.classList.toggle("hidden", node.type !== "Constraint");
  });
  document.querySelectorAll(".agent-only").forEach((field) => {
    field.classList.toggle("hidden", node.type !== "Actor");
  });
  document.querySelectorAll(".scenario-only").forEach((field) => {
    field.classList.toggle("hidden", node.type !== "Scenario");
  });
}

function renderRelations() {
  relationList.innerHTML = "";
  if (!state.edges.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state compact";
    empty.textContent = "No relations.";
    relationList.appendChild(empty);
    return;
  }
  state.edges.forEach((edge) => {
    const item = document.createElement("div");
    item.className = "relation-item";
    if (edge.id === state.selectedEdgeId) item.classList.add("selected");
    item.addEventListener("click", () => {
      state.selectedEdgeId = edge.id;
      clearNodeSelection();
      render();
    });
    const text = document.createElement("span");
    const connector = isUndirectedRelationType(edge.type) ? `--${edgeLabel(edge.type)}--` : `-${edgeLabel(edge.type)}->`;
    text.textContent = `${singleLine(getConnectableName(edge.from))} ${connector} ${singleLine(getConnectableName(edge.to))}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Remove";
    button.addEventListener("click", () => {
      recordHistory();
      state.edges = state.edges.filter((candidate) => (
        candidate.id !== edge.id &&
        candidate.from !== edge.id &&
        candidate.to !== edge.id
      ));
      edgeAnchors.delete(edge.id);
      state.findings = [];
      state.facts = [];
      render();
      saveState();
    });
    item.append(text, button);
    relationList.appendChild(item);
  });
}

function renderFindings() {
  findings.innerHTML = "";
  if (!state.findings.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No threat result yet. Run inference after building a scenario.";
    findings.appendChild(empty);
    return;
  }

  state.findings.forEach((finding) => {
    const card = document.createElement("div");
    card.className = `finding ${finding.kind || ""}`;
    if (finding.technique || finding.victimRole || finding.attacker || finding.asset) {
      const row = document.createElement("div");
      row.className = "threat-result-row";
      const grid = document.createElement("div");
      grid.className = "threat-grid";
      [
        ["Victim", finding.victimRole || ""],
        ["Attacker", finding.attacker || ""],
        ["Asset", finding.asset || ""],
        ["Technique", finding.technique || finding.threatType || ""]
      ].forEach(([label, value]) => {
        const labelEl = document.createElement("span");
        labelEl.textContent = label;
        const valueEl = document.createElement("strong");
        valueEl.textContent = value;
        grid.append(labelEl, valueEl);
      });
      row.appendChild(grid);
      if (finding.modalTrigger) {
        const tag = document.createElement("span");
        tag.className = `modal-trigger-tag ${modalTagClass(finding.modalTrigger)}`;
        tag.textContent = finding.modalTrigger;
        row.appendChild(tag);
      }
      card.appendChild(row);
      findings.appendChild(card);
      return;
    }
    const title = document.createElement("strong");
    title.textContent = [finding.threatType, finding.riskLevel].filter(Boolean).join(" - ");
    const body = document.createElement("p");
    body.textContent = finding.evidence;
    card.append(title, body);
    findings.appendChild(card);
  });
}

function handleNodePointerDown(event, node) {
  event.stopPropagation();
  if (event.detail >= 2) {
    showModelingCatalog(event, node);
    return;
  }
  if (state.connectMode) {
    setSelectedNodes([node.id]);
    if (!state.connectSourceId) {
      state.connectSourceId = node.id;
      state.findings = [{
        threatType: "Relation Modeling",
        riskLevel: "Ready",
        evidence: `Click the target element for ${singleLine(node.name)} -> ${edgeLabel(relationType.value)}.`,
        kind: "ready"
      }];
    } else {
      let created = false;
      if (state.connectDirection === "in") {
        created = addEdge(node.id, state.connectSourceId, relationType.value, { inferType: !state.connectLockedType });
      } else {
        created = addEdge(state.connectSourceId, node.id, relationType.value, { inferType: !state.connectLockedType });
      }
      if (created) {
        state.connectSourceId = null;
        state.connectDirection = "out";
        state.connectLockedType = false;
        state.connectMode = false;
        connectMode.classList.remove("active");
      } else {
        setSelectedNodes([state.connectSourceId]);
      }
      saveState();
    }
    render();
    return;
  }

  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    const selected = new Set(state.selectedNodeIds);
    if (selected.has(node.id)) selected.delete(node.id);
    else selected.add(node.id);
    setSelectedNodes([...selected]);
    render();
    return;
  }

  if (!isNodeSelected(node.id)) setSelectedNodes([node.id]);
  state.selectedEdgeId = null;

  const element = event.currentTarget;
  const point = canvasPointFromEvent(event);
  const dragIds = dragIdsForNode(node);
  state.dragNodeId = node.id;
  state.dragNodeIds = dragIds;
  state.dragOriginals = Object.fromEntries(dragIds.map((id) => {
    const item = getNode(id);
    return [id, { x: item.x, y: item.y }];
  }));
  state.dragOffset = {
    x: point.x - node.x,
    y: point.y - node.y
  };
  state.dragStart = { x: event.clientX, y: event.clientY };
  state.dragOriginal = { x: node.x, y: node.y };
  state.dragSnapshot = takeSnapshot();
  state.dragMoved = false;
  element.setPointerCapture(event.pointerId);
}

function handleRelationshipPointerDown(event, edge) {
  event.stopPropagation();
  state.selectedEdgeId = edge.id;
  clearNodeSelection();

  if (state.connectMode) {
    if (!state.connectSourceId) {
      state.connectSourceId = edge.id;
      state.findings = [{
        threatType: "Relationship Modeling",
        riskLevel: "Ready",
        evidence: `Click the target shape or relationship for ${edgeLabel(relationType.value)}.`,
        kind: "ready"
      }];
    } else {
      const created = state.connectDirection === "in"
        ? addEdge(edge.id, state.connectSourceId, relationType.value, { inferType: !state.connectLockedType })
        : addEdge(state.connectSourceId, edge.id, relationType.value, { inferType: !state.connectLockedType });
      if (created) {
        state.connectSourceId = null;
        state.connectDirection = "out";
        state.connectLockedType = false;
        state.connectMode = false;
        connectMode.classList.remove("active");
      }
      saveState();
    }
    render();
    return;
  }

  const point = canvasPointFromEvent(event);
  state.edgeLabelDrag = {
    edgeId: edge.id,
    startPoint: point,
    originalOffset: {
      x: Number(edge.labelOffset?.x) || 0,
      y: Number(edge.labelOffset?.y) || 0
    }
  };
  state.edgeLabelMoved = false;
  state.edgeLabelSnapshot = takeSnapshot();
}

function handleCanvasWheel(event) {
  if (!event.ctrlKey) return;
  const element = event.target.closest?.(".node");
  const node = element ? getNode(element.dataset.id) : getNode(state.selectedNodeId);
  if (!node) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.08 : 0.92;
  recordHistory();
  resizeNode(node, factor);
  setSelectedNodes([node.id]);
  state.findings = [];
  state.facts = [];
  render();
  saveState();
}

function resizeNode(node, factor) {
  const size = getNodeSize(node);
  const bounds = canvasDimensions();
  const nextWidth = clamp(Math.round(size.width * factor), 40, bounds.width - CANVAS_MARGIN * 2);
  const nextHeight = clamp(Math.round(size.height * factor), 30, bounds.height - CANVAS_MARGIN * 2);
  const center = getNodeCenter(node);
  node.width = nextWidth;
  node.height = nextHeight;
  node.x = center.x - nextWidth / 2;
  node.y = center.y - nextHeight / 2;
  clampNodeToCanvas(node);
}

function updateSelectedNode() {
  const node = getNode(state.selectedNodeId);
  if (!node) return;
  recordHistory();
  node.name = nodeName.value;
  node.modalType = modalType.value;
  node.polarity = polarity.value;
  node.actionType = actionType.value;
  node.awareness = node.type === "Actor" ? awareness.value : "";
  node.complexity = node.type === "Scenario" ? complexity.value : "";
  node.width = Number(nodeWidth.value) || getNodeSize(node).width;
  node.height = Number(nodeHeight.value) || getNodeSize(node).height;
  node.description = description.value;
  clampNodeToCanvas(node);
  state.findings = [];
  state.facts = [];
  render();
  saveState();
}

function getNodeMeta(node) {
  if (node.type === "Constraint") {
    return `${MODAL_CODE[node.modalType] || "M"},${POLARITY_CODE[node.polarity] || "P"}`;
  }
  if (node.type === "Scenario" && node.complexity) return `complexity_level: ${node.complexity.toLowerCase()}`;
  return "";
}

function routedEdgeOffset(edge, p1, p2, baseOffset) {
  if (isInternalConstraintEdge(edge)) return baseOffset;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const midpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const obstacle = state.nodes
    .filter((node) => node.id !== edge.from && node.id !== edge.to && node.type !== "Scenario" && node.type !== "Constraint")
    .map((node) => expandedRect(node, 18))
    .find((rect) => segmentIntersectsRect(p1, p2, rect));
  if (!obstacle) return baseOffset;
  const obstacleCenter = {
    x: (obstacle.left + obstacle.right) / 2,
    y: (obstacle.top + obstacle.bottom) / 2
  };
  const side = ((obstacleCenter.x - midpoint.x) * normal.x + (obstacleCenter.y - midpoint.y) * normal.y) >= 0 ? -1 : 1;
  return baseOffset + side * 64;
}

function segmentIntersectsRect(p1, p2, rect) {
  if (pointInRect(p1, rect) || pointInRect(p2, rect)) return true;
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom }
  ];
  return corners.some((corner, index) => segmentsIntersect(p1, p2, corner, corners[(index + 1) % corners.length]));
}

function pointInRect(point, rect) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function segmentsIntersect(a, b, c, d) {
  const direction = (p, q, r) => ((r.x - p.x) * (q.y - p.y)) - ((q.x - p.x) * (r.y - p.y));
  const d1 = direction(c, d, a);
  const d2 = direction(c, d, b);
  const d3 = direction(a, b, c);
  const d4 = direction(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function edgeLabelSize(type, labelText = edgeLabel(type)) {
  if (!labelText) return { width: 18, height: 18 };
  return {
    width: Math.min(170, Math.max(32, labelText.length * 7 + 12)),
    height: 22
  };
}

function placeRelationshipLabel(edge, path, labelText, placedRects) {
  const size = edgeLabelSize(edge.type, labelText);
  if (isModalRelationType(edge.type)) {
    placedRects.push(rectFromCenter(path.label, size, 5));
    return path.label;
  }
  const normal = path.normal || { x: 0, y: -1 };
  const tangent = path.tangent || { x: 1, y: 0 };
  const candidates = [
    { x: path.label.x, y: path.label.y },
    { x: path.label.x + normal.x * 24, y: path.label.y + normal.y * 24 },
    { x: path.label.x - normal.x * 24, y: path.label.y - normal.y * 24 },
    { x: path.label.x + normal.x * 44, y: path.label.y + normal.y * 44 },
    { x: path.label.x - normal.x * 44, y: path.label.y - normal.y * 44 },
    { x: path.label.x + tangent.x * 34, y: path.label.y + tangent.y * 34 },
    { x: path.label.x - tangent.x * 34, y: path.label.y - tangent.y * 34 }
  ];
  const obstacles = labelAvoidanceRects(edge);
  const best = candidates.find((candidate) => {
    const rect = rectFromCenter(candidate, size, 5);
    return !obstacles.some((obstacle) => rectsOverlap(rect, obstacle)) &&
      !placedRects.some((placed) => rectsOverlap(rect, placed));
  }) || candidates[0];
  placedRects.push(rectFromCenter(best, size, 5));
  return best;
}

function applyEdgeLabelOffset(edge, point) {
  const offset = edge.labelOffset || { x: 0, y: 0 };
  return {
    x: point.x + (Number(offset.x) || 0),
    y: point.y + (Number(offset.y) || 0)
  };
}

function labelAvoidanceRects(edge) {
  return state.nodes
    .filter((node) => node.type !== "Scenario" && node.type !== "Constraint")
    .map((node) => expandedRect(node, 8));
}

function rectFromCenter(point, size, padding = 0) {
  return {
    left: point.x - size.width / 2 - padding,
    top: point.y - size.height / 2 - padding,
    right: point.x + size.width / 2 + padding,
    bottom: point.y + size.height / 2 + padding
  };
}

function edgeMarkerAttrs(type) {
  if (isModalRelationType(type)) return {};
  if (isInternalConstraintEdge({ type })) return {};
  if (type === "needs") return { "marker-end": "url(#diamond)" };
  if (type === "externalCooperation") {
    return { "marker-start": "url(#arrow-start)", "marker-end": "url(#arrow)" };
  }
  return { "marker-end": "url(#arrow)" };
}

function isInternalConstraintEdge(edge) {
  return edge.type === "appliesTo" || edge.type === "constrains";
}

function visibleEdges() {
  return state.edges;
}

function singleLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function svgAttrs(attrs) {
  return Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${value}"`)
    .join("");
}

function constraintClass(node) {
  if (node.type !== "Constraint") return "";
  const modal = String(node.modalType || "Obligation").toLowerCase();
  const polarityValue = String(node.polarity || "Positive").toLowerCase();
  return `modal-${modal} polarity-${polarityValue}`;
}

function orderedNodes() {
  const rank = { Scenario: 0, Constraint: 3 };
  return [...state.nodes].sort((a, b) => (rank[a.type] ?? 2) - (rank[b.type] ?? 2));
}

function edgePairKey(edge) {
  return [edge.from, edge.to].sort().join("|");
}

function curvedPath(p1, p2, offset) {
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const cx = mx + nx * offset;
  const cy = my + ny * offset;
  return {
    d: `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`,
    label: {
      x: (p1.x + 2 * cx + p2.x) / 4,
      y: (p1.y + 2 * cy + p2.y) / 4
    },
    normal: { x: nx, y: ny },
    tangent: { x: dx / length, y: dy / length }
  };
}

async function validateModel() {
  const response = await postApi("/api/validate", { model: getModelPayload() });
  if (response) {
    state.findings = response.findings || [];
    state.facts = buildFacts(false);
    render();
    saveState();
    return;
  }

  const messages = [];
  const roles = state.nodes.filter((node) => node.type === "Role");
  const assets = state.nodes.filter((node) => node.type === "Asset");
  const constraints = state.nodes.filter((node) => node.type === "Constraint");
  const hasModalRelationships = constraints.length || state.edges.some((edge) => isModalRelationType(edge.type));
  const hasActorPlayRole = state.edges.some((edge) => {
    if (edge.type !== "plays") return false;
    const from = getNode(edge.from);
    const to = getNode(edge.to);
    return from?.type === "Actor" && to?.type === "Role";
  });

  if (!roles.length) messages.push("Add at least one Role.");
  if (roles.length < 2) messages.push("Add at least two Roles so one can be evaluated as attacker and another as victim.");
  if (!hasActorPlayRole) messages.push("Connect an Actor to the Role being evaluated with play.");
  if (!assets.length) messages.push("Add at least one Asset.");
  if (!hasModalRelationships) messages.push("Add at least one modal relationship.");
  constraints.forEach((constraint) => {
    if (!connected(constraint.id, "appliesTo").length) {
      messages.push(`${constraint.name} should connect to a Role with appliesTo.`);
    }
    if (!connected(constraint.id, "constrains").length) {
      messages.push(`${constraint.name} should connect to a Task or Asset with constrains.`);
    }
  });
  if (!state.edges.length) messages.push("Add relations between modeling elements.");

  state.facts = buildFacts(false);
  state.findings = messages.length
    ? messages.map((message) => ({ threatType: "Model Validation", riskLevel: "Notice", evidence: message, kind: "notice" }))
    : [{ threatType: "Model Validation", riskLevel: "Ready", evidence: "The model contains the required roles, assets, modal relationships, and relations.", kind: "ready" }];
  render();
  saveState();
}

async function runScenarioInference() {
  const response = await postApi("/api/infer", {
    model: getModelPayload(),
    includeScenarioRules: true,
    saveResult: true,
    modelName: "Scenario Inference"
  });
  if (response) {
    state.facts = response.facts || [];
    state.findings = [
      {
        threatType: "Scenario Inference",
        riskLevel: "Complete",
        evidence: `${state.facts.length} facts are available after applying backend scenario inference rules. Result ID: ${response.resultId || "unsaved"}`,
        kind: "ready"
      }
    ];
    render();
    saveState();
    return;
  }

  state.facts = buildFacts(true);
  state.findings = [
    {
      threatType: "Scenario Inference",
      riskLevel: "Complete",
      evidence: `${state.facts.length} facts are available after applying local scenario inference rules.`,
      kind: "ready"
    }
  ];
  render();
  saveState();
}

async function runThreatDetection() {
  const response = await postApi("/api/infer", {
    model: getModelPayload(),
    includeScenarioRules: true,
    saveResult: true,
    modelName: "Threat Detection"
  });
  if (response) {
    state.facts = response.facts || [];
    const backendFindings = dedupeThreatFindings(response.findings || []);
    state.findings = backendFindings.length
      ? backendFindings
      : [{ threatType: "Threat Detection", riskLevel: "None", evidence: `No backend threat rule matched the current model. Result ID: ${response.resultId || "unsaved"}`, kind: "ready" }];
    if (response.resultId && state.findings.length) {
      state.findings[0].evidence += ` Result ID: ${response.resultId}.`;
    }
    render();
    saveState();
    return;
  }

  state.facts = buildFacts(true);
  const result = dedupeThreatFindings(detectThreats(state.facts));
  state.findings = result.length
    ? result
    : [{ threatType: "Threat Detection", riskLevel: "None", evidence: "No local threat rule matched the current model.", kind: "ready" }];
  render();
  saveState();
}

function dedupeThreatFindings(items) {
  const seenTechniques = new Set();
  return items.filter((item) => {
    const technique = item.technique || (item.kind === "threat" ? item.threatType : "");
    if (!technique) return true;
    if (seenTechniques.has(technique)) return false;
    seenTechniques.add(technique);
    return true;
  });
}

function buildFacts(includeScenarioRules) {
  const store = new Map();
  const add = (predicate, args, source) => {
    const fact = { predicate, args, source };
    store.set(`${predicate}(${args.join(",")})`, fact);
  };

  state.nodes.forEach((node) => {
    add("node", [node.id, node.type], "Model");
    if (node.type === "Actor" && node.awareness) {
      add("has_security_awareness", [node.id, levelCode(node.awareness)], "Model");
    }
    if (node.type === "Scenario" && node.complexity) {
      add("scene", [node.id, levelCode(node.complexity)], "Model");
    }
  });

  state.edges.forEach((edge) => {
    if (isModalRelationType(edge.type)) return;
    const from = getNode(edge.from);
    const to = getNode(edge.to);
    if (!from || !to) return;
    add(relationPredicate(edge.type), [edge.from, edge.to], "Model");
  });

  state.edges
    .filter((edge) => isModalRelationType(edge.type))
    .forEach((edge) => {
      const modal = modalRelationFact(edge);
      if (!modal) return;
      add(modal.predicate, [modal.role.id, modal.action, modal.target.id], modal.source);
      add(modal.predicate, [modal.role.id, modal.target.id], modal.source);
      if (modal.punish) add("punishment", [modal.role.id, modal.target.id], modal.source);
    });

  state.edges
    .filter((edge) => edge.type === "plays")
    .forEach((edge) => {
      const from = getNode(edge.from);
      const to = getNode(edge.to);
      const agent = from?.type === "Actor" ? from : to?.type === "Actor" ? to : null;
      const role = from?.type === "Role" ? from : to?.type === "Role" ? to : null;
      if (agent?.awareness && role) add("has_security_awareness", [role.id, levelCode(agent.awareness)], "Model");
    });
  state.nodes.filter((node) => node.type === "Constraint").forEach((constraint) => {
    const roles = connected(constraint.id, "appliesTo").filter((node) => node.type === "Role");
    const targets = connected(constraint.id, "constrains").filter((node) => node.type === "Task" || node.type === "Asset");
    roles.forEach((role) => {
      targets.forEach((target) => {
        const modal = modalPredicate(constraint);
        const action = (constraint.actionType || (target.type === "Task" ? "Execute" : "Possess")).toLowerCase();
        add(modal, [role.id, action, target.id], `Constraint:${constraint.name}`);
        add(modal, [role.id, target.id], `Constraint:${constraint.name}`);
        if (isUncertainConstraint(constraint)) {
          add("uncertain_constraint", [role.id, target.id], `Constraint:${constraint.name}`);
        }
      });
    });
  });

  if (includeScenarioRules) applyScenarioRules(store, add);
  return Array.from(store.values()).sort((a, b) => formatFact(a).localeCompare(formatFact(b)));
}

function applyScenarioRules(store, add) {
  let changed = true;
  let guard = 0;
  while (changed && guard < 8) {
    changed = false;
    guard += 1;
    const before = store.size;
    const all = Array.from(store.values());

    all.filter((fact) => fact.predicate === "subordinate").forEach((first) => {
      all.filter((fact) => fact.predicate === "subordinate" && fact.args[0] === first.args[1]).forEach((second) => {
        add("subordinate", [first.args[0], second.args[1]], "SR1");
      });
    });

    modalFacts(all).forEach((fact) => {
      const [role, actionOrObject, maybeObject] = fact.args;
      if (modalPredicateIs(fact.predicate, "M", "p")) {
        add(derivedModalPredicate(fact, "S", "p"), [role, actionOrObject, maybeObject].filter(Boolean), "SR2-SR3");
        addPunishmentForDerived(all, add, role, maybeObject || actionOrObject, role, maybeObject || actionOrObject, "SR2-SR3");
      }
      if (modalPredicateIs(fact.predicate, "S", "p")) {
        add(derivedModalPredicate(fact, "C", "p"), [role, actionOrObject, maybeObject].filter(Boolean), "SR4-SR5");
        addPunishmentForDerived(all, add, role, maybeObject || actionOrObject, role, maybeObject || actionOrObject, "SR4-SR5");
      }
      if (modalPredicateIs(fact.predicate, "Sh", "p")) {
        add(derivedModalPredicate(fact, "S", "p"), [role, actionOrObject, maybeObject].filter(Boolean), "SR13-SR14");
        add(derivedModalPredicate(fact, "C", "p"), [role, actionOrObject, maybeObject].filter(Boolean), "SR11-SR12");
        addPunishmentForDerived(all, add, role, maybeObject || actionOrObject, role, maybeObject || actionOrObject, "SR13-SR14");
        addPunishmentForDerived(all, add, role, maybeObject || actionOrObject, role, maybeObject || actionOrObject, "SR11-SR12");
      }
    });

    factsBy("ownership", all).concat(factsBy("owns", all), factsBy("possesses", all)).forEach((fact) => {
      const predicate = modalPredicateFromParts("S", "p");
      add(predicate, [fact.args[0], "possess", fact.args[1]], "SR10");
      add(predicate, [fact.args[0], fact.args[1]], "SR10");
    });

    modalFacts(all)
      .filter((fact) => fact.args.length === 3 && fact.args[1] === "execute" && (modalPredicateIs(fact.predicate, "M", "p") || modalPredicateIs(fact.predicate, "S", "p")))
      .forEach((fact) => {
        factsBy("need", all).concat(factsBy("generate", all), factsBy("needs", all), factsBy("generates", all), factsBy("depend", all)).forEach((dependency) => {
          if (dependency.args[0] === fact.args[2]) {
            const predicate = derivedModalPredicate(fact, "S", "p");
            add(predicate, [fact.args[0], "possess", dependency.args[1]], "SR6-SR9");
            add(predicate, [fact.args[0], dependency.args[1]], "SR6-SR9");
            addPunishmentForDerived(all, add, fact.args[0], fact.args[2], fact.args[0], dependency.args[1], "SR6-SR9");
          }
        });
      });

    modalFacts(all).forEach((fact) => {
      if (fact.args.length < 3) return;
      const [sourceRole, action, object] = fact.args;
      factsBy("delegatePermission", all).concat(factsBy("delegates", all)).forEach((delegation) => {
        if (delegation.args[0] === sourceRole && modalPredicateIsPositive(fact.predicate) && !modalPredicateIs(fact.predicate, "M", "p")) {
          const predicate = derivedModalPredicate(fact, "S", "p");
          add(predicate, [delegation.args[1], action, object], "SR15-SR17");
          add(predicate, [delegation.args[1], object], "SR15-SR17");
          addPunishmentForDerived(all, add, sourceRole, object, delegation.args[1], object, "SR15-SR17");
        }
      });
      factsBy("delegateObligation", all).forEach((delegation) => {
        if (delegation.args[0] === sourceRole && modalPredicateIs(fact.predicate, "M", "p")) {
          const predicate = derivedModalPredicate(fact, "M", "p");
          add(predicate, [delegation.args[1], action, object], "SR16-SR18");
          add(predicate, [delegation.args[1], object], "SR16-SR18");
          addPunishmentForDerived(all, add, sourceRole, object, delegation.args[1], object, "SR16-SR18");
        }
      });
    });

    changed = store.size > before;
  }
}

function detectThreats(allFacts) {
  const result = [];
  const seen = new Set();
  const roles = state.nodes.filter((node) => node.type === "Role");
  const victims = playedVictimRoles(allFacts);
  const assets = state.nodes.filter((node) => node.type === "Asset");
  const globalLowScene = state.nodes.some((node) => node.type === "Scenario" && node.complexity === "Low");
  const globalHighScene = state.nodes.some((node) => node.type === "Scenario" && node.complexity === "High");

  const push = (technique, victim, attacker, asset, ruleId, modalTrigger = "") => {
    const key = technique;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      threatType: technique,
      riskLevel: "",
      evidence: "",
      ruleId,
      kind: "threat",
      victimRole: victim.name,
      attacker: attacker.name,
      asset: asset.name,
      technique,
      modalTrigger
    });
  };

  victims.forEach((victim) => {
    roles.forEach((attacker) => {
      if (attacker.id === victim.id) return;
      const awarenessLevel = awarenessForRole(victim.id, allFacts);
      const relationPressure = hasFact(allFacts, "authority", attacker.id, victim.id) ||
        hasFact(allFacts, "subordinate", attacker.id, victim.id) ||
        hasFact(allFacts, "subordinate", victim.id, attacker.id);
      const trustPressure = hasFact(allFacts, "trust", victim.id, attacker.id) ||
        hasFact(allFacts, "trust", attacker.id, victim.id);
      const cooperation = hasAnyFact(allFacts, ["ex_cooperation", "externalCooperation"], attacker.id, victim.id) ||
        hasAnyFact(allFacts, ["ex_cooperation", "externalCooperation"], victim.id, attacker.id);
      const sceneLevels = sceneLevelsFor(victim.id);
      const hasLowScene = sceneLevels.includes("Low") || (!sceneLevels.length && globalLowScene);
      const hasHighScene = sceneLevels.includes("High") || (!sceneLevels.length && globalHighScene);

      assets.forEach((asset) => {
        const victimOwnsAsset = hasAnyFact(allFacts, ["ownership", "owns", "possesses"], victim.id, asset.id) ||
          hasModal(allFacts, victim.id, "possess", asset.id, OWNERSHIP_MODAL_PREDICATES);
        const attackerAccess = hasModal(allFacts, attacker.id, "possess", asset.id, POSITIVE_ACCESS_MODAL_PREDICATES);
        const victimAccess = hasModal(allFacts, victim.id, "possess", asset.id, POSITIVE_ACCESS_MODAL_PREDICATES);
        const negativeBoundary = hasModal(allFacts, attacker.id, "possess", asset.id, NEGATIVE_BOUNDARY_MODAL_PREDICATES);
        const recommendationAmbiguity = hasModal(allFacts, victim.id, "possess", asset.id, RECOMMENDATION_MODAL_PREDICATES);
        const victimAccessModal = modalTriggerFor(allFacts, victim.id, "possess", asset.id, POSITIVE_ACCESS_MODAL_PREDICATES);
        const attackerAccessModal = modalTriggerFor(allFacts, attacker.id, "possess", asset.id, POSITIVE_ACCESS_MODAL_PREDICATES);
        const negativeBoundaryModal = modalTriggerFor(allFacts, attacker.id, "possess", asset.id, NEGATIVE_BOUNDARY_MODAL_PREDICATES);
        const recommendationModal = modalTriggerFor(allFacts, victim.id, "possess", asset.id, RECOMMENDATION_MODAL_PREDICATES);
        if (relationPressure && victimAccess) {
          push("Intimidation", victim, attacker, asset, "TR-INT", victimAccessModal);
        }
        if ((trustPressure || relationPressure || cooperation) && attackerAccess && victimAccess) {
          push("Impersonation", victim, attacker, asset, "TR-IMP", joinModalTriggers([attackerAccessModal, victimAccessModal]));
        }
        if (victimOwnsAsset && awarenessLevel !== "High") {
          push("Shoulder Surfing", victim, attacker, asset, "TR-SS", victimAccessModal);
        }
        if (victimAccess && (hasLowScene || awarenessLevel === "Low")) {
          push("Tailgating", victim, attacker, asset, "TR-TG", victimAccessModal);
        }
        if (victimOwnsAsset && ["Low", "Medium"].includes(awarenessLevel)) {
          push("Dumpster Diving", victim, attacker, asset, "TR-DD", victimAccessModal);
        }
        if (recommendationAmbiguity && (trustPressure || cooperation)) {
          push("Incentive", victim, attacker, asset, "TR-INC", recommendationModal);
        }
        if ((relationPressure || cooperation) && hasGeneratedAsset(allFacts, victim.id, asset.id)) {
          push("Responsibility", victim, attacker, asset, "TR-RES", victimAccessModal || taskModalTriggerFor(allFacts, victim.id, asset.id));
        }
        if (negativeBoundary && victimOwnsAsset && hasHighScene) {
          push("Distraction", victim, attacker, asset, "TR-DIS", negativeBoundaryModal);
        }
      });
    });
  });

  return result;
}

function playedVictimRoles(allFacts) {
  const roleIds = new Set();
  allFacts
    .filter((fact) => fact.predicate === "play" && fact.args.length >= 2)
    .forEach((fact) => {
      const first = getNode(fact.args[0]);
      const second = getNode(fact.args[1]);
      if (first?.type === "Actor" && second?.type === "Role") roleIds.add(second.id);
      if (first?.type === "Role" && second?.type === "Actor") roleIds.add(first.id);
    });
  return [...roleIds].map((id) => getNode(id)).filter(Boolean);
}

function connected(nodeId, type) {
  return state.edges
    .filter((edge) => edge.type === type && (edge.from === nodeId || edge.to === nodeId))
    .map((edge) => getNode(edge.from === nodeId ? edge.to : edge.from))
    .filter(Boolean);
}

function modalRelationFact(edge) {
  const meta = MODAL_RELATION_META[edge.type];
  if (!meta) return null;
  const first = getNode(edge.from);
  const second = getNode(edge.to);
  if (!first || !second) return null;
  const role = first.type === "Role" ? first : second.type === "Role" ? second : null;
  const target = first.type === "Task" || first.type === "Asset"
    ? first
    : second.type === "Task" || second.type === "Asset"
      ? second
      : null;
  if (!role || !target) return null;
  return {
    role,
    target,
    action: target.type === "Task" ? "execute" : "possess",
    predicate: modalPredicateFromParts(meta.modal, meta.polarity),
    punish: meta.punish,
    source: `Relationship:${meta.label}`
  };
}

function modalFacts(all) {
  return all.filter((fact) => fact.predicate.startsWith("modal_constraint_"));
}

function modalPredicateSet(items) {
  return items.map(([modal, polarity]) => modalPredicateFromParts(modal, polarity));
}

function parseModalPredicate(predicate) {
  const match = /^modal_constraint_(M|S|Sh|C)_([pnu])(?:_y)?$/.exec(predicate);
  if (!match) return null;
  const legacyUncertain = match[2] === "u";
  return {
    modal: match[1],
    polarity: legacyUncertain ? "p" : match[2],
    legacyPunish: legacyUncertain || predicate.endsWith("_y")
  };
}

function modalPredicateIs(predicate, modal, polarity) {
  const parsed = parseModalPredicate(predicate);
  return Boolean(parsed && parsed.modal === modal && parsed.polarity === polarity);
}

function modalPredicateIsPositive(predicate) {
  const parsed = parseModalPredicate(predicate);
  return Boolean(parsed && parsed.polarity === "p");
}

function derivedModalPredicate(fact, modal, polarity) {
  return modalPredicateFromParts(modal, polarity);
}

function factsBy(predicate, all) {
  return all.filter((fact) => fact.predicate === predicate);
}

function hasFact(all, predicate, first, second) {
  return all.some((fact) => fact.predicate === predicate && fact.args[0] === first && fact.args[1] === second);
}

function hasAnyFact(all, predicates, first, second) {
  return predicates.some((predicate) => hasFact(all, predicate, first, second));
}

function hasPunishment(all, role, target) {
  return all.some((fact) => fact.predicate === "punishment" && fact.args[0] === role && fact.args[1] === target);
}

function addPunishmentForDerived(all, add, sourceRole, sourceTarget, targetRole, targetTarget, source) {
  if (hasPunishment(all, sourceRole, sourceTarget)) {
    add("punishment", [targetRole, targetTarget], source);
  }
}

function modalTriggerFor(all, role, action, object, predicates) {
  const matches = all.filter((fact) =>
    predicates.includes(fact.predicate) &&
    fact.args[0] === role &&
    (
      (fact.args.length === 3 && fact.args[1] === action && fact.args[2] === object) ||
      (fact.args.length === 2 && fact.args[1] === object)
    )
  );
  const match = selectModalTriggerFact(matches);
  return match ? modalLabelForTrigger(all, match) : "";
}

function taskModalTriggerFor(all, role, asset) {
  const taskIds = all
    .filter((fact) => ["need", "generate", "depend", "needs", "generates", "depends"].includes(fact.predicate) && fact.args[1] === asset)
    .map((fact) => fact.args[0]);
  const matches = modalFacts(all).filter((fact) =>
    fact.args.length === 3 &&
    fact.args[0] === role &&
    fact.args[1] === "execute" &&
    taskIds.includes(fact.args[2])
  );
  const match = selectModalTriggerFact(matches);
  return match ? modalLabelForTrigger(all, match) : "";
}

function selectModalTriggerFact(matches) {
  if (!matches.length) return null;
  const relationship = matches.find((fact) => (fact.source || "").startsWith("Relationship:"));
  if (relationship) return relationship;
  const rank = { M: 0, Sh: 1, S: 2, C: 3 };
  return [...matches].sort((first, second) => {
    const a = parseModalPredicate(first.predicate);
    const b = parseModalPredicate(second.predicate);
    return (rank[a?.modal] ?? 9) - (rank[b?.modal] ?? 9);
  })[0];
}

function modalLabelFromFact(fact) {
  const source = fact.source || "";
  if (source.startsWith("Relationship:")) {
    return modalLabelFromCode(source.replace("Relationship:", ""));
  }
  return modalLabelFromPredicate(fact.predicate);
}

function modalLabelForTrigger(all, fact) {
  const parsed = parseModalPredicate(fact.predicate);
  if (!parsed) return "";
  return modalDisplayLabel(parsed);
}

function modalLabelFromCode(label) {
  const parts = String(label || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return label;
  return modalDisplayLabel({
    modal: parts[0]
  });
}

function modalLabelFromPredicate(predicate) {
  const parsed = parseModalPredicate(predicate);
  return parsed ? modalDisplayLabel(parsed) : "";
}

function modalDisplayLabel({ modal }) {
  return MODAL_NAME[modal] || modal;
}

function modalTagClass(value) {
  return value === "Ability" || value === "Recommendation" ? "modal-negative" : "modal-positive";
}

function joinModalTriggers(values) {
  return [...new Set(values.filter(Boolean))].join(" / ");
}

function hasModal(all, role, action, object, predicates) {
  return all.some((fact) =>
    predicates.includes(fact.predicate) &&
    fact.args[0] === role &&
    (
      (fact.args.length === 3 && fact.args[1] === action && fact.args[2] === object) ||
      (fact.args.length === 2 && fact.args[1] === object)
    )
  );
}

function hasGeneratedAsset(all, role, asset) {
  const taskIds = modalFacts(all)
    .filter((fact) => fact.args.length === 3 && fact.args[0] === role && fact.args[1] === "execute" && modalPredicateIsPositive(fact.predicate))
    .map((fact) => fact.args[2]);
  return all.some((fact) =>
    ["need", "generate", "depend", "needs", "generates", "depends"].includes(fact.predicate) &&
    taskIds.includes(fact.args[0]) &&
    fact.args[1] === asset
  );
}

function awarenessForRole(roleId, all) {
  const fact = all.find((candidate) => candidate.predicate === "has_security_awareness" && candidate.args[0] === roleId);
  if (!fact) return "Medium";
  const levels = { h: "High", m: "Medium", l: "Low" };
  return levels[fact.args[1]] || "Medium";
}

function sceneLevelsFor(nodeId) {
  const node = getNode(nodeId);
  if (!node) return [];
  const center = getNodeCenter(node);
  return state.nodes
    .filter((candidate) => candidate.type === "Scenario" && candidate.complexity && pointInsideScenario(center, candidate))
    .map((scenario) => scenario.complexity);
}

function pointInsideScenario(point, scenario) {
  const size = getNodeSize(scenario);
  const cx = scenario.x + size.width / 2;
  const cy = scenario.y + size.height / 2;
  const rx = size.width / 2;
  const ry = size.height / 2;
  if (rx <= 0 || ry <= 0) return false;
  return ((point.x - cx) ** 2) / (rx ** 2) + ((point.y - cy) ** 2) / (ry ** 2) <= 1;
}

function levelCode(value) {
  return String(value || "").toLowerCase().slice(0, 1);
}

function formatFact(fact) {
  const names = fact.args.map((id) => getNode(id)?.name || id);
  return `${fact.predicate}(${names.join(", ")})`;
}

function getNodeSize(node) {
  const fallback = typeDefaults[node.type] || { width: 132, height: 72 };
  return {
    width: Number(node.width) || fallback.width || 132,
    height: Number(node.height) || fallback.height || 72
  };
}

function getNodeCenter(node) {
  const size = getNodeSize(node);
  return { x: node.x + size.width / 2, y: node.y + size.height / 2 };
}

function getConnectionPoint(id, previousAnchors = edgeAnchors, seen = new Set()) {
  const node = getNode(id);
  if (node) return getNodeCenter(node);
  const anchor = edgeAnchors.get(id) || previousAnchors.get(id);
  if (anchor) return { x: anchor.x, y: anchor.y };
  if (seen.has(id)) return null;
  seen.add(id);
  const edge = getEdge(id);
  if (!edge) return null;
  const from = getConnectionPoint(edge.from, previousAnchors, seen);
  const to = getConnectionPoint(edge.to, previousAnchors, seen);
  if (!from || !to) return null;
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2
  };
}

function getEndpointPoint(id, towardId, previousAnchors = edgeAnchors) {
  const center = getConnectionPoint(id, previousAnchors);
  const toward = getConnectionPoint(towardId, previousAnchors);
  if (!center || !toward) return center;
  const node = getNode(id);
  if (node) return nodeBoundaryPoint(node, toward);
  const edge = getEdge(id);
  if (edge) return relationshipBoundaryPoint(edge, center, toward);
  return center;
}

function nodeBoundaryPoint(node, toward) {
  const size = getNodeSize(node);
  const center = getNodeCenter(node);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (!dx && !dy) return center;
  if (node.type === "Role" || node.type === "Actor" || node.type === "Scenario") {
    const rx = size.width / 2;
    const ry = size.height / 2;
    const scale = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
    return { x: center.x + dx * scale, y: center.y + dy * scale };
  }
  return rectBoundaryPoint(center, { width: size.width, height: size.height }, toward);
}

function relationshipBoundaryPoint(edge, center, toward) {
  const width = Math.min(170, Math.max(44, edgeLabel(edge.type).length * 7 + 18));
  return rectBoundaryPoint(center, { width, height: 24 }, toward);
}

function rectBoundaryPoint(center, size, toward) {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (!dx && !dy) return center;
  const scaleX = dx ? (size.width / 2) / Math.abs(dx) : Infinity;
  const scaleY = dy ? (size.height / 2) / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale
  };
}

function exportModel() {
  downloadJson("modal-constraint-model.json", {
    name: "Modal Constraint Threat Analyzer Model",
    exportedAt: new Date().toISOString(),
    nodes: state.nodes,
    edges: state.edges,
    facts: state.facts,
    threatResult: state.findings
  });
}

async function saveServerModel() {
  const response = await postApi("/api/models", { model: getModelPayload(), modelId: `model_${Date.now()}` });
  if (!response) {
    state.findings = [{
      threatType: "Save Model",
      riskLevel: "Notice",
      evidence: "Backend is not available. Use Export Model for a local JSON copy.",
      kind: "notice"
    }];
  } else {
    state.findings = [{
      threatType: "Save Model",
      riskLevel: "Ready",
      evidence: `Model saved on backend as ${response.modelId}.`,
      kind: "ready"
    }];
  }
  render();
  saveState();
}

async function saveDiagramImage() {
  const svgText = buildDiagramSvg();
  downloadText("modal-constraint-diagram.svg", svgText);
  const response = await postApi("/api/export-image", {
    filename: `modal_constraint_diagram_${Date.now()}`,
    svg: svgText
  });
  state.findings = [{
    threatType: "Save Diagram Image",
    riskLevel: response ? "Ready" : "Notice",
    evidence: response
      ? `Diagram image saved on backend as ${response.filename}. A local SVG copy was also downloaded.`
      : "Backend is not available. A local SVG copy was downloaded.",
    kind: response ? "ready" : "notice"
  }];
  render();
  saveState();
}

function importModel(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      recordHistory();
      state.nodes = Array.isArray(parsed.nodes) ? migrateNodes(parsed.nodes) : [];
      state.edges = Array.isArray(parsed.edges) ? parsed.edges.filter((edge) => edge.type !== "inScenario") : [];
      state.facts = Array.isArray(parsed.facts) ? parsed.facts : [];
      state.findings = Array.isArray(parsed.threatResult)
        ? parsed.threatResult
        : Array.isArray(parsed.findings)
          ? parsed.findings
          : [];
      clearNodeSelection();
      state.selectedEdgeId = null;
      state.connectSourceId = null;
      state.connectDirection = "out";
      state.connectLockedType = false;
      render();
      saveState();
    } catch {
      state.findings = [{ threatType: "Import Model", riskLevel: "Error", evidence: "The selected JSON file could not be parsed.", kind: "high" }];
      render();
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function exportThreatResult() {
  const threatResult = dedupeThreatFindings(state.findings)
    .filter((item) => item.technique || item.victimRole || item.attacker || item.asset || item.kind === "threat")
    .map((item) => ({
      victim: item.victimRole || "",
      attacker: item.attacker || "",
      asset: item.asset || "",
      technique: item.technique || item.threatType || ""
    }))
    .filter((item) => item.victim || item.attacker || item.asset || item.technique);
  const rows = [
    ["Victim (Role)", "Attacker", "Asset", "Technique"],
    ...threatResult.map((item) => [item.victim, item.attacker, item.asset, item.technique])
  ];
  downloadBlob(
    "modal-constraint-threat-result.xlsx",
    buildXlsxWorkbook("Threat Result", rows),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

function exportReport() {
  const lines = [
    "# Modal Constraint Threat Analyzer Report",
    "",
    `Generated At: ${new Date().toISOString()}`,
    "",
    "## Nodes",
    ...state.nodes.map((node) => `- ${node.type}: ${node.name}`),
    "",
    "## Relations",
    ...state.edges.map((edge) => {
      const connector = isUndirectedRelationType(edge.type) ? `--${edgeLabel(edge.type)}--` : `-${edgeLabel(edge.type)}->`;
      return `- ${getConnectableName(edge.from)} ${connector} ${getConnectableName(edge.to)}`;
    }),
    "",
    "## Threat Result",
    ...state.findings.map((finding) => finding.technique
      ? `- Victim: ${finding.victimRole}; Attacker: ${finding.attacker}; Asset: ${finding.asset}; Technique: ${finding.technique}`
      : `- ${[finding.threatType, finding.riskLevel].filter(Boolean).join(" - ")}: ${finding.evidence}`)
  ];
  downloadText("modal-constraint-report.md", lines.join("\n"));
}

function getModelPayload() {
  return {
    name: "Modal Constraint Threat Analyzer Model",
    exportedAt: new Date().toISOString(),
    nodes: state.nodes.map(cleanNodeForExport),
    edges: state.edges.filter((edge) => edge.type !== "inScenario")
  };
}

function cleanNodeForExport(node) {
  const copy = { ...node };
  delete copy.roleKind;
  if (copy.type !== "Actor") copy.awareness = "";
  if (copy.type !== "Scenario") copy.complexity = "";
  return copy;
}

async function postApi(path, payload) {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function buildDiagramSvg() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1000, Math.round(rect.width || 1000));
  const height = Math.max(700, Math.round(rect.height || 700));
  const escape = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const labelLines = (value) => String(value ?? "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const textBlock = (value, x, centerY, options = {}) => {
    const linesForText = labelLines(value);
    if (!linesForText.length) return [];
    const fontFamily = options.fontFamily || "Arial";
    const fontSize = options.fontSize || 13;
    const lineHeight = options.lineHeight || fontSize + 2;
    const startY = centerY - ((linesForText.length - 1) * lineHeight) / 2;
    return linesForText.map((line, index) =>
      `<text x="${x}" y="${startY + index * lineHeight}" font-family="${fontFamily}" font-size="${fontSize}" text-anchor="middle" dominant-baseline="middle">${escape(line)}</text>`
    );
  };
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    "<defs>",
    "<marker id=\"arrow\" markerWidth=\"7\" markerHeight=\"7\" refX=\"8\" refY=\"3\" orient=\"auto\" markerUnits=\"strokeWidth\"><path d=\"M0,0 L0,6 L9,3 z\" fill=\"#111\"/></marker>",
    "<marker id=\"arrow-start\" markerWidth=\"7\" markerHeight=\"7\" refX=\"1\" refY=\"3\" orient=\"auto\" markerUnits=\"strokeWidth\"><path d=\"M9,0 L9,6 L0,3 z\" fill=\"#111\"/></marker>",
    "<marker id=\"diamond\" markerWidth=\"8\" markerHeight=\"8\" refX=\"7\" refY=\"4\" orient=\"auto\" markerUnits=\"strokeWidth\"><path d=\"M1,4 L4,1 L7,4 L4,7 z\" fill=\"#fff\" stroke=\"#111\" stroke-width=\"1\"/></marker>",
    "</defs>",
    "<rect width=\"100%\" height=\"100%\" fill=\"#fff\"/>"
  ];

  const pairCounts = new Map();
  visibleEdges().forEach((edge) => {
    const key = edgePairKey(edge);
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  });
  const pairIndexes = new Map();
  visibleEdges().forEach((edge) => {
    const p1 = getEndpointPoint(edge.from, edge.to);
    const p2 = getEndpointPoint(edge.to, edge.from);
    if (!p1 || !p2) return;
    const key = edgePairKey(edge);
    const total = pairCounts.get(key) || 1;
    const used = pairIndexes.get(key) || 0;
    pairIndexes.set(key, used + 1);
    const offset = routedEdgeOffset(edge, p1, p2, (used - (total - 1) / 2) * 34);
    const path = curvedPath(p1, p2, offset);
    const label = edgeLabel(edge.type);
    lines.push(`<path d="${path.d}" fill="none" stroke="#111" stroke-width="2.1" stroke-linecap="round"${svgAttrs(edgeMarkerAttrs(edge.type))}/>`);
    if (label) {
      const textWidth = Math.max(34, label.length * 7 + 8);
      const labelPoint = applyEdgeLabelOffset(edge, path.label);
      lines.push(`<rect x="${labelPoint.x - textWidth / 2}" y="${labelPoint.y - 9}" width="${textWidth}" height="18" fill="#fff"/>`);
      lines.push(`<text x="${labelPoint.x}" y="${labelPoint.y + 4}" font-family="Arial" font-size="11" font-weight="700" text-anchor="middle">${escape(label)}</text>`);
    }
  });

  orderedNodes().forEach((node) => {
    const size = getNodeSize(node);
    const cx = node.x + size.width / 2;
    const cy = node.y + size.height / 2;
    if (node.type === "Role" || node.type === "Actor") {
      lines.push(`<circle cx="${cx}" cy="${cy}" r="${size.width / 2}" fill="#fff" stroke="#111" stroke-width="1.5"/>`);
      if (node.type === "Role") {
        const lineY = node.y + size.height * 0.75;
        lines.push(`<line x1="${cx - size.width * 0.3}" y1="${lineY}" x2="${cx + size.width * 0.3}" y2="${lineY}" stroke="#111" stroke-width="1"/>`);
      }
      if (node.type === "Actor") {
        const lineY = node.y + size.height * 0.25;
        lines.push(`<line x1="${cx - size.width * 0.3}" y1="${lineY}" x2="${cx + size.width * 0.3}" y2="${lineY}" stroke="#111" stroke-width="1"/>`);
      }
    } else if (node.type === "Task") {
      const x = node.x;
      const y = node.y;
      const points = `${x + 23},${y} ${x + size.width - 23},${y} ${x + size.width},${y + size.height / 2} ${x + size.width - 23},${y + size.height} ${x + 23},${y + size.height} ${x},${y + size.height / 2}`;
      lines.push(`<polygon points="${points}" fill="#fff" stroke="#111" stroke-width="1.5"/>`);
    } else if (node.type === "Scenario") {
      lines.push(`<ellipse cx="${cx}" cy="${cy}" rx="${size.width / 2}" ry="${size.height / 2}" fill="none" stroke="#111" stroke-width="1.2" stroke-dasharray="3 3"/>`);
    } else if (node.type === "Constraint") {
      lines.push(...textBlock(getNodeMeta(node), cx, cy, { fontFamily: "Times New Roman", fontSize: 18, lineHeight: 18 }));
      return;
    } else {
      lines.push(`<rect x="${node.x}" y="${node.y}" width="${size.width}" height="${size.height}" fill="#fff" stroke="#111" stroke-width="1.5"/>`);
    }
    if (node.type === "Scenario") {
      lines.push(...textBlock(node.name, cx, node.y + size.height - 38, { fontFamily: "Arial", fontSize: 13, lineHeight: 14 }));
      if (getNodeMeta(node)) {
        lines.push(...textBlock(getNodeMeta(node), cx, node.y + size.height - 14, { fontFamily: "Times New Roman", fontSize: 12, lineHeight: 13 }));
      }
    } else {
      const metaText = getNodeMeta(node);
      lines.push(...textBlock(node.name, cx, cy - (metaText ? 8 : 0), { fontFamily: "Arial", fontSize: 13, lineHeight: 14 }));
      if (metaText) {
        lines.push(...textBlock(metaText, cx, cy + 18, { fontFamily: "Times New Roman", fontSize: 12, lineHeight: 13 }));
      }
    }
  });

  lines.push("</svg>");
  return lines.join("\n");
}

function downloadJson(filename, data) {
  downloadText(filename, JSON.stringify(data, null, 2));
}

function buildXlsxWorkbook(sheetName, rows) {
  const createdAt = new Date().toISOString();
  const safeSheetName = escapeXml(String(sheetName || "Sheet1").slice(0, 31));
  const sheetXml = buildWorksheetXml(rows);
  return buildZip({
    "[Content_Types].xml": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
      '</Types>'
    ].join(""),
    "_rels/.rels": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
      '</Relationships>'
    ].join(""),
    "docProps/app.xml": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"',
      ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
      '<Application>Modal Constraint Threat Analyzer</Application>',
      '</Properties>'
    ].join(""),
    "docProps/core.xml": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"',
      ' xmlns:dc="http://purl.org/dc/elements/1.1/"',
      ' xmlns:dcterms="http://purl.org/dc/terms/"',
      ' xmlns:dcmitype="http://purl.org/dc/dcmitype/"',
      ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
      '<dc:title>Modal Constraint Threat Result</dc:title>',
      `<dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created>`,
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified>`,
      '</cp:coreProperties>'
    ].join(""),
    "xl/workbook.xml": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      `<sheets><sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/></sheets>`,
      '</workbook>'
    ].join(""),
    "xl/_rels/workbook.xml.rels": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '</Relationships>'
    ].join(""),
    "xl/styles.xml": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>',
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>',
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>',
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
      '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>',
      '</styleSheet>'
    ].join(""),
    "xl/worksheets/sheet1.xml": sheetXml
  });
}

function buildWorksheetXml(rows) {
  const widths = [28, 24, 28, 22];
  const cols = widths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const sheetRows = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.map((cell, columnIndex) => {
      const ref = `${columnName(columnIndex + 1)}${rowNumber}`;
      const value = String(cell ?? "").replace(/\s+/g, " ").trim();
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join("");
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    `<cols>${cols}</cols>`,
    `<sheetData>${sheetRows}</sheetData>`,
    '</worksheet>'
  ].join("");
}

function columnName(index) {
  let name = "";
  let value = index;
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildZip(files) {
  const encoder = new TextEncoder();
  const entries = Object.entries(files).map(([name, content]) => ({
    name,
    nameBytes: encoder.encode(name),
    data: typeof content === "string" ? encoder.encode(content) : content
  }));
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((Math.floor(now.getSeconds() / 2)) & 31);
  const dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

  entries.forEach((entry) => {
    const crc = crc32(entry.data);
    const localHeader = new Uint8Array(30 + entry.nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, entry.data.length, true);
    view.setUint32(22, entry.data.length, true);
    view.setUint16(26, entry.nameBytes.length, true);
    localHeader.set(entry.nameBytes, 30);
    chunks.push(localHeader, entry.data);

    const centralHeader = new Uint8Array(46 + entry.nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, entry.nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(entry.nameBytes, 46);
    centralDirectory.push(centralHeader);
    offset += localHeader.length + entry.data.length;
  });

  const centralOffset = offset;
  const centralSize = centralDirectory.reduce((total, chunk) => total + chunk.length, 0);
  chunks.push(...centralDirectory);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  chunks.push(endRecord);

  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const zip = new Uint8Array(totalLength);
  let cursor = 0;
  chunks.forEach((chunk) => {
    zip.set(chunk, cursor);
    cursor += chunk.length;
  });
  return zip;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function downloadBlob(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadText(filename, text, type = "text/plain;charset=utf-8") {
  downloadBlob(filename, text, type);
}

function loadSampleCase() {
  recordHistory();
  state.nodes = [
    { id: "scenario_service_company", type: "Scenario", name: "Scenario: IT service\ncompany", x: 145, y: 65, width: 390, height: 285, complexity: "High", awareness: "", description: "High-complexity IT service company scenario." },
    { id: "scenario_company_gate", type: "Scenario", name: "Scenario: the gate of\ncompany A", x: 105, y: 405, width: 365, height: 220, complexity: "Low", awareness: "", description: "Low-complexity company gate scenario." },
    { id: "scenario_company_interior", type: "Scenario", name: "scenario: the interior of Company A", x: 475, y: 115, width: 535, height: 500, complexity: "High", awareness: "", description: "High-complexity company interior scenario." },
    { id: "agent_william", type: "Actor", name: "William", x: 45, y: 470, width: 94, height: 94, awareness: "Low", complexity: "", description: "Actor who plays the staff role." },
    { id: "role_staff_it_service", type: "Role", name: "Staff of IT\nService\ncompany", x: 225, y: 105, width: 94, height: 94, awareness: "", complexity: "", description: "" },
    { id: "task_financial_data_analysis", type: "Task", name: "Financial data\nanalysis", x: 360, y: 125, width: 160, height: 62, awareness: "", complexity: "", description: "" },
    { id: "task_complete_project_service", type: "Task", name: "Complete the\ncompany project", x: 185, y: 230, width: 160, height: 62, awareness: "", complexity: "", description: "" },
    { id: "task_enter_target_company", type: "Task", name: "Enter the target\ncompany", x: 355, y: 230, width: 160, height: 62, awareness: "", complexity: "", description: "" },
    { id: "role_entrance_guard", type: "Role", name: "Entrance\nguard", x: 250, y: 450, width: 94, height: 94, awareness: "", complexity: "", description: "" },
    { id: "task_verify_identity", type: "Task", name: "Verify\nidentity", x: 365, y: 455, width: 160, height: 62, awareness: "", complexity: "", description: "" },
    { id: "role_internal_it_technician", type: "Role", name: "Internal IT\ntechnician", x: 585, y: 155, width: 94, height: 94, awareness: "", complexity: "", description: "" },
    { id: "task_complete_project_internal", type: "Task", name: "Complete the\ncompany project", x: 675, y: 240, width: 160, height: 62, awareness: "", complexity: "", description: "" },
    { id: "asset_entrance_pass", type: "Asset", name: "IT company\nEntrance pass", x: 560, y: 350, width: 160, height: 62, awareness: "", complexity: "", description: "" },
    { id: "role_contract_contact", type: "Role", name: "Contract\ncontact\nperson", x: 845, y: 265, width: 94, height: 94, awareness: "", complexity: "", description: "" },
    { id: "asset_server", type: "Asset", name: "Server", x: 570, y: 485, width: 160, height: 62, awareness: "", complexity: "", description: "" },
    { id: "role_server_administrator", type: "Role", name: "Server\nadministra-\ntor", x: 825, y: 465, width: 94, height: 94, awareness: "", complexity: "", description: "" }
  ];
  state.edges = [
    { id: "e_play_william_staff", from: "agent_william", to: "role_staff_it_service", type: "plays" },
    { id: "e_staff_internal_cooperation", from: "role_staff_it_service", to: "role_internal_it_technician", type: "externalCooperation" },
    { id: "e_project_delegate", from: "task_enter_target_company", to: "task_complete_project_internal", type: "delegates" },
    { id: "e_contract_internal_subordinate", from: "role_contract_contact", to: "role_internal_it_technician", type: "subordinate" },
    { id: "e_contract_server_admin_subordinate", from: "role_contract_contact", to: "role_server_administrator", type: "subordinate" },
    { id: "e_project_server_depend", from: "task_complete_project_service", to: "asset_server", type: "depends" },
    { id: "e_verify_pass_depend", from: "task_verify_identity", to: "asset_entrance_pass", type: "depends" },
    { id: "e_enter_pass_need", from: "task_enter_target_company", to: "asset_entrance_pass", type: "needs" },
    { id: "e_internal_project_pass_need", from: "task_complete_project_internal", to: "asset_entrance_pass", type: "needs" },
    { id: "e_guard_pass_possess", from: "role_entrance_guard", to: "asset_entrance_pass", type: "possesses" },
    { id: "e_server_admin_server_possess", from: "role_server_administrator", to: "asset_server", type: "possesses" },
    { id: "e_m_staff_financial_ability", from: "role_staff_it_service", to: "task_financial_data_analysis", type: "modal_C_P" },
    { id: "e_m_staff_project_permission", from: "role_staff_it_service", to: "task_complete_project_service", type: "modal_S_P" },
    { id: "e_m_staff_enter_obligation", from: "role_staff_it_service", to: "task_enter_target_company", type: "modal_M_P_Y" },
    { id: "e_m_guard_verify_recommendation", from: "role_entrance_guard", to: "task_verify_identity", type: "modal_Sh_P" },
    { id: "e_m_internal_project_obligation", from: "role_internal_it_technician", to: "task_complete_project_internal", type: "modal_M_P_Y" },
    { id: "e_m_internal_pass_permission", from: "role_internal_it_technician", to: "asset_entrance_pass", type: "modal_S_P" },
    { id: "e_m_contract_pass_permission", from: "role_contract_contact", to: "asset_entrance_pass", type: "modal_S_P" },
    { id: "e_m_server_admin_obligation", from: "role_server_administrator", to: "asset_server", type: "modal_M_P_Y" }
  ];
  setSelectedNodes(["scenario_service_company"]);
  state.selectedEdgeId = null;
  state.connectSourceId = null;
  state.connectDirection = "out";
  state.connectLockedType = false;
  state.findings = [];
  state.facts = [];
  assignScenarioMembership();
  autoFitScenarios();
  render();
  saveState();
}

function saveState() {
  localStorage.setItem("mcta-state", JSON.stringify({
    nodes: state.nodes,
    edges: state.edges,
    facts: state.facts,
    threatResult: state.findings,
    zoom: state.zoom,
    gridEnabled: state.gridEnabled
  }));
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem("mcta-state") || "{}");
    if (Array.isArray(saved.nodes)) state.nodes = migrateNodes(saved.nodes);
    if (Array.isArray(saved.edges)) state.edges = saved.edges.filter((edge) => edge.type !== "inScenario");
    if (Array.isArray(saved.facts)) state.facts = saved.facts;
    if (Array.isArray(saved.threatResult)) state.findings = saved.threatResult;
    else if (Array.isArray(saved.findings)) state.findings = saved.findings;
    if (Number(saved.zoom)) state.zoom = clamp(Number(saved.zoom), MIN_ZOOM, MAX_ZOOM);
    if (typeof saved.gridEnabled === "boolean") state.gridEnabled = saved.gridEnabled;
    assignScenarioMembership();
    autoFitScenarios();
  } catch {
    state.nodes = [];
    state.edges = [];
    state.facts = [];
    state.findings = [];
  }
}

function migrateNodes(nodes) {
  return nodes.map((node) => {
    const migrated = {
      awareness: "",
      complexity: "",
      description: "",
      scenarioId: "",
      actionType: normalizeNodeType(node.type) === "Constraint" ? "Execute" : undefined,
      width: typeDefaults[normalizeNodeType(node.type)]?.width,
      height: typeDefaults[normalizeNodeType(node.type)]?.height,
      ...node
    };
    migrated.type = normalizeNodeType(migrated.type);
    delete migrated.roleKind;
    if (migrated.type !== "Actor") migrated.awareness = "";
    if (migrated.type !== "Scenario") migrated.complexity = "";
    return migrated;
  });
}

function normalizeNodeType(type) {
  return type === "Agent" ? "Actor" : type;
}

function svg(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

window.addEventListener("resize", render);
restorePanelWidths();
restoreState();
render();

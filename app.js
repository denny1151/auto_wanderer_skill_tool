const $ = (selector) => document.querySelector(selector);
const COLORS = ["#d95f59", "#4b8ccb", "#54a878", "#9366bd", "#e2a43a", "#3eaaa6"];
let config = { mainPieces: [], groups: [] };
let groupSequence = 0;
const expandedSkills = new Set();
let pyodidePromise;

async function loadBrowserSolver() {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      if (!window.loadPyodide) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js";
          script.onload = resolve;
          script.onerror = () => reject(new Error("無法載入瀏覽器 Python 執行環境。"));
          document.head.append(script);
        });
      }
      const runtime = await window.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/" });
      const response = await fetch("./solver.py?v=search-prune-3");
      if (!response.ok) throw new Error("無法載入排列搜尋程式。");
      await runtime.runPythonAsync(await response.text());
      return runtime;
    })().catch((error) => {
      pyodidePromise = null;
      throw error;
    });
  }
  return pyodidePromise;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function shapeMatrix(shape) {
  const rows = Array.isArray(shape) ? shape : String(shape || "").split(/\r?\n/);
  const matrix = Array.from({ length: 6 }, () => Array(6).fill(false));
  rows.slice(0, 6).forEach((line, row) => {
    [...String(line).replace(/\s/g, "")].slice(0, 6).forEach((cell, col) => {
      matrix[row][col] = cell === "#";
    });
  });
  return matrix;
}

function shapeText(matrix) {
  const filled = [];
  matrix.forEach((row, r) => row.forEach((value, c) => { if (value) filled.push([r, c]); }));
  if (!filled.length) return "";
  const minRow = Math.min(...filled.map(([r]) => r));
  const maxRow = Math.max(...filled.map(([r]) => r));
  const minCol = Math.min(...filled.map(([, c]) => c));
  const maxCol = Math.max(...filled.map(([, c]) => c));
  return matrix.slice(minRow, maxRow + 1).map((row) => row.slice(minCol, maxCol + 1).map((cell) => cell ? "#" : ".").join("")).join("\n");
}

function shapePreview(shape, color) {
  const filled = shapeMatrix(shape).flatMap((row, r) => row.map((value, c) => value ? [r, c] : null).filter(Boolean));
  if (!filled.length) return `<span class="shape-preview-empty">未畫形狀</span>`;
  const minRow = Math.min(...filled.map(([r]) => r)), maxRow = Math.max(...filled.map(([r]) => r));
  const minCol = Math.min(...filled.map(([, c]) => c)), maxCol = Math.max(...filled.map(([, c]) => c));
  const width = maxCol - minCol + 1;
  const cells = Array.from({ length: (maxRow - minRow + 1) * width }, () => "<i></i>");
  filled.forEach(([r, c]) => { cells[(r - minRow) * width + c - minCol] = `<i class="is-filled" style="--shape-color:${color}"></i>`; });
  return `<span class="shape-preview" style="--preview-columns:${width}" aria-label="已畫 ${filled.length} 格">${cells.join("")}</span>`;
}

function shapeEditor(shape, owner, index, pieceIndex = null, color = "#8c98a8") {
  const matrix = shapeMatrix(shape);
  const ownerAttributes = pieceIndex === null
    ? `data-main="${index}"`
    : `data-group="${index}" data-piece="${pieceIndex}"`;
  const cells = matrix.flatMap((row, r) => row.map((filled, c) =>
    `<button class="shape-cell${filled ? " is-filled" : ""}" style="--shape-color:${color}" data-shape-owner="${owner}" ${ownerAttributes} data-shape-cell="${r * 6 + c}" type="button" aria-label="第 ${r + 1} 列第 ${c + 1} 格${filled ? "，已選取" : "，空格"}" aria-pressed="${filled}"></button>`
  )).join("");
  return `<div class="shape-editor" role="group" aria-label="技能形狀編輯器">${cells}</div><small class="shape-hint">點擊格子切換形狀；最多 6×6 格</small>`;
}

function mainCard(piece, index) {
  const key = `main:${index}`;
  return `<article class="card skill-card"><details data-fold-key="${key}" ${expandedSkills.has(key) ? "open" : ""}><summary class="skill-summary"><span class="skill-summary-title">${escapeHtml(piece.name || `主動技能 ${index + 1}`)}</span><span class="skill-summary-stock">數量 ${piece.stock}</span>${shapePreview(piece.shape, "#f1a977")}</summary><div class="skill-editor"><div class="field-row"><label>名稱<input data-main="${index}" data-field="name" value="${escapeHtml(piece.name)}"></label><label>可用數量<input data-main="${index}" data-field="stock" type="number" min="0" value="${piece.stock}"></label></div><div class="shape-field"><span>技能形狀</span>${shapeEditor(piece.shape, "main", index, null, "#f1a977")}</div></div></details><button class="button button-danger button-small skill-delete" data-remove-main="${index}" type="button">刪除</button></article>`;
}

function variantCard(groupIndex, piece, pieceIndex, color) {
  const key = `variant:${groupIndex}:${pieceIndex}`;
  return `<article class="variant-card skill-card"><details data-fold-key="${key}" ${expandedSkills.has(key) ? "open" : ""}><summary class="skill-summary"><span class="skill-summary-title">${escapeHtml(piece.name || `被動技能 ${pieceIndex + 1}`)}</span><span class="skill-summary-stock">數量 ${piece.stock}</span>${shapePreview(piece.shape, color)}</summary><div class="skill-editor"><div class="field-row"><label>名稱<input data-group="${groupIndex}" data-piece="${pieceIndex}" data-field="name" value="${escapeHtml(piece.name)}"></label><label>可用數量<input data-group="${groupIndex}" data-piece="${pieceIndex}" data-field="stock" type="number" min="0" value="${piece.stock}"></label></div><div class="shape-field"><span>技能形狀</span>${shapeEditor(piece.shape, "variant", groupIndex, pieceIndex, color)}</div></div></details><button class="button button-danger button-small skill-delete" data-remove-variant="${groupIndex}:${pieceIndex}" type="button">刪除</button></article>`;
}

function groupCard(group, index) {
  const color = /^#[0-9a-fA-F]{6}$/.test(group.color) ? group.color : COLORS[index % COLORS.length];
  const variants = group.pieces.map((piece, pieceIndex) => variantCard(index, piece, pieceIndex, color)).join("");
  return `<article class="card group-card" style="--group-color:${color}"><div class="card-title"><strong><span class="color-dot"></span>被動技能組 ${index + 1}</strong><div class="group-actions"><button class="button button-small" data-move-group="${index}:up" type="button" aria-label="提高規則優先順序">↑</button><button class="button button-small" data-move-group="${index}:down" type="button" aria-label="降低規則優先順序">↓</button><button class="button button-danger button-small" data-remove-group="${index}" type="button">刪除</button></div></div><div class="field-row"><label>組別名稱<input data-group="${index}" data-field="name" value="${escapeHtml(group.name)}"></label><label>顯示顏色<input data-group="${index}" data-field="color" type="color" value="${color}"></label></div><div class="field-row"><label>最少選擇<input data-group="${index}" data-field="min" type="number" min="0" value="${group.min}"></label><label>最多選擇（留白不限）<input data-group="${index}" data-field="max" type="number" min="0" placeholder="不限" value="${group.max ?? ""}"></label></div><label class="check-label"><input data-group="${index}" data-field="preferMore" type="checkbox" ${group.preferMore ? "checked" : ""}> 越多越好（依組別順序優先）</label><div class="variant-list">${variants}</div><button class="button button-small" data-add-variant="${index}" type="button">＋ 新增被動技能形狀</button></article>`;
}

function renderEditor() {
  $("#main-pieces").innerHTML = config.mainPieces.map(mainCard).join("") || `<p class="empty-hint">尚無主動技能，請新增至少一種。</p>`;
  $("#groups").innerHTML = config.groups.map(groupCard).join("") || `<p class="empty-hint">尚無被動技能組，請新增至少一組。</p>`;
  document.querySelectorAll("details[data-fold-key]").forEach((details) => details.addEventListener("toggle", () => {
    if (details.open) expandedSkills.add(details.dataset.foldKey);
    else expandedSkills.delete(details.dataset.foldKey);
  }));
}

function updateSkillSummaries() {
  document.querySelectorAll("details[data-fold-key]").forEach((details) => {
    const input = details.querySelector('input[data-field="name"]');
    const stock = details.querySelector('input[data-field="stock"]');
    details.querySelector(".skill-summary-title").textContent = input.value || "未命名技能";
    details.querySelector(".skill-summary-stock").textContent = `數量 ${stock.value}`;
  });
}

function readForm() {
  document.querySelectorAll("[data-main][data-field]").forEach((input) => {
    const piece = config.mainPieces[Number(input.dataset.main)];
    if (piece) piece[input.dataset.field] = input.dataset.field === "stock" ? Number(input.value) : input.value;
  });
  document.querySelectorAll("[data-group][data-field]").forEach((input) => {
    const group = config.groups[Number(input.dataset.group)];
    if (!group) return;
    const field = input.dataset.field;
    if (input.dataset.piece !== undefined) {
      const piece = group.pieces[Number(input.dataset.piece)];
      if (piece) piece[field] = field === "stock" ? Number(input.value) : input.value;
    } else if (field === "max") group.max = input.value === "" ? null : Number(input.value);
    else if (field === "min") group.min = Number(input.value);
    else if (field === "preferMore") group[field] = input.checked;
    else group[field] = input.value;
  });
}

function addGroup() {
  const index = groupSequence++;
  config.groups.push({ name: `被動技能組 ${index + 1}`, color: COLORS[index % COLORS.length], min: 0, max: 1, preferMore: false, pieces: [{ name: "新被動技能", stock: 1, shape: "#" }] });
  expandedSkills.add(`variant:${index}:0`);
}

function updateShape(button) {
  readForm();
  const cell = Number(button.dataset.shapeCell);
  const row = Math.floor(cell / 6), col = cell % 6;
  let target;
  if (button.dataset.shapeOwner === "main") target = config.mainPieces[Number(button.dataset.main)];
  else target = config.groups[Number(button.dataset.group)].pieces[Number(button.dataset.piece)];
  const matrix = shapeMatrix(target.shape);
  matrix[row][col] = !matrix[row][col];
  target.shape = shapeText(matrix);
  renderEditor();
}

$("#main-pieces").addEventListener("input", () => { readForm(); updateSkillSummaries(); });
$("#groups").addEventListener("input", () => { readForm(); updateSkillSummaries(); });
$("#add-main").addEventListener("click", () => {
  readForm();
  config.mainPieces.push({ name: `主動技能 ${config.mainPieces.length + 1}`, stock: 1, shape: "#" });
  expandedSkills.add(`main:${config.mainPieces.length - 1}`);
  renderEditor();
});
$("#add-group").addEventListener("click", () => { readForm(); addGroup(); renderEditor(); });

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.shapeCell !== undefined) { updateShape(button); return; }
  readForm();
  if (button.dataset.removeMain !== undefined) {
    config.mainPieces.splice(Number(button.dataset.removeMain), 1);
    expandedSkills.clear();
  } else if (button.dataset.removeGroup !== undefined) {
    config.groups.splice(Number(button.dataset.removeGroup), 1);
    expandedSkills.clear();
  }
  else if (button.dataset.removeVariant) {
    const [groupIndex, pieceIndex] = button.dataset.removeVariant.split(":").map(Number);
    config.groups[groupIndex].pieces.splice(pieceIndex, 1);
    expandedSkills.clear();
  } else if (button.dataset.addVariant !== undefined) {
    const groupIndex = Number(button.dataset.addVariant);
    config.groups[groupIndex].pieces.push({ name: "新被動技能", stock: 1, shape: "#" });
    expandedSkills.add(`variant:${groupIndex}:${config.groups[groupIndex].pieces.length - 1}`);
  }
  else if (button.dataset.moveGroup) {
    const [indexText, direction] = button.dataset.moveGroup.split(":");
    const index = Number(indexText), next = index + (direction === "up" ? -1 : 1);
    if (next >= 0 && next < config.groups.length) {
      [config.groups[index], config.groups[next]] = [config.groups[next], config.groups[index]];
      expandedSkills.clear();
    }
  } else return;
  renderEditor();
});

function clearResult() {
  document.querySelectorAll(".board-cell").forEach((cell) => { cell.style.background = ""; cell.removeAttribute("title"); });
  $("#summary").hidden = true;
  $("#legend").replaceChildren();
  $("#placement-list").replaceChildren();
  $("#search-meta").textContent = "";
  $("#result-message").textContent = "棋盤目前空白。新增技能與規則後開始搜尋。";
  $("#result-status").textContent = "尚未搜尋";
  $("#result-status").className = "status-pill status-idle";
}

function showResult(data) {
  $("#result-message").textContent = data.message;
  const status = $("#result-status");
  status.textContent = ({ optimal: "最佳解", partial: "暫定解", infeasible: "無可行解", limit: "搜尋受限" })[data.status] || "完成";
  status.className = `status-pill ${data.status === "optimal" ? "status-success" : data.status === "partial" ? "status-warning" : "status-error"}`;
  if (!data.solution) return;
  const solution = data.solution;
  const cells = document.querySelectorAll(".board-cell");
  const legend = new Map();
  solution.placements.forEach((placement) => {
    legend.set(`${placement.group}|${placement.color}`, { group: placement.group, color: placement.color });
    placement.cells.forEach(([row, col]) => {
      const cell = cells[(row - 1) * 6 + col - 1];
      cell.style.background = placement.color;
      cell.title = `${placement.group}／${placement.pieceName}（${row}, ${col}）`;
    });
  });
  $("#legend").innerHTML = Array.from(legend.values()).map((item) => `<span class="legend-item"><i style="background:${escapeHtml(item.color)}"></i>${escapeHtml(item.group)}</span>`).join("");
  const counts = Object.entries(solution.selectedCounts).map(([name, count]) => `<span>${escapeHtml(name)}：${count}</span>`).join("");
  $("#summary").innerHTML = `<div><strong>${solution.emptyCells}</strong><small>剩餘空格</small></div><div><strong>${solution.largestEmptyComponent}</strong><small>最大相連空格</small></div><div><strong>${solution.emptyComponents}</strong><small>空格區塊數</small></div><div class="summary-counts">${counts}</div>`;
  $("#summary").hidden = false;
  $("#placement-list").innerHTML = solution.placements.map((placement) => `<div class="placement-item"><span class="placement-swatch" style="background:${escapeHtml(placement.color)}"></span><span><strong>${escapeHtml(placement.group)}／${escapeHtml(placement.pieceName)}</strong><small>${placement.cells.length} 格：${placement.cells.map(([r, c]) => `(${r},${c})`).join(" ")}</small></span></div>`).join("");
  $("#search-meta").textContent = `搜尋節點：${data.nodes.toLocaleString()}${data.status === "partial" ? "（節點上限時已找到暫定排列）" : ""}`;
}

function downloadConfig() {
  readForm();
  const contents = JSON.stringify({ version: 1, ...config }, null, 2);
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `技能設定-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importConfig(data) {
  if (!data || !Array.isArray(data.mainPieces) || !Array.isArray(data.groups)) throw new Error("JSON 格式不符；需要 mainPieces 與 groups。" );
  data.mainPieces.forEach((piece) => { if (typeof piece.shape !== "string" && !Array.isArray(piece.shape)) throw new Error("主動技能缺少有效形狀。"); });
  data.groups.forEach((group) => {
    if (!Array.isArray(group.pieces)) throw new Error("輔助技能組缺少形狀清單。");
    group.pieces.forEach((piece) => { if (typeof piece.shape !== "string" && !Array.isArray(piece.shape)) throw new Error("輔助技能缺少有效形狀。"); });
  });
  config = {
    mainPieces: data.mainPieces.map((piece) => ({ ...piece, shape: Array.isArray(piece.shape) ? piece.shape.join("\n") : piece.shape })),
    groups: data.groups.map((group, index) => ({ ...group, color: /^#[0-9a-fA-F]{6}$/.test(group.color) ? group.color : COLORS[index % COLORS.length], pieces: group.pieces.map((piece) => ({ ...piece, shape: Array.isArray(piece.shape) ? piece.shape.join("\n") : piece.shape })) })),
  };
  groupSequence = config.groups.length;
  renderEditor();
  clearResult();
}

$("#export-config").addEventListener("click", downloadConfig);
$("#import-config").addEventListener("click", () => $("#config-file").click());
$("#config-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    importConfig(JSON.parse(await file.text()));
    $("#form-error").textContent = "設定已匯入。";
  } catch (error) { $("#form-error").textContent = error.message || "無法匯入 JSON。"; }
  event.target.value = "";
});

$("#solve").addEventListener("click", async () => {
  readForm();
  $("#form-error").textContent = "";
  const maxNodes = Number($("#search-limit").value);
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) {
    $("#form-error").textContent = "搜尋節點上限請填正整數。";
    return;
  }
  const button = $("#solve"); button.disabled = true; button.textContent = "載入搜尋器…";
  try {
    const runtime = await loadBrowserSolver();
    button.textContent = "搜尋中…";
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(config))));
    const output = await runtime.runPythonAsync(`import base64, json\n_config = json.loads(base64.b64decode("${encoded}"))\njson.dumps(solve(_config, ${maxNodes}), ensure_ascii=False)`);
    const data = JSON.parse(output);
    clearResult(); showResult(data);
  } catch (error) { $("#form-error").textContent = error.message || `搜尋失敗：${error}`; }
  finally { button.disabled = false; button.innerHTML = '<span class="button-icon">⌕</span> 搜尋最佳排列'; }
});

renderEditor();

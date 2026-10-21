const $ = (selector) => document.querySelector(selector);
const COLORS = ["#d95f59", "#4b8ccB", "#54a878", "#9366bd", "#e2a43a", "#3eaaa6"];
let config = { mainPieces: [], groups: [] };
let groupSequence = 0;
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
      const response = await fetch("./solver.py");
      if (!response.ok) throw new Error("無法載入排列搜尋程式。");
      await runtime.runPythonAsync(await response.text());
      return runtime;
    })();
  }
  return pyodidePromise;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function mainCard(piece, index) {
  return `<article class="card"><div class="card-title"><strong>主板塊 ${index + 1}</strong><button class="button button-danger button-small" data-remove-main="${index}" type="button">刪除</button></div><label>名稱<input data-main="${index}" data-field="name" value="${escapeHtml(piece.name)}"></label><label>庫存<input data-main="${index}" data-field="stock" type="number" min="0" value="${piece.stock}"></label><label>形狀（# 為板塊，. 為空）<textarea data-main="${index}" data-field="shape" spellcheck="false">${escapeHtml(piece.shape)}</textarea></label></article>`;
}

function variantCard(groupIndex, piece, pieceIndex) {
  return `<div class="variant-card"><div class="card-title"><strong>形狀 ${pieceIndex + 1}</strong><button class="button button-danger button-small" data-remove-variant="${groupIndex}:${pieceIndex}" type="button">刪除</button></div><label>名稱<input data-group="${groupIndex}" data-piece="${pieceIndex}" data-field="name" value="${escapeHtml(piece.name)}"></label><label>庫存<input data-group="${groupIndex}" data-piece="${pieceIndex}" data-field="stock" type="number" min="0" value="${piece.stock}"></label><label>形狀<textarea data-group="${groupIndex}" data-piece="${pieceIndex}" data-field="shape" spellcheck="false">${escapeHtml(piece.shape)}</textarea></label></div>`;
}

function groupCard(group, index) {
  const variants = group.pieces.map((piece, pieceIndex) => variantCard(index, piece, pieceIndex)).join("");
  return `<article class="card group-card" style="--group-color:${escapeHtml(group.color)}"><div class="card-title"><strong><span class="color-dot"></span>次板塊組 ${index + 1}</strong><div><button class="button button-small" data-move-group="${index}:up" type="button" aria-label="提高規則優先順序">↑</button> <button class="button button-small" data-move-group="${index}:down" type="button" aria-label="降低規則優先順序">↓</button> <button class="button button-danger button-small" data-remove-group="${index}" type="button">刪除</button></div></div><div class="field-row"><label>名稱<input data-group="${index}" data-field="name" value="${escapeHtml(group.name)}"></label><label>顏色<input data-group="${index}" data-field="color" type="color" value="${escapeHtml(group.color)}"></label></div><div class="field-row"><label>最少選<input data-group="${index}" data-field="min" type="number" min="0" value="${group.min}"></label><label>最多選<input data-group="${index}" data-field="max" type="number" min="0" value="${group.max}"></label></div><label class="check-label"><input data-group="${index}" data-field="preferMore" type="checkbox" ${group.preferMore ? "checked" : ""}> 越多越好（依次板塊組順序比較）</label><div class="variant-list">${variants}</div><button class="button button-small" data-add-variant="${index}" type="button">＋ 新增形狀</button></article>`;
}

function renderEditor() {
  $("#main-pieces").innerHTML = config.mainPieces.map(mainCard).join("") || `<p class="empty-hint">尚無主板塊，請新增至少一種。</p>`;
  $("#groups").innerHTML = config.groups.map(groupCard).join("") || `<p class="empty-hint">尚無次板塊組，請新增至少一組。</p>`;
}

function sampleConfig() {
  return {
    mainPieces: [
      { name: "主板塊 A", stock: 1, shape: "#.\n#.\n##\n#." },
      { name: "主板塊 B", stock: 1, shape: "##\n##" },
    ],
    groups: [
      { name: "紅色次板塊", color: "#d95f59", min: 1, max: 1, preferMore: false, pieces: [{ name: "直線 2 格", stock: 3, shape: "##" }] },
      { name: "藍色次板塊", color: "#4b8ccb", min: 2, max: 3, preferMore: false, pieces: [{ name: "直線 2 格", stock: 4, shape: "##" }] },
      { name: "綠色次板塊", color: "#54a878", min: 1, max: 1, preferMore: false, pieces: [{ name: "L 形", stock: 1, shape: "##\n.#" }] },
      { name: "紫色次板塊", color: "#9366bd", min: 4, max: 7, preferMore: true, pieces: [{ name: "單格", stock: 6, shape: "#" }, { name: "直線 2 格", stock: 1, shape: "#\n#" }] },
    ],
  };
}

function readForm() {
  document.querySelectorAll("[data-main]").forEach((input) => {
    const piece = config.mainPieces[Number(input.dataset.main)];
    piece[input.dataset.field] = input.dataset.field === "stock" ? Number(input.value) : input.value;
  });
  document.querySelectorAll("[data-group]").forEach((input) => {
    const group = config.groups[Number(input.dataset.group)];
    const field = input.dataset.field;
    if (input.dataset.piece !== undefined) {
      const piece = group.pieces[Number(input.dataset.piece)];
      piece[field] = field === "stock" ? Number(input.value) : input.value;
    } else if (field === "min" || field === "max") group[field] = Number(input.value);
    else if (field === "preferMore") group[field] = input.checked;
    else group[field] = input.value;
  });
}

function addGroup() {
  const index = groupSequence++;
  config.groups.push({ name: `次板塊 ${index + 1}`, color: COLORS[index % COLORS.length], min: 0, max: 0, preferMore: false, pieces: [{ name: "形狀 1", stock: 1, shape: "##" }] });
}

$("#main-pieces").addEventListener("input", readForm);
$("#groups").addEventListener("input", readForm);
$("#add-main").addEventListener("click", () => { readForm(); config.mainPieces.push({ name: `主板塊 ${config.mainPieces.length + 1}`, stock: 1, shape: "##\n##" }); renderEditor(); });
$("#add-group").addEventListener("click", () => { readForm(); addGroup(); renderEditor(); });
$("#load-example").addEventListener("click", () => { config = sampleConfig(); groupSequence = config.groups.length; renderEditor(); clearResult(); });

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  readForm();
  if (button.dataset.removeMain !== undefined) config.mainPieces.splice(Number(button.dataset.removeMain), 1);
  else if (button.dataset.removeGroup !== undefined) config.groups.splice(Number(button.dataset.removeGroup), 1);
  else if (button.dataset.removeVariant) {
    const [groupIndex, pieceIndex] = button.dataset.removeVariant.split(":").map(Number);
    config.groups[groupIndex].pieces.splice(pieceIndex, 1);
  } else if (button.dataset.addVariant !== undefined) config.groups[Number(button.dataset.addVariant)].pieces.push({ name: "新形狀", stock: 1, shape: "##" });
  else if (button.dataset.moveGroup) {
    const [indexText, direction] = button.dataset.moveGroup.split(":");
    const index = Number(indexText), next = index + (direction === "up" ? -1 : 1);
    if (next >= 0 && next < config.groups.length) [config.groups[index], config.groups[next]] = [config.groups[next], config.groups[index]];
  } else return;
  renderEditor();
});

function clearResult() {
  document.querySelectorAll(".board-cell").forEach((cell) => { cell.style.background = ""; cell.removeAttribute("title"); });
  $("#summary").hidden = true;
  $("#legend").replaceChildren();
  $("#placement-list").replaceChildren();
  $("#search-meta").textContent = "";
  $("#result-message").textContent = "棋盤目前空白。載入範例或建立板塊規則後開始搜尋。";
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
  $("#search-meta").textContent = `搜尋節點：${data.nodes.toLocaleString()}${data.status === "partial" ? "（節點上限時已找到解）" : ""}`;
}

$("#solve").addEventListener("click", async () => {
  readForm();
  $("#form-error").textContent = "";
  const button = $("#solve"); button.disabled = true; button.textContent = "載入搜尋器…";
  try {
    const runtime = await loadBrowserSolver();
    button.textContent = "搜尋中…";
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(config))));
    const output = await runtime.runPythonAsync(`import base64, json\n_config = json.loads(base64.b64decode("${encoded}"))\njson.dumps(solve(_config), ensure_ascii=False)`);
    const data = JSON.parse(output);
    clearResult(); showResult(data);
  } catch (error) { $("#form-error").textContent = error.message || `搜尋失敗：${error}`; }
  finally { button.disabled = false; button.innerHTML = '<span class="button-icon">⌕</span> 搜尋最佳排列'; }
});

config = sampleConfig();
groupSequence = config.groups.length;
renderEditor();

/**
 * 不動産ダッシュボード - フロントエンド
 */

/** GitHub Pages 等のサブパスでも正しい JSON URL を返す */
function resolveAssetUrl(relativePath) {
  return new URL(relativePath.replace(/^\//, ""), document.baseURI).href;
}

const DATA_URL = resolveAssetUrl("data/properties.json");
const DATA_INDEX_URL = resolveAssetUrl("data/properties-index.json");
const STATIONS_URL = resolveAssetUrl("data/stations.json");
const PAGE_SIZE = 100;

let allProperties = [];
let marketSummary = {};
let currentPage = 1;
const selectedLayoutKeys = new Set();
/** 選択中の駅（最大5件・選択順を保持） */
const selectedStations = [];
const MAX_SELECTED_STATIONS = 5;
const MAX_STATION_SUGGESTIONS = 120;
let allStations = [];
let stationPickerActiveIndex = -1;
let sortState = { column: "price_jpy", direction: "asc" };

/** レンジスライダー設定（上限値は添付画像に準拠） */
const RANGE_FILTER_CONFIG = {
  area: {
    label: "面積",
    min: 0,
    max: 120,
    step: 1,
    unit: "㎡",
    unlimitedAtMax: true,
  },
  age: {
    label: "築年数",
    min: 0,
    max: 50,
    step: 1,
    unit: "年",
    unlimitedAtMax: true,
  },
  walk: {
    label: "駅徒歩",
    min: 0,
    max: 30,
    step: 1,
    unit: "分",
    unlimitedAtMax: true,
  },
  bargain: {
    label: "割安物件",
    min: 0,
    max: 30,
    step: 1,
    unit: "%",
    mode: "threshold",
    valueLabel: "以上お得",
  },
};

/** レンジスライダーの現在値 */
const rangeFilterState = {
  area: { min: 0, max: 120 },
  age: { min: 0, max: 50 },
  walk: { min: 0, max: 30 },
  bargain: { min: 10, max: 30 },
};

const TABLE_COLUMNS = [
  { id: "plan", label: "間取り図", sortable: false, className: "col-plan", align: "center" },
  { id: "property_name", label: "物件名", sortable: true, type: "string", className: "col-name", align: "start" },
  { id: "display_state", label: "状態", sortable: true, type: "string", className: "col-state", align: "center" },
  { id: "station", label: "駅", sortable: true, type: "string", className: "col-station", align: "center" },
  { id: "walk_minutes", label: "徒歩", sortable: true, type: "number", className: "col-walk", align: "end" },
  { id: "price_jpy", label: "価格", sortable: true, type: "number", className: "col-price", align: "end" },
  { id: "unit_price_m2", label: "平米単価", sortable: true, type: "number", className: "col-unit", align: "end" },
  { id: "area_m2", label: "面積", sortable: true, type: "number", className: "col-area", align: "end" },
  { id: "floor", label: "階数", sortable: true, type: "number", className: "col-floor", align: "center" },
  { id: "layout", label: "間取り", sortable: true, type: "layout", className: "col-layout", align: "center" },
  { id: "direction", label: "方位", sortable: true, type: "string", className: "col-direction", align: "center" },
  { id: "age_years", label: "築年数", sortable: true, type: "number", className: "col-age", align: "end" },
  { id: "transaction_period", label: "取引時期", sortable: true, type: "string", className: "col-period", align: "center" },
  { id: "link", label: "詳細", sortable: false, className: "col-link", align: "center" },
];

const elements = {
  updatedAt: document.getElementById("updated-at"),
  filterStation: document.getElementById("filter-station"),
  filterStatus: document.getElementById("filter-status"),
  filterLayout: document.getElementById("filter-layout"),
  filterArea: document.getElementById("filter-area"),
  filterAge: document.getElementById("filter-age"),
  filterWalk: document.getElementById("filter-walk"),
  filterBargain: document.getElementById("filter-bargain"),
  searchInput: document.getElementById("search-input"),
  resultCount: document.getElementById("result-count"),
  marketSummary: document.getElementById("market-summary"),
  propertyListHeader: document.getElementById("property-list-header"),
  propertyList: document.getElementById("property-list"),
  emptyMessage: document.getElementById("empty-message"),
  reloadBtn: document.getElementById("reload-btn"),
  paginationBottom: document.getElementById("pagination-bottom"),
};

/** 全角英数字を半角に変換する */
function toHalfWidth(text) {
  return String(text).replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
}

/** 間取り表記を正規化キーに変換する */
function normalizeLayoutKey(layout) {
  if (!layout || layout === "-") return "";

  let normalized = toHalfWidth(String(layout)).replace(/\s/g, "").toUpperCase();
  if (normalized.includes("ワンルーム")) return "1R";
  if (normalized === "1R" || normalized.includes("1R")) return "1R";

  const match = normalized.match(/(\d+[LDKR]+)/);
  return match ? match[1] : normalized;
}

/** 間取りの表示ラベルを整形する */
function formatLayoutLabel(layout) {
  const key = normalizeLayoutKey(layout);
  if (key === "1R") return "1R";
  return key || String(layout || "-");
}

/** 間取りキーの並び順を数値化する（部屋数 → タイプ） */
function parseLayoutSortKey(key) {
  if (key === "1R") return [0, 0, 0, key];
  const match = String(key).match(/^(\d+)(.*)$/);
  if (!match) return [99, 99, 0, key];

  const rooms = Number(match[1]);
  const rest = match[2] || "";
  const hasService = rest.includes("S") || rest.includes("Ｓ") ? 1 : 0;

  let typeRank = 5;
  if (rest.includes("LDK")) typeRank = 3;
  else if (rest.includes("DK")) typeRank = 2;
  else if (rest.includes("LK")) typeRank = 2.5;
  else if (rest.includes("K")) typeRank = 1;
  else if (rest.includes("R")) typeRank = 0;

  return [rooms, typeRank, hasService, key];
}

/** 間取りキーを表示順に比較する */
function compareLayoutKeys(left, right) {
  const leftOrder = parseLayoutSortKey(left);
  const rightOrder = parseLayoutSortKey(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftOrder[index] !== rightOrder[index]) {
      return leftOrder[index] - rightOrder[index];
    }
  }
  return String(leftOrder[3]).localeCompare(String(rightOrder[3]), "ja");
}

/** 間取りを部屋数グループに分類する */
function groupLayoutsByRooms(layouts) {
  const groupDefinitions = [
    { id: "1", label: "1部屋", match: (key) => key === "1R" || key.startsWith("1") },
    { id: "2", label: "2部屋", match: (key) => key.startsWith("2") },
    { id: "3", label: "3部屋", match: (key) => key.startsWith("3") },
    { id: "4plus", label: "4部屋以上", match: (key) => /^[4-9]/.test(key) },
  ];

  const groups = groupDefinitions.map((definition) => ({
    ...definition,
    items: [],
  }));
  const otherGroup = { id: "other", label: "その他", items: [] };

  layouts.forEach((layout) => {
    const matchedGroup = groups.find((group) => group.match(layout.key));
    if (matchedGroup) {
      matchedGroup.items.push(layout);
      return;
    }
    otherGroup.items.push(layout);
  });

  return [...groups, otherGroup].filter((group) => group.items.length > 0);
}

/** 数値を小数点第一位まで表示する */
function formatDecimal(value, suffix = "") {
  if (value == null || value === "") return "-";
  const num = Number(value);
  if (Number.isNaN(num)) return "-";
  return `${num.toFixed(1)}${suffix}`;
}

/** 価格を表示用に整形する */
function formatPrice(priceJpy) {
  if (!priceJpy) return "-";
  if (priceJpy >= 100000000) {
    const oku = Math.floor(priceJpy / 100000000);
    const man = Math.floor((priceJpy % 100000000) / 10000);
    return man > 0 ? `${oku}億${man.toLocaleString()}万円` : `${oku}億円`;
  }
  return `${Math.floor(priceJpy / 10000).toLocaleString()}万円`;
}

/** 物件の売り出し/成約状態を判定する */
function getDisplayState(property) {
  if (property.display_state) return property.display_state;
  if (property.is_sold === true) return "成約済み";
  return "売り出し中";
}

/** 国交省 不動産情報ライブラリの取引詳細 URL か判定する */
function isMlitTransactionUrl(url) {
  return Boolean(url && url.includes("reinfolib.mlit.go.jp/realEstatePrices/detail"));
}

/** 物件詳細リンクの表示ラベルを返す */
function getPropertyLinkLabel(property) {
  if (isSoldProperty(property)) return "取引情報";
  if (property.url && property.url.includes("suumo.jp")) return "SUUMO";
  return "詳細";
}

/** 物件詳細リンクの URL を返す（成約済みは国交省 URL のみ） */
function getPropertyLinkHref(property) {
  if (isSoldProperty(property)) {
    return isMlitTransactionUrl(property.url) ? property.url : null;
  }
  return property.url || null;
}

/** 成約済みかどうか */
function isSoldProperty(property) {
  return property.is_sold === true || getDisplayState(property) === "成約済み";
}

/** 売り出し中かどうか */
function isActiveProperty(property) {
  return !isSoldProperty(property);
}

/** 駅名で物件が該当するか判定する（単一駅） */
function matchesStation(property, station) {
  if (!station) return true;
  if (property.station === station) return true;

  const searchable = [
    property.property_name,
    property.address,
    property.access,
    property.memo,
  ]
    .filter(Boolean)
    .join(" ");

  return searchable.includes(station);
}

/** 複数駅のいずれかに該当するか判定する */
function matchesStations(property, stations) {
  if (!stations || stations.length === 0) return true;
  return stations.some((station) => matchesStation(property, station));
}

/** 現在選択中の駅一覧を返す */
function getSelectedStations() {
  return [...selectedStations];
}

/** 駅を選択に追加する */
function addSelectedStation(station) {
  if (!station || selectedStations.includes(station)) return false;
  if (selectedStations.length >= MAX_SELECTED_STATIONS) return false;
  selectedStations.push(station);
  return true;
}

/** 駅の選択を解除する */
function removeSelectedStation(station) {
  const index = selectedStations.indexOf(station);
  if (index === -1) return;
  selectedStations.splice(index, 1);
}

/** 入力文字列に合う駅候補を返す */
function getStationSuggestions(query) {
  const normalized = String(query || "").trim().toLowerCase();
  const matched = allStations.filter((station) => {
    if (selectedStations.includes(station)) return false;
    if (!normalized) return true;
    return station.toLowerCase().includes(normalized);
  });
  return {
    items: matched.slice(0, MAX_STATION_SUGGESTIONS),
    total: matched.length,
  };
}

/** 割安判定の基準（相場比の値引き率・%）を返す */
function getBargainThresholdPct() {
  return Number(rangeFilterState.bargain?.min ?? 10);
}

/** 現在の基準で割安物件か判定する */
function isBargainProperty(property) {
  if (!isActiveProperty(property)) return false;
  const discountRate = Number(property.discount_rate);
  if (Number.isNaN(discountRate)) return false;
  return discountRate >= getBargainThresholdPct();
}

/** 割安物件件数を更新する */
function updateBargainStat() {
  if (!elements.statBargain) return;
  const count = allProperties.filter((property) => isBargainProperty(property)).length;
  elements.statBargain.textContent = count.toLocaleString();
}

/** レンジ値の表示用ラベルを返す */
function formatRangeEndpoint(value, config, isMax) {
  if (isMax && config.unlimitedAtMax && value >= config.max) {
    return "制限なし";
  }
  return `${value}${config.unit}`;
}

/** レンジスライダーの選択範囲ラベルを返す */
function formatRangeSelection(min, max, config) {
  if (config.mode === "threshold") {
    return `相場比 ${min}${config.unit} ${config.valueLabel || "以上"}`;
  }
  return `${formatRangeEndpoint(min, config, false)}～${formatRangeEndpoint(max, config, true)}`;
}

/** 上限が「制限なし」か判定する */
function hasUnlimitedMax(rangeId) {
  const config = RANGE_FILTER_CONFIG[rangeId];
  const state = rangeFilterState[rangeId];
  return config.unlimitedAtMax && state.max >= config.max;
}

/** レンジフィルターが有効か判定する */
function isRangeFilterActive(rangeId) {
  const config = RANGE_FILTER_CONFIG[rangeId];
  const state = rangeFilterState[rangeId];
  const minActive = state.min > config.min;
  const maxActive = !hasUnlimitedMax(rangeId) && state.max < config.max;
  return minActive || maxActive;
}

/** 数値がレンジ内か判定する */
function matchesNumericRange(value, rangeId) {
  if (!isRangeFilterActive(rangeId)) return true;
  if (Number.isNaN(value)) return false;

  const state = rangeFilterState[rangeId];
  if (value < state.min) return false;
  if (hasUnlimitedMax(rangeId)) return true;

  return value <= state.max;
}

/** 面積フィルターに合うか判定する */
function matchesAreaFilter(property) {
  return matchesNumericRange(Number(property.area_m2), "area");
}

/** 徒歩分数フィルターに合うか判定する */
function matchesWalkFilter(property) {
  return matchesNumericRange(Number(property.walk_minutes), "walk");
}

/** 築年数フィルターに合うか判定する */
function matchesAgeFilter(property) {
  return matchesNumericRange(Number(property.age_years), "age");
}

/** 間取りフィルターに合うか判定する */
function matchesLayoutFilter(property) {
  if (selectedLayoutKeys.size === 0) return true;
  return selectedLayoutKeys.has(normalizeLayoutKey(property.layout));
}

/** 表示対象フィルターに合うか判定する */
function matchesStatusFilter(property, statusFilter) {
  switch (statusFilter) {
    case "active":
      return isActiveProperty(property);
    case "sold":
      return isSoldProperty(property);
    case "bargain":
      return isBargainProperty(property);
    case "all":
    default:
      return true;
  }
}

/** 物件の取引時期を表示用に取得する */
function getDisplayTransactionPeriod(property) {
  if (!isSoldProperty(property)) {
    return "";
  }

  if (property.transaction_period) {
    return property.transaction_period;
  }

  const memo = property.memo || "";
  for (const part of memo.split(" / ")) {
    const segment = part.trim();
    if (segment.startsWith("取引時期:")) {
      return segment.slice("取引時期:".length).trim();
    }
    if (segment.startsWith("販売日:")) {
      const dateText = segment.slice("販売日:".length).trim();
      const match = dateText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (match) {
        return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
      }
      return dateText;
    }
  }

  return "";
}

/** 物件の方位を表示用に取得する */
function getDisplayDirection(property) {
  if (property.direction) {
    return property.direction;
  }

  const memo = property.memo || "";
  if (!memo.includes("マンションレビュー")) {
    return "-";
  }

  const directionPattern = /^(東|西|南|北|南東|南西|北東|北西|東南|東北|西南|西北)$/;
  for (const part of memo.split(" / ")) {
    const trimmed = part.trim();
    if (directionPattern.test(trimmed)) {
      return trimmed;
    }
  }

  return "-";
}

/** 物件の階数を表示用に取得する */
function getDisplayFloor(property) {
  if (property.floor) {
    return String(property.floor);
  }

  const memo = property.memo || "";
  for (const part of memo.split(" / ")) {
    const trimmed = part.trim();
    if (/^\d{1,2}階$/.test(trimmed)) {
      return trimmed;
    }
  }

  return "-";
}

/** 階数のソート用数値を返す */
function getFloorSortValue(property) {
  const text = getDisplayFloor(property);
  const match = String(text).match(/(\d{1,2})/);
  return match ? Number(match[1]) : Number.NaN;
}

/** フィルター条件に合う物件を返す */
function getFilteredProperties() {
  const stations = getSelectedStations();
  const statusFilter = elements.filterStatus.value;
  const keyword = elements.searchInput.value.trim().toLowerCase();

  return allProperties.filter((property) => {
    if (!matchesStations(property, stations)) return false;
    if (!matchesStatusFilter(property, statusFilter)) return false;
    if (!matchesLayoutFilter(property)) return false;
    if (!matchesAreaFilter(property)) return false;
    if (!matchesWalkFilter(property)) return false;
    if (!matchesAgeFilter(property)) return false;

    if (keyword) {
      const haystack = [
        property.property_name,
        property.address,
        property.access,
        property.memo,
        property.station,
        property.layout,
        property.direction,
        getDisplayState(property),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }

    return true;
  });
}

/** ソート用の値を取得する */
function getSortValue(property, column) {
  switch (column.id) {
    case "property_name":
      return property.property_name || "";
    case "display_state":
      return getDisplayState(property);
    case "station":
      return property.station || "";
    case "walk_minutes":
      return Number(property.walk_minutes ?? Number.NaN);
    case "price_jpy":
      return Number(property.price_jpy ?? Number.NaN);
    case "unit_price_m2":
      return Number(property.unit_price_m2 ?? Number.NaN);
    case "area_m2":
      return Number(property.area_m2 ?? Number.NaN);
    case "floor":
      return getFloorSortValue(property);
    case "layout":
      return normalizeLayoutKey(property.layout) || String(property.layout || "");
    case "direction":
      return property.direction || "";
    case "transaction_period":
      return getDisplayTransactionPeriod(property);
    case "age_years":
      return Number(property.age_years ?? Number.NaN);
    default:
      return "";
  }
}

/** 並び替えを適用する */
function sortProperties(properties) {
  const column = TABLE_COLUMNS.find((item) => item.id === sortState.column);
  if (!column || !column.sortable) {
    return [...properties];
  }

  const direction = sortState.direction === "desc" ? -1 : 1;
  const sorted = [...properties];

  sorted.sort((left, right) => {
    const leftValue = getSortValue(left, column);
    const rightValue = getSortValue(right, column);

    if (column.type === "number") {
      const leftNumber = Number.isNaN(leftValue) ? Number.POSITIVE_INFINITY : leftValue;
      const rightNumber = Number.isNaN(rightValue) ? Number.POSITIVE_INFINITY : rightValue;
      return (leftNumber - rightNumber) * direction;
    }

    return String(leftValue).localeCompare(String(rightValue), "ja") * direction;
  });

  return sorted;
}

/** 列の揃えクラスを返す */
function getAlignClass(column) {
  return `align-${column.align || "start"}`;
}

/** セル用のクラス名を返す（ヘッダー・行で共通） */
function getCellClass(columnId) {
  const column = TABLE_COLUMNS.find((item) => item.id === columnId);
  if (!column) return "";
  return `${column.className} ${getAlignClass(column)}`;
}

/** テーブルヘッダーを描画する */
function renderTableHeader() {
  elements.propertyListHeader.innerHTML = TABLE_COLUMNS.map((column) => {
    const cellClass = getCellClass(column.id);

    if (!column.sortable) {
      return `<div class="${cellClass}">${column.label}</div>`;
    }

    const isActive = sortState.column === column.id;
    const indicator = isActive
      ? sortState.direction === "asc"
        ? " ▲"
        : " ▼"
      : " ↕";

    return `
      <button
        type="button"
        class="sortable-header ${cellClass}${isActive ? " active" : ""}"
        data-sort-column="${column.id}"
        aria-label="${column.label}で並べ替え"
      >
        ${column.label}<span class="sort-indicator">${indicator}</span>
      </button>
    `;
  }).join("");

  elements.propertyListHeader.querySelectorAll("[data-sort-column]").forEach((button) => {
    button.addEventListener("click", () => {
      const columnId = button.dataset.sortColumn;
      if (sortState.column === columnId) {
        sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
      } else {
        sortState.column = columnId;
        sortState.direction = "asc";
      }
      renderTableHeader();
      renderProperties();
    });
  });
}

/** フィルター変更後に一覧を先頭ページから再描画する */
function refreshPropertyList() {
  resetPage();
  renderProperties();
}

/** 間取りフィルターを描画する */
function renderLayoutFilter() {
  const layouts = getAvailableLayouts();
  const groups = groupLayoutsByRooms(layouts);
  const selectedCount = selectedLayoutKeys.size;

  const groupMarkup = groups
    .map((group) => {
      const options = group.items
        .map((layout) => {
          const isSelected = selectedLayoutKeys.has(layout.key);
          return `
            <label class="layout-option${isSelected ? " selected" : ""}">
              <input
                type="checkbox"
                value="${layout.key}"
                ${isSelected ? "checked" : ""}
              >
              <span>${layout.label}</span>
            </label>
          `;
        })
        .join("");

      return `
        <section class="layout-section" aria-label="${group.label}">
          <h3 class="layout-section-label">${group.label}</h3>
          <div class="layout-grid">${options}</div>
        </section>
      `;
    })
    .join("");

  elements.filterLayout.innerHTML = `
    <div class="layout-filter-toolbar">
      <button type="button" class="layout-toolbar-btn" data-chip-action="all">すべて</button>
      <span class="layout-toolbar-divider" aria-hidden="true"></span>
      <button type="button" class="layout-toolbar-btn" data-chip-action="clear">クリア</button>
      ${
        selectedCount > 0
          ? `<span class="layout-toolbar-status">${selectedCount}件選択中</span>`
          : ""
      }
    </div>
    <div class="layout-sections">${groupMarkup}</div>
  `;
}

/** 利用可能な間取り一覧を返す */
function getAvailableLayouts() {
  const layoutMap = new Map();

  allProperties.forEach((property) => {
    const key = normalizeLayoutKey(property.layout);
    if (!key) return;

    if (!layoutMap.has(key)) {
      layoutMap.set(key, {
        key,
        label: formatLayoutLabel(property.layout),
      });
    }
  });

  return [...layoutMap.values()].sort((left, right) =>
    compareLayoutKeys(left.key, right.key)
  );
}

/** レンジスライダーの塗りつぶし幅を更新する */
function updateRangeFill(container, config) {
  const rangeId = container.dataset.rangeId;
  const state = rangeFilterState[rangeId];
  const fill = container.querySelector(".range-fill");
  const track = container.querySelector(".range-track");
  if (!fill || !track) return;

  const span = config.max - config.min;
  const leftPercent = ((state.min - config.min) / span) * 100;

  if (config.mode === "threshold") {
    fill.style.left = `${leftPercent}%`;
    fill.style.right = "0%";
    return;
  }

  const rightPercent = ((config.max - state.max) / span) * 100;
  fill.style.left = `${leftPercent}%`;
  fill.style.right = `${rightPercent}%`;
}

/** レンジスライダーの表示を更新する */
function updateRangeFilterDisplay(container) {
  const rangeId = container.dataset.rangeId;
  const config = RANGE_FILTER_CONFIG[rangeId];
  const state = rangeFilterState[rangeId];
  const valueEl = container.querySelector(".range-filter-value");
  const minInput = container.querySelector(".range-min");
  const maxInput = container.querySelector(".range-max");

  if (valueEl) {
    valueEl.textContent = formatRangeSelection(state.min, state.max, config);
  }
  const thresholdInput = container.querySelector(".range-threshold");
  if (thresholdInput) {
    thresholdInput.value = String(state.min);
  }
  if (minInput) minInput.value = String(state.min);
  if (maxInput) maxInput.value = String(state.max);
  updateRangeFill(container, config);
}

/** レンジスライダーを初期化する */
function setupRangeFilter(container) {
  const rangeId = container.dataset.rangeId;
  const config = RANGE_FILTER_CONFIG[rangeId];
  if (!config) return;

  if (config.mode === "threshold") {
    container.innerHTML = `
      <div class="range-filter-header">
        <span class="range-filter-label">${config.label}</span>
        <span class="range-filter-value"></span>
      </div>
      <div class="range-slider">
        <div class="range-track"></div>
        <div class="range-fill"></div>
        <input type="range" class="range-threshold" min="${config.min}" max="${config.max}" step="${config.step}" value="${rangeFilterState[rangeId].min}" aria-label="${config.label}の基準">
      </div>
      <div class="range-scale">
        <span>${config.min}${config.unit}</span>
        <span>${config.max}${config.unit}</span>
      </div>
    `;

    const thresholdInput = container.querySelector(".range-threshold");
    thresholdInput.addEventListener("input", () => {
      const thresholdValue = Number(thresholdInput.value);
      rangeFilterState[rangeId] = { min: thresholdValue, max: config.max };
      updateRangeFilterDisplay(container);
      updateBargainStat();
      renderMarketSummary();
      refreshPropertyList();
    });

    updateRangeFilterDisplay(container);
    return;
  }

  container.innerHTML = `
    <div class="range-filter-header">
      <span class="range-filter-label">${config.label}</span>
      <span class="range-filter-value"></span>
    </div>
    <div class="range-slider">
      <div class="range-track"></div>
      <div class="range-fill"></div>
      <input type="range" class="range-min" min="${config.min}" max="${config.max}" step="${config.step}" value="${rangeFilterState[rangeId].min}" aria-label="${config.label}の下限">
      <input type="range" class="range-max" min="${config.min}" max="${config.max}" step="${config.step}" value="${rangeFilterState[rangeId].max}" aria-label="${config.label}の上限">
    </div>
    <div class="range-scale">
      <span>${config.min}${config.unit}</span>
      <span>${config.max}${config.unit}</span>
    </div>
  `;

  const minInput = container.querySelector(".range-min");
  const maxInput = container.querySelector(".range-max");

  const syncFromInputs = () => {
    let minValue = Number(minInput.value);
    let maxValue = Number(maxInput.value);

    if (minValue > maxValue) {
      if (document.activeElement === minInput) {
        maxValue = minValue;
        maxInput.value = String(maxValue);
      } else {
        minValue = maxValue;
        minInput.value = String(minValue);
      }
    }

    rangeFilterState[rangeId] = { min: minValue, max: maxValue };
    updateRangeFilterDisplay(container);
    refreshPropertyList();
  };

  minInput.addEventListener("input", syncFromInputs);
  maxInput.addEventListener("input", syncFromInputs);

  updateRangeFilterDisplay(container);
}

/** すべてのレンジスライダーを初期化する */
function setupRangeFilters() {
  [elements.filterArea, elements.filterAge, elements.filterWalk, elements.filterBargain].forEach(
    (container) => {
      if (container) setupRangeFilter(container);
    }
  );
}

/** チップ型フィルターをまとめて再描画する */
function renderAllChipFilters() {
  renderLayoutFilter();
}

/** チップ型フィルターの操作を初期化する */
function setupChipFilterDelegation(container, optionsOrGetter, selectedKeys) {
  const getOptions = () =>
    typeof optionsOrGetter === "function" ? optionsOrGetter() : optionsOrGetter;

  container.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-chip-action]");
    if (!actionButton) return;

    event.preventDefault();
    event.stopPropagation();

    if (actionButton.dataset.chipAction === "all") {
      getOptions().forEach((option) => selectedKeys.add(option.key));
    } else {
      selectedKeys.clear();
    }

    renderAllChipFilters();
    refreshPropertyList();
  });

  container.addEventListener("change", (event) => {
    const checkbox = event.target;
    if (!checkbox.matches('input[type="checkbox"]')) return;

    if (checkbox.checked) {
      selectedKeys.add(checkbox.value);
    } else {
      selectedKeys.delete(checkbox.value);
    }

    renderAllChipFilters();
    refreshPropertyList();
  });
}

/** 選択駅の成約相場情報を返す */
function getStationMarketInfo(station) {
  const fromSummary = marketSummary.stations?.[station];
  if (fromSummary) {
    return {
      avg_unit_price: fromSummary.avg_unit_price,
      count: fromSummary.count,
    };
  }

  const sold = allProperties.filter(
    (property) => isSoldProperty(property) && matchesStation(property, station)
  );
  if (sold.length === 0) return null;

  const total = sold.reduce((sum, property) => sum + Number(property.unit_price_m2 || 0), 0);
  return {
    avg_unit_price: total / sold.length,
    count: sold.length,
  };
}

/** 相場サマリーを描画する（選択中の駅のみ） */
function renderMarketSummary() {
  const stations = getSelectedStations();

  if (stations.length === 0) {
    elements.marketSummary.innerHTML = `
      <h2>📊 相場サマリー（成約済み）</h2>
      <p class="muted">駅を選択すると、その駅の成約相場が表示されます。</p>
    `;
    return;
  }

  let totalCount = 0;
  let weightedSum = 0;

  const cards = stations
    .map((station) => {
      const info = getStationMarketInfo(station);
      if (!info) {
        return `
          <div class="market-card">
            <strong>${station}</strong>
            <span class="muted">成約データなし</span>
          </div>
        `;
      }

      totalCount += info.count;
      weightedSum += Number(info.avg_unit_price) * info.count;

      return `
        <div class="market-card">
          <strong>${station}</strong>
          <span>平均 ${formatDecimal(info.avg_unit_price, " 万円/㎡")}</span>
          <span class="muted">成約 ${info.count} 件</span>
        </div>
      `;
    })
    .join("");

  const selectedAvg =
    totalCount > 0 ? formatDecimal(weightedSum / totalCount, " 万円/㎡") : "-";
  const threshold = formatDecimal(getBargainThresholdPct(), "%");

  elements.marketSummary.innerHTML = `
    <h2>📊 相場サマリー（成約済み）</h2>
    <div class="market-grid">${cards}</div>
    <p class="muted">選択駅の加重平均 ${selectedAvg} / 割安判定: 相場比 ${threshold} 以上お得</p>
  `;
}

/** 有効な間取り図 URL か判定する */
function isValidFloorPlanUrl(url) {
  if (!url) return false;
  const text = String(url).trim().toLowerCase();
  return text.startsWith("http") && text !== "nan" && text !== "none";
}

/** 間取り図セル HTML */
function renderFloorPlanCell(property) {
  const cellClass = getCellClass("plan");
  if (!isValidFloorPlanUrl(property.floor_plan_url)) {
    return `<div class="${cellClass}"><span class="no-plan">-</span></div>`;
  }
  return `
    <div class="${cellClass}">
      <img
        class="floor-plan-thumb"
        src="${property.floor_plan_url}"
        alt="${property.property_name || "物件"}の間取り図"
        loading="lazy"
      >
    </div>
  `;
}

/** フィルター変更時にページを先頭に戻す */
function resetPage() {
  currentPage = 1;
}

/** ページ番号一覧を生成する（省略表示付き） */
function buildPageNumbers(totalPages, page) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages, page, page - 1, page + 1]);
  const sorted = [...pages].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b);
  const result = [];

  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) {
      result.push("...");
    }
    result.push(value);
  });

  return result;
}

/** ページネーション UI を描画する */
function renderPagination(totalPages) {
  const container = elements.paginationBottom;
  if (!container) return;

  container.innerHTML = "";
  if (totalPages <= 1) return;

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "page-btn";
    prevBtn.textContent = "‹";
    prevBtn.disabled = currentPage <= 1;
    prevBtn.setAttribute("aria-label", "前のページ");
    prevBtn.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage -= 1;
        renderProperties();
        document.querySelector(".table-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    container.appendChild(prevBtn);

    buildPageNumbers(totalPages, currentPage).forEach((item) => {
      if (item === "...") {
        const ellipsis = document.createElement("span");
        ellipsis.className = "page-ellipsis";
        ellipsis.textContent = "…";
        container.appendChild(ellipsis);
        return;
      }

      const pageBtn = document.createElement("button");
      pageBtn.type = "button";
      pageBtn.className = `page-btn${item === currentPage ? " page-btn--active" : ""}`;
      pageBtn.textContent = String(item);
      pageBtn.setAttribute("aria-label", `${item} ページ目`);
      pageBtn.setAttribute("aria-current", item === currentPage ? "page" : "false");
      pageBtn.addEventListener("click", () => {
        currentPage = item;
        renderProperties();
        document.querySelector(".table-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      container.appendChild(pageBtn);
    });

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "page-btn";
    nextBtn.textContent = "›";
    nextBtn.disabled = currentPage >= totalPages;
    nextBtn.setAttribute("aria-label", "次のページ");
    nextBtn.addEventListener("click", () => {
      if (currentPage < totalPages) {
        currentPage += 1;
        renderProperties();
        document.querySelector(".table-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    container.appendChild(nextBtn);
}

/** 物件行を描画する */
function renderProperties() {
  const filtered = sortProperties(getFilteredProperties());
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIndex, startIndex + PAGE_SIZE);

  if (filtered.length === 0) {
    elements.resultCount.textContent = "表示中: 0 件";
  } else {
    const rangeStart = startIndex + 1;
    const rangeEnd = startIndex + pageItems.length;
    elements.resultCount.textContent =
      `${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} 件 / 全 ${filtered.length.toLocaleString()} 件（${currentPage} / ${totalPages} ページ）`;
  }

  renderPagination(totalPages);
  elements.propertyList.innerHTML = "";

  if (filtered.length === 0) {
    elements.emptyMessage.hidden = false;
    return;
  }

  elements.emptyMessage.hidden = true;

  pageItems.forEach((property) => {
    const displayState = getDisplayState(property);
    const isSold = isSoldProperty(property);
    const isBargain = isBargainProperty(property);
    const statusClass = isSold ? "status-sold" : "status-active";
    const row = document.createElement("article");
    row.className = `property-row${isBargain ? " bargain" : ""}${isSold ? " sold" : " active"}`;

    const bargainBadge = isBargain
      ? `<span class="badge">割安 ${formatDecimal(property.discount_rate, "%")}</span>`
      : "";

    const linkHref = getPropertyLinkHref(property);
    const linkLabel = getPropertyLinkLabel(property);
    const linkCell = linkHref
      ? `<a href="${linkHref}" target="_blank" rel="noopener noreferrer" class="link">${linkLabel}</a>`
      : `<span class="link-muted">-</span>`;

    const referenceText = property.reference_price
      ? `<div class="row-sub">相場 ${formatDecimal(property.reference_price, " 万円/㎡")}（${property.reference_basis || ""}）</div>`
      : "";

    row.innerHTML = `
      ${renderFloorPlanCell(property)}
      <div class="${getCellClass("property_name")}">
        <div class="name-line">
          <strong class="property-name">${property.property_name || "名称不明"}</strong>
          ${bargainBadge}
        </div>
        <div class="row-sub">${property.address || ""}</div>
        ${referenceText}
      </div>
      <div class="${getCellClass("display_state")}"><span class="status-badge ${statusClass}">${displayState}</span></div>
      <div class="${getCellClass("station")}">${property.station || "-"}</div>
      <div class="${getCellClass("walk_minutes")}">${property.walk_minutes ?? "-"}分</div>
      <div class="${getCellClass("price_jpy")}">${formatPrice(property.price_jpy)}</div>
      <div class="${getCellClass("unit_price_m2")}">${formatDecimal(property.unit_price_m2, " 万円/㎡")}</div>
      <div class="${getCellClass("area_m2")}">${formatDecimal(property.area_m2, " ㎡")}</div>
      <div class="${getCellClass("floor")}">${getDisplayFloor(property)}</div>
      <div class="${getCellClass("layout")}">${formatLayoutLabel(property.layout)}</div>
      <div class="${getCellClass("direction")}">${getDisplayDirection(property)}</div>
      <div class="${getCellClass("age_years")}">${property.age_years ?? "-"}年</div>
      <div class="${getCellClass("transaction_period")}">${getDisplayTransactionPeriod(property)}</div>
      <div class="${getCellClass("link")}">
        ${linkCell}
      </div>
    `;

    elements.propertyList.appendChild(row);
  });
}

/** HTML 属性用にエスケープする */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 候補クリックで駅を選択する */
function selectStationFromSuggestion(station) {
  if (!station || !addSelectedStation(station)) return false;
  onStationFilterChange();
  return true;
}

/** 駅フィルター変更時に一覧と相場を更新する */
function onStationFilterChange() {
  renderStationPicker();
  renderMarketSummary();
  refreshPropertyList();
}

/** 駅候補リストを描画する */
function renderStationSuggestions(query) {
  const list = elements.filterStation.querySelector(".station-suggestions");
  const input = elements.filterStation.querySelector(".station-picker-input");
  if (!list || !input) return;

  const { items: suggestions, total } = getStationSuggestions(query);
  stationPickerActiveIndex = -1;

  if (input.disabled) {
    list.hidden = true;
    list.innerHTML = "";
    return;
  }

  if (suggestions.length === 0) {
    list.hidden = false;
    list.innerHTML = `<li class="station-suggestion muted-item">該当する駅がありません</li>`;
    return;
  }

  const overflowHint =
    total > suggestions.length
      ? `<li class="station-suggestion muted-item">他 ${total - suggestions.length} 件 — さらに入力して絞り込んでください</li>`
      : "";

  list.hidden = false;
  list.innerHTML =
    suggestions
      .map(
        (station, index) =>
          `<li class="station-suggestion" data-station="${escapeHtml(station)}" data-index="${index}">${escapeHtml(station)}</li>`
      )
      .join("") + overflowHint;
}

/** 駅ピッカー UI を描画する */
function renderStationPicker() {
  const atLimit = selectedStations.length >= MAX_SELECTED_STATIONS;
  const chips = selectedStations
    .map(
      (station) => `
        <span class="station-chip">
          ${station}
          <button
            type="button"
            class="station-chip-remove"
            data-remove-station="${station}"
            aria-label="${station}の選択を解除"
          >×</button>
        </span>
      `
    )
    .join("");

  const hint =
    selectedStations.length === 0
      ? "未選択のときは全駅を表示します（対象: 東京23区・武蔵野市・三鷹市・横浜市・川崎市）"
      : atLimit
        ? `${MAX_SELECTED_STATIONS}駅選択中（上限）`
        : `${selectedStations.length} / ${MAX_SELECTED_STATIONS} 駅選択中`;

  elements.filterStation.innerHTML = `
    <div class="station-selected-chips">${chips}</div>
    <div class="station-picker-input-wrap">
      <input
        type="text"
        class="station-picker-input"
        placeholder="${atLimit ? "上限に達しました" : "駅名を入力..."}"
        autocomplete="off"
        ${atLimit ? "disabled" : ""}
      >
      <ul class="station-suggestions" hidden></ul>
    </div>
    <span class="station-picker-hint">${hint}</span>
  `;

  const input = elements.filterStation.querySelector(".station-picker-input");
  if (!input || atLimit) return;

  input.addEventListener("input", () => {
    renderStationSuggestions(input.value);
  });

  input.addEventListener("focus", () => {
    renderStationSuggestions(input.value);
  });

  input.addEventListener("keydown", (event) => {
    const list = elements.filterStation.querySelector(".station-suggestions");
    const items = list ? [...list.querySelectorAll(".station-suggestion:not(.muted-item)")] : [];

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (items.length === 0) return;
      stationPickerActiveIndex = (stationPickerActiveIndex + 1) % items.length;
      items.forEach((item, index) => {
        item.classList.toggle("active", index === stationPickerActiveIndex);
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length === 0) return;
      stationPickerActiveIndex =
        stationPickerActiveIndex <= 0 ? items.length - 1 : stationPickerActiveIndex - 1;
      items.forEach((item, index) => {
        item.classList.toggle("active", index === stationPickerActiveIndex);
      });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const activeItem = items[stationPickerActiveIndex];
      const station = activeItem?.dataset.station || getStationSuggestions(input.value).items[0];
      if (selectStationFromSuggestion(station)) {
        input.value = "";
      }
      return;
    }

    if (event.key === "Escape") {
      if (list) list.hidden = true;
    }
  });
}

/** 駅ピッカーの操作を初期化する */
function setupStationPicker() {
  elements.filterStation.addEventListener("mousedown", (event) => {
    const suggestion = event.target.closest(".station-suggestion:not(.muted-item)");
    if (suggestion?.dataset.station) {
      event.preventDefault();
      event.stopPropagation();
      selectStationFromSuggestion(suggestion.dataset.station);
      return;
    }
  });

  elements.filterStation.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-station]");
    if (removeButton) {
      event.preventDefault();
      removeSelectedStation(removeButton.dataset.removeStation);
      onStationFilterChange();
    }
  });

  document.addEventListener("mousedown", (event) => {
    if (!elements.filterStation.contains(event.target)) {
      const list = elements.filterStation.querySelector(".station-suggestions");
      if (list) list.hidden = true;
    }
  });
}

/** 駅選択肢をマージして重複を除く */
function mergeStationOptions(catalogStations, propertyStations) {
  const merged = new Set();
  [...(catalogStations || []), ...(propertyStations || [])].forEach((station) => {
    const normalized = String(station || "").trim();
    if (normalized) merged.add(normalized);
  });
  return [...merged].sort((left, right) => left.localeCompare(right, "ja"));
}

/** 駅カタログ JSON を読み込む */
async function loadStationCatalog() {
  try {
    const response = await fetch(`${STATIONS_URL}?t=${Date.now()}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.stations || [];
  } catch {
    return [];
  }
}

/** 駅一覧を更新する */
function setStationOptions(stations) {
  allStations = [...stations];

  for (let index = selectedStations.length - 1; index >= 0; index -= 1) {
    if (!allStations.includes(selectedStations[index])) {
      selectedStations.splice(index, 1);
    }
  }

  renderStationPicker();
}

/** 物件データ JSON を読み込む（分割ファイル対応） */
async function loadPropertyPayload() {
  const cacheBust = `t=${Date.now()}`;
  const indexResponse = await fetch(`${DATA_INDEX_URL}?${cacheBust}`);
  if (indexResponse.ok) {
    const indexData = await indexResponse.json();
    const chunkFiles = Array.isArray(indexData.chunks) ? indexData.chunks : [];
    const chunkResults = await Promise.all(
      chunkFiles.map(async (chunkName) => {
        const chunkUrl = resolveAssetUrl(`data/${chunkName}`);
        const chunkResponse = await fetch(`${chunkUrl}?${cacheBust}`);
        if (!chunkResponse.ok) {
          throw new Error(`分割データの読み込みに失敗しました (${chunkResponse.status}: ${chunkName})`);
        }
        return chunkResponse.json();
      })
    );
    return {
      ...indexData,
      properties: chunkResults.flatMap((chunk) => chunk.properties || []),
    };
  }

  const response = await fetch(`${DATA_URL}?${cacheBust}`);
  if (!response.ok) {
    throw new Error(
      `JSON の読み込みに失敗しました (${response.status})\n`
      + `試行URL: ${DATA_INDEX_URL}\n`
      + `フォールバック: ${DATA_URL}`
    );
  }
  return response.json();
}

/** JSON データを読み込んで画面を更新する */
async function loadData() {
  elements.updatedAt.textContent = "データ読み込み中...";

  const [data, catalogStations] = await Promise.all([
    loadPropertyPayload(),
    loadStationCatalog(),
  ]);

  allProperties = data.properties || [];
  marketSummary = data.market_summary || {};

  elements.updatedAt.textContent = `最終更新: ${data.updated_at}`;

  const defaultThreshold = Number(marketSummary.bargain_threshold_pct ?? 10);
  if (!Number.isNaN(defaultThreshold)) {
    rangeFilterState.bargain = { min: defaultThreshold, max: RANGE_FILTER_CONFIG.bargain.max };
    if (elements.filterBargain) {
      setupRangeFilter(elements.filterBargain);
    }
  }
  updateBargainStat();

  const propertyStations = [...new Set(allProperties.map((property) => property.station).filter(Boolean))];
  setStationOptions(mergeStationOptions(catalogStations, propertyStations.length ? propertyStations : data.stations));
  renderAllChipFilters();
  renderTableHeader();
  renderMarketSummary();
  resetPage();
  renderProperties();
}

/** イベントリスナーを設定する */
function setupEventListeners() {
  setupChipFilterDelegation(
    elements.filterLayout,
    () => getAvailableLayouts(),
    selectedLayoutKeys
  );
  setupStationPicker();
  setupRangeFilters();

  elements.filterStatus.addEventListener("change", refreshPropertyList);
  elements.searchInput.addEventListener("input", refreshPropertyList);

  elements.reloadBtn.addEventListener("click", async () => {
    try {
      await loadData();
    } catch (error) {
      alert(error.message);
    }
  });
}

/** 初期化 */
setupEventListeners();
loadData().catch((error) => {
  elements.updatedAt.textContent = "データ読み込みエラー";
  elements.emptyMessage.textContent = error.message;
  elements.emptyMessage.hidden = false;
});

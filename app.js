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
const SHARED_SEARCHES_URL = resolveAssetUrl("data/saved-searches.json");
const PAGE_SIZE = 100;
const FAVORITES_STORAGE_KEY = "bukken-dashboard:favorites";
const SAVED_SEARCHES_STORAGE_KEY = "bukken-dashboard:saved-searches";
const GITHUB_SYNC_STORAGE_KEY = "bukken-dashboard:github-sync";
const MAX_SAVED_SEARCHES = 20;
const DEFAULT_GITHUB_SYNC = {
  owner: "yhayashi0517-art",
  repo: "bukken-dashboard",
  path: "data/saved-searches.json",
  token: "",
};
const LOCAL_SYNC_URL = "http://127.0.0.1:8765/save-searches";
const LOCAL_SYNC_FORM_URL = "http://127.0.0.1:8765/save-searches-form";
const LOCAL_SYNC_HEALTH_URL = "http://127.0.0.1:8765/health";

let allProperties = [];
/** 物件ID → 物件データ */
const propertyById = new Map();
let marketSummary = {};
let currentPage = 1;
const selectedLayoutKeys = new Set();
/** 選択中の方角（未選択時はすべて対象） */
const selectedDirectionKeys = new Set();
/** 2階以上のみ表示するか */
let filterFloorMin2 = false;
/** お気に入りのみ表示するか */
let filterFavoritesOnly = false;
/** お気に入り登録済み物件（ID → エントリ） */
const favoriteEntries = new Map();
/** 保存済み検索条件 */
let savedSearches = [];
/** 共有JSONの更新日時（表示用） */
let sharedSearchesUpdatedAt = "";
/** 共有JSONを読み込めたか */
let sharedSearchesLoaded = false;
/** ローカル共有保存サーバーが使えるか */
let localSyncAvailable = false;
/** 選択中の駅（最大5件・選択順を保持） */
const selectedStations = [];
const MAX_SELECTED_STATIONS = 5;
const MAX_STATION_SUGGESTIONS = 120;
let allStations = [];
let stationPickerActiveIndex = -1;
let sortState = { column: "price_jpy", direction: "asc" };

/** 方角フィルターの選択肢（正規化キー → 表示ラベル） */
const DIRECTION_OPTIONS = [
  { key: "南", label: "南" },
  { key: "南東", label: "南東" },
  { key: "南西", label: "南西" },
  { key: "東", label: "東" },
  { key: "西", label: "西" },
  { key: "北東", label: "北東" },
  { key: "北西", label: "北西" },
  { key: "北", label: "北" },
];

/** 方角の別名を正規化するマップ */
const DIRECTION_ALIASES = {
  南: "南",
  北: "北",
  東: "東",
  西: "西",
  南東: "南東",
  南西: "南西",
  北東: "北東",
  北西: "北西",
  東南: "南東",
  西南: "南西",
  東北: "北東",
  西北: "北西",
};

/** 価格（万円）の表示ラベルを返す */
function formatPriceManYen(value) {
  const manYen = Number(value);
  if (Number.isNaN(manYen)) return "-";
  if (manYen >= 10000) {
    const oku = manYen / 10000;
    return Number.isInteger(oku) ? `${oku}億円` : `${oku.toFixed(1)}億円`;
  }
  return `${manYen.toLocaleString()}万円`;
}

/** レンジスライダー設定（上限値は添付画像に準拠） */
const RANGE_FILTER_CONFIG = {
  price: {
    label: "価格",
    min: 0,
    max: 30000,
    step: 100,
    unit: "万円",
    unlimitedAtMax: true,
    formatValue: (value, isMax, config) => {
      if (isMax && config.unlimitedAtMax && value >= config.max) {
        return "制限なし";
      }
      return formatPriceManYen(value);
    },
  },
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
  price: { min: 0, max: 30000 },
  area: { min: 0, max: 120 },
  age: { min: 0, max: 50 },
  walk: { min: 0, max: 30 },
  bargain: { min: 10, max: 30 },
};

const TABLE_COLUMNS = [
  { id: "favorite", label: "★", sortable: false, className: "col-favorite", align: "center" },
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
  { id: "info_updated_date", label: "情報更新日", sortable: true, type: "string", className: "col-updated", align: "center" },
  { id: "link", label: "詳細", sortable: false, className: "col-link", align: "center" },
];

const elements = {
  updatedAt: document.getElementById("updated-at"),
  filterStation: document.getElementById("filter-station"),
  filterStatus: document.getElementById("filter-status"),
  filterLayout: document.getElementById("filter-layout"),
  filterFloorMin2: document.getElementById("filter-floor-min2"),
  filterDirection: document.getElementById("filter-direction"),
  filterPrice: document.getElementById("filter-price"),
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
  clearFiltersBtn: document.getElementById("clear-filters-btn"),
  filterFavoritesOnly: document.getElementById("filter-favorites-only"),
  favoritesCount: document.getElementById("favorites-count"),
  savedSearchName: document.getElementById("saved-search-name"),
  saveSearchBtn: document.getElementById("save-search-btn"),
  saveLineNotify: document.getElementById("save-line-notify"),
  exportSharedSearchesBtn: document.getElementById("export-shared-searches-btn"),
  importSharedSearchesBtn: document.getElementById("import-shared-searches-btn"),
  importSharedSearchesInput: document.getElementById("import-shared-searches-input"),
  githubTokenInput: document.getElementById("github-token-input"),
  saveGithubTokenBtn: document.getElementById("save-github-token-btn"),
  mobileFilterToggle: document.getElementById("mobile-filter-toggle"),
  filterPanel: document.getElementById("filter-panel"),
  sharedSearchesStatus: document.getElementById("shared-searches-status"),
  savedSearchList: document.getElementById("saved-search-list"),
  archivedFavoritesPanel: document.getElementById("archived-favorites-panel"),
  archivedFavoritesSummaryLabel: document.getElementById("archived-favorites-summary-label"),
  archivedFavoritesList: document.getElementById("archived-favorites-list"),
  paginationBottom: document.getElementById("pagination-bottom"),
};

/** 物件を一意に識別するIDを返す（お気に入りは SUUMO URL を優先） */
function getPropertyId(property) {
  if (property.listing_url) return String(property.listing_url);
  if (property.url) return String(property.url);
  return [
    property.property_name || "",
    property.station || "",
    property.price_jpy || "",
    property.area_m2 || "",
    property.layout || "",
    property.scraped_at || "",
  ].join("|");
}

/** お気に入り保存用の物件スナップショットを作る */
function buildFavoriteSnapshot(property) {
  return {
    property_name: property.property_name || "",
    station: property.station || "",
    walk_minutes: property.walk_minutes ?? null,
    price_jpy: property.price_jpy ?? null,
    area_m2: property.area_m2 ?? null,
    layout: property.layout || "",
    address: property.address || "",
    display_state: getDisplayState(property),
    url: property.url || property.listing_url || "",
    listing_url: property.listing_url || property.url || "",
  };
}

/** 物件インデックスを再構築する */
function rebuildPropertyIndex() {
  propertyById.clear();
  allProperties.forEach((property) => {
    const primaryId = getPropertyId(property);
    propertyById.set(primaryId, property);
    if (property.listing_url) {
      propertyById.set(String(property.listing_url), property);
    }
    if (property.url) {
      propertyById.set(String(property.url), property);
    }
  });
}

/** localStorage から JSON を読み込む */
function readStorageJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** localStorage に JSON を保存する */
function writeStorageJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** お気に入りエントリを正規化する */
function normalizeFavoriteEntry(raw) {
  if (typeof raw === "string") {
    return { id: raw, savedAt: "", snapshot: null };
  }
  if (!raw || !raw.id) return null;
  return {
    id: String(raw.id),
    savedAt: raw.savedAt || "",
    snapshot: raw.snapshot || null,
  };
}

/** お気に入りを読み込む */
function loadFavorites() {
  const stored = readStorageJson(FAVORITES_STORAGE_KEY, []);
  favoriteEntries.clear();
  if (Array.isArray(stored)) {
    stored.forEach((raw) => {
      const entry = normalizeFavoriteEntry(raw);
      if (entry) favoriteEntries.set(entry.id, entry);
    });
  }
  updateFavoritesCount();
}

/** お気に入りを保存する */
function saveFavorites() {
  const payload = [...favoriteEntries.values()].map((entry) => ({
    id: entry.id,
    savedAt: entry.savedAt,
    snapshot: entry.snapshot,
  }));
  writeStorageJson(FAVORITES_STORAGE_KEY, payload);
  updateFavoritesCount();
}

/** データ更新後にお気に入りスナップショットを同期する */
function syncFavoriteSnapshots() {
  let changed = false;
  favoriteEntries.forEach((entry) => {
    const property = propertyById.get(entry.id);
    if (!property) return;
    const snapshot = buildFavoriteSnapshot(property);
    const prev = JSON.stringify(entry.snapshot || {});
    const next = JSON.stringify(snapshot);
    if (prev !== next) {
      entry.snapshot = snapshot;
      changed = true;
    }
  });
  if (changed) saveFavorites();
}

/** お気に入りIDが登録済みか判定する */
function isFavoriteId(propertyId) {
  return favoriteEntries.has(propertyId);
}

/** お気に入り登録済みか判定する */
function isFavoriteProperty(property) {
  return isFavoriteId(getPropertyId(property));
}

/** お気に入りの登録状態を切り替える */
function toggleFavoriteProperty(property) {
  const propertyId = getPropertyId(property);
  if (favoriteEntries.has(propertyId)) {
    favoriteEntries.delete(propertyId);
  } else {
    favoriteEntries.set(propertyId, {
      id: propertyId,
      savedAt: new Date().toISOString(),
      snapshot: buildFavoriteSnapshot(property),
    });
  }
  saveFavorites();
  renderArchivedFavorites();
}

/** お気に入り物件を解決する（データになければスナップショットを使う） */
function resolveFavoriteProperty(entry) {
  const property = propertyById.get(entry.id);
  if (property) return property;
  if (!entry.snapshot) return null;

  const snapshot = entry.snapshot;
  const isSold = snapshot.display_state === "成約済み";
  return {
    ...snapshot,
    listing_url: entry.id,
    url: snapshot.url || entry.id,
    is_archived_snapshot: true,
    is_active: false,
    is_delisted: !isSold,
    is_sold: isSold,
    display_state: snapshot.display_state || "掲載終了",
  };
}

/** 掲載終了・成約など、掲載中でないお気に入りか判定する */
function isArchivedFavoriteEntry(entry) {
  const property = resolveFavoriteProperty(entry);
  if (!property) return true;
  return !isActiveProperty(property);
}

/** 掲載中のお気に入り一覧を返す */
function getActiveFavoriteEntries() {
  return [...favoriteEntries.values()].filter((entry) => !isArchivedFavoriteEntry(entry));
}

/** 掲載終了のお気に入り一覧を返す */
function getArchivedFavoriteEntries() {
  return [...favoriteEntries.values()].filter((entry) => isArchivedFavoriteEntry(entry));
}

/** お気に入り件数表示を更新する */
function updateFavoritesCount() {
  if (!elements.favoritesCount) return;
  const activeCount = getActiveFavoriteEntries().length;
  const archivedCount = getArchivedFavoriteEntries().length;
  const total = favoriteEntries.size;
  if (archivedCount > 0) {
    elements.favoritesCount.textContent =
      `${total.toLocaleString()}件登録（掲載中 ${activeCount.toLocaleString()} / 掲載終了 ${archivedCount.toLocaleString()}）`;
    return;
  }
  elements.favoritesCount.textContent = `${total.toLocaleString()}件登録`;
}

/** 保存済み検索条件を正規化する */
function normalizeSavedSearches(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && item.state && typeof item.state === "object")
    .map((item) => ({
      id: item.id || `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: item.name || "名称なし",
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
      lineNotify: Boolean(item.lineNotify ?? item.enabled),
      state: item.state,
    }));
}

/** 端末保存と共有保存を ID 単位で統合する（端末側を優先しつつ欠落を補完） */
function mergeSavedSearches(localItems, remoteItems) {
  const map = new Map();

  const upsert = (item, preferLocal) => {
    if (!item?.id) return;
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
      return;
    }
    const prevTime = Date.parse(prev.updatedAt || prev.createdAt) || 0;
    const nextTime = Date.parse(item.updatedAt || item.createdAt) || 0;
    if (preferLocal || nextTime >= prevTime) {
      map.set(item.id, item);
    }
  };

  // 先に共有、後から端末（同 ID は端末を優先）
  normalizeSavedSearches(remoteItems).forEach((item) => upsert(item, false));
  normalizeSavedSearches(localItems).forEach((item) => upsert(item, true));

  return [...map.values()].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || a.createdAt) || 0;
    const bTime = Date.parse(b.updatedAt || b.createdAt) || 0;
    return bTime - aTime;
  });
}

/** 共有JSON用のペイロードを作る */
function buildSharedSavedSearchesPayload() {
  return {
    updated_at: new Date().toISOString(),
    searches: savedSearches.map((item) => ({
      id: item.id,
      name: item.name,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt || item.createdAt,
      lineNotify: Boolean(item.lineNotify),
      state: item.state,
    })),
  };
}

/** 共有条件の表示ステータスを更新する */
function updateSharedSearchesStatus(extraMessage = "") {
  if (!elements.sharedSearchesStatus) return;
  const sync = getGitHubSyncConfig();
  const tokenReady = Boolean(sync.token);
  let text = "";
  if (sharedSearchesLoaded && sharedSearchesUpdatedAt) {
    const label = String(sharedSearchesUpdatedAt).replace("T", " ").replace(/\.\d+Z?$/, "");
    text = `共有条件を読み込みました（更新: ${label} / ${savedSearches.length}件）`;
  } else if (sharedSearchesLoaded) {
    text = `共有条件を読み込みました（${savedSearches.length}件）`;
  } else {
    text = "共有条件未取得のため、この端末の保存内容を表示しています。";
  }
  if (localSyncAvailable) {
    text += " / PC保存サーバー: 接続中";
  } else if (tokenReady) {
    text += " / GitHub連携: トークン設定済み";
  } else {
    text += " / PC保存サーバー未起動（このPCで共有保存するならサーバー起動が必要）";
  }
  if (extraMessage) {
    text += ` / ${extraMessage}`;
  }
  elements.sharedSearchesStatus.textContent = text;
}

/** ローカル共有保存サーバーの生存確認 */
async function checkLocalSyncServer() {
  try {
    const response = await fetch(`${LOCAL_SYNC_HEALTH_URL}?t=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
    });
    localSyncAvailable = response.ok;
  } catch (_error) {
    localSyncAvailable = false;
  }
  return localSyncAvailable;
}

/** ローカルサーバーへフォーム送信する（HTTPSのGitHub Pagesからでも動作） */
function publishSharedSavedSearchesViaLocalForm(payload) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = LOCAL_SYNC_FORM_URL;
  form.target = "_blank";
  form.rel = "noopener";

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "payload";
  input.value = JSON.stringify(payload);
  form.appendChild(input);

  document.body.appendChild(form);
  form.submit();
  form.remove();
  return {
    message: "PC保存サーバーへ送信しました。開いたページで結果を確認してください。",
  };
}

/** 検索条件を GitHub に保存して両端末で共有する */
async function publishSharedSavedSearches() {
  const button = elements.exportSharedSearchesBtn;
  const originalLabel = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "保存中...";
  }
  updateSharedSearchesStatus("共有保存中...");

  try {
    const payload = buildSharedSavedSearchesPayload();
    // GitHub Pages(HTTPS) からは localhost(HTTP) への fetch が遮断されるため、
    // フォーム送信で PC 保存サーバーへ送る。
    const localResult = publishSharedSavedSearchesViaLocalForm(payload);

    savedSearches = normalizeSavedSearches(payload.searches);
    sharedSearchesUpdatedAt = payload.updated_at;
    sharedSearchesLoaded = true;
    persistSavedSearches();
    renderSavedSearches();
    updateSharedSearchesStatus(localResult.message);
    alert(
      "PCの保存サーバーへ送信しました。\n"
        + "新しく開いたページに「成功」と出ていれば完了です。\n"
        + "接続エラーの場合は、このPCで共有保存サーバーを起動してください。"
    );
  } catch (error) {
    updateSharedSearchesStatus("保存に失敗しました");
    alert(`保存に失敗しました。\n${error.message || error}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel || "検索条件をスマホ共有用に保存";
    }
  }
}

/** GitHub 連携設定を読み込む */
function getGitHubSyncConfig() {
  const stored = readStorageJson(GITHUB_SYNC_STORAGE_KEY, {});
  return {
    ...DEFAULT_GITHUB_SYNC,
    ...(stored && typeof stored === "object" ? stored : {}),
  };
}

/** GitHub 連携設定を保存する */
function persistGitHubSyncConfig(config) {
  return writeStorageJson(GITHUB_SYNC_STORAGE_KEY, config);
}

/** GitHub トークン入力欄を同期する */
function syncGitHubTokenInput() {
  if (!elements.githubTokenInput) return;
  const config = getGitHubSyncConfig();
  elements.githubTokenInput.value = config.token ? "********" : "";
  elements.githubTokenInput.dataset.hasToken = config.token ? "1" : "0";
}

/** GitHub トークンを保存する */
function saveGitHubTokenFromInput() {
  if (!elements.githubTokenInput) return;
  const value = elements.githubTokenInput.value.trim();
  const config = getGitHubSyncConfig();
  if (!value || value === "********") {
    if (!config.token) {
      alert("GitHub の Personal Access Token を入力してください。");
    } else {
      alert("トークンはすでに保存されています。");
    }
    syncGitHubTokenInput();
    updateSharedSearchesStatus();
    return;
  }
  config.token = value;
  if (!persistGitHubSyncConfig(config)) {
    alert("トークンの保存に失敗しました。");
    return;
  }
  syncGitHubTokenInput();
  updateSharedSearchesStatus("トークンを保存しました");
  alert(
    "GitHub トークンをこの端末に保存しました。\n"
      + "「検索条件をスマホ共有用に保存」を押すと、両端末へ反映できます。"
  );
}

/** UTF-8 文字列を Base64 に変換する（GitHub API 用） */
function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

/** GitHub 上の共有JSONの SHA を取得する */
async function fetchGitHubFileSha(config) {
  const url =
    `https://api.github.com/repos/${encodeURIComponent(config.owner)}/`
    + `${encodeURIComponent(config.repo)}/contents/${config.path}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ファイル情報の取得に失敗しました (${response.status})\n${detail}`);
  }
  const data = await response.json();
  return data.sha || null;
}

/** JSON をファイルとしてダウンロードする */
function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 保存済み検索条件を読み込む（端末ローカル） */
function loadSavedSearches() {
  const stored = readStorageJson(SAVED_SEARCHES_STORAGE_KEY, []);
  savedSearches = normalizeSavedSearches(stored);
}

/** 保存済み検索条件を端末ローカルに保存する */
function persistSavedSearches() {
  return writeStorageJson(SAVED_SEARCHES_STORAGE_KEY, savedSearches);
}

/** GitHub 上の共有JSONを読み込む（端末の保存を消さずマージする） */
async function loadSharedSavedSearches() {
  sharedSearchesLoaded = false;
  sharedSearchesUpdatedAt = "";
  const localItems = [...savedSearches];
  try {
    const response = await fetch(`${SHARED_SEARCHES_URL}?t=${Date.now()}`);
    if (response.status === 404) return false;
    if (!response.ok) return false;
    const data = await response.json();
    const remoteItems = normalizeSavedSearches(data.searches || []);
    savedSearches = mergeSavedSearches(localItems, remoteItems);
    sharedSearchesUpdatedAt = data.updated_at || "";
    sharedSearchesLoaded = true;
    persistSavedSearches();
    return true;
  } catch (_error) {
    return false;
  }
}

/** 共有条件 JSON をファイルから読み込む */
function importSharedSavedSearchesFromFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || ""));
      const searches = normalizeSavedSearches(data.searches || data.rules || []);
      if (searches.length === 0 && !Array.isArray(data.searches)) {
        throw new Error("searches 配列が見つかりません");
      }
      if (searches.length > MAX_SAVED_SEARCHES) {
        alert(`保存できる検索条件は最大 ${MAX_SAVED_SEARCHES} 件です。`);
        return;
      }
      savedSearches = searches;
      sharedSearchesUpdatedAt = data.updated_at || new Date().toISOString();
      sharedSearchesLoaded = false;
      if (!persistSavedSearches()) {
        alert("読み込み後の保存に失敗しました。");
        return;
      }
      renderSavedSearches();
      updateSharedSearchesStatus();
      alert(`検索条件を ${searches.length} 件読み込みました。\n共有するには「共有条件をエクスポート」から公開してください。`);
    } catch (error) {
      alert(`ファイルの読み込みに失敗しました。\n${error.message || error}`);
    }
  };
  reader.readAsText(file, "utf-8");
}

/** 現在のフィルター状態をシリアライズする */
function captureFilterState() {
  return {
    search: elements.searchInput.value,
    status: elements.filterStatus.value,
    stations: [...selectedStations],
    layouts: [...selectedLayoutKeys],
    directions: [...selectedDirectionKeys],
    floorMin2: filterFloorMin2,
    favoritesOnly: filterFavoritesOnly,
    ranges: JSON.parse(JSON.stringify(rangeFilterState)),
    sort: { ...sortState },
  };
}

/** フィルター状態の表示用ラベルを生成する */
function summarizeFilterState(state) {
  const parts = [];

  if (state.stations?.length) {
    const stationText = state.stations.slice(0, 2).join("・");
    parts.push(
      state.stations.length > 2 ? `${stationText}ほか${state.stations.length}駅` : stationText
    );
  }

  if (state.status === "sold") parts.push("成約のみ");
  else if (state.status === "bargain") parts.push("割安のみ");
  else if (state.status === "all") parts.push("すべて");
  else parts.push("売出中");

  if (state.favoritesOnly) parts.push("お気に入り");
  if (state.floorMin2) parts.push("2階以上");
  if (state.layouts?.length) {
    parts.push(
      state.layouts.length <= 4
        ? state.layouts.join("/")
        : `間取り ${state.layouts.length}件`
    );
  }
  if (state.directions?.length) {
    parts.push(
      state.directions.length <= 4
        ? state.directions.join("・")
        : `方角 ${state.directions.length}件`
    );
  }

  const ranges = state.ranges || {};
  if (ranges.price && isSerializedRangeActive(ranges.price, "price")) {
    parts.push(
      `価格 ${formatRangeEndpoint(ranges.price.min, RANGE_FILTER_CONFIG.price, false)}～${formatRangeEndpoint(ranges.price.max, RANGE_FILTER_CONFIG.price, true)}`
    );
  }
  if (ranges.area && isSerializedRangeActive(ranges.area, "area")) {
    parts.push(`面積 ${ranges.area.min}～${ranges.area.max}㎡`);
  }
  if (ranges.walk && isSerializedRangeActive(ranges.walk, "walk")) {
    parts.push(`徒歩 ${ranges.walk.min}～${ranges.walk.max}分`);
  }
  if (state.search?.trim()) parts.push(`「${state.search.trim()}」`);

  return parts.join(" / ") || "すべての条件";
}

/** 保存済みレンジが有効か判定する */
function isSerializedRangeActive(rangeState, rangeId) {
  const config = RANGE_FILTER_CONFIG[rangeId];
  if (!config || !rangeState) return false;
  const minActive = Number(rangeState.min) > config.min;
  const maxActive = !(config.unlimitedAtMax && Number(rangeState.max) >= config.max) && Number(rangeState.max) < config.max;
  return minActive || maxActive;
}

/** 保存名のデフォルトを生成する */
function buildDefaultSearchName(state) {
  const summary = summarizeFilterState(state);
  if (summary === "すべての条件") {
    return `検索条件 ${new Date().toLocaleString("ja-JP")}`;
  }
  return summary.length > 40 ? `${summary.slice(0, 37)}...` : summary;
}

/** 保存済み検索条件一覧を描画する */
function renderSavedSearches() {
  if (!elements.savedSearchList) return;

  if (savedSearches.length === 0) {
    elements.savedSearchList.innerHTML = `<p class="saved-search-empty">保存した条件はまだありません。</p>`;
    return;
  }

  elements.savedSearchList.innerHTML = savedSearches
    .map((item) => {
      const name = escapeHtml(item.name || "名称なし");
      const summary = escapeHtml(summarizeFilterState(item.state));
      const lineActive = Boolean(item.lineNotify);
      return `
        <article class="saved-search-item" data-search-id="${escapeHtml(item.id)}">
          <div class="saved-search-item-head">
            <strong class="saved-search-item-name">${name}</strong>
            ${lineActive ? '<span class="saved-search-line-badge">LINE</span>' : ""}
          </div>
          <p class="saved-search-item-summary">${summary}</p>
          <div class="saved-search-item-actions">
            <button type="button" class="page-btn" data-search-action="apply">適用</button>
            <button type="button" class="page-btn${lineActive ? " is-active" : ""}" data-search-action="line">${lineActive ? "LINE ON" : "LINE OFF"}</button>
            <button type="button" class="page-btn is-danger" data-search-action="delete">削除</button>
          </div>
        </article>
      `;
    })
    .join("");
}

/** LINE 通知対象の切り替え */
function toggleLineNotify(searchId) {
  const saved = savedSearches.find((item) => item.id === searchId);
  if (!saved) return;
  saved.lineNotify = !saved.lineNotify;
  saved.updatedAt = new Date().toISOString();
  persistSavedSearches();
  sharedSearchesLoaded = false;
  renderSavedSearches();
  updateSharedSearchesStatus();
}

/** 現在の検索条件を保存する */
function saveCurrentSearch() {
  const state = captureFilterState();
  const inputName = elements.savedSearchName?.value.trim() || "";
  const name = inputName || buildDefaultSearchName(state);

  if (savedSearches.length >= MAX_SAVED_SEARCHES) {
    alert(`保存できる検索条件は最大 ${MAX_SAVED_SEARCHES} 件です。不要な条件を削除してください。`);
    return;
  }

  const now = new Date().toISOString();
  savedSearches.unshift({
    id: `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: now,
    updatedAt: now,
    lineNotify: Boolean(elements.saveLineNotify?.checked),
    state,
  });

  if (!persistSavedSearches()) {
    savedSearches.shift();
    alert("検索条件の保存に失敗しました。ブラウザの保存容量を確認してください。");
    return;
  }

  if (elements.savedSearchName) {
    elements.savedSearchName.value = "";
  }
  if (elements.saveLineNotify) {
    elements.saveLineNotify.checked = false;
  }
  sharedSearchesLoaded = false;
  renderSavedSearches();
  updateSharedSearchesStatus("この端末に保存しました（再読み込み後も残ります）");
}

/** 保存済み検索条件を適用する */
function applySavedSearch(searchId) {
  const saved = savedSearches.find((item) => item.id === searchId);
  if (!saved) return;
  applyFilterState(saved.state);
}

/** 保存済み検索条件を削除する */
function deleteSavedSearch(searchId) {
  const index = savedSearches.findIndex((item) => item.id === searchId);
  if (index === -1) return;
  savedSearches.splice(index, 1);
  persistSavedSearches();
  sharedSearchesLoaded = false;
  renderSavedSearches();
  updateSharedSearchesStatus();
}

/** フィルター状態を復元する */
function applyFilterState(state) {
  if (!state) return;

  elements.searchInput.value = state.search || "";
  elements.filterStatus.value = state.status || "active";

  selectedStations.splice(0, selectedStations.length);
  (state.stations || []).forEach((station) => {
    if (station && selectedStations.length < MAX_SELECTED_STATIONS) {
      selectedStations.push(station);
    }
  });

  selectedLayoutKeys.clear();
  (state.layouts || []).forEach((key) => selectedLayoutKeys.add(key));

  selectedDirectionKeys.clear();
  (state.directions || []).forEach((key) => selectedDirectionKeys.add(key));

  filterFloorMin2 = Boolean(state.floorMin2);
  if (elements.filterFloorMin2) {
    elements.filterFloorMin2.checked = filterFloorMin2;
  }

  filterFavoritesOnly = Boolean(state.favoritesOnly);
  if (elements.filterFavoritesOnly) {
    elements.filterFavoritesOnly.checked = filterFavoritesOnly;
  }

  const defaults = getDefaultRangeFilterState();
  Object.keys(defaults).forEach((rangeId) => {
    const savedRange = state.ranges?.[rangeId];
    rangeFilterState[rangeId] = savedRange
      ? { min: Number(savedRange.min), max: Number(savedRange.max) }
      : { ...defaults[rangeId] };
  });

  if (state.sort?.column) {
    sortState = {
      column: state.sort.column,
      direction: state.sort.direction === "desc" ? "desc" : "asc",
    };
  }

  stationPickerActiveIndex = -1;
  renderStationPicker();
  renderAllChipFilters();
  updateAllRangeFilterDisplays();
  renderTableHeader();
  updateBargainStat();
  renderMarketSummary();
  refreshPropertyList();
}

/** お気に入りボタン HTML を返す */
function renderFavoriteCell(property) {
  const propertyId = getPropertyId(property);
  const isActive = isFavoriteId(propertyId);
  return `
    <div ${getCellProps("favorite")}>
      <button
        type="button"
        class="favorite-btn${isActive ? " is-active" : ""}"
        data-property-id="${escapeHtml(propertyId)}"
        aria-label="${isActive ? "お気に入り解除" : "お気に入り登録"}"
        aria-pressed="${isActive ? "true" : "false"}"
      >★</button>
    </div>
  `;
}

/** 掲載終了お気に入りの状態バッジクラスを返す */
function getArchivedFavoriteStatusClass(property) {
  if (isSoldProperty(property)) return "status-sold";
  if (isDelistedProperty(property)) return "status-delisted";
  return "status-delisted";
}

/** 掲載終了お気に入り一覧を描画する */
function renderArchivedFavorites() {
  if (!elements.archivedFavoritesPanel || !elements.archivedFavoritesList) return;

  const archivedEntries = getArchivedFavoriteEntries();
  updateFavoritesCount();

  if (archivedEntries.length === 0) {
    elements.archivedFavoritesPanel.hidden = true;
    elements.archivedFavoritesList.innerHTML = "";
    if (elements.archivedFavoritesSummaryLabel) {
      elements.archivedFavoritesSummaryLabel.textContent = "お気に入り（掲載終了）";
    }
    return;
  }

  elements.archivedFavoritesPanel.hidden = false;
  if (elements.archivedFavoritesSummaryLabel) {
    elements.archivedFavoritesSummaryLabel.textContent =
      `お気に入り（掲載終了）（${archivedEntries.length.toLocaleString()}件）`;
  }
  elements.archivedFavoritesList.innerHTML = archivedEntries
    .map((entry) => {
      const property = resolveFavoriteProperty(entry);
      if (!property) return "";

      const propertyId = entry.id;
      const displayState = getDisplayState(property);
      const statusClass = getArchivedFavoriteStatusClass(property);
      const linkHref = getPropertyLinkHref(property);
      const linkLabel = getPropertyLinkLabel(property);
      const linkMarkup = linkHref
        ? `<a href="${escapeHtml(linkHref)}" target="_blank" rel="noopener noreferrer" class="link">${escapeHtml(linkLabel)}</a>`
        : `<span class="link-muted">リンクなし</span>`;

      return `
        <article class="archived-favorite-card" data-property-id="${escapeHtml(propertyId)}">
          <div class="archived-favorite-main">
            <div class="archived-favorite-title-row">
              <strong>${escapeHtml(property.property_name || "名称不明")}</strong>
              <span class="status-badge ${statusClass}">${escapeHtml(displayState)}</span>
            </div>
            <p class="archived-favorite-meta">
              ${escapeHtml(property.station || "-")} /
              徒歩 ${escapeHtml(property.walk_minutes ?? "-")}分 /
              ${escapeHtml(formatPrice(property.price_jpy))} /
              ${escapeHtml(formatLayoutLabel(property.layout))} /
              ${escapeHtml(formatDecimal(property.area_m2, "㎡"))}
            </p>
            <p class="archived-favorite-address">${escapeHtml(property.address || "")}</p>
          </div>
          <div class="archived-favorite-actions">
            ${linkMarkup}
            <button
              type="button"
              class="page-btn is-danger archived-favorite-remove"
              data-property-id="${escapeHtml(propertyId)}"
            >お気に入り解除</button>
          </div>
        </article>
      `;
    })
    .join("");
}

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
  if (property.is_delisted === true) return "掲載終了";
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

/** 掲載終了かどうか */
function isDelistedProperty(property) {
  return property.is_delisted === true || getDisplayState(property) === "掲載終了";
}

/** 売り出し中かどうか */
function isActiveProperty(property) {
  return !isSoldProperty(property) && !isDelistedProperty(property);
}

/** 駅名のヶ/ケ・ツ/ッ表記ゆれを比較用に揃える */
function normalizeStationKanaVariant(name) {
  return String(name || "").replace(/ケ/g, "ヶ").replace(/ッ/g, "ツ");
}

/** 表示用に優先する駅名表記 */
const PREFERRED_STATION_SPELLINGS = [
  "阿佐ヶ谷",
  "南阿佐ヶ谷",
  "市ヶ谷",
  "希望ヶ丘",
  "鶴ヶ峰",
  "幡ヶ谷",
  "井土ヶ谷",
  "向ヶ丘遊園",
  "祖師ヶ谷大蔵",
  "新百合ヶ丘",
  "百合ヶ丘",
  "梅ヶ丘",
  "富士見ヶ丘",
  "鐘ヶ淵",
  "雑司ヶ谷",
  "都電雑司ヶ谷",
  "つつじヶ丘",
  "西ヶ原四丁目",
  "保土ケ谷",
  "千駄ケ谷",
  "西ケ原",
  "霞ケ関",
];

const PREFERRED_STATION_BY_KEY = Object.fromEntries(
  PREFERRED_STATION_SPELLINGS.map((name) => [normalizeStationKanaVariant(name), name])
);

/** 駅名を表示・検索用に正規化する */
function canonicalizeStationName(name) {
  let text = String(name || "").trim();
  if (!text) return "";
  if (text.endsWith("駅")) {
    text = text.slice(0, -1).trim();
  }
  if (/^jujo eki$/i.test(text)) {
    return "十条";
  }

  text = text.replace(/（/g, "(").replace(/）/g, ")");
  if (text.startsWith("押上") && text.includes("スカイツリー")) {
    return "押上";
  }

  let match = text.match(/^(.+?)\((東京|神奈川)\)$/);
  if (match) {
    text = match[1];
  } else {
    match = text.match(/^(.+?)\((.+)\)$/);
    if (match) {
      const base = match[1];
      const suffix = match[2];
      if (/(メトロ|交通局|電鉄|モノレール|エクスプレス|その他)/.test(suffix)) {
        text = base;
      } else if (normalizeStationKanaVariant(base) === normalizeStationKanaVariant(suffix)) {
        text = PREFERRED_STATION_BY_KEY[normalizeStationKanaVariant(base)]
          || (base.includes("ヶ") || base.includes("ッ") ? base : suffix);
      }
    }
  }

  return PREFERRED_STATION_BY_KEY[normalizeStationKanaVariant(text)] || text;
}

/** 駅名で物件が該当するか判定する（単一駅） */
function matchesStation(property, station) {
  if (!station) return true;
  const propertyStation = canonicalizeStationName(property.station);
  const targetStation = canonicalizeStationName(station);
  if (propertyStation === targetStation) return true;
  if (normalizeStationKanaVariant(propertyStation) === normalizeStationKanaVariant(targetStation)) {
    return true;
  }

  const searchable = [
    property.property_name,
    property.address,
    property.access,
    property.memo,
  ]
    .filter(Boolean)
    .join(" ");

  return searchable.includes(targetStation) || searchable.includes(station);
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
  if (typeof config.formatValue === "function") {
    return config.formatValue(value, isMax, config);
  }
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

/** 価格フィルターに合うか判定する（スライダー単位は万円） */
function matchesPriceFilter(property) {
  const priceJpy = Number(property.price_jpy);
  if (Number.isNaN(priceJpy) || priceJpy <= 0) {
    return !isRangeFilterActive("price");
  }
  return matchesNumericRange(priceJpy / 10000, "price");
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

/** お気に入りフィルターに合うか判定する */
function matchesFavoritesFilter(property) {
  if (!filterFavoritesOnly) return true;
  return isFavoriteProperty(property) && isActiveProperty(property);
}

/** 間取りフィルターに合うか判定する */
function matchesLayoutFilter(property) {
  if (selectedLayoutKeys.size === 0) return true;
  return selectedLayoutKeys.has(normalizeLayoutKey(property.layout));
}

/** 方角表記を正規化キーに変換する */
function normalizeDirectionKey(direction) {
  if (!direction || direction === "-") return "";
  const text = toHalfWidth(String(direction)).replace(/\s/g, "");
  return DIRECTION_ALIASES[text] || "";
}

/** 物件の正規化済み方角を返す */
function getNormalizedDirection(property) {
  return normalizeDirectionKey(getDisplayDirection(property));
}

/** 階数フィルター（2階以上）に合うか判定する */
function matchesFloorFilter(property) {
  if (!filterFloorMin2) return true;
  const floorValue = getFloorSortValue(property);
  if (Number.isNaN(floorValue)) return false;
  return floorValue >= 2;
}

/** 方角フィルターに合うか判定する */
function matchesDirectionFilter(property) {
  if (selectedDirectionKeys.size === 0) return true;
  const key = getNormalizedDirection(property);
  if (!key) return false;
  return selectedDirectionKeys.has(key);
}

/** 表示対象フィルターに合うか判定する */
function matchesStatusFilter(property, statusFilter) {
  if (isDelistedProperty(property)) {
    return false;
  }
  switch (statusFilter) {
    case "active":
      return isActiveProperty(property);
    case "sold":
      return isSoldProperty(property);
    case "bargain":
      return isBargainProperty(property);
    case "all":
    default:
      return isActiveProperty(property) || isSoldProperty(property);
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

/** SUUMO 情報提供日から情報更新日を表示する（YYYY年M月D日） */
function getDisplayInfoUpdatedDate(property) {
  if (property.info_updated_date) {
    return property.info_updated_date;
  }
  if (property.info_updated_month && /年.*月.*日$/.test(property.info_updated_month)) {
    return property.info_updated_month;
  }
  const raw = String(property.info_provided_date || "").trim();
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return "";
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
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

/** 所在地文字列から町名トークンを抽出する */
function extractAddressLocalities(address) {
  if (!address) return new Set();

  const text = String(address).trim();
  if (!text) return new Set();

  const localities = new Set();
  const hasAdminMarker = /[都道府県市区]/.test(text);

  if (!hasAdminMarker) {
    const token = text.replace(/[0-9０-９\-－番地号].*$/, "").trim();
    if (token) localities.add(token);
    return localities;
  }

  const wardIndex = text.lastIndexOf("区");
  if (wardIndex >= 0) {
    const afterWard = text.slice(wardIndex + 1);
    const match = afterWard.match(/^([\u4e00-\u9fff]{2,10})/);
    if (match) {
      const token = match[1].replace(/[0-9０-９\-－番地号].*$/, "").trim();
      if (token) localities.add(token);
    }
  }

  return localities;
}

/** 成約物件が売り出し中の個別物件と整合するか判定する */
function matchesKnownBuildingProfile(property) {
  const propertyName = property.property_name;
  if (!propertyName) return true;

  const activeMatches = allProperties.filter(
    (item) => item.is_active && item.property_name === propertyName
  );
  if (activeMatches.length === 0) return true;

  const walk = Number(property.walk_minutes);
  const age = Number(property.age_years);
  const area = Number(property.area_m2);
  const propertyLocalities = extractAddressLocalities(property.address);

  return activeMatches.some((active) => {
    const activeWalk = Number(active.walk_minutes);
    const activeAge = Number(active.age_years);
    const activeArea = Number(active.area_m2);

    if (!Number.isNaN(walk) && !Number.isNaN(activeWalk) && Math.abs(walk - activeWalk) > 1) {
      return false;
    }
    if (!Number.isNaN(age) && !Number.isNaN(activeAge) && Math.abs(age - activeAge) > 3) {
      return false;
    }
    if (
      !Number.isNaN(area) &&
      !Number.isNaN(activeArea) &&
      Math.abs(area - activeArea) / Math.max(area, activeArea) > 0.45
    ) {
      return false;
    }

    if (propertyLocalities.size > 0) {
      const activeLocalities = extractAddressLocalities(active.address);
      if (activeLocalities.size > 0) {
        let localityMatched = false;
        for (const locality of propertyLocalities) {
          if (activeLocalities.has(locality)) {
            localityMatched = true;
            break;
          }
        }
        if (!localityMatched) return false;
      }
    }

    return true;
  });
}

/** キーワード検索に合うか判定する */
function matchesKeywordSearch(property, keyword) {
  if (!keyword) return true;

  const haystack = [
    property.property_name,
    property.source_name,
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

  const nameMatches = (property.property_name || "").toLowerCase().includes(keyword);
  if (property.is_sold && property.property_name_inferred && nameMatches) {
    return matchesKnownBuildingProfile(property);
  }

  return true;
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
    if (!matchesFloorFilter(property)) return false;
    if (!matchesDirectionFilter(property)) return false;
    if (!matchesFavoritesFilter(property)) return false;
    if (!matchesPriceFilter(property)) return false;
    if (!matchesAreaFilter(property)) return false;
    if (!matchesWalkFilter(property)) return false;
    if (!matchesAgeFilter(property)) return false;
    if (!matchesKeywordSearch(property, keyword)) return false;

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
    case "info_updated_date":
      return property.info_provided_date || getDisplayInfoUpdatedDate(property);
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

/** 行セル用の属性文字列を返す（スマホカード表示用の data-label 付き） */
function getCellProps(columnId, cardSection = "primary") {
  const column = TABLE_COLUMNS.find((item) => item.id === columnId);
  if (!column) return 'class=""';
  return `class="${column.className} ${getAlignClass(column)}" data-label="${escapeHtml(column.label)}" data-card-section="${cardSection}"`;
}

/** スマホカードの要約行テキストを作る（1行に収まる短さ） */
function buildMobileCardSummary(property) {
  const parts = [
    formatLayoutLabel(property.layout),
    formatDecimal(property.area_m2, "㎡"),
    property.age_years != null && property.age_years !== "" ? `築${property.age_years}年` : null,
  ].filter(Boolean);
  return parts.join(" ・ ");
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

/** レンジスライダーの初期値を返す */
function getDefaultRangeFilterState() {
  const defaultThreshold = Number(marketSummary.bargain_threshold_pct ?? 10);
  return {
    price: { min: RANGE_FILTER_CONFIG.price.min, max: RANGE_FILTER_CONFIG.price.max },
    area: { min: RANGE_FILTER_CONFIG.area.min, max: RANGE_FILTER_CONFIG.area.max },
    age: { min: RANGE_FILTER_CONFIG.age.min, max: RANGE_FILTER_CONFIG.age.max },
    walk: { min: RANGE_FILTER_CONFIG.walk.min, max: RANGE_FILTER_CONFIG.walk.max },
    bargain: {
      min: Number.isNaN(defaultThreshold) ? 10 : defaultThreshold,
      max: RANGE_FILTER_CONFIG.bargain.max,
    },
  };
}

/** レンジスライダーの表示をすべて更新する */
function updateAllRangeFilterDisplays() {
  [
    elements.filterPrice,
    elements.filterArea,
    elements.filterAge,
    elements.filterWalk,
    elements.filterBargain,
  ].forEach((container) => {
    if (container) updateRangeFilterDisplay(container);
  });
}

/** すべてのフィルター条件を初期状態に戻す */
function clearAllFilters() {
  elements.searchInput.value = "";
  elements.filterStatus.value = "active";
  selectedStations.splice(0, selectedStations.length);
  selectedLayoutKeys.clear();
  selectedDirectionKeys.clear();
  filterFloorMin2 = false;
  filterFavoritesOnly = false;
  if (elements.filterFloorMin2) {
    elements.filterFloorMin2.checked = false;
  }
  if (elements.filterFavoritesOnly) {
    elements.filterFavoritesOnly.checked = false;
  }
  stationPickerActiveIndex = -1;

  const defaults = getDefaultRangeFilterState();
  Object.keys(defaults).forEach((rangeId) => {
    rangeFilterState[rangeId] = { ...defaults[rangeId] };
  });

  renderStationPicker();
  renderAllChipFilters();
  updateAllRangeFilterDisplays();
  updateBargainStat();
  renderMarketSummary();
  refreshPropertyList();
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
      const allSelected =
        group.items.length > 0 &&
        group.items.every((layout) => selectedLayoutKeys.has(layout.key));
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
          <div class="layout-section-header">
            <h3 class="layout-section-label">${group.label}</h3>
            <button
              type="button"
              class="page-btn layout-group-btn${allSelected ? " is-active" : ""}"
              data-layout-group="${group.id}"
            >${allSelected ? "解除" : "一括選択"}</button>
          </div>
          <div class="layout-grid">${options}</div>
        </section>
      `;
    })
    .join("");

  elements.filterLayout.innerHTML = `
    <div class="layout-filter-toolbar">
      <button type="button" class="page-btn" data-chip-action="all">すべて</button>
      <button type="button" class="page-btn" data-chip-action="clear">クリア</button>
      ${
        selectedCount > 0
          ? `<span class="layout-toolbar-status">${selectedCount}件選択中</span>`
          : ""
      }
    </div>
    <div class="layout-sections">${groupMarkup}</div>
  `;
}

/** 方角フィルターを描画する */
function renderDirectionFilter() {
  if (!elements.filterDirection) return;

  const selectedCount = selectedDirectionKeys.size;
  const options = DIRECTION_OPTIONS.map((option) => {
    const isSelected = selectedDirectionKeys.has(option.key);
    return `
      <label class="direction-option${isSelected ? " selected" : ""}">
        <input
          type="checkbox"
          value="${option.key}"
          ${isSelected ? "checked" : ""}
        >
        <span>${option.label}</span>
      </label>
    `;
  }).join("");

  elements.filterDirection.innerHTML = `
    <div class="layout-filter-toolbar">
      <button type="button" class="page-btn" data-chip-action="all">すべて</button>
      <button type="button" class="page-btn" data-chip-action="clear">クリア</button>
      ${
        selectedCount > 0
          ? `<span class="layout-toolbar-status">${selectedCount}件選択中</span>`
          : ""
      }
    </div>
    <div class="direction-grid">${options}</div>
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
      <span>${formatRangeEndpoint(config.min, config, false)}</span>
      <span>${formatRangeEndpoint(config.max, config, true)}</span>
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
  [
    elements.filterPrice,
    elements.filterArea,
    elements.filterAge,
    elements.filterWalk,
    elements.filterBargain,
  ].forEach((container) => {
    if (container) setupRangeFilter(container);
  });
}

/** チップ型フィルターをまとめて再描画する */
function renderAllChipFilters() {
  renderLayoutFilter();
  renderDirectionFilter();
}

/** 間取りの部屋数グループを一括選択／解除する */
function toggleLayoutGroupSelection(groupId) {
  const layouts = getAvailableLayouts();
  const groups = groupLayoutsByRooms(layouts);
  const group = groups.find((item) => item.id === groupId);
  if (!group || group.items.length === 0) return;

  const allSelected = group.items.every((layout) => selectedLayoutKeys.has(layout.key));
  if (allSelected) {
    group.items.forEach((layout) => selectedLayoutKeys.delete(layout.key));
  } else {
    group.items.forEach((layout) => selectedLayoutKeys.add(layout.key));
  }

  renderAllChipFilters();
  refreshPropertyList();
}

/** チップ型フィルターの操作を初期化する */
function setupChipFilterDelegation(container, optionsOrGetter, selectedKeys) {
  const getOptions = () =>
    typeof optionsOrGetter === "function" ? optionsOrGetter() : optionsOrGetter;

  container.addEventListener("click", (event) => {
    const groupButton = event.target.closest("[data-layout-group]");
    if (groupButton) {
      event.preventDefault();
      event.stopPropagation();
      toggleLayoutGroupSelection(groupButton.dataset.layoutGroup);
      return;
    }

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
  const wasOpen = Boolean(elements.marketSummary.querySelector("details")?.open);

  if (stations.length === 0) {
    elements.marketSummary.innerHTML = `
      <h2>該当物件一覧</h2>
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

  let summaryLabel = "選択駅の相場";
  if (stations.length === 1) {
    const only = stations[0];
    const info = getStationMarketInfo(only);
    summaryLabel = info
      ? `選択駅の相場（${only} · 平均 ${formatDecimal(info.avg_unit_price, " 万円/㎡")}）`
      : `選択駅の相場（${only} · 成約データなし）`;
  } else {
    summaryLabel = `選択駅の相場（${stations.length}駅 · 加重平均 ${selectedAvg}）`;
  }

  elements.marketSummary.innerHTML = `
    <h2>該当物件一覧</h2>
    <details class="market-summary-details"${wasOpen ? " open" : ""}>
      <summary class="market-summary-summary">${summaryLabel}</summary>
      <div class="market-grid">${cards}</div>
      <p class="muted market-summary-note">選択駅の加重平均 ${selectedAvg} / 割安判定: 相場比 ${threshold} 以上お得</p>
    </details>
  `;
}

/** 有効な間取り図 URL か判定する */
function isValidFloorPlanUrl(url) {
  if (!url) return false;
  const text = String(url).trim().toLowerCase();
  return text.startsWith("http") && text !== "nan" && text !== "none";
}

/** SUUMO resizeImage は w/h が無いと 400 になるため付与する */
function normalizeFloorPlanUrl(url) {
  if (!isValidFloorPlanUrl(url)) return "";
  let text = String(url).trim();
  if (text.includes("resizeImage")) {
    if (!/[?&]w=\d+/i.test(text)) {
      text += `${text.includes("?") ? "&" : "?"}w=220`;
    }
    if (!/[?&]h=\d+/i.test(text)) {
      text += "&h=165";
    }
  }
  return text;
}

/** 間取り図の読み込み失敗時は「-」表示に切り替える */
function handleFloorPlanError(img) {
  if (!img || !img.parentNode) return;
  const placeholder = document.createElement("span");
  placeholder.className = "no-plan";
  placeholder.textContent = "-";
  img.replaceWith(placeholder);
}

/** 間取り図セル HTML */
function renderFloorPlanCell(property) {
  const cellProps = getCellProps("plan");
  const src = normalizeFloorPlanUrl(property.floor_plan_url);
  if (!src) {
    return `<div ${cellProps}><span class="no-plan">-</span></div>`;
  }
  return `
    <div ${cellProps}>
      <img
        class="floor-plan-thumb"
        src="${escapeHtml(src)}"
        alt=""
        loading="lazy"
        onerror="handleFloorPlanError(this)"
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

    const stationLabel = canonicalizeStationName(property.station) || "-";
    const walkLabel = `${property.walk_minutes ?? "-"}分`;
    const stationWalkLabel = stationLabel === "-"
      ? walkLabel
      : `${stationLabel} ${walkLabel}`;
    const referenceText = property.reference_price
      ? `<div class="row-sub row-sub-reference">相場 ${formatDecimal(property.reference_price, "\u00A0万円/㎡")}</div>`
      : "";
    const cardSummary = buildMobileCardSummary(property);

    row.innerHTML = `
      ${renderFavoriteCell(property)}
      ${renderFloorPlanCell(property)}
      <div ${getCellProps("property_name", "primary")}>
        <div class="name-line">
          <strong class="property-name">${property.property_name || "名称不明"}</strong>
        </div>
        <div class="row-sub">${property.address || ""}</div>
        <div class="card-inline-meta">
          <span class="status-badge ${statusClass}">${displayState}</span>
          <span class="card-inline-station">${stationWalkLabel}</span>
        </div>
        ${referenceText}
      </div>
      <div ${getCellProps("display_state", "primary")}><span class="status-badge ${statusClass}">${displayState}</span></div>
      <div ${getCellProps("station", "primary")}">${stationLabel}</div>
      <div ${getCellProps("walk_minutes", "primary")}">${walkLabel}</div>
      <div class="card-price-row">
        <div ${getCellProps("price_jpy", "primary")}">${formatPrice(property.price_jpy)}</div>
        <div ${getCellProps("unit_price_m2", "primary")}>
          <div class="unit-price-cell">
            <span>${formatDecimal(property.unit_price_m2, "\u00A0万円/㎡")}</span>
            ${bargainBadge}
          </div>
        </div>
      </div>
      <div ${getCellProps("area_m2", "details")}">${formatDecimal(property.area_m2, "㎡")}</div>
      <div ${getCellProps("floor", "details")}">${getDisplayFloor(property)}</div>
      <div ${getCellProps("layout", "details")}">${formatLayoutLabel(property.layout)}</div>
      <div ${getCellProps("direction", "details")}">${getDisplayDirection(property)}</div>
      <div ${getCellProps("age_years", "details")}">${property.age_years ?? "-"}年</div>
      <div ${getCellProps("transaction_period", "details")}">${getDisplayTransactionPeriod(property)}</div>
      <div ${getCellProps("info_updated_date", "details")}">${getDisplayInfoUpdatedDate(property) || "-"}</div>
      <div class="card-footer-row">
        <p class="card-summary" data-card-section="summary">${escapeHtml(cardSummary || "詳細情報あり")}</p>
        <button type="button" class="card-expand-btn" aria-expanded="false">
          <span class="card-expand-text">詳細を見る</span>
        </button>
        <div ${getCellProps("link", "primary")}>
          ${linkCell}
        </div>
      </div>
    `;

    elements.propertyList.appendChild(row);
  });

  renderArchivedFavorites();
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

/** 建物名・バス停など、鉄道駅として不適切な名称か判定する */
function looksLikeRailStationName(name) {
  const text = canonicalizeStationName(name);
  if (!text) return false;
  if (/(ビル|プラザ|モール|タワー|ホテル|ケアプラザ|入口)/.test(text)) return false;
  if (text.endsWith("センター") && text !== "センター北" && text !== "センター南") {
    return false;
  }
  return true;
}

/** 駅選択肢をマージして重複を除く（非駅名は物件由来でも除外） */
function mergeStationOptions(catalogStations, propertyStations) {
  const merged = new Set();
  [...(catalogStations || []), ...(propertyStations || [])].forEach((station) => {
    const normalized = canonicalizeStationName(station);
    if (normalized && looksLikeRailStationName(normalized)) merged.add(normalized);
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
  rebuildPropertyIndex();
  loadFavorites();
  syncFavoriteSnapshots();
  loadSavedSearches();
  await loadSharedSavedSearches();
  await checkLocalSyncServer();
  syncGitHubTokenInput();

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
  renderSavedSearches();
  updateSharedSearchesStatus();
  renderTableHeader();
  renderMarketSummary();
  resetPage();
  renderProperties();
}

/** スマホ向け検索条件の開閉を設定する */
function setupMobileFilterToggle() {
  const toggle = elements.mobileFilterToggle;
  const panel = elements.filterPanel;
  if (!toggle || !panel) return;

  const syncLabel = () => {
    const isOpen = panel.classList.contains("is-open");
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    const hint = toggle.querySelector(".mobile-filter-toggle-hint");
    if (hint) {
      hint.textContent = isOpen ? "タップして閉じる" : "タップして開く";
    }
  };

  toggle.addEventListener("click", () => {
    panel.classList.toggle("is-open");
    syncLabel();
  });
  syncLabel();
}

/** イベントリスナーを設定する */
function setupEventListeners() {
  setupMobileFilterToggle();
  setupChipFilterDelegation(
    elements.filterLayout,
    () => getAvailableLayouts(),
    selectedLayoutKeys
  );
  if (elements.filterDirection) {
    setupChipFilterDelegation(
      elements.filterDirection,
      () => DIRECTION_OPTIONS,
      selectedDirectionKeys
    );
  }
  if (elements.filterFloorMin2) {
    elements.filterFloorMin2.addEventListener("change", () => {
      filterFloorMin2 = elements.filterFloorMin2.checked;
      refreshPropertyList();
    });
  }
  if (elements.filterFavoritesOnly) {
    elements.filterFavoritesOnly.addEventListener("change", () => {
      filterFavoritesOnly = elements.filterFavoritesOnly.checked;
      refreshPropertyList();
    });
  }
  if (elements.saveSearchBtn) {
    elements.saveSearchBtn.addEventListener("click", saveCurrentSearch);
  }
  if (elements.exportSharedSearchesBtn) {
    elements.exportSharedSearchesBtn.addEventListener("click", () => {
      publishSharedSavedSearches();
    });
  }
  if (elements.saveGithubTokenBtn) {
    elements.saveGithubTokenBtn.addEventListener("click", saveGitHubTokenFromInput);
  }
  if (elements.githubTokenInput) {
    elements.githubTokenInput.addEventListener("focus", () => {
      if (elements.githubTokenInput.dataset.hasToken === "1") {
        elements.githubTokenInput.value = "";
      }
    });
  }
  if (elements.importSharedSearchesBtn && elements.importSharedSearchesInput) {
    elements.importSharedSearchesBtn.addEventListener("click", () => {
      elements.importSharedSearchesInput.click();
    });
    elements.importSharedSearchesInput.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      importSharedSavedSearchesFromFile(file);
      event.target.value = "";
    });
  }
  if (elements.savedSearchName) {
    elements.savedSearchName.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveCurrentSearch();
      }
    });
  }
  if (elements.savedSearchList) {
    elements.savedSearchList.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-search-action]");
      if (!actionButton) return;
      const item = actionButton.closest("[data-search-id]");
      if (!item) return;
      const searchId = item.dataset.searchId;
      if (actionButton.dataset.searchAction === "apply") {
        applySavedSearch(searchId);
        return;
      }
      if (actionButton.dataset.searchAction === "line") {
        toggleLineNotify(searchId);
        return;
      }
      if (actionButton.dataset.searchAction === "delete") {
        deleteSavedSearch(searchId);
      }
    });
  }
  if (elements.propertyList) {
    elements.propertyList.addEventListener("click", (event) => {
      const favoriteButton = event.target.closest(".favorite-btn");
      if (favoriteButton) {
        const propertyId = favoriteButton.dataset.propertyId;
        const property = propertyById.get(propertyId);
        if (!property) return;

        toggleFavoriteProperty(property);
        const isActive = isFavoriteId(propertyId);
        favoriteButton.classList.toggle("is-active", isActive);
        favoriteButton.setAttribute("aria-pressed", isActive ? "true" : "false");
        favoriteButton.setAttribute("aria-label", isActive ? "お気に入り解除" : "お気に入り登録");

        if (filterFavoritesOnly) {
          refreshPropertyList();
        }
        return;
      }

      // リンク操作はカード開閉と分離する
      if (event.target.closest("a")) return;

      const card = event.target.closest(".property-row");
      if (!card || !elements.propertyList.contains(card)) return;

      // 狭い画面のカード表示時のみ、カード全体タップで詳細を開閉
      if (!window.matchMedia("(max-width: 1100px)").matches) return;

      const isExpanded = card.classList.toggle("is-expanded");
      const expandButton = card.querySelector(".card-expand-btn");
      if (expandButton) {
        expandButton.setAttribute("aria-expanded", isExpanded ? "true" : "false");
        const label = expandButton.querySelector(".card-expand-text");
        if (label) {
          label.textContent = isExpanded ? "詳細を閉じる" : "詳細を見る";
        }
      }
    });
  }
  if (elements.archivedFavoritesList) {
    elements.archivedFavoritesList.addEventListener("click", (event) => {
      const removeButton = event.target.closest(".archived-favorite-remove");
      if (!removeButton) return;
      const propertyId = removeButton.dataset.propertyId;
      if (!propertyId || !favoriteEntries.has(propertyId)) return;
      favoriteEntries.delete(propertyId);
      saveFavorites();
      renderArchivedFavorites();
      if (filterFavoritesOnly) {
        refreshPropertyList();
      }
    });
  }
  setupStationPicker();
  setupRangeFilters();

  elements.filterStatus.addEventListener("change", refreshPropertyList);
  elements.searchInput.addEventListener("input", refreshPropertyList);

  if (elements.clearFiltersBtn) {
    elements.clearFiltersBtn.addEventListener("click", clearAllFilters);
  }

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

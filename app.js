// fave — 推し活記録アプリ
// データはすべてこの端末のブラウザ(localStorage)に保存されます。

"use strict";

// ---------- 定数 ----------

const STORAGE_KEY = "fave.v1";

const CATEGORIES = [
  { id: "goods",  label: "グッズ",        emoji: "🧸" },
  { id: "ticket", label: "チケット・ライブ", emoji: "🎫" },
  { id: "trip",   label: "遠征",          emoji: "🚄" },
  { id: "stream", label: "配信・投げ銭",   emoji: "📱" },
  { id: "media",  label: "CD・円盤",      emoji: "💿" },
  { id: "cafe",   label: "コラボ・カフェ", emoji: "🍰" },
  { id: "other",  label: "その他",        emoji: "✨" },
];

const MILESTONES = [
  { amount: 10000,   label: "推し活はじめました", emoji: "🌱" },
  { amount: 30000,   label: "立派なファン",       emoji: "🌸" },
  { amount: 50000,   label: "推しの味方",         emoji: "💐" },
  { amount: 100000,  label: "10万円の愛",         emoji: "👑" },
  { amount: 300000,  label: "推し活マイスター",   emoji: "🏆" },
  { amount: 500000,  label: "生涯推し宣言",       emoji: "💎" },
  { amount: 1000000, label: "ミリオン級の愛",     emoji: "🌟" },
];

// ---------- データの読み書き ----------

function defaultData() {
  return {
    oshi: { name: "", emoji: "💖", color: "#e0487f" },
    budget: 0,          // 毎月の軍資金(0 = 未設定)
    records: [],        // { id, date: "YYYY-MM-DD", amount, cat, memo, photo: true/false }
    events: [],         // 記念日 { id, label, date: "YYYY-MM-DD", repeat: true/false }
    recurring: [],      // 定期支出 { id, label, amount, cat, lastApplied: "YYYY-MM" }
    goals: [],          // 目標貯金 { id, label, target, saved }
  };
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultData(), parsed);
  } catch (e) {
    return defaultData();
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let data = loadData();
let editingId = null;                 // 編集中の記録ID(nullなら新規)
let viewMonth = monthKey(new Date()); // 履歴画面で表示中の月
let viewYear = new Date().getFullYear(); // 年間まとめで表示中の年

// ---------- 写真の保存(IndexedDB) ----------
// 写真は容量が大きいので、localStorageではなくIndexedDBに保存する。
// 記録(record)には photo:true のフラグだけ持たせ、実データはここで record.id をキーに管理する。

const PHOTO_DB = "fave-photos";
const PHOTO_STORE = "photos";
let photoDbPromise = null;

function openPhotoDb() {
  if (photoDbPromise) return photoDbPromise;
  photoDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(PHOTO_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return photoDbPromise;
}

function photoTx(mode) {
  return openPhotoDb().then((db) => db.transaction(PHOTO_STORE, mode).objectStore(PHOTO_STORE));
}

async function savePhoto(id, dataUrl) {
  const store = await photoTx("readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(dataUrl, id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getPhoto(id) {
  try {
    const store = await photoTx("readonly");
    return await new Promise((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function deletePhoto(id) {
  try {
    const store = await photoTx("readwrite");
    store.delete(id);
  } catch (e) { /* 失敗しても致命的ではない */ }
}

// バックアップ用: 記録に紐づく写真をすべて取り出す { id: dataURL }
async function getAllPhotos() {
  const out = {};
  for (const r of data.records) {
    if (r.photo) {
      const dataUrl = await getPhoto(r.id);
      if (dataUrl) out[r.id] = dataUrl;
    }
  }
  return out;
}

// すべての写真を削除する
async function clearAllPhotos() {
  try {
    const store = await photoTx("readwrite");
    store.clear();
  } catch (e) { /* 失敗しても致命的ではない */ }
}

// 選択された画像を縮小してJPEG(dataURL)にする。容量を抑えるため長辺1200pxに。
function fileToDataUrl(file, maxSide = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxSide || height > maxSide) {
        const scale = maxSide / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を読み込めませんでした")); };
    img.src = url;
  });
}

// ---------- 日付・金額ヘルパー ----------

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function yen(n) {
  return "¥" + n.toLocaleString("ja-JP");
}

// innerHTMLに入れる文字列を安全にする(記号が混ざっても崩れないように)
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function yenShort(n) {
  if (n >= 10000) {
    const man = n / 10000;
    return (man >= 10 ? Math.round(man) : Math.round(man * 10) / 10) + "万";
  }
  return n.toLocaleString("ja-JP");
}

function catById(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

function recordsInMonth(key) {
  return data.records.filter((r) => r.date.startsWith(key));
}

function sumAmount(records) {
  return records.reduce((s, r) => s + r.amount, 0);
}

function totalAll() {
  return sumAmount(data.records);
}

// ---------- テーマ(推し色) ----------

function applyTheme() {
  document.documentElement.style.setProperty("--accent", data.oshi.color);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = data.oshi.color;
  document.getElementById("header-oshi-emoji").textContent = data.oshi.emoji || "💖";
  document.getElementById("header-title").textContent =
    data.oshi.name ? `fave — ${data.oshi.name}` : "fave";
}

// ---------- 画面切り替え ----------

const navButtons = document.querySelectorAll(".nav-btn");
navButtons.forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === id));
  // 年間まとめはホームの一部として扱う(下部ナビはホームを光らせる)
  const navId = id === "view-year" ? "view-home" : id;
  navButtons.forEach((b) => b.classList.toggle("active", b.dataset.view === navId));
  if (id === "view-home") renderHome();
  if (id === "view-history") renderHistory();
  if (id === "view-settings") renderSettings();
  if (id === "view-year") renderYear();
  if (id === "view-add" && !editingId) resetAddForm();
  window.scrollTo(0, 0);
}

// ---------- ホーム画面 ----------

function renderHome() {
  const nowKey = monthKey(new Date());
  const monthRecords = recordsInMonth(nowKey);
  const monthSum = sumAmount(monthRecords);

  document.getElementById("hero-label").textContent =
    data.oshi.name ? `今月、${data.oshi.name}に使えた額` : "今月、推しに使えた額";
  document.getElementById("hero-amount").textContent = yen(monthSum);
  document.getElementById("hero-sub").textContent = `今月の記録 ${monthRecords.length}回`;

  // 軍資金
  const bar = document.getElementById("budget-bar");
  const msg = document.getElementById("budget-message");
  const totalLabel = document.getElementById("budget-total-label");
  if (data.budget > 0) {
    const rest = data.budget - monthSum;
    const pct = Math.min(100, (monthSum / data.budget) * 100);
    bar.style.width = pct + "%";
    totalLabel.textContent = `軍資金 ${yen(data.budget)}`;
    if (rest > 0) {
      msg.textContent = `あと ${yen(rest)}、罪悪感ゼロで全力で使えます!`;
    } else if (rest === 0) {
      msg.textContent = "軍資金ちょうど使い切り!お見事です👏";
    } else {
      msg.textContent = `軍資金を ${yen(-rest)} 超えました。今月は全力で推した月!来月の軍資金で調整してもOKです。`;
    }
  } else {
    bar.style.width = "0%";
    totalLabel.textContent = "";
    msg.textContent = "「せってい」で軍資金を決めると、安心して全力で推せます。";
  }

  // 累計
  document.getElementById("total-amount").textContent = yen(totalAll());
  document.getElementById("total-count").textContent = `${data.records.length}回`;

  renderBadges();
  renderChart();
  renderRecent();
  renderEvents();
  renderGoals();
}

// ---------- 目標貯金 ----------

function renderGoals() {
  const card = document.getElementById("goals-card");
  const wrap = document.getElementById("goal-list");
  card.hidden = data.goals.length === 0;
  wrap.innerHTML = "";
  data.goals.forEach((g) => {
    const pct = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
    const done = g.saved >= g.target;
    const item = document.createElement("div");
    item.className = "goal-item";
    item.innerHTML =
      `<div class="goal-top">` +
        `<span class="goal-name">${escapeHtml(g.label)}</span>` +
        `<span class="goal-figures">${yen(g.saved)}<span class="goal-target"> / ${yen(g.target)}</span></span>` +
      `</div>` +
      `<div class="goal-bottom">` +
        `<div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>` +
        (done
          ? `<span class="goal-done-mark">達成🎉</span>`
          : `<button class="goal-deposit-btn" data-goal="${g.id}">貯金する</button>`) +
      `</div>`;
    wrap.appendChild(item);
  });
  wrap.querySelectorAll(".goal-deposit-btn").forEach((btn) => {
    btn.addEventListener("click", () => openDeposit(btn.dataset.goal));
  });
}

let depositGoalId = null;

function openDeposit(id) {
  const g = data.goals.find((x) => x.id === id);
  if (!g) return;
  depositGoalId = id;
  document.getElementById("deposit-title").textContent = g.label;
  document.getElementById("deposit-progress").textContent =
    `いま ${yen(g.saved)} / 目標 ${yen(g.target)}(あと ${yen(Math.max(0, g.target - g.saved))})`;
  document.getElementById("deposit-amount").value = "";
  document.getElementById("deposit-modal").hidden = false;
}

document.getElementById("deposit-cancel-btn").addEventListener("click", () => {
  document.getElementById("deposit-modal").hidden = true;
});

document.getElementById("deposit-save-btn").addEventListener("click", () => {
  const g = data.goals.find((x) => x.id === depositGoalId);
  if (!g) return;
  const amount = Math.floor(Number(document.getElementById("deposit-amount").value));
  if (!amount || amount <= 0) { showToast("金額を入力してください"); return; }
  const wasDone = g.saved >= g.target;
  g.saved += amount;
  saveData();
  document.getElementById("deposit-modal").hidden = true;
  renderGoals();
  if (!wasDone && g.saved >= g.target) {
    launchConfetti();
    showToast(`🎉 目標達成!「${g.label}」`, 3200);
  } else {
    showToast(`+${yen(amount)} 貯金しました 🐷`);
  }
});

function renderGoalManage() {
  const list = document.getElementById("goal-manage-list");
  list.innerHTML = "";
  data.goals.forEach((g) => {
    const li = document.createElement("li");
    const main = document.createElement("span");
    main.className = "manage-main";
    main.textContent = g.label;
    const sub = document.createElement("span");
    sub.className = "manage-sub";
    sub.textContent = `${yen(g.saved)} / ${yen(g.target)}`;
    const del = document.createElement("button");
    del.className = "icon-btn";
    del.textContent = "🗑️";
    del.addEventListener("click", () => {
      if (!confirm(`目標「${g.label}」を削除しますか?`)) return;
      data.goals = data.goals.filter((x) => x.id !== g.id);
      saveData();
      renderGoalManage();
      showToast("目標を削除しました");
    });
    li.appendChild(main);
    li.appendChild(sub);
    li.appendChild(del);
    list.appendChild(li);
  });
}

document.getElementById("goal-add-btn").addEventListener("click", () => {
  const label = document.getElementById("goal-label").value.trim();
  const target = Math.floor(Number(document.getElementById("goal-target").value));
  if (!label || !target || target <= 0) { showToast("名前と目標金額を入力してください"); return; }
  data.goals.push({ id: newId(), label, target, saved: 0 });
  saveData();
  document.getElementById("goal-label").value = "";
  document.getElementById("goal-target").value = "";
  renderGoalManage();
  showToast("目標を追加しました 🎯");
});

// ---------- 記念日カウントダウン ----------

// 次の記念日までの日数を計算する(毎年くりかえす場合は次の同じ日付)
function daysUntilEvent(ev) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = ev.date.split("-").map(Number);
  let target = ev.repeat ? new Date(today.getFullYear(), m - 1, d) : new Date(y, m - 1, d);
  if (ev.repeat && target < today) target = new Date(today.getFullYear() + 1, m - 1, d);
  return Math.round((target - today) / 86400000);
}

function renderEvents() {
  const card = document.getElementById("events-card");
  const list = document.getElementById("event-list");
  const upcoming = data.events
    .map((ev) => ({ ev, days: daysUntilEvent(ev) }))
    .filter((x) => x.days >= 0)          // 過ぎた一回きりの記念日は表示しない
    .sort((a, b) => a.days - b.days)
    .slice(0, 3);

  card.hidden = upcoming.length === 0;
  list.innerHTML = "";
  upcoming.forEach(({ ev, days }) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = ev.label;
    const right = document.createElement("span");
    right.className = "event-days" + (days === 0 ? " today" : "");
    right.textContent = days === 0 ? "今日🎉" : `あと${days}日`;
    li.appendChild(label);
    li.appendChild(right);
    list.appendChild(li);
  });
}

function renderEventManage() {
  const list = document.getElementById("event-manage-list");
  list.innerHTML = "";
  data.events.forEach((ev) => {
    const li = document.createElement("li");
    const main = document.createElement("span");
    main.className = "manage-main";
    main.textContent = ev.label;
    const sub = document.createElement("span");
    sub.className = "manage-sub";
    sub.textContent = ev.date.replaceAll("-", "/") + (ev.repeat ? "(毎年)" : "");
    const del = document.createElement("button");
    del.className = "icon-btn";
    del.textContent = "🗑️";
    del.addEventListener("click", () => {
      if (!confirm(`「${ev.label}」を削除しますか?`)) return;
      data.events = data.events.filter((x) => x.id !== ev.id);
      saveData();
      renderEventManage();
      showToast("記念日を削除しました");
    });
    li.appendChild(main);
    li.appendChild(sub);
    li.appendChild(del);
    list.appendChild(li);
  });
}

document.getElementById("event-add-btn").addEventListener("click", () => {
  const label = document.getElementById("event-label").value.trim();
  const date = document.getElementById("event-date").value;
  if (!label || !date) { showToast("名前と日付を入力してください"); return; }
  data.events.push({ id: newId(), label, date, repeat: document.getElementById("event-repeat").checked });
  saveData();
  document.getElementById("event-label").value = "";
  document.getElementById("event-date").value = "";
  renderEventManage();
  showToast("記念日を追加しました 🗓️");
});

// ---------- 定期支出(毎月自動で記録) ----------

function prevMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 2, 1));
}

function nextMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m, 1));
}

// アプリを開いたとき、まだ記録していない月の分をまとめて記録する
function applyRecurring() {
  const current = monthKey(new Date());
  let added = 0;
  data.recurring.forEach((item) => {
    while (item.lastApplied < current) {
      item.lastApplied = nextMonthKey(item.lastApplied);
      data.records.push({
        id: newId(),
        date: item.lastApplied + "-01",
        amount: item.amount,
        cat: item.cat,
        memo: item.label + "(定期)",
      });
      added++;
    }
  });
  if (added > 0) {
    saveData();
    showToast(`定期支出を${added}件記録しました 📅`, 3000);
  }
}

function renderRecurringManage() {
  const list = document.getElementById("recurring-manage-list");
  list.innerHTML = "";
  data.recurring.forEach((item) => {
    const li = document.createElement("li");
    const main = document.createElement("span");
    main.className = "manage-main";
    main.textContent = `${catById(item.cat).emoji} ${item.label}`;
    const sub = document.createElement("span");
    sub.className = "manage-sub";
    sub.textContent = `毎月 ${yen(item.amount)}`;
    const del = document.createElement("button");
    del.className = "icon-btn";
    del.textContent = "🗑️";
    del.addEventListener("click", () => {
      if (!confirm(`「${item.label}」の定期支出をやめますか?(記録済みの分は残ります)`)) return;
      data.recurring = data.recurring.filter((x) => x.id !== item.id);
      saveData();
      renderRecurringManage();
      showToast("定期支出を削除しました");
    });
    li.appendChild(main);
    li.appendChild(sub);
    li.appendChild(del);
    list.appendChild(li);
  });
}

document.getElementById("rec-add-btn").addEventListener("click", () => {
  const label = document.getElementById("rec-label").value.trim();
  const amount = Math.floor(Number(document.getElementById("rec-amount").value));
  if (!label || !amount || amount <= 0) { showToast("名前と金額を入力してください"); return; }
  data.recurring.push({
    id: newId(),
    label,
    amount,
    cat: document.getElementById("rec-cat").value,
    lastApplied: prevMonthKey(monthKey(new Date())), // 今月の分がすぐ記録される
  });
  applyRecurring();
  saveData();
  document.getElementById("rec-label").value = "";
  document.getElementById("rec-amount").value = "";
  renderRecurringManage();
});

// ---------- まとめ画像(シェア用) ----------

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// まとめ画像を描いてcanvasを返す
function buildSummaryCanvas({ title, amount, lines }) {
  const W = 1080, H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const accent = data.oshi.color;
  const font = '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif';

  // 背景(推し色のうすい色)
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  // 白いカード
  roundRect(ctx, 60, 60, W - 120, H - 120, 48);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(120,60,90,0.18)";
  ctx.shadowBlur = 40;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.textAlign = "center";

  // 推しの絵文字
  ctx.font = `140px ${font}`;
  ctx.fillText(data.oshi.emoji || "💖", W / 2, 330);

  // タイトル
  ctx.fillStyle = "#7a6c74";
  ctx.font = `bold 46px ${font}`;
  ctx.fillText(title, W / 2, 470);

  // 金額
  ctx.fillStyle = accent;
  ctx.font = `800 150px ${font}`;
  ctx.fillText(amount, W / 2, 660);

  // 区切り線
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(240, 740);
  ctx.lineTo(W - 240, 740);
  ctx.stroke();

  // サブ情報
  ctx.fillStyle = "#3a3038";
  ctx.font = `bold 44px ${font}`;
  lines.forEach((line, i) => {
    ctx.fillText(line, W / 2, 850 + i * 90);
  });

  // フッター
  ctx.fillStyle = "#a898a0";
  ctx.font = `bold 34px ${font}`;
  ctx.fillText("fave — 推し活記録", W / 2, H - 130);

  return canvas;
}

// 画像を共有(スマホ)またはダウンロード(PC)する
function shareCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) { showToast("画像を作れませんでした"); return; }
    const file = new File([blob], filename, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch(() => {}); // キャンセルは無視
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast("まとめ画像を保存しました 📸");
    }
  }, "image/png");
}

document.getElementById("share-month-btn").addEventListener("click", () => {
  const now = new Date();
  const key = monthKey(now);
  const records = recordsInMonth(key);
  const lines = [`記録 ${records.length}回`];
  if (records.length) {
    const byCat = {};
    records.forEach((r) => { byCat[r.cat] = (byCat[r.cat] || 0) + r.amount; });
    const top = catById(Object.entries(byCat).sort((a, b) => b[1] - a[1])[0][0]);
    lines.push(`いちばんは ${top.emoji} ${top.label}`);
  }
  const canvas = buildSummaryCanvas({
    title: data.oshi.name
      ? `${now.getFullYear()}年${now.getMonth() + 1}月、${data.oshi.name}に使えた額`
      : `${now.getFullYear()}年${now.getMonth() + 1}月、推しに使えた額`,
    amount: yen(sumAmount(records)),
    lines,
  });
  shareCanvas(canvas, `fave-${key}.png`);
});

document.getElementById("share-year-btn").addEventListener("click", () => {
  const records = data.records.filter((r) => r.date.startsWith(viewYear + "-"));
  const lines = [`記録 ${records.length}回`];
  if (records.length) {
    const byMonth = {};
    records.forEach((r) => {
      const m = Number(r.date.slice(5, 7));
      byMonth[m] = (byMonth[m] || 0) + r.amount;
    });
    const topMonth = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
    lines.push(`いちばん推した月は ${topMonth[0]}月`);
    const byCat = {};
    records.forEach((r) => { byCat[r.cat] = (byCat[r.cat] || 0) + r.amount; });
    const topCat = catById(Object.entries(byCat).sort((a, b) => b[1] - a[1])[0][0]);
    lines.push(`いちばんは ${topCat.emoji} ${topCat.label}`);
  }
  const canvas = buildSummaryCanvas({
    title: data.oshi.name ? `${viewYear}年、${data.oshi.name}に使えた愛` : `${viewYear}年、推しに使えた愛`,
    amount: yen(sumAmount(records)),
    lines,
  });
  shareCanvas(canvas, `fave-${viewYear}.png`);
});

function renderBadges() {
  const total = totalAll();
  const wrap = document.getElementById("badges");
  wrap.innerHTML = "";
  MILESTONES.forEach((m) => {
    const el = document.createElement("span");
    const achieved = total >= m.amount;
    el.className = "badge" + (achieved ? "" : " locked");
    el.textContent = achieved ? `${m.emoji} ${m.label}` : `🔒 ${yenShort(m.amount)}円`;
    wrap.appendChild(el);
  });
  const next = MILESTONES.find((m) => total < m.amount);
  const nextEl = document.getElementById("next-milestone");
  if (next) {
    nextEl.textContent = `次のマイルストーン「${next.emoji} ${next.label}」まで あと ${yen(next.amount - total)}`;
  } else {
    nextEl.textContent = "すべてのマイルストーンを達成!あなたの愛は伝説です🌟";
  }
}

// 直近6ヶ月の棒グラフ
function renderChart() {
  const chart = document.getElementById("chart");
  chart.innerHTML = "";

  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: `${d.getMonth() + 1}月` });
  }
  months.forEach((m) => (m.sum = sumAmount(recordsInMonth(m.key))));

  const max = Math.max(...months.map((m) => m.sum), 1);
  const maxSum = Math.max(...months.map((m) => m.sum));

  months.forEach((m, i) => {
    const isCurrent = i === months.length - 1;
    const col = document.createElement("div");
    col.className = "chart-col" + (isCurrent ? "" : " dimmed");

    // ラベルは今月と最大の月だけ表示(他はタップで確認)
    const showLabel = m.sum > 0 && (isCurrent || (m.sum === maxSum && maxSum > 0));

    col.innerHTML =
      `<div class="chart-value">${showLabel ? yenShort(m.sum) : ""}</div>` +
      `<div class="chart-bar-area"><div class="chart-bar" style="height:${Math.round((m.sum / max) * 100)}%"></div></div>` +
      `<div class="chart-month">${m.label}</div>`;

    col.addEventListener("click", (ev) => showChartTooltip(ev, col, m));
    chart.appendChild(col);
  });
}

function showChartTooltip(ev, col, m) {
  ev.stopPropagation();
  const tip = document.getElementById("chart-tooltip");
  tip.textContent = `${m.label}: ${yen(m.sum)}`;
  tip.hidden = false;
  const rect = col.getBoundingClientRect();
  tip.style.left = Math.max(8, rect.left + rect.width / 2 - tip.offsetWidth / 2) + "px";
  tip.style.top = rect.top - tip.offsetHeight - 6 + "px";
  clearTimeout(showChartTooltip._t);
  showChartTooltip._t = setTimeout(() => (tip.hidden = true), 1800);
}
document.addEventListener("click", () => {
  document.getElementById("chart-tooltip").hidden = true;
});

function renderRecent() {
  const list = document.getElementById("recent-list");
  const empty = document.getElementById("recent-empty");
  const recent = sortedRecords().slice(0, 3);
  list.innerHTML = "";
  empty.hidden = recent.length > 0;
  recent.forEach((r) => list.appendChild(recordRow(r, false)));
}

// ---------- 年間まとめ画面 ----------

document.getElementById("year-open-btn").addEventListener("click", () => {
  viewYear = new Date().getFullYear();
  showView("view-year");
});
document.getElementById("year-back-btn").addEventListener("click", () => showView("view-home"));

function yearBounds() {
  const nowYear = new Date().getFullYear();
  if (data.records.length === 0) return { min: nowYear, max: nowYear };
  const years = data.records.map((r) => Number(r.date.slice(0, 4)));
  return { min: Math.min(...years, nowYear), max: nowYear };
}

document.getElementById("year-prev").addEventListener("click", () => {
  if (viewYear > yearBounds().min) { viewYear--; renderYear(); }
});
document.getElementById("year-next").addEventListener("click", () => {
  if (viewYear < yearBounds().max) { viewYear++; renderYear(); }
});

function renderYear() {
  const bounds = yearBounds();
  document.getElementById("year-prev").disabled = viewYear <= bounds.min;
  document.getElementById("year-next").disabled = viewYear >= bounds.max;
  document.getElementById("year-label").textContent = `${viewYear}年のまとめ`;

  const records = data.records.filter((r) => r.date.startsWith(viewYear + "-"));
  const content = document.getElementById("year-content");
  const empty = document.getElementById("year-empty");
  content.hidden = records.length === 0;
  empty.hidden = records.length > 0;
  if (records.length === 0) return;

  const total = sumAmount(records);
  const now = new Date();
  const monthsElapsed = viewYear === now.getFullYear() ? now.getMonth() + 1 : 12;

  document.getElementById("year-hero-label").textContent =
    data.oshi.name ? `${viewYear}年、${data.oshi.name}に使えた愛` : `${viewYear}年、推しに使えた愛`;
  document.getElementById("year-total").textContent = yen(total);
  document.getElementById("year-sub").textContent =
    `記録 ${records.length}回 ・ 月平均 ${yen(Math.round(total / monthsElapsed))}`;

  renderYearChart(records);
  renderYearCats(records, total);
  renderYearHighlights(records);
}

// 1〜12月の棒グラフ
function renderYearChart(records) {
  const chart = document.getElementById("year-chart");
  chart.innerHTML = "";
  document.getElementById("year-chart-note").textContent = `${viewYear}年`;

  const months = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${viewYear}-${String(m).padStart(2, "0")}`;
    months.push({ label: `${m}月`, sum: sumAmount(records.filter((r) => r.date.startsWith(key))) });
  }
  const max = Math.max(...months.map((m) => m.sum), 1);
  const maxSum = Math.max(...months.map((m) => m.sum));
  let labeled = false;

  months.forEach((m) => {
    const isMax = !labeled && m.sum === maxSum && maxSum > 0;
    if (isMax) labeled = true; // ラベルは最大の月だけ表示(他はタップで確認)
    const col = document.createElement("div");
    col.className = "chart-col" + (isMax ? "" : " dimmed");
    col.innerHTML =
      `<div class="chart-value">${isMax ? yenShort(m.sum) : ""}</div>` +
      `<div class="chart-bar-area"><div class="chart-bar" style="height:${Math.round((m.sum / max) * 100)}%"></div></div>` +
      `<div class="chart-month">${m.label.replace("月", "")}</div>`;
    col.addEventListener("click", (ev) => showChartTooltip(ev, col, m));
    chart.appendChild(col);
  });
}

// カテゴリ内訳(横棒)
function renderYearCats(records, total) {
  const wrap = document.getElementById("year-cats");
  wrap.innerHTML = "";
  const sums = CATEGORIES
    .map((c) => ({ cat: c, sum: sumAmount(records.filter((r) => r.cat === c.id)) }))
    .filter((x) => x.sum > 0)
    .sort((a, b) => b.sum - a.sum);
  const maxCat = sums.length ? sums[0].sum : 1;

  sums.forEach((x) => {
    const row = document.createElement("div");
    row.className = "cat-row";
    const pct = Math.round((x.sum / total) * 100);
    row.innerHTML =
      `<span class="cat-row-label">${x.cat.emoji} ${x.cat.label}</span>` +
      `<span class="cat-row-bar-track"><span class="cat-row-bar" style="width:${Math.max(2, Math.round((x.sum / maxCat) * 100))}%"></span></span>` +
      `<span class="cat-row-amount">${yen(x.sum)}<br><span class="cat-pct">${pct}%</span></span>`;
    wrap.appendChild(row);
  });
}

// 今年のハイライト
function renderYearHighlights(records) {
  const list = document.getElementById("year-highlights");
  list.innerHTML = "";
  const items = [];

  // いちばん推した月
  const byMonth = {};
  records.forEach((r) => {
    const m = Number(r.date.slice(5, 7));
    byMonth[m] = (byMonth[m] || 0) + r.amount;
  });
  const topMonth = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
  items.push(["🏆", `いちばん推した月は <b>${topMonth[0]}月</b>(${yen(topMonth[1])})`]);

  // いちばんのカテゴリ
  const byCat = {};
  records.forEach((r) => { byCat[r.cat] = (byCat[r.cat] || 0) + r.amount; });
  const topCat = catById(Object.entries(byCat).sort((a, b) => b[1] - a[1])[0][0]);
  items.push([topCat.emoji, `いちばん愛を注いだのは <b>${topCat.label}</b>`]);

  // 記録した日数
  const days = new Set(records.map((r) => r.date)).size;
  items.push(["📅", `<b>${days}日</b>、推しのために動いた1年でした`]);

  // この年に達成したマイルストーン
  const sorted = [...data.records].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let running = 0;
  const achieved = [];
  sorted.forEach((r) => {
    const before = running;
    running += r.amount;
    MILESTONES.forEach((m) => {
      if (before < m.amount && running >= m.amount && r.date.startsWith(viewYear + "-")) {
        achieved.push(m);
      }
    });
  });
  if (achieved.length) {
    items.push(["🎖️", "達成したマイルストーン: " +
      achieved.map((m) => `<b>${m.emoji} ${m.label}</b>`).join(" / ")]);
  }

  items.forEach(([emoji, html]) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="highlight-emoji">${emoji}</span><span>${html}</span>`;
    list.appendChild(li);
  });
}

// ---------- 記録画面 ----------

let selectedCat = CATEGORIES[0].id;

// 記録フォームの写真の状態
// pendingPhoto: null=変更なし / ""=削除する / dataURL=新しい写真に差し替え
let pendingPhoto = null;

function showPhotoPreview(dataUrl) {
  const wrap = document.getElementById("photo-preview");
  if (dataUrl) {
    document.getElementById("photo-preview-img").src = dataUrl;
    wrap.hidden = false;
    document.getElementById("photo-add-btn").textContent = "📷 写真を変える";
  } else {
    wrap.hidden = true;
    document.getElementById("photo-preview-img").removeAttribute("src");
    document.getElementById("photo-add-btn").textContent = "📷 写真を選ぶ";
  }
}

document.getElementById("photo-add-btn").addEventListener("click", () => {
  document.getElementById("photo-input").click();
});

document.getElementById("photo-input").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const dataUrl = await fileToDataUrl(file);
    pendingPhoto = dataUrl;
    showPhotoPreview(dataUrl);
  } catch (e) {
    showToast("写真を読み込めませんでした");
  }
});

document.getElementById("photo-remove-btn").addEventListener("click", () => {
  pendingPhoto = "";           // 保存時に削除する印
  showPhotoPreview(null);
});

function buildCatChips() {
  const wrap = document.getElementById("cat-chips");
  wrap.innerHTML = "";
  CATEGORIES.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cat-chip";
    btn.dataset.cat = c.id;
    btn.textContent = `${c.emoji} ${c.label}`;
    btn.addEventListener("click", () => {
      selectedCat = c.id;
      updateCatChips();
    });
    wrap.appendChild(btn);
  });
  updateCatChips();
}

function updateCatChips() {
  document.querySelectorAll(".cat-chip").forEach((b) => {
    b.classList.toggle("selected", b.dataset.cat === selectedCat);
  });
}

function resetAddForm() {
  editingId = null;
  document.getElementById("add-title").textContent = "推し活を記録する";
  document.getElementById("save-btn").textContent = "推しに愛を記録する 💖";
  document.getElementById("cancel-edit-btn").hidden = true;
  document.getElementById("input-amount").value = "";
  document.getElementById("input-memo").value = "";
  document.getElementById("input-date").value = todayStr();
  selectedCat = CATEGORIES[0].id;
  updateCatChips();
  pendingPhoto = null;
  showPhotoPreview(null);
}

async function startEdit(id) {
  const r = data.records.find((x) => x.id === id);
  if (!r) return;
  editingId = id;
  showView("view-add");
  document.getElementById("add-title").textContent = "記録を編集する";
  document.getElementById("save-btn").textContent = "変更を保存する";
  document.getElementById("cancel-edit-btn").hidden = false;
  document.getElementById("input-amount").value = r.amount;
  document.getElementById("input-date").value = r.date;
  document.getElementById("input-memo").value = r.memo;
  selectedCat = r.cat;
  updateCatChips();
  // 既存の写真を読み込んで表示(あれば)
  pendingPhoto = null;
  showPhotoPreview(null);
  if (r.photo) {
    const dataUrl = await getPhoto(r.id);
    if (dataUrl && editingId === id) showPhotoPreview(dataUrl);
  }
}

document.getElementById("cancel-edit-btn").addEventListener("click", () => {
  resetAddForm();
  showView("view-history");
});

// 記録に対して、選ばれた写真の追加・差し替え・削除を反映する
async function applyPendingPhoto(r) {
  if (pendingPhoto === null) return;   // 変更なし
  if (pendingPhoto === "") {           // 削除
    await deletePhoto(r.id);
    delete r.photo;
  } else {                             // 追加・差し替え
    await savePhoto(r.id, pendingPhoto);
    r.photo = true;
  }
}

document.getElementById("save-btn").addEventListener("click", async () => {
  const amount = Math.floor(Number(document.getElementById("input-amount").value));
  const date = document.getElementById("input-date").value;
  const memo = document.getElementById("input-memo").value.trim();

  if (!amount || amount <= 0) {
    showToast("金額を入力してください");
    return;
  }
  if (!date) {
    showToast("日付を入力してください");
    return;
  }

  const beforeTotal = totalAll();

  if (editingId) {
    const r = data.records.find((x) => x.id === editingId);
    Object.assign(r, { amount, date, memo, cat: selectedCat });
    await applyPendingPhoto(r);
    saveData();
    showToast("記録を更新しました ✏️");
    editingId = null;
    resetAddForm();
    showView("view-history");
  } else {
    const r = {
      id: newId(),
      date, amount, memo,
      cat: selectedCat,
    };
    data.records.push(r);
    await applyPendingPhoto(r);
    saveData();

    // マイルストーン達成チェック
    const afterTotal = totalAll();
    const crossed = MILESTONES.find((m) => beforeTotal < m.amount && afterTotal >= m.amount);
    if (crossed) {
      launchConfetti();
      showToast(`🎉 マイルストーン達成!「${crossed.emoji} ${crossed.label}」`, 3500);
    } else {
      showToast(`+${yen(amount)} 推しに愛を届けました 💖`);
    }
    resetAddForm();
    showView("view-home");
  }
});

// ---------- 履歴画面 ----------

function sortedRecords() {
  return [...data.records].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function shiftMonth(delta) {
  const [y, m] = viewMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  viewMonth = monthKey(d);
  renderHistory();
}

document.getElementById("month-prev").addEventListener("click", () => shiftMonth(-1));
document.getElementById("month-next").addEventListener("click", () => shiftMonth(1));

// 検索・絞り込みの状態
let searchText = "";
let filterCats = new Set();

const searchInput = document.getElementById("history-search");
searchInput.addEventListener("input", () => {
  searchText = searchInput.value.trim().toLowerCase();
  renderHistory();
});

document.getElementById("filter-toggle-btn").addEventListener("click", () => {
  const panel = document.getElementById("filter-panel");
  panel.hidden = !panel.hidden;
});

document.getElementById("filter-clear-btn").addEventListener("click", () => {
  filterCats.clear();
  searchText = "";
  searchInput.value = "";
  buildFilterChips();
  updateFilterToggle();
  renderHistory();
});

function buildFilterChips() {
  const wrap = document.getElementById("filter-chips");
  wrap.innerHTML = "";
  CATEGORIES.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cat-chip" + (filterCats.has(c.id) ? " selected" : "");
    btn.textContent = `${c.emoji} ${c.label}`;
    btn.addEventListener("click", () => {
      if (filterCats.has(c.id)) filterCats.delete(c.id);
      else filterCats.add(c.id);
      buildFilterChips();
      updateFilterToggle();
      renderHistory();
    });
    wrap.appendChild(btn);
  });
}

function updateFilterToggle() {
  document.getElementById("filter-toggle-btn").classList.toggle("active", filterCats.size > 0);
}

// 検索・絞り込みが有効か
function isFiltering() {
  return searchText !== "" || filterCats.size > 0;
}

function matchesFilter(r) {
  if (filterCats.size > 0 && !filterCats.has(r.cat)) return false;
  if (searchText) {
    const hay = (r.memo + " " + catById(r.cat).label).toLowerCase();
    if (!hay.includes(searchText)) return false;
  }
  return true;
}

function renderHistory() {
  const [y, m] = viewMonth.split("-").map(Number);
  document.getElementById("month-label").textContent = `${y}年${m}月`;

  const filtering = isFiltering();
  // 通常は表示中の月だけ。検索・絞り込み中は全期間から探す。
  let records = sortedRecords();
  records = filtering ? records.filter(matchesFilter) : records.filter((r) => r.date.startsWith(viewMonth));

  document.getElementById("month-total").textContent =
    (!filtering && records.length) ? `${yen(sumAmount(records))} / ${records.length}回` : "";

  const summary = document.getElementById("search-summary");
  if (filtering) {
    summary.hidden = false;
    summary.textContent = `全期間の検索結果: ${records.length}件・${yen(sumAmount(records))}`;
  } else {
    summary.hidden = true;
  }

  const list = document.getElementById("history-list");
  const empty = document.getElementById("history-empty");
  list.innerHTML = "";
  empty.hidden = records.length > 0;
  empty.textContent = filtering ? "条件に合う記録がありません" : "この月の記録はありません";

  let lastDate = "";
  records.forEach((r) => {
    if (r.date !== lastDate) {
      lastDate = r.date;
      const d = new Date(r.date + "T00:00:00");
      const w = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
      const header = document.createElement("li");
      header.className = "date-header";
      // 検索中は年も表示(全期間なので何年か分かるように)
      header.textContent = filtering
        ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} (${w})`
        : `${d.getMonth() + 1}/${d.getDate()} (${w})`;
      list.appendChild(header);
    }
    list.appendChild(recordRow(r, true));
  });
}

// ---------- 写真の拡大表示 ----------

function openPhotoViewer(dataUrl) {
  document.getElementById("photo-viewer-img").src = dataUrl;
  document.getElementById("photo-viewer").hidden = false;
}
document.getElementById("photo-viewer").addEventListener("click", () => {
  document.getElementById("photo-viewer").hidden = true;
  document.getElementById("photo-viewer-img").removeAttribute("src");
});

function recordRow(r, withActions) {
  const c = catById(r.cat);
  const li = document.createElement("li");
  li.className = "record-item";

  const meta = withActions
    ? (r.memo || "")
    : [r.date.slice(5).replace("-", "/"), r.memo].filter(Boolean).join(" ・ ");

  li.innerHTML =
    `<span class="record-emoji">${c.emoji}</span>` +
    `<span class="record-main"><span class="record-cat">${c.label}</span>` +
    `<br><span class="record-meta"></span></span>` +
    `<span class="record-amount">${yen(r.amount)}</span>`;
  li.querySelector(".record-meta").textContent = meta;

  // 写真サムネイル(あれば絵文字と差し替え。タップで拡大)
  if (r.photo) {
    getPhoto(r.id).then((dataUrl) => {
      if (!dataUrl) return;
      const img = document.createElement("img");
      img.className = "record-thumb";
      img.src = dataUrl;
      img.alt = "記録の写真";
      img.addEventListener("click", (ev) => { ev.stopPropagation(); openPhotoViewer(dataUrl); });
      const emoji = li.querySelector(".record-emoji");
      if (emoji) emoji.replaceWith(img);
    });
  }

  if (withActions) {
    const actions = document.createElement("span");
    actions.className = "record-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "icon-btn";
    editBtn.textContent = "✏️";
    editBtn.addEventListener("click", () => startEdit(r.id));

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn";
    delBtn.textContent = "🗑️";
    delBtn.addEventListener("click", () => {
      if (confirm(`${c.label} ${yen(r.amount)} の記録を削除しますか?`)) {
        if (r.photo) deletePhoto(r.id);
        data.records = data.records.filter((x) => x.id !== r.id);
        saveData();
        renderHistory();
        showToast("記録を削除しました");
      }
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    li.appendChild(actions);
  }
  return li;
}

// ---------- 設定画面 ----------

function renderSettings() {
  document.getElementById("set-oshi-name").value = data.oshi.name;
  document.getElementById("set-oshi-emoji").value = data.oshi.emoji;
  document.getElementById("set-oshi-color").value = data.oshi.color;
  document.getElementById("set-budget").value = data.budget || "";
  renderGoalManage();
  renderEventManage();
  renderRecurringManage();
}

// 定期支出のカテゴリ選択肢を用意する
function buildRecCatOptions() {
  const sel = document.getElementById("rec-cat");
  sel.innerHTML = "";
  CATEGORIES.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.emoji} ${c.label}`;
    sel.appendChild(opt);
  });
}

document.getElementById("settings-save-btn").addEventListener("click", () => {
  data.oshi.name = document.getElementById("set-oshi-name").value.trim();
  data.oshi.emoji = document.getElementById("set-oshi-emoji").value.trim() || "💖";
  data.oshi.color = document.getElementById("set-oshi-color").value;
  data.budget = Math.max(0, Math.floor(Number(document.getElementById("set-budget").value) || 0));
  saveData();
  applyTheme();
  showToast("設定を保存しました ✨");
  showView("view-home");
});

// バックアップ(書き出し)。写真も一緒に書き出す
document.getElementById("export-btn").addEventListener("click", async () => {
  showToast("バックアップを準備中…");
  const photos = await getAllPhotos();
  const payload = Object.assign({}, data, { photos });
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `fave-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("バックアップを書き出しました 📦");
});

// バックアップ(読み込み)
document.getElementById("import-btn").addEventListener("click", () => {
  document.getElementById("import-file").click();
});

document.getElementById("import-file").addEventListener("change", (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.records)) throw new Error("形式が違います");
      if (!confirm("今のデータを読み込んだ内容で置き換えます。よろしいですか?")) return;
      const photos = parsed.photos || {};
      delete parsed.photos;
      data = Object.assign(defaultData(), parsed);
      // 写真をIndexedDBに復元(古い写真は一度消してから入れ直す)
      await clearAllPhotos();
      for (const id of Object.keys(photos)) {
        await savePhoto(id, photos[id]);
      }
      saveData();
      applyTheme();
      showToast("データを読み込みました ✅");
      showView("view-home");
    } catch (e) {
      showToast("読み込めませんでした(ファイルの形式が違います)");
    }
  };
  reader.readAsText(file);
  ev.target.value = "";
});

// 全削除
document.getElementById("clear-btn").addEventListener("click", () => {
  if (!confirm("すべての記録と設定を削除します。この操作は元に戻せません。よろしいですか?")) return;
  if (!confirm("本当に削除してよろしいですか?(バックアップの書き出しをおすすめします)")) return;
  data = defaultData();
  saveData();
  clearAllPhotos();
  applyTheme();
  resetAddForm();
  showToast("データを削除しました");
  showView("view-home");
});

// ---------- トースト & 紙吹雪 ----------

let toastTimer = null;
function showToast(text, ms = 2200) {
  const toast = document.getElementById("toast");
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), ms);
}

function launchConfetti() {
  const colors = [data.oshi.color, "#ffd166", "#7fc8f8", "#a4e57e", "#ffffff"];
  for (let i = 0; i < 36; i++) {
    const c = document.createElement("div");
    c.className = "confetti";
    c.style.left = Math.random() * 100 + "vw";
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.4 + Math.random() * 1.4 + "s";
    c.style.animationDelay = Math.random() * 0.4 + "s";
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3500);
  }
}

// ---------- 起動 ----------

applyTheme();
buildCatChips();
buildRecCatOptions();
buildFilterChips();
resetAddForm();
applyRecurring(); // 月が変わっていたら定期支出を記録
renderHome();

// オフライン対応(Service Worker)。対応ブラウザでのみ登録する
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    // 登録に失敗してもアプリ自体は普通に使える
  });
}

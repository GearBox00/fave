// fave Service Worker — オフライン対応
// 一度開いたことがあれば、電波がない場所でもアプリを起動できるようにする。
// 方式: キャッシュを先に返し、裏で最新版を取りに行って次回用に更新する
// (stale-while-revalidate)。更新は「次にアプリを開いたとき」に反映される。

"use strict";

const CACHE_NAME = "fave-v1";

// アプリの動作に必要なファイル一式(相対パスなので /fave/ 配下でも動く)
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
];

// インストール時: ファイル一式をキャッシュに保存
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// 有効化時: 古いバージョンのキャッシュを削除
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 通信時: キャッシュがあれば即返し、裏で最新版を取得してキャッシュを更新
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const fetched = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached); // オフライン時はキャッシュだけで応答
      return cached || fetched;
    })
  );
});

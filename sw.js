/* =========================================================
 * 工厂督察 PWA · Service Worker
 * 作用：离线可用 / 二次秒开 / 弱网可用
 * 策略：
 *  - 预缓存应用外壳（工厂督察首页、每日达成日报、图标、manifest）
 *  - 本站 HTML 页：秒开策略（先展示缓存，后台静默刷新最新数据）
 *  - 本站图片/字体：缓存优先
 *  - cdnjs 图表依赖（echarts/leaflet）：缓存优先，离线也能出图
 *  - 离线访问未缓存页面 → 回退到「工厂督察」首页
 * 更新：修改 VERSION 即可让所有客户端自动换新缓存
 * ========================================================= */
var VERSION = 'v2';
var SHELL_CACHE = 'fip-shell-' + VERSION;
var RUNTIME_CACHE = 'fip-runtime-' + VERSION;
var OFFLINE_FALLBACK = '/dashboard/daily';

var PRECACHE = [
  '/dashboard/daily',
  '/dashboard/daily_report',
  '/dashboard/manifest_daily.json',
  '/dashboard/manifest.json',
  '/dashboard/manifest_cockpit.json',
  '/dashboard/icon_daily-180.png',
  '/dashboard/icon_daily-192.png',
  '/dashboard/icon_daily-512.png',
  '/dashboard/icon-192.png',
  '/dashboard/icon-512.png',
  '/dashboard/favicon-32.png',
  '/dashboard/brand_lockup.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL_CACHE && k !== RUNTIME_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 归一化缓存键：同站去掉查询串；.html 页面统一为无后缀规范地址 */
function normKey(urlStr) {
  try {
    var u = new URL(urlStr);
    if (u.origin === self.location.origin) {
      u.search = '';
      u.hash = '';
      if (u.pathname.slice(-5) === '.html') {
        u.pathname = u.pathname.slice(0, -5);
      }
      if (u.pathname === '/dashboard/index') u.pathname = '/dashboard/';
    }
    return u.toString();
  } catch (err) {
    return urlStr;
  }
}

function cacheFirst(req) {
  var key = normKey(req.url);
  return caches.match(key).then(function (cached) {
    if (cached) return cached;
    return fetch(req).then(function (resp) {
      if (resp && (resp.ok || resp.type === 'opaque')) {
        var copy = resp.clone();
        caches.open(RUNTIME_CACHE).then(function (c) { c.put(key, copy); });
      }
      return resp;
    });
  });
}

function staleWhileRevalidate(req) {
  var key = normKey(req.url);
  var isNav = req.mode === 'navigate';
  return caches.match(key).then(function (cached) {
    var network = fetch(req).then(function (resp) {
      if (resp && (resp.ok || resp.type === 'opaque')) {
        var copy = resp.clone();
        var putKey = normKey(resp.url || req.url);
        caches.open(RUNTIME_CACHE).then(function (c) {
          c.put(putKey, copy);
          if (putKey !== key) c.put(key, resp.clone());
        });
      }
      return resp;
    }).catch(function () { return null; });

    if (cached) return cached;
    return network.then(function (resp) {
      if (resp) return resp;
      if (isNav) return offlineFallback();
      return new Response('', { status: 504, statusText: 'Offline' });
    });
  });
}

function offlineFallback() {
  var candidates = [OFFLINE_FALLBACK, '/dashboard/', '/dashboard/portal'];
  return candidates.reduce(function (chain, p) {
    return chain.then(function (hit) { return hit || caches.match(p); });
  }, Promise.resolve(null)).then(function (hit) {
    return hit || new Response(
      '<!DOCTYPE html><meta charset="utf-8"><title>离线</title>' +
      '<body style="font-family:sans-serif;padding:40px;text-align:center;color:#555">' +
      '<h2>当前无网络</h2><p>该页面尚未缓存，请联网打开一次后即可离线查看。</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* 图表依赖：缓存优先（版本化 URL，可长期缓存） */
  if (url.host === 'cdnjs.cloudflare.com') {
    e.respondWith(cacheFirst(req));
    return;
  }
  if (url.origin !== self.location.origin) return;

  /* 本站资源：图片/字体缓存优先；HTML 与 manifest 等走秒开策略 */
  var dest = req.destination;
  if (dest === 'image' || dest === 'font') {
    e.respondWith(cacheFirst(req));
  } else {
    e.respondWith(staleWhileRevalidate(req));
  }
});

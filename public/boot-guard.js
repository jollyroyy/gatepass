/* Quest Gate Pass boot guard — the script whose whole job is to notice that
 * the app did not start.
 *
 * 2026-08-31: the deployed app served a BLANK PAGE. `index.html` named
 * `/assets/index-BbT27NeX.js`; a request for that filename made during the
 * deploy window was answered 404; `vercel.json` stamps `Cache-Control:
 * public, max-age=31536000, immutable` on every response under `/assets/`,
 * whatever its status — so the browser pinned that 404 for a year. The module
 * never ran, `#root` stayed empty, and the page had nothing on it to say so.
 * The file was there the whole time: curl got 200 for the same URL.
 *
 * `public/sw.js` now refuses to believe a non-200 for a hashed filename and
 * retries past the cache, which fixes every request the worker handles. This
 * file exists for the case the worker cannot reach: a browser whose HTTP cache
 * is already poisoned and whose installed worker is still the OLD one. That
 * browser shows nothing, reports nothing, and would sit there until somebody
 * thought to hard-reload it.
 *
 * TWO SYMPTOMS, ONE REPAIR:
 *   an /assets/ resource fails to load   → the bundle is not going to run
 *   #root is still empty after the wait  → it ran and produced nothing
 *
 * The repair re-fetches what the document names with `cache: 'reload'`, which
 * evicts the poisoned entries, then reloads the page.
 *
 * AT MOST ONCE PER TAB. A repair that can fire twice is a reload loop, and a
 * looping tab is worse than the blank page — sessionStorage is what makes the
 * second attempt impossible, and it is deliberately not localStorage, so a new
 * tab after a genuinely broken deploy still gets its one try.
 *
 * It is a separate FILE rather than an inline script because the production CSP
 * is `script-src 'self'` with no hash and no nonce, and it must stay classic
 * (not a module) so it runs before the deferred bundle it is watching.
 */
(function () {
  var KEY = 'gatepass:boot-repair';
  var EMPTY_ROOT_WAIT_MS = 6000;
  var repairing = false;

  function appAssets() {
    var nodes = document.querySelectorAll('script[src], link[href]');
    var urls = [];
    for (var i = 0; i < nodes.length; i += 1) {
      var url = nodes[i].src || nodes[i].href || '';
      if (url.indexOf('/assets/') !== -1) urls.push(url);
    }
    return urls;
  }

  function repair(reason) {
    if (repairing) return;
    try {
      if (sessionStorage.getItem(KEY)) return;
      sessionStorage.setItem(KEY, reason);
    } catch (e) {
      // Private mode with storage denied. One repair attempt is still better
      // than a blank page; `repairing` alone keeps this pass from re-entering.
    }
    repairing = true;

    var urls = appAssets();
    var pending = [];
    for (var i = 0; i < urls.length; i += 1) {
      pending.push(fetch(urls[i], { cache: 'reload' }).catch(function () { return null; }));
    }
    Promise.all(pending).then(function () { location.reload(); });
  }

  /* Capture phase: a failed `<script>` or `<link>` fires an error event that
   * does not bubble, so a listener on the target's ancestors only sees it on
   * the way down. */
  addEventListener('error', function (event) {
    var el = event && event.target;
    if (!el) return;
    var url = el.src || el.href || '';
    if (url.indexOf('/assets/') !== -1) repair('asset-error');
  }, true);

  addEventListener('load', function () {
    setTimeout(function () {
      var root = document.getElementById('root');
      if (root && root.childElementCount === 0) repair('empty-root');
    }, EMPTY_ROOT_WAIT_MS);
  });
}());

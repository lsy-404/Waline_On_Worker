/**
 * Admin Panel - loads @waline/admin from CDN (matching original Waline implementation)
 * Includes Worker branding and menu injection based on worker_display setting
 * Menu injection uses client-side API check (server-side auth validation) so it
 * works on first login without page refresh
 */
import type { Env } from "../env.js";
import { getSettings } from "../router/settings.js";

export async function getAdminPage(
	env: Env,
	requestUrl: string,
): Promise<string> {
	const settings = await getSettings(env.DB, [
		"worker_display",
		"waline_admin_version",
	]).catch(() => ({}) as Record<string, string>);
	const workerDisplay = settings.worker_display || "admin";
	const adminVersion = (settings.waline_admin_version || "latest").trim();
	const url = new URL(requestUrl);
	const serverURL = `${url.origin}/api/`;
	const siteName = env.SITE_NAME || "";
	const siteUrl = env.SITE_URL || "";
	const recaptchaV3Key = env.RECAPTCHA_V3_KEY || "";
	const turnstileKey = env.TURNSTILE_KEY || "";
	const origin = url.origin;

	const showWorker = workerDisplay !== "disabled";
	const showAlways = workerDisplay === "always";

	// Build unpkg script src. Examples:
	//   latest        -> //unpkg.com/@waline/admin
	//   0.34.1        -> //unpkg.com/@waline/admin@0.34.1
	//   v0.34.1       -> //unpkg.com/@waline/admin@v0.34.1
	//   @0.34.1       -> //unpkg.com/@waline/admin@0.34.1 (strip leading @)
	//   npm:@waline/admin@latest  -> //unpkg.com/@waline/admin@latest
	const cleanVersion = adminVersion
		.replace(/^npm:@waline\/admin@?/, "")
		.replace(/^@/, "")
		.trim();
	const adminScript =
		cleanVersion && cleanVersion !== "latest"
			? `//unpkg.com/@waline/admin@${cleanVersion}`
			: "//unpkg.com/@waline/admin";

	return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Waline Management System</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
${showWorker ? `  <style>.wk-badge{display:inline-block;margin-right:8px;padding:1px 8px;background:#f97316;color:#fff;font-size:11px;border-radius:10px;vertical-align:middle;font-weight:normal;letter-spacing:.5px;line-height:18px}</style>` : ""}
</head>
<body>
  <script>
    window.serverURL = ${JSON.stringify(serverURL)};
    window.SITE_NAME = ${JSON.stringify(siteName || undefined)};
    window.SITE_URL = ${JSON.stringify(siteUrl || undefined)};
    window.recaptchaV3Key = ${JSON.stringify(recaptchaV3Key || undefined)};
    window.turnstileKey = ${JSON.stringify(turnstileKey || undefined)};
  </script>
  <!-- Block @waline/vercel upgrade notification: irrelevant for Workers deployment.
       The admin header fetches registry.npmjs.org to compare x-waline-version against
       the latest @waline/vercel release. Intercepting that request prevents the popup. -->
  <script>
  (function(){
    var _fetch = window.fetch;
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
      if (url.indexOf('registry.npmjs.org/@waline/vercel') !== -1) {
        return Promise.resolve(new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      return _fetch.call(this, input, init);
    };
  })();
  </script>
  <script src="${adminScript}"></script>
  <script>
  (function(){
    var attempts = 0;
    var timer = setInterval(function(){
      var params = new URLSearchParams(location.search);
      if (!params.has('token')) { clearInterval(timer); return; }
      var hasStoredToken = Boolean(window.TOKEN);
      try {
        hasStoredToken = hasStoredToken || Boolean(sessionStorage.getItem('TOKEN')) || Boolean(localStorage.getItem('TOKEN'));
      } catch (_) {}
      if (hasStoredToken) {
        params.delete('token');
        var query = params.toString();
        history.replaceState(history.state, '', location.pathname + (query ? '?' + query : '') + location.hash);
        clearInterval(timer);
      } else if (++attempts >= 100) {
        clearInterval(timer);
      }
    }, 20);
  })();
  </script>
${
	showWorker
		? `  <script>
  (function(){
    var ORIGIN = ${JSON.stringify(origin)};
    var ALWAYS = ${JSON.stringify(showAlways)};
    var menuDone = false, badgeDone = false;

    function addBadge() {
      if (badgeDone) return;
      var op = document.querySelector('.typecho-head-nav .operate');
      if (!op) return;
      badgeDone = true;
      var s = document.createElement('span');
      s.className = 'wk-badge';
      s.textContent = 'Worker v1.1.0';
      op.insertBefore(s, op.firstChild);
    }

    function addMenu() {
      if (menuDone) return;
      menuDone = true;
      var fab = document.createElement('a');
      fab.href = '/ui/worker-setting';
      fab.title = 'Worker 设置';
      fab.setAttribute('aria-label', 'Worker 设置');
      fab.onclick = function(e) {
        e.preventDefault();
        window.location.href = this.href;
      };
      fab.style.cssText = [
        'position:fixed',
        'bottom:24px',
        'right:24px',
        'width:44px',
        'height:44px',
        'border-radius:50%',
        'background:#f97316',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'text-decoration:none',
        'box-shadow:0 2px 8px rgba(0,0,0,.28)',
        'z-index:9999',
        'transition:transform .15s,box-shadow .15s',
        'user-select:none',
      ].join(';');
      var img = document.createElement('img');
      img.src = 'https://waline.js.org/logo.png';
      img.alt = '';
      img.style.cssText = 'width:28px;height:28px;filter:brightness(0) invert(1)';
      fab.appendChild(img);
      fab.addEventListener('mouseenter', function(){ fab.style.transform='scale(1.12)'; fab.style.boxShadow='0 4px 16px rgba(0,0,0,.35)'; });
      fab.addEventListener('mouseleave', function(){ fab.style.transform=''; fab.style.boxShadow='0 2px 8px rgba(0,0,0,.28)'; });
      document.body.appendChild(fab);
    }

    function tryInject() {
      if (ALWAYS && !badgeDone) addBadge();
      if (menuDone && badgeDone) return;
      var tk = window.TOKEN || localStorage.getItem('TOKEN') || sessionStorage.getItem('TOKEN');
      if (!tk && !ALWAYS) return;
      if (tk && !menuDone) {
        fetch(ORIGIN + '/api/token', {
          headers: { Authorization: 'Bearer ' + tk }
        }).then(function(r){ return r.json(); }).then(function(d){
          if (d.errno === 0 && d.data && d.data.type === 'administrator') {
            addMenu();
            addBadge();
          }
        }).catch(function(){});
      }
    }

    var ob = new MutationObserver(function(){ tryInject(); });
    ob.observe(document.body, { childList: true, subtree: true });
    var iv = setInterval(function(){ tryInject(); if (menuDone) clearInterval(iv); }, 2000);
    setTimeout(tryInject, 500);
  })();
  </script>`
		: ""
}
</body>
</html>`;
}

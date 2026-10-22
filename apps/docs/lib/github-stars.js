export var REPOSITORY_URL = "https://github.com/chadbyte/clay";
export var STARS_API_URL = "https://api.github.com/repos/chadbyte/clay";

export function readStarCount(data) {
  if (!data || data.full_name !== "chadbyte/clay") return null;
  return Number.isSafeInteger(data.stargazers_count) && data.stargazers_count >= 0 ? data.stargazers_count : null;
}

export function createStarLoader(options) {
  var fetcher = options.fetch;
  var now = options.now || Date.now;
  var timeoutMs = options.timeoutMs || 4000;
  var pending = null;
  var count = null;
  var expiresAt = 0;

  function load() {
    if (pending) return pending;
    if (now() < expiresAt) return Promise.resolve(count);
    var controller = new AbortController();
    var timer;
    var request = Promise.resolve().then(function () {
      return fetcher(STARS_API_URL, { headers: { Accept: "application/vnd.github+json" }, credentials: "omit", signal: controller.signal });
    }).then(function (response) {
      if (!response.ok) throw new Error("Repository count unavailable");
      return response.json();
    }).then(readStarCount);
    var timeout = new Promise(function (resolve) {
      timer = setTimeout(function () { controller.abort(); resolve(null); }, timeoutMs);
    });
    pending = Promise.race([request, timeout]).catch(function () { return null; }).then(function (result) {
      clearTimeout(timer);
      count = result;
      expiresAt = now() + (count === null ? 60000 : 600000);
      pending = null;
      return count;
    });
    return pending;
  }
  return load;
}

var loadStars = createStarLoader({ fetch: function (url, options) { return fetch(url, options); } });
export default loadStars;

import https from "node:https";
import { URL } from "node:url";

/**
 * 一个够用就好的 HTTPS GET → JSON。
 *
 * 刻意不做的事：不引第三方库、不读系统代理、不做重试风暴。
 * 面板只是查一次 release 列表；查不到就老实报错，让人看到"网络不通"
 * 而不是转圈。需要代理时由宿主环境（或 git）去解决。
 */
const MAX_BYTES = 2 * 1024 * 1024;

export function getJson(url, { timeoutMs = 8000, headers = {}, redirects = 3 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let target;
    try {
      target = new URL(url);
    } catch (e) {
      return done({ ok: false, error: `URL 非法：${String((e && e.message) || e)}` });
    }
    if (target.protocol !== "https:") return done({ ok: false, error: `只支持 https：${url}` });

    let req;
    try {
      req = https.request(
        {
          protocol: "https:",
          hostname: target.hostname,
          port: target.port || 443,
          path: `${target.pathname}${target.search}`,
          method: "GET",
          headers: {
            "user-agent": "dsh-pierce-panel",
            accept: "application/vnd.github+json",
            ...headers,
          },
          timeout: timeoutMs,
        },
        (res) => {
          const status = Number(res.statusCode || 0);
          if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
            res.resume();
            const next = new URL(res.headers.location, target).toString();
            return getJson(next, { timeoutMs, headers, redirects: redirects - 1 }).then(done);
          }
          const chunks = [];
          let size = 0;
          res.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_BYTES) {
              res.destroy();
              return done({ ok: false, status, error: `响应超过 ${MAX_BYTES} 字节` });
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            let json = null;
            try {
              json = JSON.parse(body);
            } catch {
              json = null;
            }
            done({
              ok: status >= 200 && status < 300 && json !== null,
              status,
              json,
              text: json === null ? body.slice(0, 300) : null,
            });
          });
          res.on("error", (e) => done({ ok: false, status, error: String((e && e.message) || e) }));
        },
      );
    } catch (e) {
      return done({ ok: false, error: String((e && e.message) || e) });
    }

    req.on("timeout", () => req.destroy(new Error(`请求超时（${timeoutMs}ms）`)));
    req.on("error", (e) => done({ ok: false, error: String((e && e.message) || e) }));
    req.end();
    return undefined;
  });
}

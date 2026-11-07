/**
 * 面板协议的单一来源：宿主路由、客户端调用、自检都读这里。
 *
 * 为什么单独一个文件：旧项目踩过"客户端写 /switch、宿主实现 /apply"这种漂移，
 * 表现是面板按钮点了没反应，日志里什么都没有。协议集中之后，自检可以拿
 * 这份表去**扫客户端源码**，缺哪条路由当场红。
 */
export const PANEL_PREFIX = "/pierce/api";

/** ping 返回的 service 字段：客户端用它确认对面是 pierce，而不是别的什么服务。 */
export const SERVICE_ID = "pierce-panel";

export const ROUTES = {
  ping: { path: "/ping", method: "GET" },
  state: { path: "/state", method: "GET" },
  prefs: { path: "/prefs", method: "POST" },
  reset: { path: "/reset", method: "POST" },
  audit: { path: "/audit", method: "POST" },
  updateCheck: { path: "/update/check", method: "POST" },
  updateApply: { path: "/update/apply", method: "POST" },
  restart: { path: "/restart", method: "POST" },
};

/** 自带端口服务的兜底基址（宿主 webServer 注册失败时客户端按端口探测）。 */
export const PORT_BASE = Number(process.env.PIERCE_PANEL_PORT || 7314);
export const PORT_TRIES = 8;

export function routePaths() {
  return Object.values(ROUTES).map((route) => route.path);
}

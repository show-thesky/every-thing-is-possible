/**
 * 适配器注册表 —— 机制层唯一允许"知道宿主"的地方。
 *
 * 一个适配器是一份能力描述，不是调用约定：
 *
 *   id          短名，写进 status.json（例："dsh"）
 *   detect()    现在是不是这个宿主；返回布尔
 *   surface()   宿主面（web / desktop / gui / tui）
 *   frameDirs() 注入正文的搜索目录，顺序即优先级（包内默认在最后）
 *   apply()     真正挂载（注册段、包装钩子、挂面板路由）
 *   status()    进程内活状态，供面板与命令行读
 *
 * 为什么要这一层：现在的实现是"机制 + DSH 外壳"粘在一个 index.js 里，
 * 换宿主或加代理形态就得复制整份。抽出描述之后，第二个适配器只需要实现 apply()。
 */

const REGISTRY = new Map();

/** 校验并登记。缺关键能力直接抛（装配期就炸，比运行时静默失效好）。 */
export function defineAdapter(spec) {
  if (!spec || typeof spec !== "object") throw new Error("adapter 必须是对象");
  const id = String(spec.id ?? "").trim();
  if (!id) throw new Error("adapter.id 必填");
  for (const key of ["detect", "apply"]) {
    if (typeof spec[key] !== "function") throw new Error(`adapter.${id} 缺少 ${key}()`);
  }
  const adapter = {
    id,
    priority: Number.isFinite(spec.priority) ? Number(spec.priority) : 0,
    detect: spec.detect,
    surface: typeof spec.surface === "function" ? spec.surface : () => "web",
    frameDirs: typeof spec.frameDirs === "function" ? spec.frameDirs : () => [],
    apply: spec.apply,
    status: typeof spec.status === "function" ? spec.status : () => null,
    describe: typeof spec.describe === "function" ? spec.describe : () => ({ id }),
  };
  REGISTRY.set(id, adapter);
  return adapter;
}

export function listAdapters() {
  return [...REGISTRY.values()].sort((a, b) => b.priority - a.priority).map((adapter) => adapter.id);
}

export function getAdapter(id) {
  return REGISTRY.get(String(id ?? "")) ?? null;
}

/**
 * 挑一个适配器：按优先级问 detect()，第一个说"是我"的胜出。
 * 都不认账时回退到 fallbackId（默认 dsh），保证"至少能跑"而不是空转。
 */
export function resolveAdapter(input = {}, fallbackId = "dsh") {
  const adapters = [...REGISTRY.values()].sort((a, b) => b.priority - a.priority);
  for (const adapter of adapters) {
    try {
      if (adapter.detect(input)) return adapter;
    } catch {
      /* detect 抛错就当不是它 */
    }
  }
  return REGISTRY.get(fallbackId) ?? null;
}

/** 测试用：清空注册表。 */
export function clearAdapters() {
  REGISTRY.clear();
}

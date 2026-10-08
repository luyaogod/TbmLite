import { useEffect, useRef, type ReactNode } from "react";
import { NavLink, useLocation, useOutlet } from "react-router-dom";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/projects", label: "项目管理" },
  { to: "/requirements", label: "需求书" },
  { to: "/search", label: "AI 搜索" },
];

/**
 * 页面保活容器（SPA 模式）：
 * 已访问的页面保持挂载，切换路由仅切换显隐，不重新挂载、不重新加载数据，
 * 列表过滤条件、滚动位置、AI 会话等状态全部保留。
 *
 * 注意：首页重定向（"/"）与兜底重定向（"*"）是 <Navigate> 元素，其 effect
 * 依赖不稳定的 navigate 函数，每次重渲染都会重新跳转 —— 若被缓存保活，
 * 会把任何导航都弹回 /projects，因此这两条路径不进入缓存。
 */
function KeepAliveOutlet() {
  const { pathname } = useLocation();
  const outlet = useOutlet();
  const cacheRef = useRef(new Map<string, ReactNode>());

  const cacheable = outlet !== null && pathname !== "/" && pathname !== "*";
  if (cacheable) cacheRef.current.set(pathname, outlet);

  return (
    <>
      {Array.from(cacheRef.current.entries()).map(([path, node]) => (
        <div
          key={path}
          className={
            path === pathname
              ? "absolute inset-0 flex flex-col overflow-hidden"
              : "hidden"
          }
        >
          {node}
        </div>
      ))}
      {!cacheable && outlet ? (
        <div className="absolute inset-0 flex flex-col overflow-hidden">{outlet}</div>
      ) : null}
    </>
  );
}

/** 把任意 CSS 颜色（包含 oklch 等新语法）转为 #rrggbb
 *  Electron 的 setTitleBarOverlay 只接受传统 CSS 颜色，不能直接传 oklch */
function toHexColor(color: string, fallback: string): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return fallback;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    if ([r, g, b].some((value) => Number.isNaN(value))) return fallback;
    return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}

export function AppShell() {
  // 无边框窗口（Windows）：顶部留一条可拖拽的标题带，窗口按钮由系统绘制在右上角
  const frameless = typeof window !== "undefined" && window.api?.app?.frameless === true;
  const shellRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  // 标题带底色跟随主题，避免系统按钮区与应用背景色不一致
  useEffect(() => {
    if (!frameless) return;
    const isDark = resolvedTheme === "dark";
    const fallback = isDark ? "#1f1f1f" : "#ffffff";
    const raw = shellRef.current ? getComputedStyle(shellRef.current).backgroundColor : fallback;
    void window.api.app
      .setTitleBarTheme({
        color: toHexColor(raw, fallback),
        symbolColor: isDark ? "#e5e7eb" : "#1f2937",
      })
      .catch(() => undefined);
  }, [frameless, resolvedTheme]);

  return (
    <div ref={shellRef} className="flex h-screen w-full flex-col overflow-hidden bg-background">
      {frameless ? <div className="titlebar-drag h-8 shrink-0 border-b bg-background" /> : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 侧边导航 */}
        <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
          <nav className="flex flex-1 flex-col gap-1 p-2">
            {navItems.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/75",
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="border-t p-2">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/75",
                )
              }
            >
              设置
            </NavLink>
          </div>
      </aside>

      {/* 主内容区（页面保活） */}
      <main className="relative min-w-0 flex-1 overflow-hidden">
        <KeepAliveOutlet />
      </main>
      </div>
    </div>
  );
}

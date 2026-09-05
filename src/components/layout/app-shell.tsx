import { useRef, type ReactNode } from "react";
import { NavLink, useLocation, useOutlet } from "react-router-dom";
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

export function AppShell() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* 侧边导航 */}
      <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 flex-col justify-center gap-0.5 border-b px-4">
          <span className="text-sm font-semibold">TBM Lite</span>
          <span className="text-[11px] text-sidebar-foreground/60">需求书管理系统</span>
        </div>

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
  );
}

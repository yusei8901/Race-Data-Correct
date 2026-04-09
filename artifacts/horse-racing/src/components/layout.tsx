import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Settings,
  ListOrdered,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  User,
  CalendarDays,
} from "lucide-react";
import { useUserRole } from "@/contexts/user-role";
import type { UserRole } from "@/contexts/user-role";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(true);
  const { role, setRole, isAdmin } = useUserRole();

  const allNavItems = [
    { name: "処理管理", href: "/processing", icon: Settings, adminOnly: true, match: (loc: string) => loc.startsWith("/processing") },
    { name: "開催管理", href: "/events", icon: CalendarDays, adminOnly: true, match: (loc: string) => loc.startsWith("/events") },
    { name: "レース一覧", href: "/", icon: ListOrdered, adminOnly: false, match: (loc: string) => loc === "/" || loc.startsWith("/races/") },
  ];

  const navigation = allNavItems.filter(item => !item.adminOnly || isAdmin);

  const handleRoleToggle = () => {
    setRole(role === "管理者" ? "一般ユーザー" : "管理者");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <div
        className={`flex-shrink-0 border-r border-border bg-sidebar flex flex-col transition-all duration-200 ${collapsed ? "w-14" : "w-56"}`}
      >
        <div className="h-14 flex items-center px-3 border-b border-border relative">
          <img
            src="/dragon.png"
            alt="Furlong CUBE"
            className="h-7 w-7 flex-shrink-0 object-contain"
          />
          {!collapsed && (
            <span className="ml-2 font-semibold text-sidebar-foreground tracking-tight text-sm whitespace-nowrap overflow-hidden">
              Furlong CUBE
            </span>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="absolute -right-3.5 top-1/2 -translate-y-1/2 bg-zinc-200 border border-zinc-300 rounded-full w-7 h-7 flex items-center justify-center text-zinc-800 hover:bg-white hover:border-white z-10 transition-colors shadow-md cursor-pointer"
            aria-label={collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          <nav className={`space-y-1 ${collapsed ? "px-1" : "px-2"}`}>
            {navigation.map((item) => {
              const isActive = item.match(location);
              return (
                <Link key={item.name} href={item.href}>
                  <div
                    className={`group flex items-center py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${collapsed ? "px-2 justify-center" : "px-3"} ${
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    }`}
                    title={collapsed ? item.name : undefined}
                  >
                    <item.icon
                      className={`flex-shrink-0 h-4 w-4 ${collapsed ? "" : "mr-3"} ${
                        isActive ? "text-primary" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/70"
                      }`}
                    />
                    {!collapsed && <span>{item.name}</span>}
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className={`border-t border-border ${collapsed ? "p-2" : "p-4"}`}>
          <div className="flex items-center">
            <div className="h-8 w-8 rounded bg-secondary flex items-center justify-center text-xs font-medium text-secondary-foreground border border-border flex-shrink-0">
              AN
            </div>
            {!collapsed && (
              <div className="ml-3 min-w-0">
                <p className="text-xs font-medium text-sidebar-foreground">アナリスト</p>
                <p className="text-[10px] text-muted-foreground">ID: 88912</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top header bar with role switcher */}
        <div className="h-9 border-b border-border bg-card flex items-center justify-end px-4 gap-2 flex-shrink-0">
          <span className="text-[11px] text-muted-foreground">権限:</span>
          <button
            onClick={handleRoleToggle}
            className={`flex items-center gap-1.5 h-6 px-3 rounded-full text-[11px] font-medium border transition-colors cursor-pointer ${
              isAdmin
                ? "bg-primary/20 border-primary/60 text-primary hover:bg-primary/30"
                : "bg-muted border-border text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            }`}
            title="クリックして権限を切り替え"
          >
            {isAdmin
              ? <><ShieldCheck className="h-3 w-3" />管理者</>
              : <><User className="h-3 w-3" />一般ユーザー</>
            }
          </button>
          <span className="text-[10px] text-muted-foreground/50">（デモ用）</span>
        </div>

        <main className="flex-1 overflow-y-auto focus:outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}

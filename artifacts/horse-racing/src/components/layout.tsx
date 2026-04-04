import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  ActivitySquare,
  Settings,
  ListOrdered,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const navigation = [
    { name: "処理管理", href: "/processing", icon: Settings, match: (loc: string) => loc.startsWith("/processing") },
    { name: "レース一覧", href: "/", icon: ListOrdered, match: (loc: string) => loc === "/" || loc.startsWith("/races/") },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div
        className={`flex-shrink-0 border-r border-border bg-sidebar flex flex-col transition-all duration-200 ${collapsed ? "w-14" : "w-56"}`}
      >
        <div className="h-14 flex items-center px-3 border-b border-border relative">
          <ActivitySquare className="h-5 w-5 text-primary flex-shrink-0" />
          {!collapsed && (
            <span className="ml-2 font-semibold text-sidebar-foreground tracking-tight text-sm whitespace-nowrap overflow-hidden">
              KEIBA DATA OPS
            </span>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`absolute -right-3 top-1/2 -translate-y-1/2 bg-sidebar border border-border rounded-full w-6 h-6 flex items-center justify-center text-sidebar-foreground/60 hover:text-sidebar-foreground z-10 transition-colors`}
            aria-label={collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
          >
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
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

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto focus:outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}

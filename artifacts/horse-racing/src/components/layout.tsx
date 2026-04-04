import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  ActivitySquare,
  Settings,
  ClipboardEdit
} from "lucide-react";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  const isOnDataCorrection = location.startsWith("/races/") && location.length > 7;
  const currentRaceHref = isOnDataCorrection ? location : null;

  const navigation = [
    { name: "レース一覧", href: "/", icon: LayoutDashboard, match: (loc: string) => loc === "/" },
    { 
      name: "データ補正", 
      href: currentRaceHref || "/", 
      icon: ClipboardEdit, 
      match: (loc: string) => loc.startsWith("/races/"),
      disabled: !isOnDataCorrection
    },
    { name: "処理管理", href: "/processing", icon: Settings, match: (loc: string) => loc.startsWith("/processing") },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="w-56 flex-shrink-0 border-r border-border bg-sidebar flex flex-col">
        <div className="h-14 flex items-center px-4 border-b border-border">
          <ActivitySquare className="h-5 w-5 text-primary mr-2 flex-shrink-0" />
          <span className="font-semibold text-sidebar-foreground tracking-tight text-sm">KEIBA DATA OPS</span>
        </div>
        <div className="flex-1 overflow-y-auto py-4">
          <nav className="px-2 space-y-1">
            {navigation.map((item) => {
              const isActive = item.match(location);
              return (
                <Link key={item.name} href={item.disabled ? "/" : item.href}>
                  <div
                    className={`group flex items-center px-3 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : item.disabled
                        ? "text-sidebar-foreground/30 cursor-not-allowed"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    }`}
                  >
                    <item.icon
                      className={`mr-3 flex-shrink-0 h-4 w-4 ${
                        isActive ? "text-primary" : item.disabled ? "text-sidebar-foreground/20" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/70"
                      }`}
                    />
                    <span>{item.name}</span>
                    {item.name === "データ補正" && !isOnDataCorrection && (
                      <span className="ml-auto text-[10px] text-sidebar-foreground/30">要選択</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="p-4 border-t border-border">
          <div className="flex items-center">
            <div className="h-8 w-8 rounded bg-secondary flex items-center justify-center text-xs font-medium text-secondary-foreground border border-border flex-shrink-0">
              AN
            </div>
            <div className="ml-3">
              <p className="text-xs font-medium text-sidebar-foreground">アナリスト</p>
              <p className="text-[10px] text-muted-foreground">ID: 88912</p>
            </div>
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

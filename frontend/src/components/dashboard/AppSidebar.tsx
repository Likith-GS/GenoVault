import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard, UploadCloud, Inbox, ShieldCheck, ScrollText, FileSearch, LogOut,
  Shield, ShieldAlert, FlaskConical,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

// Owner sidebar items only — researchers use ResearcherSidebar
const ownerItems = [
  { title: "Overview",      url: "/dashboard",              icon: LayoutDashboard },
  { title: "Files",         url: "/dashboard/upload",       icon: UploadCloud },
  { title: "Requests",      url: "/dashboard/requests",     icon: Inbox, badge: true },
  { title: "Access Control",url: "/dashboard/access",       icon: ShieldCheck },
  { title: "Verification",  url: "/dashboard/verification", icon: FileSearch },
  { title: "Audit Trail",   url: "/dashboard/audit",        icon: ScrollText },
  { title: "Provenance",    url: "/dashboard/provenance",   icon: Shield },
  { title: "Misuse Events",      url: "/dashboard/misuse",              icon: ShieldAlert },
  { title: "Watermark Testing",  url: "/dashboard/watermark-testing",  icon: FlaskConical },
];



/* ── Pending count badge ──────────────────────────────────────────────────── */
function PendingBadge({ count, collapsed }: { count: number; collapsed: boolean }) {
  if (count === 0) return null;
  const label = count > 99 ? "99+" : String(count);

  if (collapsed) {
    // When sidebar is collapsed show badge as a small dot on the icon
    return (
      <span
        className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center px-0.5 leading-none"
        aria-label={`${count} pending requests`}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className="ml-auto min-w-[20px] h-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1 leading-none"
      aria-label={`${count} pending requests`}
    >
      {label}
    </span>
  );
}

export const AppSidebar = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();

  const isOwner = true; // AppSidebar is only mounted inside DashboardLayout (owner)
  const items = ownerItems;

  /* ── Pending request count (owner only) ──────────────────────── */
  const [pendingCount, setPendingCount] = useState(0);

  const fetchPending = useCallback(async () => {
    if (!token || !isOwner) return;
    try {
      const res  = await fetch("http://localhost:5000/api/access/incoming-requests", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const count = (data.requests ?? []).filter(
        (r: { status: string }) => r.status === "pending"
      ).length;
      setPendingCount(count);
    } catch {
      // silently ignore — badge just won't show
    }
  }, [token, isOwner]);

  // Initial fetch + poll every 30 s
  useEffect(() => {
    fetchPending();
    if (!isOwner) return;
    const id = setInterval(fetchPending, 30_000);
    return () => clearInterval(id);
  }, [fetchPending, isOwner]);

  // Reset badge when user navigates to the Requests page
  useEffect(() => {
    if (location.pathname === "/dashboard/requests") {
      setPendingCount(0);
    }
  }, [location.pathname]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className={`flex items-center ${collapsed ? "justify-center px-1" : "px-2"} py-2`}>
          {collapsed ? (
            <div className="h-9 w-9 rounded-xl bg-gradient-primary shadow-elegant" />
          ) : (
            <Logo />
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Workspace</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map(item => {
                const active      = location.pathname === item.url;
                const showBadge   = "badge" in item && item.badge && isOwner;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild tooltip={item.title} isActive={active}>
                      <NavLink
                        to={item.url}
                        end
                        className="hover:bg-sidebar-accent"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        {/* Icon wrapper — relative so collapsed badge can position absolutely */}
                        <span className="relative flex shrink-0">
                          <item.icon className="h-4 w-4" />
                          {showBadge && collapsed && (
                            <PendingBadge count={pendingCount} collapsed={true} />
                          )}
                        </span>

                        {!collapsed && (
                          <>
                            <span>{item.title}</span>
                            {showBadge && (
                              <PendingBadge count={pendingCount} collapsed={false} />
                            )}
                          </>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => { logout(); navigate("/"); }} tooltip="Sign out">
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>Sign out</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};

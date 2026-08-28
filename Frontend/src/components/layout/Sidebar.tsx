import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Video,
  History,
  BookOpen,
  Settings,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  LucideIcon,
} from "lucide-react";

// 1. Define the props interface
interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  live?: boolean;
  activePaths?: string[];
}

const navItems: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  {
    to: "/live",
    label: "Live conversation",
    icon: Video,
    live: true,
    activePaths: ["/live", "/session-setup"],
  },
  { to: "/history", label: "History", icon: History },
  { to: "/resources", label: "Resources", icon: BookOpen },
  { to: "/settings", label: "Settings", icon: Settings },
];

// 2. Type the props parameter
export default function Sidebar({ isCollapsed, onToggle }: SidebarProps) {
  const { pathname } = useLocation();

  return (
    <aside className="bg-trust text-[#EAF3FB] px-2 py-4 flex flex-col gap-1.5 transition-all duration-300">
      {/* Logo & Toggle Button */}
      <div
        className={`flex items-center ${
          isCollapsed ? "justify-start" : "justify-between pl-1.5"
        } gap-2.5 mb-6`}
      >
        {!isCollapsed && (
          <NavLink to="/dashboard" className="flex items-center gap-2 overflow-hidden">
            <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-signal to-trust flex-shrink-0" />
            <div className="font-display font-bold text-lg leading-none whitespace-nowrap">
              Purdoy
            </div>
          </NavLink>
        )}

        <button
          onClick={onToggle}
          className="group rounded-[10px] hover:bg-white/10 text-[#C9DDEF] hover:text-white transition-colors"
          aria-label={isCollapsed ? "Open sidebar" : "Close sidebar"}
        >
          {isCollapsed ? (
            <div className="m-1.5">
              <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-signal to-trust flex-shrink-0 group-hover:hidden" />
              <div className="hidden group-hover:flex items-center justify-center p-1.5">
                <PanelLeftOpen size={20} />
              </div>
            </div>
          ) : (
            <div className="p-3">
              <PanelLeft size={20} className="group-hover:hidden" />
              <PanelLeftClose size={20} className="hidden group-hover:block" />
            </div>
          )}
        </button>
      </div>

      {/* Navigation */}
      {navItems.map(({ to, label, icon: Icon, live, activePaths }) => {
        const isActive = activePaths
          ? activePaths.includes(pathname)
          : pathname === to;

        return (
          <NavLink
            key={to}
            to={to}
            title={isCollapsed ? label : undefined}
            className={`flex items-center ${
              isCollapsed ? "py-3 px-3" : "gap-3 px-3"
            } py-2.5 rounded-[10px] text-md font-medium transition-colors ${
              isActive
                ? "bg-signal-light text-trust"
                : "text-[#C9DDEF] hover:bg-white/10 hover:text-white"
            }`}
          >
            <Icon size={20} className="flex-shrink-0" />

            {!isCollapsed && <span className="truncate">{label}</span>}

            {live && (
              <span
                className={`w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_0_3px_rgba(31,170,89,0.25)] ${
                  isCollapsed ? "absolute top-2 right-2" : "ml-auto"
                }`}
              />
            )}
          </NavLink>
        );
      })}

      {/* Footer */}
      {!isCollapsed && (
        <div className="mt-auto p-3.5 rounded-xl bg-white/5 text-sm text-[#AFCBE4] leading-relaxed">
          <b className="block text-[13px] text-[#EAF3FB] font-display mb-0.5">
            Device status
          </b>
          All systems ready · model v2.3
        </div>
      )}
    </aside>
  );
}

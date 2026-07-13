import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Video,
  History,
  BookOpen,
  Settings,
} from "lucide-react";

import { useLocation } from "../../hooks/useLocation";

const navItems = [
  { to: "/dashboard", label: "Dashboard",         icon: LayoutDashboard },
  { to: "/live",      label: "Live conversation", icon: Video, live: true, activePaths: ["/live", "/session-setup"] },
  { to: "/history",   label: "History",           icon: History },
  { to: "/resources", label: "Resources",         icon: BookOpen },
  { to: "/settings",  label: "Settings",          icon: Settings },
];

export default function Sidebar() {
  const { pathname } = useLocation();

  return (
    <aside className="bg-trust text-[#EAF3FB] px-4 py-7 flex flex-col gap-1.5">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-2 pb-6">
        <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-signal to-trust" />

        <div>
          <div className="font-display font-bold text-lg leading-none">
            Purdoy
          </div>

          <div className="text-[11px] text-[#9FC2E4] mt-0.5">
            FSL conversation assistant
          </div>
        </div>
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
            className={`flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors ${
              isActive
                ? "bg-signal-light text-trust"
                : "text-[#C9DDEF] hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon size={18} className="flex-shrink-0" />

            <span>{label}</span>

            {live && (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_0_3px_rgba(31,170,89,0.25)]" />
            )}
          </NavLink>
        );
      })}

      {/* Footer */}
      <div className="mt-auto p-3.5 rounded-xl bg-white/5 text-xs text-[#AFCBE4] leading-relaxed">
        <b className="block text-[13px] text-[#EAF3FB] font-display mb-0.5">
          Device status
        </b>
        All systems ready · model v2.3
      </div>
    </aside>
  );
}

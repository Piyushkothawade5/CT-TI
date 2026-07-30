import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Clock3, FileX2, LayoutGrid, LogOut, Mail, Shield, UserRound } from "lucide-react";
import type { UserProfile } from "@/api-client";

export function ProfileTopBar({
  profile,
  onLogout,
  title = "CT TI System",
  pendingCount = 0,
  onPendingClick,
  rejectedCount = 0,
  onRejectedClick,
  onModulesClick,
}: {
  profile: UserProfile;
  onLogout: () => void | Promise<void>;
  title?: string;
  pendingCount?: number;
  onPendingClick?: () => void;
  rejectedCount?: number;
  onRejectedClick?: () => void;
  onModulesClick?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasPendingItems = pendingCount > 0;
  const hasRejectedItems = rejectedCount > 0;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  return (
    <header className="relative z-[100] h-14 border-b border-gray-200 bg-white/95 shadow-sm backdrop-blur no-print">
      <div className="flex h-full items-center justify-between px-5">
        <div>
          <div className="text-sm font-bold text-[#20366f]">{title}</div>
        </div>

        <div className="flex items-center gap-3">
          {onModulesClick && (
            <button
              type="button"
              onClick={onModulesClick}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200"
              title="Modules"
              aria-label="Modules"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          )}

          {onPendingClick && (
            <button
              type="button"
              onClick={onPendingClick}
              className={`relative flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
                hasPendingItems
                  ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                  : "border-gray-200 bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              title="Pending TIs"
              aria-label="Pending TIs"
            >
              <Clock3 className="h-4 w-4" />
              <span
                className={`absolute -right-1.5 -top-1.5 min-w-5 rounded-full border border-white px-1 text-center text-[10px] font-bold leading-5 shadow-sm ${
                  hasPendingItems ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {pendingCount}
              </span>
            </button>
          )}

          {onRejectedClick && (
            <button
              type="button"
              onClick={onRejectedClick}
              className={`relative flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
                hasRejectedItems
                  ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                  : "border-gray-200 bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              title="Rejected TIs"
              aria-label="Rejected TIs"
            >
              <FileX2 className="h-4 w-4" />
              <span
                className={`absolute -right-1.5 -top-1.5 min-w-5 rounded-full border border-white px-1 text-center text-[10px] font-bold leading-5 shadow-sm ${
                  hasRejectedItems ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {rejectedCount}
              </span>
            </button>
          )}

          <div className="relative z-[110]" ref={menuRef}>
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-bold transition-colors ${
                open
                  ? "border-[#2b7cff] bg-[#eaf3ff] text-[#0b62d6] ring-2 ring-[#2b7cff]/20"
                  : "border-gray-200 bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              title="Profile"
              aria-label="Profile"
            >
              <UserRound className="h-4 w-4" />
            </button>

            {open && (
              <div className="absolute right-0 top-11 z-[120] w-80 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
                <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
                  <span className="text-sm font-semibold text-gray-700">{title}</span>
                </div>

                <div className="bg-gray-100 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-gray-500 bg-white text-sm font-bold text-gray-600">
                      {profile.initials || <UserRound className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-900">{profile.full_name}</div>
                      <div className="truncate text-xs text-gray-600">{profile.email}</div>
                    </div>
                  </div>
                </div>

                <div className="py-2 text-sm">
                  <ProfileMenuRow icon={<BadgeCheck />} label="Initials" value={profile.initials} />
                  <ProfileMenuRow icon={<Shield />} label="Role" value={profile.role} capitalize />
                  <ProfileMenuRow icon={<Mail />} label="Email" value={profile.email} />
                </div>

                <button
                  type="button"
                  onClick={onLogout}
                  className="flex w-full items-center gap-4 border-t border-gray-100 px-5 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <LogOut className="h-5 w-5 text-gray-500" />
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function ProfileMenuRow({
  icon,
  label,
  value,
  capitalize,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  capitalize?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-2.5 text-gray-700">
      <span className="[&>svg]:h-5 [&>svg]:w-5 text-gray-500">{icon}</span>
      <span className="w-20 shrink-0">{label}</span>
      <span className={`min-w-0 flex-1 truncate text-right text-gray-600 ${capitalize ? "capitalize" : ""}`} title={value || "-"}>
        {value || "-"}
      </span>
    </div>
  );
}

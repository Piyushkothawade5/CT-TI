import { ClipboardList, FileText, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UserProfile } from "@/api-client";

export type AppModule = "ti" | "work-order";

export default function ModuleSelection({
  profile,
  onLogout,
  onSelectModule,
}: {
  profile: UserProfile;
  onLogout: () => void | Promise<void>;
  onSelectModule: (module: AppModule) => void;
}) {
  return (
    <div className="min-h-screen bg-[#eef2f7]">
      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <div>
            <h1 className="text-lg font-bold text-[#20366f]">CT Application</h1>
            <p className="text-xs text-gray-500">{profile.full_name}</p>
          </div>
          <Button type="button" variant="outline" onClick={onLogout} className="border-gray-300 text-gray-700">
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center px-5 py-10">
        <section className="w-full">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Select Module</h2>
            <p className="mt-1 text-sm text-gray-600">Choose where you want to work after login.</p>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <ModuleButton
              icon={<FileText className="h-8 w-8" />}
              title="TI"
              subtitle={profile.role === "viewer" ? "Technical Instruction viewer" : "Technical Instruction entry and review"}
              tone="blue"
              onClick={() => onSelectModule("ti")}
            />
            <ModuleButton
              icon={<ClipboardList className="h-8 w-8" />}
              title="Work Order"
              subtitle="Work Order module"
              tone="green"
              onClick={() => onSelectModule("work-order")}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function ModuleButton({
  icon,
  title,
  subtitle,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tone: "blue" | "green";
  onClick: () => void;
}) {
  const toneClass =
    tone === "blue"
      ? "border-[#9bb5e8] bg-white text-[#20366f] hover:border-[#3b5fc0] hover:bg-[#f6f9ff]"
      : "border-emerald-200 bg-white text-emerald-900 hover:border-emerald-500 hover:bg-emerald-50";

  const iconClass = tone === "blue" ? "bg-[#eaf1ff] text-[#2a4080]" : "bg-emerald-100 text-emerald-700";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-40 w-full items-center gap-5 rounded-md border p-6 text-left shadow-sm transition-colors ${toneClass}`}
    >
      <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-md ${iconClass}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold">{title}</span>
        <span className="mt-1 block text-sm text-gray-600">{subtitle}</span>
      </span>
    </button>
  );
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "@/pages/home";
import Login from "@/pages/login";
import ModuleSelection, { type AppModule } from "@/pages/module-selection";
import Viewer from "@/pages/viewer";
import WorkOrder from "@/pages/work-order";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import type { AppRole } from "@/api-client";

const queryClient = new QueryClient();

function AppContent() {
  const { profile, isLoading, logout } = useAuth();
  const [selectedModule, setSelectedModule] = useState<AppModule | null>(null);

  useEffect(() => {
    if (!profile) setSelectedModule(null);
  }, [profile]);

  const handleLogout = async () => {
    setSelectedModule(null);
    await logout();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#eef2f7] text-[#2a4080] font-semibold">
        Loading CT TI System...
      </div>
    );
  }

  if (!profile) {
    return <Login />;
  }

  if (!selectedModule) {
    return <ModuleSelection profile={profile} onLogout={handleLogout} onSelectModule={setSelectedModule} />;
  }

  if (selectedModule === "work-order") {
    return <WorkOrder profile={profile} onLogout={handleLogout} onBackToModules={() => setSelectedModule(null)} />;
  }

  if (profile.role === "viewer") {
    return <Viewer profile={profile} onLogout={handleLogout} onBackToModules={() => setSelectedModule(null)} />;
  }

  return <Home profile={profile} onLogout={handleLogout} onBackToModules={() => setSelectedModule(null)} />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AppContent />
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export type { AppRole };
export default App;

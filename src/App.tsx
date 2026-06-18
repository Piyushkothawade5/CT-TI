import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "@/pages/home";
import Login from "@/pages/login";
import Viewer from "@/pages/viewer";

const queryClient = new QueryClient();
const ROLE_STORAGE_KEY = "ct_ti_role";
export type AppRole = "user" | "viewer";

function App() {
  const [role, setRole] = useState<AppRole | null>(() => {
    const savedRole = sessionStorage.getItem(ROLE_STORAGE_KEY);
    return savedRole === "user" || savedRole === "viewer" ? savedRole : null;
  });

  const handleLogin = (nextRole: AppRole) => {
    sessionStorage.setItem(ROLE_STORAGE_KEY, nextRole);
    setRole(nextRole);
  };

  const handleLogout = () => {
    sessionStorage.removeItem(ROLE_STORAGE_KEY);
    setRole(null);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {!role && <Login onLogin={handleLogin} />}
        {role === "user" && <Home onLogout={handleLogout} />}
        {role === "viewer" && <Viewer onLogout={handleLogout} />}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

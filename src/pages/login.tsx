import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Building2, Eye, UserRound, ArrowLeft } from "lucide-react";
import type { AppRole } from "@/App";

const USER_PASSWORD = "Shubhada";

export default function Login({ onLogin }: { onLogin: (role: AppRole) => void }) {
  const [selectedRole, setSelectedRole] = useState<AppRole | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== USER_PASSWORD) {
      setError("Incorrect password");
      return;
    }
    onLogin("user");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#eef2f7] px-4">
      <main className="w-full max-w-3xl bg-white border border-gray-200 shadow-xl">
        <header className="bg-[#2a4080] px-8 py-7 text-white flex items-center gap-4">
          <div className="w-12 h-12 bg-white text-[#2a4080] flex items-center justify-center rounded-md">
            <Building2 className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">CT TI System</h1>
            <p className="text-blue-100 text-sm">Choose how you want to access technical instructions</p>
          </div>
        </header>

        {!selectedRole ? (
          <div className="grid md:grid-cols-2 gap-5 p-8">
            <button
              type="button"
              onClick={() => setSelectedRole("user")}
              className="border border-gray-300 p-7 text-left hover:border-[#2a4080] hover:bg-blue-50 transition-colors rounded-md"
            >
              <UserRound className="w-8 h-8 text-[#2a4080] mb-5" />
              <span className="block text-lg font-bold text-gray-900">User</span>
              <span className="block text-sm text-gray-600 mt-1">Create, edit, search, print, and download TIs.</span>
            </button>
            <button
              type="button"
              onClick={() => onLogin("viewer")}
              className="border border-gray-300 p-7 text-left hover:border-[#2a4080] hover:bg-blue-50 transition-colors rounded-md"
            >
              <Eye className="w-8 h-8 text-[#2a4080] mb-5" />
              <span className="block text-lg font-bold text-gray-900">Viewer</span>
              <span className="block text-sm text-gray-600 mt-1">View, search, print, and download TIs only.</span>
            </button>
          </div>
        ) : (
          <div className="max-w-md mx-auto p-8">
            <button
              type="button"
              onClick={() => { setSelectedRole(null); setPassword(""); setError(""); }}
              className="inline-flex items-center gap-2 text-sm text-[#2a4080] mb-6 hover:underline"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <h2 className="text-xl font-bold text-gray-900">User access</h2>
            <p className="text-sm text-gray-600 mt-1 mb-6">Enter the User password to open the editable TI form.</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                autoFocus
                required
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
            <Button type="submit" className="w-full bg-primary hover:bg-primary/90">
              Open User Mode
            </Button>
          </form>
          </div>
        )}
      </main>
    </div>
  );
}

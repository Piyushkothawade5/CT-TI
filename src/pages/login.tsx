import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Building2, LogIn } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#eef2f7] px-4">
      <main className="w-full max-w-md bg-white border border-gray-200 shadow-xl rounded-md overflow-hidden">
        <header className="bg-[#2a4080] px-7 py-6 text-white flex items-center gap-4">
          <div className="w-12 h-12 bg-white text-[#2a4080] flex items-center justify-center rounded-md">
            <Building2 className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">CT TI System</h1>
            <p className="text-blue-100 text-sm">Sign in with your assigned account</p>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="p-7 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError("");
              }}
              autoComplete="email"
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <Button type="submit" disabled={isSubmitting} className="w-full bg-[#2a4080] hover:bg-[#1f3164]">
            <LogIn className="w-4 h-4 mr-2" />
            {isSubmitting ? "Signing in..." : "Sign In"}
          </Button>
        </form>
      </main>
    </div>
  );
}

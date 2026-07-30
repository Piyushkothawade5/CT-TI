import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  restoreAuthSession,
  signInWithPassword,
  signOut,
  type AuthSession,
  type UserProfile,
} from "@/api-client";

type AuthContextValue = {
  session: AuthSession | null;
  profile: UserProfile | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshProfile = async () => {
    const restored = await restoreAuthSession();
    setSession(restored?.session || null);
    setProfile(restored?.profile || null);
  };

  useEffect(() => {
    let cancelled = false;
    restoreAuthSession()
      .then((restored) => {
        if (cancelled) return;
        setSession(restored?.session || null);
        setProfile(restored?.profile || null);
      })
      .catch(() => {
        if (cancelled) return;
        setSession(null);
        setProfile(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      isLoading,
      login: async (email, password) => {
        const result = await signInWithPassword(email, password);
        setSession(result.session);
        setProfile(result.profile);
      },
      logout: async () => {
        await signOut();
        setSession(null);
        setProfile(null);
      },
      refreshProfile,
    }),
    [isLoading, profile, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

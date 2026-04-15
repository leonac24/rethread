'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { clientAuth, isFirebaseConfigured } from '@/lib/firebase/client';

type AuthUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  // Stats loaded from /api/auth/callback after sign-in
  totalCO2SavedKg?: number;
  totalWaterSavedLiters?: number;
  actionCount?: number;
};

type AuthContextValue = {
  user: AuthUser | null;
  firebaseUser: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  firebaseUser: null,
  loading: true,
  signOut: async () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function callAuthCallback(fbUser: User): Promise<void> {
    try {
      const token = await fbUser.getIdToken();
      const res = await fetch('/api/auth/callback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const profile = await res.json() as {
        uid: string;
        displayName: string | null;
        avatarUrl: string | null;
        totalCO2SavedKg: number;
        totalWaterSavedLiters: number;
        actionCount: number;
      };
      setUser({
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: profile.displayName ?? fbUser.displayName,
        photoURL: fbUser.photoURL,
        totalCO2SavedKg: profile.totalCO2SavedKg,
        totalWaterSavedLiters: profile.totalWaterSavedLiters,
        actionCount: profile.actionCount,
      });
    } catch {
      // Network failure — still set user from Firebase data
      setUser({
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName,
        photoURL: fbUser.photoURL,
      });
    }
  }

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(clientAuth(), async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        await callAuthCallback(fbUser);
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  async function signOut() {
    await firebaseSignOut(clientAuth());
    setUser(null);
    setFirebaseUser(null);
  }

  async function refreshUser() {
    if (firebaseUser) await callAuthCallback(firebaseUser);
  }

  return (
    <AuthContext.Provider value={{ user, firebaseUser, loading, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

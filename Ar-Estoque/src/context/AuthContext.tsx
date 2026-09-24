import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Profile } from '@/lib/supabase';
import { errorMessage, hasLocalDayChanged, millisecondsUntilNextLocalMidnight, todayLocal } from '@/lib/utils';

interface AuthContextType {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileError: string | null;
  reloadProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, name: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const SESSION_DAY_KEY = 'ar-estoque-login-date';

function readSessionDay(): string | null {
  try {
    return localStorage.getItem(SESSION_DAY_KEY);
  } catch {
    return null;
  }
}

function writeSessionDay(day: string) {
  try {
    localStorage.setItem(SESSION_DAY_KEY, day);
  } catch {
    // The daily timeout still applies for this open tab when storage is unavailable.
  }
}

function clearSessionDay() {
  try {
    localStorage.removeItem(SESSION_DAY_KEY);
  } catch {
    // Authentication state remains controlled by Supabase.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const revision = useRef(0);
  const dayLogoutInProgress = useRef(false);
  const sessionDay = useRef<string | null>(null);

  const signOut = useCallback(async () => {
    sessionDay.current = null;
    clearSessionDay();
    try {
      await supabase.auth.signOut();
    } finally {
      setProfile(null);
      setSession(null);
      setLoading(false);
    }
  }, []);

  const signOutForNewDay = useCallback(async () => {
    if (dayLogoutInProgress.current) return;
    dayLogoutInProgress.current = true;
    try {
      await signOut();
    } catch {
      // The local authenticated UI has already been cleared by signOut's finally block.
    } finally {
      dayLogoutInProgress.current = false;
    }
  }, [signOut]);

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      if (event === 'SIGNED_IN' && next) {
        sessionDay.current = todayLocal();
        writeSessionDay(sessionDay.current);
      }
      if (event === 'SIGNED_OUT') {
        sessionDay.current = null;
        clearSessionDay();
      }
      setSession(next);
      setProfile(null);
      setLoading(!!next);
    });

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      if (error) setProfileError(error.message);

      const restoredSession = data.session;
      if (restoredSession) {
        const currentDay = todayLocal();
        const savedDay = readSessionDay();
        if (hasLocalDayChanged(savedDay, currentDay)) {
          clearSessionDay();
          try {
            await supabase.auth.signOut();
          } catch {
            // Keep the local app signed out without surfacing a startup error.
          } finally {
            if (active) {
              setSession(null);
              setProfile(null);
              setLoading(false);
            }
          }
          return;
        }
        // Existing sessions created before daily expiry are treated as starting today.
        sessionDay.current = savedDay || currentDay;
        if (!savedDay) writeSessionDay(currentDay);
      } else {
        sessionDay.current = null;
        clearSessionDay();
      }

      if (!active) return;
      setSession(restoredSession);
      if (!restoredSession) setLoading(false);
    }).catch(error => {
      if (!active) return;
      setProfileError(errorMessage(error));
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    let timer: number | undefined;
    const checkSessionDay = () => {
      const storedDay = readSessionDay() ?? sessionDay.current ?? todayLocal();
      if (hasLocalDayChanged(storedDay, todayLocal())) void signOutForNewDay();
    };
    const scheduleMidnightCheck = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        checkSessionDay();
        scheduleMidnightCheck();
      }, millisecondsUntilNextLocalMidnight() + 50);
    };
    const checkOnReturn = () => {
      checkSessionDay();
      scheduleMidnightCheck();
    };

    scheduleMidnightCheck();
    window.addEventListener('focus', checkOnReturn);
    document.addEventListener('visibilitychange', checkOnReturn);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', checkOnReturn);
      document.removeEventListener('visibilitychange', checkOnReturn);
    };
  }, [session, signOutForNewDay]);

  const reloadProfile = useCallback(async () => {
    const current = ++revision.current;
    if (!session) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setProfileError(null);
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      if (error) throw error;
      if (current === revision.current) {
        setProfile(data);
        if (!data) setProfileError('Perfil não encontrado. Aplique a migração de correção do banco.');
      }
    } catch (error) {
      if (current === revision.current) setProfileError(errorMessage(error));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    const currentRevision = revision;
    void reloadProfile();
    return () => { currentRevision.current++; };
  }, [reloadProfile]);

  async function signIn(email: string, password: string) {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      return { error: error?.message ?? null };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }

  async function signUp(email: string, password: string, name: string) {
    try {
      const { error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } });
      return { error: error?.message ?? null };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, profileError, reloadProfile, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider ausente');
  return context;
}

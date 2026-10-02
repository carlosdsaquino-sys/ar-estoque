import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { allRows } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { errorMessage, millisecondsUntilNextLocalMidnight, todayLocal } from '@/lib/utils';
import { appointmentCounts, type Appointment } from '@/lib/appointments';

const Context = createContext<{ items: Appointment[]; loading: boolean; error: string | null; todayCount: number; tomorrowCount: number; refresh: () => Promise<void> } | undefined>(undefined);
export function AppointmentsProvider({ children }: { children: ReactNode }) {
  const { profile, session } = useAuth();
  const userId = session?.user.id;
  const ready = Boolean(profile?.is_active && profile.id === userId);
  const revision = useRef(0);
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!ready || !userId) return;
    const currentRevision = ++revision.current;
    setLoading(true); setError(null);
    try {
      const loaded = await allRows<Appointment>(() => supabase.from('appointments').select('*, client:clients(*), service_type:service_types(*), appliances:appointment_appliances(client_appliance_id, appliance:client_appliances(*))').order('scheduled_date').order('scheduled_time').order('id'));
      if (currentRevision === revision.current) setItems(loaded);
    } catch (e) { if (currentRevision === revision.current) setError(errorMessage(e)); } finally { if (currentRevision === revision.current) setLoading(false); }
  }, [ready, userId]);
  useEffect(() => {
    const revisionRef = revision;
    if (!ready) { revision.current++; setItems([]); setLoading(true); return; }
    void refresh();
    const change = () => { void refresh(); };
    window.addEventListener('ar-estoque-appointments-changed', change);
    let timer = 0;
    const nextDay = () => { timer = window.setTimeout(() => { change(); nextDay(); }, millisecondsUntilNextLocalMidnight() + 100); };
    nextDay();
    return () => { revisionRef.current++; window.clearTimeout(timer); window.removeEventListener('ar-estoque-appointments-changed', change); };
  }, [ready, refresh, userId]);
  const value = useMemo(() => ({ items, loading, error, refresh,
    ...appointmentCounts(items, todayLocal()),
  }), [items, loading, error, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAppointments() {
  const context = useContext(Context);
  if (!context) throw new Error('AppointmentsProvider ausente');
  return context;
}

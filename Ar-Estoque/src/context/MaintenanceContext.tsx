import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { errorMessage, millisecondsUntilNextLocalMidnight, todayLocal } from '@/lib/utils';
import { maintenanceCategory } from '@/lib/maintenance';
import { supabase, type MaintenanceOverviewItem } from '@/lib/supabase';

interface MaintenanceContextValue {
  items: MaintenanceOverviewItem[];
  loading: boolean;
  error: string | null;
  overdueCount: number;
  todayCount: number;
  upcomingCount: number;
  onTimeCount: number;
  overdueClientCount: number;
  refresh: () => Promise<void>;
}

const MaintenanceContext = createContext<MaintenanceContextValue | undefined>(undefined);
const DATA_CHANGED_EVENT = 'ar-estoque-maintenance-data-changed';

export function MaintenanceProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth();
  const revision = useRef(0);
  const [items, setItems] = useState<MaintenanceOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const userId = session?.user.id ?? null;
  const profileReady = Boolean(profile?.is_active && profile.id === userId);

  const refresh = useCallback(async () => {
    if (!userId || !profileReady) return;
    const currentRevision = ++revision.current;
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase.rpc('maintenance_overview', { p_today: todayLocal() });
      if (queryError) throw queryError;
      if (currentRevision === revision.current) setItems((data ?? []) as MaintenanceOverviewItem[]);
    } catch (queryError) {
      if (currentRevision === revision.current) setError(errorMessage(queryError));
    } finally {
      if (currentRevision === revision.current) setLoading(false);
    }
  }, [profileReady, userId]);

  useEffect(() => {
    const revisionRef = revision;
    if (!userId || !profileReady) {
      revision.current++;
      setItems([]);
      setLoading(!userId);
      return;
    }

    void refresh();
    const handleDataChanged = () => { void refresh(); };
    window.addEventListener(DATA_CHANGED_EVENT, handleDataChanged);

    let timer = 0;
    const scheduleNextLocalDay = () => {
      timer = window.setTimeout(() => {
        void refresh();
        scheduleNextLocalDay();
      }, millisecondsUntilNextLocalMidnight() + 100);
    };
    scheduleNextLocalDay();

    return () => {
      revisionRef.current++;
      window.clearTimeout(timer);
      window.removeEventListener(DATA_CHANGED_EVENT, handleDataChanged);
    };
  }, [profileReady, refresh, userId]);

  const value = useMemo(() => {
    const overdue = items.filter(item => maintenanceCategory(item) === 'overdue');
    return {
      items,
      loading,
      error,
      overdueCount: overdue.length,
      todayCount: items.filter(item => maintenanceCategory(item) === 'today').length,
      upcomingCount: items.filter(item => maintenanceCategory(item) === 'upcoming').length,
      onTimeCount: items.filter(item => maintenanceCategory(item) === 'on-time').length,
      overdueClientCount: new Set(overdue.map(item => item.client_id)).size,
      refresh,
    };
  }, [error, items, loading, refresh]);

  return <MaintenanceContext.Provider value={value}>{children}</MaintenanceContext.Provider>;
}

export function useMaintenance() {
  const context = useContext(MaintenanceContext);
  if (!context) throw new Error('MaintenanceProvider ausente');
  return context;
}

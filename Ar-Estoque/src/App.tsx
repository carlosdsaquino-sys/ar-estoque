import { useState } from 'react';
import { configurationMissing } from '@/lib/supabase';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import Layout, { type PageId } from '@/components/AppLayout';
import UsersPage from '@/pages/Users';
import AuthPage from '@/pages/AuthPage';
import Dashboard from '@/pages/Dashboard';
import Products from '@/pages/Products';
import Movements from '@/pages/Movements';
import Clients from '@/pages/Clients';
import Services from '@/pages/Services';
import ServiceTypes from '@/pages/ServiceTypes';
import Reports, { ProfitReport } from '@/pages/Reports';
import Import from '@/pages/Import';
import { LoadingSpinner } from '@/components/ui';
import { DialogProvider } from '@/components/DialogProvider';
import { ThemeProvider } from '@/context/ThemeContext';

function AppContent() {
  const { session, profile, loading, profileError, reloadProfile, signOut } = useAuth();
  const [page, setPage] = useState<PageId>('dashboard');

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingSpinner label="Carregando..." />
      </div>
    );
  }

  if (!session) {
    return <AuthPage />;
  }

  if (!profile?.is_active || profileError) return <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
    <h1 className="text-xl font-bold">Acesso ao sistema</h1>
    <p>{profileError || 'Sua conta aguarda liberação do administrador.'}</p>
    <button onClick={reloadProfile} className="text-sky-700">Verificar acesso</button>
    <button onClick={signOut}>Sair</button>
  </div>;
  return (
    <Layout current={page} onNavigate={setPage}>
      {page === 'users' && profile.role === 'admin' && <UsersPage />}
      {page === 'dashboard' && <Dashboard />}
      {page === 'products' && <Products />}
      {page === 'movements' && <Movements />}
      {page === 'service-types' && <ServiceTypes />}
      {page === 'clients' && <Clients />}
      {page === 'services' && <Services />}
      {page === 'reports' && <Reports mode="general" />}
      {page === 'report-movements' && <Reports mode="movements" />}
      {page === 'profit-report' && <ProfitReport />}
      {page === 'import' && <Import />}
    </Layout>
  );
}

function App() {
  if (configurationMissing) return <div className="p-8 max-w-xl mx-auto"><h1 className="font-bold text-xl mb-4">Configure a conexão</h1><p>Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env e reinicie o projeto. Veja LEIA-ME.md.</p></div>;
  return (
    <ThemeProvider>
      <DialogProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </DialogProvider>
    </ThemeProvider>
  );
}

export default App;

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  Snowflake,
  LayoutDashboard,
  Package,
  ArrowLeftRight,
  Users,
  Wrench,
  FileBarChart,
  Banknote,
  Upload,
  LogOut,
  Menu,
  X,
  Shield,
  ChevronDown,
  Loader2,
  Moon,
  Sun,
} from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';

export type PageId =
  | 'dashboard'
  | 'products'
  | 'movements'
  | 'service-types'
  | 'clients'
  | 'services'
  | 'cash'
  | 'reports'
  | 'report-movements'
  | 'profit-report'
  | 'import'
  | 'users';

const items: {
  id: PageId;
  label: string;
  icon: typeof Package;
  adminOnly?: boolean;
}[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'products', label: 'Produtos', icon: Package },
  { id: 'movements', label: 'Movimentações', icon: ArrowLeftRight },
  { id: 'service-types', label: 'Tipos de serviço', icon: Wrench },
  { id: 'clients', label: 'Clientes', icon: Users },
  { id: 'services', label: 'Serviços', icon: Wrench },
  { id: 'cash', label: 'Caixa', icon: Banknote },
  { id: 'reports', label: 'Relatórios', icon: FileBarChart },
  { id: 'import', label: 'Importar planilha', icon: Upload, adminOnly: true },
  { id: 'users', label: 'Usuários', icon: Shield, adminOnly: true },
];

const stockPages: PageId[] = ['products', 'movements', 'service-types', 'import'];
const reportPages: PageId[] = ['reports', 'report-movements', 'profit-report'];
const reportOptions: (typeof items[number])[] = [
  { id: 'reports', label: 'Relatórios gerais', icon: FileBarChart },
  { id: 'report-movements', label: 'Movimentações', icon: ArrowLeftRight },
  { id: 'profit-report', label: 'Relatório de lucros', icon: FileBarChart },
];

export default function Layout({
  current,
  onNavigate,
  children,
}: {
  current: PageId;
  onNavigate: (page: PageId) => void;
  children: ReactNode;
}) {
  const { profile, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');

  const headerRef = useRef<HTMLElement>(null);
  const stockButtonRef = useRef<HTMLButtonElement>(null);
  const reportsButtonRef = useRef<HTMLButtonElement>(null);
  const mobileButtonRef = useRef<HTMLButtonElement>(null);
  const mobileReportsButtonRef = useRef<HTMLButtonElement>(null);

  const isAdmin = profile?.role === 'admin';

  const visibleItems = items.filter(
    item => !item.adminOnly || isAdmin
  );

  const name = profile?.name?.trim() || 'Usuário';

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();

  const focusStyle =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-700';

  useEffect(() => {
    if (!mobileOpen && !stockOpen && !reportsOpen) return;

    const closeOutside = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) {
        setMobileOpen(false);
        setStockOpen(false);
        setReportsOpen(false);
      }
    };

    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (reportsOpen) {
          (mobileOpen ? mobileButtonRef.current : reportsButtonRef.current)?.focus();
        } else if (stockOpen) {
          stockButtonRef.current?.focus();
        } else {
          mobileButtonRef.current?.focus();
        }

        setStockOpen(false);
        setReportsOpen(false);
        setMobileOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [mobileOpen, stockOpen, reportsOpen]);

  function navigate(page: PageId) {
    onNavigate(page);
    setMobileOpen(false);
    setStockOpen(false);
    setReportsOpen(false);
  }

  async function logout() {
    if (leaving) return;

    setError('');
    setLeaving(true);

    try {
      await signOut();
    } catch {
      setError('Não foi possível sair. Tente novamente.');
    } finally {
      setLeaving(false);
    }
  }

  function navButton(
    item: typeof items[number],
    compact = false
  ) {
    const Icon = item.icon;
    const active = current === item.id;

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => navigate(item.id)}
        aria-current={active ? 'page' : undefined}
        className={`
          ${focusStyle}
          group
          flex
          items-center
          gap-1.5
          rounded-xl
          px-3
          py-2.5
          text-[14px]
          font-semibold
          tracking-[0.005em]
          transition-all
          duration-200
          ${compact ? 'w-full text-left' : 'whitespace-nowrap'}
          ${
            active
              ? `
                bg-blue-500/25
                text-white
                shadow-[inset_0_0_0_1px_rgba(147,197,253,0.20)]
              `
              : `
                text-white/95
                hover:bg-white/10
                hover:text-white
              `
          }
        `}
      >
        {compact && (
          <Icon
            className={`
              h-4 w-4 shrink-0
              transition-colors
              ${
                active
                  ? 'text-blue-200'
                  : 'text-white/85 group-hover:text-white'
              }
            `}
            aria-hidden="true"
          />
        )}

        {item.label}
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors">
      {/* =========================================================
          MENU FLUTUANTE
      ========================================================= */}
      <header
        ref={headerRef}
        className="
          fixed
          left-1/2
          top-3
          z-50
          w-[calc(100%-2rem)]
          max-w-[1280px]
          -translate-x-1/2
          rounded-[28px]
          border
          border-slate-300/35
          bg-slate-700/55
          supports-[backdrop-filter]:bg-slate-700/45
          dark:border-slate-500/20
          dark:bg-slate-950/65
          dark:supports-[backdrop-filter]:bg-slate-950/55
          backdrop-blur-xl
          text-white
          shadow-[0_14px_40px_rgba(15,23,42,0.22)]
          print:hidden
          sm:top-4
          sm:w-[calc(100%-3rem)]
          lg:rounded-[30px]
        "
      >
        <div className="flex h-[60px] items-center gap-2 px-3 sm:px-4">
          {/* =====================================================
              LOGO
          ====================================================== */}
          <button
            type="button"
            onClick={() => navigate('dashboard')}
            aria-label="Ar Estoque — início"
            className={`
              ${focusStyle}
              flex
              shrink-0
              items-center
              gap-2
              rounded-lg
              lg:mr-2
            `}
          >
            <span
              className="
                flex
                h-8
                w-8
                items-center
                justify-center
                rounded-lg
                bg-blue-500
                text-white
                shadow-sm
              "
            >
              <Snowflake
                className="h-5 w-5"
                aria-hidden="true"
              />
            </span>

            <span className="text-base font-semibold tracking-tight text-white sm:text-lg">
              Ar Estoque
            </span>
          </button>

          {/* =====================================================
              MENU DESKTOP
          ====================================================== */}
          <nav
            aria-label="Menu principal"
            className="
              hidden
              flex-1
              items-center
              justify-center
              gap-0.5
              xl:flex
            "
          >
            {navButton(items[0])}

            {/* ESTOQUE */}
            <div className="relative">
              <button
                ref={stockButtonRef}
                type="button"
                aria-expanded={stockOpen}
                aria-controls="stock-navigation"
                onClick={() => {
                  setStockOpen(open => !open);
                  setReportsOpen(false);
                }}
                className={`
                  ${focusStyle}
                  flex
                  items-center
                  gap-1.5
                  rounded-xl
                  px-3
                  py-2.5
                  text-[14px]
                  font-semibold
                  tracking-[0.005em]
                  transition-all
                  duration-200
                  ${
                    stockPages.includes(current)
                      ? `
                        bg-blue-500/25
                        text-white
                        shadow-[inset_0_0_0_1px_rgba(147,197,253,0.20)]
                      `
                      : `
                        text-white/95
                        hover:bg-white/10
                        hover:text-white
                      `
                  }
                `}
              >
                Estoque

                <ChevronDown
                  className={`
                    h-3.5 w-3.5
                    text-white/90
                    transition-transform
                    duration-200
                    ${stockOpen ? 'rotate-180' : ''}
                  `}
                  aria-hidden="true"
                />
              </button>

              {stockOpen && (
                <div
                  id="stock-navigation"
                  className="motion-dropdown
                    absolute
                    left-0
                    top-full
                    mt-2
                    w-56
                    overflow-hidden
                    rounded-[20px]
                    border
                    border-slate-300/25
                    bg-slate-700/65
                    dark:border-slate-500/20
                    dark:bg-slate-950/80
                    p-2
                    shadow-[0_16px_35px_rgba(15,23,42,0.30)]
                    backdrop-blur-xl
                  "
                >
                  {visibleItems
                    .filter(item => stockPages.includes(item.id))
                    .map(item => navButton(item, true))}
                </div>
              )}
            </div>

            {/* OUTROS ITENS */}
            {visibleItems
              .filter(
                item =>
                  item.id !== 'dashboard' &&
                  !stockPages.includes(item.id) &&
                  !reportPages.includes(item.id) &&
                  (item.id === 'clients' || item.id === 'services' || item.id === 'cash')
              )
              .map(item => navButton(item))}

            {/* RELATÓRIOS */}
            <div className="relative">
              <button
                ref={reportsButtonRef}
                type="button"
                aria-expanded={reportsOpen}
                aria-controls="reports-navigation"
                onClick={() => {
                  setReportsOpen(open => !open);
                  setStockOpen(false);
                }}
                className={`
                  ${focusStyle}
                  flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-[14px]
                  font-semibold tracking-[0.005em] transition-all duration-200
                  ${reportPages.includes(current)
                    ? 'bg-blue-500/25 text-white shadow-[inset_0_0_0_1px_rgba(147,197,253,0.20)]'
                    : 'text-white/95 hover:bg-white/10 hover:text-white'}
                `}
              >
                Relatórios
                <ChevronDown className={`h-3.5 w-3.5 text-white/90 transition-transform duration-200 ${reportsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {reportsOpen && (
                <div
                  id="reports-navigation"
                  className="motion-dropdown absolute left-0 top-full mt-2 w-56 overflow-hidden rounded-[20px] border border-slate-300/25 bg-slate-700/65 dark:border-slate-500/20 dark:bg-slate-950/80 p-2 shadow-[0_16px_35px_rgba(15,23,42,0.30)] backdrop-blur-xl"
                >
                  {reportOptions.map(item => navButton(item, true))}
                </div>
              )}
            </div>
            {visibleItems
              .filter(item => item.id === 'users')
              .map(item => navButton(item))}
          </nav>

          {/* =====================================================
              USUÁRIO
          ====================================================== */}
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-2.5">
            <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'} title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'} className={`${focusStyle} rounded-lg border border-slate-400/50 bg-white/[0.06] p-2 text-blue-100 transition hover:bg-white/15 hover:text-white`}>
              {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
            </button>
            <div className="hidden min-w-0 items-center gap-2.5 sm:flex">
              <span
                className="
                  flex
                  h-9
                  w-9
                  shrink-0
                  items-center
                  justify-center
                  rounded-full
                  border
                  border-blue-300/80
                  bg-blue-500/25
                  text-xs
                  font-bold
                  text-white
                  shadow-[0_0_0_1px_rgba(96,165,250,0.10)]
                "
                aria-hidden="true"
              >
                {initials}
              </span>

              <div className="min-w-0">
                <p
                  title={name}
                  className="max-w-[120px] truncate text-[13px] font-semibold text-white"
                >
                  {name}
                </p>

                <p className="text-[11px] font-medium text-white/80">
                  {isAdmin ? 'Administrador' : 'Usuário'}
                </p>
              </div>
            </div>

            {/* =================================================
                SAIR
            ================================================== */}
            <button
              type="button"
              onClick={() => void logout()}
              disabled={leaving}
              className={`
                ${focusStyle}
                hidden
                items-center
                justify-center
                gap-2
                rounded-lg
                border
                border-blue-300/50
                bg-blue-500
                px-3.5
                py-2
                text-[13px]
                font-semibold
                text-white
                shadow-sm
                transition
                hover:bg-blue-600
                disabled:opacity-60
                sm:flex
              `}
            >
              {leaving ? 'Saindo…' : 'Sair'}

              {leaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="h-3.5 w-3.5" />
              )}
            </button>

            {/* =================================================
                MOBILE
            ================================================== */}
            <button
              ref={mobileButtonRef}
              type="button"
              aria-label={
                mobileOpen
                  ? 'Fechar menu'
                  : 'Abrir menu'
              }
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation"
              onClick={() => {
                setMobileOpen(open => !open);
                setStockOpen(false);
                setReportsOpen(false);
              }}
              className={`
                ${focusStyle}
                rounded-lg
                border
                border-slate-400/50
                bg-white/[0.06]
                p-2
                text-blue-200
                transition
                hover:bg-white/10
                xl:hidden
              `}
            >
              {mobileOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

        {/* =====================================================
            MENU MOBILE
        ====================================================== */}
        {mobileOpen && (
          <div
            id="mobile-navigation"
            className="motion-menu
              border-t
              border-slate-300/20
              bg-slate-700/45
              dark:border-slate-500/20
              dark:bg-slate-950/70
              p-3
              backdrop-blur-xl
              xl:hidden
            "
          >
            <nav
              aria-label="Menu para telas menores"
              className="grid gap-1 sm:grid-cols-2"
            >
              {visibleItems.filter(item => !reportPages.includes(item.id)).map(item => navButton(item, true))}
              <div className="sm:col-span-2">
                <button
                  ref={mobileReportsButtonRef}
                  type="button"
                  aria-expanded={reportsOpen}
                  aria-controls="mobile-reports-navigation"
                  onClick={() => {
                    setReportsOpen(open => !open);
                    setStockOpen(false);
                  }}
                  className={`
                    ${focusStyle} group flex w-full items-center gap-1.5 rounded-xl px-3 py-2.5
                    text-left text-[14px] font-semibold tracking-[0.005em] transition-all duration-200
                    ${reportPages.includes(current)
                      ? 'bg-blue-500/25 text-white shadow-[inset_0_0_0_1px_rgba(147,197,253,0.20)]'
                      : 'text-white/95 hover:bg-white/10 hover:text-white'}
                  `}
                >
                  <FileBarChart className="h-4 w-4 shrink-0 text-white/85" aria-hidden="true" />
                  <span className="flex-1">Relatórios</span>
                  <ChevronDown className={`h-3.5 w-3.5 text-white/90 transition-transform duration-200 ${reportsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                {reportsOpen && (
                  <div id="mobile-reports-navigation" className="motion-dropdown mt-1 ml-3 overflow-hidden rounded-[20px] border border-slate-300/25 bg-slate-700/65 dark:border-slate-500/20 dark:bg-slate-950/80 p-2 shadow-[0_16px_35px_rgba(15,23,42,0.30)] backdrop-blur-xl">
                    {reportOptions.map(item => navButton(item, true))}
                  </div>
                )}
              </div>
            </nav>

            <div
              className="
                mt-3
                flex
                items-center
                gap-3
                border-t
                border-slate-300/20
                px-3
                pt-4
                sm:hidden
              "
            >
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-white">
                  {name}
                </p>

                <p className="text-xs font-medium text-white/80">
                  {isAdmin
                    ? 'Administrador'
                    : 'Usuário'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => void logout()}
                disabled={leaving}
                className={`
                  ${focusStyle}
                  flex
                  shrink-0
                  items-center
                  gap-2
                  rounded-lg
                  bg-blue-500
                  px-4
                  py-2
                  text-sm
                  font-semibold
                  text-white
                  transition
                  hover:bg-blue-600
                  disabled:opacity-60
                `}
              >
                {leaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )}

                {leaving ? 'Saindo…' : 'Sair'}
              </button>
            </div>
          </div>
        )}

        {/* =====================================================
            ERRO
        ====================================================== */}
        {error && (
          <p
            role="alert"
            className="
              border-t
              border-red-300/20
              px-5
              py-2.5
              text-sm
              text-red-200
            "
          >
            {error}
          </p>
        )}
      </header>

      {/* =========================================================
          CONTEÚDO DA PÁGINA
      ========================================================= */}
      <main
        className="
          mx-auto
          min-w-0
          max-w-[1600px]
          px-4
          pb-8
          pt-24
          sm:px-6
          sm:pt-28
          lg:px-8
        "
      >
        <div key={current} className="page-enter">
          {children}
        </div>
      </main>
    </div>
  );
}

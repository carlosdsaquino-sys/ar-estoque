const routeByPage: Record<string, string> = {
  products: '/estoque/produtos',
  movements: '/estoque/movimentacoes',
  'service-types': '/estoque/tipos-de-servico',
  import: '/estoque/importar',
  reports: '/relatorios',
  'report-movements': '/relatorios/movimentacoes',
  'profit-report': '/relatorios/lucros',
  'maintenance-alerts': '/avisos',
};

const pageByRoute = Object.fromEntries(
  Object.entries(routeByPage).map(([page, route]) => [route, page]),
);
const knownPages = new Set([
  'dashboard', 'products', 'movements', 'service-types', 'clients', 'services', 'cash',
  'reports', 'report-movements', 'profit-report', 'import', 'users',
  'maintenance-alerts',
]);

export function routeForPage(page: string): string | null {
  return routeByPage[page] ?? null;
}

export function pageForLocation(pathname: string, historyState: unknown): string {
  const routePage = pageByRoute[pathname];
  if (routePage) return routePage;

  if (pathname === '/' && historyState && typeof historyState === 'object' && 'arEstoquePage' in historyState) {
    const page = (historyState as { arEstoquePage?: unknown }).arEstoquePage;
    if (typeof page === 'string' && knownPages.has(page)) {
      return page;
    }
  }

  return 'dashboard';
}

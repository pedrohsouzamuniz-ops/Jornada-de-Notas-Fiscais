import React, { useState } from 'react';
import {
  AlertTriangle,
  Building2,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageCheck,
  ShieldCheck,
  ShoppingCart,
  X,
} from 'lucide-react';
import { AdminModule } from './components/AdminModule';
import { ComprasModule } from './components/ComprasModule';
import { DashboardModule } from './components/DashboardModule';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FiscalModule } from './components/FiscalModule';
import { LoginView, PendingAccessView } from './components/LoginView';
import { RecebimentoModule } from './components/RecebimentoModule';
import { P2PProvider, useP2P } from './context/P2PContext';
import { NavModule, ROLE_LABELS } from './types/p2p';

const DASHBOARD_ENABLED = false;

const NAV_ITEMS: Array<{
  id: NavModule;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}> = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    subtitle: 'Visão Geral P2P',
    icon: LayoutDashboard,
  },
  {
    id: 'compras',
    label: 'Compras',
    subtitle: 'Pedidos de Compra',
    icon: ShoppingCart,
  },
  {
    id: 'recebimento',
    label: 'Recebimento',
    subtitle: 'Conferência Física',
    icon: PackageCheck,
  },
  {
    id: 'fiscal',
    label: 'Fiscal',
    subtitle: 'XML & Escrituração',
    icon: FileSpreadsheet,
  },
  {
    id: 'administracao',
    label: 'Administração',
    subtitle: 'Usuários e RBAC',
    icon: ShieldCheck,
    adminOnly: true,
  },
];

function WorkspaceShell() {
  const { authReady, firebaseUser, userProfile, isAdmin, logout, dataError } = useP2P();
  const [activeModule, setActiveModule] = useState<NavModule>(
  DASHBOARD_ENABLED ? 'dashboard' : 'fiscal'
);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center mx-auto">
            <Building2 className="w-5 h-5" />
          </div>
          <p className="text-sm font-medium text-slate-700">
            Carregando Controle Fiscal P2P...
          </p>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !userProfile) {
    return <LoginView />;
  }

  if (userProfile.status !== 'ativo' || userProfile.role === 'pendente') {
    return <PendingAccessView />;
  }

 const visibleNavItems = NAV_ITEMS.filter(
  (item) =>
    (DASHBOARD_ENABLED || item.id !== 'dashboard') &&
    (!item.adminOnly || isAdmin)
);
  const currentMeta = NAV_ITEMS.find((i) => i.id === activeModule) || NAV_ITEMS[0];

  const handleSelectNav = (id: NavModule) => {
    setActiveModule(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex print:block print:bg-white">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 print:hidden">
        <div className="h-16 px-5 border-b border-slate-200 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4" />
          </div>
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Controle Fiscal P2P
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeModule === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNav(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium leading-tight whitespace-nowrap">
                    {item.label}
                  </div>
                  <div
                    className={`text-[11px] leading-tight mt-0.5 truncate ${
                      active ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    {item.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* User profile footer */}
        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 truncate">
              {userProfile.name}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              {ROLE_LABELS[userProfile.role]} · {userProfile.email}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Encerrar Sessão
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-white border-r border-slate-200 flex flex-col z-10">
            <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
                  <Building2 className="w-4 h-4" />
                </div>
                <span className="font-display text-base font-bold text-slate-900">
                  Controle Fiscal P2P
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectNav(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200">
              <div className="text-xs font-semibold text-slate-900 truncate">
                {userProfile.name}
              </div>
              <div className="text-[11px] text-slate-500 mb-3 truncate">
                {ROLE_LABELS[userProfile.role]}
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg"
              >
                <LogOut className="w-3.5 h-3.5" />
                Encerrar Sessão
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 lg:pl-64 print:pl-0 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-30 print:hidden">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200"
              aria-label="Abrir menu lateral"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 whitespace-nowrap truncate">
              <span className="font-medium text-slate-700">Controle Fiscal P2P</span>
              <span aria-hidden="true">/</span>
              <span className="font-medium text-slate-900">{currentMeta.label}</span>
            </div>
          </div>

          <div className="text-xs text-slate-600 whitespace-nowrap shrink-0">
            Setor: <span className="font-semibold text-slate-900">{ROLE_LABELS[userProfile.role]}</span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 print:p-0 max-w-[1440px] print:max-w-none w-full mx-auto space-y-6 print:space-y-0">
          {dataError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-xs text-red-800 print:hidden">
              <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Falha na sincronização com o banco de dados</p>
                <p className="mt-0.5 font-mono">{dataError}</p>
              </div>
            </div>
          )}
          {DASHBOARD_ENABLED && activeModule === 'dashboard' && <DashboardModule onNavigate={handleSelectNav} />}
          {activeModule === 'compras' && <ComprasModule />}
          {activeModule === 'recebimento' && <RecebimentoModule />}
          {activeModule === 'fiscal' && <FiscalModule />}
          {activeModule === 'administracao' && <AdminModule />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <P2PProvider>
        <WorkspaceShell />
      </P2PProvider>
    </ErrorBoundary>
  );
}

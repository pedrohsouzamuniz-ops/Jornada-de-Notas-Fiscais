import React from 'react';
import {
  Building2,
  Clock,
  FileSpreadsheet,
  Lock,
  LogOut,
  PackageCheck,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react';
import { useP2P } from '../context/P2PContext';

export function LoginView() {
  const { signInWithGoogle, signingIn, authError } = useP2P();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
              Controle Fiscal P2P
            </span>
          </div>
          <span className="text-xs text-slate-500 whitespace-nowrap">
            ERP Corporativo · Procure-to-Pay
          </span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-8 flex flex-col justify-between">
            <div>
              <p className="text-xs font-medium text-blue-700 mb-3">
                Plataforma Integrada de Governança Fiscal
              </p>
              <h1 className="font-display text-3xl font-bold text-slate-900 tracking-tight leading-tight mb-4 [text-wrap:balance]">
                Centralize compras, recebimento físico e escrituração fiscal com rastreabilidade total.
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed mb-8">
                O Controle Fiscal P2P assegura segregação rigorosa de funções entre setores, conciliação automática entre Pedido de Compra, Recebimento Físico e XML da NF-e, e governança centralizada pelo ADM Titular.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6 border-t border-slate-200">
                <div>
                  <div className="flex items-center gap-2 text-slate-900 font-medium text-sm mb-1">
                    <ShoppingCart className="w-4 h-4 text-blue-700 shrink-0" />
                    <span>Compras</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Emissão e controle de pedidos por fornecedor e centro de custo.
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-slate-900 font-medium text-sm mb-1">
                    <PackageCheck className="w-4 h-4 text-blue-700 shrink-0" />
                    <span>Recebimento</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Conferência física quantitativa vinculada ao pedido de compra.
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-slate-900 font-medium text-sm mb-1">
                    <FileSpreadsheet className="w-4 h-4 text-blue-700 shrink-0" />
                    <span>Fiscal</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Importação de XML SEFAZ, apuração de tributos e escrituração.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-4 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="w-4 h-4 text-slate-700 shrink-0" />
              <span>
                O primeiro usuário autenticado assume automaticamente o perfil de ADM Titular.
              </span>
            </div>
          </div>

          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-8 flex flex-col justify-center">
            <div className="mb-6">
              <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-900 mb-4">
                <Lock className="w-5 h-5" />
              </div>
              <h2 className="font-display text-xl font-semibold text-slate-900 mb-2">
                Acesso Corporativo
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Entre com sua conta Google corporativa para acessar os módulos autorizados para o seu setor.
              </p>
            </div>

            {authError && (
              <div className="mb-5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 leading-relaxed">
                {authError}
              </div>
            )}

            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={signingIn}
              className="w-full inline-flex items-center justify-center gap-3 px-5 py-3 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81Z"
                />
              </svg>
              <span>{signingIn ? 'Autenticando...' : 'Entrar com Google'}</span>
            </button>

            <div className="mt-6 pt-5 border-t border-slate-100 space-y-2 text-xs text-slate-500">
              <p>Controle de Acesso Baseado em Perfis (RBAC):</p>
              <p className="text-slate-600">
                ADM Titular · Compras · Recebimento · Fiscal
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="py-4 px-6 text-center text-xs text-slate-500 border-t border-slate-200 bg-white">
        Controle Fiscal P2P · Governança de Compras, Recebimento e Escrituração Fiscal
      </footer>
    </div>
  );
}

export function PendingAccessView() {
  const { userProfile, logout } = useP2P();
  const isInactive = userProfile?.status === 'inativo';

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display text-lg font-semibold text-slate-900">
              {isInactive ? 'Acesso Suspenso pelo Administrador' : 'Cadastro Aguardando Liberação'}
            </h1>
            <p className="text-xs text-slate-500">{userProfile?.email}</p>
          </div>
        </div>

        <p className="text-sm text-slate-600 leading-relaxed mb-6">
          {isInactive
            ? 'Sua conta está marcada como inativa no Controle Fiscal P2P. Solicite a reativação ao ADM Titular da sua organização.'
            : 'Seu login foi registrado com sucesso, porém um setor ainda precisa ser atribuído ao seu perfil pelo ADM Titular no módulo de Administração.'}
        </p>

        <div className="flex items-center justify-between pt-4 border-t border-slate-200">
          <span className="text-xs text-slate-500">
            Perfil atual: {isInactive ? 'Inativo' : 'Aguardando Aprovação'}
          </span>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sair da Conta
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, KeyRound, ShieldCheck, X } from 'lucide-react';

interface DeleteAuthModalProps {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  isAdmin: boolean;
  deletionPasswordConfigured: boolean;
  loading: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (supervisorPassword?: string) => Promise<void> | void;
}

export function DeleteAuthModal({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirmar Exclusão',
  isAdmin,
  deletionPasswordConfigured,
  loading,
  error,
  onCancel,
  onConfirm,
}: DeleteAuthModalProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setShowPassword(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const canSubmit =
    !loading &&
    (isAdmin || (deletionPasswordConfigured && password.trim().length > 0));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await onConfirm(isAdmin ? undefined : password.trim());
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <h3 className="font-display text-base font-semibold text-slate-900">
            {title}
          </h3>
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="text-sm text-slate-600 leading-relaxed">{description}</div>

          {isAdmin ? (
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-start gap-2.5 text-xs text-slate-700">
              <ShieldCheck className="w-4 h-4 text-slate-800 shrink-0 mt-0.5" />
              <span>
                <span className="font-semibold text-slate-900">ADM Titular (Master):</span>{' '}
                exclusão autorizada diretamente sem exigência de senha.
              </span>
            </div>
          ) : !deletionPasswordConfigured ? (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>
                Nenhuma senha de Supervisor / Analista foi definida ainda. Solicite ao{' '}
                <span className="font-semibold">ADM Titular</span> que cadastre a senha em{' '}
                <span className="font-semibold">Administração &gt; Segurança &amp; Exclusões</span>.
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <KeyRound className="w-3.5 h-3.5 text-slate-600" />
                Senha de Autorização (Supervisor / Analista)
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoFocus
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Informe a senha de Supervisor / Analista"
                  className="w-full pl-3 pr-10 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  tabIndex={-1}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Toda exclusão operacional requer validação de um Supervisor ou Analista autorizado.
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={loading}
              onClick={onCancel}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-2 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? 'Excluindo...' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

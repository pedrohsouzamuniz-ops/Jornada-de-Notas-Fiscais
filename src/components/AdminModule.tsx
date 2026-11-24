import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Shield,
  ShieldCheck,
  Sliders,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useP2P } from '../context/P2PContext';
import {
  BLUEPRINT_LIMITS,
  ROLE_LABELS,
  SectorKey,
  UserRole,
  UserStatus,
} from '../types/p2p';
import { StatusTag } from './StatusBadge';

const SECTOR_METADATA: Record<
  SectorKey,
  { title: string; subtitle: string; collectionLabel: string }
> = {
  compras: {
    title: 'Setor de Compras',
    subtitle: 'Responsável pela emissão e manutenção de Pedidos de Compra.',
    collectionLabel: 'Módulo exclusivo: Pedidos de Compra',
  },
  recebimento: {
    title: 'Setor de Recebimento',
    subtitle: 'Responsável pela conferência física na doca vinculada ao pedido.',
    collectionLabel: 'Módulo exclusivo: Recebimento Físico',
  },
  fiscal: {
    title: 'Setor Fiscal',
    subtitle: 'Responsável pela importação de XML SEFAZ, conciliação e escrituração.',
    collectionLabel: 'Módulo exclusivo: Fiscal e Importação de XML',
  },
};

export function AdminModule() {
  const {
    isAdmin,
    userProfile,
    allUsers,
    userInvites,
    sectorPermissions,
    deletionPolicy,
    deletionPasswordConfigured,
    deletionLogs,
    updateUserAccess,
    createUserInvite,
    deleteUserInvite,
    updateSectorPermission,
    setSupervisorDeletionPassword,
  } = useP2P();

  const [tab, setTab] = useState<'usuarios' | 'permissoes' | 'seguranca'>('usuarios');

  // Invite form
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<UserRole, 'pendente'>>('compras');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Supervisor deletion password form
  const [newSupervisorPassword, setNewSupervisorPassword] = useState('');
  const [confirmSupervisorPassword, setConfirmSupervisorPassword] = useState('');
  const [showSupervisorPassword, setShowSupervisorPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  if (!isAdmin) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <Lock className="w-8 h-8 text-slate-400 mx-auto mb-3" />
        <h2 className="font-display text-lg font-semibold text-slate-900 mb-1">
          Módulo Exclusivo do ADM Titular
        </h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          A gestão de usuários, definição de perfis e matriz de permissões por setor é restrita ao perfil ADM Titular.
        </p>
      </div>
    );
  }

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    if (!inviteName.trim() || !inviteEmail.includes('@')) {
      setInviteError('Informe nome completo e e-mail corporativo válido.');
      return;
    }
    setSaving(true);
    try {
      await createUserInvite(inviteName.trim(), inviteEmail.trim(), inviteRole);
      setInviteName('');
      setInviteEmail('');
      setInviteRole('compras');
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Erro ao pré-cadastrar usuário.');
    } finally {
      setSaving(false);
    }
  };

  const togglePermission = async (
    sector: SectorKey,
    field: 'canCreate' | 'canEdit' | 'canDelete' | 'canViewOtherSectors'
  ) => {
    const current = sectorPermissions[sector];
    await updateSectorPermission(sector, {
      canCreate: field === 'canCreate' ? !current.canCreate : current.canCreate,
      canEdit: field === 'canEdit' ? !current.canEdit : current.canEdit,
      canDelete: field === 'canDelete' ? !current.canDelete : current.canDelete,
      canViewOtherSectors:
        field === 'canViewOtherSectors'
          ? !current.canViewOtherSectors
          : current.canViewOtherSectors,
    });
  };

  const handleSaveSupervisorPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    const trimmed = newSupervisorPassword.trim();
    if (trimmed.length < 4) {
      setPasswordError('A senha de Supervisor / Analista deve possuir pelo menos 4 caracteres.');
      return;
    }
    if (trimmed !== confirmSupervisorPassword.trim()) {
      setPasswordError('A confirmação de senha não confere com a nova senha informada.');
      return;
    }

    setSavingPassword(true);
    try {
      await setSupervisorDeletionPassword(trimmed);
      setNewSupervisorPassword('');
      setConfirmSupervisorPassword('');
      setShowSupervisorPassword(false);
      setPasswordSuccess(
        'Senha de autorização para exclusões atualizada com sucesso. Todos os setores passarão a utilizá-la imediatamente.'
      );
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : 'Erro ao salvar senha de Supervisor / Analista.'
      );
    } finally {
      setSavingPassword(false);
    }
  };

  const formatLogTimestamp = (ts: unknown): string => {
    if (ts && typeof ts === 'object' && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
      return (ts as { toDate: () => Date }).toDate().toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return 'Agora';
  };

  const COLLECTION_MODULE_LABELS: Record<
    'purchase_orders' | 'physical_receipts' | 'fiscal_invoices',
    string
  > = {
    purchase_orders: 'Compras',
    physical_receipts: 'Recebimento',
    fiscal_invoices: 'Fiscal',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Administração & Governança RBAC
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Gestão de usuários, pré-cadastro por setor, matriz de permissões e senha de exclusão
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setTab('usuarios')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'usuarios'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Gestão de Usuários ({allUsers.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('permissoes')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'permissoes'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Permissões por Setor
          </button>
          <button
            type="button"
            onClick={() => setTab('seguranca')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'seguranca'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            Segurança &amp; Exclusões
            {!deletionPasswordConfigured && (
              <span className="inline-block w-2 h-2 rounded-xs bg-amber-500" title="Senha pendente de configuração" />
            )}
          </button>
        </div>
      </div>

      {tab === 'usuarios' ? (
        <div className="space-y-6">
          {/* Active & pending users table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Usuários Autenticados no Sistema
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Atribua setores, aprove novos acessos pendentes ou altere o status de cada colaborador
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4">Colaborador</th>
                    <th className="py-3 px-4">E-mail Corporativo</th>
                    <th className="py-3 px-4">Perfil / Setor RBAC</th>
                    <th className="py-3 px-4">Status da Conta</th>
                    <th className="py-3 px-4">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {allUsers.map((usr) => {
                    const isSelf = usr.uid === userProfile?.uid;
                    return (
                      <tr key={usr.uid} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4">
                          <div className="text-xs font-semibold text-slate-900">
                            {usr.name} {isSelf ? '(Você)' : ''}
                          </div>
                          <div className="text-[11px] text-slate-500">{usr.sector}</div>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-600">
                          {usr.email}
                        </td>
                        <td className="py-3 px-4">
                          <select
                            value={usr.role}
                            disabled={isSelf}
                            onChange={(e) => {
                              const nextRole = e.target.value as UserRole;
                              const nextStatus: UserStatus =
                                nextRole === 'pendente' ? 'pendente' : 'ativo';
                              void updateUserAccess(usr.uid, nextRole, nextStatus);
                            }}
                            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                          >
                            <option value="adm_titular">ADM Titular</option>
                            <option value="compras">Compras</option>
                            <option value="recebimento">Recebimento</option>
                            <option value="fiscal">Fiscal</option>
                            <option value="pendente">Pendente</option>
                          </select>
                        </td>
                        <td className="py-3 px-4">
                          <select
                            value={usr.status}
                            disabled={isSelf}
                            onChange={(e) =>
                              void updateUserAccess(
                                usr.uid,
                                usr.role,
                                e.target.value as UserStatus
                              )
                            }
                            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                          >
                            <option value="ativo">Ativo</option>
                            <option value="pendente">Pendente</option>
                            <option value="inativo">Inativo</option>
                          </select>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {usr.status === 'ativo' && (
                            <StatusTag label={ROLE_LABELS[usr.role]} tone="success" />
                          )}
                          {usr.status === 'pendente' && (
                            <StatusTag label="Aguardando Aprovação" tone="warning" />
                          )}
                          {usr.status === 'inativo' && (
                            <StatusTag label="Inativo" tone="danger" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pre-registration / Invites */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-1">
                <UserPlus className="w-4 h-4 text-slate-700" />
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Pré-Cadastrar Colaborador
                </h3>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Defina o setor antes do primeiro acesso. Ao entrar com a conta Google informada, o colaborador receberá o perfil automaticamente.
              </p>

              <form onSubmit={handleCreateInvite} className="space-y-3.5">
                {inviteError && (
                  <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                    {inviteError}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nome do Colaborador
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={BLUEPRINT_LIMITS.MAX_USER_NAME}
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Ex: Maria Clara Oliveira"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    E-mail Google Corporativo
                  </label>
                  <input
                    type="email"
                    required
                    maxLength={BLUEPRINT_LIMITS.MAX_EMAIL}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colaborador@empresa.com.br"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Setor / Perfil RBAC
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) =>
                      setInviteRole(e.target.value as Exclude<UserRole, 'pendente'>)
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="compras">Compras (Pedidos de Compra)</option>
                    <option value="recebimento">Recebimento (Conferência Física)</option>
                    <option value="fiscal">Fiscal (Importação XML e Notas)</option>
                    <option value="adm_titular">ADM Titular (Acesso Irrestrito)</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                >
                  {saving ? 'Salvando...' : 'Autorizar E-mail no Setor'}
                </button>
              </form>
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Pré-Cadastros Ativos ({userInvites.length})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Lista de e-mails pré-autorizados para ingresso direto nos setores
                </p>
              </div>
              {userInvites.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Nenhum pré-cadastro pendente de uso.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {userInvites.map((inv) => (
                    <div
                      key={inv.id}
                      className="px-6 py-3.5 flex items-center justify-between gap-4"
                    >
                      <div>
                        <div className="text-xs font-semibold text-slate-900">
                          {inv.name} · <span className="font-normal text-slate-600">{ROLE_LABELS[inv.role]}</span>
                        </div>
                        <div className="font-mono text-xs text-slate-500">{inv.email}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void deleteUserInvite(inv.id)}
                        title="Remover pré-cadastro"
                        className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : tab === 'permissoes' ? (
        /* Permissions Matrix Tab */
        <div className="space-y-4">
          <div className="bg-slate-100 border border-slate-200 rounded-lg px-4 py-3 flex items-center gap-2.5 text-xs text-slate-700">
            <Shield className="w-4 h-4 text-slate-700 shrink-0" />
            <span>
              Regra inviolável de segregação: nenhum setor pode criar, editar ou excluir registros de outro setor. Apenas o ADM Titular possui acesso irrestrito para editar, desvincular ou excluir qualquer registro.
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {(['compras', 'recebimento', 'fiscal'] as SectorKey[]).map((sec) => {
              const meta = SECTOR_METADATA[sec];
              const perm = sectorPermissions[sec];
              return (
                <div
                  key={sec}
                  className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-5"
                >
                  <div>
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      {meta.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      {meta.subtitle}
                    </p>
                    <p className="text-xs font-medium text-blue-700 mt-2">
                      {meta.collectionLabel}
                    </p>
                  </div>

                  <div className="space-y-3 pt-4 border-t border-slate-100">
                    {(
                      [
                        {
                          key: 'canCreate',
                          label: 'Criar registros no próprio setor',
                        },
                        {
                          key: 'canEdit',
                          label: 'Editar registros no próprio setor',
                        },
                        {
                          key: 'canDelete',
                          label: 'Excluir registros no próprio setor',
                        },
                        {
                          key: 'canViewOtherSectors',
                          label: 'Visualizar outros setores (somente leitura)',
                        },
                      ] as const
                    ).map((item) => {
                      const active = perm[item.key];
                      return (
                        <label
                          key={item.key}
                          className="flex items-center justify-between gap-3 cursor-pointer"
                        >
                          <span className="text-xs text-slate-700">{item.label}</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={active}
                            onClick={() => void togglePermission(sec, item.key)}
                            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${
                              active ? 'bg-slate-900' : 'bg-slate-200'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${
                                active ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Deletion Password & Audit Log Tab */
        <div className="space-y-6">
          <div className="bg-slate-100 border border-slate-200 rounded-lg px-4 py-3 flex items-start gap-2.5 text-xs text-slate-700">
            <ShieldCheck className="w-4 h-4 text-slate-800 shrink-0 mt-0.5" />
            <span>
              Toda exclusão nos módulos <span className="font-semibold text-slate-900">Compras</span>,{' '}
              <span className="font-semibold text-slate-900">Recebimento</span> e{' '}
              <span className="font-semibold text-slate-900">Fiscal</span> exige a senha de Supervisor / Analista. O perfil{' '}
              <span className="font-semibold text-slate-900">ADM Titular (Master)</span> não precisa informar senha para realizar exclusões.
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900">
                    Senha de Supervisor / Analista
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Defina ou atualize a senha exigida para exclusão de registros pelos setores
                  </p>
                </div>
                {deletionPasswordConfigured ? (
                  <StatusTag label="Configurada" tone="success" />
                ) : (
                  <StatusTag label="Pendente" tone="warning" />
                )}
              </div>

              {!deletionPasswordConfigured ? (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <span>
                    Enquanto nenhuma senha for definida, usuários não-administradores ficarão impedidos de concluir exclusões em qualquer módulo.
                  </span>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
                  Última atualização por{' '}
                  <span className="font-semibold text-slate-900">
                    {deletionPolicy?.updatedByName || 'ADM Titular'}
                  </span>
                  {deletionPolicy?.updatedAt
                    ? ` em ${formatLogTimestamp(deletionPolicy.updatedAt)}`
                    : ''}
                  .
                </div>
              )}

              <form onSubmit={handleSaveSupervisorPassword} className="space-y-3.5">
                {passwordError && (
                  <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                    {passwordError}
                  </div>
                )}
                {passwordSuccess && (
                  <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-2 text-xs text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <span>{passwordSuccess}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {deletionPasswordConfigured
                      ? 'Nova Senha (Supervisor / Analista)'
                      : 'Definir Senha (Supervisor / Analista)'}
                  </label>
                  <div className="relative">
                    <input
                      type={showSupervisorPassword ? 'text' : 'password'}
                      required
                      minLength={4}
                      autoComplete="new-password"
                      value={newSupervisorPassword}
                      onChange={(e) => setNewSupervisorPassword(e.target.value)}
                      placeholder="Mínimo de 4 caracteres"
                      className="w-full pl-3 pr-10 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSupervisorPassword((prev) => !prev)}
                      tabIndex={-1}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showSupervisorPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Confirmar Senha
                  </label>
                  <input
                    type={showSupervisorPassword ? 'text' : 'password'}
                    required
                    minLength={4}
                    autoComplete="new-password"
                    value={confirmSupervisorPassword}
                    onChange={(e) => setConfirmSupervisorPassword(e.target.value)}
                    placeholder="Repita a senha informada acima"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingPassword}
                  className="w-full py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                >
                  {savingPassword
                    ? 'Salvando...'
                    : deletionPasswordConfigured
                    ? 'Atualizar Senha de Exclusão'
                    : 'Ativar Senha de Exclusão'}
                </button>
              </form>
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900">
                    Auditoria de Exclusões Autorizadas ({deletionLogs.length})
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Histórico imutável de exclusões executadas pelos setores mediante senha de Supervisor / Analista
                  </p>
                </div>
              </div>

              {deletionLogs.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Nenhuma exclusão autorizada via senha registrada até o momento.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                        <th className="py-3 px-4">Módulo</th>
                        <th className="py-3 px-4">Registro</th>
                        <th className="py-3 px-4">Responsável</th>
                        <th className="py-3 px-4 text-right">Data / Hora</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {deletionLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 whitespace-nowrap font-medium text-slate-800">
                            {COLLECTION_MODULE_LABELS[log.targetCollection] || log.targetCollection}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-900 whitespace-nowrap">
                            {log.targetLabel}
                          </td>
                          <td className="py-3 px-4 text-slate-700">{log.deletedByName}</td>
                          <td className="py-3 px-4 text-right font-mono text-slate-500 tabular-nums whitespace-nowrap">
                            {formatLogTimestamp(log.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

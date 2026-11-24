import React, { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  FileSpreadsheet,
  PackageCheck,
  ShoppingCart,
} from 'lucide-react';
import { useP2P } from '../context/P2PContext';
import { NavModule } from '../types/p2p';
import { formatBRL, formatDateBR } from '../utils/formatters';
import { getPoReceptionSummary } from '../utils/matching';
import { StatusTag } from './StatusBadge';

export function DashboardModule({
  onNavigate,
}: {
  onNavigate: (mod: NavModule) => void;
}) {
  const {
    purchaseOrders,
    physicalReceipts,
    fiscalInvoices,
    userProfile,
    canAccessSectorData,
    dataLoading,
  } = useP2P();

  const metrics = useMemo(() => {
    const openPos = purchaseOrders.filter(
      (p) => p.status === 'aberto' || p.status === 'parcialmente_atendido'
    );
    const openPosValue = openPos.reduce((s, p) => s + p.totalAmount, 0);

    const totalReceipts = physicalReceipts.length;
    const divergentReceipts = physicalReceipts.filter((r) => r.status === 'divergencia').length;

    const bookedInvoices = fiscalInvoices.filter(
      (f) => f.fiscalStatus === 'lancado' || f.fiscalStatus === 'escriturada'
    );
    const pendingInvoices = fiscalInvoices.filter(
      (f) =>
        f.fiscalStatus === 'aguardando_recebimento' ||
        f.fiscalStatus === 'pendente' ||
        f.fiscalStatus === 'aguardando_escrituracao'
    );
    const totalFiscalValue = fiscalInvoices.reduce((s, f) => s + f.totalInvoice, 0);
    const divergentInvoices = fiscalInvoices.filter((f) => f.matchingStatus === 'divergente');

    return {
      openPosCount: openPos.length,
      openPosValue,
      totalReceipts,
      divergentReceipts,
      bookedCount: bookedInvoices.length,
      pendingInvoicesCount: pendingInvoices.length,
      totalFiscalValue,
      divergentTotal: divergentReceipts + divergentInvoices.length,
    };
  }, [purchaseOrders, physicalReceipts, fiscalInvoices]);

  const traceabilityRows = useMemo(() => {
    return purchaseOrders.slice(0, 12).map((po) => {
      const reception = getPoReceptionSummary(po, physicalReceipts);
      const linkedInvoices = fiscalInvoices.filter((f) => f.purchaseOrderId === po.id);
      const latestInvoice = linkedInvoices[0];

      let p2pState: {
        label: string;
        tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
      } = { label: 'Aguardando Recebimento', tone: 'neutral' };

      if (po.status === 'cancelado') {
        p2pState = { label: 'Pedido Cancelado', tone: 'danger' };
      } else if (latestInvoice) {
        if (latestInvoice.matchingStatus === 'divergente' || reception.hasDivergence) {
          p2pState = { label: 'Divergência P2P', tone: 'warning' };
        } else if (
          latestInvoice.fiscalStatus === 'lancado' ||
          latestInvoice.fiscalStatus === 'escriturada'
        ) {
          p2pState = { label: 'Ciclo Lançado', tone: 'success' };
        } else if (latestInvoice.fiscalStatus === 'substituida') {
          p2pState = { label: 'Nota Substituída', tone: 'warning' };
        } else if (latestInvoice.fiscalStatus === 'pendente') {
          p2pState = { label: 'Pendente no Fiscal', tone: 'info' };
        } else if (latestInvoice.matchingStatus === 'conciliada') {
          p2pState = { label: 'Conciliada', tone: 'info' };
        } else {
          p2pState = { label: 'NF Vinculada', tone: 'info' };
        }
      } else if (reception.linkedReceipts.length > 0) {
        p2pState = reception.hasDivergence
          ? { label: 'Divergência no Recebimento', tone: 'warning' }
          : { label: 'Aguardando NF-e', tone: 'info' };
      }

      return {
        po,
        reception,
        latestInvoice,
        p2pState,
      };
    });
  }, [purchaseOrders, physicalReceipts, fiscalInvoices]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Painel Executivo P2P
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Visão consolidada do fluxo entre Compras, Recebimento Físico e Escrituração Fiscal · Perfil{' '}
            <span className="font-medium text-slate-900">{userProfile?.sector}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canAccessSectorData('compras') && (
            <button
              type="button"
              onClick={() => onNavigate('compras')}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              Compras
            </button>
          )}
          {canAccessSectorData('recebimento') && (
            <button
              type="button"
              onClick={() => onNavigate('recebimento')}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              <PackageCheck className="w-3.5 h-3.5" />
              Recebimento
            </button>
          )}
          {canAccessSectorData('fiscal') && (
            <button
              type="button"
              onClick={() => onNavigate('fiscal')}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Módulo Fiscal
            </button>
          )}
        </div>
      </div>

      {/* 4 KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 mb-2">
            <span>Pedidos em Aberto</span>
            <ShoppingCart className="w-4 h-4 text-slate-400" />
          </div>
          <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {dataLoading ? '—' : metrics.openPosCount}
          </div>
          <div className="text-xs text-slate-500 mt-2 tabular-nums">
            Volume comprometido: <span className="font-medium text-slate-700">{formatBRL(metrics.openPosValue)}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 mb-2">
            <span>Recebimentos Físicos</span>
            <PackageCheck className="w-4 h-4 text-slate-400" />
          </div>
          <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {dataLoading ? '—' : metrics.totalReceipts}
          </div>
          <div className="text-xs text-slate-500 mt-2 tabular-nums">
            {metrics.divergentReceipts > 0 ? (
              <span className="text-amber-700 font-medium">
                {metrics.divergentReceipts} com divergência física
              </span>
            ) : (
              'Todas as conferências sem avaria'
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 mb-2">
            <span>Notas Fiscais (NF-e)</span>
            <FileSpreadsheet className="w-4 h-4 text-slate-400" />
          </div>
          <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {dataLoading ? '—' : formatBRL(metrics.totalFiscalValue)}
          </div>
          <div className="text-xs text-slate-500 mt-2 tabular-nums">
            {metrics.bookedCount} escrituradas · {metrics.pendingInvoicesCount} aguardando
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 mb-2">
            <span>Alertas Three-Way Match</span>
            <AlertTriangle className="w-4 h-4 text-slate-400" />
          </div>
          <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {dataLoading ? '—' : metrics.divergentTotal}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            {metrics.divergentTotal > 0
              ? 'Requer revisão entre Pedido, Doca e XML'
              : 'Nenhuma divergência detectada'}
          </div>
        </div>
      </div>

      {/* End-to-End P2P Traceability Matrix */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Rastreabilidade Ponta a Ponta (Pedido → Recebimento → Escrituração)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Acompanhamento em tempo real do cruzamento fiscal entre setores
            </p>
          </div>
          {canAccessSectorData('compras') && (
            <button
              type="button"
              onClick={() => onNavigate('compras')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer whitespace-nowrap"
            >
              Ver todos os pedidos
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {!canAccessSectorData('compras') ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Visualização de pedidos de outros setores está restrita pela política configurada pelo ADM Titular.
          </div>
        ) : dataLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((row) => (
              <div key={row} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : traceabilityRows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900 mb-1">
              Nenhum ciclo P2P registrado até o momento
            </p>
            <p className="text-xs text-slate-500 mb-4">
              Inicie o fluxo criando um Pedido de Compra no módulo de Compras ou importando uma NF-e no módulo Fiscal.
            </p>
            {canAccessSectorData('compras') && (
              <button
                type="button"
                onClick={() => onNavigate('compras')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Ir para Compras
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Pedido</th>
                  <th className="py-3 px-4">Fornecedor</th>
                  <th className="py-3 px-4">Recebimento Físico</th>
                  <th className="py-3 px-4">Nota Fiscal (NF-e)</th>
                  <th className="py-3 px-4 text-right">Valor Pedido</th>
                  <th className="py-3 px-4">Status P2P</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {traceabilityRows.map(({ po, reception, latestInvoice, p2pState }) => (
                  <tr key={po.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {po.poNumber}
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums">
                        {formatDateBR(po.issueDate)}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs font-medium text-slate-900 max-w-[220px] truncate">
                        {po.supplierName}
                      </div>
                      <div className="font-mono text-xs text-slate-500 tabular-nums">
                        {po.supplierCnpj}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {reception.linkedReceipts.length > 0 ? (
                        <div>
                          <span className="font-mono text-xs font-medium text-slate-900 tabular-nums">
                            {reception.linkedReceipts[0].receiptNumber}
                          </span>
                          <div className="text-xs text-slate-500 tabular-nums">
                            {reception.totalReceived}/{reception.totalOrdered} un · {reception.label}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Não recebido</span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {latestInvoice ? (
                        <div>
                          <span className="font-mono text-xs font-medium text-slate-900 tabular-nums">
                            NF-e {latestInvoice.nfeNumber}
                          </span>
                          <div className="text-xs text-slate-500 tabular-nums">
                            {formatBRL(latestInvoice.totalInvoice)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Sem NF-e vinculada</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs font-medium text-slate-900 tabular-nums whitespace-nowrap">
                      {formatBRL(po.totalAmount)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <StatusTag label={p2pState.label} tone={p2pState.tone} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

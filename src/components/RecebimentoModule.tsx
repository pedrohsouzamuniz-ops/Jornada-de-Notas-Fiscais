import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Link2Off,
  Lock,
  PackageCheck,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useP2P } from '../context/P2PContext';
import {
  BLUEPRINT_LIMITS,
  PhysicalReceipt,
  PhysicalReceiptItem,
  PhysicalReceiptStatus,
  PurchaseOrder,
  ReceiptItemCondition,
} from '../types/p2p';
import {
  formatBRL,
  formatDateBR,
  normalizeCnpjDigits,
  todayISO,
} from '../utils/formatters';
import {
  evaluateThreeWayMatch,
  getPoReceptionSummary,
  shouldShowPoInReceivingList,
} from '../utils/matching';
import { DeleteAuthModal } from './DeleteAuthModal';
import { StatusTag } from './StatusBadge';

export function RecebimentoModule() {
  const {
    purchaseOrders,
    physicalReceipts,
    fiscalInvoices,
    productEquivalences,
    canAccessSectorData,
    canCreateInSector,
    canEditInSector,
    canDeleteInSector,
    isAdmin,
    deletionPasswordConfigured,
    createPhysicalReceipt,
    updatePhysicalReceipt,
    unlinkPhysicalReceiptFromPo,
    deletePhysicalReceipt,
    dataLoading,
  } = useP2P();

  const canRead = canAccessSectorData('recebimento');
  const canCreate = canCreateInSector('recebimento');
  const canEdit = canEditInSector('recebimento');
  const canDelete = canDeleteInSector('recebimento');

  // Step 1: Search PO by number or supplier
  const [poSearch, setPoSearch] = useState('');
  const [poStatusFilter, setPoStatusFilter] = useState<'ativos' | 'todos' | 'concluido'>('ativos');
  const [receiptSearch, setReceiptSearch] = useState('');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<PhysicalReceipt | null>(null);
  const [targetPo, setTargetPo] = useState<PurchaseOrder | null>(null);
  const [receiptNumber, setReceiptNumber] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [receiptDate, setReceiptDate] = useState(todayISO());
  const [warehouseLocation, setWarehouseLocation] = useState('Doca 01 - Almoxarifado Central');
  const [items, setItems] = useState<PhysicalReceiptItem[]>([]);
  const [observations, setObservations] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<PhysicalReceipt | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<PhysicalReceipt | null>(null);

  const filteredPos = useMemo(() => {
    const q = poSearch.trim().toLowerCase();
    return purchaseOrders.filter((po) => {
      if (!shouldShowPoInReceivingList(po, fiscalInvoices)) return false;
      if (poStatusFilter === 'ativos' && po.status === 'concluido') return false;
      if (poStatusFilter === 'concluido' && po.status !== 'concluido') return false;
      if (!q) return true;
      return (
        po.poNumber.toLowerCase().includes(q) ||
        po.supplierName.toLowerCase().includes(q) ||
        po.supplierCnpj.toLowerCase().includes(q)
      );
    });
  }, [purchaseOrders, fiscalInvoices, poSearch, poStatusFilter]);

  const filteredReceipts = useMemo(() => {
    const q = receiptSearch.trim().toLowerCase();
    return physicalReceipts.filter((r) => {
      if (!q) return true;
      return (
        r.receiptNumber.toLowerCase().includes(q) ||
        r.poNumber.toLowerCase().includes(q) ||
        r.supplierName.toLowerCase().includes(q) ||
        r.invoiceNumberRef.toLowerCase().includes(q)
      );
    });
  }, [physicalReceipts, receiptSearch]);

  // Helper: prior received quantity per item index/description on a PO (excluding currently edited receipt)
  const getPreviouslyReceivedMap = (poId: string, excludeReceiptId?: string) => {
    const map = new Map<string, number>();
    physicalReceipts
      .filter((r) => r.purchaseOrderId === poId && r.id !== excludeReceiptId)
      .forEach((r) => {
        r.items.forEach((it) => {
          const key = `${it.code}::${it.description}`;
          map.set(key, (map.get(key) || 0) + Number(it.qtyReceived || 0));
        });
      });
    return map;
  };

  // Available XMLs with status 'aguardando_recebimento' requiring physical receipt and matching PO's CNPJ
  const matchingAvailableInvoices = useMemo(() => {
    if (!targetPo) return [];
    const poCnpj = normalizeCnpjDigits(targetPo.supplierCnpj);
    return fiscalInvoices.filter(
      (inv) =>
        inv.fiscalStatus === 'aguardando_recebimento' &&
        (inv.requiresPhysicalReceipt ?? true) &&
        normalizeCnpjDigits(inv.issuerCnpj) === poCnpj
    );
  }, [targetPo, fiscalInvoices]);

  const openRegisterForPo = (po: PurchaseOrder) => {
    const nextSeq = String(physicalReceipts.length + 1).padStart(4, '0');
    setEditingReceipt(null);
    setTargetPo(po);
    setReceiptNumber(`REC-${new Date().getFullYear()}-${nextSeq}`);
    setSelectedInvoiceId('');
    setReceiptDate(todayISO());
    setWarehouseLocation('Doca 01 - Almoxarifado Central');
    setObservations('');
    setFormError(null);
    setItems(
      po.items.map((it) => ({
        code: it.code,
        description: it.description,
        unit: it.unit,
        qtyOrdered: it.qtyOrdered,
        qtyReceived: 0,
        condition: 'conforme',
      }))
    );
    setModalOpen(true);
  };

  const openEditModal = (rec: PhysicalReceipt) => {
    const po = purchaseOrders.find((p) => p.id === rec.purchaseOrderId) || null;
    setEditingReceipt(rec);
    setTargetPo(po);
    setReceiptNumber(rec.receiptNumber);
    setSelectedInvoiceId(rec.fiscalInvoiceId || '');
    setReceiptDate(rec.receiptDate);
    setWarehouseLocation(rec.warehouseLocation);
    setItems(rec.items.map((it) => ({ ...it })));
    setObservations(rec.observations);
    setFormError(null);
    setModalOpen(true);
  };

  const prevReceivedMap = useMemo(() => {
    if (!targetPo) return new Map<string, number>();
    return getPreviouslyReceivedMap(targetPo.id, editingReceipt?.id);
  }, [targetPo, editingReceipt, physicalReceipts]);

  const selectedInvoiceObj = useMemo(
    () => fiscalInvoices.find((inv) => inv.id === selectedInvoiceId) || null,
    [fiscalInvoices, selectedInvoiceId]
  );

  const isSelectedInvoicePartial = Boolean(selectedInvoiceObj?.isPartialBilling);

  const updateItemConference = (
    idx: number,
    field: 'qtyReceived' | 'condition',
    value: number | ReceiptItemCondition
  ) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, [field]: value };
        if (field === 'qtyReceived') {
          const prevQty = prevReceivedMap.get(`${it.code}::${it.description}`) || 0;
          const remainingBefore = Math.max(0, it.qtyOrdered - prevQty);
          const numVal = Math.max(0, Number(value));
          next.qtyReceived = numVal;
          if (isSelectedInvoicePartial) {
            next.condition = numVal > remainingBefore + 0.001 ? 'divergente' : 'conforme';
          } else {
            next.condition =
              Math.abs(numVal - remainingBefore) > 0.001 ? 'divergente' : 'conforme';
          }
        }
        return next;
      })
    );
  };

  // Compute cumulative PO balance & next PO status in real time
  const balanceEvaluation = useMemo(() => {
    let totalOrdered = 0;
    let totalCumulativeReceived = 0;
    let totalEnteredNow = 0;

    items.forEach((it) => {
      const prevQty = prevReceivedMap.get(`${it.code}::${it.description}`) || 0;
      totalOrdered += Number(it.qtyOrdered || 0);
      totalEnteredNow += Number(it.qtyReceived || 0);
      totalCumulativeReceived += prevQty + Number(it.qtyReceived || 0);
    });

    const totalRemaining = Math.max(0, Number((totalOrdered - totalCumulativeReceived).toFixed(4)));
    let nextPoStatus: 'aberto' | 'parcialmente_atendido' | 'concluido' = 'aberto';
    if (totalOrdered > 0 && totalCumulativeReceived >= totalOrdered - 0.001) {
      nextPoStatus = 'concluido';
    } else if (totalCumulativeReceived > 0) {
      nextPoStatus = 'parcialmente_atendido';
    }

    return {
      totalOrdered,
      totalCumulativeReceived,
      totalEnteredNow,
      totalRemaining,
      nextPoStatus,
    };
  }, [items, prevReceivedMap]);

  const derivedReceiptStatus: PhysicalReceiptStatus = useMemo(() => {
    const hasIssue = items.some((it) => {
      const prevQty = prevReceivedMap.get(`${it.code}::${it.description}`) || 0;
      const expectedNow = Math.max(0, it.qtyOrdered - prevQty);
      if (it.condition !== 'conforme') return true;
      if (isSelectedInvoicePartial) {
        return it.qtyReceived > expectedNow + 0.001;
      }
      return Math.abs(it.qtyReceived - expectedNow) > 0.001;
    });
    return hasIssue ? 'divergencia' : 'conferido';
  }, [items, prevReceivedMap, isSelectedInvoicePartial]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!editingReceipt) {
      if (!targetPo) {
        setFormError('Selecione um Pedido de Compra válido.');
        return;
      }
      if (!selectedInvoiceId) {
        setFormError(
          'Selecione uma nota fiscal importada (Aguardando Recebimento) para vincular a este recebimento.'
        );
        return;
      }
    }

    if (balanceEvaluation.totalEnteredNow <= 0) {
      setFormError('Informe a Quantidade Recebida maior que zero para ao menos um item.');
      return;
    }

    const selectedInvoice = fiscalInvoices.find((inv) => inv.id === selectedInvoiceId);

    setSaving(true);
    try {
      if (editingReceipt) {
        await updatePhysicalReceipt(
          editingReceipt.id,
          {
            receiptDate,
            warehouseLocation: warehouseLocation.trim(),
            items,
            status: derivedReceiptStatus,
            observations: observations.trim(),
          },
          {
            nextPoStatus: balanceEvaluation.nextPoStatus,
          }
        );
        setActionSuccess(`Recebimento ${editingReceipt.receiptNumber} atualizado com sucesso.`);
      } else if (targetPo && selectedInvoice) {
        const tempReceiptForMatch: PhysicalReceipt = {
          id: 'temp',
          receiptNumber: receiptNumber.trim(),
          purchaseOrderId: targetPo.id,
          poNumber: targetPo.poNumber,
          fiscalInvoiceId: selectedInvoice.id,
          supplierName: targetPo.supplierName,
          supplierCnpj: targetPo.supplierCnpj,
          receiptDate,
          invoiceNumberRef: selectedInvoice.nfeNumber,
          warehouseLocation: warehouseLocation.trim(),
          items,
          status: derivedReceiptStatus,
          observations: observations.trim(),
          receivedByUid: '',
          receivedByName: '',
        };
        const match = evaluateThreeWayMatch(
          selectedInvoice,
          targetPo,
          tempReceiptForMatch,
          {
            savedEquivalences: productEquivalences,
            otherLinkedInvoicesForPo: fiscalInvoices.filter(
              (f) => f.purchaseOrderId === targetPo.id && f.id !== selectedInvoice.id
            ),
          }
        );

        await createPhysicalReceipt(
          {
            receiptNumber: receiptNumber.trim(),
            purchaseOrderId: targetPo.id,
            poNumber: targetPo.poNumber,
            fiscalInvoiceId: selectedInvoice.id,
            supplierName: targetPo.supplierName,
            supplierCnpj: targetPo.supplierCnpj,
            receiptDate,
            invoiceNumberRef: selectedInvoice.nfeNumber,
            warehouseLocation: warehouseLocation.trim(),
            items,
            status: derivedReceiptStatus,
            observations: observations.trim(),
          },
          {
            nextPoStatus: balanceEvaluation.nextPoStatus,
            matchingStatus: match.status,
          }
        );
        setActionSuccess(
          `Recebimento ${receiptNumber.trim()} registrado e nota fiscal liberada como Pendente no módulo Fiscal.`
        );
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar recebimento físico.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (supervisorPassword?: string) => {
    if (!deleteTarget) return;
    setSaving(true);
    setDeleteError(null);
    try {
      const deletedNumber = deleteTarget.receiptNumber;
      const linkedInv = fiscalInvoices.find(
        (f) => f.receiptId === deleteTarget.id || f.id === deleteTarget.fiscalInvoiceId
      );
      await deletePhysicalReceipt(deleteTarget.id, supervisorPassword);
      setDeleteTarget(null);
      setActionSuccess(
        linkedInv
          ? `Recebimento ${deletedNumber} excluído. A nota fiscal ${linkedInv.nfeNumber} voltou automaticamente para "Aguardando Recebimento".`
          : `Recebimento ${deletedNumber} excluído definitivamente.`
      );
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'Não foi possível excluir o recebimento físico.'
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmUnlink = async () => {
    if (!unlinkTarget) return;
    setSaving(true);
    try {
      await unlinkPhysicalReceiptFromPo(unlinkTarget.id);
      setUnlinkTarget(null);
    } finally {
      setSaving(false);
    }
  };

  if (!canRead) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <Lock className="w-8 h-8 text-slate-400 mx-auto mb-3" />
        <h2 className="font-display text-lg font-semibold text-slate-900 mb-1">
          Acesso Restrito ao Setor de Recebimento
        </h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          A visualização cruzada de Recebimentos Físicos foi desativada pelo ADM Titular para o seu perfil.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
          Recebimento Físico
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Busque o Pedido de Compra, vincule ao XML importado pelo Fiscal e faça a conferência quantitativa com cálculo automático de saldo
        </p>
      </div>

      {actionSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3 text-xs text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {!canCreate && !canEdit && (
        <div className="bg-slate-100 border border-slate-200 rounded-lg px-4 py-3 flex items-center gap-2.5 text-xs text-slate-700">
          <Lock className="w-4 h-4 text-slate-500 shrink-0" />
          <span>
            Modo somente leitura: registros de conferência física são restritos ao setor de Recebimento ou ao ADM Titular.
          </span>
        </div>
      )}

      {/* Section 1: Purchase Orders available for Receiving */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              1. Selecionar Pedido de Compra para Recebimento
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pedidos concluídos (100% atendidos) ficam travados para novos recebimentos
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={poSearch}
                onChange={(e) => setPoSearch(e.target.value)}
                placeholder="Buscar pedido por nº ou fornecedor..."
                className="w-full sm:w-64 pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'ativos', label: 'Pendentes / Parciais' },
                  { id: 'concluido', label: 'Concluídos' },
                  { id: 'todos', label: 'Todos' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPoStatusFilter(t.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
                    poStatusFilter === t.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {dataLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-11 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredPos.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Nenhum Pedido de Compra encontrado com os filtros atuais.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Nº Pedido</th>
                  <th className="py-3 px-4">Fornecedor / CNPJ</th>
                  <th className="py-3 px-4 text-right">Qtd Recebida / Pedida</th>
                  <th className="py-3 px-4 text-right">Saldo Restante</th>
                  <th className="py-3 px-4">Status Pedido</th>
                  <th className="py-3 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredPos.map((po) => {
                  const summary = getPoReceptionSummary(po, physicalReceipts);
                  const saldoRestante = Math.max(0, summary.totalOrdered - summary.totalReceived);
                  const isLocked = po.status === 'concluido';

                  return (
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
                        <div className="text-xs font-medium text-slate-900 max-w-[240px] truncate">
                          {po.supplierName}
                        </div>
                        <div className="font-mono text-xs text-slate-500 tabular-nums">
                          {po.supplierCnpj}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-800 tabular-nums whitespace-nowrap">
                        {summary.totalReceived} / {summary.totalOrdered}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {saldoRestante} un
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {po.status === 'aberto' && <StatusTag label="Aberto" tone="info" />}
                        {po.status === 'parcialmente_atendido' && (
                          <StatusTag label="Parcialmente Atendido" tone="warning" />
                        )}
                        {po.status === 'concluido' && <StatusTag label="Concluído" tone="success" />}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {canCreate ? (
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() => openRegisterForPo(po)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                              isLocked
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : 'bg-slate-900 text-white hover:bg-slate-800 cursor-pointer'
                            }`}
                          >
                            {isLocked ? (
                              <>
                                <Lock className="w-3.5 h-3.5" />
                                Pedido Concluído
                              </>
                            ) : (
                              <>
                                <PackageCheck className="w-3.5 h-3.5" />
                                Registrar Recebimento
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">Somente leitura</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 2: Registered Physical Receipts History */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              2. Histórico de Recebimentos Registrados ({filteredReceipts.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Edição permitida apenas enquanto o status fiscal da nota vinculada não for Lançado
            </p>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={receiptSearch}
              onChange={(e) => setReceiptSearch(e.target.value)}
              placeholder="Filtrar recebimentos..."
              className="w-full sm:w-60 pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        {filteredReceipts.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Nenhum recebimento físico registrado ainda.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Nº Recebimento</th>
                  <th className="py-3 px-4">Pedido / NF Vinculada</th>
                  <th className="py-3 px-4">Fornecedor</th>
                  <th className="py-3 px-4 text-right">Qtd Conferida</th>
                  <th className="py-3 px-4">Status Fiscal da Nota</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredReceipts.map((rec) => {
                  const sumRec = rec.items.reduce((s, it) => s + Number(it.qtyReceived || 0), 0);
                  const linkedInv = fiscalInvoices.find(
                    (f) => f.id === rec.fiscalInvoiceId || f.receiptId === rec.id
                  );
                  const isInvoiceLaunched =
                    linkedInv?.fiscalStatus === 'lancado' ||
                    linkedInv?.fiscalStatus === 'escriturada';
                  const rowCanEdit = canEdit && (isAdmin || !isInvoiceLaunched);
                  const rowCanDelete = canDelete && (isAdmin || !isInvoiceLaunched);

                  return (
                    <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                          {rec.receiptNumber}
                        </div>
                        <div className="text-xs text-slate-500 tabular-nums">
                          {formatDateBR(rec.receiptDate)} · {rec.receivedByName}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-xs font-mono">
                        {rec.purchaseOrderId ? (
                          <div className="text-blue-700 font-medium">{rec.poNumber}</div>
                        ) : (
                          <div className="text-amber-700">Desvinculado</div>
                        )}
                        <div className="text-slate-500">
                          {rec.invoiceNumberRef ? `NF ${rec.invoiceNumberRef}` : 'Sem NF'}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-xs font-medium text-slate-900 max-w-[200px] truncate">
                          {rec.supplierName}
                        </div>
                        <div className="font-mono text-xs text-slate-500 tabular-nums">
                          {rec.warehouseLocation}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {sumRec} un
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {!linkedInv ? (
                          <StatusTag label="Sem NF vinculada" tone="neutral" />
                        ) : isInvoiceLaunched ? (
                          <StatusTag label="Lançado (Travado)" tone="success" />
                        ) : linkedInv.fiscalStatus === 'pendente' ? (
                          <StatusTag label="Pendente no Fiscal" tone="info" />
                        ) : (
                          <StatusTag label={linkedInv.fiscalStatus} tone="neutral" />
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {canEdit && (
                            <button
                              type="button"
                              disabled={!rowCanEdit}
                              onClick={() => rowCanEdit && openEditModal(rec)}
                              title={
                                !rowCanEdit
                                  ? 'Edição bloqueada: nota fiscal já lançada pelo setor Fiscal.'
                                  : 'Editar quantidades recebidas'
                              }
                              className={`p-1.5 rounded-md transition-colors ${
                                rowCanEdit
                                  ? 'text-slate-500 hover:text-blue-700 hover:bg-blue-50 cursor-pointer'
                                  : 'text-slate-300 cursor-not-allowed'
                              }`}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {isAdmin && rec.purchaseOrderId && (
                            <button
                              type="button"
                              onClick={() => setUnlinkTarget(rec)}
                              title="Desvincular Pedido (ADM Titular)"
                              className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-md transition-colors cursor-pointer"
                            >
                              <Link2Off className="w-4 h-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              disabled={!rowCanDelete}
                              onClick={() => {
                                if (!rowCanDelete) return;
                                setDeleteError(null);
                                setDeleteTarget(rec);
                              }}
                              title={
                                !rowCanDelete
                                  ? 'Exclusão bloqueada: nota fiscal já lançada.'
                                  : 'Excluir recebimento'
                              }
                              className={`p-1.5 rounded-md transition-colors ${
                                rowCanDelete
                                  ? 'text-slate-500 hover:text-red-700 hover:bg-red-50 cursor-pointer'
                                  : 'text-slate-300 cursor-not-allowed'
                              }`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Receipt Modal */}
      {modalOpen && targetPo && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  {editingReceipt
                    ? `Editar Recebimento ${editingReceipt.receiptNumber}`
                    : `Registrar Recebimento · ${targetPo.poNumber}`}
                </h2>
                <p className="text-xs text-slate-500 font-mono">
                  {targetPo.supplierName} · CNPJ: {targetPo.supplierCnpj}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {formError}
                </div>
              )}

              {/* Step 1: Cross CNPJ with Fiscal XMLs waiting for receiving */}
              {!editingReceipt && (
                <div className="space-y-3">
                  {matchingAvailableInvoices.length === 0 ? (
                    <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-amber-900">
                          Nenhuma nota fiscal importada para este fornecedor. Acione imediatamente o setor Fiscal para importar o XML.
                        </p>
                        <p className="text-xs text-amber-800 mt-1">
                          Regra de ouro P2P: o recebimento físico só pode ser concluído vinculando uma NF-e, NFS-e ou CT-e com status &ldquo;Aguardando Recebimento&rdquo; para o CNPJ{' '}
                          <span className="font-mono font-semibold">{targetPo.supplierCnpj}</span>.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                        Nota Fiscal Importada Disponível (CNPJ {targetPo.supplierCnpj})
                      </label>
                      <select
                        required
                        value={selectedInvoiceId}
                        onChange={(e) => setSelectedInvoiceId(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-blue-600"
                      >
                        <option value="">
                          Selecione a nota fiscal recebida ({matchingAvailableInvoices.length} disponível)...
                        </option>
                        {matchingAvailableInvoices.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.docType || 'NFE'} Nº {inv.nfeNumber} (Série {inv.series}) · Emissão{' '}
                            {formatDateBR(inv.issueDate)} · Total {formatBRL(inv.totalInvoice)}
                            {inv.isPartialBilling ? ' [Faturamento Parcial]' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nº do Recebimento
                  </label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingReceipt)}
                    maxLength={BLUEPRINT_LIMITS.MAX_RECEIPT_NUMBER}
                    value={receiptNumber}
                    onChange={(e) => setReceiptNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Data do Recebimento
                  </label>
                  <input
                    type="date"
                    required
                    value={receiptDate}
                    onChange={(e) => setReceiptDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Doca / Armazém
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={BLUEPRINT_LIMITS.MAX_WAREHOUSE}
                    value={warehouseLocation}
                    onChange={(e) => setWarehouseLocation(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Step 2: Manual Quantity Input & Real-Time Balance Calculation */}
              {(editingReceipt || selectedInvoiceId) && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">
                      Conferência Manual de Itens & Cálculo de Saldo
                    </span>
                    <StatusTag
                      label={
                        balanceEvaluation.nextPoStatus === 'concluido'
                          ? 'Atendimento Total (100% — Concluído)'
                          : balanceEvaluation.nextPoStatus === 'parcialmente_atendido'
                          ? 'Atendimento Parcial (Restante Aberto)'
                          : 'Aguardando Digitação'
                      }
                      tone={
                        balanceEvaluation.nextPoStatus === 'concluido'
                          ? 'success'
                          : balanceEvaluation.nextPoStatus === 'parcialmente_atendido'
                          ? 'warning'
                          : 'neutral'
                      }
                    />
                  </div>

                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                          <th className="py-2 px-3">Item do Pedido</th>
                          <th className="py-2 px-3 text-right">Qtd Pedida</th>
                          <th className="py-2 px-3 text-right">Já Recebido</th>
                          <th className="py-2 px-3 text-right w-32">Qtd Recebida</th>
                          <th className="py-2 px-3 text-right">Saldo Restante</th>
                          <th className="py-2 px-3 w-32">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map((item, idx) => {
                          const prevQty =
                            prevReceivedMap.get(`${item.code}::${item.description}`) || 0;
                          const saldoRestante = Math.max(
                            0,
                            Number((item.qtyOrdered - prevQty - item.qtyReceived).toFixed(4))
                          );

                          return (
                            <tr key={idx}>
                              <td className="py-2.5 px-3">
                                <div className="font-medium text-slate-900">
                                  {item.description}
                                </div>
                                <div className="font-mono text-slate-500">{item.code}</div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                                {item.qtyOrdered} {item.unit}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-slate-500 tabular-nums">
                                {prevQty} {item.unit}
                              </td>
                              <td className="py-2.5 px-3">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.qtyReceived}
                                  onChange={(e) =>
                                    updateItemConference(
                                      idx,
                                      'qtyReceived',
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                  className="w-full px-2 py-1 text-right font-mono border border-slate-300 rounded tabular-nums focus:outline-none focus:border-blue-600"
                                />
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums">
                                <span
                                  className={
                                    saldoRestante > 0 ? 'text-amber-700' : 'text-emerald-700'
                                  }
                                >
                                  {saldoRestante} {item.unit}
                                </span>
                              </td>
                              <td className="py-2.5 px-3">
                                <select
                                  value={item.condition}
                                  onChange={(e) =>
                                    updateItemConference(
                                      idx,
                                      'condition',
                                      e.target.value as ReceiptItemCondition
                                    )
                                  }
                                  className="w-full px-2 py-1 border border-slate-300 rounded bg-white"
                                >
                                  <option value="conforme">Conforme</option>
                                  <option value="divergente">Divergente</option>
                                  <option value="avaria">Avaria</option>
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Balance & Transition Preview */}
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-slate-900">Efeito ao salvar:</span>{' '}
                      Pedido passará para{' '}
                      <span className="font-semibold text-slate-900">
                        {balanceEvaluation.nextPoStatus === 'concluido'
                          ? 'Concluído (travado)'
                          : balanceEvaluation.nextPoStatus === 'parcialmente_atendido'
                          ? 'Parcialmente Atendido (aberto)'
                          : 'Aberto'}
                      </span>
                      {!editingReceipt && (
                        <span> · Nota fiscal passará para status Pendente no Fiscal.</span>
                      )}
                    </div>
                    <div className="font-mono font-semibold text-slate-900 tabular-nums shrink-0">
                      Saldo final do pedido: {balanceEvaluation.totalRemaining} un
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Observações da Conferência
                </label>
                <textarea
                  rows={2}
                  maxLength={BLUEPRINT_LIMITS.MAX_NOTES}
                  value={observations}
                  onChange={(e) => setObservations(e.target.value)}
                  placeholder="Registre lacres, avarias de transporte ou justificativas de saldo..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={
                    saving ||
                    (!editingReceipt && !selectedInvoiceId) ||
                    balanceEvaluation.totalEnteredNow <= 0
                  }
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {saving
                    ? 'Salvando...'
                    : editingReceipt
                    ? 'Salvar Quantidades'
                    : 'Confirmar Recebimento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unlink Confirmation (ADM Titular only) */}
      {unlinkTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6">
            <h3 className="font-display text-base font-semibold text-slate-900 mb-2">
              Desvincular Pedido de Compra
            </h3>
            <p className="text-sm text-slate-600 mb-5">
              Como <span className="font-medium text-slate-900">ADM Titular</span>, confirma a desvinculação do recebimento{' '}
              <span className="font-mono font-semibold">{unlinkTarget.receiptNumber}</span> do pedido{' '}
              <span className="font-mono font-semibold">{unlinkTarget.poNumber}</span>?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setUnlinkTarget(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={confirmUnlink}
                className="px-4 py-2 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 cursor-pointer"
              >
                {saving ? 'Desvinculando...' : 'Desvincular Pedido'}
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteAuthModal
        isOpen={Boolean(deleteTarget)}
        title="Excluir Recebimento Físico"
        description={
          deleteTarget ? (
            <div className="space-y-2">
              <p>
                Confirma a exclusão do recebimento{' '}
                <span className="font-mono font-semibold text-slate-900">
                  {deleteTarget.receiptNumber}
                </span>
                ?
              </p>
              {fiscalInvoices.some(
                (f) => f.receiptId === deleteTarget.id || f.id === deleteTarget.fiscalInvoiceId
              ) && (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                  A nota fiscal vinculada retornará automaticamente para o status{' '}
                  <span className="font-semibold text-slate-900">Aguardando Recebimento</span>{' '}
                  para que o setor possa registrá-la novamente.
                </p>
              )}
            </div>
          ) : null
        }
        isAdmin={isAdmin}
        deletionPasswordConfigured={deletionPasswordConfigured}
        loading={saving}
        error={deleteError}
        onCancel={() => {
          setDeleteError(null);
          setDeleteTarget(null);
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

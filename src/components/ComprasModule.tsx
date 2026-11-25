import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useP2P } from '../context/P2PContext';
import {
  AdjustmentRequest,
  AdjustmentRequestStatus,
  BLUEPRINT_LIMITS,
  FiscalDocType,
  FiscalInvoice,
  FiscalStatus,
  PhysicalReceipt,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderStatus,
} from '../types/p2p';
import {
  addDaysISO,
  formatBRL,
  formatDateBR,
  isValidCnpj,
  maskCnpj,
  todayISO,
} from '../utils/formatters';
import { getPoReceptionSummary } from '../utils/matching';
import { DeleteAuthModal } from './DeleteAuthModal';
import { StatusTag } from './StatusBadge';

export function ComprasModule() {
  const {
    purchaseOrders,
    physicalReceipts,
    fiscalInvoices,
    adjustmentRequests,
    canAccessSectorData,
    canCreateInSector,
    canEditInSector,
    canDeleteInSector,
    isAdmin,
    deletionPasswordConfigured,
    createPurchaseOrder,
    updatePurchaseOrder,
    deletePurchaseOrder,
    respondAdjustmentRequestAsCompras,
    dataLoading,
  } = useP2P();

  const canRead = canAccessSectorData('compras');
  const canCreate = canCreateInSector('compras');
  const canEdit = canEditInSector('compras');
  const canDelete = canDeleteInSector('compras');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'todos' | PurchaseOrderStatus | 'ajuste_solicitado'
  >('todos');
  const [adjustmentNotes, setAdjustmentNotes] = useState<Record<string, string>>({});
  const [respondingAdjId, setRespondingAdjId] = useState<string | null>(null);
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [detailOrder, setDetailOrder] = useState<PurchaseOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PurchaseOrder | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Form state
  const [poNumber, setPoNumber] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierCnpj, setSupplierCnpj] = useState('');
  const [costCenter, setCostCenter] = useState('Operações');
  const [issueDate, setIssueDate] = useState(todayISO());
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(addDaysISO(7));
  const [paymentTerms, setPaymentTerms] = useState('28 DDL');
  const [freightAmount, setFreightAmount] = useState<number>(0);
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [status, setStatus] = useState<PurchaseOrderStatus>('aberto');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<PurchaseOrderItem[]>([
    { code: 'MAT-001', description: '', unit: 'UN', qtyOrdered: 1, unitPrice: 0, totalPrice: 0 },
  ]);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeAdjustmentsByPo = useMemo(() => {
    const map = new Map<string, AdjustmentRequest[]>();
    adjustmentRequests.forEach((req) => {
      if (req.status === 'Resolvido' || req.status === 'Cancelado') return;
      const list = map.get(req.purchaseOrderId) || [];
      list.push(req);
      map.set(req.purchaseOrderId, list);
    });
    return map;
  }, [adjustmentRequests]);

  const posWithActiveAdjustmentCount = activeAdjustmentsByPo.size;

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return purchaseOrders.filter((po) => {
      if (statusFilter === 'ajuste_solicitado') {
        if ((activeAdjustmentsByPo.get(po.id)?.length || 0) === 0) return false;
      } else if (statusFilter !== 'todos' && po.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        po.poNumber.toLowerCase().includes(q) ||
        po.supplierName.toLowerCase().includes(q) ||
        po.supplierCnpj.toLowerCase().includes(q) ||
        po.costCenter.toLowerCase().includes(q)
      );
    });
  }, [purchaseOrders, search, statusFilter, activeAdjustmentsByPo]);

  const linkedInvoicesByPo = useMemo(() => {
    const map = new Map<string, number>();
    fiscalInvoices.forEach((inv) => {
      if (inv.purchaseOrderId) {
        map.set(inv.purchaseOrderId, (map.get(inv.purchaseOrderId) || 0) + 1);
      }
    });
    return map;
  }, [fiscalInvoices]);

  const anyOrderLockedForUser = useMemo(() => {
    if (isAdmin) return false;
    return filteredOrders.some((po) => (linkedInvoicesByPo.get(po.id) || 0) > 0);
  }, [filteredOrders, linkedInvoicesByPo, isAdmin]);

  const detailOrderTracking = useMemo(() => {
    if (!detailOrder) return null;

    const poReceipts = physicalReceipts.filter((r) => r.purchaseOrderId === detailOrder.id);
    const poInvoices = fiscalInvoices.filter((f) => f.purchaseOrderId === detailOrder.id);
    const poAdjustments = adjustmentRequests
      .filter((req) => req.purchaseOrderId === detailOrder.id)
      .sort((a, b) => {
        const activeA = a.status !== 'Resolvido' && a.status !== 'Cancelado' ? 0 : 1;
        const activeB = b.status !== 'Resolvido' && b.status !== 'Cancelado' ? 0 : 1;
        if (activeA !== activeB) return activeA - activeB;
        return (b.requestedAt || '').localeCompare(a.requestedAt || '');
      });

    const receivedByItemKey = new Map<string, number>();
    const receivedByDesc = new Map<string, number>();
    poReceipts.forEach((rec) => {
      rec.items.forEach((it) => {
        const key = `${it.code}::${it.description}`;
        receivedByItemKey.set(key, (receivedByItemKey.get(key) || 0) + Number(it.qtyReceived || 0));
        const descKey = it.description.trim().toLowerCase();
        receivedByDesc.set(descKey, (receivedByDesc.get(descKey) || 0) + Number(it.qtyReceived || 0));
      });
    });

    const summary = getPoReceptionSummary(detailOrder, physicalReceipts);

    type OrderLaunchRow = {
      id: string;
      sortDate: string;
      receiptDateText: string;
      invoiceNumberText: string;
      itemDescription: string;
      invoiceQtyText: string;
      unitPrice: number | null;
      invoiceTotal: number | null;
      isMultiItemInvoice: boolean;
      invoice?: FiscalInvoice;
      receipt?: PhysicalReceipt;
    };

    const docTypeLabel: Record<FiscalDocType, string> = {
      NFE: 'NF-e',
      NFSE: 'NFS-e',
      CTE: 'CT-e',
    };

    const usedInvoiceIds = new Set<string>();
    const rows: OrderLaunchRow[] = [];

    poReceipts.forEach((rec) => {
      const matchedInv =
        fiscalInvoices.find((f) => f.id === rec.fiscalInvoiceId) ||
        poInvoices.find((f) => f.receiptId === rec.id) ||
        (rec.invoiceNumberRef
          ? poInvoices.find((f) => f.nfeNumber === rec.invoiceNumberRef)
          : undefined);

      if (matchedInv) {
        usedInvoiceIds.add(matchedInv.id);
        const invItems =
          matchedInv.items.length > 0
            ? matchedInv.items
            : [
                {
                  code: '',
                  description: `${docTypeLabel[matchedInv.docType || 'NFE']} ${matchedInv.nfeNumber}`,
                  ncm: '',
                  cfop: matchedInv.cfop,
                  unit: 'UN',
                  qty: 1,
                  unitPrice: matchedInv.totalInvoice,
                  totalPrice: matchedInv.totalInvoice,
                },
              ];

        invItems.forEach((it, idx) => {
          rows.push({
            id: `rec_${rec.id}_inv_${matchedInv.id}_${idx}`,
            sortDate: rec.receiptDate || matchedInv.issueDate,
            receiptDateText: rec.receiptDate ? formatDateBR(rec.receiptDate) : '—',
            invoiceNumberText: `${docTypeLabel[matchedInv.docType || 'NFE']} ${matchedInv.nfeNumber}`,
            itemDescription: it.description,
            invoiceQtyText: `${Number(it.qty || 0)} ${it.unit || 'UN'}`,
            unitPrice: Number(it.unitPrice ?? 0),
            invoiceTotal: matchedInv.totalInvoice,
            isMultiItemInvoice: invItems.length > 1,
            invoice: matchedInv,
            receipt: rec,
          });
        });
      } else {
        const activeItems = rec.items.filter((it) => Number(it.qtyReceived || 0) > 0);
        const itemsToShow = activeItems.length > 0 ? activeItems : rec.items;
        itemsToShow.forEach((it, idx) => {
          rows.push({
            id: `rec_${rec.id}_item_${idx}`,
            sortDate: rec.receiptDate,
            receiptDateText: rec.receiptDate ? formatDateBR(rec.receiptDate) : '—',
            invoiceNumberText: rec.invoiceNumberRef ? `NF ${rec.invoiceNumberRef}` : 'Sem NF vinculada',
            itemDescription: it.description,
            invoiceQtyText: `${Number(it.qtyReceived || 0)} ${it.unit || 'UN'}`,
            unitPrice: null,
            invoiceTotal: null,
            isMultiItemInvoice: false,
            receipt: rec,
          });
        });
      }
    });

    poInvoices
      .filter((inv) => !usedInvoiceIds.has(inv.id))
      .forEach((inv) => {
        const invItems =
          inv.items.length > 0
            ? inv.items
            : [
                {
                  code: '',
                  description: `${docTypeLabel[inv.docType || 'NFE']} ${inv.nfeNumber}`,
                  ncm: '',
                  cfop: inv.cfop,
                  unit: 'UN',
                  qty: 1,
                  unitPrice: inv.totalInvoice,
                  totalPrice: inv.totalInvoice,
                },
              ];

        const linkedRec = inv.receiptId
          ? poReceipts.find((r) => r.id === inv.receiptId)
          : undefined;
        const receiptDateText = linkedRec?.receiptDate
          ? formatDateBR(linkedRec.receiptDate)
          : inv.requiresPhysicalReceipt === false
          ? inv.bookkeepingDate
            ? formatDateBR(inv.bookkeepingDate)
            : 'Sem receb. físico'
          : 'Aguardando doca';

        invItems.forEach((it, idx) => {
          rows.push({
            id: `inv_${inv.id}_${idx}`,
            sortDate: linkedRec?.receiptDate || inv.bookkeepingDate || inv.issueDate,
            receiptDateText,
            invoiceNumberText: `${docTypeLabel[inv.docType || 'NFE']} ${inv.nfeNumber}`,
            itemDescription: it.description,
            invoiceQtyText: `${Number(it.qty || 0)} ${it.unit || 'UN'}`,
            unitPrice: Number(it.unitPrice ?? 0),
            invoiceTotal: inv.totalInvoice,
            isMultiItemInvoice: invItems.length > 1,
            invoice: inv,
            receipt: linkedRec,
          });
        });
      });

    rows.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

    return {
      summary,
      receivedByItemKey,
      receivedByDesc,
      entries: rows,
      poAdjustments,
    };
  }, [detailOrder, physicalReceipts, fiscalInvoices, adjustmentRequests]);

  const handleRespondAdjustment = async (
    req: AdjustmentRequest,
    nextStatus: Extract<
      AdjustmentRequestStatus,
      'Em análise' | 'Ajustado' | 'Devolvido para revisão fiscal'
    >
  ) => {
    setAdjustmentError(null);
    setRespondingAdjId(req.id);
    try {
      const note = adjustmentNotes[req.id] || '';
      await respondAdjustmentRequestAsCompras(req.id, nextStatus, note);
      setActionSuccess(
        `Solicitação de ajuste da ${req.invoiceNumber} atualizada para "${nextStatus}".`
      );
    } catch (err) {
      setAdjustmentError(
        err instanceof Error ? err.message : 'Erro ao responder solicitação de ajuste.'
      );
    } finally {
      setRespondingAdjId(null);
    }
  };

  const openCreateModal = () => {
    const nextSeq = String(purchaseOrders.length + 1).padStart(4, '0');
    setEditingOrder(null);
    setPoNumber(`PC-${new Date().getFullYear()}-${nextSeq}`);
    setSupplierName('');
    setSupplierCnpj('');
    setCostCenter('Operações');
    setIssueDate(todayISO());
    setExpectedDeliveryDate(addDaysISO(7));
    setPaymentTerms('28 DDL');
    setFreightAmount(0);
    setDiscountAmount(0);
    setStatus('aberto');
    setNotes('');
    setItems([
      { code: 'MAT-001', description: '', unit: 'UN', qtyOrdered: 1, unitPrice: 0, totalPrice: 0 },
    ]);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (po: PurchaseOrder) => {
    setEditingOrder(po);
    setPoNumber(po.poNumber);
    setSupplierName(po.supplierName);
    setSupplierCnpj(maskCnpj(po.supplierCnpj));
    setCostCenter(po.costCenter);
    setIssueDate(po.issueDate);
    setExpectedDeliveryDate(po.expectedDeliveryDate);
    setPaymentTerms(po.paymentTerms);
    setFreightAmount(Number(po.freightAmount || 0));
    setDiscountAmount(Number(po.discountAmount || 0));
    setStatus(po.status);
    setNotes(po.notes);
    setItems(po.items.map((it) => ({ ...it })));
    setFormError(null);
    setModalOpen(true);
  };

  const updateItemField = (
    idx: number,
    field: keyof PurchaseOrderItem,
    val: string | number
  ) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const updated = { ...it, [field]: val };
        updated.totalPrice = Number(
          (Number(updated.qtyOrdered || 0) * Number(updated.unitPrice || 0)).toFixed(2)
        );
        return updated;
      })
    );
  };

  const addItemRow = () => {
    if (items.length >= BLUEPRINT_LIMITS.MAX_ITEMS) return;
    setItems((prev) => [
      ...prev,
      {
        code: `MAT-${String(prev.length + 1).padStart(3, '0')}`,
        description: '',
        unit: 'UN',
        qtyOrdered: 1,
        unitPrice: 0,
        totalPrice: 0,
      },
    ]);
  };

  const removeItemRow = (idx: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const itemsSubtotal = useMemo(
    () => items.reduce((s, it) => s + Number(it.qtyOrdered || 0) * Number(it.unitPrice || 0), 0),
    [items]
  );

  const computedTotal = useMemo(
    () => Math.max(0, itemsSubtotal + Number(freightAmount || 0) - Number(discountAmount || 0)),
    [itemsSubtotal, freightAmount, discountAmount]
  );

  const cnpjDigitsCount = supplierCnpj.replace(/\D/g, '').length;
  const cnpjIsValid = isValidCnpj(supplierCnpj);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!isValidCnpj(supplierCnpj)) {
      setFormError('CNPJ do Fornecedor inválido. Verifique os 14 dígitos e os dígitos verificadores.');
      return;
    }
    if (!poNumber.trim() || !supplierName.trim()) {
      setFormError('Número do Pedido e Fornecedor são obrigatórios.');
      return;
    }
    if (items.some((it) => !it.description.trim() || Number(it.qtyOrdered) <= 0)) {
      setFormError('Todos os itens devem possuir descrição e quantidade solicitada maior que zero.');
      return;
    }
    if (freightAmount < 0 || discountAmount < 0) {
      setFormError('Valor de Frete e Descontos não podem ser negativos.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        poNumber: poNumber.trim(),
        supplierName: supplierName.trim(),
        supplierCnpj: maskCnpj(supplierCnpj),
        costCenter: costCenter.trim(),
        issueDate,
        expectedDeliveryDate,
        paymentTerms: paymentTerms.trim(),
        items,
        freightAmount: Number(freightAmount || 0),
        discountAmount: Number(discountAmount || 0),
        totalAmount: computedTotal,
        status,
        notes: notes.trim(),
      };
      if (editingOrder) {
        await updatePurchaseOrder(editingOrder.id, payload);
        setActionSuccess(`Pedido ${payload.poNumber} atualizado com sucesso.`);
      } else {
        await createPurchaseOrder(payload);
        setActionSuccess(`Pedido ${payload.poNumber} cadastrado e salvo no sistema.`);
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar Pedido de Compra.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (supervisorPassword?: string) => {
    if (!deleteTarget) return;
    setSaving(true);
    setDeleteError(null);
    try {
      const deletedPoNumber = deleteTarget.poNumber;
      await deletePurchaseOrder(deleteTarget.id, supervisorPassword);
      setDeleteTarget(null);
      setActionSuccess(`Pedido ${deletedPoNumber} excluído definitivamente.`);
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'Não foi possível excluir o Pedido de Compra.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (!canRead) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <Lock className="w-8 h-8 text-slate-400 mx-auto mb-3" />
        <h2 className="font-display text-lg font-semibold text-slate-900 mb-1">
          Acesso Restrito ao Setor de Compras
        </h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          A visualização cruzada de Pedidos de Compra foi desativada pelo ADM Titular para o seu perfil.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Pedidos de Compra
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Cadastro de pedidos, frete, descontos e múltiplos itens com validação de CNPJ
          </p>
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Novo Pedido de Compra
          </button>
        )}
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
            Modo somente leitura: criação, edição e exclusão de Pedidos de Compra são exclusivas do setor de Compras ou do ADM Titular.
          </span>
        </div>
      )}

      {anyOrderLockedForUser && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-2.5 text-xs text-amber-900">
          <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            Exclusão bloqueada: solicite ao setor Fiscal a desvinculação da nota.
          </span>
        </div>
      )}

      {/* Search and filter bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nº pedido, fornecedor, CNPJ ou centro de custo..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {(
            [
              { id: 'todos', label: 'Todos' },
              { id: 'aberto', label: 'Aberto' },
              { id: 'parcialmente_atendido', label: 'Parcialmente Atendido' },
              { id: 'concluido', label: 'Concluído' },
              {
                id: 'ajuste_solicitado',
                label:
                  posWithActiveAdjustmentCount > 0
                    ? `Com solicitação de ajuste (${posWithActiveAdjustmentCount})`
                    : 'Com solicitação de ajuste',
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                statusFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : tab.id === 'ajuste_solicitado' && posWithActiveAdjustmentCount > 0
                  ? 'text-amber-800 bg-amber-50 hover:bg-amber-100'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {dataLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-11 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900 mb-1">
              Nenhum Pedido de Compra encontrado
            </p>
            <p className="text-xs text-slate-500 mb-4">
              {search || statusFilter !== 'todos'
                ? 'Ajuste os filtros de busca para visualizar outros registros.'
                : 'Crie o primeiro Pedido de Compra para iniciar o fluxo P2P.'}
            </p>
            {canCreate && !search && statusFilter === 'todos' && (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Criar Primeiro Pedido
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Nº Pedido</th>
                  <th className="py-3 px-4">Fornecedor / CNPJ</th>
                  <th className="py-3 px-4">Frete / Descontos</th>
                  <th className="py-3 px-4">Recebimento</th>
                  <th className="py-3 px-4 text-right">Valor Total</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredOrders.map((po) => {
                  const recSummary = getPoReceptionSummary(po, physicalReceipts);
                  const linkedInvoiceCount = linkedInvoicesByPo.get(po.id) || 0;
                  const hasInvoiceLink = linkedInvoiceCount > 0;
                  const lockedByInvoice = !isAdmin && hasInvoiceLink;

                  const rowCanEdit = canEdit && !lockedByInvoice && (isAdmin || po.status !== 'cancelado');
                  const rowCanDelete =
                    canDelete && !lockedByInvoice && (isAdmin || po.status !== 'concluido');

                  return (
                    <tr key={po.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                          {po.poNumber}
                        </div>
                        <div className="text-xs text-slate-500 tabular-nums">
                          {formatDateBR(po.issueDate)} · {po.items.length} item(ns)
                        </div>
                        {(activeAdjustmentsByPo.get(po.id)?.length || 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => setDetailOrder(po)}
                            className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 cursor-pointer"
                          >
                            <AlertCircle className="w-3 h-3" />
                            Ajuste solicitado ({activeAdjustmentsByPo.get(po.id)?.length})
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-xs font-medium text-slate-900 max-w-[240px] truncate">
                          {po.supplierName}
                        </div>
                        <div className="font-mono text-xs text-slate-500 tabular-nums">
                          {po.supplierCnpj}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap font-mono tabular-nums">
                        <div>Frete: {formatBRL(Number(po.freightAmount || 0))}</div>
                        <div className="text-slate-500">
                          Desc: {formatBRL(Number(po.discountAmount || 0))}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        <div className="text-slate-800 font-medium">{recSummary.label}</div>
                        <div className="text-slate-500 tabular-nums">
                          {recSummary.totalReceived}/{recSummary.totalOrdered} un
                          {hasInvoiceLink ? ` · ${linkedInvoiceCount} NF vinculada(s)` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {formatBRL(po.totalAmount)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {po.status === 'aberto' && <StatusTag label="Aberto" tone="info" />}
                        {po.status === 'parcialmente_atendido' && (
                          <StatusTag label="Parcialmente Atendido" tone="warning" />
                        )}
                        {po.status === 'concluido' && <StatusTag label="Concluído" tone="success" />}
                        {po.status === 'cancelado' && <StatusTag label="Cancelado" tone="danger" />}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDetailOrder(po)}
                            title="Visualizar detalhes"
                            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {canEdit && (
                            <button
                              type="button"
                              disabled={!rowCanEdit}
                              onClick={() => rowCanEdit && openEditModal(po)}
                              title={
                                lockedByInvoice
                                  ? 'Exclusão bloqueada: solicite ao setor Fiscal a desvinculação da nota.'
                                  : 'Editar pedido'
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

                          {canDelete && (
                            <button
                              type="button"
                              disabled={!rowCanDelete}
                              onClick={() => {
                                if (!rowCanDelete) return;
                                setDeleteError(null);
                                setDeleteTarget(po);
                              }}
                              title={
                                lockedByInvoice
                                  ? 'Exclusão bloqueada: solicite ao setor Fiscal a desvinculação da nota.'
                                  : 'Excluir pedido'
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
                        {lockedByInvoice && (
                          <div className="text-[11px] text-amber-700 mt-1 whitespace-normal max-w-[210px] ml-auto text-right">
                            Exclusão bloqueada: solicite ao setor Fiscal a desvinculação da nota.
                          </div>
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

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-slate-900">
                {editingOrder ? `Editar Pedido ${editingOrder.poNumber}` : 'Novo Pedido de Compra'}
              </h2>
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

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Número do Pedido
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={BLUEPRINT_LIMITS.MAX_PO_NUMBER}
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Fornecedor (Razão Social)
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={BLUEPRINT_LIMITS.MAX_SUPPLIER_NAME}
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="Ex: Metalúrgica Paulista Industrial Ltda"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    CNPJ do Fornecedor
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={18}
                    value={supplierCnpj}
                    onChange={(e) => setSupplierCnpj(maskCnpj(e.target.value))}
                    placeholder="00.000.000/0001-00"
                    className={`w-full px-3 py-2 text-sm font-mono border rounded-lg focus:outline-none ${
                      cnpjDigitsCount === 14
                        ? cnpjIsValid
                          ? 'border-emerald-500 focus:border-emerald-600'
                          : 'border-red-400 focus:border-red-600'
                        : 'border-slate-300 focus:border-blue-600'
                    }`}
                  />
                  {cnpjDigitsCount > 0 && (
                    <div className="mt-1 flex items-center gap-1 text-[11px]">
                      {cnpjDigitsCount < 14 ? (
                        <span className="text-slate-500">
                          {14 - cnpjDigitsCount} dígito(s) restante(s)
                        </span>
                      ) : cnpjIsValid ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" />
                          CNPJ válido
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-700">
                          <AlertCircle className="w-3 h-3" />
                          Dígitos verificadores inválidos
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Valor de Frete (R$)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={freightAmount}
                    onChange={(e) =>
                      setFreightAmount(Math.max(0, parseFloat(e.target.value) || 0))
                    }
                    className="w-full px-3 py-2 text-sm font-mono text-right border border-slate-300 rounded-lg tabular-nums focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Descontos (R$)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={discountAmount}
                    onChange={(e) =>
                      setDiscountAmount(Math.max(0, parseFloat(e.target.value) || 0))
                    }
                    className="w-full px-3 py-2 text-sm font-mono text-right border border-slate-300 rounded-lg tabular-nums focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Centro de Custo
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={BLUEPRINT_LIMITS.MAX_COST_CENTER}
                    value={costCenter}
                    onChange={(e) => setCostCenter(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Condição Pagamento
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={BLUEPRINT_LIMITS.MAX_PAYMENT_TERMS}
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Previsão Entrega
                  </label>
                  <input
                    type="date"
                    required
                    value={expectedDeliveryDate}
                    onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Status do Pedido
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as PurchaseOrderStatus)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-blue-600"
                  >
                    <option value="aberto">Aberto</option>
                    <option value="parcialmente_atendido">Parcialmente Atendido</option>
                    <option value="concluido">Concluído</option>
                    {isAdmin && <option value="cancelado">Cancelado</option>}
                  </select>
                </div>
              </div>

              {/* Dynamic line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-800">
                    Itens do Pedido ({items.length}/{BLUEPRINT_LIMITS.MAX_ITEMS})
                  </span>
                  <button
                    type="button"
                    onClick={addItemRow}
                    disabled={items.length >= BLUEPRINT_LIMITS.MAX_ITEMS}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md disabled:opacity-40 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    + Adicionar Item
                  </button>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                        <th className="py-2 px-2.5 w-24">Código</th>
                        <th className="py-2 px-2.5">Descrição / Item</th>
                        <th className="py-2 px-2.5 w-16">Unid.</th>
                        <th className="py-2 px-2.5 w-24 text-right">Qtd Solicitada</th>
                        <th className="py-2 px-2.5 w-28 text-right">Vlr Unitário</th>
                        <th className="py-2 px-2.5 w-28 text-right">Subtotal</th>
                        <th className="py-2 px-2 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="p-1.5">
                            <input
                              type="text"
                              maxLength={40}
                              value={item.code}
                              onChange={(e) => updateItemField(idx, 'code', e.target.value)}
                              className="w-full px-2 py-1 text-xs font-mono border border-slate-200 rounded focus:outline-none focus:border-blue-600"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="text"
                              required
                              maxLength={BLUEPRINT_LIMITS.MAX_ITEM_DESC}
                              value={item.description}
                              onChange={(e) => updateItemField(idx, 'description', e.target.value)}
                              placeholder="Descrição do material ou serviço"
                              className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-blue-600"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="text"
                              maxLength={12}
                              value={item.unit}
                              onChange={(e) => updateItemField(idx, 'unit', e.target.value)}
                              className="w-full px-2 py-1 text-xs text-center border border-slate-200 rounded focus:outline-none focus:border-blue-600"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              required
                              value={item.qtyOrdered}
                              onChange={(e) =>
                                updateItemField(idx, 'qtyOrdered', parseFloat(e.target.value) || 0)
                              }
                              className="w-full px-2 py-1 text-xs font-mono text-right border border-slate-200 rounded tabular-nums focus:outline-none focus:border-blue-600"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              required
                              value={item.unitPrice}
                              onChange={(e) =>
                                updateItemField(idx, 'unitPrice', parseFloat(e.target.value) || 0)
                              }
                              className="w-full px-2 py-1 text-xs font-mono text-right border border-slate-200 rounded tabular-nums focus:outline-none focus:border-blue-600"
                            />
                          </td>
                          <td className="p-1.5 text-right font-mono text-xs text-slate-800 tabular-nums">
                            {formatBRL(Number(item.qtyOrdered || 0) * Number(item.unitPrice || 0))}
                          </td>
                          <td className="p-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => removeItemRow(idx)}
                              disabled={items.length <= 1}
                              className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-30 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Automatic Totals Breakdown */}
                <div className="mt-3 p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-end gap-6 text-xs tabular-nums">
                  <div className="text-slate-600">
                    Itens: <span className="font-mono font-medium text-slate-900">{formatBRL(itemsSubtotal)}</span>
                  </div>
                  <div className="text-slate-600">
                    Frete: <span className="font-mono font-medium text-slate-900">+ {formatBRL(freightAmount)}</span>
                  </div>
                  <div className="text-slate-600">
                    Descontos: <span className="font-mono font-medium text-red-700">- {formatBRL(discountAmount)}</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900">
                    Total Líquido: <span className="font-mono ml-1">{formatBRL(computedTotal)}</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Observações Comerciais
                </label>
                <textarea
                  rows={2}
                  maxLength={BLUEPRINT_LIMITS.MAX_NOTES}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Instruções de entrega, local de descarga ou observações contratuais..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
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
                  disabled={saving}
                  className="px-5 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                >
                  {saving ? 'Salvando...' : editingOrder ? 'Salvar Alterações' : 'Emitir Pedido'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailOrder && detailOrderTracking && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-lg font-semibold text-slate-900 font-mono">
                    {detailOrder.poNumber}
                  </h2>
                  {detailOrder.status === 'aberto' && <StatusTag label="Aberto" tone="info" />}
                  {detailOrder.status === 'parcialmente_atendido' && (
                    <StatusTag label="Parcialmente Atendido" tone="warning" />
                  )}
                  {detailOrder.status === 'concluido' && (
                    <StatusTag label="Concluído" tone="success" />
                  )}
                  {detailOrder.status === 'cancelado' && (
                    <StatusTag label="Cancelado" tone="danger" />
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Emitido por {detailOrder.createdByName} em {formatDateBR(detailOrder.issueDate)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailOrder(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-4 border-b border-slate-100">
                <div>
                  <span className="text-xs text-slate-500 block">Fornecedor</span>
                  <span className="font-medium text-slate-900">{detailOrder.supplierName}</span>
                  <span className="block font-mono text-xs text-slate-500 tabular-nums">
                    {detailOrder.supplierCnpj}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">Valores e Condições</span>
                  <span className="text-slate-900 tabular-nums">
                    Frete {formatBRL(Number(detailOrder.freightAmount || 0))} · Descontos{' '}
                    {formatBRL(Number(detailOrder.discountAmount || 0))}
                  </span>
                  <span className="block text-xs text-slate-500 tabular-nums">
                    {detailOrder.costCenter} · {detailOrder.paymentTerms}
                  </span>
                </div>
                <div className="sm:text-right tabular-nums">
                  <span className="text-xs text-slate-500 block">Saldo de Atendimento</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {detailOrderTracking.summary.totalReceived} /{' '}
                    {detailOrderTracking.summary.totalOrdered} recebido(s)
                  </span>
                  <span className="block text-xs text-slate-500">
                    Saldo pendente:{' '}
                    <span className="font-mono font-medium text-slate-800">
                      {Math.max(
                        0,
                        Number(
                          (
                            detailOrderTracking.summary.totalOrdered -
                            detailOrderTracking.summary.totalReceived
                          ).toFixed(4)
                        )
                      )}
                    </span>
                  </span>
                </div>
              </div>

              {/* Itens Solicitados com Saldo */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Itens Solicitados & Saldo por Item
                </h3>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                          <th className="py-2 px-3">Código</th>
                          <th className="py-2 px-3">Descrição</th>
                          <th className="py-2 px-3 text-right">Pedida</th>
                          <th className="py-2 px-3 text-right">Entregue</th>
                          <th className="py-2 px-3 text-right">Saldo</th>
                          <th className="py-2 px-3 text-right">Vlr Unit.</th>
                          <th className="py-2 px-3 text-right">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detailOrder.items.map((it, idx) => {
                          const key = `${it.code}::${it.description}`;
                          const delivered =
                            detailOrderTracking.receivedByItemKey.get(key) ??
                            detailOrderTracking.receivedByDesc.get(
                              it.description.trim().toLowerCase()
                            ) ??
                            0;
                          const remaining = Math.max(
                            0,
                            Number((Number(it.qtyOrdered || 0) - delivered).toFixed(4))
                          );
                          return (
                            <tr key={idx}>
                              <td className="py-2 px-3 font-mono whitespace-nowrap">{it.code}</td>
                              <td className="py-2 px-3">{it.description}</td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                                {it.qtyOrdered} {it.unit}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-700">
                                {delivered} {it.unit}
                              </td>
                              <td
                                className={`py-2 px-3 text-right font-mono font-medium tabular-nums whitespace-nowrap ${
                                  remaining === 0 ? 'text-emerald-700' : 'text-amber-700'
                                }`}
                              >
                                {remaining} {it.unit}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                                {formatBRL(it.unitPrice)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-medium tabular-nums whitespace-nowrap">
                                {formatBRL(it.totalPrice)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Histórico de Lançamentos no Pedido */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Histórico de Lançamentos no Pedido ({detailOrderTracking.entries.length})
                  </h3>
                  <span className="text-xs text-slate-500 tabular-nums">
                    Registro cronológico de notas e quantidades recebidas
                  </span>
                </div>

                {detailOrderTracking.entries.length === 0 ? (
                  <div className="p-5 bg-slate-50 border border-slate-200 rounded-lg text-center text-xs text-slate-500">
                    Nenhum lançamento de nota fiscal ou recebimento registrado para este pedido até o momento.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                            <th className="py-2 px-3">Data de recebimento</th>
                            <th className="py-2 px-3">Nº da Nota Fiscal</th>
                            <th className="py-2 px-3">Item</th>
                            <th className="py-2 px-3 text-right">Qtd. da Nota Fiscal</th>
                            <th className="py-2 px-3 text-right">Valor unitário</th>
                            <th className="py-2 px-3 text-right">Valor total da Nota Fiscal</th>
                            <th className="py-2 px-3">Situação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {detailOrderTracking.entries.map((entry) => {
                            const fiscalStatusMap: Record<
                              FiscalStatus,
                              { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }
                            > = {
                              aguardando_recebimento: {
                                label: 'Aguard. Receb.',
                                tone: 'neutral',
                              },
                              pendente: { label: 'Pendente Fiscal', tone: 'info' },
                              aguardando_escrituracao: { label: 'Pendente Fiscal', tone: 'info' },
                              lancado: { label: 'Lançado', tone: 'success' },
                              escriturada: { label: 'Lançado', tone: 'success' },
                              substituida: { label: 'Substituída', tone: 'warning' },
                              rejeitada: { label: 'Rejeitada', tone: 'danger' },
                            };
                            const badgeInfo = entry.invoice
                              ? fiscalStatusMap[entry.invoice.fiscalStatus]
                              : entry.receipt?.status === 'divergencia'
                              ? { label: 'Divergência', tone: 'warning' as const }
                              : { label: 'Conferido', tone: 'success' as const };

                            return (
                              <tr key={entry.id} className="hover:bg-slate-50/70 align-top">
                                <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap text-slate-900">
                                  {entry.receiptDateText}
                                </td>
                                <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                                  {entry.invoiceNumberText}
                                </td>
                                <td className="py-2.5 px-3 text-slate-800 min-w-[180px]">
                                  {entry.itemDescription}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap">
                                  {entry.invoiceQtyText}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-700">
                                  {entry.unitPrice !== null ? formatBRL(entry.unitPrice) : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-900">
                                  {entry.invoiceTotal !== null ? formatBRL(entry.invoiceTotal) : '—'}
                                  {entry.isMultiItemInvoice && (
                                    <span className="block text-[10px] font-sans text-slate-400">
                                      Total da NF
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  <StatusTag label={badgeInfo.label} tone={badgeInfo.tone} />
                                  {entry.receipt?.status === 'divergencia' && entry.invoice && (
                                    <div className="text-[11px] text-amber-700 mt-1">
                                      Receb. c/ divergência
                                    </div>
                                  )}
                                  {entry.invoice?.fiscalStatus === 'substituida' &&
                                    entry.invoice.replacedByInvoiceNumber && (
                                      <div className="text-[11px] text-amber-800 font-mono mt-1">
                                        Subst. por NF {entry.invoice.replacedByInvoiceNumber}
                                      </div>
                                    )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* Solicitações de Ajuste enviadas pelo Fiscal */}
              {detailOrderTracking.poAdjustments.length > 0 && (
                <div className="space-y-3 pt-4 border-t border-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Solicitações de Ajuste (Fiscal → Compras) ({detailOrderTracking.poAdjustments.length})
                    </h3>
                    <span className="text-xs text-slate-500">
                      Trate as divergências no Pedido e responda ao Fiscal
                    </span>
                  </div>

                  {adjustmentError && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                      {adjustmentError}
                    </div>
                  )}

                  <div className="space-y-3">
                    {detailOrderTracking.poAdjustments.map((req) => {
                      const isActiveReq =
                        req.status !== 'Resolvido' && req.status !== 'Cancelado';
                      const statusTone: 'warning' | 'info' | 'success' | 'danger' | 'neutral' =
                        req.status === 'Resolvido'
                          ? 'success'
                          : req.status === 'Cancelado'
                          ? 'neutral'
                          : req.status === 'Ajustado'
                          ? 'info'
                          : req.status === 'Devolvido para revisão fiscal'
                          ? 'danger'
                          : 'warning';

                      return (
                        <div
                          key={req.id}
                          className={`p-4 rounded-xl border text-xs space-y-3 ${
                            isActiveReq
                              ? 'bg-amber-50/40 border-amber-300'
                              : 'bg-slate-50 border-slate-200'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="font-mono font-semibold text-slate-900">
                                {req.docType} {req.invoiceNumber}
                              </span>{' '}
                              <span className="text-slate-500">
                                · Solicitado por {req.requestedByName} em{' '}
                                {formatDateBR(req.requestedAt.slice(0, 10))}
                              </span>
                            </div>
                            <StatusTag label={req.status} tone={statusTone} />
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2.5 bg-white border border-slate-200 rounded-lg tabular-nums">
                            <div>
                              <span className="text-[11px] text-slate-500 block">Bruto Pedido</span>
                              <span className="font-mono font-semibold text-slate-900">
                                {formatBRL(req.poGrossTotal)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[11px] text-slate-500 block">Bruto Nota</span>
                              <span className="font-mono font-semibold text-slate-900">
                                {formatBRL(req.invoiceGrossTotal)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[11px] text-slate-500 block">Líquido Pedido</span>
                              <span className="font-mono font-semibold text-slate-900">
                                {formatBRL(req.poNetTotal)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[11px] text-slate-500 block">Líquido Nota</span>
                              <span className="font-mono font-semibold text-slate-900">
                                {formatBRL(req.invoiceNetTotal)}
                              </span>
                            </div>
                          </div>

                          {req.divergenceReasons.length > 0 && (
                            <ul className="list-disc pl-4 text-amber-900 space-y-0.5">
                              {req.divergenceReasons.map((reason, idx) => (
                                <li key={idx}>{reason}</li>
                              ))}
                            </ul>
                          )}

                          {req.divergentItems.length > 0 && (
                            <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                              <table className="w-full text-left border-collapse text-[11px]">
                                <thead>
                                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                                    <th className="py-1.5 px-2.5">Item (Nota / Pedido)</th>
                                    <th className="py-1.5 px-2.5 text-right">Qtd Ped × NF</th>
                                    <th className="py-1.5 px-2.5 text-right">Unit. Ped × NF</th>
                                    <th className="py-1.5 px-2.5">Divergência</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 tabular-nums">
                                  {req.divergentItems.map((it, idx) => (
                                    <tr key={idx}>
                                      <td className="py-1.5 px-2.5 text-slate-800">
                                        {it.invoiceItemDescription}
                                        {it.poItemDescription &&
                                          it.poItemDescription !== it.invoiceItemDescription && (
                                            <span className="block text-slate-500">
                                              PO: {it.poItemDescription}
                                            </span>
                                          )}
                                      </td>
                                      <td className="py-1.5 px-2.5 text-right font-mono">
                                        {it.poQty ?? '—'} × {it.invoiceQty ?? '—'}
                                      </td>
                                      <td className="py-1.5 px-2.5 text-right font-mono">
                                        {it.poUnitPrice !== null ? formatBRL(it.poUnitPrice) : '—'} ×{' '}
                                        {it.invoiceUnitPrice !== null
                                          ? formatBRL(it.invoiceUnitPrice)
                                          : '—'}
                                      </td>
                                      <td className="py-1.5 px-2.5 text-amber-800">{it.reason}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {req.fiscalObservation && (
                            <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-slate-700">
                              <span className="font-semibold text-slate-900">Obs. Fiscal:</span>{' '}
                              {req.fiscalObservation}
                            </div>
                          )}

                          {req.comprasResponse && (
                            <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-900">
                              <span className="font-semibold">Última resposta Compras:</span>{' '}
                              {req.comprasResponse}
                            </div>
                          )}

                          {canEdit && isActiveReq && (
                            <div className="space-y-2 pt-2 border-t border-amber-200/70">
                              <textarea
                                rows={2}
                                maxLength={BLUEPRINT_LIMITS.MAX_NOTES}
                                value={adjustmentNotes[req.id] ?? req.comprasResponse ?? ''}
                                onChange={(e) =>
                                  setAdjustmentNotes((prev) => ({
                                    ...prev,
                                    [req.id]: e.target.value,
                                  }))
                                }
                                placeholder="Registre o parecer ou ajuste realizado no Pedido de Compra para retorno ao Fiscal..."
                                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                              />
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  disabled={respondingAdjId === req.id}
                                  onClick={() => void handleRespondAdjustment(req, 'Em análise')}
                                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                                >
                                  Iniciar análise
                                </button>
                                <button
                                  type="button"
                                  disabled={respondingAdjId === req.id}
                                  onClick={() => void handleRespondAdjustment(req, 'Ajustado')}
                                  className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg disabled:opacity-50 cursor-pointer"
                                >
                                  Marcar como ajustado
                                </button>
                                <button
                                  type="button"
                                  disabled={respondingAdjId === req.id}
                                  onClick={() =>
                                    void handleRespondAdjustment(
                                      req,
                                      'Devolvido para revisão fiscal'
                                    )
                                  }
                                  className="px-3 py-1.5 text-xs font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 rounded-lg disabled:opacity-50 cursor-pointer"
                                >
                                  Devolver para revisão fiscal
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!isAdmin &&
                fiscalInvoices.some((f) => f.purchaseOrderId === detailOrder.id) && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                    Exclusão bloqueada: solicite ao setor Fiscal a desvinculação da nota.
                  </div>
                )}
            </div>
          </div>
        </div>
      )}

      <DeleteAuthModal
        isOpen={Boolean(deleteTarget)}
        title="Excluir Pedido de Compra"
        description={
          deleteTarget ? (
            <>
              Confirma a exclusão definitiva do pedido{' '}
              <span className="font-mono font-semibold text-slate-900">
                {deleteTarget.poNumber}
              </span>{' '}
              ({deleteTarget.supplierName})?
            </>
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

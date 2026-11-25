import React, { useMemo, useState } from 'react';
import { Check, Pencil, Plus, Power, Search, Trash2, X } from 'lucide-react';
import { useP2P } from '../context/P2PContext';
import { BLUEPRINT_LIMITS, ProductEquivalence } from '../types/p2p';
import { formatFiscalActionError } from '../utils/fiscalCalculations';
import { isValidCnpj, maskCnpj } from '../utils/formatters';
import { StatusTag } from './StatusBadge';

interface FiscalEquivalencesModalProps {
  open: boolean;
  onClose: () => void;
  defaultSupplierCnpj?: string;
}

export function FiscalEquivalencesModal({
  open,
  onClose,
  defaultSupplierCnpj = '',
}: FiscalEquivalencesModalProps) {
  const {
    productEquivalences,
    canCreateInSector,
    canEditInSector,
    canDeleteInSector,
    upsertProductEquivalence,
    toggleProductEquivalence,
    deleteProductEquivalence,
  } = useP2P();

  const canCreate = canCreateInSector('fiscal');
  const canEdit = canEditInSector('fiscal');
  const canDelete = canDeleteInSector('fiscal');

  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [supplierCnpj, setSupplierCnpj] = useState(defaultSupplierCnpj ? maskCnpj(defaultSupplierCnpj) : '');
  const [supplierItemCode, setSupplierItemCode] = useState('');
  const [supplierDescription, setSupplierDescription] = useState('');
  const [internalCode, setInternalCode] = useState('');
  const [poDescription, setPoDescription] = useState('');
  const [invoiceUnit, setInvoiceUnit] = useState('UN');
  const [poUnit, setPoUnit] = useState('UN');
  const [conversionFactor, setConversionFactor] = useState<number>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return productEquivalences;
    return productEquivalences.filter(
      (eq) =>
        eq.supplierCnpj.toLowerCase().includes(q) ||
        eq.supplierItemCode.toLowerCase().includes(q) ||
        eq.supplierDescription.toLowerCase().includes(q) ||
        eq.internalCode.toLowerCase().includes(q) ||
        eq.poDescription.toLowerCase().includes(q)
    );
  }, [productEquivalences, search]);

  if (!open) return null;

  const resetForm = () => {
    setEditingId(null);
    setSupplierCnpj(defaultSupplierCnpj ? maskCnpj(defaultSupplierCnpj) : '');
    setSupplierItemCode('');
    setSupplierDescription('');
    setInternalCode('');
    setPoDescription('');
    setInvoiceUnit('UN');
    setPoUnit('UN');
    setConversionFactor(1);
    setError(null);
  };

  const openNew = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (eq: ProductEquivalence) => {
    setEditingId(eq.id);
    setSupplierCnpj(maskCnpj(eq.supplierCnpj));
    setSupplierItemCode(eq.supplierItemCode);
    setSupplierDescription(eq.supplierDescription);
    setInternalCode(eq.internalCode);
    setPoDescription(eq.poDescription);
    setInvoiceUnit(eq.invoiceUnit || 'UN');
    setPoUnit(eq.poUnit || 'UN');
    setConversionFactor(eq.conversionFactor > 0 ? eq.conversionFactor : 1);
    setError(null);
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValidCnpj(supplierCnpj)) {
      setError('Informe um CNPJ de fornecedor válido (14 dígitos).');
      return;
    }
    if (!supplierDescription.trim() || !poDescription.trim()) {
      setError('Informe a descrição do item na Nota e a descrição equivalente no Pedido.');
      return;
    }
    if (!(conversionFactor > 0)) {
      setError('O fator de conversão deve ser maior que zero.');
      return;
    }
    setSaving(true);
    try {
      await upsertProductEquivalence({
        id: editingId || undefined,
        supplierCnpj: maskCnpj(supplierCnpj),
        supplierItemCode: supplierItemCode.trim(),
        supplierDescription: supplierDescription.trim(),
        internalCode: internalCode.trim(),
        poDescription: poDescription.trim(),
        invoiceUnit: invoiceUnit.trim().toUpperCase() || 'UN',
        poUnit: poUnit.trim().toUpperCase() || 'UN',
        conversionFactor: Number(conversionFactor),
        active: true,
      });
      setFormOpen(false);
      resetForm();
    } catch (err) {
      setError(formatFiscalActionError(err, 'Não foi possível salvar a equivalência.'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (eq: ProductEquivalence) => {
    setError(null);
    try {
      await toggleProductEquivalence(eq.id, !eq.active);
    } catch (err) {
      setError(formatFiscalActionError(err, 'Falha ao atualizar status da equivalência.'));
    }
  };

  const handleDelete = async (eq: ProductEquivalence) => {
    setError(null);
    try {
      await deleteProductEquivalence(eq.id);
    } catch (err) {
      setError(formatFiscalActionError(err, 'Falha ao excluir equivalência.'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Equivalências de Produtos por Fornecedor
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              De-para cadastrado para conciliar automaticamente descrições e fatores de conversão (ex: 1 CX = 10 UN) por CNPJ.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por CNPJ, código ou descrição..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>

            {canCreate && !formOpen && (
              <button
                type="button"
                onClick={openNew}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Nova Equivalência
              </button>
            )}
          </div>

          {formOpen && (
            <form
              onSubmit={handleSubmit}
              className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">
                  {editingId ? 'Editar Equivalência' : 'Cadastrar Nova Equivalência'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFormOpen(false);
                    resetForm();
                  }}
                  className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  Fechar
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    CNPJ do Fornecedor *
                  </label>
                  <input
                    type="text"
                    required
                    value={supplierCnpj}
                    onChange={(e) => setSupplierCnpj(maskCnpj(e.target.value))}
                    placeholder="00.000.000/0000-00"
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-md bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Cód. Item no Fornecedor (NF)
                  </label>
                  <input
                    type="text"
                    maxLength={40}
                    value={supplierItemCode}
                    onChange={(e) => setSupplierItemCode(e.target.value)}
                    placeholder="Ex: FORN-092"
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-md bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Cód. Interno (Pedido)
                  </label>
                  <input
                    type="text"
                    maxLength={40}
                    value={internalCode}
                    onChange={(e) => setInternalCode(e.target.value)}
                    placeholder="Ex: MAT-100"
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-md bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Descrição na Nota Fiscal *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={BLUEPRINT_LIMITS.MAX_ITEM_DESC}
                    value={supplierDescription}
                    onChange={(e) => setSupplierDescription(e.target.value)}
                    placeholder="Como vem descrito no XML do fornecedor"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Descrição no Pedido de Compra *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={BLUEPRINT_LIMITS.MAX_ITEM_DESC}
                    value={poDescription}
                    onChange={(e) => setPoDescription(e.target.value)}
                    placeholder="Como está cadastrado no Pedido"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Unidade na NF *</label>
                  <input
                    type="text"
                    required
                    maxLength={12}
                    value={invoiceUnit}
                    onChange={(e) => setInvoiceUnit(e.target.value)}
                    placeholder="CX"
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-md bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Unidade no Pedido *</label>
                  <input
                    type="text"
                    required
                    maxLength={12}
                    value={poUnit}
                    onChange={(e) => setPoUnit(e.target.value)}
                    placeholder="UN"
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-md bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Fator Conversão (1 NF = X Ped) *
                  </label>
                  <input
                    type="number"
                    required
                    min={0.0001}
                    step="any"
                    value={conversionFactor}
                    onChange={(e) => setConversionFactor(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-md bg-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setFormOpen(false);
                    resetForm();
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  {saving ? 'Salvando...' : 'Salvar Equivalência'}
                </button>
              </div>
            </form>
          )}

          <div className="border border-slate-200 rounded-lg overflow-hidden">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Nenhuma equivalência encontrada. Você pode cadastrar acima ou salvar diretamente ao vincular um item na conciliação.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <th className="py-2.5 px-3">CNPJ Fornecedor</th>
                      <th className="py-2.5 px-3">Item no Fornecedor (NF)</th>
                      <th className="py-2.5 px-3">Item no Pedido (Interno)</th>
                      <th className="py-2.5 px-3 text-center">Conversão</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((eq) => (
                      <tr key={eq.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-700">
                          {eq.supplierCnpj}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-900">{eq.supplierDescription}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {eq.supplierItemCode || 'Sem código'} · {eq.invoiceUnit}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-900">{eq.poDescription}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {eq.internalCode || 'Sem código'} · {eq.poUnit}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono whitespace-nowrap text-slate-800">
                          1 {eq.invoiceUnit} = {eq.conversionFactor} {eq.poUnit}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <StatusTag
                            label={eq.active ? 'Ativa' : 'Inativa'}
                            tone={eq.active ? 'success' : 'neutral'}
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {canEdit && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleToggle(eq)}
                                  title={eq.active ? 'Desativar' : 'Reativar'}
                                  className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded cursor-pointer"
                                >
                                  <Power className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEdit(eq)}
                                  title="Editar equivalência"
                                  className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => void handleDelete(eq)}
                                title="Excluir equivalência"
                                className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
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
    </div>
  );
}

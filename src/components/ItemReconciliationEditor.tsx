import React, { useState } from 'react';
import { BookmarkPlus, Check, Link2, Sparkles, Unlink2 } from 'lucide-react';
import {
  FiscalInvoiceItem,
  FiscalItemAssociation,
  PurchaseOrderItem,
} from '../types/p2p';
import { formatBRL } from '../utils/formatters';
import { ItemMatchSuggestion } from '../utils/itemReconciliation';
import { StatusTag } from './StatusBadge';

export interface EquivalenceDraftInput {
  supplierCnpj: string;
  supplierItemCode: string;
  supplierDescription: string;
  internalCode: string;
  poDescription: string;
  poUnit: string;
  invoiceUnit: string;
  conversionFactor: number;
}

interface ItemReconciliationEditorProps {
  supplierCnpj: string;
  invoiceItems: FiscalInvoiceItem[];
  poItems: PurchaseOrderItem[];
  associations: FiscalItemAssociation[];
  suggestions: ItemMatchSuggestion[];
  unmatchedInvoiceItemIndexes: number[];
  unmatchedPoItemIndexes: number[];
  canEdit: boolean;
  onChangeAssociations: (next: FiscalItemAssociation[]) => void;
  onSaveEquivalence?: (eq: EquivalenceDraftInput) => Promise<void> | void;
  saveEquivalenceLabel?: string;
}

export function ItemReconciliationEditor({
  supplierCnpj,
  invoiceItems,
  poItems,
  associations,
  suggestions,
  unmatchedInvoiceItemIndexes,
  unmatchedPoItemIndexes,
  canEdit,
  onChangeAssociations,
  onSaveEquivalence,
  saveEquivalenceLabel = 'Salvar equivalência p/ fornecedor',
}: ItemReconciliationEditorProps) {
  const [selectedInvIndexes, setSelectedInvIndexes] = useState<number[]>([]);
  const [selectedPoIndexes, setSelectedPoIndexes] = useState<number[]>([]);
  const [conversionFactor, setConversionFactor] = useState<number>(1);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [savedAssocFeedback, setSavedAssocFeedback] = useState<string | null>(null);

  if (invoiceItems.length === 0 || poItems.length === 0) return null;

  const removeConflictingAssociations = (
    list: FiscalItemAssociation[],
    invIdxs: number[],
    poIdxs: number[]
  ) => {
    const invSet = new Set(invIdxs);
    const poSet = new Set(poIdxs);
    return list.filter(
      (a) =>
        !a.invoiceItemIndexes.some((i) => invSet.has(i)) &&
        !a.poItemIndexes.some((i) => poSet.has(i))
    );
  };

  const handleQuickPair = (invIdx: number, poIdx: number, factor = 1) => {
    if (!canEdit) return;
    const cleaned = removeConflictingAssociations(associations, [invIdx], [poIdx]);
    const nextAssoc: FiscalItemAssociation = {
      id: `manual_${invIdx}_${poIdx}_${Date.now()}`,
      invoiceItemIndexes: [invIdx],
      poItemIndexes: [poIdx],
      conversionFactor: factor > 0 ? factor : 1,
      origin: 'manual',
    };
    onChangeAssociations([...cleaned, nextAssoc]);
  };

  const handleAcceptSuggestion = (sug: ItemMatchSuggestion) => {
    handleQuickPair(
      sug.invoiceItemIndex,
      sug.poItemIndex,
      sug.suggestedConversionFactor || 1
    );
  };

  const handleUpdateFactor = (assocId: string, nextFactor: number) => {
    if (!canEdit) return;
    const valid = nextFactor > 0 ? nextFactor : 1;
    onChangeAssociations(
      associations.map((a) =>
        a.id === assocId ? { ...a, conversionFactor: valid, origin: 'manual' } : a
      )
    );
  };

  const handleRemoveAssoc = (assocId: string) => {
    if (!canEdit) return;
    onChangeAssociations(associations.filter((a) => a.id !== assocId));
  };

  const handleCreateCustomAssociation = () => {
    if (!canEdit || selectedInvIndexes.length === 0 || selectedPoIndexes.length === 0) return;
    const cleaned = removeConflictingAssociations(
      associations,
      selectedInvIndexes,
      selectedPoIndexes
    );
    const nextAssoc: FiscalItemAssociation = {
      id: `manual_grp_${Date.now()}`,
      invoiceItemIndexes: [...selectedInvIndexes].sort((a, b) => a - b),
      poItemIndexes: [...selectedPoIndexes].sort((a, b) => a - b),
      conversionFactor: conversionFactor > 0 ? Number(conversionFactor) : 1,
      origin: 'manual',
    };
    onChangeAssociations([...cleaned, nextAssoc]);
    setSelectedInvIndexes([]);
    setSelectedPoIndexes([]);
    setConversionFactor(1);
    setBuilderOpen(false);
  };

  const handleSaveEquivalenceFromAssoc = async (assoc: FiscalItemAssociation) => {
    if (!onSaveEquivalence || assoc.invoiceItemIndexes.length !== 1 || assoc.poItemIndexes.length !== 1) {
      return;
    }
    const invItem = invoiceItems[assoc.invoiceItemIndexes[0]];
    const poItem = poItems[assoc.poItemIndexes[0]];
    if (!invItem || !poItem) return;

    await onSaveEquivalence({
      supplierCnpj,
      supplierItemCode: invItem.code || '',
      supplierDescription: invItem.description,
      internalCode: poItem.code || '',
      poDescription: poItem.description,
      invoiceUnit: invItem.unit || 'UN',
      poUnit: poItem.unit || 'UN',
      conversionFactor: assoc.conversionFactor > 0 ? assoc.conversionFactor : 1,
    });
    setSavedAssocFeedback(assoc.id);
    setTimeout(() => setSavedAssocFeedback(null), 2200);
  };

  const toggleIndex = (list: number[], idx: number, setter: (v: number[]) => void) => {
    setter(list.includes(idx) ? list.filter((i) => i !== idx) : [...list, idx]);
  };

  return (
    <div className="border border-slate-200 rounded-lg bg-white p-3.5 space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold text-slate-800 block">
            Conciliação Manual Item a Item (Nota × Pedido)
          </span>
          <span className="text-[11px] text-slate-500">
            Vincule itens com descrições diferentes (1:1, 1:N kits/desmembramentos ou N:1) e defina fator de conversão se as unidades diferirem.
          </span>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setBuilderOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer whitespace-nowrap"
          >
            <Link2 className="w-3.5 h-3.5" />
            {builderOpen ? 'Fechar Agrupador 1:N / N:1' : 'Agrupar / Converter (1:N · N:1)'}
          </button>
        )}
      </div>

      {/* Sugestões inteligentes pendentes de confirmação */}
      {canEdit && suggestions.length > 0 && (
        <div className="p-2.5 rounded-md bg-amber-50/70 border border-amber-200 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-900">
            <Sparkles className="w-3.5 h-3.5 text-amber-700" />
            Sugestões encontradas (aguardando sua confirmação):
          </div>
          <div className="space-y-1.5">
            {suggestions.map((sug, idx) => {
              const invIt = invoiceItems[sug.invoiceItemIndex];
              const poIt = poItems[sug.poItemIndex];
              if (!invIt || !poIt) return null;
              return (
                <div
                  key={idx}
                  className="flex flex-wrap items-center justify-between gap-2 bg-white px-2.5 py-1.5 rounded border border-amber-200/80"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-slate-900">{invIt.description}</span>
                    <span className="text-slate-400 mx-1.5">→</span>
                    <span className="font-medium text-blue-900">{poIt.description}</span>
                    <span className="text-[11px] text-slate-500 ml-2">
                      ({Math.round(sug.score * 100)}% · {sug.reason})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAcceptSuggestion(sug)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded cursor-pointer whitespace-nowrap"
                  >
                    <Check className="w-3 h-3" />
                    Aceitar sugestão
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Vínculo rápido inline 1:1 para cada item da Nota ainda sem vínculo */}
      {canEdit && unmatchedInvoiceItemIndexes.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-slate-700">
            Itens da Nota aguardando conciliação manual ({unmatchedInvoiceItemIndexes.length}):
          </div>
          <div className="space-y-1.5">
            {unmatchedInvoiceItemIndexes.map((invIdx) => {
              const invIt = invoiceItems[invIdx];
              if (!invIt) return null;
              return (
                <div
                  key={invIdx}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-md bg-slate-50 border border-slate-200"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900 truncate" title={invIt.description}>
                      {invIt.description}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      Cód: {invIt.code || '—'} · Qtd: {invIt.qty} {invIt.unit} · Unit:{' '}
                      {formatBRL(invIt.unitPrice)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value=""
                      onChange={(e) => {
                        const poIdx = Number(e.target.value);
                        if (!Number.isNaN(poIdx)) {
                          handleQuickPair(invIdx, poIdx, 1);
                        }
                      }}
                      className="w-64 px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-800"
                    >
                      <option value="">Selecionar item do Pedido...</option>
                      {poItems.map((poIt, poIdx) => {
                        const isFree = unmatchedPoItemIndexes.includes(poIdx);
                        return (
                          <option key={poIdx} value={poIdx}>
                            {isFree ? '' : '[Em uso] '}
                            {poIt.description} ({poIt.qtyOrdered} {poIt.unit} · {formatBRL(poIt.unitPrice)})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Construtor avançado 1:N / N:1 + fator de conversão */}
      {canEdit && builderOpen && (
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-300 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-slate-700 block">
                1. Selecione 1 ou mais itens da Nota Fiscal:
              </span>
              <div className="max-h-36 overflow-y-auto space-y-1 bg-white p-2 rounded border border-slate-200">
                {invoiceItems.map((it, idx) => (
                  <label
                    key={idx}
                    className="flex items-start gap-2 text-[11px] cursor-pointer hover:bg-slate-50 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedInvIndexes.includes(idx)}
                      onChange={() =>
                        toggleIndex(selectedInvIndexes, idx, setSelectedInvIndexes)
                      }
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-slate-800 block truncate">
                        {it.description}
                      </span>
                      <span className="font-mono text-slate-500">
                        {it.qty} {it.unit} · {formatBRL(it.unitPrice)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-slate-700 block">
                2. Selecione 1 ou mais itens do Pedido:
              </span>
              <div className="max-h-36 overflow-y-auto space-y-1 bg-white p-2 rounded border border-slate-200">
                {poItems.map((it, idx) => (
                  <label
                    key={idx}
                    className="flex items-start gap-2 text-[11px] cursor-pointer hover:bg-slate-50 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPoIndexes.includes(idx)}
                      onChange={() =>
                        toggleIndex(selectedPoIndexes, idx, setSelectedPoIndexes)
                      }
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-slate-800 block truncate">
                        {it.description}
                      </span>
                      <span className="font-mono text-slate-500">
                        {it.qtyOrdered} {it.unit} · {formatBRL(it.unitPrice)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Fator de Conversão (1 unid. NF = X unid. Pedido)
              </label>
              <input
                type="number"
                min={0.0001}
                step="any"
                value={conversionFactor}
                onChange={(e) => setConversionFactor(Number(e.target.value))}
                className="w-36 px-2.5 py-1.5 font-mono text-xs border border-slate-300 rounded bg-white"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBuilderOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 bg-white border border-slate-300 rounded-md cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={selectedInvIndexes.length === 0 || selectedPoIndexes.length === 0}
                onClick={handleCreateCustomAssociation}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50 cursor-pointer"
              >
                <Link2 className="w-3.5 h-3.5" />
                Vincular Selecionados
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vínculos ativos */}
      {associations.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-semibold text-slate-700 block">
            Vínculos ativos de itens ({associations.length}):
          </span>
          <div className="space-y-1.5">
            {associations.map((assoc) => {
              const invDesc = assoc.invoiceItemIndexes
                .map((i) => invoiceItems[i]?.description)
                .filter(Boolean)
                .join(' + ');
              const poDesc = assoc.poItemIndexes
                .map((i) => poItems[i]?.description)
                .filter(Boolean)
                .join(' + ');
              const canSaveEq =
                Boolean(onSaveEquivalence) &&
                assoc.invoiceItemIndexes.length === 1 &&
                assoc.poItemIndexes.length === 1 &&
                Boolean(supplierCnpj);
              return (
                <div
                  key={assoc.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 rounded-md bg-slate-50 border border-slate-200"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusTag
                        label={
                          assoc.origin === 'manual'
                            ? 'Manual'
                            : assoc.origin === 'equivalence'
                            ? 'Equivalência'
                            : 'Automático'
                        }
                        tone={
                          assoc.origin === 'manual'
                            ? 'info'
                            : assoc.origin === 'equivalence'
                            ? 'success'
                            : 'neutral'
                        }
                      />
                      <span className="font-medium text-slate-900 truncate">{invDesc}</span>
                      <span className="text-slate-400">↔</span>
                      <span className="font-medium text-blue-900 truncate">{poDesc}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-slate-500">Fator:</span>
                      <input
                        type="number"
                        min={0.0001}
                        step="any"
                        disabled={!canEdit}
                        value={assoc.conversionFactor || 1}
                        onChange={(e) => handleUpdateFactor(assoc.id, Number(e.target.value))}
                        className="w-16 px-1.5 py-1 text-[11px] font-mono border border-slate-300 rounded bg-white disabled:bg-slate-100"
                      />
                    </div>
                    {canEdit && canSaveEq && (
                      <button
                        type="button"
                        onClick={() => void handleSaveEquivalenceFromAssoc(assoc)}
                        title={saveEquivalenceLabel}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded cursor-pointer"
                      >
                        <BookmarkPlus className="w-3 h-3" />
                        {savedAssocFeedback === assoc.id ? 'Salva!' : saveEquivalenceLabel}
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleRemoveAssoc(assoc.id)}
                        title="Remover vínculo do item"
                        className="p-1 text-slate-400 hover:text-red-700 rounded cursor-pointer"
                      >
                        <Unlink2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

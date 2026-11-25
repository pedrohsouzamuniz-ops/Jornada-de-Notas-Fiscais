import * as XLSX from 'xlsx';
import { FiscalInvoice, SERVICE_TAX_REGIME_LABELS } from '../types/p2p';
import { getEffectiveRetainedTaxes } from './fiscalCalculations';
import { formatDateBR, todayISO } from './formatters';

function getFiscalStatusText(status: FiscalInvoice['fiscalStatus']): string {
  switch (status) {
    case 'aguardando_recebimento':
      return 'Aguardando Recebimento';
    case 'pendente':
    case 'aguardando_escrituracao':
      return 'Pendente';
    case 'lancado':
    case 'escriturada':
      return 'Lançado';
    case 'substituida':
      return 'Substituída';
    case 'rejeitada':
      return 'Rejeitada';
    default:
      return status;
  }
}

function getConferenceLabel(inv: FiscalInvoice): string {
  if (inv.conferenceStatus === 'conferido') return 'Conferido';
  if (inv.pendingAdjustmentId && !inv.purchaseOrderId) return 'Aguardando ajuste de Compras';
  if (!inv.purchaseOrderId) return 'Aguardando Vinculação';
  if (inv.matchingStatus === 'conciliada') return 'Sem divergência';
  if (inv.matchingStatus === 'divergente') return 'Divergente';
  return 'Pendente';
}

export function exportFiscalInvoicesToExcel(
  invoices: FiscalInvoice[],
  companyUf = 'AM'
): void {
  const rows = invoices.map((inv) => {
    const retainedEffective = getEffectiveRetainedTaxes({
      docType: inv.docType || 'NFE',
      totalProducts: inv.totalProducts,
      freightAmount: inv.freightAmount,
      insuranceAmount: inv.insuranceAmount,
      otherExpensesAmount: inv.otherExpensesAmount,
      surchargeAmount: inv.surchargeAmount,
      ipiAmount: inv.ipiAmount,
      icmsStAmount: inv.icmsStAmount,
      discountAmount: inv.discountAmount,
      retainedTaxesAmount: inv.retainedTaxesAmount,
      taxRegime: inv.taxRegime || '',
      pisAmount: inv.pisAmount,
      cofinsAmount: inv.cofinsAmount,
      csllAmount: inv.csllAmount,
      issqnAmount: inv.issqnAmount,
      issqnRetained: inv.issqnRetained,
      inssAmount: inv.inssAmount,
      irrfAmount: inv.irrfAmount,
    });

    const isSuframaEligible =
      inv.docType === 'NFE' && Boolean(inv.issuerState) && inv.issuerState !== companyUf;

    return {
      Tipo: inv.docType || 'NFE',
      Número: inv.nfeNumber,
      Série: inv.series || '-',
      'Chave de Acesso': inv.accessKey,
      Emitente: inv.issuerName,
      CNPJ: inv.issuerCnpj,
      'UF Emitente': inv.issuerState || '-',
      'Data Emissão': formatDateBR(inv.issueDate),
      CFOP: inv.cfop,
      'Regime Tributário': inv.taxRegime
        ? SERVICE_TAX_REGIME_LABELS[inv.taxRegime]
        : inv.docType === 'NFSE'
        ? 'Não informado'
        : 'N/A',
      'Pedido de Compra (Real)': inv.poNumber || 'Sem Pedido',
      'Recebimento Físico': inv.receiptNumber || (inv.requiresPhysicalReceipt === false ? 'Dispensado' : 'Pendente'),
      'Passa pelo Recebimento Físico': inv.requiresPhysicalReceipt === false ? 'Não' : 'Sim',
      'Valor Bruto / Produtos (R$)': Number((inv.grossAmount ?? inv.totalProducts ?? 0).toFixed(2)),
      'Frete (R$)': Number((inv.freightAmount || 0).toFixed(2)),
      'Seguro (R$)': Number((inv.insuranceAmount || 0).toFixed(2)),
      'Outras Despesas (R$)': Number((inv.otherExpensesAmount || 0).toFixed(2)),
      'Acréscimos (R$)': Number((inv.surchargeAmount || 0).toFixed(2)),
      'Descontos (R$)': Number((inv.discountAmount || 0).toFixed(2)),
      'ICMS (R$)': Number((inv.icmsAmount || 0).toFixed(2)),
      'ICMS Desonerado (R$)': Number((inv.icmsDesonAmount || 0).toFixed(2)),
      'ICMS ST (R$)': Number((inv.icmsStAmount || 0).toFixed(2)),
      'IPI (R$)': Number((inv.ipiAmount || 0).toFixed(2)),
      'PIS (R$)': Number((inv.pisAmount || 0).toFixed(2)),
      'COFINS (R$)': Number((inv.cofinsAmount || 0).toFixed(2)),
      'CSLL (R$)': Number((inv.csllAmount || 0).toFixed(2)),
      'ISSQN (R$)': Number((inv.issqnAmount || 0).toFixed(2)),
      'ISSQN Retido?': inv.issqnAmount ? (inv.issqnRetained === false ? 'Não (Destacado)' : 'Sim') : 'N/A',
      'INSS (R$)': Number((inv.inssAmount || 0).toFixed(2)),
      'IRRF (R$)': Number((inv.irrfAmount || 0).toFixed(2)),
      'Outras Retenções (R$)': Number((inv.retainedTaxesAmount || 0).toFixed(2)),
      'Total Retenções Efetivas (R$)': Number(retainedEffective.toFixed(2)),
      'Valor Líquido (R$)': Number((inv.totalInvoice || 0).toFixed(2)),
      'Total Informado no XML (R$)':
        typeof inv.xmlDeclaredTotal === 'number' ? Number(inv.xmlDeclaredTotal.toFixed(2)) : '',
      'Status Fiscal': getFiscalStatusText(inv.fiscalStatus),
      Conferência: getConferenceLabel(inv),
      'Conferido Por': inv.conferenceConfirmedByName || '',
      'Data Conferência': inv.conferenceConfirmedAt ? formatDateBR(inv.conferenceConfirmedAt.slice(0, 10)) : '',
      'Justificativa Conferência': inv.conferenceJustification || '',
      'Solicitação Ajuste Compras': inv.adjustmentStatus || '',
      'Pedido Ref. Ajuste': inv.pendingAdjustmentPoNumber || '',
      'Data Lançamento': inv.bookkeepingDate ? formatDateBR(inv.bookkeepingDate) : '',
      'NF Substituta': inv.replacedByInvoiceNumber || '',
      'NF Referenciada (CT-e)': inv.linkedInvoiceNumber || '',
      'Origem (CT-e)': inv.originState ? `${inv.originCity || ''} / ${inv.originState}`.trim() : '',
      'Destino (CT-e)': inv.destinationState ? `${inv.destinationCity || ''} / ${inv.destinationState}`.trim() : '',
      'SUFRAMA Aplicável': isSuframaEligible ? 'Sim' : 'Não',
      'PIN SUFRAMA': inv.suframaPinNumber || '',
      'Data Aceite PIN': inv.suframaPinAcceptanceDate ? formatDateBR(inv.suframaPinAcceptanceDate) : '',
      'Data Recebimento PIN': inv.suframaPinReceiptDate ? formatDateBR(inv.suframaPinReceiptDate) : '',
      'Data Desembaraço SUFRAMA': inv.suframaClearanceDate ? formatDateBR(inv.suframaClearanceDate) : '',
      'Importado via XML': inv.xmlImported ? 'Sim' : 'Não',
      Observações: inv.notes || '',
      'Informações Complementares': inv.complementaryInfo || '',
      'Cadastrado Por': inv.createdByName || '',
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Documentos Fiscais');

  const fileName = `controle_fiscal_documentos_${todayISO()}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}

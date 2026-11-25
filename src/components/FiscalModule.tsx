import React, { useEffect, useMemo, useRef, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AlertTriangle,
  BookmarkCheck,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Layers,
  Link2Off,
  Lock,
  MessageSquareWarning,
  Plus,
  Printer,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useP2P } from '../context/P2PContext';
import {
  BLUEPRINT_LIMITS,
  FiscalDocType,
  FiscalInvoice,
  FiscalInvoiceItem,
  FiscalItemAssociation,
  FiscalStatus,
  ProductEquivalence,
  SERVICE_TAX_REGIME_LABELS,
  ServiceTaxRegime,
} from '../types/p2p';
import {
  BRAZIL_STATES,
  fetchCitiesByUf,
  getFallbackCitiesForUf,
  getUfFromCodeOrAccessKey,
} from '../utils/brazilLocations';
import { exportFiscalInvoicesToExcel } from '../utils/excelExport';
import {
  buildConferenceFingerprint,
  calculateFiscalNetTotal,
  formatFiscalActionError,
} from '../utils/fiscalCalculations';
import {
  formatAccessKeyShort,
  formatBRL,
  formatDateBR,
  isValidCnpj,
  maskCnpj,
  normalizeCnpjDigits,
  todayISO,
} from '../utils/formatters';
import {
  ThreeWayMatchDetails,
  evaluatePreImportMatch,
  evaluateThreeWayMatch,
  getPoReceptionSummary,
} from '../utils/matching';
import {
  ParsedFiscalXml,
  buildSampleCTeXml,
  buildSampleNFeXml,
  buildSampleNFSeXml,
  parseFiscalXml,
} from '../utils/nfeXmlParser';
import { DeleteAuthModal } from './DeleteAuthModal';
import { FiscalEquivalencesModal } from './FiscalEquivalencesModal';
import { EquivalenceDraftInput, ItemReconciliationEditor } from './ItemReconciliationEditor';
import { StatusTag } from './StatusBadge';

interface BatchXmlItem {
  id: string;
  fileName: string;
  parsed?: ParsedFiscalXml;
  error?: string;
  duplicate?: boolean;
  requiresPhysicalReceipt: boolean;
  initialFiscalStatus: 'aguardando_recebimento' | 'pendente';
  isPartialBilling: boolean;
  purchaseOrderId: string;
  receiptId: string;
  linkedInvoiceId: string;
  notes: string;
  itemAssociations?: FiscalItemAssociation[];
  pendingEquivalences?: EquivalenceDraftInput[];
  conferenceConfirmed?: boolean;
  conferenceJustification?: string;
  notifyCompras?: boolean;
  adjustmentObservation?: string;
}

const DOC_TYPE_LABELS: Record<FiscalDocType, string> = {
  NFE: 'NF-e',
  NFSE: 'NFS-e',
  CTE: 'CT-e',
};

export function FiscalModule() {
  const {
    userProfile,
    purchaseOrders,
    physicalReceipts,
    fiscalInvoices,
    productEquivalences,
    adjustmentRequests,
    canAccessSectorData,
    canCreateInSector,
    canEditInSector,
    canDeleteInSector,
    isAdmin,
    deletionPasswordConfigured,
    createFiscalInvoicesBatch,
    updateFiscalInvoice,
    confirmInvoiceConference,
    upsertProductEquivalence,
    createAdjustmentRequest,
    updateAdjustmentRequestAsFiscal,
    unlinkFiscalInvoice,
    deleteFiscalInvoice,
    dataLoading,
  } = useP2P();

  const canRead = canAccessSectorData('fiscal');
  const canCreate = canCreateInSector('fiscal');
  const canEdit = canEditInSector('fiscal');
  const canDelete = canDeleteInSector('fiscal');

  const [subTab, setSubTab] = useState<'controle' | 'importar'>('controle');
  const [search, setSearch] = useState('');
  const [fiscalFilter, setFiscalFilter] = useState<
    'todos' | FiscalStatus | 'aguardando_ajuste'
  >('todos');
  const [competenceFilter, setCompetenceFilter] = useState('');
  const [bookingDateFilter, setBookingDateFilter] = useState('');
  const [interstateFilter, setInterstateFilter] = useState<'todos' | 'fora' | 'pin_pendente'>('todos');
  const [companyUf, setCompanyUf] = useState<string>(() => {
    if (typeof window === 'undefined') return 'AM';
    return localStorage.getItem('p2p_company_uf') || 'AM';
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [equivalencesModalOpen, setEquivalencesModalOpen] = useState(false);

  // Print Report Modal state
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportStep, setReportStep] = useState<'config' | 'sheet'>('config');
  const [reportType, setReportType] = useState<'pendentes' | 'lancadas'>('pendentes');
  const [reportBookingDate, setReportBookingDate] = useState<string>(todayISO());
  const [reportAllLaunchDates, setReportAllLaunchDates] = useState<boolean>(false);
  const [reportCompetence, setReportCompetence] = useState<string>('');
  const [printNotice, setPrintNotice] = useState<string | null>(null);

  // Batch / Individual XML Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [batchQueue, setBatchQueue] = useState<BatchXmlItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchSuccess, setBatchSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewBatchItemId, setPreviewBatchItemId] = useState<string | null>(null);

  // Reconciliation / Bookkeeping Ficha modal state
  const [activeInvoice, setActiveInvoice] = useState<FiscalInvoice | null>(null);
  const [linkPoId, setLinkPoId] = useState('');
  const [linkReceiptId, setLinkReceiptId] = useState('');
  const [editRequiresPhysicalReceipt, setEditRequiresPhysicalReceipt] = useState<boolean>(true);
  const [editIsPartialBilling, setEditIsPartialBilling] = useState<boolean>(false);
  const [editItemAssociations, setEditItemAssociations] = useState<FiscalItemAssociation[]>([]);
  const [confJustificationInput, setConfJustificationInput] = useState('');
  const [adjObservationInput, setAdjObservationInput] = useState('');
  const [fiscalResolutionNote, setFiscalResolutionNote] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editFiscalStatus, setEditFiscalStatus] =
    useState<FiscalStatus>('aguardando_recebimento');
  const [editBookkeepingDate, setEditBookkeepingDate] = useState('');
  const [replacedByInvoiceId, setReplacedByInvoiceId] = useState('');
  const [editTaxRegime, setEditTaxRegime] = useState<ServiceTaxRegime>('simples_nacional');
  const [editTotalProducts, setEditTotalProducts] = useState<number>(0);
  const [editFreightAmount, setEditFreightAmount] = useState<number>(0);
  const [editInsuranceAmount, setEditInsuranceAmount] = useState<number>(0);
  const [editOtherExpensesAmount, setEditOtherExpensesAmount] = useState<number>(0);
  const [editSurchargeAmount, setEditSurchargeAmount] = useState<number>(0);
  const [editDiscountAmount, setEditDiscountAmount] = useState<number>(0);
  const [editIcmsAmount, setEditIcmsAmount] = useState<number>(0);
  const [editIcmsDesonAmount, setEditIcmsDesonAmount] = useState<number>(0);
  const [editIcmsStAmount, setEditIcmsStAmount] = useState<number>(0);
  const [editIpiAmount, setEditIpiAmount] = useState<number>(0);
  const [editRetainedTaxesAmount, setEditRetainedTaxesAmount] = useState<number>(0);
  const [editPisAmount, setEditPisAmount] = useState<number>(0);
  const [editCofinsAmount, setEditCofinsAmount] = useState<number>(0);
  const [editCsllAmount, setEditCsllAmount] = useState<number>(0);
  const [editIssqnAmount, setEditIssqnAmount] = useState<number>(0);
  const [editIssqnRetained, setEditIssqnRetained] = useState<boolean>(true);
  const [editInssAmount, setEditInssAmount] = useState<number>(0);
  const [editIrrfAmount, setEditIrrfAmount] = useState<number>(0);
  const [editLinkedInvoiceId, setEditLinkedInvoiceId] = useState('');
  const [editOriginState, setEditOriginState] = useState('');
  const [editOriginCity, setEditOriginCity] = useState('');
  const [editDestinationState, setEditDestinationState] = useState('');
  const [editDestinationCity, setEditDestinationCity] = useState('');
  const [editIssuerState, setEditIssuerState] = useState('');
  const [editSuframaPinNumber, setEditSuframaPinNumber] = useState('');
  const [editSuframaPinAcceptanceDate, setEditSuframaPinAcceptanceDate] = useState('');
  const [editSuframaPinReceiptDate, setEditSuframaPinReceiptDate] = useState('');
  const [editSuframaClearanceDate, setEditSuframaClearanceDate] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalSuccess, setModalSuccess] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<FiscalInvoice | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<FiscalInvoice | null>(null);

  // Manual Fiscal Invoice Registration modal state
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualDocType, setManualDocType] = useState<FiscalDocType>('NFE');
  const [manualNfeNumber, setManualNfeNumber] = useState('');
  const [manualSeries, setManualSeries] = useState('1');
  const [manualIssueDate, setManualIssueDate] = useState(todayISO());
  const [manualAccessKey, setManualAccessKey] = useState('');
  const [manualIssuerName, setManualIssuerName] = useState('');
  const [manualIssuerCnpj, setManualIssuerCnpj] = useState('');
  const [manualPoId, setManualPoId] = useState('');
  const [manualRequiresPhysicalReceipt, setManualRequiresPhysicalReceipt] = useState<boolean>(true);
  const [manualIsPartialBilling, setManualIsPartialBilling] = useState<boolean>(false);
  const [manualNotifyCompras, setManualNotifyCompras] = useState<boolean>(false);
  const [manualAdjObservation, setManualAdjObservation] = useState('');
  const [manualFreightAmount, setManualFreightAmount] = useState<number>(0);
  const [manualInsuranceAmount, setManualInsuranceAmount] = useState<number>(0);
  const [manualOtherExpensesAmount, setManualOtherExpensesAmount] = useState<number>(0);
  const [manualSurchargeAmount, setManualSurchargeAmount] = useState<number>(0);
  const [manualDiscountAmount, setManualDiscountAmount] = useState<number>(0);
  const [manualIcmsAmount, setManualIcmsAmount] = useState<number>(0);
  const [manualIcmsDesonAmount, setManualIcmsDesonAmount] = useState<number>(0);
  const [manualIcmsStAmount, setManualIcmsStAmount] = useState<number>(0);
  const [manualIpiAmount, setManualIpiAmount] = useState<number>(0);
  const [manualRetainedTaxesAmount, setManualRetainedTaxesAmount] = useState<number>(0);
  const [manualPisAmount, setManualPisAmount] = useState<number>(0);
  const [manualCofinsAmount, setManualCofinsAmount] = useState<number>(0);
  const [manualCsllAmount, setManualCsllAmount] = useState<number>(0);
  const [manualIssqnAmount, setManualIssqnAmount] = useState<number>(0);
  const [manualIssqnRetained, setManualIssqnRetained] = useState<boolean>(true);
  const [manualInssAmount, setManualInssAmount] = useState<number>(0);
  const [manualIrrfAmount, setManualIrrfAmount] = useState<number>(0);
  const [manualTaxRegime, setManualTaxRegime] =
    useState<ServiceTaxRegime>('simples_nacional');
  const [manualLinkedInvoiceId, setManualLinkedInvoiceId] = useState('');
  const [manualOriginState, setManualOriginState] = useState('');
  const [manualOriginCity, setManualOriginCity] = useState('');
  const [manualDestinationState, setManualDestinationState] = useState('');
  const [manualDestinationCity, setManualDestinationCity] = useState('');
  const [manualIssuerState, setManualIssuerState] = useState('');
  const [manualSuframaPinNumber, setManualSuframaPinNumber] = useState('');
  const [manualSuframaPinAcceptanceDate, setManualSuframaPinAcceptanceDate] = useState('');
  const [manualSuframaPinReceiptDate, setManualSuframaPinReceiptDate] = useState('');
  const [manualSuframaClearanceDate, setManualSuframaClearanceDate] = useState('');
  const [manualComplementaryInfo, setManualComplementaryInfo] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualItems, setManualItems] = useState<FiscalInvoiceItem[]>([
    {
      code: 'ITEM-001',
      description: '',
      ncm: '',
      cfop: '0000',
      unit: 'UN',
      qty: 1,
      unitPrice: 0,
      totalPrice: 0,
    },
  ]);
  const [manualFormError, setManualFormError] = useState<string | null>(null);

  // Cache of IBGE cities per UF
  const [citiesByUf, setCitiesByUf] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const activeUfs = [
      manualOriginState,
      manualDestinationState,
      editOriginState,
      editDestinationState,
    ]
      .map((u) => (u || '').trim().toUpperCase())
      .filter((u) => u.length === 2);

    const uniqueUfs = Array.from(new Set(activeUfs));
    uniqueUfs.forEach((uf) => {
      if (citiesByUf[uf]) return;
      void fetchCitiesByUf(uf).then((cities) => {
        setCitiesByUf((prev) => (prev[uf] ? prev : { ...prev, [uf]: cities }));
      });
    });
  }, [
    manualOriginState,
    manualDestinationState,
    editOriginState,
    editDestinationState,
    citiesByUf,
  ]);

  const getCityOptions = (uf: string, currentCity: string): string[] => {
    const code = (uf || '').trim().toUpperCase();
    if (!code) return [];
    const base = citiesByUf[code] || getFallbackCitiesForUf(code);
    const trimmed = (currentCity || '').trim();
    if (!trimmed) return base;
    if (base.includes(trimmed)) return base;
    const withoutCaseDup = base.filter((c) => c.toLowerCase() !== trimmed.toLowerCase());
    return [trimmed, ...withoutCaseDup].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  };

  const linkableInvoicesForCte = useMemo(
    () =>
      fiscalInvoices.filter(
        (inv) =>
          inv.docType !== 'CTE' &&
          (inv.fiscalStatus !== 'rejeitada' || inv.id === activeInvoice?.linkedInvoiceId)
      ),
    [fiscalInvoices, activeInvoice]
  );

  const handleCompanyUfChange = (nextUf: string) => {
    const clean = nextUf.trim().toUpperCase();
    setCompanyUf(clean);
    if (typeof window !== 'undefined') {
      localStorage.setItem('p2p_company_uf', clean);
    }
  };

  const getEffectiveIssuerUf = (
    inv: Pick<FiscalInvoice, 'issuerState' | 'accessKey' | 'docType'>
  ): string => {
    const explicit = (inv.issuerState || '').trim().toUpperCase();
    if (explicit.length === 2) return explicit;
    if ((inv.docType || 'NFE') !== 'NFSE') {
      return getUfFromCodeOrAccessKey(inv.accessKey);
    }
    return '';
  };

  const isOutOfStateNfe = (
    inv: Pick<FiscalInvoice, 'issuerState' | 'accessKey' | 'docType'>
  ): boolean => {
    if ((inv.docType || 'NFE') !== 'NFE') return false;
    const uf = getEffectiveIssuerUf(inv);
    return Boolean(uf && companyUf && uf !== companyUf);
  };

  const hasPendingSuframa = (
    inv: Pick<
      FiscalInvoice,
      | 'issuerState'
      | 'accessKey'
      | 'docType'
      | 'suframaPinNumber'
      | 'suframaPinAcceptanceDate'
      | 'suframaPinReceiptDate'
      | 'suframaClearanceDate'
    >
  ): boolean => {
    if (!isOutOfStateNfe(inv)) return false;
    return !inv.suframaPinNumber?.trim() || !inv.suframaClearanceDate;
  };

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fiscalInvoices.filter((inv) => {
      if (fiscalFilter === 'aguardando_ajuste') {
        const hasActiveAdj = Boolean(
          inv.pendingAdjustmentId ||
            adjustmentRequests.some(
              (r) =>
                r.fiscalInvoiceId === inv.id &&
                r.status !== 'Resolvido' &&
                r.status !== 'Cancelado'
            )
        );
        if (!hasActiveAdj) return false;
      } else if (fiscalFilter !== 'todos') {
        if (fiscalFilter === 'pendente') {
          if (
            inv.fiscalStatus !== 'pendente' &&
            inv.fiscalStatus !== 'aguardando_escrituracao'
          ) {
            return false;
          }
        } else if (fiscalFilter === 'lancado') {
          if (inv.fiscalStatus !== 'lancado' && inv.fiscalStatus !== 'escriturada') {
            return false;
          }
        } else if (inv.fiscalStatus !== fiscalFilter) {
          return false;
        }
      }
      if (interstateFilter === 'fora' && !isOutOfStateNfe(inv)) {
        return false;
      }
      if (interstateFilter === 'pin_pendente' && !hasPendingSuframa(inv)) {
        return false;
      }
      if (competenceFilter && !inv.issueDate.startsWith(competenceFilter)) {
        return false;
      }
      if (bookingDateFilter && (inv.bookkeepingDate || '') !== bookingDateFilter) {
        return false;
      }
      if (!q) return true;
      const effectiveUf = getEffectiveIssuerUf(inv).toLowerCase();
      return (
        inv.nfeNumber.toLowerCase().includes(q) ||
        inv.accessKey.toLowerCase().includes(q) ||
        inv.issuerName.toLowerCase().includes(q) ||
        inv.issuerCnpj.toLowerCase().includes(q) ||
        inv.poNumber.toLowerCase().includes(q) ||
        (inv.docType || 'NFE').toLowerCase().includes(q) ||
        effectiveUf.includes(q) ||
        (inv.suframaPinNumber || '').toLowerCase().includes(q)
      );
    });
  }, [
    fiscalInvoices,
    adjustmentRequests,
    search,
    fiscalFilter,
    interstateFilter,
    competenceFilter,
    bookingDateFilter,
    companyUf,
  ]);

  const hasActiveFilters = Boolean(
    search.trim() ||
      fiscalFilter !== 'todos' ||
      interstateFilter !== 'todos' ||
      competenceFilter ||
      bookingDateFilter
  );

  const clearAllFilters = () => {
    setSearch('');
    setFiscalFilter('todos');
    setInterstateFilter('todos');
    setCompetenceFilter('');
    setBookingDateFilter('');
  };

  const openReportModal = () => {
    setReportBookingDate(bookingDateFilter || todayISO());
    setReportCompetence(competenceFilter || '');
    setReportAllLaunchDates(false);
    setReportStep('config');
    setPrintNotice(null);
    setReportModalOpen(true);
  };

  const reportInvoices = useMemo(() => {
    const list = fiscalInvoices.filter((inv) => {
      if (reportCompetence && !inv.issueDate.startsWith(reportCompetence)) {
        return false;
      }
      if (reportType === 'pendentes') {
        return (
          inv.fiscalStatus === 'aguardando_recebimento' ||
          inv.fiscalStatus === 'pendente' ||
          inv.fiscalStatus === 'aguardando_escrituracao'
        );
      }
      const isBooked =
        inv.fiscalStatus === 'lancado' || inv.fiscalStatus === 'escriturada';
      if (!isBooked) return false;
      if (!reportAllLaunchDates && reportBookingDate) {
        return (inv.bookkeepingDate || '') === reportBookingDate;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (reportType === 'pendentes') {
        const rank = (s: FiscalStatus) => (s === 'aguardando_recebimento' ? 0 : 1);
        const diff = rank(a.fiscalStatus) - rank(b.fiscalStatus);
        if (diff !== 0) return diff;
      }
      return b.issueDate.localeCompare(a.issueDate);
    });
  }, [
    fiscalInvoices,
    reportType,
    reportBookingDate,
    reportAllLaunchDates,
    reportCompetence,
  ]);

  const reportStats = useMemo(() => {
    const totalAmount = reportInvoices.reduce((s, inv) => s + Number(inv.totalInvoice || 0), 0);
    const awaitingReceive = reportInvoices.filter(
      (inv) => inv.fiscalStatus === 'aguardando_recebimento'
    ).length;
    const pendingLaunch = reportInvoices.filter(
      (inv) =>
        inv.fiscalStatus === 'pendente' || inv.fiscalStatus === 'aguardando_escrituracao'
    ).length;
    return {
      count: reportInvoices.length,
      totalAmount,
      awaitingReceive,
      pendingLaunch,
    };
  }, [reportInvoices]);

  const handleDownloadReportPdf = () => {
    if (reportInvoices.length === 0) return;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const title =
      reportType === 'pendentes'
        ? 'Notas Fiscais Pendentes de Recebimento e Lançamento'
        : 'Relatório de Notas Fiscais Lançadas';
    const criteriaText =
      reportType === 'lancadas'
        ? reportAllLaunchDates
          ? 'Período de Lançamento: Todas as datas'
          : `Data de Lançamento: ${reportBookingDate ? formatDateBR(reportBookingDate) : '-'}`
        : `Escopo: ${reportStats.awaitingReceive} aguard. recebimento / ${reportStats.pendingLaunch} pendente(s) lançamento`;
    const compText = reportCompetence ? ` | Competência: ${reportCompetence}` : '';

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(15, 23, 42);
    doc.text(title, 12, 14, { maxWidth: 186 });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Controle Fiscal P2P - ${criteriaText}${compText}`, 12, 20, { maxWidth: 186 });
    doc.text(
      `Emitido em: ${formatDateBR(todayISO())} | Responsável: ${userProfile?.name || 'Setor Fiscal'} | UF Empresa: ${companyUf}`,
      12,
      25
    );

    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(12, 28, 186, 10, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`Documentos: ${reportStats.count}`, 15, 34.5);
    doc.text(
      `Valor Total Consolidado: ${formatBRL(reportStats.totalAmount)}`,
      195,
      34.5,
      { align: 'right' }
    );

    const statusColHeader = reportType === 'lancadas' ? 'Data Lanç.' : 'Status';
    const rows = reportInvoices.map((inv) => {
      const effectiveUf = getEffectiveIssuerUf(inv) || '-';
      const docLabel = `${DOC_TYPE_LABELS[inv.docType || 'NFE']} ${inv.nfeNumber}${
        inv.docType !== 'NFSE' ? ` S${inv.series}` : ''
      }`;
      const poRec = `${inv.poNumber || '-'}${inv.receiptNumber ? ` / ${inv.receiptNumber}` : ''}`;
      const statusOrDate =
        reportType === 'lancadas'
          ? inv.bookkeepingDate
            ? formatDateBR(inv.bookkeepingDate)
            : '-'
          : inv.fiscalStatus === 'aguardando_recebimento'
          ? 'Aguard. Receb.'
          : 'Pendente Lanç.';
      return [
        docLabel,
        formatDateBR(inv.issueDate),
        `${inv.issuerName}\n${inv.issuerCnpj}`,
        effectiveUf,
        poRec,
        statusOrDate,
        formatBRL(inv.totalInvoice),
      ];
    });

    autoTable(doc, {
      startY: 42,
      margin: { left: 12, right: 12, bottom: 12 },
      head: [
        [
          'Documento',
          'Emissão',
          'Emitente / CNPJ',
          'UF',
          'Pedido / Receb.',
          statusColHeader,
          'Valor Total',
        ],
      ],
      body: rows,
      foot: [
        [
          {
            content: `Total Geral (${reportStats.count} documento(s)):`,
            colSpan: 6,
            styles: { halign: 'right' },
          },
          formatBRL(reportStats.totalAmount),
        ],
      ],
      styles: {
        font: 'helvetica',
        fontSize: 7.5,
        cellPadding: 2,
        overflow: 'linebreak',
        textColor: [15, 23, 42],
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      footStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 19 },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 10, halign: 'center' },
        4: { cellWidth: 28 },
        5: { cellWidth: 24 },
        6: { cellWidth: 24, halign: 'right' },
      },
    });

    const suffix =
      reportType === 'pendentes'
        ? `pendentes_${todayISO()}`
        : `lancadas_${reportAllLaunchDates ? 'todas' : reportBookingDate || todayISO()}`;
    doc.save(`relatorio_fiscal_${suffix}.pdf`);
    setPrintNotice('Arquivo PDF gerado e baixado com sucesso. Abra o PDF para imprimir.');
  };

  const handleDownloadReportCsv = () => {
    if (reportInvoices.length === 0) return;
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const headers = [
      'Tipo',
      'Numero',
      'Serie',
      'Emissao',
      'Emitente',
      'CNPJ',
      'UF',
      'Pedido',
      'Recebimento',
      reportType === 'lancadas' ? 'Data Lancamento' : 'Status',
      'Valor Total',
    ];
    const lines = [
      headers.map(esc).join(';'),
      ...reportInvoices.map((inv) => {
        const statusOrDate =
          reportType === 'lancadas'
            ? inv.bookkeepingDate
              ? formatDateBR(inv.bookkeepingDate)
              : ''
            : inv.fiscalStatus === 'aguardando_recebimento'
            ? 'Aguardando Recebimento'
            : 'Pendente de Lancamento';
        return [
          DOC_TYPE_LABELS[inv.docType || 'NFE'],
          inv.nfeNumber,
          inv.docType === 'NFSE' ? '' : inv.series,
          formatDateBR(inv.issueDate),
          inv.issuerName,
          inv.issuerCnpj,
          getEffectiveIssuerUf(inv),
          inv.poNumber || '',
          inv.receiptNumber || '',
          statusOrDate,
          inv.totalInvoice.toFixed(2).replace('.', ','),
        ]
          .map(esc)
          .join(';');
      }),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const suffix =
      reportType === 'pendentes'
        ? `pendentes_${todayISO()}`
        : `lancadas_${reportAllLaunchDates ? 'todas' : reportBookingDate || todayISO()}`;
    link.href = url;
    link.download = `relatorio_fiscal_${suffix}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setPrintNotice('Planilha CSV exportada com sucesso.');
  };

  const handleBrowserPrint = () => {
    const isEmbedded = typeof window !== 'undefined' && window.self !== window.top;
    try {
      window.print();
    } catch {
      // Blocked by iframe sandbox
    }
    if (isEmbedded) {
      setPrintNotice(
        'Se a janela nativa de impressão não abrir neste preview embutido, clique em "Baixar PDF (A4)" ao lado para salvar e imprimir o relatório.'
      );
    }
  };

  const fiscalTotals = useMemo(() => {
    const totalValue = fiscalInvoices.reduce((s, f) => s + f.totalInvoice, 0);
    const totalFreight = fiscalInvoices.reduce((s, f) => s + Number(f.freightAmount || 0), 0);
    const pendingReceiveCount = fiscalInvoices.filter(
      (f) => f.fiscalStatus === 'aguardando_recebimento'
    ).length;
    const pendingLaunchCount = fiscalInvoices.filter(
      (f) => f.fiscalStatus === 'pendente' || f.fiscalStatus === 'aguardando_escrituracao'
    ).length;
    const bookedCount = fiscalInvoices.filter(
      (f) => f.fiscalStatus === 'lancado' || f.fiscalStatus === 'escriturada'
    ).length;
    const replacedCount = fiscalInvoices.filter(
      (f) => f.fiscalStatus === 'substituida'
    ).length;
    const outOfStateNfeCount = fiscalInvoices.filter((f) => isOutOfStateNfe(f)).length;
    const pendingSuframaCount = fiscalInvoices.filter((f) => hasPendingSuframa(f)).length;
    const activeAdjustmentsCount = adjustmentRequests.filter(
      (r) => r.status !== 'Resolvido' && r.status !== 'Cancelado'
    ).length;
    const awaitingRevisionAdjustmentsCount = adjustmentRequests.filter(
      (r) => r.status === 'Ajustado' || r.status === 'Devolvido para revisão fiscal'
    ).length;
    return {
      totalValue,
      totalFreight,
      pendingReceiveCount,
      pendingLaunchCount,
      bookedCount,
      replacedCount,
      outOfStateNfeCount,
      pendingSuframaCount,
      activeAdjustmentsCount,
      awaitingRevisionAdjustmentsCount,
    };
  }, [fiscalInvoices, adjustmentRequests, companyUf]);

  const getEligiblePurchaseOrdersForCnpj = (
    issuerCnpj: string,
    currentLinkedPoId?: string
  ) => {
    const targetCnpj = normalizeCnpjDigits(issuerCnpj);
    return purchaseOrders
      .map((po) => {
        const summary = getPoReceptionSummary(po, physicalReceipts);
        const remainingQty = Math.max(
          0,
          Number((summary.totalOrdered - summary.totalReceived).toFixed(4))
        );
        return { po, summary, remainingQty };
      })
      .filter(({ po, remainingQty }) => {
        if (currentLinkedPoId && po.id === currentLinkedPoId) return true;
        const poCnpj = normalizeCnpjDigits(po.supplierCnpj);
        if (!targetCnpj || !poCnpj || poCnpj !== targetCnpj) return false;
        if (po.status === 'cancelado' || po.status === 'concluido') return false;
        return remainingQty > 0.0001;
      });
  };

  const handleCopyKey = (key: string) => {
    void navigator.clipboard?.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const ingestXmlContents = (entries: Array<{ fileName: string; content: string }>) => {
    setBatchError(null);
    setBatchSuccess(null);

    const existingKeys = new Set(fiscalInvoices.map((f) => f.accessKey));
    const queueKeys = new Set(
      batchQueue.filter((b) => b.parsed && !b.error).map((b) => b.parsed!.accessKey)
    );

    const nextItems: BatchXmlItem[] = entries.map((entry, idx) => {
      const itemId = `xml_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
      try {
        const parsed = parseFiscalXml(entry.content);
        const isDuplicate =
          existingKeys.has(parsed.accessKey) || queueKeys.has(parsed.accessKey);
        if (isDuplicate) {
          return {
            id: itemId,
            fileName: entry.fileName,
            parsed,
            duplicate: true,
            error: 'Chave de Acesso já existente no Controle Fiscal ou na fila atual.',
            requiresPhysicalReceipt: true,
            initialFiscalStatus: 'aguardando_recebimento',
            isPartialBilling: false,
            purchaseOrderId: '',
            receiptId: '',
            linkedInvoiceId: '',
            notes: '',
          };
        }
        queueKeys.add(parsed.accessKey);
        const matchedRefInvoice =
          parsed.docType === 'CTE' && parsed.referencedNfeKey
            ? fiscalInvoices.find(
                (inv) => inv.docType !== 'CTE' && inv.accessKey === parsed.referencedNfeKey
              )
            : undefined;
        return {
          id: itemId,
          fileName: entry.fileName,
          parsed,
          duplicate: false,
          requiresPhysicalReceipt: true,
          initialFiscalStatus: 'aguardando_recebimento',
          isPartialBilling: false,
          purchaseOrderId: '',
          receiptId: '',
          linkedInvoiceId: matchedRefInvoice?.id || '',
          notes: '',
        };
      } catch (err) {
        return {
          id: itemId,
          fileName: entry.fileName,
          error: err instanceof Error ? err.message : 'Falha na leitura do XML.',
          requiresPhysicalReceipt: true,
          initialFiscalStatus: 'aguardando_recebimento',
          isPartialBilling: false,
          purchaseOrderId: '',
          receiptId: '',
          linkedInvoiceId: '',
          notes: '',
        };
      }
    });

    setBatchQueue((prev) => [...prev, ...nextItems]);
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const entries = await Promise.all(
      files.map(
        (file) =>
          new Promise<{ fileName: string; content: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ fileName: file.name, content: String(reader.result || '') });
            reader.onerror = () => resolve({ fileName: file.name, content: '' });
            reader.readAsText(file, 'UTF-8');
          })
      )
    );
    ingestXmlContents(entries);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleLoadSampleSingle = (docType: FiscalDocType) => {
    const openPo = purchaseOrders.find((p) => p.status !== 'cancelado');
    if (docType === 'NFE') {
      ingestXmlContents([
        { fileName: 'nfe_produto_exemplo.xml', content: buildSampleNFeXml(openPo) },
      ]);
    } else if (docType === 'NFSE') {
      ingestXmlContents([
        { fileName: 'nfse_nacional_exemplo.xml', content: buildSampleNFSeXml(openPo) },
      ]);
    } else {
      ingestXmlContents([
        { fileName: 'cte_transporte_exemplo.xml', content: buildSampleCTeXml() },
      ]);
    }
  };

  const handleLoadSampleBatch = () => {
    const openPo = purchaseOrders.find((p) => p.status !== 'cancelado');
    ingestXmlContents([
      { fileName: 'lote_nfe_produto.xml', content: buildSampleNFeXml(openPo) },
      { fileName: 'lote_nfse_nacional.xml', content: buildSampleNFSeXml(openPo) },
      { fileName: 'lote_cte_frete.xml', content: buildSampleCTeXml() },
    ]);
  };

  const updateBatchItem = (id: string, patch: Partial<BatchXmlItem>) => {
    setBatchQueue((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next: BatchXmlItem = { ...item, ...patch };
        // Invalidate provisional conference confirmation whenever structural conference data changes
        if (
          patch.purchaseOrderId !== undefined ||
          patch.requiresPhysicalReceipt !== undefined ||
          patch.isPartialBilling !== undefined ||
          patch.itemAssociations !== undefined
        ) {
          next.conferenceConfirmed = false;
          next.conferenceJustification = '';
        }
        if (patch.purchaseOrderId !== undefined && patch.purchaseOrderId !== item.purchaseOrderId) {
          next.itemAssociations = undefined;
          next.notifyCompras = false;
          next.adjustmentObservation = '';
        }
        return next;
      })
    );
  };

  const applyBatchRequiresPhysicalReceiptAll = (requiresPhysical: boolean) => {
    const nextStatus: 'aguardando_recebimento' | 'pendente' = requiresPhysical
      ? 'aguardando_recebimento'
      : 'pendente';
    setBatchQueue((prev) =>
      prev.map((item) => ({
        ...item,
        requiresPhysicalReceipt: requiresPhysical,
        initialFiscalStatus: nextStatus,
        conferenceConfirmed: false,
        conferenceJustification: '',
      }))
    );
  };

  const removeBatchItem = (id: string) => {
    if (previewBatchItemId === id) setPreviewBatchItemId(null);
    setBatchQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const validBatchItems = useMemo(
    () => batchQueue.filter((item) => item.parsed && !item.error && !item.duplicate),
    [batchQueue]
  );

  const previewBatchItem = useMemo(
    () => batchQueue.find((b) => b.id === previewBatchItemId) || null,
    [batchQueue, previewBatchItemId]
  );

  const computeParsedEffectiveValues = (parsed: ParsedFiscalXml) => {
    const effectiveTaxRegime: ServiceTaxRegime | '' =
      parsed.docType === 'NFSE' ? parsed.taxRegime || 'simples_nacional' : '';
    const effectivePis =
      parsed.docType === 'NFSE' && effectiveTaxRegime !== 'regime_normal' ? 0 : parsed.pisAmount;
    const effectiveCofins =
      parsed.docType === 'NFSE' && effectiveTaxRegime !== 'regime_normal'
        ? 0
        : parsed.cofinsAmount;
    const effectiveCsll =
      parsed.docType === 'NFSE' && effectiveTaxRegime !== 'regime_normal'
        ? 0
        : parsed.csllAmount || 0;
    const effectiveIssqn =
      parsed.docType === 'NFSE' && effectiveTaxRegime === 'mei' ? 0 : parsed.issqnAmount || 0;
    const effectiveInss =
      parsed.docType === 'NFSE' && effectiveTaxRegime === 'mei' ? 0 : parsed.inssAmount || 0;
    const effectiveIrrf =
      parsed.docType === 'NFSE' && effectiveTaxRegime !== 'regime_normal'
        ? 0
        : parsed.irrfAmount || 0;

    const computedNetTotal = calculateFiscalNetTotal({
      docType: parsed.docType,
      totalProducts: parsed.totalProducts,
      freightAmount: parsed.freightAmount,
      insuranceAmount: parsed.insuranceAmount || 0,
      otherExpensesAmount: parsed.otherExpensesAmount || 0,
      surchargeAmount: parsed.surchargeAmount || 0,
      ipiAmount: parsed.ipiAmount,
      icmsStAmount: parsed.icmsStAmount,
      discountAmount: parsed.discountAmount,
      retainedTaxesAmount: parsed.retainedTaxesAmount,
      taxRegime: effectiveTaxRegime,
      pisAmount: effectivePis,
      cofinsAmount: effectiveCofins,
      csllAmount: effectiveCsll,
      issqnAmount: effectiveIssqn,
      issqnRetained: parsed.issqnRetained ?? true,
      inssAmount: effectiveInss,
      irrfAmount: effectiveIrrf,
    });

    return {
      effectiveTaxRegime,
      effectivePis,
      effectiveCofins,
      effectiveCsll,
      effectiveIssqn,
      effectiveInss,
      effectiveIrrf,
      computedNetTotal,
    };
  };

  // Pre-import provisional conference evaluation for all valid XML queue items with PO linked
  const preImportMatchMap = useMemo(() => {
    const map = new Map<string, ThreeWayMatchDetails>();
    validBatchItems.forEach((item) => {
      const parsed = item.parsed!;
      const po = purchaseOrders.find((p) => p.id === item.purchaseOrderId);
      const { computedNetTotal } = computeParsedEffectiveValues(parsed);

      const tempEquivs: ProductEquivalence[] = (item.pendingEquivalences || []).map((draft, i) => ({
        id: `temp_eq_${item.id}_${i}`,
        supplierCnpj: draft.supplierCnpj,
        supplierItemCode: draft.supplierItemCode,
        supplierDescription: draft.supplierDescription,
        supplierNormalizedDesc: draft.supplierDescription,
        internalCode: draft.internalCode,
        poDescription: draft.poDescription,
        poUnit: draft.poUnit,
        invoiceUnit: draft.invoiceUnit,
        conversionFactor: draft.conversionFactor,
        active: true,
        createdByUid: 'temp',
        createdByName: 'temp',
      }));

      const savedOtherForPo = po
        ? fiscalInvoices
            .filter((f) => f.purchaseOrderId === po.id)
            .map((f) => ({
              id: f.id,
              docType: f.docType,
              grossAmount: f.grossAmount,
              totalProducts: f.totalProducts,
              totalInvoice: f.totalInvoice,
              discountAmount: f.discountAmount,
              otherExpensesAmount: f.otherExpensesAmount,
              surchargeAmount: f.surchargeAmount,
              items: f.items,
              itemAssociations: f.itemAssociations,
            }))
        : [];

      const batchSiblingForPo = po
        ? validBatchItems
            .filter(
              (other) =>
                other.id !== item.id &&
                other.purchaseOrderId === po.id &&
                !other.notifyCompras &&
                other.parsed
            )
            .map((other) => {
              const othParsed = other.parsed!;
              const othVals = computeParsedEffectiveValues(othParsed);
              return {
                id: other.id,
                docType: othParsed.docType,
                grossAmount: othParsed.grossAmount,
                totalProducts: othParsed.totalProducts,
                totalInvoice: othVals.computedNetTotal,
                discountAmount: othParsed.discountAmount,
                otherExpensesAmount: othParsed.otherExpensesAmount,
                surchargeAmount: othParsed.surchargeAmount,
                items: othParsed.items,
                itemAssociations: other.itemAssociations,
              };
            })
        : [];

      const match = evaluatePreImportMatch(
        {
          id: item.id,
          docType: parsed.docType,
          issuerCnpj: parsed.issuerCnpj,
          grossAmount: parsed.grossAmount,
          totalProducts: parsed.totalProducts,
          discountAmount: parsed.discountAmount,
          otherExpensesAmount: parsed.otherExpensesAmount,
          surchargeAmount: parsed.surchargeAmount,
          totalInvoice: computedNetTotal,
          items: parsed.items,
          itemAssociations: item.itemAssociations,
          purchaseOrderId: po?.id || '',
          receiptId: '',
          requiresPhysicalReceipt: item.requiresPhysicalReceipt,
          isPartialBilling: item.isPartialBilling,
        },
        po,
        {
          savedEquivalences: [...productEquivalences, ...tempEquivs],
          otherLinkedInvoicesForPo: [...savedOtherForPo, ...batchSiblingForPo],
        }
      );
      map.set(item.id, match);
    });
    return map;
  }, [validBatchItems, purchaseOrders, fiscalInvoices, productEquivalences]);

  const handleImportBatch = async () => {
    if (validBatchItems.length === 0) return;
    setBatchError(null);
    setBatchSuccess(null);
    setSaving(true);

    try {
      const entries: Parameters<typeof createFiscalInvoicesBatch>[0] = [];
      const equivalencesToPersist: EquivalenceDraftInput[] = [];

      for (const item of validBatchItems) {
        const parsed = item.parsed!;
        const po = purchaseOrders.find((p) => p.id === item.purchaseOrderId);
        if (po) {
          const poCnpj = normalizeCnpjDigits(po.supplierCnpj);
          const invCnpj = normalizeCnpjDigits(parsed.issuerCnpj);
          const summary = getPoReceptionSummary(po, physicalReceipts);
          const remainingQty = summary.totalOrdered - summary.totalReceived;
          if (poCnpj !== invCnpj) {
            throw new Error(
              `O pedido ${po.poNumber} pertence ao CNPJ ${po.supplierCnpj}, diferente do emitente ${parsed.issuerCnpj}.`
            );
          }
          if (po.status === 'cancelado' || po.status === 'concluido' || remainingQty <= 0.0001) {
            throw new Error(
              `O pedido ${po.poNumber} não possui mais saldo pendente de entrada.`
            );
          }
        }

        const linkedInv =
          parsed.docType === 'CTE' && item.linkedInvoiceId
            ? fiscalInvoices.find((f) => f.id === item.linkedInvoiceId)
            : undefined;
        const requiresPhysicalReceipt = item.requiresPhysicalReceipt;
        const initialFiscalStatus: 'aguardando_recebimento' | 'pendente' = requiresPhysicalReceipt
          ? 'aguardando_recebimento'
          : 'pendente';

        const {
          effectiveTaxRegime,
          effectivePis,
          effectiveCofins,
          effectiveCsll,
          effectiveIssqn,
          effectiveInss,
          effectiveIrrf,
          computedNetTotal,
        } = computeParsedEffectiveValues(parsed);

        const match = preImportMatchMap.get(item.id);
        const associations = match?.associations || item.itemAssociations || [];
        const fingerprint = buildConferenceFingerprint({
          invoice: {
            docType: parsed.docType,
            grossAmount: parsed.grossAmount,
            totalProducts: parsed.totalProducts,
            freightAmount: parsed.freightAmount,
            insuranceAmount: parsed.insuranceAmount || 0,
            otherExpensesAmount: parsed.otherExpensesAmount || 0,
            surchargeAmount: parsed.surchargeAmount || 0,
            discountAmount: parsed.discountAmount || 0,
            ipiAmount: parsed.ipiAmount,
            icmsStAmount: parsed.icmsStAmount || 0,
            pisAmount: effectivePis,
            cofinsAmount: effectiveCofins,
            csllAmount: effectiveCsll,
            issqnAmount: effectiveIssqn,
            issqnRetained: parsed.issqnRetained ?? true,
            inssAmount: effectiveInss,
            irrfAmount: effectiveIrrf,
            retainedTaxesAmount: parsed.retainedTaxesAmount || 0,
            taxRegime: effectiveTaxRegime,
            totalInvoice: computedNetTotal,
            items: parsed.items,
          },
          po,
          itemAssociations: associations,
          requiresPhysicalReceipt,
          isPartialBilling: item.isPartialBilling,
        });

        const shouldSendAdjustment = Boolean(item.notifyCompras && po);
        const confConfirmed = Boolean(item.conferenceConfirmed && !shouldSendAdjustment);

        const divergentItemsSnapshot = (match?.itemComparisons || [])
          .filter((cmp) => !cmp.matchedInPo || !cmp.qtyMatch || !cmp.unitPriceMatch)
          .map((cmp) => ({
            invoiceItemDescription: cmp.description,
            ...(cmp.poDescription ? { poItemDescription: cmp.poDescription } : {}),
            poQty: cmp.poQty,
            invoiceQty: cmp.invoiceQty,
            poUnitPrice: cmp.poUnitPrice,
            invoiceUnitPrice: cmp.invoiceUnitPrice,
            reason: !cmp.matchedInPo
              ? 'Item não conciliado no Pedido'
              : !cmp.qtyMatch
              ? 'Quantidade divergente'
              : 'Valor unitário divergente',
          }));

        if (item.pendingEquivalences?.length) {
          equivalencesToPersist.push(...item.pendingEquivalences);
        }

        entries.push({
          invoiceData: {
            ...parsed,
            series: parsed.docType === 'NFSE' ? parsed.series || '' : parsed.series || '1',
            issuerState: (parsed.issuerState || '').trim().toUpperCase(),
            suframaPinNumber: '',
            suframaPinAcceptanceDate: '',
            suframaPinReceiptDate: '',
            suframaClearanceDate: '',
            taxRegime: effectiveTaxRegime,
            pisAmount: effectivePis,
            cofinsAmount: effectiveCofins,
            csllAmount: effectiveCsll,
            issqnAmount: effectiveIssqn,
            issqnRetained: parsed.issqnRetained ?? true,
            inssAmount: effectiveInss,
            irrfAmount: effectiveIrrf,
            icmsStAmount: parsed.icmsStAmount || 0,
            retainedTaxesAmount: parsed.retainedTaxesAmount || 0,
            totalInvoice: computedNetTotal,
            itemAssociations: associations,
            linkedInvoiceId: linkedInv?.id || '',
            linkedInvoiceNumber: linkedInv?.nfeNumber || '',
            originState: parsed.docType === 'CTE' ? parsed.originState || '' : '',
            originCity: parsed.docType === 'CTE' ? parsed.originCity || '' : '',
            destinationState: parsed.docType === 'CTE' ? parsed.destinationState || '' : '',
            destinationCity: parsed.docType === 'CTE' ? parsed.destinationCity || '' : '',
            purchaseOrderId: shouldSendAdjustment ? '' : po?.id || '',
            poNumber: shouldSendAdjustment ? '' : po?.poNumber || '',
            receiptId: '',
            receiptNumber: '',
            matchingStatus: shouldSendAdjustment
              ? 'pendente_vinculo'
              : match?.status || 'pendente_vinculo',
            fiscalStatus: initialFiscalStatus,
            requiresPhysicalReceipt,
            isPartialBilling: item.isPartialBilling,
            ...(confConfirmed
              ? {
                  conferenceStatus: 'conferido' as const,
                  conferenceOriginalOutcome:
                    match?.conferenceBadgeState === 'sem_divergencia'
                      ? ('sem_divergencia' as const)
                      : ('divergente' as const),
                  conferenceConfirmedByUid: userProfile?.uid || '',
                  conferenceConfirmedByName: userProfile?.name || '',
                  conferenceConfirmedAt: new Date().toISOString(),
                  conferenceJustification: item.conferenceJustification || '',
                  conferenceDataVersion: fingerprint,
                }
              : {
                  conferenceStatus: 'pendente' as const,
                }),
            bookkeepingDate: '',
            xmlImported: true,
            notes: item.notes.trim(),
          },
          ...(shouldSendAdjustment && po
            ? {
                adjustmentRequest: {
                  po,
                  divergenceReasons: match?.reasons || ['Divergência sinalizada na pré-importação'],
                  divergentItems: divergentItemsSnapshot,
                  poGrossTotal: match?.poGrossTotal ?? po.totalAmount,
                  poNetTotal: match?.poTotal ?? po.totalAmount,
                  invoiceGrossTotal: parsed.grossAmount,
                  invoiceNetTotal: computedNetTotal,
                  fiscalObservation: item.adjustmentObservation || '',
                },
              }
            : {}),
        });
      }

      await createFiscalInvoicesBatch(entries);

      // Persist any queued supplier product equivalences after confirmed batch import
      for (const eq of equivalencesToPersist) {
        await upsertProductEquivalence(eq);
      }

      setBatchQueue([]);
      setPreviewBatchItemId(null);
      setBatchSuccess(
        `${entries.length} documento(s) fiscal(is) importado(s) com sucesso.`
      );
      setSubTab('controle');
    } catch (err) {
      setBatchError(
        formatFiscalActionError(err, 'Falha ao importar documentos XML no banco.')
      );
    } finally {
      setSaving(false);
    }
  };

  const openReconcileModal = (inv: FiscalInvoice) => {
    setActiveInvoice(inv);
    setLinkPoId(inv.purchaseOrderId);
    setLinkReceiptId(inv.receiptId);
    setEditRequiresPhysicalReceipt(inv.requiresPhysicalReceipt ?? true);
    setEditIsPartialBilling(Boolean(inv.isPartialBilling));
    setEditItemAssociations(inv.itemAssociations || []);
    setConfJustificationInput(inv.conferenceJustification || '');
    setAdjObservationInput('');
    setFiscalResolutionNote('');
    setEditNotes(inv.notes || '');
    const normalizedStatus: FiscalStatus =
      inv.fiscalStatus === 'aguardando_escrituracao'
        ? 'pendente'
        : inv.fiscalStatus === 'escriturada'
        ? 'lancado'
        : inv.fiscalStatus;
    setEditFiscalStatus(normalizedStatus);
    setEditBookkeepingDate(inv.bookkeepingDate || '');
    setReplacedByInvoiceId(inv.replacedByInvoiceId || '');
    setEditTaxRegime((inv.taxRegime as ServiceTaxRegime) || 'simples_nacional');
    setEditTotalProducts(Number(inv.totalProducts ?? inv.grossAmount ?? 0));
    setEditFreightAmount(Number(inv.freightAmount || 0));
    setEditInsuranceAmount(Number(inv.insuranceAmount || 0));
    setEditOtherExpensesAmount(Number(inv.otherExpensesAmount || 0));
    setEditSurchargeAmount(Number(inv.surchargeAmount || 0));
    setEditDiscountAmount(Number(inv.discountAmount || 0));
    setEditIcmsAmount(Number(inv.icmsAmount || 0));
    setEditIcmsDesonAmount(Number(inv.icmsDesonAmount || 0));
    setEditIcmsStAmount(Number(inv.icmsStAmount || 0));
    setEditIpiAmount(Number(inv.ipiAmount || 0));
    setEditRetainedTaxesAmount(Number(inv.retainedTaxesAmount || 0));
    setEditPisAmount(Number(inv.pisAmount || 0));
    setEditCofinsAmount(Number(inv.cofinsAmount || 0));
    setEditCsllAmount(Number(inv.csllAmount || 0));
    setEditIssqnAmount(Number(inv.issqnAmount || 0));
    setEditIssqnRetained(inv.issqnRetained ?? true);
    setEditInssAmount(Number(inv.inssAmount || 0));
    setEditIrrfAmount(Number(inv.irrfAmount || 0));
    setEditLinkedInvoiceId(inv.linkedInvoiceId || '');
    setEditOriginState(inv.originState || '');
    setEditOriginCity(inv.originCity || '');
    setEditDestinationState(inv.destinationState || '');
    setEditDestinationCity(inv.destinationCity || '');
    setEditIssuerState(getEffectiveIssuerUf(inv));
    setEditSuframaPinNumber(inv.suframaPinNumber || '');
    setEditSuframaPinAcceptanceDate(inv.suframaPinAcceptanceDate || '');
    setEditSuframaPinReceiptDate(inv.suframaPinReceiptDate || '');
    setEditSuframaClearanceDate(inv.suframaClearanceDate || '');
    setModalError(null);
    setModalSuccess(null);
  };

  const canEditActiveInvoice = useMemo(() => {
    if (!activeInvoice) return false;
    const isBooked =
      activeInvoice.fiscalStatus === 'lancado' ||
      activeInvoice.fiscalStatus === 'escriturada';
    return canEdit && (isAdmin || !isBooked);
  }, [activeInvoice, canEdit, isAdmin]);

  const activeAdjustmentRequest = useMemo(() => {
    if (!activeInvoice) return undefined;
    return adjustmentRequests.find(
      (r) =>
        r.fiscalInvoiceId === activeInvoice.id &&
        r.status !== 'Resolvido' &&
        r.status !== 'Cancelado'
    );
  }, [activeInvoice, adjustmentRequests]);

  const canToggleActivePhysicalReceipt = useMemo(() => {
    if (!activeInvoice || !canEditActiveInvoice) return false;
    const isAlreadyLaunched =
      activeInvoice.fiscalStatus === 'lancado' ||
      activeInvoice.fiscalStatus === 'escriturada';
    if (isAlreadyLaunched) return false;
    if (Boolean(activeInvoice.receiptId) || Boolean(linkReceiptId)) return false;
    return true;
  }, [activeInvoice, canEditActiveInvoice, linkReceiptId]);

  const requiresReceiptForActive = editRequiresPhysicalReceipt;

  const editComputedTotal = useMemo(() => {
    if (!activeInvoice) return 0;
    return calculateFiscalNetTotal({
      docType: activeInvoice.docType || 'NFE',
      totalProducts: editTotalProducts,
      freightAmount: editFreightAmount,
      insuranceAmount: editInsuranceAmount,
      otherExpensesAmount: editOtherExpensesAmount,
      surchargeAmount: editSurchargeAmount,
      ipiAmount: editIpiAmount,
      icmsStAmount: editIcmsStAmount,
      discountAmount: editDiscountAmount,
      retainedTaxesAmount: editRetainedTaxesAmount,
      taxRegime: activeInvoice.docType === 'NFSE' ? editTaxRegime : '',
      pisAmount: editPisAmount,
      cofinsAmount: editCofinsAmount,
      csllAmount: editCsllAmount,
      issqnAmount: editIssqnAmount,
      issqnRetained: editIssqnRetained,
      inssAmount: editInssAmount,
      irrfAmount: editIrrfAmount,
    });
  }, [
    activeInvoice,
    editTotalProducts,
    editFreightAmount,
    editInsuranceAmount,
    editOtherExpensesAmount,
    editSurchargeAmount,
    editIpiAmount,
    editIcmsStAmount,
    editDiscountAmount,
    editRetainedTaxesAmount,
    editTaxRegime,
    editPisAmount,
    editCofinsAmount,
    editCsllAmount,
    editIssqnAmount,
    editIssqnRetained,
    editInssAmount,
    editIrrfAmount,
  ]);

  const pendingReplacementCandidates = useMemo(() => {
    if (!activeInvoice) return [];
    const targetCnpj = normalizeCnpjDigits(activeInvoice.issuerCnpj);
    return fiscalInvoices
      .filter((inv) => {
        if (inv.id === activeInvoice.id) return false;
        if (normalizeCnpjDigits(inv.issuerCnpj) !== targetCnpj) return false;
        if (inv.id === activeInvoice.replacedByInvoiceId) return true;
        return (
          inv.fiscalStatus === 'pendente' ||
          inv.fiscalStatus === 'aguardando_escrituracao' ||
          inv.fiscalStatus === 'aguardando_recebimento'
        );
      })
      .sort((a, b) => {
        const rank = (s: FiscalStatus) =>
          s === 'pendente' || s === 'aguardando_escrituracao' ? 0 : 1;
        return rank(a.fiscalStatus) - rank(b.fiscalStatus);
      });
  }, [activeInvoice, fiscalInvoices]);

  const hasLinkedPo = useMemo(
    () => Boolean(linkPoId && purchaseOrders.some((p) => p.id === linkPoId)),
    [linkPoId, purchaseOrders]
  );

  const hasSignaledReceipt = useMemo(
    () => Boolean(linkReceiptId && physicalReceipts.some((r) => r.id === linkReceiptId)),
    [linkReceiptId, physicalReceipts]
  );

  const canLaunchActive = useMemo(
    () => hasLinkedPo && (!requiresReceiptForActive || hasSignaledReceipt),
    [hasLinkedPo, requiresReceiptForActive, hasSignaledReceipt]
  );

  const otherLinkedForActivePo = useMemo(() => {
    if (!activeInvoice || !linkPoId) return [];
    return fiscalInvoices
      .filter((f) => f.id !== activeInvoice.id && f.purchaseOrderId === linkPoId)
      .map((f) => ({
        id: f.id,
        docType: f.docType,
        grossAmount: f.grossAmount,
        totalProducts: f.totalProducts,
        totalInvoice: f.totalInvoice,
        discountAmount: f.discountAmount,
        otherExpensesAmount: f.otherExpensesAmount,
        surchargeAmount: f.surchargeAmount,
        items: f.items,
        itemAssociations: f.itemAssociations,
      }));
  }, [activeInvoice, linkPoId, fiscalInvoices]);

  const modalMatchPreview = useMemo(() => {
    if (!activeInvoice) return null;
    const po = purchaseOrders.find((p) => p.id === linkPoId);
    const rec = physicalReceipts.find((r) => r.id === linkReceiptId);
    return evaluateThreeWayMatch(
      {
        id: activeInvoice.id,
        docType: activeInvoice.docType || 'NFE',
        issuerCnpj: activeInvoice.issuerCnpj,
        grossAmount: editTotalProducts,
        totalProducts: editTotalProducts,
        discountAmount: editDiscountAmount,
        otherExpensesAmount: editOtherExpensesAmount,
        surchargeAmount: editSurchargeAmount,
        totalInvoice: editComputedTotal,
        items: activeInvoice.items,
        itemAssociations: editItemAssociations,
        purchaseOrderId: linkPoId,
        receiptId: linkReceiptId,
        requiresPhysicalReceipt: requiresReceiptForActive,
        isPartialBilling: editIsPartialBilling,
        pendingAdjustmentId: activeAdjustmentRequest?.id || '',
      },
      po,
      rec,
      {
        savedEquivalences: productEquivalences,
        otherLinkedInvoicesForPo: otherLinkedForActivePo,
      }
    );
  }, [
    activeInvoice,
    linkPoId,
    linkReceiptId,
    editTotalProducts,
    editDiscountAmount,
    editOtherExpensesAmount,
    editSurchargeAmount,
    editComputedTotal,
    editItemAssociations,
    requiresReceiptForActive,
    editIsPartialBilling,
    activeAdjustmentRequest,
    purchaseOrders,
    physicalReceipts,
    productEquivalences,
    otherLinkedForActivePo,
  ]);

  const adjustmentPreviewMatch = useMemo(() => {
    if (!activeInvoice || !activeAdjustmentRequest) return null;
    const reqPo = purchaseOrders.find((p) => p.id === activeAdjustmentRequest.purchaseOrderId);
    if (!reqPo) return null;
    const otherForReqPo = fiscalInvoices
      .filter((f) => f.id !== activeInvoice.id && f.purchaseOrderId === reqPo.id)
      .map((f) => ({
        id: f.id,
        docType: f.docType,
        grossAmount: f.grossAmount,
        totalProducts: f.totalProducts,
        totalInvoice: f.totalInvoice,
        discountAmount: f.discountAmount,
        otherExpensesAmount: f.otherExpensesAmount,
        surchargeAmount: f.surchargeAmount,
        items: f.items,
        itemAssociations: f.itemAssociations,
      }));
    return evaluatePreImportMatch(
      {
        id: activeInvoice.id,
        docType: activeInvoice.docType || 'NFE',
        issuerCnpj: activeInvoice.issuerCnpj,
        grossAmount: editTotalProducts,
        totalProducts: editTotalProducts,
        discountAmount: editDiscountAmount,
        otherExpensesAmount: editOtherExpensesAmount,
        surchargeAmount: editSurchargeAmount,
        totalInvoice: editComputedTotal,
        items: activeInvoice.items,
        itemAssociations: editItemAssociations,
        purchaseOrderId: reqPo.id,
        receiptId: linkReceiptId,
        requiresPhysicalReceipt: requiresReceiptForActive,
        isPartialBilling: editIsPartialBilling,
      },
      reqPo,
      {
        savedEquivalences: productEquivalences,
        otherLinkedInvoicesForPo: otherForReqPo,
      }
    );
  }, [
    activeInvoice,
    activeAdjustmentRequest,
    purchaseOrders,
    fiscalInvoices,
    editTotalProducts,
    editDiscountAmount,
    editOtherExpensesAmount,
    editSurchargeAmount,
    editComputedTotal,
    editItemAssociations,
    linkReceiptId,
    requiresReceiptForActive,
    editIsPartialBilling,
    productEquivalences,
  ]);

  const activeConferenceFingerprint = useMemo(() => {
    if (!activeInvoice || !modalMatchPreview) return '';
    const po = purchaseOrders.find((p) => p.id === linkPoId);
    const rec = physicalReceipts.find((r) => r.id === linkReceiptId);
    const docType = activeInvoice.docType || 'NFE';
    return buildConferenceFingerprint({
      invoice: {
        docType,
        grossAmount: editTotalProducts,
        totalProducts: editTotalProducts,
        freightAmount: docType === 'NFSE' ? 0 : editFreightAmount,
        insuranceAmount: docType === 'NFSE' ? 0 : editInsuranceAmount,
        otherExpensesAmount: editOtherExpensesAmount,
        surchargeAmount: editSurchargeAmount,
        discountAmount: editDiscountAmount,
        ipiAmount: docType === 'NFE' ? editIpiAmount : 0,
        icmsStAmount: docType === 'NFE' ? editIcmsStAmount : 0,
        pisAmount: editPisAmount,
        cofinsAmount: editCofinsAmount,
        csllAmount: editCsllAmount,
        issqnAmount: editIssqnAmount,
        issqnRetained: editIssqnRetained,
        inssAmount: editInssAmount,
        irrfAmount: editIrrfAmount,
        retainedTaxesAmount: docType === 'NFSE' ? 0 : editRetainedTaxesAmount,
        taxRegime: docType === 'NFSE' ? editTaxRegime : '',
        totalInvoice: editComputedTotal,
        items: activeInvoice.items,
      },
      po,
      receipt: rec,
      itemAssociations: modalMatchPreview.associations,
      requiresPhysicalReceipt: requiresReceiptForActive,
      isPartialBilling: editIsPartialBilling,
    });
  }, [
    activeInvoice,
    modalMatchPreview,
    purchaseOrders,
    physicalReceipts,
    linkPoId,
    linkReceiptId,
    editTotalProducts,
    editFreightAmount,
    editInsuranceAmount,
    editOtherExpensesAmount,
    editSurchargeAmount,
    editDiscountAmount,
    editIpiAmount,
    editIcmsStAmount,
    editPisAmount,
    editCofinsAmount,
    editCsllAmount,
    editIssqnAmount,
    editIssqnRetained,
    editInssAmount,
    editIrrfAmount,
    editRetainedTaxesAmount,
    editTaxRegime,
    editComputedTotal,
    requiresReceiptForActive,
    editIsPartialBilling,
  ]);

  const isConferenceStale = useMemo(() => {
    if (!activeInvoice || activeInvoice.conferenceStatus !== 'conferido') return false;
    if (!activeInvoice.conferenceDataVersion || !activeConferenceFingerprint) return false;
    return activeInvoice.conferenceDataVersion !== activeConferenceFingerprint;
  }, [activeInvoice, activeConferenceFingerprint]);

  const handleConfirmActiveConference = async () => {
    if (!activeInvoice || !modalMatchPreview || !canEditActiveInvoice) return;
    setModalError(null);
    setModalSuccess(null);

    if (!linkPoId) {
      setModalError('Vincule um Pedido de Compra antes de confirmar a conferência.');
      return;
    }
    if (modalMatchPreview.unmatchedInvoiceItemIndexes.length > 0) {
      setModalError(
        'Concilie todos os itens da nota fiscal com o Pedido de Compra antes de confirmar a conferência.'
      );
      return;
    }

    const outcome: 'sem_divergencia' | 'divergente' =
      modalMatchPreview.conferenceBadgeState === 'sem_divergencia'
        ? 'sem_divergencia'
        : 'divergente';

    if (outcome === 'divergente' && !confJustificationInput.trim()) {
      setModalError(
        'Há divergências apontadas no cruzamento. Informe uma justificativa para confirmar a conferência.'
      );
      return;
    }

    setSaving(true);
    try {
      await confirmInvoiceConference(activeInvoice.id, {
        originalOutcome: outcome,
        justification: confJustificationInput.trim(),
        dataVersion: activeConferenceFingerprint,
        itemAssociations: modalMatchPreview.associations,
        matchingStatus: modalMatchPreview.status,
      });
      setActiveInvoice((prev) =>
        prev
          ? {
              ...prev,
              conferenceStatus: 'conferido',
              conferenceOriginalOutcome: outcome,
              conferenceJustification: confJustificationInput.trim(),
              conferenceDataVersion: activeConferenceFingerprint,
              itemAssociations: modalMatchPreview.associations,
            }
          : null
      );
      setModalSuccess('Conferência confirmada! A escrituração continua sob seu controle.');
    } catch (err) {
      setModalError(formatFiscalActionError(err, 'Não foi possível confirmar a conferência.'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateActiveAdjustment = async () => {
    if (!activeInvoice || !modalMatchPreview || !canEditActiveInvoice) return;
    setModalError(null);
    setModalSuccess(null);
    const po = purchaseOrders.find((p) => p.id === linkPoId);
    if (!po) {
      setModalError('Selecione um Pedido de Compra para enviar a solicitação de ajuste.');
      return;
    }
    if (activeAdjustmentRequest) {
      setModalError('Já existe uma solicitação de ajuste em aberto para esta nota.');
      return;
    }

    const divergentItemsSnapshot = modalMatchPreview.itemComparisons
      .filter((cmp) => !cmp.matchedInPo || !cmp.qtyMatch || !cmp.unitPriceMatch)
      .map((cmp) => ({
        invoiceItemDescription: cmp.description,
        ...(cmp.poDescription ? { poItemDescription: cmp.poDescription } : {}),
        poQty: cmp.poQty,
        invoiceQty: cmp.invoiceQty,
        poUnitPrice: cmp.poUnitPrice,
        invoiceUnitPrice: cmp.invoiceUnitPrice,
        reason: !cmp.matchedInPo
          ? 'Item não conciliado no Pedido'
          : !cmp.qtyMatch
          ? 'Quantidade divergente'
          : 'Valor unitário divergente',
      }));

    setSaving(true);
    try {
      const reqId = await createAdjustmentRequest({
        fiscalInvoiceId: activeInvoice.id,
        invoiceNumber: activeInvoice.nfeNumber,
        docType: activeInvoice.docType || 'NFE',
        supplierName: activeInvoice.issuerName,
        supplierCnpj: activeInvoice.issuerCnpj,
        po,
        divergenceReasons:
          modalMatchPreview.reasons.length > 0
            ? modalMatchPreview.reasons
            : ['Divergência identificada pelo setor Fiscal'],
        divergentItems: divergentItemsSnapshot,
        poGrossTotal: modalMatchPreview.poGrossTotal ?? po.totalAmount,
        poNetTotal: modalMatchPreview.poTotal ?? po.totalAmount,
        invoiceGrossTotal: editTotalProducts,
        invoiceNetTotal: editComputedTotal,
        fiscalObservation: adjObservationInput.trim(),
      });
      setLinkPoId('');
      setActiveInvoice((prev) =>
        prev
          ? {
              ...prev,
              purchaseOrderId: '',
              poNumber: '',
              pendingAdjustmentId: reqId,
              pendingAdjustmentPoId: po.id,
              pendingAdjustmentPoNumber: po.poNumber,
              matchingStatus: 'pendente_vinculo',
            }
          : null
      );
      setModalSuccess(
        `Solicitação enviada ao setor de Compras referente ao Pedido ${po.poNumber}. A nota foi mantida sem vínculo definitivo até o ajuste.`
      );
    } catch (err) {
      setModalError(
        formatFiscalActionError(err, 'Falha ao enviar solicitação de ajuste para Compras.')
      );
    } finally {
      setSaving(false);
    }
  };

  const handleResolveOrUpdateActiveAdjustment = async (
    action: 'Resolvido' | 'Reaberto' | 'Cancelado'
  ) => {
    if (!activeInvoice || !activeAdjustmentRequest || !canEditActiveInvoice) return;
    setModalError(null);
    setModalSuccess(null);

    if (action === 'Reaberto' && !fiscalResolutionNote.trim()) {
      setModalError('Informe o motivo ao reabrir a solicitação para o setor de Compras.');
      return;
    }

    setSaving(true);
    try {
      if (action === 'Resolvido') {
        const targetPo = purchaseOrders.find((p) => p.id === activeAdjustmentRequest.purchaseOrderId);
        if (!targetPo) {
          throw new Error('Pedido de Compra da solicitação não encontrado.');
        }
        const linkMatch = adjustmentPreviewMatch;
        await updateAdjustmentRequestAsFiscal(
          activeAdjustmentRequest.id,
          'Resolvido',
          fiscalResolutionNote.trim() || 'Ajuste validado e Pedido vinculado pelo Fiscal.',
          {
            linkPo: {
              purchaseOrderId: targetPo.id,
              poNumber: targetPo.poNumber,
              matchingStatus: linkMatch?.status || 'conciliada',
              itemAssociations: linkMatch?.associations || editItemAssociations,
            },
          }
        );
        setLinkPoId(targetPo.id);
        if (linkMatch?.associations) {
          setEditItemAssociations(linkMatch.associations);
        }
        setActiveInvoice((prev) =>
          prev
            ? {
                ...prev,
                purchaseOrderId: targetPo.id,
                poNumber: targetPo.poNumber,
                pendingAdjustmentId: '',
                pendingAdjustmentPoId: '',
                pendingAdjustmentPoNumber: '',
                matchingStatus: linkMatch?.status || 'conciliada',
                itemAssociations: linkMatch?.associations || editItemAssociations,
              }
            : null
        );
        setModalSuccess(`Pedido ${targetPo.poNumber} vinculado e solicitação concluída.`);
      } else if (action === 'Reaberto') {
        const reqPo = purchaseOrders.find((p) => p.id === activeAdjustmentRequest.purchaseOrderId);
        const linkMatch = adjustmentPreviewMatch;
        const divergentItemsSnapshot = (linkMatch?.itemComparisons || [])
          .filter((cmp) => !cmp.matchedInPo || !cmp.qtyMatch || !cmp.unitPriceMatch)
          .map((cmp) => ({
            invoiceItemDescription: cmp.description,
            ...(cmp.poDescription ? { poItemDescription: cmp.poDescription } : {}),
            poQty: cmp.poQty,
            invoiceQty: cmp.invoiceQty,
            poUnitPrice: cmp.poUnitPrice,
            invoiceUnitPrice: cmp.invoiceUnitPrice,
            reason: !cmp.matchedInPo
              ? 'Item não conciliado no Pedido'
              : !cmp.qtyMatch
              ? 'Quantidade divergente'
              : 'Valor unitário divergente',
          }));
        await updateAdjustmentRequestAsFiscal(
          activeAdjustmentRequest.id,
          'Reaberto',
          fiscalResolutionNote.trim(),
          {
            divergenceReasons: linkMatch?.reasons || activeAdjustmentRequest.divergenceReasons,
            divergentItems: divergentItemsSnapshot,
            poGrossTotal: linkMatch?.poGrossTotal ?? reqPo?.totalAmount ?? activeAdjustmentRequest.poGrossTotal,
            poNetTotal: linkMatch?.poTotal ?? reqPo?.totalAmount ?? activeAdjustmentRequest.poNetTotal,
            invoiceGrossTotal: editTotalProducts,
            invoiceNetTotal: editComputedTotal,
          }
        );
        setFiscalResolutionNote('');
        setModalSuccess('Solicitação reaberta para nova revisão do setor de Compras.');
      } else {
        await updateAdjustmentRequestAsFiscal(
          activeAdjustmentRequest.id,
          'Cancelado',
          fiscalResolutionNote.trim() || 'Solicitação cancelada pelo setor Fiscal.'
        );
        setActiveInvoice((prev) =>
          prev
            ? {
                ...prev,
                pendingAdjustmentId: '',
                pendingAdjustmentPoId: '',
                pendingAdjustmentPoNumber: '',
              }
            : null
        );
        setFiscalResolutionNote('');
        setModalSuccess('Solicitação de ajuste cancelada.');
      }
    } catch (err) {
      setModalError(
        formatFiscalActionError(err, 'Falha ao atualizar solicitação de ajuste.')
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveReconciliation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeInvoice || !modalMatchPreview || !canEditActiveInvoice) return;
    setModalError(null);
    setModalSuccess(null);

    const po = purchaseOrders.find((p) => p.id === linkPoId);
    const rec = physicalReceipts.find((r) => r.id === linkReceiptId);

    if (activeAdjustmentRequest && po) {
      setModalError(
        'Esta nota possui uma solicitação de ajuste aberta com Compras. Utilize "Resolver e Vincular Pedido" ou cancele a solicitação antes de vincular manualmente.'
      );
      return;
    }

    if (editFiscalStatus === 'lancado' || editFiscalStatus === 'escriturada') {
      if (!po) {
        setModalError(
          'Liberação bloqueada: é obrigatório vincular um Pedido de Compra antes de lançar a nota fiscal.'
        );
        return;
      }
      if (requiresReceiptForActive && !rec) {
        setModalError(
          'Liberação bloqueada: esta nota exige confirmação de recebimento físico pelo setor de Recebimento antes do lançamento.'
        );
        return;
      }
    }

    if (!requiresReceiptForActive && editFiscalStatus === 'aguardando_recebimento') {
      setModalError(
        'Notas que dispensam o recebimento físico não utilizam o status Aguardando Recebimento (utilize Pendente ou Lançado).'
      );
      return;
    }

    if (po && po.id !== activeInvoice.purchaseOrderId) {
      const poCnpj = normalizeCnpjDigits(po.supplierCnpj);
      const invCnpj = normalizeCnpjDigits(activeInvoice.issuerCnpj);
      const summary = getPoReceptionSummary(po, physicalReceipts);
      const remainingQty = summary.totalOrdered - summary.totalReceived;
      if (poCnpj !== invCnpj) {
        setModalError(
          `Vínculo inválido: o pedido ${po.poNumber} (${po.supplierCnpj}) pertence a um CNPJ diferente do documento fiscal (${activeInvoice.issuerCnpj}).`
        );
        return;
      }
      if (po.status === 'cancelado' || po.status === 'concluido' || remainingQty <= 0.0001) {
        setModalError(
          `Vínculo inválido: o pedido ${po.poNumber} não possui mais saldo pendente de entrada.`
        );
        return;
      }
    }

    let replacementInv: FiscalInvoice | undefined;
    if (editFiscalStatus === 'substituida') {
      replacementInv = fiscalInvoices.find((f) => f.id === replacedByInvoiceId);
      if (!replacementInv) {
        setModalError(
          'Selecione a nota fiscal pendente deste mesmo fornecedor que substituiu este documento.'
        );
        return;
      }
      if (
        normalizeCnpjDigits(replacementInv.issuerCnpj) !==
        normalizeCnpjDigits(activeInvoice.issuerCnpj)
      ) {
        setModalError(
          'A nota substituta precisa pertencer ao mesmo CNPJ do fornecedor deste documento.'
        );
        return;
      }
    }

    const linkedInv =
      activeInvoice.docType === 'CTE' && editLinkedInvoiceId
        ? fiscalInvoices.find((f) => f.id === editLinkedInvoiceId)
        : undefined;

    const effectiveDocType = activeInvoice.docType || 'NFE';
    const finalReceipt = requiresReceiptForActive ? rec : undefined;

    setSaving(true);
    try {
      await updateFiscalInvoice(activeInvoice.id, {
        purchaseOrderId: po?.id || '',
        poNumber: po?.poNumber || '',
        receiptId: finalReceipt?.id || '',
        receiptNumber: finalReceipt?.receiptNumber || '',
        requiresPhysicalReceipt: requiresReceiptForActive,
        isPartialBilling: Boolean(po && editIsPartialBilling),
        itemAssociations: modalMatchPreview.associations,
        linkedInvoiceId: effectiveDocType === 'CTE' ? linkedInv?.id || '' : '',
        linkedInvoiceNumber: effectiveDocType === 'CTE' ? linkedInv?.nfeNumber || '' : '',
        originState: effectiveDocType === 'CTE' ? editOriginState : '',
        originCity: effectiveDocType === 'CTE' ? editOriginCity : '',
        destinationState: effectiveDocType === 'CTE' ? editDestinationState : '',
        destinationCity: effectiveDocType === 'CTE' ? editDestinationCity : '',
        issuerState:
          effectiveDocType === 'NFE'
            ? editIssuerState.trim().toUpperCase()
            : (activeInvoice.issuerState || '').trim().toUpperCase(),
        suframaPinNumber: effectiveDocType === 'NFE' ? editSuframaPinNumber.trim() : '',
        suframaPinAcceptanceDate:
          effectiveDocType === 'NFE' ? editSuframaPinAcceptanceDate : '',
        suframaPinReceiptDate:
          effectiveDocType === 'NFE' ? editSuframaPinReceiptDate : '',
        suframaClearanceDate: effectiveDocType === 'NFE' ? editSuframaClearanceDate : '',
        grossAmount: Number(editTotalProducts || 0),
        totalProducts: Number(editTotalProducts || 0),
        freightAmount: effectiveDocType === 'NFSE' ? 0 : Number(editFreightAmount || 0),
        insuranceAmount: effectiveDocType === 'NFSE' ? 0 : Number(editInsuranceAmount || 0),
        otherExpensesAmount: Number(editOtherExpensesAmount || 0),
        surchargeAmount: Number(editSurchargeAmount || 0),
        discountAmount: Number(editDiscountAmount || 0),
        icmsAmount: effectiveDocType === 'NFSE' ? 0 : Number(editIcmsAmount || 0),
        icmsDesonAmount: effectiveDocType === 'NFSE' ? 0 : Number(editIcmsDesonAmount || 0),
        icmsStAmount: effectiveDocType === 'NFE' ? Number(editIcmsStAmount || 0) : 0,
        ipiAmount: effectiveDocType === 'NFE' ? Number(editIpiAmount || 0) : 0,
        retainedTaxesAmount:
          effectiveDocType === 'NFSE' ? 0 : Number(editRetainedTaxesAmount || 0),
        taxRegime: effectiveDocType === 'NFSE' ? editTaxRegime : '',
        pisAmount:
          effectiveDocType === 'NFSE'
            ? editTaxRegime === 'regime_normal'
              ? Number(editPisAmount || 0)
              : 0
            : Number(editPisAmount || 0),
        cofinsAmount:
          effectiveDocType === 'NFSE'
            ? editTaxRegime === 'regime_normal'
              ? Number(editCofinsAmount || 0)
              : 0
            : Number(editCofinsAmount || 0),
        csllAmount:
          effectiveDocType === 'NFSE'
            ? editTaxRegime === 'regime_normal'
              ? Number(editCsllAmount || 0)
              : 0
            : Number(editCsllAmount || 0),
        issqnAmount:
          effectiveDocType === 'NFSE'
            ? editTaxRegime === 'mei'
              ? 0
              : Number(editIssqnAmount || 0)
            : Number(activeInvoice.issqnAmount || 0),
        issqnRetained: effectiveDocType === 'NFSE' ? editIssqnRetained : true,
        inssAmount:
          effectiveDocType === 'NFSE'
            ? editTaxRegime === 'mei'
              ? 0
              : Number(editInssAmount || 0)
            : Number(activeInvoice.inssAmount || 0),
        irrfAmount:
          effectiveDocType === 'NFSE'
            ? editTaxRegime === 'regime_normal'
              ? Number(editIrrfAmount || 0)
              : 0
            : Number(activeInvoice.irrfAmount || 0),
        totalInvoice: editComputedTotal,
        matchingStatus: modalMatchPreview.status,
        fiscalStatus: editFiscalStatus,
        replacedByInvoiceId: editFiscalStatus === 'substituida' ? replacementInv?.id || '' : '',
        replacedByInvoiceNumber:
          editFiscalStatus === 'substituida' ? replacementInv?.nfeNumber || '' : '',
        bookkeepingDate:
          editFiscalStatus === 'lancado' || editFiscalStatus === 'escriturada'
            ? editBookkeepingDate.trim() || todayISO()
            : editBookkeepingDate.trim(),
        cfop: activeInvoice.cfop,
        notes: editNotes.trim(),
      });
      setActiveInvoice(null);
    } catch (err) {
      setModalError(
        formatFiscalActionError(err, 'Erro ao atualizar escrituração da nota fiscal.')
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmUnlink = async () => {
    if (!unlinkTarget) return;
    setSaving(true);
    try {
      await unlinkFiscalInvoice(unlinkTarget.id, true, true);
      setUnlinkTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (supervisorPassword?: string) => {
    if (!deleteTarget) return;
    setSaving(true);
    setDeleteError(null);
    try {
      const deletedNumber = deleteTarget.nfeNumber;
      await deleteFiscalInvoice(deleteTarget.id, supervisorPassword);
      setDeleteTarget(null);
      setBatchSuccess(`Documento fiscal ${deletedNumber} excluído definitivamente.`);
    } catch (err) {
      setDeleteError(
        formatFiscalActionError(err, 'Não foi possível excluir o documento fiscal.')
      );
    } finally {
      setSaving(false);
    }
  };

  // Manual Invoice Creation helpers
  const manualItemsSubtotal = useMemo(
    () =>
      Number(
        manualItems
          .reduce((sum, it) => sum + Number(it.qty || 0) * Number(it.unitPrice || 0), 0)
          .toFixed(2)
      ),
    [manualItems]
  );

  const manualComputedTotal = useMemo(
    () =>
      calculateFiscalNetTotal({
        docType: manualDocType,
        totalProducts: manualItemsSubtotal,
        freightAmount: manualFreightAmount,
        insuranceAmount: manualInsuranceAmount,
        otherExpensesAmount: manualOtherExpensesAmount,
        surchargeAmount: manualSurchargeAmount,
        ipiAmount: manualIpiAmount,
        icmsStAmount: manualIcmsStAmount,
        discountAmount: manualDiscountAmount,
        retainedTaxesAmount: manualRetainedTaxesAmount,
        taxRegime: manualDocType === 'NFSE' ? manualTaxRegime : '',
        pisAmount: manualPisAmount,
        cofinsAmount: manualCofinsAmount,
        csllAmount:
          manualDocType === 'NFSE'
            ? manualTaxRegime === 'regime_normal'
              ? manualCsllAmount
              : 0
            : 0,
        issqnAmount: manualIssqnAmount,
        issqnRetained: manualIssqnRetained,
        inssAmount: manualInssAmount,
        irrfAmount: manualIrrfAmount,
      }),
    [
      manualDocType,
      manualItemsSubtotal,
      manualFreightAmount,
      manualInsuranceAmount,
      manualOtherExpensesAmount,
      manualSurchargeAmount,
      manualIpiAmount,
      manualIcmsStAmount,
      manualDiscountAmount,
      manualRetainedTaxesAmount,
      manualTaxRegime,
      manualPisAmount,
      manualCofinsAmount,
      manualCsllAmount,
      manualIssqnAmount,
      manualIssqnRetained,
      manualInssAmount,
      manualIrrfAmount,
    ]
  );

  const manualEligiblePurchaseOrders = useMemo(() => {
    const cnpjDigits = normalizeCnpjDigits(manualIssuerCnpj);
    return purchaseOrders
      .map((po) => {
        const summary = getPoReceptionSummary(po, physicalReceipts);
        const remainingQty = Math.max(
          0,
          Number((summary.totalOrdered - summary.totalReceived).toFixed(4))
        );
        return { po, summary, remainingQty };
      })
      .filter(({ po, remainingQty }) => {
        if (po.status === 'cancelado' || po.status === 'concluido') return false;
        if (remainingQty <= 0.0001) return false;
        if (cnpjDigits.length === 14) {
          return normalizeCnpjDigits(po.supplierCnpj) === cnpjDigits;
        }
        return true;
      });
  }, [purchaseOrders, physicalReceipts, manualIssuerCnpj]);

  const manualMatchPreview = useMemo(() => {
    const po = purchaseOrders.find((p) => p.id === manualPoId);
    if (!po) return null;
    const formattedCnpj = isValidCnpj(manualIssuerCnpj)
      ? maskCnpj(manualIssuerCnpj)
      : po.supplierCnpj;
    const sanitizedItems = manualItems.map((it, idx) => ({
      code: it.code.trim() || `ITEM-${String(idx + 1).padStart(3, '0')}`,
      description: it.description.trim() || 'Item',
      ncm: it.ncm.trim(),
      cfop: '0000',
      unit: it.unit.trim() || 'UN',
      qty: Number(it.qty || 0),
      unitPrice: Number(it.unitPrice || 0),
      totalPrice: Number((Number(it.qty || 0) * Number(it.unitPrice || 0)).toFixed(2)),
    }));
    const otherLinkedForPo = fiscalInvoices
      .filter((f) => f.purchaseOrderId === po.id)
      .map((f) => ({
        id: f.id,
        docType: f.docType,
        grossAmount: f.grossAmount,
        totalProducts: f.totalProducts,
        totalInvoice: f.totalInvoice,
        discountAmount: f.discountAmount,
        otherExpensesAmount: f.otherExpensesAmount,
        surchargeAmount: f.surchargeAmount,
        items: f.items,
        itemAssociations: f.itemAssociations,
      }));
    return evaluatePreImportMatch(
      {
        docType: manualDocType,
        issuerCnpj: formattedCnpj,
        grossAmount: manualItemsSubtotal,
        totalProducts: manualItemsSubtotal,
        discountAmount: manualDiscountAmount,
        otherExpensesAmount: manualOtherExpensesAmount,
        surchargeAmount: manualSurchargeAmount,
        totalInvoice: manualComputedTotal,
        items: sanitizedItems,
        purchaseOrderId: po.id,
        receiptId: '',
        requiresPhysicalReceipt: manualRequiresPhysicalReceipt,
        isPartialBilling: manualIsPartialBilling,
      },
      po,
      {
        savedEquivalences: productEquivalences,
        otherLinkedInvoicesForPo: otherLinkedForPo,
      }
    );
  }, [
    purchaseOrders,
    fiscalInvoices,
    productEquivalences,
    manualPoId,
    manualDocType,
    manualIssuerCnpj,
    manualItems,
    manualItemsSubtotal,
    manualDiscountAmount,
    manualOtherExpensesAmount,
    manualSurchargeAmount,
    manualComputedTotal,
    manualRequiresPhysicalReceipt,
    manualIsPartialBilling,
  ]);

  const handleManualTaxRegimeChange = (nextRegime: ServiceTaxRegime) => {
    setManualTaxRegime(nextRegime);
    if (nextRegime === 'mei') {
      setManualPisAmount(0);
      setManualCofinsAmount(0);
      setManualCsllAmount(0);
      setManualIssqnAmount(0);
      setManualInssAmount(0);
      setManualIrrfAmount(0);
    } else if (nextRegime === 'simples_nacional') {
      setManualPisAmount(0);
      setManualCofinsAmount(0);
      setManualCsllAmount(0);
      setManualIrrfAmount(0);
    }
  };

  const openManualModal = () => {
    setBatchSuccess(null);
    setManualDocType('NFE');
    setManualNfeNumber('');
    setManualSeries('1');
    setManualIssueDate(todayISO());
    setManualAccessKey('');
    setManualIssuerName('');
    setManualIssuerCnpj('');
    setManualPoId('');
    setManualRequiresPhysicalReceipt(true);
    setManualIsPartialBilling(false);
    setManualNotifyCompras(false);
    setManualAdjObservation('');
    setManualFreightAmount(0);
    setManualInsuranceAmount(0);
    setManualOtherExpensesAmount(0);
    setManualSurchargeAmount(0);
    setManualDiscountAmount(0);
    setManualIcmsAmount(0);
    setManualIcmsDesonAmount(0);
    setManualIcmsStAmount(0);
    setManualIpiAmount(0);
    setManualRetainedTaxesAmount(0);
    setManualPisAmount(0);
    setManualCofinsAmount(0);
    setManualCsllAmount(0);
    setManualIssqnAmount(0);
    setManualIssqnRetained(true);
    setManualInssAmount(0);
    setManualIrrfAmount(0);
    setManualTaxRegime('simples_nacional');
    setManualLinkedInvoiceId('');
    setManualOriginState('');
    setManualOriginCity('');
    setManualDestinationState('');
    setManualDestinationCity('');
    setManualIssuerState('');
    setManualSuframaPinNumber('');
    setManualSuframaPinAcceptanceDate('');
    setManualSuframaPinReceiptDate('');
    setManualSuframaClearanceDate('');
    setManualComplementaryInfo('');
    setManualNotes('');
    setManualItems([
      {
        code: 'ITEM-001',
        description: '',
        ncm: '',
        cfop: '0000',
        unit: 'UN',
        qty: 1,
        unitPrice: 0,
        totalPrice: 0,
      },
    ]);
    setManualFormError(null);
    setManualModalOpen(true);
  };

  const handleManualSelectPo = (nextPoId: string) => {
    setManualPoId(nextPoId);
    if (!nextPoId) {
      setManualIsPartialBilling(false);
      setManualNotifyCompras(false);
      setManualAdjObservation('');
    }
    const po = purchaseOrders.find((p) => p.id === nextPoId);
    if (po) {
      if (!manualIssuerName.trim()) {
        setManualIssuerName(po.supplierName);
      }
      if (!manualIssuerCnpj.trim()) {
        setManualIssuerCnpj(maskCnpj(po.supplierCnpj));
      }
    }
  };

  const handleImportItemsFromManualPo = () => {
    const po = purchaseOrders.find((p) => p.id === manualPoId);
    if (!po || po.items.length === 0) return;
    setManualItems(
      po.items.slice(0, BLUEPRINT_LIMITS.MAX_ITEMS).map((it, idx) => ({
        code: it.code || `ITEM-${String(idx + 1).padStart(3, '0')}`,
        description: it.description,
        ncm: '',
        cfop: '0000',
        unit: it.unit || 'UN',
        qty: Number(it.qtyOrdered || 1),
        unitPrice: Number(it.unitPrice || 0),
        totalPrice: Number((Number(it.qtyOrdered || 0) * Number(it.unitPrice || 0)).toFixed(2)),
      }))
    );
  };

  const updateManualItemField = (
    idx: number,
    field: keyof FiscalInvoiceItem,
    val: string | number
  ) => {
    setManualItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const updated = { ...it, [field]: val };
        updated.totalPrice = Number(
          (Number(updated.qty || 0) * Number(updated.unitPrice || 0)).toFixed(2)
        );
        return updated;
      })
    );
  };

  const addManualItemRow = () => {
    if (manualItems.length >= BLUEPRINT_LIMITS.MAX_ITEMS) return;
    setManualItems((prev) => [
      ...prev,
      {
        code: `ITEM-${String(prev.length + 1).padStart(3, '0')}`,
        description: '',
        ncm: '',
        cfop: '0000',
        unit: 'UN',
        qty: 1,
        unitPrice: 0,
        totalPrice: 0,
      },
    ]);
  };

  const removeManualItemRow = (idx: number) => {
    if (manualItems.length <= 1) return;
    setManualItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualFormError(null);

    if (!manualNfeNumber.trim()) {
      setManualFormError('Informe o Número do documento fiscal.');
      return;
    }
    if (!manualIssuerName.trim()) {
      setManualFormError('Informe a Razão Social do emitente/fornecedor.');
      return;
    }
    if (!isValidCnpj(manualIssuerCnpj)) {
      setManualFormError(
        'CNPJ do emitente inválido. Preencha os 14 dígitos e confira os dígitos verificadores.'
      );
      return;
    }
    if (!manualIssueDate) {
      setManualFormError('Informe a Data de Emissão.');
      return;
    }
    if (
      manualItems.length === 0 ||
      manualItems.some((it) => !it.description.trim() || Number(it.qty) <= 0 || Number(it.unitPrice) < 0)
    ) {
      setManualFormError(
        'Todos os itens devem possuir descrição, quantidade maior que zero e valor unitário não negativo.'
      );
      return;
    }

    const cleanedKeyInput = manualAccessKey.replace(/[^a-zA-Z0-9_\-]/g, '');
    if (manualAccessKey.trim() && cleanedKeyInput.length < 8) {
      setManualFormError(
        'A Chave de Acesso / Protocolo informada deve ter ao menos 8 caracteres alfanuméricos (ou deixe em branco para gerar um protocolo interno).'
      );
      return;
    }

    const normalizedNum = manualNfeNumber.replace(/[^a-zA-Z0-9]/g, '') || 'DOC';
    const finalAccessKey = (
      cleanedKeyInput || `MANUAL-${manualDocType}-${normalizedNum}-${Date.now()}`
    ).slice(0, BLUEPRINT_LIMITS.MAX_ACCESS_KEY);

    if (fiscalInvoices.some((f) => f.accessKey === finalAccessKey)) {
      setManualFormError('Já existe um documento fiscal cadastrado com esta Chave de Acesso.');
      return;
    }

    const po = purchaseOrders.find((p) => p.id === manualPoId);
    if (po) {
      const poCnpj = normalizeCnpjDigits(po.supplierCnpj);
      const invCnpj = normalizeCnpjDigits(manualIssuerCnpj);
      if (poCnpj !== invCnpj) {
        setManualFormError(
          `O Pedido ${po.poNumber} (${po.supplierCnpj}) pertence a um CNPJ diferente do emitente informado.`
        );
        return;
      }
      const summary = getPoReceptionSummary(po, physicalReceipts);
      const remainingQty = summary.totalOrdered - summary.totalReceived;
      if (po.status === 'cancelado' || po.status === 'concluido' || remainingQty <= 0.0001) {
        setManualFormError(`O Pedido ${po.poNumber} não possui mais saldo pendente de entrada.`);
        return;
      }
    }

    const finalTotalInvoice = manualComputedTotal;
    const requiresPhysicalReceipt = manualRequiresPhysicalReceipt;
    const initialFiscalStatus: 'aguardando_recebimento' | 'pendente' = requiresPhysicalReceipt
      ? 'aguardando_recebimento'
      : 'pendente';

    const formattedCnpj = maskCnpj(manualIssuerCnpj);
    const sanitizedItems: FiscalInvoiceItem[] = manualItems.map((it, idx) => ({
      code: it.code.trim() || `ITEM-${String(idx + 1).padStart(3, '0')}`,
      description: it.description.trim(),
      ncm: it.ncm.trim(),
      cfop: '0000',
      unit: it.unit.trim() || 'UN',
      qty: Number(it.qty),
      unitPrice: Number(it.unitPrice),
      totalPrice: Number((Number(it.qty) * Number(it.unitPrice)).toFixed(2)),
    }));

    const otherLinkedForPo = po
      ? fiscalInvoices
          .filter((f) => f.purchaseOrderId === po.id)
          .map((f) => ({
            id: f.id,
            docType: f.docType,
            grossAmount: f.grossAmount,
            totalProducts: f.totalProducts,
            totalInvoice: f.totalInvoice,
            discountAmount: f.discountAmount,
            otherExpensesAmount: f.otherExpensesAmount,
            surchargeAmount: f.surchargeAmount,
            items: f.items,
            itemAssociations: f.itemAssociations,
          }))
      : [];

    const match = evaluatePreImportMatch(
      {
        docType: manualDocType,
        issuerCnpj: formattedCnpj,
        grossAmount: manualItemsSubtotal,
        totalProducts: manualItemsSubtotal,
        discountAmount: manualDiscountAmount,
        otherExpensesAmount: manualOtherExpensesAmount,
        surchargeAmount: manualSurchargeAmount,
        totalInvoice: finalTotalInvoice,
        items: sanitizedItems,
        purchaseOrderId: po?.id || '',
        receiptId: '',
        requiresPhysicalReceipt,
        isPartialBilling: Boolean(po && manualIsPartialBilling),
      },
      po,
      {
        savedEquivalences: productEquivalences,
        otherLinkedInvoicesForPo: otherLinkedForPo,
      }
    );

    const linkedInv =
      manualDocType === 'CTE' && manualLinkedInvoiceId
        ? fiscalInvoices.find((f) => f.id === manualLinkedInvoiceId)
        : undefined;

    const effectivePis =
      manualDocType === 'NFSE'
        ? manualTaxRegime === 'regime_normal'
          ? Number(manualPisAmount || 0)
          : 0
        : Number(manualPisAmount || 0);
    const effectiveCofins =
      manualDocType === 'NFSE'
        ? manualTaxRegime === 'regime_normal'
          ? Number(manualCofinsAmount || 0)
          : 0
        : Number(manualCofinsAmount || 0);
    const effectiveCsll =
      manualDocType === 'NFSE' && manualTaxRegime === 'regime_normal'
        ? Number(manualCsllAmount || 0)
        : 0;
    const effectiveIssqn =
      manualDocType === 'NFSE' && manualTaxRegime !== 'mei'
        ? Number(manualIssqnAmount || 0)
        : 0;
    const effectiveInss =
      manualDocType === 'NFSE' && manualTaxRegime !== 'mei'
        ? Number(manualInssAmount || 0)
        : 0;
    const effectiveIrrf =
      manualDocType === 'NFSE' && manualTaxRegime === 'regime_normal'
        ? Number(manualIrrfAmount || 0)
        : 0;

    const shouldSendAdjustment = Boolean(manualNotifyCompras && po);
    const divergentItemsSnapshot = match.itemComparisons
      .filter((cmp) => !cmp.matchedInPo || !cmp.qtyMatch || !cmp.unitPriceMatch)
      .map((cmp) => ({
        invoiceItemDescription: cmp.description,
        ...(cmp.poDescription ? { poItemDescription: cmp.poDescription } : {}),
        poQty: cmp.poQty,
        invoiceQty: cmp.invoiceQty,
        poUnitPrice: cmp.poUnitPrice,
        invoiceUnitPrice: cmp.invoiceUnitPrice,
        reason: !cmp.matchedInPo
          ? 'Item não conciliado no Pedido'
          : !cmp.qtyMatch
          ? 'Quantidade divergente'
          : 'Valor unitário divergente',
      }));

    setSaving(true);
    try {
      await createFiscalInvoicesBatch([
        {
          invoiceData: {
            docType: manualDocType,
            accessKey: finalAccessKey,
            nfeNumber: manualNfeNumber.trim(),
            series: manualDocType === 'NFSE' ? '' : manualSeries.trim() || '1',
            issuerName: manualIssuerName.trim(),
            issuerCnpj: formattedCnpj,
            issueDate: manualIssueDate,
            cfop: '0000',
            grossAmount: manualItemsSubtotal,
            freightAmount: manualDocType === 'NFSE' ? 0 : Number(manualFreightAmount || 0),
            insuranceAmount: manualDocType === 'NFSE' ? 0 : Number(manualInsuranceAmount || 0),
            otherExpensesAmount: Number(manualOtherExpensesAmount || 0),
            surchargeAmount: Number(manualSurchargeAmount || 0),
            discountAmount: Number(manualDiscountAmount || 0),
            totalProducts: manualItemsSubtotal,
            icmsAmount: manualDocType === 'NFSE' ? 0 : Number(manualIcmsAmount || 0),
            icmsDesonAmount: manualDocType === 'NFSE' ? 0 : Number(manualIcmsDesonAmount || 0),
            icmsStAmount: manualDocType === 'NFE' ? Number(manualIcmsStAmount || 0) : 0,
            ipiAmount: manualDocType === 'NFE' ? Number(manualIpiAmount || 0) : 0,
            pisAmount: effectivePis,
            cofinsAmount: effectiveCofins,
            csllAmount: effectiveCsll,
            issqnAmount: effectiveIssqn,
            issqnRetained: manualDocType === 'NFSE' ? manualIssqnRetained : true,
            inssAmount: effectiveInss,
            irrfAmount: effectiveIrrf,
            retainedTaxesAmount:
              manualDocType === 'NFSE' ? 0 : Number(manualRetainedTaxesAmount || 0),
            taxRegime: manualDocType === 'NFSE' ? manualTaxRegime : '',
            linkedInvoiceId: linkedInv?.id || '',
            linkedInvoiceNumber: linkedInv?.nfeNumber || '',
            originState: manualDocType === 'CTE' ? manualOriginState : '',
            originCity: manualDocType === 'CTE' ? manualOriginCity : '',
            destinationState: manualDocType === 'CTE' ? manualDestinationState : '',
            destinationCity: manualDocType === 'CTE' ? manualDestinationCity : '',
            issuerState: (
              manualIssuerState ||
              (manualDocType !== 'NFSE' ? getUfFromCodeOrAccessKey(finalAccessKey) : '')
            )
              .trim()
              .toUpperCase(),
            suframaPinNumber: manualDocType === 'NFE' ? manualSuframaPinNumber.trim() : '',
            suframaPinAcceptanceDate:
              manualDocType === 'NFE' ? manualSuframaPinAcceptanceDate : '',
            suframaPinReceiptDate: manualDocType === 'NFE' ? manualSuframaPinReceiptDate : '',
            suframaClearanceDate: manualDocType === 'NFE' ? manualSuframaClearanceDate : '',
            totalInvoice: finalTotalInvoice,
            complementaryInfo: manualComplementaryInfo.trim(),
            items: sanitizedItems,
            itemAssociations: match.associations,
            purchaseOrderId: shouldSendAdjustment ? '' : po?.id || '',
            poNumber: shouldSendAdjustment ? '' : po?.poNumber || '',
            receiptId: '',
            receiptNumber: '',
            matchingStatus: shouldSendAdjustment ? 'pendente_vinculo' : match.status,
            fiscalStatus: initialFiscalStatus,
            requiresPhysicalReceipt,
            isPartialBilling: Boolean(po && manualIsPartialBilling),
            conferenceStatus: 'pendente',
            bookkeepingDate: '',
            xmlImported: false,
            notes: manualNotes.trim(),
          },
          ...(shouldSendAdjustment && po
            ? {
                adjustmentRequest: {
                  po,
                  divergenceReasons:
                    match.reasons.length > 0
                      ? match.reasons
                      : ['Divergência sinalizada no cadastro manual'],
                  divergentItems: divergentItemsSnapshot,
                  poGrossTotal: match.poGrossTotal ?? po.totalAmount,
                  poNetTotal: match.poTotal ?? po.totalAmount,
                  invoiceGrossTotal: manualItemsSubtotal,
                  invoiceNetTotal: finalTotalInvoice,
                  fiscalObservation: manualAdjObservation.trim(),
                },
              }
            : {}),
        },
      ]);
      setManualModalOpen(false);
      setSubTab('controle');
      setBatchSuccess(
        `Documento ${DOC_TYPE_LABELS[manualDocType]} ${manualNfeNumber.trim()} cadastrado manualmente com sucesso.`
      );
    } catch (err) {
      setManualFormError(
        formatFiscalActionError(err, 'Falha ao cadastrar documento fiscal manualmente.')
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
          Acesso Restrito ao Setor Fiscal
        </h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          A visualização cruzada do módulo Fiscal foi desativada pelo ADM Titular para o seu perfil.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6 print:hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
              Módulo Fiscal & Importação de XML
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Importação individual ou em lote (NF-e, NFS-e Padrão Nacional e CT-e) e controle de escrituração
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 self-start">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setSubTab('controle')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  subTab === 'controle'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Controle de Notas ({fiscalInvoices.length})
              </button>
              {canCreate && (
                <button
                  type="button"
                  onClick={() => setSubTab('importar')}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    subTab === 'importar'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  Importar XML
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setEquivalencesModalOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Layers className="w-3.5 h-3.5" />
              Equivalências
            </button>

            <button
              type="button"
              disabled={filteredInvoices.length === 0}
              onClick={() => exportFiscalInvoicesToExcel(filteredInvoices, companyUf)}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Exportar Excel (.xlsx)
            </button>

            <button
              type="button"
              onClick={openReportModal}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimir Relatório
            </button>

            {canCreate && (
              <button
                type="button"
                onClick={openManualModal}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                Cadastrar Nota Manual
              </button>
            )}
          </div>
        </div>

      {!canCreate && !canEdit && (
        <div className="bg-slate-100 border border-slate-200 rounded-lg px-4 py-3 flex items-center gap-2.5 text-xs text-slate-700">
          <Lock className="w-4 h-4 text-slate-500 shrink-0" />
          <span>
            Modo somente leitura: importação de XML, vinculação e escrituração fiscal são restritas ao setor Fiscal ou ao ADM Titular.
          </span>
        </div>
      )}

      {batchSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3 text-xs text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{batchSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setBatchSuccess(null)}
            className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {subTab === 'controle' ? (
        <>
          {/* Summary KPI strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <span className="text-xs text-slate-500 block">Valor Total em Documentos Fiscais</span>
              <span className="font-mono text-xl font-semibold text-slate-900 tabular-nums mt-1 block">
                {formatBRL(fiscalTotals.totalValue)}
              </span>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <span className="text-xs text-slate-500 block">Frete Total em Notas / CT-e</span>
              <span className="font-mono text-xl font-semibold text-slate-900 tabular-nums mt-1 block">
                {formatBRL(fiscalTotals.totalFreight)}
              </span>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <span className="text-xs text-slate-500 block">Ciclo de Entrada & Lançamento</span>
              <span className="text-sm font-semibold text-slate-900 tabular-nums mt-2 block">
                {fiscalTotals.pendingReceiveCount} aguard. · {fiscalTotals.pendingLaunchCount} pendente(s) · {fiscalTotals.bookedCount} lançadas · {fiscalTotals.replacedCount} subst.
              </span>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <span className="text-xs text-slate-500 block">
                Notas de Fora (≠ {companyUf}) & SUFRAMA
              </span>
              <span className="text-sm font-semibold text-slate-900 tabular-nums mt-1.5 block">
                {fiscalTotals.outOfStateNfeCount} fora do estado ·{' '}
                <span className={fiscalTotals.pendingSuframaCount > 0 ? 'text-amber-700' : 'text-slate-700'}>
                  {fiscalTotals.pendingSuframaCount} s/ PIN ou desemb.
                </span>
              </span>
            </div>
          </div>

          {/* Search & filter */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por tipo, nº nota, UF, PIN SUFRAMA, chave, emitente ou pedido..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                {(
                  [
                    { id: 'todos', label: 'Todas' },
                    { id: 'aguardando_recebimento', label: 'Aguardando Recebimento' },
                    { id: 'pendente', label: 'Pendente' },
                    { id: 'lancado', label: 'Lançado' },
                    { id: 'aguardando_ajuste', label: 'Aguard. Ajuste Compras' },
                    { id: 'substituida', label: 'Substituídas' },
                    { id: 'rejeitada', label: 'Rejeitadas' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFiscalFilter(tab.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      fiscalFilter === tab.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-slate-600 whitespace-nowrap">
                    Competência:
                  </label>
                  <input
                    type="month"
                    value={competenceFilter}
                    onChange={(e) => setCompetenceFilter(e.target.value)}
                    className="px-2.5 py-1 text-xs font-mono tabular-nums border border-slate-300 rounded-md bg-white text-slate-800"
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-slate-600 whitespace-nowrap">
                    Data de Lançamento:
                  </label>
                  <input
                    type="date"
                    value={bookingDateFilter}
                    onChange={(e) => setBookingDateFilter(e.target.value)}
                    className="px-2.5 py-1 text-xs font-mono tabular-nums border border-slate-300 rounded-md bg-white text-slate-800"
                  />
                </div>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer whitespace-nowrap"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      { id: 'todos', label: 'Todas Origens' },
                      { id: 'fora', label: `Notas de Fora (≠ ${companyUf})` },
                      { id: 'pin_pendente', label: 'PIN / Desembaraço Pendente' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setInterstateFilter(opt.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                        interstateFilter === opt.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-slate-600 whitespace-nowrap">
                    UF Empresa:
                  </label>
                  <select
                    value={companyUf}
                    onChange={(e) => handleCompanyUfChange(e.target.value)}
                    className="px-2.5 py-1 text-xs font-mono font-semibold border border-slate-300 rounded-md bg-white text-slate-800"
                  >
                    {BRAZIL_STATES.map((st) => (
                      <option key={st.uf} value={st.uf}>
                        {st.uf} — {st.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
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
            ) : filteredInvoices.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm font-medium text-slate-900 mb-1">
                  Nenhum documento fiscal encontrado
                </p>
                <p className="text-xs text-slate-500 mb-4">
                  Importe arquivos XML de NF-e, NFS-e ou CT-e ou cadastre um documento manualmente.
                </p>
                {canCreate && (
                  <div className="inline-flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSubTab('importar')}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Importar XML Agora
                    </button>
                    <button
                      type="button"
                      onClick={openManualModal}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Cadastrar Nota Manual
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                      <th className="py-3 px-4">Documento</th>
                      <th className="py-3 px-4">Emitente / Chave</th>
                      <th className="py-3 px-4">Vínculo P2P</th>
                      <th className="py-3 px-4">Bruto / Frete</th>
                      <th className="py-3 px-4 text-right">Total Nota</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredInvoices.map((inv) => {
                      const isBooked =
                        inv.fiscalStatus === 'lancado' || inv.fiscalStatus === 'escriturada';
                      const rowCanEdit = canEdit && (isAdmin || !isBooked);
                      const rowCanDelete = canDelete && (isAdmin || !isBooked);
                      const docLabel = DOC_TYPE_LABELS[inv.docType || 'NFE'];
                      const effectiveUf = getEffectiveIssuerUf(inv);
                      const outOfState = isOutOfStateNfe(inv);

                      return (
                        <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                              {docLabel} {inv.nfeNumber}
                              {inv.docType !== 'NFSE' ? ` · S${inv.series}` : ''}
                              {effectiveUf ? ` · UF ${effectiveUf}` : ''}
                            </div>
                            <div className="text-xs text-slate-500 tabular-nums">
                              {formatDateBR(inv.issueDate)} · {inv.items.length} item(ns) ·{' '}
                              {inv.xmlImported ? 'XML' : 'Manual'}
                              {outOfState && (
                                <span className="text-amber-700 font-semibold">
                                  {' '}
                                  · Fora ({effectiveUf}→{companyUf})
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="text-xs font-medium text-slate-900 max-w-[210px] truncate">
                              {inv.issuerName}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono tabular-nums">
                              <span>{inv.issuerCnpj}</span>
                              <span aria-hidden="true">·</span>
                              <span>{formatAccessKeyShort(inv.accessKey)}</span>
                              <button
                                type="button"
                                onClick={() => handleCopyKey(inv.accessKey)}
                                title="Copiar chave de acesso completa"
                                className="text-slate-400 hover:text-slate-700 cursor-pointer"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                              {copiedKey === inv.accessKey && (
                                <span className="text-[11px] text-emerald-700 font-sans">
                                  Copiada
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs whitespace-nowrap">
                            {inv.purchaseOrderId ||
                            inv.receiptId ||
                            inv.linkedInvoiceNumber ||
                            (inv.originCity && inv.destinationCity) ? (
                              <div className="font-mono text-slate-800 space-y-0.5">
                                {inv.purchaseOrderId || inv.receiptId || inv.requiresPhysicalReceipt === false ? (
                                  <>
                                    <div className="flex items-center gap-1.5">
                                      <span>{inv.poNumber || 'Sem Pedido'}</span>
                                      {inv.isPartialBilling && (
                                        <span className="font-sans text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                          Parcial
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-slate-500">
                                      {inv.receiptNumber ||
                                        (inv.requiresPhysicalReceipt === false
                                          ? 'Dispensa doca'
                                          : 'Sem Recebimento')}
                                    </div>
                                  </>
                                ) : null}
                                {inv.docType === 'CTE' && inv.linkedInvoiceNumber && (
                                  <div className="text-blue-700">
                                    NF Vinc.: {inv.linkedInvoiceNumber}
                                  </div>
                                )}
                                {inv.docType === 'CTE' &&
                                  (inv.originCity || inv.destinationCity) && (
                                    <div className="text-[11px] font-sans text-slate-500">
                                      {inv.originCity}/{inv.originState} → {inv.destinationCity}/
                                      {inv.destinationState}
                                    </div>
                                  )}
                              </div>
                            ) : (
                              <span className="text-slate-400">Não vinculada</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs font-mono tabular-nums whitespace-nowrap">
                            <div className="text-slate-800">
                              {formatBRL(Number(inv.grossAmount ?? inv.totalProducts))}
                            </div>
                            <div className="text-slate-500 font-sans">
                              {inv.docType === 'NFSE' && inv.taxRegime
                                ? SERVICE_TAX_REGIME_LABELS[inv.taxRegime as ServiceTaxRegime]?.split(' ')[0] ||
                                  'Serviço'
                                : `Frete: ${formatBRL(Number(inv.freightAmount || 0))}`}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                            {formatBRL(inv.totalInvoice)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {inv.fiscalStatus === 'aguardando_recebimento' && (
                                  <StatusTag label="Aguardando Recebimento" tone="neutral" />
                                )}
                                {(inv.fiscalStatus === 'pendente' ||
                                  inv.fiscalStatus === 'aguardando_escrituracao') && (
                                  <StatusTag label="Pendente" tone="info" />
                                )}
                                {(inv.fiscalStatus === 'lancado' ||
                                  inv.fiscalStatus === 'escriturada') && (
                                  <StatusTag label="Lançado" tone="success" />
                                )}
                                {inv.fiscalStatus === 'substituida' && (
                                  <StatusTag label="Substituída" tone="warning" />
                                )}
                                {inv.fiscalStatus === 'rejeitada' && (
                                  <StatusTag label="Rejeitada" tone="danger" />
                                )}
                              </div>
                              {(() => {
                                const rowAdj = adjustmentRequests.find(
                                  (r) =>
                                    r.fiscalInvoiceId === inv.id &&
                                    r.status !== 'Resolvido' &&
                                    r.status !== 'Cancelado'
                                );
                                if (rowAdj) {
                                  return (
                                    <div className="flex items-center gap-1.5">
                                      <StatusTag label="Aguardando ajuste de Compras" tone="warning" />
                                      {(rowAdj.status === 'Ajustado' ||
                                        rowAdj.status === 'Devolvido para revisão fiscal') && (
                                        <span className="text-[10px] font-semibold text-blue-700">
                                          · Resposta Compras
                                        </span>
                                      )}
                                    </div>
                                  );
                                }
                                if (inv.conferenceStatus === 'conferido') {
                                  return (
                                    <div>
                                      <StatusTag label="Conferido" tone="success" />
                                    </div>
                                  );
                                }
                                if (!inv.purchaseOrderId) {
                                  return (
                                    <div>
                                      <StatusTag label="Aguardando Vinculação" tone="neutral" />
                                    </div>
                                  );
                                }
                                return (
                                  <div>
                                    <StatusTag
                                      label={
                                        inv.matchingStatus === 'conciliada'
                                          ? 'Sem divergência'
                                          : inv.matchingStatus === 'divergente'
                                          ? 'Divergente'
                                          : 'Aguardando Conciliação'
                                      }
                                      tone={
                                        inv.matchingStatus === 'conciliada'
                                          ? 'success'
                                          : inv.matchingStatus === 'divergente'
                                          ? 'warning'
                                          : 'info'
                                      }
                                    />
                                  </div>
                                );
                              })()}
                            </div>
                            {inv.fiscalStatus === 'substituida' && inv.replacedByInvoiceNumber && (
                              <div className="text-[11px] text-amber-800 font-mono mt-1">
                                Subst. por NF {inv.replacedByInvoiceNumber}
                              </div>
                            )}
                            {(inv.docType || 'NFE') === 'NFE' &&
                              (inv.suframaPinNumber || inv.suframaClearanceDate || outOfState) && (
                                <div className="text-[11px] font-mono tabular-nums mt-1">
                                  {inv.suframaPinNumber || inv.suframaClearanceDate ? (
                                    <span className="text-slate-600">
                                      {inv.suframaPinNumber ? `PIN ${inv.suframaPinNumber}` : 'PIN —'}
                                      {inv.suframaClearanceDate
                                        ? ` · Desemb. ${formatDateBR(inv.suframaClearanceDate)}`
                                        : ' · Aguard. Desemb.'}
                                    </span>
                                  ) : (
                                    <span className="font-sans text-amber-700 font-medium">
                                      Aguard. PIN / Desembaraço
                                    </span>
                                  )}
                                </div>
                              )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openReconcileModal(inv)}
                                title={
                                  rowCanEdit
                                    ? 'Abrir Ficha do Documento & Conciliação'
                                    : 'Visualizar Ficha do Documento'
                                }
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                Abrir Ficha
                              </button>
                              {isAdmin && (inv.purchaseOrderId || inv.receiptId) && (
                                <button
                                  type="button"
                                  onClick={() => setUnlinkTarget(inv)}
                                  title="Desvincular Pedido/Recebimento (ADM Titular)"
                                  className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-md transition-colors cursor-pointer"
                                >
                                  <Link2Off className="w-4 h-4" />
                                </button>
                              )}
                              {rowCanDelete && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteError(null);
                                    setDeleteTarget(inv);
                                  }}
                                  title="Excluir documento fiscal"
                                  className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
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
        </>
      ) : (
        /* Importar XML Tab (Individual + Lote for NFE, NFSE, CTE) */
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Upload de Arquivos XML (Individual ou em Lote)
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Leitura automática de tags para NF-e de produto, NFS-e Padrão Nacional e CT-e. As notas são gravadas com status inicial <span className="font-medium text-slate-700">Aguardando Recebimento</span>.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleLoadSampleSingle('NFE')}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  Exemplo NF-e
                </button>
                <button
                  type="button"
                  onClick={() => handleLoadSampleSingle('NFSE')}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  Exemplo NFS-e
                </button>
                <button
                  type="button"
                  onClick={() => handleLoadSampleSingle('CTE')}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  Exemplo CT-e
                </button>
                <button
                  type="button"
                  onClick={handleLoadSampleBatch}
                  className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  Testar Lote (3 XMLs)
                </button>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".xml,text/xml,application/xml"
              onChange={(e) => void handleFilesSelected(e.target.files)}
              className="hidden"
            />

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                void handleFilesSelected(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`w-full border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                isDragging
                  ? 'border-blue-600 bg-blue-50/50'
                  : 'border-slate-300 hover:border-blue-600 hover:bg-blue-50/20'
              }`}
            >
              <FileCode2 className="w-8 h-8 text-slate-400 mx-auto mb-3" />
              <span className="text-sm font-medium text-slate-900 block">
                Arraste arquivos .xml aqui ou clique para selecionar (um ou vários arquivos)
              </span>
              <span className="text-xs text-slate-500 mt-1 block">
                Suporta NF-e (&lt;infNFe&gt;), NFS-e Padrão Nacional (&lt;infNFSe&gt;) e CT-e (&lt;infCte&gt;)
              </span>
            </div>

            {batchError && (
              <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {batchError}
              </div>
            )}
          </div>

          {/* Parsed Batch Queue */}
          {batchQueue.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    Documentos Extraídos ({batchQueue.length})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {validBatchItems.length} pronto(s) para importação · Valor líquido calculado automaticamente
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-1.5 text-xs">
                    <span className="text-slate-600 font-medium">
                      Passará pelo recebimento físico? (Todos):
                    </span>
                    <button
                      type="button"
                      onClick={() => applyBatchRequiresPhysicalReceiptAll(true)}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                    >
                      Sim (Exige Doca)
                    </button>
                    <button
                      type="button"
                      onClick={() => applyBatchRequiresPhysicalReceiptAll(false)}
                      className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer"
                    >
                      Não (Dispensa Doca)
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBatchQueue([])}
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Limpar Fila
                  </button>
                  <button
                    type="button"
                    disabled={saving || validBatchItems.length === 0}
                    onClick={handleImportBatch}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {saving
                      ? 'Importando...'
                      : `Importar ${validBatchItems.length} Documento(s)`}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                      <th className="py-3 px-4">Arquivo / Tipo</th>
                      <th className="py-3 px-4">Número / Chave</th>
                      <th className="py-3 px-4">Emitente / CNPJ</th>
                      <th className="py-3 px-4 text-right">Líquido Calc. / Bruto</th>
                      <th className="py-3 px-4">Recebimento & Pedido</th>
                      <th className="py-3 px-4">Validação / Conferência</th>
                      <th className="py-3 px-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {batchQueue.map((item) => {
                      const batchMatch = preImportMatchMap.get(item.id);
                      const hasXmlTotalDiff = Boolean(
                        item.parsed &&
                          item.parsed.xmlDeclaredTotal !== undefined &&
                          Math.abs(item.parsed.xmlDeclaredTotal - item.parsed.totalInvoice) > 0.01
                      );
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-medium text-slate-900 max-w-[160px] truncate">
                              {item.fileName}
                            </div>
                            {item.parsed && (
                              <span className="font-mono text-[11px] font-semibold text-blue-700">
                                {item.parsed.docType} · {item.parsed.items.length} item(ns)
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap font-mono tabular-nums">
                            {item.parsed ? (
                              <>
                                <div className="font-semibold text-slate-900">
                                  Nº {item.parsed.nfeNumber} · {formatDateBR(item.parsed.issueDate)}
                                </div>
                                <div className="text-slate-500">
                                  {formatAccessKeyShort(item.parsed.accessKey)}
                                </div>
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {item.parsed ? (
                              <>
                                <div className="font-medium text-slate-900 max-w-[200px] truncate">
                                  {item.parsed.issuerName}
                                </div>
                                <div className="font-mono text-slate-500 tabular-nums">
                                  {item.parsed.issuerCnpj}
                                  {item.parsed.issuerState ? ` · UF ${item.parsed.issuerState}` : ''}
                                  {item.parsed.docType === 'NFE' &&
                                    item.parsed.issuerState &&
                                    item.parsed.issuerState !== companyUf && (
                                      <span className="font-sans font-semibold text-amber-700">
                                        {' '}
                                        · Fora
                                      </span>
                                    )}
                                </div>
                              </>
                            ) : (
                              <span className="text-red-700">{item.error}</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                            {item.parsed ? (
                              <>
                                <div className="font-semibold text-slate-900">
                                  {formatBRL(item.parsed.totalInvoice)}
                                </div>
                                {hasXmlTotalDiff && (
                                  <div className="text-[11px] font-sans text-amber-700 font-medium">
                                    XML declarava {formatBRL(item.parsed.xmlDeclaredTotal!)}
                                  </div>
                                )}
                                {item.parsed.docType === 'NFSE' && item.parsed.taxRegime ? (
                                  <div className="text-slate-500 font-sans text-[11px]">
                                    Bruto: {formatBRL(item.parsed.grossAmount)} ·{' '}
                                    {SERVICE_TAX_REGIME_LABELS[item.parsed.taxRegime]?.split(' ')[0]}
                                  </div>
                                ) : item.parsed.docType === 'CTE' &&
                                  (item.parsed.originCity || item.parsed.destinationCity) ? (
                                  <div className="text-slate-500 font-sans text-[11px]">
                                    {item.parsed.originCity}/{item.parsed.originState} →{' '}
                                    {item.parsed.destinationCity}/{item.parsed.destinationState}
                                  </div>
                                ) : (
                                  <div className="text-slate-500 text-[11px]">
                                    Bruto: {formatBRL(item.parsed.grossAmount)} · Frete:{' '}
                                    {formatBRL(item.parsed.freightAmount)}
                                  </div>
                                )}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {item.parsed && !item.error && !item.duplicate ? (
                              (() => {
                                const eligibleOrders = getEligiblePurchaseOrdersForCnpj(
                                  item.parsed.issuerCnpj
                                );
                                return (
                                  <div className="space-y-1.5 w-64">
                                    <div>
                                      <label className="block text-[11px] font-medium text-slate-600 mb-0.5">
                                        Passará pelo recebimento físico?
                                      </label>
                                      <select
                                        value={item.requiresPhysicalReceipt ? 'sim' : 'nao'}
                                        onChange={(e) => {
                                          const req = e.target.value === 'sim';
                                          updateBatchItem(item.id, {
                                            requiresPhysicalReceipt: req,
                                            initialFiscalStatus: req
                                              ? 'aguardando_recebimento'
                                              : 'pendente',
                                          });
                                        }}
                                        className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-md bg-slate-50 font-medium text-slate-800"
                                      >
                                        <option value="sim">Sim (Exige recebimento físico)</option>
                                        <option value="nao">
                                          Não (Dispensa recebimento físico)
                                        </option>
                                      </select>
                                    </div>
                                    <select
                                      value={item.purchaseOrderId}
                                      onChange={(e) =>
                                        updateBatchItem(item.id, {
                                          purchaseOrderId: e.target.value,
                                          ...(e.target.value ? {} : { isPartialBilling: false }),
                                        })
                                      }
                                      className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                                    >
                                      <option value="">
                                        {eligibleOrders.length === 0
                                          ? 'Nenhum pedido pendente (mesmo CNPJ)'
                                          : 'Vincular pedido (opcional agora)'}
                                      </option>
                                      {eligibleOrders.map(({ po, remainingQty }) => (
                                        <option key={po.id} value={po.id}>
                                          {po.poNumber} · Saldo {remainingQty} un
                                        </option>
                                      ))}
                                    </select>
                                    {item.purchaseOrderId && (
                                      <label className="flex items-start gap-1.5 text-[11px] text-slate-700 cursor-pointer pt-0.5">
                                        <input
                                          type="checkbox"
                                          checked={item.isPartialBilling}
                                          onChange={(e) =>
                                            updateBatchItem(item.id, {
                                              isPartialBilling: e.target.checked,
                                            })
                                          }
                                          className="mt-0.5 rounded border-slate-300"
                                        />
                                        <span>Faturamento parcial (várias NFs no Pedido)</span>
                                      </label>
                                    )}
                                    {item.parsed.docType === 'CTE' && (
                                      <select
                                        value={item.linkedInvoiceId}
                                        onChange={(e) =>
                                          updateBatchItem(item.id, {
                                            linkedInvoiceId: e.target.value,
                                          })
                                        }
                                        className="w-full px-2 py-1.5 text-xs border border-blue-300 rounded-md bg-blue-50/40"
                                      >
                                        <option value="">Vincular NF-e / NFS-e (opcional)</option>
                                        {linkableInvoicesForCte.map((nf) => (
                                          <option key={nf.id} value={nf.id}>
                                            {DOC_TYPE_LABELS[nf.docType || 'NFE']} {nf.nfeNumber} ·{' '}
                                            {nf.issuerName.slice(0, 18)}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                  </div>
                                );
                              })()
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {item.error || item.duplicate ? (
                              <StatusTag
                                label={item.duplicate ? 'Duplicada' : 'Erro XML'}
                                tone={item.duplicate ? 'warning' : 'danger'}
                              />
                            ) : (
                              <div className="space-y-1">
                                <StatusTag label="XML Válido" tone="success" />
                                {item.purchaseOrderId && batchMatch && (
                                  <div>
                                    {item.notifyCompras ? (
                                      <StatusTag label="Notificar Compras" tone="warning" />
                                    ) : item.conferenceConfirmed ? (
                                      <StatusTag label="Conferido" tone="success" />
                                    ) : batchMatch.conferenceBadgeState === 'sem_divergencia' ? (
                                      <StatusTag label="Sem divergência" tone="success" />
                                    ) : batchMatch.conferenceBadgeState === 'aguardando_conciliacao' ? (
                                      <StatusTag label="Conciliar Itens" tone="info" />
                                    ) : (
                                      <StatusTag label="Divergente" tone="warning" />
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              {item.parsed && (
                                <button
                                  type="button"
                                  onClick={() => setPreviewBatchItemId(item.id)}
                                  className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer"
                                >
                                  Itens & Conciliação
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => removeBatchItem(item.id)}
                                className="p-1 text-slate-400 hover:text-red-700 rounded cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
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
      )}

      {/* Batch Item Details & Pre-Import Reconciliation Modal */}
      {previewBatchItem && previewBatchItem.parsed && (() => {
        const parsed = previewBatchItem.parsed;
        const previewPo = purchaseOrders.find((p) => p.id === previewBatchItem.purchaseOrderId);
        const previewMatch = preImportMatchMap.get(previewBatchItem.id);
        const hasXmlTotalDiff =
          parsed.xmlDeclaredTotal !== undefined &&
          Math.abs(parsed.xmlDeclaredTotal - parsed.totalInvoice) > 0.01;
        return (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    {parsed.docType} Nº {parsed.nfeNumber} · {parsed.issuerName}
                  </h3>
                  <p className="font-mono text-xs text-slate-500">
                    Chave: {parsed.accessKey}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewBatchItemId(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto space-y-4 text-xs">
                {hasXmlTotalDiff && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <span>
                      Atenção: o valor líquido declarado no XML ({formatBRL(parsed.xmlDeclaredTotal!)}) difere do líquido calculado ({formatBRL(parsed.totalInvoice)}). Confira os tributos e despesas antes de importar.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg tabular-nums">
                  <div>
                    <span className="text-slate-500 block">Valor Bruto</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {formatBRL(parsed.grossAmount)}
                    </span>
                  </div>
                  {parsed.docType === 'NFSE' ? (
                    <div className="col-span-2">
                      <span className="text-slate-500 block">Regime Tributário (XML)</span>
                      <span className="font-semibold text-slate-900">
                        {
                          SERVICE_TAX_REGIME_LABELS[
                            parsed.taxRegime || 'simples_nacional'
                          ]
                        }
                      </span>
                    </div>
                  ) : (
                    <>
                      <div>
                        <span className="text-slate-500 block">Frete / Seguro / Outr. Desp.</span>
                        <span className="font-mono font-semibold text-slate-900">
                          {formatBRL(parsed.freightAmount)} · {formatBRL(parsed.insuranceAmount || 0)} ·{' '}
                          {formatBRL(parsed.otherExpensesAmount || 0)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">IPI / ICMS ST / Descontos</span>
                        <span className="font-mono font-semibold text-slate-900">
                          {formatBRL(parsed.ipiAmount)} · {formatBRL(parsed.icmsStAmount || 0)} ·{' '}
                          {formatBRL(parsed.discountAmount || 0)}
                        </span>
                      </div>
                    </>
                  )}
                  <div>
                    <span className="text-slate-500 block">Valor Líquido Calculado</span>
                    <span className="font-mono font-bold text-slate-900">
                      {formatBRL(parsed.totalInvoice)}
                    </span>
                  </div>
                  {parsed.issuerState && (
                    <div className="col-span-2 sm:col-span-4 pt-2 border-t border-slate-200 flex items-center justify-between">
                      <span className="text-slate-600">
                        UF do Emitente:{' '}
                        <span className="font-mono font-semibold text-slate-900">
                          {parsed.issuerState}
                        </span>
                      </span>
                      {parsed.docType === 'NFE' && (
                        <span
                          className={`font-semibold ${
                            parsed.issuerState !== companyUf
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {parsed.issuerState !== companyUf
                            ? `Nota de Fora (${parsed.issuerState} → ${companyUf})`
                            : `Operação Interna (${companyUf})`}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {parsed.docType === 'NFSE' && (
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg tabular-nums">
                    <div>
                      <span className="text-slate-500 block">PIS</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {formatBRL(parsed.pisAmount || 0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">COFINS</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {formatBRL(parsed.cofinsAmount || 0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">CSLL</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {formatBRL(parsed.csllAmount || 0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">
                        ISSQN ({parsed.issqnRetained === false ? 'Destacado' : 'Retido'})
                      </span>
                      <span className="font-mono font-semibold text-slate-900">
                        {formatBRL(parsed.issqnAmount || 0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">INSS</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {formatBRL(parsed.inssAmount || 0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">IRRF</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {formatBRL(parsed.irrfAmount || 0)}
                      </span>
                    </div>
                  </div>
                )}

                {parsed.docType === 'CTE' &&
                  (parsed.originCity || parsed.destinationCity) && (
                    <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      <div>
                        <span className="text-slate-500 block">Origem</span>
                        <span className="font-medium text-slate-900">
                          {parsed.originCity || '—'} / {parsed.originState || '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Saída / Destino</span>
                        <span className="font-medium text-slate-900">
                          {parsed.destinationCity || '—'} / {parsed.destinationState || '—'}
                        </span>
                      </div>
                    </div>
                  )}

                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <th className="py-2 px-3">Código</th>
                        <th className="py-2 px-3">Descrição</th>
                        <th className="py-2 px-3 text-right">Qtd</th>
                        <th className="py-2 px-3 text-right">Unitário</th>
                        <th className="py-2 px-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsed.items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="py-2 px-3 font-mono">{it.code}</td>
                          <td className="py-2 px-3">{it.description}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {it.qty} {it.unit}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {formatBRL(it.unitPrice)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-medium tabular-nums">
                            {formatBRL(it.totalPrice)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pre-Import Reconciliation with Selected PO */}
                {previewPo && previewMatch && (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-semibold text-slate-900 block">
                          Conferência Pré-Importação × Pedido {previewPo.poNumber}
                        </span>
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 mt-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={previewBatchItem.isPartialBilling}
                            onChange={(e) =>
                              updateBatchItem(previewBatchItem.id, {
                                isPartialBilling: e.target.checked,
                              })
                            }
                            className="rounded border-slate-300"
                          />
                          Faturamento / Entrega Parcial (múltiplas notas atendendo este Pedido)
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        {previewBatchItem.conferenceConfirmed && (
                          <StatusTag label="Conferido" tone="success" />
                        )}
                        <StatusTag
                          label={
                            previewMatch.conferenceBadgeState === 'sem_divergencia'
                              ? 'Sem divergência'
                              : previewMatch.conferenceBadgeState === 'aguardando_conciliacao'
                              ? 'Aguardando Conciliação'
                              : 'Divergente'
                          }
                          tone={
                            previewMatch.conferenceBadgeState === 'sem_divergencia'
                              ? 'success'
                              : previewMatch.conferenceBadgeState === 'aguardando_conciliacao'
                              ? 'info'
                              : 'warning'
                          }
                        />
                      </div>
                    </div>

                    <ItemReconciliationEditor
                      supplierCnpj={parsed.issuerCnpj}
                      invoiceItems={parsed.items}
                      poItems={previewPo.items}
                      associations={previewMatch.associations}
                      suggestions={previewMatch.suggestions}
                      unmatchedInvoiceItemIndexes={previewMatch.unmatchedInvoiceItemIndexes}
                      unmatchedPoItemIndexes={previewMatch.unmatchedPoItemIndexes}
                      canEdit={!previewBatchItem.notifyCompras}
                      onChangeAssociations={(next) =>
                        updateBatchItem(previewBatchItem.id, { itemAssociations: next })
                      }
                      onSaveEquivalence={(eq) => {
                        const existing = previewBatchItem.pendingEquivalences || [];
                        updateBatchItem(previewBatchItem.id, {
                          pendingEquivalences: [...existing, eq],
                        });
                      }}
                      saveEquivalenceLabel="Salvar equivalência ao importar"
                    />

                    {previewMatch.itemComparisons.length > 0 && (
                      <div className="border border-slate-200 rounded-md bg-white overflow-hidden">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                            <tr>
                              <th className="py-1.5 px-2.5 font-medium">Item (Pedido × Nota)</th>
                              <th className="py-1.5 px-2.5 font-medium text-right">Qtd Ped.</th>
                              <th className="py-1.5 px-2.5 font-medium text-right">Qtd NF</th>
                              <th className="py-1.5 px-2.5 font-medium text-right">Unit. Ped.</th>
                              <th className="py-1.5 px-2.5 font-medium text-right">Unit. NF</th>
                              <th className="py-1.5 px-2.5 font-medium text-right">Conferência</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 tabular-nums">
                            {previewMatch.itemComparisons.map((cmp, i) => (
                              <tr key={i}>
                                <td className="py-1.5 px-2.5 text-slate-800 max-w-[200px] truncate">
                                  {cmp.description}
                                </td>
                                <td className="py-1.5 px-2.5 text-right font-mono text-slate-700">
                                  {cmp.poQty !== null ? cmp.poQty : '—'}
                                </td>
                                <td className="py-1.5 px-2.5 text-right font-mono text-slate-700">
                                  {cmp.invoiceQty !== null ? cmp.invoiceQty : '—'}
                                </td>
                                <td className="py-1.5 px-2.5 text-right font-mono text-slate-700">
                                  {cmp.poUnitPrice !== null ? formatBRL(cmp.poUnitPrice) : '—'}
                                </td>
                                <td className="py-1.5 px-2.5 text-right font-mono text-slate-700">
                                  {cmp.invoiceUnitPrice !== null
                                    ? formatBRL(cmp.invoiceUnitPrice)
                                    : '—'}
                                </td>
                                <td className="py-1.5 px-2.5 text-right whitespace-nowrap">
                                  {!cmp.matchedInPo ? (
                                    <span className="text-amber-700 font-medium">Fora do PO</span>
                                  ) : !cmp.qtyMatch ? (
                                    <span className="text-amber-700 font-medium">Qtd diverge</span>
                                  ) : !cmp.unitPriceMatch ? (
                                    <span className="text-slate-600">Unit. difere</span>
                                  ) : (
                                    <span className="text-emerald-700 font-medium">Confere</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {previewMatch.financialComparison && (
                      <div className="border border-slate-200 rounded-md bg-white overflow-hidden">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                            <tr>
                              <th className="py-1.5 px-2.5 font-medium">Confronto de Valores</th>
                              <th className="py-1.5 px-2.5 font-medium text-right">
                                Pedido de Compra
                              </th>
                              <th className="py-1.5 px-2.5 font-medium text-right">Nota Fiscal</th>
                              <th className="py-1.5 px-2.5 font-medium text-right">Situação</th>
                            </tr>
                          </thead>
                          <tbody className="tabular-nums">
                            <tr>
                              <td className="py-2 px-2.5 font-medium text-slate-800">
                                {previewMatch.financialComparison.criterionLabel}
                                {previewMatch.isPartialBilling && (
                                  <span className="text-blue-700 ml-1.5">(Parcela)</span>
                                )}
                              </td>
                              <td className="py-2 px-2.5 text-right font-mono text-slate-900">
                                {formatBRL(previewMatch.financialComparison.poComparedAmount)}
                              </td>
                              <td className="py-2 px-2.5 text-right font-mono text-slate-900">
                                {formatBRL(previewMatch.financialComparison.invoiceComparedAmount)}
                              </td>
                              <td className="py-2 px-2.5 text-right whitespace-nowrap">
                                {previewMatch.financialComparison.matches ? (
                                  <span className="text-emerald-700 font-semibold">Confere</span>
                                ) : (
                                  <span className="text-amber-700 font-semibold">
                                    Diverge ({formatBRL(previewMatch.financialComparison.differenceAmount)})
                                  </span>
                                )}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {previewMatch.reasons.length > 0 && (
                      <ul className="list-disc pl-4 text-xs text-amber-800 space-y-0.5">
                        {previewMatch.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    )}

                    <div className="pt-2 border-t border-slate-200 space-y-2.5">
                      {previewMatch.conferenceBadgeState === 'divergente' &&
                        !previewBatchItem.notifyCompras && (
                          <div>
                            <label className="block text-[11px] font-medium text-slate-700 mb-1">
                              Justificativa da conferência (obrigatória p/ confirmar divergência)
                            </label>
                            <input
                              type="text"
                              value={previewBatchItem.conferenceJustification || ''}
                              onChange={(e) =>
                                updateBatchItem(previewBatchItem.id, {
                                  conferenceJustification: e.target.value,
                                })
                              }
                              placeholder="Descreva o motivo de aceitar a divergência..."
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                            />
                          </div>
                        )}

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {previewMatch.unmatchedInvoiceItemIndexes.length === 0 &&
                          !previewBatchItem.notifyCompras && (
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  previewMatch.conferenceBadgeState === 'divergente' &&
                                  !(previewBatchItem.conferenceJustification || '').trim()
                                ) {
                                  return;
                                }
                                updateBatchItem(previewBatchItem.id, {
                                  conferenceConfirmed: !previewBatchItem.conferenceConfirmed,
                                });
                              }}
                              disabled={
                                previewMatch.conferenceBadgeState === 'divergente' &&
                                !(previewBatchItem.conferenceJustification || '').trim() &&
                                !previewBatchItem.conferenceConfirmed
                              }
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer disabled:opacity-50 ${
                                previewBatchItem.conferenceConfirmed
                                  ? 'text-emerald-800 bg-emerald-100 border border-emerald-300'
                                  : 'text-white bg-slate-900 hover:bg-slate-800'
                              }`}
                            >
                              <BookmarkCheck className="w-3.5 h-3.5" />
                              {previewBatchItem.conferenceConfirmed
                                ? 'Conferência Confirmada (Clique p/ desfazer)'
                                : 'Confirmar Conferência na Importação'}
                            </button>
                          )}

                        <label className="inline-flex items-center gap-2 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(previewBatchItem.notifyCompras)}
                            onChange={(e) =>
                              updateBatchItem(previewBatchItem.id, {
                                notifyCompras: e.target.checked,
                                conferenceConfirmed: false,
                              })
                            }
                            className="rounded border-amber-400"
                          />
                          <MessageSquareWarning className="w-3.5 h-3.5 text-amber-700" />
                          Notificar Compras e importar nota sem vínculo definitivo
                        </label>
                      </div>

                      {previewBatchItem.notifyCompras && (
                        <div>
                          <label className="block text-[11px] font-medium text-amber-900 mb-1">
                            Observação para o setor de Compras
                          </label>
                          <input
                            type="text"
                            value={previewBatchItem.adjustmentObservation || ''}
                            onChange={(e) =>
                              updateBatchItem(previewBatchItem.id, {
                                adjustmentObservation: e.target.value,
                              })
                            }
                            placeholder="Explique o ajuste necessário no Pedido de Compra..."
                            className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded bg-white"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {parsed.complementaryInfo && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <span className="text-[11px] font-semibold text-slate-600 block mb-1">
                      Informações Complementares (XML)
                    </span>
                    <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                      {parsed.complementaryInfo}
                    </p>
                  </div>
                )}
              </div>
              <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
                <button
                  type="button"
                  onClick={() => setPreviewBatchItemId(null)}
                  className="px-4 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  Concluir Revisão
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Ficha do Documento Fiscal & Conciliação Modal */}
      {activeInvoice && modalMatchPreview && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4 bg-slate-50/70">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-lg font-semibold text-slate-900">
                    Ficha Fiscal · {DOC_TYPE_LABELS[activeInvoice.docType || 'NFE']}{' '}
                    {activeInvoice.nfeNumber}
                    {activeInvoice.docType !== 'NFSE' ? ` · Série ${activeInvoice.series}` : ''}
                  </h2>
                  {activeInvoice.fiscalStatus === 'aguardando_recebimento' && (
                    <StatusTag label="Aguardando Recebimento" tone="neutral" />
                  )}
                  {(activeInvoice.fiscalStatus === 'pendente' ||
                    activeInvoice.fiscalStatus === 'aguardando_escrituracao') && (
                    <StatusTag label="Pendente" tone="info" />
                  )}
                  {(activeInvoice.fiscalStatus === 'lancado' ||
                    activeInvoice.fiscalStatus === 'escriturada') && (
                    <StatusTag label="Lançado" tone="success" />
                  )}
                  {activeInvoice.fiscalStatus === 'substituida' && (
                    <StatusTag label="Substituída" tone="warning" />
                  )}
                  {activeInvoice.fiscalStatus === 'rejeitada' && (
                    <StatusTag label="Rejeitada" tone="danger" />
                  )}
                  <StatusTag
                    label={
                      requiresReceiptForActive
                        ? 'Exige Recebimento Físico'
                        : 'Fluxo Direto (Sem Recebimento)'
                    }
                    tone={requiresReceiptForActive ? 'neutral' : 'info'}
                  />
                  {editIsPartialBilling && (
                    <StatusTag label="Faturamento Parcial" tone="info" />
                  )}
                  {activeInvoice.conferenceStatus === 'conferido' && !isConferenceStale && (
                    <StatusTag label="Conferido" tone="success" />
                  )}
                  <StatusTag
                    label={
                      activeAdjustmentRequest
                        ? 'Aguardando ajuste de Compras'
                        : modalMatchPreview.conferenceBadgeState === 'sem_divergencia'
                        ? 'Sem divergência'
                        : modalMatchPreview.conferenceBadgeState === 'divergente'
                        ? 'Divergente'
                        : modalMatchPreview.conferenceBadgeState === 'aguardando_conciliacao'
                        ? 'Aguardando Conciliação'
                        : 'Aguardando Vinculação'
                    }
                    tone={
                      activeAdjustmentRequest
                        ? 'warning'
                        : modalMatchPreview.conferenceBadgeState === 'sem_divergencia'
                        ? 'success'
                        : modalMatchPreview.conferenceBadgeState === 'divergente'
                        ? 'warning'
                        : modalMatchPreview.conferenceBadgeState === 'aguardando_conciliacao'
                        ? 'info'
                        : 'neutral'
                    }
                  />
                </div>
                <p className="text-xs text-slate-600 mt-1">
                  <span className="font-medium text-slate-900">{activeInvoice.issuerName}</span> ·{' '}
                  <span className="font-mono">{activeInvoice.issuerCnpj}</span>
                  {getEffectiveIssuerUf(activeInvoice) ? (
                    <>
                      {' '}
                      · UF{' '}
                      <span className="font-mono font-semibold text-slate-900">
                        {getEffectiveIssuerUf(activeInvoice)}
                      </span>
                    </>
                  ) : null}
                  {isOutOfStateNfe(activeInvoice) && (
                    <span className="text-amber-700 font-semibold">
                      {' '}
                      (Nota de Fora → {companyUf})
                    </span>
                  )}{' '}
                  · Emissão:{' '}
                  <span className="font-mono tabular-nums">
                    {formatDateBR(activeInvoice.issueDate)}
                  </span>{' '}
                  · Origem: {activeInvoice.xmlImported ? 'Importação XML' : 'Cadastro Manual'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveInvoice(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveReconciliation} className="p-6 overflow-y-auto space-y-6">
              {modalError && (
                <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {modalError}
                </div>
              )}
              {modalSuccess && (
                <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                  {modalSuccess}
                </div>
              )}
              {activeInvoice.xmlDeclaredTotal !== undefined &&
                Math.abs(activeInvoice.xmlDeclaredTotal - editComputedTotal) > 0.01 && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>
                      Atenção: o total declarado no XML ({formatBRL(activeInvoice.xmlDeclaredTotal)}) difere do líquido recalculado ({formatBRL(editComputedTotal)}). Revise tributos, despesas acessórias e descontos.
                    </span>
                  </div>
                )}

              {/* Chave de Acesso */}
              <div className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs">
                  <span className="text-slate-500 mr-2">Chave de Acesso:</span>
                  <span className="font-mono font-medium text-slate-800 break-all">
                    {activeInvoice.accessKey}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyKey(activeInvoice.accessKey)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedKey === activeInvoice.accessKey ? 'Copiada' : 'Copiar Chave'}
                </button>
              </div>

              {/* 1. Resumo Financeiro e Tributos */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    1. Valores e Tributos do Documento
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    Valor Líquido calculado automaticamente (somente leitura)
                  </span>
                </div>
                <div
                  className={`grid grid-cols-2 ${
                    activeInvoice.docType === 'NFSE'
                      ? 'sm:grid-cols-3 lg:grid-cols-5'
                      : 'sm:grid-cols-4'
                  } gap-3 tabular-nums`}
                >
                  <div className="p-3 rounded-lg border border-slate-200 bg-white">
                    <label className="text-[11px] text-slate-500 block mb-1">
                      {activeInvoice.docType === 'NFSE'
                        ? 'Valor Bruto / Serviços (R$)'
                        : 'Valor Bruto / Produtos (R$)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={!canEditActiveInvoice}
                      value={editTotalProducts}
                      onChange={(e) =>
                        setEditTotalProducts(Math.max(0, Number(e.target.value)))
                      }
                      className="w-full px-2.5 py-1.5 text-sm font-mono font-semibold text-slate-900 border border-slate-300 rounded-md bg-white disabled:bg-slate-50 disabled:border-slate-200"
                    />
                  </div>
                  {activeInvoice.docType !== 'NFSE' && (
                    <>
                      <div className="p-3 rounded-lg border border-slate-200 bg-white">
                        <label className="text-[11px] text-slate-500 block mb-1">
                          Valor do Frete (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={!canEditActiveInvoice}
                          value={editFreightAmount}
                          onChange={(e) =>
                            setEditFreightAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-2.5 py-1.5 text-sm font-mono font-semibold text-slate-900 border border-slate-300 rounded-md bg-white disabled:bg-slate-50 disabled:border-slate-200"
                        />
                      </div>
                      <div className="p-3 rounded-lg border border-slate-200 bg-white">
                        <label className="text-[11px] text-slate-500 block mb-1">
                          Seguro (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={!canEditActiveInvoice}
                          value={editInsuranceAmount}
                          onChange={(e) =>
                            setEditInsuranceAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-2.5 py-1.5 text-sm font-mono font-semibold text-slate-900 border border-slate-300 rounded-md bg-white disabled:bg-slate-50 disabled:border-slate-200"
                        />
                      </div>
                    </>
                  )}
                  <div className="p-3 rounded-lg border border-slate-200 bg-white">
                    <label className="text-[11px] text-slate-500 block mb-1">
                      Outras Despesas (R$)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={!canEditActiveInvoice}
                      value={editOtherExpensesAmount}
                      onChange={(e) =>
                        setEditOtherExpensesAmount(Math.max(0, Number(e.target.value)))
                      }
                      className="w-full px-2.5 py-1.5 text-sm font-mono font-semibold text-slate-900 border border-slate-300 rounded-md bg-white disabled:bg-slate-50 disabled:border-slate-200"
                    />
                  </div>
                  <div className="p-3 rounded-lg border border-slate-200 bg-white">
                    <label className="text-[11px] text-slate-500 block mb-1">
                      Acréscimos (R$)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={!canEditActiveInvoice}
                      value={editSurchargeAmount}
                      onChange={(e) =>
                        setEditSurchargeAmount(Math.max(0, Number(e.target.value)))
                      }
                      className="w-full px-2.5 py-1.5 text-sm font-mono font-semibold text-slate-900 border border-slate-300 rounded-md bg-white disabled:bg-slate-50 disabled:border-slate-200"
                    />
                  </div>
                  <div className="p-3 rounded-lg border border-slate-200 bg-white">
                    <label className="text-[11px] text-slate-500 block mb-1">
                      Descontos (R$)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={!canEditActiveInvoice}
                      value={editDiscountAmount}
                      onChange={(e) =>
                        setEditDiscountAmount(Math.max(0, Number(e.target.value)))
                      }
                      className="w-full px-2.5 py-1.5 text-sm font-mono font-semibold text-slate-900 border border-slate-300 rounded-md bg-white disabled:bg-slate-50 disabled:border-slate-200"
                    />
                  </div>
                  <div
                    className={`p-3 rounded-lg border border-slate-300 bg-slate-100/80 ${
                      activeInvoice.docType !== 'NFSE' ? 'col-span-2 sm:col-span-1' : ''
                    }`}
                  >
                    <label className="text-[11px] text-slate-600 font-medium block mb-1">
                      Valor Líquido da Nota (R$)
                    </label>
                    <input
                      type="text"
                      readOnly
                      tabIndex={-1}
                      aria-readonly="true"
                      value={formatBRL(editComputedTotal)}
                      className="w-full px-2.5 py-1.5 text-sm font-mono font-bold text-slate-900 border border-slate-300 rounded-md bg-slate-100 cursor-not-allowed"
                    />
                  </div>
                </div>

                {activeInvoice.docType === 'NFSE' ? (
                  <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Regime Tributário do Prestador (NFS-e)
                        </label>
                        <select
                          value={editTaxRegime}
                          disabled={!canEditActiveInvoice}
                          onChange={(e) => {
                            const next = e.target.value as ServiceTaxRegime;
                            setEditTaxRegime(next);
                            if (next === 'mei') {
                              setEditPisAmount(0);
                              setEditCofinsAmount(0);
                              setEditCsllAmount(0);
                              setEditIssqnAmount(0);
                              setEditInssAmount(0);
                              setEditIrrfAmount(0);
                            } else if (next === 'simples_nacional') {
                              setEditPisAmount(0);
                              setEditCofinsAmount(0);
                              setEditCsllAmount(0);
                              setEditIrrfAmount(0);
                            }
                          }}
                          className="w-full px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                        >
                          <option value="mei">MEI (Não retém nenhum imposto)</option>
                          <option value="simples_nacional">
                            Simples Nacional (Retém ISSQN e INSS — opcional)
                          </option>
                          <option value="regime_normal">
                            Regime Normal (Retém todos — opcional)
                          </option>
                        </select>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed pt-3 sm:pt-4">
                        {editTaxRegime === 'mei'
                          ? 'Prestador MEI: nenhuma retenção aplicável; campos mantidos zerados.'
                          : editTaxRegime === 'simples_nacional'
                          ? 'Simples Nacional: habilita ISSQN e INSS (deduzidos do líquido quando aplicável).'
                          : 'Regime Normal: habilita PIS, COFINS, CSLL, ISSQN, INSS e IRRF.'}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 tabular-nums">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          PIS (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={!canEditActiveInvoice || editTaxRegime !== 'regime_normal'}
                          value={editTaxRegime === 'regime_normal' ? editPisAmount : 0}
                          onChange={(e) => setEditPisAmount(Math.max(0, Number(e.target.value)))}
                          className="w-full px-2.5 py-1.5 text-sm font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          COFINS (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={!canEditActiveInvoice || editTaxRegime !== 'regime_normal'}
                          value={editTaxRegime === 'regime_normal' ? editCofinsAmount : 0}
                          onChange={(e) =>
                            setEditCofinsAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-2.5 py-1.5 text-sm font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          CSLL (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={!canEditActiveInvoice || editTaxRegime !== 'regime_normal'}
                          value={editTaxRegime === 'regime_normal' ? editCsllAmount : 0}
                          onChange={(e) =>
                            setEditCsllAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-2.5 py-1.5 text-sm font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          ISSQN (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={!canEditActiveInvoice || editTaxRegime === 'mei'}
                          value={editTaxRegime === 'mei' ? 0 : editIssqnAmount}
                          onChange={(e) =>
                            setEditIssqnAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-2.5 py-1.5 text-sm font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          INSS (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={!canEditActiveInvoice || editTaxRegime === 'mei'}
                          value={editTaxRegime === 'mei' ? 0 : editInssAmount}
                          onChange={(e) =>
                            setEditInssAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-2.5 py-1.5 text-sm font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          IRRF (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={!canEditActiveInvoice || editTaxRegime !== 'regime_normal'}
                          value={editTaxRegime === 'regime_normal' ? editIrrfAmount : 0}
                          onChange={(e) =>
                            setEditIrrfAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-2.5 py-1.5 text-sm font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                    </div>

                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={!canEditActiveInvoice || editTaxRegime === 'mei'}
                        checked={editIssqnRetained}
                        onChange={(e) => setEditIssqnRetained(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      ISSQN Retido na fonte (deduz do valor líquido; desmarque se for apenas ISSQN destacado)
                    </label>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 tabular-nums">
                    <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/60">
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">
                        ICMS ST (R$)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!canEditActiveInvoice || activeInvoice.docType === 'CTE'}
                        value={activeInvoice.docType === 'CTE' ? 0 : editIcmsStAmount}
                        onChange={(e) =>
                          setEditIcmsStAmount(Math.max(0, Number(e.target.value)))
                        }
                        className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded bg-white disabled:bg-slate-100 disabled:text-slate-500"
                      />
                    </div>
                    <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/60">
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">
                        IPI (R$)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!canEditActiveInvoice || activeInvoice.docType === 'CTE'}
                        value={activeInvoice.docType === 'CTE' ? 0 : editIpiAmount}
                        onChange={(e) => setEditIpiAmount(Math.max(0, Number(e.target.value)))}
                        className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded bg-white disabled:bg-slate-100 disabled:text-slate-500"
                      />
                    </div>
                    <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/60">
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">
                        Retidos (R$)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!canEditActiveInvoice}
                        value={editRetainedTaxesAmount}
                        onChange={(e) =>
                          setEditRetainedTaxesAmount(Math.max(0, Number(e.target.value)))
                        }
                        className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded bg-white disabled:bg-slate-100 disabled:text-slate-500"
                      />
                    </div>
                    <div
                      className={`p-2.5 rounded-lg border ${
                        editIcmsDesonAmount > 0
                          ? 'border-amber-200 bg-amber-50/70'
                          : 'border-slate-200 bg-slate-50/60'
                      }`}
                    >
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">
                        ICMS Deson.
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!canEditActiveInvoice}
                        value={editIcmsDesonAmount}
                        onChange={(e) =>
                          setEditIcmsDesonAmount(Math.max(0, Number(e.target.value)))
                        }
                        className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded bg-white disabled:bg-slate-100 disabled:text-slate-500"
                      />
                    </div>
                    <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/60">
                      <label className="text-[11px] text-slate-500 block mb-1">ICMS (R$)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!canEditActiveInvoice}
                        value={editIcmsAmount}
                        onChange={(e) => setEditIcmsAmount(Math.max(0, Number(e.target.value)))}
                        className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded bg-white disabled:bg-slate-100 disabled:text-slate-500"
                      />
                    </div>
                    <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/60">
                      <label className="text-[11px] text-slate-500 block mb-1">PIS (R$)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!canEditActiveInvoice}
                        value={editPisAmount}
                        onChange={(e) => setEditPisAmount(Math.max(0, Number(e.target.value)))}
                        className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded bg-white disabled:bg-slate-100 disabled:text-slate-500"
                      />
                    </div>
                    <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/60">
                      <label className="text-[11px] text-slate-500 block mb-1">COFINS (R$)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!canEditActiveInvoice}
                        value={editCofinsAmount}
                        onChange={(e) => setEditCofinsAmount(Math.max(0, Number(e.target.value)))}
                        className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded bg-white disabled:bg-slate-100 disabled:text-slate-500"
                      />
                    </div>
                  </div>
                )}

                {(activeInvoice.docType || 'NFE') === 'NFE' && (
                  <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-700">
                        Acompanhamento UF do Emitente & SUFRAMA / PIN (Opcional)
                      </span>
                      {editIssuerState ? (
                        <span
                          className={`text-[11px] font-semibold ${
                            editIssuerState !== companyUf ? 'text-amber-700' : 'text-emerald-700'
                          }`}
                        >
                          {editIssuerState !== companyUf
                            ? `Nota de Fora do Estado (${editIssuerState} → ${companyUf})`
                            : `Operação Interna (${companyUf})`}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          UF não informada na nota
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 tabular-nums">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-1">
                          UF do Emitente
                        </label>
                        <select
                          value={editIssuerState}
                          disabled={!canEditActiveInvoice}
                          onChange={(e) => setEditIssuerState(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                        >
                          <option value="">Selecionar UF</option>
                          {BRAZIL_STATES.map((st) => (
                            <option key={st.uf} value={st.uf}>
                              {st.uf} — {st.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-1">
                          Nº do PIN (SUFRAMA)
                        </label>
                        <input
                          type="text"
                          maxLength={BLUEPRINT_LIMITS.MAX_SUFRAMA_PIN}
                          disabled={!canEditActiveInvoice}
                          value={editSuframaPinNumber}
                          onChange={(e) => setEditSuframaPinNumber(e.target.value)}
                          placeholder="Ex: 123456789"
                          className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-1">
                          Data Aceite do PIN
                        </label>
                        <input
                          type="date"
                          disabled={!canEditActiveInvoice}
                          value={editSuframaPinAcceptanceDate}
                          onChange={(e) => setEditSuframaPinAcceptanceDate(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-1">
                          Data Receb. do PIN
                        </label>
                        <input
                          type="date"
                          disabled={!canEditActiveInvoice}
                          value={editSuframaPinReceiptDate}
                          onChange={(e) => setEditSuframaPinReceiptDate(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-1">
                          Data do Desembaraço
                        </label>
                        <input
                          type="date"
                          disabled={!canEditActiveInvoice}
                          value={editSuframaClearanceDate}
                          onChange={(e) => setEditSuframaClearanceDate(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeInvoice.docType === 'CTE' && (
                  <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Nota Fiscal Vinculada ao Transporte (NF-e / NFS-e)
                        </label>
                        <select
                          value={editLinkedInvoiceId}
                          disabled={!canEditActiveInvoice}
                          onChange={(e) => setEditLinkedInvoiceId(e.target.value)}
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                        >
                          <option value="">Sem nota fiscal vinculada</option>
                          {linkableInvoicesForCte.map((nf) => (
                            <option key={nf.id} value={nf.id}>
                              {DOC_TYPE_LABELS[nf.docType || 'NFE']} {nf.nfeNumber} ·{' '}
                              {nf.issuerName} ({formatBRL(nf.totalInvoice)})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-1">
                          Estado (UF) de Origem
                        </label>
                        <select
                          value={editOriginState}
                          disabled={!canEditActiveInvoice}
                          onChange={(e) => {
                            setEditOriginState(e.target.value);
                            setEditOriginCity('');
                          }}
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                        >
                          <option value="">Selecione UF</option>
                          {BRAZIL_STATES.map((st) => (
                            <option key={st.uf} value={st.uf}>
                              {st.uf} — {st.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-1">
                          Cidade de Origem
                        </label>
                        <select
                          value={editOriginCity}
                          disabled={!canEditActiveInvoice || !editOriginState}
                          onChange={(e) => setEditOriginCity(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                        >
                          <option value="">
                            {editOriginState ? 'Selecione a cidade' : 'Selecione o estado'}
                          </option>
                          {getCityOptions(editOriginState, editOriginCity).map((city) => (
                            <option key={city} value={city}>
                              {city}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-1">
                          Estado (UF) de Saída / Destino
                        </label>
                        <select
                          value={editDestinationState}
                          disabled={!canEditActiveInvoice}
                          onChange={(e) => {
                            setEditDestinationState(e.target.value);
                            setEditDestinationCity('');
                          }}
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                        >
                          <option value="">Selecione UF</option>
                          {BRAZIL_STATES.map((st) => (
                            <option key={st.uf} value={st.uf}>
                              {st.uf} — {st.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-1">
                          Cidade de Saída / Destino
                        </label>
                        <select
                          value={editDestinationCity}
                          disabled={!canEditActiveInvoice || !editDestinationState}
                          onChange={(e) => setEditDestinationCity(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                        >
                          <option value="">
                            {editDestinationState
                              ? 'Selecione a cidade'
                              : 'Selecione o estado'}
                          </option>
                          {getCityOptions(editDestinationState, editDestinationCity).map(
                            (city) => (
                              <option key={city} value={city}>
                                {city}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Itens da Nota Fiscal */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    2. Itens da Nota Fiscal ({activeInvoice.items.length})
                  </h3>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="max-h-56 overflow-y-auto overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="py-2 px-3 font-medium">Código</th>
                          <th className="py-2 px-3 font-medium">Descrição</th>
                          <th className="py-2 px-3 font-medium">NCM</th>
                          <th className="py-2 px-3 font-medium text-right">Qtd</th>
                          <th className="py-2 px-3 font-medium text-right">Vlr Unit.</th>
                          <th className="py-2 px-3 font-medium text-right">Vlr Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeInvoice.items.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-4 px-3 text-center text-slate-400">
                              Nenhum item detalhado encontrado neste documento.
                            </td>
                          </tr>
                        ) : (
                          activeInvoice.items.map((it, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/70">
                              <td className="py-2 px-3 font-mono text-slate-700 whitespace-nowrap">
                                {it.code || '—'}
                              </td>
                              <td className="py-2 px-3 text-slate-900 min-w-[200px]">
                                {it.description}
                              </td>
                              <td className="py-2 px-3 font-mono text-slate-500 whitespace-nowrap">
                                {it.ncm || '—'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                                {it.qty} {it.unit}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                                {formatBRL(it.unitPrice)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap">
                                {formatBRL(it.totalPrice)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* 3. Informações Complementares */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  3. Informações Complementares
                </h3>
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                  {activeInvoice.complementaryInfo && activeInvoice.complementaryInfo.trim()
                    ? activeInvoice.complementaryInfo
                    : 'Nenhuma informação complementar (<infCpl> / <infAdFisco>) registrada no XML deste documento.'}
                </div>
              </div>

              {/* 4. Conciliação & Escrituração */}
              <div className="pt-4 border-t border-slate-200 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    4. Conciliação P2P & Escrituração
                  </h3>
                  {!canEditActiveInvoice && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                      <Lock className="w-3 h-3" />
                      Modo somente leitura
                    </span>
                  )}
                </div>

                {/* Controle de Exigência de Recebimento Físico */}
                <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-semibold text-slate-800 block">
                      Passará pelo recebimento físico?
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {canToggleActivePhysicalReceipt
                        ? 'Defina se o documento exige entrada na doca ou segue fluxo direto no Fiscal.'
                        : Boolean(activeInvoice.receiptId) || Boolean(linkReceiptId)
                        ? 'Bloqueado pois há um Recebimento Físico vinculado.'
                        : 'Alteração bloqueada após o lançamento da nota.'}
                    </span>
                  </div>
                  <select
                    value={requiresReceiptForActive ? 'sim' : 'nao'}
                    disabled={!canToggleActivePhysicalReceipt}
                    onChange={(e) => {
                      const next = e.target.value === 'sim';
                      setEditRequiresPhysicalReceipt(next);
                      if (!next) {
                        setLinkReceiptId('');
                        if (editFiscalStatus === 'aguardando_recebimento') {
                          setEditFiscalStatus('pendente');
                        }
                      }
                    }}
                    className="px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    <option value="sim">Sim (Exige confirmação física na doca)</option>
                    <option value="nao">
                      Não (Fluxo direto no Fiscal — dispensa recebimento)
                    </option>
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Pedido de Compra Vinculado
                    </label>
                    {(() => {
                      const eligibleOrders = getEligiblePurchaseOrdersForCnpj(
                        activeInvoice.issuerCnpj,
                        activeInvoice.purchaseOrderId
                      );
                      return (
                        <>
                          <select
                            value={linkPoId}
                            disabled={
                              !canEditActiveInvoice ||
                              (!isAdmin && Boolean(activeInvoice.purchaseOrderId)) ||
                              Boolean(activeAdjustmentRequest)
                            }
                            onChange={(e) => {
                              const nextPoId = e.target.value;
                              if (nextPoId !== linkPoId) {
                                setEditItemAssociations([]);
                              }
                              setLinkPoId(nextPoId);
                              if (!nextPoId) {
                                setEditIsPartialBilling(false);
                              }
                              if (linkReceiptId) {
                                const currentRec = physicalReceipts.find(
                                  (r) => r.id === linkReceiptId
                                );
                                if (currentRec && nextPoId && currentRec.purchaseOrderId !== nextPoId) {
                                  setLinkReceiptId('');
                                }
                              }
                            }}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                          >
                            <option value="">
                              {eligibleOrders.length === 0
                                ? 'Nenhum pedido pendente para este CNPJ'
                                : 'Sem vínculo'}
                            </option>
                            {eligibleOrders.map(({ po, remainingQty }) => (
                              <option key={po.id} value={po.id}>
                                {po.poNumber} — Saldo: {remainingQty} un ({po.supplierCnpj})
                              </option>
                            ))}
                          </select>
                          <span className="text-[11px] text-slate-500 mt-1 block">
                            {activeAdjustmentRequest
                              ? 'Vínculo gerenciado pela Solicitação de Ajuste com Compras abaixo.'
                              : !isAdmin && activeInvoice.purchaseOrderId
                              ? 'Desvinculação permitida apenas ao ADM Titular.'
                              : `Filtrado por saldo pendente e CNPJ exato (${activeInvoice.issuerCnpj}).`}
                          </span>
                          {linkPoId && (
                            <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                disabled={!canEditActiveInvoice}
                                checked={editIsPartialBilling}
                                onChange={(e) => setEditIsPartialBilling(e.target.checked)}
                                className="rounded border-slate-300"
                              />
                              Faturamento / Entrega Parcial (múltiplas notas atendendo este Pedido)
                            </label>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Recebimento Físico Vinculado
                    </label>
                    {(() => {
                      const invCnpj = normalizeCnpjDigits(activeInvoice.issuerCnpj);
                      const eligibleReceipts = physicalReceipts.filter((rec) => {
                        if (rec.id === activeInvoice.receiptId) return true;
                        const recCnpj = normalizeCnpjDigits(rec.supplierCnpj);
                        if (invCnpj && recCnpj !== invCnpj) return false;
                        if (linkPoId && rec.purchaseOrderId !== linkPoId) return false;
                        return true;
                      });
                      return (
                        <select
                          value={linkReceiptId}
                          disabled={
                            !canEditActiveInvoice ||
                            !requiresReceiptForActive ||
                            (!isAdmin && Boolean(activeInvoice.receiptId))
                          }
                          onChange={(e) => {
                            const nextRecId = e.target.value;
                            setLinkReceiptId(nextRecId);
                            if (
                              !nextRecId &&
                              requiresReceiptForActive &&
                              (editFiscalStatus === 'lancado' || editFiscalStatus === 'escriturada')
                            ) {
                              setEditFiscalStatus('aguardando_recebimento');
                              setEditBookkeepingDate('');
                            }
                          }}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                        >
                          <option value="">
                            {!requiresReceiptForActive
                              ? 'Dispensado (não passa pelo recebimento físico)'
                              : eligibleReceipts.length === 0
                              ? 'Nenhum recebimento compatível'
                              : 'Sem vínculo'}
                          </option>
                          {eligibleReceipts.map((rec) => (
                            <option key={rec.id} value={rec.id}>
                              {rec.receiptNumber} — {rec.poNumber || 'Sem PO'}
                            </option>
                          ))}
                        </select>
                      );
                    })()}
                  </div>
                </div>

                {/* Painel da Solicitação de Ajuste com Compras (quando aberta) */}
                {activeAdjustmentRequest && (
                  <div className="p-4 rounded-lg bg-amber-50/70 border border-amber-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-semibold text-amber-950 block">
                          Solicitação de Ajuste com Compras · Pedido {activeAdjustmentRequest.poNumber}
                        </span>
                        <span className="text-[11px] text-amber-800">
                          Status atual: <span className="font-semibold">{activeAdjustmentRequest.status}</span>
                        </span>
                      </div>
                      <StatusTag
                        label={activeAdjustmentRequest.status}
                        tone={
                          activeAdjustmentRequest.status === 'Ajustado' ||
                          activeAdjustmentRequest.status === 'Devolvido para revisão fiscal'
                            ? 'info'
                            : 'warning'
                        }
                      />
                    </div>

                    {activeAdjustmentRequest.divergenceReasons.length > 0 && (
                      <ul className="list-disc pl-4 text-xs text-amber-900 space-y-0.5">
                        {activeAdjustmentRequest.divergenceReasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    )}

                    {activeAdjustmentRequest.comprasResponse && (
                      <div className="p-2.5 rounded bg-white border border-amber-200 text-xs text-slate-800">
                        <span className="font-semibold text-slate-900">Resposta de Compras: </span>
                        {activeAdjustmentRequest.comprasResponse}
                      </div>
                    )}

                    {adjustmentPreviewMatch?.financialComparison && (
                      <div className="border border-amber-200 rounded bg-white overflow-hidden">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                            <tr>
                              <th className="py-1.5 px-2.5 font-medium">
                                Pré-confronto atual após revisão do Pedido {activeAdjustmentRequest.poNumber}
                              </th>
                              <th className="py-1.5 px-2.5 font-medium text-right">Pedido</th>
                              <th className="py-1.5 px-2.5 font-medium text-right">Nota</th>
                              <th className="py-1.5 px-2.5 font-medium text-right">Situação</th>
                            </tr>
                          </thead>
                          <tbody className="tabular-nums">
                            <tr>
                              <td className="py-1.5 px-2.5 text-slate-800">
                                {adjustmentPreviewMatch.financialComparison.criterionLabel}
                              </td>
                              <td className="py-1.5 px-2.5 text-right font-mono">
                                {formatBRL(adjustmentPreviewMatch.financialComparison.poComparedAmount)}
                              </td>
                              <td className="py-1.5 px-2.5 text-right font-mono">
                                {formatBRL(adjustmentPreviewMatch.financialComparison.invoiceComparedAmount)}
                              </td>
                              <td className="py-1.5 px-2.5 text-right font-semibold">
                                {adjustmentPreviewMatch.financialComparison.matches ? (
                                  <span className="text-emerald-700">Confere</span>
                                ) : (
                                  <span className="text-amber-700">
                                    Diverge ({formatBRL(adjustmentPreviewMatch.financialComparison.differenceAmount)})
                                  </span>
                                )}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {canEditActiveInvoice && (
                      <div className="space-y-2 pt-1">
                        <input
                          type="text"
                          value={fiscalResolutionNote}
                          onChange={(e) => setFiscalResolutionNote(e.target.value)}
                          placeholder="Observação fiscal para resolver, reabrir (obrigatório ao reabrir) ou cancelar..."
                          className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded bg-white"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void handleResolveOrUpdateActiveAdjustment('Resolvido')}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer disabled:opacity-50"
                          >
                            Resolver e Vincular Pedido {activeAdjustmentRequest.poNumber}
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void handleResolveOrUpdateActiveAdjustment('Reaberto')}
                            className="px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 hover:bg-amber-100 rounded-lg cursor-pointer disabled:opacity-50"
                          >
                            Devolver / Reabrir p/ Compras
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void handleResolveOrUpdateActiveAdjustment('Cancelado')}
                            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer disabled:opacity-50"
                          >
                            Cancelar Solicitação
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {(() => {
                  const selectedFichaPo = purchaseOrders.find((p) => p.id === linkPoId);
                  return (
                    <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-800">
                          {requiresReceiptForActive
                            ? 'Cruzamento Three-Way Match (Pedido × Doca × Documento Fiscal)'
                            : 'Cruzamento Two-Way Match (Pedido × Documento Fiscal · Dispensa Recebimento)'}
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {activeInvoice.conferenceStatus === 'conferido' && !isConferenceStale && (
                            <StatusTag label="Conferido" tone="success" />
                          )}
                          <StatusTag
                            label={
                              activeAdjustmentRequest
                                ? 'Aguardando ajuste de Compras'
                                : modalMatchPreview.conferenceBadgeState === 'sem_divergencia'
                                ? 'Sem divergência'
                                : modalMatchPreview.conferenceBadgeState === 'divergente'
                                ? 'Divergente'
                                : modalMatchPreview.conferenceBadgeState === 'aguardando_conciliacao'
                                ? 'Aguardando Conciliação'
                                : 'Aguardando Vinculação'
                            }
                            tone={
                              activeAdjustmentRequest
                                ? 'warning'
                                : modalMatchPreview.conferenceBadgeState === 'sem_divergencia'
                                ? 'success'
                                : modalMatchPreview.conferenceBadgeState === 'divergente'
                                ? 'warning'
                                : modalMatchPreview.conferenceBadgeState === 'aguardando_conciliacao'
                                ? 'info'
                                : 'neutral'
                            }
                          />
                        </div>
                      </div>

                      {isConferenceStale && (
                        <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                          Os dados do Pedido, da Nota ou das associações mudaram após a última conferência. Reconfirme abaixo após revisar.
                        </div>
                      )}

                      {selectedFichaPo && (
                        <ItemReconciliationEditor
                          supplierCnpj={activeInvoice.issuerCnpj}
                          invoiceItems={activeInvoice.items}
                          poItems={selectedFichaPo.items}
                          associations={modalMatchPreview.associations}
                          suggestions={modalMatchPreview.suggestions}
                          unmatchedInvoiceItemIndexes={modalMatchPreview.unmatchedInvoiceItemIndexes}
                          unmatchedPoItemIndexes={modalMatchPreview.unmatchedPoItemIndexes}
                          canEdit={canEditActiveInvoice && !activeAdjustmentRequest}
                          onChangeAssociations={setEditItemAssociations}
                          onSaveEquivalence={async (eq) => {
                            await upsertProductEquivalence(eq);
                          }}
                        />
                      )}

                      {modalMatchPreview.itemComparisons.length > 0 && (
                        <div className="border border-slate-200 rounded-md bg-white overflow-hidden">
                          <div className="max-h-40 overflow-y-auto overflow-x-auto">
                            <table className="w-full text-left border-collapse text-[11px]">
                              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                                <tr>
                                  <th className="py-1.5 px-2.5 font-medium">Item (Pedido × Nota)</th>
                                  <th className="py-1.5 px-2.5 font-medium text-right">Qtd Ped.</th>
                                  <th className="py-1.5 px-2.5 font-medium text-right">Qtd NF</th>
                                  <th className="py-1.5 px-2.5 font-medium text-right">Unit. Ped.</th>
                                  <th className="py-1.5 px-2.5 font-medium text-right">Unit. NF</th>
                                  <th className="py-1.5 px-2.5 font-medium text-right">Conferência</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 tabular-nums">
                                {modalMatchPreview.itemComparisons.map((cmp, i) => (
                                  <tr key={i}>
                                    <td className="py-1.5 px-2.5 text-slate-800 max-w-[180px] truncate" title={cmp.description}>
                                      {cmp.description}
                                    </td>
                                    <td className="py-1.5 px-2.5 text-right font-mono text-slate-700">
                                      {cmp.poQty !== null ? cmp.poQty : '—'}
                                    </td>
                                    <td className="py-1.5 px-2.5 text-right font-mono text-slate-700">
                                      {cmp.invoiceQty !== null ? cmp.invoiceQty : '—'}
                                    </td>
                                    <td className="py-1.5 px-2.5 text-right font-mono text-slate-700">
                                      {cmp.poUnitPrice !== null ? formatBRL(cmp.poUnitPrice) : '—'}
                                    </td>
                                    <td className="py-1.5 px-2.5 text-right font-mono text-slate-700">
                                      {cmp.invoiceUnitPrice !== null
                                        ? formatBRL(cmp.invoiceUnitPrice)
                                        : '—'}
                                    </td>
                                    <td className="py-1.5 px-2.5 text-right whitespace-nowrap">
                                      {!cmp.matchedInPo ? (
                                        <span className="text-amber-700 font-medium">Fora do PO</span>
                                      ) : !cmp.qtyMatch ? (
                                        <span className="text-amber-700 font-medium">Qtd diverge</span>
                                      ) : !cmp.unitPriceMatch ? (
                                        <span className="text-slate-600">Unit. difere</span>
                                      ) : (
                                        <span className="text-emerald-700 font-medium">Confere</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {modalMatchPreview.financialComparison && (
                        <div className="border border-slate-200 rounded-md bg-white overflow-hidden">
                          <table className="w-full text-left border-collapse text-[11px]">
                            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                              <tr>
                                <th className="py-1.5 px-2.5 font-medium">Confronto de Valores</th>
                                <th className="py-1.5 px-2.5 font-medium text-right">
                                  Pedido de Compra
                                </th>
                                <th className="py-1.5 px-2.5 font-medium text-right">Nota Fiscal</th>
                                <th className="py-1.5 px-2.5 font-medium text-right">Situação</th>
                              </tr>
                            </thead>
                            <tbody className="tabular-nums">
                              <tr>
                                <td className="py-2 px-2.5 font-medium text-slate-800">
                                  {modalMatchPreview.financialComparison.criterionLabel}
                                  {modalMatchPreview.isPartialBilling && (
                                    <span className="text-blue-700 ml-1.5">(Parcela)</span>
                                  )}
                                </td>
                                <td className="py-2 px-2.5 text-right font-mono text-slate-900">
                                  {formatBRL(modalMatchPreview.financialComparison.poComparedAmount)}
                                </td>
                                <td className="py-2 px-2.5 text-right font-mono text-slate-900">
                                  {formatBRL(modalMatchPreview.financialComparison.invoiceComparedAmount)}
                                </td>
                                <td className="py-2 px-2.5 text-right whitespace-nowrap">
                                  {modalMatchPreview.financialComparison.matches ? (
                                    <span className="text-emerald-700 font-semibold">Confere</span>
                                  ) : (
                                    <span className="text-amber-700 font-semibold">
                                      Diverge ({formatBRL(modalMatchPreview.financialComparison.differenceAmount)})
                                    </span>
                                  )}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}

                      {modalMatchPreview.reasons.length > 0 && (
                        <ul className="list-disc pl-4 text-xs text-amber-800 pt-1 space-y-0.5">
                          {modalMatchPreview.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      )}

                      {canEditActiveInvoice && linkPoId && !activeAdjustmentRequest && (
                        <div className="pt-3 border-t border-slate-200 space-y-2.5">
                          {modalMatchPreview.conferenceBadgeState === 'divergente' && (
                            <div>
                              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                                Justificativa para confirmar conferência divergente (obrigatória ao confirmar)
                              </label>
                              <input
                                type="text"
                                value={confJustificationInput}
                                onChange={(e) => setConfJustificationInput(e.target.value)}
                                placeholder="Explique por que aceita a divergência..."
                                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                              />
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <button
                              type="button"
                              disabled={
                                saving ||
                                modalMatchPreview.unmatchedInvoiceItemIndexes.length > 0
                              }
                              onClick={() => void handleConfirmActiveConference()}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:opacity-50 cursor-pointer"
                            >
                              <BookmarkCheck className="w-3.5 h-3.5" />
                              Confirmar Conferência
                            </button>

                            {(modalMatchPreview.conferenceBadgeState === 'divergente' ||
                              modalMatchPreview.unmatchedInvoiceItemIndexes.length > 0) && (
                              <div className="flex flex-wrap items-center gap-2 flex-1 justify-end">
                                <input
                                  type="text"
                                  value={adjObservationInput}
                                  onChange={(e) => setAdjObservationInput(e.target.value)}
                                  placeholder="Observação para Compras (opcional)"
                                  className="min-w-[200px] flex-1 max-w-xs px-2.5 py-1.5 text-xs border border-amber-300 rounded bg-white"
                                />
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => void handleCreateActiveAdjustment()}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg cursor-pointer disabled:opacity-50"
                                >
                                  <MessageSquareWarning className="w-3.5 h-3.5 text-amber-800" />
                                  Notificar Compras
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {!canLaunchActive ? (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <span>
                      <span className="font-semibold">Lançamento bloqueado:</span>{' '}
                      {!hasLinkedPo && requiresReceiptForActive && !hasSignaledReceipt
                        ? 'vincule um Pedido de Compra e aguarde a sinalização do recebimento físico pelo setor de Recebimento.'
                        : !hasLinkedPo
                        ? 'é obrigatório vincular um Pedido de Compra antes de lançar a nota fiscal.'
                        : 'esta nota foi cadastrada para fluxo com conferência física e exige a sinalização do Recebimento antes do lançamento.'}
                    </span>
                  </div>
                ) : !requiresReceiptForActive ? (
                  <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-start gap-2.5 text-xs text-blue-900">
                    <CheckCircle2 className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                    <span>
                      <span className="font-semibold">Fluxo direto do Fiscal:</span> Pedido de Compra vinculado. Esta nota dispensa confirmação de recebimento físico na doca para ser lançada.
                    </span>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Status do Documento
                    </label>
                    <select
                      value={editFiscalStatus}
                      disabled={!canEditActiveInvoice}
                      onChange={(e) => {
                        const next = e.target.value as FiscalStatus;
                        setEditFiscalStatus(next);
                        if (next !== 'substituida') {
                          setReplacedByInvoiceId('');
                        }
                        if (next === 'lancado' || next === 'escriturada') {
                          if (!editBookkeepingDate) {
                            setEditBookkeepingDate(todayISO());
                          }
                        } else if (next === 'aguardando_recebimento') {
                          setEditBookkeepingDate('');
                        }
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                    >
                      <option
                        value="aguardando_recebimento"
                        disabled={!requiresReceiptForActive}
                      >
                        Aguardando Recebimento
                        {!requiresReceiptForActive ? ' (Não aplicável a fluxo direto)' : ''}
                      </option>
                      <option value="pendente">Pendente</option>
                      <option value="lancado" disabled={!canLaunchActive}>
                        Lançado
                        {!canLaunchActive
                          ? requiresReceiptForActive
                            ? ' (Requer Pedido e Recebimento físico)'
                            : ' (Requer Pedido de Compra)'
                          : ''}
                      </option>
                      <option value="substituida">Substituída</option>
                      <option value="rejeitada">Rejeitada</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Data de Lançamento (Escrituração)
                    </label>
                    <input
                      type="date"
                      disabled={!canEditActiveInvoice}
                      value={editBookkeepingDate}
                      onChange={(e) => setEditBookkeepingDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                    />
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      Preenchida automaticamente com a data de hoje ao lançar (ajustável manualmente).
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Parecer / Observações Fiscais
                  </label>
                  <textarea
                    rows={2}
                    disabled={!canEditActiveInvoice}
                    maxLength={BLUEPRINT_LIMITS.MAX_NOTES}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Anotações da conferência fiscal..."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                {editFiscalStatus === 'substituida' && (
                  <div className="p-4 rounded-lg bg-amber-50/70 border border-amber-200 space-y-2">
                    <label className="block text-xs font-semibold text-amber-900">
                      Substituída por qual Nota Fiscal? (Notas pendentes de {activeInvoice.issuerName})
                    </label>
                    <select
                      value={replacedByInvoiceId}
                      disabled={!canEditActiveInvoice}
                      required
                      onChange={(e) => setReplacedByInvoiceId(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-amber-300 rounded-lg bg-white disabled:bg-slate-100"
                    >
                      <option value="">
                        {pendingReplacementCandidates.length === 0
                          ? 'Nenhuma nota pendente encontrada para este fornecedor'
                          : 'Selecione a nota fiscal substituta...'}
                      </option>
                      {pendingReplacementCandidates.map((cand) => {
                        const statusLabel =
                          cand.fiscalStatus === 'aguardando_recebimento'
                            ? 'Aguard. Recebimento'
                            : 'Pendente';
                        return (
                          <option key={cand.id} value={cand.id}>
                            {DOC_TYPE_LABELS[cand.docType || 'NFE']} {cand.nfeNumber} (S{cand.series}) ·{' '}
                            {formatDateBR(cand.issueDate)} · {formatBRL(cand.totalInvoice)} · [{statusLabel}]
                          </option>
                        );
                      })}
                    </select>
                    <p className="text-[11px] text-amber-800">
                      {pendingReplacementCandidates.length === 0
                        ? `Importe o XML da nova nota emitida pelo CNPJ ${activeInvoice.issuerCnpj} para vincular a substituição.`
                        : 'Exibindo todas as notas pendentes / aguardando recebimento vinculadas ao CNPJ deste mesmo fornecedor.'}
                    </p>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setActiveInvoice(null)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                  >
                    {canEditActiveInvoice ? 'Cancelar' : 'Fechar'}
                  </button>
                  {canEditActiveInvoice && (
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-5 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                    >
                      {saving ? 'Salvando...' : 'Salvar Conciliação'}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unlink Modal (ADM Titular only) */}
      {unlinkTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6">
            <h3 className="font-display text-base font-semibold text-slate-900 mb-2">
              Desvincular Nota Fiscal
            </h3>
            <p className="text-sm text-slate-600 mb-5">
              Como <span className="font-medium text-slate-900">ADM Titular</span>, confirma a desvinculação completa do documento{' '}
              <span className="font-mono font-semibold">{unlinkTarget.nfeNumber}</span> de seu Pedido e Recebimento?
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
                {saving ? 'Desvinculando...' : 'Desvincular Registros'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Fiscal Invoice Modal */}
      {manualModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Cadastrar Nota Fiscal Manualmente
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Lançamento direto de NF-e, NFS-e ou CT-e sem arquivo XML
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="p-6 overflow-y-auto space-y-6">
              {manualFormError && (
                <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {manualFormError}
                </div>
              )}

              {/* 1. Identificação do Documento */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  1. Identificação do Documento & Emitente
                </h3>
                <div
                  className={`grid grid-cols-1 ${
                    manualDocType === 'NFSE' ? 'sm:grid-cols-3' : 'sm:grid-cols-4'
                  } gap-4`}
                >
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Tipo do Documento
                    </label>
                    <select
                      value={manualDocType}
                      onChange={(e) => setManualDocType(e.target.value as FiscalDocType)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="NFE">NF-e (Produto)</option>
                      <option value="NFSE">NFS-e (Serviço)</option>
                      <option value="CTE">CT-e (Transporte)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Número da Nota *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={20}
                      value={manualNfeNumber}
                      onChange={(e) => setManualNfeNumber(e.target.value)}
                      placeholder="Ex: 105652"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  {manualDocType !== 'NFSE' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Série</label>
                      <input
                        type="text"
                        maxLength={10}
                        value={manualSeries}
                        onChange={(e) => setManualSeries(e.target.value)}
                        placeholder="1"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Data de Emissão *
                    </label>
                    <input
                      type="date"
                      required
                      value={manualIssueDate}
                      onChange={(e) => setManualIssueDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                {manualDocType === 'NFSE' && (
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Regime Tributário do Prestador (NFS-e)
                      </label>
                      <select
                        value={manualTaxRegime}
                        onChange={(e) =>
                          handleManualTaxRegimeChange(e.target.value as ServiceTaxRegime)
                        }
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="mei">MEI — Não retém nenhum imposto</option>
                        <option value="simples_nacional">
                          Simples Nacional — Retém ISSQN e INSS
                        </option>
                        <option value="regime_normal">
                          Regime Normal — Retém todos os impostos
                        </option>
                      </select>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed pt-1 sm:pt-4">
                      {manualTaxRegime === 'mei'
                        ? 'MEI selecionado: nenhum imposto é retido e os tributos de serviço ficam zerados.'
                        : manualTaxRegime === 'simples_nacional'
                        ? 'Simples Nacional selecionado: campos ISSQN e INSS liberados abaixo (preenchimento opcional).'
                        : 'Regime Normal selecionado: campos PIS, COFINS, CSLL, ISSQN, INSS e IRRF liberados abaixo (preenchimento opcional).'}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Razão Social do Emitente / Fornecedor *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={BLUEPRINT_LIMITS.MAX_SUPPLIER_NAME}
                      value={manualIssuerName}
                      onChange={(e) => setManualIssuerName(e.target.value)}
                      placeholder="Razão Social do fornecedor"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      CNPJ do Emitente *
                    </label>
                    <input
                      type="text"
                      required
                      value={manualIssuerCnpj}
                      onChange={(e) => setManualIssuerCnpj(maskCnpj(e.target.value))}
                      placeholder="00.000.000/0000-00"
                      className={`w-full px-3 py-2 text-sm font-mono border rounded-lg ${
                        manualIssuerCnpj.replace(/\D/g, '').length === 14
                          ? isValidCnpj(manualIssuerCnpj)
                            ? 'border-emerald-500 bg-emerald-50/30'
                            : 'border-red-500 bg-red-50/30'
                          : 'border-slate-300'
                      }`}
                    />
                    {manualIssuerCnpj.replace(/\D/g, '').length === 14 &&
                      !isValidCnpj(manualIssuerCnpj) && (
                        <span className="text-[11px] text-red-700 mt-1 block">
                          Dígito verificador do CNPJ inválido.
                        </span>
                      )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Chave de Acesso / Protocolo (Opcional)
                    </label>
                    <input
                      type="text"
                      maxLength={BLUEPRINT_LIMITS.MAX_ACCESS_KEY}
                      value={manualAccessKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        setManualAccessKey(val);
                        if (manualDocType !== 'NFSE') {
                          const inferredUf = getUfFromCodeOrAccessKey(val);
                          if (inferredUf && !manualIssuerState) {
                            setManualIssuerState(inferredUf);
                          }
                        }
                      }}
                      placeholder="44 dígitos ou deixe vazio para protocolo automático"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Passará pelo recebimento físico?
                    </label>
                    <select
                      value={manualRequiresPhysicalReceipt ? 'sim' : 'nao'}
                      onChange={(e) => setManualRequiresPhysicalReceipt(e.target.value === 'sim')}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="sim">Sim (Exige confirmação física na doca)</option>
                      <option value="nao">Não (Fluxo direto no Fiscal — dispensa recebimento)</option>
                    </select>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                  <label className="block text-xs font-medium text-slate-700">
                    Pedido de Compra Vinculado (Opcional)
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={manualPoId}
                      onChange={(e) => handleManualSelectPo(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="">
                        {manualEligiblePurchaseOrders.length === 0
                          ? 'Nenhum pedido pendente compatível'
                          : 'Sem vínculo agora'}
                      </option>
                      {manualEligiblePurchaseOrders.map(({ po, remainingQty }) => (
                        <option key={po.id} value={po.id}>
                          {po.poNumber} · {po.supplierName} (Saldo: {remainingQty} un)
                        </option>
                      ))}
                    </select>
                    {manualPoId && (
                      <button
                        type="button"
                        onClick={handleImportItemsFromManualPo}
                        title="Copiar itens do Pedido de Compra selecionado"
                        className="px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Puxar Itens
                      </button>
                    )}
                  </div>
                  {manualPoId && (
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={manualIsPartialBilling}
                        onChange={(e) => setManualIsPartialBilling(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      Faturamento / Entrega Parcial (múltiplas notas para este Pedido)
                    </label>
                  )}
                </div>

                {manualDocType === 'NFE' && (
                  <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700">
                        UF do Emitente & Acompanhamento SUFRAMA / PIN (Opcional)
                      </span>
                      {manualIssuerState && (
                        <span
                          className={`text-xs font-semibold ${
                            manualIssuerState !== companyUf ? 'text-amber-700' : 'text-emerald-700'
                          }`}
                        >
                          {manualIssuerState !== companyUf
                            ? `Nota de Fora (${manualIssuerState} → ${companyUf})`
                            : `Operação Interna (${companyUf})`}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          UF do Emitente
                        </label>
                        <select
                          value={manualIssuerState}
                          onChange={(e) => setManualIssuerState(e.target.value)}
                          className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg bg-white"
                        >
                          <option value="">Selecionar UF</option>
                          {BRAZIL_STATES.map((st) => (
                            <option key={st.uf} value={st.uf}>
                              {st.uf} — {st.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Nº do PIN (SUFRAMA)
                        </label>
                        <input
                          type="text"
                          maxLength={BLUEPRINT_LIMITS.MAX_SUFRAMA_PIN}
                          value={manualSuframaPinNumber}
                          onChange={(e) => setManualSuframaPinNumber(e.target.value)}
                          placeholder="Ex: 123456789"
                          className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Data Aceite do PIN
                        </label>
                        <input
                          type="date"
                          value={manualSuframaPinAcceptanceDate}
                          onChange={(e) => setManualSuframaPinAcceptanceDate(e.target.value)}
                          className="w-full px-2.5 py-2 text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Data Receb. do PIN
                        </label>
                        <input
                          type="date"
                          value={manualSuframaPinReceiptDate}
                          onChange={(e) => setManualSuframaPinReceiptDate(e.target.value)}
                          className="w-full px-2.5 py-2 text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Data do Desembaraço
                        </label>
                        <input
                          type="date"
                          value={manualSuframaClearanceDate}
                          onChange={(e) => setManualSuframaClearanceDate(e.target.value)}
                          className="w-full px-2.5 py-2 text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {manualDocType === 'CTE' && (
                  <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Nota Fiscal Vinculada ao Transporte (NF-e / NFS-e)
                      </label>
                      <select
                        value={manualLinkedInvoiceId}
                        onChange={(e) => setManualLinkedInvoiceId(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="">
                          {linkableInvoicesForCte.length === 0
                            ? 'Nenhuma NF-e ou NFS-e cadastrada para vincular'
                            : 'Sem vínculo com nota fiscal agora (opcional)'}
                        </option>
                        {linkableInvoicesForCte.map((nf) => (
                          <option key={nf.id} value={nf.id}>
                            {DOC_TYPE_LABELS[nf.docType || 'NFE']} {nf.nfeNumber} · {nf.issuerName} ·{' '}
                            {formatBRL(nf.totalInvoice)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Estado (UF) de Origem
                        </label>
                        <select
                          value={manualOriginState}
                          onChange={(e) => {
                            setManualOriginState(e.target.value);
                            setManualOriginCity('');
                          }}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                        >
                          <option value="">Selecione UF</option>
                          {BRAZIL_STATES.map((st) => (
                            <option key={st.uf} value={st.uf}>
                              {st.uf} — {st.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Cidade de Origem
                        </label>
                        <select
                          value={manualOriginCity}
                          disabled={!manualOriginState}
                          onChange={(e) => setManualOriginCity(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                        >
                          <option value="">
                            {manualOriginState
                              ? 'Selecione a cidade'
                              : 'Selecione a UF primeiro'}
                          </option>
                          {getCityOptions(manualOriginState, manualOriginCity).map((city) => (
                            <option key={city} value={city}>
                              {city}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Estado (UF) de Saída / Destino
                        </label>
                        <select
                          value={manualDestinationState}
                          onChange={(e) => {
                            setManualDestinationState(e.target.value);
                            setManualDestinationCity('');
                          }}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                        >
                          <option value="">Selecione UF</option>
                          {BRAZIL_STATES.map((st) => (
                            <option key={st.uf} value={st.uf}>
                              {st.uf} — {st.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Cidade de Saída / Destino
                        </label>
                        <select
                          value={manualDestinationCity}
                          disabled={!manualDestinationState}
                          onChange={(e) => setManualDestinationCity(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                        >
                          <option value="">
                            {manualDestinationState
                              ? 'Selecione a cidade'
                              : 'Selecione a UF primeiro'}
                          </option>
                          {getCityOptions(
                            manualDestinationState,
                            manualDestinationCity
                          ).map((city) => (
                            <option key={city} value={city}>
                              {city}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Itens da Nota Fiscal */}
              <div className="space-y-3 pt-4 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    2. Itens / Serviços da Nota ({manualItems.length})
                  </h3>
                  <button
                    type="button"
                    onClick={addManualItemRow}
                    disabled={manualItems.length >= BLUEPRINT_LIMITS.MAX_ITEMS}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar Item
                  </button>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                          <th className="py-2 px-2.5 w-24">Código</th>
                          <th className="py-2 px-2.5">Descrição *</th>
                          <th className="py-2 px-2.5 w-24">NCM</th>
                          <th className="py-2 px-2.5 w-16">Unid.</th>
                          <th className="py-2 px-2.5 w-24 text-right">Qtd *</th>
                          <th className="py-2 px-2.5 w-28 text-right">Vlr Unit.</th>
                          <th className="py-2 px-2.5 w-28 text-right">Total</th>
                          <th className="py-2 px-2 w-9"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {manualItems.map((it, idx) => (
                          <tr key={idx}>
                            <td className="py-1.5 px-2">
                              <input
                                type="text"
                                maxLength={40}
                                value={it.code}
                                onChange={(e) => updateManualItemField(idx, 'code', e.target.value)}
                                className="w-full px-2 py-1.5 font-mono border border-slate-200 rounded"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="text"
                                required
                                maxLength={BLUEPRINT_LIMITS.MAX_ITEM_DESC}
                                value={it.description}
                                onChange={(e) =>
                                  updateManualItemField(idx, 'description', e.target.value)
                                }
                                placeholder="Descrição do produto ou serviço"
                                className="w-full px-2 py-1.5 border border-slate-200 rounded min-w-[180px]"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="text"
                                maxLength={12}
                                value={it.ncm}
                                onChange={(e) => updateManualItemField(idx, 'ncm', e.target.value)}
                                placeholder="00000000"
                                className="w-full px-2 py-1.5 font-mono border border-slate-200 rounded"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="text"
                                maxLength={12}
                                value={it.unit}
                                onChange={(e) => updateManualItemField(idx, 'unit', e.target.value)}
                                className="w-full px-2 py-1.5 font-mono border border-slate-200 rounded"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="number"
                                min={0.01}
                                step="any"
                                required
                                value={it.qty}
                                onChange={(e) =>
                                  updateManualItemField(idx, 'qty', Number(e.target.value))
                                }
                                className="w-full px-2 py-1.5 text-right font-mono tabular-nums border border-slate-200 rounded"
                              />
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={it.unitPrice}
                                onChange={(e) =>
                                  updateManualItemField(idx, 'unitPrice', Number(e.target.value))
                                }
                                className="w-full px-2 py-1.5 text-right font-mono tabular-nums border border-slate-200 rounded"
                              />
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap">
                              {formatBRL(it.totalPrice)}
                            </td>
                            <td className="py-1.5 px-1 text-center">
                              {manualItems.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeManualItemRow(idx)}
                                  title="Remover item"
                                  className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* 3. Valores, Tributos & Informações Complementares */}
              <div className="space-y-4 pt-4 border-t border-slate-200">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  3. Valores, Tributos & Informações Complementares
                </h3>

                <div
                  className={`grid grid-cols-2 ${
                    manualDocType === 'NFSE' ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-4'
                  } gap-3`}
                >
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {manualDocType === 'NFSE'
                        ? 'Subtotal Serviços'
                        : 'Subtotal Produtos / Serviços'}
                    </label>
                    <div className="px-3 py-2 text-sm font-mono font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg tabular-nums">
                      {formatBRL(manualItemsSubtotal)}
                    </div>
                  </div>
                  {manualDocType !== 'NFSE' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Valor do Frete (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={manualFreightAmount}
                          onChange={(e) =>
                            setManualFreightAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Seguro (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={manualInsuranceAmount}
                          onChange={(e) =>
                            setManualInsuranceAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Outras Despesas (R$)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={manualOtherExpensesAmount}
                      onChange={(e) =>
                        setManualOtherExpensesAmount(Math.max(0, Number(e.target.value)))
                      }
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Acréscimos (R$)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={manualSurchargeAmount}
                      onChange={(e) =>
                        setManualSurchargeAmount(Math.max(0, Number(e.target.value)))
                      }
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Descontos (R$)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={manualDiscountAmount}
                      onChange={(e) => setManualDiscountAmount(Math.max(0, Number(e.target.value)))}
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div className={manualDocType !== 'NFSE' ? 'col-span-2 sm:col-span-1' : ''}>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Valor Líquido da Nota (R$)
                    </label>
                    <input
                      type="text"
                      readOnly
                      tabIndex={-1}
                      aria-readonly="true"
                      value={formatBRL(manualComputedTotal)}
                      className="w-full px-3 py-2 text-sm font-mono font-bold tabular-nums border border-slate-300 rounded-lg bg-slate-100 text-slate-900 cursor-not-allowed"
                    />
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      Calculado automaticamente (somente leitura)
                    </span>
                  </div>
                </div>

                {manualDocType === 'NFSE' ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          PIS (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={manualTaxRegime !== 'regime_normal'}
                          value={manualTaxRegime === 'regime_normal' ? manualPisAmount : 0}
                          onChange={(e) =>
                            setManualPisAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          COFINS (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={manualTaxRegime !== 'regime_normal'}
                          value={manualTaxRegime === 'regime_normal' ? manualCofinsAmount : 0}
                          onChange={(e) =>
                            setManualCofinsAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          CSLL (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={manualTaxRegime !== 'regime_normal'}
                          value={manualTaxRegime === 'regime_normal' ? manualCsllAmount : 0}
                          onChange={(e) =>
                            setManualCsllAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          ISSQN (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={manualTaxRegime === 'mei'}
                          value={manualTaxRegime === 'mei' ? 0 : manualIssqnAmount}
                          onChange={(e) =>
                            setManualIssqnAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          INSS (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={manualTaxRegime === 'mei'}
                          value={manualTaxRegime === 'mei' ? 0 : manualInssAmount}
                          onChange={(e) =>
                            setManualInssAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          IRRF (R$)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={manualTaxRegime !== 'regime_normal'}
                          value={manualTaxRegime === 'regime_normal' ? manualIrrfAmount : 0}
                          onChange={(e) =>
                            setManualIrrfAmount(Math.max(0, Number(e.target.value)))
                          }
                          className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={manualTaxRegime === 'mei'}
                        checked={manualIssqnRetained}
                        onChange={(e) => setManualIssqnRetained(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      ISSQN Retido na fonte (deduz do valor líquido; desmarque se for apenas ISSQN destacado)
                    </label>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        ICMS ST (R$)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={manualDocType === 'CTE'}
                        value={manualDocType === 'CTE' ? 0 : manualIcmsStAmount}
                        onChange={(e) =>
                          setManualIcmsStAmount(Math.max(0, Number(e.target.value)))
                        }
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        IPI (R$)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={manualDocType === 'CTE'}
                        value={manualDocType === 'CTE' ? 0 : manualIpiAmount}
                        onChange={(e) => setManualIpiAmount(Math.max(0, Number(e.target.value)))}
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Retidos (R$)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={manualRetainedTaxesAmount}
                        onChange={(e) =>
                          setManualRetainedTaxesAmount(Math.max(0, Number(e.target.value)))
                        }
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        ICMS Desonerado
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={manualIcmsDesonAmount}
                        onChange={(e) =>
                          setManualIcmsDesonAmount(Math.max(0, Number(e.target.value)))
                        }
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-amber-300 bg-amber-50/30 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        ICMS (R$)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={manualIcmsAmount}
                        onChange={(e) => setManualIcmsAmount(Math.max(0, Number(e.target.value)))}
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        PIS (R$)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={manualPisAmount}
                        onChange={(e) => setManualPisAmount(Math.max(0, Number(e.target.value)))}
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        COFINS (R$)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={manualCofinsAmount}
                        onChange={(e) => setManualCofinsAmount(Math.max(0, Number(e.target.value)))}
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                )}

                {manualPoId && manualMatchPreview && (
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800">
                        Pré-Conferência com o Pedido Selecionado
                      </span>
                      <StatusTag
                        label={
                          manualMatchPreview.conferenceBadgeState === 'sem_divergencia'
                            ? 'Sem divergência'
                            : manualMatchPreview.conferenceBadgeState === 'aguardando_conciliacao'
                            ? 'Aguardando Conciliação'
                            : 'Divergente'
                        }
                        tone={
                          manualMatchPreview.conferenceBadgeState === 'sem_divergencia'
                            ? 'success'
                            : manualMatchPreview.conferenceBadgeState === 'aguardando_conciliacao'
                            ? 'info'
                            : 'warning'
                        }
                      />
                    </div>

                    {manualMatchPreview.financialComparison && (
                      <div className="border border-slate-200 rounded bg-white overflow-hidden">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                            <tr>
                              <th className="py-1.5 px-2.5 font-medium">Confronto de Valores</th>
                              <th className="py-1.5 px-2.5 font-medium text-right">Pedido</th>
                              <th className="py-1.5 px-2.5 font-medium text-right">Nota</th>
                              <th className="py-1.5 px-2.5 font-medium text-right">Situação</th>
                            </tr>
                          </thead>
                          <tbody className="tabular-nums">
                            <tr>
                              <td className="py-1.5 px-2.5 text-slate-800 font-medium">
                                {manualMatchPreview.financialComparison.criterionLabel}
                              </td>
                              <td className="py-1.5 px-2.5 text-right font-mono">
                                {formatBRL(manualMatchPreview.financialComparison.poComparedAmount)}
                              </td>
                              <td className="py-1.5 px-2.5 text-right font-mono">
                                {formatBRL(
                                  manualMatchPreview.financialComparison.invoiceComparedAmount
                                )}
                              </td>
                              <td className="py-1.5 px-2.5 text-right font-semibold">
                                {manualMatchPreview.financialComparison.matches ? (
                                  <span className="text-emerald-700">Confere</span>
                                ) : (
                                  <span className="text-amber-700">
                                    Diverge (
                                    {formatBRL(
                                      manualMatchPreview.financialComparison.differenceAmount
                                    )}
                                    )
                                  </span>
                                )}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {manualMatchPreview.reasons.length > 0 && (
                      <ul className="list-disc pl-4 text-xs text-amber-800 space-y-0.5">
                        {manualMatchPreview.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    )}

                    <div className="pt-1 space-y-2">
                      <label className="inline-flex items-center gap-2 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg cursor-pointer">
                        <input
                          type="checkbox"
                          checked={manualNotifyCompras}
                          onChange={(e) => setManualNotifyCompras(e.target.checked)}
                          className="rounded border-amber-400"
                        />
                        <MessageSquareWarning className="w-3.5 h-3.5 text-amber-700" />
                        Notificar Compras e cadastrar nota sem vínculo definitivo
                      </label>
                      {manualNotifyCompras && (
                        <input
                          type="text"
                          value={manualAdjObservation}
                          onChange={(e) => setManualAdjObservation(e.target.value)}
                          placeholder="Explique o ajuste necessário ao setor de Compras..."
                          className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded bg-white"
                        />
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Informações Complementares
                    </label>
                    <textarea
                      rows={3}
                      maxLength={BLUEPRINT_LIMITS.MAX_COMPLEMENTARY_INFO}
                      value={manualComplementaryInfo}
                      onChange={(e) => setManualComplementaryInfo(e.target.value)}
                      placeholder="Dados adicionais da nota, observações de isenção/desoneração, retenções..."
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Observações Internas do Fiscal
                    </label>
                    <textarea
                      rows={3}
                      maxLength={BLUEPRINT_LIMITS.MAX_NOTES}
                      value={manualNotes}
                      onChange={(e) => setManualNotes(e.target.value)}
                      placeholder="Anotação interna opcional"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setManualModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                >
                  {saving ? 'Salvando...' : 'Cadastrar Nota Fiscal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print Report Configuration & Sheet Preview Modal */}
      {reportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            className={`bg-white border border-slate-200 rounded-xl w-full ${
              reportStep === 'sheet' ? 'max-w-5xl' : 'max-w-2xl'
            } max-h-[92vh] flex flex-col overflow-hidden transition-all`}
          >
            <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  {reportStep === 'config'
                    ? 'Imprimir Relatório Fiscal'
                    : 'Folha do Relatório Fiscal'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {reportStep === 'config'
                    ? 'Escolha o escopo do relatório para visualização, impressão ou download em PDF'
                    : 'Confira os dados abaixo e baixe o PDF A4 ou envie para impressão'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReportModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {reportStep === 'config' ? (
              <>
                <div className="p-6 overflow-y-auto space-y-5">
                  <div className="space-y-2.5">
                    <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Qual relatório deseja imprimir?
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setReportType('pendentes')}
                        className={`p-4 rounded-xl border text-left transition-colors cursor-pointer ${
                          reportType === 'pendentes'
                            ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="text-sm font-semibold text-slate-900">
                          Pendentes de Recebimento e Lançamento
                        </div>
                        <p className="text-xs text-slate-600 mt-1">
                          Lista todas as notas aguardando conferência na doca ou pendentes de lançamento fiscal.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setReportType('lancadas')}
                        className={`p-4 rounded-xl border text-left transition-colors cursor-pointer ${
                          reportType === 'lancadas'
                            ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="text-sm font-semibold text-slate-900">
                          Notas Fiscais Lançadas
                        </div>
                        <p className="text-xs text-slate-600 mt-1">
                          Lista os documentos escriturados/lançados filtrados pela data de lançamento informada.
                        </p>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                    {reportType === 'lancadas' ? (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Qual Data de Lançamento?
                        </label>
                        <input
                          type="date"
                          disabled={reportAllLaunchDates}
                          value={reportBookingDate}
                          onChange={(e) => setReportBookingDate(e.target.value)}
                          className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        />
                        <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={reportAllLaunchDates}
                            onChange={(e) => setReportAllLaunchDates(e.target.checked)}
                            className="rounded border-slate-300"
                          />
                          Imprimir todas as datas de lançamento
                        </label>
                      </div>
                    ) : (
                      <div className="flex flex-col justify-center">
                        <span className="text-xs font-semibold text-slate-700">
                          Status incluídos neste relatório
                        </span>
                        <span className="text-xs text-slate-600 mt-1 tabular-nums">
                          {reportStats.awaitingReceive} aguardando recebimento ·{' '}
                          {reportStats.pendingLaunch} pendente(s) de lançamento
                        </span>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Competência (Opcional)
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="month"
                          value={reportCompetence}
                          onChange={(e) => setReportCompetence(e.target.value)}
                          className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                        />
                        {reportCompetence && (
                          <button
                            type="button"
                            onClick={() => setReportCompetence('')}
                            className="text-xs text-blue-700 hover:text-blue-900 whitespace-nowrap cursor-pointer"
                          >
                            Todas
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Preview Summary */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700">
                        Documentos Encontrados ({reportStats.count})
                      </span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        Total: {formatBRL(reportStats.totalAmount)}
                      </span>
                    </div>
                    <div className="border border-slate-200 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                      {reportInvoices.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-500">
                          Nenhum documento encontrado para os critérios selecionados.
                        </div>
                      ) : (
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 sticky top-0">
                            <tr>
                              <th className="py-2 px-3 font-medium">Documento</th>
                              <th className="py-2 px-3 font-medium">Emitente</th>
                              <th className="py-2 px-3 font-medium">
                                {reportType === 'lancadas' ? 'Lançamento' : 'Status'}
                              </th>
                              <th className="py-2 px-3 font-medium text-right">Valor</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 tabular-nums">
                            {reportInvoices.map((inv) => (
                              <tr key={inv.id}>
                                <td className="py-2 px-3 font-mono whitespace-nowrap">
                                  {DOC_TYPE_LABELS[inv.docType || 'NFE']} {inv.nfeNumber}
                                </td>
                                <td className="py-2 px-3 text-slate-700 max-w-[180px] truncate">
                                  {inv.issuerName}
                                </td>
                                <td className="py-2 px-3 whitespace-nowrap text-slate-600">
                                  {reportType === 'lancadas'
                                    ? inv.bookkeepingDate
                                      ? formatDateBR(inv.bookkeepingDate)
                                      : '—'
                                    : inv.fiscalStatus === 'aguardando_recebimento'
                                    ? 'Aguard. Recebimento'
                                    : 'Pendente Lançamento'}
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-medium text-slate-900 whitespace-nowrap">
                                  {formatBRL(inv.totalInvoice)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/70 flex flex-wrap justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setReportModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={reportInvoices.length === 0}
                    onClick={handleDownloadReportPdf}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    Baixar PDF ({reportStats.count})
                  </button>
                  <button
                    type="button"
                    disabled={reportInvoices.length === 0}
                    onClick={() => {
                      setPrintNotice(null);
                      setReportStep('sheet');
                    }}
                    className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    Abrir Folha de Impressão
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="px-6 py-3 border-b border-slate-200 bg-slate-100/80 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setPrintNotice(null);
                      setReportStep('config');
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Voltar aos Filtros
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadReportCsv}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      Exportar CSV
                    </button>
                    <button
                      type="button"
                      onClick={handleBrowserPrint}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Imprimir Página
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadReportPdf}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Baixar PDF (A4)
                    </button>
                  </div>
                </div>

                {printNotice && (
                  <div className="mx-6 mt-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-center justify-between gap-2">
                    <span>{printNotice}</span>
                    <button
                      type="button"
                      onClick={() => setPrintNotice(null)}
                      className="text-blue-700 hover:text-blue-950 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <div className="p-6 overflow-y-auto bg-slate-100/60">
                  <div className="bg-white border border-slate-300 rounded-lg p-6 shadow-xs text-slate-900">
                    <div className="border-b-2 border-slate-900 pb-3 mb-4 flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Controle Fiscal P2P · Relatório Gerencial
                        </div>
                        <h3 className="font-display text-lg font-bold text-slate-900 mt-0.5">
                          {reportType === 'pendentes'
                            ? 'Notas Fiscais Pendentes de Recebimento e Lançamento'
                            : 'Relatório de Notas Fiscais Lançadas'}
                        </h3>
                        <p className="text-xs text-slate-600 mt-1 tabular-nums">
                          {reportType === 'lancadas'
                            ? reportAllLaunchDates
                              ? 'Período de Lançamento: Todas as datas'
                              : `Data de Lançamento: ${reportBookingDate ? formatDateBR(reportBookingDate) : '—'}`
                            : `Escopo: ${reportStats.awaitingReceive} aguardando recebimento · ${reportStats.pendingLaunch} pendente(s) de lançamento`}
                          {reportCompetence ? ` · Competência: ${reportCompetence}` : ''}
                        </p>
                      </div>
                      <div className="text-right text-[11px] text-slate-600 tabular-nums">
                        <div>Emitido em: {formatDateBR(todayISO())}</div>
                        <div>Responsável: {userProfile?.name || 'Setor Fiscal'}</div>
                        <div>UF Empresa: {companyUf}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-xs border border-slate-200 rounded-md p-3 bg-slate-50 tabular-nums">
                      <div>
                        <span className="text-slate-500 block">Total de Documentos</span>
                        <span className="font-mono font-bold text-sm text-slate-900">
                          {reportStats.count}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">
                          {reportType === 'pendentes' ? 'Recebimento / Lançamento' : 'Critério'}
                        </span>
                        <span className="font-semibold text-slate-900">
                          {reportType === 'pendentes'
                            ? `${reportStats.awaitingReceive} Receb. · ${reportStats.pendingLaunch} Lanç.`
                            : reportAllLaunchDates
                            ? 'Todas as datas'
                            : formatDateBR(reportBookingDate)}
                        </span>
                      </div>
                      <div className="sm:text-right">
                        <span className="text-slate-500 block">Valor Total Consolidado</span>
                        <span className="font-mono font-bold text-sm text-slate-900">
                          {formatBRL(reportStats.totalAmount)}
                        </span>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-y border-slate-300 bg-slate-100 text-slate-700 font-semibold">
                            <th className="py-2 px-2.5">Documento</th>
                            <th className="py-2 px-2.5">Emissão</th>
                            <th className="py-2 px-2.5">Emitente / CNPJ</th>
                            <th className="py-2 px-2.5">UF</th>
                            <th className="py-2 px-2.5">Pedido / Receb.</th>
                            <th className="py-2 px-2.5">
                              {reportType === 'lancadas' ? 'Data Lanç.' : 'Status'}
                            </th>
                            <th className="py-2 px-2.5 text-right">Valor Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 tabular-nums">
                          {reportInvoices.map((inv) => {
                            const effectiveUf = getEffectiveIssuerUf(inv);
                            return (
                              <tr key={inv.id}>
                                <td className="py-2 px-2.5 font-mono font-medium whitespace-nowrap">
                                  {DOC_TYPE_LABELS[inv.docType || 'NFE']} {inv.nfeNumber}
                                  {inv.docType !== 'NFSE' ? ` S${inv.series}` : ''}
                                </td>
                                <td className="py-2 px-2.5 font-mono whitespace-nowrap">
                                  {formatDateBR(inv.issueDate)}
                                </td>
                                <td className="py-2 px-2.5">
                                  <div className="font-medium text-slate-900">{inv.issuerName}</div>
                                  <div className="font-mono text-[11px] text-slate-500">
                                    {inv.issuerCnpj}
                                  </div>
                                </td>
                                <td className="py-2 px-2.5 font-mono whitespace-nowrap">
                                  {effectiveUf || '—'}
                                </td>
                                <td className="py-2 px-2.5 font-mono whitespace-nowrap">
                                  {inv.poNumber || '—'}
                                  {inv.receiptNumber ? ` / ${inv.receiptNumber}` : ''}
                                </td>
                                <td className="py-2 px-2.5 whitespace-nowrap">
                                  {reportType === 'lancadas' ? (
                                    <span className="font-mono">
                                      {inv.bookkeepingDate
                                        ? formatDateBR(inv.bookkeepingDate)
                                        : '—'}
                                    </span>
                                  ) : inv.fiscalStatus === 'aguardando_recebimento' ? (
                                    'Aguard. Recebimento'
                                  ) : (
                                    'Pendente Lançamento'
                                  )}
                                </td>
                                <td className="py-2 px-2.5 text-right font-mono font-semibold whitespace-nowrap">
                                  {formatBRL(inv.totalInvoice)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-900 font-semibold bg-slate-50 tabular-nums">
                            <td colSpan={6} className="py-2.5 px-2.5 text-right">
                              Total Geral ({reportStats.count} documento(s)):
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono">
                              {formatBRL(reportStats.totalAmount)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <DeleteAuthModal
        isOpen={Boolean(deleteTarget)}
        title="Excluir Documento Fiscal"
        description={
          deleteTarget ? (
            <>
              Confirma a exclusão definitiva do documento{' '}
              <span className="font-mono font-semibold text-slate-900">
                {DOC_TYPE_LABELS[deleteTarget.docType || 'NFE']} {deleteTarget.nfeNumber}
              </span>{' '}
              ({deleteTarget.issuerName})?
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

      <FiscalEquivalencesModal
        open={equivalencesModalOpen}
        onClose={() => setEquivalencesModalOpen(false)}
      />
      </div>

      {/* Print-Only Fiscal Report Sheet */}
      <div id="fiscal-print-report" className="hidden print:block text-slate-900 bg-white">
        <div className="border-b-2 border-slate-900 pb-3 mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Controle Fiscal P2P · Relatório Gerencial
            </div>
            <h1 className="font-display text-xl font-bold text-slate-900 mt-0.5">
              {reportType === 'pendentes'
                ? 'Notas Fiscais Pendentes de Recebimento e Lançamento'
                : 'Relatório de Notas Fiscais Lançadas'}
            </h1>
            <p className="text-xs text-slate-600 mt-1 tabular-nums">
              {reportType === 'lancadas'
                ? reportAllLaunchDates
                  ? 'Período de Lançamento: Todas as datas'
                  : `Data de Lançamento: ${reportBookingDate ? formatDateBR(reportBookingDate) : '—'}`
                : `Escopo: ${reportStats.awaitingReceive} aguardando recebimento · ${reportStats.pendingLaunch} pendente(s) de lançamento`}
              {reportCompetence ? ` · Competência: ${reportCompetence}` : ''}
            </p>
          </div>
          <div className="text-right text-[11px] text-slate-600 tabular-nums">
            <div>Emitido em: {formatDateBR(todayISO())}</div>
            <div>Responsável: {userProfile?.name || 'Setor Fiscal'}</div>
            <div>UF Empresa: {companyUf}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4 text-xs border border-slate-300 rounded-md p-3 bg-slate-50 tabular-nums">
          <div>
            <span className="text-slate-500 block">Total de Documentos</span>
            <span className="font-mono font-bold text-sm text-slate-900">
              {reportStats.count}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">
              {reportType === 'pendentes' ? 'Recebimento / Lançamento' : 'Critério'}
            </span>
            <span className="font-semibold text-slate-900">
              {reportType === 'pendentes'
                ? `${reportStats.awaitingReceive} Receb. · ${reportStats.pendingLaunch} Lanç.`
                : reportAllLaunchDates
                ? 'Todas as datas'
                : formatDateBR(reportBookingDate)}
            </span>
          </div>
          <div className="text-right">
            <span className="text-slate-500 block">Valor Total Consolidado</span>
            <span className="font-mono font-bold text-sm text-slate-900">
              {formatBRL(reportStats.totalAmount)}
            </span>
          </div>
        </div>

        <table className="w-full text-left border-collapse text-[11px]">
          <thead>
            <tr className="border-y border-slate-400 bg-slate-100 text-slate-700 font-semibold">
              <th className="py-2 px-2">Documento</th>
              <th className="py-2 px-2">Emissão</th>
              <th className="py-2 px-2">Emitente / CNPJ</th>
              <th className="py-2 px-2">UF</th>
              <th className="py-2 px-2">Pedido / Receb.</th>
              <th className="py-2 px-2">
                {reportType === 'lancadas' ? 'Data Lanç.' : 'Status'}
              </th>
              <th className="py-2 px-2 text-right">Valor Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 tabular-nums">
            {reportInvoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-500">
                  Nenhum documento encontrado para este relatório.
                </td>
              </tr>
            ) : (
              reportInvoices.map((inv) => {
                const effectiveUf = getEffectiveIssuerUf(inv);
                return (
                  <tr key={inv.id}>
                    <td className="py-1.5 px-2 font-mono font-medium whitespace-nowrap">
                      {DOC_TYPE_LABELS[inv.docType || 'NFE']} {inv.nfeNumber}
                      {inv.docType !== 'NFSE' ? ` S${inv.series}` : ''}
                    </td>
                    <td className="py-1.5 px-2 font-mono whitespace-nowrap">
                      {formatDateBR(inv.issueDate)}
                    </td>
                    <td className="py-1.5 px-2">
                      <div className="font-medium text-slate-900">{inv.issuerName}</div>
                      <div className="font-mono text-[10px] text-slate-500">
                        {inv.issuerCnpj}
                      </div>
                    </td>
                    <td className="py-1.5 px-2 font-mono whitespace-nowrap">
                      {effectiveUf || '—'}
                    </td>
                    <td className="py-1.5 px-2 font-mono whitespace-nowrap">
                      {inv.poNumber || '—'}
                      {inv.receiptNumber ? ` / ${inv.receiptNumber}` : ''}
                    </td>
                    <td className="py-1.5 px-2 whitespace-nowrap">
                      {reportType === 'lancadas' ? (
                        <span className="font-mono">
                          {inv.bookkeepingDate ? formatDateBR(inv.bookkeepingDate) : '—'}
                        </span>
                      ) : inv.fiscalStatus === 'aguardando_recebimento' ? (
                        'Aguard. Recebimento'
                      ) : (
                        'Pendente Lançamento'
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono font-semibold whitespace-nowrap">
                      {formatBRL(inv.totalInvoice)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-900 font-semibold bg-slate-50 tabular-nums">
              <td colSpan={6} className="py-2 px-2 text-right">
                Total Geral ({reportStats.count} documento(s)):
              </td>
              <td className="py-2 px-2 text-right font-mono">
                {formatBRL(reportStats.totalAmount)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

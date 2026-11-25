import {
  FiscalDocType,
  FiscalInvoiceItem,
  FiscalItemAssociation,
  ItemMatchOrigin,
  ProductEquivalence,
  PurchaseOrderItem,
} from '../types/p2p';
import { normalizeCnpjDigits } from './formatters';

const UNIT_ALIASES: Record<string, string> = {
  un: 'UN',
  und: 'UN',
  unid: 'UN',
  unidade: 'UN',
  unidades: 'UN',
  pc: 'PC',
  pcs: 'PC',
  peca: 'PC',
  pecas: 'PC',
  cx: 'CX',
  cxa: 'CX',
  caixa: 'CX',
  caixas: 'CX',
  pct: 'PCT',
  pacote: 'PCT',
  pacotes: 'PCT',
  kg: 'KG',
  kgs: 'KG',
  quilo: 'KG',
  quilos: 'KG',
  g: 'G',
  gr: 'G',
  grama: 'G',
  gramas: 'G',
  l: 'L',
  lt: 'L',
  litro: 'L',
  litros: 'L',
  ml: 'ML',
  m: 'M',
  mt: 'M',
  mts: 'M',
  metro: 'M',
  metros: 'M',
  mm: 'MM',
  cm: 'CM',
  rl: 'RL',
  rolo: 'RL',
  rolos: 'RL',
  par: 'PAR',
  pares: 'PAR',
  jg: 'JG',
  jogo: 'JG',
  jogos: 'JG',
  kit: 'KIT',
  kits: 'KIT',
  sv: 'SV',
  serv: 'SV',
  servico: 'SV',
  servicos: 'SV',
  fd: 'FD',
  fardo: 'FD',
  sc: 'SC',
  saco: 'SC',
  gl: 'GL',
  galao: 'GL',
  bd: 'BD',
  balde: 'BD',
  tb: 'TB',
  tubo: 'TB',
  fr: 'FR',
  frasco: 'FR',
};

const WORD_SYNONYMS: Record<string, string> = {
  cx: 'caixa',
  cxa: 'caixa',
  pc: 'peca',
  pcs: 'peca',
  un: 'unidade',
  und: 'unidade',
  unid: 'unidade',
  pct: 'pacote',
  lt: 'litro',
  mt: 'metro',
  mts: 'metro',
  rl: 'rolo',
  jg: 'jogo',
  serv: 'servico',
  ind: 'industrial',
  galv: 'galvanizado',
  inox: 'inoxidavel',
  sext: 'sextavado',
  carb: 'carbono',
  pvc: 'pvc',
};

export function normalizeUnitCode(unit: string): string {
  const clean = (unit || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!clean) return 'UN';
  return UNIT_ALIASES[clean] || clean.toUpperCase();
}

export function normalizeProductText(value: string): string {
  const base = (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/c\//g, ' com ')
    .replace(/p\//g, ' para ')
    .replace(/[()[\]{};:|,]+/g, ' ')
    .replace(/(^|\s)[-–—_]+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!base) return '';

  return base
    .split(' ')
    .map((tok) => {
      const stripped = tok.replace(/^\.+|\.+$/g, '');
      return WORD_SYNONYMS[stripped] || stripped;
    })
    .filter(Boolean)
    .join(' ');
}

export function isGenericProductCode(code: string): boolean {
  const c = normalizeProductText(code);
  return !c || /^(item|mat|prod|serv|cte)[-\s_]*\d+$/.test(c);
}

/**
 * Extrai especificações técnicas numéricas (ex: 10mm, 12mm, 220v, m12, 1020, 3/4, 500ml)
 * para garantir que medidas/capacidades/modelos divergentes não gerem match automático incorreto.
 */
export function extractTechnicalSpecs(value: string): string[] {
  const norm = normalizeProductText(value);
  const tokens = norm.split(' ');
  const specs = new Set<string>();
  tokens.forEach((tok) => {
    const clean = tok.replace(/[^a-z0-9./x]/g, '');
    if (/\d/.test(clean) && clean.length >= 2) {
      specs.add(clean);
    }
  });
  return Array.from(specs);
}

function hasTechnicalSpecConflict(a: string, b: string): boolean {
  const specsA = extractTechnicalSpecs(a);
  const specsB = extractTechnicalSpecs(b);
  if (specsA.length === 0 || specsB.length === 0) return false;
  // If both items contain technical measurements/models and share zero technical tokens,
  // e.g. "Parafuso 10mm" vs "Parafuso 12mm" or "Motor 220v" vs "Motor 110v", consider conflict!
  const setB = new Set(specsB);
  const overlap = specsA.some((s) => setB.has(s));
  return !overlap;
}

function tokenSimilarity(a: string, b: string): number {
  const stopWords = new Set(['de', 'da', 'do', 'das', 'dos', 'para', 'com', 'em', 'e', 'a', 'o']);
  const tokensA = new Set(
    normalizeProductText(a)
      .split(' ')
      .filter((t) => t.length >= 2 && !stopWords.has(t))
  );
  const tokensB = new Set(
    normalizeProductText(b)
      .split(' ')
      .filter((t) => t.length >= 2 && !stopWords.has(t))
  );
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let hits = 0;
  tokensA.forEach((t) => {
    if (tokensB.has(t)) hits += 1;
  });
  const unionSize = new Set([...tokensA, ...tokensB]).size;
  return unionSize > 0 ? hits / unionSize : 0;
}

export interface ItemMatchSuggestion {
  invoiceItemIndex: number;
  poItemIndex: number;
  score: number;
  reason: string;
  origin: ItemMatchOrigin;
  suggestedConversionFactor: number;
  equivalenceId?: string;
}

export interface DeterministicItemMatchResult {
  associations: FiscalItemAssociation[];
  suggestions: ItemMatchSuggestion[];
}

export function isValidGtin(gtin?: string): boolean {
  const digits = (gtin || '').replace(/\D/g, '');
  return (
    digits.length === 8 ||
    digits.length === 12 ||
    digits.length === 13 ||
    digits.length === 14
  );
}

export function findEquivalenceForPair(
  supplierCnpj: string,
  invItem: FiscalInvoiceItem,
  poItem: PurchaseOrderItem,
  equivalences: ProductEquivalence[]
): ProductEquivalence | undefined {
  const cnpjDigits = normalizeCnpjDigits(supplierCnpj);
  if (!cnpjDigits) return undefined;

  const invCode = normalizeProductText(invItem.code);
  const invDesc = normalizeProductText(invItem.description);
  const poCode = normalizeProductText(poItem.code);
  const poDesc = normalizeProductText(poItem.description);

  return equivalences.find((eq) => {
    if (!eq.active) return false;
    if (normalizeCnpjDigits(eq.supplierCnpj) !== cnpjDigits) return false;

    const eqSupCode = normalizeProductText(eq.supplierItemCode);
    const eqSupDesc = normalizeProductText(eq.supplierNormalizedDesc || eq.supplierDescription);
    const eqInternalCode = normalizeProductText(eq.internalCode);
    const eqPoDesc = normalizeProductText(eq.poDescription);

    const supplierMatches =
      (eqSupCode && !isGenericProductCode(eq.supplierItemCode) && eqSupCode === invCode) ||
      (eqSupDesc && eqSupDesc === invDesc);

    if (!supplierMatches) return false;

    const poMatches =
      (eqInternalCode && !isGenericProductCode(eq.internalCode) && eqInternalCode === poCode) ||
      (eqPoDesc && eqPoDesc === poDesc);

    return poMatches;
  });
}

function scoreInvoiceToPoPair(
  docType: FiscalDocType,
  invItem: FiscalInvoiceItem,
  poItem: PurchaseOrderItem,
  supplierCnpj: string,
  equivalences: ProductEquivalence[]
): {
  score: number;
  origin: ItemMatchOrigin;
  reason: string;
  conversionFactor: number;
  equivalenceId?: string;
} {
  // 1. Saved supplier equivalence
  const eq = findEquivalenceForPair(supplierCnpj, invItem, poItem, equivalences);
  if (eq) {
    return {
      score: 0.99,
      origin: 'equivalence',
      reason: `Equivalência salva do fornecedor (${eq.supplierDescription} → ${eq.poDescription})`,
      conversionFactor: eq.conversionFactor > 0 ? eq.conversionFactor : 1,
      equivalenceId: eq.id,
    };
  }

  // 2. GTIN/EAN exact match
  if (isValidGtin(invItem.gtin) && isValidGtin((poItem as { gtin?: string }).gtin)) {
    const invGtin = invItem.gtin!.replace(/\D/g, '');
    const poGtin = (poItem as { gtin?: string }).gtin!.replace(/\D/g, '');
    if (invGtin === poGtin) {
      return {
        score: 0.97,
        origin: 'smart',
        reason: `GTIN/EAN idêntico (${invGtin})`,
        conversionFactor: 1,
      };
    }
  }

  const invCode = normalizeProductText(invItem.code);
  const poCode = normalizeProductText(poItem.code);
  const invDesc = normalizeProductText(invItem.description);
  const poDesc = normalizeProductText(poItem.description);
  const specConflict = hasTechnicalSpecConflict(invItem.description, poItem.description);

  // 3. Exact non-generic code match (without conflicting technical spec)
  if (
    invCode &&
    poCode &&
    !isGenericProductCode(invItem.code) &&
    !isGenericProductCode(poItem.code) &&
    invCode === poCode &&
    !specConflict
  ) {
    return {
      score: 0.96,
      origin: 'smart',
      reason: `Código exato (${invItem.code})`,
      conversionFactor: 1,
    };
  }

  // 4. Exact normalized description match
  if (invDesc && poDesc && invDesc === poDesc) {
    return {
      score: 0.95,
      origin: 'smart',
      reason: 'Descrição normalizada idêntica',
      conversionFactor: 1,
    };
  }

  if (specConflict) {
    // Hard penalty when technical specs explicitly conflict (e.g., 10mm vs 12mm)
    return {
      score: 0.25,
      origin: 'smart',
      reason: 'Divergência de especificação técnica/dimensional',
      conversionFactor: 1,
    };
  }

  // 5. Containment / normalized description token similarity
  const sim = tokenSimilarity(invItem.description, poItem.description);
  const unitCompatible =
    normalizeUnitCode(invItem.unit) === normalizeUnitCode(poItem.unit);
  const isContainment =
    Boolean(invDesc && poDesc && (invDesc.includes(poDesc) || poDesc.includes(invDesc)));

  let score = isContainment ? Math.max(sim, 0.78) : sim;
  if (unitCompatible && score >= 0.45) {
    score = Math.min(0.92, score + 0.06);
  }
  if (
    Number(poItem.unitPrice || 0) > 0 &&
    Math.abs(Number(invItem.unitPrice || 0) - Number(poItem.unitPrice || 0)) <= 0.01 &&
    score >= 0.55
  ) {
    // Only acts as mild corroboration when description already matches, NEVER alone!
    score = Math.min(0.93, score + 0.04);
  }

  // For single-line service/freight documents (NFSE/CTE) with moderate similarity
  if ((docType === 'NFSE' || docType === 'CTE') && score >= 0.35) {
    score = Math.max(score, 0.75);
  }

  return {
    score,
    origin: 'smart',
    reason:
      score >= 0.8
        ? 'Alta similaridade de descrição e unidade'
        : 'Similaridade parcial — confirmar vínculo manualmente',
    conversionFactor: 1,
  };
}

/**
 * Executa conciliação determinística de itens preservando vínculos manuais confirmados,
 * aplicando equivalências salvas e sugerindo associações duvidosas sem sobrescrever decisões manuais.
 */
export function buildDeterministicItemAssociations(params: {
  docType: FiscalDocType;
  supplierCnpj: string;
  invoiceItems: FiscalInvoiceItem[];
  poItems: PurchaseOrderItem[];
  savedEquivalences?: ProductEquivalence[];
  existingAssociations?: FiscalItemAssociation[];
}): DeterministicItemMatchResult {
  const {
    docType,
    supplierCnpj,
    invoiceItems,
    poItems,
    savedEquivalences = [],
    existingAssociations = [],
  } = params;

  const usedInv = new Set<number>();
  const usedPo = new Set<number>();
  const keptAssociations: FiscalItemAssociation[] = [];

  // 1. Preserve manual (and user-confirmed) associations whose indexes are valid and disjoint
  existingAssociations.forEach((assoc) => {
    if (assoc.origin !== 'manual' && !assoc.confirmedByUid) return;
    const validInv = assoc.invoiceItemIndexes.filter(
      (i) => Number.isInteger(i) && i >= 0 && i < invoiceItems.length && !usedInv.has(i)
    );
    const validPo = assoc.poItemIndexes.filter(
      (i) => Number.isInteger(i) && i >= 0 && i < poItems.length && !usedPo.has(i)
    );
    if (validInv.length === 0 || validPo.length === 0) return;
    if (
      validInv.length !== assoc.invoiceItemIndexes.length ||
      validPo.length !== assoc.poItemIndexes.length
    ) {
      return;
    }
    validInv.forEach((i) => usedInv.add(i));
    validPo.forEach((i) => usedPo.add(i));
    keptAssociations.push({
      ...assoc,
      conversionFactor: assoc.conversionFactor > 0 ? assoc.conversionFactor : 1,
    });
  });

  // 2. Evaluate all remaining (invIdx, poIdx) candidates
  type Candidate = {
    invIdx: number;
    poIdx: number;
    score: number;
    origin: ItemMatchOrigin;
    reason: string;
    conversionFactor: number;
    equivalenceId?: string;
  };

  const candidatesByInv = new Map<number, Candidate[]>();
  for (let invIdx = 0; invIdx < invoiceItems.length; invIdx++) {
    if (usedInv.has(invIdx)) continue;
    const list: Candidate[] = [];
    for (let poIdx = 0; poIdx < poItems.length; poIdx++) {
      if (usedPo.has(poIdx)) continue;
      const scored = scoreInvoiceToPoPair(
        docType,
        invoiceItems[invIdx],
        poItems[poIdx],
        supplierCnpj,
        savedEquivalences
      );
      list.push({ invIdx, poIdx, ...scored });
    }
    list.sort((a, b) => b.score - a.score);
    candidatesByInv.set(invIdx, list);
  }

  // Sort invoice items by highest confidence first so unambiguous matches claim their PO item
  const orderedInvIndices = Array.from(candidatesByInv.keys()).sort((a, b) => {
    const topA = candidatesByInv.get(a)?.[0]?.score ?? 0;
    const topB = candidatesByInv.get(b)?.[0]?.score ?? 0;
    return topB - topA;
  });

  const suggestions: ItemMatchSuggestion[] = [];

  for (const invIdx of orderedInvIndices) {
    const cands = (candidatesByInv.get(invIdx) || []).filter((c) => !usedPo.has(c.poIdx));
    if (cands.length === 0) continue;

    const best = cands[0];
    const second = cands[1];
    const margin = second ? best.score - second.score : 1;

    // Auto-associate ONLY if high confidence AND unambiguous (or saved equivalence / single NFSE-CTE service line)
    const isSingleServiceDoc =
      (docType === 'NFSE' || docType === 'CTE') &&
      invoiceItems.length === 1 &&
      poItems.length === 1 &&
      best.score >= 0.72;

    if (
      best.origin === 'equivalence' ||
      (best.score >= 0.82 && margin >= 0.08) ||
      isSingleServiceDoc
    ) {
      usedInv.add(best.invIdx);
      usedPo.add(best.poIdx);
      keptAssociations.push({
        id: `assoc_${best.invIdx}_${best.poIdx}`,
        invoiceItemIndexes: [best.invIdx],
        poItemIndexes: [best.poIdx],
        conversionFactor: best.conversionFactor,
        origin: best.origin,
        confidence: Number(best.score.toFixed(2)),
        equivalenceId: best.equivalenceId,
      });
    } else if (best.score >= 0.42) {
      suggestions.push({
        invoiceItemIndex: best.invIdx,
        poItemIndex: best.poIdx,
        score: Number(best.score.toFixed(2)),
        reason: best.reason,
        origin: best.origin,
        suggestedConversionFactor: best.conversionFactor,
        equivalenceId: best.equivalenceId,
      });
    }
  }

  return {
    associations: keptAssociations,
    suggestions,
  };
}

/**
 * Calcula a quantidade efetiva em unidade do Pedido e valor unitário efetivo para uma associação (1:1, 1:N, N:1, com conversão).
 */
export function computeAssociationMetrics(params: {
  assoc: FiscalItemAssociation;
  invoiceItems: FiscalInvoiceItem[];
  poItems: PurchaseOrderItem[];
}): {
  poQtyTotal: number;
  poExpectedTotal: number;
  poUnitPriceEffective: number;
  invoiceQtyConverted: number;
  invoiceRawQtySum: number;
  invoiceTotal: number;
  invoiceUnitPriceEffective: number;
  qtyMatch: boolean;
  unitPriceMatch: boolean;
} {
  const { assoc, invoiceItems, poItems } = params;
  const factor = assoc.conversionFactor > 0 ? assoc.conversionFactor : 1;
  const selectedInv = assoc.invoiceItemIndexes
    .map((i) => invoiceItems[i])
    .filter(Boolean);
  const selectedPo = assoc.poItemIndexes.map((i) => poItems[i]).filter(Boolean);

  const invoiceTotal = selectedInv.reduce((s, it) => s + Number(it.totalPrice || 0), 0);
  const invoiceRawQtySum = selectedInv.reduce((s, it) => s + Number(it.qty || 0), 0);

  const poExpectedTotal = selectedPo.reduce(
    (s, p) => s + Number(p.qtyOrdered || 0) * Number(p.unitPrice || 0),
    0
  );

  // 1 PO item <-> N NF items (kit composition vs split same-item)
  if (selectedPo.length === 1 && selectedInv.length > 1) {
    const poItem = selectedPo[0];
    const poQtyTotal = Number(poItem.qtyOrdered || 0);
    const poUnitPriceEffective = Number(poItem.unitPrice || 0);
    const firstQty = Number(selectedInv[0].qty || 0);
    const allEqualQty = selectedInv.every((it) => Math.abs(Number(it.qty || 0) - firstQty) <= 0.001);

    const sumQtyConverted = invoiceRawQtySum * factor;
    const kitQtyConverted = firstQty * factor;
    const sumUnitPrice = sumQtyConverted > 0 ? invoiceTotal / sumQtyConverted : 0;
    const kitUnitPrice = kitQtyConverted > 0 ? invoiceTotal / kitQtyConverted : 0;

    // Kit composition (e.g. Cavadeira 5 + Cabo 5 = 5 Ferro de Cova c/ Cabo) when equal component quantities align closer to PO item
    const useKitMode =
      allEqualQty &&
      (Math.abs(kitQtyConverted - poQtyTotal) < Math.abs(sumQtyConverted - poQtyTotal) ||
        Math.abs(kitUnitPrice - poUnitPriceEffective) <=
          Math.abs(sumUnitPrice - poUnitPriceEffective));

    const invoiceQtyConverted = useKitMode ? kitQtyConverted : sumQtyConverted;
    const invoiceUnitPriceEffective =
      invoiceQtyConverted > 0 ? invoiceTotal / invoiceQtyConverted : 0;

    return {
      poQtyTotal,
      poExpectedTotal,
      poUnitPriceEffective,
      invoiceQtyConverted: Number(invoiceQtyConverted.toFixed(4)),
      invoiceRawQtySum: Number(invoiceRawQtySum.toFixed(4)),
      invoiceTotal: Number(invoiceTotal.toFixed(2)),
      invoiceUnitPriceEffective: Number(invoiceUnitPriceEffective.toFixed(4)),
      qtyMatch: Math.abs(poQtyTotal - invoiceQtyConverted) <= 0.001,
      unitPriceMatch:
        Math.round(poUnitPriceEffective * 100) === Math.round(invoiceUnitPriceEffective * 100),
    };
  }

  // N PO items <-> 1 NF item (e.g. PO has Cavadeira + Cabo, NF has 1 kit item)
  if (selectedPo.length > 1 && selectedInv.length === 1) {
    const firstPoQty = Number(selectedPo[0].qtyOrdered || 0);
    const allEqualPoQty = selectedPo.every(
      (p) => Math.abs(Number(p.qtyOrdered || 0) - firstPoQty) <= 0.001
    );
    const poQtySum = selectedPo.reduce((s, p) => s + Number(p.qtyOrdered || 0), 0);
    const poQtyTotal = allEqualPoQty ? firstPoQty : poQtySum;
    const poUnitPriceEffective = poQtyTotal > 0 ? poExpectedTotal / poQtyTotal : 0;
    const invoiceQtyConverted = invoiceRawQtySum * factor;
    const invoiceUnitPriceEffective =
      invoiceQtyConverted > 0 ? invoiceTotal / invoiceQtyConverted : 0;

    return {
      poQtyTotal: Number(poQtyTotal.toFixed(4)),
      poExpectedTotal: Number(poExpectedTotal.toFixed(2)),
      poUnitPriceEffective: Number(poUnitPriceEffective.toFixed(4)),
      invoiceQtyConverted: Number(invoiceQtyConverted.toFixed(4)),
      invoiceRawQtySum: Number(invoiceRawQtySum.toFixed(4)),
      invoiceTotal: Number(invoiceTotal.toFixed(2)),
      invoiceUnitPriceEffective: Number(invoiceUnitPriceEffective.toFixed(4)),
      qtyMatch: Math.abs(poQtyTotal - invoiceQtyConverted) <= 0.001,
      unitPriceMatch:
        Math.round(poUnitPriceEffective * 100) === Math.round(invoiceUnitPriceEffective * 100),
    };
  }

  // Standard 1:1 (or N:M general)
  const poQtyTotal = selectedPo.reduce((s, p) => s + Number(p.qtyOrdered || 0), 0);
  const poUnitPriceEffective = poQtyTotal > 0 ? poExpectedTotal / poQtyTotal : 0;
  const invoiceQtyConverted = invoiceRawQtySum * factor;
  const invoiceUnitPriceEffective =
    invoiceQtyConverted > 0 ? invoiceTotal / invoiceQtyConverted : 0;

  return {
    poQtyTotal: Number(poQtyTotal.toFixed(4)),
    poExpectedTotal: Number(poExpectedTotal.toFixed(2)),
    poUnitPriceEffective: Number(poUnitPriceEffective.toFixed(4)),
    invoiceQtyConverted: Number(invoiceQtyConverted.toFixed(4)),
    invoiceRawQtySum: Number(invoiceRawQtySum.toFixed(4)),
    invoiceTotal: Number(invoiceTotal.toFixed(2)),
    invoiceUnitPriceEffective: Number(invoiceUnitPriceEffective.toFixed(4)),
    qtyMatch: Math.abs(poQtyTotal - invoiceQtyConverted) <= 0.001,
    unitPriceMatch:
      Math.round(poUnitPriceEffective * 100) === Math.round(invoiceUnitPriceEffective * 100),
  };
}

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
} from '../lib/firebase';
import {
  AdjustmentDivergentItemSnapshot,
  AdjustmentHistoryEntry,
  AdjustmentRequest,
  AdjustmentRequestStatus,
  BLUEPRINT_LIMITS,
  DeletionLog,
  DeletionPolicy,
  FiscalInvoice,
  FiscalItemAssociation,
  MatchingStatus,
  PhysicalReceipt,
  ProductEquivalence,
  PurchaseOrder,
  ROLE_TO_SECTOR,
  SectorKey,
  SectorPermission,
  UserInvite,
  UserProfile,
  UserRole,
  UserStatus,
} from '../types/p2p';
import { generateRandomHex, hashSupervisorPassword } from '../utils/crypto';
import {
  buildConferenceFingerprint,
  calculateFiscalNetTotal,
  roundMoney,
} from '../utils/fiscalCalculations';
import {
  buildAdjustmentRequestCreatePayload,
  buildFiscalInvoiceCreatePayload,
  sanitizeItemAssociations,
} from '../utils/fiscalPayloads';
import { generateDocId, normalizeCnpjDigits, sanitizeText } from '../utils/formatters';
import { normalizeProductText } from '../utils/itemReconciliation';

export interface BatchFiscalImportEntry {
  invoiceData: Omit<
    FiscalInvoice,
    'id' | 'createdByUid' | 'createdByName' | 'createdAt' | 'updatedAt'
  >;
  adjustmentRequest?: {
    po: PurchaseOrder;
    divergenceReasons: string[];
    divergentItems: AdjustmentDivergentItemSnapshot[];
    poGrossTotal: number;
    poNetTotal: number;
    invoiceGrossTotal: number;
    invoiceNetTotal: number;
    fiscalObservation: string;
  };
}

interface P2PContextValue {
  authReady: boolean;
  firebaseUser: User | null;
  userProfile: UserProfile | null;
  authError: string | null;
  signingIn: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;

  // Data collections
  purchaseOrders: PurchaseOrder[];
  physicalReceipts: PhysicalReceipt[];
  fiscalInvoices: FiscalInvoice[];
  productEquivalences: ProductEquivalence[];
  adjustmentRequests: AdjustmentRequest[];
  allUsers: UserProfile[];
  userInvites: UserInvite[];
  sectorPermissions: Record<SectorKey, SectorPermission>;
  deletionPolicy: DeletionPolicy | null;
  deletionPasswordConfigured: boolean;
  deletionLogs: DeletionLog[];
  dataLoading: boolean;
  dataError: string | null;

  // RBAC permissions helpers
  isAdmin: boolean;
  canAccessSectorData: (targetSector: SectorKey) => boolean;
  canCreateInSector: (targetSector: SectorKey) => boolean;
  canEditInSector: (targetSector: SectorKey) => boolean;
  canDeleteInSector: (targetSector: SectorKey) => boolean;

  // Mutations: Purchase Orders
  createPurchaseOrder: (
    data: Omit<PurchaseOrder, 'id' | 'createdByUid' | 'createdByName' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
  updatePurchaseOrder: (
    id: string,
    data: Partial<Omit<PurchaseOrder, 'id' | 'createdByUid' | 'createdByName' | 'createdAt' | 'updatedAt'>>
  ) => Promise<void>;
  deletePurchaseOrder: (id: string, supervisorPassword?: string) => Promise<void>;

  // Mutations: Physical Receipts
  createPhysicalReceipt: (
    data: Omit<PhysicalReceipt, 'id' | 'receivedByUid' | 'receivedByName' | 'createdAt' | 'updatedAt'>,
    options?: {
      nextPoStatus?: 'aberto' | 'parcialmente_atendido' | 'concluido';
      matchingStatus?: 'pendente_vinculo' | 'conciliada' | 'divergente';
    }
  ) => Promise<void>;
  updatePhysicalReceipt: (
    id: string,
    data: Partial<Omit<PhysicalReceipt, 'id' | 'receivedByUid' | 'receivedByName' | 'createdAt' | 'updatedAt'>>,
    options?: {
      nextPoStatus?: 'aberto' | 'parcialmente_atendido' | 'concluido';
    }
  ) => Promise<void>;
  unlinkPhysicalReceiptFromPo: (id: string) => Promise<void>;
  deletePhysicalReceipt: (id: string, supervisorPassword?: string) => Promise<void>;

  // Mutations: Fiscal Invoices
  createFiscalInvoice: (
    data: Omit<FiscalInvoice, 'id' | 'createdByUid' | 'createdByName' | 'createdAt' | 'updatedAt'>
  ) => Promise<string | undefined>;
  createFiscalInvoicesBatch: (entries: BatchFiscalImportEntry[]) => Promise<string[]>;
  updateFiscalInvoice: (
    id: string,
    data: Partial<Omit<FiscalInvoice, 'id' | 'createdByUid' | 'createdByName' | 'createdAt' | 'updatedAt'>>
  ) => Promise<void>;
  confirmInvoiceConference: (
    invoiceId: string,
    params: {
      originalOutcome: 'sem_divergencia' | 'divergente';
      justification: string;
      dataVersion: string;
      itemAssociations?: FiscalItemAssociation[];
      matchingStatus?: MatchingStatus;
    }
  ) => Promise<void>;
  unlinkFiscalInvoice: (id: string, unlinkPo: boolean, unlinkReceipt: boolean) => Promise<void>;
  deleteFiscalInvoice: (id: string, supervisorPassword?: string) => Promise<void>;

  // Mutations: Product Equivalences
  upsertProductEquivalence: (data: {
    id?: string;
    supplierCnpj: string;
    supplierItemCode: string;
    supplierDescription: string;
    internalCode: string;
    poDescription: string;
    poUnit: string;
    invoiceUnit: string;
    conversionFactor: number;
    active?: boolean;
  }) => Promise<string>;
  toggleProductEquivalence: (id: string, active: boolean) => Promise<void>;
  deleteProductEquivalence: (id: string) => Promise<void>;

  // Mutations: Fiscal <-> Compras Adjustment Requests
  createAdjustmentRequest: (params: {
    fiscalInvoiceId: string;
    invoiceNumber: string;
    docType: FiscalInvoice['docType'];
    supplierName: string;
    supplierCnpj: string;
    po: PurchaseOrder;
    divergenceReasons: string[];
    divergentItems: AdjustmentDivergentItemSnapshot[];
    poGrossTotal: number;
    poNetTotal: number;
    invoiceGrossTotal: number;
    invoiceNetTotal: number;
    fiscalObservation: string;
  }) => Promise<string>;
  respondAdjustmentRequestAsCompras: (
    reqId: string,
    nextStatus: Extract<
      AdjustmentRequestStatus,
      'Em análise' | 'Ajustado' | 'Devolvido para revisão fiscal'
    >,
    responseNote: string
  ) => Promise<void>;
  updateAdjustmentRequestAsFiscal: (
    reqId: string,
    nextStatus: Extract<AdjustmentRequestStatus, 'Reaberto' | 'Resolvido' | 'Cancelado'>,
    note: string,
    options?: {
      divergenceReasons?: string[];
      divergentItems?: AdjustmentDivergentItemSnapshot[];
      poGrossTotal?: number;
      poNetTotal?: number;
      invoiceGrossTotal?: number;
      invoiceNetTotal?: number;
      linkPo?: {
        purchaseOrderId: string;
        poNumber: string;
        matchingStatus: MatchingStatus;
        itemAssociations?: FiscalItemAssociation[];
      };
    }
  ) => Promise<void>;

  // Mutations: Admin (Users, Invites, Sector Permissions, Deletion Password)
  updateUserAccess: (uid: string, role: UserRole, status: UserStatus) => Promise<void>;
  createUserInvite: (name: string, email: string, role: Exclude<UserRole, 'pendente'>) => Promise<void>;
  deleteUserInvite: (inviteId: string) => Promise<void>;
  updateSectorPermission: (
    sector: SectorKey,
    perms: Pick<SectorPermission, 'canCreate' | 'canEdit' | 'canDelete' | 'canViewOtherSectors'>
  ) => Promise<void>;
  setSupervisorDeletionPassword: (newPassword: string) => Promise<void>;
}

const DEFAULT_SECTOR_PERMS: Record<SectorKey, SectorPermission> = {
  compras: {
    sector: 'compras',
    canCreate: true,
    canEdit: true,
    canDelete: true,
    canViewOtherSectors: true,
    updatedByUid: 'system',
  },
  recebimento: {
    sector: 'recebimento',
    canCreate: true,
    canEdit: true,
    canDelete: true,
    canViewOtherSectors: true,
    updatedByUid: 'system',
  },
  fiscal: {
    sector: 'fiscal',
    canCreate: true,
    canEdit: true,
    canDelete: true,
    canViewOtherSectors: true,
    updatedByUid: 'system',
  },
};

const P2PContext = createContext<P2PContextValue | undefined>(undefined);

export function P2PProvider({ children }: { children: React.ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [physicalReceipts, setPhysicalReceipts] = useState<PhysicalReceipt[]>([]);
  const [fiscalInvoices, setFiscalInvoices] = useState<FiscalInvoice[]>([]);
  const [productEquivalences, setProductEquivalences] = useState<ProductEquivalence[]>([]);
  const [adjustmentRequests, setAdjustmentRequests] = useState<AdjustmentRequest[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [userInvites, setUserInvites] = useState<UserInvite[]>([]);
  const [sectorPermissions, setSectorPermissions] =
    useState<Record<SectorKey, SectorPermission>>(DEFAULT_SECTOR_PERMS);
  const [deletionPolicy, setDeletionPolicy] = useState<DeletionPolicy | null>(null);
  const [deletionLogs, setDeletionLogs] = useState<DeletionLog[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const reportListenerError = (error: unknown, path: string) => {
    const rawMsg = error instanceof Error ? error.message : String(error);
    console.error(`Firestore Listener Error (${path}):`, rawMsg);
    setDataError(`Erro ao carregar dados (${path}): ${rawMsg}`);
    setDataLoading(false);
  };

  // Sync or bootstrap user profile on sign-in
  async function ensureUserProfile(user: User): Promise<void> {
    const userRef = doc(db, 'users', user.uid);
    const userEmail = (user.email || '').toLowerCase();
    const displayName = sanitizeText(
      user.displayName || userEmail.split('@')[0] || 'Usuário Corporativo',
      BLUEPRINT_LIMITS.MAX_USER_NAME
    );
    const photoUrl = sanitizeText(user.photoURL || '', 500);

    let existingSnap;
    try {
      existingSnap = await getDoc(userRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    }

    if (existingSnap.exists()) {
      return;
    }

    // Check if bootstrap exists (first user becomes ADM Titular automatically)
    const bootstrapRef = doc(db, 'system_config', 'bootstrap');
    let bootstrapSnap;
    try {
      bootstrapSnap = await getDoc(bootstrapRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'system_config/bootstrap');
    }

    if (!bootstrapSnap.exists()) {
      const batch = writeBatch(db);
      batch.set(bootstrapRef, {
        initialized: true,
        firstAdminUid: user.uid,
        firstAdminEmail: user.email || userEmail,
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, 'admins', user.uid), {
        uid: user.uid,
        email: user.email || userEmail,
        createdAt: serverTimestamp(),
      });
      batch.set(userRef, {
        uid: user.uid,
        name: displayName,
        email: user.email || userEmail,
        photoUrl,
        role: 'adm_titular',
        sector: 'Administração',
        status: 'ativo',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      (['compras', 'recebimento', 'fiscal'] as SectorKey[]).forEach((sec) => {
        batch.set(doc(db, 'sector_permissions', sec), {
          sector: sec,
          canCreate: true,
          canEdit: true,
          canDelete: true,
          canViewOtherSectors: true,
          updatedByUid: user.uid,
          updatedAt: serverTimestamp(),
        });
      });

      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
      }
      return;
    }

    // Check if there is an active pre-registered invite for this email
    let matchedInvite: { id: string; role: Exclude<UserRole, 'pendente'> } | null = null;
    try {
      const inviteQuery = query(
        collection(db, 'user_invites'),
        where('email', '==', userEmail)
      );
      const inviteDocs = await getDocs(inviteQuery);
      if (!inviteDocs.empty) {
        const firstDoc = inviteDocs.docs[0];
        const data = firstDoc.data();
        matchedInvite = {
          id: firstDoc.id,
          role: data.role as Exclude<UserRole, 'pendente'>,
        };
      }
    } catch {
      // No invite or permission denied -> falls back to pendente
    }

    if (matchedInvite) {
      const batch = writeBatch(db);
      batch.set(userRef, {
        uid: user.uid,
        name: displayName,
        email: user.email || userEmail,
        photoUrl,
        role: matchedInvite.role,
        sector: ROLE_TO_SECTOR[matchedInvite.role],
        status: 'ativo',
        inviteId: matchedInvite.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (matchedInvite.role === 'adm_titular') {
        batch.set(doc(db, 'admins', user.uid), {
          uid: user.uid,
          email: user.email || userEmail,
          createdAt: serverTimestamp(),
        });
      }
      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}`);
      }
      return;
    }

    // Fallback for runtime admin owner if bootstrap was already triggered by another test user
    if (userEmail === 'pedrohsouzamuniz@gmail.com') {
      const batch = writeBatch(db);
      batch.set(doc(db, 'admins', user.uid), {
        uid: user.uid,
        email: user.email || userEmail,
        createdAt: serverTimestamp(),
      });
      batch.set(userRef, {
        uid: user.uid,
        name: displayName,
        email: user.email || userEmail,
        photoUrl,
        role: 'adm_titular',
        sector: 'Administração',
        status: 'ativo',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}`);
      }
      return;
    }

    // Standard uninvited new user enters as pendente until ADM Titular assigns their sector
    try {
      await setDoc(userRef, {
        uid: user.uid,
        name: displayName,
        email: user.email || userEmail,
        photoUrl,
        role: 'pendente',
        sector: 'Aguardando Aprovação',
        status: 'pendente',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}`);
    }
  }

  useEffect(() => {
    let unsubProfile: (() => void) | undefined;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = undefined;
      }

      setFirebaseUser(user);
      setAuthError(null);

      if (!user) {
        setUserProfile(null);
        setAuthReady(true);
        return;
      }

      try {
        await ensureUserProfile(user);
        const profilePath = `users/${user.uid}`;
        unsubProfile = onSnapshot(
          doc(db, 'users', user.uid),
          (snapshot) => {
            if (snapshot.exists()) {
              setUserProfile(snapshot.data() as UserProfile);
            } else {
              setUserProfile(null);
            }
            setAuthReady(true);
          },
          (error) => {
            handleFirestoreError(error, OperationType.GET, profilePath);
          }
        );
      } catch (error) {
        setAuthError(
          error instanceof Error ? error.message : 'Erro ao autenticar perfil no banco de dados.'
        );
        setAuthReady(true);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  // Subscribe to sector_permissions when active corporate user is logged in
  useEffect(() => {
    if (!authReady || !firebaseUser || !userProfile || userProfile.status !== 'ativo') {
      return;
    }

    const unsubPerms = onSnapshot(
      collection(db, 'sector_permissions'),
      (snap) => {
        const next: Record<SectorKey, SectorPermission> = { ...DEFAULT_SECTOR_PERMS };
        snap.docs.forEach((d) => {
          const data = d.data() as SectorPermission;
          if (data.sector === 'compras' || data.sector === 'recebimento' || data.sector === 'fiscal') {
            next[data.sector] = data;
          }
        });
        setSectorPermissions(next);
      },
      (error) => {
        reportListenerError(error, 'sector_permissions');
      }
    );

    return () => unsubPerms();
  }, [authReady, firebaseUser, userProfile]);

  const isAdmin = userProfile?.role === 'adm_titular' && userProfile?.status === 'ativo';

  const canAccessSectorData = (targetSector: SectorKey): boolean => {
    if (!userProfile || userProfile.status !== 'ativo') return false;
    if (userProfile.role === 'adm_titular') return true;
    if (userProfile.role === targetSector) return true;
    if (
      userProfile.role === 'compras' ||
      userProfile.role === 'recebimento' ||
      userProfile.role === 'fiscal'
    ) {
      return sectorPermissions[userProfile.role]?.canViewOtherSectors ?? true;
    }
    return false;
  };

  const canCreateInSector = (targetSector: SectorKey): boolean => {
    if (!userProfile || userProfile.status !== 'ativo') return false;
    if (userProfile.role === 'adm_titular') return true;
    if (userProfile.role !== targetSector) return false;
    return sectorPermissions[targetSector]?.canCreate ?? true;
  };

  const canEditInSector = (targetSector: SectorKey): boolean => {
    if (!userProfile || userProfile.status !== 'ativo') return false;
    if (userProfile.role === 'adm_titular') return true;
    if (userProfile.role !== targetSector) return false;
    return sectorPermissions[targetSector]?.canEdit ?? true;
  };

  const canDeleteInSector = (targetSector: SectorKey): boolean => {
    if (!userProfile || userProfile.status !== 'ativo') return false;
    if (userProfile.role === 'adm_titular') return true;
    if (userProfile.role !== targetSector) return false;
    return sectorPermissions[targetSector]?.canDelete ?? true;
  };

  // Subscribe to P2P data collections respecting RBAC & cross-sector visibility
  useEffect(() => {
    if (
      !authReady ||
      !firebaseUser ||
      !userProfile ||
      userProfile.status !== 'ativo' ||
      userProfile.role === 'pendente'
    ) {
      setPurchaseOrders([]);
      setPhysicalReceipts([]);
      setFiscalInvoices([]);
      setProductEquivalences([]);
      setAdjustmentRequests([]);
      setAllUsers([]);
      setUserInvites([]);
      return;
    }

    setDataLoading(true);
    setDataError(null);
    const unsubs: Array<() => void> = [];

    const allowPo = canAccessSectorData('compras');
    const allowRec = canAccessSectorData('recebimento');
    const allowFis = canAccessSectorData('fiscal');

    if (allowPo) {
      const qPo = query(collection(db, 'purchase_orders'), orderBy('createdAt', 'desc'));
      unsubs.push(
        onSnapshot(
          qPo,
          (snap) => {
            setDataError(null);
            setPurchaseOrders(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PurchaseOrder, 'id'>) }))
            );
            setDataLoading(false);
          },
          (error) => reportListenerError(error, 'purchase_orders')
        )
      );
    } else {
      setPurchaseOrders([]);
    }

    if (allowRec) {
      const qRec = query(collection(db, 'physical_receipts'), orderBy('createdAt', 'desc'));
      unsubs.push(
        onSnapshot(
          qRec,
          (snap) => {
            setDataError(null);
            setPhysicalReceipts(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PhysicalReceipt, 'id'>) }))
            );
          },
          (error) => reportListenerError(error, 'physical_receipts')
        )
      );
    } else {
      setPhysicalReceipts([]);
    }

    if (allowFis) {
      const qFis = query(collection(db, 'fiscal_invoices'), orderBy('createdAt', 'desc'));
      unsubs.push(
        onSnapshot(
          qFis,
          (snap) => {
            setDataError(null);
            setFiscalInvoices(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FiscalInvoice, 'id'>) }))
            );
          },
          (error) => reportListenerError(error, 'fiscal_invoices')
        )
      );
    } else {
      setFiscalInvoices([]);
    }

    unsubs.push(
      onSnapshot(
        doc(db, 'system_config', 'deletion_policy'),
        (snap) => {
          setDeletionPolicy(snap.exists() ? (snap.data() as DeletionPolicy) : null);
        },
        (error) => reportListenerError(error, 'system_config/deletion_policy')
      )
    );

    if (allowFis || allowPo) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'product_equivalences'), orderBy('updatedAt', 'desc')),
          (snap) => {
            setProductEquivalences(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<ProductEquivalence, 'id'>),
              }))
            );
          },
          (error) => reportListenerError(error, 'product_equivalences')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'adjustment_requests'), orderBy('updatedAt', 'desc')),
          (snap) => {
            setAdjustmentRequests(
              snap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as Omit<AdjustmentRequest, 'id'>),
              }))
            );
          },
          (error) => reportListenerError(error, 'adjustment_requests')
        )
      );
    } else {
      setProductEquivalences([]);
      setAdjustmentRequests([]);
    }

    if (userProfile.role === 'adm_titular') {
      unsubs.push(
        onSnapshot(
          collection(db, 'users'),
          (snap) => {
            setAllUsers(snap.docs.map((d) => d.data() as UserProfile));
          },
          (error) => reportListenerError(error, 'users')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'user_invites'), orderBy('createdAt', 'desc')),
          (snap) => {
            setUserInvites(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<UserInvite, 'id'>) }))
            );
          },
          (error) => reportListenerError(error, 'user_invites')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'deletion_logs'), orderBy('createdAt', 'desc')),
          (snap) => {
            setDeletionLogs(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DeletionLog, 'id'>) }))
            );
          },
          (error) => reportListenerError(error, 'deletion_logs')
        )
      );
    } else {
      setAllUsers([]);
      setUserInvites([]);
      setDeletionLogs([]);
    }

    const timer = setTimeout(() => setDataLoading(false), 600);
    return () => {
      clearTimeout(timer);
      unsubs.forEach((u) => u());
    };
  }, [authReady, firebaseUser, userProfile, sectorPermissions]);

  const signInWithGoogle = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Falha ao iniciar sessão com Google.';
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError(msg);
      }
    } finally {
      setSigningIn(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  // ---------------------------------------------------------------------------
  // Purchase Orders Mutations
  // ---------------------------------------------------------------------------
  const createPurchaseOrder: P2PContextValue['createPurchaseOrder'] = async (data) => {
    if (!firebaseUser || !userProfile) return;
    const id = generateDocId('po');
    const path = `purchase_orders/${id}`;
    const normalizedItems = data.items.slice(0, BLUEPRINT_LIMITS.MAX_ITEMS).map((it) => ({
      code: sanitizeText(it.code, 40),
      description: sanitizeText(it.description, BLUEPRINT_LIMITS.MAX_ITEM_DESC),
      unit: sanitizeText(it.unit, 12),
      qtyOrdered: Number(it.qtyOrdered),
      unitPrice: Number(it.unitPrice),
      totalPrice: Number((Number(it.qtyOrdered) * Number(it.unitPrice)).toFixed(2)),
    }));
    const itemsSubtotal = normalizedItems.reduce((s, it) => s + it.totalPrice, 0);
    const freightAmount = Math.max(0, Number(data.freightAmount || 0));
    const discountAmount = Math.max(0, Number(data.discountAmount || 0));
    const totalAmount = Math.max(0, Number((itemsSubtotal + freightAmount - discountAmount).toFixed(2)));

    const payload = {
      poNumber: sanitizeText(data.poNumber, BLUEPRINT_LIMITS.MAX_PO_NUMBER),
      supplierName: sanitizeText(data.supplierName, BLUEPRINT_LIMITS.MAX_SUPPLIER_NAME),
      supplierCnpj: sanitizeText(data.supplierCnpj, BLUEPRINT_LIMITS.MAX_CNPJ),
      costCenter: sanitizeText(data.costCenter, BLUEPRINT_LIMITS.MAX_COST_CENTER),
      issueDate: data.issueDate,
      expectedDeliveryDate: data.expectedDeliveryDate,
      paymentTerms: sanitizeText(data.paymentTerms, BLUEPRINT_LIMITS.MAX_PAYMENT_TERMS),
      items: normalizedItems,
      freightAmount: Number(freightAmount.toFixed(2)),
      discountAmount: Number(discountAmount.toFixed(2)),
      totalAmount,
      status: data.status,
      notes: sanitizeText(data.notes || '', BLUEPRINT_LIMITS.MAX_NOTES),
      createdByUid: firebaseUser.uid,
      createdByName:
        sanitizeText(userProfile.name, BLUEPRINT_LIMITS.MAX_USER_NAME) || 'Usuário Corporativo',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    try {
      await setDoc(doc(db, 'purchase_orders', id), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const updatePurchaseOrder: P2PContextValue['updatePurchaseOrder'] = async (id, data) => {
    const path = `purchase_orders/${id}`;
    const existing = purchaseOrders.find((p) => p.id === id);
    if (!existing) return;
    const items = (data.items || existing.items).slice(0, BLUEPRINT_LIMITS.MAX_ITEMS).map((it) => ({
      code: sanitizeText(it.code, 40),
      description: sanitizeText(it.description, BLUEPRINT_LIMITS.MAX_ITEM_DESC),
      unit: sanitizeText(it.unit, 12),
      qtyOrdered: Number(it.qtyOrdered),
      unitPrice: Number(it.unitPrice),
      totalPrice: Number((Number(it.qtyOrdered) * Number(it.unitPrice)).toFixed(2)),
    }));
    const itemsSubtotal = items.reduce((s, it) => s + it.totalPrice, 0);
    const freightAmount = Math.max(0, Number(data.freightAmount ?? existing.freightAmount ?? 0));
    const discountAmount = Math.max(0, Number(data.discountAmount ?? existing.discountAmount ?? 0));
    const totalAmount = Math.max(0, Number((itemsSubtotal + freightAmount - discountAmount).toFixed(2)));
    const payload = {
      poNumber: sanitizeText(data.poNumber ?? existing.poNumber, BLUEPRINT_LIMITS.MAX_PO_NUMBER),
      supplierName: sanitizeText(data.supplierName ?? existing.supplierName, BLUEPRINT_LIMITS.MAX_SUPPLIER_NAME),
      supplierCnpj: sanitizeText(data.supplierCnpj ?? existing.supplierCnpj, BLUEPRINT_LIMITS.MAX_CNPJ),
      costCenter: sanitizeText(data.costCenter ?? existing.costCenter, BLUEPRINT_LIMITS.MAX_COST_CENTER),
      issueDate: data.issueDate ?? existing.issueDate,
      expectedDeliveryDate: data.expectedDeliveryDate ?? existing.expectedDeliveryDate,
      paymentTerms: sanitizeText(data.paymentTerms ?? existing.paymentTerms, BLUEPRINT_LIMITS.MAX_PAYMENT_TERMS),
      items,
      freightAmount: Number(freightAmount.toFixed(2)),
      discountAmount: Number(discountAmount.toFixed(2)),
      totalAmount,
      status: data.status ?? existing.status,
      notes: sanitizeText(data.notes ?? existing.notes, BLUEPRINT_LIMITS.MAX_NOTES),
      updatedAt: serverTimestamp(),
    };
    try {
      await updateDoc(doc(db, 'purchase_orders', id), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const deletionPasswordConfigured = Boolean(
    deletionPolicy?.enabled && deletionPolicy?.salt
  );

  const appendDeletionAuthorizationToBatch = async (
    batch: ReturnType<typeof writeBatch>,
    targetCollection: 'purchase_orders' | 'physical_receipts' | 'fiscal_invoices',
    targetId: string,
    targetLabel: string,
    supervisorPassword?: string
  ) => {
    if (isAdmin) return;
    if (!firebaseUser || !userProfile) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    if (!deletionPolicy?.enabled || !deletionPolicy?.salt) {
      throw new Error(
        'Nenhuma senha de Supervisor / Analista foi configurada ainda. Solicite ao ADM Titular que defina a senha em Administração.'
      );
    }
    if (!supervisorPassword || !supervisorPassword.trim()) {
      throw new Error(
        'Informe a senha de autorização do Supervisor / Analista para confirmar a exclusão.'
      );
    }

    const submittedHash = await hashSupervisorPassword(
      deletionPolicy.salt,
      supervisorPassword
    );
    const logId = `${firebaseUser.uid}_${targetId}`;
    batch.set(doc(db, 'deletion_logs', logId), {
      targetCollection,
      targetId,
      targetLabel: sanitizeText(targetLabel, 80) || targetId,
      submittedHash,
      deletedByUid: firebaseUser.uid,
      deletedByName:
        sanitizeText(userProfile.name, BLUEPRINT_LIMITS.MAX_USER_NAME) ||
        'Usuário Corporativo',
      createdAt: serverTimestamp(),
    });
  };

  const handleDeletionCommitError = (error: unknown, path: string): never => {
    const rawMsg = error instanceof Error ? error.message : String(error);
    if (
      !isAdmin &&
      (rawMsg.includes('permission-denied') ||
        rawMsg.includes('Missing or insufficient permissions') ||
        rawMsg.includes('PERMISSION_DENIED'))
    ) {
      throw new Error(
        'Senha de Supervisor / Analista incorreta ou exclusão não autorizada para este registro.'
      );
    }
    return handleFirestoreError(error, OperationType.DELETE, path);
  };

  const deletePurchaseOrder = async (id: string, supervisorPassword?: string) => {
    const path = `purchase_orders/${id}`;
    const existing = purchaseOrders.find((p) => p.id === id);
    const batch = writeBatch(db);
    await appendDeletionAuthorizationToBatch(
      batch,
      'purchase_orders',
      id,
      existing?.poNumber || id,
      supervisorPassword
    );
    batch.delete(doc(db, 'purchase_orders', id));
    try {
      await batch.commit();
    } catch (error) {
      handleDeletionCommitError(error, path);
    }
  };

  // ---------------------------------------------------------------------------
  // Physical Receipts Mutations
  // ---------------------------------------------------------------------------
  const createPhysicalReceipt: P2PContextValue['createPhysicalReceipt'] = async (
    data,
    options
  ) => {
    if (!firebaseUser || !userProfile) return;
    const id = generateDocId('rec');
    const path = `physical_receipts/${id}`;
    const payload = {
      receiptNumber: sanitizeText(data.receiptNumber, BLUEPRINT_LIMITS.MAX_RECEIPT_NUMBER),
      purchaseOrderId: sanitizeText(data.purchaseOrderId, 128),
      poNumber: sanitizeText(data.poNumber, BLUEPRINT_LIMITS.MAX_PO_NUMBER),
      fiscalInvoiceId: sanitizeText(data.fiscalInvoiceId || '', 128),
      supplierName: sanitizeText(data.supplierName, BLUEPRINT_LIMITS.MAX_SUPPLIER_NAME),
      supplierCnpj: sanitizeText(data.supplierCnpj, BLUEPRINT_LIMITS.MAX_CNPJ),
      receiptDate: data.receiptDate,
      invoiceNumberRef: sanitizeText(data.invoiceNumberRef || '', 40),
      warehouseLocation: sanitizeText(data.warehouseLocation, BLUEPRINT_LIMITS.MAX_WAREHOUSE),
      items: data.items.slice(0, BLUEPRINT_LIMITS.MAX_ITEMS).map((it) => ({
        code: sanitizeText(it.code, 40),
        description: sanitizeText(it.description, BLUEPRINT_LIMITS.MAX_ITEM_DESC),
        unit: sanitizeText(it.unit, 12),
        qtyOrdered: Number(it.qtyOrdered),
        qtyReceived: Number(it.qtyReceived),
        condition: it.condition,
      })),
      status: data.status,
      observations: sanitizeText(data.observations || '', BLUEPRINT_LIMITS.MAX_NOTES),
      receivedByUid: firebaseUser.uid,
      receivedByName:
        sanitizeText(userProfile.name, BLUEPRINT_LIMITS.MAX_USER_NAME) || 'Usuário Corporativo',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'physical_receipts', id), payload);

      if (payload.purchaseOrderId && options?.nextPoStatus) {
        batch.update(doc(db, 'purchase_orders', payload.purchaseOrderId), {
          status: options.nextPoStatus,
          updatedAt: serverTimestamp(),
        });
      }

      if (payload.fiscalInvoiceId) {
        batch.update(doc(db, 'fiscal_invoices', payload.fiscalInvoiceId), {
          purchaseOrderId: payload.purchaseOrderId,
          poNumber: payload.poNumber,
          receiptId: id,
          receiptNumber: payload.receiptNumber,
          matchingStatus: options?.matchingStatus || 'conciliada',
          fiscalStatus: 'pendente',
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const updatePhysicalReceipt: P2PContextValue['updatePhysicalReceipt'] = async (
    id,
    data,
    options
  ) => {
    const path = `physical_receipts/${id}`;
    const existing = physicalReceipts.find((r) => r.id === id);
    if (!existing) return;
    const payload = {
      receiptDate: data.receiptDate ?? existing.receiptDate,
      invoiceNumberRef: sanitizeText(data.invoiceNumberRef ?? existing.invoiceNumberRef, 40),
      warehouseLocation: sanitizeText(
        data.warehouseLocation ?? existing.warehouseLocation,
        BLUEPRINT_LIMITS.MAX_WAREHOUSE
      ),
      items: (data.items || existing.items).slice(0, BLUEPRINT_LIMITS.MAX_ITEMS).map((it) => ({
        code: sanitizeText(it.code, 40),
        description: sanitizeText(it.description, BLUEPRINT_LIMITS.MAX_ITEM_DESC),
        unit: sanitizeText(it.unit, 12),
        qtyOrdered: Number(it.qtyOrdered),
        qtyReceived: Number(it.qtyReceived),
        condition: it.condition,
      })),
      status: data.status ?? existing.status,
      observations: sanitizeText(data.observations ?? existing.observations, BLUEPRINT_LIMITS.MAX_NOTES),
      updatedAt: serverTimestamp(),
    };
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'physical_receipts', id), payload);
      if (existing.purchaseOrderId && options?.nextPoStatus) {
        batch.update(doc(db, 'purchase_orders', existing.purchaseOrderId), {
          status: options.nextPoStatus,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const unlinkPhysicalReceiptFromPo = async (id: string) => {
    const path = `physical_receipts/${id}`;
    try {
      await updateDoc(doc(db, 'physical_receipts', id), {
        purchaseOrderId: '',
        poNumber: '',
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const deletePhysicalReceipt = async (id: string, supervisorPassword?: string) => {
    const path = `physical_receipts/${id}`;
    const existing = physicalReceipts.find((r) => r.id === id);
    if (!existing) return;

    const batch = writeBatch(db);
    await appendDeletionAuthorizationToBatch(
      batch,
      'physical_receipts',
      id,
      existing.receiptNumber || id,
      supervisorPassword
    );

    batch.delete(doc(db, 'physical_receipts', id));

    // Revert linked fiscal invoice(s) back to aguardando_recebimento so Recebimento can register again
    const linkedInvoices = fiscalInvoices.filter(
      (inv) =>
        inv.receiptId === id ||
        (isAdmin && Boolean(existing.fiscalInvoiceId) && inv.id === existing.fiscalInvoiceId)
    );
    linkedInvoices.forEach((inv) => {
      batch.update(doc(db, 'fiscal_invoices', inv.id), {
        purchaseOrderId: '',
        poNumber: '',
        receiptId: '',
        receiptNumber: '',
        matchingStatus: 'pendente_vinculo',
        fiscalStatus:
          inv.requiresPhysicalReceipt === false ? 'pendente' : 'aguardando_recebimento',
        bookkeepingDate: '',
        updatedAt: serverTimestamp(),
      });
    });

    // Recalculate and update the linked Purchase Order status based on remaining receipts
    if (existing.purchaseOrderId) {
      const po = purchaseOrders.find((p) => p.id === existing.purchaseOrderId);
      if (po && po.status !== 'cancelado') {
        const remainingReceipts = physicalReceipts.filter(
          (r) => r.id !== id && r.purchaseOrderId === po.id
        );
        const totalOrdered = po.items.reduce((s, it) => s + Number(it.qtyOrdered || 0), 0);
        const remainingReceived = remainingReceipts.reduce(
          (acc, r) => acc + r.items.reduce((s, it) => s + Number(it.qtyReceived || 0), 0),
          0
        );
        const nextPoStatus: PurchaseOrder['status'] =
          remainingReceived <= 0.0001
            ? 'aberto'
            : remainingReceived + 0.0001 < totalOrdered
            ? 'parcialmente_atendido'
            : 'concluido';
        if (po.status !== nextPoStatus) {
          batch.update(doc(db, 'purchase_orders', po.id), {
            status: nextPoStatus,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }

    try {
      await batch.commit();
    } catch (error) {
      handleDeletionCommitError(error, path);
    }
  };

  // ---------------------------------------------------------------------------
  // Fiscal Invoices Mutations
  // ---------------------------------------------------------------------------
  const createFiscalInvoice: P2PContextValue['createFiscalInvoice'] = async (data) => {
    if (!firebaseUser || !userProfile) return undefined;
    const id = generateDocId('nfe');
    const path = `fiscal_invoices/${id}`;
    const payload = buildFiscalInvoiceCreatePayload(data, firebaseUser.uid, userProfile.name);
    try {
      await setDoc(doc(db, 'fiscal_invoices', id), payload);
      return id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const createFiscalInvoicesBatch: P2PContextValue['createFiscalInvoicesBatch'] = async (
    entries
  ) => {
    if (!firebaseUser || !userProfile || entries.length === 0) return [];
    const batch = writeBatch(db);
    const createdIds: string[] = [];
    const actorName =
      sanitizeText(userProfile.name, BLUEPRINT_LIMITS.MAX_USER_NAME) || 'Usuário Corporativo';
    const nowIso = new Date().toISOString();

    entries.forEach((entry) => {
      const invId = generateDocId('nfe');
      createdIds.push(invId);
      let invoiceInput = entry.invoiceData;

      if (entry.adjustmentRequest) {
        const adjId = generateDocId('adj');
        const adj = entry.adjustmentRequest;
        // Provisional adjustment keeps the fiscal invoice unlinked until Compras responds & Fiscal links
        invoiceInput = {
          ...invoiceInput,
          purchaseOrderId: '',
          poNumber: '',
          matchingStatus: 'pendente_vinculo',
          pendingAdjustmentId: adjId,
          pendingAdjustmentPoId: adj.po.id,
          pendingAdjustmentPoNumber: adj.po.poNumber,
          adjustmentStatus: 'Ajuste solicitado',
        };

        const adjPayload = buildAdjustmentRequestCreatePayload({
          fiscalInvoiceId: invId,
          invoiceInput,
          adjustmentRequest: adj,
          actorUid: firebaseUser.uid,
          actorName,
          actorSector: userProfile.sector || 'Fiscal',
          nowIso,
        });
        batch.set(doc(db, 'adjustment_requests', adjId), adjPayload);
      }

      const invPayload = buildFiscalInvoiceCreatePayload(
        invoiceInput,
        firebaseUser.uid,
        userProfile.name
      );
      batch.set(doc(db, 'fiscal_invoices', invId), invPayload);
    });

    try {
      await batch.commit();
      return createdIds;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'fiscal_invoices/batch');
    }
  };

  const updateFiscalInvoice: P2PContextValue['updateFiscalInvoice'] = async (id, data) => {
    const path = `fiscal_invoices/${id}`;
    const existing = fiscalInvoices.find((f) => f.id === id);
    if (!existing) return;
    const nextStatus = data.fiscalStatus ?? existing.fiscalStatus;
    const docType = data.docType ?? existing.docType ?? 'NFE';
    const totalProducts = roundMoney(Math.max(0, Number(data.totalProducts ?? existing.totalProducts ?? 0)));
    const grossAmount = roundMoney(
      Math.max(0, Number(data.grossAmount ?? data.totalProducts ?? existing.grossAmount ?? totalProducts))
    );
    const freightAmount =
      docType === 'NFSE'
        ? 0
        : roundMoney(Math.max(0, Number(data.freightAmount ?? existing.freightAmount ?? 0)));
    const insuranceAmount =
      docType === 'NFSE'
        ? 0
        : roundMoney(Math.max(0, Number(data.insuranceAmount ?? existing.insuranceAmount ?? 0)));
    const otherExpensesAmount = roundMoney(
      Math.max(0, Number(data.otherExpensesAmount ?? existing.otherExpensesAmount ?? 0))
    );
    const surchargeAmount = roundMoney(
      Math.max(0, Number(data.surchargeAmount ?? existing.surchargeAmount ?? 0))
    );
    const discountAmount = roundMoney(
      Math.max(0, Number(data.discountAmount ?? existing.discountAmount ?? 0))
    );
    const icmsAmount =
      docType === 'NFSE'
        ? 0
        : roundMoney(Math.max(0, Number(data.icmsAmount ?? existing.icmsAmount ?? 0)));
    const icmsDesonAmount =
      docType === 'NFSE'
        ? 0
        : roundMoney(Math.max(0, Number(data.icmsDesonAmount ?? existing.icmsDesonAmount ?? 0)));
    const icmsStAmount =
      docType === 'NFE'
        ? roundMoney(Math.max(0, Number(data.icmsStAmount ?? existing.icmsStAmount ?? 0)))
        : 0;
    const ipiAmount =
      docType === 'NFE'
        ? roundMoney(Math.max(0, Number(data.ipiAmount ?? existing.ipiAmount ?? 0)))
        : 0;
    const taxRegime = docType === 'NFSE' ? (data.taxRegime ?? existing.taxRegime ?? 'simples_nacional') : '';
    const pisAmount = roundMoney(Math.max(0, Number(data.pisAmount ?? existing.pisAmount ?? 0)));
    const cofinsAmount = roundMoney(
      Math.max(0, Number(data.cofinsAmount ?? existing.cofinsAmount ?? 0))
    );
    const csllAmount = roundMoney(Math.max(0, Number(data.csllAmount ?? existing.csllAmount ?? 0)));
    const issqnAmount = roundMoney(Math.max(0, Number(data.issqnAmount ?? existing.issqnAmount ?? 0)));
    const issqnRetained = data.issqnRetained ?? existing.issqnRetained ?? true;
    const inssAmount = roundMoney(Math.max(0, Number(data.inssAmount ?? existing.inssAmount ?? 0)));
    const irrfAmount = roundMoney(Math.max(0, Number(data.irrfAmount ?? existing.irrfAmount ?? 0)));
    const retainedTaxesAmount = roundMoney(
      Math.max(0, Number(data.retainedTaxesAmount ?? existing.retainedTaxesAmount ?? 0))
    );

    const computedTotalInvoice = calculateFiscalNetTotal({
      docType,
      totalProducts,
      freightAmount,
      insuranceAmount,
      otherExpensesAmount,
      surchargeAmount,
      ipiAmount,
      icmsStAmount,
      discountAmount,
      retainedTaxesAmount,
      taxRegime,
      pisAmount,
      cofinsAmount,
      csllAmount,
      issqnAmount,
      issqnRetained,
      inssAmount,
      irrfAmount,
    });

    const nextPoId = sanitizeText(data.purchaseOrderId ?? existing.purchaseOrderId, 128);
    const nextReceiptId = sanitizeText(data.receiptId ?? existing.receiptId, 128);
    const nextItems = (data.items ?? existing.items).slice(0, BLUEPRINT_LIMITS.MAX_ITEMS).map((it) => ({
      code: sanitizeText(it.code, 40),
      description: sanitizeText(it.description, BLUEPRINT_LIMITS.MAX_ITEM_DESC),
      ncm: sanitizeText(it.ncm, 12),
      cfop: sanitizeText(it.cfop, 16),
      unit: sanitizeText(it.unit, 12),
      qty: Number(it.qty),
      unitPrice: Number(it.unitPrice),
      totalPrice: Number(it.totalPrice),
      ...(it.gtin ? { gtin: sanitizeText(it.gtin, 20) } : {}),
    }));
    const nextAssociations = sanitizeItemAssociations(
      data.itemAssociations !== undefined ? data.itemAssociations : existing.itemAssociations
    );

    const nextRequiresPhysicalReceipt =
      existing.receiptId === '' &&
      !(existing.fiscalStatus in { lancado: 1, escriturada: 1 }) &&
      typeof data.requiresPhysicalReceipt === 'boolean'
        ? nextStatus === 'aguardando_recebimento'
          ? true
          : data.requiresPhysicalReceipt
        : existing.requiresPhysicalReceipt ?? true;
    const nextIsPartialBilling = Boolean(data.isPartialBilling ?? existing.isPartialBilling ?? false);

    // Check if conference confirmation fingerprint must be invalidated
    const nextPoObj = purchaseOrders.find((p) => p.id === nextPoId);
    const nextRecObj = physicalReceipts.find((r) => r.id === nextReceiptId);
    const nextFingerprint = buildConferenceFingerprint({
      invoice: {
        docType,
        grossAmount,
        totalProducts,
        freightAmount,
        insuranceAmount,
        otherExpensesAmount,
        surchargeAmount,
        discountAmount,
        ipiAmount,
        icmsStAmount,
        pisAmount,
        cofinsAmount,
        csllAmount,
        issqnAmount,
        issqnRetained,
        inssAmount,
        irrfAmount,
        retainedTaxesAmount,
        taxRegime,
        totalInvoice: computedTotalInvoice,
        items: nextItems,
      },
      po: nextPoObj,
      receipt: nextRecObj,
      itemAssociations: nextAssociations,
      requiresPhysicalReceipt: nextRequiresPhysicalReceipt,
      isPartialBilling: nextIsPartialBilling,
    });

    const explicitConferenceConfirm = data.conferenceStatus === 'conferido';
    const shouldInvalidateConference =
      !explicitConferenceConfirm &&
      existing.conferenceStatus === 'conferido' &&
      Boolean(existing.conferenceDataVersion) &&
      existing.conferenceDataVersion !== nextFingerprint;

    const payload: Record<string, unknown> = {
      docType,
      nfeNumber: sanitizeText(data.nfeNumber ?? existing.nfeNumber, 20),
      series: sanitizeText(data.series ?? existing.series ?? '', 10),
      issuerName: sanitizeText(data.issuerName ?? existing.issuerName, BLUEPRINT_LIMITS.MAX_SUPPLIER_NAME),
      issuerCnpj: sanitizeText(data.issuerCnpj ?? existing.issuerCnpj, BLUEPRINT_LIMITS.MAX_CNPJ),
      issueDate: data.issueDate ?? existing.issueDate,
      purchaseOrderId: nextPoId,
      poNumber: sanitizeText(data.poNumber ?? existing.poNumber, BLUEPRINT_LIMITS.MAX_PO_NUMBER),
      receiptId: nextReceiptId,
      receiptNumber: sanitizeText(data.receiptNumber ?? existing.receiptNumber, BLUEPRINT_LIMITS.MAX_RECEIPT_NUMBER),
      linkedInvoiceId: sanitizeText(data.linkedInvoiceId ?? existing.linkedInvoiceId ?? '', 128),
      linkedInvoiceNumber: sanitizeText(data.linkedInvoiceNumber ?? existing.linkedInvoiceNumber ?? '', 20),
      originState: sanitizeText((data.originState ?? existing.originState ?? '').toUpperCase(), 2),
      originCity: sanitizeText(data.originCity ?? existing.originCity ?? '', 120),
      destinationState: sanitizeText((data.destinationState ?? existing.destinationState ?? '').toUpperCase(), 2),
      destinationCity: sanitizeText(data.destinationCity ?? existing.destinationCity ?? '', 120),
      issuerState: sanitizeText((data.issuerState ?? existing.issuerState ?? '').toUpperCase(), 2),
      suframaPinNumber: sanitizeText(data.suframaPinNumber ?? existing.suframaPinNumber ?? '', 40),
      suframaPinAcceptanceDate: sanitizeText(
        data.suframaPinAcceptanceDate ?? existing.suframaPinAcceptanceDate ?? '',
        10
      ),
      suframaPinReceiptDate: sanitizeText(
        data.suframaPinReceiptDate ?? existing.suframaPinReceiptDate ?? '',
        10
      ),
      suframaClearanceDate: sanitizeText(
        data.suframaClearanceDate ?? existing.suframaClearanceDate ?? '',
        10
      ),
      grossAmount,
      freightAmount,
      insuranceAmount,
      otherExpensesAmount,
      surchargeAmount,
      discountAmount,
      totalProducts,
      icmsAmount,
      icmsDesonAmount,
      icmsStAmount,
      ipiAmount,
      taxRegime,
      pisAmount,
      cofinsAmount,
      csllAmount,
      issqnAmount,
      issqnRetained,
      inssAmount,
      irrfAmount,
      retainedTaxesAmount,
      totalInvoice: computedTotalInvoice,
      items: nextItems,
      ...(nextAssociations.length > 0 || existing.itemAssociations !== undefined
        ? { itemAssociations: nextAssociations }
        : {}),
      matchingStatus: data.matchingStatus ?? existing.matchingStatus,
      fiscalStatus: nextStatus,
      ...(existing.receiptId === '' &&
      !(existing.fiscalStatus in { lancado: 1, escriturada: 1 }) &&
      typeof data.requiresPhysicalReceipt === 'boolean'
        ? { requiresPhysicalReceipt: nextRequiresPhysicalReceipt }
        : {}),
      ...(data.isPartialBilling !== undefined || existing.isPartialBilling !== undefined
        ? { isPartialBilling: nextIsPartialBilling }
        : {}),
      replacedByInvoiceId:
        nextStatus === 'substituida'
          ? sanitizeText(data.replacedByInvoiceId ?? existing.replacedByInvoiceId ?? '', 128)
          : '',
      replacedByInvoiceNumber:
        nextStatus === 'substituida'
          ? sanitizeText(data.replacedByInvoiceNumber ?? existing.replacedByInvoiceNumber ?? '', 20)
          : '',
      bookkeepingDate: data.bookkeepingDate ?? existing.bookkeepingDate,
      cfop: sanitizeText(data.cfop ?? existing.cfop, 16),
      notes: sanitizeText(data.notes ?? existing.notes, BLUEPRINT_LIMITS.MAX_NOTES),
      updatedAt: serverTimestamp(),
    };

    if (shouldInvalidateConference) {
      payload.conferenceStatus = 'pendente';
      payload.conferenceOriginalOutcome = '';
      payload.conferenceConfirmedByUid = '';
      payload.conferenceConfirmedByName = '';
      payload.conferenceConfirmedAt = '';
      payload.conferenceJustification = '';
      payload.conferenceDataVersion = '';
    } else if (data.conferenceStatus !== undefined) {
      payload.conferenceStatus = data.conferenceStatus;
      payload.conferenceOriginalOutcome = data.conferenceOriginalOutcome ?? '';
      payload.conferenceConfirmedByUid = sanitizeText(data.conferenceConfirmedByUid || '', 128);
      payload.conferenceConfirmedByName = sanitizeText(
        data.conferenceConfirmedByName || '',
        BLUEPRINT_LIMITS.MAX_USER_NAME
      );
      payload.conferenceConfirmedAt = sanitizeText(data.conferenceConfirmedAt || '', 40);
      payload.conferenceJustification = sanitizeText(
        data.conferenceJustification || '',
        BLUEPRINT_LIMITS.MAX_JUSTIFICATION
      );
      payload.conferenceDataVersion = sanitizeText(data.conferenceDataVersion || '', 40);
    }

    if (data.pendingAdjustmentId !== undefined) {
      payload.pendingAdjustmentId = sanitizeText(data.pendingAdjustmentId, 128);
    }
    if (data.pendingAdjustmentPoId !== undefined) {
      payload.pendingAdjustmentPoId = sanitizeText(data.pendingAdjustmentPoId, 128);
    }
    if (data.pendingAdjustmentPoNumber !== undefined) {
      payload.pendingAdjustmentPoNumber = sanitizeText(
        data.pendingAdjustmentPoNumber,
        BLUEPRINT_LIMITS.MAX_PO_NUMBER
      );
    }
    if (data.adjustmentStatus !== undefined) {
      payload.adjustmentStatus = data.adjustmentStatus;
    }

    try {
      await updateDoc(doc(db, 'fiscal_invoices', id), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const confirmInvoiceConference: P2PContextValue['confirmInvoiceConference'] = async (
    invoiceId,
    params
  ) => {
    if (!firebaseUser || !userProfile) return;
    const path = `fiscal_invoices/${invoiceId}`;
    const actorName =
      sanitizeText(userProfile.name, BLUEPRINT_LIMITS.MAX_USER_NAME) || 'Usuário Corporativo';
    const payload: Record<string, unknown> = {
      conferenceStatus: 'conferido',
      conferenceOriginalOutcome: params.originalOutcome,
      conferenceConfirmedByUid: firebaseUser.uid,
      conferenceConfirmedByName: actorName,
      conferenceConfirmedAt: new Date().toISOString(),
      conferenceJustification: sanitizeText(
        params.justification || '',
        BLUEPRINT_LIMITS.MAX_JUSTIFICATION
      ),
      conferenceDataVersion: sanitizeText(params.dataVersion, 40),
      updatedAt: serverTimestamp(),
    };
    if (params.itemAssociations !== undefined) {
      payload.itemAssociations = sanitizeItemAssociations(params.itemAssociations);
    }
    if (params.matchingStatus !== undefined) {
      payload.matchingStatus = params.matchingStatus;
    }
    try {
      await updateDoc(doc(db, 'fiscal_invoices', invoiceId), payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const unlinkFiscalInvoice = async (id: string, unlinkPo: boolean, unlinkReceipt: boolean) => {
    const path = `fiscal_invoices/${id}`;
    const existing = fiscalInvoices.find((f) => f.id === id);
    if (!existing) return;
    try {
      await updateDoc(doc(db, 'fiscal_invoices', id), {
        purchaseOrderId: unlinkPo ? '' : existing.purchaseOrderId,
        poNumber: unlinkPo ? '' : existing.poNumber,
        receiptId: unlinkReceipt ? '' : existing.receiptId,
        receiptNumber: unlinkReceipt ? '' : existing.receiptNumber,
        matchingStatus: 'pendente_vinculo',
        conferenceStatus: 'pendente',
        conferenceOriginalOutcome: '',
        conferenceConfirmedByUid: '',
        conferenceConfirmedByName: '',
        conferenceConfirmedAt: '',
        conferenceJustification: '',
        conferenceDataVersion: '',
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const deleteFiscalInvoice = async (id: string, supervisorPassword?: string) => {
    const path = `fiscal_invoices/${id}`;
    const existing = fiscalInvoices.find((f) => f.id === id);
    const batch = writeBatch(db);
    await appendDeletionAuthorizationToBatch(
      batch,
      'fiscal_invoices',
      id,
      existing ? `${existing.docType || 'NFE'} ${existing.nfeNumber}` : id,
      supervisorPassword
    );
    batch.delete(doc(db, 'fiscal_invoices', id));
    try {
      await batch.commit();
    } catch (error) {
      handleDeletionCommitError(error, path);
    }
  };

  // ---------------------------------------------------------------------------
  // Product Equivalences Mutations
  // ---------------------------------------------------------------------------
  const upsertProductEquivalence: P2PContextValue['upsertProductEquivalence'] = async (data) => {
    if (!firebaseUser || !userProfile) {
      throw new Error('Sessão expirada.');
    }
    const actorName =
      sanitizeText(userProfile.name, BLUEPRINT_LIMITS.MAX_USER_NAME) || 'Usuário Corporativo';
    const normDesc = sanitizeText(
      normalizeProductText(data.supplierDescription),
      BLUEPRINT_LIMITS.MAX_ITEM_DESC
    );
    const cnpjDigits = normalizeCnpjDigits(data.supplierCnpj);
    const supCodeClean = sanitizeText(data.supplierItemCode, 40);
    const internalCodeClean = sanitizeText(data.internalCode, 40);

    const existingDuplicate =
      data.id
        ? productEquivalences.find((eq) => eq.id === data.id)
        : productEquivalences.find(
            (eq) =>
              normalizeCnpjDigits(eq.supplierCnpj) === cnpjDigits &&
              ((supCodeClean && eq.supplierItemCode === supCodeClean) ||
                eq.supplierNormalizedDesc === normDesc) &&
              ((internalCodeClean && eq.internalCode === internalCodeClean) ||
                normalizeProductText(eq.poDescription) === normalizeProductText(data.poDescription))
          );

    const eqId = existingDuplicate?.id || data.id || generateDocId('eq');
    const path = `product_equivalences/${eqId}`;

    const baseFields = {
      supplierCnpj: sanitizeText(data.supplierCnpj, BLUEPRINT_LIMITS.MAX_CNPJ),
      supplierItemCode: supCodeClean,
      supplierDescription: sanitizeText(data.supplierDescription, BLUEPRINT_LIMITS.MAX_ITEM_DESC),
      supplierNormalizedDesc: normDesc,
      internalCode: internalCodeClean,
      poDescription: sanitizeText(data.poDescription, BLUEPRINT_LIMITS.MAX_ITEM_DESC),
      poUnit: sanitizeText(data.poUnit || 'UN', 12),
      invoiceUnit: sanitizeText(data.invoiceUnit || 'UN', 12),
      conversionFactor: Number(data.conversionFactor) > 0 ? Number(data.conversionFactor) : 1,
      active: data.active ?? true,
      updatedAt: serverTimestamp(),
    };

    try {
      if (existingDuplicate) {
        await updateDoc(doc(db, 'product_equivalences', eqId), baseFields);
      } else {
        await setDoc(doc(db, 'product_equivalences', eqId), {
          ...baseFields,
          createdByUid: firebaseUser.uid,
          createdByName: actorName,
          createdAt: serverTimestamp(),
        });
      }
      return eqId;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const toggleProductEquivalence = async (id: string, active: boolean) => {
    const path = `product_equivalences/${id}`;
    try {
      await updateDoc(doc(db, 'product_equivalences', id), {
        active: Boolean(active),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const deleteProductEquivalence = async (id: string) => {
    const path = `product_equivalences/${id}`;
    try {
      await deleteDoc(doc(db, 'product_equivalences', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  // ---------------------------------------------------------------------------
  // Adjustment Requests (Fiscal <-> Compras) Mutations
  // ---------------------------------------------------------------------------
  const createAdjustmentRequest: P2PContextValue['createAdjustmentRequest'] = async (params) => {
    if (!firebaseUser || !userProfile) {
      throw new Error('Sessão expirada.');
    }
    const existingActive = adjustmentRequests.find(
      (req) =>
        req.fiscalInvoiceId === params.fiscalInvoiceId &&
        req.purchaseOrderId === params.po.id &&
        req.status !== 'Resolvido' &&
        req.status !== 'Cancelado'
    );
    if (existingActive) {
      throw new Error(
        `Já existe uma solicitação de ajuste em aberto (${existingActive.status}) para esta nota fiscal e o pedido ${params.po.poNumber}.`
      );
    }

    const reqId = generateDocId('adj');
    const actorName =
      sanitizeText(userProfile.name, BLUEPRINT_LIMITS.MAX_USER_NAME) || 'Usuário Corporativo';
    const nowIso = new Date().toISOString();

    const batch = writeBatch(db);
    batch.set(doc(db, 'adjustment_requests', reqId), {
      fiscalInvoiceId: params.fiscalInvoiceId,
      invoiceNumber: sanitizeText(params.invoiceNumber, 20),
      docType: params.docType,
      supplierName: sanitizeText(params.supplierName, BLUEPRINT_LIMITS.MAX_SUPPLIER_NAME),
      supplierCnpj: sanitizeText(params.supplierCnpj, BLUEPRINT_LIMITS.MAX_CNPJ),
      purchaseOrderId: params.po.id,
      poNumber: sanitizeText(params.po.poNumber, BLUEPRINT_LIMITS.MAX_PO_NUMBER),
      status: 'Ajuste solicitado' as AdjustmentRequestStatus,
      divergenceReasons: params.divergenceReasons.slice(0, BLUEPRINT_LIMITS.MAX_ADJUSTMENT_REASONS),
      divergentItems: params.divergentItems.slice(0, BLUEPRINT_LIMITS.MAX_ITEMS),
      poGrossTotal: roundMoney(params.poGrossTotal),
      poNetTotal: roundMoney(params.poNetTotal),
      invoiceGrossTotal: roundMoney(params.invoiceGrossTotal),
      invoiceNetTotal: roundMoney(params.invoiceNetTotal),
      fiscalObservation: sanitizeText(params.fiscalObservation || '', BLUEPRINT_LIMITS.MAX_NOTES),
      requestedByUid: firebaseUser.uid,
      requestedByName: actorName,
      requestedAt: nowIso,
      history: [
        {
          status: 'Ajuste solicitado' as AdjustmentRequestStatus,
          actorUid: firebaseUser.uid,
          actorName,
          actorSector: userProfile.sector || 'Fiscal',
          note:
            sanitizeText(params.fiscalObservation || '', BLUEPRINT_LIMITS.MAX_NOTES) ||
            'Solicitação de ajuste enviada ao setor de Compras.',
          timestamp: nowIso,
        },
      ],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Ensure invoice stays unlinked with provisional adjustment reference only
    batch.update(doc(db, 'fiscal_invoices', params.fiscalInvoiceId), {
      purchaseOrderId: '',
      poNumber: '',
      matchingStatus: 'pendente_vinculo',
      pendingAdjustmentId: reqId,
      pendingAdjustmentPoId: params.po.id,
      pendingAdjustmentPoNumber: sanitizeText(params.po.poNumber, BLUEPRINT_LIMITS.MAX_PO_NUMBER),
      adjustmentStatus: 'Ajuste solicitado',
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      return reqId;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `adjustment_requests/${reqId}`);
    }
  };

  const respondAdjustmentRequestAsCompras: P2PContextValue['respondAdjustmentRequestAsCompras'] =
    async (reqId, nextStatus, responseNote) => {
      if (!firebaseUser || !userProfile) return;
      const existing = adjustmentRequests.find((r) => r.id === reqId);
      if (!existing) return;

      const actorName =
        sanitizeText(userProfile.name, BLUEPRINT_LIMITS.MAX_USER_NAME) || 'Usuário Corporativo';
      const nowIso = new Date().toISOString();
      const cleanNote = sanitizeText(responseNote || '', BLUEPRINT_LIMITS.MAX_NOTES);

      const nextHistory: AdjustmentHistoryEntry[] = [
        ...(existing.history || []).slice(-(BLUEPRINT_LIMITS.MAX_ADJUSTMENT_HISTORY - 1)),
        {
          status: nextStatus,
          actorUid: firebaseUser.uid,
          actorName,
          actorSector: userProfile.sector || 'Compras',
          note: cleanNote || `Status atualizado por Compras para: ${nextStatus}.`,
          timestamp: nowIso,
        },
      ];

      try {
        await updateDoc(doc(db, 'adjustment_requests', reqId), {
          status: nextStatus,
          comprasResponse: cleanNote,
          comprasRespondedByUid: firebaseUser.uid,
          comprasRespondedByName: actorName,
          comprasRespondedAt: nowIso,
          history: nextHistory,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `adjustment_requests/${reqId}`);
      }
    };

  const updateAdjustmentRequestAsFiscal: P2PContextValue['updateAdjustmentRequestAsFiscal'] =
    async (reqId, nextStatus, note, options) => {
      if (!firebaseUser || !userProfile) return;
      const existing = adjustmentRequests.find((r) => r.id === reqId);
      if (!existing) return;

      const actorName =
        sanitizeText(userProfile.name, BLUEPRINT_LIMITS.MAX_USER_NAME) || 'Usuário Corporativo';
      const nowIso = new Date().toISOString();
      const cleanNote = sanitizeText(note || '', BLUEPRINT_LIMITS.MAX_NOTES);

      const nextHistory: AdjustmentHistoryEntry[] = [
        ...(existing.history || []).slice(-(BLUEPRINT_LIMITS.MAX_ADJUSTMENT_HISTORY - 1)),
        {
          status: nextStatus,
          actorUid: firebaseUser.uid,
          actorName,
          actorSector: userProfile.sector || 'Fiscal',
          note: cleanNote || `Status atualizado pelo Fiscal para: ${nextStatus}.`,
          timestamp: nowIso,
        },
      ];

      const batch = writeBatch(db);
      const reqUpdate: Record<string, unknown> = {
        status: nextStatus,
        history: nextHistory,
        updatedAt: serverTimestamp(),
      };
      if (nextStatus === 'Reaberto') {
        reqUpdate.fiscalObservation = cleanNote || existing.fiscalObservation;
      }
      if (options?.divergenceReasons) {
        reqUpdate.divergenceReasons = options.divergenceReasons.slice(
          0,
          BLUEPRINT_LIMITS.MAX_ADJUSTMENT_REASONS
        );
      }
      if (options?.divergentItems) {
        reqUpdate.divergentItems = options.divergentItems.slice(0, BLUEPRINT_LIMITS.MAX_ITEMS);
      }
      if (typeof options?.poGrossTotal === 'number') {
        reqUpdate.poGrossTotal = roundMoney(options.poGrossTotal);
      }
      if (typeof options?.poNetTotal === 'number') {
        reqUpdate.poNetTotal = roundMoney(options.poNetTotal);
      }
      if (typeof options?.invoiceGrossTotal === 'number') {
        reqUpdate.invoiceGrossTotal = roundMoney(options.invoiceGrossTotal);
      }
      if (typeof options?.invoiceNetTotal === 'number') {
        reqUpdate.invoiceNetTotal = roundMoney(options.invoiceNetTotal);
      }
      if (nextStatus === 'Resolvido' || nextStatus === 'Cancelado') {
        reqUpdate.resolvedByUid = firebaseUser.uid;
        reqUpdate.resolvedByName = actorName;
        reqUpdate.resolvedAt = nowIso;
        reqUpdate.resolutionNote = cleanNote;
      }
      batch.update(doc(db, 'adjustment_requests', reqId), reqUpdate);

      const invUpdate: Record<string, unknown> = {
        updatedAt: serverTimestamp(),
      };
      if (nextStatus === 'Resolvido' || nextStatus === 'Cancelado') {
        invUpdate.pendingAdjustmentId = '';
        invUpdate.pendingAdjustmentPoId = '';
        invUpdate.pendingAdjustmentPoNumber = '';
        invUpdate.adjustmentStatus = nextStatus;
        if (options?.linkPo) {
          invUpdate.purchaseOrderId = sanitizeText(options.linkPo.purchaseOrderId, 128);
          invUpdate.poNumber = sanitizeText(
            options.linkPo.poNumber,
            BLUEPRINT_LIMITS.MAX_PO_NUMBER
          );
          invUpdate.matchingStatus = options.linkPo.matchingStatus;
          if (options.linkPo.itemAssociations !== undefined) {
            invUpdate.itemAssociations = sanitizeItemAssociations(options.linkPo.itemAssociations);
          }
        }
      } else {
        invUpdate.adjustmentStatus = nextStatus;
      }
      batch.update(doc(db, 'fiscal_invoices', existing.fiscalInvoiceId), invUpdate);

      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `adjustment_requests/${reqId}`);
      }
    };

  // ---------------------------------------------------------------------------
  // Admin Mutations
  // ---------------------------------------------------------------------------
  const updateUserAccess = async (uid: string, role: UserRole, status: UserStatus) => {
    const targetUser = allUsers.find((u) => u.uid === uid);
    if (!targetUser) return;
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid), {
      role,
      sector: ROLE_TO_SECTOR[role],
      status,
      updatedAt: serverTimestamp(),
    });
    const adminRef = doc(db, 'admins', uid);
    if (role === 'adm_titular' && status === 'ativo') {
      batch.set(adminRef, {
        uid,
        email: targetUser.email,
        createdAt: serverTimestamp(),
      });
    } else if (uid !== firebaseUser?.uid) {
      batch.delete(adminRef);
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const createUserInvite = async (
    name: string,
    email: string,
    role: Exclude<UserRole, 'pendente'>
  ) => {
    if (!firebaseUser) return;
    const id = generateDocId('inv');
    const path = `user_invites/${id}`;
    try {
      await setDoc(doc(db, 'user_invites', id), {
        name: sanitizeText(name, BLUEPRINT_LIMITS.MAX_USER_NAME),
        email: sanitizeText(email.toLowerCase(), BLUEPRINT_LIMITS.MAX_EMAIL),
        role,
        createdByUid: firebaseUser.uid,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const deleteUserInvite = async (inviteId: string) => {
    const path = `user_invites/${inviteId}`;
    try {
      await deleteDoc(doc(db, 'user_invites', inviteId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const updateSectorPermission: P2PContextValue['updateSectorPermission'] = async (
    sector,
    perms
  ) => {
    if (!firebaseUser) return;
    const path = `sector_permissions/${sector}`;
    try {
      await setDoc(doc(db, 'sector_permissions', sector), {
        sector,
        canCreate: Boolean(perms.canCreate),
        canEdit: Boolean(perms.canEdit),
        canDelete: Boolean(perms.canDelete),
        canViewOtherSectors: Boolean(perms.canViewOtherSectors),
        updatedByUid: firebaseUser.uid,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const setSupervisorDeletionPassword = async (newPassword: string) => {
    if (!firebaseUser || !userProfile || !isAdmin) return;
    const trimmed = newPassword.trim();
    if (trimmed.length < 4) {
      throw new Error('A senha de Supervisor / Analista deve possuir pelo menos 4 caracteres.');
    }
    const salt = generateRandomHex(16);
    const passwordHash = await hashSupervisorPassword(salt, trimmed);
    const batch = writeBatch(db);
    batch.set(doc(db, 'system_config', 'deletion_policy'), {
      enabled: true,
      salt,
      updatedByUid: firebaseUser.uid,
      updatedByName:
        sanitizeText(userProfile.name, BLUEPRINT_LIMITS.MAX_USER_NAME) || 'ADM Titular',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'system_config', 'deletion_secret'), {
      passwordHash,
      updatedByUid: firebaseUser.uid,
      updatedAt: serverTimestamp(),
    });
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'system_config/deletion_policy');
    }
  };

  const value = useMemo<P2PContextValue>(
    () => ({
      authReady,
      firebaseUser,
      userProfile,
      authError,
      signingIn,
      signInWithGoogle,
      logout,
      purchaseOrders,
      physicalReceipts,
      fiscalInvoices,
      productEquivalences,
      adjustmentRequests,
      allUsers,
      userInvites,
      sectorPermissions,
      deletionPolicy,
      deletionPasswordConfigured,
      deletionLogs,
      dataLoading,
      dataError,
      isAdmin,
      canAccessSectorData,
      canCreateInSector,
      canEditInSector,
      canDeleteInSector,
      createPurchaseOrder,
      updatePurchaseOrder,
      deletePurchaseOrder,
      createPhysicalReceipt,
      updatePhysicalReceipt,
      unlinkPhysicalReceiptFromPo,
      deletePhysicalReceipt,
      createFiscalInvoice,
      createFiscalInvoicesBatch,
      updateFiscalInvoice,
      confirmInvoiceConference,
      unlinkFiscalInvoice,
      deleteFiscalInvoice,
      upsertProductEquivalence,
      toggleProductEquivalence,
      deleteProductEquivalence,
      createAdjustmentRequest,
      respondAdjustmentRequestAsCompras,
      updateAdjustmentRequestAsFiscal,
      updateUserAccess,
      createUserInvite,
      deleteUserInvite,
      updateSectorPermission,
      setSupervisorDeletionPassword,
    }),
    [
      authReady,
      firebaseUser,
      userProfile,
      authError,
      signingIn,
      purchaseOrders,
      physicalReceipts,
      fiscalInvoices,
      productEquivalences,
      adjustmentRequests,
      allUsers,
      userInvites,
      sectorPermissions,
      deletionPolicy,
      deletionPasswordConfigured,
      deletionLogs,
      dataLoading,
      dataError,
      isAdmin,
    ]
  );

  return <P2PContext.Provider value={value}>{children}</P2PContext.Provider>;
}

export function useP2P() {
  const ctx = useContext(P2PContext);
  if (!ctx) {
    throw new Error('useP2P deve ser utilizado dentro de P2PProvider.');
  }
  return ctx;
}

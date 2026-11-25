# Security Specification — Controle Fiscal P2P

## 1. Data Invariants
1. **Bootstrap Uniqueness**: Only the very first authenticated user can initialize `/system_config/bootstrap` and claim the initial `adm_titular` role in `/users/{uid}` and `/admins/{uid}` via an atomic batch. Subsequent users cannot self-assign `adm_titular` or any sector role without a verified invite from an existing `adm_titular`.
2. **PII Isolation**: `/users/{uid}` contains corporate email addresses and is strictly readable only by the document owner (`uid == request.auth.uid`) or an `adm_titular`. `/user_invites/{inviteId}` is readable only by `adm_titular` or the invited user matching `request.auth.token.email.lower()`.
3. **Strict Sector Isolation (RBAC)**:
   - `compras` may only create/edit/delete in `/purchase_orders`.
   - `recebimento` may only create/edit/delete in `/physical_receipts`.
   - `fiscal` may only create/edit/delete in `/fiscal_invoices` and `/product_equivalences`.
   - `/adjustment_requests` enforces a strict cross-sector state machine: only `fiscal` can create/reopen/resolve/cancel requests, and `compras` can only update response fields and transition status to `'Em análise' | 'Ajustado' | 'Devolvido para revisão fiscal'`.
   - No sector may write to another sector's collection.
   - `adm_titular` has unrestricted create/edit/unlink/delete authority across all collections and manages `/users`, `/user_invites`, and `/sector_permissions`.
4. **Relational Integrity**:
   - A `PhysicalReceipt` referencing a non-empty `purchaseOrderId` must reference an existing `/purchase_orders/{purchaseOrderId}`.
   - A `FiscalInvoice` referencing a non-empty `purchaseOrderId` or `receiptId` must reference existing documents in `/purchase_orders` and `/physical_receipts`.
   - A `FiscalInvoice` with an active unresolved `pendingAdjustmentId` must keep `purchaseOrderId == ''` until the adjustment is resolved or cancelled.
5. **Terminal State & Timestamp Integrity**:
   - `createdAt` and owner UIDs (`createdByUid`, `receivedByUid`) are immutable after creation.
   - `createdAt` and `updatedAt` must equal `request.time`.
   - Cancelled `PurchaseOrder` (`status == 'cancelado'`) and booked `FiscalInvoice` (`fiscalStatus == 'escriturada'`) cannot be mutated by non-admin sector users.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Privilege Escalation on Signup**: New user attempts to create `/users/{uid}` with `role: "adm_titular"` after `/system_config/bootstrap` already exists.
2. **Self-Role Upgrade on Update**: A `compras` user updates `/users/{uid}` changing `role` to `"adm_titular"` or `"fiscal"`.
3. **Shadow Field Injection**: A `compras` user creates a `PurchaseOrder` with an extra ghost field `isApprovedOverride: true`.
4. **Cross-Sector Write (Compras -> Recebimento)**: A `compras` user attempts to create or update a `PhysicalReceipt` in `/physical_receipts`.
5. **Cross-Sector Write (Recebimento -> Fiscal)**: A `recebimento` user attempts to create or delete a `FiscalInvoice` in `/fiscal_invoices`.
6. **Cross-Sector Write (Fiscal -> Compras)**: A `fiscal` user attempts to edit or cancel a `PurchaseOrder` in `/purchase_orders`.
7. **PII Scraping**: A non-admin user attempts `list` or `get` on another user's `/users/{otherUid}` document.
8. **ID Poisoning / Resource Exhaustion**: User attempts to write to `/purchase_orders/` with a 500-character non-alphanumeric ID or a 1MB `notes` string.
9. **Identity Spoofing**: A `compras` user creates a `PurchaseOrder` with `createdByUid` set to another user's UID.
10. **Timestamp Tampering**: User submits `createdAt` or `updatedAt` as a backdated client timestamp instead of `request.time`.
11. **Orphaned Relational Reference**: A `fiscal` user creates a `FiscalInvoice` with `purchaseOrderId: "nonexistent_po_id"`.
12. **Terminal State Bypass**: A `fiscal` user attempts to edit an already `'escriturada'` `FiscalInvoice` or a `compras` user attempts to edit a `'cancelado'` `PurchaseOrder`.

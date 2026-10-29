import type { Check, ProvenanceField, Customer, Order, Dispute, PaymentKind } from '../lib/kernel';
export interface OwnerAuthorization {
    kind: PaymentKind;
    targetId: string;
    maxAmountCents: number;
    confirmed: true;
    by: string;
    at: string;
}
export interface Decision {
    id: string;
    createdAt: string;
    subject: string;
    text: string;
    kind: string;
    arena: boolean;
    mode: string;
    status: string;
    verdict: string;
    amountCents: number;
    currency: string;
    counterparty: string;
    extraction?: Record<string, unknown>;
    receipt?: unknown;
    ownerAuthorization?: OwnerAuthorization;
    reasons?: unknown[];
    checks?: Check[];
    provenance?: ProvenanceField[];
    rail?: {
        mode: string;
        reference: string;
        status: string;
    };
    [key: string]: unknown;
}
export interface Policy {
    id: string;
    name?: string;
    title?: string;
    kind?: string;
    enabled?: boolean;
    maxAmountCents: number;
    version: number;
    refundWindowDays?: number;
    [key: string]: unknown;
}
export interface Vendor {
    id: string;
    name: string;
    email?: string;
    paypalEmail?: string;
    [key: string]: unknown;
}
export interface AppState {
    mode: string;
    extractor: string;
    identity: {
        id: string;
        name: string;
        email: string;
        local?: boolean;
    };
    vendors: Vendor[];
    customers: Customer[];
    orders: Order[];
    disputes: Dispute[];
    paypalOperations: CheckoutOperation[];
    policies: Policy[];
    decisions: Decision[];
    arena: Decision[];
    stats: {
        processed: number;
        protectedCents: number;
        held: number;
        blocked: number;
        attempts: number;
        stolenCents: number | null;
    };
    chain: {
        verified: boolean;
        count: number;
        head: string;
    };
    capabilities: {
        sandboxConfigured: boolean;
        extractorConfigured: boolean;
        sellerConfigured: boolean;
        webhookConfigured: boolean;
        disputes: boolean;
        arenaMoneyRail: boolean;
    };
    readiness: {
        ready: boolean;
        checks: Array<{ id: string; label: string; status: 'ready' | 'missing' | 'unverified'; detail: string }>;
    };
}

export interface CheckoutOperation {
    id: string;
    kind: 'create_order' | 'capture_order';
    status: 'reserved' | 'completed' | 'failed';
    createdAt: string;
    orderId?: string;
    amountCents?: number;
    result?: { orderId?: string; status?: string; approvalUrl?: string; captureId?: string; captureStatus?: string; amountCents?: number; currency?: string };
    error?: string;
}

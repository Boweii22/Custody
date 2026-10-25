import type { Check, ProvenanceField } from '../lib/kernel';
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
    customers: unknown[];
    orders: unknown[];
    policies: Policy[];
    decisions: Decision[];
    arena: Decision[];
    stats: {
        processed: number;
        protectedCents: number;
        held: number;
        blocked: number;
        attempts: number;
        stolenCents: number;
    };
    chain: {
        verified: boolean;
        count: number;
        head: string;
    };
    capabilities: {
        sandboxConfigured: boolean;
        extractorConfigured: boolean;
        disputes: boolean;
    };
}

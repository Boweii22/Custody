'use client';

import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, Copy, FileCheck2, LockKeyhole, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import type { AppState, CheckoutOperation } from './ui-types';

const money = (cents = 0, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
const positiveCents = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : NaN;

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw Error(result.error || 'The server could not complete this request.');
  return result;
}

export function Readiness({ data, compact = false }: { data: AppState; compact?: boolean }) {
  const checks = data.readiness?.checks ?? [];
  return <div className={'readiness-checks ' + (compact ? 'readiness-compact' : '')}>
    {checks.map(check => <div key={check.id} className={'readiness-check readiness-' + check.status}>
      <span className="readiness-symbol">{check.status === 'ready' ? <Check size={15} /> : <span>{check.status === 'missing' ? '○' : '◐'}</span>}</span>
      <div><strong>{check.label}</strong><p>{check.detail}</p></div><span className="readiness-status">{check.status === 'ready' ? 'Ready' : check.status === 'missing' ? 'Setup required' : 'Not verified'}</span>
    </div>)}
  </div>;
}

export default function SandboxWorkspace({ data, setData, notify }: { data: AppState; setData: (state: AppState) => void; notify: (message: string) => void }) {
  const [busy, setBusy] = useState('');
  const [amount, setAmount] = useState('');
  const [requestId, setRequestId] = useState('');
  const [buyerApproved, setBuyerApproved] = useState<Record<string, boolean>>({});
  const [recordId, setRecordId] = useState('');
  const [recordType, setRecordType] = useState<'orderId' | 'disputeId'>('orderId');
  const [customer, setCustomer] = useState({ name: '', email: '', verified: false });
  const [evidence, setEvidence] = useState({ orderId: '', trackingNumber: '', carrier: '', deliveredAt: '', verified: false });
  const [feedback, setFeedback] = useState('');
  const configured = data.mode === 'sandbox' && data.capabilities.sandboxConfigured && data.capabilities.sellerConfigured;
  const operations = data.paypalOperations ?? [];
  const creates = operations.filter(operation => operation.kind === 'create_order').slice().reverse();
  const cents = positiveCents(amount);
  const run = async (name: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(name); setFeedback('');
    try { await action(); }
    catch (failure) { const message = failure instanceof Error ? failure.message : 'Request failed.'; setFeedback(message); notify(message); }
    finally { setBusy(''); }
  };
  const copyIdentity = async () => {
    try { await navigator.clipboard.writeText(data.identity.id); notify('Authenticated owner ID copied.'); }
    catch { notify('Copy the owner ID shown in the connection settings.'); }
  };
  const createOrder = () => run('create', async () => {
    const stableId = requestId || crypto.randomUUID();
    setRequestId(stableId);
    const result = await post<{ operation: CheckoutOperation; state: AppState }>('/api/paypal/orders', { action: 'create', amountCents: cents, requestId: stableId });
    setData(result.state);
    if (result.operation.error) throw Error(result.operation.error);
    setAmount(''); setRequestId('');
    notify('PayPal returned an order. The sandbox buyer must approve it before capture.');
  });
  const capture = (orderId: string) => run('capture-' + orderId, async () => {
    const result = await post<{ operation: CheckoutOperation; state: AppState }>('/api/paypal/orders', { action: 'capture', orderId, requestId: 'capture-' + orderId });
    setData(result.state);
    if (result.operation.error) throw Error(result.operation.error);
    notify(result.operation.result?.captureStatus === 'COMPLETED' ? 'PayPal confirmed the sandbox capture. Its record is now available for refunds.' : 'PayPal response recorded. Check the capture status before using this order.');
  });
  const importRecord = (id = recordId.trim(), type = recordType) => run('import-' + id, async () => {
    const result = await post<{ state: AppState }>('/api/paypal/records', { [type]: id });
    setData(result.state); setRecordId('');
    notify('Authoritative record fetched from PayPal sandbox and saved.');
  });
  return <>
    <div className="page-heading"><div><div className="eyebrow">REAL SANDBOX CONNECTIONS</div><h1>Connect the rails.<br /><em>Verify the result.</em></h1><p>Your workspace starts empty. Only your verified records and actual provider responses appear here.</p></div><button className="button secondary" disabled={!!busy} onClick={() => run('verify', async () => {
      const result = await post<{ state: AppState }>('/api/connections/verify', {});
      setData(result.state); notify('Connection checks finished. Review each result below.');
    })}><RefreshCw size={15} className={busy === 'verify' ? 'spin' : ''} />Verify connections</button></div>
    <section className="setup-panel"><div className="setup-panel-heading"><span className="modal-emblem"><LockKeyhole size={23} /></span><div><h2>{data.readiness?.ready ? 'Connections verified.' : 'Setup is still in progress.'}</h2><p>Configured credentials alone do not prove a working payment flow. Connection checks call the actual providers; transaction receipts show each result.</p></div></div><Readiness data={data} /><details className="setup-instructions"><summary>Server configuration & owner identity</summary><p>Configure these values in the private server environment. Secrets belong in the host’s environment settings, outside the inbox and browser code.</p><div className="owner-identity"><span>Authenticated owner ID</span><code>{data.identity.id}</code><button className="text-button" onClick={copyIdentity}><Copy size={13} />Copy</button></div><pre>CUSTODY_RAIL=sandbox{`\n`}CUSTODY_SELLER_ID=&lt;authenticated owner ID&gt;{`\n`}PAYPAL_CLIENT_ID=&lt;your sandbox app client ID&gt;{`\n`}PAYPAL_CLIENT_SECRET=&lt;your sandbox app secret&gt;{`\n`}EXTRACTOR_URL=&lt;HTTPS model endpoint&gt;{`\n`}EXTRACTOR_KEY=&lt;model API secret&gt;{`\n`}EXTRACTOR_MODEL=&lt;model ID&gt;{`\n`}PAYPAL_WEBHOOK_ID=&lt;verified callback configuration&gt;</pre><p>Buyer approval requires a separate PayPal sandbox personal account. All payment requests use PayPal’s sandbox API. Webhook delivery requires a reachable callback; a saved webhook ID does not verify delivery.</p><a className="text-button" href="https://developer.paypal.com/dashboard/applications/sandbox" target="_blank" rel="noreferrer">Open PayPal Developer dashboard<ArrowUpRight size={13} /></a></details></section>
    {feedback && <p className="provider-feedback" role="alert">{feedback}</p>}
    <div className="sandbox-grid">
      <section className="sandbox-card"><div className="card-title"><span><ArrowUpRight size={18} />Buyer checkout</span><span className="eyebrow">PAYPAL ORDERS API</span></div><p>Create a real sandbox order, open its approval page, then return here to capture it. The captured record can be used for a refund.</p><label className="field-label" htmlFor="checkout-amount">ORDER AMOUNT · USD</label><div className="inline-form"><input id="checkout-amount" inputMode="decimal" value={amount} disabled={!!requestId} onChange={event => setAmount(event.target.value)} placeholder="0.00" /><button className="button primary" disabled={!!busy || !configured || !Number.isSafeInteger(cents) || cents < 1 || cents > 1000000} onClick={createOrder}>{busy === 'create' ? <RefreshCw size={14} className="spin" /> : <ArrowRight size={14} />}Create order</button></div>{!configured && <small className="form-hint">Connect PayPal sandbox credentials and this seller identity to enable checkout.</small>}{requestId && <small className="form-hint">Request ID {requestId} is retained after an uncertain response. Repeating this request uses the same reservation. <button className="text-button" disabled={!!busy} onClick={()=>{setRequestId('');setAmount('')}}>Start a separate order</button></small>}
        <div className="checkout-list">{creates.length ? creates.map(operation => {
          const orderId = operation.orderId || operation.result?.orderId;
          const captured = operations.find(value => value.kind === 'capture_order' && value.orderId === orderId);
          const capturedOrder = data.orders.find(value => value.id === orderId);
          const captureConfirmed = captured?.result?.captureStatus === 'COMPLETED' || capturedOrder?.paymentStatus === 'COMPLETED';
          return <div className="checkout-record" key={operation.id}>
            <div><strong>{money(operation.amountCents)}</strong><span className="record-status">{captureConfirmed ? 'CAPTURE COMPLETED' : captured?.result?.captureStatus || captured?.result?.status || (captured ? captured.status : operation.result?.status || operation.status)}</span></div>
            <code>{orderId || operation.id}</code>
            {(captured?.error || operation.error) && <p className="record-error">{captured?.error || operation.error}</p>}
            {captured && !captureConfirmed && <p className="form-hint">A capture reservation exists. Fetch the provider record to confirm its outcome before taking any further action.</p>}
            <div className="record-actions">
              {operation.result?.approvalUrl && !captureConfirmed && <a className="button secondary small" href={operation.result.approvalUrl} target="_blank" rel="noreferrer">Approve in PayPal<ArrowUpRight size={13} /></a>}
              {orderId && !captured && !captureConfirmed && <><label className="verify-checkbox checkout-approval"><input type="checkbox" checked={!!buyerApproved[orderId]} onChange={event=>setBuyerApproved(value=>({...value,[orderId]:event.target.checked}))}/><span>The sandbox buyer approved this order in PayPal.</span></label><button className="button primary small" disabled={!!busy || !configured || !buyerApproved[orderId]} onClick={() => capture(orderId)}>Check approval & capture</button></>}
              {orderId && <button className="text-button" disabled={!!busy || !configured} onClick={() => importRecord(orderId, 'orderId')}><RefreshCw size={12} />Fetch capture record</button>}
            </div>
          </div>;
        }) : <div className="small-empty">No sandbox orders have been created.</div>}</div>
      </section>
      <section className="sandbox-card"><div className="card-title"><span><FileCheck2 size={18} />Trusted payment records</span><span className="eyebrow">FETCHED FROM PAYPAL</span></div><p>Import an existing captured order or dispute from your connected sandbox account. Message text cannot create payment history.</p><label className="field-label" htmlFor="record-type">RECORD TYPE</label><select id="record-type" value={recordType} onChange={event => setRecordType(event.target.value as 'orderId' | 'disputeId')}><option value="orderId">Captured order</option><option value="disputeId">Dispute</option></select><label className="field-label" htmlFor="paypal-record-id">PAYPAL {recordType === 'orderId' ? 'ORDER' : 'DISPUTE'} ID</label><div className="inline-form"><input id="paypal-record-id" value={recordId} onChange={event => setRecordId(event.target.value)} maxLength={100} placeholder="Paste the provider record ID" /><button className="button secondary" disabled={!!busy || !configured || !recordId.trim()} onClick={() => importRecord()}><RefreshCw size={14} />Fetch record</button></div><div className="trusted-payment-list">{data.orders.length ? data.orders.map(order => <div className="trusted-payment" key={order.id}><div><strong>{order.customerName || order.id}</strong><span>{order.paymentStatus}</span></div><code>{order.id}</code><small>Capture {order.captureId} · {money(order.capturedCents, order.currency)} captured · {money(order.refundedCents, order.currency)} refunded</small></div>) : <div className="small-empty">No captured orders imported.</div>}{data.disputes?.map(dispute => <div className="trusted-payment" key={dispute.id}><div><strong>{dispute.id}</strong><span>{dispute.status}</span></div><small>{dispute.reason} · response due {new Date(dispute.deadline).toLocaleString()}</small></div>)}</div>
      </section>
      <section className="sandbox-card"><div className="card-title"><span><Users size={18} />Verified customers</span><span className="eyebrow">INVOICE AUTHORITY</span></div><p>Verify the customer’s destination independently before authorizing agent-created invoices.</p><label className="field-label" htmlFor="customer-name">CUSTOMER NAME</label><input id="customer-name" value={customer.name} maxLength={80} onChange={event => setCustomer(value => ({ ...value, name: event.target.value }))} /><label className="field-label" htmlFor="customer-email">VERIFIED EMAIL</label><input id="customer-email" type="email" value={customer.email} maxLength={254} onChange={event => setCustomer(value => ({ ...value, email: event.target.value }))} /><label className="verify-checkbox"><input type="checkbox" checked={customer.verified} onChange={event => setCustomer(value => ({ ...value, verified: event.target.checked }))} /><span>I independently verified this address and authorize it as an invoice destination.</span></label><button className="button primary" disabled={!!busy || !customer.name.trim() || !customer.email.trim() || !customer.verified || data.identity.local} onClick={() => run('customer', async () => { const result = await post<{ state: AppState }>('/api/settings', { type: 'customer', customer }); setData(result.state); setCustomer({ name: '', email: '', verified: false }); notify('Verified customer saved with your authority receipt.'); })}><ShieldCheck size={14} />Verify customer</button><div className="trusted-payment-list">{data.customers.length ? data.customers.map(value => <div className="trusted-payment" key={value.id}><div><strong>{value.name}</strong><ShieldCheck size={13} /></div><code>{value.email}</code></div>) : <div className="small-empty">No customers verified.</div>}</div></section>
      <section className="sandbox-card"><div className="card-title"><span><ShieldCheck size={18} />Delivery evidence</span><span className="eyebrow">OWNER ATTESTED</span></div><p>Add independently verified fulfillment details to an imported order before submitting dispute evidence.</p><label className="field-label" htmlFor="evidence-order">CAPTURED ORDER</label><select id="evidence-order" value={evidence.orderId} onChange={event => setEvidence(value => ({ ...value, orderId: event.target.value }))}><option value="">Choose an imported order</option>{data.orders.map(order => <option key={order.id} value={order.id}>{order.id}</option>)}</select><label className="field-label" htmlFor="evidence-tracking">TRACKING NUMBER</label><input id="evidence-tracking" value={evidence.trackingNumber} maxLength={255} onChange={event => setEvidence(value => ({ ...value, trackingNumber: event.target.value }))} /><div className="form-row"><div><label className="field-label" htmlFor="evidence-carrier">PAYPAL CARRIER CODE</label><input id="evidence-carrier" placeholder="Your carrier enum" value={evidence.carrier} maxLength={80} onChange={event => setEvidence(value => ({ ...value, carrier: event.target.value.toUpperCase() }))} /></div><div><label className="field-label" htmlFor="evidence-date">DELIVERED AT · LOCAL TIME</label><input id="evidence-date" type="datetime-local" value={evidence.deliveredAt} onChange={event => setEvidence(value => ({ ...value, deliveredAt: event.target.value }))} /></div></div><label className="verify-checkbox"><input type="checkbox" checked={evidence.verified} onChange={event => setEvidence(value => ({ ...value, verified: event.target.checked }))} /><span>I verified these delivery details against the merchant’s fulfillment record.</span></label><button className="button secondary" disabled={!!busy || data.identity.local || !evidence.verified || !evidence.orderId || !evidence.trackingNumber || !evidence.carrier || !evidence.deliveredAt} onClick={() => run('evidence', async () => { const deliveredAt = new Date(evidence.deliveredAt); if (!Number.isFinite(deliveredAt.getTime()) || deliveredAt.getTime() > Date.now()) throw Error('Enter a valid delivery time in the past.'); const result = await post<{ state: AppState }>('/api/settings', { type: 'order_evidence', orderId: evidence.orderId, trackingNumber: evidence.trackingNumber, carrier: evidence.carrier, deliveredAt: deliveredAt.toISOString() }); setData(result.state); setEvidence({ orderId: '', trackingNumber: '', carrier: '', deliveredAt: '', verified: false }); notify('Owner-verified delivery evidence saved.'); })}><FileCheck2 size={14} />Save evidence</button></section>
    </div>
  </>;
}

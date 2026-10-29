'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type GridApi } from 'ag-grid-community';
import { Download, Search } from 'lucide-react';
import { safeCsvCell } from '../lib/csv';

ModuleRegistry.registerModules([AllCommunityModule]);

export interface EvaluationLedgerCase {
  id: string;
  category: string;
  subject: string;
  text: string;
  authorization?: { kind: string; targetId: string; maxAmountCents: number };
  claims?: Record<string, unknown>;
  verdict?: string;
  failedChecks?: string[];
  passed: boolean;
  executionAttempted: boolean;
  model?: { name: string };
}

interface EvaluationRow {
  id: string;
  category: string;
  ownerAction: string;
  ownerTarget: string;
  ownerMaximumCents: number | null;
  modelAction: string;
  modelTarget: string;
  modelAmountCents: number | null;
  verdict: string;
  failedChecks: string;
  expectedMatch: boolean;
  paymentSubmitted: boolean;
}

const theme = themeQuartz.withParams({ backgroundColor: '#fffefa', foregroundColor: '#263a31', headerBackgroundColor: '#f0f3e9', borderColor: '#dce3d3', fontFamily: 'DM Sans, sans-serif', fontSize: 12, rowHeight: 48, headerHeight: 45, wrapperBorderRadius: 7 });
const columns: ColDef<EvaluationRow>[] = [
  { field: 'id', headerName: 'Recorded case', minWidth: 215, flex: 1 },
  { field: 'category', headerName: 'Category', width: 115 },
  { field: 'ownerTarget', headerName: 'Owner-selected target', minWidth: 215 },
  { field: 'modelTarget', headerName: 'Model-claimed target', minWidth: 215 },
  { field: 'ownerAction', headerName: 'Owner action', width: 145 },
  { field: 'modelAction', headerName: 'Model action', width: 145 },
  { field: 'ownerMaximumCents', headerName: 'Task ceiling · cents', width: 160, type: 'numericColumn', useValueFormatterForExport: false, valueFormatter: params => params.value === null ? 'No task' : String(params.value) },
  { field: 'modelAmountCents', headerName: 'Model amount · cents', width: 170, type: 'numericColumn', useValueFormatterForExport: false, valueFormatter: params => params.value === null ? 'Missing / ambiguous' : String(params.value) },
  { field: 'verdict', headerName: 'Kernel verdict', width: 140 },
  { field: 'failedChecks', headerName: 'Failed checks', minWidth: 245, wrapText: true, autoHeight: true },
  { field: 'expectedMatch', headerName: 'Expected outcome', width: 165, valueFormatter: params => params.value ? 'Matched' : 'Investigate' },
  { field: 'paymentSubmitted', headerName: 'Payment submission', width: 170, valueFormatter: params => params.value ? 'Submitted' : 'Not submitted' },
];

function claimedTarget(claims?: Record<string, unknown>): string {
  if (!claims) return 'No model response';
  const value = claims.kind === 'refund' ? claims.orderId : claims.kind === 'pay_invoice' ? claims.vendor : claims.kind === 'send_invoice' ? claims.customer : claims.disputeId;
  return typeof value === 'string' && value ? value : 'Missing target';
}

export default function JudgeEvaluationGrid({ cases, selectedCaseId, onSelectCase }: { cases: EvaluationLedgerCase[]; selectedCaseId: string; onSelectCase: (id: string) => void }) {
  const api = useRef<GridApi<EvaluationRow> | null>(null);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(cases.length);
  const rows = useMemo<EvaluationRow[]>(() => cases.map(value => ({ id: value.id, category: value.category, ownerAction: value.authorization?.kind ?? 'No task supplied', ownerTarget: value.authorization?.targetId ?? 'No task supplied', ownerMaximumCents: value.authorization?.maxAmountCents ?? null, modelAction: String(value.claims?.kind ?? 'No model response'), modelTarget: claimedTarget(value.claims), modelAmountCents: typeof value.claims?.amountCents === 'number' ? value.claims.amountCents : null, verdict: value.verdict ?? 'No decision', failedChecks: value.failedChecks?.join(', ') || 'None', expectedMatch: value.passed, paymentSubmitted: value.executionAttempted })), [cases]);
  useEffect(() => { api.current?.forEachNode(node => node.setSelected(node.data?.id === selectedCaseId)); }, [selectedCaseId]);
  const exportCsv = () => api.current?.exportDataAsCsv({ fileName: 'custody-real-model-evaluation.csv', exportedRows: 'filteredAndSorted', allColumns: true, processCellCallback: params => safeCsvCell(params.value) });

  return <section className="judge-eval-ledger" aria-labelledby="evaluation-ledger-title">
    <div className="judge-eval-ledger-heading"><div><h3 id="evaluation-ledger-title">The recorded evaluation ledger</h3><p>AG Grid Community · {cases.length} actual case records from this finite corpus. Selecting a row opens its evidence above.</p></div><div className="judge-eval-ledger-actions"><a className="button secondary" href="#judge-evaluation-case">View selected case</a><button className="button secondary" onClick={exportCsv}><Download size={14}/>Export filtered CSV</button></div></div>
    <label htmlFor="judge-evaluation-filter">SEARCH THESE RECORDED CASES</label>
    <div className="judge-eval-grid-search"><Search size={15}/><input id="judge-evaluation-filter" value={query} onChange={event => setQuery(event.target.value)} placeholder="Case, target, verdict, failed check…"/></div>
    <p className="judge-eval-grid-help" id="evaluation-ledger-help">Sort or filter a column to compare owner targets, actual model claims and held plans. Use arrow keys to navigate; Space selects a row. Horizontal scrolling reveals every column. Amounts are integer cents.</p>
    <div className="judge-eval-grid" aria-label="Read-only actual evaluation cases" aria-describedby="evaluation-ledger-help">
      <AgGridReact<EvaluationRow> theme={theme} rowData={rows} columnDefs={columns} defaultColDef={{ sortable: true, filter: true, resizable: true, editable: false }} quickFilterText={query} getRowId={params => params.data.id} rowSelection={{ mode: 'singleRow', enableClickSelection: true, checkboxes: false }} pagination paginationPageSize={8} paginationPageSizeSelector={[8, 16, 32]} onGridReady={event => { api.current = event.api; event.api.setGridAriaProperty('label', 'Recorded real-model evaluation ledger'); event.api.setGridAriaProperty('describedby', 'evaluation-ledger-help'); event.api.forEachNode(node => node.setSelected(node.data?.id === selectedCaseId)); setVisibleCount(event.api.getDisplayedRowCount()); }} onSelectionChanged={event => { const selected = event.api.getSelectedRows()[0]; if (selected) onSelectCase(selected.id); }} onFilterChanged={event => setVisibleCount(event.api.getDisplayedRowCount())} suppressExcelExport />
    </div>
    <p className="judge-eval-grid-count" role="status">{visibleCount} of {cases.length} recorded cases match. This ledger cannot send a payment or rerun a model.</p>
  </section>;
}

'use client';
import { AgGridReact, type AgGridReactProps } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import type { Decision } from './ui-types';
ModuleRegistry.registerModules([AllCommunityModule]);
export default function LedgerGrid({ night, ...props }: AgGridReactProps<Decision> & {
    night: boolean;
}) {
    return <AgGridReact<Decision> theme={themeQuartz.withParams({ backgroundColor: night ? '#17251f' : '#fffefa', foregroundColor: night ? '#eeeade' : '#263a31', headerBackgroundColor: night ? '#1d2e25' : '#f7f6f0', borderColor: night ? '#344238' : '#e7e7dd', fontFamily: 'DM Sans, sans-serif', fontSize: 12, rowHeight: 65, headerHeight: 45, wrapperBorderRadius: 0 })} {...props}/>;
}

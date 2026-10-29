import React from 'react';
import { createRoot } from 'react-dom/client';
import JudgeEvidence from '../app/judge-evidence';
import '../app/globals.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><JudgeEvidence /></React.StrictMode>);

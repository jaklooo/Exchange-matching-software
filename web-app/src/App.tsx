import { useState, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import './App.css';
import { readExcelSheet, getExcelSheets } from './utils/excel';
import {
  DEFAULT_CAP_COLS, DEFAULT_APP_COLS,
  step1_computeOccupancy,
  step2_filterDuplicates,
  step3_normalizeOrdering,
  step4_buildResultTable,
  step5_updateNominations,
  step6_resolveCycles,
} from './logic/allSteps';

const STEP_LABELS = ['Import', 'Filter', 'Poradie', 'Výber', 'Nominácie', 'Cykly'];

/* ──────────────────── DataTable with filter + export ──────────────────── */
function DataTable({ rows, maxRows = 500, title = 'data' }: { rows: any[]; maxRows?: number; title?: string }) {
  const [filters, setFilters] = useState<Record<string, string>>({});

  if (!rows.length) return <p className="text-muted mt-1">Žiadne dáta.</p>;
  const cols = Object.keys(rows[0]);

  const filtered = useMemo(() => {
    const activeFilters = Object.entries(filters).filter(([, v]) => v.trim() !== '');
    if (activeFilters.length === 0) return rows;
    return rows.filter(r =>
      activeFilters.every(([col, query]) =>
        String(r[col] ?? '').toLowerCase().includes(query.toLowerCase())
      )
    );
  }, [rows, filters]);

  const display = filtered.slice(0, maxRows);

  const setFilter = (col: string, val: string) =>
    setFilters(prev => ({ ...prev, [col]: val }));

  const exportXlsx = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(filtered);
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, `${title.replace(/\s+/g, '_')}.xlsx`);
  };

  return (
    <div>
      <div className="table-toolbar">
        <span className="table-count">
          {filtered.length === rows.length
            ? `${rows.length} riadkov`
            : `${filtered.length} z ${rows.length} riadkov`}
        </span>
        <button className="btn btn-sm btn-export" onClick={exportXlsx}>
          📥 Exportovať .xlsx
        </button>
      </div>
      <div className="table-wrapper" style={{ maxHeight: 480, overflowY: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>{cols.map(c => <th key={c}>{c}</th>)}</tr>
            <tr className="filter-row">
              {cols.map(c => (
                <th key={`f-${c}`} className="filter-cell">
                  <input
                    type="text"
                    placeholder="Filter…"
                    className="col-filter"
                    value={filters[c] || ''}
                    onChange={e => setFilter(c, e.target.value)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {display.map((r, i) => (
              <tr key={i}>{cols.map(c => <td key={c}>{String(r[c] ?? '')}</td>)}</tr>
            ))}
          </tbody>
        </table>
        {filtered.length > maxRows && (
          <p className="text-muted text-center mt-1">
            Zobrazených {maxRows} z {filtered.length} filtrovaných riadkov
          </p>
        )}
      </div>
    </div>
  );
}

/* ──────────────────── Main App ──────────────────── */
export default function App() {
  // Files
  const [capFile, setCapFile] = useState<File | null>(null);
  const [appFile, setAppFile] = useState<File | null>(null);

  // Sheet selection
  const [capSheets, setCapSheets] = useState<string[]>([]);
  const [appSheets, setAppSheets] = useState<string[]>([]);
  const [capSheet, setCapSheet] = useState('');
  const [appSheet, setAppSheet] = useState('');
  const [capHeader, setCapHeader] = useState(0);
  const [appHeader, setAppHeader] = useState(0);

  // Raw data
  const [capRaw, setCapRaw] = useState<any[]>([]);
  const [appRaw, setAppRaw] = useState<any[]>([]);

  // Workflow state
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [log, setLog] = useState<{ msg: string; ok: boolean }[]>([]);
  const [iteration, setIteration] = useState(1);
  const [finished, setFinished] = useState(false);

  // Data tables
  const [capAdj, setCapAdj] = useState<any[]>([]);
  const [working, setWorking] = useState<any[]>([]);
  const [result, setResult] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('working');

  const addLog = useCallback((msg: string, ok = true) => {
    setLog(prev => [...prev, { msg, ok }]);
  }, []);

  /* ──── File pick → detect sheets ──── */
  const handleCapFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setCapFile(f); setError(''); setCapRaw([]);
    try {
      const sheets = await getExcelSheets(f);
      setCapSheets(sheets);
      const defaultSheet = sheets[0];
      setCapSheet(defaultSheet);
      // auto-load first sheet
      const data = await readExcelSheet(f, defaultSheet, capHeader);
      setCapRaw(data);
      addLog(`Kapacity: ${data.length} riadkov z hárku "${defaultSheet}"`);
    } catch { setError('Chyba pri čítaní súboru kapacít.'); }
  };

  const handleAppFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setAppFile(f); setError(''); setAppRaw([]);
    try {
      const sheets = await getExcelSheets(f);
      setAppSheets(sheets);
      const defaultIdx = Math.min(2, sheets.length - 1);
      const defaultSheet = sheets[defaultIdx];
      setAppSheet(defaultSheet);
      const data = await readExcelSheet(f, defaultSheet, appHeader);
      setAppRaw(data);
      addLog(`Prihlášky: ${data.length} riadkov z hárku "${defaultSheet}"`);
    } catch { setError('Chyba pri čítaní súboru prihlášok.'); }
  };

  /* ──── Re-load when user changes sheet / header ──── */
  const reloadCap = async (sheet: string, header: number) => {
    if (!capFile) return;
    setCapSheet(sheet); setCapHeader(header);
    try {
      const data = await readExcelSheet(capFile, sheet, header);
      setCapRaw(data);
      addLog(`Kapacity znovu načítané: ${data.length} riadkov, hárok "${sheet}", hlavička riadok ${header}`);
    } catch { setError('Chyba pri čítaní hárku kapacít.'); }
  };

  const reloadApp = async (sheet: string, header: number) => {
    if (!appFile) return;
    setAppSheet(sheet); setAppHeader(header);
    try {
      const data = await readExcelSheet(appFile, sheet, header);
      setAppRaw(data);
      addLog(`Prihlášky znovu načítané: ${data.length} riadkov, hárok "${sheet}", hlavička riadok ${header}`);
    } catch { setError('Chyba pri čítaní hárku prihlášok.'); }
  };

  /* ──── Step runners ──── */
  const runStep = (n: number) => {
    setError('');
    try {
      if (n === 1) {
        const adj = step1_computeOccupancy(capRaw, appRaw, DEFAULT_CAP_COLS, DEFAULT_APP_COLS);
        setCapAdj(adj);
        setWorking(appRaw.map(r => ({ ...r })));
        addLog('Krok 1 hotový – obsadenosť vypočítaná.');
        setStep(1);
      } else if (n === 2) {
        const filtered = step2_filterDuplicates(working, DEFAULT_APP_COLS);
        addLog(`Krok 2 hotový – z ${working.length} → ${filtered.length} riadkov.`);
        setWorking(filtered); setStep(2);
      } else if (n === 3) {
        const norm = step3_normalizeOrdering(working, DEFAULT_APP_COLS);
        addLog('Krok 3 hotový – poradie prečíslované.');
        setWorking(norm); setStep(3);
      } else if (n === 4) {
        const sel = step4_buildResultTable(working, capAdj, DEFAULT_CAP_COLS, DEFAULT_APP_COLS);
        addLog(`Krok 4 hotový – vybraných ${sel.length} študentov.`);
        setResult(sel); setStep(4);
      } else if (n === 5) {
        const { updatedWork, updatedResult } = step5_updateNominations(working, result, DEFAULT_APP_COLS);
        addLog('Krok 5 hotový – nominácie aktualizované.');
        setWorking(updatedWork); setResult(updatedResult); setStep(5);
      } else if (n === 6) {
        const before = working.length;
        const resolved = step6_resolveCycles(working, capAdj, DEFAULT_CAP_COLS, DEFAULT_APP_COLS);
        const diff = before - resolved.length;
        if (diff > 0) {
          addLog(`Krok 6 (iterácia ${iteration}) – vymazaných ${diff} riadkov.`);
          setWorking(resolved); setIteration(p => p + 1); setStep(2);
        } else {
          addLog('Krok 6 hotový – žiadne ďalšie zmeny. HOTOVO! 🎉');
          setWorking(resolved); setFinished(true); setStep(6);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Neznáma chyba.');
    }
  };

  const runAll = () => {
    setError('');
    try {
      let adj = step1_computeOccupancy(capRaw, appRaw, DEFAULT_CAP_COLS, DEFAULT_APP_COLS);
      setCapAdj(adj);
      let w = appRaw.map(r => ({ ...r }));
      addLog('Krok 1 hotový.');

      w = step2_filterDuplicates(w, DEFAULT_APP_COLS);
      addLog(`Krok 2 hotový (${w.length} riadkov).`);

      let iter = 1; let done = false; let res: any[] = [];
      while (!done) {
        w = step3_normalizeOrdering(w, DEFAULT_APP_COLS);
        addLog(`Krok 3 (it. ${iter}) hotový.`);

        const sel = step4_buildResultTable(w, adj, DEFAULT_CAP_COLS, DEFAULT_APP_COLS);
        addLog(`Krok 4 (it. ${iter}) – ${sel.length} vybraných.`);

        const { updatedWork, updatedResult } = step5_updateNominations(w, sel, DEFAULT_APP_COLS);
        w = updatedWork; res = updatedResult;
        addLog(`Krok 5 (it. ${iter}) hotový.`);

        const before = w.length;
        w = step6_resolveCycles(w, adj, DEFAULT_CAP_COLS, DEFAULT_APP_COLS);
        if (before - w.length > 0) {
          addLog(`Krok 6 (it. ${iter}) – vymazaných ${before - w.length} riadkov.`);
          iter++;
        } else { done = true; addLog(`Krok 6 (it. ${iter}) – HOTOVO! 🎉`); }
      }

      setWorking(w); setResult(res); setIteration(iter); setFinished(true); setStep(6);
    } catch (err: any) { setError(err?.message || 'Chyba.'); }
  };

  const nextStepNum = step === 0 ? 1 : step + 1;
  const stepLabels: Record<number, string> = {
    1: 'Krok 1 – Výpočet obsadenosti',
    2: 'Krok 2 – Filter duplicít',
    3: `Krok 3 – Prečíslovanie poradia${iteration > 1 ? ` (it. ${iteration})` : ''}`,
    4: `Krok 4 – Výber podľa kapacity${iteration > 1 ? ` (it. ${iteration})` : ''}`,
    5: `Krok 5 – Aktualizácia nominácií${iteration > 1 ? ` (it. ${iteration})` : ''}`,
    6: `Krok 6 – Riešenie cyklov${iteration > 1 ? ` (it. ${iteration})` : ''}`,
  };

  /* ──────────────────── RENDER ──────────────────── */
  return (
    <>
      <header className="app-header">
        <h1>Nominácie Študentov</h1>
        <p>Bezpečné spracovanie priamo v prehliadači</p>
        <div className="badges">
          <span className="badge badge-green">GDPR</span>
          <span className="badge badge-blue">Offline</span>
        </div>
      </header>

      <div className="glass" style={{ padding: '2rem' }}>

        {/* Stepper */}
        <div className="stepper">
          <div className="stepper-line" />
          {STEP_LABELS.map((label, i) => {
            const n = i + 1;
            const cls = finished ? 'done' : n < nextStepNum ? 'done' : n === nextStepNum - 1 + 1 && step > 0 ? 'active' : 'pending';
            return (
              <div key={n} className={`step-dot ${cls}`}>
                {n < nextStepNum || finished ? '✓' : n}
                <span className="step-label">{label}</span>
              </div>
            );
          })}
        </div>

        {error && <div className="error-bar">⚠️ {error}</div>}

        {/* ─── STEP 0: Upload ─── */}
        {step === 0 && (
          <>
            <div className="upload-row">
              <label className={`upload-card ${capFile ? 'done' : ''}`}>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleCapFile} />
                <svg className="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                <h3>1. Kapacity</h3>
                <p>{capFile ? capFile.name : 'Nahrať tabuľku kapacít (.xlsx)'}</p>
              </label>

              <label className={`upload-card ${appFile ? 'done' : ''}`}>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleAppFile} />
                <svg className="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="18" rx="2" /><line x1="8" y1="3" x2="8" y2="21" /><line x1="2" y1="9" x2="22" y2="9" /><line x1="2" y1="15" x2="22" y2="15" /></svg>
                <h3>2. Prihlášky</h3>
                <p>{appFile ? appFile.name : 'Nahrať tabuľku prihlášok (.xlsx)'}</p>
              </label>
            </div>

            {/* ─── Sheet / header selection ─── */}
            {(capSheets.length > 0 || appSheets.length > 0) && (
              <div className="sheet-selectors mt-3">
                {capSheets.length > 1 && (
                  <div className="sheet-row glass" style={{ padding: '1rem 1.25rem', marginBottom: '.75rem' }}>
                    <strong style={{ color: '#2563eb', fontSize: '.85rem' }}>Kapacity – nastavenie</strong>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <label style={{ fontSize: '.82rem', color: '#94a3b8' }}>
                        Hárok:
                        <select
                          value={capSheet}
                          onChange={(e) => reloadCap(e.target.value, capHeader)}
                          className="sheet-select"
                        >
                          {capSheets.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label style={{ fontSize: '.82rem', color: '#94a3b8' }}>
                        Riadok hlavičky:
                        <input
                          type="number" min={0} value={capHeader}
                          onChange={(e) => reloadCap(capSheet, parseInt(e.target.value) || 0)}
                          className="header-input"
                        />
                      </label>
                    </div>
                  </div>
                )}
                {appSheets.length > 1 && (
                  <div className="sheet-row glass" style={{ padding: '1rem 1.25rem', marginBottom: '.75rem' }}>
                    <strong style={{ color: '#7c3aed', fontSize: '.85rem' }}>Prihlášky – nastavenie</strong>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <label style={{ fontSize: '.82rem', color: '#94a3b8' }}>
                        Hárok:
                        <select
                          value={appSheet}
                          onChange={(e) => reloadApp(e.target.value, appHeader)}
                          className="sheet-select"
                        >
                          {appSheets.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label style={{ fontSize: '.82rem', color: '#94a3b8' }}>
                        Riadok hlavičky:
                        <input
                          type="number" min={0} value={appHeader}
                          onChange={(e) => reloadApp(appSheet, parseInt(e.target.value) || 0)}
                          className="header-input"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ─── Data preview ─── */}
            {capRaw.length > 0 && (
              <div className="mt-3">
                <h4 style={{ color: '#2563eb', marginBottom: '.5rem', textAlign: 'left' }}>
                  📋 Kapacity – náhľad ({capRaw.length} riadkov, {Object.keys(capRaw[0]).length} stĺpcov)
                </h4>
                <DataTable rows={capRaw} maxRows={15} title="Kapacity nahlad" />
              </div>
            )}
            {appRaw.length > 0 && (
              <div className="mt-3">
                <h4 style={{ color: '#7c3aed', marginBottom: '.5rem', textAlign: 'left' }}>
                  📋 Prihlášky – náhľad ({appRaw.length} riadkov, {Object.keys(appRaw[0]).length} stĺpcov)
                </h4>
                <DataTable rows={appRaw} maxRows={15} title="Prihlasky nahlad" />
              </div>
            )}

            <div className="flex-center mt-4" style={{ gap: '1rem' }}>
              <button className="btn btn-primary" disabled={!capFile || !appFile} onClick={() => runStep(1)}>
                ▶ Spustiť Krok 1
              </button>
              <button className="btn btn-auto" disabled={!capFile || !appFile} onClick={runAll}>
                🚀 Spustiť Všetko
              </button>
            </div>
          </>
        )}

        {/* ─── FINISHED ─── */}
        {finished && (
          <div className="finished-banner">
            <div style={{ fontSize: '3rem' }}>🎉</div>
            <h2>Rozraďovanie dokončené!</h2>
            <p className="text-muted">Všetky iterácie spracované. Výsledky nižšie.</p>
          </div>
        )}

        {/* ─── STEPS 1-6 (not finished yet) ─── */}
        {step > 0 && !finished && (
          <div className="step-result">
            <h2>{stepLabels[step]}</h2>
            <p className="text-muted">Krok {step} dokončený.</p>
            <div className="stat-grid">
              <div className="stat-card"><div className="val">{working.length}</div><div className="lbl">Pracovný hárok</div></div>
              {result.length > 0 && <div className="stat-card"><div className="val">{result.length}</div><div className="lbl">Vybraní</div></div>}
              <div className="stat-card"><div className="val">{capAdj.length}</div><div className="lbl">Inštitúty</div></div>
            </div>
            <div className="flex-center mt-3">
              <button className="btn btn-primary" onClick={() => runStep(nextStepNum)}>
                ▶ {stepLabels[nextStepNum] || 'Ďalší krok'}
              </button>
            </div>
          </div>
        )}

        {/* ─── DATA TABS ─── */}
        {step > 0 && (
          <div className="mt-4">
            <div className="tabs">
              <button className={`tab ${activeTab === 'capOrig' ? 'active' : ''}`} onClick={() => setActiveTab('capOrig')}>Kapacity (vstup)</button>
              <button className={`tab ${activeTab === 'capAdj' ? 'active' : ''}`} onClick={() => setActiveTab('capAdj')}>Kapacity (obsadenosť)</button>
              <button className={`tab ${activeTab === 'appOrig' ? 'active' : ''}`} onClick={() => setActiveTab('appOrig')}>Prihlášky (vstup)</button>
              <button className={`tab ${activeTab === 'working' ? 'active' : ''}`} onClick={() => setActiveTab('working')}>Pracovný hárok</button>
              <button className={`tab ${activeTab === 'result' ? 'active' : ''}`} onClick={() => setActiveTab('result')}>Výsledky</button>
            </div>
            {activeTab === 'capOrig' && <DataTable rows={capRaw} title="Kapacity vstup" />}
            {activeTab === 'capAdj' && <DataTable rows={capAdj} title="Kapacity obsadenost" />}
            {activeTab === 'appOrig' && <DataTable rows={appRaw} title="Prihlasky vstup" />}
            {activeTab === 'working' && <DataTable rows={working} title="Pracovny harok" />}
            {activeTab === 'result' && (result.length > 0 ? <DataTable rows={result} title="Vysledky" /> : <p className="text-muted">Výsledky budú po kroku 4.</p>)}
          </div>
        )}

        {/* ─── LOG ─── */}
        {log.length > 0 && (
          <div className="log glass mt-3">
            {log.map((entry, i) => (
              <div key={i} className={`log-entry ${entry.ok ? 'success' : ''}`}>
                {entry.ok ? '✅' : '❌'} {entry.msg}
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="text-center text-muted mt-4">
        Dáta sa spracovávajú výlučne vo vašom prehliadači. Žiadne údaje neopúšťajú zariadenie.
      </footer>
    </>
  );
}

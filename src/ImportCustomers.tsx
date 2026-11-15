// Import customers (docs/progress/customer-import.md, D2): Leads page -> "Import customers" (managers + Business Admin).
// Upload (CSV or Excel, read in this browser) -> map columns -> options + consent -> check (nothing saved) ->
// import in parts of 500 (progress, Stop, rejected rows file) -> history with Undo for 7 days.
// The server re-checks everything and enforces the plan limits; this screen only shows them.
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, History, Lock, Square, Undo2, Upload } from 'lucide-react';
import { api, errorMessage, inputCls, inputInlineCls } from './broadcastUtils';
import { refreshApi, useApi } from './queryClient';
import { useConfirm } from './confirm';
import { BUTTON, EmptyState, LoadError, Modal, SkeletonRows } from './ui';
import { BATCH, MAX_PART_BYTES, splitParts, autoMap, distinctValues, draftKey, looksMedical, readSheet, rejectedCsv, toPayload, type CustomField, type CustomFieldType, type Sheet, type Target } from './importUtils';
import type { ShowToast } from './types';

interface Limits { planName: string; rowsPerFile: number | null; fileMb: number | null; rowsMonth: number | null; monthLeft: number | null; contactsLeft: number | null; newLeft: number | null; newLeftReason: string }
interface ImportRow {
  id: string; fileName: string; fileRows: number; rowFrom: number; rowTo: number; status: 'running' | 'done' | 'stopped' | 'undone'; mode: string; tag: string;
  created: number; updated: number; skipped: number; rejected: number; by: string; createdAt: string; canUndo: boolean; undoUntil: string;
  undoResult: { removed: number; restored: number; kept: number; changedSince?: number } | null;
}
interface ImportsResponse { ready: boolean; imports: ImportRow[]; limits: Limits | null; undoDays?: number }
interface FieldsResponse { ready: boolean; fields: CustomField[]; max: number | null }
type Kind = 'new' | 'existing' | 'unchanged' | 'skip' | 'invalid' | 'duplicate' | 'over_limit';
interface RowResult { row: number; phone?: string; kind: Kind; stop?: boolean; reason?: string }

const TYPE_LABEL: Record<CustomFieldType, string> = { text: 'Text', number: 'Number', amount: 'Amount (₹)', date: 'Date', choice: 'Choice', yesno: 'Yes / No' };
const KIND_LABEL: Record<Kind, string> = {
  new: 'New people', existing: 'Already in your CRM (will be updated)', unchanged: 'Already in your CRM, nothing new', skip: 'Already in your CRM (skipped)',
  invalid: 'Invalid (see the reason)', duplicate: 'Same number twice in the file', over_limit: 'Over your plan limit',
};
const fmt = (n: number) => n.toLocaleString('en-IN');

export default function ImportCustomers({ onClose, showToast, isHospital }: { onClose: () => void; showToast: ShowToast; isHospital: boolean }) {
  const [tab, setTab] = useState<'import' | 'history'>('import');
  const imports = useApi<ImportsResponse>('/api/imports');
  return (
    <Modal title="Import customers" onClose={onClose} wide>
      <div className="flex gap-1.5 mb-3" role="tablist" aria-label="Import">
        {([['import', 'New import', Upload], ['history', 'History and undo', History]] as const).map(([k, l, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 cursor-pointer ${tab === k ? 'bg-wa-teal text-white' : 'bg-white text-slate-600 border border-slate-200'}`}><Icon className="w-3.5 h-3.5" />{l}</button>
        ))}
      </div>
      {imports.error ? <LoadError error={imports.error.message} onRetry={() => imports.refetch()} />
        : !imports.data ? <SkeletonRows rows={3} label="Loading imports" />
          : !imports.data.ready ? <EmptyState icon={FileSpreadsheet} title="Not ready yet" text="Importing needs a database update (SQL 20261142). Ask the platform team." />
            : tab === 'import' ? <Wizard limits={imports.data.limits} history={imports.data.imports} showToast={showToast} isHospital={isHospital} onDone={() => { void imports.refetch(); }} onHistory={() => setTab('history')} />
              : <ImportHistory list={imports.data.imports} undoDays={imports.data.undoDays || 7} showToast={showToast} onChanged={() => { void imports.refetch(); }} />}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The wizard
// ---------------------------------------------------------------------------
type Step = 'upload' | 'map' | 'options' | 'check' | 'import';

function Wizard({ limits, history, showToast, isHospital, onDone, onHistory }: { limits: Limits | null; history: ImportRow[]; showToast: ShowToast; isHospital: boolean; onDone: () => void; onHistory: () => void }) {
  const fieldsQ = useApi<FieldsResponse>('/api/customer-fields');
  const fields = useMemo(() => fieldsQ.data?.fields || [], [fieldsQ.data]);
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [readError, setReadError] = useState('');
  const [reading, setReading] = useState(false);
  const [from, setFrom] = useState(1);
  const [map, setMap] = useState<Target[]>([]);
  const [mode, setMode] = useState<'fill' | 'overwrite' | 'skip'>('fill');
  const [tag, setTag] = useState('');
  const [consent, setConsent] = useState(false);
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);
  const [checkError, setCheckError] = useState('');
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [run, setRun] = useState<{ done: number; total: number; created: number; updated: number; skipped: number; rejected: Array<{ row: number; reason: string }>; finished: boolean; stopped: boolean; error: string } | null>(null);
  const stopRef = useRef(false);

  const perFile = limits?.rowsPerFile ?? null;
  const total = sheet?.rows.length || 0;
  const to = sheet ? Math.min(total, perFile ? from + perFile - 1 : total) : 0;
  const chosen = sheet ? Math.max(0, to - from + 1) : 0;
  const tooBig = !!(file && limits?.fileMb && file.size > limits.fileMb * 1024 * 1024);
  // An earlier import of the same file that stopped at the plan's limit: offer to continue after it.
  const previous = file ? history.find(h => h.fileName === file.name && h.status !== 'undone' && h.rowTo < h.fileRows) : undefined;

  const choose = async (f: File | null) => {
    setFile(f); setSheet(null); setReadError(''); setResults(null); setRun(null); setFrom(1);
    if (!f) return;
    if (limits?.fileMb && f.size > limits.fileMb * 1024 * 1024) { setReadError(`This file is ${(f.size / 1048576).toFixed(1)} MB; your ${limits.planName} plan allows ${limits.fileMb} MB per file. Split it into smaller files.`); return; }
    setReading(true);
    const s = await readSheet(f);
    setReading(false);
    if ('error' in s) { setReadError(s.error); return; }
    setSheet(s);
    setMap(autoMap(s, fields));
  };

  // New fields: draft keys (the server keeps them when free) and the payload rows.
  const newFields = useMemo(() => {
    const taken = new Set(fields.map(f => f.key));
    return map.map((t, col) => (t.kind === 'new' ? { col, key: draftKey(t.label, taken), label: t.label, type: t.type, options: t.type === 'choice' ? (t.options.length ? t.options : distinctValues((sheet?.rows || []).map(r => r[col] || ''))) : [], private: t.private } : null)).filter(Boolean) as Array<{ col: number; key: string; label: string; type: CustomFieldType; options: string[]; private: boolean }>;
  }, [map, fields, sheet]);
  // New fields: the dry run uses the draft keys; the import uses the keys the server saved (keyMap), never a draft key.
  const keyFor = (keyMap: Record<string, string> | null) => (t: Target, col: number) => {
    if (t.kind === 'field') return t.key;
    if (t.kind !== 'new') return null;
    const draft = newFields.find(n => n.col === col)?.key || '';
    return keyMap ? keyMap[draft] || null : draft || null;
  };
  const rowsOf = (keyMap: Record<string, string> | null = null) => (sheet ? Array.from({ length: chosen }, (_, i) => toPayload(sheet, map, from - 1 + i, keyFor(keyMap))) : []);
  const fieldDefs = newFields.map(({ key, label, type, options, private: p }) => ({ key, label, type, options, private: p }));

  const phoneCols = map.filter(t => t.kind === 'phone').length;
  const mapProblem = phoneCols !== 1 ? 'Choose exactly one column as the phone number.'
    : newFields.some(n => !n.label.trim()) ? 'Give every new field a name.'
      : new Set(newFields.map(n => n.label.trim().toLowerCase())).size !== newFields.length ? 'Two new fields have the same name.'
        : newFields.some(n => fields.some(f => f.label.toLowerCase() === n.label.trim().toLowerCase())) ? 'A new field has the name of an existing field: map the column to that field instead.'
          : fieldsQ.data?.max != null && fields.length + newFields.length > fieldsQ.data.max ? `Your plan allows ${fieldsQ.data.max} customer fields (you have ${fields.length}). Skip some columns or map them to existing fields.` : '';

  // Dry run: every chosen row checked by the server in parts of 500. Nothing is saved.
  const runCheck = async () => {
    setStep('check'); setCheckError(''); setResults(null); setWarnings([]);
    const rows = rowsOf();
    const all: RowResult[] = [];
    setChecking({ done: 0, total: rows.length });
    try {
      let done = 0;
      const notes = new Set<string>();
      for (const part of splitParts(rows, BATCH, MAX_PART_BYTES)) {
        const r = await api<{ results: RowResult[]; warnings?: string[] }>('/api/imports/check', { method: 'POST', body: { rows: part, newFields: fieldDefs, options: { mode, tag } } });
        all.push(...r.results);
        for (const w of r.warnings || []) notes.add(w);
        done += part.length;
        setChecking({ done, total: rows.length });
      }
      setWarnings([...notes]);
    } catch (e) { setCheckError(errorMessage(e)); setChecking(null); return; }
    // Across parts: the same number twice, and the plan limit for the whole file.
    const seen = new Set<string>();
    let newCount = 0;
    const left = limits?.newLeft ?? null;
    for (const r of all) {
      if (r.phone && (r.kind === 'new' || r.kind === 'over_limit' || r.kind === 'existing' || r.kind === 'unchanged' || r.kind === 'skip')) {
        if (seen.has(r.phone)) { Object.assign(r, { kind: 'duplicate', reason: 'The same number is on an earlier row of the file.' }); continue; }
        seen.add(r.phone);
      }
      if (r.kind === 'new' || r.kind === 'over_limit') {
        if (left !== null && newCount >= left) Object.assign(r, { kind: 'over_limit', reason: 'Over your plan\'s limit for new people.' });
        else { r.kind = 'new'; newCount++; }
      }
    }
    setResults(all);
    setChecking(null);
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of results || []) { c[r.kind] = (c[r.kind] || 0) + 1; if (r.stop) c.stop = (c.stop || 0) + 1; }
    return c;
  }, [results]);

  // The import: start, then parts of 500, then finish. Stop ends after the current part.
  const runImport = async () => {
    if (!file || !sheet) return;
    setStep('import'); stopRef.current = false;
    const state = { done: 0, total: chosen, created: 0, updated: 0, skipped: 0, rejected: [] as Array<{ row: number; reason: string }>, finished: false, stopped: false, error: '' };
    setRun({ ...state });
    let id = '';
    try {
      const s = await api<{ import: { id: string }; keyMap: Record<string, string> }>('/api/imports/start', {
        method: 'POST', body: { fileName: file.name, fileRows: total, fileBytes: file.size, rowFrom: from, rowTo: to, options: { mode, tag }, consent, newFields: fieldDefs },
      });
      id = s.import.id;
      const keyMap = s.keyMap || {};
      const missing = newFields.filter(n => !keyMap[n.key]);
      if (missing.length) throw new Error(`The field "${missing[0].label}" was not created. Nothing was imported; try again.`);
      const rows = rowsOf(keyMap);
      for (const part of splitParts(rows, BATCH, MAX_PART_BYTES)) {
        if (stopRef.current) { state.stopped = true; break; }
        const b = await api<{ created: number; updated: number; skipped: number; rejected: Array<{ row: number; reason?: string }> }>(`/api/imports/${id}/batch`, { method: 'POST', body: { rows: part } });
        state.done += part.length; state.created += b.created; state.updated += b.updated; state.skipped += b.skipped;
        state.rejected.push(...b.rejected.map(x => ({ row: x.row, reason: x.reason || 'Rejected' })));
        setRun({ ...state });
      }
    } catch (e) { state.error = errorMessage(e); }
    if (id) { try { await api(`/api/imports/${id}/finish`, { method: 'POST', body: { stopped: state.stopped || !!state.error } }); } catch { /* the server closes it after 30 minutes */ } }
    state.finished = true;
    setRun({ ...state });
    await Promise.all([refreshApi('/api/leads'), refreshApi('/api/customer-fields'), refreshApi('/api/business/usage')]);
    onDone();
    if (!state.error) showToast(`Imported: ${fmt(state.created)} new, ${fmt(state.updated)} updated`);
  };

  const downloadRejected = () => {
    if (!sheet || !run) return;
    const csv = rejectedCsv(sheet.headers, run.rejected.map(r => ({ cells: sheet.rows[r.row - 1] || [], reason: r.reason })));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `rejected-${(file?.name || 'import').replace(/\.(csv|xlsx)$/i, '')}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const steps: Array<[Step, string]> = [['upload', '1. File'], ['map', '2. Columns'], ['options', '3. Options'], ['check', '4. Check'], ['import', '5. Import']];
  return (
    <div className="space-y-3" data-testid="import-wizard">
      <ol className="flex flex-wrap gap-1 text-xs" aria-label="Steps">
        {steps.map(([k, l]) => <li key={k} className={`px-2 py-1 rounded-full ${step === k ? 'bg-slate-800 text-white font-semibold' : 'bg-slate-100 text-slate-500'}`} aria-current={step === k ? 'step' : undefined}>{l}</li>)}
      </ol>

      {step === 'upload' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Upload an Excel (.xlsx) or CSV file with one customer per row and a header row. The file is read in your browser; only the columns you choose are sent.</p>
          {limits && (
            <ul className="text-xs text-slate-500 list-disc pl-4" data-testid="import-limits">
              {limits.rowsPerFile != null && <li>Up to {fmt(limits.rowsPerFile)} rows per upload{limits.fileMb != null ? `, ${limits.fileMb} MB per file` : ''}.</li>}
              {limits.newLeft != null && <li>{fmt(limits.newLeft)} more new people can be added this month. {limits.newLeftReason}</li>}
            </ul>
          )}
          {isHospital && <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex gap-2"><AlertTriangle className="w-4 h-4 flex-shrink-0" /> Hospitals: don't upload diagnoses, medicines or reports. Name, number, visit dates and the doctor are enough.</div>}
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Customer file (.xlsx or .csv)</span>
            <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => void choose(e.target.files?.[0] || null)} className="block mt-1 text-sm" aria-label="Customer file" />
          </label>
          {reading && <SkeletonRows rows={2} label="Reading the file" />}
          {readError && <div role="alert" className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{readError}</div>}
          {sheet && !tooBig && (
            <div className="space-y-2">
              <div className="text-sm text-slate-700" data-testid="file-summary"><span className="font-semibold">{file?.name}</span>: {fmt(total)} customer rows, {sheet.headers.length} columns.</div>
              {perFile != null && total > perFile && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900 space-y-2" data-testid="over-file-limit">
                  <p>Your file has {fmt(total)} rows; your plan allows {fmt(perFile)} per upload. Rows {fmt(from)}–{fmt(to)} now; then upload the same file again and choose <b>Continue from row {fmt(to + 1)}</b>. People already imported are matched by number and not counted twice.</p>
                  <label className="flex items-center gap-2 text-xs">Start from row
                    <input type="number" min={1} max={total} value={from} onChange={e => setFrom(Math.min(Math.max(1, Number(e.target.value) || 1), total))} className={`${inputInlineCls} w-28`} aria-label="Start from row" />
                  </label>
                  {previous && previous.rowTo + 1 !== from && previous.rowTo < total && (
                    <button onClick={() => setFrom(previous.rowTo + 1)} className={BUTTON.secondary} data-testid="continue-from">Continue from row {fmt(previous.rowTo + 1)}</button>
                  )}
                </div>
              )}
              <button onClick={() => setStep('map')} disabled={!chosen} className={BUTTON.primary}>Next: columns</button>
            </div>
          )}
        </div>
      )}

      {step === 'map' && sheet && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">Say what each column is. Phone is required; matching is by phone number only. Columns you don't need: Skip.</p>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {sheet.headers.map((h, col) => (
              <ColumnRow key={col} header={h} samples={sheet.rows.slice(from - 1, from + 2).map(r => r[col] || '')} target={map[col]} fields={fields} isHospital={isHospital}
                onChange={t => setMap(m => m.map((x, i) => (i === col ? t : x)))} />
            ))}
          </div>
          {mapProblem && <p role="alert" className="text-xs text-red-700">{mapProblem}</p>}
          <div className="flex gap-2">
            <button onClick={() => setStep('upload')} className={BUTTON.secondary}>Back</button>
            <button onClick={() => setStep('options')} disabled={!!mapProblem} className={BUTTON.primary}>Next: options</button>
          </div>
        </div>
      )}

      {step === 'options' && (
        <div className="space-y-3">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-semibold text-slate-700 mb-1">People already in your CRM (same number)</legend>
            {([['fill', 'Fill empty fields only (recommended)', 'Nothing your team typed is changed.'], ['overwrite', 'Overwrite with the file', 'Values in the file replace what is saved (empty cells never erase).'], ['skip', 'Skip them', 'Only new people are added.']] as const).map(([k, l, help]) => (
              <label key={k} className="flex items-start gap-2 text-sm cursor-pointer"><input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} className="mt-1" /> <span><span className="font-medium text-slate-800">{l}</span><span className="block text-xs text-slate-500">{help}</span></span></label>
            ))}
          </fieldset>
          <label className="block max-w-xs">
            <span className="text-xs font-semibold text-slate-600">Tag for this import (optional)</span>
            <input value={tag} onChange={e => setTag(e.target.value.slice(0, 30))} placeholder="e.g. loans-nov" className={inputCls} aria-label="Import tag" />
          </label>
          <label className="flex items-start gap-2 text-sm bg-slate-50 border border-slate-200 rounded-lg p-2.5 cursor-pointer">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1" aria-label="Consent" />
            <span>These people agreed to hear from our business on WhatsApp. <span className="text-xs text-slate-500 block">Required. Importing is not permission to message: Meta requires opt-in, and people who replied STOP stay blocked.</span></span>
          </label>
          <div className="flex gap-2">
            <button onClick={() => setStep('map')} className={BUTTON.secondary}>Back</button>
            <button onClick={() => void runCheck()} disabled={!consent} className={BUTTON.primary} data-testid="run-check">Check the file (nothing is saved)</button>
          </div>
        </div>
      )}

      {step === 'check' && (
        <div className="space-y-3">
          {checking && (
            <div className="space-y-2">
              <Progress done={checking.done} total={checking.total} label="Checking" />
              <SkeletonRows rows={2} label="Checking the file" />
            </div>
          )}
          {checkError && <LoadError error={checkError} onRetry={() => void runCheck()} />}
          {results && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="check-counts">
                {(['new', 'existing', 'unchanged', 'skip', 'invalid', 'duplicate', 'over_limit'] as Kind[]).filter(k => counts[k]).map(k => (
                  <div key={k} className={`border rounded-xl p-2.5 ${k === 'new' || k === 'existing' ? 'bg-emerald-50 border-emerald-200' : k === 'invalid' || k === 'over_limit' ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`} data-testid={`count-${k}`}>
                    <div className="text-lg font-bold text-slate-800">{fmt(counts[k])}</div>
                    <div className="text-xs text-slate-600">{KIND_LABEL[k]}</div>
                  </div>
                ))}
                {!!counts.stop && <div className="border rounded-xl p-2.5 bg-amber-50 border-amber-200" data-testid="count-stop"><div className="text-lg font-bold text-slate-800">{fmt(counts.stop)}</div><div className="text-xs text-slate-600">Replied STOP before: added, but never sent offers</div></div>}
              </div>
              {counts.over_limit > 0 && limits?.newLeftReason && <p className="text-xs text-red-700">{limits.newLeftReason}</p>}
              {warnings.map(w => <p key={w} className="text-xs text-amber-800" data-testid="check-warning">{w}</p>)}
              <Samples results={results} />
              <div className="flex gap-2">
                <button onClick={() => setStep('options')} className={BUTTON.secondary}>Back</button>
                <button onClick={() => void runImport()} disabled={!(counts.new || counts.existing)} className={BUTTON.primary} data-testid="run-import">
                  <Upload className="w-3.5 h-3.5" /> Import {fmt((counts.new || 0) + (counts.existing || 0))} people
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 'import' && run && (
        <div className="space-y-3" data-testid="import-run">
          <Progress done={run.done} total={run.total} label={run.finished ? (run.stopped ? 'Stopped' : run.error ? 'Stopped by a problem' : 'Done') : 'Importing'} />
          <div className="text-sm text-slate-700" data-testid="import-result">{fmt(run.created)} new · {fmt(run.updated)} updated · {fmt(run.skipped)} unchanged · {fmt(run.rejected.length)} rejected</div>
          {run.error && <div role="alert" className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{run.error}</div>}
          <div className="flex flex-wrap gap-2">
            {!run.finished && <button onClick={() => { stopRef.current = true; }} className={BUTTON.secondary}><Square className="w-3.5 h-3.5" /> Stop after this part</button>}
            {run.finished && run.rejected.length > 0 && <button onClick={downloadRejected} className={BUTTON.secondary} data-testid="download-rejected"><Download className="w-3.5 h-3.5" /> Rejected rows ({fmt(run.rejected.length)})</button>}
            {run.finished && <button onClick={onHistory} className={BUTTON.quiet}><History className="w-3.5 h-3.5" /> History and undo</button>}
            {run.finished && to < total && <span className="text-xs text-slate-600 self-center">Next: upload the same file and continue from row {fmt(to + 1)}.</span>}
          </div>
          {run.finished && !run.error && <p className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> New people are on the Leads page (filter "Imported, not chatted yet"). They join the Inbox when they write to you.</p>}
        </div>
      )}
    </div>
  );
}

function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 100;
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-600 mb-1"><span>{label}</span><span>{fmt(done)} / {fmt(total)}</span></div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-2 bg-wa-teal motion-safe:transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** A few rows of each problem kind, with the reason. */
function Samples({ results }: { results: RowResult[] }) {
  const groups = (['invalid', 'duplicate', 'over_limit'] as Kind[]).map(k => [k, results.filter(r => r.kind === k).slice(0, 3)] as const).filter(([, l]) => l.length);
  if (!groups.length) return null;
  return (
    <div className="space-y-1 text-xs" data-testid="check-samples">
      {groups.map(([k, list]) => list.map(r => <div key={`${k}-${r.row}`} className="text-slate-600">Row {fmt(r.row)}: <span className="text-red-700">{r.reason || KIND_LABEL[k]}</span></div>))}
    </div>
  );
}

/** One column: its header, a few values, and where it goes. */
function ColumnRow({ header, samples, target, fields, isHospital, onChange }: { header: string; samples: string[]; target: Target; fields: CustomField[]; isHospital: boolean; onChange: (t: Target) => void }) {
  const value = target.kind === 'field' ? `field:${target.key}` : target.kind;
  const pick = (v: string) => {
    if (v.startsWith('field:')) onChange({ kind: 'field', key: v.slice(6) });
    else if (v === 'new') onChange({ kind: 'new', label: header.slice(0, 60), type: 'text', private: false, options: [] });
    else onChange({ kind: v } as Target);
  };
  return (
    <div className="border border-slate-200 rounded-lg p-2.5 space-y-1.5" data-testid="map-column">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-800 truncate">{header}</div>
          <div className="text-xs text-slate-500 truncate">{samples.filter(Boolean).join(' · ') || '(empty)'}</div>
        </div>
        <select value={value} onChange={e => pick(e.target.value)} className={inputInlineCls} aria-label={`Column ${header}`}>
          <option value="skip">Skip</option>
          <option value="phone">Phone number</option><option value="name">Name</option><option value="status">Status</option>
          <option value="source">Source</option><option value="tags">Tags</option><option value="assignedTo">Assigned to (email)</option>
          {fields.length > 0 && <optgroup label="Your customer fields">{fields.map(f => <option key={f.key} value={`field:${f.key}`}>{f.label}</option>)}</optgroup>}
          <option value="new">New customer field…</option>
        </select>
      </div>
      {target.kind === 'new' && (
        <div className="flex flex-wrap items-center gap-2 pl-2 border-l-2 border-teal-200">
          <input value={target.label} onChange={e => onChange({ ...target, label: e.target.value.slice(0, 60) })} className={`${inputInlineCls} w-44`} aria-label={`New field name for ${header}`} />
          <select value={target.type} onChange={e => onChange({ ...target, type: e.target.value as CustomFieldType })} className={inputInlineCls} aria-label={`Type for ${header}`}>
            {(Object.keys(TYPE_LABEL) as CustomFieldType[]).map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={target.private} onChange={e => onChange({ ...target, private: e.target.checked })} aria-label={`Private ${header}`} /> <Lock className="w-3 h-3" /> Private (agents can't see it)</label>
          {target.type === 'choice' && <span className="text-xs text-slate-500">Choices: {target.options.slice(0, 6).join(', ') || 'from the file'}{target.options.length > 6 ? '…' : ''}</span>}
          {isHospital && looksMedical(header) && <span className="text-xs text-amber-800 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Looks medical: better Skip it.</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History + Undo
// ---------------------------------------------------------------------------
function ImportHistory({ list, undoDays, showToast, onChanged }: { list: ImportRow[]; undoDays: number; showToast: ShowToast; onChanged: () => void }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState('');
  if (!list.length) return <EmptyState icon={History} title="No imports yet" text="Imports appear here with their counts. You can undo one for 7 days." />;
  const undo = async (i: ImportRow) => {
    const ok = await confirm({ title: `Undo "${i.fileName}"?`, body: `Removes the ${fmt(i.created)} people this import added (except anyone your team has been in touch with since) and puts back the fields it changed on ${fmt(i.updated)} people, unless they were changed again since. This can't be undone.`, confirmLabel: 'Undo import', danger: true });
    if (!ok) return;
    setBusy(i.id);
    try {
      const r = await api<{ removed: number; restored: number; kept: number; changedSince?: number }>(`/api/imports/${i.id}/undo`, { method: 'POST', body: {} });
      showToast(`Undone: ${fmt(r.removed)} removed, ${fmt(r.restored)} put back${r.kept ? `, ${fmt(r.kept)} kept (in touch since)` : ''}${r.changedSince ? `; ${fmt(r.changedSince)} changed after the import kept their new values` : ''}`);
      onChanged();
      await Promise.all([refreshApi('/api/leads'), refreshApi('/api/business/usage')]);
    } catch (e) { showToast(errorMessage(e)); } finally { setBusy(''); }
  };
  return (
    <ul className="space-y-2" aria-label="Imports" data-testid="import-history">
      {list.map(i => (
        <li key={i.id} className="border border-slate-200 rounded-lg p-2.5 flex flex-wrap items-center gap-2 text-sm" data-testid="import-item">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-800 truncate">{i.fileName}{i.tag ? <span className="ml-1 text-xs text-slate-500">#{i.tag}</span> : null}</div>
            <div className="text-xs text-slate-500">
              {new Date(i.createdAt).toLocaleString()} · {i.by} · rows {fmt(i.rowFrom)}–{fmt(i.rowTo)} of {fmt(i.fileRows)} ·{' '}
              {fmt(i.created)} new, {fmt(i.updated)} updated, {fmt(i.rejected)} rejected
            </div>
            {i.status === 'undone' && i.undoResult && <div className="text-xs text-slate-500">Undone: {fmt(i.undoResult.removed)} removed, {fmt(i.undoResult.restored)} put back{i.undoResult.kept ? `, ${fmt(i.undoResult.kept)} kept` : ''}{i.undoResult.changedSince ? `, ${fmt(i.undoResult.changedSince)} changed since and left as they are` : ''}.</div>}
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${i.status === 'done' ? 'bg-emerald-50 text-emerald-800' : i.status === 'undone' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-800'}`}>{i.status === 'done' ? 'Done' : i.status === 'undone' ? 'Undone' : i.status === 'running' ? 'Running' : 'Stopped'}</span>
          {i.canUndo && <button onClick={() => void undo(i)} disabled={busy === i.id} className={BUTTON.secondary} title={`Possible until ${new Date(i.undoUntil).toLocaleDateString()} (${undoDays} days)`}><Undo2 className="w-3.5 h-3.5" /> {busy === i.id ? 'Undoing…' : 'Undo'}</button>}
        </li>
      ))}
    </ul>
  );
}

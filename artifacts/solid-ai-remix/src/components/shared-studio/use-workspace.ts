import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getCharacter, getCreativeLibrary, listPublicFacts, listCreativeConcepts, getCreativeConcept,
  createCreativeConcept, updateCreativeConcept, createVideoJob,
  type CreativeConcept, type CreativeConceptInput, type StudioFolder, type VideoRenderOptions,
} from '@workspace/api-client-react';
import { emptyInput, toInput } from '@/lib/creative';
import { chunkScript, defaultCues } from '@/lib/video';
import { errMsg } from '@/lib/labels';

const signature = (value: CreativeConceptInput) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
function initial() {
  return { ...emptyInput(), segments: ['NONE'] as CreativeConceptInput['segments'],
    purpose: 'Konten media sosial SOLID GOLD', scenes: 'Foto karakter dan bahan pendukung dengan gerakan kamera sederhana.' };
}
export function useWorkspace(folder: StudioFolder, onRendered: () => void) {
  const options = { headers: { 'X-Solid-Folder': folder.id } };
  const character = useQuery({ queryKey: ['shared', folder.id, 'character'], queryFn: ({ signal }) => getCharacter({ ...options, signal }), retry: false });
  const library = useQuery({ queryKey: ['shared', folder.id, 'library'], queryFn: ({ signal }) => getCreativeLibrary({ ...options, signal }), retry: false });
  const facts = useQuery({ queryKey: ['shared', folder.id, 'facts'], queryFn: ({ signal }) => listPublicFacts({ ...options, signal }), retry: false });
  const concepts = useQuery({ queryKey: ['shared', folder.id, 'concepts'], queryFn: ({ signal }) => listCreativeConcepts({ ...options, signal }), retry: false });
  const [form, setForm] = useState<CreativeConceptInput>(initial), [concept, setConcept] = useState<CreativeConcept | null>(null);
  const [saving, setSaving] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [summary, setSummary] = useState(false), [pendingFiles, setPendingFiles] = useState(false);
  const [renderOptions, setRenderOptions] = useState<Omit<VideoRenderOptions, 'cues'>>({ motion: 'ZOOM_IN', logoPosition: 'TOP_RIGHT', logoAttachmentId: '' });
  const formRef = useRef(form), rowRef = useRef(concept), savedSig = useRef(''), hydrated = useRef(false);
  const edited = useRef(false);
  const savingRef = useRef<Promise<CreativeConcept> | null>(null), newIntent = useRef(false);
  formRef.current = form; rowRef.current = concept;
  const initialized = !character.isLoading && !library.isLoading && !concepts.isLoading;
  const loading = !initialized || facts.isLoading;
  const loadError = character.error ?? library.error ?? concepts.error ?? facts.error;
  useEffect(() => {
    if (!initialized || loadError || hydrated.current) return;
    hydrated.current = true;
    const existing = concepts.data?.[0];
    if (existing) {
      const input = toInput(existing);
      formRef.current = input; rowRef.current = existing; savedSig.current = signature(input);
      setForm(input); setConcept(existing);
    }
  }, [initialized, loadError, concepts.data]);
  const patch = (changes: Partial<CreativeConceptInput>) => {
    edited.current = true;
    formRef.current = { ...formRef.current, ...changes };
    setForm(formRef.current); setSummary(false); setError('');
  };
  function inputNow(): CreativeConceptInput {
    if (!character.data?.character) throw new Error('Simpan karakter folder ini terlebih dahulu.');
    const current = formRef.current;
    const categoryId = current.categoryId || library.data?.categories.find(c => c.active)?.id;
    if (!categoryId) throw new Error('Kategori aktif belum tersedia. Admin perlu menyiapkan pustaka.');
    return { ...current, title: current.title.trim() || current.narration.trim().slice(0, 100) || `Video ${folder.name}`,
      characterId: character.data.character.id, categoryId, mode: 'HEMAT', format: '9:16' };
  }
  const acceptConcept = useCallback((row: CreativeConcept) => {
    rowRef.current = row; setConcept(row); savedSig.current = signature(toInput(row));
  }, []);
  async function saveDraft() {
    while (savingRef.current) await savingRef.current;
    const input = inputNow(), sig = signature(input);
    if (rowRef.current && savedSig.current === sig && !rowRef.current.stale) return rowRef.current;
    setSaving(true);
    const task = rowRef.current
      ? updateCreativeConcept(rowRef.current.id, { ...input, version: rowRef.current.version }, options)
      : createCreativeConcept(input, options);
    savingRef.current = task;
    try { const saved = await task; acceptConcept(saved); savedSig.current = sig; return saved; }
    finally { savingRef.current = null; setSaving(false); }
  }
  let dirty = false;
  try { dirty = edited.current && signature(inputNow()) !== savedSig.current; } catch { dirty = edited.current; }
  useEffect(() => {
    if (!hydrated.current || !edited.current || loading || busy || pendingFiles || !character.data?.character || (!form.narration.trim() && !form.direction.trim())) return;
    const timer = window.setTimeout(() => { void saveDraft().catch(e => setError(errMsg(e))); }, 900);
    return () => window.clearTimeout(timer);
  // Autosave follows input changes, not query response timestamps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, loading, pendingFiles, busy, character.data?.character?.updatedAt]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || saving || pendingFiles) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving, pendingFiles]);
  const onPending = useCallback((value: boolean) => setPendingFiles(value), []);
  async function prepare() {
    setError(''); setBusy(true);
    try {
      if (pendingFiles) throw new Error('Unggah bahan terpilih atau batalkan pemilihannya terlebih dahulu.');
      const current = await saveDraft();
      const problems = [...current.blockers, ...current.staleReasons];
      if (current.durationSeconds < 10 || current.durationSeconds > 15) problems.push('Pilih durasi 10–15 detik.');
      if (!current.disclaimer?.trim()) problems.push('Isi disclaimer yang disetujui perusahaan.');
      if (!renderOptions.logoAttachmentId || !current.attachments.some(a => a.id === renderOptions.logoAttachmentId && a.state === 'READY')) problems.push('Pilih gambar logo resmi dari bahan tersimpan.');
      if (!chunkScript(current).length || chunkScript(current).length > 12) problems.push('Naskah maksimal 108 kata, dengan kelompok subtitle yang tidak terlalu panjang.');
      if (current.attachments.some(a => a.state !== 'READY')) problems.push('Selesaikan atau hapus unggahan tertunda.');
      if (problems.length) throw new Error([...new Set(problems)].join(' '));
      setSummary(true);
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }
  async function render() {
    if (busy || !summary) return;
    setBusy(true); setError('');
    try {
      const current = await saveDraft();
      const payload = { conceptId: current.id, version: current.version, mode: 'HEMAT' as const,
        options: { ...renderOptions, cues: defaultCues(chunkScript(current).length, current.durationSeconds) }, confirmed: true };
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))))
        .map(n => n.toString(16).padStart(2, '0')).join('');
      const storageKey = `solid-intent:${folder.id}:${hash}`;
      let key = sessionStorage.getItem(storageKey);
      if (!key || newIntent.current) { key = crypto.randomUUID(); sessionStorage.setItem(storageKey, key); newIntent.current = false; }
      await createVideoJob({ ...payload, requestKey: key }, options);
      // Keep the same key after success: a refresh/double click cannot send another job.
      setSummary(false); onRendered();
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }
  async function versionFrom(id: string) {
    if (!window.confirm('Buat versi baru? Render baru tetap memakai kuota harian dan dapat menimbulkan biaya komputasi/storage.')) return;
    if ((dirty || pendingFiles) && !window.confirm('Ada perubahan atau bahan yang belum tersimpan. Abaikan dan buka konsep video ini?')) return;
    try {
      const row = await getCreativeConcept(id, options);
      const value = toInput(row);
      formRef.current = value; setForm(value); acceptConcept(row);
      edited.current = false;
      newIntent.current = true; setSummary(false); setError('');
    } catch (e) { setError(errMsg(e)); }
  }
  async function characterSaved() {
    edited.current = true;
    savedSig.current = '';
    await character.refetch(); onRendered();
  }
  return { form, patch, concept, acceptConcept, character: character.data?.character ?? null,
    characterSaved, library: library.data, facts: facts.data ?? [], loading, loadError, dirty, saving, busy,
    error, setError, saveDraft, summary, setSummary, prepare, render, versionFrom, renderOptions, setRenderOptions,
    pendingFiles, onPending };
}

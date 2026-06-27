'use client'

import { useState, useEffect } from 'react'
import { Trash2, Upload, Video, ImageIcon, Loader2, ChevronDown, ChevronUp } from 'lucide-react'

const CATEGORIES = [
  { key: 'elevador_ley_residencial', label: 'Elevador Ley 7600 y Residencial',   hint: 'Bloque C — opciones Residencial y Ley 7600',            max: 2 },
  { key: 'elevador_carga',           label: 'Elevador de carga',                  hint: 'Bloque C — opción Carga',                               max: 2 },
  { key: 'motor_cadena_corredizo',   label: 'Motor de cadena — Corredizo',        hint: 'Bloque A y B — portón corredizo nuevo y existente',     max: 2 },
  { key: 'porton_corredizo',         label: 'Portón corredizo nuevo',             hint: 'Bloque A — opción 1 Corredizo',                         max: 2 },
  { key: 'cremallera',               label: 'Corredizo de cremallera',            hint: 'Bloque B — motor cremallera',                           max: 2 },
  { key: 'seccional_con_puerta',     label: 'Seccional con puerta incorporada',  hint: 'Bloque A — Seccional opción 1',                         max: 2 },
  { key: 'seccional_puerta_aparte',  label: 'Seccional con puerta aparte',       hint: 'Bloque A — Seccional opción 2',                         max: 2 },
  { key: 'seccional_sin_puerta',     label: 'Seccional sin puerta',              hint: 'Bloque A — Seccional opción 3',                         max: 1 },
]

interface MediaFile {
  id: string
  categoria: string
  file_url: string
  file_name: string
  mime_type: string
}

export default function MediaSection({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<MediaFile[]>([])
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open || loaded) return
    fetch(`/api/clients/${clientId}/media`)
      .then(r => r.json())
      .then(data => { setFiles(Array.isArray(data) ? data : []); setLoaded(true) })
      .catch(() => setError('Error cargando archivos'))
  }, [open, loaded, clientId])

  async function handleUpload(categoria: string, file: File) {
    setUploading(prev => ({ ...prev, [categoria]: true }))
    setError('')
    try {
      // 1. Get signed upload URL
      const signRes = await fetch(`/api/clients/${clientId}/media/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoria, fileName: file.name, mimeType: file.type }),
      })
      if (!signRes.ok) throw new Error(await signRes.text())
      const { signedUrl, path, publicUrl } = await signRes.json()

      // 2. Upload directly to Supabase Storage (bypasses Vercel body limit)
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!uploadRes.ok) throw new Error('Error subiendo el archivo')

      // 3. Save record in DB
      const saveRes = await fetch(`/api/clients/${clientId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoria, file_url: publicUrl, file_name: file.name, mime_type: file.type, storage_path: path }),
      })
      if (!saveRes.ok) throw new Error(await saveRes.text())
      const newFile = await saveRes.json()
      setFiles(prev => [...prev, newFile])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al subir archivo')
    } finally {
      setUploading(prev => ({ ...prev, [categoria]: false }))
    }
  }

  async function handleDelete(fileId: string) {
    setError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/media/${fileId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      setFiles(prev => prev.filter(f => f.id !== fileId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar')
    }
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-slate-700/30 transition-colors"
      >
        <div>
          <span className="font-semibold text-white text-sm">Media por categoría</span>
          <p className="text-xs text-slate-400 mt-0.5">Videos e imágenes enviados al finalizar la conversación</p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-slate-700 px-5 pb-5 pt-4 space-y-5">
          {error && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg px-3 py-2 text-red-400 text-xs">{error}</div>
          )}

          {CATEGORIES.map(cat => {
            const catFiles = files.filter(f => f.categoria === cat.key)
            const isUploading = uploading[cat.key]
            const canUpload = catFiles.length < cat.max

            return (
              <div key={cat.key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{cat.label}</span>
                  <span className="text-xs text-slate-500">{catFiles.length}/{cat.max}</span>
                </div>
                {cat.hint && <p className="text-xs text-slate-500 mb-2">{cat.hint}</p>}

                <div className="flex flex-wrap gap-2">
                  {catFiles.map(file => (
                    <div key={file.id} className="flex items-center gap-2 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2">
                      {file.mime_type?.startsWith('image/')
                        ? <ImageIcon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        : <Video className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                      <span className="text-xs text-slate-300 max-w-[140px] truncate">{file.file_name}</span>
                      <button
                        type="button"
                        onClick={() => handleDelete(file.id)}
                        className="text-slate-500 hover:text-red-400 transition-colors ml-1 shrink-0"
                        title="Eliminar"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {canUpload && (
                    <label className={`flex items-center gap-2 border border-dashed rounded-lg px-3 py-2 text-xs transition-colors cursor-pointer ${
                      isUploading
                        ? 'border-slate-600 text-slate-500 bg-slate-700/50 cursor-not-allowed'
                        : 'border-slate-500 text-slate-400 hover:border-indigo-500 hover:text-indigo-400 hover:bg-slate-700/50'
                    }`}>
                      {isUploading
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Subiendo...</>
                        : <><Upload className="w-3.5 h-3.5" /> Subir</>}
                      <input
                        type="file"
                        accept="video/mp4,image/jpeg,image/png,image/webp"
                        className="sr-only"
                        disabled={isUploading}
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) handleUpload(cat.key, f)
                          e.target.value = ''
                        }}
                      />
                    </label>
                  )}

                  {catFiles.length === 0 && !canUpload && (
                    <span className="text-xs text-slate-500 italic">Sin archivos</span>
                  )}
                </div>
              </div>
            )
          })}

          <p className="text-xs text-slate-500 pt-1">
            Formatos: MP4, JPG, PNG, WebP · Máx. 100 MB por archivo · Si no hay archivos se usan las carpetas de Google Drive configuradas.
          </p>
        </div>
      )}
    </div>
  )
}

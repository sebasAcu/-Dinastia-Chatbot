'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Client, ClientFormData } from '@/lib/types'
import { Save, Loader2, Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react'

interface Props { client?: Client }

const DEFAULTS: ClientFormData = {
  nombre: '',
  tipo_negocio: '',
  whatsapp_number: '',
  whatsapp_token: '',
  phone_number_id: '',
  groq_api_key: '',
  system_prompt: 'Eres un asistente de atención al cliente útil y amigable. Responde de manera concisa y profesional. Si no sabes algo, dilo honestamente y ofrece alternativas.',
  offhours_enabled: false,
  offhours_start: '09:00',
  offhours_end: '18:00',
  offhours_message: 'Estamos fuera de horario de atención. Te responderemos el próximo día hábil. ¡Gracias por tu mensaje!',
  escalate_enabled: false,
  escalate_number: '',
  escalate_message: 'Te vamos a conectar con un agente humano que te ayudará enseguida.',
  logs_enabled: true,
}

// ── Sub-components ─────────────────────────────────────────

function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-slate-700/30 transition-colors"
      >
        <span className="font-semibold text-white text-sm">{title}</span>
        {open
          ? <ChevronUp className="w-4 h-4 text-slate-400" />
          : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="border-t border-slate-700 px-5 pb-5 pt-4 space-y-4">
          {children}
        </div>
      )}
    </div>
  )
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

const inputCls = 'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all'

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputCls} />
}

function SecretInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputCls} pr-10 font-mono text-xs`}
      />
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

function Toggle({ checked, onChange, label, description }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: string
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <div className="relative mt-0.5 shrink-0">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only" />
        <div className={`w-10 h-[22px] rounded-full transition-colors duration-200 ${checked ? 'bg-indigo-600' : 'bg-slate-600'}`} />
        <div className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-[18px]' : ''}`} />
      </div>
      <div>
        <span className="text-sm text-slate-200 font-medium">{label}</span>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
    </label>
  )
}

// ── Main component ──────────────────────────────────────────

export default function ClientForm({ client }: Props) {
  const router = useRouter()
  const [form, setForm] = useState<ClientFormData>(
    client
      ? {
          nombre: client.nombre,
          tipo_negocio: client.tipo_negocio,
          whatsapp_number: client.whatsapp_number,
          whatsapp_token: client.whatsapp_token,
          phone_number_id: client.phone_number_id,
          groq_api_key: client.groq_api_key,
          system_prompt: client.system_prompt,
          offhours_enabled: client.offhours_enabled,
          offhours_start: client.offhours_start,
          offhours_end: client.offhours_end,
          offhours_message: client.offhours_message,
          escalate_enabled: client.escalate_enabled,
          escalate_number: client.escalate_number,
          escalate_message: client.escalate_message,
          logs_enabled: client.logs_enabled,
        }
      : DEFAULTS
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set<K extends keyof ClientFormData>(key: K, val: ClientFormData[K]) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const res = await fetch(
        client ? `/api/clients/${client.id}` : '/api/clients',
        {
          method: client ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        }
      )
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Error al guardar'); setSaving(false); return }
      router.push('/')
      router.refresh()
    } catch {
      setError('Error de conexión')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* General */}
      <Section title="Información General">
        <Field label="Nombre del cliente">
          <TextInput
            value={form.nombre}
            onChange={e => set('nombre', e.target.value)}
            placeholder="Ej: Restaurante Don Pepe"
            required
          />
        </Field>
        <Field label="Tipo de negocio">
          <TextInput
            value={form.tipo_negocio}
            onChange={e => set('tipo_negocio', e.target.value)}
            placeholder="Restaurante, Clínica, Tienda, Estudio..."
          />
        </Field>
        <Field
          label="Número de WhatsApp"
          hint="Número completo con código de país, sin + (ej: 56912345678)"
        >
          <TextInput
            value={form.whatsapp_number}
            onChange={e => set('whatsapp_number', e.target.value)}
            placeholder="56912345678"
          />
        </Field>
      </Section>

      {/* API */}
      <Section title="Credenciales API">
        <Field
          label="WhatsApp Token"
          hint="Token de acceso permanente desde Meta Business Suite"
        >
          <SecretInput
            value={form.whatsapp_token}
            onChange={v => set('whatsapp_token', v)}
            placeholder="EAAxxxxxxxx..."
          />
        </Field>
        <Field
          label="Phone Number ID"
          hint="ID del número en Meta → WhatsApp → Configuration"
        >
          <TextInput
            value={form.phone_number_id}
            onChange={e => set('phone_number_id', e.target.value)}
            placeholder="123456789012345"
          />
        </Field>
        <Field
          label="Groq API Key"
          hint="Obtén tu clave gratis en console.groq.com"
        >
          <SecretInput
            value={form.groq_api_key}
            onChange={v => set('groq_api_key', v)}
            placeholder="gsk_xxxxxxxx..."
          />
        </Field>
      </Section>

      {/* Chatbot */}
      <Section title="Personalidad del Chatbot">
        <Field
          label="Prompt del sistema"
          hint="Define el rol, tono y conocimiento del chatbot. Sé específico sobre el negocio."
        >
          <textarea
            value={form.system_prompt}
            onChange={e => set('system_prompt', e.target.value)}
            rows={6}
            placeholder="Eres un asistente de atención al cliente de [nombre del negocio]..."
            className={`${inputCls} resize-y`}
          />
        </Field>
      </Section>

      {/* Ajustes */}
      <Section title="Ajustes" defaultOpen={false}>
        {/* Logs */}
        <Toggle
          checked={form.logs_enabled}
          onChange={v => set('logs_enabled', v)}
          label="Guardar registro de conversaciones"
          description="Guarda cada mensaje en la base de datos para revisión posterior"
        />

        <div className="border-t border-slate-700" />

        {/* Off-hours */}
        <Toggle
          checked={form.offhours_enabled}
          onChange={v => set('offhours_enabled', v)}
          label="Activar horario de atención"
          description="Fuera del horario responde con un mensaje predefinido en lugar de usar IA"
        />
        {form.offhours_enabled && (
          <div className="space-y-3 pl-13 ml-[52px]">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Apertura">
                <input
                  type="time"
                  value={form.offhours_start}
                  onChange={e => set('offhours_start', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Cierre">
                <input
                  type="time"
                  value={form.offhours_end}
                  onChange={e => set('offhours_end', e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
            <Field label="Mensaje fuera de horario">
              <textarea
                value={form.offhours_message}
                onChange={e => set('offhours_message', e.target.value)}
                rows={2}
                className={`${inputCls} resize-none`}
              />
            </Field>
          </div>
        )}

        <div className="border-t border-slate-700" />

        {/* Escalado */}
        <Toggle
          checked={form.escalate_enabled}
          onChange={v => set('escalate_enabled', v)}
          label="Escalado a agente humano"
          description="Permite derivar conversaciones a un número de WhatsApp humano"
        />
        {form.escalate_enabled && (
          <div className="space-y-3 ml-[52px]">
            <Field label="Número del agente" hint="WhatsApp al que se derivará (con código de país)">
              <TextInput
                value={form.escalate_number}
                onChange={e => set('escalate_number', e.target.value)}
                placeholder="56987654321"
              />
            </Field>
            <Field label="Mensaje de escalado">
              <textarea
                value={form.escalate_message}
                onChange={e => set('escalate_message', e.target.value)}
                rows={2}
                className={`${inputCls} resize-none`}
              />
            </Field>
          </div>
        )}
      </Section>

      {/* Error */}
      {error && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-lg px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium py-3 rounded-lg transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
        >
          {saving
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
            : <><Save className="w-4 h-4" /> {client ? 'Guardar cambios' : 'Crear cliente'}</>}
        </button>
      </div>
    </form>
  )
}

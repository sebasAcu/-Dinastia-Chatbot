import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ClientForm from '@/components/ClientForm'

export default function NewClientPage() {
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver al dashboard
      </Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Nuevo cliente</h1>
        <p className="text-slate-400 text-sm mt-1">Configura el chatbot de WhatsApp para un nuevo cliente</p>
      </div>
      <ClientForm />
    </div>
  )
}

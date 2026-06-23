import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ClientForm from '@/components/ClientForm'

export default async function EditClientPage({ params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!

  const res = await fetch(
    `${url}/rest/v1/clients?id=eq.${params.id}&select=*&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    }
  )

  const rows = res.ok ? await res.json() : []
  const client = rows?.[0]

  if (!client) notFound()

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
        <h1 className="text-2xl font-bold text-white">{client.nombre}</h1>
        <p className="text-slate-400 text-sm mt-1">Editar configuración del chatbot</p>
      </div>
      <ClientForm client={client} />
    </div>
  )
}

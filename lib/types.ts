export type WaStatus = 'disconnected' | 'connecting' | 'qr_pending' | 'connected' | 'reconnecting'

export interface Client {
  id: string
  created_at: string
  updated_at: string
  nombre: string
  tipo_negocio: string
  whatsapp_number: string
  whatsapp_token: string
  phone_number_id: string
  groq_api_key: string
  system_prompt: string
  offhours_enabled: boolean
  offhours_start: string
  offhours_end: string
  offhours_message: string
  escalate_enabled: boolean
  escalate_number: string
  escalate_message: string
  logs_enabled: boolean
  wa_status: WaStatus
  evolution_instance: string
}

export type ClientFormData = Omit<Client, 'id' | 'created_at' | 'updated_at'>

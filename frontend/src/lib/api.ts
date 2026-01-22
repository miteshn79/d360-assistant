const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
    throw new ApiError(response.status, error.detail || 'Request failed')
  }

  return response.json()
}

// Auth API
export const authApi = {
  initOAuth: (data: {
    login_url: string
    consumer_key: string
    redirect_uri: string
  }) =>
    fetchApi<{ session_id: string; auth_url: string; state: string }>(
      '/api/auth/init',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  handleCallback: (data: { code: string; session_id: string }) =>
    fetchApi<{ success: boolean; instance_url: string; user_info: any }>(
      '/api/auth/callback',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  exchangeDCToken: (session_id: string) =>
    fetchApi<{ success: boolean; dc_instance_url: string }>(
      '/api/auth/exchange-dc-token',
      { method: 'POST', body: JSON.stringify({ session_id }) }
    ),

  getSession: (session_id: string) =>
    fetchApi<{
      authenticated: boolean
      has_dc_token: boolean
      instance_url: string | null
      dc_instance_url: string | null
      user_info: any
    }>(`/api/auth/session/${session_id}`),
}

// Data API
export const dataApi = {
  query: (session_id: string, sql: string) =>
    fetchApi<{ data: any[]; metadata?: any }>('/api/data/query', {
      method: 'POST',
      body: JSON.stringify({ session_id, sql }),
    }),

  getMetadata: (session_id: string) =>
    fetchApi<{ metadata: any[] }>(`/api/data/metadata?session_id=${session_id}`),

  streamData: (data: {
    session_id: string
    source_name: string
    object_name: string
    records: any[]
  }) =>
    fetchApi<{ success: boolean; response: any }>('/api/data/stream', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  retrieveData: (data: {
    session_id: string
    data_graph_name: string
    lookup_keys: Record<string, string>
  }) =>
    fetchApi<{ data: any }>('/api/data/retrieve', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getProfiles: (session_id: string, data_model?: string) =>
    fetchApi<{ metadata: any[] }>(
      `/api/data/profiles?session_id=${session_id}${data_model ? `&data_model=${data_model}` : ''}`
    ),

  getInsights: (session_id: string) =>
    fetchApi<{ metadata: any[] }>(`/api/data/insights?session_id=${session_id}`),
}

// Bulk API
export const bulkApi = {
  createJob: (data: {
    session_id: string
    source_name: string
    object_name: string
    operation?: string
  }) =>
    fetchApi<{ id: string }>('/api/bulk/create', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  uploadData: (data: { session_id: string; job_id: string; csv_data: string }) =>
    fetchApi<{ success: boolean }>('/api/bulk/upload', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  closeJob: (job_id: string, session_id: string) =>
    fetchApi<{ success: boolean }>(`/api/bulk/${job_id}/close?session_id=${session_id}`, {
      method: 'POST',
    }),

  getJobStatus: (job_id: string, session_id: string) =>
    fetchApi<any>(`/api/bulk/${job_id}/status?session_id=${session_id}`),

  listJobs: (session_id: string) =>
    fetchApi<{ data: any[] }>(`/api/bulk/jobs?session_id=${session_id}`),
}

// Templates API
export const templatesApi = {
  getAll: () =>
    fetchApi<{ templates: any[] }>('/api/templates'),

  getById: (id: string) =>
    fetchApi<any>(`/api/templates/${id}`),

  getCategories: () =>
    fetchApi<{ categories: string[] }>('/api/templates/categories'),
}

// Schema API
export const schemaApi = {
  parse: (yaml_content: string) =>
    fetchApi<{ success: boolean; schema: any; table_data: any[] }>(
      '/api/schema/parse',
      { method: 'POST', body: JSON.stringify(yaml_content) }
    ),

  generatePayload: (data: {
    session_id: string
    yaml_schema: string
    count?: number
    overrides?: Record<string, any>
  }) =>
    fetchApi<{ success: boolean; records: any[]; count: number }>(
      '/api/payload/generate',
      { method: 'POST', body: JSON.stringify(data) }
    ),
}

// Chat API
export const chatApi = {
  send: (data: { session_id: string; message: string; context?: any }) =>
    fetchApi<{ success: boolean; message: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// Saved Configurations API
export interface SavedConfig {
  name: string
  description?: string
  login_url?: string
  consumer_key?: string
  source_name?: string
  object_name?: string
  yaml_schema?: string
  profile_id_field?: string
  primary_key_field?: string
  datetime_field?: string
  data_graph_name?: string
  lookup_key?: string
  lookup_value?: string
  sample_use_case?: string
  sample_payload?: string  // JSON string of the payload
  created_at?: string
  updated_at?: string
}

export const configApi = {
  list: () =>
    fetchApi<{ configs: SavedConfig[] }>('/api/configs'),

  get: (name: string) =>
    fetchApi<{ config: SavedConfig }>(`/api/configs/${encodeURIComponent(name)}`),

  save: (config: SavedConfig) =>
    fetchApi<{ success: boolean; message: string }>('/api/configs', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  delete: (name: string) =>
    fetchApi<{ success: boolean; message: string }>(`/api/configs/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
}

// Health API
export const healthApi = {
  check: () => fetchApi<{ status: string; timestamp: string; redis?: string }>('/api/health'),
}

// Website Builder API
export interface WebsiteProject {
  customer_name: string
  country: string
  industry: string
  use_case: string
  branding_assets?: { type: string; name: string; value: string }[]
  llm_provider?: string
  llm_api_key?: string
  heroku_api_key?: string
  use_default_heroku?: boolean
}

export interface WebsiteBuilderChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export const websiteBuilderApi = {
  chat: (data: { messages: WebsiteBuilderChatMessage[]; project_context?: Record<string, any> }) =>
    fetchApi<{ response: string; project_updates?: Record<string, any> }>(
      '/api/website-builder/chat',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  generate: (project: WebsiteProject) =>
    fetchApi<{
      success: boolean
      website?: { files: { path: string; content: string }[]; instructions: string }
      error?: string
      project?: { customer_name: string; country: string; industry: string }
    }>('/api/website-builder/generate', {
      method: 'POST',
      body: JSON.stringify(project),
    }),

  deploy: (data: { website_data: any; app_name: string; heroku_api_key?: string }) =>
    fetchApi<{
      success: boolean
      message: string
      app_url: string
      files: { path: string; content: string }[]
      instructions: string[]
    }>(`/api/website-builder/deploy?app_name=${encodeURIComponent(data.app_name)}${data.heroku_api_key ? `&heroku_api_key=${encodeURIComponent(data.heroku_api_key)}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(data.website_data),
    }),
}

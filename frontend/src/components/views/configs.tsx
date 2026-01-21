'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { configApi, SavedConfig } from '@/lib/api'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  AlertCircle,
  Calendar,
  ChevronRight,
  Cloud,
  Database,
  Edit2,
  FileCode,
  Key,
  Loader2,
  Plus,
  Save,
  Settings,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function ConfigsView() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { setStreamConfig, setRetrieveConfig, setOAuthConfig } = useAppStore()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingConfig, setEditingConfig] = useState<SavedConfig | null>(null)
  const [newConfig, setNewConfig] = useState<Partial<SavedConfig>>({
    name: '',
    description: '',
  })

  // Fetch all configs
  const { data, isLoading, error } = useQuery({
    queryKey: ['configs'],
    queryFn: () => configApi.list(),
  })

  // Save config mutation
  const saveMutation = useMutation({
    mutationFn: (config: SavedConfig) => configApi.save(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configs'] })
      setShowCreateModal(false)
      setEditingConfig(null)
      setNewConfig({ name: '', description: '' })
      toast.success('Configuration saved!')
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save configuration')
    },
  })

  // Delete config mutation
  const deleteMutation = useMutation({
    mutationFn: (name: string) => configApi.delete(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configs'] })
      toast.success('Configuration deleted')
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to delete configuration')
    },
  })

  // Load a config into the app state
  const loadConfig = async (configName: string) => {
    try {
      const { config } = await configApi.get(configName)

      // Set OAuth config (only set non-empty values to preserve defaults)
      const oauthUpdates: { loginUrl?: string; consumerKey?: string } = {}
      if (config.login_url) oauthUpdates.loginUrl = config.login_url
      if (config.consumer_key) oauthUpdates.consumerKey = config.consumer_key
      if (Object.keys(oauthUpdates).length > 0) {
        setOAuthConfig(oauthUpdates)
      }

      // Set stream config (only set non-empty values)
      const streamUpdates: { sourceName?: string; objectName?: string } = {}
      if (config.source_name) streamUpdates.sourceName = config.source_name
      if (config.object_name) streamUpdates.objectName = config.object_name
      if (Object.keys(streamUpdates).length > 0) {
        setStreamConfig(streamUpdates)
      }

      // Set retrieve config (only set non-empty values)
      if (config.data_graph_name) {
        setRetrieveConfig({
          dataGraphName: config.data_graph_name,
        })
      }

      // Store the loaded config in sessionStorage for the stream view to use
      sessionStorage.setItem('loadedConfig', JSON.stringify(config))

      toast.success(`Loaded "${configName}" configuration`)
      router.push('/connect')
    } catch (err: any) {
      toast.error(err.message || 'Failed to load configuration')
    }
  }

  const handleSaveConfig = () => {
    if (!newConfig.name?.trim()) {
      toast.error('Please enter a configuration name')
      return
    }
    saveMutation.mutate(newConfig as SavedConfig)
  }

  const handleEditConfig = async (configName: string) => {
    try {
      const { config } = await configApi.get(configName)
      setEditingConfig(config)
      setNewConfig(config)
      setShowCreateModal(true)
    } catch (err: any) {
      toast.error('Failed to load configuration for editing')
    }
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-sf-navy-900 mb-2">
              Saved Configurations
            </h1>
            <p className="text-sf-navy-500">
              Save and reuse your Data Cloud configurations for different customers or use cases
            </p>
          </div>
          <button
            onClick={() => {
              setEditingConfig(null)
              setNewConfig({ name: '', description: '' })
              setShowCreateModal(true)
            }}
            className="btn-primary"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Configuration
          </button>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-sf-blue-500 mx-auto mb-3" />
            <p className="text-sf-navy-500">Loading configurations...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <div>
              <p className="font-medium text-red-800">Failed to load configurations</p>
              <p className="text-sm text-red-600">{(error as any).message}</p>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && data?.configs?.length === 0 && (
          <div className="card p-12 text-center">
            <Settings className="w-12 h-12 text-sf-navy-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-sf-navy-900 mb-2">
              No saved configurations yet
            </h3>
            <p className="text-sf-navy-500 mb-6 max-w-md mx-auto">
              Save your Data Cloud settings (login URL, client ID, schema, field mappings)
              so you don't have to enter them every time.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create First Configuration
            </button>
          </div>
        )}

        {/* Configs List */}
        {!isLoading && data?.configs && data.configs.length > 0 && (
          <div className="space-y-4">
            {data.configs.map((config) => (
              <div
                key={config.name}
                className="card hover:shadow-lg transition-shadow"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-sf-navy-900 mb-1">
                        {config.name}
                      </h3>
                      {config.description && (
                        <p className="text-sm text-sf-navy-500 mb-3">
                          {config.description}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-3 text-xs">
                        {config.source_name && (
                          <span className="flex items-center gap-1 text-sf-navy-600 bg-sf-navy-50 px-2 py-1 rounded">
                            <Database className="w-3 h-3" />
                            Source: {config.source_name}
                          </span>
                        )}
                        {config.object_name && (
                          <span className="flex items-center gap-1 text-sf-navy-600 bg-sf-navy-50 px-2 py-1 rounded">
                            <FileCode className="w-3 h-3" />
                            Object: {config.object_name}
                          </span>
                        )}
                        {config.created_at && (
                          <span className="flex items-center gap-1 text-sf-navy-400">
                            <Calendar className="w-3 h-3" />
                            {new Date(config.created_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => handleEditConfig(config.name)}
                        className="btn-ghost p-2"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${config.name}"?`)) {
                            deleteMutation.mutate(config.name)
                          }
                        }}
                        className="btn-ghost p-2 text-red-600 hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => loadConfig(config.name)}
                        className="btn-primary py-2"
                      >
                        Load & Connect
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-sf-navy-100 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-sf-navy-900">
                  {editingConfig ? 'Edit Configuration' : 'New Configuration'}
                </h2>
                <button
                  onClick={() => {
                    setShowCreateModal(false)
                    setEditingConfig(null)
                  }}
                  className="btn-ghost p-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Basic Info */}
                <div className="space-y-4">
                  <h3 className="font-medium text-sf-navy-800 flex items-center gap-2">
                    <Settings className="w-4 h-4" />
                    Basic Information
                  </h3>
                  <div>
                    <label className="label">Configuration Name *</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g., VietnamAir Credit Cards"
                      value={newConfig.name || ''}
                      onChange={(e) => setNewConfig({ ...newConfig, name: e.target.value })}
                      disabled={!!editingConfig}
                    />
                  </div>
                  <div>
                    <label className="label">Description</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="Brief description of this configuration"
                      value={newConfig.description || ''}
                      onChange={(e) => setNewConfig({ ...newConfig, description: e.target.value })}
                    />
                  </div>
                </div>

                {/* OAuth Settings */}
                <div className="space-y-4">
                  <h3 className="font-medium text-sf-navy-800 flex items-center gap-2">
                    <Cloud className="w-4 h-4" />
                    Salesforce OAuth Settings
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Login URL</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="https://login.salesforce.com"
                        value={newConfig.login_url || ''}
                        onChange={(e) => setNewConfig({ ...newConfig, login_url: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">Consumer Key (Client ID)</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="Connected App Client ID"
                        value={newConfig.consumer_key || ''}
                        onChange={(e) => setNewConfig({ ...newConfig, consumer_key: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                {/* Ingestion Settings */}
                <div className="space-y-4">
                  <h3 className="font-medium text-sf-navy-800 flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    Ingestion API Settings
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Source API Name</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="e.g., creditcardtransactions"
                        value={newConfig.source_name || ''}
                        onChange={(e) => setNewConfig({ ...newConfig, source_name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">Object API Name</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="e.g., CardTransaction"
                        value={newConfig.object_name || ''}
                        onChange={(e) => setNewConfig({ ...newConfig, object_name: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label">YAML Schema</label>
                    <textarea
                      className="input min-h-[120px] font-mono text-sm"
                      placeholder="Paste your YAML schema here (optional)"
                      value={newConfig.yaml_schema || ''}
                      onChange={(e) => setNewConfig({ ...newConfig, yaml_schema: e.target.value })}
                    />
                  </div>
                </div>

                {/* Required Field Mappings */}
                <div className="space-y-4">
                  <h3 className="font-medium text-sf-navy-800 flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    Required Field Mappings
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="label flex items-center gap-1">
                        <User className="w-3 h-3 text-purple-500" />
                        Profile ID Field
                      </label>
                      <input
                        type="text"
                        className="input"
                        placeholder="e.g., cust_id"
                        value={newConfig.profile_id_field || ''}
                        onChange={(e) => setNewConfig({ ...newConfig, profile_id_field: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label flex items-center gap-1">
                        <Key className="w-3 h-3 text-blue-500" />
                        Primary Key Field
                      </label>
                      <input
                        type="text"
                        className="input"
                        placeholder="e.g., txn_id"
                        value={newConfig.primary_key_field || ''}
                        onChange={(e) => setNewConfig({ ...newConfig, primary_key_field: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-orange-500" />
                        DateTime Field
                      </label>
                      <input
                        type="text"
                        className="input"
                        placeholder="e.g., txn_date"
                        value={newConfig.datetime_field || ''}
                        onChange={(e) => setNewConfig({ ...newConfig, datetime_field: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                {/* Retrieval Settings */}
                <div className="space-y-4">
                  <h3 className="font-medium text-sf-navy-800 flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    Data Retrieval Settings
                  </h3>
                  <div>
                    <label className="label">Data Graph Name</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g., Individual_Graph_1"
                      value={newConfig.data_graph_name || ''}
                      onChange={(e) => setNewConfig({ ...newConfig, data_graph_name: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Lookup Key</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="e.g., UnifiedIndividual__dlm.Id__c"
                        value={newConfig.lookup_key || ''}
                        onChange={(e) => setNewConfig({ ...newConfig, lookup_key: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">Lookup Value</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="e.g., cust_123"
                        value={newConfig.lookup_value || ''}
                        onChange={(e) => setNewConfig({ ...newConfig, lookup_value: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                {/* Sample Use Case */}
                <div className="space-y-4">
                  <h3 className="font-medium text-sf-navy-800">Sample Data</h3>
                  <div>
                    <label className="label">Use Case for Data Generation</label>
                    <textarea
                      className="input min-h-[80px]"
                      placeholder="e.g., Customer made a credit card purchase at a coffee shop for $5.50"
                      value={newConfig.sample_use_case || ''}
                      onChange={(e) => setNewConfig({ ...newConfig, sample_use_case: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Sample Payload (JSON)</label>
                    <textarea
                      className="input min-h-[120px] font-mono text-sm"
                      placeholder='{"field1": "value1", "field2": "value2"}'
                      value={newConfig.sample_payload || ''}
                      onChange={(e) => setNewConfig({ ...newConfig, sample_payload: e.target.value })}
                    />
                    <p className="text-xs text-sf-navy-400 mt-1">
                      Sample data that was sent to the Ingestion API
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-sf-navy-100 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowCreateModal(false)
                    setEditingConfig(null)
                  }}
                  className="btn-ghost"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveConfig}
                  disabled={saveMutation.isPending}
                  className="btn-primary"
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Configuration
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

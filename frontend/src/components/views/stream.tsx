'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { dataApi, schemaApi, chatApi, configApi, SavedConfig } from '@/lib/api'
import { useMutation } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  Edit3,
  FileJson,
  FileUp,
  HelpCircle,
  Image as ImageIcon,
  Info,
  Key,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Save,
  Trash2,
  Upload,
  User,
  Wand2,
  X,
} from 'lucide-react'
import Image from 'next/image'
import { copyToClipboard } from '@/lib/utils'

interface SchemaField {
  name: string
  type: string
  required?: boolean
  description?: string
}

interface ParsedSchema {
  name: string
  fields: SchemaField[]
}

export function StreamView() {
  const { session, oauthConfig, streamConfig, setStreamConfig } = useAppStore()

  // Step tracking
  const [currentStep, setCurrentStep] = useState(1)

  // Step 1: Ingestion Target
  const [showInstructions, setShowInstructions] = useState(true)

  // Step 2: Schema
  const [yamlContent, setYamlContent] = useState('')
  const [parsedSchema, setParsedSchema] = useState<ParsedSchema | null>(null)
  const [schemaError, setSchemaError] = useState('')

  // Step 3: Required Fields
  const [profileIdField, setProfileIdField] = useState('')
  const [primaryKeyField, setPrimaryKeyField] = useState('')
  const [datetimeField, setDatetimeField] = useState('')

  // Step 4: Data Generation
  const [useCase, setUseCase] = useState('')
  const [useLLM, setUseLLM] = useState(true)
  const [generatedPayload, setGeneratedPayload] = useState<Record<string, any> | null>(null)
  const [editedPayload, setEditedPayload] = useState<Record<string, any> | null>(null)

  // Step 5: Send
  const [lastResponse, setLastResponse] = useState<any>(null)
  const [history, setHistory] = useState<Array<{ timestamp: Date; payload: any; response: any }>>([])

  // Track if we loaded from saved config (to auto-parse)
  const [loadedFromConfig, setLoadedFromConfig] = useState(false)

  // Save config modal
  const [showSaveConfigModal, setShowSaveConfigModal] = useState(false)
  const [saveConfigName, setSaveConfigName] = useState('')
  const [saveConfigDescription, setSaveConfigDescription] = useState('')
  const [isSavingConfig, setIsSavingConfig] = useState(false)

  // Load saved config from sessionStorage (set by ConfigsView)
  useEffect(() => {
    const loadedConfigStr = sessionStorage.getItem('loadedConfig')
    if (loadedConfigStr) {
      try {
        const config = JSON.parse(loadedConfigStr)

        // Load YAML schema if available
        if (config.yaml_schema) {
          setYamlContent(config.yaml_schema)
          setLoadedFromConfig(true)
        }

        // Load required field mappings
        if (config.profile_id_field) setProfileIdField(config.profile_id_field)
        if (config.primary_key_field) setPrimaryKeyField(config.primary_key_field)
        if (config.datetime_field) setDatetimeField(config.datetime_field)

        // Load use case
        if (config.sample_use_case) setUseCase(config.sample_use_case)

        // Load sample payload if available
        if (config.sample_payload) {
          try {
            const payload = JSON.parse(config.sample_payload)
            setGeneratedPayload(payload)
            setEditedPayload(payload)
          } catch (e) {
            console.error('Failed to parse sample payload:', e)
          }
        }

        // Clear the loaded config from sessionStorage (one-time load)
        sessionStorage.removeItem('loadedConfig')
      } catch (e) {
        console.error('Failed to load saved config:', e)
      }
    }
  }, [])

  // Parse YAML schema (supports both OpenAPI 3.0 format and simple format)
  const parseYaml = useCallback((content: string, filename?: string) => {
    try {
      setSchemaError('')
      const lines = content.split('\n')
      let schemaName = ''
      const fields: SchemaField[] = []

      // Detect if this is OpenAPI format
      const isOpenAPI = content.includes('openapi:') && content.includes('components:')

      if (isOpenAPI) {
        // Parse OpenAPI 3.0 format
        // Structure: components.schemas.<ObjectName>.properties.<fieldName>.type
        let inProperties = false
        let currentFieldName = ''
        let currentIndent = 0
        let objectName = ''

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue

          // Find the schema/object name (e.g., CardTransaction:)
          if (line.match(/^\s{4}\w+:$/) && !objectName) {
            const match = trimmed.match(/^(\w+):$/)
            if (match && match[1] !== 'schemas' && match[1] !== 'type' && match[1] !== 'properties') {
              objectName = match[1]
              schemaName = objectName
            }
          }

          // Detect start of properties section
          if (trimmed === 'properties:') {
            inProperties = true
            currentIndent = line.search(/\S/)
            continue
          }

          if (inProperties) {
            const lineIndent = line.search(/\S/)

            // Check if we're still in properties section
            if (lineIndent <= currentIndent && trimmed !== '' && !trimmed.startsWith('-')) {
              inProperties = false
              continue
            }

            // Field name line (e.g., "        card_no:")
            const fieldMatch = trimmed.match(/^(\w+):$/)
            if (fieldMatch && lineIndent === currentIndent + 2) {
              if (currentFieldName) {
                // Save previous field if exists
              }
              currentFieldName = fieldMatch[1]
              continue
            }

            // Type line (e.g., "          type: string")
            if (currentFieldName && trimmed.startsWith('type:')) {
              const typeValue = trimmed.replace('type:', '').trim()
              fields.push({
                name: currentFieldName,
                type: typeValue,
              })
              currentFieldName = ''
            }

            // Format line for additional type info (e.g., "format: date-time")
            if (trimmed.startsWith('format:')) {
              const lastField = fields[fields.length - 1]
              if (lastField) {
                const format = trimmed.replace('format:', '').trim()
                if (format === 'date-time') {
                  lastField.type = 'datetime'
                }
              }
            }
          }
        }

        // Auto-fill object name in config if found
        if (objectName && !streamConfig.objectName) {
          setStreamConfig({ objectName })
        }
        // Note: Source name cannot be reliably extracted from YAML, user must input it
      } else {
        // Parse simple YAML format
        let currentField: Partial<SchemaField> | null = null

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue

          // Schema name
          if (trimmed.startsWith('name:')) {
            schemaName = trimmed.replace('name:', '').trim()
            continue
          }

          // Field start
          if (trimmed.startsWith('- name:')) {
            if (currentField?.name) {
              fields.push(currentField as SchemaField)
            }
            currentField = { name: trimmed.replace('- name:', '').trim() }
            continue
          }

          // Field properties
          if (currentField) {
            if (trimmed.startsWith('type:')) {
              currentField.type = trimmed.replace('type:', '').trim()
            } else if (trimmed.startsWith('required:')) {
              currentField.required = trimmed.replace('required:', '').trim() === 'true'
            } else if (trimmed.startsWith('description:')) {
              currentField.description = trimmed.replace('description:', '').trim()
            }
          }
        }

        // Add last field
        if (currentField?.name) {
          fields.push(currentField as SchemaField)
        }
      }

      if (fields.length === 0) {
        throw new Error('No fields found in schema. Supported formats: OpenAPI 3.0 or simple YAML.')
      }

      setParsedSchema({ name: schemaName || 'Schema', fields })
      return { name: schemaName || 'Schema', fields }
    } catch (e: any) {
      setSchemaError(e.message || 'Failed to parse YAML')
      setParsedSchema(null)
      return null
    }
  }, [streamConfig.objectName, setStreamConfig])

  // Auto-parse YAML when loaded from saved config
  useEffect(() => {
    if (loadedFromConfig && yamlContent.trim()) {
      parseYaml(yamlContent)
      setLoadedFromConfig(false)
    }
  }, [loadedFromConfig, yamlContent, parseYaml])

  // Handle file upload
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const filename = file.name
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      setYamlContent(content)
      parseYaml(content, filename)
    }
    reader.readAsText(file)
  }, [parseYaml])

  // Generate data with LLM
  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!parsedSchema) throw new Error('No schema parsed')

      // Build prompt for LLM
      const schemaDescription = parsedSchema.fields
        .map(f => `- ${f.name} (${f.type})${f.description ? `: ${f.description}` : ''}`)
        .join('\n')

      const prompt = `Generate a realistic sample JSON payload for the following schema based on this use case:

Use Case: ${useCase}

Schema Fields:
${schemaDescription}

Required field mappings:
- Profile ID field: ${profileIdField}
- Primary Key field: ${primaryKeyField} (should be a UUID)
- Engagement DateTime field: ${datetimeField} (should be ISO8601 format with Z suffix)

Generate ONE realistic JSON object that matches this schema. Return ONLY the JSON object, no explanation.`

      const response = await chatApi.send({
        session_id: session.id || '',
        message: prompt,
      })

      // Parse the response to extract JSON
      let jsonMatch = response.message.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('Could not extract JSON from LLM response')
      }

      return JSON.parse(jsonMatch[0])
    },
    onSuccess: (data) => {
      // Ensure required fields have proper values
      const payload = { ...data }
      if (primaryKeyField) {
        payload[primaryKeyField] = crypto.randomUUID()
      }
      if (datetimeField) {
        payload[datetimeField] = new Date().toISOString()
      }
      setGeneratedPayload(payload)
      setEditedPayload(payload)
      toast.success('Payload generated!')
      setCurrentStep(5)
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to generate payload')
      // Fallback to simple generation
      generateFallbackPayload()
    },
  })

  // Fallback payload generation (rule-based)
  const generateFallbackPayload = useCallback(() => {
    if (!parsedSchema) return

    const payload: Record<string, any> = {}

    for (const field of parsedSchema.fields) {
      if (field.name === primaryKeyField) {
        payload[field.name] = crypto.randomUUID()
      } else if (field.name === datetimeField) {
        payload[field.name] = new Date().toISOString()
      } else if (field.name === profileIdField) {
        payload[field.name] = `profile_${Math.random().toString(36).substring(7)}`
      } else {
        // Generate based on type
        switch (field.type?.toLowerCase()) {
          case 'text':
          case 'string':
            payload[field.name] = `Sample ${field.name}`
            break
          case 'number':
          case 'int':
          case 'integer':
            payload[field.name] = Math.floor(Math.random() * 1000)
            break
          case 'decimal':
          case 'float':
          case 'double':
            payload[field.name] = Math.round(Math.random() * 10000) / 100
            break
          case 'boolean':
          case 'bool':
            payload[field.name] = Math.random() > 0.5
            break
          case 'date':
          case 'datetime':
            payload[field.name] = new Date().toISOString()
            break
          default:
            payload[field.name] = `value_${field.name}`
        }
      }
    }

    setGeneratedPayload(payload)
    setEditedPayload(payload)
    toast.success('Payload generated (rule-based)!')
    setCurrentStep(5)
  }, [parsedSchema, primaryKeyField, datetimeField, profileIdField])

  // Stream data to Data Cloud
  const streamMutation = useMutation({
    mutationFn: () =>
      dataApi.streamData({
        session_id: session.id || '',
        source_name: streamConfig.sourceName,
        object_name: streamConfig.objectName,
        records: [editedPayload],
      }),
    onSuccess: (data) => {
      setLastResponse(data)
      setHistory(prev => [{
        timestamp: new Date(),
        payload: editedPayload,
        response: data,
      }, ...prev])
      toast.success('Data streamed successfully!')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to stream data')
    },
  })

  // Update a field in the edited payload
  const updatePayloadField = (fieldName: string, value: any) => {
    setEditedPayload(prev => prev ? { ...prev, [fieldName]: value } : null)
  }

  // Regenerate specific fields
  const regeneratePrimaryKey = () => {
    if (primaryKeyField && editedPayload) {
      updatePayloadField(primaryKeyField, crypto.randomUUID())
    }
  }

  const regenerateDatetime = () => {
    if (datetimeField && editedPayload) {
      updatePayloadField(datetimeField, new Date().toISOString())
    }
  }

  // Save current configuration
  const handleSaveConfig = async () => {
    if (!saveConfigName.trim()) {
      toast.error('Please enter a configuration name')
      return
    }

    setIsSavingConfig(true)
    try {
      const config: SavedConfig = {
        name: saveConfigName.trim(),
        description: saveConfigDescription.trim() || undefined,
        consumer_key: oauthConfig.consumerKey || undefined,
        source_name: streamConfig.sourceName,
        object_name: streamConfig.objectName,
        yaml_schema: yamlContent,
        profile_id_field: profileIdField,
        primary_key_field: primaryKeyField,
        datetime_field: datetimeField,
        sample_use_case: useCase,
        sample_payload: editedPayload ? JSON.stringify(editedPayload, null, 2) : undefined,
      }

      await configApi.save(config)
      toast.success(`Configuration "${saveConfigName}" saved!`)
      setShowSaveConfigModal(false)
      setSaveConfigName('')
      setSaveConfigDescription('')
    } catch (error: any) {
      toast.error(error.message || 'Failed to save configuration')
    } finally {
      setIsSavingConfig(false)
    }
  }

  // Check if can proceed to next step
  const canProceedToStep2 = streamConfig.sourceName && streamConfig.objectName
  const canProceedToStep3 = parsedSchema && parsedSchema.fields.length > 0
  const canProceedToStep4 = profileIdField && primaryKeyField && datetimeField
  const canProceedToStep5 = useCase.trim().length > 0

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-sf-navy-900 mb-2">
            Stream Data to Data Cloud
          </h1>
          <p className="text-sf-navy-500">
            Generate realistic test payloads and send them to the Ingestion API
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
          {[
            { num: 1, label: 'Schema' },
            { num: 2, label: 'Target' },
            { num: 3, label: 'Required Fields' },
            { num: 4, label: 'Generate' },
            { num: 5, label: 'Edit & Send' },
          ].map((step, idx) => (
            <div key={step.num} className="flex items-center">
              <button
                onClick={() => setCurrentStep(step.num)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                  currentStep === step.num
                    ? "bg-sf-blue-500 text-white"
                    : currentStep > step.num
                    ? "bg-green-100 text-green-700"
                    : "bg-sf-navy-100 text-sf-navy-500"
                )}
              >
                {currentStep > step.num ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs">
                    {step.num}
                  </span>
                )}
                {step.label}
              </button>
              {idx < 4 && (
                <ChevronRight className="w-4 h-4 text-sf-navy-300 mx-1" />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Upload Schema (reordered to be first) */}
        {currentStep === 1 && (
          <div className="space-y-6 animate-fade-in">
            <div className="card">
              <div className="p-4 border-b border-sf-navy-100">
                <div className="flex items-center gap-3">
                  <Upload className="w-5 h-5 text-sf-navy-500" />
                  <span className="font-medium text-sf-navy-900">Upload YAML Schema</span>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Instructions with expandable image */}
                <div className="bg-sf-blue-50 border border-sf-blue-200 rounded-lg p-4">
                  <div className="flex gap-3">
                    <Info className="w-5 h-5 text-sf-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-sf-blue-800 flex-1">
                      <p className="font-medium mb-2">How to get the YAML schema from Data Cloud:</p>
                      <ol className="space-y-1 list-decimal list-inside text-sf-blue-700">
                        <li>In Salesforce, go to <strong>Setup</strong></li>
                        <li>Search for <strong>"Ingestion API"</strong> in Quick Find</li>
                        <li>Click on your Ingestion API source</li>
                        <li>In the <strong>Schema</strong> section, click <strong>"Download Schema"</strong></li>
                      </ol>
                      <button
                        onClick={() => setShowInstructions(!showInstructions)}
                        className="mt-3 text-sf-blue-600 hover:text-sf-blue-700 text-xs flex items-center gap-1"
                      >
                        <ImageIcon className="w-3 h-3" />
                        {showInstructions ? 'Hide screenshot' : 'Show screenshot'}
                      </button>
                    </div>
                  </div>
                  {showInstructions && (
                    <div className="mt-4 relative">
                      <img
                        src="/assets/ingestion_api_schema_download.png"
                        alt="Ingestion API schema download in Salesforce Setup"
                        className="rounded-lg border border-sf-blue-200 w-full"
                      />
                    </div>
                  )}
                </div>

                <div className="border-2 border-dashed border-sf-navy-200 rounded-lg p-8 text-center hover:border-sf-blue-400 transition-colors">
                  <input
                    type="file"
                    accept=".yaml,.yml"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="yaml-upload"
                  />
                  <label htmlFor="yaml-upload" className="cursor-pointer">
                    <FileUp className="w-10 h-10 text-sf-navy-400 mx-auto mb-3" />
                    <p className="text-sf-navy-600 font-medium">Drop YAML file here or click to browse</p>
                    <p className="text-sm text-sf-navy-400 mt-1">.yaml or .yml files (OpenAPI 3.0 format supported)</p>
                  </label>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-sf-navy-200" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-3 text-sm text-sf-navy-400">or paste YAML</span>
                  </div>
                </div>

                <textarea
                  className="w-full h-48 font-mono text-sm bg-sf-navy-900 text-sf-navy-100 rounded-lg p-4 focus:outline-none focus:ring-2 focus:ring-sf-blue-500"
                  placeholder={`OpenAPI 3.0 format (from Data Cloud):
openapi: 3.0.3
components:
  schemas:
    MyObject:
      properties:
        field_name:
          type: string

Or simple format:
name: MySchema
fields:
  - name: field_name
    type: text`}
                  value={yamlContent}
                  onChange={(e) => {
                    setYamlContent(e.target.value)
                    if (e.target.value.trim()) {
                      parseYaml(e.target.value)
                    }
                  }}
                />

                {schemaError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                    <span className="text-sm text-red-700">{schemaError}</span>
                  </div>
                )}

                {parsedSchema && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      <span className="font-medium text-green-800">
                        Parsed {parsedSchema.fields.length} fields from "{parsedSchema.name}"
                      </span>
                    </div>
                    {streamConfig.objectName && (
                      <div className="mb-3 text-sm text-green-700">
                        <span className="font-medium">Auto-detected Object Name: </span>
                        <code className="bg-green-100 px-1 rounded">{streamConfig.objectName}</code>
                      </div>
                    )}
                    <div className="overflow-x-auto max-h-48">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-green-700">
                            <th className="pb-2 sticky top-0 bg-green-50">Field Name</th>
                            <th className="pb-2 sticky top-0 bg-green-50">Type</th>
                          </tr>
                        </thead>
                        <tbody className="text-green-800">
                          {parsedSchema.fields.map(field => (
                            <tr key={field.name}>
                              <td className="py-1 font-mono">{field.name}</td>
                              <td className="py-1">{field.type}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setCurrentStep(2)}
                  disabled={!canProceedToStep3}
                  className="btn-primary w-full"
                >
                  Continue to Target Configuration
                  <ChevronRight className="w-4 h-4 ml-2" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Ingestion Target */}
        {currentStep === 2 && (
          <div className="space-y-6 animate-fade-in">
            <div className="card">
              <div className="p-4 border-b border-sf-navy-100">
                <div className="flex items-center gap-3">
                  <Settings className="w-5 h-5 text-sf-navy-500" />
                  <span className="font-medium text-sf-navy-900">Configure Ingestion Target</span>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Instructions with expandable image */}
                <div className="bg-sf-blue-50 border border-sf-blue-200 rounded-lg p-4">
                  <div className="flex gap-3">
                    <HelpCircle className="w-5 h-5 text-sf-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-sf-blue-800 flex-1">
                      <p className="font-medium mb-2">Where to find Source and Object API Names:</p>
                      <ol className="space-y-1 list-decimal list-inside text-sf-blue-700">
                        <li><strong>Source API Name:</strong> In "Connector Details" section</li>
                        <li><strong>Object API Name:</strong> In the "Schema" section header</li>
                      </ol>
                      <button
                        onClick={() => setShowInstructions(!showInstructions)}
                        className="mt-3 text-sf-blue-600 hover:text-sf-blue-700 text-xs flex items-center gap-1"
                      >
                        <ImageIcon className="w-3 h-3" />
                        {showInstructions ? 'Hide screenshot' : 'Show screenshot'}
                      </button>
                    </div>
                  </div>
                  {showInstructions && (
                    <div className="mt-4 relative">
                      <img
                        src="/assets/ingestion_api_schema_download.png"
                        alt="Ingestion API source details in Salesforce Setup"
                        className="rounded-lg border border-sf-blue-200 w-full"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Source API Name</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g., creditcardtransactions"
                      value={streamConfig.sourceName}
                      onChange={(e) => setStreamConfig({ sourceName: e.target.value })}
                    />
                    <p className="text-xs text-sf-navy-400 mt-1">From "Connector Details" in Setup</p>
                  </div>

                  <div>
                    <label className="label">Object API Name</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g., CardTransaction"
                      value={streamConfig.objectName}
                      onChange={(e) => setStreamConfig({ objectName: e.target.value })}
                    />
                    <p className="text-xs text-sf-navy-400 mt-1">From "Schema" section in Setup</p>
                  </div>
                </div>

                {streamConfig.sourceName && streamConfig.objectName && (
                  <div className="bg-sf-navy-50 rounded-lg p-3">
                    <p className="text-xs text-sf-navy-500 mb-1">Endpoint Path:</p>
                    <code className="text-sm text-sf-navy-700 break-all">
                      /api/v1/ingest/sources/{streamConfig.sourceName}/{streamConfig.objectName}
                    </code>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => setCurrentStep(1)}
                    className="btn-ghost"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setCurrentStep(3)}
                    disabled={!canProceedToStep2}
                    className="btn-primary flex-1"
                  >
                    Continue to Required Fields
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Required Fields */}
        {currentStep === 3 && (
          <div className="space-y-6 animate-fade-in">
            <div className="card">
              <div className="p-4 border-b border-sf-navy-100">
                <div className="flex items-center gap-3">
                  <Settings className="w-5 h-5 text-sf-navy-500" />
                  <span className="font-medium text-sf-navy-900">Configure Required Fields</span>
                </div>
              </div>

              <div className="p-4 space-y-6">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                    <div className="text-sm text-amber-800">
                      <p className="font-medium">All three fields below are REQUIRED</p>
                      <p>Data Cloud Streaming Ingestion requires these fields for every record.</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Profile ID Field */}
                  <div className="p-4 border border-sf-navy-200 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <User className="w-5 h-5 text-purple-500" />
                      <span className="font-medium text-sf-navy-900">Profile ID Field</span>
                    </div>
                    <p className="text-xs text-sf-navy-500 mb-3">
                      Links this event to a customer profile for identity resolution.
                    </p>
                    <select
                      className="input"
                      value={profileIdField}
                      onChange={(e) => setProfileIdField(e.target.value)}
                    >
                      <option value="">-- Select Field --</option>
                      {parsedSchema?.fields.map(f => (
                        <option key={f.name} value={f.name}>{f.name}</option>
                      ))}
                    </select>
                    {profileIdField ? (
                      <div className="mt-2 text-green-600 text-sm flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" />
                        {profileIdField}
                      </div>
                    ) : (
                      <div className="mt-2 text-red-500 text-sm">Required</div>
                    )}
                  </div>

                  {/* Primary Key Field */}
                  <div className="p-4 border border-sf-navy-200 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <Key className="w-5 h-5 text-blue-500" />
                      <span className="font-medium text-sf-navy-900">Primary Key Field</span>
                    </div>
                    <p className="text-xs text-sf-navy-500 mb-3">
                      Uniquely identifies each record. Will be auto-generated as UUID.
                    </p>
                    <select
                      className="input"
                      value={primaryKeyField}
                      onChange={(e) => setPrimaryKeyField(e.target.value)}
                    >
                      <option value="">-- Select Field --</option>
                      {parsedSchema?.fields.map(f => (
                        <option key={f.name} value={f.name}>{f.name}</option>
                      ))}
                    </select>
                    {primaryKeyField ? (
                      <div className="mt-2 text-green-600 text-sm flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" />
                        {primaryKeyField}
                      </div>
                    ) : (
                      <div className="mt-2 text-red-500 text-sm">Required</div>
                    )}
                  </div>

                  {/* DateTime Field */}
                  <div className="p-4 border border-sf-navy-200 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <Calendar className="w-5 h-5 text-orange-500" />
                      <span className="font-medium text-sf-navy-900">Engagement DateTime</span>
                    </div>
                    <p className="text-xs text-sf-navy-500 mb-3">
                      Timestamp of the event. Will be generated as ISO8601 format.
                    </p>
                    <select
                      className="input"
                      value={datetimeField}
                      onChange={(e) => setDatetimeField(e.target.value)}
                    >
                      <option value="">-- Select Field --</option>
                      {parsedSchema?.fields.map(f => (
                        <option key={f.name} value={f.name}>{f.name}</option>
                      ))}
                    </select>
                    {datetimeField ? (
                      <div className="mt-2 text-green-600 text-sm flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" />
                        {datetimeField}
                      </div>
                    ) : (
                      <div className="mt-2 text-red-500 text-sm">Required</div>
                    )}
                  </div>
                </div>

                {canProceedToStep4 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <span className="text-green-800">All required fields configured!</span>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => setCurrentStep(2)}
                    className="btn-ghost"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setCurrentStep(4)}
                    disabled={!canProceedToStep4}
                    className="btn-primary flex-1"
                  >
                    Continue to Generate Data
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Generate Data */}
        {currentStep === 4 && (
          <div className="space-y-6 animate-fade-in">
            <div className="card">
              <div className="p-4 border-b border-sf-navy-100">
                <div className="flex items-center gap-3">
                  <Wand2 className="w-5 h-5 text-purple-500" />
                  <span className="font-medium text-sf-navy-900">Generate Test Data</span>
                </div>
              </div>

              <div className="p-4 space-y-4">
                <div className="bg-sf-navy-50 rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-sf-navy-500">
                      <User className="w-4 h-4 inline mr-1" />
                      Profile ID: <code className="text-sf-navy-800">{profileIdField}</code>
                    </span>
                    <span className="text-sf-navy-500">
                      <Key className="w-4 h-4 inline mr-1" />
                      Primary Key: <code className="text-sf-navy-800">{primaryKeyField}</code>
                    </span>
                    <span className="text-sf-navy-500">
                      <Calendar className="w-4 h-4 inline mr-1" />
                      DateTime: <code className="text-sf-navy-800">{datetimeField}</code>
                    </span>
                  </div>
                </div>

                <div>
                  <label className="label">Use Case Description</label>
                  <textarea
                    className="input min-h-[100px]"
                    placeholder="e.g., Customer searched for flights from SIN to HAN on Feb 16, one-way trip, 2 passengers. They viewed 3 flight options and added one to cart."
                    value={useCase}
                    onChange={(e) => setUseCase(e.target.value)}
                  />
                  <p className="text-xs text-sf-navy-400 mt-1">
                    Describe the scenario to generate realistic data
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useLLM}
                      onChange={(e) => setUseLLM(e.target.checked)}
                      className="rounded border-sf-navy-300"
                    />
                    <Sparkles className="w-4 h-4 text-purple-500" />
                    <span className="text-sm text-sf-navy-700">Use AI for intelligent generation</span>
                  </label>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setCurrentStep(3)}
                    className="btn-ghost"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => useLLM ? generateMutation.mutate() : generateFallbackPayload()}
                    disabled={!canProceedToStep5 || generateMutation.isPending}
                    className="btn-primary flex-1"
                  >
                    {generateMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-4 h-4 mr-2" />
                        Generate Payload
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Edit & Send */}
        {currentStep === 5 && editedPayload && (
          <div className="space-y-6 animate-fade-in">
            {/* Required Fields Editor */}
            <div className="card">
              <div className="p-4 border-b border-sf-navy-100">
                <div className="flex items-center gap-3">
                  <Edit3 className="w-5 h-5 text-sf-navy-500" />
                  <span className="font-medium text-sf-navy-900">Required Fields</span>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Profile ID */}
                <div>
                  <label className="label flex items-center gap-2">
                    <User className="w-4 h-4 text-purple-500" />
                    {profileIdField} (Profile ID)
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={editedPayload[profileIdField] || ''}
                    onChange={(e) => updatePayloadField(profileIdField, e.target.value)}
                  />
                </div>

                {/* Primary Key */}
                <div>
                  <label className="label flex items-center gap-2">
                    <Key className="w-4 h-4 text-blue-500" />
                    {primaryKeyField} (Primary Key)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="input flex-1"
                      value={editedPayload[primaryKeyField] || ''}
                      onChange={(e) => updatePayloadField(primaryKeyField, e.target.value)}
                    />
                    <button
                      onClick={regeneratePrimaryKey}
                      className="btn-ghost px-3"
                      title="Generate new UUID"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* DateTime */}
                <div>
                  <label className="label flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-orange-500" />
                    {datetimeField} (Engagement DateTime)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="input flex-1"
                      value={editedPayload[datetimeField] || ''}
                      onChange={(e) => updatePayloadField(datetimeField, e.target.value)}
                    />
                    <button
                      onClick={regenerateDatetime}
                      className="btn-ghost px-3"
                      title="Set to now"
                    >
                      Now
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Other Fields Editor */}
            <div className="card">
              <div className="p-4 border-b border-sf-navy-100">
                <div className="flex items-center gap-3">
                  <FileJson className="w-5 h-5 text-sf-navy-500" />
                  <span className="font-medium text-sf-navy-900">Other Fields</span>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {parsedSchema?.fields
                  .filter(f => ![profileIdField, primaryKeyField, datetimeField].includes(f.name))
                  .map(field => (
                    <div key={field.name}>
                      <label className="label">{field.name}</label>
                      {field.type === 'boolean' || field.type === 'bool' ? (
                        <select
                          className="input"
                          value={String(editedPayload[field.name])}
                          onChange={(e) => updatePayloadField(field.name, e.target.value === 'true')}
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : field.type === 'number' || field.type === 'int' || field.type === 'integer' ? (
                        <input
                          type="number"
                          className="input"
                          value={editedPayload[field.name] || 0}
                          onChange={(e) => updatePayloadField(field.name, parseFloat(e.target.value) || 0)}
                        />
                      ) : (
                        <input
                          type="text"
                          className="input"
                          value={editedPayload[field.name] || ''}
                          onChange={(e) => updatePayloadField(field.name, e.target.value)}
                        />
                      )}
                    </div>
                  ))}
              </div>
            </div>

            {/* Payload Preview & Send */}
            <div className="card">
              <div className="p-4 border-b border-sf-navy-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Code className="w-5 h-5 text-sf-navy-500" />
                    <span className="font-medium text-sf-navy-900">Payload Preview</span>
                  </div>
                  <button
                    onClick={() => {
                      copyToClipboard(JSON.stringify(editedPayload, null, 2))
                      toast.success('Copied!')
                    }}
                    className="btn-ghost p-2"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-4">
                <div className="bg-sf-navy-900 rounded-lg p-4 max-h-64 overflow-y-auto">
                  <pre className="text-sm text-sf-navy-100 font-mono">
                    {JSON.stringify(editedPayload, null, 2)}
                  </pre>
                </div>

                <div className="bg-sf-navy-50 rounded-lg p-3 text-sm">
                  <span className="text-sf-navy-500">Target: </span>
                  <code className="text-sf-navy-700">
                    /api/v1/ingest/sources/{streamConfig.sourceName}/{streamConfig.objectName}
                  </code>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setCurrentStep(4)}
                    className="btn-ghost"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => {
                      // Regenerate with new values
                      if (primaryKeyField) {
                        updatePayloadField(primaryKeyField, crypto.randomUUID())
                      }
                      if (datetimeField) {
                        updatePayloadField(datetimeField, new Date().toISOString())
                      }
                    }}
                    className="btn-ghost"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    New IDs
                  </button>
                  <button
                    onClick={() => streamMutation.mutate()}
                    disabled={streamMutation.isPending}
                    className="btn-primary flex-1"
                  >
                    {streamMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Send to Data Cloud
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Response */}
            {lastResponse && (
              <div className="card animate-slide-up">
                <div className="p-4 border-b border-sf-navy-100">
                  <div className="flex items-center gap-3">
                    {lastResponse.success ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    )}
                    <span className="font-medium text-sf-navy-900">
                      Data Cloud Response
                    </span>
                    {lastResponse.success && (
                      <span className="badge-green text-xs">
                        {lastResponse.records_sent} record(s) sent
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  {lastResponse.results?.map((result: any, idx: number) => (
                    <div
                      key={idx}
                      className={cn(
                        "rounded-lg p-4 border",
                        result.status_code >= 200 && result.status_code < 300
                          ? "bg-green-50 border-green-200"
                          : "bg-red-50 border-red-200"
                      )}
                    >
                      <div className="flex items-center gap-4 mb-2">
                        <span className={cn(
                          "font-medium",
                          result.status_code >= 200 && result.status_code < 300
                            ? "text-green-800"
                            : "text-red-800"
                        )}>
                          Status: {result.status_code}
                        </span>
                        {result.correlation_id && (
                          <span className="text-sm text-sf-navy-500">
                            Correlation ID: <code className="text-xs">{result.correlation_id}</code>
                          </span>
                        )}
                      </div>
                      {result.response_body && (
                        <pre className={cn(
                          "text-xs font-mono overflow-x-auto whitespace-pre-wrap",
                          result.status_code >= 200 && result.status_code < 300
                            ? "text-green-700"
                            : "text-red-700"
                        )}>
                          {result.response_body}
                        </pre>
                      )}
                    </div>
                  ))}
                  {!lastResponse.results && (
                    <pre className="text-sm text-sf-navy-700 font-mono overflow-x-auto">
                      {JSON.stringify(lastResponse, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            )}

            {/* History */}
            {history.length > 0 && (
              <div className="card">
                <div className="p-4 border-b border-sf-navy-100">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sf-navy-900">
                      Ingestion History ({history.length})
                    </span>
                    <button
                      onClick={() => setHistory([])}
                      className="btn-ghost text-sm py-1 px-2 text-red-600"
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Clear
                    </button>
                  </div>
                </div>
                <div className="divide-y divide-sf-navy-100 max-h-64 overflow-y-auto">
                  {history.map((item, idx) => (
                    <div key={idx} className="p-3 hover:bg-sf-navy-50">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-sf-navy-500">
                          {item.timestamp.toLocaleTimeString()}
                        </span>
                        <span className="text-xs text-green-600">
                          {item.response?.success ? 'Success' : 'Sent'}
                        </span>
                      </div>
                      <code className="text-xs text-sf-navy-600 block truncate">
                        {item.payload[primaryKeyField]}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Save Configuration */}
            {lastResponse?.success && (
              <div className="card bg-gradient-to-r from-sf-blue-50 to-purple-50 border-sf-blue-200">
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-sf-navy-900">Save this configuration?</h3>
                      <p className="text-sm text-sf-navy-500">
                        Save your schema, field mappings, and settings for future use
                      </p>
                    </div>
                    <button
                      onClick={() => setShowSaveConfigModal(true)}
                      className="btn-primary"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      Save Config
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Save Config Modal */}
        {showSaveConfigModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
              <div className="p-6 border-b border-sf-navy-100 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-sf-navy-900">
                  Save Configuration
                </h2>
                <button
                  onClick={() => setShowSaveConfigModal(false)}
                  className="btn-ghost p-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="label">Configuration Name *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., VietnamAir Credit Card Transactions"
                    value={saveConfigName}
                    onChange={(e) => setSaveConfigName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label">Description (optional)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Brief description of this configuration"
                    value={saveConfigDescription}
                    onChange={(e) => setSaveConfigDescription(e.target.value)}
                  />
                </div>

                <div className="bg-sf-navy-50 rounded-lg p-3 text-sm">
                  <p className="font-medium text-sf-navy-700 mb-2">Will save:</p>
                  <ul className="space-y-1 text-sf-navy-600">
                    {oauthConfig.consumerKey && (
                      <li>• Consumer Key: <code className="text-xs">{oauthConfig.consumerKey.substring(0, 20)}...</code></li>
                    )}
                    <li>• Source: <code>{streamConfig.sourceName}</code></li>
                    <li>• Object: <code>{streamConfig.objectName}</code></li>
                    <li>• Schema: {parsedSchema?.fields.length || 0} fields</li>
                    <li>• Field mappings (Profile ID, Primary Key, DateTime)</li>
                    <li>• Sample use case</li>
                    {editedPayload && <li>• Sample payload (current data)</li>}
                  </ul>
                </div>
              </div>

              <div className="p-6 border-t border-sf-navy-100 flex justify-end gap-3">
                <button
                  onClick={() => setShowSaveConfigModal(false)}
                  className="btn-ghost"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveConfig}
                  disabled={isSavingConfig || !saveConfigName.trim()}
                  className="btn-primary"
                >
                  {isSavingConfig ? (
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

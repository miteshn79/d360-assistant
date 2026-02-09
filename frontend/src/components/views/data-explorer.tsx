'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAppStore } from '@/lib/store'
import { dataApi } from '@/lib/api'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  Database,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Table,
  Trash2,
  X,
} from 'lucide-react'
import { copyToClipboard } from '@/lib/utils'

// Filter types and interfaces
type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'greater_or_equal'
  | 'less_or_equal'
  | 'is_null'
  | 'is_not_null'
  | 'in_list'

type FilterLogic = 'AND' | 'OR'

interface FilterCondition {
  id: string
  field: string
  operator: FilterOperator
  value: string
  fieldType?: string
}

interface FilterGroup {
  id: string
  logic: FilterLogic
  conditions: FilterCondition[]
}

interface FieldInfo {
  name: string
  label?: string
  type: string
  isNullable?: boolean
}

// Operator labels and info
const OPERATORS: { value: FilterOperator; label: string; requiresValue: boolean; types: string[] }[] = [
  { value: 'equals', label: 'equals', requiresValue: true, types: ['all'] },
  { value: 'not_equals', label: 'not equals', requiresValue: true, types: ['all'] },
  { value: 'contains', label: 'contains', requiresValue: true, types: ['string', 'text'] },
  { value: 'not_contains', label: 'does not contain', requiresValue: true, types: ['string', 'text'] },
  { value: 'starts_with', label: 'starts with', requiresValue: true, types: ['string', 'text'] },
  { value: 'ends_with', label: 'ends with', requiresValue: true, types: ['string', 'text'] },
  { value: 'greater_than', label: 'greater than', requiresValue: true, types: ['number', 'date', 'datetime'] },
  { value: 'less_than', label: 'less than', requiresValue: true, types: ['number', 'date', 'datetime'] },
  { value: 'greater_or_equal', label: 'greater or equal', requiresValue: true, types: ['number', 'date', 'datetime'] },
  { value: 'less_or_equal', label: 'less or equal', requiresValue: true, types: ['number', 'date', 'datetime'] },
  { value: 'is_null', label: 'is null', requiresValue: false, types: ['all'] },
  { value: 'is_not_null', label: 'is not null', requiresValue: false, types: ['all'] },
  { value: 'in_list', label: 'in list', requiresValue: true, types: ['all'] },
]

// Get operators available for a field type
function getOperatorsForType(fieldType: string): typeof OPERATORS {
  const normalizedType = fieldType.toLowerCase()
  return OPERATORS.filter(op =>
    op.types.includes('all') ||
    op.types.some(t => normalizedType.includes(t))
  )
}

// Generate unique ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

// Escape SQL string value
function escapeSqlValue(value: string): string {
  return value.replace(/'/g, "''")
}

// Build SQL WHERE clause from filters
function buildWhereClause(groups: FilterGroup[]): string {
  if (groups.length === 0) return ''

  const groupClauses = groups.map(group => {
    if (group.conditions.length === 0) return null

    const conditions = group.conditions.map(cond => {
      const fieldName = cond.field
      const value = cond.value

      switch (cond.operator) {
        case 'equals':
          return `${fieldName} = '${escapeSqlValue(value)}'`
        case 'not_equals':
          return `${fieldName} != '${escapeSqlValue(value)}'`
        case 'contains':
          return `${fieldName} LIKE '%${escapeSqlValue(value)}%'`
        case 'not_contains':
          return `${fieldName} NOT LIKE '%${escapeSqlValue(value)}%'`
        case 'starts_with':
          return `${fieldName} LIKE '${escapeSqlValue(value)}%'`
        case 'ends_with':
          return `${fieldName} LIKE '%${escapeSqlValue(value)}'`
        case 'greater_than':
          return `${fieldName} > '${escapeSqlValue(value)}'`
        case 'less_than':
          return `${fieldName} < '${escapeSqlValue(value)}'`
        case 'greater_or_equal':
          return `${fieldName} >= '${escapeSqlValue(value)}'`
        case 'less_or_equal':
          return `${fieldName} <= '${escapeSqlValue(value)}'`
        case 'is_null':
          return `${fieldName} IS NULL`
        case 'is_not_null':
          return `${fieldName} IS NOT NULL`
        case 'in_list':
          const values = value.split(',').map(v => `'${escapeSqlValue(v.trim())}'`).join(', ')
          return `${fieldName} IN (${values})`
        default:
          return null
      }
    }).filter(Boolean)

    if (conditions.length === 0) return null
    if (conditions.length === 1) return conditions[0]
    return `(${conditions.join(` ${group.logic} `)})`
  }).filter(Boolean)

  if (groupClauses.length === 0) return ''
  return groupClauses.join(' AND ')
}

// Filter Condition Component
function FilterConditionRow({
  condition,
  fields,
  onUpdate,
  onRemove,
  showRemove,
}: {
  condition: FilterCondition
  fields: FieldInfo[]
  onUpdate: (updates: Partial<FilterCondition>) => void
  onRemove: () => void
  showRemove: boolean
}) {
  const selectedField = fields.find(f => f.name === condition.field)
  const fieldType = selectedField?.type || 'string'
  const availableOperators = getOperatorsForType(fieldType)
  const selectedOperator = OPERATORS.find(op => op.value === condition.operator)
  const requiresValue = selectedOperator?.requiresValue ?? true

  return (
    <div className="flex items-center gap-2 p-3 bg-sf-navy-50 rounded-lg">
      {/* Field Selector */}
      <select
        className="input flex-1 min-w-[180px]"
        value={condition.field}
        onChange={(e) => onUpdate({ field: e.target.value })}
      >
        <option value="">Select field...</option>
        {fields.map(field => (
          <option key={field.name} value={field.name}>
            {field.label || field.name}
          </option>
        ))}
      </select>

      {/* Operator Selector */}
      <select
        className="input w-40"
        value={condition.operator}
        onChange={(e) => onUpdate({ operator: e.target.value as FilterOperator })}
      >
        {availableOperators.map(op => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>

      {/* Value Input */}
      {requiresValue && (
        <input
          type={fieldType.includes('number') ? 'number' : fieldType.includes('date') ? 'date' : 'text'}
          className="input flex-1 min-w-[150px]"
          placeholder={condition.operator === 'in_list' ? 'value1, value2, ...' : 'Enter value...'}
          value={condition.value}
          onChange={(e) => onUpdate({ value: e.target.value })}
        />
      )}

      {/* Remove Button */}
      {showRemove && (
        <button
          onClick={onRemove}
          className="p-2 text-sf-navy-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

// Filter Group Component
function FilterGroupCard({
  group,
  groupIndex,
  fields,
  onUpdate,
  onRemove,
  showRemove,
}: {
  group: FilterGroup
  groupIndex: number
  fields: FieldInfo[]
  onUpdate: (updates: Partial<FilterGroup>) => void
  onRemove: () => void
  showRemove: boolean
}) {
  const addCondition = () => {
    const newCondition: FilterCondition = {
      id: generateId(),
      field: '',
      operator: 'equals',
      value: '',
    }
    onUpdate({ conditions: [...group.conditions, newCondition] })
  }

  const updateCondition = (conditionId: string, updates: Partial<FilterCondition>) => {
    onUpdate({
      conditions: group.conditions.map(c =>
        c.id === conditionId ? { ...c, ...updates } : c
      ),
    })
  }

  const removeCondition = (conditionId: string) => {
    onUpdate({
      conditions: group.conditions.filter(c => c.id !== conditionId),
    })
  }

  return (
    <div className="border border-sf-navy-200 rounded-xl overflow-hidden">
      {/* Group Header */}
      <div className="bg-white px-4 py-3 border-b border-sf-navy-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Filter className="w-4 h-4 text-sf-blue-500" />
          <span className="font-medium text-sf-navy-700">Filter Group {groupIndex + 1}</span>

          {/* Logic Toggle */}
          <div className="flex items-center bg-sf-navy-100 rounded-lg p-0.5">
            <button
              onClick={() => onUpdate({ logic: 'AND' })}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                group.logic === 'AND'
                  ? 'bg-sf-blue-500 text-white'
                  : 'text-sf-navy-600 hover:text-sf-navy-800'
              )}
            >
              AND
            </button>
            <button
              onClick={() => onUpdate({ logic: 'OR' })}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                group.logic === 'OR'
                  ? 'bg-sf-blue-500 text-white'
                  : 'text-sf-navy-600 hover:text-sf-navy-800'
              )}
            >
              OR
            </button>
          </div>
        </div>

        {showRemove && (
          <button
            onClick={onRemove}
            className="p-1.5 text-sf-navy-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Conditions */}
      <div className="p-4 space-y-2 bg-sf-navy-25">
        {group.conditions.length === 0 ? (
          <div className="text-center py-4 text-sf-navy-400 text-sm">
            No conditions. Click "Add Condition" to start filtering.
          </div>
        ) : (
          group.conditions.map((condition, index) => (
            <div key={condition.id}>
              {index > 0 && (
                <div className="text-center py-1">
                  <span className="text-xs font-medium text-sf-blue-600 bg-sf-blue-50 px-2 py-0.5 rounded">
                    {group.logic}
                  </span>
                </div>
              )}
              <FilterConditionRow
                condition={condition}
                fields={fields}
                onUpdate={(updates) => updateCondition(condition.id, updates)}
                onRemove={() => removeCondition(condition.id)}
                showRemove={group.conditions.length > 1}
              />
            </div>
          ))
        )}

        {/* Add Condition Button */}
        <button
          onClick={addCondition}
          className="w-full py-2 border-2 border-dashed border-sf-navy-200 rounded-lg text-sf-navy-500 hover:border-sf-blue-400 hover:text-sf-blue-600 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Condition
        </button>
      </div>
    </div>
  )
}

// Results Table Component
function ResultsTable({ data, columns }: { data: any[]; columns: string[] }) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-sf-navy-400">
        <Table className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>No results found</p>
      </div>
    )
  }

  // Limit columns displayed in table (show rest in expanded view)
  const displayColumns = columns.slice(0, 6)
  const hasMoreColumns = columns.length > 6

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-sf-navy-200">
            <th className="w-8"></th>
            {displayColumns.map(col => (
              <th
                key={col}
                className="px-4 py-3 text-left font-medium text-sf-navy-600 bg-sf-navy-50"
              >
                {col.replace(/^ssot__/, '').replace(/__c$/, '')}
              </th>
            ))}
            {hasMoreColumns && (
              <th className="px-4 py-3 text-left font-medium text-sf-navy-400 bg-sf-navy-50">
                +{columns.length - 6} more
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <>
              <tr
                key={rowIndex}
                className={cn(
                  'border-b border-sf-navy-100 hover:bg-sf-navy-50 cursor-pointer',
                  expandedRow === rowIndex && 'bg-sf-blue-50'
                )}
                onClick={() => setExpandedRow(expandedRow === rowIndex ? null : rowIndex)}
              >
                <td className="px-2">
                  {expandedRow === rowIndex ? (
                    <ChevronDown className="w-4 h-4 text-sf-navy-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-sf-navy-400" />
                  )}
                </td>
                {displayColumns.map(col => (
                  <td key={col} className="px-4 py-3 text-sf-navy-700">
                    <span className="block max-w-[200px] truncate" title={String(row[col] ?? '')}>
                      {row[col] !== null && row[col] !== undefined ? String(row[col]) : '-'}
                    </span>
                  </td>
                ))}
                {hasMoreColumns && <td></td>}
              </tr>
              {expandedRow === rowIndex && (
                <tr className="bg-sf-blue-50">
                  <td colSpan={displayColumns.length + 2} className="px-4 py-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {columns.map(col => (
                        <div key={col} className="text-sm">
                          <span className="text-sf-navy-400 text-xs block">
                            {col.replace(/^ssot__/, '').replace(/__c$/, '')}
                          </span>
                          <span className="text-sf-navy-700 break-all">
                            {row[col] !== null && row[col] !== undefined ? String(row[col]) : '-'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Main Data Explorer Component
export function DataExplorerView() {
  const { session, dcMetadata, setDCMetadata } = useAppStore()

  // State
  const [selectedObject, setSelectedObject] = useState('')
  const [objectFields, setObjectFields] = useState<FieldInfo[]>([])
  const [isLoadingFields, setIsLoadingFields] = useState(false)
  const [filterGroups, setFilterGroups] = useState<FilterGroup[]>([
    { id: generateId(), logic: 'AND', conditions: [] }
  ])
  const [selectFields, setSelectFields] = useState<string[]>([])
  const [selectAll, setSelectAll] = useState(true)
  const [limit, setLimit] = useState(100)
  const [results, setResults] = useState<any[] | null>(null)
  const [resultColumns, setResultColumns] = useState<string[]>([])
  const [showSqlPreview, setShowSqlPreview] = useState(false)
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false)

  // Auto-fetch metadata on mount
  useEffect(() => {
    if (session.hasDCToken && dcMetadata.dataGraphs.length === 0 && !dcMetadata.isLoading) {
      handleRefreshMetadata(false)
    }
  }, [session.hasDCToken])

  // Fetch fields when object changes
  useEffect(() => {
    if (selectedObject && session.id) {
      fetchObjectFields(selectedObject)
    } else {
      setObjectFields([])
    }
  }, [selectedObject, session.id])

  // Handle metadata refresh
  const handleRefreshMetadata = async (showToast = true) => {
    if (!session.id) return
    setIsRefreshingMetadata(true)
    setDCMetadata({ isLoading: true, error: null })
    try {
      const metadata = await dataApi.getDataGraphs(session.id)
      setDCMetadata({
        dataGraphs: metadata.dataGraphs || [],
        dmos: metadata.dmos || [],
        dlos: metadata.dlos || [],
        isLoading: false,
        error: null,
      })
      if (showToast) {
        toast.success('Metadata refreshed!')
      }
    } catch (error: any) {
      setDCMetadata({ isLoading: false, error: error.message })
      if (showToast) {
        toast.error('Failed to load metadata')
      }
    } finally {
      setIsRefreshingMetadata(false)
    }
  }

  // Fetch fields for selected object
  const fetchObjectFields = async (objectName: string) => {
    if (!session.id) return
    setIsLoadingFields(true)
    try {
      // Query to get field metadata - use DESCRIBE-like query or sample query
      const sql = `SELECT * FROM ${objectName} LIMIT 1`
      const response = await dataApi.query(session.id, sql)

      // Extract field names from the response
      if (response.data && response.data.length > 0) {
        const fields: FieldInfo[] = Object.keys(response.data[0]).map(key => ({
          name: key,
          label: key.replace(/^ssot__/, '').replace(/__c$/, '').replace(/_/g, ' '),
          type: inferFieldType(response.data[0][key]),
        }))
        setObjectFields(fields)
      } else {
        // If no data, try to infer from metadata response
        if (response.metadata) {
          const fields: FieldInfo[] = Object.entries(response.metadata).map(([key, meta]: [string, any]) => ({
            name: key,
            label: meta.label || key,
            type: meta.type || 'string',
          }))
          setObjectFields(fields)
        } else {
          setObjectFields([])
          toast.error('Could not fetch field metadata. Try running a query first.')
        }
      }
    } catch (error: any) {
      console.error('Failed to fetch fields:', error)
      setObjectFields([])
      toast.error('Failed to fetch field metadata')
    } finally {
      setIsLoadingFields(false)
    }
  }

  // Infer field type from value
  const inferFieldType = (value: any): string => {
    if (value === null || value === undefined) return 'string'
    if (typeof value === 'number') return 'number'
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'string') {
      // Check for date patterns
      if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'datetime'
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date'
    }
    return 'string'
  }

  // Build SQL query
  const generatedSql = useMemo(() => {
    if (!selectedObject) return ''

    const fields = selectAll ? '*' : (selectFields.length > 0 ? selectFields.join(', ') : '*')
    const whereClause = buildWhereClause(filterGroups)

    let sql = `SELECT ${fields}\nFROM ${selectedObject}`
    if (whereClause) {
      sql += `\nWHERE ${whereClause}`
    }
    sql += `\nLIMIT ${limit}`

    return sql
  }, [selectedObject, selectAll, selectFields, filterGroups, limit])

  // Execute query mutation
  const queryMutation = useMutation({
    mutationFn: () => dataApi.query(session.id || '', generatedSql),
    onSuccess: (data) => {
      setResults(data.data || [])
      if (data.data && data.data.length > 0) {
        setResultColumns(Object.keys(data.data[0]))
      } else {
        setResultColumns([])
      }
      toast.success(`Found ${data.data?.length || 0} records`)
    },
    onError: (error: any) => {
      toast.error(error.message || 'Query failed')
      setResults(null)
    },
  })

  // Filter group management
  const addFilterGroup = () => {
    setFilterGroups([...filterGroups, { id: generateId(), logic: 'AND', conditions: [] }])
  }

  const updateFilterGroup = (groupId: string, updates: Partial<FilterGroup>) => {
    setFilterGroups(groups =>
      groups.map(g => (g.id === groupId ? { ...g, ...updates } : g))
    )
  }

  const removeFilterGroup = (groupId: string) => {
    setFilterGroups(groups => groups.filter(g => g.id !== groupId))
  }

  const clearAllFilters = () => {
    setFilterGroups([{ id: generateId(), logic: 'AND', conditions: [] }])
  }

  // Check if we have valid filters
  const hasValidFilters = filterGroups.some(g =>
    g.conditions.some(c => c.field && (c.operator === 'is_null' || c.operator === 'is_not_null' || c.value))
  )

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-sf-navy-900 mb-2">Data Explorer</h1>
          <p className="text-sf-navy-500">
            Query DLOs and DMOs with dynamic filters
          </p>
        </div>

        {/* Object Selection */}
        <div className="card mb-6">
          <div className="p-6">
            <h2 className="font-medium text-sf-navy-900 mb-4 flex items-center gap-2">
              <Database className="w-5 h-5 text-sf-blue-500" />
              Select Data Object
            </h2>

            <div className="flex items-end gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <label className="label mb-0">DLO / DMO</label>
                  {session.hasDCToken && (
                    <button
                      onClick={() => handleRefreshMetadata()}
                      disabled={isRefreshingMetadata}
                      className="text-xs text-sf-blue-600 hover:text-sf-blue-700 flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3 h-3 ${isRefreshingMetadata ? 'animate-spin' : ''}`} />
                      {isRefreshingMetadata ? 'Loading...' : 'Refresh'}
                    </button>
                  )}
                </div>
                {dcMetadata.dmos.length > 0 || dcMetadata.dlos.length > 0 ? (
                  <select
                    className="input"
                    value={selectedObject}
                    onChange={(e) => {
                      setSelectedObject(e.target.value)
                      setResults(null)
                      clearAllFilters()
                    }}
                  >
                    <option value="">-- Select Object --</option>
                    {dcMetadata.dmos.length > 0 && (
                      <optgroup label="DMOs (Data Model Objects)">
                        {dcMetadata.dmos.map((dmo) => (
                          <option key={dmo.name} value={dmo.name}>
                            {dmo.label || dmo.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {dcMetadata.dlos.length > 0 && (
                      <optgroup label="DLOs (Data Lake Objects)">
                        {dcMetadata.dlos.map((dlo) => (
                          <option key={dlo.name} value={dlo.name}>
                            {dlo.label || dlo.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="input"
                    placeholder="Enter DLO/DMO name..."
                    value={selectedObject}
                    onChange={(e) => setSelectedObject(e.target.value)}
                  />
                )}
              </div>

              <div className="w-32">
                <label className="label">Limit</label>
                <select
                  className="input"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                >
                  <option value={10}>10</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={500}>500</option>
                  <option value={1000}>1000</option>
                </select>
              </div>
            </div>

            {isLoadingFields && (
              <div className="mt-4 flex items-center gap-2 text-sf-navy-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading field metadata...
              </div>
            )}

            {objectFields.length > 0 && (
              <div className="mt-4 p-3 bg-sf-navy-50 rounded-lg">
                <span className="text-sm text-sf-navy-600">
                  {objectFields.length} fields available for filtering
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Filter Builder */}
        {selectedObject && (
          <div className="card mb-6">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-medium text-sf-navy-900 flex items-center gap-2">
                  <Filter className="w-5 h-5 text-sf-blue-500" />
                  Filters
                </h2>
                <div className="flex items-center gap-2">
                  {filterGroups.length > 0 && hasValidFilters && (
                    <button
                      onClick={clearAllFilters}
                      className="text-sm text-sf-navy-500 hover:text-red-500 flex items-center gap-1"
                    >
                      <X className="w-4 h-4" />
                      Clear All
                    </button>
                  )}
                </div>
              </div>

              {objectFields.length === 0 && !isLoadingFields ? (
                <div className="text-center py-8 text-sf-navy-400">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>Select an object to load available fields for filtering</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filterGroups.map((group, index) => (
                    <div key={group.id}>
                      {index > 0 && (
                        <div className="text-center py-2">
                          <span className="text-sm font-medium text-sf-navy-500 bg-sf-navy-100 px-3 py-1 rounded-full">
                            AND
                          </span>
                        </div>
                      )}
                      <FilterGroupCard
                        group={group}
                        groupIndex={index}
                        fields={objectFields}
                        onUpdate={(updates) => updateFilterGroup(group.id, updates)}
                        onRemove={() => removeFilterGroup(group.id)}
                        showRemove={filterGroups.length > 1}
                      />
                    </div>
                  ))}

                  {/* Add Group Button */}
                  <button
                    onClick={addFilterGroup}
                    className="w-full py-3 border-2 border-dashed border-sf-navy-200 rounded-xl text-sf-navy-500 hover:border-sf-blue-400 hover:text-sf-blue-600 transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Filter Group (AND)
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SQL Preview & Execute */}
        {selectedObject && (
          <div className="card mb-6">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => setShowSqlPreview(!showSqlPreview)}
                  className="font-medium text-sf-navy-900 flex items-center gap-2 hover:text-sf-blue-600"
                >
                  <Code className="w-5 h-5 text-sf-blue-500" />
                  SQL Preview
                  {showSqlPreview ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => {
                    copyToClipboard(generatedSql)
                    toast.success('SQL copied!')
                  }}
                  className="text-sm text-sf-navy-500 hover:text-sf-blue-600 flex items-center gap-1"
                >
                  <Copy className="w-4 h-4" />
                  Copy
                </button>
              </div>

              {showSqlPreview && (
                <pre className="bg-sf-navy-900 text-sf-navy-100 p-4 rounded-lg text-sm font-mono overflow-x-auto mb-4">
                  {generatedSql}
                </pre>
              )}

              <button
                onClick={() => queryMutation.mutate()}
                disabled={queryMutation.isPending || !selectedObject}
                className="btn-primary w-full py-3"
              >
                {queryMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Running Query...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    Run Query
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Results */}
        {results !== null && (
          <div className="card">
            <div className="p-4 border-b border-sf-navy-200 flex items-center justify-between">
              <h2 className="font-medium text-sf-navy-900 flex items-center gap-2">
                <Table className="w-5 h-5 text-sf-blue-500" />
                Results
                <span className="text-sm font-normal text-sf-navy-500">
                  ({results.length} records)
                </span>
              </h2>
            </div>
            <div className="p-4">
              <ResultsTable data={results} columns={resultColumns} />
            </div>
          </div>
        )}

        {/* Empty State */}
        {!selectedObject && (
          <div className="card p-12 text-center">
            <Database className="w-16 h-16 text-sf-navy-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-sf-navy-700 mb-2">Select a Data Object</h3>
            <p className="text-sf-navy-500 max-w-md mx-auto">
              Choose a DLO or DMO from the dropdown above to start building your query with dynamic filters.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

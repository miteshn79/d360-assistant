'use client'

import { useState, useMemo, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { dataApi, configApi, SavedConfig } from '@/lib/api'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  Columns,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Table,
  User,
  X,
} from 'lucide-react'
import { copyToClipboard, downloadFile } from '@/lib/utils'

interface TableData {
  name: string
  columns: string[]
  rows: Record<string, any>[]
  isEventTable: boolean
}

interface SortConfig {
  column: string
  direction: 'asc' | 'desc'
}

// Detect if a column is a datetime column based on name or value
function isDateTimeColumn(columnName: string, sampleValue: any): boolean {
  const dateTimePatterns = [
    'date', 'time', 'timestamp', 'created', 'modified', 'updated',
    'datetime', 'at', 'on', 'start', 'end', 'engagement'
  ]
  const nameLower = columnName.toLowerCase()

  if (dateTimePatterns.some(p => nameLower.includes(p))) {
    return true
  }

  // Check if value looks like ISO date
  if (typeof sampleValue === 'string' && sampleValue.match(/^\d{4}-\d{2}-\d{2}/)) {
    return true
  }

  return false
}

// Detect if a table is an events table
function isEventsTable(tableName: string): boolean {
  const eventPatterns = ['event', 'transaction', 'activity', 'engagement', 'interaction', 'history']
  const nameLower = tableName.toLowerCase()
  return eventPatterns.some(p => nameLower.includes(p))
}

// Parse json_blob__c from Data Graph API response
function parseDataGraphResponse(rawData: any): any {
  // Data Graph API returns: {"data": {"data": [...], "done": true, ...}}
  // The inner data array may contain items with json_blob__c that holds the actual profile JSON

  let data = rawData

  // Unwrap outer data wrapper if present
  if (data && typeof data === 'object' && 'data' in data && typeof data.data === 'object') {
    data = data.data
  }

  // Check if there's a json_blob__c that needs parsing
  if (data && typeof data === 'object' && 'data' in data && Array.isArray(data.data)) {
    for (const item of data.data) {
      if (item && typeof item === 'object' && 'json_blob__c' in item) {
        try {
          const parsed = JSON.parse(item.json_blob__c)
          return parsed
        } catch (e) {
          // If parsing fails, continue with raw data
          console.warn('Failed to parse json_blob__c:', e)
        }
      }
    }
  }

  return data
}

// Format table name for display (remove __dlm, __cio suffixes and make readable)
function formatTableName(name: string): string {
  // Remove common suffixes
  let formatted = name
    .replace(/__dlm$/i, '')
    .replace(/__cio$/i, '')
    .replace(/__c$/i, '')
    .replace(/^ssot__/, '')

  // Split camelCase and underscores into words
  formatted = formatted
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()

  return formatted || name
}

// Determine table category for sorting: 0=Profile, 1=Events, 2=Insights, 3=Links
function getTableCategory(name: string): number {
  const nameLower = name.toLowerCase()

  // Identity links go last
  if (nameLower.includes('link') || nameLower.includes('identity')) {
    return 3
  }

  // Insights come before links
  if (nameLower.includes('insight') || nameLower.includes('__cio')) {
    return 2
  }

  // Events/engagements in the middle
  if (nameLower.includes('engagement') || nameLower.includes('event') ||
      nameLower.includes('transaction') || nameLower.includes('activity') ||
      nameLower.includes('browse') || nameLower.includes('cart') ||
      nameLower.includes('order') || nameLower.includes('website')) {
    return 1
  }

  // Profile and other basic info first
  return 0
}

// Recursively find all arrays of objects in the data structure
function findAllTables(data: any, foundTables: Map<string, any[]>, visited: Set<any> = new Set()): void {
  if (!data || typeof data !== 'object' || visited.has(data)) return
  visited.add(data)

  if (Array.isArray(data)) {
    // Process each item in array
    for (const item of data) {
      findAllTables(item, foundTables, visited)
    }
  } else {
    // Process object properties
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        // Found an array of objects - this is a table
        const existingRows = foundTables.get(key) || []
        // Flatten and add all rows
        for (const row of value) {
          // Extract only primitive fields for this table's rows
          const flatRow: Record<string, any> = {}
          for (const [rowKey, rowValue] of Object.entries(row || {})) {
            if (!Array.isArray(rowValue) && (typeof rowValue !== 'object' || rowValue === null)) {
              flatRow[rowKey] = rowValue
            }
          }
          if (Object.keys(flatRow).length > 0) {
            existingRows.push(flatRow)
          }
          // Recurse into nested objects/arrays
          findAllTables(row, foundTables, visited)
        }
        foundTables.set(key, existingRows)
      } else if (typeof value === 'object' && value !== null) {
        // Recurse into nested objects
        findAllTables(value, foundTables, visited)
      }
    }
  }
}

// Extract tables from nested JSON
function extractTables(rawData: any): TableData[] {
  // First, parse any json_blob__c from Data Graph response
  const data = parseDataGraphResponse(rawData)

  if (!data || typeof data !== 'object') return []

  // Extract profile fields (top-level primitives)
  const profileFields: Record<string, any> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value) && (typeof value !== 'object' || value === null)) {
      profileFields[key] = value
    }
  }

  // Find all nested tables recursively
  const foundTables = new Map<string, any[]>()
  findAllTables(data, foundTables)

  // Build table list
  const tables: TableData[] = []

  // Add profile table if we have profile fields
  if (Object.keys(profileFields).length > 0) {
    tables.push({
      name: 'Profile',
      columns: Object.keys(profileFields),
      rows: [profileFields],
      isEventTable: false,
    })
  }

  // Add all found tables
  for (const [name, rows] of foundTables.entries()) {
    if (rows.length > 0) {
      const columns = [...new Set(rows.flatMap((row: Record<string, any>) => Object.keys(row)))]
      tables.push({
        name: formatTableName(name),
        columns,
        rows,
        isEventTable: isEventsTable(name),
      })
    }
  }

  // Sort tables: Profile first, then Events, then Insights, then Links
  tables.sort((a, b) => {
    const catA = a.name === 'Profile' ? -1 : getTableCategory(a.name)
    const catB = b.name === 'Profile' ? -1 : getTableCategory(b.name)
    if (catA !== catB) return catA - catB
    return a.name.localeCompare(b.name)
  })

  return tables
}

// Format cell value for display
function formatCellValue(value: any): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// Sort rows by column
function sortRows(rows: Record<string, any>[], column: string, direction: 'asc' | 'desc'): Record<string, any>[] {
  return [...rows].sort((a, b) => {
    const aVal = a[column]
    const bVal = b[column]

    // Handle nulls
    if (aVal == null && bVal == null) return 0
    if (aVal == null) return direction === 'asc' ? -1 : 1
    if (bVal == null) return direction === 'asc' ? 1 : -1

    // Try date comparison
    const aDate = new Date(aVal)
    const bDate = new Date(bVal)
    if (!isNaN(aDate.getTime()) && !isNaN(bDate.getTime())) {
      return direction === 'asc'
        ? aDate.getTime() - bDate.getTime()
        : bDate.getTime() - aDate.getTime()
    }

    // String/number comparison
    if (aVal < bVal) return direction === 'asc' ? -1 : 1
    if (aVal > bVal) return direction === 'asc' ? 1 : -1
    return 0
  })
}

// Table component with sorting and column visibility
function DataTable({
  table,
  sortConfig,
  onSort,
  visibleColumns,
  onToggleColumn,
}: {
  table: TableData
  sortConfig: SortConfig | null
  onSort: (column: string) => void
  visibleColumns: Set<string>
  onToggleColumn: (column: string) => void
}) {
  const [showColumnPicker, setShowColumnPicker] = useState(false)

  const sortedRows = useMemo(() => {
    if (!sortConfig) return table.rows
    return sortRows(table.rows, sortConfig.column, sortConfig.direction)
  }, [table.rows, sortConfig])

  const displayColumns = table.columns.filter(col => visibleColumns.has(col))

  return (
    <div className="border border-sf-navy-200 rounded-xl overflow-hidden">
      {/* Table Header */}
      <div className="bg-sf-navy-50 px-4 py-3 border-b border-sf-navy-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Table className="w-4 h-4 text-sf-navy-500" />
          <span className="font-medium text-sf-navy-900">{table.name}</span>
          <span className="text-xs text-sf-navy-400 bg-sf-navy-100 px-2 py-0.5 rounded-full">
            {table.rows.length} row{table.rows.length !== 1 ? 's' : ''}
          </span>
          {table.isEventTable && (
            <span className="text-xs text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
              Events
            </span>
          )}
        </div>

        {/* Column Picker */}
        <div className="relative">
          <button
            onClick={() => setShowColumnPicker(!showColumnPicker)}
            className="btn-ghost text-xs py-1 px-2 flex items-center gap-1"
          >
            <Columns className="w-3 h-3" />
            Columns ({displayColumns.length}/{table.columns.length})
            <ChevronDown className={cn("w-3 h-3 transition-transform", showColumnPicker && "rotate-180")} />
          </button>

          {showColumnPicker && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-sf-navy-200 rounded-lg shadow-lg z-10 max-h-64 overflow-y-auto">
              <div className="p-2 border-b border-sf-navy-100">
                <button
                  onClick={() => table.columns.forEach(col => {
                    if (!visibleColumns.has(col)) onToggleColumn(col)
                  })}
                  className="text-xs text-sf-blue-600 hover:text-sf-blue-700 mr-3"
                >
                  Show All
                </button>
                <button
                  onClick={() => table.columns.forEach(col => {
                    if (visibleColumns.has(col) && visibleColumns.size > 1) onToggleColumn(col)
                  })}
                  className="text-xs text-sf-navy-500 hover:text-sf-navy-700"
                >
                  Hide All
                </button>
              </div>
              {table.columns.map(col => (
                <label
                  key={col}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-sf-navy-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={visibleColumns.has(col)}
                    onChange={() => onToggleColumn(col)}
                    className="rounded border-sf-navy-300"
                  />
                  <span className="text-sm text-sf-navy-700 truncate">{col}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-sf-navy-50">
            <tr>
              {displayColumns.map(col => {
                const isSorted = sortConfig?.column === col
                const isDateTime = table.rows.length > 0 && isDateTimeColumn(col, table.rows[0][col])

                return (
                  <th
                    key={col}
                    className="px-4 py-3 text-left font-medium text-sf-navy-700 border-b border-sf-navy-200 whitespace-nowrap"
                  >
                    <button
                      onClick={() => onSort(col)}
                      className="flex items-center gap-1 hover:text-sf-blue-600 transition-colors"
                    >
                      <span>{col}</span>
                      {isSorted ? (
                        sortConfig.direction === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-sf-blue-600" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-sf-blue-600" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-sf-navy-300" />
                      )}
                      {isDateTime && (
                        <span className="text-xs text-sf-navy-400">(date)</span>
                      )}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={cn(
                  "border-b border-sf-navy-100 hover:bg-sf-navy-50 transition-colors",
                  rowIndex % 2 === 0 ? "bg-white" : "bg-sf-navy-25"
                )}
              >
                {displayColumns.map(col => (
                  <td
                    key={col}
                    className="px-4 py-3 text-sf-navy-600 whitespace-nowrap max-w-xs truncate"
                    title={formatCellValue(row[col])}
                  >
                    {formatCellValue(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {table.rows.length === 0 && (
        <div className="p-8 text-center text-sf-navy-400">
          No data available
        </div>
      )}
    </div>
  )
}

export function RetrieveView() {
  const { session, oauthConfig, retrieveConfig, setRetrieveConfig, dcMetadata, setDCMetadata } = useAppStore()
  const [lookupKey, setLookupKey] = useState('')
  const [lookupValue, setLookupValue] = useState('')
  const [dmoName, setDmoName] = useState('ssot__Individual__dlm')
  const [result, setResult] = useState<any>(null)
  const [showRawJson, setShowRawJson] = useState(false)
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false)

  // Get available lookup keys for the selected data graph
  const selectedDataGraph = dcMetadata.dataGraphs.find(
    dg => dg.name === retrieveConfig.dataGraphName
  )
  const availableLookupKeys = selectedDataGraph?.lookupKeys || []

  // Refresh metadata function
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
    } catch (err: any) {
      setDCMetadata({
        isLoading: false,
        error: err.message || 'Failed to refresh metadata',
      })
      if (showToast) {
        toast.error('Failed to refresh metadata')
      }
    } finally {
      setIsRefreshingMetadata(false)
    }
  }

  // Auto-set DMO name when lookup key changes
  useEffect(() => {
    const selectedLookupKey = availableLookupKeys.find(lk => lk.name === lookupKey)
    if (selectedLookupKey?.dmoName) {
      setDmoName(selectedLookupKey.dmoName)
    }
  }, [lookupKey, availableLookupKeys])

  // Auto-fetch metadata when page loads if empty and user has DC token
  useEffect(() => {
    const fetchMetadataIfNeeded = async () => {
      if (session.id && session.hasDCToken && dcMetadata.dataGraphs.length === 0 && !dcMetadata.isLoading && !dcMetadata.error) {
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
        } catch (err: any) {
          setDCMetadata({
            isLoading: false,
            error: err.message || 'Failed to load metadata',
          })
        } finally {
          setIsRefreshingMetadata(false)
        }
      }
    }
    fetchMetadataIfNeeded()
  }, [session.id, session.hasDCToken])

  // Sort configs per table
  const [sortConfigs, setSortConfigs] = useState<Record<string, SortConfig>>({})

  // Visible columns per table
  const [visibleColumnsMap, setVisibleColumnsMap] = useState<Record<string, Set<string>>>({})

  // DLO/DMO Query state
  const [objectName, setObjectName] = useState('')
  const [dloLookupKey, setDloLookupKey] = useState('')
  const [dloLookupValue, setDloLookupValue] = useState('')
  const [queryResult, setQueryResult] = useState<any[] | null>(null)
  const [queryShowRawJson, setQueryShowRawJson] = useState(false)
  const [querySortConfig, setQuerySortConfig] = useState<SortConfig | null>(null)
  const [queryVisibleColumns, setQueryVisibleColumns] = useState<Set<string>>(new Set())

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

        // Load lookup key and value if available (trim to remove any whitespace)
        if (config.lookup_key) setLookupKey(config.lookup_key.trim())
        if (config.lookup_value) setLookupValue(config.lookup_value.trim())

        // Don't clear sessionStorage here - stream view might need it too
      } catch (e) {
        console.error('Failed to load saved config:', e)
      }
    }
  }, [])

  // Extract tables from result
  const tables = useMemo(() => {
    if (!result) return []
    const extracted = extractTables(result)

    // Initialize sort configs for event tables (sort by first datetime column desc)
    const newSortConfigs: Record<string, SortConfig> = {}
    const newVisibleColumns: Record<string, Set<string>> = {}

    extracted.forEach(table => {
      // Initialize visible columns (all visible by default)
      if (!visibleColumnsMap[table.name]) {
        newVisibleColumns[table.name] = new Set(table.columns)
      }

      // Auto-sort event tables by datetime desc
      if (table.isEventTable && !sortConfigs[table.name]) {
        const dateTimeCol = table.columns.find(col =>
          table.rows.length > 0 && isDateTimeColumn(col, table.rows[0][col])
        )
        if (dateTimeCol) {
          newSortConfigs[table.name] = { column: dateTimeCol, direction: 'desc' }
        }
      }
    })

    if (Object.keys(newSortConfigs).length > 0) {
      setSortConfigs(prev => ({ ...prev, ...newSortConfigs }))
    }
    if (Object.keys(newVisibleColumns).length > 0) {
      setVisibleColumnsMap(prev => ({ ...prev, ...newVisibleColumns }))
    }

    return extracted
  }, [result])

  const retrieveMutation = useMutation({
    mutationFn: () =>
      dataApi.retrieveData({
        session_id: session.id || '',
        data_graph_name: retrieveConfig.dataGraphName,
        lookup_keys: { [lookupKey]: lookupValue },
        dmo_name: dmoName,
      }),
    onSuccess: (data) => {
      setResult(data)
      // Reset sort configs and visible columns for new data
      setSortConfigs({})
      setVisibleColumnsMap({})
      toast.success('Data retrieved successfully!')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to retrieve data')
    },
  })

  const handleRetrieve = () => {
    if (!retrieveConfig.dataGraphName) {
      toast.error('Please enter a Data Graph name')
      return
    }
    if (!lookupKey || !lookupValue) {
      toast.error('Please enter lookup key and value')
      return
    }
    retrieveMutation.mutate()
  }

  // DLO/DMO Query mutation
  const queryMutation = useMutation({
    mutationFn: () => {
      // Build SQL query
      const escapedObjectName = objectName.trim()
      let sql = `SELECT * FROM ${escapedObjectName}`
      if (dloLookupKey.trim() && dloLookupValue.trim()) {
        const escapedValue = dloLookupValue.trim().replace(/'/g, "\\'")
        sql += ` WHERE ${dloLookupKey.trim()} = '${escapedValue}'`
      }
      sql += ' LIMIT 100'
      return dataApi.query(session.id || '', sql)
    },
    onSuccess: (data: any) => {
      const rows = data?.data || []
      setQueryResult(rows)
      setQuerySortConfig(null)
      // Initialize visible columns from first row
      if (rows.length > 0) {
        setQueryVisibleColumns(new Set(Object.keys(rows[0])))
      } else {
        setQueryVisibleColumns(new Set())
      }
      toast.success(`Query returned ${rows.length} row${rows.length !== 1 ? 's' : ''}`)
    },
    onError: (error: any) => {
      toast.error(error.message || 'Query failed')
    },
  })

  const handleQuery = () => {
    if (!objectName.trim()) {
      toast.error('Please enter an object name')
      return
    }
    queryMutation.mutate()
  }

  // Build TableData from query results
  const queryTable = useMemo((): TableData | null => {
    if (!queryResult || queryResult.length === 0) return null
    const columns = [...new Set(queryResult.flatMap((row: Record<string, any>) => Object.keys(row)))]
    return {
      name: objectName || 'Query Results',
      columns,
      rows: queryResult,
      isEventTable: false,
    }
  }, [queryResult, objectName])

  const handleQuerySort = (column: string) => {
    setQuerySortConfig(prev => {
      if (prev?.column === column) {
        return { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      }
      const isDateTime = queryTable && queryTable.rows.length > 0 && isDateTimeColumn(column, queryTable.rows[0][column])
      return { column, direction: isDateTime ? 'desc' : 'asc' }
    })
  }

  const handleQueryToggleColumn = (column: string) => {
    setQueryVisibleColumns(prev => {
      const newSet = new Set(prev)
      if (newSet.has(column)) {
        if (newSet.size > 1) newSet.delete(column)
      } else {
        newSet.add(column)
      }
      return newSet
    })
  }

  const handleQueryCopy = async () => {
    await copyToClipboard(JSON.stringify(queryResult, null, 2))
    toast.success('Copied to clipboard!')
  }

  const handleQueryDownload = () => {
    downloadFile(
      JSON.stringify(queryResult, null, 2),
      `${objectName || 'query-result'}.json`,
      'application/json'
    )
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
        consumer_key: oauthConfig.consumerKey?.trim() || undefined,
        data_graph_name: retrieveConfig.dataGraphName?.trim() || undefined,
        lookup_key: lookupKey?.trim() || undefined,
        lookup_value: lookupValue?.trim() || undefined,
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

  const handleSort = (tableName: string, column: string) => {
    setSortConfigs(prev => {
      const current = prev[tableName]
      if (current?.column === column) {
        // Toggle direction
        return {
          ...prev,
          [tableName]: {
            column,
            direction: current.direction === 'asc' ? 'desc' : 'asc',
          },
        }
      }
      // New column - default to desc for datetime, asc for others
      const table = tables.find(t => t.name === tableName)
      const isDateTime = table && table.rows.length > 0 && isDateTimeColumn(column, table.rows[0][column])
      return {
        ...prev,
        [tableName]: {
          column,
          direction: isDateTime ? 'desc' : 'asc',
        },
      }
    })
  }

  const handleToggleColumn = (tableName: string, column: string) => {
    setVisibleColumnsMap(prev => {
      const current = prev[tableName] || new Set(tables.find(t => t.name === tableName)?.columns || [])
      const newSet = new Set(current)
      if (newSet.has(column)) {
        if (newSet.size > 1) { // Keep at least one column
          newSet.delete(column)
        }
      } else {
        newSet.add(column)
      }
      return { ...prev, [tableName]: newSet }
    })
  }

  const handleCopy = async () => {
    await copyToClipboard(JSON.stringify(result, null, 2))
    toast.success('Copied to clipboard!')
  }

  const handleDownload = () => {
    downloadFile(
      JSON.stringify(result, null, 2),
      'data-graph-result.json',
      'application/json'
    )
  }

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-sf-navy-900 mb-2">
            Retrieve Data
          </h1>
          <p className="text-sf-navy-500">
            Query Data Graphs, Data Lake Objects, and Data Model Objects
          </p>
        </div>

        {/* Query Form */}
        <div className="card mb-6">
          <div className="p-6">
            <h2 className="font-medium text-sf-navy-900 mb-6 flex items-center gap-2">
              <Database className="w-5 h-5 text-sf-blue-500" />
              Data Graph Query
            </h2>

            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="label mb-0">Data Graph Name</label>
                  <button
                    onClick={() => handleRefreshMetadata()}
                    disabled={isRefreshingMetadata || dcMetadata.isLoading}
                    className="text-xs text-sf-blue-600 hover:text-sf-blue-700 flex items-center gap-1"
                  >
                    <RefreshCw className={cn("w-3 h-3", (isRefreshingMetadata || dcMetadata.isLoading) && "animate-spin")} />
                    {dcMetadata.isLoading ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
                {dcMetadata.dataGraphs.length > 0 ? (
                  <select
                    className="input"
                    value={retrieveConfig.dataGraphName}
                    onChange={(e) => {
                      setRetrieveConfig({ dataGraphName: e.target.value })
                      setLookupKey('') // Reset lookup key when data graph changes
                    }}
                  >
                    <option value="">Select a Data Graph...</option>
                    {dcMetadata.dataGraphs.map((dg) => (
                      <option key={dg.name} value={dg.name}>
                        {dg.label || dg.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Customer_360_Graph"
                    value={retrieveConfig.dataGraphName}
                    onChange={(e) =>
                      setRetrieveConfig({ dataGraphName: e.target.value })
                    }
                  />
                )}
                <p className="text-xs text-sf-navy-400 mt-1.5">
                  {dcMetadata.dataGraphs.length > 0
                    ? `${dcMetadata.dataGraphs.length} Data Graph${dcMetadata.dataGraphs.length !== 1 ? 's' : ''} available`
                    : 'The API name of your Data Graph from Data Cloud setup'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Lookup Key</label>
                  {availableLookupKeys.length > 0 ? (
                    <select
                      className="input"
                      value={lookupKey}
                      onChange={(e) => setLookupKey(e.target.value)}
                    >
                      <option value="">Select a Lookup Key...</option>
                      {availableLookupKeys.map((lk) => (
                        <option key={lk.name} value={lk.name}>
                          {lk.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g., ssot__Id__c"
                      value={lookupKey}
                      onChange={(e) => setLookupKey(e.target.value)}
                    />
                  )}
                </div>
                <div>
                  <label className="label">Lookup Value</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., d716faa8-fda2-47d1-..."
                    value={lookupValue}
                    onChange={(e) => setLookupValue(e.target.value)}
                  />
                </div>
              </div>

              {lookupKey && lookupValue && (
                <div className="bg-sf-navy-50 rounded-lg p-3">
                  <p className="text-xs text-sf-navy-500 mb-1">API call format:</p>
                  <code className="text-xs text-sf-navy-700 break-all">
                    {lookupKey === 'UnifiedIndividualId__c'
                      ? `/api/v1/dataGraph/${retrieveConfig.dataGraphName || '{graphName}'}/${lookupValue}`
                      : `/api/v1/dataGraph/${retrieveConfig.dataGraphName || '{graphName}'}?lookupKeys=[${dmoName}.${lookupKey}=${lookupValue}]`
                    }
                  </code>
                </div>
              )}

              <div className="bg-sf-blue-50 border border-sf-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-sf-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-sf-blue-800">
                    <p className="font-medium mb-1">Lookup Key Tips:</p>
                    <ul className="list-disc list-inside space-y-1 text-sf-blue-700">
                      <li>
                        <code className="bg-sf-blue-100 px-1 rounded">
                          UnifiedIndividualId__c
                        </code>{' '}
                        - Primary key (path-based lookup)
                      </li>
                      <li>
                        <code className="bg-sf-blue-100 px-1 rounded">
                          ssot__Id__c
                        </code>{' '}
                        - Individual record ID
                      </li>
                      <li>
                        <code className="bg-sf-blue-100 px-1 rounded">
                          CustomerId__c
                        </code>{' '}
                        - Custom field on the Individual DMO
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Advanced: DMO Name (collapsed by default) */}
              {lookupKey && lookupKey !== 'UnifiedIndividualId__c' && (
                <div className="border border-sf-navy-200 rounded-lg p-3">
                  <label className="label text-xs">DMO Name (optional)</label>
                  <input
                    type="text"
                    className="input text-sm"
                    placeholder="ssot__Individual__dlm"
                    value={dmoName}
                    onChange={(e) => setDmoName(e.target.value)}
                  />
                  <p className="text-xs text-sf-navy-400 mt-1">
                    Default: ssot__Individual__dlm. Change only if querying a different DMO.
                  </p>
                </div>
              )}

              <button
                onClick={handleRetrieve}
                disabled={
                  retrieveMutation.isPending ||
                  !retrieveConfig.dataGraphName ||
                  !lookupKey ||
                  !lookupValue
                }
                className="btn-primary w-full py-3"
              >
                {retrieveMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Retrieving...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    Retrieve Profile
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Data Graph Results */}
        {result && (
          <div className="space-y-6 animate-slide-up">
            {/* Results Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-green-500" />
                <span className="font-medium text-sf-navy-900">
                  Profile Data
                </span>
                <span className="text-xs text-sf-navy-400 bg-sf-navy-100 px-2 py-0.5 rounded-full">
                  {tables.length} table{tables.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowRawJson(!showRawJson)}
                  className={cn(
                    "btn-ghost text-sm py-1.5 px-3",
                    showRawJson && "bg-sf-navy-100"
                  )}
                >
                  {showRawJson ? <Table className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
                  {showRawJson ? 'Show Tables' : 'Show JSON'}
                </button>
                <button onClick={handleCopy} className="btn-ghost p-2">
                  <Copy className="w-4 h-4" />
                </button>
                <button onClick={handleDownload} className="btn-ghost p-2">
                  <Download className="w-4 h-4" />
                </button>
              </div>
            </div>

            {showRawJson ? (
              /* Raw JSON View */
              <div className="card">
                <div className="p-4">
                  <div className="bg-sf-navy-900 rounded-lg p-4 max-h-[600px] overflow-y-auto">
                    <pre className="text-sm text-sf-navy-100 font-mono">
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            ) : (
              /* Tables View */
              <div className="space-y-6">
                {tables.map(table => (
                  <DataTable
                    key={table.name}
                    table={table}
                    sortConfig={sortConfigs[table.name] || null}
                    onSort={(column) => handleSort(table.name, column)}
                    visibleColumns={visibleColumnsMap[table.name] || new Set(table.columns)}
                    onToggleColumn={(column) => handleToggleColumn(table.name, column)}
                  />
                ))}

                {tables.length === 0 && (
                  <div className="card p-8 text-center text-sf-navy-400">
                    No structured data found. Switch to JSON view to see raw response.
                  </div>
                )}
              </div>
            )}

            {/* Save Configuration */}
            <div className="card bg-gradient-to-r from-sf-blue-50 to-purple-50 border-sf-blue-200">
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-sf-navy-900">Save this configuration?</h3>
                    <p className="text-sm text-sf-navy-500">
                      Save your Data Graph settings for future use
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
          </div>
        )}

        {/* Divider */}
        <div className="flex items-center gap-4 my-8">
          <div className="flex-1 border-t border-sf-navy-200" />
          <span className="text-sm font-medium text-sf-navy-400 uppercase tracking-wide">or</span>
          <div className="flex-1 border-t border-sf-navy-200" />
        </div>

        {/* DLO/DMO Query Form */}
        <div className="card mb-6">
          <div className="p-6">
            <h2 className="font-medium text-sf-navy-900 mb-6 flex items-center gap-2">
              <Search className="w-5 h-5 text-sf-blue-500" />
              Data Object Query (DLO / DMO)
            </h2>

            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="label mb-0">Object Name</label>
                  {(dcMetadata.dmos.length > 0 || dcMetadata.dlos.length > 0) && (
                    <span className="text-xs text-sf-navy-400">
                      {dcMetadata.dmos.length} DMO{dcMetadata.dmos.length !== 1 ? 's' : ''}, {dcMetadata.dlos.length} DLO{dcMetadata.dlos.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {(dcMetadata.dmos.length > 0 || dcMetadata.dlos.length > 0) ? (
                  <select
                    className="input"
                    value={objectName}
                    onChange={(e) => setObjectName(e.target.value)}
                  >
                    <option value="">Select an Object...</option>
                    {dcMetadata.dmos.length > 0 && (
                      <optgroup label="Data Model Objects (DMO)">
                        {dcMetadata.dmos.map((obj) => (
                          <option key={obj.name} value={obj.name}>
                            {obj.label || obj.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {dcMetadata.dlos.length > 0 && (
                      <optgroup label="Data Lake Objects (DLO)">
                        {dcMetadata.dlos.map((obj) => (
                          <option key={obj.name} value={obj.name}>
                            {obj.label || obj.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., RT_Flight_Bookings_FlightBookin_F9C7F3C0__dll"
                    value={objectName}
                    onChange={(e) => setObjectName(e.target.value)}
                  />
                )}
                <p className="text-xs text-sf-navy-400 mt-1.5">
                  {(dcMetadata.dmos.length > 0 || dcMetadata.dlos.length > 0)
                    ? 'Select from available objects or type a custom name'
                    : 'The API name of your Data Lake Object (DLO) or Data Model Object (DMO)'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Lookup Key (optional)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., customer_id__c"
                    value={dloLookupKey}
                    onChange={(e) => setDloLookupKey(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Lookup Value (optional)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., cust127"
                    value={dloLookupValue}
                    onChange={(e) => setDloLookupValue(e.target.value)}
                  />
                </div>
              </div>

              <div className="bg-sf-blue-50 border border-sf-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-sf-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-sf-blue-800">
                    <p className="font-medium mb-1">Tips:</p>
                    <ul className="list-disc list-inside space-y-1 text-sf-blue-700">
                      <li>Leave lookup key and value empty to retrieve all records (up to 100)</li>
                      <li>DLO names end with <code className="bg-sf-blue-100 px-1 rounded">__dll</code>, DMO names end with <code className="bg-sf-blue-100 px-1 rounded">__dlm</code></li>
                      <li>Find object names in <strong>Data Cloud Setup &rarr; Data Lake Objects</strong> or <strong>Data Model</strong></li>
                    </ul>
                  </div>
                </div>
              </div>

              <button
                onClick={handleQuery}
                disabled={queryMutation.isPending || !objectName.trim()}
                className="btn-primary w-full py-3"
              >
                {queryMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Querying...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    Query Data
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* DLO/DMO Query Results */}
        {queryResult && (
          <div className="space-y-6 animate-slide-up mb-8">
            {/* Results Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Database className="w-5 h-5 text-green-500" />
                <span className="font-medium text-sf-navy-900">
                  Query Results
                </span>
                <span className="text-xs text-sf-navy-400 bg-sf-navy-100 px-2 py-0.5 rounded-full">
                  {queryResult.length} row{queryResult.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQueryShowRawJson(!queryShowRawJson)}
                  className={cn(
                    "btn-ghost text-sm py-1.5 px-3",
                    queryShowRawJson && "bg-sf-navy-100"
                  )}
                >
                  {queryShowRawJson ? <Table className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
                  {queryShowRawJson ? 'Show Table' : 'Show JSON'}
                </button>
                <button onClick={handleQueryCopy} className="btn-ghost p-2">
                  <Copy className="w-4 h-4" />
                </button>
                <button onClick={handleQueryDownload} className="btn-ghost p-2">
                  <Download className="w-4 h-4" />
                </button>
              </div>
            </div>

            {queryShowRawJson ? (
              <div className="card">
                <div className="p-4">
                  <div className="bg-sf-navy-900 rounded-lg p-4 max-h-[600px] overflow-y-auto">
                    <pre className="text-sm text-sf-navy-100 font-mono">
                      {JSON.stringify(queryResult, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            ) : queryTable ? (
              <DataTable
                table={queryTable}
                sortConfig={querySortConfig}
                onSort={handleQuerySort}
                visibleColumns={queryVisibleColumns}
                onToggleColumn={handleQueryToggleColumn}
              />
            ) : (
              <div className="card p-8 text-center text-sf-navy-400">
                No data returned. Check the object name and try again.
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
                    placeholder="e.g., VietnamAir Profile Retrieval"
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
                    <li>• Data Graph: <code>{retrieveConfig.dataGraphName}</code></li>
                    {lookupKey && <li>• Lookup Key: <code>{lookupKey}</code></li>}
                    {lookupValue && <li>• Lookup Value: <code>{lookupValue}</code></li>}
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

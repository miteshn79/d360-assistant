'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import { dataApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import {
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileJson,
  Loader2,
  RefreshCw,
  Search,
  Table,
} from 'lucide-react'
import { downloadFile } from '@/lib/utils'

export function MetadataView() {
  const { session } = useAppStore()
  const [search, setSearch] = useState('')
  const [expandedObjects, setExpandedObjects] = useState<Set<string>>(new Set())

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['metadata', session.id],
    queryFn: () => dataApi.getMetadata(session.id || ''),
    enabled: !!session.id,
  })

  const toggleExpand = (name: string) => {
    const newExpanded = new Set(expandedObjects)
    if (newExpanded.has(name)) {
      newExpanded.delete(name)
    } else {
      newExpanded.add(name)
    }
    setExpandedObjects(newExpanded)
  }

  const handleDownload = () => {
    if (data) {
      downloadFile(
        JSON.stringify(data, null, 2),
        'data-cloud-metadata.json',
        'application/json'
      )
    }
  }

  const filteredObjects = data?.metadata?.filter((obj: any) =>
    obj.name?.toLowerCase().includes(search.toLowerCase())
  )

  const dlmObjects = filteredObjects?.filter((obj: any) =>
    obj.name?.endsWith('__dlm')
  )
  const otherObjects = filteredObjects?.filter(
    (obj: any) => !obj.name?.endsWith('__dlm')
  )

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-sf-navy-900 mb-2">
            Metadata Explorer
          </h1>
          <p className="text-sf-navy-500">
            Browse Data Cloud objects and their fields
          </p>
        </div>

        {/* Controls */}
        <div className="card mb-6">
          <div className="p-4 flex items-center justify-between gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-sf-navy-400" />
              <input
                type="text"
                className="input pl-10"
                placeholder="Search objects..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="btn-secondary"
              >
                <RefreshCw
                  className={cn('w-4 h-4 mr-2', isFetching && 'animate-spin')}
                />
                Refresh
              </button>
              <button
                onClick={handleDownload}
                disabled={!data}
                className="btn-primary"
              >
                <Download className="w-4 h-4 mr-2" />
                Export JSON
              </button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="card p-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-sf-blue-500 mb-4" />
            <p className="text-sf-navy-500">Loading metadata...</p>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="card p-4">
                <Database className="w-5 h-5 text-sf-blue-500 mb-2" />
                <p className="text-2xl font-semibold text-sf-navy-900">
                  {data?.metadata?.length || 0}
                </p>
                <p className="text-sm text-sf-navy-500">Total Objects</p>
              </div>
              <div className="card p-4">
                <Table className="w-5 h-5 text-purple-500 mb-2" />
                <p className="text-2xl font-semibold text-sf-navy-900">
                  {dlmObjects?.length || 0}
                </p>
                <p className="text-sm text-sf-navy-500">Data Lake Objects</p>
              </div>
              <div className="card p-4">
                <FileJson className="w-5 h-5 text-green-500 mb-2" />
                <p className="text-2xl font-semibold text-sf-navy-900">
                  {otherObjects?.length || 0}
                </p>
                <p className="text-sm text-sf-navy-500">Other Objects</p>
              </div>
            </div>

            {/* Objects List */}
            <div className="space-y-4">
              {dlmObjects && dlmObjects.length > 0 && (
                <div className="card">
                  <div className="p-4 border-b border-sf-navy-100 bg-purple-50">
                    <h2 className="font-medium text-purple-900 flex items-center gap-2">
                      <Table className="w-5 h-5" />
                      Data Lake Objects ({dlmObjects.length})
                    </h2>
                  </div>
                  <div className="divide-y divide-sf-navy-100">
                    {dlmObjects.map((obj: any) => (
                      <ObjectItem
                        key={obj.name}
                        object={obj}
                        expanded={expandedObjects.has(obj.name)}
                        onToggle={() => toggleExpand(obj.name)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {otherObjects && otherObjects.length > 0 && (
                <div className="card">
                  <div className="p-4 border-b border-sf-navy-100 bg-sf-navy-50">
                    <h2 className="font-medium text-sf-navy-900 flex items-center gap-2">
                      <FileJson className="w-5 h-5" />
                      Other Objects ({otherObjects.length})
                    </h2>
                  </div>
                  <div className="divide-y divide-sf-navy-100">
                    {otherObjects.map((obj: any) => (
                      <ObjectItem
                        key={obj.name}
                        object={obj}
                        expanded={expandedObjects.has(obj.name)}
                        onToggle={() => toggleExpand(obj.name)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {!filteredObjects?.length && (
                <div className="card p-12 text-center">
                  <Database className="w-10 h-10 text-sf-navy-300 mx-auto mb-3" />
                  <p className="text-sf-navy-500">
                    {search
                      ? 'No objects match your search'
                      : 'No objects found'}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ObjectItem({
  object,
  expanded,
  onToggle,
}: {
  object: any
  expanded: boolean
  onToggle: () => void
}) {
  const fields = object.fields || []

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between hover:bg-sf-navy-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-sf-navy-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-sf-navy-400" />
          )}
          <span className="font-mono text-sm text-sf-navy-900">
            {object.name}
          </span>
        </div>
        <span className="badge-gray">{fields.length} fields</span>
      </button>

      {expanded && fields.length > 0 && (
        <div className="px-4 pb-4 animate-fade-in">
          <div className="bg-sf-navy-50 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sf-navy-200">
                  <th className="text-left py-2 px-3 font-medium text-sf-navy-700">
                    Field Name
                  </th>
                  <th className="text-left py-2 px-3 font-medium text-sf-navy-700">
                    Type
                  </th>
                  <th className="text-left py-2 px-3 font-medium text-sf-navy-700">
                    Label
                  </th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field: any, i: number) => (
                  <tr
                    key={i}
                    className="border-b border-sf-navy-100 last:border-0"
                  >
                    <td className="py-2 px-3 font-mono text-sf-navy-800">
                      {field.name}
                    </td>
                    <td className="py-2 px-3">
                      <span className="badge-blue">{field.type}</span>
                    </td>
                    <td className="py-2 px-3 text-sf-navy-600">
                      {field.label || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

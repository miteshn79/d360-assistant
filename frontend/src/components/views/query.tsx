'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import { dataApi } from '@/lib/api'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Copy,
  Database,
  Download,
  Loader2,
  Play,
  Table,
} from 'lucide-react'
import { copyToClipboard, downloadFile } from '@/lib/utils'

const sampleQueries = [
  {
    name: 'List all objects',
    sql: "SELECT name FROM DataLakeObject__dlm LIMIT 10",
  },
  {
    name: 'Unified Individuals',
    sql: "SELECT Id, FirstName__c, LastName__c, Email__c FROM UnifiedIndividual__dlm LIMIT 10",
  },
  {
    name: 'Recent events',
    sql: "SELECT * FROM YourEventObject__dlm ORDER BY EventTime__c DESC LIMIT 20",
  },
]

export function QueryView() {
  const { session } = useAppStore()
  const [sql, setSql] = useState('')
  const [results, setResults] = useState<any>(null)

  const queryMutation = useMutation({
    mutationFn: () => dataApi.query(session.id || '', sql),
    onSuccess: (data) => {
      setResults(data)
      toast.success(`Query returned ${data.data?.length || 0} rows`)
    },
    onError: (error: any) => {
      toast.error(error.message || 'Query failed')
    },
  })

  const handleExecute = () => {
    if (!sql.trim()) {
      toast.error('Please enter a SQL query')
      return
    }
    queryMutation.mutate()
  }

  const handleCopy = async () => {
    await copyToClipboard(JSON.stringify(results?.data || [], null, 2))
    toast.success('Results copied!')
  }

  const handleDownloadCSV = () => {
    if (!results?.data?.length) return

    const headers = Object.keys(results.data[0])
    const rows = results.data.map((row: any) =>
      headers.map((h) => JSON.stringify(row[h] ?? '')).join(',')
    )
    const csv = [headers.join(','), ...rows].join('\n')

    downloadFile(csv, 'query-results.csv', 'text/csv')
  }

  const handleDownloadJSON = () => {
    downloadFile(
      JSON.stringify(results?.data || [], null, 2),
      'query-results.json',
      'application/json'
    )
  }

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-sf-navy-900 mb-2">
            Query Data
          </h1>
          <p className="text-sf-navy-500">
            Execute SQL queries against your Data Cloud data
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Query Editor */}
          <div className="lg:col-span-2 space-y-4">
            <div className="card">
              <div className="p-4 border-b border-sf-navy-100">
                <div className="flex items-center gap-3">
                  <Database className="w-5 h-5 text-sf-navy-500" />
                  <span className="font-medium text-sf-navy-900">
                    SQL Query
                  </span>
                </div>
              </div>
              <div className="p-4">
                <textarea
                  className="w-full h-48 font-mono text-sm bg-sf-navy-900 text-sf-navy-100 rounded-lg p-4 focus:outline-none focus:ring-2 focus:ring-sf-blue-500"
                  placeholder="SELECT * FROM YourObject__dlm LIMIT 10"
                  value={sql}
                  onChange={(e) => setSql(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      handleExecute()
                    }
                  }}
                />
                <div className="flex items-center justify-between mt-4">
                  <span className="text-xs text-sf-navy-400">
                    Press Ctrl/Cmd + Enter to execute
                  </span>
                  <button
                    onClick={handleExecute}
                    disabled={queryMutation.isPending || !sql.trim()}
                    className="btn-primary"
                  >
                    {queryMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Running...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Execute
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Results */}
            {results && (
              <div className="card animate-slide-up">
                <div className="p-4 border-b border-sf-navy-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Table className="w-5 h-5 text-green-500" />
                      <span className="font-medium text-sf-navy-900">
                        Results
                      </span>
                      <span className="badge-green">
                        {results.data?.length || 0} rows
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={handleCopy} className="btn-ghost p-2" title="Copy JSON">
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={handleDownloadCSV}
                        className="btn-secondary text-sm py-1.5 px-3"
                      >
                        CSV
                      </button>
                      <button
                        onClick={handleDownloadJSON}
                        className="btn-secondary text-sm py-1.5 px-3"
                      >
                        JSON
                      </button>
                    </div>
                  </div>
                </div>
                <div className="p-4 overflow-x-auto">
                  {results.data?.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-sf-navy-200">
                          {Object.keys(results.data[0]).map((key) => (
                            <th
                              key={key}
                              className="text-left py-2 px-3 font-medium text-sf-navy-700 bg-sf-navy-50"
                            >
                              {key}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {results.data.map((row: any, i: number) => (
                          <tr
                            key={i}
                            className="border-b border-sf-navy-100 hover:bg-sf-navy-50"
                          >
                            {Object.values(row).map((val: any, j: number) => (
                              <td
                                key={j}
                                className="py-2 px-3 text-sf-navy-600 max-w-xs truncate"
                              >
                                {typeof val === 'object'
                                  ? JSON.stringify(val)
                                  : String(val ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-center text-sf-navy-400 py-8">
                      Query returned no results
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sample Queries */}
          <div className="space-y-4">
            <div className="card">
              <div className="p-4 border-b border-sf-navy-100">
                <span className="font-medium text-sf-navy-900">
                  Sample Queries
                </span>
              </div>
              <div className="p-2">
                {sampleQueries.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setSql(q.sql)}
                    className="w-full text-left p-3 rounded-lg hover:bg-sf-navy-50 transition-colors"
                  >
                    <p className="font-medium text-sf-navy-900 text-sm">
                      {q.name}
                    </p>
                    <code className="text-xs text-sf-navy-500 line-clamp-1">
                      {q.sql}
                    </code>
                  </button>
                ))}
              </div>
            </div>

            <div className="card p-4">
              <h3 className="font-medium text-sf-navy-900 mb-3">Query Tips</h3>
              <ul className="text-sm text-sf-navy-600 space-y-2">
                <li>
                  <code className="bg-sf-navy-100 px-1 rounded">__dlm</code>{' '}
                  suffix for Data Lake objects
                </li>
                <li>
                  Use <code className="bg-sf-navy-100 px-1 rounded">LIMIT</code>{' '}
                  to avoid large result sets
                </li>
                <li>
                  Field names often have{' '}
                  <code className="bg-sf-navy-100 px-1 rounded">__c</code> suffix
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

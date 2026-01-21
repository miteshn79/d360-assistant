'use client'

import { useState, useRef } from 'react'
import { useAppStore } from '@/lib/store'
import { bulkApi } from '@/lib/api'
import { useMutation, useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import {
  CheckCircle2,
  Clock,
  FileUp,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'

export function BulkView() {
  const { session, streamConfig, setStreamConfig } = useAppStore()
  const [csvContent, setCsvContent] = useState('')
  const [fileName, setFileName] = useState('')
  const [operation, setOperation] = useState<'upsert' | 'delete'>('upsert')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: jobsData, refetch: refetchJobs } = useQuery({
    queryKey: ['bulk-jobs', session.id],
    queryFn: () => bulkApi.listJobs(session.id || ''),
    enabled: !!session.id,
    refetchInterval: 10000, // Refresh every 10 seconds
  })

  const createJobMutation = useMutation({
    mutationFn: async () => {
      // Create job
      const job = await bulkApi.createJob({
        session_id: session.id || '',
        source_name: streamConfig.sourceName,
        object_name: streamConfig.objectName,
        operation,
      })

      // Upload data
      await bulkApi.uploadData({
        session_id: session.id || '',
        job_id: job.id,
        csv_data: csvContent,
      })

      // Close job to start processing
      await bulkApi.closeJob(job.id, session.id || '')

      return job
    },
    onSuccess: () => {
      toast.success('Bulk job created and data uploaded!')
      setCsvContent('')
      setFileName('')
      refetchJobs()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create bulk job')
    },
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      setCsvContent(e.target?.result as string)
    }
    reader.readAsText(file)
  }

  const handleSubmit = () => {
    if (!streamConfig.sourceName || !streamConfig.objectName) {
      toast.error('Please enter Source and Object names')
      return
    }
    if (!csvContent) {
      toast.error('Please upload a CSV file')
      return
    }
    createJobMutation.mutate()
  }

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'jobcomplete':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />
      case 'failed':
      case 'aborted':
        return <XCircle className="w-5 h-5 text-red-500" />
      default:
        return <Clock className="w-5 h-5 text-yellow-500" />
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'jobcomplete':
        return 'badge-green'
      case 'failed':
      case 'aborted':
        return 'badge-red'
      default:
        return 'badge-yellow'
    }
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-sf-navy-900 mb-2">
            Bulk Upload
          </h1>
          <p className="text-sf-navy-500">
            Upload CSV files for batch data ingestion
          </p>
        </div>

        {/* Upload Form */}
        <div className="card mb-6">
          <div className="p-6">
            <h2 className="font-medium text-sf-navy-900 mb-6 flex items-center gap-2">
              <Upload className="w-5 h-5 text-sf-blue-500" />
              Create Bulk Job
            </h2>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Source API Name</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., MyIngestionAPI"
                    value={streamConfig.sourceName}
                    onChange={(e) =>
                      setStreamConfig({ sourceName: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="label">Object API Name</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Transaction"
                    value={streamConfig.objectName}
                    onChange={(e) =>
                      setStreamConfig({ objectName: e.target.value })
                    }
                  />
                </div>
              </div>

              <div>
                <label className="label">Operation</label>
                <div className="flex gap-4">
                  {(['upsert', 'delete'] as const).map((op) => (
                    <label
                      key={op}
                      className={cn(
                        'flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors',
                        operation === op
                          ? 'border-sf-blue-500 bg-sf-blue-50 text-sf-blue-700'
                          : 'border-sf-navy-200 hover:border-sf-navy-300'
                      )}
                    >
                      <input
                        type="radio"
                        name="operation"
                        value={op}
                        checked={operation === op}
                        onChange={() => setOperation(op)}
                        className="sr-only"
                      />
                      <span className="capitalize font-medium">{op}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* File Upload */}
              <div>
                <label className="label">CSV File</label>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
                    csvContent
                      ? 'border-green-300 bg-green-50'
                      : 'border-sf-navy-200 hover:border-sf-blue-300 hover:bg-sf-navy-50'
                  )}
                >
                  {csvContent ? (
                    <>
                      <FileUp className="w-10 h-10 text-green-500 mx-auto mb-2" />
                      <p className="font-medium text-sf-navy-900">{fileName}</p>
                      <p className="text-sm text-sf-navy-500 mt-1">
                        {csvContent.split('\n').length - 1} rows
                      </p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-10 h-10 text-sf-navy-400 mx-auto mb-2" />
                      <p className="text-sf-navy-600">
                        Click to upload or drag and drop
                      </p>
                      <p className="text-sm text-sf-navy-400 mt-1">
                        CSV files only
                      </p>
                    </>
                  )}
                </div>
              </div>

              <button
                onClick={handleSubmit}
                disabled={
                  createJobMutation.isPending ||
                  !csvContent ||
                  !streamConfig.sourceName ||
                  !streamConfig.objectName
                }
                className="btn-primary w-full py-3"
              >
                {createJobMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating Job...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload & Start Job
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Jobs List */}
        <div className="card">
          <div className="p-4 border-b border-sf-navy-100">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sf-navy-900">Recent Jobs</span>
              <button
                onClick={() => refetchJobs()}
                className="btn-ghost p-2"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {jobsData?.data?.length ? (
            <div className="divide-y divide-sf-navy-100">
              {jobsData.data.map((job: any) => (
                <div
                  key={job.id}
                  className="p-4 flex items-center justify-between hover:bg-sf-navy-50"
                >
                  <div className="flex items-center gap-4">
                    {getStatusIcon(job.state)}
                    <div>
                      <p className="font-mono text-sm text-sf-navy-900">
                        {job.id}
                      </p>
                      <p className="text-xs text-sf-navy-500">
                        {job.object} | {job.operation}
                      </p>
                    </div>
                  </div>
                  <span className={getStatusBadge(job.state)}>
                    {job.state || 'Processing'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-sf-navy-400">
              <Upload className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p>No bulk jobs found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useMemo, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { dataApi } from '@/lib/api'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import {
  AlertCircle,
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  User,
  X,
} from 'lucide-react'
import {
  TimelineEvent,
  ProfileData,
  FilterOptions,
  ActiveFilters,
  extractTables,
  transformToTimeline,
  extractProfileData,
  extractFilterOptions,
  groupEventsByDate,
  filterEvents,
  formatEventTime,
  getEventColorClasses,
} from '@/lib/journey-utils'

// Profile Panel Component
function ProfilePanel({ profile }: { profile: ProfileData }) {
  return (
    <div className="bg-white rounded-xl border border-sf-navy-200 overflow-hidden h-fit sticky top-4">
      {/* Profile Header */}
      <div className="bg-gradient-to-r from-sf-blue-500 to-sf-blue-600 p-6 text-white">
        <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mb-4">
          <User className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-semibold">{profile.name}</h2>
        {profile.dateOfBirth && (
          <p className="text-sm text-white/80 mt-1">
            DOB: {new Date(profile.dateOfBirth).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        )}
      </div>

      {/* Identifiers */}
      {profile.identifiers.length > 0 && (
        <div className="p-4 border-b border-sf-navy-100">
          <h3 className="text-sm font-medium text-sf-navy-500 uppercase tracking-wide mb-3">
            Identifiers
          </h3>
          <div className="space-y-2">
            {profile.identifiers.map((id, index) => (
              <div key={index} className="flex items-start gap-2">
                <span className="text-xs text-sf-navy-400 w-20 flex-shrink-0">{id.label}:</span>
                <span className="text-sm text-sf-navy-700 font-mono break-all">
                  {id.value.length > 24 ? `${id.value.substring(0, 24)}...` : id.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights */}
      {profile.insights.length > 0 && (
        <div className="p-4">
          <h3 className="text-sm font-medium text-sf-navy-500 uppercase tracking-wide mb-3">
            Insights
          </h3>
          <div className="space-y-2">
            {profile.insights.slice(0, 6).map((insight, index) => (
              <div key={index} className="flex items-center justify-between">
                <span className="text-sm text-sf-navy-600">{insight.label}</span>
                <span className="text-sm font-medium text-sf-navy-900">
                  {typeof insight.value === 'number'
                    ? insight.value.toLocaleString()
                    : insight.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Event Card Component
function EventCard({ event, isExpanded, onToggle }: {
  event: TimelineEvent
  isExpanded: boolean
  onToggle: () => void
}) {
  const colorClasses = getEventColorClasses(event.color)
  const IconComponent = event.icon

  return (
    <div
      className={cn(
        'border rounded-lg overflow-hidden transition-all duration-200',
        colorClasses.border,
        isExpanded ? colorClasses.bg : 'bg-white hover:bg-sf-navy-25'
      )}
    >
      {/* Card Header */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
      >
        <div className={cn('p-2 rounded-lg', colorClasses.bg)}>
          <IconComponent className={cn('w-4 h-4', colorClasses.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium text-sf-navy-900">{event.summary}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-3 h-3 text-sf-navy-400" />
            <span className="text-xs text-sf-navy-500">{formatEventTime(event.timestamp)}</span>
            <span className={cn('text-xs px-2 py-0.5 rounded-full', colorClasses.badge)}>
              {event.type}
            </span>
          </div>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-5 h-5 text-sf-navy-400" />
        ) : (
          <ChevronRight className="w-5 h-5 text-sf-navy-400" />
        )}
      </button>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-2 border-t border-sf-navy-100">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {Object.entries(event.details)
              .filter(([key, value]) => value !== null && value !== undefined)
              .map(([key, value]) => (
                <div key={key} className="text-sm">
                  <span className="text-sf-navy-400 text-xs block truncate" title={key}>
                    {key.replace(/^ssot__/, '').replace(/__c$/, '').replace(/_/g, ' ')}
                  </span>
                  <span className="text-sf-navy-700 break-all" title={String(value)}>
                    {String(value).length > 50
                      ? `${String(value).substring(0, 50)}...`
                      : String(value)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Time Range Control Component
function TimeRangeControl({
  value,
  onChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
}: {
  value: ActiveFilters['timeRange']
  onChange: (value: ActiveFilters['timeRange']) => void
  customStart: Date | null
  customEnd: Date | null
  onCustomStartChange: (date: Date | null) => void
  onCustomEndChange: (date: Date | null) => void
}) {
  const presets: { value: ActiveFilters['timeRange']; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'today', label: 'Today' },
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: '90d', label: '90d' },
    { value: 'custom', label: 'Custom' },
  ]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {presets.map((preset) => (
          <button
            key={preset.value}
            onClick={() => onChange(preset.value)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
              value === preset.value
                ? 'bg-sf-blue-500 text-white'
                : 'bg-sf-navy-100 text-sf-navy-600 hover:bg-sf-navy-200'
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {value === 'custom' && (
        <div className="flex items-center gap-2 mt-2">
          <input
            type="date"
            value={customStart ? customStart.toISOString().split('T')[0] : ''}
            onChange={(e) => onCustomStartChange(e.target.value ? new Date(e.target.value) : null)}
            className="input text-sm py-1.5"
          />
          <span className="text-sf-navy-400">to</span>
          <input
            type="date"
            value={customEnd ? customEnd.toISOString().split('T')[0] : ''}
            onChange={(e) => onCustomEndChange(e.target.value ? new Date(e.target.value) : null)}
            className="input text-sm py-1.5"
          />
        </div>
      )}
    </div>
  )
}

// Filter Panel Component
function FilterPanel({
  options,
  filters,
  onFilterChange,
  onClearFilters,
}: {
  options: FilterOptions
  filters: ActiveFilters
  onFilterChange: (updates: Partial<ActiveFilters>) => void
  onClearFilters: () => void
}) {
  const [showFilters, setShowFilters] = useState(true)

  const hasActiveFilters =
    filters.eventTypes.size > 0 ||
    filters.sessionId !== null ||
    filters.deviceType !== null ||
    filters.cartId !== null ||
    filters.timeRange !== 'all'

  return (
    <div className="bg-white rounded-xl border border-sf-navy-200 overflow-hidden mb-4">
      {/* Header */}
      <button
        onClick={() => setShowFilters(!showFilters)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-sf-navy-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-sf-navy-500" />
          <span className="font-medium text-sf-navy-900">Filters</span>
          {hasActiveFilters && (
            <span className="bg-sf-blue-100 text-sf-blue-700 text-xs px-2 py-0.5 rounded-full">
              Active
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            'w-5 h-5 text-sf-navy-400 transition-transform',
            showFilters && 'rotate-180'
          )}
        />
      </button>

      {showFilters && (
        <div className="p-4 border-t border-sf-navy-100 space-y-4">
          {/* Time Range */}
          <div>
            <label className="text-sm font-medium text-sf-navy-700 mb-2 block">Time Range</label>
            <TimeRangeControl
              value={filters.timeRange}
              onChange={(timeRange) => onFilterChange({ timeRange })}
              customStart={filters.customStartDate}
              customEnd={filters.customEndDate}
              onCustomStartChange={(customStartDate) => onFilterChange({ customStartDate })}
              onCustomEndChange={(customEndDate) => onFilterChange({ customEndDate })}
            />
          </div>

          {/* Event Types */}
          {options.eventTypes.length > 0 && (
            <div>
              <label className="text-sm font-medium text-sf-navy-700 mb-2 block">Event Types</label>
              <div className="space-y-1">
                {options.eventTypes.map((eventType) => {
                  const isChecked =
                    filters.eventTypes.size === 0 || filters.eventTypes.has(eventType.type)
                  const IconComponent = eventType.icon
                  const colorClasses = getEventColorClasses(eventType.color)

                  return (
                    <label
                      key={eventType.type}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-sf-navy-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          const newTypes = new Set(filters.eventTypes)
                          if (filters.eventTypes.size === 0) {
                            // Currently showing all - select only this one
                            options.eventTypes.forEach((et) => {
                              if (et.type !== eventType.type) newTypes.add(et.type)
                            })
                            newTypes.delete(eventType.type)
                            onFilterChange({
                              eventTypes: new Set(
                                options.eventTypes
                                  .filter((et) => et.type !== eventType.type)
                                  .map((et) => et.type)
                              ),
                            })
                          } else if (isChecked) {
                            // Uncheck
                            newTypes.delete(eventType.type)
                            onFilterChange({ eventTypes: newTypes.size > 0 ? newTypes : new Set() })
                          } else {
                            // Check
                            newTypes.add(eventType.type)
                            // If all are now checked, clear the filter
                            if (newTypes.size === options.eventTypes.length) {
                              onFilterChange({ eventTypes: new Set() })
                            } else {
                              onFilterChange({ eventTypes: newTypes })
                            }
                          }
                        }}
                        className="rounded border-sf-navy-300"
                      />
                      <IconComponent className={cn('w-4 h-4', colorClasses.text)} />
                      <span className="text-sm text-sf-navy-700 flex-1">{eventType.type}</span>
                      <span className="text-xs text-sf-navy-400">{eventType.count}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* Session ID Dropdown */}
          {options.sessionIds.length > 0 && (
            <div>
              <label className="text-sm font-medium text-sf-navy-700 mb-2 block">Session</label>
              <select
                value={filters.sessionId || ''}
                onChange={(e) => onFilterChange({ sessionId: e.target.value || null })}
                className="input text-sm"
              >
                <option value="">All Sessions</option>
                {options.sessionIds.map((id) => (
                  <option key={id} value={id}>
                    {id.length > 20 ? `${id.substring(0, 20)}...` : id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Device Type Dropdown */}
          {options.deviceTypes.length > 0 && (
            <div>
              <label className="text-sm font-medium text-sf-navy-700 mb-2 block">Device</label>
              <select
                value={filters.deviceType || ''}
                onChange={(e) => onFilterChange({ deviceType: e.target.value || null })}
                className="input text-sm"
              >
                <option value="">All Devices</option>
                {options.deviceTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Cart ID Dropdown */}
          {options.cartIds.length > 0 && (
            <div>
              <label className="text-sm font-medium text-sf-navy-700 mb-2 block">Cart</label>
              <select
                value={filters.cartId || ''}
                onChange={(e) => onFilterChange({ cartId: e.target.value || null })}
                className="input text-sm"
              >
                <option value="">All Carts</option>
                {options.cartIds.map((id) => (
                  <option key={id} value={id}>
                    {id.length > 20 ? `${id.substring(0, 20)}...` : id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              onClick={onClearFilters}
              className="w-full py-2 text-sm text-sf-navy-600 hover:text-sf-navy-800 hover:bg-sf-navy-100 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <X className="w-4 h-4" />
              Clear All Filters
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Timeline Panel Component
function TimelinePanel({
  events,
  options,
  filters,
  onFilterChange,
  onClearFilters,
}: {
  events: TimelineEvent[]
  options: FilterOptions
  filters: ActiveFilters
  onFilterChange: (updates: Partial<ActiveFilters>) => void
  onClearFilters: () => void
}) {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null)

  const filteredEvents = useMemo(() => filterEvents(events, filters), [events, filters])
  const groupedEvents = useMemo(() => groupEventsByDate(filteredEvents), [filteredEvents])

  return (
    <div>
      {/* Filters */}
      <FilterPanel
        options={options}
        filters={filters}
        onFilterChange={onFilterChange}
        onClearFilters={onClearFilters}
      />

      {/* Results Count */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-sf-navy-500">
          Showing {filteredEvents.length} of {events.length} events
        </span>
      </div>

      {/* Timeline */}
      {filteredEvents.length === 0 ? (
        <div className="bg-white rounded-xl border border-sf-navy-200 p-8 text-center">
          <Calendar className="w-12 h-12 text-sf-navy-300 mx-auto mb-3" />
          <p className="text-sf-navy-500">No events match your filters</p>
          {filters.timeRange !== 'all' && (
            <button
              onClick={() => onFilterChange({ timeRange: 'all' })}
              className="text-sm text-sf-blue-600 hover:text-sf-blue-700 mt-2"
            >
              Show all time
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(groupedEvents.entries()).map(([dateKey, dateEvents]) => (
            <div key={dateKey}>
              {/* Date Header */}
              <div className="sticky top-0 z-10 bg-sf-navy-50 px-4 py-2 rounded-lg mb-3 border border-sf-navy-200">
                <span className="text-sm font-medium text-sf-navy-700">{dateKey}</span>
                <span className="text-xs text-sf-navy-400 ml-2">
                  ({dateEvents.length} event{dateEvents.length !== 1 ? 's' : ''})
                </span>
              </div>

              {/* Events for this date */}
              <div className="space-y-2 ml-4 border-l-2 border-sf-navy-200 pl-4">
                {dateEvents.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    isExpanded={expandedEventId === event.id}
                    onToggle={() =>
                      setExpandedEventId(expandedEventId === event.id ? null : event.id)
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Main Journey View Component
export function JourneyView() {
  const { session, retrieveConfig, setRetrieveConfig, dcMetadata, setDCMetadata } = useAppStore()
  const [lookupKey, setLookupKey] = useState('')
  const [lookupValue, setLookupValue] = useState('')
  const [dmoName, setDmoName] = useState('ssot__Individual__dlm')
  const [result, setResult] = useState<any>(null)
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false)

  // Get available lookup keys for the selected data graph
  const selectedDataGraph = dcMetadata.dataGraphs.find(
    dg => dg.name === retrieveConfig.dataGraphName
  )

  // Auto-fetch metadata on mount if we have a DC token but no metadata
  useEffect(() => {
    if (session.hasDCToken && dcMetadata.dataGraphs.length === 0 && !dcMetadata.isLoading) {
      handleRefreshMetadata(false)
    }
  }, [session.hasDCToken])

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

  // Filter state
  const [filters, setFilters] = useState<ActiveFilters>({
    eventTypes: new Set(),
    sessionId: null,
    deviceType: null,
    cartId: null,
    timeRange: 'all',
    customStartDate: null,
    customEndDate: null,
  })

  // Process result data
  const { profile, events, filterOptions } = useMemo(() => {
    if (!result) {
      return { profile: null, events: [], filterOptions: null }
    }

    const tables = extractTables(result)
    const profileData = extractProfileData(result)
    const timelineEvents = transformToTimeline(tables)
    const options = extractFilterOptions(timelineEvents)

    return {
      profile: profileData,
      events: timelineEvents,
      filterOptions: options,
    }
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
      // Reset filters when new data is loaded
      setFilters({
        eventTypes: new Set(),
        sessionId: null,
        deviceType: null,
        cartId: null,
        timeRange: 'all',
        customStartDate: null,
        customEndDate: null,
      })
      toast.success('Journey data loaded!')
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

  const handleFilterChange = (updates: Partial<ActiveFilters>) => {
    setFilters((prev) => ({ ...prev, ...updates }))
  }

  const handleClearFilters = () => {
    setFilters({
      eventTypes: new Set(),
      sessionId: null,
      deviceType: null,
      cartId: null,
      timeRange: 'all',
      customStartDate: null,
      customEndDate: null,
    })
  }

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-sf-navy-900 mb-2">Customer Journey</h1>
          <p className="text-sf-navy-500">
            View customer profile and engagement timeline from Data Cloud
          </p>
        </div>

        {/* Query Form */}
        <div className="card mb-6">
          <div className="p-6">
            <h2 className="font-medium text-sf-navy-900 mb-6 flex items-center gap-2">
              <Database className="w-5 h-5 text-sf-blue-500" />
              Load Customer Journey
            </h2>

            <div className="space-y-6">
              {/* Data Graph Name Dropdown */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="label mb-0">Data Graph Name</label>
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
                {dcMetadata.dataGraphs.length > 0 ? (
                  <select
                    className="input"
                    value={retrieveConfig.dataGraphName}
                    onChange={(e) => {
                      setRetrieveConfig({ dataGraphName: e.target.value })
                      setLookupKey('')
                    }}
                  >
                    <option value="">-- Select Data Graph --</option>
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
                    onChange={(e) => setRetrieveConfig({ dataGraphName: e.target.value })}
                  />
                )}
                {dcMetadata.isLoading && (
                  <p className="text-xs text-sf-navy-400 mt-1 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Loading Data Graphs...
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Lookup Key Dropdown */}
                <div>
                  <label className="label">Lookup Key</label>
                  {selectedDataGraph && selectedDataGraph.lookupKeys.length > 0 ? (
                    <select
                      className="input"
                      value={lookupKey}
                      onChange={(e) => {
                        setLookupKey(e.target.value)
                        const selectedKey = selectedDataGraph.lookupKeys.find(
                          lk => lk.name === e.target.value
                        )
                        if (selectedKey) {
                          setDmoName(selectedKey.dmoName)
                        }
                      }}
                    >
                      <option value="">-- Select Lookup Key --</option>
                      {selectedDataGraph.lookupKeys.map((lk) => (
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

              {/* DMO Name - show as dropdown when metadata available */}
              {lookupKey && lookupKey !== 'UnifiedIndividualId__c' && (
                <div className="border border-sf-navy-200 rounded-lg p-3">
                  <label className="label text-xs">DMO Name</label>
                  {dcMetadata.dmos.length > 0 || dcMetadata.dlos.length > 0 ? (
                    <select
                      className="input text-sm"
                      value={dmoName}
                      onChange={(e) => setDmoName(e.target.value)}
                    >
                      <option value="">-- Select DMO --</option>
                      {dcMetadata.dmos.length > 0 && (
                        <optgroup label="DMOs">
                          {dcMetadata.dmos.map((dmo) => (
                            <option key={dmo.name} value={dmo.name}>
                              {dmo.label || dmo.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {dcMetadata.dlos.length > 0 && (
                        <optgroup label="DLOs">
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
                      className="input text-sm"
                      placeholder="ssot__Individual__dlm"
                      value={dmoName}
                      onChange={(e) => setDmoName(e.target.value)}
                    />
                  )}
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
                    Loading Journey...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    Load Customer Journey
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        {result && profile && (
          <div className="animate-slide-up">
            {/* Desktop: Side by side */}
            <div className="hidden lg:grid lg:grid-cols-[300px_1fr] gap-6">
              {/* Profile Panel */}
              <ProfilePanel profile={profile} />

              {/* Timeline Panel */}
              <TimelinePanel
                events={events}
                options={filterOptions!}
                filters={filters}
                onFilterChange={handleFilterChange}
                onClearFilters={handleClearFilters}
              />
            </div>

            {/* Mobile: Stacked */}
            <div className="lg:hidden space-y-6">
              {/* Profile Panel (collapsible on mobile) */}
              <details className="bg-white rounded-xl border border-sf-navy-200 overflow-hidden">
                <summary className="px-4 py-3 cursor-pointer font-medium text-sf-navy-900 hover:bg-sf-navy-50">
                  <span className="inline-flex items-center gap-2">
                    <User className="w-5 h-5 text-sf-blue-500" />
                    {profile.name}
                  </span>
                </summary>
                <ProfilePanel profile={profile} />
              </details>

              {/* Timeline Panel */}
              <TimelinePanel
                events={events}
                options={filterOptions!}
                filters={filters}
                onFilterChange={handleFilterChange}
                onClearFilters={handleClearFilters}
              />
            </div>
          </div>
        )}

        {/* Empty State */}
        {!result && (
          <div className="card p-12 text-center">
            <User className="w-16 h-16 text-sf-navy-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-sf-navy-700 mb-2">No Journey Loaded</h3>
            <p className="text-sf-navy-500 max-w-md mx-auto">
              Enter a Data Graph name and lookup key/value above to load a customer&apos;s profile
              and engagement timeline.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

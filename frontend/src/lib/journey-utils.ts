import {
  CreditCard,
  Globe,
  Search,
  ShoppingCart,
  Package,
  CheckCircle,
  Calendar,
  type LucideIcon,
} from 'lucide-react'

// Timeline event interface
export interface TimelineEvent {
  id: string
  timestamp: Date
  type: string
  tableName: string
  icon: LucideIcon
  color: string
  summary: string
  details: Record<string, any>
  sessionId?: string
  deviceType?: string
  cartId?: string
}

// Profile data interface
export interface ProfileData {
  name: string
  dateOfBirth?: string
  identifiers: { label: string; value: string }[]
  insights: { label: string; value: string | number }[]
  rawFields: Record<string, any>
}

// Filter options interface
export interface FilterOptions {
  eventTypes: { type: string; count: number; icon: LucideIcon; color: string }[]
  sessionIds: string[]
  deviceTypes: string[]
  cartIds: string[]
}

// Active filters interface
export interface ActiveFilters {
  eventTypes: Set<string>
  sessionId: string | null
  deviceType: string | null
  cartId: string | null
  timeRange: 'all' | 'today' | '7d' | '30d' | '90d' | 'custom'
  customStartDate: Date | null
  customEndDate: Date | null
}

// Event type configuration
interface EventTypeConfig {
  pattern: RegExp
  dateTimeField: string
  icon: LucideIcon
  color: string
  label: string
  getSummary: (row: Record<string, any>) => string
}

const eventTypeConfigs: EventTypeConfig[] = [
  {
    pattern: /CreditCardTransaction/i,
    dateTimeField: 'txn_date__c',
    icon: CreditCard,
    color: 'green',
    label: 'Transaction',
    getSummary: (row) => {
      const merchant = row.merchant_name__c || row.ssot__MerchantName__c || 'Unknown merchant'
      const amount = row.txn_amount__c || row.ssot__TransactionAmount__c
      const currency = row.currency__c || row.ssot__CurrencyIsoCode__c || ''
      return amount ? `${merchant} - ${currency}${Number(amount).toLocaleString()}` : merchant
    },
  },
  {
    pattern: /WebsiteEngagement/i,
    dateTimeField: 'ssot__EngagementDateTm__c',
    icon: Globe,
    color: 'blue',
    label: 'Website Visit',
    getSummary: (row) => {
      const page = row.ssot__WebPageUrl__c || row.page_url__c || 'Website'
      const action = row.ssot__EngagementAction__c || row.action__c || 'visited'
      return `${action} - ${page}`.substring(0, 80)
    },
  },
  {
    pattern: /ProductBrowseEngagement/i,
    dateTimeField: 'ssot__CreatedDate__c',
    icon: Search,
    color: 'purple',
    label: 'Product Browse',
    getSummary: (row) => {
      const product = row.ssot__ProductName__c || row.product_name__c || ''
      const category = row.ssot__ProductCategoryText__c || row.category__c || ''
      if (product) return `Browsed: ${product}`
      if (category) return `Browsing: ${category}`
      return 'Product browsing activity'
    },
  },
  {
    pattern: /ShoppingCartEngagement(?!Product)/i,
    dateTimeField: 'ssot__EngagementDateTm__c',
    icon: ShoppingCart,
    color: 'orange',
    label: 'Cart Update',
    getSummary: (row) => {
      const action = row.ssot__EngagementAction__c || row.action__c || 'Cart updated'
      const cartId = row.ssot__ShoppingCartEngagementId__c || ''
      return cartId ? `${action} (${cartId.substring(0, 8)}...)` : action
    },
  },
  {
    pattern: /ShoppingCartProductEngagement/i,
    dateTimeField: 'ssot__EngagementDateTm__c',
    icon: Package,
    color: 'orange',
    label: 'Cart Item',
    getSummary: (row) => {
      const product = row.ssot__ProductName__c || row.product_name__c || 'Item'
      const qty = row.ssot__Quantity__c || row.quantity__c
      return qty ? `${product} x${qty}` : product
    },
  },
  {
    pattern: /ProductOrderEngagement/i,
    dateTimeField: 'ssot__EngagementDateTm__c',
    icon: CheckCircle,
    color: 'green',
    label: 'Order',
    getSummary: (row) => {
      const orderId = row.ssot__OrderId__c || row.order_id__c || ''
      const total = row.ssot__TotalAmount__c || row.total__c
      const currency = row.ssot__CurrencyIsoCode__c || row.currency__c || ''
      if (total) return `Order ${orderId ? orderId.substring(0, 8) + '...' : ''} - ${currency}${Number(total).toLocaleString()}`
      return orderId ? `Order ${orderId.substring(0, 8)}...` : 'Order placed'
    },
  },
]

// Default event config for unknown tables
const defaultEventConfig: Omit<EventTypeConfig, 'pattern'> = {
  dateTimeField: '',
  icon: Calendar,
  color: 'gray',
  label: 'Event',
  getSummary: () => 'Activity',
}

// Find matching event config for a table name
function findEventConfig(tableName: string): EventTypeConfig | null {
  for (const config of eventTypeConfigs) {
    if (config.pattern.test(tableName)) {
      return config
    }
  }
  return null
}

// Detect datetime field in a row
function detectDateTimeField(row: Record<string, any>, preferredField?: string): string | null {
  // Try preferred field first
  if (preferredField && row[preferredField] && isValidDate(row[preferredField])) {
    return preferredField
  }

  // Common datetime field patterns
  const dateTimePatterns = [
    'txn_date__c',
    'ssot__EngagementDateTm__c',
    'ssot__CreatedDate__c',
    'ssot__ModifiedDate__c',
    'created_date__c',
    'timestamp__c',
    'event_date__c',
  ]

  for (const field of dateTimePatterns) {
    if (row[field] && isValidDate(row[field])) {
      return field
    }
  }

  // Look for any field that looks like a date
  for (const [key, value] of Object.entries(row)) {
    if (isValidDate(value)) {
      return key
    }
  }

  return null
}

// Check if a value is a valid date
function isValidDate(value: any): boolean {
  if (!value) return false
  if (typeof value !== 'string' && typeof value !== 'number') return false
  const date = new Date(value)
  return !isNaN(date.getTime()) && date.getFullYear() > 1970
}

// Parse json_blob__c from Data Graph API response
export function parseDataGraphResponse(rawData: any): any {
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
          console.warn('Failed to parse json_blob__c:', e)
        }
      }
    }
  }

  return data
}

// Recursively find all arrays of objects in the data structure
function findAllTables(data: any, foundTables: Map<string, any[]>, visited: Set<any> = new Set()): void {
  if (!data || typeof data !== 'object' || visited.has(data)) return
  visited.add(data)

  if (Array.isArray(data)) {
    for (const item of data) {
      findAllTables(item, foundTables, visited)
    }
  } else {
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        const existingRows = foundTables.get(key) || []
        for (const row of value) {
          const flatRow: Record<string, any> = {}
          for (const [rowKey, rowValue] of Object.entries(row || {})) {
            if (!Array.isArray(rowValue) && (typeof rowValue !== 'object' || rowValue === null)) {
              flatRow[rowKey] = rowValue
            }
          }
          if (Object.keys(flatRow).length > 0) {
            existingRows.push(flatRow)
          }
          findAllTables(row, foundTables, visited)
        }
        foundTables.set(key, existingRows)
      } else if (typeof value === 'object' && value !== null) {
        findAllTables(value, foundTables, visited)
      }
    }
  }
}

// Extract tables from raw data
export function extractTables(rawData: any): Map<string, any[]> {
  const data = parseDataGraphResponse(rawData)
  const foundTables = new Map<string, any[]>()

  if (!data || typeof data !== 'object') return foundTables

  findAllTables(data, foundTables)
  return foundTables
}

// Transform tables to timeline events
export function transformToTimeline(tables: Map<string, any[]>): TimelineEvent[] {
  const events: TimelineEvent[] = []

  for (const [tableName, rows] of tables.entries()) {
    const config = findEventConfig(tableName)

    // Skip non-event tables (profile tables, identity links, etc.)
    if (!config) {
      const nameLower = tableName.toLowerCase()
      if (
        nameLower.includes('individual') ||
        nameLower.includes('profile') ||
        nameLower.includes('identity') ||
        nameLower.includes('link') ||
        nameLower.includes('insight')
      ) {
        continue
      }
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const dateTimeField = detectDateTimeField(row, config?.dateTimeField)

      if (!dateTimeField) continue

      const timestamp = new Date(row[dateTimeField])
      if (isNaN(timestamp.getTime())) continue

      const eventConfig = config || defaultEventConfig

      events.push({
        id: `${tableName}-${i}-${timestamp.getTime()}`,
        timestamp,
        type: eventConfig.label,
        tableName,
        icon: eventConfig.icon,
        color: eventConfig.color,
        summary: eventConfig.getSummary(row),
        details: row,
        sessionId: row.ssot__WebCookieId__c || row.session_id__c,
        deviceType: row.ssot__DeviceTypeTxt__c || row.device_type__c,
        cartId: row.ssot__ShoppingCartEngagementId__c || row.cart_id__c,
      })
    }
  }

  // Sort by timestamp descending (most recent first)
  events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

  return events
}

// Extract profile data from tables
export function extractProfileData(rawData: any): ProfileData | null {
  const data = parseDataGraphResponse(rawData)

  if (!data || typeof data !== 'object') return null

  // Extract top-level profile fields
  const profileFields: Record<string, any> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value) && (typeof value !== 'object' || value === null)) {
      profileFields[key] = value
    }
  }

  // Build profile data
  const name = [
    profileFields.ssot__FirstName__c || profileFields.first_name__c || profileFields.FirstName,
    profileFields.ssot__LastName__c || profileFields.last_name__c || profileFields.LastName,
  ]
    .filter(Boolean)
    .join(' ') || profileFields.ssot__Name__c || profileFields.Name || 'Unknown'

  const dob = profileFields.ssot__BirthDate__c || profileFields.birth_date__c || profileFields.DateOfBirth

  // Extract identifiers
  const identifiers: { label: string; value: string }[] = []

  const idMappings: [string, string[]][] = [
    ['Unified ID', ['UnifiedIndividualId__c', 'ssot__UnifiedIndividualId__c']],
    ['Individual ID', ['ssot__Id__c', 'Id', 'individual_id__c']],
    ['Traveler ID', ['TravelerID__c', 'traveler_id__c', 'ssot__TravelerId__c']],
    ['Loyalty ID', ['LoyaltyID__c', 'loyalty_id__c', 'ssot__LoyaltyId__c', 'LoyaltyNumber__c']],
    ['Customer ID', ['CustomerId__c', 'customer_id__c', 'ssot__CustomerId__c']],
    ['Email', ['ssot__EmailAddress__c', 'Email', 'email__c']],
    ['Phone', ['ssot__Phone__c', 'Phone', 'phone__c']],
  ]

  for (const [label, fields] of idMappings) {
    for (const field of fields) {
      if (profileFields[field]) {
        identifiers.push({ label, value: String(profileFields[field]) })
        break
      }
    }
  }

  // Extract insights from __cio tables
  const tables = extractTables(rawData)
  const insights: { label: string; value: string | number }[] = []

  for (const [tableName, rows] of tables.entries()) {
    if (tableName.toLowerCase().includes('__cio') || tableName.toLowerCase().includes('insight')) {
      for (const row of rows) {
        for (const [key, value] of Object.entries(row)) {
          if (value !== null && value !== undefined && !key.startsWith('ssot__Id')) {
            const label = key
              .replace(/^ssot__/, '')
              .replace(/__c$/, '')
              .replace(/([a-z])([A-Z])/g, '$1 $2')
              .replace(/_/g, ' ')
            insights.push({
              label,
              value: typeof value === 'number' ? value : String(value),
            })
          }
        }
      }
    }
  }

  return {
    name,
    dateOfBirth: dob,
    identifiers,
    insights,
    rawFields: profileFields,
  }
}

// Extract filter options from events
export function extractFilterOptions(events: TimelineEvent[]): FilterOptions {
  const typeCounts = new Map<string, { count: number; icon: LucideIcon; color: string }>()
  const sessionIds = new Set<string>()
  const deviceTypes = new Set<string>()
  const cartIds = new Set<string>()

  for (const event of events) {
    // Count event types
    const existing = typeCounts.get(event.type)
    if (existing) {
      existing.count++
    } else {
      typeCounts.set(event.type, { count: 1, icon: event.icon, color: event.color })
    }

    // Collect unique filter values
    if (event.sessionId) sessionIds.add(event.sessionId)
    if (event.deviceType) deviceTypes.add(event.deviceType)
    if (event.cartId) cartIds.add(event.cartId)
  }

  return {
    eventTypes: Array.from(typeCounts.entries()).map(([type, data]) => ({
      type,
      count: data.count,
      icon: data.icon,
      color: data.color,
    })),
    sessionIds: Array.from(sessionIds).sort(),
    deviceTypes: Array.from(deviceTypes).sort(),
    cartIds: Array.from(cartIds).sort(),
  }
}

// Group events by date
export function groupEventsByDate(events: TimelineEvent[]): Map<string, TimelineEvent[]> {
  const groups = new Map<string, TimelineEvent[]>()

  for (const event of events) {
    const dateKey = event.timestamp.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })

    const existing = groups.get(dateKey)
    if (existing) {
      existing.push(event)
    } else {
      groups.set(dateKey, [event])
    }
  }

  return groups
}

// Filter events based on active filters
export function filterEvents(events: TimelineEvent[], filters: ActiveFilters): TimelineEvent[] {
  return events.filter((event) => {
    // Event type filter
    if (filters.eventTypes.size > 0 && !filters.eventTypes.has(event.type)) {
      return false
    }

    // Session ID filter
    if (filters.sessionId && event.sessionId !== filters.sessionId) {
      return false
    }

    // Device type filter
    if (filters.deviceType && event.deviceType !== filters.deviceType) {
      return false
    }

    // Cart ID filter
    if (filters.cartId && event.cartId !== filters.cartId) {
      return false
    }

    // Time range filter
    const now = new Date()
    const eventTime = event.timestamp.getTime()

    switch (filters.timeRange) {
      case 'today': {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        if (eventTime < startOfDay) return false
        break
      }
      case '7d': {
        const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000
        if (eventTime < sevenDaysAgo) return false
        break
      }
      case '30d': {
        const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000
        if (eventTime < thirtyDaysAgo) return false
        break
      }
      case '90d': {
        const ninetyDaysAgo = now.getTime() - 90 * 24 * 60 * 60 * 1000
        if (eventTime < ninetyDaysAgo) return false
        break
      }
      case 'custom': {
        if (filters.customStartDate && eventTime < filters.customStartDate.getTime()) {
          return false
        }
        if (filters.customEndDate) {
          // Include the entire end day
          const endOfDay = new Date(filters.customEndDate)
          endOfDay.setHours(23, 59, 59, 999)
          if (eventTime > endOfDay.getTime()) {
            return false
          }
        }
        break
      }
    }

    return true
  })
}

// Format date for display
export function formatEventTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

// Get color classes for event type
export function getEventColorClasses(color: string): { bg: string; text: string; border: string; badge: string } {
  const colorMap: Record<string, { bg: string; text: string; border: string; badge: string }> = {
    green: {
      bg: 'bg-green-50',
      text: 'text-green-600',
      border: 'border-green-200',
      badge: 'bg-green-100 text-green-700',
    },
    blue: {
      bg: 'bg-blue-50',
      text: 'text-blue-600',
      border: 'border-blue-200',
      badge: 'bg-blue-100 text-blue-700',
    },
    purple: {
      bg: 'bg-purple-50',
      text: 'text-purple-600',
      border: 'border-purple-200',
      badge: 'bg-purple-100 text-purple-700',
    },
    orange: {
      bg: 'bg-orange-50',
      text: 'text-orange-600',
      border: 'border-orange-200',
      badge: 'bg-orange-100 text-orange-700',
    },
    gray: {
      bg: 'bg-gray-50',
      text: 'text-gray-600',
      border: 'border-gray-200',
      badge: 'bg-gray-100 text-gray-700',
    },
  }

  return colorMap[color] || colorMap.gray
}

'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
  Cloud,
  Database,
  FileJson,
  Home,
  MessageSquare,
  Search,
  Send,
  Settings,
  Upload,
  Workflow,
  LogOut,
  User,
  CheckCircle2,
  Circle,
} from 'lucide-react'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  href: string
  requiresAuth?: boolean
  requiresDCToken?: boolean
}

const navItems: NavItem[] = [
  { id: 'home', label: 'Home', icon: <Home className="w-5 h-5" />, href: '/' },
  { id: 'configs', label: 'Saved Configs', icon: <Settings className="w-5 h-5" />, href: '/configs' },
  { id: 'setup', label: 'Schema Designer', icon: <MessageSquare className="w-5 h-5" />, href: '/setup' },
  { id: 'connect', label: 'Connect', icon: <Workflow className="w-5 h-5" />, href: '/connect' },
  {
    id: 'stream',
    label: 'Stream Data',
    icon: <Send className="w-5 h-5" />,
    href: '/stream',
    requiresDCToken: true,
  },
  {
    id: 'retrieve',
    label: 'Retrieve Data',
    icon: <Database className="w-5 h-5" />,
    href: '/retrieve',
    requiresDCToken: true,
  },
  {
    id: 'query',
    label: 'Query (SQL)',
    icon: <Search className="w-5 h-5" />,
    href: '/query',
    requiresDCToken: true,
  },
  {
    id: 'bulk',
    label: 'Bulk Upload',
    icon: <Upload className="w-5 h-5" />,
    href: '/bulk',
    requiresDCToken: true,
  },
  {
    id: 'metadata',
    label: 'Metadata',
    icon: <FileJson className="w-5 h-5" />,
    href: '/metadata',
    requiresDCToken: true,
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { session, clearSession } = useAppStore()

  const handleDisconnect = () => {
    clearSession()
    router.push('/')
  }

  return (
    <aside className="w-64 bg-sf-navy-900 text-white flex flex-col h-screen fixed left-0 top-0">
      {/* Logo */}
      <div className="p-6 border-b border-sf-navy-700">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-sf-blue-500 rounded-xl flex items-center justify-center">
            <Cloud className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-semibold text-lg">Data Cloud</h1>
            <p className="text-xs text-sf-navy-400">Assistant</p>
          </div>
        </Link>
      </div>

      {/* Connection Status */}
      <div className="px-4 py-3 border-b border-sf-navy-700">
        <div className="flex items-center gap-2 text-sm">
          {session.hasDCToken ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <span className="text-green-400">Connected</span>
            </>
          ) : session.authenticated ? (
            <>
              <Circle className="w-4 h-4 text-yellow-400 fill-yellow-400" />
              <span className="text-yellow-400">SF Only</span>
            </>
          ) : (
            <>
              <Circle className="w-4 h-4 text-sf-navy-500" />
              <span className="text-sf-navy-400">Not connected</span>
            </>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <div className="px-3 mb-2">
          <span className="text-xs font-medium text-sf-navy-500 uppercase tracking-wider">
            Menu
          </span>
        </div>
        <ul className="space-y-1 px-2">
          {navItems.map((item) => {
            const isDisabled =
              (item.requiresAuth && !session.authenticated) ||
              (item.requiresDCToken && !session.hasDCToken)

            const isActive = pathname === item.href

            if (isDisabled) {
              return (
                <li key={item.id}>
                  <span
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium',
                      'text-sf-navy-600 cursor-not-allowed'
                    )}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    <span className="ml-auto text-xs bg-sf-navy-700 px-2 py-0.5 rounded">
                      {item.requiresDCToken ? 'DC Token' : 'Auth'}
                    </span>
                  </span>
                </li>
              )
            }

            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-sf-blue-500 text-white'
                      : 'text-sf-navy-300 hover:bg-sf-navy-800 hover:text-white'
                  )}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* User Section */}
      {session.authenticated && (
        <div className="p-4 border-t border-sf-navy-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-sf-navy-700 rounded-full flex items-center justify-center">
              <User className="w-5 h-5 text-sf-navy-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {session.userInfo?.display_name || session.userInfo?.name || 'User'}
              </p>
              <p className="text-xs text-sf-navy-400 truncate">
                {session.userInfo?.email || session.instanceUrl}
              </p>
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-sf-navy-400 hover:text-white hover:bg-sf-navy-800 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Disconnect</span>
          </button>
        </div>
      )}
    </aside>
  )
}

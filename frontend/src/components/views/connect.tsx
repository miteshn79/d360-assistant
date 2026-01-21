'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAppStore } from '@/lib/store'
import { authApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import Image from 'next/image'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  ExternalLink,
  Key,
  Loader2,
  Lock,
  Server,
  Shield,
  Check,
} from 'lucide-react'
import { copyToClipboard } from '@/lib/utils'

type Step = 'setup' | 'config' | 'oauth' | 'dctoken' | 'complete'

// Auto-detect callback URL based on environment
function getCallbackUrl(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:8000/oauth/callback'
  }

  const hostname = window.location.hostname
  const protocol = window.location.protocol

  // Check if we're on Heroku
  if (hostname.includes('herokuapp.com')) {
    return `${protocol}//${hostname}/oauth/callback`
  }

  // Check for other production environments
  if (!hostname.includes('localhost') && !hostname.includes('127.0.0.1')) {
    return `${protocol}//${hostname}/oauth/callback`
  }

  // Local development - use port 8000 to match backend/Connected App
  return 'http://localhost:8000/oauth/callback'
}

export function ConnectView() {
  const router = useRouter()
  const {
    oauthConfig,
    setOAuthConfig,
    session,
    setSession,
  } = useAppStore()

  const [step, setStep] = useState<Step>(
    session.hasDCToken ? 'complete' : session.authenticated ? 'dctoken' : 'setup'
  )
  const [isLoading, setIsLoading] = useState(false)
  const [showNewAppInstructions, setShowNewAppInstructions] = useState(true)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [expandedImage, setExpandedImage] = useState<string | null>(null)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [callbackUrlInput, setCallbackUrlInput] = useState('')

  // Get the correct callback URL
  const callbackUrl = getCallbackUrl()
  const isHeroku = typeof window !== 'undefined' && window.location.hostname.includes('herokuapp.com')

  // Update redirect URI in config when component mounts
  useEffect(() => {
    setOAuthConfig({ redirectUri: callbackUrl })
  }, [callbackUrl, setOAuthConfig])

  const handleCopyCallbackUrl = async () => {
    await copyToClipboard(callbackUrl)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
    toast.success('Callback URL copied!')
  }

  const handleStartOAuth = async () => {
    if (!oauthConfig.consumerKey) {
      toast.error('Please enter your Consumer Key')
      return
    }

    // Validate login URL
    const loginUrl = oauthConfig.loginUrl?.trim()
    if (!loginUrl || !loginUrl.startsWith('https://')) {
      toast.error('Please enter a valid Salesforce Login URL (must start with https://)')
      return
    }
    if (!loginUrl.includes('salesforce.com') && !loginUrl.includes('force.com')) {
      toast.error('Login URL must be a Salesforce domain (salesforce.com or force.com)')
      return
    }

    setIsLoading(true)
    try {
      const result = await authApi.initOAuth({
        login_url: loginUrl,
        consumer_key: oauthConfig.consumerKey,
        redirect_uri: callbackUrl,
      })

      // Store session ID
      setSession({ id: result.session_id })
      localStorage.setItem('oauth_session_id', result.session_id)

      // Store auth URL and open in new tab
      setAuthUrl(result.auth_url)
      window.open(result.auth_url, '_blank')

      // Move to oauth step to show callback URL input
      setStep('oauth')
    } catch (error: any) {
      toast.error(error.message || 'Failed to start OAuth flow')
    } finally {
      setIsLoading(false)
    }
  }

  const handleProcessCallback = async () => {
    if (!callbackUrlInput.trim()) {
      toast.error('Please paste the callback URL')
      return
    }

    // Extract code from the URL
    try {
      const url = new URL(callbackUrlInput)
      const code = url.searchParams.get('code')

      if (!code) {
        toast.error('No authorization code found in the URL. Make sure you copied the full URL after logging in.')
        return
      }

      const sessionId = localStorage.getItem('oauth_session_id')
      if (!sessionId) {
        toast.error('Session expired. Please start over.')
        setStep('config')
        return
      }

      setIsLoading(true)
      const result = await authApi.handleCallback({
        code,
        session_id: sessionId,
      })

      setSession({
        id: sessionId,
        authenticated: true,
        instanceUrl: result.instance_url,
        userInfo: result.user_info,
      })

      setStep('dctoken')
      toast.success('Successfully authenticated with Salesforce!')
    } catch (error: any) {
      toast.error(error.message || 'Failed to process callback URL')
    } finally {
      setIsLoading(false)
    }
  }

  const handleExchangeDCToken = async () => {
    if (!session.id) {
      toast.error('No active session')
      return
    }

    setIsLoading(true)
    try {
      const result = await authApi.exchangeDCToken(session.id)
      setSession({
        hasDCToken: true,
        dcInstanceUrl: result.dc_instance_url,
      })
      setStep('complete')
      toast.success('Data Cloud token obtained!')
    } catch (error: any) {
      toast.error(error.message || 'Failed to exchange token')
    } finally {
      setIsLoading(false)
    }
  }

  const steps = [
    { id: 'setup', label: 'Setup App', icon: <Key className="w-4 h-4" /> },
    { id: 'config', label: 'Configure', icon: <Key className="w-4 h-4" /> },
    { id: 'oauth', label: 'Authenticate', icon: <Lock className="w-4 h-4" /> },
    { id: 'dctoken', label: 'DC Token', icon: <Cloud className="w-4 h-4" /> },
    { id: 'complete', label: 'Connected', icon: <CheckCircle2 className="w-4 h-4" /> },
  ]

  const stepOrder = ['setup', 'config', 'oauth', 'dctoken', 'complete']
  const currentStepIndex = stepOrder.indexOf(step)

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-sf-navy-900 mb-2">
            Connect to Salesforce
          </h1>
          <p className="text-sf-navy-500">
            Set up your Connected App and authenticate to access Data Cloud APIs
          </p>
        </div>

        {/* Heroku Warning */}
        {isHeroku && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-yellow-800">Heroku Deployment Detected</p>
                <p className="text-sm text-yellow-700 mt-1">
                  Make sure your Connected App&apos;s Callback URL is set to:
                </p>
                <code className="text-sm bg-yellow-100 px-2 py-1 rounded mt-2 block text-yellow-900">
                  {callbackUrl}
                </code>
              </div>
            </div>
          </div>
        )}

        {/* Progress Steps */}
        <div className="mb-8 overflow-x-auto">
          <div className="flex items-center min-w-max">
            {steps.map((s, index) => (
              <div key={s.id} className="flex items-center">
                <button
                  onClick={() => {
                    if (stepOrder.indexOf(s.id) <= currentStepIndex) {
                      setStep(s.id as Step)
                    }
                  }}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors',
                    stepOrder.indexOf(s.id) <= currentStepIndex
                      ? 'bg-sf-blue-500 text-white'
                      : 'bg-sf-navy-100 text-sf-navy-400'
                  )}
                >
                  {s.icon}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {index < steps.length - 1 && (
                  <div
                    className={cn(
                      'w-8 sm:w-12 h-0.5 mx-1',
                      stepOrder.indexOf(steps[index + 1].id) <= currentStepIndex
                        ? 'bg-sf-blue-500'
                        : 'bg-sf-navy-200'
                    )}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="card">
          {/* Step: Setup Connected App */}
          {step === 'setup' && (
            <div className="p-8 animate-fade-in">
              <h2 className="text-lg font-semibold text-sf-navy-900 mb-6">
                Set Up External Client App
              </h2>

              {/* Callback URL - Most Important */}
              <div className="bg-sf-blue-50 border border-sf-blue-200 rounded-xl p-4 mb-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-sf-blue-900">
                      Required Callback URL
                    </p>
                    <code className="text-sm text-sf-blue-700 bg-sf-blue-100 px-2 py-1 rounded mt-2 block">
                      {callbackUrl}
                    </code>
                  </div>
                  <button
                    onClick={handleCopyCallbackUrl}
                    className="btn-secondary text-sm py-1.5 px-3 flex-shrink-0"
                  >
                    {copiedUrl ? (
                      <>
                        <Check className="w-4 h-4 mr-1" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-1" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Toggle: New vs Existing App */}
              <div className="flex gap-2 mb-6">
                <button
                  onClick={() => setShowNewAppInstructions(true)}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    showNewAppInstructions
                      ? 'bg-sf-blue-500 text-white'
                      : 'bg-sf-navy-100 text-sf-navy-600 hover:bg-sf-navy-200'
                  )}
                >
                  Create New App
                </button>
                <button
                  onClick={() => setShowNewAppInstructions(false)}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    !showNewAppInstructions
                      ? 'bg-sf-blue-500 text-white'
                      : 'bg-sf-navy-100 text-sf-navy-600 hover:bg-sf-navy-200'
                  )}
                >
                  Use Existing App
                </button>
              </div>

              {showNewAppInstructions ? (
                <div className="space-y-6">
                  {/* Step 1 */}
                  <div className="border border-sf-navy-200 rounded-xl overflow-hidden">
                    <div className="bg-sf-navy-50 px-4 py-3 border-b border-sf-navy-200">
                      <h3 className="font-medium text-sf-navy-900">
                        Step 1: Create External Client App
                      </h3>
                    </div>
                    <div className="p-4">
                      <ol className="list-decimal list-inside space-y-2 text-sm text-sf-navy-600">
                        <li>In Salesforce, go to <strong>Setup</strong></li>
                        <li>Search for <strong>&quot;App Manager&quot;</strong></li>
                        <li>Click <strong>&quot;New Connected App&quot;</strong> dropdown and select <strong>&quot;Create an External Client App&quot;</strong></li>
                        <li>Fill in:
                          <ul className="list-disc list-inside ml-4 mt-1">
                            <li>External Client App Name: <code className="bg-sf-navy-100 px-1 rounded">Data Cloud Debugger</code></li>
                            <li>Contact Email: Your email</li>
                          </ul>
                        </li>
                      </ol>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="border border-sf-navy-200 rounded-xl overflow-hidden">
                    <div className="bg-sf-navy-50 px-4 py-3 border-b border-sf-navy-200">
                      <h3 className="font-medium text-sf-navy-900">
                        Step 2: Enable OAuth Settings
                      </h3>
                    </div>
                    <div className="p-4">
                      <div className="overflow-x-auto mb-4">
                        <table className="w-full text-sm">
                          <tbody>
                            <tr className="border-b border-sf-navy-100">
                              <td className="py-2 font-medium text-sf-navy-700">Enable OAuth</td>
                              <td className="py-2 text-sf-navy-600">✅ Check this</td>
                            </tr>
                            <tr className="border-b border-sf-navy-100">
                              <td className="py-2 font-medium text-sf-navy-700">Callback URL</td>
                              <td className="py-2">
                                <code className="bg-sf-navy-100 px-1 rounded text-sf-navy-800">{callbackUrl}</code>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <p className="text-sm text-sf-navy-600 mb-3">
                        <strong>Select OAuth Scopes</strong> (move these from Available to Selected):
                      </p>
                      <ul className="list-disc list-inside text-sm text-sf-navy-600 space-y-1">
                        <li>Manage user data via APIs (api)</li>
                        <li>Perform requests at any time (refresh_token, offline_access)</li>
                        <li>Manage Data Cloud Ingestion API data (cdp_ingest_api)</li>
                        <li>Manage Data Cloud profile data (cdp_profile_api)</li>
                      </ul>

                      {/* OAuth Scopes Image */}
                      <button
                        onClick={() => setExpandedImage(expandedImage === 'oauth' ? null : 'oauth')}
                        className="mt-4 text-sm text-sf-blue-600 hover:text-sf-blue-700 flex items-center gap-1"
                      >
                        {expandedImage === 'oauth' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        View screenshot
                      </button>
                      {expandedImage === 'oauth' && (
                        <div className="mt-3 border border-sf-navy-200 rounded-lg overflow-hidden">
                          <Image
                            src="/assets/oauth_scopes.png"
                            alt="OAuth Scopes configuration"
                            width={800}
                            height={400}
                            className="w-full"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="border border-sf-navy-200 rounded-xl overflow-hidden">
                    <div className="bg-sf-navy-50 px-4 py-3 border-b border-sf-navy-200">
                      <h3 className="font-medium text-sf-navy-900">
                        Step 3: Configure Flow & Security
                      </h3>
                    </div>
                    <div className="p-4">
                      <ul className="list-disc list-inside text-sm text-sf-navy-600 space-y-2">
                        <li><strong>Enable Client Credentials Flow:</strong> ✅ Check</li>
                        <li><strong>Enable Authorization Code and Credentials Flow:</strong> ✅ Check</li>
                        <li><strong>Require Proof Key for Code Exchange (PKCE):</strong> ✅ Check</li>
                        <li><strong>Require Secret for Web Server Flow:</strong> ❌ Uncheck</li>
                        <li><strong>Require Secret for Refresh Token Flow:</strong> ❌ Uncheck</li>
                      </ul>

                      <button
                        onClick={() => setExpandedImage(expandedImage === 'flow' ? null : 'flow')}
                        className="mt-4 text-sm text-sf-blue-600 hover:text-sf-blue-700 flex items-center gap-1"
                      >
                        {expandedImage === 'flow' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        View screenshot
                      </button>
                      {expandedImage === 'flow' && (
                        <div className="mt-3 border border-sf-navy-200 rounded-lg overflow-hidden">
                          <Image
                            src="/assets/flow_security_settings.png"
                            alt="Flow and Security settings"
                            width={800}
                            height={400}
                            className="w-full"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="border border-sf-navy-200 rounded-xl overflow-hidden">
                    <div className="bg-sf-navy-50 px-4 py-3 border-b border-sf-navy-200">
                      <h3 className="font-medium text-sf-navy-900">
                        Step 4: Set IP Relaxation (Important!)
                      </h3>
                    </div>
                    <div className="p-4">
                      <ol className="list-decimal list-inside space-y-2 text-sm text-sf-navy-600">
                        <li>Save the app and wait for it to be created</li>
                        <li>Go to the <strong>Policies</strong> tab</li>
                        <li>Set <strong>IP Relaxation</strong> to: <code className="bg-sf-navy-100 px-1 rounded">Relax IP restrictions</code></li>
                      </ol>

                      <button
                        onClick={() => setExpandedImage(expandedImage === 'ip' ? null : 'ip')}
                        className="mt-4 text-sm text-sf-blue-600 hover:text-sf-blue-700 flex items-center gap-1"
                      >
                        {expandedImage === 'ip' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        View screenshot
                      </button>
                      {expandedImage === 'ip' && (
                        <div className="mt-3 border border-sf-navy-200 rounded-lg overflow-hidden">
                          <Image
                            src="/assets/ip_relaxation_settings.png"
                            alt="IP Relaxation settings"
                            width={800}
                            height={400}
                            className="w-full"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Important Note */}
                  <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-yellow-800">Wait 10 Minutes</p>
                        <p className="text-sm text-yellow-700 mt-1">
                          After creating your Connected App, wait approximately 10 minutes before using it.
                          Salesforce needs time to propagate the app configuration across all servers.
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => setStep('config')}
                    className="btn-primary w-full py-3"
                  >
                    I&apos;ve Created My App
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  <p className="text-sf-navy-600">
                    If you already have an External Client App configured, make sure it has the correct settings:
                  </p>

                  <div className="bg-sf-navy-50 rounded-xl p-4">
                    <h4 className="font-medium text-sf-navy-900 mb-3">Required Settings:</h4>
                    <ul className="text-sm text-sf-navy-600 space-y-2">
                      <li>
                        <strong>Callback URL:</strong>{' '}
                        <code className="bg-sf-navy-100 px-1 rounded">{callbackUrl}</code>
                      </li>
                      <li><strong>OAuth Scopes:</strong> api, refresh_token, cdp_ingest_api, cdp_profile_api</li>
                      <li><strong>PKCE:</strong> Enabled</li>
                      <li><strong>Secret Required:</strong> No</li>
                      <li><strong>IP Relaxation:</strong> Relax IP restrictions</li>
                    </ul>
                  </div>

                  <button
                    onClick={() => setStep('config')}
                    className="btn-primary w-full py-3"
                  >
                    Continue to Configuration
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step: Enter Configuration */}
          {step === 'config' && (
            <div className="p-8 animate-fade-in">
              <h2 className="text-lg font-semibold text-sf-navy-900 mb-6">
                Enter Your Connected App Details
              </h2>

              {/* Callback URL Reminder */}
              <div className="bg-sf-blue-50 border border-sf-blue-200 rounded-xl p-4 mb-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-sf-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-sf-blue-800">
                      <strong>Callback URL must be:</strong>{' '}
                      <code className="bg-sf-blue-100 px-1 rounded">{callbackUrl}</code>
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="label">Consumer Key (Client ID)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="3MVG9..."
                    value={oauthConfig.consumerKey}
                    onChange={(e) => setOAuthConfig({ consumerKey: e.target.value })}
                  />
                  <p className="text-xs text-sf-navy-400 mt-1.5">
                    Find this in Setup → App Manager → Your App → View → Consumer Key
                  </p>
                </div>

                <div>
                  <label className="label">Login URL</label>
                  <select
                    className="input"
                    value={oauthConfig.loginUrl}
                    onChange={(e) => setOAuthConfig({ loginUrl: e.target.value })}
                  >
                    <option value="https://login.salesforce.com">
                      Production (login.salesforce.com)
                    </option>
                    <option value="https://test.salesforce.com">
                      Sandbox (test.salesforce.com)
                    </option>
                  </select>
                </div>

                <button
                  onClick={handleStartOAuth}
                  disabled={isLoading || !oauthConfig.consumerKey}
                  className="btn-primary w-full py-3"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      Connect to Salesforce
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step: OAuth - Paste Callback URL */}
          {step === 'oauth' && (
            <div className="p-8 animate-fade-in">
              <h2 className="text-lg font-semibold text-sf-navy-900 mb-2">
                Complete Authentication
              </h2>
              <p className="text-sf-navy-500 mb-6">
                A new tab should have opened for Salesforce login. After you log in and authorize the app,
                copy the URL from your browser and paste it below.
              </p>

              {/* Instructions */}
              <div className="bg-sf-blue-50 border border-sf-blue-200 rounded-xl p-4 mb-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-sf-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-sf-blue-800">
                    <p className="font-medium mb-2">Steps to complete:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Log in to Salesforce in the new tab</li>
                      <li>Click &quot;Allow&quot; to authorize the app</li>
                      <li>You&apos;ll be redirected to a URL starting with <code className="bg-sf-blue-100 px-1 rounded">{callbackUrl}</code></li>
                      <li>Copy the <strong>entire URL</strong> from your browser&apos;s address bar</li>
                      <li>Paste it below and click &quot;Complete Authentication&quot;</li>
                    </ol>
                  </div>
                </div>
              </div>

              {/* Re-open login link */}
              {authUrl && (
                <div className="mb-6">
                  <button
                    onClick={() => window.open(authUrl, '_blank')}
                    className="text-sm text-sf-blue-600 hover:text-sf-blue-700 flex items-center gap-1"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open Salesforce login again
                  </button>
                </div>
              )}

              {/* Callback URL Input */}
              <div className="space-y-4">
                <div>
                  <label className="label">Paste the Callback URL here</label>
                  <textarea
                    className="input min-h-[100px] font-mono text-sm"
                    placeholder={`${callbackUrl}?code=aPrx...`}
                    value={callbackUrlInput}
                    onChange={(e) => setCallbackUrlInput(e.target.value)}
                  />
                  <p className="text-xs text-sf-navy-400 mt-1.5">
                    The URL should contain a &quot;code&quot; parameter
                  </p>
                </div>

                <button
                  onClick={handleProcessCallback}
                  disabled={isLoading || !callbackUrlInput.trim()}
                  className="btn-primary w-full py-3"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Processing...
                    </>
                  ) : (
                    <>
                      Complete Authentication
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </button>

                <button
                  onClick={() => setStep('config')}
                  className="btn-ghost w-full py-2 text-sm"
                >
                  ← Start Over
                </button>
              </div>
            </div>
          )}

          {/* Step: Exchange DC Token */}
          {step === 'dctoken' && (
            <div className="p-8 animate-fade-in">
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-lg font-semibold text-sf-navy-900 mb-2">
                  Salesforce Authentication Successful
                </h2>
                <p className="text-sf-navy-500">
                  Connected to {session.instanceUrl}
                </p>
              </div>

              <div className="bg-sf-navy-50 rounded-xl p-6 mb-6">
                <h3 className="font-medium text-sf-navy-900 mb-3 flex items-center gap-2">
                  <Cloud className="w-5 h-5 text-sf-blue-500" />
                  Exchange for Data Cloud Token
                </h3>
                <p className="text-sm text-sf-navy-600 mb-4">
                  To access Data Cloud APIs, you need to exchange your Salesforce
                  token for a Data Cloud-specific token.
                </p>
                <button
                  onClick={handleExchangeDCToken}
                  disabled={isLoading}
                  className="btn-primary w-full py-3"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Exchanging Token...
                    </>
                  ) : (
                    <>
                      Get Data Cloud Token
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step: Complete */}
          {step === 'complete' && (
            <div className="p-8 animate-fade-in">
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-lg font-semibold text-sf-navy-900 mb-2">
                  Fully Connected!
                </h2>
                <p className="text-sf-navy-500">
                  You&apos;re ready to use all Data Cloud features
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-sf-navy-50 rounded-xl p-4">
                  <Server className="w-5 h-5 text-sf-navy-400 mb-2" />
                  <p className="text-xs text-sf-navy-500">Salesforce Instance</p>
                  <p className="text-sm font-medium text-sf-navy-900 truncate">
                    {session.instanceUrl}
                  </p>
                </div>
                <div className="bg-sf-navy-50 rounded-xl p-4">
                  <Cloud className="w-5 h-5 text-sf-blue-500 mb-2" />
                  <p className="text-xs text-sf-navy-500">Data Cloud Instance</p>
                  <p className="text-sm font-medium text-sf-navy-900 truncate">
                    {session.dcInstanceUrl}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Link
                  href="/stream"
                  className="btn-primary py-3 text-center"
                >
                  Stream Data
                </Link>
                <Link
                  href="/retrieve"
                  className="btn-secondary py-3 text-center"
                >
                  Retrieve Data
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

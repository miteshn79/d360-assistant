'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import { authApi } from '@/lib/api'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'

function OAuthCallbackContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { setSession } = useAppStore()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code')
      const errorParam = searchParams.get('error')
      const errorDescription = searchParams.get('error_description')

      if (errorParam) {
        setStatus('error')
        setError(errorDescription || errorParam)
        return
      }

      if (!code) {
        setStatus('error')
        setError('No authorization code received')
        return
      }

      // Get session ID from localStorage
      const sessionId = localStorage.getItem('oauth_session_id')
      if (!sessionId) {
        setStatus('error')
        setError('No session found. Please start the OAuth flow again.')
        return
      }

      try {
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

        setStatus('success')

        // Redirect after a short delay
        setTimeout(() => {
          router.push('/connect')
        }, 1500)
      } catch (err: any) {
        setStatus('error')
        setError(err.message || 'Failed to complete authentication')
      }
    }

    handleCallback()
  }, [searchParams, setSession, router])

  return (
    <div className="min-h-screen bg-sf-navy-50 flex items-center justify-center p-8">
      <div className="card p-8 max-w-md w-full text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="w-12 h-12 text-sf-blue-500 animate-spin mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-sf-navy-900 mb-2">
              Completing Authentication
            </h1>
            <p className="text-sf-navy-500">
              Please wait while we verify your credentials...
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            </div>
            <h1 className="text-xl font-semibold text-sf-navy-900 mb-2">
              Authentication Successful!
            </h1>
            <p className="text-sf-navy-500">
              Redirecting you back to the application...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-xl font-semibold text-sf-navy-900 mb-2">
              Authentication Failed
            </h1>
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={() => router.push('/connect')}
              className="btn-primary"
            >
              Try Again
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-sf-navy-50 flex items-center justify-center p-8">
          <div className="card p-8 max-w-md w-full text-center">
            <Loader2 className="w-12 h-12 text-sf-blue-500 animate-spin mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-sf-navy-900 mb-2">
              Loading...
            </h1>
          </div>
        </div>
      }
    >
      <OAuthCallbackContent />
    </Suspense>
  )
}

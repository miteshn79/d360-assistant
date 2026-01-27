'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { MessageSquarePlus, Send, Loader2, X, ThumbsUp, ThumbsDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const pageLabels: Record<string, string> = {
  '/': 'Home',
  '/setup': 'Schema Designer',
  '/connect': 'Connect',
  '/stream': 'Stream Data',
  '/retrieve': 'Retrieve Data',
  '/query': 'Query',
  '/metadata': 'Metadata',
  '/bulk': 'Bulk Ingestion',
  '/configs': 'Configurations',
  '/website-builder': 'Website Builder',
}

export function FeedbackButton() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState<'positive' | 'negative' | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const pageName = pageLabels[pathname] || pathname

  const handleSubmit = async () => {
    if (!rating && !comment.trim()) {
      toast.error('Please provide a rating or comment')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: pathname,
          page_name: pageName,
          rating,
          comment: comment.trim(),
        }),
      })

      if (!res.ok) throw new Error('Failed to submit feedback')

      toast.success('Thanks for your feedback!')
      setOpen(false)
      setRating(null)
      setComment('')
    } catch {
      toast.error('Failed to submit feedback')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full shadow-lg',
          'bg-sf-blue-500 hover:bg-sf-blue-600 text-white',
          'flex items-center justify-center transition-all duration-200',
          'hover:scale-110 active:scale-95',
          open && 'hidden'
        )}
        title="Send feedback"
      >
        <MessageSquarePlus className="w-5 h-5" />
      </button>

      {/* Feedback Modal */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-80 bg-white rounded-2xl shadow-2xl border border-sf-navy-200 animate-slide-up">
          <div className="p-4 border-b border-sf-navy-100 flex items-center justify-between">
            <h3 className="font-semibold text-sf-navy-900 text-sm">Send Feedback</h3>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-lg hover:bg-sf-navy-100 text-sf-navy-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <div className="text-xs text-sf-navy-400">
              Page: <span className="text-sf-navy-600 font-medium">{pageName}</span>
            </div>

            {/* Rating */}
            <div>
              <label className="text-sm font-medium text-sf-navy-700 block mb-2">
                How is your experience?
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => setRating(rating === 'positive' ? null : 'positive')}
                  className={cn(
                    'flex-1 py-2.5 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 transition-all',
                    rating === 'positive'
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-sf-navy-200 text-sf-navy-500 hover:border-green-300 hover:bg-green-50'
                  )}
                >
                  <ThumbsUp className="w-4 h-4" />
                  Good
                </button>
                <button
                  onClick={() => setRating(rating === 'negative' ? null : 'negative')}
                  className={cn(
                    'flex-1 py-2.5 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 transition-all',
                    rating === 'negative'
                      ? 'border-red-500 bg-red-50 text-red-700'
                      : 'border-sf-navy-200 text-sf-navy-500 hover:border-red-300 hover:bg-red-50'
                  )}
                >
                  <ThumbsDown className="w-4 h-4" />
                  Needs Work
                </button>
              </div>
            </div>

            {/* Comment */}
            <div>
              <label className="text-sm font-medium text-sf-navy-700 block mb-2">
                Comments (optional)
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What went well? What could be improved?"
                rows={3}
                className="w-full px-3 py-2 text-sm border border-sf-navy-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sf-blue-500 focus:border-transparent resize-none"
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting || (!rating && !comment.trim())}
              className="w-full py-2.5 bg-sf-blue-500 hover:bg-sf-blue-600 disabled:bg-sf-navy-200 disabled:text-sf-navy-400 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Submit Feedback
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

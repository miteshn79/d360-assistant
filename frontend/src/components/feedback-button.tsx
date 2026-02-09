'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { MessageSquarePlus, Send, Loader2, X, ThumbsUp, ThumbsDown, Bug, Lightbulb, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const pageLabels: Record<string, string> = {
  '/': 'Home',
  '/setup': 'Schema Designer',
  '/connect': 'Connect',
  '/stream': 'Stream Data',
  '/retrieve': 'Retrieve Data',
  '/journey': 'Customer Journey',
  '/data-explorer': 'Data Explorer',
  '/query': 'Query',
  '/metadata': 'Metadata',
  '/bulk': 'Bulk Ingestion',
  '/configs': 'Configurations',
  '/website-builder': 'Website Builder',
}

type FeedbackType = 'bug' | 'enhancement' | 'general'

const feedbackTypes = [
  { id: 'bug' as FeedbackType, label: 'Bug Report', icon: Bug, color: 'red' },
  { id: 'enhancement' as FeedbackType, label: 'Enhancement', icon: Lightbulb, color: 'yellow' },
  { id: 'general' as FeedbackType, label: 'General', icon: MessageCircle, color: 'blue' },
]

export function FeedbackButton() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('general')
  const [rating, setRating] = useState<'positive' | 'negative' | null>(null)
  const [comment, setComment] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const pageName = pageLabels[pathname] || pathname

  const handleSubmit = async () => {
    if (!comment.trim()) {
      toast.error('Please describe your feedback')
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
          feedback_type: feedbackType,
          rating,
          comment: comment.trim(),
          email: email.trim() || undefined,
        }),
      })

      if (!res.ok) throw new Error('Failed to submit feedback')

      toast.success(
        feedbackType === 'bug'
          ? 'Bug reported! We\'ll look into it.'
          : feedbackType === 'enhancement'
          ? 'Enhancement request submitted!'
          : 'Thanks for your feedback!'
      )
      setOpen(false)
      setFeedbackType('general')
      setRating(null)
      setComment('')
      setEmail('')
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
        <div className="fixed bottom-6 right-6 z-50 w-96 bg-white rounded-2xl shadow-2xl border border-sf-navy-200 animate-slide-up">
          <div className="p-4 border-b border-sf-navy-100 flex items-center justify-between">
            <h3 className="font-semibold text-sf-navy-900">Send Feedback</h3>
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

            {/* Feedback Type */}
            <div>
              <label className="text-sm font-medium text-sf-navy-700 block mb-2">
                What type of feedback?
              </label>
              <div className="grid grid-cols-3 gap-2">
                {feedbackTypes.map((type) => {
                  const Icon = type.icon
                  const isSelected = feedbackType === type.id
                  return (
                    <button
                      key={type.id}
                      onClick={() => setFeedbackType(type.id)}
                      className={cn(
                        'py-2.5 px-2 rounded-lg border text-xs font-medium flex flex-col items-center gap-1.5 transition-all',
                        isSelected && type.color === 'red' && 'border-red-500 bg-red-50 text-red-700',
                        isSelected && type.color === 'yellow' && 'border-yellow-500 bg-yellow-50 text-yellow-700',
                        isSelected && type.color === 'blue' && 'border-sf-blue-500 bg-sf-blue-50 text-sf-blue-700',
                        !isSelected && 'border-sf-navy-200 text-sf-navy-500 hover:border-sf-navy-300'
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {type.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Rating (only for general feedback) */}
            {feedbackType === 'general' && (
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
            )}

            {/* Comment */}
            <div>
              <label className="text-sm font-medium text-sf-navy-700 block mb-2">
                {feedbackType === 'bug'
                  ? 'Describe the bug *'
                  : feedbackType === 'enhancement'
                  ? 'Describe your idea *'
                  : 'Your feedback *'}
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={
                  feedbackType === 'bug'
                    ? 'What happened? What did you expect to happen?'
                    : feedbackType === 'enhancement'
                    ? 'What would make this better? How would it help you?'
                    : 'What went well? What could be improved?'
                }
                rows={4}
                className="w-full px-3 py-2 text-sm border border-sf-navy-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sf-blue-500 focus:border-transparent resize-none"
              />
            </div>

            {/* Email (optional) */}
            <div>
              <label className="text-sm font-medium text-sf-navy-700 block mb-2">
                Email (optional - for follow-up)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@company.com"
                className="w-full px-3 py-2 text-sm border border-sf-navy-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sf-blue-500 focus:border-transparent"
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting || !comment.trim()}
              className={cn(
                'w-full py-2.5 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2',
                feedbackType === 'bug'
                  ? 'bg-red-500 hover:bg-red-600 disabled:bg-red-200'
                  : feedbackType === 'enhancement'
                  ? 'bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-200'
                  : 'bg-sf-blue-500 hover:bg-sf-blue-600 disabled:bg-sf-navy-200',
                'disabled:text-sf-navy-400'
              )}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  {feedbackType === 'bug'
                    ? 'Report Bug'
                    : feedbackType === 'enhancement'
                    ? 'Submit Request'
                    : 'Submit Feedback'}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

'use client'

import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { templatesApi, chatApi } from '@/lib/api'
import { useQuery, useMutation } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import {
  ArrowRight,
  Bot,
  ChevronRight,
  Copy,
  CreditCard,
  Download,
  FileText,
  Loader2,
  MessageSquare,
  Plane,
  Send,
  Shield,
  ShoppingBag,
  Sparkles,
  User,
  Globe,
  Check,
} from 'lucide-react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { downloadFile, copyToClipboard } from '@/lib/utils'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

const templateIcons: Record<string, React.ReactNode> = {
  credit_card: <CreditCard className="w-5 h-5" />,
  consent: <Shield className="w-5 h-5" />,
  flight: <Plane className="w-5 h-5" />,
  web_browsing: <Globe className="w-5 h-5" />,
  purchase: <ShoppingBag className="w-5 h-5" />,
}

export function SetupView() {
  const { session } = useAppStore()
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: `Hi! I'm your **Data Cloud Streaming Setup Assistant**. I'll help you configure your first Streaming Ingestion API source step-by-step.

**Choose a template** from the sidebar for quick setup, or let's build a custom schema together.

To get started, tell me:
1. **What industry** is your customer in? (Airlines, Hotels, Banking, Telcos, Retail, etc.)
2. **What use case** do you want to demonstrate? (real-time personalization, fraud detection, loyalty, etc.)

This helps me propose the right schema for your demo!`,
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null)
  const [copiedYaml, setCopiedYaml] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { data: templatesData } = useQuery({
    queryKey: ['templates'],
    queryFn: templatesApi.getAll,
  })

  const chatMutation = useMutation({
    mutationFn: (message: string) =>
      chatApi.send({
        session_id: session.id || 'default',
        message,
        context: selectedTemplate ? { template: selectedTemplate.name } : undefined,
      }),
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
        },
      ])
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to get response')
    },
  })

  const handleSend = () => {
    if (!input.trim() || chatMutation.isPending) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    chatMutation.mutate(input)
    setInput('')
  }

  const handleSelectTemplate = async (templateId: string) => {
    try {
      const template = await templatesApi.getById(templateId)
      setSelectedTemplate(template)

      // Add a message about the selected template
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: `Great choice! I've loaded the **${template.name}** template.

This template includes ${template.fields.length} fields designed for ${template.description.toLowerCase()}.

**Key fields:**
${template.fields.slice(0, 5).map((f: any) => `- \`${f.name}\` (${f.data_type})${f.is_primary_key ? ' - Primary Key' : ''}${f.is_profile_id ? ' - Profile ID' : ''}`).join('\n')}

You can download the YAML configuration or customize it further. What would you like to do?`,
          timestamp: new Date(),
        },
      ])
    } catch (error) {
      toast.error('Failed to load template')
    }
  }

  const handleCopyYaml = async () => {
    if (selectedTemplate?.yaml) {
      await copyToClipboard(selectedTemplate.yaml)
      setCopiedYaml(true)
      setTimeout(() => setCopiedYaml(false), 2000)
      toast.success('YAML copied to clipboard!')
    }
  }

  const handleDownloadYaml = () => {
    if (selectedTemplate?.yaml) {
      downloadFile(
        selectedTemplate.yaml,
        `${selectedTemplate.id || 'schema'}.yaml`,
        'application/yaml'
      )
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex h-screen">
      {/* Templates Sidebar */}
      <div className="w-80 bg-white border-r border-sf-navy-200 flex flex-col">
        <div className="p-6 border-b border-sf-navy-200">
          <h2 className="font-semibold text-sf-navy-900 mb-1">Templates</h2>
          <p className="text-sm text-sf-navy-500">
            Pre-built schemas for common use cases
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {templatesData?.templates.map((template: any) => (
            <button
              key={template.id}
              onClick={() => handleSelectTemplate(template.id)}
              className={cn(
                'w-full text-left p-4 rounded-xl border transition-all duration-200',
                selectedTemplate?.id === template.id
                  ? 'border-sf-blue-500 bg-sf-blue-50'
                  : 'border-sf-navy-200 hover:border-sf-blue-300 hover:bg-sf-navy-50'
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'w-10 h-10 rounded-lg flex items-center justify-center',
                    selectedTemplate?.id === template.id
                      ? 'bg-sf-blue-500 text-white'
                      : 'bg-sf-navy-100 text-sf-navy-600'
                  )}
                >
                  {templateIcons[template.id] || <FileText className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sf-navy-900 text-sm">
                    {template.name}
                  </h3>
                  <p className="text-xs text-sf-navy-500 mt-0.5 line-clamp-2">
                    {template.description}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="badge-gray text-xs">
                      {template.fields_count} fields
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Selected Template Actions */}
        {selectedTemplate && (
          <div className="p-4 border-t border-sf-navy-200 bg-sf-navy-50">
            <h3 className="font-medium text-sf-navy-900 text-sm mb-3">
              {selectedTemplate.name}
            </h3>
            <div className="space-y-2">
              <button
                onClick={handleCopyYaml}
                className="btn-secondary w-full text-sm py-2"
              >
                {copiedYaml ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy YAML
                  </>
                )}
              </button>
              <button
                onClick={handleDownloadYaml}
                className="btn-primary w-full text-sm py-2"
              >
                <Download className="w-4 h-4 mr-2" />
                Download YAML
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-sf-navy-50">
        {/* Chat Header */}
        <div className="bg-white border-b border-sf-navy-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-sf-blue-500 to-sf-blue-600 rounded-xl flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-sf-navy-900">Streaming Setup Assistant</h1>
              <p className="text-sm text-sf-navy-500">
                Configure your first Data Cloud Streaming Ingestion API
              </p>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((message) => (
            <div key={message.id}>
            <div
              className={cn(
                'flex gap-4 animate-slide-up',
                message.role === 'user' ? 'flex-row-reverse' : ''
              )}
            >
              <div
                className={cn(
                  'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
                  message.role === 'user'
                    ? 'bg-sf-blue-500'
                    : 'bg-gradient-to-br from-purple-500 to-pink-500'
                )}
              >
                {message.role === 'user' ? (
                  <User className="w-5 h-5 text-white" />
                ) : (
                  <Bot className="w-5 h-5 text-white" />
                )}
              </div>

              <div
                className={cn(
                  'max-w-[70%] rounded-2xl px-5 py-4',
                  message.role === 'user'
                    ? 'bg-sf-blue-500 text-white rounded-tr-md'
                    : 'bg-white shadow-sm border border-sf-navy-200 rounded-tl-md'
                )}
              >
                <div
                  className={cn(
                    'prose prose-sm max-w-none',
                    message.role === 'user'
                      ? 'prose-invert'
                      : 'prose-sf-navy'
                  )}
                >
                  <ReactMarkdown
                    components={{
                      code: ({ className, children, ...props }) => {
                        const isInline = !className
                        const codeText = String(children).replace(/\n$/, '')
                        return isInline ? (
                          <code
                            className={cn(
                              'px-1.5 py-0.5 rounded text-sm',
                              message.role === 'user'
                                ? 'bg-white/20'
                                : 'bg-sf-navy-100 text-sf-navy-800'
                            )}
                            {...props}
                          >
                            {children}
                          </code>
                        ) : (
                          <div className="relative group">
                            <button
                              onClick={() => {
                                copyToClipboard(codeText)
                                toast.success('Copied to clipboard!')
                              }}
                              className="absolute top-2 right-2 p-1.5 rounded-md bg-sf-navy-700 hover:bg-sf-navy-600 text-sf-navy-300 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Copy to clipboard"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            <pre className="bg-sf-navy-900 text-sf-navy-100 rounded-lg p-4 overflow-x-auto">
                              <code {...props}>{children}</code>
                            </pre>
                          </div>
                        )
                      },
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
              </div>
            </div>

            {/* Hardcoded setup instructions + Connect link after YAML schema response */}
            {message.role === 'assistant' && message.content.includes('openapi: 3.0.3') && (
              <div className="flex gap-4 animate-slide-up mt-4">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sf-blue-500 to-sf-blue-600 flex items-center justify-center flex-shrink-0">
                  <ArrowRight className="w-5 h-5 text-white" />
                </div>
                <div className="max-w-[70%] rounded-2xl px-5 py-4 bg-gradient-to-br from-sf-blue-50 to-white border border-sf-blue-200 rounded-tl-md">
                  <h3 className="font-semibold text-sf-navy-900 mb-3">Setting up the Ingestion API in Data Cloud</h3>
                  <ol className="list-decimal list-inside text-sm text-sf-navy-700 space-y-2 mb-4">
                    <li>Go to <strong>Data Cloud Setup &rarr; Ingestion API</strong> and click <strong>New</strong></li>
                    <li>Give the connector a name</li>
                    <li>Upload the YAML schema you downloaded and click <strong>Save</strong></li>
                    <li>Go to <strong>Data Streams</strong> within Data Cloud and create a new data stream. Choose <strong>Ingestion API</strong> as the source and click <strong>Next</strong></li>
                    <li>Select the object name and click <strong>Next</strong></li>
                    <li>On the next screen, configure the details of your object. Select a <strong>Primary Key</strong> and an <strong>Event Time Field</strong>, then click <strong>Next</strong>. Click <strong>Deploy</strong></li>
                  </ol>
                  <p className="text-sm text-sf-navy-600 mb-4">
                    Your Data Lake Object is now available. You can map it to a Data Model Object and you&apos;re ready to start streaming data into it.
                  </p>
                  <Link
                    href="/connect"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-sf-blue-500 hover:bg-sf-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Connect to Salesforce
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            )}
            </div>
          ))}

          {chatMutation.isPending && (
            <div className="flex gap-4 animate-slide-up">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div className="bg-white shadow-sm border border-sf-navy-200 rounded-2xl rounded-tl-md px-5 py-4">
                <div className="typing-indicator">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="bg-white border-t border-sf-navy-200 p-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex gap-3">
              <input
                type="text"
                className="input flex-1"
                placeholder="Describe your use case or ask a question..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                disabled={chatMutation.isPending}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || chatMutation.isPending}
                className="btn-primary px-6"
              >
                {chatMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
            <p className="text-xs text-sf-navy-400 mt-2 text-center">
              Powered by AI. Responses may not always be accurate.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

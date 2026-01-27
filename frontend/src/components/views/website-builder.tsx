'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Globe,
  Send,
  Bot,
  User,
  Loader2,
  Sparkles,
  Building2,
  Plane,
  ShoppingCart,
  Landmark,
  Heart,
  Radio,
  ChevronRight,
  ExternalLink,
  Upload,
  Image as ImageIcon,
  Link as LinkIcon,
  X,
  Download,
  Rocket,
  CheckCircle,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { websiteBuilderApi, WebsiteProject } from '@/lib/api'
import toast from 'react-hot-toast'

interface Message {
  id: string
  role: 'assistant' | 'user'
  content: string
  timestamp: Date
  options?: QuickOption[]
  isTyping?: boolean
}

interface QuickOption {
  label: string
  value: string
  icon?: React.ReactNode
  description?: string
}

interface WebsiteProjectState {
  customerName?: string
  country?: string
  industry?: string
  useCase?: string
  brandingAssets?: BrandingAsset[]
  llmProvider?: string
  llmApiKey?: string
  herokuApiKey?: string
  useDefaultHeroku?: boolean
}

interface BrandingAsset {
  type: 'logo' | 'image' | 'url'
  name: string
  value: string
}

const industryOptions: QuickOption[] = [
  { label: 'Airline', value: 'airline', icon: <Plane className="w-4 h-4" />, description: 'Flight booking, loyalty programs' },
  { label: 'Retail', value: 'retail', icon: <ShoppingCart className="w-4 h-4" />, description: 'E-commerce, product catalog' },
  { label: 'Banking', value: 'banking', icon: <Landmark className="w-4 h-4" />, description: 'Financial services, accounts' },
  { label: 'Healthcare', value: 'healthcare', icon: <Heart className="w-4 h-4" />, description: 'Patient portal, appointments' },
  { label: 'Telecommunications', value: 'telecom', icon: <Radio className="w-4 h-4" />, description: 'Plans, devices, support' },
]

const llmOptions: QuickOption[] = [
  { label: 'Claude (Opus 4.5)', value: 'claude', description: 'Recommended - Uses your host\'s API key' },
  { label: 'OpenAI (GPT-4)', value: 'openai', description: 'Requires your API key' },
  { label: 'Other', value: 'other', description: 'Specify your preferred LLM' },
]

export function WebsiteBuilderView() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [project, setProject] = useState<WebsiteProjectState>({})
  const [conversationStep, setConversationStep] = useState<string>('welcome')
  const [brandingAssets, setBrandingAssets] = useState<BrandingAsset[]>([])
  const [showAssetInput, setShowAssetInput] = useState(false)
  const [assetUrl, setAssetUrl] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedWebsite, setGeneratedWebsite] = useState<any>(null)
  const [deploymentStatus, setDeploymentStatus] = useState<'idle' | 'deploying' | 'success' | 'error'>('idle')
  const [deployedUrl, setDeployedUrl] = useState<string>('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Initialize conversation
  useEffect(() => {
    if (messages.length === 0) {
      startConversation()
    }
  }, [])

  const startConversation = () => {
    const welcomeMessage: Message = {
      id: '1',
      role: 'assistant',
      content: `Hi! I'm your Website Builder Agent powered by Claude. I'll help you create a demo website that integrates with Salesforce Data Cloud, Agentforce, and Personalization.

**What company are you building this demo for?** Just give me the name and I'll identify their industry and suggest the best approach.`,
      timestamp: new Date(),
    }
    setMessages([welcomeMessage])
    setConversationStep('gathering_info')
  }

  const addAssistantMessage = (content: string, options?: QuickOption[]) => {
    const message: Message = {
      id: Date.now().toString(),
      role: 'assistant',
      content,
      timestamp: new Date(),
      options,
    }
    setMessages(prev => [...prev, message])
  }

  const handleSendMessage = async () => {
    if (!input.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMessage])
    const userInput = input.trim()
    setInput('')

    // Use Claude API for conversation
    await processWithClaude(userInput)
  }

  const handleQuickOption = async (option: QuickOption) => {
    // Handle special actions
    if (option.value === 'start_build') {
      startGeneration()
      return
    }
    if (option.value === 'download_files') {
      downloadWebsite()
      return
    }
    if (option.value === 'deploy_heroku') {
      deployToHeroku()
      return
    }
    if (option.value === 'open_website' && deployedUrl) {
      window.open(deployedUrl, '_blank')
      return
    }
    if (option.value === 'new_project') {
      setProject({})
      setBrandingAssets([])
      setGeneratedWebsite(null)
      setDeployedUrl('')
      startConversation()
      return
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: option.label,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMessage])

    await processWithClaude(option.label)
  }

  const processWithClaude = async (userInput: string) => {
    setIsLoading(true)

    try {
      // Build conversation history for Claude
      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content
      }))

      // Add the new user message
      conversationHistory.push({
        role: 'user',
        content: userInput
      })

      const response = await websiteBuilderApi.chat({
        messages: conversationHistory,
        project_context: project
      })

      // Update project with any new information from Claude
      if (response.project_updates) {
        const updates = response.project_updates
        setProject(prev => ({
          ...prev,
          customerName: updates.customer_name || prev.customerName,
          country: updates.country || prev.country,
          industry: updates.industry || prev.industry,
          useCase: updates.use_case || prev.useCase,
        }))

        // Check if ready to build
        if (updates.ready_to_build) {
          setConversationStep('ready_to_build')
          // Add the response with build options
          addAssistantMessage(response.response, [
            { label: 'Start Building', value: 'start_build', icon: <Sparkles className="w-4 h-4" />, description: 'Generate and deploy the website' },
            { label: 'Let me add more details', value: 'more_details', description: 'Continue the conversation' },
          ])
        } else {
          addAssistantMessage(response.response)
        }
      } else {
        addAssistantMessage(response.response)
      }

    } catch (error: any) {
      console.error('Chat error:', error)
      addAssistantMessage(
        `I encountered an issue connecting to my AI backend. Let me fall back to guided mode.

**What industry is your customer in?**`,
        industryOptions
      )
      setConversationStep('fallback_industry')
    } finally {
      setIsLoading(false)
    }
  }

  // Fallback flow for when API is unavailable
  const processFallback = async (input: string, option?: QuickOption) => {
    setIsLoading(true)
    await new Promise(resolve => setTimeout(resolve, 500))

    switch (conversationStep) {
      case 'fallback_industry':
        const industryValue = option?.value || input.toLowerCase()
        setProject(prev => ({ ...prev, industry: industryValue }))
        addAssistantMessage(
          `Got it! Now tell me about the **specific use case** you want to demonstrate.

For example: "Capture web interactions from search to purchase, track cart abandonment, personalize based on browsing history."`
        )
        setConversationStep('fallback_usecase')
        break

      case 'fallback_usecase':
        setProject(prev => ({ ...prev, useCase: input }))
        showProjectSummary()
        break

      case 'ready_to_build':
        if (input === 'start_build') {
          startGeneration()
        }
        break

      case 'post_generation':
        if (input === 'download_files') {
          downloadWebsite()
        } else if (input === 'deploy_heroku') {
          deployToHeroku()
        }
        break
    }

    setIsLoading(false)
  }

  const startGeneration = async () => {
    setIsGenerating(true)
    addAssistantMessage(
      `Excellent! Starting website generation now. This will take a few moments...

🔧 **Phase 1:** Designing page structure and layout
⏳ **Phase 2:** Generating HTML, CSS, and JavaScript
⏳ **Phase 3:** Adding Data Cloud tracking hooks
⏳ **Phase 4:** Creating backend API
⏳ **Phase 5:** Preparing for deployment`
    )

    try {
      const projectData: WebsiteProject = {
        customer_name: project.customerName || '',
        country: project.country || '',
        industry: project.industry || '',
        use_case: project.useCase || '',
        branding_assets: brandingAssets.map(a => ({ type: a.type, name: a.name, value: a.value })),
        llm_provider: project.llmProvider,
        llm_api_key: project.llmApiKey,
        heroku_api_key: project.herokuApiKey,
        use_default_heroku: project.useDefaultHeroku,
      }

      const result = await websiteBuilderApi.generate(projectData)

      if (result.success && result.website) {
        setGeneratedWebsite(result.website)
        addAssistantMessage(
          `✅ **Website generated successfully!**

I've created ${result.website.files?.length || 0} files for your ${project.customerName} demo website.

**Generated files include:**
${result.website.files?.slice(0, 8).map((f: any) => `- \`${f.path}\``).join('\n') || 'See download for full list'}
${(result.website.files?.length || 0) > 8 ? `\n...and ${(result.website.files?.length || 0) - 8} more files` : ''}

**What would you like to do next?**`,
          [
            { label: 'Deploy to Heroku', value: 'deploy_heroku', icon: <Rocket className="w-4 h-4" />, description: 'Launch the website live' },
            { label: 'Download Files', value: 'download_files', icon: <Download className="w-4 h-4" />, description: 'Get the source code' },
          ]
        )
        setConversationStep('post_generation')
      } else {
        addAssistantMessage(
          `❌ **Generation encountered an issue:**

${result.error || 'Unknown error occurred'}

Would you like to try again?`,
          [
            { label: 'Try Again', value: 'start_build', icon: <Sparkles className="w-4 h-4" />, description: 'Retry generation' },
            { label: 'Edit Details', value: 'edit_details', description: 'Change project settings' },
          ]
        )
        setConversationStep('ready_to_build')
      }
    } catch (error: any) {
      addAssistantMessage(
        `❌ **Generation failed:**

${error.message || 'An unexpected error occurred'}

This might be a temporary issue. Would you like to try again?`,
        [
          { label: 'Try Again', value: 'start_build', icon: <Sparkles className="w-4 h-4" />, description: 'Retry generation' },
          { label: 'Edit Details', value: 'edit_details', description: 'Change project settings' },
        ]
      )
      setConversationStep('ready_to_build')
    } finally {
      setIsGenerating(false)
    }
  }

  const downloadWebsite = () => {
    if (!generatedWebsite?.files) {
      toast.error('No website files to download')
      return
    }

    // Create a simple text representation of all files
    let content = `# ${project.customerName} Demo Website\n\n`
    content += `Generated: ${new Date().toISOString()}\n`
    content += `Industry: ${project.industry}\n`
    content += `Country: ${project.country}\n\n`
    content += `---\n\n`

    for (const file of generatedWebsite.files) {
      content += `## ${file.path}\n\n`
      content += '```\n'
      content += file.content
      content += '\n```\n\n'
    }

    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.customerName?.toLowerCase().replace(/\s+/g, '-') || 'website'}-demo.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast.success('Website files downloaded!')
  }

  const deployToHeroku = async () => {
    if (!generatedWebsite) {
      toast.error('No website to deploy')
      return
    }

    setDeploymentStatus('deploying')
    addAssistantMessage(
      `🚀 **Starting Heroku deployment...**

Creating app and uploading files. This may take a minute.`
    )

    try {
      const appName = `${project.customerName?.toLowerCase().replace(/\s+/g, '-') || 'demo'}-${Date.now().toString(36)}`

      const result = await websiteBuilderApi.deploy({
        website_data: generatedWebsite,
        app_name: appName,
        heroku_api_key: project.herokuApiKey,
      })

      if (result.success) {
        setDeploymentStatus('success')
        setDeployedUrl(result.app_url)
        addAssistantMessage(
          `✅ **Deployment successful!**

Your website is now live at:
🔗 **${result.app_url}**

**Next steps to complete the demo:**
1. Add your Data Cloud beacon ID
2. Configure Agentforce agent credentials
3. Set up Personalization zones

**Manual deployment (if needed):**
${result.instructions?.map((i: string, idx: number) => `${idx + 1}. ${i}`).join('\n') || 'See downloaded files'}

Congratulations! 🎉`,
          [
            { label: 'Open Website', value: 'open_website', icon: <ExternalLink className="w-4 h-4" />, description: 'View your live site' },
            { label: 'Start New Project', value: 'new_project', description: 'Build another website' },
          ]
        )
        setConversationStep('deployed')
      } else {
        setDeploymentStatus('error')
        addAssistantMessage(
          `⚠️ **Deployment needs manual steps**

${result.message}

You can download the files and deploy manually using the Heroku CLI.`,
          [
            { label: 'Download Files', value: 'download_files', icon: <Download className="w-4 h-4" />, description: 'Get source code' },
            { label: 'Try Again', value: 'deploy_heroku', description: 'Retry deployment' },
          ]
        )
      }
    } catch (error: any) {
      setDeploymentStatus('error')
      addAssistantMessage(
        `❌ **Deployment failed:**

${error.message || 'An unexpected error occurred'}

You can download the files and deploy manually.`,
        [
          { label: 'Download Files', value: 'download_files', icon: <Download className="w-4 h-4" />, description: 'Get source code' },
          { label: 'Try Again', value: 'deploy_heroku', description: 'Retry deployment' },
        ]
      )
    }
  }

  const showProjectSummary = () => {
    const summary = `
Excellent! I have everything I need. Here's a summary of your project:

---

**Customer:** ${project.customerName}
**Country:** ${project.country}
**Industry:** ${project.industry?.charAt(0).toUpperCase()}${project.industry?.slice(1)}
**Use Case:** ${project.useCase}
**Branding:** ${brandingAssets.length > 0 ? `${brandingAssets.length} custom asset(s)` : 'Stock photos (replaceable)'}
**AI Model:** ${project.llmProvider === 'claude' ? 'Claude Opus 4.5' : project.llmProvider}
**Deployment:** ${project.useDefaultHeroku ? 'Shared demo environment' : 'Your Heroku account'}

---

**Ready to build?** I'll generate:
1. A responsive ${project.industry} website with your branding
2. User registration & login flows
3. Product/service catalog with search
4. Booking/purchase flow with cart
5. Data Cloud event tracking (ready for beacon integration)
6. Personalization zones (ready for Salesforce Personalization)
7. Agentforce chat widget placeholder

The website will be deployed to Heroku and you'll get a live URL to share.`

    addAssistantMessage(summary, [
      { label: 'Start Building', value: 'start_build', icon: <Sparkles className="w-4 h-4" />, description: 'Generate and deploy the website' },
      { label: 'Edit Details', value: 'edit_details', description: 'Go back and change something' },
    ])
    setConversationStep('ready_to_build')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const removeAsset = (index: number) => {
    setBrandingAssets(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="h-[calc(100vh-2rem)] flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
            <Globe className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-sf-navy-900">Website Builder Agent</h1>
            <p className="text-sf-navy-500">Create demo websites with Data Cloud & Agentforce integration</p>
          </div>
        </div>
      </div>

      {/* Chat Container */}
      <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-sf-navy-100 overflow-hidden">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'flex gap-3',
                message.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              {message.role === 'assistant' && (
                <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[70%] rounded-2xl px-4 py-3',
                  message.role === 'user'
                    ? 'bg-sf-blue-500 text-white'
                    : 'bg-sf-navy-50 text-sf-navy-900'
                )}
              >
                <div className="prose prose-sm max-w-none">
                  {message.content.split('\n').map((line, i) => (
                    <p key={i} className={cn(
                      'mb-2 last:mb-0',
                      message.role === 'user' ? 'text-white' : 'text-sf-navy-900'
                    )}>
                      {line.split(/(\*\*[^*]+\*\*)/).map((part, j) => {
                        if (part.startsWith('**') && part.endsWith('**')) {
                          return <strong key={j}>{part.slice(2, -2)}</strong>
                        }
                        return part
                      })}
                    </p>
                  ))}
                </div>

                {/* Quick Options */}
                {message.options && message.options.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {message.options.map((option, index) => (
                      <button
                        key={index}
                        onClick={() => handleQuickOption(option)}
                        className="w-full flex items-center gap-3 p-3 bg-white rounded-xl border border-sf-navy-200 hover:border-sf-blue-500 hover:bg-sf-blue-50 transition-all group text-left"
                      >
                        {option.icon && (
                          <div className="w-8 h-8 bg-sf-navy-100 group-hover:bg-sf-blue-100 rounded-lg flex items-center justify-center text-sf-navy-600 group-hover:text-sf-blue-600 transition-colors">
                            {option.icon}
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="font-medium text-sf-navy-900 group-hover:text-sf-blue-600 transition-colors">
                            {option.label}
                          </p>
                          {option.description && (
                            <p className="text-xs text-sf-navy-500">{option.description}</p>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-sf-navy-400 group-hover:text-sf-blue-500 transition-colors" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {message.role === 'user' && (
                <div className="flex-shrink-0 w-8 h-8 bg-sf-navy-200 rounded-lg flex items-center justify-center">
                  <User className="w-4 h-4 text-sf-navy-600" />
                </div>
              )}
            </div>
          ))}

          {/* Typing Indicator */}
          {isLoading && (
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="bg-sf-navy-50 rounded-2xl px-4 py-3">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-sf-navy-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-sf-navy-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-sf-navy-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Branding Assets Display */}
        {showAssetInput && brandingAssets.length > 0 && (
          <div className="px-6 py-3 bg-sf-navy-50 border-t border-sf-navy-100">
            <p className="text-xs font-medium text-sf-navy-600 mb-2">Added Assets:</p>
            <div className="flex flex-wrap gap-2">
              {brandingAssets.map((asset, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-sf-navy-200 text-sm"
                >
                  <LinkIcon className="w-3 h-3 text-sf-navy-400" />
                  <span className="text-sf-navy-700 max-w-[200px] truncate">{asset.value}</span>
                  <button
                    onClick={() => removeAsset(index)}
                    className="text-sf-navy-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="flex-shrink-0 p-4 border-t border-sf-navy-100 bg-sf-navy-50">
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  conversationStep === 'branding' && showAssetInput
                    ? 'Paste a URL to a logo, image, or brand guideline...'
                    : 'Type your response...'
                }
                className="w-full px-4 py-3 pr-12 bg-white border border-sf-navy-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-sf-blue-500 focus:border-transparent text-sf-navy-900 placeholder-sf-navy-400"
                rows={1}
                style={{ minHeight: '48px', maxHeight: '120px' }}
              />
            </div>
            <button
              onClick={handleSendMessage}
              disabled={isLoading || (!input.trim() && conversationStep !== 'branding')}
              className={cn(
                'flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-all',
                isLoading || (!input.trim() && conversationStep !== 'branding')
                  ? 'bg-sf-navy-200 text-sf-navy-400 cursor-not-allowed'
                  : 'bg-sf-blue-500 text-white hover:bg-sf-blue-600'
              )}
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Project Progress Sidebar (shows when project has data) */}
      {project.customerName && (
        <div className="fixed right-6 top-24 w-64 bg-white rounded-xl shadow-lg border border-sf-navy-100 p-4">
          <h3 className="font-semibold text-sf-navy-900 mb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Project Details
          </h3>
          <div className="space-y-2 text-sm">
            {project.customerName && (
              <div className="flex justify-between">
                <span className="text-sf-navy-500">Customer</span>
                <span className="text-sf-navy-900 font-medium">{project.customerName}</span>
              </div>
            )}
            {project.country && (
              <div className="flex justify-between">
                <span className="text-sf-navy-500">Country</span>
                <span className="text-sf-navy-900 font-medium">{project.country}</span>
              </div>
            )}
            {project.industry && (
              <div className="flex justify-between">
                <span className="text-sf-navy-500">Industry</span>
                <span className="text-sf-navy-900 font-medium capitalize">{project.industry}</span>
              </div>
            )}
            {project.llmProvider && (
              <div className="flex justify-between">
                <span className="text-sf-navy-500">AI Model</span>
                <span className="text-sf-navy-900 font-medium capitalize">{project.llmProvider}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

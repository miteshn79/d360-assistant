'use client'

import Link from 'next/link'
import {
  ArrowRight,
  Cloud,
  FileCode,
  Sparkles,
  Workflow,
  Shield,
} from 'lucide-react'

export function LandingView() {
  return (
    <div className="min-h-screen">
      {/* Incognito Mode Notice */}
      <div className="bg-amber-50 border-b border-amber-200">
        <div className="max-w-5xl mx-auto px-8 py-3">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              <strong>Recommended:</strong> Use this app in <strong>Incognito/Private mode</strong> to avoid conflicts with org62 or any other Salesforce orgs you may be logged into.
            </p>
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <div className="bg-gradient-to-br from-sf-navy-900 via-sf-navy-800 to-sf-blue-900 text-white">
        <div className="max-w-5xl mx-auto px-8 py-20">
          <div className="flex items-center gap-2 text-sf-blue-300 mb-6">
            <Sparkles className="w-5 h-5" />
            <span className="text-sm font-medium">Salesforce Data Cloud</span>
          </div>

          <h1 className="text-5xl font-bold mb-6 leading-tight">
            Data Cloud
            <br />
            <span className="text-sf-blue-400">Assistant</span>
          </h1>

          <p className="text-xl text-sf-navy-300 mb-6 max-w-2xl">
            The modern toolkit for Solution Engineers to demonstrate and test
            Data Cloud&apos;s real-time streaming capabilities.
          </p>
        </div>
      </div>

      {/* Two Main Options */}
      <div className="max-w-5xl mx-auto px-8 -mt-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Option 1: Generate Schema */}
          <div className="card-hover p-8 bg-white">
            <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mb-6">
              <FileCode className="w-7 h-7 text-white" />
            </div>

            <h2 className="text-2xl font-semibold text-sf-navy-900 mb-3">
              Generate a New Schema
            </h2>

            <p className="text-sf-navy-600 mb-6">
              Use AI-powered assistance to design your data schema. Choose from pre-built
              templates for common use cases or describe your own and get intelligent suggestions.
            </p>

            <ul className="text-sm text-sf-navy-500 space-y-2 mb-8">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
                Pre-built templates (Credit Card, Consent, Flight Status)
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
                AI-powered custom schema design
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
                Download YAML configurations
              </li>
            </ul>

            <Link
              href="/setup"
              className="btn-primary w-full py-3 text-base flex items-center justify-center"
            >
              <FileCode className="w-5 h-5 mr-2" />
              Start Schema Designer
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </div>

          {/* Option 2: Connect to Salesforce */}
          <div className="card-hover p-8 bg-white">
            <div className="w-14 h-14 bg-gradient-to-br from-sf-blue-500 to-sf-blue-600 rounded-2xl flex items-center justify-center mb-6">
              <Cloud className="w-7 h-7 text-white" />
            </div>

            <h2 className="text-2xl font-semibold text-sf-navy-900 mb-3">
              Connect & Use APIs
            </h2>

            <p className="text-sf-navy-600 mb-6">
              Already have Data Cloud configured? Connect to your Salesforce org and
              start using the APIs to stream data, query profiles, and more.
            </p>

            <ul className="text-sm text-sf-navy-500 space-y-2 mb-8">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-sf-blue-500 rounded-full" />
                OAuth authentication with PKCE
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-sf-blue-500 rounded-full" />
                Stream data to Ingestion API
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-sf-blue-500 rounded-full" />
                Retrieve profiles from Data Graphs
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-sf-blue-500 rounded-full" />
                Query, Bulk Upload, Metadata Explorer
              </li>
            </ul>

            <Link
              href="/connect"
              className="btn-primary w-full py-3 text-base flex items-center justify-center"
            >
              <Workflow className="w-5 h-5 mr-2" />
              Connect to Salesforce
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </div>
        </div>
      </div>

      {/* Info Section */}
      <div className="max-w-5xl mx-auto px-8 py-16">
        <div className="bg-sf-navy-50 rounded-2xl p-8">
          <h3 className="font-semibold text-sf-navy-900 mb-4">
            What is this app?
          </h3>
          <p className="text-sf-navy-600 mb-4">
            <strong>Data Cloud Assistant</strong> helps Salesforce Solution Engineers demonstrate
            and test Data Cloud&apos;s real-time streaming capabilities.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm text-sf-navy-600">
            <div>
              <p className="font-medium text-sf-navy-800 mb-2">Schema Designer</p>
              <p>
                Guides you through designing a streaming data schema (like credit card transactions,
                consent signals, or flight status updates) and generates YAML configuration files.
              </p>
            </div>
            <div>
              <p className="font-medium text-sf-navy-800 mb-2">API Tools</p>
              <p>
                Once Data Cloud is configured, generate realistic test data, send events to the
                Ingestion API, and retrieve unified profiles via the Data Graph API.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

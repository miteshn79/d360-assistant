import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'
import { Toaster } from 'react-hot-toast'
import { FeedbackButton } from '@/components/feedback-button'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'D360 Assistant',
  description: 'Modern interface for Salesforce Data Cloud operations',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          {children}
          <FeedbackButton />
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#1b2432',
                color: '#fff',
                borderRadius: '12px',
              },
            }}
          />
        </Providers>
      </body>
    </html>
  )
}

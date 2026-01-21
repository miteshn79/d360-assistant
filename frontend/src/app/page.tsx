'use client'

import { MainLayout } from '@/components/layout/main-layout'
import { LandingView } from '@/components/views/landing'

export default function Home() {
  return (
    <MainLayout>
      <LandingView />
    </MainLayout>
  )
}

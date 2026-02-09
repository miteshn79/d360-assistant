'use client'

import { MainLayout } from '@/components/layout/main-layout'
import { DataExplorerView } from '@/components/views/data-explorer'

export default function DataExplorerPage() {
  return (
    <MainLayout>
      <DataExplorerView />
    </MainLayout>
  )
}

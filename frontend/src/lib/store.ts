import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface Session {
  id: string | null
  authenticated: boolean
  hasDCToken: boolean
  instanceUrl: string | null
  dcInstanceUrl: string | null
  userInfo: any | null
}

interface DataGraphInfo {
  name: string
  label?: string
  lookupKeys: Array<{ name: string; dmoName: string }>
}

interface DataObjectInfo {
  name: string
  label?: string
}

interface DataCloudMetadata {
  dataGraphs: DataGraphInfo[]
  dmos: DataObjectInfo[]
  dlos: DataObjectInfo[]
  isLoading: boolean
  error: string | null
}

interface AppState {
  // Session
  session: Session
  setSession: (session: Partial<Session>) => void
  clearSession: () => void

  // OAuth config (persisted)
  oauthConfig: {
    loginUrl: string
    consumerKey: string
    redirectUri: string
  }
  setOAuthConfig: (config: Partial<AppState['oauthConfig']>) => void

  // Streaming config (persisted)
  streamConfig: {
    sourceName: string
    objectName: string
  }
  setStreamConfig: (config: Partial<AppState['streamConfig']>) => void

  // Retrieve config (persisted)
  retrieveConfig: {
    dataGraphName: string
  }
  setRetrieveConfig: (config: Partial<AppState['retrieveConfig']>) => void

  // Data Cloud metadata (loaded after DC token exchange)
  dcMetadata: DataCloudMetadata
  setDCMetadata: (metadata: Partial<DataCloudMetadata>) => void
  clearDCMetadata: () => void

  // Current view
  currentView: 'landing' | 'setup' | 'connect' | 'stream' | 'retrieve' | 'query' | 'bulk' | 'metadata'
  setCurrentView: (view: AppState['currentView']) => void
}

const defaultSession: Session = {
  id: null,
  authenticated: false,
  hasDCToken: false,
  instanceUrl: null,
  dcInstanceUrl: null,
  userInfo: null,
}

const defaultDCMetadata: DataCloudMetadata = {
  dataGraphs: [],
  dmos: [],
  dlos: [],
  isLoading: false,
  error: null,
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Session (not persisted)
      session: defaultSession,
      setSession: (session) =>
        set((state) => ({ session: { ...state.session, ...session } })),
      clearSession: () => set({ session: defaultSession }),

      // OAuth config
      oauthConfig: {
        loginUrl: 'https://login.salesforce.com',
        consumerKey: '',
        redirectUri: typeof window !== 'undefined'
          ? `${window.location.origin}/oauth/callback`
          : 'http://localhost:3000/oauth/callback',
      },
      setOAuthConfig: (config) =>
        set((state) => ({ oauthConfig: { ...state.oauthConfig, ...config } })),

      // Streaming config
      streamConfig: {
        sourceName: '',
        objectName: '',
      },
      setStreamConfig: (config) =>
        set((state) => ({ streamConfig: { ...state.streamConfig, ...config } })),

      // Retrieve config
      retrieveConfig: {
        dataGraphName: '',
      },
      setRetrieveConfig: (config) =>
        set((state) => ({ retrieveConfig: { ...state.retrieveConfig, ...config } })),

      // Data Cloud metadata
      dcMetadata: defaultDCMetadata,
      setDCMetadata: (metadata) =>
        set((state) => ({ dcMetadata: { ...state.dcMetadata, ...metadata } })),
      clearDCMetadata: () => set({ dcMetadata: defaultDCMetadata }),

      // Current view
      currentView: 'landing',
      setCurrentView: (view) => set({ currentView: view }),
    }),
    {
      name: 'data-cloud-assistant',
      version: 2, // Increment when schema changes
      partialize: (state) => ({
        oauthConfig: state.oauthConfig,
        streamConfig: state.streamConfig,
        retrieveConfig: state.retrieveConfig,
      }),
      // Migrate from old versions
      migrate: (persistedState: any, version: number) => {
        if (version === 0 || version === 1) {
          // Fix corrupted loginUrl from older versions
          if (persistedState?.oauthConfig) {
            if (!persistedState.oauthConfig.loginUrl ||
                !persistedState.oauthConfig.loginUrl.startsWith('https://')) {
              persistedState.oauthConfig.loginUrl = 'https://login.salesforce.com'
            }
          }
        }
        return persistedState
      },
      // Custom merge to prevent empty strings from overriding defaults
      merge: (persistedState: any, currentState: AppState) => {
        const merged = { ...currentState }

        if (persistedState) {
          // Merge oauthConfig, preserving defaults for empty values
          if (persistedState.oauthConfig) {
            merged.oauthConfig = {
              ...currentState.oauthConfig,
              // Only use persisted value if it's not empty
              loginUrl: persistedState.oauthConfig.loginUrl || currentState.oauthConfig.loginUrl,
              consumerKey: persistedState.oauthConfig.consumerKey || currentState.oauthConfig.consumerKey,
              redirectUri: persistedState.oauthConfig.redirectUri || currentState.oauthConfig.redirectUri,
            }
          }

          // Merge streamConfig
          if (persistedState.streamConfig) {
            merged.streamConfig = {
              ...currentState.streamConfig,
              ...persistedState.streamConfig,
            }
          }

          // Merge retrieveConfig
          if (persistedState.retrieveConfig) {
            merged.retrieveConfig = {
              ...currentState.retrieveConfig,
              ...persistedState.retrieveConfig,
            }
          }
        }

        return merged
      },
    }
  )
)

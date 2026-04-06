'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Sparkles,
  Settings,
  ImageIcon,
  Wand2,
  Loader2,
  Upload,
  X,
  Download,
  Copy,
  History,
  Trash2,
  Undo2,
  RotateCcw,
  RefreshCw,
  AlertCircle,
  Maximize2,
  Menu,
  CheckCircle2,
  GripVertical,
  CheckSquare,
  Square
} from 'lucide-react'
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'

import { cn } from '@/lib/utils'
import { idbGet, idbSet } from '@/lib/indexeddb'
import { useI18n, Locale } from '@/lib/i18n'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

interface ReferenceImage {
  id: string
  file: File
  preview: string
  base64?: string
  mimeType: string
}

interface ModelCapabilities {
  supportsGenerate: boolean
  supportsEdit: boolean
  supportsAspectRatio: boolean
  supportedAspectRatios?: string[]
  supportsImageSize: boolean
  forcedImageSize?: '512px' | '1K' | '2K' | '4K'
  supportedImageSizes?: Array<'512px' | '1K' | '2K' | '4K'>
  supportsSearchGrounding: boolean
  supportsImageSearchGrounding: boolean
  supportsThinkingConfig: boolean
  maxReferenceImages: number
}

interface ImageModelOption {
  id: string
  displayName: string
  capabilities: ModelCapabilities
}

interface ModelsCachePayload {
  imageModels: ImageModelOption[]
  promptModels: string[]
}

interface HistoryItem {
  id: string
  image: string
  text?: string
  prompt: string
  mode: 'generate' | 'edit'
  model: string
  createdAt: number
}

interface ApiErrorLike {
  code?: string
  error?: string
  message?: string
  details?: {
    error?: {
      message?: string
      code?: string | number
    }
  }
}

interface ModelsApiResponse extends ApiErrorLike {
  imageModels?: Array<Partial<ImageModelOption> & { id?: string }>
  promptModels?: unknown[]
}

type WorkspacePage = 'studio' | 'history' | 'trash'
type WorkMode = 'generate' | 'edit'

interface ImageGeneratorProps {
  initialPage?: WorkspacePage
}

const DEFAULT_IMAGE_CAPABILITIES: ModelCapabilities = {
  supportsGenerate: true,
  supportsEdit: true,
  supportsAspectRatio: false,
  supportedAspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  supportsImageSize: false,
  supportedImageSizes: ['1K', '2K', '4K'],
  supportsSearchGrounding: false,
  supportsImageSearchGrounding: false,
  supportsThinkingConfig: false,
  maxReferenceImages: 3,
}

const ASPECT_RATIOS = ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '1:4', '1:8', '4:1', '8:1']
const IMAGE_SIZES = ['512px', '1K', '2K', '4K'] as const
const IMAGE_SIZE_LABELS: Record<(typeof IMAGE_SIZES)[number], string> = {
  '512px': '0.5K',
  '1K': '1K',
  '2K': '2K',
  '4K': '4K',
}
const HISTORY_KEY = 'gemini_image_history_v1'
const TRASH_KEY = 'gemini_image_trash_v1'
const HISTORY_LIMIT_KEY = 'gemini_image_history_limit'
const AUTO_SAVE_HISTORY_KEY = 'gemini_auto_save_history'
const HISTORY_SORT_MODE_KEY = 'gemini_history_sort_mode_v1'
const HISTORY_CUSTOM_ORDER_KEY = 'gemini_history_custom_order_v1'
const GENERATE_COUNT_KEY = 'gemini_generate_count'
const GENERATE_MODEL_KEY = 'gemini_generate_model'
const EDIT_MODEL_KEY = 'gemini_edit_model'
const ASPECT_RATIO_KEY = 'gemini_aspect_ratio'
const GOOGLE_SEARCH_KEY = 'gemini_use_google_search'
const GOOGLE_IMAGE_SEARCH_KEY = 'gemini_use_google_image_search'
const THINKING_LEVEL_KEY = 'gemini_thinking_level'
const CURRENT_VERSION = '1.2.0'

export default function ImageGenerator({ initialPage = 'studio' }: ImageGeneratorProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { t, locale, setLocale } = useI18n()

  const [mounted, setMounted] = useState(false)
  const [prefsHydrated, setPrefsHydrated] = useState(false)
  const [mode, setMode] = useState<WorkMode>('generate')

  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState(t('messages.waiting'))
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [generatedText, setGeneratedText] = useState('')
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  const [aspectRatio, setAspectRatio] = useState('auto')
  const [imageSize, setImageSize] = useState('1K')
  const [useGoogleSearch, setUseGoogleSearch] = useState(false)
  const [useGoogleImageSearch, setUseGoogleImageSearch] = useState(false)
  const [thinkingLevel, setThinkingLevel] = useState<'minimal' | 'high'>('minimal')
  const [autoSaveToHistory, setAutoSaveToHistory] = useState(true)
  const [generateCount, setGenerateCount] = useState(1)

  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [editImages, setEditImages] = useState<ReferenceImage[]>([])
  const [isReferenceDragActive, setIsReferenceDragActive] = useState(false)
  const [isEditDragActive, setIsEditDragActive] = useState(false)
  const [batchResults, setBatchResults] = useState<string[]>([])

  const [apiKey, setApiKey] = useState('')
  const [apiUrl, setApiUrl] = useState('https://generativelanguage.googleapis.com')
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [modelsLoading, setModelsLoading] = useState(false)
  const [connectionTesting, setConnectionTesting] = useState(false)

  const [generateModel, setGenerateModel] = useState('')
  const [editModel, setEditModel] = useState('')
  const [optimizeModel, setOptimizeModel] = useState('')
  const [imageModels, setImageModels] = useState<ImageModelOption[]>([])
  const [promptModels, setPromptModels] = useState<string[]>([])

  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([])
  const [trashItems, setTrashItems] = useState<HistoryItem[]>([])
  const [historyLimit, setHistoryLimit] = useState(30)
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set())
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [historySortMode, setHistorySortMode] = useState<'time' | 'custom'>('time')
  const [historyCustomOrder, setHistoryCustomOrder] = useState<string[]>([])

  const [debugEnabled, setDebugEnabled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [latestVersion, setLatestVersion] = useState('')

  const [imageLoading, setImageLoading] = useState(true)

  useEffect(() => {
    if (generatedImage) {
      setImageLoading(true)
    }
  }, [generatedImage])

  // Check for updates
  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const response = await fetch('https://api.github.com/repos/qwq202/ai-img/releases/latest')
        if (response.ok) {
          const data = await response.json()
          const latest = data.tag_name?.replace(/^v/, '') || ''
          if (latest && latest !== CURRENT_VERSION) {
            setLatestVersion(latest)
            setUpdateAvailable(true)
          }
        }
      } catch {
        // Silently fail
      }
    }
    checkForUpdates()
  }, [])

  const revokePreviewUrl = (url?: string) => {
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  }

  // Ctrl/Cmd + Enter to submit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (mode === 'generate' && prompt.trim() && generateModel && !loading) {
          handleGenerateRef.current()
        } else if (mode === 'edit' && prompt.trim() && editModel && editImages.length > 0 && !loading) {
          handleEditRef.current()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode, prompt, generateModel, editModel, editImages, loading])


  const taskStatusSnapshotRef = useRef('')
  const handleGenerateRef = useRef<() => void>(() => {})
  const handleEditRef = useRef<() => void>(() => {})
  const loadModelsRef = useRef<(params?: { silent?: boolean }) => Promise<void>>(async () => {})
  const restoreModelsFromCacheRef = useRef<(rawUrl: string) => void>(() => {})
  const addImagesRef = useRef<(files: File[], target: WorkMode) => Promise<void>>(async () => {})
  const referenceImagesRef = useRef<ReferenceImage[]>([])
  const editImagesRef = useRef<ReferenceImage[]>([])

  useEffect(() => {
    referenceImagesRef.current = referenceImages
  }, [referenceImages])

  useEffect(() => {
    editImagesRef.current = editImages
  }, [editImages])

  useEffect(() => {
    return () => {
      referenceImagesRef.current.forEach((item) => revokePreviewUrl(item.preview))
      editImagesRef.current.forEach((item) => revokePreviewUrl(item.preview))
    }
  }, [])

  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 3000)
      return () => clearTimeout(timer)
    }
  }, [notice])

  const workspacePage: WorkspacePage = useMemo(() => {
    if (pathname === '/history') return 'history'
    if (pathname === '/trash') return 'trash'
    return initialPage
  }, [initialPage, pathname])

  const generateModels = useMemo(
    () => imageModels.filter((model) => model.capabilities.supportsGenerate),
    [imageModels]
  )
  const editModels = useMemo(
    () => imageModels.filter((model) => model.capabilities.supportsEdit),
    [imageModels]
  )
  const imageModelById = useMemo(() => {
    return new Map(imageModels.map((model) => [model.id, model]))
  }, [imageModels])

  const selectedGenerateCapabilities = useMemo(
    () => imageModelById.get(generateModel)?.capabilities || DEFAULT_IMAGE_CAPABILITIES,
    [imageModelById, generateModel]
  )
  const selectedEditCapabilities = useMemo(
    () => imageModelById.get(editModel)?.capabilities || DEFAULT_IMAGE_CAPABILITIES,
    [imageModelById, editModel]
  )
  const activeCapabilities = mode === 'generate' ? selectedGenerateCapabilities : selectedEditCapabilities
  const availableAspectRatios = useMemo(
    () => (activeCapabilities.supportedAspectRatios?.length
      ? ['auto', ...activeCapabilities.supportedAspectRatios]
      : ASPECT_RATIOS),
    [activeCapabilities.supportedAspectRatios]
  )
  const availableImageSizes = useMemo(
    () => (activeCapabilities.supportedImageSizes?.length
      ? activeCapabilities.supportedImageSizes
      : IMAGE_SIZES),
    [activeCapabilities.supportedImageSizes]
  )

  const generateMaxReferenceImages = selectedGenerateCapabilities.maxReferenceImages
  const editMaxReferenceImages = selectedEditCapabilities.maxReferenceImages

  const addDebugLog = (event: string, data?: unknown) => {
    if (!debugEnabled) return
    console.debug('[debug]', { ts: new Date().toISOString(), event, data })
  }

  const friendlyMessageFromUnknown = (error: unknown, fallback = t('messages.generateFailed')) => {
    const raw = error instanceof Error ? error.message : ''
    const normalized = raw.toLowerCase()

    if (normalized.includes('auth_unavailable') || normalized.includes('no auth available')) {
      return t('messages.upstreamAuthUnavailable')
    }
    if (normalized.includes('system memory overloaded')) {
      return t('messages.serverUnavailable')
    }
    if (normalized.includes('timeout') || normalized.includes('timed out') || normalized.includes('aborterror')) {
      return t('messages.timeout')
    }
    if (normalized.includes('failed to fetch') || normalized.includes('networkerror')) {
      return t('messages.networkError')
    }
    if (normalized.includes('provided image is not valid')) {
      return t('messages.invalidImage')
    }
    return raw || fallback
  }

  const friendlyMessageFromResponse = (
    status: number,
    payload: ApiErrorLike | undefined,
    fallback = t('messages.generateFailed')
  ) => {
    const code = payload?.code || payload?.details?.error?.code
    const upstreamMessage = payload?.details?.error?.message || payload?.message || payload?.error || ''
    const normalizedUpstream = String(upstreamMessage).toLowerCase()

    if (normalizedUpstream.includes('auth_unavailable') || normalizedUpstream.includes('no auth available')) {
      return t('messages.upstreamAuthUnavailable')
    }
    if (status === 503) return t('messages.serverUnavailable')
    if (status === 504) return t('messages.timeout')
    if (status === 502) return t('messages.serverError')
    if (status === 500) return t('messages.serverError')
    if (status === 429) return t('messages.rateLimited')
    if (status === 401 || status === 403) return t('messages.authFailed')
    if (status === 404) return t('messages.notFound')

    if (code === 'MODEL_NOT_AVAILABLE') return t('messages.modelNotAvailable')
    if (code === 'MODEL_CAPABILITY_MISMATCH') return t('messages.capabilityMismatch')
    if (code === 'API_CONFIG_MISSING') return t('messages.apiConfigMissing')
    if (code === 'INVALID_INPUT') return t('messages.invalidInput')

    if (normalizedUpstream.includes('system memory overloaded')) {
      return t('messages.serverUnavailable')
    }
    if (normalizedUpstream.includes('provided image is not valid')) {
      return t('messages.invalidImage')
    }

    return upstreamMessage || fallback
  }

  const getModelsCacheKey = (rawUrl: string) => `gemini_models_cache_${encodeURIComponent(rawUrl.trim().toLowerCase())}`

  const mapTaskPhaseToMessage = (phase?: string) => {
    if (phase === 'queued') return t('messages.queued')
    if (phase === 'preparing') return t('messages.preparing')
    if (phase === 'calling_model') return t('messages.processing')
    if (phase === 'parsing_response') return t('messages.parsing')
    return mode === 'generate' ? t('messages.generating') : t('messages.editing')
  }

  const persistHistory = (next: HistoryItem[]) => {
    setHistoryItems(next.slice(0, historyLimit))
  }

  const saveGeneratedImageToHistory = (params: {
    image: string
    text?: string
    prompt: string
    mode: WorkMode
    model: string
  }) => {
    const entry: HistoryItem = {
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      image: params.image,
      text: params.text,
      prompt: params.prompt,
      mode: params.mode,
      model: params.model,
      createdAt: Date.now(),
    }

    setHistoryItems((prev) => [entry, ...prev].slice(0, historyLimit))
    addDebugLog('history_saved', { mode: params.mode, model: params.model })
  }

  const moveHistoryItemToTrash = (id: string) => {
    const target = historyItems.find((item) => item.id === id)
    if (!target) return
    setHistoryItems((prev) => prev.filter((item) => item.id !== id))
    setTrashItems((prev) => [target, ...prev].slice(0, 300))
    setNotice(t('messages.movedToTrash'))
  }

  const restoreTrashItem = (id: string) => {
    const target = trashItems.find((item) => item.id === id)
    if (!target) return
    setTrashItems((prev) => prev.filter((item) => item.id !== id))
    persistHistory([target, ...historyItems])
    setNotice(t('messages.restored'))
  }

  const deleteTrashItemPermanently = (id: string) => {
    setTrashItems((prev) => prev.filter((item) => item.id !== id))
    setNotice(t('messages.permanentlyDeleted'))
  }

  const clearTrash = () => {
    setTrashItems([])
    setNotice(t('messages.trashCleared'))
  }

  const toggleSelectAll = () => {
    if (selectedHistoryIds.size === historyItems.length) {
      setSelectedHistoryIds(new Set())
    } else {
      setSelectedHistoryIds(new Set(historyItems.map((item) => item.id)))
    }
  }

  const batchDeleteSelected = () => {
    const itemsToDelete = historyItems.filter((item) => selectedHistoryIds.has(item.id))
    setHistoryItems((prev) => prev.filter((item) => !selectedHistoryIds.has(item.id)))
    setTrashItems((prev) => [...itemsToDelete, ...prev].slice(0, 300))
    setNotice(t('messages.batchMovedToTrash', { count: selectedHistoryIds.size }))
    setSelectedHistoryIds(new Set())
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = historyCustomOrder.indexOf(active.id as string)
      const newIndex = historyCustomOrder.indexOf(over.id as string)
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(historyCustomOrder, oldIndex, newIndex)
        setHistoryCustomOrder(newOrder)
        setHistoryItems((prev) => arrayMove(prev, oldIndex, newIndex))
      }
    }
  }

  const sortedHistoryItems = useMemo(() => {
    if (historySortMode === 'custom' && historyCustomOrder.length > 0) {
      const orderMap = new Map(historyCustomOrder.map((id, idx) => [id, idx]))
      return [...historyItems].sort((a, b) => {
        const orderA = orderMap.get(a.id) ?? Infinity
        const orderB = orderMap.get(b.id) ?? Infinity
        return orderA - orderB
      })
    }
    return [...historyItems].sort((a, b) => b.createdAt - a.createdAt)
  }, [historyItems, historySortMode, historyCustomOrder])

  const buildApiHeaders = (includeContentType = false) => {
    if (!apiKey.trim() || !apiUrl.trim()) return null
    const headers: Record<string, string> = {
      'x-gemini-api-key': apiKey.trim(),
      'x-gemini-api-url': apiUrl.trim(),
    }
    if (includeContentType) headers['Content-Type'] = 'application/json'
    return headers
  }

  const restoreModelsFromCache = (rawUrl: string) => {
    if (!rawUrl.trim()) return
    try {
      const raw = localStorage.getItem(getModelsCacheKey(rawUrl))
      if (!raw) return
      const parsed = JSON.parse(raw) as ModelsCachePayload
      if (!Array.isArray(parsed?.imageModels) || !Array.isArray(parsed?.promptModels)) return

      setImageModels(
        parsed.imageModels
          .map((model) => ({
            id: model.id || '',
            displayName: model.displayName || model.id || '',
            capabilities: {
              ...DEFAULT_IMAGE_CAPABILITIES,
              ...(model.capabilities || {}),
            },
          }))
          .filter((model) => !!model.id)
      )
      setPromptModels(parsed.promptModels.filter((item) => typeof item === 'string' && !!item))
    } catch {
      // ignore broken cache
    }
  }
  restoreModelsFromCacheRef.current = restoreModelsFromCache

  const loadModels = async ({ silent = false }: { silent?: boolean } = {}) => {
    const headers = buildApiHeaders()
    if (!headers) return

    if (!silent) setModelsLoading(true)
    addDebugLog('models_fetch_start', { silent })

    try {
      const response = await fetch('/api/models', { headers })
      const data = (await response.json()) as ModelsApiResponse

      if (!response.ok) {
        addDebugLog('models_fetch_failed', { status: response.status, error: data?.error })
        throw new Error(friendlyMessageFromResponse(response.status, data, t('messages.modelLoadFailed')))
      }

      const nextImageModels = Array.isArray(data.imageModels)
        ? data.imageModels
            .map((model: Partial<ImageModelOption> & { id?: string }) => ({
              id: model.id || '',
              displayName: model.displayName || model.id || '',
              capabilities: {
                ...DEFAULT_IMAGE_CAPABILITIES,
                ...(model.capabilities || {}),
              },
            }))
            .filter((model: ImageModelOption) => !!model.id)
        : []

      const nextPromptModels = Array.isArray(data.promptModels)
        ? data.promptModels.filter((item: unknown): item is string => typeof item === 'string' && !!item)
        : []

      setImageModels(nextImageModels)
      setPromptModels(nextPromptModels)

      if (apiUrl.trim()) {
        const payload: ModelsCachePayload = {
          imageModels: nextImageModels,
          promptModels: nextPromptModels,
        }
        localStorage.setItem(getModelsCacheKey(apiUrl), JSON.stringify(payload))
      }

      addDebugLog('models_fetch_success', {
        imageModelCount: nextImageModels.length,
        promptModelCount: nextPromptModels.length,
        silent,
      })
    } catch (err) {
      if (!silent) {
        setImageModels([])
        setPromptModels([])
        setError(friendlyMessageFromUnknown(err, t('messages.modelLoadFailed')))
      }
    } finally {
      if (!silent) setModelsLoading(false)
    }
  }
  loadModelsRef.current = loadModels

  const handleTestConnection = async () => {
    const trimmedKey = apiKey.trim()
    const trimmedUrl = apiUrl.trim()

    if (!trimmedKey || !trimmedUrl) {
      setError(t('messages.fillKeyAndUrl'))
      return
    }

    try {
      new URL(trimmedUrl)
    } catch {
      setError(t('messages.invalidUrl'))
      return
    }

    setConnectionTesting(true)
    setNotice(t('actions.testing'))
    setError('')
    addDebugLog('connection_test_start')

    try {
      const response = await fetch('/api/models', {
        headers: {
          'x-gemini-api-key': trimmedKey,
          'x-gemini-api-url': trimmedUrl,
        },
      })
      const data = (await response.json().catch(() => ({}))) as ModelsApiResponse

      if (!response.ok) {
        const message = friendlyMessageFromResponse(response.status, data, t('messages.generateFailed'))
        setError(`Connection failed: ${message}`)
        addDebugLog('connection_test_failed', { status: response.status, message })
        return
      }

      const imageCount = Array.isArray(data.imageModels) ? data.imageModels.length : 0
      const promptCount = Array.isArray(data.promptModels) ? data.promptModels.length : 0
      setNotice(t('messages.testSuccess', { imageCount, promptCount }))
      setError('')
      addDebugLog('connection_test_success', { imageCount, promptCount })
      await loadModels({ silent: true })
    } catch (err) {
      setError(`Connection failed: ${friendlyMessageFromUnknown(err, t('messages.networkError'))}`)
      addDebugLog('connection_test_failed', { reason: 'network_or_unknown' })
    } finally {
      setConnectionTesting(false)
    }
  }

  const handleSaveSettings = () => {
    const trimmedKey = apiKey.trim()
    const trimmedUrl = apiUrl.trim()

    if (!trimmedKey || !trimmedUrl) {
      setError(t('messages.fillKeyAndUrl'))
      return
    }

    try {
      new URL(trimmedUrl)
    } catch {
      setError(t('messages.invalidUrl'))
      return
    }

    localStorage.setItem('gemini_api_key', trimmedKey)
    localStorage.setItem('gemini_api_url', trimmedUrl)
    localStorage.setItem('gemini_optimize_model', optimizeModel)
    localStorage.setItem(HISTORY_LIMIT_KEY, String(historyLimit))

    setError('')
    setNotice(t('messages.settingsSaved'))
    setSettingsOpen(false)
    loadModels({ silent: true })
  }

  const handleCopyImage = async () => {
    if (!generatedImage) return
    try {
      const response = await fetch(generatedImage)
      const blob = await response.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      setNotice(t('messages.copied'))
    } catch {
      setError(t('messages.copyFailed'))
    }
  }

  const handleDownload = () => {
    if (!generatedImage) return
    const link = document.createElement('a')
    link.href = generatedImage
    link.download = `gemini-img-${Date.now()}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const toRefImage = async (file: File): Promise<ReferenceImage> => {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const preview = String(e.target?.result || '')
        resolve(preview.split(',')[1] || '')
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    return {
      id: Math.random().toString(36).slice(2, 11),
      file,
      preview: URL.createObjectURL(file),
      base64,
      mimeType: file.type,
    }
  }

  const addImages = async (files: File[], target: WorkMode) => {
    const isGenerate = target === 'generate'
    const max = isGenerate ? generateMaxReferenceImages : editMaxReferenceImages
    const current = isGenerate ? referenceImages.length : editImages.length
    const remaining = max - current

    if (remaining <= 0) {
      setError(t('messages.maxImagesReached', { max }))
      return
    }

    const imageFiles = files.filter((file) => file.type.startsWith('image/')).slice(0, remaining)
    if (imageFiles.length === 0) {
      setError(t('messages.selectImage'))
      return
    }

    const parsed = await Promise.all(imageFiles.map((file) => toRefImage(file)))

    if (isGenerate) {
      setReferenceImages((prev) => [...prev, ...parsed])
    } else {
      setEditImages((prev) => [...prev, ...parsed])
    }

    setNotice(t('messages.imagesAdded', { count: parsed.length }))
    setError('')
  }
  addImagesRef.current = addImages

  const removeImage = (target: WorkMode, id: string) => {
    if (target === 'generate') {
      setReferenceImages((prev) => {
        const next = prev.filter((item) => item.id !== id)
        prev.forEach((item) => {
          if (!next.some((nextItem) => nextItem.id === item.id)) {
            revokePreviewUrl(item.preview)
          }
        })
        return next
      })
      return
    }
    setEditImages((prev) => {
      const next = prev.filter((item) => item.id !== id)
      prev.forEach((item) => {
        if (!next.some((nextItem) => nextItem.id === item.id)) {
          revokePreviewUrl(item.preview)
        }
      })
      return next
    })
  }

  const pollTaskStatus = async (taskId: string) => {
    const maxAttempts = 120
    const pollInterval = 2000
    let attempts = 0

    return new Promise<{ image?: string; text?: string }>((resolve, reject) => {
      const poll = async (): Promise<void> => {
        if (attempts >= maxAttempts) {
          reject(new Error(t('messages.taskTimeout')))
          return
        }
        attempts++

        try {
          const response = await fetch(`/api/task/${taskId}`)
          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || t('messages.queryFailed'))
          }

          const { task } = data
          setLoadingMessage(mapTaskPhaseToMessage(task?.phase))

          const snapshot = `${task?.status || ''}:${task?.phase || ''}`
          if (snapshot !== taskStatusSnapshotRef.current) {
            taskStatusSnapshotRef.current = snapshot
            addDebugLog('task_status_update', { taskId, status: task?.status, phase: task?.phase })
          }

          if (task.status === 'completed') {
            resolve({
              image: task.result?.image,
              text: task.result?.text,
            })
            return
          }

          if (task.status === 'failed') {
            throw new Error(friendlyMessageFromUnknown(task.error, t('messages.taskFailed')))
          }

          if (task.status === 'pending' || task.status === 'processing') {
            setTimeout(() => {
              void poll()
            }, pollInterval)
          }
        } catch (err) {
          addDebugLog('task_status_failed', { taskId, reason: err instanceof Error ? err.message : 'unknown' })
          reject(err instanceof Error ? err : new Error(t('messages.queryFailed')))
        }
      }

      void poll()
    })
  }

  const handleOptimizePrompt = async () => {
    if (!prompt.trim()) {
      setError(t('messages.fillPrompt'))
      return
    }
    if (!optimizeModel) {
      setError(t('messages.noOptimizeModel'))
      return
    }

    setOptimizing(true)
    setError('')

    try {
      addDebugLog('optimize_start', { model: optimizeModel, promptLength: prompt.length })

      const headers = buildApiHeaders(true)
      if (!headers) {
        setError(t('messages.fillApi'))
        return
      }

      const response = await fetch('/api/optimize-prompt', {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt, model: optimizeModel, locale }),
      })

      const data = (await response.json()) as ApiErrorLike & { optimizedPrompt?: string }
      if (!response.ok) {
        addDebugLog('optimize_failed', { status: response.status, code: data?.code, error: data?.error })
        throw new Error(friendlyMessageFromResponse(response.status, data, t('messages.optimizeFailed')))
      }

      if (data.optimizedPrompt) {
        setPrompt(data.optimizedPrompt)
        addDebugLog('optimize_success', { outputLength: data.optimizedPrompt.length })
      }
    } catch (err) {
      addDebugLog('optimize_failed', { reason: err instanceof Error ? err.message : 'unknown' })
      setError(friendlyMessageFromUnknown(err, t('messages.optimizeFailed')))
    } finally {
      setOptimizing(false)
    }
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError(t('messages.fillPrompt'))
      return
    }
    if (!generateModel) {
      setError(t('messages.noModel'))
      return
    }

    setLoading(true)
    setLoadingMessage(t('messages.queued'))
    setGeneratedImage(null)
    setGeneratedText('')
    setBatchResults([])
    setError('')
    setNotice('')

    try {
      const headers = buildApiHeaders(true)
      if (!headers) {
        setError(t('messages.fillApi'))
        setLoading(false)
        return
      }

      const requestBody: {
        prompt: string
        model: string
        referenceImages: Array<{ mimeType: string; data?: string }>
        aspectRatio?: string
        imageSize?: string
        useGoogleSearch?: boolean
        useGoogleImageSearch?: boolean
        thinkingLevel?: 'minimal' | 'high'
        includeThoughts?: boolean
      } = {
        prompt,
        model: generateModel,
        referenceImages: referenceImages.map((img) => ({ mimeType: img.mimeType, data: img.base64 })),
      }

      if (selectedGenerateCapabilities.supportsAspectRatio && aspectRatio !== 'auto') {
        requestBody.aspectRatio = aspectRatio
      }
      if (selectedGenerateCapabilities.supportsImageSize || selectedGenerateCapabilities.forcedImageSize) {
        requestBody.imageSize = selectedGenerateCapabilities.forcedImageSize || imageSize
      }
      if (selectedGenerateCapabilities.supportsSearchGrounding) requestBody.useGoogleSearch = useGoogleSearch
      if (selectedGenerateCapabilities.supportsImageSearchGrounding) {
        requestBody.useGoogleImageSearch = useGoogleImageSearch
      }
      if (selectedGenerateCapabilities.supportsThinkingConfig) {
        requestBody.thinkingLevel = thinkingLevel
        requestBody.includeThoughts = false
      }

      const runCount = Math.max(1, Math.min(8, Math.floor(generateCount)))
      const taskIds: string[] = []

      for (let i = 0; i < runCount; i++) {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        })

        const data = (await response.json()) as ApiErrorLike & { taskId?: string }
        addDebugLog('generate_submit', { model: generateModel, status: response.status, code: data?.code, index: i + 1 })

        if (!response.ok) {
          throw new Error(friendlyMessageFromResponse(response.status, data, t('messages.generateFailed')))
        }
        if (!data.taskId) {
          throw new Error('No task ID')
        }
        taskIds.push(data.taskId)
      }

      let completedCount = 0
      const results = await Promise.all(
        taskIds.map(async (taskId) => {
          const result = await pollTaskStatus(taskId)
          completedCount += 1
          setLoadingMessage(t('messages.generatingProgress', { completed: completedCount, total: taskIds.length }))
          return result
        })
      )

      const images = results
        .map((item) => item.image)
        .filter((item): item is string => typeof item === 'string' && item.length > 0)

      if (images.length === 0) {
        throw new Error(t('messages.noImageReturned'))
      }

      setGeneratedImage(images[0])
      setBatchResults(images)
      setGeneratedText(results.find((item) => item.text)?.text || '')

      if (autoSaveToHistory) {
        images.forEach((image, index) => {
          saveGeneratedImageToHistory({
            image,
            text: results[index]?.text,
            prompt,
            mode: 'generate',
            model: generateModel,
          })
        })
      }

      setNotice(
        autoSaveToHistory
          ? t('messages.savedToHistory', { count: images.length })
          : t('messages.generatedNotSaved', { count: images.length })
      )
    } catch (err) {
      addDebugLog('generate_failed', { reason: err instanceof Error ? err.message : 'unknown' })
      setError(friendlyMessageFromUnknown(err, t('messages.generateFailed')))
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = async () => {
    if (!prompt.trim()) {
      setError(t('messages.fillInstruction'))
      return
    }
    if (!editModel) {
      setError(t('messages.noEditModel'))
      return
    }
    if (editImages.length === 0) {
      setError(t('messages.uploadImage'))
      return
    }

    setLoading(true)
    setLoadingMessage(t('messages.queued'))
    setGeneratedImage(null)
    setGeneratedText('')
    setBatchResults([])
    setError('')
    setNotice('')

    try {
      const headers = buildApiHeaders(true)
      if (!headers) {
        setError(t('messages.fillApi'))
        setLoading(false)
        return
      }

      const requestBody: {
        prompt: string
        images: Array<{ mimeType: string; data: string }>
        model: string
        aspectRatio?: string
        imageSize?: string
      } = {
        prompt,
        images: editImages.map((img) => ({ mimeType: img.mimeType, data: img.base64 || '' })),
        model: editModel,
      }

      if (selectedEditCapabilities.supportsAspectRatio && aspectRatio !== 'auto') {
        requestBody.aspectRatio = aspectRatio
      }
      if (selectedEditCapabilities.supportsImageSize || selectedEditCapabilities.forcedImageSize) {
        requestBody.imageSize = selectedEditCapabilities.forcedImageSize || imageSize
      }

      const response = await fetch('/api/edit', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      })

      const data = (await response.json()) as ApiErrorLike & { image?: string; text?: string }
      addDebugLog('edit_submit', { model: editModel, status: response.status, code: data?.code })

      if (!response.ok) {
        throw new Error(friendlyMessageFromResponse(response.status, data, t('messages.editFailed')))
      }

      if (data.image) {
        setGeneratedImage(data.image)
        saveGeneratedImageToHistory({
          image: data.image,
          text: data.text,
          prompt,
          mode: 'edit',
          model: editModel,
        })
      }
      if (data.text) setGeneratedText(data.text)

      addDebugLog('edit_success', {
        hasImage: !!data.image,
        textLength: typeof data.text === 'string' ? data.text.length : 0,
      })
    } catch (err) {
      addDebugLog('edit_failed', { reason: err instanceof Error ? err.message : 'unknown' })
      setError(friendlyMessageFromUnknown(err, t('messages.editFailed')))
    } finally {
      setLoading(false)
    }
  }
  handleGenerateRef.current = handleGenerate
  handleEditRef.current = handleEdit

  const handleClearCreativeParams = () => {
    setGenerateModel('')
    setEditModel('')
    setAspectRatio('auto')
    setUseGoogleSearch(false)
    setUseGoogleImageSearch(false)
    setThinkingLevel('minimal')
    setAutoSaveToHistory(true)
    setGenerateCount(1)

    localStorage.removeItem(GENERATE_MODEL_KEY)
    localStorage.removeItem(EDIT_MODEL_KEY)
    localStorage.removeItem(ASPECT_RATIO_KEY)
    localStorage.removeItem(GOOGLE_SEARCH_KEY)
    localStorage.removeItem(GOOGLE_IMAGE_SEARCH_KEY)
    localStorage.removeItem(THINKING_LEVEL_KEY)
    localStorage.removeItem(AUTO_SAVE_HISTORY_KEY)
    localStorage.removeItem(GENERATE_COUNT_KEY)

    setError('')
    setNotice(t('messages.clearedAndReset'))
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    router.prefetch('/')
    router.prefetch('/history')
    router.prefetch('/trash')
  }, [mounted, router])

  useEffect(() => {
    if (!mounted) return

    const storedKey = localStorage.getItem('gemini_api_key') || ''
    const storedUrl = localStorage.getItem('gemini_api_url') || ''
    const storedOptimizeModel = localStorage.getItem('gemini_optimize_model') || ''
    const storedDebugEnabled = localStorage.getItem('gemini_debug_enabled') || ''
    const storedHistoryLimit = localStorage.getItem(HISTORY_LIMIT_KEY) || ''
    const storedAutoSave = localStorage.getItem(AUTO_SAVE_HISTORY_KEY) || ''
    const storedGenerateCount = localStorage.getItem(GENERATE_COUNT_KEY) || ''
    const storedGenerateModel = localStorage.getItem(GENERATE_MODEL_KEY) || ''
    const storedEditModel = localStorage.getItem(EDIT_MODEL_KEY) || ''
    const storedAspectRatio = localStorage.getItem(ASPECT_RATIO_KEY) || ''
    const storedGoogleSearch = localStorage.getItem(GOOGLE_SEARCH_KEY) || ''
    const storedGoogleImageSearch = localStorage.getItem(GOOGLE_IMAGE_SEARCH_KEY) || ''
    const storedThinkingLevel = localStorage.getItem(THINKING_LEVEL_KEY) || ''
    const storedSortMode = localStorage.getItem(HISTORY_SORT_MODE_KEY) || ''
    const storedCustomOrder = localStorage.getItem(HISTORY_CUSTOM_ORDER_KEY) || ''

    if (storedKey) setApiKey(storedKey)
    if (storedUrl) setApiUrl(storedUrl)
    if (storedOptimizeModel) setOptimizeModel(storedOptimizeModel)
    if (storedDebugEnabled) setDebugEnabled(storedDebugEnabled === '1')
    if (storedAutoSave) setAutoSaveToHistory(storedAutoSave === '1')
    if (storedGenerateModel) setGenerateModel(storedGenerateModel)
    if (storedEditModel) setEditModel(storedEditModel)
    if (storedAspectRatio) setAspectRatio(storedAspectRatio)
    if (storedGoogleSearch) setUseGoogleSearch(storedGoogleSearch === '1')
    if (storedGoogleImageSearch) setUseGoogleImageSearch(storedGoogleImageSearch === '1')
    if (storedThinkingLevel === 'minimal' || storedThinkingLevel === 'high') {
      setThinkingLevel(storedThinkingLevel)
    }
    if (storedSortMode === 'time' || storedSortMode === 'custom') {
      setHistorySortMode(storedSortMode)
    }
    if (storedCustomOrder) {
      try {
        const parsed = JSON.parse(storedCustomOrder)
        if (Array.isArray(parsed)) {
          setHistoryCustomOrder(parsed)
        }
      } catch {
        // ignore
      }
    }

    if (storedHistoryLimit) {
      const parsed = Number(storedHistoryLimit)
      if (Number.isFinite(parsed)) {
        setHistoryLimit(Math.min(200, Math.max(1, Math.floor(parsed))))
      }
    }
    if (storedGenerateCount) {
      const parsedCount = Number(storedGenerateCount)
      if (Number.isFinite(parsedCount)) {
        setGenerateCount(Math.max(1, Math.min(8, Math.floor(parsedCount))))
      }
    }

    let canceled = false
    const hydrateMediaStorage = async () => {
      try {
        const [idbHistory, idbTrash] = await Promise.all([
          idbGet<HistoryItem[]>(HISTORY_KEY),
          idbGet<HistoryItem[]>(TRASH_KEY),
        ])

        if (!canceled && Array.isArray(idbHistory)) {
          setHistoryItems(idbHistory.filter((item) => !!item?.id && !!item?.image))
        }
        if (!canceled && Array.isArray(idbTrash)) {
          setTrashItems(idbTrash.filter((item) => !!item?.id && !!item?.image))
        }

        if (!Array.isArray(idbHistory)) {
          const storedHistory = localStorage.getItem(HISTORY_KEY) || ''
          if (storedHistory) {
            try {
              const parsed = JSON.parse(storedHistory) as HistoryItem[]
              if (!canceled && Array.isArray(parsed)) {
                const valid = parsed.filter((item) => !!item?.id && !!item?.image)
                setHistoryItems(valid)
                await idbSet(HISTORY_KEY, valid)
              }
            } catch {
              // ignore
            }
          }
        }

        if (!Array.isArray(idbTrash)) {
          const storedTrash = localStorage.getItem(TRASH_KEY) || ''
          if (storedTrash) {
            try {
              const parsed = JSON.parse(storedTrash) as HistoryItem[]
              if (!canceled && Array.isArray(parsed)) {
                const valid = parsed.filter((item) => !!item?.id && !!item?.image)
                setTrashItems(valid)
                await idbSet(TRASH_KEY, valid)
              }
            } catch {
              // ignore
            }
          }
        }
      } finally {
        if (!canceled) setPrefsHydrated(true)
      }
    }

    void hydrateMediaStorage()
    return () => {
      canceled = true
    }
  }, [mounted])

  useEffect(() => {
    if (!mounted) return
    if (!apiKey.trim() || !apiUrl.trim()) return

    restoreModelsFromCacheRef.current(apiUrl)
    void loadModelsRef.current({ silent: true })
  }, [mounted, apiKey, apiUrl])

  useEffect(() => {
    if (generateModels.length === 0) {
      return
    }
    const generateModelIdSet = new Set(generateModels.map((item) => item.id))
    if (!generateModelIdSet.has(generateModel)) {
      setGenerateModel(generateModels[0].id)
      if (generateModel) setNotice(t('messages.modelAutoSwitched'))
    }
  }, [generateModels, generateModel, t])

  useEffect(() => {
    if (editModels.length === 0) {
      return
    }
    const editModelIdSet = new Set(editModels.map((item) => item.id))
    if (!editModelIdSet.has(editModel)) {
      setEditModel(editModels[0].id)
      if (editModel) setNotice(t('messages.modelAutoSwitched'))
    }
  }, [editModels, editModel, t])

  useEffect(() => {
    if (promptModels.length === 0) {
      return
    }
    if (!promptModels.includes(optimizeModel)) {
      setOptimizeModel(promptModels[0])
      if (optimizeModel) setNotice(t('messages.modelAutoSwitched'))
    }
  }, [promptModels, optimizeModel, t])

  useEffect(() => {
    if (!selectedGenerateCapabilities.supportsSearchGrounding && useGoogleSearch) {
      setUseGoogleSearch(false)
      setNotice(t('messages.currentModelNoSearch'))
    }
  }, [selectedGenerateCapabilities.supportsSearchGrounding, useGoogleSearch, t])

  useEffect(() => {
    if (!selectedGenerateCapabilities.supportsImageSearchGrounding && useGoogleImageSearch) {
      setUseGoogleImageSearch(false)
      setNotice(t('messages.imageSearchNotSupported'))
    }
  }, [selectedGenerateCapabilities.supportsImageSearchGrounding, useGoogleImageSearch, t])

  useEffect(() => {
    if (!selectedGenerateCapabilities.supportsThinkingConfig && thinkingLevel !== 'minimal') {
      setThinkingLevel('minimal')
    }
  }, [selectedGenerateCapabilities.supportsThinkingConfig, thinkingLevel])

  useEffect(() => {
    if (selectedGenerateCapabilities.forcedImageSize && imageSize !== selectedGenerateCapabilities.forcedImageSize) {
      setImageSize(selectedGenerateCapabilities.forcedImageSize)
    }
  }, [selectedGenerateCapabilities.forcedImageSize, imageSize])

  useEffect(() => {
    if (selectedEditCapabilities.forcedImageSize && imageSize !== selectedEditCapabilities.forcedImageSize) {
      setImageSize(selectedEditCapabilities.forcedImageSize)
    }
  }, [selectedEditCapabilities.forcedImageSize, imageSize])

  useEffect(() => {
    if (!activeCapabilities.supportsAspectRatio && aspectRatio !== 'auto') {
      setAspectRatio('auto')
      return
    }
    if (!activeCapabilities.supportsAspectRatio) return
    if (availableAspectRatios.includes(aspectRatio)) return
    setAspectRatio(availableAspectRatios[0] || 'auto')
  }, [activeCapabilities.supportsAspectRatio, availableAspectRatios, aspectRatio])

  useEffect(() => {
    if (activeCapabilities.forcedImageSize) return
    if (!activeCapabilities.supportsImageSize) return
    if (availableImageSizes.includes(imageSize as (typeof IMAGE_SIZES)[number])) return
    setImageSize(availableImageSizes[0])
  }, [activeCapabilities.forcedImageSize, activeCapabilities.supportsImageSize, availableImageSizes, imageSize])

  useEffect(() => {
    if (!mounted || !prefsHydrated) return
    localStorage.setItem('gemini_debug_enabled', debugEnabled ? '1' : '0')
  }, [mounted, prefsHydrated, debugEnabled])

  useEffect(() => {
    if (!mounted || !prefsHydrated) return
    localStorage.setItem(AUTO_SAVE_HISTORY_KEY, autoSaveToHistory ? '1' : '0')
  }, [mounted, prefsHydrated, autoSaveToHistory])

  useEffect(() => {
    if (!mounted || !prefsHydrated) return
    localStorage.setItem(GENERATE_COUNT_KEY, String(generateCount))
  }, [mounted, prefsHydrated, generateCount])

  useEffect(() => {
    if (!mounted || !prefsHydrated) return
    localStorage.setItem(GENERATE_MODEL_KEY, generateModel)
  }, [mounted, prefsHydrated, generateModel])

  useEffect(() => {
    if (!mounted || !prefsHydrated) return
    localStorage.setItem(EDIT_MODEL_KEY, editModel)
  }, [mounted, prefsHydrated, editModel])

  useEffect(() => {
    if (!mounted || !prefsHydrated) return
    localStorage.setItem(ASPECT_RATIO_KEY, aspectRatio)
  }, [mounted, prefsHydrated, aspectRatio])

  useEffect(() => {
    if (!mounted || !prefsHydrated) return
    localStorage.setItem(GOOGLE_SEARCH_KEY, useGoogleSearch ? '1' : '0')
  }, [mounted, prefsHydrated, useGoogleSearch])

  useEffect(() => {
    if (!mounted || !prefsHydrated) return
    localStorage.setItem(GOOGLE_IMAGE_SEARCH_KEY, useGoogleImageSearch ? '1' : '0')
  }, [mounted, prefsHydrated, useGoogleImageSearch])

  useEffect(() => {
    if (!mounted || !prefsHydrated) return
    localStorage.setItem(THINKING_LEVEL_KEY, thinkingLevel)
  }, [mounted, prefsHydrated, thinkingLevel])

  useEffect(() => {
    if (!mounted || !prefsHydrated) return
    localStorage.setItem(HISTORY_LIMIT_KEY, String(historyLimit))
  }, [mounted, prefsHydrated, historyLimit])

  useEffect(() => {
    if (!mounted || !prefsHydrated) return
    const persistHistory = async () => {
      try {
        await idbSet(HISTORY_KEY, historyItems.slice(0, historyLimit))
      } catch {
        setError(t('messages.browserStorageUnavailable'))
      }
    }
    void persistHistory()
  }, [mounted, prefsHydrated, historyItems, historyLimit, t])

  useEffect(() => {
    if (!mounted || !prefsHydrated) return
    const persistTrash = async () => {
      try {
        await idbSet(TRASH_KEY, trashItems)
      } catch {
        setError(t('messages.trashStorageUnavailable'))
      }
    }
    void persistTrash()
  }, [mounted, prefsHydrated, trashItems, t])

  useEffect(() => {
    if (!mounted || !prefsHydrated) return
    localStorage.setItem(HISTORY_SORT_MODE_KEY, historySortMode)
  }, [mounted, prefsHydrated, historySortMode])

  useEffect(() => {
    if (!mounted || !prefsHydrated) return
    localStorage.setItem(HISTORY_CUSTOM_ORDER_KEY, JSON.stringify(historyCustomOrder))
  }, [mounted, prefsHydrated, historyCustomOrder])

  useEffect(() => {
    setHistoryItems((prev) => prev.slice(0, historyLimit))
  }, [historyLimit])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (workspacePage !== 'studio') return
      const items = event.clipboardData?.items
      if (!items) return

      const files: File[] = []
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }

      if (files.length === 0) return
      event.preventDefault()
      void addImagesRef.current(files, mode)
    }

    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [workspacePage, mode, generateMaxReferenceImages, editMaxReferenceImages, referenceImages.length, editImages.length])

  // --- UI Components ---

  const sidebarLinks = [
    { key: 'studio', label: t('nav.create'), href: '/', icon: <Sparkles className='h-4 w-4' /> },
    { key: 'history', label: t('nav.history'), href: '/history', icon: <History className='h-4 w-4' />, count: historyItems.length },
    { key: 'trash', label: t('nav.trash'), href: '/trash', icon: <Trash2 className='h-4 w-4' />, count: trashItems.length },
  ]

  return (
    <div className='flex min-h-dvh bg-white text-slate-900 font-sans flex-col lg:flex-row'>
      {/* Mobile Header */}
      <header className='lg:hidden flex items-center justify-between p-4 border-b border-slate-100 bg-white sticky top-0 z-30'>
        <div className='flex items-center gap-2'>
           <span className='text-lg font-bold tracking-tight'>Gemini Studio</span>
        </div>
        <div className='flex items-center gap-1'>
          <a
            href='https://github.com/qwq202/ai-img'
            target='_blank'
            rel='noopener noreferrer'
            className='p-2 hover:bg-slate-100 rounded-full transition-colors'
            title='GitHub'
          >
            <svg className='h-5 w-5' fill='currentColor' viewBox='0 0 24 24'>
              <path fillRule='evenodd' clipRule='evenodd' d='M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z' />
            </svg>
          </a>
          <Button variant='ghost' size='icon' onClick={() => setMobileMenuOpen(true)}>
            <Menu className='h-5 w-5' />
          </Button>
        </div>
      </header>

      {/* Sidebar */}
      <aside className={cn(
        'border-r border-slate-100 bg-white flex flex-col p-4',
        'lg:w-64 lg:fixed lg:h-full lg:translate-x-0 transition-transform duration-300 ease-in-out z-40',
        'fixed inset-y-0 left-0 w-64 lg:shadow-none',
        mobileMenuOpen ? 'translate-x-0 shadow-2xl lg:shadow-none' : '-translate-x-full lg:translate-x-0'
      )}>
        <div className='flex items-center justify-between mb-8 px-2'>
          <div>
            <h1 className='text-xl font-bold tracking-tight text-slate-900'>Gemini Studio</h1>
            <p className='text-xs text-slate-400 mt-1 font-medium tracking-wide uppercase'>Aesthetic & Pragmatic</p>
          </div>
          <Button variant='ghost' size='icon' className='lg:hidden -mr-2' onClick={() => setMobileMenuOpen(false)}>
            <X className='h-5 w-5' />
          </Button>
        </div>

        <nav className='flex-1 space-y-1'>
          {sidebarLinks.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
              className={cn(
                'flex items-center justify-between px-3 py-2 text-sm rounded-sm transition-all duration-200 group border-l-2 border-transparent hover:border-slate-200 hover:bg-slate-50',
                workspacePage === item.key
                  ? 'bg-slate-50 text-slate-900 font-medium border-l-slate-900'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 hover:pl-4'
              )}
            >
              <div className='flex items-center gap-3'>
                {item.icon}
                {item.label}
              </div>
              {item.count ? <span className='text-xs text-slate-400'>{item.count}</span> : null}
            </Link>
          ))}
        </nav>

        <div className='space-y-2 mt-auto pt-4 border-t border-slate-100'>
           <Button
            variant='outline'
            size='sm'
            className='w-full justify-start text-slate-600 border-slate-200'
            onClick={() => {
              setSettingsOpen(true)
              setMobileMenuOpen(false)
            }}
          >
            <Settings className='mr-2 h-4 w-4' />
            {t('actions.settings')}
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='w-full justify-start text-slate-400 hover:text-slate-600'
            onClick={() => {
              loadModels()
              setMobileMenuOpen(false)
            }}
            disabled={modelsLoading}
          >
            <RefreshCw className={cn('mr-2 h-3 w-3', modelsLoading && 'animate-spin')} />
            {t('actions.refreshModels')}
          </Button>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {mobileMenuOpen && (
        <div className='lg:hidden fixed inset-0 bg-black/20 z-30 backdrop-blur-sm' onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Main Content */}
      <main className='flex-1 lg:ml-64 p-4 lg:p-6 overflow-auto w-full'>
        {/* Toast Notification */}
        {(error || notice) && (
          <div className={cn(
            'fixed bottom-6 right-6 z-[120] px-4 py-3 rounded-md shadow-lg flex items-center gap-3 transition-all duration-300 animate-in slide-in-from-bottom-5 fade-in bg-white border border-slate-200 text-slate-800'
          )}>
            {error ? <AlertCircle className='h-5 w-5 text-red-500' /> : <CheckCircle2 className='h-5 w-5 text-green-500' />}
            <span className='text-sm font-medium'>{error || notice}</span>
            <button onClick={() => { setError(''); setNotice('') }} className='ml-2 opacity-70 hover:opacity-100'>
              <X className='h-4 w-4' />
            </button>
          </div>
        )}

        {updateAvailable && (
          <div className='fixed top-4 right-4 z-50 bg-blue-50 border border-blue-200 rounded-md p-3 shadow-lg flex items-center gap-3 max-w-sm'>
            <Sparkles className='h-4 w-4 text-blue-500 flex-shrink-0' />
            <div className='flex-1 min-w-0'>
              <p className='text-sm text-blue-700'>
                {t('messages.updateAvailable', { version: latestVersion })}
              </p>
            </div>
            <a
              href='https://github.com/qwq202/ai-img/releases'
              target='_blank'
              rel='noopener noreferrer'
              className='text-xs text-blue-600 hover:text-blue-800 underline flex-shrink-0'
            >
              {t('messages.viewUpdate')}
            </a>
            <button onClick={() => setUpdateAvailable(false)} className='text-blue-400 hover:text-blue-600 flex-shrink-0'>
              <X className='h-4 w-4' />
            </button>
          </div>
        )}

        <a
          href='https://github.com/qwq202/ai-img'
          target='_blank'
          rel='noopener noreferrer'
          className='fixed top-4 right-4 z-40 p-2 hover:bg-slate-100 rounded-full transition-colors hidden lg:block'
          title='GitHub'
        >
          <svg className='h-5 w-5' fill='currentColor' viewBox='0 0 24 24'>
            <path fillRule='evenodd' clipRule='evenodd' d='M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z' />
          </svg>
        </a>

        {workspacePage === 'studio' && (
          <div className='grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-[1600px] mx-auto'>
            {/* Left Panel: Controls */}
            <div className='lg:col-span-4 space-y-6'>
              
              {/* Mode Switch */}
              <div className='flex bg-slate-100/50 rounded-md p-1'>
                <button
                  onClick={() => setMode('generate')}
                  className={cn(
                    'flex-1 py-1.5 text-sm font-medium transition-all rounded-sm duration-300 ease-out',
                    mode === 'generate' ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-900'
                  )}
                >
                  {t('modes.generate')}
                </button>
                <button
                  onClick={() => setMode('edit')}
                  className={cn(
                    'flex-1 py-1.5 text-sm font-medium transition-all rounded-sm duration-300 ease-out',
                    mode === 'edit' ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-900'
                  )}
                >
                  {t('modes.edit')}
                </button>
              </div>

              {/* Input Area */}
              <div className='space-y-3'>
                <div className='flex justify-between items-center'>
                  <Label className='text-xs font-semibold uppercase text-slate-400 tracking-wider'>
                    {mode === 'generate' ? t('labels.prompt') : t('labels.editInstruction')}
                  </Label>
                  <button 
                    onClick={handleOptimizePrompt}
                    disabled={optimizing || !prompt.trim()}
                    className='text-xs text-slate-400 hover:text-slate-900 flex items-center gap-1 transition-colors disabled:opacity-50'
                    title={t('hints.promptOptimizer')}
                  >
                    <span className='text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-400 mr-1 hidden lg:inline-block'>⌘+Enter</span>
                    <Wand2 className='h-3 w-3' />
                    {t('actions.optimize')}
                  </button>
                </div>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={mode === 'generate' ? t('placeholders.promptGenerate') : t('placeholders.promptEdit')}
                  className='min-h-[140px] resize-none border-slate-200 focus:border-slate-400 focus:ring-4 focus:ring-slate-100 bg-white rounded-sm text-sm transition-all duration-300'
                />
              </div>

              {/* Reference Images */}
              <div className='space-y-3'>
<Label className='text-xs font-semibold uppercase text-slate-400 tracking-wider'>
                     {mode === 'generate' ? t('labels.referenceImages') : t('labels.editMaterials')}
                   </Label>
                <div className='grid grid-cols-4 gap-2'>
                  {(mode === 'generate' ? referenceImages : editImages).map((img) => (
                    <div key={img.id} className='relative aspect-square bg-white rounded-sm overflow-hidden group border border-slate-200 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5'>
                      <Image src={img.preview} alt='ref' fill className='object-cover' />
                      <button
                        onClick={() => removeImage(mode, img.id)}
                        className='absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white'
                      >
                        <X className='h-4 w-4' />
                      </button>
                    </div>
                  ))}
                  <div
                    className={cn(
                      'aspect-square border border-dashed border-slate-300 rounded-sm flex items-center justify-center cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-all duration-300 group',
                      (mode === 'generate' ? isReferenceDragActive : isEditDragActive) && 'border-slate-900 bg-slate-50'
                    )}
                    onDragOver={(e) => {
                      e.preventDefault()
                      if (mode === 'generate') {
                        setIsReferenceDragActive(true)
                      } else {
                        setIsEditDragActive(true)
                      }
                    }}
                    onDragLeave={() => {
                      if (mode === 'generate') {
                        setIsReferenceDragActive(false)
                      } else {
                        setIsEditDragActive(false)
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (mode === 'generate') {
                        setIsReferenceDragActive(false)
                      } else {
                        setIsEditDragActive(false)
                      }
                      addImages(Array.from(e.dataTransfer.files || []), mode)
                    }}
                  >
                    <input
                      type='file'
                      multiple
                      accept='image/*'
                      className='hidden'
                      id='upload-trigger'
                      onChange={(e) => e.target.files && addImages(Array.from(e.target.files), mode)}
                    />
                    <label htmlFor='upload-trigger' className='flex flex-col items-center justify-center w-full h-full cursor-pointer text-slate-400 hover:text-slate-600'>
                      <Upload className='h-5 w-5 text-slate-400 group-hover:scale-110 transition-transform duration-300' />
                    </label>
                  </div>
                </div>
              </div>

              {/* Controls Grid */}
              <div className='grid grid-cols-3 gap-4'>
                <div className='space-y-1.5'>
                  <Label className='text-xs text-slate-500'>{t('labels.model')}</Label>
                  <Select 
                    value={mode === 'generate' ? generateModel : editModel} 
                    onValueChange={mode === 'generate' ? setGenerateModel : setEditModel}
                  >
                    <SelectTrigger className='h-9 text-xs'><SelectValue placeholder={t('placeholders.selectModel')} /></SelectTrigger>
                    <SelectContent>
                      {(mode === 'generate' ? generateModels : editModels).map((m) => (
                        <SelectItem key={m.id} value={m.id} className='text-xs'>{m.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className='space-y-1.5'>
                  <Label className='text-xs text-slate-500'>{t('labels.ratio')}</Label>
                  <Select
                    value={aspectRatio}
                    onValueChange={setAspectRatio}
                    disabled={!activeCapabilities.supportsAspectRatio}
                  >
                    <SelectTrigger className='h-9 text-xs'><SelectValue placeholder={t('placeholders.auto')} /></SelectTrigger>
                    <SelectContent>
                      {availableAspectRatios.map((r) => <SelectItem key={r} value={r} className='text-xs'>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs text-slate-500'>{t('labels.resolution')}</Label>
                  <Select
                    value={imageSize}
                    onValueChange={setImageSize}
                    disabled={!activeCapabilities.supportsImageSize || !!activeCapabilities.forcedImageSize}
                  >
                    <SelectTrigger className='h-9 text-xs'><SelectValue placeholder='1K' /></SelectTrigger>
                    <SelectContent>
                      {availableImageSizes.map((size) => (
                        <SelectItem key={size} value={size} className='text-xs'>
                          {IMAGE_SIZE_LABELS[size as (typeof IMAGE_SIZES)[number]] || size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {activeCapabilities.forcedImageSize ? (
                    <p className='text-[11px] text-slate-500'>
                      固定为 {IMAGE_SIZE_LABELS[activeCapabilities.forcedImageSize] || activeCapabilities.forcedImageSize}
                    </p>
                  ) : null}
                </div>
              </div>

              {mode === 'generate' && (
                <div className='space-y-3'>
                  <div className={cn(
                    'flex items-center justify-between rounded-sm border border-slate-200 bg-white p-3 shadow-sm transition-all',
                    selectedGenerateCapabilities.supportsSearchGrounding ? 'hover:shadow-md hover:border-slate-300' : 'opacity-60 cursor-not-allowed bg-slate-50'
                  )}>
                    <div className='space-y-0.5'>
                      <Label htmlFor='google-search' className={cn('text-sm font-medium text-slate-900', selectedGenerateCapabilities.supportsSearchGrounding ? 'cursor-pointer' : 'cursor-not-allowed')}>{t('labels.googleSearch')}</Label>
                      <p className='text-xs text-slate-500'>
                        {selectedGenerateCapabilities.supportsSearchGrounding ? t('hints.imageSearchHint') : t('hints.searchNotSupported')}
                      </p>
                    </div>
                    <Switch
                      id='google-search'
                      checked={useGoogleSearch}
                      onCheckedChange={setUseGoogleSearch}
                      disabled={!selectedGenerateCapabilities.supportsSearchGrounding}
                    />
                  </div>

                  <div className={cn(
                    'flex items-center justify-between rounded-sm border border-slate-200 bg-white p-3 shadow-sm transition-all',
                    selectedGenerateCapabilities.supportsImageSearchGrounding
                      ? 'hover:shadow-md hover:border-slate-300'
                      : 'opacity-60 cursor-not-allowed bg-slate-50'
                  )}>
                    <div className='space-y-0.5'>
                      <Label htmlFor='google-image-search' className={cn('text-sm font-medium text-slate-900', selectedGenerateCapabilities.supportsImageSearchGrounding ? 'cursor-pointer' : 'cursor-not-allowed')}>{t('labels.googleImageSearch')}</Label>
                      <p className='text-xs text-slate-500'>
                        {selectedGenerateCapabilities.supportsImageSearchGrounding ? t('hints.imageSearchHint') : t('hints.imageSearchNotSupported')}
                      </p>
                    </div>
                    <Switch
                      id='google-image-search'
                      checked={useGoogleImageSearch}
                      onCheckedChange={setUseGoogleImageSearch}
                      disabled={!selectedGenerateCapabilities.supportsImageSearchGrounding}
                    />
                  </div>

                  <div className={cn(
                    'rounded-sm border border-slate-200 bg-white p-3 shadow-sm transition-all',
                    selectedGenerateCapabilities.supportsThinkingConfig ? 'hover:shadow-md hover:border-slate-300' : 'opacity-60 cursor-not-allowed bg-slate-50'
                  )}>
                    <div className='space-y-1.5'>
                      <Label className='text-sm font-medium text-slate-900'>{t('labels.thinkingLevel')}</Label>
                      <p className='text-xs text-slate-500'>
                        {selectedGenerateCapabilities.supportsThinkingConfig ? t('hints.thinkingLevelHint') : t('hints.thinkingNotSupported')}
                      </p>
                      <Select value={thinkingLevel} onValueChange={(value) => setThinkingLevel(value as 'minimal' | 'high')} disabled={!selectedGenerateCapabilities.supportsThinkingConfig}>
                        <SelectTrigger className='h-9 text-xs'><SelectValue placeholder={t('placeholders.auto')} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value='minimal' className='text-xs'>{t('placeholders.auto')}</SelectItem>
                          <SelectItem value='high' className='text-xs'>High</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              <div className='space-y-3 mt-4 rounded-sm border border-slate-200 bg-white p-3 shadow-sm'>
                {mode === 'generate' && (
                  <div className='grid grid-cols-[1fr_120px] gap-3 items-center'>
                    <div>
                      <Label htmlFor='generate-count' className='text-sm font-medium text-slate-900'>{t('labels.generateCount')}</Label>
                      <p className='text-xs text-slate-500'>{t('hints.generateCountHint')}</p>
                    </div>
                    <Input
                      id='generate-count'
                      type='number'
                      min={1}
                      max={8}
                      value={generateCount}
                      onChange={(e) => {
                        const next = Number(e.target.value)
                        if (!Number.isFinite(next)) return
                        setGenerateCount(Math.max(1, Math.min(8, Math.floor(next))))
                      }}
                    />
                  </div>
                )}

                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='w-full'
                  onClick={handleClearCreativeParams}
                >
                  {t('actions.clear')}
                </Button>
              </div>

              <Button
                size='lg'
                className='w-full bg-slate-900 text-white hover:bg-slate-800 hover:scale-[1.01] active:scale-[0.99] rounded-sm h-12 text-sm font-medium tracking-wide mt-4 transition-all duration-200 shadow-lg shadow-slate-900/10'
                onClick={mode === 'generate' ? handleGenerate : handleEdit}
                disabled={loading}
              >
                {loading ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <Sparkles className='mr-2 h-4 w-4' />}
                {loading ? t('messages.processing') : t('actions.generate')}
              </Button>

            </div>

            {/* Right Panel: Result */}
            <div className='lg:col-span-8 flex flex-col h-full min-h-[400px] lg:h-[calc(100dvh-6rem)] lg:max-h-[calc(100dvh-6rem)] overflow-hidden bg-slate-50/50 rounded-sm border border-slate-100 p-6 relative bg-dot-pattern'>
              <div className='flex-1 min-h-0 flex items-center justify-center relative overflow-hidden'>
                {loading ? (
                  <div className='text-center'>
                    <Loader2 className='h-8 w-8 animate-spin mx-auto text-slate-300' />
                    <p className='mt-4 text-sm text-slate-400 font-mono animate-pulse'>{loadingMessage}</p>
                  </div>
                ) : generatedImage ? (
                    <div className='relative w-full h-full min-h-0 flex items-center justify-center overflow-hidden'>
                      {imageLoading && (
                        <div className='absolute inset-0 flex items-center justify-center bg-slate-50 z-10'>
                          <Loader2 className='h-8 w-8 animate-spin text-slate-300' />
                        </div>
                      )}
                      <Image
                        src={generatedImage}
                        alt='Result image'
                        width={1024}
                        height={1024}
                        unoptimized
                        onLoad={() => setImageLoading(false)}
                        onClick={() => setPreviewImage(generatedImage)}
                        className={cn(
                          'max-w-full max-h-full object-contain shadow-sm bg-white transition-opacity duration-500 cursor-zoom-in',
                          imageLoading ? 'opacity-0' : 'opacity-100'
                        )}
                      />
                    <div className='absolute bottom-4 flex gap-2 opacity-0 hover:opacity-100 transition-opacity bg-white/90 p-1.5 rounded-sm border border-slate-200 backdrop-blur-sm'>
                      <Button variant='ghost' size='icon' className='h-8 w-8' onClick={() => setPreviewImage(generatedImage)}>
                        <Maximize2 className='h-4 w-4' />
                      </Button>
                      <Button variant='ghost' size='icon' className='h-8 w-8' onClick={handleCopyImage}>
                        <Copy className='h-4 w-4' />
                      </Button>
                      <Button variant='ghost' size='icon' className='h-8 w-8' onClick={handleDownload}>
                        <Download className='h-4 w-4' />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className='text-center text-slate-300 flex flex-col items-center justify-center'>
                    <ImageIcon className='h-24 w-24 mb-4 opacity-10' />
                    <p className='text-base font-medium opacity-50'>{t('messages.noContent')}</p>
                  </div>
                )}
              </div>

              {generatedText && (
                <div className='mt-4 p-4 bg-white border border-slate-200 rounded-sm text-sm text-slate-600 leading-relaxed'>
                  {generatedText}
                </div>
              )}

              {mode === 'generate' && batchResults.length > 1 && (
                <div className='mt-4'>
                  <p className='mb-2 text-xs font-medium text-slate-500'>{t('messages.generatedNotSaved', { count: batchResults.length })}</p>
                  <div className='grid grid-cols-4 gap-2'>
                    {batchResults.map((image, index) => (
                      <button
                        key={`${image.slice(0, 32)}_${index}`}
                        type='button'
                        className={cn(
                          'relative aspect-square overflow-hidden rounded-sm border bg-white',
                          generatedImage === image ? 'border-slate-900' : 'border-slate-200 hover:border-slate-400'
                        )}
                        onClick={() => setGeneratedImage(image)}
                      >
                        <Image src={image} alt={`batch-${index + 1}`} fill className='object-cover' />
                        <span className='absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white'>#{index + 1}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {workspacePage === 'history' && (
          <div className='max-w-[1600px] mx-auto'>
            <div className='flex items-center justify-between mb-6'>
              <div className='flex items-center gap-3'>
                <h2 className='text-xl font-bold'>{t('nav.history')}</h2>
                {historyItems.length > 0 && (
                  <div className='flex items-center gap-2'>
                    <Button
                      variant={isSelectionMode ? 'default' : 'outline'}
                      size='sm'
                      onClick={() => {
                        setIsSelectionMode(!isSelectionMode)
                        if (isSelectionMode) {
                          setSelectedHistoryIds(new Set())
                        }
                      }}
                      className='h-7 text-xs'
                    >
                      {isSelectionMode ? t('actions.cancel') : t('actions.select')}
                    </Button>
                    {isSelectionMode && selectedHistoryIds.size > 0 && (
                      <Button
                        variant='destructive'
                        size='sm'
                        onClick={() => {
                          if (window.confirm(t('messages.confirmBatchDelete', { count: selectedHistoryIds.size }))) {
                            batchDeleteSelected()
                          }
                        }}
                        className='h-7 text-xs'
                      >
                        <Trash2 className='h-3 w-3 mr-1' />
                        {t('actions.delete')} ({selectedHistoryIds.size})
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className='flex items-center gap-3'>
                {historyItems.length > 0 && (
                  <div className='flex items-center gap-2'>
                    <select
                      value={historySortMode}
                      onChange={(e) => {
                        const mode = e.target.value as 'time' | 'custom'
                        setHistorySortMode(mode)
                        if (mode === 'custom') {
                          setHistoryCustomOrder(historyItems.map((item) => item.id))
                        }
                      }}
                      className='text-xs border border-slate-200 rounded-sm px-2 py-1 bg-white'
                    >
                      <option value='time'>{t('labels.sortByTime')}</option>
                      <option value='custom'>{t('labels.sortByCustom')}</option>
                    </select>
                  </div>
                )}
                <span className='text-sm text-slate-400'>{t('messages.historyCount', { count: historyItems.length })}</span>
              </div>
            </div>

            {isSelectionMode && selectedHistoryIds.size > 0 && (
              <div className='mb-4 flex items-center gap-2'>
                <Button variant='outline' size='sm' onClick={toggleSelectAll} className='h-7 text-xs'>
                  {selectedHistoryIds.size === historyItems.length ? t('actions.deselectAll') : t('actions.selectAll')}
                </Button>
                <span className='text-xs text-slate-500'>{t('messages.selectedCount', { count: selectedHistoryIds.size })}</span>
              </div>
            )}

            <DndContext
              sensors={undefined}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedHistoryItems.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className='grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4'>
                  {sortedHistoryItems.map((item) => {
                    const isSelected = selectedHistoryIds.has(item.id)
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'group relative border bg-white rounded-sm overflow-hidden transition-colors',
                          isSelectionMode && isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200 hover:border-slate-400',
                          historySortMode === 'custom' && 'cursor-grab'
                        )}
                      >
                        <div className='aspect-square relative bg-slate-50'>
                          <Image src={item.image} alt='history' fill className='object-cover' />
                          {isSelectionMode ? (
                            <button
                              type='button'
                              className='absolute inset-0 z-10 cursor-pointer'
                              onClick={() => {
                                    setSelectedHistoryIds((prev) => {
                                      const next = new Set(prev)
                                      if (next.has(item.id)) {
                                        next.delete(item.id)
                                      } else {
                                        next.add(item.id)
                                      }
                                      return next
                                    })
                                  }}
                            >
                              <div className='absolute top-2 left-2 z-10'>
                                {isSelected ? (
                                  <CheckSquare className='h-5 w-5 text-blue-500' />
                                ) : (
                                  <Square className='h-5 w-5 text-slate-400' />
                                )}
                              </div>
                            </button>
                          ) : historySortMode === 'custom' ? (
                            <div className='absolute top-2 left-2 z-10 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity'>
                              <GripVertical className='h-4 w-4 text-slate-600' />
                            </div>
                          ) : null}
                          {!isSelectionMode && (
                            <div className='absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100'>
                              <Button size='icon' variant='secondary' className='h-8 w-8 rounded-sm bg-white text-black' onClick={() => {
                                setGeneratedImage(item.image)
                                setGeneratedText(item.text || '')
                                setMode(item.mode)
                                router.push('/')
                              }}>
                                <Undo2 className='h-4 w-4' />
                              </Button>
                              <Button size='icon' variant='secondary' className='h-8 w-8 rounded-sm bg-white text-red-600' onClick={() => moveHistoryItemToTrash(item.id)}>
                                <Trash2 className='h-4 w-4' />
                              </Button>
                            </div>
                          )}
                        </div>
                        <div className='p-2'>
                          <div className='flex items-center justify-between'>
                            <p className='text-[10px] text-slate-400 uppercase font-medium truncate'>{item.model}</p>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation()
                                navigator.clipboard.writeText(item.prompt)
                                setNotice(t('messages.promptCopied'))
                              }}
                              className='text-[10px] text-slate-400 hover:text-slate-900 opacity-0 group-hover:opacity-100 transition-opacity'
                              title={t('messages.promptCopied')}
                            >
                              <Copy className='h-3 w-3' />
                            </button>
                          </div>
                          <p className='text-xs text-slate-600 truncate mt-0.5'>{item.prompt}</p>
                        </div>
                      </div>
                    )
                  })}
                  {historyItems.length === 0 && (
                    <div className='col-span-full flex flex-col items-center justify-center py-20 text-slate-400'>
                      <div className='h-16 w-16 rounded-full bg-slate-50 flex items-center justify-center mb-4'>
                        <History className='h-8 w-8 opacity-20' />
                      </div>
                      <p className='text-sm font-medium'>{t('messages.noHistory')}</p>
                      <p className='text-xs mt-1 opacity-60'>{t('messages.noHistoryHint')}</p>
                    </div>
                  )}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}

        {workspacePage === 'trash' && (
           <div className='max-w-[1600px] mx-auto'>
            <div className='flex items-center justify-between mb-6'>
              <h2 className='text-xl font-bold'>{t('nav.trash')}</h2>
              <Button variant='outline' size='sm' onClick={() => {
                if (window.confirm(t('messages.confirmClearTrash'))) {
                  clearTrash()
                }
              }} disabled={trashItems.length === 0}>{t('actions.clear')}</Button>
            </div>
            
            <div className='grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4'>
              {trashItems.map((item) => (
                <div key={item.id} className='relative border border-slate-200 bg-white rounded-sm overflow-hidden opacity-75 hover:opacity-100 transition-opacity'>
                  <div className='aspect-square relative bg-slate-50'>
                    <Image src={item.image} alt='trash' fill className='object-cover grayscale' />
                    <div className='absolute inset-0 flex items-center justify-center gap-2 bg-black/10'>
                      <Button size='icon' variant='secondary' className='h-8 w-8 rounded-sm bg-white' onClick={() => restoreTrashItem(item.id)}>
                        <RotateCcw className='h-4 w-4' />
                      </Button>
                      <Button size='icon' variant='secondary' className='h-8 w-8 rounded-sm bg-white text-red-600' onClick={() => deleteTrashItemPermanently(item.id)}>
                        <X className='h-4 w-4' />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
               {trashItems.length === 0 && (
                <div className='col-span-full flex flex-col items-center justify-center py-20 text-slate-400'>
                  <div className='h-16 w-16 rounded-full bg-slate-50 flex items-center justify-center mb-4'>
                    <Trash2 className='h-8 w-8 opacity-20' />
                  </div>
                  <p className='text-sm font-medium'>{t('messages.trashEmpty')}</p>
                  <p className='text-xs mt-1 opacity-60'>{t('messages.trashHint')}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Settings Modal */}
      {settingsOpen && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm' onClick={() => setSettingsOpen(false)}>
          <Card className='w-full max-w-md bg-white border-none shadow-xl rounded-sm' onClick={e => e.stopPropagation()}>
            <div className='p-6 space-y-6'>
              <div className='flex items-center justify-between'>
                <h3 className='text-lg font-bold'>{t('settings.title')} <span className='text-xs font-normal text-slate-400'>v{CURRENT_VERSION}</span></h3>
                <button onClick={() => setSettingsOpen(false)} className='text-slate-400 hover:text-slate-900'><X className='h-5 w-5' /></button>
              </div>
              
              <div className='space-y-4'>
                <div className='space-y-2'>
                  <Label>{t('settings.apiKey')}</Label>
                  <Input type='password' value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={t('placeholders.apiKeyPlaceholder')} />
                </div>
                <div className='space-y-2'>
                  <Label>{t('settings.apiUrl')}</Label>
                  <Input value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder={t('placeholders.apiUrlPlaceholder')} />
                </div>
                <div className='space-y-2'>
                   <Label>{t('settings.promptOptimizerModel')}</Label>
                   <Select value={optimizeModel} onValueChange={setOptimizeModel}>
                    <SelectTrigger><SelectValue placeholder={t('settings.selectModel')} /></SelectTrigger>
                    <SelectContent>
                      {promptModels.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                   </Select>
                </div>
                <div className='space-y-2'>
                  <Label>{t('settings.language')}</Label>
                  <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value='zh-CN'>中文</SelectItem>
                      <SelectItem value='en'>English</SelectItem>
                      <SelectItem value='ja'>日本語</SelectItem>
                      <SelectItem value='ko'>한국어</SelectItem>
                      <SelectItem value='fr'>Français</SelectItem>
                      <SelectItem value='de'>Deutsch</SelectItem>
                      <SelectItem value='es'>Español</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className='flex items-center justify-between pt-2'>
                  <Label>{t('settings.debugMode')}</Label>
                  <Switch checked={debugEnabled} onCheckedChange={setDebugEnabled} />
                </div>
                <div className='flex items-center justify-between pt-2'>
                  <div>
                    <Label>{t('settings.autoSaveToHistory')}</Label>
                    <p className='text-xs text-slate-500 mt-1'>{t('hints.autoSaveHint')}</p>
                  </div>
                  <Switch checked={autoSaveToHistory} onCheckedChange={setAutoSaveToHistory} />
                </div>
              </div>

              <div className='flex gap-3 pt-2'>
                <Button variant='outline' className='flex-1' onClick={handleTestConnection} disabled={connectionTesting}>
                  {connectionTesting ? t('actions.testing') : t('actions.test')}
                </Button>
                <Button className='flex-1 bg-slate-900 text-white hover:bg-black' onClick={handleSaveSettings}>{t('actions.save')}</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Fullscreen Preview */}
      {previewImage && (
        <div className='fixed inset-0 z-[100] bg-white flex items-center justify-center' onClick={() => setPreviewImage(null)}>
           <button className='absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-full' onClick={() => setPreviewImage(null)}>
             <X className='h-8 w-8 text-slate-900' />
           </button>
           <Image
             src={previewImage}
             alt='Preview image'
             width={2048}
             height={2048}
             unoptimized
             className='max-w-[95vw] max-h-[95vh] h-auto w-auto object-contain'
           />
        </div>
      )}
    </div>
  )
}

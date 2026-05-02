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

  // Shared GitHub SVG
  const GitHubIcon = () => (
    <svg className='h-4 w-4' fill='currentColor' viewBox='0 0 24 24' aria-hidden='true'>
      <path fillRule='evenodd' clipRule='evenodd' d='M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z' />
    </svg>
  )

  const navItems = [
    { key: 'studio' as WorkspacePage, href: '/', icon: <Sparkles className='h-5 w-5' />, label: t('nav.create') },
    { key: 'history' as WorkspacePage, href: '/history', icon: <History className='h-5 w-5' />, label: t('nav.history'), count: historyItems.length },
    { key: 'trash' as WorkspacePage, href: '/trash', icon: <Trash2 className='h-5 w-5' />, label: t('nav.trash'), count: trashItems.length },
  ]

  // Shared image upload zone
  const ImageUploadZone = ({ target }: { target: WorkMode }) => {
    const isActive = target === 'generate' ? isReferenceDragActive : isEditDragActive
    const images = target === 'generate' ? referenceImages : editImages
    return (
      <div className='space-y-2'>
        <p className='text-[10px] font-semibold uppercase tracking-widest text-muted-foreground'>
          {target === 'generate' ? t('labels.referenceImages') : t('labels.editMaterials')}
        </p>
        <div className='flex flex-wrap gap-2'>
          {images.map((img) => (
            <div key={img.id} className='relative w-14 h-14 rounded-lg overflow-hidden group border border-white/10 flex-shrink-0'>
              <Image src={img.preview} alt='ref' fill className='object-cover' />
              <button
                onClick={() => removeImage(target, img.id)}
                className='absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity'
                aria-label='Remove image'
              >
                <X className='h-3.5 w-3.5 text-white' />
              </button>
            </div>
          ))}
          <div
            className={cn(
              'w-14 h-14 border border-dashed rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 flex-shrink-0',
              isActive
                ? 'border-primary bg-primary/10'
                : 'border-white/15 hover:border-white/30 hover:bg-white/5'
            )}
            onDragOver={(e) => { e.preventDefault(); target === 'generate' ? setIsReferenceDragActive(true) : setIsEditDragActive(true) }}
            onDragLeave={() => { target === 'generate' ? setIsReferenceDragActive(false) : setIsEditDragActive(false) }}
            onDrop={(e) => {
              e.preventDefault()
              target === 'generate' ? setIsReferenceDragActive(false) : setIsEditDragActive(false)
              addImages(Array.from(e.dataTransfer.files || []), target)
            }}
          >
            <input
              type='file'
              multiple
              accept='image/*'
              className='hidden'
              id={`upload-${target}`}
              onChange={(e) => e.target.files && addImages(Array.from(e.target.files), target)}
            />
            <label htmlFor={`upload-${target}`} className='flex items-center justify-center w-full h-full cursor-pointer'>
              <Upload className='h-4 w-4 text-muted-foreground' />
            </label>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-dvh w-full overflow-hidden bg-background text-foreground font-sans'>

      {/* ── Left icon nav ── */}
      <nav
        className='hidden lg:flex flex-col items-center gap-1 py-4 px-2 panel-shadow-left flex-shrink-0'
        style={{ width: 60 }}
        aria-label='Workspace navigation'
      >
        {/* Logo mark */}
        <div className='mb-4 flex items-center justify-center w-9 h-9 rounded-xl bg-primary/15 border border-primary/20'>
          <Sparkles className='h-4 w-4 text-primary' aria-hidden='true' />
        </div>

        <div className='flex flex-col gap-1 flex-1'>
          {navItems.map((item) => {
            const active = workspacePage === item.key
            return (
              <Link
                key={item.key}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200',
                  active
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-white/6 hover:text-foreground'
                )}
              >
                {active && (
                  <span className='absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full' aria-hidden='true' />
                )}
                {item.icon}
                {item.count ? (
                  <span className='absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-primary/80 text-primary-foreground text-[10px] font-semibold rounded-full flex items-center justify-center px-1 leading-none'>
                    {item.count > 99 ? '99+' : item.count}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </div>

        {/* Bottom actions */}
        <div className='flex flex-col gap-1 mt-auto'>
          <button
            onClick={() => loadModels()}
            disabled={modelsLoading}
            title={t('actions.refreshModels')}
            aria-label={t('actions.refreshModels')}
            className='flex items-center justify-center w-10 h-10 rounded-xl text-muted-foreground hover:bg-white/6 hover:text-foreground transition-all duration-200 disabled:opacity-40'
          >
            <RefreshCw className={cn('h-4 w-4', modelsLoading && 'animate-spin')} />
          </button>
          <a
            href='https://github.com/qwq202/ai-img'
            target='_blank'
            rel='noopener noreferrer'
            title='GitHub'
            aria-label='GitHub repository'
            className='flex items-center justify-center w-10 h-10 rounded-xl text-muted-foreground hover:bg-white/6 hover:text-foreground transition-all duration-200'
          >
            <GitHubIcon />
          </a>
          <button
            onClick={() => setSettingsOpen(true)}
            title={t('actions.settings')}
            aria-label={t('actions.settings')}
            className='flex items-center justify-center w-10 h-10 rounded-xl text-muted-foreground hover:bg-white/6 hover:text-foreground transition-all duration-200'
          >
            <Settings className='h-4 w-4' />
          </button>
        </div>
      </nav>

      {/* ── Mobile top bar ── */}
      <header className='lg:hidden fixed top-0 inset-x-0 z-40 h-12 glass-panel flex items-center justify-between px-4'>
        <div className='flex items-center gap-2'>
          <Sparkles className='h-4 w-4 text-primary' aria-hidden='true' />
          <span className='text-sm font-semibold tracking-tight'>Gemini Studio</span>
        </div>
        <div className='flex items-center gap-1'>
          <a href='https://github.com/qwq202/ai-img' target='_blank' rel='noopener noreferrer'
            className='p-2 text-muted-foreground hover:text-foreground rounded-lg transition-colors' aria-label='GitHub'>
            <GitHubIcon />
          </a>
          <Button variant='ghost' size='icon' className='h-8 w-8' onClick={() => setMobileMenuOpen(true)} aria-label='Open menu'>
            <Menu className='h-4 w-4' />
          </Button>
        </div>
      </header>

      {/* ── Mobile slide-over menu ── */}
      {mobileMenuOpen && (
        <div className='lg:hidden fixed inset-0 z-50 flex'>
          <div className='fixed inset-0 bg-black/60 backdrop-blur-sm' onClick={() => setMobileMenuOpen(false)} aria-hidden='true' />
          <aside className='relative ml-auto w-64 h-full glass-panel flex flex-col p-4 shadow-2xl'>
            <div className='flex items-center justify-between mb-6'>
              <span className='font-semibold'>Gemini Studio</span>
              <Button variant='ghost' size='icon' className='h-8 w-8' onClick={() => setMobileMenuOpen(false)} aria-label='Close menu'>
                <X className='h-4 w-4' />
              </Button>
            </div>
            <nav className='flex flex-col gap-1 flex-1'>
              {navItems.map((item) => {
                const active = workspacePage === item.key
                return (
                  <Link key={item.key} href={item.href} onClick={() => setMobileMenuOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                      active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-white/6 hover:text-foreground'
                    )}>
                    {item.icon}
                    {item.label}
                    {item.count ? <span className='ml-auto text-xs text-muted-foreground'>{item.count}</span> : null}
                  </Link>
                )
              })}
            </nav>
            <div className='mt-auto pt-4 border-t border-white/8 flex flex-col gap-1'>
              <button onClick={() => { setSettingsOpen(true); setMobileMenuOpen(false) }}
                className='flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-white/6 hover:text-foreground transition-all duration-200'>
                <Settings className='h-4 w-4' />
                {t('actions.settings')}
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ── Studio workspace (canvas + right panel) ── */}
      {workspacePage === 'studio' && (
        <div className='flex flex-1 overflow-hidden min-w-0'>

          {/* Canvas area */}
          <main className='flex-1 min-w-0 relative flex flex-col canvas-grid overflow-hidden pt-12 lg:pt-0'>

            {/* Canvas content */}
            <div className='flex-1 min-h-0 flex items-center justify-center relative overflow-hidden'>

              {/* Loading state */}
              {loading && (
                <div className='flex flex-col items-center gap-6' role='status' aria-live='polite'>
                  <div className='relative flex items-center justify-center'>
                    <span className='absolute w-20 h-20 rounded-full border border-primary/20 animate-pulse-ring' aria-hidden='true' />
                    <span className='absolute w-14 h-14 rounded-full border border-primary/30 animate-pulse-ring' style={{ animationDelay: '0.3s' }} aria-hidden='true' />
                    <div className='w-10 h-10 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center'>
                      <Loader2 className='h-5 w-5 animate-spin text-primary' />
                    </div>
                  </div>
                  <p className='text-sm text-muted-foreground font-medium animate-pulse tracking-wide'>{loadingMessage}</p>
                </div>
              )}

              {/* Generated image */}
              {!loading && generatedImage && (
                <div className='relative w-full h-full flex items-center justify-center p-4 lg:p-8 group'>
                  {imageLoading && (
                    <div className='absolute inset-0 flex items-center justify-center z-10'>
                      <Loader2 className='h-6 w-6 animate-spin text-primary' />
                    </div>
                  )}
                  <Image
                    src={generatedImage}
                    alt={prompt || 'Generated image'}
                    width={1024}
                    height={1024}
                    unoptimized
                    onLoad={() => setImageLoading(false)}
                    onClick={() => setPreviewImage(generatedImage)}
                    className={cn(
                      'max-w-full max-h-full object-contain rounded-xl shadow-2xl cursor-zoom-in transition-opacity duration-500',
                      imageLoading ? 'opacity-0' : 'opacity-100'
                    )}
                  />
                  {/* Floating image actions */}
                  {!imageLoading && (
                    <div className='absolute top-6 right-6 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0'>
                      <button onClick={() => setPreviewImage(generatedImage)}
                        className='w-9 h-9 glass-panel rounded-xl flex items-center justify-center text-foreground/80 hover:text-foreground hover:bg-white/10 transition-all duration-150'
                        aria-label='Fullscreen preview'>
                        <Maximize2 className='h-4 w-4' />
                      </button>
                      <button onClick={handleCopyImage}
                        className='w-9 h-9 glass-panel rounded-xl flex items-center justify-center text-foreground/80 hover:text-foreground hover:bg-white/10 transition-all duration-150'
                        aria-label='Copy image'>
                        <Copy className='h-4 w-4' />
                      </button>
                      <button onClick={handleDownload}
                        className='w-9 h-9 glass-panel rounded-xl flex items-center justify-center text-foreground/80 hover:text-foreground hover:bg-white/10 transition-all duration-150'
                        aria-label='Download image'>
                        <Download className='h-4 w-4' />
                      </button>
                      {autoSaveToHistory && (
                        <button onClick={() => saveGeneratedImageToHistory({ image: generatedImage, text: generatedText, prompt, mode, model: mode === 'generate' ? generateModel : editModel })}
                          className='w-9 h-9 glass-panel rounded-xl flex items-center justify-center text-foreground/80 hover:text-foreground hover:bg-white/10 transition-all duration-150'
                          aria-label='Save to history'>
                          <History className='h-4 w-4' />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Empty state */}
              {!loading && !generatedImage && (
                <div className='flex flex-col items-center gap-4 text-center px-8 select-none'>
                  <div className='relative'>
                    <div className='w-20 h-20 rounded-2xl bg-primary/8 border border-primary/15 flex items-center justify-center'>
                      <Sparkles className='h-9 w-9 text-primary/40' />
                    </div>
                    <div className='absolute inset-0 rounded-2xl animate-shimmer' aria-hidden='true' />
                  </div>
                  <div>
                    <p className='text-base font-medium text-foreground/60'>{t('messages.noContent')}</p>
                    <p className='text-sm text-muted-foreground mt-1'>
                      {!apiKey ? t('messages.fillApi') : (mode === 'generate' ? t('placeholders.promptGenerate') : t('placeholders.promptEdit'))}
                    </p>
                  </div>
                  {!apiKey && (
                    <button
                      onClick={() => setSettingsOpen(true)}
                      className='mt-1 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 text-primary text-sm font-medium hover:bg-primary/15 transition-colors'
                    >
                      {t('actions.settings')}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Generated text response */}
            {generatedText && !loading && (
              <div className='mx-4 mb-4 lg:mx-8 p-4 glass-panel rounded-xl text-sm text-foreground/80 leading-relaxed max-h-32 overflow-y-auto'>
                {generatedText}
              </div>
            )}

            {/* Batch results thumbnail strip */}
            {mode === 'generate' && batchResults.length > 1 && !loading && (
              <div className='mx-4 mb-4 lg:mx-8 flex gap-2 overflow-x-auto scrollbar-hide pb-1'>
                {batchResults.map((image, index) => (
                  <button
                    key={`${image.slice(0, 32)}_${index}`}
                    type='button'
                    onClick={() => setGeneratedImage(image)}
                    aria-label={`Select result ${index + 1}`}
                    className={cn(
                      'relative flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden border transition-all duration-150',
                      generatedImage === image
                        ? 'border-primary shadow-[0_0_0_2px] shadow-primary/40'
                        : 'border-white/10 hover:border-white/25'
                    )}
                  >
                    <Image src={image} alt={`result-${index + 1}`} fill className='object-cover' />
                    <span className='absolute left-1 bottom-1 text-[9px] font-bold text-white bg-black/60 px-1 rounded leading-none py-0.5'>
                      {index + 1}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Floating prompt bar */}
            <div className='absolute bottom-5 left-1/2 -translate-x-1/2 w-[min(820px,calc(100vw-2rem))] z-20'>
              <div className='prompt-bar rounded-2xl px-3 py-2.5 flex items-end gap-2 shadow-2xl'>
                {/* Mode toggle capsule */}
                <div className='flex-shrink-0 flex items-center bg-white/6 rounded-xl p-0.5 self-center' role='group' aria-label='Generation mode'>
                  <button
                    onClick={() => setMode('generate')}
                    className={cn(
                      'px-3 py-1.5 text-xs font-semibold rounded-[10px] transition-all duration-200',
                      mode === 'generate'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    aria-pressed={mode === 'generate'}
                  >
                    {t('modes.generate')}
                  </button>
                  <button
                    onClick={() => setMode('edit')}
                    className={cn(
                      'px-3 py-1.5 text-xs font-semibold rounded-[10px] transition-all duration-200',
                      mode === 'edit'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    aria-pressed={mode === 'edit'}
                  >
                    {t('modes.edit')}
                  </button>
                </div>

                {/* Textarea */}
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={mode === 'generate' ? t('placeholders.promptGenerate') : t('placeholders.promptEdit')}
                  rows={1}
                  className='flex-1 min-h-[36px] max-h-[180px] resize-none bg-transparent border-none outline-none shadow-none focus-visible:ring-0 text-sm text-foreground placeholder:text-muted-foreground py-2 px-1 leading-relaxed'
                  aria-label={mode === 'generate' ? t('labels.prompt') : t('labels.editInstruction')}
                />

                {/* Optimize button */}
                <button
                  onClick={handleOptimizePrompt}
                  disabled={optimizing || !prompt.trim()}
                  title={t('hints.promptOptimizer')}
                  aria-label={t('actions.optimize')}
                  className='flex-shrink-0 self-center w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/8 disabled:opacity-30 transition-all duration-150'
                >
                  <Wand2 className={cn('h-4 w-4', optimizing && 'animate-spin')} />
                </button>

                {/* Generate button */}
                <button
                  onClick={mode === 'generate' ? handleGenerate : handleEdit}
                  disabled={loading}
                  aria-label={t('actions.generate')}
                  className='flex-shrink-0 self-center h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-1.5 hover:brightness-110 active:scale-95 disabled:opacity-50 transition-all duration-150 shadow-[0_2px_12px] shadow-primary/30'
                >
                  {loading
                    ? <Loader2 className='h-4 w-4 animate-spin' />
                    : <Sparkles className='h-4 w-4' />
                  }
                  <span className='hidden sm:inline'>{loading ? t('messages.processing') : t('actions.generate')}</span>
                </button>
              </div>

              {/* Keyboard hint */}
              <p className='text-center mt-1.5 text-[10px] text-muted-foreground opacity-50 select-none'>
                <kbd className='font-mono'>⌘</kbd> + <kbd className='font-mono'>Enter</kbd> {t('actions.generate')}
              </p>
            </div>
          </main>

          {/* Right params panel */}
          <aside
            className={cn(
              'hidden lg:flex flex-col flex-shrink-0 panel-shadow-right overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
              'w-[300px]'
            )}
            aria-label='Generation parameters'
          >
            <div className='flex-1 overflow-y-auto p-4 space-y-5 pb-36'>
              {/* Header */}
              <div className='flex items-center justify-between pt-1'>
                <p className='text-[10px] font-semibold uppercase tracking-widest text-muted-foreground'>Parameters</p>
                <button onClick={handleClearCreativeParams}
                  className='text-[10px] text-muted-foreground hover:text-foreground transition-colors'
                  title={t('actions.clear')} aria-label={t('actions.clear')}>
                  {t('actions.clear')}
                </button>
              </div>

              {/* Model select */}
              <div className='space-y-1.5'>
                <Label className='text-xs text-muted-foreground'>{t('labels.model')}</Label>
                <Select
                  value={mode === 'generate' ? generateModel : editModel}
                  onValueChange={mode === 'generate' ? setGenerateModel : setEditModel}
                >
                  <SelectTrigger className='h-9 text-xs bg-white/5 border-white/10 focus:ring-primary/30'>
                    <SelectValue placeholder={t('placeholders.selectModel')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(mode === 'generate' ? generateModels : editModels).map((m) => (
                      <SelectItem key={m.id} value={m.id} className='text-xs'>{m.displayName || m.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Aspect ratio */}
              <div className='space-y-1.5'>
                <Label className='text-xs text-muted-foreground'>{t('labels.ratio')}</Label>
                <div className='flex flex-wrap gap-1.5'>
                  {availableAspectRatios.slice(0, 8).map((r) => (
                    <button
                      key={r}
                      onClick={() => activeCapabilities.supportsAspectRatio && setAspectRatio(r)}
                      disabled={!activeCapabilities.supportsAspectRatio}
                      aria-pressed={aspectRatio === r}
                      className={cn(
                        'px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all duration-150',
                        aspectRatio === r && activeCapabilities.supportsAspectRatio
                          ? 'bg-primary/15 border-primary/40 text-primary'
                          : 'border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground',
                        !activeCapabilities.supportsAspectRatio && 'opacity-30 cursor-not-allowed'
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Resolution */}
              <div className='space-y-1.5'>
                <Label className='text-xs text-muted-foreground'>{t('labels.resolution')}</Label>
                <div className='flex gap-1.5'>
                  {availableImageSizes.map((size) => (
                    <button
                      key={size}
                      onClick={() => (activeCapabilities.supportsImageSize && !activeCapabilities.forcedImageSize) && setImageSize(size)}
                      disabled={!activeCapabilities.supportsImageSize || !!activeCapabilities.forcedImageSize}
                      aria-pressed={imageSize === size}
                      className={cn(
                        'flex-1 py-1.5 text-[11px] font-medium rounded-lg border transition-all duration-150',
                        imageSize === size && activeCapabilities.supportsImageSize
                          ? 'bg-primary/15 border-primary/40 text-primary'
                          : 'border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground',
                        (!activeCapabilities.supportsImageSize || !!activeCapabilities.forcedImageSize) && 'opacity-30 cursor-not-allowed'
                      )}
                    >
                      {IMAGE_SIZE_LABELS[size] || size}
                    </button>
                  ))}
                </div>
                {activeCapabilities.forcedImageSize && (
                  <p className='text-[10px] text-muted-foreground'>
                    {IMAGE_SIZE_LABELS[activeCapabilities.forcedImageSize] || activeCapabilities.forcedImageSize}
                  </p>
                )}
              </div>

              {/* Advanced toggles — generate mode only */}
              {mode === 'generate' && (
                <div className='space-y-2'>
                  <p className='text-[10px] font-semibold uppercase tracking-widest text-muted-foreground'>Advanced</p>

                  {/* Google Search */}
                  <div className={cn(
                    'flex items-center justify-between p-3 rounded-xl border transition-all duration-150',
                    selectedGenerateCapabilities.supportsSearchGrounding
                      ? 'border-white/10 hover:border-white/18 bg-white/3'
                      : 'border-white/6 bg-white/2 opacity-40 cursor-not-allowed'
                  )}>
                    <div>
                      <Label htmlFor='google-search' className={cn('text-xs font-medium cursor-pointer', !selectedGenerateCapabilities.supportsSearchGrounding && 'cursor-not-allowed')}>
                        {t('labels.googleSearch')}
                      </Label>
                      <p className='text-[10px] text-muted-foreground mt-0.5'>
                        {selectedGenerateCapabilities.supportsSearchGrounding ? t('hints.imageSearchHint') : t('hints.searchNotSupported')}
                      </p>
                    </div>
                    <Switch id='google-search' checked={useGoogleSearch} onCheckedChange={setUseGoogleSearch} disabled={!selectedGenerateCapabilities.supportsSearchGrounding} />
                  </div>

                  {/* Google Image Search */}
                  <div className={cn(
                    'flex items-center justify-between p-3 rounded-xl border transition-all duration-150',
                    selectedGenerateCapabilities.supportsImageSearchGrounding
                      ? 'border-white/10 hover:border-white/18 bg-white/3'
                      : 'border-white/6 bg-white/2 opacity-40 cursor-not-allowed'
                  )}>
                    <div>
                      <Label htmlFor='google-img-search' className={cn('text-xs font-medium cursor-pointer', !selectedGenerateCapabilities.supportsImageSearchGrounding && 'cursor-not-allowed')}>
                        {t('labels.googleImageSearch')}
                      </Label>
                      <p className='text-[10px] text-muted-foreground mt-0.5'>
                        {selectedGenerateCapabilities.supportsImageSearchGrounding ? t('hints.imageSearchHint') : t('hints.imageSearchNotSupported')}
                      </p>
                    </div>
                    <Switch id='google-img-search' checked={useGoogleImageSearch} onCheckedChange={setUseGoogleImageSearch} disabled={!selectedGenerateCapabilities.supportsImageSearchGrounding} />
                  </div>

                  {/* Thinking level */}
                  <div className={cn(
                    'space-y-2 p-3 rounded-xl border transition-all duration-150',
                    selectedGenerateCapabilities.supportsThinkingConfig
                      ? 'border-white/10 bg-white/3'
                      : 'border-white/6 bg-white/2 opacity-40'
                  )}>
                    <Label className='text-xs font-medium'>{t('labels.thinkingLevel')}</Label>
                    <Select value={thinkingLevel} onValueChange={(v) => setThinkingLevel(v as 'minimal' | 'high')} disabled={!selectedGenerateCapabilities.supportsThinkingConfig}>
                      <SelectTrigger className='h-8 text-xs bg-white/5 border-white/10'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='minimal' className='text-xs'>{t('placeholders.auto')}</SelectItem>
                        <SelectItem value='high' className='text-xs'>High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Generate count */}
                  <div className='flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/3'>
                    <div>
                      <Label htmlFor='generate-count' className='text-xs font-medium'>{t('labels.generateCount')}</Label>
                      <p className='text-[10px] text-muted-foreground mt-0.5'>{t('hints.generateCountHint')}</p>
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
                      className='w-16 h-8 text-xs text-center bg-white/5 border-white/10 focus:ring-primary/30'
                    />
                  </div>
                </div>
              )}

              {/* Reference / edit images */}
              <ImageUploadZone target={mode} />
            </div>
          </aside>
        </div>
      )}

      {/* ── History page ── */}
      {workspacePage === 'history' && (
        <main className='flex-1 min-w-0 overflow-y-auto p-6 pt-16 lg:pt-6'>
          <div className='max-w-[1400px] mx-auto'>
            {/* Header */}
            <div className='flex flex-wrap items-center gap-3 mb-6'>
              <h1 className='text-xl font-bold'>{t('nav.history')}</h1>
              <span className='text-sm text-muted-foreground'>{t('messages.historyCount', { count: historyItems.length })}</span>

              {historyItems.length > 0 && (
                <>
                  <select
                    value={historySortMode}
                    onChange={(e) => {
                      const m = e.target.value as 'time' | 'custom'
                      setHistorySortMode(m)
                      if (m === 'custom') setHistoryCustomOrder(historyItems.map((i) => i.id))
                    }}
                    className='ml-auto text-xs bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-foreground'
                    aria-label='Sort mode'
                  >
                    <option value='time'>{t('labels.sortByTime')}</option>
                    <option value='custom'>{t('labels.sortByCustom')}</option>
                  </select>

                  <Button
                    variant={isSelectionMode ? 'default' : 'outline'}
                    size='sm'
                    onClick={() => { setIsSelectionMode(!isSelectionMode); if (isSelectionMode) setSelectedHistoryIds(new Set()) }}
                    className='h-8 text-xs'
                  >
                    {isSelectionMode ? t('actions.cancel') : t('actions.select')}
                  </Button>
                </>
              )}
            </div>

            {/* Batch action bar */}
            {isSelectionMode && selectedHistoryIds.size > 0 && (
              <div className='mb-4 flex items-center gap-2 p-3 glass-panel rounded-xl'>
                <Button variant='outline' size='sm' onClick={toggleSelectAll} className='h-7 text-xs'>
                  {selectedHistoryIds.size === historyItems.length ? t('actions.deselectAll') : t('actions.selectAll')}
                </Button>
                <span className='text-xs text-muted-foreground'>{t('messages.selectedCount', { count: selectedHistoryIds.size })}</span>
                <Button
                  variant='destructive' size='sm'
                  onClick={() => { if (window.confirm(t('messages.confirmBatchDelete', { count: selectedHistoryIds.size }))) batchDeleteSelected() }}
                  className='h-7 text-xs ml-auto'
                >
                  <Trash2 className='h-3 w-3 mr-1' />
                  {t('actions.delete')} ({selectedHistoryIds.size})
                </Button>
              </div>
            )}

            {/* Grid */}
            <DndContext sensors={undefined} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sortedHistoryItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3'>
                  {sortedHistoryItems.map((item) => {
                    const isSelected = selectedHistoryIds.has(item.id)
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'group relative rounded-xl overflow-hidden border transition-all duration-200 hover-lift',
                          isSelectionMode && isSelected
                            ? 'border-primary ring-2 ring-primary/30 bg-primary/5'
                            : 'border-white/8 hover:border-white/20 bg-white/3',
                          historySortMode === 'custom' && 'cursor-grab active:cursor-grabbing'
                        )}
                      >
                        <div className='aspect-square relative'>
                          <Image src={item.image} alt={item.prompt || 'history item'} fill className='object-cover' />

                          {/* Selection overlay */}
                          {isSelectionMode && (
                            <button
                              type='button'
                              className='absolute inset-0 z-10 cursor-pointer'
                              onClick={() => setSelectedHistoryIds((prev) => {
                                const next = new Set(prev)
                                next.has(item.id) ? next.delete(item.id) : next.add(item.id)
                                return next
                              })}
                              aria-label={isSelected ? 'Deselect' : 'Select'}
                            >
                              <div className='absolute top-2 left-2'>
                                {isSelected
                                  ? <CheckSquare className='h-5 w-5 text-primary drop-shadow' />
                                  : <Square className='h-5 w-5 text-white/60 drop-shadow' />
                                }
                              </div>
                            </button>
                          )}

                          {/* Drag handle */}
                          {!isSelectionMode && historySortMode === 'custom' && (
                            <div className='absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity'>
                              <GripVertical className='h-4 w-4 text-white drop-shadow' />
                            </div>
                          )}

                          {/* Hover action bar */}
                          {!isSelectionMode && (
                            <div className='absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 p-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity'>
                              <button
                                onClick={() => { setGeneratedImage(item.image); setGeneratedText(item.text || ''); setMode(item.mode); router.push('/') }}
                                className='w-8 h-8 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/25 transition-colors'
                                aria-label='Use in studio'
                              >
                                <Undo2 className='h-3.5 w-3.5' />
                              </button>
                              <button
                                onClick={() => moveHistoryItemToTrash(item.id)}
                                className='w-8 h-8 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center text-white hover:bg-red-500/50 transition-colors'
                                aria-label='Move to trash'
                              >
                                <Trash2 className='h-3.5 w-3.5' />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(item.prompt); setNotice(t('messages.promptCopied')) }}
                                className='w-8 h-8 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/25 transition-colors'
                                aria-label='Copy prompt'
                              >
                                <Copy className='h-3.5 w-3.5' />
                              </button>
                            </div>
                          )}
                        </div>

                        <div className='px-2 py-1.5'>
                          <p className='text-[9px] text-muted-foreground uppercase font-semibold truncate tracking-wide'>{item.model}</p>
                          <p className='text-[11px] text-foreground/70 truncate mt-0.5 leading-tight'>{item.prompt}</p>
                        </div>
                      </div>
                    )
                  })}

                  {historyItems.length === 0 && (
                    <div className='col-span-full flex flex-col items-center justify-center py-24 text-muted-foreground gap-3'>
                      <div className='w-16 h-16 rounded-2xl bg-white/4 border border-white/8 flex items-center justify-center'>
                        <History className='h-7 w-7 opacity-30' />
                      </div>
                      <p className='text-sm font-medium'>{t('messages.noHistory')}</p>
                      <p className='text-xs opacity-60'>{t('messages.noHistoryHint')}</p>
                    </div>
                  )}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </main>
      )}

      {/* ── Trash page ── */}
      {workspacePage === 'trash' && (
        <main className='flex-1 min-w-0 overflow-y-auto p-6 pt-16 lg:pt-6'>
          <div className='max-w-[1400px] mx-auto'>
            <div className='flex items-center justify-between mb-6'>
              <div>
                <h1 className='text-xl font-bold'>{t('nav.trash')}</h1>
                <p className='text-xs text-muted-foreground mt-0.5'>{trashItems.length} {t('nav.trash').toLowerCase()}</p>
              </div>
              <Button
                variant='outline'
                size='sm'
                className='border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20'
                onClick={() => { if (window.confirm(t('messages.confirmClearTrash'))) clearTrash() }}
                disabled={trashItems.length === 0}
              >
                {t('actions.clear')}
              </Button>
            </div>

            <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3'>
              {trashItems.map((item) => (
                <div key={item.id} className='group relative rounded-xl overflow-hidden border border-white/6 bg-white/2 opacity-60 hover:opacity-100 transition-all duration-200 hover-lift'>
                  <div className='aspect-square relative'>
                    <Image src={item.image} alt={item.prompt || 'trash item'} fill className='object-cover grayscale group-hover:grayscale-0 transition-all duration-300' />
                    <div className='absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/40'>
                      <button
                        onClick={() => restoreTrashItem(item.id)}
                        className='w-9 h-9 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/25 transition-colors'
                        aria-label='Restore'
                      >
                        <RotateCcw className='h-4 w-4' />
                      </button>
                      <button
                        onClick={() => deleteTrashItemPermanently(item.id)}
                        className='w-9 h-9 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center text-white hover:bg-red-500/50 transition-colors'
                        aria-label='Delete permanently'
                      >
                        <X className='h-4 w-4' />
                      </button>
                    </div>
                  </div>
                  <div className='px-2 py-1.5'>
                    <p className='text-[11px] text-muted-foreground truncate'>{item.prompt}</p>
                  </div>
                </div>
              ))}

              {trashItems.length === 0 && (
                <div className='col-span-full flex flex-col items-center justify-center py-24 text-muted-foreground gap-3'>
                  <div className='w-16 h-16 rounded-2xl bg-white/4 border border-white/8 flex items-center justify-center'>
                    <Trash2 className='h-7 w-7 opacity-30' />
                  </div>
                  <p className='text-sm font-medium'>{t('messages.trashEmpty')}</p>
                  <p className='text-xs opacity-60'>{t('messages.trashHint')}</p>
                </div>
              )}
            </div>
          </div>
        </main>
      )}

      {/* ── Mobile bottom nav ── */}
      <nav className='lg:hidden fixed bottom-0 inset-x-0 z-30 h-16 glass-panel flex items-center justify-around px-4' aria-label='Mobile navigation'>
        {navItems.map((item) => {
          const active = workspacePage === item.key
          return (
            <Link key={item.key} href={item.href}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all duration-200',
                active ? 'text-primary' : 'text-muted-foreground'
              )}>
              <div className='relative'>
                {item.icon}
                {item.count ? (
                  <span className='absolute -top-1 -right-1.5 min-w-[14px] h-3.5 bg-primary text-primary-foreground text-[9px] font-bold rounded-full flex items-center justify-center px-1'>
                    {item.count}
                  </span>
                ) : null}
              </div>
              <span className='text-[9px] font-semibold'>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* ── Toast notification ── */}
      {(error || notice) && (
        <div
          role='alert'
          aria-live='assertive'
          className='fixed bottom-20 lg:bottom-6 right-4 lg:right-6 z-[120] max-w-sm px-4 py-3 glass-panel rounded-xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-4 fade-in duration-200'
        >
          {error
            ? <AlertCircle className='h-4 w-4 text-destructive flex-shrink-0' aria-hidden='true' />
            : <CheckCircle2 className='h-4 w-4 text-green-400 flex-shrink-0' aria-hidden='true' />
          }
          <span className='text-sm font-medium flex-1'>{error || notice}</span>
          <button onClick={() => { setError(''); setNotice('') }} className='text-muted-foreground hover:text-foreground flex-shrink-0 transition-colors' aria-label='Dismiss'>
            <X className='h-4 w-4' />
          </button>
        </div>
      )}

      {/* ── Update available banner ── */}
      {updateAvailable && (
        <div className='fixed top-14 lg:top-4 right-4 z-50 glass-panel rounded-xl p-3 shadow-2xl flex items-center gap-3 max-w-xs animate-in slide-in-from-top-4 fade-in duration-200'>
          <Sparkles className='h-4 w-4 text-primary flex-shrink-0' aria-hidden='true' />
          <p className='text-xs text-foreground/80 flex-1'>{t('messages.updateAvailable', { version: latestVersion })}</p>
          <a href='https://github.com/qwq202/ai-img/releases' target='_blank' rel='noopener noreferrer'
            className='text-xs text-primary hover:text-primary/80 underline flex-shrink-0'>{t('messages.viewUpdate')}</a>
          <button onClick={() => setUpdateAvailable(false)} className='text-muted-foreground hover:text-foreground flex-shrink-0 transition-colors' aria-label='Dismiss update notice'>
            <X className='h-3.5 w-3.5' />
          </button>
        </div>
      )}

      {/* ── Settings drawer ── */}
      {settingsOpen && (
        <div className='fixed inset-0 z-[60] flex justify-end' onClick={() => setSettingsOpen(false)}>
          <div className='absolute inset-0 bg-black/50 backdrop-blur-sm' aria-hidden='true' />
          <aside
            className='relative w-full max-w-[360px] h-full glass-panel shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right-8 duration-300'
            onClick={(e) => e.stopPropagation()}
            aria-label='Settings'
          >
            {/* Drawer header */}
            <div className='flex items-center justify-between p-5 border-b border-white/8'>
              <div>
                <h2 className='text-base font-semibold'>{t('settings.title')}</h2>
                <p className='text-[10px] text-muted-foreground mt-0.5'>v{CURRENT_VERSION}</p>
              </div>
              <button onClick={() => setSettingsOpen(false)}
                className='w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/8 transition-all'
                aria-label='Close settings'>
                <X className='h-4 w-4' />
              </button>
            </div>

            {/* Settings body */}
            <div className='flex-1 overflow-y-auto p-5 space-y-5'>
              {/* API config */}
              <div className='space-y-3'>
                <p className='text-[10px] font-semibold uppercase tracking-widest text-muted-foreground'>API</p>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>{t('settings.apiKey')}</Label>
                  <Input type='password' value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                    placeholder={t('placeholders.apiKeyPlaceholder')}
                    className='h-9 text-xs bg-white/5 border-white/10 focus:ring-primary/30' />
                </div>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>{t('settings.apiUrl')}</Label>
                  <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)}
                    placeholder={t('placeholders.apiUrlPlaceholder')}
                    className='h-9 text-xs bg-white/5 border-white/10 focus:ring-primary/30' />
                </div>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>{t('settings.promptOptimizerModel')}</Label>
                  <Select value={optimizeModel} onValueChange={setOptimizeModel}>
                    <SelectTrigger className='h-9 text-xs bg-white/5 border-white/10'>
                      <SelectValue placeholder={t('settings.selectModel')} />
                    </SelectTrigger>
                    <SelectContent>
                      {promptModels.map((m) => <SelectItem key={m} value={m} className='text-xs'>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Preferences */}
              <div className='space-y-3'>
                <p className='text-[10px] font-semibold uppercase tracking-widest text-muted-foreground'>Preferences</p>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>{t('settings.language')}</Label>
                  <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
                    <SelectTrigger className='h-9 text-xs bg-white/5 border-white/10'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='zh-CN' className='text-xs'>中文</SelectItem>
                      <SelectItem value='en' className='text-xs'>English</SelectItem>
                      <SelectItem value='ja' className='text-xs'>日本語</SelectItem>
                      <SelectItem value='ko' className='text-xs'>한국어</SelectItem>
                      <SelectItem value='fr' className='text-xs'>Français</SelectItem>
                      <SelectItem value='de' className='text-xs'>Deutsch</SelectItem>
                      <SelectItem value='es' className='text-xs'>Español</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className='flex items-center justify-between p-3 rounded-xl border border-white/8 bg-white/3'>
                  <div>
                    <Label className='text-xs font-medium'>{t('settings.autoSaveToHistory')}</Label>
                    <p className='text-[10px] text-muted-foreground mt-0.5'>{t('hints.autoSaveHint')}</p>
                  </div>
                  <Switch checked={autoSaveToHistory} onCheckedChange={setAutoSaveToHistory} />
                </div>
                <div className='flex items-center justify-between p-3 rounded-xl border border-white/8 bg-white/3'>
                  <Label className='text-xs font-medium'>{t('settings.debugMode')}</Label>
                  <Switch checked={debugEnabled} onCheckedChange={setDebugEnabled} />
                </div>
              </div>
            </div>

            {/* Drawer footer actions */}
            <div className='p-5 border-t border-white/8 flex gap-3'>
              <Button variant='outline' className='flex-1 h-9 text-xs border-white/10 hover:border-white/20' onClick={handleTestConnection} disabled={connectionTesting}>
                {connectionTesting ? <Loader2 className='h-3.5 w-3.5 animate-spin mr-1.5' /> : null}
                {connectionTesting ? t('actions.testing') : t('actions.test')}
              </Button>
              <Button className='flex-1 h-9 text-xs bg-primary hover:brightness-110' onClick={handleSaveSettings}>
                {t('actions.save')}
              </Button>
            </div>
          </aside>
        </div>
      )}

      {/* ── Fullscreen image preview ── */}
      {previewImage && (
        <div
          className='fixed inset-0 z-[100] bg-black/95 flex items-center justify-center backdrop-blur-md'
          onClick={() => setPreviewImage(null)}
          role='dialog'
          aria-modal='true'
          aria-label='Image preview'
        >
          <button
            className='absolute top-4 right-4 w-10 h-10 glass-panel rounded-xl flex items-center justify-center text-foreground/80 hover:text-foreground hover:bg-white/10 transition-all'
            onClick={() => setPreviewImage(null)}
            aria-label='Close preview'
          >
            <X className='h-5 w-5' />
          </button>
          <Image
            src={previewImage}
            alt='Full preview'
            width={2048}
            height={2048}
            unoptimized
            className='max-w-[95vw] max-h-[95vh] h-auto w-auto object-contain rounded-xl shadow-2xl'
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

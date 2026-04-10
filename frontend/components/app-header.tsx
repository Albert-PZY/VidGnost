"use client"

import * as React from "react"
import {
  Github,
  Languages,
  Maximize2,
  Minimize2,
  Minus,
  Monitor,
  Moon,
  Settings,
  Square,
  Sun,
  X,
} from "lucide-react"
import { useTheme } from "next-themes"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

interface AppHeaderProps {
  title?: string
  subtitle?: string
  language: "zh" | "en"
  onLanguageChange: (language: "zh" | "en") => void
  onOpenSettings: () => void
  onRequestClose: () => void
}

const PROJECT_REPOSITORY_URL = "https://github.com/Albert-PZY/VidGnost"
const dragRegionStyle = { WebkitAppRegion: "drag" } as React.CSSProperties
const noDragRegionStyle = { WebkitAppRegion: "no-drag" } as React.CSSProperties

export function AppHeader({
  title,
  subtitle,
  language,
  onLanguageChange,
  onOpenSettings,
  onRequestClose,
}: AppHeaderProps) {
  const { setTheme } = useTheme()
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [isDesktopShell, setIsDesktopShell] = React.useState(false)
  const [isMaximized, setIsMaximized] = React.useState(false)

  const openProjectRepository = React.useCallback(async () => {
    if (window.vidGnostDesktop?.openExternal) {
      const result = await window.vidGnostDesktop.openExternal(PROJECT_REPOSITORY_URL)
      if (!result.ok) {
        throw new Error(result.message || "打开项目地址失败")
      }
      return
    }
    window.open(PROJECT_REPOSITORY_URL, "_blank", "noopener,noreferrer")
  }, [])

  const toggleFullscreen = React.useCallback(() => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen()
      setIsFullscreen(true)
      return
    }
    void document.exitFullscreen()
    setIsFullscreen(false)
  }, [])

  const toggleWindowMaximize = React.useCallback(async () => {
    if (!window.vidGnostDesktop?.toggleMaximizeWindow) {
      return
    }
    const nextState = await window.vidGnostDesktop.toggleMaximizeWindow()
    setIsMaximized(nextState.isMaximized)
  }, [])

  React.useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange)
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
    }
  }, [])

  React.useEffect(() => {
    const desktopApi = window.vidGnostDesktop
    if (!desktopApi) {
      return
    }
    setIsDesktopShell(true)
    let disposed = false

    void desktopApi.getWindowState?.().then((state) => {
      if (!disposed) {
        setIsMaximized(state.isMaximized)
      }
    })

    const unsubscribe = desktopApi.onWindowStateChange?.((state) => {
      if (!disposed) {
        setIsMaximized(state.isMaximized)
      }
    })

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  return (
    <header
      style={dragRegionStyle}
      className="flex h-14 shrink-0 select-none items-center gap-3 border-b border-[var(--titlebar-border)] bg-[var(--titlebar)] px-4"
    >
      <div style={noDragRegionStyle}>
        <SidebarTrigger className="-ml-1 hover:bg-background/70" />
      </div>
      <Separator orientation="vertical" className="mr-1 h-4 bg-foreground/10" />

      <div className="flex min-w-0 flex-col">
        {title ? <h1 className="truncate text-sm font-medium leading-none">{title}</h1> : null}
        {subtitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>

      <div className="flex-1" />

      <div style={noDragRegionStyle} className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-background/70">
              <Languages className="h-4 w-4" />
              <span className="sr-only">切换语言</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onLanguageChange("zh")}>
              <span className={language === "zh" ? "font-medium" : ""}>中文</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onLanguageChange("en")}>
              <span className={language === "en" ? "font-medium" : ""}>English</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-8 w-8 hover:bg-background/70">
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">切换主题</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun className="mr-2 h-4 w-4" />
              浅色
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon className="mr-2 h-4 w-4" />
              深色
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Monitor className="mr-2 h-4 w-4" />
              跟随系统
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-background/70"
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          <span className="sr-only">切换全屏</span>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-background/70"
          onClick={() => {
            void openProjectRepository().catch((error) => {
              toast.error(error instanceof Error ? error.message : "打开项目地址失败")
            })
          }}
        >
          <Github className="h-4 w-4" />
          <span className="sr-only">打开项目地址</span>
        </Button>

        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-background/70" onClick={onOpenSettings}>
          <Settings className="h-4 w-4" />
          <span className="sr-only">打开设置中心</span>
        </Button>

        {isDesktopShell ? (
          <>
            <span className="px-1 text-sm text-muted-foreground">|</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md hover:bg-background/70"
              onClick={() => {
                void window.vidGnostDesktop?.minimizeWindow?.()
              }}
            >
              <Minus className="h-4 w-4" />
              <span className="sr-only">最小化窗口</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md hover:bg-background/70"
              onClick={() => {
                void toggleWindowMaximize()
              }}
            >
              {isMaximized ? <Square className="h-3.5 w-3.5" /> : <Maximize2 className="h-4 w-4" />}
              <span className="sr-only">切换窗口最大化</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md hover:bg-destructive/15 hover:text-destructive"
              onClick={onRequestClose}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">关闭应用</span>
            </Button>
          </>
        ) : null}
      </div>
    </header>
  )
}

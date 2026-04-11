"use client"

import * as React from "react"
import {
  Check,
  Github,
  Languages,
  Maximize2,
  Minus,
  Monitor,
  Moon,
  Settings,
  Square,
  Sun,
  X,
} from "lucide-react"
import { useTheme } from "next-themes"
import { toast } from "react-hot-toast"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

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
const titlebarButtonClass =
  "h-7 w-7 rounded-md transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"

export function AppHeader({
  title,
  subtitle,
  language,
  onLanguageChange,
  onOpenSettings,
  onRequestClose,
}: AppHeaderProps) {
  const { theme, setTheme } = useTheme()
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

  const toggleWindowMaximize = React.useCallback(async () => {
    if (!window.vidGnostDesktop?.toggleMaximizeWindow) {
      return
    }
    const nextState = await window.vidGnostDesktop.toggleMaximizeWindow()
    setIsMaximized(nextState.isMaximized)
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
      className="app-header-shell sticky top-0 z-40 flex h-10 shrink-0 select-none items-center gap-1.5 border-b border-[color:var(--titlebar-border)] bg-[color:var(--titlebar)]/95 px-3 backdrop-blur-sm"
    >
      <div style={noDragRegionStyle}>
        <SidebarTrigger className={cn("-ml-1", titlebarButtonClass)} />
      </div>
      <Separator orientation="vertical" className="mr-1 h-3.5 bg-foreground/10" />

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {title ? <h1 className="truncate text-sm font-medium leading-none tracking-tight">{title}</h1> : null}
        {title && subtitle ? <span className="shrink-0 text-[11px] text-muted-foreground/70">/</span> : null}
        {subtitle ? <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p> : null}
      </div>

      <div style={noDragRegionStyle} className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={titlebarButtonClass}>
              <Languages className="h-4 w-4" />
              <span className="sr-only">切换语言</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className={cn(
                "flex items-center justify-between gap-3 rounded-md",
                language === "zh" && "bg-accent text-accent-foreground",
              )}
              onClick={() => onLanguageChange("zh")}
            >
              <span className={language === "zh" ? "font-medium" : ""}>中文</span>
              <Check className={cn("h-4 w-4 opacity-0", language === "zh" && "opacity-100")} />
            </DropdownMenuItem>
            <DropdownMenuItem
              className={cn(
                "flex items-center justify-between gap-3 rounded-md",
                language === "en" && "bg-accent text-accent-foreground",
              )}
              onClick={() => onLanguageChange("en")}
            >
              <span className={language === "en" ? "font-medium" : ""}>English</span>
              <Check className={cn("h-4 w-4 opacity-0", language === "en" && "opacity-100")} />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={cn("relative", titlebarButtonClass)}>
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">切换主题</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className={cn(
                "flex items-center justify-between gap-3 rounded-md",
                theme === "light" && "bg-accent text-accent-foreground",
              )}
              onClick={() => setTheme("light")}
            >
              <div className="flex items-center gap-2">
              <Sun className="mr-2 h-4 w-4" />
              浅色
              </div>
              <Check className={cn("h-4 w-4 opacity-0", theme === "light" && "opacity-100")} />
            </DropdownMenuItem>
            <DropdownMenuItem
              className={cn(
                "flex items-center justify-between gap-3 rounded-md",
                theme === "dark" && "bg-accent text-accent-foreground",
              )}
              onClick={() => setTheme("dark")}
            >
              <div className="flex items-center gap-2">
              <Moon className="mr-2 h-4 w-4" />
              深色
              </div>
              <Check className={cn("h-4 w-4 opacity-0", theme === "dark" && "opacity-100")} />
            </DropdownMenuItem>
            <DropdownMenuItem
              className={cn(
                "flex items-center justify-between gap-3 rounded-md",
                theme === "system" && "bg-accent text-accent-foreground",
              )}
              onClick={() => setTheme("system")}
            >
              <div className="flex items-center gap-2">
              <Monitor className="mr-2 h-4 w-4" />
              跟随系统
              </div>
              <Check className={cn("h-4 w-4 opacity-0", theme === "system" && "opacity-100")} />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          className={titlebarButtonClass}
          onClick={() => {
            void openProjectRepository().catch((error) => {
              toast.error(error instanceof Error ? error.message : "打开项目地址失败")
            })
          }}
        >
          <Github className="h-4 w-4" />
          <span className="sr-only">打开项目地址</span>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={titlebarButtonClass}
          onClick={onOpenSettings}
        >
          <Settings className="h-4 w-4" />
          <span className="sr-only">打开设置中心</span>
        </Button>

        {isDesktopShell ? (
          <>
            <span className="px-1 text-sm text-muted-foreground">|</span>
            <Button
              variant="ghost"
              size="icon"
              className={titlebarButtonClass}
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
              className={titlebarButtonClass}
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
              className="h-7 w-7 rounded-md hover:bg-destructive/15 hover:text-destructive"
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

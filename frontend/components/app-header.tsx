"use client"

import * as React from "react"
import { Moon, Sun, Monitor, Languages, Maximize2, Minimize2 } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"

interface AppHeaderProps {
  title?: string
  subtitle?: string
  language: "zh" | "en"
  onLanguageChange: (language: "zh" | "en") => void
}

export function AppHeader({ title, subtitle, language, onLanguageChange }: AppHeaderProps) {
  const { setTheme } = useTheme()
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  React.useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange)
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
  }, [])

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />

      {/* 页面标题 */}
      <div className="flex flex-col">
        {title && (
          <h1 className="text-sm font-medium leading-none">{title}</h1>
        )}
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>

      <div className="flex-1" />

      {/* 工具栏 */}
      <div className="flex items-center gap-1">
        {/* 语言切换 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Languages className="h-4 w-4" />
              <span className="sr-only">切换语言</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onLanguageChange("zh")}>
              <span className={language === "zh" ? "font-medium" : ""}>
                中文
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onLanguageChange("en")}>
              <span className={language === "en" ? "font-medium" : ""}>
                English
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 主题切换 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
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

        {/* 全屏切换 */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={toggleFullscreen}
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
          <span className="sr-only">切换全屏</span>
        </Button>
      </div>
    </header>
  )
}

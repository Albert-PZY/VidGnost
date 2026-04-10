import VideoMindApp from "@/app/page"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <VideoMindApp />
      <Toaster />
    </ThemeProvider>
  )
}

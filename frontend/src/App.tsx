import VideoMindApp from "@/app/page"
import { ThemeProvider } from "@/components/theme-provider"

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <VideoMindApp />
    </ThemeProvider>
  )
}

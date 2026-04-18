export type AsyncModuleLoader = () => Promise<unknown>

export function createCachedModulePreloader(loaders: AsyncModuleLoader[]): () => Promise<void> {
  let activePreload: Promise<void> | null = null

  return async () => {
    if (!activePreload) {
      activePreload = Promise.all(loaders.map((loader) => loader()))
        .then(() => undefined)
        .catch((error) => {
          activePreload = null
          throw error
        })
    }

    return activePreload
  }
}

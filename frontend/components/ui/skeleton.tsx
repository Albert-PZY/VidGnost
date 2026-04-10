import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('app-skeleton rounded-md', className)}
      {...props}
    />
  )
}

export { Skeleton }

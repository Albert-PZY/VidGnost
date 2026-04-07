import type { PropsWithChildren } from 'react'

import { cn } from '../lib/utils'

type PretextVariant = 'title' | 'h2' | 'h3' | 'body' | 'timestamp'

const classByVariant: Record<PretextVariant, string> = {
  title: 'text-[1.9rem] font-semibold leading-[1.15] tracking-[-0.018em] md:text-[2.25rem]',
  h2: 'text-[1.14rem] font-semibold leading-[1.32] tracking-[-0.01em] md:text-[1.24rem]',
  h3: 'text-[0.97rem] font-semibold leading-[1.45] tracking-[0.005em]',
  body: 'text-[0.94rem] leading-[1.72] text-text-main',
  timestamp: 'text-[0.76rem] leading-[1.5] tracking-[0.01em] text-text-subtle',
}

interface PretextProps extends PropsWithChildren {
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div'
  variant?: PretextVariant
  className?: string
}

export function PreText({ as = 'p', variant = 'body', className, children }: PretextProps) {
  const Comp = as
  return <Comp className={cn(classByVariant[variant], className)}>{children}</Comp>
}


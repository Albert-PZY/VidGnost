import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-xl text-[0.84rem] font-semibold tracking-[0.008em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'ui-btn-default border border-transparent text-white hover:-translate-y-[1px] active:translate-y-0',
        secondary:
          'ui-btn-secondary border border-border/80 text-text-main hover:-translate-y-[1px]',
        ghost: 'ui-btn-ghost bg-transparent text-text-main',
        outline:
          'ui-btn-outline border border-border/85 text-text-main',
      },
      size: {
        default: 'h-10 px-4 py-2.5',
        sm: 'h-8 px-3.5',
        lg: 'h-11 px-6',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  },
)
Button.displayName = 'Button'


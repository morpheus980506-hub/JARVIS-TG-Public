import { type VariantProps, cva } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import * as React from 'react'
import { cn } from '@/lib/utils'
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      iconSize: { sm: "[&_svg:not([class*='size-'])]:size-3.5" },
      size: {
        'window-menu': 'h-7 px-2.5',
        'window-control': 'h-full w-[46px] rounded-none',
        'icon-rail': 'size-[34px] p-0',
        'content-row': 'h-auto w-full justify-start px-3 py-4 whitespace-normal',
        model: 'h-8 gap-1.5 rounded-md px-3 py-2 text-xs has-[>svg]:px-2.5',
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        icon: 'size-9',
        'icon-lg': 'size-10',
        'icon-sm': 'size-8',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg,>[data-icon]]:px-2.5',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
      },
      shape: { round: 'rounded-full' },
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
        'row-action':
          'size-7 p-0 text-muted-foreground hover:text-foreground focus-visible:text-foreground',
        'row-label': 'block w-0 min-w-0 flex-1 overflow-hidden text-left',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      },
    },
  },
)
function Button({
  className,
  variant = 'default',
  size = 'default',
  iconSize,
  shape,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(
        buttonVariants({
          className,
          size,
          iconSize,
          shape,
          variant,
        }),
      )}
      {...props}
    />
  )
}
export { Button, buttonVariants }

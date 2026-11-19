import { type VariantProps, cva } from 'class-variance-authority'
import React from 'react'
import { cn } from '@/lib/utils'
const emptyVariants = cva(
  'group/empty flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg border-dashed text-center text-balance',
  {
    variants: {
      size: {
        default: 'gap-6 p-6 md:p-12',
        compact: 'gap-2 px-3 py-6',
      },
    },
    defaultVariants: { size: 'default' },
  },
)
function Empty({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof emptyVariants>) {
  return (
    <div
      data-slot="empty"
      data-size={size}
      className={cn(emptyVariants({ size }), className)}
      {...props}
    />
  )
}
function EmptyHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-header"
      className={cn('flex max-w-sm flex-col items-center gap-2 text-center', className)}
      {...props}
    />
  )
}
const emptyMediaVariants = cva(
  'mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    defaultVariants: {
      variant: 'default',
    },
    variants: {
      variant: {
        default: 'bg-transparent',
        icon: "flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-6",
      },
    },
  },
)
function EmptyMedia({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(
        emptyMediaVariants({
          className,
          variant,
        }),
      )}
      {...props}
    />
  )
}
function EmptyTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-title"
      className={cn('text-lg font-medium tracking-tight', className)}
      {...props}
    />
  )
}
function EmptyDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        'text-muted-foreground [&>a:hover]:text-primary text-sm/relaxed group-data-[size=compact]/empty:text-xs [&>a]:underline [&>a]:underline-offset-4',
        className,
      )}
      {...props}
    />
  )
}
function EmptyContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        'flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance',
        className,
      )}
      {...props}
    />
  )
}
export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia }

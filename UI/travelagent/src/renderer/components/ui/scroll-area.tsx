import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import * as React from 'react'
import { cn } from '../../lib/utils'
import { InputGroupTextarea } from './input-group'
import { Textarea } from './textarea'
export function ScrollArea({
  className,
  children,
  viewportRef,
  contentClassName,
  'aria-label': label,
  'aria-labelledby': labelledBy,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportRef?: React.Ref<HTMLDivElement>
  contentClassName?: string
}) {
  return (
    <ScrollAreaPrimitive.Root
      className={cn('relative min-w-0 overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        role={label || labelledBy ? 'region' : undefined}
        aria-label={label}
        aria-labelledby={labelledBy}
        ref={viewportRef}
        className="focus-visible:outline-ring size-full rounded-[inherit] focus-visible:outline-1 focus-visible:-outline-offset-1 [&>div]:!block [&>div]:min-w-full"
      >
        <div className={contentClassName}>{children}</div>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
export function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      orientation={orientation}
      className={cn(
        'group/scrollbar z-1 flex touch-none p-0.5 select-none',
        orientation === 'vertical' ? 'w-2.5' : 'h-2.5 flex-col',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="bg-muted-foreground/50 group-hover/scrollbar:bg-muted-foreground relative flex-1 rounded-full" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}
export const ScrollTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<'textarea'> & {
    group?: boolean
  }
>(({ className, group = false, ...props }, forwardedRef) => {
  const Control = group ? InputGroupTextarea : Textarea
  return (
    <ScrollArea
      className={cn(
        'max-h-[200px] w-full [&_textarea]:block [&_textarea]:field-sizing-content [&_textarea]:resize-none [&_textarea]:overflow-hidden [&>[data-slot=scroll-area-viewport]]:h-auto [&>[data-slot=scroll-area-viewport]]:max-h-[200px]',
        className,
      )}
    >
      <Control {...props} ref={forwardedRef} />
    </ScrollArea>
  )
})

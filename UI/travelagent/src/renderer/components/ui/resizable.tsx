import { GripVerticalIcon } from 'lucide-react'
import * as React from 'react'
import * as ResizablePrimitive from 'react-resizable-panels'
import { cn } from '@/lib/utils'

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn('flex h-full w-full aria-[orientation=vertical]:flex-col', className)}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  variant = 'default',
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
  variant?: 'default' | 'workspace' | 'sidebar'
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        'bg-border focus-visible:ring-ring relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90',
        variant !== 'default' &&
          'after:bg-border hover:after:bg-ring focus-visible:after:bg-ring z-1 w-2 flex-[0_0_8px] cursor-col-resize border-0 bg-transparent after:w-px hover:after:w-0.5 focus-visible:after:w-0.5',
        variant === 'sidebar' && 'from-sidebar to-background bg-linear-to-r from-50% to-50%',
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-border z-10 flex h-4 w-3 items-center justify-center rounded-xs border">
          <GripVerticalIcon className="size-2.5" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }

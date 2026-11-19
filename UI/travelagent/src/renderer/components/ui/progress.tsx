'use client'

import { Progress as ProgressPrimitive } from 'radix-ui'
import * as React from 'react'
import { cn } from '@/lib/utils'

function Progress({
  className,
  value,
  segments,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  segments?: { value: number; className: string }[]
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('bg-primary/20 relative h-2 w-full overflow-hidden rounded-full', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn('h-full w-full', segments ? 'flex' : 'bg-primary flex-1 transition-all')}
        style={segments ? undefined : { transform: `translateX(-${100 - (value || 0)}%)` }}
      >
        {segments?.map((segment) => (
          <span
            key={segment.className}
            className={cn('h-full shrink-0', segment.className)}
            style={{ width: `${segment.value}%` }}
          />
        ))}
      </ProgressPrimitive.Indicator>
    </ProgressPrimitive.Root>
  )
}

export { Progress }

import hljs from 'highlight.js/lib/core'
import json from 'highlight.js/lib/languages/json'
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockCopyButton,
} from '@/components/ui/code-block'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
hljs.registerLanguage('json', json)
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        '[&_:not(pre)>code:not([data-slot])]:bg-muted leading-[1.85] [overflow-wrap:anywhere] [&_:not(pre)>code:not([data-slot])]:rounded [&_:not(pre)>code:not([data-slot])]:px-1 [&_:not(pre)>code:not([data-slot])]:py-0.5 [&_:not(pre)>code:not([data-slot])]:text-[0.9em] [&_a]:underline [&_a]:underline-offset-4 [&_h1]:mt-5 [&_h1]:mb-2.5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-[25px] [&_h2]:mb-2.5 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-[18px] [&_h3]:mb-2 [&_h3]:text-[17px] [&_h3]:font-semibold [&_li]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-[22px] [&_p]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_td]:border-b [&_td]:p-[9px] [&_td]:text-left [&_th]:border-b [&_th]:p-[9px] [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-[22px]',
        'select-text [&>:first-child]:mt-0 [&>:last-child]:mb-0',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
export function ScrollablePre({
  children,
  language,
  title,
}: {
  children: React.ReactNode
  language?: 'json'
  title?: string
}) {
  const text = (value: React.ReactNode): string => {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value)
    }
    if (Array.isArray(value)) {
      return value.map(text).join('')
    }
    if (
      React.isValidElement<{
        children?: React.ReactNode
      }>(value)
    ) {
      return text(value.props.children)
    }
    return ''
  }
  const value = text(children)
  const highlighted = React.useMemo(
    () => (language ? hljs.highlight(value, { language }).value : undefined),
    [value, language],
  )
  const actions = (
    <CodeBlockActions>
      <CodeBlockCopyButton value={value} />
    </CodeBlockActions>
  )
  return (
    <CodeBlock size="sm">
      {title ? (
        <CodeBlockHeader>
          <CodeBlockTitle>{title}</CodeBlockTitle>
          {actions}
        </CodeBlockHeader>
      ) : (
        actions
      )}
      <ScrollArea
        aria-label={title || '代码内容'}
        className="max-h-[300px] [&>[data-slot=scroll-area-viewport]]:h-auto [&>[data-slot=scroll-area-viewport]]:max-h-[300px]"
      >
        <CodeBlockContent wrap>
          {highlighted !== undefined ? (
            <span
              className="[&_.hljs-attr]:text-syntax-key [&_.hljs-string]:text-syntax-string [&_.hljs-number]:text-syntax-number [&_.hljs-literal]:text-syntax-literal [&_.hljs-punctuation]:text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          ) : (
            value
          )}
        </CodeBlockContent>
      </ScrollArea>
    </CodeBlock>
  )
}
const markdownComponents: NonNullable<React.ComponentProps<typeof ReactMarkdown>['components']> = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault()
        if (href) {
          void api.openExternal(href)
        }
      }}
    >
      {children}
    </a>
  ),
  pre: ({ children }) => <ScrollablePre>{children}</ScrollablePre>,
  table: ({ children }) => (
    <ScrollArea
      aria-label="表格内容"
      className="[&_table]:w-max [&_table]:min-w-full [&>[data-slot=scroll-area-viewport]]:h-auto"
    >
      <table>{children}</table>
    </ScrollArea>
  ),
}

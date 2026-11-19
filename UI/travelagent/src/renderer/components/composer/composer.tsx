import { ArrowUp, Mic, Plus, Square } from 'lucide-react'
import { useRef } from 'react'
import { AttachmentList } from '@/components/composer/attachment-list'
import { DictationWaveform } from '@/components/composer/dictation-waveform'
import { ModelPicker } from '@/components/composer/model-picker'
import { WorkspacePicker } from '@/components/composer/workspace-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group'
import { ScrollTextarea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { useDictation } from '@/hooks/use-dictation'
import type { TravelAppState } from '@/hooks/use-travel-app'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

const MAX_DRAFT_LENGTH = 50_000
export function Composer({
  cfg,
  modelCatalog,
  setCfg,
  input,
  setInput,
  running,
  textArea,
  send,
  attachments,
  attachmentsBusy,
  chooseAttachments,
  removeAttachment,
  pasteImages,
  showComposerMenu,
  showWorkspacePicker = false,
  workspaceId,
  setChosenWorkspaceId,
  openWorkspaceSettings,
}: Pick<
  TravelAppState,
  | 'cfg'
  | 'modelCatalog'
  | 'setCfg'
  | 'input'
  | 'setInput'
  | 'running'
  | 'textArea'
  | 'send'
  | 'attachments'
  | 'attachmentsBusy'
  | 'chooseAttachments'
  | 'removeAttachment'
  | 'pasteImages'
  | 'showComposerMenu'
  | 'workspaceId'
  | 'setChosenWorkspaceId'
  | 'openWorkspaceSettings'
> & { showWorkspacePicker?: boolean }) {
  const focusDraftAfterDictation = useRef(false)
  const dictation = useDictation((text) => {
    setInput((draft) => {
      const separator = draft && !/\s$/.test(draft) ? ' ' : ''
      return (draft + separator + text).slice(0, MAX_DRAFT_LENGTH)
    })
    focusDraftAfterDictation.current = true
  })
  const dictationActive = dictation.state !== 'idle'
  return (
    <div className="chat-column shrink-0 pb-4">
      <InputGroup variant="composer">
        {!!attachments.length && (
          <InputGroupAddon align="block-start">
            <AttachmentList items={attachments} remove={removeAttachment} />
          </InputGroupAddon>
        )}
        <ScrollTextarea
          group
          ref={textArea}
          rows={1}
          aria-label="消息"
          value={input}
          maxLength={MAX_DRAFT_LENGTH}
          onPaste={(event) => {
            const images = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith('image/'),
            )
            if (!images.length) return
            event.preventDefault()
            void pasteImages(images)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            void showComposerMenu()
          }}
          onKeyDownCapture={(event) => {
            if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
              event.preventDefault()
              void showComposerMenu()
            }
          }}
          onChange={(event) => setInput(event.target.value)}
          placeholder="发消息…"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (!dictationActive) void send()
            }
          }}
        />
        <InputGroupAddon align="block-end" className="min-h-8 justify-between gap-1">
          <div className="flex h-8 min-w-0 items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              shape="round"
              title="添加文件"
              aria-label="添加文件"
              disabled={attachmentsBusy}
              onClick={() => void chooseAttachments()}
            >
              <Plus data-icon="inline-start" />
            </Button>
            {showWorkspacePicker && (
              <WorkspacePicker
                workspaces={cfg?.workspaces ?? []}
                workspaceId={workspaceId}
                chooseWorkspace={setChosenWorkspaceId}
                manageWorkspaces={openWorkspaceSettings}
              />
            )}
          </div>
          <div className="flex h-8 min-w-0 items-center gap-1">
            {cfg && (
              <ModelPicker
                key={JSON.stringify([
                  cfg.profile.baseURL,
                  cfg.profile.protocol,
                  cfg.profile.headers,
                ])}
                cfg={cfg}
                catalog={modelCatalog}
                disabled={Boolean(running)}
                update={setCfg}
              />
            )}
            <Dialog
              open={dictationActive}
              onOpenChange={(open) => {
                if (open) void dictation.start()
                else dictation.cancel()
              }}
            >
              <DialogTrigger asChild>
                <InputGroupButton
                  variant="outline"
                  size="icon-sm"
                  shape="round"
                  disabled={Boolean(running)}
                  aria-label="听写"
                  title="听写"
                >
                  <Mic data-icon="inline-start" />
                </InputGroupButton>
              </DialogTrigger>
              <DialogContent
                className="justify-items-center gap-6 rounded-2xl px-8 py-10 sm:max-w-sm"
                showCloseButton={false}
                onPointerDownOutside={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => {
                  if (!focusDraftAfterDictation.current) return
                  focusDraftAfterDictation.current = false
                  const field = textArea.current
                  if (!field) return
                  event.preventDefault()
                  field.focus()
                  const end = field.value.length
                  field.setSelectionRange(end, end)
                }}
              >
                <DialogHeader className="items-center">
                  <DialogTitle className="sr-only">听写</DialogTitle>
                  <Mic aria-hidden="true" className="size-24" strokeWidth={1.3} />
                </DialogHeader>
                <div className="grid h-20 w-full place-items-center">
                  {dictation.state === 'recording' && (
                    <DictationWaveform analyser={dictation.analyser} />
                  )}
                  <DialogDescription
                    role="status"
                    className={cn(
                      'flex items-center gap-2',
                      (dictation.state === 'recording' || dictation.state === 'idle') && 'sr-only',
                    )}
                  >
                    {dictation.state === 'starting' && '正在打开麦克风…'}
                    {dictation.state === 'recording' && '正在听写，请开始说话。'}
                    {dictation.state === 'transcribing' && (
                      <>
                        <Spinner aria-hidden="true" />
                        正在转写录音…
                      </>
                    )}
                  </DialogDescription>
                </div>
                <DialogFooter className="w-full max-w-52 flex-col gap-3 sm:flex-col">
                  <Button
                    size="lg"
                    shape="round"
                    disabled={dictation.state !== 'recording'}
                    onClick={dictation.finish}
                  >
                    结束听写
                  </Button>
                  <DialogClose asChild>
                    <Button size="lg" shape="round" variant="outline">
                      取消听写
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <InputGroupButton
              variant="default"
              size="icon-sm"
              shape="round"
              disabled={
                !running &&
                (dictationActive || attachmentsBusy || (!input.trim() && !attachments.length))
              }
              aria-label={running ? '停止生成' : '发送消息'}
              title={running ? '停止生成' : '发送消息'}
              onClick={() => (running ? api.cancel(running) : send())}
            >
              {running ? (
                <Square data-icon="inline-start" fill="currentColor" />
              ) : (
                <ArrowUp data-icon="inline-start" />
              )}
            </InputGroupButton>
          </div>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

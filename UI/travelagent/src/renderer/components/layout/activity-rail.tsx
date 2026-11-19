import { Home, Settings as SettingsIcon } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import type { TravelAppState } from '@/hooks/use-travel-app'
export function ActivityRail({
  account,
  setAccountOpen,
  setModal,
  panel,
  newChat,
  modal,
  accountOpen,
}: Pick<
  TravelAppState,
  'account' | 'setAccountOpen' | 'setModal' | 'panel' | 'newChat' | 'modal' | 'accountOpen'
>) {
  return (
    <nav
      className="fixed top-10 bottom-1.5 left-0 flex w-12 flex-col items-center gap-2 py-2"
      aria-label="主导航"
    >
      <Button
        variant={!panel ? 'secondary' : 'ghost'}
        size="icon-rail"
        title="新对话"
        aria-label="新对话"
        aria-current={!panel ? 'page' : undefined}
        onClick={newChat}
      >
        <Home data-icon="inline-start" />
      </Button>
      <span className="flex-1" />
      <Button
        variant="ghost"
        size="icon-rail"
        title="设置"
        aria-label="设置"
        aria-haspopup="dialog"
        aria-expanded={modal}
        aria-controls={modal ? 'settings-dialog' : undefined}
        onClick={() => setModal(true)}
      >
        <SettingsIcon data-icon="inline-start" />
      </Button>
      <Button
        variant="ghost"
        size="icon-rail"
        aria-haspopup="dialog"
        aria-expanded={accountOpen}
        aria-controls={accountOpen ? 'account-dialog' : undefined}
        className="rounded-full"
        title={account ? `${account.displayName} · 本地演示账户` : '登录账户'}
        aria-label={account ? '账户信息' : '登录账户'}
        onClick={() => setAccountOpen(true)}
      >
        <Avatar className="size-8">
          <AvatarFallback>{account ? 'A' : '旅'}</AvatarFallback>
        </Avatar>
      </Button>
    </nav>
  )
}
